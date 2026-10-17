// Community report parsing, signatures, and verification. Pure functions; no network.
import test from "node:test";
import assert from "node:assert/strict";
import { extractReport, reportSignature, verifyReport, normAr } from "../src/lib/community.js";
import { llToMosaic, GRID } from "../public/lib/radar-geo.js";

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
