# Plan: Suppress the net-worth % change when the period's starting value is (effectively) zero

> Date: 2026-07-10
> Related issues: Notion #48 — https://app.notion.com/p/399247d9a99f81f49eb1dc9a5299b2c3
> Plan file: `docs/plans/2026-07-10-net-worth-percent-zero-baseline.md`

> **No GitHub issue created.** This plan was approved for direct implementation (Notion `github issue = do not create github issue`).
> **No feature gate.** Ships ungated (Notion `Feature gated? = No feature gate`).

## User Story

As a new beanies.family user, I want the net-worth card to show me only figures that mean something, so that my first month in the app doesn't greet me with "+5222708551936642048.0% this month".

## Context

The Piggy Bank / finance overview hero card renders a period-over-period percentage. Observed live: `+5222708551936642048.0% this month · +SGD $7,850.03`.

ROOT CAUSE (verified in code): `src/composables/useNetWorthHistory.ts:201`

```ts
const changePercent = startValue !== 0 ? (changeAmount / Math.abs(startValue)) * 100 : 0;
```

The guard is an EXACT `!== 0`. But `startValue` is not stored — it is reconstructed by `replayNetWorthHistory` (`src/utils/netWorthHistory.ts:82`), which walks backwards from `currentNetWorth` subtracting float deltas (`running -= ...delta`). When a family's accounts were all created inside the chart window, the deltas exactly cancel the current net worth in exact arithmetic — but in IEEE-754 they land on a residue instead of 0. The guard never fires and we divide by the residue. `7850.03 / 1.5e-13 * 100 ≈ 5.22e18`, matching the observed figure.

CRITICAL PROPERTY OF THE RESIDUE (drives the epsilon design below): the residue is NOT a fixed magnitude. `replayNetWorthHistory` accumulates rounding error roughly proportional to the magnitude of the running net worth: `error ≈ N_changes · 0.5 · ulp(|netWorth|)`. For the observed ~$7,850 portfolio the residue is ~1 ULP (~1e-13). For a plausible wealthy migrating family — say a $5M portfolio with ~1,000 change events, all created inside the window — the residue is ≈ `1000 · 0.5 · ulp(5e6)` ≈ `4.6e-7`, and a $10M+/1Y portfolio can push it past `1e-6`. Any epsilon that is a fixed absolute number therefore breaks down for large portfolios; the threshold must scale with the magnitude of the values involved.

This affects essentially every new user for their first month (any family whose first account was created inside the selected 1W/1M/3M/1Y window), regardless of portfolio size. The absolute change is correct; only the percentage is nonsense. Cosmetic — no stored data is wrong — but it is the headline metric on the finance surface of a money app, so it reads as broken.

Discovered 2026-07-10 while building the Play Store screenshot harness. `scripts/promo-video/seed.ts:61-67` currently backdates demo accounts by 120 days to work around it.

## Requirements

1. Treat a period start value that is effectively zero (negligible in absolute terms AND relative to the magnitude of the values being compared) as zero when computing the period-over-period percentage change.
2. When the baseline is effectively zero, the hero card renders NO percentage — only the absolute change (e.g. "+SGD $7,850.03 this month").
3. The percentage computation must be a PURE, unit-testable function (it is currently inline inside a Vue `computed`).
4. Genuine, realistic non-zero baselines are unchanged — existing correct percentages still render, with identical values. (The only baselines newly suppressed are ones smaller than `1e-9 ×` the end value — i.e. a sub-cent start against a >$10M end — which are indistinguishable from reconstruction residue and produce meaningless ~1e11% figures; suppressing those is the intent, not a regression.)
5. `npm run validate` green (type-check + lint + tests).

## Important Notes & Caveats

- Do NOT epsilon-guard `changeAmount`. When the baseline is a residue, `changeAmount ≈ endValue`, which is correct. The rare "everything is ~0 now and was ~0 then" case yields a residue `changeAmount` that the hero card renders as `+$0.00` — a pre-existing, harmless cosmetic edge, out of scope.
- Do NOT add `try/catch` around the new pure function. It has no throw path, and the composable's `chartResult` computed already wraps all construction (`useNetWorthHistory.ts:178-184`). Defensive handling here would be dead code. The bug being fixed IS the silent failure; the guard is the fix.
- Do NOT fold the two no-data guard returns into `computePeriodChange` (see Approach step 2). This is the single most likely future "DRY these together" refactor, and it would reintroduce the divide.

## Assumptions

> **Review these before implementation.** These were valid at the time of planning but may have changed.

1. `NetWorthHeroCard.vue` still gates the percentage span on `changePercent !== 0` (line 325) and keeps the change row alive via `changeAmount !== 0 || changePercent !== 0` (line 320).
2. `PeriodComparison` is referenced only inside `useNetWorthHistory.ts` (lines 35, 191) — nothing external imports it, so moving it into the util is zero-risk.
3. `DashboardPage.vue:139-140` passes `periodComparison` straight through and needs no change.
4. greg's design call (2026-07-10): hide the percentage entirely; no "new" chip, no placeholder. A genuine 0% change reading identically to a no-baseline period is accepted.

## Approach

Minimal blast radius. Two source edits + tests. No new files.

### Design decisions

**Representation.** Keep signalling "no meaningful percentage" as `changePercent: 0` rather than introducing `number | null`. The nullable option is more self-describing in isolation, but it would ripple a new branch into `NetWorthHeroCard.vue` (and any future consumer) to gain a distinction nobody currently needs (0% real change vs. no baseline). The `!== 0` gate already exists in the component today, so this preserves the existing contract. Documented in code so a future maintainer treats the sentinel as intentional, not as debt to "clean up".

**Epsilon.** Use a SCALE-RELATIVE threshold with an absolute floor, not a bare absolute epsilon. A bare `1e-6` would silently reintroduce the bug for large portfolios (see Context — residue scales with net-worth magnitude and can exceed `1e-6`). The threshold is `max(absoluteFloor, relativeEpsilon × max(|start|, |end|))`. The relative term (`1e-9`) sits ≈5+ orders of magnitude above the worst realistic accumulated relative error (≈`N · 2.2e-16`, i.e. ~`1e-11` even for `N = 1e5` events) and ≈3 orders below the smallest genuine relative baseline on any normal portfolio, so it cleanly separates residue from real money at every scale. The absolute floor (`1e-6`) governs small portfolios (where `scale × relEps` is below one sub-minor-unit) and the `end ≈ 0` case; it sits far above the small-portfolio residue (≈`1e-13`) and far below one minor currency unit (`0.01`, or `1` for zero-decimal currencies like JPY).

### 1. Extract the pure computation into `src/utils/netWorthHistory.ts`, and MOVE `PeriodComparison` there with it

Rationale for the move: the util is the return type's natural owner, and the util must NOT depend on the composable. If `PeriodComparison` stayed in the composable, `netWorthHistory.ts` would have to import a type from `useNetWorthHistory.ts` — a dependency inversion (utils→composable) and an architectural smell, since the composable already imports runtime functions from the util.

```ts
const ZERO_BASELINE_ABS_FLOOR = 1e-6;
const ZERO_BASELINE_REL_EPSILON = 1e-9;

export interface PeriodComparison {
  changeAmount: number;
  changePercent: number;
}

export function computePeriodChange(startValue: number, endValue: number): PeriodComparison {
  const changeAmount = endValue - startValue;
  const scale = Math.max(Math.abs(startValue), Math.abs(endValue));
  const threshold = Math.max(ZERO_BASELINE_ABS_FLOOR, scale * ZERO_BASELINE_REL_EPSILON);
  const hasBaseline = Math.abs(startValue) >= threshold;
  return {
    changeAmount,
    changePercent: hasBaseline ? (changeAmount / Math.abs(startValue)) * 100 : 0,
  };
}
```

### 2. `useNetWorthHistory.ts` — delegate the arithmetic

```ts
return computePeriodChange(first.value, last.value);
```

Import `PeriodComparison` + `computePeriodChange` from `@/utils/netWorthHistory`; delete the local `export interface PeriodComparison` (lines 35-38).

Leave the two "no data" guards (lines 193, 197) as literal `{ changeAmount: 0, changePercent: 0 }` returns — they are absence-of-data guards, not a computation over a start/end value. Add a one-line inline comment at each so a future maintainer can't safely "DRY the three identical returns together" and reintroduce the divide.

### 3. `NetWorthHeroCard.vue` — no change (verify only)

Line 320 keeps the change row alive; line 325 gates the percentage span. A zero-baseline period renders "↑ +SGD $7,850.03 this month" with no percentage.

### 4. `DashboardPage.vue` — no change (verify only)

Lines 139-140 pass the sentinel through unchanged.

Out of scope: reworking the backward walk; how opening balances are booked on `createdAt`; epsilon-guarding `changeAmount`; any hero-card redesign.

## Files Affected

- `src/utils/netWorthHistory.ts` — add `ZERO_BASELINE_ABS_FLOOR`, `ZERO_BASELINE_REL_EPSILON`, `PeriodComparison`, `computePeriodChange`
- `src/composables/useNetWorthHistory.ts` — import from the util, delete local `PeriodComparison`, delegate the arithmetic (keep the two no-data guard returns as literals, each with the clarifying inline comment)
- `src/utils/__tests__/netWorthHistory.test.ts` — new unit tests for `computePeriodChange`
- `src/composables/__tests__/useNetWorthHistory.test.ts` — regression test at composable level
- `scripts/promo-video/seed.ts` — soften the lines 61-67 comment so it no longer documents the bug as a live workaround (backdating stays; it also makes the demo chart look lived-in)

## Acceptance Criteria

- [ ] A family whose only account was created today shows NO percentage; the absolute change still renders.
- [ ] A small-portfolio float-residue baseline (~1e-13) is treated as zero.
- [ ] A LARGE-portfolio residue baseline that exceeds a bare `1e-6` absolute epsilon (e.g. `2e-6` against a `5e6` end value) is treated as zero — the scale-relative term catches it.
- [ ] A negative baseline still yields a correct sign on the change (`Math.abs` denominator preserved).
- [ ] Realistic genuine non-zero baselines produce byte-identical percentages to today (including a one-cent baseline on a normal portfolio).
- [ ] `npm run validate` green.

## Testing Plan

1. Unit (`computePeriodChange`, in `utils/__tests__/netWorthHistory.test.ts`):
   - exact-zero baseline (`0 → 100`) → `changePercent === 0`, `changeAmount === 100`
   - small-portfolio residue baseline (`1.5e-13 → 7850.03`) → `changePercent === 0` (regression for the observed bug)
   - LARGE-portfolio residue baseline (`2e-6 → 5_000_000`) → `changePercent === 0`. Would FAIL a bare `1e-6` absolute epsilon; regression test for the scale-relative fix.
   - negative baseline (`-1000 → -500`) → `changeAmount === 500`, `changePercent === 50`
   - normal baseline (`1000 → 1100`) → `changePercent === 10`
   - genuine small baseline preserved (`0.01 → 100`) → percentage computed
   - absolute-floor boundary (`endValue = 500`): start `1e-6` → computed; start `9.99e-7` → suppressed
   - relative boundary (`endValue = 1e9`, threshold ≈ 1): start `0.5` → suppressed; start `2` → computed
2. Unit (`useNetWorthHistory`): a family whose single account was created inside the window → `periodComparison.changePercent === 0` and `changeAmount` correct.
3. Manual: fresh family, add an account with a non-zero balance today, open /dashboard on 1W and 1M → absolute change only, no percentage.

## Review Passes

- **Pass 1 (Initial draft)**: Extracted the inline percentage math into a pure `computePeriodChange` helper in `utils/netWorthHistory.ts` with an absolute `1e-6` epsilon; card and page unchanged.
- **Pass 2 (DRY + error handling)**: Firmed the type-ownership call (MOVE `PeriodComparison` into the util to avoid a utils→composable dependency inversion), flagged that the two no-data guard returns must stay literals, and ruled out defensive `try/catch` around the pure function as dead code.
- **Pass 3 (Sustainability)**: Added in-code guardrails — inline comments at the two no-data guards plus a documented "0 is a deliberate sentinel" note — so a future "DRY these three returns" refactor can't reintroduce the divide-by-residue bug.
- **Pass 4 (Fresh-eyes sweep)**: Caught a real defect — the absolute `1e-6` epsilon is unsound because `replayNetWorthHistory`'s residue scales with portfolio magnitude (`N · ulp(netWorth)`) and exceeds `1e-6` for ~$5M+ portfolios, silently reintroducing the bug. Replaced with a scale-relative threshold `max(1e-6, 1e-9 × max(|start|, |end|))`; added the large-portfolio regression test; verified no missed consumers of `changePercent` / `PeriodComparison`.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Pre-plan handoff (Notion #48)

Assembled `=== BEANIES PRE-PLAN ===` block: bug, high priority, all platforms, `finance corner` view. Root cause verified in code. Open question resolved by greg: hide the percentage entirely when the baseline is effectively zero (no "new" chip, no placeholder). `generate mockup? = No`. `GitHub issue: SKIP`. `Feature gate: NO`.

### Initial prompt

> /beanies-plan pls implement

</details>
