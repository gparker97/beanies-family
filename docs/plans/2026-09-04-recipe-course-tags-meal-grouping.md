# Plan: Recipe course, tags, and meal grouping

> Date: 2026-09-04
> Related issues: Notion tracker #87 (no GitHub issue — direct implementation)
> Plan file: `docs/plans/2026-09-04-recipe-course-tags-meal-grouping.md`
> Mockup: `docs/mockups/recipe-course-tags-meal-grouping-2026-09-04.html`

## User Story

As a parent with a growing cookbook, I want to tag recipes by course and meal and then filter or group by them, so I can find the right recipe without scrolling past everything else.

## Context

The cookbook renders every recipe in one flat alphabetical grid — `FamilyCookbookPage.vue:113-115` is a single `[...recipesStore.recipes].sort(byName)` — with no search, filter, sort or grouping of any kind. Past a dozen recipes it becomes hard to find anything, and there is no way to answer "what can we have for breakfast?"

An early adopter asked for this directly, alongside the dish-photo complaint that became #86. greg's decisions on top: course is a _dropdown_ **and** free-form tags (both axes, not one), grouping uses the existing meal slots, and the AI fills course and meal in at capture time.

## Requirements

1. `Recipe` gains `course?: RecipeCourse` (single), `mealSlots?: MealSlot[]` (multi), `tags?: string[]` (lowercase). All optional, so every existing recipe stays valid.
2. Course is one of eight: `starter, main, side, dessert, drink, baking, sauce, other`.
3. Meal reuses the **existing** `MealSlot` union (`breakfast | lunch | dinner | snack`). No brunch. No second enum.
4. Tags are normalised to lowercase on save; two tags differing only in case cannot both exist. A rejected tag (duplicate / over the cap) is **told to the user**, never silently swallowed.
5. The cookbook page gains the approved control row: group toggles for the group axis, course pills + sort inside the tray.
6. Grouping by meal or by course; headings in declared order; empty groups skipped; an explicit bucket for recipes with nothing set. No recipe can ever be absent from the page in any mode.
7. Sort offers a–z, recently added, most cooked. **The sort and group choices persist per device; the course filter does NOT.** A restored filter would hide recipes on a fresh page load and read as data loss.
   7b. Every sort is **total and device-stable** — `recent` and `cooked` tie-break on `byRecipeName`, because Automerge does not guarantee identical iteration order across devices and a partial comparator would reshuffle the grid between them.
8. Course and tags appear on the recipe card, the detail page meta row, and the form — rendered by **one** badge component, not two copies.
9. Alphabetical ordering of recipes is defined in exactly **one** place, shared by `useRecipeSearch` and the cookbook, replacing the page's inline duplicate sort.
10. `SLOT_ORDER`, the slot emoji and the slot label key each exist in exactly one place afterwards.
11. The AI infers course and meal slots at capture; unknown or absent values land blank and are logged, never coerced.
12. Control rows scroll inside themselves at 375px; the page never scrolls horizontally.

## Important Notes & Caveats

- ⚠️ **THE MOCKUP'S SLOT EMOJI ARE WRONG — the app wins.** The mockup shows 🌅 breakfast and 🍝 dinner. The app has used 🍳 / 🥪 / 🍽️ / 🍎 in **five** places since the meal planner shipped, and all five agree (verified byte-for-byte). Consolidating onto the mockup's set would silently restyle the meal planner, the nook, the wall _and the printed plan_. **Take the app's emoji.** This is the mockup-vs-CIG conflict the drafting directive asks to call out and resolve in favour of the existing system.
- **There are FIVE slot-emoji copies, not four.** `useWallPeripherals.ts:29`, `MealCard.vue:31`, `MealWeekBoard.vue:40` (`SLOT_META`), `NookMealsCard.vue:30`, and **`MealPlanExportBody.vue:34` (`SLOT_ICON`)** — the print export. There are **five** order copies (`mealPlanStore.ts:21` as a `Record`, `mealExportModel.ts:87` as an array, `MealWeekBoard.vue:25`, `MealDayStack.vue:20`, `useWallPeripherals.ts:96` as arrays) and **five** label-key sites (`MealWeekBoard.vue`, `MealDayStack.vue`, `MealSlotCell.vue`, `MealPlannerPage.vue`, **`NookMealsCard.vue`**). All fifteen agree today. The consolidated constant must serve **both order shapes** — an ordered array for rendering and an index lookup for comparators — or the sites that need a `Record` will just rebuild one.
- **`MealWeekBoard`'s `SLOT_META` is richer than emoji.** It carries `band` and `ink` — per-row hues with a long docblock explaining why the hue belongs to the row rather than a chip. Move **only the emoji** into the shared constant; leave `band`/`ink` where they are, and leave `MealPlanExportBody`'s `SLOT_BAND` alone (print alphas are deliberately stronger than screen).
- **The wall does NOT share the meal planner's slot strings.** `useWallPeripherals` emits `slotKey: 'wall.meals.slot.*'` (a _key_, resolved by its consumers) and `wall.meals.slot.snack` is "Snack" where `mealPlanner.slot.snack` is "Snacks". Do **not** fold the wall into the shared label helper — it takes only the emoji and the order.
- **`useRecipeSearch` has two existing consumers** (`RecipeRail`, `MealPickerSheet`). Its signature must not change under them. The cookbook has **no search box** in the approved mockup, so it does not compose on top of it — both import the shared comparator from a pure module (see §5).
- **Course/meal/tags are USER DATA, not UI strings.** Course _labels_ are translated via `labelKey` (the `listCategories` shape, verified: `{ id, labelKey: UIStringKey, emoji, … }`); the stored value is the id. Tags are user-entered and are **never** translated — but the input, hint and section labels are. `eslint-rules/no-bare-render-strings.js` enforces this for the new constants file.
- **The lowercase rule is a stated trade, not a silent one.** The mockup's tag input says "Saved in lowercase, so you only ever get one of each." Keep that copy. Losing the capital in "Nana's" is accepted, and telling the user is what stops it reading as a bug.
- 🚨 **THE FORM HAS FOUR SEEDING/SAVE SITES, NOT TWO — AND MISSING THE FOURTH SILENTLY WIPES USER DATA ON EVERY EDIT.** Passes 2 and 3 named `baselinePayload` (`RecipeFormModal.vue:281`) and `buildPayload` (`:295`). Both missed **`useFormModal({ onEdit })` at `RecipeFormModal.vue:159-171`** — the _only_ path that seeds the refs when opening an **existing** recipe, and `applyPrefill` (`§8`), which seeds them on capture. Omit the new fields from `onEdit` and the failure is catastrophic and silent: opening a saved recipe leaves the refs blank → `buildPayload` sends `''`/`[]` → `baselinePayload` reports the stored values → `diffPayload` sees a genuine change and **writes the clear**. Every edit of any kind — fixing a typo in the title — would erase that recipe's tags, course and meals. All three fields must be added to **all four** sites:
  | #                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Site                       | Line       | Role                                                                   |
  | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ---------- | ---------------------------------------------------------------------- |
  | 1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `useFormModal({ onEdit })` | `:159-171` | seeds refs from the stored recipe (**the one Pass 2/3 missed**)        |
  | 2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `applyPrefill`             | §8         | seeds refs from an AI capture; must also clear on `applyPrefill(null)` |
  | 3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `baselinePayload(stored)`  | `:281`     | what the doc held when the form opened                                 |
  | 4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `buildPayload()`           | `:295`     | what the form holds now                                                |
  | Sites 3 and 4 must agree _field-for-field_: a field in `buildPayload` but not `baselinePayload` is written on **every** save (clobbering another device's edit); a field in neither means clearing a course silently keeps the old value. This is verbatim the data-loss class `diffPayload`'s own header and `docs/plans/2026-08-15-recurring-occurrence-edit-data-loss.md` exist to describe. **A test per field per site — including an "open an existing recipe with all three fields set, save with no edits, assert `diffPayload` returns `{}`" round-trip**, which is the single test that would have caught this. |
- ⚠️ **`diffPayload`'s array equality is BY INDEX.** Its `isEqual` is `a.length === b.length && a.every((item, i) => item === b[i])` — so `['dinner','lunch']` and `['lunch','dinner']` are _different_ payloads and a no-op save would write. **`mealSlots` must be canonicalised to `MEAL_SLOTS` order in BOTH `baselinePayload` and `buildPayload`** (one shared `sortSlots()` helper from `constants/mealSlots.ts`, used by both, so they cannot drift). `tags` are canonicalised by insertion order, which both sides already share; do **not** sort them — the user's order is meaningful on the card.
- ⚠️ **`[]` and `undefined` are BOTH "unset", and `[]` becomes the common case.** Once `buildPayload` always sends arrays, a recipe with no tags stores `[]`, not `undefined`. Every consumer — card, detail, badges, `buildShelves`, `countByCourse` — must test `?.length`, **never truthiness**: `if (recipe.tags)` is `true` for `[]` and would render an empty pill row on every untagged recipe.
- **The AI must not be trusted to return a valid enum.** A model can return `"Main Course"`, `"brunch"`, `"pudding"` or an object. Validation belongs in the **mapper**, exactly where `extractionToActivity.validatedModelCategory` already puts it — not in the pure prompt parser. Parse strictly against the known ids and drop anything unrecognised; never coerce a near-miss.
- ⚠️ **`RECIPE_REQUIRED_KEYS` must NOT gain `course`/`mealSlots`.** `parseRecipeExtractionResult` _throws_ on a missing required key (`extractionPrompt.ts:464`) and the caller classifies that as `malformed_output` — so requiring the new keys would make an older cached client, a BYOK model or an off-day response lose the **entire** recipe over an optional taxonomy field.
- **This is a TWO-DEPLOYABLE change** like #86: the prompt lives in the Lambda as well as the client, and `EXTRACTION_TASKS` is drift-pinned across three mirrors by `extractionPromptDrift.test.ts`. `PROMPT_VERSION` (`extractionPrompt.ts:24`, currently `'2026-09-03.1'`) must be bumped in **all three** copies — the file header says "bump on ANY change", and the drift test only proves the three agree, not that the version moved.
- **#86's client changes are on `main` but NOT deployed.** #87 touches `FamilyCookbookPage`, `RecipeDetailPage` and `RecipeFormModal` — the same three files. They will ship together unless #86's client is deployed first.
- The cookbook is **not** behind the `mealPlanner` dev flag (`flagRegistry.ts:54-59` says "Cookbook is separate") and must not become so.

## Complexity Budget & Non-Goals

Added in Pass 3, because this plan touches ~30 files and the fastest way to make it unmaintainable is to let it grow one "while we're here" at a time.

**Explicitly out of scope, and to stay out:**

- No search box on the cookbook (the mockup has none; adding one later composes cleanly on `useRecipeSearch`).
- No filtering _by tag_ — tags are display + future search fodder only. A second filter axis doubles the state machine in `useCookbookView` and the mockup does not ask for it.
- No synced (family-shared) sort/group preference. Device-local, like the to-do sort.
- No consolidation of the six-component teleport/popover idiom (`TodoSortMenu`'s own `TODO(consolidation)` note). That note travels with the file and stays deferred.
- No JSON-LD → course mapping (see Assumption 6).
- No new diagnostic context keys.

**Structural rules this change holds itself to:**

- Pure logic (ordering, grouping, tag normalisation, AI validation) lives in Vue-free modules under `utils/`. Composables are wiring only. This keeps the hardest-to-get-right parts testable without a component harness — the pattern `recipeExtractionToRecipe.ts` already states in its header.
- No component gains a union-typed `modelValue`, and no component gains a `mode` flag that forks its emit contract.
- Grouping produces **one** rendering path (always shelves); there is no `v-if` fork between "flat" and "grouped".

## Assumptions

> Review before implementation.

1. Adding three optional fields to `Recipe` needs no Automerge migration — the repository is schema-agnostic (`createAutomergeRepository<'recipes', Recipe>`), and `RecipeCreate = Omit<Recipe,…>` means new fields flow through the store without signature changes.
2. Eight courses is the final list; "other" is the catch-all and tags cover anything finer.
3. Sort/group preference is per-device (localStorage), not synced — matching the to-do sort's deliberate choice. Its keys stay colocated with the composable that owns them; `constants/storageKeys.ts` is deliberately NOT grown — that file exists solely for the keys `index.html`'s pre-paint bootstrap duplicates.
4. No Help Center article is required for a filter/sort control on an existing page. (Assessed and rejected: this changes _how_ you find a recipe, not _what_ you can do.)
5. "Most cooked" counts cook logs. It does **not** use `cookStatsForRecipe(id)` — that returns a fresh Vue `computed` per call (`recipesStore.ts:28`) and would allocate one per comparison inside a sort. One `Map<recipeId, count>` built in a single pass instead, and passed _into_ a pure comparator factory.
6. The JSON-LD rung leaves course/meal blank. schema.org's `recipeCategory` is free text ("Dessert", "Main Course", "Weeknight") and mapping it is a separate guessing exercise; nothing is invented on the path whose whole point is that nothing is invented.
7. Tags are stored and diffed exactly like `ingredients` — a whole-array replace through `diffPayload`. Concurrent tag edits from two devices resolve last-writer-wins on the array, identical to the ingredient behaviour that already ships. No per-tag CRDT semantics.

## Approach

Mockup: `docs/mockups/recipe-course-tags-meal-grouping-2026-09-04.html` (direction A, approved).

### 0. Sequencing — three independently-shippable commits

⚠️ **Pass 3 change.** As drafted this was one ~30-file commit mixing a cross-cutting refactor of the meal planner, a shared-UI refactor, and a new feature. If the planner regresses, bisecting that is a bad afternoon. Land it as three commits, each green on its own and each revertable without touching the others:

| #   | Commit                      | Contains                                                                                                                          | Proof it is safe                                                                                                                                       |
| --- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Meal-slot consolidation** | §2 only. Behaviour-identical.                                                                                                     | Regression test pinning emoji/order/label-keys against the pre-change literals; planner + wall + nook + PDF visually unchanged.                        |
| 2   | **Shared UI primitives**    | §6 (`usePersistedChoice` + `useTodoSort` refactor), `ui/SortMenu` move, `ui/ChipButton` + `ui/ChipToggleGroup`. No cookbook code. | Existing `useTodoSort` test unchanged; `SortMenu.test.ts` carries `TodoSortMenu.test.ts`'s assertions; new characterisation test for `FrequencyChips`. |
| 3   | **The feature**             | §1, §3, §4, §5, §7, §8.                                                                                                           | Everything in the Testing Plan.                                                                                                                        |

Commits 1 and 2 are pure refactors with no user-visible change; they can ship ahead of the feature.

### 1. Types (`models.ts`)

```ts
export const RECIPE_COURSES = [
  'starter',
  'main',
  'side',
  'dessert',
  'drink',
  'baking',
  'sauce',
  'other',
] as const;
export type RecipeCourse = (typeof RECIPE_COURSES)[number];
```

`Recipe` gains `course?`, `mealSlots?: MealSlot[]`, `tags?: string[]`. House style — `as const` + derived union, no TS `enum`.

### 2. One meal-slot constant (`src/constants/mealSlots.ts`)

Follows the `constants/mealTypes.ts` template, whose header comment documents exactly this bug class ("two half-definitions of the same thing").

```ts
export const MEAL_SLOTS: readonly MealSlot[] = ['breakfast','lunch','dinner','snack'];
export const SLOT_EMOJI: Record<MealSlot,string> = { breakfast:'🍳', lunch:'🥪', dinner:'🍽️', snack:'🍎' };
/** Derived from MEAL_SLOTS so the two can never disagree. */
export const SLOT_INDEX: Record<MealSlot, number> = …;
/** `mealPlanner.slot.*` — the planner/nook label. The WALL keeps `wall.meals.slot.*`. */
export const SLOT_LABEL_KEYS: Record<MealSlot, UIStringKey> = …;
export function isMealSlot(v: unknown): v is MealSlot;
```

Refactor onto it:

- **order** → `mealPlanStore.ts:21` (`SLOT_INDEX`), `mealExportModel.ts:87`, `MealWeekBoard.vue:25`, `MealDayStack.vue:20`, `useWallPeripherals.ts:96` (`MEAL_SLOTS`);
- **emoji** → `useWallPeripherals.ts:29`, `MealCard.vue:31`, `NookMealsCard.vue:30`, `MealPlanExportBody.vue:34`, and `MealWeekBoard`'s `SLOT_META` (which keeps `band`/`ink` and reads `emoji` from the constant);
- **label** → the five `t(\`mealPlanner.slot.${…}\`)`template literals become`t(SLOT_LABEL_KEYS[slot])`.

`SLOT_LABEL_KEYS` is a constant, **not** a `useMealSlotLabel()` composable: a composable would add a file and a `useTranslation()` call to five sites that already have `t` in scope, to save nothing. The keys already exist at `uiStrings.ts:1255-1258` — no new strings.

### 3. Course constant + resolver

`src/constants/recipeCourses.ts` in the **`listCategories.ts` shape** (`{ id, labelKey, emoji }`, `labelKey` as `UIStringKey`) plus `getRecipeCourse(id)` and `isRecipeCourse(v)`. `src/composables/useRecipeCourseLabel.ts` mirrors `useListCategoryLabel` — `t(course.labelKey)`, never throws. Unknown id falls back to the id **and warns once** (module-level `Set` guard, so a corrupt value cannot spam a render loop) — `useListCategoryLabel` falls back silently, and a silent fallback here would hide genuine data drift. New `recipes.course.*` strings in `uiStrings.ts` with `en` + `beanie`.

### 4. Tag normalisation (`src/utils/recipeTags.ts`)

Pure, testable, and **explicit about rejection** — this is the plan's main silent-failure fix:

- `normaliseTag(raw)` — trim, lowercase, collapse internal whitespace, cap length (`MAX_TAG_LENGTH`); returns `''` for nothing usable.
- `addTag(tags, raw): { tags: string[]; status: 'added' | 'empty' | 'duplicate' | 'limit' | 'truncated' }` — the status is what lets `RecipeTagInput` say _"you already have that one"_ / _"up to N tags"_ instead of the input appearing to do nothing when the user presses Enter.
- `suggestTags(allRecipes, current, limit = MAX_SUGGESTIONS)` — previously-used tags, most frequent first, excluding ones already on this recipe (the mockup's suggestion row). ⚠️ **Pass 3:** the limit is not optional decoration — a family with 200 distinct tags would otherwise render 200 pills under the input. The caller computes this **once per (recipes, current-tags) change**, not per keystroke.
- `MAX_TAGS`, `MAX_TAG_LENGTH`, `MAX_SUGGESTIONS` live here.

⚠️ **Pass 3 change — `MAX_CARD_TAGS` does NOT live here.** It is a purely presentational overflow threshold with no relationship to the normalisation caps; the "caps that must not disagree" argument does not apply to it. It lives in `RecipeTaxonomyBadges.vue` as a defaulted `maxTags` prop, next to the `+N` markup that is its only consumer. Keeping it in a data-utils module would couple the tag rules to a card layout decision that will change the next time the grid does.

### 5. Ordering + grouping (`src/utils/recipeOrdering.ts`) — pure, Vue-free

⚠️ **Pass 3 change.** Pass 2 put all of this inside `useCookbookView` and exported the alpha comparator _from `useRecipeSearch`_. Both are wrong-way-round layering: a composable is not a home for pure comparators, and `useRecipeSearch` (a meal-planner concern) would have become an import target for the cookbook. One pure module owns list order and shelf construction; both composables import from it.

```ts
export const RECIPE_SORTS = ['name', 'recent', 'cooked'] as const;
export type RecipeSort = (typeof RECIPE_SORTS)[number];

/** THE definition of alphabetical recipe order. Requirement 9. */
export function byRecipeName(a: Recipe, b: Recipe): number;

/**
 * Counts are passed IN — no store access, no Vue. See Assumption 5.
 * ⚠️ Pass 4: `recent` and `cooked` MUST tie-break on `byRecipeName`. Automerge does not
 * guarantee identical map-iteration order across devices, so a comparator that returns 0 for
 * equal timestamps/counts (every uncooked recipe, every same-day import) leaves the tied run in
 * whatever order the doc happened to yield — and two family devices show a different grid.
 */
export function recipeComparator(sort: RecipeSort, cookCounts: Map<string, number>): Comparator;

export interface Shelf {
  key: string;
  titleKey: UIStringKey | null;
  emoji?: string;
  items: Recipe[];
}

/** groupBy 'none' returns ONE shelf with titleKey: null. One rendering path. */
export function buildShelves(recipes: Recipe[], groupBy: CookbookGroup): Shelf[];

export function countByCourse(recipes: Recipe[]): Record<RecipeCourse | 'unset', number>;
```

- `useRecipeSearch` changes by exactly one line — it imports `byRecipeName` instead of inlining `localeCompare`. Its signature and its two consumers are untouched.
- `FamilyCookbookPage`'s inline duplicate sort (`FamilyCookbookPage.vue:113-115`) is deleted.
- **Never-vanish invariant, enforced here** where it can be tested without mounting anything: an unrecognised stored value (a `mealSlots` entry that is not a `MealSlot`, a `course` that is not a `RecipeCourse` — possible from a corrupt doc or a future downgrade) puts the recipe in the trailing "not filed" bucket rather than dropping it. Empty groups are skipped; the unset bucket is appended last. Pinned by a unit test asserting every input recipe appears at least once in every mode.
- `buildShelves` returns `titleKey`, not `title` — no `t()` in a pure module. The component resolves it.

**`src/composables/useCookbookView.ts`** is then thin wiring only: **two persisted refs (`sortBy`, `groupBy`) plus one plain `ref` for `course`** — ⚠️ **Pass 4: the course filter is deliberately NOT persisted.** Restoring a filter on load means the user opens the cookbook and most of their recipes are simply gone, with the reason two taps away inside a tray; that reads as data loss, which is precisely the failure this plan is trying not to cause. Sort and group re-order what is on screen; a filter removes things from it. Plus the cook-count `Map` computed and three computeds calling the pure functions. Returns `{ groupBy, sortBy, course, shelves, courseCounts, totalCount, clearFilter }`.

⚠️ **Pass 3 — `courseCounts` is computed from the UNFILTERED list.** Pass 2 left this undefined. If the counts were derived after filtering, selecting "dessert" would zero every other pill and the control would look broken. Order of operations, fixed and documented: **count (unfiltered) → filter by course → sort → group.** Explicit test.

Grouping by course _while_ a course filter is active yields one shelf. That is correct and intended, not a bug — the pills stay enabled so the user can move sideways between courses.

### 6. Persisted sort/group (`src/composables/usePersistedChoice.ts`)

⚠️ `useTodoSort` is the right _pattern_ but is todo-specific (hardcoded key, `TodoSort` type). The cookbook needs two of them, which would make three copies. **Extract:**

```ts
export function usePersistedChoice<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T
): Ref<T>;
```

A self-persisting ref with `useTodoSort`'s graceful degradation verbatim: `console.warn` on unreadable / invalid / unwritable storage, never throws, never silent. **Every warn message names the storage key** (`[usePersistedChoice:beanies:cookbookSort] …`) — otherwise a warn from a generic helper is undiagnosable without a stack trace, which is a regression on the named-composable warns it replaces.

`useTodoSort` is refactored onto it, keeping its exported `TODO_SORTS`/`SORT_OPTIONS` and its public `{ sortBy }` signature. Verified: its existing test (`composables/__tests__/useTodoSort.test.ts`) asserts only _that_ `console.warn` was called, never the message, so it passes unchanged. The degradation cases gain a dedicated `usePersistedChoice` test.

### 7. Cookbook view: shared UI, controls, card, detail, form

**7a. `SortMenu.vue` (`src/components/ui/`) — a MOVE, not a new component.**
`TodoSortMenu.vue` is ~190 lines of teleport + `getBoundingClientRect` + drop-up + viewport clamp + roving focus + escape/click-outside. Re-implementing a second sort popover for the cookbook is the single largest duplication this plan could commit. Generalise over an exported interface, move to `ui/SortMenu.vue`, point `FamilyTodoPage.vue:205` at it and **delete `TodoSortMenu.vue`** (a pass-through wrapper would be the duplication we are removing).

```ts
export interface SortMenuOption<T extends string = string> {
  value: T;
  labelKey: UIStringKey;
  icon: string;
}
// props: { modelValue: T; options: readonly SortMenuOption<T>[]; triggerLabelKey: UIStringKey }
```

`useTodoSort`'s `SORT_OPTIONS` conforms as-is (its `labelKey` union widens to `UIStringKey`). Move `TodoSortMenu.test.ts` → `ui/__tests__/SortMenu.test.ts`, keeping its assertions. The `TODO(consolidation)` note about the six-component popover idiom stays with the file and stays out of scope. Ships in commit 2, so a popover regression is bisectable away from the feature.

**7b. Chip components — ⚠️ Pass 3 replaced the `multiple` flag.**

Pass 2 proposed adding `multiple?: boolean` to `FrequencyChips` with `modelValue: string | string[]`. **Rejected.** A union-typed `modelValue` on a component with 16 existing call sites (across 12 files) widens the `update:modelValue` emit for every one of them, so `v-model` bound to a `Ref<string>` no longer type-checks without a cast — a type hole introduced into sixteen unrelated call sites to save one file. It also contradicts the app's own convention: single-select and multi-select are **separate components** here (`FrequencyChips`/`TogglePillGroup` single, `DayOfWeekSelector`/`BaseMultiSelect` multi).

Instead:

- **`ui/ChipButton.vue` _(new, presentational only)_** — one chip: `{ label, icon?, selected, disabled?, disabledHint?, accent?, badge? }`, no state, no emit beyond `click`. The markup and Tailwind classes currently inside `FrequencyChips` move here **byte-identical**, including the disabled-hint tooltip.
- **`FrequencyChips.vue`** keeps its **exact public API** (`modelValue: string`) and renders `ChipButton`. `ChipOption` gains `badge?: string | number` (the mockup's dimmed count) and the component gains `layout?: 'wrap' | 'scroll'`, default `'wrap'`.
- **`ui/ChipToggleGroup.vue` _(new)_** — multi-select, `modelValue: string[]`, same `ChipOption[]`, renders `ChipButton`. Used for the form's meal picker. Modelled on `DayOfWeekSelector`'s toggle logic.

⚠️ **`layout: 'scroll'` is not a nicety — requirement 12 is unreachable without it.** `FrequencyChips` is `flex flex-wrap`; wrapping a `flex-wrap` row in `overflow-x-auto` still wraps. `'scroll'` renders `flex flex-nowrap overflow-x-auto` with hidden scrollbars, matching the mockup's `.pills`. Pass 2 missed this.

⚠️ **Guardrail:** `FrequencyChips` has **no test today** and 16 call sites. Before the `ChipButton` extraction, add `ui/__tests__/FrequencyChips.test.ts` characterising the current behaviour (selected vs unselected classes for both accents, disabled + hint, emit on click, no emit when disabled). The refactor must leave it green. This is the only thing standing between an internals refactor and sixteen silently restyled controls.

**7c. `CookbookControls.vue` (`src/components/pod/`)** — the divider row + tray. Small, because it composes:

- group toggles: three buttons in an `overflow-x-auto` row. **`aria-pressed` toggle buttons, not `role="tablist"`** — the mockup's `role="tab"`/`aria-selected` markup would oblige us to implement roving tabindex and arrow-key traversal to be honest ARIA, for a control that is a filter, not a tab set. Visually identical, semantics correct, nothing to maintain.
- course pills: `FrequencyChips` with `layout="scroll"`, a leading "all" option, and `badge` counts.
- sort: `SortMenu` with `class="w-full sm:w-auto"` (attribute fallthrough) for the mockup's full-width phone treatment.

Props in, events out. No store access, no `useCookbookView` — the page owns the state and passes it down, so the controls stay renderable in isolation.

**7d. `RecipeTaxonomyBadges.vue` (`src/components/pod/`)** — course badge + tag pills + `+N` overflow, used by **both** the cookbook card and the detail meta row. Two sites, one definition; `maxTags` is a defaulted prop.

**7e. Card**: the existing inline card markup in `FamilyCookbookPage` gains `<RecipeTaxonomyBadges>`; it is not extracted into a component (it exists once, and extracting it churns a file #86 also edits).

**7f. Filtered-empty state**: reuse `components/pod/shared/EmptyState.vue` (`{ emoji?, message, actionLabel? }` + `action` event, verified) with a `fillTemplate`d message naming the course and a "show all recipes" action calling `clearFilter()` — not the mockup's bespoke two-line block. The mockup's heading + body collapse into the one `message` slot; that is an accepted simplification in favour of the shared component.

**7g. `RecipeFormModal`**: a `BaseSelect` for course (with a "— none —" option), `ChipToggleGroup` for meal, and `RecipeTagInput.vue` for tags. 🚨 **All three fields must be added to ALL FOUR sites — `onEdit` (`:159-171`), `applyPrefill`, `baselinePayload` (`:281`) and `buildPayload` (`:295`)** — see the caveat above; omitting `onEdit` wipes the fields on every edit. `course` uses the existing `orUndefined` idiom; `mealSlots`/`tags` are always-sent arrays exactly like `ingredients` (an empty array is a _meaningful_ value: the user removed the last tag), with `mealSlots` canonicalised through the shared `sortSlots()` on both payload sides so index-wise `isEqual` cannot report a phantom change.

**7h. `RecipeTagInput.vue` (`src/components/pod/`)** — genuinely new (no token/chips input exists anywhere in the app). Removable pills + input, `addTag` on Enter/comma/blur, the lowercase hint, the suggestion row, and an inline `aria-live="polite"` message for the `duplicate` / `limit` statuses. **It holds no rules** — every decision comes from `utils/recipeTags.ts`; the component only renders the returned `status`.

### 8. AI inference

- ⚠️ **Pass 4 — the SHARE task inherits this change for free, and its fixtures must move with it.** `RECIPE_JSON_SHAPE` is composed into `SHARE_JSON_SHAPE`, so the share/paste extraction path gains `course`/`mealSlots` without a second edit (good — that is the composition working). But its existing test fixtures assert a full parsed shape, so **the share fixtures need the two new defaults (`course: ''`, `mealSlots: []`) added or they fail**. Check `parseShareExtractionResult`'s fixtures alongside the recipe ones.
- **Prompt** (all three mirrors, byte-identical): `RECIPE_JSON_SHAPE` gains `course` (`'string — exactly one of: starter, main, … or "" if unclear'`) and `mealSlots` (`'array of strings, any of: breakfast, lunch, dinner, snack. Empty array if unclear.'`). `RECIPE_REQUIRED_KEYS` is **unchanged** (see caveat). Bump `PROMPT_VERSION` in all three.
- **Parser** (`parseRecipeExtractionResult`): carries the values through as raw, _bounded_ strings using the helpers already in the file — `asString(obj.course, MODEL_FIELD_MAX)` and `toStringList(obj.mealSlots)`. No enum knowledge here, matching how `category`/`categoryHint` are handled. `RecipeExtractionResult` gains `course: string` and `mealSlots: string[]` — **non-optional, defaulted to `''`/`[]` by the parser**, so no consumer ever has to distinguish "absent" from "empty". Existing fixtures gain the two defaults.
- **Validation** (`recipeExtractionToRecipe.ts`): a `validatedTaxonomy(result)` helper modelled directly on `extractionToActivity.validatedModelCategory` — checks `isRecipeCourse` / `isMealSlot`, drops unknown values, de-duplicates slots, and `console.warn`s with the offending value and the fix ("model returned an unknown course id; add it to RECIPE_COURSES or leave the field blank"). `RecipePrefill.fields` gains `course?`/`mealSlots?`; `RecipePrefill` gains `taxonomyRejected: ('course' | 'meal')[]` — **required, not optional**, so both construction sites (`recipeExtractionToPrefill`, `jsonLdToPrefill`) must state their answer rather than inherit `undefined`. `jsonLdToPrefill` sets `[]`.
- **Form**: `applyPrefill` seeds course/mealSlots as ordinary editable prefill values (and clears them on `applyPrefill(null)`, the one reset path).

## Files Affected

**Commit 1 — slot consolidation**

- `src/constants/mealSlots.ts` _(new)_
- `src/stores/mealPlanStore.ts`, `src/utils/mealExportModel.ts`, `src/components/mealplan/MealWeekBoard.vue`, `MealDayStack.vue`, `MealCard.vue`, `MealSlotCell.vue`, `src/components/export/MealPlanExportBody.vue`, `src/composables/useWallPeripherals.ts`, `src/components/nook/NookMealsCard.vue`, `src/pages/MealPlannerPage.vue`

**Commit 2 — shared primitives**

- `src/composables/usePersistedChoice.ts` _(new)_, `src/composables/useTodoSort.ts` _(refactored onto it)_
- `src/components/ui/SortMenu.vue` _(moved from `todo/TodoSortMenu.vue`, which is deleted)_, `src/pages/FamilyTodoPage.vue`
- `src/components/ui/ChipButton.vue` _(new)_, `src/components/ui/ChipToggleGroup.vue` _(new)_, `src/components/ui/FrequencyChips.vue` _(internals → `ChipButton`; additive `badge` + `layout`)_

**Commit 3 — the feature**

- `src/types/models.ts` — `RECIPE_COURSES`, `RecipeCourse`, three `Recipe` fields
- `src/constants/recipeCourses.ts` _(new)_
- `src/utils/recipeTags.ts` _(new)_, `src/utils/recipeOrdering.ts` _(new)_
- `src/composables/useRecipeCourseLabel.ts` _(new)_, `src/composables/useCookbookView.ts` _(new)_
- `src/composables/useRecipeSearch.ts` — imports `byRecipeName` (signature untouched)
- `src/pages/FamilyCookbookPage.vue`, `src/pages/RecipeDetailPage.vue`, `src/components/pod/RecipeFormModal.vue`
- `src/components/pod/CookbookControls.vue` _(new)_, `RecipeTagInput.vue` _(new)_, `RecipeTaxonomyBadges.vue` _(new)_
- **AI**: `src/services/ai/types.ts`, `src/services/ai/extractionPrompt.ts`, `infrastructure/lambda/ai-extract/extractionPrompt.mjs`, `scripts/spikes/extractionPrompt.mjs`, `src/utils/recipeExtractionToRecipe.ts`, `src/composables/useRecipeCapture.ts`
- **Strings / docs**: `src/services/translation/uiStrings.ts`, `CHANGELOG.md`, `docs/STATUS.md`, the approved mockup

## Observability Coverage

Surface: **`recipe-extract`** (existing, allowlisted, store-declared). **No new context keys** — `action`, `detail`, `count` and `kind` are all already in `ALLOWED_CONTEXT_KEYS` (`diagnosticContext.ts:68, 185, 318`) and mirrored in the telemetry Lambda's allowlist, as in #86.

- **Success path rides the EXISTING `ready` event.** `handOver` (`useRecipeCapture.ts:344`) is already the single funnel both capture routes pass through and already logs `action: 'ready'` with `extraction_path` and `inferred_count`; it gains `detail` = `both` | `course_only` | `meal_only` | `none`. A second per-capture event would double the firehose volume of this surface to say something the existing event can carry. Verified: `ready` carries no `detail` today.
  ⚠️ **Pass 3:** `detail` is a generic key already carrying `env.origin` / `outcome.source` / `outcome.reason` on _other_ actions in this surface. Its meaning is per-`action` and always has been; add a one-line comment at the `ready` call site stating what `detail` means **there**, so the next reader does not assume a single global meaning.
- `action: 'taxonomy_rejected'` — `info`, emitted from `handOver` when `prefill.taxonomyRejected` is non-empty. `detail` = `course` | `meal` | `both`. **This is the event that matters**: a model drifting to "Main Course" or "brunch" would otherwise present as "the AI never fills this in", indistinguishable from a model that simply declined. The developer-facing _why_ is the `console.warn` in `validatedTaxonomy`, matching the `image_none` + `console.warn(HINTS[...])` pairing #86 established.
- Failure modes → signal: model returns nothing (`ready/detail=none`); model returns junk (`taxonomy_rejected`); one axis works and the other does not (`course_only`/`meal_only`); prompt drift after a mirror edit (the ratio of `taxonomy_rejected` to `ready` jumps).
- The sort/group persistence `console.warn`s on unreadable/unwritable storage via `usePersistedChoice`, **naming the key** — device-local, no user impact, correctly not sent to the firehose.
- Nothing here is `severity: 'critical'`: a blank course is cosmetic and the recipe saves regardless.

## Acceptance Criteria

- [ ] A recipe can carry a course, any number of lowercase tags, and one or more meal slots
- [ ] The cookbook filters by course and groups by meal or course, per the approved mockup
- [ ] Course pill counts are computed from the **unfiltered** list and do not change when a filter is applied
- [ ] Recipes with none of the new fields — or with an unrecognised stored value — render correctly and appear in the "not filed" bucket; every recipe appears at least once in every mode
- [ ] Empty groups are skipped, not shown empty
- [ ] Two tags differing only in case are impossible; the input says tags are lowercased, and says so when a tag is a duplicate or over the cap; the suggestion row is capped
- [ ] **Opening an existing recipe that has a course, meals and tags, and saving with no edits, writes NOTHING** (`diffPayload` returns `{}`) — the test that proves `onEdit` seeds all four sites
- [ ] Reordering the meal chips and saving writes nothing (canonical slot order on both payload sides)
- [ ] Clearing course/meals/tags on an existing recipe persists the clear, and saving an untouched field writes nothing (`diffPayload` round-trip test per field)
- [ ] An untagged recipe renders no empty pill row (`?.length`, not truthiness) on card, detail and badges
- [ ] `recent` and `cooked` produce identical ordering on two devices with the same data (tie-break asserted)
- [ ] The sort/group choice survives a reload; **the course filter does not** — a reload shows all recipes
- [ ] `SLOT_ORDER`/slot-emoji/slot-label-key exist in exactly one place; the meal planner, wall, nook and printed plan render **identically** to before
- [ ] `FrequencyChips`' 16 existing call sites (12 files) are byte-identical in rendered output and unchanged in type signature
- [ ] A captured recipe arrives with course/meal inferred when confident, blank otherwise, and both editable
- [ ] A model response missing `course`/`mealSlots` entirely still yields a complete recipe (no `malformed_output`)
- [ ] An unrecognised model value is dropped, not coerced, `console.warn`ed, and logged as `taxonomy_rejected`
- [ ] Control rows scroll internally at 375px with no horizontal page scroll
- [ ] Diagnostic logging implemented and verified per Observability Coverage

## Testing Plan

**Unit (pure, no component harness)** — `normaliseTag`/`addTag` (case, whitespace, duplicates, empties, length cap, count cap, and the returned `status` for each); `suggestTags` ordering, exclusion and limit; `recipeOrdering` (`byRecipeName` stability, each comparator, `buildShelves` for each group mode: declared order, empty groups skipped, unset bucket present and last, unknown stored values bucketed not dropped, **every input recipe present in every mode**, `groupBy: 'none'` returns exactly one shelf with `titleKey: null`); `countByCourse` (unfiltered semantics); `usePersistedChoice` (missing / invalid / throwing-on-read / throwing-on-write all degrade with a warn naming the key); `validatedTaxonomy` (valid, unknown course, unknown slot, non-array, non-string, object, duplicate slots) — each dropped, never coerced, each setting `taxonomyRejected`; `parseRecipeExtractionResult` with `course`/`mealSlots` **absent** returns a full result rather than throwing.

**Regression (commits 1 and 2)** — the slot consolidation is behaviour-identical: assert the emoji map, order array and label keys against the pre-change literals so a "tidy" that changes 🍽️ fails a test rather than silently restyling the planner and the print export. `useTodoSort`'s existing test passes unmoved after the `usePersistedChoice` refactor. `SortMenu.test.ts` keeps `TodoSortMenu.test.ts`'s assertions. **New `FrequencyChips.test.ts` written _before_ the `ChipButton` extraction and green after it** — selected/unselected classes for both accents, disabled + hint, emit on click, no emit when disabled, `layout` unset still wraps.

**Component** — form round-trip (course, meals, tags in and out); the `diffPayload` matrix (set → clear → untouched, per field); `ChipToggleGroup` add/remove/idempotence; card overflow with a long tag and many tags; filtered-empty state and its clear action; `CookbookControls` renders from props alone and emits without touching a store.

**Manual** — 375px phone: both rows scroll internally, page does not; light and dark; Large reading mode; keyboard traversal of the group toggles and the sort menu; the meal planner, wall, nook and PDF export visually unchanged; a spot-check of three unrelated `FrequencyChips` forms (Goal, Asset, Allergy) after commit 2.

**Gates** — `npm run build` (whole-graph import analysis), type-check, lint, stylelint, prettier, full vitest, lambda tests (drift guard included). Run the full gate set **at the end of each of the three commits**, not only at the end.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted from the approved mockup and a direct read of every reuse target; caught that the mockup's slot emoji contradict the app's existing copies, and that `useTodoSort` needs generalising rather than copying.
- **Pass 2 (DRY + error handling)**: Replaced the hand-rolled sort popover with a move-and-generalise of `TodoSortMenu` → `ui/SortMenu`, the bespoke pill/badge/empty markup with `FrequencyChips` + `EmptyState` + a shared `RecipeTaxonomyBadges`, and the `useRecipeSearch` wrapper with a shared comparator; found a fifth slot-emoji copy (`MealPlanExportBody`) and a fifth label site (`NookMealsCard`); moved AI validation to the mapper where `validatedModelCategory` already lives; and closed three silent failures — the `diffPayload`/`baselinePayload` clear-and-clobber trap, silently-swallowed duplicate/over-cap tags, and `RECIPE_REQUIRED_KEYS` turning an optional field into a lost recipe.
- **Pass 3 (Sustainability)**: Killed the union-typed `FrequencyChips.multiple` mode (a type hole across 16 call sites) in favour of a `ChipButton` extraction + separate `ChipToggleGroup`, matching the app's existing single/multi split; moved all ordering and grouping logic out of `useCookbookView` and out of `useRecipeSearch` into one pure `utils/recipeOrdering.ts` so the never-vanish invariant is testable without Vue; split the ~30-file change into three independently-shippable commits; added a Complexity Budget & Non-Goals section; and caught two gaps — `FrequencyChips` cannot scroll (requirement 12) and `courseCounts` must be computed pre-filter.
- **Pass 4 (Fresh-eyes sweep)**: Caught the plan's most dangerous omission — the form has **four** seeding/save sites, not two, and the missed one (`useFormModal({ onEdit })`, `:159-171`) would have silently wiped every recipe's tags, course and meals on any edit; also caught that `diffPayload`'s array equality is by index (so `mealSlots` needs canonical ordering on both payload sides), that `[]` and `undefined` are both "unset" so consumers must test `?.length` rather than truthiness, that `recent`/`cooked` need a `byRecipeName` tie-break for device-stable order, that the course filter must **not** persist (a restored filter reads as data loss) while sort/group must, that `FrequencyChips` has 16 call sites across 12 files rather than 13, and that the share task inherits the prompt change free via `SHARE_JSON_SHAPE` but its fixtures need the new defaults.

## Residual Risks (Pass 4 — accepted, with mitigations)

1. **Commit 1 is a 10-file behaviour-identical refactor of the meal planner with no existing test coverage of the emoji/order/label sites.** The regression test named in the Testing Plan is written against the _pre-change_ literals, and the manual visual check of planner + wall + nook + **PDF export** is load-bearing. Do not skip the PDF.
2. **The `ChipButton` characterisation test is only worth anything if it lands BEFORE the extraction.** Written after, it characterises the refactor rather than the original. Commit it first, then refactor, then confirm it is still green without editing it.
3. **#86's client is on `main` but undeployed**, and #87 edits the same three recipe files (`FamilyCookbookPage`, `RecipeDetailPage`, `RecipeFormModal`). They will deploy together. That is acceptable — both are tested — but it means a rollback of #87 also rolls back #86's client fix.
4. **Two-deployable:** the prompt change is inert until the Lambda ships. Until then the client simply receives no `course`/`mealSlots`, lands blank, and the user fills them in — a graceful degradation, not a failure, and the reason `RECIPE_REQUIRED_KEYS` is left alone.

## Prompt Log

> No GitHub issue created. This plan was approved for direct implementation.

See `docs/prompts/2026-09/2026-09-04-recipe-dish-image-ladder.md` (same feedback thread) and Notion #87.
