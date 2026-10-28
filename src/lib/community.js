// Parsing + verification for Community Rain Reports. Pure functions (no I/O) so they can be unit tested.
// A community report is ALWAYS a claim, never a measurement. Verification only ever upgrades a report to
// "radar-corroborated" or "officially-confirmed" using our own independent data; it never asserts rain by itself.
import { PLACES, EMIRATES } from "./places-data.js";
import { STATIONS } from "./metar.js";
import { analysePoint, haversineKm } from "../../public/lib/radar-geo.js";

// ---- text normalisation ----
export function normAr(s) {
  return (s || "")
    .replace(/[ً-ْٰـ]/g, "")      // harakat + superscript alef + tatweel
    .replace(/[آأإٱ]/g, "ا") // alef variants -> bare alef
    .replace(/ة/g, "ه")                      // teh marbuta -> heh
    .replace(/ى/g, "ي")                      // alef maqsura -> yeh
    .replace(/ؤ/g, "و").replace(/ئ/g, "ي")
    .replace(/[^؀-ۿ\s]/g, " ").replace(/\s+/g, " ").trim();
}
export function normEn(s) {
  return (s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
const stripAl = (s) => s.replace(/^(al|el|ad|ar|as|at|az)\s+/, "").replace(/^(ال|الـ)/, "");

// ---- gazetteer index: longest keys first so "Dibba Al Fujairah" wins over "Fujairah" ----
function buildIndex() {
  const entries = [];
  const add = (key, lang, place, em) => { const k = (lang === "ar" ? normAr(key) : normEn(key)); if (k && k.length >= 3) entries.push({ k, lang, place, em }); };
  for (const p of PLACES) {
    add(p.en, "en", p, p.em); add(stripAl(normEn(p.en)), "en", p, p.em);
    if (p.ar) { add(p.ar, "ar", p, p.em); add(stripAl(normAr(p.ar)), "ar", p, p.em); }
  }
  for (const [code, e] of Object.entries(EMIRATES)) { add(e.en, "en", null, code); add(e.ar, "ar", null, code); }
  // de-dup identical keys (keep the first / most specific place), then longest-first
  const seen = new Map();
  for (const e of entries) { const id = e.lang + ":" + e.k; if (!seen.has(id)) seen.set(id, e); }
  return [...seen.values()].sort((a, b) => b.k.length - a.k.length);
}
export const INDEX = buildIndex();

// ---- weather event keywords (Arabic + English). Everything stays "unverified" regardless. ----
const KW = {
  hail: { ar: ["حبات البرد", "تساقط البرد", "البرد", "برد"], en: ["hail", "hailstone"] },
  thunder: { ar: ["عاصفة رعدية", "رعدية", "رعد", "برق", "صواعق"], en: ["thunder", "thunderstorm", "lightning"] },
  flood: { ar: ["سيول", "سيل", "فيضان", "جريان الاودية", "امطار غزيرة", "غزيرة", "غزير"], en: ["flood", "flooding", "torrential", "heavy rain", "downpour"] },
  rain: { ar: ["امطار", "مطر", "تمطر", "ماطر", "شبر", "رذاذ", "زخات", "هطول"], en: ["rain", "raining", "rainfall", "showers", "shower", "drizzle", "wet"] },
};
// Arabic "برد" also means "cold", so hail needs a rain/thunder word present too unless it's the explicit phrase.
function detectEvents(normEnTxt, normArTxt) {
  // Drop negated precipitation ("بدون مطر" / "no rain") so a clear-sky clip isn't read as a rain report.
  normArTxt = normArTxt.replace(/(بدون|بلا|دون|من دون|لا)\s+(امطار|مطر|هطول|برد|سيول)/g, " ");
  normEnTxt = normEnTxt.replace(/\b(no|without|zero)\s+(rain|rainfall|precipitation|hail|flood)\b/g, " ");
  const hits = new Set();
  for (const [ev, langs] of Object.entries(KW)) {
    if (langs.en.some((w) => new RegExp("\\b" + w.replace(/ /g, "\\s+") + "\\b").test(normEnTxt))) hits.add(ev);
    if (langs.ar.some((w) => normArTxt.includes(normAr(w)))) hits.add(ev);
  }
  if (hits.has("hail")) {
    const explicit = /hailstone|hail\b/.test(normEnTxt) || normArTxt.includes(normAr("حبات البرد")) || normArTxt.includes(normAr("تساقط البرد"));
    if (!explicit && !(hits.has("rain") || hits.has("thunder") || hits.has("flood"))) hits.delete("hail"); // bare "برد" = cold, drop
  }
  return hits;
}
const EVENT_ORDER = ["hail", "thunder", "flood", "rain"];

// ---- main parse ----
export function extractReport(text) {
  const raw = text || "";
  // Strip the attached conjunction "و" (and) so "والعين" matches Al Ain, but protect place names that genuinely
  // begin with و — only "وادي" (wadi) and "واسط" (Wasit) exist in the gazetteer.
  const ne = " " + normEn(raw) + " ", na = (" " + normAr(raw) + " ").replace(/ و(?!ادي|اسط)/g, "  ");
  const events = detectEvents(ne, na);
  const primary = EVENT_ORDER.find((e) => events.has(e)) || "unknown";
  const lang = /[؀-ۿ]/.test(raw) ? (/[a-z]/i.test(raw) ? "mixed" : "ar") : "en";
  // place matching: scan longest keys first, remove matched span so a place isn't double-counted
  const found = []; const usedPlaceIds = new Set(); const usedEm = new Set();
  let scanEn = ne, scanAr = na; const pad = (k) => " " + k + " ";
  for (const e of INDEX) {                                   // INDEX is longest-key-first so specific names win
    let hay = e.lang === "ar" ? scanAr : scanEn;
    // Arabic writers often prepend the article "ال" to a bare place name (مسافي → المسافي). Match both forms.
    const alt = e.lang === "ar" && !e.k.startsWith("ال") ? " ال" + e.k + " " : null;
    const span = hay.includes(pad(e.k)) ? pad(e.k) : alt && hay.includes(alt) ? alt : null;
    if (!span) continue;
    if (e.place) { if (usedPlaceIds.has(e.place.id)) continue; usedPlaceIds.add(e.place.id); found.push({ kind: "place", ...e.place }); }
    else { if (usedEm.has(e.em)) continue; usedEm.add(e.em); found.push({ kind: "emirate", em: e.em }); }
    hay = hay.split(span).join("  ");                        // blank the matched span so sub-names don't double-count
    if (e.lang === "ar") scanAr = hay; else scanEn = hay;
  }
  const places = found.filter((f) => f.kind === "place");
  const emiratesOnly = found.filter((f) => f.kind === "emirate").map((f) => f.em);
  return {
    lang, events: [...events], event: primary,
    places: places.map((p) => ({ id: p.id, en: p.en, ar: p.ar, em: p.em, reg: p.reg, lat: p.lat, lon: p.lon })),
    emirates: [...new Set(emiratesOnly)],
    hasLocation: places.length > 0,
    hasWeather: events.size > 0,
  };
}

// ---- dedupe / repost signature ----
export function reportSignature(text, placeId) {
  const base = (normAr(text) + "|" + normEn(text)).replace(/\s+/g, " ").trim().slice(0, 300) + "|" + (placeId || "");
  let h = 5381; for (let i = 0; i < base.length; i++) h = ((h << 5) + h + base.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// ---- verification against our own independent data ----
// report: { lat, lon, publishMs, event }  scanFrames: [{ms, ok, clusters}]  metars: [{station, obsMs, rain, thunder}]
const RADAR_WIN = 20 * 60000, METAR_WIN = 45 * 60000, OBS_MAX_KM = 40;
export function verifyReport(report, scanFrames, metars) {
  const out = { radar: "unavailable", metar: "none", station: null, stationKm: null, status: "unverified" };
  if (report.lat == null) { out.status = "missing_location"; return out; }
  // radar: nearest scan frame in time
  let fr = null, best = Infinity;
  for (const f of scanFrames || []) { const d = Math.abs(f.ms - report.publishMs); if (d < best && d <= RADAR_WIN) { best = d; fr = f; } }
  if (fr) { const a = analysePoint(report.lat, report.lon, fr, null); out.radar = a.status === "over" || a.status === "near" ? "echo" : a.status === "unavailable" ? "unavailable" : "none"; out.radarKm = a.nearestKm; }
  // metar: nearest station within 40 km, any precip/thunder within time window
  let st = null, stKm = Infinity;
  for (const [id, s] of Object.entries(STATIONS)) { const k = haversineKm(report.lat, report.lon, s.ll[0], s.ll[1]); if (k < stKm) { stKm = k; st = id; } }
  if (st && stKm <= OBS_MAX_KM) {
    out.station = st; out.stationKm = Math.round(stKm);
    const near = (metars || []).filter((m) => m.station === st && Math.abs(m.obsMs - report.publishMs) <= METAR_WIN);
    if (near.length) out.metar = near.some((m) => m.rain || m.thunder) ? "wet" : "dry";
  }
  const claimsRain = report.event && report.event !== "unknown";
  if (out.metar === "wet") out.status = "officially-confirmed";
  else if (out.radar === "echo") out.status = "radar-corroborated";
  else if (claimsRain && out.metar === "dry" && out.radar === "none") out.status = "conflicting";
  else out.status = "unverified";
  return out;
}

// ---- generic connector support: classify a public item (e.g. a YouTube title) and build report rows ----
// Only genuine UAE weather OBSERVATIONS pass: a recognizable UAE place + an observable event, and not a
// forecast / advert / archival clip / non-UAE report. Pure + testable; shares the same parser as Telegram.
const FOREIGN = ["السعودية", "مكة", "المدينة المنورة", "جدة", "الرياض", "الدمام", "القصيم", "سلطنة عمان", "مسقط", "قطر", "الدوحة", "الكويت", "البحرين", "المنامة", "اليمن", "صنعاء", "مصر", "العراق", "سوريا", "لبنان", "السودان", "saudi", "makkah", "mecca", "jeddah", "riyadh", "oman", "muscat", "qatar", "doha", "kuwait", "bahrain", "yemen", "egypt"];
const FORECAST = ["توقعات", "متوقع", "المتوقع", "غدا", "الغد", "خلال الساعات القادمة", "ستشهد", "forecast", "expected", "outlook"];
const PROMO = ["اشترك", "للاعلان", "للإعلان", "اعلان", "إعلان", "للتواصل", "رابط الاشتراك", "رعاية", "subscribe", "sponsor"];
const OLD = ["ارشيف", "أرشيف", "العام الماضي", "قبل سنة", "قبل عام", "منذ سنوات", "throwback", "archive"];
const UAE_MARK = ["الامارات", "uae", "emirates"];
const hasAny = (arr, na, en) => arr.some((w) => (/[؀-ۿ]/.test(w) ? na.includes(normAr(w)) : en.includes(w)));

export function classifyItem(title) {
  const raw = title || "", en = " " + normEn(raw) + " ", na = " " + normAr(raw) + " ";
  const hasUAE = UAE_MARK.some((w) => (/[؀-ۿ]/.test(w) ? na.includes(normAr(w)) : en.includes(w)));
  if (hasAny(FOREIGN, na, en) && !hasUAE) return { accept: false, reason: "non_uae" };
  if (hasAny(FORECAST, na, en)) return { accept: false, reason: "forecast" };
  if (hasAny(PROMO, na, en)) return { accept: false, reason: "promo" };
  if (hasAny(OLD, na, en)) return { accept: false, reason: "old" };
  const parsed = extractReport(raw);
  if (!parsed.hasLocation) return { accept: false, reason: "no_uae_location", parsed };
  if (parsed.event === "unknown") return { accept: false, reason: "no_observable_event", parsed };
  return { accept: true, reason: "ok", parsed };
}

// Build one report row per matched UAE place from a connector item. observedMs stays null unless the source
// supplies a precise observation time (YouTube titles carry a date only, so publication time is authoritative).
export function buildRows(opts) {
  const { source, extId, channel, channelUser = null, url = null, title, publishedMs, observedMs = null } = opts;
  const parsed = extractReport(title || "");
  return parsed.places.map((place) => ({
    id: `${source}:${extId}:${place.id}`,
    source, channel, channelUser, msgId: null,
    text: (title || "").slice(0, 1000), lang: parsed.lang, event: parsed.event, events: parsed.events,
    placeId: place.id, placeName: place.en, em: place.em, lat: place.lat, lon: place.lon,
    publishMs: publishedMs, observedMs, forwarded: false, forwardMs: null, url,
    sig: reportSignature(title || "", place.id), hasLocation: true,
  }));
}
