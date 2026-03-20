# Plan: Family Vacation Planner

> Date: 2026-03-20
> Related: docs/mockups/family-vacation-planner.html (9-screen mockup)

## Context

Parents want to capture family vacation plans with all relevant details (flights, hotels, cruises, rental cars, ideas) in a collaborative, fun way. A 9-screen HTML mockup has been refined through 7 iterations. This plan also moves the one-time/recurring toggle to the top of ActivityModal for better visibility.

## Design Principles

- **Separate entity, linked to activity**: `FamilyVacation` stores rich data; a paired `FamilyActivity` provides the calendar entry (all-day, date range). Keeps the 40+ field FamilyActivity clean.
- **Vacation Teal `#00B4D8` + Gold `#FFD93D`**: Approved as feature-specific accent colors (precedent: purple for to-do).
- **Maximize reuse**: Every existing component, composable, and utility is leveraged before creating anything new.
- **Filter vacation-linked activities**: Activities with `vacationId` are excluded from regular displays (upcoming list, calendar dots, day agenda) to avoid duplicate rendering. They appear only as vacation bars and sidebar cards.
- **Cascade safety**: Vacation-linked activities cannot be deleted independently — deletion goes through `vacationStore.deleteVacation()` which removes both. `ActivityViewEditModal` detects `vacationId` and redirects to `VacationViewModal`.
- **Backward compatibility**: Adding `vacations` to FamilyDocument requires no file format version bump. Automerge handles missing collections gracefully on existing `.beanpod` files — the field initializes on first mutation.

## Existing Code Reuse Map

| Existing                                                                                          | Path                                                    | Reuse For                                    |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------- |
| `useClipboard`                                                                                    | `src/composables/useClipboard.ts`                       | Tap-to-copy booking refs in view modal       |
| `useFormModal`                                                                                    | `src/composables/useFormModal.ts`                       | Edit/new detection in wizard                 |
| `useConfirm`                                                                                      | `src/composables/useConfirm.ts`                         | Delete vacation confirmation                 |
| `CreatedConfirmModal`                                                                             | `src/components/ui/CreatedConfirmModal.vue`             | Vacation celebration (pass vacation details) |
| `ConditionalSection`                                                                              | `src/components/ui/ConditionalSection.vue`              | Pattern reference for collapse animation     |
| `FamilyChipPicker`                                                                                | `src/components/ui/FamilyChipPicker.vue`                | "Who's going" in wizard step 1               |
| `TogglePillGroup`                                                                                 | `src/components/ui/TogglePillGroup.vue`                 | Schedule tab bar, fee/cost selectors         |
| `FrequencyChips`                                                                                  | `src/components/ui/FrequencyChips.vue`                  | Duration pills, category pills               |
| `FormFieldGroup`                                                                                  | `src/components/ui/FormFieldGroup.vue`                  | All form field labels                        |
| `BaseInput`                                                                                       | `src/components/ui/BaseInput.vue`                       | All text/date inputs                         |
| `ToggleSwitch`                                                                                    | `src/components/ui/ToggleSwitch.vue`                    | Vacation toggle                              |
| `BeanieFormModal`                                                                                 | `src/components/ui/BeanieFormModal.vue`                 | Wizard modal wrapper                         |
| `BaseModal`                                                                                       | `src/components/ui/BaseModal.vue`                       | View modal (custom hero header)              |
| `createAutomergeRepository`                                                                       | `src/services/automerge/automergeRepository.ts`         | Vacation CRUD repository                     |
| `wrapAsync`                                                                                       | `src/stores/helpers`                                    | Store action error handling                  |
| `parseLocalDate`, `addDays`, `isDateBetween`, `formatNookDate`, `extractDatePart`, `formatTime12` | `src/utils/date.ts`                                     | All date operations                          |
| `generateId`                                                                                      | `src/utils/id.ts`                                       | Segment/idea UUIDs                           |
| Spanning bar logic                                                                                | `src/components/planner/WeeklyCalendarView.vue:147-192` | Calendar vacation bars                       |

---

## Milestone 1: Data Foundation

### 1.1 Types — `src/types/models.ts` (after line ~447)

Add `vacationId?: UUID` to `FamilyActivity` interface (line ~383).

New types (consolidated — one status type shared across all segments):

```typescript
type VacationTripType = 'fly_and_stay' | 'cruise' | 'road_trip' | 'combo' | 'camping' | 'adventure';
type VacationSegmentStatus = 'booked' | 'pending' | 'not_booked' | 'researching';
type VacationIdeaCategory = 'beach' | 'activity' | 'food' | 'sightseeing' | 'shopping' | 'nightlife';

interface VacationTravelSegment { id, type, title, status, sortDate?, bookingReference?, notes?,
  // Flight: airline?, flightNumber?, departureAirport?, arrivalAirport?, departureDate?, departureTime?, arrivalDate?, arrivalTime?
  // Cruise: cruiseLine?, shipName?, departurePort?, cabinNumber?, embarkationDate?, disembarkationDate?
  // Train/Ferry: operator?, route?, departureStation?, arrivalStation? }

interface VacationAccommodation { id, type, title, status,
  name?, address?, checkInDate?, checkOutDate?, confirmationNumber?, roomType?, contactPhone?, notes? }

interface VacationTransportation { id, type, title, status,
  bookingReference?, pickupDate?, pickupTime?, returnDate?, notes? }

interface VacationIdeaVote { memberId, votedAt }
interface VacationIdea { id, title, description?, category?, location?, suggestedDate?,
  estimatedCost?, costType?, duration?, needsBooking?, notes?, votes[], createdBy, createdAt }

interface FamilyVacation { id, activityId, name, tripType, assigneeIds[],
  travelSegments[], accommodations[], transportation[], ideas[],
  startDate?, endDate?, createdBy, createdAt, updatedAt }
// + Create/Update Omit types
```

### 1.2 Automerge registration

- **`src/types/automerge.ts`**: Add `vacations: Record<string, FamilyVacation>` to `FamilyDocument`
- **`src/services/automerge/docService.ts`**: Add `vacations: {}` to `initDoc()` (~line 50)

### 1.3 Repository — NEW `src/services/automerge/repositories/vacationRepository.ts`

Exact same pattern as `activityRepository.ts`: `createAutomergeRepository<'vacations', ...>('vacations')`. Export via `index.ts`.

### 1.4 Store — NEW `src/stores/vacationStore.ts`

Pinia composition API (same pattern as `activityStore.ts`):

- **State:** `vacations`, `isLoading`, `error`
- **Getters:** `upcomingVacations` (future, sorted), `vacationByActivityId` (computed Map for O(1) lookup), `getVacationById`
- **Actions:**
  - `createVacation(input)` — create vacation + linked FamilyActivity (recurrence='none', isAllDay=true, category='other', icon='✈️'), set bidirectional IDs via `vacationId` on activity and `activityId` on vacation
  - `updateVacation(id, input)` — update + sync linked activity date/endDate from `computeVacationDates()`
  - `deleteVacation(id)` — delete both vacation AND linked activity (single atomic operation)
  - `toggleIdeaVote(vacationId, ideaId, memberId)` — add/remove from votes array
- Derive `startDate`/`endDate` from segments on every create/update using `computeVacationDates()` (pure function, see 1.5)

### 1.4b Activity display filtering — `src/stores/activityStore.ts`

- Add `isVacationLinked(activity)` helper: `return !!activity.vacationId`
- In `upcomingActivities` getter: filter out vacation-linked activities (they appear as sidebar cards, not activity list items)
- In `activitiesForDate(dateStr)`: optionally exclude vacation-linked activities (caller decides via parameter)
- In `deleteActivity`: if activity has `vacationId`, prevent standalone deletion — throw error or redirect to vacation deletion. This prevents orphaned vacations.

### 1.5 Utility functions — NEW `src/utils/vacation.ts`

Pure functions (not a composable — no reactive state needed):

```typescript
computeVacationDates(v: FamilyVacation): { startDate?: string; endDate?: string }
  // Scans all travelSegments (departureDate, embarkationDate), accommodations (checkInDate, checkOutDate),
  // transportation (pickupDate, returnDate) — returns earliest start, latest end

bookingProgress(v: FamilyVacation): { booked: number; total: number; percent: number }
  // Counts items with status !== 'not_booked' across all three arrays

daysUntilTrip(startDate: string): number
  // Uses parseLocalDate from date.ts, returns days from today

tripDurationDays(start: string, end: string): number
  // Difference in days + 1 (inclusive)
```

Add `daysBetween(a: string, b: string): number` to `src/utils/date.ts` (reusable utility, not vacation-specific).

### 1.6 CSS variables — `src/style.css`

```css
--vacation-teal: #00b4d8;
--vacation-teal-tint: rgba(0, 180, 216, 0.08);
--vacation-teal-15: rgba(0, 180, 216, 0.15);
--vacation-gold: #ffd93d;
--vacation-gold-tint: rgba(255, 217, 61, 0.12);
```

### 1.7 Translation strings — `src/services/translation/uiStrings.ts`

Add `vacation.*` namespace (~80-100 pairs with `en` + `beanie` values). Groups: wizard steps, trip types, statuses, form labels, view modal, sidebar, celebration.

**Commit: "feat(vacation): data model, store, repository, utilities, and translations"**

---

## Milestone 2: ActivityModal Enhancement

### 2.1 Move recurring/one-off toggle to top — `src/components/planner/ActivityModal.vue`

Move from lines 467-482 (Section 4 "Schedule" FormFieldGroup) to just below the "Who's going" section (after line 389), before category picker.

Replace `TogglePillGroup` with a **segmented tab bar** — two card-style buttons in a rounded container:

- 🔁 **recurring** (small description: "repeats weekly or monthly")
- 📌 **one-time** (small description: "happens once")

Style: `bg-[var(--tint-slate-5)]` container with `rounded-2xl` `p-1.5`, buttons with `rounded-xl` padding, active button: white bg + Heritage Orange `border-2` + small orange dot below label. Visually distinct from the vacation toggle (which uses teal + toggle switch).

Keep frequency chips (weekly/monthly) + DayOfWeekSelector in their current position below dates (only shown when recurring selected).

### 2.2 Add vacation toggle — `src/components/planner/ActivityModal.vue`

Below the schedule tab bar (only when `recurrenceMode === 'one-off'` AND not editing):

```html
<!-- Vacation toggle banner -->
<div class="vacation-toggle" @click="toggleVacation">
  <span class="sway-emoji">🏖️</span>
  <div>
    <span class="teal-label">{{ t('vacation.planningATrip') }}</span>
    <small>{{ t('vacation.planningSubtitle') }}</small>
  </div>
  <ToggleSwitch v-model="isVacation" />
</div>
```

Style: `linear-gradient(135deg, rgba(0,180,216,0.06), rgba(255,217,61,0.06))` background, teal bottom border, `@keyframes sway` on emoji (-3° to 3° rotation).

When toggled on: emit `start-vacation-wizard` with `{ assigneeIds, date }` and close.

### 2.3 Wire up in planner page — `src/pages/FamilyPlannerPage.vue`

Handle `@start-vacation-wizard` from ActivityModal → close activity modal, open VacationWizard with passed defaults.

**Commit: "feat(vacation): schedule tab bar and vacation toggle in ActivityModal"**

---

## Milestone 3: Vacation Wizard

### 3.1 Extend modal sizing — `src/components/ui/BaseModal.vue` + `BeanieFormModal.vue`

- **BaseModal** (~line 32): Add `'3xl': 'max-w-3xl'` to sizeClasses
- **BeanieFormModal** (~line 10): Add `'wide'` to size prop → maps to `'2xl'`. Add `'teal'` to saveGradient → gradient class `from-[#00B4D8] to-[#0096B7]`

### 3.2 Wizard container — NEW `src/components/vacation/VacationWizard.vue`

Uses `BeanieFormModal` with `size="wide"`, `save-gradient="teal"`, `icon="✈️"`, `icon-bg="var(--vacation-teal-tint)"`.

**Props:** `open`, `vacation?: FamilyVacation`, `editStep?: number`, `defaultAssigneeIds?`, `defaultDate?`
**Emits:** `close`, `saved(vacation)`

**State:** `currentStep` (1-5), all vacation data as refs. On save → `vacationStore.createVacation()` / `.updateVacation()`, then show `CreatedConfirmModal` with vacation summary details.

**Footer:** Dynamic — "← back" (step > 1) + "next: [step name] →" / "🎉 save vacation!" (step 5). Save button uses teal gradient.

**Step validation:** Each step validates before allowing "Next":

- Step 1: name required, tripType required, at least 1 assignee
- Steps 2-4: no required fields (segments are optional — user marks them "not booked yet")
- Step 5: no required fields (ideas are optional)
- Show validation errors inline (same orange highlight pattern as ActivityModal's `showErrors` ref)

**Wizard progress bar** (inline, ~20 lines of template): 5 numbered dots with labels, connected by lines. Done=green ✓, current=teal gradient, future=gray.

**Edit mode:** When `vacation` prop provided, populate all refs from vacation data. When `editStep` provided, jump directly to that step (for "edit in wizard → section" links from view modal).

### 3.3 Step 1: Trip Type — NEW `src/components/vacation/VacationStep1.vue`

- Step header: 🗺️ "where are the beans going?"
- Vacation name: `BaseInput` with teal focus ring
- Trip type: 3×2 grid of selection cards (✈️ fly & stay, 🚢 cruise, 🚗 road trip, 🎒 combo, 🏕️ camping, 🏔️ adventure). Each card: emoji + name + description. Selected: teal border + tint + ✓ badge. Custom inline — EmojiPicker lacks description support and this is a one-use pattern.
- Who's going: `FamilyChipPicker` (reused directly)

### 3.4 Step 2: Travel — NEW `src/components/vacation/VacationStep2.vue`

- Step header: ✈️ "how are we getting there?"
- List of `VacationSegmentCard` components sorted by `sortDate`
- Type-dependent fields rendered inside each card based on segment type
- Add segment pills: "+ ✈️ flight", "+ 🚢 cruise", "+ 🚂 train", "+ ⛴️ ferry"
- Not-booked segments: dashed border + gold tint + reminder text

### 3.5 Step 3: Accommodation — NEW `src/components/vacation/VacationStep3.vue`

- Step header: 🏨 "pillow fort HQ"
- Add-on type pills at top: 🏨 hotel, 🏠 airbnb, 🏕️ campground, 👨‍👩‍👧 family/friends
- Selecting a pill adds a new item; deselecting removes it (with confirm if has data)
- `VacationSegmentCard` per item with accommodation-specific fields

### 3.6 Step 4: Getting Around — NEW `src/components/vacation/VacationStep4.vue`

- Step header: 🚕 "bean transportation dept."
- Same pill-selector pattern as Step 3: 🚐 shuttle, 🚗 rental, 🚕 taxi, 🚂 train, 🚌 bus
- `VacationSegmentCard` per item with transportation-specific fields

### 3.7 Step 5: Ideas — NEW `src/components/vacation/VacationStep5.vue`

- Step header: 🌟 "bean bucket list!"
- Quick-add row: `BaseInput` + teal "+" button
- `VacationIdeaCard` list with inline-expandable detail editor
- Voting via heart toggle (calls store `toggleIdeaVote`)

### 3.8 Shared: VacationSegmentCard — NEW `src/components/vacation/VacationSegmentCard.vue`

**Used in:** Wizard steps 2-4 (edit mode) AND view modal timeline (read-only mode). Single component, two modes.

**Props:** `icon`, `title` (v-model, editable), `subtitle?`, `status`, `keyValue?` (collapsed summary), `collapsed` (v-model), `readOnly?`, `deletable?`

- **Header:** icon + editable title (or plain text in readOnly) + key-value summary + status badge + chevron
- **Body:** `<slot>` for type-specific fields. Collapse animation via `max-h` transition (similar to ConditionalSection pattern but without the orange dashed border).
- **Read-only mode:** Fields display as text, booking refs wrapped in tap-to-copy pills using `useClipboard`
- **Status badge** rendered inline (4 lines of template, not a separate component — only used here):
  ```html
  <span class="status-pill" :class="statusClass">{{ statusLabel }}</span>
  ```
  With computed `statusClass`: booked=green-tint, pending=gold-tint, not_booked=gray, researching=teal-tint

### 3.9 Shared: VacationIdeaCard — NEW `src/components/vacation/VacationIdeaCard.vue`

**Used in:** Wizard step 5 AND view modal bucket list section.

- Vote heart (❤️/🤍) + count + title + category tag + author avatar
- Expandable inline detail editor (category pills via `FrequencyChips`, description, location, cost toggle, duration pills, notes)
- `readOnly` prop for view modal (voting still works in readOnly)

### 3.10 Celebration — reuse `CreatedConfirmModal`

After save, show `CreatedConfirmModal` with:

```typescript
title: t('vacation.bonVoyage'); // "bon voyage, beans!"
message: t('vacation.savedMessage');
details: [
  { label: 'Trip', value: vacation.name },
  { label: 'When', value: `${formatDateShort(start)} – ${formatDateShort(end)}` },
  { label: 'Who', value: `all beans! (${count} going)` },
  { label: 'Booked', value: `${booked} of ${total}`, highlight: true },
  { label: 'Ideas', value: `${ideas.length} on the bucket list` },
];
```

No separate celebration component needed — CreatedConfirmModal already has the beanies celebrating image and detail grid.

**Commit: "feat(vacation): 5-step wizard with segment cards and idea voting"**

---

## Milestone 4: Vacation View Modal

### 4.1 View modal — NEW `src/components/vacation/VacationViewModal.vue`

Uses `BaseModal` (Tier 1 — view-only content, custom hero header) with size `2xl`.

**Props:** `open`, `vacationId?: string`
**Emits:** `close`, `edit(vacation, step?)`

**Structure:**

1. **Hero header** (custom div, not BeanieFormModal header):
   - Teal gradient bg, trip emoji (large), vacation name (white Outfit bold)
   - Meta pills: date range, trip duration, countdown
   - Family avatars row
   - Close button (top-right)

2. **Progress section**: "📋 X of Y booked" — simple bar (div with width%, teal gradient bg, `rounded-lg`, transition)

3. **Chronological timeline**: All segments merged + sorted by date
   - Date group headers (Outfit caption style, like existing UpcomingActivities/DayAgendaSidebar pattern)
   - `VacationSegmentCard` per item with `readOnly` prop — shows details inline, booking refs as tap-to-copy via `useClipboard`
   - "Edit in wizard → [section]" link per card (emits `edit(vacation, stepNumber)`)
   - Unplanned items grouped at bottom with gold styling

4. **Bucket list section** (collapsible): `VacationIdeaCard` list with `readOnly` (voting still works)

5. **Footer**: "✏️ edit all" button + "📤 share" (disabled/future)

### 4.2 Wire into planner — `src/pages/FamilyPlannerPage.vue`

- Import VacationViewModal
- Add refs: `showVacationView`, `viewingVacationId`
- Handle `edit` event: close view modal, open wizard with `editStep`

**Commit: "feat(vacation): view modal with chronological timeline and inline editing"**

---

## Milestone 5: Calendar & Sidebar Integration

### 5.1 Monthly calendar vacation bars — `src/components/planner/CalendarGrid.vue`

- Import `useVacationStore`
- Filter vacation-linked activities out of `dateActivities` map (they get bars, not dots) by checking `activity.vacationId`
- Compute `vacationSpans`: for each vacation with startDate/endDate, calculate which calendar week rows it spans and column ranges
- After the day grid, render vacation bar rows per calendar week: `grid-column: start / end` within 7-col grid
- Bar style: teal gradient, rounded, emoji + name, truncated. Click → emit `vacation-click(vacationId)`
- Vacation day cells get subtle teal tint background
- Reuse spanning logic pattern from `WeeklyCalendarView.vue:147-192`

### 5.2 Weekly calendar vacation bars — `src/components/planner/WeeklyCalendarView.vue`

- Detect vacation-linked activities via `activity.vacationId` field
- In spanning bar rendering: use teal gradient + trip emoji for vacation activities (instead of category color)
- Click on vacation span → emit `vacation-click(vacationId)` instead of opening ActivityViewEditModal

### 5.3 Sidebar — NEW `src/components/vacation/VacationSidebarCard.vue`

Card showing upcoming vacation in planner sidebar:

- Trip emoji + name
- Date range (Outfit caption)
- Countdown gradient pill ("✈️ X days!")
- Family avatars (reuse member avatar pattern from existing cards)
- Progress bar + "X/Y booked"
- Alert pill: "⏳ N items need booking" (gold, if applicable)
- Click opens VacationViewModal

### 5.4 Planner page integration — `src/pages/FamilyPlannerPage.vue`

- Add "upcoming vacations" section above the two-column content area (or in sidebar)
- Render `VacationSidebarCard` for each upcoming vacation
- Handle `vacation-click` from CalendarGrid and WeeklyCalendarView
- Load `vacationStore.loadVacations()` alongside existing store loads

### 5.5 Day agenda sidebar — `src/components/planner/DayAgendaSidebar.vue`

- When selected date falls within a vacation range, show a vacation context banner at top
- Shows: trip emoji + name + "day X of Y" + relevant segment info
- Click opens VacationViewModal

### 5.6 ActivityViewEditModal guard — `src/components/planner/ActivityViewEditModal.vue`

- When opening an activity with `vacationId`, intercept and emit `open-vacation(vacationId)` instead of showing the activity view modal. This ensures vacation-linked activities always open the VacationViewModal.

### 5.7 E2E helper update — `e2e/helpers/indexeddb.ts`

- Add `vacations?: FamilyVacation[]` to `ExportedData` interface (line ~15) so E2E tests can seed and verify vacation data.

**Commit: "feat(vacation): calendar vacation bars and sidebar integration"**

---

## Milestone 6: Tests

### 6.1 Unit tests — NEW `src/utils/vacation.test.ts`

Test all pure utility functions:

- `computeVacationDates()`: empty vacation, travel-only, accommodation-only, mixed segments, derives correct start/end
- `bookingProgress()`: all booked, none booked, mixed statuses, empty vacation
- `daysUntilTrip()`: future date, today, past date
- `tripDurationDays()`: same day, multi-day, edge cases

### 6.2 Unit tests — NEW `src/stores/vacationStore.test.ts`

Follow pattern of `activityStore.test.ts` (mock repository):

- `loadVacations()`: loads from repo, sets state
- `createVacation()`: creates vacation + linked activity, sets bidirectional IDs, computes dates
- `updateVacation()`: updates vacation + syncs linked activity dates
- `deleteVacation()`: deletes both vacation and linked activity
- `toggleIdeaVote()`: adds vote, removes existing vote, idempotent
- `upcomingVacations`: sorted, excludes past vacations
- `vacationByActivityId`: O(1) lookup map

### 6.3 Unit test update — `src/stores/activityStore.test.ts`

- Add test: `deleteActivity()` with `vacationId` set → prevented / throws
- Add test: `upcomingActivities` excludes activities with `vacationId`
- Add test: `activitiesForDate()` can exclude vacation-linked activities

### 6.4 Unit test — `src/utils/date.ts` (add to existing test file if present)

- Test `daysBetween()`: same date (0), adjacent dates (1), multi-day, cross-month, cross-year

### 6.5 E2E tests — NEW `e2e/specs/12-vacation.spec.ts`

Follow patterns from `09-planner.spec.ts`:

**Test cases:**

1. **Create vacation via activity modal**: Open add activity → select one-time → toggle vacation → verify wizard opens
2. **Wizard step 1**: Fill name, select trip type, select assignees → next
3. **Wizard step 2**: Add flight segment, fill details, set status → next
4. **Wizard step 3**: Select hotel pill, fill accommodation details → next
5. **Wizard step 4**: Select rental car pill → next
6. **Wizard step 5**: Quick-add idea, vote on idea → save
7. **Celebration modal**: Verify CreatedConfirmModal shows with vacation details
8. **Calendar bar**: Verify teal vacation bar appears on calendar grid spanning correct dates
9. **Sidebar card**: Verify VacationSidebarCard renders with countdown and progress
10. **View modal**: Click sidebar card → verify view modal opens with hero, timeline, ideas
11. **Tap-to-copy**: Click booking reference → verify clipboard copy feedback
12. **Edit via wizard**: View modal → "Edit All" → modify name → save → verify update persists
13. **Delete vacation**: View modal → edit → delete → confirm → verify both vacation and activity removed
14. **Voting**: View modal → heart idea → verify vote count updates
15. **No duplicate display**: Verify vacation-linked activity does NOT appear as regular activity dot or upcoming item

**E2E test utilities needed:**

- Seed vacation data via `IndexedDBHelper.seedData()` (requires ExportedData update from 5.7)
- Use `ui()` helper for all button/label text matching

### 6.6 E2E test update — `e2e/specs/09-planner.spec.ts`

- Verify existing activity tests still pass after ActivityModal toggle relocation
- Add test: schedule tab bar visible at top of modal (🔁 recurring / 📌 one-time)
- Add test: vacation toggle visible only in one-time mode
- Update any selectors that relied on the old toggle position

**Commit: "test(vacation): unit tests for store/utils + E2E for full vacation flow"**

---

## New Files (17)

| File                                                        | Purpose                                                  |
| ----------------------------------------------------------- | -------------------------------------------------------- |
| `src/services/automerge/repositories/vacationRepository.ts` | CRUD repository                                          |
| `src/stores/vacationStore.ts`                               | Pinia store with linked activity management              |
| `src/utils/vacation.ts`                                     | Pure functions: computeDates, bookingProgress, daysUntil |
| `src/components/vacation/VacationWizard.vue`                | 5-step wizard container modal                            |
| `src/components/vacation/VacationStep1.vue`                 | Trip type + name + who's going                           |
| `src/components/vacation/VacationStep2.vue`                 | Travel details                                           |
| `src/components/vacation/VacationStep3.vue`                 | Accommodation                                            |
| `src/components/vacation/VacationStep4.vue`                 | Transportation                                           |
| `src/components/vacation/VacationStep5.vue`                 | Ideas & bucket list                                      |
| `src/components/vacation/VacationSegmentCard.vue`           | Shared collapsible card (edit + readOnly modes)          |
| `src/components/vacation/VacationIdeaCard.vue`              | Idea card with voting (edit + readOnly modes)            |
| `src/components/vacation/VacationViewModal.vue`             | View/detail modal with timeline                          |
| `src/components/vacation/VacationSidebarCard.vue`           | Sidebar countdown card                                   |
| `src/utils/vacation.test.ts`                                | Unit tests for vacation utilities                        |
| `src/stores/vacationStore.test.ts`                          | Unit tests for vacation store                            |
| `e2e/specs/12-vacation.spec.ts`                             | E2E tests for full vacation flow                         |
| `docs/plans/2026-03-20-family-vacation-planner.md`          | Plan archive                                             |

## Modified Files (16)

| File                                               | Change                                                       |
| -------------------------------------------------- | ------------------------------------------------------------ |
| `src/types/models.ts`                              | Vacation types + `vacationId` on FamilyActivity              |
| `src/types/automerge.ts`                           | `vacations` to FamilyDocument                                |
| `src/services/automerge/docService.ts`             | `vacations: {}` in initDoc()                                 |
| `src/services/automerge/repositories/index.ts`     | Export vacation repo                                         |
| `src/stores/activityStore.ts`                      | Filter vacation-linked activities, prevent standalone delete |
| `src/utils/date.ts`                                | Add `daysBetween()`                                          |
| `src/style.css`                                    | Vacation CSS variables                                       |
| `src/services/translation/uiStrings.ts`            | ~80-100 vacation string pairs                                |
| `src/components/ui/BaseModal.vue`                  | Add `3xl` size                                               |
| `src/components/ui/BeanieFormModal.vue`            | Add `wide` size + `teal` gradient                            |
| `src/components/planner/ActivityModal.vue`         | Schedule tab bar + vacation toggle                           |
| `src/components/planner/ActivityViewEditModal.vue` | Redirect vacation-linked activities to VacationViewModal     |
| `src/components/planner/CalendarGrid.vue`          | Vacation span bars, filter vacation dots                     |
| `src/components/planner/WeeklyCalendarView.vue`    | Teal vacation spans                                          |
| `src/pages/FamilyPlannerPage.vue`                  | Wire all modals + load store                                 |
| `src/components/planner/DayAgendaSidebar.vue`      | Vacation context banner                                      |
| `e2e/helpers/indexeddb.ts`                         | Add `vacations` to ExportedData                              |
| `src/stores/activityStore.test.ts`                 | Tests for vacation-linked activity filtering/protection      |
| `e2e/specs/09-planner.spec.ts`                     | Verify toggle relocation doesn't break existing tests        |

## What We're NOT Creating (DRY decisions)

| Eliminated                       | Why                                                                   |
| -------------------------------- | --------------------------------------------------------------------- |
| `useClipboardCopy.ts`            | `useClipboard` already exists with identical API                      |
| `VacationCelebration.vue`        | `CreatedConfirmModal` already does this — pass vacation details       |
| `VacationTimelineEntry.vue`      | Merged into `VacationSegmentCard` with `readOnly` prop                |
| `VacationStatusBadge.vue`        | 4 lines of template inline in `VacationSegmentCard` — only used there |
| `useVacationDates.ts` composable | Pure functions in `src/utils/vacation.ts` — no reactive state needed  |
| New activity category            | Use existing `'other'` category + set icon='✈️' on linked activity    |

## Verification

### Automated

1. `npm run type-check` — all new types resolve, no regressions
2. `npm run lint` — no new warnings
3. `npx vitest run src/utils/vacation.test.ts` — vacation utility tests pass
4. `npx vitest run src/stores/vacationStore.test.ts` — vacation store tests pass
5. `npx vitest run src/stores/activityStore.test.ts` — activity store tests still pass (no regression from filtering changes)
6. `npx playwright test e2e/specs/09-planner.spec.ts` — existing planner E2E tests still pass after ActivityModal toggle relocation
7. `npx playwright test e2e/specs/12-vacation.spec.ts` — new vacation E2E tests pass

### Manual

8. `npm run dev` — no console errors, all pages load
9. **Create:** Planner → Add Activity → one-time → vacation toggle → complete wizard → verify CreatedConfirmModal shows
10. **View:** Click sidebar vacation card → verify view modal with timeline, tap-to-copy, progress bar
11. **Edit:** View modal → "Edit All" → wizard populates → save changes → verify linked activity dates update
12. **Delete:** Wizard → delete → confirm → verify both vacation AND linked activity removed
13. **Vote:** Step 5 / view modal → heart idea → count updates, persists across reload
14. **Calendar month:** Teal vacation bar spans correct dates, no duplicate activity dots
15. **Calendar week:** Teal spanning bar, click opens view modal (not activity modal)
16. **Sidebar:** Countdown accurate, progress bar correct, booking alerts visible
17. **Activity guard:** Click vacation-linked activity anywhere → opens VacationViewModal (never ActivityViewEditModal)
18. **Cascade safety:** Try to delete a vacation-linked activity via activity store → prevented
19. **Mobile:** Wizard fullscreen, touch targets ≥44px, all steps scrollable
20. **Dark mode:** All vacation components render correctly with dark variants
21. **Backward compat:** Load an existing .beanpod file without vacations field → app works, no errors
