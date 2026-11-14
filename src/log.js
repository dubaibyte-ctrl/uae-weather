// Durable Object with SQLite storage: the radar-vs-METAR validation log.
// Free-plan friendly: no external database to provision, one tiny instance.
import { DurableObject } from "cloudflare:workers";
import { score } from "./lib/score.js";
import { sendWebPush } from "./lib/webpush.js";
import { subKey } from "./lib/notify.js";

// VAPID "sub" claim: the app's own URL (RFC 8292 allows an https URL) — no personal email is sent to push services.
export const VAPID_SUBJECT = "https://uae-weather.dubaibyte.workers.dev";
const TEST_MSG = {
  en: { title: "✅ UAE Rain Explorer: test alert", body: "Background notifications work on this device. Tap to open your alerts.", lang: "en", dir: "ltr" },
  ar: { title: "✅ مطر الإمارات: تنبيه تجريبي", body: "التنبيهات تعمل على هذا الجهاز حتى والتطبيق مغلق. اضغط لفتح التنبيهات.", lang: "ar", dir: "rtl" },
};

const KEEP_DAYS = 90;
const GROUP_WINDOW_MS = 90 * 60 * 1000;   // same place + event within 90 min = one event (cross-source grouping)

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
    this.sql.exec(`CREATE TABLE IF NOT EXISTS config(k TEXT PRIMARY KEY, v TEXT)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS community(
      id TEXT PRIMARY KEY, source TEXT, channel TEXT, channel_user TEXT, msg_id INTEGER,
      text TEXT, lang TEXT, event TEXT, events TEXT,
      place_id TEXT, place_name TEXT, em TEXT, lat REAL, lon REAL,
      publish_ms INTEGER, observed_ms INTEGER, forwarded INTEGER, forward_ms INTEGER,
      url TEXT, sig TEXT, dup_of TEXT, has_location INTEGER, created_ms INTEGER, group_id TEXT)`);
    // Existing instances created the table before group_id existed; add it in place (ignored if already present).
    try { this.sql.exec("ALTER TABLE community ADD COLUMN group_id TEXT"); } catch (e) { /* column exists */ }
    // Read-budget indexes (Durable Objects free tier bills every row SCANNED): time-range queries and prunes must use an
    // index, or each one scans the whole table. Built once; IF NOT EXISTS makes later startups free.
    this.sql.exec("CREATE INDEX IF NOT EXISTS metar_obs ON metar(obs_ms)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS community_pub ON community(publish_ms)");
    // Web Push subscriptions. Only what delivery needs: the browser's push endpoint + its two encryption keys, the place ids
    // the user follows, the categories they enabled and the notification language. No IP, user agent, name or location.
    this.sql.exec(`CREATE TABLE IF NOT EXISTS push_subs(
      endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL, places TEXT, cats TEXT, lang TEXT,
      created_ms INTEGER, updated_ms INTEGER, last_ok_ms INTEGER, fail_count INTEGER DEFAULT 0)`);
    // Dedupe ledger: one row per (subscription, weather event) already notified. sub_key is a hash, not the endpoint.
    this.sql.exec(`CREATE TABLE IF NOT EXISTS push_sent(sub_key TEXT, event_key TEXT, sent_ms INTEGER, PRIMARY KEY(sub_key, event_key))`);
    this.sql.exec("CREATE INDEX IF NOT EXISTS push_sent_ms ON push_sent(sent_ms)");
  }

  // ---- Web Push subscriptions ----
  pushUpsert(s) {
    const now = Date.now(), prev = this.sql.exec("SELECT created_ms, last_ok_ms FROM push_subs WHERE endpoint=?", s.endpoint).toArray()[0];
    this.sql.exec("INSERT OR REPLACE INTO push_subs VALUES(?,?,?,?,?,?,?,?,?,?)", s.endpoint, s.p256dh, s.auth,
      JSON.stringify(s.places || []), JSON.stringify(s.cats || {}), s.lang || "en", prev ? prev.created_ms : now, now, prev ? prev.last_ok_ms : null, 0);
    return { created: !prev };
  }
  pushDelete(endpoint) { this.sql.exec("DELETE FROM push_subs WHERE endpoint=?", endpoint); return { ok: true }; }
  pushList() {
    return this.sql.exec("SELECT * FROM push_subs").toArray().map((r) => ({ endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth,
      places: JSON.parse(r.places || "[]"), cats: JSON.parse(r.cats || "{}"), lang: r.lang || "en", failCount: r.fail_count || 0, lastOkMs: r.last_ok_ms }));
  }
  pushGet(endpoint) { return this.pushList().find((s) => s.endpoint === endpoint) || null; }
  // Record a delivery outcome. Expired subscriptions (404/410) and ones failing repeatedly are removed automatically.
  pushResult(endpoint, { ok, gone }) {
    if (gone) return this.pushDelete(endpoint);
    if (ok) this.sql.exec("UPDATE push_subs SET last_ok_ms=?, fail_count=0 WHERE endpoint=?", Date.now(), endpoint);
    else {
      this.sql.exec("UPDATE push_subs SET fail_count=COALESCE(fail_count,0)+1 WHERE endpoint=?", endpoint);
      this.sql.exec("DELETE FROM push_subs WHERE endpoint=? AND fail_count>=5", endpoint);
    }
    return { ok: true };
  }
  pushWasSent(subKey, eventKey) { return !!this.sql.exec("SELECT 1 FROM push_sent WHERE sub_key=? AND event_key=?", subKey, eventKey).toArray()[0]; }
  pushMarkSent(subKey, eventKey) { this.sql.exec("INSERT OR IGNORE INTO push_sent VALUES(?,?,?)", subKey, eventKey, Date.now()); }
  pushLastSentPrefix(subKey, prefix) { const r = this.sql.exec("SELECT MAX(sent_ms) AS m FROM push_sent WHERE sub_key=? AND substr(event_key,1,?)=?", subKey, prefix.length, prefix).toArray()[0]; return (r && r.m) || 0; }
  pushSentSince(subKey, sinceMs) { return this.sql.exec("SELECT COUNT(*) AS n FROM push_sent WHERE sub_key=? AND sent_ms>?", subKey, sinceMs).toArray()[0].n; }
  pushPruneSent(olderThanMs) { this.sql.exec("DELETE FROM push_sent WHERE sent_ms<?", olderThanMs); }
  // VAPID keypair: created once and kept here (private key never leaves this object). Atomic set-if-absent so two first
  // requests can't race to different keys.
  pushVapidSetIfAbsent(v) { const cur = this.cfgGet("push:vapid"); if (cur) return { publicKey: cur.publicKey }; this.cfgSet("push:vapid", v); return { publicKey: v.publicKey }; }
  pushVapidPublic() { const v = this.cfgGet("push:vapid"); return v ? v.publicKey : null; }
  // Real background test: queue a test push for ~delay later, delivered by a Durable Object alarm through the normal Web
  // Push path — so the user can close the app first and confirm a closed-app notification arrives. One per minute.
  async pushQueueTest(endpoint, delayMs = 45000) {
    if (!this.pushGet(endpoint)) return { ok: false, error: "not_subscribed" };
    const sk = subKey(endpoint), last = this.cfgGet("push:testlast:" + sk) || 0;
    if (Date.now() - last < 60000) return { ok: false, error: "rate_limited" };
    const q = (this.cfgGet("push:testq") || []).filter((x) => x.endpoint !== endpoint);
    const due = Date.now() + Math.min(Math.max(delayMs, 15000), 120000);
    q.push({ endpoint, due }); this.cfgSet("push:testq", q); this.cfgSet("push:testlast:" + sk, Date.now());
    const cur = await this.ctx.storage.getAlarm(); if (!cur || cur > due) await this.ctx.storage.setAlarm(due);
    return { ok: true, dueMs: due };
  }
  async pushFlushTests() {
    const vapid = this.cfgGet("push:vapid"), q = this.cfgGet("push:testq") || [];
    if (!vapid || !q.length) return { sent: 0 };
    const now = Date.now(), due = q.filter((x) => x.due <= now + 2000), rest = q.filter((x) => x.due > now + 2000);
    this.cfgSet("push:testq", rest);
    let sent = 0;
    for (const x of due) {
      const sub = this.pushGet(x.endpoint); if (!sub) continue;
      const m = TEST_MSG[sub.lang === "ar" ? "ar" : "en"];
      try {
        const r = await sendWebPush(sub, { ...m, tag: "test", url: "/?tab=alerts", ts: now, cat: "test" }, { ...vapid, subject: VAPID_SUBJECT }, fetch, 600, "high");
        this.pushResult(sub.endpoint, r);
        this.cfgSet("push:lastTest", { at: now, status: r.status, ok: r.ok }); if (r.ok) sent++;
      } catch (e) { this.cfgSet("push:lastTest", { at: now, error: String(e.message || e).slice(0, 120) }); }
    }
    if (rest.length) await this.ctx.storage.setAlarm(Math.min(...rest.map((x) => x.due)));
    return { sent };
  }
  async alarm() { await this.pushFlushTests(); }
  pushStats() {
    const subs = this.sql.exec("SELECT COUNT(*) AS n FROM push_subs").toArray()[0].n;
    const sent24 = this.sql.exec("SELECT COUNT(*) AS n FROM push_sent WHERE sent_ms>?", Date.now() - 86400e3).toArray()[0].n;
    return { subscriptions: subs, sentLast24h: sent24 };
  }

  // Connector cursor/health state (not credentials) lives in config: conn:<id> -> {lastPollMs, ok, newestItemMs, lastExtId, accepted, skipped, saved, lastError}
  getConnState(id) { return this.cfgGet("conn:" + id) || null; }
  setConnState(id, st) { return this.cfgSet("conn:" + id, st); }
  connStates(ids) { return ids.map((id) => ({ id, ...(this.cfgGet("conn:" + id) || {}) })); }

  // ---- server-managed config (webhook secret, authorized chats, webhook status). Never exposed raw to the public. ----
  cfgGet(k) { const r = this.sql.exec("SELECT v FROM config WHERE k=?", k).toArray()[0]; return r ? JSON.parse(r.v) : null; }
  cfgSet(k, v) { this.sql.exec("INSERT OR REPLACE INTO config VALUES(?,?)", k, JSON.stringify(v)); return v; }
  // Trust-on-first-use: the first channel to post becomes the authorized one; after that only authorized chats are kept.
  authorizeChat(id, title) { const a = this.cfgGet("authChats") || []; if (!a.some((c) => String(c.id) === String(id))) { a.push({ id: String(id), title, ts: Date.now() }); this.cfgSet("authChats", a); } return a; }
  isAuthorized(id) { const a = this.cfgGet("authChats") || []; return a.length === 0 || a.some((c) => String(c.id) === String(id)); }

  // ---- community rain reports (Telegram etc.) ----
  // rows: already-parsed report objects. Returns {saved, duplicate, reposts}. Repost = same signature seen before.
  saveReports(rows) {
    let saved = 0, duplicate = 0, reposts = 0;
    for (const r of rows) {
      const exists = this.sql.exec("SELECT 1 FROM community WHERE id=?", r.id).toArray().length;
      if (exists) { duplicate++; continue; }
      let dupOf = null;
      if (r.sig) { const prior = this.sql.exec("SELECT id FROM community WHERE sig=? AND id<>? ORDER BY publish_ms ASC LIMIT 1", r.sig, r.id).toArray()[0]; if (prior) { dupOf = prior.id; reposts++; } }
      // Cross-source grouping: same place + same event type within GROUP_WINDOW = one real-world event, even across
      // sources (Telegram, YouTube…). A wider time gap is treated as a separate storm, never merged.
      let groupId = null;
      if (r.hasLocation && !dupOf) {
        const g = this.sql.exec(
          "SELECT group_id FROM community WHERE place_id=? AND event=? AND dup_of IS NULL AND group_id IS NOT NULL AND ABS(publish_ms-?)<=? ORDER BY ABS(publish_ms-?) ASC LIMIT 1",
          r.placeId, r.event, r.publishMs, GROUP_WINDOW_MS, r.publishMs).toArray()[0];
        groupId = g ? g.group_id : r.id;        // start a new group keyed by this row's id
      }
      this.sql.exec("INSERT INTO community VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        r.id, r.source, r.channel, r.channelUser, r.msgId, r.text, r.lang, r.event, JSON.stringify(r.events || []),
        r.placeId, r.placeName, r.em, r.lat, r.lon, r.publishMs, r.observedMs, r.forwarded ? 1 : 0, r.forwardMs,
        r.url, r.sig, dupOf, r.hasLocation ? 1 : 0, Date.now(), groupId);
      saved++;
    }
    this.sql.exec("DELETE FROM community WHERE publish_ms < ?", Date.now() - 14 * 86400e3);
    return { saved, duplicate, reposts };
  }
  communitySince(days = 2) {
    const since = Date.now() - days * 86400e3;
    return this.sql.exec("SELECT * FROM community WHERE publish_ms > ? ORDER BY publish_ms DESC LIMIT 400", since).toArray();
  }
  // All stored reports (for one-time re-parse maintenance). Bounded by the 14-day retention already enforced on writes.
  communityAll() { return this.sql.exec("SELECT * FROM community ORDER BY publish_ms DESC LIMIT 2000").toArray(); }
  deleteCommunity(id) { this.sql.exec("DELETE FROM community WHERE id=?", id); return true; }
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
    // Retention prune + table counts: once a day, not every run (each was a full-table read on the free tier).
    const day = new Date().toISOString().slice(0, 10);
    if (this.cfgGet("maint:pruneDay") !== day) {
      const cutoff = Date.now() - KEEP_DAYS * 86400e3;
      this.sql.exec("DELETE FROM metar WHERE obs_ms < ?", cutoff);
      this.sql.exec("DELETE FROM radar WHERE frame_ms < ?", cutoff);
      this.sql.exec("DELETE FROM runs WHERE at_ms < ?", cutoff);
      this.cfgSet("counts", { metar: this.sql.exec("SELECT COUNT(*) AS n FROM metar").one().n, radar: this.sql.exec("SELECT COUNT(*) AS n FROM radar").one().n,
        runs: this.sql.exec("SELECT COUNT(*) AS n FROM runs").one().n, at: Date.now() });
      this.cfgSet("maint:pruneDay", day);
    }
  }

  summary(days = 30) {
    const ck = "cache:summary:" + days, hit = this.cfgGet(ck);
    if (hit && Date.now() - hit.at < 3 * 3600e3) return hit.v;
    const v = this.summaryFresh(days); this.cfgSet(ck, { at: Date.now(), v }); return v;
  }
  summaryFresh(days = 30) {
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
    const snap = this.cfgGet("counts") || {};      // daily snapshot (see record) — avoids full-table COUNT(*) per request
    const counts = { metar: snap.metar ?? null, radar: snap.radar ?? null, runs: snap.runs ?? null, countsAt: snap.at ?? null };
    counts.scanFrames = this.sql.exec("SELECT COUNT(*) AS n FROM scanframe").one().n;
    counts.community = this.sql.exec("SELECT COUNT(*) AS n FROM community").one().n;
    const lastReport = this.sql.exec("SELECT publish_ms, channel FROM community ORDER BY publish_ms DESC LIMIT 1").toArray()[0] || null;
    const cov = this.sql.exec("SELECT saved_ms, state, share FROM coverage WHERE id=1").toArray()[0] || null;
    const lastScan = this.sql.exec("SELECT frame_ms, ok, noise, length(clusters) AS bytes FROM scanframe ORDER BY frame_ms DESC LIMIT 1").toArray()[0] || null;
    return { last, counts, coverage: cov, lastScan, lastReport };
  }
}
