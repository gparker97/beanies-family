/**
 * The refusal policy must be a TABLE, not a set of defaults nobody wrote down.
 *
 * ⚠️ THE DEFECT THIS PINS. `consumeGrant` can return `disabled`, `missing` and
 * `store_unavailable` from the guards above the conditional write and from the catch below it.
 * None of the three was in `GRANT_REFUSAL_POLICY`, so `refusalAllowsHint(reason)` evaluated
 * `undefined?.hint === true` and answered `false` — a policy decision taken by an optional-chain
 * rather than by the table whose entire purpose is to make that decision explicit and reviewable.
 *
 * ⚠️ AND WHY THIS TEST SCRAPES THE SOURCE. Every one of these reasons is produced on a path that
 * needs a DynamoDB client, an env var, or a thrown network error, so a behavioural test would
 * reach maybe two of them. The scrape reaches all of them, and it FAILS on a fourth being added
 * without a decision — which is the actual regression to guard, since the cost of the omission
 * was silence, not an error.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  GRANT_REFUSAL_POLICY,
  HARD_REFUSAL_REASONS,
  refusalAllowsHint,
  consumeGrant,
} from '../correctionGrant.mjs';

const SOURCE = fileURLToPath(new URL('../correctionGrant.mjs', import.meta.url));

/**
 * Every refusal reason the grant path can hand back, read out of its own source.
 *
 * ⚠️ SCOPED TO THE TWO FUNCTIONS THAT PRODUCE THEM. The module also exports validators whose
 * return values (`bad_token`, `bad_shape`, `bad_kind`) are a DIFFERENT vocabulary — they become
 * a 400, never a grant decision — and a whole-file scrape swept them in and demanded table rows
 * for them. Narrowing here rather than allowlisting there keeps the failure meaningful: a new
 * refusal reason must still break this test.
 */
async function reasonsInSource() {
  const src = await readFile(SOURCE, 'utf-8');
  const from = src.indexOf('function refusalReason(');
  const to = src.indexOf('export async function issueGrant(');
  assert.ok(from > -1 && to > from, 'correctionGrant.mjs no longer has the expected shape');
  const code = src
    .slice(from, to)
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');
  // Two shapes, both of which reach a caller as `result.reason`: the literals returned by the
  // guards and the catch, and `refusalReason`'s ladder of bare `return 'x'`.
  const found = new Set();
  for (const line of code.split('\n')) {
    // Line-at-a-time, with anchored single-pass patterns. A combined multiline regex over the
    // whole slice tripped `security/detect-unsafe-regex` (nested quantifiers, catastrophic
    // backtracking), and a lint suppression on a test that scrapes source is the wrong trade.
    const declared = /reason: '([a-z_]+)'/.exec(line);
    if (declared) found.add(declared[1]);
    const returned = /return '([a-z_]+)';$/.exec(line.trim());
    if (returned) found.add(returned[1]);
  }
  return found;
}

describe('GRANT_REFUSAL_POLICY covers every reason the module returns', () => {
  test('no reason escapes the table', async () => {
    const produced = await reasonsInSource();
    // Sanity: the scrape found something. An empty set would pass the subset check vacuously,
    // which is precisely the shape of guard this codebase keeps having to delete.
    assert.ok(produced.size >= 8, `only found ${produced.size} reasons — did the shape change?`);

    const undeclared = [...produced].filter((r) => !(r in GRANT_REFUSAL_POLICY));
    assert.deepEqual(
      undeclared,
      [],
      `these reasons are returned but have no policy entry: ${undeclared.join(', ')}`
    );
  });

  test('every entry states both halves of the decision', () => {
    for (const [reason, policy] of Object.entries(GRANT_REFUSAL_POLICY)) {
      assert.equal(typeof policy.refuse, 'boolean', `${reason}.refuse`);
      assert.equal(typeof policy.hint, 'boolean', `${reason}.hint`);
      // The combination the table exists to make impossible: charged for a re-read that, at
      // temperature 0 on the same bytes with no hint, returns the same wrong answer.
      assert.ok(policy.refuse || policy.hint, `${reason} charges the family and hints nothing`);
    }
  });

  test('the three that used to fall through are now decided explicitly', () => {
    for (const reason of ['disabled', 'store_unavailable', 'missing']) {
      assert.equal(HARD_REFUSAL_REASONS.has(reason), false, `${reason} must not refuse`);
      assert.equal(refusalAllowsHint(reason), true, `${reason} must still hint`);
    }
  });

  test('an unknown reason still refuses rather than quietly charging', () => {
    assert.equal(refusalAllowsHint('not_a_real_reason'), false);
  });
});

describe('a client cannot buy a free prompt hint by omitting fields', () => {
  /**
   * ⚠️ THE HOLE THIS PINS, and it was opened by the fix for the missing-rows finding. One row
   * covered `!familyId || !correction || !srcHash` at `hint: true`, reasoning "our bug, do not
   * punish the family". But `familyId` comes straight off the request on BOTH arms, so a caller
   * holding the api key that ships in the public bundle simply omits it: no grant earned, no
   * grant spent, no usage row written, and `correction.to` still reaches the model's
   * instruction on every request, for free, forever. The rule it broke is stated at the top of
   * the table — `hint: true` is only for reasons a CLIENT CANNOT FORCE.
   */
  test('an absent familyId hard-refuses and cannot hint', async () => {
    const res = await consumeGrant({
      correction: { token: '11111111-1111-4111-8111-111111111111', to: 'invoice' },
      srcHash: 'abc',
      srcBytes: 10,
      arm: 'sealed',
    });
    assert.equal(res.free, false);
    assert.equal(res.reason, 'missing_family');
    assert.equal(HARD_REFUSAL_REASONS.has('missing_family'), true, 'must 409, not serve');
    assert.equal(refusalAllowsHint('missing_family'), false, 'must never reach the prompt');
  });

  test('a missing correction is still OUR bug, and still cannot bias anything', () => {
    // Kept hintable because `!correction` leaves nothing to hint WITH, so this arm is not a
    // channel — the split exists so that judgement is written down rather than assumed.
    assert.equal(HARD_REFUSAL_REASONS.has('missing'), false);
    assert.equal(refusalAllowsHint('missing'), true);
  });
});
