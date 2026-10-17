"use strict";
/* Community Rain Reports | بلاغات الأمطار.
   Reports come from authorized community sources (Telegram first) via /api/community. Every report is a social-media
   CLAIM, labelled unverified unless our own radar/airport data independently corroborates it. Nothing here asserts
   "rain now" from a post alone. Source account + original-post link are always shown. */
Object.assign(I18N.en, {
  c_title: "Community Rain Reports", c_sub: "Rainfall reports from authorized UAE weather communities — shown as claims, checked against our radar and airport data",
  c_empty: "No community reports yet. The Telegram intake is live and waiting for an authorized channel to post. Nothing is shown until a real report arrives.",
  c_unavail: "Community feed unavailable right now.",
  c_disclaimer: "Community reports are public social-media posts, not measurements. They stay unverified unless radar or airport observations independently agree.",
  c_src: "Sources", c_none_src: "No source connected yet",
  c_counts: "{0} reports · {1} located · {2} duplicates hidden",
  c_showdups: "Show duplicates/reposts", c_hidedups: "Hide duplicates/reposts",
  c_filter_fav: "Favorites only", c_filter_all: "All areas",
  c_via: "via {0}", c_open: "Original post", c_noloc: "no location detected",
  c_pub: "posted {0}", c_obs: "observed {0}", c_fwd: "forwarded (older content)",
  c_near: "Nearby now: {0}",
  st_confirmed: "Airport-confirmed", st_radar: "Radar-corroborated", st_unverified: "Unverified", st_conflicting: "Conflicting", st_missing: "No location", st_duplicate: "Repost",
  st_confirmed_d: "An airport {0} km away reported precipitation around this time.", st_radar_d: "Radar showed an echo at this spot around this time.",
  st_unverified_d: "No independent radar or airport confirmation. Treat as a claim.", st_conflicting_d: "Radar and the nearest airport showed no rain around this time — treat with caution.",
  st_missing_d: "No UAE place could be matched in the text.", st_duplicate_d: "Same content already reported.",
  ev_rain: "Rain", ev_hail: "Hail", ev_thunder: "Thunderstorm", ev_flood: "Heavy rain / flooding", ev_unknown: "Weather report",
  c_follow: "＋ Follow", c_following: "✓ Following", c_notify_hint: "Follow areas to get in-app alerts for new nearby reports while the app is open.",
});
Object.assign(I18N.ar, {
  c_title: "بلاغات الأمطار", c_sub: "بلاغات أمطار من مجتمعات الطقس المصرّح بها في الإمارات — تُعرض كادعاءات وتُقارن ببيانات الرادار والمطارات لدينا",
  c_empty: "لا توجد بلاغات بعد. قناة تيليجرام جاهزة وتنتظر مصدرًا مصرّحًا به لينشر. لا يُعرض شيء حتى يصل بلاغ حقيقي.",
  c_unavail: "خدمة البلاغات غير متاحة حاليًا.",
  c_disclaimer: "بلاغات المجتمع منشورات عامة على وسائل التواصل، وليست قياسات. تبقى غير مؤكدة ما لم تتفق معها بيانات الرادار أو المطارات بشكل مستقل.",
  c_src: "المصادر", c_none_src: "لا يوجد مصدر متصل بعد",
  c_counts: "{0} بلاغ · {1} محدّد الموقع · {2} مكرر مخفي",
  c_showdups: "إظهار المكرر", c_hidedups: "إخفاء المكرر",
  c_filter_fav: "المفضلة فقط", c_filter_all: "كل المناطق",
  c_via: "عبر {0}", c_open: "المنشور الأصلي", c_noloc: "لم يُكتشف موقع",
  c_pub: "نُشر {0}", c_obs: "رُصد {0}", c_fwd: "معاد توجيهه (محتوى أقدم)",
  c_near: "الحالة القريبة الآن: {0}",
  st_confirmed: "مؤكد من المطار", st_radar: "مدعوم بالرادار", st_unverified: "غير مؤكد", st_conflicting: "متعارض", st_missing: "بدون موقع", st_duplicate: "معاد نشره",
  st_confirmed_d: "مطار على بُعد {0} كم أبلغ عن هطول في هذا الوقت تقريبًا.", st_radar_d: "أظهر الرادار صدى عند هذا الموقع في هذا الوقت تقريبًا.",
  st_unverified_d: "لا تأكيد مستقل من الرادار أو المطار. تعامل معه كادعاء.", st_conflicting_d: "لم يُظهر الرادار ولا أقرب مطار مطرًا في هذا الوقت — تعامل بحذر.",
  st_missing_d: "تعذّر مطابقة أي مكان إماراتي في النص.", st_duplicate_d: "المحتوى نفسه مُبلَّغ عنه سابقًا.",
  ev_rain: "مطر", ev_hail: "برَد", ev_thunder: "عاصفة رعدية", ev_flood: "أمطار غزيرة / سيول", ev_unknown: "بلاغ طقس",
  c_follow: "＋ متابعة", c_following: "✓ متابَع", c_notify_hint: "تابع المناطق لتصلك تنبيهات داخل التطبيق بالبلاغات القريبة الجديدة أثناء فتحه.",
});

const C = { data: null, status: "loading", showDups: false, favOnly: false, layer: null, notified: {} };
C.follows = ls("cfollows") || [];
const ST_CLASS = { "officially-confirmed": "confirmed", "radar-corroborated": "radar", unverified: "unverified", conflicting: "conflicting", missing_location: "missing", duplicate: "duplicate" };
const ST_LABEL = { "officially-confirmed": "st_confirmed", "radar-corroborated": "st_radar", unverified: "st_unverified", conflicting: "st_conflicting", missing_location: "st_missing", duplicate: "st_duplicate" };
const ST_DESC = { "officially-confirmed": "st_confirmed_d", "radar-corroborated": "st_radar_d", unverified: "st_unverified_d", conflicting: "st_conflicting_d", missing_location: "st_missing_d", duplicate: "st_duplicate_d" };

async function loadCommunity() {
  const j = await getJSON("Community reports", "/api/community?days=2");
  if (!j || !Array.isArray(j.reports)) { C.status = "error"; C.data = j || null; return renderCommunity(); }
  C.data = j; C.status = "ok"; renderCommunity();
}
function evLabel(e) { return t("ev_" + (["rain", "hail", "thunder", "flood"].includes(e) ? e : "unknown")); }
function reportCard(r) {
  const st = r.verify, cls = ST_CLASS[st] || "unverified";
  const place = r.place ? esc(r.place.name) : t("c_noloc");
  const em = r.emirate ? (I18N[lang].em_au && false) : "";
  let h = `<div class="crep ${cls}"><div class="crtop"><span class="cst ${cls}">${t(ST_LABEL[st] || "st_unverified")}</span><b>${evLabel(r.event)}</b><span class="muted">· ${place}</span></div>`;
  h += `<div class="ctext">${esc(r.text)}</div>`;
  h += `<div class="muted sm">${t(ST_DESC[st] || "st_unverified_d", r.verifyDetail && r.verifyDetail.stationKm != null ? r.verifyDetail.stationKm : "")}</div>`;
  const times = [`${t("c_pub", ageTxt(ageMin(r.publishMs)))}`];
  if (r.observedMs) times.push(t("c_obs", fmtT(r.observedMs)));
  if (r.forwarded) times.push("⤴ " + t("c_fwd"));
  h += `<div class="muted sm">${times.join(" · ")}</div>`;
  h += `<div class="acts"><span class="muted sm">${t("c_via", esc(r.channel))}</span>`;
  if (r.url) h += `<a class="btn" href="${esc(r.url)}" target="_blank" rel="noopener">${t("c_open")}</a>`;
  if (r.place) { const dirAct = `https://www.google.com/maps/dir/?api=1&destination=${r.place.lat},${r.place.lng || r.place.lon}`; h += `<a class="btn" href="${esc(dirAct)}" target="_blank" rel="noopener">${t("r_gmaps")}</a>`; }
  if (r.place) { const f = C.follows.includes(r.place.id); h += `<button class="btn cfollow ${f ? "on" : ""}" data-fid="${esc(r.place.id)}">${f ? t("c_following") : t("c_follow")}</button>`; }
  h += `</div></div>`;
  return h;
}
function renderCommunity() {
  const box = $("community"); if (!box) return;
  let h = `<h2 style="margin:0">${t("c_title")} | بلاغات الأمطار</h2><div class="muted">${t("c_sub")}</div>`;
  if (C.status === "loading") return void (box.innerHTML = h + `<p class="muted">…</p>`);
  if (C.status === "error") return void (box.innerHTML = h + `<p class="fail">${t("c_unavail")}</p>`);
  const d = C.data;
  h += `<div class="safety amber" style="margin:8px 0"><div class="sm">${t("c_disclaimer")}</div></div>`;
  // sources
  h += `<div class="muted sm">${t("c_src")}: ` + (d.channels.length ? d.channels.map((c) => c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.channel)}</a>` : esc(c.channel)).join(" · ") : t("c_none_src")) + `</div>`;
  const visible = d.reports.filter((r) => C.showDups || !r.duplicateOf).filter((r) => !C.favOnly || (r.place && C.follows.includes(r.place.id)));
  if (!d.reports.length) { box.innerHTML = h + `<p class="muted" style="margin-top:8px">${t("c_empty")}</p>`; drawCommunityLayer(); return; }
  h += `<div class="muted sm">${t("c_counts", d.counts.total, d.counts.located, d.counts.duplicates)}</div>`;
  h += `<div class="seg"><button id="cDups" class="${C.showDups ? "on" : ""}">${C.showDups ? t("c_hidedups") : t("c_showdups")}</button><button id="cFav" class="${C.favOnly ? "on" : ""}">${C.favOnly ? t("c_filter_all") : t("c_filter_fav")}</button></div>`;
  h += `<div class="muted sm">${t("c_notify_hint")}</div>`;
  h += visible.map(reportCard).join("") || `<p class="muted">—</p>`;
  box.innerHTML = h;
  const bd = $("cDups"); if (bd) bd.addEventListener("click", () => { C.showDups = !C.showDups; renderCommunity(); });
  const bf = $("cFav"); if (bf) bf.addEventListener("click", () => { C.favOnly = !C.favOnly; renderCommunity(); });
  box.querySelectorAll(".cfollow").forEach((b) => b.addEventListener("click", () => {
    const id = b.dataset.fid; C.follows = C.follows.includes(id) ? C.follows.filter((x) => x !== id) : C.follows.concat(id);
    ls("cfollows", C.follows); renderCommunity();
  }));
  drawCommunityLayer(); maybeNotifyCommunity(visible);
}
function drawCommunityLayer() {
  if (!S.map || !window.L) return;
  if (!C.layer) C.layer = L.layerGroup().addTo(S.map);
  C.layer.clearLayers();
  if (!C.data || C.status !== "ok") return;
  const seen = {};
  C.data.reports.filter((r) => !r.duplicateOf && r.place).forEach((r) => {
    const key = r.place.id; if (seen[key]) return; seen[key] = 1;
    const col = r.verify === "officially-confirmed" ? "#0b5cad" : r.verify === "radar-corroborated" ? "#7b3fc4" : r.verify === "conflicting" ? "#b26a00" : "#5d727a";
    L.marker([r.place.lat, r.place.lng || r.place.lon], { icon: L.divIcon({ className: "", html: `<div style="width:14px;height:14px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${col};border:2px solid #fff"></div>`, iconSize: [14, 14] }) })
      .bindPopup(`<b>${esc(r.place.name)}</b><br>${evLabel(r.event)} · ${t(ST_LABEL[r.verify] || "st_unverified")}<br>${esc(r.channel)}${r.url ? `<br><a href="${esc(r.url)}" target="_blank" rel="noopener">${t("c_open")}</a>` : ""}`)
      .addTo(C.layer);
  });
}
function maybeNotifyCommunity(visible) {
  if (!ls("notify") || !("Notification" in window) || Notification.permission !== "granted") return;
  visible.forEach((r) => {
    if (!r.place || !C.follows.includes(r.place.id) || r.duplicateOf) return;
    if (C.notified[r.id]) return; C.notified[r.id] = 1;
    try { new Notification(t("c_title"), { body: `${evLabel(r.event)} · ${r.place.name} (${t(ST_LABEL[r.verify] || "st_unverified")})` }); } catch (_) {}
  });
}
window.loadCommunity = loadCommunity; window.renderCommunity = renderCommunity;
loadCommunity();
