import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { LanguageCode } from '@/types/models';
import { UI_STRINGS, UI_STRINGS_VERSION, getAllKeys, getSourceText } from '@/services/translation/uiStrings';
import type { UIStringKey } from '@/services/translation/uiStrings';
import * as translationApi from '@/services/translation/translationApi';
import * as translationCache from '@/services/indexeddb/repositories/translationCacheRepository';

export const useTranslationStore = defineStore('translation', () => {
  // State
  const currentLanguage = ref<LanguageCode>('en');
  const translations = ref<Map<string, string>>(new Map());
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const loadProgress = ref(0); // 0-100

  // Getters
  const isEnglish = computed(() => currentLanguage.value === 'en');
  const translationCount = computed(() => translations.value.size);

  /**
   * Load translations for a language.
   * Checks cache first, fetches from API for missing translations.
   */
  async function loadTranslations(language: LanguageCode): Promise<void> {
    // English is the source language, no translation needed
    if (language === 'en') {
      translations.value.clear();
      currentLanguage.value = 'en';
      loadProgress.value = 100;
      return;
    }

    isLoading.value = true;
    error.value = null;
    loadProgress.value = 0;

    try {
      // Step 1: Load from IndexedDB cache
      const cached = await translationCache.getTranslationsForLanguage(
        language,
        UI_STRINGS_VERSION
      );
      const cachedMap = new Map(cached.map(c => [c.key, c.translation]));

      // Step 2: Find missing keys
      const allKeys = getAllKeys();
      const missingKeys = allKeys.filter(key => !cachedMap.has(key));

      if (missingKeys.length === 0) {
        // All translations are cached
        translations.value = cachedMap;
        currentLanguage.value = language;
        loadProgress.value = 100;
        isLoading.value = false;
        return;
      }

      // Step 3: Fetch missing translations from API
      const missingTexts = missingKeys.map(key => getSourceText(key));

      const translated = await translationApi.translateBatch(
        missingTexts,
        'en',
        language,
        (completed, total) => {
          loadProgress.value = Math.round((completed / total) * 100);
        }
      );

      // Build new translations array for caching
      const newTranslations: { key: string; translation: string }[] = [];
      for (let i = 0; i < missingKeys.length; i++) {
        const key = missingKeys[i]!;
        const translation = translated[i] || getSourceText(key);
        newTranslations.push({ key, translation });
        cachedMap.set(key, translation);
      }

      // Step 4: Save new translations to IndexedDB
      if (newTranslations.length > 0) {
        await translationCache.saveTranslations(
          newTranslations,
          language,
          UI_STRINGS_VERSION
        );
      }

      translations.value = cachedMap;
      currentLanguage.value = language;
      loadProgress.value = 100;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load translations';
      console.error('Translation loading failed:', e);
      // Fallback: use English
      translations.value.clear();
      currentLanguage.value = 'en';
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Get the translated text for a UI string key.
   * Returns English text if translation not available.
   */
  function t(key: UIStringKey): string {
    if (currentLanguage.value === 'en') {
      return UI_STRINGS[key];
    }
    return translations.value.get(key) || UI_STRINGS[key];
  }

  /**
   * Clear the translation cache and reload current language.
   */
  async function clearCache(): Promise<void> {
    await translationCache.clearAll();
    if (currentLanguage.value !== 'en') {
      await loadTranslations(currentLanguage.value);
    }
  }

  /**
   * Set the current language without loading translations.
   * Used during initial app load to sync with settings.
   */
  function setLanguageSync(language: LanguageCode): void {
    currentLanguage.value = language;
  }

  return {
    // State
    currentLanguage,
    isLoading,
    error,
    loadProgress,
    // Getters
    isEnglish,
    translationCount,
    // Actions
    loadTranslations,
    t,
    clearCache,
    setLanguageSync,
  };
});
