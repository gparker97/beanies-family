import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { LanguageCode } from '@/types/models';
import { UI_STRINGS, getAllKeys, getSourceText, getAllHashes } from '@/services/translation/uiStrings';
import type { UIStringKey } from '@/services/translation/uiStrings';
import * as translationApi from '@/services/translation/translationApi';
import * as translationCache from '@/services/indexeddb/repositories/translationCacheRepository';
import * as translationFiles from '@/services/translation/translationFiles';

export const useTranslationStore = defineStore('translation', () => {
  // State
  const currentLanguage = ref<LanguageCode>('en');
  const translations = ref<Map<string, string>>(new Map());
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const loadProgress = ref(0); // 0-100
  const translationFile = ref<translationFiles.TranslationFile | null>(null);

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
        // Load up-to-date translations from file
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

      // Step 2: Find missing or outdated keys
      const missingKeys = allKeys.filter(key => !translationsMap.has(key));

      if (missingKeys.length === 0) {
        // All translations are loaded from file
        translations.value = translationsMap;
        currentLanguage.value = language;
        loadProgress.value = 100;
        isLoading.value = false;
        return;
      }

      loadProgress.value = 40;

      // Step 3: Check IndexedDB cache for missing translations
      const cached = await translationCache.getTranslationsForLanguageByKeys(
        language,
        missingKeys
      );

      // Add cached translations that match current hash
      for (const entry of cached) {
        const currentHash = hashMap[entry.key as UIStringKey];
        if (currentHash === entry.hash) {
          translationsMap.set(entry.key, entry.translation);
        }
      }

      // Step 4: Find keys still missing after cache check
      const stillMissingKeys = missingKeys.filter(key => !translationsMap.has(key));

      if (stillMissingKeys.length === 0) {
        // All translations found in file + cache
        translations.value = translationsMap;
        currentLanguage.value = language;
        loadProgress.value = 100;
        isLoading.value = false;
        return;
      }

      loadProgress.value = 60;

      // Step 5: Fetch remaining translations from API
      const missingTexts = stillMissingKeys.map(key => getSourceText(key));

      const translated = await translationApi.translateBatch(
        missingTexts,
        'en',
        language,
        (completed, total) => {
          const apiProgress = 60 + Math.round((completed / total) * 30);
          loadProgress.value = apiProgress;
        }
      );

      // Build new translations array for caching
      const newTranslations: Array<{ key: string; translation: string; hash: string }> = [];
      for (let i = 0; i < stillMissingKeys.length; i++) {
        const key = stillMissingKeys[i]!;
        const translation = translated[i] || getSourceText(key);
        const hash = hashMap[key] || '';
        newTranslations.push({ key, translation, hash });
        translationsMap.set(key, translation);
      }

      loadProgress.value = 90;

      // Step 6: Save new translations to IndexedDB cache
      if (newTranslations.length > 0) {
        await translationCache.saveTranslationsWithHash(
          newTranslations,
          language
        );
      }

      translations.value = translationsMap;
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

  /**
   * Export current IndexedDB cache to a translation file.
   * This allows developers to save new translations to JSON files.
   */
  async function exportCacheToFile(): Promise<void> {
    if (currentLanguage.value === 'en') {
      console.warn('Cannot export cache for English (source language)');
      return;
    }

    const language = currentLanguage.value;
    const allKeys = getAllKeys();

    // Get all cached translations for this language
    const cached = await translationCache.getTranslationsForLanguageByKeys(
      language,
      allKeys
    );

    // Load existing file or create new
    let file = await translationFiles.loadTranslationFile(language);
    if (!file) {
      const languageNames: Record<LanguageCode, string> = {
        en: 'English',
        zh: '中文 (简体)',
      };
      file = translationFiles.createEmptyTranslationFile(
        language,
        languageNames[language] || language
      );
    }

    // Update file with cached translations
    const updates = cached.map(entry => ({
      key: entry.key,
      translation: entry.translation,
      hash: entry.hash,
    }));

    const updatedFile = translationFiles.updateTranslationFile(file, updates);

    // Download as JSON
    translationFiles.downloadTranslationFile(updatedFile, `${language}.json`);
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
    exportCacheToFile,
  };
});
