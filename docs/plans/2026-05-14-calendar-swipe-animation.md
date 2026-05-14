# Plan: Calendar swipe animation — slide-out / slide-in transition

> Date: 2026-05-14
> Related issues: none filed (greg's request)

## Context

The day / week / month calendar surfaces support horizontal swipe navigation via `useHorizontalSwipe.ts`. Past-threshold swipes correctly call `nextDay` / `prevDay` / `nextWeek` / `prevWeek` / `nextMonth` / `prevMonth`, but Vue swaps content with no motion: the gesture feels like a tap-with-extra-steps, not a swipe. The underlying composable already emits an `onProgress(dx)` live signal that no consumer reads.

## Approach

Add a higher-level `useCalendarSlide` composable that wraps `useHorizontalSwipe` and adds the missing animation. iOS-Calendar pattern:

1. **Live drag** — element follows the finger via `transform: translate3d(dx, 0, 0)`. Past threshold the motion is rubber-banded so it resists infinite pulling: `damped = sign(dx) × (threshold + (|dx| − threshold) × 0.45)`.

2. **Commit (released past threshold)** — two-phase animation via Web Animations API:
   - Phase A: glide from current `dx` to `−sign × width` in ~220 ms (finishes the slide off in the finger's direction).
   - Synchronous swap: call `onNext` / `onPrev` → Vue re-renders with new reference date.
   - Set transform instantly to `+sign × width` (snap to opposite edge, off-screen).
   - Phase B: glide from there to `0` in ~320 ms.
   - Easing throughout: `cubic-bezier(0.32, 0.72, 0, 1)` (Apple's standard for system page transitions).

3. **Cancel (released below threshold or pointercancel)** — single 220 ms ease back to `0`.

4. **Reduced motion** — `matchMedia('(prefers-reduced-motion: reduce)')` short-circuits to current instant-swap behaviour. No drag preview either.

5. **Re-entrancy** — `enabled` ref flips false during the commit animation; passed into `useHorizontalSwipe` so a second swipe can't fire while one is in flight.

6. **`onProgress(0)` handling** — `useHorizontalSwipe` emits `onProgress(0)` at the end of every gesture (committed OR cancelled). The new composable disambiguates via a synchronous `committing` flag set inside `onSwipeLeft` / `onSwipeRight` (which fire before `onProgress(0)` in `useHorizontalSwipe.onPointerUp`). When `committing === true`, the composable's `onProgress(0)` handler skips the spring-back; otherwise it animates back to `0`. This keeps the lower composable's well-tested contract unchanged.

## Why not refactor `useHorizontalSwipe` directly

It's well-tested (13 specs in `useHorizontalSwipe.test.ts`) and consumed by `useQuickAdd` and `useBackGestureClose` in addition to the three calendar views. Extending it with animation logic would couple it to a specific UX pattern; the cleaner separation is "low-level gesture detection" + "high-level transition orchestration".

## Files affected

**New:**

- `src/composables/useCalendarSlide.ts` — the new composable.
- `src/composables/__tests__/useCalendarSlide.test.ts` — unit tests.

**Modified (3 lines each — `useHorizontalSwipe(...)` → `useCalendarSlide(...)`):**

- `src/components/planner/DailyCalendarView.vue`
- `src/components/planner/WeeklyCalendarView.vue`
- `src/components/planner/CalendarGrid.vue`

Plus a `will-change: transform` style hint on each swipe surface for GPU compositing.

**Docs:**

- `docs/STATUS.md` — log session entry.
- `CHANGELOG.md` — user-facing entry under 2026-05-14.

## Out of scope

- Live peek of the destination view's content during drag (the iOS Calendar "carousel of three" pattern). Would require lifting `referenceDate` out of each view and rendering prev/current/next simultaneously — much larger refactor for incremental aesthetic gain.
- Animating the prev / next button taps. Greg's request was specifically about the swipe gesture; button taps stay instant (consistent with how every other date-stepper in the app behaves).
- Vertical-axis swipe (jumping between views — day → week → month). Different feature.
