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
// defeats every `await import('ehbp')` below and puts the crypto in the main bundle. Caught by
// the build check: the hpke implementation was in the 3.2MB main chunk until this line changed.
// Types are erased, so `import type` is free.
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
    for (const [name, value] of Object.entries(responseHeaders || {})) {
      if (/^ehbp-/i.test(name)) headers.set(name, value);
    }
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
