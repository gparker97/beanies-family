// Developer feature flags — NOT env-derived (see features.ts for env gating).
// For features we want to build on `main` against PROD without exposing them to
// users until they're ready.
//
// Read model (override → dev → committed):
//   1. A per-browser localStorage override (`beanies:flag:<id>` = 'true'|'false')
//      forces the flag for that one browser — the dev's local preview lever.
//   2. Otherwise: ON in development (every flag is available while building on
//      main), and in PRODUCTION the committed state in featureFlags.committed.ts
//      (`true` = shipped to all prod users). The dev-only Feature Flags card in
//      Settings is the source of truth for that committed prod state.
//
// `import.meta.env.DEV` is read imperatively at call time (so it is testable via
// vi.stubEnv('DEV', …)); the committed map is a module-load import. Flag changes
// take effect on the next page load — flip then RELOAD.
//
// All localStorage access is wrapped: storage can throw in private-mode /
// hardened browsers. On failure we fall back to the default and warn — never a
// silent failure, never a page crash.

import { FLAG_REGISTRY, FLAG_IDS, isKnownFlag, type DevFlag } from './flagRegistry';
import { COMMITTED_FLAGS } from './featureFlags.committed';

export type { DevFlag };

// Load-time invariant (mirrors the navigation.ts config-validation style): a
// duplicate flag id is a hard bug → throw in dev/test so it's caught immediately.
// A committed key with no matching registry entry is a soft/stale leftover →
// warn and ignore (it simply never gates anything). The reverse — a registered
// flag missing from COMMITTED_FLAGS — is already a COMPILE error via the
// Record<DevFlag, boolean> type, so it needs no runtime check.
(function validateFlagConfig(): void {
  const seen = new Set<string>();
  for (const id of FLAG_IDS) {
    if (seen.has(id)) {
      throw new Error(
        `[flags] duplicate flag id "${id}" in FLAG_REGISTRY — flag ids must be unique.`
      );
    }
    seen.add(id);
  }
  for (const key of Object.keys(COMMITTED_FLAGS)) {
    if (!isKnownFlag(key)) {
      console.warn(
        `[flags] committed flag "${key}" is not in FLAG_REGISTRY — ignoring. ` +
          'Remove it from featureFlags.committed.ts (or add it to flagRegistry.ts).'
      );
    }
  }
})();

const overrideKey = (flag: DevFlag): string => `beanies:flag:${flag}`;

/** Read a per-browser override. `true`/`false` force the flag; anything else → null (no override). */
function readOverride(flag: DevFlag): boolean | null {
  try {
    const v = localStorage.getItem(overrideKey(flag));
    if (v === 'true') return true;
    if (v === 'false') return false;
    return null; // unset or unrecognised → no override
  } catch (err) {
    console.warn(`[flags] could not read override for "${flag}"; using default.`, err);
    return null;
  }
}

/**
 * True when the flag is enabled: a per-browser override wins; otherwise every
 * flag is on in development and only committed-true flags are on in production.
 */
export function isFlagEnabled(flag: DevFlag): boolean {
  const override = readOverride(flag);
  if (override !== null) return override;
  return import.meta.env.DEV ? true : COMMITTED_FLAGS[flag] === true;
}

/** A flag plus its committed PROD state — for the dev-only Feature Flags card. */
export interface FlagListEntry {
  id: DevFlag;
  label: string;
  description: string;
  /** The committed production state (what ships to prod), NOT the dev-effective value. */
  committed: boolean;
}

/** List every known flag with its committed prod state (registry order). Pure. */
export function listFlags(): FlagListEntry[] {
  return FLAG_REGISTRY.map((f) => ({
    id: f.id,
    label: f.label,
    description: f.description,
    committed: COMMITTED_FLAGS[f.id] === true,
  }));
}

/** Force a flag on/off for this browser (persisted). Takes effect on next page load. */
export function setFlagOverride(flag: DevFlag, value: boolean): void {
  try {
    localStorage.setItem(overrideKey(flag), String(value));
  } catch (err) {
    console.warn(`[flags] could not persist override for "${flag}".`, err);
  }
}

/** Remove a flag override so it reverts to the default. */
export function clearFlagOverride(flag: DevFlag): void {
  try {
    localStorage.removeItem(overrideKey(flag));
  } catch (err) {
    console.warn(`[flags] could not clear override for "${flag}".`, err);
  }
}
