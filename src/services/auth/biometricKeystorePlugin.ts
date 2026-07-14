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
 * `account` is the family id — one biometric-gated blob per family per device.
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
  /** Presence check — is there a biometric blob for `account`? No prompt. */
  hasKey(options: { account: string }): Promise<{ present: boolean }>;
  /** DISABLE: delete the Keystore alias / Keychain item for `account`. Idempotent. */
  deleteKey(options: { account: string }): Promise<void>;
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
