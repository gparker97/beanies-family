/**
 * beanies deep-link markers, and the two ways we read one.
 *
 * Every link this app generates for ANOTHER device to open carries its payload in the URL
 * FRAGMENT, never the query string: fragments are not sent to a server, are not logged by
 * one, and do not end up in a referrer. That is the whole reason these are hash markers.
 *
 * This module exists because the extraction was hand-rolled twice and the copies had
 * already drifted: `recoveryKit.parseKitInput` used the exported `KIT_LINK_HASH` constant,
 * while `LoginPage` matched a literal `/beanies-kit=([^&]+)/` three lines away in another
 * file. A third marker (device approval) would have made three copies.
 *
 * ⚠️ NOT `src/utils/url.ts`. That module is external/user-content URL *safety* —
 * `safeExternalHref`, `getUrlDomain`, `getFaviconUrl`. Our own link scheme has nothing to
 * do with it, and the two will never change for the same reason.
 */

/** Recovery-kit deep link: the printed kit's QR opens the app straight into kit entry. */
export const KIT_LINK_HASH = 'beanies-kit=';

/**
 * Device-approval deep link: a cold device shows this, a signed-in device scans it.
 * The payload is an ephemeral PUBLIC key — capturing it is worth nothing, which is why
 * this one is safe to display on a screen in a cafe.
 */
export const APPROVAL_LINK_HASH = 'beanies-approve=';

/**
 * Pull a marker's value out of arbitrary text — a scanned QR payload, a pasted URL, or
 * something that is neither.
 *
 * Returns `null` when the marker is absent, so a caller can tell "this is not one of our
 * links" from "this is our link and the value is empty". `parseKitInput` relies on exactly
 * that distinction to accept a hand-typed code unchanged.
 */
export function readHashMarker(text: string, marker: string): string | null {
  const idx = text.indexOf(marker);
  if (idx < 0) return null;
  const raw = text.slice(idx + marker.length).split(/[&?]/)[0] ?? '';
  try {
    return decodeURIComponent(raw);
  } catch {
    // A malformed percent-escape (a bare `%` in a hand-mangled link) throws rather than
    // returning garbage. The raw value is still the best guess we have and is what the
    // caller would have seen before this helper existed.
    return raw;
  }
}

/**
 * Read a marker from the CURRENT page's fragment and strip the fragment in the same call.
 *
 * The stripping is not optional hygiene bolted on by each caller — it is why this is one
 * function rather than two. A credential sitting in `window.location.hash` survives every
 * later `history.pushState`, shows up in any screenshot of the address bar, and is handed
 * to anything that later reads `location.href`. The single previous caller remembered to
 * do it; the second one cannot forget.
 *
 * Returns `null` when the marker is absent, and leaves the URL untouched in that case.
 */
export function consumeHashMarker(marker: string): string | null {
  if (typeof window === 'undefined') return null;
  const value = readHashMarker(window.location.hash, marker);
  if (value === null) return null;
  // `{}`, not `null` — `null` wipes vue-router's history state along with the fragment.
  history.replaceState({}, '', window.location.pathname + window.location.search);
  return value;
}

/**
 * Markers captured from the launch URL, before anything could navigate away from it.
 *
 * ⚠️ THIS EXISTS BECAUSE THE ROUTER EATS THE FRAGMENT. An approval link points at
 * `/welcome`, but the person scanning it is SIGNED IN — and `router.beforeEach` redirects an
 * authenticated user away from `/welcome` to the Nook by NAME, which resolves with
 * `hash: ''`. So by the time any component's `onMounted` ran, the fragment was already gone.
 * Capturing at module scope, before `app.mount()`, is the only point that is guaranteed to
 * be ahead of the first navigation.
 */
const captured = new Map<string, string>();

/**
 * Read the given markers out of a URL and remember them. Called from `main.ts` before the
 * app mounts, and again from the inbound-link bridge for a WARM open — where no component
 * lifecycle re-runs at all, so nothing else would notice the URL.
 */
export function captureHashMarkers(markers: string[], href?: string): void {
  if (typeof window === 'undefined') return;
  const hash = href ? (href.split('#')[1] ?? '') : window.location.hash;
  if (!hash) return;
  let found = false;
  for (const marker of markers) {
    const value = readHashMarker(hash, marker);
    if (value !== null) {
      captured.set(marker, value);
      found = true;
    }
  }
  // Strip only when we took something, and only for the current page — a warm open passes a
  // URL that is not `window.location`.
  if (found && !href) {
    history.replaceState({}, '', window.location.pathname + window.location.search);
  }
}

/** Take a captured marker, clearing it so a re-render cannot re-trigger the same flow. */
export function takeCapturedMarker(marker: string): string | null {
  const value = captured.get(marker) ?? null;
  captured.delete(marker);
  return value;
}
