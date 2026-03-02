/**
 * Invite Service — token-based family key sharing for new members.
 *
 * Flow:
 * 1. Owner generates an invite token (32 random bytes → base64url).
 * 2. Token is used to derive an AES-KW key (PBKDF2 with raw token bytes).
 * 3. The family key is wrapped with that key and stored in the .beanpod file
 *    keyed by SHA-256(token) so the raw token is never persisted.
 * 4. New member opens the invite link, enters the token, unwraps the FK,
 *    then re-wraps it with their own password.
 * 5. Invite packages expire after 24 hours.
 */

import { bufferToBase64url, base64urlToBuffer } from '@/utils/encoding';
import { SALT_LENGTH, wrapFamilyKey, unwrapFamilyKey } from '@/services/crypto/familyKeyService';

const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH = 256;
const WRAPPING_ALGO = 'AES-KW';
const INVITE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Token generation ────────────────────────────────────────────────

/** Generate a cryptographically random invite token (base64url, 43 chars). */
export function generateInviteToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bufferToBase64url(bytes);
}

// ── Key derivation ──────────────────────────────────────────────────

/**
 * Derive an AES-KW wrapping key from an invite token.
 * Uses raw token bytes (full 256-bit entropy) as PBKDF2 input.
 */
export async function deriveInviteKey(token: string, salt: Uint8Array): Promise<CryptoKey> {
  const tokenBytes = base64urlToBuffer(token);

  const keyMaterial = await crypto.subtle.importKey('raw', tokenBytes, 'PBKDF2', false, [
    'deriveBits',
    'deriveKey',
  ]);

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: WRAPPING_ALGO, length: KEY_LENGTH },
    false,
    ['wrapKey', 'unwrapKey']
  );
}

// ── Invite package creation / redemption ────────────────────────────

export interface InvitePackage {
  salt: string; // base64url
  wrapped: string; // base64 (AES-KW wrapped FK)
  expiresAt: string; // ISO 8601
}

/**
 * Wrap the family key for an invite link.
 * Returns the package to store in the .beanpod file.
 */
export async function createInvitePackage(
  familyKey: CryptoKey,
  token: string
): Promise<InvitePackage> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const wrappingKey = await deriveInviteKey(token, salt);
  const wrapped = await wrapFamilyKey(familyKey, wrappingKey);
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_MS).toISOString();

  return {
    salt: bufferToBase64url(salt),
    wrapped,
    expiresAt,
  };
}

/**
 * Redeem an invite token to recover the family key.
 * Returns an extractable CryptoKey.
 */
export async function redeemInviteToken(
  wrapped: string,
  salt: string,
  token: string
): Promise<CryptoKey> {
  const saltBytes = new Uint8Array(base64urlToBuffer(salt));
  const unwrappingKey = await deriveInviteKey(token, saltBytes);
  return unwrapFamilyKey(wrapped, unwrappingKey);
}

// ── Token hashing (storage key) ─────────────────────────────────────

/** Hash an invite token with SHA-256. Returns base64url (storage key). */
export async function hashInviteToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return bufferToBase64url(hash);
}

// ── Link building ───────────────────────────────────────────────────

/** Build a full invite URL for the app. */
export function buildInviteLink(token: string, familyId: string): string {
  return `${globalThis.location?.origin ?? 'https://beanies.family'}/#/join?t=${encodeURIComponent(token)}&f=${encodeURIComponent(familyId)}`;
}

// ── Expiry check ────────────────────────────────────────────────────

/** Check whether an invite package has expired. */
export function isInviteExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() <= Date.now();
}
