"use strict";
/* Home shell: 4-tab navigation (Home / Map / Alerts / More), the single map moved between Home and Map, and the
   simplified Home view (main rain status, radar map, Where's the Rain short list, Rain Near Me, top-3 community).
   This file ADDS a shell on top of the existing modules — it never replaces their logic. app.js/rain.js/community.js
   keep rendering into their own containers (now living inside the Map/More views); Home reads their state (S, R, C). */
Object.assign(I18N.en, {
  tab_home: "Home", tab_map: "Map", tab_alerts: "Alerts", tab_more: "More",
  hs_rain: "Rain detected now", hs_none: "No rain detected in covered areas", hs_unavail: "Weather data unavailable or insufficient",
  hs_partial: "No rain where we can currently see",
  hs_areas: "Areas: {0}", hs_none_sub: "Radar and airport reports are current and show no rain where coverage reaches. This is not a claim that the whole UAE is dry.",
  hs_unavail_sub: "Radar or airport data is missing or stale right now, so no reliable rain status can be given.",
  hs_partial_sub: "Some sources are unavailable, so we can't confirm the whole covered area.",
  hs_rain_sub: "Live signals of rain. Each is a separate kind of evidence — tap through for detail and verification.",
  hs_reliab: "Radar: {0} · Airports: {1}", hs_radar_na: "unavailable", hs_metar_na: "unavailable",
  home_wheres: "Where's the rain?", home_wheres_none: "No radar echoes near listed places right now.",
  home_nearme: "Rain near me", home_nearme_cta: "📍 Check near my location", home_nearme_none: "No radar echo within {0} km of you.",
  home_nearme_hit: "Nearest echo {0} km ({1})", home_viewall: "View all →", home_community: "Community reports",
  home_comm_none: "No community reports in the last 2 days.", home_saved: "Saved locations", home_saved_none: "No saved locations yet. Save places from Map or follow areas from community reports.",
  lat_title: "Typical report delay", lat_val: "{0} after posting (median) · cron every 10 min", lat_na: "No located reports to measure yet.",
  more_adv: "Advanced diagnostics (METAR, radar scan, collector health, sources)",
});
Object.assign(I18N.ar, {
  tab_home: "الرئيسية", tab_map: "الخريطة", tab_alerts: "التنبيهات", tab_more: "المزيد",
  hs_rain: "أمطار مرصودة الآن", hs_none: "لا أمطار في المناطق المغطاة", hs_unavail: "بيانات الطقس غير متاحة أو غير كافية",
  hs_partial: "لا مطر حيث نرى حاليًا",
  hs_areas: "المناطق: {0}", hs_none_sub: "الرادار وتقارير المطارات حديثة ولا تُظهر مطرًا حيث تصل التغطية. هذا ليس ادعاءً بأن كل الإمارات جافة.",
  hs_unavail_sub: "بيانات الرادار أو المطارات مفقودة أو قديمة الآن، لذا لا يمكن إعطاء حالة مطر موثوقة.",
  hs_partial_sub: "بعض المصادر غير متاحة، لذا لا يمكننا تأكيد كامل المنطقة المغطاة.",
  hs_rain_sub: "إشارات مباشرة للمطر. كل منها نوع مختلف من الأدلة — اضغط للتفاصيل والتحقق.",
  hs_reliab: "الرادار: {0} · المطارات: {1}", hs_radar_na: "غير متاح", hs_metar_na: "غير متاحة",
  home_wheres: "أين المطر؟", home_wheres_none: "لا أصداء رادار قرب الأماكن المدرجة الآن.",
  home_nearme: "المطر قربي", home_nearme_cta: "📍 تحقّق قرب موقعي", home_nearme_none: "لا صدى رادار ضمن {0} كم منك.",
  home_nearme_hit: "أقرب صدى {0} كم ({1})", home_viewall: "عرض الكل →", home_community: "بلاغات المجتمع",
  home_comm_none: "لا بلاغات مجتمعية في آخر يومين.", home_saved: "المواقع المحفوظة", home_saved_none: "لا مواقع محفوظة بعد. احفظ أماكن من الخريطة أو تابع مناطق من البلاغات.",
  lat_title: "زمن وصول البلاغ المعتاد", lat_val: "{0} بعد النشر (الوسيط) · الجمع كل 10 دقائق", lat_na: "لا بلاغات محددة الموقع للقياس بعد.",
  more_adv: "تشخيصات متقدمة (METAR، مسح الرادار، صحة المجمّع، المصادر)",
});

const STATION_CITY = { OMDB: "Dubai", OMDW: "Al Maktoum", OMSJ: "Sharjah", OMRK: "RAK", OMFJ: "Fujairah", OMAA: "Abu Dhabi", OMAD: "Abu Dhabi", OMAM: "Al Dhafra", OMAL: "Al Ain" };
// Plain duration (no "ago"), for latency: "8 min" / "1 h 5 min".
const durTxt = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); return m < 60 ? m + " " + t("min") : Math.floor(m / 60) + " " + t("h") + " " + (m % 60) + " " + t("min"); };
const H = { tab: ls("tab") || "home" };

/* ---------------- tab navigation + movable map ---------------- */
const VIEWS = ["home", "map", "alerts", "more"];
function moveMap(to) {
  const wrap = document.getElementById("mapWrap");
  const slot = document.getElementById(to === "map" ? "mapSlot" : "homeMapSlot");
  if (wrap && slot && wrap.parentNode !== slot) slot.appendChild(wrap);
  if (typeof S!=="undefined" && S.map) setTimeout(() => { try { S.map.invalidateSize(); if (S.frames && S.frames.length) showFrame(S.idx); } catch (_) {} }, 60);
}
function setTab(tab) {
  H.tab = tab; ls("tab", tab);
  VIEWS.forEach((v) => { const el = document.getElementById("view-" + v); if (el) el.hidden = v !== tab; });
  document.querySelectorAll("#tabbar button").forEach((b) => { const on = b.dataset.tab === tab; b.classList.toggle("on", on); b.setAttribute("aria-selected", on ? "true" : "false"); });
  moveMap(tab === "map" ? "map" : "home");         // map lives on Home and Map; Home is the default host
  if (tab === "home" && window.renderHome) renderHome();
  if (tab === "alerts" && window.renderAlertsView) renderAlertsView();
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
}
function renderTabbar() {
  const bar = document.getElementById("tabbar"); if (!bar) return;
  const ic = { home: "🏠", map: "🗺", alerts: "🔔", more: "⋯" };
  bar.innerHTML = VIEWS.map((v) => `<button role="tab" data-tab="${v}" class="${v === H.tab ? "on" : ""}" aria-selected="${v === H.tab}"><span class="ti">${ic[v]}</span><span class="tl">${t("tab_" + v)}</span></button>`).join("");
  bar.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
}

/* ---------------- Home: main rain status ---------------- */
function homeStatus() {
  const obsRain = [];
  if (typeof S!=="undefined" && S.metar) Object.values(S.metar.latest).forEach((r) => {
    if (typeof metarState === "function" && metarState(r).k === "bad") return;
    if (r.wxp && r.wxp.at && r.wxp.at.length) { const c = STATION_CITY[r.icaoId] || r.icaoId; if (!obsRain.includes(c)) obsRain.push(c); }
  });
  const echoes = ((typeof R!=="undefined" && R.analysed) || []).filter((x) => x.a.status === "over" || x.a.status === "near").sort((a, b) => (a.a.nearestKm ?? 999) - (b.a.nearestKm ?? 999));
  const echoNames = echoes.slice(0, 6).map((x) => rname(x.p));
  const comm = ((typeof C!=="undefined" && C.data && C.data.groups) || []).filter((g) => g.place).slice(0, 6).map((g) => g.place.name);
  const rk = typeof radarK === "function" ? radarK() : (radarState().k === "fresh" ? "fresh" : radarState().k);
  const radarUsable = rk !== "bad" && ((typeof R!=="undefined" && R.analysed) || []).some((x) => x.a.status !== "unavailable");
  const metarUsable = !!(typeof S!=="undefined" && S.metar);
  const areas = [...new Set([...obsRain, ...echoNames])];
  let level;
  if (obsRain.length || echoes.length) level = "rain";
  else if (!radarUsable && !metarUsable) level = "unavail";
  else if (radarUsable && metarUsable) level = "none";
  else level = "partial";
  return { level, areas, comm, rk, metarUsable, radarUsable };
}
function reliabLine(s) {
  const rs = radarState();
  const radarTxt = s.radarUsable ? (R && R.frame ? fmtT(R.frame.ms) + " · " + ageTxt(ageMin(R.frame.ms)) : rs.txt) : t("hs_radar_na");
  let metarTxt = t("hs_metar_na");
  if (typeof S!=="undefined" && S.metar) { const nw = Math.max(...Object.values(S.metar.latest).map((r) => r.ms)); metarTxt = fmtT(nw) + " · " + ageTxt(ageMin(nw)); }
  return t("hs_reliab", radarTxt, metarTxt);
}
function renderStatus() {
  const box = document.getElementById("rainStatus"); if (!box) return;
  const s = homeStatus();
  box.className = "card status " + s.level;
  const head = { rain: "hs_rain", none: "hs_none", unavail: "hs_unavail", partial: "hs_partial" }[s.level];
  const sub = { rain: "hs_rain_sub", none: "hs_none_sub", unavail: "hs_unavail_sub", partial: "hs_partial_sub" }[s.level];
  const icon = { rain: "🌧", none: "✓", unavail: "⚠", partial: "•" }[s.level];
  let h = `<div class="statline"><span class="sicon">${icon}</span><span class="stext">${t(head)}</span></div>`;
  if (s.level === "rain" && s.areas.length) h += `<div class="sareas">${esc(s.areas.slice(0, 8).join("، ") || s.areas.join(", "))}</div>`;
  h += `<div class="muted sm">${t(sub)}</div>`;
  h += `<div class="muted sm reliab">${reliabLine(s)}</div>`;
  box.innerHTML = h;
}

/* ---------------- Home: Where's the rain (short) ---------------- */
function renderHomeRain() {
  const box = document.getElementById("homeRain"); if (!box) return;
  let h = `<div class="chd"><h2>${t("home_wheres")}</h2><button class="link" data-go="more">${t("home_viewall")}</button></div>`;
  const list = ((typeof R!=="undefined" && R.analysed) || []).filter((x) => x.a.status === "over" || x.a.status === "near").sort((a, b) => (a.a.nearestKm ?? 999) - (b.a.nearestKm ?? 999)).slice(0, 4);
  if (!list.length) h += `<p class="muted sm">${t("home_wheres_none")}</p>`;
  else h += `<ul class="hrlist">` + list.map((x) => {
    const over = x.a.status === "over";
    const detail = over ? t("r_over") : t("r_nearx", x.a.nearestKm, dirTxt(x.a.bearing));
    return `<li><span class="rchip ${over ? "over" : "near"}">${esc(rname(x.p))}</span><span class="muted sm">${esc(emName(x.p))} · ${detail}</span></li>`;
  }).join("") + `</ul>`;
  box.innerHTML = h;
  const go = box.querySelector("[data-go]"); if (go) go.addEventListener("click", () => setTab("more"));
}

/* ---------------- Home: Rain near me ---------------- */
function renderHomeNearMe() {
  const box = document.getElementById("homeNearMe"); if (!box) return;
  let h = `<div class="chd"><h2>${t("home_nearme")}</h2></div>`;
  const nm = (typeof R!=="undefined" && R.user && typeof nearMe === "function") ? nearMe() : null;
  if (typeof R === "undefined" || !R.user) h += `<button class="btn wide" id="homeLoc">${t("home_nearme_cta")}</button><div class="muted sm" style="margin-top:6px">${t("r_loc_priv")}</div>`;
  else if (nm && nm.outside) h += `<p class="muted sm">${t("r_loc_out")}</p>`;
  else if (nm && nm.nearestKm != null) h += `<div class="nmhit">${t("home_nearme_hit", nm.nearestKm, dirTxt(nm.nearestBearing))}</div><div class="muted sm">${t("r_echo_note")}</div>`;
  else h += `<p class="muted sm">${t("home_nearme_none", (typeof R!=="undefined" && R.radius) || 25)}</p>`;
  box.innerHTML = h;
  const b = document.getElementById("homeLoc"); if (b && typeof askLocation === "function") b.addEventListener("click", () => { askLocation(); });
}

/* ---------------- Home: top-3 community ---------------- */
function renderHomeCommunity() {
  const box = document.getElementById("homeCommunity"); if (!box) return;
  let h = `<div class="chd"><h2>${t("home_community")}</h2><button class="link" data-go="more">${t("home_viewall")}</button></div>`;
  const d = typeof C!=="undefined" && C.data;
  const groups = (d && d.groups ? d.groups : []).slice(0, 3);
  if (!groups.length) h += `<p class="muted sm">${t("home_comm_none")}</p>`;
  else h += groups.map((g) => {
    const cls = (typeof ST_CLASS !== "undefined" && ST_CLASS[g.verify]) || "unverified";
    const place = g.place ? esc(g.place.name) : t("c_noloc");
    const src = (g.sources || []).map((s) => esc(srcLabel(s.source))).join(", ");
    return `<div class="hcrep ${cls}"><div class="hcr1"><span class="cst ${cls}">${t(ST_LABEL[g.verify] || "st_unverified")}</span><b>${evLabel(g.event)}</b><span class="muted sm">· ${place}</span></div><div class="muted sm">${esc(src)} · ${t("c_pub", ageTxt(ageMin(g.publishMs)))}</div></div>`;
  }).join("");
  if (d && d.latency) h += `<div class="muted sm" style="margin-top:6px">${t("lat_title")}: ${t("lat_val", durTxt(d.latency.medianMs))}</div>`;
  box.innerHTML = h;
  box.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => setTab("more")));
}

function renderHome() {
  if (H.tab !== "home") return;
  moveMap("home");
  renderStatus(); renderHomeRain(); renderHomeNearMe(); renderHomeCommunity();
}

/* ---------------- Alerts view: safety + saved locations ---------------- */
function renderAlertsView() {
  if (window.renderPush) renderPush();
  const safety = document.getElementById("safetySlot");
  if (safety && typeof safetyHTML === "function" && typeof R!=="undefined" && R.status === "ok") safety.innerHTML = safetyHTML();
  else if (safety) safety.innerHTML = `<p class="muted sm">${t("r_loading")}</p>`;
  const saved = document.getElementById("savedSlot"); if (!saved) return;
  let h = `<div class="chd"><h2>${t("home_saved")}</h2></div>`;
  const favs = (typeof S!=="undefined" && S.favs) || [], follows = (typeof C!=="undefined" && C.follows) || [];
  const ids = [...new Set([...favs, ...follows])];
  if (!ids.length) h += `<p class="muted sm">${t("home_saved_none")}</p>`;
  else {
    h += `<ul class="hrlist">` + ids.map((id) => {
      const p = (typeof byId === "function" && byId(id)) || null;
      const name = p ? pname(p) : id;
      const x = ((typeof R!=="undefined" && R.analysed) || []).find((q) => q.p.id === id);
      const st = x ? (x.a.status === "over" ? t("r_over") : x.a.status === "near" ? t("r_nearx", x.a.nearestKm, dirTxt(x.a.bearing)) : t("r_nonex")) : "";
      return `<li><span class="rchip ${x && (x.a.status === "over" || x.a.status === "near") ? "near" : "none"}">${esc(name)}</span><span class="muted sm">${esc(st)}</span></li>`;
    }).join("") + `</ul>`;
  }
  saved.innerHTML = h;
}

window.renderHome = renderHome; window.renderAlertsView = renderAlertsView;
document.addEventListener("DOMContentLoaded", () => { renderTabbar(); setTab(H.tab); });
// langBtn also needs to re-label the tab bar; hook the existing button
document.addEventListener("click", (e) => { if (e.target && e.target.id === "langBtn") setTimeout(() => { renderTabbar(); if (window.pushOnLangChange) pushOnLangChange(); }, 0); });
