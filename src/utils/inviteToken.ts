/**
 * Invite-only gate — token validation for family creation.
 *
 * Valid token hashes are stored in VITE_INVITE_BEAN_HASHES (comma-separated hex).
 * Generate a hash: echo -n "my-token" | sha256sum | cut -d' ' -f1
 *
 * Whether the gate itself is enabled is exposed via `features.inviteGate` in
 * `@/config/features` — callers gate UI on that, not on a separate helper here.
 *
 * The normalize → hash → membership comparison lives in `utils/hashedCodeGate.ts`,
 * shared with the store-review demo gate.
 */

import { features } from '@/config/features';
import { matchesHashedCode } from '@/utils/hashedCodeGate';

const HASHES_ENV = import.meta.env.VITE_INVITE_BEAN_HASHES ?? '';

/** Validate a token against the configured hashes. */
export async function validateInviteToken(token: string): Promise<boolean> {
  // Gate OFF means "no invite required", i.e. everyone passes — the opposite
  // polarity to the demo gate. See the note in `hashedCodeGate.ts`.
  if (!features.inviteGate) return true;

  return matchesHashedCode(token, HASHES_ENV);
}
