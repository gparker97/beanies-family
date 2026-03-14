# Plan: Reschedule Feature for Recurring Activities

> Date: 2026-03-14
> Related: Bug fix for materializeOverride + UX improvement for rescheduling single occurrences

## Context

Two issues with rescheduling a single occurrence of a recurring activity:

1. **Bug**: In `materializeOverride()`, `date: occurrenceDate` was set after `...overrides`, always overwriting any user-provided new date with the original occurrence date.

2. **UX**: Rescheduling required editing "Start Date" inline and navigating the 3-way scope modal, conflating "change recurring schedule" with "move this one session."

## Approach

- Added `originalOccurrenceDate` field to `FamilyActivity` so rescheduled overrides properly exclude the original date from parent expansion
- Fixed `materializeOverride` to let `overrides.date` take precedence over `occurrenceDate`
- Updated `overridesByParent` to use `originalOccurrenceDate ?? date` for exclusion
- Added "Reschedule This Session" inline UI in `ActivityViewEditModal` for recurring occurrences — bypasses scope modal entirely

## Files affected

- `src/types/models.ts` — added `originalOccurrenceDate` field
- `src/stores/activityStore.ts` — fixed `materializeOverride`, updated `overridesByParent`
- `src/services/translation/uiStrings.ts` — added 4 translation keys
- `src/components/planner/ActivityViewEditModal.vue` — added reschedule UI section
