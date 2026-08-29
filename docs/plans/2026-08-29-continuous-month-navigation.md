# Plan: Continuous, natural month navigation — mobile stream + desktop scroll paging

> Date: 2026-08-29
> Related issues: None — direct implementation (Notion tracker #58; GitHub issue explicitly skipped)
> Plan file: `docs/plans/2026-08-29-continuous-month-navigation.md`
> Mockup: `docs/mockups/calendar-continuous-months-2026-08-29.html` (approved: variant A mobile stream + variant B1 desktop edge-resistance)

## User Story

As a parent browsing the family calendar on my phone (app or PWA) or on my computer, I want to keep scrolling to flow into the next or previous month — and swipes to land me at the sensible end of the month — so month navigation feels natural and continuous instead of stopping dead at month edges.

## Context

Month navigation stops dead at month edges on every width. On mobile (the primary target) the day-stack simply ends and the only way onward is a swipe; on desktop/tablet the horizontal swipe is awkward on a trackpad and impossible on a wheel mouse, leaving only the command-bar arrows. Continuing to scroll in the direction you are already going is the natural action on both.

A desktop-only first attempt (`useCalendarWheelPaging`, 2026-07-24) was built and rolled back: boundary-at-scroll-end detection + 140px accumulation + 400ms cooldown, gated to md+ via `useBreakpoint`, 16 unit tests green (including app-shell-shaped ones) — but it "did not work" on greg's machine and the cause was never identified. **Leading hypothesis, to be confirmed as the first implementation task:** greg tested at MOBILE width with a mouse, where the md+ gate correctly disabled the composable — the feature may have worked as coded while the test sat outside its gate. Reproducing that failure (or confirming this explanation) is Task 0, not an afterthought.

The interaction design was settled 2026-08-29 via an approved interactive mockup:

- **A · mobile stream** — the month day-stack becomes one seamless, effectively infinite vertical stream with lowercase orange month-boundary headers; the command-bar label crossfades to follow the month in view.
- **B1 · desktop edge-resistance** — at the month grid's own bottom/top edge, continued wheel/trackpad scrolling meets a gentle rubber-band stretch, then commits a one-month vertical slide; one gesture = one month; momentum tails swallowed by a cooldown.

Rejected in review: instant horizontal slide (B2), peek-and-snap (B3), any pre-turn affordance on desktop, page-turn model on mobile.

## Requirements

**Mobile (below `md` — native app, PWA, desktop at mobile width):**

1. The month day-stack renders as a seamless continuous stream: scrolling past the month's last day flows into the next month's day cards; scrolling up above the 1st flows into the previous month's.
2. A lowercase month-boundary header (e.g. "september 2026", Heritage Orange, Outfit, with a gradient rule — per mockup) marks each month's start inside the stream.
3. The command-bar month label follows the month currently in view, with a brief crossfade, staying correct even when fast scrolling crosses several boundaries.
4. Horizontal swipe still changes month, with landing behavior: swipe to NEXT month lands the view at the 1st; swipe to PREVIOUS month lands at the last day of that month.
5. The stream is bounded in the DOM: a sliding window of rendered months, extended near either end and pruned at the far end, with scroll-position compensation on prepend (no visible jump).
6. "Today" (command bar) scrolls the stream to today's card, resetting the window first when today is outside it. (The planner's only deep-link is `?activity=`, which opens a modal and never scrolls — no scroll-to-arbitrary-date plumbing is built for a caller that doesn't exist.)

**Desktop/tablet (`md`+ month grid):** 7. Continuing to scroll at the grid's OWN bottom/top edge pages to the next/previous month. Grid-edge visibility within the app's `<main>` scroller is a NECESSARY condition; the scroller-at-limit test (below) is the anti-hijack guard — the first attempt's mistake was page-bottom as the ONLY trigger, not the act of checking the scroll limit. 8. Feel per approved B1: accumulating wheel delta at the edge produces a damped rubber-band stretch (max ~24px); crossing the commit threshold (~140px of accumulated delta) triggers a one-month vertical slide; a ~400ms cooldown swallows trackpad momentum tails so one gesture = exactly one month. 9. `prefers-reduced-motion`: no stretch, no slide — instant month swap on commit.

**Both:** 10. Ordinary page scrolling never breaks: content below the calendar (connect nudge, inactive-activities) stays reachable at every width; scrolling over other page regions and while any modal is open is never hijacked. 11. Existing horizontal swipe and command-bar prev/next/today keep working unchanged (beyond the new mobile landing positions). 12. Hand-verified on greg's actual phone AND desktop browser before "done" — unit tests alone were insufficient evidence on the first attempt.

## Important Notes & Caveats

- The app's scroll container is `<main class="flex-1 overflow-auto overscroll-y-contain">` in `App.vue` (App.vue:2105), NOT the window. All boundary/visibility detection must be rooted in that element; browser scroll chaining and `overscroll-y-contain` shaped the first attempt's failure surface.
- Trackpad momentum tails emit dozens of wheel events after fingers lift — the cooldown is load-bearing, not polish.
- The one-way data-flow invariant in `usePlannerNavigation` is deliberate and documented: `referenceDate` flows page → views via props; views emit intents and NEVER mutate it. The stream must not break this. The design below keeps it: the grid emits a `month-in-view` intent; the page decides what to do with it.
- Re-anchor rule (prevents label/scroll feedback loops): **the grid re-anchors its scroll position only when `referenceDate`'s month differs from the month currently in view.** A label update caused by the user's own scrolling matches the in-view month and therefore never scrolls.
- Month stepping anchors to the 1st (`new Date(y, m±1, 1)`) — `usePlannerNavigation.stepMonth` already does this; do not reintroduce `setMonth` overflow.
- Outside-month cells are hidden on mobile (`hidden md:flex`) — the stream renders whole months only; boundary headers replace the visual role of outside-month context.
- The mobile week-separator labels ("this week" / week ranges) must keep working across the multi-month window.
- Do NOT hand-roll new animation plumbing where `useCalendarSlide`'s reduced-motion handling, easing, and re-entrancy patterns can be mirrored; the vertical slide should reuse its constants/easing style (`cubic-bezier(0.32, 0.72, 0, 1)`) for a consistent feel.
- All new user-visible text goes through `t()` (`uiStrings.ts`, `en` + `beanie`); month names come from the existing date formatters, not new strings.
- Rem-based text only; no `text-[Xpx]`.
- Each `month-in-view` → `referenceDate` set retriggers the page's `clashWindow` free/busy query; the existing debounce (FamilyPlannerPage.vue:152-159) already collapses rapid boundary crossings — do NOT add a second debounce.
- **Accepted, self-healing:** adjacent stream months carry no clash indicators until `month-in-view` advances `referenceDate` and the debounced query catches up (`clashWindow` derives from `monthGridRange(referenceDate)`). Not a defect during hand-verification, and not to be "fixed" by widening the free/busy query to the whole window.
- `logEvent` already rate-limits identical (surface, message) pairs to 50/min and `perfTiming`'s 250ms floor is enforced inside `record` itself — no extra throttling code needed around the diagnostics.
- **One scroller seam:** `closest('main')` already appears twice in CalendarGrid (lines 417/445) and this work adds three more consumers. A tiny `getAppScroller(from: Element)` utility is the single resolution point for the `<main>` scroll container — a future App.vue restructure breaks one named seam, not five silent ones.
- **Single write-path invariant for scroll position:** ALL `referenceDate`-driven repositioning and window resets flow exclusively through `anchorToDate`; no other code writes `scrollTop` or rebuilds `streamMonths`. (This turns the re-anchor rule from an emergent property into a stated invariant a review or test can hold the line on — e.g. a future `watch(referenceDate, rebuildWindow)` inside `useMonthStream` would reintroduce the feedback loop.)

## Assumptions

> **Review these before implementation.** Valid at planning time (2026-08-29).

1. `CalendarGrid.vue` (540 lines) still renders both the mobile day-stack and desktop grid from one `calendarDays` computed keyed off `referenceDate`, and emits `prev`/`next`/`selectDate`.
2. `usePlannerNavigation` still owns `referenceDate` at `FamilyPlannerPage` level with the one-way invariant.
3. `useCalendarSlide` / `useHorizontalSwipe` remain the swipe layer with reduced-motion + re-entrancy handling.
4. The `<main>` scroller in `App.vue` is still the single app scroll container on both widths.
5. The 2026-07-24 attempt's code is not in the tree (never committed); only its description in tracker #58 survives.
6. `activityStore.upcomingActivities` / `expandRecurring` can supply events for adjacent months without new store work (the grid already computes per-month cells; the stream reuses the same computation per windowed month).
7. E2E budget (ADR-007) has no room for a scroll-feel test and jsdom cannot honestly simulate wheel/scroll physics — verification is unit tests for pure logic + hand-verification for feel.

## Approach

Mockup: `docs/mockups/calendar-continuous-months-2026-08-29.html` is the design source of truth for feel and visual intent; all tokens below come from the CIG/theme skill (they already agree — the mockup was CIG-clamped).

### Task 0 — reproduce the 2026-07-24 failure (timeboxed, ~30 min)

Before building: re-create the old composable's trigger condition in a scratch branch or dev overlay and test at BOTH widths on greg's machine. Confirm (or refute) the "tested at mobile width, outside the md+ gate" hypothesis. Outcome recorded in the implementation notes; if a genuine defect surfaces (e.g. wheel events never reaching the listener through the `<main>` scroller), it directly informs Part B's listener placement.

### Part A — mobile continuous stream

**A1 · Month windowing in a NEW `CalendarMonthStream.vue`, mounted from the PAGE.** The mobile stream is its own component (`src/components/planner/CalendarMonthStream.vue`: stream template + `useMonthStream` + anchoring), mounted directly by `FamilyPlannerPage` — `v-if="activeView === 'month' && isMobile"` for the stream, `v-else-if="activeView === 'month'"` for the existing `CalendarGrid` (via the `useBreakpoint().isMobile` singleton). NOT delegated through CalendarGrid: delegation would force it to declare, forward, and re-emit ~7 existing events plus the new `month-in-view` and the `anchor` prop — a pure pass-through shim. Direct mount keeps CalendarGrid's interface byte-identical, which is the strongest "desktop path untouched" guard. CalendarGrid's mobile-only code (day-stack markup, `scrollMobileToToday`, the raw `window.matchMedia('(min-width: 768px)')` at :411) becomes dead code to DELETE, since the mobile branch leaves the component.

- Window state: `streamMonths: ref<{y,m}[]>` covering `[anchor-1 … anchor+1]`, max 5 months before pruning the far end. Each month's cells come from a pure helper `monthCells(y, m, prefetched)` living in a pure module `src/utils/monthCells.ts` (matching the `calendarWeek.ts`/`allDaySpans.ts` pattern), extracted from today's `calendarDays` computed (CalendarGrid.vue:102-283) — the desktop grid calls it once, the stream maps it over the window; two components consume it without importing each other's internals, and it unit-tests without mounting a 500-line component. The helper takes PREFETCHED window-range data (one `activitiesInRange` / `travelSegmentOccurrencesInRange` / `holidaysInRange` call over the whole window span), never per-month store hits — otherwise the stream triples store scans. The week-separator metadata (`weekSeparatorIndexes` / `weekRangeByRow`) folds into the per-month helper output — both are index-based over a single month today and would silently mislabel across a multi-month window.
- A month-boundary header renders before each month's first day card: lowercase `formatMonthYear` text, Heritage Orange, Outfit 600, gradient rule (per mockup). Reuses the existing mobile separator row pattern.
- **One mechanism, not two:** a single passive, rAF-throttled scroll listener on the `<main>` scroller does probe + extend + prune via `scrollTop` thresholds — exactly as the approved mockup demonstrates (mockup lines ~189-207). No IntersectionObserver/sentinel plumbing. Compensation invariant: **any DOM mutation above the viewport — prepend OR top-prune — compensates `scrollTop` by the height delta in the same frame** (measure before/after `nextTick`; the mockup demonstrates only the prepend half — top-prune while extending downward at max window causes the same jump). The pure window/probe logic lives in `useMonthStream` and is fully unit-testable with synthetic offsets.
- **Teardown:** the stream's scroll listener attaches to the `<main>` element, which outlives the component (route change, view switch, breakpoint flip) — `onScopeDispose` removes the listener and cancels any pending rAF, same hygiene as the wheel composable. A leaked listener would re-emit `month-in-view` from a dead component.

**A2 · `month-in-view` intent + label sync.** The same scroll handler determines the month owning the viewport's upper-third line (the mockup's probe) and, when it changes, `emit('month-in-view', firstOfMonth)`. `FamilyPlannerPage` handles it by setting `referenceDate` to that month's 1st. The re-anchor rule (Important Notes) makes this loop-safe: the grid sees the new `referenceDate`, finds its month already in view, and does not scroll. The label crossfade uses the app's established `<Transition mode="out-in">` fade pattern (e.g. `nd-fade`, NotificationsDrawer.vue:88) keyed on the label string in `CalendarCommandBar` (label is already a plain prop), honoring reduced motion via `useReducedMotion`.

**A3 · Swipe landing.** Mobile swipe keeps `useCalendarSlide`. On commit the page still calls `goNext`/`goPrev` (referenceDate → 1st of target month). New: the stream re-anchors at the TOP of the target month for `next`, and at the LAST day card for `prev`. One imperative channel, not two tick props: `CalendarMonthStream` takes a single `anchor: { tick: number; target: 'today' | 'month-start' | 'month-end' }` prop that replaces `todayTick` on this component only (Weekly/Daily views keep theirs) — every anchor request flows through the same prop and the same `anchorToDate` handler, so ordering between "today" and a landing hint is unambiguous. **Timing:** the page bumps the anchor tick inside `useCalendarSlide`'s between-phase callback — the same point where `referenceDate` updates today — so the re-anchor scroll executes while the outgoing content is off-screen (otherwise the stream visibly snaps before or after the slide).

**A4 · One anchoring helper, loud on failure.** Refactor `scrollMobileToToday` (which today returns silently at four guard points, CalendarGrid.vue:417-420) into ONE `anchorToDate(dateStr, opts)` used by Today, mount-settle, and swipe-landing. It first ensures the target month is inside the stream window (resetting to `[target-1, target, target+1]` when not), then scrolls to the day card; the missing-card path calls `reportError(warning, action:'stream-anchor-failed')` — making the existing silent returns loud too, not just the new code.

### Part B — desktop wheel paging (B1 feel)

**B1 · New composable `useWheelMonthPaging(gridRef, opts)`** (`src/composables/useWheelMonthPaging.ts`), enabled only when NOT `useBreakpoint().isMobile` (no `view === 'month'` coupling — CalendarGrid mounts only in month view per FamilyPlannerPage.vue:732, so the composable's contract stays "element + edge + callbacks", view-ignorant and reusable):

- Listens for `wheel` (non-passive, so it can `preventDefault` ONLY when consuming) on the grid element itself — events over other page regions never reach it (requirement 10 falls out structurally).
- Consumes a wheel-down event only when BOTH hold: the grid's bottom edge is visible in the scroller AND the scroller is at its downward scroll limit (`scrollTop + clientHeight >= scrollHeight − ε`); mirrored for up/top (`scrollTop <= ε` AND grid top visible). Computed from `getBoundingClientRect` + scroller metrics, cheap per event. Without the at-limit term, the moment the grid's bottom edge scrolled into view every wheel-down over the grid would page the month and make the connect nudge / inactive-activities below it unreachable by wheel — a direct requirement-10 violation. When nothing scrollable remains (the common "grid fits entirely" case) the compound condition degenerates to pure grid-edge and pages immediately as intended; the grid-edge term keeps it inert while the user is deep in a long expanded list. Otherwise the event is untouched and ordinary scrolling proceeds.
- While consuming: accumulate `deltaY`; translate the grid `translateY(-stretch)` with damping (`stretch = clamp(acc/8, 24px)`); idle timeout (~260ms) springs back and resets.
- At ≥140px accumulated: commit — vertical two-phase slide (out 220ms / in 320ms, `useCalendarSlide`'s easing), calling `onNext`/`onPrev` between phases; then a 420ms cooldown during which all wheel events over the grid are swallowed (momentum tail). Constants mirror the mockup and the old attempt's tested values.
- Reduced motion via the existing `useReducedMotion` composable: skip stretch and slide; commit still requires the same accumulation. Finish the consolidation rather than freezing the duplicate: `useCalendarSlide`'s hand-rolled matchMedia (useCalendarSlide.ts:95-100) also switches to `useReducedMotion` in the same change, AND the consolidation carries the `typeof window.matchMedia !== 'function'` test-environment guard INTO `useReducedMotion` (a one-line hardening — it currently registers matchMedia in `onMounted` unguarded, so jsdom suites without a stub would throw). One implementation left in the tree beats a comment telling people not to copy the other.
- Guard: inert while any modal is open via `hasOpenOverlays()` (`src/utils/overlayStack.ts:26`, ref-counted by BaseModal/BaseSidePanel). Belt-and-braces only — a wheel listener bound to the grid element is already structurally inert under a covering overlay — but naming the real symbol prevents anyone inventing a parallel modal-open signal.
- Full teardown on unmount/disable (listener, timers, transforms) — mirror `useCalendarSlide`'s `onScopeDispose` hygiene.

**B2 · Wiring.** `CalendarGrid` calls the composable with `onNext: () => emit('next')`, `onPrev: () => emit('prev')` — the same intents the swipe uses; the page changes nothing on this path.

### What is deliberately NOT changed

- `usePlannerNavigation` API is untouched except the page-level `month-in-view` handler.
- Week/day views: no wheel paging, no stream (out of scope).
- Desktop grid stays a single-month render (the stream is mobile-only).

## Files Affected

- `src/components/planner/CalendarMonthStream.vue` — **new**; mobile stream (windowing, boundary headers, `month-in-view` emit, `anchorToDate`), mounted from the page
- `src/components/planner/CalendarGrid.vue` — desktop-only now: wheel-paging wiring; mobile day-stack code deleted (interface unchanged)
- `src/utils/monthCells.ts` — **new**; pure per-month cell computation (extracted from `calendarDays`), consumed by grid + stream
- `src/utils/getAppScroller.ts` — **new**; single resolution point for the `<main>` scroll container
- `src/composables/useCalendarSlide.ts` — reduced-motion source switched to `useReducedMotion`
- `src/composables/useWheelMonthPaging.ts` — **new**; B1 edge-resistance paging
- `src/composables/useMonthStream.ts` — **new**; window state, extend/prune/compensate, month-in-view probe (pure logic separated for unit testing)
- `src/pages/FamilyPlannerPage.vue` — `month-in-view` handler, swipe landing hint
- `src/components/planner/CalendarCommandBar.vue` — label crossfade
- `src/services/translation/uiStrings.ts` — only if a new visible string emerges (month names come from formatters)
- `src/composables/__tests__/useMonthStream.test.ts`, `useWheelMonthPaging.test.ts` — **new**
- `src/components/planner/__tests__/CalendarGrid.test.ts` + `CalendarGrid.today.test.ts` — extended; **new** `CalendarMonthStream.test.ts` for the stream component
- `src/utils/__tests__/monthCells.test.ts` — **new**; pure-module tests
- `docs/mockups/calendar-continuous-months-2026-08-29.html` — already committed (approved design record)
- `src/content/help/…` — see Help Center Coverage

## Help Center Coverage

- **Action**: update existing
- **Category**: features
- **Slug**: existing planner article (`family-planner-and-activities`)
- **Title**: (unchanged)
- **Scope**: Add a short "moving between months" passage: on your phone, keep scrolling — the next month continues right after this one and the header follows along; on a computer, scrolling at the calendar's edge turns the month, and swiping/arrows still work everywhere.
- **Notes**: mention the swipe landing behavior (next lands on the 1st, previous on the last day) so it reads as intended, not surprising.

## Observability Coverage

- **Events** (all surface `calendar-nav`, kebab-case, structured context; no new context keys — `action`/`detail` only, both already allowlisted):
  - `logEvent(debug)` `action:'stream-extend'`, `detail:'append'|'prepend'` — window growth (rate visible, floor-exempt counter).
  - `logEvent(info)` `action:'wheel-page-commit'`, `detail:'next'|'prev'` — every desktop paging commit (success-path signal; makes usage AND failure rates measurable).
  - `logEvent(info)` `action:'swipe-landing'`, `detail:'start'|'end'` — mobile swipe landings.
  - `reportError(warning)` `action:'stream-anchor-failed'` — a re-anchor/deep-link scroll that could not find its target card (the "silently wrong position" failure made loud).
  - `record('calendar.streamExtend', ms)` (`import { record as recordPerf } from '@/utils/perfTiming'` — the codebase convention) — extension cost; the 250ms firehose floor is enforced inside `record` itself.
- **Failure modes covered**: paging never firing (commit event absent while planner pageviews present — diagnosable by rate), stream failing to extend (extend events stop while scroll continues), wrong anchor position (`stream-anchor-failed`), runaway month skipping (commit events clustered <500ms apart — queryable from timestamps). No bare `catch {}` anywhere; every catch classifies and logs.
- **Critical vs telemetry**: nothing here is `critical` — no user action fails destructively and no data is at risk; worst case is a navigation annoyance. Firehose `warning` is the ceiling.
- **Privacy/store gate**: no new context keys → no `ALLOWED_CONTEXT_KEYS` or store-declaration changes.

## Acceptance Criteria

- [ ] Mobile (phone + PWA + narrow desktop): scrolling past month end continues seamlessly into the next month's days with a visible lowercase month header; scrolling up likewise into the previous month; no scroll jump on prepend.
- [ ] Mobile swipe: next month lands on the 1st; previous month lands on the last day.
- [ ] Command-bar month label tracks the month in view (crossfade; correct under fast multi-boundary scrolling).
- [ ] Desktop `md`+: one trackpad flick / wheel gesture at the grid edge advances exactly one month with the B1 rubber-band feel; momentum never skips months; `prefers-reduced-motion` = instant swap.
- [ ] No regression to ordinary scrolling at any width; content below the calendar stays reachable; nothing hijacks scroll over other regions or while a modal is open.
- [ ] Existing swipe + command-bar prev/next/today behave exactly as before (plus the new landing positions).
- [ ] Today + deep-links position correctly inside the stream.
- [ ] Task 0 outcome (why the 2026-07-24 attempt failed) recorded in the implementation notes.
- [ ] Help Center passage updated per **Help Center Coverage**.
- [ ] Diagnostic logging in **Observability Coverage** implemented and verified in CloudWatch.
- [ ] Hand-verified on greg's actual phone AND desktop browser (the explicit definition-of-done from the tracker).

## Testing Plan

1. **Unit — `useMonthStream` + `monthCells` (pure module)**: window extend/prune arithmetic; compensation math for BOTH prepend and top-prune; month-in-view probe against synthetic offsets; reset-window on out-of-window target; per-month cells + week-separator metadata from prefetched range data.
2. **Unit — `useWheelMonthPaging`**: edge detection against mocked rects; accumulation/threshold/cooldown state machine (fake timers); reduced-motion path; modal-guard inertness; teardown clears listeners/timers. _Honest limit stated in the tests: jsdom cannot verify feel or real event delivery — that is what step 4 is for._
3. **Component tests**: new `CalendarMonthStream.test.ts` — mounts with the window, exactly one boundary header per rendered month, `month-in-view` emitted on synthetic scroll, anchor prop drives `anchorToDate`, listener teardown on unmount; extended `CalendarGrid` tests — desktop mount attaches exactly one wheel listener, renders exactly one month; page-level test that month view mounts stream below `md` and grid at `md`+.
4. **Hand-verification matrix (greg, required)**: phone (native app) — scroll across ≥3 boundaries both directions, swipe landings, Today, deep-link from a notification; PWA — same; desktop — wheel + trackpad paging at both edges, momentum flick = one month, content below reachable, modal open = inert, reduced-motion (OS setting) = instant; **desktop at mobile width with a mouse** — the exact condition that sank attempt one.
5. `npm run test:run`, type-check, lint all green; no E2E additions (ADR-007 three-gate: no data loss at stake, feel untestable without real physics).

## Review Passes

- **Pass 1 (Initial draft)**: drafted from the approved mockup + tracker #58 re-scope; windowed stream + edge-resistance paging on the existing intent architecture.
- **Pass 2 (DRY + error handling)**: named real reuse targets (`hasOpenOverlays`, `useReducedMotion`, `useBreakpoint.isMobile`, `nd-fade` transition, `recordPerf`), collapsed IO-sentinels + scroll listener into one scroll handler, mandated an explicit mobile/desktop render split with prefetched window-range data, unified anchoring into one loud-failure helper, cut the nonexistent `?date=` deep-link.
- **Pass 3 (Sustainability)**: split the mobile stream into `CalendarMonthStream.vue` with `monthCells` as a pure util module, centralized scroller resolution in `getAppScroller`, decoupled `useWheelMonthPaging` from planner view state, merged todayTick + landing hint into one anchor prop, stated the single-write-path scroll invariant, consolidated reduced-motion detection to one implementation.
- **Pass 4 (Fresh-eyes sweep)**: fixed the desktop consume condition to require scroller-at-limit so content below the grid stays wheel-reachable (req 10), extended jump compensation to top-prune, moved the stream mount to page level keeping CalendarGrid's interface untouched, pinned swipe-landing anchor timing to the slide's between-phase, mandated stream listener teardown, made the reduced-motion guard explicit, documented accepted clash-mark lag.

## Prompt Log

> **No GitHub issue created.** This plan was approved for direct implementation.

<details>
<summary>Full prompt history</summary>

### Initial Prompt (via /beanies-pre-plan, 2026-08-29)

> #58 let's prepare for implementing - this should be a fairly simple UX improvement to get continuous scrolling on monthly view on mobile. ask questions as needed and once clear move onto /beanies-plan

### Follow-up 1 (scope + open questions, answered in pre-plan intake)

> Actually, from the beginning I'm fairly certain the scope of this was to fix the ux on mobile and when I say when I said desktop previously, I think I meant it failed at mobile width on desktop. While I was testing using my mouse. The goal was to have a more natural and intuitive feel when scrolling in month view at Mobile wick which applies to both the pwa the app and desktop at mobile width when scrolling down to the end of a month, continue to continuing to scroll takes you into the next month with a clear indicator that the next month is starting. at the same time, if you do use the left or right swiping hand gesture to change to the previous or the next month when moving to the next month, you'll automatically be replaced at the start of the month on the 1st and by moving to the previous month they'll automatically be placed at the end of the month at the last day. All of these gestures are meant to make the navigation feel more intuitive and natural overall. So the goal of this issue is to make navigating through the monthly calendar in Mobile. View more natural and intuitive
> (plus AskUserQuestion answers: trigger = grid bottom/top edge; no pre-turn affordance; reuse existing slide animation)

### Follow-up 2 (scroll model + desktop disposition)

> Seamless continuous stream (mobile). Tackle both at once and use /frontend-design to propose the most natural and intuitive UX (desktop).

### Follow-up 3 (mockup approval)

> approved A (mobile) and B1 for desktop

### Follow-up 4 (proceed to planning)

> go ahead to /beanies-plan
> (full assembled pre-plan block passed as the Phase 1 prompt — recorded on Notion #58 `beanies-plan prompt`)

</details>
