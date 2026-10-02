import { computed } from 'vue';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { useTranslationStore } from '@/stores/translationStore';

/**
 * Composable for accessing translations in Vue components.
 *
 * Resolution order for `t(key)`:
 * 1. If language === 'en' && beanieMode && key has beanie override → beanie string
 * 2. If language === 'en' → UI_STRINGS[key] (plain English)
 * 3. Otherwise → the loaded language's hand-authored value (e.g. ZH_STRINGS in
 *    `zh.ts`), falling back to UI_STRINGS[key]
 *
 * IMPORTANT: BEANIE_STRINGS are an English-only cosmetic overlay, shown only
 * when language is English and beanie mode is enabled. They are never the
 * source for another language.
 *
 * Usage:
 * ```vue
 * <script setup>
 * import { useTranslation } from '@/composables/useTranslation';
 * const { t } = useTranslation();
 * </script>
 *
 * <template>
 *   <h1>{{ t('dashboard.netWorth') }}</h1>
 * </template>
 * ```
 */
export function useTranslation() {
  const translationStore = useTranslationStore();

  /**
   * Get the translated text for a UI string key.
   * Returns English text if translation not available.
   */
  function t(key: UIStringKey): string {
    return translationStore.t(key);
  }

  return {
    t,
    currentLanguage: computed(() => translationStore.currentLanguage),
    isLoading: computed(() => translationStore.isLoading),
    isEnglish: computed(() => translationStore.isEnglish),
    isBeanieMode: computed(() => translationStore.beanieMode),
  };
}
