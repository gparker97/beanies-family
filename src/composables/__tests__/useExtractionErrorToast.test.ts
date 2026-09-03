/**
 * The code → toast mapping every AI reader shares.
 *
 * The case this file exists for is `rate_limited`. A 429 from our own proxy is the system
 * working as designed — an intentional abuse limit — so it must reach the user as an INFO
 * toast with no error surface. Fall through to the `default:` arm and it fires the error
 * reporter, which pages `#beanies-errors` on every refusal. That is not hypothetical: the
 * API-Gateway route throttle has been returning a bare 429 with no `code` since #133, and it
 * has been paging that channel whenever two families extracted at once.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExtractionErrorCode } from '@/services/ai/types';

const showToast = vi.fn();
vi.mock('../useToast', () => ({ useToast: () => ({ showToast }) }));
vi.mock('../useTranslation', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import { useExtractionErrorToast } from '../useExtractionErrorToast';

beforeEach(() => vi.clearAllMocks());

/** The 4th argument is the toast options; an error surface is what fires the reporter. */
const optionsOf = () => showToast.mock.calls[0]?.[3];

describe('useExtractionErrorToast', () => {
  describe('rate_limited (#83)', () => {
    it('shows an INFO toast', () => {
      useExtractionErrorToast().reportExtractionFailure('rate_limited');
      expect(showToast).toHaveBeenCalledWith('info', expect.any(String), expect.any(String));
    });

    it('does NOT attach an error surface, so it cannot page #beanies-errors', () => {
      useExtractionErrorToast().reportExtractionFailure('rate_limited');
      expect(optionsOf()).toBeUndefined();
    });

    it('uses its own copy, not the generic error copy', () => {
      useExtractionErrorToast().reportExtractionFailure('rate_limited');
      expect(showToast.mock.calls[0][1]).toBe('ai.error.rateLimited.title');
    });
  });

  describe('the surrounding contract still holds', () => {
    it('still reports a genuine provider error WITH an error surface', () => {
      // The counterpart assertion: if the error surface stopped being attached at all, the
      // rate_limited tests above would pass for the wrong reason.
      useExtractionErrorToast().reportExtractionFailure('provider_error');
      expect(showToast).toHaveBeenCalledWith('error', expect.any(String), expect.any(String), {
        surface: 'ai-extract',
      });
    });

    it('gives an unknown code the generic error treatment', () => {
      useExtractionErrorToast().reportExtractionFailure(undefined);
      expect(showToast.mock.calls[0][0]).toBe('error');
      expect(optionsOf()).toEqual({ surface: 'ai-extract' });
    });

    it.each<[ExtractionErrorCode]>([['offline'], ['fetch_blocked'], ['upstream_busy']])(
      'keeps %s off the error surface too',
      (code) => {
        useExtractionErrorToast().reportExtractionFailure(code);
        expect(optionsOf()).toBeUndefined();
      }
    );
  });
});
