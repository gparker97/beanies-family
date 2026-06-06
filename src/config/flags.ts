// Developer feature flags — NOT env-derived (see features.ts for env gating).
// For features we want to develop against PROD without exposing them to users.
//
// Default: ON in dev (import.meta.env.DEV), OFF in prod. A per-browser
// localStorage override (`beanies:flag:<name>` = 'true' | 'false') forces the
// flag for that one browser. The flag is read imperatively at call time (so it
// is testable via vi.stubEnv('DEV', …)) but consumed once at page setup — flip
// the override then RELOAD:
//   localStorage.setItem('beanies:flag:aiPhotoExtract', 'true'); location.reload();
// Clear it with clearFlagOverride('aiPhotoExtract') or removeItem on the same key.
//
// All localStorage access is wrapped: storage can throw in private-mode /
// hardened browsers. On failure we fall back to the env default and warn — never
// a silent failure, never a page crash.

/** The closed set of developer flags. Add a member to introduce a new flag. */
export type DevFlag = 'aiPhotoExtract' | 'aiTravelExtract';

const overrideKey = (flag: DevFlag): string => `beanies:flag:${flag}`;

/** Read a per-browser override. `true`/`false` force the flag; anything else → null (no override). */
function readOverride(flag: DevFlag): boolean | null {
  try {
    const v = localStorage.getItem(overrideKey(flag));
    if (v === 'true') return true;
    if (v === 'false') return false;
    return null; // unset or unrecognised → no override
  } catch (err) {
    console.warn(`[flags] could not read override for "${flag}"; using env default.`, err);
    return null;
  }
}

/** True when the dev flag is enabled (override if present, else dev-on / prod-off). */
export function isFlagEnabled(flag: DevFlag): boolean {
  const override = readOverride(flag);
  if (override !== null) return override;
  return import.meta.env.DEV; // dev-on, prod-off default
}

/** Force a flag on/off for this browser (persisted). Take effect on next page load. */
export function setFlagOverride(flag: DevFlag, value: boolean): void {
  try {
    localStorage.setItem(overrideKey(flag), String(value));
  } catch (err) {
    console.warn(`[flags] could not persist override for "${flag}".`, err);
  }
}

/** Remove a flag override so it reverts to the env default. */
export function clearFlagOverride(flag: DevFlag): void {
  try {
    localStorage.removeItem(overrideKey(flag));
  } catch (err) {
    console.warn(`[flags] could not clear override for "${flag}".`, err);
  }
}
