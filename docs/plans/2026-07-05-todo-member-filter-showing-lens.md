# Plan: Reframe the To-Do member filter as a labelled "Showing" view lens

> Date: 2026-07-05
> Related: docs/mockups/todo-filter-vs-assign-2026-07-05.html (approved Option A)

## Context

On the Family To-Do view (`/todo`) at tablet/desktop width, a flat row of member pills sits
directly below the quick-add bar (`FamilyTodoPage.vue` ~L174-200). It **filters** the list by
assignee, but multiple users read it as **"assign the task I just typed"** — because (1) it uses the
same colored member-chip language as the assignee picker, (2) it sits under the input like an option
row, and (3) it carries no label or lens cue. The app already has a documented filter idiom (header
stacked-avatar filter), which this row diverged from.

Fix (approved Option A): move filtering out of the add-bar zone into the page toolbar beside Sort,
and reframe it as an unmistakable, labelled **"Showing"** segmented view-lens. No data-model change;
the assignee picker stays the only thing that changes a task.

## Approach

**1. New component `src/components/todo/TodoMemberFilter.vue`** (fully-controlled, `v-model`)

- Props: `modelValue: string` (`'all'` or a memberId), `members: FamilyMember[]`.
- Emits: `update:modelValue`.
- Renders a muted uppercase **"Showing"** label + a segmented track (reusing the
  `TogglePillGroup` track idiom: `rounded-[14px] bg-[var(--tint-slate-5)] p-1`):
  - **Everyone** segment (text, `t('todo.filterEveryone')`) — active when `modelValue === 'all'`.
  - One segment per member — a `MemberChip size="dot"` (DRY: reuse, gives colored initial +
    `title`/`aria-label` = name, and skips orphaned IDs). Avatar full-colour when active, dimmed
    (`opacity-45 grayscale`) when inactive.
  - Active segment = raised (`bg-white dark:bg-slate-600 shadow-sm`), inactive = transparent/muted.
    Deliberately NOT a solid member-colour fill — that stays reserved for assignment, breaking the
    token collision.
  - Toggle: clicking a member emits its id; clicking the already-active member emits `'all'`
    (matches current behaviour). Everyone emits `'all'`.
- a11y: `role="group"` + `aria-label` = `t('todo.filterGroupLabel')`; each segment a native
  `<button>` with `aria-pressed`; member name exposed via `MemberChip`'s title/aria-label.
- Overflow safety for larger families: track is `flex-wrap`-free but `max-w-full overflow-x-auto`
  so 2-6 members (the target) never overflow at tablet+, and a big family scrolls rather than breaks.

**2. `FamilyTodoPage.vue`**

- Remove the flat pill row (L174-200) entirely.
- Restructure the header row so filter + sort are grouped on the right as sibling view controls:
  ```
  <div class="flex flex-wrap items-center justify-between gap-3">
    <PageWelcomeSubtitle :text="t('todo.subtitle')" />
    <div v-if="hasAnyTodos" class="flex flex-wrap items-center justify-end gap-2">
      <TodoMemberFilter v-if="sortedMembers.length > 1" v-model="memberFilter"
                        :members="sortedMembers" class="hidden sm:flex" />
      <TodoSortMenu v-model:sort-by="sortBy" />
    </div>
  </div>
  ```
- `memberFilter` ref + `withMemberFilterAndSort` + `displayedCompletedTodos` logic UNCHANGED.
- Preserve: filter hidden below `sm` (`hidden sm:flex`) → no new mobile filter; shown only when
  `sortedMembers.length > 1`.

**3. i18n (`uiStrings.ts` + zh)**

- `todo.showingLabel` → en `Showing` / beanie `showing`
- `todo.filterEveryone` → en `Everyone` / beanie `everyone`
- `todo.filterGroupLabel` → en `Filter to-dos by member` / beanie `filter to-dos by member`
- Run `npm run translate`; spot-check zh (per known MyMemory-noise lesson).

**4. Tests** — `src/components/todo/__tests__/TodoMemberFilter.test.ts`

- Renders an Everyone segment + one per member.
- Clicking a member emits its id; clicking the active member again emits `'all'`.
- `aria-pressed` reflects `modelValue`.
- (Filter _logic_ unchanged → existing `todoStore` tests still cover the actual filtering.)

## Edge cases

- Single-member family → filter hidden (`sortedMembers.length > 1`, preserved).
- Large family → track scrolls (`overflow-x-auto`); Option B dropdown remains a future fallback only
  if scrolling proves insufficient (deferred, per approved open-question resolution: wrap/scroll now).
- Dark mode + Large reading mode (rem-based, no fixed px) + keyboard/aria covered above.
- Orphaned assignee IDs → `MemberChip` renders nothing (existing behaviour); `sortedHumans` only
  yields live members anyway.

## Files affected

- **New:** `src/components/todo/TodoMemberFilter.vue`, `src/components/todo/__tests__/TodoMemberFilter.test.ts`
- **Edit:** `src/pages/FamilyTodoPage.vue`, `src/services/translation/uiStrings.ts`, `src/services/translation/locales/zh.json` (via `npm run translate`)
- **Record:** `CHANGELOG.md`
