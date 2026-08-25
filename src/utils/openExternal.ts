/**
 * Opens an external URL in the user's browser, robustly across standalone PWAs.
 *
 * Why not `window.open(url, '_blank', 'noopener,noreferrer')`? In standalone
 * display mode (installed PWA), `window.open` with a features string does NOT
 * spawn a real browser tab — iOS navigates the PWA window in-place, and the
 * opened context still reports `display-mode: standalone`. For our help/marketing
 * links (they live on the apex `beanies.family` origin, outside the app's PWA
 * scope) that trips the marketing site's standalone escape-hatch redirect, which
 * bounces back into the app's `/help` external-redirect — an infinite loop.
 *
 * A programmatic out-of-scope `<a target="_blank" rel="noopener noreferrer">`
 * click instead hands the navigation to the system browser (a real tab in
 * `display-mode: browser`) on both iOS and Android standalone PWAs, so the
 * escape-hatch never fires. `rel="noopener noreferrer"` keeps the security
 * posture of the old call (no `window.opener` handle, no referrer leak).
 *
 * Must be called synchronously inside the originating user gesture (the
 * caller's click handler) so the click isn't treated as programmatic and
 * blocked by the popup blocker.
 */
import { safeExternalHref } from '@/utils/url';

export function openExternal(url: string): void {
  if (typeof document === 'undefined') return;
  // Guard against an empty/unresolved href — an empty anchor href navigates to
  // the current page (a silent no-op reload). Fail loud in the console instead
  // so a mis-wired caller is caught in dev rather than silently doing nothing.
  if (!url) {
    console.error('[openExternal] called with an empty url — link will no-op');
    return;
  }
  // SECURITY: screen the scheme HERE, not only at every :href binding. This helper has the
  // same semantics as an anchor — a `javascript://%0aalert(1)` value executes in our origin
  // — and it is what the next developer will reach for when rendering something like
  // `Recipe.sourceUrl`. Screening the shared helper closes the class, not the instances.
  const href = safeExternalHref(url);
  if (!href) {
    console.error(
      '[openExternal] refused a url whose scheme is not http(s) — nothing was opened. ' +
        'Only https:/http: are navigable; javascript:, data:, vbscript: and file: are blocked. ' +
        'If this is a legitimate link, it is malformed; if it came from a model or a web page, ' +
        'this refusal is the guard working.'
    );
    return;
  }
  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  // Some engines only treat the synthetic click as a real navigation when the
  // anchor is connected to the document; append → click → remove.
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
