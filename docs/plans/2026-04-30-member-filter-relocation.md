# Plan: Relocate the global member filter to per-page chip filters

## Context

The global member filter (`<MemberFilterDropdown>` in `AppHeader.vue` desktop, mirrored in `MobileHamburgerMenu.vue` mobile) is a finance-era artifact. Three observations made by greg + verified by audit:

1. **The filter is global UI but local effect.** It's only read by three pages — Accounts, Transactions, and the Family Planner (Activities). Every other page (Dashboard, Pod, Nook, Goals, Assets, Recurring) renders the global control but never reads its state, so clicks change the store but produce no visible result. That's the bulk of the "click does nothing" UX symptom.
2. **There's a real silent-failure bug too.** `MemberFilterDropdown.vue`'s `selectedIds` setter (lines 19–28) calls `memberFilterStore.toggleMember(member.id)` but never checks the return value. The store correctly returns `false` to enforce its `min-selection: 1` rule, but the dropdown's UI completes its v-model write silently — visual state desyncs from store state. Because we're deleting the dropdown, this becomes moot; but the same risk would re-appear on the chip path if the composable doesn't guard against it explicitly.
3. **The mobile sidebar's filter is display-only** (`MobileHamburgerMenu.vue` lines 113-121 — it shows a label of the current filter state but doesn't include the chip/dropdown UI). Removing it is purely cosmetic.

The goal is to drop the global UI slot (frees space for the upcoming notifications surface), put the chip filter inline on the three pages that actually consume it, share state across them so a "filter to wife" carries between Accounts and Transactions, and bake the no-silent-failure UX rule into a single composable so the chip path never repeats the dropdown's bug.

## Approach

### 1. New composable — `src/composables/useMemberFilterChips.ts`

Single source of truth for chip-filter wiring. Used by all 3 consumer pages.

**Sustainability principles applied:**

- **Flat control flow.** `onSelectMember` uses early returns, not nested ifs. Three cases, three guard clauses, no else-chains.
- **No hidden coupling.** Composable depends only on `useMemberFilterStore` + `useFamilyStore`. No props, no parent assumptions, no global state outside Pinia.
- **Both `isAllActive` and `isFiltered` exposed** even though they're inversions. Templates read more naturally: `<MemberChipFilter :is-all-active>` (matches prop name) and `<p v-if="isFiltered">` (positive read). Forcing one consumer to invert with `!` would optimize the composable surface at the cost of every caller's clarity.
- **Documented "deselect-last → un-filter" rule** with code comment that names the bug being prevented (the dropdown's silent setter), so a future maintainer doesn't simplify it back into a single `toggleMember` call and resurrect the bug.

```ts
import { computed } from 'vue';
import { useMemberFilterStore } from '@/stores/memberFilterStore';
import { useFamilyStore } from '@/stores/familyStore';

export function useMemberFilterChips() {
  const memberFilterStore = useMemberFilterStore();
  const familyStore = useFamilyStore();

  const isAllActive = computed(() => memberFilterStore.isAllSelected);
  const isFiltered = computed(() => !memberFilterStore.isAllSelected);

  // Match the existing planner template's isMemberActive rule: when "all" is
  // selected, no individual chip should appear active — only the "All" chip
  // does. Without the `!isAllSelected` clamp, every chip would render as
  // selected at once when the user is in the "all" state, which reads as
  // "everything is filtered" instead of "no filter applied".
  const isMemberActive = (id: string) =>
    memberFilterStore.isMemberSelected(id) && !memberFilterStore.isAllSelected;

  function onSelectAll() {
    if (!memberFilterStore.isAllSelected) memberFilterStore.selectAll();
  }

  function onSelectMember(id: string) {
    // Case 1: from "all" → narrow to one member. Matches planner's existing
    // UX (one click switches the filter from broad to focused).
    if (memberFilterStore.isAllSelected) {
      memberFilterStore.selectOnly(id);
      return;
    }

    // Case 2: deselecting the last-remaining selected member.
    // The store enforces min-selection: 1 (returning false from toggleMember
    // when the user tries to remove the last entry). The deleted
    // MemberFilterDropdown.vue had a silent-failure bug here: its v-model
    // setter ignored that return, so the UI desynced from the store. We
    // replace that broken interaction with the intuitive un-filter: clicking
    // the only-selected member's chip reverts the filter to "all". DO NOT
    // collapse this into a plain toggleMember call without revisiting the
    // min-selection contract — see docs/plans/2026-04-30-member-filter-relocation.md.
    const onlyOneSelected =
      memberFilterStore.isMemberSelected(id) && memberFilterStore.selectedMemberIds.size === 1;
    if (onlyOneSelected) {
      memberFilterStore.selectAll();
      return;
    }

    // Case 3: ordinary toggle inside a partial selection. The store should
    // never refuse here given the case-2 guard, but we log instead of going
    // silent if it ever does (e.g. a future store-rule change we missed).
    const ok = memberFilterStore.toggleMember(id);
    if (!ok) {
      console.warn(
        `[useMemberFilterChips] toggleMember(${id}) refused unexpectedly — store min-selection rule may have changed`
      );
    }
  }

  const activeMemberNames = computed(() =>
    familyStore.humans
      .filter((m) => memberFilterStore.isMemberSelected(m.id) && !memberFilterStore.isAllSelected)
      .map((m) => m.name)
  );

  return {
    isAllActive,
    isFiltered,
    isMemberActive,
    onSelectAll,
    onSelectMember,
    activeMemberNames,
  };
}
```

**Coupling note (intentional):** the composable reads `memberFilterStore.selectedMemberIds.size` directly. This is already public API of the store (used by `MemberFilterDropdown.vue` today). If the store ever changes its internal Set → Array → other shape, this needs to be revisited — but `Set.size` is idiomatic Pinia state, not a leaky private; the alternative (adding a `selectedCount` getter for one consumer) is over-fitting.

### 2. Refactor `FamilyPlannerPage.vue` first (DRY proof)

Delete the inline helpers (lines 81–96 — `toggleAllMembers`, `toggleMember`, `activeMemberNames`). Pull from the composable. The mobile button label at lines 443-445 keeps reading `activeMemberNames` (now from the composable). Visible UI unchanged. This proves the abstraction before adding two new consumers.

### 3. Add chip filter + "Filtered to: X" line to `AccountsPage.vue` and `TransactionsPage.vue`

**Placement:**

- AccountsPage: between line 412 (after the subtitle) and line 414 (Hero section). Same horizontal rhythm as the existing "Group By" toggle on this page.
- TransactionsPage: between line 872 (Secondary toolbar) and line 874 (summary cards). Sits in the page's existing "secondary toolbar region" with the type toggle, search, and direction filters.

**Markup (identical on both pages):**

```vue
<script setup>
import MemberChipFilter from '@/components/common/MemberChipFilter.vue';
import { useMemberFilterChips } from '@/composables/useMemberFilterChips';
const { isAllActive, isMemberActive, onSelectAll, onSelectMember, activeMemberNames, isFiltered } =
  useMemberFilterChips();
</script>

<template>
  <!-- ... existing page header ... -->

  <div class="mt-3">
    <MemberChipFilter
      :is-all-active="isAllActive"
      :is-member-active="isMemberActive"
      @select-all="onSelectAll"
      @select-member="onSelectMember"
    />
    <p v-if="isFiltered" class="text-secondary-500/70 mt-1 text-xs">
      {{ t('filter.filteredTo', { names: activeMemberNames.join(', ') }) }}
    </p>
  </div>

  <!-- ... existing content (already reads filteredAccounts / filteredTransactions) ... -->
</template>
```

**No new component** for the "Filtered to" line. Inline single-line `<p>` because:

- The clear-filter affordance is the "All" chip immediately above it (no need for a "× clear" X-button — would duplicate the chip's role).
- TransactionsPage's existing per-filter chip pattern (lines 933–1008) is for click-to-clear filter pills (account, goal, direction). Different purpose, different shape — extracting a "shared pill" would force two visual modes.

`accountsStore.filteredAccounts` and `transactionsStore.filteredTransactions` already consume `useMemberFilterStore` via `createMemberFiltered`. **Zero plumbing changes** in stores.

### 4. Remove the global filter UI

**`AppHeader.vue`:**

- Delete `<MemberFilterDropdown />` element (line 472)
- Remove the `MemberFilterDropdown` import (line 4)
- Remove the `useMemberFilterStore` import + assignment if only used here (line 24) — verify with grep first
- Verify the header layout still looks balanced without the dropdown's slot

**`MobileHamburgerMenu.vue`:**

- Delete the filter-display block + its `useMemberFilterStore` / `useFamilyStore` imports if only used here (lines 113-121 and surrounding)
- Verify the drawer's vertical rhythm doesn't have orphan padding

### 5. Delete `MemberFilterDropdown.vue`

After step 4, run `grep -rn "MemberFilterDropdown" src/` — should be zero hits. **Delete the file outright (141 lines).** Don't leave dead code "just in case" — the file carries the silent-failure bug noted in Context, and leaving it tempts re-use. Clean removal closes the bug source permanently.

### 6. i18n

One new key in `src/services/translation/uiStrings.ts`:

```ts
'filter.filteredTo': {
  en: 'Filtered to: {names}',
  beanie: 'filtered to: {names}',
},
```

Run `npm run translate` to regenerate `public/translations/zh.json`. Manually verify the Chinese rendering for the "filtered to" phrase before declaring done — the auto-translator has produced odd renderings before (e.g. the "travel segment" → "旅行细分市场" miss).

### 7. Tests

**Unit (`src/composables/__tests__/useMemberFilterChips.test.ts` — new file):**

1. `isAllActive` reflects `isAllSelected`.
2. `isFiltered` is `!isAllSelected`.
3. `isMemberActive(id)` returns true only when the member is selected AND filter is partial (the `!isAllSelected` clamp).
4. `isMemberActive(id)` returns false for a member id that doesn't exist (defensive — store's `isMemberSelected` returns false for unknown ids).
5. `onSelectAll` is a no-op when already all-selected; otherwise calls `selectAll()`.
6. `onSelectMember` from "all" → calls `selectOnly(id)`.
7. `onSelectMember` from a partial set with this member as the only selection → calls `selectAll()` (the deselect-last → un-filter rule). **The fix for the dropdown's silent-failure bug.**
8. `onSelectMember` from a partial set when this member is one of several → calls `toggleMember(id)`.
9. `onSelectMember` logs `[useMemberFilterChips]` warn if `toggleMember` returns false despite the pre-check (defensive — proves we never go silent).
10. `activeMemberNames` is empty when all-selected; lists names when partial.
11. Reactivity smoke: mutating the store (e.g. `selectOnly`) updates `isFiltered` and `activeMemberNames` synchronously in the same tick.
12. Empty-family edge case: with `familyStore.humans = []`, all returns are sensible (no throws).

**Existing tests stay green** — `memberFilterStore.test.ts` (covers the store's state machine end-to-end, 12 scenarios per audit) and the store-level `accountsStore` / `transactionsStore` filter tests don't change.

**Page-level component tests skipped** — heavy mock burden vs low marginal value. The composable test + dev smoke is the right level for this scope.

### Files affected

**Modified:**

- `src/components/common/AppHeader.vue` — remove dropdown + imports
- `src/components/common/MobileHamburgerMenu.vue` — remove display block + imports if unused
- `src/pages/AccountsPage.vue` — add chip row + "Filtered to" line below subtitle
- `src/pages/TransactionsPage.vue` — add chip row + "Filtered to" line in secondary toolbar
- `src/pages/FamilyPlannerPage.vue` — refactor inline helpers to use composable
- `src/services/translation/uiStrings.ts` — 1 new key
- `public/translations/zh.json` — regenerated via `npm run translate`

**Created:**

- `src/composables/useMemberFilterChips.ts`
- `src/composables/__tests__/useMemberFilterChips.test.ts`

**Deleted:**

- `src/components/common/MemberFilterDropdown.vue` (141 lines, dead after step 4)

### Reused unchanged

- `src/components/common/MemberChipFilter.vue` — already presentation-only, contract fits perfectly
- `src/stores/memberFilterStore.ts` — store's API is correct; all consumers go through it
- `src/composables/useMemberFiltered.ts` — `createMemberFiltered` factory is the data-side filter, used by `accountsStore` and `transactionsStore`; complements (not replaces) the new UI composable

### Open question (surface to greg before implementation)

**FamilyScrapbookPage** also reads `useMemberFilterStore` (per audit, line 1 of section "Pages with tests"). It wasn't on greg's "filter to: activities, accounts, transactions" list. Three options for how it behaves after this change:

- **(a) Status quo:** scrapbook silently inherits whatever filter is set on the 3 visible-filter pages. Simplest, lowest risk, matches the cross-page-state-share UX. Downside: the user wouldn't see why scrapbook is filtered.
- **(b) Add chip filter:** consistent with Accounts/Transactions. Downside: greg said "no" to including it.
- **(c) Decouple scrapbook from the filter:** ignore the global filter, always show all members' content. Downside: a behavior change that the user didn't ask for.

**Recommendation:** (a) — status quo. Scrapbook keeps reading the filter (one-line behavior, already wired). Users who scope to "wife" on Accounts will see only her scrapbook moments too, which is consistent with how the filter was originally meant to work. If this surprises anyone, surfacing a "Filtered to:" line on scrapbook is a one-line fix later. Confirm with greg before implementing.

### Sustainability follow-ups (not blockers)

- **"Filtered to: X, Y, Z" can wrap awkwardly** when 5+ members are selected. CSS `truncate` + a tooltip is the obvious fix if it surfaces in practice. Don't pre-engineer.
- **Three pages will inline the same `<p v-if="isFiltered">` snippet** (~5 lines each). If a 4th page ever adopts the chip filter, extract a `<MemberFilterStatusLine>` component then. Inlining now is simpler than extracting prophylactically; the duplication is small enough that finding/updating all instances is trivial.
- **The composable is `useMemberFilterChips`, not `useFilterChips<T>`.** Generic filter-chip composables exist in many codebases; ours doesn't need one yet. If category-filter or status-filter chips emerge, generalize then — not before. (YAGNI per project rules.)

### Implementation order

1. Build `useMemberFilterChips` composable + write all 12 unit tests. Verify in isolation.
2. Refactor `FamilyPlannerPage.vue` to use the composable. Visible UI unchanged. Confirms the abstraction works end-to-end before duplicating it.
3. Add `filter.filteredTo` i18n key; `npm run translate`; manually verify Chinese output is sensible (edit zh.json if not — same hash-preservation behavior we used for travel-segment strings).
4. Add chip filter + "Filtered to" line to `AccountsPage.vue`. Dev smoke.
5. Add chip filter + "Filtered to" line to `TransactionsPage.vue`. Dev smoke.
6. Remove `<MemberFilterDropdown />` from `AppHeader.vue`.
7. Remove the filter display block from `MobileHamburgerMenu.vue`.
8. `grep -rn "MemberFilterDropdown" src/` — confirm zero references; delete the file.
9. Final verification: `npm run type-check && npm run lint`; full unit suite green; dev smoke (Accounts narrows, Transactions narrows, Planner unchanged, "deselect last" → un-filters cleanly, header clean, drawer clean, beanie + zh render correctly).

Each step is independently shippable. After step 1 the composable exists but is unused. After step 2 the planner is the proof point. After step 5 the new UX is fully in place; steps 6-8 are pure removal.

## Verification

- **Type-check + lint clean** at every step.
- **Unit tests:** `npm run test:unit -- useMemberFilterChips` (9 cases pass); full suite stays green.
- **Translation pipeline:** `npm run translate` runs cleanly; `zh.json` for `filter.filteredTo` reads naturally (manually edit if not — same workflow as the travel-segment fix).
- **Dev smoke at `npm run dev`:**
  - **Accounts page:** click a member chip → list narrows to that member's accounts; "Filtered to: Alice" line appears below chips; click "All" → list returns to full and the line disappears.
  - **Transactions page:** click a member chip → transaction list + summary cards narrow; "Filtered to: Alice" line appears; click "All" → restored.
  - **Planner page:** chip filter still works exactly as before; mobile drawer's "X members" / "Alice" button label still reads correctly.
  - **Last-member deselect (was the silent-failure path):** filter on "Alice"; click Alice's chip → reverts to "All". No no-op, no broken-feeling click.
  - **Header (desktop):** no member filter where the dropdown used to be; layout looks clean.
  - **Hamburger drawer (mobile):** no orphan filter display section; spacing looks right.
  - **Beanie mode + Chinese:** chip labels and "filtered to" line render correctly.
- **Cross-page state share:** filter to "wife" on Accounts → navigate to Transactions → state preserved (same store), "Filtered to: wife" line shows on Transactions too. This is the desired UX.
- **Save plan to `docs/plans/2026-04-30-member-filter-relocation.md`** (already exists from earlier draft — update it to match this final version) before implementation begins.
