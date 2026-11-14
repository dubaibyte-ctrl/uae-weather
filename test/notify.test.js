// Push planning rules: freshness, honest wording, matching, dedupe, cooldown, rate caps, categories. Pure; no network.
import test from "node:test";
import assert from "node:assert/strict";
import { communityEvents, radarEvents, matchPlace, buildMessage, planSends, sanitizeSubscription, subKey,
  RADAR_COOLDOWN_MS, MAX_PER_HOUR, pushAllowance, countingFetch, SUBREQUEST_LIMIT, SUBREQUEST_RESERVE, MAX_SENDS_PER_RUN } from "../src/lib/notify.js";

const NOW = Date.UTC(2026, 10, 14, 10, 0);
const mirdif = { id: "mirdif", n: "Mirdif", a: "مردف", lat: 25.2244, lon: 55.4141 };
const group = (o = {}) => ({ id: "g1", event: "rain", verify: "unverified", place: { id: "mirdif", name: "Mirdif", ar: "مردف", lat: 25.2244, lon: 55.4141 },
  publishMs: NOW - 20 * 60000, observedMs: null, sources: [{ source: "instagram", account: "@storm_ae" }], sourceCount: 1, ...o });

function memLedger() {
  const sent = [];
  return { sent, wasSent: async (s, k) => sent.some((x) => x.s === s && x.k === k), lastSentPrefix: async (s, p) => Math.max(0, ...sent.filter((x) => x.s === s && x.k.startsWith(p)).map((x) => x.t)),
    sentSince: async (s, t) => sent.filter((x) => x.s === s && x.t > t).length, mark: (s, k, t) => sent.push({ s, k, t }) };
}

test("community: old posts are never announced; future-dated junk is ignored", () => {
  assert.equal(communityEvents([group({ publishMs: NOW - 3 * 3600e3 })], NOW).length, 0, "3h-old post is not 'now'");
  assert.equal(communityEvents([group({ publishMs: NOW + 3600e3 })], NOW).length, 0);
  assert.equal(communityEvents([group()], NOW).length, 1);
});

test("community time basis: observation time when known, else publication time labelled approximate", () => {
  const [obs] = communityEvents([group({ observedMs: NOW - 30 * 60000, publishMs: NOW - 5 * 60000 })], NOW);
  assert.equal(obs.timeKind, "observed"); assert.equal(obs.timeMs, NOW - 30 * 60000);
  const [pub] = communityEvents([group()], NOW);
  assert.equal(pub.timeKind, "posted");
  assert.match(buildMessage(pub, "en").body, /posted \d\d:\d\d \(approx\. time\)/);
  assert.match(buildMessage(pub, "ar").body, /نُشر .* \(وقت تقريبي\)/);
});

test("radar: stale frames never alert; wording never claims rain on the ground", () => {
  const an = () => ({ status: "over", nearestKm: 0 });
  assert.equal(radarEvents({ ms: NOW - 45 * 60000 }, [mirdif], an, NOW).length, 0, "45-min-old frame is ignored");
  const [ev] = radarEvents({ ms: NOW - 5 * 60000 }, [mirdif], an, NOW);
  const en = buildMessage(ev, "en"), ar = buildMessage(ev, "ar");
  assert.match(en.title, /Radar echo near Mirdif/); assert.match(en.body, /Unconfirmed/); assert.match(en.body, /not confirmation of rain/);
  assert.doesNotMatch(en.title + en.body, /raining|rain now|is falling/i);
  assert.match(ar.title, /صدى رادار قرب مردف/); assert.equal(ar.dir, "rtl");
});

test("Arabic community notification carries area, source and time; tap URL opens the exact report on the map", () => {
  const [ev] = communityEvents([group()], NOW);
  const m = buildMessage(ev, "ar", mirdif);
  assert.match(m.title, /بلاغ مطر في مردف/);
  assert.match(m.body, /عبر إنستغرام @storm_ae/);
  assert.match(m.body, /غير مؤكد/);
  const u = new URL("https://x" + m.url);
  assert.equal(u.searchParams.get("tab"), "map"); assert.equal(u.searchParams.get("place"), "mirdif"); assert.equal(u.searchParams.get("report"), "g1");
  assert.equal(m.tag, "c:g1", "same-event tag lets the device replace instead of stacking");
});

test("matching: exact followed place, or within 10 km; far away does not match", () => {
  const sub = { places: [{ id: "rashidiya", n: "Rashidiya", lat: 25.225, lon: 55.3895 }] };
  const [ev] = communityEvents([group()], NOW);                 // Mirdif ~2.5 km from Rashidiya
  assert.equal(matchPlace(sub, ev).id, "rashidiya");
  assert.equal(matchPlace({ places: [{ id: "ruwais", n: "Ruwais", lat: 24.11, lon: 52.73 }] }, ev), null);
});

test("dedupe: the same event is sent to a device once; radar cooldown suppresses repeats for 3 h", async () => {
  const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/a", places: [mirdif], lang: "en" }, L = memLedger(), sk = subKey(sub.endpoint);
  const evs = communityEvents([group()], NOW);
  let plan = await planSends([sub], evs, L, NOW); assert.equal(plan.length, 1);
  L.mark(sk, plan[0].eventKey, NOW);
  assert.equal((await planSends([sub], evs, L, NOW + 60000)).length, 0, "already notified");
  const an = () => ({ status: "near", nearestKm: 4 });
  const r1 = radarEvents({ ms: NOW - 60000 }, [mirdif], an, NOW);
  plan = await planSends([sub], r1, L, NOW); assert.equal(plan.length, 1); L.mark(sk, plan[0].eventKey, NOW);
  const r2 = radarEvents({ ms: NOW + 10 * 60000 }, [mirdif], an, NOW + 11 * 60000);   // next frame, same episode
  assert.equal((await planSends([sub], r2, L, NOW + 11 * 60000)).length, 0, "cooldown");
  const r3 = radarEvents({ ms: NOW + RADAR_COOLDOWN_MS + 60000 }, [mirdif], an, NOW + RADAR_COOLDOWN_MS + 2 * 60000);
  assert.equal((await planSends([sub], r3, L, NOW + RADAR_COOLDOWN_MS + 2 * 60000)).length, 1, "new episode after cooldown");
});

test("categories: a disabled category is never sent; hourly cap prevents floods", async () => {
  const sub = { endpoint: "https://e/1", places: [mirdif], cats: { community: false, radar: true } };
  assert.equal((await planSends([sub], communityEvents([group()], NOW), memLedger(), NOW)).length, 0);
  const many = Array.from({ length: 10 }, (_, i) => group({ id: "g" + i, publishMs: NOW - i * 60000 }));
  const plan = await planSends([{ endpoint: "https://e/2", places: [mirdif] }], communityEvents(many, NOW), memLedger(), NOW);
  assert.equal(plan.length, MAX_PER_HOUR, "capped per hour");
  assert.equal(plan[0].eventKey, "c:g0", "freshest first");
});

test("sanitizeSubscription keeps only delivery data, rejects non-https/garbage, clamps places to the UAE", () => {
  assert.equal(sanitizeSubscription({ subscription: { endpoint: "http://x", keys: { p256dh: "a", auth: "b" } } }), null);
  assert.equal(sanitizeSubscription({}), null);
  const s = sanitizeSubscription({ subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/z", keys: { p256dh: "pk", auth: "au" }, expirationTime: null },
    places: [mirdif, { id: "paris", lat: 48.8, lon: 2.3 }], cats: { radar: false }, lang: "ar", ip: "1.2.3.4", ua: "Samsung" });
  assert.deepEqual(Object.keys(s).sort(), ["auth", "cats", "endpoint", "lang", "p256dh", "places"]);
  assert.deepEqual(s.places.map((p) => p.id), ["mirdif"]);
  assert.deepEqual(s.cats, { radar: false, community: true, warning: true });
  assert.equal(s.lang, "ar");
});

test("push sends never push a cron run past the free-plan subrequest limit", () => {
  assert.equal(SUBREQUEST_LIMIT, 50);
  // a typical run (~16 fetches) still allows the full per-run cap
  assert.equal(pushAllowance(16), MAX_SENDS_PER_RUN);
  // worst case before pushes (3 new radar frames + scan + YouTube/Instagram cache misses + Telegram): 26 used
  assert.equal(26 + pushAllowance(26) + SUBREQUEST_RESERVE <= SUBREQUEST_LIMIT, true);
  assert.equal(pushAllowance(26), 50 - 26 - SUBREQUEST_RESERVE);
  // exhausted budget → no sends this run (they stay unmarked in the ledger and retry next run)
  assert.equal(pushAllowance(48), 0);
  assert.equal(pushAllowance(80), 0);
});

test("countingFetch counts every outbound call, including failures", async () => {
  const budget = { used: 0 };
  const f = countingFetch(budget, async (u) => { if (String(u).includes("bad")) throw new Error("x"); return { ok: true }; });
  await f("https://a"); await f("https://b"); await f("https://bad").catch(() => {});
  assert.equal(budget.used, 3);
});
