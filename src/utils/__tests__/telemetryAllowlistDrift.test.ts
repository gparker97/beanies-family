/**
 * Telemetry context-allowlist drift guard — client vs the ingest Lambda.
 *
 * THE GUARD THAT WAS CLAIMED BUT DID NOT EXIST. The Lambda's own test asserts its
 * `ALLOWED_CONTEXT_KEYS` against a hardcoded array inside that same test file, and its
 * comment says a key added to the client "MUST be mirrored here or this fails". It does not:
 * nothing imported the client's list, so the two were only ever compared by hand.
 *
 * That failure is silent in the worst way. The client ships a context field, the Lambda
 * strips it as unknown, and the value never reaches CloudWatch — so the event still arrives,
 * still looks healthy, and any alert or query built on the missing field simply never fires.
 * The #64 share surface added `file_count` and `cold_start` to three hand-maintained lists
 * behind a guard that only compared two of them.
 *
 * This test is the real comparison, in the direction that catches it: it imports BOTH lists
 * and asserts set equality. It mirrors `extractionPromptDrift.test.ts`, which already does
 * exactly this for the prompt copies (client vitest importing the Lambda's `.mjs`) — the
 * Lambda's node test runner cannot import the client's TypeScript, which is why the Lambda
 * side could never have held this assertion.
 */
import { describe, it, expect } from 'vitest';
import { ALLOWED_CONTEXT_KEYS } from '../diagnosticContext';
// The telemetry Lambda's mirrored copy. Plain JS with no .d.ts — imported for its runtime
// value only, exactly as the prompt drift guard imports the ai-extract copy.
// @ts-expect-error — no type declarations for the Lambda source.
import * as telemetryLambda from '../../../infrastructure/lambda/telemetry/index.mjs';

const lambdaKeys = telemetryLambda.ALLOWED_CONTEXT_KEYS as Set<string>;

/**
 * The ONE key that is deliberately client-only.
 *
 * `family_email` rides the low-volume Slack error path (gated by `includeEmail`), never the
 * telemetry firehose, which is PII-free by contract. The Lambda strips it on purpose and its
 * own test pins that. Listing it here rather than relaxing the assertion keeps the exclusion
 * explicit — a SECOND client-only key would still fail.
 */
const DELIBERATELY_CLIENT_ONLY = new Set(['family_email']);

describe('telemetry context allowlist: client vs Lambda', () => {
  it('the Lambda exports its allowlist for comparison', () => {
    // If this ever stops being exported the guard silently passes on an empty set, which
    // would be worse than no guard at all.
    expect(lambdaKeys).toBeInstanceOf(Set);
    expect(lambdaKeys.size).toBeGreaterThan(50);
  });

  it('every client key is accepted by the Lambda', () => {
    // A key only on the client is the DANGEROUS direction: the field ships, is stripped on
    // ingest, and is absent from CloudWatch with nothing reporting a problem.
    const clientOnly = [...ALLOWED_CONTEXT_KEYS]
      .filter((k) => !lambdaKeys.has(k) && !DELIBERATELY_CLIENT_ONLY.has(k))
      .sort();
    expect(clientOnly).toEqual([]);
  });

  it('the PII-free firehose still refuses the email key', () => {
    // The exclusion above is a contract, not a convenience: assert it rather than assume it.
    expect(lambdaKeys.has('family_email')).toBe(false);
    expect(ALLOWED_CONTEXT_KEYS.has('family_email')).toBe(true);
  });

  it('the Lambda accepts nothing the client does not send', () => {
    // The harmless direction, but still drift: a key here and not on the client is dead
    // allowlist surface, and usually the leftover of a removed field.
    const lambdaOnly = [...lambdaKeys].filter((k) => !ALLOWED_CONTEXT_KEYS.has(k)).sort();
    expect(lambdaOnly).toEqual([]);
  });

  it('carries the #64 share-target keys in both copies', () => {
    // A named regression pin for the two keys that prompted this guard.
    for (const key of ['file_count', 'cold_start']) {
      expect(ALLOWED_CONTEXT_KEYS.has(key)).toBe(true);
      expect(lambdaKeys.has(key)).toBe(true);
    }
  });
});
