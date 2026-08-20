/**
 * Shared "is this string one of the configured hashed secrets?" primitive.
 *
 * Two gates need exactly this and nothing more:
 *   - the invite-only family-creation gate (`utils/inviteToken.ts`)
 *   - the store-review demo gate (`utils/reviewDemo.ts`)
 *
 * Both configure their valid secrets as a comma-separated list of SHA-256
 * hashes in a build-time env var, and both compare a user-typed string against
 * it. Sharing the comparison keeps them provably identical in behaviour — a
 * normalization difference between the two would be invisible until someone's
 * code mysteriously stopped working.
 *
 * Generate a hash:  echo -n "my-code" | sha256sum | cut -d' ' -f1
 *
 * NOTE ON POLARITY: this function answers one narrow question — does the input
 * match? What "the gate is switched off" means is the CALLER's decision and
 * differs between the two: the invite gate open means *allow everyone through*,
 * while the demo gate closed means *let nobody through*. Keep those inversions
 * at the call sites; folding them in here would make one of them wrong.
 */

import { sha256Hex } from '@/utils/encoding';
import { reportError } from '@/utils/errorReporter';

/**
 * True when `input`, normalized (trimmed + lowercased), hashes to one of the
 * lowercase-hex SHA-256 digests in `hashesCsv`.
 *
 * Never throws. `crypto.subtle` is unavailable on a non-secure origin — a real
 * possibility for a sideloaded or locally-served build — and that must not look
 * like "wrong code". It is reported and returns false: fail closed, never
 * silent. Callers that need to tell the two apart should check
 * `isCryptoAvailable()` first.
 */
export async function matchesHashedCode(input: string, hashesCsv: string): Promise<boolean> {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return false;

  const valid = hashesCsv
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (valid.length === 0) return false;

  try {
    return valid.includes(await sha256Hex(normalized));
  } catch (error) {
    reportError({
      surface: 'hashed-code-gate',
      message:
        'crypto.subtle.digest failed — cannot verify a hashed code. This is almost ' +
        'always a non-secure origin (http://): the Web Crypto API is unavailable ' +
        'outside a secure context. Serve over https:// or localhost.',
      severity: 'error',
      error,
    });
    return false;
  }
}

/**
 * Whether the Web Crypto digest API this module needs is present at all.
 *
 * Lets a caller show "this browser can't verify the code" instead of the
 * indistinguishable-but-wrong "that code isn't right".
 */
export function isCryptoAvailable(): boolean {
  return typeof crypto !== 'undefined' && typeof crypto.subtle?.digest === 'function';
}
