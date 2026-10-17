// Durable Object with SQLite storage: the radar-vs-METAR validation log.
// Free-plan friendly: no external database to provision, one tiny instance.
import { DurableObject } from "cloudflare:workers";
import { score } from "./lib/score.js";

const KEEP_DAYS = 90;

export class ValidationLog extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS metar(
      station TEXT NOT NULL, obs_ms INTEGER NOT NULL, raw TEXT, wx TEXT, rain INTEGER, thunder INTEGER, hail INTEGER, temp REAL,
      PRIMARY KEY(station, obs_ms))`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS radar(
      frame_ms INTEGER NOT NULL, station TEXT NOT NULL, state TEXT, echo INTEGER, alpha INTEGER, rgb TEXT,
      PRIMARY KEY(frame_ms, station))`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS runs(at_ms INTEGER PRIMARY KEY, metar_n INTEGER, frames_n INTEGER, errors TEXT)`);
  }

  knownFrames() {
    const since = Date.now() - 6 * 3600e3;
    return this.sql.exec("SELECT DISTINCT frame_ms FROM radar WHERE frame_ms > ?", since).toArray().map((r) => r.frame_ms);
  }

  record({ metars, radar, errors, at }) {
    for (const m of metars)
      this.sql.exec("INSERT OR IGNORE INTO metar VALUES(?,?,?,?,?,?,?,?)", m.station, m.obsMs, m.raw, m.wx, m.rain, m.thunder, m.hail, m.temp);
    for (const r of radar)
      this.sql.exec("INSERT OR IGNORE INTO radar VALUES(?,?,?,?,?,?)", r.frameMs, r.station, r.state, r.echo, r.alpha, r.rgb);
    this.sql.exec("INSERT OR REPLACE INTO runs VALUES(?,?,?,?)", at, metars.length, new Set(radar.map((r) => r.frameMs)).size, errors.join(" | "));
    const cutoff = Date.now() - KEEP_DAYS * 86400e3;
    this.sql.exec("DELETE FROM metar WHERE obs_ms < ?", cutoff);
    this.sql.exec("DELETE FROM radar WHERE frame_ms < ?", cutoff);
    this.sql.exec("DELETE FROM runs WHERE at_ms < ?", cutoff);
  }

  summary(days = 30) {
    const since = Date.now() - days * 86400e3;
    const metars = this.sql.exec("SELECT station, obs_ms AS obsMs, wx, rain, thunder, hail FROM metar WHERE obs_ms > ?", since).toArray();
    const radar = this.sql.exec("SELECT frame_ms AS frameMs, station, state, echo, alpha FROM radar WHERE frame_ms > ?", since).toArray();
    const first = this.sql.exec("SELECT MIN(at_ms) AS t FROM runs").one().t;
    const states = {};
    for (const r of radar) states[r.state] = (states[r.state] || 0) + 1;
    const out = score(metars, radar);
    return {
      days, collectingSince: first, metarReports: metars.length, radarSamples: radar.length,
      radarSampleStates: states, thunderReports: metars.filter((m) => m.thunder).length, hailReports: metars.filter((m) => m.hail).length,
      ...out,
    };
  }

  health() {
    const last = this.sql.exec("SELECT at_ms, metar_n, frames_n, errors FROM runs ORDER BY at_ms DESC LIMIT 1").toArray()[0] || null;
    const counts = {
      metar: this.sql.exec("SELECT COUNT(*) AS n FROM metar").one().n,
      radar: this.sql.exec("SELECT COUNT(*) AS n FROM radar").one().n,
      runs: this.sql.exec("SELECT COUNT(*) AS n FROM runs").one().n,
    };
    return { last, counts };
  }
}
