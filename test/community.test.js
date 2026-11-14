// Community report parsing, signatures, and verification. Pure functions; no network.
import test from "node:test";
import assert from "node:assert/strict";
import { extractReport, reportSignature, verifyReport, normAr, classifyItem, buildRows, eventBody } from "../src/lib/community.js";
import { llToMosaic, GRID } from "../public/lib/radar-geo.js";

// The real @storm.center captions that caused the Nov-13 false-positive incident: a post about rain in SAUDI ARABIA
// (Taif / Souq Okaz) with a promotional hashtag block tagging every Gulf emirate. These must NOT become UAE rain pins.
const IG_SAUDI_1 = "#السعودية 🇸🇦 من امطار وسبول سوق عكاظ #الطائف \nتصوير برق الطائف #مركز_العاصفة_طقس_الخليج \n.\n.\n.\n.\n.\n#السعودية #الامارات الكويت سلطنة_عمان البحرين العراق الاردن مصر مركز_العاصفة ابوظبي مركز_العاصفة_طقس_الخليج دبي العين الشارقة عجمان الفجيرة راس_الخيمة سناب شات EAi";
const IG_SAUDI_2 = "لقطات من امطار #السعودية 🇸🇦 #مركز_العاصفة_طقس_الخليج \n.\n.\n.\n.\n#السعودية #الامارات #الكويت سلطنة_عمان البحرين العراق الاردن مصر مركز_العاصفة ابوظبي مركز_العاصفة_طقس_الخليج دبي العين الشارقة عجمان الفجيرة راس_الخيمة سناب شات EAi";

test("IG promo-hashtag incident: Saudi-rain posts with all-Gulf hashtag blocks are rejected, never pinned in the UAE", () => {
  for (const cap of [IG_SAUDI_1, IG_SAUDI_2]) {
    const c = classifyItem(cap);
    assert.equal(c.accept, false, "a Saudi-rain post must not be accepted as a UAE report");
    assert.equal(c.reason, "non_uae", "rejected because the event is in a non-UAE country");
    assert.equal(buildRows({ source: "instagram", extId: "x", channel: "IG", title: cap, publishedMs: 1 }).length, 0, "zero UAE pins");
  }
});

test("eventBody isolates the caption body from the promotional hashtag/dot tail", () => {
  const body = eventBody(IG_SAUDI_1);
  assert.ok(body.includes("الطائف"), "keeps the real event text");
  assert.ok(!/راس_الخيمه|راس_الخيمة/.test(normAr(body) + body), "drops the trailing all-emirates hashtag block");
});

test("foreign exclusion uses event context, not blanket country-name rejection", () => {
  // A UAE city named in the body is kept even when a foreign country also appears; only the UAE place is pinned.
  const c = classifyItem("أمطار غزيرة الآن على مليحة بينما تمطر #السعودية أيضا");
  assert.equal(c.accept, true);
  assert.deepEqual(buildRows({ source: "instagram", extId: "y", channel: "IG", title: "أمطار غزيرة الآن على مليحة بينما تمطر #السعودية أيضا", publishedMs: 1 }).map((r) => r.placeId), ["mleiha"]);
});

test("a genuine UAE caption with a promo tail still resolves its real location (hashtags preserved when they are the body)", () => {
  const cap = "أمطار غزيرة الآن على حتا \n.\n.\n.\n#الامارات ابوظبي دبي الشارقة عجمان الفجيرة راس_الخيمة العين";
  const c = classifyItem(cap);
  assert.equal(c.accept, true);
  assert.deepEqual(buildRows({ source: "instagram", extId: "z", channel: "IG", title: cap, publishedMs: 1 }).map((r) => r.placeId), ["hatta"]);
});

test("widespread UAE rain named in the sentence is kept in full (not discarded by a place-count cap)", () => {
  // A genuine widespread event naming several emirates in plain text must keep ALL its pins (req: don't auto-discard).
  const cap = "أمطار غزيرة الآن على دبي والشارقة وعجمان وأم القيوين ورأس الخيمة";
  const c = classifyItem(cap);
  assert.equal(c.accept, true);
  const pins = buildRows({ source: "instagram", extId: "w", channel: "IG", title: cap, publishedMs: 1 }).map((r) => r.placeId).sort();
  assert.ok(pins.length >= 4, "keeps the multiple real locations: " + pins.join(","));
});

test("places that exist ONLY in a hashtag cluster are treated as promotional, not pinned", () => {
  // No plain-text location — the emirate names appear solely as hashtags. This is the promo-dump signature.
  const cap = "صور رائعة اليوم 📷 #ابوظبي #دبي #الشارقة #عجمان #الفجيرة #راس_الخيمة امطار";
  const c = classifyItem(cap);
  assert.equal(c.accept, false);
  assert.equal(c.reason, "location_spam");
  assert.equal(buildRows({ source: "instagram", extId: "h", channel: "IG", title: cap, publishedMs: 1 }).length, 0);
});

test("a caption that names only an emirate pins that emirate's main city (connector path)", () => {
  // English "rain in <Emirate>" with no sub-place — the emirate IS the location, so pin its main city.
  for (const [cap, id] of [["First autumn rain in Abu Dhabi city tonight", "abu-dhabi"], ["Heavy rain in Dubai right now", "dubai"]]) {
    const c = classifyItem(cap);
    assert.equal(c.accept, true, cap);
    assert.deepEqual(buildRows({ source: "instagram", extId: "e", channel: "IG", title: cap, publishedMs: 1 }).map((r) => r.placeId), [id]);
  }
});

test("a specific landmark gets precise coordinates, not the emirate-capital fallback", () => {
  // The @uaeweatherman example: "Zayed Port" must resolve to the port's own coordinates, not central Abu Dhabi.
  const rows = buildRows({ source: "instagram", extId: "z", channel: "IG", title: "First autumn rain in Abu Dhabi! 📍 Zayed Port", publishedMs: 1 });
  assert.deepEqual(rows.map((r) => r.placeId), ["zayed-port"]);
  assert.ok(Math.abs(rows[0].lat - 24.5151) < 0.01 && Math.abs(rows[0].lon - 54.3782) < 0.01, "precise port coordinates, not 24.45/54.40");
});

test("a specific sub-place still suppresses the generic emirate-city pin (connector path)", () => {
  // The gazetteer-cleanup invariant must hold on the connector path too: specific places win, no generic Fujairah city.
  const cap = "الإمارات : الان هطول أمطار الخير على ضدنا وشرم ودبا في الفجيرة";
  const pins = buildRows({ source: "instagram", extId: "s", channel: "IG", title: cap, publishedMs: 1 }).map((r) => r.placeId).sort();
  assert.deepEqual(pins, ["dadna", "dibba-al-fujairah", "sharm"]);
  assert.ok(!pins.includes("fujairah"), "must not add the generic Fujairah city when specific places are named");
});

test("the same video reposted with different promo tags dedupes to one signature", () => {
  const a = "أمطار غزيرة على مليحة الآن \n.\n.\n#الامارات #مركز_العاصفة دبي ابوظبي الشارقة عجمان الفجيرة";
  const b = "أمطار غزيرة على مليحة الآن \n.\n.\n#uaeweather #rain الامارات ابوظبي دبي";
  const ra = buildRows({ source: "instagram", extId: "ra", channel: "A", title: a, publishedMs: 1 })[0];
  const rb = buildRows({ source: "instagram", extId: "rb", channel: "B", title: b, publishedMs: 1 })[0];
  assert.equal(ra.placeId, "mleiha");
  assert.equal(ra.sig, rb.sig, "identical core caption → identical signature regardless of promo tags → repost deduped");
});

test("YouTube-style titles are unaffected by the body/tail split (no hashtag tail present)", () => {
  const c = classifyItem("الإمارات : الان هطول أمطار رعدية غزيرة على مليحة وحمدة");
  assert.equal(c.accept, true);
  assert.deepEqual(buildRows({ source: "youtube", extId: "u", channel: "YT", title: "الإمارات : الان هطول أمطار رعدية غزيرة على مليحة وحمدة", publishedMs: 1 }).map((r) => r.placeId).sort(), ["hamda", "mleiha"]);
});

test("extracts events and UAE places in English and Arabic", () => {
  const a = extractReport("Heavy rain in Mirdif and Al Khawaneej right now!");
  assert.equal(a.event, "flood"); assert.ok(a.events.includes("rain"));
  assert.deepEqual(a.places.map((p) => p.en).sort(), ["Al Khawaneej", "Mirdif"]);
  assert.equal(a.hasLocation, true);

  const b = extractReport("أمطار غزيرة الآن على حتا والعين");
  assert.equal(b.event, "flood");
  assert.deepEqual(b.places.map((p) => p.en).sort(), ["Al Ain", "Hatta"]);

  const c = extractReport("رعد وبرق فوق خورفكان ودبا الفجيرة");
  assert.equal(c.event, "thunder");
  assert.ok(c.places.some((p) => p.en === "Dibba Al-Fujairah"));
  assert.ok(!c.places.some((p) => p.en === "Fujairah"), "specific Dibba match must not also yield Fujairah");
});

test("real live captions: every named location is resolved, with no generic-emirate substitution", () => {
  // Mleiha + Hamda (Sharjah interior, adjacent) — Hamda was previously unrecognised.
  const a = extractReport("الإمارات : الان هطول أمطار رعدية غزيرة على مليحة وحمدة");
  assert.deepEqual(a.places.map((p) => p.en).sort(), ["Hamda", "Mleiha"]);
  assert.ok(a.events.includes("thunder"));

  // Dadna + Sharm + Dibba (Fujairah) — Sharm and bare دبا were previously unrecognised, and "في الفجيرة" wrongly
  // produced a generic Fujairah city pin. Expect the three specific places and NO Fujairah city.
  const b = extractReport("الإمارات : الان هطول أمطار الخير على ضدنا وشرم ودبا في الفجيرة");
  assert.deepEqual(b.places.map((p) => p.en).sort(), ["Dadna", "Dibba Al-Fujairah", "Sharm"]);
  assert.ok(!b.places.some((p) => p.en === "Fujairah"), "must not substitute the generic Fujairah emirate location");
  assert.ok(b.emirates.includes("fu"), "Fujairah is kept as context");
});

test("bare Arabic برد (cold) is not treated as hail; explicit hail phrase is", () => {
  assert.equal(extractReport("الجو بارد اليوم في دبي").event, "unknown");
  assert.equal(extractReport("تساقط حبات البرد في مليحة").event, "hail");
  assert.equal(extractReport("Hail in Al Ain").event, "hail");
});

test("no location and no weather are flagged", () => {
  const r = extractReport("Good morning everyone");
  assert.equal(r.hasLocation, false); assert.equal(r.hasWeather, false); assert.equal(r.event, "unknown");
});

test("signature is stable per text+place and detects reposts of identical text", () => {
  const s1 = reportSignature("مطر في مردف", "mirdif");
  const s2 = reportSignature("مطر   في  مردف", "mirdif");   // whitespace differences normalise away
  assert.equal(s1, s2);
  assert.notEqual(s1, reportSignature("مطر في مردف", "hatta"));
});

test("verifyReport: METAR precip = officially-confirmed; echo only = radar; both clear = conflicting", () => {
  const now = Date.now();
  const atFuj = { lat: 25.112, lon: 56.324 };               // OMFJ Fujairah airport coords
  const frameEcho = { ms: now, ok: new Array(GRID.cols * GRID.rows).fill(1), clusters: [(() => { const c = llToMosaic(atFuj.lat, atFuj.lon); return { n: 9, cx: c.x, cy: c.y, runs: [Math.floor(c.y), Math.floor(c.x) - 1, 3] }; })()] };
  const frameDry = { ms: now, ok: new Array(GRID.cols * GRID.rows).fill(1), clusters: [] };

  const wetMetar = [{ station: "OMFJ", obsMs: now - 5 * 60000, rain: 1, thunder: 0 }];
  const dryMetar = [{ station: "OMFJ", obsMs: now - 5 * 60000, rain: 0, thunder: 0 }];

  assert.equal(verifyReport({ ...atFuj, publishMs: now, event: "rain" }, [frameDry], wetMetar).status, "officially-confirmed");
  assert.equal(verifyReport({ ...atFuj, publishMs: now, event: "rain" }, [frameEcho], []).status, "radar-corroborated");
  assert.equal(verifyReport({ ...atFuj, publishMs: now, event: "rain" }, [frameDry], dryMetar).status, "conflicting");
  assert.equal(verifyReport({ ...atFuj, publishMs: now, event: "rain" }, [], []).status, "unverified");
  assert.equal(verifyReport({ lat: null, lon: null, publishMs: now, event: "rain" }, [], []).status, "missing_location");
});

test("a dry report (no weather claim) is never 'conflicting'", () => {
  const now = Date.now(), atFuj = { lat: 25.112, lon: 56.324 };
  const frameDry = { ms: now, ok: new Array(GRID.cols * GRID.rows).fill(1), clusters: [] };
  assert.equal(verifyReport({ ...atFuj, publishMs: now, event: "unknown" }, [frameDry], [{ station: "OMFJ", obsMs: now, rain: 0, thunder: 0 }]).status, "unverified");
});
