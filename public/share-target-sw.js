/* eslint-env serviceworker */
/**
 * Web Share Target POST handler (#64).
 *
 * Pulled into the generated service worker via workbox `importScripts`, deliberately rather
 * than switching vite-plugin-pwa to `injectManifest`: that switch would rewrite the
 * carefully-tuned update flow (usePwaUpdater, no skipWaiting/clientsClaim) for one route.
 *
 * A share target POST cannot be read by a normal page navigation, so it is intercepted here:
 * the files are stashed in a Cache entry keyed by a random id, and the browser is redirected
 * to /share?id=… which the app reads and clears. A failure redirects with ?error=stash so
 * the user gets a real message — never a blank POST response.
 */
const SHARE_CACHE = 'beanies-share-target';
const SHARE_PATH = '/share';

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.pathname !== SHARE_PATH) return;

  event.respondWith(
    (async () => {
      try {
        const formData = await event.request.formData();
        const files = formData.getAll('documents').filter((v) => v instanceof File);
        if (files.length === 0) {
          return Response.redirect(`${SHARE_PATH}?error=empty`, 303);
        }

        const id = crypto.randomUUID();
        const cache = await caches.open(SHARE_CACHE);
        // One cache entry per file, under a shared id prefix, so the route can read them
        // back in order and delete the whole batch.
        await Promise.all(
          files.map((file, index) =>
            cache.put(
              new Request(`/__share/${id}/${index}`),
              new Response(file, {
                headers: {
                  'content-type': file.type || 'application/octet-stream',
                  'x-share-name': encodeURIComponent(file.name || 'shared'),
                  'x-share-count': String(files.length),
                },
              })
            )
          )
        );
        return Response.redirect(`${SHARE_PATH}?id=${id}`, 303);
      } catch (err) {
        // Never leave the POST hanging or blank: redirect so the app can say what happened.
        console.error('[share-target-sw] failed to stash the shared files', err);
        return Response.redirect(`${SHARE_PATH}?error=stash`, 303);
      }
    })()
  );
});
