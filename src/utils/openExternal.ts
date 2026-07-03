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
export function openExternal(url: string): void {
  if (typeof document === 'undefined') return;
  // Guard against an empty/unresolved href — an empty anchor href navigates to
  // the current page (a silent no-op reload). Fail loud in the console instead
  // so a mis-wired caller is caught in dev rather than silently doing nothing.
  if (!url) {
    console.error('[openExternal] called with an empty url — link will no-op');
    return;
  }
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  // Some engines only treat the synthetic click as a real navigation when the
  // anchor is connected to the document; append → click → remove.
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
