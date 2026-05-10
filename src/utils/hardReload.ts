/**
 * Hard-reload primitive that actively defeats stale service-worker caches.
 *
 * The PWA precaches `index.html` and the hashed JS/CSS chunk filenames
 * (workbox `globPatterns`). With `registerType: 'prompt'`, the SW only
 * activates a new version after the user accepts the update banner.
 * In the gap between deploy and accept, every navigation that triggers
 * a route's lazy `import()` looks up a chunk filename that no longer
 * exists on the server (filenames are content-hashed) and the import
 * promise rejects with `Failed to fetch dynamically imported module`.
 *
 * `window.location.reload()` is NOT enough to recover: the SW intercepts
 * the navigation, returns the same cached `index.html`, and the user
 * lands right back on the broken state. We have to evict the precache
 * AND tell the SW to update before navigating, otherwise the same dead
 * chunk URLs come back.
 *
 * This is the recovery primitive shared by:
 *   - `router.onError` (auto-recovery on chunk fetch failure)
 *   - `vite:preloadError` window listener (modulepreload failure)
 *   - The error-overlay "Reload" button in `App.vue`
 *   - The "Sign Out & Clear Data" path
 *   - The "new version ready" action toast from the header refresh icon
 *
 * Caller-side loop protection: the auto-recovery paths set a
 * `sessionStorage` flag before invoking and clear it on the next
 * successful navigation, so if the new HTML *also* fails (e.g. network
 * down) we surface the error overlay instead of looping.
 */
export async function hardReload(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        try {
          await reg.update();
        } catch (e) {
          console.warn('[hardReload] SW update failed (transient):', e);
        }
        if (reg.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
      }
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (e) {
    console.warn('[hardReload] cache/SW cleanup failed, reloading anyway:', e);
  } finally {
    // `replace` (not assign) so the broken state isn't a back-button trap.
    // `pathname + search` re-hits the same route with a fresh fetch chain.
    window.location.replace(window.location.pathname + window.location.search);
  }
}

/**
 * Match the various module-load error shapes produced by Vite + browsers
 * when a hashed chunk filename has rotated (post-deploy stale-SW gap).
 *
 * Covers:
 *   - Chrome/Edge: "Failed to fetch dynamically imported module"
 *   - Firefox: "error loading dynamically imported module"
 *   - Safari: "Importing a module script failed"
 *   - Vue Router fallback: "Couldn't resolve component "<name>" at "<path>""
 *     fires when the route's lazy `import()` resolves to something that
 *     isn't a valid module (e.g., CloudFront serves the SPA's 404 HTML
 *     in place of the rotated chunk filename — import() succeeds but
 *     the module has no `default` export, so Vue Router's resolver
 *     throws). Same root cause, different observable error shape.
 *     Caught live 2026-05-04 from a stale tab three deploys behind HEAD.
 *   - Destructure-of-null TypeError: when the dynamic `import()` resolves
 *     to `null` (rather than throwing one of the shapes above), every
 *     downstream `const { foo } = await import(...)` throws this. Observed
 *     live 2026-05-10 from greg's iPhone PWA mid-update — the SW served a
 *     response for the rotated chunk URL that parsed as a null module
 *     instead of a fetch failure, so `vite:preloadError` didn't fire and
 *     the App.vue init catch saw a generic TypeError. The destructure
 *     site (`App.vue:499` for `registerGoogleAccountAssertion`) named the
 *     property in the message — distinctive enough to recognize without
 *     swallowing real null-deref bugs.
 */
export function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return (
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /Couldn't resolve component .+ at /i.test(msg) ||
    // V8/Firefox/modern WebKit shape when a dynamic import resolves to
    // null/undefined and the result is destructured.
    /Cannot destructure property .+ as it is (?:null|undefined)/i.test(msg)
  );
}

/**
 * sessionStorage flag the chunk-load recovery paths set before invoking
 * `hardReload()` so a still-broken new HTML doesn't re-trigger an infinite
 * recovery loop. Cleared by `router.beforeEach`/`afterEach` on the next
 * successful navigation. Single source of truth — previously duplicated
 * across `main.ts`, `router/index.ts`, and now `App.vue` init.
 */
export const CHUNK_RELOAD_FLAG = 'chunkReloadAttempted';
