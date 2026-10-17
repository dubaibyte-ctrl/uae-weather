// UAE Live Rain & Weather Explorer: Cloudflare Worker
//   /api/metar        cached proxy for UAE airport METARs (AviationWeather.gov)
//   /api/validation   radar-vs-METAR scoring from the validation log
//   /api/health       last collector run + row counts
//   cron (every 10 min): collect METARs + probe the newest RainViewer frames at each airport
//   everything else   static app from ./public
import { ValidationLog } from "./log.js";
import { STATIONS, STATION_IDS, fetchMetars } from "./lib/metar.js";
import { fetchIndex, probeFrame } from "./lib/radar.js";

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
}

export default {
  async fetch(req, env, ctx) {
    const u = new URL(req.url);
    if (u.pathname === "/api/metar") return handleMetar(req, ctx);
    if (u.pathname === "/api/validation") {
      const days = Math.min(Math.max(parseInt(u.searchParams.get("days") || "30", 10) || 30, 1), 90);
      return json(await logStub(env).summary(days), 200, { "cache-control": "public, max-age=300" });
    }
    if (u.pathname === "/api/health") return json({ now: Date.now(), ...(await logStub(env).health()) }, 200, { "cache-control": "no-store" });
    if (u.pathname.startsWith("/api/")) return json({ error: "not found" }, 404);
    return env.ASSETS.fetch(req);
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(collect(env));
  },
};
