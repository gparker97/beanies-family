# Plan: "Someday · Maybe" to-dos

> Date: 2026-05-12
> Related issues: None — direct implementation (per `/beanies-plan` default; full prompt log embedded below)
> Plan file (on approval, copy to): `docs/plans/2026-05-12-someday-maybe-todos.md`

## User Story

As a family member, I want to park a to-do as "someday / maybe" — something I'd _like_ to do eventually but am not committed to and may never get to — so it stays visible on the To-do page (so I don't lose the idea) but stops cluttering the active list and the Nook's "critical activities" briefing.

## Context

The To-do system today routes items by exactly two fields: `completed` (bool) and `dueDate` (optional). Every open to-do — dated or undated — is treated as a real commitment: it shows in the active list, the planner sidebar, the Nook "Family Todo" widget, and the "critical activities" toast. There's no place for GTD-style "someday / maybe" items. This adds a third lane — **active** (open, committed) / **someday · maybe** (open, parked) / **completed** — via one optional flag, a binary toggle in the to-do detail modal, a one-tap "move to someday / make active" affordance on the row, and a dedicated (always-visible) section on the To-do page. Someday items are excluded everywhere "things you're committed to" are listed.

User decisions captured during planning (see Prompt Log):

- A **separate "Someday · Maybe" section** on the To-do page, **visible by default** (not collapsed) — these items aren't completed, so they should be in plain sight just below the active list.
- Yes to a **"move to someday" / "move to active" affordance on the row**, provided the row stays uncrowded — so it goes in the existing **hover-revealed action group** (alongside ✏️ / 🗑️ in full mode), not as an always-visible control.
- The primary, always-available affordance is a **binary toggle in the to-do detail modal** (`TodoViewEditModal`).

## Reuse-first inventory (do NOT re-implement these)

| Need                                                                     | Reuse                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Notes                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Binary segmented toggle (`📋 To-do` / `💭 Someday · Maybe`) in the modal | **`src/components/ui/FrequencyChips.vue`** — already generic (`modelValue: string`, `options: { value, label, icon?, disabled? }[]`; emits `update:modelValue`; renders a rounded-pill flex row with selected styling) — used **directly**, no new component.                                                                                                                                                                                                                                     | `:model-value="todo.someday ? 'someday' : 'todo'"`, `:options="[{ value: 'todo', label: t('todo.kind.todo'), icon: '📋' }, { value: 'someday', label: t('todo.someday'), icon: '💭' }]"`, `@update:model-value="v => todoStore.setSomeday(todo.id, v === 'someday')"`. |
| Error handling for the someday toggle/move                               | `setSomeday` calls the existing `todoStore.updateTodo`, which goes through `wrapAsync` (`src/composables/useStoreActions.ts`) — on failure it sets `error`, **shows a user-facing toast**, and reports engine panics to Slack via `reportError`. No new error handling needed; the someday paths inherit the standard store-action error surface (i.e. **not** a silent-failure surface).                                                                                                         | `updateTodo` returning `null` for a non-existent id is the existing behaviour (the modal's inline-edit does the same — `if (updated) …`); not a new concern.                                                                                                           |
| Clearing `dueDate` / `dueTime` when going someday                        | Pass `undefined` for those keys to `updateTodo` — the Automerge repo (`automergeRepository.update()`) `delete`s keys explicitly set to `undefined` from the doc. (`null` gets stripped and leaves the key untouched.)                                                                                                                                                                                                                                                                             | `updateTodo(id, { someday: true, dueDate: undefined, dueTime: undefined })`.                                                                                                                                                                                           |
| Member filtering for new getters                                         | `filteredTodos` is already the member-filtered base (`createMemberFiltered(todos, (t) => normalizeAssignees(t))` from `useMemberFiltered.ts`) — derive `filteredActiveTodos` / `filteredSomedayTodos` from `filteredTodos.value` (mirroring `filteredOpenTodos`), no extra `createMemberFiltered` calls.                                                                                                                                                                                          |                                                                                                                                                                                                                                                                        |
| Sort comparators in `todoStore`                                          | Extract the repeated `(a,b) => b.createdAt.localeCompare(a.createdAt)` and the completed sort into `byCreatedDesc` / `byCompletedDesc` constants; use them everywhere — _less_ repetition than today, not more.                                                                                                                                                                                                                                                                                   |                                                                                                                                                                                                                                                                        |
| De-emphasised someday-row look                                           | Reuse the visual idiom already used by the completed-card branch of `TodoItemCard.vue` (`background: var(--tint-slate-5)`, reduced prominence) and the existing hover-action-button styling in `TodoItemRow.vue` (`h-8 w-8 rounded-[10px] text-sm opacity-40 hover:opacity-70` over `var(--tint-slate-5)`). No new tint tokens, no new component. Finalise the exact treatment against `.claude/skills/beanies-theme/SKILL.md`.                                                                   |                                                                                                                                                                                                                                                                        |
| The "filtered/sorted display list" computed in `FamilyTodoPage`          | Extract `withMemberFilterAndSort(items)` (page-local member filter + `applySorting`) used by both `displayedOpenTodos` and `displayedSomedayTodos` (identical).                                                                                                                                                                                                                                                                                                                                   | `displayedCompletedTodos` keeps its own filter (it also matches `completedBy`).                                                                                                                                                                                        |
| The repeated To-do section markup (Open / Someday / Completed)           | Extract a small page-private **`src/components/todo/TodoSection.vue`** — `label`, `labelClass`, `todos: TodoItem[]`, `collapsible?: boolean`, `collapsed?: boolean` (`v-model`); a `#hint` slot; re-emits `toggle` / `view` / `edit` / `delete` / `set-someday`; calls `useSyncHighlight()` internally for the per-row highlight. All three sections render through it. (A faithful lift of the existing markup — see the testing plan re: no regression to the current Open/Completed sections.) |                                                                                                                                                                                                                                                                        |

## Requirements

1. A to-do can be marked **"someday · maybe"** — an open, _deliberately unscheduled, no-commitment_ item. Marking it someday **clears its due date/time**; un-marking it makes it a plain undated open to-do.
2. Two ways to set/unset it: (a) a binary segmented toggle (`FrequencyChips`) in the to-do detail modal — `📋 To-do` / `💭 Someday · Maybe`; (b) a hover-revealed action button on the to-do row — "Move to Someday" on an active row, "Make active" on a someday row.
3. The To-do page gains a **"💭 Someday · Maybe" section**, between "Open Tasks" and "Completed", **always visible** (no collapse), with a count badge; it respects the page's member filter and sort; it's hidden entirely when empty. Someday rows render with a **de-emphasised treatment** (softer than active rows, a 💭 marker, no due-date pill, no overdue styling), reusing the completed-card's visual idiom.
4. Someday items are **excluded** from: the Nook "Family Todo" widget, the Nook "critical activities" toast, the planner sidebar to-do preview, the Nook "Today's Schedule / This Week" cards, and the planner calendar grid (a someday item has no due date anyway). They **remain** in: the To-do page's Someday section, and global search.
5. Completing a someday item moves it to "Completed"; reopening it returns it to "Someday · Maybe" (the flag persists through complete/reopen).
6. Backward-compatible — the new field is optional; existing to-dos are unaffected; no migration.
7. All new user-visible text via `uiStrings.ts` (`en` + `beanie`); the toggle/section styling follows the beanies design system; nothing fails silently.

## Architecture & maintainability notes

- **No getter explosion.** `openTodos` / `filteredOpenTodos` are **renamed** to `activeTodos` / `filteredActiveTodos` (now excluding `someday`); two new getters (`somedayTodos` / `filteredSomedayTodos`) are added; everything else stays. Net +2 getters, no dead code. (Migrating consumers is type-check-safe — a missed reference to the removed `openTodos` is a compile error.)
- **No deep template ternaries.** `TodoItemRow`'s container styling moves out of the nested `:class` ternary into a `containerClass` computed with early returns (someday → de-emphasised; overdue → red; compact → …; default → …) — easier to read and extend than cramming a 4th branch in. Same for any other ≥3-branch styling choice introduced here (e.g. the modal's status badge stays a flat `v-if`/`v-else-if`/`v-else`).
- **One place per concern.** The "clear the schedule when going someday" invariant lives only in `todoStore.setSomeday`. The someday-row visuals + the row affordance live only in `TodoItemRow`. The three To-do sections render through one `<TodoSection>`. The someday→excluded behaviour is one getter swap (`openTodos`→`activeTodos`) at each consumer.
- **One-way dependency edges, no cycles.** `setSomeday` → `updateTodo` (same store). `TodoItemRow` reads `todo.someday` directly (no prop drilling); `set-someday` flows `TodoItemRow` → `TodoItemCard` → `TodoSection` → `FamilyTodoPage` (the orchestrator) → `todoStore.setSomeday` — the same shape as the existing `toggle`/`edit`/`delete` flow. `TodoViewEditModal` calls `todoStore.setSomeday` directly (it already calls `updateTodo`/`toggleComplete`). `useCriticalItems` depends on `todoStore.activeTodos` (one line; same coupling it already had to `openTodos`).
- **Reliability.** Pure computeds (the getters) have no failure mode. The two write paths (`setSomeday`, `updateTodo` via the row/modal) reuse the `wrapAsync` toast path. The `<TodoSection>` / `containerClass` / `withMemberFilterAndSort` / `byCreatedDesc` extractions are pure presentational/functional — nothing new that can fail silently.

## Important Notes & Caveats

- **`someday` is a boolean, not an enum.** Genuinely binary right now (committed vs. parked). If GTD-style buckets are ever wanted, it becomes a small enum then — YAGNI for v1.
- **A someday item always has no `dueDate` / `dueTime`.** Enforced in one place (`setSomeday`). So `scheduledTodos` / `filteredScheduledTodos` (= `activeTodos.filter(t => t.dueDate)`) and the calendar grid never see someday items automatically.
- **The row affordance is full-mode + desktop only** (the existing ✏️/🗑️ hover group is `hidden … md:flex`). That's fine — someday items only ever appear on the To-do page (full `TodoItemCard` → full `TodoItemRow`), and the modal toggle is the universal/mobile path. Three hover buttons total — uncrowded, hover-only.
- **In the modal, when `todo.someday`:** the due-date `FormFieldGroup` is `v-if="!todo.someday"` (the due-time group already gates on `todo.dueDate`, so it auto-hides — add `&& !todo.someday` to it too for clarity); the status badge reads `💭 Someday · Maybe` in a soft style (a third flat `v-if` branch alongside Completed / Open).
- **`QuickAddBar` is not changed** — quick-add always creates an active to-do; you reclassify afterwards. (A "someday quick-add" in the section is a possible future touch, out of scope.)
- **No `todoStore.test.ts` exists yet** — this change adds one.

## Assumptions

> Review before implementation — valid at planning time (2026-05-12).

1. `TodoItem` (`src/types/models.ts`): `{ id, title, description?, assigneeId? (deprecated), assigneeIds?, dueDate?, dueTime?, completed, completedBy?, completedAt?, createdBy, createdAt, updatedAt }`; `CreateTodoInput` / `UpdateTodoInput` = `Omit` / `Partial<Omit<…>>`. No `priority` / `category` yet. `automergeRepository.update()` (the generic repo `todoRepository` wraps): `Object.assign`s the input over the doc entity + `delete`s keys explicitly `undefined` + ignores absent keys; `create()` strips `undefined`, sets `id`/`createdAt`/`updatedAt`, takes only `CreateInput` fields (so the new `someday?` must be on `TodoItem`).
2. `src/stores/todoStore.ts` exposes `todos`, `openTodos`, `completedTodos`, `scheduledTodos`, `undatedTodos`, `filteredTodos` (= `createMemberFiltered(todos, (t) => normalizeAssignees(t))`), `filteredOpenTodos`, `filteredCompletedTodos`, `filteredScheduledTodos`, `filteredUndatedTodos`, and actions `loadTodos`, `createTodo`, `updateTodo`, `deleteTodo`, `toggleComplete`, `resetState`. Open/active getters filter `!completed` + sort `createdAt` desc; completed getters sort `completedAt ?? updatedAt` desc; `scheduledTodos`/`undatedTodos` = `openTodos.filter(t => t.dueDate)` / `…(t => !t.dueDate)` (and filtered variants off `filteredOpenTodos`). Actions use `wrapAsync(isLoading, error, fn, { action })` which surfaces failures via toast + telemetry. `toggleComplete` does **not** touch any field other than `completed`/`completedBy`/`completedAt`.
3. `src/components/ui/FrequencyChips.vue` — generic segmented-chip control. `src/composables/useMemberFiltered.ts` `createMemberFiltered(items, getMemberIds) → ComputedRef<T[]>` (always includes items with no assigned members). `src/composables/useSyncHighlight.ts` `useSyncHighlight() → { syncHighlightClass(id) }` (used in `FamilyTodoPage` per-row today).
4. `src/pages/FamilyTodoPage.vue`: header + sort dropdown → `QuickAddBar` → empty state → desktop member-chip filter → "Open Tasks" section (`displayedOpenTodos` = `filteredOpenTodos` + page-local `memberFilter` + `applySorting`) → "Completed" section (collapsible via `showCompletedSection`, `displayedCompletedTodos` = `filteredCompletedTodos` + a member filter that also matches `completedBy`) → `TodoViewEditModal`. Sections use `class="nook-section-label …"` headers (`text-purple-500` open / `text-green-600` completed); rows are `TodoItemCard` wired `@toggle`/`@view`/`@edit`/`@delete`, each wrapped in `:class="syncHighlightClass(todo.id)"`. `applySorting` handles `newest`/`oldest`/`dueDate` (dueDate-sort puts undated last).
5. `src/components/todo/TodoItemCard.vue` renders a completed-card (`background: var(--tint-slate-5)`, reduced prominence, ↩️ undo) when `todo.completed`, else `<TodoItemRow>`; re-emits `toggle`/`view`/`edit`/`delete`. `src/components/todo/TodoItemRow.vue` (full mode) has a hover-revealed `hidden … md:flex` action group with ✏️ (`@edit`) + 🗑️ (`@delete`) buttons (`h-8 w-8 rounded-[10px] text-sm opacity-40 hover:opacity-70` over `var(--tint-slate-5)`); container `:class` is a nested ternary over `compact` / `isOverdue`; metadata row = a due-date badge chain (`formattedDate && isOverdue` / `formattedDate` / `!compact` "no date set") + assignee `MemberChip`s + "added N days ago"; the row is purely presentational (even `toggle` is emitted, not done in-row).
6. `src/components/todo/TodoViewEditModal.vue` is a `BeanieFormModal variant="drawer"` with a `space-y-3` body of `FormFieldGroup` + `InlineEditField` (inline-edit via `useInlineEdit`); fields: title, status badge (Open/Completed), due date (`BeanieDatePicker`, in a `FormFieldGroup`), due time (`TimePresetPicker`, `v-if="todo.dueDate || editingField === 'dueDate'"`), assignee (`FamilyChipPicker`), description, detected links; footer "Mark Completed"/"Reopen". The live `todo` is `computed(() => todoStore.todos.find(...))` so a store update re-renders it.
7. Surfaces that list open to-dos and must exclude someday items: `src/components/nook/NookTodoWidget.vue` (`filteredOpenTodos`), `src/components/planner/TodoPreview.vue` (`filteredOpenTodos`), `src/components/nook/ScheduleCards.vue` (`filteredOpenTodos`, then filtered by `dueDate`), `src/composables/useCriticalItems.ts` (iterates `todoStore.openTodos`, filters by current member, skips future-dated). The planner calendar views (`DailyCalendarView` / `WeeklyCalendarView` / `DayAgendaSidebar`) show to-dos with a `dueDate` — verify they use `filteredScheduledTodos` (now someday-excluding) or switch them to it. `RecentActivityCard.vue` (completed-only) + `GlobalSearch.vue` (searches all `todos`) — no change.

## Approach

### A. Data model

- **`src/types/models.ts`** — add to `TodoItem`: `someday?: boolean; // "someday / maybe" — an open, deliberately unscheduled, no-commitment item`. (Optional → no migration.)

### B. Store (`src/stores/todoStore.ts`)

- Extract `const byCreatedDesc = (a: TodoItem, b: TodoItem) => b.createdAt.localeCompare(a.createdAt)` and `const byCompletedDesc = (a, b) => (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt)`; use in all getters.
- **Rename** `openTodos` → `activeTodos` = `todos.value.filter(t => !t.completed && !t.someday).sort(byCreatedDesc)`; `filteredOpenTodos` → `filteredActiveTodos` = `filteredTodos.value.filter(t => !t.completed && !t.someday).sort(byCreatedDesc)`.
- Add `somedayTodos` = `todos.value.filter(t => !t.completed && t.someday).sort(byCreatedDesc)`; `filteredSomedayTodos` = `filteredTodos.value.filter(t => !t.completed && t.someday).sort(byCreatedDesc)`.
- `scheduledTodos` / `undatedTodos` → off `activeTodos`; `filteredScheduledTodos` / `filteredUndatedTodos` → off `filteredActiveTodos`. (`completedTodos` / `filteredCompletedTodos` unchanged.)
- Add action `setSomeday(id: string, someday: boolean): Promise<TodoItem | null>` — `someday` ? `return updateTodo(id, { someday: true, dueDate: undefined, dueTime: undefined })` : `return updateTodo(id, { someday: false })`. (Reuses `updateTodo`'s `wrapAsync` plumbing.)
- Update the store's `return { … }` (drop `openTodos`/`filteredOpenTodos`, add `activeTodos`/`somedayTodos`/`filteredActiveTodos`/`filteredSomedayTodos`/`setSomeday`).

### C. To-do page (`src/pages/FamilyTodoPage.vue`)

- Extract `function withMemberFilterAndSort(items: TodoItem[]): TodoItem[] { const f = memberFilter.value === 'all' ? items : items.filter(t => normalizeAssignees(t).includes(memberFilter.value)); return applySorting(f); }`.
- `displayedOpenTodos` = `computed(() => withMemberFilterAndSort(todoStore.filteredActiveTodos))`; new `displayedSomedayTodos` = `computed(() => withMemberFilterAndSort(todoStore.filteredSomedayTodos))`.
- Extract `<TodoSection>` (see §D below) and render all three sections through it:
  - Open: `<TodoSection :label="t('todo.section.open')" label-class="text-purple-500" :todos="displayedOpenTodos" @toggle @view @edit @delete @set-someday>` (no empty-state when there are someday/completed items? — keep the existing "no todos" message inside the section when its list is empty, matching today).
  - **Someday**: `<TodoSection v-if="displayedSomedayTodos.length" :label="t('todo.someday')" emoji="💭" :label-class="…soft/muted (not purple/green)…" :todos="displayedSomedayTodos" @toggle @view @edit @delete @set-someday><template #hint>{{ t('todo.somedayHint') }}</template></TodoSection>` — always visible (no collapse), hidden only when empty.
  - Completed: `<TodoSection v-if="displayedCompletedTodos.length" :label="t('todo.section.completed')" label-class="text-green-600 dark:text-green-400" :todos="displayedCompletedTodos" collapsible v-model:collapsed="showCompletedSectionCollapsed" @toggle @view @edit @delete>` (re-express the existing `showCompletedSection` as a `collapsed` flag, or keep `showCompletedSection` and pass `:collapsed="!showCompletedSection"` — pick whichever reads cleaner).
- Add handler `@set-someday="(id, value) => todoStore.setSomeday(id, value)"` on the Open + Someday sections (Completed rows don't fire it).
- `applySorting` unchanged.

### D. `src/components/todo/TodoSection.vue` (new, page-private)

- Props: `label: string`, `emoji?: string`, `labelClass?: string`, `todos: TodoItem[]`, `collapsible?: boolean` (default false), `collapsed?: boolean`. Emits: `update:collapsed`, `toggle: [id]`, `view: [todo]`, `edit: [todo]`, `delete: [id]`, `set-someday: [id, value]`. Slot: `#hint`.
- Renders: a header — when `collapsible`, a `<button @click="emit('update:collapsed', !collapsed)">` with a `▲/▼` chevron + `<span class="nook-section-label" :class="labelClass">{{ emoji ? emoji + ' ' : '' }}{{ label }} ({{ todos.length }})</span>`; otherwise a plain `<p class="nook-section-label" :class="labelClass">…</p>`. Optional `<slot name="hint" />` under the header. Then (when not collapsed) `<div class="space-y-2"><div v-for="todo in todos" :key="todo.id" :class="syncHighlightClass(todo.id)"><TodoItemCard :todo @toggle @view @edit @delete @set-someday /></div></div>`; when `todos.length === 0` and not collapsible, the existing "no todos" empty message.
- `useSyncHighlight()` is called inside `TodoSection` (so the page doesn't have to thread `syncHighlightClass` through).

### E. To-do row + card (`TodoItemRow.vue`, `TodoItemCard.vue`)

- `TodoItemRow.vue`:
  - `const isSomeday = computed(() => !!props.todo.someday)` (no new prop).
  - Extract `const containerClass = computed(() => { ... })` with early returns: `isSomeday` → de-emphasised (e.g. `bg-[var(--tint-slate-5)]`, optionally a dashed border, never the overdue-red path) + the base padding; `isOverdue` → the existing red classes; `compact` → the existing compact classes; default → the existing white classes. Use `:class="containerClass"` (plus the unconditional `group flex items-center gap-3 rounded-2xl border transition-all`).
  - Title: prefix `💭 ` when `isSomeday` (or a small 💭 in the metadata row).
  - Metadata row: add `&& !isSomeday` to the "no date set" hint span (a someday row shows no date stuff — the `💭` title prefix is enough); the due-date badge spans are already gated on `formattedDate` which is null for a someday item.
  - Checkbox: keep it functional (a someday item can still be checked off → moves to Completed); its border may be muted for someday rows (exact treatment with the theme skill).
  - Hover-revealed action group: add a button (same `h-8 w-8 rounded-[10px] …` styling) — `@click.stop="emit('set-someday', todo.id, !isSomeday)"`, `:title="isSomeday ? t('todo.makeActive') : t('todo.moveToSomeday')"`, icon `💭` when active (→ park) / a "bring back" icon when someday (e.g. `☀️` / `📋` — finalise with the theme skill). Place it next to ✏️.
  - Add emit: `set-someday: [id: string, value: boolean]`.
- `TodoItemCard.vue`: re-emit `set-someday`; the completed-card branch needs no someday treatment.

### F. To-do detail modal (`src/components/todo/TodoViewEditModal.vue`)

- Add a `FormFieldGroup` labelled `t('todo.kind')` near the top of the body (after the title `InlineEditField`, before the status badge) with `<FrequencyChips :model-value="todo.someday ? 'someday' : 'todo'" :options="[{ value: 'todo', label: t('todo.kind.todo'), icon: '📋' }, { value: 'someday', label: t('todo.someday'), icon: '💭' }]" @update:model-value="v => todoStore.setSomeday(todo.id, v === 'someday')" />`. (No inline-edit draft — a direct action; setting `true` clears the date via the store action; the live `todo` re-renders.)
- `v-if="!todo.someday"` on the due-date `FormFieldGroup` (and add `&& !todo.someday` to the due-time group's `v-if`).
- Status badge: a third branch — `v-if="todo.someday && !todo.completed"` → `💭 {{ t('todo.someday') }}` in a soft/muted style (e.g. `var(--tint-slate-10)` / a Sky-Silk tint); `v-else-if="todo.completed"` → the existing green; `v-else` → the existing purple.

### G. Hide someday items from the "committed" surfaces

- `src/components/nook/NookTodoWidget.vue`: `filteredOpenTodos` → `filteredActiveTodos` (the "N open tasks" count becomes the active count — correct).
- `src/components/planner/TodoPreview.vue`: `filteredOpenTodos` → `filteredActiveTodos`.
- `src/components/nook/ScheduleCards.vue`: `filteredOpenTodos` → `filteredActiveTodos`.
- `src/composables/useCriticalItems.ts`: `todoStore.openTodos` → `todoStore.activeTodos` (one line).
- Planner calendar views: confirm they read `filteredScheduledTodos` (now someday-excluding); if any does `filteredOpenTodos.filter(t => t.dueDate)` inline, switch to `filteredScheduledTodos`.
- Any other `openTodos` / `filteredOpenTodos` references found by `grep -rn 'openTodos\b\|filteredOpenTodos\b' src/` → migrate to `activeTodos` / `filteredActiveTodos` (a missed one is a compile error after the rename — caught by `npm run type-check`).
- `RecentActivityCard.vue`, `GlobalSearch.vue`: no change.

### H. i18n (`src/services/translation/uiStrings.ts`)

New `STRING_DEFS` keys (`en` + `beanie`) — note `todo.someday` is reused for the section header, the toggle's "someday" option label, and the status badge:

| key                    | en                                                | beanie                                            |
| ---------------------- | ------------------------------------------------- | ------------------------------------------------- |
| `todo.someday`         | `Someday · Maybe`                                 | `someday · maybe`                                 |
| `todo.section.someday` | `Someday · Maybe`                                 | `someday · maybe`                                 |
| `todo.somedayHint`     | `Things you might do — no pressure, no due date.` | `things you might do — no pressure, no due date.` |
| `todo.kind`            | `Track as`                                        | `track as`                                        |
| `todo.kind.todo`       | `To-do`                                           | `to-do`                                           |
| `todo.moveToSomeday`   | `Move to Someday`                                 | `move to someday`                                 |
| `todo.makeActive`      | `Make active`                                     | `make active`                                     |

(`todo.section.someday` vs `todo.someday` — if a single key works for both the section header and the toggle/badge, collapse to just `todo.someday`; the table keeps both only in case the section header wants slightly different wording. Implementer's call.) Run `npm run translate` after.

## Files Affected

**Create:**

- `src/components/todo/TodoSection.vue` — shared section renderer (Open / Someday / Completed).
- `src/stores/__tests__/todoStore.test.ts` — new (none exists); the new getters + `setSomeday` (see Testing Plan).
- `src/components/todo/__tests__/TodoItemRow.test.ts` (or extend if one exists) — someday variant + `set-someday` emit.
- _(optional)_ `src/composables/__tests__/useCriticalItems.test.ts` — someday todo excluded.
- Help article (see Help Center Coverage).

**Modify:**

- `src/types/models.ts` — `TodoItem.someday?: boolean`.
- `src/stores/todoStore.ts` — `byCreatedDesc` / `byCompletedDesc`; rename `openTodos`→`activeTodos`, `filteredOpenTodos`→`filteredActiveTodos`; add `somedayTodos` / `filteredSomedayTodos`; re-point `scheduled*`/`undated*`; `setSomeday`; exports.
- `src/pages/FamilyTodoPage.vue` — `withMemberFilterAndSort`; `displayedOpenTodos` off `filteredActiveTodos`; `displayedSomedayTodos`; render the three sections through `<TodoSection>`; `@set-someday` handler.
- `src/components/todo/TodoItemRow.vue` — `isSomeday`; `containerClass` computed; 💭 marker; metadata "no date set" gated on `!isSomeday`; hover "move to someday / make active" button; `set-someday` emit.
- `src/components/todo/TodoItemCard.vue` — re-emit `set-someday`.
- `src/components/todo/TodoViewEditModal.vue` — `FrequencyChips` `📋 To-do` / `💭 Someday · Maybe` toggle → `todoStore.setSomeday`; hide due-date/time + soft "Someday · Maybe" status badge when `someday`.
- `src/components/nook/NookTodoWidget.vue` — `filteredOpenTodos` → `filteredActiveTodos`.
- `src/components/planner/TodoPreview.vue` — `filteredOpenTodos` → `filteredActiveTodos`.
- `src/components/nook/ScheduleCards.vue` — `filteredOpenTodos` → `filteredActiveTodos`.
- `src/composables/useCriticalItems.ts` — `todoStore.openTodos` → `todoStore.activeTodos`.
- (verify only) `src/components/planner/DailyCalendarView.vue` / `WeeklyCalendarView.vue` / `DayAgendaSidebar.vue` — use `filteredScheduledTodos` (now someday-excluding) or switch to it.
- `src/services/translation/uiStrings.ts` — new keys (§H).
- `public/translations/zh.json` — regenerated by `npm run translate`.

## Help Center Coverage

- **Action**: `new article` (or, if a To-do help article exists, add a section to it).
- **Category**: `features` (or `getting-started`). **Type**: `how-to` (with an explainer intro). **Slug**: `someday-maybe-todos`. **Title**: "Someday · Maybe to-dos".
- **Scope**: what it's for (ideas you might act on, no commitment, no due date); how to mark a to-do as someday (the **Track as** toggle in the to-do detail, or the **Move to Someday** button on hover); where someday items show (the **💭 Someday · Maybe** section on the To-do page) and where they _don't_ (the Nook's "critical activities" briefing, the "Family Todo" widget, the planner sidebar — so they don't nag you); how to bring one back (**To-do** / **Make active** — it becomes a normal undated to-do you can then schedule); that completing one moves it to Completed and reopening returns it to Someday.
- **Notes**: marking something "someday" clears its due date; it's per-to-do (not per-family); the section is always visible so ideas don't get buried.

Written following `.claude/skills/beanies-help-docs/SKILL.md`; lands in the same change.

## Acceptance Criteria

- [ ] `TodoItem` has `someday?: boolean`; defaults absent; existing to-dos unaffected; no migration.
- [ ] `todoStore`: `byCreatedDesc` / `byCompletedDesc` extracted (no comparator duplication); `openTodos`/`filteredOpenTodos` **renamed** to `activeTodos`/`filteredActiveTodos` (now excluding `someday`); `somedayTodos`/`filteredSomedayTodos` added; `scheduled*`/`undated*` derive from the active set; `setSomeday(id, true)` sets `someday` and clears `dueDate`/`dueTime` (via `updateTodo` with `undefined` keys), `setSomeday(id, false)` clears `someday`; both go through `updateTodo`'s `wrapAsync` (toast on failure — not silent).
- [ ] `<TodoSection>` exists and renders the Open / Someday / Completed sections (with `collapsible` for Completed, a `#hint` slot used by Someday, and `useSyncHighlight` internally); the existing Open/Completed behaviour (the "no todos" message, the Completed collapse toggle, the per-row sync highlight) is unchanged.
- [ ] The To-do page's "Open Tasks" section shows only active items (via `displayedOpenTodos` off `filteredActiveTodos` + the shared `withMemberFilterAndSort`); a new "💭 Someday · Maybe" section appears between Open and Completed, always visible (not collapsible), with a count badge, hidden only when empty, with a hint line, respecting the member filter + sort; someday rows render de-emphasised (reusing the completed-card idiom, a 💭 marker, no due-date pill, no overdue styling).
- [ ] A hover-revealed action button on the to-do row: "Move to Someday" on an active row (→ `setSomeday(id, true)`), "Make active" on a someday row (→ `setSomeday(id, false)`); the row stays uncrowded at rest (hover-only); `TodoItemRow` reads `todo.someday` itself (no new prop), uses a `containerClass` computed (no new nested ternary), and `set-someday` flows row → card → section → page.
- [ ] The to-do detail modal has a `📋 To-do` / `💭 Someday · Maybe` toggle implemented with `FrequencyChips` (no new component) that calls `setSomeday`; when someday, the due-date/time field groups are hidden and the status badge reads "Someday · Maybe" in a soft style.
- [ ] Someday items do **not** appear in: the Nook "Family Todo" widget, the Nook "critical activities" toast (`useCriticalItems` → `activeTodos`), the planner sidebar to-do preview (`TodoPreview`), the Nook "Today's Schedule / This Week" cards (`ScheduleCards`), or the planner calendar grid. They **do** appear in: the To-do page's Someday section and global search. (No lingering `openTodos`/`filteredOpenTodos` references — `npm run type-check` is clean.)
- [ ] Completing a someday item moves it to Completed; reopening returns it to Someday (the flag persists); the member filter works across all three sections.
- [ ] All new user-visible text is in `uiStrings.ts` (`en` + `beanie`); `npm run translate` regenerates `zh.json`; the toggle/section styling matches the beanies design system.
- [ ] New unit tests cover the new store getters + `setSomeday` + the someday row variant (+ optionally `useCriticalItems` exclusion); `npm run validate` is green (type-check / lint / format:check / tests / build).
- [ ] A Help Center article ("Someday · Maybe to-dos", `features`, slug `someday-maybe-todos`) — or a section in an existing to-do article — added and matching the shipped behaviour.

## Testing Plan

**Unit (Vitest):**

1. `src/stores/__tests__/todoStore.test.ts` (new — mock `todoRepository` like the other store tests): a someday todo is in `somedayTodos`/`filteredSomedayTodos` but not `activeTodos`/`filteredActiveTodos`/`scheduledTodos`/`undatedTodos`; an active todo is in `activeTodos` not `somedayTodos`; a completed todo is in neither; getters sort by `createdAt` desc; `setSomeday(id, true)` → repo `updateTodo` called with `{ someday: true, dueDate: undefined, dueTime: undefined }` and the in-memory todo loses its date; `setSomeday(id, false)` → `{ someday: false }`; `toggleComplete` on a someday todo keeps `someday`.
2. `TodoItemRow` — `todo.someday` → de-emphasised `containerClass` + 💭 marker + no due-date pill + no overdue path; the hover button emits `set-someday` with `[id, !isSomeday]`. (Also: a non-someday active todo renders unchanged from today.)
3. _(optional)_ `useCriticalItems` — a someday todo assigned to the current member is **not** in the critical items.
4. _(optional)_ `TodoViewEditModal` — the `FrequencyChips` toggle calls `todoStore.setSomeday`; due-date/time field groups hidden when `someday`.

**Manual smoke:**

1. Create a to-do (lands in "Open Tasks"). Open it → toggle to "💭 Someday · Maybe" → it leaves "Open Tasks", appears in the "💭 Someday · Maybe" section (de-emphasised), the due-date field disappears in the modal, the status badge reads "Someday · Maybe".
2. Nook → the someday item is **not** in the "Family Todo" widget and **not** in the "critical activities" toast (even if assigned to you); the planner sidebar to-do list and calendar grid don't show it either.
3. To-do page: hover an active row → "Move to Someday" button → moves it to the Someday section. Hover a someday row → "Make active" → returns it to "Open Tasks" (as an undated to-do; you can then add a date).
4. Complete a someday item → moves to "Completed". Reopen it → returns to the "💭 Someday · Maybe" section (not "Open Tasks").
5. The **Completed section still collapses/expands** as before; the per-row sync-highlight still works on all three sections; the "no todos" message still shows in the Open section when it's empty.
6. Apply the page member filter → Open / Someday / Completed all filter correctly. Change the sort → the Someday section reorders (dueDate-sort falls back to creation order).
7. Global search for a someday item's title → still appears and opens fine.
8. Force an `updateTodo` failure (Vue devtools / monkey-patch the repo) while toggling someday → a toast appears (not silent).
9. Beanie mode on/off → new strings flip casing; `zh` mode → strings translate after `npm run translate`.

**Gates:** `npm run type-check`, `npm run lint`, `npm run format:check`, `npm run test:run`, `npm run build` — all green. No new E2E (per ADR-007's 25-test cap).

## Prompt Log

> No GitHub issue created — this plan was approved for direct implementation. Full prompt history below.

<details>
<summary>Full prompt history</summary>

### Initial prompt (2026-05-12)

> let's talk about a small improvement to the todos page. is like to add a maybe/someday category for Todo items, for things that you'd like to do someday, but are not strictly scheduled and may not even happen. these items would show up on the Todo page but not on the critical activities element on the nook page. there should be a simple and intuitive way to classify and view someday/maybe Todo items. consult the frontend-design skill on how to capture and visualize. how do you think we could implement this feature and how would it work?

### Follow-up (2026-05-12, after the proposal + a clarifying offer)

> Sounds good. As far as visibility, I like the idea of having a separate section for the someday items on the todo view, and i think it should be visible (not collapsed by default) as the items are not completed.
>
> (2) Yes, I like the idea of having a "move to someday" and "move to active" affordance, if there is space and it is not too crowded.
>
> /frontend-design pls work on the best design and layout and prepare a plan

### Review redirection 1 — DRY / no silent failures / simplicity

> Review the plan again to make sure you are implementing in the most optimal and efficient way, striving for elegance and simplicity, capturing ALL errors and never letting anything fail silently, and following all DRY principles […]. Check existing helpers, functions, composables, etc […]. If you are re-implementing any code that already exists elsewhere […] consider refactoring this into a generic item now […]. Ensure that there are never any silent failures. […] Users should be shown informative error message, with direction for developers […].

→ Use `src/components/ui/FrequencyChips.vue` directly for the toggle (already generic); confirmed `setSomeday`→`updateTodo`→`wrapAsync` already toasts on failure (not silent); clear the schedule with `undefined` (the repo `delete`s those keys); extract `byCreatedDesc`/`byCompletedDesc` in `todoStore`; no new `someday`/`variant` prop (`TodoItemRow` reads `todo.someday`); reuse the completed-card visual idiom for the de-emphasised someday row; extract `withMemberFilterAndSort` in `FamilyTodoPage`; add `src/stores/__tests__/todoStore.test.ts` (none exists).

### Review redirection 2 — long-term sustainability / maintainability / reliability

> Let's review the plan again with a focus on long term sustainability, maintainability, and reliability. Ensure we are using strong coding practices and not putting ourselves in a situation where the app will become overly complex […]. Check for deep nesting, overly coupled structures, or any other complexity that could lead to supportability, maintenance, or reliability issues that can be simplified.

→ **Rename** `openTodos`/`filteredOpenTodos` → `activeTodos`/`filteredActiveTodos` (with the `someday` exclusion) rather than keeping them alongside the new getters as dead exports — net +2 getters, no dead code, type-check catches missed consumers; **extract `<TodoSection>`** so the three To-do sections (Open / Someday / Completed) share one renderer instead of three near-identical template blocks (a faithful lift of the existing markup; the testing plan covers no-regression to the existing sections); **extract a `containerClass` computed in `TodoItemRow`** so the someday/overdue/compact/default styling is early-returns in a computed, not another branch nested into the `:class` ternary; **consolidate i18n** (`todo.someday` reused for the section header, the toggle's "someday" option, and the status badge); added an **Architecture & maintainability notes** section (getter count, no deep template ternaries, one-place-per-concern, one-way dependency edges, reliability).

</details>
