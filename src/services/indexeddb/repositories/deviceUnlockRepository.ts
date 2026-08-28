/**
 * Repository for PIN device-unlock wraps + the per-device secret (registry DB).
 *
 * DUMB CRUD ONLY. All crypto, all lockout accounting, and every `failCount` write live
 * in `src/services/auth/deviceUnlock.ts` — the single-writer rule the plan binds. FK
 * material: cleared on untrusted sign-out, sign-out-and-clear, and deleteLocalFamily.
 */

import type { DeviceUnlockRecord, DeviceSecretRecord } from '@/types/models';
import { getRegistryDatabase } from '../registryDatabase';

export function deviceUnlockId(familyId: string, memberId: string): string {
  return `${familyId}:${memberId}`;
}

export async function getDeviceUnlock(
  familyId: string,
  memberId: string
): Promise<DeviceUnlockRecord | undefined> {
  const db = await getRegistryDatabase();
  return db.get('deviceUnlock', deviceUnlockId(familyId, memberId));
}

export async function listDeviceUnlocksForFamily(familyId: string): Promise<DeviceUnlockRecord[]> {
  const db = await getRegistryDatabase();
  return db.getAllFromIndex('deviceUnlock', 'by-familyId', familyId);
}

export async function saveDeviceUnlock(record: DeviceUnlockRecord): Promise<void> {
  const db = await getRegistryDatabase();
  await db.put('deviceUnlock', record);
}

export async function deleteDeviceUnlock(familyId: string, memberId: string): Promise<void> {
  const db = await getRegistryDatabase();
  await db.delete('deviceUnlock', deviceUnlockId(familyId, memberId));
}

export async function deleteDeviceUnlocksForFamily(familyId: string): Promise<void> {
  const db = await getRegistryDatabase();
  const records = await db.getAllFromIndex('deviceUnlock', 'by-familyId', familyId);
  const tx = db.transaction('deviceUnlock', 'readwrite');
  for (const r of records) await tx.store.delete(r.id);
  await tx.done;
}

export async function clearAllDeviceUnlocks(): Promise<void> {
  const db = await getRegistryDatabase();
  await db.clear('deviceUnlock');
}

export async function getDeviceSecret(): Promise<DeviceSecretRecord | undefined> {
  const db = await getRegistryDatabase();
  return db.get('deviceSecrets', 'device_secret');
}

export async function saveDeviceSecret(record: DeviceSecretRecord): Promise<void> {
  const db = await getRegistryDatabase();
  await db.put('deviceSecrets', record);
}
