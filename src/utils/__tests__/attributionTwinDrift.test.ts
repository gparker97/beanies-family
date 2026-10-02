/**
 * Attribution twin-drift guard (#118) — client parser vs the registry Lambda's validator.
 *
 * The Lambda cannot import `@beanies/brand/attribution` (every Lambda is its own zip), so
 * `infrastructure/lambda/registry/index.mjs` carries a copy of the key list and the value rule.
 * Copy-pasted fixture strings in two test files do not catch a change on one side; this import
 * does, in the same direction as `telemetryAllowlistDrift.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { ATTRIBUTION_KEYS, ATTRIBUTION_VALUE_RE } from '@beanies/brand/attribution';
// @ts-expect-error — no type declarations for the Lambda source.
import * as registryLambda from '../../../infrastructure/lambda/registry/index.mjs';

describe('attribution twins (#118)', () => {
  it('the Lambda allowlists exactly the shared keys, in the same order', () => {
    expect(registryLambda.ATTRIBUTION_KEYS).toEqual([...ATTRIBUTION_KEYS]);
  });

  it('the Lambda applies exactly the shared value rule', () => {
    expect((registryLambda.ATTRIBUTION_VALUE_RE as RegExp).source).toBe(
      ATTRIBUTION_VALUE_RE.source
    );
    expect((registryLambda.ATTRIBUTION_VALUE_RE as RegExp).flags).toBe(ATTRIBUTION_VALUE_RE.flags);
  });
});
