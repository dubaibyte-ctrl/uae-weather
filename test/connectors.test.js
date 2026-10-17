// Connector framework: YouTube feed parsing, UAE-observation classification, row building. Pure, no network.
import test from "node:test";
import assert from "node:assert/strict";
import { parseYouTubeFeed, youtubeStormCentre } from "../src/lib/connectors.js";
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
