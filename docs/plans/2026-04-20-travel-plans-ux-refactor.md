# Plan: Travel Plans UX Refactor — First-Class Trip Dates, Conditional-Required Fields, and Unified Form Layout

> Date: 2026-04-20
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-04-20-travel-plans-ux-refactor.md`

> **No GitHub issue created.** This plan was approved for direct implementation. Full prompt history is preserved in the Prompt Log at the bottom of this document.

## User Story

As a family member planning a trip, I want to set trip start and end dates up-front (before anything is booked), have segment dates seed naturally from those trip dates, and be able to move a flight without accidentally "shrinking" my trip so that accommodation I already logged doesn't appear orphaned, so that creating and adjusting a travel plan is intuitive, forgiving, and doesn't fight me when plans are still in flux.

## Context

The current travel plans feature treats `FamilyVacation.startDate` and `endDate` as **derived fields** — computed from segment dates on every create/update (`src/types/models.ts:671-673` documents this explicitly, and `src/utils/vacation.ts:42-74` `computeVacationDates()` is the derivation logic called from `src/stores/vacationStore.ts:58,112`).

This caused the bug greg reported on 2026-04-20:

- Created a trip with a round-trip flight + hotel, dates Jul 1 → Jul 10
- Moved the outbound flight to Jul 15
- Return flight stayed at Jul 10
- Store recomputed trip dates → **startDate became Jul 10 (return), endDate became Jul 15 (outbound)** — trip silently shifted and shrank the Jul 1-10 window
- Hotel (still Jul 1-10) now appeared _before_ trip start → misleading "orphaned accommodation" hint from `computeAccommodationGaps()` (`src/utils/vacation.ts:201-258`)

Two related UX issues came out of the same investigation:

1. **Premature required-field indicators on flight fields in pending status.** greg saw airline/flight-number visually marked as required while the booking was pending. Root cause: `TravelSegmentEditModal.vue:200-231` computes `bookedErrors` as soon as `status === 'booked'`, and `:error="bookedErrors.has('airline')"` immediately fires the orange-label + orange-ring error state. That error styling reads as "required" even though `FormFieldGroup` (`src/components/ui/FormFieldGroup.vue:27`) only renders an asterisk when `required` prop is true. The real problem is _premature_ validation (fired on open, not on save attempt) combined with the fact that no explicit required indicator exists on booking-contingent fields, so the error state is the only visible signal.

2. **Flight form field ordering doesn't surface the trip-critical fields first.** Today airline + flight number appear before date/from/to; those are booking-details, not always-required trip shape. The always-required trio (date + from + to) should be prominent at the top.

The refactor also gives us the opportunity to clean up three drift-prone `bookedErrors` copies across the segment modals by extracting a `useBookingValidation` composable, and to extend `computeTimelineHints()` with out-of-range detection rather than building a parallel utility.

## Requirements

**Data model & behavior:**

1. **Trip dates become first-class user-set fields.** `FamilyVacation.startDate` and `endDate` are no longer "derived from segment dates." They are set by the user at trip creation and editable from the trip summary page.
2. **Auto-extend only, never auto-shrink.** When a segment's date changes or is added and falls outside the current trip window, the corresponding trip boundary extends. Segment deletion, or segment date changes _within_ the trip window, never shrink the trip. The only way to shrink the trip is a manual edit on the summary page.
3. **Segment dates auto-populate from trip dates at creation time.** When adding a new segment in the wizard or post-creation:
   - Round-trip flight: outbound `departureDate` = `tripStart`; return `departureDate` = `tripEnd`.
   - One-way flight: `departureDate` = `tripStart`.
   - Cruise: `embarkationDate` = `tripStart`; `disembarkationDate` = `tripEnd`.
   - Train/ferry: `departureDate` = `tripStart` (no pair concept unless multi-leg is explicit).
   - Car / car rental: `departureDate` = `tripStart`.
   - Accommodation (first one added): `checkInDate` = `tripStart`; `checkOutDate` = `tripEnd`. Subsequent accommodations: no prefill.
   - Transportation (rental car, shuttle, etc.): `pickupDate` = `tripStart`; `returnDate` = `tripEnd` when applicable.
   - Activity: no prefill (activities pick their own day).
   - Users can always edit these after prefill.
4. **Out-of-range segments are warnings, not errors.** Segments whose dates fall before `tripStart` or after `tripEnd` display via the existing amber hint system (`computeTimelineHints()` extended with two new cases). The trip summary page shows a banner summarizing the count via `<ErrorBanner severity="warning">`. Nothing blocks save or timeline display.

**Wizard creation flow:**

5. **Wizard Step 1 captures trip dates** (along with name, trip type, purpose, assignees). User enters dates via a new `<TripDatesInput>` component:
   - Start date input (required)
   - End date input (required; must be ≥ start)
   - Three quick-add chips: "+3 days", "+1 week", "+2 weeks" (set end = start + N; disabled when start is empty)
   - Live read-only summary: "From Jun 1 → Jun 10 · 10 days"
6. **Trip dates are required to advance past Step 1.** "Next" disabled until both dates valid.
7. **Wizard Step 2 auto-populates segment dates from trip dates** on segment add via `prefillSegmentDates()` (new pure function). User edits can override.

**Wizard-save semantics:**

7a. **Wizard save does NOT enforce booking-contingent required fields.** Per-segment "booked + missing airline" validation is the post-creation edit modal's job. Wizard inline allows incomplete booked segments to save as-is. This keeps the wizard forgiving (matches "plan without bookings first") and removes N-reactive-validation-instances-per-wizard complexity.

**Conditional-required field UX (segment edit modals):**

8. **Booking-contingent fields show an asterisk only when `status === 'booked'`.** Apply across all segment types:
   - Flight: `airline`, `flightNumber`, `departureTime`, `arrivalTime`, `bookingReference` — required when booked.
   - Flight always-required: `departureAirport`, `arrivalAirport`, `departureDate` (these define the trip shape).
   - Cruise: `cruiseLine`, `shipName`, `departurePort`, `embarkationTime` — required when booked; `embarkationDate`, `disembarkationDate` always required (trip-shape fields for a cruise).
   - Train / ferry: `operator`, `route`, `departureTime` — required when booked; `departureStation`, `arrivalStation`, `departureDate` always required.
   - Car: `carType` — required when booked; `departureDate` always required.
   - Accommodation: `name` always required; `address`, `checkInDate`, `checkOutDate`, `confirmationNumber` (unless `type === 'family_friends'`) — required when booked.
   - Transportation: fields per type as currently enumerated — required when booked.
9. **Error state is deferred until save attempt.** Opening a modal with `status === 'booked'` and empty booking-contingent fields must NOT fire the orange error ring immediately. The ring fires on save-attempt. Asterisks (the required indicator) remain live with status, so the user can see what _will_ be required without seeing it as an immediate validation failure.

**Flight form layout (unified across wizard Step 2 inline + edit modal):**

10. **Date / from / to are the top row.** The three always-required fields sit in a prominent row at the top of the flight form. Responsive per existing pattern (`grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_1.3fr]`) — stacks to 2 rows on mobile.
11. **Airline / flight number are the second row.** Below date/from/to, marked with asterisks only when booked, under an Outfit uppercase caption "Booking details".
12. **Times + `arrivesNextDay` + booking reference** are the third row, grouped into the same "Booking details" block.
13. **Parallel shape-fields-first treatment for cruise/train/ferry/car.** Dates + endpoints at top; booking details below.
14. **Same layout in both surfaces:** `VacationStep2.vue` inline and `TravelSegmentEditModal.vue`.

**Trip summary page:**

15. **Trip dates always displayed** at the top of the summary via a new `<TripDatesHeader>` component. Click "Edit dates" → inline reveal of `<TripDatesInput>` → commit calls `vacationStore.updateVacation(id, { startDate, endDate })`.
16. **Out-of-range banner** — `<ErrorBanner severity="warning">` at the top of the timeline when any segment is out of range, e.g. "2 items fall outside your trip dates (Jun 1 → Jun 10). [Show me]."
17. **Manual trip-date edit on summary is a free action.** User can shrink the window, widen it, or reset it. If their edit leaves segments out of range, the banner appears; never blocked.

## Important Notes & Caveats

- **Current `computeVacationDates()` stays useful — re-scoped.** Keep name; use only as a _seed_ fallback in two narrow paths: `createVacation` when input lacks dates (shouldn't happen post-Step 1 but defensive for programmatic callers / CRDT merge edge cases), and `updateVacation` when both `existing.startDate` and `existing.endDate` are undefined (existing-vacation-without-dates migration path). Never call on segment mutation otherwise — that's the core bug.
- **Existing-vacation-without-dates fallback.** In `updateVacation`, if `existing.startDate` and `existing.endDate` are both undefined, seed them via `computeVacationDates(merged)` _first_, then apply `extendTripDates` with incoming candidates on top. Single fallback path. No boot-time migration (avoids CRDT side effects at load).
- **No data migration required.** Existing vacations keep their stored dates. Post-deploy, auto-extend-never-shrink applies to future edits. Pre-existing misalignments will surface via the new amber banner — correct behavior.
- **`FamilyActivity` link stays in sync.** `vacationStore.updateVacation()` currently updates `activity.date`/`endDate` on vacation-date changes. Preserve through the refactor; add dedicated regression test.
- **Timezone: dates stay ISO date strings** (YYYY-MM-DD), no TZ conversion. Matches the existing model. Times live in separate fields.
- **Concurrent edits (CRDT) — standard Automerge LWW.** Two users editing trip dates simultaneously resolve via last-write-wins on scalar fields. Same as today's derived-dates behavior. If device A extends `endDate` while device B saves a segment that didn't extend, B's local recompute overwrites A's extension. Not a regression — it's the same guarantee we have today. Documented explicitly in ADR-023.
- **Wizard transaction scope.** `VacationStep2` inline editing doesn't fire auto-extend — the whole wizard is one transaction. Auto-extend activates at wizard save (first `createVacation` / `updateVacation`).
- **Existing return-flight airport mirroring** (`VacationStep2.vue:215-264`) stays untouched. Date auto-population layers on top.
- **DRY hot spots identified in audit (addressed in this plan):**
  - `bookedErrors` computed — triplicated across `TravelSegmentEditModal`, `AccommodationEditModal`, `TransportationEditModal`. → Extract to `useBookingValidation` composable. One call site each.
  - Per-segment-type prefill logic — would scatter across 4 step components. → Extract `prefillSegmentDates()` pure function with exhaustive TS switch.
  - Trip-dates input UI — would exist in Step 1 and summary edit. → Extract `<TripDatesInput>` component from day one.
  - `computeTimelineHints()` growing to 6 detectors. → Split into small per-concern detectors composed at the top.
  - Out-of-range detection — would parallel existing hints. → Extend `computeTimelineHints` with two new detectors, don't add a new utility.
  - Warning banner — reuse `<ErrorBanner severity="warning">`, don't build a new banner.
  - Store-error surfacing — `wrapAsync` already shows error toasts via `useStoreActions`. Don't add redundant UI-layer toasts.
  - `TravelPlansPage.vue` growth — extract `<TripDatesHeader>` to avoid bloating the 1205-line page.

## Error Handling — Never Silent

Explicit rules for every failure path touched by this refactor. All console messages carry a `[vacation]` or `[useBookingValidation]` prefix for grep-ability.

1. **Store mutations (`createVacation`, `updateVacation`, delete):** already wrapped via `wrapAsync` (`useStoreActions.ts:35-37`), which shows an error toast automatically. UI callers just `await` and check the return value — no redundant toast boilerplate.
2. **Activity-sync failure within `updateVacation`:** vacation save can succeed while the linked activity update silently fails (today's code no-ops on error). Wrap in try/catch, `console.error('[vacation] Vacation updated but linked activity %s did not sync:', activityId, err)`, show `showToast('warning', 'Trip saved, calendar may be out of date', 'Try refreshing.')`.
3. **Date parsing in utilities (`extendTripDates`, `detectOutOfRange`):** guard with `isValidISODate(s)`; if invalid, `console.warn('[vacation] Skipping invalid date "%s" on segment %s — expected ISO YYYY-MM-DD', s, id)` and skip. Never throw, never silently accept garbage.
4. **`useBookingValidation` rule-evaluation:** each predicate wrapped in try/catch; on throw, `console.error('[useBookingValidation] rule "%s" threw:', field, err)` and treat field as missing so UI flags it (fail-safe, not silent).
5. **Wizard Step 1 validation:** can't advance without both dates and end ≥ start. Inline field error with explicit message ("End date must be on or after start date"), not a disabled button with no reason. `aria-describedby` wires the error to the field for screen readers.
6. **Summary-page "Edit dates":** same end ≥ start validation; inline error; cancel restores previous values.
7. **`prefillSegmentDates` fallback:** if wizard state lacks trip dates when a segment is added (shouldn't happen post-Step 1, but defensive), `console.warn('[vacation] Adding segment without trip dates — prefill skipped')` and skip prefill. Never throw.
8. **Segment date auto-extend in store:** if vacation not found in local array, `console.error` with id; return null so caller surfaces the existing wrapAsync toast.

## Assumptions

> **Review these before implementation.** These were valid at the time of planning but may have changed.

1. Everyone who can edit a travel plan has `canEditActivities === true` (route guards + `usePermissions`). No new permission gates.
2. Quick-add chips ("+3 days", "+1 week", "+2 weeks") are additive helpers. Both date inputs remain manually editable at all times. Clicking a chip is a one-time action — it does not re-apply when start changes.
3. First-accommodation prefill (checkIn=tripStart, checkOut=tripEnd) is a sensible default. Subsequent accommodations don't prefill.
4. Out-of-range segments use the existing amber-hint path (same visual weight as overlap warnings). No new color treatment.
5. Cruise trip-shape fields are `embarkationDate`/`disembarkationDate`. Flight shape fields are `departureDate` + airports. Layout mirrors these.
6. "Edit dates" on the summary page is inline click-to-reveal (not a modal) using the same `<TripDatesInput>` component as Step 1.
7. Wizard allows save with incomplete booked segments as-is. Post-creation edit modal is where per-segment booking rigor applies.
8. ADR-023 captures the architectural shift from derived to user-owned trip dates, with three alternatives (keep derivation / auto-shrink / pinned-flag) explicitly rejected.

## Approach

Four sub-commits, each a working increment. Unit tests + E2E green after each.

### C1 — Extract `useBookingValidation`; fix conditional-required across all segment modals

- **NEW:** `src/composables/useBookingValidation.ts`

  Signature:

  ```ts
  useBookingValidation<Field extends string>(
    status: Ref<VacationSegmentStatus>,
    rules: {
      alwaysRequired: Record<Field, () => boolean>;      // field → predicate
      requiredWhenBooked: Record<Field, () => boolean>;
    }
  ) → {
    hasAttemptedSave: Ref<boolean>;
    isRequired(field: Field): boolean;              // → :required prop on FormFieldGroup
    showError(field: Field): boolean;               // → :error prop, gated on hasAttemptedSave
    canSave: ComputedRef<boolean>;
    missing: ComputedRef<Set<Field>>;
    attemptSave(onValid: () => void | Promise<void>): void;
    reset(): void;                                  // called from useFormModal.onNew / open-watcher
  }
  ```

  TypeScript generic `Field` makes rule-key typos compile-time errors. Rule predicates wrapped in try/catch per error-handling rule #4.

- **NEW:** `src/composables/__tests__/useBookingValidation.test.ts` — empty-when-pending; populated-when-booked; deferred-error-state; try/catch rule safety; reset behavior; field-generic typing.

- **MODIFIED:** `TravelSegmentEditModal.vue`, `AccommodationEditModal.vue`, `TransportationEditModal.vue`:
  - Replace inline `bookedErrors` computed with `useBookingValidation` per segment type.
  - `:required="v.isRequired('airline')"`, `:error="v.showError('airline')"`.
  - Save handler wraps in `v.attemptSave(async () => { ... })`.
  - Reset validation in `useFormModal.onNew` callback.
  - Rely on `wrapAsync` for store-error toasts (no redundant UI-layer toasting).

- **NOT TOUCHED:** `VacationStep2.vue` inline validation. Per Requirement 7a, wizard saves booked segments as-is. Simpler model.

**Ships independently.** Visible wins: no premature error rings; clear asterisks when status toggles to booked.

### C2 — First-class trip dates: data layer + wizard Step 1 + auto-populate + `<TripDatesInput>` + ADR-023

- **NEW:** `src/components/ui/TripDatesInput.vue`
  - Two date inputs (`BaseInput type="date"`) + three quick-add chips + live "From X → Y · N days" summary.
  - Props: `startDate`, `endDate` (v-model pattern via `update:startDate`, `update:endDate`).
  - Emits: `update:isValid: boolean`, `update:errorMessage: string | null`.
  - Internal validation: both dates set, end ≥ start.
  - Chips disabled when start is empty.
  - Accessibility: error id + `aria-describedby` + `aria-invalid` on both inputs.

- **NEW:** `docs/adr/023-user-owned-trip-dates.md` — captures the architectural shift. Three alternatives rejected (keep derivation / auto-shrink / pinned-flag). Notes CRDT LWW semantics.

- **MODIFIED:** `src/types/models.ts:671-673` — comment update: `startDate`/`endDate` are user-set, extended on segment mutation, never auto-shrunk. See ADR-023.

- **MODIFIED:** `src/utils/vacation.ts`:
  - Top-of-file MVO layering comment: "Pure helpers. No reactivity, no store access, no side effects. Orchestration lives in `vacationStore`. See ADR-023."
  - Add `extendTripDates(current: {start?, end?}, ...candidates: (ISODateString | undefined)[]) → {start?, end?}` — widens either end; never narrows; `isValidISODate` guard + warn on bad input.
  - Add `prefillSegmentDates(segment, tripStart?, tripEnd?) → segment` — pure function, exhaustive `switch` on `VacationTravelType` (TS enforces every type handled).
  - Add `prefillAccommodationDates(acc, tripStart?, tripEnd?) → acc` — caller decides whether to apply (only on first-add).
  - Add `prefillTransportationDates(trans, tripStart?, tripEnd?) → trans`.
  - Refactor `computeTimelineHints()` into small per-concern detectors: `detectAccommodationOverlaps`, `detectFlightDuringCruise`, `detectNightFlights`, `detectOutOfRange` (new). Each ~20 lines, independently testable. Top-level function composes them.
  - Keep `computeVacationDates()` as seed fallback only.

- **MODIFIED:** `src/stores/vacationStore.ts`:
  - `createVacation`: accept user-provided `startDate`/`endDate` from input; fall back to `computeVacationDates()` only if input lacks them.
  - `updateVacation`: if `existing` has undefined start AND end, seed via `computeVacationDates(merged)` first. Then: if input has `travelSegments`/`accommodations`/`transportation`, collect candidate dates and call `extendTripDates(current, ...candidates)` — auto-extend only. If input has explicit `startDate`/`endDate`, those win (manual-edit path).
  - Activity-sync wrapped in try/catch — warning toast on failure per error-handling rule #2.

- **MODIFIED:** `src/components/vacation/VacationStep1.vue`:
  - Add `<TripDatesInput>` below the existing name/type/assignee fields.
  - Bind `update:isValid` to local `areDatesValid` ref; parent wizard uses it to enable "Next".

- **MODIFIED:** `src/components/vacation/VacationWizard.vue`:
  - Thread `tripStartDate` / `tripEndDate` through wizard state (two new refs).
  - Reset on wizard close/open to prevent stale-date bleeding across sessions.
  - Pass to Steps 2/3/4 for auto-population.
  - Pass to `createVacation` / `updateVacation` on save.

- **MODIFIED:** `VacationStep2.vue` — call `prefillSegmentDates(segment, tripStart, tripEnd)` on segment add. Return-flight pair uses `tripStart` for outbound / `tripEnd` for return.

- **MODIFIED:** `VacationStep3.vue` — first-added accommodation: call `prefillAccommodationDates`. Subsequent: skip.

- **MODIFIED:** `VacationStep4.vue` — call `prefillTransportationDates` when applicable.

- **Tests:**
  - `src/stores/vacationStore.test.ts`: extend-on-later-segment; no-shrink-on-delete; manual-date override; activity sync stays accurate; activity-sync-failure surfaces toast (mock the repo); undefined-dates-existing-vacation seeded on update.
  - `src/utils/vacation.test.ts`: `extendTripDates` math + undefined handling + invalid-date guard; `computeTimelineHints` new out-of-range cases; per-detector tests.
  - `src/utils/__tests__/prefillSegmentDates.test.ts`: one case per segment type (flight_outbound, flight_return, flight_other, cruise, train, ferry, car, activity) + accommodation + transportation. Exhaustive by construction via TS switch.
  - `src/components/ui/__tests__/TripDatesInput.test.ts`: validation messages; quick-add chip arithmetic; end-before-start error; chip disabled when start empty; aria attributes.

**Ships independently.** Fixes the original bug. Adds the auto-populate UX. Ships ADR-023.

### C3 — Summary-page editable trip dates + out-of-range banner

- **NEW:** `src/components/travel/TripDatesHeader.vue`
  - Displays trip date range as a chip at the top of the summary.
  - "Edit dates" button with `aria-expanded` / `aria-controls`.
  - Click-to-reveal inline `<TripDatesInput>` + Save / Cancel buttons.
  - On save: calls `vacationStore.updateVacation(id, { startDate, endDate })`; on error the store's `wrapAsync` surfaces the toast.
  - On cancel: restores previous values; closes editor.
  - ~40 lines extracted so `TravelPlansPage` doesn't grow.

- **MODIFIED:** `src/pages/TravelPlansPage.vue`:
  - Mount `<TripDatesHeader :vacation="selectedVacation">` at the top of the timeline region.
  - Compute out-of-range count from `computeTimelineHints()` output (detector-filtered).
  - `<ErrorBanner severity="warning">` above the timeline when count > 0 — title "X items fall outside your trip dates", message shows date range, action button "Show me" scrolls to first out-of-range segment.
  - Per-segment out-of-range badge comes for free via existing hint rendering in `VacationSegmentCard`.

- **MODIFIED:** `src/services/translation/uiStrings.ts` — new keys for trip-date display, edit affordance, out-of-range banner, chip labels. English + beanie variants.

- **Tests:**
  - `src/components/travel/__tests__/TripDatesHeader.test.ts`: edit toggle open/close; save-on-commit calls store; cancel restores; end<start error path.

**Ships independently.** Completes the user-facing story.

### C4 — Unified flight form layout + parallel shape-fields-first for all segment types + E2E

- **MODIFIED:** `TravelSegmentEditModal.vue` — restructure flight section:
  - Row 1 "trip shape" (Outfit uppercase caption optional): Date | Departure airport | Arrival airport. Responsive `grid-cols-2 sm:grid-cols-[1fr_1fr_1.3fr]`. All `isRequired=true`.
  - Sub-heading "Booking details" (Outfit uppercase caption per theme).
  - Row 2: Airline | Flight number — `isRequired` via `v.isRequired('airline')` etc.
  - Row 3: Departure time | Arrival time + arrivesNextDay | Booking reference.
  - Parallel treatment for cruise (embarkation dates + ports top), train/ferry (stations + date top), car (date + car type top).

- **MODIFIED:** `VacationStep2.vue` — apply same inline field ordering so wizard and modal match.

- **i18n:** any new string labels (e.g. "Booking details" caption) added to `uiStrings.ts` and translated.

- **E2E:** `e2e/specs/travel-plans.spec.ts` — one new test:
  - **Name (explicit regression tag):** `"trip date extends on outbound move (regression: 2026-04-20 orphaned-accommodation bug)"`.
  - Steps: create trip with explicit dates → add round-trip flight → verify auto-populated dates (IndexedDB export, not DOM text) → move outbound to later date → verify `endDate` extended but `startDate` unchanged → manually shrink `startDate` past hotel → verify out-of-range hint present.
  - If at 25-test cap (per ADR-007), consolidate `cross-entity.spec.ts:81` (already flagged flaky in `docs/E2E_HEALTH.md`).

- **Self-review:** run `/simplify` skill over the diff. Address any findings.

- **Docs:**
  - `docs/STATUS.md` — session update.
  - `CHANGELOG.md` — entry under 2026-04-20.
  - `docs/E2E_HEALTH.md` — note the consolidation if done.

**Ships independently.** Locks in the visual hierarchy and guards the end-to-end flow.

## Files Affected

**Created (4):**

- `src/composables/useBookingValidation.ts`
- `src/composables/__tests__/useBookingValidation.test.ts`
- `src/components/ui/TripDatesInput.vue` + test
- `src/components/travel/TripDatesHeader.vue` + test
- `src/utils/__tests__/prefillSegmentDates.test.ts`
- `docs/adr/023-user-owned-trip-dates.md`

**Modified (~14):**

- `src/types/models.ts` — comment update only
- `src/utils/vacation.ts` + `src/utils/vacation.test.ts` — `extendTripDates`, `prefillSegmentDates`, refactored `computeTimelineHints`, invalid-date guards, MVO top-comment
- `src/stores/vacationStore.ts` + `src/stores/vacationStore.test.ts` — auto-extend, seed-fallback, activity-sync error handling
- `src/components/vacation/VacationWizard.vue` + `VacationStep1.vue` + `VacationStep2.vue` + `VacationStep3.vue` + `VacationStep4.vue`
- `src/components/travel/TravelSegmentEditModal.vue` + `AccommodationEditModal.vue` + `TransportationEditModal.vue`
- `src/pages/TravelPlansPage.vue`
- `src/services/translation/uiStrings.ts`
- `docs/STATUS.md` + `CHANGELOG.md`
- `docs/E2E_HEALTH.md` (if consolidating)
- `e2e/specs/travel-plans.spec.ts` (new spec or extension)

**Reused as-is (explicit non-duplication):**

- `src/components/common/ErrorBanner.vue` (severity="warning") — trip-level banner
- `src/composables/useToast.ts` — store-error surfacing via `wrapAsync`
- `src/composables/useStoreActions.ts::wrapAsync` — already shows error toasts automatically
- `src/composables/useFormModal.ts` — CRUD modal plumbing (unchanged)
- `src/components/ui/FormFieldGroup.vue` — callers now pass `:required` correctly
- `src/utils/vacation.ts::computeTimelineHints` — extended, not duplicated
- `src/utils/vacation.ts::computeVacationDates` — retained as seed fallback
- `src/components/vacation/VacationSegmentCard.vue` — no prop changes; existing hint rendering picks up new out-of-range cases automatically

## Acceptance Criteria

- [ ] Creating a new trip requires both start and end dates in Step 1; "Next" is disabled until both set + end ≥ start.
- [ ] Quick-add chips (+3d / +1w / +2w) set end from start; both date inputs remain manually editable; chips disabled when start is empty.
- [ ] Adding a round-trip flight to a new trip prefills outbound=tripStart, return=tripEnd.
- [ ] Adding a cruise prefills embarkation=tripStart, disembarkation=tripEnd.
- [ ] First accommodation added prefills checkIn=tripStart, checkOut=tripEnd. Subsequent accommodations don't prefill.
- [ ] Moving the outbound flight date to _later than tripStart but within tripEnd_ does not change trip dates.
- [ ] Moving the outbound flight date to _earlier than tripStart_ extends tripStart backward; accommodation remains in range.
- [ ] Moving the return flight to _later than tripEnd_ extends tripEnd forward.
- [ ] Deleting the only flight does not shrink trip dates.
- [ ] Editing trip dates manually on the summary page is accepted; shrinking past a segment shows amber hint on that segment + warning banner at top of timeline.
- [ ] Opening a new flight segment with status=pending shows NO asterisks on airline/flight-number; fields are plainly optional-looking.
- [ ] Toggling status to booked makes asterisks appear on airline/flight-number/etc.; error ring does NOT fire until user attempts to save.
- [ ] Attempting to save a booked flight with empty airline shows the error ring + hint banner.
- [ ] Same conditional-required pattern works on accommodation modal and transportation modal.
- [ ] Flight form in both wizard Step 2 and edit modal shows date/from/to as the prominent top row; airline/flight-number as a secondary "Booking details" block. Responsive — stacks on mobile.
- [ ] Cruise/train/ferry/car segments also show their shape-defining fields first.
- [ ] `FamilyActivity` linked to the vacation has `date`/`endDate` matching trip dates at all times (verified in store test).
- [ ] Activity-sync failure surfaces a warning toast ("Trip saved, calendar may be out of date").
- [ ] Existing vacations with undefined trip dates (historical) auto-seed via `computeVacationDates()` on first mutation without bleeding through as a side-effect of read.
- [ ] All 1097 existing unit tests still pass.
- [ ] New unit tests for `useBookingValidation`, `extendTripDates`, `prefillSegmentDates`, refactored `computeTimelineHints` detectors, `TripDatesInput`, `TripDatesHeader` — all green.
- [ ] One new E2E (tagged as regression for 2026-04-20 bug) — green on Chromium.
- [ ] E2E budget still ≤ 25 (consolidate `cross-entity.spec.ts:81` if needed; log in `docs/E2E_HEALTH.md`).
- [ ] No hardcoded English strings in templates — all via `t('...')` (ADR-008).
- [ ] `npm run translate` run after uiStrings changes; Chinese translations regenerated; `scripts/updateTranslations.mjs` still parses `uiStrings.ts` without error.
- [ ] `docs/STATUS.md` updated.
- [ ] `CHANGELOG.md` entry under today's date (Changed + Fixed + Added).
- [ ] `docs/adr/023-user-owned-trip-dates.md` shipped with C2.
- [ ] `grep "catch\s*\(.*\)\s*\{\s*\}"` across touched files returns zero matches.
- [ ] `grep "\.catch\(\(\)\s*=>\s*\{?\s*\}?\)"` across touched files returns zero matches.
- [ ] Every touched `console.error` / `console.warn` includes a `[vacation]` or `[useBookingValidation]` prefix.
- [ ] `/simplify` skill run over final diff; findings addressed.

## Testing Plan

### Unit (new)

1. `extendTripDates` — extends correctly in both directions; no-ops within range; handles undefined current start/end (treats candidate as new range); skips invalid ISO strings with warn.
2. `prefillSegmentDates` — one test per `VacationTravelType` member + accommodation + transportation. TS-exhaustive.
3. `computeTimelineHints` — refactored-into-detectors; each detector independently tested; new out-of-range-before-start + out-of-range-after-end cases.
4. `useBookingValidation` — empty when pending; populated when booked; `showError` gated on attempted-save; rule try/catch fail-safe; reset; field-generic typing.
5. `vacationStore.updateVacation` — segment-mutation extends trip dates; no-shrink on deletion; manual date override; activity sync + failure toast; undefined-existing-dates seeded.
6. `TripDatesInput` — validation messages; quick-add arithmetic; end-before-start error; chip disabled when start empty; aria-describedby + aria-invalid correctly bound.
7. `TripDatesHeader` — edit toggle open/close; save-on-commit calls store; cancel restores values.

### Manual verification (greg)

1. **Original bug reproduction:** create trip Jul 1 → Jul 10 w/ round-trip flight + hotel. Move outbound to Jul 15. Confirm trip end extends to Jul 15; trip start stays Jul 1; hotel stays in range; no misleading "orphaned accommodation" error.
2. **New trip creation:** Step 1 date capture feels natural; quick-add chips work; live span summary reads correctly.
3. **Round-trip flight add:** dates pre-filled from trip dates.
4. **Cruise add:** embarkation/disembarkation prefilled.
5. **Accommodation add (first vs subsequent):** first prefilled, second blank.
6. **Manual trip-date shrink on summary:** amber banner appears; segment badge renders; nothing breaks.
7. **Segment status pending → booked → pending:** asterisks appear/disappear; no premature error ring.
8. **Save booked flight with empty airline:** error ring + hint banner appear on save click (not before).
9. **All three modal types (flight, accommodation, transportation):** verify consistent behavior.
10. **Mobile width (375px):** flight form stacks gracefully; all fields reachable.

### E2E

1. New spec (or extension) — explicit regression name for 2026-04-20 bug. Chromium only per ADR-007.

### Regression

1. Existing vacation in an older `.beanpod` file still loads and renders correctly with stored dates intact.
2. `FamilyActivity` calendar display continues to show trip span on the family planner.
3. `computeAccommodationGaps()` still works; output unchanged.
4. Existing wizard E2E (if any) still passes.

### Silent-failure sweep

- Grep touched files for empty catch blocks / silent `.catch(() => {})` — zero matches required.
- Verify all `console.error` / `console.warn` use grep-able prefixes.

### Final self-review

- Run `/simplify` skill over the consolidated diff before merge.

## Prompt Log

<details>
<summary>Full prompt history (direct implementation — no GitHub issue)</summary>

### Initial Prompt

> I'd like to address some issues with the travel plans feature to make it easier to use, and easier to create new travel plans without clear flights or plans booked yet.
>
> I created a travel plan today with the wrong dates. the plan was created, with round trip flights. when I moved the departing flight date later, rather than updating the plan dates, i was being shown an error for having unbooked accommodation before the start of my trip. the uopdated flight date should have been the new start date.
>
> This is a bug, but I realize that I think this is also an unclear UX. The trip start date should always be the date of the first item, and the end date should be the date of the last item, so if yuo take the first item and make it later, the start date should change, rather than leaving it the same, making it seem like you have unbooked accommodation.
>
> at the same time, in some cases a user may just want to quickly create a trip, without anything clearly booked yet, and only put the dates. this should also be possible.
>
> I'm proposing to update the travel plans flow as follows:
>
> On the initial travel plan creation scren, capture the trip start and end dates (along with the existing info captured such as trip type, etc).
>
> This becomes the start and end date of the trip, regardless if nothing else is saved for the entire trip wizard.
>
> The start and end dates shuld then be AUTOMATICALLY POPULATED to the travel legs - for example:
>
> - if user is booking a round trip flight, automatically populate the trip strt and end date in the outgoing and incoming flight date respsectively. If the user is booking a cruise, the cruise start and end date shoudl be auto populated in a similar way, etc. Follow this logic for all legs.
>
> After the start/end date has been set, if the user then changes the outgoing or incoming leg (flight, cruise, etc) then the trip start and end date automatically changes. The user can change the start and end date by adding legs, accommodation, etc.
>
> the start and end date should always be displayed on the trip summary page, and can always be manually changes. however, if there are travel plans outside of the start/end date range, show a warning and let the user know certain legs are planned outside of the trip start/end date. highlight those legs appropriately.
>
> Also, when adding a flight plan, the AIRLINE, FLIGHT NUMBER, etc should not be required if the booking is in the PENDING status. At the moment, it appears that airline and flight number are required even in pending status (at least in the UI, those fields have asterisks).
>
> Consult the front-end design skill for the best way to incorporate the trip start and end dates to the wizard and the overview
>
> I'm thinking that we should start by very clearing and obviously asking for date (which should be pre-populated), from, and to for airlines, at the top of the form. those fields should be obvious and clear, as they are the only required fields. the airline and flight number can be placed in the row below, as those are only required when status is booked.
>
> let me know your thoughts on these proposals, with the goal of making creating a travel plan easier and more intuitive.

### Follow-up 1 — after assistant's thoughts on the proposal

> Yes this looks good. Agree. Please do a full review of the travel plans with the goal of making it more user friendly and intuitive, and fixing the above bugs, run a full comprehensive pass and prepare a plan to implement required fixes

### Follow-up 2 — answers to clarifying questions

> 1. direct implement
> 2. require dates at trip creation. either start and end dates, or date + number of days and calculate
> 3. unify the field ordering across all locations

### Follow-up 3 — elegance / DRY / error-handling review

> Review the plan again to make sure you are implementing in the most optimal and efficient way, striving for elegance and simplicity, capturing ALL errors and never letting anything fail silently, and following all DRY principles - you are not re-writing or repeating any code.
>
> Check existing helpers, functions, composables, etc or other code where a solution already exists, check existing components and other reusable UI elements. If you are re-implementing _any_ code that already exists elsewhere, including a UI modal or component that exists elsewhere (or a very close version exists), function, helper, composable, etc, considering refactoring this into a generic item now as opposed to duplicating code and refactoring later.
>
> Ensure that there are never any silent failures. Everything with the potential to fail should be handled gracefully (i.e. a try/catch block or something similar as appropriate). Users should be shown informative error message, with direction for developers as well either in the error modal itself or on the console. Nothing should ever fail silently, and guidance on how to fix the error should always be available.
>
> Rewrite the plan ensuring that the design and flow and functionality is implemented in the simplest and most efficient/optimized way without any duplication, silent failures, overly complicated flows, or code bloat where not necessary.

### Follow-up 4 — answers to v3 clarifying questions

> 1. quick add chips are fine but user should also be able to manually at start and end date if desired
> 2. ok
> 3. ok
> 4. ok
>
> Let's review the plan again with a focus on long term sustainability, maintainability, and reliability. Ensure we are using strong coding practices and not putting ourselves in a situation where the app will become overly complex or difficult to support or maintain in the future. Check for deep nesting, overly coupled structures, or any other complexity that could lead to supportability, maintenance, or reliability issues that can be simplified.

### Follow-up 5 — answers to v3→v4 clarifying questions

> 1. go with your recommendation
> 2. ok
>
> Given the importance and complexity of this component, take one more pass at the plan and review again with fresh eyes. Review all activities proposed and confirm again that we are applying the most simple, secure, robust, and elegant solution, strictly following DRY principles, and avoiding introducing any bugs or side effects.
>
> Ensure that the relevant unit tests or end to end tests are created and/or revised to account for this change.
>
> Review the plan once more to ensure it is complete and accurate and follows the above guidance.

### Follow-up 6 — approval

> approved

</details>
