/**
 * The plan card's magic-beans line (#95 Phase 4): when it applies, that it fetches once, what it
 * says, and that a failed read is a quiet "unavailable" plus a logged warning, never a throw.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { effectScope, reactive, type EffectScope } from 'vue';

const h = vi.hoisted(() => ({
  fetchAllowance: vi.fn(),
  logEvent: vi.fn(),
}));

const entitlement = reactive({ state: 'trial' as string | null, plan: null as string | null });
const familyContext = reactive({ activeFamilyId: 'fam-1' as string | null });
const capability = reactive({ tier: 'managed', planToken: null as string | null });

vi.mock('@/stores/entitlementStore', () => ({ useEntitlementStore: () => entitlement }));
vi.mock('@/stores/familyContextStore', () => ({ useFamilyContextStore: () => familyContext }));
vi.mock('@/composables/useAiCapability', async () => {
  const { toRef } = await import('vue');
  return {
    useAiCapability: () => ({
      tier: toRef(capability, 'tier'),
      planToken: toRef(capability, 'planToken'),
    }),
  };
});
// The key plus its placeholders, so the filled values are visible.
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string) =>
      k === 'plan.allowance.day'
        ? 'day {left}/{limit} {time}'
        : k === 'plan.allowance.month'
          ? 'month {left}/{limit} {date}'
          : k,
  }),
}));
vi.mock('@/services/ai/providers/managedProvider', () => ({
  fetchAllowance: (...a: unknown[]) => h.fetchAllowance(...a),
}));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: h.logEvent }));

import { useAllowanceLine as useAllowanceLineRaw } from '../useAllowanceLine';
import { ExtractionProviderError } from '@/services/ai/types';
import { allowanceResetParts } from '@/utils/allowanceReset';

// Each call runs in its own scope, stopped after the test, as a mounted card's would be on
// unmount: otherwise an earlier test's watcher fires on a later test's state change.
const scopes: EffectScope[] = [];
function useAllowanceLine() {
  const scope = effectScope();
  scopes.push(scope);
  return scope.run(() => useAllowanceLineRaw())!;
}
afterEach(() => {
  while (scopes.length) scopes.pop()!.stop();
});

const RESETS = '2026-10-01T00:00:00.000Z';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  entitlement.state = 'trial';
  familyContext.activeFamilyId = 'fam-1';
  capability.tier = 'managed';
  capability.planToken = null;
  h.fetchAllowance.mockResolvedValue({ used: 0, limit: 1, period: 'day', resetsAt: RESETS });
});

describe('useAllowanceLine', () => {
  it('trial: fetches once and says what is left today, with a local reset time', async () => {
    const { line } = useAllowanceLine();
    await flushPromises();
    expect(h.fetchAllowance).toHaveBeenCalledTimes(1);
    expect(h.fetchAllowance).toHaveBeenCalledWith({ familyId: 'fam-1' });
    // The shared formatter's local rendering of the UTC reset (allowanceReset.ts).
    expect(line.value).toBe(`day 1/1 ${allowanceResetParts(RESETS)!.time}`);
    expect(line.value).toMatch(/(am|pm)$/);
  });

  it('pct is what is LEFT of the allowance for the meter, null when the line does not apply', async () => {
    h.fetchAllowance.mockResolvedValueOnce({
      used: 3,
      limit: 10,
      period: 'day',
      resetsAt: '2026-10-02T00:00:00Z',
      tier: 'full',
    });
    const { pct } = useAllowanceLine();
    expect(pct.value).toBeNull();
    await flushPromises();
    expect(pct.value).toBe(70);
  });

  it('basic: the month wording with the reset date', async () => {
    entitlement.state = 'active';
    h.fetchAllowance.mockResolvedValue({ used: 1, limit: 1, period: 'month', resetsAt: RESETS });
    const { line } = useAllowanceLine();
    await flushPromises();
    expect(line.value).toBe(`month 0/1 ${allowanceResetParts(RESETS)!.date}`);
  });

  it('never shows a negative count when a race overran the allowance by one', async () => {
    h.fetchAllowance.mockResolvedValue({ used: 2, limit: 1, period: 'day', resetsAt: RESETS });
    const { line } = useAllowanceLine();
    await flushPromises();
    expect(line.value).toMatch(/^day 0\/1 /);
  });

  it('sends the plan token when the family holds one', async () => {
    capability.planToken = 'tok-1';
    useAllowanceLine();
    await flushPromises();
    expect(h.fetchAllowance).toHaveBeenCalledWith({ familyId: 'fam-1', planToken: 'tok-1' });
  });

  it('refetches when the plan token arrives after the first read (the family file loads late)', async () => {
    h.fetchAllowance.mockResolvedValueOnce({
      used: 0,
      limit: 1,
      period: 'month',
      resetsAt: '2026-11-01T00:00:00Z',
      tier: 'basic',
    });
    h.fetchAllowance.mockResolvedValueOnce({
      used: 0,
      limit: 10,
      period: 'day',
      resetsAt: '2026-10-02T00:00:00Z',
      tier: 'full',
    });
    const { line } = useAllowanceLine();
    await flushPromises();
    expect(h.fetchAllowance).toHaveBeenCalledWith({ familyId: 'fam-1' });
    expect(line.value).toContain('month');
    capability.planToken = 'tok-late';
    await flushPromises();
    expect(h.fetchAllowance).toHaveBeenLastCalledWith({ familyId: 'fam-1', planToken: 'tok-late' });
    expect(line.value).toContain('day');
    expect(h.fetchAllowance).toHaveBeenCalledTimes(2);
  });

  it('refetches when the plan changes (a switch made in the portal)', async () => {
    entitlement.state = 'active';
    entitlement.plan = 'full';
    useAllowanceLine();
    await flushPromises();
    expect(h.fetchAllowance).toHaveBeenCalledTimes(1);
    entitlement.plan = 'basic';
    await flushPromises();
    expect(h.fetchAllowance).toHaveBeenCalledTimes(2);
  });

  it('does not apply (and never fetches) on BYOK, in beta, or while read-only', async () => {
    for (const setup of [
      () => (capability.tier = 'byok'),
      () => (entitlement.state = 'beta'),
      () => (entitlement.state = 'read_only'),
    ]) {
      capability.tier = 'managed';
      entitlement.state = 'trial';
      setup();
      const { line } = useAllowanceLine();
      await flushPromises();
      expect(line.value).toBeNull();
    }
    expect(h.fetchAllowance).not.toHaveBeenCalled();
  });

  it('waits for the state to arrive, then fetches once, and not again on later changes', async () => {
    entitlement.state = null;
    useAllowanceLine();
    await flushPromises();
    expect(h.fetchAllowance).not.toHaveBeenCalled();
    entitlement.state = 'trial';
    await flushPromises();
    entitlement.state = 'active';
    await flushPromises();
    expect(h.fetchAllowance).toHaveBeenCalledTimes(1);
  });

  it('refetches when the active family changes while mounted, and drops the old answer', async () => {
    const { line } = useAllowanceLine();
    await flushPromises();
    expect(h.fetchAllowance).toHaveBeenCalledTimes(1);

    h.fetchAllowance.mockResolvedValueOnce({ used: 1, limit: 1, period: 'day', resetsAt: RESETS });
    familyContext.activeFamilyId = 'fam-2';
    await flushPromises();
    expect(h.fetchAllowance).toHaveBeenCalledTimes(2);
    expect(h.fetchAllowance).toHaveBeenLastCalledWith({ familyId: 'fam-2' });
    expect(line.value).toBe(`day 0/1 ${allowanceResetParts(RESETS)!.time}`);
  });

  it('an answer for a family the user has already left is discarded', async () => {
    let resolveOld!: (v: unknown) => void;
    h.fetchAllowance.mockImplementationOnce(() => new Promise((r) => (resolveOld = r)));
    const { line } = useAllowanceLine();
    h.fetchAllowance.mockResolvedValueOnce({ used: 0, limit: 10, period: 'day', resetsAt: RESETS });
    familyContext.activeFamilyId = 'fam-2';
    await flushPromises();
    resolveOld({ used: 1, limit: 1, period: 'day', resetsAt: RESETS });
    await flushPromises();
    expect(line.value).toBe(`day 10/10 ${allowanceResetParts(RESETS)!.time}`);
  });

  it('a failed read is "unavailable" plus a logged warning, never a throw', async () => {
    h.fetchAllowance.mockRejectedValue(new ExtractionProviderError('not_available', 'nope'));
    const { line } = useAllowanceLine();
    await flushPromises();
    expect(line.value).toBe('plan.allowance.unavailable');
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('allowance_store_error'),
      expect.anything()
    );
    expect(h.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        surface: 'ai-allowance',
        context: { action: 'usage_read_failed', error_code: 'not_available' },
      })
    );
  });
});
