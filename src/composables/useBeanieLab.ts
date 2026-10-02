import { computed } from 'vue';
import { useSettingsStore } from '@/stores/settingsStore';
import { isFlagEnabled } from '@/config/flags';

/**
 * Single source of truth for "The Beanie Lab" visibility and for "is magic beans
 * (the AI readers) available".
 *
 * The Lab currently has NO features: Google Calendar graduated to an official
 * Settings card on 2026-07-03 and magic beans graduated the same way (no Beta
 * badge, ordinary Settings card). The machinery stays for the next experimental
 * feature. `isFlagEnabled` reads live here so they stay test-stubbable.
 *
 *  - aiAvailable: either reader kill-switch (aiPhotoExtract / aiTravelExtract) is
 *    alive. Gates the magic beans Settings card, its drawer and its deep link. It
 *    does NOT depend on the Lab opt-in.
 *  - hasAnyLabFeature: does a Lab feature EXIST to opt into? Drives whether the
 *    Lab section renders at all. Currently false; the next experimental feature
 *    slots in as an OR term.
 *  - labEnabled: the per-device opt-in.
 */
export function useBeanieLab() {
  const settingsStore = useSettingsStore();

  const labEnabled = computed(() => settingsStore.beanieLabEnabled);

  const aiAvailable = computed(
    () => isFlagEnabled('aiPhotoExtract') || isFlagEnabled('aiTravelExtract')
  );

  // No Lab features remain. Add the next experimental feature's availability as an OR term.
  const hasAnyLabFeature = computed(() => false);

  return { labEnabled, hasAnyLabFeature, aiAvailable };
}
