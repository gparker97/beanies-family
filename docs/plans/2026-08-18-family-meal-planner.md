# Plan: Family cookbook + meal planning (the meal board)

> Date: 2026-08-18
> Related issues: Notion tracker #27 (In Progress). Related: #66 (weekly agenda — consumes meal plans), #39 (granular visibility). No GitHub issue — direct implementation.
> Plan file: `docs/plans/2026-08-18-family-meal-planner.md`
> Mockup: `docs/mockups/meal-planner-2026-08-18.html`

## User Story

As a user, I'd like to plan the meals I'll prepare on a given day, or let our family collaborate on our meal plans, so I always know what I plan to cook (or what my family will cook), we can share the planning together, and never have any disappointment at meal time.

## Context

The app already has a **family cookbook** — `recipesStore` (recipes + a separate `cookLogs` collection), `FamilyCookbookPage`, `RecipeDetailPage`, and `CookLogFormModal` / `RecipeFormModal`. What's missing is a way to **plan** which meals happen when, who cooks them, and to share that plan. This feature adds a week-first meal-planning page under the Treehouse/planning nav group that augments the cookbook: plan Breakfast/Lunch/Dinner + snacks per day, drag recipes from the cookbook onto the week, assign a cook, mark meals cooked (logging to the recipe), copy a week forward, and share the plan.

The closest existing analog is the **daily briefing** (`useCriticalItems` → `FamilyStatusToast` on the nook), which aggregates todos/activities/meds/lists for a member. Being assigned to cook a meal must appear there like any other assignment. The **`lists`** subsystem (`listStore`/`listRepository`) is the nearest structural precedent: a single-owner, briefing-integrated entity — mirror it for the new `mealPlans` entity. The **recipes/cookLogs** pair is the precedent for a parent+child collection with a cascade.

This plan implements an **approved mockup** (`docs/mockups/meal-planner-2026-08-18.html`). Its design intent — a days-across week board, a cookbook rail you drag from, meal cards that lead with the meal name and show the cook beneath, a leading recipe-photo thumbnail with an emoji fallback, non-recipe "type" chips, and Heritage-Orange prompts — is reproduced faithfully, but every concrete style token comes from the beanies CIG (`.claude/skills/beanies-theme/SKILL.md`), not the mockup's raw gradients/values.

## Requirements

1. **Meal-planning page** under the Treehouse/`planning` nav group (alongside activities, to-do, travel, lists), at a new route (`/meal-planner`), lazy-loaded.
2. **Week-first, days-across board**: 7 day columns across the top, meal slots down the side — **Breakfast, Lunch, Dinner** (fixed) + **any number of Snack/Other** entries per day. Responsive: desktop/tablet week grid → mobile vertical **day-stack** (one day at a time, week nav).
3. **A planned meal is EITHER a cookbook recipe OR a non-recipe type**: `eat_out` / `leftovers` / `skip` / `other`. Recipe meals always link to a `recipeId`; when the recipe isn't in the cookbook yet, **quick-add it inline with just a NAME** (creates a minimal `Recipe`). No free-form recipe-less "ad-hoc" meals — the enumerated types cover the non-recipe cases.
4. **Recipe photo thumbnail** on the card when the linked recipe has `photoIds`, with a **graceful emoji-tile fallback** when it has none (never blank).
5. **Card hierarchy**: the meal name is the prominent element; the assigned **cook** is clearly shown beneath it (single cook per recipe meal; `eat_out`/`skip` need no cook). A small **state dot**: to-cook = Heritage Orange, cooked = green.
6. **Desktop/tablet drag-and-drop**: drag a recipe from a searchable **cookbook rail** onto a day+slot cell; drag a placed meal within the grid to move it. **Every drag action MUST have a tap/keyboard-accessible equivalent** — mobile (and keyboard users) tap a slot → a recipe **picker sheet** (search + name-only quick-add + the type chips).
7. **Per-meal fields**: `who's eating` (family subset, defaults to everyone, **plus ad-hoc external guest names** with no member record); an optional one-off **note**; an optional **serve-time** (a clock time — a distinct field from a recipe's prep _duration_), shown on the card and in the day's briefing line — **display only; no OS reminder** this version.
8. **Mark cooked** (recipe meals only) → opens the **existing** `CookLogFormModal` (rating required) → creates a `cookLogs` entry against the recipe via `recipesStore.createCookLog`. Type meals never create cook logs.
9. **Daily-briefing integration**: a cook assignment surfaces in the daily briefing as a new `'meal'` `CriticalItem` kind (briefing-only, like `medication`/`lists` — **no OS reminder**). The `'meal'` kind is added to `useCriticalItems` **only** (its message-key tables live there); there is **no** `deriveNotifications` change — briefing-only kinds like `medication` live solely in `useCriticalItems` (verified: `notifications.ts` has zero `medication`/`holiday` handling).
10. **Nook "Today's meals" card** mirroring `ScheduleCards`' pattern — today's meals with cook + photo thumbnail.
11. **Share** the plan via the existing share channels — **both** a single-**day** and a whole-**week** share, as readable plain text.
12. **Copy an entire week** into the current or an upcoming week to seed the next plan — meals + cook assignments copied with shifted dates; **recipes referenced, not cloned**. Copying **overwrites** the target week's meals, showing a **warning first** when the target already has data (Heritage-Orange confirm, never red). Entry points: a quick "copy previous week" action, and — from any past week opened via **plan history** — a "copy this plan to the current/upcoming week" action.
13. **Plan history** kept unbounded (entries are tiny), browsable by week.
14. **i18n**: every user-visible string (`en` + `beanie`) in `uiStrings.ts`; no bare strings; route through `t()`.
15. **Ships ungated** (no feature flag) and **no GitHub issue**.

## Important Notes & Caveats

- **`cookLogs` is a separate top-level collection** keyed to a recipe by `recipeId`, NOT nested in `Recipe`. Mark-cooked must call `recipesStore.createCookLog` (rating 1–5 required); it does not mutate the meal-plan entry beyond flipping its `cooked` flag + storing the resulting `cookLogId`.
- **Recipe delete while a future/past meal references it** (owned by the cookbook, but this feature creates the references): `deleteRecipeCascade` gains a guard — when a recipe is referenced by any `mealPlans` entry, **warn** (naming it's used in upcoming/past meal plans, count via `countMealsForRecipe`) and **confirm**; on confirm, do it as **one atomic `mutate({ op: 'batch' })`** in `recipeRepository.deleteRecipeCascade`: the existing cook-log `delete` ops + the recipe `delete` op **+ one `update` op per `list('mealPlans')` entry referencing the recipe** setting `recipeId: undefined` (→ "recipe removed"). After the repo call, `recipesStore.deleteRecipeCascade` must also reconcile `mealPlanStore` reactive state (patch the nullified entries in place, as it already does for local `recipes`/`cookLogs`), else the board shows stale refs until reload. Already-recorded `cookLogs` are independent and unaffected.
- **Copy-week must preserve cook-log history**: copying overwrites the target week's `mealPlans` entries but must NOT touch any `cookLogs` already recorded for that week.
- **Who's-eating guests are non-members**: model guest names as plain strings on the entry (no `FamilyMember` record); display them without an avatar lookup. Audience/visibility (`classifyOwnerAudience`) keys off the single `cookMemberId`, not the eaters.
- **Drag-drop is a progressive enhancement**: the tap picker is the canonical, accessible path and must be fully functional on its own; DnD is layered on top for pointer devices. Respect `prefers-reduced-motion`.
- **Serve-time is display-only** — the meal's `serveTime` is NOT wired to `useScheduledReminders`/`useLocalNotifications` (that would contradict the briefing-only decision). A timed OS reminder off serve-time is an explicit follow-up. (Named `serveTime`, not `prepTime`, to avoid colliding with `Recipe.prepTime` = prep duration.)
- **Week-start** comes from `settingsStore.weekStartDay` via `useWeekNavigation.getWeekStart` (the existing app convention — configurable, NOT hardcoded Monday), reused by the grid, copy, and history so they never disagree. Day boundaries via `useToday()`.
- **Do NOT** build: grocery lists, nutrition, AI suggestions, an auto-recurrence engine, OS reminders, or the #66 cross-subsystem weekly digest.

## Assumptions

> **Review these before implementation.** Valid at planning time (2026-08-18); confirm if time has passed.

1. `recipesStore.createCookLog(input)` is `wrapAsync`-wrapped and returns `CookLogEntry | null`; input `Omit<CookLogEntry,'id'|'createdAt'|'updatedAt'>` = required `recipeId`/`cookedOn`/`rating: CookLogRating`, optional `cookedBy`/`wentWell`/`toImprove`/`servings`/`photoIds`/`createdBy` — **confirmed** (re-verify only if the type changes).
2. `listStore`/`listRepository` are a faithful single-owner + briefing template — **confirmed**: `listRepository` = `createAutomergeRepository<'lists',…>('lists')`; `listStore` actions are `wrapAsync(isLoading, error, fn, { action })`-wrapped and mutate a local `ref` array on success. `mealPlanStore` mirrors this exactly.
3. `useCriticalItems` builds `CriticalItem[]` per member and its `type` union is `'todo' | 'activity' | 'medication' | 'holiday' | 'list'` — confirmed (line 24). Adding `'meal'` needs a matching block + its message-key tables **in `useCriticalItems.ts`**, **plus a one-line routing case in `FamilyStatusToast.vue`** (like `medication`/`list`, which are also non-completable tap-to-open and each have a toast routing case). **No** notification-deriver change (briefing-only). "briefing-only / useCriticalItems" does NOT mean "no view edits" — the toast + nook page route the new kind.
4. `classifyOwnerAudience(ownerId, viewer, resolveMember)` in `audience.ts` is the single-owner audience helper used by lists — confirmed via research; the cook maps to the "owner".
5. `ShareChannelGrid.vue` is currently invite-message-shaped and will accept a small, backward-compatible generalization to share an arbitrary text body. Re-verify its props before extending.
6. The `mobileCategory: 'planning'` group and `HINT_KEY_BY_PATH` requirement (module-load throws without a hint entry) are current — confirmed via research + `navigation.ts` header comment.
7. Recipe photos are addressed via `recipe.photoIds` and rendered through the existing photo/blob-url mechanism used by `RecipeDetailPage`; re-verify the getter used to turn a `photoId` into a displayable URL.
8. `FamilyDocument` + `COLLECTION_NAME_SEED` in `automerge.ts` are the two required registration points for a new collection (a compile error enforces the seed) — confirmed (lines 57–58, 98, 118–119).

## Approach

The feature is one new **model** (a `mealPlans` collection projected by a Pinia store), one new **page** (the week board) plus a handful of components, and targeted **integration** edits into existing subsystems (briefing, nook, nav, cookbook delete, share). It follows MVO: the store orchestrates all CRDT mutations; views bind to reactive store state and emit intents.

Reference the mockup `docs/mockups/meal-planner-2026-08-18.html` for layout, hierarchy, and the interaction set; source every style token from the CIG.

### A. Data model & persistence (mirror `lists`; register like `recipes`)

- **`MealPlanEntry`** in `src/types/models.ts`:
  - `id: UUID`, `date: ISODateString` (the day), `slot: 'breakfast' | 'lunch' | 'dinner' | 'snack'`, `position: number` (ordering within a day+slot, for multiple snacks; assigned as `(max existing position in that day+slot) + 1` on insert; deletes do NOT reindex — gaps are fine; `mealsForDate` sorts by `slot` then `position`; no fractional-index/rebalancing scheme — snack counts are tiny).
  - `kind: 'recipe' | 'eat_out' | 'leftovers' | 'skip' | 'other'`.
  - `recipeId?: UUID` (required when `kind === 'recipe'`, else absent).
  - `label?: string` (for `other`, and the display label for `eat_out`/`leftovers` such as "Grandma's" / "from Mon dinner").
  - `cookMemberId?: UUID` (single cook; absent = "anyone"/unassigned; irrelevant for `skip`/`eat_out`).
  - `eaterMemberIds?: UUID[]` (defaults to everyone when absent) and `guestNames?: string[]` (non-member eaters).
  - `note?: string` (one-off), `serveTime?: string` (e.g. `"16:30"` local clock time the meal is served; display only — deliberately NOT named `prepTime`, which on `Recipe` already means a prep _duration_, `Recipe.prepTime`).
  - `cooked: boolean`, `cookLogId?: UUID` (set when marked cooked).
  - `createdAt`/`updatedAt` (repository-managed).
- Register `mealPlans: Record<string, MealPlanEntry>` in `FamilyDocument` and `mealPlans: 0` in `COLLECTION_NAME_SEED` (`src/types/automerge.ts`).
- **`mealPlanRepository.ts`** via `createAutomergeRepository<'mealPlans', MealPlanEntry>('mealPlans')` (mirror `recipeRepository.ts`). Add a **batched** `replaceWeek(weekStartISO, entries)` that deletes all entries in the target week and inserts the new set in one `mutate({ op: 'batch' })` — the copy-week clone, mirroring `deleteRecipeCascade`'s batched pattern. Because the worker applies a `batch` as a single `Automerge.change`, a `replaceWeek` failure leaves the target week's prior entries **untouched** (no partial loss) — so the `critical`-severity copy-week path is atomic, not partially destructive. Also add `countMealsForRecipe(recipeId)` (mirror `countCookLogsForRecipe`) for the recipe-delete confirm text.
- **`mealPlanStore.ts`** (mirror `recipesStore`/`listStore`): `wrapAsync`-wrapped `loadMealPlans`, `createMeal`, `updateMeal`, `deleteMeal`, `copyWeek(fromWeekStart, toWeekStart)`; computed getters `mealsForDate(dateISO)`, `mealsForWeek(weekStartISO)`, `todaysMeals` (via `useToday`). Export from `src/stores/index.ts`.
- **Week helpers — reuse, don't rebuild.** `useWeekNavigation(referenceDate)` in `src/composables/useCalendarNavigation.ts` already exposes `getWeekStart(date)`, `weekDays` (the 7 dates), `weekLabel`, `prevWeek`/`nextWeek`/`goToToday` — all honoring **`settingsStore.weekStartDay`** (the app-wide week-start convention, configurable, NOT hardcoded Monday). The board's week nav + week-start MUST come from `useWeekNavigation`; history labels reuse `relativeWeekLabelKey` + the `planner.week*` keys from `src/utils/calendarWeek.ts`. The ONLY genuinely-new piece is a pure `shiftWeekEntries(entries, deltaWeeks)` copy-shift helper — a single function in `src/utils/mealWeek.ts` (or `mealPlanStore`), not a full week module.

### B. The meal-planner page + components (`src/pages/` + `src/components/mealplan/`)

- **`MealPlannerPage.vue`** (route `/meal-planner`): header (title + Caveat welcome subtitle via the shared `PageWelcomeSubtitle`), week nav (‹ / ›, range, "This week", "Past weeks" history), `Copy last week` + `Share` actions. Chooses the responsive layout:
  - Desktop/tablet: **`MealWeekBoard.vue`** — the days-across grid (7 columns × slot rows) with the recipe rail beside it.
  - Mobile: **`MealDayStack.vue`** — a single day with day nav; taps a slot to open the picker.
  - **Shared cell logic (anti-drift):** `MealWeekBoard` and `MealDayStack` must NOT each re-implement slot rendering, the empty-slot "add" affordance, or the picker-open/mark-cooked wiring. Both render the same `MealCard` and open the same `MealPickerSheet`/`MealEditModal`; the slot-cell behaviour (which slots exist, add-snack, open-editor intent) lives in one shared `MealSlotCell.vue` (or a `useMealSlots` composable) consumed by both layouts, so desktop and mobile can never diverge.
- **`MealCard.vue`** — one planned meal. Leads with the recipe/type name (Outfit, prominent), cook avatar+name beneath (muted), a leading photo thumbnail (`MealThumb.vue`) or emoji fallback, the state dot, and meta glyphs (note / guests / serve-time) only when present. Type meals render as tinted chips. Reuses `BeanieAvatar` for the cook. Draggable on pointer devices; clickable to open the editor.
- **`MealThumb.vue`** — resolves the URL via `photoStore.getPublicUrl(recipe.photoIds[0], 'thumb')` (sync, ADR-021 public Drive URL — the same call `RecipeDetailPage.heroUrl` makes with `'full'`). It returns `string | null`; the **null branch is the emoji fallback** (a deterministic emoji from the slot/recipe). A missing/GC'd photo MUST degrade to the emoji tile, never a blank/broken `<img>`. **The fallback is load-bearing.**
- **`RecipeRail.vue`** (desktop/tablet) — searchable cookbook list (draggable `MealThumb`+name rows), the type chips (Eat out / Leftovers / Skip / Other), and a "New recipe" affordance. Note: `FamilyCookbookPage` has **no** recipe search today (it only alpha-sorts `recipesStore.recipes`), so there is nothing to extract — build a small **new** `useRecipeSearch(recipes, query)` composable and share it between `RecipeRail` and `MealPickerSheet` (DRY across the two new surfaces).
- **`MealPickerSheet.vue`** — the tap/keyboard path (mobile + accessible fallback). A `BeanieFormModal`-hosted search over recipes + name-only quick-add + the type chips. This is the single canonical "choose what goes in this slot" surface; the rail's drag just pre-fills its result.
- **`MealEditModal.vue`** — a `BeanieFormModal` (three-tier system) for an existing/new meal: plan-type toggle (`TogglePillGroup`), recipe select (opens the picker) or the type's label field, the **cook picker** (`FamilyChipPicker` single-select), **who's-eating** (`FamilyChipPicker` multi-select + a free-text guest adder), **note** (input), **serve-time** (`TimePresetPicker`), and — for recipe meals — a **Mark cooked** action that opens `CookLogFormModal`. Delete via `useConfirm({ variant: 'danger' })`. This modal owns only `MealPlanEntry` fields — it must NOT gain recipe-editing (stays in `RecipeFormModal`) or cook-log-editing (stays in `CookLogFormModal`) fields, so it never becomes a god-form.

### C. Drag-and-drop (progressive enhancement)

- Extract a small **`useMealDrag`** composable wrapping the native HTML Drag-and-Drop API (no new dependency): draggable recipe rows + placed cards, drop targets = day+slot cells with an `active` highlight, drop → `mealPlanStore.createMeal`/`updateMeal`. Respect `prefers-reduced-motion` for any drop animation.
- The tap picker (`MealPickerSheet`) is wired first and is fully functional without DnD; DnD calls the same store actions. Keyboard users use the tap path (every cell is a button opening the picker). This satisfies the "every drag action has a keyboard/tap equivalent" a11y requirement.

### D. Mark-cooked → cook-log

- `MealEditModal`'s "Mark cooked" opens the **existing** `CookLogFormModal` pre-filled with `recipeId` + `cookedOn = meal.date` + `cookedBy = meal.cookMemberId`. On save, `await recipesStore.createCookLog(...)` returns `CookLogEntry | null` (`wrapAsync` returns `null` on a caught persist failure and already surfaces its own toast). **Only if the result is non-null** call `mealPlanStore.updateMeal(id, { cooked: true, cookLogId: result.id })`; on `null` do **not** flip `cooked` (else the meal shows cooked with no `cookLogId` and a lost log). No changes to the cook-log data model. (`createCookLog` input: required `recipeId`/`cookedOn`/`rating: CookLogRating`; optional `cookedBy`/`wentWell`/`toImprove`/`servings`/`photoIds`.)

### E. Briefing (`'meal'` kind — built in `useCriticalItems`, routed in the toast)

- Add `'meal'` to the `CriticalItem['type']` union in `useCriticalItems.ts` and a block that, for each of **today's** recipe meals with a `cookMemberId` **that are not yet cooked** (skip `meal.cooked` — like todos filter out completed; the briefing shows only open cook assignments), emits a **tap-to-open** critical item ("You're cooking dinner: Gran's beef stew") using `classifyOwnerAudience(cookMemberId, viewer, resolveMember)` — **`completable: false`** (mirroring `list`/`medication`; NOT an inline checkbox). Marking cooked stays exclusively on the editor → `CookLogFormModal` (rating-required) path — a briefing checkbox cannot create the required cook log. The meal message-key tables (`MEAL_OWNER_KEYS`/`MEAL_FORCHILD_KEYS`/`MEAL_UNASSIGNED_KEYS`, `satisfies Record<…, UIStringKey>`) live in `useCriticalItems.ts` alongside `LIST_*_KEYS`.
- **No `deriveNotifications` change, no `audience.ts` change** — `src/utils/notifications.ts` handles a different set (assignment/completion notifications) with no `medication`/`holiday`/list-due handling; reuse `classifyOwnerAudience` as-is; no `ReminderKind` in `useScheduledReminders` (no OS reminder).
- **BUT two consumer edits ARE required so the item doesn't mis-route** (like every non-completable kind): (a) `FamilyStatusToast.handleItemClick` gains a `'meal'` case (`emit('open-meal')`) so it does NOT fall into the final `else → emit('open-activity', mealId)` branch (a real mis-route bug otherwise); (b) `FamilyNookPage` wires `@open-meal` to open `MealEditModal` — reuse the **same** `MealEditModal` instance the `NookMealsCard` already hosts (§F), so there is one editor host, not two. No `handleComplete` change (non-completable).

### F. Nook "Today's meals" card

- **`NookMealsCard.vue`** wrapping `NookSectionCard`, mounted in `FamilyNookPage.vue` alongside the other cards, bound to `mealPlanStore.todaysMeals`, showing slot · name · cook (+ photo thumbnail), tapping a row opens `MealEditModal`. Mirrors `ScheduleCards` precedent.

### G. Share (day / week) — new `useShareText`, do NOT touch `ShareChannelGrid`

- **Do not generalize `ShareChannelGrid`** — it is hard-wired to a _URL_ (Telegram/Messenger/WeChat/copy-link all operate on `props.link`; the body is the `share.messageBody` invite template with an expiry note + `invite-*` test ids), so a URL-less plan would break its channels. Instead add a tiny **`useShareText`** composable: `navigator.share({ title, text })` when `navigator.canShare`/`share` exists, else fall back to `useClipboard().copy(text)` + a success/failure toast. `useClipboard.copy` returns `false` on failure (it swallows the error in a bare `catch`), so the caller MUST show an error toast + `console.error` on `false` — never fail silently.
- Build the plain-text plan with a small `formatMealPlanShare(meals, scope)` util (readable, markdown-free) and open a **day / week** segmented toggle that feeds `useShareText`.

### H. Copy-week + history

- `Copy last week` and, from a past week opened in history, `Copy to current/upcoming week` both call `mealPlanStore.copyWeek(from, to)`. Before overwriting, if the target week has any meals, show a **`useConfirm({ variant: 'info' })`** Heritage-Orange warning naming the count (never red). `copyWeek` shifts dates by whole weeks, keeps `recipeId`/`cookMemberId`/`kind`/`label`, resets `cooked`/`cookLogId`, and uses `replaceWeek` so it's one batched mutation. History browsing is just the week nav pointed at past weeks (no separate storage — the entries already carry dates).

### I. Nav + routing + i18n

- Add one `NavItemDef` to `NAV_ITEMS` (`labelKey: 'nav.mealPlanner'`, `path: '/meal-planner'`, `emoji`, `section: 'treehouse'`, `mobileCategory: 'planning'`) **and** a `HINT_KEY_BY_PATH['/meal-planner']` entry (module-load throws otherwise — covered by the navigation unit test). Add the lazy route in `src/router/index.ts` with `meta: { titleKey, requiresAuth: true }`.
- All strings (`nav.mealPlanner`, page header, slot names, type labels, briefing keys, share copy, confirm copy, empty states) added to `uiStrings.ts` with `en` + lowercase `beanie` values; render via `t()` / `useTranslationStore().t()` in `.ts`. Run `npm run translate` and spot-check the zh output.

## Files Affected

**New**

- `src/types/models.ts` — add `MealPlanEntry`, `MealSlot`, `MealKind` (edit)
- `src/services/automerge/repositories/mealPlanRepository.ts`
- `src/stores/mealPlanStore.ts` (+ export in `src/stores/index.ts`)
- `src/pages/MealPlannerPage.vue`
- `src/components/mealplan/MealWeekBoard.vue`, `MealDayStack.vue`, `MealSlotCell.vue` (shared slot-cell seam), `MealCard.vue`, `MealThumb.vue`, `RecipeRail.vue`, `MealPickerSheet.vue`, `MealEditModal.vue`
- `src/components/nook/NookMealsCard.vue`
- `src/composables/useMealDrag.ts`, `src/composables/useRecipeSearch.ts` (new; shared by rail + picker), `src/composables/useShareText.ts` (new)
- `src/utils/mealWeek.ts` (a single `shiftWeekEntries` helper only — week-start/labels reuse `useCalendarNavigation` + `calendarWeek`), `src/utils/formatMealPlanShare.ts`
- `src/content/help/features.ts` — new help article (see Help Center Coverage)
- Tests: `src/stores/__tests__/mealPlanStore.test.ts`, `src/utils/__tests__/mealWeek.test.ts`, `src/composables/__tests__/useCriticalItems.test.ts` (extend), `e2e/specs/meal-planner.spec.ts`

**Edited**

- `src/types/automerge.ts` (FamilyDocument + COLLECTION_NAME_SEED)
- `src/composables/useCriticalItems.ts` (+ `'meal'` block + meal message-key tables). **No change** to `src/utils/notifications.ts`, `src/types/notifications.ts`, `src/components/notifications/notificationKinds.ts`, or `src/utils/audience.ts` (reuse `classifyOwnerAudience` as-is).
- `src/components/nook/FamilyStatusToast.vue` — add the `'meal'` routing case (`emit('open-meal')` in `handleItemClick`) so it doesn't fall through to `open-activity`; no `handleComplete` change (non-completable).
- `src/composables/useCalendarNavigation.ts` (reuse `useWeekNavigation` — no change)
- `src/constants/navigation.ts` (NAV_ITEMS + HINT_KEY_BY_PATH), `src/router/index.ts`
- `src/pages/FamilyNookPage.vue` (mount `NookMealsCard`; wire `@open-meal` from `FamilyStatusToast` → the shared `MealEditModal`)
- `src/composables/useClipboard.ts` (reuse for the copy fallback — check its `false` return). **No change** to `src/components/family/ShareChannelGrid.vue`.
- `src/stores/recipesStore.ts` / `src/services/automerge/repositories/recipeRepository.ts` (`deleteRecipeCascade` gains the meal-plan-reference guard + nullify)
- `src/services/translation/uiStrings.ts`
- `docs/mockups/meal-planner-2026-08-18.html` (the approved mockup — part of the change record)
- Observability: `src/services/telemetry/logEvent.ts` (`ALLOWED_CONTEXT_KEYS` if a new context key ships) + store data-collection declarations

## Help Center Coverage

- **Action**: new article
- **Category**: `features`
- **Article type**: `how-to`
- **Slug**: `planning-your-familys-meals`
- **Title**: Planning your family's meals
- **Scope**: How to plan the week's meals from your cookbook — add a recipe to a day, quick-add a recipe that isn't in the cookbook yet, mark who's cooking, mark a meal cooked (and how that adds to the recipe's cook log), use eat-out/leftovers/skip, copy a week forward, and share the plan with the family.
- **Notes**: Call out that copying a week **overwrites** the target week (with a warning), that cook-log history is kept, that being assigned to cook shows up in the daily briefing (no phone reminder in this version), and that a shared plan respects who can see what. Written per `.claude/skills/beanies-help-docs/SKILL.md`; lands in the same change.

## Observability Coverage

Surface prefix: **`meal-planner`** (one CloudWatch filter isolates the feature).

- **Lifecycle / outcome events** (`logEvent`, `info`): `surface: 'meal-planner'` with `context.action` ∈ `meal-created | meal-updated | meal-deleted | marked-cooked | week-copied | plan-shared`, plus structured queryable fields: `kind` (recipe/eat_out/…), `slot`, `quick_add` (bool), `share_scope` (day/week), `overwrote` (bool, for copy). Emitted on the **success path** too so rates are measurable (below the `TELEMETRY_FLOOR_MS` floor these are counts, not timings).
- **Failure events** (`reportError`): every store action's `catch` classifies + logs — `severity: 'error'` for a caught-and-handled CRDT/persist failure (firehose + a Heritage-Orange toast with recovery text), reserving `severity: 'critical'` for the one data-at-risk path: a **copy-week overwrite that fails partway** (`context.action: 'week-copy-failed'`, `from`/`to` week + counts) — a user action that could have discarded the target week. No bare `catch {}`; the drag/drop and picker paths both route errors here.
- **Decision events**: the recipe-delete-with-references branch logs `surface: 'meal-planner'`, `action: 'recipe-deref'` with the count of nullified meals (so the "recipe removed" state is explainable from logs).
- **Perf**: `perfTiming.record('meal-week-load', ms, { family_id })` on `loadMealPlans` for a real corpus; the board render is bounded (one week) so no extra read-path instrumentation.
- **Privacy/store gate**: the new context keys (`action`, `kind`, `slot`, `quick_add`, `share_scope`, `overwrote`) must be added to `ALLOWED_CONTEXT_KEYS` in `logEvent.ts` AND declared in `docs/runbooks/native-store-submission.md` + the store Data-Safety/App-Privacy answers + `PrivacyInfo.xcprivacy` + `privacy.astro`. **No** recipe names, meal notes, guest names, or member names are ever logged (they are content/PII) — only enum/boolean/count fields.

## Acceptance Criteria

- [ ] Meal-planner page exists under Treehouse/planning at `/meal-planner`, lazy-loaded, nav item + hint registered (navigation unit test passes).
- [ ] Week-first days-across board on desktop/tablet; vertical day-stack on mobile; fixed B/L/D + any number of snacks.
- [ ] A meal can be a cookbook recipe OR a type (`eat_out`/`leftovers`/`skip`/`other`); recipe meals name-only quick-add when new.
- [ ] Desktop drag from the rail places a meal; **every** drag action has a working tap/keyboard equivalent (picker sheet).
- [ ] Recipe meals show the recipe photo when present and an emoji-tile fallback when not (never blank).
- [ ] Meal name is prominent; cook is shown on the card; who's-eating supports family members **and** ad-hoc external guests.
- [ ] Per-meal one-off note + optional serve-time captured; serve-time shows on the card + briefing (no OS reminder).
- [ ] Mark cooked opens `CookLogFormModal` (rating required) and records a `cookLogs` entry against the recipe; the meal flips to cooked only when the cook-log actually persisted.
- [ ] A cook assignment appears in the assignee's daily briefing (via the new `'meal'` kind — built in `useCriticalItems`, routed in `FamilyStatusToast` → `MealEditModal`), shown only while **uncooked** and as **tap-to-open** (no inline checkbox); no `deriveNotifications`/OS-reminder change.
- [ ] Today's meals visible on the nook.
- [ ] Share supports both a single-day and a whole-week plain-text share via the existing channels.
- [ ] Copy an entire week into the current/upcoming week with an overwrite **warning** (Heritage Orange) when the target has meals; cook-log history preserved; recipes referenced not cloned.
- [ ] Past weeks browsable; any past week offers "copy to current/upcoming week".
- [ ] Deleting a referenced recipe warns + confirms, then nullifies the meal links ("recipe removed"); cook logs unaffected.
- [ ] All strings in `uiStrings.ts` (`en` + `beanie`); no bare strings; `npm run translate` run + zh spot-checked.
- [ ] Help Center article `planning-your-familys-meals` added and matches shipped behavior.
- [ ] Diagnostic logging in **Observability Coverage** implemented and verified; new context keys allowlisted + store-declared.

## Testing Plan

1. **Unit — `mealPlanStore`**: create/update/delete a meal; `mealsForWeek`/`todaysMeals` selectors; `copyWeek` shifts dates, resets cooked, references (does not clone) recipes, and overwrites via `replaceWeek`; copy preserves `cookLogs`. Use `resetAllMocks()` in `beforeEach` if `mockImplementationOnce` is used. Mock `useToday` (module singleton) for date-dependent selectors.
2. **Unit — `mealWeek`/`calendarWeek`**: `weekStartFor`, `weekDates`, week shifting across month/DST boundaries.
3. **Unit — `useCriticalItems`** (extend): a today, **uncooked** recipe meal with a `cookMemberId` produces a `'meal'` critical item for the cook and not for others (audience); an **already-cooked** meal produces NO briefing item (filtered like completed todos); the emitted item is **non-completable** (`completable: false`); type meals and `cookMemberId`-less meals produce none.
4. **Component — `FamilyStatusToast`**: a `'meal'` item routes to `open-meal`, NOT `open-activity` (guards the `else`-branch mis-route).
5. **Unit — recipe-delete guard**: deleting a recipe referenced by a meal nullifies the link and leaves `cookLogs` intact.
6. **E2E (`meal-planner.spec.ts`, Chromium)** — ONE critical journey per ADR-007 (budget-aware; consolidate, assert on IndexedDB export not DOM): plan a dinner from an existing recipe → assign a cook → mark cooked → assert a `mealPlans` entry + a `cookLogs` entry exist. (Drag-drop is exercised via the tap path in E2E to avoid `waitForTimeout`; DnD is unit/manual-tested.)
7. **Manual**: desktop drag-drop + reduced-motion; mobile day-stack + picker + name-only quick-add; guest add; copy-week overwrite warning; day/week share text in WhatsApp; nook card; briefing shows the assignment and tapping it opens the meal (not an activity).

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the full plan from the approved mockup + pre-plan prompt — new `mealPlans` entity mirroring lists/recipes, the week board + rail + picker + editor, meal types, who's-eating+guests, mark-cooked→cook-log, the two-place `'meal'` briefing kind, nook card, generalized share, copy-week with overwrite guard, nav/i18n, Help + Observability coverage.
- **Pass 2 (DRY + error handling)**: Removed the false "two-place rule" (meal briefing lives in `useCriticalItems` only, like `medication` — dropped `deriveNotifications`/`notificationKinds`/`types/notifications`/`audience.ts` edits); replaced the new week helper + hardcoded-Monday with reuse of `useWeekNavigation` (`settingsStore.weekStartDay`) + `calendarWeek.relativeWeekLabelKey`, leaving only a `shiftWeekEntries` fn; killed the `ShareChannelGrid` generalization in favour of a new `useShareText` (Web Share API + checked `useClipboard` fallback); corrected the non-existent cookbook-search "extraction" to a new shared `useRecipeSearch`; named `photoStore.getPublicUrl(…,'thumb')` (null→emoji) for `MealThumb`; added null-guards on `createCookLog` mark-cooked; made recipe-delete deref one atomic repo batch + store reconciliation + `countMealsForRecipe`.
- **Pass 3 (Sustainability)**: Renamed meal `prepTime`→`serveTime` (collided with `Recipe.prepTime` = prep duration — a same-domain wrong-field trap); fixed the stale Acceptance-Criteria line still claiming "both useCriticalItems and deriveNotifications"; added a shared `MealSlotCell`/`useMealSlots` seam so the desktop board and mobile day-stack can't drift; specified the `position` insert/no-reindex rule; and fenced `MealEditModal` to `MealPlanEntry`-only fields (no recipe/cook-log editing). Core store/repo/atomic-batch/week-reuse decisions confirmed sound.
- **Pass 4 (Fresh-eyes sweep)**: Fixed one material briefing-integration bug — the new `'meal'` `CriticalItem` must be **non-completable + filtered-when-cooked** and needs consumer routing (`FamilyStatusToast` `open-meal` case + `FamilyNookPage` `@open-meal` → the shared `MealEditModal`), otherwise it silently mis-routes to the activity modal and its checkbox is dead; corrected §E, Assumption 3, the Acceptance Criteria + Files Affected, and added a `FamilyStatusToast` routing component test. All other reuse/atomicity/DRY claims verified accurate against the codebase.

## Prompt Log

> No GitHub issue created — this plan is approved for direct implementation. Full intake history lives on Notion tracker #27; the assembled hand-off prompt is reproduced below.

<details>
<summary>Assembled pre-plan prompt (from Notion #27, 2026-08-18)</summary>

(See the `=== BEANIES PRE-PLAN ===` block passed to `/beanies-plan` — captured verbatim on tracker #27's `beanies-plan prompt` property. Key resolved decisions: week-first days-across board; desktop recipe rail + drag-drop with tap/keyboard fallback; meal = recipe or type (eat out/leftovers/skip/other); name-only quick-add; recipe-photo thumbnail with emoji fallback; cook shown on card; who's-eating incl. external guests; one-off note + display-only prep-time; mark-cooked via existing cook-log form; briefing-only cook assignment; nook today's-meals card; day/week share; copy-entire-week with overwrite-warning from previous or any past week; unbounded history; ships ungated; no GitHub issue.)

</details>
