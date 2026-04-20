# ADR-023: Trip dates are user-owned, extend-never-shrink

> Status: Accepted
> Date: 2026-04-20
> Related: `docs/plans/2026-04-20-travel-plans-ux-refactor.md`

## Context

`FamilyVacation.startDate` and `endDate` were previously **derived fields** — `src/utils/vacation.ts::computeVacationDates()` scanned all segment dates and returned min/max, called from `vacationStore.createVacation` and `updateVacation` on every mutation. Trip dates had no independent existence; they tracked the envelope of segment dates at all times.

This caused the bug reported on 2026-04-20: moving an outbound flight later silently shifted and _shrank_ the trip window, leaving previously-valid accommodation appearing "orphaned" before the new trip start. The derivation was also in tension with the UX goal of "users can plan a trip with just dates — no bookings yet," since a vacation without segments had undefined dates and the UI had no first-class field to display.

## Decision

Trip `startDate` and `endDate` are **user-owned** fields:

1. **Set explicitly at trip creation.** Wizard Step 1 captures both dates; they are required to advance.
2. **Extended on segment mutation, never shrunk.** When a segment's date changes or a new segment is added with a date outside the current window, the corresponding trip boundary extends. Segment deletion and within-range edits never shrink the trip. The only way to shrink the window is a manual edit on the summary page.
3. **Manual editing is always allowed** from the summary page. Shrinking past existing segments surfaces an amber out-of-range warning (via `computeTimelineHints`) but never blocks.

The auto-extend logic lives in `vacationStore.updateVacation` (orchestration, MVO); the pure helpers (`extendTripDates`, `prefillSegmentDates`) live in `src/utils/vacation.ts` with no reactive or store dependencies.

`computeVacationDates()` is retained as a **seed fallback** in two narrow paths:

- `createVacation` when input lacks dates (defensive for programmatic / CRDT-merge edge cases).
- `updateVacation` when `existing.startDate` AND `existing.endDate` are both undefined (migration path for historical vacations saved before this ADR). Seed runs first, then `extendTripDates` applies to the merged set.

## Consequences

### Positive

- The reported bug is fixed at the root: segment moves never shrink the window.
- Users can plan a trip with just dates — no bookings needed.
- Trip dates are displayed and editable on the summary page as a first-class affordance.
- Segment dates auto-populate from trip dates on add (round-trip flight, cruise, first accommodation, etc.), removing redundant data entry.
- The `bookedErrors`-style premature validation can be decoupled from date handling, since trip dates are no longer computed on every save.
- No data migration required — existing vacations keep their stored dates; the seed fallback handles the `undefined`/`undefined` historical case lazily on first mutation.

### Negative / acknowledged

- Historical vacations whose segments drifted outside the stored window will immediately surface amber out-of-range warnings after deploy. This is correct behavior (the misalignment existed; it was just hidden) and is treated as an information surface, not a regression.
- The auto-extend rule is not perfectly intuitive in one edge case: if a user manually shrinks the trip and then imports or adds a segment that falls outside the new window, the trip extends again. This is consistent with "user-owned, extend-never-shrink" but could surprise users who expect the shrink to persist regardless. Mitigated by keeping out-of-range warnings visible so users see exactly what happened.

### CRDT behavior (unchanged from prior)

Trip dates are scalar fields that use Automerge's standard last-write-wins semantics on concurrent edits. If device A extends `endDate` to Jun 15 while device B (unaware of A's change) saves a segment that doesn't extend `endDate`, B's local `extendTripDates` computation may overwrite A's extension back to B's pre-merge value. This is identical to the prior derived-dates behavior — not a new concurrency hazard. Documented here so future readers don't assume "extend-never-shrink" offers stronger guarantees than CRDT provides.

## Alternatives considered

### A1: Keep derivation as-is

Rejected. The reported bug is the direct product of derive-on-every-mutation. Any fix that keeps derivation has to reinvent "don't shrink" through additional state (see A3 below), which is strictly more complex than making dates user-owned.

### A2: Derive with auto-shrink, but show a confirmation prompt before shrinking

Rejected. Modal prompts on routine edits are hostile UX. The problem isn't "user doesn't know shrinkage happened" — it's "shrinkage was never the right behavior for this domain."

### A3: Keep derivation, add a `pinned` flag per date

Considered. Would let users "pin" trip dates to opt out of derivation per-vacation. Rejected because:

- Adds a new boolean field with subtle semantics that'd need to be documented, migrated, and tested.
- Most users would immediately want it pinned, making the default wrong.
- Doesn't solve the "trip with just dates, no segments" use case cleanly.

## Implementation notes

- `computeVacationDates()` kept but scoped narrowly (seed fallback only). Callers other than the two fallback paths should be considered bugs.
- `extendTripDates(current, ...candidates)` is the on-mutation behavior. Pure function, no reactivity, guards against invalid ISO input with `console.warn` + skip.
- `prefillSegmentDates()` handles per-segment-type date auto-population on add via an exhaustive TypeScript `switch`. New segment types added to `VacationTravelType` fail compilation until handled.
- `computeTimelineHints()` extended with `detectOutOfRange` detector; other hint detectors also refactored into small per-concern functions composed at the top level.
