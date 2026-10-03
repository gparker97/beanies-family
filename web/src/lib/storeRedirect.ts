/**
 * The /ios and /android redirect pages' one script (docs/plans/2026-10-03-marketing-events-
 * ledger-inferred-attribution.md, Section C). Those pages are the single path to the stores:
 * the badges, pins, print collateral and /download's phone redirect all land here, so the
 * `store_tap` event is recorded here, once per tap, and nowhere else.
 */
import { toSearchParams, type Attribution } from '@beanies/brand/attribution';
import { STORE_URL } from '@beanies/brand/nav';
import { isEntryPageview, sendMarketingEvent } from './marketingEvents';
import { readStoredAttribution } from './storedAttribution';

/**
 * Apple's App Store campaign provider token (the `pt` parameter). It is NOT a secret: it is
 * visible in every campaign link. While empty, `/ios` omits `pt` and `ct`, so the App Store URL
 * is unchanged. Nothing else reads it; supply the value here.
 */
export const APPLE_PROVIDER_TOKEN = '129269616';
/**
 * Apple's campaign links use the `/app/apple-store/id…` path with `mt=8`, as App Store Connect
 * generates them (greg's link, 2026-10-03). `ct` is the ad slug, so each ad shows up as its own
 * campaign in App Analytics without being pre-created there.
 */
const APPLE_CAMPAIGN_BASE = 'https://apps.apple.com/app/apple-store/id6798513944';

/** Apple truncates the campaign token `ct` at 40 characters. */
const APPLE_CT_MAX = 40;

export type StorePlatform = 'ios' | 'android';

/** The store URL, carrying the tag where the store can take one. Pure. */
export function buildStoreUrl(platform: StorePlatform, fields: Attribution | null): string {
  const url = new URL(STORE_URL[platform]);
  if (platform === 'android') {
    if (fields) {
      // Plan rule (docs/plans/2026-10-03-marketing-events-ledger-inferred-attribution.md):
      // `oppref` and the ad ids are stored for our own use and never sent anywhere. Google Play
      // gets the `utm_*` keys only; the scorer and dashboard key on utm_campaign / utm_content.
      const referrer = new URLSearchParams(
        [...toSearchParams(fields)].filter(([k]) => k.startsWith('utm_'))
      ).toString();
      if (referrer) url.searchParams.set('referrer', referrer);
    }
  } else if (APPLE_PROVIDER_TOKEN && fields?.utm_content) {
    const campaign = new URL(APPLE_CAMPAIGN_BASE);
    campaign.searchParams.set('pt', APPLE_PROVIDER_TOKEN);
    campaign.searchParams.set('ct', fields.utm_content.slice(0, APPLE_CT_MAX));
    campaign.searchParams.set('mt', '8');
    return campaign.toString();
  }
  return url.toString();
}

export function redirectToStore(platform: StorePlatform): void {
  const fields = readStoredAttribution(location.search);
  // These pages are the direct targets of pins and print collateral, so a visit here can be the
  // visitor's first page on the site.
  if (isEntryPageview()) sendMarketingEvent({ kind: 'landing', fields, loc: location.pathname });
  sendMarketingEvent({ kind: 'store_tap', platform, fields, loc: location.pathname });
  const target = buildStoreUrl(platform, fields);
  const fallback = document.getElementById('store-fallback');
  if (fallback instanceof HTMLAnchorElement) fallback.href = target;
  location.replace(target);
}
