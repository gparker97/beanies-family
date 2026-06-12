import { computed } from 'vue';
import { useSettingsStore } from '@/stores/settingsStore';
import { isFlagEnabled } from '@/config/flags';

/**
 * Single source of truth for "The Beanie Lab" visibility.
 *
 * The Lab is a per-device opt-in (settingsStore.beanieLabEnabled) that reveals
 * in-development features in Settings. A feature shows only when the Lab is on
 * AND its committed feature flag is alive. Centralizing the gate here (rather
 * than repeating `beanieLabEnabled && isFlagEnabled(...)` in both the Settings
 * page and the BeanieLabSection card list) keeps the card visibility and the
 * drawer / deep-link guards from ever drifting apart — and keeps the single
 * `isFlagEnabled` read in one test-stubbable place.
 *
 * - aiVisible: beanies AI has no dedicated surface flag (the readers keep their
 *   own aiPhotoExtract/aiTravelExtract kill-switches), so it gates on the Lab alone.
 * - calendarVisible: gated on the Lab AND the googleCalendarSync flag, so the
 *   flag still acts as a hard kill-switch even for opted-in Lab users.
 */
export function useBeanieLab() {
  const settingsStore = useSettingsStore();

  const labEnabled = computed(() => settingsStore.beanieLabEnabled);
  const aiVisible = computed(() => labEnabled.value);
  const calendarVisible = computed(() => labEnabled.value && isFlagEnabled('googleCalendarSync'));

  return { labEnabled, aiVisible, calendarVisible };
}
