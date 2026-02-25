# Plan: Sidebar Accordion Restructure (#100)

> Date: 2026-02-25
> Related issues: #100

## Context

The current sidebar has a flat two-section layout (primary/secondary) with 9 nav items. The v7 UI framework requires two collapsible accordion sections — **The Treehouse** (family features) and **The Piggy Bank** (finance features) — plus a pinned Settings item. Three items are removed from the sidebar (Assets, Reports, Forecast). Four new items are added for upcoming pages (Nook, Planner, To-Do, Budgets).

## Approach

### Step 1: Add translation keys to `uiStrings.ts`

Add near existing `nav.*` keys (~line 60):

```typescript
'nav.section.treehouse': { en: 'The Treehouse', beanie: 'The Treehouse' },
'nav.section.piggyBank': { en: 'The Piggy Bank', beanie: 'The Piggy Bank' },
'nav.nook': { en: 'Family Nook', beanie: 'Family Nook' },
'nav.planner': { en: 'Family Planner', beanie: 'Family Planner' },
'nav.todo': { en: 'Family To-Do', beanie: 'Family To-Do' },
'nav.overview': { en: 'Overview', beanie: 'Your Nook' },
'nav.budgets': { en: 'Budgets', beanie: 'Bean Budget' },
'nav.comingSoon': { en: 'Soon', beanie: 'Soon' },
```

Keep existing `nav.dashboard`, `nav.assets`, `nav.reports`, `nav.forecast` — they're still used by page titles and router meta.

### Step 2: Restructure `navigation.ts`

Replace `section: 'primary' | 'secondary'` with `section: 'treehouse' | 'piggyBank' | 'pinned'`. Add optional `comingSoon` and `badgeKey` fields. Add `NavSectionDef` for accordion headers.

**New items:**

- **Treehouse:** Family Nook (`/nook`, comingSoon), Family Planner (`/planner`, comingSoon), Family To-Do (`/todo`, comingSoon), Family Hub (`/family`)
- **Piggy Bank:** Overview (`/dashboard`), Accounts (`/accounts`), Budgets (`/budgets`, comingSoon), Transactions (`/transactions`), Goals (`/goals`, badgeKey: `activeGoals`)
- **Pinned:** Settings (`/settings`)

Remove `PRIMARY_NAV_ITEMS` and `SECONDARY_NAV_ITEMS` exports (only used by `AppSidebar.vue` + docs). Add `TREEHOUSE_ITEMS`, `PIGGY_BANK_ITEMS`, `PINNED_ITEMS` helpers. Keep `MOBILE_TAB_ITEMS` unchanged (#101).

### Step 3: Create `useSidebarAccordion.ts` composable

New file: `src/composables/useSidebarAccordion.ts`

- Singleton reactive state for section open/closed
- Persist to `localStorage` key `sidebar-accordion-state`
- `isOpen(section)` / `toggle(section)` API
- Watch current route → auto-expand section containing active item
- Both sections can be open simultaneously

### Step 4: Rewrite `AppSidebar.vue`

Template structure:

```
Logo & Branding (unchanged)
├── 🌳 The Treehouse (accordion header with chevron-down icon)
│   └── nav items (with comingSoon badge)
├── 🐷 The Piggy Bank (accordion header with chevron-down icon)
│   └── nav items (with goals badge count)
├── divider
├── ⚙️ Settings (pinned, always visible)
├── User Profile Card (unchanged)
└── Security Indicators (unchanged)
```

Key details:

- Section headers: uppercase label + section emoji + `BeanieIcon name="chevron-down"` with `rotate-180` transition
- `v-show` for collapse (preserves DOM state)
- Active item styling unchanged: `border-l-4 border-[#F15D22]` with gradient
- Coming-soon items: `opacity-50` + tiny "Soon" label
- Goals badge: Heritage Orange pill (`bg-[#F15D22] text-white text-[0.6rem] rounded-full px-1.5`)
- Badge value from `goalsStore.activeGoals.length` via a computed badge map

### Step 5: Update `MobileHamburgerMenu.vue`

Replace flat `navItems` with accordion-grouped sections, matching the sidebar structure. Import the same `TREEHOUSE_ITEMS`, `PIGGY_BANK_ITEMS`, `PINNED_ITEMS` and `useSidebarAccordion`. Add goals badge. Keep controls section, user profile, sign-out buttons, and security indicators unchanged.

### Step 6: Add stub routes for new pages

Add to `router/index.ts` before the catch-all:

```typescript
{ path: '/nook', name: 'Nook', component: () => import('@/pages/DashboardPage.vue'), meta: { title: 'Family Nook', requiresAuth: true } },
{ path: '/planner', name: 'Planner', component: () => import('@/pages/DashboardPage.vue'), meta: { title: 'Family Planner', requiresAuth: true } },
{ path: '/todo', name: 'Todo', component: () => import('@/pages/DashboardPage.vue'), meta: { title: 'Family To-Do', requiresAuth: true } },
{ path: '/budgets', name: 'Budgets', component: () => import('@/pages/DashboardPage.vue'), meta: { title: 'Budgets', requiresAuth: true } },
```

These temporarily render DashboardPage until their real pages are built (#97, #98, #99).

## Files affected

| File                                            | Action                                         |
| ----------------------------------------------- | ---------------------------------------------- |
| `src/services/translation/uiStrings.ts`         | Add 8 new translation keys                     |
| `src/constants/navigation.ts`                   | Rewrite types and items for accordion sections |
| `src/composables/useSidebarAccordion.ts`        | **New** — accordion state composable           |
| `src/components/common/AppSidebar.vue`          | Rewrite with accordion sections                |
| `src/components/common/MobileHamburgerMenu.vue` | Update nav to use accordion sections           |
| `src/router/index.ts`                           | Add 4 stub routes                              |

**Reuse existing:**

- `BeanieIcon` component (`src/components/ui/BeanieIcon.vue`) — `chevron-down` icon already defined in `src/constants/icons.ts`
- `useGoalsStore().activeGoals` — for badge count
- `useTranslation().t()` — for all text

## Verification

1. `npm run type-check` — no TypeScript errors
2. `npm run lint` — no lint errors
3. `npm run translate` — translation parser still works after uiStrings changes
4. `npm run dev` — manual testing:
   - Both accordion sections expand/collapse independently
   - Chevron rotates on toggle
   - State persists across page refresh
   - Active route auto-expands its section
   - Active item has Heritage Orange border + gradient
   - Coming-soon items are muted with "Soon" label
   - Goals badge shows correct count
   - Settings pinned outside accordions
   - Logo, user profile, security indicators unchanged
   - Mobile hamburger menu mirrors accordion structure
   - Existing routes still work (`/dashboard`, `/accounts`, etc.)
   - New stub routes navigate without error (`/nook`, `/planner`, `/todo`, `/budgets`)
   - Assets/Reports/Forecast pages still reachable via direct URL
5. `npm run build` — production build succeeds
