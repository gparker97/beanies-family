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
 *
 * Sent ONLY from an origin the registry Lambda accepts (`SENDING_ORIGINS`). Any other origin gets a
 * 403 `origin_not_allowed`, which the browser logs as a console error: Lighthouse CI serves the
 * static build on a random `localhost` port, and that error failed its `errors-in-console` gate on
 * every web PR from 2026-10-05. The Lambda's list is Terraform `cors_origins` in the ops repo's
 * `infrastructure/modules/registry/variables.tf`; keep the marketing-site entries here in step.
 */
import type { Attribution } from '@beanies/brand/attribution';

export const EVENTS_URL = 'https://api.beanies.family/events';

/** The marketing-site origins the registry Lambda accepts on `POST /events`. */
export const SENDING_ORIGINS: ReadonlySet<string> = new Set([
  'https://beanies.family',
  'https://www.beanies.family',
  'http://localhost:4321', // `astro dev` / `astro preview`, routed to the dev events table
]);

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
    if (!SENDING_ORIGINS.has(location.origin)) {
      // Not an error: a CI build, a proxy or a preview host. Info, so Lighthouse does not count it.
      console.info(`[marketing-events] ${ev.kind} not sent from ${location.origin}`);
      return;
    }
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
