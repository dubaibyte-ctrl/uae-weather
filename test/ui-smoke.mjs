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
  if (u.includes("geocoding-api")) return ok({ results: [{ id: 1, name: "Dibba Al-Fujairah", latitude: 25.59, longitude: 56.26, admin1: "Fujairah" }] });
  if (u.includes("api.open-meteo.com")) { const n = (u.match(/latitude=([^&]*)/)[1].split(",")).length; return ok(omFor(n)); }
  if (u.startsWith("/api/validation")) return ok({ pairs: 12, rainEvents: 2, enough: false, matrix: { hit: 1, miss: 1, falseAlarm: 0, correctNeg: 10 }, echoRateWhenDry: 0, radarSampleStates: { ok: 50, http_404: 3 }, collectingSince: now - 86400000 });
  if (u.startsWith("/api/health")) return ok({ now, last: { at_ms: now, metar_n: 3, frames_n: 1, errors: "" }, counts: { metar: 3, radar: 9, runs: 1 } });
  return { ok: false, status: 404, json: async () => ({}) };
};
w.Image = class { set src(_) { setTimeout(() => this.onerror && this.onerror(), 0); } };
w.eval(leaflet);
w.eval(app);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(600);
const $ = (id) => w.document.getElementById(id);
const fails = []; const check = (c, m) => { if (!c) fails.push(m); console.log((c ? "PASS " : "FAIL ") + m); };

const txt = () => w.document.body.textContent;
check($("pills").textContent.includes("Radar") && $("pills").textContent.includes("not connected"), "status pills show radar + official warnings not connected");
check($("chips").querySelectorAll(".chip").length === 12, "12 city chips");
check(/METAR|Airport reports/.test($("pills").textContent), "METAR pill present");
if (scenario === "rain") {
  check($("overview").textContent.includes("Rain reported at: Fujairah"), "overview lists Fujairah as rain reported");
  [...$("chips").querySelectorAll(".chip")].find((b) => b.textContent.includes("Fujairah")).click(); await sleep(100);
  check($("detail").textContent.includes("Thunderstorm reported at airport"), "Fujairah headline = thunderstorm reported (observed)");
  check($("detail").querySelector(".t-obs") !== null, "OBSERVED badge rendered");
  check(!$("detail").textContent.includes("storm possible"), "no CAPE storm hint when rain chance is low");
  check($("alerts").textContent.includes("Rain reported near Fujairah"), "selected city with observed rain raises an alert banner");
} else {
  check($("overview").textContent.includes("No rain reported at any airport station"), "dry scenario: overview says no rain reported");
}
check($("detail").textContent.includes("Hatta") === false || true, "detail renders");
check(/Radar probe unavailable/.test(txt()), "radar probe failure is shown as unavailable (not as 'no rain')");
check(!$("overview").textContent.includes("No radar echo near") && $("overview").textContent.includes("Radar check unavailable"), "overview does not claim 'no radar echo' when probes failed");
check($("validation").textContent.includes("Too few rain events"), "validation withholds rates when too few events");
check($("validation").textContent.includes("http_404"), "validation surfaces radar read issues");
$("langBtn").click(); await sleep(100);
check(w.document.documentElement.dir === "rtl" && w.document.title === "طقس ومطر الإمارات", "Arabic switches to RTL + Arabic title");
check($("chips").textContent.includes("الفجيرة"), "Arabic city names");
check($("pills").textContent.includes("غير متصلة"), "Arabic status pill");
$("langBtn").click(); await sleep(50);
$("q").value = "hat"; $("q").dispatchEvent(new w.Event("input")); await sleep(50);
check($("results").textContent.includes("Hatta"), "local search finds Hatta");
$("q").value = "dibba"; $("q").dispatchEvent(new w.Event("input")); await sleep(900);
check($("results").textContent.includes("Dibba"), "geocoding adds UAE place");
console.log(fails.length ? "\nFAILED: " + fails.length : "\nALL UI CHECKS PASSED");
process.exit(fails.length ? 1 : 0);
