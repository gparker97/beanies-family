/**
 * Tests for settings persistence across save/read cycles.
 *
 * ADR-032: the doc lives in the worker; settings are written via
 * saveSettings → mutate({op:'named', name:'setSettings'}) and read back from the
 * projection. This drives the REAL inline backend on the main thread (no Worker).
 *
 * The Automerge binary serialize round-trip (saveDoc → loadDoc) and the encrypted
 * cache round-trip are now the worker's job and are covered by the worker suite
 * (`worker/__tests__/docOps.test.ts` load/save; `worker/__tests__/cache.test.ts`
 * encrypt→cache→decrypt). This file covers the store/settings-layer guarantee:
 * preferredCurrencies (and other settings) survive the save path and merges.
 *
 * Reproduces the original bug: "Preferred currencies no longer persist after a
 * refresh" — now expressed as "survive saveSettings + a merge-style partial update."
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installInlineBackend } from '@/services/automerge/worker/__tests__/inlineHarness';
import { resetDoc } from '@/services/automerge/docService';
import * as settingsRepo from '@/services/automerge/repositories/settingsRepository';
import type { Settings } from '@/types/models';

describe('settings persistence: doc-layer round-trip', () => {
  beforeEach(async () => {
    await installInlineBackend();
  });

  afterEach(() => {
    resetDoc();
  });

  it('preserves preferredCurrencies through the save/read cycle', async () => {
    await settingsRepo.saveSettings({ preferredCurrencies: ['EUR', 'GBP', 'JPY'] });

    const settings = await settingsRepo.getSettings();
    expect(settings.preferredCurrencies).toEqual(['EUR', 'GBP', 'JPY']);
  });

  it('preserves settings after a merge-style partial update', async () => {
    // Initial settings with currencies
    await settingsRepo.saveSettings({
      preferredCurrencies: ['USD', 'EUR'],
      baseCurrency: 'USD',
    });

    // saveSettings merges the partial over the persisted settings
    const updated = await settingsRepo.saveSettings({
      syncEnabled: true,
      encryptionEnabled: true,
    });

    // Currencies survived the merge
    expect(updated.preferredCurrencies).toEqual(['USD', 'EUR']);
    expect(updated.syncEnabled).toBe(true);

    // And they are readable back from the projection
    const settings = await settingsRepo.getSettings();
    expect(settings.preferredCurrencies).toEqual(['USD', 'EUR']);
    expect(settings.syncEnabled).toBe(true);
  });

  it('preserves an empty preferredCurrencies array', async () => {
    await settingsRepo.saveSettings({ preferredCurrencies: [] });

    const settings = await settingsRepo.getSettings();
    expect(settings.preferredCurrencies).toEqual([]);
  });

  it('preserves all settings fields through the save path', async () => {
    const input: Partial<Settings> = {
      baseCurrency: 'GBP',
      displayCurrency: 'EUR',
      preferredCurrencies: ['USD', 'EUR', 'GBP', 'JPY'],
      theme: 'dark',
      language: 'zh',
      syncEnabled: true,
      exchangeRates: [{ from: 'USD', to: 'EUR', rate: 0.85, updatedAt: '2026-03-03' }],
      customInstitutions: ['Bank A', 'Bank B'],
    };
    await settingsRepo.saveSettings(input);

    const settings = await settingsRepo.getSettings();
    expect(settings.baseCurrency).toBe('GBP');
    expect(settings.displayCurrency).toBe('EUR');
    expect(settings.preferredCurrencies).toEqual(['USD', 'EUR', 'GBP', 'JPY']);
    expect(settings.theme).toBe('dark');
    expect(settings.language).toBe('zh');
    expect(settings.syncEnabled).toBe(true);
    expect(settings.exchangeRates).toHaveLength(1);
    expect(settings.customInstitutions).toEqual(['Bank A', 'Bank B']);
  });

  it('survives multiple sequential updates preserving the latest preferredCurrencies', async () => {
    await settingsRepo.saveSettings({ preferredCurrencies: ['USD'] });
    await settingsRepo.saveSettings({ preferredCurrencies: ['USD', 'EUR'] });
    await settingsRepo.saveSettings({ baseCurrency: 'GBP' });

    const settings = await settingsRepo.getSettings();
    expect(settings.preferredCurrencies).toEqual(['USD', 'EUR']);
    expect(settings.baseCurrency).toBe('GBP');
  });
});
