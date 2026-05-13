---
date: 2026-05-13
category: feature
issue: 'None — direct implementation'
plan: 'docs/plans/2026-05-13-expandable-daily-briefing.md'
tags:
  [
    nook,
    daily-briefing,
    FamilyStatusToast,
    useExpandableList,
    ShowMoreToggle,
    UpcomingActivities,
    TodoPreview,
    frontend-design,
    adr-025,
  ]
---

# Expandable/collapsible daily briefing + a standard list-disclosure pattern

Make the Family Nook daily-briefing card expand to show all critical items (and collapse back to 5) instead of a faint "+N more" link that scrolled to a section that didn't contain them; extract a shared `useExpandableList` composable + `<ShowMoreToggle>` component; migrate the "Upcoming activities" + planner to-do-preview lists onto them (gaining "Show less"); document the convention (ADR-025 + theme skill).

## Prompt 1 — 2026-05-13 (the proposal, via `/frontend-design`)

> At the moment, when there are more than 5+ items, a message shows on the daily briefing box which skips you to the today's schedule section of the nook page, but that does not always include all the daily briefing items. Since the daily briefing is a list of critical activities that need to be done today, I'm thinking we should be able to expand (or contract) the box as needed to show everything. Can we implement the capability to expand the daily briefing box if more than X number of items exist, and also collapse it back to 5 if needed?
>
> Note that we already have the capability to expand the "upcoming activities" section on the activities page (but not the ability to collapse it back, which I think is a gap). Should we re-use or leverage this capability to expand any item or element, or just standardize this capability and make it a convention across the site?

→ Surveyed the existing surfaces (`UpcomingActivities` / `TodoPreview` hand-roll the same `visibleCount`+`showMore`; `NookTodoWidget` does a navigate-away `+N more →`; no shared code; the briefing's `+N more` scrolled to "Today's schedule", which omits to-dos/duties/meds). Recommended standardising. Built a mockup of the briefing card collapsed vs. expanded at two widths (`/tmp/beanies-briefing-mockup.html`) — a subtle in-card pill toggle ("Show all N ↓" / "Show less ↑"), chevron rotates, rows 6…N cascade in on the existing stagger. Asked the scope question.

## Prompt 2 — 2026-05-13 (scope answer)

> "Briefing + migrate + write it up" — the broadest option: expand/collapse the briefing; extract `useExpandableList` + a tone-aware `<ShowMoreToggle>`; migrate `UpcomingActivities` and `TodoPreview` onto them; document the pattern (theme skill + a short ADR).

## Prompt 3 — 2026-05-13 (review pass 1 — DRY / no silent failures / simplicity)

> Review the plan again … most optimal and efficient way … capturing ALL errors and never letting anything fail silently … following all DRY principles … Check existing helpers/components … refactor into a generic item now …

→ Confirmed there's no existing windowing composable (the 3 hand-rolled copies are exactly what's being consolidated); not built on `BaseButton` (its variants don't cover the white-on-orange `on-accent` pill, no chevron affordance); chevron reuses `<BeanieIcon name="chevron-down">`; `useCriticalItems` stops slicing/overflow-counting (net −LOC, no duplication added). No new failure surface — it's all read-only derived view state (no async/IO/orchestration), so try/catch would be an anti-pattern; `slice` is total; the lone `watch` is a robustness clamp, not an error path.

## Prompt 4 — 2026-05-13 (review pass 2 — sustainability / maintainability / reliability)

> Review the plan again with a focus on long term sustainability, maintainability, and reliability … Check for deep nesting, overly coupled structures, or any other complexity that could lead to supportability, maintenance, or reliability issues …

→ Dropped the "clever" `index % INITIAL_VISIBLE` animation-delay tweak (leave the existing `index*60ms` — a sub-second tail isn't worth obscure code; revisit only if the smoke test looks laggy); dropped `toggle()` and `hiddenCount` from `useExpandableList`'s API (unused — add back when a consumer needs them); kept the three-loops-in-one-computed shape in `useCriticalItems`; noted the Upcoming/TodoPreview migration is behaviour-preserving (only visible change: the new "Show less"); `<ShowMoreToggle>` is the standard "atomic component for the control" while `useExpandableList` is "composable for the state" — these consumers integrate `visible` into their own (sometimes date-grouped) templates, so a render/slot component wouldn't fit.

## Prompt 5 — 2026-05-13 (post-implementation: smooth expand)

> Looks very good, just one suggestion: when expanding the list (whether it's the activity list or daily briefing box, etc) rather than flash-expanding the box, can it smoothly expand with an animation?
>
> [follow-up] consult /frontend-design:frontend-design for thoughts

→ Added a third shared piece: **`<SmoothHeight :revision>`** (`src/components/ui/SmoothHeight.vue`) — a FLIP-style height-transition wrapper (capture old height → render new content → transition `from`→`to`, `320ms` snappy ease-out `cubic-bezier(0.22, 1, 0.36, 1)`; only `revision`-driven changes animate so window-resize reflows don't jitter; `prefers-reduced-motion` skips it). Wrapped the rows region in `FamilyStatusToast`, `UpcomingActivities`, and `TodoPreview` in it. Per the frontend-design lens (choreography: the box opening and the rows revealing should read as _one_ motion), **un-dropped** the `(index % CRITICAL_ITEMS_INITIAL_VISIBLE) * 60ms` stagger-reset on the briefing rows (with a comment) — newly-revealed rows now cascade from 0 in sync with the box opening, rather than 300 ms+ behind it; the on-load cascade is unchanged. Added `SmoothHeight.test.ts` (smoke); ADR-025 / theme skill / CHANGELOG / plan updated.

## Outcome

Implemented as planned, plus the smooth-expand follow-up. New `src/composables/useExpandableList.ts` + `src/components/ui/ShowMoreToggle.vue` (3 tones: `on-light` / `on-light-purple` / `on-accent`) + `src/components/ui/SmoothHeight.vue`. `useCriticalItems` returns the full sorted list (+ exported `CRITICAL_ITEMS_INITIAL_VISIBLE`); `FamilyStatusToast` expands/collapses via the shared trio and dropped the `show-full-schedule` emit; `FamilyNookPage` dropped `scrollToSchedule()`. `UpcomingActivities` + `TodoPreview` migrated (kept incremental paging, gained "Show less", wrapped in `<SmoothHeight>`). `nook.criticalMore` removed; `action.showAllN` added; `zh.json` regenerated. ADR-025 + a "List Disclosure" entry in the beanies-theme skill (+ component-reference rows) + CHANGELOG. New `useExpandableList.test.ts` (6) + `ShowMoreToggle.test.ts` (5) + `SmoothHeight.test.ts` (2); two `useCriticalItems.test.ts` cases updated. Plan: `docs/plans/2026-05-13-expandable-daily-briefing.md`.
