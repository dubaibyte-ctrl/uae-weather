// Radar geometry, PNG→cluster scan path, coverage, and places database checks. No network: tiles are synthesised PNGs.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import zlib from "node:zlib";
import { decodePng } from "../src/lib/png.js";
import { scanFrame, scanCoverage } from "../src/lib/scan.js";
import { tileXY } from "../src/lib/radar.js";
import * as G from "../public/lib/radar-geo.js";

const crc = (() => { const t = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; }); return (b) => { let c = 0xffffffff; for (const x of b) c = t[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }; })();
const chunk = (type, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4); data.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + data.length)), 8 + data.length); return b; };
// RGBA PNG 256x256; alphaAt(x,y) decides each pixel. filter 1 (Sub) on every row to exercise the unfilter path.
function makePng(alphaAt, filter = 1) {
  const W = 256, raw = Buffer.alloc(256 * (1 + W * 4));
  for (let y = 0; y < 256; y++) {
    const row = y * (1 + W * 4); raw[row] = filter;
    const px = Buffer.alloc(W * 4); for (let x = 0; x < W; x++) { px[x * 4] = 10; px[x * 4 + 1] = 20; px[x * 4 + 2] = 200; px[x * 4 + 3] = alphaAt(x, y); }
    for (let i = 0; i < px.length; i++) raw[row + 1 + i] = filter === 1 ? (px[i] - (i >= 4 ? px[i - 4] : 0)) & 255 : px[i];
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(256, 0); ihdr.writeUInt32BE(256, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const respond = (buf) => ({ ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) });

test("PNG alpha plane matches pixel() including Sub-filtered rows", async () => {
  const img = await decodePng(new Uint8Array(makePng((x, y) => (x > 100 && x < 110 && y > 50 && y < 60 ? 200 : 0))));
  const a = img.alpha();
  assert.equal(a[55 * 256 + 105], 200); assert.equal(a[10 * 256 + 10], 0);
  assert.equal(img.pixel(105, 55)[3], 200);
});

test("coordinate maths: mosaic<->lat/lon round trip and tile index agree with radar.js", () => {
  for (const [lat, lon] of [[25.2528, 55.3644], [24.2617, 55.6092], [23.13, 53.77]]) {
    const m = G.llToMosaic(lat, lon), b = G.mosaicToLL(m.x, m.y);
    assert.ok(Math.abs(b.lat - lat) < 1e-6 && Math.abs(b.lon - lon) < 1e-6);
    const t = tileXY(lat, lon, 7);
    assert.equal(Math.floor(m.x / 256) + G.GRID.tx0, t.tx); assert.equal(Math.floor(m.y / 256) + G.GRID.ty0, t.ty);
    assert.equal(Math.floor(m.x % 256), t.px);
  }
  assert.ok(Math.abs(G.kmPerPx(24.5) - 1.113) < 0.01);
  assert.ok(Math.abs(G.haversineKm(25.2528, 55.3644, 25.2528, 55.4644) - 10.06) < 0.1);
});

test("scanFrame finds an echo blob at the right lat/lon; missing tiles stay 'unavailable', never 'no echo'", async () => {
  // blob centred on Hatta (24.8007, 55.1273?) use Al Ain instead: 24.1917, 55.7606
  const c = G.llToMosaic(24.1917, 55.7606), tiles = G.tileList();
  const tileOfC = tiles[G.tileIndexAt(c.x, c.y)];
  const fetchStub = async (url) => {
    const m = url.match(/\/7\/(\d+)\/(\d+)\//); const tx = +m[1], ty = +m[2];
    if (tx === G.GRID.tx1 && ty === G.GRID.ty0) return { ok: false, status: 503 };            // one tile fails
    return respond(makePng((x, y) => { const gx = (tx - G.GRID.tx0) * 256 + x, gy = (ty - G.GRID.ty0) * 256 + y; return Math.hypot(gx - c.x, gy - c.y) < 6 ? 220 : gx === 5 && gy === 5 ? 200 : 0; }));
  };
  const r = await scanFrame("https://h.example", { ms: 1, path: "/v2/radar/1" }, fetchStub);
  assert.deepEqual(r.ok.filter((x) => !x).length, 1); assert.match(r.errs[0], /http_503/);
  assert.equal(r.clusters.length, 1, "single blob; the 1-px speckle is dropped"); assert.equal(r.noise >= 1, true);
  const frame = { ms: 1, ok: r.ok, clusters: r.clusters };
  const here = G.analysePoint(24.1917, 55.7606, frame, null);
  assert.equal(here.status, "over");
  const east = G.analysePoint(24.1917, 55.7606 + 0.1, frame, null);       // ~10 km east of centre, blob radius ~6.7 km => edge ~3.4 km
  assert.equal(east.status, "near"); assert.ok(east.nearestKm > 2.5 && east.nearestKm < 5, "nearest echo edge: " + east.nearestKm);
  assert.ok(Math.abs(east.bearing - 270) < 15, "echo lies to the west: " + east.bearing);
  const far = G.analysePoint(24.1917, 55.7606 + 0.3, frame, null);        // ~30 km east: no echo nearby, but the distance is still reported
  assert.equal(far.status, "none"); assert.ok(far.nearestKm > 20 && far.nearestKm < 30, "far " + far.nearestKm);
  // a place in the tile that failed must be 'unavailable'
  const failedTile = G.tileList().find((t) => t.tx === G.GRID.tx1 && t.ty === G.GRID.ty0);
  const inFailed = G.mosaicToLL((failedTile.tx - G.GRID.tx0) * 256 + 128, (failedTile.ty - G.GRID.ty0) * 256 + 128);
  assert.equal(G.analysePoint(inFailed.lat, inFailed.lon, frame, null).status, "unavailable");
});

test("empty radar is 'none' with covered=null when the coverage layer was not read (not proof of dry)", async () => {
  const r = await scanFrame("https://h", { ms: 2, path: "/p" }, async () => respond(makePng(() => 0)));
  assert.equal(r.clusters.length, 0);
  const a = G.analysePoint(25.2, 55.3, { ok: r.ok, clusters: r.clusters }, null);
  assert.equal(a.status, "none"); assert.equal(a.covered, null); assert.equal(a.nearestKm, null);
});

test("coverage layer: covered pixels via runs; failure => unavailable", async () => {
  const f = async (url) => respond(makePng((x) => (x < 128 ? 90 : 0)));
  const cov = await scanCoverage(f);
  assert.equal(cov.state, "ok"); assert.ok(cov.share > 0.45 && cov.share < 0.55);
  const mask = G.maskFromRuns(cov.runs, G.GRID.W, G.GRID.H);
  const west = G.analysePoint(25.2, 51.5 + 0.0, { ok: [1, 1, 1, 1, 1, 1], clusters: [] }, { state: "ok", mask });
  assert.equal(typeof west.covered, "boolean");
  const bad = await scanCoverage(async () => ({ ok: false, status: 404 }));
  assert.equal(bad.state, "unavailable"); assert.deepEqual(bad.runs, []);
});

test("corridor distance: straight line passes ~2 km from a blob", () => {
  const c = G.llToMosaic(24.5, 55.0), ll = G.mosaicToLL(c.x, c.y);
  const blob = { n: 9, cx: c.x, cy: c.y, runs: [Math.floor(c.y), Math.floor(c.x), 3] };
  const d = G.corridorKm({ lat: ll.lat + 0.02, lon: ll.lon - 0.2 }, { lat: ll.lat + 0.02, lon: ll.lon + 0.2 }, { clusters: [blob] });
  assert.ok(d > 1.5 && d < 3.2, "corridor " + d);
  assert.equal(G.corridorKm({ lat: 1, lon: 1 }, { lat: 2, lon: 2 }, { clusters: [] }), null);
});

test("places database: provenance, bounds, required names, per-emirate coverage", () => {
  const db = JSON.parse(fs.readFileSync(new URL("../public/data/places.json", import.meta.url)));
  const ids = new Set(); const by = {};
  for (const p of db.places) {
    assert.ok(!ids.has(p.id), "unique id " + p.id); ids.add(p.id);
    assert.match(p.src, /^(geonames:\d+|osm:[nwr]\d+)$/, "provenance for " + p.en);
    assert.ok(p.lat > 22.4 && p.lat < 26.3 && p.lon > 51.4 && p.lon < 56.7, "inside UAE grid " + p.en);
    assert.ok(G.inGrid(G.llToMosaic(p.lat, p.lon).x, G.llToMosaic(p.lat, p.lon).y), "inside radar grid " + p.en);
    assert.ok(db.emirates[p.em], "emirate " + p.em); by[p.em] = (by[p.em] || 0) + 1;
  }
  const names = new Set(db.places.map((p) => p.en));
  for (const n of ["Rashidiya", "Mirdif", "Al Khawaneej", "Al Awir", "Al Warqa", "Nad Al Sheba", "Jumeirah", "Al Barsha", "Dubai Marina", "Jebel Ali", "Lahbab", "Hatta", "Al Dhaid", "Mleiha", "Al Madam", "Kalba", "Khor Fakkan"]) assert.ok(names.has(n), "required: " + n);
  for (const e of ["du", "sh", "aj", "uq", "rk", "fu", "ad"]) assert.ok(by[e] >= 3, "coverage for " + e);
  assert.ok(db.places.some((p) => p.reg === "Al Ain") && db.places.filter((p) => p.reg === "Al Ain").length >= 10);
  assert.ok(db.places.length >= 150);
});
