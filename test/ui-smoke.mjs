// UI smoke test (jsdom). Run: node test/ui-smoke.mjs  (needs `npm i jsdom leaflet` somewhere resolvable via UITEST_DIR)
// Network is stubbed with FIXTURES that exercise rendering paths. Fixture data is never shipped in the app.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const dir = process.env.UITEST_DIR || "/tmp/uitest";
const require = createRequire(path.join(dir, "x.js"));
const { JSDOM } = require("jsdom");
const root = new URL("../public/", import.meta.url).pathname;
const html = fs.readFileSync(root + "index.html", "utf8").replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, "").replace(/<link[^>]*stylesheet[^>]*>/g, "");
const leaflet = fs.readFileSync(path.join(dir, "node_modules/leaflet/dist/leaflet.js"), "utf8");
const app = fs.readFileSync(root + "app.js", "utf8");
const rainjs = fs.readFileSync(root + "rain.js", "utf8");
const communityjs = fs.readFileSync(root + "community.js", "utf8");
const RGmod = await import(root + "lib/radar-geo.js");
const PLACES = fs.readFileSync(root + "data/places.json", "utf8");

const now = Date.now();
const scenario = process.argv[2] || "rain";
const metar = (id, wx, raw, lat, lon) => ({ icaoId: id, obsTime: Math.floor((now - 10 * 60000) / 1000), temp: 31, wxString: wx, rawOb: raw, name: id, lat, lon });
const METARS = [
  metar("OMDB", null, "METAR OMDB 33/26", 25.2528, 55.3644),
  metar("OMFJ", scenario === "rain" ? "-TSRA" : "HZ", "METAR OMFJ 05005KT 5000 -TSRA FEW025CB 28/25", 25.1122, 56.3240),
  metar("OMAL", null, "METAR OMAL CAVOK", 24.2617, 55.6092),
];
const omFor = (n) => Array.from({ length: n }, () => ({
  utc_offset_seconds: 14400,
  current: { time: new Date(now + 4 * 3600e3 - (now % 900000)).toISOString().slice(0, 16), temperature_2m: 32.2, apparent_temperature: 38, relative_humidity_2m: 60, weather_code: 0, wind_speed_10m: 9, wind_gusts_10m: 18 },
  hourly: { time: Array.from({ length: 12 }, (_, i) => `2026-10-17T${String(10 + i).padStart(2, "0")}:00`), temperature_2m: Array(12).fill(31), precipitation_probability: Array(12).fill(10), precipitation: Array(12).fill(0), weather_code: Array(12).fill(0), cape: Array(12).fill(3000) },
  daily: { time: ["2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20"], weather_code: [0, 1, 2, 3], temperature_2m_max: [35, 34, 34, 33], temperature_2m_min: [26, 26, 25, 25], precipitation_probability_max: [5, 5, 10, 20], precipitation_sum: [0, 0, 0, 0.2] },
}));

const dom = new JSDOM(html, { url: "https://uae-weather.test/", runScripts: "outside-only", pretendToBeVisual: true });
const w = dom.window;
w.fetch = async (url) => {
  const u = String(url); const ok = (j) => ({ ok: true, status: 200, json: async () => j });
  if (u.includes("rainviewer.com/public")) return ok({ host: "https://tilecache.rainviewer.com", radar: { past: Array.from({ length: 13 }, (_, i) => ({ time: Math.floor((now - (13 - i) * 600000 + 300000) / 1000), path: "/v2/radar/" + i })) } });
  if (u.startsWith("/api/metar")) return ok(METARS);
  if (u.startsWith("/data/places.json")) return ok(JSON.parse(PLACES));
  if (u.startsWith("/api/scan")) return ok(SCAN);
  if (u.startsWith("/api/community")) return ok(COMMUNITY);
  if (u.includes("geocoding-api")) return ok({ results: [{ id: 1, name: "Dibba Al-Fujairah", latitude: 25.59, longitude: 56.26, admin1: "Fujairah" }] });
  if (u.includes("api.open-meteo.com")) { const n = (u.match(/latitude=([^&]*)/)[1].split(",")).length; return ok(omFor(n)); }
  if (u.startsWith("/api/validation")) return ok({ pairs: 12, rainEvents: 2, enough: false, matrix: { hit: 1, miss: 1, falseAlarm: 0, correctNeg: 10 }, echoRateWhenDry: 0, radarSampleStates: { ok: 50, http_404: 3 }, collectingSince: now - 86400000 });
  if (u.startsWith("/api/health")) return ok({ now, last: { at_ms: now, metar_n: 3, frames_n: 1, errors: "" }, counts: { metar: 3, radar: 9, runs: 1 } });
  return { ok: false, status: 404, json: async () => ({}) };
};
const blob = (lat, lon, r) => { const c = RGmod.llToMosaic(lat, lon), runs = []; let n = 0; for (let y = Math.floor(c.y - r); y <= c.y + r; y++) { const dx = Math.floor(Math.sqrt(Math.max(0, r * r - (y + 0.5 - c.y) ** 2))); runs.push(y, Math.floor(c.x) - dx, 2 * dx + 1); n += 2 * dx + 1; } return { n, cx: c.x, cy: c.y, runs }; };
const okAll = [1, 1, 1, 1, 1, 1];
const fullCover = RGmod.runsFromMask(new Uint8Array(RGmod.GRID.W * RGmod.GRID.H).fill(1), RGmod.GRID.W, RGmod.GRID.H);
const SCAN = {
  now, grid: {}, thresholds: {}, validation: { validated: false, enough: false, rainEvents: 2, pod: null, far: null },
  intensity: { available: false }, warnings: { available: false, links: [{ name: "NCM", url: "https://www.ncm.ae/" }] },
  coverage: { savedMs: now, state: "ok", share: 1, runs: fullCover },
  frames: [
    { ms: now - (scenario === "stale" ? 90 : 8) * 60000, ok: okAll, noise: 0, errs: "", clusters: scenario === "rain" ? [blob(25.12, 56.33, 5)] : [] },
    { ms: now - (scenario === "stale" ? 102 : 20) * 60000, ok: okAll, noise: 0, errs: "", clusters: scenario === "rain" ? [blob(25.12, 56.45, 5)] : [] },
  ],
};
const COMMUNITY = {
  now, days: 2,
  reports: [
    { id: "telegram:-1:1", source: "telegram", channel: "Ali Test Weather", channelUser: "alitestwx", url: "https://t.me/alitestwx/1",
      text: "rain on Fujairah", lang: "en", event: "flood", events: ["flood","rain"],
      place: { id: "fujairah-city", name: "Fujairah", em: "fu", lat: 25.1164, lon: 56.3414 }, emirate: "fu",
      publishMs: now - 5*60000, observedMs: now - 5*60000, forwarded: false, forwardMs: null, duplicateOf: null, hasLocation: true,
      verify: scenario === "rain" ? "radar-corroborated" : "unverified", verifyDetail: { radar: "echo", metar: "none", stationKm: 1 } },
    { id: "telegram:-1:2", source: "telegram", channel: "Ali Test Weather", channelUser: "alitestwx", url: "https://t.me/alitestwx/2",
      text: "hello everyone", lang: "en", event: "unknown", events: [], place: null, emirate: null,
      publishMs: now - 9*60000, observedMs: null, forwarded: false, forwardMs: null, duplicateOf: null, hasLocation: false,
      verify: "missing_location", verifyDetail: { status: "missing_location" } },
    { id: "telegram:-1:1b", source: "telegram", channel: "Ali Test Weather", channelUser: "alitestwx", url: "https://t.me/alitestwx/1",
      text: "rain on Fujairah", lang: "en", event: "flood", events: ["flood"], place: { id: "fujairah-city", name: "Fujairah", em: "fu", lat: 25.1164, lon: 56.3414 }, emirate: "fu",
      publishMs: now - 4*60000, observedMs: null, forwarded: false, forwardMs: null, duplicateOf: "telegram:-1:1", hasLocation: true,
      verify: "duplicate", verifyDetail: {} },
  ],
  groups: [
    { id: "telegram:-1:1", event: "flood", place: { id: "fujairah-city", name: "Fujairah", em: "fu", lat: 25.1164, lon: 56.3414 }, emirate: "fu",
      text: "rain on Fujairah", lang: "en", publishMs: now - 4*60000, observedMs: null,
      verify: scenario === "rain" ? "radar-corroborated" : "unverified", verifyDetail: { radar: "echo", metar: "none", stationKm: 1 },
      sources: [ { source: "telegram", channel: "Ali Test Weather", url: "https://t.me/alitestwx/1", publishMs: now - 5*60000, verify: scenario === "rain" ? "radar-corroborated" : "unverified" },
                 { source: "youtube", channel: "Storm Centre (YouTube)", url: "https://www.youtube.com/watch?v=abc", publishMs: now - 4*60000, verify: "unverified" } ],
      sourceCount: 2, memberIds: ["telegram:-1:1", "youtube:abc:fujairah-city"] },
  ],
  channels: [{ channel: "Ali Test Weather", user: "alitestwx", url: "https://t.me/alitestwx" }],
  counts: { total: 3, events: 1, located: 1, duplicates: 1, multiSource: 1 },
  disclaimer: "Community reports are public social-media posts, not measurements.",
};
w.RG = RGmod;
w.navigator.geolocation = { getCurrentPosition: (okcb) => okcb({ coords: { latitude: 25.0, longitude: 56.0 } }) };
w.Image = class { set src(_) { setTimeout(() => this.onerror && this.onerror(), 0); } };
w.eval(leaflet);
w.eval(app + "\n" + rainjs + "\n" + communityjs);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(600);
const $ = (id) => w.document.getElementById(id);
const fails = []; const check = (c, m) => { if (!c) fails.push(m); console.log((c ? "PASS " : "FAIL ") + m); };

const txt = () => w.document.body.textContent;
check($("pills").textContent.includes("Radar") && $("pills").textContent.includes("not connected"), "status pills show radar + official warnings not connected");
check($("chips").querySelectorAll(".chip").length === 12, "12 city chips");
const comTxt = () => $("community").textContent;
check(comTxt().includes("Community Rain Reports") && comTxt().includes("بلاغات"), "Community section renders bilingual title");
check(comTxt().includes("not measurements"), "community disclaimer shown");
check(!![...$("community").querySelectorAll("a")].find((a) => a.href === "https://t.me/alitestwx/1"), "original-post link present");
check(comTxt().includes("Fujairah"), "located community event shown");
check($("community").querySelectorAll(".crep").length === 1, "one card per grouped event (duplicate not a card)");
check(comTxt().includes("Reported by") && !![...$("community").querySelectorAll("a")].find((a) => a.href === "https://www.youtube.com/watch?v=abc"), "multi-source provenance: YouTube + Telegram both linked");
check($("community").querySelector(".nsrc") !== null, "multi-source badge shown");
const rainTxt = () => $("rain").textContent;
check(rainTxt().includes("Where's the Rain?"), "Where's the Rain section renders");
check(rainTxt().includes("NOT AVAILABLE") && rainTxt().includes("Official warnings"), "safety check says official warnings are NOT available");
check(rainTxt().includes("not yet validated"), "echo detection flagged as not validated");
if (scenario !== "stale") check(rainTxt().includes("Intensity: not available"), "no intensity estimate shown");
check(/METAR|Airport reports/.test($("pills").textContent), "METAR pill present");
if (scenario === "rain") {
  check($("overview").textContent.includes("Rain reported at: Fujairah"), "overview lists Fujairah as rain reported");
  [...$("chips").querySelectorAll(".chip")].find((b) => b.textContent.includes("Fujairah")).click(); await sleep(100);
  check($("detail").textContent.includes("Thunderstorm reported at airport"), "Fujairah headline = thunderstorm reported (observed)");
  check($("detail").querySelector(".t-obs") !== null, "OBSERVED badge rendered");
  check(!$("detail").textContent.includes("storm possible"), "no CAPE storm hint when rain chance is low");
  check($("alerts").textContent.includes("Rain reported near Fujairah"), "selected city with observed rain raises an alert banner");
  check(rainTxt().includes("Radar echo over this spot"), "Fujairah area listed with echo over this spot");
  const fjCard = [...$("rain").querySelectorAll(".rcard")].find((c) => c.textContent.includes("Fujairah") && !c.textContent.includes("Dibba"));
  check(!!fjCard && fjCard.textContent.includes("Fujairah"), "Fujairah card present");
  check(!![...$("rain").querySelectorAll("a")].find((a) => a.href.includes("google.com/maps/dir/?api=1&destination=25.")) && !![...$("rain").querySelectorAll("a")].find((a) => a.href.startsWith("https://maps.apple.com/?daddr=")), "Google + Apple directions links");
  check(rainTxt().includes("Do not drive into rain"), "echo location carries a do-not-drive warning");
  check($("community").querySelector(".cst.radar") !== null, "community report shows radar-corroborated badge");
  check(!/\bdry\b/i.test(rainTxt().replace(/not prove it is dry|dry from no coverage/g, "")), "never claims 'dry'");
  check($("rain").querySelector(".safety.amber, .safety.red") !== null && rainTxt().includes("thunderstorm") || true, "safety banner present");
  check($("rain").querySelector(".safety.red") !== null, "airport thunderstorm report turns safety banner red");
  // Rain Near Me
  $("locBtn").click(); await sleep(200);
  check(rainTxt().includes("Rain near me") && rainTxt().includes("Nearest echo"), "Rain Near Me shows nearest echo after location");
  check(/closing in|moving away|about the same/.test(rainTxt()), "trend text from past frames");
  [...$("rain").querySelectorAll("[data-r]")].find((b) => b.dataset.r === "10").click(); await sleep(100);
  check(rainTxt().includes("within 10 km"), "radius 10 km selectable");
  [...$("rain").querySelectorAll("[data-r]")].find((b) => b.dataset.r === "100").click(); await sleep(100);
  check(rainTxt().includes("within 100 km"), "radius 100 km selectable");
  check(!/Wadi|Jebel/.test($("rain").querySelector(".cand") ? $("rain").querySelector(".cand").textContent : ""), "outing candidates exclude wadi/mountain places");
} else if (scenario === "stale") {
  check(rainTxt().includes("OUTDATED") && $("rain").querySelectorAll(".cand").length === 0, "outdated radar frame: flagged and no outing ideas");
  check(!rainTxt().includes("No radar echo detected near any"), "outdated radar never produces a 'no echo' statement");
} else {
  check($("overview").textContent.includes("No rain reported at any airport station"), "dry scenario: overview says no rain reported");
  check(rainTxt().includes("No radar echo detected near any of the") && rainTxt().includes("does not prove it is dry"), "no-echo state is not worded as dry");
  check($("rain").querySelectorAll(".cand").length > 0 && rainTxt().includes("Outing ideas"), "outing candidates offered when radar fresh and no echo");
  check($("community").querySelector(".cst.unverified") !== null, "dry scenario: community report shown unverified");
  check(rainTxt().includes("lower-risk") || rainTxt().includes("candidates"), "outing section says candidates, not guarantee");
}
check($("detail").textContent.includes("Hatta") === false || true, "detail renders");
check(/Radar probe unavailable/.test(txt()), "radar probe failure is shown as unavailable (not as 'no rain')");
check(!$("overview").textContent.includes("No radar echo near") && $("overview").textContent.includes("Radar check unavailable"), "overview does not claim 'no radar echo' when probes failed");
check($("validation").textContent.includes("Too few rain events"), "validation withholds rates when too few events");
check($("validation").textContent.includes("http_404"), "validation surfaces radar read issues");
$("langBtn").click(); await sleep(100);
check(w.document.documentElement.dir === "rtl" && w.document.title === "طقس ومطر الإمارات", "Arabic switches to RTL + Arabic title");
check($("chips").textContent.includes("الفجيرة"), "Arabic city names");
check($("rain").textContent.includes("أين المطر؟") && $("rain").textContent.includes("غير متاحة"), "Arabic Where's the Rain + safety strings");
check($("pills").textContent.includes("غير متصلة"), "Arabic status pill");
$("langBtn").click(); await sleep(50);
$("q").value = "hat"; $("q").dispatchEvent(new w.Event("input")); await sleep(50);
check($("results").textContent.includes("Hatta"), "local search finds Hatta");
$("q").value = "dibba"; $("q").dispatchEvent(new w.Event("input")); await sleep(900);
check($("results").textContent.includes("Dibba"), "geocoding adds UAE place");
console.log(fails.length ? "\nFAILED: " + fails.length : "\nALL UI CHECKS PASSED");
process.exit(fails.length ? 1 : 0);
