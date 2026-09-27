# Plan: Multi-day repeating all-day activities

> Date: 2026-09-27
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-09-27-multi-day-repeating-activities.md`
> Follows: `docs/plans/2026-09-27-calendar-time-grid-span-fixes.md` (Outcome + "Second review")

> **No GitHub issue created.** This plan was approved for direct implementation.

## User Story

As a parent with a weekly weekend custody schedule, a Fri–Sun sports tournament every month, or any
all-day event that repeats and lasts several days, I want each repeat drawn across all of its days, editable
like any other series, so that beanies matches my Google calendar and nothing silently disappears.

## Context

A repeating activity can carry an `endDate` today, in two ways:

1. **Google import** (`src/utils/calendar/planImport.ts`): `googleTimesToActivityFields` sets `endDate` for a
   multi-day event and the import spreads it alongside `rule`, so a weekly Fri–Sun series arrives as
   `date = Fri, endDate = Sun, rule = weekly`.
2. **The old modal bug** (fixed in `ad920f67`): switching a multi-day one-off to repeating saved the hidden
   end date.

The app is inconsistent about what that means:

- `resolveActivityDays` (`src/utils/calendar/activityDays.ts`) reads it as the per-repeat length
  (`endDayOffset`), so the **Google export and clash detection treat each repeat as multi-day**.
- The store's repeating expansions (`activityStore.ts`) emit one occurrence per repeat START and ignore it,
  and `computeAllDaySpans` (since `ad920f67`) buckets each repeat on its start day, so the **calendar shows
  day one only**.
- `splitActivity`, `materializeOverride` ("this only") and the all-scope move copy `endDate` without re-basing
  it onto the new `date`, producing `endDate < date`: Google 400s on every sync, or the edited occurrence
  vanishes (`expandOneOff` emits nothing).

**Decision (greg, 2026-09-27): option A with A1.** "This repeat lasts N days" becomes a real, supported,
visible concept. Every existing `endDate` on a repeating activity is treated as a real per-repeat length (no
import-marker split, no cleanup), which is exactly what the Google export already sends. A wrong length is
fixable through a new visible field.

## Requirements

1. **Model (no format change).** A repeating all-day activity's per-repeat length is
   `spanOffsetDays = daysBetweenYmd(date, endDate)` (0 = single day; the form shows `Lasts = offset + 1`). `endDate` stays the stored field, always
   RELATIVE to the record's own `date`. One pure helper owns this (`activityDays.ts`), used everywhere.
   Timed multi-day repeats are out of scope (unchanged: shown on the start day; follow-up).
2. **Expansion.** A repeating all-day activity with length N > 0 expands into one occurrence per covered day
   of every repeat (start S, S+1 … S+N), mirroring `expandOneOff`. Each occurrence carries
   `repeatStart: S` (only on multi-day days; everything else falls back to `date`). The override filter applies to repeat STARTS before days are expanded. Repeats that
   start up to N days before the month and cover it are included (look-back); emitted days are clamped to
   the month so month-walking callers see no duplicates. Overlapping repeats (N ≥ interval) never emit the
   same activity twice on one date (dedupe by date, earliest start wins).
3. **`repeatStart` on every occurrence** (optional field on the occurrence object; for a one-off it is
   `activity.date`, for a single-day repeat it is the date itself). One accessor
   `occurrenceStart(occ) = occ.repeatStart ?? occ.date`.
4. **All-day spans.** `computeAllDaySpans` groups a repeating multi-day activity by `id + repeatStart`,
   spanning `[repeatStart, repeatStart + N]` clamped to the row; one-offs unchanged. `AllDaySpan` gains
   `startYmd` (the repeat start / one-off start) for keys and clicks. The week view keys spans by
   `id + startYmd` and emits `startYmd` on click; month cells and the wall inherit via the shared result.
5. **Clicks land on the repeat.** A covered day is mapped to its repeat start ONCE, in
   `useActivityScopeEdit.openViewModal` (the single entry for the planner, the Nook and deep links), via a
   store helper `repeatStartFor(activity, ymd)`. Everything downstream (modal seeding, scope edit, override key, split
   point) then sees the repeat start.
6. **Edits carry the length.** Every place that creates or moves a record's `date` carries the span with
   `shiftSpan` / `withRebasedEndDate`: `splitActivity`, `materializeOverride` (new + reuse), and the scope
   edit's 'all' and 'this-and-future' moves. A Lasts change from the form is re-expressed on the target
   record's `date`. `updateActivity` itself stays a plain write.
7. **Duty ticks.** `materializeOverride` carries completions for every covered day `[S, S+N]` (today only
   `S`), shifted by the reschedule delta when the child moves.
8. **Form.** `ActivityModal`, recurring + all-day: an optional **"Lasts"** number field (days, 1 to
   `minRepeatGapDays` for the current rule; default 1) replaces the hidden end date. Seeded from the record;
   payload `endDate = date + (N - 1)` when N > 1, else cleared. `ActivityViewEditModal` shows "Lasts N days"
   for a repeating multi-day activity instead of the anchor's raw end date.
9. **One reminder per repeat.** `useScheduledReminders` schedules an all-day multi-day reminder only on the
   repeat start (one-offs: the activity start), not on every covered day. Helpful hints use the repeat
   start as their event date (fixes today's one-off duplication too).
10. **Observability** (see section): count of repeating multi-day activities; expansion decisions
    (look-back, overlap dedupe); length conversions in edits.

## Important Notes & Caveats

- **No data-format change.** `endDate` keeps its meaning to Google (`resolveActivityDays` untouched). Older
  clients keep drawing day one only. They CAN still corrupt a span: they move templates without a rebase
  (`useActivityScopeEdit.ts:156` in old builds) and split / create overrides copying `endDate` raw, giving a
  changed length or `endDate < date`. Mitigation, not prevention: `expandOneOff` goes through `coveredDays`
  so an invalid child shows as one day instead of vanishing, and `auditRepeatSpans` counts one-off children
  with `endDate < date`. No update floor change (the corruption exists on `main` today).
- **A1 consequence (accepted by greg):** a family hit by the old modal bug sees their weekly event span the
  leftover length. It matches their Google calendar and is now fixable with the Lasts field.
- `repeatStart` is a VIEW field on occurrences only; never persisted.
- The length cap (≤ 7 for weekly etc.) is a FORM rule for new edits. Legacy/imported data with N ≥
  interval is rendered with the overlap dedupe, never rejected.
- Timed multi-day repeats (imported Fri 18:00 – Sun 18:00) stay as today: a card on the start day. Clash
  detection and Google already honour their length. Follow-up.
- Duty reminders are already gated for all-day activities (no times); only the generic reminder changes.
- Pre-existing, adjacent, NOT fixed here: `upcomingActivities` / `DayAgendaSidebar` step `getMonth() + i`
  without normalising (flagged by the audit); record as follow-up.

## Assumptions

1. `expandRecurring(a, y, m)` returns repeat-start occurrences within month `m`; one-offs go through
   `expandOneOff` (per covered day). (VERIFIED)
2. `overridesByParent` is keyed by the parent occurrence date = repeat start. (VERIFIED)
3. `resolveActivityDays` all-day branch → `endDayOffset = dayOffset(date, endDate)`. (VERIFIED)
4. ActivityModal seeds a recurring activity's `date` from `occurrenceDate` (`ActivityModal.vue:~357`), and
   edits diff against a baseline built by `buildPayload`. (VERIFIED)
5. `useActivityScopeEdit` 'all' shifts the template by the move delta; 'this-and-future' anchors the new
   template at `occurrenceDate` (+ delta); 'this-only' materializes at `occurrenceDate`. (VERIFIED)
6. `completionsForDerived(entries, keep, retarget?)` retargets to ONE date (`activityStore.ts:107`);
   covered-day carry needs a per-entry shift. (VERIFIED)
7. `logEvent` keys `action`, `count`, `kind`, `stage`, `error_code` are allowlisted. (VERIFIED)

## Approach

### A. Length + day maths, one home each

**Naming, one convention:** in code a span is `spanOffsetDays` (0 = single day, counted from 0); only the
form's "Lasts" counts from 1 (`Lasts = spanOffsetDays + 1`).

- `src/utils/date.ts`: export `daysBetweenYmd(a, b)` (signed, UTC-based so DST-safe, like `sleepsUntil` in
  `calendarDay.ts:118`). Replaces `dayOffset` in `activityDays.ts:111`, the copy at `ActivityModal.vue:567`
  and the delta in `useActivityScopeEdit.ts:126` (`shiftAnchor` becomes `addDaysYmd(anchor, delta)`).
- `src/utils/calendar/activityDays.ts`:
  - `spanOffsetDays(a)` — `a.isAllDay === true && a.endDate && a.endDate > a.date ?
daysBetweenYmd(date, endDate) : 0`. Deliberately `isAllDay === true` (NOT `isAllDayActivity`), matching
    the store's existing rule at `activityStore.ts:381` / `:616` exactly, so no timed-less one-off changes
    behaviour. Replaces those two inline copies and `allDaySpans.ts:95,112`.
  - `shiftSpan({ date, endDate }, newDate)` — the ONE conversion primitive: returns the `endDate` that keeps
    the same offset from `newDate` (undefined when there is no span). Used for split, override creation,
    the three moving call sites (via `withRebasedEndDate`), the 'all' Lasts conversion
    (`shiftSpan({ date: formDate, endDate: changes.endDate }, template.date)`) and the reschedule seed.
  - `withRebasedEndDate(existing, patch)` — pure: if `patch.date` moves an all-day record with a span and
    `patch.endDate` is absent, returns the patch plus `endDate = shiftSpan(existing, patch.date)`; else the
    patch unchanged. Called ONLY at the three moving call sites (scope 'all' `useActivityScopeEdit.ts:156`,
    'this-and-future' `:188`, override reuse `activityStore.ts:1233-1243`). `updateActivity` stays a plain
    write.
  - `minRepeatGapDays(activity)` — the smallest gap between consecutive repeat starts, derived from the rule
    via `resolveActivityRule` (handles multi-weekday weekly and any interval; daily = 1). The form's Lasts
    cap is `minRepeatGapDays`; the overlap audit uses the same helper.
- **`src/utils/calendar/occurrence.ts` (new, no Vue):** the one `ActivityOccurrence { activity; date;
repeatStart? }`, `occurrenceStart(occ) = occ.repeatStart ?? occ.date`, `isContinuationDay(occ) =
occurrenceStart(occ) !== occ.date`. All four copies alias it: `allDaySpans.ts:19`, `wallActivities.ts:21`,
  `MonthChip.vue:33`, `NotificationOccurrence` (`notifications.ts:69`).
- `repeatStart` is set by `coveredDays` on EVERY day it emits, for one-offs (`activity.date`) and multi-day
  repeats alike, so `isContinuationDay` works for both; single-day occurrences fall back to `date` through
  `occurrenceStart`. No other expander changes.

### B. Expansion (`src/stores/activityStore.ts`)

- `repeatStartsInRange(a, fromYmd, toYmd)`: rule path = one `occurrencesInRange` call over the range
  (`:287-292` already accepts any range); legacy path = the existing per-month switches walked with
  `distinctMonths` (`occurrenceAssembly.ts:16`, reused, no new walker); the override filter applied ONCE at
  the end (today duplicated at `:296-297` and `:366-367`).
- `expandRecurring(a, y, m)`: one-off → `expandOneOff`; repeat with `spanOffsetDays = 0` → starts in the
  month (unchanged output); repeat with offset `n > 0` → `repeatStartsInRange(a, monthStart − n, monthEnd)`,
  keep `start + n >= monthStart`, emit `coveredDays(start, n, monthStart, monthEnd)` with `repeatStart`,
  dedupe by date (earliest start wins). Silent clamp of `n` to 366 inside the expansion (the audit reports
  it). No logging in the expansion: it runs inside computeds (`monthActivities`, `upcomingActivities`
  `:548-552`, `activitiesInRange`).
- `coveredDays(start, n, from, to)` shared by `expandOneOff` and the repeat path.
- `repeatStartFor(activity, ymd)` = `expandRecurring(a, y(ymd), m(ymd)).find((o) => o.date ===
ymd)?.repeatStart ?? ymd` — built on the expansion, so a click always opens the repeat that is drawn.
- `auditRepeatSpans(activities)` (pure) → `{ multiDayRepeats, overlapping, endBeforeStart, clamped }`,
  run from ONE change-gated `watch` on `activities` in the store (see Observability).

### C. Spans (`src/utils/allDaySpans.ts`)

- Multi-day when `spanOffsetDays(a) > 0` (one-off or repeat). Group key: one-off `id`; repeat
  `id + occurrenceStart(occ)`. Span range: one-off `[date, endDate]`; repeat `[repeatStart, repeatStart + n]`,
  clamped to the row. `AllDaySpan.startYmd` added. `spanningIds` stays by id (every covered day renders inside
  a span).
- The invalid-record and schema-drift branches log through `logEvent`/`reportError` instead of bare
  `console.warn` (ids in `message`; `activity_id` is not an allowlisted context key).
- `monthCells.ts` renders per-day items from the same result (isStart/isEnd per cell); it inherits the repeat
  grouping.

### D. Views + clicks

- `WeeklyCalendarView.vue`: span `:key` → `span-${id}-${startYmd}`; click emits `span.startYmd`.
- `wallActivities.ts` `wallDayAllDay`: open with `span.startYmd` instead of `days[span.startCol]`.
- **One chokepoint:** `useActivityScopeEdit.openViewModal(id, date)` normalises `date` with
  `repeatStartFor` before storing it. Covers the planner's four views, the Nook's `open-activity` handlers
  and deep links. No page edits.

### E. Edits

- `completionsForDerived(entries, keep, retarget?: (ymd) => ymd)` (was a single date); both call sites
  (`:1104`, `:1280`) updated.
- `splitActivity`: new template `endDate = shiftSpan(original, fromDate)` unless patched.
- `materializeOverride` (new child): `endDate = shiftSpan(parent, finalDate)` unless patched; completions
  kept for `[S, S+n]`, each shifted by `daysBetweenYmd(S, finalDate)`. Reuse path: `withRebasedEndDate`.
- `useActivityScopeEdit` 'all' and 'this-and-future': `withRebasedEndDate` on the move patch; a present
  `changes.endDate` (a Lasts edit) is re-expressed with `shiftSpan({ date: formDate, endDate }, target.date)`
  where `formDate = movedTo ?? occurrenceDate`.
- `updateActivity` is NOT changed (plain write).
- `ActivityViewEditModal.vue`:
  - Inline end-date field (`:250`, `:335-341`): for a repeating activity it is read-only "Lasts N days";
    length edits go through ActivityModal only (no second conversion path).
  - Reschedule panel (`:781`, base `:822-825`): seed and diff base from `shiftSpan(activity,
occurrenceDate)` so it never clamps against an end date before the occurrence.

### F. Form (`ActivityModal.vue`)

- `lastsDays` ref (default 1). Seed: `spanOffsetDays(activity) + 1`. Shown in the recurring + all-day branch
  as `FormFieldGroup` "Lasts" with `BaseInput v-model.number type="number" min=1 :max="max"` + "days"
  (the custom-fee pattern at `:1176`), `max = minRepeatGapDays` for the form's current rule. Out-of-range → a field validation
  error through the existing `v` validator (never a silent clamp).
- `buildPayload`: recurring + all-day → `endDate: lastsDays > 1 ? addDaysYmd(date, lastsDays - 1) :
undefined`; one-off unchanged.
- i18n: `planner.field.lasts` ("Lasts" / "lasts"), `planner.field.lastsDays.one` / `.other`
  ("{n} day" / "{n} days"), `planner.validation.lastsRange` (both `en` + `beanie`).

### G. Reminders + hints

- `useScheduledReminders.ts` (~:267) and `helpfulHints.ts` `activityHints` (:288): `if
(isContinuationDay(occ)) continue;` — one rule, one reminder / hint per event (also fixes the one-off party
  duplication).

### H. Pass 4 amendments (binding)

1. **Duty ticks keep the clicked day.** `openViewModal(id, date)` keeps `viewingOccurrenceDate` = the clicked
   day (the view modal ticks duties with it, `ActivityViewEditModal.vue:131-141`, and critical items tick
   per day, `useCriticalItems.ts:164-196`) and adds `viewingRepeatStart` (= `repeatStartFor` when
   `isRepeatingActivity`, else the clicked day). The scope edit, the full edit, reschedule and delete paths
   (`:421-445`, `:661-692`, `:822-840`) use the repeat start.
2. **Five moving call sites, not three.** `withRebasedEndDate` also at the view modal's inline `date` edit at
   scope 'all' (`ActivityViewEditModal.vue:326-332` → `:425`) and the reschedule panel's child branch
   (`:858-866`, only when `parentActivityId` is set, so plain one-offs are unchanged).
3. **"Unless patched" means `'endDate' in patch`** (a present `undefined` from `diffPayload` is an explicit
   clear), in `withRebasedEndDate`, split and override creation.
4. **Span geometry from emitted days.** A repeat span's range is the min..max occurrence dates actually
   present for that `id + repeatStart` group inside the row (overlap dedupe, look-back and clamping all
   respected). The invalid-record skip in `computeAllDaySpans` stays for one-offs only.
5. **Repair a stored `endDate <= date` on a repeat.** In edit mode, if the record repeats and `endDate <=
date`, the baseline carries the raw `endDate`, so any save writes the cleared value.
6. **Per-day surfaces, decided:** the in-app bell (`notifications.ts:352-386`) stays per covered day ("what's
   on today"); critical-item duties stay per covered day (needed for per-day ticks); the upcoming list
   (30 cap) and the Nook's week items will show each covered day, as one-offs do. Also: `upcomingActivities`
   month stepping normalised through `Date` (one line, now on the look-back path).

## Files Affected

- `src/utils/date.ts` — `daysBetweenYmd`
- `src/utils/calendar/activityDays.ts` — `spanOffsetDays`, `shiftSpan`, `withRebasedEndDate`,
  `minRepeatGapDays`
- `src/utils/calendar/occurrence.ts` (new) — `ActivityOccurrence`, `occurrenceStart`, `isContinuationDay`
- `src/utils/allDaySpans.ts` — repeat spans, `startYmd`, logged branches
- `src/stores/activityStore.ts` — `repeatStartsInRange`, `coveredDays`, expansion, `repeatStartFor`,
  `auditRepeatSpans` + watch, split/override rebase, `completionsForDerived`
- `src/utils/wallActivities.ts`, `src/components/planner/MonthChip.vue`, `src/utils/notifications.ts` —
  type aliases; wall click date
- `src/components/planner/WeeklyCalendarView.vue` — span key + click
- `src/composables/useActivityScopeEdit.ts` — `openViewModal` normalisation, 'all' length conversion, delta
- `src/components/planner/ActivityModal.vue` — Lasts field, payload, validation
- `src/components/planner/ActivityViewEditModal.vue` — Lasts display, read-only for repeats, reschedule seed
- `src/composables/useScheduledReminders.ts`, `src/utils/helpfulHints.ts`
- `src/services/translation/uiStrings.ts`
- Tests for each of the above

## Observability Coverage

All from ONE change-gated `watch` on `activities` in the store running the pure `auditRepeatSpans` (the
expansion itself never logs; it runs inside computeds):

- **`activity-schedule` / info / `multi_day_repeats`** — `context: { action: 'audit', count }`, emitted on
  change including 0 once (rate baseline). Answers greg's "how many families have them".
- **`activity-schedule` / warn / `multi_day_repeat_overlap`** — repeats whose span reaches the next start
  (`spanOffsetDays >= minRepeatGapDays`): `context: { action: 'audit', error_code: 'repeat_overlap', count }`.
- **`activity-schedule` / warn / `repeat_end_before_start`** — a repeat with `endDate < date` (read as a
  single day): `context: { action: 'audit', error_code: 'repeat_end_before_start', count }`; ids in
  `message`.
- **`activity-schedule` / warn / `repeat_span_clamped`** — offset > 366: same shape, `error_code:
'span_clamped'`.
- **`activity-override` / info** — existing `override-*` events gain `stage: 'length-rebased'` when a span was
  carried onto a moved/derived record.
- `allDaySpans` drift / invalid-record branches move from bare `console.warn` to `logEvent`.
- No new context keys (`activity_id` stays out; ids go in `message`). Nothing critical. Follow-up (adjacent):
  `buildReminderSchedule`'s catch (`useScheduledReminders.ts:123`) only `console.warn`s.

## Acceptance Criteria

- [ ] An imported-shape weekly Fri–Sun all-day activity spans Fri–Sun every week in the week, month and wall
      views, and shows on Sat and Sun in the day views.
- [ ] A repeat starting on the last day of a month still shows its tail in the next month.
- [ ] Clicking any day of a repeat opens that repeat; "this only", "this and future" and "all" edits keep
      each repeat's length, including a move; no record ever gets `endDate < date`.
- [ ] Editing one day of a repeat keeps the duty ticks of its other days.
- [ ] The form shows "Lasts N days" for repeating all-day activities; changing it changes every repeat's
      span; the view modal shows "Lasts N days".
- [ ] One generic reminder per repeat, not one per covered day; one party hint per event.
- [ ] Google export and clash detection unchanged (existing tests green).
- [ ] Diagnostic logging in **Observability Coverage** implemented and verified (events fire with the
      stated `surface`/`context`; failure modes are triageable from CloudWatch without a local repro; any new
      context key is allowlisted + declared)
- [ ] `npm run validate` green; i18n `en` + `beanie`; both themes for the new field.

## Testing Plan

1. Unit: helpers (spanOffsetDays, shiftSpan, withRebasedEndDate, minRepeatGapDays); expansion (weekly Fri–Sun per covered day with
   `repeatStart`; month look-back; overlap dedupe; override of one repeat suppresses all its days; one-off
   unchanged); `repeatStartFor`.
2. Unit: split / override / update rebase; completions carried for covered days.
3. Unit: `computeAllDaySpans` repeat spans (two repeats in one row, tail-only repeat), keys.
4. Component: ActivityModal Lasts field seed + payload; view modal "Lasts".
5. Unit: reminders one per repeat; hints once per event.
6. Unit (pass 4): a duty tick from a continuation day lands on that day; inline 'all' date move and a second
   reschedule of a multi-day child keep the length; Lasts 3→1 with a move clears the span; a stored
   `endDate < date` is cleared on save; overlapping legacy record draws one bar per day; look-back for legacy
   and rule yearly (Dec 31 start, January tail), biweekly, monthly-by-day; a rule series ending mid-span
   keeps its last tail; `shiftSpan` across a DST week; Google export + clash unchanged
   (`dayOffset` → `daysBetweenYmd` parity).
   Unit (pass 3): multi-weekday weekly cap; `repeatStartFor` equals the drawn repeat on an overlapping legacy
   record; `auditRepeatSpans`; moving a ONE-OFF is unchanged (regression guard).
7. Browser (scratch spec, never in `e2e/specs/`): seed a weekly Fri–Sun activity; week, month, day (desktop
   and phone), wall; click a Sunday; light + dark for the form field.

## Review Passes

- **Pass 1 (Initial draft)**: per-covered-day expansion with `repeatStart`, look-back, relative `endDate`
  model with rebase helpers, click normalisation, spans by repeat, Lasts field, reminder/hint dedupe.
- **Pass 2 (DRY + error handling)**: one `spanOffsetDays` for all all-day records (replacing three inline
  copies) and one signed `daysBetweenYmd`; clicks normalised once in `openViewModal` (covers the Nook + deep
  links); the view modal's inline-edit and reschedule paths covered; look-back reuses the month walker (no
  recursion, no 62 cap); one occurrence type; one `isContinuationDay` rule; bare warns replaced by logged
  events; out-of-range length is a validation error, not a silent clamp.
- **Pass 3 (Sustainability)**: `updateActivity` stays a plain write (`withRebasedEndDate` at three explicit
  call sites); one `shiftSpan` primitive; Lasts cap from the rule's smallest start gap (multi-weekday safe);
  `repeatStartsInRange` reuses `occurrencesInRange` / `distinctMonths` with one override filter;
  `repeatStartFor` built on the expansion; telemetry moved out of the pure expansion into a change-gated
  `auditRepeatSpans`; one `occurrence.ts` aliasing all four copies incl. `NotificationOccurrence`;
  `isAllDay === true` kept to avoid a behaviour change.

- **Pass 4 (Fresh-eyes sweep)**: duty ticks keep the clicked day (only scope/edit use the repeat start);
  `repeatStart` on one-offs too; two more moving call sites; `'endDate' in patch` semantics; span range from
  emitted days (overlap-safe); stored `endDate < date` repaired on save; Lasts cap unified on
  `minRepeatGapDays`; older-client corruption acknowledged and shown as one day; bell / critical-item /
  upcoming behaviour made explicit with tests.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### 2026-09-27

"ok all tested and looks good, what decision exactly do you need from me regarding the end date? what does
it mean when you say 'what does an end date mean'? what are the options?"

"I am ok to go with (a) with (A1) - is it the case that that is easier, and the effect is just that families
hit by the old bug will now see the correct duration for their activities? if that is the case i think we
sould do it that way ratehr than having a split in the code. what do you think?"

"yes go ahead with beanies build auto"

"once the plan is done directly implement with /beanies-build-auto" (pre-approval of this plan)
</details>

## Outcome (2026-09-27, implementation)

Built per the plan (A–H) with these recorded deviations:

- `repeatStartsInRange` is `expandMonthStarts` walked per month with `distinctMonths` (one path for the rule
  and legacy engines, one override filter), rather than a single `occurrencesInRange` call.
- `computeAllDaySpans` buckets a one-off with `endDate < date` as a single day (not a skip), matching
  `expandOneOff`, which now draws such a record as one day instead of nothing.
- A multi-day bar clicked in the week view or on the wall opens on the first VISIBLE day of its bar (duty ticks land
  on a day on screen); edits normalise to the repeat start via `repeatStartFor`.
- `shiftSpan` / `withRebasedEndDate` preserve ANY `endDate` offset (`endDateOffsetDays`), timed or all-day, so
  a split or move of a timed Fri 18:00 – Sun 18:00 import keeps its Google length; `spanOffsetDays` stays the
  all-day subset the calendar draws across days.
- The Lasts range rule only checks a CHANGED value, so legacy or imported repeats that already exceed the
  cap still save; the form seeds a repeat's one-off end date relative to the opened occurrence.
- Browser verification caught three views (week, month cells, wall) rebuilding occurrences without
  `repeatStart`; all pass the occurrence through now (month cells regression-tested).
- Five occurrence-type copies now alias `calendar/occurrence.ts` (plus `clashDetection` and the planner views'
  local types).

Follow-ups (not in scope): drawing the next-morning tail of an overnight TIMED event; timed multi-day repeats
still render on their start day only (Google and clash detection honour their length); the remaining
`rule`-blind repeat checks; `activity_id` not in `ALLOWED_CONTEXT_KEYS`.

### Review rounds two and three (greg approved a third, "clear all pending issues")

- **Structural:** the "a date move carries the span" rule now lives ONCE in `activityStore.updateActivity`
  (series + override children; plain one-offs keep their absolute end), replacing six hand-applied call
  sites. `updateActivity(id, input, { source })` names the path for the `span_rebased` event, which fires
  only after a successful write. Creation paths tag their own success events (`series-split`,
  `override-created`: `stage: 'length-rebased'`, the latter only for a rescheduled occurrence).
- **Forms that SHOW an end date send it when the start moves** (the one-off form, and the view modal's
  reschedule pane via the pure `utils/calendar/rescheduleDelta.ts`), so the store rule never overrides the
  end on screen. The payment-only save strips `endDate` with the other schedule fields.
- `repeatStartFor` answers for one-off trips too (their real start), so a trip's reschedule base is never a
  continuation day.
- Lasts: seeded from `endDateOffsetDays` (timed spans too); the cap is waived only when mode, all-day, rule
  and Lasts are all unchanged since the form opened, and never in the AI update flow. A timed record's
  `endDate` is preserved in the payload (relative to the form date) instead of being cleared.
- Diagnostics use fixed messages with structured codes; ids go to the local console only (`activity_id` is
  not allowlisted; allowlisting it is greg's call, with the store-declaration update).
- Copy: the split option "By Label" is now "Custom" ("Custom split" caption, overview hint and help article
  aligned).

Not re-reviewed after round three's fixes (greg capped it there); every fix has a regression test and the
browser scenarios were re-run green.
