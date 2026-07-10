# Plan: A trip in progress is labelled "completed" on the travel plans page

> Date: 2026-07-10
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-07-10-travel-trip-phase-badge.md`

> **No GitHub issue created.** This plan was approved for direct implementation. No Notion row either — greg asked to plan and fix directly.

## User Story

As a family on holiday, I want the travel plans page to say my trip is happening now, so that the app doesn't tell me my trip is over while I'm still on it.

## Context

`TravelPlansPage.vue` drives its trip status chips from `vacationCountdown(v)`, which is `daysUntilTrip(startDate)` — _days until START_. The moment a trip begins the count goes `<= 0`, so the chip flips to "✓ completed" and stays there until the end date passes.

The defect renders in **two** of the three `travel.completed` sites on the page:

| Line      | Location                                                      | Correct?                                                               |
| --------- | ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **L886**  | Upcoming-list card badge (`v-else-if vacationCountdown <= 0`) | **BUG** — an ongoing trip reads "✓ completed"                          |
| L1007     | Past-trips list card (`v-for="vacation in pastVacations"`)    | Correct — unconditional, and the list is past-only                     |
| **L1131** | Trip **detail-modal hero header** (`v-else` of `> 0`)         | **BUG** — opening the trip you're on shows "✓ completed" in the header |

The app already knows better. `src/utils/vacation.ts` exposes pure, tested helpers:

- `tripPhase(v, todayStr): 'upcoming' | 'today' | 'ongoing' | 'past'` (L384)
- `tripDayProgress(v, todayStr): {day, total} | null` (L406, guards NaN/missing dates)

`NookVacationCard.vue` (L46-76) already consumes both via a single `badge` computed returning a discriminated union — deliberately "so exactly one badge (or none) renders by construction — no parallel phase-gated `v-if`s to keep in sync". That is the reference implementation in two respects: one pure decision, evaluated **once** into a `computed`. `TravelPlansPage` does neither — it never calls the phase helpers, and it calls `vacationCountdown()` up to three times per render block.

Found while building the Play Store screenshot harness: the demo trip had to be reseeded as _upcoming_ to avoid shipping a listing screenshot showing a live trip marked completed (see the comment in `scripts/promo-video/seed.ts`).

Related precedent: Notion #26 "nook page says 'upcoming vacations' for ongoing vacations" (Done) fixed the same phase confusion on the nook only.

## Requirements

1. A trip that has started and not yet ended must NOT read "completed" — in either the list card **or** the detail-modal header.
2. An ongoing trip shows its progress ("Day 3 of 7"), matching the nook.
3. A trip starting today says so.
4. An upcoming trip keeps its existing countdown chip, unchanged (same number, same styling), in both places.
5. "Completed" is reserved for trips whose end date has passed.
6. The badge _decision_ exists in ONE place, shared by the nook card, the travel list card, and the travel detail header.
7. `npm run validate` green.

## Important Notes & Caveats

- Do NOT touch the L1007 chip — it is the only correct one.
- `daysUntilTrip` stays **signed** and untouched; it backs `VacationSidebarCard`, `VacationWizard`, `CalendarTripRibbon`. Do not "unify" it onto `daysBetween`, which is `Math.abs`.
- Evaluate the badge **once** per surface (computed for the header, per-item map for the list `v-for`). Repeated inline calls are the anti-pattern being removed.
- `tripBadge` returns `null` for an upcoming trip with no `startDate` AND for a malformed `startDate` (finite guard); the header pill wrapper must be badge-gated so no empty pill renders.
- Removing `vacationCountdown` affects nothing else — sorting, the ribbon and the sidebar use `daysUntilTrip` directly.
- Lint: `'✓'` is in the `vue/no-bare-strings-in-template` allowlist; all copy flows through `{{ t(...) }}` mustaches; `tripBadge` returns keys, not copy.
- TEST FILES: two exist. `tripPhase`/`tripDayProgress` are tested in `src/utils/__tests__/vacation.test.ts`; `daysUntilTrip` in `src/utils/vacation.test.ts`. New `tripBadge` tests go beside `tripPhase`.

## Assumptions

> **Review these before implementation.**

1. "Day 3 of 7" on the travel page, same as the nook, is the desired ongoing treatment.
2. The `today` phase reads "Starts today!" as it does on the nook.
3. No new i18n keys are needed — `vacation.startsToday`, `vacation.dayOfTrip`, `vacation.onNow` all ship.

## Approach

### 1. Extract the badge decision into `src/utils/vacation.ts` (pure)

Lift the _decision_ (not the rendering) out of `NookVacationCard.badge`. Three consumers justify the extraction.

```ts
export type TripBadge =
  | { kind: 'countdown'; days: number; labelKey: string; emoji: string }
  | { kind: 'status'; textKey: UIStringKey; params?: Record<string, string | number> }
  | { kind: 'completed' };

export function tripBadge(
  v: Pick<FamilyVacation, 'startDate' | 'endDate' | 'tripType' | 'tripPurpose'>,
  todayStr: string
): TripBadge | null {
  const phase = tripPhase(v, todayStr);
  switch (phase) {
    case 'past':
      return { kind: 'completed' };
    case 'today':
      return { kind: 'status', textKey: 'vacation.startsToday' };
    case 'ongoing': {
      const prog = tripDayProgress(v, todayStr);
      return prog
        ? {
            kind: 'status',
            textKey: 'vacation.dayOfTrip',
            params: { n: prog.day, total: prog.total },
          }
        : { kind: 'status', textKey: 'vacation.onNow' };
    }
    case 'upcoming': {
      if (!v.startDate) return null; // load-bearing: prevents extractDatePart(undefined) crash
      const days = daysBetween(todayStr, v.startDate);
      if (!Number.isFinite(days) || days <= 0) return null; // malformed date -> no badge, never "NaN"
      return {
        kind: 'countdown',
        days,
        labelKey: tripCountdownKey(v.tripType, v.tripPurpose),
        emoji: tripTypeEmoji(v.tripType, v.tripPurpose),
      };
    }
    default: {
      const _exhaustive: never = phase;
      void _exhaustive;
      return null;
    }
  }
}
```

**Why `Number.isFinite(days)` is required (not cosmetic).** For a well-formed truthy `startDate`, `tripPhase` reaches `'upcoming'` only when `start > todayStr`, so `daysBetween` (`Math.abs`) returns the correct positive countdown — the sign is provably safe. But for a malformed `startDate` (e.g. `'garbage'`), `extractDatePart` yields a value that sorts after `todayStr`, `tripPhase` still returns `'upcoming'`, and `daysBetween` returns **`NaN`**. `NaN <= 0` is `false`, so without the guard the chip renders literally "NaN". Today's card renders _nothing_ for such a trip (both `NaN > 0` and `NaN <= 0` are false). The guard preserves current behaviour.

**Do NOT rebuild `daysUntilTrip` on `daysBetween`.** `daysBetween` (date.ts:539) is `Math.abs(...)`; `daysUntilTrip` must stay signed (`vacation.test.ts:224` asserts `-5`) and five call sites rely on it.

**Type asymmetry is intentional.** `labelKey` is `string` because `tripCountdownKey()` returns `string` and the render sites already cast `as any` into `t()`. `status.textKey` stays `UIStringKey` because those keys are literals. Don't "tidy" it.

**`completed` stays a distinct variant.** Its copy differs by surface (travel uses `travel.completed` + "✓"; the nook never renders it).

### 2. `NookVacationCard.vue` consumes it

Replace the local `badge` computed with a thin computed wrapping `tripBadge(vacation.value, today.value)`. Keep `phase` (still used by the card title). Drop the now-unused `daysUntilTrip` import.

**Template field renames, in lockstep with the union shape change:**

- Countdown branch: `badge.n` → **`badge.days`**.
- Status branch: the union no longer carries a pre-translated `text`; render from key + params using the existing `.replace` pattern. For `vacation.onNow` (no params) the replaces are harmless no-ops.
- The nook renders only `countdown`/`status`; its trip is never `'past'` (the store's `upcomingVacations` excludes past), so `completed` is unreachable there and would render nothing anyway — identical to today's `null`.

### 3. `TravelPlansPage.vue` — migrate both buggy sites, evaluating the badge ONCE per surface

The page already destructures `todayISO` from `useToday()` (L425).

- **Detail-modal header (L1109-1136):** add `const selectedBadge = computed(() => selectedVacation.value ? tripBadge(selectedVacation.value, todayISO.value) : null)`. One `v-if="selectedBadge"` wrapper, switch on `.kind` inside. Flattens today's double nesting and prevents an empty pill.
- **List card (L871-888):** inside a `v-for`, so resolve once per item via a `badgesById` computed map keyed by `vacation.id`. Keep styling: gradient pill for `countdown`, slate pill for `completed`, slate/teal for `status`.

Then delete `vacationCountdown` (L522-524) and drop the `daysUntilTrip` import from the page.

### 4. `TravelPlansPage.vue` — fix `pastVacations`

`pastVacations` (L507-512) uses `new Date().toISOString().slice(0,10)` — **UTC** — so near midnight it can disagree with the local-day `tripPhase` the store uses for `upcomingVacations`; a trip could fall in neither list or both. It also never reacts to a day-roll. Redefine on the reactive local `todayISO`, single-sourcing "past" through `tripPhase`:

```ts
const pastVacations = computed(() =>
  vacationStore.vacations
    .filter((v) => tripPhase(v, todayISO.value) === 'past')
    .sort((a, b) => (b.endDate ?? '').localeCompare(a.endDate ?? ''))
);
```

### 5. Leave the past-trips list chip alone

The unconditional "✓ completed" at L1007 is correct.

## Files Affected

- `src/utils/vacation.ts` — add `TripBadge` + `tripBadge()` (with finite guard); no change to `daysUntilTrip`
- `src/components/vacation/TripBadgeChip.vue` — **NEW** (deviation, see below): renders the badge union; the two travel-page surfaces differ only in chrome (`variant`)
- `src/components/nook/NookVacationCard.vue` — consume `tripBadge`; rename template fields; drop `daysUntilTrip` import
- `src/pages/TravelPlansPage.vue` — render `<TripBadgeChip>` on the list card AND detail header; redefine `pastVacations`; delete `vacationCountdown`; drop `daysUntilTrip`/`tripCountdownKey` imports
- `src/utils/__tests__/vacation.test.ts` — unit tests for `tripBadge`
- `scripts/promo-video/seed.ts` — the demo trip returns to in-progress now the bug is fixed

### Deviation from the plan (recorded during implementation)

The plan had `TravelPlansPage` narrow the `TripBadge` union inline in its template. In practice that needed `as { days: number }`-style casts at every access, because a Vue template can't narrow a value pulled out of a `Map` mid-expression. Both surfaces render the same three variants and differ only in chrome, so the union is narrowed once inside a new `TripBadgeChip.vue` with a `variant: 'card' | 'header'` prop. Zero casts, and it deletes the header's double-nested `v-if` outright. The nook keeps its own markup: its countdown is a hero badge, not a chip.

## Acceptance Criteria

- [ ] A trip spanning today reads "Day X of N" in both places, never "completed"
- [ ] A trip starting today reads "Starts today!"
- [ ] A trip ending yesterday reads "✓ completed" and appears in the past list
- [ ] An upcoming trip shows its countdown chip exactly as before
- [ ] A trip with a malformed `startDate` shows NO badge — never "NaN"
- [ ] The nook card's badge is visually unchanged
- [ ] `tripBadge` evaluated once per surface; header pill renders only when a badge exists
- [ ] `pastVacations`/`upcomingVacations` partition cleanly across a local midnight roll
- [ ] `npm run validate` green

## Testing Plan

1. **Unit (`tripBadge`)** with an injected `todayStr` (no clock): upcoming / today / ongoing valid / ongoing missing `endDate` (→ `vacation.onNow`, no NaN) / past / upcoming with no `startDate` (→ null) / upcoming with a malformed `startDate` (→ null, asserting the finite guard).
2. **Existing tests unchanged**: `daysUntilTrip`'s `-5`/`0`/`5` assertions still pass; `tripPhase`/`tripDayProgress` suites untouched.
3. **Manual**: seed a trip spanning today → list card and detail header both show "Day 3 of 7"; nook card unchanged.

## Review Passes

- **Pass 1 (Initial draft)**: Extracted the nook's badge decision into a pure `tripBadge()`; proposed a `daysUntil`/`daysUntilTrip` refactor; asserted only two `travel.completed` renders.
- **Pass 2 (DRY + error handling)**: Found a THIRD buggy site (detail header L1131); killed a sign bug (rebuilding `daysUntilTrip` on the `Math.abs` `daysBetween` would break its tested `-5` and five callers); corrected the "`vacationCountdown` is now unused" claim; unified "past" via `tripPhase` on the reactive `todayISO`, fixing a latent UTC day-boundary bug; added an exhaustiveness `never` guard.
- **Pass 3 (Sustainability)**: Required the badge be evaluated once per surface (computed for the header, per-item map for the list `v-for`) rather than the repeated inline calls the draft implied; flattened the header's double-nested `v-if`; documented two intentional decisions (labelKey type asymmetry; `completed` stays a distinct variant).
- **Implementation**: `Number.isFinite` guard verified by removing it and watching the test fail with `{ kind: 'countdown', days: NaN }`. Fix confirmed in the real UI: the demo trip, which previously rendered "✓ completed" mid-trip, now renders "day 3 of 7".
- **Pass 4 (Fresh-eyes sweep)**: Proved `Math.abs` sign-safety for well-formed `'upcoming'` dates, but found a **NaN-rendering regression** on a malformed `startDate` — added the `Number.isFinite(days)` guard so such trips render no badge (matching today's behaviour) instead of "NaN". Made the nook template field renames explicit so the union-shape change can't silently blank the badge. Re-confirmed the `!v.startDate` guard is load-bearing, the nook's visual invariance holds, removing `vacationCountdown` touches nothing else, and no lint rule is tripped.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Context

Bug discovered by Claude on 2026-07-10 while building the Play Store screenshot harness: the demo trip, seeded as in-progress, rendered "✓ completed" on the travel plans page. The trip was reseeded as upcoming to avoid shipping a misleading listing screenshot.

### Initial Prompt

> /beanies-plan create the plan directly to fix

(greg had previously reviewed an issue preview for this bug and elected to skip the Notion row and plan the fix directly.)

</details>
