import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { verifyAlertToken } from '../alertToken.mjs';

// ⚠️ THE GOLDEN VECTOR. The same secret, exp and literal token are pinned in
// infrastructure/lambda/registry/alertToken.test.mjs (the signer). If either changes, the signer
// and this verifier have drifted: fix the code, not the vector.
const GOLDEN_SECRET = 'golden-secret-0123456789abcdef0123456789abcdef';
const GOLDEN_EXP = 1767225600;
// eslint-disable-next-line no-secrets/no-secrets -- the golden vector: a test-only HMAC over a test-only secret
const GOLDEN_TOKEN = 'v1.1767225600.dICtDBR0aBeA-FvqZbvRrIw2US04o2s7lU-LLFB5gjM';

const sign = (secret, exp) =>
  `v1.${exp}.${createHmac('sha256', secret).update(`alert:v1:${exp}`).digest('base64url')}`;

describe('verifyAlertToken', () => {
  test('golden vector verifies before its exp', () => {
    assert.deepEqual(verifyAlertToken(GOLDEN_SECRET, GOLDEN_TOKEN, GOLDEN_EXP - 1), {
      ok: true,
      exp: GOLDEN_EXP,
    });
  });

  test('expired at and after exp', () => {
    assert.deepEqual(verifyAlertToken(GOLDEN_SECRET, GOLDEN_TOKEN, GOLDEN_EXP), {
      ok: false,
      reason: 'expired',
    });
    assert.equal(verifyAlertToken(GOLDEN_SECRET, GOLDEN_TOKEN, GOLDEN_EXP + 99).reason, 'expired');
  });

  test('tampered: another exp under the old sig, another secret, a flipped sig char', () => {
    const [, , sig] = GOLDEN_TOKEN.split('.');
    const later = `v1.${GOLDEN_EXP + 3600}.${sig}`;
    assert.equal(verifyAlertToken(GOLDEN_SECRET, later, 0).reason, 'bad_sig');
    assert.equal(verifyAlertToken(`${GOLDEN_SECRET}x`, GOLDEN_TOKEN, 0).reason, 'bad_sig');
    const flipped = GOLDEN_TOKEN.slice(0, -1) + (GOLDEN_TOKEN.endsWith('A') ? 'B' : 'A');
    assert.equal(verifyAlertToken(GOLDEN_SECRET, flipped, 0).reason, 'bad_sig');
    // A token minted with the right secret for a later exp is fine.
    assert.equal(
      verifyAlertToken(GOLDEN_SECRET, sign(GOLDEN_SECRET, GOLDEN_EXP + 3600), 0).ok,
      true
    );
  });

  test('malformed shapes', () => {
    for (const t of [
      undefined,
      null,
      42,
      '',
      'v1',
      GOLDEN_TOKEN.replace('v1.', 'v2.'),
      GOLDEN_TOKEN.replace(String(GOLDEN_EXP), 'abc'),
      'v1.1767225600.short',
      `${GOLDEN_TOKEN}.extra`,
      ` ${GOLDEN_TOKEN}`,
    ]) {
      assert.deepEqual(
        verifyAlertToken(GOLDEN_SECRET, t, 0),
        { ok: false, reason: 'malformed' },
        String(t)
      );
    }
  });

  test('a missing secret throws (a deploy fault, never accept)', () => {
    assert.throws(() => verifyAlertToken('', GOLDEN_TOKEN, 0), /secret is missing/);
    assert.throws(() => verifyAlertToken(undefined, GOLDEN_TOKEN, 0), /secret is missing/);
  });
});
