/**
 * The device's last-known entitlement for one family (#95), in localStorage.
 *
 * WHY A CACHE AT ALL: the 14-day offline rule needs to know when the registry last
 * answered, and a family that opens the app offline must still see its plan. The registry
 * GET is the only source; this is just its most recent answer plus the time it arrived.
 *
 * WHY HERE AND NOT IN THE STORE: `familyContext.deleteLocalFamily` (a service) clears it
 * beside the roster cache, and a service must not import a store. The store owns every
 * decision about what a read means; this module only moves bytes and reports failures.
 *
 * Per family AND per device on purpose: a second device, a reinstall or cleared storage
 * starts with no cache and asks the registry, so none of them can extend a trial (the trial
 * end is server data).
 *
 * No `registryDatabase` version bump for one small JSON object: a bump carries the
 * blocked-upgrade hazard documented at `registryDatabase.ts`.
 */
import { ENTITLEMENT_REASONS, ENTITLEMENT_STATES, type Entitlement } from '@/types/models';
import {
  readStoredJson,
  removeStoredJson,
  writeStoredJson,
  type StoredJsonWrite,
} from '@/utils/storedJson';
import { logEvent } from '@/services/telemetry';

const LABEL = 'entitlement';

export interface CachedEntitlement {
  entitlement: Entitlement;
  /** Epoch ms, on THIS DEVICE'S clock, when it last received the entitlement from the registry. */
  fetchedAt: number;
  /**
   * `Date.parse(entitlement.serverTime) - fetchedAt`: how far the device clock was behind the
   * server's when the answer arrived. The offline rules read `Date.now() + clockOffsetMs`, so a
   * device clock set a day fast cannot end a trial a day early.
   */
  clockOffsetMs: number;
}

export type EntitlementCacheRead =
  { kind: 'ok'; value: CachedEntitlement } | { kind: 'missing' } | { kind: 'corrupt' };

export function entitlementCacheKey(familyId: string): string {
  return `beanies:entitlement:${familyId}`;
}

/**
 * Read the cached entitlement. Valid JSON of the wrong shape is `corrupt`, exactly like
 * unparseable JSON: a half-understood cache must never decide whether a family can write.
 * A corrupt record is REMOVED here, so "treated as no cache" is true on the next launch too and
 * the caller's warning fires once rather than on every open.
 */
export function readEntitlementCache(familyId: string): EntitlementCacheRead {
  const result = parseEntitlementCache(familyId);
  if (result.kind === 'corrupt') removeEntitlementCache(familyId);
  return result;
}

function parseEntitlementCache(familyId: string): EntitlementCacheRead {
  const read = readStoredJson(entitlementCacheKey(familyId), LABEL);
  if (read.kind !== 'ok') return read;
  const v = read.value as Partial<CachedEntitlement> | null;
  const e = v?.entitlement as Partial<Entitlement> | undefined;
  // `clockOffsetMs` may be ABSENT (a record written before it existed keeps its answer, offset
  // 0), but a present value that is not a finite number is garbage like any other field.
  const offset = v?.clockOffsetMs;
  if (
    !v ||
    typeof v.fetchedAt !== 'number' ||
    !Number.isFinite(v.fetchedAt) ||
    (offset !== undefined && (typeof offset !== 'number' || !Number.isFinite(offset))) ||
    !e ||
    !(ENTITLEMENT_STATES as readonly unknown[]).includes(e.state) ||
    !(ENTITLEMENT_REASONS as readonly unknown[]).includes(e.reason) ||
    typeof e.enforced !== 'boolean'
  ) {
    console.warn(`[${LABEL}] cached entitlement has an unexpected shape; ignoring it`);
    return { kind: 'corrupt' };
  }
  return {
    kind: 'ok',
    value: { ...(v as CachedEntitlement), clockOffsetMs: offset ?? 0 },
  };
}

export function writeEntitlementCache(familyId: string, value: CachedEntitlement): StoredJsonWrite {
  return writeStoredJson(entitlementCacheKey(familyId), value, LABEL);
}

/** Forget this device's copy for a family (family deleted from this device). Never throws. */
export function clearEntitlementCache(familyId: string): void {
  removeEntitlementCache(familyId);
}

/** Remove the record; a refused removal is harmless (the next answer overwrites it) but logged. */
function removeEntitlementCache(familyId: string): void {
  const removed = removeStoredJson(entitlementCacheKey(familyId), LABEL);
  if (removed.ok) return;
  logEvent({
    level: 'warn',
    surface: 'entitlement',
    message: 'entitlement cache removal failed',
    context: { action: 'cache_clear_failed' },
    error: removed.error,
  });
}
