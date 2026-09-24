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
 */

import * as docClient from '@/services/automerge/worker/docClient';
import type { CacheClearResult } from '@/services/automerge/worker/protocol';
import { deletePhotoQueueDatabase } from '@/services/sync/photoUploadQueue';

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

/** Helper to delete an IndexedDB by name. */
async function deleteDB(dbName: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(dbName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      // ⚠️ DEFERRED, 2026-09-07 (plan A10). This is the same shape that caused
      // the cache-open lockout: resolving a BLOCKED delete as success leaves it
      // queued, and any later open of the same name waits behind it forever.
      // Left alone deliberately — these are the legacy entity DB and the photo
      // queue, this one at least warns rather than going silent, and nothing
      // here re-opens immediately afterwards, which is the pairing that hangs.
      // If a re-open is ever added below, fix this first.
      console.warn(`Database ${dbName} delete blocked — closing and retrying`);
      resolve();
    };
  });
}
