# Plan: Family Planner Page (#98)

> Date: 2026-02-28
> Related issues: #98, partially supersedes #20, #21

## Context

The Family Planner is the family's scheduling hub for activities like piano lessons, sports practice, after-school pickups, and appointments. It lives under The Treehouse in the sidebar. The route `/planner` exists as a placeholder. This plan builds the full page with a new `FamilyActivity` data entity.

## Approach

See full plan in conversation transcript. Implementation order:

- Phase A: Data layer (models, IndexedDB, repository, store, sync)
- Phase B: Wiring (store lifecycle, route, navigation, i18n)
- Phase C: UI components (6 planner components + page)

## Files affected

### New files (9)

- `src/pages/FamilyPlannerPage.vue`
- `src/stores/activityStore.ts`
- `src/services/indexeddb/repositories/activityRepository.ts`
- `src/components/planner/ViewToggle.vue`
- `src/components/planner/MemberFilter.vue`
- `src/components/planner/CalendarGrid.vue`
- `src/components/planner/UpcomingActivities.vue`
- `src/components/planner/TodoPreview.vue`
- `src/components/planner/ActivityModal.vue`

### Modified files (11)

- `src/types/models.ts`
- `src/services/indexeddb/database.ts`
- `src/services/sync/fileSync.ts`
- `src/services/sync/mergeService.ts`
- `src/stores/syncStore.ts`
- `src/App.vue`
- `src/components/common/AppHeader.vue`
- `src/components/common/MobileHamburgerMenu.vue`
- `src/router/index.ts`
- `src/constants/navigation.ts`
- `src/services/translation/uiStrings.ts`
