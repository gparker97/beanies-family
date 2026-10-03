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
 * - the unsaved-work probes every destructive delete asks first (C6, 2026-10-03):
 *   the per-family `unpushed-at-signout` marker, the queued photo upload count, and
 *   the name sweep that finds a family's cache even when the registry forgot it
 * - deleteRetiredTranslationDatabase (one-time boot cleanup, temporary)
 */

import * as docClient from '@/services/automerge/worker/docClient';
import type { CacheClearResult } from '@/services/automerge/worker/protocol';
import { deletePhotoQueueDatabase } from '@/services/sync/photoUploadQueue';
import { logEvent } from '@/services/telemetry';

const DB_NAME_PREFIX = 'beanies-data-';
const AUTOMERGE_DB_PREFIX = 'beanies-automerge-';
/**
 * The offline photo queue's database prefix. MIRRORS `DB_PREFIX` in
 * `photoUploadQueue.ts` (which does not export it): the probes below must read a
 * family's queue WITHOUT binding that module to the family, because binding it
 * opens the database and starts a flush. Pinned by `database.unsaved.test.ts`.
 */
const PHOTO_QUEUE_DB_PREFIX = 'beanies-photo-queue-';
const PHOTO_QUEUE_STORE = 'uploads';
/** localStorage key prefix of the per-family "a session ended with unpushed work" marker. */
const UNPUSHED_MARKER_PREFIX = 'beanies:unpushed-at-signout:';

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
export async function deleteFamilyDatabase(
  familyId: string,
  opts: {
    /**
     * Keep the offline photo queue (C6). A keep-data sign-out passes it: a queued
     * upload is a photo that exists NOWHERE else yet, so only a delete the person
     * explicitly confirmed (clear data, forget family, delete family) may drop it.
     */
    keepPhotoQueue?: boolean;
  } = {}
): Promise<CacheClearResult> {
  // Delete the Automerge persistence cache via the worker (close-then-delete).
  // THIS tab's connection lives in the worker, but every OTHER open tab holds
  // its own; `docClient.clearCache` waits (bounded) for them to release it and
  // reports whether they did. It also logs the outcome, so it is not logged here.
  const cache = await docClient.clearCache(familyId);

  // Delete legacy per-family IndexedDB (if it still exists from before migration)
  const legacyDbName = getFamilyDatabaseName(familyId);
  await deleteDB(legacyDbName);

  // Delete any pending offline photo uploads for this family — unless the caller
  // is a keep-data sign-out (see `keepPhotoQueue`).
  if (!opts.keepPhotoQueue) await deletePhotoQueueDatabase(familyId);

  // The cache the marker warned about is gone, so the warning is spent.
  if (cache?.deleted === true) clearUnpushedAtSignOutMarker(familyId);

  if (currentFamilyId === familyId) {
    currentFamilyId = null;
  }
  return cache;
}

// ── Unsaved-work probes (C6) ────────────────────────────────────────────────

/**
 * Record that this family's last session on this device ended with work the
 * family file has not got, so its local database was KEPT. Read by "forget
 * family" on the picker, where there is no live document left to measure.
 * Never throws: a lost marker only weakens a warning, it never deletes anything.
 */
export function setUnpushedAtSignOutMarker(familyId: string): void {
  try {
    localStorage.setItem(UNPUSHED_MARKER_PREFIX + familyId, new Date().toISOString());
  } catch (e) {
    console.warn('[database] unpushed-at-signout marker not saved:', e);
  }
}

/** The work reached the family file (or the cache is gone): drop the marker. Never throws. */
export function clearUnpushedAtSignOutMarker(familyId: string): void {
  try {
    localStorage.removeItem(UNPUSHED_MARKER_PREFIX + familyId);
  } catch (e) {
    console.warn('[database] unpushed-at-signout marker not cleared:', e);
  }
}

/** Did this family's last session here end with unpushed work? Unreadable reads as `false`. */
export function hasUnpushedAtSignOutMarker(familyId: string): boolean {
  try {
    return localStorage.getItem(UNPUSHED_MARKER_PREFIX + familyId) !== null;
  } catch (e) {
    console.warn('[database] unpushed-at-signout marker unreadable:', e);
    return false;
  }
}

/**
 * How many photo uploads are queued for this family on this device: photos that
 * exist nowhere else yet. Opens the queue read-only and NEVER creates it (an
 * upgrade means it did not exist, so the open is aborted). `0` when the browser
 * has no IndexedDB; a failed read THROWS so the caller can treat "unknown" as
 * at-risk rather than as empty.
 */
export async function countQueuedPhotoUploads(familyId: string): Promise<number> {
  if (typeof indexedDB === 'undefined') return 0;
  return new Promise<number>((resolve, reject) => {
    const req = indexedDB.open(PHOTO_QUEUE_DB_PREFIX + familyId);
    let created = false;
    req.onupgradeneeded = () => {
      // No queue database existed: abort so the probe leaves nothing behind.
      created = true;
      req.transaction?.abort();
    };
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PHOTO_QUEUE_STORE)) {
        db.close();
        resolve(0);
        return;
      }
      try {
        const countReq = db
          .transaction(PHOTO_QUEUE_STORE, 'readonly')
          .objectStore(PHOTO_QUEUE_STORE)
          .count();
        countReq.onsuccess = () => {
          db.close();
          resolve(countReq.result);
        };
        countReq.onerror = () => {
          db.close();
          reject(countReq.error);
        };
      } catch (e) {
        db.close();
        reject(e);
      }
    };
    req.onerror = () => (created ? resolve(0) : reject(req.error));
    req.onblocked = () => reject(new Error('photo queue probe blocked'));
  });
}

/**
 * Every family id that has an encrypted cache or a photo queue in this browser,
 * found by database NAME rather than through the family registry, so a clean
 * device stays clean after the registry forgot a family (a reinstall, a failed
 * forget). `[]` when the browser cannot list databases.
 */
export async function listLocalFamilyDatabaseIds(): Promise<string[]> {
  if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return [];
  try {
    const ids = new Set<string>();
    for (const { name } of await indexedDB.databases()) {
      if (!name) continue;
      for (const prefix of [AUTOMERGE_DB_PREFIX, PHOTO_QUEUE_DB_PREFIX]) {
        if (name.startsWith(prefix) && name.length > prefix.length) {
          ids.add(name.slice(prefix.length));
        }
      }
    }
    return [...ids];
  } catch (e) {
    console.warn('[database] indexedDB.databases() failed during the family sweep', e);
    logEvent({
      level: 'warn',
      surface: 'family-context',
      message: 'local family database sweep failed',
      context: {
        action: 'family_db_sweep_failed',
        error_code: e instanceof Error ? e.name : 'unknown',
      },
    });
    return [];
  }
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
