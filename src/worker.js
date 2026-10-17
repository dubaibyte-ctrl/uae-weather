// UAE Live Rain & Weather Explorer: Cloudflare Worker
//   /api/metar        cached proxy for UAE airport METARs (AviationWeather.gov)
//   /api/validation   radar-vs-METAR scoring from the validation log
//   /api/health       last collector run + row counts
//   /api/scan         whole-UAE radar echo areas + radar coverage layer (the app measures distances itself)
//   cron (every 10 min): collect METARs + probe the newest RainViewer frames at each airport
//   everything else   static app from ./public
import { ValidationLog } from "./log.js";
import { STATIONS, STATION_IDS, fetchMetars } from "./lib/metar.js";
import { fetchIndex, probeFrame } from "./lib/radar.js";
import { scanFrame, scanCoverage } from "./lib/scan.js";
import { GRID, ECHO_ALPHA, MIN_CLUSTER_PX } from "../public/lib/radar-geo.js";

export { ValidationLog };

const JSON_HDR = { "content-type": "application/json; charset=utf-8" };
const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { ...JSON_HDR, ...extra } });
const logStub = (env) => env.LOG.get(env.LOG.idFromName("main"));

async function handleMetar(req, ctx) {
  const u = new URL(req.url);
  const ids = (u.searchParams.get("ids") || STATION_IDS.join(",")).toUpperCase();
  if (!/^O[A-Z]{3}(,O[A-Z]{3}){0,11}$/.test(ids)) return json({ error: "bad ids" }, 400);
  const hours = Math.min(Math.max(parseInt(u.searchParams.get("hours") || "3", 10) || 3, 1), 6);
  const upstream = `https://aviationweather.gov/api/data/metar?ids=${ids}&format=json&hours=${hours}`;
  const cache = caches.default, key = new Request(upstream);
  let res = await cache.match(key);
  if (!res) {
    const f = await fetch(upstream, { headers: { "User-Agent": "uae-weather-personal/1.0" } });
    if (!f.ok) return json({ error: "upstream " + f.status }, 502);
    res = new Response(f.body, { status: 200, headers: { ...JSON_HDR, "cache-control": "public, max-age=120" } });
    ctx.waitUntil(cache.put(key, res.clone()));
  }
  return res;
}

async function collect(env) {
  const stub = logStub(env);
  const errors = [], at = Date.now();
  let metars = [], radar = [];
  try { metars = (await fetchMetars()).norm; } catch (e) { errors.push("metar: " + (e.message || e)); }
  try {
    const { host, frames } = await fetchIndex();
    const known = new Set(await stub.knownFrames());
    const stationLL = Object.fromEntries(Object.entries(STATIONS).map(([id, s]) => [id, s.ll]));
    for (const fr of frames.slice(-3)) {
      if (known.has(fr.ms)) continue;
      radar.push(...(await probeFrame(host, fr, stationLL)));
    }
    const bad = radar.filter((r) => r.state !== "ok").length;
    if (bad) errors.push(`radar: ${bad} sample(s) not usable (e.g. ${radar.find((r) => r.state !== "ok").state})`);
  } catch (e) { errors.push("radar: " + (e.message || e)); }
  await stub.record({ metars, radar, errors, at });
  try { await collectScan(stub, errors); } catch (e) { errors.push("scan: " + (e.message || e)); }
  if (errors.length) await stub.noteErrors(at, errors);
}

// Radar scan, kept light for the free plan's CPU limit: one heavy job per run. Coverage layer first (and daily after),
// otherwise the newest frame not yet scanned. Older frames are not back-filled; the trend uses the frame ~20 min earlier,
// which earlier runs already stored.
async function collectScan(stub, errors) {
  const ca = await stub.coverageAge();
  if (!ca || ca.state !== "ok" || Date.now() - ca.savedMs > 24 * 3600e3) {
    const cov = await scanCoverage();
    if (cov.state !== "ok") errors.push("coverage: " + cov.errs.slice(0, 2).join(","));
    await stub.saveScan(null, cov);
    return;
  }
  const { host, frames } = await fetchIndex();
  const known = new Set(await stub.scanKnown());
  const fr = frames.slice().reverse().slice(0, 3).find((f) => !known.has(f.ms));
  if (!fr) return;
  const r = await scanFrame(host, fr);
  if (r.errs.length) errors.push(`scan ${new Date(fr.ms).toISOString().slice(11, 16)}Z: ${r.errs.length} tile(s) unreadable (${r.errs[0]})`);
  await stub.saveScan(r, null);
}

const WARNINGS = {
  available: false,
  reason: "The UAE National Center of Meteorology (NCM) publishes warnings on its website, app and social channels, but no public machine-readable warnings feed was found, so this app cannot read official warnings.",
  links: [
    { name: "NCM", url: "https://www.ncm.ae/" },
    { name: "UAE Government: weather and environment", url: "https://u.ae/en/information-and-services/environment-and-energy/weather-conditions-and-environmental-status" },
  ],
};

async function handleScan(env) {
  const stub = logStub(env);
  const [{ frames, coverage }, val] = await Promise.all([stub.loadScan(3), stub.summary(30).catch(() => null)]);
  const validated = !!(val && val.enough && val.pod != null && val.far != null && val.pod >= 0.6 && val.far <= 0.4);
  return json({
    now: Date.now(), frames, coverage,
    grid: { tx0: GRID.tx0, ty0: GRID.ty0, W: GRID.W, H: GRID.H },
    thresholds: { echoAlpha: ECHO_ALPHA, minClusterPx: MIN_CLUSTER_PX },
    validation: { validated, enough: !!(val && val.enough), rainEvents: val ? val.rainEvents : 0, pod: val ? val.pod : null, far: val ? val.far : null },
    intensity: { available: false, note: "Radar colour strength has not been validated against rainfall observations, so no intensity estimate is given." },
    warnings: WARNINGS,
  }, 200, { "cache-control": "public, max-age=60" });
}

export default {
  async fetch(req, env, ctx) {
    const u = new URL(req.url);
    if (u.pathname === "/api/metar") return handleMetar(req, ctx);
    if (u.pathname === "/api/validation") {
      const days = Math.min(Math.max(parseInt(u.searchParams.get("days") || "30", 10) || 30, 1), 90);
      return json(await logStub(env).summary(days), 200, { "cache-control": "public, max-age=300" });
    }
    if (u.pathname === "/api/scan") return handleScan(env);
    if (u.pathname === "/api/health") return json({ now: Date.now(), ...(await logStub(env).health()) }, 200, { "cache-control": "no-store" });
    if (u.pathname.startsWith("/api/")) return json({ error: "not found" }, 404);
    return env.ASSETS.fetch(req);
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(collect(env));
  },
};
