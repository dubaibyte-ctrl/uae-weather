/* App-shell cache + Web Push. Weather data, radar tiles and API calls are never cached here. */
const CACHE = "uae-weather-shell-v6";
const SHELL = ["./", "app.js", "rain.js", "community.js", "home.js", "push.js", "lib/radar-geo.js", "app.css", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png", "icons/badge-96.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== "push-prefs" && k !== SEEN).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== self.location.origin || u.pathname.startsWith("/api/")) return;
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put("./", c)); return r; }).catch(() => caches.match("./")));
    return;
  }
  e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});

/* ---------------- Web Push ----------------
   The server sends an encrypted JSON payload: { title, body, tag, url, ts, lang, dir, cat }. Shown even when every app
   window is closed. Tag = the weather event, so a repeat for the same event replaces rather than stacks. */
// Duplicate protection: every alert carries a stable event id (the same on a server retry). Ids seen in the last 48 h
// are remembered here; a repeat replaces the notification silently (same tag, no sound or vibration) instead of
// alerting again. Chrome requires each push to show something, so a repeat is never dropped outright.
const SEEN = "push-seen-v1", SEEN_MS = 48 * 3600e3, SEEN_MAX = 300;
async function seenBefore(id) {
  if (!id) return false;
  const c = await caches.open(SEEN), key = "/__seen/" + encodeURIComponent(id);
  const hit = await c.match(key);
  if (hit) { const t = Number(await hit.text()); if (Date.now() - t < SEEN_MS) return true; }
  await c.put(key, new Response(String(Date.now())));
  const keys = await c.keys();                                   // prune: oldest first by insertion order
  if (keys.length > SEEN_MAX) await Promise.all(keys.slice(0, keys.length - SEEN_MAX).map((k) => c.delete(k)));
  return false;
}
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: "UAE Rain & Weather", body: e.data ? e.data.text() : "" }; }
  const title = d.title || (d.lang === "ar" ? "طقس ومطر الإمارات" : "UAE Rain & Weather");
  e.waitUntil((async () => {
    let repeat = false;
    try { repeat = await seenBefore(d.id); } catch (_) {}         // storage trouble → show normally rather than lose it
    const opts = {
      body: d.body || "",
      tag: d.tag || d.id || undefined,
      renotify: !repeat && !!(d.tag || d.id),     // a new event for an existing tag alerts; a repeat of the same id doesn't
      silent: repeat,
      icon: "icons/icon-192.png",
      badge: "icons/badge-96.png",                // monochrome status-bar icon (Android / Samsung)
      lang: d.lang || "en",
      dir: d.dir || "auto",
      timestamp: d.ts || Date.now(),
      data: { url: d.url || "/", cat: d.cat || null, id: d.id || null, repeat },
    };
    if (!repeat) opts.vibrate = [180, 80, 180];
    await self.registration.showNotification(title, opts);
  })());
});

// Tap → open (or focus) the app at the exact report / map location carried in the payload URL.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin !== self.location.origin) continue;
      try { await w.focus(); } catch (_) {}
      w.postMessage({ type: "open-url", url: target });   // the open app routes in place (no reload, keeps the map)
      return;
    }
    await self.clients.openWindow(target);
  })());
});

// If the browser rotates the subscription, re-subscribe with the same key and re-register the saved preferences.
self.addEventListener("pushsubscriptionchange", (e) => {
  e.waitUntil((async () => {
    try {
      const prefsRes = await (await caches.open("push-prefs")).match("/__push_prefs");
      if (!prefsRes) return;
      const prefs = await prefsRes.json();
      const key = (e.oldSubscription && e.oldSubscription.options && e.oldSubscription.options.applicationServerKey) || null;
      const sub = e.newSubscription || await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await fetch("/api/push/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...prefs, subscription: sub.toJSON() }) });
      if (e.oldSubscription) await fetch("/api/push/unsubscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: e.oldSubscription.endpoint }) });
    } catch (_) {}
  })());
});
