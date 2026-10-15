/**
 * Client vs Lambda drift (context keys and paging surfaces).
 *
 * Every client/Lambda mirror is compared here, through the one `.mjs` import below: the
 * context-key allowlist (`ALLOWED_CONTEXT_KEYS`) and the Slack paging allowlist
 * (`PAGING_SURFACES` vs the Lambda's `SLACK_ESCALATE_SURFACES`).
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
import { PAGING_SURFACES } from '../pagingPolicy';
// The telemetry Lambda's mirrored copy. Plain JS with no .d.ts — imported for its runtime
// value only, exactly as the prompt drift guard imports the ai-extract copy.
// @ts-expect-error — no type declarations for the Lambda source.
import * as telemetryLambda from '../../../infrastructure/lambda/telemetry/index.mjs';

const lambdaKeys = telemetryLambda.ALLOWED_CONTEXT_KEYS as Set<string>;
const lambdaPagingSurfaces = telemetryLambda.SLACK_ESCALATE_SURFACES as Set<string> | undefined;

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
    const clientOnly = [...ALLOWED_CONTEXT_KEYS].filter((k) => !lambdaKeys.has(k)).sort();
    expect(clientOnly).toEqual([]);
  });

  it('neither copy carries the email key', () => {
    // The client never reads or sends an email (the client Slack path that carried one is
    // gone); the Lambda's own test still pins its refusal as defense in depth.
    expect(lambdaKeys.has('family_email')).toBe(false);
    expect(ALLOWED_CONTEXT_KEYS.has('family_email')).toBe(false);
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

describe('Slack paging surfaces: client vs Lambda', () => {
  // The Lambda pages only for `severity: 'critical'` on a surface in its set; the client's type
  // only allows `critical` on a surface in `PAGING_SURFACES`. If the two drift, a surface the
  // client may page on never pages (client-only), or the server would page on a surface the
  // client can no longer mark critical (Lambda-only, dead policy).
  it('the Lambda exports its paging allowlist for comparison', () => {
    expect(lambdaPagingSurfaces).toBeInstanceOf(Set);
    expect(lambdaPagingSurfaces?.has('boot-integrity')).toBe(true);
  });

  it('PAGING_SURFACES and SLACK_ESCALATE_SURFACES are the same set', () => {
    expect([...(lambdaPagingSurfaces ?? [])].sort()).toEqual(Object.keys(PAGING_SURFACES).sort());
  });
});
