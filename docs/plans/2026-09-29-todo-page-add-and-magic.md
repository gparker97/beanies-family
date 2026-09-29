# Plan: "Add To-do" and magic beans on the To-Dos page, with a to-do create sidebar

> Date: 2026-09-29
> Related issues: none (follow-on to Notion #113, same session). No GitHub issue.
> Plan file: `docs/plans/2026-09-29-todo-page-add-and-magic.md`

> **No GitHub issue created.** This plan was approved for direct implementation.

## User Story

As a parent on the To-Dos page, I want the same "Add" and magic beans buttons every other page has, so I can add a to-do with its details in the sidebar, or hand a note to magic beans, without hunting for the quick-add bar.

## Context

Now that magic beans reads to-dos (#113), greg asked for the To-Dos page to follow the convention of Activities, Transactions, Cookbook and Travel: a ✨ magic beans button and an "Add" button in the page header, where Add opens a to-do SIDEBAR rather than relying only on the inline quick-add bar.

Decisions (greg, 2026-09-29): keep the quick-add bar alongside the new button; the mobile quick-add sheet's "To-do" tile opens the new sidebar; plan + build now, no mockup (reuse the existing header components and field components).

Facts (verified 2026-09-29):

- Other pages pair two shared components in their own header, no page-actions wrapper: `MagicBeansDoor` (`src/components/ai/MagicBeansDoor.vue`, props `hint?`, `claim?`, `#trigger` slot, hidden when `canReadAny` is false) with `MagicReaderPill` inside (round ✨ on mobile, labelled pill from `sm:`), and `AddEntityButton` (`src/components/ui/AddEntityButton.vue`, `label`, `compact` = round ＋ on mobile, pill from `sm:`). Activities: `CalendarCommandBar.vue:267-278` (`hint="event"`, `compact`); Cookbook: `FamilyCookbookPage.vue:355-369`.
- `ShareKind` includes `'todo'` and `availableShareKinds()` lists it; no page passes `hint="todo"` yet.
- `FamilyTodoPage.vue`: header (:210-222) shows `PageWelcomeSubtitle` and, only when `hasAnyTodos`, `TodoMemberFilter` + `SortMenu`; `QuickAddBar` (:225, gated `canEditActivities`) → `handleQuickAdd` (:126-138) → `todoStore.createTodo`; `useQuickAddIntent` 'add-todo' (:165-172) only focuses the bar; `onMounted` focuses the bar on desktop; the `todo` magic consumer + `MagicTodoReviewDrawer` are wired (:37-45, :299-305).
- `TodoViewEditModal.vue` is view/edit only (per-field inline edits → `updateTodo`; `todo: TodoItem | null`); no create path exists anywhere.
- Create/edit precedent: `ActivityModal` and `TransactionModal` are one component each with `useFormModal(getEntity, getOpen, { onEdit, onNew })` (`src/composables/useFormModal.ts:33-63`); both embed `MagicBeansQuickCard` (`ActivityModal.vue:1032`: `<MagicBeansQuickCard hint="event" :subtitle="t('ai.magic.performHint')" />`).
- Fields to reuse: `FamilyChipPicker` (multi) / `AssigneePickerButton`, `BeanieDatePicker`, `TimePresetPicker` (`clearable`, from #113 round 2), `BeanieFormModal variant="drawer"`; `toAssigneePayload` (`src/utils/assignees.ts`), `useAuthoringMember().resolveOrToast`.
- Quick-add sheet tile: `src/constants/quickAddItems.ts:73-83` (`id:'todo'`, `route:'/todo'`, `action:'add-todo'`).
- Scroll + pulse convention for a just-created item: `useAttentionPulse().reveal(el)` (`src/composables/useAttentionPulse.ts`, `attention-ring` class) + `waitForElement` (`src/utils/waitForElement.ts`), as used for new activities.
- Strings: `todo.newTask` ("New Task", unused today), `todo.viewTask`, `ai.magic.perform`, `ai.magic.performHint`, `action.add`.

## Requirements

1. **Header actions** on the To-Dos page: `MagicBeansDoor hint="todo"` + `MagicReaderPill :label="t('ai.magic.perform')"`, exactly as `CalendarCommandBar.vue:267-271` (not gated on edit permission; the door has its own `canReadAny` gate), then `AddEntityButton v-if="canEditActivities" compact` labelled `todo.addTodo` ("Add To-do"). The right-hand group always renders; `TodoMemberFilter` + `SortMenu` move into an inner `<template v-if="hasAnyTodos">` (today the whole group is behind `v-if`, :212).
2. **To-do create sidebar** (`src/components/todo/TodoFormModal.vue`, create only; editing stays in `TodoViewEditModal`): `BeanieFormModal variant="drawer"` titled `todo.newTask`; a `MagicBeansQuickCard hint="todo"` at the top (like the activity form); title (required, autofocus on desktop); notes (`description`, where links are picked up); who (`FamilyChipPicker` multi, as in `TodoViewEditModal.vue:468`; default none); title via `BaseInput` with `todo.quickAddPlaceholder`; notes via `BaseTextarea`; labels reuse `todo.who`, `todo.dueDate`, `todo.description`; due date (`BeanieDatePicker`) and time (`TimePresetPicker clearable`, shown only with a date; time shown only with a date; `toCreateTodoInput` drops an orphan time at save). Save → `todoStore.createTodo(toCreateTodoInput(fields, createdBy))` with `createdBy` from `useAuthoringMember().resolveOrToast` (reusing `magicTodos.error.noAuthor` / `noAuthorHelp`; abort if null); a `null` create keeps the sidebar open with the draft (the store has toasted). A blank title is handled by `useFormValidation('todo', () => ({ title: () => title.value.trim().length > 0 }), { open: () => props.open })` (as `GoalModal.vue:156-163`), bound as `:save-ready="v.canSave.value"` and `@save="v.attemptSave(handleSave)"`, title in `FormFieldGroup v-bind="v.bind('title')"` (never `saveDisabled` for missing input, `BeanieFormModal.vue:20-30`). The quick card's required `subtitle` is the new `todo.magicHint`.
3. **Quick-add sheet "To-do" tile** opens the sidebar on `/todo` (the `add-todo` intent) instead of focusing the bar.
4. **Quick-add bar stays** (fast one-line adds); desktop auto-focus on mount stays.
5. **After a create** (sidebar or bar), the new to-do is scrolled into view and pulsed with the existing attention ring (`data-todo-id` on `TodoItemRow`'s root), respecting reduced motion.
6. **Never two dialogs:** if a magic beans result arrives while the create sidebar is open (its own quick card), the sidebar closes before the review drawer opens.
7. **Help:** `family-todo-lists` mentions the Add button, the sidebar, and magic beans on this page.

## Important Notes & Caveats

- Reuse, don't re-create: header components, field components, and `useFormModal` (the intent can open the sidebar on mount, the 'open ⇒ seeded' trap it exists for, `useFormModal.ts:9-26`).
- Every surface light + dark; accents as text get `-lift` partners; rem text; American English; no em-dashes; `en` + `beanie` strings.
- The sidebar's quick card and the header ✨ both route magic results through the page's existing `todo` consumer (no new wiring).
- Known, accepted: a magic result closes the sidebar and drops a typed draft (as the planner, `FamilyPlannerPage.vue:512-515`); `magicTodos.error.noAuthor` says "these to-dos" even for one; `resolveOrToast` reports only via `showToast` (surface `app`, `useToast.ts:131`).
- Known, accepted: `QuickAddBar` clears its input when it emits (`QuickAddBar.vue:34`), before the create resolves, so a failed or author-less quick add loses the one typed line after the toast. Existing behaviour; `QuickAddBar`'s contract is not widened here.

## Assumptions

1. `MagicBeansDoor` + `MagicReaderPill` + `AddEntityButton compact` fit the To-Dos header beside `SortMenu` at 390px (Activities fits the same pair).
2. `useQuickAddIntent` can open a sidebar the same way other pages do for their `add-*` actions.

## Approach

- `src/utils/todo.ts`: `toCreateTodoInput(fields: { title; description?; dueDate?; dueTime?; assigneeIds }, createdBy)`: trims the title, empty description → undefined, `dueTime` only with a `dueDate`, `toAssigneePayload` only with assignees, `completed: false`. Builds the result FIELD BY FIELD and never spreads `fields` (the drawer passes `{ ...d }`, and `TodoDraft` carries keys that must never persist: `matchDate`, `timeDropped`, `dueDerived`, `duplicateOf`, `magicTodoDrafts.ts:83-103`); every optional string normalised with `x?.trim() || undefined` (title trimmed, description, dueDate, dueTime), since `stripUndefined` (`automergeRepository.ts:13-20`) drops only `undefined` and a cleared picker yields `''`. Signature `fields: { title: string; description?: string; dueDate?: string; dueTime?: string; assigneeIds?: string[] }`. Used by the sidebar, `handleQuickAdd` and `MagicTodoReviewDrawer.onSave` (today its own inline copy, ~:336-344). Pure; returns `CreateTodoInput` (`models.ts:736`); no `id` and no title fallback: the drawer keeps both at its call site, `rows.map((d) => ({ id: d.id, ...toCreateTodoInput({ ...d, title: cleanTitle(d.title) || baseline.get(d.id)?.title || d.title }, author) }))`. It alone owns the "no time without a date" rule.
- `src/stores/todoStore.ts`: `createTodo`'s `wrapAsync` gains `surface: 'todos'` (today it reports as `app`, :160), matching `createTodos` (:221).
- `src/components/todo/TodoFormModal.vue` (new): props `open`; emits `close`, `created(id)`; `useFormModal(() => null, () => props.open, { onEdit: () => {}, onNew: reset })` (gives `isSubmitting`, no hand-written watch; the create-only precedent is `QuickAddTransactionModal.vue:40-44`); fields per Req 2; a header comment states it is create-only and editing stays per-field inline in `TodoViewEditModal`. It only emits `created(id)` and never logs.
- `src/pages/FamilyTodoPage.vue`: header actions (Req 1); `showCreate` ref + `TodoFormModal`; `useQuickAddIntent('add-todo')` → `showCreate = true` (without edit permission it returns, as sibling pages do, `FamilyTimelinePage.vue:58`; the tile already requires the permission, `quickAddItems.ts:82`; fix the stale comment at :165-166); `handleQuickAdd` uses `resolveOrToast` (stops on null, never writes `createdBy: ''`, :47/:136) and stops when `createTodo` returns null; one page-local `afterCreate(id, source: 'sidebar' | 'quick_bar')` logs `created` then calls `revealTodo(id)`: `waitForElement(() => pageRoot.value?.querySelector('[data-todo-id="' + CSS.escape(id) + '"]'), 800)` then `useAttentionPulse().reveal(el, 'attention-ring')`; on a miss `logEvent` info `surface:'todo-create'` `action:'reveal_missed'` `detail: displayedOpenTodos.value.some((t) => t.id === id) ? 'not_rendered' : 'filtered'` (a global member filter also hides rows, `todoStore.ts:118`; a new to-do is always open) (no generic reveal composable: one caller; `useActivityReveal` is activity-specific); `ref="pageRoot"` on the root `<div class="space-y-6">` (:208); if `!pageRoot.value` after the wait (page left) return without logging; the `todo` consumer handler stays synchronous (its signature is `(payload) => void`, `useMagicReader.ts:264,320`, so a returned promise would be dropped) and calls `void openTodoReview(payload)`, a named async function that closes `showCreate`, `await nextTick()`, then sets `todoReview` (the `FamilyPlannerPage.vue:512-515` precedent).
- `src/components/todo/TodoItemRow.vue`: `data-todo-id` on the root (:139), not `TodoSection`'s wrapper (the `attention-ring` is an inset box-shadow, `style.css:693`, a child's background would hide it); harmless where the row also renders (`NookTodoWidget`, `DayAgendaSidebar`).
- Strings: TWO new keys, `todo.addTodo` ("Add To-do" / "add to-do") and `todo.magicHint` ("Snap a note, a list or a school email" / lowercase); reuse `todo.newTask`, `ai.magic.perform`, `todo.quickAddPlaceholder`, `todo.who`, `todo.dueDate`, `todo.dueTime`, `todo.description`, `magicTodos.error.noAuthor(Help)`.
- `src/components/nook/NookTodoWidget.vue`: `addTask` (:50-62, a copy of `handleQuickAdd` with the same `createdBy: … || ''` bug) uses `toCreateTodoInput` + `resolveOrToast` (stop on null) and clears its inputs only after a non-null create. `useWallJobs.addTodo` is deliberately left alone (it credits the wall session, due today, unassigned).
- `FamilyTodoPage` `onMounted`: after `nextTick`, focus the bar only if `!showCreate.value` (the FAB intent can open the sidebar first on desktop).
- Wiring: `TodoFormModal` is always mounted (no `v-if`, the `FamilyTimelinePage.vue:47-52` convention); `@close` and `@created` set `showCreate = false`, `@created` then calls `afterCreate(id, 'sidebar')`; `handleSave` returns early if `isSubmitting`, sets it in try/finally, and binds `:is-submitting`.
- Help: `src/content/help/features.ts` `family-todo-lists`.

## Files Affected

- `src/components/todo/TodoFormModal.vue` (new) + `src/components/todo/__tests__/TodoFormModal.test.ts` (new)
- `src/pages/FamilyTodoPage.vue`, `src/components/todo/TodoItemRow.vue`, `src/utils/todo.ts` (+ `src/utils/__tests__/todo.test.ts`), `src/stores/todoStore.ts` (surface), `src/components/nook/NookTodoWidget.vue`, `src/components/ai/MagicTodoReviewDrawer.vue` (switch to `toCreateTodoInput`; existing tests stay green)
- `src/services/translation/uiStrings.ts`, `src/content/help/features.ts`
- Tests: `src/pages/__tests__/FamilyTodoPage.test.ts` (new; mocking copied from `FamilyPlannerPage.magicTodos.test.ts`), three behaviours only: header actions gated on permission, the intent opens the sidebar, a magic result closes the sidebar first
- Docs: `docs/plans/2026-09-29-todo-page-add-and-magic.md`, `CHANGELOG.md`, `docs/STATUS.md`

## Help Center Coverage

- **Action**: update existing. **Category**: features. **Slug**: `family-todo-lists`. **Scope**: add a to-do from the Add button (who, date, time, notes) or the quick-add bar, or hand a note to magic beans from the ✨ button.

## Observability Coverage

- **Create:** `createTodo` failures report via `wrapAsync` on surface `todos` (newly added); success-path `logEvent` `info` `surface:'todo-create'`, `action:'created'`, `detail: 'sidebar' | 'quick_bar'` after a non-null create (sheet use is already logged by `useQuickAdd`).
- **Reveal miss:** `info` `action:'reveal_missed'` with `detail: 'filtered' | 'not_rendered'`.
- **No author:** `resolveOrToast` toasts (reported by `showToast` on surface `app`).
- **Privacy:** existing allowlisted keys only.

## Acceptance Criteria

- [ ] To-Dos header shows ✨ + "+ Add To-do" (round on phone, pills from `sm:`), matching Activities, light + dark.
- [ ] "+ Add To-do" opens the sidebar; saving a titled to-do with who/date/time creates it, closes the sidebar, and the new row scrolls into view and pulses.
- [ ] ✨ opens magic beans with To-do pre-picked; a result opens the review drawer (never over the create sidebar).
- [ ] The quick-add sheet's To-do tile lands on /todo with the sidebar open.
- [ ] The quick-add bar still works and its new to-do also pulses.
- [ ] Help article updated; `npm run validate` green; browser-verified at 390/1280, light/dark.

## Testing Plan

1. Unit: `toCreateTodoInput` rules (incl. dropping a time without a date, never copying extra draft keys, `''` date/time/description saved as absent); the quick-add stops with a toast when there is no author and never writes `createdBy: ''`; `TodoFormModal` (a `null` create keeps the draft open; blank title shows not-ready and a tap marks the title without calling `createTodo`; time hidden without a date; save calls `createTodo` with the payload and emits `created`; failure keeps it open); FamilyTodoPage (header actions gated on permission; `add-todo` intent opens the sidebar; a magic result closes the sidebar before the review drawer).
2. Browser (`scripts/design-screenshots/`): header at 390/1280 light/dark; add via sidebar → pulse; FAB tile → sidebar; ✨ → sheet with To-do picked.

## Review Passes

- **Pass 1 (Initial draft)**: Header ✨ + Add via existing components, a create-only `TodoFormModal` reusing field components and the magic quick card, FAB tile opens it, pulse the new row, never two dialogs.
- **Pass 2 (DRY + error handling)**: New `toCreateTodoInput` util shared by the sidebar, the quick bar and the magic review drawer; `useFormModal` for open ⇒ seeded; `resolveOrToast` replaces the quick bar's silent `createdBy: ''`; `createTodo` reports on surface `todos`; the reveal miss is logged; `todo.magicAria` and `stage` dropped; two new strings.
- **Pass 3 (Sustainability)**: One page-local `afterCreate` owns the create log and the reveal; reveal scoped to a new `pageRoot` ref and silent after unmount; `intent_refused` dropped for consistency with sibling pages; `toCreateTodoInput` pure, no id/title fallback, sole owner of the no-time-without-date rule (the modal watch goes); the magic consumer stays synchronous via a named `openTodoReview`; the quick bar's lost line on failure recorded as accepted; new page test file named and scoped.
- **Pass 4 (Fresh-eyes sweep)**: `toCreateTodoInput` builds field by field and normalises `''` to absent (draft-only keys must not persist); `useFormValidation`/`saveReady` replaces a disabled Save; second string `todo.magicHint` for the quick card's required subtitle (+ reuse `todo.dueTime`); reveal-miss classified by membership in the displayed list; `NookTodoWidget.addTask` moved to the helper + `resolveOrToast` (same empty-author bug), wall capture left alone; desktop auto-focus skipped while the sidebar is open; created/close wiring and the double-submit guard explicit.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt (2026-09-29)

Ok sounds good, no need for the guard. i've confirmed that duplicate todos were identified correctly and a todo item was added with time as expected. well done :) let me know if there's anything else to test on my side.

one more thing, now that todos have AI, I think we should add an "add todo" affordance to the todo page, following the convention of all other pages (i.e. activity, transactions, etc) to add an item, with the magic beans icon next to it as well. this woudl open up the todo sidebar to add a todo via the sidebar ratehr than the quick-add on the todo page.

### Follow-up 1 (decisions)

Keep both (quick-add bar stays). The quick-add sheet's To-do tile opens the new sidebar. Plan + build now, no mockup.

</details>

## Outcome

> Built 2026-09-29 via `/beanies-build-auto`. Not deployed. Reviewed twice at `high` (round 2 scoped to the fixes): round 1, 10 findings, 8 fixed (author source and wording left as greg's call); round 2, 9 findings, 7 fixed. The last fixes are tested and gated but not re-reviewed (two-round ceiling).

**Deviations from the plan above:**

- **One create path:** `src/composables/useTodoCreate.ts` (`createTodoFrom(fields, callerTag, source)`, `resolveTodoAuthor`) now owns author resolution, `toCreateTodoInput`, `createTodo` and the `todo-create` `created` event (source `sidebar` / `quick_bar` / `nook`), replacing the page-level `afterCreate` log. New singular strings `todo.error.noAuthor(Help)`; `todo.field.title` ("Task") added for the validation message.
- **Sidebar:** an open-session generation counter stops a save that lands after a close-and-reopen from closing the new draft; clearing the date clears the time (a watch, reinstated after review).
- **Page:** a magic save reveals the topmost new row; overlapping reveals keep only the latest; the add-todo intent is ignored (logged `intent_ignored`) while the magic review drawer is open; desktop auto-focus reads the intent from the query at setup.
- **Nook widget:** in-flight guard, and inputs are cleared only if unchanged since submit.

**Known, accepted:** the quick-add bar still clears its line before the create resolves, so a failed or author-less quick add loses that line (pre-existing, recorded in the plan); a save that succeeds after a close-and-reopen is not revealed or counted.

**Open for greg:** the sidebar's title ("New Task") and field label ("Task") use the page's existing "Task" wording, while the buttons say "Add To-do".
