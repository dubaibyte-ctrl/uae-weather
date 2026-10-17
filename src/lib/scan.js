// Worker-side radar scan: read the RainViewer tiles that cover the UAE, find connected echo areas, and read the
// radar coverage layer. Output is stored by the cron job and served to the app, which does all distance maths.
import { decodePng } from "./png.js";
import { GRID, TILE, tileList, clustersFromAlpha, runsFromMask } from "../../public/lib/radar-geo.js";

const UA = { "User-Agent": "uae-weather-personal/1.0" };
export const COVERAGE_URL = (tx, ty) => `https://tilecache.rainviewer.com/v2/coverage/0/256/7/${tx}/${ty}/0/0_0.png`;

async function tileAlpha(url, f) {
  try {
    const r = await f(url, { headers: UA });
    if (!r.ok) return { err: "http_" + r.status };
    const img = await decodePng(new Uint8Array(await r.arrayBuffer()));
    if (img.w !== TILE || img.h !== TILE) return { err: "size_" + img.w + "x" + img.h };
    return { alpha: img.alpha() };
  } catch (e) { return { err: "decode: " + String(e.message || e).slice(0, 50) }; }
}

function paste(mosaic, alpha, i) {
  const ox = (i % GRID.cols) * TILE, oy = Math.floor(i / GRID.cols) * TILE;
  for (let y = 0; y < TILE; y++) mosaic.set(alpha.subarray(y * TILE, (y + 1) * TILE), (oy + y) * GRID.W + ox);
}

// Same colour scheme/options as the validation log (2/0_0) so both read identical pixels.
export async function scanFrame(host, frame, f = fetch) {
  const mosaic = new Uint8Array(GRID.W * GRID.H), ok = [], errs = [];
  const res = await Promise.all(tileList().map((t) => tileAlpha(`${host}${frame.path}/256/7/${t.tx}/${t.ty}/2/0_0.png`, f)));
  res.forEach((r, i) => { if (r.alpha) { paste(mosaic, r.alpha, i); ok.push(1); } else { ok.push(0); errs.push(r.err); } });
  const { clusters, noise } = clustersFromAlpha(mosaic, GRID.W, GRID.H);
  return { frameMs: frame.ms, ok, errs, noise, clusters, echoPx: clusters.reduce((n, c) => n + c.n, 0) };
}

// Radar coverage layer: non-transparent = inside a radar network's coverage. Anything unreadable => state "unavailable".
export async function scanCoverage(f = fetch) {
  const mosaic = new Uint8Array(GRID.W * GRID.H); let okTiles = 0; const errs = [];
  const res = await Promise.all(tileList().map((t) => tileAlpha(COVERAGE_URL(t.tx, t.ty), f)));
  res.forEach((r, i) => { if (r.alpha) { okTiles++; paste(mosaic, r.alpha.map((a) => (a > 0 ? 255 : 0)), i); } else errs.push(r.err); });
  const state = okTiles === res.length ? "ok" : "unavailable";
  let covered = 0; for (let i = 0; i < mosaic.length; i++) if (mosaic[i]) covered++;
  const m = new Uint8Array(mosaic.length); for (let i = 0; i < mosaic.length; i++) m[i] = mosaic[i] ? 1 : 0;
  return { state, share: +(covered / mosaic.length).toFixed(3), errs, runs: state === "ok" ? runsFromMask(m, GRID.W, GRID.H) : [] };
}
