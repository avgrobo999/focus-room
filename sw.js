/* Only here so notifications work on phones (Android needs a service worker to show them).
   It doesn't cache or intercept anything. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const tab = tabs.find((c) => c.url.includes('#r=')) || tabs[0];
    if (tab) { tab.postMessage({ t: 'notify-click', action: e.action || '', tag: e.notification.tag || '' }); return tab.focus(); }
    return self.clients.openWindow('./');
  })());
});
