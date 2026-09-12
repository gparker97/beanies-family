# Plan: Build a shopping list from a recipe

> Date: 2026-09-12
> Related issues: Notion #88 (Beanies Main Issue Tracker). **No GitHub issue** — `github issue = do not create`.
> Plan file: `docs/plans/2026-09-12-shopping-list-from-recipe.md`

> **No GitHub issue created.** This plan was approved for direct implementation.

## User Story

As a parent planning the week's meals, I want to turn a recipe into a shopping list in
one action, so I don't retype ingredients that are already in the app.

## Context

A family that has just chosen a recipe has to retype its ingredients by hand to shop for
it, even though beanies already holds them. Let a recipe hand its ingredients straight to
a new list, so the gap between "we're making this" and "here's what to buy" closes in one
tap. Raised by an early adopter via Discord on 2026-09-04, alongside the recipe-photo and
recipe-category asks (#86, #87), which greg filed separately.

### Why this is small

`Recipe.ingredients` is already `string[]`, and `FamilyListItem` is already
`{ id, title, completed }` — a free-text title plus a tick. So `"2 cups plain flour"`
becomes one item **unchanged**. This is a mapping function and a button, not an
extraction problem.

**v1 uses no AI, deliberately.** AI only earns its place for what mapping cannot do:
merging duplicates across several recipes, aisle grouping, quantity arithmetic. Ship the
free version first and see if anyone asks.

### There is no "shopping list" type, and we are not adding one

Lists are classified only by `ListCategory` (`'home' | 'out' | 'kids' | …`). A grocery
list is category `'out'`. Shopping-ness is convention, not type — so this feature creates
an ordinary `FamilyList` and nothing about the list model's shape changes except one new
optional link field.

## Requirements

1. **An entry point on the recipe detail page**, beside the existing Edit / cook actions.
2. **A pure mapper** from `Recipe.ingredients` to list-item titles — a plain util,
   unit-testable with no store, no clock, no Vue.
3. **A prefilled review sheet** the user must confirm. Nothing is created until they save;
   cancelling creates nothing at all.
4. **One `createList` call with every item inline** — a single CRDT write, not N.
5. **The created list is linked back to its recipe** (`linkedRecipeId`), following the
   existing `linkedActivityId` / `linkedVacationId` pattern, with the matching cascade so
   deleting the recipe leaves the list intact but unlinked.
6. **A recipe with no ingredients does not offer a broken action** — the entry point is
   absent, not present-and-failing.
7. **Section headers are dropped** before the sheet opens (see Caveats for the exact rule),
   and the sheet says how many were skipped.
8. **A second list from the same recipe is allowed, but not silently** — the sheet says one
   already exists and offers to open it.

## Important Notes & Caveats

- **The two decisions the tracker left open were resolved with greg on 2026-09-12**, in the
  pre-plan clarify loop. Both are requirements, not suggestions:

  **(a) Second list from the same recipe — allowed, but announced.** When a list already
  exists for this recipe, the review sheet says so and offers to open the existing one; the
  user can still create a second. Cooking the same dish again next month is a real case, so
  blocking is wrong — but accumulating silent duplicates is also wrong.

  **(b) Section headers — dropped, by a deliberately NARROW rule.** A line counts as a
  heading only when it **ends with `:` AND contains no digit**, so `"2 cups flour:"`
  survives. ⚠️ Because dropping is otherwise invisible, **the sheet must state how many
  heading lines were skipped**. That condition is why this option was chosen over passing
  every line through; a silent drop would not have been acceptable.

- **`listSeed.ts` is the mapper's home, not a new file.** It already opens _"What a NEW list
  contains — the pure rules, with no store, no clock and no I/O"_ and already holds
  `freshItems(titles: string[]): FamilyListItem[]` (the exact `string[] → FamilyListItem[]`
  mapping this feature needs) and `buildCopySeeds`. A third seed builder belongs beside them.
- **Do not carry `linkedActivityId` / `linkedVacationId` into the new seed.**
  `buildCopySeeds`'s docblock makes this point for the copy path — _"a copy of a packing list
  must not also be attached to the original trip"_ — and the same discipline applies here. The
  new seed sets `linkedRecipeId` and nothing else link-shaped.
- **Lifecycle is `'oneoff'`, NOT recurring.** The curated `grocery` template is
  `recurring`/`weekly` because a weekly shop repeats; a shop for _this recipe_ does not. A
  recurring list would reset its ticks every week forever, which is wrong for this.
- **The unlink goes in the ATOMIC batch, NOT through `clearLinksFor`** — settled in Pass 2,
  see Approach §3. `deleteRecipeCascade` is a repo-level atomic batch that already
  dereferences meal-plan entries in the same change; `clearLinksFor` is a loop of N separate
  writes that ignores each one's return value.
- **`familyLists` is flag-guarded** (`flagRegistry.ts:60`, committed `true`). The entry point
  must be inert when the flag is off — `LinkedLists.vue` already models this exactly.
- **Ingredient lines can be long**, e.g. _"2 cups (250g) plain flour, sifted, plus extra for
  dusting"_. ⚠️ `ListItemRow` **cannot** meet that criterion — its editable branch is
  `min-w-0 flex-1 truncate` (`ListItemRow.vue:124`), so it clips by design. This is why the
  sheet edits a textarea rather than rows; see Approach §4.

## Assumptions

> **Review these before implementation.**

1. `Recipe.ingredients` is a required `string[]` (may be empty). Verified at
   `models.ts` — `ingredients: string[]`, not optional.
2. Adding one optional `linkedRecipeId?: UUID` to `FamilyList` is backward-compatible
   (Automerge tolerates absent optional keys); no migration.
3. `createList` accepts every field inline via `CreateFamilyListInput`
   (`Omit<FamilyList, 'id' | 'createdAt' | 'updatedAt'>`), so one call is genuinely one write.
4. The current member is the right owner and creator, matching `createFromTemplate`.
5. ~~Nobody is relying on `clearLinksFor`'s `kind` union being exactly two members.~~
   **Moot (Pass 2)** — the union is no longer widened; it narrows to
   `Exclude<ListLinkKind, 'recipe'>`, so its existing callers and test are untouched.

## Approach

> **Pass 3 cut this from 14 files to 8** by removing everything no requirement asks for. The
> list of what is deliberately NOT touched is in Files Affected, and is as load-bearing as the
> list of what is.

### 1. Model — one optional field

`src/types/models.ts`, on `FamilyList`, beside its two siblings:

```ts
linkedActivityId?: UUID; // optional attach to an activity
linkedVacationId?: UUID; // optional attach to a trip
linkedRecipeId?: UUID;   // optional attach to a recipe (the shopping list it produced)
```

`Recipe` is **not** modified. The pointer belongs on the many side: the alternative,
`Recipe.listIds: string[]`, is strictly worse under Automerge — a concurrently-edited array
that merges badly, plus a _reverse_ cascade obligation on list delete, which happens far more
often than recipe delete.

### 2. Pure — the mapper, in `listSeed.ts`

**Two exports** beside `freshItems` (the heading rule is the _implementation_ of the split,
not a separate concept, so it stays module-private and is tested through the split):

```ts
export function splitRecipeIngredients(ingredients: string[]): {
  titles: string[]; // lines that become items, in recipe order
  headingsSkipped: number; // SHOWN to the user, never silent
};

export function buildRecipeListSeed(args: {
  recipeId: string;
  titles: string[];
  title: string; // resolved + interpolated by the caller — i18n stays out of pure code
  memberId: string;
}): CreateFamilyListInput;
```

`buildRecipeListSeed` reuses `freshItems(titles)` and writes **exactly eight keys** — a closed
set, so "no other link field" has something to assert against: `title`, `emoji`, `category:
'out'`, `ownerId`, `items`, `lifecycle: 'oneoff'`, `completed: false`, `createdBy`, plus
`linkedRecipeId`. The single `memberId` argument feeds **both** `ownerId` and `createdBy`,
matching `createFromTemplate` and `NewListSheet.startBlank`.

- **Emoji is read, not hardcoded**: `getListCategory('out')?.emoji ?? '🛒'` — the helper
  returns `ListCategoryDef | undefined` (`listCategories.ts:77`), so the `?.` is required to
  typecheck, and the fallback matches `NewListSheet.vue:46`'s shipped `?? '📝'` shape. It is
  unreachable by construction, not a second source of truth.
- **`cycleCelebrated` is OMITTED, not set to `false`.** `setLifecycle('oneoff')` explicitly
  clears it (`listStore.ts:821`), which is the authoritative statement that a oneoff list
  should not carry the key.
- Blank/whitespace-only lines are dropped and are **not** counted as headings.
- 🔴 **The heading rule runs exactly ONCE, at open.** `splitRecipeIngredients` maps _the
  recipe_ to a starting draft; the textarea then holds the user's own authored lines, and
  what is in the box is what gets created. Re-running the rule on save would silently delete
  a line the user deliberately typed (`Marinade:`) — with the skipped-count hint, computed
  from the recipe, not even moving to admit it. That is the very failure the narrow rule and
  the visible count were chosen to prevent, re-opened from the other side. The two directions
  are different jobs and get different functions:

  ```ts
  /** Shared by both directions: trim every line, drop the empties. */
  function cleanLines(lines: string[]): string[]; // private — the DRY unit is the CLEANING

  export function splitRecipeIngredients(ingredients: string[]): {
    titles: string[];
    headingsSkipped: number;
  }; // recipe → draft. cleanLines + heading rule.
  export function parseDraftItems(text: string): string[]; // draft → items. cleanLines only.
  ```

  The skipped-headings hint is computed once, from the recipe, at open, and is worded in the
  past tense about the recipe. It is not recomputed as the user types.

### 3. Cascade — one group of ops in the ATOMIC batch

⚠️ **Not `clearLinksFor`.** That function (`listStore.ts:831-839`) is a `for` loop of
`await updateList(...)` — N separate CRDT writes, worker round-trips, re-encryptions and Drive
sync payloads — and it **ignores each return value**, so a failed unlink leaves a permanently
orphaned link with no telemetry and the loop continuing. Routing through it would mean the
recipe deletes atomically and its links clear non-atomically _afterwards_: exactly the orphan
window that putting the meal-plan deref **inside** the batch was done to close.

- `listRepository.ts` — add `listIdsForRecipe(recipeId): string[]`, a mirror of
  `mealPlanRepository.mealIdsForRecipe`.
- `recipeRepository.deleteRecipeCascade` — one more group of ops beside the meal-plan deref,
  identical in shape:
  ```ts
  ...listIdsForRecipe(recipeId).map((id): MutationOp => ({
    op: 'patch', collection: 'lists', id, patch: {},
    deleteKeys: ['linkedRecipeId'], updatedAt: now, onMissing: 'skip',
  })),
  ```
  `onMissing: 'skip'` is required: a list deleted on another device mid-gesture must not fail
  the recipe delete.
- **`listStore.ts` gains NOTHING but a comment.** No signature change, no behaviour change,
  no new export, no test change. `clearLinksFor` keeps its `'trip' | 'activity'` union and
  gains ONE docblock line — _"recipe links are cleared in
  `recipeRepository.deleteRecipeCascade`'s atomic batch, deliberately not here; this loop is N
  writes and ignores each return value."_ Its callers (`activityStore.ts:887`,
  `vacationStore.ts:311-312`) and its test are untouched, and Assumption 5 is moot.
  ⚠️ A `listsLinkedTo` / `LIST_LINK_FIELD` generic getter was considered and **rejected**: it
  serves exactly one new read, and spelling link reads as `listsLinkedTo('trip', …)` would
  defeat `grep linkedVacationId` — indirection over a 3-entry map is a layer, not DRY.
- **No reactive mirror.** `mealPlanStore.nullifyRecipe` exists because the meal board visibly
  renders the dangling reference (_"so the board doesn't show stale refs"_); **nothing renders
  `linkedRecipeId`**, so a stale value in `listStore.lists` is unobservable here and
  self-corrects on the next load. If a recipe-linked embed is ever added, the mirror must be
  added with it. The two places that would render it and deliberately do not are
  `ListTile.vue:53` (the 🔗 `statusPill`) and `ListDetailModal.vue:516` (the Link chips) —
  both enumerate `linkedVacationId`/`linkedActivityId` only. A recipe chip there would make
  `components/lists/` import recipe state, the dependency edge §4 exists to avoid.

### 4. UI — entry point and review sheet

**Entry point.** `RecipeDetailPage.vue`, quiet white/80 variant — the page reserves the
gradient for "I cooked this".

⚠️ **OUTSIDE the `canEditActivities` gate, deliberately.** Creating a shopping list writes a
`FamilyList`; the recipe is untouched. The page already sets this precedent for Share —
_"OUTSIDE the edit gate on purpose: sharing is not editing"_ (`:325-327`) — and **no lists
surface in the app is permission-gated at all** (verified: zero `usePermissions` references
across `components/lists/` and `BeanieListsPage.vue`; the "New list" button is open to every
member). Gating here would hand a view-only member a route they can use on `/lists` but not
from a recipe.

Rendered when `isFlagEnabled('familyLists')` **and**
`splitRecipeIngredients(recipe.ingredients ?? []).titles.length > 0` (see F4). The `?? []` is
the codebase's own defensive read for this field (`recipeComparable.ts:23`,
`RecipeFormModal.vue:236`) — Automerge documents are not schema-validated, and this gate runs
on every recipe-detail render, so an `undefined` here would blank the page rather than hide a
button. The mapper's signature stays `string[]`; the guard belongs at the boundary.
⚠️ **The page must NOT import `useListStore`.** All list coupling — the duplicate check, the
create call, the navigation — lives inside the sheet, or the recipe page quietly becomes a
second lists client.

**The review sheet — `src/components/pod/RecipeListSheet.vue`** (new, ~80 lines).
⚠️ **`pod/`, not `lists/`.** No file in `src/components/lists/` imports a domain component
outside `lists/` and `ui/` — the dependency direction is strictly one-way today, and a
component taking a `Recipe` prop would be the first edge back. Verified across the directory.

Assembled from four existing pieces rather than written:

- **Shape** copied from `ListCopyModal.vue`: `BeanieFormModal` + `useFormModal(…, { onEdit:
reset, onNew: reset })` + an `isSubmitting` guard + falsy-check-then-close.
- **Items editor: ONE textarea**, prefilled `titles.join('\n')`.
  The decisive reason is **state, not styling**: nothing is persisted yet. `ListItemRow` exists
  to edit a _saved_ `FamilyListItem` by id — it carries per-row draft state, `useInlineEdit`,
  toggle/reorder/delete handlers and vuedraggable, all of which would have to be
  re-implemented against a transient array with fabricated ids thrown away on cancel. A
  textarea owns no per-item state, gives add/remove/reorder for free via ordinary typing, and
  is the same control the user entered these ingredients with (`RecipeFormModal.vue:643-648`).
  Long lines also wrap in it — though note they still truncate in `ListDetailModal`
  (`ListItemRow.vue:124`), which this plan does not change.
  ⚠️ `LIST_TEXTAREA_CLASS` is a **local** const in `RecipeFormModal.vue:536`, deliberately not
  migrated to `BaseTextarea` ("a swap is a visual change needing design sign-off"). Copy the
  class string into the sheet with a comment pointing at the original; do NOT export styling
  out of a 700-line modal.
- **Skipped-headings notice**: `<InferredHint :text="skippedHint" />` — Heritage-Orange
  "worth a look" copy that renders nothing when empty (so no `v-if`), already the idiom
  `RecipeFormModal` uses for "beanies filled this in".
- **Existing-list notice**: `listStore.lists.filter(l => l.linkedRecipeId === recipe.id)` —
  the same one-liner `LinkedLists` already writes — rendered as a row of titles.

**"Open the existing list" NAVIGATES, it does not mount.** `BeanieListsPage` already accepts
`?view=<listId>` and opens the drawer from it immediately on first render
(`BeanieListsPage.vue:45-51`), stripping the query on close so a repeat navigation reopens it
(`:130-139`). So the button is `router.push({ name: 'Lists', query: { view: id } })` — no new
mount, no close handler, and the route's own `requiresFlag: 'familyLists'`
(`router/index.ts:265`) is a second, free flag check.
⚠️ `ListDetailModal` is deliberately **not** mounted here: it is ~700 lines, the project has
already refused to bend it for a third caller (`ListCycleModal.vue:12`), and a user tapping
"you already made a list for this" is going shopping — the Lists page is the destination, not
a detour. (`TravelPlansPage` mounts it because the user must _stay_ on the trip they are
editing; that is a different situation.)

**`LinkedLists.vue` is NOT touched.** No requirement asks for an embed on the recipe page, and
adding `recipeId?` would take its "pass exactly one of" prop contract — which TypeScript
cannot express and nothing enforces — from two mutually-exclusive props to three.

### 5. Failure modes — the draft wrongly declared there were none

The mapper is pure and total; **the sheet is not**. Each is a required behaviour:

- **F1 — no current member.** `familyStore.currentMember?.id ?? ''` is the ambient idiom and
  writes a dangling `ownerId`. `copyListForMembers` refuses to do this
  (`listStore.ts:494-502`: _"a list with a dangling ownerId is worse than a failure the user
  can retry"_). Save resolves the member id; if absent it does **not** call `createList`, shows
  a translated error, and `reportError({ severity: 'error' })` with developer direction naming
  `familyStore.currentMember`. Per the beanie-mode floor this is an important surface: the
  `beanie` value keeps the real noun ("member"), lowercase only.
- **F2 — double-submit.** `ListCopyModal.vue:61-66` documents that the guard AND the bound
  `is-submitting` are both needed, because without them a double-tap makes multiples.
- **F3 — `createList` returns null.** `wrapAsync` has already toasted and reported, so the
  sheet must **not** toast again — and must **not** close, so the draft survives for a retry.
- **F4 — an all-headings recipe.** Gating on `ingredients.length` lets a recipe whose every
  line is `"For the sauce:"` open a sheet yielding zero items — the present-and-failing action
  Requirement 6 forbids. Gate the ENTRY POINT on
  `splitRecipeIngredients(recipe.ingredients ?? []).titles.length > 0` (memoised in a
  `computed`); disable SAVE on `parseDraftItems(draft).length === 0` — the two use different
  functions for the reason in §2.
- **F5 — recipe deleted while the sheet is open.** Re-check
  `recipesStore.recipes.some(r => r.id === props.recipe.id)` at save — the store mirror the
  page already renders, **not** the projection: a component must not reach into the data
  layer (MVO). Bail without calling `createList` rather than write a dangling
  `linkedRecipeId` the cascade has already been and gone for. The page's `v-if="recipe"`
  already unmounts the sheet on a LOCAL delete; this covers the remote-delete-mid-await
  window only.

### 6. i18n

New `uiStrings` keys under `lists.fromRecipe.*`, `en` + `beanie`, interpolated with
`fillTemplate` (`{recipe}`), never concatenated. Ordinary product copy may be playful.

**F1's error key is named with an `Error` suffix** (`lists.fromRecipe.noMemberError`) so
`uiStrings.test.ts:194`'s `KEY_SUFFIXES` regex classifies it as an important surface
**automatically** — the beanie-mode floor is then machine-enforced with zero edit to
`IMPORTANT_PREFIXES`, and its `beanie` value keeps the real noun ("member"), lowercase only.
Asserting a rule the test cannot see would have left it to goodwill.

## Files Affected

**Eight source files**, after Pass 3 removed everything no requirement asks for:

- `src/types/models.ts` — `FamilyList.linkedRecipeId?`
- `src/utils/listSeed.ts` — `splitRecipeIngredients`, `buildRecipeListSeed`
- `src/services/automerge/repositories/listRepository.ts` — `listIdsForRecipe`
- `src/services/automerge/repositories/recipeRepository.ts` — the unlink ops in the atomic batch
- `src/components/pod/RecipeListSheet.vue` — **new**, ~80 lines
- `src/pages/RecipeDetailPage.vue` — entry point + the sheet
- `src/services/translation/uiStrings.ts` — the new keys
- `src/content/help/the-pod.ts` — the Family Cookbook article
- `src/content/help/features.ts` — the Beanie Lists pointer (that article lives here, not in `the-pod.ts`)
- Tests: `listSeed.test.ts` (extend), a `recipeRepository` batch test, a `RecipeListSheet`
  component test

**Deliberately NOT touched** — this list is as load-bearing as the one above, and each entry
is a decision with a reason, not an omission:

| File                                     | Why not                                                                                                                                                   |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/stores/listStore.ts` (+ its test)   | The `listsLinkedTo` refactor was rejected; `clearLinksFor` gains a docblock line, no signature change, so its two existing callers and test are untouched |
| `src/stores/recipesStore.ts`             | No reactive mirror needed — nothing renders `linkedRecipeId`                                                                                              |
| `src/components/lists/LinkedLists.vue`   | No requirement asks for a recipe embed; keeps its 2-prop contract                                                                                         |
| `src/components/pod/RecipeFormModal.vue` | `LIST_TEXTAREA_CLASS` is copied with a pointer, not exported out of a 700-line modal                                                                      |
| `src/utils/splitLines.ts`                | Not created — `splitRecipeIngredients` is the single "text → lines" home                                                                                  |
| `ListDetailModal` mount                  | Replaced by the shipped `/lists?view=<id>` deep link                                                                                                      |

## Help Center Coverage

- **Action**: `update existing`
- **Category**: `features`
- **Slug**: the existing **The Family Cookbook** article (`the-pod.ts`), plus a pointer from
  **Beanie Lists**
- **Title**: unchanged
- **Scope**: A short section explaining that a recipe can hand its ingredients to a new
  shopping list in one tap, that you review and edit the items before anything is created,
  and that the list records which recipe it came from.
- **Notes**: must say that heading lines like _"For the sauce:"_ are left out, and that
  making a second list for the same recipe is allowed — otherwise the skipped-count and the
  duplicate notice both read as bugs. ⚠️ Do **NOT** claim you can jump from the list back to
  the recipe: that affordance is deliberately not in v1 (nothing renders `linkedRecipeId`).

## Observability Coverage

**Surface: `list-from-recipe`** (kebab-case, greppable). `action` values are **snake_case**,
matching every existing value in this area (`copy_completed`, `delete_missing_list`, …).

Three events, not five — Pass 3 trimmed the speculative ones, and note `createList` already
calls `trackFeature(result ?? null, 'list')` (`listStore.ts:416`), so creation is counted in
Plausible independently; the marginal value here is the context fields.

- `logEvent({ level: 'info', surface: 'list-from-recipe', message: '…', context: { action: 'sheet_opened' } })`
  — the denominator.
- `logEvent({ …, context: { action: 'list_created', ingredient_count: <items>, count: <headingsSkipped> } })`
  — the numerator. The opened-to-created ratio is the one measure that says whether the
  feature earns its keep; `count` is how we learn whether the narrow colon rule fires at a
  sane rate, which is the evidence the skipped-count decision rests on.
- `reportError({ surface: 'list-from-recipe', severity: 'error', message: 'no current member — refusing to create a list with an empty ownerId', context: { action: 'no_current_member' } })`
  — failure mode F1.

Deliberately NOT emitted: `sheet_cancelled` (derivable as opened − created), `existing_opened`
(speculative evidence for a v2 the plan says to defer), and `create_returned_null`
(`wrapAsync` already reports with a stack and an action tag, so the failure rate is already
visible on that surface).

**Field semantics, stated because both are ambiguous otherwise**: `ingredient_count` is the
number of items **actually created** (post-edit); `count` is `headingsSkipped` from the
**original recipe**. Without that, the opened-to-created ratio and the colon-rule evidence
would measure different populations. Both keys' allowlist comments record who reuses them
(`#72 recipe capture`), so append this surface to those comment blocks — no entry is added,
but a silent fourth reuser erodes the documentation this plan leans on.

**Failure modes covered**: no current member (`no_current_member`); a failed create
(`wrapAsync`'s own report); a colon rule firing too often (`count`); a feature nobody uses
(`sheet_opened` with no `list_created`). No bare `catch {}` is introduced.

**Critical vs telemetry**: nothing is `critical`. A failed create is a retryable user action
with an on-screen error, not data at risk.

**Privacy/store gate**: `action`, `ingredient_count` and `count` are **already** in
`ALLOWED_CONTEXT_KEYS` (`diagnosticContext.ts:68, 88, 321`) — no new key, no allowlist edit,
no Lambda mirror update, no store-declaration change.
⚠️ **The Pass 1 draft named `quantity`, which is NOT allowlisted** — `redactContext` would
have dropped it with a `console.warn` before send, so the skipped-heading evidence would
never have existed. Do not use it.
⚠️ Ingredient text, recipe names and list titles are user content and are **never** in `context`.

## Acceptance Criteria

- [ ] A recipe with N **non-heading** ingredient lines produces exactly those N items, **in recipe order**, in a single `createList` call
- [ ] The user can edit or remove items before saving
- [ ] Cancelling creates nothing at all
- [ ] A recipe with no ingredients does not offer the action
- [ ] 🔴 A recipe whose ingredients are ALL headings does not offer the action either
- [ ] Heading lines (`ends with ':'` and no digit) are dropped, and the count is shown
- [ ] `"2 cups flour:"` is NOT dropped — the rule is narrow by design
- [ ] A second list for the same recipe is allowed, and the sheet says one already exists,
      with somewhere to open it
- [ ] The created list carries `linkedRecipeId` and no other link field, and omits `cycleCelebrated`
- [ ] "Open the existing list" calls `router.push({ name: 'Lists', query: { view: id } })` (unit)
- [ ] …and the drawer opens on arrival (manual — existing shipped behaviour)
- [ ] Deleting the recipe unlinks its lists **in the same atomic batch**
- [ ] 🔴 …and emits **zero `op: 'delete'` on collection `'lists'`** — the data-loss criterion
- [ ] 🔴 A line ending in `:` that the USER TYPES into the sheet is kept — the rule runs once, at open
- [ ] A recipe-linked list shows no link chip on its tile or in its detail modal (deliberate)
- [ ] `listStore.ts` changes by ONE comment line only — no signature, behaviour, export or test change
- [ ] 🔴 No current member → no list is created, an error is shown, and it is reported
- [ ] 🔴 A double-tap on Save creates exactly ONE list
- [ ] A failed create leaves the sheet open with the draft intact and shows exactly one error
- [ ] The entry point is inert when `familyLists` is off
- [ ] Long ingredient lines wrap in the review sheet — **manual** (list rows still truncate, as today, unchanged)
- [ ] Help Center article updated per **Help Center Coverage**
- [ ] Diagnostic logging in **Observability Coverage** implemented and verified

## Testing Plan

1. Table-test the heading rule THROUGH `splitRecipeIngredients` (it is module-private):
   `"For the sauce:"` → heading;
   `"2 cups flour:"` → item (has a digit); `"Salt"` → item; `""` / `"   "` → dropped and NOT
   counted as a heading; all-headings → zero titles.
   Then `parseDraftItems`: 🔴 `"Marinade:"` typed by the user is **KEPT**; blanks dropped;
   whitespace trimmed.
2. Table-test `buildRecipeListSeed`: N titles → N items with fresh unique ids, all
   `completed: false`; `lifecycle: 'oneoff'`; `category: 'out'`; emoji read from
   `getListCategory`; `linkedRecipeId` set; 🔴 `linkedActivityId` / `linkedVacationId` /
   `cycleCelebrated` **absent**.
3. `recipeRepository` (**new test file** — none exists today; mock `../worker/docClient` and
   `../projection`'s `list`, copying `listStore.copy.test.ts:111-128`'s shape): the SINGLE
   `mutate` call's `ops` contains one `patch`/`deleteKeys: ['linkedRecipeId']`/`onMissing:
'skip'` per linked list, the recipe delete, the existing cookLog/mealPlan ops, and
   🔴 **zero `delete` ops on `'lists'`**.
4. (removed — `listStore` is not modified.)
5. Component (`RecipeListSheet`): the skipped-heading hint shows only when non-zero; the
   existing-list notice only when one exists; cancel calls no store method; save calls
   `createList` exactly **once**.
6. Component failure modes: 🔴 no current member → `createList` NOT called, error shown,
   `reportError` fired; 🔴 double-tap → exactly one `createList`; null return → sheet stays
   open, zero toasts from the sheet; all-headings recipe → no entry point.
7. **Mutation check**: make `isIngredientHeading` drop any line ending in `:` regardless of
   digits, and confirm the `"2 cups flour:"` test fails — that mutation silently deletes a
   real ingredient.
8. **Mutation check**: remove the `isSubmitting` early return and confirm the double-tap test fails.
9. Browser, both modes and both languages: a real recipe with headings, one with a very long
   ingredient line, one with no ingredients, one with only headings, and the flag off.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted from the Notion #88 pre-plan block, with the two
  clarify-loop decisions folded in as requirements; identified `listSeed.ts` as the mapper's
  existing home (`freshItems` already does the `string[] → FamilyListItem[]` half).
- **Pass 2 (DRY + error handling)**: verified every reuse claim against the code — corrected
  `quantity` (NOT allowlisted; `redactContext` would have dropped it, so use the existing
  `ingredient_count` + `count`), moved the recipe unlink out of the non-atomic,
  return-value-ignoring `clearLinksFor` loop into `recipeRepository`'s existing atomic batch
  beside the meal-plan deref (+ a `nullifyRecipeLink` mirror), confirmed no reusable
  prefilled-items sheet exists and specified a ~80-line one assembled from `ListCopyModal`'s
  shape, `RecipeFormModal`'s lines-textarea (with `splitLines` extracted to a shared util) and
  `InferredHint` — rejecting `ListItemRow`, whose `truncate` made the long-lines criterion
  unsatisfiable, and `ListDetailModal`, which the codebase had already refused to make
  dual-mode; replaced the inline link filters with one `listsLinkedTo` getter that NARROWS
  `clearLinksFor` rather than widening it; and enumerated the four real failure modes the
  draft declared absent (no current member, double-submit, null-create double-toast,
  all-headings recipe).
- **Pass 3 (Sustainability)**: cut 14 files to 8 by removing everything no requirement asks
  for — the `LinkedLists` recipe embed and its third `recipeId?` prop, the
  `listsLinkedTo`/`LIST_LINK_FIELD` store refactor (leaving `listStore.ts` and its test
  entirely untouched, with `clearLinksFor`'s exclusion recorded as a docblock line instead of
  a type), the `ListDetailModal` mount (replaced by the shipped `/lists?view=<id>` deep link),
  the `nullifyRecipeLink` reactive mirror (nothing renders a stale recipe link, unlike the
  meal board), and the `splitLines.ts` extraction; kept the atomic repo unlink and
  `linkedRecipeId` on the many side, moved the sheet to `components/pod/` so
  `components/lists/` keeps its verified one-way dependency direction, trimmed telemetry from
  five actions to three, and re-grounded the textarea decision on draft-state rather than
  `truncate`. Its one recommendation I REJECTED: re-asking greg about the colon rule — he
  answered it with the review sheet already named in the option he declined, so the decision
  stands; I took the fallback instead and collapsed the rule to a single export.
- **Pass 4 (Fresh-eyes sweep)**: verified the atomic batch is genuinely safe for a
  cross-collection `lists` patch (per-op `collection` in `protocol.ts`, one `Automerge.change`
  in `docOps.ts`, `onMissing:'skip'` returning before touching the entity, and
  `deleteRecipeCascade` already spanning three collections), and confirmed no
  link-resurrection path exists (every `updateList` call site passes a narrow patch, and
  `buildCopySeeds` is an allowlist so the new field cannot leak into a copy). Found and fixed
  the one real bug: re-applying the heading rule to the textarea would have silently deleted a
  line the user deliberately typed, so the rule now runs ONCE at open and the draft parses
  through `parseDraftItems`, both sharing a private `cleanLines`. Resolved the "`listStore.ts`
  is NOT touched" vs "gains one docblock line" contradiction; made F1's beanie floor
  machine-enforced for free by naming the key with an `Error` suffix; corrected the Help
  Center copy, which promised a list→recipe affordance this plan deliberately does not ship;
  moved the entry point OUTSIDE `canEditActivities` (no lists surface is permission-gated, and
  the page's own Share button sets the precedent); routed F5 through `recipesStore` to keep
  MVO intact; fixed `getListCategory(...)?.emoji`, the `ingredients ?? []` boundary guard, the
  `diagnosticContext` line number and the telemetry field semantics; and rewrote the four
  acceptance criteria that were false, contradictory or E2E-only as written.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial prompt (via `/beanies-pre-plan`)

> let's put together the plan for #88 - a feature to generate a shopping list from a recipe
> as this was a user feedback request. once the prompt is done move onto /beanies-plan and
> once the plan is generated then implement directly. once done, run /code-review to ensure
> the code written operates as designed and per the plan and does not introduce any bugs or
> side effects or security issues. fix any issues found.
>
> work autonomously, if you have any questions please let me know now.

### Clarify loop (2026-09-12)

Two behaviours the tracker row left open were put to greg:

**Q1 — a second list from the same recipe?** → _"Offer to reopen, allow anyway"_: the sheet
says a list already exists and offers to open it, but a second can still be created.

**Q2 — section headers like "For the sauce:"?** → _"Drop lines ending in a colon"_, taken
with the stated mitigation that the rule stays narrow (no digit in the line) and the sheet
reports how many lines were skipped, so nothing is silently lost.

### The assembled pre-plan block

Captured verbatim in Notion #88 → `beanies-plan prompt`, and mirrored in this plan's
Context / Requirements / Caveats sections.

</details>
