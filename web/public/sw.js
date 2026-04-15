/**
 * Apex self-unregistering service worker.
 *
 * Context: pre-cutover, the Vue PWA was served from the apex domain and
 * registered a Workbox service worker at scope `/`. After the apex
 * cutover (#167), the apex serves the static Astro marketing site and
 * the PWA moves to `app.beanies.family`. This file replaces the old
 * Workbox SW so existing installs clean themselves up.
 *
 * Install → activate → clear caches → unregister → navigate clients.
 * Once all clients have seen this, the browser un-installs the SW.
 *
 * Served with Cache-Control: no-cache (see CloudFront config / bucket
 * metadata) so browsers pick up the replacement quickly on their next
 * update check.
 */

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ includeUncontrolled: true });
      clients.forEach((client) => {
        // This SW only ever runs against clients that had the old Vue PWA SW
        // registered — i.e., users who had actually used the app. Redirect
        // them to the new app origin rather than reloading the apex marketing
        // site (which would leave them confused about where their app went).
        // Preserve the original path so deep-links (/dashboard, /nook, etc.)
        // land on the matching app route.
        try {
          const url = new URL(client.url);
          const target = 'https://app.beanies.family' + url.pathname + url.search + url.hash;
          client.navigate(target);
        } catch {
          if (client.url) client.navigate(client.url);
        }
      });
    })(),
  );
});
