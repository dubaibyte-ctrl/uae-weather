// Unit tests for parsing, PNG decoding, tile maths and scoring.
// Inputs here are test fixtures built to exercise the logic; they are never shown in the app.
import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { parseWx, normMetar } from "../src/lib/metar.js";
import { decodePng } from "../src/lib/png.js";
import { tileXY, sample, probeFrame } from "../src/lib/radar.js";
import { score } from "../src/lib/score.js";

// --- minimal PNG encoder for fixtures (exercises filters 0,1,2,4) ---
function crc32(buf) { let c, crc = ~0; for (const b of buf) { c = (crc ^ b) & 255; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function encode(w, h, ct, rows, extra = []) {
  const ch = ct === 6 ? 4 : ct === 4 ? 2 : 1;
  const stride = w * ch; const out = [];
  for (let y = 0; y < h; y++) {
    const filt = [0, 1, 2, 4][y % 4]; const line = rows[y]; const prev = y ? rows[y - 1] : new Uint8Array(stride);
    const f = Buffer.alloc(stride + 1); f[0] = filt;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? line[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0; let pred = 0;
      if (filt === 1) pred = a; else if (filt === 2) pred = b; else if (filt === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      f[x + 1] = (line[x] - pred) & 255;
    }
    out.push(f);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = ct;
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), ...extra, chunk("IDAT", zlib.deflateSync(Buffer.concat(out))), chunk("IEND", Buffer.alloc(0))]));
}
function rgbaTile(patch) { // 256x256 transparent with opaque patch {x,y,r}
  const rows = [];
  for (let y = 0; y < 256; y++) { const r = new Uint8Array(1024); if (patch && Math.abs(y - patch.y) <= patch.r) for (let x = patch.x - patch.r; x <= patch.x + patch.r; x++) { r.set([30, 90, 200, 255], x * 4); } rows.push(r); }
  return encode(256, 256, 6, rows);
}

test("parseWx separates station weather from vicinity", () => {
  assert.deepEqual(parseWx("HZ").at, []);
  assert.equal(parseWx("-TSRA VCSH BR").thunder, true);
  assert.deepEqual(parseWx("-TSRA VCSH BR").vc, ["SH"]);
  assert.equal(parseWx("+SHRA GR").hail, true);
  assert.deepEqual(parseWx(null).at, []);
});

test("normMetar on real AviationWeather records (fetched 2026-10-17)", () => {
  const dry = normMetar({ icaoId: "OMFJ", obsTime: 1792216800, temp: 32, wxString: "HZ", rawOb: "METAR OMFJ 170600Z 09005KT 050V140 5000 HZ NSC 32/26 Q1012 A2990" });
  assert.equal(dry.rain, 0); assert.equal(dry.obsMs, 1792216800000);
  const none = normMetar({ icaoId: "OMDB", obsTime: 1792216800, temp: 33, wxString: null, rawOb: "METAR OMDB 170600Z VRB03KT 8000 FEW025 33/26 Q1012 NOSIG" });
  assert.equal(none.rain, 0); assert.equal(none.wx, "");
});

test("decodePng handles RGBA with mixed filters", async () => {
  const img = await decodePng(rgbaTile({ x: 100, y: 120, r: 3 }));
  assert.equal(img.w, 256);
  assert.deepEqual(img.pixel(100, 120), [30, 90, 200, 255]);
  assert.equal(img.pixel(10, 10)[3], 0);
});

test("decodePng handles palette PNG with tRNS", async () => {
  const rows = []; for (let y = 0; y < 8; y++) { const r = new Uint8Array(8); if (y === 3) r[4] = 1; rows.push(r); }
  const png = encode(8, 8, 3, rows, [chunk("PLTE", Buffer.from([0, 0, 0, 10, 20, 30])), chunk("tRNS", Buffer.from([0, 255]))]);
  const img = await decodePng(png);
  assert.deepEqual(img.pixel(4, 3), [10, 20, 30, 255]); assert.equal(img.pixel(0, 0)[3], 0);
});

test("decodePng rejects opaque types and junk", async () => {
  await assert.rejects(decodePng(new Uint8Array([1, 2, 3])), /not a PNG/);
  await assert.rejects(decodePng(encode(2, 2, 6, [new Uint8Array(8), new Uint8Array(8)]).slice(0, 20)));
});

test("tileXY puts Dubai in z7 tile 83/54", () => {
  const t = tileXY(25.2048, 55.2708, 7); assert.equal(t.tx, 83); assert.equal(t.ty, 54);
});

test("sample finds an echo within 2 px and ignores one 5 px away", async () => {
  const img = await decodePng(rgbaTile({ x: 100, y: 120, r: 0 }));
  assert.equal(sample(img, 102, 120).echo, 1);
  assert.equal(sample(img, 106, 120).echo, 0);
});

test("probeFrame uses one fetch per tile and reports http errors honestly", async () => {
  const calls = []; const png = rgbaTile(null);
  const ok = async (u) => { calls.push(u); return { ok: true, arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) }; };
  const rows = await probeFrame("https://h", { ms: 1, path: "/v2/radar/1" }, { A: [25.2, 55.3], B: [25.25, 55.36] }, ok);
  assert.equal(calls.length, 1); assert.equal(rows.length, 2); assert.equal(rows[0].echo, 0);
  const bad = await probeFrame("https://h", { ms: 1, path: "/p" }, { A: [25.2, 55.3] }, async () => ({ ok: false, status: 404 }));
  assert.equal(bad[0].state, "http_404"); assert.equal(bad[0].echo, null);
});

test("score builds the contingency table and withholds rates until enough events", () => {
  const m = (station, obsMs, rain) => ({ station, obsMs, rain, wx: rain ? "RA" : "" });
  const r = (station, frameMs, echo) => ({ station, frameMs, echo, alpha: echo ? 200 : 0 });
  const t0 = 1_000_000_000;
  const s = score([m("A", t0, 1), m("A", t0 + 3600e3, 1), m("A", t0 + 7200e3, 0), m("A", t0 + 10800e3, 0), m("B", t0, 1)],
    [r("A", t0 + 120e3, 1), r("A", t0 + 3600e3, 0), r("A", t0 + 7200e3, 1), r("A", t0 + 10800e3, 0), r("B", t0 + 25 * 60e3, 1)]);
  assert.deepEqual(s.matrix, { hit: 1, miss: 1, falseAlarm: 1, correctNeg: 1 }); // B has no frame within 10 min: skipped
  assert.equal(s.pairs, 4); assert.equal(s.enough, false); assert.equal(s.pod, null);
});

test("score computes POD / FAR / CSI with >= 5 rain events", () => {
  const t0 = 1_000_000_000; const metars = [], radar = [];
  for (let i = 0; i < 6; i++) { metars.push({ station: "A", obsMs: t0 + i * 3600e3, rain: 1, wx: "RA" }); radar.push({ station: "A", frameMs: t0 + i * 3600e3, echo: i < 4 ? 1 : 0, alpha: 100 }); }
  metars.push({ station: "A", obsMs: t0 + 9e6, rain: 0, wx: "" }); radar.push({ station: "A", frameMs: t0 + 9e6, echo: 1, alpha: 50 });
  const s = score(metars, radar);
  assert.equal(s.rainEvents, 6); assert.equal(s.pod, 0.667); assert.equal(s.far, 0.2); assert.equal(s.csi, 0.571);
});
