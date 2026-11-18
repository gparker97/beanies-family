/**
 * Twin drift: place-search restates generic helpers from flight-status rather than importing
 * them (every Lambda is its own zero-dependency zip; header of `flight-status/ddb.mjs`). This
 * test is what keeps the copies honest: a fix to one that misses the other fails here.
 *
 * `fn.toString()` covers the whole source text of the function, comments inside its body
 * included, so the rule is: EDIT BOTH COPIES IN ONE COMMIT.
 *
 * Deliberately NOT pinned (place-search's own versions, differing on purpose):
 *   http.mjs   STATUS_FOR_CODE, ERROR_CODES, UPSTREAM_CODES, errorResponse (reads its own table),
 *              positiveInt (its warning names the Lambda)
 *   store.mjs  takeToken (different kinds, keys and fail-closed posture)
 * Not restated at all: flight-status's safeEqual (softKeyOk does not need it), safeWrite and the
 * result cache (place-search has no cache).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import * as fsHttp from '../../flight-status/http.mjs';
import * as fsDdb from '../../flight-status/ddb.mjs';
import * as fsStore from '../../flight-status/store.mjs';
import * as psHttp from '../http.mjs';
import * as psDdb from '../ddb.mjs';
import * as psStore from '../store.mjs';

export const PINNED = Object.freeze({
  'http.mjs': {
    twins: [fsHttp, psHttp],
    names: [
      'parseOrigins',
      'corsHeaders',
      'jsonResponse',
      'softKeyOk',
      'readJsonBody',
      'logLine',
      'errorText',
    ],
  },
  'ddb.mjs': {
    twins: [fsDdb, psDdb],
    names: [
      'defaultClient',
      '__setDdbClientForTests',
      'resolveClient',
      'hash',
      'marshalKey',
      'countOne',
    ],
  },
  'store.mjs': {
    twins: [fsStore, psStore],
    names: ['ipKey', 'utcDay', 'secondsToUtcMidnight'],
  },
});

for (const [file, { twins, names }] of Object.entries(PINNED)) {
  describe(`place-search/${file} restates flight-status/${file} byte for byte`, () => {
    const [flight, place] = twins;
    for (const name of names) {
      test(name, () => {
        assert.equal(
          typeof flight[name],
          'function',
          `flight-status/${file} no longer exports ${name}`
        );
        assert.equal(
          typeof place[name],
          'function',
          `place-search/${file} does not export ${name}`
        );
        assert.equal(
          place[name].toString(),
          flight[name].toString(),
          `${name} drifted: edit both copies in one commit (place-search/${file} and flight-status/${file})`
        );
      });
    }
  });
}

describe('the own versions really are distinct', () => {
  test('takeToken differs (fail-closed day caps)', () => {
    assert.notEqual(psStore.takeToken.toString(), fsStore.takeToken.toString());
  });
  test('the code tables differ', () => {
    assert.notDeepEqual(psHttp.ERROR_CODES, fsHttp.ERROR_CODES);
  });
});
