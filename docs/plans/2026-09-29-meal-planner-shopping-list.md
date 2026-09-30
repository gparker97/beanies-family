# Plan: Weekly shopping list from the meal planner, with one shared ingredient checklist

> Date: 2026-09-29
> Related issues: Notion tracker #116 (no GitHub issue — `do not create github issue`)
> Plan file: `docs/plans/2026-09-29-meal-planner-shopping-list.md`
> Mockup: `docs/mockups/meal-shopping-list-2026-09-29.html` (direction B "by meal", **revision 4**; approved by greg 2026-09-30)
> Revision 3 of this plan (2026-09-30) supersedes the scaling design: ingredients are listed as written,
> each recipe carries a Cook ×N marker, and duplicates are merged (identical lines automatically, the rest
> by an explicit, free ✨ Find Duplicates).

> **No GitHub issue created.** This plan was approved for direct implementation (greg pre-approved the
> pre-plan → plan → build chain and asked for an autonomous run).

## User Story

As a parent planning the week's dinners, I want to turn the week's recipes into one shopping list that
says how many times each recipe gets cooked and puts shared items on one line, and untick what I already
have, so I shop once without copying ingredients recipe by recipe.

## Context

Families plan the week in the Meal Planner (`src/pages/MealPlannerPage.vue`), but a shopping list can
only be made one recipe at a time, from the recipe page (#88, `RecipeListSheet.vue`, a free-text
textarea). An early adopter asked to pick the week's meals and get one list, and (preferred) to see a
recipe's ingredients as a checklist straight from the planner, without going to the cookbook.

Design history: revision 1 merged like ingredients with rules + magic beans; revision 2 scaled amounts by
who is eating vs servings. Revision 3 (greg, 2026-09-30) settles on: ingredients **as written**, a
**Cook ×N** batch count per recipe (who's eating vs servings) with `(×N)` on each line, and duplicates
merged into one section (identical lines automatically, the rest by an explicit, free ✨ Find Duplicates).
`Recipe.servings` is free text today, so it becomes a number.

Current state (verified 2026-09-29):

- `Recipe.servings?: string` (`src/types/models.ts:1917`), free text ("Serves 4", "4-6", "12 muffins").
  Filled by the form (`RecipeFormModal.vue:97,206,244,417,649-651`), AI capture
  (`recipeExtractionToRecipe.ts:167`), JSON-LD capture (`:203`, from the content-fetch Lambda's
  `pickYield`), share links (`recipeShareLink.ts:74,112,203`, wire key `y`, `str()` decode), and shown raw
  on `RecipeDetailPage.vue:290-293`, `FamilyCookbookPage.vue:450-453`, `SharedRecipePage.vue:169-172`,
  in share text (`recipeShareText.ts:57`) and the refetch diff (`RecipeRefetchModal.vue:38,55-66`,
  `recipeDiff.ts`, `recipeComparable.ts:22`).
- **Old clients crash on a numeric servings.** 0.21.1 (the update floor) and every version since run
  `orUndefined(servings.value)` → `v.trim()` in `RecipeFormModal.vue:407-417`; a stored number makes
  every recipe edit save throw. So the **stored** value must stay a string.
- Automerge fields are last-writer-wins: old clients keep writing free text after any one-time
  conversion, so a one-time backfill cannot hold the field. Parsing **at read time** (one accessor) is the
  only durable conversion.
- `MealPlanEntry` (`models.ts:1987`): `kind`, `recipeId?` (cleared when the recipe is deleted), `date`,
  `slot`, `eaterMemberIds?` (model doc: "absent = everyone"), `guestNames?`. `mealPlanStore.mealsForWeek(
weekDates)` returns the week sorted by date, slot, position. `MealEditModal.vue` edits `eaterIds` /
  `guestNames` refs (empty picker saves `eaterMemberIds: undefined`).
- Lists: `listStore.createList(input)` (`listStore.ts:424`, reports + toasts its own failures),
  `addItem(listId, title)` (`:841`, one item, re-derives completion via module-private
  `deriveCompletion`). **No batch add.** `buildRecipeListSeed` (`utils/listSeed.ts:178`) makes category
  `'out'` (🛒), one-off, `linkedRecipeId`. `splitRecipeIngredients` (`:133`) drops headings (`ends with
':'` and no digit). `useRecipeShoppingLists` finds lists linked to a recipe. No FamilyList picker exists.
- No quantity/fraction parsing or formatting utility exists anywhere in `src/`.
- `TickButton.vue` (`src/components/ui/`) is the tick primitive (`selected`, `label`, `toggle`,
  `aria-pressed`). `MagicTodoReviewDrawer.vue` has the editable draft-row pattern (auto-growing textarea
  in a `.title-grow` grid mirror).
- Telemetry allowlist is `src/utils/diagnosticContext.ts:61-345`. Existing useful keys: `action`,
  `stage`, `kind`, `count`, `ingredient_count`. #88 logs to surface `list-from-recipe`.

## Requirements

1. **Meal Planner header button.** "🛒 Shopping List" beside Share / Export as PDF, for the week on screen
   (desktop week, or the week of the phone's day). Badge = number of distinct existing recipes with
   shoppable ingredients planned that week. Disabled, with a one-line hint (`aria-describedby`), when 0.
   Hidden when the `familyLists` flag is off.
2. **Week drawer grouped by recipe.** One section per distinct recipe, ordered by its first meal. A recipe
   planned more than once is ONE section. Non-recipe meals and meals whose recipe was deleted are ignored.
3. **Ingredients are listed AS WRITTEN.** The app never multiplies, parses or rewrites an amount. There is
   no "As Written" tag and no faint original. (Revision 3 drops all scaling.)
4. **Cook ×N per recipe.** A prominent green marker (`Cook ×3`; a quiet `Cook Once` at 1):
   - People eating at a meal = members picked + guests. **Nobody picked = everyone in the family**
     (every `familyStore.humans` entry, children included, pets excluded) + guests. (Revision 3: this replaces
     "nobody picked = not specified".)
   - Batches for a meal = `ceil(eating / servings)` when servings is known (≥ 1), else **1**.
   - N = the sum of batches over the recipe's meals that week (Tue 5 + Fri 3 eating, serves 4 → 2 + 1 = 3).
   - Section header: recipe name, "Serves N" (or "No servings set, one batch per meal"), one pill per
     meal ("Tue, 5 Eating", "Thu, Everyone (5)"), the Cook marker, the checklist's own tick-all toggle.
5. **Line suffix.** When N > 1, **every** line of that recipe carries ` (×N)` (e.g. `8 taco shells (×3)`,
   `Salt, to taste (×3)`), and the suffix is written into the list item text. N = 1 → no suffix. The
   suffix is part of the line (so it survives into the flat list); editing a line keeps whatever text the
   user leaves.
6. **Duplicates (week drawer only).** One "In More Than One Meal" section at the top of the drawer:
   - **Identical lines merge automatically, no AI.** Two or more lines from different recipes whose text
     is identical after trimming, collapsing whitespace and ignoring case merge into ONE line with the
     batches summed over ALL matching lines, even two from one recipe (`1 cup basmati rice` ×1 + ×2 →
     `1 cup basmati rice (×3)`); the total is always ≥ 2, so a merged exact line always carries a suffix.
   - **✨ Find Duplicates** (explicit, one tap) sends the week's remaining lines to magic beans ONCE. The
     AI only returns GROUPS of line ids that are the same item plus a short item name; it never returns
     amounts. The app writes the merged text deterministically: `{Name}: {line1}{sfx1} + {line2}{sfx2}`
     (e.g. `Ground beef: 500 g ground beef (×3) + 250 g lean ground beef (×2)`), so no number is ever
     invented. Ids the AI returns that do not exist, singleton groups, or a line claimed by two groups are
     dropped (first claim wins).
   - Every merged line shows its source recipes (pills), a small ✨ when magic beans made it, and **Split**,
     which puts the source lines back into their recipe sections. Merged lines are editable and tickable
     like any other line.
   - Nothing merges silently: merged lines are always shown before save.
7. **✨ Find Duplicates presentation** (house magic beans style, mockup rev 4):
   - Full-width card at the top of the drawer body: Heritage Orange → Terracotta gradient, white text,
     `aria-hidden` ✨, the shared `.magic-shimmer` sheen (reduced motion honoured by the existing CSS),
     label "Find Duplicates", a small "Free" tag. No explanatory sentence. Built on the existing
     `MagicBeansQuickCard` look (reuse or extend it; do not hand-roll a second gradient card).
   - States: ready; running ("Finding duplicates…", busy sheen, cannot be tapped twice); done (the card
     goes; the merged section header shows "✨ N found"); done with nothing new (a quiet "✨ No other
     duplicates" line); failed (card stays, the usual extraction error toast, tap again to retry).
   - Shown only when the week has 2+ recipes AND magic beans is available by the same gate the other
     magic beans affordances use (`canReadAny` + AI capability); otherwise no card at all (identical-line
     merges still happen).
   - One run per drawer open; reopening the drawer starts fresh.
8. **Free.** The dedupe task does not count against magic beans usage: the ai-extract meter records it
   in its own "free" counter (still measurable) instead of the charged counter. Abuse rate limits
   (family/IP per hour) still apply. BYOK calls never reach the meter anyway.
9. **Shared ingredient checklist** (all entry points): every line ticked by default, tick/untick one,
   one tick-all toggle per checklist (per section in the week view), edit any line in place
   (auto-growing), add your own line, headings dropped with the existing "N headings skipped" hint.
   Lines emptied by editing are dropped on save; pasted multi-line text becomes several items.
10. **Destination at review** (unchanged from revision 2): New List (default; editable name, blank falls
    back to the default title; who shops; by date, empty by default) or Add to a List (one-off, unfiled
    lists, shopping first, newest first; recurring lists excluded; "No lists yet" when none). No duplicate
    checks against the chosen list. Save label "Create List" / "Add N Items".
11. **Edit-meal drawer.** A recipe meal shows its ingredients as written with that meal's Cook ×N
    (`ceil(eating / servings)` for this meal, live from the drawer's who's-eating state) and the ` (×N)`
    suffix on each line when N > 1. "Add to …" defaults to the newest one-off unfiled shopping list, else
    New List; Add writes immediately (independent of the meal's Save); after Add the button reads "Added"
    and a second tap never makes a second list. No duplicate detection (one recipe).
12. **Who's eating defaults to everyone.** In the edit-meal drawer the family chips show **all members
    picked** when the meal has no stored `eaterMemberIds` (which has always meant everyone). A one-tap
    toggle at the end of the chip row (mockup draws it in the label row; the chip row avoids a new slot in a
    picker used in 23 files) reads **Clear** (unpick all) and, once cleared, **Everyone** (pick all). The
    toggle is an optional feature of `FamilyChipPicker` (multi mode), switched on only here (keys
    `action.clear` / `common.everyone`). Storage is unchanged: all humans picked OR none picked saves
    `eaterMemberIds: undefined` (everyone); a subset saves the subset. Consequence: "Clear then Save"
    saves everyone, so a guests-only meal can no longer be expressed (revision 2 treated it as not set).
13. **Recipe page Shopping List (#88):** the same checklist at the recipe's own lines (no suffix), plus the
    destination control. Review mode unchanged.
14. **Servings becomes a number** (as built in revision 2, unchanged): stored as a digit string,
    `servingsOf` is the only numeric read, number stepper in the recipe form, "Serves N" display.
15. **Magic beans sheet copy** (greg, 2026-09-30): placeholder "Remind me to walk the dog tomorrow at
    10am…", and the house hint badge (`InfoHintBadge`, drawn as "?") beside "Paste anything" explaining what can be pasted and that
    results are reviewed before saving. `InfoHintBadge`'s popover must render above every surface layer
    (it was at `z-[200]`, under the sheet's `top` layer `z-[250]`).
16. **Help Center** updated (see Help Center Coverage). 17. **Observability** (see Observability Coverage).

## Important Notes & Caveats

- **Never store a number in `recipes[*].servings`.** Old clients (≥ 0.21.1) call `.trim()` on it. The
  type stays `string`, so the compiler enforces it; a form-payload test pins `typeof === 'string'`.
- **An untouched save must never rewrite servings.** `recipeComparable` normalises the baseline
  (`servings: normalizeServings(r.servings)`), so an old "12 muffins" recipe edited for something else
  does not silently lose its text, and "Serves 4" vs "4" is not a change. It feeds both the form diff
  (`RecipeFormModal.vue:456`) and the refetch diff (`recipeDiff.ts:95`).
- **`RecipeFormModal` seeds `servingsCount` in BOTH `onEdit` (`:244`) and `applyPrefill` (`:206`)** (the
  "ALL FOUR PLACES" warning at `:106`). When normalisation discards an incoming servings text, drop
  `'servings'` from `inferredTimes` so the InferredHint never shows on a blank stepper.
- **Never read `recipe.servings` for a number or for display directly.** Use `servingsOf` /
  `formatServes`; a raw read shows "Serves 4-6" text or a bare digit.
- **Add to a List is a whole-array write.** `addItems` (like `addItem` today, `listStore.ts:841-848`)
  writes the full `items` array; the worker has no splice op (`docOps.ts:875-878`). Adding 30 items while
  a partner ticks the same list at the shop is last-writer-wins on that array. Not new, but this feature
  makes it likelier: the help text says "add before you go".
- **`CookLog.servings` is unrelated** and stays free text. `CookLogFormModal.vue:218` reuses
  `recipes.placeholder.servings`; give it its own key before that placeholder changes.
- `useRecipeCapture.ts:345` counts filled fields with `Boolean(...)`; `normalizeServings` never returns
  `"0"` or `""`, so that stays correct.
- The share link stays on wire version 1 (bumping it makes old clients refuse the link). The value is
  already a string; decode normalises it.
- The existing AI prompts are **not** changed for servings (conversion happens in the client prefill
  mappers). Revision 3 adds ONE new task (dedupe), so PROMPT_VERSION bumps, all three prompt copies change
  (drift test), and the ai-extract Lambda is applied via `scripts/infra/` (greg OK'd). New clients always
  use the sealed arm, which accepts any task label, so a client shipped before the Lambda still works; its
  dedupe reads are simply counted as charged until the Lambda lands.
- **The AI never returns amounts.** Dedupe results are groups of existing line ids + a name; the merged
  text is built from the source lines. A model answer that references unknown ids is ignored, never
  trusted.
- `RecipeListSheet.vue` lives in `components/pod/` because `components/lists/` must never import domain
  components. The new shared pieces that take a `Recipe` or meals also live outside `lists/`.
- `listStore.activeLists` is member-filtered by the global filter; the destination picker must read
  `listStore.lists` filtered by `!isFiled` so a filter never hides the family's grocery list.
- Ingredient text is never logged (as #88).
- `familyLists` flag gates every entry point (as #88's `canMakeShoppingList`).
- Mobile: the header button row wraps; the drawer is the standard `BeanieFormModal variant="drawer"`.
- Dark mode: every painted surface has a dark partner; the Cook ×N marker uses #1E8449 with white text in
  both modes (≥ 4.5:1); no opacity modifiers on readable text.
- **Purple is To-do only (CIG).** The Find Duplicates card uses the house magic beans gradient, never
  purple.

## Assumptions

> **Review these before implementation.**

1. "Everyone" = every `familyStore.humans` entry (children included, pets excluded), plus guests. greg: "when the 'who's
   eating' number is not specified, assume all family members are eating".
2. Batches are computed per meal (whole batches) then summed, as greg chose.
3. No existing recipe stores a numeric `servings` (the type is `string` everywhere).
4. Identical-line matching (trim, collapse whitespace, case-insensitive) is safe to apply without asking:
   the lines are literally the same text; the merged line keeps the text and sums the batches.
5. The ai-extract pipeline carries the text-only `dedupe` task via `runExtraction` (verified in Pass 2);
   ADR-030 needs a named exception for it (§ G).
6. A shopping list made from the week is not linked to a recipe; single-recipe lists keep
   `linkedRecipeId` (#88). Adding to an existing list never changes its link.
7. The newest one-off unfiled `'out'` list is a good default target for the meal drawer.

## Approach

Implements the approved mockup (`docs/mockups/meal-shopping-list-2026-09-29.html`), sections 1-4. Design
intent is reproduced; every token comes from the beanies theme + CIG.

### A. Servings (one accessor, string storage)

1. `src/utils/recipeServings.ts` (new, pure): `SERVINGS_MAX = 99`; `parseServings(raw)`;
   `servingsOf(recipe)`; `normalizeServings(raw)`; `formatServes(n, t)` → "Serves 4" via
   `fillTemplate(t('recipes.servesN'), { n })`, or `''` when `n` is undefined. One table-driven test.
2. `src/types/models.ts`: `Recipe.servings?: string` keeps its type; doc comment: "digit string written
   by the app since 0.26; older free text parsed by `servingsOf`. Never store a number (pre-0.26
   clients call `.trim()`)." No repository change.
3. `recipeExtractionToRecipe.ts` (`:167`, `:203`): prefill servings = `normalizeServings(...)`; when that
   discards a non-empty text, `'servings'` is also removed from `inferredTimes`. Following
   the existing `taxonomyRejected` pattern, the pure mapper also returns `servingsUnparsed: boolean`
   (non-empty incoming text that yielded no number); `useRecipeCapture` logs it after `times_filled`
   (`:338-370`). `services/ai/types.ts` and the prompt are unchanged (no Lambda change). `times_filled`
   will read lower for "12 muffins" captures (intended, commented).
4. `recipeShareLink.ts`: decode `normalizeServings(str(...))`; encode unchanged (already a string). Wire
   version stays 1.
5. `src/components/ui/NumberStepper.vue` (new; none exists; the mockup draws a −/+ stepper): props
   `modelValue: number | undefined`, `min`, `max`, `unit`, `label`; blank allowed; typed input clamped on
   blur. `RecipeFormModal.vue`: a local `servingsCount = ref(servingsOf(...))` feeds the stepper; save
   writes `servings: servingsCount != null ? String(servingsCount) : undefined` (the form's existing
   `undefined` → clear path).
6. Display via `formatServes(servingsOf(r), t)`: `RecipeDetailPage.vue:290-293`,
   `FamilyCookbookPage.vue:450-453`, `SharedRecipePage.vue:169-172`, `recipeShareText.ts:57` (already
   receives `t`; `RecipeShareModal.vue:62` passes the raw value, unchanged), `RecipeRefetchModal.vue` servings
   row (render the parsed number so "Serves 4-6" vs "4" reads as the same value, not a spurious change).
7. `recipeComparable.ts:22`: baseline `servings: normalizeServings(r.servings)` (one line; see Caveats).
   `recipeDiff` unchanged.
8. `CookLogFormModal.vue:218` gets its own `cookLog.placeholder.servings` key before the recipe
   placeholder key is retired.

### B. Lines, batches and duplicates (pure)

Revision 3 **deletes** the scaler (`src/utils/ingredientScale.ts` + test): nothing parses or rewrites an
ingredient amount.

`src/utils/mealShoppingList.ts` (line building + the everyone rule):

- `seedEaterIds(stored, humanIds)` → the ids the edit drawer shows: stored ids that are still current
  humans, or ALL human ids when none remain (nobody stored = everyone).
- `eaterIdsToStore(picked, humanIds)` → `undefined` when `picked` is empty or contains every human id,
  else the picked ids.
- `eatingCount({ eaterMemberIds, guestNames }, humanIds)` → `{ eating, everyone }`: stored ids that are
  still current humans (all humans when none) + guests. Uses the SAME filter as `seedEaterIds`, so the
  week drawer and the edit drawer can never disagree about a removed member.
- `batchesFor(eating, servings)` → `ceil(eating / servings)` when both ≥ 1, else 1.
- `withBatchSuffix(text, n)` → `n > 1 ? `${text} (×${n})` : text`. The ONE suffix rule. `(×N)` is
  notation, not translated copy, so the util stays pure (no `t()`).
- `ChecklistLine = { id, source?, text, checked, recipeId?, batches, mergedInto?: string, merged?:
'exact' | 'ai', partIds?: string[], recipeIds?: string[] }` (flat; no recursion). A hand edit is
  `text !== withBatchSuffix(source, batches)`; user-added lines have no `source`.
- `buildShoppingLines(recipe, batches)` → `{ lines, headingsSkipped }` via `splitRecipeIngredients`.
- `rebatchLines(lines, n)` → for the meal panel: lines with a `source` whose text is unedited get
  `withBatchSuffix(source, n)`; hand-edited / user-added lines and every `checked` are kept.
- `buildWeekShoppingSections(meals, recipesById, humanIds)` → `{ recipeId, recipeName, servings?, meals:
{ date, slot, eating, everyone, batches }[], batches, lines, headingsSkipped }[]`, ordered by first meal.
- `countWeekShoppingRecipes`, `hasShoppableIngredients`, `linesToTitles` (kept; `linesToTitles` skips
  lines with `mergedInto`).

`src/utils/shoppingMerge.ts` (new, the drawer's state as a pure reducer):

- `WeekShoppingState = { sections, merged: ChecklistLine[] }`.
- `mergeExactDuplicates(state)`: across DIFFERENT recipes, unedited unmerged lines whose source text is
  equal after trim / whitespace-collapse / case-fold get ONE merged line (`text = withBatchSuffix(source,
Σ batches)`, `merged: 'exact'`, `partIds`, `recipeIds`); each part gets `mergedInto`.
- `dedupeCandidates(state)` → `{ payload: { id, text }[], idMap }`: only unedited, unmerged, generated
  lines; opaque short ids `1…N`; `text` = the SOURCE (no suffix). Capped at `DEDUPE_MAX_LINES` lines and
  `DEDUPE_MAX_LINE_CHARS` chars per line (both exported; see § F metering).
- `applyDuplicateGroups(state, groups, idMap)` → `{ state, applied, dropped }`: a group is applied only if
  it has ≥ 2 ids that still map to present, unmerged, unedited lines from ≥ 2 recipes (first claim wins);
  the name is whitespace-collapsed; `text = name + ': ' + parts.map((p) => p.text).join(' + ')` (part
  texts already carry their suffix); `merged: 'ai'`. Applied against the CURRENT state, so lines edited
  during the run are simply skipped.
- `splitMergedLine(state, id)` → removes the merged line and clears `mergedInto` on its parts. Rules:
  Split discards any edit made to the merged line; parts come back exactly as they were.
- All table-tested. The drawer holds ONE `state` ref and three one-line handlers.

### C. Shared UI + orchestration

Kept from revision 2 (built): `AutoGrowTextarea`, `ListChoiceRow`, `ShoppingListDestination`,
`useShoppingListCommit`, `useOpenList`, `listStore.addItems` / `shoppingDestinations`,
`buildShoppingListSeed`. Revision 3 changes:

- `IngredientChecklist`: renders and toggles only lines without `mergedInto`; drop `originalOf` and the
  As Written tag; add a scoped `#line-extra="{ line }"` slot (the drawer puts recipe pills, the ✨ marker
  and Split there; no domain props, no split emit).
- `MultiplierPill.vue` → renamed `CookCountPill.vue` (2 importers): `Cook ×N` (strong #1E8449, white,
  ≥ 4.5:1 in both modes) or a quiet `Cook Once`; aria "Cook 3 times this week" / "Cook once".
- `FamilyChipPicker`: optional `allToggle` prop (multi mode) rendering a trailing text button in the chip
  row: `action.clear` when every chip is picked, else new `common.everyone`. "All" is measured against the
  picker's own member list. No storage meaning (visual only).
- `src/components/ai/MagicBeansCardButton.vue` (new, extracted from `MagicBeansQuickCard`'s button): props
  `label`, `subtitle?`, `busy?`; `#tag` slot; `busy` → `.magic-shimmer-busy`, `aria-busy`, `disabled`.
  `MagicBeansQuickCard` renders it inside its Door trigger; the drawer uses it directly (it must not
  open the sheet).
- `src/composables/useFindDuplicates.ts` (new): `find(payload)` → `{ status: 'done' | 'declined' | 'failed'
| 'stale', groups? }`; never touches drawer state. Flow (template `useRecipeCapture.processUrl`
  `:419-470`): `requestConsent()` → `resolveBillableFamilyId` → `isOnline` guard → `findDuplicatesInText`
  with `useAiCapability().extractOptions({ grant, familyId, signal })`. ONE per-open run token: the
  `AbortController` of the current open; a result whose controller is not the current one is `stale` and
  dropped (the `useMintedLink.ts:110` pattern). `runExtraction` returns result objects (never throws), so
  there is no speculative try/catch.

### D. Entry points

1. `MealPlannerPage.vue`: header button + badge + hint (built); `countWeekShoppingRecipes` unchanged.
2. `MealWeekShoppingDrawer.vue`: at open, `state = mergeExactDuplicates(fromSections(buildWeek…))`; the
   "In More Than One Meal" section (shown when it has lines or after a run); the `MagicBeansCardButton`
   above it (Req 7 gate + states); Split; save = `commit` over `linesToTitles(merged + sections)`;
   close aborts the run.
3. `MealIngredientsPanel.vue`: `buildShoppingLines(recipe, batches)` then `rebatchLines` when this meal's
   batch count changes; `CookCountPill`; the rest as built.
4. `MealEditModal.vue`: `eaterIds` seeded with `seedEaterIds`; `FamilyChipPicker` with `allToggle`; save
   stores `eaterIdsToStore(eaterIds, humanIds)`; `eating` from `eatingCount`.
5. `RecipeListSheet.vue`: batches 1 (no suffix); `logShoppingSheetOpened` arg `asWritten` → `exactMerges`.
6. `MagicBeansSheet.vue` placeholder + (i), `InfoHintBadge` `z-[300]` (both done).

### E. i18n, accessibility

New keys (`en` + `beanie`): `mealPlanner.shopping.cook.once` ("Cook Once") / `.cook.times` ("Cook ×{n}")

- aria variants, `mealPlanner.shopping.everyonePill` ("{day}, Everyone ({n})"),
  `mealPlanner.shopping.noServingsPerMeal` (kept), `mealPlanner.shopping.dupes.title` ("In More Than One
  Meal"), `.dupes.find` ("Find Duplicates"), `.dupes.free` ("Free"), `.dupes.running` ("Finding
  duplicates…"), `.dupes.found.one/.other` ("{n} found"), `.dupes.none` ("No other duplicates"),
  `ingredients.split` ("Split"), `ingredients.byMagic` (aria "Found by magic beans"), `common.everyone`
  ("Everyone"); reuse `action.clear`. Removed once unread: `ingredients.asWritten`, `ingredients.original`,
  `mealPlanner.shopping.multiplier*`, `.notSetPill`, `.noEaters`. Errors reuse the extraction error toast
  keys. A11y: the card is a `<button>` with `aria-busy`; Split is a button "Split {item}"; the Clear /
  Everyone toggle has no `aria-pressed` (its label names the action, like the tick-all toggle).

### F. AI task, consent and free metering

- **Task `dedupe`.** `findDuplicatesInText(text, opts) => runExtraction(text, opts, 'dedupe')` next to
  `extractRecipeFromText` (`documentExtractionService.ts:206-295,319-324`); covers managed (always
  sealed; prompt from `EXTRACTION_TASKS`, parse via `EXTRACTION_PARSERS`, `managedProvider.ts:463,563`)
  and BYOK (`openaiCompatible.ts:149-154`) with no provider change. `types.ts`: `DedupeExtractionResult
extends AttestedResult { groups: { name: string; lineIds: string[] }[] }` + `dedupe:` in
  `ExtractionResultByTask`. `extractionPrompt.ts`: `DEDUPE_JSON_SHAPE`, `DEDUPE_REQUIRED_KEYS =
['groups']`, `buildDedupeMessages` (via `buildUserMessage` so lines are fenced as untrusted text),
  registry entry `{ buildMessages, requiredKeys, jsonShape, sources: ['text'] }`, `parseDedupeResult` in
  `EXTRACTION_PARSERS` (shape-only; `asString`/`MODEL_FIELD_MAX`, groups ≤ `MODEL_LIST_MAX`). The same
  three prompt pieces in `scripts/spikes/extractionPrompt.mjs` and
  `infrastructure/lambda/ai-extract/extractionPrompt.mjs`; `PROMPT_VERSION` bumped in all three. The
  drift test already loops every task; the sealed-arm `TASK_RE` already admits `dedupe`.
- **Consent (ADR-030 applies).** `ExtractOptions.grant` is required; reuse the generic `requestConsent()`
  (`useDocumentConsent.ts:131`; "don't ask again" honoured). Decline → `info` `find_declined`, the card
  stays. Add a dated "no new exception" note to ADR-030 (like #113's at `:59`).
- **Free metering.** In `meter.mjs` one table `FREE_TASK_MAX_BYTES = new Map([['dedupe', N]])` and an
  early-return `usageAttrFor(read, task)`: correction → `corrected`; task in the table AND the SEALED arm
  AND `read.srcBytes ≤ N` → new `USAGE_ATTRS.freeTask`; else `charged` (an oversized or legacy-arm "dedupe"
  is charged with a `console.warn`; no legacy-arm client has Find Duplicates). Table-tested. `N` is derived from the client caps (`DEDUPE_MAX_LINES` ×
  `DEDUPE_MAX_LINE_CHARS` + prompt + seal overhead, ≈ 16 KB), and a client test asserts the worst-case
  dedupe payload fits under `N`, so prompt growth can never silently turn it charged. The sealed-arm
  task label is client-supplied: a tampered client can still get small free reads; the accepted controls
  are the size bound, the unchanged rate limits and the visible free counter. `lambdaContractParity`
  asserts the table's tasks ⊆ client task keys. Terraform: Lambda code only
  (`-target=module.ai_extract`). `pull_ai_usage.mjs` (`:93-112`) sums `freeTask`. Update the "metering
  label and NOTHING else" comment in `sealedForward.mjs`.
- **Pricing.** Edit the existing `one-magic-bean` FAQ answer (`web/src/lib/pricing.ts:118-120`): finding
  duplicates in a shopping list is free.

### G. Privacy, payload and edge rules (Pass 4)

- **ADR-030 exception (new, dated).** Find Duplicates sends stored cookbook ingredient lines, which is
  family data, and ADR-030 says "never the family dataset" with statements the one named exception
  (`docs/adr/030…md:57`). Add a dated, named exception for "ingredient lines on a shopping list being
  built", scoped to the line texts only. `ConsentRequest` gains `{ kind: 'ingredients' }`
  (`useDocumentConsent.ts:66-69`) whose "what" line reads "Only the ingredient lines on this list: no
  recipe names, dates or who's eating". "Don't ask again" follows the #107 statement precedent. Update
  `src/content/help/security.ts` "What we send" (`:884-891`) and the "every read is one bean" paragraph
  (`:860`, dedupe is free) in the same change.
- **Payload.** JSON `[{ "id": "L1", "text": "…" }]` (string ids `L1…LN`; a line cannot fake an id).
  `parseDedupeResult` accepts ids as strings, or whole numbers via `String()` → `"L" + n` normalisation
  only when they match; `idMap` is a `Map`. Repeated ids inside a group are removed before the ≥ 2 check.
  Names: whitespace collapsed (incl. U+2028/2029), `\p{Cc}\p{Cf}` stripped (bidi), capped at 60 chars;
  an empty name drops the group.
- **Respect the user's choices.** `dedupeCandidates` skips unticked, hand-edited, merged and previously
  Split lines (Split parts get `split: true`); `applyDuplicateGroups` re-checks ticked / unedited / unmerged
  against the current state.
- **Free bound, byte-accurate.** One `DEDUPE_MAX_PAYLOAD_BYTES` measured with `TextEncoder` on the
  serialized payload (not lines × chars); `dedupeCandidates` stops adding lines at the bound. The
  Lambda's `FREE_TASK_MAX_BYTES` for `dedupe` is set with margin above the worst case of the REAL built
  sealed request; `lambdaContractParity.test.ts` reads it from `meter.mjs` (as it reads
  `MANAGED_TEXT_BILL_BOUND`, `:93`), builds the real messages from worst-case lines (quotes, backslashes,
  CJK) and asserts they fit. `usageAttrFor` requires `Number.isFinite(read.srcBytes)` (it defaults to
  `null`, and `null <= N` is true).
- **Checklist with hidden lines.** `IngredientChecklist` computes `visible` (no `mergedInto`) once and
  bases the list, `allChecked`, the toggle's `v-if` and `toggleAll` on it; a section with no visible lines
  collapses to its header with "All in More Than One Meal". New `addable` prop (false for the merged
  section).
- **Card button is a shell.** `MagicBeansCardButton` = gradient, sheen, shadow, `busy`, and a default slot
  wrapped in `relative z-[1]`; each card lays out its own content (quick card column, dupes card row). While
  busy: `aria-disabled` + click guard (not `disabled`, keeps focus). "✨ N found" / "No other duplicates"
  announced in an `aria-live="polite"` region; focus moves to the merged section header when the card
  goes. Re-screenshot the To-do, Activity and Transaction drawers' quick cards (light + dark) after the
  extraction.
- **Gate + flow.** Card shown when `canReadAny && useAiCapability().isConfigured` and 2+ recipes. The Free
  tag shows only on the managed tier (BYOK users pay their provider). Order: `isOnline` +
  `resolveBillableFamilyId` BEFORE `requestConsent` (an offline tap never prompts). Close aborts the run
  AND clears the current controller, so the aborted result is `stale`, not an error toast.
- **i18n fixes.** Cook pill aria "Cook 3 times" / "Cook once" (no "this week"; it is used in the meal
  drawer too). Remove `mealPlanner.shopping.noServings` (it describes scaling); the meal panel uses
  `noServingsPerMeal`. The `(×N)` suffix lives in the editable text (the mockup draws a styled span; as
  with the dropped bold, a textarea cannot style part of its value).
- **Dark mode partners** for: the merged-section background, source pills, the ✨ marker and "N found"
  (`dark:text-accent-lift`), Split, the "No other duplicates" tile, the quiet Cook Once pill.
- **`InfoHintBadge` fixes** (being touched anyway): the trigger button gets an accessible name
  (`common.moreInfo`-style key) and `aria-expanded`; `text-white/85` / `/60` opacity text → ink tokens;
  its 10px text → `text-xs`.
- **Help:** add "everyone is picked by default; Clear to pick just some" and "a merged line's (×N) is the
  total across its recipes".
- **Tests added to the Testing Plan:** `parseDedupeResult` (numeric ids, caps, names), the payload-size
  parity test, `MagicBeansCardButton`, `CookCountPill`, `IngredientChecklist` hidden lines + `addable`,
  `rebatchLines`, `useFindDuplicates` declined / stale / offline-before-consent, consent variant copy.

## Files Affected

- Already built in revision 2 (kept): see the Outcome below and `git status`.
- **Removed:** `src/utils/ingredientScale.ts`, `src/utils/__tests__/ingredientScale.test.ts`.
- **New:** `src/utils/shoppingMerge.ts` (+ test), `src/composables/useFindDuplicates.ts` (+ test),
  `src/components/ai/MagicBeansCardButton.vue` (+ test).
- **Renamed:** `src/components/mealplan/MultiplierPill.vue` → `CookCountPill.vue`.
- **Modified:** `src/utils/mealShoppingList.ts` (+ test), `src/components/pod/IngredientChecklist.vue`,
  `MealWeekShoppingDrawer.vue`, `MealIngredientsPanel.vue`, `MealEditModal.vue`,
  `src/components/ui/FamilyChipPicker.vue`, `src/components/ai/MagicBeansQuickCard.vue`,
  `src/components/pod/RecipeListSheet.vue`, `src/composables/useShoppingListCommit.ts`,
  `src/services/ai/types.ts`, `src/services/ai/extractionPrompt.ts`,
  `src/services/ai/documentExtractionService.ts`, `scripts/spikes/extractionPrompt.mjs`,
  `infrastructure/lambda/ai-extract/{extractionPrompt,meter,ddb,sealedForward}.mjs` + their tests,
  `src/services/ai/__tests__/lambdaContractParity.test.ts`, `docs/adr/030-private-ai-tiered-architecture.md`
  (dated named exception), `src/composables/useDocumentConsent.ts` (`ingredients` variant),
  `src/content/help/security.ts`,
  `.claude/skills/beanies-metrics/scripts/pull_ai_usage.mjs`, `src/services/translation/uiStrings.ts`,
  `src/content/help/features.ts`, `src/content/help/the-pod.ts`, `web/src/lib/pricing.ts`, the browser
  harness `scripts/design-screenshots/meal-shopping-list-capture.ts`, and component tests that asserted
  the removed pill / As Written behaviour.
- Done in this revision already: `src/components/ai/MagicBeansSheet.vue`, `src/components/ui/InfoHintBadge.vue`
  (z-index; its a11y/opacity fixes are in § G).
- Mockup: `docs/mockups/meal-shopping-list-2026-09-29.html` (revision 4).

## Help Center Coverage

- **Update** `features.ts` `planning-your-familys-meals` → "Make a Shopping List for the Week": one section
  per recipe with the ingredients as written; **Cook ×N** says how many batches that week (who's eating vs
  the recipe's servings, whole batches per meal, added up; nobody picked means everyone); lines of a ×N
  recipe end in (×N) so the list says how many lots to buy; identical lines are merged into "In More Than
  One Meal"; **✨ Find Duplicates** (free, doesn't use your magic beans) merges the same item written
  differently, and Split undoes a merge; the meal drawer shows a meal's ingredients; set a recipe's
  Servings to get batch counts.
- **Update** `the-pod.ts` `shopping-list` (recipe page): as built, minus any scaling wording.
- **Pricing** (`web/src/lib/pricing.ts` FAQ): one line that finding duplicates in a shopping list is free.

## Observability Coverage

- **`list-from-recipe`** (kept): `sheet_opened` (week + recipe only; the passive meal panel emits none),
  `list_created` / `items_added` with `kind`, `count` = headings skipped, `ingredient_count`, `stage`,
  `detail` = sections bucket; plus `inferred_count` on `sheet_opened` = exact merges made at open.
  Guard failures as built (`no_current_member`, `recipe_missing`, `add_items_list_missing`).
- **`meal-shopping-dupes`** (new surface): `info` `action: 'find_started'` (`count` = lines sent),
  `'find_done'` (`count` = groups applied, `inferred_count` = groups dropped by validation),
  `'find_declined'` (consent declined), `'split'` (`kind: 'exact'|'ai'`); on failure `logEvent` error
  `action: 'find_failed'` with `error_code`, then `reportExtractionFailure(code, error)` (whose toast
  already reports; no second `reportError`). A stale result (drawer closed or reopened) is dropped
  without an event. Success path logged, so a hit rate and failure rate are
  measurable. Never the ingredient text.
- **ai-extract Lambda:** the `freeTask` counter makes dedupe volume visible in the usage table
  (`pull_ai_usage.mjs` is edited to sum it); an oversized "dedupe" logs a `console.warn` and is charged. The Lambda's existing structured logs cover
  failures; the task name is already a logged field.
- No new client context keys (all allowlisted: `action`, `kind`, `count`, `inferred_count`, `stage`,
  `detail`, `ingredient_count`).

## Acceptance Criteria

- [ ] A week with Tikka (Mon, 4 picked, serves 4), Tacos (Tue 3 picked + 2 guests, Fri 3 picked; serves 4)
      and a Thu stir-fry with nobody picked (family of 5, serves 4) shows Tikka **Cook Once**, Tacos
      **Cook ×3**, Stir-fry **Cook ×2** ("Thu, Everyone (5)"); lines exactly as written, Tacos lines end
      in (×3), Tikka lines have no suffix.
- [ ] `1 cup basmati rice` in Tikka (×1) and Stir-fry (×2) is merged at open into `1 cup basmati rice
(×3)` in "In More Than One Meal", with both recipe pills; Split puts it back.
- [ ] ✨ Find Duplicates (only with 2+ recipes and AI available) runs once, shows the running state, then
      merges e.g. `Ground beef: 500 g ground beef (×3) + 250 g lean ground beef (×2)` with a ✨; a failed
      run leaves the card for a retry with the error toast; nothing merges without being shown.
- [ ] The dedupe call is recorded in the free counter, not the charged one (Lambda test).
- [ ] Unticked lines are not added; edited text is what gets written; the suffix travels into the list.
- [ ] Edit-meal drawer: Tuesday's tacos Cook ×2 with (×2) suffixes; who's eating shows everyone picked
      for a meal with no stored eaters; Clear unpicks all and the link then reads Everyone; saving with
      all picked stores no `eaterMemberIds`.
- [ ] Recipe page Shopping List: the recipe's lines, no suffix.
- [ ] The magic beans sheet shows the new placeholder and a hint badge whose popover sits above the sheet.
- [ ] Servings behaviour from revision 2 unchanged (stepper, digit string, old text parsed).
- [ ] Light + dark, desktop + phone match mockup revision 4 with CIG tokens.
- [ ] Help Center + pricing line updated.
- [ ] Observability events fire as stated.

## Testing Plan

1. Unit: `mealShoppingList.test.ts` (seed/store/eatingCount everyone rule, batches, suffix, `rebatchLines`) and `shoppingMerge.test.ts` (exact merge across
   recipes only, AI group validation incl. bad ids / singletons / double claims, split, suffix sums);
   `useFindDuplicates.test.ts` (success, malformed JSON, provider error → toast + report, telemetry);
   the prompt drift / contract-parity tests with the new task; Lambda `meter` test for the free counter
   (`npm run test:lambda`); `FamilyChipPicker` allToggle; `IngredientChecklist` merged-line pills + Split;
   `MealEditModal` everyone-by-default display + save mapping; existing tests updated for the removed
   scaler.
2. `npm run validate` + `npm run test:lambda` green.
3. Terraform: `scripts/infra/tf-plan.sh -target=module.ai_extract`; apply only the ai-extract Lambda code
   change.
4. Browser harness updated for revision 3 (as-written lines, Cook markers, exact merge, Find Duplicates
   with the AI call mocked at the network/provider boundary, Split, everyone default + toggle, magic beans
   sheet (i) above the sheet); desktop + 390px, light + dark; screenshots reviewed.

## Review Passes

- **Pass 1 (Initial draft)**: drafted from the approved direction-B mockup, greg's scaling rules and two
  code audits (servings end-to-end; lists/meal planner surfaces).
- **Pass 2 (DRY + error handling)**: `encode` option on the generic repository (all write paths, servings only when present); `addItems` reports a missing list; recipe-gone guard kept, duplicate owner guard dropped; extracted `AutoGrowTextarea`, `ListChoiceRow`, `useOpenList`, `NumberStepper`, `shoppingDestinations` getter; headings hint kept; `rescaleLines` keeps hand edits; `formatServes` + `SERVINGS_MAX` single sources; capture logs `servingsUnparsed` via the `taxonomyRejected` pattern.
- **Pass 3 (Sustainability)**: servings stays `string` in type and doc behind one `servingsOf` accessor (drops the repository codec; the compiler now protects old clients); meal feature moved into `MealIngredientsPanel`; `source` on lines makes `rescaleLines` a pure map; plain-text textarea (no fake bold); `kind` telemetry-only, destination single-mode; last-list memory dropped for newest open shopping list; hyphen/`00` guards in the golden table; no re-export shim; whole-array write caveat documented.
- **Rev 3 Pass 4 (Fresh eyes)**: named ADR-030 exception + `ingredients` consent variant + security help; string ids + name sanitising; dedupe respects unticked/split lines; byte-accurate free bound + `isFinite` guard; checklist `visible`/`addable`; card button as a shell with live-region announce; gate/flow order; toggle in chip row, no `aria-pressed`; dark partners; InfoHintBadge a11y; stale scaling text removed.
- **Rev 3 Pass 3 (Sustainability)**: folded § F into §§ B-F (no contradictory text); merged lines hidden in place (`mergedInto`, flat `partIds`) instead of moved; drawer state as a pure reducer in `shoppingMerge.ts` with `dedupeCandidates`; one run token (AbortController) per open; the everyone rule in three helpers sharing one filter; one free-task table with a size bound derived from client caps + test; `FamilyChipPicker` toggle in the chip row (no new slot).
- **Rev 3 Pass 2 (DRY + errors)**: pinned the AI entry point (`runExtraction(...,'dedupe')`), consent via `requestConsent`, free metering bounded by Lambda-measured `srcBytes` (sealed-arm label is unverifiable), `MagicBeansCardButton` extraction, `FamilyChipPicker` `allToggle` + `#label`, everyone = humans (not pets), simplified line model (`parts`, no `scaledText`), full dead-code list, abort/stale-result handling, no double reporting.
- **Revision 3 (2026-09-30)**: greg dropped scaling (ingredients as written), added Cook ×N + (×N) suffixes, duplicates back (exact merge + explicit free ✨ Find Duplicates, AI groups only), everyone-by-default who's eating with Clear/Everyone, magic beans sheet copy + (i). Passes 2-4 re-run on this revision (below).
- **Pass 4 (Fresh-eyes sweep, revision 2)**: fixed `rescaleLines` (explicit fields, ×2→×1→×3 test); recurring lists excluded; guests-only = not set; servings parsed next to the people keyword; wrong-number guard table (%, numbering, commas, glued-unit allowlist, dual measures) and style-preserving formatting; precise As Written rule; baseline normalised in `recipeComparable` (untouched saves never rewrite servings), prefill seeding in both form paths; `addItems` keeps the silent-null contract (report moved to the composable); editable list name, empty due date; panel keyed on recipe update, gated, Added state; `hasShoppableIngredients` extracted; #88 `count` meaning kept; full i18n + a11y list; contradictions removed.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt

"/beanies-pre-plan #116 let's start the plan and build for this - once done move direct to /beanies-plan
and /beanies-build-auto - work autonomously as i'll be aware and only stop for a genuine blocker or
someting requiring a decision. if any questions please ask now"

### Follow-up 1 (intake answers)

Stop for the mockup pick; magic beans merges automatic; OK to apply the ai-extract Lambda; already-on-list
items flagged and unticked. (All superseded by Follow-up 3 except the mockup stop.)

### Follow-up 2

"pls generate the mockup as a claude artifact"

### Follow-up 3

"Thanks this looks very good. However I think we're trying to hard here to merge similar items, and if we
take direction (B) by meal, i think the problem goes away. Since each line in an ingredient list for a
given meal is very unlikely to have duplicated, for simplicity, i think we can drop this requirement for
now. When it comes to a single recipe shopping list there is no need to check for duplicates, and when
creating a shopping list for a full meal planner week, we just need to de-duplicate and count the number
of times each recipe is listed in the meal plan, and multiple the indgredient ammount by those types. In
addition, there is a 'who's eating' section for every recipe, and each recipe should also have a
'servings' field (i.e. serves 8). we can use both of these numbers to determine the amount of ingredients
required in the shopping list. For example if 'who's eating' is 8 people, and the recipe servings is 4,
then the list of ingredients should be multipled by 2 (8 / 4 = 2). We should multiple ingredients by the
smallest whole number to have enough to feed the number of people eating. If we need to fix the
"servings" field from free text to a number, let's do that so the shopping list calculations can be more
accurate. Ultimately, the shopping list for a meal planner week should reflect the list of recipes to be
served (as per direction b) with the number of ingredients based on the number of times that meal will be
served, and the number of people eating each time. If either number if not specified, then we just go
with the default amount listed in the recipe. Let me know if this makes sense and ask questions as
needed."

### Follow-up 4 (answers)

Servings: number field, convert old (first number; "12 muffins" cleared). Multiplier: per meal, then add.
No-amount lines: keep as written. Existing-list duplicates: no flag.

### Follow-up 5 (2026-09-30)

"1) drop the requirement to multiply the quantity numbers. Go back to only listing the recipe as written, and don't add the 'as written' tag 2) add the tag indicating HOW MANY TIMES that recipe would be cooked that week as a clear and prominent marker ... when the 'who's eating' number is not specified, assume all family members are eating. 3) ... just add a multiplier at the end of each line in the shopping list - i.e. 3 russet potatoes (x3). 4) Let's add BACK the requirement to identify duplicates ... one section at the top identifies duplicates ... one basic run with AI i think it enough ... the user can then review and fix the list." (Agreed with refinements: AI groups only, app writes merged text; exact duplicates merge without AI; layout back to direction B's shared section.)

### Follow-up 6 (2026-09-30)

"for who's eating, can you add a small affordance to select/unselect everyone with one tap/click ... rather than having it run automatically ... should we instead have an 'magic beans' type button ... so the AI call becomes explicit"

### Follow-up 7 (2026-09-30)

"1) For who's eating let's just have everyone selected by default, the affordance would read 'clear' initially, and change to everyone again if cleared 2) The purple design ... should we deviate from the CIG ... invoke /frontend-design 3) too much explanation in the find duplicates box ... should we make this free?" (Resolved: house magic beans style, one label + Free tag, free via a separate counter.)

### Follow-up 8 (2026-09-30)

"yes go ahead, make it free and rebuild with /beanies-build-auto" + the magic beans sheet copy change ("remind me to walk my dog tomorrow at 10am", an (i) explaining what can be pasted) + "there seems to be an issue with the info hint badge, it is showing up behind the sidebar. pls check the z-index".

</details>

## Outcome (revision 2 build, superseded in part by revision 3)

> Built 2026-09-29/30 via `/beanies-build-auto`. Not committed (code), not deployed.

- **Built as planned**, with these changes made during the build:
  - **Scaler is an allowlist (one-number rule).** Round 1 and round 2 of `/code-review high` kept finding
    lines scaled to a wrong number ("1-1/2 cups", "1 lb 4 oz", "1 cup plus 2 tablespoons", "8 ounces (225 g)",
    "1 3/2 cups"). Hand-added reject rules were not converging, so `ingredientScale.ts` now scales a line
    only when its leading amount is the ONLY number in it; any second number leaves the line as written
    with the As Written tag. Trade-off: "1 (400 g) can" and "2 x 400g" are no longer scaled.
  - **Servings parser counts only unambiguous headcounts** ("Serves 2 adults and 2 children" is unknown;
    "Per serving: 350 kcal. Serves 4" is 4; "Serves 4 as a main" is 4).
  - **"As Written" tag** only on lines that look like they hold an amount the scaler could not read (a
    digit or a number word); "Salt, to taste" is untagged.
  - **Faint original shows the unit** ("(500 g)").
  - **Meal panel keyed on the recipe id** (a sync no longer resets it); rebuilds only when ingredients
    change; no `sheet_opened` from the passive panel; the Added snapshot is taken before the write.
  - **Phone:** the header button follows the week of the day on screen.
  - **Locale:** new `src/utils/uiLocale.ts` shared by the planner, the week drawer, Who Owns What and the
    card drawer. English dates read "Sep 28".
  - **Contrast:** light-mode green button/badge darkened to #1E8449; the meal drawer's `.mp-label`
    (pre-existing) got a dark partner and a 12px size.
- **Verification:** `npm run validate` green (10290 tests). Browser harness
  `scripts/design-screenshots/meal-shopping-list-capture.ts` walks every acceptance criterion (desktop +
  390px, light + dark) and passes.
- **Review:** round 1 (10 findings, all substantiated and fixed) + browser walk (8 defects, 6 fixed; toast
  overlap and two copy nits left). Round 2 scoped to the fixes (8 findings, all fixed, 5 of them by the
  structural scaler change). No third round (ceiling without greg).
- **Not done:** native iOS/Android check; `public/translations/zh.json` still carries removed keys (the
  translation bot regenerates it); `MealWeekBoard.vue:66` keeps an English-only weekday (pre-existing).

## Outcome (revision 3 build, 2026-09-30)

- **Built** revision 3 as planned: ingredients as written, Cook ×N + `(×N)` line suffixes, "In More Than One
  Meal" (identical lines merged automatically; explicit free ✨ Find Duplicates via the new `dedupe` AI
  task; AI groups only, the app writes merged text), Split + Undo toast, everyone-by-default who's eating
  with Clear / Everyone, long lines wrap everywhere (list rows edit in a single-line auto-growing textarea,
  Enter commits), magic beans sheet copy + hint badge (now above every layer, not faded).
- **Privacy/metering:** dated ADR-030 exception + `ingredients` consent variant (its own "don't ask again",
  never the family-wide document skip); `dedupe` is free only on the sealed arm within a byte bound pinned
  by a parity test (`freeTask` counter). Lambda applied twice via `scripts/infra/` (code-hash only).
- **Removed:** the revision 2 scaler (`ingredientScale.ts`), As Written tag, faint originals.
- **Verification:** `npm run validate` green (10206 tests), `test:lambda` 333/333, browser harness walk
  green (desktop + 390px, light + dark), screenshots reviewed.
- **Review:** round 1 (10 findings, all fixed incl. a legacy-arm free-read hole), round 2 scoped to the
  fixes (9 findings, all fixed). Round-2 fixes were NOT re-reviewed (two-round ceiling).
- **Follow-ups:** a CloudWatch metric filter + alarm for `FREE_TASK_CHARGED_PREFIX` (then add it to
  `ALARMING_PREFIXES`); a Settings control to reset the ingredients "don't ask again"; the meal drawer's
  guest-name input / chip dark styling (pre-existing).
- **Separate change:** expired legacy redirect-transport tripwire removed (`6abeea05`).
