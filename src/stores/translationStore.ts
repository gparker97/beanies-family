import { defineStore } from 'pinia';
import { ref, shallowRef, computed } from 'vue';
import { UI_STRINGS, BEANIE_STRINGS } from '@/services/translation/uiStrings';
import type { UIStringKey } from '@/services/translation/uiStrings';
import type { LanguageCode } from '@/types/models';
import { reportError } from '@/utils/errorReporter';
import { isChunkLoadError } from '@/utils/hardReload';
import { showToast } from '@/composables/useToast';

type Strings = Readonly<Record<UIStringKey, string>>;

/**
 * One lazy loader per non-English language. Each language is a hand-authored
 * sibling module of `uiStrings.ts` (`zh.ts` → `ZH_STRINGS`), imported only
 * here so Vite emits it as its own chunk (precached by the service worker) and
 * the main bundle does not grow. Adding a language is one entry here, one
 * `LanguageCode` member and one module.
 */
const LOADERS: Record<Exclude<LanguageCode, 'en'>, () => Promise<Strings>> = {
  zh: async () => {
    // Destructure deliberately: a rotated chunk that resolves to null (the iOS
    // shape recorded in hardReload.ts) then throws "Cannot destructure ... null",
    // which isChunkLoadError matches, so the failure is reported as
    // `error_code: 'chunk_load'`; a property read would throw "Cannot read
    // properties of null", which it does not, and the report would misclassify.
    const { ZH_STRINGS } = await import('@/services/translation/zh');
    return ZH_STRINGS;
  },
};

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
  // shallowRef: a 5,000+ key record must not be wrapped in a deep reactive
  // proxy on every switch; null means "English, no table loaded".
  const translations = shallowRef<Strings | null>(null);
  const isLoading = ref(false);
  const beanieMode = ref(true);

  // Getters
  const isEnglish = computed(() => currentLanguage.value === 'en');

  // Cancellation token — closure-scoped (not in store state). Every
  // loadTranslations call captures `++activeLoadToken` at start; later
  // staleness checks compare against it.
  let activeLoadToken = 0;

  /**
   * Surface a catastrophic failure: the language chunk failed to load, for any
   * reason. This store never hard-reloads on a load failure, a rotated chunk
   * included, because the load may be a language switch made mid-session and
   * replacing the page would lose unsaved work. The user keeps a toast and
   * English; the chunk-load shape is still told apart in the report
   * (`error_code: 'chunk_load'`). Other recovery paths (App.vue's init catch,
   * `router.onError`, `vite:preloadError`) keep their own reload behaviour. Stale-load failures are silently abandoned by
   * the caller BEFORE reaching this; this function only runs for the active load.
   *
   * Firehose only (`severity: 'error'`): the app degrades to English. The
   * language travels in the message; `language` is not an allowlisted context
   * key and would be redacted.
   */
  function handleCatastrophicLoadError(language: LanguageCode, err: unknown): void {
    const wrapped = err instanceof Error ? err : new Error(String(err));
    console.error('[translationStore] loadTranslations failed:', wrapped);

    reportError({
      surface: 'translation-load',
      severity: 'error',
      message: `Translation load failed for ${language}`,
      error: wrapped,
      context: { error_code: isChunkLoadError(err) ? 'chunk_load' : wrapped.name || 'unknown' },
    });

    showToast('error', t('error.translationLoadFailed'), t('error.translationLoadFailedHelp'));
  }

  /**
   * Load a language: one dynamic import of its hand-authored module, then the
   * switch. Never blocks the caller — the click handler fires this and moves
   * on. A mid-load language switch supersedes this load via `activeLoadToken`,
   * so a stale load returns without writing state.
   */
  async function loadTranslations(language: LanguageCode): Promise<void> {
    // English is the source language — no table to load
    if (language === 'en') {
      activeLoadToken++; // bump so any in-flight non-English load becomes stale
      translations.value = null;
      currentLanguage.value = 'en';
      isLoading.value = false;
      return;
    }

    const myToken = ++activeLoadToken;
    const isStale = () => myToken !== activeLoadToken;

    try {
      isLoading.value = true;
      const table = await LOADERS[language]();
      if (isStale()) return;
      translations.value = table;
      currentLanguage.value = language;
    } catch (err) {
      // Stale loads are abandoned silently — a newer load owns the UI now.
      if (isStale()) return;
      // Every failure, a rotated chunk included, degrades to a toast + English;
      // never a hard reload (see handleCatastrophicLoadError).
      handleCatastrophicLoadError(language, err);
      // Fallback: stay in English if no table was ever applied
      if (translations.value === null) {
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
   * Returns English text if no table is loaded.
   *
   * BEANIE_STRINGS are an English-only cosmetic overlay, shown only when the
   * language is English and beanie mode is enabled. They never apply to another
   * language.
   */
  function t(key: UIStringKey): string {
    if (currentLanguage.value === 'en') {
      if (beanieMode.value && BEANIE_STRINGS[key]) {
        return BEANIE_STRINGS[key]!;
      }
      return UI_STRINGS[key];
    }
    return translations.value?.[key] ?? UI_STRINGS[key];
  }

  /**
   * Set beanie mode on or off.
   * Only affects display when language is English.
   */
  function setBeanieMode(enabled: boolean): void {
    beanieMode.value = enabled;
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
    beanieMode,
    // Getters
    isEnglish,
    // Actions
    loadTranslations,
    t,
    setBeanieMode,
    setLanguageSync,
  };
});
