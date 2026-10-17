"use strict";
/* Where's the Rain? + Rain Near Me + safety check + directions.
   Radar echo areas are found by the Worker (/api/scan) from RainViewer tiles; distances are measured here, in the browser,
   so the user's location never leaves the device. "No echo" is never worded as "dry". Intensity is not shown (not validated). */
Object.assign(I18N.en, {
  r_title: "Where's the Rain?", r_sub: "Places near recent radar precipitation echoes", r_loading: "Reading radar…", r_fail: "Radar scan unavailable right now. Showing nothing rather than guessing.",
  r_frame: "Radar frame {0}", r_fresh: "fresh", r_stale: "STALE, treat with caution", r_outdated: "OUTDATED, not used",
  r_cov_ok: "Coverage layer read", r_cov_bad: "Coverage layer unavailable (cannot tell dry from no coverage)", r_cov_none: "Coverage not read yet",
  r_val_no: "Echo detection not yet validated against airport reports ({0} of 5 rain reports needed so far).", r_val_yes: "Echo detection checked against airport reports: detection {0}%, false alarms {1}%.",
  r_radius: "Search radius", r_km: "{0} km", r_loc: "📍 Use my location", r_loc_on: "📍 Location on", r_loc_off: "Clear", r_loc_denied: "Location permission was denied. Showing the whole UAE instead.", r_loc_fail: "Could not get your location. Showing the whole UAE instead.", r_loc_out: "Your location is outside the UAE radar area.", r_loc_priv: "Your location stays on this device: distances are calculated here and nothing is sent or stored.",
  r_nm_title: "Rain near me · within {0} km", r_nm_none: "No radar echo detected within {0} km of you in this frame. This does not prove it is dry: radar can miss light or low-level rain and coverage is not validated.", r_nm_nearest: "Nearest echo: {0} km ({1})", r_nm_n: "{0} echo area(s) within {1} km", r_area: "echo area ≈ {0} km²", r_near_place: "near {0} ({1} km)",
  r_trend_close: "closing in: {0} km nearer than {1} min ago", r_trend_away: "moving away: {0} km farther than {1} min ago", r_trend_same: "about the same distance as {0} min ago", r_trend_new: "new since {0} min ago", r_trend_note: "Based on past frames only; this is not a forecast of where it will go.",
  r_all_title: "Radar echoes near listed places · whole UAE", r_all_none: "No radar echo detected near any of the {0} listed places in this frame. This does not prove it is dry: radar can miss light or low-level rain and coverage is not validated.", r_all_n: "{0} place(s) with an echo within {1} km",
  r_unnamed: "{0} radar echo area(s) have no listed place within 10 km (largest ≈ {1} km², near {2}).", r_more: "Show {0} more", r_less: "Show fewer",
  r_over: "Radar echo over this spot", r_nearx: "Radar echo {0} km away ({1})", r_nonex: "No radar echo detected within 10 km", r_nonex_n: " · nearest {0} km ({1})", r_unavail: "Radar unavailable for this spot", r_uncovered: "Outside the radar coverage layer: radar cannot say anything here",
  r_inten: "Intensity: not available (radar strength is not validated against rainfall observations)", r_echo_note: "A radar echo is not proof of rain on the ground.",
  r_temp: "{0}°C", r_fc: "rain chance up to {0}% in the next 6 h", r_fc_ts: "model shows thunderstorm risk", r_fc_na: "forecast unavailable", r_model: "model", r_official: "Official warnings: not available (see safety check)",
  r_map: "Show on map", r_gmaps: "Google Maps", r_amaps: "Apple Maps", r_dir: "Directions", r_dir_warn: "Radar shows rain-like echoes here. Do not drive into rain, thunderstorms or flooded roads.",
  r_haz: "Wadis, dams and mountain roads can flood or have rockfall very quickly, even when the rain falls far away upstream. Avoid them when rain is detected or forecast.", r_haz_avoid: "Avoid today: rain detected within 50 km or forecast ≥ 20%.",
  s_title: "Safety check", s_off: "Official warnings (NCM)", s_off_bad: "NOT AVAILABLE", s_off_why: "No public machine-readable NCM warnings feed was found, so this app cannot read official warnings. Check the NCM website/app, Dubai Police / Ministry of Interior alerts and road conditions before you travel.", s_off_link: "Official channels",
  s_radar: "Radar", s_ts: "Airport thunderstorm reports (last {0} min)", s_ts_none: "none reported", s_ts_unk: "airport reports unavailable",
  s_incomplete: "Safety information is incomplete. Treat everything below as unconfirmed.", s_danger: "Rain-like echoes or thunderstorm reports close to you. Do not drive towards them. Avoid wadis, dams, mountain roads and low-lying or flooded roads.", s_clear_note: "No echo near you in this frame does not mean it is safe.",
  o_title: "Outing ideas (lower-risk candidates)", o_from: "From {0}", o_from_you: "your location", o_none: "No candidate meets the safety rules right now.", o_withheld: "Outing ideas are withheld: radar data is {0}.",
  o_rule: "Shown only if: radar is fresh, no echo within 25 km of the place, not a wadi/dam/mountain, forecast rain chance under 40% and no thunderstorm in the model. These are candidates, not a safety guarantee.", o_corridor: "Echo within {0} km of the straight line to here (not the road route)", o_ok_corridor: "No echo within 10 km of the straight line (not the road route)",
  o_use_city: "Distances measured from {0}. Turn on your location for distances from you.",
  em_au: "Abu Dhabi", dir_n: "N", dir_ne: "NE", dir_e: "E", dir_se: "SE", dir_s: "S", dir_sw: "SW", dir_w: "W", dir_nw: "NW"
});
Object.assign(I18N.ar, {
  r_title: "أين المطر؟", r_sub: "أماكن قريبة من أصداء هطول حديثة على الرادار", r_loading: "جارٍ قراءة الرادار…", r_fail: "فحص الرادار غير متاح الآن. لا نعرض شيئًا بدل التخمين.",
  r_frame: "إطار الرادار {0}", r_fresh: "حديث", r_stale: "قديم، تعامل معه بحذر", r_outdated: "قديم جدًا، غير مستخدم",
  r_cov_ok: "تمت قراءة طبقة التغطية", r_cov_bad: "طبقة التغطية غير متاحة (لا يمكن التمييز بين الجفاف وانعدام التغطية)", r_cov_none: "لم تُقرأ التغطية بعد",
  r_val_no: "لم يُتحقق بعد من كشف الأصداء مقابل تقارير المطارات (لدينا {0} من 5 تقارير مطر مطلوبة).", r_val_yes: "تم التحقق من كشف الأصداء مقابل تقارير المطارات: نسبة الكشف {0}%، الإنذارات الكاذبة {1}%.",
  r_radius: "نطاق البحث", r_km: "{0} كم", r_loc: "📍 استخدم موقعي", r_loc_on: "📍 الموقع مفعّل", r_loc_off: "إلغاء", r_loc_denied: "تم رفض إذن الموقع. نعرض كل الإمارات.", r_loc_fail: "تعذّر تحديد موقعك. نعرض كل الإمارات.", r_loc_out: "موقعك خارج نطاق رادار الإمارات.", r_loc_priv: "موقعك يبقى على جهازك: تُحسب المسافات هنا ولا يُرسل أو يُخزَّن شيء.",
  r_nm_title: "المطر قربي · ضمن {0} كم", r_nm_none: "لم يُكتشف صدى رادار ضمن {0} كم منك في هذا الإطار. هذا لا يثبت الجفاف: قد يفوّت الرادار المطر الخفيف أو المنخفض والتغطية غير مُتحقَّق منها.", r_nm_nearest: "أقرب صدى: {0} كم ({1})", r_nm_n: "{0} منطقة/مناطق صدى ضمن {1} كم", r_area: "مساحة الصدى ≈ {0} كم²", r_near_place: "قرب {0} ({1} كم)",
  r_trend_close: "يقترب: أقرب بـ {0} كم مما كان قبل {1} د", r_trend_away: "يبتعد: أبعد بـ {0} كم مما كان قبل {1} د", r_trend_same: "المسافة نفسها تقريبًا كما قبل {0} د", r_trend_new: "جديد منذ {0} د", r_trend_note: "استنادًا إلى إطارات سابقة فقط؛ ليس توقعًا لمساره.",
  r_all_title: "أصداء الرادار قرب الأماكن المدرجة · كل الإمارات", r_all_none: "لم يُكتشف صدى رادار قرب أي من {0} مكانًا مدرجًا في هذا الإطار. هذا لا يثبت الجفاف: قد يفوّت الرادار المطر الخفيف أو المنخفض والتغطية غير مُتحقَّق منها.", r_all_n: "{0} مكان/أماكن فيها صدى ضمن {1} كم",
  r_unnamed: "{0} منطقة/مناطق صدى لا يوجد مكان مدرج ضمن 10 كم منها (الأكبر ≈ {1} كم²، قرب {2}).", r_more: "عرض {0} أخرى", r_less: "عرض أقل",
  r_over: "صدى رادار فوق هذا الموقع", r_nearx: "صدى رادار على بُعد {0} كم ({1})", r_nonex: "لم يُكتشف صدى رادار ضمن 10 كم", r_nonex_n: " · الأقرب {0} كم ({1})", r_unavail: "الرادار غير متاح لهذا الموقع", r_uncovered: "خارج طبقة تغطية الرادار: لا يستطيع الرادار قول شيء هنا",
  r_inten: "الشدة: غير متاحة (قوة الرادار غير مُتحقَّق منها مقابل قياسات المطر)", r_echo_note: "صدى الرادار ليس دليلًا على مطر على الأرض.",
  r_temp: "{0}°م", r_fc: "احتمال المطر حتى {0}% خلال 6 ساعات", r_fc_ts: "النموذج يُظهر خطر عواصف رعدية", r_fc_na: "التوقعات غير متاحة", r_model: "نموذج", r_official: "التحذيرات الرسمية: غير متاحة (انظر فحص السلامة)",
  r_map: "عرض على الخريطة", r_gmaps: "خرائط جوجل", r_amaps: "خرائط آبل", r_dir: "الاتجاهات", r_dir_warn: "الرادار يُظهر أصداء تشبه المطر هنا. لا تقد باتجاه المطر أو العواصف الرعدية أو الطرق المغمورة.",
  r_haz: "الأودية والسدود وطرق الجبال قد تفيض أو تشهد انهيارات صخرية بسرعة كبيرة، حتى لو سقط المطر بعيدًا في أعلى المجرى. تجنّبها عند رصد أو توقع المطر.", r_haz_avoid: "تجنّب اليوم: مطر مرصود ضمن 50 كم أو توقع ≥ 20%.",
  s_title: "فحص السلامة", s_off: "التحذيرات الرسمية (المركز الوطني للأرصاد)", s_off_bad: "غير متاحة", s_off_why: "لم نجد خلاصة تحذيرات رسمية عامة قابلة للقراءة آليًا، لذلك لا يستطيع التطبيق قراءة التحذيرات الرسمية. راجع موقع/تطبيق المركز الوطني للأرصاد وتنبيهات شرطة دبي ووزارة الداخلية وحالة الطرق قبل السفر.", s_off_link: "القنوات الرسمية",
  s_radar: "الرادار", s_ts: "تقارير العواصف الرعدية في المطارات (آخر {0} د)", s_ts_none: "لا يوجد", s_ts_unk: "تقارير المطارات غير متاحة",
  s_incomplete: "معلومات السلامة غير مكتملة. اعتبر كل ما يلي غير مؤكد.", s_danger: "أصداء تشبه المطر أو تقارير عواصف رعدية قريبة منك. لا تقد باتجاهها. تجنّب الأودية والسدود وطرق الجبال والطرق المنخفضة أو المغمورة.", s_clear_note: "عدم وجود صدى قربك في هذا الإطار لا يعني أن الوضع آمن.",
  o_title: "أفكار للخروج (مرشّحات أقل خطرًا)", o_from: "من {0}", o_from_you: "موقعك", o_none: "لا يوجد مرشّح يستوفي شروط السلامة الآن.", o_withheld: "أفكار الخروج محجوبة: بيانات الرادار {0}.",
  o_rule: "تظهر فقط إذا: الرادار حديث، ولا صدى ضمن 25 كم من المكان، وليس واديًا/سدًا/جبلًا، واحتمال المطر في التوقعات أقل من 40% ولا عاصفة رعدية في النموذج. هذه مرشّحات وليست ضمانًا للسلامة.", o_corridor: "صدى ضمن {0} كم من الخط المستقيم إلى هنا (وليس مسار الطريق)", o_ok_corridor: "لا صدى ضمن 10 كم من الخط المستقيم (وليس مسار الطريق)",
  o_use_city: "المسافات محسوبة من {0}. فعّل موقعك لحساب المسافات منك.",
  em_au: "أبوظبي", dir_n: "شمال", dir_ne: "شمال شرق", dir_e: "شرق", dir_se: "جنوب شرق", dir_s: "جنوب", dir_sw: "جنوب غرب", dir_w: "غرب", dir_nw: "شمال غرب"
});

const R = { db: null, scan: null, frame: null, prev: null, cover: null, status: "loading", radius: ls("rr") || 25, user: null, locMsg: "", fc: {}, fcAt: 0, sel: null, expanded: false, layer: null, analysed: [] };
const HAZ = new Set(["wadi", "dam", "mountain"]);
const dirTxt = (deg) => t("dir_" + ["n", "ne", "e", "se", "s", "sw", "w", "nw"][RG.compassIdx(deg)]);
const emName = (p) => { const e = R.db.emirates[p.em]; return (lang === "ar" ? e.ar : e.en) + (p.reg ? (lang === "ar" ? " · العين" : " · Al Ain") : ""); };
const rname = (p) => (lang === "ar" ? p.ar || p.en : p.en);

async function loadRain() {
  if (!window.RG) { try { window.RG = await import("./lib/radar-geo.js"); } catch (e) { R.status = "error"; return renderRain(); } }
  if (!R.db) {
    const d = await getJSON("Places database", "/data/places.json");
    if (d && Array.isArray(d.places)) { d.places.forEach((p) => { p.lng = p.lon; }); R.db = d; }
  }
  const j = await getJSON("Radar scan", "/api/scan");
  if (!R.db || !j || !Array.isArray(j.frames) || !j.frames.length) { R.scan = j && j.frames ? j : null; R.status = "error"; return renderRain(); }
  R.scan = j; R.frame = j.frames[0];
  R.prev = j.frames.find((f) => R.frame.ms - f.ms >= 12 * 60000 && R.frame.ms - f.ms <= 45 * 60000) || null;
  const cv = j.coverage;
  R.cover = cv && cv.state === "ok" ? { state: "ok", mask: RG.maskFromRuns(cv.runs, RG.GRID.W, RG.GRID.H) } : cv ? { state: "unavailable" } : null;
  R.status = "ok"; analyse(); renderRain();
  ensureForecast(shownPlaces()).then(renderRain);
}
function radarAge() { return R.frame ? ageMin(R.frame.ms) : null; }
function radarK() { if (!R.frame) return "bad"; const m = radarAge(); return m <= RADAR_FRESH ? "fresh" : m <= RADAR_STALE ? "stale" : "bad"; }

function analyse() {
  const out = R.db.places.map((p) => {
    const a = RG.analysePoint(p.lat, p.lng, R.frame, R.cover);
    if (a.covered === false && a.status !== "unavailable") a.status = "uncovered";
    const pa = R.prev ? RG.analysePoint(p.lat, p.lng, R.prev, null) : null;
    const d = R.user ? RG.haversineKm(R.user.lat, R.user.lon, p.lat, p.lng) : null;
    return { p, a, pa, d };
  });
  R.analysed = out;
}

/* ---- Rain Near Me (distance from the user to echo areas) ---- */
function nearMe() {
  if (!R.user || !R.frame) return null;
  const m = RG.llToMosaic(R.user.lat, R.user.lon);
  if (!RG.inGrid(m.x, m.y)) return { outside: true };
  const kpp = RG.kmPerPx(R.user.lat);
  const areas = [];
  R.frame.clusters.forEach((c) => {
    const ne = RG.nearestEcho(m.x, m.y, [c]); if (!ne) return;
    const km = ne.px * kpp; if (km > R.radius) return;
    const info = RG.clusterInfo(c);
    let np = null; R.db.places.forEach((p) => { const dd = RG.haversineKm(info.lat, info.lon, p.lat, p.lng); if (!np || dd < np.d) np = { p, d: dd }; });
    areas.push({ km: +km.toFixed(1), bearing: Math.round((Math.atan2(ne.dx, -ne.dy) * 180 / Math.PI + 360) % 360), info, near: np });
  });
  areas.sort((a, b) => a.km - b.km);
  const all = RG.nearestEcho(m.x, m.y, R.frame.clusters);
  const nearestKm = all ? +(all.px * kpp).toFixed(1) : null, nearestBearing = all ? Math.round((Math.atan2(all.dx, -all.dy) * 180 / Math.PI + 360) % 360) : null;
  let trend = null;
  if (R.prev) {
    const pe = RG.nearestEcho(m.x, m.y, R.prev.clusters), pk = pe ? pe.px * kpp : null, gap = Math.round((R.frame.ms - R.prev.ms) / 60000);
    if (nearestKm == null && pk == null) trend = null;
    else if (pk == null) trend = { k: "new", gap };
    else if (nearestKm == null) trend = { k: "away", d: Math.round(pk), gap };
    else { const dl = pk - nearestKm; trend = dl >= 3 ? { k: "close", d: Math.round(dl), gap } : dl <= -3 ? { k: "away", d: Math.round(-dl), gap } : { k: "same", gap }; }
  }
  const matches = R.analysed.filter((x) => (x.a.status === "over" || x.a.status === "near") && x.d != null && x.d <= R.radius).sort((a, b) => a.d - b.d);
  return { areas, nearestKm, nearestBearing, trend, matches };
}

/* ---- forecast for the places that are displayed (Open-Meteo, model values) ---- */
function shownPlaces() {
  const nm = R.user ? nearMe() : null;
  let list = nm && !nm.outside ? nm.matches.map((x) => x.p) : R.analysed.filter((x) => x.a.status === "over" || x.a.status === "near").sort((a, b) => a.a.nearestKm - b.a.nearestKm).map((x) => x.p);
  list = list.slice(0, 24);
  return list.concat(outingCandidates().map((x) => x.p)).filter((p, i, a) => a.findIndex((q) => q.id === p.id) === i);
}
async function ensureForecast(ps) {
  const need = ps.filter((p) => !R.fc[p.id] || Date.now() - R.fc[p.id].at > 15 * 60000).slice(0, 40);
  if (!need.length) return;
  const url = "https://api.open-meteo.com/v1/forecast?latitude=" + need.map((p) => p.lat).join(",") + "&longitude=" + need.map((p) => p.lng).join(",") +
    "&current=temperature_2m,weather_code&hourly=precipitation_probability,weather_code&forecast_hours=6&timezone=Asia%2FDubai";
  const j = await getJSON("Open-Meteo (places)", url); if (!j) return;
  (Array.isArray(j) ? j : [j]).forEach((r, i) => {
    const h = r.hourly || {}, c = r.current || {};
    R.fc[need[i].id] = { at: Date.now(), temp: c.temperature_2m, code: c.weather_code, p6: Math.max(0, ...(h.precipitation_probability || [0]).map((v) => v || 0)), ts: (h.weather_code || []).some((x) => x >= 95) || c.weather_code >= 95 };
  });
}

/* ---- safety ---- */
function airportStorms() {
  if (!S.metar) return null;
  const rows = Object.values(S.metar.latest).filter((r) => metarState(r).k !== "bad");
  return rows.filter((r) => r.wxp.thunder).map((r) => r.icaoId + (STATION_NAME[r.icaoId] ? " " + STATION_NAME[r.icaoId] : ""));
}
const STATION_NAME = { OMDB: "Dubai", OMDW: "Al Maktoum", OMSJ: "Sharjah", OMRK: "RAK", OMFJ: "Fujairah", OMAA: "Abu Dhabi", OMAD: "Al Bateen", OMAM: "Al Dhafra", OMAL: "Al Ain" };
function danger() {
  const storms = airportStorms();
  if (storms && storms.length) return true;
  const nm = nearMe(); return !!(nm && !nm.outside && nm.areas.some((a) => a.km <= 25));
}

/* ---- outing candidates ---- */
function origin() { if (R.user) return { lat: R.user.lat, lon: R.user.lon, you: true }; const c = byId(S.sel) || CITIES[0]; return { lat: c.lat, lon: c.lng, name: pname(c), you: false }; }
function outingCandidates() {
  if (R.status !== "ok" || radarK() !== "fresh") return [];
  const o = origin(), out = [];
  R.analysed.forEach((x) => {
    const { p, a } = x;
    if (HAZ.has(p.t) || p.t === "reserve" || a.status !== "none") return;
    if (a.nearestKm != null && a.nearestKm < 25) return;
    const d = RG.haversineKm(o.lat, o.lon, p.lat, p.lng); if (d > R.radius || d < 3) return;
    const f = R.fc[p.id]; if (f && (f.p6 >= 40 || f.ts)) return;
    const cor = RG.corridorKm({ lat: o.lat, lon: o.lon }, { lat: p.lat, lon: p.lng }, R.frame);
    if (cor != null && cor < 10) return;
    out.push({ p, a, d, cor });
  });
  return out.sort((x, y) => x.d - y.d).slice(0, 6);
}

/* ---- rendering ---- */
const gmaps = (p) => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=driving`;
const amaps = (p) => `https://maps.apple.com/?daddr=${p.lat},${p.lng}&dirflg=d`;
function radarChip(x) {
  const a = x.a;
  if (a.status === "over") return `<span class="rchip over">${t("r_over")}</span>`;
  if (a.status === "near") return `<span class="rchip near">${t("r_nearx", a.nearestKm, dirTxt(a.bearing))}</span>`;
  if (a.status === "uncovered") return `<span class="rchip unk">${t("r_uncovered")}</span>`;
  if (a.status === "unavailable") return `<span class="rchip unk">${t("r_unavail")}</span>`;
  return `<span class="rchip none">${t("r_nonex")}${a.nearestKm != null ? t("r_nonex_n", a.nearestKm, dirTxt(a.bearing)) : ""}</span>`;
}
function trendTxt(x) {
  if (!x.pa || x.a.nearestKm == null || x.pa.nearestKm == null) return "";
  const dl = x.pa.nearestKm - x.a.nearestKm, gap = Math.round((R.frame.ms - R.prev.ms) / 60000);
  if (dl >= 3) return t("r_trend_close", Math.round(dl), gap); if (dl <= -3) return t("r_trend_away", Math.round(-dl), gap); return t("r_trend_same", gap);
}
function fcLine(p) {
  const f = R.fc[p.id]; if (!f) return `<span class="muted">${t("r_fc_na")}</span>`;
  const w = WC(f.code ?? 0);
  return `<span class="tag t-mod">${t("badge_mod")}</span> ${t("r_temp", Math.round(f.temp))} · ${w[0]} ${lang === "ar" ? w[2] : w[1]} · ${t("r_fc", f.p6)}${f.ts ? " · ⚠ " + t("r_fc_ts") : ""}`;
}
function hazardNote(x) {
  if (!HAZ.has(x.p.t)) return "";
  const f = R.fc[x.p.id], avoid = (x.a.nearestKm != null && x.a.nearestKm <= 50) || (f && f.p6 >= 20);
  return `<div class="haz">⚠ ${t("r_haz")}${avoid ? " <b>" + t("r_haz_avoid") + "</b>" : ""}</div>`;
}
function placeCard(x) {
  const { p, a } = x, hot = a.status === "over" || a.status === "near";
  let h = `<div class="rcard ${hot ? "hot" : ""} ${R.sel === p.id ? "sel" : ""}" data-id="${esc(p.id)}"><div class="rtop"><b>${esc(rname(p))}</b><span class="muted">${esc(emName(p))}${x.d != null ? " · " + Math.round(x.d) + " km" : ""}</span></div>`;
  h += `<div>${radarChip(x)} <span class="muted">${t("r_frame", fmtT(R.frame.ms))}</span></div>`;
  const tr = trendTxt(x); if (tr) h += `<div class="muted">${tr}</div>`;
  h += `<div class="row2">${fcLine(p)}</div><div class="muted sm">${t("r_inten")}</div><div class="muted sm">${t("r_official")}</div>`;
  h += hazardNote(x);
  if (hot) h += `<div class="warnline">⛔ ${t("r_dir_warn")}</div>`;
  h += `<div class="acts"><button data-act="map" data-id="${esc(p.id)}">${t("r_map")}</button><a class="btn ${hot ? "warn" : ""}" href="${gmaps(p)}" target="_blank" rel="noopener">${t("r_gmaps")}</a><a class="btn ${hot ? "warn" : ""}" href="${amaps(p)}" target="_blank" rel="noopener">${t("r_amaps")}</a></div></div>`;
  return h;
}
function safetyHTML() {
  const w = (R.scan && R.scan.warnings) || { links: [{ name: "NCM", url: "https://www.ncm.ae/" }] };
  const storms = airportStorms(), rk = radarK(), dg = danger();
  let h = `<div class="safety ${dg ? "red" : "amber"}"><b>🛡 ${t("s_title")}</b><div>${dg ? t("s_danger") : t("s_incomplete")}</div><ul>`;
  h += `<li><b>${t("s_off")}:</b> <span class="bad">${t("s_off_bad")}</span> — ${t("s_off_why")} ${(w.links || []).map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.name)}</a>`).join(" · ")}</li>`;
  h += `<li><b>${t("s_radar")}:</b> ${R.frame ? `${fmtT(R.frame.ms)} · ${ageTxt(radarAge())} · ${rk === "fresh" ? t("r_fresh") : rk === "stale" ? t("r_stale") : t("r_outdated")}` : t("unavailable")}</li>`;
  h += `<li><b>${t("s_ts", 180)}:</b> ${storms == null ? t("s_ts_unk") : storms.length ? "⛈ " + esc(storms.join(", ")) : t("s_ts_none")}</li></ul>${dg ? "" : `<div class="muted sm">${t("s_clear_note")}</div>`}</div>`;
  return h;
}
function outingHTML() {
  const o = origin();
  let h = `<h3>${t("o_title")}</h3><div class="muted sm">${t("o_rule")}</div>`;
  h += `<div class="muted sm">${o.you ? t("o_from", t("o_from_you")) : t("o_use_city", esc(o.name))}</div>`;
  const rk = radarK();
  if (R.status !== "ok" || rk !== "fresh") return h + `<div class="warnline">${t("o_withheld", rk === "stale" ? t("r_stale") : t("r_outdated"))}</div>`;
  const c = outingCandidates();
  if (!c.length) return h + `<div class="muted">${t("o_none")}</div>`;
  return h + c.map((x) => `<div class="cand">${placeCard({ p: x.p, a: x.a, pa: null, d: x.d })}<div class="muted sm">${x.cor == null ? "" : t("o_ok_corridor")}</div></div>`).join("");
}
function renderRain() {
  const box = $("rain"); if (!box) return;
  let h = `<h2 style="margin:0">${t("r_title")}</h2><div class="muted">${t("r_sub")}</div>`;
  if (R.status === "loading") return void (box.innerHTML = h + `<p class="muted">${t("r_loading")}</p>`);
  if (R.status !== "ok") return void (box.innerHTML = h + `<p class="fail">${t("r_fail")}</p>` + (R.scan ? "" : ""));
  const rk = radarK(), cov = R.cover ? (R.cover.state === "ok" ? t("r_cov_ok") : t("r_cov_bad")) : t("r_cov_none");
  const v = R.scan.validation || {};
  h += `<div class="pills" style="padding:6px 0 2px"><span class="pill ${rk}">${t("pill_radar")} <b>${fmtT(R.frame.ms)} · ${ageTxt(radarAge())}${rk === "stale" ? " ⚠" : rk === "bad" ? " — " + t("r_outdated") : ""}</b></span><span class="pill ${R.cover && R.cover.state === "ok" ? "fresh" : "stale"}">${cov}</span></div>`;
  h += `<div class="muted sm">${v.validated ? t("r_val_yes", Math.round(v.pod * 100), Math.round(v.far * 100)) : t("r_val_no", v.rainEvents || 0)} ${t("r_echo_note")}</div>`;
  h += `<div class="seg" role="group" aria-label="${t("r_radius")}"><span class="muted">${t("r_radius")}</span>` + [10, 25, 50, 100].map((r) => `<button data-r="${r}" class="${R.radius === r ? "on" : ""}">${t("r_km", r)}</button>`).join("") +
    (R.user ? `<button id="locOff" class="on">${t("r_loc_on")} · ${t("r_loc_off")}</button>` : `<button id="locBtn">${t("r_loc")}</button>`) + `</div>`;
  h += `<div class="muted sm">${R.locMsg ? esc(R.locMsg) : t("r_loc_priv")}</div>`;
  h += safetyHTML();
  if (rk === "bad") { box.innerHTML = h + `<p class="fail">${t("r_outdated")}</p>`; return bindRain(box); }
  const nm = R.user ? nearMe() : null;
  if (nm && nm.outside) { R.locMsg = t("r_loc_out"); R.user = null; }
  if (nm && !nm.outside) {
    h += `<h3>${t("r_nm_title", R.radius)}</h3>`;
    if (nm.nearestKm != null) h += `<div><b>${t("r_nm_nearest", nm.nearestKm, dirTxt(nm.nearestBearing))}</b></div>`;
    if (nm.trend) { const tr = nm.trend; h += `<div class="muted">${tr.k === "close" ? t("r_trend_close", tr.d, tr.gap) : tr.k === "away" ? t("r_trend_away", tr.d, tr.gap) : tr.k === "new" ? t("r_trend_new", tr.gap) : t("r_trend_same", tr.gap)} · <span class="sm">${t("r_trend_note")}</span></div>`; }
    if (!nm.areas.length) h += `<p class="muted">${t("r_nm_none", R.radius)}</p>`;
    else {
      h += `<div class="muted">${t("r_nm_n", nm.areas.length, R.radius)}</div><ul class="areas">` + nm.areas.slice(0, 8).map((a) => `<li>${t("r_nearx", a.km, dirTxt(a.bearing))} · ${t("r_area", a.info.areaKm2)} · ${t("r_near_place", esc(rname(a.near.p)), Math.round(a.near.d))}</li>`).join("") + `</ul>`;
    }
    h += listHTML(nm.matches);
  } else {
    const hot = R.analysed.filter((x) => x.a.status === "over" || x.a.status === "near").sort((a, b) => a.a.nearestKm - b.a.nearestKm);
    h += `<h3>${t("r_all_title")}</h3>`;
    if (!hot.length) h += `<p class="muted">${t("r_all_none", R.db.places.length)}</p>`;
    else h += `<div class="muted">${t("r_all_n", hot.length, 10)}</div>` + listHTML(hot);
    const unnamed = R.frame.clusters.map((c) => RG.clusterInfo(c)).filter((c) => !R.db.places.some((p) => RG.haversineKm(c.lat, c.lon, p.lat, p.lng) <= 10));
    if (unnamed.length) { const big = unnamed.sort((a, b) => b.areaKm2 - a.areaKm2)[0]; let np = null; R.db.places.forEach((p) => { const d = RG.haversineKm(big.lat, big.lon, p.lat, p.lng); if (!np || d < np.d) np = { p, d }; }); h += `<div class="muted sm">${t("r_unnamed", unnamed.length, big.areaKm2, esc(rname(np.p)) + " " + Math.round(np.d) + " km")}</div>`; }
  }
  h += outingHTML();
  box.innerHTML = h; bindRain(box); drawRainLayer();
}
function listHTML(list) {
  if (!list.length) return "";
  const cap = R.expanded ? 60 : 8;
  let h = list.slice(0, cap).map(placeCard).join("");
  if (list.length > 8) h += `<button id="moreBtn" class="ghost">${R.expanded ? t("r_less") : t("r_more", list.length - 8)}</button>`;
  return h;
}
function bindRain(box) {
  box.querySelectorAll("[data-r]").forEach((b) => b.addEventListener("click", () => { R.radius = +b.dataset.r; ls("rr", R.radius); renderRain(); ensureForecast(shownPlaces()).then(renderRain); }));
  const lb = $("locBtn"); if (lb) lb.addEventListener("click", askLocation);
  const lo = $("locOff"); if (lo) lo.addEventListener("click", () => { R.user = null; R.locMsg = ""; analyse(); renderRain(); });
  const mb = $("moreBtn"); if (mb) mb.addEventListener("click", () => { R.expanded = !R.expanded; renderRain(); });
  box.querySelectorAll("[data-act=map]").forEach((b) => b.addEventListener("click", () => focusPlace(b.dataset.id)));
}
function askLocation() {
  if (!navigator.geolocation) { R.locMsg = t("r_loc_fail"); return renderRain(); }
  navigator.geolocation.getCurrentPosition((pos) => {
    R.user = { lat: pos.coords.latitude, lon: pos.coords.longitude }; R.locMsg = ""; analyse(); renderRain(); ensureForecast(shownPlaces()).then(renderRain);
  }, (err) => { R.locMsg = err && err.code === 1 ? t("r_loc_denied") : t("r_loc_fail"); renderRain(); }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 });
}
function focusPlace(id) {
  const p = R.db.places.find((q) => q.id === id); if (!p || !S.map) return;
  R.sel = id; S.map.setView([p.lat, p.lng], 10); drawRainLayer(); $("map").scrollIntoView({ behavior: "smooth", block: "center" });
}
function drawRainLayer() {
  if (!S.map || R.status !== "ok") return;
  if (!R.layer) R.layer = L.layerGroup().addTo(S.map);
  R.layer.clearLayers();
  const nm = R.user ? nearMe() : null;
  const hot = R.analysed.filter((x) => (x.a.status === "over" || x.a.status === "near") && (!R.user || (x.d != null && x.d <= R.radius)));
  hot.forEach((x) => L.circleMarker([x.p.lat, x.p.lng], { radius: x.a.status === "over" ? 9 : 7, color: "#fff", weight: 2, fillColor: "#7b3fc4", fillOpacity: 0.95 }).bindTooltip(rname(x.p) + ": " + (x.a.status === "over" ? t("r_over") : t("r_nearx", x.a.nearestKm, dirTxt(x.a.bearing)))).on("click", () => { R.sel = x.p.id; renderRain(); }).addTo(R.layer));
  if (R.sel) { const p = R.db.places.find((q) => q.id === R.sel); if (p) L.circleMarker([p.lat, p.lng], { radius: 14, color: "#12262d", weight: 3, fill: false }).bindTooltip(rname(p)).addTo(R.layer); }
  if (R.user && nm && !nm.outside) { L.circle([R.user.lat, R.user.lon], { radius: R.radius * 1000, color: "#0b5cad", weight: 1.5, fillOpacity: 0.04 }).addTo(R.layer); L.circleMarker([R.user.lat, R.user.lon], { radius: 6, color: "#fff", weight: 2, fillColor: "#0b5cad", fillOpacity: 1 }).addTo(R.layer); }
}
window.renderRain = renderRain; window.loadRain = loadRain;
loadRain(); // app.js starts before this file is parsed, so rain.js kicks off its own first load
