import { getRegistryDatabase } from '@/services/indexeddb/registryDatabase';
import {
  setActiveFamily as setActiveFamilyDB,
  getActiveFamilyId,
} from '@/services/indexeddb/database';
import {
  getGlobalSettings,
  setLastActiveFamilyId,
} from '@/services/indexeddb/repositories/globalSettingsRepository';
import type { Family } from '@/types/models';
import { generateUUID } from '@/utils/id';
import { toISODateString } from '@/utils/date';

/**
 * Activate a family — sets the per-family database as current and updates lastActiveFamilyId.
 */
export async function activateFamily(familyId: string): Promise<Family | null> {
  const db = await getRegistryDatabase();
  const family = await db.get('families', familyId);

  if (!family) {
    return null;
  }

  await setActiveFamilyDB(familyId);
  await setLastActiveFamilyId(familyId);
  return family;
}

/**
 * Create a new family in the registry and activate it.
 */
export async function createNewFamily(name: string): Promise<Family> {
  const now = toISODateString(new Date());
  const family: Family = {
    id: generateUUID(),
    name,
    createdAt: now,
    updatedAt: now,
  };

  const db = await getRegistryDatabase();
  await db.add('families', family);

  // Activate the new family (this creates the per-family DB on first access)
  await setActiveFamilyDB(family.id);
  await setLastActiveFamilyId(family.id);

  return family;
}

/**
 * Get the last active family, or null if none.
 */
export async function getLastActiveFamily(): Promise<Family | null> {
  const globalSettings = await getGlobalSettings();
  if (!globalSettings.lastActiveFamilyId) {
    return null;
  }

  const db = await getRegistryDatabase();
  const family = await db.get('families', globalSettings.lastActiveFamilyId);
  return family ?? null;
}

/**
 * Create a family in the registry with a specific ID and activate it.
 * Used when the auth-resolved familyId is known but the family isn't in the registry yet
 * (e.g., first login on a new device).
 */
export async function createFamilyWithId(familyId: string, name: string): Promise<Family> {
  const now = toISODateString(new Date());
  const family: Family = {
    id: familyId,
    name,
    createdAt: now,
    updatedAt: now,
  };

  const db = await getRegistryDatabase();

  // Check if it already exists (avoid duplicate)
  const existing = await db.get('families', familyId);
  if (existing) {
    // Already exists — just activate it
    await setActiveFamilyDB(familyId);
    await setLastActiveFamilyId(familyId);
    return existing;
  }

  await db.add('families', family);
  await setActiveFamilyDB(familyId);
  await setLastActiveFamilyId(familyId);

  return family;
}

/**
 * Get all families registered on this device.
 */
export async function getAllFamilies(): Promise<Family[]> {
  const db = await getRegistryDatabase();
  return db.getAll('families');
}

/**
 * Get a family by ID from the registry.
 */
export async function getFamilyById(familyId: string): Promise<Family | null> {
  const db = await getRegistryDatabase();
  const family = await db.get('families', familyId);
  return family ?? null;
}

/**
 * Update a family's name.
 */
export async function updateFamilyName(familyId: string, name: string): Promise<Family | null> {
  const db = await getRegistryDatabase();
  const family = await db.get('families', familyId);

  if (!family) {
    return null;
  }

  const updated: Family = {
    ...family,
    name,
    updatedAt: toISODateString(new Date()),
  };

  await db.put('families', updated);
  return updated;
}

/**
 * Check if the current family context is active.
 */
export function hasActiveFamily(): boolean {
  return getActiveFamilyId() !== null;
}
