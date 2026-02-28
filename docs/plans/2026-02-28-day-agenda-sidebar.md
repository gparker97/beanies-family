# Plan: Day Agenda Sidebar for Family Planner

> Date: 2026-02-28

## Context

Currently, clicking a calendar day in the Family Planner either opens the edit modal (if exactly one activity exists on that day) or opens the add-activity modal. The user wants a richer interaction: clicking any day should slide open a sidebar showing the daily agenda, upcoming activities after that day, and an "Add Activity" button that defaults to the selected day with 9:00am start time.

## Approach

1. Create `BaseSidePanel.vue` — reusable slide-over shell (Teleport, backdrop, transitions, escape key, body scroll lock)
2. Create `DayAgendaSidebar.vue` — day agenda content showing activities for selected day, upcoming 14-day preview, and add button
3. Add `selectedDate` prop to `CalendarGrid.vue` for highlight ring
4. Add `defaultStartTime` prop to `ActivityModal.vue` for 9:00am default
5. Wire sidebar in `FamilyPlannerPage.vue` — replace direct modal open with sidebar open
6. Add 3 i18n strings to `uiStrings.ts`

## Files affected

| File                                          | Change                                    |
| --------------------------------------------- | ----------------------------------------- |
| `src/components/ui/BaseSidePanel.vue`         | **NEW** — reusable slide-over panel shell |
| `src/components/planner/DayAgendaSidebar.vue` | **NEW** — day agenda sidebar content      |
| `src/components/planner/CalendarGrid.vue`     | Add `selectedDate` prop + highlight ring  |
| `src/components/planner/ActivityModal.vue`    | Add `defaultStartTime` prop               |
| `src/pages/FamilyPlannerPage.vue`             | Wire sidebar, change click handler        |
| `src/services/translation/uiStrings.ts`       | Add 3 planner agenda i18n strings         |
