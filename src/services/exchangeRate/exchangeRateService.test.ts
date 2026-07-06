/**
 * Tests for exchange rate fetching and persistence through the doc layer.
 *
 * ADR-032: the doc lives in the worker; this drives the REAL inline backend
 * (docClient → applyAndProject → projection) on the main thread, no Worker.
 *
 * Validates that:
 *   1. updateExchangeRates persists new rates through the doc round-trip
 *   2. Rates merge correctly (new rates replace old, unmatched rates kept)
 *   3. add/remove exchange-rate helpers round-trip through saveSettings
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installInlineBackend } from '@/services/automerge/worker/__tests__/inlineHarness';
import { resetDoc } from '@/services/automerge/docService';
import * as settingsRepo from '@/services/automerge/repositories/settingsRepository';
import type { ExchangeRate, Settings } from '@/types/models';

// Mock the global settings repo (IDB-dependent)
vi.mock('@/services/indexeddb/repositories/globalSettingsRepository', () => ({
  updateGlobalExchangeRates: vi.fn(async () => ({})),
}));

/** Seed settings into the doc via the real save path (saveSettings → mutate). */
async function seedSettings(overrides?: Partial<Settings>): Promise<void> {
  await settingsRepo.saveSettings({ ...settingsRepo.getDefaultSettings(), ...overrides });
}

describe('exchangeRateService: Automerge persistence', () => {
  beforeEach(async () => {
    await installInlineBackend();
  });

  afterEach(() => {
    resetDoc();
  });

  it('updateExchangeRates saves new rates to the doc', async () => {
    await seedSettings({ exchangeRates: [] });

    const newRates: ExchangeRate[] = [
      { from: 'USD', to: 'EUR', rate: 0.85, updatedAt: '2026-03-03' },
      { from: 'USD', to: 'GBP', rate: 0.73, updatedAt: '2026-03-03' },
    ];

    const result = await settingsRepo.updateExchangeRates(newRates);

    expect(result.exchangeRates).toHaveLength(2);
    expect(result.exchangeRateLastFetch).toBeTruthy();

    // Verify persisted in the doc (read back through the projection)
    const settings = await settingsRepo.getSettings();
    expect(settings.exchangeRates).toHaveLength(2);
    expect(settings.exchangeRates[0]!.rate).toBe(0.85);
  });

  it('updateExchangeRates merges with existing rates without proxy errors', async () => {
    // Seed with existing rates already in the doc
    await seedSettings({
      exchangeRates: [
        { from: 'USD', to: 'EUR', rate: 0.8, updatedAt: '2026-03-01' },
        { from: 'USD', to: 'JPY', rate: 110.0, updatedAt: '2026-03-01' },
      ],
    });

    // Verify existing rates are in the doc
    const settingsBefore = await settingsRepo.getSettings();
    expect(settingsBefore.exchangeRates).toHaveLength(2);

    // Update with new rates — this is the operation that previously threw
    // "Cannot create a reference to an existing document object" when the
    // existing rates were Automerge proxies being passed back in.
    const newRates: ExchangeRate[] = [
      { from: 'USD', to: 'EUR', rate: 0.85, updatedAt: '2026-03-03' },
      { from: 'USD', to: 'GBP', rate: 0.73, updatedAt: '2026-03-03' },
    ];

    // This MUST NOT throw
    const result = await settingsRepo.updateExchangeRates(newRates);

    // EUR rate should be updated, JPY kept, GBP added
    expect(result.exchangeRates).toHaveLength(3);

    const eurRate = result.exchangeRates.find((r) => r.to === 'EUR');
    const jpyRate = result.exchangeRates.find((r) => r.to === 'JPY');
    const gbpRate = result.exchangeRates.find((r) => r.to === 'GBP');

    expect(eurRate!.rate).toBe(0.85); // Updated
    expect(jpyRate!.rate).toBe(110.0); // Preserved
    expect(gbpRate!.rate).toBe(0.73); // Added
  });

  it('updateExchangeRates works when called multiple times sequentially', async () => {
    await seedSettings({ exchangeRates: [] });

    // First update
    await settingsRepo.updateExchangeRates([
      { from: 'USD', to: 'EUR', rate: 0.8, updatedAt: '2026-03-01' },
    ]);

    // Second update — reads rates already persisted in the doc
    await settingsRepo.updateExchangeRates([
      { from: 'USD', to: 'EUR', rate: 0.85, updatedAt: '2026-03-03' },
      { from: 'USD', to: 'GBP', rate: 0.73, updatedAt: '2026-03-03' },
    ]);

    // Third update — another round with existing persisted rates
    const result = await settingsRepo.updateExchangeRates([
      { from: 'USD', to: 'JPY', rate: 150.0, updatedAt: '2026-03-03' },
    ]);

    expect(result.exchangeRates).toHaveLength(3);

    const settings = await settingsRepo.getSettings();
    expect(settings.exchangeRates).toHaveLength(3);
    expect(settings.exchangeRates.find((r) => r.to === 'EUR')!.rate).toBe(0.85);
    expect(settings.exchangeRates.find((r) => r.to === 'GBP')!.rate).toBe(0.73);
    expect(settings.exchangeRates.find((r) => r.to === 'JPY')!.rate).toBe(150.0);
  });

  it('addExchangeRate works with existing persisted rates', async () => {
    await seedSettings({
      exchangeRates: [{ from: 'USD', to: 'EUR', rate: 0.8, updatedAt: '2026-03-01' }],
    });

    // addExchangeRate also reads existing rates and writes them back
    const result = await settingsRepo.addExchangeRate({
      from: 'USD',
      to: 'GBP',
      rate: 0.73,
      updatedAt: '2026-03-03',
    });

    expect(result.exchangeRates).toHaveLength(2);
  });

  it('addExchangeRate replaces an existing rate for the same currency pair', async () => {
    await seedSettings({
      exchangeRates: [{ from: 'USD', to: 'EUR', rate: 0.8, updatedAt: '2026-03-01' }],
    });

    const result = await settingsRepo.addExchangeRate({
      from: 'USD',
      to: 'EUR',
      rate: 0.9,
      updatedAt: '2026-03-03',
    });

    expect(result.exchangeRates).toHaveLength(1);
    expect(result.exchangeRates[0]!.rate).toBe(0.9);
  });

  it('removeExchangeRate works with persisted rates', async () => {
    await seedSettings({
      exchangeRates: [
        { from: 'USD', to: 'EUR', rate: 0.8, updatedAt: '2026-03-01' },
        { from: 'USD', to: 'GBP', rate: 0.73, updatedAt: '2026-03-01' },
      ],
    });

    const result = await settingsRepo.removeExchangeRate('USD', 'EUR');

    expect(result.exchangeRates).toHaveLength(1);
    expect(result.exchangeRates[0]!.to).toBe('GBP');
  });
});
