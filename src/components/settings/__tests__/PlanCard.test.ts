/**
 * PlanCard (#95): the four states, and the one rule that must never slip, that iOS and
 * Android carry NO action in any state (Apple 3.1.3(f), Google Play payments policy).
 *
 * `t` returns the key, so assertions name the copy that was chosen rather than its wording.
 */
import { mount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reactive } from 'vue';

const h = vi.hoisted(() => ({
  push: vi.fn(),
  hasRoute: vi.fn(() => true),
  native: false,
}));

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: h.push, hasRoute: h.hasRoute }),
}));
// The key, except the one sentence whose number must come from the shared constant.
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'readOnly.stale' ? 'readOnly.stale {days}' : key),
  }),
}));
vi.mock('@/services/sync/capabilities', () => ({ isNative: () => h.native }));

const store = reactive({
  cancelAt: null as string | null,
  pastDue: false,
  state: null as string | null,
  reason: null as string | null,
  isStale: false,
  plan: null as string | null,
  cohort: null as string | null,
  trialEndsAt: null as string | null,
  currentPeriodEnd: null as string | null,
  trialDay: null as number | null,
});
vi.mock('@/stores/entitlementStore', () => ({ useEntitlementStore: () => store }));
// #95 Phase 4: the magic-beans line comes from its own composable (tested on its own).
const allowance = vi.hoisted(() => ({ line: null as string | null }));
vi.mock('@/composables/useAllowanceLine', async () => {
  const { computed } = await import('vue');
  return {
    useAllowanceLine: () => ({
      line: computed(() => allowance.line),
      pct: computed(() => (allowance.line ? 30 : null)),
    }),
  };
});
const gate = vi.hoisted(() => ({ reachable: true }));
vi.mock('@/services/billing/pricingGate', () => ({
  // The real predicate is web-only; the mock must say so too or the native tests lie.
  isPlanPageReachable: () => gate.reachable && !h.native,
  isPricingAvailable: () => true,
}));

// #95 Phase 5: Manage plan / Receipts come from their own composable (tested on its own).
const portal = vi.hoisted(() => ({ showManage: false, openPortal: vi.fn() }));
vi.mock('@/composables/usePlanPortal', async () => {
  const { computed, ref } = await import('vue');
  return {
    usePlanPortal: () => ({
      showManage: computed(() => portal.showManage),
      hasToken: computed(() => true),
      opening: ref(false),
      openPortal: portal.openPortal,
    }),
  };
});

import PlanCard from '../PlanCard.vue';

const stubs = {
  BaseCard: { template: '<div><slot /></div>' },
  BaseButton: { template: '<button><slot /></button>' },
};
const render = () => mount(PlanCard, { global: { stubs } });

function setState(over: Partial<typeof store>): void {
  Object.assign(store, {
    cancelAt: null,
    pastDue: false,
    state: null,
    reason: null,
    isStale: false,
    plan: null,
    cohort: null,
    trialEndsAt: null,
    currentPeriodEnd: null,
    trialDay: null,
    ...over,
  });
}

const TRIAL = {
  state: 'trial',
  reason: 'in_trial',
  trialEndsAt: '2026-11-29T00:00:00.000Z',
  trialDay: 31,
};
const ACTIVE = {
  state: 'active',
  reason: 'subscribed',
  plan: 'full',
  currentPeriodEnd: '2027-09-30T00:00:00.000Z',
};
const TRIAL_ENDED = { state: 'read_only', reason: 'trial_ended' };

beforeEach(() => {
  vi.clearAllMocks();
  portal.showManage = false;
  h.native = false;
  h.hasRoute.mockReturnValue(true);
  setState({});
});

describe('web', () => {
  it('trial: the pill, the day-N meter, the web sentence and See plans', async () => {
    setState({ ...TRIAL, cohort: 'pre_v1' });
    const w = render();
    expect(w.get('[data-testid="plan-pill"]').text()).toBe('plan.pill.trial');
    const meter = w.get('[data-testid="plan-meter"]');
    expect(meter.attributes('aria-valuenow')).toBe('31');
    expect(meter.attributes('aria-valuemax')).toBe('90');
    expect(w.get('[data-testid="plan-lead"]').text()).toBe('plan.trial.day');
    expect(w.text()).toContain('plan.trial.endsWeb');
    expect(w.text()).toContain('plan.cohort.preV1');

    await w.get('[data-testid="plan-see-plans"]').trigger('click');
    expect(h.push).toHaveBeenCalledWith({ name: 'Plan' });
  });

  it('active: Manage plan and Receipts open the portal when the composable offers them', async () => {
    setState(ACTIVE);
    portal.showManage = true;
    const w = render();
    await w.get('[data-testid="plan-manage"]').trigger('click');
    await w.get('[data-testid="plan-receipts"]').trigger('click');
    expect(portal.openPortal).toHaveBeenCalledTimes(2);
    portal.showManage = false;
    expect(render().find('[data-testid="plan-manage"]').exists()).toBe(false);
  });

  it('renders no See plans until the Phase 5 plan route exists', () => {
    h.hasRoute.mockReturnValue(false);
    setState(TRIAL);
    expect(render().find('[data-testid="plan-see-plans"]').exists()).toBe(false);
  });

  it('beta: free-for-now wording, no meter', () => {
    setState({ state: 'beta', reason: 'no_launch' });
    const w = render();
    expect(w.get('[data-testid="plan-pill"]').text()).toBe('plan.pill.beta');
    expect(w.text()).toContain('plan.beta.body');
    expect(w.find('[data-testid="plan-meter"]').exists()).toBe(false);
    expect(w.find('[data-testid="plan-see-plans"]').exists()).toBe(true);
  });

  it("active: plan name, renewal date, and Plan Details (the portal pair is the composable's call)", () => {
    setState(ACTIVE);
    portal.showManage = true; // Plan Details sits on the portal row, so it shows with it
    const w = render();
    expect(w.get('[data-testid="plan-pill"]').text()).toBe('plan.pill.active');
    expect(w.get('[data-testid="plan-lead"]').text()).toBe('plan.name.full');
    expect(w.text()).toContain('plan.active.renews');
    expect(w.find('[data-testid="plan-see-plans"]').exists()).toBe(false);
    expect(w.find('[data-testid="plan-details"]').exists()).toBe(true);
  });

  it('active on the web: Plan Details opens the Plan page; never when the page is unreachable', async () => {
    setState(ACTIVE);
    portal.showManage = true;
    const w = render();
    await w.get('[data-testid="plan-details"]').trigger('click');
    expect(h.push).toHaveBeenCalledWith({ name: 'Plan' });
    gate.reachable = false;
    expect(render().find('[data-testid="plan-details"]').exists()).toBe(false);
    gate.reachable = true;
  });

  it('cancelled: the Ending pill and the end date; past due: the Payment Issue pill', () => {
    setState({ ...ACTIVE, cancelAt: '2027-09-30T00:00:00.000Z' });
    let w = render();
    expect(w.get('[data-testid="plan-pill"]').text()).toBe('plan.pill.ending');
    expect(w.get('[data-testid="plan-lead"]').text()).toBe('plan.name.full');
    expect(w.text()).toContain('plan.active.ends');
    expect(w.text()).not.toContain('plan.active.renews');

    setState({ ...ACTIVE, pastDue: true });
    w = render();
    expect(w.get('[data-testid="plan-pill"]').text()).toBe('plan.pill.paymentIssue');
    expect(w.text()).toContain('plan.active.pastDue');
  });

  it('read-only after the trial: the web sentence and See plans', () => {
    setState(TRIAL_ENDED);
    const w = render();
    expect(w.get('[data-testid="plan-pill"]').text()).toBe('plan.pill.readOnly');
    expect(w.text()).toContain('readOnly.web.trialEnded');
    expect(w.text()).not.toContain('readOnly.native.');
    expect(w.find('[data-testid="plan-see-plans"]').exists()).toBe(true);
  });

  it('read-only after a lapse, and after 14 days without the registry, say why', () => {
    setState({ state: 'read_only', reason: 'lapsed' });
    expect(render().text()).toContain('readOnly.lapsed');
    setState({ state: 'read_only', reason: 'subscribed', isStale: true });
    expect(render().text()).toContain('readOnly.stale');
  });

  it('never offers See plans to a stale family: it may be paying and only offline', () => {
    for (const stale of [
      { state: 'read_only', reason: 'subscribed', plan: 'full', isStale: true },
      { state: 'read_only', reason: 'no_launch', isStale: true },
    ]) {
      setState(stale);
      const w = render();
      // `{days}` filled from OFFLINE_GRACE_DAYS, never typed into the copy.
      expect(w.text()).toContain('readOnly.stale 14');
      expect(w.find('[data-testid="plan-see-plans"]').exists()).toBe(false);
    }
  });

  it('no answer yet: a neutral line and no pill', () => {
    const w = render();
    expect(w.text()).toContain('plan.unknown');
    expect(w.find('[data-testid="plan-pill"]').exists()).toBe(false);
  });
});

describe('native (iOS / Android)', () => {
  beforeEach(() => {
    h.native = true;
  });

  it('carries no action in ANY state, even with the plan route registered', () => {
    const states = [
      {},
      { state: 'beta', reason: 'no_launch' },
      TRIAL,
      ACTIVE,
      TRIAL_ENDED,
      { state: 'read_only', reason: 'lapsed' },
      { state: 'read_only', reason: 'subscribed', isStale: true },
    ];
    for (const s of states) {
      setState({ ...s, cohort: 'pre_v1' });
      const w = render();
      expect(w.find('button').exists()).toBe(false);
      expect(w.find('a').exists()).toBe(false);
      // A cohort line is a price statement: web only.
      expect(w.text()).not.toContain('plan.cohort.');
    }
  });

  it('trial uses the native sentence', () => {
    setState(TRIAL);
    const text = render().text();
    expect(text).toContain('plan.trial.endsNative');
    expect(text).not.toContain('plan.trial.endsWeb');
  });

  it("read-only uses greg's final copy: both paragraphs", () => {
    setState(TRIAL_ENDED);
    const text = render().text();
    expect(text).toContain('readOnly.native.trialEnded');
    expect(text).toContain('readOnly.native.plansElsewhere');
    expect(text).not.toContain('readOnly.web.');
  });
});

describe('the magic-beans line (#95 Phase 4)', () => {
  it("renders the composable's line when there is one", () => {
    allowance.line = '0 of 1 magic beans left today, more at 8am.';
    setState(TRIAL);
    expect(render().get('[data-testid="allowance-meter"]').text()).toBe(
      '0 of 1 magic beans left today, more at 8am.'
    );
  });

  it('renders nothing when the line does not apply', () => {
    allowance.line = null;
    setState(TRIAL);
    expect(render().find('[data-testid="allowance-meter"]').exists()).toBe(false);
  });
});
