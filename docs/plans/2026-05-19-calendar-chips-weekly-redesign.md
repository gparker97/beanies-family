# Plan: Calendar chips + weekly redesign + activities-page cleanup

> Date: 2026-05-19
> Mockup: `docs/mockups/calendar-2026-05-19.html`
> Execution: **one plan, two sequential commits.** Phase A (monthly chips + page cleanup) lands first; Phase B (weekly mobile redesign + 2-week navigator strip) lands second on top of A. Both commits go straight to `main` per the project's linear-history convention.
> Coordination: Phase B touches `WeeklyCalendarView.vue` which is the same surface as `docs/plans/2026-05-19-calendar-drag-resize-haptics-phase-1.md` (not yet implemented). Landing Phase B first keeps drag/resize work building on the final layout instead of the soon-to-be-replaced one.

## Context

Today the monthly calendar renders timed activities as colored dots — readable as "something is happening" but not "what". Families have to tap each day to find the event they remember. The new design swaps dots for member-color chips with the category emoji, time, and a truncated title. On mobile (where the 7-col grid collapses to a vertical day-stack), family/multi-person events also get a right-edge avatar stack so users can tell "everyone is involved" vs "just the parents" at a glance.

The calendar carrying real information means the **Upcoming Activities** and **Todo Preview** sections below it become redundant — they duplicate what the calendar now shows. Phase A removes them, returning the activities page to a single-focus surface: vacations card → calendar → archived activities toggle. Net code removal: ~370 LOC across 3 files.

## Scope summary

| In Phase A (commit 1)                                                      | In Phase B (commit 2)                                                                                 | Out of scope (deferred)                                                                               |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `CalendarGrid.vue` dots → chips                                            | 2-week navigator strip in `WeeklyCalendarView`                                                        | `BaseChip` unification across the 5 chip components (deliberate follow-up to keep blast radius small) |
| Mobile day-stack: DOW labels, week separators, avatar legend               | Mobile weekly: replace pill-strip + single-day with horizontal-scroll 7-column grid (matching mockup) | Inactive-activities relocation to Settings (Option B in audit)                                        |
| New `MonthChip.vue` + `MonthDayCard.vue`                                   | Member-color event blocks on weekly (consistent with monthly chips)                                   | Drag-resize integration (separate plan, builds on Phase B)                                            |
| Remove `UpcomingActivities.vue`, `TodoPreview.vue`, `ActivityListCard.vue` | New `WeekStripNav.vue` (extracted if >60 LOC, else inline)                                            | E2E test additions (existing E2E adequate per ADR-007 Three-Gate Filter)                              |
| Remove 6 orphan i18n keys                                                  | Reuse `MonthChip`'s color/avatar helpers for week event blocks                                        |                                                                                                       |
| Unit tests for chip + day card                                             | Unit tests for week strip + weekly event color resolution                                             |                                                                                                       |

## Approach

### 1. Chip color + avatar rule (confirmed with greg)

A small pure helper, **co-located inside the new `MonthChip.vue` or its sibling** (not a new file unless reused elsewhere). Reuses existing utilities — does not introduce parallel logic.

```ts
// Returns the chip's visual classification for an activity occurrence.
// Uses familyStore.humans for the 0-assignee "everyone" stack — pets excluded.
function classifyChip(activity: Activity, humans: FamilyMember[]) {
  const ids = activity.assigneeIds ?? [];
  if (ids.length === 0) {
    // No assignees = whole-family event
    return { kind: 'family' as const, members: humans };
  }
  if (ids.length === 1) {
    // Solo: single member-color, no right-edge stack
    return { kind: 'solo' as const, memberId: ids[0]! };
  }
  // 2+ = family-styled chip, avatar stack = selected members only
  return {
    kind: 'shared' as const,
    members: ids.map((id) => humans.find((m) => m.id === id)).filter(Boolean) as FamilyMember[],
  };
}
```

The chip's left border color resolves as:

- `solo` → `getMemberColor(memberId)` from `src/composables/useMemberInfo.ts:90`
- `family` / `shared` → Heritage Orange (existing Tailwind token: `var(--primary-500)` / `theme('colors.primary.500')`)

The right-edge avatar stack renders **only on mobile** (Tailwind `md:hidden` block inside `MonthChip`) and **only when `kind !== 'solo'`** (mockup rule: solo chips stay clean — the left bar already says whose it is).

### 2. Category emoji — reuse existing helper

**Do not create a new emoji map.** `src/constants/activityCategories.ts:189-192` already exports `ACTIVITY_EMOJI_MAP`, and `getActivityFallbackEmoji(category)` at line 226 is the canonical resolver. Chip emoji = `activity.icon ?? getActivityFallbackEmoji(activity.category)`. Single source of truth, no parallel implementation.

### 3. New components

#### `src/components/planner/MonthChip.vue` (~80 LOC)

Props:

```ts
defineProps<{
  occurrence: ActivityOccurrence; // already used elsewhere in planner
  showTimeOnNarrow?: boolean; // default false; chip hides time at <1100px
}>();
```

Renders: `[left-bar][emoji][time][title][right-edge avatar stack — md:hidden, kind ≠ solo only]`. Tailwind-only styling. ARIA: `aria-label="{memberName(s)} · {category} · {time} · {title}"`. Click emits `view-activity` matching the existing CalendarGrid event signature so `FamilyPlannerPage` wiring is unchanged.

**Why not extract `BaseChip` now?** The 4 existing chips (`AllDayChip`, `AllDayActivityChip`, `HolidayChip`, `TravelSegmentChip`) all work; touching them is scope creep with non-trivial regression risk on a heavily-trafficked surface. The `BaseChip` unification is the right follow-up — flagged as a separate plan, not blocking Phase A.

#### `src/components/planner/MonthDayCard.vue` (~120 LOC)

Owns one cell of the month grid. Inputs: the day's date, its events (occurrences + holidays + travel segments + vacation flags), week-position, today flag. Encapsulates the rendering that's currently inline in `CalendarGrid.vue` lines 386-549. Output: emits `select-date`, `view-activity`, `holiday-click`, `vacation-click`, `view-segment` (matching existing CalendarGrid emit signatures).

Mobile-only affordances (Tailwind `md:hidden` blocks):

- DOW label above day number (`mon`, `tue`, …)
- Today highlight uses orange ring instead of background-flood

The 7-col grid → vertical day-stack collapse lives in CalendarGrid (the parent), not the card. The card just adjusts its internal layout when CalendarGrid hands it a `stacked` flag (or via a parent-side `flex-col` class on the wrapper).

### 4. Modified files

- **`src/components/planner/CalendarGrid.vue`** — Major refactor. Replace lines 472-487 dot row with a `<MonthChip v-for>` loop (up to 4 + "+N more" button). Replace lines 386-549 inline cell rendering with `<MonthDayCard>`. Add the mobile-only avatar legend strip below the toolbar (new template block, Tailwind `md:hidden`). Add the week separator that renders before each Monday on mobile (Tailwind `md:hidden` row). Day-cell visual cap math (`ALL_DAY_VISIBLE_CAP=2` at line 58) extended to account for the new timed-chip row — chips render after all-day/holiday rows.

- **`src/pages/FamilyPlannerPage.vue`** — Remove imports of `UpcomingActivities` + `TodoPreview` (lines 11-12). Remove their usage block (lines 622-628). Drop the wrapping two-column `<div class="grid grid-cols-1 gap-6 lg:grid-cols-2">`. Tighten the inactive-activities toggle (line 631-668): single-line button + collapse-by-default (already there) — no functional change, optional visual quieting to match mockup.

- **`src/services/translation/uiStrings.ts`** — Remove the 6 orphaned keys (verified used only in deleted files): `planner.upcoming`, `planner.noUpcoming`, `planner.todoPreview`, `planner.viewAllTodos`, `planner.onCalendar`, `planner.viewMore`. **Keep** `planner.upcomingAfterDay` (still used in `DayAgendaSidebar.vue:259`). Add new keys if needed for chip a11y labels (likely `planner.chipAriaLabel` template). Run `npm run translate` after to confirm parser still works (per project CLAUDE.md note about `scripts/updateTranslations.mjs`).

- **`src/components/planner/__tests__/CalendarGrid.test.ts`** — Existing tests (travel-segment chips, all-day lane) must still pass. Add 1-2 integration tests: "renders MonthChip for a timed activity" + "renders +N more when day exceeds cap".

### 5. Deleted files

- `src/components/planner/UpcomingActivities.vue` (128 LOC)
- `src/components/planner/TodoPreview.vue` (114 LOC)
- `src/components/planner/ActivityListCard.vue` (91 LOC) — verified orphan after the above two go; grep confirms no other importers

Total: **~333 LOC deleted**, ~200 LOC added (MonthChip + MonthDayCard + tests). Net: **~130 LOC smaller** despite the new functionality.

### 6. New tests

- **`src/components/planner/__tests__/MonthChip.test.ts`** (new)
  - Solo activity: renders member's color bar, no avatar stack
  - 0-assignee activity: renders Heritage Orange bar, family kind
  - 2+ assignee: renders Heritage Orange bar, avatar stack count matches selected
  - Emoji fallback: uses `getActivityFallbackEmoji` when `activity.icon` unset
  - A11y: `aria-label` contains member name + time + title

- **`src/components/planner/__tests__/MonthDayCard.test.ts`** (new)
  - Today flag renders orange treatment
  - DOW label renders (template still emits it; CSS controls visibility)
  - Holiday chip renders above timed chips
  - "+N more" appears past the cap, is a real `<button>` with focus

---

## Phase B approach (commit 2 — weekly redesign)

Phase B lands as a separate commit immediately after Phase A. It reuses the helpers, color resolver, and emoji map established in Phase A — no parallel implementation.

### Phase B scope

1. **2-week navigator strip above the weekly grid** — compact date pills aligned to the 7 timeline columns. Each pill: DOW + day-number + colored event-density dots. Today gets orange treatment; current week gets an orange accent strip on the left ("this · w 21"). Tapping a pill scrolls/navigates the timeline to that week. Renders on both desktop and mobile.

2. **Mobile weekly → horizontal-scroll 7-column timeline** — replaces the current `v-if="isMobile"` template (lines 687-770 in `WeeklyCalendarView.vue`) which shows a pill-strip + `<DayTimeline>` for a single day. The new mobile pattern is the same 7-column grid as desktop, wrapped in a `overflow-x: auto` container with `min-width: 720px`. Users see the shape of the week and can horizontally swipe to bring later days into view.

3. **Member-color event blocks on the weekly timeline** — currently events likely use category color (need confirmation in implementation). Phase B switches to the same resolver Phase A introduces: solo events get the assigned member's color, family/shared events get Heritage Orange. **Reuses Phase A's `classifyChip` helper** — promoted from `MonthChip.vue` into a small composable (`src/composables/useActivityChipClass.ts`) so both monthly chips and weekly event blocks consume the same logic.

### Phase B implementation

#### `src/composables/useActivityChipClass.ts` (extracted during Phase B)

Promotes the `classifyChip` function from inside `MonthChip.vue` to a reusable composable. Phase A puts it inside `MonthChip.vue` as a co-located helper; Phase B's first step is extracting it so both `MonthChip` and `WeeklyCalendarView` can call it. Pure function, ~25 LOC, unit-tested.

```ts
export function classifyActivityChip(
  activity: Activity,
  humans: FamilyMember[]
): { kind: 'solo' | 'shared' | 'family'; color: string; members: FamilyMember[] };
```

#### `src/components/planner/WeekStripNav.vue` (new, ~80-100 LOC)

The 2-week navigator strip. Props: `weeks: WeekData[]` (each = 7 days + a label), `today: ISODateString`, `focusedWeekStart: ISODateString`. Emits `select-date`. Renders inside the weekly card, between the toolbar and the day-of-week header row. Tailwind-only; aligned to the same `grid-cols-[56px_repeat(7,1fr)]` columns as the timeline below for perfect vertical alignment.

#### `src/components/planner/WeeklyCalendarView.vue` (refactor)

- Remove the `v-if="isMobile"` branch (lines 687-770) and its pill-strip + single-day template.
- Mobile rendering now uses the same desktop 7-column grid, wrapped in `<div class="overflow-x-auto md:overflow-visible">` with `min-width: 720px` on the inner grid (or equivalent Tailwind).
- Insert `<WeekStripNav>` between the toolbar (line ~418) and the day-of-week header row (line 422).
- Switch event-block color from category-color to the new `classifyActivityChip` resolver.
- `useBreakpoint()` import + `isMobile` ref likely become removable (verify no other usage in the file).

#### `src/composables/useCalendarSlide.ts` / `useCalendarNavigation.ts` (read-only — reuse)

Already-existing composables in `src/components/planner/`. Phase B's week-strip date-jump can reuse the navigation behavior these already encapsulate. Verify before adding new state.

### Phase B tests

- **`src/composables/__tests__/useActivityChipClass.test.ts`** (new) — same 3 cases as MonthChip's color resolution, now isolated as a pure-function test.
- **`src/components/planner/__tests__/WeekStripNav.test.ts`** (new) — renders 2 weeks, marks today, marks current week, emits select-date on pill click.
- **`src/components/planner/__tests__/WeeklyCalendarView.test.ts`** — likely already exists; verify existing tests still pass after the mobile-branch removal. Add 1 integration test confirming the strip renders above the grid.

### Phase B critical files

- `src/components/planner/WeeklyCalendarView.vue` (refactor)
- `src/components/planner/WeekStripNav.vue` (new)
- `src/composables/useActivityChipClass.ts` (new — extracted from MonthChip)
- `src/components/planner/MonthChip.vue` (update — consume the extracted composable)
- `src/components/planner/__tests__/WeekStripNav.test.ts` (new)
- `src/composables/__tests__/useActivityChipClass.test.ts` (new)

---

## Critical files

- `src/components/planner/CalendarGrid.vue` (refactor)
- `src/components/planner/MonthChip.vue` (new)
- `src/components/planner/MonthDayCard.vue` (new)
- `src/constants/activityCategories.ts` (read-only — reuse `getActivityFallbackEmoji`)
- `src/composables/useMemberInfo.ts` (read-only — reuse `getMemberColor`)
- `src/stores/familyStore.ts` (read-only — reuse `humans`)
- `src/pages/FamilyPlannerPage.vue` (delete imports + usage)
- `src/services/translation/uiStrings.ts` (remove 6 keys, optionally add 1)
- `src/components/planner/__tests__/MonthChip.test.ts` (new)
- `src/components/planner/__tests__/MonthDayCard.test.ts` (new)
- `src/components/planner/__tests__/CalendarGrid.test.ts` (extend)

## DRY notes

| Concern                 | Reuse                                                                                             | New                             |
| ----------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------- |
| Activity category emoji | `getActivityFallbackEmoji` + `ACTIVITY_EMOJI_MAP` (activityCategories.ts:189, 226)                | —                               |
| Member color            | `getMemberColor` (useMemberInfo.ts:90)                                                            | —                               |
| Human members (no pets) | `familyStore.humans` (familyStore.ts:62)                                                          | —                               |
| Heritage Orange         | Tailwind `primary-500` token                                                                      | —                               |
| Occurrence model        | `ActivityOccurrence` (already used in CalendarGrid + UpcomingActivities)                          | —                               |
| Chip primitive          | `AllDayChip.vue` pattern (left-bar + emoji + label) — visually informs but standalone for Phase A | `MonthChip.vue`                 |
| Day cell                | Inline CalendarGrid lines 386-549                                                                 | `MonthDayCard.vue` (extraction) |
| Avatar rendering        | Existing `BeanieAvatar.vue` + `useMemberAvatar`                                                   | —                               |
| Show-more pattern       | Don't reintroduce `ShowMoreToggle` — chip cap is "+N more" button, single state                   | —                               |

## Edge cases

- **Day with 4 timed events + 2 all-day chips + 1 holiday**: the cell shows holiday + 2 all-day + 2 timed chips + "+5 more" rolled into one overflow. Verify against existing `ALL_DAY_VISIBLE_CAP=2`.
- **Activity with `assigneeIds: []` AND inactive members in `humans`**: `familyStore.humans` already filters via `isActive`. Use it directly.
- **Activity with `assigneeIds` pointing to a deleted member**: the `.filter(Boolean)` after the `.find` discards missing members. The chip still renders as `shared` with the remaining valid avatars; if zero remain after filtering, fall back to `solo` semantics with `defaultColor` from `useMemberInfo`. Add as test.
- **Beanie mode + chip titles**: all chip text passes through `t()` for existing translation keys. Activity titles are user-authored and stay lowercase per existing rules — no transformation.
- **Dark mode**: Heritage Orange token works in both modes. Verify member colors meet WCAG AA contrast against Cloud White and dark slate backgrounds (existing `getMemberColor` already produces theme-aware values).
- **Mobile recurring activity**: chip rendering is per-occurrence, so a daily recurring activity renders one chip per day. Existing `expandActivitiesForMonth` unchanged — no recurrence-logic regression risk.

## Verification

### After Phase A (commit 1)

1. `npm run validate` clean (type-check + lint + format + unit tests + build).
2. `npm run dev` and walk through the **monthly** calendar at desktop, tablet (≤1100px), and mobile (≤720px) widths. Confirm:
   - Solo activities show single member-color bar + emoji + time + title.
   - Family (0-assignee) and shared (2+ assignee) events show Heritage Orange bar with avatar stack on mobile only.
   - DOW labels + week separators + avatar legend appear on mobile.
   - Holidays still render above timed chips.
   - Today highlight still works.
3. Open an activity drawer from a chip click — `view-activity` emit still wires through to `openViewModal`.
4. Verify `UpcomingActivities` + `TodoPreview` sections are gone from `/activities`.
5. Toggle "show archived activities" — inactive activities still render below the calendar.
6. Test beanie mode + dark mode — chip text reads correctly, contrast OK.
7. Run `npm run translate` to confirm `uiStrings.ts` parser still works after the 6 key removals.
8. **Commit Phase A** with a focused message before starting Phase B.

### After Phase B (commit 2)

1. `npm run validate` clean again.
2. `npm run dev` and walk through the **weekly** calendar at desktop, tablet, and mobile widths. Confirm:
   - 2-week navigator strip renders above the timeline on all widths.
   - Current week marked with orange accent; today marked with orange fill.
   - Event-density dots match the underlying day's events.
   - On mobile: full 7-column grid is horizontally scrollable; the old pill-strip + single-day pattern is gone.
   - Event blocks use member colors / Heritage Orange for shared events (same rule as Phase A's monthly chips).
3. Tap a pill on the strip — focused date advances; existing `useCalendarNavigation` behavior intact.
4. Verify drag-resize Phase 1 plan's intended surface is still recognizable (no premature breakage of the in-flight work).
5. **Commit Phase B** separately.

## Rollout

- **Two commits to `main`**, sequential, both unflagged:
  - Commit 1: `feat(planner): replace month dots with member-color chips + drop UpcomingActivities/TodoPreview`
  - Commit 2: `feat(planner): weekly redesign — 2-week navigator strip + 7-column mobile grid`
- Each commit is independently shippable. If commit 2 reveals an issue after commit 1 lands, commit 1 stays in prod and commit 2 is iterated on a follow-up commit.
- No feature flag — both changes are visual + structural, immediately better than today's behavior, and easy to revert via git if a surprising regression shows up.
- Coordinate with the drag-resize Phase 1 plan author: once both commits land, drag-resize is built on the final weekly layout.

## 4-pass review notes (per /beanies-plan discipline)

- **Initial draft** — covered: scope, files, tests, verification, two-commit rollout.
- **DRY / error-handling pass** — `ACTIVITY_EMOJI_MAP` reused (caught duplicate plan via Plan agent), `humans` reused, `getMemberColor` reused, `useCalendarNavigation` reused for the strip's date-jump, `classifyActivityChip` extracted to a composable so monthly chips AND weekly event blocks share one source of truth. `BaseChip` cross-chip extraction deliberately deferred with rationale. `.filter(Boolean)` edge case for deleted-member references explicitly handled.
- **Sustainability pass** — `MonthDayCard` extraction keeps `CalendarGrid` focused on grid-level math vs. cell rendering. Phase B's `useActivityChipClass` composable extraction makes future Phase X (e.g. drag-resize, a future calendar surface) consume the same classification logic without re-implementing. Test surface mirrors structure (one test file per new component/composable).
- **Fresh-eyes pass** — a11y (aria-labels on chips + "+N more" as real button + strip pills as real buttons), dark mode (color tokens not hexes), recurrence regression (low risk — store untouched), i18n script parser (`npm run translate` after key removal), drag-resize coordination flagged, two sequential commits keep each diff reviewable in isolation.
