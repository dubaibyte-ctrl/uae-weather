// Connector framework: YouTube feed parsing, UAE-observation classification, row building. Pure, no network.
import test from "node:test";
import assert from "node:assert/strict";
import { parseYouTubeFeed, parsePlaylistItems, youtubeStormCentre, instagramStormCentre, igMediaToItems } from "../src/lib/connectors.js";
import { classifyItem, buildRows } from "../src/lib/community.js";

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">
 <entry><yt:videoId>vid_now</yt:videoId><title>الإمارات : الان هطول أمطار الخير على المدام والبداير في الوسطى للشارقة #مركز_العاصفة 15/10/2026</title><published>2026-10-15T13:57:57+00:00</published></entry>
 <entry><yt:videoId>vid_sa</yt:videoId><title>#السعودية أمطار الرحمة في #مكة_المكرمة</title><published>2026-10-14T17:30:41+00:00</published></entry>
 <entry><yt:videoId>vid_amp</yt:videoId><title>الإمارات : امطار &amp; برق على العين</title><published>2026-10-15T10:00:00+00:00</published></entry>
</feed>`;

test("parseYouTubeFeed extracts id, title, url, time; decodes entities", () => {
  const e = parseYouTubeFeed(FEED);
  assert.equal(e.length, 3);
  assert.equal(e[0].extId, "vid_now");
  assert.equal(e[0].url, "https://www.youtube.com/watch?v=vid_now");
  assert.equal(e[2].title.includes("&"), true, "decoded &amp;");
  assert.ok(e[0].publishedMs > 0);
});

test("classifyItem accepts UAE observations, rejects non-UAE / forecast / promo / old / clear-sky", () => {
  const acc = classifyItem("الإمارات : الان هطول أمطار الخير على المدام والبداير في الوسطى للشارقة");
  assert.equal(acc.accept, true);
  assert.equal(classifyItem("#السعودية أمطار في مكة المكرمة").reason, "non_uae");
  assert.equal(classifyItem("توقعات الطقs غدا في الإمارات متوقع أمطار على دبي").reason, "forecast");
  assert.equal(classifyItem("اشترك في قناة مركز العاصفة رابط الاشتراك #الامارات مطر العين").reason, "promo");
  assert.equal(classifyItem("أرشيف أمطار العام الماضي على حتا").reason, "old");
  assert.equal(classifyItem("الإمارات: غيوم على أبوظبي بدون مطر").reason, "no_observable_event");
  assert.equal(classifyItem("الإمارات: طقس صحو").reason, "no_uae_location");
});

test("buildRows makes one youtube-id row per matched area", () => {
  const rows = buildRows({ source: "youtube", extId: "vid_now", channel: "Storm Centre (YouTube)", url: "https://youtu.be/x", title: "أمطار على المدام والعين", publishedMs: 1000 });
  const ids = rows.map((r) => r.id).sort();
  assert.ok(rows.length >= 2);
  assert.ok(ids.every((id) => id.startsWith("youtube:vid_now:")));
  assert.ok(rows.every((r) => r.source === "youtube" && r.hasLocation && r.observedMs === null && r.publishMs === 1000));
});

test("youtube connector fetchItems: slices to 15, drops >48h, throws on HTTP error", async () => {
  const now = Date.now();
  const mk = (n, ageH) => `<entry><yt:videoId>v${n}</yt:videoId><title>الإمارات امطار العين ${n}</title><published>${new Date(now - ageH * 3600e3).toISOString()}</published></entry>`;
  const many = "<feed>" + Array.from({ length: 20 }, (_, i) => mk(i, i < 18 ? 1 : 72)).join("") + "</feed>";
  const okFetch = async () => ({ ok: true, text: async () => many });
  const items = await youtubeStormCentre.fetchItems(okFetch);
  assert.equal(items.length <= 15, true, "max 15");
  assert.ok(items.every((it) => now - it.publishedMs <= 48 * 3600e3), "within 48h");
  await assert.rejects(() => youtubeStormCentre.fetchItems(async () => ({ ok: false, status: 503 })), /http_503/);
});

// ---- Instagram (Business Discovery) connector: disabled without a token, parses media when enabled ----
test("igMediaToItems maps media, drops empty captions and items older than 48h", () => {
  const now = Date.parse("2026-10-28T08:00:00Z");
  const media = [
    { id: "m1", caption: "الإمارات أمطار على العين", timestamp: "2026-10-28T06:00:00+0000", permalink: "https://www.instagram.com/p/AAA/" },
    { id: "m2", caption: "", timestamp: "2026-10-28T07:00:00+0000", permalink: "https://www.instagram.com/p/BBB/" },        // no caption -> dropped
    { id: "m3", caption: "مطر على دبي", timestamp: "2026-10-20T06:00:00+0000", permalink: "https://www.instagram.com/p/CCC/" }, // >48h -> dropped
  ];
  const items = igMediaToItems(media, now);
  assert.equal(items.length, 1);
  assert.equal(items[0].extId, "ig_m1");
  assert.equal(items[0].url, "https://www.instagram.com/p/AAA/");
  assert.equal(classifyItem(items[0].title).accept, true);   // flows through the same acceptance filter
});

test("instagram connector is disabled (inert) when no token is configured", async () => {
  assert.equal(await instagramStormCentre.ready({ env: {} }), false);
  assert.equal(await instagramStormCentre.ready({ env: { IG_ACCESS_TOKEN: "tok" } }), true);
});

test("instagram connector fetchItems calls Business Discovery and normalizes media", async () => {
  const ts = new Date(Date.now() - 3600e3).toISOString().replace("Z", "+0000");
  const stub = { _c: {}, async cfgGet(k) { return this._c[k] || null; }, async cfgSet(k, v) { this._c[k] = v; return v; } };
  const f = async (url) => {
    if (url.includes("me/accounts")) return { json: async () => ({ data: [{ instagram_business_account: { id: "17841000", username: "me" } }] }) };
    if (url.includes("business_discovery")) return { json: async () => ({ business_discovery: { media: { data: [{ id: "m9", caption: "أمطار غزيرة على المسافي", timestamp: ts, permalink: "https://www.instagram.com/p/ZZZ/" }] } } }) };
    return { json: async () => ({ error: { code: 100, message: "bad" } }) };
  };
  const items = await instagramStormCentre.fetchItems({ fetch: f, env: { IG_ACCESS_TOKEN: "tok" }, stub });
  assert.equal(items.length, 1);
  assert.equal(items[0].extId, "ig_m9");
  assert.equal(stub._c["ig:userId"], "17841000");            // resolved + cached (an id, not a credential)
  assert.equal(classifyItem(items[0].title).accept, true);   // Masafi + rain accepted
});

// ---- YouTube Data API path (replaces unreliable RSS); same extId so existing reports are preserved ----
test("parsePlaylistItems maps snippet to normalized items with the bare videoId as extId", () => {
  const json = { items: [
    { snippet: { title: "الإمارات أمطار على العين", publishedAt: "2026-11-12T06:00:00Z", resourceId: { videoId: "abc123" } } },
    { snippet: { title: "no video id", publishedAt: "2026-11-12T06:00:00Z", resourceId: {} } },
  ] };
  const items = parsePlaylistItems(json, { label: "Storm Centre (YouTube)", user: "storm_ae" });
  assert.equal(items.length, 1);
  assert.equal(items[0].extId, "abc123");                               // bare id = same scheme as RSS -> dedup preserved
  assert.equal(items[0].url, "https://www.youtube.com/watch?v=abc123");
  assert.equal(items[0].channel, "Storm Centre (YouTube)");
});

test("youtube connector uses the Data API when a key is present, caching the uploads playlist id", async () => {
  const ts = new Date(Date.now() - 3600e3).toISOString();
  const stub = { _c: {}, async cfgGet(k) { return this._c[k] || null; }, async cfgSet(k, v) { this._c[k] = v; return v; } };
  let channelsCalls = 0;
  const f = async (url) => {
    if (url.includes("/channels?")) { channelsCalls++; return { json: async () => ({ items: [{ contentDetails: { relatedPlaylists: { uploads: "UU_up" } } }] }) }; }
    if (url.includes("/playlistItems?")) return { json: async () => ({ items: [{ snippet: { title: "أمطار غزيرة على المسافي", publishedAt: ts, resourceId: { videoId: "vidX" } } }] }) };
    return { ok: false, status: 404, json: async () => ({ error: { code: 404 } }) };
  };
  const items = await youtubeStormCentre.fetchItems({ fetch: f, env: { YOUTUBE_API_KEY: "KEY" }, stub });
  assert.equal(youtubeStormCentre._via, "data_api");
  assert.equal(items.length, 1);
  assert.equal(items[0].extId, "vidX");
  assert.equal(stub._c["yt:uploads:UCGLpsE0Q0m0-_jigv37CTrw"], "UU_up");  // uploads id cached (quota saving)
  // second poll reuses the cached uploads id (no extra channels.list call)
  await youtubeStormCentre.fetchItems({ fetch: f, env: { YOUTUBE_API_KEY: "KEY" }, stub });
  assert.equal(channelsCalls, 1, "channels.list called once, then cached");
});

test("youtube connector falls back to RSS when no key is configured", async () => {
  const f = async (url) => { assert.ok(url.includes("/feeds/videos.xml")); return { ok: true, text: async () => parseYouTubeFeedFixture() }; };
  const items = await youtubeStormCentre.fetchItems({ fetch: f, env: {}, stub: null });
  assert.equal(youtubeStormCentre._via, "rss");
  assert.ok(items.length >= 1);
});
function parseYouTubeFeedFixture() {
  const t = new Date(Date.now() - 3600e3).toISOString();
  return `<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"><entry><yt:videoId>rssVid</yt:videoId><title>أمطار على دبي</title><published>${t}</published></entry></feed>`;
}
