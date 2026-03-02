/**
 * PKCE (Proof Key for Code Exchange) utilities for OAuth 2.0.
 *
 * Generates code_verifier and code_challenge for the Authorization Code + PKCE flow.
 * Uses Web Crypto API — no external dependencies.
 */

function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Generate a cryptographically random code_verifier (43 chars, base64url).
 */
export function generateCodeVerifier(): string {
  const buffer = new Uint8Array(32);
  crypto.getRandomValues(buffer);
  return bufferToBase64url(buffer.buffer);
}

/**
 * Generate a code_challenge from a code_verifier using SHA-256 (S256 method).
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bufferToBase64url(digest);
}
