/**
 * File Sync — V4 beanpod file format operations.
 *
 * V4 uses a family key (AES-256-GCM) to encrypt the Automerge binary payload.
 * Each family member has their own password-derived wrapping key (AES-KW)
 * that can unwrap the family key. This replaces the V3 single-password model.
 */

import { deriveMemberKey, unwrapFamilyKey, SALT_LENGTH } from '@/services/crypto/familyKeyService';
import { base64ToBuffer } from '@/utils/encoding';
import { generateUUID } from '@/utils/id';
import { APP_VERSION } from '@/constants/appVersion';
import type {
  BeanpodFileV4,
  WrappedMemberKey,
  WrappedPasskeyKey,
  InviteKeyPackage,
} from '@/types/syncFileV4';

/**
 * Create a V4 beanpod file envelope from the current Automerge document.
 *
 * Serializes the doc to binary, encrypts with the family key,
 * and wraps the result in a V4 JSON envelope.
 */
export function createBeanpodV4(
  familyId: string,
  familyName: string,
  encryptedPayload: string,
  wrappedKeys: Record<string, WrappedMemberKey>,
  passkeyWrappedKeys: Record<string, WrappedPasskeyKey> = {},
  inviteKeys: Record<string, InviteKeyPackage> = {}
): string {
  // ADR-032: the worker produces `encryptedPayload` (via docClient.exportEncrypted
  // Payload); main assembles the envelope so wrappedKeys/inviteKeys never leave it.
  const envelope: BeanpodFileV4 = {
    version: '4.0',
    familyId,
    familyName,
    keyId: generateUUID(),
    wrappedKeys,
    passkeyWrappedKeys,
    inviteKeys,
    encryptedPayload,
    writerVersion: APP_VERSION, // #44: which app version wrote this file
  };

  return JSON.stringify(envelope, null, 2);
}

/**
 * Parse and validate a JSON string as a V4 beanpod envelope.
 * Throws if the format is invalid.
 */
export function parseBeanpodV4(jsonString: string): BeanpodFileV4 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    throw new Error('Invalid JSON in beanpod file');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid beanpod file: not an object');
  }

  const obj = parsed as Record<string, unknown>;

  if (obj.version !== '4.0') {
    throw new Error(`Unsupported beanpod version: ${obj.version}. Expected 4.0.`);
  }

  if (typeof obj.familyId !== 'string') throw new Error('Invalid beanpod: missing familyId');
  if (typeof obj.familyName !== 'string') throw new Error('Invalid beanpod: missing familyName');
  if (typeof obj.keyId !== 'string') throw new Error('Invalid beanpod: missing keyId');
  if (typeof obj.encryptedPayload !== 'string')
    throw new Error('Invalid beanpod: missing encryptedPayload');
  if (!obj.wrappedKeys || typeof obj.wrappedKeys !== 'object')
    throw new Error('Invalid beanpod: missing wrappedKeys');

  return parsed as BeanpodFileV4;
}

/**
 * Detect the file format version from a raw JSON string.
 * Returns '4.0' for V4, or null if unrecognised.
 */
export function detectFileVersion(jsonString: string): '4.0' | null {
  try {
    const parsed = JSON.parse(jsonString) as Record<string, unknown>;
    if (parsed.version === '4.0') return '4.0';
    return null;
  } catch {
    return null;
  }
}

/**
 * Try to unwrap a single wrappedKey entry with a password. Returns the family
 * key on success, or `null` on any failure (wrong password, malformed salt,
 * AES-KW unwrap error). Pure crypto — no I/O, no state mutation.
 *
 * Returning null is signal, not silence — every caller branches explicitly
 * on it. Used by `tryUnwrapFamilyKey` (iterates) and by the per-member
 * stale-wrappedKey check in `authStore.signIn`'s self-heal.
 */
export async function unwrapWrappedKey(
  wrappedKey: WrappedMemberKey,
  password: string
): Promise<CryptoKey | null> {
  try {
    const salt = new Uint8Array(base64ToBuffer(wrappedKey.salt));
    if (salt.length !== SALT_LENGTH) return null;
    const memberKey = await deriveMemberKey(password, salt);
    return await unwrapFamilyKey(wrappedKey.wrapped, memberKey);
  } catch {
    return null;
  }
}

/**
 * Try to unwrap the family key using a password.
 *
 * Iterates over EVERY wrappedKey in the envelope and collects all
 * memberIds whose wrappedKey successfully unwraps with this password.
 * Each member's wrappedKey carries its own salt, so two members who
 * happen to share the same password will both unwrap successfully —
 * we expose this as `memberIds: string[]` so the caller can detect
 * the collision and refuse to auto-sign-in as an arbitrary winner.
 *
 * The recovered familyKey is the same in every successful unwrap
 * (a family has exactly one family key, just wrapped multiple ways
 * for different members), so we return the first one we recover.
 *
 * Cost: O(N) PBKDF2 + AES-KW operations where N = number of members.
 * For a typical family this is <1s; we accept the cost over the
 * security risk of returning the first match without checking for
 * ambiguity.
 *
 * Phase 3 (2026-08-28 rethink): the optional family recovery PASSPHRASE is tried too
 * (same derivation, its own envelope field). A passphrase match identifies NO member —
 * `memberIds` comes back empty with `viaRecoveryPassphrase: true`, and the caller routes
 * to the person picker. Tried AFTER the member wraps so a member password can never be
 * shadowed by an identical passphrase.
 *
 * @returns { familyKey, memberIds } on success — memberIds may be EMPTY only when
 *   `viaRecoveryPassphrase` is true
 * @throws Error('Incorrect password') if nothing matches
 */
export async function tryUnwrapFamilyKey(
  envelope: BeanpodFileV4,
  password: string
): Promise<{ familyKey: CryptoKey; memberIds: string[]; viaRecoveryPassphrase?: boolean }> {
  const entries = Object.entries(envelope.wrappedKeys);

  if (entries.length === 0 && !envelope.recoveryPassphrase) {
    throw new Error('No wrapped keys in beanpod file — cannot unlock');
  }

  let familyKey: CryptoKey | null = null;
  const memberIds: string[] = [];

  for (const [memberId, wrappedKey] of entries) {
    const fk = await unwrapWrappedKey(wrappedKey, password);
    if (!fk) continue;
    familyKey ??= fk;
    memberIds.push(memberId);
  }

  if (familyKey && memberIds.length > 0) {
    return { familyKey, memberIds };
  }

  if (envelope.recoveryPassphrase) {
    const fk = await unwrapWrappedKey(envelope.recoveryPassphrase, password);
    if (fk) {
      return { familyKey: fk, memberIds: [], viaRecoveryPassphrase: true };
    }
  }

  throw new Error('Incorrect password');
}

/**
 * Re-encrypt the current Automerge document and update the envelope's payload.
 * Returns the updated envelope as a JSON string.
 * Does NOT modify wrappedKeys/passkeyWrappedKeys/inviteKeys — caller handles those.
 */
export function reEncryptEnvelope(envelope: BeanpodFileV4, encryptedPayload: string): string {
  // ADR-032: `encryptedPayload` comes from docClient.exportEncryptedPayload().
  // Re-stamp writerVersion so the re-written file reflects the version that re-wrote
  // it (not a stale/absent one) — otherwise the #44 "no old writer remains" check is
  // misinformed by a key-rotation / member-change re-encrypt.
  const updated: BeanpodFileV4 = { ...envelope, encryptedPayload, writerVersion: APP_VERSION };
  return JSON.stringify(updated, null, 2);
}

// ── Utilities kept from V3 (file picker, download) ──────────────────

/**
 * Opens a file picker for selecting a .beanpod file (fallback for mobile)
 */
export function openFilePicker(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '';
    input.onchange = () => {
      const file = input.files?.[0] ?? null;
      resolve(file);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/**
 * Downloads a beanpod envelope as a .beanpod file
 */
export function downloadAsFile(envelopeJson: string, filename?: string): void {
  const blob = new Blob([envelopeJson], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const date = new Date().toISOString().split('T')[0];
  const defaultFilename = `my-family-${date}.beanpod`;

  const a = document.createElement('a');
  a.href = url;
  a.download = filename ?? defaultFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
