/**
 * WebAuthn/Passkey service for biometric authentication and file decryption.
 *
 * Flow: Passkey authenticates member → cached password used to decrypt file.
 *
 * Challenge generation is client-side via crypto.getRandomValues().
 * Acceptable for local-first — no network replay threat.
 */

import { isPRFSupported, buildPRFExtension } from './passkeyCrypto';
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
  label?: string;
}

export interface RegisterPasskeyResult {
  success: boolean;
  error?: string;
  prfSupported?: boolean;
}

export async function registerPasskeyForMember(
  params: RegisterPasskeyParams
): Promise<RegisterPasskeyResult> {
  if (!isWebAuthnSupported()) {
    return { success: false, error: 'WebAuthn is not supported in this browser' };
  }

  const { memberId, memberName, memberEmail, familyId, encryptionPassword } = params;

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

  // Cache the password for file decryption during biometric login
  registration.cachedPassword = encryptionPassword;

  await passkeyRepo.savePasskeyRegistration(registration);

  return {
    success: true,
    prfSupported: registration.prfSupported,
  };
}

// --- Authentication ---

export interface AuthenticatePasskeyParams {
  familyId: string;
}

export interface AuthenticatePasskeyResult {
  success: boolean;
  memberId?: string;
  cachedPassword?: string; // Encryption password for file decryption
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
  // All passkeys are registered with residentKey: 'required', so the browser
  // discovers them by rpId alone — searching Windows Hello, Chrome passkey
  // manager, iCloud Keychain, etc. This avoids Chrome 130+ falling back to
  // the QR-code cross-device flow when credential IDs don't match the
  // current credential resolver.
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
  const registration = registrations.find((r) => r.credentialId === credentialId);

  if (!registration) {
    // Credential ID not found locally — check userHandle for diagnostics.
    // During registration, user.id = TextEncoder.encode(memberId), so the
    // assertion's userHandle tells us which member the passkey belongs to.
    const assertionResponse = assertion.response as AuthenticatorAssertionResponse;
    const userHandle = assertionResponse.userHandle;
    if (userHandle && userHandle.byteLength > 0) {
      const memberIdFromHandle = new TextDecoder().decode(userHandle);
      const memberMatch = registrations.find((r) => r.memberId === memberIdFromHandle);
      if (memberMatch) {
        // The user's member is known but this credential was registered on
        // another device — we don't have the local decryption materials.
        return { success: false, error: 'CROSS_DEVICE_CREDENTIAL' };
      }
    }
    // Neither credential ID nor userHandle matches this family's registrations
    return { success: false, error: 'WRONG_FAMILY_CREDENTIAL' };
  }

  // Update last used timestamp
  await passkeyRepo.updatePasskey(credentialId, {
    lastUsedAt: toISODateString(new Date()),
  });

  // Use cached password for file decryption
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
  await signalCredentialsRemoved([credentialId]);
}

export async function removeAllPasskeysForMember(memberId: string): Promise<void> {
  await passkeyRepo.removeAllPasskeysByMember(memberId);
}

/**
 * Signal to the platform authenticator that the given credential IDs are no
 * longer valid. Uses the WebAuthn Signal API (Chrome/Edge 132+, Safari 26+).
 * This causes Windows Hello / iCloud Keychain / Google Password Manager to
 * stop showing these credentials in the passkey picker.
 *
 * Silently no-ops if the Signal API is not supported.
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

/**
 * Update cached password for all passkey registrations in a family.
 * Called when the encryption password changes.
 */
export async function invalidatePasskeysForPasswordChange(
  familyId: string,
  newPassword?: string
): Promise<void> {
  if (!newPassword) return;
  const registrations = await passkeyRepo.getPasskeysByFamily(familyId);
  for (const reg of registrations) {
    await passkeyRepo.updatePasskey(reg.credentialId, {
      cachedPassword: newPassword,
    });
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
