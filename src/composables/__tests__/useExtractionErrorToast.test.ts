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
import { createPinia, setActivePinia } from 'pinia';
import type { ExtractionErrorCode } from '@/services/ai/types';

const showToast = vi.fn();
vi.mock('../useToast', () => ({ useToast: () => ({ showToast }) }));
vi.mock('../useTranslation', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import { useExtractionErrorToast } from '../useExtractionErrorToast';

beforeEach(() => {
  // The generic arm names the TIER now, which it reads from app state — a family on their own
  // key and a family on beanies AI fail for different reasons, and only one is ours to fix.
  setActivePinia(createPinia());
  vi.clearAllMocks();
});

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

  describe('the generic failure names the tier and the cause (#greg)', () => {
    it('names which AI setup failed, so the family knows whose problem it is', () => {
      // A family whose provider had been switched to BYOK with a bad key saw only "something
      // went wrong". Diagnosing it took a CloudWatch query and API Gateway metrics. The toast
      // knew the tier the whole time.
      useExtractionErrorToast().reportExtractionFailure('provider_error');
      const body = String(showToast.mock.calls[0]?.[2]);
      expect(body).toContain('ai.error.genericWithTier');
    });

    it("appends the provider's own message when there is one", () => {
      useExtractionErrorToast().reportExtractionFailure('provider_error', 'invalid api key');
      expect(String(showToast.mock.calls[0]?.[2])).toContain('invalid api key');
    });

    it('still reads cleanly with no detail, rather than trailing an empty string', () => {
      useExtractionErrorToast().reportExtractionFailure('provider_error');
      expect(String(showToast.mock.calls[0]?.[2]).trimEnd()).toBe(
        String(showToast.mock.calls[0]?.[2])
      );
    });

    it('keeps the error surface, so a real provider failure still pages', () => {
      useExtractionErrorToast().reportExtractionFailure('provider_error', 'boom');
      expect(optionsOf()).toBeDefined();
    });
  });
});
