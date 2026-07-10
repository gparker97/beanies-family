/**
 * Mode-agnostic UI-string matchers for the promo recording.
 *
 * The recorded app renders BEANIE strings by default (`settingsStore.beanieMode`
 * coalesces to `true`), but a device with the toggle off renders plain `en`. The
 * e2e `ui()` helper only resolves `en`, so using it here would silently miss every
 * label whose beanie value differs — which is exactly the bug that stalled the
 * first take (`nav.overview` is "Overview" in en but "finance corner" in beanie).
 *
 * These helpers match EITHER value, so the take is correct in both modes and a
 * copy change to one variant can't quietly break the recording.
 */
// Relative, not the `@/` alias: nothing in tsconfig maps `@/*` for files under
// `scripts/`, and these are RUNTIME imports (the e2e helpers get away with `@/`
// only because theirs are type-only and erased at transpile). `uiStrings.ts` has
// no imports of its own, so pulling it in here is free.
import {
  UI_STRINGS,
  BEANIE_STRINGS,
  type UIStringKey,
} from '../../src/services/translation/uiStrings';

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Both display variants of a key, de-duplicated. Throws on an unknown key. */
function variants(key: UIStringKey): string[] {
  const en = UI_STRINGS[key];
  if (!en) throw new Error(`Unknown UI string key: "${key}"`);
  const beanie = BEANIE_STRINGS[key] ?? en;
  return [...new Set([en, beanie])];
}

/** Anchored match — for `aria-label`, which is exactly the string. */
export function labelExact(key: UIStringKey): RegExp {
  return new RegExp(`^\\s*(${variants(key).map(escapeRe).join('|')})\\s*$`, 'i');
}

/**
 * Unanchored match — for card text, whose element may also contain a badge
 * count or an emoji sibling alongside the label.
 */
export function labelLoose(key: UIStringKey): RegExp {
  return new RegExp(`(${variants(key).map(escapeRe).join('|')})`, 'i');
}
