/**
 * Tests for settings persistence across save/read cycles.
 *
 * ADR-032: the doc lives in the worker; settings are written via
 * saveSettings → mutate({op:'named', name:'patchSettings'}) and read back from the
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
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installInlineBackend } from '@/services/automerge/worker/__tests__/inlineHarness';
import { resetDoc } from '@/services/automerge/docService';
import {
  resetProjection,
  getSettings as projectionSettings,
} from '@/services/automerge/projection';
import { getHeads } from '@/services/automerge/worker/docClient';
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

  describe('#117: writes carry a base, updatedAt only on a real change', () => {
    const familyRates = [
      { from: 'USD', to: 'EUR', rate: 0.85, updatedAt: '2026-09-01' },
      { from: 'USD', to: 'JPY', rate: 150, updatedAt: '2026-09-01' },
    ] as Settings['exchangeRates'];

    async function seedFamily(): Promise<void> {
      await settingsRepo.saveSettings({
        exchangeRates: familyRates,
        aiApiKeys: { openai: 'k-openai' },
        planToken: 'plan-tok',
      });
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it('the #95 boot window (projection null): rate refresh then API key keep the family settings', async () => {
      await seedFamily();

      // The worker has the document; the main-thread projection has not hydrated yet, so every
      // setter builds its value from the defaults.
      resetProjection();
      expect(projectionSettings()).toBeNull();
      await settingsRepo.updateExchangeRates([
        { from: 'GBP', to: 'USD', rate: 1.3, updatedAt: '2026-10-01' },
      ]);

      resetProjection();
      const written = await settingsRepo.setAIApiKey('claude', 'k-claude');

      for (const settings of [written, await settingsRepo.getSettings()]) {
        // An additive insert with no known neighbour lands at the front; rate order is not meaningful.
        expect(settings.exchangeRates.map((r) => `${r.from}-${r.to}`).sort()).toEqual([
          'GBP-USD',
          'USD-EUR',
          'USD-JPY',
        ]);
        expect(settings.aiApiKeys).toEqual({ openai: 'k-openai', claude: 'k-claude' });
        expect(settings.planToken).toBe('plan-tok');
      }
    });

    it('a hydrated removal still removes (the base is the projection, not empty)', async () => {
      await seedFamily();

      const settings = await settingsRepo.removeExchangeRate('USD', 'EUR');

      expect(settings.exchangeRates.map((r) => `${r.from}-${r.to}`)).toEqual(['USD-JPY']);
    });

    it('updatedAt is unchanged by a no-op save and advances on a real one', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-01T09:00:00.000Z'));
      await settingsRepo.saveSettings({ theme: 'dark', exchangeRates: familyRates });
      const stamped = (await settingsRepo.getSettings()).updatedAt;
      expect(stamped).toBe('2026-10-01T09:00:00.000Z');
      const { heads } = await getHeads();

      vi.setSystemTime(new Date('2026-10-01T10:00:00.000Z'));
      const noop = await settingsRepo.saveSettings({ theme: 'dark', exchangeRates: familyRates });
      expect(noop.updatedAt).toBe(stamped);
      expect((await getHeads()).heads).toEqual(heads);

      const real = await settingsRepo.saveSettings({ theme: 'light' });
      expect(real.updatedAt).toBe('2026-10-01T10:00:00.000Z');
    });

    it('preserveTimestamp writes the field without touching updatedAt', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-01T09:00:00.000Z'));
      await settingsRepo.saveSettings({ theme: 'dark' });

      vi.setSystemTime(new Date('2026-10-01T10:00:00.000Z'));
      const settings = await settingsRepo.saveSettings(
        { exchangeRateLastFetch: '2026-10-01T10:00:00.000Z' },
        { preserveTimestamp: true }
      );

      expect(settings.exchangeRateLastFetch).toBe('2026-10-01T10:00:00.000Z');
      expect(settings.updatedAt).toBe('2026-10-01T09:00:00.000Z');
    });
  });
});
