/**
 * Recovery kit (Phase 3 of the 2026-08-28 login rethink).
 *
 * A full-entropy 160-bit key, generated once, shown to the family as a transcribable
 * code (Crockford base32, `XXXX-XXXX-…` groups, no ambiguous characters) + QR, and
 * wrapped into the envelope's additive `recoveryKeys` field. The raw code is NEVER
 * persisted anywhere — possession of the printed/saved kit is the credential. Entropy,
 * not iteration count, is the security (same argument as invite tokens): 2^160 makes the
 * offline file attack irrelevant.
 *
 * kitId is NON-secret (random hex, printed on the kit) so a family can tell copies
 * apart and so regeneration can address the entry it supersedes.
 */

import type { BeanpodFileV4, RecoveryKeyPackage } from '@/types/syncFileV4';
import type { ISODateString } from '@/types/models';
import { unwrapFamilyKey, wrapFamilyKey, SALT_LENGTH } from '@/services/crypto/familyKeyService';
import { slotTombstoneEntryKey } from '@/services/sync/envelopeMerge';
import { toISODateString } from '@/utils/date';
import { shareableOrigin } from '@/utils/shareableOrigin';
import { KIT_LINK_HASH, readHashMarker } from '@/services/auth/deepLinks';

/** Crockford base32 — no I, L, O, U; unambiguous to read back from paper. */
// eslint-disable-next-line no-secrets/no-secrets -- a PUBLIC alphabet constant, not a secret
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_BYTES = 20; // 160 bits → 32 base32 chars → 8 groups of 4
const GROUP = 4;
const PBKDF2_ITERATIONS = 100_000; // parity with invite derivation; entropy carries the load

export interface GeneratedKit {
  /** Non-secret id printed on the kit (8 hex chars). */
  kitId: string;
  /** The formatted secret code — show once, never persist. */
  code: string;
  /** The envelope entry to store under `recoveryKeys[kitId]`. */
  pkg: RecoveryKeyPackage;
}

function bytesToBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function formatCode(raw: string): string {
  return raw.match(new RegExp(`.{1,${GROUP}}`, 'g'))!.join('-');
}

/**
 * Normalize a typed/scanned code: uppercase, strip separators, and map the characters
 * Crockford treats as aliases (O→0, I/L→1) so a faithful transcription always redeems.
 */
export function normalizeKitCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

async function deriveKitKey(code: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(code),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-KW', length: 256 },
    false,
    ['wrapKey', 'unwrapKey']
  );
}

/** Generate a kit and its envelope wrap for the given family key. */
export async function generateRecoveryKit(familyKey: CryptoKey): Promise<GeneratedKit> {
  const codeRaw = bytesToBase32(crypto.getRandomValues(new Uint8Array(CODE_BYTES)));
  const kitId = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const wrapKey = await deriveKitKey(codeRaw, salt);
  const wrapped = await wrapFamilyKey(familyKey, wrapKey);
  return {
    kitId,
    code: formatCode(codeRaw),
    pkg: {
      salt: btoa(String.fromCharCode(...salt)),
      wrapped,
      createdAt: toISODateString(new Date()),
    },
  };
}

// The marker and the extraction now live in the deep-link registry, so the kit is not the
// only thing that knows the shape of a beanies deep link. Re-exported because the constant
// is part of this module's existing surface.
export { KIT_LINK_HASH } from '@/services/auth/deepLinks';

/**
 * The QR content: a deep link, so a phone camera pointed at the printed kit opens the
 * app straight into recovery with the code pre-filled. The code lives in the URL
 * fragment — fragments never leave the browser.
 */
export function kitDeepLink(code: string): string {
  // ⚠️ `shareableOrigin()`, never `window.location.origin`. This string is printed into a QR
  // code that a DIFFERENT device's camera scans — the canonical "built here, opened
  // elsewhere" case. Generated inside the iOS shell, `location.origin` is
  // `capacitor://app.beanies.family`, so the printed kit encoded a private scheme and a
  // phone pointed at it opened nothing at all. The fallback is unchanged.
  return `${shareableOrigin()}/welcome#${KIT_LINK_HASH}${encodeURIComponent(code)}`;
}

/**
 * Accept a scanned QR payload OR a hand-typed code: extract the kit code either way.
 *
 * `readHashMarker` returning `null` is what distinguishes the two — a string with no
 * marker in it is a code the user typed, and is passed through untouched.
 */
export function parseKitInput(text: string): string {
  return readHashMarker(text, KIT_LINK_HASH) ?? text;
}

export type KitRedeemResult =
  | { ok: true; familyKey: CryptoKey; kitId: string }
  | { ok: false; reason: 'no-kits' | 'wrong-code' | 'error' };

/** One row of the Manage Kits list (tracker #99). */
export type RecoveryKitSummary =
  | { kitId: string; status: 'live'; createdAt: ISODateString; createdBy?: string }
  | { kitId: string; status: 'invalidated'; revokedAt: ISODateString; revokedBy?: string };

/**
 * Every kit the envelope knows about: live ones from `recoveryKeys`, invalidated ones
 * from their `recoveryKeys:<kitId>` slot tombstones. Live first, then invalidated, each
 * newest first. Pure and Pinia-free, so the store computed, the store's last-kit guard
 * and the sign-in view all read one definition.
 *
 * A revoked kit's package is gone by the time this runs (`applyRevokedKeys` drops it), so
 * an invalidated row carries only what the tombstone holds.
 */
export function summarizeRecoveryKits(
  envelope: Pick<BeanpodFileV4, 'recoveryKeys' | 'revokedKeys'>
): RecoveryKitSummary[] {
  const live: RecoveryKitSummary[] = Object.entries(envelope.recoveryKeys ?? {}).map(
    ([kitId, pkg]) => ({
      kitId,
      status: 'live',
      createdAt: pkg.createdAt,
      ...(pkg.createdBy ? { createdBy: pkg.createdBy } : {}),
    })
  );
  const invalidated: RecoveryKitSummary[] = [];
  for (const [key, tombstone] of Object.entries(envelope.revokedKeys ?? {})) {
    const kitId = slotTombstoneEntryKey('recoveryKeys', key);
    if (!kitId) continue;
    invalidated.push({
      kitId,
      status: 'invalidated',
      revokedAt: tombstone.revokedAt,
      ...(tombstone.revokedBy ? { revokedBy: tombstone.revokedBy } : {}),
    });
  }
  const newestFirst = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);
  live.sort((a, b) => newestFirst(stampOf(a), stampOf(b)));
  invalidated.sort((a, b) => newestFirst(stampOf(a), stampOf(b)));
  return [...live, ...invalidated];
}

function stampOf(kit: RecoveryKitSummary): string {
  return kit.status === 'live' ? kit.createdAt : kit.revokedAt;
}

/**
 * Redeem a kit code against an envelope: tries every `recoveryKeys` entry. An entry
 * stays valid until a `recoveryKeys:<kitId>` slot tombstone retires it (tracker #99);
 * revoked wraps are filtered out of every envelope before this function is reached, so
 * an invalidated kit fails here as `wrong-code` (or `no-kits`).
 */
export async function redeemRecoveryKit(
  envelope: Pick<BeanpodFileV4, 'recoveryKeys'>,
  input: string
): Promise<KitRedeemResult> {
  const entries = Object.entries(envelope.recoveryKeys ?? {});
  if (entries.length === 0) return { ok: false, reason: 'no-kits' };
  const code = normalizeKitCode(input);
  try {
    for (const [kitId, pkg] of entries) {
      try {
        const salt = Uint8Array.from(atob(pkg.salt), (c) => c.charCodeAt(0));
        const wrapKey = await deriveKitKey(code, salt);
        const familyKey = await unwrapFamilyKey(pkg.wrapped, wrapKey);
        return { ok: true, familyKey, kitId };
      } catch {
        // Not this entry — try the next (multiple kits can coexist by design).
      }
    }
    return { ok: false, reason: 'wrong-code' };
  } catch {
    return { ok: false, reason: 'error' };
  }
}
