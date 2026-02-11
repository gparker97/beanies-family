import { computed } from 'vue';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { useTranslationStore } from '@/stores/translationStore';

/**
 * Composable for accessing translations in Vue components.
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
  };
}
