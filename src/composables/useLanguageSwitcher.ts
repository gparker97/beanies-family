import { useSettingsStore } from '@/stores/settingsStore';
import { useTranslationStore } from '@/stores/translationStore';
import type { LanguageCode } from '@/types/models';

/**
 * Switch the app language without ever blocking the click handler.
 *
 * The translation store applies the language cosmetically before any API
 * work, so the switch feels instant. We intentionally do NOT `await` the
 * load — awaiting would freeze the user inside the click handler for the
 * entire ~100 s API backfill on a fresh deploy. The store's internal
 * `activeLoadToken` (see translationStore.ts) handles cancellation, so a
 * mid-load language switch supersedes a previous load cleanly.
 *
 * DO NOT add `await` back without revisiting
 * docs/plans/2026-04-30-language-switcher-freeze.md.
 */
export function useLanguageSwitcher() {
  const settingsStore = useSettingsStore();
  const translationStore = useTranslationStore();

  function switchLanguage(code: LanguageCode) {
    // Persist preference + load translations in parallel. Failures of either
    // are logged but never bubble — the catch keeps a network hiccup from
    // rejecting an otherwise-completed UX action.
    settingsStore.setLanguage(code).catch((err) => {
      console.warn('[langSwitcher] settingsStore.setLanguage failed:', err);
    });
    translationStore.loadTranslations(code).catch((err) => {
      console.warn('[langSwitcher] translationStore.loadTranslations failed:', err);
    });
  }

  return { switchLanguage };
}
