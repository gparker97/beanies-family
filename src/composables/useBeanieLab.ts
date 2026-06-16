import { computed } from 'vue';
import { useSettingsStore } from '@/stores/settingsStore';
import { isFlagEnabled } from '@/config/flags';

/**
 * Single source of truth for "The Beanie Lab" visibility.
 *
 * Two layers, both centralized here so the card list, the section's mount-point
 * guard, and SettingsPage's drawer / deep-link guards can never drift — and so
 * each `isFlagEnabled` read lives in exactly one test-stubbable place:
 *
 *  - AVAILABILITY (hasAnyLabFeature / *Available): does a feature EXIST to opt
 *    into, independent of the per-device opt-in? Drives whether the whole
 *    section renders — it must show for users who have NOT opted in yet, so
 *    they still can. AI has no dedicated surface flag, so it is "available"
 *    while EITHER reader kill-switch (aiPhotoExtract / aiTravelExtract) is
 *    alive; calendar gates on googleCalendarSync.
 *  - VISIBILITY (aiVisible / calendarVisible): available AND opted in. Drives
 *    the individual cards and their drawers. Derived from the availability
 *    computeds (not a second flag read), preserving the invariant:
 *    section hidden ⟹ no feature can be visible or mount.
 *
 * INVARIANT — keep in sync when adding a Lab feature: hasAnyLabFeature must be
 * the OR of exactly the *Available terms that back BeanieLabSection.labFeatures.
 * Adding a feature is THREE coupled edits: its *Available computed here, OR it
 * into hasAnyLabFeature here, and its labFeatures entry in BeanieLabSection.
 * If they desync, the section can hide while a card wants to show.
 */
export function useBeanieLab() {
  const settingsStore = useSettingsStore();

  const labEnabled = computed(() => settingsStore.beanieLabEnabled);

  const aiAvailable = computed(
    () => isFlagEnabled('aiPhotoExtract') || isFlagEnabled('aiTravelExtract')
  );
  const calendarAvailable = computed(() => isFlagEnabled('googleCalendarSync'));

  const hasAnyLabFeature = computed(() => aiAvailable.value || calendarAvailable.value);

  const aiVisible = computed(() => labEnabled.value && aiAvailable.value);
  const calendarVisible = computed(() => labEnabled.value && calendarAvailable.value);

  return { labEnabled, hasAnyLabFeature, aiVisible, calendarVisible };
}
