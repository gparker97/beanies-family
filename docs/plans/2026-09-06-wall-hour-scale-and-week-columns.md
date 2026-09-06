# Plan: Beanie wall — fill the vertical space, and stop squeezing the week

> Date: 2026-09-06
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-09-06-wall-hour-scale-and-week-columns.md`
> Mockup: `docs/mockups/wall-week-columns-2026-09-06.html`
> Predecessor: `docs/plans/2026-09-06-wall-navigation-and-density.md`

> **No GitHub issue created.** Approved for direct implementation. The prompt history is at
> the foot of this file.

## User Story

As a family with a beanie wall in the kitchen, I want the week to be readable from across the
room and the day to use the screen it is hung on, so that a bigger display shows me more
rather than the same thing with more empty space under it.

## Context

The wall's navigation and density work shipped on 2026-09-06. greg then tested it on real
devices and found two things wrong, one of which is a change I shipped that does not do what
its changelog entry claimed.

**The vertical space is still wasted.** greg: _"in the normal day case, on a device with more
vertical space, the events still end about halfway down the screen and there is a lot of
wasted space."_ Measured baseline, an ordinary three-event day:

| plot | scale | tier   | block heights | content bottom | unused           |
| ---- | ----- | ------ | ------------- | -------------- | ---------------- |
| 480  | 0.8   | gentle | 48 / 36 / 48  | 272px          | 208px (43%)      |
| 720  | 0.8   | gentle | 48 / 36 / 48  | 272px          | 448px (62%)      |
| 1080 | 0.8   | gentle | 48 / 36 / 48  | 272px          | 808px (75%)      |
| 1440 | 0.8   | gentle | 48 / 36 / 48  | 272px          | **1168px (81%)** |

Identical at every height. The responsive `MAX_BLOCK_PX` cap that shipped only binds on events
_already over it_, so it changed nothing for the ordinary case.

The predecessor plan predicted this and named the next lever: _"If dead space persists after
this change, a responsive lift to `NATURAL_PX_PER_MIN` is a **separate, later** lever; do not
do both at once."_ This is that lever, and this is that separate plan.

**The week view squeezes rather than adapts.** greg: _"the goal for the weekly screen was not
to squeeze all 7 days into one horizontal row while also squeezing the cards to the right
side — my intention was for the number of vertical day columns to be reduced as needed, so
that weekly in landscape looks similar to weekday in portrait, with 3 or 4 vertical day
columns, and the rest of the days below."_

Measured baseline, a realistic week (most days ordinary, one 06:30 start, one 20:30 finish),
at one fixed plot height:

| columns | time window   | scale   | tier        | smallest block |
| ------- | ------------- | ------- | ----------- | -------------- |
| 7       | 960 min (16h) | **0.5** | **floored** | 36px           |
| 5       | 720 min (12h) | 0.8     | gentle      | 48px           |
| 4       | 720 min (12h) | 0.8     | gentle      | 48px           |
| 3       | 660 min (11h) | 0.8     | gentle      | 48px           |

The time window is the **union across every visible day**, so two outlier days tax every other
day on screen. At seven columns the hour is cut to 0.5 — a 40% shorter hour across the whole
week, caused by two days. **Five columns already recovers it fully**, which is worth recording:
dropping to three or four is about column _width_, not about compression.

**These two changes are planned together because each masks the other.** The column change
narrows the window, reduces compression and makes blocks taller — which could be mistaken for
the hour change working. The hour change fills height — which could be mistaken for the column
change helping. Validated together against the tables above, they can be told apart.

## Requirements

1. **The grid's hour scales with the viewport.** A taller plot gets a taller hour, so an
   ordinary day fills a large screen instead of ending a fifth of the way down it.
2. **It responds to the viewport and never to the content.** A quiet day still looks quiet.
3. **The hour does not change at or below the reference plot height**, so every device tested
   so far renders its _vertical_ layout byte-for-byte as it does today. Scoped deliberately to
   the hour: requirement 4 changes column counts at every width, and that is intended.
4. **The week view's column count comes from readable width**, capped at seven and floored at
   three, with the remainder in the existing rest-of-week strip — in both orientations.
5. **The rail takes its width first**, and the column count absorbs what is left. The
   days-specific rail threshold is deleted, not adjusted.
6. **The navigation arrows move to the ends of the date row**, beside the dates they move — _in
   the view that has a date row_. The views that do not keep them in the header.
7. **A day the wall is not already drawing in full re-anchors the grid to that day.** This is
   the only re-anchoring gesture.
8. **A day the wall IS already drawing opens the today view anchored on that day**, with a
   named back button to the view it came from. The day sheet it replaces is deleted, not left
   reachable from nowhere.

## Important Notes & Caveats

- ⚠️ **The distinction that makes requirement 1 safe is viewport-derived vs content-derived.**
  `NATURAL_PX_PER_MIN`'s docblock records why stretching was removed: _"The grid used to divide
  the whole available height between the day's live minutes, which meant a quiet day STRETCHED
  to fill the screen: two events and one of them half a wall."_ That failure was
  content-derived. A zoom factor read from the plot height is not: two different days on the
  same screen get the same zoom, so the invariant survives, now qualified by "at a given screen
  size". Say this in the code, next to the change.
- ⚠️ **The fold budget is in absolute pixels and must scale with the hour, or requirement 1 is
  not met.** `MIN_FOLD_PX` 44, `MAX_FOLD_PX` 110, `FOLD_PX_PER_MIN` 0.09 and `MAX_GAP_PX` 74
  were tuned for a ~720px plot. On a quiet day the folds are **most of the content height**
  (118px of the ordinary day's 258px). Scaling only `pxPerMin`:
  - leaves a 1440px plot at ~390px of content — still 73% empty, the same complaint a fourth
    time;
  - and **starts `MAX_GAP_PX` binding when it does not bind today.** `foldThresholdMinutes`
    returns `max(20, min(gapMinutes, MAX_GAP_PX / pxPerMin))`. At rung 0 that is
    `min(90, 74/0.8 = 92.5)` = **90** — the rung's own gap step wins, and 92.5 never reaches
    the caller. Zoom only `pxPerMin` and the pixel term falls to `74/1.6 = 46.25` at z=2, which
    _does_ bind, so a tall screen would fold gaps a short screen draws. **Zooming `MAX_GAP_PX`
    is what keeps it inert**, which is the honest reason it must scale.
- ⚠️ **`MIN_BLOCK_STEPS` must NOT scale.** The block floor is a legibility minimum in real
  pixels — 27px of type is 27px of type on any glass.
- ⚠️ **`settle`'s `+4` fires on EVERY fold, always, and does not zoom.** `findFolds` starts each
  span at `cursor`, the end of a preceding busy run, so a fold's `startMinutes` always coincides
  with some block's end; `settle` then takes `max(want, max(bottoms) + 4)` and `max(bottoms) >=
want` by construction. Consequences: `total` is `gridBottom + 4 × folds.length`, and **the ×z
  affine property is exact only for a zero-fold fixture.**
- ⚠️ **`attempt` references `rung.scale` in FOUR places** — the threshold, the `yFor`
  `buildScale`, the `gridBottom` `buildScale`, and the returned `scale`. **All four become
  `pxPerMin`.** Missing the `gridBottom` one under-reports `total`, so the pre-pass accepts a
  layout whose axis extends past the budget and the `overflow: hidden` plot silently clips the
  bottom of the day. Implement against `grep -c 'rung\.scale'` inside `attempt` being 0, not
  against an enumeration.
- ⚠️ **`layoutTimeGrid` always enters the ladder at index 0** and `squeeze()` only shrinks.
  There is no upward direction in the module. That is why a tall screen changes nothing today.
- ⚠️ **`layoutTimeGrid`'s empty-day branch uses `SCALE_STEPS[0]` directly** (`:825`). Any design
  that changes what `SCALE_STEPS[0]` means silently changes what an empty day renders at.
- ⚠️ **Do not extend `SCALE_STEPS` and move the search's entry index.** It drags three avoidable
  hazards: `LADDER` grows 120→200 and the frozen-precedence assertions must be rewritten;
  `finish()`'s `rung.scale < SCALE_STEPS[0]` starts reporting `floored` for gentle days on every
  screen but the largest, inverting the field signal this change is measured by; and
  `SCALE_STEPS.indexOf(scale)` returning `-1` indexes `LADDER[-20]!` — a `TypeError` inside the
  layout, caught by the outcome watcher, so the wall degrades to the static-list fallback.
- ⚠️ **The right-arrow gutter must come out of the plot as well as the date row.**
  `WallDaysView`'s header markup is commented _"day headers, on the same column track as the
  plot below"_. Reserving width on the date row only makes every header sit off its column.
- ⚠️ **`lanes` and `today` also have `stepUnit` and are also navigated.** Moving the arrows into
  `WallDaysView` alone removes navigation from two of the four views.
- ⚠️ **`setAnchor` returns `false` at the range boundary and still clamps.** A drill-in that
  switches view on a refused anchor opens the today view on a _different day than the one
  tapped_. Switch only on `true`. Do not toast — _"a boundary is silent"_.
- ✅ **`weekDays` starts AT the anchor**, so when the wall is anchored to today — its default and
  resting state — **today is always column 0** and can never fall into the collapsed strip.
  Reducing the column count therefore cannot hide the now-line. This is what makes requirement 4
  safe, and it is not written down anywhere yet.
- ⚠️ **The rest-of-week strip renders in landscape for the first time.** Its markup says
  "portrait only" and `rest` is currently `[]` in landscape. Its styled classes are
  `.wall-root :deep(...)`, **not** `.wall-portrait`-scoped, so it carries over intact — update
  the comment. It is `shrink-0` and outside the plot, so it takes ~48px off the plot height in
  landscape, which can step a borderline device down one zoom but **cannot oscillate**: its
  height depends on `rest.length`, which depends on viewport _width_ only.
- ⚠️ **The days view's stated purpose is weakened by requirement 4** and that is a deliberate
  trade greg accepted after device testing: _"a rule drawn at 07:30 is ONE line across the whole
  week."_ Four of seven means the crunch is visible across four days with the rest as pips.
- ⚠️ **`busiest` is `Math.max` over `visible`, not `weekDays`.** Fewer columns can lower it,
  which feeds `wallPeripheralVariant` and can flip the peripheral variant. Correct behaviour;
  note it so it is not chased as a regression.
- ⚠️ **`wallLayout.ts` has no test file.** `railFits` is currently unverified.
- ⚠️ **`WallTimeGrid.vue` is at its ~300-line budget with zero headroom.** This plan adds only a
  telemetry field and a gate-key term.
- ⚠️ **jsdom has no layout engine.** Column arithmetic is a pure function and fully testable;
  the rendering is confirmable only on hardware.
- Dark mode authored in the same change. Never `:global(.dark)`.
- Telemetry reuses `action` / `kind` / `stage` / `count`. **No new `ALLOWED_CONTEXT_KEYS`.**
- The wall has no E2E coverage.

## Assumptions

1. `REFERENCE_PLOT_PX = 720` is the plot the module's absolute pixels are tuned for.
   `CAP_REFERENCE_HEIGHT_PX` is already 720 for the same reason; the two become one constant.
2. ~211px is the right target column width — `WallTimeBlock`'s `WIDE_PX` is 210 and its density
   test is `width > WIDE_PX`.
3. A three-column floor is low enough to be useful and high enough to stay a _week_ view.
4. greg's device set (1024×768 through 1440-class) is representative. ⚠️ At 1920 the rule yields
   six columns, close to today's seven — the columns _are_ wider, but a very large display
   converges back toward the layout greg objected to. The lever is `TARGET_COLUMN_PX`.

## Approach

**Five commits, each independently revertible.** The measurement is taken between A/C and B so
the two effects can be attributed separately.

| Commit | Contents                                                                                              |
| ------ | ----------------------------------------------------------------------------------------------------- |
| A      | Req 4–5 — column count from width, rail threshold deleted, shared constants unified, pinned baselines |
| C      | Req 6 — one `WallNavArrow`, placed by the registry, occupying the gutter A reserved                   |
| B      | Req 1–3 — the hour and the fold budget zoom with the viewport                                         |
| D1     | Req 7–8's gestures — strip re-anchors, headers drill in, `selectView` guards                          |
| D2     | The day sheet deleted, the today view's back control                                                  |

> **A before C.** C-first would squeeze seven columns through the new gutter — at 1280 that is
> `(1280 − 430 − 56) / 7 = 113px` per column, below `MIN_READABLE_COLUMN_PX`, a real crowding
> regression sitting in the bisect window. A-first costs one commit of 56px unused right margin,
> which is invisible because the count has already dropped. A defines `ARROW_GUTTER_PX` with the
> comment "reserved here, occupied in C".

> **D is split** because D2 deletes a renderer and a union member — the only irreversible step.

### A. The column count comes from readable width

Unify the density thresholds first (`wallLayout.ts` quotes 95 and 210 in prose three times while
`WallTimeBlock.vue` owns the constants), then one private width helper and one public function:

```ts
export const BLOCK_SLIVER_PX = 95; // below this a block is only a colour
export const BLOCK_FULL_PX = 210; // above this: title, time, faces
const MIN_READABLE_COLUMN_PX = 120; // lanes: a column that keeps a TITLE
const TARGET_COLUMN_PX = BLOCK_FULL_PX + 1; // days: a column sized for FULL density

/** The ONE place the chrome list lives. Both views read it, then diverge. */
function chromeFreeWidth(viewportPx: number, withRail: boolean): number {
  const rail = withRail ? RAIL_WIDTH_PX + RAIL_GAP_PX : 0;
  return viewportPx - PAGE_PADDING_PX - AXIS_WIDTH_PX - rail;
}

export const ARROW_GUTTER_PX = 56; // reserved here, occupied in commit C
export const MIN_DAY_COLUMNS = 3;
export const MAX_DAY_COLUMNS = 7;

/** Unclamped on purpose — daysLayoutFor needs the raw count twice. Total: NaN -> 0. */
function dayColumnsThatFit(viewportPx: number, withRail: boolean): number {
  const content = chromeFreeWidth(viewportPx, withRail) - ARROW_GUTTER_PX;
  if (!Number.isFinite(content)) return 0;
  return Math.max(0, Math.floor(content / TARGET_COLUMN_PX));
}

export function railFits(viewportPx: number, columns: number): boolean {
  // LANES ONLY now
  return chromeFreeWidth(viewportPx, true) >= columns * MIN_READABLE_COLUMN_PX;
}

export function daysLayoutFor(viewportPx: number, portrait: boolean) {
  const rail = !portrait && dayColumnsThatFit(viewportPx, true) >= MIN_DAY_COLUMNS;
  const fit = dayColumnsThatFit(viewportPx, rail);
  return { rail, columns: Math.min(MAX_DAY_COLUMNS, Math.max(MIN_DAY_COLUMNS, fit)) };
}
```

⚠️ `railFits`'s docblock currently claims _"ONE rule for both views"_ — commit A makes that
false and it must be rewritten in the same commit. Days wants a column sized for full density
(211); lanes wants one that keeps a title (120). One number cannot mean both.

**What it produces** (`chromeFreeWidth(v, true) = v − 430`; `false = v − 118`; both −56):

| viewport          | with rail    | decision                                             |
| ----------------- | ------------ | ---------------------------------------------------- |
| 768 portrait      | —            | band, **3** (floored)                                |
| 1024 landscape    | 538/211 = 2  | band, **4**                                          |
| **1024 portrait** | —            | band, **4** — ⚠️ today every portrait device shows 3 |
| 1280              | 794/211 = 3  | **rail + 3**                                         |
| 1440              | 954/211 = 4  | **rail + 4**                                         |
| 1920              | 1434/211 = 6 | **rail + 6**                                         |
| 2560              | 2074/211 = 9 | rail + **7** (capped)                                |

⚠️ **1280 gives rail + 3, not the "five at 1280" in the mockup** — that figure was computed
without the rail, and requirement 5 says the rail goes first. Inside greg's stated "3 or 4"; one
line to flip (`MIN_DAY_COLUMNS + 1` as the rail floor) if he prefers 5-and-a-band.

⚠️ **1024 portrait gives 4 where today it always gives 3** — the portrait branch is a hard
`slice(0, 3)` regardless of width. Visible change, absent from the mockup.

`WallDaysView` takes `dayColumns` and slices; the `portrait ?` ternary goes from both computeds.
The strip markup needs no change — it is already `v-if="rest.length"`; only `rest`'s derivation
was portrait-gated. Update its "portrait only" comment.

**Pinned baselines land here**: literal assertions for the ordinary fixture at 480/720/1080/1440
(`scale === 0.8`, `total ≈ 258.2`, heights `[48, 36, 48]`), relaxed to `>=` in commit B. The diff
on that file is commit B's vertical effect in numbers, in one place.

### C. One arrow component, placed by the registry

Extract `WallNavArrow.vue` — the existing markup moved verbatim, `props: { direction, enabled }`,
one `step` emit, the same `.wall-nav-arrow` class and `planner.prevPeriod`/`nextPeriod` labels.
`BeanieWallPage`'s `:deep(.wall-nav-arrow)` rules already match child descendants, so **no new
CSS, no new type-scale entry, no new string**.

`wallViews.ts` gains `arrowsInView: boolean` beside `stepUnit` — a boolean, not a
`'row'|'header'|null` tri-state, which would duplicate `stepUnit: null` and admit the incoherent
`{ stepUnit: null, arrows: 'header' }`. `days: true`, others `false`. The page renders header
arrows when `stepUnit && !arrowsInView`; the period label and Today chip stay unconditional.

**Alignment**: `WallDaysView` wraps date row, grid and strip in one relative container with
`paddingRight: ARROW_GUTTER_PX`, so every track loses the same width and headers stay on their
columns. Arrows absolutely positioned — back over the axis gutter, forward in the reserved one.

### B. The hour and the fold budget zoom with the viewport

```ts
export const REFERENCE_PLOT_PX = 720;
const CAP_REFERENCE_HEIGHT_PX = REFERENCE_PLOT_PX;

/**
 * ⭐ How much bigger than the reference this plot can draw the whole grid.
 * VIEWPORT-derived, never CONTENT-derived — that distinction is the whole safety.
 *
 * ─── EVERY absolute pixel in this module, with a verdict ───
 *   ZOOMS:  rung.scale · MIN_FOLD_PX 44 · MAX_FOLD_PX 110 · FOLD_PX_PER_MIN 0.09
 *           MAX_GAP_PX 74 (zoomed to keep it INERT — see the caveat)
 *   DOES NOT ZOOM: MIN_BLOCK_STEPS · NUDGE_PX 3 · settle's +4 ·
 *           MIN_FOLDABLE_MINUTES 20 · MAX_BLOCK_PX / CEILING / defaultMaxBlock
 */
export const ZOOM_STEPS = [2, 1.5, 1.25] as const;

export function zoomCandidates(availableHeight: number): readonly number[] {
  if (!Number.isFinite(availableHeight) || availableHeight <= 0) return [];
  return ZOOM_STEPS.filter((z) => z * REFERENCE_PLOT_PX <= availableHeight);
}
```

`attempt(input, rung, maxBlock, zoom)` — `zoom` **required** on this module-private function so
the compiler names the call site; the exported helpers (`foldHeightFor`, `foldThresholdMinutes`,
`findFolds`) take `zoom = 1` so every existing test keeps working. All four `rung.scale` sites
become `pxPerMin = rung.scale * zoom`.

A named `tryZoomedFit(input, height, maxBlock)` runs before the ladder, biggest zoom first,
**gently only** — one question per zoom, `LADDER[0]` only. A no falls through to the existing
search unchanged, which is why this cannot make anything worse: the fallback _is_ today's path.

Three more lines: `MAX_ATTEMPTS = LADDER.length + ZOOM_STEPS.length` (123); the empty-day branch
becomes `SCALE_STEPS[0]! * (zoomCandidates(height)[0] ?? 1)`; and `GridLayout.scale`'s docblock.

**`SCALE_STEPS`, `LADDER`, `finish()`, `squeeze()`, `buildScale`, `settle` are untouched** — so
the frozen-precedence assertions stand (except the `MAX_ATTEMPTS` pair) and **`wall_grid_tier`
cannot invert**.

**Worked numbers.** 09:00–10:00, 13:00–13:45, 17:00–18:00. Window 540 min, two foldable gaps.

| plot | zoom | hour | fold bands    | threshold  | blocks   | grid bottom | `total`   | % of plot |
| ---- | ---- | ---- | ------------- | ---------- | -------- | ----------- | --------- | --------- |
| 480  | 1    | 0.8  | 58.4 + 59.8   | **90 min** | 48/36/48 | 250.2       | **258.2** | 54%       |
| 720  | 1    | 0.8  | 58.4 + 59.8   | **90 min** | 48/36/48 | 250.2       | **258.2** | 36%       |
| 899  | 1    | 0.8  | 58.4 + 59.8   | **90 min** | 48/36/48 | 250.2       | **258.2** | 29%       |
| 900  | 1.25 | 1.0  | 73.0 + 74.7   | **90 min** | 60/45/60 | 312.7       | **320.7** | 36%       |
| 1080 | 1.5  | 1.2  | 87.6 + 89.6   | **90 min** | 72/54/72 | 375.2       | **383.2** | 35%       |
| 1440 | 2    | 1.6  | 116.8 + 119.5 | **90 min** | 96/72/96 | 500.3       | **508.3** | 35%       |

`total` is `gridBottom + 8` at every zoom — the constant delta is the clearest statement that
`settle`'s +4 does not zoom.

⚠️ **1440 goes from 258px to 508px and stays 65% empty.** That is requirement 2, not a
shortfall. Filling it would be content-derived stretching. The lever is `REFERENCE_PLOT_PX`.

⚠️ **`defaultMaxBlock` is deliberately not zoomed**, so the cap binds at 237 min on a 720px plot
but 200 min on a 1440px one — a 3½-hour event is capped at 1440 where it was not before. Nothing
is silent (`capped` blocks print their range) and the soft ramp keeps ordering. Confirm on
hardware; the fix, if needed, is `MAX_BLOCK_CEILING_PX` alone.

### D1. The two tap gestures

⚠️ **The rule belongs to the AFFORDANCE, not the view** — stating it per-view is what made the
registry's docblock wrong:

> **A day the wall is not already drawing in full — a strip pip or a week chip — RE-ANCHORS.
> A day the wall IS already drawing — a column or date header — DRILLS IN to the today view.**

| view  | affordance    | behaviour | change                   |
| ----- | ------------- | --------- | ------------------------ |
| days  | column header | drill in  | **new** (was re-anchor)  |
| days  | strip pip     | re-anchor | unchanged (`focusDay`)   |
| today | week chip     | re-anchor | unchanged (`focusDay`)   |
| lanes | date header   | drill in  | **new** (was open sheet) |

The today view needs no gesture change at all. **No third emit** — reuse `openDay`:

```ts
function onOpenDay(ymd: string) {
  if (!anchor.setAnchor(ymd, 'day_tap')) return logAnchorChange('range_limit');
  logAnchorChange('day_tap');
  selectView('today');
}
```

⚠️ In the lanes view the tapped day _is_ `anchorYmd`, so `setAnchor` is a no-op that returns
`true` and the event records an anchor change that did not happen. Accepted — the gesture is
still a navigation event worth counting — and said in a comment so it is not read as a bug.

`selectView` gains `id !== activeView.value` so re-tapping the active tab does not write
`lastCalendarView = activeView`.

### D2. The day sheet deleted, and a way back

**The back button — greg's decision, overriding the recommendation below.** The today view shows
`‹ days`, reusing `lastCalendarView` + `backLabel` + the existing `@back` wiring. **No new state,
no new string, no new handler.**

⚠️ **The write-side guard is not sufficient.** A second path reaches a self-pointing button:

```
today → jobs :  activeView 'today' ≠ 'jobs' → lastCalendarView = 'today'
jobs  → back :  activeView IS 'jobs' → write SKIPPED → lastCalendarView stays 'today'
result:  activeView === 'today' AND lastCalendarView === 'today'  → "‹ today" → itself
```

The fix is **read-side**, and it also removes the need to show the button unconditionally:

```ts
const canGoBack = computed(() => lastCalendarView.value !== activeView.value);
```

> _The recommendation this overrides: the view switcher is always visible and one tap away, and
> the jobs board's back exists because that board is a takeover with no switcher beside it. greg
> has the device in hand and judged an explicit way back worth the second affordance._

`{ kind: 'day' }` becomes reachable from nowhere, so it is **deleted**: `dayEvents`, the `'day'`
case in `sheetTitle`, the template block, and the union member. ✅ `wall.day.nothingOn` **stays**
— `WallTimeGrid.vue` and `WallLanesView.vue` both use it.

**Three docblocks go false in D and move with it**: `wallViews.ts`'s day-tap paragraph
(**removed**, not rewritten — the rule lives once on `onOpenDay`); `WallDaysView.vue:58`
("`openDay` is deliberately NOT declared") which is now backwards; and `WallTodayView.vue:44`'s
reference to the deleted sheet.

## Files Affected

**Modified** — `src/utils/wallTimeGrid.ts`; `src/components/wall/wallLayout.ts`;
`src/components/wall/WallTimeBlock.vue`; `src/pages/BeanieWallPage.vue`;
`src/components/wall/WallDaysView.vue`; `src/components/wall/WallTodayView.vue`;
`src/components/wall/WallLanesView.vue`; `src/components/wall/WallViewShell.vue`;
`src/components/wall/wallViews.ts`; `src/components/wall/WallSheet.vue`; `src/types/wall.ts`;
`src/services/translation/uiStrings.ts` (one comment); `src/utils/__tests__/wallTimeGrid.test.ts`;
`src/components/wall/WallTimeGrid.vue`

**Created** — `src/components/wall/WallNavArrow.vue`;
`src/components/wall/__tests__/wallLayout.test.ts` (also `railFits`'s first test)

**Deleted** — `DAYS_RAIL_MIN_VIEWPORT_PX` (its 1270 derivation preserved as a pinned test);
`WallSheet`'s day branch and the `{ kind: 'day' }` target

## Observability Coverage

Surfaces: existing **`beanie-wall`** and **`wall-time-grid`**. **No new context keys.**

- **`wall_grid_tier` gains `count: Math.round(result.scale * 60)`** — pixels per hour, directly
  readable (48 today; 60/72/96 zoomed; 42/36/30/25/21 floored), all distinct. ⚠️ `tierGate`'s key
  becomes `${viewId}:${tier}:${hourPx}` using the **same** rounded integer, not the raw float —
  `0.8 * 1.5 = 1.2000000000000002`, and two roundings of one value is how a gate leaks.
- **`wall_rail_mode` gains `count` for `days` ONLY.** For lanes the same field would mean family
  size, and one field with two meanings is aggregated wrong the first time someone groups by it.
  ⚠️ The watcher must depend on the column count, or a resize that changes columns without
  changing the rail goes unreported.
- **Failure modes**: NaN/zero/negative plot height → `zoomCandidates` returns `[]`, today's path;
  NaN/zero/negative viewport → `dayColumnsThatFit` returns 0 → clamps to three columns, never a
  blank grid; a day past the range limit → `range_limit`, no view switch, no toast; a layout that
  throws → the existing outcome watcher. **No new throw sites.**
- **No `severity: 'critical'`** — display state only.

## Acceptance Criteria

- [ ] `zoomCandidates`: `[]` at 0/negative/NaN/480/720/**899**; `[1.25]` at **900**;
      `[1.5, 1.25]` at 1080; `[2, 1.5, 1.25]` at 1440
- [ ] `ZOOM_STEPS` strictly descending, every entry `> 1`
- [ ] ⭐ On the zero-fold fixture: `layout(1440).total === 2 × layout(720).total` exactly, and
      every `top` / `height` / tick scales by exactly 2
- [ ] `foldThresholdMinutes` in minutes identical at 480 and 1440, and **90** at rung 0
- [ ] Ordinary day `total` ≈ 258px at 480 and ≈ 508px at 1440, matching §B
- [ ] A quiet day at 1440 still does not fill it
- [ ] `grep -c 'rung\.scale'` inside `attempt` is **0**
- [ ] `SCALE_STEPS`, `LADDER`, `finish()` byte-identical; precedence assertions untouched except
      the `MAX_ATTEMPTS` pair; `MAX_ATTEMPTS === 123`
- [ ] Empty day renders at 0.8 at 480 and 1.6 at 1440
- [ ] `tier` unchanged in meaning: a gentle day reports `gentle` at every plot height
- [ ] `daysLayoutFor`: band+4 at 1024 landscape **and** portrait, rail+3 at 1280, rail+4 at 1440,
      rail+6 at 1920, rail+7 at 2560, 3 at 768 portrait, clamps for 0/negative/NaN
- [ ] `railFits(1270, 7)` true, `railFits(1269, 7)` false
- [ ] `DAYS_RAIL_MIN_VIEWPORT_PX` gone; `210` / `95` / `120` appear as literals in one file
- [ ] Arrows written once, 44px floor, in the days date row and the header for lanes/today,
      never for jobs
- [ ] Day headers sit exactly on the columns they label at every column count
- [ ] A strip pip or week chip re-anchors; a column or date header drills in
- [ ] A header past the range limit does not switch view and logs `range_limit`
- [ ] The today view's back control shows **only when `lastCalendarView !== activeView`**
- [ ] ⭐ today → jobs → back never leaves a back control reading "‹ today" pointing at today
- [ ] Re-tapping the active tab does not hide the back control
- [ ] `{ kind: 'day' }` gone from `WallSheetTarget`; `wall.day.nothingOn` still referenced
- [ ] `wallViews.ts` states no day-tap rule; `onOpenDay` is the only place it is stated
- [ ] `wall_grid_tier` carries `round(scale × 60)` and the gate uses the identical integer;
      `wall_rail_mode` carries columns for `days` only
- [ ] Dark mode authored; **no new uiStrings keys, no new type-scale entries** — confirm
- [ ] **No new key in `ALLOWED_CONTEXT_KEYS`**

## Testing Plan

1. **Baseline — TAKEN 2026-09-06**, recorded in Context. The harness is kept so the
   after-measurement is the identical script.
2. **Unit — `daysLayoutFor` + `railFits`** (new file; `railFits`'s first coverage). Every
   viewport row including 1024 portrait; both clamp ends; 0/negative/NaN; 1270/1269.
3. **Unit — `zoomCandidates`**, all boundaries above.
4. **Unit — the affine invariant**, on this fixture (worked by hand, satisfies all four
   conditions): **09:00–10:00, 11:00–11:50, 13:00–13:45.** Window 540–840. Gaps 60 and 70, both
   under the 90-min threshold → **no folds**, so no settle push. No block at the 36px floor.
   Longest block 60 min = 96px at z=2, well under `defaultMaxBlock(1440) = 320`. Blocks minutes
   apart → no nudge. **The last event ends off the hour**, so `windowEnd` snaps to 14:00 and
   `gridBottom > blockBottom` — the only way the test can see the `gridBottom` site. Leaving
   that site at `rung.scale` yields `total` 528 against an expected 480.
5. **Unit — pinned baselines** added in A, relaxed to `>=` in B.
6. **Unit — the untouched surface.** If any precedence assertion beyond `MAX_ATTEMPTS` needs
   editing, the implementation has diverged — stop.
7. **Unit — folds.** `foldThresholdMinutes(90, 1.6, 2) === foldThresholdMinutes(90, 0.8, 1) === 90`;
   and `(120, …) === 92.5`, the case where `MAX_GAP_PX` actually binds.
   `foldHeightFor(g, z) === z × foldHeightFor(g)`.
8. **Unit — tier** at 480 and 1440.
9. **Unit — `selectView` / `canGoBack`.** today → jobs → back leaves `canGoBack === false`;
   re-selecting the active tab leaves it `true`. The two paths that produced a self-pointing
   back button.
10. **Measurement between A/C and B** with the kept harness.
11. **Regression** after **each** commit: `npm run test:run`, `type-check`, `lint`, `stylelint`,
    `build`.
12. **Hardware — the only thing that can confirm the rendering.** 1024×768 tablet, ~1280 panel,
    largest display: column counts as tabled; headers on their columns; the strip **in landscape,
    which it has never rendered in**; arrows reachable at 44px; a date tap opens the today view
    with a working back button; a strip tap re-anchors; an ordinary day visibly fills more of the
    tall screen; no long event clipped. **Light and dark on each**, both orientations.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted from greg's device testing plus two measurements — the
  identical-block-heights result disproving the shipped cap change, and the columns-vs-window
  table explaining why fewer columns helps vertically.
- **Pass 2 (DRY + error handling)**: Found the fold-budget defect — the drafted design would have
  left 1440px 73% empty and shipped the same complaint a fourth time. Replaced the
  extended-`SCALE_STEPS` mechanism with a zoom pre-pass leaving `SCALE_STEPS`/`LADDER`/`finish()`
  untouched, deleting three of its own risk items including a `LADDER[-20]` `TypeError`. Found
  the empty-day line, the header-alignment break, that lanes and today would lose their arrows,
  and the 1280 contradiction. Unified the density constants, collapsed four arrow buttons to one
  component, avoided a third day-tap emit.
- **Pass 3 (Sustainability)**: Found that Pass 2's own snippet would silently clip the grid —
  `attempt`'s second `buildScale`, hidden behind an ellipsis. Made `zoom` required there.
  Extracted `tryZoomedFit`; gave `ZOOM_STEPS` an exhaustive constant table; simplified
  `daysLayoutFor`; replaced the registry tri-state with a boolean; restated the day-tap rule on
  the affordance and deleted the registry docblock; found the `selectView` latent bug; caught
  `railFits`'s now-false "one rule" claim; replaced the unimplementable before/after test with
  pinned baselines; required gate and payload to share one integer; added the 1024-portrait row.
- **Pass 4 (Fresh-eyes sweep)**: Re-derived every load-bearing number by hand; **three were
  wrong.** The fold threshold is **90, not 92.5** (92.5 is the unclamped pixel term) — and the
  honest framing is that `MAX_GAP_PX` is inert and zooming keeps it so. `attempt` reads
  `rung.scale` in **four** places, not two, and the snippet still hid the dangerous one.
  `settle` adds a flat +4 per fold **always** — proved from `findFolds` — so `total` is
  `gridBottom + 8` here, and Pass 3's affine conditions were **not jointly satisfiable**; a
  concrete zero-fold fixture is now specified and verified to catch the bug at 528-vs-480. Found
  a **second** self-pointing back button (today → jobs → back) that the write-side guard misses,
  and replaced the unconditional-button trade with a read-side `canGoBack`. Cut `wall_rail_mode`'s
  lanes `count`, cut `contentWidthFor` to one helper, split commit D, reversed C-before-A, and
  changed the telemetry field to pixels-per-hour.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial (device testing, 2026-09-06)

> i've just tested now, and i see that in the normal day case, on a device with more vertical
> space, the events still end about halfway down the screen and there is a lot of wasted space.
>
> at the same time, the goal for the weekly screen was not to squeeze all 7 days into one
> horizontal row while also squeezing the cards to the right side - my intention was for the
> number of vertical day columns to be reduced as needed, so that weekly in landscape looks
> similar to weekday in portrait, with 3 or 4 vertical day columns, and the rest of the days
> below. this gives each row more breathing room, and more vertical space to lay out the events.
>
> /frontend-design this is just my proposal based on testing on a few devices with differing
> screen sizes and resolutions. let me know if this makes sense or if you would propose another
> approach.

### Follow-up 1 (arrows and tap gestures)

> ok this sounds good - let's mock it quickly. the other thing i wanted to mention is that i can
> see the week/day navigation arrows are at the top of the screen with "today" in between - i
> think it would also be intuitive to have arrows at the top left and top right of the date row
> (directly next to the dates rather than above them) as this is where a person would naturally
> look to move to the next or previous week.
>
> also, it was never my intention for clicking/tapping on the top of a day column (i.e. on the
> date) to reset the view to that day. the idea was that tapping on a collapsed day (i.e. one
> further down the week which is collapsed below the date columns (like we have on the portrait
> view today) to reset the view anchored on that day.
>
> perhaps, tapping on an individual day number at the top of a column could open up the today
> view anchored to that day - if anything, i think that would be more intuitive. what are your
> thoughts?

### Follow-up 2 (back button)

> let's have the back button, and should you mockup once more including the height rules?

### Follow-up 3 (proceed)

> let's plan the two changes together so they can be validated and tested against each other

### Follow-up 4 (execution instruction)

> once complete, implement the plan, once done run a /code-review max against the implementation
> to ensure everything is implemented as per the plan and works as per the plan and expected
> design, and no bugs, side effects, or security concerns were introduced. fix any issues found.

</details>
