# Plan: List link picker misses future activities (cap is on occurrences, not distinct activities)

> Date: 2026-07-12
> Related issues: None — direct implementation (no GitHub issue, per intake)
> Plan file: `docs/plans/2026-07-12-linkable-activities-picker.md`

## User Story

As someone linking a Beanie List to an activity, I want to find and pick **any** upcoming activity — including one-offs weeks or months in the future — so a list can be attached to the thing it's actually for, no matter when it happens.

## Context

The list → activity link picker (`ListDetailModal.vue:200-210`) builds its candidate list from `activityStore.upcomingActivities`, then de-dupes by `activity.id`. But `upcomingActivities` was purpose-built for the near-term "upcoming" widgets and has two limits wrong for linking:

1. **A 3-calendar-month window** — it expands only the current month + next 2 (`for i in 0..2`).
2. **A `.slice(0, 30)` cap applied to OCCURRENCES, not distinct activities** — sorted soonest-first.

Recurring activities generate many near-term occurrences (a family with several weekly kids' activities easily exceeds 30 occurrences in the current month), so those fill all 30 slots. A future one-off activity is pushed past the cap and never reaches the picker — which only then de-dupes what little remains. Result: **you cannot link a list to a next-month (or later) activity.**

**Travel is unaffected** — `vacationStore.upcomingVacations` (`vacationStore.ts:43-48`) returns all non-past trips with no window and no cap, so the trip picker already works indefinitely. Only the activities side is broken. The near-term widgets that legitimately use `upcomingActivities` (nook "this week" / today count via `ScheduleCards`, `FamilyStatusToast`, `MeetTheBeansPage`; `DayAgendaSidebar` has its own local computed) filter to today/this-week anyway, so they must stay on the existing getter unchanged.

The fix: a **dedicated candidate list for the picker** — each active activity once, by its next occurrence ≥ today (a one-off by its own date → indefinite future; a recurring by its soonest upcoming occurrence), sorted soonest-first; the picker's search filters the full list and the display is bounded to 50.

## Requirements

1. Add an `activityStore` getter that returns, for the link picker, **each active family activity once**, keyed by its **next occurrence on-or-after today**:
   - `recurrence:'none'` → its own date (so a one-off appears **indefinitely** into the future); excluded only if it is entirely in the past.
   - recurring → its **soonest** occurrence ≥ today; excluded if the recurrence has ended (past `recurrenceEndDate`) or has no upcoming occurrence.
2. Return the full distinct list **sorted** by next-occurrence date (then `startTime`). The **50-cap is a display bound applied in the component AFTER the search filter** (see Approach §2 / Requirement 7) — so search always reaches every activity.
3. Wire `ListDetailModal`'s activity picker to the new getter, replacing the `upcomingActivities`-based source **and** its now-redundant post-hoc de-dupe (each activity already appears once).
4. **No behaviour change** to `upcomingActivities` or the near-term widgets that use it. **No change** to the travel picker (already correct) or the linked-name resolvers (they read the full store, so a far-future/filtered link already renders its name).
5. **Member filter:** the picker shows **all active family activities**, independent of the global member-filter chip — use `activeActivities` (active, un-member-filtered), not `filteredActivities`. (Any family activity should be linkable regardless of who's currently filtered in; confirm in review.)
6. **No silent failures.** A malformed activity (missing / `NaN` date) is caught and routed through **`reportError`** (severity `warning`, the same structured pipeline `expandRecurring` already uses) and skipped — never a bogus sort key, never a crash. (The one-off branch reads `activity.date` directly, bypassing `expandRecurring`, so it MUST validate the date itself.)
7. The picker's **search filters the full candidate list, then the display is sliced to 50** — the cap never blinds search (that would re-create a milder version of the bug being fixed).

## Important Notes & Caveats

- **Reuse `expandRecurring`** (`activityStore.ts`) to find a recurring activity's next occurrence — do NOT re-implement recurrence math. No cheaper activity-next-occurrence helper exists (verified: `recurringProcessor.getNextDueDate` operates on `RecurringItem`, a different domain model).
- **⚠️ Normalize the month through a `Date` on every forward step — do NOT pass `month + i`.** `expandYearly` (`activityStore.ts:290-303`) guards with a **raw month-integer** comparison (`startDate.getMonth() !== month`), unlike the other branches which compare normalized `Date`s. Passing an un-normalized `month + i` (e.g. `6 + 8 = 14`) makes the yearly guard `2 !== 14` → always `[]` → a still-active yearly activity is **wrongly excluded**. Walk via `new Date(base.getFullYear(), base.getMonth() + i, 1)` and pass its proper `getFullYear()`/`getMonth()` (0-11). **Also add a one-line comment AT `expandYearly` (`:297`)** recording the raw-integer invariant so the landmine isn't only documented in the new getter. (Root-fix option — normalize `month` once at the top of `expandRecurring` so no caller can ever trip it — is deliberately DEFERRED: it's shared, hot code and would also change `upcomingActivities`'s behaviour for a far-month yearly (a latent-bug fix, but a shared-behaviour change beyond this fix's scope). Recorded here as a recommended future cleanup; the self-contained Date-walk + the comment cover this change safely.)
- **Take the MINIMUM matching occurrence in the month, not `results[0]`.** `expandRecurring` is NOT globally sorted (`expandPeriodic` pushes per-`targetDay`, `:86-111`), so for a multi-day-of-week weekly activity the array is interleaved. In the current month also drop occurrences `< todayStr`. So: `monthOccs.filter(o => o.date >= todayStr).reduce(min)`, and stop at the first month that yields any.
- **Yearly needs a ~13-month bound.** Daily/weekly/biweekly/monthly/monthly-by-day yield a next occurrence within the current or next month; `yearly` can be up to ~12 months out. Bound the forward walk at **13 months**; if nothing is found, exclude (defensive — a still-active yearly always has one within a year).
- **One-offs never need month expansion** — the crux of the fix. Read the activity's `date` directly, but **validate it via a shared predicate**, not a second copy of the rule: extract `isValidActivityDate(activity)` (`!!date && !Number.isNaN(parseLocalDate(date).getTime())`) so there is ONE source of truth for "valid activity date"; on invalid → `reportError(warning)` + skip. **The multi-day relevance rule must GENUINELY mirror `expandOneOff` (`:217-218`), which gates multi-day on `isAllDay && endDate` — NOT `endDate ?? date` (a _timed_ one-off carrying an `endDate` must NOT be kept alive by it).** And the returned key MUST honour the getter's "next occurrence ≥ today" contract — an _ongoing_ multi-day all-day (start past, end future) must surface **today**, not its past start (else it sorts above every genuinely-upcoming activity and shows a past date). So:
  ```
  const startYmd = activity.date.slice(0, 10);
  const lastRelevant = (activity.isAllDay && activity.endDate) ? activity.endDate.slice(0, 10) : startYmd;
  if (lastRelevant < todayStr) return null;          // past-only → excluded
  return startYmd < todayStr ? todayStr : startYmd;  // ongoing multi-day → today; else its own date
  ```
  Comment that this rule is intentionally kept in sync with `expandOneOff`. (Direct-read is the pragmatic choice to avoid month-selecting a far-future one-off through `expandRecurring`.)
- **Accepted edge:** a `yearly` activity whose _first_ occurrence is >13 months out is excluded by the 13-month bound, while an equally-distant _one-off_ is included (indefinite). A tiny internal asymmetry, accepted — a yearly that hasn't had its first occurrence in over a year is a corner case not worth special handling.
- **Distinct by construction** — one entry per `activeActivities` item, so the picker drops its `seen`-Set de-dupe (`ListDetailModal.vue:201-208`).
- **Return `{ activity, date }[]`** — the shape every other occurrence-producing store member uses (`monthActivities:310`, `activitiesForDate:582`, `upcomingActivities:342`). The `{id,title,date}` mapping is a view concern that stays in the component.
- **Read the store's existing `todayRef.value`** (`activityStore.ts:341`, a `YYYY-MM-DD` string from `useToday`) — no new `useToday()` call, no `new Date()`.
- **Per-activity `try/catch` backstop** around `nextOccurrenceYmd` → `reportError` + skip, so one corrupt record can never break the whole picker (belt-and-suspenders atop the explicit date validation — the two layers are non-redundant: the validation catches the _silent_ bad-date case, the catch handles _unexpected throws_). Give BOTH the same `surface` (e.g. `'activityStore.linkableActivities'`) + `severity: 'warning'` so both routes are greppable.
- **Recorded future-consolidation (no action now):** the "walk months forward, `expandRecurring`, collect `date >= todayStr`" pattern now exists twice — `upcomingActivities:348-359` (3-month) and this getter (13-month, take-min). Not refactored now (different window/cap contracts + the risk of touching the hot near-term getter), but a candidate for a shared `nextOccurrence(activity, fromYmd)` helper later — which is also where the deferred `expandYearly` root-fix would naturally land.
- **Override children appear alongside their parent — known, unchanged.** `activeActivities` includes materialised-override children (`recurrence:'none'`, `parentActivityId` set), so a series with a rescheduled/edited occurrence lists BOTH the parent (by its next non-overridden occurrence) and the child one-off (different `id`s, different dates). This exactly matches the current `upcomingActivities`-based picker (its de-dupe is by `id`, which never collapsed them either) — so it's not a regression, and no de-dup-by-parent is added here.
- **No new UI** — same picker, correct data. No mockup. Not Help-Center-worthy (bug fix to a picker's data source; no new user capability).
- **Informational (NOT this fix):** the `upcomingActivities` doc comment (`:335`) claims it "Excludes vacation-linked activities," but the code does not filter `vacationId` — so vacation-linked activities are already in the picker today, and switching to `activeActivities` doesn't change that. Whether to hide them is a separate decision, out of scope here.

## Assumptions

> Review before implementation — valid at planning time, may have moved.

1. `activeActivities` (`:45`) = active, NOT member-filtered; `filteredActivities` (`:49`) = member-filtered. Using `activeActivities` shows all family activities (verified).
2. `expandRecurring(activity, year, month)` returns the month's occurrences with `date` as `YYYY-MM-DD`, excludes materialised overrides (`:203-206`), and surfaces invalid-date activities via `reportError` returning `[]` (`:132-145`) (verified).
3. Recurrence kinds are `none | daily | weekly | biweekly | monthly | monthly-by-day | yearly`; `yearly` is the only next-occurrence that can be >2 months out (verified).
4. `ListDetailModal.vue:200-214` is the only consumer needing far-future activities; the others filter to today/this-week (`ScheduleCards`, `FamilyStatusToast`, `MeetTheBeansPage`; `DayAgendaSidebar` has its own computed) (verified via grep).
5. The picker's linked-name resolvers already read the full store, so no change is needed for a far-future/filtered link to render its name (verified `:218-224`).

## Approach

### 1. New getter `linkableActivities` (`activityStore.ts`)

A computed returning each active activity once, by its next occurrence ≥ today, sorted — **uncapped** (the display cap lives in the component, Requirement 7):

- `todayStr = todayRef.value`; `base = parseLocalDate(todayStr)`.
- Shared predicate `isValidActivityDate(activity)` = `!!activity.date && !Number.isNaN(parseLocalDate(activity.date).getTime())` (ONE source of truth for the one-off branch's validation).
- Internal `nextOccurrenceYmd(activity): string | null`:
  - `recurrence === 'none'`: if `!isValidActivityDate(activity)` → `reportError({surface:'activityStore.linkableActivities', severity:'warning'})` + `null`. `startYmd = activity.date.slice(0,10)`; `lastRelevant = (activity.isAllDay && activity.endDate) ? activity.endDate.slice(0,10) : startYmd`; if `lastRelevant < todayStr` → `null` (past-only); else return `startYmd < todayStr ? todayStr : startYmd` (ongoing multi-day → today; else its own date — honours the ≥-today contract).
  - recurring: if `recurrenceEndDate` present and `< todayStr` → `null` (ended). Else for `i = 0..12`: `d = new Date(base.getFullYear(), base.getMonth()+i, 1)`; `occs = expandRecurring(activity, d.getFullYear(), d.getMonth())`; `hit = occs.filter(o => o.date >= todayStr)`; if non-empty → return its **min** date; else continue. After 13 months with no hit → `null`.
- Build `[{ activity, date }]` for every `activeActivities` entry whose `nextOccurrenceYmd` is non-null, each wrapped in `try/catch` → `reportError` (same surface/severity as above) + skip on throw; sort by `(date, activity.startTime ?? '')`. Export in the store return.

### 2. Wire the picker (`ListDetailModal.vue`)

**Rename** the component's local computed `upcomingActivities` → `linkableActivityOptions` and update its two references (`filteredActivities:214`, empty-state `:496`). Keeping the old name would mislead the next maintainer into assuming window/cap semantics it no longer has. **Precise change (3 local sites + 1 store-source swap):** the _definition_ (`:200`), `:214`, `:496` are the LOCAL computed → rename. Inside the definition, `:204`'s `activityStore.upcomingActivities` is the _store_ getter (a different symbol) → **replace** it with `activityStore.linkableActivities.map(...)`; do NOT blanket-rename it. (Local named `…Options` to avoid a same-name collision with the store getter — it's the `{id,title,date}` view-mapping.)

```
const linkableActivityOptions = computed(() =>
  activityStore.linkableActivities.map(({ activity, date }) => ({
    id: activity.id, title: activity.title, date,
  }))
);
```

Apply the display-cap AFTER search so the cap never blinds search (Requirement 7), via a **named component-local constant** (not a bare literal — and document the trip/activity asymmetry, since `filteredTrips:213` is deliberately uncapped: trips are naturally few, activities aren't):

```
// Display bound for the activity picker only. Trips (filteredTrips) are naturally
// few and stay uncapped; activities can be many, so we bound the rendered rows —
// AFTER the search filter, so search always reaches the full list.
const LINK_PICKER_MAX_ACTIVITIES = 50;
const filteredActivities = computed(() =>
  linkableActivityOptions.value.filter((a) => matches(a.title)).slice(0, LINK_PICKER_MAX_ACTIVITIES)
);
```

(No-search → soonest 50; searching → filters the full list, shows top-50 matches. Honors the user's logged "50" as a display bound without the search-blindness footgun. The scroller `max-h-44 overflow-y-auto` at `:502` already handles length.)

### 3. Nothing else

`upcomingActivities` (store) untouched; travel picker untouched; linked-name resolvers untouched.

## Files Affected

- `src/stores/activityStore.ts` — new `linkableActivities` getter (+ internal `nextOccurrenceYmd` reusing `expandRecurring`, yearly-safe normalized month walk, shared `isValidActivityDate` predicate, `reportError` on bad dates); export it. Add a one-line invariant comment at `expandYearly` (`:297`).
- `src/components/lists/ListDetailModal.vue` — rename the local `upcomingActivities` computed → `linkableActivityOptions` (update `:214` + `:496`); replace `:204`'s `activityStore.upcomingActivities` with `activityStore.linkableActivities.map(...)` (drop the de-dupe); `LINK_PICKER_MAX_ACTIVITIES` constant + cap applied in `filteredActivities` after search.
- Tests: `src/stores/activityStore.test.ts` — `linkableActivities` unit tests (see Testing).

## Acceptance Criteria

- [ ] A one-off activity dated arbitrarily far in the future appears in the link picker, even with >30 near-term recurring occurrences present.
- [ ] Each activity appears exactly once; the list is sorted soonest-first.
- [ ] A recurring activity appears by its soonest upcoming occurrence — **including a `yearly` activity whose anniversary is many months out** (regression guard for the normalized-month walk); an ended recurring (past `recurrenceEndDate`) does not appear; a past-only one-off does not appear; an ongoing multi-day/all-day activity (start past, end future) appears **keyed on today** (not its past start).
- [ ] The picker shows all active family activities regardless of the member-filter chip.
- [ ] Search filters the full list; the display is bounded to 50 (search can reach a 51st+ activity).
- [ ] `upcomingActivities` and the near-term widgets + travel picker are unchanged.
- [ ] A malformed activity is caught via `reportError` and skipped — never a bogus row, never a crash.
- [ ] type-check + lint + unit suite green.

## Testing Plan

1. **Unit — `activityStore.linkableActivities`**: seed a weekly + daily recurring (current month >30 occurrences) + a one-off 3 months out → the one-off IS present and distinct; recurring appear once by soonest date; **a `yearly` activity with an anniversary ~8 months out IS present** (fails without the normalized-month fix); an ended recurring (past `recurrenceEndDate`) absent; a past-only one-off absent; an ongoing multi-day all-day present; result sorted; independent of the member filter (set a filter, confirm the list is unchanged); a multi-`daysOfWeek` weekly returns its soonest (min) upcoming date, not an interleaved earlier-in-array one; an ongoing multi-day all-day (start last week, end next week) surfaces with date `== todayStr`.
2. **Unit — malformed data**: an activity with a missing/garbage `date` → skipped, `reportError` called (warning), no throw, other activities still returned.
3. **Component — `ListDetailModal`** (thin, only if a harness is feasible): the picker lists a far-future one-off; typing in search filters the full list and can surface an activity beyond the first 50.
4. **Manual (dev)**: several recurring kids' activities in the current month + a one-off next month → open a list → link activity → it's present and selectable; near-term nook widgets + travel picker unchanged.
5. `npm run type-check`, `npm run lint`, unit suite, build.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted from the traced diagnosis. Root cause = the picker reuses `upcomingActivities` (3-month window + 30-occurrence cap) flooded by recurring occurrences. Fix = a dedicated `linkableActivities` getter (distinct activities by next occurrence ≥ today; one-offs indefinite via their own date, recurring via a bounded `expandRecurring` forward walk), sorted; picker wired to it, de-dupe dropped; near-term widgets + travel untouched; member-filter-independent (`activeActivities`).
- **Pass 2 (DRY + error handling)**: Caught a real bug — the recurring forward-walk passed an un-normalized `month+i`, which `expandYearly`'s raw-integer month guard rejects → yearly activities silently excluded; fixed to normalize each step through a `Date` (+ a yearly regression test). Made the recurring pick the MIN matching occurrence (expandRecurring isn't globally sorted) and drop `< today` in the current month. Routed bad-date handling through `reportError` (not `console.warn`) and added explicit date validation on the one-off branch (a garbage string would otherwise produce a silent bogus row). Settled the return shape to `{activity,date}` (store convention). Resolved the 50-cap ambiguity: uncapped getter, cap applied in the component AFTER search so search reaches the full list (else it re-creates a milder version of the fixed bug). Confirmed `expandRecurring`/`activeActivities`/`todayRef` are the correct reuse targets (no cheaper helper exists).
- **Pass 3 (Sustainability)**: Renamed the component's local computed to `linkableActivities` (keeping the old `upcomingActivities` name would mislead a maintainer into assuming window/cap semantics it no longer has — 3-site rename beats a misleading name). Constant-ized the 50-cap (`LINK_PICKER_MAX_ACTIVITIES`) + documented the deliberate trip-uncapped/activity-capped asymmetry. Extracted a shared `isValidActivityDate` predicate so the one-off branch doesn't own a second copy of "valid activity date," and flagged that its multi-day relevance rule is intentionally mirrored from `expandOneOff` (kept-in-sync comment). Added an invariant comment at `expandYearly` for the raw-month landmine (root-fix — normalize in `expandRecurring` — recorded as deferred future cleanup, not done, to avoid a shared-behaviour change). Gave both error routes the same `surface`/`severity`. Acknowledged the yearly-first-occurrence->13mo edge. Confirmed the forward-walk shape + two-layer error handling are clean and testable via the public getter.
- **Pass 4 (Fresh-eyes sweep)**: Caught one real correctness gap — the one-off relevance rule diverged from `expandOneOff` (it gated multi-day on `endDate ?? date`, but `expandOneOff` gates on `isAllDay && endDate`, so a _timed_ one-off carrying an `endDate` would wrongly survive), AND it returned a _past_ date key for an ongoing multi-day activity (sorting it above every upcoming activity and showing a past date). Fixed: gate on `isAllDay && endDate`, and clamp the returned key to `max(start, today)` so an ongoing multi-day surfaces on **today** — honouring the getter's "next occurrence ≥ today" contract. Clarified the component wiring as "3 local renames + 1 store-source swap" (`:204` is the store getter — replace, don't rename) and named the local `linkableActivityOptions` to avoid a same-name collision. Added a note that override children legitimately appear alongside their parent (matches current behaviour — not a regression). Verified as sound (no change): the post-cap `filteredActivities` consumers, the current-month `< today` min-reduce, and the 13-iteration bound (needed for a same-month yearly whose day already passed).

## Prompt Log

> No GitHub issue created. This plan was approved for direct implementation.

<details>
<summary>Full prompt history</summary>

### Initial Prompt (assembled via /beanies-pre-plan → /beanies-plan)

The `=== BEANIES PRE-PLAN ===` block: list→activity link picker misses future activities because it reuses `upcomingActivities` (3-month window, 30-OCCURRENCE cap) which recurring activities flood; give the picker a dedicated distinct-activity candidate list by next occurrence ≥ today (one-offs indefinite, recurring soonest), sorted + capped at 50; travel unaffected; near-term widgets untouched; Type bug, Priority medium, no GitHub issue, ungated.

### Decisions (pre-plan AskUserQuestion)

Priority: Medium · Cap: 50 distinct activities · GitHub issue: Skip · Feature gate: Ungated. Member-filter (show all family activities) + recurring-window bound parked as Open Questions for the plan.

</details>
