import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import * as translationCache from '@/services/indexeddb/repositories/translationCacheRepository';
import * as translationApi from '@/services/translation/translationApi';
import * as translationFiles from '@/services/translation/translationFiles';
import {
  UI_STRINGS,
  BEANIE_STRINGS,
  getAllKeys,
  getSourceText,
  getAllHashes,
} from '@/services/translation/uiStrings';
import type { UIStringKey } from '@/services/translation/uiStrings';
import type { LanguageCode } from '@/types/models';

export const useTranslationStore = defineStore('translation', () => {
  // State
  const currentLanguage = ref<LanguageCode>('en');
  const translations = ref<Map<string, string>>(new Map());
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const loadProgress = ref(0); // 0-100
  const translationFile = ref<translationFiles.TranslationFile | null>(null);
  const beanieMode = ref(true);

  // Getters
  const isEnglish = computed(() => currentLanguage.value === 'en');
  const translationCount = computed(() => translations.value.size);

  /**
   * Load translations for a language.
   * Flow:
   * 1. Load from JSON file (committed translations)
   * 2. Check for missing/outdated translations (hash mismatch)
   * 3. Check IndexedDB cache for missing translations
   * 4. Fetch remaining from API
   * 5. Save new translations to IndexedDB cache
   */
  async function loadTranslations(language: LanguageCode): Promise<void> {
    // English is the source language, no translation needed
    if (language === 'en') {
      translations.value.clear();
      translationFile.value = null;
      currentLanguage.value = 'en';
      loadProgress.value = 100;
      return;
    }

    isLoading.value = true;
    error.value = null;
    loadProgress.value = 0;

    try {
      const allKeys = getAllKeys();
      const hashMap = getAllHashes();
      const translationsMap = new Map<string, string>();

      // Step 1: Load from JSON file
      const file = await translationFiles.loadTranslationFile(language);
      translationFile.value = file;

      if (file) {
        for (const key of allKeys) {
          const hash = hashMap[key];
          if (hash) {
            const translation = translationFiles.getTranslation(file, key, hash);
            if (translation) {
              translationsMap.set(key, translation);
            }
          }
        }
      }

      loadProgress.value = 20;

      // Step 2: Apply what we have immediately so the UI switches right away
      const missingKeys = allKeys.filter((key) => !translationsMap.has(key));

      translations.value = new Map(translationsMap);
      currentLanguage.value = language;

      if (missingKeys.length === 0) {
        loadProgress.value = 100;
        isLoading.value = false;
        return;
      }

      // Step 3: Backfill missing keys from IndexedDB cache
      loadProgress.value = 40;
      const cached = await translationCache.getTranslationsForLanguageByKeys(language, missingKeys);

      for (const entry of cached) {
        const currentHash = hashMap[entry.key as UIStringKey];
        if (currentHash === entry.hash) {
          translationsMap.set(entry.key, entry.translation);
        }
      }

      const stillMissingKeys = missingKeys.filter((key) => !translationsMap.has(key));

      // Apply cache results incrementally
      if (translationsMap.size > translations.value.size) {
        translations.value = new Map(translationsMap);
      }

      if (stillMissingKeys.length === 0) {
        loadProgress.value = 100;
        isLoading.value = false;
        return;
      }

      // Step 4: Fetch remaining from API (progressive — update UI as each comes in)
      loadProgress.value = 60;
      const missingTexts = stillMissingKeys.map((key) => getSourceText(key));

      const newTranslations: Array<{ key: string; translation: string; hash: string }> = [];

      await translationApi.translateBatch(
        missingTexts,
        'en',
        language,
        (completed, total, translatedText) => {
          // Apply each new translation to the live map as it arrives
          const idx = completed - 1;
          const key = stillMissingKeys[idx]!;
          const hash = hashMap[key] || '';
          newTranslations.push({ key, translation: translatedText, hash });
          translationsMap.set(key, translatedText);
          translations.value = new Map(translationsMap);

          loadProgress.value = 60 + Math.round((completed / total) * 30);
        }
      );

      loadProgress.value = 90;

      // Step 5: Save new translations to IndexedDB cache
      if (newTranslations.length > 0) {
        await translationCache.saveTranslationsWithHash(newTranslations, language);
      }

      loadProgress.value = 100;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load translations';
      console.error('Translation loading failed:', e);
      // Fallback: use English if we haven't already applied partial translations
      if (translations.value.size === 0) {
        currentLanguage.value = 'en';
      }
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Get the translated text for a UI string key.
   * Returns English text if translation not available.
   *
   * IMPORTANT: The translation pipeline always uses UI_STRINGS (plain English)
   * as the source text. BEANIE_STRINGS are never translated and are only shown
   * as a cosmetic overlay when language is English and beanie mode is enabled.
   */
  function t(key: UIStringKey): string {
    if (currentLanguage.value === 'en') {
      if (beanieMode.value && BEANIE_STRINGS[key]) {
        return BEANIE_STRINGS[key]!;
      }
      return UI_STRINGS[key];
    }
    return translations.value.get(key) || UI_STRINGS[key];
  }

  /**
   * Set beanie mode on or off.
   * Only affects display when language is English.
   */
  function setBeanieMode(enabled: boolean): void {
    beanieMode.value = enabled;
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
    beanieMode,
    // Getters
    isEnglish,
    translationCount,
    // Actions
    loadTranslations,
    t,
    setBeanieMode,
    clearCache,
    setLanguageSync,
  };
});
