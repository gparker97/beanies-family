# Plan: Family To-Do sort — Due-date default, persisted preference, discoverable dropdown control

> Date: 2026-05-25
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-05-25-todo-sort-default-persist-discoverable.md`

> **No GitHub issue created.** This plan was approved for direct implementation. Full prompt history is in the **Prompt Log** below.

## User Story

As a family member managing the shared to-do list, I want it sorted by due date by default — with a clear, persistent way to switch the order — so the most time-sensitive tasks sit at the top and my preferred ordering sticks across visits.

## Context

The Family To-Do page (`src/pages/FamilyTodoPage.vue`) already has a sort control, but: (1) it defaults to `'newest'` (created date desc, `sortBy = ref<TodoSort>('newest')` at line 33); (2) it's a subtle native `<select>` top-right with a 50%-opacity "Sort:" label (lines 184-196) that users (incl. the product owner) don't notice; (3) the choice resets on every reload/navigation. The "Due date" sort already exists and already does earliest-first with undated items at the bottom (`applySorting()` case `'dueDate'`, lines 90-96). greg confirmed three changes: default → Due date; persist the user's pick; make the control more discoverable. The discoverable design is "Treatment B" (labeled icon-led dropdown button + popover) from `docs/mockups/todo-sort-control-2026-05-25.html`.

**Scope discipline:** greg scoped this as a SMALL change. This plan changes exactly the sort control on one page plus its supporting util/composable, and removes one orphaned file. It does NOT introduce a new shared UI primitive, and does NOT migrate any existing component.

Verified (Pass 2 + 3 + 4):

- `src/components/todo/FilterBar.vue` is dead: the only consumer is the line-17 type import in `FamilyTodoPage.vue`; `TodoFilter` has zero consumers; no barrel/index re-export exists.
- i18n keys `todo.sort.newest|oldest|dueDate` + `todo.sortLabel` ("Sort:") already exist in `src/services/translation/uiStrings.ts` with both `en` + `beanie` variants. **There is no `zh.json`** — this app's UI strings live in `uiStrings.ts`. No new strings; no `npm run translate`.
- No shared `useLocalStorage` helper; per-feature local localStorage in the `beanies:` namespace is the convention (`notice.ts` guards read AND write with try/catch; `useSidebarAccordion` guards reads but not writes — we follow the stricter `notice.ts` pattern).
- `useEscapeClose.ts` exists and is robust (attaches only while open, `onScopeDispose` safety net, try/catch around add/remove).
- `AssigneePickerButton.vue` lives in **`src/components/ui/`** (its test in `src/components/ui/__tests__/`). It is the canonical source for the `positionPopover` block we copy.
- `TodoItem.dueDate` is `ISODateString` (date-only "no time"), with a SEPARATE `dueTime?: string` (HH:mm) field. dueDate values are always `YYYY-MM-DD` — never datetime — so string `localeCompare` is correct and faithful; no `Date` parsing needed or wanted.
- Test env is `happy-dom`; `getBoundingClientRect` returns zeros and must be stubbed in component tests (per `AssigneePickerButton.test.ts`). Teardown is `unmount()`.
- 5 components duplicate the teleport-popover idiom; consolidating them is out of scope.

## Pass 3 scope decision: no new `BasePopoverMenu` primitive

Pass 2 proposed extracting a generic `BasePopoverMenu.vue`; Pass 3 reversed it because a shared primitive with a single consumer is premature abstraction and creates a half-migrated state (5 of 6 popovers ignoring it). Chosen path: a minimal bespoke `TodoSortMenu.vue` that reuses `useEscapeClose` and copies the proven `positionPopover` block from `src/components/ui/AssigneePickerButton.vue`. The 6-way consolidation is recorded as an explicit out-of-scope follow-up. Pass 4 confirms this decision stands.

## Requirements

1. Default sort = `'dueDate'` (earliest first; undated items at the bottom) when nothing is persisted.
2. Persist the user's selected sort across reloads/navigation, device-local (`localStorage`, `beanies:` namespace) — NOT family-shared.
3. Replace the subtle native `<select>` with Treatment B: a bordered, icon-led trigger button ("⇅ Sort: <current> ▾") that opens a popover of the 3 options (📅 Due date / ↓ Newest / ↑ Oldest); active option shows a check + Heritage-Orange tint.
4. Validate any persisted value against the allowed `TodoSort` set; fall back to `'dueDate'` on missing/invalid/corrupt — never crash, never fail silently (console warning).
5. Keep existing sort semantics unchanged: newest/oldest by `createdAt`; dueDate earliest-first with undated last. Comparators stay string `localeCompare` (dueDate is always date-only — do NOT introduce `Date` parsing).
6. Relocate the `TodoSort` type to `src/types/models.ts`; delete the orphaned `FilterBar.vue`.
7. i18n: reuse the existing keys in `uiStrings.ts`. No new strings; no `npm run translate`.
8. Accessibility: keyboard-operable + screen-reader-labeled (`aria-haspopup`, `aria-expanded`, roving focus / arrow keys, `role="menu"`/`menuitemradio` with `aria-checked`) — no regression vs the native `<select>`. Mirror the existing `role="menu"`/`menuitemradio` usage elsewhere in the app.

## Important Notes & Caveats

- Overdue PINNING is OUT of scope. Overdue items already get a red border + "Overdue" badge; under the new Due-date default they naturally rise to the top.
- Do NOT change the store's baseline sort (`byCreatedDesc`) — other consumers (`NookTodoWidget`, badges via `useNavBadges`) read store getters; the page-level sort is the only thing to change.
- Do NOT persist via `settingsStore`/Automerge (family-shared) — sort is personal device-local.
- Do NOT add the key to `storageKeys.ts` — that file is FOUC-bootstrap appearance prefs only (`TEXT_SIZE`, `THEME`).
- Someday lane items have no `dueDate` — under dueDate sort they sort among themselves (stable). Completed lane sorts by `completedAt`, unaffected.
- Beanie-mode discipline applies only if a NEW string is added — none needed.
- NO new shared UI primitive. The 5 existing teleport-popover components are NOT touched/migrated.
- `TodoSortMenu` must NOT keep an internal mirror copy of the selected value. It reads the `sortBy` prop directly for display and emits `update:sortBy` on change (fully controlled).

## Assumptions

1. Treatment B is the approved design.
2. `localStorage` may be unavailable (private mode/quota): guard read AND write, fall back to in-memory default, `console.warn`.
3. Sort applies only to `FamilyTodoPage`; `NookTodoWidget` unaffected.

## Approach

### 1. Pure comparator — `sortTodos` in `src/utils/todo.ts`

Add `export function sortTodos(items: TodoItem[], sort: TodoSort): TodoItem[]` beside `isTodoOverdue`/`isTodoDueToday`. Returns a NEW sorted array; preserves the EXACT current semantics from `applySorting`:

- `'newest'`: `b.createdAt.localeCompare(a.createdAt)`
- `'oldest'`: `a.createdAt.localeCompare(b.createdAt)`
- `'dueDate'`: both undated → `0`; only `a` undated → `1`; only `b` undated → `-1`; else `a.dueDate.localeCompare(b.dueDate)`
- `default`: return the copy unsorted

`Array.prototype.sort` is stable, so equal `createdAt` / equal `dueDate` / undated-vs-undated ties preserve input order — matching current behavior. Do not add a new tie-breaker. `TodoSort` imported from `@/types/models`.

### 2. Persisted preference — `src/composables/useTodoSort.ts`

Mirrors the `notice.ts` local-localStorage pattern (guard read AND write). Owns:

- `sortBy: Ref<TodoSort>`, initialized from `localStorage.getItem('beanies:todoSort')`, validated against the exported `TODO_SORTS` set, defaulting to `'dueDate'` on missing/invalid/corrupt/throw.
- A `watch(sortBy)` that writes through (single persistence path).
- Read AND write wrapped in try/catch; on failure `console.warn('[useTodoSort] …', err)` and continue with the in-memory value.
- Exports `SORT_OPTIONS` metadata (`value`, i18n `labelKey`, `icon`) as the single source of truth the menu renders from, plus `TODO_SORTS` (the readonly tuple used for validation).
- Per-call composable (no module-level singleton — one consumer).

### 3. Sort control — `src/components/todo/TodoSortMenu.vue` (self-contained, bespoke)

- Fully-controlled `v-model:sortBy` via explicit `defineProps` + `defineEmits('update:sortBy')` (repo convention; reads prop directly, no internal mirror ref).
- Open/positioning: `show` ref + `<Teleport to="body">` panel with `position:fixed` coords from a local `positionPopover()` copied from `src/components/ui/AssigneePickerButton.vue` (rect-based, drop-up flip, viewport clamp). Listeners (`scroll` capture + `resize`) added on mount, removed on unmount; reposition only while open. A `// TODO(consolidation)` comment marks the copied block.
- Esc: `useEscapeClose(show, () => (show.value = false))`.
- Click-outside: single `onDocClick` that early-returns when the click is inside the trigger `el` OR inside the teleported `popoverRef`.
- Trigger: orange-tinted ⇅ icon box, `font-outfit` semibold, "Sort:" (`todo.sortLabel`) + active label, chevron. `type="button"`, `aria-haspopup="menu"`, `aria-expanded` bound to `show`.
- Menu: `role="menu"`, rendered from `SORT_OPTIONS`; each item `type="button"` + `role="menuitemradio"` + `aria-checked`; hover; active = check + Heritage-Orange tint; select emits `update:sortBy` + closes.
- Keyboard: roving arrow-key focus (wrap at ends), Enter/Space select; focus to active item on open; Escape via `useEscapeClose`.

### 4. Wire-up — `src/pages/FamilyTodoPage.vue`

- Replace line 17 `import type { TodoSort } from '@/components/todo/FilterBar.vue'` → `import type { TodoSort } from '@/types/models'`.
- Add `import { useTodoSort } from '@/composables/useTodoSort'`, `import TodoSortMenu from '@/components/todo/TodoSortMenu.vue'`, `import { sortTodos } from '@/utils/todo'`.
- Replace `const sortBy = ref<TodoSort>('newest')` (line 33) with `const { sortBy } = useTodoSort()`.
- Delete inline `applySorting` (lines 83-100); `withMemberFilterAndSort` (line 59) calls `sortTodos(filtered, sortBy.value)`.
- Replace the header `<span>` + `<select>` (lines 184-196) with `<TodoSortMenu v-model:sortBy="sortBy" />` inside the existing `v-if="hasAnyTodos"` wrapper.

### 5. Type relocation + dead-code removal

- Move `export type TodoSort = 'newest' | 'oldest' | 'dueDate'` into `src/types/models.ts` (near `TodoItem`). `TodoFilter` dies with `FilterBar.vue`.
- Delete `src/components/todo/FilterBar.vue`.

### 6. Follow-up note (recorded, not actioned)

Record (this plan + a `// TODO(consolidation)` comment near the copied `positionPopover`) that 6 components now share the teleport popover idiom and should be unified in a dedicated future refactor designed against all 6 — out of scope here.

## Files Affected

- `src/types/models.ts` — add `TodoSort`
- `src/utils/todo.ts` — add `sortTodos()`
- `src/composables/useTodoSort.ts` — NEW (`useTodoSort`, `SORT_OPTIONS`, `TODO_SORTS`)
- `src/components/todo/TodoSortMenu.vue` — NEW
- `src/pages/FamilyTodoPage.vue` — composable + util + new control; remove inline select/`applySorting`/`sortBy` init; fix line-17 import
- `src/components/todo/FilterBar.vue` — DELETE
- `src/utils/__tests__/todo.test.ts` — add `sortTodos` tests
- `src/composables/__tests__/useTodoSort.test.ts` — NEW
- `src/components/todo/__tests__/TodoSortMenu.test.ts` — NEW
- NOT touched: `uiStrings.ts`, `storageKeys.ts`, `todoStore.ts`, `src/components/ui/index.ts`, all 5 existing teleport-popover components (incl. `AssigneePickerButton.vue`).

## Acceptance Criteria

- [ ] Fresh load, no stored pref → sort = Due date; control reads "Sort: Due date".
- [ ] Changing the sort persists; reload + navigate-away-and-back retain it.
- [ ] Invalid/corrupt/missing stored value → fall back to Due date; `console.warn`; no crash.
- [ ] `localStorage` read AND write throwing → fall back to in-memory default; warned; no crash.
- [ ] Control prominent, names current sort, opens 3-option menu, active shows check + orange tint.
- [ ] Popover NOT clipped on scroll (teleported + fixed, drop-up flip, viewport-clamped).
- [ ] Keyboard + SR operable: `aria-haspopup`/`aria-expanded`; `role="menu"` + `menuitemradio` + `aria-checked`; arrows wrap; Enter/Space; Escape; focus to active on open.
- [ ] Due-date sort = earliest first, undated last; newest/oldest by `createdAt` unchanged; ties preserve input order.
- [ ] `FilterBar.vue` deleted; `TodoSort` in `models.ts`; no dangling refs; type-check clean.
- [ ] No new shared UI primitive; the 5 existing popover components unchanged.
- [ ] Follow-up consolidation note present.
- [ ] Unit tests for `sortTodos` + `useTodoSort` + `TodoSortMenu` green; full suite green; lint/format/type-check/build clean.

## Testing Plan

1. Unit — `sortTodos`: each mode; undated-at-bottom; equal `dueDate`/`createdAt`/both-undated ties preserve input order; empty array; `default`/unknown returns unsorted copy; input not mutated.
2. Unit — `useTodoSort`: default `'dueDate'`; persist round-trip; invalid stored value → fallback + warn; `getItem` throws → fallback + warn; `setItem` throws → no crash + warn. Clear the key + mocks per test.
3. Component — `TodoSortMenu`: active label reflects prop; open/close; click-outside (incl. teleported-panel clicks don't close); Escape; select emits + closes; arrow roving focus wraps; `aria-checked`/`aria-expanded`. Mirror `AssigneePickerButton.test.ts` harness (`attachTo: document.body`, stub `getBoundingClientRect`, `unmount()`).
4. Manual — default; switch; reload + navigate persistence; dark mode; mobile width; keyboard-only; no clip on scroll.
5. `npm run validate`.

## Review Passes

- **Pass 1 (Initial draft)**: default-flip + device-local persisted `useTodoSort` + pure `sortTodos` + bespoke Treatment B menu + FilterBar cleanup + tests.
- **Pass 2 (DRY + error handling)**: confirmed FilterBar dead + `TodoSort`→`models.ts`; confirmed all 4 i18n keys exist (dropped the phantom new-string/`npm run translate` step); hardened localStorage read+write vs silent failure; reused `useEscapeClose`; proposed extracting a generic `BasePopoverMenu`; rejected `BaseSelect`/`BaseMultiSelect`/`BaseCombobox` reuse with reasons.
- **Pass 3 (Sustainability)**: reversed the `BasePopoverMenu` extraction (single-consumer premature abstraction / half-migrated trap); chose self-contained bespoke `TodoSortMenu` reusing `useEscapeClose` + copied positioning; recorded the 6-way consolidation as an explicit out-of-scope follow-up; kept the stricter write-guard.
- **Pass 4 (Fresh-eyes sweep)**: confirmed `v-model:sortBy` single-write (controlled, no mirror ref); date-only `dueDate` → string compare faithful (no `Date` parsing); stable-sort ties preserved (no new tie-breaker); safe FilterBar deletion; symmetric popover listeners (no SSR guard needed). Fixed doc errors (i18n in `uiStrings.ts` not `zh.json`; `AssigneePickerButton` under `components/ui/`); pinned a11y to existing `role=menu`/`menuitemradio` precedent + focus-to-active-on-open.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt

> Ok thanks - on another topic, would like to make a small change on the todo page. At the moment, I believe todo items are sorts purely based on when they were created, but I'm not sure - appareciate if you can confirm the logic by which we sort todo items today.
>
> Do we have any logic or capability to show "overdue" items at the top, or sort todo items based on when they are due?
>
> Te desired functionality on my side would be to provide an option for the user to sort todo items either by due date (with earliest at top and undated items at the bottom), or by create date (which i believe is the default order today).

### Follow-up 1 (AskUserQuestion — next step)

> Persist the choice, Make it more discoverable, Let's make 'due date' the default option, but persist other options if selected by the user

### Follow-up 2

> please load the /frontend-design:frontend-design skill to help with the design tweak for the sort dropdown

### Follow-up 3 (AskUserQuestion — sort control treatment)

> B — Dropdown button

### Follow-up 4

> pls implement

</details>
