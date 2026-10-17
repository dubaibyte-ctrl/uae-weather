// RainViewer tile probing from the Worker. Tiles are fetched from RainViewer's public
// tile cache (personal/educational use). A transparent pixel means "no echo" OR "no coverage";
// that ambiguity is exactly what the validation log measures against airport reports.
import { decodePng } from "./png.js";

export const RV_INDEX = "https://api.rainviewer.com/public/weather-maps.json";
export const ECHO_ALPHA = 8;

export function tileXY(lat, lng, z) {
  const n = 2 ** z, x = ((lng + 180) / 360) * n, r = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  return { tx: Math.floor(x), ty: Math.floor(y), px: Math.floor((x % 1) * 256), py: Math.floor((y % 1) * 256) };
}

// Max alpha in a 5x5 window (about 6 km at zoom 7) and the colour of that pixel.
export function sample(img, px, py) {
  let best = [0, 0, 0, 0];
  for (let y = Math.max(0, py - 2); y <= Math.min(img.h - 1, py + 2); y++)
    for (let x = Math.max(0, px - 2); x <= Math.min(img.w - 1, px + 2); x++) {
      const p = img.pixel(x, y);
      if (p[3] > best[3]) best = p;
    }
  return { alpha: best[3], rgb: best.slice(0, 3), echo: best[3] > ECHO_ALPHA ? 1 : 0 };
}

export async function fetchIndex(f = fetch) {
  const r = await f(RV_INDEX, { headers: { "User-Agent": "uae-weather-personal/1.0" } });
  if (!r.ok) throw new Error("rainviewer index HTTP " + r.status);
  const j = await r.json();
  if (!j?.radar?.past?.length) throw new Error("rainviewer: no past frames");
  return { host: j.host, frames: j.radar.past.map((p) => ({ ms: p.time * 1000, path: p.path })) };
}

// stations: {id: [lat,lng]}. Returns one row per station for the frame.
export async function probeFrame(host, frame, stations, f = fetch) {
  const groups = new Map();
  for (const [id, ll] of Object.entries(stations)) {
    const t = tileXY(ll[0], ll[1], 7), key = t.tx + "/" + t.ty;
    if (!groups.has(key)) groups.set(key, { t, list: [] });
    groups.get(key).list.push({ id, t });
  }
  const rows = [];
  for (const [key, g] of groups) {
    const url = `${host}${frame.path}/256/7/${key}/2/0_0.png`;
    let state = "ok", img = null;
    try {
      const r = await f(url, { headers: { "User-Agent": "uae-weather-personal/1.0" } });
      if (!r.ok) state = "http_" + r.status;
      else img = await decodePng(new Uint8Array(await r.arrayBuffer()));
    } catch (e) { state = "decode_error: " + String(e.message || e).slice(0, 60); }
    for (const s of g.list) {
      if (img) { const v = sample(img, s.t.px, s.t.py); rows.push({ frameMs: frame.ms, station: s.id, state: "ok", echo: v.echo, alpha: v.alpha, rgb: v.rgb.join(",") }); }
      else rows.push({ frameMs: frame.ms, station: s.id, state, echo: null, alpha: null, rgb: null });
    }
  }
  return rows;
}
