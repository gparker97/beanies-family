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
  /** Member who owns this passkey (optional for backward compat with older envelopes) */
  memberId?: string;
}

/** A family key wrapped for an invite link (token-derived AES-KW, time-limited). */
/**
 * A recovery-kit wrap (login rethink Phase 3): the family key wrapped under a
 * full-entropy 256-bit kit token (PBKDF2 over the raw token — same derivation as
 * invites, offline-safe by entropy, not by iteration count). The kit token itself is
 * printed/saved by the family and NEVER persisted anywhere.
 */
export interface RecoveryKeyPackage {
  salt: string; // PBKDF2 salt (base64, 16 bytes)
  wrapped: string; // AES-KW wrapped family key (base64)
  createdAt: ISODateString;
}

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
  /**
   * Recovery-kit wraps (ADDITIVE OPTIONAL on '4.0' — never a version bump; old writers
   * preserve unknown fields via reEncryptEnvelope's spread and envelopeMerge). Keyed by
   * kitId (a random id printed on the kit so a family can tell copies apart). Old
   * entries persist until #117 key rotation retires them — same no-deletion-propagation
   * semantics as every other envelope dict.
   */
  recoveryKeys?: Record<string, RecoveryKeyPackage>;
  /**
   * Optional family recovery passphrase wrap (ADDITIVE OPTIONAL). Its own field, NEVER
   * a reserved `wrappedKeys` entry — legacy clients enumerate wrappedKeys as
   * (memberId, wrap) pairs and would surface a phantom member (Pass-4 finding).
   * `createdAt` arbitrates the envelope merge: newest wins, so a passphrase changed on
   * one device cannot be silently reverted by another device's stale in-memory copy.
   */
  recoveryPassphrase?: WrappedMemberKey & { createdAt?: ISODateString };

  // ⚠️ NO `podLineage` HERE, AND THERE MUST NEVER BE ONE AGAIN — see ADR-036
  // and `PodLineage` in `models.ts`. It lived here until 2026-09-06 and that is
  // why the guard did not work: `preserveLocalKeyDicts` spreads `...incoming`,
  // so every envelope replacement overwrote the local stamp with the remote's,
  // INCLUDING on the branch that exists because our lineage is newer. The
  // lineage is a property of the HISTORY, so it belongs to the document.
  // A value already present in an older file is carried through untouched by
  // `reEncryptEnvelope`'s spread and simply never read.

  /** base64( IV || AES-GCM(FK, automerge_binary) ) */
  encryptedPayload: string;

  /**
   * App version (`APP_VERSION`) of the client that last WROTE this file. Optional:
   * files written before 2026-07-13 lack it. Nothing gates on it yet — it exists so
   * #44 (retire the dual-publish base write) can later prove no whole-doc-only client
   * still writes. Stamped on every write path (createBeanpodV4 + reEncryptEnvelope).
   */
  writerVersion?: string;
}
