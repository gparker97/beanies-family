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
/** See `BeanpodFileV4.podLineage`. */
export interface PodLineage {
  /** Minted per compaction. The identity — two lineages are the same iff equal. */
  id: string;
  /** Monotonic, and ONLY for direction. Never an identity on its own. */
  seq: number;
}

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

  /**
   * Which LINEAGE this document belongs to (ADDITIVE OPTIONAL on '4.0', the same
   * contract as `recoveryKeys` — never a version bump). Absent means "legacy,
   * never compacted", which is every pod in existence today.
   *
   * ⚠️ The invariant this exists to enforce: a document may only be CRDT-MERGED
   * with a document of the same lineage. `Automerge.from(toJS(doc))` — the only
   * way to drop history in Automerge 3.x — mints brand-new object ids, so the
   * compacted document shares no ancestry with the original and a merge is a
   * map-level conflict rather than a reconciliation. Measured: merging a
   * compacted pod into a peer still on the old history destroyed that peer's
   * unsynced changes 200 times out of 200.
   *
   * `id` is minted per compaction and is the IDENTITY: a bare counter gives
   * direction but cannot tell two concurrent compactions apart, and two devices
   * that both produced generation 1 would read as equal and merge — the exact
   * failure this field exists to prevent. `seq` exists ONLY to give direction.
   */
  podLineage?: PodLineage;

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
