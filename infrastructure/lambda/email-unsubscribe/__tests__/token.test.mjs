import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEmail, emailHash, signUnsubToken, verifyUnsubToken } from '../token.mjs';

const SECRET = 'test-secret-do-not-use';

// GOLDEN VECTOR. These literals were computed once (and cross-checked with `openssl dgst
// -hmac`) and must NEVER be edited to make a failing test pass: a change here means the token
// format changed, and that breaks every unsubscribe link already sent. Fix the code instead.
const GOLDEN_EMAIL = ' Owner@Example.COM ';
const GOLDEN_HASH = '10852696c09ca9256aa141bef8c59c68d15da1321c26a4ba0ac0bb297d235e1d';
// eslint-disable-next-line no-secrets/no-secrets -- a test-only HMAC over a test-only secret
const GOLDEN_TOKEN = `${GOLDEN_HASH}.foLaItWpdxBLYZjyP2qLGjHNiWd2gvhgl_YrDI-JXW4`;

describe('token format (frozen)', () => {
  it('matches the golden vector', () => {
    assert.equal(emailHash(SECRET, GOLDEN_EMAIL), GOLDEN_HASH);
    assert.equal(signUnsubToken(SECRET, GOLDEN_EMAIL), GOLDEN_TOKEN);
    assert.equal(verifyUnsubToken(SECRET, GOLDEN_TOKEN), GOLDEN_HASH);
  });

  it('round-trips sign -> verify to the address hash', () => {
    const token = signUnsubToken(SECRET, 'kid@family.test');
    assert.equal(verifyUnsubToken(SECRET, token), emailHash(SECRET, 'kid@family.test'));
  });

  it('normalises case and surrounding whitespace only', () => {
    assert.equal(normalizeEmail('  A.B@Example.COM\n'), 'a.b@example.com');
    assert.equal(emailHash(SECRET, 'owner@example.com'), GOLDEN_HASH);
    assert.equal(emailHash(SECRET, 'OWNER@EXAMPLE.COM'), GOLDEN_HASH);
    assert.notEqual(emailHash(SECRET, 'owner+x@example.com'), GOLDEN_HASH);
  });

  it('keys the hash on the secret', () => {
    assert.notEqual(emailHash('another-secret', GOLDEN_EMAIL), GOLDEN_HASH);
    assert.equal(verifyUnsubToken('another-secret', GOLDEN_TOKEN), null);
  });

  it('refuses to hash an empty address or work without a secret', () => {
    assert.throws(() => emailHash(SECRET, '   '));
    assert.throws(() => signUnsubToken('', GOLDEN_EMAIL));
    assert.throws(() => verifyUnsubToken(undefined, GOLDEN_TOKEN));
  });
});

describe('verifyUnsubToken rejects', () => {
  const [hash, sig] = GOLDEN_TOKEN.split('.');
  const flip = (s, i) => s.slice(0, i) + (s[i] === 'a' ? 'b' : 'a') + s.slice(i + 1);
  const cases = {
    'a tampered hash': `${flip(hash, 0)}.${sig}`,
    'a tampered signature': `${hash}.${flip(sig, 5)}`,
    "another address's hash with this signature": `${emailHash(SECRET, 'x@y.test')}.${sig}`,
    'a signature over the wrong version prefix': `${hash}.${'A'.repeat(43)}`,
    'an uppercase hash': `${hash.toUpperCase()}.${sig}`,
    'a padded signature': `${hash}.${sig}=`,
    'a short signature': `${hash}.${sig.slice(0, 42)}`,
    'a missing dot': `${hash}${sig}`,
    'a trailing newline': `${GOLDEN_TOKEN}\n`,
    'surrounding whitespace': ` ${GOLDEN_TOKEN}`,
    'a hash alone': hash,
    'an empty string': '',
    garbage: 'not-a-token',
  };
  for (const [name, token] of Object.entries(cases)) {
    it(name, () => assert.equal(verifyUnsubToken(SECRET, token), null));
  }

  it('a non-string token', () => {
    for (const t of [undefined, null, 42, {}, [GOLDEN_TOKEN]]) {
      assert.equal(verifyUnsubToken(SECRET, t), null);
    }
  });
});
