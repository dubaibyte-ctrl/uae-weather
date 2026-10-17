// Radar geometry + echo analysis shared by the Worker (builds clusters from RainViewer tiles) and the browser
// (measures distance from places / the user to those clusters). Pure functions, no I/O.
// Everything is in "mosaic pixels": zoom-7 web-mercator pixels of the tile block that covers the UAE (about 1.1 km per pixel).
export const Z = 7, TILE = 256, WORLD = 2 ** Z * TILE;
export const BOUNDS = { latMin: 22.4, latMax: 26.3, lonMin: 51.4, lonMax: 56.7 };
export const ECHO_ALPHA = 8;            // tile alpha above this = radar echo present (same rule as the validation log)
export const MIN_CLUSTER_PX = 3;        // echoes smaller than this are dropped as speckle (counted, never shown as rain)
export const OVER_KM = 2.5, NEAR_KM = 10;

const rad = Math.PI / 180;
export function worldPx(lat, lon) {
  const x = ((lon + 180) / 360) * WORLD, r = lat * rad;
  return { x, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * WORLD };
}
export function worldLL(x, y) {
  const n = Math.PI - (2 * Math.PI * y) / WORLD;
  return { lat: (Math.atan(Math.sinh(n)) / rad), lon: (x / WORLD) * 360 - 180 };
}
const tl = worldPx(BOUNDS.latMax, BOUNDS.lonMin), br = worldPx(BOUNDS.latMin, BOUNDS.lonMax);
export const GRID = (() => {
  const tx0 = Math.floor(tl.x / TILE), tx1 = Math.floor(br.x / TILE), ty0 = Math.floor(tl.y / TILE), ty1 = Math.floor(br.y / TILE);
  return { tx0, tx1, ty0, ty1, cols: tx1 - tx0 + 1, rows: ty1 - ty0 + 1, W: (tx1 - tx0 + 1) * TILE, H: (ty1 - ty0 + 1) * TILE };
})();
export const tileList = () => { const l = []; for (let ty = GRID.ty0; ty <= GRID.ty1; ty++) for (let tx = GRID.tx0; tx <= GRID.tx1; tx++) l.push({ tx, ty, i: l.length }); return l; };
export function llToMosaic(lat, lon) { const p = worldPx(lat, lon); return { x: p.x - GRID.tx0 * TILE, y: p.y - GRID.ty0 * TILE }; }
export function mosaicToLL(x, y) { return worldLL(x + GRID.tx0 * TILE, y + GRID.ty0 * TILE); }
export const kmPerPx = (lat) => (40075.017 * Math.cos(lat * rad)) / WORLD;
export const inGrid = (x, y) => x >= 0 && y >= 0 && x < GRID.W && y < GRID.H;
export const tileIndexAt = (x, y) => Math.floor(y / TILE) * GRID.cols + Math.floor(x / TILE);

export function haversineKm(a, b, c, d) {
  const dl = (c - a) * rad, dn = (d - b) * rad, x = Math.sin(dl / 2) ** 2 + Math.cos(a * rad) * Math.cos(c * rad) * Math.sin(dn / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(x));
}
export function bearingDeg(a, b, c, d) {
  const y = Math.sin((d - b) * rad) * Math.cos(c * rad), x = Math.cos(a * rad) * Math.sin(c * rad) - Math.sin(a * rad) * Math.cos(c * rad) * Math.cos((d - b) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}
export const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
export const compassIdx = (deg) => Math.round(deg / 45) % 8;

// ---- clusters: connected echo pixels, stored as row runs [y, x0, len, ...] ----
export function clustersFromAlpha(alpha, W, H, minPx = MIN_CLUSTER_PX) {
  const seen = new Uint8Array(W * H), clusters = []; let noise = 0;
  const stack = new Int32Array(W * H);
  for (let s = 0; s < alpha.length; s++) {
    if (alpha[s] <= ECHO_ALPHA || seen[s]) continue;
    let sp = 0, n = 0; const idx = [];
    stack[sp++] = s; seen[s] = 1;
    while (sp) {
      const i = stack[--sp]; idx.push(i); n++;
      const x = i % W, y = (i - x) / W;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx; if (seen[j] || alpha[j] <= ECHO_ALPHA) continue;
        seen[j] = 1; stack[sp++] = j;
      }
    }
    if (n < minPx) { noise++; continue; }
    idx.sort((a, b) => a - b);
    const runs = []; let sx = 0, sy = 0;
    for (let k = 0; k < idx.length;) {
      const x0 = idx[k] % W, y = (idx[k] - x0) / W; let len = 1;
      while (k + len < idx.length && idx[k + len] === idx[k] + len && (idx[k] + len) % W !== 0) len++;
      runs.push(y, x0, len); sx += (x0 + (len - 1) / 2) * len; sy += (y + 0.5) * len; k += len;
    }
    clusters.push({ n, cx: +(sx / n + 0.5).toFixed(1), cy: +(sy / n).toFixed(1), runs });
  }
  clusters.sort((a, b) => b.n - a.n);
  return { clusters, noise };
}
export function maskFromRuns(runs, W, H) { const m = new Uint8Array(W * H); for (let i = 0; i < runs.length; i += 3) m.fill(1, runs[i] * W + runs[i + 1], runs[i] * W + runs[i + 1] + runs[i + 2]); return m; }
export function runsFromMask(m, W, H) {
  const runs = [];
  for (let y = 0; y < H; y++) { let x = 0; while (x < W) { if (!m[y * W + x]) { x++; continue; } let l = 1; while (x + l < W && m[y * W + x + l]) l++; runs.push(y, x, l); x += l; } }
  return runs;
}

// Nearest echo pixel (centre to centre) to a point in mosaic pixels. Returns null if there are no clusters.
export function nearestEcho(px, py, clusters) {
  let best = null;
  clusters.forEach((c, ci) => {
    const r = c.runs;
    for (let i = 0; i < r.length; i += 3) {
      const y = r[i] + 0.5, x0 = r[i + 1], x1 = x0 + r[i + 2] - 1;
      const cx = (px < x0 + 0.5 ? x0 : px > x1 + 0.5 ? x1 : Math.floor(px)) + 0.5;
      const dx = cx - px, dy = y - py, d2 = dx * dx + dy * dy;
      if (!best || d2 < best.d2) best = { d2, dx, dy, ci };
    }
  });
  if (!best) return null;
  return { px: Math.sqrt(best.d2), dx: best.dx, dy: best.dy, ci: best.ci };
}

// frame = { ms, ok:[0|1 per tile], clusters }, cover = { mask, state } | null
export function analysePoint(lat, lon, frame, cover) {
  const m = llToMosaic(lat, lon);
  if (!inGrid(m.x, m.y)) return { status: "unavailable", reason: "outside_grid", nearestKm: null, bearing: null, covered: null };
  const covered = cover && cover.state === "ok" ? !!cover.mask[Math.floor(m.y) * GRID.W + Math.floor(m.x)] : null;
  if (!frame.ok[tileIndexAt(m.x, m.y)]) return { status: "unavailable", reason: "tile_missing", nearestKm: null, bearing: null, covered };
  const ne = nearestEcho(m.x, m.y, frame.clusters);
  if (!ne) return { status: "none", nearestKm: null, bearing: null, covered };
  const k = ne.px * kmPerPx(lat), bearing = (Math.atan2(ne.dx, -ne.dy) / rad + 360) % 360;
  const status = k <= OVER_KM ? "over" : k <= NEAR_KM ? "near" : "none";
  return { status, nearestKm: +k.toFixed(1), bearing: Math.round(bearing), covered, cluster: ne.ci };
}

// Smallest distance (km) from the straight line A->B to any echo pixel. Straight line only, NOT the road route.
export function corridorKm(a, b, frame) {
  const A = llToMosaic(a.lat, a.lon), B = llToMosaic(b.lat, b.lon), vx = B.x - A.x, vy = B.y - A.y, L2 = vx * vx + vy * vy || 1;
  let best = Infinity;
  for (const c of frame.clusters) for (let i = 0; i < c.runs.length; i += 3) {
    const y = c.runs[i] + 0.5;
    for (let x = c.runs[i + 1]; x < c.runs[i + 1] + c.runs[i + 2]; x += 2) {
      const px = x + 0.5, t = Math.max(0, Math.min(1, ((px - A.x) * vx + (y - A.y) * vy) / L2));
      const dx = px - (A.x + t * vx), dy = y - (A.y + t * vy), d2 = dx * dx + dy * dy; if (d2 < best) best = d2;
    }
  }
  return best === Infinity ? null : +(Math.sqrt(best) * kmPerPx((a.lat + b.lat) / 2)).toFixed(1);
}

export function clusterInfo(c) {
  const ll = mosaicToLL(c.cx, c.cy);
  return { n: c.n, areaKm2: Math.round(c.n * kmPerPx(ll.lat) ** 2), lat: +ll.lat.toFixed(4), lon: +ll.lon.toFixed(4) };
}
