/**
 * Seal and open against the REAL `ehbp`, with a real HPKE keypair. Nothing here is mocked.
 *
 * ⚠️ WHY THIS FILE EXISTS, AND WHY IT IS SEPARATE FROM `seal.test.ts`.
 *
 * `seal.test.ts` stubs `ehbp` and says so, on the reasonable grounds that the cryptography is
 * the library's to test. The gap that left is not the cryptography — it is whether OUR ADAPTER
 * DRIVES THE REAL API AT ALL. Nothing in this repo did.
 *
 * That gap has already cost a release. The sealed body omitted `model`, which the enclave
 * rejects outright, and the feature was 100% broken while every test passed — because
 * `sealForEnclave` was mocked and its payload never asserted. The plan it was built from also
 * assumed free `seal()`/`open()` functions that do not exist; the real API is an `Identity`.
 * A stub is shaped like whatever we believed on the day we wrote it, so a stub can never catch
 * either kind of mistake.
 *
 * So: a real keypair, a real seal, a real response encrypted with the library's own primitives
 * and the framing its own reader expects, and a real open. If `ehbp`'s API moves under us, or
 * our adapter misuses it, this is the test that goes red.
 */
import { describe, expect, it } from 'vitest';
import {
  Identity,
  PROTOCOL,
  bytesToHex,
  deriveResponseKeys,
  encryptChunk,
  extractSessionRecoveryToken,
} from 'ehbp';
import { openSealed, sealForEnclave, selectEhbpHeaders } from '../seal';
import { EXTRACTION_TASKS } from '../../extractionPrompt';
// @ts-expect-error — plain JS Lambda source, imported for parity rather than restated. Hardcoding
// the tolerance here is the exact anti-pattern this change removed from lambdaContractParity.
import { GRANT_BYTES_TOLERANCE } from '../../../../../infrastructure/lambda/ai-extract/correctionGrant.mjs';

/** The body shape the provider actually seals — `model` included, which is the point. */
const PAYLOAD = {
  model: 'gemma4-31b',
  messages: [{ role: 'user', content: 'Ollie party Sat 2pm at the hall' }],
  temperature: 0,
};

/**
 * Encrypt a reply the way the enclave would, so `openSealed` has something real to open.
 *
 * The framing is the library's own and is not negotiable: a 4-byte big-endian length, then the
 * AEAD chunk (`createDecryptStream` in ehbp's identity.js). Written out rather than guessed.
 */
async function encryptReplyAsEnclaveWould(
  context: Awaited<ReturnType<typeof sealForEnclave>>['context'],
  body: unknown
) {
  const token = await extractSessionRecoveryToken(context);
  const responseNonce = crypto.getRandomValues(new Uint8Array(32));
  const km = await deriveResponseKeys(token.exportedSecret, token.requestEnc, responseNonce);
  const chunk = await encryptChunk(km, 0, new TextEncoder().encode(JSON.stringify(body)));

  const framed = new Uint8Array(4 + chunk.length);
  new DataView(framed.buffer).setUint32(0, chunk.length, false);
  framed.set(chunk, 4);

  return {
    framed,
    headers: { [PROTOCOL.RESPONSE_NONCE_HEADER]: bytesToHex(responseNonce) },
  };
}

describe('seal/open against the real ehbp (#49)', () => {
  it('produces genuine ciphertext, not a passthrough', async () => {
    const server = await Identity.generate();
    const sealed = await sealForEnclave(await server.getPublicKeyHex(), PAYLOAD);

    const asText = new TextDecoder().decode(sealed.ciphertext);
    // The assertion that would have caught a stub silently returning its input.
    expect(asText).not.toContain('gemma4-31b');
    expect(asText).not.toContain('Ollie party');
    expect(sealed.ciphertext.length).toBeGreaterThan(0);
  });

  it('carries the encapsulated-key header the protocol actually names', async () => {
    const server = await Identity.generate();
    const sealed = await sealForEnclave(await server.getPublicKeyHex(), PAYLOAD);

    // Lower-cased because `Headers` normalises, and the Lambda relays by `ehbp-*` prefix.
    const names = Object.keys(sealed.headers).map((n) => n.toLowerCase());
    expect(names).toContain(PROTOCOL.ENCAPSULATED_KEY_HEADER.toLowerCase());
  });

  it('keeps the PLAINTEXT content type, which EHBP leaves in cleartext on purpose', async () => {
    const server = await Identity.generate();
    const sealed = await sealForEnclave(await server.getPublicKeyHex(), PAYLOAD);

    // Overriding this with a binary type risks a 415 from the enclave's inner
    // /v1/chat/completions handler, which still needs to know it is being handed JSON.
    expect(sealed.contentType).toMatch(/^application\/json/);
  });

  it('round-trips a reply end to end', async () => {
    const server = await Identity.generate();
    const sealed = await sealForEnclave(await server.getPublicKeyHex(), PAYLOAD);

    const reply = { choices: [{ message: { content: '{"kind":"event"}' } }] };
    const { framed, headers } = await encryptReplyAsEnclaveWould(sealed.context, reply);

    expect(await openSealed(sealed.context, framed, headers)).toEqual(reply);
  });

  it('fails CLOSED on a tampered reply, with no slice of the payload in the message', async () => {
    const server = await Identity.generate();
    const sealed = await sealForEnclave(await server.getPublicKeyHex(), PAYLOAD);

    const reply = { choices: [{ message: { content: 'secret-model-output' } }] };
    const { framed, headers } = await encryptReplyAsEnclaveWould(sealed.context, reply);
    framed[framed.length - 1] ^= 0xff; // flip a bit in the AEAD tag

    await expect(openSealed(sealed.context, framed, headers)).rejects.toMatchObject({
      code: 'malformed_output',
      // Static message, cause in `cause` only: a decryption or JSON error can quote model output
      // derived from the family's document, and free-form text must never reach the firehose.
      message: 'Could not open the AI enclave response',
    });
  });

  it('refuses a reply with no response nonce, naming the header rather than the crypto', async () => {
    const server = await Identity.generate();
    const sealed = await sealForEnclave(await server.getPublicKeyHex(), PAYLOAD);
    const { framed } = await encryptReplyAsEnclaveWould(sealed.context, { ok: true });

    // The symptom otherwise reads as a decryption bug and sends the next reader after the
    // cryptography, when the real fault is a header our own proxy failed to relay.
    await expect(openSealed(sealed.context, framed, {})).rejects.toMatchObject({
      code: 'malformed_output',
    });
  });

  it('keeps a correction re-read inside the grant size band', async () => {
    // ⚠️ THE SAME BUG CLASS THAT BIT THE LEGACY ARM, checked here on purpose.
    //
    // A correction grant bands the re-read's measured size within ±5% of the paid read's
    // (`GRANT_BYTES_TOLERANCE`). On the sealed arm the measurement is the CIPHERTEXT length, and
    // the correction re-read is NOT identical to the paid one: `request.correction.to` is
    // threaded into `buildMessages`, so the hinted prompt is longer and seals larger.
    //
    // ⚠️ It must use the REAL builder. A first draft of this test sealed a toy two-line payload
    // and failed — correctly — because a 48-character hint really is more than 5% of a tiny
    // body. That is the whole point: the sealed arm is safe ONLY because every sealed body
    // carries the full prompt scaffolding, a ~14KB floor that makes the hint a rounding error.
    // The legacy arm had no floor, which is exactly why measuring its raw request body broke
    // every short-text correction. If anyone ever shrinks what gets sealed, this goes red.
    const server = await Identity.generate();
    const pub = await server.getPublicKeyHex();
    const source = { kind: 'text' as const, text: 'Ollie party Sat 2pm at the hall' };
    const today = '2026-09-16';

    const sealOf = async (hint?: 'event' | 'travel' | 'recipe') =>
      (
        await sealForEnclave(pub, {
          model: 'gemma4-31b',
          messages: EXTRACTION_TASKS.share.buildMessages(source, today, { kindHint: hint }),
          temperature: 0,
        })
      ).ciphertext.length;

    const paid = await sealOf();
    const TOLERANCE = GRANT_BYTES_TOLERANCE;

    // `transactions` is left out on purpose: a re-read as a statement is never a free
    // correction (it costs a bean per page), so it never carries a grant to be sized against.
    for (const hint of ['event', 'travel', 'recipe'] as const) {
      const reread = await sealOf(hint);
      expect(
        Math.abs(reread - paid) <= paid * TOLERANCE,
        `a '${hint}' re-read sealed to ${reread} against a band built from ${paid} — ` +
          'the grant would be refused and the family charged for a free correction'
      ).toBe(true);
    }
  });

  describe('selectEhbpHeaders — the response-leg policy, observable at last', () => {
    // ⚠️ These assert the PURE function, not `openSealed`'s outcome, and that is the point.
    // Inside `openSealed` every one of these rules produces the same `malformed_output`, so a
    // test written against that surface cannot tell the policy from its absence: four such
    // tests all passed with the entire policy reverted to a naive `Object.entries` loop.
    const NONCE = 'ehbp-response-nonce';

    it('rejects a non-object rather than enumerating it character by character', () => {
      for (const bad of ['a-long-string', ['x'], 42, null, undefined]) {
        expect(() => selectEhbpHeaders(bad), `accepted ${JSON.stringify(bad)}`).toThrow();
      }
    });

    it('keeps ehbp-* and drops everything else', () => {
      expect(selectEhbpHeaders({ [NONCE]: 'ab', 'content-type': 'x', other: 'y' })).toEqual([
        [NONCE, 'ab'],
      ]);
    });

    it('drops a value Headers.set would throw on, instead of failing the whole read', () => {
      const CR = String.fromCharCode(13);
      const kept = selectEhbpHeaders({
        [NONCE]: 'ab',
        'ehbp-unicode': 'caf\u00e9\u4e2d',
        'ehbp-control': `a${CR}b`,
        'ehbp-nonstring': 42,
      });
      // The nonce survives; the three that would throw are gone. Losing the nonce would mean a
      // reply that cannot be opened at all, AFTER the bean was spent.
      expect(kept).toEqual([[NONCE, 'ab']]);
    });

    it('does not let junk keys starve the nonce out of the count bound', () => {
      const junk = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`other-${i}`, 'x']));
      // Counting every own property before the prefix test would exhaust the budget on junk and
      // never reach the nonce, which is listed last here on purpose.
      expect(selectEhbpHeaders({ ...junk, [NONCE]: 'ab' })).toEqual([[NONCE, 'ab']]);
    });

    it('bounds how many it will keep', () => {
      const many = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`ehbp-${i}`, 'x']));
      expect(selectEhbpHeaders(many).length).toBeLessThanOrEqual(64);
    });
  });

  describe('openSealed hardens the response leg', () => {
    // ⚠️ ALL of this shipped with ZERO coverage while the Lambda's mirror-image fix got three
    // handler tests. Mutation-proven by review: reverting the whole guarded block to the naive
    // `Object.entries(responseHeaders || {})` left the suite at 65 passed / 0 failed. These
    // headers come straight off the network — typed `Record<string, string>` and never checked —
    // and every failure here lands AFTER the bean is spent.
    async function sealedReply() {
      const server = await Identity.generate();
      const sealed = await sealForEnclave(await server.getPublicKeyHex(), PAYLOAD);
      const reply = { choices: [{ message: { content: '{"kind":"none"}' } }] };
      const { framed, headers } = await encryptReplyAsEnclaveWould(sealed.context, reply);
      return { sealed, framed, headers, reply };
    }

    it('rejects a non-object `ehbp` instead of enumerating it character by character', async () => {
      const { sealed, framed } = await sealedReply();
      // `Object.entries` on a string builds one [index, char] pair per character before the loop
      // body runs — the allocation that killed the 256MB Lambda, here on a phone's main thread.
      for (const bad of ['a-long-string', ['x'], 42]) {
        await expect(
          openSealed(sealed.context, framed, bad as unknown as Record<string, string>)
        ).rejects.toMatchObject({ code: 'malformed_output' });
      }
    });

    it('does not let junk keys starve the nonce out of the budget', async () => {
      const { sealed, framed, headers, reply } = await sealedReply();
      const junk = Object.fromEntries(
        Array.from({ length: 200 }, (_, i) => [`not-ehbp-${i}`, 'x'])
      );
      // The nonce is LAST, after 200 non-ehbp keys. Counting every own property would exhaust
      // the bound before reaching it — and the bean is already spent by this point.
      expect(await openSealed(sealed.context, framed, { ...junk, ...headers })).toEqual(reply);
    });

    it('skips a header value Headers.set would throw on, rather than failing the read', async () => {
      const { sealed, framed, headers, reply } = await sealedReply();
      expect(
        await openSealed(sealed.context, framed, { ...headers, 'ehbp-junk': 'caf\u00e9\u4e2d' })
      ).toEqual(reply);
    });

    it('uses no ES2022 built-in the iOS 15.0 WebView lacks', async () => {
      // ⚠️ A SOURCE-level guard on purpose. Deleting `Object.hasOwn` at runtime was tried and is
      // the wrong test: other code in the stack uses it too, so the deletion fails for reasons
      // that are not ours and proves nothing about this module.
      //
      // The rule it encodes: the native build targets iOS 15.0
      // (`IPHONEOS_DEPLOYMENT_TARGET`), `Object.hasOwn` is ES2022 and therefore Safari 15.4+,
      // Vite's default target is safari14, and there is no browserslist and no core-js — and
      // esbuild lowers SYNTAX only, never built-in methods. So an ES2022 built-in here throws on
      // every sealed reply for an iOS 15.0–15.3 family, and the catch launders it into
      // "Could not open the AI enclave response", sending the reader after the cryptography.
      const fs = await import('node:fs/promises');
      const src = await fs.readFile('src/services/ai/enclave/seal.ts', 'utf-8');
      const code = src
        .split('\n')
        .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
        .join('\n');
      expect(code, 'use Object.prototype.hasOwnProperty.call instead').not.toMatch(
        /Object\.hasOwn\s*\(/
      );
    });
  });

  it('refuses a public key that is not one', async () => {
    await expect(sealForEnclave('not-a-hex-key', PAYLOAD)).rejects.toMatchObject({
      code: 'attestation_failed',
    });
  });
});
