/**
 * WebAuthn/Passkey service for biometric authentication and family key access.
 *
 * Flow: Passkey authenticates member → family key unwrapped via PRF or envelope.
 *
 * Challenge generation is client-side via crypto.getRandomValues().
 * Acceptable for local-first — no network replay threat.
 */

import {
  getPRFOutput,
  buildPRFEvalExtension,
  deriveWrappingKey,
  generateHKDFSalt,
  wrapDEK,
  unwrapDEK,
} from './passkeyCrypto';
import * as passkeyRepo from '@/services/indexeddb/repositories/passkeyRepository';
import * as nativeBiometric from './nativeBiometric';
import type { PasskeyRegistration, PasskeySecret } from '@/types/models';
import { toISODateString } from '@/utils/date';
import { getGlobalSettings } from '@/services/indexeddb/repositories/globalSettingsRepository';
import { importFamilyKey } from '@/services/crypto/familyKeyService';
import { isNative, getPlatform } from '@/services/sync/capabilities';
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

// Re-exported for back-compat: `guessAuthenticatorLabel` now lives in the leaf
// `biometricShared` module (so the native Keystore path can reuse it without an
// import cycle), but existing callers import it from here.
export { guessAuthenticatorLabel };

const RP_NAME = 'beanies.family';

/**
 * Resolve the WebAuthn Relying Party ID. WEB/PWA ONLY — native biometric no longer
 * uses WebAuthn (it uses the hardware Keystore via `nativeBiometric.ts`; ADR-029
 * 2026-07-14), so this is always the current origin's hostname (`app.beanies.family`
 * in prod, `localhost` in dev, the self-hoster's domain).
 */
export function getRpId(): string {
  return window.location.hostname;
}

// --- Feature detection ---

export function isWebAuthnSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator.credentials !== 'undefined'
  );
}

export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isWebAuthnSupported()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/**
 * Whether the user CAN enroll biometric on this surface. Deliberately does NOT
 * consult the proactive-offer suppression, so the deliberate management surface
 * (Settings) and explicit enroll flows are never locked out by a prior transient
 * decline.
 * - Native: delegates to the hardware Keystore path (biometric hardware + enrolled).
 * - Web/PWA: a real platform authenticator is available (WebAuthn-PRF path).
 */
export async function canEnrollBiometric(): Promise<boolean> {
  if (isNative()) return nativeBiometric.nativeCanEnroll();
  return isPlatformAuthenticatorAvailable();
}

/**
 * Whether to PROACTIVELY offer biometric enrollment (App.vue's post-sign-in nag).
 * Same capability as `canEnrollBiometric()` but also respects the self-healing
 * per-device suppression so we don't re-nag on a device that just declined. Explicit
 * enroll surfaces (Settings) use `canEnrollBiometric()` so they always work.
 */
export async function canOfferBiometric(): Promise<boolean> {
  if (isNative()) return nativeBiometric.nativeCanOffer();
  if (isBiometricOfferSuppressed()) return false;
  return canEnrollBiometric();
}

// --- Registration ---

export interface RegisterPasskeyParams {
  memberId: string;
  memberName: string;
  memberEmail: string;
  familyId: string;
  familyKey: CryptoKey;
  label?: string;
}

export interface RegisterPasskeyResult {
  success: boolean;
  /**
   * True when the user dismissed the platform-authenticator prompt
   * (`DOMException: NotAllowedError`). Distinct from a real failure so
   * callers can swallow user-cancellation silently — surfacing an error
   * toast for a deliberate user gesture is misleading and was leaking
   * to `#beanies-errors` via the auto-reporter (triage 2026-05-02).
   */
  cancelled?: boolean;
  error?: string;
  prfSupported?: boolean;
  passkeySecret?: PasskeySecret;
}

export async function registerPasskeyForMember(
  params: RegisterPasskeyParams
): Promise<RegisterPasskeyResult> {
  // Native (installed app): the hardware Keystore path, NOT WebAuthn. Delegate BEFORE
  // the `isWebAuthnSupported()` gate below (which can be false on the native WebView).
  if (isNative()) return nativeBiometric.nativeEnable(params);

  if (!isWebAuthnSupported()) {
    return { success: false, error: 'WebAuthn is not supported in this browser' };
  }

  const { memberId, memberName, memberEmail, familyId, familyKey } = params;

  // Generate client-side challenge
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const rpId = getRpId();
  // Request PRF eval at create. Safari 18+ returns the output there (single prompt);
  // Chromium ENABLES PRF but does not evaluate at create, so those browsers fall
  // through to the immediate second assertion in `establishPasskeyWrap` (a second
  // prompt at enable — expected). Either way the wrap is established during enable so
  // biometric unlock works on the first unlock.
  const createPrfExtension = buildPRFEvalExtension();

  const publicKeyOptions: PublicKeyCredentialCreationOptions = {
    challenge,
    rp: { name: RP_NAME, id: rpId },
    user: {
      id: new TextEncoder().encode(memberId),
      name: memberEmail,
      displayName: memberName,
    },
    pubKeyCredParams: [
      { alg: -7, type: 'public-key' }, // ES256
      { alg: -257, type: 'public-key' }, // RS256
    ],
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      userVerification: 'required',
      // Discoverable (resident) credentials let the assertion flow omit
      // `allowCredentials` (see authenticateWithPasskey). Web requires them.
      residentKey: 'required',
      requireResidentKey: true,
    },
    timeout: 60000,
    attestation: 'none',
    extensions: createPrfExtension as AuthenticationExtensionsClientInputs,
  };

  const createOptions: CredentialCreationOptions = { publicKey: publicKeyOptions };

  // Progressive registration: try platform-attached first (ensures "save on this device"
  // prompt), then fall back without it for Android OEMs that can't handle the constraint.
  // `attemptErrors` captures each attempt's RAW DOMException so a total failure surfaces
  // the real Android Credential Manager cause (the friendly string hides it, and the
  // fallback attempts were previously swallowed entirely).
  let credential: PublicKeyCredential | null;
  const attemptErrors: string[] = [];
  try {
    credential = (await navigator.credentials.create(createOptions)) as PublicKeyCredential | null;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      return { success: false, cancelled: true, error: 'Registration was cancelled' };
    }
    attemptErrors.push(`1·platform+prf: ${describeAuthError(err)}`);

    // Platform constraint or PRF extension failed — retry progressively:
    // 1. Remove authenticatorAttachment, use hints instead (Chrome 128+)
    // 2. If still failing, also remove PRF extension
    credential = await retryRegistrationWithFallbacks(
      createOptions,
      publicKeyOptions,
      attemptErrors
    );
    if (credential === null) {
      // Surface the raw per-attempt causes to #beanies-errors + the firehose.
      // `warning`, not `error`: the user can still sign in with their password.
      reportError({
        surface: 'passkey-register',
        message: 'passkey registration failed (all attempts)',
        error: err,
        severity: 'warning',
        context: {
          os: getPlatform(),
          action: 'create',
          detail: attemptErrors.join(' || '),
        },
      });
      suppressBiometricOffer();
      return { success: false, error: formatCredentialManagerError(err) };
    }
  }

  if (!credential) {
    return { success: false, error: 'No credential returned' };
  }

  const os = getPlatform();
  const credentialId = bufferToBase64url(credential.rawId);
  const prfEnabled =
    (credential.getClientExtensionResults() as { prf?: { enabled?: boolean } }).prf?.enabled ===
    true;
  logEvent({
    level: 'info',
    surface: 'passkey-prf',
    message: 'prf_enable_result',
    context: { os, prf_enabled: prfEnabled },
  });

  // Establish the PRF-based family-key wrap DURING enable (immediate assertion on
  // native + Chromium; create-time output on Safari 18+) so biometric unlock works
  // on the first unlock.
  const result = await establishPasskeyWrap(credential, memberId, familyKey);
  if (result === 'cancelled') {
    // User dismissed the second (PRF-eval) prompt — a deliberate gesture, not a
    // failure. Silent, exactly like the create-cancel path: no persist, no
    // suppression, no report. The just-created credential is left benign + unused.
    return { success: false, cancelled: true, error: 'Registration was cancelled' };
  }
  if (result === null) {
    // Reached a passkey but PRF couldn't be established (browser/device lacks usable
    // PRF, or a transient wrap error). Clean decline — no scary error, no credential
    // destruction; suppress only the PROACTIVE nag (Settings retry still works).
    return declineEnable(os);
  }
  const passkeySecret = result;

  // Persist the registration ONLY after the wrap succeeds — so a declined/cancelled
  // enable leaves no local record. `prfSupported` is true by construction: we hold
  // a working wrap.
  const response = credential.response as AuthenticatorAttestationResponse;
  const registration: PasskeyRegistration = {
    credentialId,
    memberId,
    familyId,
    publicKey: bufferToBase64(response.getPublicKey()!),
    transports: response.getTransports?.() ?? [],
    prfSupported: true,
    label: params.label || guessAuthenticatorLabel(),
    createdAt: toISODateString(new Date()),
  };
  await passkeyRepo.savePasskeyRegistration(registration);
  clearBiometricSuppression();

  return {
    success: true,
    prfSupported: true,
    passkeySecret,
  };
}

/**
 * Obtain a PRF output for the just-created credential and wrap the family key into
 * a `PasskeySecret`. Safari 18+ already evaluated PRF at create (output in hand);
 * native + Chromium run an immediate assertion RESTRICTED to this credential to
 * evaluate PRF. Returns:
 *   - a `PasskeySecret` on success,
 *   - `'cancelled'` when the user dismissed the immediate assertion prompt (a
 *     deliberate gesture the caller must treat as cancellation, not failure),
 *   - `null` when PRF genuinely couldn't be established (no PRF output or a wrap
 *     error) — the caller cleanly declines.
 * Logs the eval outcome either way; never swallows a decision silently.
 */
async function establishPasskeyWrap(
  credential: PublicKeyCredential,
  memberId: string,
  familyKey: CryptoKey
): Promise<PasskeySecret | 'cancelled' | null> {
  const os = getPlatform();
  let prfOutput = getPRFOutput(credential.getClientExtensionResults());
  let credentialSource: 'create' | 'assert' = 'create';
  if (!prfOutput) {
    credentialSource = 'assert';
    const evaluated = await evaluatePRFForCredential(credential.rawId);
    if (evaluated === 'cancelled') {
      logEvent({
        level: 'info',
        surface: 'passkey-prf',
        message: 'prf_eval_result',
        context: { os, has_prf_output: false, credential_source: 'assert' },
      });
      return 'cancelled';
    }
    prfOutput = evaluated;
  }
  logEvent({
    level: 'info',
    surface: 'passkey-prf',
    message: 'prf_eval_result',
    context: { os, has_prf_output: prfOutput !== null, credential_source: credentialSource },
  });
  if (!prfOutput) return null;

  try {
    const hkdfSalt = generateHKDFSalt();
    const wrappingKey = await deriveWrappingKey(prfOutput, hkdfSalt);
    const wrappedFamilyKey = await wrapDEK(familyKey, wrappingKey);
    logEvent({
      level: 'info',
      surface: 'passkey-prf',
      message: 'wrap_established',
      context: { os },
    });
    return {
      credentialId: bufferToBase64url(credential.rawId),
      memberId,
      wrappedFamilyKey,
      hkdfSalt: bufferToBase64(hkdfSalt.buffer as ArrayBuffer),
      createdAt: toISODateString(new Date()),
    };
  } catch {
    return null;
  }
}

/**
 * Immediate assertion restricted to the just-created credential, to evaluate PRF
 * during the enable ceremony. Returns the normalized PRF output, `'cancelled'` when
 * the user dismisses the prompt (`NotAllowedError`), or `null` (no PRF / other error).
 */
async function evaluatePRFForCredential(
  rawId: ArrayBuffer
): Promise<ArrayBuffer | 'cancelled' | null> {
  const publicKeyOptions: PublicKeyCredentialRequestOptions = {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    rpId: getRpId(),
    userVerification: 'required',
    timeout: 60000,
    // Restrict to THIS credential so the wrap is keyed to the passkey we just
    // created (the PRF output is per-credential); a discoverable get could match
    // a different existing passkey and produce an unusable wrap.
    allowCredentials: [{ id: rawId, type: 'public-key' }],
    extensions: buildPRFEvalExtension() as AuthenticationExtensionsClientInputs,
  };
  try {
    const assertion = (await navigator.credentials.get({
      publicKey: publicKeyOptions,
    })) as PublicKeyCredential | null;
    if (!assertion) return null;
    return getPRFOutput(assertion.getClientExtensionResults());
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotAllowedError') return 'cancelled';
    return null;
  }
}

/**
 * Clean decline of a biometric enable that reached a passkey but couldn't establish
 * a PRF wrap (device/browser lacks usable PRF, or a transient wrap error). We do NOT
 * remove/signal the just-created platform credential — `signalUnknownCredential`
 * would ask the platform to DELETE it; it's instead left as a benign unused passkey.
 * We surface a gentle "not available" message (not a failure/error toast), suppress
 * only the PROACTIVE nag (Settings retry is unaffected via `canEnrollBiometric`), and
 * log to the firehose (warn, no Slack page) so the decline rate stays measurable.
 */
function declineEnable(os: string): RegisterPasskeyResult {
  logEvent({
    level: 'warn',
    surface: 'passkey-prf',
    message: 'enroll_declined',
    context: { os, action: 'no-prf' },
  });
  suppressBiometricOffer();
  return { success: false, error: biometricUnavailableMessage() };
}

function biometricUnavailableMessage(): string {
  return tr(
    'passkey.errNotSupported',
    "Biometric unlock isn't available on this device right now. You can sign in with your password."
  );
}

// --- Authentication ---

export interface AuthenticatePasskeyParams {
  familyId: string;
  passkeySecrets?: PasskeySecret[];
}

export interface AuthenticatePasskeyResult {
  success: boolean;
  /**
   * True when the user dismissed the platform-authenticator prompt
   * (`DOMException: NotAllowedError`). See `RegisterPasskeyResult.cancelled`
   * for why callers should swallow this case silently rather than render
   * an error.
   */
  cancelled?: boolean;
  memberId?: string;
  credentialId?: string; // Credential ID (for cross-device registration)
  familyKey?: CryptoKey; // Family key for file decryption
  error?: string;
}

export async function authenticateWithPasskey(
  params: AuthenticatePasskeyParams
): Promise<AuthenticatePasskeyResult> {
  // Native (installed app): the hardware Keystore path. `passkeySecrets` is unused on
  // native (device-local blob, no envelope). Delegate before the WebAuthn gate.
  if (isNative()) return nativeBiometric.nativeUnlock(params.familyId);

  if (!isWebAuthnSupported()) {
    return { success: false, error: 'WebAuthn is not supported' };
  }

  // Load registered passkeys for this family
  const registrations = await passkeyRepo.getPasskeysByFamily(params.familyId);
  if (registrations.length === 0) {
    return { success: false, error: 'No passkeys registered for this family' };
  }

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const rpId = getRpId();
  const prfExtension = buildPRFEvalExtension();

  // Discoverable credential mode: omit allowCredentials entirely.
  const publicKeyOptions: PublicKeyCredentialRequestOptions = {
    challenge,
    rpId,
    userVerification: 'required',
    timeout: 60000,
    extensions: prfExtension as AuthenticationExtensionsClientInputs,
  };

  const getOptions: CredentialRequestOptions = { publicKey: publicKeyOptions };

  let assertion: PublicKeyCredential | null;
  try {
    assertion = (await navigator.credentials.get(getOptions)) as PublicKeyCredential | null;
  } catch (err) {
    // On NotReadableError (Android credential manager issue), retry without PRF extension
    if (err instanceof DOMException && err.name === 'NotReadableError') {
      try {
        delete publicKeyOptions.extensions;
        assertion = (await navigator.credentials.get(getOptions)) as PublicKeyCredential | null;
      } catch (retryErr) {
        return {
          success: false,
          error: formatCredentialManagerError(retryErr),
        };
      }
    } else if (err instanceof DOMException && err.name === 'NotAllowedError') {
      return { success: false, cancelled: true, error: 'Authentication was cancelled' };
    } else {
      return {
        success: false,
        error: formatCredentialManagerError(err),
      };
    }
  }

  if (!assertion) {
    return { success: false, error: 'No assertion returned' };
  }

  // Match credential to registration using multiple signals
  const credentialId = bufferToBase64url(assertion.rawId);
  const extensionResults = assertion.getClientExtensionResults();
  const registration = registrations.find((r) => r.credentialId === credentialId);

  if (!registration) {
    // Credential ID not found locally — likely a synced passkey from another device.
    // Check userHandle to identify the member.
    const assertionResponse = assertion.response as AuthenticatorAssertionResponse;
    const userHandle = assertionResponse.userHandle;
    if (userHandle && userHandle.byteLength > 0) {
      const memberIdFromHandle = new TextDecoder().decode(userHandle);
      const memberMatch = registrations.find((r) => r.memberId === memberIdFromHandle);
      if (memberMatch) {
        // Try to unwrap family key via PRF from passkeyWrappedKeys in envelope
        const familyKeyResult = await tryUnwrapFamilyKeyFromPRF(
          extensionResults,
          params.passkeySecrets,
          memberIdFromHandle
        );
        if (familyKeyResult) {
          // Auto-register the synced credential locally
          await registerSyncedCredential({
            credentialId,
            sourceRegistration: memberMatch,
          });
          return {
            success: true,
            memberId: memberIdFromHandle,
            familyKey: familyKeyResult,
          };
        }

        // Try cached family key from trusted device settings
        const cachedFamilyKey = await getCachedFamilyKeyForFamily(params.familyId);
        if (cachedFamilyKey) {
          await registerSyncedCredential({
            credentialId,
            sourceRegistration: memberMatch,
          });
          return {
            success: true,
            memberId: memberMatch.memberId,
            familyKey: cachedFamilyKey,
          };
        }

        // Family key not available — user must enter password to derive it
        return {
          success: true,
          memberId: memberMatch.memberId,
          credentialId,
        };
      }
    }
    // Neither credential ID nor userHandle matches this family's registrations
    return { success: false, error: 'WRONG_FAMILY_CREDENTIAL' };
  }

  // Update last used timestamp
  await passkeyRepo.updatePasskey(credentialId, {
    lastUsedAt: toISODateString(new Date()),
  });

  // Try PRF unwrap from passkeyWrappedKeys
  const familyKeyResult = await tryUnwrapFamilyKeyFromPRF(
    extensionResults,
    params.passkeySecrets,
    registration.memberId
  );
  if (familyKeyResult) {
    return {
      success: true,
      memberId: registration.memberId,
      familyKey: familyKeyResult,
    };
  }

  // Try cached family key from trusted device settings
  const cachedFamilyKey = await getCachedFamilyKeyForFamily(params.familyId);
  if (cachedFamilyKey) {
    return {
      success: true,
      memberId: registration.memberId,
      familyKey: cachedFamilyKey,
    };
  }

  // Passkey verified the member but we can't get the family key without PRF or cache.
  // Caller should prompt for password to derive the family key from the envelope.
  return {
    success: true,
    memberId: registration.memberId,
    credentialId,
  };
}

// --- PRF family key unwrapping ---

async function tryUnwrapFamilyKeyFromPRF(
  extensionResults: AuthenticationExtensionsClientOutputs,
  passkeySecrets: PasskeySecret[] | undefined,
  memberId: string
): Promise<CryptoKey | null> {
  if (!passkeySecrets || passkeySecrets.length === 0) return null;
  const prfOutput = getPRFOutput(extensionResults);
  if (!prfOutput) return null;

  // Try member-specific secrets first, then any without a memberId (from envelope)
  const memberSecrets = passkeySecrets.filter((s) => s.memberId === memberId || s.memberId === '');
  if (memberSecrets.length === 0) return null;
  const os = getPlatform();
  for (const secret of memberSecrets) {
    try {
      const hkdfSalt = new Uint8Array(base64ToBuffer(secret.hkdfSalt));
      const wrappingKey = await deriveWrappingKey(prfOutput, hkdfSalt);
      const fk = await unwrapDEK(secret.wrappedFamilyKey, wrappingKey);
      logEvent({
        level: 'info',
        surface: 'passkey-prf',
        message: 'unwrap_result',
        context: { os, unwrap_ok: true },
      });
      return fk;
    } catch {
      // Wrong PRF output or corrupt secret — try next
    }
  }
  // We had a PRF output + candidate secrets but none unwrapped — a real anomaly
  // worth a rate signal (the caller still falls back to cache/password).
  logEvent({
    level: 'info',
    surface: 'passkey-prf',
    message: 'unwrap_result',
    context: { os, unwrap_ok: false },
  });
  return null;
}

// --- Synced credential registration ---

/**
 * Register a synced passkey credential locally, copying metadata from a known registration.
 * Used when a passkey syncs via iCloud Keychain / Google Password Manager to a new device.
 */
export async function registerSyncedCredential(params: {
  credentialId: string;
  sourceRegistration: PasskeyRegistration;
}): Promise<void> {
  const syncedRegistration: PasskeyRegistration = {
    credentialId: params.credentialId,
    memberId: params.sourceRegistration.memberId,
    familyId: params.sourceRegistration.familyId,
    publicKey: params.sourceRegistration.publicKey,
    transports: params.sourceRegistration.transports,
    prfSupported: params.sourceRegistration.prfSupported,
    label: params.sourceRegistration.label + ' (synced)',
    createdAt: params.sourceRegistration.createdAt,
    lastUsedAt: toISODateString(new Date()),
  };
  await passkeyRepo.savePasskeyRegistration(syncedRegistration);
}

// --- Management ---

export async function listRegisteredPasskeys(memberId?: string): Promise<PasskeyRegistration[]> {
  if (memberId) {
    return passkeyRepo.getPasskeysByMember(memberId);
  }
  return passkeyRepo.getAllPasskeys();
}

export async function hasRegisteredPasskeys(familyId: string): Promise<boolean> {
  // Native: only a `native-keystore` record counts (and stale WebAuthn records are
  // cleaned up here so they neither drive an unlock nor suppress the enroll offer).
  if (isNative()) return nativeBiometric.nativeHasRegistered(familyId);
  const passkeys = await passkeyRepo.getPasskeysByFamily(familyId);
  return passkeys.length > 0;
}

export async function removePasskey(credentialId: string): Promise<void> {
  const record = await passkeyRepo.getPasskeyByCredentialId(credentialId);
  if (record?.mechanism === 'native-keystore') {
    await nativeBiometric.nativeDisable(record.familyId, credentialId);
    return;
  }
  await passkeyRepo.removePasskeyRegistration(credentialId);
  await signalCredentialsRemoved([credentialId]);
}

export async function removeAllPasskeysForMember(memberId: string): Promise<void> {
  await passkeyRepo.removeAllPasskeysByMember(memberId);
}

/**
 * Signal to the platform authenticator that the given credential IDs are no
 * longer valid. Uses the WebAuthn Signal API (Chrome/Edge 132+, Safari 26+).
 */
export async function signalCredentialsRemoved(credentialIds: string[]): Promise<void> {
  if (
    typeof PublicKeyCredential === 'undefined' ||
    typeof (PublicKeyCredential as unknown as Record<string, unknown>).signalUnknownCredential !==
      'function'
  ) {
    return;
  }

  const rpId = getRpId();
  const signal = (
    PublicKeyCredential as unknown as {
      signalUnknownCredential: (opts: { rpId: string; credentialId: string }) => Promise<void>;
    }
  ).signalUnknownCredential;

  for (const credentialId of credentialIds) {
    try {
      await signal({ rpId, credentialId });
    } catch {
      // Signal is best-effort — ignore errors
    }
  }
}

export async function renamePasskey(credentialId: string, label: string): Promise<void> {
  await passkeyRepo.updatePasskey(credentialId, { label });
}

// --- Registration retry logic ---

/**
 * Progressive fallback for credential creation: drop `authenticatorAttachment`
 * and use `hints: ['client-device']` instead (Chrome 128+ / Android OEMs that
 * can't handle the platform constraint). The enable-only PRF extension (`{prf:{}}`)
 * is tiny and GMS-friendly, so we deliberately DO NOT retry without PRF: a passkey
 * with no PRF can't unlock the family key, so dropping it would just create a
 * useless credential. If this attempt fails, the caller degrades to password.
 *
 * Returns the credential on success, or null if user cancelled / the retry failed.
 */
async function retryRegistrationWithFallbacks(
  createOptions: CredentialCreationOptions,
  publicKeyOptions: PublicKeyCredentialCreationOptions,
  attemptErrors: string[]
): Promise<PublicKeyCredential | null> {
  // Fallback: drop authenticatorAttachment, use hints instead
  delete publicKeyOptions.authenticatorSelection!.authenticatorAttachment;
  applyCredentialHints(createOptions, ['client-device']);

  try {
    return (await navigator.credentials.create(createOptions)) as PublicKeyCredential | null;
  } catch (err1) {
    if (err1 instanceof DOMException && err1.name === 'NotAllowedError') {
      return null; // User cancelled
    }
    attemptErrors.push(`2·hints+prf: ${describeAuthError(err1)}`);
    // No PRF-drop retry — a non-PRF passkey is useless for unlock. Caller degrades.
  }

  return null;
}

// --- Helpers ---

/**
 * Look up the cached family key for a family from global settings.
 * Stored per-family on trusted devices in the registry DB.
 */
async function getCachedFamilyKeyForFamily(familyId: string): Promise<CryptoKey | null> {
  try {
    const gs = await getGlobalSettings();
    const cached = gs.cachedFamilyKeys?.[familyId];
    if (!cached) return null;
    const raw = new Uint8Array(base64ToBuffer(cached));
    return importFamilyKey(raw);
  } catch {
    return null;
  }
}

// --- Utility ---

export function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

export function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer as ArrayBuffer;
}

export function bufferToBase64url(buffer: ArrayBuffer): string {
  return bufferToBase64(buffer).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export function base64urlToBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return base64ToBuffer(padded);
}

/**
 * Apply PublicKeyCredentialHints to credential options for browsers that support it.
 * Chrome 128+ supports hints as a non-restrictive alternative to authenticatorAttachment.
 * Older browsers silently ignore unknown properties, so this is safe to apply unconditionally.
 */
function applyCredentialHints(
  options: CredentialCreationOptions | CredentialRequestOptions,
  hints: string[]
): void {
  // hints is set on the publicKey options object in newer WebAuthn specs
  const pk = (options as Record<string, unknown>).publicKey as Record<string, unknown> | undefined;
  if (pk) {
    pk.hints = hints;
  }
}

/**
 * Format credential manager errors into user-friendly messages.
 * Android's credential manager can return opaque NotReadableError messages.
 */
function formatCredentialManagerError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  const message = err instanceof Error ? err.message : String(err);

  if (name === 'NotReadableError') {
    return tr(
      'passkey.errNotReadable',
      'Your device could not complete this request. Please make sure your device biometrics (fingerprint or face unlock) are set up, then try again.'
    );
  }
  // "No create options available" / NoCreateCredentialException: Android Credential
  // Manager found no provider that can satisfy the request (and NotSupportedError):
  // biometric can't be set up here — degrade to password cleanly, never the raw string.
  if (
    name === 'NotSupportedError' ||
    /no create options available|NoCreateCredentialException/i.test(message)
  ) {
    return tr(
      'passkey.errNotSupported',
      "Biometric unlock isn't available on this device right now. You can sign in with your password."
    );
  }
  if (name === 'SecurityError') {
    return tr(
      'passkey.errSecurity',
      'A security error occurred. Please make sure you are on a secure (HTTPS) connection.'
    );
  }

  // Unrecognized passkey failure — surface a FRIENDLY string to the user (never
  // the raw platform message) AND a developer breadcrumb. `warning`, not `error`:
  // the caller still falls back to password, so it's not user-blocking. Known/
  // cancelled cases never reach here (handled upstream + de-noised, triage
  // 2026-05-02). errorReporter's reentry-guard + 60s dedup cover floods.
  reportError({
    surface: 'passkey-assertion',
    message: message || 'unknown passkey error',
    error: err,
    severity: 'warning',
    context: {
      os: getPlatform(),
      error_code: name || null,
      detail: describeAuthError(err),
    },
  });
  return tr(
    'passkey.errGeneric',
    'Something went wrong with biometric unlock. You can sign in with your password.'
  );
}
