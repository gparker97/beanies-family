# Plan: Drag, resize, and haptics for calendar events (Phase 1 — day/week timeline)

> Date: 2026-05-19
> Related issues: None — direct implementation
> **No GitHub issue created.** This plan was approved for direct implementation in a future session.

## User Story

As a beanies.family user planning my family's week, I want to drag and resize events directly on the day/week timeline (on both desktop and touch) so that I can adjust the day's schedule quickly without opening a modal for every small change.

## Context

Beanies' planner today requires a modal trip for every reschedule or duration change. For a surface families touch many times a day, that's friction users notice — and it's the dominant UX expectation people bring from Google Calendar, Apple Calendar, and Notion Calendar.

We evaluated four options in conversation (interact.js, native Pointer Events, `@vueuse/gesture`, full calendar-lib replacement). `interact.js` won: ~15 KB gzipped, battle-tested mouse/touch/pen unification, built-in snap/restrict/resize, mature (10+ years). Native Pointer Events would save ~15 KB but cost ~400 LOC of edge-case code we'd own forever. The custom calendar (`CalendarGrid`, `DayTimeline`, `DailyCalendarView`, `WeeklyCalendarView`) stays.

Haptics on Android via `navigator.vibrate()`. iOS Safari has no Vibration API — accept that, lean on visual feedback.

**Phase 1 (this plan)**: drag + resize on day/week timeline, timed events only.
**Phase 2 (separate plan, after Phase 1 ships)**: drag on month grid (all-day chips). The Phase-1 API (the `DragPatch` tagged union and `CommitOutcome`) is intentionally shaped so Phase-2 plugs in with no breaking changes.

Locked decisions:

- Touch activation: long-press (~300 ms) — preserves vertical scroll.
- Resize scope: timed events on day/week timeline only.
- Conflict policy: accept overlap — existing lane-splitter renders side-by-side.
- Rollout: DayTimeline first, then extend to CalendarGrid in Phase 2.

## Requirements

1. **Drag-to-reschedule** timed events on `DayTimeline.vue`:
   - Vertical drag changes `startTime`/`endTime` keeping duration constant.
   - On weekly view, horizontal drag across day columns moves the event to a different `date`.
2. **Resize** from top (changes `startTime`) and bottom (changes `endTime`), 15-min minimum duration.
3. **Snap** to 15-min boundaries.
4. **Long-press touch activation** (~300 ms); short taps still open `ActivityViewEditModal`.
5. **Haptic feedback** on drag-start and resize-start via `navigator.vibrate(10)` — silent no-op on iOS/desktop.
6. **Visual feedback**: scale (1.02), elevated shadow, heritage-orange ring. Reduced-motion respected via reactive class.
7. **Recurring events**: route through the existing shared `chooseScope()` from `useRecurringEditScope`. Cancel restores position with info toast.
8. **Overlap on drop**: accept — `groupOverlapping` lane-splits already.
9. **Escape cancels drag**: pressing Escape during a drag/resize aborts and restores original position. No toast (user intent is "cancel").
10. **No silent failures**: every path routes to either a user toast or a `reportError` invariant log.
11. **Phase 1 scope only**: no month-grid drag, no keyboard-arrow-key adjust.

## Important Notes & Caveats

- **Bundle impact**: ~15–20 KB gzipped for `interactjs`. Verify with `npm run build` and document in PR.
- **interact.js + Vue 3**: interact.js mutates DOM via `transform`. Clear the transform in `dragend`/`resizeend` `finally` blocks. Don't call `setPointerCapture` from app code.
- **`touch-action`**: bound `<button>` cards must set `touch-action: none` once `interact()` is bound. Container's `touch-action: pan-y` is unaffected.
- **Recurring scope chooser already exists — reuse, do NOT duplicate**: `chooseScope()` is exported from `src/composables/useRecurringEditScope.ts:20`, backed by `src/components/ui/RecurringEditScopeModal.vue`. `ActivityViewEditModal.vue:342` already calls it. The drag flow imports `chooseScope` directly. **No new composable, no modal extraction, no refactor of `ActivityViewEditModal`.**
- **Reduced motion**: use the existing `src/composables/useReducedMotion.ts`. Do NOT re-detect via `window.matchMedia`.
- **Time-grid constants get a dedicated module**: extract `parseMinutes`, `ROW_HEIGHT`, `MIN_CARD_HEIGHT` from `useCalendarNavigation.ts` into a new pure-utility module `src/utils/timeGrid.ts`. `useTimeGrid()` continues to re-export `ROW_HEIGHT` at the composable boundary for backwards-compat.
- **Pure-math layer is its own file**: all the actual drag/resize math goes in `src/composables/dragMath.ts` with **zero** imports from `vue`, `@/composables`, or `interactjs`.
- **`useToast` already calls `reportError` internally** (`useToast.ts:92–105`). Do not call `reportError` in addition for the same user-facing failure. Reserve manual `reportError` for invariant violations not surfaced to the user (mount-null, NaN time, `unset` failure).
- **`activityStore.updateActivity` does NOT throw**: returns `Activity | null` (`activityStore.ts:425–443`). `wrapAsync` already reports the underlying repo error to Slack.
- **`splitActivity` end-dates the original BEFORE attempting to create the new template** (`activityStore.ts:482`). If the inner `createActivity` fails, the original is mutated regardless — a more lossy half-applied state than a clean rollback. The `splitPartialMsg` must hint at this so users know what they're looking at.
- **No string-sentinel error contracts**: `commit` returns a `CommitOutcome` discriminated union.
- **Events render as inline `<button>` elements in DayTimeline.vue:336–378** — there is no `EventCard` component. The template ref binds directly on the `<button>`. Vue 3 typing for function refs in a `v-for` returns `Element | ComponentPublicInstance | null`; narrow with `el as HTMLElement | null`.
- **Resize margin and tiny cards**: interact.js's `resizable({ edges, margin })` defines the hot-zone in px. A flat `margin: 16` on a 15-min event (15–19 px tall depending on root font size) **consumes the entire card**, leaving no drag region. Use a **dynamic margin** per card: `Math.min(8, cardHeightPx / 3)`. At default zoom this still gives ≥5 px resize zones with ≥5 px drag region in the middle. Manual test for "drag a 15-min event in default and Large Reading Mode".
- **iOS haptics**: not possible without Capacitor. Don't pre-warn users; rely on visual cue.
- **Template refs in a `v-for`**: same-named refs collect into an array unless you use the function-ref pattern. Bind `(el) => onCardMount(activity.id, el as HTMLElement | null)` directly on the `<button>` and track per-id, otherwise only the last card binds.

## Assumptions

> Review before implementing — valid as of 2026-05-19.

1. Long-press at ~300 ms is the right touch-activation default. If user testing shows it's missed, add a visible drag-handle in Phase 1.5.
2. 15-minute snap matches family-planning granularity. Hard-coded for now.
3. `interactjs` 1.10.x supports Vue 3 cleanly via plain DOM bindings.
4. Bundle hit of ~15–20 KB gzipped is acceptable.
5. Pinch-to-zoom on the timeline is not a requirement.
6. `materializeOverride(parentId, occurrenceDate, overrides)` and `splitActivity(activityId, fromDate)` work the same for drag-driven changes as for modal-driven ones. Mirror `useActivityScopeEdit.ts:60–76` — strip `date` and `recurrenceEndDate` from the patch before the post-split update.
7. **Concurrent drag of the same occurrence on two devices may produce a transiently invalid duration** after Automerge LWW merges per field (`endTime` < `startTime` possible). Accept for Phase 1; if observed in practice, add a store-level post-merge invariant check (`endTime` < `startTime` → snap to `startTime + 15 min`) in a follow-up.
8. E2E can synthesize long-press + drag via Playwright's `page.mouse.down/wait/move/up` with a 350 ms wait. If interact.js's `hold` is unreliable under Playwright, fall back to calling the composable's `commit` directly via a test-only exposed handle — still proves the dispatch + persistence.
9. `errorReporter`'s allowlist already permits the context fields used here (`activityId`, `start`, `end`, `action`). If not, allowlist them in the same PR.

## Approach

### New files

#### `src/utils/timeGrid.ts`

Pure constants + math, no Vue, no DOM. Extracted from `useCalendarNavigation.ts`.

```ts
export const ROW_HEIGHT = 3.75; // rem — 1 hour
export const MIN_CARD_HEIGHT = 1.5; // rem — min event card
export const HOURS_PER_DAY = 24;

export class InvalidTimeError extends Error {
  constructor(public raw: string) {
    super(`Invalid time: "${raw}"`);
  }
}

export function parseMinutes(time: string): number; // throws InvalidTimeError on NaN
export function formatMinutes(min: number): string; // "HH:mm"
export function clampMinutes(min: number): number; // [0, 23*60+45]
export function rootFontPx(): number; // computed style on document.documentElement; falls back to 16
```

`useCalendarNavigation.ts`, `DayTimeline.vue`, `DailyCalendarView.vue`, `WeeklyCalendarView.vue` re-import from `@/utils/timeGrid`. `useTimeGrid()` continues to re-export `ROW_HEIGHT` (`useCalendarNavigation.ts:151`).

#### `src/utils/timeSnap.ts`

Pure 15-minute snap math. Imports `parseMinutes`, `clampMinutes`, `InvalidTimeError` from `@/utils/timeGrid`.

```ts
export function snapTimeToInterval(time: string, intervalMins: number): string;
export function shiftAndSnap(time: string, deltaMins: number, intervalMins: number): string;
export function pxDeltaToMinutes(deltaPx: number, hourPx: number, snapMins: number): number;
```

NaN input throws `InvalidTimeError`. Never silent garbage.

#### `src/utils/__tests__/timeGrid.test.ts` + `src/utils/__tests__/timeSnap.test.ts`

Edge cases: midnight, end-of-day, sub-snap deltas, malformed input throws.

#### `src/utils/haptics.ts`

```ts
export function hapticTap(ms = 10): void {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(ms);
    } catch {
      /* iOS or browsers that throw */
    }
  }
}
```

#### `src/composables/dragMath.ts`

Pure. Zero imports from `vue`, `@/composables`, or `interactjs`.

```ts
export type DragPatch =
  | { kind: 'timed'; startTime: string; endTime: string; date?: string }
  | { kind: 'allday'; date: string };
// Phase 2 only — never returned by Phase-1 emitters. Kept in the union so exhaustive
// switch statements in shared callers don't need to be rewritten when Phase 2 lands.

export function computeDragPatch(opts: {
  activity: FamilyActivity;
  deltaPxX: number;
  deltaPxY: number;
  hourPx: number;
  dayWidthPx?: number;
  snapMins: number;
}): DragPatch; // throws InvalidTimeError

export function computeResizePatch(opts: {
  edge: 'top' | 'bottom';
  activity: FamilyActivity;
  deltaPxY: number;
  hourPx: number;
  snapMins: number;
  minDurationMins: number;
}): DragPatch; // throws InvalidTimeError
```

`src/composables/__tests__/dragMath.test.ts` covers all branches. One additional test reads the source file and asserts no forbidden imports (regex `/^import .* from ['"](vue|@\/composables|interactjs)['"]/m` returns no match) — fails CI fast.

#### `src/composables/useEventDrag.ts`

Thin interact.js adapter. Lifecycle + binding only. Math via `dragMath`; error policy via `commit`'s `CommitOutcome` contract.

```ts
export type CommitOutcome =
  | { kind: 'saved' }
  | { kind: 'cancelled' } // user dismissed scope chooser; caller already toasted
  | { kind: 'already-surfaced' }; // commit handled its own toast (e.g., split-partial)

interface UseEventDragOptions {
  activity: Ref<FamilyActivity> | FamilyActivity;
  dateStr: string;
  hourPx: Ref<number>;
  dayWidthPx?: Ref<number>;
  snapMins?: number; // default 15
  minDurationMins?: number; // default 15
  enabled?: Ref<boolean>;
  commit: (patch: DragPatch) => Promise<CommitOutcome>; // throws on unexpected failure only
  onPreview?: (patch: DragPatch) => void;
}

export function useEventDrag(
  cardRef: Ref<HTMLElement | null>,
  opts: UseEventDragOptions
): { isDragging: Ref<boolean>; isResizing: Ref<boolean> };
```

Responsibilities:

- **Mount-guard**: if `cardRef.value` is null on mount, `console.warn` + `reportError({ surface: 'calendar-drag-mount-null', activityId })` and return.
- **`hourPx` sampling**: read once per `dragstart` from `rootFontPx() * ROW_HEIGHT`. **Sample from `<html>` only**, never the timeline element, so a future style refactor scoping font-size to the timeline doesn't silently break math.
- **Bind**: `interact(cardRef.value).draggable({ hold: 300, listeners }).resizable({ edges: { top: true, bottom: true }, margin: dynamicMargin, listeners })` where `dynamicMargin = Math.min(8, cardHeightPx / 3)`. Set `cardRef.value.style.touchAction = 'none'`.
- **`dragstart` / `resizestart`**: `hapticTap()`; set `isDragging`/`isResizing` refs; bind a one-shot `window.keydown` listener so Escape calls `interaction.stop()` and clears the gesture (the dragend handler still runs with a "cancelled" interaction state — treat as `outcome.kind === 'cancelled'`).
- **`dragmove` / `resizemove`**: compute via `dragMath.compute*Patch()`. try/catch — `InvalidTimeError` → `reportError({ surface: 'calendar-drag-nan-time', activityId, start, end })`, `showToast('error', t('planner.drag.error.badTimeTitle'), ...)`, abort: `interact(cardRef.value).draggable(false)` AND explicitly set `isDragging.value = false; isResizing.value = false` (don't rely on `dragend` firing after `draggable(false)`). Re-enable on next pointerdown.
- **`dragend` / `resizeend`**:
  ```ts
  try {
    const outcome = await opts.commit(patch);
    // 'saved'/'cancelled'/'already-surfaced' all just clear visuals
  } catch (err) {
    showToast(
      'error',
      t('planner.drag.error.saveFailedTitle'),
      t('planner.drag.error.saveFailedMsg'),
      {
        surface: 'calendar-drag',
        error: err,
        context: { action: 'calendar-drag-commit', activityId },
      }
    );
  } finally {
    clearTransform();
    clearClasses();
    isDragging.value = false;
    isResizing.value = false;
    removeEscapeListener();
  }
  ```
- **Unmount**: wrap `interact(cardRef.value).unset()` in try/catch with `console.warn`; component teardown always completes.

#### `src/composables/__tests__/useEventDrag.test.ts`

- `commit` returning each `CommitOutcome.kind` → correct lifecycle behavior
- `commit` throwing → error toast fired, transform cleared, `isDragging === false`
- Mount with null `cardRef` → `reportError` fired, no `interact` bind
- NaN time → `reportError` + bad-time toast + `isDragging` explicitly false (no `dragend` reliance)
- `interact().unset()` throwing → console.warn; teardown completes
- Escape during drag → `interaction.stop()` called, `outcome.kind === 'cancelled'` path

#### `src/content/help/features/drag-and-resize-events.ts`

Help Center article — see Help Center Coverage below.

### Modified files

#### `src/composables/useCalendarNavigation.ts`

Remove `parseMinutes`, `ROW_HEIGHT`, `MIN_CARD_HEIGHT`; re-import from `@/utils/timeGrid`. Keep `useTimeGrid()` re-export of `ROW_HEIGHT` for backwards-compat at the composable boundary.

#### `src/components/planner/DayTimeline.vue`

- **Bind `useEventDrag` on the existing inline `<button>` event card** at lines 336–378 (no new `EventCard` component). Function-ref pattern:

  ```vue
  <button
    v-for="ev in positionedEvents"
    :key="ev.occurrence.activity.id"
    :ref="(el) => onCardMount(ev.occurrence.activity.id, el as HTMLElement | null)"
    class="absolute z-[2] ..."
    ...
  >
  ```

  `onCardMount` maintains a `Map<activityId, HTMLElement>` and calls `useEventDrag(ref, { activity, dateStr, hourPx, dayWidthPx?, commit })` per id; unbind via `interact().unset()` on element removal.

- **Strategy table — `RECURRING_SCOPE_HANDLERS` only**; non-recurring is a direct branch (no synthetic `'none'` token):

  ```ts
  function assertSaved(r: FamilyActivity | null): CommitOutcome {
    if (r === null) throw new Error('store returned null');
    return { kind: 'saved' };
  }

  const RECURRING_SCOPE_HANDLERS: Record<
    RecurringEditScope,
    (patch: DragPatch, a: FamilyActivity, d: string) => Promise<CommitOutcome>
  > = {
    all: (p, a) => activityStore.updateActivity(a.id, p).then(assertSaved),
    'this-only': (p, a, d) => activityStore.materializeOverride(a.id, d, p).then(assertSaved),
    'this-and-future': handleSplitAndFuture,
  };

  async function handleSplitAndFuture(
    patch: DragPatch,
    a: FamilyActivity,
    d: string
  ): Promise<CommitOutcome> {
    const tpl = await activityStore.splitActivity(a.id, d);
    if (tpl === null) throw new Error('splitActivity returned null');
    // Strip date + recurrenceEndDate per useActivityScopeEdit.ts:67–71.
    const safe =
      patch.kind === 'timed' ? { startTime: patch.startTime, endTime: patch.endTime } : {};
    const result = await activityStore.updateActivity(tpl.id, safe);
    if (result === null) {
      // Note: the original series was already end-dated by splitActivity. Toast text reflects this.
      showToast(
        'error',
        t('planner.drag.error.splitPartialTitle'),
        t('planner.drag.error.splitPartialMsg'),
        {
          surface: 'calendar-drag-split-partial',
          context: { action: 'calendar-drag-split-partial', activityId: a.id },
        }
      );
      return { kind: 'already-surfaced' };
    }
    return { kind: 'saved' };
  }

  async function commit(patch: DragPatch): Promise<CommitOutcome> {
    if (activity.recurrence === 'none') {
      return activityStore.updateActivity(activity.id, patch).then(assertSaved);
    }
    const scope = await chooseScope(); // imported from '@/composables/useRecurringEditScope'
    if (scope === null) {
      showToast(
        'info',
        t('planner.drag.error.recurringCancelledTitle'),
        t('planner.drag.error.recurringCancelledMsg')
      );
      return { kind: 'cancelled' };
    }
    return RECURRING_SCOPE_HANDLERS[scope](patch, activity, dateStr);
  }
  ```

- **Visual affordances**:
  - Desktop: `cursor: grab` on hover; `cursor: grabbing` while dragging; hover-only 6 px resize strips (CSS-only).
  - Touch: visible resize handles only when card has `.event-card--active` class (set by `useEventDrag` after successful long-press grab).
  - `.event-card--dragging` and `.event-card--resizing` carry scale + shadow + ring, gated on a `:class="{ 'motion-safe': !prefersReducedMotion }"` binding from `useReducedMotion()` — reactive to runtime change.

#### `src/services/translation/uiStrings.ts`

Add 10 entries — each in BOTH `en` (Title/Sentence case) and `beanie` (lowercase) per the file convention at line 4905+:

- `planner.drag.aria.draggable` — en: `"Press and hold to drag this event"` / beanie: `"press and hold to drag this event"`
- `planner.drag.aria.resizable` — en: `"Press and hold the edge to resize"` / beanie: `"press and hold the edge to resize"`
- `planner.drag.error.saveFailedTitle` — en: `"Couldn't save the new time"` / beanie: lowercase
- `planner.drag.error.saveFailedMsg` — en: `"Tap the event to try again, or check your connection."` / beanie: lowercase
- `planner.drag.error.recurringCancelledTitle` — en: `"Change cancelled"` / beanie: lowercase
- `planner.drag.error.recurringCancelledMsg` — en: `"Your repeat event hasn't moved."` / beanie: lowercase
- `planner.drag.error.splitPartialTitle` — en: `"Repeat split saved but new time wasn't"` / beanie: lowercase
- `planner.drag.error.splitPartialMsg` — en: `"The repeat was end-dated but the new occurrence wasn't created. Open the next day to recreate it."` / beanie: lowercase
- `planner.drag.error.badTimeTitle` — en: `"Couldn't read the event's time"` / beanie: lowercase
- `planner.drag.error.badTimeMsg` — en: `"This event has an invalid start or end time. Open it to fix."` / beanie: lowercase

Run `npm run translate` after editing.

#### `package.json`

Add `"interactjs": "^1.10.x"` to `dependencies` (resolve exact latest at install time). Confirm no Vue 3 wrapper crept in.

#### `e2e/specs/planner.spec.ts`

Add ONE test (respects 25-test budget; consolidate if at cap):

- **"drag-to-reschedule shifts stored startTime/endTime"**: open daily view, programmatically drag a timed event 30 min down using **real** mouse events (`page.mouse.down` → wait 350 ms → `move` → `up`). Asserts IndexedDB export shows `startTime`/`endTime` shifted by 30 min. Uses real (un-mocked) interact.js binding — doubles as a contract test against interact.js major-version API breaks. If `hold` proves unreliable under Playwright across runs, fall back to a test-only exposed `commit` handle.

#### `docs/STATUS.md` + `CHANGELOG.md`

- `CHANGELOG.md` under today's `Added`: `Drag and resize timed events directly on the day/week timeline. Long-press on mobile, click-and-drag on desktop. Recurring events ask before applying changes.`
- `docs/STATUS.md`: a short entry referencing the new capability and pointing at the plan / Help Center article (per the end-session ritual convention).

### Persistence flow — non-recurring

```
dragend / resizeend
  → dragMath.computeDragPatch() / computeResizePatch() (try/catch on InvalidTimeError)
  → useEventDrag awaits parent's commit(patch)
    ↳ direct branch: updateActivity(id, patch); assertSaved throws on null
  → useEventDrag catches → showToast('error', ..., { surface: 'calendar-drag', error, context }).
                            showToast auto-reports via reportError.
                            Total Slack messages on failure: 2 (wrapAsync repo error + drag surface).
  → finally → clear transform/classes; reactive store update re-renders card.
```

### Persistence flow — recurring

```
dragend / resizeend
  → dragMath patch computed
  → useEventDrag awaits commit(patch)
    ↳ scope = await chooseScope()
    ↳ null  → showToast('info', recurringCancelled); return { kind: 'cancelled' }
    ↳ 'all' / 'this-only' → RECURRING_SCOPE_HANDLERS dispatch; assertSaved throws on null
    ↳ 'this-and-future' → splitActivity + updateActivity:
       - splitActivity returns null → throw 'splitActivity returned null' (drag-tagged toast)
       - inner updateActivity returns null → showToast(splitPartial); return { kind: 'already-surfaced' }.
         splitActivity already mutated the original (end-dated it); the splitPartial toast text
         tells the user "The repeat was end-dated but the new occurrence wasn't created…".
         Slack noise on this path: 3 (wrapAsync inner repo error + wrapAsync from splitActivity's
         own update + splitPartial drag-tagged toast). Differentiable by surface tag.
  → useEventDrag → 'saved'/'cancelled'/'already-surfaced' clear transform with no extra toast
                   thrown errors → showToast('error', saveFailed, { surface, error, context })
  → finally → clear transform/classes; remove Escape listener.
```

### Visual / haptic / a11y details

- **Grab**: scale(1.02), shadow-md, ring-2 ring-heritage-orange/40. Reduced-motion: scale = 1.0, lighter shadow, no transition.
- **Moving**: above + body cursor `grabbing` (desktop only).
- **Drop**: 200 ms ease-out clearing the transform.
- **Reduced motion**: `useReducedMotion` → reactive class binding (no static `@media` queries depending on initial mount value).
- **Haptic**: 10 ms `hapticTap()` at dragstart and resizestart. No per-snap-tick haptic in Phase 1.
- **Escape**: one-shot `window.keydown` listener bound at gesture start, removed in `finally`. Pressing Escape calls `interact.stop()` and treats the resulting `dragend` as `outcome.kind === 'cancelled'`.

## Files Affected

**New:**

- `src/utils/timeGrid.ts`
- `src/utils/timeSnap.ts`
- `src/utils/haptics.ts`
- `src/utils/__tests__/timeGrid.test.ts`
- `src/utils/__tests__/timeSnap.test.ts`
- `src/composables/dragMath.ts`
- `src/composables/useEventDrag.ts`
- `src/composables/__tests__/dragMath.test.ts`
- `src/composables/__tests__/useEventDrag.test.ts`
- `src/content/help/features/drag-and-resize-events.ts`

**Modified:**

- `src/composables/useCalendarNavigation.ts` (extract code; re-import from `timeGrid.ts`; keep `useTimeGrid` re-export of `ROW_HEIGHT`)
- `src/components/planner/DayTimeline.vue` (bind `useEventDrag` on inline `<button>`, strategy table, visual styles, Escape handler)
- `src/services/translation/uiStrings.ts` (10 entries × 2 namespaces)
- `e2e/specs/planner.spec.ts` (1 new test)
- `package.json` + `package-lock.json`
- `CHANGELOG.md`
- `docs/STATUS.md`

**Explicitly NOT modified** (DRY guard):

- `src/components/planner/ActivityViewEditModal.vue` (already calls shared `chooseScope`)
- `src/composables/useRecurringEditScope.ts` (already the shared chooser)
- `src/composables/useReducedMotion.ts` (already the canonical detector)

## Help Center Coverage

- **Action**: `new article`
- **Category**: `features`
- **Article type**: `how-to`
- **Slug**: `drag-and-resize-events`
- **Title**: Drag and resize events on your day or week view
- **Scope**: How to reschedule and adjust the duration of timed events directly on the day/week timeline — long-press on mobile, click-and-drag on desktop. Top/bottom resize handles, recurring-event scope chooser, accepted overlaps, Escape-to-cancel.
- **Notes**:
  - Month-grid drag is not yet available (coming in a follow-up).
  - Recurring events always ask before applying.
  - Haptic feedback works on Android only.
  - Minimum event duration is 15 minutes.
  - Press Escape during a drag to cancel without saving.

## Acceptance Criteria

- [ ] Timed events drag vertically (daily) and across day columns (weekly) on mouse and touch.
- [ ] Resize from top/bottom edges with 15-min minimum.
- [ ] Long-press ~300 ms required on touch; short tap opens the existing modal.
- [ ] 15-min snap.
- [ ] Overlap on drop accepted; lane-splitter renders side-by-side unchanged.
- [ ] **Escape during drag/resize cancels and restores original position; no toast.**
- [ ] `src/utils/timeGrid.ts` exports `parseMinutes`, `ROW_HEIGHT`, `MIN_CARD_HEIGHT`, `rootFontPx`, `InvalidTimeError`. `useCalendarNavigation.ts` imports from it. `useTimeGrid()` still re-exports `ROW_HEIGHT`.
- [ ] `src/composables/dragMath.ts` has zero imports from `vue`, `@/composables`, or `interactjs` — enforced by a unit test that regex-scans the source.
- [ ] `commit` returns `CommitOutcome` discriminated union; **no string-sentinel error messages** anywhere in the drag pipeline.
- [ ] `commit` dispatch uses `RECURRING_SCOPE_HANDLERS: Record<RecurringEditScope, ...>` (no synthetic `'none'` token); non-recurring is a direct branch.
- [ ] Save failure → one drag-tagged toast via `useToast`; `useToast`'s built-in reporter is the only manual `reportError` for the user-facing surface.
- [ ] Recurring path uses shared `chooseScope()`; `ActivityViewEditModal` not modified.
- [ ] Half-applied split returns `{ kind: 'already-surfaced' }` and `splitPartialMsg` warns the user the original was end-dated.
- [ ] Mount-null guard fires `reportError({ surface: 'calendar-drag-mount-null' })` and skips bind.
- [ ] NaN time → `reportError` + bad-time toast + gesture aborted; `isDragging` is **explicitly set false** in the catch branch (does not rely on `dragend`).
- [ ] `interact().unset()` failure logs to console; teardown succeeds.
- [ ] `navigator.vibrate(10)` fires on Android via `hapticTap`; silent no-op on iOS/desktop.
- [ ] `prefersReducedMotion` disables visual flourishes via reactive class binding (not a static media query).
- [ ] **`hourPx` is sampled from `<html>` root element only** — verified by an inline comment + a unit test that mocks `document.documentElement.fontSize` and `document.body.style.fontSize` and asserts only the former affects the math.
- [ ] **`resizable.margin` is dynamic** — `Math.min(8, cardHeightPx / 3)` per card. Manual test of "drag a 15-min event in default and Large Reading Mode" confirms both drag and resize regions exist.
- [ ] Template refs use function-ref on the inline `<button>` element (no new `EventCard` component).
- [ ] All 10 new translation keys exist in both `en` and `beanie` namespaces; `npm run translate` succeeds.
- [ ] `errorReporter` allowlist permits `activityId`, `start`, `end`, `action` — verified by reading the allowlist config in the same PR.
- [ ] New unit tests pass: `timeGrid`, `timeSnap`, `dragMath`, `useEventDrag`.
- [ ] One new E2E test asserts stored `startTime`/`endTime` shift after a real-mouse-events drag, doubling as an interact.js API contract test.
- [ ] Bundle delta documented in PR; gzipped interactjs ~15–20 KB.
- [ ] Help Center article `drag-and-resize-events` added.
- [ ] `CHANGELOG.md` and `docs/STATUS.md` updated.

## Testing Plan

1. **Local manual — desktop Chrome**: drag/resize on daily & weekly view; verify snap, shadow, ring; simulate failure by stubbing `updateActivity → null`; recurring scope chooser appears; Escape cancels and restores position.
2. **Local manual — Chrome DevTools touch emulation**: 300 ms long-press required; short tap opens modal; mid-drag scroll doesn't pick up the event.
3. **Real device — Android Chrome**: haptic vibrates on grab.
4. **Real device — iOS Safari + iOS PWA + iPad (portrait + landscape)**: drag/resize works visually; no haptic; no console warnings.
5. **Recurring path**: drag a recurring event; verify each `RecurringEditScope` branch persists / restores correctly; verify `null` (cancel) shows info toast.
6. **Half-applied split**: stub inner `updateActivity` to return null AFTER `splitActivity` succeeds. Confirm one `splitPartial` toast (not two); copy explicitly mentions the original was end-dated.
7. **NaN time**: inject an activity with malformed `startTime: "25:99"`. Confirm `reportError` + bad-time toast fire; `isDragging` becomes false without waiting on `dragend`.
8. **Escape mid-drag**: start dragging a card, press Escape; transform clears, no toast, store unchanged.
9. **First-frame reduced motion**: load DayTimeline with `prefers-reduced-motion: reduce`, drag immediately — next animation frame respects the preference.
10. **Large Reading Mode 15-min card**: enable Large Reading Mode, drag a 15-min event — both the drag region (middle) and resize hot-zones (top/bottom) are usable. Test on touch and mouse.
11. **Sync-delete mid-drag**: scope chooser open for a recurring event; delete the activity in another tab. Chooser resolve does not crash; commit returns `{ kind: 'cancelled' }` or throws cleanly.
12. **Unit tests**: `npm run test src/utils/__tests__/timeGrid.test.ts src/utils/__tests__/timeSnap.test.ts src/composables/__tests__/dragMath.test.ts src/composables/__tests__/useEventDrag.test.ts`.
13. **E2E**: `npm run test:e2e:chromium e2e/specs/planner.spec.ts`.
14. **Type check & lint**: `npm run validate`.
15. **Bundle size**: `npm run build`; confirm interactjs ~15–20 KB gzipped.
16. **Slack noise count (post-deploy)**:
    - Non-recurring drag failure: exactly **2** Slack messages (`wrapAsync` repo error + drag-tagged surface).
    - Split-partial drag failure: exactly **3** Slack messages (`wrapAsync` from the failing inner update + `wrapAsync` from `splitActivity`'s update + `splitPartial` drag-tagged toast). Surface tags make them distinguishable in `#beanies-errors`.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted plan — new `useEventDrag` composable wrapping interact.js, new `timeSnap` utility, proposed `useActivityScopeChooser` DRY refactor, persistence via existing `activityStore`, haptic via `navigator.vibrate`, scope limited to DayTimeline.
- **Pass 2 (DRY + error handling)**: Dropped the fabricated `useActivityScopeChooser` — `useRecurringEditScope` already exists with the same API. Reused `useReducedMotion`, `parseMinutes`, `ROW_HEIGHT`. Eliminated `reportError` double-fire by routing all drag errors through `useToast`. Fixed scope-string values. Pinned `splitActivity` name + the `date`-strip pattern. Closed 6 silent-failure gaps. Moved `hapticTap` to `src/utils/haptics.ts`.
- **Pass 3 (Sustainability)**: Replaced `SPLIT_PARTIAL_TOASTED` string-sentinel with a `CommitOutcome` discriminated union. Replaced nested `commit` if/else with a `SCOPE_HANDLERS` strategy table. Split pure math into `dragMath.ts` (zero Vue/DOM/interactjs imports). Relocated `parseMinutes`/`ROW_HEIGHT`/`MIN_CARD_HEIGHT` to `src/utils/timeGrid.ts`. Made `DragPatch` a tagged union ready for Phase 2. Function-ref template-ref pattern. Real-mouse-events E2E as interact.js contract test.
- **Pass 4 (Fresh-eyes sweep)**: Removed nonexistent `<EventCard>` references — bind directly on the inline `<button>` in DayTimeline. Split the strategy table cleanly: `RECURRING_SCOPE_HANDLERS` only (no synthetic `'none'` token), non-recurring as a direct branch. Made `resizable.margin` dynamic (`Math.min(8, cardHeightPx / 3)`) so 15-min cards still have drag region (default zoom and Large Reading Mode). Added Escape-to-cancel keyboard handler. Added Automerge concurrent-merge assumption (transient `endTime < startTime` possible). Fixed Slack noise count for split-partial to 3 (not 2). Explicit `isDragging.value = false` in NaN-time catch since `dragend` is not guaranteed after `draggable(false)`. Updated `splitPartialMsg` copy to mention the original was end-dated. Pinned `hourPx` sampling to `<html>` root only with a test. Added `errorReporter` allowlist verification. Added STATUS.md to modified files. Added iPad real-device test.

## Prompt Log

<details>
<summary>Full prompt history (drag/resize + haptics plan)</summary>

### Initial prompt (frontend-design skill invocation)

> I would like to add the capability to drag and drop items on the calendar, including the ability to stretch and manipulate calendar items on the calendar via desktop or mobile/touch.
>
> This is a natural and intuitive UX and almost an expectation for planning / calendar type apps
>
> What are the most common, well supported, robust, and reliable frameworks/libraries/etc we can use for our vue app to implement drag and drop capability while also keeping the overall app size in mind and trying to avoid bloating the codebase?
>
> Ask me if any questions, and let me know the various options we have to implement this capability.

### Follow-up — haptics

> does the library include haptic feedback as well or does that require additional dependencies?

### Skill invocation

> let's create a plan for drag and drop and haptics as per the above requirements

### Phase-1 clarifying answers (AskUserQuestion)

- Touch activation: **long-press to grab** (300 ms)
- Resize scope: **timed events on day/week timeline only**
- Drop conflicts: **accept overlap** (lane-splitter handles render)
- Rollout: **DayTimeline first, then extend to CalendarGrid in Phase 2**

### User direction at plan finalization

> Save the plan to the repo and DO NOT IMPLEMENT YET - save the plan created and will implement in another session

</details>
