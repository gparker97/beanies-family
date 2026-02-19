/**
 * WebAuthn/Passkey service for FIDO2 biometric authentication.
 *
 * This service wraps the Web Authentication API (navigator.credentials)
 * for passkey registration and sign-in. It requires:
 * - A Cognito User Pool with WebAuthn support enabled
 * - A relying party (RP) configuration matching the app domain
 *
 * Note: Full passkey auth requires server-side challenge generation.
 * The current implementation provides the client-side primitives.
 */

export interface PasskeyInfo {
  credentialId: string;
  createdAt: string;
  label: string;
}

const RP_NAME = 'beanies.family';

/**
 * Check if WebAuthn is supported in the current browser.
 */
export function isWebAuthnSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator.credentials !== 'undefined'
  );
}

/**
 * Check if platform authenticator (Touch ID, Face ID, Windows Hello) is available.
 */
export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isWebAuthnSupported()) return false;

  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/**
 * Register a new passkey for the user.
 *
 * In a full implementation, the challenge and user info would come from
 * the server (Cognito + Lambda). This provides the client-side flow.
 */
export async function registerPasskey(
  userId: string,
  email: string,
  challenge: ArrayBuffer
): Promise<PublicKeyCredential | null> {
  if (!isWebAuthnSupported()) {
    throw new Error('WebAuthn is not supported in this browser');
  }

  const rpId = window.location.hostname;

  const publicKeyOptions: PublicKeyCredentialCreationOptions = {
    challenge,
    rp: {
      name: RP_NAME,
      id: rpId,
    },
    user: {
      id: new TextEncoder().encode(userId),
      name: email,
      displayName: email,
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
  };

  try {
    const credential = await navigator.credentials.create({
      publicKey: publicKeyOptions,
    });
    return credential as PublicKeyCredential | null;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      return null; // User cancelled
    }
    throw err;
  }
}

/**
 * Sign in with an existing passkey.
 *
 * In a full implementation, the challenge would come from the server.
 */
export async function signInWithPasskey(
  challenge: ArrayBuffer
): Promise<PublicKeyCredential | null> {
  if (!isWebAuthnSupported()) {
    throw new Error('WebAuthn is not supported in this browser');
  }

  const rpId = window.location.hostname;

  const publicKeyOptions: PublicKeyCredentialRequestOptions = {
    challenge,
    rpId,
    userVerification: 'required',
    timeout: 60000,
  };

  try {
    const assertion = await navigator.credentials.get({
      publicKey: publicKeyOptions,
    });
    return assertion as PublicKeyCredential | null;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      return null; // User cancelled
    }
    throw err;
  }
}

/**
 * Get stored passkey info from localStorage.
 * In production, this would come from the server.
 */
export function listRegisteredPasskeys(): PasskeyInfo[] {
  try {
    const stored = localStorage.getItem('gp-finance-passkeys');
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

/**
 * Save passkey info to localStorage.
 */
export function savePasskeyInfo(info: PasskeyInfo): void {
  const passkeys = listRegisteredPasskeys();
  passkeys.push(info);
  localStorage.setItem('gp-finance-passkeys', JSON.stringify(passkeys));
}

/**
 * Remove a passkey by credential ID.
 */
export function removePasskey(credentialId: string): void {
  const passkeys = listRegisteredPasskeys().filter((p) => p.credentialId !== credentialId);
  localStorage.setItem('gp-finance-passkeys', JSON.stringify(passkeys));
}
