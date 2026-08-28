/**
 * Repository for the device-local roster cache (registry DB, survives sign-out).
 *
 * One entry per family: the minimal member projection the pre-decrypt person picker
 * needs. Display data ONLY — never consulted for authorization, never synced, never
 * logged. See `RosterCacheEntry` in models.ts and the 2026-08-28 login-rethink plan.
 */

import type { RosterCacheEntry } from '@/types/models';
import { getRegistryDatabase } from '../registryDatabase';

export async function getRosterCache(familyId: string): Promise<RosterCacheEntry | undefined> {
  const db = await getRegistryDatabase();
  return db.get('rosterCache', familyId);
}

export async function saveRosterCache(entry: RosterCacheEntry): Promise<void> {
  const db = await getRegistryDatabase();
  await db.put('rosterCache', entry);
}

export async function deleteRosterCache(familyId: string): Promise<void> {
  const db = await getRegistryDatabase();
  await db.delete('rosterCache', familyId);
}

export async function clearAllRosterCache(): Promise<void> {
  const db = await getRegistryDatabase();
  await db.clear('rosterCache');
}
