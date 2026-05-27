# Plan: Calendar space-reclaim — flush, compact, and auto-hide the planner chrome

> Date: 2026-05-27
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-05-27-calendar-space-reclaim.md`
> Mockup: `docs/mockups/calendar-space-reclaim-2026-05-27.html` (screens: The problem · Space budget · A · B · C · ★ Recommendation)
> Builds on: `docs/plans/2026-05-26-calendar-first-class-redesign.md` (the "first-class calendar" redesign this refines)

## User Story

As a beanies.family user planning my week on my phone, I want the calendar chrome (header + command bar + day strip) to take as little vertical space as possible — and never leave a dead gap above the calendar — so that I can see and tap the most events at once, while it stays **extremely clear and explicit what day, month, and family member I'm looking at** at any moment.

## Context

Yesterday's "first-class calendar" redesign (`717e317`) made the calendar the hero behind a sticky command bar with docked column headers. That was the right direction, but it introduced too much fixed chrome on mobile, and greg's testing surfaced two concrete problems:

1. **A dead gap above the calendar.** At rest, the view's sticky header (the mobile week strip / the desktop column headers) floats ~44px below the command bar — `FamilyPlannerPage.vue`'s root `space-y-6` (24px) plus the calendar card's `p-5` top padding (20px). Events scroll up into that gap in a band too short to read or tap. Only once scrolled does the header dock flush under the command bar — an inconsistent, wasteful at-rest state.
2. **Events "behind" the header on desktop.** The command bar is translucent (`bg-white/85 backdrop-blur-md`), so events scrolling underneath ghost through it. greg's expectation: "the header should be pinned and the events just scroll below it."

greg approved a three-lever fix from the mockup:

- **A · Flush + compact** — kill the dead gap, drop the redundant mobile page header, collapse the command bar to its tightest form, demote the trip ribbon to an inline chip.
- **C · Tight unified header** — keep all day/month/member context but make the command-bar + view-header stack as short and seamless as possible.
- **B · Auto-hide controls on scroll (Phase 2)** — as the user scrolls _down_ into events, the secondary controls row slides away; it returns on the first upward scroll. **The period label, nav, and the day strip stay pinned** so month + day context is never lost.

**Reconciling the mockup with the real code (important).** On inspection, the live implementation already avoids the mockup's headline "C" problem: the mockup assumed a duplicate weekday row stacked on the strip, but in reality `WeeklyCalendarView` renders the strip **only** on mobile (`v-if="isMobile"`) and the column headers **only** on desktop (`v-if="!isMobile"`) — they never coexist. So "C" is not "delete a duplicate row" (there is none); it is "make the existing single view-header dock flush and tight under a compacted command bar." Where the mockup and the real architecture/CIG disagree, **the beanies CIG + real architecture win** (greg's explicit instruction).

## Requirements

### Phase 1 — A + C (ship first)

1. **Kill the at-rest gap (mobile + desktop).** The view's sticky header (mobile strip / desktop column headers) must sit flush directly beneath the command bar **at rest**, not only after scrolling. No page-background band and no tall card padding between the command bar and the first calendar header row.
2. **Pin the command bar opaquely (mobile + desktop).** Events must scroll cleanly _beneath_ the command bar with nothing ghosting through it. Replace the translucent `bg-white/85 backdrop-blur-md` with an opaque surface (brand Cloud White / dark slate) plus the existing bottom border and a subtle "stuck" shadow.
3. **Compact the command bar (mobile).** Collapse to the tightest faithful form: trip ribbon becomes an **inline chip** in the controls row (no dedicated ribbon row), paddings tightened, period label sized within the typography scale. Net: remove one full row of height.
4. **Reclaim the mobile page header on the planner route.** On mobile/tablet, the planner currently shows the global `AppHeader` (hamburger + page title "our activities" + privacy/search/profile, fixed `h-16` ≈ 64px) **and** the command bar's period label below it — a redundant double title. On the planner route at the mobile/tablet breakpoint, **hide the global `AppHeader`** and let the `CalendarCommandBar` be the flush top bar, with a hamburger (menu access) on its top row beside the period + nav. Honors greg's "fully OK to drop the greeting." (Desktop is unaffected — see #7.)
5. **Preserve global affordances on mobile.** The hamburger (opens `MobileHamburgerMenu`, which contains the privacy toggle, language, currency, full nav incl. Settings, profile display, and sign-out) must remain on the command bar so those are not stranded. The **privacy toggle is intentionally not duplicated** on the command bar (it only masks financial figures — irrelevant on the calendar, and it's still in the menu). Likewise the AppHeader profile-avatar dropdown's **Edit Profile / Help / Refresh-all** actions are not re-homed — they're reachable via `/family`, the marketing Help site, and the menu/pull-to-refresh respectively; only Settings + Sign-out are required on this route and the hamburger menu already has them. Accept this as a deliberate, route-scoped reduction, not a silent regression. **Global search must be re-homed:** it currently lives ONLY in `AppHeader` (the `GlobalSearch` mount) — it is **not** in `MobileHamburgerMenu` (verified). So the reclaim must add a search affordance to the command bar's primary row. To avoid a second source of truth, **extract the search button + its `GlobalSearch` overlay mount + `showSearch` ref into a shared `SearchButton.vue`** (mirroring the `HamburgerButton` extraction) and use that same component in both `AppHeader` and the command bar — do **not** copy `AppHeader`'s search markup. Reuse the existing `t('search.placeholder')` aria.
6. **Clarity guarantees (hard constraint).** At every scroll position and in every view it must remain explicit: **which month/week** (period label), **which day** (the strip's selected/today pill on mobile; the column day-headers on desktop), and **which family member(s)** are filtered (the member-filter control's active state). None of these may be sacrificed for space.
7. **Desktop tweaks (no aggressive compaction, keep the consistent header).** Keep the `AppHeader` ("our activities") on desktop. Apply only: the flush/no-gap fix (#1), the opaque pinned bar (#2), and light spacing tightening. **No** mobile-style header reclaim and **no** auto-hide on desktop.

### Phase 2 — B (auto-hide controls, mobile only; ship after Phase 1 is validated)

8. **Auto-hide the controls row on scroll-down (mobile only).** When the user scrolls down past a small threshold, the command bar's secondary controls row (view toggle, member filter, trip chip, Add) collapses out of view. It returns on the first upward scroll. The collapse must be smooth and **reduced-motion aware**.
9. **Period + nav + member filter + strip stay pinned during auto-hide.** The command bar's primary row (hamburger + period label + prev/Today/next) **and the member filter** and the day strip remain pinned at all times so month + day + member context is never lost (per greg's decision — always explicit). Only the view toggle, Add, and trip chip collapse.
10. **No new scroll-listener leaks.** Reuse the app's existing visibility/scroll patterns; the `--planner-cmdbar-h` ResizeObserver must keep the strip docked flush as the controls row collapses/expands.

## Important Notes & Caveats

- **Mockup vs reality:** there is no duplicate weekday row to delete (see Context). Do not invent one. The strip (mobile) and column headers (desktop) are the single, essential view-headers and must stay.
- **`useScrollCollapse` was deliberately removed** on 2026-05-26 (the strip's scroll-driven smart-collapse was replaced by the manual "Peek next week" toggle because greg preferred a stable strip). Phase 2's auto-hide targets a **different** element (the command bar's _controls row_, not the strip) and the strip explicitly **stays pinned** — so this does not reintroduce the rejected behavior. Call this out in code comments to prevent a future "didn't we remove this?" revert.
- **Phase 2 — member filter stays pinned (greg's decision).** The member-filter control must remain visible at all times so it's always explicit which member(s) are being viewed. Therefore the member filter sits **outside** the collapsing controls wrapper, in the pinned region alongside the period/nav. Only the view toggle, Add, and trip chip collapse on auto-hide. (This overrides the default in the AskUserQuestion option text, per greg's "always explicit, avoid confusion" priority.)
- **`--planner-cmdbar-h` is the docking contract.** Both views dock their headers at `top: var(--planner-cmdbar-h)`. Keep this mechanism; it already updates via ResizeObserver. Any command-bar height change (compaction, controls-row collapse) must keep this var correct — it already will, because the observer watches the bar's `offsetHeight`.
- **Typography + brand discipline:** the period label is a Page/Section title — use standard scale classes only (`text-lg`/`text-xl`/`text-2xl`, never custom `text-[Xrem]`). Opaque bar uses Cloud White `#F8F9FA` / `dark:bg-slate-900`. Squircles, soft shadows, Heritage Orange for active states. No Alert Red.
- **i18n:** reuse existing keys (`planner.today`, `planner.addActivity`, `planner.agenda`, `mobile.menu` for the hamburger aria-label). Add new keys only if a genuinely new visible string appears; if so, add `en` + `beanie` and regenerate zh (`npm run translate`).
- **Don't crowd the mobile header with controls (CIG).** The reclaimed mobile top bar is hamburger + period + nav only — not a control bar. The secondary controls live in the command bar's own controls row beneath, exactly as today.
- **Existing DRY debt:** the profile dropdown is duplicated mobile/desktop inside `AppHeader`. We are **not** replicating it into the command bar (the hamburger menu covers profile), so we don't touch it — but note it as out-of-scope debt rather than copy it.
- **Don't create a second header:** the only command-bar additions are shared leaf components (`HamburgerButton`, `SearchButton`) reused from `AppHeader` — any future change to search/menu affordances changes one component, not two. The reclaim predicate (`headerReclaimed`) is defined once in `useMobileMenu`. This is the guardrail against the reclaimed mobile bar drifting from the real header over time.

## Assumptions

> **Review these before implementation.** Valid at planning time; verify if time has passed.

1. **Verified:** `MobileHamburgerMenu` provides the privacy toggle, language, currency, full nav (incl. Settings), profile display, and sign-out — but **NOT** global search and **NOT** a member filter (the member filter stays in the command bar). Global search lives only in `AppHeader`, so it **must be re-homed** to the command bar (see Req 5) — it is verified absent from the menu.
2. Hiding `AppHeader` only on the planner route at the mobile/tablet breakpoint does not break any layout that assumes the header is always present (e.g. `safe-area-inset-top` is on the column wrapper in `App.vue`, not the header, so the status-bar inset still applies — confirm).
3. The planner route is the only place this reclaim applies; all other pages keep the standard `AppHeader` on every breakpoint.
4. Making the command bar opaque does not regress the intended frosted aesthetic elsewhere — the frosted look was specific to this bar and greg has asked for opaque here.
5. `useReducedMotion()` returns `{ prefersReducedMotion }` (a ref, wired via `onMounted`/`onUnmounted`) — call it in component setup and gate **only the animation** (not the hide/show logic).
6. The planner route is `name: 'Activities'`, path `/activities` — `route.name === 'Activities'` is the cleanest `isPlannerRoute` check. The `<main>` element in `App.vue` is the `overflow-auto` scroll container and is the correct Phase 2 scroll target.

## Approach

### Phase 1

**1. Flush stack + opaque bar (`FamilyPlannerPage.vue`, `CalendarCommandBar.vue`, view headers).**

- In `FamilyPlannerPage.vue`, remove the root `space-y-6` (which inserts the 24px gap before the calendar) and apply spacing only where it's actually wanted (between the calendar view and the "inactive activities" block, and around non-sticky content) — e.g. wrap the trailing blocks rather than spacing the whole column. The command bar → calendar view boundary must have **zero** gap so the view's sticky header can reach the command bar's underside at rest.
- In the views WITH a docked sticky header (`WeeklyCalendarView.vue` desktop column headers + mobile strip wrapper, `DailyCalendarView.vue` member headers), let the sticky wrapper bleed to the card's top edge (mirror the existing `-mx-5` horizontal bleed with a vertical pull, or reduce the card's top padding above the sticky header) so at rest the header sits immediately under the command bar, matching the scrolled state.
- **`CalendarGrid.vue` (month view) has NO sticky DOW header** (its weekday row is a plain non-sticky `hidden md:grid` div, by design — the month grid scrolls as a whole). So for month view the fix is purely removing the at-rest gap (root `space-y-6` + card `md:p-5` top padding) — there is no sticky-docking change. Do not add stickiness to the month DOW row.
- **Re: the root `space-y-6` removal** — `space-y-*` only margins non-first in-flow element siblings. The trailing modal/overlay components (`ActivityModal`, `DayAgendaSidebar`, the `*EditModal`s, `VacationWizard`, `CreatedConfirmModal`) are Teleport/`v-if` overlays that render no in-flow element, so `space-y-6` never actually spaced them. The only real consumers are the command-bar→view boundary (the gap to kill) and the view→inactive-activities `<div>` (`FamilyPlannerPage.vue:521`, month-view only — gap to keep). Re-add a single `mt-*` on the inactive-activities block rather than re-wrapping the column.
- In `CalendarCommandBar.vue`, swap `bg-white/85 backdrop-blur-md` → opaque `bg-[#F8F9FA] dark:bg-slate-900` (Cloud White) keeping `border-b` and adding a subtle shadow so the pinned bar reads as a solid surface with events sliding beneath. Verify the view headers (already opaque `bg-white`) tile seamlessly beneath it.
- **Harden `publishHeight()` with try/catch** + `console.warn('[CalendarCommandBar] failed to publish --planner-cmdbar-h', e)` so a layout-measurement throw can never break the ResizeObserver loop (mirrors `usePollWhileVisible`'s safe-run pattern). The `setProperty` call and the observer callback are currently unguarded.

**2. Compact command bar (mobile) (`CalendarCommandBar.vue`, `CalendarTripRibbon.vue`).**

- Trip ribbon → inline chip: render `CalendarTripRibbon`'s existing mobile **summary pill** inline inside the controls row (right cluster) instead of on its own `mt-3` full-width row. Add a layout prop/mode to `CalendarTripRibbon` (e.g. `variant="inline"`) so it emits just the compact pill on mobile; desktop keeps its labelled ribbon row (or also chip-ifies under the light desktop tweak). Reuse the component — **do not** build a second trip chip.
- Tighten mobile paddings (`pt-4 pb-3` → `py-2`-ish on mobile) and keep the period label within the typographic scale.

**3. Reclaim mobile header (`App.vue`, `AppHeader.vue`, `CalendarCommandBar.vue`, new `HamburgerButton.vue`, new `useMobileMenu` composable).**

- **Extract `HamburgerButton.vue`** (`src/components/common/`) from `AppHeader`'s existing hamburger markup — a presentational button emitting `click`. Use it in both `AppHeader` (replacing the inline markup) and the command bar. DRY.
- **Introduce `useMobileMenu()`** (`src/composables/`) — a module-level singleton `isOpen` ref + `open()`/`close()`/`toggle()`. Replace `App.vue`'s local `isMenuOpen` + `AppHeader`'s `toggleMenu` emit with this composable so the command bar can toggle the same menu without prop-drilling through the page. `App.vue`'s `MobileHamburgerMenu` binds to `useMobileMenu().isOpen`.
- **Define the reclaim predicate once.** Add a single computed `headerReclaimed = (isMobile || isTablet) && route.name === 'Activities'`, exported from the shared menu composable (`useMobileMenu`), so `App.vue` and `CalendarCommandBar` cannot drift. `App.vue` hides the header with `<AppHeader v-if="!headerReclaimed" />`; the command bar renders its hamburger + search on the **same** `headerReclaimed`. `useBreakpoint` is already a module-level singleton, so this is free.
- In `CalendarCommandBar.vue`, add a mobile-only `HamburgerButton` on the left of the period+nav row (only rendered at the mobile/tablet breakpoint via `useBreakpoint`), wired to `useMobileMenu().toggle()`. Desktop: no hamburger (sidebar handles nav), header unchanged.
- **Re-home global search (required — not in the menu).** Add the shared `SearchButton.vue` (per the caveat above) to the command bar's primary row beside the hamburger, so search stays one tap away on the planner. (Search is verified absent from `MobileHamburgerMenu` — dropping it silently would be a regression.)
- **Template discipline:** the command bar's primary row composes named child components only (`HamburgerButton`, `SearchButton`), not new inline `v-if`-guarded markup blocks — the bar stays a shallow presentational shell. Phase 1 must place the **collapsible** secondary controls (view toggle, agenda action, Add, trip chip) in a **single isolated wrapper element** so Phase 2's auto-hide binding is a pure additive change. **The member filter is NOT in that wrapper** — it sits in the pinned region (per the member-filter-stays-pinned decision) so Phase 2 never collapses it.

**4. Clarity (no code beyond keeping the existing anchors).** The strip (mobile) / column headers (desktop) and the member-filter control stay exactly where they are in the pinned region. The period label stays in row 1. Verified by Requirement 6 acceptance checks.

### Phase 2 (B — auto-hide controls, mobile only)

- **New composable `usePlannerControlsAutoHide(scrollTargetGetter, options)`** (`src/composables/`): attaches a passive `scroll` listener to the `<main>` scroll container (the planner's scroll parent), tracks `lastScrollTop`, and returns a reactive `controlsHidden` ref:
  - Hide when scrolling down past a threshold (e.g. > 24px and beyond the first screenful).
  - Show on any upward delta or when at the top.
  - Clean up the listener on scope dispose (mirror `useHorizontalSwipe`'s `onMounted` attach + `onScopeDispose(detach)` lifecycle).
  - **Guard the scroll handler** in try/catch with `[usePlannerControlsAutoHide]` `console.warn` (+ optional `reportError({ surface: 'planner-controls-autohide', severity: 'warning' })`) so a throw never detaches the listener or spams. If the scroll-target getter returns null, warn `[usePlannerControlsAutoHide] scroll target not found — controls auto-hide disabled` and no-op rather than throw.
  - Gate the _animation_ (not the hide/show logic) with `useReducedMotion()`'s `prefersReducedMotion` ref — reduced motion snaps instantly.
- In `CalendarCommandBar.vue`, bind the controls row to `controlsHidden` (height/opacity transition). When collapsed, mark the row **`:inert="controlsHidden"`** — **not** a bare `aria-hidden` — so its focusable children (view toggle, member filter, Add) are removed from the a11y tree **and** the tab order in one go; a bare `aria-hidden` over tabbable controls is a WCAG 4.1.2 violation. Controls stay in the DOM (so the layout/ResizeObserver contract is unchanged and the binding is purely additive). Row 1 (hamburger + period + nav) and the strip are untouched. **Sever the ResizeObserver ↔ `--planner-cmdbar-h` feedback path:** dock the strip to the _stable pinned region_ (primary row + strip) so its `top` never moves while the controls row slides up behind it. The ResizeObserver must stay **ignorant of `controlsHidden`** (no auto-hide branching inside it) so the composable can be deleted later without leaving dangling references.
- Mobile-only: gate the whole behavior behind `useBreakpoint().isMobile` (and tablet if desired); desktop never hides.
- Code comment explicitly distinguishing this from the removed `useScrollCollapse` (different target, strip stays pinned).

## Files Affected

**Phase 1**

- `src/pages/FamilyPlannerPage.vue` — remove root `space-y-6`; re-add spacing only around trailing/non-sticky blocks.
- `src/components/planner/CalendarCommandBar.vue` — opaque bg; mobile compaction; inline trip chip; mobile `HamburgerButton` + `useMobileMenu`; mobile search button + `GlobalSearch` mount (re-home search); harden `publishHeight` (try/catch + `[CalendarCommandBar]` warn).
- `src/components/planner/CalendarTripRibbon.vue` — `inline` variant so the mobile summary pill can sit in the controls row.
- `src/components/planner/WeeklyCalendarView.vue` — flush sticky-header wrapper (no at-rest gap).
- `src/components/planner/DailyCalendarView.vue` — flush sticky-header wrapper.
- `src/components/planner/CalendarGrid.vue` — remove the at-rest gap above the month grid (driven by root `space-y-6` + card `md:p-5`); the month DOW row is non-sticky by design and is NOT docked under the command bar — no sticky-docking change.
- `src/App.vue` — hide `AppHeader` on mobile/tablet planner route; wire `MobileHamburgerMenu` to `useMobileMenu`.
- `src/components/common/AppHeader.vue` — use the extracted `HamburgerButton` + `SearchButton`; switch its toggle to `useMobileMenu`.
- `src/components/common/HamburgerButton.vue` — **new**, extracted hamburger (presentational, emits `click`).
- `src/components/common/SearchButton.vue` — **new**, extracted search button + self-contained `GlobalSearch` overlay mount + `showSearch` ref (shared by `AppHeader` + command bar; single source of truth).
- `src/composables/useMobileMenu.ts` — **new**, singleton menu-open state + the `headerReclaimed` reclaim predicate.
- Tests: `HamburgerButton.test.ts`, `SearchButton.test.ts`, `useMobileMenu.test.ts` (toggle + `headerReclaimed`), `CalendarCommandBar` (hamburger + search on mobile planner; inline trip chip; opaque class), `CalendarTripRibbon` (inline variant).

**Phase 2**

- `src/composables/usePlannerControlsAutoHide.ts` — **new**.
- `src/components/planner/CalendarCommandBar.vue` — bind controls row to `controlsHidden`.
- Tests: `usePlannerControlsAutoHide.test.ts` (direction, threshold, top-reset, reduced-motion, cleanup).

## Acceptance Criteria

- [ ] **At rest**, mobile and desktop, the view's first header row sits flush directly under the command bar — no dead gap, no band of page background or empty card padding (Req 1).
- [ ] The command bar is opaque; scrolling events are fully hidden beneath it (no ghosting) on both platforms (Req 2).
- [ ] Mobile command bar is one tighter block: period+nav row + a single controls row with the trip as an inline chip; no separate ribbon row (Req 3).
- [ ] On mobile/tablet planner, the global `AppHeader` is hidden and the command bar is the flush top bar with a working hamburger that opens `MobileHamburgerMenu`; profile/settings/sign-out reachable from it (Reqs 4, 5).
- [ ] Privacy toggle is absent on the mobile planner page; present everywhere else (Req 5).
- [ ] Month/week (period), day (mobile week-strip selected pill / desktop column day-headers), and family-member context — desktop day/week column-or-row member headers; **mobile day view via per-event member chips in `DayTimeline` plus the command-bar member-filter active state** — are visible at every scroll position in every view (Req 6). (Note the Phase 2 caveat below re: the filter control during auto-hide.)
- [ ] Desktop keeps the "our activities" `AppHeader`; gets only flush + opaque + light tightening; no auto-hide (Req 7).
- [ ] **Phase 2:** on mobile, scrolling down collapses only the controls row; period+nav+strip stay pinned; the row returns on upward scroll; reduced-motion snaps; no scroll-listener leak; `--planner-cmdbar-h` keeps the strip flush (Reqs 8–10).
- [ ] `npm run validate` green (type-check, lint, format, unit tests, build); zh regenerated if any new strings.

## Testing Plan

1. **Unit:** `HamburgerButton` renders + emits `click`; `SearchButton` mounts `GlobalSearch` and toggles its `open` on click (search re-homing is the headline regression-prevention — assert the wiring explicitly); `useMobileMenu` toggle/open/close singleton + `headerReclaimed` computed (true only on mobile/tablet + `Activities` route); `CalendarCommandBar` shows the hamburger + search only at the mobile/tablet breakpoint on the planner and renders the inline trip chip + opaque class; `CalendarTripRibbon` inline variant emits the summary pill; (Phase 2) `usePlannerControlsAutoHide` — hides past threshold on down-scroll, shows on up-scroll/at-top, respects reduced-motion, removes its listener on dispose; **assert the collapsed controls row is `inert`/untabbable** (not merely visually hidden), so the a11y fix can't silently regress.
2. **Type-check + lint + format:** `npm run validate`.
3. **Manual (desktop, dev server):** scroll the month/week/day views — header stays pinned and opaque, events scroll beneath with no ghosting, no at-rest gap; `AppHeader` still shows "our activities".
4. **Manual (mobile / responsive + real device — greg):** planner top bar is the command bar (no separate app header), hamburger opens the menu, no dead gap at rest, much taller event area; month/week/day all keep day/month/member clarity; (Phase 2) controls row hides on down-scroll and returns on up-scroll with the strip + period pinned.
5. **Regression:** existing planner E2E + unit suites pass; verify no other page lost its `AppHeader` (breakpoint/route guard scoped correctly).
6. **`#beanies-errors` watch** post-deploy for any fallout from the header-visibility/menu-state refactor.

## Review Passes

- **Pass 1 (Initial draft):** Drafted A+C (Phase 1) + B (Phase 2), reconciling the mockup against the real architecture (no duplicate weekday row; strip vs column headers are breakpoint-exclusive); root-caused the at-rest gap (`space-y-6` + card padding) and the desktop ghosting (translucent bar); proposed `HamburgerButton` + `useMobileMenu` extraction for the mobile header reclaim and a reduced-motion-aware `usePlannerControlsAutoHide` for Phase 2.
- **Pass 2 (DRY + error handling):** Verified reuse against the codebase. Corrected two false assumptions: global search lives only in `AppHeader` (NOT in `MobileHamburgerMenu`), so the mobile reclaim must re-home search (command-bar search button mounting `GlobalSearch`) — Req 5 + Assumption 1 updated; and `CalendarGrid`'s month DOW row is non-sticky (no docking), so its entry now reads "remove gap via padding," not "flush sticky header." Confirmed no `useMobileMenu`/scroll-direction/`useScrollCollapse` helpers exist (both new composables justified), `useReducedMotion` returns `{ prefersReducedMotion }`, safe-area inset is on the App.vue column wrapper (header-hide safe), planner route is `name: 'Activities'`, and `CalendarTripRibbon` already has the mobile summary pill + guarded localStorage (reuse for `inline`, no dup). Added no-silent-failure hardening: try/catch + `[CalendarCommandBar]` warn on `publishHeight`, and guarded scroll-handler + null-target warn in `usePlannerControlsAutoHide` (mirroring `usePollWhileVisible`/`useHorizontalSwipe`).
- **Pass 3 (Sustainability):** Hardened against long-term coupling: search is re-homed as a **shared `SearchButton.vue`** (not copied `AppHeader` markup) so the reclaimed mobile bar can't become a drifting second header; the `(isMobile||isTablet) && route==='Activities'` reclaim predicate is **defined once** (`headerReclaimed` in `useMobileMenu`) so `App.vue` and the command bar can't disagree (stranded-menu / double-header bug); the command-bar primary row composes named child components only (no new deeply-nested `v-if` markup) and Phase 1 isolates the controls row so Phase 2 is purely additive; and Phase 2's auto-hide **severs the ResizeObserver ↔ `--planner-cmdbar-h` feedback path** (dock the strip to the stable pinned region) with the observer kept ignorant of `controlsHidden` so the composable stays independently removable.
- **Pass 4 (Fresh-eyes sweep):** Verified every claim against `src/` (no test asserts the `bg-white/85`/`backdrop-blur` classes; `header-avatar*` testids are AppHeader-internal with no external dependents; route is `name: 'Activities'`; safe-area inset is on the App.vue column wrapper; `useReducedMotion`/`useBreakpoint`/`useHorizontalSwipe` shapes confirmed; the new files truly absent). Fixed one real a11y defect — Phase 2's collapsed controls row must be **`:inert`** (not a bare `aria-hidden`) since it holds focusable view-toggle/filter/Add controls (WCAG 4.1.2); named the deliberate route-scoped loss of the AppHeader avatar's **Edit Profile / Help / Refresh-all** on mobile planner (only Settings + Sign-out are required and the menu has them); corrected the acceptance criterion so mobile **day**-view member clarity is verified via `DayTimeline` per-event `MemberChip`s + the pinned filter (no mobile day column header exists); flagged the Phase 2 member-filter-hides-on-autohide clarity trade-off for greg; clarified that root `space-y-6`'s only real consumers are the command-bar→view boundary and the month-only inactive-activities `<div>` (modals are out-of-flow); and trimmed Phase 2 over-engineering by committing to "dock the strip to the stable pinned region" and dropping the rAF/`transitionend` fallback.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial prompt (/frontend-design, prior turn — context)

Greg asked for a revised mockup proposing options to reclaim vertical space on the calendar after the 2026-05-26 redesign: the sticky headers reduced visible calendar space, sit below the top of the screen, and events peek above the header in unusable space. Asked to compress / pull the headers to the top while keeping all info, and propose a few options in a mockup.

### Initial prompt (/beanies-plan, this task)

> Ok - let's ship A + C, and I'm fully OK to drop the greeting. I think the auto-hide is a good idea also, but agree that the day strip should stay pinned so the user always knows what day they are looking at. The goal is go gain back as space as possible while still ensuring it is extremely clear and explicit what day, month, family member, and other key details are being viewed at any given time
>
> Let's make a plan to implement this mockup. As always, strive for simplicity and elegance in both the plan and the implementation, and remember to always follow all DRY conventions. Review the mockup carefully and ensure you are faithfully representing and reproducing the carefully cultivated design, tone, and overall theme of the mockup, while at the same time strictly following the rules of the beanies theme and UI skill in terms of all relevant elements including colors, styles, layouts, font sizes, etc. If there is a discrepancy between the mockup and the beanies UI theme and CIG, the beanies UI theme / CIG always wins.
>
> Ask any clarifying questions as needed before preparing the plan. Once all requirements are clear, prepare the plan.

### Clarifying answers (AskUserQuestion)

- **Scope:** One plan, A+C+B (B as Phase 2).
- **Auto-hide behavior:** Hide only the controls row; keep period + nav pinned (day strip pinned in all cases).
- **Platforms:** "I'd like to update desktop also to remove the scroll behind and above the header, which is a strange feel for desktop - since we're not starved for space, shouldn't the header be pinned and the events just scroll below the header? we could also make the header more compact, as we're doing for mobile, but i don't think we need the auto-hide features, and we can keep the consistent app header (our activities) - that type of space saving is not required for desktop, but some tweaks to improve the UI and remove the events being shown above the header would help on desktop."

</details>
