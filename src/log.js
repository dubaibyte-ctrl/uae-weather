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
    this.sql.exec(`CREATE TABLE IF NOT EXISTS scanframe(frame_ms INTEGER PRIMARY KEY, saved_ms INTEGER, ok TEXT, noise INTEGER, errs TEXT, clusters TEXT)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS coverage(id INTEGER PRIMARY KEY, saved_ms INTEGER, state TEXT, share REAL, errs TEXT, runs TEXT)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS runs(at_ms INTEGER PRIMARY KEY, metar_n INTEGER, frames_n INTEGER, errors TEXT)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS community(
      id TEXT PRIMARY KEY, source TEXT, channel TEXT, channel_user TEXT, msg_id INTEGER,
      text TEXT, lang TEXT, event TEXT, events TEXT,
      place_id TEXT, place_name TEXT, em TEXT, lat REAL, lon REAL,
      publish_ms INTEGER, observed_ms INTEGER, forwarded INTEGER, forward_ms INTEGER,
      url TEXT, sig TEXT, dup_of TEXT, has_location INTEGER, created_ms INTEGER)`);
  }

  // ---- community rain reports (Telegram etc.) ----
  // rows: already-parsed report objects. Returns {saved, duplicate, reposts}. Repost = same signature seen before.
  saveReports(rows) {
    let saved = 0, duplicate = 0, reposts = 0;
    for (const r of rows) {
      const exists = this.sql.exec("SELECT 1 FROM community WHERE id=?", r.id).toArray().length;
      if (exists) { duplicate++; continue; }
      let dupOf = null;
      if (r.sig) { const prior = this.sql.exec("SELECT id FROM community WHERE sig=? AND id<>? ORDER BY publish_ms ASC LIMIT 1", r.sig, r.id).toArray()[0]; if (prior) { dupOf = prior.id; reposts++; } }
      this.sql.exec("INSERT INTO community VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        r.id, r.source, r.channel, r.channelUser, r.msgId, r.text, r.lang, r.event, JSON.stringify(r.events || []),
        r.placeId, r.placeName, r.em, r.lat, r.lon, r.publishMs, r.observedMs, r.forwarded ? 1 : 0, r.forwardMs,
        r.url, r.sig, dupOf, r.hasLocation ? 1 : 0, Date.now());
      saved++;
    }
    this.sql.exec("DELETE FROM community WHERE publish_ms < ?", Date.now() - 14 * 86400e3);
    return { saved, duplicate, reposts };
  }
  communitySince(days = 2) {
    const since = Date.now() - days * 86400e3;
    return this.sql.exec("SELECT * FROM community WHERE publish_ms > ? ORDER BY publish_ms DESC LIMIT 400", since).toArray();
  }
  metarsSince(ms) { return this.sql.exec("SELECT station, obs_ms AS obsMs, rain, thunder FROM metar WHERE obs_ms > ?", ms).toArray(); }

  knownFrames() {
    const since = Date.now() - 6 * 3600e3;
    return this.sql.exec("SELECT DISTINCT frame_ms FROM radar WHERE frame_ms > ?", since).toArray().map((r) => r.frame_ms);
  }

  // ---- radar scan (whole-UAE echo clusters) ----
  scanKnown() { return this.sql.exec("SELECT frame_ms FROM scanframe").toArray().map((r) => r.frame_ms); }
  coverageAge() { const r = this.sql.exec("SELECT saved_ms, state FROM coverage WHERE id=1").toArray()[0]; return r ? { savedMs: r.saved_ms, state: r.state } : null; }
  saveScan(fr, cov) {
    if (fr) this.sql.exec("INSERT OR REPLACE INTO scanframe VALUES(?,?,?,?,?,?)", fr.frameMs, Date.now(), JSON.stringify(fr.ok), fr.noise, (fr.errs || []).join(" | "), JSON.stringify(fr.clusters));
    if (cov) this.sql.exec("INSERT OR REPLACE INTO coverage VALUES(1,?,?,?,?,?)", Date.now(), cov.state, cov.share, (cov.errs || []).join(" | "), JSON.stringify(cov.runs));
    this.sql.exec("DELETE FROM scanframe WHERE frame_ms < ?", Date.now() - 4 * 3600e3);
  }
  loadScan(limit = 3) {
    const frames = this.sql.exec("SELECT frame_ms, saved_ms, ok, noise, errs, clusters FROM scanframe ORDER BY frame_ms DESC LIMIT ?", limit).toArray()
      .map((r) => ({ ms: r.frame_ms, savedMs: r.saved_ms, ok: JSON.parse(r.ok), noise: r.noise, errs: r.errs, clusters: JSON.parse(r.clusters) }));
    const c = this.sql.exec("SELECT saved_ms, state, share, errs, runs FROM coverage WHERE id=1").toArray()[0];
    return { frames, coverage: c ? { savedMs: c.saved_ms, state: c.state, share: c.share, errs: c.errs, runs: JSON.parse(c.runs) } : null };
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

  // Scan problems happen after record(); append them to the run's error text so /api/health shows them.
  noteErrors(at, errors) { this.sql.exec("UPDATE runs SET errors = ? WHERE at_ms = ?", errors.join(" | "), at); }

  health() {
    const last = this.sql.exec("SELECT at_ms, metar_n, frames_n, errors FROM runs ORDER BY at_ms DESC LIMIT 1").toArray()[0] || null;
    const counts = {
      metar: this.sql.exec("SELECT COUNT(*) AS n FROM metar").one().n,
      radar: this.sql.exec("SELECT COUNT(*) AS n FROM radar").one().n,
      runs: this.sql.exec("SELECT COUNT(*) AS n FROM runs").one().n,
    };
    counts.scanFrames = this.sql.exec("SELECT COUNT(*) AS n FROM scanframe").one().n;
    counts.community = this.sql.exec("SELECT COUNT(*) AS n FROM community").one().n;
    const lastReport = this.sql.exec("SELECT publish_ms, channel FROM community ORDER BY publish_ms DESC LIMIT 1").toArray()[0] || null;
    const cov = this.sql.exec("SELECT saved_ms, state, share FROM coverage WHERE id=1").toArray()[0] || null;
    const lastScan = this.sql.exec("SELECT frame_ms, ok, noise, length(clusters) AS bytes FROM scanframe ORDER BY frame_ms DESC LIMIT 1").toArray()[0] || null;
    return { last, counts, coverage: cov, lastScan, lastReport };
  }
}
