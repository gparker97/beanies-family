/**
 * Seal a request body to the attested enclave, and open its reply (#49).
 *
 * A thin adapter over `ehbp`, whose real API is an `Identity` rather than the free
 * `seal()` / `open()` functions the plan assumed. `Identity.fromPublicKeyHex` is documented for
 * exactly our case: a client that already HOLDS the server's public key and does not need to fetch
 * it, because it got the key from a verified attestation.
 *
 * WHY WE DO NOT USE `ehbp`'s `Transport`. It performs the whole fetch itself, straight to the
 * server it fetched the key from. Our Tinfoil API key must stay server-side, so the request has to
 * go through our own Lambda instead. Sealing and sending are therefore separated here: this module
 * produces bytes, and the provider decides where they go.
 */

// ⚠️ TYPE-ONLY import. A VALUE import from 'ehbp' here (even one constant) pulls the whole
// package — hpke, @panva/hpke-noble, the lot — into whichever chunk this module lands in, which
// defeats every `await import('ehbp')` below and puts the crypto in the main bundle. The hpke
// implementation really was in the 3.2MB main chunk until this line changed.
//
// Types are erased, so `import type` is free.
//
// Enforced by `scripts/checkCryptoChunk.mjs`, which runs after the build in `npm run validate`.
// ⚠️ That script did not exist when this comment first claimed "caught by the build check" —
// the guarantee was asserted and unverified for the whole life of the feature, through two
// separate bundler regressions. It exists now; keep it wired into `validate`.
import type { RequestContext } from 'ehbp';
import { ExtractionProviderError } from '../types';

/** What a seal produces: the bytes to send, the headers that must travel with them, and the key to open the reply. */
export interface SealedRequest {
  ciphertext: Uint8Array;
  /** `ehbp-*` only. The Lambda relays these by prefix and drops everything else. */
  headers: Record<string, string>;
  /**
   * The Content-Type of the PLAINTEXT body, which EHBP deliberately preserves in cleartext.
   *
   * ⚠️ Not `application/octet-stream`. In EHBP the content type describes what is INSIDE the
   * envelope, not the envelope: `encryptRequestWithContext` copies the caller's headers verbatim,
   * and the response leg strips only `content-length`/`transfer-encoding` ("framing headers
   * describe the encrypted body"), pointedly not content-type. The enclave's inner
   * `/v1/chat/completions` handler still needs to know it is being handed JSON, so overriding
   * this with a binary type risks a 415 on every sealed request. The "framing" EHBP carries is
   * the length prefix inside the body, not the media type.
   */
  contentType: string;
  /** Opaque; hand it straight back to {@link openSealed}. Never serialise or log it. */
  context: RequestContext;
}

/**
 * The client's own bound on relayed reply headers.
 *
 * ⚠️ NOT a mirror of the Lambda's, and an earlier comment claiming it was is the reason this
 * one is explicit. The Lambda keeps at most 16 on the REQUEST leg, matches
 * `/^ehbp-[a-z0-9-]{1,48}$/i` and bounds value length; this side keeps 64 and matches a bare
 * `/^ehbp-/i`. They are deliberately different jobs — the Lambda is refusing what a client may
 * send upstream, this is tolerating what an upstream may send back — and a false "mirrors"
 * claim would make a tightening on one side look safe when it silently drops a header the
 * other requires.
 */
const MAX_RESPONSE_EHBP_HEADERS = 64;

/**
 * Which `ehbp-*` headers off the wire are safe to put into a `Headers` object, as a PURE
 * function over the raw value.
 *
 * ⚠️ EXTRACTED BECAUSE THE INLINE VERSION WAS UNTESTABLE, and that is the whole reason this
 * exists as a separate export. The rules lived inside `openSealed`'s try block, where the only
 * observable outcome of any of them is the same `malformed_output`. Four tests written against
 * that surface all passed when the entire policy was reverted to a naive
 * `Object.entries(...)` loop — mutation-proven twice. A guard whose effect cannot be observed
 * cannot be guarded.
 *
 * It is also environment-independent: `Headers.set` throws on a control character or a
 * codepoint above U+00FF in Node and in browsers, but a DOM shim in the test runner may not,
 * so a test that depends on that throw proves something about the shim rather than about us.
 *
 * The rules, and what each one costs if it is missing — every one of these lands AFTER the bean
 * has been spent, so none of them can be allowed to fail the read:
 *
 *  · not a plain object → reject. `Object.entries` on a string builds one [index, char] pair
 *    per character before any loop body runs: the allocation that killed the 256MB Lambda,
 *    here on the family's phone, on the main thread.
 *  · not `ehbp-*`, or not a string → skip. Nothing else belongs on the reply.
 *  · outside printable ASCII → skip. `Headers.set` throws on these, and that throw would be
 *    laundered into "could not open the response", pointing the reader at the cryptography.
 *  · past the count bound → stop. Counted AFTER the prefix test on purpose: counting every own
 *    property first lets junk keys starve `PROTOCOL.RESPONSE_NONCE_HEADER` out of the budget,
 *    and without the nonce the reply cannot be opened at all.
 */
export function selectEhbpHeaders(source: unknown): Array<[string, string]> {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error('ehbp headers are not an object');
  }
  const out: Array<[string, string]> = [];
  for (const name in source) {
    if (!Object.prototype.hasOwnProperty.call(source, name)) continue;
    if (!/^ehbp-/i.test(name)) continue;
    const value = (source as Record<string, unknown>)[name];
    if (typeof value !== 'string' || !/^[\x20-\x7e]*$/.test(value)) continue;
    if (out.length >= MAX_RESPONSE_EHBP_HEADERS) break;
    out.push([name, value]);
  }
  return out;
}

/** A URL is required to build a `Request`, but it is never fetched: the provider owns the send. */
const SEAL_PLACEHOLDER_URL = 'https://enclave.invalid/v1/chat/completions';

/**
 * Encrypt `payload` to the enclave's attested HPKE public key.
 *
 * @param hpkePublicKey hex, straight from `verifyEnclave()`. Never from a response header.
 */
export async function sealForEnclave(
  hpkePublicKey: string,
  payload: unknown
): Promise<SealedRequest> {
  const { Identity } = await import('ehbp');

  let sealed: { request: Request; context: RequestContext | null };
  try {
    const identity = await Identity.fromPublicKeyHex(hpkePublicKey);
    const request = new Request(SEAL_PLACEHOLDER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    sealed = await identity.encryptRequestWithContext(request);
  } catch (err) {
    // A seal that fails must never fall through to sending plaintext, so this throws rather than
    // returning anything a caller could mistake for a body.
    throw new ExtractionProviderError(
      'attestation_failed',
      'Could not encrypt the document to the AI enclave',
      err
    );
  }

  if (!sealed.context) {
    // No context means no way to open the reply, which would strand the user mid-extraction with
    // a charged bean and nothing to show. Refuse before sending rather than after.
    throw new ExtractionProviderError(
      'attestation_failed',
      'The AI enclave encryption produced no response context'
    );
  }

  const headers: Record<string, string> = {};
  for (const [name, value] of sealed.request.headers.entries()) {
    if (/^ehbp-/i.test(name)) headers[name] = value;
  }

  return {
    ciphertext: new Uint8Array(await sealed.request.arrayBuffer()),
    headers,
    contentType: sealed.request.headers.get('content-type') || 'application/json',
    context: sealed.context,
  };
}

/**
 * Decrypt the enclave's reply and return its parsed JSON envelope.
 *
 * `responseHeaders` must carry the `ehbp-*` headers the Lambda relayed back, in particular
 * `PROTOCOL.RESPONSE_NONCE_HEADER`: without it the reply cannot be opened at all.
 */
export async function openSealed(
  context: RequestContext,
  ciphertext: Uint8Array,
  responseHeaders: Record<string, string>
): Promise<unknown> {
  const { Identity, PROTOCOL } = await import('ehbp');

  try {
    const headers = new Headers();
    for (const [name, value] of selectEhbpHeaders(responseHeaders)) headers.set(name, value);
    if (!headers.has(PROTOCOL.RESPONSE_NONCE_HEADER)) {
      // Named explicitly because the symptom otherwise reads as a decryption failure, sending the
      // next reader after the crypto when the real fault is a header the proxy did not relay.
      throw new Error(`missing ${PROTOCOL.RESPONSE_NONCE_HEADER}`);
    }
    // `decryptResponseWithContext` is an Identity method, but the request context carries the
    // sender state, so the identity it is called on is irrelevant to the result.
    const identity = await Identity.generate();
    const plain = await identity.decryptResponseWithContext(
      // `.slice()` yields a plain ArrayBuffer, which BodyInit accepts; a Uint8Array view over
      // a possibly-SharedArrayBuffer does not satisfy the DOM types.
      new Response(ciphertext.slice().buffer as ArrayBuffer, { headers }),
      context
    );
    return await plain.json();
  } catch (err) {
    // ⚠️ STATIC message, cause in the `cause` slot only. A decryption or JSON failure here can
    // quote model output derived from the family's document, and a free-form detail must never
    // reach the telemetry firehose. Same rule `parseChatCompletion` follows.
    throw new ExtractionProviderError(
      'malformed_output',
      'Could not open the AI enclave response',
      err
    );
  }
}
