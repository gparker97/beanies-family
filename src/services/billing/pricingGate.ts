/**
 * The predicates every pricing surface asks (#95). ONE place, so the router guard, the Settings
 * card, the read-only gate and "See plans" can never disagree.
 *
 *   isPricingAvailable()   plan state is shown and acted on here: the registry is configured
 *                          (`features.entitlement`, every platform) AND the `pricing` rollout
 *                          flag is on (per build + the per-browser override).
 *   isPlanPageReachable()  a plan can be CHOSEN here: the above, plus the Stripe publishable key
 *                          (`features.checkout`) and not a native shell (Apple 3.1.3(f), Google
 *                          Play). iOS / Android show the card and the band, never the page.
 *
 * Functions, not constants: the flag override is read from localStorage at call time.
 */
import { features } from '@/config/features';
import { isFlagEnabled } from '@/config/flags';
import { isNative } from '@/services/sync/capabilities';

export function isPricingAvailable(): boolean {
  return features.entitlement && isFlagEnabled('pricing');
}

export function isPlanPageReachable(): boolean {
  return isPricingAvailable() && features.checkout && !isNative();
}
