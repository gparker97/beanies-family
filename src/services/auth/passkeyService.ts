/**
 * WebAuthn/Passkey service for biometric authentication and file decryption.
 *
 * Two paths:
 * 1. PRF path: WebAuthn PRF extension → HKDF → AES-KW wrap/unwrap DEK → decrypt file directly
 * 2. Non-PRF path: Passkey authenticates member, cached password used to decrypt file
 *
 * Challenge generation is client-side via crypto.getRandomValues().
 * Acceptable for local-first — no network replay threat.
 */

import {
  isPRFSupported,
  getPRFOutput,
  generateHKDFSalt,
  deriveWrappingKey,
  wrapDEK,
  unwrapDEK,
  buildPRFExtension,
} from './passkeyCrypto';
import { deriveExtractableKey, extractSaltFromEncrypted } from '@/services/crypto/encryption';
import * as passkeyRepo from '@/services/indexeddb/repositories/passkeyRepository';
import type { PasskeyRegistration } from '@/types/models';
import { toISODateString } from '@/utils/date';

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
  encryptionPassword: string;
  encryptedFileBlob: string; // base64 encrypted data (to extract PBKDF2 salt)
  label?: string;
}

export interface RegisterPasskeyResult {
  success: boolean;
  error?: string;
  prfSupported?: boolean;
  /** If PRF succeeded, the extractable DEK for use as sessionDEK */
  dek?: CryptoKey;
  /** If PRF succeeded, the PBKDF2 salt used to derive the DEK */
  dekSalt?: Uint8Array;
}

export async function registerPasskeyForMember(
  params: RegisterPasskeyParams
): Promise<RegisterPasskeyResult> {
  if (!isWebAuthnSupported()) {
    return { success: false, error: 'WebAuthn is not supported in this browser' };
  }

  const { memberId, memberName, memberEmail, familyId, encryptionPassword, encryptedFileBlob } =
    params;

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

  // Always cache the password as fallback — even on PRF path.
  // The PRF-wrapped DEK can become stale if the file is re-encrypted with
  // a new PBKDF2 salt (e.g. by password-based auto-sync on another device).
  // The cached password lets us recover gracefully.
  registration.cachedPassword = encryptionPassword;

  let registeredDEK: CryptoKey | undefined;
  let registeredDEKSalt: Uint8Array | undefined;

  if (prfAvailable) {
    // PRF path: wrap the DEK (allows true passwordless decryption)
    try {
      const prfOutput = getPRFOutput(extensionResults);
      if (!prfOutput) {
        return { success: false, error: 'PRF output missing despite being supported' };
      }

      // Extract PBKDF2 salt from the encrypted file
      const pbkdf2Salt = extractSaltFromEncrypted(encryptedFileBlob);

      // Derive the extractable DEK using the password + same salt
      const dek = await deriveExtractableKey(encryptionPassword, pbkdf2Salt);

      // Derive wrapping key from PRF output
      const hkdfSalt = generateHKDFSalt();
      const wrappingKey = await deriveWrappingKey(prfOutput, hkdfSalt);

      // Wrap the DEK
      registration.wrappedDEK = await wrapDEK(dek, wrappingKey);
      registration.wrappedDEKSalt = bufferToBase64(hkdfSalt.buffer as ArrayBuffer);
      registration.encryptionSalt = bufferToBase64(pbkdf2Salt.buffer as ArrayBuffer);

      registeredDEK = dek;
      registeredDEKSalt = pbkdf2Salt;
    } catch (err) {
      // PRF wrapping failed — cached password is still stored
      console.warn('PRF DEK wrapping failed, cached password will be used:', err);
      registration.prfSupported = false;
    }
  }

  await passkeyRepo.savePasskeyRegistration(registration);

  return {
    success: true,
    prfSupported: registration.prfSupported,
    dek: registeredDEK,
    dekSalt: registeredDEKSalt,
  };
}

// --- Authentication ---

export interface AuthenticatePasskeyParams {
  familyId: string;
}

export interface AuthenticatePasskeyResult {
  success: boolean;
  memberId?: string;
  dek?: CryptoKey; // PRF path: unwrapped DEK
  cachedPassword?: string; // Non-PRF path: encryption password
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

  // Build allowCredentials from registrations
  const allowCredentials: PublicKeyCredentialDescriptor[] = registrations.map((reg) => ({
    type: 'public-key' as const,
    id: base64urlToBuffer(reg.credentialId),
    transports: (reg.transports ?? []) as AuthenticatorTransport[],
  }));

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const rpId = window.location.hostname;
  const prfExtension = buildPRFExtension();

  const publicKeyOptions: PublicKeyCredentialRequestOptions = {
    challenge,
    rpId,
    allowCredentials,
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

  // Match credential to registration
  const credentialId = bufferToBase64url(assertion.rawId);
  const registration = registrations.find((r) => r.credentialId === credentialId);
  if (!registration) {
    return { success: false, error: 'Credential not recognized' };
  }

  // Update last used timestamp
  await passkeyRepo.updatePasskey(credentialId, {
    lastUsedAt: toISODateString(new Date()),
  });

  // Try PRF path if registration has wrapped DEK
  if (registration.prfSupported && registration.wrappedDEK && registration.wrappedDEKSalt) {
    const extensionResults = assertion.getClientExtensionResults();
    const prfOutput = getPRFOutput(extensionResults);

    if (prfOutput) {
      try {
        const hkdfSalt = new Uint8Array(base64ToBuffer(registration.wrappedDEKSalt));
        const wrappingKey = await deriveWrappingKey(prfOutput, hkdfSalt);
        const dek = await unwrapDEK(registration.wrappedDEK, wrappingKey);

        return {
          success: true,
          memberId: registration.memberId,
          dek,
          cachedPassword: registration.cachedPassword,
        };
      } catch (err) {
        console.warn('PRF unwrap failed:', err);
        // Fall through to cached password if available
      }
    }
  }

  // Non-PRF path or PRF failed — use cached password
  if (registration.cachedPassword) {
    return {
      success: true,
      memberId: registration.memberId,
      cachedPassword: registration.cachedPassword,
    };
  }

  return {
    success: false,
    error: 'Passkey verified but cannot decrypt file. Please re-register in Settings.',
  };
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
}

export async function removeAllPasskeysForMember(memberId: string): Promise<void> {
  await passkeyRepo.removeAllPasskeysByMember(memberId);
}

/**
 * Invalidate PRF-wrapped DEKs for a family (e.g. when encryption password changes).
 * Non-PRF registrations get their cached password updated.
 */
export async function invalidatePasskeysForPasswordChange(
  familyId: string,
  newPassword?: string
): Promise<void> {
  const registrations = await passkeyRepo.getPasskeysByFamily(familyId);
  for (const reg of registrations) {
    if (reg.prfSupported && reg.wrappedDEK) {
      // PRF path: invalidate wrapped DEK — user must re-register
      await passkeyRepo.updatePasskey(reg.credentialId, {
        wrappedDEK: undefined,
        wrappedDEKSalt: undefined,
        encryptionSalt: undefined,
      });
    } else if (reg.cachedPassword && newPassword) {
      // Non-PRF path: update cached password
      await passkeyRepo.updatePasskey(reg.credentialId, {
        cachedPassword: newPassword,
      });
    }
  }
}

export async function renamePasskey(credentialId: string, label: string): Promise<void> {
  await passkeyRepo.updatePasskey(credentialId, { label });
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

function guessAuthenticatorLabel(): string {
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

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer as ArrayBuffer;
}

function bufferToBase64url(buffer: ArrayBuffer): string {
  return bufferToBase64(buffer).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlToBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return base64ToBuffer(padded);
}
