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
 * (authStore/App.vue/BiometricLoginView/PasskeySettings) are unchanged and receive
 * the SAME result types. Web/PWA keeps WebAuthn-PRF untouched.
 *
 * Identity model: the OS biometric authenticates the DEVICE, not a member. So there
 * is exactly ONE `native-keystore` record per family per device (keyed by familyId),
 * identifying the enrolling member; enable is last-writer-wins. On a shared device,
 * other members use password. See ADR-029.
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
  tr,
} from './biometricShared';

const SURFACE = 'native-biometric';

/** Synthetic credentialId for the device-local record (one per family per device). */
function nativeCredentialId(familyId: string, memberId: string): string {
  return `native:${familyId}:${memberId}`;
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
 * Native semantics of `hasRegisteredPasskeys(familyId)`: is native biometric enabled
 * for this family on this device? Registry-only (no biometric prompt) because it runs
 * on every family selection. Also the single site that opportunistically drops any
 * STALE WebAuthn-mechanism record for this family (migration — no native WebAuthn
 * credential ever succeeded), so a stale record neither drives an unlock nor
 * suppresses the fresh Keystore enrollment offer. See Req 13.
 */
export async function nativeHasRegistered(familyId: string): Promise<boolean> {
  let records: PasskeyRegistration[];
  try {
    records = await passkeyRepo.getPasskeysByFamily(familyId);
  } catch {
    return false;
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
  return records.some((r) => r.mechanism === 'native-keystore');
}

// --- Enable ---

/**
 * ENABLE native biometric for the current member/family. Exports the (extractable)
 * family key to raw bytes, wraps them behind a live biometric via the plugin, and —
 * only on success — persists exactly one device-local `native-keystore` record
 * (replacing any prior native record + implicitly the prior blob). Returns the shared
 * `RegisterPasskeyResult`; `passkeySecret` is undefined (device-local, no envelope
 * write), so App.vue's `if (result.passkeySecret)` guard skips the sync write.
 *
 * User cancel is NOT a failure (no suppression, no report). A hard error suppresses
 * the proactive offer (cool-off) + reports a `warning` + friendly message; no record
 * is written unless the wrap succeeded (no half state).
 */
export async function nativeEnable(params: RegisterPasskeyParams): Promise<RegisterPasskeyResult> {
  const { memberId, familyId, familyKey, label } = params;
  const os = getPlatform();
  let raw: Uint8Array | null = null;
  try {
    raw = await exportFamilyKey(familyKey);
    const keyB64 = bufferToBase64(raw);
    const { keyBacking } = await BiometricKeystore.setKey({ account: familyId, keyB64 });

    // Enforce one native record per family (last-writer-wins) before persisting.
    await removeNativeRecordsForFamily(familyId);
    const registration: PasskeyRegistration = {
      credentialId: nativeCredentialId(familyId, memberId),
      memberId,
      familyId,
      publicKey: '',
      prfSupported: false,
      mechanism: 'native-keystore',
      label: label || guessAuthenticatorLabel(),
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
 * UNLOCK: prompt biometric and return the family key + enrolling member. Loads the
 * device-local record first (for the memberId), then a no-prompt `hasKey` presence
 * check self-heals the "OS key wiped" case (biometrics changed, key cleared) without
 * a doomed prompt. On cancel → clean password fallback (no toast). On invalidated/
 * not-enrolled → clear the stale record + friendly re-enroll. On lockout/unknown →
 * friendly message (record kept — lockout is transient).
 */
export async function nativeUnlock(familyId: string): Promise<AuthenticatePasskeyResult> {
  const os = getPlatform();
  const record = await loadNativeRecord(familyId);
  if (!record) {
    // Unlock shouldn't have been offered without a record.
    return { success: false, error: friendlyError('invalidated') };
  }

  // Self-heal: if the OS key is gone, clear the stale record + re-enroll — no prompt.
  try {
    const { present } = await BiometricKeystore.hasKey({ account: familyId });
    if (!present) {
      await clearNativeRecord(familyId);
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'unlock_result',
        context: { os, action: 'absent_self_heal' },
      });
      return { success: false, error: reEnrollMessage() };
    }
  } catch {
    // hasKey is best-effort — fall through to the real unlock, which handles errors.
  }

  try {
    const { keyB64, keyBacking } = await BiometricKeystore.getKey({ account: familyId });
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
    if (code === 'invalidated' || code === 'notEnrolled') {
      await clearNativeRecord(familyId);
    }
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

/** DISABLE: delete the OS blob + the device-local record. Idempotent. */
export async function nativeDisable(familyId: string, credentialId: string): Promise<void> {
  try {
    await BiometricKeystore.deleteKey({ account: familyId });
  } catch {
    // A missing key is not an error.
  }
  await passkeyRepo.removePasskeyRegistration(credentialId);
}

// --- Internal helpers ---

async function loadNativeRecord(familyId: string): Promise<PasskeyRegistration | null> {
  try {
    const records = (await passkeyRepo.getPasskeysByFamily(familyId)).filter(
      (r) => r.mechanism === 'native-keystore'
    );
    if (records.length === 0) return null;
    // By the one-record invariant there is exactly one; if somehow more, pick newest.
    return records.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]!;
  } catch {
    return null;
  }
}

async function removeNativeRecordsForFamily(familyId: string): Promise<void> {
  try {
    const records = (await passkeyRepo.getPasskeysByFamily(familyId)).filter(
      (r) => r.mechanism === 'native-keystore'
    );
    for (const r of records) await passkeyRepo.removePasskeyRegistration(r.credentialId);
  } catch {
    /* best-effort — savePasskeyRegistration overwrites the same-keyed record anyway */
  }
}

async function clearNativeRecord(familyId: string): Promise<void> {
  await removeNativeRecordsForFamily(familyId);
  try {
    await BiometricKeystore.deleteKey({ account: familyId });
  } catch {
    /* best-effort */
  }
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
