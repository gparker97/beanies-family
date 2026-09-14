import type { ShareKind } from '@/types/magicPayload';

/**
 * The three things magic beans can make, declared ONCE.
 *
 * Keyed on `ShareKind` — the vocabulary the rest of the system already uses — rather than on a
 * product noun, so a fourth reader is a **compile error** here rather than a tile that silently
 * never lights. `MAGIC_READERS` stays the registry of record; this is only how a kind is drawn.
 *
 * TWO renderings of one vocabulary, because two components need different art:
 *   · `emoji` for the destination tiles in the sheet and the reading overlay
 *   · `icon`  (a BeanieIcon name) for `ChoiceModal`, which renders `<BeanieIcon>` and cannot
 *     show an emoji at all
 *
 * The accessible name is derived, never stored here: `t(\`ai.capture.dest.${kind}\`)`. That
 * template-literal type only resolves while `kind` is narrowed to `ShareKind`, so iterate with
 * `KINDS` below and never a bare `Object.keys`, which widens to `string[]` and quietly takes
 * the compile-time guarantee with it.
 */
export const MAGIC_DESTINATIONS: Record<ShareKind, { emoji: string; icon: string }> = {
  event: { emoji: '📅', icon: 'calendar' },
  travel: { emoji: '✈️', icon: 'plane' },
  recipe: { emoji: '🍳', icon: 'recipe' },
};

/** Iteration order for the tiles. Typed, so the `t()` key stays a compile-checked literal. */
export const MAGIC_DESTINATION_KINDS = Object.keys(MAGIC_DESTINATIONS) as ShareKind[];
