# Plan: Assets Page Visual Polish

> Date: 2026-03-13
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-03-13-assets-page-visual-polish.md`

## Context

The Assets page mockup (`docs/mockups/assets-page-revamp.html`) includes visual refinements not yet in the live page. This plan implements the delta between mockup and current `AssetsPage.vue` with minimal changes, reusing existing components and patterns.

## Approach

After a full DRY audit, the mockup differences reduce to ~40 lines of changes with zero new files. All existing components (SummaryStatCard, CurrencyAmount, BeanieIcon) are reused as-is.

### Changes

| #   | Task                                           | File(s)                                        | Detail                                                                  |
| --- | ---------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------- |
| 1   | Extract `fade-slide-up` keyframe to global CSS | `src/style.css`, `src/pages/GoalsPage.vue`     | Move from GoalsPage scoped to global for reuse                          |
| 2   | Add `subtitle` values to stat cards            | `src/pages/AssetsPage.vue`                     | Wire existing `subtitle` prop with asset/loan counts and appreciation % |
| 3   | Add equity progress bar above loan panel       | `src/pages/AssetsPage.vue`                     | Inline 6-line bar showing equity % for assets with loans                |
| 4   | Loan details: inline text → 2-col grid         | `src/pages/AssetsPage.vue`                     | Restructure monthly/rate/lender into grid layout                        |
| 5   | Action dots hidden until hover                 | `src/pages/AssetsPage.vue`                     | `opacity-0 group-hover:opacity-100`                                     |
| 6   | Icon scale on hover                            | `src/pages/AssetsPage.vue`                     | `group-hover:scale-[1.08]` transition                                   |
| 7   | Notes left-border quote style                  | `src/pages/AssetsPage.vue`                     | Add `border-l-2` styling                                                |
| 8   | Card stagger animation                         | `src/pages/AssetsPage.vue`                     | Inline `animationDelay` + animation class                               |
| 9   | Translation keys for subtexts/equity           | `src/services/translation/uiStrings.ts`        | ~5 keys                                                                 |
| 10  | Fix SummaryStatCard subtitle font              | `src/components/dashboard/SummaryStatCard.vue` | `text-[10px]` → `text-xs` (CIG min 12px)                                |

### What we're NOT creating

- No new components (equity bar is 6 lines inline)
- No new composables (equity % is trivial inline calc)
- No GoalProgressItem reuse (it's a full list item, not a bare bar)
- No LoanInfoPanel extraction (only used on AssetsPage)

## Files Affected

- `src/style.css` — add `fade-slide-up` keyframe (+8 lines)
- `src/pages/GoalsPage.vue` — remove scoped keyframe (-8 lines)
- `src/pages/AssetsPage.vue` — all visual changes (~30 lines modified)
- `src/components/dashboard/SummaryStatCard.vue` — subtitle font fix (1 line)
- `src/services/translation/uiStrings.ts` — ~5 new keys

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt

> Now let's look at the assets page mockup just created yesterday once more with fresh eyes. What can we do to make it even more engaging and impactful?

### Follow-up 1

> This is looking better. Keep in mind the assets modal(s) need to be updated also and were in the previous mockups, please retain those

### Follow-up 2

> Let's make a plan to implement this updated mockup. As always, strive for simplicity and elegance...

### Follow-up 3

> Review the plan again to make sure you are implementing in the most optimal and efficient way, striving for elegance and simplicity, and following all DRY principles

### Follow-up 4

> Save the plan and start implementation, no need for a github issue

</details>
