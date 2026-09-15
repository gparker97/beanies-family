/**
 * Native biometric unlock via the hardware Keystore / Keychain (installed apps only).
 *
 * This is the NATIVE counterpart to `passkeyService.ts`'s WebAuthn-PRF path. It
 * releases a device-local, biometric-gated copy of the family AES key through the
 * custom `BiometricKeystore` Capacitor plugin (Android BiometricPrompt + KeyStore
 * CryptoObject; iOS LocalAuthentication + biometric-gated Keychain). The OS performs
 * the wrapping, so this path touches NONE of the WebAuthn-PRF crypto/envelope
 * machinery — no HKDF/AES-KW, no `passkeyWrappedKeys` synced envelope. The wrapped
 * blob is device-local and never synced. Decision + rationale: ADR-029 (2026-07-14).
 *
 * `passkeyService.ts` delegates to this module via an `isNative()` guard, so callers
 * (authStore/App.vue/ProveView/PasskeySettings) are unchanged and receive
 * the SAME result types. Web/PWA keeps WebAuthn-PRF untouched.
 *
 * Identity model: the OS biometric authenticates the DEVICE, not a member — it cannot
 * tell two enrolled faces apart. But the KEYSTORE ITEM is per member: the account is
 * `${familyId}:${memberId}`, so two members on one device can each enrol and each be
 * signed in as themselves. Pre-#76 enrolments live at the legacy bare-familyId address
 * and KEEP working there — each record carries `keystoreScheme` saying which address is
 * its own, so nothing has to be inferred and nothing is migrated. See ADR-029, amended.
 *
 * Because the prompt cannot distinguish members, a successful unlock proves only
 * "someone this device trusts"; the "not you?" escape on the prove screen is the
 * mitigation, not this module.
 *
 * THIS MODULE IS THE ONLY PLACE THAT BUILDS A KEYSTORE ACCOUNT STRING. Nothing else
 * may construct `${familyId}:${memberId}` or reference the legacy bare-familyId
 * address — that is what keeps a future migration from silently orphaning blobs.
 * Other modules reclaim storage through `nativeReclaimFamilyKeystore`.
 */

import { BiometricKeystore, type BiometricKeystoreErrorCode } from './biometricKeystorePlugin';
import * as passkeyRepo from '@/services/indexeddb/repositories/passkeyRepository';
import type { PasskeyRegistration } from '@/types/models';
import type { RegisterPasskeyParams, RegisterPasskeyResult } from './passkeyService';
// NOTE: RegisterPasskeyParams/Result + AuthenticatePasskeyParams/Result are imported
// TYPE-ONLY (erased at compile time) so this module and passkeyService.ts do not form
// a runtime import cycle. All shared runtime helpers live in the leaf `biometricShared`.
import type { AuthenticatePasskeyResult } from './passkeyService';
import { exportFamilyKey, importFamilyKey } from '@/services/crypto/familyKeyService';
import { bufferToBase64, base64ToBuffer } from '@/utils/encoding';
import { toISODateString } from '@/utils/date';
import { getPlatform } from '@/services/sync/capabilities';
import { reportError } from '@/utils/errorReporter';
import { logEvent } from '@/services/telemetry/logEvent';
import {
  isBiometricOfferSuppressed,
  suppressBiometricOffer,
  clearBiometricSuppression,
  describeAuthError,
  guessAuthenticatorLabel,
  MEMBER_MISMATCH,
  tr,
} from './biometricShared';

const SURFACE = 'native-biometric';

/** Synthetic credentialId for the device-local record (one per member per device). */
function nativeCredentialId(familyId: string, memberId: string): string {
  return `native:${familyId}:${memberId}`;
}

/**
 * The keystore item address for one member on this device. The ONLY place this string
 * is built — see the module header.
 */
function keystoreAccount(familyId: string, memberId: string): string {
  return `${familyId}:${memberId}`;
}

/**
 * The pre-#76 address: one biometric-gated blob per FAMILY. Still read (and deleted) for
 * records without `keystoreScheme`; nothing writes it any more.
 */
function legacyKeystoreAccount(familyId: string): string {
  return familyId;
}

/** Read the plugin error code, defaulting anything unrecognized to 'unknown'. */
function errorCode(err: unknown): BiometricKeystoreErrorCode {
  const code = (err as { code?: string } | undefined)?.code;
  if (
    code === 'userCancel' ||
    code === 'notEnrolled' ||
    code === 'lockout' ||
    code === 'invalidated' ||
    code === 'unknown'
  ) {
    return code;
  }
  return 'unknown';
}

/**
 * Is this a MISSING plugin rather than a device without biometric hardware?
 *
 * Capacitor rejects a call to an unregistered plugin with a recognisable message, and the two
 * cases must not be collapsed: a build that shipped without the native plugin looks exactly
 * like an old phone, so `no-hardware` was reported for months while the real cause was that
 * `BiometricKeystorePlugin.swift` had never been added to the Xcode target (#74). One is a
 * device fact and needs no action; the other is a broken build and needs a release.
 */
function isPluginMissing(err: unknown): boolean {
  const message = (err as { message?: string } | undefined)?.message ?? '';
  return /not implemented|unimplemented|not available|no such (?:plugin|module)/i.test(message);
}

/** Bounded diagnostic detail — never a raw object/PII. */
function detailOf(err: unknown): string {
  return describeAuthError(err).slice(0, 200);
}

// --- Removing key material: one target type, one delete, one purge ---

/** One thing to remove: the OS blob, and the registry record when there is one. */
interface KeystoreTarget {
  account: string;
  credentialId?: string;
}

/**
 * Delete ONE blob. Returns whether it is provably gone. NEVER silent.
 *
 * This replaces the two bare `catch {}` swallows that used to sit around `deleteKey`.
 * Both plugins resolve `deleteKey` for an account that has no item, so a `false` here
 * means the OS refused — not that there was nothing to do. Key material that will not
 * delete is now always visible in the firehose (#82).
 */
async function deleteBlob(account: string, action: string): Promise<boolean> {
  try {
    await BiometricKeystore.deleteKey({ account });
    return true;
  } catch (err) {
    logEvent({
      level: 'warn',
      surface: SURFACE,
      message: 'blob_delete_failed',
      context: { os: getPlatform(), action, error_code: errorCode(err), detail: detailOf(err) },
    });
    return false;
  }
}

/**
 * The pinned shape of a purge's `detail` field. One function, one test, one place to
 * change deliberately: a hand-written template literal at the emit site is a structure
 * encoded inside a free-text field, and reordering it silently empties every saved
 * CloudWatch query built on it.
 */
function formatPurgeDetail(targets: number, failed: number): string {
  return `targets=${targets},failed=${failed}`;
}

/**
 * Remove a set of targets: the blob always, the registry record when the target carries
 * a `credentialId`. THE one implementation of "make this key material go away" — disable,
 * the unlock self-heal and family reclaim all funnel through here, so none of them can
 * drift in ordering, level or wording.
 *
 * Emits exactly ONE summary event per call (warn if anything survived), which is why no
 * caller writes a log line for a purge. Returns how many blobs are provably gone.
 *
 * Per target the record is removed BEFORE the blob — the order `clearNativeRecord` has
 * always used — and a failure on one target is counted without aborting the rest. Because
 * the work is per target there is no "which half ran first" question to get wrong.
 */
async function purgeTargets(targets: KeystoreTarget[], action: string): Promise<number> {
  let deleted = 0;
  for (const t of targets) {
    if (t.credentialId) {
      try {
        await passkeyRepo.removePasskeyRegistration(t.credentialId);
      } catch (err) {
        // A record that will not delete means a self-heal that did not heal: the user
        // keeps being offered an enrolment that cannot work.
        logEvent({
          level: 'warn',
          surface: SURFACE,
          message: 'clear_record_failed',
          context: { os: getPlatform(), action: 'remove_registration', detail: detailOf(err) },
        });
      }
    }
    if (await deleteBlob(t.account, action)) deleted += 1;
  }
  const failed = targets.length - deleted;
  logEvent({
    level: failed > 0 ? 'warn' : 'info',
    surface: SURFACE,
    message: 'purge_result',
    context: {
      os: getPlatform(),
      action,
      count: deleted,
      detail: formatPurgeDetail(targets.length, failed),
    },
  });
  return deleted;
}

// --- Availability / gating ---

/**
 * Can the user enroll native biometric on this device? (hardware present + enrolled).
 * Deliberately does NOT consult the proactive-offer suppression — this is what the
 * deliberate Settings enroll surface (`canEnrollBiometric`) calls, so a prior
 * transient decline never locks Settings out. Mirrors the web `canEnrollBiometric`.
 */
export async function nativeCanEnroll(): Promise<boolean> {
  try {
    const { available } = await BiometricKeystore.isAvailable();
    return available;
  } catch (err) {
    // A plugin-bridge throw is not a user-facing failure — log and treat as "can't offer".
    // A MISSING plugin is reported at `error`, and as its own action, because it means this
    // build cannot do biometric at all: it is a release defect, not a device limitation, and
    // reporting it as `no-hardware` is what hid #74.
    const missing = isPluginMissing(err);
    logEvent({
      level: missing ? 'error' : 'warn',
      surface: SURFACE,
      message: missing ? 'native biometric plugin missing from this build' : 'availability',
      context: {
        os: getPlatform(),
        action: missing ? 'plugin-missing' : 'no-hardware',
        detail: detailOf(err),
      },
    });
    return false;
  }
}

/**
 * Whether to PROACTIVELY offer native biometric (App.vue's post-sign-in nag).
 * Same capability as `nativeCanEnroll()` but also respects the self-healing
 * per-device suppression. Mirrors the web `canOfferBiometric`.
 */
export async function nativeCanOffer(): Promise<boolean> {
  if (isBiometricOfferSuppressed()) return false;
  return nativeCanEnroll();
}

/**
 * Native semantics of `resolveDeviceKeys(familyId)`: WHICH members can this device sign
 * in? Registry-only (no biometric prompt) because it runs on every family selection and
 * every picker render. Supersedes the old `nativeHasRegistered` boolean, so the five
 * "is biometric available?" call sites cannot drift apart — there is now one answer.
 *
 * Also the single site that opportunistically drops any STALE WebAuthn-mechanism record
 * for this family (migration — no native WebAuthn credential ever succeeded), so a stale
 * record neither drives an unlock nor suppresses the fresh Keystore enrollment offer.
 */
export async function nativeResolveDeviceKeys(familyId: string): Promise<PasskeyRegistration[]> {
  let records: PasskeyRegistration[];
  try {
    records = await passkeyRepo.getPasskeysByFamily(familyId);
  } catch (err) {
    // A broken registry read must NOT look like "no key enrolled" — that ambiguity is
    // what hid #74. Callers still degrade to the password, but we can see why.
    logEvent({
      level: 'warn',
      surface: SURFACE,
      message: 'registry_read_failed',
      context: { os: getPlatform(), action: 'registry_read_failed', detail: detailOf(err) },
    });
    return [];
  }
  // Best-effort cleanup of stale non-native records (idempotent).
  for (const r of records) {
    if (r.mechanism !== 'native-keystore') {
      try {
        await passkeyRepo.removePasskeyRegistration(r.credentialId);
      } catch {
        /* best-effort */
      }
    }
  }
  return records.filter((r) => r.mechanism === 'native-keystore');
}

// --- Enable ---

/**
 * ENABLE native biometric for the current member/family. Exports the (extractable)
 * family key to raw bytes, wraps them behind a live biometric via the plugin, and —
 * only on success — persists a device-local `native-keystore` record for THIS member.
 * Returns the shared `RegisterPasskeyResult`; `passkeySecret` is undefined (device-local,
 * no envelope write), so App.vue's `if (result.passkeySecret)` guard skips the sync write.
 *
 * Since #76 this no longer purges the family's other native records: the credentialId is
 * deterministic, so `savePasskeyRegistration` already overwrites a re-enrol by the SAME
 * member, and siblings must survive so two members can share a device. It also does not
 * touch the legacy blob — a cross-member condition there could delete a live key. A
 * re-enrol writes `keystoreScheme: 'per-member'`, which is how a legacy record moves to
 * the new address; the old blob is reclaimed on family delete.
 *
 * User cancel is NOT a failure (no suppression, no report). A hard error suppresses
 * the proactive offer (cool-off) + reports a `warning` + friendly message; no record
 * is written unless the wrap succeeded (no half state).
 */
export async function nativeEnable(params: RegisterPasskeyParams): Promise<RegisterPasskeyResult> {
  const { memberId, memberName, familyId, familyKey, label } = params;
  const os = getPlatform();
  let raw: Uint8Array | null = null;
  try {
    raw = await exportFamilyKey(familyKey);
    const keyB64 = bufferToBase64(raw);
    const { keyBacking } = await BiometricKeystore.setKey({
      account: keystoreAccount(familyId, memberId),
      keyB64,
    });

    const registration: PasskeyRegistration = {
      credentialId: nativeCredentialId(familyId, memberId),
      memberId,
      familyId,
      publicKey: '',
      prfSupported: false,
      mechanism: 'native-keystore',
      label: label || guessAuthenticatorLabel(),
      memberName,
      keystoreScheme: 'per-member',
      createdAt: toISODateString(new Date()),
    };
    await passkeyRepo.savePasskeyRegistration(registration);
    clearBiometricSuppression();

    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'enable_result',
      context: { os, action: 'ok', key_backing: keyBacking },
    });
    return { success: true, prfSupported: false, passkeySecret: undefined };
  } catch (err) {
    const code = errorCode(err);
    if (code === 'userCancel') {
      // Deliberate gesture — not a failure. No suppression, no report.
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'enable_result',
        context: { os, action: 'user_cancel' },
      });
      return { success: false, cancelled: true, error: cancelMessage() };
    }
    suppressBiometricOffer();
    reportError({
      surface: SURFACE,
      message: 'native biometric enable failed',
      error: err,
      severity: 'warning',
      context: { os, action: 'enable', error_code: code, detail: detailOf(err) },
    });
    return { success: false, error: friendlyError(code) };
  } finally {
    // Zero the exported raw bytes; the transient base64 string is immutable and
    // stays in the narrowest scope above (covered by the rooted-device caveat).
    if (raw) raw.fill(0);
  }
}

// --- Unlock ---

/**
 * UNLOCK a SPECIFIC member's key and return the family key + that member. `memberId` is
 * required, not optional: every caller knows who it is asking for, and an optional
 * selector on a security primitive is an invitation to a null-member unlock.
 *
 * Resolution order:
 *  1. This member's record says which address its key lives at (`recordAccount`) — the
 *     per-member item since #76, the legacy family-keyed one for a pre-#76 record. That
 *     address is read AS-IS; nothing is inferred and nothing is moved.
 *  2. No record for this member → `MEMBER_MISMATCH`, no prompt.
 *  3. A record whose blob the OS has wiped → the `absent_self_heal` path.
 *
 * A legacy blob is NEVER re-homed at the per-member address. An earlier version of this
 * comment described exactly that ("prompt once, then silently re-home"); the body never
 * did it, and it must not — `recordAccount` below records why at length (on Android
 * `setKey` fires a SECOND BiometricPrompt, and a dismissal leaves the old blob behind, so
 * the double prompt returns on every sign-in). A legacy record moves to the new scheme
 * when that member re-enrols, and not before.
 *
 * A member with no record on this device gets `MEMBER_MISMATCH` with NO prompt, and
 * deliberately not the re-enrol copy, which would wrongly tell a healthy user their
 * biometrics had changed.
 */
export async function nativeUnlock(
  familyId: string,
  memberId: string
): Promise<AuthenticatePasskeyResult> {
  const os = getPlatform();
  const record = await loadNativeRecord(familyId, memberId);
  if (!record) {
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'unlock_result',
      context: { os, action: 'member_mismatch', member_id_tail: idTail(memberId) },
    });
    return { success: false, error: MEMBER_MISMATCH };
  }

  // The record says where its key lives, so there is nothing to infer.
  const readFrom = recordAccount(familyId, record);

  // Presence check — never prompts. Its ONLY job is to catch "the OS wiped this key"
  // (biometrics changed, passcode removed) so we can self-heal instead of firing a doomed
  // prompt. A THROW here must not be treated as absence: on Android a transient KeyStore
  // failure would otherwise delete a perfectly good enrolment, which is far more
  // destructive than the doomed prompt this check exists to avoid.
  try {
    const { present } = await BiometricKeystore.hasKey({ account: readFrom });
    if (!present) {
      await clearNativeRecord(familyId, memberId, 'absent_self_heal');
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'unlock_result',
        context: { os, action: 'absent_self_heal', detail: recordScheme(record) },
      });
      return { success: false, error: reEnrollMessage() };
    }
  } catch (err) {
    // Fall through to the real unlock, which handles errors properly — but say so, or a
    // flaky presence probe is invisible.
    logEvent({
      level: 'warn',
      surface: SURFACE,
      message: 'unlock_result',
      context: { os, action: 'haskey_failed', error_code: errorCode(err) },
    });
  }

  try {
    const { keyB64, keyBacking } = await BiometricKeystore.getKey({ account: readFrom });
    const familyKey = await importFamilyKey(new Uint8Array(base64ToBuffer(keyB64)));

    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'unlock_result',
      context: { os, action: 'ok', key_backing: keyBacking },
    });
    return { success: true, memberId: record.memberId, familyKey };
  } catch (err) {
    const code = errorCode(err);
    if (code === 'userCancel') {
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'unlock_result',
        context: { os, action: 'user_cancel' },
      });
      return { success: false, cancelled: true, error: cancelMessage() };
    }
    if (code === 'invalidated') {
      // A genuine OS invalidation is DEVICE-wide (a new fingerprint enrolled, the passcode
      // removed), so every native record for this family is equally dead — clearing only
      // one would leave siblings listed by `nativeResolveDeviceKeys` and rendered as dead
      // buttons on the chooser.
      await nativeReclaimFamilyKeystore(familyId);
    }
    // NOT `notEnrolled`: Android maps ERROR_HW_UNAVAILABLE onto it, which is transient
    // (sensor busy, temporarily unavailable). Wiping the whole family's enrolments because
    // a fingerprint reader was momentarily busy is a far worse outcome than one failed
    // unlock, and the no-prompt `hasKey` probe already self-heals genuinely absent keys on
    // the next attempt. So: show the re-enrol message, delete nothing.
    reportError({
      surface: SURFACE,
      message: 'native biometric unlock failed',
      error: err,
      severity: 'warning',
      context: { os, action: 'unlock', error_code: code, detail: detailOf(err) },
    });
    return {
      success: false,
      error:
        code === 'invalidated' || code === 'notEnrolled' ? reEnrollMessage() : friendlyError(code),
    };
  }
}

// --- Disable ---

/**
 * DISABLE one member's enrolment: delete their OS blob + device-local record. Idempotent.
 * Takes `(familyId, memberId)` rather than a credentialId because the credentialId is
 * DERIVED from that pair here — handing a caller a value this module already owns would
 * put the id format in two places.
 */
export async function nativeDisable(familyId: string, memberId: string): Promise<void> {
  await clearNativeRecord(familyId, memberId, 'disable');
}

/**
 * Reclaim ALL keystore storage for a family on this device — every member's blob plus
 * the legacy family-keyed one. The only route by which another module may reclaim
 * keystore storage, so no other file needs to know how an account is addressed.
 * Used by `deleteLocalFamily` and by the device-wide OS-invalidation path.
 */
export async function nativeReclaimFamilyKeystore(familyId: string): Promise<void> {
  const byAccount = new Map<string, KeystoreTarget>();
  for (const r of await listNativeRecords(familyId)) {
    const account = recordAccount(familyId, r);
    byAccount.set(account, { account, credentialId: nativeCredentialId(familyId, r.memberId) });
  }
  // The legacy blob is always a target, whether or not a record points at it. Added only
  // when absent: a legacy-SCHEME record already occupies this account key and carries the
  // credentialId, and overwriting it with a bare target would leave that record behind.
  const legacy = legacyKeystoreAccount(familyId);
  if (!byAccount.has(legacy)) byAccount.set(legacy, { account: legacy });

  await purgeTargets([...byAccount.values()], 'reclaim');
}

/**
 * The explicit clear-all primitive: remove EVERY blob for our service on this device,
 * including families this device will never open again. Sole permitted caller of
 * `BiometricKeystore.deleteAllKeys()`.
 *
 * `familyIds` is a defence-in-depth FALLBACK list, not the mechanism. The sweep itself
 * needs no registry and no enumeration. But a `@objc func` that exists and was never
 * added to `pluginMethods` rejects as not-implemented — that is #74, which this repo has
 * lived through twice — and in such a build the caller would delete the registry records,
 * tell the user their data was cleared, and leave every blob on the device with nothing
 * left that knows its address. Strictly worse than the per-family loop this replaced. So
 * on ANY rejection we report it and fall back to the union reclaim per family, which uses
 * only the long-shipped `deleteKey`. That makes the outcome >= today's on every build.
 *
 * Never throws: the caller is a sign-out step, and a thrown sweep would be caught one
 * level up and reported as a step failure with no statement of what survived.
 */
export async function nativeReclaimAllKeystores(familyIds: string[]): Promise<void> {
  try {
    const { deleted } = await BiometricKeystore.deleteAllKeys();
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'keystore_swept',
      context: { os: getPlatform(), action: 'sweep', detail: `deleted=${String(deleted)}` },
    });
    return;
  } catch (err) {
    reportError({
      surface: SURFACE,
      message: 'keystore sweep unavailable — falling back to per-family reclaim',
      error: err,
      severity: 'warning',
      context: {
        os: getPlatform(),
        action: 'sweep_failed',
        error_code: errorCode(err),
        count: familyIds.length,
        detail: detailOf(err),
      },
    });
  }
  for (const id of familyIds) {
    await nativeReclaimFamilyKeystore(id);
  }
}

// --- Internal helpers ---

/**
 * WHERE this record's key actually lives. Pre-#76 records have no `keystoreScheme` and
 * their key sits at the legacy family-wide address; everything since sits per member.
 *
 * We deliberately DO NOT migrate legacy blobs to the new address. It looks like free
 * housekeeping and is not: on Android `setKey` generates a fresh auth-bound key and fires
 * a SECOND BiometricPrompt (labelled "Enable biometric unlock") immediately after the one
 * the user just satisfied — and if they dismiss it, the old blob is never cleaned up, so
 * the double prompt returns on every single sign-in. Reading the legacy address forever
 * costs nothing, works on both platforms, and a legacy record moves to the new scheme
 * naturally the next time that member re-enrols.
 */
function recordAccount(familyId: string, record: PasskeyRegistration): string {
  return record.keystoreScheme === 'per-member'
    ? keystoreAccount(familyId, record.memberId)
    : legacyKeystoreAccount(familyId);
}

/** Non-identifying scheme label for telemetry. */
function recordScheme(record: PasskeyRegistration): string {
  return record.keystoreScheme === 'per-member' ? 'per_member' : 'legacy';
}

/** Last 8 chars of an id — the allowlisted, non-identifying form used in telemetry. */
function idTail(id: string): string {
  return id.slice(-8);
}

/**
 * Every native record for a family on this device. The single implementation of
 * "get the family's records and keep the native ones" — it had grown three copies.
 */
async function listNativeRecords(familyId: string): Promise<PasskeyRegistration[]> {
  return nativeResolveDeviceKeys(familyId);
}

/** One member's record, or null meaning exactly "that member has no key here". */
async function loadNativeRecord(
  familyId: string,
  memberId: string
): Promise<PasskeyRegistration | null> {
  const records = await listNativeRecords(familyId);
  return records.find((r) => r.memberId === memberId) ?? null;
}

/**
 * Drop one member's record and their OS blob.
 *
 * Deletes whichever address the record actually used — a legacy-scheme member's key is at
 * the family-wide address, and deleting only the per-member one would leave a live,
 * biometric-gated copy of the family key behind after the user explicitly removed it.
 *
 * The removal itself is `purgeTargets`, so disable and the unlock self-heal share one
 * implementation (and now emit a purge summary, which neither did before). `action` names
 * the calling path in that summary.
 */
async function clearNativeRecord(
  familyId: string,
  memberId: string,
  action: string
): Promise<void> {
  const record = await loadNativeRecord(familyId, memberId);
  const account = record ? recordAccount(familyId, record) : keystoreAccount(familyId, memberId);
  await purgeTargets([{ account, credentialId: nativeCredentialId(familyId, memberId) }], action);
}

// --- Friendly copy (via t() with English fallbacks) ---

function cancelMessage(): string {
  return tr('biometric.cancelled', 'Biometric was cancelled. You can sign in with your password.');
}

function reEnrollMessage(): string {
  return tr(
    'biometric.reEnroll',
    'Biometric unlock was turned off because your device biometrics changed. Sign in with your password, then turn it back on in Settings.'
  );
}

function friendlyError(code: BiometricKeystoreErrorCode): string {
  if (code === 'lockout') {
    return tr(
      'biometric.lockout',
      'Too many attempts. Please sign in with your password and try biometric again later.'
    );
  }
  if (code === 'notEnrolled') {
    return tr(
      'biometric.notEnrolled',
      "Set up your device's fingerprint or face unlock first, then you can enable biometric unlock."
    );
  }
  return tr(
    'biometric.errGeneric',
    'Something went wrong with biometric unlock. You can sign in with your password.'
  );
}
