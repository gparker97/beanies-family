/**
 * Resolve a bilingual `{ en, beanie }` value to a string for the active mode.
 *
 * The `beanie` variant (the all-lowercase cosmetic overlay) shows when beanie
 * mode is on — the default; `en` otherwise. Centralises the switch that was
 * duplicated across release-note content, BeanTip cards, and notification
 * summaries, so there is one place that knows the rule.
 *
 * Reactive: `txt()` reads `beanieMode` at call time, so using it inside a
 * template or `computed` tracks the dependency and re-resolves on toggle.
 */
import { useSettingsStore } from '@/stores/settingsStore';

export interface BeanieText {
  en: string;
  beanie: string;
}

export function useBeanieText() {
  const settings = useSettingsStore();
  const txt = (val: BeanieText): string => (settings.beanieMode ? val.beanie : val.en);
  return { txt };
}
