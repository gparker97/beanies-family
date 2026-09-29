# Plan: Weekly shopping list from the meal planner, with one shared ingredient checklist

> Date: 2026-09-29
> Related issues: Notion tracker #116 (no GitHub issue — `do not create github issue`)
> Plan file: `docs/plans/2026-09-29-meal-planner-shopping-list.md`
> Mockup: `docs/mockups/meal-shopping-list-2026-09-29.html` (direction B "by meal", simplified; approved by greg 2026-09-29)

> **No GitHub issue created.** This plan was approved for direct implementation (greg pre-approved the
> pre-plan → plan → build chain and asked for an autonomous run).

## User Story

As a parent planning the week's dinners, I want to turn the week's recipes into one shopping list sized
for who is eating, and untick what I already have, so I shop once without copying ingredients recipe by
recipe.

## Context

Families plan the week in the Meal Planner (`src/pages/MealPlannerPage.vue`), but a shopping list can
only be made one recipe at a time, from the recipe page (#88, `RecipeListSheet.vue`, a free-text
textarea). An early adopter asked to pick the week's meals and get one list, and (preferred) to see a
recipe's ingredients as a checklist straight from the planner, without going to the cookbook.

A first mockup explored merging like ingredients across recipes (rules + magic beans). greg rejected
that as over-engineered: grouping **by recipe** (direction B) removes the need. Instead, amounts scale by
**who is eating** vs the recipe's **servings**, and a recipe planned twice is one section scaled for
both meals. `Recipe.servings` is free text today, so it becomes a number.

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

1. **Meal Planner header button.** "🛒 Shopping List" beside Share / Export as PDF, for the visible week
   (`weekDates`). Badge = number of **distinct existing recipes** planned that week. Disabled, with a
   one-line hint under the button row, when the week has no recipe meals with an existing recipe. Hidden
   when the `familyLists` flag is off (same gate as #88's button).
2. **Week drawer grouped by recipe.** One section per distinct recipe, ordered by the first meal it is
   served at. A recipe planned more than once is ONE section. Non-recipe meals (eat out, leftovers, skip,
   other) and meals whose recipe was deleted are ignored. No merging of ingredients across recipes.
3. **Scaling.**
   - People eating at a meal = picked members (`eaterMemberIds.length`) + guests (`guestNames.length`),
     **but only when at least one member is picked**. No members picked (stored `undefined`, which the
     model reads as "everyone") = not specified, guests or not (counting guests alone would under-scale).
   - Batches for a meal = `ceil(eating / servings)` when both are known (servings ≥ 1, eating ≥ 1),
     else **1** (the recipe's own amounts).
   - A section's multiplier = the **sum** of its meals' batches (Tue 5 + Fri 3 eating, serves 4 → 2 + 1
     = ×3).
   - Each ingredient line with a leading amount is multiplied; lines without one ("Salt, to taste") are
     kept exactly as written. A multiplier of 1 leaves every line byte-identical. No unit conversion.
   - Supported amounts: integers, decimals, `1/2`, `1 1/2`, unicode vulgar fractions (`½ ¼ ¾ ⅓ ⅔ ⅛`,
     also glued as `1½`), a number glued to a unit (`400g`), and ranges (`1-2`, `1–2`, `1 to 2`: both ends
     scaled). Anything else keeps the line as written — never a wrong number.
   - Results keep the input's style: fractions in → whole or mixed numbers with unicode fractions
     (`½ ⅓ ⅔ ¼ ¾ ⅛ ⅜ ⅝ ⅞`, tolerance below 1/24), else up to 2 decimals trimmed; decimals in → decimals
     out (`0.5 kg` ×3 = `1.5 kg`). A range keeps its separator.
   - **Never a wrong number** — these are left as written (and tagged "As Written" when the multiplier is
     above 1): percentages (`2% milk`, `85% lean`), list numbering (`1. 200 g flour`, `1)`), comma numbers
     (`1,5 kg`, `1,000 g`), a number glued to anything outside a closed unit allowlist (`7UP`, `1st`),
     dual measures (`500 g (1 lb)`, `400g/14oz`), hyphenated words (`5-spice`), `00 flour`, word amounts
     (`Two eggs`, `a pinch`). `1 (400 g) can` scales the leading `1` only.
4. **Section header** shows the recipe emoji/name, "Serves N" (or why it is as written), one pill per
   meal ("Tue, 5 eating", or "Thu, Not Set" when that meal has no count), the multiplier pill (`×3`), and
   the checklist's own tick-all toggle. **"As Written"** replaces the pill exactly when `multiplier === 1`
   and a number was missing (servings unset, or some meal not set). Two unset meals sum to ×2 and show
   ×2.
5. **One shared ingredient checklist** (used by all three entry points): every line ticked by default,
   tick/untick one, tick/untick all, edit any line's text in place (auto-growing), add your own line,
   headings dropped (with the existing "N headings skipped" hint, never silent). Lines emptied by editing
   are dropped on save; pasted multi-line text becomes several items. One tick-all toggle per checklist
   (per section in the week view). Lines are plain editable text; when a line was scaled, the original amount
   shows faintly after it (e.g. "1500 g ground beef (500 g)"); when the multiplier is above 1 but a
   line's amount could not be read ("Two eggs", "a pinch"), the line carries a small "As Written" tag so
   the user knows to adjust it.
6. **Destination at review** (one shared control): **New List** (default; an editable name, blank falls
   back to the default title; who shops and by date as #88 today, date empty by default so no reminder is
   armed) or **Add to a List** (a picker of the family's **one-off, unfiled** lists, shopping-category
   lists first, newest first; recurring lists are excluded, or the ingredients would become permanent
   weekly staples). With no such lists, Add to a List is disabled with "No lists yet". Add to a List appends every ticked line; **no duplicate checks**. Save
   label: "Create List" or "Add N Items".
7. **Edit-meal drawer.** A recipe meal whose recipe exists and has ingredients shows an **Ingredients**
   section under the recipe block: the checklist scaled for this meal's live eaters/guests (updates as the
   picker changes, before Save), the multiplier pill, a one-line destination summary ("Add to 🛒 Weekly
   Groceries ▾", opens the same destination control) and an "Add N" button that writes immediately (it
   does not depend on the meal's Save, and it uses the eaters shown even if the meal edit is then
   cancelled). "Add to" defaults to the **newest one-off unfiled `'out'` list** (so a week list made
   earlier is the natural target), else New List. After Add, the destination switches to the list just
   written and the button shows "Added", so a second tap never makes a second list. (No per-device "last used" memory: same result on every device,
   no local state.)
8. **Recipe page Shopping List (#88)** keeps its review mode (lists this recipe already made, Open /
   Start Another), but the create mode's textarea is replaced by the shared checklist (recipe's own
   amounts, ×1) plus the shared destination control.
9. **Servings becomes a number.**
   - The field stays `Recipe.servings?: string` in BOTH the TypeScript type and the doc, normalised to a
     **digit string** ("4") by every new write, so older clients (≥ 0.21.1, which call `.trim()` on it)
     can never crash and the compiler rejects a numeric write anywhere, including hand-built
     `MutationOp`s.
   - One pure parser `parseServings(raw: unknown): number | undefined`: the integer **next to a people
     keyword** ("serves N", "serves N-M" → N, "N servings/people/portions/persons", "feeds N"), else a bare
     number or range ("4", "4-6" → 4). "Makes 2 loaves (16 servings)" → 16; "12 muffins", "Makes 2
     loaves", "", 0, non-integers, above `SERVINGS_MAX` (99) → undefined.
   - `servingsOf(recipe)` = `parseServings(recipe.servings)`: the ONLY way code reads servings as a
     number (scaling, display, the form's initial value).
   - `normalizeServings(raw): string | undefined` = the digit string of `parseServings(raw)`: applied by
     the AI / JSON-LD prefill and share-link decode; the form writes `String(n)` from its stepper.
   - Recipe form: a number stepper ("Serves [− 4 +] people", blank allowed, 1-99) instead of the text
     input. The InferredHint for servings stays.
   - Display: "Serves 4" (i18n, `formatServes`) on the recipe page, cookbook card, shared recipe page,
     share text and the refetch diff. Old clients show the bare "4" (harmless).
   - A recipe with unparseable old text shows no servings in new clients; the raw text stays in the doc
     until that recipe is next saved in the new form (then cleared). No bulk backfill: last-writer-wins
     means old clients would re-write free text anyway, and read-time parsing makes a backfill
     unnecessary.
10. **Help Center** updated (see Help Center Coverage).
11. **Observability** (see Observability Coverage).

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
- The AI prompt is **not** changed (the drift test would force a Lambda redeploy); conversion happens in
  the client prefill mappers. No terraform.
- `RecipeListSheet.vue` lives in `components/pod/` because `components/lists/` must never import domain
  components. The new shared pieces that take a `Recipe` or meals also live outside `lists/`.
- `listStore.activeLists` is member-filtered by the global filter; the destination picker must read
  `listStore.lists` filtered by `!isFiled` so a filter never hides the family's grocery list.
- Ingredient text is never logged (as #88).
- `familyLists` flag gates every entry point (as #88's `canMakeShoppingList`).
- Mobile: the header button row wraps; the drawer is the standard `BeanieFormModal variant="drawer"`.
- Dark mode: every painted surface has a dark partner; the green multiplier pill uses the success tint
  with `dark:text-success-lift`; no opacity modifiers on readable text (the faint original amount uses
  `ink-faint`).

## Assumptions

> **Review these before implementation.**

1. "Who's eating" is members picked + guests, only when at least one member is picked. No members picked
   (stored `eaterMemberIds: undefined`, which the model comments as "everyone") counts as **not
   specified** → the recipe's own amounts, per greg's "if either number is not specified, go with the
   default amount". Guests alone never set the count (that would under-scale "everyone + 2 guests").
2. Picking whole-batch arithmetic per meal then summing is what greg chose ("per meal, then add").
3. No existing recipe stores a numeric `servings` today (the type is `string` everywhere; no writer emits
   a number). `parseServings` still accepts a number defensively.
4. `TickButton.vue` and the `MagicTodoReviewDrawer` auto-grow textarea pattern are still the house
   primitives.
5. A shopping list made from the **week** is not linked to any recipe (`FamilyList.linkedRecipeId` is
   single-valued). Lists made from one recipe (recipe page or meal drawer, New List) keep
   `linkedRecipeId` as #88 does. Adding to an existing list never changes its link.
6. The newest unfiled `'out'` list is a good default target for the meal drawer (typically this week's
   list).

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

### B. Scaling (pure)

`src/utils/ingredientScale.ts` (new, pure, heavily unit-tested):

- `parseLeadingAmount(line)` → `{ amounts: number[] (1, or 2 for a range), start, end } | null`. Built
  as one small token regex per accepted form, not one combined regex. **A number followed by `-` and a
  letter is not an amount** ("5-spice powder" must never become "15-spice powder"); nor is "00 flour".
  The golden table includes these, "2 x 400g", "1 (400 g) can", "½", "1½", "1 1/2", "1-2", "1 to 2",
  "400g", "0.5 kg", "Two eggs", "a pinch".
- `formatAmount(n)` → string (Req 3 rules).
- `scaleIngredientLine(line, factor)` → `{ text, original?: string, unscaled?: true }`. `original` = the
  amount as written, only when scaled; `unscaled` = factor > 1 but no leading amount could be read (the
  checklist tags it "As Written" so the user knows to adjust "Two eggs" / "a pinch"). Factor 1 returns
  the line untouched with no flags.
- `batchesFor(eating?: number, servings?: number)` → integer ≥ 1.

`src/utils/mealShoppingList.ts` (new, pure):

- `eatingCount({ eaterMemberIds, guestNames })` → `undefined` when no member is picked, else members +
  guests. Takes the two fields (not a meal) so the meal panel can pass the drawer's live refs.
- `hasShoppableIngredients(recipe)` (extracted from `RecipeDetailPage.vue:84-88`): used by the recipe
  page, the meal panel, the header badge and the week sections.
- `buildShoppingLines(recipe, factor)` → `{ lines: ChecklistLine[], headingsSkipped }` via
  `splitRecipeIngredients` + `scaleIngredientLine`. Used by all three entry points.
- `buildWeekShoppingSections(meals, recipesById)` → `ShoppingSection[]`:
  `{ recipeId, recipeName, servings?, meals: { date, slot, eating?, batches }[], multiplier,
asWritten, lines, headingsSkipped }`, ordered by first meal; `asWritten = multiplier === 1 && (servings
undefined || some meal's eating undefined)`. Recipes failing `hasShoppableIngredients` are skipped.
- `ChecklistLine = { id, source?, text, scaledText, original?, unscaled?, checked }` (`id` local, for
  keys only; `source` = the ingredient as written, absent on user-added lines; `scaledText` = the last
  generated text, so a re-scale can tell hand edits apart).
- `rescaleLines(lines, factor)` → a pure map: for `line.source && line.text === line.scaledText`, compute
  `r = scaleIngredientLine(line.source, factor)` and assign **explicitly** `text: r.text, scaledText:
r.text, original: r.original, unscaled: r.unscaled` (so ×2→×1 clears the flags and later rescales keep
  working); other lines unchanged; `checked` always kept. Test: ×2 → ×1 → ×3.
- `linesToTitles(lines)` = `lines.filter(l => l.checked).flatMap(l => parseDraftItems(l.text))`
  (`listSeed.ts:146`): drops emptied lines and splits pasted multi-line text; no new cleaner.

### C. Shared UI + orchestration

- `src/components/ui/AutoGrowTextarea.vue` (new, extracted): the `.title-grow` grid-mirror textarea +
  Enter handling from `MagicTodoReviewDrawer.vue:524-538` (CSS `:606-621`, `onTitleEnter` `:285`), with
  `inheritAttrs: false` + `v-bind="$attrs"` on the inner textarea so `data-testid` / `aria-label` /
  `@blur` land where the drawer's tests expect (`MagicTodoReviewDrawer.test.ts:264` uses `setValue`).
  Enter is blocked, paste is allowed. `cleanTitle` / `restoreEmptyTitle` stay in the drawer.
  `MagicTodoReviewDrawer` switches to it in the same change (second use → extract now).
- `src/components/lists/ListChoiceRow.vue` (new, extracted from `RecipeListSheet.vue:335-358`): one
  `FamilyList` row (emoji, title, `progressFor`, open affordance or `selected` outline). No domain imports,
  so it is allowed in `lists/`. Used by `RecipeListSheet` review mode and `ShoppingListDestination`.
- `listStore.shoppingDestinations` (new getter): unfiltered `lists`, one-off (`!isRecurring`) and
  `!isFiled`, category `'out'` first, then the module-private `byCreatedDesc` (`listStore.ts:65`). The
  picker reads it; the meal panel's default is its first `'out'` entry.
- `listStore.addItems(listId, titles)` (new): items from `freshItems(titles)` (`listSeed.ts:23`), one
  `updateList` with completion re-derived by `deriveCompletion` (`:88-113`, reopens a filed one-off) and
  the `cycleCelebrated` reset `addItem` does today. It keeps `addItem`'s silent-null contract (a missing
  list returns null; the repository already reports a concurrent delete at `automergeRepository.ts:199`
  and `wrapAsync` reports a throw; `useWallJobs.ts:255` reports its own `list_add` failure, so reporting
  here would double it). `addItem` becomes `addItems(id, [title])`.
- `utils/listSeed.ts`: `buildRecipeListSeed` → `buildShoppingListSeed({ titles, title, ownerId,
createdBy, dueDate?, linkedRecipeId? })`; closed key set kept; `linkedRecipeId` only when given.
- `src/composables/useOpenList.ts` (new): `openList(id)` moved out of `useRecipeShoppingLists`
  (`:56-58`) and removed from its return; the one importer (`RecipeListSheet.vue:92`), its test (`:117`)
  and the comment at `entityDeepLink.ts:47` are updated. No re-export shim.
- `src/components/pod/IngredientChecklist.vue` (new): v-model `ChecklistLine[]`; rows = `TickButton` +
  `AutoGrowTextarea` (plain text: a textarea cannot bold part of its value, so the mockup's bold amount is
  dropped rather than faked with an overlay) + the faint `(original)` suffix outside the textarea while
  the line is unedited + an "As Written" tag when `unscaled`; one built-in
  tick-all toggle (the `ListDetailModal.vue:270-281,470-479` pattern) rendered in the checklist's own
  header, which takes an optional `title` slot so the week section header puts its name / pills there
  and uses the SAME toggle (no second implementation); labels are new keys `ingredients.tickAll` /
  `ingredients.untickAll` ("Tick All" / "Untick All", as the mockup) because `lists.detail.checkAll`
  reads differently; "Add an item" row; the "N headings skipped" `InferredHint` (moved from
  `RecipeListSheet.vue:133-139,399`; `listSeed.ts:117` requires it be shown). No store access.
- `src/components/pod/ShoppingListDestination.vue` (new): v-model `ShoppingDestination = { mode: 'new';
title; ownerId; dueDate } | { mode: 'existing'; listId }`. New List fields move here from
  `RecipeListSheet.vue` (owner `FamilyChipPicker`, `BeanieDatePicker`, due hint). Add to a List =
  `ListChoiceRow`s over `shoppingDestinations`. One mode only (the meal panel draws its own one-line
  summary and toggles this control).
- `src/composables/useShoppingListCommit.ts` (new): `commit({ destination, titles, linkedRecipeId?,
kind })` → `Promise<FamilyList | null>`. `kind` is telemetry-only; callers pass their own default
  destination and title, so a new entry point never edits this composable.
  - Guards (moved from `RecipeListSheet.vue`): double-tap; no current member (`reportError` `action:
'no_current_member'` + silent toast, as today); recipe gone when `linkedRecipeId` is set (**new**
    `reportError` `action: 'recipe_missing'` with the existing toast; today `RecipeListSheet.vue:244-247`
    only toasts). The owner check is NOT repeated:
    `listStore.createList` already refuses an unresolved owner with its own toast + report
    (`listStore.ts:430-447`; #88's `owner_unresolved` filter becomes `lists`/`create_unknown_owner`).
    A filed target list is allowed (it reopens).
  - Then `createList(buildShoppingListSeed(...))` or `addItems`. On a null from `addItems`, if the list
    is gone from `listStore.lists` → `reportError({ surface: 'list-from-recipe', action:
'add_items_list_missing', severity: 'error' })` + toast "That list was deleted" with help text; a null
    from `createList` is already toasted.
  - On success: the View toast (as #88, via `useOpenList`) and telemetry.

### D. Entry points

1. `MealPlannerPage.vue`: header button + badge + disabled hint; mounts `MealWeekShoppingDrawer`.
2. `src/components/mealplan/MealWeekShoppingDrawer.vue` (new): `BeanieFormModal variant="drawer"`,
   title "Shopping List", subtitle "Week of {date}, {n} recipes, {m} meals"; sections from
   `buildWeekShoppingSections` (snapshot at open); each section a card with the header (Req 4) and an
   `IngredientChecklist`; `ShoppingListDestination` below; save → `commit({ kind: 'week' })`. Default new
   list title "Shopping for {week start}". No `linkedRecipeId`.
3. `src/components/mealplan/MealIngredientsPanel.vue` (new): props `recipe`, `eating: number`. Owns the
   checklist (`buildShoppingLines` then `rescaleLines` when `batchesFor(eating, servingsOf(recipe))`
   changes), the multiplier pill, a one-line "Add to {list} ▾" summary that toggles
   `ShoppingListDestination`, and the Add button → `commit({ kind: 'meal', linkedRecipeId })`. Default
   destination = `shoppingDestinations[0]` else New List. `MealEditModal.vue` gains one element and a
   computed `eating` (from its live `eaterIds` / `guestNames` refs via `eatingCount`), plus one line in
   its header comment ("hosts the read-only ingredients panel; the panel owns its own list write"), so
   the modal keeps owning only MealPlanEntry fields. A test pins that Add is independent of the meal's
   Save / Cancel. The panel is keyed on `recipe.id + recipe.updatedAt` so the nested Edit Recipe
   (`MealEditModal.vue:199`) refreshes it, and it renders only when `familyLists` is on and
   `hasShoppableIngredients(recipe)`. After Add it switches the destination to the list written and shows
   "Added" until the lines or destination change.
4. `RecipeListSheet.vue`: create mode = `IngredientChecklist` + `ShoppingListDestination` +
   `commit({ kind: 'recipe', linkedRecipeId })`; review mode unchanged but rendered with `ListChoiceRow`;
   header comment updated (the textarea rationale is gone; transient line ids are owned by the checklist
   by design).

### E. i18n, accessibility

New keys (`en` + `beanie`, Title Case labels, sentence case for sentences):

- `mealPlanner.shopping.*`: button, disabled hint, badge aria ("{n} recipes this week"), drawer title,
  subtitle with one/other plurals ("Week of {date}, {n} recipe(s), {m} meal(s)"), default list title
  ("Shopping for {date}"), served pill ("{day}, {n} eating"), not-set pill ("{day}, Not Set"), serves
  line, multiplier aria ("Scaled {n} times"), As Written + its reason lines.
- `lists.destination.*`: New List, Add to a List, name label, "Add to {list}", no-lists empty state,
  list-deleted error + help, save labels "Create List" / "Add {n} Item(s)" (one/other), "Added".
- `ingredients.*`: tickAll, untickAll, add-line placeholder ("Add an item"), per-line tick aria and edit
  aria ("Include {item}", "Edit {item}"), asWritten tag.
- `recipes.servesN`, stepper unit "people", stepper −/+ aria ("Fewer" / "More"),
  `cookLog.placeholder.servings`.
- Reworded: `lists.fromRecipe.body` (it describes the textarea). Removed: `lists.fromRecipe.itemsLabel`
  and any key left unread.
- No new glyphs: the "▾" in the mockup becomes the existing chevron icon (`▾` is not in the i18n glyph
  allowlist).

Accessibility: `aria-expanded` on the meal panel's destination summary; `aria-pressed` on New List / Add
to a List; `aria-describedby` from the disabled header button to its hint; the badge carries an
aria-label; `TickButton` supplies `aria-pressed` per line.

## Files Affected

- New: `src/components/mealplan/MealIngredientsPanel.vue`, `src/utils/recipeServings.ts`, `src/utils/ingredientScale.ts`, `src/utils/mealShoppingList.ts`,
  `src/components/ui/NumberStepper.vue`, `src/components/ui/AutoGrowTextarea.vue`,
  `src/components/lists/ListChoiceRow.vue`, `src/components/pod/IngredientChecklist.vue`,
  `src/components/pod/ShoppingListDestination.vue`, `src/components/mealplan/MealWeekShoppingDrawer.vue`,
  `src/composables/useShoppingListCommit.ts`, `src/composables/useOpenList.ts`; a test file for each.
- Modified: `src/types/models.ts` (doc comment only), `src/utils/recipeExtractionToRecipe.ts`,
  `src/composables/useRecipeCapture.ts`, `src/utils/recipeShareLink.ts`, `src/utils/recipeShareText.ts`,
  `src/utils/recipeComparable.ts`, `src/components/pod/RecipeFormModal.vue`, `src/utils/entityDeepLink.ts`
  (comment),
  `src/components/pod/RecipeRefetchModal.vue`, `src/components/pod/CookLogFormModal.vue`, `src/pages/RecipeDetailPage.vue`,
  `src/pages/FamilyCookbookPage.vue`, `src/pages/SharedRecipePage.vue`, `src/pages/MealPlannerPage.vue`,
  `src/components/mealplan/MealEditModal.vue`, `src/components/pod/RecipeListSheet.vue`,
  `src/components/ai/MagicTodoReviewDrawer.vue` (AutoGrowTextarea),
  `src/composables/useRecipeShoppingLists.ts`, `src/utils/listSeed.ts`, `src/stores/listStore.ts`,
  `src/services/translation/uiStrings.ts`, `src/content/help/the-pod.ts`, `src/content/help/features.ts`,
  and the existing tests listed in the Testing Plan (incl. `MagicTodoReviewDrawer.test.ts`,
  `useRecipeShoppingLists.test.ts`, `recipeListSheet.test.ts` (the `owner_unresolved` case becomes
  `lists`/`create_unknown_owner`), `listStore.test.ts` `addItem` cases, `RecipeFormModal` tests).
- Mockup: `docs/mockups/meal-shopping-list-2026-09-29.html` (committed `0d0b1f6c`).

## Help Center Coverage

- **Action**: update existing — **Category**: `features` — `src/content/help/the-pod.ts` section
  `shopping-list`. **Title**: keep. **Scope**: the checklist (untick what you have, edit, add), choosing
  New List or adding to one of your lists, and that it lives on the recipe page. **Notes**: no duplicate
  check when adding to a list.
- **Action**: update existing — **Category**: `features` — `features.ts` `planning-your-familys-meals`:
  new section "Make a Shopping List for the Week" (one section per recipe; amounts sized by who's eating
  vs the recipe's servings, rounded up to whole batches per meal and added up; missing numbers use the
  recipe's amounts; lines with no amount stay as written) and a line on seeing ingredients in the meal
  drawer. **Notes**: set a recipe's Servings to get sizing.
- The cookbook article that mentions servings (`the-pod.ts:527`) says "Serves" is a number now.

## Observability Coverage

- **Surface `list-from-recipe`** (kept, so #88's CloudWatch filter continues), emitted by the three
  openers and `useShoppingListCommit`:
  - `info` `action: 'sheet_opened'`, `kind: 'recipe'|'meal'|'week'`, `count` = sections (1 for
    recipe/meal), `ingredient_count` = lines offered, `inferred_count` = sections with `asWritten` (the
    same definition as the UI), so how often servings / who's eating are unset is measurable.
  - `info` `action: 'list_created'` / `'items_added'`, `kind`, `count` = headings skipped (unchanged
    meaning, so #88's metric keeps its definition), `ingredient_count` = lines written, `stage:
'new'|'existing'`, `detail` = sections as a fixed bucket (`'one' | 'two' | 'three' | 'many'`). Success path, so creation rates and the new/existing split
    are measurable.
  - Guard failures: `reportError` `severity: 'error'`, `action: 'no_current_member' | 'recipe_missing' |
'add_items_list_missing'` (the toast is shown to the user).
- **Surface `lists`**: unknown owner stays `lists` /
  `create_unknown_owner` (existing, from `createList`). Store write failures are already reported and
  toasted by `createList` / `updateList` (`wrapAsync`).
- **Recipe capture** (`useRecipeCapture`, its existing `SURFACE`): when the prefill mapper reports
  `servingsUnparsed` (non-empty incoming servings text, no people count), emit one `info` event
  `action: 'servings_unparsed'`, `kind` (the capture kind already in scope). Mirrors the
  `taxonomyRejected` event that follows `times_filled` (`useRecipeCapture.ts:338-370`), so the parser's
  miss-rate on real captures is a CloudWatch filter. The existing `times_filled` `count` will read lower
  for "12 muffins"-style captures; that is intended and noted in the code comment. The `servingsOf`
  accessor is pure and silent by design (unit-tested; logging on every read would flood the firehose).
- No new context keys (`action`, `kind`, `count`, `ingredient_count`, `stage`, `inferred_count`,
  `detail` all exist in `ALLOWED_CONTEXT_KEYS`, `diagnosticContext.ts`) → no store-declaration change.
- Ingredient text and servings text are never logged.

## Acceptance Criteria

- [ ] A week with Tikka (Mon, 4 eating, serves 4), Tacos (Tue 5 + Fri 3 eating, serves 4) and a Thu
      stir-fry with nobody picked shows three sections: ×1, ×3, and "As Written".
- [ ] `1/2 cup sour cream` ×3 reads `1 ½ cup sour cream` (text after the amount unchanged); `0.5 kg` ×3
      reads `1.5 kg`; "Salt, to taste" unchanged; ×1 lines byte-identical; `2% milk`, `1,000 g`, `500 g
    (1 lb)` are left as written with the tag.
- [ ] Unticked lines are not added; edited text is what gets written; added lines are included.
- [ ] New List creates one `'out'` one-off list with the ticked lines and the typed name; Add to a List
      appends them to the chosen one-off list (reopening it if it was completed); no duplicate prompt; a
      second tap on the meal panel's Add does not create a second list.
- [ ] The edit-meal drawer shows Tuesday's tacos at ×2 and updates when who's eating changes (hand edits
      kept); Add writes immediately and independently of the meal's Save; the destination defaults to
      the newest open shopping list.
- [ ] The recipe page's Shopping List uses the same checklist at ×1; review mode unchanged.
- [ ] Recipe form Servings is a number stepper; a recipe stored as "Serves 4-6" reads 4; "12 muffins"
      reads blank; saving writes the digit string "4" to the doc (never a number).
- [ ] "5-spice powder" ×3 is unchanged; "Two eggs" ×2 carries the As Written tag.
- [ ] An old client (0.21.1 code path) editing a recipe saved by the new client does not crash (stored
      value is a string).
- [ ] Share link round-trips servings; an old-format "Serves 8" link decodes to the digit string "8".
- [ ] Editing an old "12 muffins" recipe's name only does not change its servings text.
- [ ] Recurring lists are not offered in Add to a List; a meal with only guests picked is "Not Set".
- [ ] Header button hidden with `familyLists` off; disabled with the hint when the week has no recipe
      meals.
- [ ] Light + dark, desktop + phone widths match the mockup's intent with CIG tokens.
- [ ] Help Center article(s) listed in **Help Center Coverage** added/updated and verified to match the
      shipped behavior
- [ ] Diagnostic logging in **Observability Coverage** implemented and verified (events fire with the
      stated `surface`/`context`; failure modes are triageable from CloudWatch without a local repro; any
      new context key is allowlisted + declared)

## Testing Plan

1. Unit: `recipeServings.test.ts` (table of inputs), `ingredientScale.test.ts` (fractions, unicode,
   glued units, ranges, decimals, no amount, factor 1 identity, formatting tolerance),
   `mealShoppingList.test.ts` (dedupe, ordering, sum of batches, missing numbers, deleted recipe,
   non-recipe meals), `listSeed.test.ts` (generalised seed), `listStore` `addItems` (completion
   re-derived), `useShoppingListCommit.test.ts` (each guard, both destinations, telemetry),
   `recipeServings` (parse / normalise / format), the form payload's servings is a string, share link and
   prefill conversions, `recipeDiff` treats "Serves 4" and "4" as equal.
2. Component: `IngredientChecklist` (tick, tick all, edit, add, empty dropped), `ShoppingListDestination`
   (both modes), `RecipeListSheet` tests migrated from textarea to checklist, `MealIngredientsPanel`
   (live scaling, edits kept, independent of meal Save), `MealWeekShoppingDrawer` (sections + save label).
3. `npm run validate` green.
4. Browser (Playwright harness under `scripts/design-screenshots/`, not `e2e/specs/`): seed a family
   with the acceptance-criteria week, open the drawer on desktop + 390px, light + dark, create a list and
   add to a list, open the meal drawer, change eaters, open a recipe's Shopping List, edit servings in the
   form; screenshots reviewed.

## Review Passes

- **Pass 1 (Initial draft)**: drafted from the approved direction-B mockup, greg's scaling rules and two
  code audits (servings end-to-end; lists/meal planner surfaces).
- **Pass 2 (DRY + error handling)**: `encode` option on the generic repository (all write paths, servings only when present); `addItems` reports a missing list; recipe-gone guard kept, duplicate owner guard dropped; extracted `AutoGrowTextarea`, `ListChoiceRow`, `useOpenList`, `NumberStepper`, `shoppingDestinations` getter; headings hint kept; `rescaleLines` keeps hand edits; `formatServes` + `SERVINGS_MAX` single sources; capture logs `servingsUnparsed` via the `taxonomyRejected` pattern.
- **Pass 3 (Sustainability)**: servings stays `string` in type and doc behind one `servingsOf` accessor (drops the repository codec; the compiler now protects old clients); meal feature moved into `MealIngredientsPanel`; `source` on lines makes `rescaleLines` a pure map; plain-text textarea (no fake bold); `kind` telemetry-only, destination single-mode; last-list memory dropped for newest open shopping list; hyphen/`00` guards in the golden table; no re-export shim; whole-array write caveat documented.
- **Pass 4 (Fresh-eyes sweep)**: fixed `rescaleLines` (explicit fields, ×2→×1→×3 test); recurring lists excluded; guests-only = not set; servings parsed next to the people keyword; wrong-number guard table (%, numbering, commas, glued-unit allowlist, dual measures) and style-preserving formatting; precise As Written rule; baseline normalised in `recipeComparable` (untouched saves never rewrite servings), prefill seeding in both form paths; `addItems` keeps the silent-null contract (report moved to the composable); editable list name, empty due date; panel keyed on recipe update, gated, Added state; `hasShoppableIngredients` extracted; #88 `count` meaning kept; full i18n + a11y list; contradictions removed.

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

</details>
