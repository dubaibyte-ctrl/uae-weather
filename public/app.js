"use strict";
/* UAE Rain & Weather: client app. Real data only. Observed / radar / model are always labelled separately. */
const TZ = "Asia/Dubai";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function ls(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || "null"); localStorage.setItem(k, JSON.stringify(v)); } catch (_) { return null; } }

const CITIES = [
  { id: "dubai", en: "Dubai", ar: "دبي", lat: 25.2048, lng: 55.2708 },
  { id: "abudhabi", en: "Abu Dhabi", ar: "أبوظبي", lat: 24.4539, lng: 54.3773 },
  { id: "sharjah", en: "Sharjah", ar: "الشارقة", lat: 25.3463, lng: 55.4209 },
  { id: "ajman", en: "Ajman", ar: "عجمان", lat: 25.4052, lng: 55.5136 },
  { id: "uaq", en: "Umm Al Quwain", ar: "أم القيوين", lat: 25.5647, lng: 55.5552 },
  { id: "rak", en: "Ras Al Khaimah", ar: "رأس الخيمة", lat: 25.7895, lng: 55.9432 },
  { id: "fujairah", en: "Fujairah", ar: "الفجيرة", lat: 25.1288, lng: 56.3265 },
  { id: "khorfakkan", en: "Khor Fakkan", ar: "خورفكان", lat: 25.3395, lng: 56.3563 },
  { id: "alain", en: "Al Ain", ar: "العين", lat: 24.2075, lng: 55.7447 },
  { id: "hatta", en: "Hatta", ar: "حتا", lat: 24.8, lng: 56.12 },
  { id: "liwa", en: "Liwa", ar: "ليوا", lat: 23.1306, lng: 53.7719 },
  { id: "ruwais", en: "Ruwais", ar: "الرويس", lat: 24.1103, lng: 52.7306 },
];
// Fallback coordinates; live METAR JSON carries lat/lon which take precedence.
const STATION_LL = { OMDB: [25.2528, 55.3644], OMDW: [24.8964, 55.1614], OMSJ: [25.3286, 55.5172], OMRK: [25.6135, 55.9388], OMFJ: [25.1122, 56.3240], OMAA: [24.4330, 54.6511], OMAD: [24.4283, 54.4583], OMAM: [24.2483, 54.5477], OMAL: [24.2617, 55.6092] };
const OBS_MAX_KM = 40, METAR_FRESH = 75, METAR_STALE = 180, RADAR_FRESH = 20, RADAR_STALE = 60, OM_FRESH = 45;

const I18N = {
  en: {
    title: "UAE Rain & Weather", pill_radar: "Radar", pill_metar: "Airport reports", pill_model: "Forecast model", pill_official: "Official warnings", notconn: "not connected", unavailable: "unavailable", stale: "STALE", outdated: "OUTDATED, not used", ago: "{0} ago", min: "min", h: "h", justnow: "just now",
    badge_obs: "OBSERVED", badge_rad: "RADAR", badge_mod: "MODEL", badge_off: "N/A",
    head_thunder: "Thunderstorm reported at airport", head_rain: "Rain reported at airport", head_echo: "Radar shows rain-like echo (not confirmed on the ground)", head_none: "No rain observed or on radar", head_none_noradar: "No rain reported at airport; radar unavailable", head_noecho_notlive: "No radar echo; airport data unavailable", head_noecho_nostation: "No radar echo; no nearby station", head_nodata: "No fresh observation",
    obs_report: "{0} report {1} ({2}): ", obs_none: "no precipitation reported", obs_present: "present weather {0}", hail_code: "hail code reported", ts_reported: "thunderstorm reported", cb: "CB/TCU cloud reported", vicinity: "In the vicinity of the airport: {0}", station_km: "Station is {0} km away", no_station: "No observing station within {0} km (nearest {1}, {2} km)", no_obs: "No observation data available",
    radar_echo: "Radar echo at this point", radar_noecho: "No radar echo at this point", echo_note: "echo is not rain on the ground", radar_unavail: "Radar probe unavailable ({0})",
    model_now: "Model (not measured) {0}: {1}°C · humidity {2}% · wind {3} km/h (gusts {4})", model_pred: "Predicted next 6 h: rain chance up to {0}%, total {1} mm", storm_possible: "CAPE {0} J/kg with ≥30% rain chance (storm possible)", model_ts: "model suggests thunderstorm",
    hourly: "Next 12 hours (forecast)", daily: "Next days (forecast)", feels: "Feels like", humidity: "Humidity", wind: "Wind", gusts: "Gusts", rain_chance: "rain chance",
    search_ph: "Search a UAE place (Hatta, Al Ain, Fujairah…)", save: "☆ Save", saved: "★ Saved", no_results: "No UAE place found", searching: "Searching…",
    play: "▶ Play", pause: "❚❚ Pause", latest: "latest", past: "past",
    leg_obs: "rain reported at airport", leg_rad: "radar echo only", leg_none: "no rain seen", leg_unk: "no usable data", leg_station: "airport station", leg_note: "Overlay = RainViewer radar, past frames only.",
    ov_obs: "Rain reported at: {0}", ov_noobs: "No rain reported at any airport station", ov_echo: "Radar echo near: {0}", ov_noecho: "No radar echo near tracked places", ov_radar_na: "Radar check unavailable right now", ov_nolive: "Airport reports unavailable right now", updated: "Updated {0}",
    val_title: "Radar vs airport reports", val_none: "Validation log not available yet", val_since: "Collecting since {0}", val_counts: "{0} comparisons · {1} rain reports", val_insufficient: "Too few rain events to score yet (need at least 5). Rates are withheld rather than guessed.", val_pod: "Detection rate", val_far: "False-alarm rate", val_csi: "Critical success index", val_dry: "Radar echo when no rain reported", val_hit: "Hit", val_miss: "Miss", val_fa: "False alarm", val_cn: "Correct negative", val_issue: "Radar tile read issues: {0}", val_note: "Compared at airport locations only. A radar echo does not always mean rain on the ground.",
    official: "Official warnings", official_text: "Not connected. For official warnings use NCM's UAE Weather app or website.", official_link: "Official channels",
    about: "Data and limits", about_src: "Sources: airport METARs (NOAA AviationWeather), radar by RainViewer (past frames, personal use), forecast by Open-Meteo (CC BY 4.0, non-commercial), map © OpenStreetMap.", about_l1: "Radar shows echoes, not confirmed rain; it has no forecast frames, so no minute-by-minute prediction is shown.", about_l2: "Airport reports are real measurements but only at 9 airports and only every 30 minutes.", about_l3: "Temperature, humidity, wind and rain chances are model values, not station measurements.", about_l4: "Hail is never claimed without an airport hail code.", status: "Source status",
    notify: "🔔 Alert me while open", notify_on: "🔔 Alerts on", rain_alert: "Rain reported near {0}", echo_alert: "Radar echo near {0} (unconfirmed)", wk: "Today"
  },
  ar: {
    title: "طقس ومطر الإمارات", pill_radar: "الرادار", pill_metar: "تقارير المطارات", pill_model: "نموذج التنبؤ", pill_official: "التحذيرات الرسمية", notconn: "غير متصلة", unavailable: "غير متاح", stale: "قديم", outdated: "قديم جدًا، غير مستخدم", ago: "قبل {0}", min: "د", h: "س", justnow: "الآن",
    badge_obs: "مرصود", badge_rad: "رادار", badge_mod: "نموذج", badge_off: "—",
    head_thunder: "عاصفة رعدية مُبلَّغ عنها في المطار", head_rain: "أمطار مُبلَّغ عنها في المطار", head_echo: "الرادار يُظهر صدى يشبه المطر (غير مؤكد على الأرض)", head_none: "لا أمطار مرصودة ولا على الرادار", head_none_noradar: "لا أمطار مُبلَّغ عنها في المطار؛ الرادار غير متاح", head_noecho_notlive: "لا صدى على الرادار؛ بيانات المطار غير متاحة", head_noecho_nostation: "لا صدى على الرادار؛ لا توجد محطة قريبة", head_nodata: "لا توجد بيانات رصد حديثة",
    obs_report: "تقرير {0} الساعة {1} ({2}): ", obs_none: "لا هطول مُبلَّغ عنه", obs_present: "الطقس الحالي: {0}", hail_code: "رمز برَد مُبلَّغ عنه", ts_reported: "عاصفة رعدية مُبلَّغ عنها", cb: "غيوم رعدية (CB/TCU) مُبلَّغ عنها", vicinity: "في محيط المطار: {0}", station_km: "المحطة على بُعد {0} كم", no_station: "لا توجد محطة رصد ضمن {0} كم (الأقرب {1} على بُعد {2} كم)", no_obs: "لا توجد بيانات رصد",
    radar_echo: "صدى رادار عند هذه النقطة", radar_noecho: "لا صدى رادار عند هذه النقطة", echo_note: "الصدى لا يعني مطرًا على الأرض", radar_unavail: "فحص الرادار غير متاح ({0})",
    model_now: "نموذج (غير مقاس) {0}: {1}°م · رطوبة {2}% · رياح {3} كم/س (هبّات {4})", model_pred: "المتوقع خلال 6 ساعات: احتمال المطر حتى {0}%، المجموع {1} مم", storm_possible: "طاقة الحمل {0} جول/كغ مع احتمال مطر ≥30% (عاصفة ممكنة)", model_ts: "النموذج يشير إلى عاصفة رعدية",
    hourly: "الساعات الـ12 القادمة (توقعات)", daily: "الأيام القادمة (توقعات)", feels: "الإحساس", humidity: "الرطوبة", wind: "الرياح", gusts: "الهبّات", rain_chance: "احتمال المطر",
    search_ph: "ابحث عن مكان في الإمارات (حتا، العين، الفجيرة…)", save: "☆ حفظ", saved: "★ محفوظ", no_results: "لا نتائج", searching: "جارٍ البحث…",
    play: "▶ تشغيل", pause: "❚❚ إيقاف", latest: "الأحدث", past: "سابق",
    leg_obs: "مطر مُبلَّغ عنه في المطار", leg_rad: "صدى رادار فقط", leg_none: "لا مطر", leg_unk: "لا بيانات", leg_station: "محطة مطار", leg_note: "الطبقة = رادار RainViewer، إطارات سابقة فقط.",
    ov_obs: "أمطار مُبلَّغ عنها في: {0}", ov_noobs: "لا أمطار مُبلَّغ عنها في أي مطار", ov_echo: "صدى رادار قرب: {0}", ov_noecho: "لا أصداء رادار قرب الأماكن المتابَعة", ov_radar_na: "فحص الرادار غير متاح حاليًا", ov_nolive: "تقارير المطارات غير متاحة حاليًا", updated: "آخر تحديث {0}",
    val_title: "الرادار مقابل تقارير المطارات", val_none: "سجل التحقق غير متاح بعد", val_since: "يجمع البيانات منذ {0}", val_counts: "{0} مقارنة · {1} تقرير مطر", val_insufficient: "عدد حالات المطر قليل جدًا للتقييم بعد (نحتاج 5 على الأقل). لا نخمّن النسب.", val_pod: "نسبة الكشف", val_far: "نسبة الإنذار الكاذب", val_csi: "مؤشر النجاح الحرج", val_dry: "صدى الرادار عند غياب تقارير المطر", val_hit: "إصابة", val_miss: "إخفاق", val_fa: "إنذار كاذب", val_cn: "سلبي صحيح", val_issue: "مشكلات قراءة بلاط الرادار: {0}", val_note: "المقارنة عند مواقع المطارات فقط. صدى الرادار لا يعني دائمًا مطرًا على الأرض.",
    official: "التحذيرات الرسمية", official_text: "غير متصلة. للتحذيرات الرسمية استخدم تطبيق أو موقع المركز الوطني للأرصاد.", official_link: "القنوات الرسمية",
    about: "البيانات والحدود", about_src: "المصادر: تقارير METAR للمطارات (NOAA AviationWeather)، الرادار من RainViewer (إطارات سابقة، استخدام شخصي)، التوقعات من Open-Meteo (CC BY 4.0، غير تجاري)، الخريطة © OpenStreetMap.", about_l1: "الرادار يُظهر أصداء وليس مطرًا مؤكدًا، ولا توجد إطارات مستقبلية لذلك لا يُعرض تنبؤ دقيقة بدقيقة.", about_l2: "تقارير المطارات قياسات حقيقية لكنها في 9 مطارات فقط وكل 30 دقيقة.", about_l3: "الحرارة والرطوبة والرياح واحتمالات المطر قيم نموذج وليست قياسات محطات.", about_l4: "لا نذكر البرَد دون رمز برَد من المطار.", status: "حالة المصادر",
    notify: "🔔 نبّهني أثناء فتح التطبيق", notify_on: "🔔 التنبيهات مفعّلة", rain_alert: "أمطار مُبلَّغ عنها قرب {0}", echo_alert: "صدى رادار قرب {0} (غير مؤكد)", wk: "اليوم"
  },
};
let lang = ls("lang") || ((navigator.language || "").toLowerCase().startsWith("ar") ? "ar" : "en");
const t = (k, ...a) => { let s = I18N[lang][k] ?? I18N.en[k] ?? k; a.forEach((v, i) => { s = s.split("{" + i + "}").join(v); }); return s; };
const loc = () => (lang === "ar" ? "ar-AE-u-nu-latn" : "en-GB");
const fmtT = (ms) => new Intl.DateTimeFormat(loc(), { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms));
const fmtDT = (ms) => new Intl.DateTimeFormat(loc(), { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms));
const ageMin = (ms) => Math.max(0, Math.round((Date.now() - ms) / 60000));
const ageTxt = (m) => (m < 1 ? t("justnow") : t("ago", m < 60 ? m + " " + t("min") : Math.floor(m / 60) + " " + t("h") + " " + (m % 60) + " " + t("min")));
const pname = (p) => (lang === "ar" ? p.ar || p.en : p.en);
function km(a, b) { const R = 6371, r = Math.PI / 180, dl = (b[0] - a[0]) * r, dn = (b[1] - a[1]) * r, x = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); }

const WC = (c) => c === 0 ? ["☀️", "Clear", "صافٍ"] : c <= 2 ? ["⛅", "Partly cloudy", "غائم جزئيًا"] : c === 3 ? ["☁️", "Overcast", "غائم"] : c <= 48 ? ["🌫️", "Fog", "ضباب"] : c <= 57 ? ["🌦️", "Drizzle", "رذاذ"] : c <= 67 ? ["🌧️", "Rain", "مطر"] : c <= 77 ? ["🌨️", "Snow", "ثلج"] : c <= 82 ? ["🌦️", "Showers", "زخات"] : ["⛈️", "Thunderstorm", "عاصفة رعدية"];
const wcLabel = (c) => { const w = WC(c ?? 0); return w[0] + " " + (lang === "ar" ? w[2] : w[1]); };

const S = { map: null, frames: [], rv: null, layers: {}, idx: 0, timer: null, metar: null, om: {}, probes: {}, val: null, health: null, sel: ls("sel") || "dubai", favs: ls("favs") || [], custom: ls("custom") || [], markers: {}, stMarkers: [], log: [], busy: false, lastLoad: 0, notified: {}, results: [] };
const places = () => CITIES.concat(S.custom);
const byId = (id) => places().find((p) => p.id === id);

/* ---------------- data ---------------- */
function log(name, ok, detail, ms) { S.log.push({ name, ok, detail, ms }); }
async function getJSON(name, url) {
  const t0 = performance.now();
  try {
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 15000);
    const r = await fetch(url, { signal: ctl.signal, cache: "no-store" }); clearTimeout(to);
    const ms = Math.round(performance.now() - t0);
    if (!r.ok) { log(name, false, "HTTP " + r.status, ms); return null; }
    const j = await r.json(); log(name, true, "HTTP " + r.status, ms); return j;
  } catch (e) { log(name, false, e.name === "AbortError" ? "timeout" : (e.message || String(e)), Math.round(performance.now() - t0)); return null; }
}
async function loadRadar() {
  const j = await getJSON("RainViewer", "https://api.rainviewer.com/public/weather-maps.json");
  if (!j || !j.radar || !Array.isArray(j.radar.past) || !j.radar.past.length) { S.rv = null; S.frames = []; return; }
  S.rv = { host: j.host };
  S.frames = j.radar.past.map((f) => ({ time: f.time * 1000, path: f.path }));
  Object.values(S.layers).forEach((l) => S.map.removeLayer(l)); S.layers = {};
  const sl = $("slider"); sl.max = S.frames.length - 1; sl.value = S.frames.length - 1;
  showFrame(S.frames.length - 1);
}
function radarState() {
  if (!S.frames.length) return { k: "bad", txt: t("unavailable"), m: null };
  const f = S.frames[S.frames.length - 1], m = ageMin(f.time);
  if (m <= RADAR_FRESH) return { k: "fresh", txt: fmtT(f.time) + " · " + ageTxt(m), m };
  if (m <= RADAR_STALE) return { k: "stale", txt: t("stale") + " " + fmtT(f.time) + " · " + ageTxt(m), m };
  return { k: "bad", txt: t("outdated") + " (" + ageTxt(m) + ")", m };
}
function showFrame(i) {
  if (!S.frames.length || !S.map) return;
  S.idx = i; const f = S.frames[i];
  Object.entries(S.layers).forEach(([k, l]) => l.setOpacity(+k === i ? 0.7 : 0));
  if (!S.layers[i]) {
    const l = L.tileLayer(`${S.rv.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`, { opacity: 0.7, maxNativeZoom: 7, maxZoom: 12, zIndex: 400 + i, attribution: "Weather data by RainViewer" });
    l.addTo(S.map); S.layers[i] = l;
  }
  const rs = radarState();
  $("frameLbl").textContent = `${fmtDT(f.time)} · ${i === S.frames.length - 1 ? t("latest") : t("past")}${rs.k === "fresh" ? "" : " ⚠ " + rs.txt}`;
  $("slider").value = i;
}
async function loadMetar() {
  const ids = Object.keys(STATION_LL).join(",");
  const j = await getJSON("METAR (worker)", "/api/metar?ids=" + ids + "&hours=3");
  if (!Array.isArray(j) || !j.length) { S.metar = null; return; }
  const latest = {};
  j.forEach((r) => { if (!r.icaoId || !r.obsTime) return; if (!latest[r.icaoId] || r.obsTime > latest[r.icaoId].obsTime) latest[r.icaoId] = r; });
  Object.values(latest).forEach((r) => { r.ms = r.obsTime * 1000; r.wxp = parseWx(r.wxString); r.cb = /\b[A-Z]{3}\d{3}(CB|TCU)\b/.test(r.rawOb || ""); r.ll = r.lat != null && r.lon != null ? [r.lat, r.lon] : STATION_LL[r.icaoId]; });
  S.metar = { latest, at: Date.now() };
}
function parseWx(w) {
  const o = { at: [], vc: [], hail: false, thunder: false };
  (w || "").split(/\s+/).filter(Boolean).forEach((tok) => {
    const x = tok.replace(/^[-+]/, "");
    if (x.startsWith("VC")) { o.vc.push(x.slice(2)); return; }
    if (/(TS|SH|RA|DZ|GR|GS|UP|SN|PL|SG|IC)/.test(x)) { o.at.push(tok); if (x.includes("GR") || x.includes("GS")) o.hail = true; if (x.includes("TS")) o.thunder = true; }
  });
  return o;
}
function metarState(r) { const m = ageMin(r.ms); return { m, k: m <= METAR_FRESH ? "fresh" : m <= METAR_STALE ? "stale" : "bad" }; }
async function loadOM() {
  const ps = places();
  const url = "https://api.open-meteo.com/v1/forecast?latitude=" + ps.map((p) => p.lat).join(",") + "&longitude=" + ps.map((p) => p.lng).join(",") +
    "&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m" +
    "&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,cape&forecast_hours=12" +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum&forecast_days=4&wind_speed_unit=kmh&timezone=Asia%2FDubai";
  const j = await getJSON("Open-Meteo", url);
  if (!j) { S.om = {}; return; }
  const arr = Array.isArray(j) ? j : [j]; S.om = {};
  arr.forEach((r, i) => {
    const off = (r.utc_offset_seconds || 0) * 1000, c = r.current || {}, h = r.hourly || {}, d = r.daily || {};
    const tm = Date.parse(c.time + ":00Z") - off;
    const sum = (a) => (a || []).slice(0, 6).reduce((x, y) => x + (y || 0), 0), mx = (a) => Math.max(0, ...(a || []).slice(0, 6).map((v) => v || 0));
    S.om[ps[i].id] = {
      t: tm, temp: c.temperature_2m, feels: c.apparent_temperature, rh: c.relative_humidity_2m, code: c.weather_code, wind: c.wind_speed_10m, gust: c.wind_gusts_10m,
      hourly: (h.time || []).map((x, k) => ({ h: x.slice(11, 16), p: h.precipitation_probability[k], mm: h.precipitation[k], temp: h.temperature_2m[k], code: h.weather_code[k] })),
      daily: (d.time || []).map((x, k) => ({ date: x, hi: d.temperature_2m_max[k], lo: d.temperature_2m_min[k], p: d.precipitation_probability_max[k], mm: d.precipitation_sum[k], code: d.weather_code[k] })),
      next6p: mx(h.precipitation_probability), next6mm: sum(h.precipitation), cape: mx(h.cape),
    };
  });
}
async function loadValidation() {
  S.val = await getJSON("Validation log", "/api/validation?days=30");
  S.health = await getJSON("Collector health", "/api/health");
}
function tileXY(lat, lng, z) { const n = 2 ** z, x = (lng + 180) / 360 * n, r = lat * Math.PI / 180, y = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n; return { tx: Math.floor(x), ty: Math.floor(y), px: Math.floor((x % 1) * 256), py: Math.floor((y % 1) * 256) }; }
function probe(p, f) {
  return new Promise((res) => {
    const { tx, ty, px, py } = tileXY(p.lat, p.lng, 7);
    const url = `${S.rv.host}${f.path}/256/7/${tx}/${ty}/2/0_0.png`;
    const im = new Image(); im.crossOrigin = "anonymous";
    im.onload = () => {
      try {
        const c = document.createElement("canvas"); c.width = c.height = 256; const g = c.getContext("2d"); g.drawImage(im, 0, 0);
        const d = g.getImageData(Math.max(0, px - 2), Math.max(0, py - 2), 5, 5).data; let a = 0;
        for (let i = 3; i < d.length; i += 4) a = Math.max(a, d[i]);
        res({ state: a > 8 ? "echo" : "none", alpha: a });
      } catch (e) { res({ state: "blocked" }); }
    };
    im.onerror = () => res({ state: "error" });
    im.src = url;
  });
}
async function probeAll() {
  S.probes = {};
  if (!S.frames.length || radarState().k === "bad") { places().forEach((p) => { S.probes[p.id] = { state: "unavailable" }; }); return; }
  const f = S.frames[S.frames.length - 1];
  await Promise.all(places().map(async (p) => { S.probes[p.id] = await probe(p, f); }));
}

/* ---------------- assessment ---------------- */
function assess(p) {
  let near = null, d = null;
  if (S.metar) Object.values(S.metar.latest).forEach((r) => { if (!r.ll) return; const x = km([p.lat, p.lng], r.ll); if (d == null || x < d) { d = x; near = r; } });
  const useObs = near && d <= OBS_MAX_KM, ms = useObs ? metarState(near) : null;
  const pr = S.probes[p.id], rs = radarState(), rows = [];
  if (useObs && ms.k !== "bad") {
    const w = near.wxp;
    let s = t("obs_report", near.icaoId, fmtT(near.ms), ageTxt(ms.m) + (ms.k === "stale" ? " ⚠ " + t("stale") : ""));
    s += w.at.length ? t("obs_present", esc(w.at.join(" "))) + (w.hail ? " · " + t("hail_code") : "") + (w.thunder ? " · " + t("ts_reported") : "") : t("obs_none") + (near.wxString ? " (" + esc(near.wxString) + ")" : "") + " · " + near.temp + "°C" + (near.cb ? " · " + t("cb") : "");
    rows.push(["obs", s]);
    if (w.vc.length) rows.push(["obs", t("vicinity", esc(w.vc.join(" ")))]);
    if (d > 10) rows.push(["obs", t("station_km", Math.round(d))]);
  } else if (near) rows.push(["off", t("no_station", OBS_MAX_KM, near.icaoId, Math.round(d)) + (ms && ms.k === "bad" ? " · " + t("outdated") : "")]);
  else rows.push(["off", t("no_obs")]);
  if (pr && (pr.state === "echo" || pr.state === "none") && rs.k !== "bad") rows.push(["rad", `${pr.state === "echo" ? t("radar_echo") : t("radar_noecho")} · ${rs.txt}${rs.k === "stale" ? " ⚠" : ""} · ${t("echo_note")}`]);
  else rows.push(["off", t("radar_unavail", pr ? pr.state : "—")]);
  const om = S.om[p.id];
  if (om) {
    const a = ageMin(om.t);
    rows.push(["mod", t("model_now", fmtT(om.t) + (a > OM_FRESH ? " ⚠ " + ageTxt(a) : ""), om.temp, om.rh, Math.round(om.wind), Math.round(om.gust))]);
    rows.push(["mod", t("model_pred", om.next6p, om.next6mm.toFixed(1)) + (om.cape > 1000 && om.next6p >= 30 ? " · " + t("storm_possible", Math.round(om.cape)) : "") + (om.code >= 95 ? " · " + t("model_ts") : "")]);
  } else rows.push(["off", t("unavailable") + " (Open-Meteo)"]);
  const obsRain = useObs && ms.k !== "bad" && near.wxp.at.length > 0;
  const echo = pr && pr.state === "echo" && rs.k !== "bad", radarOk = pr && pr.state === "none" && rs.k !== "bad", liveObs = useObs && ms.k !== "bad";
  let head, cat;
  if (obsRain) { head = near.wxp.thunder ? "head_thunder" : "head_rain"; cat = "obs"; }
  else if (echo) { head = "head_echo"; cat = "rad"; }
  else if (liveObs && radarOk) { head = "head_none"; cat = "none"; }
  else if (liveObs) { head = "head_none_noradar"; cat = "none"; }
  else if (radarOk) { head = useObs ? "head_noecho_notlive" : "head_noecho_nostation"; cat = "unk"; }
  else { head = "head_nodata"; cat = "unk"; }
  return { head, cat, rows, near, d, useObs, ms, obsMs: near ? near.ms : null };
}
const CATCOL = { obs: "#0b5cad", rad: "#7b3fc4", none: "#4a8a5b", unk: "#8a969b" };

/* ---------------- render ---------------- */
function renderStatic() {
  document.documentElement.lang = lang; document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  document.title = t("title"); $("title").textContent = t("title"); $("langBtn").textContent = lang === "ar" ? "EN" : "ع";
  $("q").placeholder = t("search_ph"); $("play").textContent = S.timer ? t("pause") : t("play");
  $("legend").innerHTML = `<span class="dot" style="background:${CATCOL.obs}"></span>${t("leg_obs")} · <span class="dot" style="background:${CATCOL.rad}"></span>${t("leg_rad")} · <span class="dot" style="background:${CATCOL.none}"></span>${t("leg_none")} · <span class="dot" style="background:${CATCOL.unk}"></span>${t("leg_unk")} · ■ ${t("leg_station")}. ${t("leg_note")}`;
  const nb = $("notify"); if ("Notification" in window) { nb.hidden = false; const on = ls("notify") && Notification.permission === "granted"; nb.textContent = on ? t("notify_on") : t("notify"); nb.classList.toggle("on", !!on); }
}
function renderPills() {
  const rs = radarState(), pills = [];
  pills.push(`<span class="pill ${rs.k}">${t("pill_radar")} <b>${esc(rs.txt)}</b></span>`);
  if (S.metar) { const ts = Object.values(S.metar.latest).map((r) => r.ms), nw = Math.max(...ts), k = metarState({ ms: nw }); pills.push(`<span class="pill ${k.k}">${t("pill_metar")} <b>${fmtT(nw)} · ${ageTxt(k.m)}</b></span>`); }
  else pills.push(`<span class="pill bad">${t("pill_metar")} <b>${t("unavailable")}</b></span>`);
  const any = Object.values(S.om)[0];
  pills.push(`<span class="pill ${any ? (ageMin(any.t) <= OM_FRESH ? "fresh" : "stale") : "bad"}">${t("pill_model")} <b>${any ? fmtT(any.t) + " · " + ageTxt(ageMin(any.t)) : t("unavailable")}</b></span>`);
  pills.push(`<span class="pill bad">${t("pill_official")} <b>${t("notconn")}</b></span>`);
  $("pills").innerHTML = pills.join("");
}
function renderOverview(res) {
  const obs = res.filter((x) => x.a.cat === "obs").map((x) => esc(pname(x.p))), rad = res.filter((x) => x.a.cat === "rad").map((x) => esc(pname(x.p)));
  let h = `<h2>${t("title")}</h2>`;
  if (!S.metar) h += `<div class="big" style="color:var(--bad)">${t("ov_nolive")}</div>`;
  else h += `<div class="big" style="color:${obs.length ? CATCOL.obs : "var(--none)"}">${obs.length ? t("ov_obs", obs.join(", ")) : t("ov_noobs")}</div>`;
  const radarUsable = radarState().k !== "bad" && res.some((x) => S.probes[x.p.id] && (S.probes[x.p.id].state === "echo" || S.probes[x.p.id].state === "none"));
  h += `<div style="color:${rad.length ? CATCOL.rad : "var(--muted)"}">${rad.length ? t("ov_echo", rad.join(", ")) : radarUsable ? t("ov_noecho") : t("ov_radar_na")}</div><div class="muted">${t("updated", fmtDT(Date.now()))}</div>`;
  $("overview").innerHTML = h;
}
function renderAlerts(res) {
  const watch = res.filter((x) => S.favs.includes(x.p.id) || x.p.id === S.sel), out = [];
  watch.forEach((x) => {
    if (x.a.cat === "obs") { out.push(`<div class="alert">🌧 ${t("rain_alert", esc(pname(x.p)))}</div>`); maybeNotify(x); }
    else if (x.a.cat === "rad") out.push(`<div class="alert rad">📡 ${t("echo_alert", esc(pname(x.p)))}</div>`);
  });
  $("alerts").innerHTML = out.join("");
}
function maybeNotify(x) {
  if (!S.favs.includes(x.p.id) || !ls("notify") || !("Notification" in window) || Notification.permission !== "granted") return;
  const key = x.p.id + ":" + x.a.obsMs; if (S.notified[key]) return; S.notified[key] = 1;
  try { new Notification(t("rain_alert", pname(x.p)), { body: t(x.a.head) }); } catch (_) {}
}
function renderMap(res) {
  if (!S.map) return;
  Object.values(S.markers).forEach((m) => S.map.removeLayer(m)); S.markers = {};
  res.forEach(({ p, a }) => {
    const sel = p.id === S.sel;
    const m = L.circleMarker([p.lat, p.lng], { radius: sel ? 13 : 9, color: sel ? "#12262d" : "#fff", weight: sel ? 3 : 2, fillColor: CATCOL[a.cat], fillOpacity: 1 }).addTo(S.map);
    m.bindTooltip(pname(p) + ": " + t(a.head)); m.on("click", () => select(p.id)); S.markers[p.id] = m;
  });
  S.stMarkers.forEach((m) => S.map.removeLayer(m)); S.stMarkers = [];
  if (S.metar) Object.values(S.metar.latest).forEach((r) => {
    if (!r.ll) return;
    const m = L.marker(r.ll, { icon: L.divIcon({ className: "", html: '<div style="width:10px;height:10px;background:#12262d;border:2px solid #fff"></div>', iconSize: [10, 10] }) }).addTo(S.map);
    m.bindPopup(`<b>${esc(r.icaoId)}</b> ${esc(r.name || "")}<br>${esc(r.rawOb || "")}<br>${fmtDT(r.ms)} (${ageTxt(ageMin(r.ms))})`); S.stMarkers.push(m);
  });
}
function renderChips() {
  const ps = places().slice().sort((a, b) => (S.favs.includes(b.id) ? 1 : 0) - (S.favs.includes(a.id) ? 1 : 0));
  $("chips").innerHTML = ps.map((p) => `<button class="chip ${p.id === S.sel ? "sel" : ""}" data-id="${esc(p.id)}">${S.favs.includes(p.id) ? "★ " : ""}${esc(pname(p))}</button>`).join("");
  $("chips").querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => select(b.dataset.id)));
}
function renderDetail(res) {
  const x = res.find((r) => r.p.id === S.sel) || res[0]; if (!x) return;
  const { p, a } = x, om = S.om[p.id], fav = S.favs.includes(p.id);
  const tagC = { obs: ["badge_obs", "t-obs"], rad: ["badge_rad", "t-rad"], mod: ["badge_mod", "t-mod"], off: ["badge_off", "t-off"] };
  let h = `<div class="card"><h2><span>${esc(pname(p))}</span><button id="favBtn" class="ghost">${fav ? t("saved") : t("save")}</button></h2>`;
  h += `<div class="head" style="color:${CATCOL[a.cat]}">${t(a.head)}</div>`;
  h += a.rows.map((r) => `<div class="row"><span class="tag ${tagC[r[0]][1]}">${t(tagC[r[0]][0])}</span><span>${r[1]}</span></div>`).join("");
  if (a.useObs && a.near && a.ms.k !== "bad") h += `<div class="raw">${esc(a.near.rawOb)}</div>`;
  if (om) {
    h += `<h3>${t("badge_mod")}</h3><div class="temprow"><span class="bigtemp">${Math.round(om.temp)}°</span><span>${wcLabel(om.code)}</span></div>`;
    h += `<div class="kv"><div>${t("feels")}<b>${Math.round(om.feels)}°</b></div><div>${t("humidity")}<b>${om.rh}%</b></div><div>${t("wind")}<b>${Math.round(om.wind)} km/h</b></div><div>${t("gusts")}<b>${Math.round(om.gust)} km/h</b></div></div>`;
    h += `<h3>${t("hourly")}</h3><div class="hours">` + om.hourly.map((q) => `<div class="hr"><div>${q.h.slice(0, 2)}</div><div class="bar" title="${q.p}% · ${q.mm} mm"><i style="height:${Math.max(2, q.p)}%"></i></div><div>${q.p}%</div><div class="muted">${Math.round(q.temp)}°${q.mm > 0 ? "<br>" + q.mm + "mm" : ""}</div></div>`).join("") + `</div>`;
    h += `<h3>${t("daily")}</h3><div class="days">` + om.daily.map((d, i) => { const dn = i === 0 ? t("wk") : new Intl.DateTimeFormat(loc(), { timeZone: TZ, weekday: "short", day: "numeric" }).format(new Date(d.date + "T12:00:00+04:00")); return `<div class="day"><span>${esc(dn)}</span><span>${WC(d.code ?? 0)[0]}</span><span>${Math.round(d.hi)}° / ${Math.round(d.lo)}°</span><span class="muted">${d.p}% · ${(d.mm || 0).toFixed(1)} mm</span></div>`; }).join("") + `</div>`;
  }
  h += `<div class="row" style="margin-top:10px"><span class="tag t-off">${t("pill_official")}</span><span>${t("official_text")} <a href="https://u.ae/en/information-and-services/environment-and-energy/weather-conditions-and-environmental-status" target="_blank" rel="noopener">${t("official_link")}</a></span></div></div>`;
  $("detail").innerHTML = h;
  $("favBtn").addEventListener("click", () => { S.favs = fav ? S.favs.filter((i) => i !== p.id) : S.favs.concat(p.id); ls("favs", S.favs); render(); });
}
function renderValidation() {
  const v = S.val; let h = `<h2 style="margin:0 0 6px;font-size:16px">${t("val_title")}</h2>`;
  if (!v || v.error) h += `<div class="muted">${t("val_none")}</div>`;
  else {
    h += `<div class="muted">${v.collectingSince ? t("val_since", fmtDT(v.collectingSince)) : t("val_none")} · ${t("val_counts", v.pairs, v.rainEvents)}</div>`;
    const m = v.matrix || {};
    h += `<div class="kv"><div>${t("val_hit")}<b>${m.hit ?? 0}</b></div><div>${t("val_miss")}<b>${m.miss ?? 0}</b></div><div>${t("val_fa")}<b>${m.falseAlarm ?? 0}</b></div><div>${t("val_cn")}<b>${m.correctNeg ?? 0}</b></div></div>`;
    if (v.enough) h += `<div class="kv"><div>${t("val_pod")}<b>${Math.round(v.pod * 100)}%</b></div><div>${t("val_far")}<b>${Math.round(v.far * 100)}%</b></div><div>${t("val_csi")}<b>${v.csi}</b></div></div>`;
    else h += `<p class="muted">${t("val_insufficient")}</p>`;
    if (v.echoRateWhenDry != null) h += `<div class="muted">${t("val_dry")}: ${Math.round(v.echoRateWhenDry * 100)}%</div>`;
    const bad = Object.entries(v.radarSampleStates || {}).filter(([k]) => k !== "ok"); if (bad.length) h += `<p class="fail">${t("val_issue", esc(bad.map(([k, n]) => k + " ×" + n).join(", ")))}</p>`;
    h += `<p class="muted">${t("val_note")}</p>`;
  }
  $("validation").innerHTML = h;
}
function renderAbout() {
  let h = `<h2 style="margin:0 0 6px;font-size:16px">${t("about")}</h2><p class="muted">${t("about_src")}</p><ul class="muted"><li>${t("about_l1")}</li><li>${t("about_l2")}</li><li>${t("about_l3")}</li><li>${t("about_l4")}</li></ul>`;
  h += `<details><summary>${t("status")}</summary><table>` + S.log.map((l) => `<tr><td>${esc(l.name)}</td><td class="${l.ok ? "ok" : "fail"}">${l.ok ? "OK" : "FAIL"}</td><td>${esc(l.detail)}</td><td>${l.ms ?? ""} ms</td></tr>`).join("") + `</table>`;
  if (S.health && S.health.last) h += `<p class="muted">Collector: last run ${fmtDT(S.health.last.at_ms)} · METAR rows ${S.health.counts.metar} · radar rows ${S.health.counts.radar}${S.health.last.errors ? " · " + esc(S.health.last.errors) : ""}</p>`;
  $("about").innerHTML = h + `</details>`;
}
function render() {
  renderStatic(); renderPills();
  const res = places().map((p) => ({ p, a: assess(p) }));
  renderOverview(res); renderMap(res); renderChips(); renderDetail(res); renderAlerts(res); renderValidation(); renderAbout();
  if (window.renderRain) window.renderRain();
  if (window.renderCommunity) window.renderCommunity();
  if (S.frames.length) showFrame(S.idx);
}
function select(id) { S.sel = id; ls("sel", id); const p = byId(id); if (p && S.map) S.map.panTo([p.lat, p.lng]); render(); window.scrollTo({ top: $("chips").offsetTop - 8, behavior: "smooth" }); }

/* ---------------- search (local list + Open-Meteo geocoding, UAE only) ---------------- */
let qTimer = null;
function renderResults(list, msg) {
  const box = $("results"); S.results = list;
  if (!list.length && !msg) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = list.map((r, i) => `<button data-i="${i}">${esc(r.label)}</button>`).join("") + (msg ? `<div class="muted" style="padding:8px 12px">${msg}</div>` : "");
  box.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => pick(S.results[+b.dataset.i])));
}
async function pick(r) {
  $("results").hidden = true; $("q").value = "";
  if (r.id && byId(r.id)) return select(r.id);
  const p = { id: r.newId, en: r.en, ar: r.ar || r.en, lat: r.lat, lng: r.lng };
  S.custom = S.custom.concat(p); ls("custom", S.custom); S.favs = S.favs.concat(p.id); ls("favs", S.favs);
  S.sel = p.id; ls("sel", p.id);
  await Promise.all([loadOM(), probeAll()]); if (S.map) S.map.setView([p.lat, p.lng], 9); render();
}
function onSearch() {
  const q = $("q").value.trim(), ql = q.toLowerCase(); clearTimeout(qTimer);
  if (q.length < 2) return renderResults([]);
  const local = places().filter((p) => p.en.toLowerCase().includes(ql) || (p.ar || "").includes(q)).map((p) => ({ id: p.id, label: pname(p) }));
  renderResults(local, q.length >= 3 ? t("searching") : "");
  if (q.length < 3) return;
  qTimer = setTimeout(async () => {
    const j = await getJSON("Geocoding", `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=${lang}&countryCode=AE&format=json`);
    const extra = ((j && j.results) || []).filter((r) => !places().some((p) => km([p.lat, p.lng], [r.latitude, r.longitude]) < 3)).map((r) => ({ newId: "g" + r.id, en: r.name, ar: lang === "ar" ? r.name : null, lat: r.latitude, lng: r.longitude, label: "＋ " + r.name + (r.admin1 ? ", " + r.admin1 : "") }));
    const all = local.concat(extra);
    renderResults(all, all.length ? "" : t("no_results"));
  }, 350);
}

/* ---------------- boot ---------------- */
async function loadAll() {
  if (S.busy) return; S.busy = true;
  try {
    S.log = [];
    await Promise.all([loadRadar(), loadMetar(), loadOM(), loadValidation(), window.loadRain ? window.loadRain() : null, window.loadCommunity ? window.loadCommunity() : null]);
    await probeAll(); S.lastLoad = Date.now(); render();
  } finally { S.busy = false; }
}
function play() { if (!S.frames.length) return; let i = S.idx >= S.frames.length - 1 ? 0 : S.idx; showFrame(i); S.timer = setInterval(() => { i = (i + 1) % S.frames.length; showFrame(i); }, 900); $("play").textContent = t("pause"); }
function stop() { clearInterval(S.timer); S.timer = null; $("play").textContent = t("play"); }
function init() {
  renderStatic();
  S.map = L.map("map").setView([24.6, 55.4], 7);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 12, attribution: "© OpenStreetMap contributors" }).addTo(S.map);
  $("slider").addEventListener("input", (e) => { stop(); showFrame(+e.target.value); });
  $("play").addEventListener("click", () => (S.timer ? stop() : play()));
  $("langBtn").addEventListener("click", () => { lang = lang === "ar" ? "en" : "ar"; ls("lang", lang); render(); });
  $("q").addEventListener("input", onSearch);
  document.addEventListener("click", (e) => { if (!e.target.closest(".search")) $("results").hidden = true; });
  $("notify").addEventListener("click", async () => {
    if (ls("notify")) { ls("notify", false); return render(); }
    try { const r = await Notification.requestPermission(); ls("notify", r === "granted"); } catch (_) {}
    render();
  });
  loadAll(); setInterval(loadAll, 5 * 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - S.lastLoad > 2 * 60 * 1000) loadAll(); });
  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register("sw.js").catch(() => {});
}
if (window.L) init(); else document.body.insertAdjacentHTML("afterbegin", '<div class="card" style="border-color:var(--bad)">Map library failed to load (offline or blocked).</div>');
