# Plan: Quick-add FAB + bottom sheet

> Date: 2026-04-23
> Related issues: #37
> Mockup: `docs/mockups/quick-add-fab.html` (variant 06)

## Context

The app has grown from 5 addable entities at the time #37 was filed (Feb 2026) to **18 today** spanning family planning, money, care, and cooking. Users currently have to navigate to each domain page before opening its add modal. This plan delivers a single peek-a-boo-beanie FAB that opens a grouped bottom sheet, with a central config driving every entity. Design direction locked via the mockup exploration on 2026-04-23.

## Decisions locked (from today's design session)

1. **Mobile form factor:** variant 03 — floating FAB sits above `MobileBottomNav` via safe-area math. No restructure of the nav.
2. **Sub-entity context pre-fill:** when the user is already on the parent's detail page (bean, recipe, trip, medication), the add modal skips the picker and pre-fills the parent ID.
3. **Scope:** all 18 entities wired end-to-end. Deferred: draggable FAB, Settings-level top-6 customization.

## Approach

Four small, single-responsibility units plus one config array:

- **`QuickAddFab.vue`** — peek-a-boo FAB button, mounted once in `App.vue`, visibility driven by route meta
- **`QuickAddSheet.vue`** — bottom sheet rendering the 4 groups from the config, uses `BaseModal` for backdrop / focus trap / Esc
- **`useQuickAdd.ts`** — composable owning the open/close state (single source of truth shared by FAB and sheet)
- **`useQuickAddIntent.ts`** — composable consumed by each target page to pick up `?action=<name>` and open its local modal
- **`quickAddItems.ts`** — typed config array; all labels, routes, actions, context keys live here and drive everything

Intent passes from FAB → target page via the `?action=<name>` query param (already proposed in the issue). When the user taps a sheet item:

1. Sheet closes
2. If already on the target route → `?action` is set on the current route; the page's `useQuickAddIntent` handler fires and opens the modal
3. If on a different route → router navigates to `route?action=<name>&<contextKey>=<id>`; target page mounts, consumes the intent, opens the modal, clears the query

Query-param approach wins because it naturally handles the "already on target page" case, is deep-linkable, is debuggable, and round-trips through history cleanly.

## Mockup → CIG reconciliation

The mockup was rendered with some sub-theme values (10–11px label text, Fraunces italic on section sub-labels). The theme skill wins — here's the map to production values:

| Mockup                                                               | Implementation                                                                                                   | Why                                                            |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 10px kicker, 10px section title, 11px subhint, 11px label, 10px hint | All → `text-xs` (12px)                                                                                           | Theme minimum is 12px; standard Tailwind classes only          |
| Fraunces italic "setup" / "what you add most"                        | Inter italic (`italic` class on body text)                                                                       | Theme uses Outfit + Inter; Fraunces is guide-scoped per status |
| Custom letter-spacing `0.14em` on section titles                     | `tracking-wider` (0.05em) or Tailwind's `tracking-[0.08em]` via CSS, per theme rule for UI labels                | Theme spec: "UI labels … tracking 0.08em"                      |
| Hand-tuned radii (28/22/20/16 px)                                    | Tailwind scale: `rounded-3xl` (sheet), `rounded-2xl` (Everyday card), `rounded-xl` (items), `rounded-full` (FAB) | Squircle convention, standard scale                            |
| Custom hex tints                                                     | `var(--tint-orange-8)` / `var(--tint-orange-15)`                                                                 | Already defined in theme                                       |
| Inline `#F15D22` etc.                                                | `bg-orange-500` or Heritage Orange CSS vars                                                                      | Theme-defined colors only                                      |

Everything else in the mockup matches the theme directly (brand palette, Outfit + Inter, squircle feel, no Alert Red, Heritage Orange as CTA/action color, Cloud White backgrounds, Deep Slate text).

## File changes

### Create (5)

| File                                      | Purpose                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------- |
| `src/components/common/QuickAddFab.vue`   | Peek-a-boo FAB button; idle-bob animation; opens the sheet                            |
| `src/components/common/QuickAddSheet.vue` | Bottom sheet with 4 grouped sections rendering the config                             |
| `src/composables/useQuickAdd.ts`          | `isOpen`, `open()`, `close()`, `triggerAction(item)` — thin state + router nav helper |
| `src/composables/useQuickAddIntent.ts`    | Per-page: consumes `?action=<name>` + optional contextId; fires handler; clears query |
| `src/constants/quickAddItems.ts`          | Typed config array driving the sheet and action dispatch                              |

### Modify

| File                                    | Change                                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/App.vue`                           | Mount `<QuickAddFab />` globally, after `<router-view>`                                                |
| `src/router/index.ts`                   | Add `meta: { hideQuickAdd: true }` to `/settings`, `/login`, `/setup`, 404, and any bean detail routes |
| `src/services/translation/uiStrings.ts` | Add 22 `quickAdd.*` keys (en + beanie for each)                                                        |
| `scripts/updateTranslations.mjs`        | Verify parses new `quickAdd` namespace; run `npm run translate` to confirm                             |
| `public/brand/beanies_plus_sign.svg`    | Final FAB asset from greg (SVG, orange + slate themeable via CSS var)                                  |

Per-page intent consumers (one `useQuickAddIntent` call per page):

| Page                                                                | Action handler wires                                                                        |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------- | ----------- | -------------- | --------------------------------------------------------------------------- |
| `src/pages/AccountsPage.vue`                                        | `add` → open `showAddModal`                                                                 |
| `src/pages/TransactionsPage.vue`                                    | `add` → transaction modal; `add-recurring` → switch to recurring tab + open recurring modal |
| `src/pages/AssetsPage.vue`                                          | `add` → open add modal                                                                      |
| `src/pages/GoalsPage.vue`                                           | `add` → open goal modal                                                                     |
| `src/pages/BudgetsPage.vue`                                         | `add` → open `BudgetSettingsModal` in create mode                                           |
| `src/pages/FamilyPlannerPage.vue` (or wherever `/activities` lives) | `add` → open activity modal                                                                 |
| `src/pages/FamilyTodoPage.vue`                                      | `add` → open todo modal                                                                     |
| `src/pages/TravelPage.vue`                                          | `add` → open trip modal; `add-idea` → open idea modal (accepts `?vacationId=` pre-fill)     |
| `src/pages/BeanDetailPage.vue`                                      | `add-saying                                                                                 | add-favorite | add-note                                 | add-allergy | add-medication | add-dose-log`→ open respective modal pre-filled with`:memberId` route param |
| `src/pages/FamilyScrapbookPage.vue` (`/pod/scrapbook`)              | `add-saying                                                                                 | add-favorite | add-note` → open bean-picker-first modal |
| `src/pages/FamilyCookbookPage.vue` (`/pod/cookbook`)                | `add-recipe` → open recipe modal; `add-cooklog` → open recipe-picker-first log modal        |
| `src/pages/RecipeDetailPage.vue`                                    | `add-cooklog` → open log modal pre-filled with `:recipeId`                                  |
| `src/pages/CareSafetyPage.vue` (`/pod/safety`)                      | `add-medication                                                                             | add-allergy  | add-dose-log` → bean-picker-first        |
| `src/pages/EmergencyContactsPage.vue` (`/pod/contacts`)             | `add` → open modal                                                                          |

## Config array schema

```ts
// src/constants/quickAddItems.ts
import type { UIStringKey } from '@/services/translation/uiStrings';

export type QuickAddGroup = 'everyday' | 'family' | 'money' | 'care';

/**
 * When set, the consuming page should pre-fill this id from the current
 * route param if it matches (skipping any picker in the modal). The picker
 * is still shown when navigating from anywhere else.
 */
export type QuickAddContextKey = 'memberId' | 'recipeId' | 'vacationId' | 'medicationId';

export interface QuickAddItem {
  id: string; // unique key, kebab-case
  group: QuickAddGroup;
  order: number; // display order within group
  emoji: string; // canonical emoji (see icon map below)
  labelKey: UIStringKey;
  hintKey: UIStringKey; // short sub-label, may be empty string
  route: string; // target path
  action: string; // ?action=<value>
  tab?: string; // optional tab within target page (for TransactionsPage)
  contextKey?: QuickAddContextKey; // parent id to pre-fill when available
}

export const QUICK_ADD_ITEMS: QuickAddItem[] = [
  // — Everyday (jar-pop) —
  {
    id: 'activity',
    group: 'everyday',
    order: 1,
    emoji: '📅',
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
    emoji: '💳',
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
    emoji: '👨‍🍳',
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
    emoji: '💬',
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
    emoji: '💝',
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
    emoji: '📝',
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
    emoji: '🍜',
    labelKey: 'quickAdd.recipe.label',
    hintKey: 'quickAdd.recipe.hint',
    route: '/pod/cookbook',
    action: 'add-recipe',
  },
  {
    id: 'trip-idea',
    group: 'family',
    order: 4,
    emoji: '💡',
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
    emoji: '💰',
    labelKey: 'quickAdd.account.label',
    hintKey: 'quickAdd.account.hint',
    route: '/accounts',
    action: 'add',
  },
  {
    id: 'budget',
    group: 'money',
    order: 2,
    emoji: '📊',
    labelKey: 'quickAdd.budget.label',
    hintKey: 'quickAdd.budget.hint',
    route: '/budgets',
    action: 'add',
  },
  {
    id: 'recurring',
    group: 'money',
    order: 3,
    emoji: '🔁',
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
    emoji: '🏢',
    labelKey: 'quickAdd.asset.label',
    hintKey: 'quickAdd.asset.hint',
    route: '/assets',
    action: 'add',
  },
  {
    id: 'goal',
    group: 'money',
    order: 5,
    emoji: '🎯',
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
    emoji: '💊',
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
    emoji: '⏱',
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
    emoji: '🆘',
    labelKey: 'quickAdd.emergency.label',
    hintKey: 'quickAdd.emergency.hint',
    route: '/pod/contacts',
    action: 'add',
  },
];
```

Derived getters (keep computation in one place, consume from `QuickAddSheet`):

```ts
export function itemsByGroup(): Record<QuickAddGroup, QuickAddItem[]> { ... }
// Used by QuickAddSheet to render section grids in order.
```

## Intent-passing composable (DRY core)

```ts
// src/composables/useQuickAddIntent.ts
export type QuickAddIntentHandler = (action: string, context: Record<string, string>) => void;

export function useQuickAddIntent(handler: QuickAddIntentHandler) {
  const route = useRoute();
  const router = useRouter();

  const consume = () => {
    const action = route.query.action;
    if (typeof action !== 'string' || !action) return;

    // Extract context keys (memberId, recipeId, etc.) if present.
    const context: Record<string, string> = {};
    for (const key of ['memberId', 'recipeId', 'vacationId', 'medicationId'] as const) {
      const v = route.query[key];
      if (typeof v === 'string') context[key] = v;
    }

    handler(action, context);

    // Clear to prevent re-trigger on refresh / back nav.
    const {
      action: _a,
      memberId: _m,
      recipeId: _r,
      vacationId: _v,
      medicationId: _md,
      ...rest
    } = route.query;
    router.replace({ query: rest });
  };

  onMounted(consume);
  watch(() => route.query.action, consume);
}
```

Every page handler is 3–6 lines:

```ts
// AccountsPage.vue
useQuickAddIntent((action) => {
  if (action === 'add') showAddModal.value = true;
});

// TransactionsPage.vue
useQuickAddIntent((action) => {
  if (action === 'add') showAddModal.value = true;
  else if (action === 'add-recurring') {
    activeTab.value = 'recurring';
    showRecurringModal.value = true;
  }
});

// BeanDetailPage.vue
useQuickAddIntent((action) => {
  const memberId = route.params.memberId; // already scoped to this bean
  if (action === 'add-saying') openSayingModal({ memberId });
  else if (action === 'add-favorite') openFavoriteModal({ memberId });
  // … etc
});
```

## QuickAddSheet — layout spec

Uses `BaseModal` for backdrop, focus trap, and Esc. Positions content as a bottom sheet via a single `sheet` CSS class (applied inside the modal's slot content). No new BaseModal variant required for v1 — scoped CSS on the sheet component handles positioning. If a second bottom-sheet use case appears later, promote this to a shared `placement="bottom-sheet"` prop.

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

Desktop: same structure, just a smaller width (max-w-md) centered at `bottom: 24px; right: 24px` as a floating card rather than full-width drawer. Same CSS with a media-query breakpoint.

## FAB component

```vue
<template>
  <button
    v-if="showFab"
    class="fab"
    :class="{ 'fab--open': isOpen }"
    :aria-label="t('quickAdd.fab.label')"
    @click="toggle"
  >
    <img :src="fabSrc" alt="" aria-hidden="true" />
  </button>
</template>
```

- `showFab = computed(() => !route.meta.hideQuickAdd)`
- `fabSrc` picks between orange and slate SVG based on `useColorScheme()` (or the existing theme source of truth)
- Idle bob: CSS keyframe `@keyframes fab-peek { 0%,100% { transform:translateY(0) } 50% { transform:translateY(-3px) } }`, 2.6s ease-in-out infinite
- Open state: `transform: rotate(45deg) scale(0.96)`, spring ease
- Hover: `box-shadow: var(--shadow-fab), 0 0 0 4px var(--tint-orange-15)`
- All motion gated on `@media (prefers-reduced-motion: reduce)`

### Positioning

```css
.fab {
  position: fixed;
  z-index: 40; /* above page content, below modals (which live at 50+) */
  right: 16px;
  bottom: calc(env(safe-area-inset-bottom) + 92px); /* clears MobileBottomNav */
}

@media (min-width: 768px) {
  .fab {
    right: 24px;
    bottom: 24px;
  }
}
```

## FAB asset strategy

greg is preparing a refined version of the peek-a-boo beanie. Ship as:

- **`public/brand/beanies_plus_sign.svg`** — single file, uses `currentColor` or a CSS custom property for the circle fill so the same asset serves both orange (default) and slate (dark mode)
- Optional 2x/3x PNG fallback at `public/brand/beanies_plus_sign.png` if the SVG rasterisation hits edge cases on older browsers
- Old `beanies_plus_sign_512x512.png` stays available for other surfaces that already reference it — do not delete

Acceptance: file size <30 KB, sharp at 48–96 px, preserves the beanie's core peek-a-boo character. If face details blur at 60 px, simplify within the SVG (bigger eyes, fewer shading layers).

## Animations — full timeline

All values match the mockup and fire only when `prefers-reduced-motion` is not set. Reduced-motion collapses stagger to 10 ms and uses instant opacity fades.

| Moment                           | Property                                          | Duration               | Ease                                     |
| -------------------------------- | ------------------------------------------------- | ---------------------- | ---------------------------------------- |
| FAB idle bob                     | translateY 0 → -3 → 0                             | 2.6 s, infinite        | ease-in-out                              |
| FAB tap → open                   | rotate(0 → 45°) scale(1 → 0.96)                   | 450 ms                 | spring cubic-bezier(0.34, 1.56, 0.64, 1) |
| Backdrop fade in                 | opacity 0 → 1                                     | 250 ms                 | ease-out                                 |
| Sheet slide up                   | translateY(100% → 0)                              | 450 ms                 | cubic-bezier(0.2, 0.8, 0.2, 1)           |
| Everyday jar-pop (per item)      | translateY(28 → 0) scale(0.35 → 1) opacity(0 → 1) | 550 ms per item        | spring                                   |
| Everyday stagger                 | each item                                         | 60 ms, first at 120 ms | —                                        |
| Family / Money / Care (per item) | translateY(10 → 0) opacity(0 → 1)                 | 350 ms per item        | ease-out                                 |
| Inter-group stagger              | 100 ms between groups (Family → Money → Care)     | —                      | —                                        |

## Accessibility

- FAB is a `<button>` with `aria-label` (translated), `aria-expanded` bound to `isOpen`
- Sheet mounts inside `BaseModal` → inherits existing focus trap, backdrop click to close, Esc handling, body scroll lock
- Each sheet item is a `<button>`, keyboard-reachable via Tab in DOM order (Everyday first, then Family/Money/Care)
- Section titles use `<h3>` for proper outline; `aria-labelledby` wires the sheet dialog to the main title
- Emoji marked `aria-hidden="true"`; the `labelKey` provides the accessible name

## i18n keys

22 new keys in `src/services/translation/uiStrings.ts`, each with both `en` and `beanie` values:

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
    money: {
      title: { en: 'Money', beanie: 'money' },
      setup: { en: 'setup', beanie: 'setup' },
    },
    care: { title: { en: 'Care', beanie: 'care' } },
  },
  activity:    { label: { en: 'Activity',    beanie: 'activity' },     hint: { en: 'calendar event',         beanie: 'calendar event' } },
  todo:        { label: { en: 'To-do',       beanie: 'to-do' },        hint: { en: 'task · who · when',      beanie: 'task · who · when' } },
  transaction: { label: { en: 'Transaction', beanie: 'transaction' },  hint: { en: 'income · expense · transfer', beanie: 'income · expense · transfer' } },
  trip:        { label: { en: 'Trip',        beanie: 'trip' },         hint: { en: 'travel plans',            beanie: 'travel plans' } },
  cookLog:     { label: { en: 'Cook log',    beanie: 'cook log' },     hint: { en: '5-star · note · photo',  beanie: '5-star · note · photo' } },
  saying:      { label: { en: 'Saying',      beanie: 'saying' },       hint: { en: 'quote a beanie',         beanie: 'quote a beanie' } },
  favorite:    { label: { en: 'Favorite',    beanie: 'favorite' },     hint: { en: 'food · game · song',     beanie: 'food · game · song' } },
  note:        { label: { en: 'Note',        beanie: 'note' },         hint: { en: 'per-bean journal',       beanie: 'per-bean journal' } },
  recipe:      { label: { en: 'Recipe',      beanie: 'recipe' },       hint: { en: 'ingredients · steps',    beanie: 'ingredients · steps' } },
  tripIdea:    { label: { en: 'Trip idea',   beanie: 'trip idea' },    hint: { en: 'wishlist a destination', beanie: 'wishlist a destination' } },
  account:     { label: { en: 'Account',     beanie: 'account' },      hint: { en: 'checking · credit · loan', beanie: 'checking · credit · loan' } },
  budget:      { label: { en: 'Budget',      beanie: 'budget' },       hint: { en: 'category caps · period', beanie: 'category caps · period' } },
  recurring:   { label: { en: 'Recurring',   beanie: 'recurring' },    hint: { en: 'weekly · monthly · yearly', beanie: 'weekly · monthly · yearly' } },
  asset:       { label: { en: 'Asset',       beanie: 'asset' },        hint: { en: 'home · vehicle · investment', beanie: 'home · vehicle · investment' } },
  goal:        { label: { en: 'Goal',        beanie: 'goal' },         hint: { en: 'save · payoff · invest', beanie: 'save · payoff · invest' } },
  medication:  { label: { en: 'Medication',  beanie: 'medication' },   hint: { en: 'dose · schedule',        beanie: 'dose · schedule' } },
  doseLog:     { label: { en: 'Dose log',    beanie: 'dose log' },     hint: { en: 'record a given dose',    beanie: 'record a given dose' } },
  allergy:     { label: { en: 'Allergy',     beanie: 'allergy' },      hint: { en: 'severity · response',    beanie: 'severity · response' } },
  emergency:   { label: { en: 'Emergency contact', beanie: 'emergency contact' }, hint: { en: 'sitter · doctor · school', beanie: 'sitter · doctor · school' } },
}
```

After editing, run `npm run translate` and confirm `scripts/updateTranslations.mjs` parses the new `quickAdd` namespace without warnings.

## Route visibility

Add `meta.hideQuickAdd: true` to:

- `/settings`
- `/login`
- `/setup` (onboarding)
- `*` (404 NotFoundPage)

All other routes show the FAB. Beans detail route (`/pod/:memberId/...`) intentionally KEEPS the FAB so users can still quick-add from a bean page (the context-aware sub-entities in fact depend on the FAB being visible there).

## Tests

### Unit (comprehensive — cheap to write, high signal)

| File                                                    | Coverage                                                                                                                                                                    |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/common/__tests__/QuickAddFab.test.ts`   | renders on permitted routes · hidden when `meta.hideQuickAdd` true · emits open on click · toggle behaviour · aria-label translated · reduced-motion disables bob animation |
| `src/components/common/__tests__/QuickAddSheet.test.ts` | renders all 18 items in correct groups + order · close on backdrop / Esc / re-tap · emits action with correct route + query on item click                                   |
| `src/composables/__tests__/useQuickAdd.test.ts`         | open / close / toggle state transitions · triggerAction composes route correctly · navigates when off-target · stays when on-target                                         |
| `src/composables/__tests__/useQuickAddIntent.test.ts`   | consumes `?action=` on mount · clears query after firing · re-fires on query change · ignores empty / unknown actions                                                       |
| `src/constants/__tests__/quickAddItems.test.ts`         | exactly 18 items · all group/order combinations unique · every `labelKey` resolves via `uiStrings` · every `route` is a registered path                                     |

### E2E

Per ADR-007, the current budget is already over the 25-test cap (33 tests). **No new E2E tests for v1.** Unit coverage + manual smoke test covers it. Add one E2E (`fab-opens-transactions-add`) as a follow-up when the budget is reclaimed.

## Phasing

Two small, cohesive PRs — ship Phase 1 to use it, follow with Phase 2 for completeness.

### Phase 1 — chrome + 6 everyday entities (est. 1 session)

- All new files (FAB, Sheet, composables, config) scaffolded with all 18 entries in the config
- Route meta + `App.vue` mount
- Page handlers ONLY for the 6 everyday items: Activity, To-do, Transaction, Trip, Cook log, Saying
- i18n keys for all 22 `quickAdd.*` entries (so Phase 2 just adds handlers)
- FAB asset in place (waits on greg's final file)
- Unit tests for all scaffold components + covered entities

Ships as a working FAB whose non-wired items open the target page but the modal doesn't auto-open. Still useful; matches current UX for those entities.

### Phase 2 — remaining 12 entities + context pre-fill (est. 1 session)

- Page handlers for Family (Favorite, Note, Recipe, Trip idea)
- Page handlers for Money (Account, Budget, Recurring, Asset, Goal)
- Page handlers for Care (Medication, Dose log, Allergy, Emergency contact)
- Sub-entity context pre-fill — verify every consuming modal accepts a pre-filled parent id prop (add props where missing)
- Unit tests for remaining entity wirings

## Acceptance criteria

- [ ] FAB renders on all pages except Settings, Setup, Login, 404
- [ ] FAB position respects `env(safe-area-inset-bottom) + 92px` on mobile; clears `MobileBottomNav` at every viewport
- [ ] FAB uses `public/brand/beanies_plus_sign.svg` (orange default, slate in dark mode)
- [ ] Idle bob + hover halo + open rotation animate per spec and are killed by `prefers-reduced-motion`
- [ ] Tap opens a grouped bottom sheet with exactly 18 items in 4 groups
- [ ] Everyday section renders on warm kraft-paper card with 3×2 grid and jar-pop stagger
- [ ] Family, Money, Care sections render as 2-col grids with gentle fade-in stagger
- [ ] All text sizes ≥ 12 px (`text-xs`); no custom `text-[X.Xrem]` anywhere
- [ ] All colors come from the brand palette (no inline hex); uses `--tint-orange-*` vars for warm card
- [ ] Tapping a sheet item:
  - closes the sheet
  - if on target route, opens the page's modal via `?action` intent
  - else navigates to target route with `?action` + optional context id, target page consumes + opens modal + clears query
- [ ] When on a parent detail route (`/pod/:memberId`, `/pod/cookbook/:recipeId`, `/travel/:vacationId`), sub-entity taps skip the picker and pre-fill the parent
- [ ] Sheet closes on: FAB re-tap, backdrop click, Esc key, item tap
- [ ] Sheet is focus-trapped while open; first tabbable item is the first Everyday bean
- [ ] Dark mode fully styled (FAB swaps SVG, Everyday card darkens appropriately)
- [ ] All user-visible strings go through `t()` with `en` + `beanie` variants
- [ ] `npm run translate` parses the new `quickAdd` namespace without warnings
- [ ] `npm run type-check` + `npm run lint` + unit tests all green

## Deferred (explicitly out of scope)

- Draggable FAB (variant 05 in mockup) — not shipping
- Settings screen for reordering top-6 — plan future
- Drag-to-dismiss on the bottom sheet — v1 uses backdrop / Esc / FAB re-tap
- E2E for the quick-add flow — hold until E2E budget is reclaimed under ADR-007
- Context-aware top-6 reshuffle based on current page — out of scope

## Open items to resolve during implementation

1. **Final FAB asset.** greg is preparing a refined SVG. The plan's CSS assumes `public/brand/beanies_plus_sign.svg`; confirm filename when it lands.
2. **Budget modal pre-fill semantics.** `BudgetSettingsModal` may require a category context — verify it opens cleanly in a blank "create" state when triggered from the FAB.
3. **Trip idea pre-fill when off any trip.** If the user taps Trip idea from, say, Dashboard, the modal needs a trip picker. Confirm `IdeaEditModal` (or its parent) supports a picker-first mode; add one if not.
