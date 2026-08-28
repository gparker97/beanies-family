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
import { unwrapFamilyKey, wrapFamilyKey, SALT_LENGTH } from '@/services/crypto/familyKeyService';
import { toISODateString } from '@/utils/date';

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

/** Hash marker for the kit deep link — the code rides the FRAGMENT (never sent to a server). */
export const KIT_LINK_HASH = 'beanies-kit=';

/**
 * The QR content: a deep link, so a phone camera pointed at the printed kit opens the
 * app straight into recovery with the code pre-filled. The code lives in the URL
 * fragment — fragments never leave the browser.
 */
export function kitDeepLink(code: string): string {
  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://app.beanies.family';
  return `${origin}/welcome#${KIT_LINK_HASH}${encodeURIComponent(code)}`;
}

/** Accept a scanned QR payload OR a hand-typed code: extract the kit code either way. */
export function parseKitInput(text: string): string {
  const idx = text.indexOf(KIT_LINK_HASH);
  if (idx >= 0) {
    return decodeURIComponent(text.slice(idx + KIT_LINK_HASH.length).split(/[&?]/)[0] ?? '');
  }
  return text;
}

export type KitRedeemResult =
  | { ok: true; familyKey: CryptoKey; kitId: string }
  | { ok: false; reason: 'no-kits' | 'wrong-code' | 'error' };

/**
 * Redeem a kit code against an envelope: tries every `recoveryKeys` entry (old entries
 * stay valid until #117 rotation retires them — the same semantics as `wrappedKeys`).
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
