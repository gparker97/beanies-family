import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useTranslationStore } from '@/stores/translationStore';
import { UI_STRINGS, BEANIE_STRINGS } from '@/services/translation/uiStrings';

// Mock the translation dependencies
vi.mock('@/services/indexeddb/repositories/translationCacheRepository', () => ({
  getTranslationsForLanguageByKeys: vi.fn().mockResolvedValue([]),
  saveTranslationsWithHash: vi.fn().mockResolvedValue(undefined),
  clearAll: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/translation/translationApi', () => ({
  translateBatch: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/services/translation/translationFiles', () => ({
  loadTranslationFile: vi.fn().mockResolvedValue(null),
  createEmptyTranslationFile: vi.fn(),
  updateTranslationFile: vi.fn(),
  downloadTranslationFile: vi.fn(),
  getTranslation: vi.fn(),
}));

describe('translationStore beanie mode', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('t(key) returns plain English when beanieMode=false, language="en"', () => {
    const store = useTranslationStore();
    store.setBeanieMode(false);
    // currentLanguage defaults to 'en'

    expect(store.t('dashboard.netWorth')).toBe(UI_STRINGS['dashboard.netWorth']);
    expect(store.t('dashboard.netWorth')).toBe('family net worth');
  });

  it('t(key) returns beanie string when beanieMode=true, language="en", key has override', () => {
    const store = useTranslationStore();
    store.setBeanieMode(true);

    // dashboard.netWorth has a beanie override
    expect(store.t('dashboard.netWorth')).toBe(BEANIE_STRINGS['dashboard.netWorth']);
    expect(store.t('dashboard.netWorth')).toBe('alllllll your beans');
  });

  it('t(key) returns plain English when beanieMode=true, language="en", key has NO override', () => {
    const store = useTranslationStore();
    store.setBeanieMode(true);

    // app.name has no beanie override
    expect(store.t('app.name')).toBe(UI_STRINGS['app.name']);
    expect(store.t('app.name')).toBe('beanies.family');
  });

  it('t(key) returns plain English (not beanie) when beanieMode=true, language="zh"', () => {
    const store = useTranslationStore();
    store.setBeanieMode(true);
    store.setLanguageSync('zh');

    // With no translations loaded, should fall back to UI_STRINGS (plain English)
    // NOT beanie strings — this is the critical constraint
    const result = store.t('dashboard.netWorth');
    expect(result).toBe(UI_STRINGS['dashboard.netWorth']);
    expect(result).toBe('family net worth');
    expect(result).not.toBe(BEANIE_STRINGS['dashboard.netWorth']);
  });

  it('t(key) returns plain English when beanieMode=false, language="zh"', () => {
    const store = useTranslationStore();
    store.setBeanieMode(false);
    store.setLanguageSync('zh');

    // With no translations loaded, should fall back to UI_STRINGS
    expect(store.t('dashboard.netWorth')).toBe(UI_STRINGS['dashboard.netWorth']);
  });

  it('toggling beanieMode reactively updates t() output', () => {
    const store = useTranslationStore();

    // Start with beanie mode off
    store.setBeanieMode(false);
    expect(store.t('dashboard.netWorth')).toBe('family net worth');

    // Enable beanie mode
    store.setBeanieMode(true);
    expect(store.t('dashboard.netWorth')).toBe('alllllll your beans');

    // Disable beanie mode
    store.setBeanieMode(false);
    expect(store.t('dashboard.netWorth')).toBe('family net worth');
  });

  it('beanieMode defaults to false', () => {
    const store = useTranslationStore();
    expect(store.beanieMode).toBe(false);
  });
});
