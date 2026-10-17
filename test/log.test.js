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
  assert.deepEqual(h.counts, { metar: 1, radar: 1, runs: 1 });
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
