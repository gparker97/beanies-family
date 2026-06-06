# Plan: Fix nook travel-plans message for ongoing/current vacations

> Date: 2026-06-06
> Related issues: Notion #26 (no GitHub issue — direct implementation)
> Plan file: `docs/plans/2026-06-06-nook-vacation-ongoing-message.md`

## User Story

As a family member viewing the Family Nook page, I want the travel-plans card to correctly describe a trip that is currently happening (not call it "upcoming"), so that the message always matches reality.

## Context

The Family Nook page renders a single travel teaser via `NookVacationCard.vue`, which displays `vacationStore.upcomingVacations[0]`. Two presentational bugs make an _ongoing_ trip read as "upcoming":

1. **Title is hardcoded to "Upcoming".** `NookVacationCard.vue:48` always renders `:title="t('vacation.upcoming')"` ("Upcoming Vacations" / "upcoming vacations"), even when the displayed trip started days ago and is currently in progress.
2. **Countdown hero badge vanishes once the trip starts.** The hero badge at `NookVacationCard.vue:86-97` only renders `v-if="countdown !== null && countdown > 0"`. `daysUntilTrip` returns 0 on the start day and negative while underway, so for an ongoing (or starts-today) trip the badge disappears entirely — leaving a card titled "Upcoming Vacations" with no countdown and no status. (Note: the badge's label text is produced by `tripCountdownKey(...)` → `travel.countdown.*` followed by "!", not a literal "days until trip" string — the user-visible number comes from `countdown`. This plan does not touch that hero-badge copy.)

Why ongoing trips reach this card at all: `vacationStore.upcomingVacations` (`vacationStore.ts:32-37`) deliberately keeps in-progress trips — it filters on `!v.endDate || extractDatePart(v.endDate) >= todayStr` (i.e. "not ended"), NOT on start date, and sorts by `startDate` ascending. `CalendarTripRibbon.vue` documents and depends on this exact behavior (its countdown text branches `>0 → "{n}d"`, `0 → "today"`, `<0 → "now"`). The getter has **four** consumers — `NookVacationCard.vue`, `CalendarTripRibbon.vue`, `TravelPlansPage.vue:243`, and `useNavBadges.ts:84` (`openIdeasOnUpcomingTrips`) — so the getter's _behavior_ must not change.

Past trips (`endDate < today`) are already excluded from `upcomingVacations`, so the nook never shows a past trip — the card simply doesn't render (`FamilyNookPage.vue:254` gates on `vacationStore.upcomingVacations.length > 0`). That is the correct "no message" for past trips; no change needed there.

## Requirements

1. When the displayed trip is **upcoming** (starts in the future), keep current behavior: title "Upcoming Vacations" + hero countdown badge (number + trip-type label).
2. When the displayed trip **starts today**, the title and badge must reflect that (not "upcoming" with a blank badge).
3. When the displayed trip is **ongoing** (started before today, not yet ended), the title must read as current/in-progress and the badge must show an appropriate status (e.g. "now" or "Day X of N").
4. **Past** trips remain unshown on the nook (no change).
5. Any _new_ user-visible strings go through `uiStrings.ts` with both `en` and `beanie` variants; Chinese regenerated via `npm run translate`. Reuse existing keys where they already fit (see Approach) — do not add duplicates.
6. No change to `vacationStore.upcomingVacations` _behavior_ (four consumers depend on it). A behavior-preserving readability refactor is allowed (see Approach).

## Important Notes & Caveats

- The card always shows exactly one trip (`upcomingVacations[0]` — the earliest-starting non-ended trip). When an ongoing trip and a future trip both exist, the ongoing one sorts first (earlier start) and is shown. This is acceptable; the card is a single-trip teaser, and the ribbon / `/travel` show the full list.
- **Reuse existing i18n keys where they fit.** `vacation.onNow` ("now" / "now", `uiStrings.ts:6097`) already exists (used by the ribbon at `CalendarTripRibbon.vue:89-90`) — reuse it as the no-end-date fallback badge. The ongoing-trip **title** uses a new key `vacation.happeningNow` ("Happening Now" / "happening now") — greg's chosen copy (the existing `vacation.inProgress` was considered and rejected as too cold for a section header).
- `daysUntilTrip` reads the real system clock via `new Date()` (`vacation.ts:354-359`); the store and `useToday` use the reactive `today` singleton. On a normal day these agree. The new classifier takes an explicit `todayStr` parameter (consistent with `classifyTripDay`/`tripDayNumber` in the same file, and testable) rather than calling `new Date()`.
- Date-dependent component behavior: per the established `useToday` test gotcha, any test that mounts the component must mock `@/composables/useToday`, not just `vi.setSystemTime`. The new pure helpers avoid this entirely by taking `todayStr` as a parameter (matching the existing `classifyTripDay`/`tripDayNumber` convention in `vacation.ts`).
- **Date-primitive asymmetry (verified).** In `vacation.ts`, `tripDayNumber` (lines 324-330) validates its inputs via `isValidISODate` and returns `null` on bad/missing dates, but `tripDurationDays(start, end)` (lines 364-368) does _not_ guard — it parses and subtracts unconditionally, so a malformed input yields `NaN`, not a throw. The `Day X of N` label helper must therefore treat a non-positive/`NaN` total as "uncomputable" and fall back, rather than relying on `tripDurationDays` to signal failure. This is made explicit in the helper (see Approach step 2). We deliberately do **not** retrofit a guard onto `tripDurationDays` — it has existing callers and changing its contract is out of scope; the new helper owns the validation at its own boundary.
- **`useToday` shape (verified).** `useToday()` returns `{ today: Readonly<Ref<string>>, ... }` (`useToday.ts:85-99`). `today` is `localToday()` — a `YYYY-MM-DD` string ref. The plan's `const { today } = useToday();` + `today.value` usage is correct, and the store already imports it the same way (`vacationStore.ts:15,31`).
- **`tripDayNumber` argument order (verified).** Signature is `tripDayNumber(isoDate: string, tripStart: string | undefined)` (`vacation.ts:324`). The plan calls `tripDayNumber(todayStr, v.startDate)`, mapping `todayStr → isoDate` and `v.startDate → tripStart`. This is the correct order — "the day-number of _today_ within the trip starting at _startDate_".
- **`t(... as any)` cast (verified).** The existing hero badge renders `{{ t(tripCountdownKey(...) as any) }}` (`NookVacationCard.vue:94`) — the `as any` is needed because `tripCountdownKey` returns a dynamically-built `string`, not a literal key union. The plan's `{{ t(badge.labelKey as any) }}` preserves this exact cast; `badge.labelKey` is likewise a dynamic `string`. Do not drop the cast.
- The status badge is derived in `vacation.ts` as a pure `tripDayProgress` helper (returns `{day, total} | null`) plus a thin phase→badge map in the component. `null` cleanly hides it. There is no throwing path (all inputs are validated strings or absent), and every missing-data branch returns `null` (never `undefined`/`NaN`) so the template can never render a half-formed badge.

## Assumptions

1. The only nook surface that mislabels travel state is `NookVacationCard.vue` (confirmed by exploration — `grep` shows it is the sole nook component reading a vacation; `FamilyNookPage.vue` only gates its render).
2. Showing "Day X of N" for ongoing trips is desirable; when the trip has no `endDate` (or the day/duration can't be computed), fall back to the existing `vacation.onNow` ("now").
3. The ongoing-trip title copy is "Happening Now" (greg's choice, 2026-06-06).

## Approach

**1. Add a single trip-phase classifier to `src/utils/vacation.ts`** (the established home for trip-lifecycle logic — it already hosts `classifyTripDay`, `tripDayNumber`, `tripDurationDays`, `daysUntilTrip`):

```ts
export type TripPhase = 'upcoming' | 'today' | 'ongoing' | 'past';

/**
 * Classify a vacation relative to `todayStr` (YYYY-MM-DD) into a lifecycle phase.
 * Pure + date-only lexicographic comparison (valid for ISO dates), matching
 * the convention of `classifyTripDay` in this file.
 *  - 'past':     ended before today
 *  - 'upcoming': no start date, or starts after today
 *  - 'today':    starts today
 *  - 'ongoing':  started before today and not yet ended
 * No startDate → 'upcoming' (preserves current card copy).
 */
export function tripPhase(
  v: Pick<FamilyVacation, 'startDate' | 'endDate'>,
  todayStr: string
): TripPhase {
  const end = v.endDate ? extractDatePart(v.endDate) : undefined;
  if (end && end < todayStr) return 'past';
  const start = v.startDate ? extractDatePart(v.startDate) : undefined;
  if (!start || start > todayStr) return 'upcoming';
  if (start === todayStr) return 'today';
  return 'ongoing';
}
```

**2. Add a pure `tripDayProgress` helper to `src/utils/vacation.ts`** that owns the "Day X of N" derivation _and its own validation_, so the component holds no date logic. Returns `null` whenever the label can't be safely formed — the single defense against the `tripDurationDays` `NaN`-on-malformed-input asymmetry noted above:

```ts
/**
 * "Day X of N" progress for an in-progress trip, or `null` when it can't be
 * computed (missing/invalid dates, or a non-positive/NaN duration). Pure;
 * `todayStr` is injected (no clock read). Owns validation at this boundary
 * because `tripDurationDays` does not guard malformed input (returns NaN),
 * whereas `tripDayNumber` returns `null` — this helper normalizes both.
 *
 * Returns the {day, total} numbers (not the localized string) so the i18n
 * substitution stays in the component layer, consistent with the ribbon.
 */
export function tripDayProgress(
  v: Pick<FamilyVacation, 'startDate' | 'endDate'>,
  todayStr: string
): { day: number; total: number } | null {
  if (!v.startDate || !v.endDate) return null;
  const day = tripDayNumber(todayStr, v.startDate); // null on bad/missing
  const total = tripDurationDays(v.startDate, v.endDate); // NaN on bad input
  if (day === null || !Number.isFinite(total) || total <= 0) return null;
  return { day, total };
}
```

Rationale: this returns the structured `{day, total}` rather than a pre-substituted string, keeping i18n key access (`t(...)`) and `{n}`/`{total}` substitution in the component layer where every other label in this codebase does it (matches the ribbon). The pure helper stays Vue-/i18n-free and unit-testable, and the `NaN` guard lives in exactly one place.

**3. Refactor `vacationStore.upcomingVacations` to express "not past" via the shared helper** (behavior-preserving — `tripPhase(v, todayStr) !== 'past'` reduces to `!end || end >= today`, provably equivalent to the existing `!v.endDate || extractDatePart(v.endDate) >= todayStr`). Centralizes the lifecycle definition:

```ts
const upcomingVacations = computed(() => {
  const todayStr = today.value;
  return vacations.value
    .filter((v) => tripPhase(v, todayStr) !== 'past')
    .sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''));
});
```

This is a readability-only change; all four consumers (`NookVacationCard`, `CalendarTripRibbon`, `TravelPlansPage`, `useNavBadges`) see identical output. The existing `vacationStore.test.ts > upcomingVacations` block already covers this getter and must still pass unchanged — that is the regression guard. (Add `tripPhase` to the existing `@/utils/vacation` import block at `vacationStore.ts:7-13`.)

**4. Update `NookVacationCard.vue`** to branch on phase, with a _single derived badge_ as the source of truth:

- Add to the existing `@/utils/vacation` import (lines 6-12): `tripPhase`, `tripDayProgress` (keep existing `daysUntilTrip`, `tripCountdownKey`, `tripTypeEmoji`, `bookingProgress`, `computeAccommodationGaps`). Add `import { useToday } from '@/composables/useToday';`.
- `const { today } = useToday();`
- `const phase = computed(() => (vacation.value ? tripPhase(vacation.value, today.value) : 'upcoming'));`
- **Title**: `:title="phase === 'upcoming' ? t('vacation.upcoming') : t('vacation.happeningNow')"`.
- **One badge model, mutually exclusive by construction.** Instead of two phase-gated badges, derive a single discriminated value so the template renders exactly one (or none) without `v-else` coordination:

```ts
type BadgeView =
  | { kind: 'countdown'; n: number; labelKey: string; emoji: string } // upcoming hero
  | { kind: 'status'; text: string } // today / ongoing pill
  | null;

const badge = computed<BadgeView>(() => {
  const v = vacation.value;
  if (!v) return null;

  if (phase.value === 'upcoming') {
    const n = v.startDate ? daysUntilTrip(v.startDate) : null;
    if (n === null || n <= 0) return null; // preserves existing hero-badge gate
    return {
      kind: 'countdown',
      n,
      labelKey: tripCountdownKey(v.tripType, v.tripPurpose),
      emoji: tripTypeEmoji(v.tripType, v.tripPurpose),
    };
  }

  if (phase.value === 'today') {
    return { kind: 'status', text: t('vacation.startsToday') };
  }

  if (phase.value === 'ongoing') {
    const prog = tripDayProgress(v, today.value);
    const text = prog
      ? t('vacation.dayOfTrip')
          .replace('{n}', String(prog.day))
          .replace('{total}', String(prog.total))
      : t('vacation.onNow'); // graceful fallback — never a blank/NaN badge
    return { kind: 'status', text };
  }

  return null; // 'past' never reaches the nook, but the branch is total
});
```

Template — two sibling blocks keyed off `badge.kind`, so they are mutually exclusive by data, not by parallel `v-if` gates:

```html
<!-- Hero countdown (upcoming only) -->
<div v-if="badge?.kind === 'countdown'" class="...existing hero classes...">
  <span class="...">{{ badge.n }}</span>
  <span class="...">{{ t(badge.labelKey as any) }}! {{ badge.emoji }}</span>
</div>

<!-- Status pill (today / ongoing) -->
<div v-else-if="badge?.kind === 'status'" class="...reuse existing teal pill classes...">
  {{ badge.text }}
</div>
```

This collapses the prior plan's separate `countdown` computed + `phase`-gated hero `v-if` + separate `statusBadge` computed into one `computed` whose shape _guarantees_ at most one badge renders. The hero badge's internal markup and copy are unchanged (still `{number}` + `tripCountdownKey` label + "!" + emoji); they are just sourced from `badge` fields. Keep the `as any` cast on `t(badge.labelKey)` — `labelKey` is a dynamically-built string, matching the existing `t(tripCountdownKey(...) as any)` cast at line 94. The status pill reuses the existing teal pill styling already used for the booking/`gapCount` chips — no new style block.

Net effect on `NookVacationCard`'s `<script>`: the existing standalone `countdown` computed (lines 26-28) is folded into `badge`. Verified: `countdown` is referenced **only** at its definition (line 26) and inside the hero badge (lines 87, 91) — no other template or script binding uses it, so removing it after folding into `badge` breaks nothing.

**5. i18n strings** in `uiStrings.ts` (en + beanie), then `npm run translate` to regenerate zh:

- Reuse `vacation.onNow` (fallback, line 6097) — no new key.
- Add `vacation.happeningNow`: `{ en: 'Happening Now', beanie: 'happening now' }` (ongoing-trip title).
- Add `vacation.dayOfTrip`: `{ en: 'Day {n} of {total}', beanie: 'day {n} of {total}' }`.
- Add `vacation.startsToday`: `{ en: 'Starts today!', beanie: 'starts today!' }`.

## Files Affected

- `src/utils/vacation.ts` — new `tripPhase` + `TripPhase` type and new pure `tripDayProgress` helper (alongside existing `classifyTripDay`/`tripDayNumber`/`tripDurationDays`).
- `src/stores/vacationStore.ts` — behavior-preserving readability refactor of the `upcomingVacations` filter; add `tripPhase` to the existing `@/utils/vacation` import.
- `src/components/nook/NookVacationCard.vue` — phase-aware title + single derived `badge` (countdown | status | null); add `useToday`, `tripPhase`, `tripDayProgress` imports.
- `src/services/translation/uiStrings.ts` — 3 new keys (`vacation.happeningNow`, `vacation.dayOfTrip`, `vacation.startsToday`); reuses `vacation.onNow`.
- Generated zh translation file — regenerated via `npm run translate` (do not hand-edit).
- `src/utils/__tests__/vacation.test.ts` — new `describe('tripPhase')` and `describe('tripDayProgress')` blocks.

No change needed in `CalendarTripRibbon.vue`, `TravelPlansPage.vue`, or `useNavBadges.ts` — the getter refactor is output-identical, but they are listed here as the regression surface to keep green.

## Acceptance Criteria

- [ ] Upcoming trip: title "Upcoming Vacations", hero countdown badge unchanged (same number + trip-type label + emoji + "!").
- [ ] Trip starting today: title "Happening Now", badge "Starts today!".
- [ ] Ongoing trip with end date: title "Happening Now", badge "Day X of N".
- [ ] Ongoing trip without end date (or uncomputable/NaN duration): title "Happening Now", badge "now".
- [ ] Past-only trips: nook card does not render (unchanged).
- [ ] At most one badge ever renders (countdown XOR status), guaranteed by the single `badge` discriminated value — no parallel `v-if` gates.
- [ ] New keys present in en + beanie; zh regenerated; `vacation.onNow` reused.
- [ ] `tripPhase` + `tripDayProgress` unit tests pass; existing `vacationStore.test.ts > upcomingVacations` still green; `npm run validate` green.

## Testing Plan

1. Unit-test `tripPhase` across all phases + missing-date edges: future-start, start==today, started-not-ended, ended-yesterday, no endDate (started → ongoing; future → upcoming), no startDate, neither date.
2. Unit-test `tripDayProgress`: mid-trip with valid window → `{day, total}`; start==today mid-window; missing endDate → `null`; malformed/invalid date → `null` (proves the `NaN`/`tripDurationDays` guard); zero/negative computed total → `null`.
3. Confirm `vacationStore.test.ts > upcomingVacations` passes unchanged (proves the refactor is behavior-preserving for all four consumers).
4. Manual: set a vacation's start/end around today (future / today / mid-trip / mid-trip-no-end) and verify the four card states render the right title + single badge.
5. `npm run validate` (type-check, lint, format, unit tests, build) and `npm run translate`.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted phase classifier + nook card branching + i18n; store filter refactor for DRY; past trips confirmed already correct.
- **Pass 2 (DRY / no silent failures / reuse)**: Verified against source. Corrected `vacation.onNow` copy ("now", not "on now") and confirmed it already exists; corrected the hero-badge label description (driven by `tripCountdownKey`, not a hardcoded string); surfaced the two missed getter consumers (`useNavBadges.ts`, `TravelPlansPage.vue`) and the existing getter test as the regression guard; consolidated status logic into one `string | null` computed with explicit non-throwing fallbacks (no blank/NaN badge); confirmed `tripDayNumber`/`tripDurationDays` already exist and are exported.
- **Pass 3 (Sustainability / maintainability / reliability)**: Verified all claims against source. Reduced complexity and coupling: (a) extracted the "Day X of N" derivation into a pure, unit-testable `tripDayProgress` helper in `vacation.ts`, removing the nested conditional from the component; (b) replaced the prior plan's three-part badge logic with one discriminated `badge` value, making "exactly one badge renders" a structural guarantee; (c) flagged the verified `tripDurationDays` `NaN`-on-malformed-input asymmetry and localized the guard at the new helper's boundary; kept i18n substitution in the component to match the ribbon convention.
- **Pass 4 (Fresh-eyes final sweep)**: No substantive changes — already robust. Re-verified every load-bearing claim against actual source: `tripTypeEmoji`/`daysUntilTrip`/`tripCountdownKey` imports present and used with the exact `(tripType, tripPurpose)` arg order; `useToday` exports `{ today }` as a `Readonly<Ref<string>>` YYYY-MM-DD ref; `tripDayNumber`'s signature is `(isoDate, tripStart)`, so `tripDayNumber(todayStr, v.startDate)` is the correct order; the standalone `countdown` computed is referenced only inside the hero badge, so folding it into `badge` breaks no other binding; `vacation.onNow`/`vacation.upcoming` exist; `tripDurationDays` confirmed un-guarded. Kept the `t(... as any)` cast on the dynamic label key.
- **Post-approval edit (light)**: Ongoing-trip title copy chosen by greg as "Happening Now" → new key `vacation.happeningNow` instead of reusing `vacation.inProgress`. Copy/key swap only; design unchanged, no pass re-run required.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt (via /beanies-pre-plan from Notion #26)

Fix nook travel-plans message for ongoing/current vacations. Current: nook page says "upcoming vacations" for ongoing vacations. Expected: if a vacation is currently ongoing, the text should reflect that (e.g. "ongoing vacations" or something friendlier for beanie mode). Scope: ensure the correct and appropriate message is displayed for upcoming, current, and past vacations on the nook view. GitHub issue: SKIP.

### Follow-up (copy decision)

Ongoing-trip title: greg chose "Happening Now" (over "Current Trip" / "In Progress" / "You're Away!").

</details>
