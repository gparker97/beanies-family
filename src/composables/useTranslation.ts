import { computed } from 'vue';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { useTranslationStore } from '@/stores/translationStore';

/**
 * Composable for accessing translations in Vue components.
 *
 * Resolution order for `t(key)`:
 * 1. If language === 'en' && beanieMode && key has beanie override → beanie string
 * 2. If language === 'en' → UI_STRINGS[key] (plain English)
 * 3. Otherwise → translated string from translationStore (always sourced from UI_STRINGS, never BEANIE_STRINGS)
 *
 * IMPORTANT: The translation pipeline always uses UI_STRINGS (plain English)
 * as the source text. BEANIE_STRINGS are never translated and are only shown
 * as a cosmetic overlay when language is English and beanie mode is enabled.
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
    loadProgress: computed(() => translationStore.loadProgress),
    isEnglish: computed(() => translationStore.isEnglish),
    isBeanieMode: computed(() => translationStore.beanieMode),
  };
}
