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

import { clearCache, closeCacheDB } from '@/services/automerge/persistenceService';

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
 * Close any open database connections.
 */
export async function closeDatabase(): Promise<void> {
  closeCacheDB();
}

/**
 * Delete a family's databases (both legacy entity DB and Automerge cache).
 * Used on sign-out to treat local storage as an ephemeral cache.
 */
export async function deleteFamilyDatabase(familyId: string): Promise<void> {
  // Delete Automerge persistence cache
  await clearCache(familyId);

  // Delete legacy per-family IndexedDB (if it still exists from before migration)
  const legacyDbName = getFamilyDatabaseName(familyId);
  await deleteDB(legacyDbName);

  if (currentFamilyId === familyId) {
    currentFamilyId = null;
  }
}

/** Helper to delete an IndexedDB by name. */
async function deleteDB(dbName: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(dbName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      console.warn(`Database ${dbName} delete blocked — closing and retrying`);
      resolve();
    };
  });
}
