/**
 * Why this device stopped saving locally, in the terms a person can act on (#100).
 *
 * The durability signal carries WHICH write failed (`kind`) and the error class
 * (`errorName`). Until #100 that stopped at telemetry, so the banner could only
 * hedge ("this often happens when beanies is open in more than one tab"). This
 * maps the detail to one of three causes, and the banner and the Settings
 * warning pick their copy from it.
 *
 * Pure and table-driven on purpose: the mapping is the whole decision, and it is
 * pinned by `__tests__/cacheFailureCause.test.ts`.
 */
import type { CachePersistFailureDetail } from '@/services/automerge/worker/protocol';

export type CacheFailureCause = 'other-tabs' | 'storage' | 'unknown';

/**
 * An `open` that failed because another context holds the database or is
 * deleting it. Each name is raised by exactly one site:
 *   - `CacheOpenTimeoutError`: `cache.initPersistenceDB`, an open queued behind
 *     another tab's pending delete
 *   - `DeleteBlocked`: `applyAndProject.reseedCacheAfterCorruption`, a re-seed
 *     whose delete another tab would not release
 *   - `CacheDeleteTimeoutError`: `cache.clearCache`'s bounded wait ran out
 */
const OTHER_TAB_OPEN_ERRORS: ReadonlySet<string> = new Set([
  'CacheOpenTimeoutError',
  'DeleteBlocked',
  'CacheDeleteTimeoutError',
]);

/** Storage refused the write: out of space, or a private window (Firefox throws
 * `InvalidStateError` on open there). */
const STORAGE_ERRORS: ReadonlySet<string> = new Set(['QuotaExceededError', 'InvalidStateError']);

export function cacheFailureCause(detail: CachePersistFailureDetail | null): CacheFailureCause {
  if (!detail) return 'unknown';
  if (detail.kind === 'open' && OTHER_TAB_OPEN_ERRORS.has(detail.errorName)) return 'other-tabs';
  // A write (base or increment) can only fail after a successful open, so the
  // database was reachable: the storage itself refused.
  if (detail.kind !== 'open' || STORAGE_ERRORS.has(detail.errorName)) return 'storage';
  return 'unknown';
}
