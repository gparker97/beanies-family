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
// The key, except the two quota templates, whose placeholders are what the tests check.
vi.mock('../useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string) =>
      k === 'ai.allowance.day' || k === 'ai.allowance.month' ? `${k} {limit}|{time}|{date}` : k,
  }),
}));
const h = vi.hoisted(() => ({
  refusal: null as null | Record<string, unknown>,
  push: vi.fn(),
  logEvent: vi.fn(),
}));
vi.mock('@/services/ai/providers/managedProvider', () => ({
  takeAllowanceRefusal: () => {
    const value = h.refusal;
    h.refusal = null;
    return value;
  },
}));
vi.mock('@/router', () => ({ default: { push: h.push } }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: h.logEvent }));

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
  describe('allowance_exceeded (#95): the quota prompt', () => {
    // 2026-10-01T00:00Z is the next UTC midnight; the copy must show it in LOCAL time.
    const RESETS = '2026-10-01T00:00:00.000Z';
    const localTime = () => {
      const d = new Date(RESETS);
      const hh = d.getHours() % 12 || 12;
      const mm = d.getMinutes();
      return `${hh}${mm ? `:${String(mm).padStart(2, '0')}` : ''}${d.getHours() < 12 ? 'am' : 'pm'}`;
    };

    it('is an INFO toast with its own title and NO error surface', () => {
      h.refusal = { used: 1, limit: 1, period: 'day', resetsAt: RESETS, tier: 'trial' };
      useExtractionErrorToast().reportExtractionFailure('allowance_exceeded');
      const [type, title, , options] = showToast.mock.calls[0]!;
      expect(type).toBe('info');
      expect(title).toBe('ai.allowance.title');
      expect(options.surface).toBeUndefined();
    });

    it('says when more arrive in local time, filling the day template', () => {
      h.refusal = { used: 1, limit: 1, period: 'day', resetsAt: RESETS };
      useExtractionErrorToast().reportExtractionFailure('allowance_exceeded');
      const message = showToast.mock.calls[0]![2] as string;
      expect(message.startsWith('ai.allowance.day 1|')).toBe(true);
      expect(message.split('|')[1]).toBe(localTime());
    });

    it('uses the month template for the basic allowance', () => {
      h.refusal = { used: 1, limit: 1, period: 'month', resetsAt: RESETS };
      useExtractionErrorToast().reportExtractionFailure('allowance_exceeded');
      expect((showToast.mock.calls[0]![2] as string).startsWith('ai.allowance.month 1|')).toBe(
        true
      );
    });

    it('falls back to the generic copy when the refusal carried no numbers', () => {
      h.refusal = null;
      useExtractionErrorToast().reportExtractionFailure('allowance_exceeded');
      expect(showToast.mock.calls[0]![2]).toBe('ai.allowance.generic');
    });

    it('its action opens the AI settings, the unlimited route', async () => {
      h.refusal = { used: 1, limit: 1, period: 'day', resetsAt: RESETS };
      useExtractionErrorToast().reportExtractionFailure('allowance_exceeded');
      const options = showToast.mock.calls[0]![3];
      expect(options.actionLabel).toBe('ai.allowance.action');
      await options.actionFn();
      expect(h.push).toHaveBeenCalledWith({ path: '/settings', query: { open: 'ai' } });
    });

    it('logs quota_prompt_shown with the tier on kind, the plan and the count', () => {
      h.refusal = { used: 10, limit: 10, period: 'day', resetsAt: RESETS, tier: 'full' };
      useExtractionErrorToast().reportExtractionFailure('allowance_exceeded');
      expect(h.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          surface: 'ai-allowance',
          context: { action: 'quota_prompt_shown', kind: 'full', plan: 'full', count: 10 },
        })
      );
    });

    it('keeps `plan` inside its declared enum: the trial tier is kind "trial", plan null', () => {
      h.refusal = { used: 1, limit: 1, period: 'day', resetsAt: RESETS, tier: 'trial' };
      useExtractionErrorToast().reportExtractionFailure('allowance_exceeded');
      expect(h.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          context: { action: 'quota_prompt_shown', kind: 'trial', plan: null, count: 1 },
        })
      );
    });
  });

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
