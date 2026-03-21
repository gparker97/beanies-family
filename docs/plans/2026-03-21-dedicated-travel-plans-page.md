# Plan: Dedicated Travel Plans Page

> Date: 2026-03-21

## Context

Vacation planning lived inside modals on the planner page. This migration gives it a dedicated `/travel` page with more room, a visual timeline, and proper edit modals. The data layer is untouched — purely UI restructuring that maximizes reuse of existing components, composables, and patterns.

## Approach

5 phases:

1. Route rename `/planner` → `/activities`, add `/travel` route + nav
2. Extract `useVacationTimeline` composable + shared option builders to `utils/vacation.ts`
3. Build `TravelPlansPage.vue` — list view (trip cards, past trips) + expanded view (hero, timeline, ideas)
4. Create 3 edit modals: `TravelSegmentEditModal`, `AccommodationEditModal`, `TransportationEditModal`
5. Integration: update planner page (redirect clicks), ActivityViewEditModal (vacation guard), NookVacationCard, delete VacationViewModal

## Files affected

**New (7):** TravelPlansPage.vue, useVacationTimeline.ts, 3 edit modals, NookVacationCard.vue, this plan file
**Modified (12):** router, navigation, uiStrings, vacation.ts, VacationStep2, FamilyPlannerPage, FamilyNookPage, ActivityViewEditModal, ScheduleCards, TransactionModal, TransactionsPage, e2e specs
**Deleted (1):** VacationViewModal.vue
