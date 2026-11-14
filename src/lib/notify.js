// Push-notification planning: WHICH weather events to announce, to WHICH subscriptions, and HOW they are worded.
// Pure (no I/O): the Worker supplies data + a dedupe ledger; this module returns the messages to send. Unit-tested.
//
// Honesty rules (same as the app): a radar echo is an unconfirmed precipitation signal, never "rain now"; a community post
// is a claim with its own source and time; old posts are never announced as current; official warnings are announced
// only from an authorized source (none is connected today, so that category never fires).
import { haversineKm } from "../../public/lib/radar-geo.js";

export const CATEGORIES = ["radar", "community", "warning"];
export const DEFAULT_CATS = { radar: true, community: true, warning: true };

export const RADAR_FRESH_MS = 20 * 60000;        // only announce echoes from a frame at most 20 min old
export const COMMUNITY_FRESH_MS = 2 * 3600e3;    // only announce reports observed/posted within the last 2 h
export const RADAR_COOLDOWN_MS = 3 * 3600e3;     // at most one radar alert per followed place per 3 h (one "episode")
export const MATCH_KM = 10;                      // a report within 10 km of a followed place counts for that place
export const MAX_PER_HOUR = 4, MAX_PER_DAY = 12; // per device, across categories — avoid notification fatigue
export const MAX_SENDS_PER_RUN = 25;             // bound CPU per cron run (free plan)
// Workers Free allows 50 outbound subrequests per invocation (cron included) and 1,000 to internal services. Each hop of
// a redirect chain counts, so the collector follows redirects itself and counts every hop. Calls to the app's Durable
// Object are counted as internal (conservative: the docs don't say whether they count). Pushes only use what is left.
export const SUBREQUEST_LIMIT = 50, SUBREQUEST_RESERVE = 4, INTERNAL_LIMIT = 1000, INTERNAL_RESERVE = 50;
export const PUSH_INTERNAL_PER_SEND = 2;          // pushResult + pushMarkSent
export function pushAllowance(budget) {
  const b = typeof budget === "number" ? { used: budget, internal: 0 } : budget;
  const ext = SUBREQUEST_LIMIT - SUBREQUEST_RESERVE - (b.used || 0);
  const int = Math.floor((INTERNAL_LIMIT - INTERNAL_RESERVE - (b.internal || 0)) / PUSH_INTERNAL_PER_SEND);
  return Math.max(0, Math.min(MAX_SENDS_PER_RUN, ext, int));
}
const MAX_REDIRECTS = 5;
export function countingFetch(budget, f = fetch) {
  return async (input, init = {}) => {
    let url = typeof input === "string" ? input : input.url, opts = { ...init, redirect: "manual" };
    for (let hop = 0; ; hop++) {
      budget.used++;
      const r = await f(url, opts);
      const loc = r && r.status >= 300 && r.status < 400 && r.headers && r.headers.get && r.headers.get("location");
      if (!loc || init.redirect === "manual") return r;
      if (hop >= MAX_REDIRECTS) throw new Error("too_many_redirects");
      url = new URL(loc, url).toString();
      if (r.status === 303 || ((r.status === 301 || r.status === 302) && opts.method && opts.method !== "GET" && opts.method !== "HEAD")) opts = { ...opts, method: "GET", body: undefined };
    }
  };
}
// Count every RPC to the Durable Object made during a cron run (each is one internal subrequest).
export function countingStub(stub, budget) {
  // Call as t[k](...a): Durable Object RPC stubs don't implement Function.prototype.apply. Leave `then` alone so the
  // wrapper is never mistaken for a promise.
  return new Proxy(stub, { get(t, k) { if (k === "then" || typeof k === "symbol" || typeof t[k] !== "function") return t[k]; return (...a) => { budget.internal = (budget.internal || 0) + 1; return t[k](...a); }; } });
}
// The whole push ledger a run needs, read once (one RPC) instead of one RPC per subscriber x event.
export function ledgerFromRows(rows) {
  const sent = new Set(), times = new Map();
  for (const r of rows || []) { sent.add(r.sub_key + "\u0000" + r.event_key); if (!times.has(r.sub_key)) times.set(r.sub_key, []); times.get(r.sub_key).push([r.event_key, r.sent_ms]); }
  return {
    wasSent: (sk, key) => sent.has(sk + "\u0000" + key),
    lastSentPrefix: (sk, prefix) => (times.get(sk) || []).reduce((m, [k, t]) => (k.startsWith(prefix) && t > m ? t : m), 0),
    sentSince: (sk, since) => (times.get(sk) || []).filter(([, t]) => t > since).length,
  };
}
// Fair order: start from a different subscriber each run so a tight budget can't starve the same devices every time.
export function rotateSubs(subs, now = Date.now()) { if (!subs.length) return subs; const i = Math.floor(now / 600e3) % subs.length; return [...subs.slice(i), ...subs.slice(0, i)]; }
// Push TTL = the time the event stays "fresh" (radar 20 min, community 2 h from its observation/frame time), so the push
// service drops it rather than delivering it late. Returns 0 when there isn't enough freshness left to be worth sending.
export const MIN_TTL_S = 120;
export function pushTtl(message, now = Date.now()) {
  const win = message.cat === "radar" ? RADAR_FRESH_MS : COMMUNITY_FRESH_MS;
  const s = Math.floor((message.ts + win - now) / 1000);
  return s >= MIN_TTL_S ? s : 0;
}

export function subKey(endpoint) { let h = 0x811c9dc5; const s = String(endpoint); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36); }

const TZ = "Asia/Dubai";
export function hm(ms, lang) { return new Intl.DateTimeFormat(lang === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms)); }

const SRC = { en: { instagram: "Instagram", youtube: "YouTube", telegram: "Telegram" }, ar: { instagram: "إنستغرام", youtube: "يوتيوب", telegram: "تيليجرام" } };
const EV = { en: { rain: "Rain", thunder: "Thunderstorm", hail: "Hail", flood: "Heavy rain", unknown: "Weather" }, ar: { rain: "مطر", thunder: "عاصفة رعدية", hail: "برَد", flood: "أمطار غزيرة", unknown: "طقس" } };
const VER = {
  en: { "officially-confirmed": "airport-confirmed", "radar-corroborated": "radar-corroborated", unverified: "unverified", conflicting: "conflicting with radar/airport" },
  ar: { "officially-confirmed": "مؤكد من المطار", "radar-corroborated": "مدعوم بالرادار", unverified: "غير مؤكد", conflicting: "يتعارض مع الرادار/المطار" },
};

// ---- candidate events ----
// Community: one event per real-world report group (already deduped across sources by the pipeline). The time shown and
// the freshness test use the OBSERVATION time when the source gives one, otherwise the publication time (labelled approx.).
export function communityEvents(groups, now = Date.now()) {
  const out = [];
  for (const g of groups || []) {
    if (!g.place || g.place.lat == null) continue;
    const observed = g.observedMs != null;
    const refMs = observed ? g.observedMs : g.publishMs;
    if (!refMs || now - refMs > COMMUNITY_FRESH_MS || refMs > now + 5 * 60000) continue;   // old or bogus-future → never "now"
    const src = (g.sources || [])[0] || {};
    out.push({
      cat: "community", key: "c:" + g.id, placeId: g.place.id, placeName: g.place.name, placeAr: g.place.ar || null,
      lat: g.place.lat, lon: g.place.lon, event: g.event || "rain", verify: g.verify || "unverified",
      source: src.source || null, account: src.account || null, sourceCount: g.sourceCount || (g.sources || []).length || 1,
      timeMs: refMs, timeKind: observed ? "observed" : "posted", groupId: g.id,
    });
  }
  return out;
}

// Radar: for each followed place, is there an echo over/near it in the latest FRESH frame? `analyse(lat, lon)` is the same
// point analysis the app uses ({status:"over"|"near"|"none"|..., nearestKm, bearing}). Stale frames yield nothing.
export function radarEvents(frame, followedPlaces, analyse, now = Date.now()) {
  if (!frame || now - frame.ms > RADAR_FRESH_MS) return [];
  const out = [], seen = new Set();
  for (const p of followedPlaces || []) {
    if (seen.has(p.id) || p.lat == null) continue; seen.add(p.id);
    const a = analyse(p.lat, p.lon);
    if (!a || (a.status !== "over" && a.status !== "near")) continue;
    out.push({ cat: "radar", key: "r:" + p.id + ":" + frame.ms, cooldownKey: "r:" + p.id + ":", placeId: p.id, placeName: p.n || p.id, placeAr: p.a || null,
      lat: p.lat, lon: p.lon, status: a.status, nearestKm: a.nearestKm, timeMs: frame.ms, timeKind: "radar" });
  }
  return out;
}

// Does this event concern one of the subscription's followed places? Radar events are per place already; community
// events match a followed place within MATCH_KM. Returns the followed place it matched (for naming), or null.
export function matchPlace(sub, ev) {
  for (const p of sub.places || []) {
    if (ev.cat === "radar") { if (p.id === ev.placeId) return p; continue; }
    if (p.id === ev.placeId) return p;
    if (p.lat != null && haversineKm(p.lat, p.lon, ev.lat, ev.lon) <= MATCH_KM) return p;
  }
  return null;
}

// ---- wording (EN / AR). Notifications never say "it is raining" — they state what was detected and by whom. ----
export function buildMessage(ev, lang = "en", followed = null) {
  const L = lang === "ar" ? "ar" : "en";
  const place = (L === "ar" && ev.placeAr) || ev.placeName;
  const near = followed && followed.id !== ev.placeId ? (L === "ar" ? ` (قرب ${followed.a || followed.n})` : ` (near ${followed.n})`) : "";
  const t = hm(ev.timeMs, L);
  let title, body;
  if (ev.cat === "radar") {
    title = L === "ar" ? `📡 صدى رادار قرب ${place}` : `📡 Radar echo near ${place}`;
    body = L === "ar" ? `إشارة هطول غير مؤكدة على الرادار · إطار ${t} · ليست تأكيدًا لمطر على الأرض` : `Unconfirmed precipitation signal · radar frame ${t} · not confirmation of rain on the ground`;
  } else if (ev.cat === "community") {
    const ev1 = EV[L][ev.event] || EV[L].unknown, src = SRC[L][ev.source] || ev.source || "";
    const acct = ev.account ? " " + ev.account : "";
    const when = ev.timeKind === "observed" ? (L === "ar" ? `رُصد ${t}` : `observed ${t}`) : (L === "ar" ? `نُشر ${t} (وقت تقريبي)` : `posted ${t} (approx. time)`);
    title = L === "ar" ? `🌧 بلاغ ${ev1} في ${place}${near}` : `🌧 ${ev1} reported in ${place}${near}`;
    body = (L === "ar" ? `عبر ${src}${acct} · ${when} · ${VER.ar[ev.verify] || VER.ar.unverified}` : `via ${src}${acct} · ${when} · ${VER.en[ev.verify] || VER.en.unverified}`)
      + (ev.sourceCount > 1 ? (L === "ar" ? ` · ${ev.sourceCount} مصادر` : ` · ${ev.sourceCount} sources`) : "");
  } else {
    title = L === "ar" ? `⚠️ تحذير رسمي: ${place}` : `⚠️ Official warning: ${place}`;
    body = ev.text || "";
  }
  const q = new URLSearchParams({ tab: "map", place: ev.placeId, lat: String(ev.lat), lon: String(ev.lon) });
  if (ev.groupId) q.set("report", ev.groupId);
  return { title, body, tag: ev.cat === "radar" ? ev.cooldownKey : ev.key, url: "/?" + q.toString(), ts: ev.timeMs, lang: L, dir: L === "ar" ? "rtl" : "ltr", cat: ev.cat };
}

// ---- plan: which (subscription, message) pairs to send this run ----
// ledger: { wasSent(subKey, key), lastSentPrefix(subKey, prefix) -> ms|0, sentSince(subKey, sinceMs) -> n }
export async function planSends(subs, events, ledger, now = Date.now()) {
  const sends = [];
  for (const sub of subs) {
    const cats = { ...DEFAULT_CATS, ...(sub.cats || {}) }, sk = subKey(sub.endpoint);
    let hour = await ledger.sentSince(sk, now - 3600e3), day = await ledger.sentSince(sk, now - 86400e3);
    // freshest first, so if the cap bites the most current event wins
    for (const ev of events.slice().sort((a, b) => b.timeMs - a.timeMs)) {
      if (!cats[ev.cat]) continue;
      const followed = matchPlace(sub, ev); if (!followed) continue;
      if (await ledger.wasSent(sk, ev.key)) continue;
      if (ev.cat === "radar" && now - (await ledger.lastSentPrefix(sk, ev.cooldownKey)) < RADAR_COOLDOWN_MS) continue;
      if (hour >= MAX_PER_HOUR || day >= MAX_PER_DAY) break;
      sends.push({ sub, subKey: sk, eventKey: ev.key, message: buildMessage(ev, sub.lang, followed) });
      hour++; day++;
      if (sends.length >= MAX_SENDS_PER_RUN) return sends;
    }
  }
  return sends;
}

// One cron run's push pass, independent of storage and network (the Worker passes the real ones in):
//   ledgerRows: push_sent rows from the last 24 h; send(sub, message, ttl) -> {ok, gone}; record(sub, subKey, eventKey, r)
//   persists the outcome (mark sent only when ok). Anything not sent stays unmarked and is re-planned next run from
//   fresh data, so a deferred or failed alert is retried only while still fresh, and never twice once delivered.
export async function runPushPass({ subs, events, ledgerRows, budget, now = Date.now(), clock = () => Date.now(), send, record }) {
  const out = { planned: 0, deferred: 0, expired: 0, ok: 0, fail: 0, errors: [] };
  if (!subs.length || !events.length) return out;
  const all = await planSends(rotateSubs(subs, now), events, ledgerFromRows(ledgerRows), now);
  out.planned = all.length;
  const plan = all.slice(0, pushAllowance(budget)); out.deferred = all.length - plan.length;
  for (const p of plan) {
    const ttl = pushTtl(p.message, clock());
    if (!ttl) { out.expired++; continue; }
    try {
      const r = await send(p.sub, p.message, ttl);
      await record(p.sub, p.subKey, p.eventKey, r);
      if (r.ok) out.ok++; else out.fail++;
    } catch (e) { out.fail++; out.errors.push(String(e.message || e).slice(0, 80)); }
  }
  return out;
}

// Validate + normalise a subscription posted by the browser. Returns null if unusable. Keeps only what delivery needs.
export function sanitizeSubscription(body) {
  const s = body && body.subscription, k = s && s.keys;
  if (!s || typeof s.endpoint !== "string" || !k || typeof k.p256dh !== "string" || typeof k.auth !== "string") return null;
  let u; try { u = new URL(s.endpoint); } catch { return null; }
  if (u.protocol !== "https:" || s.endpoint.length > 1000 || k.p256dh.length > 200 || k.auth.length > 100) return null;
  const places = (Array.isArray(body.places) ? body.places : []).slice(0, 30).map((p) => ({
    id: String(p.id || "").slice(0, 60), n: String(p.n || p.id || "").slice(0, 60), a: p.a ? String(p.a).slice(0, 60) : null,
    lat: Number(p.lat), lon: Number(p.lon),
  })).filter((p) => p.id && Number.isFinite(p.lat) && Number.isFinite(p.lon) && p.lat > 22 && p.lat < 27 && p.lon > 51 && p.lon < 57); // UAE box
  const cats = {}; for (const c of CATEGORIES) cats[c] = body.cats && typeof body.cats[c] === "boolean" ? body.cats[c] : DEFAULT_CATS[c];
  return { endpoint: s.endpoint, p256dh: k.p256dh, auth: k.auth, places, cats, lang: body.lang === "ar" ? "ar" : "en" };
}
