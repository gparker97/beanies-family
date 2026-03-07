import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref, nextTick } from 'vue';

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockSetOnboardingCompleted = vi.fn();
const mockSetBaseCurrency = vi.fn().mockResolvedValue(undefined);
const mockCelebrate = vi.fn();

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/composables/useCelebration', () => ({
  celebrate: (...args: unknown[]) => mockCelebrate(...args),
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
  useAccountsStore: () => ({
    accounts: ref([]),
  }),
}));

vi.mock('@/stores/recurringStore', () => ({
  useRecurringStore: () => ({
    recurringItems: ref([]),
  }),
}));

vi.mock('@/stores/activityStore', () => ({
  useActivityStore: () => ({
    activities: ref([]),
  }),
}));

vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({
    owner: { id: 'owner-1', name: 'Test' },
    members: [],
  }),
}));

// ── Tests ───────────────────────────────────────────────────────────────────

// Import AFTER mocks are set up
import OnboardingWizard from '../OnboardingWizard.vue';

describe('OnboardingWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure e2e_auto_auth is NOT set (so wizard doesn't auto-skip)
    sessionStorage.removeItem('e2e_auto_auth');
  });

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
    // Step 1 has the "Let's Go" CTA
    expect(wrapper.find('[data-testid="onboarding-start"]').exists()).toBe(true);
  });

  it('advances to step 2 when clicking start', async () => {
    const wrapper = mount(OnboardingWizard, {
      global: { stubs: { Teleport: true } },
    });

    await wrapper.find('[data-testid="onboarding-start"]').trigger('click');

    // Step 2 has the add account button
    expect(wrapper.find('[data-testid="onboarding-add-account"]').exists()).toBe(true);
  });

  it('advances to step 3 when clicking next on step 2', async () => {
    const wrapper = mount(OnboardingWizard, {
      global: { stubs: { Teleport: true } },
    });

    // Step 1 → Step 2
    await wrapper.find('[data-testid="onboarding-start"]').trigger('click');

    // Step 2 → Step 3
    await wrapper.find('[data-testid="onboarding-next"]').trigger('click');

    // Step 3 has the activity card area
    expect(wrapper.text()).toContain('onboarding.sectionActivity');
  });

  it('skip button marks onboarding complete and hides wizard', async () => {
    const wrapper = mount(OnboardingWizard, {
      global: { stubs: { Teleport: true } },
    });

    // Go to step 2 where skip is available
    await wrapper.find('[data-testid="onboarding-start"]').trigger('click');

    // Click skip
    const skipButton = wrapper.findAll('button').find((b) => b.text().includes('onboarding.skip'));
    expect(skipButton).toBeTruthy();
    await skipButton!.trigger('click');

    expect(mockSetOnboardingCompleted).toHaveBeenCalledWith(true);
  });

  it('finish button marks complete and fires celebration', async () => {
    const wrapper = mount(OnboardingWizard, {
      global: { stubs: { Teleport: true } },
    });

    // Navigate to completion: step 1 → 2 → 3 → 4
    await wrapper.find('[data-testid="onboarding-start"]').trigger('click');
    await wrapper.find('[data-testid="onboarding-next"]').trigger('click');
    await wrapper.find('[data-testid="onboarding-next"]').trigger('click');

    // Click finish on completion screen
    await wrapper.find('[data-testid="onboarding-finish"]').trigger('click');

    expect(mockSetOnboardingCompleted).toHaveBeenCalledWith(true);
    expect(mockCelebrate).toHaveBeenCalledWith('setup-complete');
  });

  it('back button goes to previous step', async () => {
    const wrapper = mount(OnboardingWizard, {
      global: { stubs: { Teleport: true } },
    });

    // Step 1 → 2 → 3
    await wrapper.find('[data-testid="onboarding-start"]').trigger('click');
    await wrapper.find('[data-testid="onboarding-next"]').trigger('click');

    // Now on step 3, click back
    const backButton = wrapper.findAll('button').find((b) => b.text().includes('onboarding.back'));
    expect(backButton).toBeTruthy();
    await backButton!.trigger('click');

    // Should be back on step 2
    expect(wrapper.find('[data-testid="onboarding-add-account"]').exists()).toBe(true);
  });

  it('auto-skips when e2e_auto_auth is set in DEV mode', async () => {
    sessionStorage.setItem('e2e_auto_auth', 'true');

    const wrapper = mount(OnboardingWizard, {
      global: { stubs: { Teleport: true } },
    });

    await nextTick();

    expect(mockSetOnboardingCompleted).toHaveBeenCalledWith(true);
    // Wizard should not be visible
    expect(wrapper.find('[data-testid="onboarding-wizard"]').exists()).toBe(false);
  });
});
