/**
 * Invite-only gate — token validation for family creation.
 *
 * Valid token hashes are stored in VITE_INVITE_BEAN_HASHES (comma-separated hex).
 * Generate a hash: echo -n "my-token" | sha256sum | cut -d' ' -f1
 */

const HASHES_ENV = import.meta.env.VITE_INVITE_BEAN_HASHES ?? '';

/** Whether the invite gate is active (non-empty hash list). */
export function isInviteGateEnabled(): boolean {
  return HASHES_ENV.trim().length > 0;
}

/** SHA-256 hash a string, returning lowercase hex. */
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Validate a token against the configured hashes. */
export async function validateInviteToken(token: string): Promise<boolean> {
  if (!isInviteGateEnabled()) return true;

  const normalized = token.trim().toLowerCase();
  if (!normalized) return false;

  const hex = await sha256Hex(normalized);
  const valid = HASHES_ENV.split(',').map((h: string) => h.trim().toLowerCase());
  return valid.includes(hex);
}
