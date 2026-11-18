/**
 * The client and the `place-search` Lambda agree on every error `code` (#150), or a code added
 * to the Lambda would fall through to a status-class guess. Imports the REAL `.mjs` source
 * rather than a copy (the `flightStatusApiParity.test.ts` precedent).
 */
import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  STATUS_FOR_CODE,
  // @ts-expect-error: plain JS Lambda source, deliberately imported for parity rather than copied.
} from '../../../../infrastructure/lambda/place-search/http.mjs';
import { PLACE_SEARCH_LAMBDA_CODES } from '@/types/placeSearch';
import { DEV_HINT_FOR_CODE } from '../placeSearchApi';

describe('place-search code parity', () => {
  it('the client lists exactly the codes the Lambda emits', () => {
    expect([...PLACE_SEARCH_LAMBDA_CODES].sort()).toEqual([...(ERROR_CODES as string[])].sort());
  });

  it('every code has a dev hint, and the hint table is frozen', () => {
    expect(Object.keys(DEV_HINT_FOR_CODE).sort()).toEqual([...PLACE_SEARCH_LAMBDA_CODES].sort());
    expect(Object.isFrozen(DEV_HINT_FOR_CODE)).toBe(true);
    for (const code of PLACE_SEARCH_LAMBDA_CODES)
      expect(DEV_HINT_FOR_CODE[code].length).toBeGreaterThan(10);
  });

  it('every Lambda code has a non-2xx status', () => {
    const table = STATUS_FOR_CODE as Record<string, { status: number }>;
    for (const code of PLACE_SEARCH_LAMBDA_CODES)
      expect(table[code]!.status).toBeGreaterThanOrEqual(400);
  });
});
