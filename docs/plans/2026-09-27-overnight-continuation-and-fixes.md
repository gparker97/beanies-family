# Plan: Overnight events on the next day, `activity_id` diagnostics, repeat checks

> Date: 2026-09-27
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-09-27-overnight-continuation-and-fixes.md`
> Follows: `docs/plans/2026-09-27-calendar-time-grid-span-fixes.md`, `docs/plans/2026-09-27-multi-day-repeating-activities.md`

> **No GitHub issue created.** Approved for direct implementation ("fix now", greg).

## User Story

As a parent with a sleepover, a night shift or a red-eye on the calendar, I want the part after midnight shown
on the next morning too, so the calendar never looks free when someone is still out.

## Context

After the 2026-09-27 span fixes, a timed activity whose `endTime` is before its `startTime` (no `endDate`;
reachable via calendar sync and AI extraction) is drawn on its start day up to midnight and NOT on the next
day. greg: "if we're not doing that now I would consider that a bug". Two small items ride along:
allowlisting `activity_id` for diagnostics, and three "is this repeating?" checks that ignore `rule`.

## Requirements

### A. Overnight continuation

1. An **overnight timed activity** (`!isAllDayActivity`, no `endDate`, both times readable, `endTime <
startTime` strictly) expands into its start-day occurrence AND a **continuation** occurrence on the next
   day, tagged `repeatStart: startDay` (the existing `occurrence.ts` field). One-offs and every repeat of a
   series alike; a start on the last day of a month shows its continuation on the 1st (1-day look-back).
2. The planner time grids (desktop week, desktop day lanes, phone `DayTimeline`) draw the continuation from
   00:00 to `endTime`; the start day stays drawn to midnight (unchanged). Card labels keep the real times
   ("10pm-1am").
3. A daily overnight series shows BOTH yesterday's continuation (00:00-01:00) and tonight's start
   (22:00-24:00) on the same day: timed continuations are never de-duplicated against a start (only
   overlapping ALL-DAY repeats are). Card keys include the start day.
4. **Continuation days are not events of their own.** Filtered ONCE, at the store's EVENT accessors:
   `activitiesForDate` (wall columns + counts, critical items / duty prompts), `activeActivitiesForMonth`
   (in-app bell, OS reminders, helpful hints; the bell did NOT skip continuations and would add a phantom
   21:45 reminder on day 2) and `upcomingActivities` (Nook schedule cards, status toast, MeetTheBeans).
   Only the DRAWING accessors (`monthActivities`, `activitiesInRange`) return continuation days. The wall
   therefore needs no change (it already carries overnight spans past midnight on the start-day column).
   `computeClashes` also skips them, because the planner feeds it from `monthActivities` and a continuation
   would create a phantom 22:00 clash on day 2. One predicate `isTimedContinuation(occ)` in `occurrence.ts`.
5. **Clicks, edits, duty ticks and the clash lookup resolve a timed continuation to its start day** via one
   helper `eventDateOf(occ)` (`isTimedContinuation(occ) ? occurrenceStart(occ) : occ.date`), used by every
   click emitter (grid cards, month and agenda chips) and `clashFor`. `repeatStartFor` is unchanged (it
   already returns `ymd` for timed records; using it would pick yesterday's repeat on a daily overnight
   series, because day D holds both D-1's continuation and D's start). A 22:00-00:00 event (ends exactly at
   midnight) has NO continuation.
6. The month grid and agenda/upcoming lists show the continuation like any covered day (a chip with the real
   times on day 2), as one-off multi-day trips already do.
7. **Out of scope:** timed multi-day events with an explicit `endDate` (e.g. an imported Fri 18:00 – Sun
   18:00): still start-day only. Follow-up.

### B. `activity_id` diagnostics

8. Add `activity_id` to `ALLOWED_CONTEXT_KEYS`. It is a random per-record UUID in an already-declared
   category (Apple "Other Diagnostic Data", Play "Diagnostics"): no new data category, no
   `PrivacyInfo.xcprivacy` or Play Console change. Record it in `docs/runbooks/native-store-submission.md`
   per its anti-drift rule ("no new data category"); check `web/src/pages/privacy.astro` wording.
9. Single-record diagnostics carry it as context: `allDaySpans` `reportOddRecord`. The store's multi-day
   audit keeps counts (it covers many ids). Existing `activityStore` `reportError` calls that already pass
   `activity_id` start being kept.

### C. Rule-aware repeat checks

10. Route through `isRepeatingActivity` where the legacy `recurrence` enum alone was being read:
    `reconcilePlan.ts:~113` (a rule-only series would be treated as a past one-off and stop syncing to
    Google), `ActivityViewEditModal.vue:~553` (`isRecurring`), `activityStore.ts:~422` (legacy
    `recurrenceEndDate` gate; behaviour-identical there because rule-bearing records return earlier, changed
    for consistency). The other rule-blind sites are recorded (Follow-ups), not changed.

## Assumptions

1. The form and the Google import write the legacy enum alongside `rule` (`activityShadowFromRule`), so
   rule-only records are rare; C is defensive. (VERIFIED for the form, `ActivityModal.buildPayload`)
2. `computeClashes` builds each occurrence's range from `occ.date + startTime` (`clashDetection.ts:136`).
   (VERIFIED)
3. `useCriticalItems` builds duty prompts per occurrence of today (`useCriticalItems.ts:~164`). (VERIFIED)
4. The wall's `wallEvents` feeds day columns from `activitiesForDate` (`WallDaysView.vue:124`) and positions
   via `activitySpanMinutes(activity)`, which carries overnight past 1440. (VERIFIED)

## Approach

### A

- `activityDays.ts`: `isOvernightTimed(activity)` — `!isAllDayActivity(a) && !a.endDate &&` the
  `timedSpanMinutes` span is overnight AND ends after midnight (`end > MINUTES_PER_DAY`; a 22:00-00:00 event
  has no tail). And `drawnOffsetDays(activity)` = the
  days an occurrence is drawn across: `spanOffsetDays(a)` for all-day spans, `1` for overnight timed, else 0.
- `occurrence.ts`: `isTimedContinuation(occ)` = `isContinuationDay(occ) && !isAllDayActivity(occ.activity)`;
  `occurrenceWindow(occ)` → `{ startTime, endTime }` = `{ '00:00', activity.endTime }` for a timed
  continuation, else the activity's own times; `eventDateOf(occ)` (Req 5); `occurrenceKey(occ)` =
  `id:date:occurrenceStart` for Vue keys wherever one activity can appear twice on a date (`TimedCard.key`,
  `MonthDayCard.vue:~293`, `MeetTheBeansPage.vue:~722`).
- Store (`activityStore.ts`): `expandOneOff` and `expandRecurring` use `drawnOffsetDays` where they now use
  `spanOffsetDays`; the `seen` date de-dupe runs only when `spanOffsetDays(activity) > 0` (all-day
  overlap); `activitiesForDate`, `activeActivitiesForMonth` and `upcomingActivities` filter
  `!isTimedContinuation`. `repeatStartFor` unchanged.
- Views: a `TimedCard = { occurrence, activity, startTime, endTime, key, timeLabel }` built by one helper
  (`timedCards(occs)` in `useCalendarNavigation.ts`; `clusterOverlapping` already sorts, so the views'
  pre-sorts at `WeeklyCalendarView.vue:~322` / `DailyCalendarView.vue:~141` go; `timeLabel` from the REAL
  times replaces the three label copies) and fed to `groupOverlapping`
  (already generic over `startTime/endTime`). `WeeklyCalendarView`, `DailyCalendarView` (lanes) and
  `DayTimeline` (its lane packer + positioned events, replacing the `occByActivityId` map, which cannot hold
  two cards of one activity) render cards; `getPosition(card.startTime, card.endTime)`; `:key` =
  `card.key`; clicks emit `eventDateOf(card.occurrence)`. `DayTimeline`'s silent `if (!occ) return` drop
  disappears with its Map. The `useTimeGrid` items come from the same cards, so the
  range starts early enough for a continuation.
- `clashDetection.ts computeClashes`: skip `isTimedContinuation` (the only consumer of drawn days that must).
- Diagnostics: the overnight event becomes `planner_grid_overnight_split` (the tail is now drawn).

### B

- Also mirror `activity_id` in the telemetry Lambda's allowlist (`infrastructure/lambda/telemetry/index.mjs:~65`,
  pinned to the client list by `handler.test.mjs`); deploy it through `scripts/infra/tf-plan.sh
-target=module.telemetry` + `tf-apply.sh` (Phase 3; apply only if the plan is just that Lambda's code
  hash). Without it the firehose drops the key. Update the store comment that says `activity_id` is not
  allowlisted.

### C

- Also `ActivityViewEditModal.vue:~690` (`handleDelete`): use `isRecurring.value` (a rule-only series
  skipped the scope prompt). Rewrite the `reconcilePlan.ts:~104-112` "do not change this check" comment:
  `isRepeatingActivity` is a leaf import, not the engine.

### H. Pass 3 amendments (binding)

1. **One private `expandEvents(a, y, m)`** = `expandRecurring(...).filter((o) => !isTimedContinuation(o))`,
   used by `activitiesForDate`, `activeActivitiesForMonth` and `upcomingActivities`. Every public accessor's
   JSDoc is tagged **DRAWN** (`monthActivities`, `activitiesInRange`: continuation days included) or
   **EVENT** (the other three: one entry per event), and one store test pins each. DRAWN consumers today:
   `DayAgendaSidebar.vue:~71,121`, `FamilyPlannerPage.vue:~145` (clash window), `WeeklyCalendarView.vue:~170,528`,
   `DailyCalendarView.vue:~115`, `CalendarGrid.vue:~122`, `CalendarMonthStream.vue:~140`.
2. **`DayAgendaSidebar.vue`** (a DRAWN consumer): its `${id}-${date}` de-dupe (`:~137`) keys by
   `occurrenceKey`; its clicks (`:~244,307`) emit `eventDateOf`; its sort (`:~73`) uses the occurrence window.
3. **`TimedCard.eventDate`** is computed once by `timedCards` (= `eventDateOf`) and used for both the click
   and the clash lookup in the three grids. `MonthChip.vue` (clash `:~61`, emit `:~88`) uses `eventDateOf` too.
4. **Month grid:** `monthCells.ts:~112` sorts timed chips by `occurrenceWindow(occ).startTime`, so a 00:00
   continuation leads the day; `MonthChip.vue` shows the real range ("10pm–1am") on a continuation chip
   instead of only the start time.
5. `MeetTheBeansPage` needs no `occurrenceKey` (it reads the EVENT accessor `upcomingActivities`).
6. **Two definitions of "overnight", on purpose:** `resolveActivityDays` gives a 22:00-00:00 event an end
   offset of 1 (it ends at the next day's midnight, which Google and clash need), while `isOvernightTimed`
   says it has no TAIL to draw. Both comments state this. `plannerSpan`'s doc (`useCalendarNavigation.ts:~141`)
   no longer says the tail is not drawn.
7. **Docs:** `occurrence.ts` header covers timed continuations; `repeatStartFor` JSDoc points at
   `eventDateOf` and explains the split (an all-day continuation keeps the clicked day so each day's duty
   tick is its own; a timed continuation resolves to its start day).
8. **Notifications:** the in-app bell stays "what's on today", so an ALL-DAY trip is still listed on each of
   its days (decided earlier 2026-09-27); only TIMED continuations are dropped (by `expandEvents`). The
   reminder / hint skips of all-day continuations (`useScheduledReminders.ts:~268`, `helpfulHints.ts:~293`)
   stay.
9. **Store expansion:** `expandOneOff` (`:~498`) and `expandRecurring` (`:~342`) both switch to
   `drawnOffsetDays` (clamp kept); the de-dupe condition is named before the loop
   (`const dedupeByDay = spanOffsetDays(activity) > 0`).

### I. Pass 4 amendments (binding; supersede H where they conflict)

1. **Overnight is defined by `resolveActivityDays`:** `isOvernightTimed(a)` = `!isAllDayActivity(a) &&
resolveActivityDays(a).endDayOffset === 1 && span.overnight && span.end > MINUTES_PER_DAY`. Calendar sync
   writes an explicit next-day `endDate` on every overnight import (`activityToGoogleEvent.ts:~338`), so a
   "no `endDate`" rule would have skipped exactly those. Still nothing for 22:00-00:00 or for >= 24h.
2. **Month grid and week-strip dots skip timed continuations** (`prepareCellData`, `WeeklyCalendarView.vue:~528`),
   as the Google/Apple month views do; this replaces H4 (no MonthChip, sort or key work). Req 6 now reads
   "the selected-day agenda shows the continuation".
3. **`DayAgendaSidebar`:** the upcoming list filters `!isTimedContinuation`; the day list passes
   `eventDateOf(occ)` to `ActivityListCard` (clash) and to clicks; its item arrays typed `ActivityOccurrence`.
4. **Clash:** `FamilyPlannerPage.vue:~145` must NOT filter continuations (the self-exclusion set in
   `calendarClashStore.ts:~136` needs them); the skip lives only in `computeClashes`.
5. **Diagnostics:** keep `planner_grid_overnight_clamped` (the start-day card is still clamped); update its
   comment only. The multi-day audit keeps COUNTS only (no conditional `activity_id`). `allDaySpans` no
   longer reports `timed_with_end_date` (legitimate imported overnight data), it just skips.
6. **Labels:** no `timeLabel` refactor; each surface keeps printing the real times as it does today.
7. Comment at `activityStore.ts:~415` says "non-repeating".

## Follow-ups (recorded, not in this change)

- Rule-blind `recurrence === / !== 'none'` checks still to route through `isRepeatingActivity` (verify each
  site's intent first; 21 sites): `calendarSyncStore.ts:501`, `activityStore.ts:738`, `ActivityModal.vue:249,316,383,392`,
  `ActivityViewEditModal.vue:1023`, `ActivityListCard.vue:121,126`, `GlobalSearch.vue:109`,
  `FamilyPlannerPage.vue:588,605,727`, `activityDuplicate.ts:36`, `FamilyNookPage.vue:161`,
  `describe.ts:60`, `recurrenceRrule.ts:159`, `adapters.ts:72,213`,
  `useActivityScopeEdit.ts:259`.
- Timed multi-day events with an explicit `endDate` longer than an overnight (#4).
- The wall's single-day Today view does not show last night's event still running at 00:30.
- `DayAgendaSidebar.vue:~120` steps `getMonth() + i` without normalising (the yearly-drop pattern).
- The three copies of the card time label (desktop "10pm-1am" vs phone "10pm – 1am").

## Files Affected

- `src/utils/calendar/activityDays.ts`, `src/utils/calendar/occurrence.ts`
- `src/stores/activityStore.ts`
- `src/composables/useCalendarNavigation.ts`
- `src/components/planner/WeeklyCalendarView.vue`, `DailyCalendarView.vue`, `DayTimeline.vue`
- `src/utils/calendar/clashDetection.ts`, `src/components/planner/MonthDayCard.vue`, `src/components/planner/MonthChip.vue`,
  `src/components/planner/DayAgendaSidebar.vue`, `src/utils/monthCells.ts`
- `infrastructure/lambda/telemetry/index.mjs`, `infrastructure/lambda/telemetry/__tests__/handler.test.mjs`
- `src/utils/diagnosticContext.ts`, `src/utils/allDaySpans.ts`, `docs/runbooks/native-store-submission.md`,
  `web/src/pages/privacy.astro` (if its wording enumerates identifiers)
- `src/utils/calendar/reconcilePlan.ts`, `src/components/planner/ActivityViewEditModal.vue`
- Tests for each

## Observability Coverage

- `planner-time-grid` / info / `planner_grid_overnight_clamped` (unchanged name; the start-day card is still
  clamped at midnight) and NEW `planner_grid_overnight_tail` (a next-morning tail drawn; success path, fires
  even when the start-day card is off-screen), both change-gated, `kind` = view, `count`.
- `all-day-spans` odd-record warnings carry `activity_id` (newly allowlisted).
- Existing `activityStore` `reportError` calls with `activity_id` now keep it.
- No new data category; `activity_id` declared in the runbook table.

## Acceptance Criteria

- [ ] A 22:00-01:00 activity shows 22:00-midnight on its day and 00:00-01:00 the next day on desktop week,
      day lanes and phone; labels read "10pm-1am"; the next day's grid starts early enough to show it.
- [ ] A daily 22:00-01:00 series shows both cards on each day, side by side only if they overlap (they
      don't).
- [ ] A start on the 31st shows its continuation on the 1st.
- [ ] Clicking the continuation opens the event; Edit targets the start day.
- [ ] No clash, duty prompt, reminder or hint for the continuation day; the wall draws the event once.
- [ ] `activity_id` passes the allowlist; the runbook records it; no new category.
- [ ] A rule-only series stays in the Google reconcile set; the view modal treats it as recurring.
- [ ] Diagnostic logging in **Observability Coverage** implemented and verified (events fire with the stated
      `surface`/`context`; failure modes are triageable from CloudWatch without a local repro; any new
      context key is allowlisted + declared)
- [ ] `npm run validate` green.

## Testing Plan

1. Unit: `isOvernightTimed`, `drawnOffsetDays`, `occurrenceWindow`, `isTimedContinuation`.
2. Store: overnight one-off (continuation + month-end look-back), daily overnight series (no de-dupe loss),
   midnight-end has no continuation, event accessors (`activitiesForDate`, `activeActivitiesForMonth`,
   `upcomingActivities`) exclude continuations; `eventDateOf` on a daily overnight series; `occurrenceKey`
   unique.
3. Unit: `timedCards` windows and keys; `computeClashes` skips continuations; critical items skip; wall skips.
4. `DayTimeline` lanes test with an overnight + a daily overnight series.
5. Diagnostics allowlist test; reconcilePlan rule-only test; view modal isRecurring via isRepeatingActivity.
6. Browser (scratch spec in the scratchpad): the acceptance scenarios on desktop week, day lanes, phone,
   wall.

## Review Passes

- **Pass 1 (Initial draft)**: continuation occurrences via the existing `repeatStart` model with a
  `drawnOffsetDays` rule, a `TimedCard` window for the grids, one `isTimedContinuation` predicate for the
  consumers that must not double-count; B and C as scoped.
- **Pass 2 (DRY + error handling)**: continuations filtered in the store's event accessors, not per consumer
  (covers the missed bell, wall lanes/counts, Nook); `eventDateOf` fixes the daily-series edit/tick/clash mix-up;
  `occurrenceKey` and `timeLabel` replace duplicates; midnight-end has no continuation; `activity_id` mirrored in
  the telemetry Lambda (Terraform); `handleDelete` rule-aware.
- **Pass 3 (Sustainability)**: one private `expandEvents` with accessors tagged DRAWN/EVENT and pinned by a test;
  `eventDate` computed once per card/chip; DayAgendaSidebar and MonthChip covered (de-dupe, click date, sort,
  label); month continuation sorted first; MeetTheBeans key dropped; the two "overnight" definitions documented;
  bell stays per day for all-day trips; the 26 rule-blind sites listed.

- **Pass 4 (Fresh-eyes sweep)**: overnight defined by `resolveActivityDays` (catches synced events with an
  explicit `endDate`); month grid, week strip and the sidebar's upcoming list skip timed continuations; the
  sidebar's day list uses `eventDateOf`; clash self-exclusion keeps continuations; `_clamped` name kept; audit
  back to counts; `timed_with_end_date` report removed; follow-ups corrected.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### 2026-09-27

"What are the decisions and follow ups? Are these more issues surfaced from the code review we need to fix?
Should we fix now while they're in context?"

"How about #5 and #1 to fix now and I think #4 also, just a minor change to show overnight events on the next
day, if we're not doing that now I would consider that a bug"

"Sorry not 4 i meant 3"

Pre-approval: "fix now" (implement once the four passes complete).
</details>

## Outcome (2026-09-27, implementation)

Built per A (with H + I), B and C. First `/code-review high` (8 findings, all substantiated, all fixed):
clash detection reads a tail as its START-day event (counted once; skipping it lost the clash when the start
day was off-screen) and the planner's busy window gained a day either side; `linkableActivities` uses
events; `groupOverlapping`'s doc reattached; member-filtered EVENT accessors `monthEvents` / `eventsInRange`
replace the ad-hoc tail skips (month grid, week dots, agenda upcoming); `calendarClashStore` sends
`activity_id`; `expandRecurring(..., { drawTails: false })` spares the EVENT path the look-back; cards built
once per render (`cardsByDay`, `cardsByMember`); `planner_grid_overnight_tail` success signal. Telemetry
Lambda allowlist applied to prod via `scripts/infra/tf-apply.sh` (1 changed: the Lambda code hash only).

Second `/code-review high` (10 findings). Fixed: the agenda's upcoming loop normalises its month (December
dropped January's yearly activities); tails are suppressed at the source on the EVENT path (`drawTails`
flows through `expandMonthStarts` to `expandOneOff`; the post-filter is gone, one mechanism); the clash
window reuses `activitiesInRange`; `TimedCard.isTail` replaces duck-typing in the grid's diagnostics watch;
the phone `DayTimeline` and the day lanes build cards once; tests pin the all-day look-back on the EVENT path
and a tail-only clash keyed at its start day. Recorded, not fixed: busy data for timed events longer than a
day (the #4 follow-up); `planner_grid_overnight_tail` is change-gated like every grid diagnostic, so it
measures "tails seen" rather than a per-render rate; `calendarClashStore`'s event-times failure sends
`connectionId`, which is not allowlisted (adding a connection key is a declaration decision for greg). Two
review rounds, the ceiling; no third round was run.
