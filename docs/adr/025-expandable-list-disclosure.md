# ADR-025: A standard "show more / show less" pattern for windowed lists

> Status: Accepted
> Date: 2026-05-13
> Related: `docs/plans/2026-05-13-expandable-daily-briefing.md`

## Context

Several surfaces show "the first N of a long list, then a way to see the rest", and each had grown its own version:

- **`UpcomingActivities.vue`** and **`TodoPreview.vue`** — identical hand-rolled `visibleCount` ref + `showMore()` (+`PAGE_SIZE`) + a "View more" `<button>`. Neither could collapse back.
- **`FamilyStatusToast.vue`** (the Nook daily briefing) — capped at 5 (`MAX_ITEMS` in `useCriticalItems`) with a faint `+N more ↓` text-link that _scrolled to a different section_ ("Today's schedule"), which didn't even contain all the briefing items (to-dos / duties / medication reminders aren't in it). There was no way to actually read items 6+.
- **`NookTodoWidget.vue`** — a `MAX_VISIBLE` cap with a `+N more →` that _navigates to the To-Do page_. A deliberately different affordance: "go see the rest elsewhere", not "expand here".

No shared composable or component, three slightly different behaviours, one of them broken.

## Decision

**List windowing uses one composable + one component, and expands/collapses _in place_ — it never links away.**

- **`useExpandableList(source, { initial, step? })`** (`src/composables/useExpandableList.ts`) — the windowing state. `step` set → incremental ("Show more" reveals `step` more each call, "Show less" jumps back to `initial`); `step` omitted → all-or-nothing ("Show all", then back to `initial`). Returns `{ visible, total, canShowMore, canShowLess, showMore, showLess }`. Pure derived state; a single `watch` keeps the internal limit from lingering above the source length if the list shrinks.
- **`<ShowMoreToggle>`** (`src/components/ui/ShowMoreToggle.vue`) — the affordance. Props `canShowMore` / `canShowLess` / `moreLabel` / `lessLabel` (defaults to `t('action.showLess')`) / `tone`. Renders a full-width centred button for whichever of more/less is currently available (both at once in incremental mode), with a chevron that points down for "more", up for "less". Tones: `on-light` (Heritage Orange text on white cards — the default), `on-light-purple` (purple text, for to-do contexts), `on-accent` (white text on the Heritage Orange briefing card). Reduced-motion suppresses the chevron rotation.
- **`<SmoothHeight :revision>`** (`src/components/ui/SmoothHeight.vue`) — wrap the list region so the container grows/shrinks with a height transition and the new items are revealed by the opening clip-window, instead of snapping. Bump `revision` (e.g. `:revision="visible.length"`) when the list changes; only those deliberate changes animate (ordinary reflows leave `height: auto`), and `prefers-reduced-motion` skips it. Where a list also has a per-row entrance animation (the briefing's `critical-slide-in` stagger), the stagger restarts each "page" of `initial` rows (`animationDelay: (index % initial) * 60ms`) so the newly-revealed rows cascade from 0 in sync with the box opening, rather than 300 ms+ behind it.

**Exceptions:** `NookTodoWidget`'s `+N more →` stays a _navigate_ affordance (it takes you to the full To-Do page on purpose). Form-section disclosure ("More details") is a different concern and stays on `ConditionalSection`.

## Consequences

`FamilyStatusToast`, `UpcomingActivities`, and `TodoPreview` all consume the shared trio (`useExpandableList` + `<ShowMoreToggle>` + `<SmoothHeight>`); `useCriticalItems` no longer slices or computes an overflow count (a view concern); the broken scroll-to-schedule link is gone. New "first N of a long list" surfaces should reach for these rather than re-rolling them. Recorded in the beanies-theme skill under "List disclosure".
