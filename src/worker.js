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
import { extractReport, reportSignature, verifyReport, classifyItem, buildRows } from "./lib/community.js";
import { PULL_CONNECTORS } from "./lib/connectors.js";

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
  try { await ensureWebhook(env, stub); } catch (e) { errors.push("telegram: " + (e.message || e)); } // self-heals the webhook once the token secret exists
  try { await runConnectors(stub, errors); } catch (e) { errors.push("connectors: " + (e.message || e)); }
  if (errors.length) await stub.noteErrors(at, errors);
}

// Run each pull connector in isolation: one failure is recorded in that connector's health and never affects the
// others, Telegram, radar or METAR. Accepted items flow through the same parser / verifier / Community pipeline.
async function runConnectors(stub, errors) {
  for (const c of PULL_CONNECTORS) {
    const prev = (await stub.getConnState(c.id)) || {};
    try {
      const items = await c.fetchItems();
      let accepted = 0, skipped = 0; const rows = [];
      for (const it of items) {
        const cls = classifyItem(it.title);
        if (!cls.accept) { skipped++; continue; }
        rows.push(...buildRows({ source: c.source, extId: it.extId, channel: c.channel, channelUser: c.channelUser, url: it.url, title: it.title, publishedMs: it.publishedMs, observedMs: null }));
        accepted++;
      }
      const res = rows.length ? await stub.saveReports(rows) : { saved: 0 };
      const newest = items.reduce((m, it) => Math.max(m, it.publishedMs), prev.newestItemMs || 0);
      await stub.setConnState(c.id, { lastPollMs: Date.now(), ok: true, items: items.length, newestItemMs: newest, lastExtId: items[0]?.extId || prev.lastExtId || null, accepted: (prev.accepted || 0) + accepted, skipped: (prev.skipped || 0) + skipped, saved: (prev.saved || 0) + (res.saved || 0), lastError: null });
    } catch (e) {
      await stub.setConnState(c.id, { ...prev, lastPollMs: Date.now(), ok: false, lastError: String(e.message || e).slice(0, 140) });
      errors.push(`connector ${c.id}: ${String(e.message || e).slice(0, 80)}`);
    }
  }
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

// The public URL the webhook must point at. Overridable with env.PUBLIC_BASE_URL; defaults to the known deployment.
const workerBase = (env) => (env.PUBLIC_BASE_URL || "https://uae-weather.dubaibyte.workers.dev").replace(/\/$/, "");

// The bot token lives in the Durable Object (set once via the admin endpoint), so it survives every GitHub/Cloudflare
// deploy — unlike dashboard vars/secrets, which Workers Builds resets. env.TELEGRAM_BOT_TOKEN is only a local-dev fallback.
async function getToken(env, stub) {
  const stored = await stub.cfgGet("botToken");
  if (stored) return stored;
  return typeof env.TELEGRAM_BOT_TOKEN === "string" && env.TELEGRAM_BOT_TOKEN ? env.TELEGRAM_BOT_TOKEN : null;
}

// Minimal Telegram Bot API call. The token is never logged, returned, or sent anywhere but api.telegram.org.
async function tg(token, method, params = {}) {
  if (!token) return { ok: false, error: "no token" };
  const url = `https://api.telegram.org/bot${token}/${method}`;
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(params) });
    return await r.json();
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

// Self-service webhook setup: generate+store our own secret, register the webhook, cache a sanitized status.
// Idempotent and safe to call from cron. Returns a sanitized status object (no token, no secret).
async function ensureWebhook(env, stub, force = false) {
  const token = await getToken(env, stub);
  if (!token) return { configured: false };
  let secret = await stub.cfgGet("webhookSecret");
  let freshSecret = false;
  if (!secret) { secret = await stub.cfgSet("webhookSecret", (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "")); freshSecret = true; }
  const target = workerBase(env) + "/api/telegram-webhook";
  const already = (await stub.cfgGet("webhookFor")) === target && (await stub.cfgGet("webhookOk"));
  // Re-register whenever we just minted a secret, so Telegram's secret_token always matches what the webhook checks.
  if (force || freshSecret || !already) {
    const res = await tg(token, "setWebhook", { url: target, secret_token: secret, allowed_updates: ["channel_post", "edited_channel_post", "message"], max_connections: 20 });
    await stub.cfgSet("webhookOk", !!res.ok); await stub.cfgSet("webhookFor", target);
    if (!(await stub.cfgGet("botUsername"))) { const me = await tg(token, "getMe"); if (me.ok) await stub.cfgSet("botUsername", me.result.username); }
  }
  const info = await tg(token, "getWebhookInfo");
  const status = info.ok ? { url: info.result.url, pending: info.result.pending_update_count, lastError: info.result.last_error_message || null, lastErrorAt: info.result.last_error_date ? info.result.last_error_date * 1000 : null } : { error: "getWebhookInfo failed" };
  await stub.cfgSet("webhookStatus", { ...status, checkedAt: Date.now() });
  return { configured: true, registered: await stub.cfgGet("webhookOk"), botUsername: await stub.cfgGet("botUsername"), status };
}

async function handleTelegramWebhook(req, env) {
  const stub = logStub(env);
  const secret = await stub.cfgGet("webhookSecret");
  if (!secret) return json({ error: "webhook not configured" }, 503);
  if (req.headers.get("x-telegram-bot-api-secret-token") !== secret) return json({ error: "unauthorized" }, 401);
  let update;
  try { update = await req.json(); } catch { return json({ ok: true }); }   // always 200 so Telegram doesn't retry-storm
  try {
    const msgs = [update.channel_post, update.edited_channel_post, update.message].filter(Boolean);
    const keep = [];
    for (const m of msgs) {
      const chat = m.chat || {};
      // Trust-on-first-use: first channel seen becomes authorized; afterwards only authorized chats are stored.
      if (!(await stub.isAuthorized(chat.id))) continue;
      await stub.authorizeChat(chat.id, chat.title || chat.username || String(chat.id));
      keep.push(m);
    }
    const rows = keep.flatMap((m) => reportsFromMessage(m));
    if (rows.length) await stub.saveReports(rows);
  } catch (e) { /* swallow: never fail the webhook */ }
  return json({ ok: true });
}

// Token-protected admin endpoint and one-time token bootstrap. The owner opens it in their OWN browser with ?token=<bot token>.
// First call with no token yet stored: the token is saved into the Durable Object (survives deploys) — trust-on-first-set.
// Later calls must present the same token. The token is never echoed back.
// A clean one-field setup page: paste the bot token, click Connect. The token is sent in the POST body (not the URL,
// so it is not logged in query strings) and stored server-side in the Durable Object.
function handleSetupPage() {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect Telegram — UAE Rain Explorer</title><style>
body{font:16px/1.5 system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#0e1a1f;color:#e6eef0}
h1{font-size:20px;color:#7cc4d6} input{width:100%;padding:12px;border-radius:10px;border:1px solid #28404a;background:#16262d;color:#e6eef0;font:inherit}
button{margin-top:12px;padding:12px 18px;border-radius:10px;border:0;background:#0f4c5c;color:#fff;font:inherit;cursor:pointer;min-height:44px}
.out{margin-top:16px;padding:12px;border-radius:10px;white-space:pre-wrap;word-break:break-word;font:13px/1.4 ui-monospace,Menlo,monospace}
.ok{background:#12304f;border:1px solid #6db3ff} .err{background:#3a1414;border:1px solid #ff8a80} .muted{color:#9bb0b8;font-size:13px}</style></head>
<body><h1>Connect Telegram bot</h1>
<p class="muted">Paste your BotFather token for @DubaibyteWeatherBot and press Connect. The token is sent securely and stored inside the app — it never appears in the address bar and is never shared in chat.</p>
<input id="t" type="password" autocomplete="off" placeholder="123456789:AA..." aria-label="Bot token">
<button id="b">Connect &amp; register webhook</button>
<div id="o" class="out muted" hidden></div>
<script>
const b=document.getElementById('b'),t=document.getElementById('t'),o=document.getElementById('o');
b.onclick=async()=>{const tok=t.value.trim();if(!tok){show('Please paste the token first.','err');return;}
b.disabled=true;b.textContent='Connecting…';
try{const r=await fetch('/api/telegram-admin?action=setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:tok})});const j=await r.json();
if(j.ok&&j.registered){show('✅ Connected as @'+(j.botUsername||'your bot')+'. Webhook registered. Now post a test message in your channel, then return to chat.','ok');t.value='';}
else{show('⚠ '+(j.error||JSON.stringify(j)),'err');}}catch(e){show('Network error: '+e.message,'err');}
b.disabled=false;b.textContent='Connect & register webhook';};
function show(m,c){o.hidden=false;o.className='out '+c;o.textContent=m;}
</script></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

async function handleTelegramAdmin(req, env, u) {
  const stub = logStub(env);
  const action = u.searchParams.get("action") || (req.method === "POST" ? "setup" : "status");
  let provided = u.searchParams.get("token");
  if (!provided && req.method === "POST") { const body = await req.json().catch(() => ({})); provided = body && body.token; }
  const current = await getToken(env, stub);

  if (action === "setup") {
    if (!provided) return json({ error: "Paste your bot token to connect." }, 400);
    const me = await tg(provided, "getMe");                 // validate the token with Telegram before storing it
    if (!me.ok) return json({ error: "Telegram rejected that token. Copy the FULL token from BotFather (it looks like 123456789:AA…) and paste it again." }, 400);
    if (current && current !== provided) {                  // a different token is stored: only overwrite if it no longer works (recovery)
      const curOk = await tg(current, "getMe");
      if (curOk.ok) return json({ error: "A working bot is already connected. Open /api/telegram-admin?token=<current>&action=reset first to change it." }, 409);
    }
    await stub.cfgSet("botToken", provided);                // store the validated token (survives all deploys)
    await stub.cfgSet("botUsername", me.result && me.result.username ? me.result.username : null);
  } else {
    if (!current || provided !== current) return json({ error: "unauthorized" }, 401);
  }

  if (action === "reset") {                                 // clear token + webhook state to start over
    for (const k of ["botToken", "webhookSecret", "webhookOk", "webhookFor", "botUsername"]) await stub.cfgSet(k, null);
    return json({ ok: true, note: "Cleared. Open the setup page to reconnect." });
  }
  if (action === "reset-auth") { await stub.cfgSet("authChats", []); return json({ ok: true, authChats: [], note: "Channel authorization cleared. The next channel to post will be auto-authorized." }); }
  const st = await ensureWebhook(env, stub, action === "setup");
  return json({ ok: true, action, ...st, authorizedChats: ((await stub.cfgGet("authChats")) || []).map((c) => ({ id: c.id, title: c.title })) });
}

// Collapse located, non-duplicate reports into one card per real-world event (group_id), preserving EVERY
// contributing source + URL so the UI can show "reported by YouTube + Telegram" instead of discarding evidence.
function buildGroups(reports) {
  const RANK = { "officially-confirmed": 4, "radar-corroborated": 3, unverified: 2, conflicting: 1, missing_location: 0 };
  const map = new Map();
  for (const r of reports.filter((x) => x.hasLocation && !x.duplicateOf)) {
    const g = map.get(r.groupId) || { id: r.groupId, members: [] };
    g.members.push(r); map.set(r.groupId, g);
  }
  const groups = [];
  for (const g of map.values()) {
    const members = g.members.slice().sort((a, b) => b.publishMs - a.publishMs);
    const rep = members[0];
    const verify = members.reduce((best, m) => (RANK[m.verify] > RANK[best] ? m.verify : best), "conflicting");
    const seen = new Set(), sources = [];
    for (const m of members) { const k = m.source + "|" + (m.url || m.channel); if (seen.has(k)) continue; seen.add(k); sources.push({ source: m.source, channel: m.channel, url: m.url, publishMs: m.publishMs, verify: m.verify }); }
    groups.push({ id: g.id, event: rep.event, place: rep.place, emirate: rep.emirate, text: rep.text, lang: rep.lang, publishMs: rep.publishMs, observedMs: rep.observedMs, verify, verifyDetail: rep.verifyDetail, sources, sourceCount: sources.length, memberIds: members.map((m) => m.id) });
  }
  return groups.sort((a, b) => b.publishMs - a.publishMs);
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
      duplicateOf: r.dup_of, hasLocation: !!r.has_location, groupId: r.group_id || r.id,
      verify: r.dup_of ? "duplicate" : v.status, verifyDetail: v,
    };
  });
  const groups = buildGroups(reports);
  // chatId is parsed from the stored id ("telegram:<chatId>:<msg>[:place]") so a private channel's id is discoverable for the allowlist.
  const channels = [...new Map(rows.map((r) => [r.channel, { channel: r.channel, user: r.channel_user, chatId: (r.id.split(":")[1] || null), url: r.channel_user ? "https://t.me/" + r.channel_user : null }])).values()];
  return json({
    now: Date.now(), days, reports, groups, channels,
    counts: { total: reports.length, events: groups.length, located: reports.filter((r) => r.hasLocation && !r.duplicateOf).length, duplicates: reports.filter((r) => r.duplicateOf).length, multiSource: groups.filter((g) => g.sources.length > 1).length },
    disclaimer: "Community reports are public social-media posts, not measurements. They are shown as unverified unless independently corroborated by radar or airport observations. Storm Centre is NOT integrated until its owner authorises access.",
  }, 200, { "cache-control": "no-store" });
}

export default {
  async fetch(req, env, ctx) {
    const u = new URL(req.url);
    if (u.pathname === "/api/telegram-webhook" && req.method === "POST") return handleTelegramWebhook(req, env);
    if (u.pathname === "/api/telegram-setup" && req.method === "GET") return handleSetupPage();
    if (u.pathname === "/api/telegram-admin") return handleTelegramAdmin(req, env, u);
    if (u.pathname === "/api/community") return handleCommunity(env, u);
    if (u.pathname === "/api/metar") return handleMetar(req, ctx);
    if (u.pathname === "/api/validation") {
      const days = Math.min(Math.max(parseInt(u.searchParams.get("days") || "30", 10) || 30, 1), 90);
      return json(await logStub(env).summary(days), 200, { "cache-control": "public, max-age=300" });
    }
    if (u.pathname === "/api/scan") return handleScan(env);
    if (u.pathname === "/api/health") {
      const stub = logStub(env);
      const [h, token, wok, buser, wstatus, authChats] = await Promise.all([stub.health(), getToken(env, stub), stub.cfgGet("webhookOk"), stub.cfgGet("botUsername"), stub.cfgGet("webhookStatus"), stub.cfgGet("authChats")]);
      const tgStatus = { configured: !!token, registered: !!wok, botUsername: buser || null, webhook: wstatus || null, authorizedChats: (authChats || []).map((c) => ({ id: c.id, title: c.title })) };
      const connectors = await stub.connStates(PULL_CONNECTORS.map((c) => c.id));
      return json({ now: Date.now(), build: "2026-10-17-src1", ...h, telegram: tgStatus, connectors }, 200, { "cache-control": "no-store" });
    }
    if (u.pathname.startsWith("/api/")) return json({ error: "not found" }, 404);
    return env.ASSETS.fetch(req);
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(collect(env));
  },
};
