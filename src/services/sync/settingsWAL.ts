/**
 * Settings Write-Ahead Log (WAL)
 *
 * Uses localStorage as a synchronous write-ahead log for per-family settings.
 * This ensures settings survive page refresh even when the async File System
 * Access API write hasn't completed (e.g. permission lost after unload).
 *
 * The WAL is cleared after every successful file save. On reload, if the WAL
 * entry is newer than the file, it is applied to IndexedDB before anything
 * else reads settings.
 */

import type { Settings } from '@/types/models';

const WAL_PREFIX = 'beanies_settings_wal_';
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface SettingsWALEntry {
  familyId: string;
  settings: Settings;
  timestamp: number; // Date.now()
}

/**
 * Synchronously persist the current settings to localStorage.
 * Called on every settings mutation so the latest state is always recoverable.
 */
export function writeSettingsWAL(familyId: string, settings: Settings): void {
  try {
    const entry: SettingsWALEntry = {
      familyId,
      settings,
      timestamp: Date.now(),
    };
    localStorage.setItem(WAL_PREFIX + familyId, JSON.stringify(entry));
  } catch {
    // localStorage full or unavailable — silently degrade
  }
}

/**
 * Read the WAL entry for the given familyId.
 * Returns null if missing, corrupt, or familyId mismatch.
 */
export function readSettingsWAL(familyId: string): SettingsWALEntry | null {
  try {
    const raw = localStorage.getItem(WAL_PREFIX + familyId);
    if (!raw) return null;

    const entry = JSON.parse(raw) as SettingsWALEntry;

    // Validate familyId match
    if (entry.familyId !== familyId) return null;

    // Validate shape
    if (!entry.settings || typeof entry.timestamp !== 'number') return null;

    return entry;
  } catch {
    return null;
  }
}

/**
 * Remove the WAL entry for a specific family.
 * Called after a successful file save.
 */
export function clearSettingsWAL(familyId: string): void {
  try {
    localStorage.removeItem(WAL_PREFIX + familyId);
  } catch {
    // silent
  }
}

/**
 * Remove all WAL entries (e.g. on full sign-out / clear data).
 */
export function clearAllSettingsWAL(): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(WAL_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  } catch {
    // silent
  }
}

/**
 * Check if a WAL entry is stale (older than maxAge).
 * Stale entries should not override file-sourced settings to avoid
 * overwriting changes made on another device.
 */
export function isWALStale(entry: SettingsWALEntry, maxAge: number = MAX_AGE_MS): boolean {
  return Date.now() - entry.timestamp > maxAge;
}
