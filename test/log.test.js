// Exercises the validation log (SQLite) with test fixtures: dedupe, retention, scoring.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
const { ValidationLog } = await import("../src/log.js");

function makeLog() {
  const db = new DatabaseSync(":memory:");
  const sql = { exec(q, ...b) { const s = db.prepare(q); if (/^\s*(SELECT|WITH)/i.test(q)) { const rows = s.all(...b); return { toArray: () => rows, one: () => rows[0] }; } s.run(...b); return { toArray: () => [], one: () => undefined }; } };
  return new ValidationLog({ storage: { sql } }, {});
}
const now = Date.now();
const m = (station, obsMs, wx = "", rain = 0) => ({ station, obsMs, raw: "METAR " + station, wx, rain, thunder: /TS/.test(wx) ? 1 : 0, hail: /GR/.test(wx) ? 1 : 0, temp: 30 });
const r = (station, frameMs, echo, state = "ok") => ({ frameMs, station, state, echo, alpha: echo ? 180 : 0, rgb: "1,2,3" });

test("record is idempotent and health reports the last run", () => {
  const log = makeLog();
  const payload = { metars: [m("OMDB", now - 3600e3)], radar: [r("OMDB", now - 3600e3, 0)], errors: [], at: now };
  log.record(payload); log.record(payload);
  const h = log.health();
  assert.deepEqual(h.counts, { metar: 1, radar: 1, runs: 1, scanFrames: 0, community: 0 });
  assert.equal(h.last.metar_n, 1);
  assert.deepEqual(log.knownFrames(), [now - 3600e3]);
});

test("summary scores pairs and counts unusable radar samples separately", () => {
  const log = makeLog(); const base = now - 6 * 3600e3;
  const metars = [], radar = [];
  for (let i = 0; i < 6; i++) { metars.push(m("OMFJ", base + i * 1800e3, "-RA", 1)); radar.push(r("OMFJ", base + i * 1800e3, i < 5 ? 1 : 0)); }
  metars.push(m("OMDB", base, "", 0)); radar.push(r("OMDB", base, 0));
  radar.push(r("OMAL", base, null, "http_404"));
  metars.push(m("OMRK", base + 100e3, "TSRA", 1)); radar.push(r("OMRK", base + 100e3, 1));
  log.record({ metars, radar, errors: ["x"], at: now });
  const s = log.summary(30);
  assert.deepEqual(s.matrix, { hit: 6, miss: 1, falseAlarm: 0, correctNeg: 1 });
  assert.equal(s.enough, true); assert.equal(s.pod, 0.857); assert.equal(s.far, 0);
  assert.equal(s.radarSampleStates.http_404, 1); assert.equal(s.thunderReports, 1);
  assert.ok(s.collectingSince);
});

test("old rows are purged after 90 days", () => {
  const log = makeLog(); const old = now - 100 * 86400e3;
  log.record({ metars: [m("OMDB", old)], radar: [r("OMDB", old, 0)], errors: [], at: old });
  log.record({ metars: [], radar: [], errors: [], at: now });
  assert.equal(log.health().counts.metar, 0); assert.equal(log.health().counts.radar, 0);
});

test("scan frames and coverage round-trip through storage", () => {
  const log = makeLog();
  log.saveScan({ frameMs: now - 600e3, ok: [1, 1, 1, 1, 1, 0], noise: 2, errs: ["http_500"], clusters: [{ n: 5, cx: 1, cy: 2, runs: [2, 1, 5] }] }, { state: "ok", share: 0.5, errs: [], runs: [0, 0, 10] });
  log.saveScan({ frameMs: now, ok: [1, 1, 1, 1, 1, 1], noise: 0, errs: [], clusters: [] }, null);
  assert.deepEqual(log.scanKnown().sort(), [now - 600e3, now].sort());
  const s = log.loadScan(3);
  assert.equal(s.frames[0].ms, now); assert.equal(s.frames[1].clusters[0].n, 5); assert.deepEqual(s.frames[1].ok, [1, 1, 1, 1, 1, 0]);
  assert.equal(s.coverage.state, "ok"); assert.deepEqual(s.coverage.runs, [0, 0, 10]);
  assert.equal(log.health().counts.scanFrames, 2);
  log.saveScan({ frameMs: now - 9 * 3600e3, ok: [], noise: 0, errs: [], clusters: [] }, null);
  assert.equal(log.scanKnown().includes(now - 9 * 3600e3), false, "frames older than 4 h are purged on save");
});

test("community reports: insert, dedupe by id, repost detection by signature, retention", () => {
  const log = makeLog();
  const base = { source: "telegram", channel: "Test", channelUser: "test_ch", text: "rain in Mirdif", lang: "en", event: "rain", events: ["rain"], placeId: "mirdif", placeName: "Mirdif", em: "du", lat: 25.22, lon: 55.41, observedMs: now, forwarded: 0, forwardMs: null, url: "https://t.me/test_ch/1", sig: "sigA", hasLocation: true };
  let res = log.saveReports([{ ...base, id: "telegram:1:1", msgId: 1, publishMs: now }]);
  assert.deepEqual(res, { saved: 1, duplicate: 0, reposts: 0 });
  res = log.saveReports([{ ...base, id: "telegram:1:1", msgId: 1, publishMs: now }]);        // same id again
  assert.equal(res.duplicate, 1); assert.equal(res.saved, 0);
  res = log.saveReports([{ ...base, id: "telegram:1:2", msgId: 2, publishMs: now + 60000 }]); // same sig, new id = repost
  assert.equal(res.saved, 1); assert.equal(res.reposts, 1);
  const rows = log.communitySince(2);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.id === "telegram:1:2").dup_of, "telegram:1:1");
  assert.equal(log.health().counts.community, 2);
  // old report purged
  log.saveReports([{ ...base, id: "telegram:1:9", msgId: 9, publishMs: now - 20 * 86400e3, sig: "old" }]);
  assert.equal(log.communitySince(14).some((r) => r.id === "telegram:1:9"), false);
});

test("config store + trust-on-first-use channel authorization", () => {
  const log = makeLog();
  assert.equal(log.cfgGet("webhookSecret"), null);
  log.cfgSet("webhookSecret", "abc123");
  assert.equal(log.cfgGet("webhookSecret"), "abc123");
  assert.equal(log.isAuthorized("-100500"), true, "empty authChats = accept (pre-auth)");
  log.authorizeChat("-100500", "Ali Test");
  assert.equal(log.isAuthorized("-100500"), true);
  assert.equal(log.isAuthorized("-100999"), false, "after first channel authorized, others rejected");
  log.authorizeChat("-100500", "Ali Test");                 // idempotent
  assert.equal((log.cfgGet("authChats") || []).length, 1);
  log.cfgSet("authChats", []);
  assert.equal(log.isAuthorized("-100999"), true, "reset re-opens trust-on-first-use");
});

test("cross-source grouping: same place+event within window shares group_id; a later storm does not", () => {
  const log = makeLog();
  const row = (id, source, placeId, event, publishMs) => ({ id, source, channel: source, channelUser: null, msgId: null, text: "rain " + placeId, lang: "ar", event, events: [event], placeId, placeName: placeId, em: "du", lat: 25, lon: 55, publishMs, observedMs: null, forwarded: 0, forwardMs: null, url: "u/" + id, sig: "sig-" + id, hasLocation: true });
  const base = now;
  log.saveReports([row("telegram:1:hatta", "telegram", "hatta", "rain", base)]);
  log.saveReports([row("youtube:v1:hatta", "youtube", "hatta", "rain", base + 10 * 60000)]);   // +10 min, same place+event
  log.saveReports([row("youtube:v2:hatta", "youtube", "hatta", "rain", base + 5 * 3600e3)]);    // +5 h = separate storm
  const rows = log.communitySince(2);
  const g = (id) => rows.find((r) => r.id === id).group_id;
  assert.equal(g("telegram:1:hatta"), g("youtube:v1:hatta"), "same event grouped across sources");
  assert.notEqual(g("telegram:1:hatta"), g("youtube:v2:hatta"), "separate storm not merged");
});

test("connector state round-trips", () => {
  const log = makeLog();
  assert.equal(log.getConnState("youtube:storm_centre"), null);
  log.setConnState("youtube:storm_centre", { ok: true, accepted: 3, skipped: 2 });
  assert.deepEqual(log.connStates(["youtube:storm_centre"])[0], { id: "youtube:storm_centre", ok: true, accepted: 3, skipped: 2 });
});
