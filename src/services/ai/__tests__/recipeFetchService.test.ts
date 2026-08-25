import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CODE_TO_ERROR, CONTENT_FETCH_CODES } from '../recipeFetchService';

describe('content-fetch code mapping', () => {
  it('maps EVERY documented code — a new one cannot fall through to the generic toast', () => {
    // Without this, a code added to the Lambda later would silently land on "something
    // went wrong", telling the user nothing for a condition we knew precisely.
    for (const code of CONTENT_FETCH_CODES) {
      expect(CODE_TO_ERROR[code], `no mapping for "${code}"`).toBeTruthy();
    }
    expect(Object.keys(CODE_TO_ERROR).sort()).toEqual([...CONTENT_FETCH_CODES].sort());
  });

  it('stays in sync with the codes the LAMBDA actually emits', () => {
    // Reads the Lambda's own status table, so drift between the two runtimes fails here
    // rather than in production as an unexplained generic error.
    const src = readFileSync('infrastructure/lambda/content-fetch/index.mjs', 'utf8');
    const block = /const STATUS_FOR_CODE = \{([\s\S]*?)\};/.exec(src);
    expect(block, 'STATUS_FOR_CODE not found — did the Lambda change shape?').toBeTruthy();
    const lambdaCodes = [...block![1].matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]).sort();
    expect(lambdaCodes).toEqual([...CONTENT_FETCH_CODES].sort());
  });

  it('classifies refusals as fetch_blocked and empty results as no_content', () => {
    // These two carry INFO toasts, not error toasts: neither is a fault on our side, and
    // treating them as errors would page us for a user pasting a bad link.
    expect(CODE_TO_ERROR.blocked).toBe('fetch_blocked');
    expect(CODE_TO_ERROR.bad_url).toBe('fetch_blocked');
    expect(CODE_TO_ERROR.not_readable).toBe('no_content');
    expect(CODE_TO_ERROR.not_image).toBe('no_content');
  });

  it('reuses the existing transport codes so the toast copy already reads correctly', () => {
    expect(CODE_TO_ERROR.timeout).toBe('timeout');
    expect(CODE_TO_ERROR.fetch_failed).toBe('provider_error');
  });

  it('is frozen — the map must not be mutable at runtime', () => {
    expect(Object.isFrozen(CODE_TO_ERROR)).toBe(true);
  });
});
