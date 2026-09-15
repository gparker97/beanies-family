import { registerPlugin } from '@capacitor/core';

/**
 * Custom first-party Capacitor plugin (#52 Keystore pivot, ADR-029 2026-07-14).
 *
 * Releases a wrapped copy of the family AES key only after a live, hardware-backed
 * biometric auth — Android `BiometricPrompt` + `AndroidKeyStore` `CryptoObject`,
 * iOS `LocalAuthentication` + a biometric-gated Keychain item (Secure Enclave).
 * The wrapped blob is DEVICE-LOCAL and never synced. This replaces the retired
 * native WebAuthn-PRF path; web/PWA keeps WebAuthn-PRF (see passkeyService.ts).
 *
 * `account` addresses ONE blob on this device. Since #76 it is `${familyId}:${memberId}`
 * (pre-#76 records still use the bare familyId). `nativeBiometric.ts` is the only module
 * allowed to build either form — do not construct an account string here or anywhere else.
 * `keyB64` is STANDARD base64 (not base64url) — must match `Base64.NO_WRAP`
 * (Android) / `.base64EncodedString()` (iOS) on the native side.
 *
 * All methods reject with a typed `BiometricKeystoreError` whose `.code` is one of
 * `BiometricKeystoreErrorCode` (never a raw platform string). Native impls:
 * `BiometricKeystorePlugin.java` / `BiometricKeystorePlugin.swift`.
 */
export interface BiometricKeystorePlugin {
  /** Can this device deliver hardware biometric auth right now? No prompt. */
  isAvailable(): Promise<{
    available: boolean;
    biometryType?: 'faceId' | 'touchId' | 'fingerprint' | 'face' | 'iris' | 'none';
    reason?: string;
  }>;
  /**
   * ENABLE: wrap `keyB64` (standard base64 raw family key) behind a live biometric
   * and persist it device-local under `account`. Replaces any existing blob for
   * `account` (idempotent re-enable). Resolves with which key backing was used.
   */
  setKey(options: { account: string; keyB64: string }): Promise<{
    keyBacking: 'strongbox' | 'tee' | 'keychain' | 'secureEnclave';
  }>;
  /** UNLOCK: prompt biometric, unwrap, and return the raw family key (standard base64). */
  getKey(options: { account: string }): Promise<{ keyB64: string; keyBacking?: string }>;
  /**
   * Presence check — is there a biometric blob for `account`? No prompt.
   *
   * `present: false` means the OS genuinely has no blob. Anything else REJECTS: a
   * missing/empty account, and (Android) a thrown KeyStore read. Both used to report
   * absence, and `nativeUnlock` self-heals on absence by deleting the record — so a
   * caller bug or a transient KeyStore hiccup destroyed a live enrolment.
   */
  hasKey(options: { account: string }): Promise<{ present: boolean }>;
  /**
   * DISABLE: delete the Keystore alias / Keychain item for `account`.
   *
   * Idempotent — an already-absent item RESOLVES. But it resolves only when the delete
   * is provably done: a missing/empty account rejects, and on iOS a failing OS delete
   * rejects with its mapped code. It never reports success having touched nothing (#82).
   */
  deleteKey(options: { account: string }): Promise<void>;
  /**
   * CLEAR ALL: remove every blob this app holds on this device, in one shot.
   *
   * No account, no enumeration, no authentication — so it cannot miss a biometry-gated
   * item. `deleted` reports whether anything was actually there. An empty device
   * resolves (`deleted: false`); an OS failure REJECTS, because "your data is cleared"
   * must never be said over a device where every blob survived.
   *
   * `nativeReclaimAllKeystores` is the only permitted caller. Everything else reclaims
   * per family, so no other path can reach a family the user did not ask about.
   */
  deleteAllKeys(): Promise<{ deleted: boolean }>;
}

/**
 * Typed error codes the native layer rejects with. Mapped to friendly copy +
 * telemetry in `nativeBiometric.ts` — the raw platform string never reaches the UI.
 */
export type BiometricKeystoreErrorCode =
  | 'userCancel' // user dismissed the prompt / chose "use password" — NOT a failure
  | 'notEnrolled' // no biometric enrolled / no secure lock screen
  | 'lockout' // too many failed attempts (transient)
  | 'invalidated' // OS key wiped (biometrics changed / key gone) — re-enroll
  | 'unknown'; // anything else

export const BiometricKeystore = registerPlugin<BiometricKeystorePlugin>('BiometricKeystore');
