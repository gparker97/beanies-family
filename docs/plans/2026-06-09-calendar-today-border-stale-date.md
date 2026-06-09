# Plan: Fix ghost orange "today" border on the monthly calendar

> Date: 2026-06-09
> Related issues: Notion #25 (Beanies Main Issue Tracker) — **No GitHub issue created.** This plan was approved for direct implementation.
> Plan file: `docs/plans/2026-06-09-calendar-today-border-stale-date.md`

## User Story

As a family member viewing the monthly calendar, I want the orange "today" highlight to mark only the actual current day, so I can trust the calendar to tell me what day it is.

## Context

On the Family Planner monthly calendar an orange Heritage-Orange left border marks the current day. Occasionally it appears on a day that is NOT today (and the real today loses its border). Intermittent and state-dependent.

Root cause (confirmed by reading the source): `src/components/planner/CalendarGrid.vue:49` captures `const today = new Date()` once at mount and never refreshes. The cell flag is `isToday: dateStr === todayStr.value` (line 204), where `todayStr` (line 74) derives from that frozen `today`. If the component stays mounted across midnight (long-open tab, PWA wake, bfcache restore), `today` still points at yesterday, so yesterday's cell keeps `isToday: true` (ghost border) and today's cell gets `false`. The same stale value also drives `todayWeekRow` (lines 87-91) and `scrollMobileToToday` (lines 398-400, selector at 408).

The app already owns the correct primitive: the reactive `useToday()` singleton (`src/composables/useToday.ts`). It exposes:

- `today: Readonly<Ref<string>>` in `YYYY-MM-DD` local format, and
- `startOfToday: ComputedRef<Date>` (local-midnight `Date` derived from `today`, via `getStartOfDay(parseLocalDate(today.value))`, `useToday.ts:36`).

Both update on a DST-safe self-rearming midnight timer, `visibilitychange`, and `pageshow`/bfcache (verified `useToday.ts:41-83`). It is already consumed by ~25 sites. CalendarGrid is the outlier still on raw `new Date()`, and does not currently import `useToday` at all.

Verified during review:

- `useToday()` returns `startOfToday` (a local-midnight Date), so the plan does NOT need a bespoke `parseLocalDate(todayStr.value)` computed.
- `CalendarGrid.vue`'s local `formatDate` (lines 76-78) is byte-identical in output to the shared `toDateInputValue` in `@/utils/date` (`date.ts:432-439`).
- The line-8 import is `import { extractDatePart, formatNookDate } from '@/utils/date';` — `formatDate` is NOT imported from `@/utils/date`, so the local helper is the only `formatDate` in scope.
- `todayStr.value` has exactly three consumers: line 204 (`isToday`), line 339 (`weekRangeByRow`, via `todayStrVal`), and line 408 (the `[data-date="…"]` selector in `scrollMobileToToday`). All keep working after the swap (still a readonly string ref).
- The today marker is the class combo `border-primary-500 border-l-[3px]` on the `MonthDayCard` root `<button>` (`MonthDayCard.vue:159-161`).

## Requirements

1. The orange "today" border renders on only the actual current day on the monthly calendar.
2. After a midnight rollover with the tab open, the border moves to the new day automatically.
3. After tab wake / bfcache restore, the border reflects the real today.
4. `todayWeekRow` and the mobile scroll-to-today helper track the same reactive today.
5. No silent failures: any code path that can produce an invalid/stale "today" must degrade visibly (border simply absent) and never throw during render.

## Important Notes & Caveats

- A remount-based rollover test would pass even against the OLD frozen-`new Date()` code (a fresh mount always re-reads the clock), so it does not exercise the bug. The rollover test MUST mutate the reactive today in place (no remount).
- Test A (static) and Test B (reactive) need DIFFERENT `useToday` mock factories. `vi.mock` is one-per-module (last wins), so they live in two files.
- The `formatDate` exported by `@/utils/date` is a DIFFERENT function ("8 Jan 2026" display formatting) — do NOT import it. Only `toDateInputValue` is wanted.

## Assumptions

> Review these before implementation. Valid at planning time (2026-06-09).

1. `useToday()`'s return shape (`today`, `startOfToday`, `isVisible`, `lastVisibleAt`, `lastHiddenAt`) is unchanged.
2. `MonthDayCard.vue` still keys the today marker off the `border-primary-500 border-l-[3px]` class combo on its root `<button>`.
3. `toDateInputValue` and the local `formatDate` remain byte-identical (both zero-pad month/day from a local `Date`).

## Approach

### 1. Reactive today (the fix)

In `CalendarGrid.vue`:

1. Add import: `import { useToday } from '@/composables/useToday';`.
2. Remove `const today = new Date();` (line 49).
3. Replace `const todayStr = computed(() => formatDate(today));` (line 74) with:
   ```ts
   const { today: todayStr, startOfToday } = useToday();
   ```
4. Add a single shared "is today on the displayed month?" computed:
   ```ts
   const todayInView = computed(() => {
     const t = startOfToday.value;
     return t.getMonth() === currentMonth.value && t.getFullYear() === currentYear.value;
   });
   ```
   (`currentMonth`/`currentYear` are reactive — lines 50-51 — so this recomputes on navigation. If `startOfToday` is ever an Invalid Date, `getMonth()` returns `NaN`, the comparison is `false`, and the border is simply absent — no throw.)
5. `todayWeekRow` (lines 87-91):
   ```ts
   const todayWeekRow = computed(() => {
     if (!todayInView.value) return -1;
     return getWeekRow(startOfToday.value);
   });
   ```
6. `scrollMobileToToday` (lines 398-400): replace the inline month/year guard with `if (!todayInView.value) return;`. (The `[data-date="${todayStr.value}"]` query on line 408 is unchanged.)
7. Cell compare (line 204) is unchanged in code, but because `todayStr` is now the reactive ref, `calendarDays` recomputes on rollover and the border relocates itself.

No `try/catch` is warranted: `startOfToday` degrades to an Invalid Date at worst, and `todayInView` degrades to `false` rather than throwing.

### 2. DRY hardening (formatter dedup)

Replace the local `formatDate` helper (lines 76-78) with the shared `toDateInputValue` from `@/utils/date` at every call site (104, 105, 141, 142, 159, 182, 199, 218), and delete the local helper. Add `toDateInputValue` to the existing line-8 `@/utils/date` import. Output is byte-identical (verified).

## Files Affected

- `src/components/planner/CalendarGrid.vue` (modify)
- `src/components/planner/__tests__/CalendarGrid.test.ts` (add the static today-border test, Test A)
- `src/components/planner/__tests__/CalendarGrid.today.test.ts` (NEW — the reactive-rollover test, Test B; separate file because `vi.mock('@/composables/useToday', …)` is per-module and the reactive variant needs a different factory than Test A's static one)

## Acceptance Criteria

- [ ] Border renders only on the real current day.
- [ ] Simulated midnight rollover (reactive today changes in place, no remount) moves the border to the new day; yesterday loses it.
- [ ] `todayWeekRow` + mobile scroll-to-today follow the reactive today (via the shared `todayInView`).
- [ ] No raw `new Date()` remains for "today" in CalendarGrid (the only remaining `new Date(...)` calls are calendar-cell construction from `year/month/day`, which are correct).
- [ ] Local `formatDate` helper removed; all call sites use `toDateInputValue`; grep `formatDate(` in CalendarGrid returns zero hits.
- [ ] Exactly one `todayInView` predicate; `todayWeekRow` and `scrollMobileToToday` both read it.
- [ ] `npm run validate` green.

## Testing Plan

> Both test files preserve the existing mocks (translation, activityStore, settingsStore). The holiday store is intentionally left on real Pinia (returns empty without fetch). Do NOT remove existing mocks.

**A. Static mock (canonical) — added to the existing `CalendarGrid.test.ts`, for the "border on only today" case.** Factory verbatim from `vacationStore.test.ts:11-23`:

```ts
vi.mock('@/composables/useToday', async () => {
  const { ref, computed } = await import('vue');
  const { toDateInputValue, getStartOfDay } = await import('@/utils/date');
  return {
    useToday: () => ({
      today: ref(toDateInputValue(new Date())),
      startOfToday: computed(() => getStartOfDay(new Date())),
      isVisible: ref(true),
      lastVisibleAt: ref(0),
      lastHiddenAt: ref(0),
    }),
  };
});
```

The existing `beforeEach` runs `vi.useFakeTimers()` + `vi.setSystemTime('2026-04-15T12:00:00.000Z')` and mounts with `referenceDate: new Date()` (→ April 15 under fake time).

1. Assert exactly one current-month cell carries the today marker and it is the 15th. Selector: the `border-primary-500` + `border-l-[3px]` class combo on the `MonthDayCard` root `<button>` (`MonthDayCard.vue:159-161`).

**B. Reactive in-place mock — NEW file `CalendarGrid.today.test.ts`, for the rollover case (proves the fix).** Because `mockToday` is referenced inside a hoisted `vi.mock` factory, it MUST be created with `vi.hoisted`, and the factory must import every Vue helper it uses (`ref` AND `computed`):

```ts
const { mockToday } = vi.hoisted(() => ({ mockToday: { value: '2026-04-15' } }));

vi.mock('@/composables/useToday', async () => {
  const { ref, computed, watchEffect } = await import('vue');
  const { getStartOfDay, parseLocalDate } = await import('@/utils/date');
  const todayRef = ref(mockToday.value);
  watchEffect(() => {
    todayRef.value = mockToday.value;
  });
  return {
    useToday: () => ({
      today: todayRef,
      startOfToday: computed(() => getStartOfDay(parseLocalDate(todayRef.value))),
      isVisible: ref(true),
      lastVisibleAt: ref(0),
      lastHiddenAt: ref(0),
    }),
  };
});
```

> Alternative (equally valid): make the hoisted holder itself the ref — `const { mockToday } = vi.hoisted(async () => ({ mockToday: (await import('vue')).ref('2026-04-15') }))` — and return `today: mockToday` directly. The load-bearing requirement is that the test mutates the SAME ref the component reads, with no remount.

Test body:

1. Mount on April 2026 (`referenceDate` pinned to April), `mockToday.value = '2026-04-15'`; assert the 15th carries the marker.
2. `mockToday.value = '2026-04-16'; await nextTick();` (NO remount) — assert marker now on 16th, absent on 15th.
3. Set `mockToday` to a date outside April; `await nextTick()`; assert no current-month cell carries the marker (and `todayWeekRow` → -1, surfacing as no today-week background tint).

**C. Manual.** Leave the calendar open across local midnight; confirm the border moves; background-tab then refocus across midnight to exercise the `visibilitychange` path; iOS Safari back/forward to exercise `pageshow`/bfcache.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the `useToday()` swap (replace frozen `new Date()`) plus the `formatDate`→`toDateInputValue` formatter dedup.
- **Pass 2 (DRY + error handling)**: Reuse `useToday().startOfToday` instead of a bespoke `parseLocalDate(todayStr.value)` computed; aligned the test with the repo's canonical `vi.mock('@/composables/useToday')` factory; confirmed no fallible op is introduced (degrades to no-border).
- **Pass 3 (Sustainability)**: Extracted a single shared `todayInView` computed to remove the duplicated month/year guard across `todayWeekRow` + `scrollMobileToToday`; corrected the consumer audit (added line 408); replaced the misleading remount rollover test with a reactive in-place mock.
- **Pass 4 (Fresh-eyes sweep)**: Fixed Test B hoisting/import bug (`ref` was unimported, `mockToday` declared outside `vi.hoisted`); split static vs reactive mocks into two files (one `vi.mock` per module); added the "keep existing mocks / holiday store on real Pinia" note; tightened the Invalid-Date degradation wording.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt (via /beanies-pre-plan → assembled block)

```
=== BEANIES PRE-PLAN ===

Title:        Fix ghost orange "today" border on the monthly calendar
Type:         bug
Priority:     medium
Surfaces:     platforms: All  •  area: activities, activities - monthly calendar
Objective:    Ensure an orange border is not drawn around any day that is not the current day on the monthly calendar.

# Bug only
Current:      There is occasionally a ghost orange border on the monthly calendar around a day that is not the current day.
Expected:     The orange border indicating the current day should only be drawn around the current day, and not any others.
Repro:        Not provided (no dedicated property). "Occasionally" suggests an intermittent / state-dependent trigger (e.g. stale "today" after a date rollover, month navigation, or a cached/duplicated today marker) — repro steps to be discovered during planning.

# Always
Scope (do):
  - Ensure the orange "current day" border is only ever rendered around the actual current day on the monthly calendar (never a stale or duplicate day).
Out of scope (don't):
  - —
Acceptance criteria:           Orange border is only drawn around the current day on the monthly calendar.
Edge cases / constraints:      Consider date-rollover while the app is open, month/year navigation, and timezone boundaries as candidate triggers.
Reuse hints / affected files:  —
References:                    —
Open Qs:                       —
Notes:                         —
GitHub issue: SKIP — do not create a GitHub issue.

=== END PRE-PLAN ===
```

### Follow-up 1

> approved

</details>
