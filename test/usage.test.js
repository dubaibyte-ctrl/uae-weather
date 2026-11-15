// Opt 3: app-side usage meter, economy mode and once-a-day warning, on a SQLite shim that reports rows like workerd.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
const { ValidationLog, FREE_ROWS_READ } = await import("../src/log.js");

function makeLog() {
  const db = new DatabaseSync(":memory:");
  const sql = { exec(q, ...b) { const s = db.prepare(q);
    if (/^\s*(SELECT|WITH|EXPLAIN)/i.test(q)) { const rows = s.all(...b); return { toArray: () => rows, one: () => rows[0], rowsRead: rows.length, rowsWritten: 0 }; }
    const r = s.run(...b); return { toArray: () => [], one: () => undefined, rowsRead: 0, rowsWritten: Number(r.changes || 0) }; } };
  return new ValidationLog({ storage: { sql } }, {});
}
const day = () => new Date().toISOString().slice(0, 10);

test("meter sums rows read/written into today's usage row", () => {
  const log = makeLog();
  for (let i = 0; i < 5; i++) log.cfgSet("x" + i, i);           // 5 writes
  for (let i = 0; i < 5; i++) log.cfgGet("x" + i);              // 5 reads of 1 row
  const u = log.usage();
  assert.equal(u.day, day());
  assert.ok(u.rowsWritten >= 5, "writes counted");
  assert.ok(u.rowsRead >= 5, "reads counted");
  assert.equal(u.level, "normal");
});

test("levels: 60% -> economy, 80% -> warn (rows read or written)", () => {
  const log = makeLog(); log.usage();
  const set = (r, w) => log._raw.exec("INSERT OR REPLACE INTO config VALUES(?,?)", "usage:" + day(), JSON.stringify({ rowsRead: r, rowsWritten: w, since: Date.now() }));
  set(0.59 * FREE_ROWS_READ, 0); assert.equal(log.usage().level, "normal");
  set(0.61 * FREE_ROWS_READ, 0); assert.equal(log.usage().level, "economy");
  set(0.81 * FREE_ROWS_READ, 0); assert.equal(log.usage().level, "warn");
  set(0, 85000); assert.equal(log.usage().level, "warn");        // writes limit 100k
});

test("economy: cached summary served past its 3 h age; snapshot served instead of live recompute", () => {
  const log = makeLog();
  log.cfgSet("cache:summary:30", { at: Date.now() - 5 * 3600e3, v: { cached: true } });
  log.cfgSet("snapshot:v1", { generatedAt: 1, scan: { frames: [] } });
  assert.notDeepEqual(log.summary(30), { cached: true }, "normal mode recomputes an expired cache");
  assert.equal(log.economySnapshot("snapshot:v1"), null);
  log.cfgSet("cache:summary:30", { at: Date.now() - 5 * 3600e3, v: { cached: true } });
  log._raw.exec("INSERT OR REPLACE INTO config VALUES(?,?)", "usage:" + day(), JSON.stringify({ rowsRead: 0.7 * FREE_ROWS_READ, rowsWritten: 0 }));
  assert.deepEqual(log.summary(30), { cached: true });
  assert.equal(log.economySnapshot("snapshot:v1").generatedAt, 1);
});

test("warning fires once per UTC day per level", () => {
  const log = makeLog();
  assert.equal(log.usageWarnOnce("warn"), true);
  assert.equal(log.usageWarnOnce("warn"), false);
});
