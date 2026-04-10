# Plan: Daily Calendar View + Hover Time Labels

> Date: 2026-04-10
> Related: mockup at `docs/mockups/daily-calendar-view.html`

## Context

The planner has month and week views. A daily view shows one day's schedule for the entire family — one column per member, side-by-side. The hover "+" on time slots also needs to show the time range for clarity.

---

## Step 1: Add `sortedMembers` to familyStore (DRY cleanup)

### `src/stores/familyStore.ts`

Add a `sortedMembers` computed: adults first (oldest→youngest by `dateOfBirth.year`), then children, alphabetical fallback. ~10 lines.

**Eliminates 3 duplications:**

- `src/components/common/MemberChipFilter.vue` line 29-30
- `src/components/ui/FamilyChipPicker.vue` line 27
- `src/pages/FamilyTodoPage.vue` line 48-49

Update all three to use `familyStore.sortedMembers` instead of their inline sorts.

---

## Step 2: Small utility additions

### `src/utils/date.ts`

Add `DAYS_LONG` array + `formatDayLong(dateStr)` → "Thursday, 10 April 2026". Reuses existing `MONTHS_LONG` and `parseLocalDate`. ~8 lines.

### `src/composables/useCalendarNavigation.ts`

Add `useDayNavigation(referenceDate)` alongside `useWeekNavigation`. Same pattern, simpler:

- `currentDay` computed: `{ date, dateStr, isToday }`
- `dayLabel` computed via `formatDayLong`
- `prevDay()`, `nextDay()`, `goToToday()` — one-liners using `addDays`

~20 lines. Consistent with existing week navigation pattern.

---

## Step 3: Shared component tweaks

### `src/components/planner/ViewToggle.vue`

Add `{ id: 'day', labelKey: 'planner.view.day' }` to views array. Translation key already exists.

### `src/components/planner/WeeklyCalendarView.vue`

Change hour-slot hover content (lines 436-440) from single `+` to flex-col with `+` and time label. Replace inner `<span>` content:

```
+ (text-xl)
3pm – 4pm (text-[9px])
```

Uses `formatHourLabel(hour)` already available. ~5 line diff.

---

## Step 4: DailyCalendarView.vue (new)

### `src/components/planner/DailyCalendarView.vue`

Follows WeeklyCalendarView structure. Columns = members instead of days.

**Reuses (no duplication):** `useTimeGrid`, `groupOverlapping`, `CalendarNavBar`, `MemberChipFilter` (mobile), `ActivityListCard` (mobile), `MemberChip`, `getActivityColor`, `normalizeAssignees`, `useBreakpoint`, `formatTime12`.

**Template structure (flat, 3 sections):**

```
<CalendarNavBar :label="dayLabel" />

<template v-if="!isMobile">
  1. Member headers row (grid)
  2. All-day row (grid, same pattern as weekly)
  3. Time grid (grid: hour labels + member columns)
</template>

<template v-else>
  1. MemberChipFilter (reused)
  2. ActivityListCard list (filtered by member)
</template>
```

**Grid:** `:style="{ gridTemplateColumns: '56px repeat(' + members.length + ', 1fr)' }"`

**Column differentiation (from mockup):**

- Each member column: `border-left: 1px solid` for separation
- Header: avatar circle (member.color) + lowercase name + 2px colored accent bar at bottom (inline, ~6 lines — no separate component needed)
- Subtle gradient fade at column top: absolute div, `h-10`, member.color at 4% opacity

**Hour slots:** Same hover pattern as step 3 (+ with time range). Click emits `(dateStr, time, member.id)`.

**Activity blocks:** Same absolute positioning pattern as weekly view — `getPosition`, `groupOverlapping` per column, border-left color + tinted background. Activity block template follows weekly's exact structure (~12 lines of inline template per block).

**Now indicator:** Same as weekly — 2px red line + dot.

**Emits:** Same as weekly + `memberId` on `add-activity`.
**Expose:** `dayLabel`, `activityCount`.

---

## Step 5: Parent page + ActivityModal

### `src/pages/FamilyPlannerPage.vue`

- Import `DailyCalendarView`, add ref
- Add `defaultAssigneeId` ref
- Extend `openAddModal(date?, time?, memberId?)` to set it
- Add `v-else-if="activeView === 'day'"` block
- Extend `headerSubtitle` with `day` case
- Pass `:default-assignee-ids` to ActivityModal
- Reset on modal close

### `src/components/planner/ActivityModal.vue`

- Add prop `defaultAssigneeIds?: string[]`
- In `onNew`: `assigneeIds.value = props.defaultAssigneeIds ?? []`
- 2-line change.

---

## Files affected

| File                                            | Change                            |
| ----------------------------------------------- | --------------------------------- |
| `src/stores/familyStore.ts`                     | Add `sortedMembers` computed      |
| `src/utils/date.ts`                             | Add `DAYS_LONG` + `formatDayLong` |
| `src/composables/useCalendarNavigation.ts`      | Add `useDayNavigation`            |
| `src/components/planner/ViewToggle.vue`         | Add `day` to views                |
| `src/components/planner/WeeklyCalendarView.vue` | Hover shows time range            |
| `src/components/planner/DailyCalendarView.vue`  | **New**                           |
| `src/pages/FamilyPlannerPage.vue`               | Integrate daily view              |
| `src/components/planner/ActivityModal.vue`      | `defaultAssigneeIds` prop         |
| `src/components/common/MemberChipFilter.vue`    | Use `familyStore.sortedMembers`   |
| `src/components/ui/FamilyChipPicker.vue`        | Use `familyStore.sortedMembers`   |
| `src/pages/FamilyTodoPage.vue`                  | Use `familyStore.sortedMembers`   |

**1 new file.** Everything else is additions to existing files or replacing duplicated code.

## Verification

1. View toggle: Day appears, all 3 views switch correctly
2. Day nav: prev/next/today, label format correct
3. Member columns: adults left, children right, age-sorted, filtered members hidden
4. Activities: positioned by time, multi-assignee in multiple columns, overlaps handled
5. Click to create: drawer opens with date + time + member pre-filled
6. Hover `+` with time range: works on both weekly and daily
7. All-day section, vacation bars, now indicator all work
8. Mobile: MemberChipFilter strip + agenda list
9. Member sorting consistent across app (MemberChipFilter, FamilyChipPicker, TodoPage, DailyCalendar)
10. `npm run build` passes
