/**
 * The Plan page's live Full allowance (#120): the number on success, null plus a logged warning
 * on failure, never a throw.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';

const h = vi.hoisted(() => ({ fetchPlanLimits: vi.fn(), logEvent: vi.fn() }));

vi.mock('@/services/ai/providers/managedProvider', () => ({
  fetchPlanLimits: (...a: unknown[]) => h.fetchPlanLimits(...a),
}));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: h.logEvent }));

import { usePlanLimits } from '../usePlanLimits';
import { ExtractionProviderError } from '@/services/ai/types';

const LIMITS = {
  trial: { period: 'day', limit: 1 },
  basic: { period: 'month', limit: 1 },
  full: { period: 'day', limit: 25 },
  source: 'env',
};

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('usePlanLimits', () => {
  it('exposes the Full per-day limit and logs the load', async () => {
    h.fetchPlanLimits.mockResolvedValue(LIMITS);
    const { fullPerDay } = usePlanLimits();
    expect(fullPerDay.value).toBeNull();
    await flushPromises();
    expect(fullPerDay.value).toBe(25);
    expect(h.fetchPlanLimits).toHaveBeenCalledTimes(1);
    expect(h.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info',
        surface: 'plan-limits',
        context: { action: 'limits_loaded' },
      })
    );
  });

  it('stays null and logs a warning with the error code on failure', async () => {
    h.fetchPlanLimits.mockRejectedValue(new ExtractionProviderError('not_available', 'HTTP 429'));
    const { fullPerDay } = usePlanLimits();
    await flushPromises();
    expect(fullPerDay.value).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[plan-limits] could not read the plan limits (not_available)'),
      expect.any(ExtractionProviderError)
    );
    expect(h.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        surface: 'plan-limits',
        context: { action: 'limits_read_failed', error_code: 'not_available' },
      })
    );
  });

  it('classifies a non-provider error as unknown', async () => {
    h.fetchPlanLimits.mockRejectedValue(new Error('boom'));
    usePlanLimits();
    await flushPromises();
    expect(h.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ context: { action: 'limits_read_failed', error_code: 'unknown' } })
    );
  });
});
