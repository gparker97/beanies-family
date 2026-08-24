import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref, nextTick } from 'vue';

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockSetOnboardingCompleted = vi.fn();
const mockSetBaseCurrency = vi.fn().mockResolvedValue(undefined);
const mockCelebrate = vi.fn();
const mockReportError = vi.fn();
const mockShowToast = vi.fn();

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key, isBeanieMode: ref(false) }),
}));

vi.mock('@/composables/useCelebration', () => ({
  celebrate: (...args: unknown[]) => mockCelebrate(...args),
}));

vi.mock('@/composables/useToast', () => ({
  showToast: (...args: unknown[]) => mockShowToast(...args),
}));

vi.mock('@/utils/errorReporter', () => ({
  reportError: (...args: unknown[]) => mockReportError(...args),
}));

vi.mock('@/composables/useCurrencyOptions', () => ({
  useCurrencyOptions: () => ({
    currencyOptions: [{ value: 'USD', label: 'USD - US Dollar' }],
  }),
}));

vi.mock('@/composables/useInstitutionOptions', () => ({
  useInstitutionOptions: () => ({
    options: ref([{ value: 'Test Bank', label: 'Test Bank' }]),
    removeCustomInstitution: vi.fn(),
  }),
}));

vi.mock('@/composables/useInviteFlow', () => ({
  useInviteFlow: () => ({
    inviteLink: ref(''),
    inviteQrUrl: ref(''),
    error: ref(null),
    isGenerating: ref(false),
    lastSharedEmail: ref(null),
    shareDriveAccess: vi.fn().mockResolvedValue(true),
    regenerateLinkForEmail: vi.fn().mockResolvedValue(true),
    clearError: vi.fn(),
    reset: vi.fn(),
  }),
}));

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({
    baseCurrency: 'USD',
    displayCurrency: 'USD',
    onboardingCompleted: false,
    setOnboardingCompleted: mockSetOnboardingCompleted,
    setBaseCurrency: mockSetBaseCurrency,
    beanieMode: false,
  }),
}));

vi.mock('@/stores/accountsStore', () => ({
  useAccountsStore: () => ({ accounts: [] }),
}));

vi.mock('@/stores/recurringStore', () => ({
  useRecurringStore: () => ({ recurringItems: [] }),
}));

vi.mock('@/stores/activityStore', () => ({
  useActivityStore: () => ({ activities: [] }),
}));

const mockLoadBudgets = vi.fn().mockResolvedValue(undefined);
const mockCreateBudget = vi.fn().mockResolvedValue({ id: 'budget-1' });
// Mutable so a test can present a family that ALREADY has a budget.
const budgetState: { activeBudget: unknown } = { activeBudget: null };
vi.mock('@/stores/budgetStore', () => ({
  useBudgetStore: () => ({
    get activeBudget() {
      return budgetState.activeBudget;
    },
    loadBudgets: mockLoadBudgets,
    createBudget: mockCreateBudget,
  }),
}));

const mockSyncNow = vi.fn().mockResolvedValue(true);
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({
    isConfigured: true,
    syncNow: mockSyncNow,
    storageProviderType: 'local',
    familyKey: null,
  }),
}));

vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({
    owner: { id: 'owner-1', name: 'Test' },
    members: [],
    humans: [],
  }),
}));

vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => ({
    activeFamilyName: ref('Test Family'),
  }),
}));

// ── Tests ───────────────────────────────────────────────────────────────────

import OnboardingWizard from '../OnboardingWizard.vue';

describe('OnboardingWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.removeItem('e2e_auto_auth');
    budgetState.activeBudget = null;
  });

  // ── Step structure (data-driven STEPS table, 6 steps) ────────────────────

  it('renders the wizard overlay', () => {
    const wrapper = mount(OnboardingWizard, {
      global: { stubs: { Teleport: true } },
    });
    expect(wrapper.find('[data-testid="onboarding-wizard"]').exists()).toBe(true);
  });

  it('starts on step 1 (Welcome)', () => {
    const wrapper = mount(OnboardingWizard, {
      global: { stubs: { Teleport: true } },
    });
    // Step 1 has its own CTA, no nav bar
    expect(wrapper.find('[data-testid="onboarding-start"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="onboarding-next"]').exists()).toBe(false);
  });

  it('walks through all 6 steps via Next', async () => {
    const wrapper = mount(OnboardingWizard, {
      global: { stubs: { Teleport: true } },
    });

    // Step 1 → Step 2 (Account)
    await wrapper.find('[data-testid="onboarding-start"]').trigger('click');
    expect(wrapper.find('[data-testid="onboarding-add-account"]').exists()).toBe(true);

    // Step 2 → Step 3 (Recurring)
    await wrapper.find('[data-testid="onboarding-next"]').trigger('click');
    // Recurring chips render — we'll check by absence of Account's Add button
    expect(wrapper.find('[data-testid="onboarding-add-account"]').exists()).toBe(false);

    // Step 3 → Step 4 (Savings)
    await wrapper.find('[data-testid="onboarding-next"]').trigger('click');
    expect(wrapper.find('[data-testid="onboarding-savings-slider"]').exists()).toBe(true);

    // Step 4 → Step 5 (Activity)
    await wrapper.find('[data-testid="onboarding-next"]').trigger('click');
    expect(wrapper.find('[data-testid="onboarding-savings-slider"]').exists()).toBe(false);

    // Step 5 → Step 6 (Complete)
    await wrapper.find('[data-testid="onboarding-next"]').trigger('click');
    expect(wrapper.find('[data-testid="onboarding-finish"]').exists()).toBe(true);
  });

  // ── Nav-bar gating (steps 2-5 only) ─────────────────────────────────────

  it('shows nav bar on data-entry steps (2-5) but not on Welcome or Complete', async () => {
    const wrapper = mount(OnboardingWizard, {
      global: { stubs: { Teleport: true } },
    });

    // Welcome: no nav bar
    expect(wrapper.find('.ob-nav').exists()).toBe(false);

    // Step 2: nav bar visible
    await wrapper.find('[data-testid="onboarding-start"]').trigger('click');
    expect(wrapper.find('.ob-nav').exists()).toBe(true);

    // Walk to Complete
    await wrapper.find('[data-testid="onboarding-next"]').trigger('click'); // 3
    await wrapper.find('[data-testid="onboarding-next"]').trigger('click'); // 4
    await wrapper.find('[data-testid="onboarding-next"]').trigger('click'); // 5
    expect(wrapper.find('.ob-nav').exists()).toBe(true); // Step 5 still has nav

    await wrapper.find('[data-testid="onboarding-next"]').trigger('click'); // 6 (Complete)
    expect(wrapper.find('.ob-nav').exists()).toBe(false);
  });

  it('Step 5 skip button uses skipAddLater label', async () => {
    const wrapper = mount(OnboardingWizard, {
      global: { stubs: { Teleport: true } },
    });

    // Walk to step 5
    await wrapper.find('[data-testid="onboarding-start"]').trigger('click');
    await wrapper.find('[data-testid="onboarding-next"]').trigger('click');
    await wrapper.find('[data-testid="onboarding-next"]').trigger('click');
    await wrapper.find('[data-testid="onboarding-next"]').trigger('click');

    // The translation mock returns the raw key — assert we see the right one
    const skipButton = wrapper.find('.ob-nav-skip');
    expect(skipButton.text()).toBe('onboarding.skipAddLater');
  });

  it('Steps 2-4 skip button uses generic skip label', async () => {
    const wrapper = mount(OnboardingWizard, {
      global: { stubs: { Teleport: true } },
    });

    await wrapper.find('[data-testid="onboarding-start"]').trigger('click');
    expect(wrapper.find('.ob-nav-skip').text()).toBe('onboarding.skip');

    await wrapper.find('[data-testid="onboarding-next"]').trigger('click');
    expect(wrapper.find('.ob-nav-skip').text()).toBe('onboarding.skip');

    await wrapper.find('[data-testid="onboarding-next"]').trigger('click');
    expect(wrapper.find('.ob-nav-skip').text()).toBe('onboarding.skip');
  });

  // ── Skip + finish flows ──────────────────────────────────────────────────

  it('skip button marks onboarding complete and hides wizard', async () => {
    const wrapper = mount(OnboardingWizard, {
      global: { stubs: { Teleport: true } },
    });

    await wrapper.find('[data-testid="onboarding-start"]').trigger('click');
    await wrapper.find('.ob-nav-skip').trigger('click');

    expect(mockSetOnboardingCompleted).toHaveBeenCalledWith(true);
  });

  it('finish button marks onboarding complete', async () => {
    // No celebration modal — OnboardingComplete IS the celebration moment;
    // a second "all set" surface stacked on top would be redundant.
    const wrapper = mount(OnboardingWizard, {
      global: { stubs: { Teleport: true } },
    });

    // Walk to Complete (step 6)
    await wrapper.find('[data-testid="onboarding-start"]').trigger('click');
    await wrapper.find('[data-testid="onboarding-next"]').trigger('click');
    await wrapper.find('[data-testid="onboarding-next"]').trigger('click');
    await wrapper.find('[data-testid="onboarding-next"]').trigger('click');
    await wrapper.find('[data-testid="onboarding-next"]').trigger('click');
    await wrapper.find('[data-testid="onboarding-finish"]').trigger('click');
    // `handleFinish` awaits the starter-budget write, which is wrapped in
    // `withAppInitiatedWrites` — one more microtask than `trigger` flushes.
    await flushPromises();

    expect(mockSetOnboardingCompleted).toHaveBeenCalledWith(true);
    expect(mockCelebrate).not.toHaveBeenCalled();
  });

  // ── Savings goal → budget (regression, 2026-08-19) ───────────────────────
  //
  // The wizard collected `savingsPercent`, threaded it into the Savings step and
  // DISPLAYED it on the Complete summary, but never wrote it anywhere — so the
  // user set a goal during setup and found no budget in the app. Asserting
  // "createBudget was called" is not enough: the value it is called WITH is the
  // whole bug, and the default (20) must not be confusable with a stale one.

  async function walkToFinish(wrapper: ReturnType<typeof mount>) {
    await wrapper.find('[data-testid="onboarding-start"]').trigger('click');
    for (let i = 0; i < 4; i++) {
      await wrapper.find('[data-testid="onboarding-next"]').trigger('click');
    }
    await wrapper.find('[data-testid="onboarding-finish"]').trigger('click');
    await nextTick();
  }

  it('writes the savings goal as an active percentage budget on finish', async () => {
    const wrapper = mount(OnboardingWizard, { global: { stubs: { Teleport: true } } });
    await walkToFinish(wrapper);

    expect(mockCreateBudget).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'percentage',
        percentage: 20,
        currency: 'USD',
        isActive: true,
      })
    );
  });

  it('persists the slider value the user actually chose, not the default', async () => {
    const wrapper = mount(OnboardingWizard, { global: { stubs: { Teleport: true } } });
    // start -> step 2, then two Nexts -> step 4 (Savings).
    await wrapper.find('[data-testid="onboarding-start"]').trigger('click');
    await wrapper.find('[data-testid="onboarding-next"]').trigger('click');
    await wrapper.find('[data-testid="onboarding-next"]').trigger('click');
    // 35 is deliberately not the 20 default, so a regression that persists the
    // default instead of the chosen value fails here (docs/lessons.md rule 4).
    await wrapper.find('[data-testid="onboarding-savings-slider"]').setValue(35);
    await wrapper.find('[data-testid="onboarding-next"]').trigger('click');
    await wrapper.find('[data-testid="onboarding-next"]').trigger('click');
    await wrapper.find('[data-testid="onboarding-finish"]').trigger('click');
    await nextTick();

    expect(mockCreateBudget).toHaveBeenCalledWith(expect.objectContaining({ percentage: 35 }));
  });

  it('never clobbers a family budget that already exists', async () => {
    budgetState.activeBudget = { id: 'existing', mode: 'fixed', isActive: true };
    const wrapper = mount(OnboardingWizard, { global: { stubs: { Teleport: true } } });
    await walkToFinish(wrapper);

    expect(mockCreateBudget).not.toHaveBeenCalled();
    expect(mockSetOnboardingCompleted).toHaveBeenCalledWith(true);
  });

  it('still completes onboarding when the budget write fails', async () => {
    mockLoadBudgets.mockRejectedValueOnce(new Error('doc worker down'));
    const wrapper = mount(OnboardingWizard, { global: { stubs: { Teleport: true } } });
    await walkToFinish(wrapper);

    // The user must never be trapped in the wizard by a budget failure.
    expect(mockSetOnboardingCompleted).toHaveBeenCalledWith(true);
    expect(mockReportError).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'onboarding-finish-budget' })
    );
  });

  it('back button goes to previous step', async () => {
    const wrapper = mount(OnboardingWizard, {
      global: { stubs: { Teleport: true } },
    });

    await wrapper.find('[data-testid="onboarding-start"]').trigger('click');
    await wrapper.find('[data-testid="onboarding-next"]').trigger('click');

    // On step 3, back to 2
    await wrapper.find('.ob-nav-back').trigger('click');

    // Step 2's Add Account button should be visible again
    expect(wrapper.find('[data-testid="onboarding-add-account"]').exists()).toBe(true);
  });

  // ── Background-sync error path (fire-and-forget + reportError) ───────────

  it('handleFinish reports background-sync failure to support without blocking dismiss', async () => {
    mockSyncNow.mockRejectedValueOnce(new Error('token expired'));

    const wrapper = mount(OnboardingWizard, {
      global: { stubs: { Teleport: true } },
    });

    // Walk to Complete and finish
    await wrapper.find('[data-testid="onboarding-start"]').trigger('click');
    await wrapper.find('[data-testid="onboarding-next"]').trigger('click');
    await wrapper.find('[data-testid="onboarding-next"]').trigger('click');
    await wrapper.find('[data-testid="onboarding-next"]').trigger('click');
    await wrapper.find('[data-testid="onboarding-next"]').trigger('click');
    await wrapper.find('[data-testid="onboarding-finish"]').trigger('click');
    // `handleFinish` awaits the starter-budget write, which is wrapped in
    // `withAppInitiatedWrites` — one more microtask than `trigger` flushes.
    await flushPromises();

    // Onboarding still completes (dismissal not blocked)
    expect(mockSetOnboardingCompleted).toHaveBeenCalledWith(true);

    // Wait for the async catch handler to fire
    await nextTick();
    await new Promise((r) => setTimeout(r, 0));

    expect(mockReportError).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'onboarding-finish-sync' })
    );
  });

  it('handleSkip reports background-sync failure to support without blocking dismiss', async () => {
    mockSyncNow.mockRejectedValueOnce(new Error('drive 403'));

    const wrapper = mount(OnboardingWizard, {
      global: { stubs: { Teleport: true } },
    });

    await wrapper.find('[data-testid="onboarding-start"]').trigger('click');
    await wrapper.find('.ob-nav-skip').trigger('click');

    expect(mockSetOnboardingCompleted).toHaveBeenCalledWith(true);

    await nextTick();
    await new Promise((r) => setTimeout(r, 0));

    expect(mockReportError).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'onboarding-skip-sync' })
    );
  });

  // ── E2E auto-skip ────────────────────────────────────────────────────────

  it('auto-skips when e2e_auto_auth is set in DEV mode', async () => {
    sessionStorage.setItem('e2e_auto_auth', 'true');

    const wrapper = mount(OnboardingWizard, {
      global: { stubs: { Teleport: true } },
    });

    await nextTick();

    expect(mockSetOnboardingCompleted).toHaveBeenCalledWith(true);
    expect(wrapper.find('[data-testid="onboarding-wizard"]').exists()).toBe(false);
  });
});
