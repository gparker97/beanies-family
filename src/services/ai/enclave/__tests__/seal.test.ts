/**
 * Sealing and opening, against a stubbed `ehbp`.
 *
 * What is worth asserting here is the CONTRACT with the rest of the app, not the cryptography —
 * `ehbp` owns that and has its own tests. Specifically: that a failure can never be mistaken for a
 * body, that the plaintext Content-Type survives (EHBP keeps it in cleartext deliberately), and
 * that a decryption failure carries no slice of model output into a user- or telemetry-visible
 * string.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const encryptRequestWithContext = vi.fn();
const decryptResponseWithContext = vi.fn();
const fromPublicKeyHex = vi.fn();
const generate = vi.fn();

vi.mock('ehbp', () => ({
  PROTOCOL: { RESPONSE_NONCE_HEADER: 'Ehbp-Response-Nonce' },
  Identity: {
    fromPublicKeyHex: (hex: string) => fromPublicKeyHex(hex),
    generate: () => generate(),
  },
}));

let mod: typeof import('../seal');

/** A sealed Request as ehbp would hand it back: protocol header added, caller's headers kept. */
function sealedRequest() {
  return new Request('https://enclave.invalid/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Ehbp-Encapsulated-Key': 'KEY',
    },
    body: 'ciphertext-bytes',
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  fromPublicKeyHex.mockResolvedValue({ encryptRequestWithContext });
  generate.mockResolvedValue({ decryptResponseWithContext });
  mod = await import('../seal');
});
afterEach(() => vi.restoreAllMocks());

describe('sealForEnclave', () => {
  it('returns the ciphertext, the protocol headers, and the response context', async () => {
    encryptRequestWithContext.mockResolvedValue({
      request: sealedRequest(),
      context: { marker: 'ctx' },
    });

    const out = await mod.sealForEnclave('deadbeef', { model: 'm', messages: [] });

    expect(fromPublicKeyHex).toHaveBeenCalledWith('deadbeef');
    expect(out.headers['Ehbp-Encapsulated-Key']).toBe('KEY');
    expect(out.ciphertext.byteLength).toBeGreaterThan(0);
    expect(out.context).toEqual({ marker: 'ctx' });
  });

  it('keeps the PLAINTEXT Content-Type, which EHBP preserves in cleartext on purpose', async () => {
    encryptRequestWithContext.mockResolvedValue({
      request: sealedRequest(),
      context: { marker: 'ctx' },
    });

    const out = await mod.sealForEnclave('deadbeef', {});

    // The content type describes what is INSIDE the envelope, not the envelope. The enclave's
    // inner /v1/chat/completions handler still has to know it is being handed JSON; overriding
    // this with a binary type risks a 415 on every sealed request.
    expect(out.contentType).toBe('application/json');
    // ...and it is NOT smuggled into the relayed header map, which is ehbp-* only.
    expect(Object.keys(out.headers)).toEqual(['Ehbp-Encapsulated-Key']);
  });

  it('THROWS rather than returning anything a caller could send as a body', async () => {
    encryptRequestWithContext.mockRejectedValue(new Error('hpke boom'));
    await expect(mod.sealForEnclave('deadbeef', {})).rejects.toMatchObject({
      code: 'attestation_failed',
    });
  });

  it('refuses when no response context comes back, rather than sending and stranding the user', async () => {
    encryptRequestWithContext.mockResolvedValue({ request: sealedRequest(), context: null });
    // Without a context the reply cannot be opened, so sending would charge a bean for an answer
    // the user can never see. Refuse before the send, not after.
    await expect(mod.sealForEnclave('deadbeef', {})).rejects.toMatchObject({
      code: 'attestation_failed',
    });
  });
});

describe('openSealed', () => {
  const ctx = { marker: 'ctx' } as never;

  it('decrypts and parses the enclave envelope', async () => {
    decryptResponseWithContext.mockResolvedValue(new Response(JSON.stringify({ choices: [] })));
    const out = await mod.openSealed(ctx, new Uint8Array([1, 2, 3]), {
      'ehbp-response-nonce': 'n',
    });
    expect(out).toEqual({ choices: [] });
  });

  it('names the missing nonce, so the fault is not mistaken for a crypto failure', async () => {
    // Without this the symptom reads as "decryption broke", sending the next reader after the
    // cryptography when the real fault is a header the proxy did not relay.
    await expect(mod.openSealed(ctx, new Uint8Array([1]), {})).rejects.toMatchObject({
      code: 'malformed_output',
    });
    expect(decryptResponseWithContext).not.toHaveBeenCalled();
  });

  it('never lets model output reach the thrown MESSAGE', async () => {
    // V8's JSON.parse SyntaxError quotes a slice of its input, and on this path that input is
    // derived from the family's document. The cause belongs in `cause`, never in a string that a
    // toast or the telemetry firehose could render.
    const secret = 'Ollie birthday party at 14 Mulberry Lane';
    decryptResponseWithContext.mockResolvedValue(new Response(secret));

    const err = (await mod
      .openSealed(ctx, new Uint8Array([1]), { 'ehbp-response-nonce': 'n' })
      .catch((e: unknown) => e)) as Error;

    expect(err.message).not.toContain('Mulberry');
    expect(err.message).toBe('Could not open the AI enclave response');
  });
});
