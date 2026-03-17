# Plan: Weekly & Daily Calendar Views + Sidebar Todo Enhancement

> Date: 2026-03-17
> Related: Family Planner page — currently only has monthly calendar view

## Context

The Family Planner has a monthly calendar (`CalendarGrid`) that shows activity dots. The `ViewToggle` has week/day/agenda buttons disabled. This plan adds **Weekly** and **Daily** views, enhances the sidebar with todos, and **extracts shared components** to eliminate existing duplication first.

## DRY Audit — Existing Duplication to Fix

**Activity card markup** duplicated **3 times**:

- `DayAgendaSidebar.vue` lines 107-149 (day activities)
- `DayAgendaSidebar.vue` lines 175-220 (upcoming activities)
- `UpcomingActivities.vue` lines 59-113
- Only differences: optional date display, optional reminder indicator
- Also duplicates: `recurrenceLabel()` function (2×), `formatDisplayDate()` function (2× with slight difference — UpcomingActivities has today/tomorrow logic)

**Calendar nav bar** in `CalendarGrid.vue` lines 175-220 — needed identically for weekly and daily views.

**Time grid utilities** (time-to-pixel positioning, time range auto-fit, overlap grouping) — needed by both WeeklyView and DailyView. Put in composable, not duplicated.

## Implementation (ordered by dependency)

### Step 1: Extract `ActivityListCard.vue` (NEW — shared component)

**File:** `src/components/planner/ActivityListCard.vue`

Extracts the duplicated activity card used in list contexts (sidebar, upcoming, daily agenda).

**Props:**

- `activity: FamilyActivity` (required)
- `date: string` (required — occurrence date)
- `showDate?: boolean` (default false — shows date in title row)
- `showReminder?: boolean` (default false — shows bell emoji)

**Emits:** `click` (no payload — parent handles with its own context)

**Content:** Category dot, title, optional date (with today/tomorrow logic), time range, recurrence badge (uses `t('planner.recurrence.X')`), optional reminder bell, MemberChips. Same styling as current cards: `rounded-2xl border-l-4 bg-white px-3 py-2.5 shadow-[...]`.

This component absorbs the duplicated `recurrenceLabel()` and `formatDisplayDate()` helpers — they become internal to the component.

Then **simplify** the 3 consumers:

- `DayAgendaSidebar.vue` — replace both card sections with `<ActivityListCard>`. Remove `formatDisplayDate()`, `recurrenceLabel()`.
- `UpcomingActivities.vue` — replace card markup with `<ActivityListCard showDate showReminder>`. Remove `formatDisplayDate()`, `formatDate()`, `recurrenceLabel()`.

**Net effect:** ~120 lines of duplicated markup + 3 helper functions → single ~50-line component + slim consumers.

### Step 2: Extract `CalendarNavBar.vue` (NEW — shared component)

**File:** `src/components/planner/CalendarNavBar.vue`

**Props:** `label: string`
**Emits:** `prev`, `next`, `today`

Contains: prev/next arrow buttons + center label (`font-outfit text-lg font-bold`) + "Today" pill button. Exact same styling as CalendarGrid's nav.

Then **simplify** `CalendarGrid.vue` — replace its nav markup with `<CalendarNavBar>`.

### Step 3: `useCalendarNavigation.ts` (NEW — composable)

**File:** `src/composables/useCalendarNavigation.ts`

Shared date navigation logic. Two exports:

**`useWeekNavigation(referenceDate: Ref<Date>)`** returns:

- `weekDays: ComputedRef<{ date: Date, dateStr: string, isToday: boolean }[]>` — 7 days respecting `settingsStore.weekStartDay`
- `weekLabel: ComputedRef<string>` — e.g. "Mar 10 – 16, 2026"
- `prevWeek()`, `nextWeek()`, `goToToday()`

**`useDayNavigation(referenceDate: Ref<Date>)`** returns:

- `dayLabel: ComputedRef<string>` — e.g. "Tuesday, March 17, 2026"
- `dateStr: ComputedRef<string>`
- `isToday: ComputedRef<boolean>`
- `prevDay()`, `nextDay()`, `goToToday()`

Uses existing: `addDays()`, `toDateInputValue()`, `parseLocalDate()` from `src/utils/date.ts`.

Also exports **time grid utilities** shared by both views:

**`useTimeGrid(activities: ComputedRef<{ startTime?, endTime? }[]>)`** returns:

- `timeRange: ComputedRef<{ start: number, end: number }>` — auto-fit hours (min 7–19, expanded by content ±1h)
- `hours: ComputedRef<number[]>` — array of hour numbers for rendering rows
- `getPosition(startTime: string, endTime?: string): { top: string, height: string }` — CSS positioning from time
- `groupOverlapping(items)` — groups overlapping time ranges for side-by-side layout

This avoids duplicating positioning math in WeeklyView and DailyView.

### Step 4: `WeeklyCalendarView.vue` (NEW)

**File:** `src/components/planner/WeeklyCalendarView.vue`

**Props:** `selectedDate?: string`
**Emits:** `select-date(date)`, `add-activity(date, time?)`, `view-activity(id, date)`
**Expose:** `weekLabel`, `activityCount`

Uses: `CalendarNavBar`, `useWeekNavigation`, `useBreakpoint`, `MemberChip`, `getActivityColor`, `formatTime12`.

**Desktop (≥768px) — time grid:**

- `CalendarNavBar` with `weekLabel`
- Header row: untimed activities + todos as compact pills
- 7-column grid with left time axis (hourly labels via `formatTime12`)
- Subtle hour dividers (`border-gray-100 dark:border-slate-700`)
- Activity cards positioned via absolute `top`/`height` from startTime/endTime (60px per hour)
- Cards: left color border, truncated title, time, assignee MemberChip(sm)
- Overlap: side-by-side split (v1: 100%/N width per overlapping card)
- Current time indicator: thin orange line
- Empty slot: subtle hover tint → click emits `add-activity(date, hour)`
- Day header click → emits `select-date` (opens sidebar)
- Card click → emits `view-activity` (opens ViewEditModal)

**Mobile (<768px):**

- Horizontal scrollable day tab strip (7 tabs, today centered)
- Selected tab's activities render below as vertical `ActivityListCard` list
- Reuses `ActivityListCard` component — zero new card markup

**Data:** `activityStore.monthActivities()` for 1-2 months covering the week, filtered to 7-day range. Todos: `todoStore.filteredScheduledTodos` filtered to week.

### Step 5: `DailyCalendarView.vue` (NEW)

**File:** `src/components/planner/DailyCalendarView.vue`

**Emits:** `add-activity(date, time?)`, `view-activity(id, date)`, `view-todo(todo)`
**Expose:** `dayLabel`, `activityCount`

Uses: `CalendarNavBar`, `useDayNavigation`, `ActivityListCard`, `TodoItemRow`, `getActivityColor`, `formatTime12`.

**Layout — single scrollable page:**

**Section A: Hour-by-hour timeline**

- Same time grid pattern as weekly but single full-width column
- Richer activity blocks than weekly: title, time + duration, assignee chips, location, recurrence
- Current time indicator
- Click empty slot → `add-activity`; click block → `view-activity`

**Section B: Agenda list** (below timeline, after a subtle divider)

- `ActivityListCard` for each activity (timed + untimed), ordered chronologically
- Untimed/all-day items shown first with "All Day" label
- Reuses the shared card — no new card markup

**Section C: "Tasks Due"** (bottom, only if todos exist)

- Purple accent section (left border + tinted bg, matching TodoPreview pattern)
- Header: "✅ Tasks Due"
- `TodoItemRow` with `compact` mode for each todo
- Click → emits `view-todo`

**Mobile (<768px):** Hide timeline (Section A), show only agenda list (Section B) + tasks (Section C). The timeline is less useful on small screens; the agenda list gives full detail. This keeps mobile simple and avoids cramped hour grids.

### Step 6: Enhance `DayAgendaSidebar.vue` (MODIFY)

- Import `useTodoStore` and `TodoItemRow`
- Add computed `dayTodos`: scheduled todos filtered to `props.date`
- Add emit: `view-todo(todo: TodoItem)`
- Add "Tasks Due" purple section between activities and "Add Activity" button
- Uses `TodoItemRow` compact — **same component as daily view, zero duplication**
- Only rendered when `dayTodos.length > 0`

### Step 7: Update `ViewToggle.vue` (MODIFY)

- Remove "agenda" from `views` array (merged into daily)
- Remove disabled state: delete `:title` binding and conditional `@click` guard
- All 3 buttons (month/week/day) emit freely

### Step 8: Wire up `FamilyPlannerPage.vue` (MODIFY)

- Import `WeeklyCalendarView`, `DailyCalendarView`
- Template refs: `weeklyViewRef`, `dailyViewRef`
- Conditional rendering with `v-if` on `activeView`:
  - `'month'` → `CalendarGrid`
  - `'week'` → `WeeklyCalendarView`
  - `'day'` → `DailyCalendarView`
- `headerSubtitle` computed: pull label/count from active view's exposed values
- Wire events: `@select-date`, `@add-activity(date, time)`, `@view-activity(id, date)`, `@view-todo`
- Hide Upcoming + TodoPreview when `activeView === 'day'`
- Hide inactive section when `activeView !== 'month'`

### Step 9: Translation strings in `uiStrings.ts` (MODIFY)

Add:

```
'planner.tasksDue': { en: 'Tasks Due', beanie: 'tasks due' }
'planner.allDay': { en: 'All Day', beanie: 'all day' }
```

Remove `'planner.view.agenda'` from ViewToggle views array (string can stay in uiStrings — harmless).

## Reuse Summary

| Item                    | Location                                          | Used By                                                                       |
| ----------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------- |
| `ActivityListCard`      | NEW `src/components/planner/ActivityListCard.vue` | DayAgendaSidebar, UpcomingActivities, WeeklyView (mobile), DailyView (agenda) |
| `CalendarNavBar`        | NEW `src/components/planner/CalendarNavBar.vue`   | CalendarGrid, WeeklyView, DailyView                                           |
| `TodoItemRow` (compact) | EXISTING `src/components/todo/TodoItemRow.vue`    | DayAgendaSidebar, DailyView                                                   |
| `useCalendarNavigation` | NEW composable                                    | WeeklyView, DailyView                                                         |
| `useTimeGrid`           | NEW (same file)                                   | WeeklyView, DailyView (time-to-pixel, overlap grouping)                       |
| `getActivityColor()`    | EXISTING `src/stores/activityStore.ts`            | All activity displays                                                         |
| `formatTime12()`        | EXISTING `src/utils/date.ts`                      | Time grid labels                                                              |
| `MemberChip` (sm)       | EXISTING `src/components/ui/MemberChip.vue`       | All activity/todo displays                                                    |
| `useBreakpoint()`       | EXISTING `src/composables/useBreakpoint.ts`       | WeeklyView responsive                                                         |

## Files Changed Summary

| File                       | Action             | Lines impact                          |
| -------------------------- | ------------------ | ------------------------------------- |
| `ActivityListCard.vue`     | NEW                | ~50 lines                             |
| `CalendarNavBar.vue`       | NEW                | ~35 lines                             |
| `useCalendarNavigation.ts` | NEW                | ~120 lines (incl. time grid utils)    |
| `WeeklyCalendarView.vue`   | NEW                | ~250 lines                            |
| `DailyCalendarView.vue`    | NEW                | ~200 lines                            |
| `DayAgendaSidebar.vue`     | SIMPLIFY + enhance | −80 lines (cards) + ~30 lines (todos) |
| `UpcomingActivities.vue`   | SIMPLIFY           | −50 lines (cards)                     |
| `CalendarGrid.vue`         | SIMPLIFY           | −20 lines (nav)                       |
| `ViewToggle.vue`           | MODIFY             | ~3 lines changed                      |
| `FamilyPlannerPage.vue`    | MODIFY             | ~30 lines added                       |
| `uiStrings.ts`             | MODIFY             | 2 strings added                       |

## Verification

1. `npm run type-check` + `npm run test:run` — clean
2. **Regression:** DayAgendaSidebar, UpcomingActivities, CalendarGrid look/behave identically after refactoring to shared components
3. **Weekly:** Activities at correct time slots, colors match, member chips show. Day header → sidebar. Card click → ViewEditModal. Empty slot → ActivityModal with date+time. Mobile: day tabs + card list.
4. **Daily:** Timeline blocks + agenda cards + tasks due. All interactions work.
5. **Sidebar:** Todos appear with purple accent when dueDate matches.
6. **Dark mode:** All new components correct.
7. **Member filter:** Activities/todos respect selection in all views.
8. Run `npm run translate` — no broken parsing.
