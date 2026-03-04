/**
 * File Sync — V4 beanpod file format operations.
 *
 * V4 uses a family key (AES-256-GCM) to encrypt the Automerge binary payload.
 * Each family member has their own password-derived wrapping key (AES-KW)
 * that can unwrap the family key. This replaces the V3 single-password model.
 */

import {
  encryptPayload,
  decryptPayload,
  deriveMemberKey,
  unwrapFamilyKey,
  SALT_LENGTH,
} from '@/services/crypto/familyKeyService';
import * as Automerge from '@automerge/automerge';
import { saveDoc } from '@/services/automerge/docService';
import { bufferToBase64, base64ToBuffer } from '@/utils/encoding';
import { generateUUID } from '@/utils/id';
import type {
  BeanpodFileV4,
  WrappedMemberKey,
  WrappedPasskeyKey,
  InviteKeyPackage,
} from '@/types/syncFileV4';
import type { FamilyDocument } from '@/types/automerge';

/**
 * Create a V4 beanpod file envelope from the current Automerge document.
 *
 * Serializes the doc to binary, encrypts with the family key,
 * and wraps the result in a V4 JSON envelope.
 */
export async function createBeanpodV4(
  familyId: string,
  familyName: string,
  familyKey: CryptoKey,
  wrappedKeys: Record<string, WrappedMemberKey>,
  passkeyWrappedKeys: Record<string, WrappedPasskeyKey> = {},
  inviteKeys: Record<string, InviteKeyPackage> = {}
): Promise<string> {
  const binary = saveDoc();
  const encrypted = await encryptPayload(familyKey, binary);

  const envelope: BeanpodFileV4 = {
    version: '4.0',
    familyId,
    familyName,
    keyId: generateUUID(),
    wrappedKeys,
    passkeyWrappedKeys,
    inviteKeys,
    encryptedPayload: bufferToBase64(encrypted),
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
 * Decrypt the encrypted payload from a V4 envelope using the family key.
 * Returns the loaded Automerge document.
 */
export async function decryptBeanpodPayload(
  envelope: BeanpodFileV4,
  familyKey: CryptoKey
): Promise<Automerge.Doc<FamilyDocument>> {
  const encrypted = new Uint8Array(base64ToBuffer(envelope.encryptedPayload));
  const binary = await decryptPayload(familyKey, encrypted);
  // Use Automerge.load() directly — NOT loadDoc() which has the side effect
  // of replacing the in-memory currentDoc singleton. Callers that need to
  // replace (replaceDoc) or merge (mergeDoc) do so explicitly after this returns.
  return Automerge.load<FamilyDocument>(binary);
}

/**
 * Try to unwrap the family key using a password.
 *
 * Iterates over all wrapped keys in the envelope and tries to derive
 * the member wrapping key from the password + salt. Returns the first
 * successful unwrap.
 *
 * @returns { familyKey, memberId } on success
 * @throws Error('Incorrect password') if no wrapped key matches
 */
export async function tryUnwrapFamilyKey(
  envelope: BeanpodFileV4,
  password: string
): Promise<{ familyKey: CryptoKey; memberId: string }> {
  const entries = Object.entries(envelope.wrappedKeys);

  if (entries.length === 0) {
    throw new Error('No wrapped keys in beanpod file — cannot unlock');
  }

  for (const [memberId, wrappedKey] of entries) {
    try {
      const salt = new Uint8Array(base64ToBuffer(wrappedKey.salt));
      if (salt.length !== SALT_LENGTH) continue;

      const memberKey = await deriveMemberKey(password, salt);
      const familyKey = await unwrapFamilyKey(wrappedKey.wrapped, memberKey);
      return { familyKey, memberId };
    } catch {
      // Wrong password for this member — try the next one
      continue;
    }
  }

  throw new Error('Incorrect password');
}

/**
 * Re-encrypt the current Automerge document and update the envelope's payload.
 * Returns the updated envelope as a JSON string.
 * Does NOT modify wrappedKeys/passkeyWrappedKeys/inviteKeys — caller handles those.
 */
export async function reEncryptEnvelope(
  envelope: BeanpodFileV4,
  familyKey: CryptoKey
): Promise<string> {
  const binary = saveDoc();
  const encrypted = await encryptPayload(familyKey, binary);

  const updated: BeanpodFileV4 = {
    ...envelope,
    encryptedPayload: bufferToBase64(encrypted),
  };

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
