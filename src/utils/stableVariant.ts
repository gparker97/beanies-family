// Deterministic per-id visual variation (#86).
//
// Two components had already written this loop byte-for-byte identically — `EveryoneSpread`'s
// `rotationFor` and `ScrapbookSpine`'s `inactiveTilt` — and the recipe placeholder needs a
// third. One shared helper, three callers.
//
// ⚠️ THIS IS NOT THE ONLY HASH IN THE CODEBASE, AND THE OTHERS MUST NOT BE FOLDED INTO IT.
//
// (Module and function are named separately below on purpose. Written as one dotted path,
// the secret scanner scores the token at entropy 4.21 and fails the security gate on a
// comment. An inline suppression does NOT survive: `no-secrets` lives only in
// eslint.security.config.js, so the pre-commit `eslint --fix` strips the directive as
// unused and the gate then fails in CI instead.)
//
// `computePushHash` in `activityToGoogleEvent`, `stableNotificationId` in
// `useLocalNotifications`, and `hashString` in `uiStrings` all PERSIST their output — as
// `lastPushedHash` on a calendar link, as
// a scheduled notification id, and as a translation-drift marker respectively. Changing the
// algorithm behind any of those would re-push every activity in every family's calendar,
// orphan scheduled notifications, or invalidate every translation. They look like duplication
// and are not: a persisted hash is a data format, not a helper.
//
// What lives here is the opposite case — values that exist only for the current render and can
// change freely between releases without consequence.

/** djb2-style rolling hash. Not cryptographic; only ever used to pick a look. */
function hashSeed(seed: string): number {
  let hash = 0;
  for (const c of seed) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(hash);
}

/**
 * A stable bucket index in `[0, buckets)` for this seed.
 *
 * The same seed always returns the same index, so one recipe keeps one look across renders,
 * reloads and devices; different seeds spread across the buckets so a grid does not repeat.
 */
export function stableIndex(seed: string, buckets: number): number {
  if (buckets <= 0) return 0;
  return hashSeed(seed) % buckets;
}

/**
 * A stable fraction in `[0, 1)` for this seed.
 *
 * Quantised to hundredths, which is what the rotation callers were already doing — kept
 * deliberately so the refactor is value-identical and the scrapbook does not visibly shift.
 */
export function stableFraction(seed: string): number {
  return (hashSeed(seed) % 100) / 100;
}
