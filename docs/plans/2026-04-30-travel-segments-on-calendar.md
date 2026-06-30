# Plan: Travel segments on the activities calendar

## Context

The Family Planner calendar surfaces (a) per-day activity dots/timed blocks from `activityStore` and (b) multi-day teal vacation bars from `vacationStore`. Travel segments — flights, trains, ferries, cruises — live inside `FamilyVacation.travelSegments[]` but only render on the Travel Plans page today. The user wants those transport events visible on the calendar at their actual departure and arrival times so logistics are scannable from one place. Editing a calendar segment should open the existing `TravelSegmentEditModal` drawer in place (no navigation), and changes should reflect immediately as the underlying data changes.

Confirmed scope (greg, 2026-04-30):

- Eligible types: `flight_outbound`, `flight_return`, `train`, `ferry`, `cruise`. Skip `car` (departure-only) and `activity` (in-vacation outings, not transport).
- Two markers per segment when both sides have a date: one at departure, one at arrival. Render only the side(s) that exist.
- Click → open existing `TravelSegmentEditModal` (BeanieFormModal-based drawer) in place on `FamilyPlannerPage`.
- Visual: same chip shape/size as a normal activity, transport-emoji prefix (✈ 🚆 ⛴ 🚢) + thin teal accent (`var(--vacation-teal)`).
- Pending vs booked: differentiated. Solid 3px left-border (booked) vs dashed 2px outline + reduced opacity + italic (pending).

## Approach

### 1. Data layer — pure helper + thin store wrapper

**Sustainability principle:** the extraction logic is a pure function of `(vacationId, segment, segmentIndex) → TravelSegmentOccurrence[]`. It belongs in `src/utils/vacation.ts` (testable in isolation, no Pinia coupling, no Vue reactivity). The store provides the reactive computed that flat-maps it over the live vacations list.

**Why not put the loop on the store directly?** Lower nesting, easier extension. Adding a new segment type (e.g. `bus`, `helicopter`) is one row in a lookup table, not a new branch in a switch. Adding a new field-shape (e.g. cruise gains a `disembarkationTime`) is one cell in the table.

#### Type (exported from `src/utils/vacation.ts`):

```ts
export type SupportedTravelType =
  'flight_outbound' | 'flight_return' | 'train' | 'ferry' | 'cruise';

export interface TravelSegmentOccurrence {
  vacationId: string;
  segmentIndex: number; // index into FamilyVacation.travelSegments
  segmentId: string; // stable :key for v-for
  transportType: SupportedTravelType;
  kind: 'departure' | 'arrival';
  status: VacationSegmentStatus; // 'booked' | 'pending'
  date: string; // YYYY-MM-DD (local-day, same as activities)
  time?: string; // HH:mm — undefined = untimed/all-day
  title: string; // already auto-built by buildTravelSegmentTitle
}
```

#### Table-driven side definition:

```ts
type SideField = {
  kind: 'departure' | 'arrival';
  dateField: keyof VacationTravelSegment;
  timeField?: keyof VacationTravelSegment;
};

const STD_FLIGHT_RAIL_FERRY_SIDES: SideField[] = [
  { kind: 'departure', dateField: 'departureDate', timeField: 'departureTime' },
  { kind: 'arrival', dateField: 'arrivalDate', timeField: 'arrivalTime' },
];

const SIDE_FIELDS: Record<SupportedTravelType, SideField[]> = {
  flight_outbound: STD_FLIGHT_RAIL_FERRY_SIDES,
  flight_return: STD_FLIGHT_RAIL_FERRY_SIDES,
  train: STD_FLIGHT_RAIL_FERRY_SIDES,
  ferry: STD_FLIGHT_RAIL_FERRY_SIDES,
  cruise: [
    { kind: 'departure', dateField: 'embarkationDate', timeField: 'embarkationTime' },
    { kind: 'arrival', dateField: 'disembarkationDate' /* schema has no time field */ },
  ],
};

export function isSupportedTravelType(t: VacationTravelType): t is SupportedTravelType {
  return t in SIDE_FIELDS;
}
```

#### Pure extraction helper:

```ts
export function extractSegmentOccurrences(
  vacationId: string,
  seg: VacationTravelSegment,
  segmentIndex: number
): TravelSegmentOccurrence[] {
  if (!isSupportedTravelType(seg.type)) return [];
  const out: TravelSegmentOccurrence[] = [];
  for (const side of SIDE_FIELDS[seg.type]) {
    const date = seg[side.dateField] as string | undefined;
    if (!date) continue;
    const d = extractDatePart(date);
    if (!isValidISODate(d)) {
      console.warn(
        `[vacation] segment ${seg.id} has invalid ${side.kind} date "${date}" — skipping that side`
      );
      continue;
    }
    const time = side.timeField ? (seg[side.timeField] as string | undefined) : undefined;
    out.push({
      vacationId,
      segmentIndex,
      segmentId: seg.id,
      transportType: seg.type,
      kind: side.kind,
      status: seg.status,
      date: d,
      time: time || undefined,
      title: seg.title,
    });
  }
  return out;
}
```

Pure, easily unit-tested without store mocks, no Vue/Pinia imports.

#### Store wrapper (in `src/stores/vacationStore.ts`):

```ts
const allTravelSegmentOccurrences = computed<TravelSegmentOccurrence[]>(() =>
  vacations.value.flatMap((v) =>
    v.travelSegments.flatMap((seg, idx) => safeExtract(v.id, seg, idx))
  )
);

function safeExtract(
  vacationId: string,
  seg: VacationTravelSegment,
  idx: number
): TravelSegmentOccurrence[] {
  try {
    return extractSegmentOccurrences(vacationId, seg, idx);
  } catch (err) {
    console.error(
      `[vacationStore] failed to extract occurrences for segment ${seg.id ?? '<no id>'} on vacation ${vacationId}:`,
      err
    );
    return [];
  }
}

function travelSegmentOccurrencesInRange(startISO: string, endISO: string) {
  return allTravelSegmentOccurrences.value.filter((o) => o.date >= startISO && o.date <= endISO);
}
```

`safeExtract` is the integration boundary: pure function in / safe-on-error out. Two-level nesting max. Computed is a pure expression. Store stays thin — orchestration only.

Export `allTravelSegmentOccurrences` and `travelSegmentOccurrencesInRange` from the store; export `extractSegmentOccurrences`, `isSupportedTravelType`, `SupportedTravelType`, and `TravelSegmentOccurrence` from `src/utils/vacation.ts`.

### 2. Shared chip component (DRY win)

The full-size chip markup (emoji + title + optional time + booked/pending styling + click handler) renders in 6 places: week timed, week untimed all-day row, day timed, day untimed, DayTimeline timed, DayTimeline untimed. Extracting prevents duplication and makes visual changes a single edit.

**New component:** `src/components/planner/TravelSegmentChip.vue`

```ts
interface Props {
  occurrence: TravelSegmentOccurrence;
}
defineEmits<{ click: [vacationId: string, segmentIndex: number] }>();
```

Renders the chip with teal accent, transport emoji prefix (via shared helper, see §3), title, optional time. `@click.stop` on the chip element bubbles up `view-segment` via the consuming view. Single source of truth for booked-vs-pending styles.

**Month view does NOT use this component.** Month chips are intentionally smaller (8px text, no title — emoji + time only) and live alongside dot-style activity indicators. Two visual modes shoehorned into one component would force conditional internal layout. Month inlines its own compact chip with the same teal/dashed CSS variables — the divergence is small (~10 lines) and stays readable.

### 3. Shared helpers in `src/utils/vacation.ts`

Two small pure helpers that consolidate duplication across the calendar views and the chip component:

```ts
const TRANSPORT_EMOJI: Record<SupportedTravelType, string> = {
  flight_outbound: '✈',
  flight_return: '✈',
  train: '🚆',
  ferry: '⛴',
  cruise: '🚢',
};
export function transportEmoji(type: SupportedTravelType): string {
  return TRANSPORT_EMOJI[type] ?? '';
}

/** Bucket a list by whether each item has a time. Used by week/day/DayTimeline. */
export function splitTimedUntimed<T extends { time?: string }>(
  items: T[]
): { timed: T[]; untimed: T[] } {
  const timed: T[] = [];
  const untimed: T[] = [];
  for (const o of items) (o.time ? timed : untimed).push(o);
  return { timed, untimed };
}
```

Both pure, no allocations, single import. Generic `splitTimedUntimed<T>` keeps it reusable for future shapes.

**Sustainability follow-up (not a blocker now):** `src/utils/vacation.ts` is the catch-all for vacation/travel utilities. After this PR adds `transportEmoji`, `splitTimedUntimed`, `extractSegmentOccurrences`, `SIDE_FIELDS`, `isSupportedTravelType`, and types — if the file crosses ~600 lines or becomes hard to navigate, split travel-segment helpers into `src/utils/travelSegments.ts` in a focused follow-up. Don't pre-split — keeps consistency with current convention (`buildTravelSegmentTitle` already lives in vacation.ts).

### 4. Calendar view changes (3 views + mobile DayTimeline)

All three views compute their visible-range segments via `vacationStore.travelSegmentOccurrencesInRange(start, end)` and emit a new `view-segment(vacationId, segmentIndex)` event. Travel-segment occurrences are a parallel render path from `monthActivities` — no double-counting, no impact on the existing `!occ.activity.vacationId` filter (which excludes vacation-linked activities; segments don't go through it).

**Month view (`CalendarGrid.vue`):**
Build a `dateSegments` Map alongside `dateActivities` / `dateVacations` in the existing `calendarDays` computed. Render between activity dots and vacation bars. Compact inline chip (emoji + time only), max 2 visible per cell with a `+N` overflow indicator. No `<TravelSegmentChip>` (different size mode).

**Week view (`WeeklyCalendarView.vue`):**

- `weekSegments` = `travelSegmentOccurrencesInRange(weekDays[0].dateStr, weekDays[6].dateStr)` (computed)
- Use `splitTimedUntimed(weekSegments.value)` (new util — see DRY block below) to bucket once
- Untimed segments → all-day row alongside `vacationSpans`, using `<TravelSegmentChip>`
- Timed segments → positioned blocks via `useTimeGrid.getPosition(time, addHourToTime(time))` inside day columns, using `<TravelSegmentChip>`
- **Decoupling rule:** do NOT widen `useTimeGrid`'s contract. The composable consumes a generic `Array<{ startTime, endTime }>`. Caller-side, build a single union (activities + segment-as-1h-block) and pass it in. Keeps `useTimeGrid` agnostic to segments.
- Update `hasAnyUntimedContent` to also consider untimed segments (single OR clause, no new branching)

**Day view (`DailyCalendarView.vue`):**
Same two paths. Segments span all visible-member columns (`gridColumn: '2 / span ${visibleMembers.length}'`) — segments aren't member-scoped, matches vacation-bar convention.

**Mobile (`DayTimeline.vue`):**
Add `segments: TravelSegmentOccurrence[]` prop + `view-segment` emit. Day/Week mobile branches pass the day's segments in. Renders via `<TravelSegmentChip>` (same component as desktop, no fork).

**Cross-day overnight (e.g. flight 22:00 → 02:30 next day):** departure occurrence on day 1 at 22:00, arrival occurrence on day 2 at 02:30. Both filter into their own day buckets — no spanning bar needed, naturally correct.

**Cross-month:** each view filters by its own visible window; if departure is in June and arrival is July 1, June shows the departure chip, July shows the arrival chip.

**Known limitation (documented, not fixed):** if two timed segments share the exact same time on the same day, they stack in render order without overlap-resolution. Activities solve this via `groupOverlapping` in week/day views; segments use a 1-hour synthetic block which is rare to collide. If this surfaces in practice, fold segments into the activity overlap calculation in a follow-up. Same approach as the existing `groupOverlapping` helper.

### 5. Visual treatment

Same chip footprint as activity blocks. CSS uses `var(--vacation-teal)` only.

| State   | Border                                                 | Background             | Text                                        |
| ------- | ------------------------------------------------------ | ---------------------- | ------------------------------------------- |
| Booked  | `border-l-[3px] border-[var(--vacation-teal)]`         | `rgba(0,180,216,0.10)` | `var(--color-text)`, normal weight          |
| Pending | `border-2 border-dashed border-[var(--vacation-teal)]` | `rgba(0,180,216,0.05)` | `var(--color-text)`, `opacity-70`, `italic` |

Departure vs arrival distinguished entirely by the time displayed and (in week/day views) the title — no separate icon variants. The transport emoji is prefixed in the title slot: `{{ transportEmoji(occ.transportType) }} {{ occ.title }}`. Calendar must not get visually busier — this is the rule.

### 6. Edit chain on `FamilyPlannerPage`

Mount `TravelSegmentEditModal` directly on the planner page (already self-contained — reads `useVacationStore`, self-saves via `vacationStore.updateVacation`, no parent assumptions). The component is `BeanieFormModal`-based with `variant="drawer"` — slides in as a drawer per greg's wording.

**Single object ref** (DRY — replaces the two-ref version):

```ts
import TravelSegmentEditModal from '@/components/travel/TravelSegmentEditModal.vue';
import { showToast } from '@/composables/useToast';

const editingSegment = ref<{ vacationId: string; segmentIndex: number } | null>(null);
const editingSegmentValue = computed(() => {
  if (!editingSegment.value) return undefined;
  return vacationStore.getVacationById(editingSegment.value.vacationId)?.travelSegments[
    editingSegment.value.segmentIndex
  ];
});
```

**Two small extracted helpers** to keep `handleViewSegment` shallow and the no-silent-failures policy explicit:

```ts
function reportSegmentNotFound(reason: string) {
  console.error(`[FamilyPlannerPage] ${reason}`);
  showToast('error', t('errors.travelSegmentNotFound.title'), {
    help: t('errors.travelSegmentNotFound.help'),
  });
}

function handleViewSegment(vacationId: string, segmentIndex: number) {
  const v = vacationStore.getVacationById(vacationId);
  if (!v) return reportSegmentNotFound(`vacation ${vacationId} not found`);
  if (segmentIndex < 0 || segmentIndex >= v.travelSegments.length) {
    return reportSegmentNotFound(
      `segment index ${segmentIndex} out of bounds (${v.travelSegments.length}) on vacation ${vacationId}`
    );
  }
  editingSegment.value = { vacationId, segmentIndex };
}
function closeSegmentModal() {
  editingSegment.value = null;
}
```

Linear control flow, no nested ifs, single error path.

**Vanish-mid-edit defense** (concurrent merge / removal while modal is open). If `editingSegmentValue` was previously resolved and becomes `undefined` while the modal is open, close the modal and surface a warning toast — never silently let the modal drop into empty-form mode:

```ts
watch(editingSegmentValue, (next, prev) => {
  if (prev && !next && editingSegment.value) {
    console.warn(
      `[FamilyPlannerPage] segment vanished mid-edit (vacation ${editingSegment.value.vacationId}, idx ${editingSegment.value.segmentIndex}) — closing modal`
    );
    showToast('warning', t('errors.travelSegmentVanished.title'), {
      help: t('errors.travelSegmentVanished.help'),
    });
    editingSegment.value = null;
  }
});
```

Wire `@view-segment="handleViewSegment"` on all three views; mount the modal alongside `ActivityViewEditModal`. Reactive `editingSegmentValue` re-resolves automatically when the underlying segment is edited mid-session (Pinia/Automerge reactivity). A successful edit triggers `vacationStore.updateVacation` inside the modal — no plumbing on the planner page.

**Known caveat (inherited, not introduced):** `TravelSegmentEditModal` identifies its target segment by `segmentIndex`. If a concurrent Automerge merge from another device reorders the `travelSegments` array mid-session, the modal would point at a different segment. This caveat already exists on `TravelPlansPage` and isn't unique to this PR. Refactoring the modal to identify by `segmentId` is the long-term sustainability fix — flagged here, out of scope. The vanish-mid-edit watch above mitigates the worst case (segment removed) but not the reorder case.

### 7. i18n

Four new error keys in `src/services/translation/uiStrings.ts` (en + beanie variants per project rule):

```ts
'errors.travelSegmentNotFound.title': {
  en: "We couldn't open that travel segment",
  beanie: "couldn't open that travel segment",
},
'errors.travelSegmentNotFound.help': {
  en: 'It may have just been removed. Try refreshing the calendar.',
  beanie: 'it may have just been removed. try refreshing the calendar.',
},
'errors.travelSegmentVanished.title': {
  en: 'That travel segment was just removed',
  beanie: 'that travel segment was just removed',
},
'errors.travelSegmentVanished.help': {
  en: 'Someone in your family deleted it on another device. We closed the editor.',
  beanie: 'someone in your family deleted it on another device. we closed the editor.',
},
```

Run `npm run translate` to regenerate `public/translations/zh.json`. No keys for the chips themselves — segment titles are already auto-built via `buildTravelSegmentTitle`, and the modal owns its own keys.

### 8. Tests

**Unit (`src/utils/__tests__/vacation.test.ts` — new `describe('extractSegmentOccurrences')`)** — pure helper, no store mocks needed:

1. Booked outbound flight, both sides → 2 occurrences with correct dates/times/transportType.
2. Departure-only segment → only kind='departure'.
3. Cruise → embarkation as kind='departure' with time, disembarkation as kind='arrival' with `time: undefined`.
4. Pending segment → status='pending' propagates.
5. Multi-day overnight (different departure/arrival dates) → two occurrences on different days.
6. Skipped types (`car`, `activity`, anything else) → 0 occurrences.
7. Malformed date → logs `[vacation]`, skips that side, doesn't throw.
8. Missing date entirely → 0 occurrences for that side.

**Unit (`src/stores/vacationStore.test.ts`)** — new `describe('travelSegmentOccurrences')` — store integration:

1. Empty vacations → empty result.
2. `travelSegmentOccurrencesInRange` filters to the visible window (out-of-range segment excluded).
3. Cross-month segment filters into the matching month only.
4. **Defensive: `safeExtract` swallows thrown errors** — corrupt segment that throws on access logs `[vacationStore]` and returns []; other segments in same vacation still emit correctly. Spy `console.error`.
5. `splitTimedUntimed` correctly buckets a mixed list (covered in vacation.test.ts).

**Component (`src/components/planner/__tests__/CalendarGrid.test.ts`)**: stubbed vacationStore with one booked flight outbound; assert chip renders with ✈ + time in correct cell; click → `view-segment` event with correct args.

**Component (`src/pages/__tests__/FamilyPlannerPage.test.ts` — extend existing if present, else new)**:

- Assert error toast fires on `handleViewSegment('bogus-id', 0)` (vacation not found) with no silent failure.
- Assert error toast fires on `handleViewSegment(validId, 99)` (index out of bounds).
- Assert vanish-mid-edit watch closes modal + fires warning toast when segment is removed from store while editing.

**E2E**: skip per ADR-007 Three-Gate Filter — visualization-only feature, not a critical user journey. Pure-function unit tests + store integration tests + component tests cover all data + wiring + error paths.

### Files affected

**Modified:**

- `src/utils/vacation.ts` — types (`SupportedTravelType`, `TravelSegmentOccurrence`), `SIDE_FIELDS` table, `isSupportedTravelType`, `extractSegmentOccurrences`, `transportEmoji`, `splitTimedUntimed`
- `src/stores/vacationStore.ts` — `allTravelSegmentOccurrences` computed, `safeExtract`, `travelSegmentOccurrencesInRange`
- `src/stores/vacationStore.test.ts` — store integration tests (5 cases)
- `src/pages/FamilyPlannerPage.vue` — modal mount + `editingSegment` ref + `handleViewSegment` + `reportSegmentNotFound` helper + vanish-mid-edit watch
- `src/components/planner/CalendarGrid.vue` — inline compact chip + emit
- `src/components/planner/WeeklyCalendarView.vue` — `<TravelSegmentChip>` placement (timed + untimed) + emit + caller-side time-grid union
- `src/components/planner/DailyCalendarView.vue` — `<TravelSegmentChip>` placement (timed + untimed) + emit
- `src/components/planner/DayTimeline.vue` — `segments` prop + emit (mobile)
- `src/services/translation/uiStrings.ts` — 4 new error keys
- `public/translations/zh.json` — regenerated via `npm run translate`

**Created:**

- `src/components/planner/TravelSegmentChip.vue` — shared chip used by week/day/DayTimeline (full-size mode)
- `src/utils/__tests__/vacation.test.ts` — pure-helper tests (8 cases for `extractSegmentOccurrences` + cases for `splitTimedUntimed` and `transportEmoji`); extend existing file if present
- `src/components/planner/__tests__/CalendarGrid.test.ts` — chip render + click test
- `src/pages/__tests__/FamilyPlannerPage.test.ts` — error-toast tests + vanish-mid-edit test (extend existing if present)

**Reused unchanged:**

- `src/components/travel/TravelSegmentEditModal.vue` — already self-contained, mounts cleanly outside `TravelPlansPage`
- `src/utils/date.ts` (`extractDatePart`, `formatTime12`, `addHourToTime`)
- `src/utils/vacation.ts` existing exports (`isValidISODate`, `buildTravelSegmentTitle`, etc — additions sit alongside)
- `src/composables/useToast.ts` (`showToast` for error surfacing)
- `src/composables/useTimeGrid.ts` — contract unchanged; caller-side union

### Implementation order

1. **Pure helpers in `src/utils/vacation.ts`**: types, `SIDE_FIELDS`, `isSupportedTravelType`, `extractSegmentOccurrences`, `transportEmoji`, `splitTimedUntimed`. Write all helper unit tests (8 + small ones for split/emoji). No UI changes yet — purely data layer.
2. **Store wrapper in `vacationStore.ts`**: `allTravelSegmentOccurrences` + `safeExtract` + `travelSegmentOccurrencesInRange`. Write 5 store integration tests including the corrupt-segment safety case.
3. **i18n: add 4 error keys; regenerate `zh.json`** via `npm run translate`.
4. **Mount modal on `FamilyPlannerPage`**: `editingSegment` ref, `handleViewSegment`, `reportSegmentNotFound`, vanish-mid-edit watch. Write component tests for both error paths + watch.
5. **Build `TravelSegmentChip.vue`** (full-size, used by week/day/DayTimeline).
6. **Wire month view** (`CalendarGrid.vue`) — compact inline chip + emit. Write component test for chip render + click.
7. **Wire week view** (`WeeklyCalendarView.vue`) — `<TravelSegmentChip>` for timed + untimed + caller-side time-grid union.
8. **Wire day view** (`DailyCalendarView.vue`) — `<TravelSegmentChip>` placement + `DayTimeline` propagation.

Each step compiles + passes tests independently. After step 2 the data is queryable but invisible (no UI). After step 4 the modal infra works (no callers). After step 6 the smallest visual surface is live. Steps 7+8 add the remaining views. No big-bang dependencies.

## Verification

- **Type-check + lint**: `npm run type-check && npm run lint` clean after each step.
- **Unit tests**: `npm run test:unit -- vacationStore` for the data layer; `npm run test:unit -- CalendarGrid FamilyPlannerPage` for components.
- **Translation pipeline**: `npm run translate` regenerates `zh.json` cleanly with the 2 new keys.
- **Dev smoke walk-through**: `npm run dev`, create a vacation with at least one flight (real departure + arrival times spanning multiple days), one train, one cruise, one pending segment. Verify:
  - Month view: chips appear on correct days with correct emoji + time, max 2 + overflow.
  - Week view: timed flight at 22:00 expands the hour grid; arrival on next day at 02:30 also visible.
  - Day view: segments span all member columns, untimed cruise disembark in all-day row.
  - Click any chip → `TravelSegmentEditModal` drawer opens with correct segment.
  - Edit + save → calendar updates immediately (Pinia reactivity).
  - Pending segment shows dashed outline + italic. Booked shows solid left border.
  - Mobile DayTimeline (DevTools 375px): same rendering on mobile day view.
  - Beanie mode + Chinese: error toast wording renders correctly.
- **Error-path smoke**: artificially trigger `handleViewSegment('bogus-id', 0)` from devtools console → toast fires with help text, console error logged.
- **Project rules compliance**: zero hardcoded English in templates (all strings via `t()` or already auto-built); zero bare `catch`; six-level type scale only; `var(--vacation-teal)` for all teal references; no `text-[X.Xrem]` custom sizes.
- **Save plan**: copy this file to `docs/plans/2026-04-30-travel-segments-on-calendar.md` per CLAUDE.md convention before implementation begins.
