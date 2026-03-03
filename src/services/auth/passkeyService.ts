/**
 * WebAuthn/Passkey service for biometric authentication and family key access.
 *
 * Flow: Passkey authenticates member → family key unwrapped via PRF or envelope.
 *
 * Challenge generation is client-side via crypto.getRandomValues().
 * Acceptable for local-first — no network replay threat.
 */

import {
  isPRFSupported,
  getPRFOutput,
  buildPRFExtension,
  deriveWrappingKey,
  generateHKDFSalt,
  wrapDEK,
  unwrapDEK,
} from './passkeyCrypto';
import * as passkeyRepo from '@/services/indexeddb/repositories/passkeyRepository';
import type { PasskeyRegistration, PasskeySecret } from '@/types/models';
import { toISODateString } from '@/utils/date';
import { getGlobalSettings } from '@/services/indexeddb/repositories/globalSettingsRepository';
import { importFamilyKey } from '@/services/crypto/familyKeyService';

const RP_NAME = 'beanies.family';

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
  error?: string;
  prfSupported?: boolean;
  passkeySecret?: PasskeySecret;
}

export async function registerPasskeyForMember(
  params: RegisterPasskeyParams
): Promise<RegisterPasskeyResult> {
  if (!isWebAuthnSupported()) {
    return { success: false, error: 'WebAuthn is not supported in this browser' };
  }

  const { memberId, memberName, memberEmail, familyId, familyKey } = params;

  // Generate client-side challenge
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const rpId = window.location.hostname;
  const prfExtension = buildPRFExtension();

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
      residentKey: 'required',
      requireResidentKey: true,
    },
    timeout: 60000,
    attestation: 'none',
    extensions: prfExtension as AuthenticationExtensionsClientInputs,
  };

  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.create({
      publicKey: publicKeyOptions,
    })) as PublicKeyCredential | null;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      return { success: false, error: 'Registration was cancelled' };
    }
    return { success: false, error: err instanceof Error ? err.message : 'Registration failed' };
  }

  if (!credential) {
    return { success: false, error: 'No credential returned' };
  }

  const response = credential.response as AuthenticatorAttestationResponse;
  const extensionResults = credential.getClientExtensionResults();
  const prfAvailable = isPRFSupported(extensionResults);

  // Build registration record
  const registration: PasskeyRegistration = {
    credentialId: bufferToBase64url(credential.rawId),
    memberId,
    familyId,
    publicKey: bufferToBase64(response.getPublicKey()!),
    transports: response.getTransports?.() ?? [],
    prfSupported: prfAvailable,
    label: params.label || guessAuthenticatorLabel(),
    createdAt: toISODateString(new Date()),
  };

  await passkeyRepo.savePasskeyRegistration(registration);

  // If PRF is available, wrap the family key for cross-device access
  let passkeySecret: PasskeySecret | undefined;
  if (prfAvailable) {
    const prfOutput = getPRFOutput(extensionResults);
    if (prfOutput) {
      try {
        const hkdfSalt = generateHKDFSalt();
        const wrappingKey = await deriveWrappingKey(prfOutput, hkdfSalt);
        const wrappedFamilyKey = await wrapDEK(familyKey, wrappingKey);
        passkeySecret = {
          credentialId: registration.credentialId,
          memberId,
          wrappedFamilyKey,
          hkdfSalt: bufferToBase64(hkdfSalt.buffer as ArrayBuffer),
          createdAt: toISODateString(new Date()),
        };
      } catch {
        // PRF wrap failed — non-critical, fall back to password-based unlock
      }
    }
  }

  return {
    success: true,
    prfSupported: registration.prfSupported,
    passkeySecret,
  };
}

// --- Authentication ---

export interface AuthenticatePasskeyParams {
  familyId: string;
  passkeySecrets?: PasskeySecret[];
}

export interface AuthenticatePasskeyResult {
  success: boolean;
  memberId?: string;
  credentialId?: string; // Credential ID (for cross-device registration)
  familyKey?: CryptoKey; // Family key for file decryption
  error?: string;
}

export async function authenticateWithPasskey(
  params: AuthenticatePasskeyParams
): Promise<AuthenticatePasskeyResult> {
  if (!isWebAuthnSupported()) {
    return { success: false, error: 'WebAuthn is not supported' };
  }

  // Load registered passkeys for this family
  const registrations = await passkeyRepo.getPasskeysByFamily(params.familyId);
  if (registrations.length === 0) {
    return { success: false, error: 'No passkeys registered for this family' };
  }

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const rpId = window.location.hostname;
  const prfExtension = buildPRFExtension();

  // Discoverable credential mode: omit allowCredentials entirely.
  const publicKeyOptions: PublicKeyCredentialRequestOptions = {
    challenge,
    rpId,
    userVerification: 'required',
    timeout: 60000,
    extensions: prfExtension as AuthenticationExtensionsClientInputs,
  };

  let assertion: PublicKeyCredential | null;
  try {
    assertion = (await navigator.credentials.get({
      publicKey: publicKeyOptions,
    })) as PublicKeyCredential | null;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      return { success: false, error: 'Authentication was cancelled' };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Authentication failed',
    };
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

  const memberSecrets = passkeySecrets.filter((s) => s.memberId === memberId);
  for (const secret of memberSecrets) {
    try {
      const hkdfSalt = new Uint8Array(base64ToBuffer(secret.hkdfSalt));
      const wrappingKey = await deriveWrappingKey(prfOutput, hkdfSalt);
      const fk = await unwrapDEK(secret.wrappedFamilyKey, wrappingKey);
      return fk;
    } catch {
      // Wrong PRF output or corrupt secret — try next
    }
  }
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
  const passkeys = await passkeyRepo.getPasskeysByFamily(familyId);
  return passkeys.length > 0;
}

export async function removePasskey(credentialId: string): Promise<void> {
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

  const rpId = window.location.hostname;
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

function guessBrowser(ua: string): string {
  // Order matters — check more specific strings first
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua) && !/Chrome/.test(ua)) return 'Safari';
  if (/Firefox\//.test(ua)) return 'Firefox';
  return 'Browser';
}

function guessOS(ua: string): string {
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  if (/Mac/.test(ua)) return 'macOS';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Linux/.test(ua)) return 'Linux';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  return '';
}

export function guessAuthenticatorLabel(): string {
  const ua = navigator.userAgent;
  let base: string;
  if (/iPhone|iPad|iPod/.test(ua)) base = 'Face ID';
  else if (/Mac/.test(ua)) base = 'Touch ID';
  else if (/Windows/.test(ua)) base = 'Windows Hello';
  else if (/Android/.test(ua)) base = 'Fingerprint';
  else base = 'Biometric';

  const browser = guessBrowser(ua);
  const os = guessOS(ua);
  const context = os ? `${browser}, ${os}` : browser;
  return `${base} · ${context}`;
}

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
