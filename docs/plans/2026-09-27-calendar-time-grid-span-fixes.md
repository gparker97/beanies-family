# Plan: Calendar time-grid span fixes (short, overnight, zero-length, stale endDate)

> Date: 2026-09-27
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-09-27-calendar-time-grid-span-fixes.md`

> **No GitHub issue created.** This plan was approved for direct implementation.

> ⚠️ **Superseded in part during implementation.** Requirement 8, Approach D, the `effectiveEndDate` /
> `hasStaleEndDate` design, the push-hash / `pushBlockReason` / view-modal edits and the
> `stale_end_date_ignored` event were NOT shipped: plan assumption 3 was false (Google imports carry a real
> `endDate` on repeating activities). **Do not re-apply them.** Read the Outcome section at the end.

## User Story

As a parent reading the family calendar, I want every activity drawn at the right time, with the right
length, never hidden behind another card and never missing from a repeat, so that I can trust what the
week and day views tell me.

## Context

The 2026-09-27 desktop calendar bug (birthday card skewing the week/day grids, fixed in `e83872a8`) was
followed by a wider read-only review of the week/day views. It found three further defects, recorded in
`docs/STATUS.md` under "Open follow-ups from the wider calendar review". Research for this plan found a
fourth (on the wall) with the same root cause as one of them.

The planner and the beanie wall each have their own notion of "the minute span of a timed activity":

- **Planner** (`src/composables/useCalendarNavigation.ts`): `useTimeGrid` (`timeRange`, `getPosition`) and
  `groupOverlapping` each parse `HH:mm` independently with an unvalidated `parseMinutes` (returns `NaN` on
  junk), assume 60 min for no end time, and have no overnight rule. Consumers: `WeeklyCalendarView.vue:872`,
  `DailyCalendarView.vue:579` (desktop lanes), `DayTimeline.vue:138` (mobile).
- **Wall** (`src/utils/wallActivities.ts:136` `activitySpanMinutes`): validated via `minutesOfDay`
  (`src/utils/date.ts:776`, returns `null` on junk), assumes 90 min, carries overnight past 1440. Clustering
  in `src/utils/wallTimeGrid.ts:468` `clusterOverlapping` (pure sweep over parsed minutes; `>=` means touching
  events are sequential). Floor-induced visual collisions are deliberately NUDGED apart, not split
  (RULE 3 docblock above `assignLanes`, `wallTimeGrid.ts:~703`).
- **Canonical day rule** (`src/utils/calendar/activityDays.ts:117` `resolveActivityDays`, used by clash
  detection and the Google export): overnight iff `endTime < startTime` (STRICT); `endTime` defaults to
  `startTime`; all-day end = `endDate ?? date`.

Both clustering docblocks say "change BOTH or neither" and point to follow-ups F1/F2 in
`docs/plans/2026-09-03-wall-time-grid.md`.

### The defects

1. **Planner overlap ignores the minimum card height.** `getPosition` draws every card at least
   `MIN_CARD_HEIGHT` = 1.5rem tall; at `ROW_HEIGHT` 3.75rem/hour that is 24 minutes. `groupOverlapping` uses
   the literal end. 9:00–9:15 and 9:15–10:00 are not grouped, both are full width, and the first card covers
   the top of the second. Two events at 10:00–10:00 (the create modal clamps an end before the start to the
   start, `ActivityModal.vue:~523`) are never grouped and one hides the other completely.
2. **Planner has no overnight rule.** An overnight record (`endTime < startTime`; legal from calendar sync
   and AI extraction, which bypass the form clamp) pulls its end hour (e.g. 1) into `timeRange`, so every
   day's grid starts at 00:00; `getPosition` computes a negative height (falls back to the 24-min floor);
   and its group ends at 01:00, so a 22:30 event over it is not grouped (stacks on top).
3. **A repeating all-day activity can carry a stale `endDate`.** `ActivityModal.buildPayload`
   (`ActivityModal.vue:699`) writes `endDate: isAllDay && endDate ? endDate : undefined` with no
   recurrence check. The end-date field is hidden while repeating, so switching a multi-day one-off to a
   repeating activity keeps the hidden value and saves it. `computeAllDaySpans`
   (`src/utils/allDaySpans.ts`) then treats every occurrence as a span from the series anchor's `date` to
   `endDate` (deduped by id), so only the anchor's span renders and every later repeat is missing from the
   week/month all-day rows. `resolveActivityDays` also honours it, so the clash detector and the Google
   export see each repeat as multi-day.
4. **(Found during research) The wall turns a zero-length event into a 24-hour one.**
   `activitySpanMinutes` uses `rawEnd <= start` for overnight, so `10:00–10:00` becomes 10:00→10:00 next
   day. The canonical rule (`resolveActivityDays`) is strict `<`: equal times are a zero-length same-day
   event.

## Requirements

1. One shared, validated definition of a timed activity's minute span, used by BOTH the planner and the
   wall: `start` from `minutesOfDay(startTime)`; no/unreadable end → `start + assumedDurationMin`
   (caller-supplied: planner 60, wall 90, unchanged); `end < start` (STRICT) → overnight, `end + 1440`;
   `end == start` → zero-length (`end = start`); unreadable start → `null`.
2. The planner's day axis ends at midnight: an overnight span is **clamped to 1440** for positioning,
   grouping and the time range. **Decision: no next-morning continuation block in this change** (the planner
   expands occurrences by start date only; drawing the tail on the next day is a new feature, recorded as a
   follow-up). The card shows its real times in its label (unchanged `formatTime12` of the raw fields).
3. Planner grouping uses the RENDERED extent: `end = max(end, start + MIN_CARD_MINUTES)`, where
   `MIN_CARD_MINUTES` is derived from `MIN_CARD_HEIGHT` and `ROW_HEIGHT` (one source; 24 today). Touching
   rendered extents (`start >= reach`) remain sequential.
4. `getPosition` uses the same shared span (and the same midnight clamp), so height is never negative.
5. `timeRange` is computed from the parsed spans: first row = floor(min start / 60), last row from the end
   (clamped), same padding and 7–19 defaults as today; unreadable times are excluded instead of turning the
   whole range into `NaN`.
6. A planner item whose start cannot be read is **never dropped**: it still renders (in its own group, as
   today). This preserves the documented F1 guarantee.
7. The planner's sweep reuses the wall's `clusterOverlapping` (moved to a shared module now that it has a
   second consumer). The wall keeps its nudge policy for floor-induced collisions; only the span definition
   and the sweep are shared.
8. `endDate` is honoured only for a NON-repeating activity. "Repeating" has ONE definition, extracted from
   the inline check at `activityDays.ts:88` (`(recurrence && recurrence !== 'none') || !!rule`) into an
   exported `isRepeatingActivity(activity)`, reused by `pushBlockReason` (`activityDays.ts:73`) and by the new pure
   `effectiveEndDate(activity)`. The readers that can see a stale value go through it:
   `resolveActivityDays`, `computeAllDaySpans`, and the view modal's end-date display
   (`ActivityViewEditModal.vue:517-520` `viewFormattedEndDate`). (`activityStore.ts:~616` is already inside
   `if (activity.recurrence === 'none')` at `:600`, so it is unreachable for stale data and is NOT edited.)
9. The create/edit modal stops writing `endDate` when the activity repeats (clearing it on save, which the
   repository does for an explicit `undefined`).
10. Observability for the two data-shape fallbacks (overnight clamp on the planner, stale `endDate`
    ignored), deduped so a re-render never floods the firehose.

## Important Notes & Caveats

- **Do not change the assumed durations.** Planner 60, wall 90 are deliberately different
  (`wallActivities.ts:108` docblock). The shared function takes the duration as a parameter.
- **Do not introduce nudging in the planner.** The wall's floor-collision nudge (RULE 3) depends on its
  folded/scaled axis; the planner splits instead. Short events splitting side by side is the honest and
  simple outcome at the planner's 24-min floor. State this divergence in both docblocks.
- **Wall overnight behaviour is unchanged** (it carries past 1440 and extends its axis); only the
  zero-length case changes (`<=` → `<`). Its `Math.max(start + 1, end)` floor stays so a zero-length span has
  positive length for the wall's geometry.
- **`groupOverlapping` is called inline in `v-for` in two views** (re-clusters every render). Leave that
  shape alone in this change (F2's perf note) — correctness only.
- **Existing stale data needs no migration**: the render/resolve path ignores `endDate` on repeating
  activities. (Corrected during implementation: an ordinary later edit does NOT clear an already-stale
  value, because `ActivityModal` diffs the save against a baseline built by the same `buildPayload`, so
  both sides read `undefined`. Only the one-off → repeating switch in the same edit, which is how stale
  values were created, now clears it. NOT harmless after the Outcome's re-route: `resolveActivityDays` still
  reads it, so legacy stale values still reach Google export and clash detection.)
- `ActivityViewEditModal`'s inline `endDate` edit and the reschedule drawer operate on all-day items; the
  reschedule child is always `recurrence: 'none'`. They are left as is; the predicate makes the render side
  safe regardless of writer (AI extraction, sync, legacy files).
- Overnight on `DayTimeline` (mobile) gets the same clamp, since it uses the same composable.
- **"Repeating" is not yet a single definition app-wide.** Checks that ignore `rule` remain at
  `ActivityViewEditModal.vue:523`, `activityStore.ts:306` and `reconcilePlan.ts:113`. Out of scope here;
  recorded as a follow-up so this plan does not overclaim.
- Keep `ActivityModal`'s clamp of end-before-start at creation (its long comment explains why); this plan
  does not add overnight authoring.

## Follow-ups (out of scope, recorded)

- **Overnight continuation on the next morning** (planner): the tail of a 22:00–01:00 event is not drawn on the
  next day. Prioritise from the `overnight_clamped` rate.
- **Remaining `rule`-blind repeat checks**: `ActivityViewEditModal.vue:523`, `activityStore.ts:306`,
  `reconcilePlan.ts:113` should use `isRepeatingActivity`.
- **`activity_id` is not in `ALLOWED_CONTEXT_KEYS`**, so existing `activityStore` `reportError` calls that
  pass it (e.g. `activityStore.ts:~606`) have it silently stripped. Decide whether to allowlist it (store
  declaration update) or move ids into `message`.
- F2's perf half: `groupOverlapping` still runs inline in `v-for` (re-clusters every render).

## Assumptions

1. `minutesOfDay` (`src/utils/date.ts:776`) validates `HH:mm` and returns `null` on junk. (VERIFIED)
2. The repository deletes keys explicitly set to `undefined` on update
   (`automergeRepository.ts:101`). (VERIFIED)
3. `activityStore` expansion only honours `endDate` for `recurrence === 'none'` (`expandOneOff`); repeating
   expansions ignore it. So a multi-day repeating all-day activity is not a supported concept. (VERIFIED)
4. `resolveActivityDays` consumers are `activityToGoogleEvent.ts` and `clashDetection.ts`. (VERIFIED)
5. `logEvent` context keys `action`, `kind`, `count`, `error_code` are allowlisted
   (`src/utils/diagnosticContext.ts:61`). `activity_id` is NOT (it would be silently stripped), so ids ride in
   `message`, the pattern `src/services/telemetry/openCycle.ts` uses. (VERIFIED)
6. `createChangeGate` (`src/services/telemetry/emitPolicy.ts:43`) is the existing dedupe gate for
   render-path logging. (VERIFIED)

## Approach

### A. Shared span + sweep (`src/utils/calendar/timeSpans.ts`, new)

- Move `clusterOverlapping` from `wallTimeGrid.ts` here unchanged (its docblock said to move it when it got a
  second consumer). `wallTimeGrid.ts` imports it from here; no re-export. Its tests move from
  `wallTimeGrid.test.ts` (~:24, ~:616) to `timeSpans.test.ts`.
- Add `timedSpanMinutes(startTime, endTime, assumedDurationMin): { start; end; overnight: boolean;
endUnreadable: boolean } | null` implementing Requirement 1. Pure, no all-day knowledge. `endUnreadable`
  is true when an `endTime` was present but `minutesOfDay` rejected it (so the assumed-duration fallback is
  never silent; the planner counts it). Its docblock states the two flags are informational: the caller
  decides whether to clamp or count (the wall uses neither).
- `MINUTES_PER_DAY` moves here outright (its only other importer is `wallTimeGrid.ts:39`); delete it and the
  stacked duplicate docblocks at `wallActivities.ts:120-121`.
- Replace (do not patch) both "deliberately NOT converged / change BOTH or neither" docblocks
  (`useCalendarNavigation.ts:~162-175`, `wallTimeGrid.ts:~452-465`) with a short note: both surfaces share
  the span and the sweep via `timeSpans.ts`; the wall additionally nudges floor-induced collisions, the
  planner splits them. Delete the duplicate `/** Group items… */` header and the now-unused `parseMinutes`.

### B. Wall (`src/utils/wallActivities.ts`)

- `activitySpanMinutes` = all-day check → `timedSpanMinutes(..., assumedDurationMin)` → keep
  `Math.max(start + 1, end)`. Net behaviour change: `end == start` is no longer overnight (defect 4).
- Update the `ASSUMED_DURATION_MIN` docblock (`wallActivities.ts:108-117`) to point at `plannerSpan` for the
  planner's 60.
- Correct its docblock (`wallActivities.ts:~130-132`, which says "equal to or before" is overnight) to the
  strict rule, and add `@see timedSpanMinutes` on `resolveActivityDays` noting the two are equivalent for
  zero-padded `HH:mm` (`resolveActivityDays` compares strings; `minutesOfDay` also accepts `9:00` and
  `24:00`).
- Mark F1 (planner parse) and F2 (shared sweep) done in `docs/plans/2026-09-03-wall-time-grid.md`.

### C. Planner (`src/composables/useCalendarNavigation.ts`)

- `const MIN_CARD_MINUTES = (MIN_CARD_HEIGHT * 60) / ROW_HEIGHT;` next to the two constants (exactly 24;
  this order keeps float error out of the `>=` touching test).
- Private `plannerSpan(startTime, endTime)` = `timedSpanMinutes(start, end, 60)` with `end` clamped to
  `MINUTES_PER_DAY`. One place.
- One `spans` computed in `useTimeGrid` (`timedItems.map(plannerSpan)`), parsed once and shared by
  `timeRange` and the observability watch.
- `timeRange`: from `spans`, skip `null`, `min` over `floor(start/60)` and `max` over
  `floor(end/60)` (an end of exactly 1440 floors to 24 and is capped at 23 by the existing `Math.min(23, …)`),
  keep existing padding/defaults.
- Export `plannerExtent(startTime, endTime)` = `plannerSpan` with the card floor applied (`end = max(end,
start + MIN_CARD_MINUTES)`), or `null`. It is the ONE rendered-extent definition, used by
  `groupOverlapping` AND by `DayTimeline.vue`'s lane packer.
- `getPosition(startTime, endTime)`: from `plannerSpan`; if `null`, return `{ top: '0rem', height:
`${MIN_CARD_HEIGHT}rem` }` (a rem string like every other path; today the browser drops a `NaN` top, which renders at 0 — same visible result, now
  explicit); height = `max((end - start)/60 * ROW_HEIGHT, MIN_CARD_HEIGHT)`.
- `groupOverlapping(items)`: map each item to `{ item, ...plannerExtent(item.startTime, item.endTime) }`; unreadable items become singleton groups (appended after the clustered ones, so they
  still render); `clusterOverlapping` over the rest; return `T[][]` (signature unchanged, so the three call
  sites do not change). Keep the existing filter of items with no `startTime`. Items with an unreadable start
  come out as singleton groups in INPUT order after the clustered groups (today their position depends on
  how the junk string sorts); pinned by a test. **Behaviour note:** within a
  group, `clusterOverlapping` orders by start then LONGEST first (`wallTimeGrid.ts:471`), where the old code
  ordered by the `startTime` string; same-start items' left-to-right order flips to longest first. Accepted
  (the longer card takes the left slot, matching the wall) and pinned by a test.
- `DayTimeline.vue:141-160` (mobile): its greedy lane packer has a THIRD inline `HH:mm` parse that uses the
  literal end, no floor and no overnight rule, so even with correct clusters 9:00–9:15 / 9:15–10:00, a
  10:00–10:00 pair, and 22:00–01:00 + 22:30 would share lane 0 and overlap. Delete the inline parse; the
  packer reads `plannerExtent` (an unreadable start takes its own lane, never dropped).
- **`timeRange` behaviour note:** a no-end item now contributes `start + 60` to the range (today only its
  start hour), so a 19:30 no-end item grows the grid to 21:00 instead of clipping its assumed hour. Intended;
  pinned by a test.
- `useTimeGrid(timedItems, viewId?)` gains an optional `viewId` (`'week' | 'day-lanes' | 'day-mobile'`),
  passed by `WeeklyCalendarView.vue:234`, `DailyCalendarView.vue:178`, `DayTimeline.vue:107`, sent as
  `context.kind` so CloudWatch can tell the three grids apart (as `WallTimeGrid.vue:240-243` does).
- Observability (see section): one `watch(spans, …, { immediate: true })` in `useTimeGrid` counts overnight
  and unreadable spans and emits through two `createChangeGate`s, copying `WallTimeGrid.vue:127-129,
236-247`. Never log from inside a computed.

### D. `endDate` predicate (`src/utils/calendar/activityDays.ts`)

- Extract `isRepeatingActivity(activity)` from the inline expression at `activityDays.ts:88`; use it there.
- Add PURE `effectiveEndDate(activity): string | undefined` — `isRepeatingActivity(activity) ? undefined :
activity.endDate`. No logging inside it (it runs in the Google export, clash detection and every all-day
  render).
- `resolveActivityDays`: use `effectiveEndDate` in both branches.
- `pushBlockReason` (`activityDays.ts:75`): validate `effectiveEndDate`, not the raw value, so an ignored
  malformed stale value no longer blocks a push.
- `computePushHash` (`activityToGoogleEvent.ts:~189`): hash `effectiveEndDate(activity)`. Identical for every
  non-stale record, so only stale records re-hash, which triggers ONE corrective re-push that removes the
  wrong multi-day event from Google. Without this Google keeps it until the next edit.
- Add PURE `hasStaleEndDate(activity)` = `!!activity.endDate && isRepeatingActivity(activity)`.
- `computeAllDaySpans`: `hasMultiDay`, the invalid-record check and the span end use `effectiveEndDate`.
  Signature and `AllDaySpansResult` are UNCHANGED (five consumers; a pure layout result must not grow a
  telemetry field).
- `ActivityViewEditModal.vue:517-520`: `viewFormattedEndDate` reads `effectiveEndDate`.

### E. Write path (`src/components/planner/ActivityModal.vue:699`)

- `endDate: isAllDay.value && !isRecurring.value && endDate.value ? endDate.value : undefined`.

## Files Affected

- `src/utils/calendar/timeSpans.ts` (new) — `timedSpanMinutes`, `clusterOverlapping` (moved),
  `MINUTES_PER_DAY` (moved)
- `src/utils/calendar/__tests__/timeSpans.test.ts` (new)
- `src/utils/wallTimeGrid.ts` — import `clusterOverlapping` / `MINUTES_PER_DAY` from the new module
- `src/utils/wallActivities.ts` — `activitySpanMinutes` delegates; docblocks
- `src/composables/useCalendarNavigation.ts` — `MIN_CARD_MINUTES`, `plannerSpan`, `timeRange`,
  `getPosition`, `groupOverlapping`, overnight log
- `src/utils/calendar/activityDays.ts` — `isRepeatingActivity`, `effectiveEndDate`, `hasStaleEndDate`; `resolveActivityDays`
  uses it
- `src/utils/allDaySpans.ts` — uses `effectiveEndDate` (no signature change)
- `src/components/planner/WeeklyCalendarView.vue` — passes `viewId`; gated `stale_end_date_ignored` watch
  counting `hasStaleEndDate` over its occurrences
- `src/components/planner/DailyCalendarView.vue` — passes `viewId`
- `src/components/planner/DayTimeline.vue` — passes `viewId`; lane packer uses `plannerExtent`, inline parse
  deleted
- `src/utils/calendar/activityToGoogleEvent.ts` — push hash uses `effectiveEndDate`
- `src/components/planner/ActivityViewEditModal.vue` — `viewFormattedEndDate` via `effectiveEndDate`
- `src/components/planner/ActivityModal.vue` — `buildPayload` endDate gate
- Tests: `wallTimeGrid.test.ts` (move `clusterOverlapping` tests out; zero-length case), `allDaySpans.test.ts`, `src/utils/calendar/__tests__/activityDays.test.ts`,
  NEW `src/composables/__tests__/useCalendarNavigation.test.ts` (directory exists; no test for this file yet) for grouping/range/position
- `docs/plans/2026-09-03-wall-time-grid.md` — mark F1 (planner parse) and F2 (shared sweep) status

## Observability Coverage

- **`planner-time-grid` / `info` / `planner_grid_overnight_clamped`** — emitted from `useTimeGrid` when the
  visible items include one or more overnight spans, deduped with `createChangeGate` keyed by the count per
  grid instance. `context: { action: 'layout', kind: viewId, error_code: 'overnight_clamped', count }`. Answers "why is this card
  clipped at midnight?" and measures how often sync/AI produce overnight data (input to prioritising the
  continuation follow-up).
- **`planner-time-grid` / `warn` / `planner_grid_unreadable_time`** — when any item's start is unreadable,
  gated the same way, `context: { action: 'layout', kind: viewId, error_code: 'unreadable_time', count }`. Mirrors the
  wall's `wall_grid_unreadable_time`; today this failure is invisible.
- **`activity-schedule` / `info` / `stale_end_date_ignored`** — from a gated watch in `WeeklyCalendarView`
  counting `hasStaleEndDate` over its occurrences; the gate is consulted only when `count > 0` (same shape
  as the wall's `rejected` gate) and keyed on the id list. `message` is the FIXED string
  `stale_end_date_ignored` so it aggregates; `context: { action: 'resolve', kind: 'week', error_code:
'stale_end_date', count }`. The first 5 ids are printed to the console `warn` alongside (dev triage),
  never into the fixed message. Tells us how many families carry legacy stale data.
- **`planner-time-grid` unreadable count includes a junk `endTime`** (`endUnreadable`), so the
  assumed-duration fallback is never silent.
- Success path: no new perf events (pure sync functions, sub-millisecond); the counts above are the rate
  signal. Nothing is `critical` — no user action fails and no data is at risk.
- No new context keys; ids ride in `message`. No store-declaration change.

## Acceptance Criteria

- [ ] 9:00–9:15 and 9:15–10:00 on the same day/lane render side by side (desktop week, desktop day lane,
      mobile day), neither covering the other.
- [ ] Two 10:00–10:00 activities render side by side.
- [ ] A 22:00–01:00 activity renders from 22:00 to the bottom of the grid; the grid does NOT start at 00:00;
      a 22:30–23:00 activity the same day sits beside it.
- [ ] The wall renders a 10:00–10:00 activity as a short block at 10:00, not 24 hours; its overnight
      behaviour (22:00–07:00) is unchanged.
- [ ] A repeating all-day activity with a stale `endDate` shows on every repeat day in the week and month
      views; clash detection and Google export treat each repeat as single-day.
- [ ] Switching a multi-day one-off to repeating and saving clears `endDate`.
- [ ] An activity with an unreadable start time still renders on the planner.
- [ ] Same-start overlapping activities: the longer one takes the left slot (pinned by a test).
- [ ] A repeating activity with a stale `endDate` shows no end date in its view modal.
- [ ] The same stale record renders on every repeat day in the wall's all-day band (`WallTodayView`,
      `WallDaysView`) and the month grid (`monthCells`), which share `computeAllDaySpans`.
- [ ] A stale record's Google push hash changes once (corrective re-push); every other record's hash is
      unchanged.
- [ ] Mobile day view (`DayTimeline`): the short, zero-length and overnight cases sit in separate lanes.
- [ ] Diagnostic logging in **Observability Coverage** implemented and verified (events fire with the stated
      `surface`/`context`; failure modes are triageable from CloudWatch without a local repro; any new
      context key is allowlisted + declared)
- [ ] `npm run validate` green.

## Testing Plan

1. Unit: `timedSpanMinutes` (normal, no end, unreadable start/end, equal, overnight, `24:00` start); `clusterOverlapping`
   (existing tests follow the move).
2. Unit: planner `groupOverlapping` (short back-to-back, zero-length pair, overnight + late event,
   unreadable start never dropped), `timeRange` (overnight does not pull start to 0; unreadable ignored),
   `getPosition` (overnight clamp height, never negative, null branch returns rem strings), `timeRange`
   no-end growth, `plannerExtent`; DayTimeline lane packing for the three cases.
   Unit: `computePushHash` unchanged for a non-stale record, changed for a stale one; `pushBlockReason`
   ignores a malformed stale `endDate`.
3. Unit: `effectiveEndDate`, `resolveActivityDays` + `computeAllDaySpans` with a stale `endDate` on a weekly
   all-day activity; wall `activitySpanMinutes` zero-length.
4. Browser (scratch Playwright spec in the scratchpad, never in `e2e/specs/`): seed the four scenarios,
   screenshot desktop week, desktop day lanes, mobile day, the wall (time grid AND all-day band), and the
   week/month all-day rows; light
   and dark for one view.
5. Modal: create multi-day all-day one-off, edit → make weekly → save → export shows no `endDate`.

## Review Passes

- **Pass 1 (Initial draft)**: drafted shared span + sweep, planner rendered-extent grouping and midnight
  clamp, `effectiveEndDate` predicate, modal write fix, wall zero-length fix.
- **Pass 2 (DRY + error handling)**: reused the existing repeat predicate (`activityDays.ts:88`) instead of a
  new `recurrence` check; dropped a redundant `activityStore` edit; kept `effectiveEndDate` pure and moved
  stale-data logging to one gated count (`activity_id` is not allowlisted); parse spans once in `useTimeGrid`
  for range + logging; count junk end times; replace (not patch) the stale "not converged" docblocks and
  delete `parseMinutes`.
- **Pass 3 (Sustainability)**: kept `computeAllDaySpans` a pure layout function (stale-`endDate` telemetry via
  a `hasStaleEndDate` predicate instead of a new result field); routed the view modal's end-date display
  through `effectiveEndDate`; recorded the remaining `rule`-blind repeat checks as a follow-up; tagged
  planner telemetry with `viewId`; fixed the `pushBlockReason` name; dropped a guessed test file.
- **Pass 4 (Fresh-eyes sweep)**: caught `DayTimeline`'s separate literal-end lane packer, which would have
  left defect 1 and the overnight overlap unfixed on mobile (now shares `plannerExtent`); fixed the
  `getPosition` null-branch unit; push hash and `pushBlockReason` use `effectiveEndDate` so Google heals stale
  records; added wall all-day and `timeRange` no-end-growth coverage; fixed telemetry message, capped ids.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt (2026-09-27)

"Commit pushes and implement the identified bugs with /beanies-build-auto"

### Context: the defects came from this request (2026-09-27)

"Can you please do a full review of those surfaces to identify and fix the bug? once the bug is fixed, run a
code-review at your proposed level across the fix, and if you think necessary you can extend across the
wider calendar desktop implementation, to ensure the fix is accurate and other bugs were not missed, and new
bugs or side effects were not introduced."
</details>

## Outcome (2026-09-27, implementation)

Built as planned for defects 1, 2 and 4, with review-driven refinements. **Defect 3 changed route** after the
first `/code-review high`:

- **Plan assumption 3 was false.** A repeating activity with an `endDate` is not always stale: the Google
  import (`planImport.ts`) spreads `googleTimesToActivityFields` (which sets `endDate` for any multi-day
  event) together with `rule`, so an adopted weekly Fri-Sun series legitimately carries both, and
  `resolveActivityDays` reads it as the per-repeat day length (`endDayOffset`). Routing every reader through
  "ignore `endDate` when repeating" would have re-pushed those series to Google shortened and broken clash
  detection for them.
- **What shipped instead:** `resolveActivityDays`, `pushBlockReason`, `computePushHash` and the view modal are
  untouched (raw `endDate`). The rendering bug is fixed where it lived: `computeAllDaySpans` spans multiple
  days only for a NON-repeating activity (matching the store's `expandOneOff`) and buckets each repeat by its
  own occurrence date, so no repeat vanishes. Only `isRepeatingActivity` (extracted from `pushBlockReason`)
  was added. `effectiveEndDate`, `hasStaleEndDate` and the `stale_end_date_ignored` metric were dropped (the
  metric could not tell legacy data from imports).
- The modal gate also requires `endDate > date`, so switching a series to one-off on a later occurrence can
  no longer save an end date before the start (which made the record vanish).

Other review refinements: a `24:00` start is treated as unreadable (it would draw below the grid);
unreadable-start cards share one group (and one lane each on mobile) instead of covering each other; the
diagnostics report bad starts and bad ends separately (`context.stage`), gated on the offending values.

**New follow-up:** draw a repeating multi-day all-day activity (e.g. an imported weekly Sat-Sun event) as a
span on each repeat. Today each repeat shows on its first day only, as the store expands it.

### Second review (round two) — not fixed, for greg

Two `/code-review high` rounds ran (the ceiling). Round two's findings circle one unresolved MODEL question:
**what does `endDate` mean on a repeating activity?** A per-repeat length (Google imports) or stale junk
(the old modal bug)? The code cannot tell them apart today. Recorded, not patched:

1. `splitActivity` / all-scope move (`useActivityScopeEdit.ts:~159`, `activityStore.ts:~1081`) and
   `materializeOverride` (`OVERRIDE_INVALID_KEYS`, `activityStore.ts:~81`) copy `endDate` without re-basing it
   onto the new `date`, so an imported multi-day series that is split, moved, or edited "this only" gets an
   `endDate` before its `date`: Google 400s, or the override vanishes. **Pre-existing on `main`.**
2. `computeAllDaySpans` now shows a repeating multi-day event on its first day each week; HEAD drew the
   anchor week as a full span but lost every later week. Proper fix: per-occurrence spans
   (`occ.date .. + endDayOffset`, deduped by id + occurrence date).
3. Legacy stale `endDate` values (from the old modal bug) are still read by `resolveActivityDays`, so they
   still export to Google as multi-day and can flag false clashes; nothing logs the count.
4. Unreadable-start cards (top of the grid) can still cover a real 00:00 card; a backwards end date typed in
   the form is dropped at save without a validation message.
