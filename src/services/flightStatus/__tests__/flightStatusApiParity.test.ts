/**
 * The client and the `flight-status` Lambda agree on every error `code`, or a code added to
 * the Lambda would fall through to a guess (#143). Imports the REAL `.mjs` source rather than
 * a copy (the `lambdaContractParity.test.ts` precedent).
 */
import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  STATUS_FOR_CODE,
  // @ts-expect-error: plain JS Lambda source, deliberately imported for parity rather than copied.
} from '../../../../infrastructure/lambda/flight-status/createHandler.mjs';
import { CODE_TO_ERROR, FLIGHT_STATUS_CODES } from '../flightStatusApi';

describe('flight-status code parity', () => {
  it('the client lists exactly the codes the Lambda emits', () => {
    expect([...FLIGHT_STATUS_CODES].sort()).toEqual([...(ERROR_CODES as string[])].sort());
  });

  it('every code has a mapping, and the map is frozen', () => {
    expect(Object.keys(CODE_TO_ERROR).sort()).toEqual([...FLIGHT_STATUS_CODES].sort());
    expect(Object.isFrozen(CODE_TO_ERROR)).toBe(true);
  });

  it('the mapping follows the Lambda status: 4xx refusals, 5xx upstream, quotas rate_limited', () => {
    const table = STATUS_FOR_CODE as Record<string, { status: number }>;
    for (const code of FLIGHT_STATUS_CODES) {
      const status = table[code]!.status;
      const want =
        code === 'budget_exhausted' || code === 'upstream_rate_limited' || status === 429
          ? 'rate_limited'
          : status >= 500
            ? 'http_5xx'
            : 'http_4xx';
      expect(CODE_TO_ERROR[code], code).toBe(want);
    }
  });
});
