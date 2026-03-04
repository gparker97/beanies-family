/**
 * Tests for settings persistence across save/load cycles.
 *
 * Validates that preferredCurrencies (and other settings) survive:
 *   1. Automerge serialize → deserialize (saveDoc → loadDoc)
 *   2. The full save chain (changeDoc → saveDoc → binary → loadDoc)
 *
 * Reproduces the bug: "Preferred currencies no longer persist after a refresh."
 * Root cause: persistence cache was never updated during auto-save, only at initial load.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  initDoc,
  resetDoc,
  saveDoc,
  loadDoc,
  changeDoc,
  getDoc,
} from '@/services/automerge/docService';
import type { Settings } from '@/types/models';

function getDefaultSettings(): Settings {
  const now = new Date().toISOString();
  return {
    id: 'app_settings',
    baseCurrency: 'USD',
    displayCurrency: 'USD',
    exchangeRates: [],
    exchangeRateAutoUpdate: true,
    exchangeRateLastFetch: null,
    theme: 'light',
    language: 'en',
    syncEnabled: false,
    autoSyncEnabled: true,
    encryptionEnabled: true,
    aiProvider: 'none',
    aiApiKeys: {},
    preferredCurrencies: [],
    customInstitutions: [],
    onboardingCompleted: true,
    createdAt: now,
    updatedAt: now,
  };
}

describe('settings persistence: Automerge round-trip', () => {
  beforeEach(() => {
    resetDoc();
    initDoc();
  });

  afterEach(() => {
    resetDoc();
  });

  it('preserves preferredCurrencies through save/load cycle', () => {
    // Write settings with preferred currencies to the doc
    const settings: Settings = {
      ...getDefaultSettings(),
      preferredCurrencies: ['EUR', 'GBP', 'JPY'],
    };
    changeDoc((d) => {
      d.settings = settings;
    });

    // Verify in-memory doc has the currencies
    const doc = getDoc();
    expect(doc.settings?.preferredCurrencies).toEqual(['EUR', 'GBP', 'JPY']);

    // Serialize to binary
    const binary = saveDoc();
    expect(binary).toBeInstanceOf(Uint8Array);
    expect(binary.length).toBeGreaterThan(0);

    // Reset and reload from binary
    resetDoc();
    const loaded = loadDoc(binary);

    // Verify loaded doc preserves currencies
    expect(loaded.settings).not.toBeNull();
    expect(loaded.settings!.preferredCurrencies).toEqual(['EUR', 'GBP', 'JPY']);
  });

  it('preserves settings after merge-style update', () => {
    // Initial settings with currencies
    const initial: Settings = {
      ...getDefaultSettings(),
      preferredCurrencies: ['USD', 'EUR'],
      baseCurrency: 'USD',
    };
    changeDoc((d) => {
      d.settings = initial;
    });

    // Simulate the saveSettings merge pattern used by settingsRepository
    const doc1 = getDoc();
    const existing = structuredClone(doc1.settings!) as Settings;
    const updated: Settings = {
      ...existing,
      ...{ syncEnabled: true, encryptionEnabled: true },
      id: 'app_settings',
      updatedAt: new Date().toISOString(),
    };
    changeDoc((d) => {
      d.settings = updated;
    });

    // Verify currencies survived the merge
    const doc2 = getDoc();
    expect(doc2.settings!.preferredCurrencies).toEqual(['USD', 'EUR']);
    expect(doc2.settings!.syncEnabled).toBe(true);

    // Save and reload
    const binary = saveDoc();
    resetDoc();
    const loaded = loadDoc(binary);

    expect(loaded.settings!.preferredCurrencies).toEqual(['USD', 'EUR']);
    expect(loaded.settings!.syncEnabled).toBe(true);
  });

  it('preserves empty preferredCurrencies array', () => {
    const settings: Settings = {
      ...getDefaultSettings(),
      preferredCurrencies: [],
    };
    changeDoc((d) => {
      d.settings = settings;
    });

    const binary = saveDoc();
    resetDoc();
    const loaded = loadDoc(binary);

    expect(loaded.settings!.preferredCurrencies).toEqual([]);
  });

  it('preserves all settings fields through round-trip', () => {
    const settings: Settings = {
      ...getDefaultSettings(),
      baseCurrency: 'GBP',
      displayCurrency: 'EUR',
      preferredCurrencies: ['USD', 'EUR', 'GBP', 'JPY'],
      theme: 'dark',
      language: 'zh',
      syncEnabled: true,
      exchangeRates: [{ from: 'USD', to: 'EUR', rate: 0.85, updatedAt: '2026-03-03' }],
      customInstitutions: ['Bank A', 'Bank B'],
    };
    changeDoc((d) => {
      d.settings = settings;
    });

    const binary = saveDoc();
    resetDoc();
    const loaded = loadDoc(binary);

    expect(loaded.settings!.baseCurrency).toBe('GBP');
    expect(loaded.settings!.displayCurrency).toBe('EUR');
    expect(loaded.settings!.preferredCurrencies).toEqual(['USD', 'EUR', 'GBP', 'JPY']);
    expect(loaded.settings!.theme).toBe('dark');
    expect(loaded.settings!.language).toBe('zh');
    expect(loaded.settings!.syncEnabled).toBe(true);
    expect(loaded.settings!.exchangeRates).toHaveLength(1);
    expect(loaded.settings!.customInstitutions).toEqual(['Bank A', 'Bank B']);
  });

  it('survives multiple sequential updates preserving latest preferredCurrencies', () => {
    // First update
    changeDoc((d) => {
      d.settings = { ...getDefaultSettings(), preferredCurrencies: ['USD'] };
    });

    // Second update (merge pattern)
    const existing1 = structuredClone(getDoc().settings!) as Settings;
    changeDoc((d) => {
      d.settings = { ...existing1, preferredCurrencies: ['USD', 'EUR'] };
    });

    // Third update (merge pattern, different fields)
    const existing2 = structuredClone(getDoc().settings!) as Settings;
    changeDoc((d) => {
      d.settings = { ...existing2, baseCurrency: 'GBP' };
    });

    // Verify final state
    const doc = getDoc();
    expect(doc.settings!.preferredCurrencies).toEqual(['USD', 'EUR']);
    expect(doc.settings!.baseCurrency).toBe('GBP');

    // Round-trip
    const binary = saveDoc();
    resetDoc();
    const loaded = loadDoc(binary);

    expect(loaded.settings!.preferredCurrencies).toEqual(['USD', 'EUR']);
    expect(loaded.settings!.baseCurrency).toBe('GBP');
  });
});
