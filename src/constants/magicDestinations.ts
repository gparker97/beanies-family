import type { ShareKind } from '@/types/magicPayload';

/**
 * The four things magic beans can make, declared ONCE.
 *
 * Keyed on `ShareKind` — the vocabulary the rest of the system already uses — rather than on a
 * product noun, so a fourth reader is a **compile error** here rather than a tile that silently
 * never lights. `MAGIC_READERS` stays the registry of record; this is only how a kind is drawn.
 *
 * ⭐ ADDING A NEW AI KIND — THIS MODULE IS THE CHECKLIST, and every item is a compile error
 * rather than a review question. A fourth kind needs, in total:
 *
 *   1. a `ShareKind` member                       (`types/magicPayload.ts`)
 *   2. a `SharePayload` arm                       (same file — the union is discriminated)
 *   3. a `MAGIC_READERS` entry                    (`composables/useMagicReader.ts` — where it routes)
 *   4. an entry HERE                              (this `Record<ShareKind, …>` will not compile without one)
 *   5. an `ai.capture.dest.<kind>` string         (`uiStrings.ts` — its accessible name)
 *   6. an `ai.capture.pick.as.<kind>` string      (`uiStrings.ts` — "we'll read this as a …", #108)
 *   7. an `ai.capture.noun.<kind>` string         (`uiStrings.ts` — "an activity", in a sentence)
 *   8. a `.magic-tick:nth-child(n)` delay         (`style.css` — the overlay's ticking stagger)
 *
 * 1-4 fail the build; 5-7 fail it too, via the template-literal keys. 8 does not: without it
 * the new tile pulses in step with the first. Beyond those: the magic-beans sheet, the reading overlay AND the "not right?"
 * correction surface all ITERATE this module rather than listing kinds, so all three pick the
 * new kind up at once. Nothing server-side changes either — the meter and the grant are
 * kind-agnostic.
 *
 * ONE rendering, used three times. `emoji` is what every surface draws: the optional pick
 * tiles in the sheet (#108 — tappable, none selected by default), ticking then resolving in
 * the overlay, and the choices in the correction surface.
 * ⚠️ There was a second, `icon` (a BeanieIcon name), for when the correction opened a
 * `ChoiceModal`. It is gone with that modal, and deliberately: BeanieIcon is a monochrome
 * stroke glyph and the tiles read as DISABLED next to the coloured ones everywhere else. If a
 * surface ever needs a line icon, give it its own map — do not re-widen this one and leave two
 * vocabularies for one idea.
 *
 * The accessible name is derived, never stored here: `t(\`ai.capture.dest.${kind}\`)`. That
 * template-literal type only resolves while `kind` is narrowed to `ShareKind`, so iterate with
 * `KINDS` below and never a bare `Object.keys`, which widens to `string[]` and quietly takes
 * the compile-time guarantee with it.
 */
export const MAGIC_DESTINATIONS: Record<ShareKind, { emoji: string }> = {
  event: { emoji: '📅' },
  travel: { emoji: '✈️' },
  recipe: { emoji: '🍳' },
  transactions: { emoji: '🏦' },
};

/** Iteration order for the tiles. Typed, so the `t()` key stays a compile-checked literal. */
export const MAGIC_DESTINATION_KINDS = Object.keys(MAGIC_DESTINATIONS) as ShareKind[];
