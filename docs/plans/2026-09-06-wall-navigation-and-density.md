# Plan: Beanie wall — navigation, responsive density, and space reclamation

> Date: 2026-09-06
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-09-06-wall-navigation-and-density.md`

## User Story

As a family with a beanie wall in the kitchen, I want to look ahead to next week and back at
a specific day, and I want the wall to use the screen it is hung on — filling a large display
without wasting it, and staying readable on a small one — so that the wall is worth looking at
before we announce it publicly.

## Context

The beanie wall shipped as #78 and the time grid landed three days ago (`5539624c`). It is
about to be announced on the blog, and greg has found five things that should be fixed before
it meets the public.

The wall today has **no date navigation at all**. `weekDays` is derived directly from
`useToday()` as a rolling `today + 6` (`BeanieWallPage.vue:103-104`), and `useToday` is a readonly
module singleton that cannot be written to. The only date state anywhere in the wall is
`WallTodayView`'s local `focusYmd` (`:59-65`), which is destroyed on every view switch because
all four views render through a single `<component :is>` (`BeanieWallPage.vue:367-386`).

The grid's sizing is deliberate and heavily documented. `NATURAL_PX_PER_MIN = 0.8`
(`wallTimeGrid.ts:60`) is a **ceiling**, not a target: the docblock records that the grid once
divided available height among the day's live minutes, so "a quiet day STRETCHED to fill the
screen: two events and one of them half a wall." That is the "absurdly tall cards" greg
remembers. `MAX_BLOCK_PX = 190` was the fix. On large, high-resolution displays that flat cap
now leaves the screen underused.

## Requirements

> ⚠️ These nine map one-to-one onto greg's five asks. Requirement 7 was folded into the
> navigation prose in an early draft rather than numbered, and a later review pass consequently
> read it as invented scope and cut it. It is numbered here so that cannot recur.

1. **Date navigation, per view.** Days view steps by week; today view and lanes view step by
   day. The jobs board has no date concept and gets no navigation.
2. **One date concept for the whole wall.** An `anchorYmd` lifted to `BeanieWallPage.vue`,
   surviving view switches, replacing `WallTodayView`'s `focusYmd` rather than sitting beside it.
3. **Week steps snap to calendar weeks**, honouring the user's existing `weekStartDay`
   setting (0=Sun / 1=Mon, default Monday — `settingsStore.ts:137`) — not a hardcoded Monday.
4. **The default stays forward-biased.** On load the wall shows `today + 6`, preserving the
   documented "what is coming, not what has gone" intent. Navigation moves to whole calendar
   weeks; a "back to today" affordance returns to the rolling default.
5. **Block max height scales with available vertical space**, with a floor at today's value
   and a sane ceiling. Responds to **viewport size, never to content**.
6. **A scroll fallback on small screens**, engaging only below a readability floor, replacing
   the current behaviour of compressing indefinitely. ⚠️ **Closed by measurement, not by code, in
   this change** — see §4 and Testing Plan step 1.
7. **In days view, tapping a day re-anchors the grid to start at that day** — the today view's
   convention, rather than opening the details drawer. greg's words: _"if the weekly view starts
   on sat, and i select the thursday card, then the view redraws to start from thursday."_
   Applies in both orientations.
8. **Days view gains the right rail** used by today/lanes — but only when there is width for
   it, falling back to the band below the threshold.
9. **The chore board reclaims space from members with nothing assigned**, giving it to members
   who do have lists. A member who has _finished_ their jobs keeps their full column.

## Important Notes & Caveats

- **Do not make the grid stretch to fill.** Requirement 5 responds to the _viewport_, not to
  the day's content. The invariant "an hour is the same height on a quiet day and a busy one"
  is asserted by a test and is the reason the grid is readable at a glance. A quiet day should
  still look quiet — empty space is the honest signal, per the `NATURAL_PX_PER_MIN` docblock.
- ✅ **`defaultMaxBlock` already takes the height — verified.** `wallTimeGrid.ts:135` is
  `defaultMaxBlock(_availableHeight?: number)` and returns the flat constant; `:772` is
  `options.maxBlock ?? defaultMaxBlock(height)`, and `WallTimeGrid.vue:137-140` calls
  `layoutTimeGrid(columns, layoutHeight.value)` with **no `maxBlock` option**, where
  `layoutHeight` (`:107-110`) is the measured plot height behind its last-good guard.
  The plumbing is complete — **only the function body changes.** Do not re-plumb it.
- ⚠️ **CORRECTION (Pass 4). The 720px test does NOT break, and three earlier passes said it did.**
  The arithmetic behind the warning is right: `wallTimeGrid.test.ts:412-420` lays out at 720px
  and asserts BOTH a 480-minute and a 240-minute block are `capped`; at scale 0.8 the 240-minute
  block's raw height is **192px**, and `capped` is `raw > maxBlock` (`:650`), so it passes on a
  **2px margin**. But the proposed formula is `CAP_HEIGHT_FRACTION = MAX_BLOCK_PX / ref`, so at a
  plot height of 720 the cap is `max(190, 720 × 190/ref)` = **exactly 190 for every `ref ≥ 720`**,
  which the ≥720 floor already guarantees. **Nothing breaks.**
  Still pin the test — `layoutTimeGrid([...], 720, { maxBlock: MAX_BLOCK_PX })`, the option already
  exists — but for the honest reason: that test asserts the SOFTNESS of the cap and currently
  passes by two pixels of an unrelated default. Pinning makes it say what it means. Do it in the
  same commit, with a comment recording the 192-vs-190 margin.
- **`layoutTimeGrid` must stay pure.** It is the tested core. Height arrives as a parameter;
  keep it that way.
- **Do not reorder or extend `LADDER`** (`wallTimeGrid.ts:188-197`). A test asserts the frozen
  array and that `MAX_ATTEMPTS` matches the arithmetic.
- ⚠️ **The axis is NOT inside the plot.** `WallTimeGrid.vue:352-361` renders the axis gutter as
  a **sibling** of the plot (`:371-373`); only the plot carries the ResizeObserver. Any scroll
  design that moves the axis into the observed element risks the feedback loop the file's own
  docblock forbids ("Do not make a block affect the plot's own height").
- ⚠️ **`WallTimeGrid.vue`'s script ends at line 296.** Its docblock budget is "~300 lines … if
  this script grows past ~300 lines, something in it is a pure function that has not been moved
  out yet." There is **no headroom left**. Any addition to that file must first remove something
  from it. This is the single strongest argument for §4's demotion.
- **The week-start formula exists FIVE times**: `date.ts:204` (`monthGridRange`),
  `monthCells.ts:210`, `useCalendarNavigation.ts:76-79` (`getWeekStart`), `BeanieDatePicker.vue:122`,
  `CalendarGrid.vue:83`. This change adds the primitive and **does not write a sixth copy**; it
  also does **not** migrate the five, for the reason in §0.
- **A period-navigation cluster exists TWICE**: `ui/MonthNavigator.vue` (one consumer,
  `TransactionsPage.vue:977`) and the inline cluster at `CalendarCommandBar.vue:139-181`. This
  change adds a third, deliberately and with the consolidation recorded as one follow-up — see §0.
- **The `matchMedia` + listener + dispose triple exists TWICE in `BeanieWallPage.vue` alone**
  (`:86-95` `hasRoom`, `:134-142` `isPortrait`, disposed at `:259-260`) and four more times across
  `src/composables/`. The rail threshold would be the third copy _in one file_. Extract — see §0.
- ⚠️ **`parseLocalDate` never throws on a bad ymd.** `date.ts:483-489` returns an Invalid Date for
  garbage of length 10, and `toDateInputValue` then returns the literal string `"NaN-NaN-NaN"`.
  A bad anchor therefore propagates silently and permanently. Every write to the anchor must be
  validated — this is the single genuine silent-failure hole in this change.
- ⚠️ **`daysBetween` returns an ABSOLUTE value** (`date.ts:577-586` wraps the difference in
  `Math.abs`). It is fine for the drift clamp and useless for a signed offset. Anywhere this
  plan wants "how far from today, and which way", compute the delta explicitly.
- ⚠️ **`createChangeGate` suppresses identical signatures** (`src/services/telemetry/emitPolicy.ts:43-61`):
  it emits on change plus a 1-in-20 heartbeat. Its own docblock: "if a field can change without
  changing the signature, that change becomes invisible." **Corollary: a signature that changes on
  every call is a gate that never gates.** Do not add ceremony that does nothing — see Observability.
- ⚠️ **`formatWeekRange` takes `Date`, not ymd** (`useCalendarNavigation.ts:57`). The wall's label
  must `parseLocalDate` both ends.
- **Chore board idle ≠ finished.** Only `total === 0` is idle. `done === total && total > 0`
  is a _completed_ column and keeps its green ring (`WallChoreBoard.vue:172-176`) and star row
  (`:249-262`) — that is the reward mechanic.
- ⚠️ **There is no board-level empty state in `WallChoreBoard`.** Only a per-column
  `t('wall.jobs.none')` line, rendered twice per column (`:190`, `:242-247`). The all-idle case
  must be designed, not "reused".
- **Inline style backgrounds outrank `dark:` utilities.** `WallChoreBoard` paints
  `${member.color}2e` and `${member.color}0d` inline (`:180`, `:199`); the lane tint at
  `WallTimeGrid.vue:382-395` does the same. Any new painted surface needs an explicit
  `html.dark` partner or a custom-property indirection (CLAUDE.md).
- **Never write `:global(.dark) .foo` in a scoped block** — Vue drops the descendant and paints
  onto `<html>`. Use `html.dark .foo`.
- The wall type scale lives in ~60 `:deep(.wall-*)` rem rules in `BeanieWallPage.vue:482-777`,
  **not** in the components. New text sizes go there, rem-based.
- The wall is gated to viewports ≥600px on **both** axes (`BeanieWallPage.vue:86-95`), so the
  smallest target is a small tablet, not a phone.
- **Telemetry context keys are a cross-repo contract.** `diagnosticContext.ts:36-60` and the
  note at `:307-318` state the convention: REUSE `action` / `kind` / `stage` / `error_code` /
  `count` / `detail`. **This change adds none.**

## Assumptions

1. `weekStartDay` is the right preference to honour for the wall (it drives `BeanieDatePicker`
   and the month grid today).
2. Lanes view should follow the anchor for day stepping. It currently hardcodes
   `props.todayYmd` / `props.tomorrowYmd` (`WallLanesView.vue:61-62`) and `isToday: true` (`:99`).
3. ✅ **Confirmed by greg 2026-09-06 — not an open assumption.** Navigation state is
   session-only: not persisted, not in the URL, re-anchored to today on midnight rollover and
   on reload. A kitchen wall left on Thursday for three days showing stale dates would be a
   defect, not a feature.
   **Consequence, and it is load-bearing for §1:** the anchor has _no untrusted input path_.
   Every write is internally derived. A malformed anchor can therefore only be a programming
   error, which sets the appropriate response (a loud developer-facing clamp) and rules out an
   inappropriate one (a translated family-facing toast for a branch that should never fire).
4. The 296px rail width is correct for days view as it is for today/lanes.
5. No Help Center article is required: this is polish on an unannounced feature. **Revisit if the
   blog announcement links to help content describing wall navigation.**
6. Off-week, no day header carries the "today" gradient (`WallDaysView.vue:129-133`), so days
   view has no highlighted column. This is accepted: the navigator label is the orientation cue.
   Confirm it reads acceptably in the manual pass rather than inventing a second highlight state.

## Approach

The change lands as **three shippable commits plus one measurement**, in order. §0 is now two
**pure additions** — no existing file changes behaviour — so it cannot regress anything and needs
no cross-surface smoke check.

| Commit | Contents                                                                                       | Reverts cleanly?      |
| ------ | ---------------------------------------------------------------------------------------------- | --------------------- |
| A      | §0 — two new modules, zero call-site changes                                                   | yes, trivially        |
| B      | §1 + §2 — the anchor, its navigation, and day-tap re-anchoring                                 | yes                   |
| C      | §3 + §5 + §6 — density, rail, chore board                                                      | yes, independent of B |
| —      | §4 — **a measurement, recorded in this plan.** Code only if it fires, and then as its own plan | n/a                   |

### 0. Shared primitives — added, not retrofitted

**`src/utils/date.ts`** — the week-start primitive the wall needs, added beside the five existing
copies rather than replacing them:

```ts
/**
 * Days from `dayOfWeek` back to the week's first day, per the user's `weekStartDay`.
 *
 * ⚠️ FIVE independent copies of this expression exist as of 2026-09: monthGridRange (below),
 * monthCells.ts:210, useCalendarNavigation.getWeekStart, BeanieDatePicker.vue:122 and
 * CalendarGrid.vue:83. They are NOT migrated here — see the plan's §0 — but no sixth copy
 * may be written. Consolidating all five is a single follow-up with one owner.
 */
export function weekStartOffset(dayOfWeek: number, weekStartDay: number): number {
  return (dayOfWeek - weekStartDay + 7) % 7;
}

/** `YYYY-MM-DD` → the ymd of its week's first day, per the user's `weekStartDay`. */
export function startOfWeekYmd(ymd: string, weekStartDay: number): string {
  return addDaysYmd(ymd, -weekStartOffset(parseLocalDate(ymd).getDay(), weekStartDay));
}
```

⚠️ **The five-call-site migration is deferred.** Earlier passes required migrating
`monthGridRange`, `monthCells`, `useCalendarNavigation`, `BeanieDatePicker` and `CalendarGrid`.
Each substitution is trivially correct in isolation, but together they put the planner, the month
grid and the date picker into a commit whose entire user-visible outcome is _nothing_, days before
a public announcement. The formula being duplicated is a five-token modulo, not a decision — the
cost of a sixth reader learning it is close to zero, and the cost of a regression in the planner
right now is not. **The primitive lands with a caller (the wall); the migration is one follow-up.**
A welcome side effect: `date.test.ts` needs **no change to its existing expectations**, which also
removes the trap Pass 3 identified — rewriting them in terms of the function under test would have
made the test agree with any implementation, including a wrong one.

**`src/composables/useMediaQuery.ts`** — the query + listener + dispose triple, once. **KEPT**: this
is the one §0 item with a caller in this change _and_ a real defect class (a forgotten
`removeEventListener`) that it makes structurally impossible.

```ts
/**
 * A reactive media query, released with the owning scope.
 *
 * `BeanieWallPage` carried two hand-rolled copies of this (`hasRoom` :86-95, `isPortrait`
 * :134-142, both disposed at :259-260) and the rail threshold would have been a third IN ONE
 * FILE. SSR/jsdom-safe: no `matchMedia` means `initial`, and nothing to release.
 */
export function useMediaQuery(query: string, initial = false): Readonly<Ref<boolean>> { … }
```

Adopted here by `BeanieWallPage`'s `hasRoom`, `isPortrait` and the new `railWide`, deleting the
two bespoke handlers and their `onScopeDispose` lines.
**Deliberately NOT migrated**: `usePWA`, `useReducedMotion`, `useIsTouchPrimary`, `useBreakpoint`.
Each is a module-scoped singleton with app-lifetime listeners deliberately not released; folding
them into a scope-disposing helper is a different, riskier change. Note as a follow-up.

⚠️ **`src/components/ui/PeriodNavigator.vue` is NOT extracted.** Pass 2 proposed extracting the
prev / centre / next cluster rather than writing a third copy, and Pass 3 refined it to carry no
chrome and no size prop. Both refinements were right, and together they are the argument against
it: what remains is two icon buttons and two slots, with the caller owning every visual decision.
Three further points settle it:

- The plan already declines to adopt it in `CalendarCommandBar.vue:139-181` (its label sits
  outside the cluster behind a `Transition` documented as load-bearing, and it is covered by
  planner E2E). So the extraction leaves **two** copies either way. It consolidates nothing.
- Adopting it in `MonthNavigator.vue` means re-rendering the only navigator on
  `TransactionsPage.vue:977` — a visual-regression surface on a page with no relationship to this
  work, for no user-visible gain, immediately before a launch.
- A `ui/` component with exactly one consumer is the same maintenance liability this plan already
  rejects elsewhere ("an exported constant with no caller is a maintenance liability").

**Instead:** the wall header renders the cluster inline (~15 lines of template), reusing the
existing strings `planner.prevPeriod`, `planner.nextPeriod` and `date.today` — **no new strings**.
Record one follow-up: _consolidate all three period-navigation clusters (wall, `MonthNavigator`,
`CalendarCommandBar`) in a single change with one owner_, which is a better shape than a
two-of-three extraction done under launch pressure.

### 1. One anchor: pure policy in a util, thin wiring in a composable

The wall's stepping rules are a handful of table rows, a week-start snap, a clamp and a label. That
is _derivable-from-inputs_ logic, and this directory already has the pattern for it: `wallTimeGrid.ts`
is pure and total, `WallTimeGrid.vue` is thin, and the rule is written down. The anchor follows
the same split — which is also what makes it testable without mocking anything.

**`src/utils/wallAnchor.ts` — pure, total, no Vue, no stores, no `useToday`.**

```ts
export type WallStepUnit = 'week' | 'day';

/** Beyond this the wall is browsing somewhere nobody meant to go. */
export const MAX_ANCHOR_DRIFT_DAYS = 366;

/**
 * Signed days from `todayYmd` to `ymd`; NaN if either is unparseable.
 * ⚠️ `daysBetween` (date.ts:577-586) cannot be used — it wraps the difference in Math.abs.
 */
export function anchorOffsetDays(ymd: string, todayYmd: string): number;

/**
 * The only gate between a bad ymd and a permanently broken wall.
 *
 * ⚠️ `parseLocalDate` does NOT throw — `date.ts:483` returns an Invalid Date and
 * `toDateInputValue` then yields the literal string "NaN-NaN-NaN", so a bad anchor would
 * propagate silently and forever. Returns `todayYmd` for anything unparseable or beyond
 * MAX_ANCHOR_DRIFT_DAYS, so the wall always lands somewhere renderable.
 */
export function clampAnchorYmd(next: string, todayYmd: string): string;

/** The next anchor for a step. Week steps snap via `startOfWeekYmd`. */
export function nextAnchorYmd(
  anchor: string,
  todayYmd: string,
  unit: WallStepUnit,
  direction: -1 | 1,
  weekStartDay: number
): string;

/** Seven consecutive ymds from the anchor. */
export function anchorWeekDays(anchor: string): string[];
```

Stepping semantics, all expressed by `nextAnchorYmd` and asserted as a table in its test:

| From               | Action         | Result                                                                                                         |
| ------------------ | -------------- | -------------------------------------------------------------------------------------------------------------- |
| Anchored on today  | next week      | start of next calendar week                                                                                    |
| Anchored on today  | prev week      | start of the current calendar week (shows the days already passed — the deliberate "browse backwards" gesture) |
| On a calendar week | next/prev week | ±7 days                                                                                                        |
| Any                | back to today  | `anchorYmd = today` (rolling `today + 6` restored)                                                             |
| Any                | day step       | `addDaysYmd(anchorYmd, ±1)`                                                                                    |
| Any                | day tap (§2)   | `anchorYmd = the tapped ymd` — an arbitrary day, deliberately not week-snapped                                 |

**`src/composables/useWallAnchor.ts` — the wiring, and nothing else.**

It takes **no arguments**. An earlier draft passed a view-derived `Ref<'week' | 'day' | null>`,
which coupled the anchor to the view registry and made the composable's behaviour depend on a
reactive input it did not own. The unit is a _per-call_ fact, so it is a parameter of the intent.

```ts
export function useWallAnchor() {
  const { today } = useToday();
  const settingsStore = useSettingsStore();
  const anchorYmd = ref(today.value);          // exposed READONLY — see below

  // Midnight re-anchor — mirrors the watcher deleted from WallTodayView.vue:59-65.
  watch(today, (ymd) => { anchorYmd.value = ymd; });

  function setAnchor(next: string, reason: string): void { … }        // clamps + reports
  function step(unit: WallStepUnit, direction: -1 | 1): void { … }
  function goToToday(): void { … }

  return {
    anchorYmd: readonly(anchorYmd),
    weekDays: computed(() => anchorWeekDays(anchorYmd.value)),
    isAnchoredToToday: computed(() => anchorYmd.value === today.value),
    setAnchor, step, goToToday,
  };
}
```

Cite `usePlannerNavigation` in the docblock and record why this is not it: that composable is
`Date`-based, keyed to `'month' | 'week' | 'day'`, and owns a `referenceDate` shared with three
planner views. Merging them means a type union and a mode flag in a file three planner views
depend on. This one mirrors its documented one-way data-flow rule (props down, intent up) and
reuses its label formatter, so the divergence is a decision on record rather than an oversight.

**The ref is exposed `readonly`.** Combined with `clampAnchorYmd`, that is what makes the
invariant structural rather than a convention someone has to remember: there is no way to write
the anchor except through a function that clamps.

**The clamp is developer-facing, not family-facing.**

```ts
function setAnchor(next: string, reason: string): void {
  const safe = clampAnchorYmd(next, today.value);
  if (safe !== next) {
    console.error(
      `[wall-anchor] refusing anchor "${next}" (${reason}). Expected YYYY-MM-DD within ` +
        `±${MAX_ANCHOR_DRIFT_DAYS} days of ${today.value}. parseLocalDate does NOT throw on ` +
        `bad input — it yields "NaN-NaN-NaN" — so the caller passed something unparseable. ` +
        `Every anchor write is internally derived, so this is a bug, not bad user input. ` +
        `Check the emitter of this navigation event.`
    );
    reportError({
      surface: SURFACE,
      message: 'wall_anchor_rejected',
      severity: 'warning',
      context: { action: 'anchor', kind: reason, error_code: 'bad_anchor' },
    });
  }
  anchorYmd.value = safe;
}
```

⚠️ **No toast, and no `wall.nav.anchorReset` string.** Per assumption 3 the anchor has no
untrusted input path: no URL, no persistence, and every ymd is derived from `addDaysYmd` /
`startOfWeekYmd` / a rendered day header. This branch can only fire on a programming error, so
its audience is a developer reading CloudWatch — not a family reading a kitchen wall. A
translated string carried in every locale forever, for a branch that should never execute, is
cost with no user on the other end. The wall silently lands on today, which is the correct and
least-alarming recovery.

**Label — reused, not written.** A pure `wallAnchorLabel(anchor, todayYmd, unit, t)` beside the
rest of `wallAnchor.ts`, so it is testable without mounting: `formatWeekRange`
(`useCalendarNavigation.ts:57`, already shared by the planner command bar and week view) for
`'week'` — ⚠️ **it takes `Date`, so `parseLocalDate` both ends**; `formatDayLong` for `'day'`,
with `t('wall.today.today')` when anchored — the behaviour `WallTodayView.vue:117-125` has today,
so its inline `toLocaleDateString` is deleted, not moved.

**Controls.** One inline prev / label / next / today cluster in the wall header, left of
`WallViewSwitcher`, rendered by the page (the page owns the anchor, so the page owns the control),
in the page's own header chrome. The "back to today" button shows only when `!isAnchoredToToday`,
mirroring `WallTodayView.vue:139-146`, which is deleted. The whole cluster is hidden when
`currentView.stepUnit === null`. Strings reused: `planner.prevPeriod`, `planner.nextPeriod`,
`date.today` — all three already exist. The page picks the unit at the call site:

```ts
function onStep(direction: -1 | 1) {
  const unit = currentView.value.stepUnit;
  if (unit) anchor.step(unit, direction);
}
```

`wallViews.ts` gains `stepUnit: 'week' | 'day' | null` as a **required** field on `WallViewDef`,
so a future fifth view cannot forget to declare its stepping (that file's stated maintainability
test is "one component + one row"). `null` is spelled explicitly rather than made optional, for
the same reason. Rows: `days: 'week'`, `lanes: 'day'`, `today: 'day'`, `jobs: null`.

**The header `h1` and subtitle keep describing TODAY.** They are the wall's date identity and
must not lie about what day it is; the navigator label carries the browsed period. When anchored
the two agree by construction, so no second week label and no change to `subtitle`.

**Anchor-awareness the views need** (each is currently hardcoded and would otherwise draw a
now-line on a week the wall is not on):

- `WallDaysView`: `:show-now="weekDays.includes(todayYmd)"` (was `true`, `:148`).
  `dim-past` may stay `true` — the grid already gates dimming per column on `column.isToday`
  (`WallTimeGrid.vue:441`), and the day headers already gate their gradient on `ymd === todayYmd`
  (`:129-133`), so both go quiet off-week with no extra work.
- `WallLanesView`: takes `anchorYmd` instead of `todayYmd`/`tomorrowYmd` (`:61-62`);
  `isToday: anchorYmd === todayYmd` on its columns (replacing the hardcoded `true` at `:99`, which
  also makes `dim-past` correct off-anchor for free); same for `show-now`;
  `meals-ymd="anchorYmd"` (`:205`). Its "{count} today · {count} tomorrow" subtitle
  (`:144-155`) is only true when anchored — off-anchor it uses one new string,
  `wall.lane.onDay` ("{count} on {day}"), and drops the tomorrow clause.
- `WallTodayView`: `focusYmd` **deleted**; reads `anchorYmd` from props. Its `meals-ymd` and
  `isToday` already follow it. Its week strip writes through a new `focusDay` emit instead of
  local state — this is the _replacement_ for `focusYmd`, not new behaviour.

This also fixes the existing bug where moving to Thursday and switching views silently returns
to today.

### 2. Day tap re-anchors in days view (requirement 7)

> ⚠️ **Pass 4 cut this section as "invented scope, not in requirements 1-8" and that was wrong.**
> It is greg's fourth ask, stated with his own example. It was cut because an early draft folded
> it into §1's prose instead of numbering it, so a fresh reviewer could not see it was a
> requirement. It is now **requirement 7**, and this note stands so the cut is not re-proposed.

`WallDaysView` stops emitting `openDay` from the day header (`:133`) and the portrait
rest-of-week strip (`:167`), and emits `focusDay` instead, which the page routes to
`setAnchor($event, 'day_tap')`. The tapped day becomes the anchor **as-is** — not snapped to its
calendar week — because greg's example is explicit: a week starting Saturday, with Thursday
tapped, redraws to start from Thursday. Week _stepping_ still snaps (requirement 3); a day _tap_
is a direct placement. `nextAnchorYmd` is not involved; `setAnchor` is called directly, so the
clamp still applies.

This follows the convention documented at `WallTodayView.vue:42-43`: _"`openDay` is deliberately
NOT declared: in THIS view tapping a day moves the panel to that day rather than opening a sheet
over it."_

**Record the per-view rule in `wallViews.ts`**, because the same gesture now means different
things in different views and that is exactly what a future reader will get wrong: _a day header
re-anchors in a view that can render that day itself (days, today); it opens the day sheet in a
view that cannot (lanes)._

**What this costs, stated plainly.** The day header is currently the only one-tap route to the
day-detail sheet in days view. After this change:

- The sheet is still reachable from the lanes view's header (`WallLanesView.vue:181`) and from
  any individual event's `@open` in every view, so **no content becomes unreachable** and the
  page's `@open-day` handler and `{ kind: 'day' }` sheet target stay live rather than becoming
  dead code.
- Because the anchor survives view switches (requirement 2), tapping Thursday and then switching
  to the today view shows Thursday at full size — a better day detail than the sheet, though it
  costs a second deliberate action.

Both facts are worth confirming on hardware (Testing Plan step 9) rather than asserting.

### 3. Block cap responsive to plot height

Change **only** the body of `defaultMaxBlock` (`wallTimeGrid.ts:135-137`):

```ts
/**
 * Reference plot height at which the cap reproduces its historical value exactly.
 * ⚠️ MUST be ≥ 720. At exactly 720 the formula yields exactly MAX_BLOCK_PX, which is what
 * keeps `wallTimeGrid.test.ts:412-420` (a 240-min block, raw 192px vs a 190px cap — a TWO
 * PIXEL margin) meaning what it means. Below 720 that test silently changes subject.
 */
const CAP_REFERENCE_HEIGHT_PX = 720;
/** The cap's share of the plot — derived so the reference height yields MAX_BLOCK_PX. */
const CAP_HEIGHT_FRACTION = MAX_BLOCK_PX / CAP_REFERENCE_HEIGHT_PX;
/** Ceiling. Beyond this a single block dominates the wall however large the screen. */
export const MAX_BLOCK_CEILING_PX = 320;

export function defaultMaxBlock(availableHeight?: number): number {
  if (!availableHeight || availableHeight <= 0) return MAX_BLOCK_PX;
  return Math.min(
    MAX_BLOCK_CEILING_PX,
    Math.max(MAX_BLOCK_PX, availableHeight * CAP_HEIGHT_FRACTION)
  );
}
```

Properties preserved: the cap never drops below today's 190, so every device at or below the
reference height renders byte-for-byte as it does now; it is a pure function of a parameter
already supplied (verified: `wallTimeGrid.ts:772` ← `WallTimeGrid.vue:137-140`); it depends on
viewport, never content, so "same hour height on a quiet and a busy day" is untouched;
`applyBlockCap`'s soft ramp and monotonicity are unchanged.

`CAP_REFERENCE_HEIGHT_PX` must be measured against real devices before being fixed — see
Testing Plan step 6 — subject to the ≥720 floor above. If dead space persists after this change,
a responsive lift to `NATURAL_PX_PER_MIN` is a **separate, later** lever; do not do both at once.

### 4. Scroll as the last resort — a MEASUREMENT in this change, code only in a later one

> ## ✅ MEASUREMENT TAKEN — 2026-09-06. The floor IS reached. §4 is JUSTIFIED.
>
> Run against `layoutTimeGrid` directly: the tier is a pure function of the column
> set and the plot height, so this needed no device. Seven columns with the busiest
> carrying a back-to-back 07:00–21:00 day, at plot heights a 1024×768 landscape
> tablet plausibly gives the grid:
>
> | plot  | 6 events             | 8          | 10         | 12         | 16                   | 20         |
> | ----- | -------------------- | ---------- | ---------- | ---------- | -------------------- | ---------- |
> | 380px | **overflow, 23.5px** | floored 36 | floored 33 | floored 27 | **overflow, 21.5px** | floored 33 |
> | 430px | **overflow, 26.6px** | floored 36 | floored 36 | floored 33 | **overflow, 24.3px** | floored 36 |
> | 480px | floored 33           | floored 36 | floored 36 | floored 36 | floored 27           | floored 36 |
> | 520px | gentle 36            | floored 36 | floored 36 | floored 36 | floored 27           | floored 36 |
>
> `overflow` is the existing tier name for `outcome === 'squeezed'` — the uniform
> last-resort squeeze. At 380–430px it produces blocks of **21.5–26.6px**, below
> the 27px floor `MIN_BLOCK_STEPS` bottoms out at. That is exactly greg's
> "squeezed to the point they can be hard to read".
>
> **The expectation was wrong.** Passes 3 and 4 both assumed the squeeze would not
> fire on a supported device, and gated §4 on this measurement precisely so the
> assumption would be tested rather than trusted. It fired.
>
> Two findings to carry into that plan:
>
> 1. **It is not monotonic in event count.** Six events overflow where eight do
>    not: six spread across fourteen hours leaves large gaps, which widens the
>    window and costs more compression than a denser day. Any trigger reasoned
>    from "how busy is the day" would be wrong — it has to be the resulting block
>    height.
> 2. **§3's cap change does not help here, and never could.** The cap binds on LONG
>    events; this is the floor binding on short ones. Opposite ends of the same
>    ladder.
>
> **Per this plan's own rule, §4 is NOT folded into this change.** It is the
> largest and most invariant-dense edit proposed, against a file with zero headroom
> in its stated line budget, and it deserves its own plan with the measurement
> above as its premise. The existing `wall_grid_tier` telemetry already reports
> `overflow`, so the real-world rate is measurable from CloudWatch before a line of
> it is written.

⚠️ Requirement 6 is closed in this change by a **recorded measurement**, not by code.

The case: **`WallTimeGrid.vue`'s script ends at line 296**, against a docblock budget of ~300
whose own wording is "if this script grows past ~300 lines, something in it is a pure function that
has not been moved out yet." There is no headroom. §4 as designed adds a `contentHeight` field to
`GridLayout`, a `'scroll'` value to `GridTier` and `outcome`, a spacer element that every one of the
seven absolutely-positioned paint layers must move inside — in the exact paint order the file
documents as load-bearing — and a call into a new scroll composable. That is the largest and most
invariant-dense edit in the plan, and it is for a condition **nobody has observed on any supported
device**. Today's `squeeze()` (`wallTimeGrid.ts:708-718`) never clips; nothing is lost, only
legibility degrades; and the wall floor is a 600×600 device, not a phone.

**What this change does:** run Testing Plan step 1 and write the result into this plan. If the
readability floor is never reached on the smallest realistic supported device, requirement 6 closes
as _"the existing squeeze already meets the readability floor on every supported device"_ and this
section ships nothing. If it does fire, §4 becomes its own plan, and the sketch below is its
starting point — reviewed fresh, against the line budget, with the pure-function extraction that
the budget will by then require.

**Design sketch, retained for that plan and not implemented here:**

- **Reuse the existing outcome channel — do not add a parallel `mode`.** `finish()` already takes
  `outcome: 'fit' | 'squeezed'` and maps it to `tier` (`:825-856`). `outcome` gains `'scrolled'`;
  `GridTier` gains `'scroll'`; `GridLayout` gains exactly one field, `contentHeight: number`, equal
  to the container height in every non-scroll tier so callers need no branch.
- **Telemetry is free**: the existing `tierGate` watcher (`WallTimeGrid.vue:159-188`) already emits
  `wall_grid_tier` with `stage: result.tier` on every transition — no new event, gate or context key.
- The plot keeps its ResizeObserver and becomes scrollable. A scroll container's `clientHeight` is
  **unaffected by its overflowing content**, so `layoutHeight` stays the flex height and the "do not
  make a block affect the plot's own height" invariant holds. ⚠️ **Set `overflow-x: hidden` and
  `overflow-y: auto` explicitly** — CSS computes a `visible` axis to `auto` when the other is not
  `visible`, which would defeat the existing `rounded-[20px]` clip and permit horizontal scroll.
- A single spacer `<div :style="{ height: contentHeight + 'px' }">` establishes the scroll range;
  every absolutely-positioned layer moves inside it, unchanged and in the same paint order. The
  failure fallback branch stays **outside** the spacer.
- Scroll behaviour lives in `src/composables/useGridFollowScroll.ts`, never in the grid script, for
  the budget reason above. ⚠️ **Do NOT route `scrollTop` through a reactive ref** — a ref write per
  scroll event re-renders all seven columns of absolutely-positioned blocks every frame on the
  oldest iPads this is built for. `{ passive: true }` listener writing a CSS custom property on the
  sibling gutter inside one `requestAnimationFrame`, consumed by `transform: translateY(...)`.
- Auto-follow-now, suppressed for 60s after any user scroll, `behavior: 'auto'` under reduced motion.
  A wall is unattended: a scroll container nobody touches hides the rest of the day, which is worse
  than the squeeze it replaces.
- The axis gutter is and stays a **sibling**. This does not touch `LADDER`.

### 5. Conditional rail in days view, via one shell that owns the peripherals

**The duplication is not the shell — it is the ten-prop `WallPeripheralCards` invocation,
written out three times** (`WallTodayView.vue:181-193`, `WallLanesView.vue:207-219`,
`WallDaysView.vue:189-201`), plus three copies of the `peripheralVariant` computed
(e.g. `WallLanesView.vue:129-131`). A slot-based shell alone would have left all six standing.

**First, collapse the prop bag at source.** A new `WallPeripheralData` interface in
`src/types/wall.ts` groups the five job/list props (`todosFor`, `unassignedTodos`, `listsFor`,
`orphanLists`, `visibleMemberIds`) that always travel together and are always sourced from the
same place. `BeanieWallPage` builds it once from `useWallJobs()` and passes `:peripherals`
(replacing five of the bindings at `:373-378`); `WallPeripheralCards` destructures it.

`src/components/wall/WallViewShell.vue` then owns **both** the flex shell and the peripheral
cards, on **five explicit props**:

- `portrait: boolean`, `rail: boolean`, `busiest: number`, `mealsYmd: string`,
  `peripherals: WallPeripheralData`.
- One `main` slot for the view's own content.
- Computes `wallPeripheralVariant(rail ? 'rail' : 'band', busiest, portrait)` — the existing
  helper (`wallActivities.ts:309`) already returns `'rail'` unconditionally for a `'rail'`
  preference, so **no util change is needed** — and deletes the three per-view copies.
- Re-emits `open` / `open-chores`.
- ⚠️ Days view's portrait "rest of the week" strip (`WallDaysView.vue:155-186`) goes **inside the
  `main` slot**, below the grid, exactly where it is now. It is not peripheral chrome.

⚠️ **No `v-bind="props"` forwarding.** Spreading a view's whole prop bag into a child re-creates
the untyped pass-through the shell was supposed to remove: it forwards props the shell does not
declare, hides which of them the shell actually reads, and makes every future prop added to a
view silently reach the shell. Each view names its five, on one line each. The shell sets
`defineOptions({ inheritAttrs: false })`, as every wall view already does.

**The rail threshold is a media query, not a measurement.** `daysRailFits(plotWidth, …)` would
measure a width that the rail decision itself changes: turning the rail on shrinks the plot below
the threshold, which turns it off, which widens it — a bistable input that a last-good fallback
does not fix. Instead, a new **`src/components/wall/wallLayout.ts`**:

```ts
// Derived, not invented, from AXIS_WIDTH_PX (62) and the page's px-7 padding:
//   296 rail + 16 gap + 62 axis + 56 page padding + 7 × 120 min column = 1270
export const RAIL_WIDTH_PX = 296;
/** Viewport width at which seven day columns and the rail both stay readable. */
export const DAYS_RAIL_MIN_VIEWPORT_PX = 1270;
```

⚠️ **These do NOT go in `wallTimeGrid.ts`.** That module is the pure, exhaustively-tested layout
engine; rail chrome widths and viewport thresholds are page-layout facts with a different
lifetime and a different set of reviewers, and putting them there drags unrelated churn through
the file with the most invariants in the wall. `AXIS_WIDTH_PX` stays where it is and is
_imported_ by the derivation comment above. `MIN_DAY_COLUMN_PX` from an earlier draft is **not**
exported — nothing read it; it is arithmetic in the comment, and an exported constant with no
caller is a maintenance liability, not documentation.

In `BeanieWallPage.vue`:
`const railWide = useMediaQuery(\`(min-width: ${DAYS_RAIL_MIN_VIEWPORT_PX}px)\`, true)`— the §0
composable, so this adds no listener boilerplate and nothing to remember to release. Days view
gets`:rail="railWide && !isPortrait"`. Zero observers, zero flap, zero hysteresis logic.
Portrait is unchanged.

### 6. Chore board — idle members to a footer strip

`WallChoreBoard`'s template calls `columnFor(member.id)` **thirteen times per member**
(three in the ring class `:172-176`, three in the count `:187-191`, one for `shown` `:203`, two for
`hidden` `:231-238`, one for `total` `:241`, three in the stars `:249-261`) — on a screen
that re-renders every 20s forever, and against a helper whose own docblock (`:97-104`) exists
precisely to prevent that. The partition and that fix are one change:

```ts
/** One pass, one object per member — the template reads `entry.column`, never `columnFor()`. */
const partitioned = computed(() => {
  const active: { member: FamilyMember; column: Column }[] = [];
  const idle: FamilyMember[] = [];
  for (const member of members.value) {
    // `members` and `columnByMember` are built from the same filtered list in the same tick,
    // so a miss is impossible. `continue` rather than `!` so a future edit that breaks that
    // invariant drops one chip on a kitchen wall instead of throwing the whole board away.
    const column = columnByMember.value.get(member.id);
    if (!column) continue;
    if (column.total > 0) active.push({ member, column });
    else idle.push(member);
  }
  return { active, idle };
});
```

- `active` — `total > 0` (includes fully-completed columns, which keep ring and stars).
- `idle` — `total === 0`.

The grid renders `active` plus the existing orphan-lists column, so `auto-fit` divides the width
among members who actually have jobs. `idle` members render as a footer strip: a row of
`BeanieAvatar` chips at `size="sm"` with the member's name, on one shared card, under a warm line.
`columnFor()` — including its `?? buildColumn(memberId)` fallback, which silently recomputed on a
miss — is deleted.

**The track is capped unconditionally**, not only when one member is active:
`repeat(auto-fit, minmax(210px, 420px))` (today: `minmax(210px, 1fr)`, `:167`).
An earlier draft's "if exactly one active member, switch to a capped track" was a special case that
would have to be kept correct forever; capping always produces the same result for the one-member
case and a better one for two or three wide columns, with no branch and no edge case in the test
matrix. ⚠️ **`justify-content: center`, not `start`** — capped tracks with `start` strand the whole
surplus as one dead margin on the right of a wide wall, which reads as a rendering fault rather
than a layout choice.

**Why a strip rather than narrow columns or a grouped card.** A collapsed vertical column still
costs its track's worth of visual weight while communicating nothing, and a grey sliver per child
every day reads as an absence on a family's kitchen wall. A single horizontal strip costs one row,
keeps every bean present and named, and — being a positive statement rather than an empty column —
says "these beans are clear" instead of "these beans have nothing." Copy is affirmative:
`wall.jobs.allClear` → "all clear" / beanie: "all clear". (Note `wall.jobs.none` is
"Nothing today" / "free as a bean 🫘" — the per-column line, kept as-is.)

**Edge cases:**

- **All members idle** → there is **no board-level empty state to reuse**; do not cite one.
  The strip becomes the board: rendered centred in the grid's place, with the same affirmative
  copy and the same chips. One branch, no new component, and the progress bar (already 0/0 →
  `percent === 0`) is unchanged.
- **`visibleMemberIds` filter active** → partitioning happens after the existing `members`
  filter (`:57-62`), so a filtered-out member is absent entirely rather than appearing as idle.
- **Orphan lists with all members idle** → orphan column still renders; it is not a member.

Dark mode: the strip needs `dark:bg-surface-raised` and its chips need explicit `html.dark`
partners for any inline colour, per the caveat above.

## Files Affected

**Modified**

- `src/pages/BeanieWallPage.vue` — anchor wiring, inline navigator cluster in the header,
  `focusDay` handler, `peripherals` bag, three `useMediaQuery` call sites replacing two bespoke
  handlers, type-scale additions
- `src/components/wall/wallViews.ts` — required `stepUnit` field per view; the day-tap rule
- `src/components/wall/WallDaysView.vue` — `focusDay` emit replacing `openDay` on the header and
  the portrait strip, shell adoption, `:rail`, anchor-aware `show-now`
- `src/components/wall/WallTodayView.vue` — delete `focusYmd` + its inline date formatting + its
  back-to-today button, read anchor from props, emit `focusDay` from the week strip, shell adoption
- `src/components/wall/WallLanesView.vue` — anchor-driven day (columns incl. the hardcoded
  `isToday: true`, `show-now`, `meals-ymd`, subtitle), shell adoption
- `src/components/wall/WallPeripheralCards.vue` — five props collapse to one `peripherals` object
- `src/components/wall/WallChoreBoard.vue` — partition computed, footer strip, capped centred
  track, `columnFor` removed
- `src/utils/wallTimeGrid.ts` — `defaultMaxBlock` body **only**
- `src/utils/date.ts` — `weekStartOffset`, `startOfWeekYmd` **added** (no call sites migrated)
- `src/types/wall.ts` — `WallPeripheralData`
- `src/utils/__tests__/wallTimeGrid.test.ts` — pin the 720px softness test to `{ maxBlock: MAX_BLOCK_PX }`
- `src/utils/__tests__/date.test.ts` — **a new `describe` block only**; ⚠️ do not touch the existing
  expectations, whose independence from the implementation is the point of them
- `src/services/translation/uiStrings.ts` — two new strings only (`wall.jobs.allClear`,
  `wall.lane.onDay`), `en` + `beanie`

**Created**

- `src/utils/wallAnchor.ts` + `src/utils/__tests__/wallAnchor.test.ts`
- `src/composables/useWallAnchor.ts` + `src/composables/__tests__/useWallAnchor.test.ts`
- `src/composables/useMediaQuery.ts` + `src/composables/__tests__/useMediaQuery.test.ts`
- `src/components/wall/WallViewShell.vue`
- `src/components/wall/wallLayout.ts`
- `src/components/wall/__tests__/WallChoreBoard.test.ts`

**Cut or deferred** (was in earlier drafts): `src/components/ui/PeriodNavigator.vue` and the
`MonthNavigator.vue` / `TransactionsPage.vue` adoption; the five-site week-start migration
(`monthCells.ts`, `useCalendarNavigation.ts`, `BeanieDatePicker.vue`, `CalendarGrid.vue`);
`src/composables/useGridFollowScroll.ts` and the `WallTimeGrid.vue` / `wallTimeGrid.ts` scroll-tier
edits (deferred behind the §4 measurement).

**Not created** (and why): no `WallViewShell.test.ts` — it is a presentational wrapper whose
only logic is one existing, already-tested helper call; the rail/band decision is asserted where
it is made (the media query) and in the manual pass.

**Follow-ups recorded, not done here:** consolidate all three period-navigation clusters (wall,
`MonthNavigator`, `CalendarCommandBar`) in one change with one owner; migrate the five week-start
call sites onto `weekStartOffset`; consider `useMediaQuery` for the four module-scoped singletons.

## Observability Coverage

Surfaces: the existing **`beanie-wall`** and **`wall-time-grid`**. No new surface, and —
per the convention at `diagnosticContext.ts:307-318` — **no new context keys**, so there is
nothing to mirror into the Lambda allowlist, the store data-collection table,
`PrivacyInfo.xcprivacy`, the Data-Safety answers or `privacy.astro`.

- `logEvent({ level: 'info', surface: 'beanie-wall', message: 'wall_anchor_change', context: { action: 'anchor', kind: view, stage: direction, count: offsetDays } })` —
  fires on every step, on back-to-today, and on a day tap. `stage` is `prev | next | today | day_tap`.
  `count` is the **signed** offset from the real today.
  ⚠️ **`daysBetween` cannot produce it** — `date.ts:577-586` wraps the difference in `Math.abs`.
  Use `anchorOffsetDays` from `wallAnchor.ts`, which is signed by construction and unit-tested,
  so "families browse forward but never back" is actually answerable and a wall stranded
  off-today is visible in the firehose.
  ⚠️ **Emit this UNGATED.** Pass 3 required a `createChangeGate` with the signature
  `${view}:${stage}:${count}` to stop repeated steps being suppressed — but `count` changes on
  _every_ step, so that gate can never suppress anything. It is ceremony that reads as a safeguard
  and does nothing, which is worse than no gate at all, because the next reader will trust it.
  This is a hand-driven event on a wall-mounted tablet; `logEvent`'s 50/min per-surface floor is
  the correct and only backstop needed. Say so in a comment so it is not "fixed" later.
- `logEvent({ level: 'info', surface: 'beanie-wall', message: 'wall_rail_mode', context: { action: 'layout', kind: 'days', stage: railWide ? 'rail' : 'band' } })` —
  once per media-query transition, so in practice once per wall session. Answers "is the rail
  threshold right for real screens?" without a repro. Gated on the transition itself, so it
  cannot repeat.
- **Scroll tier: nothing in this change.** §4 ships no code; if a later plan adds `'scroll'` to
  `GridTier`, the existing `wall_grid_tier` watcher (`WallTimeGrid.vue:159-188`) makes the
  fall-through rate measurable for free, with no new event.
- **Failure modes covered:**
  - A bad or wildly out-of-range anchor — `clampAnchorYmd` is the _only_ guard (`parseLocalDate`
    cannot throw), the ref is exposed `readonly` so it cannot be bypassed, `setAnchor` logs a
    developer-directed `console.error` naming the cause and the fix, emits
    `reportError({ severity: 'warning', error_code: 'bad_anchor' })`, and lands on today so the
    wall keeps rendering. **No toast**: per assumption 3 there is no untrusted input path, so
    this branch has a developer audience, not a family one.
  - A layout that throws — already covered and untouched: `WallTimeGrid`'s outcome watcher
    (`:159-180`) console.errors with replay instructions, reports at `severity: 'error'`, and
    renders the labelled static-list fallback.
  - A zero/NaN plot measurement — already has the last-good fallback (`:88-110`). Add nothing:
    a second guard here would be a second source of truth for the same condition.
  - `ResizeObserver` unavailable — already loud, in `useElementSize` (`:76-90`).
  - `matchMedia` unavailable (jsdom, old WebView) — `useMediaQuery` returns its `initial` and
    registers nothing, matching the guard `BeanieWallPage.vue:86-89` already had.
- **No `severity: 'critical'`** anywhere here: nothing in this change can fail a user action or
  put data at risk. It is all display state.

## Acceptance Criteria

- [ ] Days view steps by whole calendar weeks honouring `settingsStore.weekStartDay`; today and
      lanes views step by day; jobs board shows no navigator
- [ ] Default on load is still the rolling `today + 6`; "back to today" appears only when
      off-anchor and restores it
- [ ] The anchor survives view switches; `WallTodayView.focusYmd` no longer exists
- [ ] Anchor re-anchors to today on midnight rollover
- [ ] `anchorYmd` is exposed `readonly`; there is no code path that writes it except through
      `setAnchor`, and `setAnchor` always clamps
- [ ] An invalid or out-of-range anchor never reaches the views: it is refused, reported at
      `warning`, and reset to today — verified by a test that feeds `clampAnchorYmd` garbage.
      **No toast and no new string for this branch**
- [ ] Browsing off-today draws no now-line and dims nothing as "past" in days or lanes view;
      lanes' subtitle and `meals-ymd` follow the anchor; lanes' hardcoded `isToday: true` is gone
- [ ] **Requirement 7:** tapping a day header in days view — landscape and portrait, and from the
      portrait rest-of-week strip — re-anchors the week to START AT that day, unsnapped, and no
      longer opens the day sheet. greg's case (week starts Saturday, tap Thursday → week starts
      Thursday) is verified explicitly
- [ ] The day sheet is still reachable: from the lanes-view day header and from any individual
      event in every view. `@open-day` and the `{ kind: 'day' }` sheet target are not dead code
- [ ] The per-view day-tap rule is documented in `wallViews.ts`
- [ ] `wall_anchor_change` is emitted **ungated**, with a signed `count` from `anchorOffsetDays`;
      no `createChangeGate` was added for it
- [ ] `defaultMaxBlock` returns exactly `MAX_BLOCK_PX` at and below the reference height, scales
      above it, and never exceeds `MAX_BLOCK_CEILING_PX`; `CAP_REFERENCE_HEIGHT_PX >= 720`
- [ ] An hour is still the same height on a quiet day and a busy one at any fixed viewport size
      (existing test still green)
- [ ] The 720px softness test passes `{ maxBlock: MAX_BLOCK_PX }` explicitly and carries a comment
      recording the 192-vs-190 margin
- [ ] Requirement 6 is closed by a **measurement written into this plan**, and no scroll-tier code
      was added to `wallTimeGrid.ts` or `WallTimeGrid.vue`
- [ ] `WallTimeGrid.vue`'s script is **no longer than the 296 lines it is today**
- [ ] Days view uses the rail only above `DAYS_RAIL_MIN_VIEWPORT_PX` in landscape, and the band
      otherwise; resizing across the threshold flips it once, cleanly
- [ ] `WallPeripheralCards` is invoked in exactly one place in the wall views, its job/list
      props arrive as one `WallPeripheralData` object, and no view computes `peripheralVariant`
- [ ] `WallViewShell` declares every prop it uses; no `v-bind="props"` anywhere in the wall views
- [ ] `BeanieWallPage.vue` contains no hand-rolled `matchMedia` listener; all three queries go
      through `useMediaQuery`
- [ ] **No `PeriodNavigator.vue` was created, and `MonthNavigator.vue` / `TransactionsPage.vue`
      were not touched.** The wall's cluster is inline and reuses `planner.prevPeriod`,
      `planner.nextPeriod` and `date.today`
- [ ] `weekStartOffset` / `startOfWeekYmd` are added with a caller (the wall); **no existing
      call site was migrated**, and `date.test.ts`'s existing expectations are unchanged
- [ ] No viewport or chrome constant has been added to `src/utils/wallTimeGrid.ts`; no exported
      constant is added without a caller
- [ ] Chore board gives its width to members with jobs; idle members appear in a named footer
      strip; completed members keep their column, ring, and stars; `columnFor()` and its silent
      recompute fallback are gone; the track cap has no "one active member" branch and is centred
- [ ] Exactly two new strings, each with `en` and `beanie`; every new aria-label bound through `t()`
- [ ] **No new key in `ALLOWED_CONTEXT_KEYS`** — verified by `diagnosticContext.test.ts` staying
      untouched
- [ ] Every new surface is authored for dark mode, with inline/scoped backgrounds given explicit
      `html.dark` partners
- [ ] All new text sizing is rem-based and lives in the wall type scale block
- [ ] Commit A (§0) adds two modules and changes no existing behaviour

## Testing Plan

1. ⚠️ **Measurement gate for §4 — run FIRST, before any code.** On a 1024×768 tablet (the smallest
   realistic supported device; the hard floor is 600×600) load the busiest day the fixtures can
   produce in days view and record the resulting `tier`. **Write the result into this plan.**
   Expected outcome: it never leaves `squeezed` at a legible size, requirement 6 closes as
   "the existing squeeze already meets the readability floor on every supported device", and no
   scroll code is written. If it _does_ reach the floor, open a separate plan — do not fold it in.
2. **Unit — `wallAnchor.ts`, no mocking required.** This is the bulk of the coverage, and it is
   pure: `todayYmd` and `weekStartDay` are parameters, not ambient state. Table-drive
   `nextAnchorYmd` over the semantics rows × both `weekStartDay` values × a month boundary
   × a DST boundary. Assert `anchorWeekDays(today)` is `today + 6` and that a week anchor yields
   the calendar week. Assert `anchorOffsetDays` is **signed** in both directions — the property
   `daysBetween` does not have.
3. **Unit — `clampAnchorYmd`.** `'not-a-date'`, `'2026-13-45'`, `''`, `'NaN-NaN-NaN'`, and a ymd
   two years out: each returns `todayYmd`; a valid nearby ymd is returned unchanged. This is the
   test that would have caught `"NaN-NaN-NaN"`, and it needs no Vue and no mocks.
4. **Unit — `useWallAnchor`.** Only what the util cannot cover: the midnight re-anchor watcher,
   that `anchorYmd` is readonly, and that `setAnchor` calls `reportError` exactly once on a
   rejection. Mock `useToday` — it is a module singleton captured at import (`useToday.ts:31`),
   so `vi.setSystemTime` alone will not move it. **Keeping this file small is the point of the
   split**: it is the only test in this change that needs a mock.
5. **Unit — `weekStartOffset` / `startOfWeekYmd`.** A new `describe` block with a literal table:
   both week-start settings × all seven weekdays, expectations written out rather than recomputed.
   ⚠️ Add only — the existing `date.test.ts` expectations stay exactly as they are.
6. **Unit — `defaultMaxBlock`.** Returns `MAX_BLOCK_PX` for `undefined`, `0`, negative, and any
   height ≤ reference; scales linearly above it; clamps at the ceiling; and an explicit assertion
   that `defaultMaxBlock(720) === MAX_BLOCK_PX`, which is the property the 720px softness test
   silently depends on. **Then measure a real plot height on a 1024×768 tablet and a 2560×1440
   display before fixing `CAP_REFERENCE_HEIGHT_PX`**, subject to the ≥720 floor.
7. **Unit — `useMediaQuery`.** Reports the initial match, updates on `change`, releases its
   listener on scope dispose, and returns `initial` with no listener when `matchMedia` is absent.
8. **Component — `WallChoreBoard`.** All idle, all active, mixed, one active,
   completed-not-idle, orphan lists present, and with `visibleMemberIds` filtering.
9. **Manual, on real hardware.** The wall has no E2E and neither the density changes nor the
   day-tap gesture can be verified from unit tests alone. Check on a 1024×768 tablet (band,
   legible on a busy day), a 1280×800 tablet (band — below the rail threshold), and a large
   desktop display (rail, taller blocks). Specifically:
   - Walk greg's case: with the week starting Saturday, tap Thursday and confirm the grid redraws
     starting Thursday, in **both** orientations.
   - Confirm that browsing off-week in days view, with no day header highlighted, still reads
     clearly from two metres (assumption 6).
   - Confirm the day sheet still feels reachable now that the day header no longer opens it.
   - Verify in **both light and dark mode** on each device.
10. **Regression, per commit — not once at the end.** `npm run test:run`, `npm run type-check`,
    `npm run lint`, `npm run build` after each of A–C. (Note: there is no `test:unit` script —
    `package.json:17-18`.) The build matters here — new imports across the store/router graph
    have broken `vite build` while type-check and Vitest stayed green. **No cross-surface smoke
    check is needed after commit A**, because it changes no existing call site — which is the
    reason the §0 cuts were made.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted from a full architectural map; found `defaultMaxBlock`'s
  existing unused height parameter, the existing `weekStartDay` setting, and the week-start
  formula in `monthGridRange`.
- **Pass 2 (DRY + error handling)**: Verified every reuse claim against the source. Removed all
  8 proposed telemetry keys in favour of the documented reuse convention; replaced the parallel
  `mode` field with the existing `tier`/`outcome` channel; found the week-start formula is a
  _sixth_ copy, not a third; found two existing period-navigation clusters; moved
  `WallPeripheralCards`' ten-prop invocation into a shell instead of leaving three copies; found
  `columnFor()` called a dozen times per member. On error handling: corrected the false claim that
  a bad ymd throws (`parseLocalDate` returns `"NaN-NaN-NaN"` silently) and added a validating
  setter; corrected the false claim that a board-level empty state exists; added the
  anchor-awareness gaps (`show-now`, lanes' hardcoded today/tomorrow) that would have shipped a
  now-line on next week.
- **Pass 3 (Sustainability)**: Three latent defects in the plan itself — `daysBetween` returns an
  ABSOLUTE value so the signed-offset telemetry could not work; the `wall_anchor_change` change-gate
  signature would have suppressed every repeated step; and migrating `date.test.ts` onto
  `weekStartOffset` would have made the test tautological. On complexity: split the anchor into a
  pure `wallAnchor.ts` plus a thin composable and dropped its reactive `stepUnit` argument;
  exposed `anchorYmd` readonly so the clamp is structural; deleted the family-facing toast and its
  permanent translated string; replaced the shell's `v-bind="props"` with one grouped
  `WallPeripheralData` object and five explicit props; extracted `useMediaQuery`; moved
  rail/viewport constants out of the pure layout engine; removed the chore board's "one active
  member" special case; lifted scroll follow behaviour into a composable and made the axis offset a
  CSS custom property written in rAF; gated §4 behind a measurement; and sequenced the work into
  independently-revertible commits.
- **Pass 4 (Fresh-eyes sweep)**: Re-verified every load-bearing fact against source and found one
  **wrong**: the ⚠️ warning, carried through three passes, that raising the block cap breaks
  `wallTimeGrid.test.ts:412-420`. The 192-vs-190 arithmetic is correct, but the proposed formula
  yields _exactly_ 190 at a 720px plot for any reference ≥720 — which the plan's own floor rule
  already required — so the test could never have broken. Restated the caveat around its real value
  and added an explicit `defaultMaxBlock(720) === MAX_BLOCK_PX` assertion so the dependency is
  stated rather than implied. Also found Pass 3's change-gate "fix" self-defeating: putting `count`
  in the signature produces a gate that can never suppress anything, so the event is now emitted
  ungated with the 50/min floor named as the backstop. Confirmed as stated: `daysBetween`'s
  `Math.abs`, `createChangeGate`'s suppression, `parseLocalDate`'s silent Invalid Date, the axis
  being a sibling of the plot, and that `defaultMaxBlock` genuinely already receives the measured
  plot height — so §3 really is a one-function change. Established one new fact: **`WallTimeGrid.vue`'s
  script ends at line 296 against its own ~300-line budget**, i.e. zero headroom. On scope: cut
  `PeriodNavigator` (it consolidates nothing once `CalendarCommandBar` is excluded, and forces a
  regression surface onto the transactions page), deferred the five-site week-start migration
  (which also removes the `date.test.ts` trap entirely), and demoted §4 from "build behind a gate"
  to "measure, and plan separately if it fires" on the strength of the 296-line finding. Added
  three small corrections: `overflow-x` must be explicit in the §4 sketch, the chore-board track
  must be centred rather than start-aligned, and `formatWeekRange` takes `Date` rather than ymd.
- **Post-pass correction (author, applied after Pass 4)**: Pass 4 also cut §2 (day-tap
  re-anchoring) as "invented scope — not in requirements 1-8". **That cut is rejected.** It is
  greg's fourth ask, given with his own worked example ("if the weekly view starts on sat, and i
  select the thursday card, then the view redraws to start from thursday"). It was cut because the
  Pass 1 requirements list folded it into §1's prose instead of numbering it, so a fresh reviewer
  could not see it was a requirement — a drafting error, not a scope finding. §2 is restored, it is
  now **requirement 7**, the requirements preamble records why the numbering matters, and §2 itself
  carries a note so the cut is not re-proposed. Pass 4's design critique of it is preserved as an
  explicit cost statement in §2 and as manual-test steps rather than being discarded. Pass 4's
  other three cuts are kept.
