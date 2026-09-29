import type { ShareKind, SharePayload } from '@/types/magicPayload';
import { assertNever } from '@/utils/assertNever';

/**
 * The things magic beans can make, declared ONCE.
 *
 * Keyed on `ShareKind` (the vocabulary the rest of the system already uses) rather than on a
 * product noun, so a new reader is a **compile error** here rather than a tile that silently
 * never lights. `MAGIC_READERS` stays the registry of record; this is only how a kind is drawn.
 *
 * ⭐ ADDING A NEW AI KIND: THIS MODULE IS THE CHECKLIST. A new kind needs, in total:
 *
 *   1. a `ShareKind` member                       (`types/magicPayload.ts`)
 *   2. a `SharePayload` arm                       (same file; the union is discriminated)
 *   3. a `ShareExtractionResult` arm              (`services/ai/types.ts`)
 *   4. a `MAGIC_READERS` entry + `ReaderShareKind` (`composables/useMagicReader.ts`: where it routes)
 *   5. an entry HERE                              (this `Record<ShareKind, …>` will not compile without one)
 *   6. an `ai.capture.dest.<kind>` string         (`uiStrings.ts`: its accessible name)
 *   7. an `ai.capture.pick.as.<kind>` string      (`uiStrings.ts`: "we'll read this as a …", #108)
 *   8. an `ai.capture.noun.<kind>` string         (`uiStrings.ts`: "an activity", in a sentence)
 *   9. the prompt, in ALL THREE copies            (`services/ai/extractionPrompt.ts`,
 *                                                  `scripts/spikes/extractionPrompt.mjs`,
 *                                                  `infrastructure/lambda/ai-extract/extractionPrompt.mjs`:
 *                                                  `SHARE_JSON_SHAPE`, the builder, a `PROMPT_VERSION` bump)
 *  10. a parser case                              (`parseShareExtractionResult`; `assertNever` closes it)
 *  11. the Lambda's `SHARE_KINDS`                 (`correctionGrant.mjs`, so a correction may name it)
 *
 * 1-5 and 10 fail the build; 6-8 fail it too, via the template-literal keys. 9 and 11 are held
 * by tests: the drift test pins the three prompt copies to each other, and a sync test pins
 * `SHARE_KINDS` to `MAGIC_DESTINATION_KINDS`. The overlay's ticking stagger is indexed by a
 * `--tick-i` custom property, so a new tile needs no CSS. Beyond those: the magic-beans sheet,
 * the reading overlay AND the "not right?" correction surface all ITERATE this module rather
 * than listing kinds, so all three pick the new kind up at once. The meter and the grant are
 * kind-agnostic.
 *
 * ⭐ COMPANIONS (#113). One read can return a primary kind AND companions: an activity plus the
 * to-dos the note asks for. The primary `kind` stays a single scalar, so every single-kind
 * guard (the Lambda and client wrong-kind guards, the correction grant, `pendingMagic`,
 * `readerForShareKind`) is unchanged. `SHARE_COMPANIONS` below is the allow-list. A new
 * companion needs, in total:
 *
 *   a. an entry in `SHARE_COMPANIONS`, AND the same data in `PROMPT_SHARE_COMPANIONS` in all
 *      three prompt copies (a sync test pins them together)
 *   b. an optional field on the primary kind's `SharePayload` and `ShareExtractionResult` arms
 *   c. a parser branch in `parseShareExtractionResult`
 *   d. a case in `companionsOf` below
 *   e. a review surface on the destination page
 *
 * ONE rendering, used three times. `emoji` is what every surface draws: the optional pick
 * tiles in the sheet (#108: tappable, none selected by default), ticking then resolving in
 * the overlay, and the choices in the correction surface.
 * ⚠️ There was a second, `icon` (a BeanieIcon name), for when the correction opened a
 * `ChoiceModal`. It is gone with that modal, and deliberately: BeanieIcon is a monochrome
 * stroke glyph and the tiles read as DISABLED next to the coloured ones everywhere else. If a
 * surface ever needs a line icon, give it its own map; do not re-widen this one and leave two
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
  todo: { emoji: '✅' },
};

/** Iteration order for the tiles. Typed, so the `t()` key stays a compile-checked literal. */
export const MAGIC_DESTINATION_KINDS = Object.keys(MAGIC_DESTINATIONS) as ShareKind[];

/**
 * Which companions each PRIMARY kind may carry (#113). The allow-list: the parser accepts a
 * companion object only when it is listed here for the kind the model chose, and the overlay
 * lights only these. A kind with no entry carries none.
 *
 * ⚠️ Each prompt copy holds the same data as `PROMPT_SHARE_COMPANIONS` (they are plain `.mjs`
 * in other runtimes and cannot import this), pinned here by a sync test.
 */
export const SHARE_COMPANIONS: Partial<Record<ShareKind, readonly ShareKind[]>> = {
  event: ['todo'],
};

/**
 * The companions a payload actually carries, with how many items each holds (#113).
 *
 * ONE derivation, read by the ingest state, the `classified` log and the overlay, so "which
 * tiles light" and "what the log counts" cannot disagree. Empty for a single-kind result.
 */
export function companionsOf(payload: SharePayload): { kind: ShareKind; count: number }[] {
  switch (payload.kind) {
    case 'event':
      return payload.todo && payload.todo.items.length > 0
        ? [{ kind: 'todo', count: payload.todo.items.length }]
        : [];
    case 'travel':
    case 'recipe':
    case 'transactions':
    case 'todo':
      return [];
    default:
      return assertNever(payload, 'companionsOf');
  }
}

/**
 * Tile columns for `n` destination tiles, shared by the sheet and the reading overlay.
 *
 * Three across is the row the sheet has always drawn, so up to three kinds stay on one row at
 * EVERY width (fractions, not a minimum track: a `minmax(5.5rem)` grid wrapped the third tile
 * to a half-width orphan at 320px and under Large reading mode). Four sit two by two; more
 * re-flow in rows of three (five is three and two).
 */
export function magicTileCols(n: number): number {
  if (n <= 3) return Math.max(n, 1);
  return n === 4 ? 2 : 3;
}
