// Multi-run push behaviour against the real SQLite ledger (ValidationLog) and the real planning code:
// deferral across collector runs, dedupe, freshness expiry, retry after failure, fair rotation, subrequest budget.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { communityEvents, radarEvents, runPushPass, pushAllowance, sanitizeSubscription, countingFetch, countingStub, pushTtl, subKey,
  SUBREQUEST_LIMIT, SUBREQUEST_RESERVE, INTERNAL_LIMIT, MAX_SENDS_PER_RUN, RADAR_FRESH_MS } from "../src/lib/notify.js";
const { ValidationLog } = await import("../src/log.js");

function makeLog() {
  const db = new DatabaseSync(":memory:");
  const sql = { exec(q, ...b) { const s = db.prepare(q); if (/^\s*(SELECT|WITH|EXPLAIN)/i.test(q)) { const rows = s.all(...b); return { toArray: () => rows, one: () => rows[0] }; } s.run(...b); return { toArray: () => [], one: () => undefined }; } };
  return new ValidationLog({ storage: { sql } }, {});
}
const T0 = Date.UTC(2026, 10, 15, 6, 0);                // a collector run time
const MIN = 60000;
const mirdif = { id: "mirdif", n: "Mirdif", a: "مردف", lat: 25.2244, lon: 55.4141 };
const sub = (i) => ({ subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/dev" + i, keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" } }, places: [mirdif], lang: i % 2 ? "ar" : "en" });
const group = { id: "g1", event: "rain", verify: "unverified", place: { id: "mirdif", name: "Mirdif", ar: "مردف", lat: 25.2244, lon: 55.4141 },
  publishMs: T0 - 10 * MIN, observedMs: T0 - 15 * MIN, sources: [{ source: "instagram", account: "@storm_ae" }], sourceCount: 1 };
const frame = { ms: T0 - 5 * MIN };
const over = () => ({ status: "over", nearestKm: 0 });

// One collector run's push pass, wired exactly like the Worker: events re-derived from stored data each run.
async function run(log, now, { budget = { used: 16, internal: 40 }, frameMs = frame.ms, sendImpl } = {}) {
  const subs = log.pushList();
  const events = [...communityEvents([group], now), ...radarEvents({ ms: frameMs }, subs.flatMap((s) => s.places), over, now)];
  const delivered = [];
  const send = sendImpl || (async (s, m, ttl) => { delivered.push({ ep: s.endpoint, tag: m.tag, ttl, title: m.title, body: m.body, cat: m.cat }); return { ok: true, status: 201, gone: false }; });
  const res = await runPushPass({
    subs, events, budget, now, clock: () => now, ledgerRows: log.pushLedgerRows(now - 86400e3),
    send: async (s, m, ttl) => { const r = await send(s, m, ttl); if (sendImpl && r.ok) delivered.push({ ep: s.endpoint, tag: m.tag, ttl, cat: m.cat }); return r; },
    record: async (s, sk, key, r) => { log.pushResult(s.endpoint, r); if (r.ok) log.pushMarkSentAt(sk, key, now); },
  });
  return { ...res, delivered, events: events.length };
}
function setup(n) {
  const log = makeLog();
  // test-only: mark with an explicit clock so multi-run timing is exact
  log.pushMarkSentAt = (sk, key, t) => log.sql.exec("INSERT OR IGNORE INTO push_sent VALUES(?,?,?)", sk, key, t);
  for (let i = 0; i < n; i++) log.pushUpsert(sanitizeSubscription(sub(i)));
  return log;
}

test("deferred sends persist across runs: delivered later, each (device, event) exactly once", async () => {
  const log = setup(3);
  const tight = { used: SUBREQUEST_LIMIT - SUBREQUEST_RESERVE - 2, internal: 40 };      // only 2 sends fit this run
  const r1 = await run(log, T0, { budget: tight });
  assert.equal(r1.planned, 6);                 // 3 devices x (community + radar)
  assert.equal(r1.delivered.length, 2); assert.equal(r1.deferred, 4);
  const r2 = await run(log, T0 + 10 * MIN);    // next run, normal budget: radar frame now 15 min old, still fresh
  assert.equal(r2.delivered.length, 4); assert.equal(r2.deferred, 0);
  const r3 = await run(log, T0 + 20 * MIN);    // nothing left; nothing repeated
  assert.equal(r3.delivered.length, 0);
  const all = [...r1.delivered, ...r2.delivered].map((d) => d.ep + "|" + d.cat);
  assert.equal(new Set(all).size, 6, "no duplicates across runs");
});

test("deferred radar alert expires instead of being sent late; community report still goes", async () => {
  const log = setup(1);
  const r1 = await run(log, T0, { budget: { used: SUBREQUEST_LIMIT, internal: 40 } });   // no room at all
  assert.equal(r1.delivered.length, 0); assert.equal(r1.deferred, 2);
  // next run: same radar frame is now 25 min old (> 20 min fresh window) → not an event any more
  const later = T0 + 20 * MIN;
  assert.ok(later - frame.ms > RADAR_FRESH_MS);
  const r2 = await run(log, later);
  assert.deepEqual(r2.delivered.map((d) => d.cat), ["community"]);
  assert.ok(/observed/.test(r2.delivered[0].body), "observation time is stated, never 'now'");
});

test("TTL never outlives freshness; too little freshness left → skipped, not delivered late", async () => {
  assert.equal(pushTtl({ cat: "radar", ts: T0 - 5 * MIN }, T0), 15 * 60);
  assert.equal(pushTtl({ cat: "community", ts: T0 - 15 * MIN }, T0), 105 * 60);
  assert.equal(pushTtl({ cat: "radar", ts: T0 - 19 * MIN }, T0), 0);        // 60 s left < 120 s minimum
  const log = setup(1);
  const r = await run(log, T0, { frameMs: T0 - 19 * MIN });                  // radar event exists but is nearly stale
  assert.equal(r.expired, 1);
  assert.deepEqual(r.delivered.map((d) => d.cat), ["community"]);
  assert.ok(r.delivered[0].ttl <= 105 * 60);
});

test("failed send is retried next run while fresh, then never repeated; gone endpoint is removed", async () => {
  const log = setup(2);
  const ep0 = sub(0).subscription.endpoint, ep1 = sub(1).subscription.endpoint;
  let fail = true;
  const flaky = async (s) => (s.endpoint === ep0 && fail ? { ok: false, status: 503, gone: false } : s.endpoint === ep1 ? { ok: false, status: 410, gone: true } : { ok: true, status: 201, gone: false });
  const r1 = await run(log, T0, { sendImpl: flaky });
  assert.equal(r1.delivered.length, 0); assert.equal(r1.fail, 4);
  assert.equal(log.pushList().length, 1, "410 Gone removes that device");
  assert.equal(log.pushList()[0].failCount, 2, "transient failures counted, device kept");
  fail = false;
  const r2 = await run(log, T0 + 10 * MIN, { sendImpl: flaky });
  assert.equal(r2.delivered.length, 2, "both alerts retried and delivered");
  assert.equal(log.pushList()[0].failCount, 0);
  const r3 = await run(log, T0 + 20 * MIN, { sendImpl: flaky });
  assert.equal(r3.delivered.length, 0, "not sent twice");
});

test("a short push-service outage doesn't drop a recently working device; a long-dead one is dropped", () => {
  const log = setup(1); const ep = sub(0).subscription.endpoint;
  log.pushResult(ep, { ok: true });
  for (let i = 0; i < 8; i++) log.pushResult(ep, { ok: false, gone: false });
  assert.equal(log.pushList().length, 1, "recent success → kept despite 8 failures");
  log.sql.exec("UPDATE push_subs SET last_ok_ms=?, created_ms=? WHERE endpoint=?", Date.now() - 4 * 86400e3, Date.now() - 10 * 86400e3, ep);
  log.pushResult(ep, { ok: false, gone: false });
  assert.equal(log.pushList().length, 0, "no delivery for 4 days and 5+ failures → removed");
});

test("fair rotation: with room for one send per run, different devices go first on successive runs", async () => {
  const log = setup(3);
  const one = { used: SUBREQUEST_LIMIT - SUBREQUEST_RESERVE - 1, internal: 40 };
  const got = [];
  for (let k = 0; k < 3; k++) { const r = await run(log, T0 + k * 10 * MIN, { budget: one }); got.push(r.delivered[0].ep); }
  assert.equal(new Set(got).size, 3);
});

test("ledger is one indexed read per run regardless of devices x events", () => {
  const log = setup(1);
  const plan = log.sql.exec("EXPLAIN QUERY PLAN SELECT sub_key, event_key, sent_ms FROM push_sent WHERE sent_ms>?", 0).toArray().map((r) => r.detail).join(" ");
  assert.match(plan, /USING INDEX push_sent_ms/);
});

// ---- subrequest budget accounting ----
test("every redirect hop is counted; caller-requested manual redirects are not followed", async () => {
  const hops = { "https://a/": "https://b/", "https://b/": "https://c/" };
  const fake = async (u) => ({ status: hops[u] ? 302 : 200, ok: !hops[u], headers: { get: (h) => (h === "location" ? hops[u] : null) } });
  const b = { used: 0 };
  const r = await countingFetch(b, fake)("https://a/");
  assert.equal(r.status, 200); assert.equal(b.used, 3);
  const b2 = { used: 0 };
  const r2 = await countingFetch(b2, fake)("https://a/", { redirect: "manual" });
  assert.equal(r2.status, 302); assert.equal(b2.used, 1);
  const loop = async (u) => ({ status: 302, headers: { get: () => u } });
  const b3 = { used: 0 };
  await assert.rejects(countingFetch(b3, loop)("https://x/"), /too_many_redirects/);
  assert.ok(b3.used <= 6);
});

test("Durable Object calls are counted as internal subrequests", async () => {
  const b = { used: 0, internal: 0 };
  const s = countingStub({ a: async () => 1, b: () => 2, v: 7 }, b);
  await s.a(); s.b(); s.b(); void s.v;
  assert.equal(b.internal, 3);
  // RPC stubs reject .apply — the wrapper must invoke methods directly (found running the collector in workerd)
  const rpcLike = new Proxy({}, { get: (_, k) => (k === "then" ? undefined : Object.assign((...a) => a.length, { apply() { throw new TypeError("The RPC receiver does not implement the method \"apply\"."); } })) });
  const w = countingStub(rpcLike, b);
  assert.equal(w.anything(1, 2), 2); assert.equal(w.then, undefined);
});

test("push allowance respects both the 50 external and 1,000 internal limits", () => {
  assert.equal(pushAllowance({ used: 16, internal: 40 }), MAX_SENDS_PER_RUN);
  assert.equal(pushAllowance({ used: 26, internal: 40 }), 50 - 4 - 26);
  assert.equal(pushAllowance({ used: 16, internal: INTERNAL_LIMIT - 50 - 10 }), 5);   // internal-bound: 2 calls per send
  assert.equal(pushAllowance({ used: 60, internal: 0 }), 0);
  // worst case stays within the limit including the push sends themselves
  for (const used of [0, 10, 26, 40, 46, 50]) assert.ok(used + pushAllowance({ used, internal: 0 }) <= SUBREQUEST_LIMIT - SUBREQUEST_RESERVE || pushAllowance({ used, internal: 0 }) === 0);
});

test("subKey is stable, so the ledger dedupes across runs", () => {
  assert.equal(subKey(sub(0).subscription.endpoint), subKey(sub(0).subscription.endpoint));
});
