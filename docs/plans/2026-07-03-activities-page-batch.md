# Plan: Activities-page batch — calendar nudge, double-plus fix, permission label, FAB gating

> Date: 2026-07-03
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-07-03-activities-page-batch.md`
> Mockup: `docs/mockups/2026-07-03-calendar-connect-nudge.html` (item A)

> **No GitHub issue created.** This plan was approved for direct implementation.

## User Story

As a family member using beanies.family, I want a gentle nudge to connect Google Calendar now that it's official, clearer permission wording, and an interface that doesn't show me controls I can't use — so the activities page feels polished and the app never dead-ends me.

## Context

Four small, related activities-page / permissions items, batched:

- **A. Calendar-connect nudge** — Google Calendar just became an official feature (2026-07-03). A quiet, dismissible banner on the activities page (below the calendar) should invite users who haven't connected yet. Design approved in `docs/mockups/2026-07-03-calendar-connect-nudge.html`.
- **B. Double-plus "Add Activity" button** — the planner's add button renders `＋ + Add Activity`. `AddEntityButton` always renders a `＋` (`AddEntityButton.vue:55`), and the label string `planner.addActivity` _also_ starts with `+ ` (`uiStrings.ts:5270`) → two plus signs. Regression.
- **C. Permission label wording** — the family-member edit modal's permission reads _"Can edit family content"_ (`modal.canEditActivities`, `uiStrings.ts:191`). Rename to _"Can edit family activities and plans"_ for clarity. Verified: `canEditActivities` already gates activities (planner), travel plans (`TravelPlansPage`), todos (`FamilyTodoPage`), cookbook, and the magic reader — so the new label is accurate with **no logic change**.
- **D. FAB shows an empty sheet for view-only members** — the global quick-add FAB (`QuickAddFab.vue`) is gated only by `route.meta.hideQuickAdd`. Every quick-add item requires either `'activities'` or `'finance'` permission (`QuickAddPermission = 'finance' | 'activities'`, no always-allowed items), so a member with neither gets a sheet that filters to zero items — blank except the close button. The FAB should hide when the member has no available quick-add option.

## Requirements

### A. Calendar-connect nudge (activities page)

1. A dismissible banner on `FamilyPlannerPage.vue`, in the **below-calendar footer zone** (near the inactive-activities toggle), **month view only**. Never above the calendar grid (the calendar butts flush against the sticky command bar by design).
2. **Gating — show only when ALL true:** `isFlagEnabled('googleCalendarSync')` (kill-switch) AND no calendar connected (`calendarSyncStore.connections.length === 0`) AND not dismissed. (No "≥1 activity" gate — greg confirmed show regardless.)
3. **"Connect"** action → navigate to Settings with the calendar drawer open: `router.push({ path: '/settings', query: { open: CALENDAR_SYNC_OPEN } })`. `CALENDAR_SYNC_OPEN = 'calendar-sync'` is exported from a **new standalone module `src/constants/settingsDeepLinks.ts`** (NOT from `SettingsPage.vue` — a `<script setup>` SFC only has a default export; a named `export const` there won't resolve and would fail the build, plus it'd drag the heavy page into the nudge). Both the nudge and `SettingsPage.cardOpenMap` import it. In `SettingsPage`, the `cardOpenMap` key must become a **computed key** `[CALENDAR_SYNC_OPEN]: () => { … }` (today it's the literal `'calendar-sync':`, `SettingsPage.vue:129`) — otherwise the shared constant doesn't actually protect against a rename. The deep-link works — Calendar is official.
4. **Dismiss (✕)** → persist dismissal so it doesn't return; connecting also permanently hides it (via the `connections.length` gate).
5. Style per mockup, clamped to CIG: Sky-Silk tint fill, single Heritage-Orange "Connect" action, squircle corners, Outfit title + Inter subtext, 📅+🫘 icon chip. All copy via `uiStrings.ts` (`en` + `beanie`); glyphs `aria-hidden`.
6. Respect reduced motion; responsive to mobile; visible keyboard focus on Connect + dismiss.

### B. Double-plus fix

7. Change `planner.addActivity` (`uiStrings.ts:5270`) from `'+ Add Activity'` / `'+ new activity'` to `'Add Activity'` / `'new activity'` (drop the leading `+ ` in both `en` and `beanie`). The `＋` comes from `AddEntityButton`.

### C. Permission label

8. Change `modal.canEditActivities` (`uiStrings.ts:191`) from `'Can edit family content'` / `'can edit family content'` to `'Can edit family activities and plans'` / `'can edit family activities and plans'`. No logic change (permission already covers activities, travel, todos).

### D. FAB gating

9. Hide `QuickAddFab` when the current member has **no** available quick-add option — i.e. when nothing would render in the sheet. `showFab` becomes `!route.meta.hideQuickAdd && hasAnyQuickAddOption`.
10. The availability check must **not drift** from the sheet's actual filter — derive both from one shared predicate.

## Important Notes & Caveats

- **Reuse `createPerMemberStore` for the nudge dismissal** (`useInstallNudge.ts` is the reference — same factory, `'pending' | 'dismissed'` status, `clearOnSignOut: true`, schema-versioned `fromParsed`). Do NOT hand-roll localStorage. Per-member (consistent with install nudge); the family-wide `connections` gate already hides it for everyone once connected.
- **Nudge placement respects the flush hero.** `FamilyPlannerPage.vue` comment (lines 654-657) is explicit: nothing above the calendar. Mount in the below-calendar block (the `mt-4` zone with the inactive-activities toggle), guarded by `activeView === 'month'`.
- **FAB predicate — the DRY core:** `QuickAddSheet.itemAllowed` (`QuickAddSheet.vue:44-51`) = `isItemFlagEnabled(item)` (from `@/constants/navigation`, the existing single home — line 12; already imported by the sheet at line 25, NOT local) + permission (`finance`→`canViewFinances`, `activities`→`canEditActivities`) + the caller `allowedActions` filter. Extract the **flag + permission** part into `useQuickAddAvailability` and have BOTH the sheet and the FAB consume it (see Approach D) so there's exactly one copy of the mapping.
- **Do not gate the FAB on `canEditActivities` alone** — a finance-only member can still add transactions. The correct gate is "any option", which via `QuickAddPermission = 'finance' | 'activities'` reduces to `canEditActivities || canViewFinances` **modulo item flags** — hence derive from the items, not a hardcoded OR, so a future flag-gated-off group is handled correctly.
- **i18n**: new nudge strings need `en` + `beanie`; run `npm run translate` and spot-check `zh`. B and C are edits to existing keys (their `zh` will re-translate — spot-check).
- **`planner.addActivity` is an `aria-label`** on `AddEntityButton` (`:aria-label="label"`) as well as the visible label — dropping the `+` improves the screen-reader name too ("Add Activity", not "+ Add Activity"). Good.
- Beanie-mode casing: nudge `en` sentence case, `beanie` lowercase.

## Assumptions

> **Review before implementation.**

1. `googleCalendarSync` remains committed `true` (kill-switch); the nudge and its "Connect" deep-link assume Calendar is the official feature shipped 2026-07-03.
2. `calendarSyncStore.connections` is populated/reactive on the planner page (the sync engine starts in `App.vue:433`). Because `connections` returns `[]` while `!isDocLoaded()` (`calendarSyncStore.ts:215-219`), the `showNudge` gate includes `isDocLoaded()` so an already-connected family never flashes the banner on a cold load (Pass 3 — the guard is one token; cheaper than a documented wart).
3. Every quick-add item has a `requiredPermission` of `'finance'` or `'activities'` (verified: `QuickAddPermission` has exactly those two members). If an always-allowed item is ever added, the items-derived FAB check still works (that item makes `hasAnyQuickAddOption` true).
4. `modal.canEditActivities`'s scope (activities/travel/todos/cookbook) is unchanged — this is a label-only edit.

## Approach

### A. Calendar-connect nudge

**New composable `src/composables/useCalendarNudge.ts`** (clone `useInstallNudge` shape):

- `createPerMemberStore<CalendarNudgeState>({ prefix: 'bean-calendar-nudge', label: 'useCalendarNudge', saveSurface: 'calendar-nudge-save', saveMessage: 'localStorage write failed for calendar-nudge', empty, fromParsed, clearOnSignOut: true })` — `saveSurface`/`saveMessage` are REQUIRED factory fields. `status: 'pending' | 'dismissed'`, schema-versioned (drop `useInstallNudge`'s `shownAt`).
- Exposes a computed `showNudge` = `isDocLoaded()` (import from `@/services/automerge/docService`) AND `isFlagEnabled('googleCalendarSync')` AND `syncStore.connections.length === 0` AND `state.status === 'pending'`. The `isDocLoaded()` guard prevents an already-connected family from flashing the banner before the doc hydrates (`connections` is `[]` while unloaded). Plus a `dismiss()` that sets `state.value = { …, status: 'dismissed' }` in-memory (hides the nudge immediately regardless of the write) **and** calls `store.save(next)`. On a write failure `writePerMemberState` already `console.warn`s + `reportError`s at `warning` (`perMemberStore.ts:83-92`); the only consequence is the nudge returning after a reload — self-correcting, non-destructive, so no rollback/toast (unlike the foreground `useCommunityNudge` contract). **Not a silent failure.**
- **Call `store.useMemberSync()` inside the composable** (as `useInstallNudge.ts:72` does) — required, else `state` never loads or swaps per member.

**New component `src/components/planner/CalendarConnectNudge.vue`**:

- Self-contained; reads `useCalendarNudge()`; renders nothing when `!showNudge`.
- Template: Sky-Silk squircle banner, 📅+🫘 icon chip, Outfit title + Inter subtext (via `t()`), Heritage-Orange "Connect" button, ✕ dismiss. Connect → `router.push({ path: '/settings', query: { open: 'calendar-sync' } }).catch((err) => reportError({ surface: 'calendar-nudge-connect', message: 'calendar-nudge Connect navigation failed', error: err, severity: 'warning' }))` (matches the `useQuickAdd.navigateToIntent` catch convention at `useQuickAdd.ts:252-254` — `router.push` rejects on aborted/redirected nav; unhandled = silent). ✕ → `dismiss()`.
- New i18n keys: `planner.calendarNudge.title`, `.subtitle`, `.connect`, `.dismiss` (aria-label) — `en` + `beanie`.

**Mount** in `FamilyPlannerPage.vue` in the below-calendar block, `v-if="activeView === 'month'"` (the component self-hides on its own gate too; the `month` guard keeps it out of week/day views). Place near the inactive-activities `<div class="mt-4">`.

### B. Double-plus

One-line edit to `planner.addActivity` (drop `+ `). No component change.

### C. Permission label

One-line edit to `modal.canEditActivities`. No logic change.

### D. FAB gating (shared predicate — no drift)

- **New composable `useQuickAddAvailability()`** — MUST be a per-call composable (NOT a computed on `useQuickAdd`, which is a deliberate module-scope singleton with no Pinia context; `usePermissions()` needs an active component/Pinia setup, so it must run in each consumer's `setup`). It calls `usePermissions()` once and exposes:
  - `itemAllowedForMember(item)` = `isItemFlagEnabled(item) && PERMISSION_GATE[item.requiredPermission].value`, where `PERMISSION_GATE: Record<QuickAddPermission, Ref<boolean>> = { finance: canViewFinances, activities: canEditActivities }`. **Use the exhaustive `Record` keyed by the union, NOT a ternary/if-chain** — a future third `QuickAddPermission` value then becomes a compile error (fail-closed) instead of silently mapping to `canEditActivities` or falling through to `true` (the current `QuickAddSheet.vue:44-51` if-chain's unsafe default).
  - `hasAnyQuickAddOption = computed(() => QUICK_ADD_ITEMS.some(itemAllowedForMember))`
  - Imports: `QUICK_ADD_ITEMS` from `@/constants/quickAddItems`, `isItemFlagEnabled` from `@/constants/navigation` (its existing single home — imported today by `QuickAddSheet.vue:25`; do NOT move it), `usePermissions`. It does NOT import `useQuickAdd`, so no import cycle.
- **Refactor `QuickAddSheet`** to consume the composable: `itemAllowed(item)` becomes `itemAllowedForMember(item) && (!allowedActions.value || allowedActions.value.includes(item.action))`, and **remove** the sheet's own `const { canViewFinances, canEditActivities } = usePermissions()` (`QuickAddSheet.vue:31`) + the inline flag/permission mapping (`:44-51`) — now sourced from the composable. One predicate, the sheet layers only its caller-filter. **Scope:** ONLY the flag/permission lines + the local permission read move; the sheet's `showSection`/`pickerAfter`/inline-picker/`allowedByGroup` logic is untouched. The predicate-equivalence test (see Tests) pins this as behavior-preserving.
- `QuickAddFab.showFab` = `computed(() => !route.meta.hideQuickAdd && hasAnyQuickAddOption.value)` (calls `useQuickAddAvailability()` in setup).

## Files Affected

- `src/composables/useCalendarNudge.ts` — **new** (clones `useInstallNudge` via `createPerMemberStore`).
- `src/components/planner/CalendarConnectNudge.vue` — **new** banner.
- `src/pages/FamilyPlannerPage.vue` — mount the nudge (below-calendar, month view).
- `src/composables/useQuickAddAvailability.ts` — **new** per-call composable exposing `hasAnyQuickAddOption` + the shared `itemAllowedForMember` predicate (owns the `usePermissions()` read).
- `src/components/common/QuickAddSheet.vue` — `itemAllowed` reuses the shared predicate.
- `src/components/common/QuickAddFab.vue` — `showFab` also gates on `hasAnyQuickAddOption`.
- `src/constants/settingsDeepLinks.ts` — **new**; `export const CALENDAR_SYNC_OPEN = 'calendar-sync'`. Imported by the nudge + `SettingsPage.vue` (whose `cardOpenMap` key becomes `[CALENDAR_SYNC_OPEN]`).
- `src/pages/SettingsPage.vue` — `cardOpenMap` uses the computed `[CALENDAR_SYNC_OPEN]` key (import the constant).
- `src/services/translation/uiStrings.ts` — new `planner.calendarNudge.*` keys; edit `planner.addActivity` (B) + `modal.canEditActivities` (C).
- `public/translations/zh.json` — regenerate via `npm run translate`; spot-check new + re-translated keys.
- `docs/mockups/2026-07-03-calendar-connect-nudge.html` — approved mockup (record).
- Tests: `useCalendarNudge` unit test; `QuickAddFab` visibility test (hidden when no option); `useQuickAddAvailability` test; `CalendarConnectNudge` render/gate test; **`QuickAddSheet` predicate-equivalence test** (assert the refactored `itemAllowed` returns identical results to the old flag+permission+filter combination across all `QUICK_ADD_ITEMS` × permission combos — pins the refactor as behavior-preserving).
- Shared constant `CALENDAR_SYNC_OPEN` (item A.3) — new standalone module `src/constants/settingsDeepLinks.ts`, imported by the nudge + `SettingsPage` (computed `cardOpenMap` key).

**Commit strategy:** land as **separate commits per item** (A nudge, D FAB gating, B string, C string) — never one squash. A and D each add real behavior/a composable; per-item commits keep `git bisect`/revert meaningful (a bad D reverts alone without dragging A/B/C). B and C touch distinct `uiStrings.ts` keys from A's new keys, so they stay clean apart.

## Acceptance Criteria

- [ ] **A:** On the planner (month view), a member with `googleCalendarSync` on and no connected calendar sees the nudge below the calendar. "Connect" opens Settings → Google Calendar drawer. ✕ dismisses it and it stays gone (persisted). Once a calendar is connected, the nudge disappears for everyone. Never shows in week/day view or above the grid.
- [ ] **B:** The planner add button reads a single `＋ Add Activity` (no double plus); screen-reader name is "Add Activity".
- [ ] **C:** The family-member edit modal permission reads "Can edit family activities and plans"; editing activities, travel plans, and todos all still respect that one permission.
- [ ] **D:** A member with neither activities nor finance permission sees **no** FAB. A member with only finance (or only activities) still sees the FAB, and the sheet shows exactly their allowed items. The sheet's filtering is unchanged for everyone else.
- [ ] i18n: all new strings via `t()` (`en` + `beanie`); `npm run translate` clean; `zh` spot-checked. Lint (incl. `vue/no-bare-strings`), type-check, stylelint, unit tests, `build` all green.
- [ ] No `text-[Xpx]` / `font-size: Npx`; reduced-motion + keyboard focus honored on the nudge.

## Testing Plan

1. `npm run dev` — planner month view: verify the nudge shows under the gates, "Connect" deep-links to the calendar drawer, ✕ persists dismissal (reload → still gone), and connecting a calendar hides it. Confirm it's absent in week/day view.
2. Add button: confirm a single plus in the planner (and check the other `AddEntityButton` callers — BeanieLists, Cookbook — are unaffected since only the string changed).
3. Family-member edit modal: confirm the new permission label; toggle it off for a test member and confirm activities/travel/todos become view-only for them.
4. FAB: as a view-only member (no activities, no finance) → FAB hidden. As finance-only → FAB shows with money items only. As activities-only → FAB shows with the rest. As owner → unchanged.
5. `npm run translate` → new keys added; `zh` spot-checked (nudge + re-translated B/C).
6. `npm run test && npm run type-check && npm run lint && npm run build`.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the 4-item batch — calendar nudge (new composable via `createPerMemberStore` + banner, gated + below-calendar), double-plus string fix, permission-label rename (verified scope), and FAB hide-when-no-option via a shared quick-add availability predicate.
- **Pass 2 (DRY + error handling)**: Made `useQuickAddAvailability` a mandatory per-call composable (the `useQuickAdd` module-singleton can't call `usePermissions()`); folded `QuickAddSheet`'s own permission read + flag/perm mapping onto the composable so there's one predicate; corrected `isItemFlagEnabled`'s home to `@/constants/navigation` (no move); added a `.catch(reportError)` to the nudge "Connect" `router.push` (rejects on aborted nav) and specified the dismiss as in-memory-commit + `store.save` with the factory's warning-level reporting (not silent); required `store.useMemberSync()`; recorded the one-frame connected-family nudge-flash as an accepted decision.
- **Pass 3 (Sustainability)**: Switched the FAB predicate to an exhaustive `Record<QuickAddPermission, Ref<boolean>>` (fail-closed — a new permission becomes a compile error, not a silent allow); flipped the connected-family nudge flash to a real `isDocLoaded()` guard (cheaper than a documented wart); shared the `CALENDAR_SYNC_OPEN` deep-link constant between the nudge + SettingsPage (kills stringly-typed drift); added a `QuickAddSheet` predicate-equivalence test + scoped the refactor to the flag/permission lines only; mandated separate per-item commits (A/D/B/C) for revert/bisect safety. Nudge composable+component structure confirmed sound (not over-engineered).
- **Pass 4 (Fresh-eyes sweep)**: Fixed a build-breaker — `CALENDAR_SYNC_OPEN` can't be exported from the `SettingsPage` `<script setup>` SFC; pinned it to a new standalone `src/constants/settingsDeepLinks.ts` and specified `SettingsPage.cardOpenMap` uses the computed `[CALENDAR_SYNC_OPEN]` key. Verified all other load-bearing claims against source: `isDocLoaded` exported (`docService.ts:160`), `QUICK_ADD_ITEMS` exported, planner mount point correct, no import cycle, `requiredPermission` non-optional so the `Record` lookup is safe, emoji-in-template lint-clean. Implementation-ready.

## Prompt Log

> No GitHub issue created — direct implementation.

<details>
<summary>Full prompt history</summary>

### Initial Prompt (frontend-design skill invoked)

> given the google calendar feature is official now - should we also add a small element / hint tip on the activities page encouraging users to link their google calendar? would it make sense to fit this in somewhere noticeable but not to intrusive?

### Follow-up 1 (nudge design decisions)

> 1. below calendar banner is ok
> 2. ok to show this regardless, no need to wait for an activity to be created

### Follow-up 2 (added three more items)

> at the same time, let's address a couple other small items:
>
> - on the activities page, the "+ + new activity" button is showing two plus signs again, i thought we had fixed this before
> - on the family member edit modal, under permissions, update the text "can edit family content" to "can edit family activities and plans" which should make it more clear - ensure this should also allow the user to edit travel plans and todos as needed
> - if the user has no permission to edit family content/activities the FAB is still showing (but it's blank when you open it except for a close button) -> if the user does not have access to edit or add family activities, should we hide the FAB button?

### Follow-up 3 (proceed)

> [invoked /beanies-plan] for all 4 items

</details>
