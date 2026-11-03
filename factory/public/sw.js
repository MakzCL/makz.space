// Network-first for the app shell, cache as fallback so the app opens offline.
const CACHE = "skf-v6";
self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/", "/icon.svg"]))); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return; // never cache Supabase/API calls
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((r) => r || caches.match("/")))
  );
});

// ---------------------------------------------------------------- push
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: "Skalarki Factory", body: e.data ? e.data.text() : "" }; }
  const call = d.kind === "call";
  const clock = d.kind === "clock";
  e.waitUntil(self.registration.showNotification(d.title || "Skalarki Factory", {
    body: d.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: d.link && (d.link.conversation_id || d.link.job_id || d.link.event_id) ? `${d.kind}-${d.link.conversation_id || d.link.job_id || d.link.event_id}` : d.id,
    renotify: true,
    requireInteraction: call,
    // Answer / Decline right on the notification — no need to open the chat first.
    actions: call && d.link && d.link.call_id ? [{ action: "answer", title: "Answer" }, { action: "decline", title: "End call" }] : [],
    vibrate: call ? [400, 200, 400, 200, 400] : clock ? [70, 60, 70] : [120, 60, 120],
    silent: false,
    data: d,
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const d = e.notification.data || {};
  const callId = d.link && d.link.call_id;
  if (callId && (e.action === "answer" || e.action === "decline")) {
    e.waitUntil((async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const w = wins.find((x) => "focus" in x);
      if (e.action === "decline") { if (w) w.postMessage({ type: "decline", call_id: callId }); return; }
      if (w) { w.postMessage({ type: "answer", call_id: callId }); return w.focus(); }
      return self.clients.openWindow("/?answer=" + encodeURIComponent(callId));
    })());
    return;
  }
  const q = new URLSearchParams();
  if (d.link) for (const [k, v] of Object.entries(d.link)) if (v) q.set(k === "tab" ? "open" : k, String(v));
  const url = "/" + (q.toString() ? "?" + q.toString() : "");
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) { if ("focus" in w) { w.postMessage({ type: "open", link: d.link || {} }); return w.focus(); } }
    return self.clients.openWindow(url);
  })());
});
