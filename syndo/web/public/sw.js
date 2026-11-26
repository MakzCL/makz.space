// SEND service worker: shows push notifications while SEND isn't open, and opens the right
// conversation when one is clicked. It doesn't cache the app (updates stay instant).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: "SEND", body: e.data ? e.data.text() : "" }; }
  e.waitUntil((async () => {
    // Don't double up when a SEND window is open and focused.
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (wins.some((w) => w.focused)) return;
    await self.registration.showNotification(d.title || "SEND", {
      body: d.body || "", tag: d.tag, renotify: !!d.tag, icon: d.icon || "/brand/send-icon-192.png", badge: "/brand/send-icon-192.png", data: { url: d.url || "/channels/@me" },
    });
  })());
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "/channels/@me", self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) if (new URL(w.url).origin === self.location.origin) { await w.focus(); w.navigate(url).catch(() => {}); return; }
    await self.clients.openWindow(url);
  })());
});
