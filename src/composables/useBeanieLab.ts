import { computed } from 'vue';
import { useSettingsStore } from '@/stores/settingsStore';
import { isFlagEnabled } from '@/config/flags';

/**
 * Single source of truth for "The Beanie Lab" visibility.
 *
 * AI (Tinfoil readers) is the sole Lab feature — Google Calendar graduated to an
 * official Settings card on 2026-07-03. Two layers, centralized here so the card
 * and SettingsPage's drawer / deep-link guards can't drift, and so the
 * `isFlagEnabled` reads live in one test-stubbable place:
 *
 *  - AVAILABILITY (hasAnyLabFeature): does a feature EXIST to opt into,
 *    independent of the per-device opt-in? Drives whether the whole section
 *    renders — it must show for users who have NOT opted in yet, so they still
 *    can. AI has no dedicated surface flag, so it is "available" while EITHER
 *    reader kill-switch (aiPhotoExtract / aiTravelExtract) is alive.
 *  - VISIBILITY (aiVisible): available AND opted in. Drives the AI card + drawer.
 *    Derived from availability (not a second flag read): section hidden ⟹ card
 *    can't be visible or mount.
 *
 * `hasAnyLabFeature` is intentionally a semantic alias of `aiAvailable` (the
 * section-mount guard) — kept named so the mount site reads clearly and a second
 * Lab feature would slot in as another OR term.
 */
export function useBeanieLab() {
  const settingsStore = useSettingsStore();

  const labEnabled = computed(() => settingsStore.beanieLabEnabled);

  const aiAvailable = computed(
    () => isFlagEnabled('aiPhotoExtract') || isFlagEnabled('aiTravelExtract')
  );

  const hasAnyLabFeature = computed(() => aiAvailable.value);

  const aiVisible = computed(() => labEnabled.value && aiAvailable.value);

  return { labEnabled, hasAnyLabFeature, aiVisible };
}
