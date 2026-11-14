"use strict";
/* Rain notifications (Web Push) — the Alerts-tab panel + notification deep links.
   Works with the app closed: Chrome/Samsung Android (best), desktop Chrome/Edge/Firefox, and iPhone/iPad only when the
   app is added to the Home Screen (iOS 16.4+). The device's location is never sent: alerts are keyed to the areas the
   user follows. Only the push endpoint/keys, followed areas, enabled categories and language are stored on the server. */
Object.assign(I18N.en, {
  p_title: "Rain notifications", p_sub: "Get alerts for the areas you follow, even when the app is closed.",
  p_unsupported: "This browser can't receive background notifications. On Android use Chrome; on iPhone add the app to the Home Screen.",
  p_ios: "On iPhone/iPad, notifications only work from the installed app: tap Share ⎋ → “Add to Home Screen”, open the app from the Home Screen, then come back here.",
  p_install: "📲 Install the app", p_install_tip: "Installing the app gives the most reliable notifications on Android.",
  p_enable: "🔔 Turn on rain notifications", p_disable: "Turn off", p_on: "On for this device", p_off: "Off",
  p_denied: "Notifications are blocked for this site. In Chrome: ⋮ → Settings → Site settings → Notifications → allow this site (or long-press the app icon → App info → Notifications).",
  p_samsung: "Samsung tip for reliable alerts: Settings → Apps → Chrome → Battery → Unrestricted, and make sure Chrome isn't under Battery → Background usage limits (Sleeping/Deep sleeping apps).",
  p_cats: "Notify me about", p_cat_radar: "Radar precipitation detected near my areas", p_cat_radar_d: "Unconfirmed radar echoes from a fresh frame (≤20 min). At most once per area every 3 h.",
  p_cat_community: "New community rain reports", p_cat_community_d: "Recent posts (≤2 h) from Instagram, YouTube and Telegram, with source and time.",
  p_cat_warning: "Official weather warnings", p_cat_warning_d: "No authorized official source is connected yet — this will only notify once one exists.",
  p_areas: "Areas I follow ({0})", p_areas_none: "You don't follow any areas yet — add a neighborhood below.", p_add: "Follow a neighborhood (e.g. Mirdif, Al Ain, Masafi)…",
  p_test: "Send a test notification", p_test_hint: "A test arrives in about 45 seconds — close the app now to confirm background delivery.",
  p_test_sent: "Test queued. Close the app — it should arrive in ~45 s.", p_test_wait: "Please wait a minute before another test.",
  p_err: "Couldn't update notifications: {0}", p_limits: "Max 4 alerts/hour, 12/day. Old posts and stale radar are never sent as current.",
  p_rm: "Remove", p_saving: "Saving…", hdr_notif: "🔔 Notifications",
});
Object.assign(I18N.ar, {
  p_title: "تنبيهات المطر", p_sub: "تصلك التنبيهات للمناطق التي تتابعها حتى والتطبيق مغلق.",
  p_unsupported: "هذا المتصفح لا يستقبل التنبيهات في الخلفية. على أندرويد استخدم كروم؛ وعلى آيفون أضف التطبيق إلى الشاشة الرئيسية.",
  p_ios: "على آيفون/آيباد تعمل التنبيهات من التطبيق المثبّت فقط: اضغط مشاركة ⎋ ← «إضافة إلى الشاشة الرئيسية»، ثم افتح التطبيق من الشاشة الرئيسية وعُد إلى هنا.",
  p_install: "📲 تثبيت التطبيق", p_install_tip: "تثبيت التطبيق يعطي أكثر التنبيهات موثوقية على أندرويد.",
  p_enable: "🔔 تفعيل تنبيهات المطر", p_disable: "إيقاف", p_on: "مفعّلة على هذا الجهاز", p_off: "متوقفة",
  p_denied: "التنبيهات محظورة لهذا الموقع. في كروم: ⋮ ← الإعدادات ← إعدادات الموقع ← الإشعارات ← اسمح لهذا الموقع (أو اضغط مطولًا على أيقونة التطبيق ← معلومات التطبيق ← الإشعارات).",
  p_samsung: "نصيحة سامسونج لتنبيهات موثوقة: الإعدادات ← التطبيقات ← Chrome ← البطارية ← غير مقيّد، وتأكد أن كروم ليس ضمن البطارية ← حدود الاستخدام في الخلفية (التطبيقات النائمة).",
  p_cats: "نبّهني عن", p_cat_radar: "رصد هطول على الرادار قرب مناطقي", p_cat_radar_d: "أصداء رادار غير مؤكدة من إطار حديث (≤20 د). مرة واحدة لكل منطقة كل 3 ساعات كحد أقصى.",
  p_cat_community: "بلاغات أمطار مجتمعية جديدة", p_cat_community_d: "منشورات حديثة (≤ساعتين) من إنستغرام ويوتيوب وتيليجرام، مع المصدر والوقت.",
  p_cat_warning: "التحذيرات الرسمية", p_cat_warning_d: "لا يوجد مصدر رسمي مصرّح به متصل بعد — لن يصل تنبيه إلا عند توفره.",
  p_areas: "المناطق التي أتابعها ({0})", p_areas_none: "لا تتابع أي منطقة بعد — أضف حيًا بالأسفل.", p_add: "تابِع حيًا (مثل مردف، العين، مسافي)…",
  p_test: "إرسال تنبيه تجريبي", p_test_hint: "يصل التنبيه التجريبي بعد نحو 45 ثانية — أغلق التطبيق الآن للتأكد من الوصول في الخلفية.",
  p_test_sent: "تم جدولة الاختبار. أغلق التطبيق — يصل خلال ~45 ثانية.", p_test_wait: "انتظر دقيقة قبل اختبار آخر.",
  p_err: "تعذّر تحديث التنبيهات: {0}", p_limits: "حد أقصى 4 تنبيهات/ساعة و12/يوم. لا تُرسل المنشورات القديمة ولا الرادار القديم كأنها حالية.",
  p_rm: "إزالة", p_saving: "جارٍ الحفظ…", hdr_notif: "🔔 التنبيهات",
});

const P = { supported: "serviceWorker" in navigator && "PushManager" in window && "Notification" in window, sub: null, busy: false, msg: "", installEvt: null,
  cats: ls("pushCats") || { radar: true, community: true, warning: true }, q: "" };
const UA = navigator.userAgent || "";
const isIOS = /iPad|iPhone|iPod/.test(UA) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isAndroid = /Android/i.test(UA), isSamsung = /SamsungBrowser|SM-[A-Z0-9]/i.test(UA);
const standalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); P.installEvt = e; if (window.renderPush) renderPush(); });

function b64uToU8(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
async function postJSON(path, body) {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({})); if (!r.ok || j.ok === false) throw new Error(j.error || "HTTP " + r.status); return j;
}

/* ---- followed areas: favorites (cities / searched places) + followed neighborhoods (gazetteer) ---- */
function gazetteer() { return (typeof R !== "undefined" && R.db && R.db.places) || []; }
function followedAreas() {
  const out = new Map();
  for (const id of (typeof S !== "undefined" && S.favs) || []) { const p = byId(id); if (p) out.set(p.id, { id: p.id, n: p.en, a: p.ar || null, lat: p.lat, lon: p.lng }); }
  for (const id of (typeof C !== "undefined" && C.follows) || []) { const p = gazetteer().find((q) => q.id === id); if (p) out.set(p.id, { id: p.id, n: p.en, a: p.ar || null, lat: p.lat, lon: p.lon ?? p.lng }); }
  return [...out.values()];
}
function prefs() { return { places: followedAreas(), cats: P.cats, lang }; }
async function savePrefsForSW(p) { try { const c = await caches.open("push-prefs"); await c.put("/__push_prefs", new Response(JSON.stringify(p), { headers: { "content-type": "application/json" } })); } catch (_) {} }

/* ---- subscribe / sync / unsubscribe ---- */
async function currentSub() { if (!P.supported) return null; const reg = await navigator.serviceWorker.ready; return reg.pushManager.getSubscription(); }
async function syncSub() {   // push the latest areas/categories/language to the server for this device
  if (!P.sub) return;
  // followed neighborhoods resolve against the places list; never sync before it has loaded, or they'd be dropped
  for (let i = 0; i < 40 && C.follows.length && !gazetteer().length; i++) await new Promise((r) => setTimeout(r, 250));
  if (C.follows.length && !gazetteer().length) return;
  const p = prefs();
  await postJSON("/api/push/subscribe", { ...p, subscription: P.sub.toJSON() }); await savePrefsForSW(p);
}
let syncTimer = null;
function scheduleSync() { clearTimeout(syncTimer); syncTimer = setTimeout(() => syncSub().catch((e) => { P.msg = t("p_err", e.message); renderPush(); }), 600); }
async function enablePush() {
  P.busy = true; P.msg = t("p_saving"); renderPush();
  try {
    const perm = await Notification.requestPermission();      // must be triggered by this tap (iOS/Android requirement)
    if (perm !== "granted") { P.msg = ""; return; }
    const { publicKey } = await (await fetch("/api/push/key", { cache: "no-store" })).json();
    const reg = await navigator.serviceWorker.ready;
    P.sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToU8(publicKey) });
    await syncSub(); ls("notify", false);                      // background push replaces the old "while open" alerts → no duplicates
    P.msg = "";
  } catch (e) { P.msg = t("p_err", e.message || e); }
  finally { P.busy = false; renderPush(); }
}
async function disablePush() {
  P.busy = true; renderPush();
  try { const s = P.sub || await currentSub(); if (s) { await postJSON("/api/push/unsubscribe", { endpoint: s.endpoint }).catch(() => {}); await s.unsubscribe(); } P.sub = null; P.msg = ""; }
  catch (e) { P.msg = t("p_err", e.message || e); }
  finally { P.busy = false; renderPush(); }
}
async function sendTest() {
  try { const r = await postJSON("/api/push/test", { endpoint: P.sub.endpoint, delayMs: 45000 }); P.msg = r.ok ? t("p_test_sent") : t("p_test_wait"); }
  catch (e) { P.msg = /rate/.test(e.message) ? t("p_test_wait") : t("p_err", e.message); }
  renderPush();
}

/* ---- the Alerts-tab panel ---- */
function renderPush() {
  const box = document.getElementById("pushSlot"); if (!box) return;
  let h = `<div class="chd"><h2>${t("p_title")}</h2><span class="pstate ${P.sub ? "on" : ""}">${P.sub ? t("p_on") : t("p_off")}</span></div><p class="muted sm">${t("p_sub")}</p>`;
  if (isIOS && !standalone()) h += `<div class="pnote">${t("p_ios")}</div>`;
  else if (!P.supported) h += `<div class="pnote">${t("p_unsupported")}</div>`;
  else {
    if (isAndroid && !standalone() && P.installEvt) h += `<button class="btn wide" id="pInstall">${t("p_install")}</button><div class="muted sm" style="margin:4px 0 8px">${t("p_install_tip")}</div>`;
    if (Notification.permission === "denied") h += `<div class="pnote bad">${t("p_denied")}</div>`;
    else if (!P.sub) h += `<button class="btn wide primary" id="pEnable" ${P.busy ? "disabled" : ""}>${t("p_enable")}</button>`;
    if (isAndroid && isSamsung) h += `<div class="muted sm" style="margin-top:6px">${t("p_samsung")}</div>`;
  }
  // categories (stored locally; synced to the server when subscribed)
  h += `<h3>${t("p_cats")}</h3>` + ["radar", "community", "warning"].map((c) => `<label class="pcat"><input type="checkbox" data-cat="${c}" ${P.cats[c] ? "checked" : ""}><span><b>${t("p_cat_" + c)}</b><br><span class="muted sm">${t("p_cat_" + c + "_d")}</span></span></label>`).join("");
  // followed areas + neighborhood picker
  const areas = followedAreas();
  h += `<h3>${t("p_areas", areas.length)}</h3>`;
  h += areas.length ? `<div class="pareas">` + areas.map((a) => `<span class="pchip">${esc(lang === "ar" ? a.a || a.n : a.n)} <button class="link prm" data-rm="${esc(a.id)}" aria-label="${t("p_rm")}">✕</button></span>`).join("") + `</div>` : `<p class="muted sm">${t("p_areas_none")}</p>`;
  h += `<div class="padd"><input id="pQ" type="search" autocomplete="off" placeholder="${esc(t("p_add"))}" value="${esc(P.q)}"><div id="pRes" class="results" hidden></div></div>`;
  if (P.sub) h += `<div class="acts" style="margin-top:10px"><button class="btn" id="pTest">${t("p_test")}</button><button class="btn" id="pOff">${t("p_disable")}</button></div><div class="muted sm">${t("p_test_hint")}</div>`;
  h += `<div class="muted sm" style="margin-top:6px">${t("p_limits")}</div>`;
  if (P.msg) h += `<div class="pmsg">${esc(P.msg)}</div>`;
  box.innerHTML = h;
  const on = (id, f) => { const el = document.getElementById(id); if (el) el.addEventListener("click", f); };
  on("pEnable", enablePush); on("pOff", disablePush); on("pTest", sendTest);
  on("pInstall", async () => { if (!P.installEvt) return; P.installEvt.prompt(); await P.installEvt.userChoice.catch(() => {}); P.installEvt = null; renderPush(); });
  box.querySelectorAll("[data-cat]").forEach((cb) => cb.addEventListener("change", () => { P.cats[cb.dataset.cat] = cb.checked; ls("pushCats", P.cats); scheduleSync(); }));
  box.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => {
    const id = b.dataset.rm;
    if (S.favs.includes(id)) { S.favs = S.favs.filter((x) => x !== id); ls("favs", S.favs); }
    if (C.follows.includes(id)) { C.follows = C.follows.filter((x) => x !== id); ls("cfollows", C.follows); }
    renderPush(); scheduleSync();
  }));
  const q = document.getElementById("pQ"), res = document.getElementById("pRes");
  if (q) q.addEventListener("input", () => {
    P.q = q.value; const s = q.value.trim(), sl = s.toLowerCase();
    if (s.length < 2) { res.hidden = true; return; }
    const list = gazetteer().filter((p) => p.en.toLowerCase().includes(sl) || (p.ar || "").includes(s)).slice(0, 8);
    res.hidden = !list.length;
    res.innerHTML = list.map((p) => `<button data-add="${esc(p.id)}">${esc(lang === "ar" ? p.ar || p.en : p.en)} <span class="muted sm">· ${esc(p.en)}</span></button>`).join("");
    res.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => {
      if (!C.follows.includes(b.dataset.add)) { C.follows = C.follows.concat(b.dataset.add); ls("cfollows", C.follows); }
      P.q = ""; renderPush(); scheduleSync();
    }));
  });
}

/* ---- notification tap → open the exact report / map location ---- */
function handleDeepLink(href) {
  let u; try { u = new URL(href, location.origin); } catch (_) { return; }
  const tab = u.searchParams.get("tab"), lat = parseFloat(u.searchParams.get("lat")), lon = parseFloat(u.searchParams.get("lon"));
  const report = u.searchParams.get("report"), placeId = u.searchParams.get("place");
  if (!tab && !report) return;
  if (typeof setTab === "function" && tab) setTab(tab);
  if (Number.isFinite(lat) && Number.isFinite(lon) && S.map) {
    setTimeout(() => {
      S.map.setView([lat, lon], 11);
      const g = report && C.data && (C.data.groups || []).find((x) => x.id === report);
      const html = g ? `<b>${esc(g.place ? g.place.name : "")}</b><br>${evLabel(g.event)} · ${t(ST_LABEL[g.verify] || "st_unverified")}<br>${g.sources.map((s) => esc(srcLabel(s.source)) + (s.url ? ` <a href="${esc(s.url)}" target="_blank" rel="noopener">↗</a>` : "")).join(" · ")}<br><span class="muted">${t("c_pub", ageTxt(ageMin(g.publishMs)))}</span>`
        : `<b>${esc(placeId || "")}</b>`;
      L.popup().setLatLng([lat, lon]).setContent(html).openOn(S.map);
    }, 350);
  }
  if (location.search) history.replaceState(null, "", location.pathname);
}
if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", (e) => { if (e.data && e.data.type === "open-url") handleDeepLink(e.data.url); });

/* ---- boot: restore subscription state, keep the server in sync, honour a deep link the app was opened with ---- */
async function initPush() {
  if (P.supported) { try { P.sub = await currentSub(); if (P.sub) { ls("notify", false); scheduleSync(); } } catch (_) {} }
  renderPush();
  const first = location.href;
  if (/[?&](tab|report)=/.test(first)) {          // data (map/community) may still be loading; wait for it briefly
    let n = 0; const iv = setInterval(() => { n++; if ((typeof C !== "undefined" && C.data) || n > 20) { clearInterval(iv); handleDeepLink(first); } }, 300);
  }
}
window.renderPush = renderPush;
window.pushOnLangChange = () => { if (P.sub) scheduleSync(); };   // notifications follow the app language
document.addEventListener("DOMContentLoaded", initPush);
