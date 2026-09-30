/**
 * Entitlement constants the client applies to a cached registry answer (#95).
 *
 * The trial and lapse rules live on the server (`infrastructure/lambda/registry/entitlement.mjs`);
 * this is only the offline window, shared by `entitlementStore` (the rule) and `PlanCard` (the
 * sentence that names it), so the copy can never quote a different number from the one enforced.
 */

/** How long an open-ended cached answer (`active`, `beta`) is honoured without the registry. */
export const OFFLINE_GRACE_DAYS = 14;
