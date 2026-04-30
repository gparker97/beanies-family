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
import { reportError } from '@/utils/errorReporter';
import { showToast } from '@/composables/useToast';

/**
 * Cancellation pattern: each `loadTranslations` call captures `++activeLoadToken`
 * at start. Staleness checks (`isStale()`) gate every reactive write — a
 * superseded load's last write can never clobber the active load's state.
 * Closure-scoped because templates never need to read it. Standard SWR/Vue
 * Query semantics. See docs/plans/2026-04-30-language-switcher-freeze.md.
 *
 * The freeze fix lives in two places: this store handles cancellation +
 * non-blocking apply order; `useLanguageSwitcher.ts` handles the
 * fire-and-forget click contract on the UI side. Don't move ownership of
 * either responsibility without revisiting the plan.
 */
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

  // Cancellation token — closure-scoped (not in store state). Every
  // loadTranslations call captures `++activeLoadToken` at start; later
  // staleness checks compare against it.
  let activeLoadToken = 0;

  /**
   * Try one key against the API. Per-key failure is non-fatal — t() falls
   * back to the source-language string, so a missing key just renders in
   * English. Logged so the failure isn't silent. Returning null tells the
   * caller "skip this entry, keep going". Defensive: translationApi.translate()
   * currently always returns a string (its own retry logic catches failures
   * and returns the input text), but if its contract ever changes, this
   * try/catch ensures the loop keeps going.
   */
  async function tryTranslateOneKey(
    text: string,
    key: string,
    language: LanguageCode
  ): Promise<string | null> {
    try {
      return await translationApi.translate(text, 'en', language);
    } catch (err) {
      console.warn(`[translationStore] missed key "${key}" for ${language}:`, err);
      return null;
    }
  }

  /**
   * Surface a catastrophic failure (JSON fetch dead, IndexedDB unavailable,
   * etc.). Stale-load failures should be silently abandoned by the caller
   * BEFORE reaching this; this function only runs for the active load.
   *
   * Routes through the universal error reporter so catastrophic translation
   * failures join #beanies-errors with the rest of the app's structured
   * errors. Surfaces a user-facing toast in whatever language is currently
   * active (the t() lookup resolves against a complete map either way).
   */
  function handleCatastrophicLoadError(language: LanguageCode, err: unknown): void {
    const wrapped = err instanceof Error ? err : new Error(String(err));
    console.error('[translationStore] loadTranslations failed:', wrapped);
    error.value = wrapped.message;

    reportError({
      surface: 'translation-load',
      message: `Translation load failed for ${language}`,
      error: wrapped,
      context: { language },
    });

    showToast('error', t('error.translationLoadFailed'), t('error.translationLoadFailedHelp'));
  }

  /**
   * Load translations for a language.
   * Flow (each phase guards with `isStale()` before any reactive write):
   * 1. Bundled JSON (fast, ~50–300 ms) — cosmetic switch happens here
   * 2. Identify missing keys (hash mismatch from uiStrings.ts source-of-truth)
   * 3. IndexedDB cache backfill (parallel reads)
   * 4. API backfill (~200 ms/key MyMemory rate limit)
   * 5. Persist new entries to IndexedDB
   *
   * Never blocks the caller — the click handler fires this and moves on.
   * A mid-load language switch supersedes this load via `activeLoadToken`,
   * causing the next staleness check to early-return without writing state.
   */
  async function loadTranslations(language: LanguageCode): Promise<void> {
    // English is the source language — no translation needed
    if (language === 'en') {
      activeLoadToken++; // bump so any in-flight non-English load becomes stale
      translations.value.clear();
      translationFile.value = null;
      currentLanguage.value = 'en';
      loadProgress.value = 100;
      isLoading.value = false;
      return;
    }

    const myToken = ++activeLoadToken;
    const isStale = () => myToken !== activeLoadToken;

    try {
      isLoading.value = true;
      error.value = null;
      loadProgress.value = 0;

      const allKeys = getAllKeys();
      const hashMap = getAllHashes();
      const translationsMap = new Map<string, string>();

      // ─── Phase 1: bundled JSON (fast, ~50–300 ms) ───
      const file = await translationFiles.loadTranslationFile(language);
      if (isStale()) return;
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

      // Cosmetic switch — instant. Any reactive UI re-renders into the new
      // language using whatever the bundled JSON shipped with.
      translations.value = new Map(translationsMap);
      currentLanguage.value = language;

      // ─── Phase 2: identify missing keys ───
      const missingKeys = allKeys.filter((key) => !translationsMap.has(key));
      if (missingKeys.length === 0) return; // finally clears isLoading

      // ─── Phase 3: IndexedDB cache backfill (parallel reads, fast) ───
      loadProgress.value = 40;
      const cached = await translationCache.getTranslationsForLanguageByKeys(language, missingKeys);
      if (isStale()) return;

      for (const entry of cached) {
        const currentHash = hashMap[entry.key as UIStringKey];
        if (currentHash === entry.hash) {
          translationsMap.set(entry.key, entry.translation);
        }
      }

      const stillMissingKeys = missingKeys.filter((key) => !translationsMap.has(key));

      // Apply cache results
      if (translationsMap.size > translations.value.size) {
        translations.value = new Map(translationsMap);
      }

      if (stillMissingKeys.length === 0) return;

      // ─── Phase 4: API backfill (~200 ms/key MyMemory rate limit) ───
      // Staleness check at the top of each iteration so a mid-load supersede
      // aborts within ~200 ms, not after the remaining hundred seconds of
      // fetches. We loop ourselves rather than calling translationApi.translateBatch
      // so the staleness check can interleave with the network calls.
      loadProgress.value = 60;
      const newTranslations: Array<{ key: string; translation: string; hash: string }> = [];

      for (let i = 0; i < stillMissingKeys.length; i++) {
        if (isStale()) return;
        const key = stillMissingKeys[i]!;
        const sourceText = getSourceText(key);

        const translated = await tryTranslateOneKey(sourceText, key, language);
        if (isStale()) return;
        if (translated === null) continue; // per-key failure → log + skip

        const hash = hashMap[key] || '';
        newTranslations.push({ key, translation: translated, hash });
        translationsMap.set(key, translated);
        translations.value = new Map(translationsMap);
        loadProgress.value = 60 + Math.round(((i + 1) / stillMissingKeys.length) * 30);

        // 200 ms throttle between calls — MyMemory free-tier rate limit. Do
        // NOT remove without subscribing to a paid tier first.
        if (i < stillMissingKeys.length - 1) {
          await new Promise<void>((resolve) => setTimeout(resolve, 200));
          if (isStale()) return;
        }
      }

      loadProgress.value = 90;

      // ─── Phase 5: persist new entries ───
      if (isStale()) return;
      if (newTranslations.length > 0) {
        await translationCache.saveTranslationsWithHash(newTranslations, language);
      }

      loadProgress.value = 100;
    } catch (err) {
      // Catastrophic failure (JSON fetch dead, IndexedDB unavailable, etc.).
      // Stale loads already returned earlier — this catch only fires for the
      // active load, so we surface it loudly.
      if (isStale()) return;
      handleCatastrophicLoadError(language, err);
      // Fallback: drop back to English if we never managed to apply anything
      if (translations.value.size === 0) {
        currentLanguage.value = 'en';
      }
    } finally {
      // Only the active load clears the spinner — stale aborts must not
      // reset isLoading while a newer load is still running.
      if (!isStale()) {
        isLoading.value = false;
      }
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
