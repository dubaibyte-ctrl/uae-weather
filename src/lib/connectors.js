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
  async fetchItems(f = fetch) {
    const r = await f(YT_FEED("UCGLpsE0Q0m0-_jigv37CTrw"), { headers: UA });
    if (!r.ok) throw new Error("http_" + r.status);
    const entries = parseYouTubeFeed(await r.text());
    const now = Date.now();
    return entries.slice(0, this.maxItems).filter((e) => now - e.publishedMs <= this.maxAgeMs);
  },
};

export const PULL_CONNECTORS = [youtubeStormCentre];
