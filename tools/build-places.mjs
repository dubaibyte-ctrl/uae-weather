// Builds public/data/places.json from places-spec.txt (names/emirate/type) + places-raw.txt (geocoder results).
// Coordinates are copied verbatim from GeoNames (via Open-Meteo geocoding) or OpenStreetMap (Nominatim); none are estimated.
import fs from "node:fs";
const here = new URL("./", import.meta.url).pathname;
const spec = fs.readFileSync(here + "places-spec.txt", "utf8").trim().split("\n").map((l) => l.split("|"));
const raw = new Map(fs.readFileSync(here + "places-raw.txt", "utf8").split("\n").filter((l) => l && !l.startsWith("#")).map((l) => { const p = l.split("|"); return [+p[0], p]; }));
const EM = { du: ["Dubai", "دبي"], sh: ["Sharjah", "الشارقة"], aj: ["Ajman", "عجمان"], uq: ["Umm Al Quwain", "أم القيوين"], rk: ["Ras Al Khaimah", "رأس الخيمة"], fu: ["Fujairah", "الفجيرة"], ad: ["Abu Dhabi", "أبوظبي"], aa: ["Abu Dhabi", "أبوظبي"] };
// Arabic names only where the geocoder returned none and the standard Arabic form is unambiguous; everything else falls back to English in the UI.
const AR_MANUAL = { 12: "ديرة", 15: "القوز", 18: "القصيص", 24: "رأس الخور", 21: "أم سقيم", 16: "الخليج التجاري", 17: "واحة السيليكون", 20: "نخلة جميرا", 26: "مرغم", 110: "جزيرة السعديات", 109: "جزيرة ياس", 112: "مدينة مصدر", 41: "كلباء", 43: "دبا الحصن", 74: "الجزيرة الحمراء", 79: "الرمس", 80: "شعم", 83: "غليلة", 86: "دقداقة", 88: "مسافي", 91: "غب" };
const AR_FIX = { 37: "الشارقة" };
const slug = (s) => s.toLowerCase().replace(/\(.*?\)/g, (m) => m.slice(1, -1)).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const out = []; const seen = new Set();
spec.forEach(([en, , em, t], i) => {
  const r = raw.get(i); if (!r) return;
  const lat = +r[3], lon = +r[4];
  if (!(lat > 22.4 && lat < 26.3 && lon > 51.4 && lon < 56.6)) throw new Error("outside UAE bbox: " + en);
  const arSrc = AR_FIX[i] || (/[؀-ۿ]/.test(r[5] || "") ? r[5] : AR_MANUAL[i] || "");
  let id = slug(en); if (seen.has(id)) id += "-" + em; seen.add(id);
  out.push({ id, en, ar: arSrc || undefined, em: em === "aa" ? "ad" : em, ...(em === "aa" ? { reg: "Al Ain" } : {}), t, lat, lon, src: (r[1] === "g" ? "geonames:" : "osm:") + r[2] });
});
const data = { version: 1, built: new Date().toISOString().slice(0, 10), emirates: Object.fromEntries(Object.entries(EM).filter(([k]) => k !== "aa").map(([k, v]) => [k, { en: v[0], ar: v[1] }])), sources: "Coordinates: GeoNames (CC BY 4.0, via Open-Meteo geocoding) and OpenStreetMap contributors (ODbL, via Nominatim). Point locations only; no boundaries.", places: out };
fs.writeFileSync(here + "../public/data/places.json", JSON.stringify(data));
const by = {}; out.forEach((p) => (by[p.em] = (by[p.em] || 0) + 1));
console.log("places", out.length, JSON.stringify(by), "withArabic", out.filter((p) => p.ar).length, "unresolved", spec.length - out.length);
