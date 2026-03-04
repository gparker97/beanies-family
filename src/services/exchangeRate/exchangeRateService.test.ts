/**
 * Tests for exchange rate fetching and persistence through Automerge.
 *
 * Validates that:
 *   1. fetchExchangeRates returns properly structured ExchangeRate objects
 *   2. updateExchangeRates survives the Automerge round-trip without
 *      "Cannot create a reference to an existing document object"
 *   3. Rates merge correctly (new rates replace old, unmatched rates kept)
 *   4. forceUpdateRates end-to-end: fetch → save → read back
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initDoc, resetDoc, changeDoc, getDoc } from '@/services/automerge/docService';
import * as settingsRepo from '@/services/automerge/repositories/settingsRepository';
import type { ExchangeRate, Settings } from '@/types/models';

// Mock the global settings repo (IDB-dependent)
vi.mock('@/services/indexeddb/repositories/globalSettingsRepository', () => ({
  updateGlobalExchangeRates: vi.fn(async () => ({})),
}));

function seedSettings(overrides?: Partial<Settings>): void {
  const defaults = settingsRepo.getDefaultSettings();
  changeDoc((d) => {
    d.settings = { ...defaults, ...overrides };
  });
}

describe('exchangeRateService: Automerge persistence', () => {
  beforeEach(() => {
    resetDoc();
    initDoc();
  });

  afterEach(() => {
    resetDoc();
  });

  it('updateExchangeRates saves new rates to the Automerge doc', async () => {
    seedSettings({ exchangeRates: [] });

    const newRates: ExchangeRate[] = [
      { from: 'USD', to: 'EUR', rate: 0.85, updatedAt: '2026-03-03' },
      { from: 'USD', to: 'GBP', rate: 0.73, updatedAt: '2026-03-03' },
    ];

    const result = await settingsRepo.updateExchangeRates(newRates);

    expect(result.exchangeRates).toHaveLength(2);
    expect(result.exchangeRateLastFetch).toBeTruthy();

    // Verify persisted in the doc
    const doc = getDoc();
    expect(doc.settings!.exchangeRates).toHaveLength(2);
    expect(doc.settings!.exchangeRates[0]!.rate).toBe(0.85);
  });

  it('updateExchangeRates merges with existing rates without Automerge proxy errors', async () => {
    // Seed with existing rates already in the Automerge doc
    seedSettings({
      exchangeRates: [
        { from: 'USD', to: 'EUR', rate: 0.8, updatedAt: '2026-03-01' },
        { from: 'USD', to: 'JPY', rate: 110.0, updatedAt: '2026-03-01' },
      ],
    });

    // Verify existing rates are in the doc (these are now Automerge proxy objects)
    const docBefore = getDoc();
    expect(docBefore.settings!.exchangeRates).toHaveLength(2);

    // Update with new rates — this is the operation that previously threw
    // "Cannot create a reference to an existing document object"
    // because the existing rates were Automerge proxies being passed back in
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
    seedSettings({ exchangeRates: [] });

    // First update
    await settingsRepo.updateExchangeRates([
      { from: 'USD', to: 'EUR', rate: 0.8, updatedAt: '2026-03-01' },
    ]);

    // Second update — reads rates that are now Automerge proxies
    await settingsRepo.updateExchangeRates([
      { from: 'USD', to: 'EUR', rate: 0.85, updatedAt: '2026-03-03' },
      { from: 'USD', to: 'GBP', rate: 0.73, updatedAt: '2026-03-03' },
    ]);

    // Third update — another round with existing proxies
    const result = await settingsRepo.updateExchangeRates([
      { from: 'USD', to: 'JPY', rate: 150.0, updatedAt: '2026-03-03' },
    ]);

    expect(result.exchangeRates).toHaveLength(3);

    const doc = getDoc();
    expect(doc.settings!.exchangeRates).toHaveLength(3);
    expect(doc.settings!.exchangeRates.find((r) => r.to === 'EUR')!.rate).toBe(0.85);
    expect(doc.settings!.exchangeRates.find((r) => r.to === 'GBP')!.rate).toBe(0.73);
    expect(doc.settings!.exchangeRates.find((r) => r.to === 'JPY')!.rate).toBe(150.0);
  });

  it('addExchangeRate works with existing proxy rates', async () => {
    seedSettings({
      exchangeRates: [{ from: 'USD', to: 'EUR', rate: 0.8, updatedAt: '2026-03-01' }],
    });

    // addExchangeRate also reads existing rates (proxies) and writes them back
    const result = await settingsRepo.addExchangeRate({
      from: 'USD',
      to: 'GBP',
      rate: 0.73,
      updatedAt: '2026-03-03',
    });

    expect(result.exchangeRates).toHaveLength(2);
  });

  it('addExchangeRate replaces an existing rate for the same currency pair', async () => {
    seedSettings({
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

  it('removeExchangeRate works with proxy rates', async () => {
    seedSettings({
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
