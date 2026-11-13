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

test("safeguard: a block of 5+ place names (hashtag spam) is rejected as location-unverified, never accepted as many pins", () => {
  // Six emirate names strung together with a rain word — the promotional-dump signature. classifyItem gates this
  // before buildRows is ever called, so the pipeline produces no pins.
  const spam = "ابوظبي دبي الشارقة عجمان راس الخيمة الفجيرة العين امطار";
  const c = classifyItem(spam);
  assert.equal(c.accept, false);
  assert.equal(c.reason, "location_spam");
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
