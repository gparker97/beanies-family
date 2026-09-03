# Plan: the concertina time grid for beanie wall mode

> Date: 2026-09-03
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-09-03-wall-time-grid.md`
> Mockup: `docs/mockups/2026-09-03-wall-time-grid.html` (artifact https://claude.ai/code/artifact/3d1b5eb0-b443-4219-808b-3bfe103995c3)

## User Story

As a parent walking past the kitchen tablet, I want the family's events laid out against time rather than listed in time order, so that I can see the shape of the day — the 8am crunch, the free afternoon, the 4pm collision nobody can drive to — without reading a single clock face.

## Context

The beanie wall ships three calendar views (`days`, `lanes`, `today`) and all three render events as a **chip stack**: a vertical list in time order, each chip printing its own start time. Time order is not the same as time position. Two consequences drive this work:

1. **Nothing lines up.** On `lanes`, five members' events are five independent stacks, so Leo's football at 16:00 and Milo's swimming at 16:30 sit at whatever height their position in each list puts them. The single most valuable question a family screen can answer — _are two of these at the same time, and is anyone free?_ — currently requires reading and comparing six timestamps.
2. **Every chip spends a line on its own clock.** `WallEventChip` prints `07:30` above the title. Across seven day columns that is seven columns' worth of redundant text, and it is exactly the space the columns do not have.

A time axis fixes both at once, and the second fix pays for the first: **once the axis carries the time, the block no longer prints it**, which buys back a whole line of text per event and is what makes seven columns viable at tablet width.

The obstacle is vertical space. A real family day spans 07:30–20:00; a mounted tablet gives the calendar roughly 470–520px after the header, the view switcher and the peripheral band. A uniform hour grid needs ~900px for that window, so every shipping product in this category handles the shortfall manually — Skylight makes you pinch-zoom, DAKboard squeezes a fixed window until it is unreadable, Hearth ships a "Compact" density setting, Cozyla auto-scrolls. A competitive sweep (2026-09-03, 211 App Store listings plus first-party docs) found **no product in the category clamps the grid to the day's first and last event**, and **a labelled squashed row exists in no shipping product or library** — Google shipped one as a 2011 Labs feature ("Hide morning and night") and retired it in 2018 without replacement.

That is the opening this plan takes.

### What was approved

An interactive prototype (not a static mockup — it runs the real layout algorithm on real-shaped data) was built and reviewed at `docs/mockups/2026-09-03-wall-time-grid.html`. Greg approved, in his words: the **concertina** axis over fixed hour rows and over a uniform time ruler; the grid on **all three** views rather than the two roomy ones; peripherals that **collapse when the grid needs the room**; and, on a follow-up question, that long events **are capped** in height.

## Requirements

1. **A shared time axis** on all three calendar views (`days`, `lanes`, `today`). The jobs board (`WallChoreBoard`) is untouched — it is not a calendar.
2. **Blocks are proportional to duration**, on a **uniform hour grid**. A two-hour event is twice a one-hour event and spans exactly two hour rows, subject to the floor and cap below. Hour rules and hour labels are drawn across every view — without them the axis was uniform but did not _read_ as uniform.
3. **The window clamps** to the earliest start and latest end across the columns currently on screen, **snapped outward to whole hours** so the grid starts and ends on a labelled rule. No dead hours beyond that.
4. **Empty stretches fold.** A span where nothing is on _in any column on screen_ collapses to a fixed-height band labelled with the time it resumes ("quiet until 15:20"). A fold covers only emptiness — it can never hide an event.
5. **A minimum block height** so a fifteen-minute event is still legible at 3m.
6. **A maximum block height** (approved this session). A long event is clamped and states its own duration explicitly, so the clamp is visible rather than silent.
7. **Real overlaps sit side by side**; a pair splits weighted so the longer event keeps its title and the shorter becomes a sliver.
8. **It never scrolls and never drops an event.** Overflow is absorbed by a deterministic ladder of compromises whose last rung is a _global uniform squeeze_, never a clip.
9. **The now-line** spans the grid, with the time in a pill on the axis; the running event carries its own marker and a progress fill.
10. **Past events dim** (validated: near-universal in the category, opt-in almost everywhere; on a wall it is on by default).
11. **An all-day band** pinned above the axis. An all-day item shared by every column renders **once, spanning**, tagged "everyone" — not repeated per column. **Single-day all-day items still render** — see §4a, where this was a hole in pass 3.
12. **Peripheral cards collapse** to a slim single-row strip when the day is busy enough that the grid needs the height.
13. **Reuse, not duplication — but reuse that is _additive_, not reuse bought by editing live consumers.** See "The blast-radius rule" below. Verified reusable and reused rather than re-implemented:
    - `wallActivities.ts` (`wallEvents`, `sortByTime`, `matchesWallFilter`) and `assignees.ts` (`belongsInMemberColumn` — **it lives there, at `assignees.ts:83`, not in `wallActivities.ts`**; pass 3 said otherwise)
    - `useActivityIdentity().identityFor` (colour, faces, emoji, celebration, wash/edge styles)
    - `computeAllDaySpans` (`src/utils/allDaySpans.ts`) — the multi-day spanning rule already exists and is already tested. Note its real return shape before using it (§4a).
    - `createChangeGate` (`src/services/telemetry/emitPolicy.ts`) — the "emit on transition only" rule already exists; it is not re-implemented, **and `emitPolicy.ts` is not edited at all**.
    - `WallBeanColumn`, `WallPeripheralCards`, `ActivityOwnerStack`, `BeanieAvatar`, `CelebrationConfetti`, `useWallJobs`, `useWallPeripherals`, `fillTemplate`, `jobsProgress`
    - `WallEventChip` is **retired**, not forked.
14. **All user-visible text through `uiStrings.ts`** with `en` + `beanie`, rendered via `t()` / `fillTemplate`.
15. **rem-based text only.** No `text-[Xpx]`, no `font-size: Xpx`. Every **new** size >= `0.75rem` (the documented 12px floor). This change is **net-negative** on sub-floor sizes: two of the existing offenders are deleted with the chip.

    > **Corrected during implementation.** The plan's inventory said five sub-floor sizes and named the wrong set — it missed `.wall-sheet-label` (0.72), `.wall-strip-day` (0.7) and `.wall-strip-count` (0.72), and an early verification grep double-counted by matching `0.75`/`0.78` too. The verified count is **6 before, 4 after**. The delta (-2, +0) is as planned; only the absolute number was wrong.

16. **Observability** per the `CLAUDE.md` convention, with no new allowlisted context key.
17. Ships behind the existing `beanieWall` flag; no new flag.
18. **No silent failure anywhere in the change.** Every failure — a thrown layout, an unparseable time, a missing `ResizeObserver`, a zero-height plot — has a _visible_ consequence, a logged event, and developer guidance.
19. **The change is revertable in pieces.** No commit in this change makes the wall grid and an unrelated live surface inseparable.

## The blast-radius rule

Pass 2 hunted duplication and was right about the duplication. But it paid for three of those wins by **editing code that four live, unflagged surfaces depend on**, in service of a feature that ships behind `beanieWall` at **prod state `false`** (verified: `src/config/featureFlags.committed.ts:11`). That risk asymmetry is backwards: a mistake in the shared edit reaches 100% of families immediately, while the feature that motivated the edit reaches 0%.

One line, applied consistently:

> **Additive shared code is cheap. Behaviour-changing edits to existing consumers are not.**
>
> - **Additive** — a new exported pure function, a new composable, a new variant on an existing union. Nothing that exists today behaves differently. Ship it in this change, freely.
> - **Behaviour-changing** — rewriting an existing function's internals, re-pointing an existing call site at a new implementation, migrating a live component onto a new abstraction. Ship it **only when the feature cannot be built without it**, and ship it in its **own commit** so it can be reverted alone.

**This is not a licence to duplicate.** Every deferred convergence below gets: (a) a docblock in the new module naming the older twin and why it has not converged yet; (b) a docblock in the older twin pointing forward; (c) a line in "Follow-ups" and in the PR description. A reader who lands on either copy is told, in the file, that the other exists.

**Pass 4 adds a second clause to the same rule, pointing inward:** _additive is cheap, but it is not free._ A new shared file, a new exported primitive and a new test file each cost review attention and each become something to maintain. An additive primitive earns its place only if the feature needs it or a second consumer exists **today**. That clause is what cuts `timeSpans.ts` and `createIntervalGate` below.

### What this reverses, concretely

| Pass said                                                                                                                                 | Now                                                                                                          | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lift `groupOverlapping`'s body into `clusterOverlapping` and make `groupOverlapping` a delegating adapter — "a one-call-site refactor"    | Write `clusterOverlapping` **additively** for the grid. **Leave `groupOverlapping` untouched.**              | The one-call-site claim is **wrong** — see assumption 12. It has **three** consumers, two inline in the templates of the two largest planner views. The convergence also _changes behaviour_: today an unparseable `startTime` yields `NaN`, which fails `itemStart < groupEnd` and starts a **new group** (the event still renders); under `null` semantics the item is **filtered out** and disappears from the planner. Silent data loss in the primary calendar, shipped by a wall change. |
| Replace `date.ts`'s "two private copies" of the time parser at `:499`/`:590`                                                              | Add `minutesOfDay` **additively**. **Do not touch `addHourToTime` (`:497`) or `formatTime12` (`:588`).**     | They are not minutes-of-day parsers; both destructure `[h, m]` to _re-format_. Routing them through `minutesOfDay` would change their output for malformed input across **23 files**, for no benefit here.                                                                                                                                                                                                                                                                                     |
| Migrate `ExpandableText.vue` and `CalendarCommandBar.vue` onto `useElementSize` in this change                                            | Ship `useElementSize` with the API **the grid** needs. Migrate the other two in a **separate follow-up PR**. | Neither existing consumer wants what the grid wants. `ExpandableText` needs an imperative `measure()` reading `scrollHeight - clientHeight` plus a re-measure on a prop change; `CalendarCommandBar` publishes `offsetHeight` into a CSS custom property with custom unmount cleanup. Serving all three from one composable produces the multi-mode API `WallBeanColumn`'s own docblock warns against.                                                                                         |
| `createIntervalGate` stays in `emitPolicy.ts` (pass 3)                                                                                    | **Cut.** `emitPolicy.ts` is not edited.                                                                      | It exists to rate-limit one `warn` on one flag-off surface. `createChangeGate` already handles it correctly — "slow" vs "not slow" is a transition, which is exactly what the gate emits on. A new shared telemetry primitive with one caller fails the second clause of the blast-radius rule.                                                                                                                                                                                                |
| `clusterOverlapping` lives in a new `src/utils/timeSpans.ts` with its own test file and a parity test against `groupOverlapping` (pass 3) | **Cut the file and the parity test.** `clusterOverlapping` is an export of `wallTimeGrid.ts`, tested there.  | One consumer, and the convergence it was generalising for is explicitly deferred to F2. A generic file plus a test that pins agreement with a function we have decided not to change is work for a refactor this plan is not doing. The sibling docblock cross-reference is kept — that is the part with value.                                                                                                                                                                                |

## Important Notes & Caveats

### ⚠️ The five rules below were each earned by a defect in the prototype. Every one has a regression test.

The layout looks simple and is not. Four separate defects appeared only when the prototype was screenshotted and looked at — none was caught by reasoning about the code, and one was invisible until a second view was rendered. They are recorded here because the naive implementation of each rule reintroduces the bug.

- **⚠️ Fold detection must run on TRUE event spans, never on rendered heights.** The minimum-block floor makes a 15-minute nursery drop-off _occupy_ 90 minutes of a week-scale axis. Feeding those inflated spans into gap detection closed the very gap that was meant to fold, and the fold silently stopped firing — a week that needed one fold rendered five hours of white space instead. The floor is a **rendering** minimum; it is not a claim about the day. Keep the two concerns apart.
- **⚠️ The pixel test for a fold must be measured against the UNFOLDED scale.** Testing "would this gap render taller than N px?" against the _folded_ scale is a runaway: each fold raises pixels-per-minute, which qualifies more gaps, which folds more. One honest fold became five, two of them 30-minute bands that replaced a 32px gap with a 30px band and saved nothing. Ask instead "how tall would this gap be if we folded nothing?" — a fixed question with a stable answer.
- **⚠️ A REAL overlap must never displace a later block.** Stacking two genuinely simultaneous events pushes everything below them down, and the push cascades: Thursday's dinner stopped lining up with every other Thursday's dinner across the week. **A grid whose y no longer means one time is not a grid** — that is the entire product claim, and stacking silently voids it. Real overlaps split the column. A _floor-induced_ collision (two consecutive events five minutes apart, both forced to the minimum height) is the opposite case and _should_ stack, because those events really do follow one another. Distinguish the two by testing the TRUE time ranges for intersection.
- **⚠️ The settle shift is a BUDGET problem, not a fold problem.** A block held open by the floor can end later than the fold that follows it, so the fold is pushed down and everything after moves with it — which makes the layout taller than the budget. Reacting by folding harder exhausted every tightening step and landed on the most aggressive setting available. Lay out again against a _smaller budget_ instead; the same gentle fold survives. **This is why the budget axis is adaptive and cannot be pre-enumerated — see §1a.**
- **⚠️ The now-line must render BEHIND event blocks.** Drawn over them it struck a line through the title of the very event it was marking — the one block on the screen whose text matters most at that moment. A running event announces itself with its own ring, marker and progress fill; the line's job is the space between blocks.

### ⚠️ Caveats found in review (pass 2)

- **⚠️ The ladder order in the prototype is minimum-block FIRST, gap threshold SECOND.** `concertina()` nests `for (minB of MIN_STEPS)` _inside_ `for (gap of GAP_STEPS)`, so for a fixed gap threshold the minimum block is walked all the way down (36 to 27) before the gap threshold moves at all. Pass 1 stated the opposite. **The prototype's order is the one that was screenshotted and approved** — shrinking a block by 3px is a smaller lie than folding away another half-hour of the day.
- **⚠️ The prototype has no defined behaviour for total exhaustion, and would clip.** When every rung fails, `concertina()` returns the last (most aggressive) `best`, whose `total` may still exceed `availableH`; the plot is `overflow: hidden`, so the last event of the day silently disappears. That violates requirement 8. **The `overflow` tier must apply a final global uniform squeeze** — multiply every `top` and `height`, and compose `yFor`, by `availableHeight / total`. Because it is one affine transform applied to the whole layout, cross-column y-alignment is preserved exactly; only legibility degrades, and the tier is telemetered so the degradation is measurable. Never clip.
- **⚠️ An unparseable or absurd `HH:mm` currently poisons the whole layout, silently.** `'abc'.split(':').map(Number)` yields `NaN`, `Math.min(..., NaN)` is `NaN`, and every subsequent `y()` is `NaN` — every block gets `top: NaNpx`, the browser drops the declaration, and all blocks pile at the top of an empty axis with **no error anywhere**. `parseMinutes` (`useCalendarNavigation.ts:193`) has exactly this hole today. The **new** helper must **validate** and return `null` on failure; the grid routes rejected occurrences into the all-day band (so no event is ever lost) and emits one `warn` naming the count. **The fix applies to the grid's own path only.** The identical hole in `parseMinutes` is follow-up F1.
- **⚠️ The 2-lane weight rule in the prototype reads the wrong two events.** `span[0] >= span[1]` compares the first two events _in cluster order_, which is only correct when the cluster has exactly two members. Derive the weights from the **lane occupants**, and test the three-events-two-lanes case explicitly.
- **⚠️ `peripheralVariant` as specified in pass 1 silently breaks the today view.** Its signature returned `'band' | 'strip'`, but `WallTodayView` renders `:variant="portrait ? 'band' : 'rail'"` (`WallTodayView.vue:269`). Returning `'band'` there would silently widen the rail into a band beside a grid that has no room for it. The helper takes the view's **preferred** variant and only ever downgrades it to `'strip'`.

### ⚠️ Caveats found in review (pass 3 — sustainability)

- **⚠️ `layoutTimeGrid` is the real long-term maintenance risk in this plan, and it is bigger than any of the refactors.** Ten ordered steps, nine tunable constants, four outcome tiers, and a **triple-nested loop** whose nesting order is load-bearing and was corrected once already. **Restructure the search so the two static axes are data** (§1a).
- **⚠️ The measured search is unbounded in the plan as written.** Give the search an explicit **early exit** on the first candidate that fits, an explicit **attempt ceiling**, and a stated cost bound; `wall_grid_slow` then means something specific.
- **⚠️ The lanes/today "everyone" all-day rule must be a named helper, not "a two-line derivation" in a view.** Two views deriving the same product rule inline is how the same rule ends up with two answers — and it must agree with `belongsInMemberColumn` (`assignees.ts:83`).
- **⚠️ `WallTimeGrid.vue` must not become the wall's second page component.** Cap it: the _only_ logic in the SFC is (a) measure, (b) call `layoutTimeGrid`, (c) resolve identities, (d) render.
- **⚠️ Three views changing shape at once, plus a deleted component, plus new shared primitives, in one commit, is not revertable.** See "Delivery sequence".

### ⚠️ Caveats found in review (pass 4 — fresh eyes)

- **⚠️ THE ALL-DAY BAND AS SPECIFIED WOULD DROP EVERY SINGLE-DAY ALL-DAY EVENT FROM THE DAYS VIEW.** This is the one functional regression pass 4 found. `computeAllDaySpans` returns `{ spans, singleByDate, spanningIds }`, and **`spans` contains multi-day items only** — a school INSET day, a birthday, bin night all land in `singleByDate`, keyed by date. Pass 3 specifies the days view feeding `spans` into the grid's `allDaySpans` prop and says nothing about `singleByDate`. Today those items render (they are in `wallEvents`, and `sortByTime` puts them first in the chip stack). Under the grid, timed events go to the plot and all-day events go to the band — so anything not in `allDaySpans` renders **nowhere at all**. The days view must map **both**. Pinned by a test and by an acceptance criterion.
- **⚠️ The two all-day producers do not share a shape, and the plan asserted they did.** `AllDaySpan` is `{ activity, startCol, span }`; `WallAllDaySpan` is `{ occurrence, startCol, span, everyone }`. The days view needs an explicit adapter.
- **⚠️ The budget axis is adaptive and cannot be a frozen array.** The prototype computes each budget point from the _previous attempt's_ overflow (`budget -= Math.max(4, over)`, abandoning the rung when `budget - over < availableH * 0.55`). `LADDER` is gap × minBlock; the budget retry stays an adaptive inner loop.
- **⚠️ Do not introduce a `better(best, a)` comparator.** The prototype simply keeps the last attempt. Adding an ordering over partially-failing layouts introduces a new, untested semantic into the one function whose every rule was earned by a defect.
- **⚠️ Restated bound: `MAX_ATTEMPTS` is 100, not 120.** 20 static rungs × <=5 budget retries.
- **⚠️ `WallLanesView` does not re-expand recurrences per call.** `todayEvents` / `tomorrowEvents` are already `computed`s (`WallLanesView.vue:102-103`). The repeated work at `:122`, `:160` and `:168` is a filter + sort of one day's entries — worth memoising while the file is being rewritten, but it is **not** the `activitiesForDate` bug `WallDaysView`'s docblock describes, and it must not be sold as one.

### Other constraints

- **⚠️ The peripheral-collapse decision must NOT be derived from the layout result.** Collapsing the band gives the grid more height, which may let it lay out gently again, which would un-collapse it, which shrinks it again. That is an oscillation on a screen that re-renders every 20 seconds forever. Derive the variant from **content**.
- **⚠️ `logEvent` is rate-limited to 50 events per surface per minute (`logEvent.ts:75`), and the wall never unmounts.** Emit through `createChangeGate` (`emitPolicy.ts:43`). Do **not** hand-roll a transition tracker, and do **not** add a new gate primitive.
- **⚠️ `perfTiming` has a `TELEMETRY_FLOOR_MS = 250` floor.** A grid layout takes single-digit milliseconds and would be dropped entirely. Log a duration only when it exceeds one frame (16ms).
- **⚠️ `activitiesForDate` expands a whole month of recurrences per call.** `WallDaysView` memoises this in a computed for exactly this reason (`:74-84`). The grid must preserve that memoisation.
- **The cap cannot break collision display.** Lanes are assigned from TRUE times, not rendered geometry. Assign lanes first, clamp heights second.
- **Do NOT resurrect `WallEventChip`.** Its only two consumers both become grids. Two chip components is the drift this codebase has already paid for five times over.
- **Do NOT introduce `src/composables/wall/`.** `src/composables/` is flat; the `useWall*` prefix already namespaces these.
- **Do NOT add a sub-12px rem size.** The existing wall scale carries **five** (`wall-pill` 0.6rem `:473`, `wall-nowtag` 0.66rem `:481`, `wall-lane-jobs-heading` 0.66rem `:582`, `wall-lock-heading` 0.7rem `:536`, `wall-chip-time` 0.72rem `:548`). This change **removes two** and adds none.
- **Do NOT reuse `ActivityViewEditModal`**; it imports the finance stores and would breach the wall's finance exclusion.
- **Do NOT edit `groupOverlapping`, `parseMinutes`, `addHourToTime` or `formatTime12` in this change.** All four are live-planner code with consumers outside the wall.

## Assumptions

> **Review these before implementation.** All verified 2026-09-03 unless noted.

1. `WallEventChip.vue` has exactly two consumers, `WallDaysView.vue:16` and `WallLanesView.vue:17`, and nothing in `e2e/` or `src/**/__tests__/` references it. (VERIFIED by grep.)
2. `BeanieWallPage.vue` passes `weekDays`, `todayYmd`, `tomorrowYmd`, `portrait`, `now`, `todosFor`, `unassignedTodos`, `listsFor`, `orphanLists`, `isPending`, `visibleMemberIds`, `backLabel` to every view through one `<component :is>` prop bag. (VERIFIED: `BeanieWallPage.vue:306-326`.)
3. `clockNow` ticks every 20 000 ms (`BeanieWallPage.vue:119-120`) and is passed as `:now`.
4. `useActivityIdentity().identityFor(activity, { laneMemberId })` returns `{ color, kind, stackMembers, emoji, celebration, sticker, style, edgeStyle, dashed }`, memoised on `id:updatedAt:lane:override:familyRevision:alpha` (`:172-173`); `edgeStyle` is the variant for a surface that keeps its own background. (VERIFIED.)
5. **CORRECTED (was wrong in pass 3).** `wallEvents` / `sortByTime` are in `src/utils/wallActivities.ts`. **`belongsInMemberColumn` is in `src/utils/assignees.ts:83`, not `wallActivities.ts`.** `wallActivities.ts` exports exactly `WallOccurrence`, `matchesWallFilter`, `sortByTime`, `wallEvents`, `wallActivityColour`. (VERIFIED.) Used at `WallLanesView.vue:114`.
6. `WallPeripheralCards` takes `variant: 'band' | 'rail'` (`:33`) and reads it in **four** places: `rows` (`:58`), the group slice (`:142`), the layout class (`:183`), the `gridTemplateColumns` binding (`:189`). `WallTodayView.vue:269` passes `portrait ? 'band' : 'rail'`; `WallDaysView.vue:205` and `WallLanesView.vue:208` pass `'band'`. (VERIFIED.)
7. `action` (`:68`), `error_code` (`:69`), `kind` (`:75`), `stage` (`:93`) and `count` (`:318`) are all in `ALLOWED_CONTEXT_KEYS` (`src/utils/diagnosticContext.ts`). (VERIFIED.) **No new context key**, so no `native-store-submission.md` / `PrivacyInfo.xcprivacy` / `privacy.astro` / Lambda-mirror change is required. (Note: `settingsStore.ts:335-338` carries a stale comment claiming `count` is _not_ allowlisted — it was added later, at `:318`. Do not be talked out of it; do not fix the comment here either.)
8. `beanieWall` is registered in `flagRegistry.ts:15` with committed prod state `false` (`src/config/featureFlags.committed.ts:11`). (VERIFIED.)
9. `activityStore.activitiesForDate(ymd)` returns `WallOccurrence`-shaped `{ activity, date }` entries and expands a month per call.
10. Activity times are stored as display-ready `HH:mm` strings in `startTime` / `endTime`, and `endTime` is optional. **They are not validated on write.**
11. **CORRECTED SHAPE (pass 4).** `computeAllDaySpans(occurrences, days)` (`src/utils/allDaySpans.ts:69`) returns `{ spans, singleByDate, spanningIds }` where `spans: { activity, startCol, span }[]` holds **multi-day items only**, `singleByDate: Map<string, FamilyActivity[]>` holds the single-day all-day items, and `spanningIds` is the exclusion set. It already `console.warn`s on malformed records and has a test file. It is explicitly **day-shaped** and does not apply to member columns. Its element type carries `activity`, **not** `occurrence`. (VERIFIED.)
12. `groupOverlapping` (`useCalendarNavigation.ts:162`) has **three** consumers, not one: `DayTimeline.vue:121`, `DailyCalendarView.vue:512` (inline in a `v-for`), `WeeklyCalendarView.vue:833` (inline in a `v-for`). It uses a 60-minute assumed duration. (VERIFIED.) Left alone — see F2.
13. `date.ts:497` is `addHourToTime` and `date.ts:588` is `formatTime12` — **neither is a minutes-since-midnight parser**; both destructure `[h, m]` in order to re-format. 23 distinct files import one or both. (VERIFIED.)
14. `ExpandableText.vue:50` and `CalendarCommandBar.vue:94` are the only two `new ResizeObserver` sites in `src/`. **Neither consumes a width or a height value** — both are side-effect measurers. (VERIFIED.)
15. `docs/mockups/2026-09-03-wall-time-grid.html` is currently **untracked** and is committed as part of this change.
16. `WallDaysView.dayLabel/dayNumber` (`:91-96`) and `WallTodayView.dayLabel/dayNumber` (`:144-149`) are byte-identical. (VERIFIED.)
17. The prototype's compromise search is: `for gap of GAP_STEPS { for minB of MIN_STEPS { budget = availableH; for k<5 { solve, place, settle; if total <= availableH+1 break outer; over = total - availableH; if budget - over < availableH*0.55 break; budget -= max(4, over) } } }`, and after the loop `best` is simply the **last** attempt. (VERIFIED.)

## Approach

The design intent of the prototype is reproduced faithfully — the concertina axis, the fold band and its Caveat label, the all-day band, the weighted overlap split, the now treatment, the dimming of the past. Every concrete style token comes from the beanies theme + CIG, not from the prototype's raw hex values: member hue via `useActivityIdentity`, Heritage Orange for the now-line and the fold's accents, Sky Silk for the all-day band, squircle radii, Outfit/Inter/Caveat, and the wall type scale extended in `BeanieWallPage.vue`'s scoped block in the existing idiom.

The change is **three additive shared pieces, two components, three thinner views, and nothing else**. No existing non-wall file changes behaviour.

### 0. Three shared primitives — all additive

**(a) `minutesOfDay` — `src/utils/date.ts` (new export)**

`const [h, m] = time.split(':').map(Number)` appears in eight places today and **not one of them rejects `NaN`**. This adds the one that does. Returns `null` rather than `NaN` on purpose: `NaN` propagates through arithmetic silently and lands in a CSS length, where the browser drops the declaration and the element renders at the wrong place with no error anywhere. A `null` is a value a caller is forced to handle.

Validates: two colon-separated integer parts, `0 <= h <= 24`, `0 <= m <= 59`, result `0 <= n <= 1440`. Anything else -> `null`. Its docblock states that it does NOT yet replace the ad-hoc destructures elsewhere, and names F1/F2/F4.

**(b) `activitySpanMinutes`, `ASSUMED_DURATION_MIN`, `WallAllDaySpan`, `wallDayAllDay`, `wallSharedAllDay`, `wallPeripheralVariant` — `src/utils/wallActivities.ts` (new exports)**

`activitySpanMinutes(activity, assumedDurationMin?)` returns the TRUE minute span of a timed occurrence, or `null` when it is all-day or its times are unusable. The ONE definition of "when is this on" for the wall. The assumed duration stays a **parameter with a wall default of 90**, not a globally unified constant: the planner's `groupOverlapping` assumes 60, and quietly changing that would alter `DayTimeline`, `DailyCalendarView` and `WeeklyCalendarView` clustering as an invisible side effect of a wall feature.

**(c) `useElementSize` — `src/composables/useElementSize.ts` (new file)**

Returns `{ width, height, measure }`. Feature-detects `ResizeObserver`; when absent, measures once on mount plus on `window` resize (debounced to a frame) and emits **one** `warn`. Wraps the callback body in `try/catch` — a throw out of an observer callback kills the observer permanently, which is the lesson `CalendarCommandBar` already learned. Disconnects on unmount.

**API scope is deliberately narrow.** No `onResize` callback, no CSS-var publishing, no clamp options — those are what `ExpandableText` and `CalendarCommandBar` would need, and adding them speculatively produces an abstraction shaped by hypotheses. Its docblock names both files as intended future consumers and points at F3.

**Why a composable and not ten lines in the SFC** (stated because it looks like premature abstraction and is not): it has one consumer, so DRY does not justify it. It is justified by the `WallTimeGrid.vue` complexity budget — the guard, fallback, debounce and `try/catch` are ~35 lines that are not layout — and by the fact that putting the lesson somewhere nameable is what stops a fourth hand-rolled observer.

### 1. The layout is a pure module — `src/utils/wallTimeGrid.ts`

No Vue, no stores, no DOM. This is the single most important structural decision in the plan: the algorithm is where every defect lived, and a pure function is the only version of it that can be tested exhaustively. It sits beside `wallActivities.ts` and `wallJobs.ts`, which are pure for the same reason.

```ts
export interface GridBlock {
  occurrence: WallOccurrence;
  start: number;
  end: number; // TRUE minutes — the block's own truth
  top: number;
  height: number; // rendered px
  lane: number;
  lanes: number;
  laneOffset: number;
  laneWidth: number; // fractions 0..1
  capped: boolean;
}
export interface GridFold {
  top: number;
  height: number;
  resumeMinutes: number;
}
export interface GridLayout {
  columns: GridBlock[][];
  folds: GridFold[];
  ticks: { minutes: number; y: number }[];
  yFor: (minutes: number) => number;
  windowStart: number;
  windowEnd: number;
  /** Occurrences whose times could not be read. NEVER silently dropped. */
  rejected: WallOccurrence[];
  tier: 'gentle' | 'tightened' | 'floored' | 'overflow';
  attempts: number;
}
export function layoutTimeGrid(
  columns: readonly (readonly WallOccurrence[])[],
  availableHeight: number,
  options?: { minBlock?: number; maxBlock?: number; assumedDurationMin?: number }
): GridLayout;
```

#### 1a. The static axes are DATA; the budget axis stays adaptive

Pass 2 specified three nested `for` loops whose _nesting order_ encoded the approved precedence. Pass 3 tried to flatten all three into one frozen array. **Only two of the three can be flattened**, because the prototype's budget step is computed from the previous attempt's measured overflow (assumption 17).

```ts
interface Rung {
  gapMinutes: number;
  minBlock: number;
}

/**
 * The compromise ladder, in the exact precedence approved from the prototype:
 * the minimum block shrinks before the gap threshold moves — a 3px shorter block
 * is a smaller lie than folding away another half-hour of the day.
 *
 * Frozen and exported so the precedence test asserts on THIS ARRAY: a reordering
 * is caught by a diff on a list rather than by reasoning about indentation.
 *
 * The BUDGET is deliberately NOT a third axis. The prototype derives each budget
 * retry from the previous attempt's overflow; it is feedback, not enumeration.
 */
export const LADDER: readonly Rung[] = Object.freeze(
  GAP_MINUTE_STEPS.flatMap(
    (gapMinutes) =>
      // outer — folding harder is the LAST resort
      MIN_BLOCK_STEPS.map((minBlock) => ({ gapMinutes, minBlock })) // inner — the cheapest lie
  )
); // 5 × 4 = 20 rungs
```

`layoutTimeGrid` then reads, in full:

```
parse -> window ->
for (const rung of LADDER) {
  let budget = availableHeight;
  for (let k = 0; k < BUDGET_RETRIES; k++) {
    const a = attempt(input, rung, budget, availableHeight);
    attempts++;
    if (a.total <= availableHeight + 1) return finish(a, rung, attempts);
    last = a;
    const over = a.total - availableHeight;
    if (budget - over < availableHeight * MIN_BUDGET_FRACTION) break;
    budget -= Math.max(4, over);
  }
}
return squeeze(last, availableHeight, attempts);
```

Four consequences, all of them the point:

- **`attempt()` is the only place layout logic lives.** Every one of the five prototype-earned rules is inside it, tested directly, once.
- **Adding, removing or reordering a static rung is a one-line data change**, with a failing precedence test if you do it by accident.
- **Nesting depth never exceeds two**, and both levels read plainly.
- **No `better()` comparator.** After exhaustion the retained candidate is the **last** attempt, exactly as the prototype does.

`MAX_ATTEMPTS = LADDER.length * BUDGET_RETRIES` = **100** is asserted in a test so the constant and the arithmetic cannot drift apart, and the loop **exits on the first candidate that fits**, so the common case is one attempt. Worst case is bounded and stated: 100 × O(n log n); at the wall's realistic ceiling (~40 occurrences across 7 columns) that is single-digit milliseconds, which is why `wall_grid_slow` fires at 16ms and means something.

The `+ 1` px tolerance on the fit test is the prototype's and is kept deliberately — without it a layout that lands a hundredth of a pixel over budget walks the entire ladder for nothing.

#### 1b. Tunables — the only tuning surface

All named constants, in one exported table. **No magic number appears anywhere else in the module.**

| Constant              | Value                  | Why                                                                     |
| --------------------- | ---------------------- | ----------------------------------------------------------------------- |
| `FOLD_HEIGHT_PX`      | 30                     | A folded stretch is always this tall.                                   |
| `MAX_GAP_PX`          | 74                     | No empty stretch may render taller than this **at the unfolded scale**. |
| `GAP_MINUTE_STEPS`    | `[90, 75, 60, 45, 30]` | Tightening ladder — **outer**, moves last.                              |
| `MIN_BLOCK_STEPS`     | `[36, 33, 30, 27]`     | Tightening ladder — **inner**; 27px still clears the type floor.        |
| `BUDGET_RETRIES`      | 5                      | Adaptive re-lays against a smaller budget within one rung.              |
| `MIN_BUDGET_FRACTION` | 0.55                   | The budget never shrinks below this share of the height.                |
| `MAX_BLOCK_PX`        | 132                    | The approved cap — about 3.6× the minimum.                              |
| `SLIVER_PX`           | 95                     | Below this a lane width loses its title.                                |
| `WIDE_PX`             | 210                    | Above this a block earns its detail line.                               |

All nine match the prototype's values.

#### 1c. The rules inside `attempt()`, in the order they must run

1. **Parse** (hoisted out of the search — done once, not 100 times) — every occurrence through `activitySpanMinutes`. All-day items and rejects split out here; **rejects are returned, never discarded.**
2. **Window** (also hoisted) — `floor(min(start)/5)*5` to `ceil(max(end)/5)*5`.
3. **Fold detection** — merge every column's TRUE spans, sweep the gaps. A gap folds when longer than `max(20, min(rung.gapMinutes, MAX_GAP_PX / unfoldedPxPerMin))`, where `unfoldedPxPerMin` comes from a scale built with **zero folds**. Single pass, stable, no feedback.
4. **Scale** — piecewise `yFor(t)`: linear at `pxPerMin` outside folds, `FOLD_HEIGHT_PX` linearly across each fold.
5. **Lanes** — cluster via `clusterOverlapping` on TRUE spans; assign greedily. A cluster occupying two lanes gets weights `[0.62, 0.38]` with the **longest occupant of lane 0** compared against the **longest occupant of lane 1**; three or more split evenly.
6. **Heights** — `clamp(rung.minBlock, yFor(end) - yFor(start), MAX_BLOCK_PX)`; `capped` set when the cap bit.
7. **Nudge** — within one lane only, push apart blocks whose _rendered_ boxes collide although their true times do not.
8. **Settle** — walk the folds in order; a fold is pushed below the lowest block that starts before it, and every block starting at or after the fold's end shifts by the same delta. `yFor` is wrapped so the axis, the rules and the now-line all move with it.

Steps 3-8 are six named, individually exported-for-test pure functions, not one 200-line body. `attempt()` is their composition and nothing else.

#### 1d. Outcome

`tier` is assigned in `finish()` from _where in `LADDER`_ the accepted candidate sat and whether the budget moved: `gentle` (rung 0, first budget), `tightened` (rung 0, budget retried), `floored` (any rung > 0).

**Squeeze** — if the whole ladder is exhausted and `last.total > availableHeight`, scale every `top`/`height` and compose `yFor` by `availableHeight / total`, and set `tier: 'overflow'`. One affine transform over the whole layout, so **cross-column alignment survives exactly** and no event is clipped. This rung is what makes requirement 8 true.

The function is **total** — never throws for any input, including zero events (an empty layout with a default 08:00-20:00 window, matching the prototype), a single instantaneous event, an all-day-only day, unparseable times, and a zero or negative `availableHeight` (clamped to a 1px floor so no division by zero can occur).

#### 1e. `clusterOverlapping` (exported from this module)

Groups items into clusters of mutually-overlapping ranges, on **already parsed** minute offsets. Pure, total, generic — no time-string parsing, no assumed-duration policy, both of which are the caller's business.

Its docblock names `groupOverlapping` (`useCalendarNavigation.ts:162`) as its sibling, explains that pointing it at this function would change behaviour for three live planner call sites, and points at F2 — with the instruction _"if you are here to change clustering, change BOTH or neither."_ It lives here rather than in a generic `timeSpans.ts` because it has exactly one consumer; move it out when it gets a second. A reciprocal `@see` above `groupOverlapping` is the **only** edit made to `useCalendarNavigation.ts`.

### 2. `src/components/wall/WallTimeGrid.vue` — the one renderer

Presentational and store-free except for `useActivityIdentity`. Props: `columns` (key, label, occurrences, laneMemberId, isToday), `allDaySpans` (pre-computed by the view — see §4a), `now`, `dimPast`, `showNow`, `axisWidth`, `portrait`.

**Complexity budget — a review gate, not a suggestion.** The SFC does exactly four things: **measure**, **call `layoutTimeGrid`**, **resolve identities**, **render**. Anything derivable from props alone is a pure function elsewhere. Target <= ~300 lines of `<script setup>`; template nesting inside `.plot` does not exceed three levels.

It owns exactly one piece of state a pure function cannot have: **the measured plot height**, via `useElementSize`. The layout is a `computed` over that ref. There is no feedback loop, because the plot's height is set by flexbox and the grid's contents are absolutely positioned inside it — the layout cannot change the box it is measured against. A comment in the file says so, because "ResizeObserver drives a computed that renders into the observed element" is normally an infinite loop and the reason it is safe here is structural, not incidental.

A measured height of `0` (hidden tab, or the first frame before flex resolves) **does not lay out**: the previous good layout is retained and one `debug` event records it.

Structure — one continuous white surface with column dividers, **not** n separate cards. That is what lets a rule drawn at 07:30 be a single line across the whole week:

```
.heads      day / bean headers, on the same grid track as the plot
.allday     Sky Silk band; shared items span with an "everyone" tag
.plotwrap   .axis (labels + fold ticks)  |  .plot  |  .nowpill
```

Ordering inside `.plot` is specified and commented so a future reorder is a conscious act: wash -> rules -> fold bands -> dividers -> **now-line** -> columns -> fold labels. The now-line under the blocks; the fold labels over them.

Axis labels are **event start times only**, deduped and suppressed within 20px of the previous label. An hourly ruler is noise on a folded axis and cannot be drawn inside a fold at all.

**Failure path — three named failures, none of them silent.**

| What fails                           | User sees                                                                                                                                                                                                               | Developer gets                                                                                                                                                                                         |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `layoutTimeGrid` throws              | The same `WallTimeBlock`s in ordinary static flow (a plain chronological list) **plus a Caveat line reading `t('wall.grid.fallback')`**, so the degraded layout explains itself instead of looking like a design choice | `reportError({ surface: 'wall-time-grid', severity: 'error', context: { action: 'layout', kind: viewId, error_code: 'layout_threw' } })` + a `console.error` naming the pure module as the replay site |
| An occurrence's times are unreadable | The event appears in the **all-day band** — visible, tappable, never lost                                                                                                                                               | one change-gated `warn` with `error_code: 'unreadable_time'` and a `count`                                                                                                                             |
| `ResizeObserver` unavailable         | Lays out against the mount-time height, re-measures on `window` resize                                                                                                                                                  | the single `warn` from `useElementSize`                                                                                                                                                                |

`severity: 'error'` not `'critical'`: nothing is lost and no user action failed, so this belongs in the firehose, not on Slack at 3am. The fallback costs no new component — it is the same block in a different container.

### 3. `src/components/wall/WallTimeBlock.vue` — one block, three densities

Replaces `WallEventChip.vue`, which is **deleted**. Takes a resolved `identity` (computed by the parent, exactly as `WallEventChip` does today: the rule is written once in `useActivityIdentity` and deriving it per block could disagree with its own parent). Reuses `ActivityOwnerStack` and `CelebrationConfetti` unchanged.

Density comes from the width the block actually gets — `laneWidth × columnWidth`, not the column width — because the second half of a collision is a different size from the first:

| Density  | Width    | Renders                                            |
| -------- | -------- | -------------------------------------------------- |
| `full`   | > 210px  | emoji + title + `07:30-08:00 · Leo & Milo` + faces |
| `tight`  | 95-210px | emoji + title (2-line clamp) + faces               |
| `sliver` | < 95px   | emoji only, centred; title on `title`/`aria-label` |

State is `past` / `running` / `future`. `running` adds a ring in the owner's hue, a `now` marker (suppressed below 150px), and a progress fill along the foot. `past` drops to 42% opacity and loses its shadow. A **capped** block always prints its `HH:mm-HH:mm` range above `sliver`, so the clamp is never silent.

Density and state are two flat `computed` string unions — nine visual combinations expressed as two independent classes, not nine branches.

### 4. The three views become thin

Each keeps its current prop contract from the page — **no change to `BeanieWallPage.vue`'s template or `wallViews.ts`** — and each now decides only _what the columns are_, then renders `WallTimeGrid` plus its own furniture.

- **`WallDaysView`** — columns are days (7 landscape, 3 + tappable strip portrait). Keeps its memoised `eventsByDay` computed verbatim, docblock and all. Loses `cap`/`shownFor`/`overflowFor`/`timeLabel` and the `+N more` button: the grid does not truncate. The day header stays the drill-in to the day sheet.
- **`WallLanesView`** — columns are beans. `belongsInMemberColumn` (`assignees.ts:83`) still selects; `laneMemberId` still flows into `identityFor` so a face inside a lane still means "someone else is in this too". `eventsByMember` becomes a memoised computed `Map`, matching the `todosByMember` idiom already at `:86` — a modest saving, **not** the `activitiesForDate` bug. The jobs footer moves from inside each `WallBeanColumn` to a single row pinned below the grid on the same column track, so the lanes are a grid and the jobs are a grid, aligned. `WallBeanColumn` is reused for the **header cell** only.
- **`WallTodayView`** — one wide column, `full` density, the now-line as the hero. Keeps `focusYmd`, the watch that follows `todayYmd` through midnight, the week strip and `back to today`. Loses its hand-rolled `minutesOf` (`:86`), local `ASSUMED_DURATION_MIN` (`:25`) and `nowId` (`:97`) — **deletions from a file this change rewrites**, not migrations of live code elsewhere.

#### 4a. The all-day band — both shapes, or events disappear

**This is the one place pass 4 found a functional regression, and it is the reason this subsection exists.**

`WallAllDaySpan` is declared once, in `wallActivities.ts`, and is what `WallTimeGrid`'s `allDaySpans` prop takes from both sources — so the two producers are structurally forced to agree:

```ts
export interface WallAllDaySpan {
  occurrence: WallOccurrence;
  startCol: number; // 0-indexed within the columns passed to the grid
  span: number; // cells covered, clamped to the visible columns
  everyone: boolean; // rendered once, spanning every column, tagged "everyone"
}
```

**Days view.** `computeAllDaySpans` returns `AllDaySpan { activity, startCol, span }` — **not** `WallAllDaySpan` — and its `spans` array holds **multi-day items only**. Single-day all-day items (a birthday, an INSET day, bin night) come back in `singleByDate`. The view must therefore produce **both**, via one small named adapter in `wallActivities.ts` so it is testable:

```ts
/**
 * Adapt `computeAllDaySpans`' day-shaped result to the grid's band.
 *
 * BOTH halves are required. `spans` is multi-day ONLY; every single-day all-day
 * item is in `singleByDate`. Feeding the grid `spans` alone drops birthdays,
 * INSET days and bin night from the days view entirely — they are not timed, so
 * they never reach the plot either. That regression is what this function exists
 * to make impossible; see the test of the same name.
 */
export function wallDayAllDay(
  result: AllDaySpansResult,
  days: readonly string[],
  occurrenceFor: (activity: FamilyActivity, ymd: string) => WallOccurrence
): WallAllDaySpan[];
```

Multi-day spans map straight across with `everyone: false`; each `singleByDate` entry becomes `{ startCol: days.indexOf(ymd), span: 1, everyone: false }`. `computeAllDaySpans` applies no member filter, so the view passes it the **already-filtered** `wallEvents` output, matching what the plot receives.

**Lanes and today.** `computeAllDaySpans` is day-shaped by contract, so lanes and today need their own rule — but _both_ need it, and it has to agree with `belongsInMemberColumn`. One export, one test, two callers: `wallSharedAllDay(occurrences, memberIds)`. An item landing in **every** visible member column renders once, spanning, tagged "everyone"; anything else renders in the columns it belongs to. Deliberately separate from `computeAllDaySpans` — one function serving both would need a mode flag, the shape `WallBeanColumn`'s docblock warns against. (The today view has one column, so every all-day item is trivially `everyone`, which is the correct rendering and falls out without a special case.)

#### 4b. Two byte-identical helpers move

`dayLabel` / `dayNumber` are byte-identical in `WallDaysView` (`:91-96`) and `WallTodayView` (`:144-149`). They move to `src/utils/date.ts` as `weekdayShort(ymd)` / `dayOfMonth(ymd)`, beside `formatDateShort` and `formatDayLong` — **additive exports, four call sites, all four inside files this change already rewrites.** The two week strips themselves stay as they are: they render different things (3-day rest row vs 7-day pill strip) and a shared component would need a mode flag.

### 5. Peripheral collapse — `variant: 'strip'`

`WallPeripheralCards` gains a third variant rendering one row of `emoji · headline · detail` cells. This is an **additive** widening of an existing union: every current caller passes `'band'` or `'rail'` and is unaffected. **The variant is read in four places, not one** — `:58`, `:142`, `:183`, `:189` — and all four need an explicit `'strip'` case rather than falling through a `!== 'rail'` ternary. `rows` becomes `variant === 'band' ? 3 : variant === 'rail' ? 2 : 1`.

The **decision** lives in one pure helper in `wallActivities.ts` (where the wall's content rules already live — it is not layout), and it **downgrades a preference rather than replacing it**, because the today view legitimately wants `rail`:

```ts
/**
 * Content-derived, never layout-derived: collapsing the band gives the grid
 * height, which could let it lay out gently, which would un-collapse the band.
 * On a screen that re-renders every 20s forever that is a permanent flicker.
 */
export function wallPeripheralVariant(
  preferred: 'band' | 'rail',
  busiestColumnCount: number,
  portrait: boolean
): 'band' | 'rail' | 'strip' {
  return busiestColumnCount > (portrait ? 9 : 7) ? 'strip' : preferred;
}
```

Each view passes `busiest` from the memo it already builds — one line each, no re-derivation.

### 6. Strings

New keys in `uiStrings.ts` (both `en` and `beanie`):

| Key                    | en                                                         | beanie                                                        |
| ---------------------- | ---------------------------------------------------------- | ------------------------------------------------------------- |
| `wall.grid.quietUntil` | `Quiet until {time}`                                       | `quiet until {time}`                                          |
| `wall.grid.allDay`     | `All day`                                                  | `all day`                                                     |
| `wall.grid.everyone`   | `Everyone`                                                 | `everyone`                                                    |
| `wall.grid.runningNow` | `Now`                                                      | `now`                                                         |
| `wall.grid.nowAt`      | `Now {time}`                                               | `now {time}`                                                  |
| `wall.grid.fallback`   | `Showing a simple list — the time grid could not be drawn` | `showing a simple list — the time grid could not be drawn 🫘` |

`wall.grid.runningNow` is deliberately not `wall.today.now` (`'Happening now'`) — the block marker has room for one word, the today-view heading has room for two, and collapsing them would degrade one of the two.

Reused unchanged: `wall.day.nothingOn`, `wall.today.now`, `wall.today.today`, `wall.today.backToToday`, `planner.allDay`. **`wall.card.more` loses two call sites, not one** — `WallDaysView.vue:157` and `WallLanesView.vue:196` — keeping **two**: `WallChoreBoard.vue:236` and `WallPeripheralCards.vue:282`.

### 7. Type scale

Added to `BeanieWallPage.vue`'s scoped block, all rem, all >= 0.75rem. A **net reduction** in wall type classes and in sub-floor sizes (5 -> 3):

- **Renamed** (same 0.95rem value): `.wall-chip-title` (`:551`) -> `.wall-block-title`
- **Deleted with their sole consumers**: `.wall-chip-time` (0.72rem, `:547`) and `.wall-nowtag` (0.66rem, `:480`). Neither has a `.wall-portrait` override.
- **Added (7)**: `.wall-axis` 0.88 · `.wall-block-title-tight` 0.85 · `.wall-block-meta` 0.75 (also carries the all-day tag and the running marker) · `.wall-block-sliver` 1.05 · `.wall-fold-label` 1.15 (Caveat) · `.wall-nowpill` 0.78 · `.wall-allday` 0.85

**Portrait overrides are added only where a screenshot shows one is needed.** There are six today, not one per class; adding seven speculatively is seven untested rules.

## ⭐ Revised during implementation — the grid had to read as a grid

Everything above §7 was written from the approved prototype. Reviewing the
feature on the running app produced one change large enough that the sections
above are now partly historical, and it is recorded here rather than by quietly
rewriting them.

**What was wrong.** The prototype fitted the scale CONTINUOUSLY to whatever
height the plot had, and ticked the axis at event START times. Both follow from
"make the day fit", and both are wrong for the same reason: nothing on screen
told the reader that the vertical axis was linear. An hour was a different height
on Tuesday than on Thursday, and the labels came out at 07:30 / 08:05 / 15:20 /
16:00 — irregular spacing that looked arbitrary. Greg's words: _"the gaps appear
random heights — 1 hour is not represented with a consistent height. this makes
it very confusing to read the calendar."_ He was right, and the fix is the one he
named: a consistent grid, interrupted only by a clearly-marked quiet gap.

**What changed.**

| Was                                                 | Now                                                            | Why                                                                                                                                                                                                                              |
| --------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pxPerMin` fitted continuously to the plot height   | `SCALE_STEPS = [0.8, 0.7, 0.6, 0.5, 0.42, 0.35]`, quantized    | Most days land on the SAME step, so the grid looks identical day to day; a packed day steps down visibly rather than drifting.                                                                                                   |
| Axis ticks at event start times                     | Ticks on the **hour**, evenly spaced                           | The scale was already uniform; now it _reads_ uniform. Hours inside a fold are skipped.                                                                                                                                          |
| Hour rules at 6% opacity                            | 11% (13% dark), drawn on every view                            | The lanes and today views read as having no grid at all.                                                                                                                                                                         |
| `FOLD_HEIGHT_PX = 30`, fixed                        | `MIN_FOLD_PX` 44 → `MAX_FOLD_PX` 110 at `FOLD_PX_PER_MIN` 0.09 | A fixed band made a one-hour lull and a six-hour school day identical: the fold said "time passed here" and refused to say how much.                                                                                             |
| Window snapped out to 5 minutes                     | Snapped out to **whole hours**                                 | The grid has to start and end on a labelled rule; 07:30 put the first event flush against the top edge with nothing to read it against.                                                                                          |
| `MAX_BLOCK_PX = 132`, then 76                       | **190** (~4 hours)                                             | Once the hour rules were visible, a cap below a normal event length made a two-hour block stop short of its own 18:00 line — the grid contradicting itself. The cap is for the eight-hour conference, not the football training. |
| `BUDGET_RETRIES` / `MIN_BUDGET_FRACTION` inner loop | **Gone**                                                       | The budget retry existed only to absorb overflow into a continuously-variable scale. Scale is now just another ladder rung; the search is one pass and bounded by `LADDER.length` (120).                                         |

**The ladder gained an axis, and it is the outermost one.** `LADDER` is now
`SCALE_STEPS × GAP_MINUTE_STEPS × MIN_BLOCK_STEPS` with scale outermost, so
everything else is spent before the height of an hour is allowed to change. The
precedence test asserts this directly on the frozen array.

**Known and accepted.** The `MIN_BLOCK_STEPS` floor still wins over exact
proportionality for short events: on a dense week column (~25px/hour) a
thirty-minute event is drawn at the 36px legibility floor and so overshoots its
own end line. Every dense calendar makes this trade; the alternative is an
unreadable 12px block on a screen meant to be read from three metres.

## Delivery sequence

Three commits on one branch, each green on its own, each revertable alone. This is the blast-radius rule made operational.

**Commit 1 — additive primitives.** `minutesOfDay`, `weekdayShort`, `dayOfMonth`, `activitySpanMinutes`, `ASSUMED_DURATION_MIN`, `wallSharedAllDay`, `wallDayAllDay`, `wallPeripheralVariant`, `WallAllDaySpan`, `useElementSize.ts`, plus their tests, plus the `@see` comment on `groupOverlapping`. **No existing behaviour changes.**

**Commit 2 — the wall grid.** `wallTimeGrid.ts` (including `clusterOverlapping`), `WallTimeGrid.vue`, `WallTimeBlock.vue`, the three views, `WallPeripheralCards`' `'strip'`, the type scale, the strings, the `WallEventChip` deletion, the committed mockup. Entirely inside `beanieWall`, except the union widening no existing caller reaches. **`git revert` of this one commit removes the feature.**

**Commit 3 — docs.** `CHANGELOG.md`, `docs/STATUS.md`, and this plan file.

The convergence refactors (F1-F4) are **not on this branch**.

## Follow-ups (deliberately deferred, with owners in code)

- **F1 — `parseMinutes` returns `NaN` for malformed input (`useCalendarNavigation.ts:193`).** A live planner bug, not a wall bug. Fix it in its own change, with a regression test per affected view, so the diff being reviewed is _the fix_ and not a 2,000-line feature.
- **F2 — converge `groupOverlapping` onto `clusterOverlapping`.** Blocked on F1 (same question). Three call sites, two inline in `v-for` in the largest planner views; both also re-cluster on every render, worth fixing at the same time. When done, `clusterOverlapping` moves out of `wallTimeGrid.ts` into a shared home.
- **F3 — migrate `ExpandableText` and `CalendarCommandBar` onto `useElementSize`.** Only if the composable can absorb both _without_ growing a mode flag. If it cannot, the honest outcome is that these are two different problems and the duplication was never the real one — record that and close it. Until then both files keep a `// See useElementSize.ts — this predates it (follow-up F3).` comment so nobody writes a fourth.
- **F4 — the four remaining ad-hoc `HH:mm` destructures** (`todo.ts:16`, `TimePresetPicker.vue:60,102`, `DayTimeline.vue:131,133`) converge on `minutesOfDay`. `addHourToTime` and `formatTime12` are **not** in scope even for F4 without a deliberate decision about their malformed-input output across 23 importing files.

## Files Affected

**Created**

- `src/utils/wallTimeGrid.ts` — the pure layout module, including `clusterOverlapping`
- `src/composables/useElementSize.ts` — the one guarded `ResizeObserver`
- `src/components/wall/WallTimeGrid.vue`
- `src/components/wall/WallTimeBlock.vue`
- `src/utils/__tests__/wallTimeGrid.test.ts` — the regression suite
- `src/composables/__tests__/useElementSize.test.ts`
- `src/components/wall/__tests__/WallTimeGrid.test.ts`
- `src/components/wall/__tests__/WallTimeBlock.test.ts`

**Modified — additive only (no existing behaviour changes)**

- `src/utils/date.ts` — **adds** `minutesOfDay`, `weekdayShort`, `dayOfMonth`. `addHourToTime` (`:497`) and `formatTime12` (`:588`) are **not touched**.
- `src/utils/wallActivities.ts` — adds `activitySpanMinutes`, `ASSUMED_DURATION_MIN`, `WallAllDaySpan`, `wallDayAllDay`, `wallSharedAllDay`, `wallPeripheralVariant`
- `src/composables/useCalendarNavigation.ts` — **comment only**: an `@see` above `groupOverlapping`
- `src/components/wall/WallPeripheralCards.vue` — adds `'strip'` to the union and to all four read sites
- `src/services/translation/uiStrings.ts` — six new keys

**Modified — behaviour changes, all inside the `beanieWall` flag**

- `src/components/wall/WallDaysView.vue`, `WallLanesView.vue`, `WallTodayView.vue`
- `src/pages/BeanieWallPage.vue` — scoped type-scale changes only

**Deleted**

- `src/components/wall/WallEventChip.vue` — zero consumers after this change

**Docs**

- `docs/mockups/2026-09-03-wall-time-grid.html` (newly committed), `docs/plans/2026-09-03-wall-time-grid.md`, `CHANGELOG.md`, `docs/STATUS.md`

**Explicitly NOT modified**

- `src/components/planner/DayTimeline.vue`, `DailyCalendarView.vue`, `WeeklyCalendarView.vue`
- `src/components/ui/ExpandableText.vue`, `src/components/planner/CalendarCommandBar.vue`
- `src/services/telemetry/emitPolicy.ts`

## Observability Coverage

Surface: **`wall-time-grid`** (kebab-case, greppable — one CloudWatch filter isolates this feature). Every context key used is already in `ALLOWED_CONTEXT_KEYS`, so **no allowlist change, no Lambda-mirror change and no store-declaration update is required**.

**Events**

| Event                                  | Level               | Context                                                                      | Why                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------- | ------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wall_grid_tier`                       | `info`              | `{ action: 'layout', kind: <viewId>, stage: <tier> }`                        | The compromise rung the layout landed on. Emitted through **`createChangeGate()`**, one gate per view id — transitions always emit, plus a heartbeat every 20th identical repeat. The wall never unmounts and `logEvent` drops everything on a surface once 50/min is hit; the gate is the codebase's existing answer to exactly that. Because it fires on the `gentle` path too, the _rate_ of degradation is measurable. |
| `wall_grid_unreadable_time`            | `warn`              | `{ action: 'layout', kind: <viewId>, error_code: 'unreadable_time', count }` | Occurrences whose times could not be read; routed into the all-day band rather than dropped. Change-gated on the count.                                                                                                                                                                                                                                                                                                    |
| `wall_grid_slow`                       | `warn`              | `{ action: 'layout', kind: <viewId>, stage: 'slow' }`                        | Layout exceeded one frame (16ms). Meaningful because the search is bounded and early-exits, so a slow layout means an unusual _input_, not an unbounded algorithm. Not routed through `perfTiming`: the 250ms floor would drop it entirely. Emitted through the same `createChangeGate` on a boolean slow/not-slow signal.                                                                                                 |
| `wall_grid_failed` (via `reportError`) | `severity: 'error'` | `{ action: 'layout', kind: <viewId>, error_code: 'layout_threw' }`           | The layout threw and the grid fell back to a labelled static list. Firehose, **not** Slack.                                                                                                                                                                                                                                                                                                                                |
| `element_size_unobservable`            | `warn`              | `{ action: 'measure', error_code: 'no_resize_observer' }`                    | Once per instance when `ResizeObserver` is missing.                                                                                                                                                                                                                                                                                                                                                                        |

**Failure modes and how each is triaged blind**

| Failure                                                     | Diagnosed by                                                                                          |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Grid renders as an unreadable crush on some family's device | `wall_grid_tier` with `stage: 'floored'` or `'overflow'`                                              |
| An event looks squashed at the bottom of the day            | `stage: 'overflow'` is the only tier that squeezes; its absence exonerates the layout                 |
| "An event vanished from the grid"                           | `wall_grid_unreadable_time` with a count — the event is in the all-day band, and the data is at fault |
| Wall feels sluggish on an old iPad                          | `wall_grid_slow`, correlated by `family_id`                                                           |
| Blank or list-shaped calendar                               | `wall_grid_failed` with `error_code`, plus console guidance naming the pure module                    |
| Grid does not resize when the tablet rotates                | `element_size_unobservable`                                                                           |
| A regression makes every family degrade                     | the _rate_ of `stage: 'gentle'` vs the rest — which is why the success path emits                     |

**No silent failures.** `layoutTimeGrid` is total _and_ wrapped; unreadable times are surfaced in the UI and counted; a zero measured height retains the last good layout; `ResizeObserver` absence is feature-detected, logged and compensated; the observer callback cannot die from a throw; the fallback list tells the user it is a fallback; no bare `catch {}` anywhere; every console line carries the `[wall-time-grid]` / `[useElementSize]` prefix and names the fix.

## Acceptance Criteria

- [ ] All three calendar views render on one shared time axis; the jobs board is unchanged
- [ ] A rule drawn at a given time is the **same y in every column** — verified by asserting exact equality of two columns' identically-timed blocks, **including under the `overflow` squeeze**
- [ ] An empty stretch folds to a labelled band; a fold never covers an event; the window clamps to first start / last end with no dead hours
- [ ] Long events are capped and print their duration; short events clear the legibility floor; real overlaps sit side by side with the longer event keeping its title, **including a three-event / two-lane cluster**
- [ ] A 20-event day fits with no scrolling and **no dropped or clipped event** — the `overflow` tier squeezes, it never clips
- [ ] An occurrence with an unreadable time appears in the all-day band and raises `wall_grid_unreadable_time`; nothing renders at `NaN`
- [ ] Now-line, running marker, progress fill and past-dimming all render; the now-line does not strike through any title
- [ ] **All-day band is complete on every view.** On days, **both** multi-day `spans` and single-day `singleByDate` items render — a birthday and an INSET day are still on screen after the change, asserted by test. On lanes/today, a shared item spans once, tagged "everyone". Both producers emit `WallAllDaySpan`.
- [ ] Peripherals collapse to a strip on a busy day and expand on a quiet one, with no oscillation; the today view still gets its `rail` in landscape; all four `variant` read sites handle `'strip'`
- [ ] `WallEventChip.vue` deleted with zero remaining references; `.wall-chip-time` and `.wall-nowtag` deleted with it; sub-0.75rem wall sizes go **6 -> 4** (corrected from the plan's "5 -> 3", which named the wrong set)
- [ ] **Blast radius held.** `git diff --stat` shows no behaviour change outside `src/components/wall/`, `src/pages/BeanieWallPage.vue`, and the additive exports. Specifically: `useCalendarNavigation.ts` shows a comment-only diff; `emitPolicy.ts`, `ExpandableText.vue`, `CalendarCommandBar.vue`, `DayTimeline.vue`, `DailyCalendarView.vue`, `WeeklyCalendarView.vue` untouched; `addHourToTime` and `formatTime12` untouched.
- [ ] **Revertable in one command.** `git revert <commit 2>` removes the feature and leaves the additive primitives and their tests in place, green.
- [ ] **The search is data where it can be, and honest where it cannot.** `LADDER` is an exported frozen 20-rung array asserted directly by the precedence test; the adaptive budget retry matches the prototype's `budget -= max(4, over)` / `0.55` floor; `MAX_ATTEMPTS === LADDER.length * BUDGET_RETRIES` (100) is asserted; no nested loop deeper than two levels and no `better()` comparator
- [ ] **`WallTimeGrid.vue` holds no derivable logic.** `<script setup>` <= ~300 lines
- [ ] `useElementSize` is the only `new ResizeObserver` **added** (`rg 'new ResizeObserver' src/` returns exactly three)
- [ ] Every new string routed through `uiStrings.ts` with `en` + `beanie`; no new `text-[Xpx]`, no `font-size: Xpx`, no new rem size below `0.75rem`
- [ ] `npm run type-check`, `npm run lint`, `npm run lint:css`, `npm run test`, `npm run build` all clean; E2E green — **and the same gates pass on commit 1 alone**
- [ ] Diagnostic logging verified: events fire with the stated `surface`/`context`, tier and slow events fire through `createChangeGate`, no new context key
- [ ] Follow-ups F1-F4 written into the code at both ends and into the PR description
- [ ] Screenshots taken of all three views in both orientations, **looked at**, any layout defect fixed, and portrait type overrides added only where the images justify one

## Testing Plan

1. **Unit — `wallTimeGrid.test.ts`.** One test per rule, each written so the right and wrong answers are _different values_ (`docs/lessons.md` rule 4). Most target a **named sub-function directly**:
   - window clamps to first/last, not to midnight
   - a short gap does **not** fold; a long one does, and its label is the resume time
   - **regression:** the minimum-block floor does not close a gap that should fold (a 15-minute event before a 100-minute gap at week scale)
   - **regression:** the fold threshold is stable — a fixture that produced five folds under the iterative rule produces exactly one
   - **regression:** a real overlap does not displace a later block (assert `yFor` equality of two columns' 18:30 blocks when only one column has a 16:00-18:00 collision)
   - **regression:** a floor-induced collision _does_ stack, and by no more than the floor
   - **regression:** a three-event cluster packing into two lanes takes its 0.62/0.38 weights from the lane occupants, not the first two events in cluster order
   - **regression:** ladder precedence — assert directly on the exported `LADDER` that `minBlock` varies before `gapMinutes`, that it has 20 entries, and that `MAX_ATTEMPTS === LADDER.length * BUDGET_RETRIES`
   - the budget retry is adaptive — a fixture overflowing by 40px is re-laid at a budget reduced by 40 (not by a fixed step), and abandons the rung at `availableHeight * 0.55`
   - the search early-exits — a fixture fitting at `LADDER[0]` reports `attempts === 1`
   - the search is bounded — a pathological fixture reports `attempts <= 100` and still returns
   - the `overflow` tier never clips — every input block is present, `total <= availableHeight`, and two identically-timed blocks in different columns still share a `top`
   - an occurrence with `startTime: 'abc'`, `'25:00'` or `''` lands in `rejected`, never in `columns`, and no output number is `NaN`
   - cap applies, `capped` is set, and a capped block still splits its column with the event nested inside it
   - a 20-event day never exceeds the budget; no block is dropped
   - zero events, one instantaneous event, an all-day-only day, and `availableHeight: 0` all return without throwing
   - determinism: identical input yields identical output
   - `clusterOverlapping`: disjoint, touching, nested, identical, unsorted input, empty
2. **Unit — `date.ts` / `wallActivities.ts` additions.**
   - `minutesOfDay` returns `null` (not `NaN`, not `0`) for `''`, `'abc'`, `'25:00'`, `'12:99'`, `'7:30:00'`, `undefined`; correct integers for `'00:00'`, `'07:30'`, `'23:59'`
   - `weekdayShort` / `dayOfMonth` match the strings the two views produce today
   - `activitySpanMinutes` applies the assumed duration only when `endTime` is absent, and returns `null` for all-day
   - **`wallDayAllDay` emits an entry for every single-day all-day item in `singleByDate` as well as every multi-day `span`** — the explicit guard against the §4a regression; a fixture with one 3-day span and two single-day items expects three results
   - `wallSharedAllDay` flags `everyone` only when the item lands in _every_ visible member column, and agrees with `belongsInMemberColumn`
   - `wallPeripheralVariant` downgrades `rail` to `strip` but never promotes `rail` to `band`
3. **Unit — `useElementSize.test.ts`.** Observer absent -> one `warn` + a measured fallback; a throwing callback does not kill the observer; `measure()` is idempotent; disconnects on unmount.
4. **Component — `WallTimeGrid.test.ts` / `WallTimeBlock.test.ts`.** Fold label renders the resume time; the now-line is behind the blocks in DOM order; a shared all-day item renders once, not per column; a single-day all-day item renders in the band; densities switch at the stated widths; `past`/`running` classes apply; a thrown layout renders the static list **with the `wall.grid.fallback` line visible** and calls `reportError`; a measured height of 0 retains the previous layout. (Every `src/components/mealplan/` component shipped last session with **no** test at all — this is the gap being closed deliberately, not repeated.)
5. **Regression guard on the untouched files.** Run the existing planner suites (`DayTimeline`, `DailyCalendarView`, `WeeklyCalendarView`, `ExpandableText`, `CalendarCommandBar`, `allDaySpans`, `emitPolicy`) unchanged and confirm they pass **without edits**. If any needs a change, the blast-radius rule has been breached — stop and reconsider rather than editing the test.
6. **Manual, on the running app.** Enable `beanieWall`, walk all three views in both orientations at tablet width, with: a quiet day, a busy day, a day with a genuine collision, an empty day, an all-day-only day, **a day whose only all-day item is single-day (the §4a regression, checked by eye as well as by test)**, a 20-event day, and across the midnight rollover. **Then turn the flag off and confirm the planner is unchanged.**
7. **Screenshots, and actually look at them.** Every UI change after the code review last session shipped with zero visual verification, and Greg found five defects by looking that four `/code-review max` passes did not. Capture all three views × both orientations, review each image, and use them to decide which portrait type overrides §7 actually needs.
8. **`/code-review max`** over the whole implementation, then fix everything it finds.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted from the approved prototype — pure layout module + one grid renderer + one block component, three views made thin, five prototype-earned defects recorded as caveats with matching regression tests.
- **Pass 2 (DRY + error handling)**: Verified every reuse claim against the codebase. Replaced three would-be re-implementations with existing code (`computeAllDaySpans`, `clusterOverlapping`, `createChangeGate`) and lifted the twice-hand-rolled `ResizeObserver` into `useElementSize`. Closed three silent failures: `NaN`-poisoned layout, an exhausted ladder clipping events, and an unlabelled fallback. Corrected the ladder nesting, the 2-lane weight rule and the `peripheralVariant` signature that would have broken the today view's rail.
- **Pass 3 (Sustainability)**: Introduced the **blast-radius rule** and applied it to reverse three pass-2 decisions that would have put a flag-off feature's refactors in front of 100% of families. Corrected two factual errors that motivated those refactors: `groupOverlapping` has **three** consumers, and `date.ts`'s cited lines are `addHourToTime`/`formatTime12`, not parsers — the convergence would have made a malformed-time activity vanish from the live planner. Restructured `layoutTimeGrid`'s search, pulled the "everyone" rule out of the views, set a complexity budget for `WallTimeGrid.vue`, split delivery into three revertable commits, recorded four named follow-ups.
- **Pass 4 (Fresh-eyes sweep)**: Re-verified every factual claim and found four errors, one a functional regression. Corrected: `belongsInMemberColumn` is in `assignees.ts:83`; `wall.card.more` loses two call sites and keeps `WallChoreBoard`/`WallPeripheralCards`, not `WallTodayView`; `WallLanesView` does not re-expand recurrences per call; `date.ts`'s lines are 497/588. **Found the regression:** feeding the grid only `computeAllDaySpans().spans` drops every single-day all-day item from the days view — §4a now specifies an adapter over `spans` **and** `singleByDate`. Corrected the algorithm restructure: pass 3's fully-frozen `LADDER` was not the approved search (the budget step is adaptive), restated the attempt ceiling as 100, restored the `+1`px epsilon, dropped the invented `better()` comparator. Cut scope the feature does not need: `createIntervalGate` + the `emitPolicy.ts` edit, `timeSpans.ts` + its test, the parity test, the `addHourToTime`/`formatTime12` snapshot pins, and seven speculative portrait overrides.

## Prompt Log

> **No GitHub issue created.** This plan was approved for direct implementation.

<details>
<summary>Full prompt history</summary>

### Initial prompt (2026-09-03)

> before moving to #84 i wanted to propose to see how the wall mode would look with a time grid. using /frontend-design:frontend-design to propose the design, can we see how a time grid would look? as you know we have 3 views - on some i think there is plenty of space (for example, on the today view) to show items in a time grid, while on other views, we have to be clever about how we conserve space and i'm open to any ideas you have (i.e. onyl showing as much time grid as we need to show the earliest and latest events, adding an element to scroll from morning to afternoon/evening, etc - or anything else appropriate). also please look at skylight and other competitors to see how they manage putting items o na time grid when there is limited space. scrolling abviously should be avoided where possible, but i'm ok to look at is as an option, or something similar.
>
> can you pls propose how the wall mode screens might look with a clear and easy to see time grid so that items are easy to see and clearly laid out in relation to time. ask me anhy questions as needed

### Design decisions (answered via AskUserQuestion)

- **Time axis** — "Concertina (recommended)": events keep true proportional height; any empty stretch of 90+ minutes folds into a labelled band.
- **Grid scope** — "All three (recommended)": week, bean lanes and today all share one time axis.
- **Peripherals** — "Collapse when the grid needs it (recommended)": the band shrinks to a slim summary strip on a busy day.

### Follow-up (2026-09-03)

> let's try the time grid in real life implementation to see how it works. i'm ok to cap long events if that is your recommendation. please go ahead to plan via /beanies-plan. once done go ahead with implementation, and once implementation is compelte run a /code-review max against the full implementation to ensure everythign works as designed and the style does not introduce any display issues or bugs. take screenshots and view those screenshots to ensure everything is displayed and laid out correctly in an easy to see and intuitive way. fix any issues found.

</details>
