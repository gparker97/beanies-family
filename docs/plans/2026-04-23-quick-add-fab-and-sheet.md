# Plan: Quick-add FAB + bottom sheet

> Date: 2026-04-23 (plan) · 2026-04-23 (FAB asset authored + approved) · 2026-04-23 (DRY + error-handling rev)
> Related issues: #37
> Mockup: `docs/mockups/quick-add-fab.html` (variant 06)
> FAB asset: `public/brand/beanies_plus_sign.svg` (~6.7 KB, shipped)

## Context

The app has grown from 5 addable entities at the time #37 was filed (Feb 2026) to **18 today** spanning family planning, money, care, and cooking. Users currently have to navigate to each domain page before opening its add modal. This plan delivers a single peek-a-boo-beanie FAB that opens a grouped bottom sheet, with a central config driving every entity. Design direction locked via the mockup exploration on 2026-04-23.

## Decisions locked (from today's design session)

1. **Mobile form factor:** variant 03 — floating FAB sits above `MobileBottomNav` via safe-area math. No restructure of the nav.
2. **Sub-entity context pre-fill:** when the user is already on the parent's detail page (bean, recipe, trip, medication), the add modal skips the picker and pre-fills the parent ID.
3. **Scope:** all 18 entities wired end-to-end. Deferred: draggable FAB, Settings-level top-6 customization.

## Reuse matrix — existing primitives we consume

**Goal: zero duplication of modal chrome, toast surfaces, query consumption, exhaustiveness guards, or scroll/focus handling. Everything below already exists and must be reused rather than reinvented.**

| What we need                                                | Reuse                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Modal chrome (backdrop, focus trap, Esc, body-scroll)       | `src/components/ui/BaseModal.vue` — sheet is `<BaseModal>` body-slot content with scoped positioning CSS. No new variant; no new prop.                                                                                                                           |
| Global singleton pattern (module state + composable)        | Mirror `src/composables/useConfirm.ts` exactly — module-level `state` ref, public `open()` / `close()` functions, composable returning reactive state.                                                                                                           |
| User-facing error surface (sticky toasts + action undo)     | `src/composables/useToast.ts` — `showToast('error', title, message)`; `actionFn` handlers already re-surface thrown errors as a new toast + `console.error`.                                                                                                     |
| Compile-time + runtime exhaustiveness on action dispatch    | `src/utils/assertNever.ts` — `default: assertNever(action, 'useQuickAddIntent')` in every switch over `QuickAddAction`.                                                                                                                                          |
| Async wrapper with error toast + loading state              | `src/composables/useStoreActions.ts` → `wrapAsync(isLoading, error, fn, { errorToast })` — used inside stores. Our intent dispatch is synchronous so this is only relevant if a handler awaits async work.                                                       |
| Overlay stack (ref-counted scroll lock + `hasOpenOverlays`) | `src/utils/overlayStack.ts` — already consumed by BaseModal. We don't need to touch it; natural z-index stacking handles FAB-below-modal visually.                                                                                                               |
| Query-string intent consumption (read + clear)              | `src/composables/useAutoOpenOnQuery.ts` — **already exists for the Bean-tab `?add=1` flow.** We **extend** this composable rather than adding a second one. See "Composable consolidation" below.                                                                |
| Member / author resolution                                  | `src/composables/useAuthoringMember.ts` — `resolveOrToast()` already emits a toast + console.error on missing author. Reuse if any action handler needs the acting member.                                                                                       |
| Translation system                                          | `src/services/translation/uiStrings.ts` + `useTranslation()` — nested key format confirmed parser-safe (`scripts/updateTranslations.mjs` uses line-level key detection).                                                                                         |
| Route meta pattern                                          | `src/router/index.ts` already uses `requiresAuth`, `requiresFinance`, `titleKey`. Add `hideQuickAdd?: boolean` alongside — consistent with existing shape.                                                                                                       |
| Emoji constants                                             | `src/constants/navigation.ts` uses **Unicode escapes** (`'\u{1F3E1}'`, `'✈️'`). Our `quickAddItems.ts` must match this convention — no raw emoji characters.                                                                                                     |
| Brand SVG mounting                                          | Inline `<symbol id="beanie-plus-fab">` once in `App.vue`, reference via `<svg><use href="#beanie-plus-fab" /></svg>`. **No build-time SVG loader** — `vite-svg-loader` is not installed and does not need to be. CSS vars cascade through inline SVGs naturally. |

### Composable consolidation — `useAutoOpenOnQuery` → `useQuickAddIntent`

`src/composables/useAutoOpenOnQuery.ts` today handles the simpler `?add=1` → flip a ref case (~30 lines, immediate + watch, clears flag, used only by Bean tabs). Our new need adds (a) an action name (`?action=<name>`), (b) a context id (`?memberId=`, `?recipeId=`, etc.), and (c) a typed delegated handler.

**Plan:** replace `useAutoOpenOnQuery` with a single, more capable `useQuickAddIntent` that covers both cases. Existing Bean-tab callers migrate to the new API with a 1-line change. Keeping two composables would duplicate the query-read-and-clear logic — violates DRY.

Migration plan:

- **New:** `src/composables/useQuickAddIntent.ts` — typed handler, action + context extraction, query clearing.
- **Delete:** `src/composables/useAutoOpenOnQuery.ts` after callers migrate.
- **Migrate:** `BeanSayingsTab`, `BeanFavoritesTab`, `BeanNotesTab`, `BeanMedicationsTab`, `BeanAllergiesTab` (grep for all `useAutoOpenOnQuery` call sites and update each — ~5-6 sites per the Bean-tab family).
- **Test:** new composable's unit tests cover both the legacy `?add=1` path (via `action: 'add'`) and the new `?action=<name>&memberId=<id>` path.

This is a net reduction in code (one composable instead of two) and keeps the intent-passing DRY.

## Sustainability & code-organization principles

Principles that future contributors can check their work against. These aren't theoretical — each one maps to a specific risk we're avoiding.

1. **Config is the single source of truth.** `QUICK_ADD_ITEMS` drives everything: the sheet layout, the dispatch table, the `QuickAddAction` union type, the unit-test invariants. The `QuickAddAction` type is **derived** from the config (`typeof QUICK_ADD_ITEMS[number]['action']`), not declared separately — so adding an action in exactly one place propagates everywhere. No possibility of config/type drift.
2. **Boundary validation, not scattered validation.** The composable boundary (`useQuickAddIntent`) validates actions against `QUICK_ADD_ITEMS` once; page handlers receive only valid actions and can use a lean switch with `default: break`. We don't ask every page to guard against stale input.
3. **One function per concern.** No function interleaves "parse the URL", "build the query", "dispatch the handler", "toast on error". Each is named, tested, and ≤20 lines. Long/nested code blocks fail review.
4. **Colocate state with its owner.** Page modal state stays on the page. Handlers set `showAddModal.value = true` — they don't reach into stores or modify shared state. The composable doesn't own modal state.
5. **Modal pre-fill via a stable prop convention.** Every modal that accepts a pre-filled parent id uses the prop name `initial<Entity>Id` (e.g. `initialMemberId`, `initialRecipeId`, `initialVacationId`). See "Modal pre-fill prop convention" below. Page handlers pass these from route params — they don't reach into modal internals.
6. **Handler coverage is enforced by a unit test**, not by manual review. `quickAddCoverage.test.ts` asserts that every `action` in the config is handled by at least one page under its `route`. Adding an action without a handler fails CI.
7. **Deep nesting is a smell.** Max 2 levels of nesting inside any function. Handler cases that need complex branching (e.g., `add-idea` → empty-state guard → picker-first fallback) extract a named helper function, not more `if` blocks.
8. **Extract-on-second-use, not on-first.** Everything has a threshold for generalization:
   - A second bottom-sheet case → promote to `BaseModal placement="bottom-sheet"` prop
   - A second inline `<symbol>` in `App.vue` → extract to `<BeanieSprites>` component
   - A second "couldn't open modal" error pattern → extract to a shared `useIntentError` helper
     Until then, inline and keep it readable.

## Error-handling contract

**Principle:** every failure mode has an explicit branch; no try/catch is silent; every toast carries a translation key (no raw strings in handler code).

Three distinct error surfaces. Everything else is a UX branch, not an error.

| Error                                 | Where it's caught                                                             | What the user sees                                        | What the dev sees                                                              |
| ------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Unknown action string**             | `useQuickAddIntent` (validates against `VALID_ACTIONS` set built from config) | `quickAdd.error.unknown.*` toast + query stripped         | `console.error('[useQuickAddIntent] unknown action: "<value>"')`               |
| **Page handler throws**               | `useQuickAddIntent` try/catch around the callback                             | `quickAdd.error.handler.*` toast + query stripped         | `console.error('[useQuickAddIntent] handler threw for action="<name>":', err)` |
| **Orphan action on hidden-FAB route** | `router.beforeEach` guard                                                     | `quickAdd.error.notHere.*` warning toast + query stripped | No error — expected from stale bookmarks                                       |

UX branches (not errors, no console):

- **Missing required context id** (e.g. `add-cooklog` with no `recipeId`): page handler falls back to picker-first mode (opens the recipe picker instead of the log modal).
- **Missing required parent entity** (e.g. `add-idea` and the user has zero trips): page handler shows an `info` toast with an action button to create the parent first (see TravelPage example below).
- **FAB tapped while a modal is already open:** `openQuickAdd` reads `hasOpenOverlays()` and no-ops. The click is absorbed; the current modal keeps focus.
- **Reduced-motion preference:** animations gated on `@media (prefers-reduced-motion: no-preference)` (fail-safe default = no motion). Stagger collapses to 10 ms; bob stops.

Invariants enforced by tests, not runtime checks:

- **Translation key missing:** `useTranslation()` already logs a console warning. `npm run translate` fails CI on merge if keys are missing. Don't write runtime guards.
- **Route missing `meta.hideQuickAdd`:** default is "show FAB", which is acceptable — new routes default to visible. If a route needed to hide the FAB and was missed, fix the router entry. Stateless surface; no bad state possible.
- **Sprite `<symbol>` missing from DOM:** `QuickAddFab.onMounted` dev-only guard logs `console.error` if `#beanie-plus-fab` isn't found. Ship an empty circle rather than crash. Prod never hits this because the sprite lives in the root `App.vue` template.

## Approach

Four single-responsibility units plus one config array plus three pure helpers.

**Components (2):**

- **`QuickAddFab.vue`** — button mounted once in `App.vue`, visibility driven by route meta
- **`QuickAddSheet.vue`** — bottom sheet using `BaseModal` body slot + scoped positioning CSS; renders 4 groups from config

**Composables (2):**

- **`useQuickAdd.ts`** — module singleton for open/close state + dispatch; mirrors `useConfirm.ts` shape exactly
- **`useQuickAddIntent.ts`** — per-page composable (replaces `useAutoOpenOnQuery`); orchestrates the four pure helpers below inside try/catch

**Pure helpers (3) — each independently unit-tested without component harness:**

- `buildIntentQuery(item, route)` — construct the target URL's query dict (lives in `useQuickAdd.ts`; exported)
- `parseIntentFromQuery(query)` — extract `{ action, context }` or `null` (lives in `useQuickAddIntent.ts`; exported)
- `stripIntentKeys(query)` — return a query dict with intent keys removed (lives in `useQuickAddIntent.ts`; exported)

**Config (1):**

- **`quickAddItems.ts`** — typed config array; `QuickAddAction` union and `VALID_ACTIONS` set are DERIVED from the array

**Intent flow:**

1. User taps sheet item → `useQuickAdd.triggerAction(item)` closes the sheet, calls `buildIntentQuery`, navigates (replace on same-route, push on cross-route).
2. Target page mounts, its `useQuickAddIntent(handler)` calls `parseIntentFromQuery`, `stripIntentKeys`+`router.replace` (clear first to prevent re-entry), validates action against `VALID_ACTIONS`, then dispatches the handler inside try/catch.
3. Handler is a flat switch that sets the page's modal ref to `true`; complex cases (empty-state, context-aware) extract named helper functions.

Query-param approach — deep-linkable, history-clean, debuggable.

## Mockup → CIG reconciliation

The mockup was rendered with some sub-theme values (10–11px label text, Fraunces italic on section sub-labels). The theme skill wins:

| Mockup                                                               | Implementation                                                                                                   | Why                                                            |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 10px kicker, 10px section title, 11px subhint, 11px label, 10px hint | All → `text-xs` (12px)                                                                                           | Theme minimum is 12px; standard Tailwind classes only          |
| Fraunces italic "setup" / "what you add most"                        | Inter italic (`italic` class on body text)                                                                       | Theme uses Outfit + Inter; Fraunces is guide-scoped per status |
| Custom letter-spacing `0.14em` on section titles                     | `tracking-wider` (0.05em) or Tailwind's `tracking-[0.08em]` via CSS, per theme rule for UI labels                | Theme spec: "UI labels … tracking 0.08em"                      |
| Hand-tuned radii (28/22/20/16 px)                                    | Tailwind scale: `rounded-3xl` (sheet), `rounded-2xl` (Everyday card), `rounded-xl` (items), `rounded-full` (FAB) | Squircle convention, standard scale                            |
| Custom hex tints                                                     | `var(--tint-orange-8)` / `var(--tint-orange-15)`                                                                 | Already defined in theme                                       |
| Inline `#F15D22` etc.                                                | `bg-orange-500` or Heritage Orange CSS vars                                                                      | Theme-defined colors only                                      |

Everything else in the mockup matches the theme directly.

## File changes

### Create (5)

| File                                      | Purpose                                                                                 |
| ----------------------------------------- | --------------------------------------------------------------------------------------- |
| `src/components/common/QuickAddFab.vue`   | FAB button; idle-bob animation; opens the sheet via `useQuickAdd.open()`                |
| `src/components/common/QuickAddSheet.vue` | Bottom sheet wrapped in `BaseModal`; renders 4 groups from config                       |
| `src/composables/useQuickAdd.ts`          | Module singleton: `isOpen`, `open()`, `close()`, `toggle()`, `triggerAction(item)`      |
| `src/composables/useQuickAddIntent.ts`    | Per-page intent consumer; replaces `useAutoOpenOnQuery` with a richer handler signature |
| `src/constants/quickAddItems.ts`          | Typed config array; drives sheet rendering + action dispatch                            |

### Modify

| File                                       | Change                                                                                                                                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/App.vue`                              | Mount `<QuickAddFab />` + `<QuickAddSheet />` once after `<router-view>`; inline `<svg aria-hidden hidden><symbol id="beanie-plus-fab">…</symbol></svg>` sprite (copied from `public/brand/beanies_plus_sign.svg`) |
| `src/router/index.ts`                      | Add `meta.hideQuickAdd: true` to `/settings`, `/login`, `/setup`, 404 route; add beforeEach guard that strips orphaned `?action=` from any `hideQuickAdd` route + shows warning toast                              |
| `src/services/translation/uiStrings.ts`    | Add `quickAdd.*` namespace (~28 keys — 22 labels/hints + 6 error-message keys; en + beanie for each)                                                                                                               |
| Per-page intent handlers (see table below) | One `useQuickAddIntent(handler)` call per page                                                                                                                                                                     |

### Delete (DRY consolidation)

| File                                    | Reason                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------- |
| `src/composables/useAutoOpenOnQuery.ts` | Superseded by `useQuickAddIntent` which handles the `?add=1` case as a special action |

Bean-tab callers update from:

```ts
useAutoOpenOnQuery(showAddModal); // old
```

to:

```ts
useQuickAddIntent((action) => {
  if (action === 'add') showAddModal.value = true;
});
```

### Per-page intent consumers

Each page adds **one** `useQuickAddIntent((action, context) => { ... })` call. Handlers are ~3–6 lines each — just set the existing modal ref(s) true. Pre-fill is handled by the modal (via an `initialX` prop); context comes from the composable.

| Page                                                                                                                   | Handler switches on                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/pages/AccountsPage.vue`                                                                                           | `add`                                                                                                                                                 |
| `src/pages/TransactionsPage.vue`                                                                                       | `add` · `add-recurring` (switches to recurring tab before opening)                                                                                    |
| `src/pages/AssetsPage.vue`                                                                                             | `add`                                                                                                                                                 |
| `src/pages/GoalsPage.vue`                                                                                              | `add`                                                                                                                                                 |
| `src/pages/BudgetsPage.vue`                                                                                            | `add` (open `BudgetSettingsModal` in create mode — verify prop exists, add if not)                                                                    |
| `src/pages/FamilyPlannerPage.vue` (`/activities`)                                                                      | `add`                                                                                                                                                 |
| `src/pages/FamilyTodoPage.vue`                                                                                         | `add`                                                                                                                                                 |
| `src/pages/TravelPage.vue`                                                                                             | `add` · `add-idea` (requires a trip — falls back to trip-picker-first if no `vacationId`; shows info toast if no trips exist yet)                     |
| `src/pages/FamilyScrapbookPage.vue` (`/pod/scrapbook`)                                                                 | `add-saying` · `add-favorite` · `add-note` — bean-picker-first                                                                                        |
| `src/pages/FamilyCookbookPage.vue` (`/pod/cookbook`)                                                                   | `add-recipe` · `add-cooklog` (recipe-picker-first when no `recipeId`)                                                                                 |
| `src/pages/RecipeDetailPage.vue`                                                                                       | `add-cooklog` pre-filled with `route.params.recipeId`                                                                                                 |
| `src/pages/CareSafetyPage.vue` (`/pod/safety`)                                                                         | `add-medication` · `add-allergy` · `add-dose-log` — bean-picker-first                                                                                 |
| `src/pages/EmergencyContactsPage.vue` (`/pod/contacts`)                                                                | `add`                                                                                                                                                 |
| Bean-detail child tabs: `BeanSayingsTab`, `BeanFavoritesTab`, `BeanNotesTab`, `BeanAllergiesTab`, `BeanMedicationsTab` | `add` (or tab-specific: `add-saying` for BeanSayingsTab etc.) — member comes from `route.params.memberId`; replace existing `useAutoOpenOnQuery` call |

## Config array schema

```ts
// src/constants/quickAddItems.ts
import type { UIStringKey } from '@/services/translation/uiStrings';

export type QuickAddGroup = 'everyday' | 'family' | 'money' | 'care';

/** Parent id key pre-filled into the target modal when the user is on the parent's detail route. */
export type QuickAddContextKey = 'memberId' | 'recipeId' | 'vacationId' | 'medicationId';

// Item shape used during declaration. `action` is a free `string` here so TS
// can infer literal types from the `as const` below; the real `QuickAddAction`
// union is DERIVED from the items (see below) — single source of truth.
interface QuickAddItemShape {
  readonly id: string; // unique, kebab-case
  readonly group: QuickAddGroup;
  readonly order: number; // display order within group
  readonly emoji: string; // Unicode-escape form, matches navigation.ts
  readonly labelKey: UIStringKey;
  readonly hintKey: UIStringKey;
  readonly route: string; // target path
  readonly action: string; // ?action=<value>
  readonly tab?: string; // optional tab within target page
  readonly contextKey?: QuickAddContextKey; // parent id pre-filled when available
}

export const QUICK_ADD_ITEMS = [
  // — Everyday (jar-pop) —
  {
    id: 'activity',
    group: 'everyday',
    order: 1,
    emoji: '\u{1F4C5}',
    labelKey: 'quickAdd.activity.label',
    hintKey: 'quickAdd.activity.hint',
    route: '/activities',
    action: 'add',
  },
  {
    id: 'todo',
    group: 'everyday',
    order: 2,
    emoji: '✅',
    labelKey: 'quickAdd.todo.label',
    hintKey: 'quickAdd.todo.hint',
    route: '/todo',
    action: 'add',
  },
  {
    id: 'transaction',
    group: 'everyday',
    order: 3,
    emoji: '\u{1F4B3}',
    labelKey: 'quickAdd.transaction.label',
    hintKey: 'quickAdd.transaction.hint',
    route: '/transactions',
    action: 'add',
  },
  {
    id: 'trip',
    group: 'everyday',
    order: 4,
    emoji: '✈️',
    labelKey: 'quickAdd.trip.label',
    hintKey: 'quickAdd.trip.hint',
    route: '/travel',
    action: 'add',
  },
  {
    id: 'cook-log',
    group: 'everyday',
    order: 5,
    emoji: '\u{1F468}‍\u{1F373}',
    labelKey: 'quickAdd.cookLog.label',
    hintKey: 'quickAdd.cookLog.hint',
    route: '/pod/cookbook',
    action: 'add-cooklog',
    contextKey: 'recipeId',
  },
  {
    id: 'saying',
    group: 'everyday',
    order: 6,
    emoji: '\u{1F4AC}',
    labelKey: 'quickAdd.saying.label',
    hintKey: 'quickAdd.saying.hint',
    route: '/pod/scrapbook',
    action: 'add-saying',
    contextKey: 'memberId',
  },

  // — Family —
  {
    id: 'favorite',
    group: 'family',
    order: 1,
    emoji: '\u{1F49D}',
    labelKey: 'quickAdd.favorite.label',
    hintKey: 'quickAdd.favorite.hint',
    route: '/pod/scrapbook',
    action: 'add-favorite',
    contextKey: 'memberId',
  },
  {
    id: 'note',
    group: 'family',
    order: 2,
    emoji: '\u{1F4DD}',
    labelKey: 'quickAdd.note.label',
    hintKey: 'quickAdd.note.hint',
    route: '/pod/scrapbook',
    action: 'add-note',
    contextKey: 'memberId',
  },
  {
    id: 'recipe',
    group: 'family',
    order: 3,
    emoji: '\u{1F35C}',
    labelKey: 'quickAdd.recipe.label',
    hintKey: 'quickAdd.recipe.hint',
    route: '/pod/cookbook',
    action: 'add-recipe',
  },
  {
    id: 'trip-idea',
    group: 'family',
    order: 4,
    emoji: '\u{1F4A1}',
    labelKey: 'quickAdd.tripIdea.label',
    hintKey: 'quickAdd.tripIdea.hint',
    route: '/travel',
    action: 'add-idea',
    contextKey: 'vacationId',
  },

  // — Money (setup) —
  {
    id: 'account',
    group: 'money',
    order: 1,
    emoji: '\u{1F4B0}',
    labelKey: 'quickAdd.account.label',
    hintKey: 'quickAdd.account.hint',
    route: '/accounts',
    action: 'add',
  },
  {
    id: 'budget',
    group: 'money',
    order: 2,
    emoji: '\u{1F4CA}',
    labelKey: 'quickAdd.budget.label',
    hintKey: 'quickAdd.budget.hint',
    route: '/budgets',
    action: 'add',
  },
  {
    id: 'recurring',
    group: 'money',
    order: 3,
    emoji: '\u{1F501}',
    labelKey: 'quickAdd.recurring.label',
    hintKey: 'quickAdd.recurring.hint',
    route: '/transactions',
    action: 'add-recurring',
    tab: 'recurring',
  },
  {
    id: 'asset',
    group: 'money',
    order: 4,
    emoji: '\u{1F3E2}',
    labelKey: 'quickAdd.asset.label',
    hintKey: 'quickAdd.asset.hint',
    route: '/assets',
    action: 'add',
  },
  {
    id: 'goal',
    group: 'money',
    order: 5,
    emoji: '\u{1F3AF}',
    labelKey: 'quickAdd.goal.label',
    hintKey: 'quickAdd.goal.hint',
    route: '/goals',
    action: 'add',
  },

  // — Care —
  {
    id: 'medication',
    group: 'care',
    order: 1,
    emoji: '\u{1F48A}',
    labelKey: 'quickAdd.medication.label',
    hintKey: 'quickAdd.medication.hint',
    route: '/pod/safety',
    action: 'add-medication',
    contextKey: 'memberId',
  },
  {
    id: 'dose-log',
    group: 'care',
    order: 2,
    emoji: '⏱️',
    labelKey: 'quickAdd.doseLog.label',
    hintKey: 'quickAdd.doseLog.hint',
    route: '/pod/safety',
    action: 'add-dose-log',
    contextKey: 'medicationId',
  },
  {
    id: 'allergy',
    group: 'care',
    order: 3,
    emoji: '⚠️',
    labelKey: 'quickAdd.allergy.label',
    hintKey: 'quickAdd.allergy.hint',
    route: '/pod/safety',
    action: 'add-allergy',
    contextKey: 'memberId',
  },
  {
    id: 'emergency',
    group: 'care',
    order: 4,
    emoji: '\u{1F198}',
    labelKey: 'quickAdd.emergency.label',
    hintKey: 'quickAdd.emergency.hint',
    route: '/pod/contacts',
    action: 'add',
  },
] as const satisfies readonly QuickAddItemShape[];

// === DERIVED TYPES — single source of truth is QUICK_ADD_ITEMS ===

export type QuickAddItem = (typeof QUICK_ADD_ITEMS)[number];

/** Literal union of every action string the FAB can dispatch. */
export type QuickAddAction = QuickAddItem['action'];

/** Runtime set for boundary validation in `useQuickAddIntent`. */
export const VALID_ACTIONS: ReadonlySet<string> = new Set(QUICK_ADD_ITEMS.map((i) => i.action));

/** Pre-computed group index — sheet consumes this directly. */
export const QUICK_ADD_BY_GROUP: Record<QuickAddGroup, readonly QuickAddItem[]> = {
  everyday: QUICK_ADD_ITEMS.filter((i) => i.group === 'everyday').sort((a, b) => a.order - b.order),
  family: QUICK_ADD_ITEMS.filter((i) => i.group === 'family').sort((a, b) => a.order - b.order),
  money: QUICK_ADD_ITEMS.filter((i) => i.group === 'money').sort((a, b) => a.order - b.order),
  care: QUICK_ADD_ITEMS.filter((i) => i.group === 'care').sort((a, b) => a.order - b.order),
};
```

`as const satisfies readonly QuickAddItemShape[]` gives two guarantees in one line:

- **`as const`** → TS infers each `action` as its string literal, so `QuickAddAction` gets a proper narrow union (`'add' | 'add-recurring' | …`).
- **`satisfies QuickAddItemShape[]`** → the whole array is type-checked against the shape, so a typo in `group` (e.g. `'familyy'`) fails compile.

Adding a new action is **one place**: the array literal. The union, the runtime set, the group index, and every page handler's switch all reflect it.

Unit test `quickAddItems.test.ts` asserts:

- exactly 18 items
- unique `(group, order)` tuples
- every `labelKey`/`hintKey` resolves in `uiStrings`
- every `route` is a registered path (cross-check with router)
- every `contextKey` is one of the four allowed values
- no duplicate `id`s

## useQuickAdd — global singleton

```ts
// src/composables/useQuickAdd.ts
import { ref, computed } from 'vue';
import { useRouter, useRoute, type RouteLocationNormalizedLoaded } from 'vue-router';
import { hasOpenOverlays } from '@/utils/overlayStack';
import type { QuickAddItem } from '@/constants/quickAddItems';

// Module singleton state — mirrors useConfirm.ts
const isOpen = ref(false);

export function openQuickAdd(): void {
  if (hasOpenOverlays()) return; // absorbed; another modal has focus
  isOpen.value = true;
}

export function closeQuickAdd(): void {
  isOpen.value = false;
}

export function toggleQuickAdd(): void {
  isOpen.value ? closeQuickAdd() : openQuickAdd();
}

/**
 * Build the query dict for an item tap. Pure function of (item, current
 * route) — pulls any matching context id from the current route's
 * params (sub-entity pre-fill when on the parent detail page).
 */
export function buildIntentQuery(
  item: QuickAddItem,
  route: RouteLocationNormalizedLoaded
): Record<string, string> {
  const query: Record<string, string> = { action: item.action };
  if (item.tab) query.tab = item.tab;
  if (item.contextKey) {
    const v = route.params[item.contextKey];
    if (typeof v === 'string' && v) query[item.contextKey] = v;
  }
  return query;
}

/**
 * Close the sheet and navigate to the target. Same-route taps replace
 * (no history churn); cross-route taps push (browser back returns to origin).
 */
export function triggerQuickAddAction(item: QuickAddItem): void {
  closeQuickAdd();
  const router = useRouter();
  const route = useRoute();
  const query = buildIntentQuery(item, route);
  const sameRoute = route.path === item.route;
  void (sameRoute ? router.replace : router.push)({ path: item.route, query });
}

export function useQuickAdd() {
  return {
    isOpen: computed(() => isOpen.value),
    open: openQuickAdd,
    close: closeQuickAdd,
    toggle: toggleQuickAdd,
    triggerAction: triggerQuickAddAction,
  };
}
```

`buildIntentQuery` is exported and independently unit-tested — no need to mount a router to verify the context-pre-fill logic.

## useQuickAddIntent — per-page consumer (replaces `useAutoOpenOnQuery`)

```ts
// src/composables/useQuickAddIntent.ts
import { onMounted, watch } from 'vue';
import { useRoute, useRouter, type LocationQuery } from 'vue-router';
import { showToast } from '@/composables/useToast';
import { useTranslation } from '@/composables/useTranslation';
import {
  VALID_ACTIONS,
  type QuickAddAction,
  type QuickAddContextKey,
} from '@/constants/quickAddItems';

const CONTEXT_KEYS: readonly QuickAddContextKey[] = [
  'memberId',
  'recipeId',
  'vacationId',
  'medicationId',
];

export type QuickAddIntentContext = Partial<Record<QuickAddContextKey, string>>;
export type QuickAddIntentHandler = (
  action: QuickAddAction,
  context: QuickAddIntentContext
) => void | Promise<void>;

// --- Small pure helpers — each independently unit-testable ---

/** Extract action + context from a query dict. Returns null if no action. */
export function parseIntentFromQuery(
  query: LocationQuery
): { action: string; context: QuickAddIntentContext } | null {
  const action = query.action;
  if (typeof action !== 'string' || !action) return null;
  const context: QuickAddIntentContext = {};
  for (const key of CONTEXT_KEYS) {
    const v = query[key];
    if (typeof v === 'string' && v) context[key] = v;
  }
  return { action, context };
}

/** Return a new query dict with the action + context keys removed. */
export function stripIntentKeys(query: LocationQuery): LocationQuery {
  const {
    action: _a,
    memberId: _m,
    recipeId: _r,
    vacationId: _v,
    medicationId: _md,
    ...rest
  } = query;
  return rest;
}

/**
 * Per-page consumer of `?action=<name>` intents (+ optional context ids).
 *
 * Strips the consumed query keys BEFORE running the handler (prevents
 * re-entry on handler error). Unknown actions are blocked at the boundary
 * against VALID_ACTIONS (built from the config) — page handlers receive
 * only validated `QuickAddAction` values. Handler exceptions land in a
 * toast + console.error — never silent. Replaces `useAutoOpenOnQuery`.
 */
export function useQuickAddIntent(handler: QuickAddIntentHandler): void {
  const route = useRoute();
  const router = useRouter();
  const { t } = useTranslation();

  async function consume(): Promise<void> {
    const intent = parseIntentFromQuery(route.query);
    if (!intent) return;

    // Strip first so handler errors don't re-trigger on the next watch tick.
    await router.replace({ query: stripIntentKeys(route.query) });

    if (!VALID_ACTIONS.has(intent.action)) {
      console.error(`[useQuickAddIntent] unknown action: "${intent.action}"`);
      showToast('error', t('quickAdd.error.unknown.title'), t('quickAdd.error.unknown.message'));
      return;
    }

    try {
      await handler(intent.action as QuickAddAction, intent.context);
    } catch (err) {
      console.error(`[useQuickAddIntent] handler threw for action="${intent.action}":`, err);
      showToast(
        'error',
        t('quickAdd.error.handler.title'),
        err instanceof Error ? err.message : t('quickAdd.error.handler.message')
      );
    }
  }

  onMounted(() => {
    void consume();
  });
  watch(
    () => route.query.action,
    () => {
      void consume();
    }
  );
}
```

`parseIntentFromQuery` and `stripIntentKeys` are pure, exported, and unit-tested in isolation — no component harness required. The composable itself is a 4-step orchestrator: parse → strip → validate → dispatch.

### Example page handlers

```ts
// AccountsPage.vue
import { assertNever } from '@/utils/assertNever';
useQuickAddIntent((action) => {
  switch (action) {
    case 'add':
      showAddModal.value = true;
      break;
    default:
      // All other actions belong to other pages — ignore silently since
      // the router strips orphaned actions on entry to hideQuickAdd routes
      // and the dispatch table below is intentionally partial.
      break;
  }
});

// TransactionsPage.vue
useQuickAddIntent((action) => {
  switch (action) {
    case 'add':
      showAddModal.value = true;
      break;
    case 'add-recurring':
      activeTab.value = 'recurring';
      showRecurringModal.value = true;
      break;
    default:
      break;
  }
});

// TravelPage.vue — handler is a flat switch; complex cases extract helpers
function handleAddIdea(vacationId: string | undefined): void {
  if (vacationId) return openIdeaModal({ initialVacationId: vacationId });
  if (vacationsStore.vacations.length === 0) return promptAddTripFirst();
  showIdeaPickerFirst.value = true;
}

function promptAddTripFirst(): void {
  showToast('info', t('quickAdd.tripIdea.noTripsTitle'), t('quickAdd.tripIdea.noTripsMessage'), {
    actionLabel: t('quickAdd.tripIdea.addTripAction'),
    actionFn: () => {
      showAddTripModal.value = true;
    },
  });
}

useQuickAddIntent((action, { vacationId }) => {
  switch (action) {
    case 'add':
      showAddTripModal.value = true;
      break;
    case 'add-idea':
      handleAddIdea(vacationId);
      break;
    default:
      break;
  }
});

// BeanSayingsTab.vue (replaces old useAutoOpenOnQuery call)
useQuickAddIntent((action) => {
  if (action === 'add' || action === 'add-saying') showAddModal.value = true;
});
```

Pages ignore non-matching actions rather than treating them as errors — the typed union + `VALID_ACTIONS` boundary guard lives at the composable (where the set of actions is fixed), not on every page (where each page only cares about its subset).

## Modal pre-fill prop convention

Pre-fill is the primary coupling point between the FAB and the rest of the app. To avoid drift and shotgun surgery later, we lock a single convention:

**Every modal that accepts a pre-filled parent id uses the prop name `initial<Entity>Id`:**

| Entity        | Prop name             | Type                |
| ------------- | --------------------- | ------------------- |
| Family member | `initialMemberId`     | `UUID \| undefined` |
| Recipe        | `initialRecipeId`     | `UUID \| undefined` |
| Vacation/trip | `initialVacationId`   | `UUID \| undefined` |
| Medication    | `initialMedicationId` | `UUID \| undefined` |
| Account       | `initialAccountId`    | `UUID \| undefined` |

**Rules:**

- Props are `optional` and `undefined` by default — passing `undefined` is indistinguishable from not passing at all (no picker-hiding surprise).
- Modal reads the prop once on open and seeds its internal form state. Further edits to the prop after open are ignored (prevents jitter if the parent re-renders).
- If the prop is set, any picker UI inside the modal is hidden — the user gets the form directly with the parent already selected.
- If the prop is absent, the modal shows its picker (existing behavior).
- Phase 2 audits every consuming modal and adds the prop if missing. Audit checklist:

| Modal                  | Prop required                        | Status to verify                  |
| ---------------------- | ------------------------------------ | --------------------------------- |
| `SayingFormModal`      | `initialMemberId`                    | verify; add if missing            |
| `FavoriteFormModal`    | `initialMemberId`                    | verify; add if missing            |
| `NoteFormModal`        | `initialMemberId`                    | verify; add if missing            |
| `AllergyFormModal`     | `initialMemberId`                    | verify; add if missing            |
| `MedicationFormModal`  | `initialMemberId`                    | verify; add if missing            |
| `CookLogFormModal`     | `initialRecipeId`                    | verify; add if missing            |
| `DoseLogConfirmModal`  | `initialMedicationId`                | pre-fills from route param today  |
| `IdeaEditModal`        | `initialVacationId`                  | verify; add picker-first fallback |
| `TransactionFormModal` | `initialAccountId` (optional polish) | existing; no change required      |
| `BudgetSettingsModal`  | `mode: 'create'`                     | verify blank-create path works    |

No modal is required to accept pre-fill — only the ones listed here. Adding pre-fill to a new modal in the future follows the same prop naming so the FAB integration is zero-code on the FAB side.

## QuickAddSheet — layout spec

Uses `BaseModal` for backdrop + focus trap + Esc + body-scroll lock. Positioning via scoped CSS on the sheet content (no new BaseModal variant).

```
┌────────────────────────────────────────┐
│  — handle —                            │  rounded-t-3xl bg-white
│  What would you like to add?           │  text-lg Outfit weight-700
│                                        │
│  ┌──────────────────────────────────┐  │
│  │ 🫘 EVERYDAY BEANS what you add.. │  │  rounded-2xl warm-kraft-paper
│  │  📅 ✅ 💳                        │  │  tint-orange-8 → tint-orange-15 gradient
│  │  ✈️ 👨‍🍳 💬                        │  │  3×2 grid, bean-pop animation
│  └──────────────────────────────────┘  │
│                                        │
│  FAMILY                                │  text-xs uppercase tracking-[0.08em]
│  ┌──────────┐ ┌──────────┐             │  2-col grid rounded-xl items
│  │ 💝 Fav.. │ │ 📝 Note  │             │
│  └──────────┘ └──────────┘             │
│  ...                                   │
│                                        │
│  MONEY  · setup                        │  italic muted suffix
│  (5 items)                             │
│                                        │
│  CARE                                  │
│  (4 items)                             │
└────────────────────────────────────────┘
```

Desktop (≥768px): floating card `max-w-md` at `bottom: 24px; right: 24px` — same markup, media-query breakpoint swaps from full-width drawer to floating card.

Section rendering iterates `QUICK_ADD_BY_GROUP` — no custom order logic inside the component.

## FAB component

```vue
<template>
  <button
    v-if="showFab"
    ref="fabRef"
    class="fab"
    :class="{ 'fab--open': isOpen, 'fab--dark': isDark }"
    :aria-label="t('quickAdd.fab.label')"
    :aria-expanded="isOpen"
    @click="toggle"
  >
    <svg class="fab-icon" viewBox="0 0 120 120" aria-hidden="true">
      <use href="#beanie-plus-fab" />
    </svg>
  </button>
</template>
```

- `showFab = computed(() => !route.meta.hideQuickAdd)`
- `isDark` from existing theme composable (reuse whatever `ThemeToggle` consumes — do not introduce a second source of truth)
- `<symbol id="beanie-plus-fab">` inlined once in `App.vue` (not a second component file) — copy the SVG contents from `public/brand/beanies_plus_sign.svg` once
- **Dev-only guard in `onMounted`:** `if (!document.getElementById('beanie-plus-fab')) console.error('[QuickAddFab] sprite not mounted in App.vue')`
- Dark mode: parent class `.fab--dark` sets `--fab-bg: url(#bg-dark)` which cascades into the SVG circle's `fill="var(--fab-bg, url(#bg))"`
- Idle bob: CSS keyframe `@keyframes fab-peek { 0%,100% { transform:translateY(0) } 50% { transform:translateY(-3px) } }`, 2.6s ease-in-out infinite
- Open state: `transform: rotate(45deg) scale(0.96)`, spring ease
- Hover: `box-shadow: var(--shadow-fab), 0 0 0 4px var(--tint-orange-15)`
- All motion gated on `@media (prefers-reduced-motion: no-preference)` (fail-safe: static if preference unknown)

### Positioning

```css
.fab {
  position: fixed;
  z-index: 40; /* above page content, below modals (z-50+) */
  right: 16px;
  bottom: calc(env(safe-area-inset-bottom) + 92px); /* clears MobileBottomNav (~56px) + margin */
}
@media (min-width: 768px) {
  .fab {
    right: 24px;
    bottom: 24px;
  }
}
```

## FAB asset — shipped ✅

Hand-authored SVG at **`public/brand/beanies_plus_sign.svg`** (~6.7 KB). Authored during the 2026-04-23 design session through an iterative comparison against the Gemini concept PNGs that originally seeded the direction.

**Composition:** peek-a-boo beanie behind the crossbar; full hat with big orange pom-pom + wide-open eyes + hands gripping the crossbar; symmetric 18-unit plus arms. Lower face hidden. One file, two themes via `--fab-bg` CSS variable (orange `url(#bg)` default, slate `url(#bg-dark)` for dark mode).

Legacy `public/brand/beanies_plus_sign_512x512.png` (a different bean-holding-a-plus illustration) stays available — do not delete; it's referenced by existing surfaces.

## Animations — full timeline

All values match the mockup and fire only when `prefers-reduced-motion` is `no-preference`. Reduced-motion collapses stagger to 10 ms and uses instant opacity fades.

| Moment                           | Property                                          | Duration               | Ease                                     |
| -------------------------------- | ------------------------------------------------- | ---------------------- | ---------------------------------------- |
| FAB idle bob                     | translateY 0 → -3 → 0                             | 2.6 s, infinite        | ease-in-out                              |
| FAB tap → open                   | rotate(0 → 45°) scale(1 → 0.96)                   | 450 ms                 | spring cubic-bezier(0.34, 1.56, 0.64, 1) |
| Backdrop fade in                 | opacity 0 → 1                                     | 250 ms                 | ease-out                                 |
| Sheet slide up                   | translateY(100% → 0)                              | 450 ms                 | cubic-bezier(0.2, 0.8, 0.2, 1)           |
| Everyday jar-pop (per item)      | translateY(28 → 0) scale(0.35 → 1) opacity(0 → 1) | 550 ms per item        | spring                                   |
| Everyday stagger                 | each item                                         | 60 ms, first at 120 ms | —                                        |
| Family / Money / Care (per item) | translateY(10 → 0) opacity(0 → 1)                 | 350 ms per item        | ease-out                                 |
| Inter-group stagger              | 100 ms between groups                             | —                      | —                                        |

## Accessibility

- FAB is `<button type="button">` with `aria-label` (translated) and `aria-expanded` bound to `isOpen`
- Sheet inside `BaseModal` — focus trap, backdrop-click close, Esc, body scroll lock all inherited
- Every item is a `<button>`; Tab order = Everyday → Family → Money → Care
- Section titles `<h3>`; sheet dialog `aria-labelledby` wires to the main title
- Emoji `aria-hidden="true"`; `labelKey` provides accessible name

## i18n keys

28 new keys under `quickAdd.*`, all with `en` + `beanie`:

```ts
quickAdd: {
  fab: { label: { en: 'Quick add', beanie: 'quick add' } },
  title: { en: 'What would you like to add?', beanie: 'what would you like to add?' },
  groups: {
    everyday: {
      kicker: { en: '🫘 Everyday beans', beanie: '🫘 everyday beans' },
      subhint: { en: 'what you add most', beanie: 'what you add most' },
    },
    family: { title: { en: 'Family', beanie: 'family' } },
    money:  { title: { en: 'Money',  beanie: 'money'  }, setup: { en: 'setup', beanie: 'setup' } },
    care:   { title: { en: 'Care',   beanie: 'care'   } },
  },

  // — 18 entity label + hint pairs (same keys as before) —
  activity:    { label: { en: 'Activity',    beanie: 'activity'    }, hint: { en: 'calendar event',              beanie: 'calendar event'              } },
  todo:        { label: { en: 'To-do',       beanie: 'to-do'       }, hint: { en: 'task · who · when',            beanie: 'task · who · when'            } },
  transaction: { label: { en: 'Transaction', beanie: 'transaction' }, hint: { en: 'income · expense · transfer', beanie: 'income · expense · transfer' } },
  trip:        { label: { en: 'Trip',        beanie: 'trip'        }, hint: { en: 'travel plans',                 beanie: 'travel plans'                 } },
  cookLog:     { label: { en: 'Cook log',    beanie: 'cook log'    }, hint: { en: '5-star · note · photo',         beanie: '5-star · note · photo'         } },
  saying:      { label: { en: 'Saying',      beanie: 'saying'      }, hint: { en: 'quote a beanie',                beanie: 'quote a beanie'                } },
  favorite:    { label: { en: 'Favorite',    beanie: 'favorite'    }, hint: { en: 'food · game · song',            beanie: 'food · game · song'            } },
  note:        { label: { en: 'Note',        beanie: 'note'        }, hint: { en: 'per-bean journal',              beanie: 'per-bean journal'              } },
  recipe:      { label: { en: 'Recipe',      beanie: 'recipe'      }, hint: { en: 'ingredients · steps',           beanie: 'ingredients · steps'           } },
  tripIdea:    {
    label: { en: 'Trip idea', beanie: 'trip idea' },
    hint: { en: 'wishlist a destination', beanie: 'wishlist a destination' },
    noTripsTitle:   { en: 'Add a trip first',       beanie: 'add a trip first'       },
    noTripsMessage: { en: 'Trip ideas live inside a trip — create one and then come back.', beanie: 'trip ideas live inside a trip — create one and then come back.' },
    addTripAction:  { en: 'Add trip',               beanie: 'add trip'               },
  },
  account:     { label: { en: 'Account',     beanie: 'account'     }, hint: { en: 'checking · credit · loan',      beanie: 'checking · credit · loan'      } },
  budget:      { label: { en: 'Budget',      beanie: 'budget'      }, hint: { en: 'category caps · period',         beanie: 'category caps · period'         } },
  recurring:   { label: { en: 'Recurring',   beanie: 'recurring'   }, hint: { en: 'weekly · monthly · yearly',      beanie: 'weekly · monthly · yearly'      } },
  asset:       { label: { en: 'Asset',       beanie: 'asset'       }, hint: { en: 'home · vehicle · investment',   beanie: 'home · vehicle · investment'   } },
  goal:        { label: { en: 'Goal',        beanie: 'goal'        }, hint: { en: 'save · payoff · invest',         beanie: 'save · payoff · invest'         } },
  medication:  { label: { en: 'Medication',  beanie: 'medication'  }, hint: { en: 'dose · schedule',                beanie: 'dose · schedule'                } },
  doseLog:     { label: { en: 'Dose log',    beanie: 'dose log'    }, hint: { en: 'record a given dose',           beanie: 'record a given dose'           } },
  allergy:     { label: { en: 'Allergy',     beanie: 'allergy'     }, hint: { en: 'severity · response',            beanie: 'severity · response'            } },
  emergency:   { label: { en: 'Emergency contact', beanie: 'emergency contact' }, hint: { en: 'sitter · doctor · school', beanie: 'sitter · doctor · school' } },

  // — Error surfaces —
  error: {
    unknown: {
      title:   { en: "Can't do that from here", beanie: "can't do that from here" },
      message: { en: 'This add action isn\'t available any more — the app may need a reload.', beanie: 'this add action isn\'t available any more — the app may need a reload.' },
    },
    handler: {
      title:   { en: "Hmm, that didn't work",   beanie: "hmm, that didn't work" },
      message: { en: 'Something went wrong opening that form. Check the console for details.', beanie: 'something went wrong opening that form. check the console for details.' },
    },
    notHere: {
      title:   { en: 'Open this from another page', beanie: 'open this from another page' },
      message: { en: "The Quick-add menu is hidden on this page for focus. Tap the beanie once you're back on the main app.", beanie: "the quick-add menu is hidden on this page for focus. tap the beanie once you're back on the main app." },
    },
  },
}
```

After editing, run `npm run translate` and confirm `scripts/updateTranslations.mjs` parses the new `quickAdd` namespace without warnings. Translation-hash for each key is content-derived, so existing translations are untouched.

## Route visibility

Add `meta.hideQuickAdd: true` to:

- `/settings`
- `/login`
- `/setup` (onboarding)
- `*` (404 NotFoundPage)

Bean detail (`/pod/:memberId/...`) intentionally omits the flag — FAB stays visible so users can quick-add sub-entities from a bean page.

Router guard strips orphan `?action=` from routes with `hideQuickAdd: true` and fires `showToast('warning', t('quickAdd.error.notHere.title'), t('quickAdd.error.notHere.message'))` — see "Error handling contract" above. Implementation in `router.beforeEach`:

```ts
router.beforeEach((to) => {
  if (to.meta.hideQuickAdd && to.query.action) {
    const { t } = useTranslation(); // safe: Pinia installed before router
    const { action, memberId, recipeId, vacationId, medicationId, ...rest } = to.query;
    showToast('warning', t('quickAdd.error.notHere.title'), t('quickAdd.error.notHere.message'));
    return { path: to.path, query: rest, replace: true };
  }
});
```

This follows the existing pattern in `src/router/index.ts` where the `requiresFinance` guard already consumes Pinia stores inside `beforeEach` — proven-safe because Pinia is installed before the router in `main.ts`.

## Tests

### Unit (comprehensive — cheap to write, high signal)

| File                                                             | Coverage                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/common/__tests__/QuickAddFab.test.ts`            | renders when route meta allows · hidden when `meta.hideQuickAdd` · `aria-expanded` reflects `isOpen` · click calls `toggle` · `aria-label` uses translation · sprite-missing dev-guard logs console.error                                                                                      |
| `src/components/common/__tests__/QuickAddSheet.test.ts`          | renders 18 items in 4 groups in correct order · close on backdrop / Esc / item tap · calls `triggerAction` with correct item · iteration driven by `QUICK_ADD_BY_GROUP` (no hard-coded lists)                                                                                                  |
| `src/composables/__tests__/useQuickAdd.test.ts`                  | open / close / toggle transitions · `open()` no-op when `hasOpenOverlays()` true · replaces on same-route, pushes on cross-route                                                                                                                                                               |
| `src/composables/__tests__/buildIntentQuery.test.ts`             | pure-function test: item with no `contextKey` → `{ action }` · item with `contextKey` and matching route param → includes context id · item with `contextKey` but missing route param → no context id in output                                                                                |
| `src/composables/__tests__/parseIntentFromQuery.test.ts`         | empty query → null · `?action=add` → `{ action, context: {} }` · `?action=add&memberId=x` → context populated · unknown context keys ignored                                                                                                                                                   |
| `src/composables/__tests__/stripIntentKeys.test.ts`              | preserves unrelated keys (`?goal=<id>`) · removes all four context keys + action · idempotent (second call no-op)                                                                                                                                                                              |
| `src/composables/__tests__/useQuickAddIntent.test.ts`            | clears consumed keys BEFORE running handler · unknown action → error toast + console.error + no handler call · valid action → handler invoked with typed union · handler throws → error toast + console.error + query already cleared                                                          |
| `src/constants/__tests__/quickAddItems.test.ts`                  | exactly 18 items · unique `(group, order)` tuples · every `labelKey`/`hintKey` resolves · every `route` registered · every `contextKey` is a valid `QuickAddContextKey` · `VALID_ACTIONS.size === QUICK_ADD_ITEMS.length` (no duplicate actions) · derived `QuickAddAction` type snapshot test |
| `src/constants/__tests__/quickAddCoverage.test.ts`               | **Drift guard.** For every `item` in config, grep the file at its `route`'s page component for `action === '<item.action>'` or `case '<item.action>':` — fails CI if a config entry has no handler.                                                                                            |
| `src/router/__tests__/hideQuickAdd.test.ts`                      | orphan `?action=` on a `hideQuickAdd` route is stripped + warning toast fired                                                                                                                                                                                                                  |
| `src/composables/__tests__/migration.useAutoOpenOnQuery.test.ts` | one-off (delete after merge): grep every file that imported `useAutoOpenOnQuery`; confirm each now imports `useQuickAddIntent` and handles `action === 'add'`.                                                                                                                                 |

### E2E

Per ADR-007, the current budget is 33 tests (over the 25-test cap). **No new E2E tests for v1.** Unit coverage + manual smoke test covers it. Add one E2E (`fab-opens-transactions-add`) as a follow-up when the budget is reclaimed.

## Phasing

Two small, cohesive PRs.

### Phase 1 — chrome + 6 everyday entities + `useAutoOpenOnQuery` migration (est. 1 session)

- All 5 new files (FAB, Sheet, 2 composables, config) scaffolded with all 18 entries
- `useAutoOpenOnQuery` deleted; 5 Bean-tab call sites migrated to `useQuickAddIntent`
- Route meta + App.vue mount + router guard for orphan actions
- Page handlers for the 6 everyday items: Activity, To-do, Transaction, Trip, Cook log, Saying
- All 28 `quickAdd.*` i18n keys added (Phase 2 just adds handler bodies)
- FAB asset ✅ already shipped; `<symbol>` mounted in `App.vue`
- Unit tests for every new composable, component, and config invariant
- `npm run type-check` + `npm run lint` + `npm run translate` + unit suite all green

**Ships as:** working FAB where tapping an un-wired item still navigates to the correct page (no-op handler); the 6 everyday items open their modals directly. Still useful; matches current UX for un-wired entities.

### Phase 2 — picker-first flow + remaining 6 page handlers (est. 1 session)

The gap Phase 1 left: member-specific items (saying, favorite, note, medication, allergy) and the two parent-specific items (cook-log, dose-log) only wire end-to-end when the user is already on the parent's detail route. Off-route, the sheet closes into a no-op. Phase 2 closes this gap with an **inline picker** stage inside the sheet.

**Interaction spec — bean-jar expansion picker:**

1. User taps a context-required item (e.g., Saying) without matching context in the current route.
2. Sheet transitions: main grid slides out, header swaps to `quickAdd.picker.<kind>.title` (e.g. "Pick a beanie"), a back arrow appears in the top-left of the sheet body.
3. Picker view jar-pops in — tile grid reusing the Everyday visual vocabulary (rounded card, spring pop, 60ms stagger per item).
4. Each tile is a tappable `<button>`:
   - **memberId picker** (saying, favorite, note, medication, allergy) — `BeanieAvatar` + member name; pets filtered out
   - **recipeId picker** (cook-log) — recipe polaroid thumbnail + name; sorted alphabetically
   - **medicationId picker** (dose-log) — pill emoji + medication name + member subtitle; active meds only
5. Tile tap → commits the selection, closes the sheet, navigates to `item.route` with `?action=<name>&<contextKey>=<id>` in the query — same mechanism as the contextual path.
6. Back button → returns to main view, preserves the user's spot in the sheet.
7. Esc — when in picker view, returns to main (symmetry with back button); when in main view, closes the sheet.
8. Empty picker (e.g., user has no beans yet) → inline empty state with a CTA button that navigates to the "add parent" flow (e.g., `+ Add a beanie` → navigates to `/pod?action=add-beanie` — out of scope for the FAB, so Phase 2 just routes to the right page and lets the user add manually).

**State machine (on `useQuickAdd`):**

```ts
type PickerStage = { mode: 'main' } | { mode: 'picker'; pending: QuickAddItem };

const stage = ref<PickerStage>({ mode: 'main' });
```

`openQuickAdd` / `closeQuickAdd` reset to `main`. A new `triggerQuickAddAction(item)` branch checks whether `item.contextKey` is set AND missing from the current route's params — if so, transition to `picker` instead of navigating. `commitPickerSelection(contextId)` builds the intent with the resolved id and navigates. `cancelPicker()` resets to `main`.

**New component — `QuickAddPicker.vue`:**

- Mounted inside `QuickAddSheet` when `stage.mode === 'picker'`.
- Props: `pending: QuickAddItem` (the item awaiting context).
- Reads the appropriate store based on `pending.contextKey`:

  ```ts
  const dataSource = computed(() => {
    switch (pending.value.contextKey) {
      case 'memberId':
        return familyStore.sortedHumans;
      case 'recipeId':
        return recipesStore.recipes;
      case 'medicationId':
        return medicationsStore.active;
      case 'vacationId':
        return vacationStore.vacations; // reserved — not used today (trip-idea has empty-state toast)
      default:
        return assertNever(pending.value.contextKey, 'QuickAddPicker');
    }
  });
  ```

- Emits `select(id)` → parent calls `commitPickerSelection(id)`.
- Emits `back()` → parent calls `cancelPicker()`.
- A single renderer for all picker kinds; tile content varies by `contextKey` but the grid + animation are shared.

**Small `buildIntentQuery` extension** — accept an optional explicit context override so the picker-commit path can reuse the helper without synthesising a fake route:

```ts
export function buildIntentQuery(
  item: QuickAddItem,
  route: RouteLocationNormalizedLoaded,
  override?: Partial<Record<QuickAddContextKey, string>>
): Record<string, string> { ... }
```

Without the argument the helper behaves exactly as before — all existing tests pass unchanged.

**Page handlers wired in Phase 2:**

| Page                    | Action(s) handled                               | Pattern                                                                                                                                                                                                       |
| ----------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AccountsPage`          | `add-account`                                   | `showAddModal.value = true`                                                                                                                                                                                   |
| `AssetsPage`            | `add-asset`                                     | `showAddModal.value = true`                                                                                                                                                                                   |
| `GoalsPage`             | `add-goal`                                      | `showAddModal.value = true`                                                                                                                                                                                   |
| `BudgetPage`            | `add-budget`                                    | `showSettingsModal.value = true` — verify blank-create defaults                                                                                                                                               |
| `EmergencyContactsPage` | `add-emergency`                                 | `modalOpen.value = true`; editing = null                                                                                                                                                                      |
| `CareSafetyPage`        | `add-medication`, `add-allergy`, `add-dose-log` | Forward add-medication/add-allergy to `/pod/:memberId/<tab>` (pattern mirrors Scrapbook). Dose-log: look up medication by id, call `giveDose(med)` directly (useGiveDose is the existing one-call primitive). |
| `FamilyCookbookPage`    | `add-cooklog` (addition)                        | Forward to `/pod/cookbook/:recipeId?action=add-cooklog` — RecipeDetailPage's existing handler takes it from there.                                                                                            |

**Handler coverage drift guard:** Phase 2 clears out `PHASE_2_ACTIONS` in `quickAddCoverage.test.ts` so the set is empty after merge. Future adds can re-add to the skip set while in flight, but the baseline is zero.

**DRY / maintainability review (before writing code):**

1. **One picker component, not N.** The three picker kinds (member / recipe / medication) share layout + animation; only the per-tile content (avatar-vs-thumbnail-vs-emoji) varies. A single component with a switch on `contextKey` keeps the picker as one file — future context kinds are a new `case`, nothing else.
2. **`buildIntentQuery` grows by one optional arg — no new helper.** The override path and the route-params path converge in the same line (`override?.[key] ?? route.params[key]`). One function, two call patterns, zero duplication.
3. **No new navigation helper.** The picker-commit path reuses `router.push` / `router.replace` via the same same-route-vs-cross-route rule `triggerQuickAddAction` already applies. Extract the navigation step into a `navigateToIntent(item, resolvedRoute, query)` helper inside `useQuickAdd` so the two call sites (contextual path + picker-commit path) share it.
4. **Remove `FamilyScrapbookPage.vue`'s redirect-with-memberId path?** Consider deleting it, since picker guarantees memberId is present before navigation. Decision: **keep it for now.** The FAB isn't the only path to that URL — deep-linked shares, future in-app links, etc. could still arrive at `/pod/scrapbook?action=add-saying&memberId=X` without going through the picker. The forwarder is the destination-side counterpart to the picker. Document the pairing.
5. **`PICKER_KINDS` as a runtime table** keyed by `QuickAddContextKey`: `{ title, emptyState, dataSource, renderTile }`. The picker component is then a thin loop. Pushes the picker to a true data-driven component rather than a switch statement — but introduces indirection. **Verdict: lean toward the switch** until a second use case for the generic picker shows up (extract-on-second-use).
6. **Sheet two-state pattern** — local `v-if`/`v-else` in the sheet template. Do NOT introduce a separate route, separate modal, or slot-based pattern. Two `<section>`s inside one `BaseModal` body, transition between them via `<Transition>`.

**New i18n keys** (10 additions):

- `quickAdd.picker.back` — back-button label
- `quickAdd.picker.bean.title` / `.empty` / `.emptyCta` — member picker
- `quickAdd.picker.recipe.title` / `.empty` / `.emptyCta` — recipe picker
- `quickAdd.picker.medication.title` / `.empty` / `.emptyCta` — medication picker

**Tests added:**

- `useQuickAdd` state-machine: main → picker on contextless item, main ← picker on cancel, main ← picker on commit, main on open.
- `buildIntentQuery` override arg: override wins when present; falls through to route params when override is undefined.
- `QuickAddPicker`: renders correct data source per `contextKey`, empty state + CTA, click emits `select(id)`, back button emits `back()`.
- Each newly-wired page handler: the known action flips the local modal ref.

## Acceptance criteria

**Functional:**

- [ ] FAB renders on all pages except Settings, Setup, Login, 404
- [ ] FAB position respects `env(safe-area-inset-bottom) + 92px` on mobile; clears `MobileBottomNav` at every viewport
- [ ] FAB uses `public/brand/beanies_plus_sign.svg` (orange default, slate in dark mode) via inline `<symbol>` + CSS var
- [ ] Idle bob + hover halo + open rotation fire on `prefers-reduced-motion: no-preference`; static otherwise
- [ ] Tap opens a grouped bottom sheet with exactly 18 items in 4 groups
- [ ] Everyday section renders on warm kraft-paper card with 3×2 grid and jar-pop stagger
- [ ] Family / Money / Care sections render as 2-col grids with gentle fade-in stagger
- [ ] Tapping a sheet item: closes the sheet, pushes or replaces to the target route with `?action=` + optional context key, target page consumes intent, opens modal, clears query
- [ ] When on a parent detail route, sub-entity taps skip the picker and pre-fill the parent
- [ ] Sheet closes on: FAB re-tap, backdrop click, Esc, item tap
- [ ] First tabbable element inside the sheet is the first Everyday item
- [ ] Dark mode fully styled (FAB circle swaps via `--fab-bg`; Everyday card darkens appropriately)

**Quality / theme:**

- [ ] All text sizes ≥ 12 px (`text-xs`); no custom `text-[X.Xrem]`
- [ ] All colors from brand palette (no inline hex); `--tint-orange-*` vars for warm card
- [ ] All user-visible strings routed through `t()` with `en` + `beanie` variants
- [ ] `npm run translate` parses the new `quickAdd` namespace without warnings

**DRY / sustainability / no silent failures:**

- [ ] `QuickAddAction` is **derived** from `QUICK_ADD_ITEMS` via `typeof` + `as const satisfies` — no parallel manual union declaration
- [ ] `VALID_ACTIONS` built once from the config; no hard-coded lists of action strings anywhere else
- [ ] `useAutoOpenOnQuery` deleted; zero remaining imports (CI grep gate via the one-off migration test)
- [ ] All 5 Bean-tab call sites now use `useQuickAddIntent`
- [ ] `useQuickAddIntent` wraps handler in try/catch → error toast + console.error with call-site tag
- [ ] Unknown actions blocked at the composable boundary (not in per-page handlers)
- [ ] `useQuickAdd.openQuickAdd` no-ops when `hasOpenOverlays()` is true
- [ ] `QuickAddFab.onMounted` dev-guard logs a console.error if `#beanie-plus-fab` symbol isn't in the DOM
- [ ] Router guard strips orphan `?action=` on `hideQuickAdd` routes + warning toast

**Code organization (enforces long-term maintainability):**

- [ ] No function exceeds **20 lines or 2 levels of nesting**; complex handler cases extract named helpers (see TravelPage example)
- [ ] `buildIntentQuery`, `parseIntentFromQuery`, `stripIntentKeys` are **pure and independently unit-tested** (no component harness)
- [ ] Modal pre-fill uses the `initial<Entity>Id` prop convention; audit table complete
- [ ] Handler-coverage test (`quickAddCoverage.test.ts`) passes — every action in config is handled by at least one page
- [ ] No `any` in the FAB codepath; `npm run type-check` green

## Deferred (explicitly out of scope)

- Draggable FAB (variant 05 in mockup) — not shipping
- Settings screen for reordering top-6 — plan future
- Drag-to-dismiss on the bottom sheet — v1 uses backdrop / Esc / FAB re-tap
- E2E for the quick-add flow — hold until E2E budget is reclaimed under ADR-007
- Context-aware top-6 reshuffle based on current page — out of scope
- Promoting sheet positioning to a `BaseModal placement="bottom-sheet"` prop — only if a second bottom-sheet use case emerges

## Open items to resolve during implementation

1. ~~**Final FAB asset.**~~ ✅ **Resolved 2026-04-23** — shipped at `public/brand/beanies_plus_sign.svg`.
2. **Budget modal pre-fill semantics.** `BudgetSettingsModal` may require a category context — verify it opens cleanly in a blank "create" state when triggered from the FAB. If it requires a prop, add one. Unit-test the blank path.
3. **Trip idea pre-fill when off any trip.** `TravelPage` handler prompts "Add trip first" when `vacations.length === 0` (see handler example). If exactly one trip exists, implementation picks it silently; otherwise shows picker. Decide at implementation time.
4. **Emoji rendering parity.** Unicode-escape forms in `quickAddItems.ts` should render identically to `navigation.ts` across Chromium / WebKit / Firefox. Spot-check on all three before merge.
5. **Sprite extraction trigger.** A single inline `<symbol>` in `App.vue` is fine. If a second inline sprite is added (e.g., for a different page's FAB or a hero icon), extract both into a `<BeanieSprites>` component in `src/components/common/` to keep `App.vue` readable. Defer until second use arrives — extract-on-second-use, not on-first.
