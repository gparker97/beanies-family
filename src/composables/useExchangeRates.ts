import { ref, computed } from 'vue';
import {
  updateRatesIfStale,
  forceUpdateRates,
  areRatesStale,
  formatLastUpdate,
} from '@/services/exchangeRate';
import { useSettingsStore } from '@/stores/settingsStore';

export function useExchangeRates() {
  const settingsStore = useSettingsStore();

  // Local state
  const isUpdating = ref(false);
  const updateError = ref<string | null>(null);
  const isStale = ref(false);

  // Computed from store
  const lastUpdate = computed(() => settingsStore.exchangeRateLastFetch);
  const autoUpdateEnabled = computed(() => settingsStore.exchangeRateAutoUpdate);
  const exchangeRates = computed(() => settingsStore.exchangeRates);

  // Format last update for display
  const lastUpdateFormatted = computed(() => formatLastUpdate(lastUpdate.value));

  /**
   * Check if rates are stale and update the isStale ref
   */
  async function checkStaleness(): Promise<void> {
    isStale.value = await areRatesStale();
  }

  /**
   * Refresh rates (force update)
   */
  async function refreshRates(): Promise<boolean> {
    isUpdating.value = true;
    updateError.value = null;

    try {
      const result = await forceUpdateRates();

      if (!result.success) {
        updateError.value = result.error ?? 'Failed to update rates';
        return false;
      }

      // Reload settings to get updated rates
      await settingsStore.loadSettings();
      isStale.value = false;
      return true;
    } catch (e) {
      updateError.value = e instanceof Error ? e.message : 'Failed to update rates';
      return false;
    } finally {
      isUpdating.value = false;
    }
  }

  /**
   * Check and update rates if they are stale
   */
  async function checkAndUpdateIfStale(): Promise<boolean> {
    isUpdating.value = true;
    updateError.value = null;

    try {
      const result = await updateRatesIfStale();

      if (!result.success) {
        updateError.value = result.error ?? 'Failed to update rates';
        return false;
      }

      // Only reload if rates were actually updated
      if (result.ratesUpdated > 0) {
        await settingsStore.loadSettings();
      }

      isStale.value = false;
      return true;
    } catch (e) {
      updateError.value = e instanceof Error ? e.message : 'Failed to update rates';
      return false;
    } finally {
      isUpdating.value = false;
    }
  }

  /**
   * Toggle auto-update setting
   */
  async function setAutoUpdate(enabled: boolean): Promise<void> {
    await settingsStore.setExchangeRateAutoUpdate(enabled);
  }

  /**
   * Clear any error state
   */
  function clearError(): void {
    updateError.value = null;
  }

  return {
    // State
    isUpdating,
    updateError,
    isStale,
    // Computed
    lastUpdate,
    lastUpdateFormatted,
    autoUpdateEnabled,
    exchangeRates,
    // Actions
    checkStaleness,
    refreshRates,
    checkAndUpdateIfStale,
    setAutoUpdate,
    clearError,
  };
}
