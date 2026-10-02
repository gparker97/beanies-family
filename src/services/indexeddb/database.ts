/**
 * Database module — simplified for Automerge data layer.
 *
 * The per-family entity IndexedDB (FinanceDB) is no longer used for data storage.
 * Data lives in the Automerge document (in memory) and is persisted via the
 * persistence cache (beanies-automerge-{familyId}) and the .beanpod V4 file.
 *
 * This module retains:
 * - Active family tracking (used by familyContextStore and sync guards)
 * - Database name utilities
 * - deleteFamilyDatabase for sign-out cleanup
 * - deleteRetiredTranslationDatabase (one-time boot cleanup, temporary)
 */

import * as docClient from '@/services/automerge/worker/docClient';
import type { CacheClearResult } from '@/services/automerge/worker/protocol';
import { deletePhotoQueueDatabase } from '@/services/sync/photoUploadQueue';
import { logEvent } from '@/services/telemetry';

const DB_NAME_PREFIX = 'beanies-data-';
const AUTOMERGE_DB_PREFIX = 'beanies-automerge-';

let currentFamilyId: string | null = null;

/**
 * Set the active family ID.
 * Must be called before any data operations.
 */
export async function setActiveFamily(familyId: string): Promise<void> {
  currentFamilyId = familyId;
}

/**
 * Get the current active family ID.
 */
export function getActiveFamilyId(): string | null {
  return currentFamilyId;
}

/**
 * Get the family-scoped database name for a given family ID.
 * Used by migration code to reference old per-family DBs.
 */
export function getFamilyDatabaseName(familyId: string): string {
  return `${DB_NAME_PREFIX}${familyId}`;
}

/**
 * Get the Automerge cache database name for a given family ID.
 */
export function getAutomergeDatabaseName(familyId: string): string {
  return `${AUTOMERGE_DB_PREFIX}${familyId}`;
}

/**
 * Does this family's encrypted cache database exist in this browser right now?
 * `null` when the browser cannot say (`indexedDB.databases()` is missing or threw),
 * so a caller never mistakes "unknown" for "absent". Diagnostic use only (#100).
 */
export async function familyCacheExists(familyId: string): Promise<boolean | null> {
  if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return null;
  try {
    const name = getAutomergeDatabaseName(familyId);
    return (await indexedDB.databases()).some((d) => d.name === name);
  } catch (e) {
    console.warn('[database] indexedDB.databases() failed', e);
    return null;
  }
}

/**
 * Close any open database connections.
 */
export async function closeDatabase(): Promise<void> {
  // The worker owns the cache connection now; dropping the doc + projection is
  // the main-thread equivalent of closing (a following delete goes via
  // deleteFamilyDatabase → docClient.clearCache, which close-then-deletes).
  await docClient.reset();
}

/**
 * Delete a family's databases (both legacy entity DB and Automerge cache).
 * Used on sign-out to treat local storage as an ephemeral cache.
 *
 * Returns whether the encrypted Automerge cache is actually gone (#100), and
 * every caller acts on it: `false` means another tab or window still held it at
 * the deadline, so the person must not be told their data left the browser.
 */
export async function deleteFamilyDatabase(familyId: string): Promise<CacheClearResult> {
  // Delete the Automerge persistence cache via the worker (close-then-delete).
  // THIS tab's connection lives in the worker, but every OTHER open tab holds
  // its own; `docClient.clearCache` waits (bounded) for them to release it and
  // reports whether they did. It also logs the outcome, so it is not logged here.
  const cache = await docClient.clearCache(familyId);

  // Delete legacy per-family IndexedDB (if it still exists from before migration)
  const legacyDbName = getFamilyDatabaseName(familyId);
  await deleteDB(legacyDbName);

  // Delete any pending offline photo uploads for this family.
  await deletePhotoQueueDatabase(familyId);

  if (currentFamilyId === familyId) {
    currentFamilyId = null;
  }
  return cache;
}

/** The retired machine-translation cache (a separate idb database, not a store). */
const RETIRED_TRANSLATION_DB_NAME = 'beanies-translations';

/** localStorage done-marker: the retired database is gone on this device. */
const RETIRED_TRANSLATION_DB_CLEANED_KEY = 'beanies:retired-translation-db-cleaned';

function isRetiredTranslationDbCleaned(): boolean {
  try {
    return localStorage.getItem(RETIRED_TRANSLATION_DB_CLEANED_KEY) === '1';
  } catch (e) {
    console.warn('[database] retired translation cleanup marker unreadable, retrying delete:', e);
    return false;
  }
}

function markRetiredTranslationDbCleaned(): void {
  try {
    localStorage.setItem(RETIRED_TRANSLATION_DB_CLEANED_KEY, '1');
  } catch (e) {
    console.warn('[database] retired translation cleanup marker not saved:', e);
  }
}

/**
 * One-time, best-effort deletion of the orphaned `beanies-translations`
 * database, left on existing devices when the runtime machine-translation cache
 * was retired (plan 2026-10-02-claude-authored-zh-strings). Fired detached at
 * boot; never throws. A localStorage marker, set once the delete succeeds, makes
 * every later boot return before touching IndexedDB. Deleting a database that
 * does not exist succeeds, so there is no existence probe.
 *
 * Telemetry: one `deleted` info event per device (so CloudWatch shows when the
 * block below is safe to drop), `blocked` from `deleteDB`, `failed` on error.
 *
 * TEMPORARY: remove after 2026-12-01 (with its call in App.vue). By then every
 * active device has booted a build that ran it.
 */
export async function deleteRetiredTranslationDatabase(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  if (isRetiredTranslationDbCleaned()) return;
  try {
    if ((await deleteDB(RETIRED_TRANSLATION_DB_NAME)) !== 'deleted') return;
    markRetiredTranslationDbCleaned();
    logEvent({
      level: 'info',
      surface: 'idb-legacy-cleanup',
      message: 'retired translation database removed',
      context: { action: 'deleted' },
    });
  } catch (e) {
    console.warn('[database] retired translation database cleanup failed (non-fatal):', e);
    logEvent({
      level: 'warn',
      surface: 'idb-legacy-cleanup',
      message: 'retired translation database cleanup failed',
      context: { action: 'failed', error_code: e instanceof Error ? e.name : 'unknown' },
    });
  }
}

/**
 * Helper to delete an IndexedDB by name. Resolves `'deleted'` on success and
 * `'blocked'` when another connection blocks the delete (reported as an
 * `idb-delete` warn event); rejects on error.
 */
async function deleteDB(dbName: string): Promise<'deleted' | 'blocked'> {
  return new Promise<'deleted' | 'blocked'>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(dbName);
    request.onsuccess = () => resolve('deleted');
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      // ⚠️ DEFERRED, 2026-09-07 (plan A10). This is the same shape that caused
      // the cache-open lockout: resolving a BLOCKED delete leaves it queued,
      // and any later open of the same name waits behind it forever. Left
      // alone deliberately: these are the legacy entity DB, the retired
      // translation cache and the photo queue, the outcome is reported as
      // `blocked` rather than passed off as success, and nothing here re-opens
      // immediately afterwards, which is the pairing that hangs. If a re-open
      // is ever added below, fix this first.
      console.warn(`Database ${dbName} delete blocked — closing and retrying`);
      // The name is not an allowlisted context key, so it rides in the message.
      logEvent({
        level: 'warn',
        surface: 'idb-delete',
        message: `database ${dbName} delete blocked`,
        context: { action: 'blocked' },
      });
      resolve('blocked');
    };
  });
}
