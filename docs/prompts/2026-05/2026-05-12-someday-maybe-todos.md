---
date: 2026-05-12
category: feature
issue: 'None — direct implementation'
plan: 'docs/plans/2026-05-12-someday-maybe-todos.md'
tags:
  [
    todo,
    someday,
    maybe,
    gtd,
    frontend-design,
    todoStore,
    FamilyTodoPage,
    TodoSection,
    FrequencyChips,
  ]
---

# "Someday · Maybe" to-dos

A third lane for the To-Do system — open items you'd _like_ to do someday but aren't committed to and may never get to. Shown in their own always-visible section on the To-Do page, excluded from the "committed" surfaces (the Nook critical-activities briefing, the To-Do widget, the planner sidebar, the calendar).

## Prompt 1 — 2026-05-12 (early session)

> let's talk about a small improvement to the todos page. is like to add a maybe/someday category for Todo items, for things that you'd like to do someday, but are not strictly scheduled and may not even happen. these items would show up on the Todo page but not on the critical activities element on the nook page. there should be a simple and intuitive way to classify and view someday/maybe Todo items. consult the frontend-design skill on how to capture and visualize. how do you think we could implement this feature and how would it work?

## Prompt 2 — 2026-05-12 (after the proposal + a clarifying offer)

> Sounds good. As far as visibility, I like the idea of having a separate section for the someday items on the todo view, and i think it should be visible (not collapsed by default) as the items are not completed.
>
> (2) Yes, I like the idea of having a "move to someday" and "move to active" affordance, if there is space and it is not too crowded.
>
> /frontend-design pls work on the best design and layout and prepare a plan

## Prompt 3 — 2026-05-12 (review redirection 1 — DRY / no silent failures / simplicity)

> Review the plan again to make sure you are implementing in the most optimal and efficient way, striving for elegance and simplicity, capturing ALL errors and never letting anything fail silently, and following all DRY principles. Check existing helpers, functions, composables, etc. If you are re-implementing any code that already exists elsewhere, consider refactoring this into a generic item now. Ensure that there are never any silent failures — users should be shown informative error messages, with direction for developers. Rewrite the plan.

→ Use `src/components/ui/FrequencyChips.vue` directly for the modal toggle (already generic — no new component); confirmed `setSomeday → updateTodo → wrapAsync` already toasts + reports on failure (not silent); clear the schedule with `undefined` keys (the Automerge repo `delete`s those); extract `byCreatedDesc`/`byCompletedDesc` in `todoStore`; no new `someday`/`variant` prop on `TodoItemRow` (it reads `todo.someday`); reuse the completed-card visual idiom for the de-emphasised someday row; extract `withMemberFilterAndSort` in `FamilyTodoPage`; add `src/stores/__tests__/todoStore.test.ts` (none existed).

## Prompt 4 — 2026-05-12 (review redirection 2 — long-term sustainability / maintainability / reliability)

> Let's review the plan again with a focus on long term sustainability, maintainability, and reliability. Ensure we are using strong coding practices and not putting ourselves in a situation where the app will become overly complex. Check for deep nesting, overly coupled structures, or any other complexity that could lead to supportability, maintenance, or reliability issues that can be simplified.

→ **Rename** `openTodos`/`filteredOpenTodos` → `activeTodos`/`filteredActiveTodos` (with the `someday` exclusion) instead of keeping them as dead exports alongside the new getters — net +2 getters, no dead code, type-check catches missed consumers; **extract `<TodoSection>`** so the three To-Do sections share one renderer; **extract a `containerClass` computed in `TodoItemRow`** so the someday/overdue/compact/default styling is early-returns in a computed, not another branch nested into a `:class` ternary; **consolidate i18n** (`todo.someday` reused for the section header, the toggle option, and the status badge); added an "Architecture & maintainability notes" section to the plan.

(Plan approved for direct implementation after this pass.)

## Outcome

Implemented on branch `feat/someday-todos` (branched from `main` at `2246eca`). Plan saved to `docs/plans/2026-05-12-someday-maybe-todos.md`. Summary:

- `TodoItem.someday?: boolean` (optional → no migration; a someday item is always unscheduled).
- `todoStore`: extracted `byCreatedDesc`/`byCompletedDesc`; renamed `openTodos`/`filteredOpenTodos` → `activeTodos`/`filteredActiveTodos` (now `!completed && !someday`); added `somedayTodos`/`filteredSomedayTodos`; re-pointed `scheduled*`/`undated*` off the active set; added `setSomeday(id, someday)` (clears `dueDate`/`dueTime` when parking, via `updateTodo`'s `wrapAsync` path).
- New `src/components/todo/TodoSection.vue` — one renderer for the Open / Someday / Completed sections; `FamilyTodoPage` gained a `withMemberFilterAndSort` helper and renders all three through it; `completedCollapsed` ref.
- `TodoItemRow`: `isSomeday` computed, `containerClass`/`checkboxClass` computeds, 💭 title marker, de-emphasised dashed-border "parked" look, a hover "Move to Someday"/"Make active" button; `TodoItemCard` re-emits `set-someday`.
- `TodoViewEditModal`: a `FrequencyChips` "Track as" 📋/💭 toggle → `todoStore.setSomeday`; flat 3-branch status badge; due-date/time field groups hidden when someday.
- Someday items excluded from `NookTodoWidget`, `TodoPreview`, `ScheduleCards`, `useCriticalItems`, `FamilyStatusToast`, `FilterBar` (and the planner calendar views, via `filteredScheduledTodos`); still in the To-Do page's Someday section + global search.
- 6 new `uiStrings` keys; `npm run translate` synced `zh.json`.
- New tests: `src/stores/__tests__/todoStore.test.ts` (4), `src/components/todo/__tests__/TodoItemRow.test.ts` (2). `npm run validate` green.
- Help: new "Someday · Maybe to-dos" section in the **Family To-Do Lists** article (`src/content/help/features.ts`).
