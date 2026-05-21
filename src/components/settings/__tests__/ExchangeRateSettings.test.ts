import { describe, it, expect, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { ref } from 'vue';
import ExchangeRateSettings from '../ExchangeRateSettings.vue';
import { BaseButton } from '@/components/ui';

// Empty rates → both the header "Refresh Rates" and the empty-state "Fetch Rates"
// BaseButtons render, alongside the always-present auto-update toggle.
vi.mock('@/composables/useExchangeRates', () => ({
  useExchangeRates: () => ({
    isUpdating: ref(false),
    updateError: ref(null),
    isStale: ref(false),
    lastUpdateFormatted: ref('never'),
    autoUpdateEnabled: ref(false),
    exchangeRates: ref([]),
    checkStaleness: vi.fn(),
    refreshRates: vi.fn(),
    setAutoUpdate: vi.fn(),
    clearError: vi.fn(),
  }),
}));

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({ baseCurrency: 'USD' }),
}));

function mountWith(readOnly: boolean) {
  return mount(ExchangeRateSettings, { props: { standalone: false, readOnly } });
}

function autoUpdateToggle(wrapper: VueWrapper) {
  return wrapper.find('button[role="switch"]');
}

describe('ExchangeRateSettings — readOnly gating', () => {
  it('locks the auto-update toggle when readOnly but keeps manual refresh open (non-destructive)', () => {
    const wrapper = mountWith(true);

    // Auto-update preference (family-shared config) is locked...
    expect(autoUpdateToggle(wrapper).attributes('disabled')).toBeDefined();

    // ...but the Refresh/Fetch buttons stay usable — any member can pull rates.
    const buttons = wrapper.findAllComponents(BaseButton);
    expect(buttons.length).toBeGreaterThan(0);
    buttons.forEach((b) => expect(b.props('disabled')).toBe(false));
  });

  it('leaves everything interactive when not readOnly', () => {
    const wrapper = mountWith(false);

    expect(autoUpdateToggle(wrapper).attributes('disabled')).toBeUndefined();
    const buttons = wrapper.findAllComponents(BaseButton);
    expect(buttons.length).toBeGreaterThan(0);
    buttons.forEach((b) => expect(b.props('disabled')).toBe(false));
  });
});
