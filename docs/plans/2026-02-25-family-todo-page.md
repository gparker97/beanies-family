# Plan: Family To-Do — Standalone Task Management Page (#99)

> Date: 2026-02-25
> Related issues: #99

## Context

Issue #99 adds a dedicated Family To-Do page at `/todo` — the third item in The Treehouse sidebar section. It's a shared task list where family members can add, assign, and complete tasks. Tasks with dates will later integrate with Family Planner (#98). The route and nav item already exist as placeholders (pointing to DashboardPage with `comingSoon: true`).

This is a full-stack feature: new data model, IndexedDB store, repository, Pinia store, page + components, sync integration, and translation strings.

## Approach

### Phase 1: Data Layer

- Add `TodoItem` interface to `src/types/models.ts` with all fields from issue spec
- Add `'todo'` to `EntityType` union and `todos` to `SyncFileData.data`
- Increment DB_VERSION, add `todos` store with indexes
- Update `clearAllData`, `exportAllData`, `importAllData`
- Create `todoRepository.ts` following goalRepository pattern

### Phase 2: Pinia Store

- Create `todoStore.ts` following goalsStore pattern
- Computed getters for open/completed/scheduled/undated/filtered todos
- Actions: loadTodos, createTodo, updateTodo, deleteTodo, toggleComplete, resetState

### Phase 3: CSS — Purple Accent

- Add purple-400/500 to @theme block
- Add tint-purple-8/15 CSS vars to :root and .dark

### Phase 4: UI Components

- QuickAddBar.vue — inline add bar with text input, date, assignee, add button
- TodoItemCard.vue — checkbox, title, assignee chip, date badge, actions
- FilterBar.vue — filter chips + sort dropdown
- MemberFilterChips.vue — page-local assignee filter

### Phase 5: Page Component

- FamilyTodoPage.vue — full page with header, quick-add, filters, open/completed sections, edit modal, empty state

### Phase 6: Integration

- Update router, navigation, syncStore, App.vue, fileSync validation, translation strings

## Files Affected

| File                                                    | Action                                                                        |
| ------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `src/types/models.ts`                                   | Add TodoItem interface, create/update types, update EntityType + SyncFileData |
| `src/services/indexeddb/database.ts`                    | DB_VERSION 3→4, add todos store, update clear/export/import                   |
| `src/services/indexeddb/repositories/todoRepository.ts` | **New** — CRUD repository                                                     |
| `src/stores/todoStore.ts`                               | **New** — Pinia store                                                         |
| `src/style.css`                                         | Add purple accent CSS vars                                                    |
| `src/components/todo/QuickAddBar.vue`                   | **New** — inline add bar                                                      |
| `src/components/todo/TodoItemCard.vue`                  | **New** — task item card                                                      |
| `src/components/todo/FilterBar.vue`                     | **New** — filter chips + sort                                                 |
| `src/components/todo/MemberFilterChips.vue`             | **New** — assignee filter chips                                               |
| `src/pages/FamilyTodoPage.vue`                          | **New** — main page component                                                 |
| `src/router/index.ts`                                   | Update /todo route component                                                  |
| `src/constants/navigation.ts`                           | Remove comingSoon from todo                                                   |
| `src/stores/syncStore.ts`                               | Add to reloadAllStores + setupAutoSync                                        |
| `src/App.vue`                                           | Add todoStore.loadTodos() to startup                                          |
| `src/services/sync/fileSync.ts`                         | Add todos to validation                                                       |
| `src/services/translation/uiStrings.ts`                 | Add ~25 todo translation keys                                                 |
