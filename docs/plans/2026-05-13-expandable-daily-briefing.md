# Plan: Expandable/collapsible daily briefing + a standard list-disclosure pattern

> Date: 2026-05-13
> Related issues: None — direct implementation. Prompt log: `docs/prompts/2026-05/2026-05-13-expandable-lists.md`. Decision recorded in ADR-025.

## Context

The Family Nook **daily briefing** card capped its list at 5 items and, when there were more, showed a faint `+N more ↓` text-link that scrolled to the Nook's "Today's schedule" section (`#today-schedule`). That section only lists today's **activities** — not the to-dos / pickup-dropoff duties / medication reminders the briefing also carries — so the link went to the wrong place and there was no way to see the rest. (The unassigned + child-only briefing change shipped earlier today makes the >5 case more common.)

Three other lists already hand-rolled an "expand": `UpcomingActivities.vue` and `TodoPreview.vue` (identical `visibleCount` ref + `showMore()` + `planner.viewMore` button, **no collapse-back**), and `NookTodoWidget.vue` (`MAX_VISIBLE` cap + a `+N more →` that _navigates_ to the To-Do page — a navigate-away affordance, kept as-is). No shared composable/component.

Greg's call: make the briefing expand/collapse **and** standardise — extract a shared composable + component, migrate `UpcomingActivities` + `TodoPreview` onto it (they gain "Show less"), and document the pattern. Mockup of the briefing card collapsed vs. expanded at two widths: `/tmp/beanies-briefing-mockup.html`. The convention is for **list windowing**; form-section disclosure stays on `ConditionalSection`.

## Approach

- **NEW `src/composables/useExpandableList.ts`** — generic windowing primitive (replaces 3 hand-rolled copies). `useExpandableList(source: MaybeRefOrGetter<T[]>, { initial, step? })` → `{ visible, total, canShowMore, canShowLess, showMore, showLess }`. `step` set → incremental "Show more (+step)" / "Show less" → back to `initial`; `step` omitted → all-or-nothing "Show all" / "Show less". Pure derived state; a single `watch` keeps the internal `limit` from lingering above the source length if the list shrinks.
- **NEW `src/components/ui/ShowMoreToggle.vue`** — presentational affordance. Props `canShowMore` / `canShowLess` (default `false`) / `moreLabel` (caller-supplied) / `lessLabel?` (default `t('action.showLess')`) / `tone` (`on-light` default = Heritage Orange on white; `on-light-purple` = purple, for to-do contexts; `on-accent` = white, for the orange briefing card). Renders a full-width centred button for whichever of more/less is available (both in incremental mode), with a chevron that points down for "more", up for "less" (`rotate-180`, `motion-reduce:transition-none`). Reuses `<BeanieIcon name="chevron-down">`. Pure Tailwind, no scoped CSS.
- **NEW `src/components/ui/SmoothHeight.vue`** — wraps the list region so the box grows/shrinks with a height transition (`320ms` snappy ease-out) and the new items are revealed by the opening clip-window instead of the box snapping. FLIP-style: on a `revision` change (e.g. `:revision="visible.length"`) it captures the old height, lets the new content render, then transitions `from`→`to`. Only `revision`-driven changes animate (ordinary reflows leave `height: auto`); `prefers-reduced-motion` skips it.
- **`src/composables/useCriticalItems.ts`** — drop the `MAX_ITEMS` slice **and** `overflowCount` (a view concern); `useCriticalItems()` returns `{ criticalItems }` = the full sorted list (the existing internal `allCriticalItems` computed). `MAX_ITEMS` → exported `CRITICAL_ITEMS_INITIAL_VISIBLE = 5`.
- **`src/components/nook/FamilyStatusToast.vue`** — `useExpandableList(criticalItems, { initial: CRITICAL_ITEMS_INITIAL_VISIBLE })`; the rows `v-for` lives inside `<SmoothHeight :revision="shownItems.length">`; the `+N more` button → `<ShowMoreToggle tone="on-accent" :more-label="t('action.showAllN').replace('{count}', String(total))" …>`; removed the `show-full-schedule` emit. The per-row stagger delay is now `(index % CRITICAL_ITEMS_INITIAL_VISIBLE) * 60ms` so newly-revealed rows cascade from 0 in sync with the box opening.
- **`src/pages/FamilyNookPage.vue`** — dropped `@show-full-schedule` + the unused `scrollToSchedule()` (kept `id="today-schedule"` on `<ScheduleCards>`).
- **`src/components/planner/UpcomingActivities.vue`** + **`src/components/planner/TodoPreview.vue`** — behaviour-preserving migration to `useExpandableList({ initial: 6, step: 6 })` + `<ShowMoreToggle>` (`tone="on-light"` and `tone="on-light-purple"` respectively), the list region wrapped in `<SmoothHeight :revision="visible.length">`; visible changes vs. before: the new "Show less" once expanded, and the list grows/shrinks smoothly.
- **`src/services/translation/uiStrings.ts`** — added `action.showAllN` (`'Show all {count}'`), removed `nook.criticalMore` (dead); `npm run translate` regenerated `public/translations/zh.json`.
- **Docs** — NEW `docs/adr/025-expandable-list-disclosure.md`; "List Disclosure" entry added to `.claude/skills/beanies-theme/SKILL.md`; `CHANGELOG.md` (2026-05-13); this plan + prompt log.
- **Tests** — NEW `src/composables/__tests__/useExpandableList.test.ts` (6 cases: initial cap, no-toggle when ≤ initial, incremental show-more/clamp/show-less, all-or-nothing show-more/show-less, getter-source re-derive, clamp on shrink); NEW `src/components/ui/__tests__/ShowMoreToggle.test.ts` (5: renders/emits more, renders/emits less w/ default label, both buttons in incremental mode, renders nothing when neither flag, applies tone); updated the two `useCriticalItems.test.ts` cases that asserted the old 5-cap / `overflowCount` to assert the full un-capped list.

## Files affected

- NEW `src/composables/useExpandableList.ts`; NEW `src/components/ui/ShowMoreToggle.vue`; NEW `src/components/ui/SmoothHeight.vue`
- `src/composables/useCriticalItems.ts`; `src/components/nook/FamilyStatusToast.vue`; `src/pages/FamilyNookPage.vue`
- `src/components/planner/UpcomingActivities.vue`; `src/components/planner/TodoPreview.vue`
- `src/services/translation/uiStrings.ts` (+ `public/translations/zh.json` regenerated)
- NEW `docs/adr/025-expandable-list-disclosure.md`; `.claude/skills/beanies-theme/SKILL.md`
- NEW `src/composables/__tests__/useExpandableList.test.ts`; NEW `src/components/ui/__tests__/ShowMoreToggle.test.ts`; NEW `src/components/ui/__tests__/SmoothHeight.test.ts`; `src/composables/__tests__/useCriticalItems.test.ts` (2 updates)
- `CHANGELOG.md`; this plan; `docs/prompts/2026-05/2026-05-13-expandable-lists.md`
- _(no change: `NookTodoWidget.vue`, `ScheduleCards.vue`)_

## Verification

- `npm run translate` — uiStrings parse; `zh.json` gains `action.showAllN`, loses `nook.criticalMore`. ✓
- `npx vitest run src/composables/__tests__/useExpandableList.test.ts src/components/ui/__tests__/ShowMoreToggle.test.ts src/composables/__tests__/useCriticalItems.test.ts` — 54 pass. ✓
- `npm run validate` — type-check / lint / format / unit / build.
- `npm run dev` Family Nook smoke: ≤5 critical items → no toggle; >5 → "Show all N ↓" expands to all N (rows 6+ cascade in, chevron rotates) → "Show less ↑" collapses to 5; no `+N more` scroll. Planner "Upcoming" with >6: "View more" pages by 6, "Show less" resets. Planner sidebar to-do preview: same. Reduced-motion: no chevron spin.
