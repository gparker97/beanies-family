/**
 * PlanPage (#95): the handwritten early-adopter thank-you goes beside the price in both plan
 * cards only for the pre_v1 cohort, whose half price the cards already show. List-price and
 * first_ten families see nothing.
 *
 * `t` returns the key, so assertions name the copy that was chosen rather than its wording.
 */
import { mount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reactive } from 'vue';

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const store = reactive({
  state: 'trial' as string | null,
  isStale: false,
  cohort: null as string | null,
  trialDay: 3 as number | null,
  cancelAt: null as string | null,
  refresh: vi.fn(async () => {}),
});
vi.mock('@/stores/entitlementStore', () => ({ useEntitlementStore: () => store }));
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { baseCurrency: 'USD', planToken: null } }),
}));
vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => ({ activeFamilyId: 'fam-1' }),
}));
vi.mock('@/composables/usePlanLimits', async () => {
  const { ref } = await import('vue');
  return { usePlanLimits: () => ({ fullPerDay: ref(5) }) };
});
vi.mock('@/composables/usePlanSummary', async () => {
  const { computed } = await import('vue');
  return {
    usePlanSummary: () => ({
      phase: computed(() => 'renewing'),
      name: computed(() => null),
      body: computed(() => null),
      pill: computed(() => ({ key: 'plan.pill.active', tone: 'success' })),
    }),
  };
});
vi.mock('@/composables/useReadOnlyCopy', async () => {
  const { computed } = await import('vue');
  return { useReadOnlyCopy: () => ({ paragraphs: computed(() => []) }) };
});
vi.mock('@/composables/usePlanPortal', () => ({ BILLING_UI_SURFACE: 'billing-ui' }));
vi.mock('@/services/billing/billingApi', () => ({
  claim: vi.fn(),
  BillingApiError: class extends Error {},
}));
vi.mock('@/services/telemetry', () => ({ logEvent: vi.fn() }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/composables/useToast', () => ({ showToast: vi.fn() }));

import PlanPage from '../PlanPage.vue';

const render = () =>
  mount(PlanPage, {
    global: {
      stubs: {
        PlanPortalActions: true,
        PlanChoiceCard: true,
        AllowanceMeter: true,
        BeanieIcon: true,
        BaseButton: true,
        StripeCheckoutFrame: true,
      },
    },
  });

describe('PlanPage early-adopter note', () => {
  beforeEach(() => {
    store.state = 'trial';
    store.cohort = null;
  });

  const noteKeys = () =>
    render()
      .findAllComponents({ name: 'PlanChoiceCard' })
      .map((c) => c.props('noteKey'));

  it('passes the thank-you to both cards for a pre_v1 family', () => {
    store.cohort = 'pre_v1';
    expect(noteKeys()).toEqual(['plan.cohort.page.preV1.note', 'plan.cohort.page.preV1.note']);
  });

  it('shows nothing at list price', () => {
    expect(noteKeys()).toEqual([undefined, undefined]);
  });

  it('shows nothing for a first_ten family', () => {
    store.cohort = 'first_ten';
    expect(noteKeys()).toEqual([undefined, undefined]);
  });
});
