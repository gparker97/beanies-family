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

/**
 * Mirrors MAX_SHARE_TEXT_CHARS in src/services/share/types.ts.
 *
 * Bounded HERE as well as in the app: without it a multi-megabyte `navigator.share({text})`
 * is written whole into persistent Cache Storage and then materialised whole as a JS string
 * during a cold launch-from-share-sheet. The app-side cap slices AFTER that, which is the
 * OOM it exists to prevent. The Android and iOS paths are both bounded before this point;
 * the PWA had no equivalent.
 */
const MAX_TEXT_CHARS = 4000;

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Scoped deliberately: matching on the path alone would intercept ANY POST the app makes
  // to a `/share` path on any origin and consume its body, and `formData()` on a JSON body
  // throws — the caller would get a redirect to our error screen instead of its response.
  //
  // `mode` is checked but NOT required. Every browser that implements Web Share Target today
  // delivers this as a navigation, so a non-navigate POST to our own /share is much more
  // likely to be app code than a share — but making `navigate` mandatory would mean a UA
  // that labels it differently silently loses the share to a 405 from S3, with no telemetry.
  // Content-type is the reliable discriminator: a share target is always multipart form data.
  if (
    event.request.method !== 'POST' ||
    url.origin !== self.location.origin ||
    url.pathname !== SHARE_PATH
  ) {
    return;
  }
  const contentType = event.request.headers.get('content-type') || '';
  if (event.request.mode !== 'navigate' && !contentType.startsWith('multipart/form-data')) {
    return;
  }

  event.respondWith(
    (async () => {
      try {
        const formData = await event.request.formData();
        const files = formData.getAll('documents').filter((v) => v instanceof File);

        // BOTH fields, joined. Chrome routes a shared link into `url` when the sender marks
        // it as one and into `text` when it does not, and a "title + URL" share fills both.
        // Joining means no branch has to guess which field was used — `extractUrls` finds
        // the link wherever it landed.
        const text = [formData.get('url'), formData.get('text')]
          .filter((v) => typeof v === 'string' && v)
          .join('\n')
          .slice(0, MAX_TEXT_CHARS);

        if (files.length === 0 && !text) {
          return Response.redirect(`${SHARE_PATH}?error=empty`, 303);
        }

        const id = crypto.randomUUID();
        const cache = await caches.open(SHARE_CACHE);
        // One cache entry per file plus at most one for the text, under a shared id prefix,
        // so the route can read them back in order and delete the whole batch.
        //
        // ALL of them in ONE `Promise.all`: writing the text afterwards meant a failure
        // there (a quota error is the realistic one) left every already-committed file
        // orphaned under a UUID nobody holds — and `readAndClearShareStash` is the only
        // thing in the codebase that deletes them.
        const writes = files.map((file, index) =>
          cache.put(
            new Request(`/__share/${id}/${index}`),
            new Response(file, {
              headers: {
                'content-type': file.type || 'application/octet-stream',
                'x-share-name': encodeURIComponent(file.name || 'shared'),
              },
            })
          )
        );
        if (text) {
          writes.push(
            cache.put(
              new Request(`/__share/${id}/text`),
              new Response(text, { headers: { 'content-type': 'text/plain' } })
            )
          );
        }
        try {
          await Promise.all(writes);
        } catch (err) {
          // Leave nothing behind. A half-written batch is someone else's document sitting in
          // Cache Storage indefinitely, with no id anywhere to reach it by.
          await Promise.all(
            [...files.keys()]
              .map((index) => cache.delete(new Request(`/__share/${id}/${index}`)))
              .concat(cache.delete(new Request(`/__share/${id}/text`)))
          ).catch(() => undefined);
          throw err;
        }
        return Response.redirect(`${SHARE_PATH}?id=${id}`, 303);
      } catch (err) {
        // Never leave the POST hanging or blank: redirect so the app can say what happened.
        console.error('[share-target-sw] failed to stash the shared files', err);
        return Response.redirect(`${SHARE_PATH}?error=stash`, 303);
      }
    })()
  );
});
