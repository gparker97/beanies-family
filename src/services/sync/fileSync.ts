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
import type { PodLineage } from '@/types/models';
import { UnsupportedBeanpodVersionError } from '@/types/sync';
import type { UIStringKey } from '@/services/translation/uiStrings';
import type {
  BeanpodFileV4,
  BeanpodVersion,
  WrappedMemberKey,
  WrappedPasskeyKey,
  InviteKeyPackage,
  RecoveryKeyPackage,
} from '@/types/syncFileV4';

/** A compacted document is a 5.0 file. Nothing else decides this. */
const COMPACTED_VERSION: BeanpodVersion = '5.0';
const LEGACY_VERSION: BeanpodVersion = '4.0';

/**
 * The versions this build can read. ONE reader: `parseBeanpodV4`. There is no
 * second version test anywhere in the app for this to drift from.
 */
const KNOWN_BEANPOD_VERSIONS: ReadonlySet<string> = new Set<BeanpodVersion>([
  LEGACY_VERSION,
  COMPACTED_VERSION,
]);

/**
 * The ONE derivation of an envelope's version, from the document it carries.
 *
 * ⚠️ DERIVED, NEVER CARRIED. Stamping the version on the envelope once at
 * compaction and letting the spread carry it lasts exactly one round trip: the
 * four `kept-local` termini adopt the REMOTE envelope (including its version,
 * `preserveLocalKeyDicts` spreads `...incoming`) and republish the LOCAL
 * compacted document under it, so the first self-repair after a compaction
 * would go out labelled 4.0 and a pre-guard build would merge it. The version
 * must describe the PAYLOAD, and the payload's lineage lives in the document:
 * the only writer of `podLineage` is `compactDoc`, so "has a lineage" is
 * exactly "is compacted".
 *
 * ⚠️ A POD COMPACTED BY THE RETIRED TIER-2 CODE DERIVES 4.0. That code kept the
 * lineage on the ENVELOPE, and the reader for it was deliberately removed
 * (ADR-036), so `docLineage` sees nothing and a history-less payload is written
 * as 4.0: the forbidden artefact. The population is one dev family, which has
 * been reset. If another turns up, compact it once on a current build; that
 * stamps the document and the derivation is right from then on.
 *
 * `compactionBackup` is the ONE deliberate exception, stated as an INTENT
 * rather than as a version: the pre-compaction safety pair carries an
 * un-compacted payload, so the derivation would say 4.0, and a build that
 * predates the lineage guard could then open it from a picker and fork the
 * family onto the backup. The writer still does not get to name a version, and
 * there is no ordering here to get wrong at the next bump.
 */
export function beanpodVersionFor(
  lineage: PodLineage | null,
  opts?: { compactionBackup?: true }
): BeanpodVersion {
  return lineage || opts?.compactionBackup ? COMPACTED_VERSION : LEGACY_VERSION;
}

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
  /** The lineage of the document `encryptedPayload` carries; decides `version`. */
  lineage: PodLineage | null,
  wrappedKeys: Record<string, WrappedMemberKey>,
  passkeyWrappedKeys: Record<string, WrappedPasskeyKey> = {},
  inviteKeys: Record<string, InviteKeyPackage> = {},
  /** Phase 4: a kit-born family's ONLY wrap at creation (wrappedKeys is `{}`). */
  recoveryKeys: Record<string, RecoveryKeyPackage> = {}
): string {
  // ADR-032: the worker produces `encryptedPayload` (via docClient.exportEncrypted
  // Payload); main assembles the envelope so wrappedKeys/inviteKeys never leave it.
  const envelope: BeanpodFileV4 = {
    version: beanpodVersionFor(lineage),
    familyId,
    familyName,
    keyId: generateUUID(),
    wrappedKeys,
    passkeyWrappedKeys,
    inviteKeys,
    ...(Object.keys(recoveryKeys).length > 0 ? { recoveryKeys } : {}),
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

  // A version this build does not know is a file from a NEWER beanies, or a
  // hand-edited one: a typed, non-latching, non-corruption error, thrown at the
  // one validator every reader funnels through so no caller has to classify it.
  // Only an ABSENT version means "not a beanpod at all".
  //
  // ⚠️ THE TYPE OF THE VALUE IS NOT THE QUESTION. This used to demand a string
  // before it would even consider the known set, so `"version": 6.0` typed by
  // hand — a JSON NUMBER — fell through to the generic "missing version" below:
  // worse copy, no `FILE_NEWER_VERSION` classification, and nothing in
  // CloudWatch. A number that is not a version we know is the same fact as a
  // string that is not. (`String(6.0)` is `'6'`, because a JSON `6.0` and a `6`
  // are the same value after parsing. That is unavoidable, and the constructor
  // clamps the result anyway.)
  if (obj.version === undefined || obj.version === null) {
    throw new Error(`Invalid beanpod: missing version`);
  }
  if (typeof obj.version !== 'string' || !KNOWN_BEANPOD_VERSIONS.has(obj.version)) {
    throw new UnsupportedBeanpodVersionError(String(obj.version));
  }

  if (typeof obj.familyId !== 'string') throw new Error('Invalid beanpod: missing familyId');
  if (typeof obj.familyName !== 'string') throw new Error('Invalid beanpod: missing familyName');
  if (typeof obj.keyId !== 'string') throw new Error('Invalid beanpod: missing keyId');
  // NON-EMPTY, not merely a string. A long-lived in-memory envelope carries a
  // blank payload by design (`withoutPayload`), so accepting '' here would let
  // a stripped envelope be written to a file and silently produce a zero-byte
  // decrypt much later — surfacing as "corruption", which then CLEARS the
  // user's cache. Fail at the boundary that owns the format instead.
  if (typeof obj.encryptedPayload !== 'string' || obj.encryptedPayload.length === 0)
    throw new Error('Invalid beanpod: missing encryptedPayload');
  if (!obj.wrappedKeys || typeof obj.wrappedKeys !== 'object')
    throw new Error('Invalid beanpod: missing wrappedKeys');

  return parsed as BeanpodFileV4;
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
/**
 * Phase 4: does this envelope have NO password-style wraps, only recovery material?
 * True for a kit-born family (created password-free — `wrappedKeys` empty from birth,
 * a recovery kit and/or passphrase is the only way in from cold). Callers that would
 * otherwise offer a password prompt (pending-file decrypt, LoadPodView bootstrap, the
 * resume-setup auto-load) MUST key on `!envelopeCapabilities(env).password` rather
 * than on this predicate — a password can never succeed against such an envelope, and
 * `tryUnwrapFamilyKey` would throw `UnlockFailedError('no-candidates')`. This predicate
 * is narrower: it is the "kit-born" LABEL, and it is FALSE for an envelope with no wraps
 * of any kind, which is exactly the case that used to fall through to a password form.
 */
export function envelopeNeedsRecovery(envelope: BeanpodFileV4): boolean {
  const c = envelopeCapabilities(envelope);
  return !c.password && (c.kit || c.passphrase);
}

/**
 * What a given envelope can ACTUALLY be opened with. Derived from the envelope only —
 * never from a cache, a default, or a guess.
 *
 * This is the single answer every credential-offer decision consults, so an offer that
 * cannot possibly succeed can never be rendered. Before this existed the answer was
 * cached on the roster entry as a `boolean | null` that defaulted to "offer it anyway",
 * which is how a kit-born family came to be shown "use password instead" against an
 * envelope with no password wrap at all.
 *
 * NOTE the asymmetry with `envelopeNeedsRecovery`: an envelope with NO wraps of any kind
 * reports every capability false and `envelopeNeedsRecovery` false. Offer sites must key
 * on `!caps.password`, NOT on `envelopeNeedsRecovery`, or that envelope falls through to
 * a password form. See `LoadPodView.handlePendingPassword`.
 */
export function envelopeCapabilities(envelope: BeanpodFileV4): EnvelopeCapabilities {
  return {
    password: Object.keys(envelope.wrappedKeys ?? {}).length > 0,
    passphrase: !!envelope.recoveryPassphrase,
    kit: Object.keys(envelope.recoveryKeys ?? {}).length > 0,
  };
}

export interface EnvelopeCapabilities {
  /** Legacy per-member password wraps exist (`wrappedKeys`). */
  password: boolean;
  /** The optional family recovery-passphrase wrap exists. */
  passphrase: boolean;
  /** At least one recovery-kit wrap exists. */
  kit: boolean;
}

/**
 * Why `tryUnwrapFamilyKey` could not produce a family key.
 *
 * ⚠️ MUST NOT implement `RemoteBlocker`, and MUST NOT carry `blockCode` or
 * `inlineMessageKey`. `isRemoteBlocker` (`types/sync.ts:282`) duck-types on exactly
 * those two field names, and `decryptPendingFile` (`syncStore.ts:2297`) tests it
 * BEFORE the credential check — an unlock failure carrying them would latch the
 * session breaker via `notePodUnopenable` and set `LoadPodView`'s
 * `podUnopenableHere`, so a single mistyped password would close the form for the
 * rest of the session. The message field is deliberately named `messageKey`.
 *
 * This is also why the class lives here and not beside `RemoteBlocker`: the next
 * reader who adds an error next to that interface will make it implement it.
 */
export class UnlockFailedError extends Error {
  readonly reason: 'no-candidates' | 'incorrect-secret';
  readonly messageKey: UIStringKey;

  constructor(reason: 'no-candidates' | 'incorrect-secret', messageKey: UIStringKey) {
    super(reason);
    this.name = 'UnlockFailedError';
    this.reason = reason;
    this.messageKey = messageKey;
  }
}

export async function tryUnwrapFamilyKey(
  envelope: BeanpodFileV4,
  password: string
): Promise<{ familyKey: CryptoKey; memberIds: string[]; viaRecoveryPassphrase?: boolean }> {
  const entries = Object.entries(envelope.wrappedKeys);

  if (entries.length === 0 && !envelope.recoveryPassphrase) {
    throw new UnlockFailedError('no-candidates', 'loginFlow.recoveryOnlyBody');
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

  throw new UnlockFailedError('incorrect-secret', 'password.decryptionError');
}

/**
 * Re-encrypt the current Automerge document and update the envelope's payload.
 * Returns the updated envelope as a JSON string.
 * Does NOT modify wrappedKeys/passkeyWrappedKeys/inviteKeys — caller handles those.
 */
export function reEncryptEnvelope(
  envelope: BeanpodFileV4,
  encryptedPayload: string,
  /**
   * REQUIRED, and a lineage rather than a version string: the writer cannot
   * pass the wrong version because it does not get to choose one. See
   * `beanpodVersionFor`.
   */
  lineage: PodLineage | null,
  opts?: { compactionBackup?: true }
): string {
  // ADR-032: `encryptedPayload` comes from docClient.exportEncryptedPayload().
  // Re-stamp writerVersion so the re-written file reflects the version that re-wrote
  // it (not a stale/absent one) — otherwise the #44 "no old writer remains" check is
  // misinformed by a key-rotation / member-change re-encrypt.
  const updated: BeanpodFileV4 = {
    ...envelope,
    version: beanpodVersionFor(lineage, opts),
    encryptedPayload,
    writerVersion: APP_VERSION,
  };
  return JSON.stringify(updated, null, 2);
}

// ── Utilities kept from V3 (file picker) ────────────────────────────

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
