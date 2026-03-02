/**
 * Beanpod file format v4.0 — family-key encryption with per-member wrapping.
 *
 * Replaces the v3.0 single-password model with:
 * - A random 256-bit AES-GCM family key (FK)
 * - Per-member wrapped copies (password-derived AES-KW)
 * - Per-passkey wrapped copies (PRF/HKDF-derived AES-KW)
 * - Invite-link wrapped copies (token-derived AES-KW, 24h expiry)
 * - AES-GCM encrypted Automerge binary payload
 */

import type { UUID, ISODateString } from './models';

/** A family key wrapped with a member's password-derived AES-KW key. */
export interface WrappedMemberKey {
  /** PBKDF2 salt (base64, 16 bytes) */
  salt: string;
  /** AES-KW wrapped family key (base64) */
  wrapped: string;
}

/** A family key wrapped with a passkey's PRF-derived AES-KW key. */
export interface WrappedPasskeyKey {
  /** AES-KW wrapped family key (base64) */
  wrapped: string;
  /** HKDF salt used to derive the wrapping key (base64, 32 bytes) */
  hkdfSalt: string;
}

/** A family key wrapped for an invite link (token-derived AES-KW, time-limited). */
export interface InviteKeyPackage {
  /** PBKDF2 salt (base64, 16 bytes) */
  salt: string;
  /** AES-KW wrapped family key (base64) */
  wrapped: string;
  /** ISO 8601 expiration timestamp (24h from creation) */
  expiresAt: ISODateString;
}

/** Beanpod file format v4.0 */
export interface BeanpodFileV4 {
  version: '4.0';
  familyId: UUID;
  familyName: string;

  /** Key rotation identifier — changes when the family key is rotated. */
  keyId: string;

  /** Per-member wrapped family keys. Key = memberId. */
  wrappedKeys: Record<string, WrappedMemberKey>;

  /** Per-passkey wrapped family keys. Key = credentialId (base64url). */
  passkeyWrappedKeys: Record<string, WrappedPasskeyKey>;

  /** Active invite packages. Key = SHA-256 hash of invite token (base64url). */
  inviteKeys: Record<string, InviteKeyPackage>;

  /** base64( IV || AES-GCM(FK, automerge_binary) ) */
  encryptedPayload: string;
}
