/**
 * Invite Service — token-based family key sharing for new members.
 *
 * Flow:
 * 1. Owner generates an invite token (32 random bytes → base64url).
 * 2. Token is used to derive an AES-KW key (PBKDF2 with raw token bytes).
 * 3. The family key is wrapped with that key and stored in the .beanpod file
 *    keyed by SHA-256(token) so the raw token is never persisted.
 * 4. New member opens the invite link, enters the token, unwraps the FK,
 *    then re-wraps it with their own password.
 * 5. Invite packages expire after 24 hours.
 */

import { bufferToBase64url, base64urlToBuffer } from '@/utils/encoding';
import { SALT_LENGTH, wrapFamilyKey, unwrapFamilyKey } from '@/services/crypto/familyKeyService';

const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH = 256;
const WRAPPING_ALGO = 'AES-KW';
const INVITE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Token generation ────────────────────────────────────────────────

/** Generate a cryptographically random invite token (base64url, 43 chars). */
export function generateInviteToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bufferToBase64url(bytes);
}

// ── Key derivation ──────────────────────────────────────────────────

/**
 * Derive an AES-KW wrapping key from an invite token.
 * Uses raw token bytes (full 256-bit entropy) as PBKDF2 input.
 */
export async function deriveInviteKey(token: string, salt: Uint8Array): Promise<CryptoKey> {
  const tokenBytes = base64urlToBuffer(token);

  const keyMaterial = await crypto.subtle.importKey('raw', tokenBytes, 'PBKDF2', false, [
    'deriveBits',
    'deriveKey',
  ]);

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: WRAPPING_ALGO, length: KEY_LENGTH },
    false,
    ['wrapKey', 'unwrapKey']
  );
}

// ── Invite package creation / redemption ────────────────────────────

export interface InvitePackage {
  salt: string; // base64url
  wrapped: string; // base64 (AES-KW wrapped FK)
  expiresAt: string; // ISO 8601
}

/**
 * Wrap the family key for an invite link.
 * Returns the package to store in the .beanpod file.
 */
export async function createInvitePackage(
  familyKey: CryptoKey,
  token: string
): Promise<InvitePackage> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const wrappingKey = await deriveInviteKey(token, salt);
  const wrapped = await wrapFamilyKey(familyKey, wrappingKey);
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_MS).toISOString();

  return {
    salt: bufferToBase64url(salt),
    wrapped,
    expiresAt,
  };
}

/**
 * Redeem an invite token to recover the family key.
 * Returns an extractable CryptoKey.
 */
export async function redeemInviteToken(
  wrapped: string,
  salt: string,
  token: string
): Promise<CryptoKey> {
  const saltBytes = new Uint8Array(base64urlToBuffer(salt));
  const unwrappingKey = await deriveInviteKey(token, saltBytes);
  return unwrapFamilyKey(wrapped, unwrappingKey);
}

// ── Token hashing (storage key) ─────────────────────────────────────

/** Hash an invite token with SHA-256. Returns base64url (storage key). */
export async function hashInviteToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return bufferToBase64url(hash);
}

// ── Link building ───────────────────────────────────────────────────

/**
 * Canonical shape of a beanies.family invite/join URL. Single source of
 * truth — both `buildInviteLink` (inviter side) and `parseInviteLink`
 * (joiner side) consume this. Adding a new optional field is the only
 * way to extend the URL contract.
 */
export interface InviteLinkParams {
  /** Invite token (omit for a base join URL with no key-wrapping). */
  token?: string;
  /** Family ID — required. */
  familyId: string;
  /** Storage provider ('local' or 'google_drive'). */
  provider?: 'google_drive' | 'local';
  /** File name (will be base64-encoded into the `ref` param). */
  fileName?: string;
  /** Google Drive file ID. */
  fileId?: string;
  /**
   * Invitee's email — used as a Google `login_hint` on the joiner's
   * OAuth flow so multi-account users land in the correct inbox.
   * Plain-text in the URL (mild PII per yesterday's threat model:
   * the invite token is the bigger concern if the link leaks).
   */
  inviteeEmail?: string;
}

/**
 * Build a full beanies.family join URL. Param naming matches the
 * existing wire format that `JoinPodView.onMounted` parses today
 * (`fam=`, `p=`, `ref=`, `fileId=`, `t=`, plus new `hint=`). Returns
 * a non-hash-routed URL (matches the production share-modal output).
 */
export function buildInviteLink(params: InviteLinkParams): string {
  const origin = globalThis.location?.origin ?? 'https://beanies.family';
  const search = new URLSearchParams();
  search.set('fam', params.familyId);
  if (params.provider) search.set('p', params.provider);
  if (params.fileName) search.set('ref', encodeBase64(params.fileName));
  if (params.fileId) search.set('fileId', params.fileId);
  if (params.token) search.set('t', params.token);
  if (params.inviteeEmail) search.set('hint', encodeBase64(params.inviteeEmail));
  return `${origin}/join?${search.toString()}`;
}

/**
 * Parse a beanies.family join URL into its components. Returns null if
 * the URL is malformed or missing a familyId. Accepts hash-routed URLs
 * (`/#/join?...`) and plain-path URLs (`/join?...`) for backward
 * compatibility, and accepts both `f=` and `fam=` for the family
 * parameter.
 */
export function parseInviteLink(url: string): InviteLinkParams | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  // Honor either plain `?…` query or hash-route `#/path?…` query.
  let qs = parsed.search;
  if (!qs && parsed.hash) {
    const hash = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash;
    const qIdx = hash.indexOf('?');
    qs = qIdx >= 0 ? hash.slice(qIdx) : '';
  }
  const sp = new URLSearchParams(qs);

  const familyId = sp.get('fam') || sp.get('f') || sp.get('code');
  if (!familyId) return null;

  const result: InviteLinkParams = { familyId };

  const token = sp.get('t');
  if (token) result.token = token;

  const provider = sp.get('p');
  if (provider === 'google_drive' || provider === 'local') result.provider = provider;

  const fileNameEncoded = sp.get('ref');
  if (fileNameEncoded) {
    const decoded = decodeBase64(fileNameEncoded);
    if (decoded) result.fileName = decoded;
  }

  const fileId = sp.get('fileId');
  if (fileId) result.fileId = fileId;

  const hintEncoded = sp.get('hint');
  if (hintEncoded) {
    const decoded = decodeBase64(hintEncoded);
    if (decoded) result.inviteeEmail = decoded;
  }

  return result;
}

/** Plain base64 — matches the existing `ref=btoa(fileName)` wire format. */
function encodeBase64(input: string): string {
  return btoa(unescape(encodeURIComponent(input)));
}

/** Plain base64 decode. Returns null on malformed input rather than throwing. */
function decodeBase64(input: string): string | null {
  try {
    return decodeURIComponent(escape(atob(input)));
  } catch {
    return null;
  }
}

// ── Expiry check ────────────────────────────────────────────────────

/** Check whether an invite package has expired. */
export function isInviteExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() <= Date.now();
}
