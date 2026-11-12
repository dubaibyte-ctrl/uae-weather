// Pull-based public source connectors. Each connector fetches recent public items and returns a normalized list
// { extId, title, url, publishedMs, channel?, channelUser? }. The Worker runs them on the existing cron, isolated
// (one failure never affects Telegram, radar, METAR or other connectors), classifies each item, and feeds accepted
// ones through the SAME parser / verifier / Community pipeline. extId is the bare YouTube videoId / "ig_"+mediaId so
// report ids stay identical across the RSS→Data-API switch — previously collected reports are preserved, not re-saved.

const UA = { "user-agent": "uae-weather-personal/1.0 (+personal weather app)" };
const YT_FEED = (channelId) => `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
const YT_API = "https://www.googleapis.com/youtube/v3";

// ---- configurable source registries (add channels / usernames here; no code change elsewhere) ----
// Every source carries explicit platform metadata so links are built from the metadata, never by assuming Telegram:
//   platform    — "youtube" | "instagram" | "telegram"
//   displayName — human label shown in the UI
//   account     — the account/channel identifier on that platform (YouTube @handle, IG username)
//   channelId   — YouTube channel id (uploads come from here)
//   canonicalUrl— the source's own channel/profile page
// Verified 2026-11-12 from the channel's own About page: the YouTube channel "مركز العاصفة" (Storm Centre),
// handle @storm_ae, id UCGLpsE0Q0m0-_jigv37CTrw, owner Khaled Alghafli, lists its OFFICIAL Instagram as @storm.center
// (NOT @storm_ae — @storm_ae is the YouTube handle). They are treated as distinct sources of the same brand.
export const YT_CHANNELS = [
  { platform: "youtube", channelId: "UCGLpsE0Q0m0-_jigv37CTrw", account: "storm_ae", user: "storm_ae",
    label: "Storm Centre (YouTube)", displayName: "Storm Centre (YouTube)",
    canonicalUrl: "https://www.youtube.com/channel/UCGLpsE0Q0m0-_jigv37CTrw" },
  // add more UAE weather YouTube channels here as provided
];
export const IG_USERNAMES = [
  { platform: "instagram", account: "storm.center", user: "storm.center",
    label: "Storm Centre (Instagram)", displayName: "Storm Centre (Instagram)",
    canonicalUrl: "https://www.instagram.com/storm.center/" },
  // add more public Business/Creator usernames here as provided
];

// Build a source's canonical channel/profile URL from its platform + identifier. Platform-aware: a YouTube @handle
// never becomes a t.me link. Returns null when there is no public page (e.g. a private Telegram channel).
export function canonicalChannelUrl(platform, identifier) {
  if (!identifier) return null;
  const id = String(identifier).replace(/^@/, "");
  if (platform === "youtube") return id.startsWith("UC") ? `https://www.youtube.com/channel/${id}` : `https://www.youtube.com/@${id}`;
  if (platform === "instagram") return `https://www.instagram.com/${id}/`;
  if (platform === "telegram") return `https://t.me/${id}`;
  return null;
}

function decodeXml(s) {
  return (s || "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
// Read a credential from a Cloudflare Secrets Store binding (.get()) or a plain secret string. Never from code/DO.
async function readSecret(b) {
  if (!b) return null;
  if (typeof b === "string") return b || null;
  if (typeof b.get === "function") { try { return (await b.get()) || null; } catch { return null; } }
  return null;
}
export const ytApiKey = (env) => readSecret(env && env.YOUTUBE_API_KEY);
export const igToken = (env) => readSecret(env && env.IG_ACCESS_TOKEN);

/* ============================ YouTube ============================ */

// Parse a YouTube channel RSS (Atom) feed into entries. Pure, unit-tested with a fixture. (Fallback path.)
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

// Parse a YouTube Data API playlistItems response. Pure, unit-tested. publishedAt is the PUBLICATION time.
export function parsePlaylistItems(json, ch) {
  return ((json && json.items) || []).map((it) => {
    const s = it.snippet || {};
    const vid = s.resourceId && s.resourceId.videoId;
    const publishedMs = Date.parse(s.publishedAt);
    if (!vid || !publishedMs) return null;
    return { extId: vid, title: (s.title || "").trim(), url: `https://www.youtube.com/watch?v=${vid}`, publishedMs, channel: ch.label, channelUser: ch.user };
  }).filter(Boolean);
}

// Resolve + cache a channel's uploads playlist id (channels.list = 1 unit, cached in config so it isn't spent each poll).
async function uploadsPlaylistId(ch, key, f, stub) {
  const cacheKey = "yt:uploads:" + ch.channelId;
  let pid = stub ? await stub.cfgGet(cacheKey) : null;
  if (pid) return pid;
  const r = await f(`${YT_API}/channels?part=contentDetails&id=${ch.channelId}&key=${encodeURIComponent(key)}`, { headers: UA });
  const j = await r.json();
  if (j.error) throw new Error("yt_api_" + (j.error.code || "err"));
  pid = j.items && j.items[0] && j.items[0].contentDetails && j.items[0].contentDetails.relatedPlaylists && j.items[0].contentDetails.relatedPlaylists.uploads;
  if (pid && stub) await stub.cfgSet(cacheKey, pid);
  return pid || null;
}
async function ytViaDataApi(ch, key, f, stub, maxItems) {
  const pid = await uploadsPlaylistId(ch, key, f, stub);
  if (!pid) throw new Error("no_uploads_playlist");
  const r = await f(`${YT_API}/playlistItems?part=snippet&maxResults=${maxItems}&playlistId=${pid}&key=${encodeURIComponent(key)}`, { headers: UA });
  const j = await r.json();
  if (j.error) throw new Error("yt_api_" + (j.error.code || "err"));
  return parsePlaylistItems(j, ch);
}
async function ytViaRss(ch, f) {
  const r = await f(YT_FEED(ch.channelId), { headers: UA });
  if (!r.ok) throw new Error("http_" + r.status);
  return parseYouTubeFeed(await r.text()).map((e) => ({ ...e, channel: ch.label, channelUser: ch.user }));
}

// Storm Centre + any other configured YouTube weather channels. Uses the official Data API when a key is present
// (reliable, quota-efficient), and falls back to the public RSS feed until a key is configured (keeps the feed alive).
export const youtubeStormCentre = {
  id: "youtube:storm_centre",
  source: "youtube",
  channel: "Storm Centre (YouTube)",
  channelUser: "storm_ae",
  maxItems: 15,
  maxAgeMs: 48 * 3600e3,
  _via: null,
  async fetchItems(ctx = {}) {
    const f = typeof ctx === "function" ? ctx : ctx.fetch || fetch;
    const env = ctx && typeof ctx === "object" ? ctx.env : null;
    const stub = ctx && typeof ctx === "object" ? ctx.stub : null;
    const key = await ytApiKey(env);
    this._via = key ? "data_api" : "rss";
    const now = Date.now(), out = [], errs = [];
    for (const ch of YT_CHANNELS) {
      try { const chItems = key ? await ytViaDataApi(ch, key, f, stub, this.maxItems) : await ytViaRss(ch, f); out.push(...chItems.slice(0, this.maxItems)); }
      catch (e) { errs.push(ch.label + ":" + String(e.message || e)); }     // per-channel isolation
    }
    if (!out.length && errs.length) throw new Error(errs[0]);               // all channels failed → surface in health
    return out.filter((e) => now - e.publishedMs <= this.maxAgeMs);
  },
};

/* ============================ Instagram (Business Discovery, disabled until authorized) ============================ */
// Current supported stable Graph API version (confirmed Nov 2026; v21.0 is ~2 years old and deprecated). Used by BOTH
// the production connector and the test endpoint so they never diverge.
export const GRAPH_VERSION = "v26.0";
const GRAPH = "https://graph.facebook.com/" + GRAPH_VERSION;
// The one public account this app is allowed to read. Server-locked — never taken from request input.
export const IG_TARGET = "storm.center";

// Every Graph call sends the token ONLY in the Authorization header — never in the URL, query string, redirect or log.
// `path` must never contain the token. Returns parsed JSON.
export async function graphGet(path, token, f, headers = {}) {
  const r = await f(GRAPH + path, { headers: { ...headers, Authorization: "Bearer " + token } });
  return r.json();
}
// Remove a token from any text so it can never leak through an error/message.
const scrubTok = (s, token) => { s = String(s == null ? "" : s); return token ? s.split(token).join("***") : s; };

// Resolve the querying IG Business/Creator account ({id, username}) from the token's Pages. Token stays in the header.
async function igResolveAccount(token, f, stub) {
  const cached = stub ? await stub.cfgGet("ig:userId") : null;
  const j = await graphGet(`/me/accounts?fields=instagram_business_account{id,username}`, token, f, UA);
  if (j.error) throw new Error("ig_me_" + (j.error.code || "err"));
  const acct = (j.data || []).map((p) => p.instagram_business_account).find(Boolean);
  if (acct && acct.id && stub && !cached) await stub.cfgSet("ig:userId", acct.id);
  return acct && acct.id ? { id: acct.id, username: acct.username || null } : null;
}

// Pure, server-locked Business Discovery. Target is ALWAYS IG_TARGET (any other username is refused). Token travels only
// in the Authorization header. Returns a SANITIZED result (never the token, the request URL or the auth header).
export async function igDiscover({ token, fetchImpl, username = IG_TARGET, maxItems = 5, stub = null }) {
  if (!token) return { ok: false, error: "A token is required." };
  if (username !== IG_TARGET) return { ok: false, error: "Target is locked to the configured account; other usernames are not allowed." };
  const f = fetchImpl || fetch;
  try {
    const acct = await igResolveAccount(token, f, stub);
    if (!acct) return { ok: false, step: "me_accounts", error: "No Instagram Business/Creator account is linked to this token's Facebook Page(s).", hint: "Link your IG Business/Creator account to a Facebook Page, then regenerate the token." };
    const fields = `business_discovery.username(${IG_TARGET}){username,media.limit(${maxItems}){id,caption,timestamp,permalink,media_type}}`;
    const j = await graphGet(`/${acct.id}?fields=${encodeURIComponent(fields)}`, token, f, UA);
    if (j.error) return { ok: false, step: "business_discovery", code: j.error.code || null, error: scrubTok(j.error.message, token), hint: "Business Discovery only reads public professional accounts. Confirm @" + IG_TARGET + " is a public Business/Creator account." };
    const bd = j.business_discovery || {};
    const media = ((bd.media || {}).data || []).map((m) => ({ id: m.id, media_type: m.media_type || null, timestamp: m.timestamp || null, permalink: m.permalink || null, captionPreview: (m.caption || "").replace(/\s+/g, " ").slice(0, 180), captionChars: (m.caption || "").length }));
    return { ok: true, queriedByIgAccount: acct.username ? "@" + acct.username : "(your linked IG business account)", target: "@" + IG_TARGET, resolvedUsername: bd.username || null, mediaCount: media.length, media, testedAt: Date.now() };
  } catch (e) { return { ok: false, error: scrubTok(e.message || e, token) }; }
}
// Pure: Business Discovery media list → normalized items. Unit-tested.
export function igMediaToItems(media, now = Date.now(), maxAgeMs = 48 * 3600e3, maxItems = 15, label = null, user = null) {
  return (media || [])
    .map((m) => ({ extId: "ig_" + m.id, title: (m.caption || "").trim(), url: m.permalink, publishedMs: Date.parse(m.timestamp), channel: label, channelUser: user }))
    .filter((m) => m.title && m.url && m.publishedMs && now - m.publishedMs <= maxAgeMs)
    .slice(0, maxItems);
}

export const instagramStormCentre = {
  id: "instagram:storm.center",
  source: "instagram",
  channel: "Storm Centre (Instagram)",
  channelUser: "storm.center",
  requiresToken: true,
  maxItems: 15,
  maxAgeMs: 48 * 3600e3,
  async ready(ctx = {}) { return !!(await igToken(ctx.env)); },
  async fetchItems(ctx = {}) {
    const f = ctx.fetch || fetch, env = ctx.env, stub = ctx.stub;
    const token = await igToken(env);
    if (!token) throw new Error("disabled_no_token");
    const resolved = await igResolveAccount(token, f, stub);
    const uid = resolved && resolved.id;
    if (!uid) throw new Error("no_ig_user_id");
    const now = Date.now(), out = [], errs = [];
    for (const acct of IG_USERNAMES) {
      try {
        const fields = `business_discovery.username(${acct.user}){media.limit(${this.maxItems}){id,caption,timestamp,permalink,media_type}}`;
        const j = await graphGet(`/${uid}?fields=${encodeURIComponent(fields)}`, token, f, UA);   // token in header, not URL
        if (j.error) throw new Error("ig_" + (j.error.code || "err"));
        out.push(...igMediaToItems(((j.business_discovery || {}).media || {}).data || [], now, this.maxAgeMs, this.maxItems, acct.label, acct.user));
      } catch (e) { errs.push(acct.user + ":" + String(e.message || e)); }
    }
    if (!out.length && errs.length) throw new Error(errs[0]);
    return out;
  },
};

export const PULL_CONNECTORS = [youtubeStormCentre, instagramStormCentre];
