// Pull-based public source connectors. Each connector fetches recent public items and returns a normalized list
// { extId, title, url, publishedMs }. The Worker runs them on the existing cron, isolated (one failure never
// affects Telegram, radar, METAR or other connectors), classifies each item, and feeds accepted ones through the
// same parser / verifier / Community pipeline. No credentials here — these are public, credential-free feeds.

const YT_FEED = (channelId) => `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
const UA = { "user-agent": "uae-weather-personal/1.0 (+personal weather app)" };

function decodeXml(s) {
  return (s || "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

// Parse a YouTube channel RSS (Atom) feed into entries. Pure, so it is unit-tested with a fixture.
export function parseYouTubeFeed(xml) {
  const out = [];
  const blocks = String(xml || "").split("<entry>").slice(1);
  for (const b of blocks) {
    const vid = (b.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1];
    const titleRaw = (b.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
    const pub = (b.match(/<published>([^<]+)<\/published>/) || [])[1];
    if (!vid || !titleRaw || !pub) continue;
    const publishedMs = Date.parse(pub);
    if (!publishedMs) continue;
    out.push({ extId: vid, title: decodeXml(titleRaw).trim(), url: `https://www.youtube.com/watch?v=${vid}`, publishedMs });
  }
  return out;
}

// Storm Centre (مركز العاصفة) YouTube channel. Free RSS, no credentials.
export const youtubeStormCentre = {
  id: "youtube:storm_centre",
  source: "youtube",
  channel: "Storm Centre (YouTube)",
  channelUser: "storm_ae",
  maxItems: 15,
  maxAgeMs: 48 * 3600e3,
  // ctx = { fetch, env, stub }; a bare fetch function is also accepted (back-compat with tests).
  async fetchItems(ctx = {}) {
    const f = typeof ctx === "function" ? ctx : ctx.fetch || fetch;
    const r = await f(YT_FEED("UCGLpsE0Q0m0-_jigv37CTrw"), { headers: UA });
    if (!r.ok) throw new Error("http_" + r.status);
    const entries = parseYouTubeFeed(await r.text());
    const now = Date.now();
    return entries.slice(0, this.maxItems).filter((e) => now - e.publishedMs <= this.maxAgeMs);
  },
};

// ---- Storm Centre Instagram via Meta Business Discovery (Facebook Login path). DISABLED until authorized. ----
// Credentials are NEVER in code or the Durable Object. The access token is read from a Cloudflare secret binding
// (env.IG_ACCESS_TOKEN — a Secrets Store binding declared in wrangler.jsonc, or a plain secret). With no token the
// connector reports enabled:false and is skipped. The app owner's own IG Business user-id is resolved from the token
// and cached in config (an id, not a credential). Business Discovery reads @storm_ae's public media by username.
const GRAPH = "https://graph.facebook.com/v21.0";
const IG_TARGET = "storm_ae";

export async function igToken(env) {
  const b = env && env.IG_ACCESS_TOKEN;
  if (!b) return null;
  if (typeof b === "string") return b || null;
  if (typeof b.get === "function") { try { return (await b.get()) || null; } catch { return null; } }
  return null;
}
async function igUserId(env, stub, token, f) {
  let id = stub ? await stub.cfgGet("ig:userId") : null;
  if (id) return id;
  const r = await f(`${GRAPH}/me/accounts?fields=instagram_business_account{id,username}&access_token=${encodeURIComponent(token)}`);
  const j = await r.json();
  if (j.error) throw new Error("ig_me_" + (j.error.code || "err"));
  const acct = (j.data || []).map((p) => p.instagram_business_account).find(Boolean);
  id = acct && acct.id;
  if (id && stub) await stub.cfgSet("ig:userId", id);
  return id || null;
}
// Pure: turn a Business Discovery media list into normalized items. Unit-tested with a fixture.
export function igMediaToItems(media, now = Date.now(), maxAgeMs = 48 * 3600e3, maxItems = 15) {
  return (media || [])
    .map((m) => ({ extId: "ig_" + m.id, title: (m.caption || "").trim(), url: m.permalink, publishedMs: Date.parse(m.timestamp) }))
    .filter((m) => m.title && m.url && m.publishedMs && now - m.publishedMs <= maxAgeMs)
    .slice(0, maxItems);
}

export const instagramStormCentre = {
  id: "instagram:storm_ae",
  source: "instagram",
  channel: "Storm Centre (Instagram)",
  channelUser: IG_TARGET,
  requiresToken: true,
  maxItems: 15,
  maxAgeMs: 48 * 3600e3,
  async ready(ctx = {}) { return !!(await igToken(ctx.env)); },
  async fetchItems(ctx = {}) {
    const f = ctx.fetch || fetch, env = ctx.env, stub = ctx.stub;
    const token = await igToken(env);
    if (!token) throw new Error("disabled_no_token");
    const uid = await igUserId(env, stub, token, f);
    if (!uid) throw new Error("no_ig_user_id");
    const fields = `business_discovery.username(${IG_TARGET}){media.limit(${this.maxItems}){id,caption,timestamp,permalink,media_type}}`;
    const url = `${GRAPH}/${uid}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`;
    const r = await f(url, { headers: UA });
    const j = await r.json();
    if (j.error) throw new Error("ig_" + (j.error.code || "err") + ":" + String(j.error.message || "").slice(0, 50));
    return igMediaToItems(((j.business_discovery || {}).media || {}).data || [], Date.now(), this.maxAgeMs, this.maxItems);
  },
};

export const PULL_CONNECTORS = [youtubeStormCentre, instagramStormCentre];
