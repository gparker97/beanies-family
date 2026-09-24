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
  /**
   * The member who created the kit (tracker #99). ADDITIVE OPTIONAL: absent on every kit
   * created before 2026-09-24 and on the kit-born first kit, which is minted during pod
   * creation before a member exists. Attribution for the Manage Kits list, never a
   * permission check.
   */
  createdBy?: string;
}

export interface InviteKeyPackage {
  /** PBKDF2 salt (base64URL, 16 bytes — written by `bufferToBase64url`, NOT plain base64) */
  salt: string;
  /** AES-KW wrapped family key (base64) */
  wrapped: string;
  /**
   * ISO 8601 expiration. `INVITE_EXPIRY_MS` (24h) for invites, `LINK_EXPIRY_MS` (15min)
   * for device links, `MAGIC_LINK_EXPIRY_MS` (7d) for magic links — all in
   * `inviteService.ts`. (This said "24h from creation" while `DeviceLinkCard` was
   * already minting 15-minute packages.)
   */
  expiresAt: ISODateString;
}

/**
 * A member's saved sign-in link ("your beanies magic link"), Phase 5. `InviteKeyPackage`
 * plus the three fields a REVOCABLE, rotation-aware credential needs — extended rather
 * than restated so salt/wrapped/expiresAt have ONE definition, and so
 * `createInvitePackage`'s output is structurally most of this already.
 */
export interface MemberLinkKeyPackage extends InviteKeyPackage {
  /**
   * SHA-256 of the LIVE token (base64url, `hashInviteToken`).
   *
   * ⚠️ LOAD-BEARING FOR REVOCATION, not an optimisation. The dict is keyed by memberId,
   * so a link superseded by a newer mint leaves an entry that still EXISTS. Without this
   * hash the redeem gets as far as `unwrapFamilyKey` and fails there, and the holder is
   * shown a generic "something went wrong" instead of the honest "this link has been
   * cancelled". Comparing the hash FIRST is what makes revocation reportable.
   *
   * No new attack surface: `inviteKeys` already stores the same hash, in the clear, as
   * its dict KEY.
   */
  tokenHash: string;
  /**
   * Copy of `envelope.keyId` at mint. A mismatch means the family key was rotated, so
   * the wrap would unwrap SUCCESSFULLY (the token-derived KEK is unchanged) and hand
   * back a STALE key — a confusing decrypt failure instead of an honest "out of date".
   * Fail closed on mismatch; do NOT delete (a cold device cannot write the envelope and
   * a deletion would not propagate anyway).
   */
  keyId: string;
  /**
   * Merge arbitrator — newest wins. MONOTONIC at mint. REVOCATION DEPENDS ON THIS: the
   * dict merges `newest-wins`, and without a strictly-increasing stamp a peer holding
   * the pre-rotation entry wins and republishes the dead wrap.
   *
   * NOT the expiry clock. `expiresAt` comes from the real wall clock, so a `createdAt`
   * bumped forward to win a merge can never extend a link's life.
   */
  createdAt: ISODateString;
}

/**
 * The envelope version. `'4.0'` is every family until it compacts; `'5.0'` is a
 * COMPACTED family, and is chosen in exactly one place (`beanpodVersionFor` in
 * `fileSync.ts`) from the document's lineage. The point of 5.0 is that a build
 * which predates the lineage guard refuses to parse it, and so cannot merge
 * across lineages (ADR-036 addendum). The V4 in `BeanpodFileV4` names the KEY
 * MODEL, which does not change; a 5.0 file is a V4-format envelope carrying a
 * compacted payload.
 */
/**
 * A device-approval wrap (W4): the family key, wrapped to a cold device's ephemeral
 * public key by an already-signed-in device.
 *
 * ADDITIVE OPTIONAL on '4.0' — never a version bump, per the convention below.
 *
 * ⚠️ KEYED BY memberId, deliberately, and NOT by the public-key hash. Envelope dicts merge
 * by union and cannot express a deletion, so keying by something per-request would grow an
 * entry per attempt forever. memberId bounds it at one live request per member — which is
 * also the correct product constraint, since a person signs one new device in at a time —
 * and lets `newest-wins` arbitrate, exactly as `memberLinkKeys` does.
 *
 * ⚠️ NOT reused from `memberLinkKeys`, though that is the other revocable dict. It is keyed
 * by memberId under newest-wins too, so writing an approval there would silently REVOKE
 * that member's magic link — the very credential this work promotes.
 *
 * Contains no secret the requester does not already hold: `approverPublicKey` is public,
 * and `wrapped` can only be opened with a non-extractable private key that never left the
 * requesting device's memory.
 */
export interface DeviceApprovalPackage {
  /** HKDF salt (base64url), chosen by the approver. */
  salt: string;
  /** AES-KW wrapped family key (base64) — `wrapFamilyKey` returns base64, not base64url. */
  wrapped: string;
  /** The approver's ephemeral P-256 public key (base64url SPKI). */
  approverPublicKey: string;
  /** SHA-256 hex of the REQUESTER's public key — proves the entry is for this request. */
  publicKeyHash: string;
  /** Merge arbitrator — newest wins. Monotonic at write. */
  createdAt: ISODateString;
  /** Client-side policy only; the AES-KW wrap has no time binding. */
  expiresAt: ISODateString;
}

/**
 * One revocation in `BeanpodFileV4.revokedKeys` (tracker #77).
 *
 * Envelope dicts merge by union and cannot express a deletion, so a revoked wrap is
 * recorded here instead and filtered out of every merge (`applyRevokedKeys`). Three key
 * shapes, all built by `revocationKey` / `memberRevocationKey` in `envelopeMerge.ts`:
 *
 *  - `member:<memberId>` — every entry attributed to that member, in every dict that can
 *    attribute one, including entries the revoking device never saw. Removal only: a
 *    removed member's id never comes back.
 *  - `<dictField>:<entryKey>` — one slot, whatever it holds.
 *  - `<dictField>:<entryKey>:<wrapped>` — VALUE-PINNED: only the entry whose `wrapped`
 *    equals the pinned value. Unclaim uses this, because the same member id is re-wrapped
 *    when they re-claim, and a slot-wide tombstone would lock them out for good.
 */
export interface EnvelopeTombstone {
  revokedAt: ISODateString;
  /** Present on value-pinned tombstones only; mirrors the last key segment. */
  wrapped?: string;
  /**
   * The member who wrote the tombstone (tracker #99, recovery-kit invalidation). ADDITIVE
   * OPTIONAL and attribution only: the merge never reads it, and the earliest `revokedAt`
   * still wins the whole object on a key collision.
   */
  revokedBy?: string;
}

export type BeanpodVersion = '4.0' | '5.0';

/** Beanpod file format v4.0 (envelope), at either `BeanpodVersion`. */
export interface BeanpodFileV4 {
  version: BeanpodVersion;
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
   * kitId (a random id printed on the kit so a family can tell copies apart). An entry is
   * retired by a `recoveryKeys:<kitId>` slot tombstone in `revokedKeys` (tracker #99,
   * Settings → Manage Kits) — never by deletion, which would not propagate.
   */
  recoveryKeys?: Record<string, RecoveryKeyPackage>;
  /**
   * Per-member saved sign-in link wraps (ADDITIVE OPTIONAL, same rules as
   * `recoveryKeys`). Keyed by **memberId**, deliberately NOT by token hash: an overwrite
   * at the same key is the only shape revocation can take, because `envelopeMerge`
   * cannot propagate a deletion. Merged `newest-wins` — see `ENVELOPE_KEY_DICTS`.
   */
  memberLinkKeys?: Record<string, MemberLinkKeyPackage>;
  /** Device-approval wraps, keyed by memberId. Additive optional; see the type. */
  deviceApprovalKeys?: Record<string, DeviceApprovalPackage>;
  /**
   * Optional family recovery passphrase wrap (ADDITIVE OPTIONAL). Its own field, NEVER
   * a reserved `wrappedKeys` entry — legacy clients enumerate wrappedKeys as
   * (memberId, wrap) pairs and would surface a phantom member (Pass-4 finding).
   * `createdAt` arbitrates the envelope merge: newest wins, so a passphrase changed on
   * one device cannot be silently reverted by another device's stale in-memory copy.
   */
  recoveryPassphrase?: WrappedMemberKey & { createdAt?: ISODateString };
  /**
   * Revoked wraps (tracker #77). ADDITIVE OPTIONAL — old clients carry it through
   * untouched (parse returns the object as-is; every writer spreads the envelope) but do
   * not honour it. GROW-ONLY: merged as a union, never pruned, so a revocation can never
   * be un-done by a peer that has not seen it. See `EnvelopeTombstone` for the key shapes.
   */
  revokedKeys?: Record<string, EnvelopeTombstone>;

  // ⚠️ NO `podLineage` HERE, AND THERE MUST NEVER BE ONE AGAIN — see ADR-036
  // and `PodLineage` in `models.ts`. It lived here until 2026-09-06 and that is
  // why the guard did not work: `preserveLocalKeyDicts` spreads `...incoming`,
  // so every envelope replacement overwrote the local stamp with the remote's,
  // INCLUDING on the branch that exists because our lineage is newer. The
  // lineage is a property of the HISTORY, so it belongs to the document.
  // A value already present in an older file is carried through untouched by
  // `reEncryptEnvelope`'s spread and simply never read. ⚠️ A reader for it WAS
  // written (2026-09-06) and removed the same day: the local side has no sound
  // equivalent, so reading only the remote half answers `adopt-remote` even when
  // the truth is `same`, and the block's recovery then destroys real
  // same-lineage edits. See the long comment in
  // `applyAndProject.mergeRemoteEnvelope` before considering it again.

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
