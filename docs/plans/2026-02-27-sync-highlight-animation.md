# Plan: Cross-device sync highlight animation

> Date: 2026-02-27

## Context

When data syncs across devices (via 10-second file polling), new items appear instantly on the other user's screen with no visual cue. Users have no way to distinguish synced items from existing data. We need a distinctive animation that makes synced items "arrive" in a fun, engaging way (blur-to-clear + orange glow).

## Approach

Three layers, minimal blast radius:

1. **Detection** — A `syncHighlightStore` that snapshots item IDs before a cross-device reload, compares after, and tracks which IDs are new/modified
2. **Consumption** — A `useSyncHighlight` composable giving pages a single `syncHighlightClass(id)` function
3. **Presentation** — Two CSS animations (`beanie-sync-in` for new items, `beanie-sync-pulse` for modified items) following existing `beanie-*` conventions

No TransitionGroup wrappers — just conditional CSS class bindings on existing v-for elements.

## Files affected

| File                                  | Action                                             |
| ------------------------------------- | -------------------------------------------------- |
| `src/stores/syncHighlightStore.ts`    | **Create** — detection store                       |
| `src/composables/useSyncHighlight.ts` | **Create** — class-binding composable              |
| `src/style.css`                       | **Modify** — add keyframes + reduced-motion        |
| `src/stores/syncStore.ts`             | **Modify** — hook snapshot/detect into reload flow |
| `src/pages/DashboardPage.vue`         | **Modify** — add `:class` bindings (3 v-for loops) |
| `src/pages/AccountsPage.vue`          | **Modify** — add `:class` binding                  |
| `src/pages/TransactionsPage.vue`      | **Modify** — add `:class` bindings (2 v-for loops) |
| `src/pages/GoalsPage.vue`             | **Modify** — add `:class` bindings (2 v-for loops) |
| `src/pages/AssetsPage.vue`            | **Modify** — add `:class` binding                  |
| `src/pages/FamilyPage.vue`            | **Modify** — add `:class` binding                  |
| `src/pages/FamilyTodoPage.vue`        | **Modify** — add wrapper divs with `:class`        |
