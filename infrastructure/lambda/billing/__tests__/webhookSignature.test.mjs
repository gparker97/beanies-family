/* global Buffer */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyStripeSignature,
  computeSignature,
  parseSignatureHeader,
  safeEqual,
} from '../webhookSignature.mjs';

const SECRET = 'whsec_test_secret';
const BODY = '{"id":"evt_1","type":"customer.subscription.updated"}';
const NOW = 1_800_000_000;

const header = (t, ...sigs) => `t=${t},${sigs.map((s) => `v1=${s}`).join(',')}`;

describe('webhookSignature', () => {
  it('accepts a correct signature within tolerance', () => {
    const sig = computeSignature(SECRET, NOW - 10, BODY);
    const r = verifyStripeSignature({
      header: header(NOW - 10, sig),
      rawBody: BODY,
      secret: SECRET,
      nowSec: NOW,
    });
    assert.deepEqual(r, { ok: true });
  });

  it('accepts when ANY v1 entry matches (secret roll)', () => {
    const good = computeSignature(SECRET, NOW, BODY);
    const stale = computeSignature('whsec_old', NOW, BODY);
    const r = verifyStripeSignature({
      header: header(NOW, stale, good),
      rawBody: BODY,
      secret: SECRET,
      nowSec: NOW,
    });
    assert.equal(r.ok, true);
  });

  it('rejects a tampered body', () => {
    const sig = computeSignature(SECRET, NOW, BODY);
    const r = verifyStripeSignature({
      header: header(NOW, sig),
      rawBody: BODY + ' ',
      secret: SECRET,
      nowSec: NOW,
    });
    assert.deepEqual(r, { ok: false, reason: 'mismatch' });
  });

  it('rejects outside the 300 s tolerance, either direction', () => {
    const old = computeSignature(SECRET, NOW - 301, BODY);
    assert.equal(
      verifyStripeSignature({
        header: header(NOW - 301, old),
        rawBody: BODY,
        secret: SECRET,
        nowSec: NOW,
      }).reason,
      'expired'
    );
    const future = computeSignature(SECRET, NOW + 301, BODY);
    assert.equal(
      verifyStripeSignature({
        header: header(NOW + 301, future),
        rawBody: BODY,
        secret: SECRET,
        nowSec: NOW,
      }).reason,
      'expired'
    );
    const edge = computeSignature(SECRET, NOW - 300, BODY);
    assert.equal(
      verifyStripeSignature({
        header: header(NOW - 300, edge),
        rawBody: BODY,
        secret: SECRET,
        nowSec: NOW,
      }).ok,
      true
    );
  });

  it('verifies the exact bytes of a Buffer body (base64-decoded upstream)', () => {
    const buf = Buffer.from(BODY, 'utf8');
    const sig = computeSignature(SECRET, NOW, buf);
    assert.equal(
      verifyStripeSignature({ header: header(NOW, sig), rawBody: buf, secret: SECRET, nowSec: NOW })
        .ok,
      true
    );
    assert.equal(sig, computeSignature(SECRET, NOW, BODY));
  });

  it('names each malformed-header case', () => {
    assert.equal(
      verifyStripeSignature({ header: undefined, rawBody: BODY, secret: SECRET, nowSec: NOW })
        .reason,
      'no_header'
    );
    assert.equal(
      verifyStripeSignature({ header: 'v1=abc', rawBody: BODY, secret: SECRET, nowSec: NOW })
        .reason,
      'no_timestamp'
    );
    assert.equal(
      verifyStripeSignature({
        header: `t=${NOW},v0=abc`,
        rawBody: BODY,
        secret: SECRET,
        nowSec: NOW,
      }).reason,
      'no_v1'
    );
  });

  it('parses junk tolerantly', () => {
    assert.deepEqual(parseSignatureHeader('t=12,v1=aa, v1=bb ,foo,v0=zz,v1='), {
      t: 12,
      v1: ['aa', 'bb'],
    });
    assert.deepEqual(parseSignatureHeader(42), { t: null, v1: [] });
  });

  it('safeEqual is false on length mismatch and true on equal strings', () => {
    assert.equal(safeEqual('abc', 'abcd'), false);
    assert.equal(safeEqual('abc', 'abc'), true);
    assert.equal(safeEqual('abc', 'abd'), false);
  });
});
