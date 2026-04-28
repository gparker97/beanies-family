# Plan: Mobile Nav v3 — Bean Stack with Side-Card Hints

> Date: 2026-04-28
> Mockup: `docs/mockups/mobile-nav-bean-jar-v3.html`
> Final plan file (canonical, will be saved post-approval): `docs/plans/2026-04-28-mobile-nav-v3-bean-stack.md`

---

## Context

The mobile bottom nav (`src/components/common/MobileBottomNav.vue`) is a flat 6-tab strip — Nook / To-do / Activities / Travel / Piggy Bank / Pod. On 2026-04-25 Greg flagged it as crowded against the brand's calm-and-focused intent, and not scaling as features grow.

The v3 mockup collapses to **4 category tabs** (Nook / Planning / Money / Pod). Tapping a non-Nook tab opens a vertical "bean stack" — a column of round bean buttons each paired with a side card carrying a one-line hint. The bean stays anchored over the active tab; the side card auto-flips toward whichever screen-half has more space. Nook stays a direct one-tap destination. Active route is the bottom bean (closest to thumb), ringed in Heritage Orange.

**Trade-off (deliberate):** Activities / To-do / Travel each go from one tap to two. The win is the bar holds calmly at 4 forever; the 5 Pod sub-routes today buried in a hamburger drawer become first-class with hint copy.

**Out of scope for v1 (Greg confirmed):**

- Mockup page content / titles (illustrative skeletons; nav-only change).
- `+N More` overflow popover (Pod has 5 children — fits the 6-cap; build only when overflow happens).
- Quick Add FAB (separate ADD-side concern; pattern law `cluster bloom = ADD, pure stack = NAVIGATE`).
- Refactoring `BaseModal` + `MobileHamburgerMenu` to consume the new composables (deferred to a follow-up PR — see PR-split rationale below).

---

## Approach — sustainability lenses up front

### Lens 1: small single-purpose composables, not one configurable monster

Three tiny composables, one responsibility each. Each is independently testable, has a single failure surface, and is composed by callers — no flag combinatorics.

| Composable                             | Responsibility                                                                                                                              | Used by (this PR)                              | Used by (PR 2)                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------- |
| `useEscapeClose(isOpen, onClose)`      | Esc key listener while open                                                                                                                 | `MobileNavBeanStack`                           | `BaseModal`, `MobileHamburgerMenu` |
| `useBodyScrollLock(isOpen)`            | Lock body scroll while open (delegates to existing ref-counted `lockBodyScroll`/`unlockBodyScroll` in `src/utils/overlayStack.ts`)          | `MobileNavBeanStack`                           | `BaseModal`, `MobileHamburgerMenu` |
| `useBackGestureClose(isOpen, onClose)` | History.pushState marker + popstate listener; **with re-entry guard** for programmatic `history.back()`. Each call gets a unique marker key | `MobileNavBeanStack`, `useQuickAdd` (refactor) | —                                  |

Every composable uses **`onScopeDispose` as a safety net** in addition to its watch-driven cleanup, so a stuck scroll-lock or leaked listener cannot survive an unexpected component teardown.

### Lens 2: components own their own measurement; `getAnchor` is a function

Anti-pattern (rejected): parent reads `getBoundingClientRect()` once, passes it down, manages resize on the child's behalf. Tight coupling, stale-rect risk.

Better: stack receives a **getter function** so it can read fresh DOM rect on demand. Functions don't go stale; tests pass `() => mockEl` cleanly.

```ts
defineProps<{
  getAnchor: () => HTMLElement | null;
  category: MobileNavCategory;
  isOpen: boolean;
}>();
```

The stack registers its own `window.resize` listener (rAF-throttled — iOS Safari fires `resize` aggressively on URL-bar show/hide). Listener is added/removed inside a `watch(isOpen)` block with `onScopeDispose` as the safety net.

### Lens 3: real DOM, no clever pseudo-elements where they hurt testability

The "active dot" indicator on category tabs is a real `<span class="dot">`, not a `::before`. Easy to query in tests, easy to add ARIA, easy to debug. The pointer notch on the side card stays as a CSS pseudo-element (it's pure visual decoration with no semantic meaning, no test target, and CSS is the right tool).

### Lens 4: ship the feature, not the refactor — split the PR

- **PR 1 (this plan):** Build the 3 composables + the helper + the v3 nav. Refactor `useQuickAdd` (one consumer) to validate the composables.
- **PR 2 (follow-up, separate plan):** Refactor `BaseModal` and `MobileHamburgerMenu` to consume `useEscapeClose` + `useBodyScrollLock`. Single-purpose cleanup PR; modal regression risk isolated.

This is strictly better for sustainability than bundling: smaller PRs are easier to review and revert; PR 2 can wait without blocking the v3 ship.

### Lens 5: accessibility in v1

ARIA, focus management, focus trap baked in. Specifics in the dedicated section.

### Lens 6: explicit state machine — narrowed types

`openCategoryId: Ref<StackableCategoryId | null>` where `type StackableCategoryId = 'planning' | 'money' | 'pod'`. The type system enforces "Nook is a leaf, never opens". All transitions in this table; tested explicitly:

| From   | Event                                          | To         | Side effect                                                                                       |
| ------ | ---------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------- |
| `null` | tap Nook                                       | `null`     | `router.push('/nook')`                                                                            |
| `null` | tap stackable category                         | `<id>`     | open stack                                                                                        |
| `<id>` | tap same category tab                          | `null`     | close; focus → trigger                                                                            |
| `<id>` | tap **different** stackable category           | `<new-id>` | swap (component stays mounted; props update reactively; **single back-gesture marker preserved**) |
| `<id>` | tap Nook                                       | `null`     | close; `router.push('/nook')`                                                                     |
| `<id>` | tap stack item bean                            | `null`     | close; `router.push(beanPath)`                                                                    |
| `<id>` | Esc / scrim / back-gesture                     | `null`     | close; focus → trigger                                                                            |
| `<id>` | route changes (any reason)                     | `null`     | close                                                                                             |
| `<id>` | `canViewFinances` flips false while Money open | `null`     | close; `console.info`                                                                             |

The "swap" case is explicit and tested — the stack component is `v-if`'d on `openCategoryId !== null`, so swapping keeps `isOpen=true` and the component stays mounted. The back-gesture composable's marker is keyed on `isOpen` flips, not on prop changes, so a single marker spans the swap.

### Lens 7: `isRouteActive` pure helper — kill an existing duplication, with edge-case guard

Current inlined pattern lives in `MobileBottomNav.vue:21` and `AppSidebar.vue:68–71`. Extract to `isRouteActive(currentPath, itemPath)` in `src/utils/route.ts`. **Guards**: empty inputs return `false`; `itemPath === '/'` only matches exact `/` (avoids the `'/anything'.startsWith('/')` over-match trap).

### Lens 8: single-source `mobileCategory` field on NAV_ITEMS

`NavItemDef` and `NavSubItemDef` get an optional `mobileCategory?: MobileCategoryId` (JSDoc-documented). Items without it don't appear on mobile (Settings, Help — intentional). `MOBILE_NAV_CATEGORIES` is a **derived** export (pure groupBy with explicit ordering: Nook, Planning, Money, Pod) — not a parallel constant. Adding a route is a one-line change in `NAV_ITEMS`; tagging it with `mobileCategory` makes it appear on mobile.

A small unit test asserts every category has ≥1 item — catches typos and refactoring regressions at test time.

---

## Pattern law (locked, not violated)

| Surface          | Pattern                           | Distinguisher                   |
| ---------------- | --------------------------------- | ------------------------------- |
| Quick Add (FAB)  | cluster bloom (3-col grid)        | `+` seal on every bean          |
| Nav (bottom bar) | pure stack (1 column, side cards) | no `+` seal; active bean ringed |

Zero shared CSS classes between FAB and nav surfaces.

---

## Accessibility plan

| Element                      | ARIA / behavior                                                                                                                                                                                                                                                                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Each category tab `<button>` | descriptive `aria-label` (emoji-only is not enough); `aria-haspopup="menu"` for tabs with children; `aria-expanded="true\|false"` mirroring stack-open state; `aria-controls="<stack-id>"`                                                                                                                                                |
| The stack                    | `<nav role="menu" :id="stackId" aria-labelledby="<trigger-tab-id>">`                                                                                                                                                                                                                                                                      |
| Each bean inside             | `<button role="menuitem" :aria-current="isActive ? 'page' : undefined">`                                                                                                                                                                                                                                                                  |
| Hint text                    | inside the same `<button>` so screen readers read label + hint as one item                                                                                                                                                                                                                                                                |
| Focus on open                | first focusable is the active route's bean if any; else the bottom bean                                                                                                                                                                                                                                                                   |
| Focus on close               | parent restores focus to the trigger tab (parent owns the `<button>` ref)                                                                                                                                                                                                                                                                 |
| Focus trap                   | While open, Tab cycles within `[trigger tab, ...beans, scrim]`. **Decision at implementation start:** if `BaseModal` already has trap logic, extract to `useFocusTrap(rootRef, isOpen)` and consume in both. Otherwise, inline a small ~15-line trap in the stack and revisit when a third consumer appears (avoid premature extraction). |
| Reduced motion               | `@media (prefers-reduced-motion: reduce)` block sets `opacity: 1; transform: none;` so stagger animation skips cleanly without leaving items invisible                                                                                                                                                                                    |

A11y assertions (in unit tests): `aria-expanded` toggles, `aria-current="page"` lands on active bean, focus calls happen on open and close. Tab traversal / focus trap are validated by **manual VoiceOver smoke** on iOS Safari (Step 7) — JSDOM doesn't simulate Tab cycling reliably.

---

## CIG conformance (mockup vs CIG — CIG always wins)

| Mockup                                    | App implementation                                                  | Reason                                  |
| ----------------------------------------- | ------------------------------------------------------------------- | --------------------------------------- |
| `--cream` / `--page-bg` warm kraft        | `bg-white` / `bg-slate-900` (existing nav surface, untouched)       | CIG: Cloud White `#F8F9FA`              |
| `13px` / `10.5px` / `11px` (custom px)    | `text-sm` (14px label), `text-xs` (12px hint), `text-xs` (12px tab) | Skill: Tailwind only; min 12px          |
| Custom shadow tokens                      | Existing project shadows                                            | No new primitives                       |
| Heritage Orange ring + tinted active fill | `ring-2 ring-primary-500` + `bg-[rgba(241,93,34,0.08)]`             | Matches `MobileBottomNav.vue:44`        |
| Hint typeface: Inter (Greg's pick)        | `font-inter`                                                        | Functional descriptor                   |
| Pointer notch (Greg's pick)               | Pure CSS rotated square 8×8, border matches card                    | Pure decoration, pseudo-element OK here |
| Spring ease                               | `cubic-bezier(0.34, 1.56, 0.64, 1)` (already in QuickAddSheet)      | Reuse                                   |

---

## Reuse audit

| Need                      | Reuse from                                                                                                                                                                                                                                            | Path                                                                                           |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Body scroll lock          | `lockBodyScroll` / `unlockBodyScroll` (ref-counted)                                                                                                                                                                                                   | `src/utils/overlayStack.ts` (wrapped by `useBodyScrollLock`)                                   |
| Esc handler pattern       | inline keydown listener                                                                                                                                                                                                                               | reference: `BaseModal.vue:63–67` (extracted into `useEscapeClose`)                             |
| Back-gesture pattern      | history.pushState + popstate + marker key                                                                                                                                                                                                             | reference: `useQuickAdd.ts:40–105` (extracted into `useBackGestureClose`, with re-entry guard) |
| Scrim/backdrop styling    | `bg-black/50` Tailwind div, click-to-close                                                                                                                                                                                                            | reference: `BaseModal.vue:106`                                                                 |
| Stagger animation pattern | CSS `--stagger-delay` + spring ease                                                                                                                                                                                                                   | reference: `QuickAddSheet.vue:171, 359–360`                                                    |
| Active-route check        | inlined in `MobileBottomNav.vue:21`, `AppSidebar.vue:68–71`                                                                                                                                                                                           | extracted into `isRouteActive`; both call sites refactored                                     |
| Permission filter         | `usePermissions` + `FINANCE_ROUTES`                                                                                                                                                                                                                   | already used at `MobileBottomNav.vue:5–6, 15–17`                                               |
| Translation lookup        | `useTranslation()`                                                                                                                                                                                                                                    | `src/composables/useTranslation.ts`                                                            |
| Stack-item label strings  | existing `nav.activities`, `nav.todo`, `nav.travel`, `nav.overview`, `nav.accounts`, `nav.budgets`, `nav.transactions`, `nav.goals`, `nav.assets`, `nav.pod.meetBeans`, `nav.pod.scrapbook`, `nav.pod.cookbook`, `nav.pod.safety`, `nav.pod.contacts` | `src/services/translation/uiStrings.ts`                                                        |
| Tab labels                | existing `mobile.nook`, `mobile.pod`; new `mobile.planning`, `mobile.money`                                                                                                                                                                           | `uiStrings.ts`                                                                                 |
| Focus trap                | TBD at implementation — extract to `useFocusTrap` if `BaseModal` already has it                                                                                                                                                                       | `BaseModal.vue`                                                                                |

**New strings only:**

- 2 tab labels: `mobile.planning`, `mobile.money`
- 14 hint keys: `mobileNav.hint.activities`, `.todo`, `.travel`, `.overview`, `.accounts`, `.budgets`, `.transactions`, `.goals`, `.assets`, `.meetBeans`, `.scrapbook`, `.cookbook`, `.safety`, `.contacts`
- All paired (en + beanie)

**Dead keys removed (after grep confirms zero consumers):** `mobile.todo`, `mobile.activities`, `mobile.travel`, `mobile.piggyBank`.

---

## Files affected

### Created

- `src/composables/useEscapeClose.ts` + test
- `src/composables/useBodyScrollLock.ts` + test
- `src/composables/useBackGestureClose.ts` + test
- (Optional) `src/composables/useFocusTrap.ts` + test — only if extracting from `BaseModal`
- `src/utils/route.ts` + test (`isRouteActive`)
- `src/components/common/MobileNavBeanStack.vue` + test

### Modified (this PR)

- `src/components/common/MobileBottomNav.vue` — full rewrite (4-tab shell; `openCategoryId: StackableCategoryId | null`; `getAnchor` getter to stack)
- `src/components/common/__tests__/MobileBottomNav.test.ts` — adapt + state-machine assertions
- `src/components/common/AppSidebar.vue` — replace inline active-route check with `isRouteActive` import
- `src/composables/useQuickAdd.ts` — refactor to consume `useEscapeClose` + `useBodyScrollLock` + `useBackGestureClose`
- `src/constants/navigation.ts` — add `mobileCategory` field; export derived `MOBILE_NAV_CATEGORIES`; remove `MOBILE_TAB_ITEMS`
- `src/constants/__tests__/navigation.test.ts` (new or extended) — assert every category has ≥1 item
- `src/services/translation/uiStrings.ts` — add 2 + 14 keys; remove 4 dead `mobile.*` keys
- `src/services/translation/zh.json` — regenerated by `npm run translate`

### Untouched (deferred to PR 2)

- `src/components/ui/BaseModal.vue`
- `src/components/common/MobileHamburgerMenu.vue`

### Untouched (out of scope)

- `src/components/common/QuickAddFab.vue`, `QuickAddSheet.vue`, `QuickAddPicker.vue`
- All page templates

---

## Implementation steps (incremental commits, in order)

### Step 1 — `useEscapeClose` + `useBodyScrollLock` + `useBackGestureClose`

1. Each in its own file, ~15–25 lines. JSDoc on each export documenting usage + failure modes. Every potentially-failing path wrapped in try/catch with `[<composable>]`-prefixed `console.warn`. **`onScopeDispose` safety net** ensures cleanup even if the watch never fires the close path.
2. `useBackGestureClose` specifics:
   - Each instance generates a unique marker (`crypto.randomUUID()` or counter).
   - On `pushState`, set `event.state = { ...currentState, _beanieOverlayMarker: <key> }`.
   - On `popstate`, only call `onClose` if our key is in `event.state?._beanieOverlayMarker` matching.
   - On programmatic close: if marker is still on stack, set `pendingProgrammaticBack = true`, call `history.back()`. The next `popstate` sees the flag, clears it, and skips `onClose` (the close has already happened).
3. Tests cover: open/close lifecycle, Esc handling (and ignoring non-Esc keys), scroll-lock ref-counting across nested overlays, scroll-lock-on-unmount safety, back-gesture marker push/pop, marker-key collision avoidance with multiple instances, programmatic-back re-entry guard, `history.pushState` throws → degraded silently with warn, `document.body.style` mutation throws → degraded with warn, listener cleanup on unmount via `onScopeDispose`.
4. Refactor `useQuickAdd.ts` to consume all three. Run FAB test suite.
5. Commit: `refactor(overlay): three single-purpose composables for Esc, scroll-lock, back-gesture`.

### Step 2 — `isRouteActive` helper

1. `src/utils/route.ts`: pure function with explicit guards (empty inputs return false; root path `/` only matches `/`).
2. JSDoc with examples.
3. Tests: exact match, child match (`/accounts/123` matches `/accounts`), non-match, empty inputs, root path edge case, trailing slash (`/accounts/` vs `/accounts`).
4. Refactor `AppSidebar.vue:68–71`.
5. Commit: `refactor(nav): extract isRouteActive helper`.

### Step 3 — `mobileCategory` field on NAV_ITEMS

1. Define `type MobileCategoryId = 'nook' | 'planning' | 'money' | 'pod'` and `type StackableCategoryId = Exclude<MobileCategoryId, 'nook'>`.
2. Extend `NavItemDef` and `NavSubItemDef` with optional `mobileCategory?: MobileCategoryId`. JSDoc documents intent.
3. Tag each route in `NAV_ITEMS`:
   - `nav.nook` → `nook`
   - `nav.activities`, `nav.todo`, `nav.travel` → `planning`
   - `nav.overview`, `nav.accounts`, `nav.budgets`, `nav.transactions`, `nav.goals`, `nav.assets` → `money`
   - `nav.pod` and its 5 children → `pod`
4. Export `MOBILE_NAV_CATEGORIES` as derived (groupBy with explicit ordering: Nook, Planning, Money, Pod). Stack item shape: `{ path, labelKey, emoji, hintKey }`. Hint keys mapped from path → `mobileNav.hint.<short>` via a small switch or table; module load throws on unknown route, catching typos at boot/test.
5. Grep-confirm `MOBILE_TAB_ITEMS` has no other consumer. Remove.
6. Add unit test: `MOBILE_NAV_CATEGORIES` has all 4 categories, each with ≥1 item; total stack items count = 14.
7. Commit: `refactor(nav): single-source mobile categories from NAV_ITEMS`.

### Step 4 — Translation keys

1. Add 2 + 14 keys to `uiStrings.ts` (en + beanie pairs). Hint copy locked from the mockup.
2. Grep-confirm zero consumers of the 4 dead `mobile.*` keys. Remove.
3. `npm run translate` regenerates `zh.json`.
4. Commit: `feat(i18n): mobile nav v3 strings`.

### Step 5 — `MobileNavBeanStack.vue` + test

1. Props (above), JSDoc on the component, `<script setup lang="ts">`.
2. Internally:
   - `useEscapeClose(toRef(props, 'isOpen'), () => emit('close'))`
   - `useBodyScrollLock(toRef(props, 'isOpen'))`
   - `useBackGestureClose(toRef(props, 'isOpen'), () => emit('close'))`
   - Side computed via `getAnchor()`. Resize listener registered inside `watch(isOpen, (v) => v ? add : remove)`, with `onScopeDispose` safety. Listener body uses `requestAnimationFrame` to coalesce rapid resize events.
   - Defensive: if `getAnchor()` returns null or zero-sized rect, `requestAnimationFrame` retry once; if still bad, default `side: 'right'` and `console.warn('[MobileNavBeanStack] anchor unavailable, defaulting side')`.
   - Active item via `isRouteActive(route.path, item.path)` → adds `is-current` class, sets `aria-current="page"`.
   - Focus management: on `isOpen=true`, `nextTick` then focus the active item or the bottom bean. (Parent owns trigger restore.)
3. Template uses Tailwind utilities for layout/colors. Scoped `<style>` for: side-flip absolute positioning, pointer notch (pseudo-element), stagger animation (`--stagger-delay` + spring ease), reduced-motion block.
4. Permission filter (defensive layer): `category.items.filter(item => canViewFinances || !FINANCE_ROUTES.includes(item.path))`.
5. Tests cover: 14 items render across categories; tap navigates (emit); Esc closes (emit); backdrop closes (emit); back-gesture closes (composable mocked); active item gets `is-current` + `aria-current="page"`; side-flip class for left-half rect; side-flip class for right-half rect; anchor returns null → defaults right + warn; permission revoked filters Money items; focus moves to active bean on open; ARIA attrs correct on stack and items.
6. Commit: `feat(nav): MobileNavBeanStack with side cards`.

### Step 6 — `MobileBottomNav.vue` rewrite + test

1. Rewrite as 4-tab shell. Use derived `MOBILE_NAV_CATEGORIES`. Filter Money via `canViewFinances`. Each tab is a `<button>` with `aria-label`, `aria-haspopup="menu"` (category tabs), `aria-expanded`, `aria-controls`. Active dot is a real `<span class="dot">`.
2. State: `openCategoryId: Ref<StackableCategoryId | null>`. `tabRefs: Record<MobileCategoryId, HTMLButtonElement | null>`. The active tab element is computed: `() => openCategoryId.value ? tabRefs[openCategoryId.value] : null`.
3. Tap handlers per the state machine table.
4. `watch(route.path)`, `watch(canViewFinances)` close the stack as documented.
5. Focus restore on close: `nextTick` then `tabRefs[lastOpenCategoryId]?.focus()`.
6. Renders `<MobileNavBeanStack :get-anchor="getActiveAnchor" :category="openCategory" :is-open="!!openCategoryId" v-if="openCategoryId" />` — but **note**: with v-if, the stack unmounts on close. To keep a single back-gesture marker through swap, use `v-if="!!openCategoryId"` (truthy across swap) — which keeps the component mounted during swap. Confirmed via test: swap planning→money → marker remains a single entry on history.
7. Tests cover: 4 tabs render; finance-disabled drops Money (3 tabs); Nook tap → push, no stack; tap stackable category → openCategoryId set; same-tap closes; different-tap swaps **and stack stays mounted with single back-gesture marker** (mock `pushState`); stack item bean → close + push; route change closes; canViewFinances false closes Money + console.info; nested-route activates parent tab via isRouteActive; rect snapshot is read fresh on each side-flip update; ARIA attrs correct; focus restored on close.
8. Commit: `feat(nav): mobile bottom nav v3 — 4-tab shell with bean stack`.

### Step 7 — Manual verification

1. `npm run dev`, mobile DevTools at 375×667 and 414×896.
2. Walk every row of the state machine table.
3. Toggle `prefers-reduced-motion: reduce` → animations skip; items visible.
4. Dark mode toggle.
5. Hamburger menu still works (untouched).
6. One BaseModal flow (Add Member modal) still works (untouched).
7. Quick Add FAB still works — back-gesture closes, Esc closes, scroll-lock works (refactor verification).
8. **VoiceOver smoke on iOS Safari**: tab labels read, expanded state announced, Tab cycles within stack, focus moves correctly.

---

## Error handling enumeration — every failure path explicit

All log to `console.warn` with `[<component>]` or `[<composable>]` prefix; no `catch {}` anywhere; user-facing surfaces (toast or visual fallback) for failures the user could feel.

| Where                   | Failure                                                 | Handling                                                                                                                                                                                       |
| ----------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useEscapeClose`        | `addEventListener` / `removeEventListener` throws       | try/catch; warn; on cleanup-fail swallow + warn                                                                                                                                                |
| `useBodyScrollLock`     | `document.body.style` throws (sandboxed iframe)         | try/catch in `lockBodyScroll`/`unlockBodyScroll` calls; warn `[useBodyScrollLock] unavailable, scroll may bleed`; degrade — page may scroll under overlay (visible to user, app keeps working) |
| `useBackGestureClose`   | `history.pushState` throws                              | try/catch; warn `[useBackGestureClose] unavailable, falling back to Esc/scrim`; degrade                                                                                                        |
| `useBackGestureClose`   | `popstate` from non-overlay navigation                  | check `event.state?._beanieOverlayMarker === <ourKey>` before closing; ignore otherwise                                                                                                        |
| `useBackGestureClose`   | Programmatic `history.back()` triggers our own popstate | `pendingProgrammaticBack` flag set before `history.back()`; first popstate while flag is true is ignored, flag cleared                                                                         |
| `useBackGestureClose`   | Multiple overlays concurrently                          | unique marker per instance; tested                                                                                                                                                             |
| Any composable          | Component unmounts unexpectedly                         | `onScopeDispose` safety net cleans listeners and releases scroll-lock                                                                                                                          |
| `MobileNavBeanStack`    | `getAnchor()` returns null / 0×0                        | `requestAnimationFrame` retry once; if still bad, default `side: 'right'`; `console.warn('[MobileNavBeanStack] anchor unavailable, defaulting side')`                                          |
| `MobileNavBeanStack`    | Translation key missing                                 | `useTranslation` returns the key string in dev; user sees the key (visible bug, not silent)                                                                                                    |
| `MobileNavBeanStack`    | Reduced motion + `animation-fill-mode: backwards`       | `@media (prefers-reduced-motion: reduce)` block resets `opacity: 1; transform: none;` — items render immediately                                                                               |
| `MobileNavBeanStack`    | Focus call on unattached / unfocusable element          | `nextTick` then defensive `?.focus()`; warn if no focus target                                                                                                                                 |
| `MobileNavBeanStack`    | iOS Safari aggressive resize                            | rAF-throttled listener — at most one update per frame                                                                                                                                          |
| `MobileBottomNav`       | `canViewFinances` flips false with Money open           | `watch(canViewFinances)` closes stack + `console.info`                                                                                                                                         |
| `MobileBottomNav`       | Route change while stack open                           | `watch(() => route.path, () => closeStack())`                                                                                                                                                  |
| `MobileBottomNav`       | User on a route NOT in any category                     | no tab active; tested                                                                                                                                                                          |
| `MobileBottomNav`       | Tab ref null when stack-open requested                  | guard: warn + return; user sees no stack open — fail-safe                                                                                                                                      |
| `MobileBottomNav`       | Focus restore target gone                               | defensive `?.focus()`; no crash                                                                                                                                                                |
| `isRouteActive`         | Empty/null inputs, root path `/`, trailing slashes      | tested explicitly                                                                                                                                                                              |
| `MOBILE_NAV_CATEGORIES` | Module load with unknown path                           | throws at module load; caught by import-time test; impossible to ship                                                                                                                          |
| `MOBILE_NAV_CATEGORIES` | Category empty after groupBy                            | unit test asserts ≥1 item per category; impossible to ship                                                                                                                                     |

---

## Verification

### Unit tests

```bash
npm run test:unit -- src/composables/__tests__/useEscapeClose.test.ts
npm run test:unit -- src/composables/__tests__/useBodyScrollLock.test.ts
npm run test:unit -- src/composables/__tests__/useBackGestureClose.test.ts
npm run test:unit -- src/utils/__tests__/route.test.ts
npm run test:unit -- src/constants/__tests__/navigation.test.ts
npm run test:unit -- src/components/common/__tests__/MobileBottomNav.test.ts
npm run test:unit -- src/components/common/__tests__/MobileNavBeanStack.test.ts
npm run test:unit  # full suite green
```

Expected: 1675 → ~1715 (3 composables + helper + nav-constants + 2 components, ~5–10 tests each).

### Type/lint

```bash
npm run type-check
npm run lint
```

### E2E

```bash
npx playwright test --project=chromium
```

**Existing E2E specs do not depend on bottom-tab structure** — they navigate via direct URL or the sidebar (audit confirmed). They should pass unchanged. Per ADR-007, this work does NOT add new E2E tests:

- The bottom nav is UI-only; no data writes.
- Three-Gate Filter: (1) breakage is annoying not data-losing; (2) unit tests cover the integration; (3) stagger animations would force `waitForTimeout` — flaky.
- Budget cap is 25; the existing 14 are at the right level.

Any unexpected E2E failure logged to `docs/E2E_HEALTH.md`.

### Manual mobile smoke (Step 7) — non-skippable

### Accessibility verification (non-skippable)

- Unit-asserted: `aria-expanded` toggles, `aria-current="page"` on active bean, focus calls fire on open / close.
- Manual VoiceOver smoke on iOS Safari (JSDOM doesn't simulate Tab cycling reliably).

### CIG conformance

- All font sizes are standard Tailwind (`text-sm`, `text-xs`).
- All colors are brand tokens (Heritage Orange, Cloud White, Deep Slate).
- No `text-[X.Xrem]` custom sizes.
- Animations honor `prefers-reduced-motion`.

---

## Open questions / explicit deferrals

- **GitHub issue:** Recommend filing one at start of implementation with labels `enhancement`, `priority: medium`, `area: ui`, `area: navigation` (new label OK).
- **`+N More` overflow popover:** Deferred to v1.1.
- **`BaseModal` + `MobileHamburgerMenu` refactor:** PR 2 (separate plan).
- **`useFocusTrap` extraction:** Decided at implementation start — extract if `BaseModal` already has the logic; otherwise inline in stack and revisit on third consumer.
- **Hint copy:** Locked from the mockup as drafted.
