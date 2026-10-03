/**
 * The marketing site's first-party event beacon (docs/plans/2026-10-03-marketing-events-ledger-
 * inferred-attribution.md, Section C). The SINGLE OWNER of the POST to the registry API's
 * `/events` route; nothing else on the site builds that request.
 *
 * Two kinds: `landing` (an entry pageview) and `store_tap` (an App Store or Play badge tap,
 * sent by the /ios and /android redirect pages). No cookie, no identifier, no storage.
 *
 * One URL, no dev branch: an `astro dev` visit sends `Origin: http://localhost:4321`, which the
 * Lambda routes to the dev events table.
 */
import type { Attribution } from '@beanies/brand/attribution';

export const EVENTS_URL = 'https://api.beanies.family/events';

export interface MarketingEvent {
  kind: 'landing' | 'store_tap';
  platform?: 'ios' | 'android';
  fields: Attribution | null;
  /** The page path the event happened on. */
  loc: string;
}

/**
 * Fire-and-forget. A string body goes out as `text/plain`, a CORS simple request, so there is no
 * preflight to be dropped on unload. `sendBeacon` returns false when absent OR refused (size or
 * queue limits), so both fall through to a keepalive `fetch`. Never throws.
 */
export function sendMarketingEvent(ev: MarketingEvent): void {
  try {
    const body = JSON.stringify({
      kind: ev.kind,
      ...(ev.platform ? { platform: ev.platform } : {}),
      ...(ev.fields ? { fields: ev.fields } : {}),
      loc: ev.loc,
    });
    if (!navigator.sendBeacon?.(EVENTS_URL, body)) {
      fetch(EVENTS_URL, { method: 'POST', body, keepalive: true, mode: 'cors' }).catch((err) => {
        console.warn(
          '[marketing-events] beacon failed — event lost; check api.beanies.family/events and ALLOWED_ORIGINS',
          err
        );
      });
    }
  } catch (err) {
    console.warn('[marketing-events] could not send event — event lost', err);
  }
}

/**
 * True for an entry pageview: no referrer, or a referrer from another origin. Referrer-only, no
 * storage: the site sets no referrer policy, so same-origin navigations carry a same-origin
 * referrer. A reload re-fires `landing`, accepted because `landing` feeds the funnel only.
 */
export function isEntryPageview(): boolean {
  if (!document.referrer) return true;
  try {
    return new URL(document.referrer).origin !== location.origin;
  } catch {
    return true;
  }
}
