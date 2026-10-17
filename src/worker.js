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
import { extractReport, reportSignature, verifyReport } from "./lib/community.js";

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

// ---------- Community Rain Reports (Telegram) ----------
// Turn one Telegram message into a report row. A post is a CLAIM: observed time is only set when the post itself
// is a fresh original (not a forward of older content); otherwise it stays null and the UI shows publish time only.
// One Telegram message can name several areas ("rain in Mirdif and Al Khawaneej"); emit one row per matched
// place so each area gets its own pin and its own verification. No place -> a single missing-location row.
function reportsFromMessage(msg, source = "telegram") {
  const text = msg.text || msg.caption || "";
  if (!text.trim()) return [];
  const chat = msg.chat || {};
  const channelUser = chat.username || null;
  const msgId = msg.message_id;
  const publishMs = (msg.date || Math.floor(Date.now() / 1000)) * 1000;
  const fwdDate = msg.forward_origin?.date || msg.forward_date || null;   // forwarded (new or legacy field)
  const forwarded = fwdDate != null;
  const forwardMs = fwdDate ? fwdDate * 1000 : null;
  const parsed = extractReport(text);
  const url = channelUser ? `https://t.me/${channelUser}/${msgId}` : null;
  // observed time is trusted only for an original, recent post; a forward of older content is not an observation
  const observedMs = !forwarded && Date.now() - publishMs < 3 * 3600e3 ? publishMs : null;
  const common = {
    source, channel: chat.title || channelUser || String(chat.id), channelUser, msgId,
    text: text.slice(0, 1000), lang: parsed.lang, event: parsed.event, events: parsed.events,
    publishMs, observedMs, forwarded, forwardMs, url,
  };
  const targets = parsed.places.length ? parsed.places : [null];
  return targets.map((place) => ({
    ...common,
    id: `${source}:${chat.id}:${msgId}` + (place ? ":" + place.id : ""),
    placeId: place?.id || null, placeName: place ? place.en : null, em: place?.em || parsed.emirates[0] || null,
    lat: place?.lat ?? null, lon: place?.lon ?? null,
    sig: reportSignature(text, place?.id || null), hasLocation: !!place,
  }));
}

async function handleTelegramWebhook(req, env) {
  // Secret header set when the webhook is registered (setWebhook?secret_token=...). Token itself is never needed here.
  const secret = env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) return json({ error: "webhook not configured" }, 503);
  if (req.headers.get("x-telegram-bot-api-secret-token") !== secret) return json({ error: "unauthorized" }, 401);
  let update;
  try { update = await req.json(); } catch { return json({ ok: true }); }   // always 200 so Telegram doesn't retry-storm
  try {
    const msgs = [update.channel_post, update.edited_channel_post, update.message].filter(Boolean);
    const rows = msgs.flatMap((m) => reportsFromMessage(m));
    if (rows.length) await logStub(env).saveReports(rows);
  } catch (e) { /* swallow: never fail the webhook */ }
  return json({ ok: true });
}

async function handleCommunity(env, u) {
  const days = Math.min(Math.max(parseInt(u.searchParams.get("days") || "2", 10) || 2, 1), 14);
  const stub = logStub(env);
  const [rows, scan] = await Promise.all([stub.communitySince(days), stub.loadScan(12)]);
  const earliest = rows.reduce((m, r) => Math.min(m, r.publish_ms), Date.now());
  const metars = await stub.metarsSince(earliest - 60 * 60000);
  const reports = rows.map((r) => {
    const v = r.has_location ? verifyReport({ lat: r.lat, lon: r.lon, publishMs: r.publish_ms, event: r.event }, scan.frames, metars) : { status: "missing_location", radar: "n/a", metar: "n/a" };
    return {
      id: r.id, source: r.source, channel: r.channel, channelUser: r.channel_user, url: r.url,
      text: r.text, lang: r.lang, event: r.event, events: JSON.parse(r.events || "[]"),
      place: r.place_id ? { id: r.place_id, name: r.place_name, em: r.em, lat: r.lat, lon: r.lon } : null,
      emirate: r.em, publishMs: r.publish_ms, observedMs: r.observed_ms,
      forwarded: !!r.forwarded, forwardMs: r.forward_ms,
      duplicateOf: r.dup_of, hasLocation: !!r.has_location,
      verify: r.dup_of ? "duplicate" : v.status, verifyDetail: v,
    };
  });
  const channels = [...new Map(rows.filter((r) => !r.dup_of).map((r) => [r.channel, { channel: r.channel, user: r.channel_user, url: r.channel_user ? "https://t.me/" + r.channel_user : null }])).values()];
  return json({
    now: Date.now(), days, reports, channels,
    counts: { total: reports.length, located: reports.filter((r) => r.hasLocation && !r.duplicateOf).length, duplicates: reports.filter((r) => r.duplicateOf).length },
    disclaimer: "Community reports are public social-media posts, not measurements. They are shown as unverified unless independently corroborated by radar or airport observations. Storm Centre is NOT integrated until its owner authorises access.",
  }, 200, { "cache-control": "no-store" });
}

export default {
  async fetch(req, env, ctx) {
    const u = new URL(req.url);
    if (u.pathname === "/api/telegram-webhook" && req.method === "POST") return handleTelegramWebhook(req, env);
    if (u.pathname === "/api/community") return handleCommunity(env, u);
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
