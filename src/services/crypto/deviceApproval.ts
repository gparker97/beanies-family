/**
 * Device approval: a cold device asks, a signed-in device answers.
 *
 * The case this exists for is the one the promoted mint cannot serve. "Sign in another
 * device" works when the device you already trust is the one you can mint from — but when
 * the COLD device is the laptop, it cannot mint anything, and the phone is the thing with
 * a camera. So the direction inverts: the laptop displays, the phone scans and approves.
 * That is the WhatsApp Web / Signal Desktop shape, and it is strictly better than asking a
 * laptop to drive a webcam or asking a person to paste a family credential through a chat.
 *
 * ## What is actually on screen
 *
 * The QR carries an ephemeral PUBLIC key and nothing else. Photographing it, screenshotting
 * it, or shoulder-surfing it gains an attacker nothing — there is no secret in it. All of
 * the authority is the approval tap on the already-trusted device, in front of a
 * fingerprint the two screens show identically so a person can compare them by eye.
 *
 * Contrast the magic link, where the QR *is* the credential. That difference is why this
 * one is safe to display on a laptop in a cafe and that one is not.
 *
 * ## Why ECDH P-256 and not something else
 *
 * No asymmetric primitive existed in this codebase — the HPKE in the tree belongs to the
 * AI enclave path (`@tinfoilsh/verifier`) and is bound to Tinfoil attestation, which would
 * be entirely wrong coupling for auth. So the only new thing here is the KEK derivation:
 * ECDH → HKDF → an AES-KW wrapping key, at which point it hands off to the SHIPPED
 * `wrapFamilyKey` / `unwrapFamilyKey`. It ends at the same AES-KW shape `deriveInviteKey`
 * does — a shared destination, not a copied recipe.
 *
 * P-256 rather than X25519 because Web Crypto support for X25519 is still uneven across
 * the targets this runs on (browsers plus both native WebViews), and a key agreement that
 * works on three platforms out of four is not a key agreement.
 *
 * ## The private key never leaves memory
 *
 * `generateKey` is called with `extractable: false`, so the cold device's private half
 * cannot be serialised by anything — not by us, not by a later bug, not by devtools. It
 * lives for the life of the pane and dies with it. A consequence worth knowing: a stale
 * approval sitting in the envelope is useless to everyone, including the person it was
 * written for, once they close the screen.
 */
import { bufferToBase64url, base64urlToBuffer, sha256Hex } from '@/utils/encoding';
import { wrapFamilyKey, unwrapFamilyKey } from '@/services/crypto/familyKeyService';

const CURVE = 'P-256';
const HKDF_SALT_BYTES = 32;

/** How long a displayed request stays valid. Long enough to walk to the other room. */
export const APPROVAL_EXPIRY_MS = 3 * 60 * 1000;

/** What the cold device holds while it waits. The private half is non-extractable. */
export interface ApprovalRequest {
  keyPair: CryptoKeyPair;
  /** base64url SPKI — this is what the QR carries, and it is not a secret. */
  publicKeyB64: string;
  /** SHA-256 of the public key, truncated. Both screens show it; a human compares them. */
  fingerprint: string;
  /** SHA-256 of the public key, full hex — the envelope entry names it. */
  publicKeyHash: string;
}

/**
 * Four uppercase hex characters of the public key's digest.
 *
 * Short enough to read aloud or compare at a glance, which is the entire job — a
 * fingerprint nobody compares is decoration. 16 bits is not a cryptographic binding and is
 * not doing that work: the binding is that the family key is wrapped TO this exact public
 * key, so an attacker who substitutes their own gets a wrap they cannot open unless they
 * also got the victim to approve it. The fingerprint defends the remaining case — someone
 * approving a request that is not the one in front of them.
 */
function fingerprintOf(hashHex: string): string {
  // SIX characters, not four. Four is 16 bits — an attacker who can see the displayed code
  // can grind matching keypairs in well under a second, which makes the one comparison the
  // design asks a person to perform look like it is working while it is not. Six is 256x
  // the work for exactly the same glance, so there is no usability argument for four.
  return hashHex.slice(0, 6).toUpperCase();
}

/** Cold device: mint the ephemeral pair it will show and wait on. */
export async function createApprovalRequest(): Promise<ApprovalRequest> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: CURVE },
    // ⚠️ NOT extractable. The private half must not be serialisable by anything.
    false,
    // `deriveBits`, not `deriveKey`: the ECDH step produces raw shared secret bytes which
    // are then imported as an HKDF key. Declaring `deriveKey` here instead throws
    // "baseKey does not have deriveBits usage" at the first exchange.
    ['deriveBits']
  );
  const spki = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  const publicKeyB64 = bufferToBase64url(spki);
  const publicKeyHash = await sha256Hex(publicKeyB64);
  return {
    keyPair,
    publicKeyB64,
    fingerprint: fingerprintOf(publicKeyHash),
    publicKeyHash,
  };
}

/** Approver side: what the scanned code resolves to, before anything is wrapped. */
export interface ScannedApproval {
  publicKey: CryptoKey;
  publicKeyB64: string;
  fingerprint: string;
  publicKeyHash: string;
}

/**
 * Approver: turn a scanned payload into a key we can wrap to.
 *
 * Throws on anything that is not a well-formed P-256 public key, because "import failed"
 * and "this is a different kind of QR" are the same user-facing answer — the code did not
 * work — and the caller reports it either way.
 */
export async function readApprovalRequest(publicKeyB64: string): Promise<ScannedApproval> {
  const publicKey = await crypto.subtle.importKey(
    'spki',
    base64urlToBuffer(publicKeyB64),
    { name: 'ECDH', namedCurve: CURVE },
    true,
    []
  );
  const publicKeyHash = await sha256Hex(publicKeyB64);
  return { publicKey, publicKeyB64, fingerprint: fingerprintOf(publicKeyHash), publicKeyHash };
}

/**
 * Both sides: ECDH → HKDF → an AES-KW wrapping key.
 *
 * The salt is generated by the approver and carried in the envelope entry, so both sides
 * derive the same KEK from (their own private key, the other's public key, that salt).
 */
async function deriveWrappingKey(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  saltB64: string
): Promise<CryptoKey> {
  const shared = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: publicKey },
    privateKey,
    256
  );
  const hkdfKey = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: base64urlToBuffer(saltB64),
      // Domain separation: this KEK must never collide with any other derivation in the
      // product, so the label names the exact purpose.
      info: new TextEncoder().encode('beanies-device-approval-v1'),
    },
    hkdfKey,
    { name: 'AES-KW', length: 256 },
    false,
    ['wrapKey', 'unwrapKey']
  );
}

/** What the approver writes into the envelope. Carries no secret the requester lacks. */
export interface ApprovalWrap {
  salt: string;
  wrapped: string;
  /** The approver's own ephemeral public key, so the requester can complete the ECDH. */
  approverPublicKey: string;
  publicKeyHash: string;
}

/**
 * Approver: wrap the family key so ONLY the holder of the scanned request's private key
 * can open it.
 *
 * A fresh ephemeral pair per approval, so two approvals never share a KEK and neither is
 * derivable from the other.
 */
export async function wrapForApproval(
  familyKey: CryptoKey,
  scanned: ScannedApproval
): Promise<ApprovalWrap> {
  const approverPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: CURVE }, false, [
    'deriveBits',
  ]);
  const salt = bufferToBase64url(crypto.getRandomValues(new Uint8Array(HKDF_SALT_BYTES)));
  const kek = await deriveWrappingKey(approverPair.privateKey, scanned.publicKey, salt);
  const wrapped = await wrapFamilyKey(familyKey, kek);
  const approverSpki = await crypto.subtle.exportKey('spki', approverPair.publicKey);
  return {
    salt,
    wrapped,
    approverPublicKey: bufferToBase64url(approverSpki),
    publicKeyHash: scanned.publicKeyHash,
  };
}

/**
 * Cold device: complete the exchange and recover the family key.
 *
 * Returns null when the entry is not for THIS request — a stale approval from an earlier
 * attempt, or one written for a different device entirely. Checking the hash rather than
 * trying and failing means the waiting screen does not report a crypto error for what is
 * simply someone else's entry.
 */
export async function unwrapApproval(
  request: ApprovalRequest,
  wrap: { salt: string; wrapped: string; approverPublicKey: string; publicKeyHash: string }
): Promise<CryptoKey | null> {
  if (wrap.publicKeyHash !== request.publicKeyHash) return null;
  const approverPublic = await crypto.subtle.importKey(
    'spki',
    base64urlToBuffer(wrap.approverPublicKey),
    { name: 'ECDH', namedCurve: CURVE },
    true,
    []
  );
  const kek = await deriveWrappingKey(request.keyPair.privateKey, approverPublic, wrap.salt);
  return unwrapFamilyKey(wrap.wrapped, kek);
}
