/**
 * Repository for passkey registrations in the registry DB.
 * Passkeys are device-level and survive sign-out (not per-family DB).
 */

import type { PasskeyRegistration } from '@/types/models';
import { getRegistryDatabase } from '../registryDatabase';

export async function savePasskeyRegistration(reg: PasskeyRegistration): Promise<void> {
  const db = await getRegistryDatabase();
  await db.put('passkeys', reg);
}

export async function getPasskeyByCredentialId(
  credentialId: string
): Promise<PasskeyRegistration | undefined> {
  const db = await getRegistryDatabase();
  return db.get('passkeys', credentialId);
}

export async function getPasskeysByMember(memberId: string): Promise<PasskeyRegistration[]> {
  const db = await getRegistryDatabase();
  return db.getAllFromIndex('passkeys', 'by-memberId', memberId);
}

export async function getPasskeysByFamily(familyId: string): Promise<PasskeyRegistration[]> {
  const db = await getRegistryDatabase();
  return db.getAllFromIndex('passkeys', 'by-familyId', familyId);
}

export async function getAllPasskeys(): Promise<PasskeyRegistration[]> {
  const db = await getRegistryDatabase();
  return db.getAll('passkeys');
}

export async function updatePasskey(
  credentialId: string,
  updates: Partial<PasskeyRegistration>
): Promise<void> {
  const db = await getRegistryDatabase();
  const existing = await db.get('passkeys', credentialId);
  if (!existing) return;
  await db.put('passkeys', { ...existing, ...updates, credentialId });
}

export async function removePasskeyRegistration(credentialId: string): Promise<void> {
  const db = await getRegistryDatabase();
  await db.delete('passkeys', credentialId);
}

export async function removeAllPasskeysByMember(memberId: string): Promise<void> {
  const db = await getRegistryDatabase();
  const passkeys = await db.getAllFromIndex('passkeys', 'by-memberId', memberId);
  const tx = db.transaction('passkeys', 'readwrite');
  await Promise.all(passkeys.map((p) => tx.store.delete(p.credentialId)));
  await tx.done;
}
