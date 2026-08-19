/**
 * Unit tests for settingsStore.setBaseCurrency's rate re-fetch.
 *
 * Regression (2026-08-19, reported by greg while setting up a new family).
 * Changing the base currency persisted the choice but left every stored rate on
 * the OLD basis (`from: <previous>`). `getRate` then finds no direct, inverse or
 * USD/EUR/GBP path, returns `undefined`, and both `convertToBaseCurrency` and
 * `convertAmount` fall back to returning the RAW amount — which the UI renders
 * labelled with the new base currency. A €100 account displays as "$100": a
 * silently wrong number, not a visibly missing one.
 *
 * The rates must therefore be re-fetched AFTER the switch, on the new basis —
 * and a failure to reach the API must never block the currency change itself.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';

type RateResult = { success: boolean; ratesUpdated: number; error?: string };

const { mockForceUpdateRates, mockShowToast, mockLogEvent } = vi.hoisted(() => ({
  mockForceUpdateRates: vi.fn<() => Promise<RateResult>>(async () => ({
    success: true,
    ratesUpdated: 40,
  })),
  mockShowToast: vi.fn(),
  mockLogEvent: vi.fn(),
}));

vi.mock('@/services/exchangeRate', () => ({
  forceUpdateRates: mockForceUpdateRates,
  updateRatesIfStale: vi.fn(),
  areRatesStale: vi.fn(),
  formatLastUpdate: vi.fn(),
}));

vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: mockLogEvent }));

vi.mock('@/composables/useToast', () => ({
  showToast: mockShowToast,
  useToast: () => ({ toasts: [], dismissToast: vi.fn() }),
}));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/services/indexeddb/repositories/globalSettingsRepository', () => ({
  getDefaultGlobalSettings: () => ({ id: 'global_settings', theme: 'light', language: 'en' }),
  getGlobalSettings: vi.fn(async () => ({ id: 'global_settings', theme: 'light', language: 'en' })),
  saveGlobalSettings: vi.fn(async (patch: Record<string, unknown>) => ({
    id: 'global_settings',
    ...patch,
  })),
}));

// A mutable base currency so the store's "did it actually change?" guard is
// exercised against a real previous value rather than a constant.
const settingsState: { baseCurrency: string } = { baseCurrency: 'USD' };

vi.mock('@/services/automerge/repositories/settingsRepository', () => ({
  getDefaultSettings: () => ({ id: 'app_settings', baseCurrency: settingsState.baseCurrency }),
  getSettings: vi.fn(async () => ({
    id: 'app_settings',
    baseCurrency: settingsState.baseCurrency,
  })),
  saveSettings: vi.fn(async (patch: Record<string, unknown>) => ({ id: 'app_settings', ...patch })),
  setBaseCurrency: vi.fn(async (c: string) => {
    settingsState.baseCurrency = c;
    return { id: 'app_settings', baseCurrency: c };
  }),
  setDisplayCurrency: vi.fn(async (c: string) => ({
    id: 'app_settings',
    baseCurrency: settingsState.baseCurrency,
    displayCurrency: c,
  })),
  setPreferredCurrencies: vi.fn(async (list: string[]) => ({
    id: 'app_settings',
    baseCurrency: settingsState.baseCurrency,
    preferredCurrencies: list,
  })),
}));

vi.mock('@/services/automerge/docService', () => ({ isDocLoaded: vi.fn(() => true) }));

import { useSettingsStore } from '../settingsStore';

describe('settingsStore.setBaseCurrency — re-bases exchange rates (#currency)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    settingsState.baseCurrency = 'USD';
    mockForceUpdateRates.mockResolvedValue({ success: true, ratesUpdated: 40 });
  });

  it('re-fetches rates after switching to a different base currency', async () => {
    await useSettingsStore().setBaseCurrency('SGD');
    expect(mockForceUpdateRates).toHaveBeenCalledTimes(1);
  });

  it('re-fetches AFTER the switch, so the new rates are on the NEW basis', async () => {
    // The ordering is the entire fix. SettingsPage's fetch-and-switch flow got
    // this backwards — it fetched, THEN switched, leaving `from: <old base>`
    // rates behind. Asserting the call alone would pass for both orderings, so
    // assert what the repo held at the moment the fetch was issued.
    let baseAtFetch: string | null = null;
    mockForceUpdateRates.mockImplementation(async () => {
      baseAtFetch = settingsState.baseCurrency;
      return { success: true, ratesUpdated: 40 };
    });

    await useSettingsStore().setBaseCurrency('SGD');

    expect(baseAtFetch).toBe('SGD');
    expect(baseAtFetch).not.toBe('USD');
  });

  it('does not re-fetch when the currency is unchanged', async () => {
    await useSettingsStore().setBaseCurrency('USD');
    expect(mockForceUpdateRates).not.toHaveBeenCalled();
  });

  it('still applies the currency change when the rate fetch fails', async () => {
    mockForceUpdateRates.mockResolvedValue({ success: false, ratesUpdated: 0, error: 'offline' });

    const store = useSettingsStore();
    await store.setBaseCurrency('SGD');

    // The user's choice is already persisted; a network failure must not undo it
    // or surface as a currency-change error.
    expect(settingsState.baseCurrency).toBe('SGD');
    expect(store.error).toBeNull();
    expect(mockLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warn', surface: 'exchange-rate-rebase' })
    );
  });

  it('still applies the currency change when the rate fetch throws', async () => {
    mockForceUpdateRates.mockRejectedValue(new Error('network down'));

    const store = useSettingsStore();
    await store.setBaseCurrency('SGD');

    expect(settingsState.baseCurrency).toBe('SGD');
    expect(store.error).toBeNull();
    expect(mockLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warn', surface: 'exchange-rate-rebase' })
    );
  });
});
