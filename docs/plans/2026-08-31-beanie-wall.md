# Plan: beanie wall — a tablet wall/table display mode for the family planner

> Date: 2026-08-31
> Related issues: Notion tracker #78 (no GitHub issue — direct implementation)
> Plan file: `docs/plans/2026-08-31-beanie-wall.md`
> Mockup: `docs/mockups/beanie-wall-2026-08-31.html`

## User Story

As a parent who has mounted a tablet in the kitchen, I want the family's week visible at a glance and safely tappable by everyone, so that the household runs without me having to be the schedule.

## Context

Families mount a tablet on the kitchen wall to run the household. The category today is either dedicated hardware ($299–$800: Skylight, Hearth, Cozyla, Greenlight Family Hub) or a dashboard subscription ($60–$96/yr: DAKboard, Mango Display). **Nobody serves "use the tablet already in your drawer, pay nothing."**

Two facts make this ours to win:

1. **Old iPads can only run a browser.** The iPads people are willing to mount are stuck on iOS 12–15. Google Calendar needs iOS 17, Cozi 17+, Fantastical 17.6. Every native competitor has abandoned exactly the device this use case runs on. A PWA reaches it by default.
2. **Local-first inverts Skylight's two loudest complaints.** Its #1 complaint is the $79/yr subscription; its most-documented bug class is silent sync failure; and it is "basically useless without Wi-Fi." beanies is free, offline-first, and can render last-known state.

The wall has **exactly two first-class jobs**: (1) see the plan, (2) see and complete your jobs. Everything else (meals, travel) is a bonus. This is why the jobs board is a peer full screen and not a drawer — chores in a drawer are second-class by construction, and the interactive ones (Hearth, Skylight) are what families actually pay for, while the read-only ones (DAKboard, Nest Hub) are not.

`docs/STATUS.md` already carries "build the tablet-friendly weekly calendar" as a committed NEXT item, and it gates the `/from/skylight` switching page, which is written and mocked but withheld because its hero claims this feature works today.

## Requirements

1. A deliberate, opt-in **wall mode** on its own chrome-free route, entered from Settings, exitable without a reset. The app is unchanged for anyone who never turns it on.
2. Works and looks intentional in **both portrait and landscape** at tablet sizes and up. Purpose-built layout per orientation, never a stretched phone view.
3. **Four peer screens**, reachable from one compact on-screen switcher (~150px, four glyphs with a divider before the fourth):
   - **A "the days"** — landscape: all 7 days as columns with vertical event lists. Portrait: 3 days as **columns** (not stacked rows) plus the remaining 4 as a tappable strip.
   - **B "bean lanes"** — one column per family member; portrait wraps (`auto-fit`, min 190px) so 5 beans read 3+2 and 7+ wrap further. Each lane carries that bean's events **and** their jobs.
   - **C "today first"** — today at full size with a "happening now" marker, the week as a strip beneath.
   - **J "the jobs board"** — one column per bean, big ticks, a star per job done, a green ring when a bean finishes everything, and a family progress bar.
4. **Events read vertically** (down = time) in every view. Never wrap a day's events into a horizontal grid — it destroys chronological scanning.
5. The jobs board carries a **back button** returning to whichever calendar view was last used (independent of the switcher).
6. **Jobs unify two sources behind one idea.** A **recurring** `FamilyList` is a chore list: its items merge into that owner's jobs. A **one-off** list is a shared list (grocery, packing) and stays whole at the foot of the jobs board. To-dos due today assigned to a member are also that member's jobs. A child only ever sees "my jobs" and never meets the distinction.
7. **Deduplicate** jobs: the same task can legitimately exist as both a to-do and a list item; the wall must show it once.
8. **Safe touches by default**: tick a job, open a read-only detail sheet, change day/view, filter by person. No create, edit or delete.
9. **Adult unlock via PIN step-up**, reusing the existing `ReauthChallenge` chain, granting temporary edit rights with automatic relock after inactivity.
10. The lock is an **icon only**. Its menu holds: unlock edits, start night mode now, and **leave the wall** (so a child cannot tap back into the full app).
11. Also on the wall: family lists/chores with check-off, Family To-Do, upcoming travel with real segment detail (flight legs, dates, nights), and meals (designed now, rendered when the `mealPlanner` flag flips).
12. **Adaptive layout**: render only the bonus cards that have content, so an empty meal plan gives its space back to the calendar.
13. **Finances structurally excluded** from this mode regardless of who is signed in.
14. **Night behaviour is a user choice**: dim and show a large clock face, or keep the schedule on all the time.
15. **Stay awake and stay fresh**: Screen Wake Lock re-acquired on `visibilitychange`; midnight day-rollover; resync on visibility and connectivity recovery; a visible "last updated" stamp so a stale wall is never silently wrong.
16. **Offline-first**: render last-known state, never blank.
17. A **wall setup helper** covering the ritual nobody solves in-product: Auto-Lock → Never, Guided Access, orientation, mounting and charging guidance.
18. Legible at ~3m: an explicit wall type scale and touch targets sized for children.
19. **A full-list completion earns a bigger celebration than a single tick.** Ticking the last outstanding item of a list fires a full-screen, non-blocking **bean shower** (falling Pod-coloured beans, the celebrating beanies, a handwritten message) that self-dismisses. This upgrades the existing completion moment for the whole app, not just the wall.
20. Built behind a dev feature flag (`beanieWall`) registered in `flagRegistry.ts` with committed prod state `false`.

## Important Notes & Caveats

- **⚠️ The manifest orientation constraint applies to the PWA manifest ONLY — not to native.** `vite.config.ts` sets `orientation: 'portrait'` because in an _installed PWA_ the manifest orientation **overrides the OS auto-rotate lock**, so `'any'` rotated the app against users who had rotation locked (Discord report, 2026-06-12). That is a web-manifest behaviour and does NOT generalise: iOS declaring landscape support does not override a user's rotation lock, and Android's runtime `setRequestedOrientation` is a per-Activity request that the wall can release and restore. Do not cite the 2026-06-12 regression as a reason to keep native portrait-locked. See Approach § Orientation.
- **⚠️ VERIFIED (Pass 2) — the chrome-less route loses three failure banners.** In `src/App.vue`, `ToastContainer`, `CelebrationOverlay`, `ConfirmModal`, `OfflineBanner` and `UnifiedReconnectToast` sit **outside** the `showAppLayout` branch (App.vue ~1790–1817) and therefore still render on a `noChrome` route. But **`PodAccessBanner`, `SaveFailureBanner` and `DurabilityBanner` sit INSIDE it** (App.vue ~2088–2098). A wall route with `noChrome: true` would therefore lose every "we can't reach your family's data file", "saving is failing" and "local cache is not durable" warning — the exact Skylight silent-sync-failure class we claim to beat. The wall's own status stamp is therefore **not decorative; it is the substitute failure surface** and must be bound to the same three signals. See Approach § The status stamp.
- **⚠️ CORRECTED (Pass 3) — the wall cannot suppress the celebration Undo from inside the wall tree.** `<CelebrationOverlay>` is rendered by `App.vue`, _outside_ the wall's component tree, and it is the component that renders the Undo button. Pass 2's "`WallShell` suppresses the undo affordance" is not implementable — a component cannot hide a button it does not render, and a watcher in `WallShell` that calls `dismissModal()` on a timer would be action-at-a-distance on shared module state. The mode must be owned by `useCelebration` itself. See Approach § Celebration on a shared screen. `useCelebration.ts` and `CelebrationOverlay.vue` therefore move from "NOT modified" to "Modified" — a ~15-line change to the owner is cheaper and safer to maintain than a remote watcher.
- **⚠️ NEW (Pass 4) — a member with no credential can be locked INTO the wall.** VERIFIED: `ReauthChallenge.vue` renders a terminal `noCredential` state (`data-testid="reauth-no-credential"`, template ~262–274) when the member has no passkey, no `pinHash` and no `passwordHash`. Since requirement 10 makes **leaving** the wall a step-up, a legacy member with no PIN would enter a screen they cannot leave in-product. The fix is a **precondition at entry, not a rescue at exit**: `WallSetupCard` refuses to start the wall unless the session member has a PIN (or password/passkey), and offers a direct "set a PIN first" link. See Approach § Who the lock verifies.
- **Do NOT re-propose continuous month scrolling.** It shipped in `ed4cd201` / `0d86cc07`. Read `docs/plans/2026-08-29-continuous-month-navigation.md` first — it documents a rolled-back wheel-paging attempt, the DOM-bounded sliding window, and the hand-verify-on-real-device rule.
- **ADR-012 defines only three breakpoint tiers** (<768 / 768–1023 / ≥1024) and no tier above 1024. A wall tier is an amendment to that ADR or a new one — not a silent invention.
- `.claude/skills/beanies-theme/SKILL.md` has **no tablet or large-screen guidance at all**. A wall tier section there is a deliverable of this work, not a follow-up.
- **Scrolling is a fallback, never the design.** A wall is read from across the room without touching it; an event scrolled out of view is an event nobody knows about. Dense days truncate with an explicit "+N more" affordance that opens the day.
- **Do NOT reuse `ActivityViewEditModal` for the read-only day/event sheet.** VERIFIED: it imports `useTransactionsStore`, `useAccountsStore`, `useRecurringStore` and `getCurrencyInfo` (`src/components/planner/ActivityViewEditModal.vue:14-19`). Reusing it would both break the finance-exclusion guard and drag ~1,000 lines of edit affordances onto a child-facing screen. The wall sheet is a small read-only renderer.
- The mockup's member colours are **stand-ins**; the real implementation uses `MEMBER_COLORS` (`src/constants/memberColors.ts`). Avatars are initials in the mockup where `BeanieAvatar` art goes.
- A shared display means **no personal notifications and no private content** on screen.
- `mealPlanner` is currently `false` in `featureFlags.committed.ts`. The meals card is built and gated, not stubbed.
- **`src/composables/` is flat** (133 files, only `__tests__` beneath it). Do not introduce `src/composables/wall/` — the `useWall*` prefix already namespaces these, and a one-feature subdirectory sets a precedent the other 133 files do not follow. `src/components/wall/` **is** consistent (`nook/`, `mealplan/`, `travel/` all exist) and stays.

## Assumptions

> **Review these before implementation.** They were valid at planning time and may have changed.

1. `FamilyList` still has a single `ownerId` and `FamilyListItem` still carries no assignee (VERIFIED `src/types/models.ts:687-735`); `TodoItem` still has `assigneeIds` **plus the deprecated singular `assigneeId`** (`models.ts:640-663`) — so assignee reads MUST go through `normalizeAssignees` from `@/utils/assignees`, never `todo.assigneeIds` directly.
2. `FamilyList.lifecycle` is still `'oneoff' | 'recurring'` and is still read through the predicates in `@/utils/listLifecycle.ts` (never inline `lifecycle === …` checks).
3. `ReauthChallenge.vue` still takes `{ member, open }` and emits `verified` / `cancelled` (VERIFIED `src/components/auth/ReauthChallenge.vue:34-45`), still renders as a bare panel requiring the caller to host it in a modal, and still has a terminal `noCredential` branch for members with no passkey/PIN/password.
4. `meta.noChrome` is still honoured by `shouldShowAppLayout` (`src/utils/appChrome.ts:20-25`) and `meta.requiresFlag` is still enforced by the router guard (`src/router/index.ts:499`).
5. `syncStore` still exposes `saveStatus`, `lastSync`, `driveFileNotFound`, `shouldShowSaveFailureBanner`, `shouldShowPodAccessBanner` and `cachePersistFailed`, and still runs `FILE_POLL_INTERVAL = 10_000` background file polling (`src/stores/syncStore.ts:2749-2860`).
6. `useToday` is still the app's single `visibilitychange`/`pageshow`/midnight sink and `useStaleTabRefresh()` is still wired once in `App.vue:1471`.
7. `mealPlanner` is still flag-gated and still `false`.
8. Screen Wake Lock remains unavailable on the oldest target iPads; the design must not depend on it.
9. `useCelebration.ts` is still 112 lines of module-level state exposing `{ toasts, activeModal, dismissModal }`, and `celebrate()` is still called by `listStore.toggleItem` / `todoStore.toggleComplete` (VERIFIED). The Pass-3 celebration-mode change assumes this shape.
10. `eslint.config.js` still supports per-glob override blocks (VERIFIED: two already exist, at `:316` and `:327`), so a `no-restricted-imports` zone for the wall tree needs no new lint infrastructure.
11. **Orientation state, verified Pass 4.** `android/app/src/main/AndroidManifest.xml:12` still carries `android:screenOrientation="portrait"` on the single Activity; `ios/App/App/Info.plist:132-142` still declares portrait-only for iPhone and portrait **+ LandscapeLeft/LandscapeRight for iPad**; `@capacitor/screen-orientation` is **not** in `package.json` (Capacitor 8 line); and there is no orientation-locking code anywhere in `src/`.
12. Android's runtime `setRequestedOrientation` (what `@capacitor/screen-orientation`'s `unlock()`/`lock()` call) **overrides the manifest attribute for the life of the Activity**, and the manifest value reapplies on Activity re-creation / cold start. This is the mechanism the Pass-4 orientation design depends on — it is documented Android behaviour but is listed here as **verify-on-device before the Android work package is considered done**.

## Approach

### Orientation — per-runtime, because the platforms differ

The goal: the wall may be landscape; every other screen keeps today's portrait behaviour exactly. The mechanism differs per runtime, so state each explicitly rather than generalising. All four runtimes are in scope for landscape — the difference is _when_ each ships, not _whether_.

- **Browser tab (the primary target, and the only runtime old iPads can use): works today, no change.** Manifest orientation does not apply to a normal tab, and iOS Safari ignores it entirely. The wall renders from CSS orientation/aspect queries at whatever size it is given.
- **Native iPad: already supported, no native change needed.** `Info.plist` already declares `UISupportedInterfaceOrientations~ipad` with `LandscapeLeft` + `LandscapeRight` (iPhone stays portrait-only), and there is no orientation-lock code anywhere in `src/`, so the native iPad app already rotates freely. A family that downloads beanies on an iPad and mounts it gets landscape wall mode with zero extra work. This is an **acceptance criterion to confirm on device**, not a change to make.
- **Installed PWA (Android): attempt `screen.orientation.unlock()`** on entering the wall, inside a `try/catch`, and re-lock on exit. **Verify on a real device** — treat "unlock() releases a manifest-applied lock" as an assumption to test, not a fact. Fallback if it does not: that runtime mounts portrait, and the setup guide says so. The manifest itself is **not** changed; nothing about any other screen moves.
- **Native Android: the one runtime that needs new code.** The Activity is manifest-locked to portrait. Resolution: add the official **`@capacitor/screen-orientation`** plugin and have **the wall route release the lock on entry and restore `portrait` on exit**. The manifest attribute stays exactly as it is and becomes the _declarative default_: any cold start, process death, or Activity re-creation lands portrait with no code involved.

**Why release/restore beats lock-at-boot.** An earlier shape of this plan locked portrait at app boot _and on resume_, then let the wall unlock. That inverts the safety property: it makes every non-wall screen depend on our code succeeding, so one failed lock leaves the whole app rotatable, and it adds a boot-path side effect for a feature 100% of users have switched off. Release/restore keeps the OS-level default authoritative and confines our code to the one route that wants something different. The residual risk — a failed _restore_ leaves the app rotatable until the next cold start — is bounded, reported, and belt-and-braced by restoring from **two** places:

1. `useWallOrientation`'s `onScopeDispose` (the normal path), and
2. a router `afterEach` that restores portrait whenever the destination is not the wall route — so back-button, deep-link, session expiry and error-boundary navigations are all covered, not just clean unmounts.

Both call the same idempotent `restore()`; calling it twice is a no-op.

**One module owns orientation.** `src/composables/useWallOrientation.ts` is the only place in the codebase that knows either mechanism exists. It branches once on `isNative()` (`@/services/sync/capabilities`) → Capacitor plugin, else `screen.orientation` when present, else no-op, and exposes `{ supported, release(), restore() }`. Everything is `try/catch`; a failure is a `logEvent warn`, never a throw, and never blocks entering or leaving the wall. Putting the branch in one module is what stops "unlock here, relock there" logic from being copy-pasted into the page, the lock menu and the router guard.

**Costs to accept openly.** (a) The plugin is a **new native dependency**: Android landscape cannot ship in a web-only deploy and needs fresh signed builds for both stores. It is therefore sequenced as its own work package (phase 8) — the wall ships to web/PWA/iPad first, native Android landscape follows with the next signed release; until then native Android renders the wall in portrait, which is a designed, supported layout, not a broken one. (b) A **failed restore leaves the app rotatable until the next cold start**, so the failure is reported (`wall_orientation_lock_failed`, `severity: 'warning'`) and the manual test matrix explicitly re-checks every non-wall screen after backgrounding, resume and route change. (c) The phone-first layouts genuinely are not designed for landscape — that, not the 2026-06-12 regression, is the real reason the default stays portrait everywhere else.

**No `requestFullscreen()` in v1.** It is user-gesture-gated and inconsistent across browsers, and Guided Access already gives iOS what we need. Revisit only if a real device shows browser chrome stealing meaningful space.

### Who the lock verifies (and the lock-in bug it avoids)

`ReauthChallenge` verifies **one named member** — it takes a `FamilyMember` and checks that member's passkey/PIN/password. The wall therefore verifies the **session member** (`authStore.currentUser` → the corresponding `familyStore` member): the adult who set the wall up is the adult who can unlock and leave it. A second parent walking up uses that same PIN or signs in normally after leaving. This is the simplest defensible rule; "any adult member may unlock" would mean rendering a member picker on a child-facing screen and is not needed for v1.

Because the challenge has a terminal `noCredential` state, **entry is gated on the session member having a credential**. `WallSetupCard` computes `canEnterWall = !!(member.pinHash || member.passwordHash)` and, when false, renders the reason plus a link to the existing PIN setup rather than a disabled button with no explanation. This turns an unrecoverable end state into a two-tap prerequisite, and it is cheaper and far safer than any in-wall escape hatch.

### What we DO NOT build (Pass 2 — verified against the codebase)

The single biggest risk in a plan this size is re-implementing infrastructure that already exists. Each row below was checked in source before being struck.

| Tempting to build                                                                    | Already exists                                                                                                                                                                                                                                                 | Use it                                                                                                       |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Wall midnight day-rollover                                                           | `useToday()` — self-rearming DST-safe midnight timer, plus the app's only `visibilitychange`/`pageshow` listeners (`src/composables/useToday.ts`)                                                                                                              | `const { today, isVisible } = useToday()`. The wall registers **zero** DOM listeners for time or visibility. |
| Wall "resync on wake / on day change"                                                | `useStaleTabRefresh()` — already wired once, app-wide, in `App.vue:1471`. Runs on `today` change and on hidden→visible after ≥5 min, with per-step try/catch + `reportError`                                                                                   | Nothing. It is already running on the wall route.                                                            |
| Wall background refresh loop                                                         | `syncStore` 10 s `FILE_POLL_INTERVAL` cross-device poll (`syncStore.ts:2749-2840`)                                                                                                                                                                             | Nothing.                                                                                                     |
| A generic "poll while visible" timer (if one is still needed for the staleness tick) | `usePollWhileVisible(cb, ms, { surface })` — catches + reports callback throws, auto-stops on scope dispose                                                                                                                                                    | Reuse; never `setInterval` directly.                                                                         |
| Wall `lastUpdatedAt` stamp + its formatting                                          | `syncStore.saveStatus` + `syncStore.lastSync` + `formatRelativeTime()` (`src/utils/date.ts:316`) + `SAVE_STATUS_PRESENTATION` (`src/components/ui/saveStatusPresentation.ts`) — a total, exhaustively-tested status→presentation map incl. an `attention` flag | Reuse the map; the wall supplies only wall-scale typography.                                                 |
| Wall "+N more" windowing                                                             | `useExpandableList` + `<ShowMoreToggle>` (+ `<SmoothHeight>`) (ADR-025)                                                                                                                                                                                        | Reuse for every capped list (day columns, lanes, jobs, shared lists).                                        |
| Wall person filter                                                                   | `useMemberFilterChips()` + `memberFilterStore` + `createMemberFiltered()`                                                                                                                                                                                      | Reuse. The footer filter in the mockup is exactly the existing chip contract.                                |
| Per-day event expansion                                                              | `activityStore.activitiesForDate(ymd)` and `activityStore.activitiesInRange(...)`, `useWeekNavigation(referenceDate)`, `groupOverlapping()` (`useCalendarNavigation.ts`)                                                                                       | Reuse. Never re-expand recurrence in a wall component.                                                       |
| Trip card with flight legs / nights                                                  | `travelDetailRows()`, `buildTravelKeyValue()`, `useVacationTimeline()` (`src/composables/useVacationTimeline.ts:164,244,517`)                                                                                                                                  | Reuse; render the returned rows at wall scale.                                                               |
| Meals card                                                                           | `mealPlanStore.todaysMeals` + `mealDisplayName()` + `<MealThumb>` (as used by `NookMealsCard.vue`)                                                                                                                                                             | Reuse behind the `mealPlanner` flag.                                                                         |
| List progress bar / recurring test                                                   | `listProgress()`, `isRecurring()` (`src/utils/listLifecycle.ts`)                                                                                                                                                                                               | Reuse.                                                                                                       |
| Avatars / colours                                                                    | `<BeanieAvatar>`, `MEMBER_COLORS`, `useMemberAvatar`, `useAvatarPhotoUrl`                                                                                                                                                                                      | Reuse.                                                                                                       |
| Modal/sheet behaviour (Escape, scroll lock, z-layering)                              | `<BaseModal>` / `<BaseSidePanel>` → `useFullscreenOverlay` → `overlayStack` ref-counted lock                                                                                                                                                                   | Reuse; do not hand-roll an overlay.                                                                          |
| "Leave the wall" confirmation                                                        | `confirm()` from `useConfirm` + the global `<ConfirmModal>` (renders on `noChrome` routes)                                                                                                                                                                     | Reuse.                                                                                                       |
| Tick celebration                                                                     | `listStore.toggleItem` / `todoStore.toggleComplete` **already call `celebrate('goal-reached')`**, and `<CelebrationOverlay>` renders outside the chrome branch                                                                                                 | Do **not** add a second celebration. See § Celebration on a shared screen.                                   |
| Native/web runtime detection for the orientation branch                              | `isNative()` (`@/services/sync/capabilities`)                                                                                                                                                                                                                  | Reuse — no UA sniffing, no `Capacitor.isNativePlatform()` re-derivation.                                     |
| Empty-lane art                                                                       | `<EmptyStateIllustration>`                                                                                                                                                                                                                                     | Reuse.                                                                                                       |
| Touch-primary detection                                                              | `useIsTouchPrimary()`                                                                                                                                                                                                                                          | Reuse (no UA sniffing).                                                                                      |
| Online/offline                                                                       | `useOnline()`                                                                                                                                                                                                                                                  | Reuse.                                                                                                       |
| Store-refused (non-throwing) failure reporting                                       | `src/utils/actionFailure.ts` — the established home for "the store returned null instead of throwing"                                                                                                                                                          | **Extend** with one `reportJobToggleFailed()`; do not create a parallel module.                              |
| A bespoke import-graph test for finance exclusion (Pass 2)                           | `eslint.config.js` already uses per-glob override blocks (`:316`, `:327`)                                                                                                                                                                                      | Use a `no-restricted-imports` zone. See § Finance exclusion.                                                 |

Net effect: the wall's own new infrastructure collapses to **two genuinely new primitives** (`useWakeLock`, `useWallOrientation` — both generic, neither wall-specific in its API), one pure logic module (`wallJobs.ts`), and four thin, wall-specific composables.

### Architecture (MVO)

**View** — `src/pages/BeanieWallPage.vue` is a thin orchestrator: it instantiates the wall composables **once**, binds state, applies the wall root class, and renders one of four screens. It must not talk to services directly.

```
src/components/wall/
  WallShell.vue          layout only: top bar slot region (date, clock, status stamp, switcher,
                         lock), footer filter, default slot. No business logic, no timers.
  WallViewSwitcher.vue   renders WALL_VIEWS (see registry below) — data-driven, ~30 lines.
                         NOT a fork of ViewToggle (different glyph set, four items, wall scale).
  WallStatusStamp.vue    clock + "saved N ago" + degraded/offline/pod-access attention state
  WallLockMenu.vue       lock icon, menu (unlock / night now / leave), hosts ReauthChallenge in a BaseModal
  WallDaysView.vue       view A
  WallLanesView.vue      view B   ─┐ both compose WallBeanColumn
  WallJobsBoard.vue      view J   ─┘ (+ back button)
  WallBeanColumn.vue     ONE per-bean column: avatar head, count line, event list, job list.
                         Presentational. Density is a CSS token; view-specific extras
                         (stars, green ring, progress) come in through named SLOTS.
  WallTodayView.vue      view C
  WallEventChip.vue      one event, member-coloured (colour from getActivityColor)
  WallJobRow.vue         one tickable job (to-do or list item)
  WallBonusBand.vue      renders WALL_BONUS_CARDS (registry) — filters by hasContent(), no v-if ladder
  WallDetailSheet.vue    ONE read-only BaseModal FRAME; the body is `<component :is>` resolved
                         from WALL_DETAIL_RENDERERS by `target.kind` — not a 5-branch template
  WallNightScreen.vue    dim + clock OVERLAY rendered above the live view (the view stays mounted)
  detail/                WallDayDetail.vue, WallListDetail.vue, WallTodoDetail.vue,
                         WallTripDetail.vue, WallMealDetail.vue — each a small read-only body
```

**The three registries (the Pass-3 simplification).** Every "there are N of these" axis in this feature is a data table, not a conditional:

```
src/components/wall/wallViews.ts
  WALL_VIEWS: readonly { id: WallViewId; labelKey: UIStringKey; icon: Component;
                         component: Component; dividerBefore?: boolean }[]
src/components/wall/wallBonusCards.ts
  WALL_BONUS_CARDS: readonly { id; flag?: FeatureFlagId; component;
                               hasContent(): boolean }[]
src/components/wall/wallDetailRenderers.ts
  WALL_DETAIL_RENDERERS: Record<WallSheetTarget['kind'], Component>
```

`WallViewSwitcher` and `BeanieWallPage` both read `WALL_VIEWS`, so the switcher and the rendered screen can never drift out of sync (the classic bug in a four-tab surface is two parallel lists). `WallBonusBand` maps over `WALL_BONUS_CARDS`, so requirement 12 ("render only cards that have content") is one `.filter()` rather than a growing `v-if` chain, and adding the meals card when `mealPlanner` flips is **one row**. `WallDetailSheet` stays a frame forever.

**Adding a fifth view or a sixth bonus card is: one component + one registry row. No existing wall file changes.** That is the maintainability test this design is built to pass, and it should be stated verbatim in the ADR.

**Data flow — one rule.** Only `BeanieWallPage.vue` and the four view components read stores. `WallShell`, `WallBeanColumn`, `WallEventChip`, `WallJobRow`, `WallStatusStamp` and every `detail/*` body are **presentational**: props in, events out, no store imports. This keeps the leaves trivially testable and is what makes the finance-exclusion lint zone meaningful rather than decorative.

**Prop drilling vs inject.** Data is passed as props. The one exception is the lock capability (`{ isLocked, requestUnlock }`), which is needed four levels down in `WallJobRow` and would otherwise be drilled through three intermediate components purely as a pass-through. It is provided **once** via a single typed injection key in `src/components/wall/wallLockKey.ts`, with an injection default that throws (so a wall component mounted outside the wall fails loudly in tests, not silently at runtime). **Exactly one injection key in the whole feature** — anything else goes through props.

**Pure logic before composables.** The jobs rule — the part of this feature most likely to change (the assignee model is mid-migration; list lifecycle already moved once) — lives in a **pure, store-free, Pinia-free module**:

```
src/utils/wallJobs.ts
  buildWallJobs(input: { todos, lists, memberIds, todayYmd }): {
    jobsByMember: Record<string, WallJob[]>;
    sharedLists: FamilyList[];
  }
```

It takes plain arrays and returns plain data. Its tests need no store harness and no fake timers. `useWallJobs` is then a thin reactive wrapper over it plus `toggle()` — a query/command split, so a future change to the merge rule cannot break the write path and vice-versa. `WallJob` is declared in `src/types/wall.ts` alongside `WallViewId` and `WallSheetTarget`, so components type against a stable contract rather than a composable's return-type inference.

**Composables** — flat in `src/composables/`, per the existing convention:

- `useWakeLock.ts` — **generic, not wall-scoped**, because a future full-screen surface (recipe cook mode, presentation) will want it. Acquires `navigator.wakeLock`, re-acquires on `useToday().isVisible` becoming true (no new listener), releases on scope dispose. Returns `{ supported, active, lastError }`. Every path is `try/catch`; a denial is a `logEvent warn`, never a throw, and `supported === false` is a first-class rendered state in the setup guide.
- `useWallOrientation.ts` — **generic in shape, the single owner of orientation release/restore** (see § Orientation). Returns `{ supported, release, restore }`; branches once on `isNative()`; every path guarded; `restore()` is idempotent and also called from the router `afterEach`. Registers no listeners of its own.
- `useWallJobs.ts` — the single source of "whose jobs are these". Thin wrapper over `buildWallJobs` + `toggle(job)`. Exposes `jobsFor(memberId)`, `allJobs`, `sharedLists`, `toggle`. **All four screens read from this one composable instance**, provided by the page.
- `useWallLock.ts` — locked/unlocked state, PIN step-up via `ReauthChallenge` against the session member, inactivity timer, auto-relock. Inactivity uses one pointer/keydown listener on the wall root (removed via `onScopeDispose`), not a global.
- `useWallNight.ts` — quiet-hours schedule + chosen night behaviour, driven off `useToday().today` and a minute tick from `usePollWhileVisible`.
- `useWallFreshness.ts` — derives `{ presentation, relativeSaved, isStale, attentionReason }` from `syncStore` + `useOnline`. Pure derivation; the only thing it _does_ is emit `wall_stale_data` once per crossing of the freshness budget (edge-triggered, guarded so it cannot re-fire every tick).

**Lifecycle rule.** Each wall composable is instantiated **exactly once, in `BeanieWallPage` setup** (they are not module-level singletons). Every listener, timer and lock releases through `onScopeDispose` only — never a manual `onUnmounted` teardown in a child, and never a global. The one deliberate exception is the orientation **restore**, which is additionally driven by a router `afterEach` because "we navigated away by a path that did not dispose cleanly" is exactly the case a global default must survive. This is what makes "turning the wall off leaves nothing behind" (acceptance criterion) provable rather than hoped for.

There is deliberately **no `useWallSession`**. Pass 1 gave it wake lock, day-rollover, resync and a freshness stamp; three of those four already exist app-wide (see the table above), so the composable would have been a re-implementation wrapper. What remains is split into the generic `useWakeLock` and the derived `useWallFreshness`.

**Model** — no new persisted entity. Wall preferences live in `settingsStore` alongside `textSize`, as **one nested object**, not four sibling fields:

```ts
// src/types/models.ts — Settings
wall?: { view: WallViewId; night: 'clock' | 'stay-on'; quietStart: string; quietEnd: string };
```

One field, one persist call through the existing `persistAiSetting`-style single-setting helper (`settingsStore.ts:511`), one type to evolve. `settingsStore` is already 1,064 lines and shared by every feature; smearing four wall booleans across its public API would be four more exported actions for one screen. They are **family-scoped only**, not dual-persisted — a wall preference is a property of the household display, not of the device you happened to set it from.

### The jobs rule (the core simplification)

```
buildWallJobs:
jobsFor(member) =
    todos where normalizeAssignees(todo) includes member
             AND !todo.someday
             AND extractDatePart(dueDate) === todayYmd
  + items from every FamilyList where ownerId === member AND isRecurring(list)
  (deduped)
sharedLists = FamilyLists where !isRecurring(list)   → shown whole, never inside a person's column
```

Recurring lists sort first. A lane caps its jobs via `useExpandableList` + `<ShowMoreToggle>`. Lifecycle is read through `@/utils/listLifecycle.ts` predicates, never an inline comparison. Assignees are read through `normalizeAssignees`, never `todo.assigneeIds` directly.

**Dedupe rule:** a job is keyed by `(ownerId, normalisedTitle)` where normalisation is trim + lowercase + collapsed whitespace. On collision the **to-do wins** (it is the dated, assignable one) and the list item is suppressed from the merged view — but ticking the surviving row still writes to whichever source it came from. Display-level only; it never mutates either store.

### Toggling a job — the silent-failure fix

VERIFIED: `listStore.toggleItem` returns `null` when the list id is not found, and `todoStore.toggleComplete` returns `null` when the todo id is not found — **neither toasts on that path**. The underlying `updateList`/`updateTodo` go through `wrapAsync`, which toasts + reports on a _throw_, but a not-found refusal returns quietly. On a wall, that is precisely the "the chore looks done and isn't" data-loss case.

`useWallJobs.toggle(job)` therefore:

```
1. optimistically mark the row pending (visual tick, disabled)
2. await the store call inside try/catch
3. if it THREW      → wrapAsync already toasted; add reportError severity 'critical'
                      with surface 'beanie-wall', action 'job_toggle', kind todo|list
4. if it returned null (refused) → call reportJobToggleFailed() (new export in
                      src/utils/actionFailure.ts, mirroring reportSessionActionFailed):
                      showToast('error', …) — which itself auto-fires the error reporter —
                      plus a console.error naming the store, the id and the likely cause
                      ("the list/to-do was deleted on another device; pull to refresh").
5. always            → clear pending; re-read from the store so the UI matches truth.
```

The dispatch to the right store is a **two-entry map keyed by `job.source`** (`'todo' | 'list'`), not an if/else that will grow a third arm badly — a future third job source is one map entry.

`reportJobToggleFailed()` lives in `actionFailure.ts` because that module's whole documented purpose is "the store refused — a non-throw failure that used to fail silently." Adding a third reporter there is DRY; a new `wallErrors.ts` would not be.

### Celebration on a shared screen

Both store toggles already call `celebrate('goal-reached', { onUndo })`, and `<CelebrationOverlay>` renders on chrome-less routes. So the wall gets celebrations **for free** — do not add a second confetti path. Two consequences must be handled, and both must be handled **in the owner**, because `<CelebrationOverlay>` lives in `App.vue`, outside the wall tree:

- `'goal-reached'` is a **modal** celebration and will otherwise sit on the wall until someone dismisses it.
- The celebration's **Undo action is an edit**, and the Undo button is rendered by `CelebrationOverlay` — a child must not be able to un-complete a sibling's list from a kitchen wall while the wall is locked.

**Resolution:** add a small, explicit mode to `useCelebration.ts` (~15 lines):

```ts
// module-level, alongside `toasts` / `activeModal`
const mode = ref<{ autoDismissMs: number | null; allowUndo: boolean }>({
  autoDismissMs: null,
  allowUndo: true,
});
export function setCelebrationMode(next: Partial<typeof mode.value>): void;
```

`BeanieWallPage` calls `setCelebrationMode({ autoDismissMs: 6000, allowUndo: !isLocked })` on enter and whenever the lock changes, and restores the defaults on scope dispose. `CelebrationOverlay` reads `mode` for the Undo button's visibility and arms the auto-dismiss timer (cleared on dismiss and on overlay unmount, so no timer outlives the celebration it belongs to). The trigger config map is **not** touched — no per-trigger special-casing, no wall knowledge inside `useCelebration` beyond two neutral options that any future kiosk/presentation surface can reuse. This replaces Pass 2's `WallShell` watcher, which could not have worked.

### The bigger celebration — a full list completed

VERIFIED: `listStore.toggleItem` **already** derives `shouldCelebrate` and fires `celebrate('goal-reached', { onUndo })` when a list completes (`listStore.ts:275-280`); `todoStore` does the same for a to-do. So the completion moment already has exactly one hook — the work is to make it _bigger_, not to add a second path. Adding a parallel wall-only confetti would double-fire on the wall and leave the phone app unchanged.

**Design** (CIG-clamped; the mockup's tick burst is the small sibling of this):

- A new celebration type `'shower'` joins `'toast' | 'modal'`, and a new trigger `'list-complete'` uses it. `listStore`'s completion call changes from `'goal-reached'` to `'list-complete'` — **one line**, and the improvement lands everywhere lists are used, not only on the wall.
- `<CelebrationShower>` renders **full-viewport, `pointer-events: none`, self-dismissing** — so unlike the `'goal-reached'` modal it can never sit on a kitchen wall waiting for a dismissal that never comes, and it never blocks a tap. That property is why a shower is the right shape for a shared screen.
- Content: ~36 bean-shaped confetti pieces in the Pod's mandated order (Deep Slate, Terracotta, Heritage Orange, Sky Silk) falling with staggered delays, slight drift and rotation; the celebrating beanies asset scaling in with a soft settle; the message in Caveat, Heritage Orange. Squircle radii, soft shadows, no Alert Red — the celebration is warm, not loud.
- **Undo is preserved but governed by the existing mode flag.** The shower renders the `onUndo` affordance as one quiet pill, shown only when `mode.allowUndo` is true — the same `setCelebrationMode({ allowUndo: !isLocked })` control § Celebration already introduces for the wall. A locked wall therefore shows the celebration and hides the edit, with no second mechanism.
- `prefers-reduced-motion`: no falling confetti and no bounce — a static badge plus the message, fading in and out. The timer still self-dismisses.

**Why not a wall-only animation:** the wall's whole design thesis is that it renders the same family data through a different lens. A celebration that only exists on the wall would be a second code path to maintain and would make the phone feel worse by comparison.

### The status stamp (substitute failure surface)

Because `PodAccessBanner` / `SaveFailureBanner` / `DurabilityBanner` do not render on a `noChrome` route (see Caveats), `WallStatusStamp` is the wall's only warning channel and must be bound to all of:

| Signal                  | Source                                | Wall rendering                                                                                           |
| ----------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| normal                  | `saveStatus === 'saved'`              | dot + "saved {relative}" via `SAVE_STATUS_PRESENTATION.saved` + `formatRelativeTime(syncStore.lastSync)` |
| saving                  | `saveStatus === 'saving'`             | pulsing dot                                                                                              |
| degraded / critical     | `saveStatus`                          | amber row + explicit "changes aren't saving" line (`attention: true` already in the map)                 |
| offline                 | `useOnline().isOnline === false`      | "offline — showing last known"                                                                           |
| data file missing       | `syncStore.driveFileNotFound`         | "can't reach the family file — unlock and check settings"                                                |
| pod access lost         | `syncStore.shouldShowPodAccessBanner` | same treatment, higher precedence (it is the root cause)                                                 |
| local cache not durable | `syncStore.cachePersistFailed`        | quiet amber note                                                                                         |
| stale beyond budget     | `useWallFreshness().isStale`          | "last updated {relative}" in amber + `wall_stale_data`                                                   |

Precedence is declared **once**, as an ordered array of `{ test, reason }` in `useWallFreshness`, resolved with `.find()` — not a nested ternary and not a chain of `if`s in the template. `WallStatusStamp` renders exactly one reason and knows nothing about syncStore. Adding a ninth signal later is one array entry. Every state also carries a one-line **developer hint in `console.warn`** naming the store field to inspect, so a family screenshot is triageable.

### Type scale — scoped to the wall root, NOT to `<html>`

**Pass 1's approach was unsafe.** `settingsStore` owns a `watch(textSize, …, { immediate: true })` that writes/removes `data-text-size` on `<html>` and mirrors it to `localStorage` (`settingsStore.ts:224-247`). A wall route that also writes that attribute would be silently clobbered the moment the user (or a store reload) re-triggers the watcher, and "save the old value on mount, restore on unmount" is a global mutation that leaks on a crash, a hard reload, or a PWA update.

Instead: add `--text-scale-wall` to `packages/brand/theme.css` next to `--text-scale-large`, and a **scoped** rule in `src/style.css`:

```css
.wall-root {
  font-size: calc(1rem * var(--text-scale-wall));
}
```

`BeanieWallPage` puts `.wall-root` on its own root element. Because every utility in the app is rem-based, the whole subtree scales from one rule — the same mechanism, one nesting level down — with **zero global state to restore**, and it composes correctly with a user who also has Large reading mode on. This is strictly simpler and strictly safer than the third `data-text-size` value.

### Feature flag + route

- `flagRegistry.ts`: `{ id: 'beanieWall', label: 'Beanie wall', description: 'Tablet wall/table display mode for the family planner.' }`
- `featureFlags.committed.ts`: `beanieWall: false`
- Route `/wall`, `meta: { requiresAuth: true, noChrome: true, hideQuickAdd: true, requiresFlag: 'beanieWall' }` — all four already supported by the existing router guard (`src/router/index.ts:499`, `:510`) and `shouldShowAppLayout`. The only other router change is the `afterEach` orientation restore described in § Orientation, which is a three-line guard that no-ops unless `useWallOrientation` has something to restore.
- The page is lazily imported so the wall bundle costs nothing to users with the flag off.

### Finance exclusion

**Structural, enforced by lint — not by a bespoke test.** Add one override block to `eslint.config.js`, in the same style as the two that already exist:

```js
{
  files: ['src/pages/BeanieWallPage.vue', 'src/components/wall/**', 'src/composables/useWall*.ts'],
  rules: { 'no-restricted-imports': ['error', { patterns: [
    '@/stores/accountsStore', '@/stores/transactionsStore', '@/stores/budgetStore',
    '@/stores/goalsStore', '@/stores/assetsStore', '@/stores/recurringStore',
    '@/utils/finance*', '@/utils/currency*', '@/components/accounts/**',
    '@/components/budget/**', '@/components/goals/**', '@/components/transactions/**',
  ]}] },
}
```

Pass 2 proposed a unit test that walks the static import graph. That test would need alias resolution, SFC parsing and dynamic-import handling — a few hundred lines of bespoke test infrastructure that one person understands and nobody maintains, to enforce a rule ESLint already implements. The lint zone runs in the editor, in `lint-staged`, and in CI, and it fails at the point of the mistake with a message the author can act on.

**Known limit, stated deliberately:** the zone catches _direct_ imports, not transitive ones (a shared `ui/` component that itself imports a finance util). That risk is bounded by the presentational-leaf rule above — the wall imports from a short, enumerated set of shared components — and by the explicit `ActivityViewEditModal` caveat, which is the one real transitive trap we found. If a transitive leak is ever observed, _that_ is when a graph walker earns its keep. Record this trade-off in the ADR so the next person knows it was a decision, not an oversight.

### Complexity budget (Pass 3, updated Pass 4)

Stated so it can be checked at review time, not felt later:

- **14 wall components + 5 `detail/` bodies** (the bodies are tiny files replacing five branches of one big template) + `BeanieWallPage.vue` + `WallSetupCard.vue`; **6 composables** (2 generic, 4 wall-specific), **1 pure util**, **3 registries**, **1 injection key**, **0 new stores**, **0 new persisted entities**, **0 new telemetry context keys**.
- **No wall component exceeds ~200 lines.** If one does, the view/registry split is being bypassed.
- **No new global state.** Everything is scope-owned; the only module-level state touched is `useCelebration`'s existing refs, through a new explicit setter, and the OS orientation request, which is restored from two places and re-defaulted by the manifest on cold start.
- **Maximum template nesting inside a view: 3 levels** (view → column → row). The registries exist to keep it there.
- If a sixth screen, a second lock model, or per-device wall preferences ever arrive, the honest answer is a `wallStore` — but not before. Do not pre-build it.

## Files Affected

**New**

- `src/pages/BeanieWallPage.vue`
- `src/components/wall/*.vue` (14 components listed above) + `src/components/wall/detail/*.vue` (5 read-only bodies)
- `src/components/wall/wallViews.ts`, `wallBonusCards.ts`, `wallDetailRenderers.ts`, `wallLockKey.ts`
- `src/types/wall.ts` (`WallViewId`, `WallJob`, `WallSheetTarget`)
- `src/utils/wallJobs.ts` (pure merge/dedupe — no Pinia)
- `src/composables/useWakeLock.ts` (generic), `useWallOrientation.ts`, `useWallJobs.ts`, `useWallLock.ts`, `useWallNight.ts`, `useWallFreshness.ts` (flat, per repo convention)
- `src/components/settings/WallSetupCard.vue` (entry point + credential precondition + setup guide)
- `docs/adr/035-wall-display-tier.md` (or an ADR-012 amendment) — must record the registry pattern, the presentational-leaf rule, the lint-zone-vs-graph-test trade-off, and the release/restore orientation decision
- Unit tests for `wallJobs.ts` + each composable + the registries

**Modified**

- `src/router/index.ts` (the `/wall` route entry + the `afterEach` orientation restore)
- `src/config/flagRegistry.ts`, `src/config/featureFlags.committed.ts`
- `src/types/models.ts` (`Settings.wall` — one nested optional object)
- `src/stores/settingsStore.ts` (one `setWallPrefs` action via the existing single-setting persist helper)
- `src/utils/actionFailure.ts` (add `reportJobToggleFailed`)
- `src/composables/useCelebration.ts` + `src/components/ui/CelebrationOverlay.vue` (celebration mode: `autoDismissMs`, `allowUndo` — see § Celebration)
- `eslint.config.js` (the wall finance-exclusion zone)
- `packages/brand/theme.css` (`--text-scale-wall`), `src/style.css` (the scoped `.wall-root` rule)
- `src/services/translation/uiStrings.ts` (all wall copy under a single contiguous `wall.*` namespace block, `en` + `beanie` — the file is already 9,658 lines; keeping the feature's keys in one greppable block is what makes it extractable later)
- `src/pages/SettingsPage.vue` (the wall card)
- `.claude/skills/beanies-theme/SKILL.md` (wall tier section)
- `docs/adr/012-responsive-mobile-layout.md` (amendment noting the wall tier)
- `docs/PERFORMANCE.md` (thresholds for long-running unattended sessions)
- `docs/mockups/beanie-wall-2026-08-31.html` (already committed — the approved design)

**Modified in phase 8 only (the Android landscape work package)**

- `package.json` / `package-lock.json` (`@capacitor/screen-orientation`, Capacitor 8 line)
- `ios/App/Podfile.lock` + `android/` Gradle sync artefacts regenerated by `npx cap sync` (the plugin installs on both platforms; only Android consumes it)
- No source change beyond the native branch already inside `useWallOrientation` — the composable is written in phase 1 with the web path live and the native path behind `isNative()`, so phase 8 adds a dependency, not a refactor.

**Explicitly NOT modified** — `vite.config.ts` (the PWA manifest stays `portrait`), `android/app/src/main/AndroidManifest.xml` (the portrait attribute stays and becomes the cold-start default), `ios/App/App/Info.plist` (iPad landscape is already declared), `src/composables/useToday.ts`, `useStaleTabRefresh.ts`, `src/App.vue`.

### Files this adds

`src/components/ui/CelebrationShower.vue` (new), plus edits to `src/composables/useCelebration.ts` (the `'shower'` type + `'list-complete'` trigger), `src/components/ui/CelebrationOverlay.vue` (render the shower), `src/stores/listStore.ts` (one-line trigger swap) and `uiStrings.ts` (`celebration.listComplete`).

## Implementation Sequence

Deliberately a vertical slice first, so the architecture is proven before 15 components exist.

1. **Skeleton**: flag + route + `BeanieWallPage` + `WallShell` + `wallViews.ts` with **one** view (`WallTodayView`) + `.wall-root` type scale + `useWallOrientation` (web path live, native path present but inert until phase 8) + the `afterEach` restore. Ships behind the flag; proves chrome-less routing, orientation and legibility on a real device before anything else is built.
2. **Freshness + safety**: `useWallFreshness` + `WallStatusStamp` + `useWakeLock`. These are the reliability spine; build them before the pretty screens so an overnight soak can start early.
3. **Jobs**: `src/utils/wallJobs.ts` (pure, fully tested first) → `useWallJobs` → `WallJobRow` → `WallJobsBoard`. Includes `reportJobToggleFailed`.
4. **Remaining views**: `WallDaysView`, `WallLanesView` + the shared `WallBeanColumn`. Registry rows only.
5. **Lock + night**: `useWallLock`, `WallLockMenu`, `useWallNight`, `WallNightScreen`, celebration mode, and the `WallSetupCard` credential precondition.
6. **Bonus band + detail sheet**: `wallBonusCards.ts`, `wallDetailRenderers.ts`, the five `detail/` bodies.
7. **Docs + guard rails**: lint zone, ADR, theme skill section, Help Center article, PERFORMANCE.md note. **Phases 1–7 ship to web, PWA and native iPad** — all of them landscape-capable already except an installed Android PWA.
8. **Android landscape (separate, native-release work package)**: add `@capacitor/screen-orientation`, enable the native branch of `useWallOrientation`, verify assumption 12 on a real Android tablet, then re-run the full non-wall regression matrix (every screen still portrait after background/resume/route-change) before a signed build goes to either store. This phase cannot ship in a web-only deploy and must not block phases 1–7.

Each phase is independently mergeable behind the flag; none leaves the app in a broken state.

## Help Center Coverage

- **Action**: new article
- **Category**: `getting-started`
- **Article type**: `how-to`
- **Slug**: `set-up-the-beanie-wall`
- **Title**: Set up the beanie wall on a tablet
- **Scope**: How to turn a spare tablet into the family's wall display: turning the mode on, picking a view, and the device setup that makes it stay on and stay put (Auto-Lock → Never, Guided Access on iPad, mounting and charging).
- **Notes**: Must call out that permanently charging a wall tablet at 100% swells batteries (Android can cap at 85%, iPads cannot); that leaving the wall requires the family PIN, and that **you need a PIN on your own profile before you can start the wall**; the orientation matrix in plain words — **landscape works in a browser tab on any tablet and in the iPad app today; an installed Android PWA and the Android app stay portrait until the next app-store release**, and iPhones are portrait by design; that on devices without Screen Wake Lock the OS Auto-Lock setting is the _only_ thing keeping the screen on; and that no financial information is ever shown on the wall. The orientation paragraph must be revisited when phase 8 ships.

## Observability Coverage

Surface: **`beanie-wall`** (one CloudWatch filter isolates the whole feature).

**Context-key policy (Pass 2).** The allowlist lives in `src/utils/diagnosticContext.ts` (`ALLOWED_CONTEXT_KEYS`, line 61) — _not_ `logEvent.ts` — and is mirrored by a pinned test in `infrastructure/lambda/telemetry/index.mjs`, plus the store-declaration chain (`docs/runbooks/native-store-submission.md`, `PrivacyInfo.xcprivacy`, Data-Safety answers, `privacy.astro`). Adding keys is therefore a five-file change. The wall adds **zero new keys**: it reuses `action` (the fixed enum naming the wall operation, e.g. `enter`, `view_days`, `job_toggle`, `unlock_ok`, `relock_timeout`, `night_enter`, `rollover`, `stale_15m`, `orientation_released`) and `kind` (`todo` | `list`), both already allowlisted and already used as fixed enums by Meal Planner and Recipe Capture. Numeric detail that would have needed a key (`staleMinutes`, `afterMs`) is bucketed into the `action` enum instead (`stale_15m`, `stale_60m`, `stale_6h`) — coarser, but it costs no privacy review and answers the same question. If a later iteration genuinely needs a numeric field, that is a deliberate follow-up with the five-file change, not a silent addition.

**Volume policy (Pass 3).** This is the app's first surface that runs **unattended for days**, so every event must be bounded per session or it becomes a cost and noise problem:

- `wall_view_change` is emitted only when a view has been **settled for ≥3 s** (a child fanning the switcher produces one event, not forty).
- `wall_stale_data` is edge-triggered and structurally capped at **3 per session** by the three-bucket enum.
- `wall_wakelock_reacquired` is capped at one per visibility transition (it is already edge-triggered by `useToday().isVisible`).
- Orientation events fire at most **twice per wall session** (one release, one restore) and only on failure or on an actual state change.
- No event is emitted from a timer tick. If a future wall event needs a periodic heartbeat, it belongs in a deliberate follow-up with a stated daily budget.

**Events**

- `logEvent info` `wall_enter` / `wall_exit` — `action: 'enter' | 'exit'`. Establishes the denominator for every rate below.
- `logEvent info` `wall_view_change` — `action: 'view_days' | 'view_lanes' | 'view_today' | 'view_jobs'`, debounced per above. Tells us which of the four screens families actually use, the main open product question.
- `logEvent warn` `wall_wakelock_denied` — `action: 'wakelock_denied' | 'wakelock_unsupported'`; `info` `wall_wakelock_reacquired`. The wake lock is the single most fragile dependency and fails silently by nature.
- `logEvent info` `wall_orientation_released` — `action: 'orientation_released'`, emitted once when the wall actually obtains landscape freedom. Tells us how many wall sessions are running rotated, which is the payoff metric for phase 8.
- `logEvent warn` `wall_orientation_lock_failed` — `action: 'orientation_release_failed' | 'orientation_restore_failed'`. A **restore** failure is the one that matters: it means a non-wall screen may be rotatable until the next cold start, and it must be visible in the firehose rather than discovered as a bug report.
- `logEvent info` `wall_day_rollover` — `action: 'rollover'`, fired from a watcher on `useToday().today` while the wall route is active. Proves an unattended wall actually turned over at midnight.
- `logEvent warn` `wall_stale_data` — `action: 'stale_15m' | 'stale_60m' | 'stale_6h'`, edge-triggered once per crossing. **This is the Skylight bug class we are explicitly beating**; it is visible on the wall _and_ in the firehose.
- `reportError severity:'critical'` `wall_job_toggle_failed` — `action: 'job_toggle'`, `kind: 'todo' | 'list'`. Covers both the throw path and the returns-null refusal path.
- `logEvent info` `wall_job_toggled` — `action: 'job_toggle_ok'`, `kind`. The success counter that makes the failure _rate_ measurable.
- `logEvent info` `wall_unlock_result` — `action: 'unlock_ok' | 'unlock_cancelled' | 'unlock_failed'`; `wall_relocked` — `action: 'relock_timeout' | 'relock_manual'`.
- `logEvent info` `wall_night_enter` / `wall_night_exit` — `action: 'night_clock' | 'night_schedule' | 'night_exit'`.
- `perfTiming.record('wall_first_paint', ms)` — note `TELEMETRY_FLOOR_MS = 250` (`src/utils/perfTiming.ts:27`); sub-floor renders are counted, not timed.

**Failure modes covered**: screen sleeps (wakelock events) · wall goes stale overnight (stale + rollover) · a child's tick doesn't save, whether by throw _or_ by silent refusal (job_toggle_failed, critical) · PIN unlock unusable (unlock_result) · orientation left released after leaving the wall (orientation_lock_failed) · Drive/pod/durability failure that would otherwise be invisible on a chrome-less route (the status stamp + the underlying store flags already reported by their owners). **No bare `catch {}` anywhere in the wall tree**; every catch either toasts, or reports, or both, and every one logs a `console.warn`/`console.error` prefixed `[beanie-wall]` naming the next debugging step. No job titles, member names, or event titles are ever logged.

## Acceptance Criteria

- [ ] A mounted tablet in **portrait and landscape** shows the current week legibly from ~3m in every one of the four screens.
- [ ] Landscape works **in a browser tab on any tablet and in the native iPad app with no native change**; after phase 8, in the native Android app too.
- [ ] **Every non-wall screen is still portrait on every runtime** — including on Android after entering the wall, leaving it, backgrounding, resuming, and navigating away by back-button or deep link.
- [ ] A child can tick a job; a child **cannot** create, edit or delete anything anywhere in the mode — including via a celebration Undo while locked.
- [ ] An adult unlocks with a PIN, makes an edit, and the wall relocks itself after inactivity.
- [ ] **A member with no PIN/password/passkey cannot start the wall**, and is told why and how to fix it — nobody can reach a screen they cannot leave.
- [ ] The screen stays awake unattended for a full day and shows correct data the next morning with **no manual reload** (day rolled over, data resynced) — achieved entirely through `useToday` + `useStaleTabRefresh` + syncStore polling, with no wall-owned timers beyond the wake lock and the minute tick.
- [ ] With the network down the wall renders last-known state plus a visible "last updated" stamp, and never blanks.
- [ ] A save failure, a missing data file, a lost pod, or a non-durable cache is **visible on the wall**, despite the three App.vue banners not rendering on a `noChrome` route.
- [ ] A tick that the store refuses (returns `null`) produces a user-visible error toast, a reported event, and a console line naming the cause — it never silently reverts.
- [ ] A job that exists as both a to-do and a recurring-list item appears **once**, and ticking it writes to its real source.
- [ ] No financial figure appears anywhere in the mode, for any signed-in member — enforced by the ESLint zone (direct imports) plus the presentational-leaf rule.
- [ ] Turning the wall on and off leaves **no global DOM/localStorage state behind** (verified by asserting `<html>` attributes are unchanged across enter/exit), celebration mode is restored to its defaults, and the orientation request is restored.
- [ ] The app is unchanged for every user who never turns the mode on (flag off = zero behavioural delta; wall bundle not loaded; celebration defaults unchanged; no orientation call ever made).
- [ ] Leaving the wall requires the PIN.
- [ ] Ticking the last outstanding item of a list fires the bean shower; it self-dismisses without interaction, never blocks a tap, and hides Undo while the wall is locked.
- [ ] With `prefers-reduced-motion` the shower degrades to a static badge and still self-dismisses.
- [ ] **Adding a fifth screen or a new bonus card requires one new component plus one registry row, and no edit to any existing wall component** — demonstrated by the registry tests.
- [ ] Help Center article added and matches shipped behaviour (including the orientation matrix as it actually stands at ship time).
- [ ] Diagnostic logging implemented and verified; failure modes triageable from CloudWatch without a local repro; **no new `ALLOWED_CONTEXT_KEYS` entries were required**.

## Testing Plan

1. **Unit — `wallJobs.ts` (pure, no store harness)**: recurring vs one-off routing; deprecated `assigneeId` still resolves via `normalizeAssignees`; `someday` to-dos excluded; dedupe collision (to-do wins, list item suppressed); a member with no jobs; a 40-item one-off list does not leak into a lane; ordering (recurring first). This is the largest test file in the feature _by design_ — it is where the business rules live and it costs nothing to run.
2. **Unit — `useWallJobs.toggle`**: writes to the correct store for each `job.source`; **a refused (null-returning) store call fires `reportJobToggleFailed` exactly once and does not leave the row optimistically ticked**; a throw adds a critical `reportError`; pending state always clears.
3. **Unit — `useWakeLock`**: absent `navigator.wakeLock` degrades to `supported: false` without throwing; a rejected request logs warn and sets `lastError`; re-acquire fires when `useToday().isVisible` flips false→true; release on scope dispose.
4. **Unit — `useWallOrientation`**: absent `screen.orientation` and a throwing `unlock()` both degrade to `supported: false` / a warn with **no throw and no blocked navigation**; `restore()` is idempotent (calling it from both `onScopeDispose` and the router `afterEach` produces one platform call); a failed restore emits `orientation_restore_failed`; with `isNative()` mocked true the plugin path is taken and the web path is not.
5. **Unit — `useWallFreshness`**: precedence array order (pod access > file-not-found > degraded > offline > stale > saved); `wall_stale_data` is edge-triggered once per budget crossing, not per tick.
6. **Unit — `useWallLock`**: locked by default; `verified` grants edit; inactivity relocks; leaving requires unlock; `setCelebrationMode({ allowUndo })` follows the lock state and is restored on dispose.
7. **Unit — entry precondition**: `WallSetupCard` blocks entry for a member with no `pinHash`/`passwordHash` and renders the remedy link; allows it once a PIN exists.
8. **Unit — registries**: every `WALL_VIEWS` entry has a component, a real `UIStringKey` and an icon; `WALL_VIEWS` ids match the `WallViewId` union exhaustively; `WALL_DETAIL_RENDERERS` covers every `WallSheetTarget['kind']` (a `satisfies Record<...>` plus a runtime key check, so adding a sheet kind without a renderer fails at compile time).
9. **Unit — chrome + flag**: `shouldShowAppLayout` returns false for the wall route; the router guard blocks `/wall` when `beanieWall` is off.
10. **Unit — no global leakage**: mounting and unmounting `BeanieWallPage` leaves `document.documentElement` attributes and `localStorage` byte-identical, celebration mode back at its defaults, and `restore()` called exactly once.
11. **Lint — finance exclusion**: covered by the `eslint.config.js` zone in CI; no bespoke test. (A deliberate replacement for Pass 2's import-graph walker — see § Finance exclusion for the trade-off and its known limit.)
12. **E2E**: apply the ADR-007 three-gate filter. Budget is 25 tests; adding one requires removing one. Likely **one** test at most (enter the wall, tick a job, assert via IndexedDB export that the write landed) — the rest is better covered by units. No DOM-count or copy-dependent assertions.
13. **Manual, on a real device** (the continuous-month plan's rule — not verifiable in CI). Run this soak from **phase 2**, not at the end:
    - an old iPad in Safari, portrait and landscape;
    - an Android tablet as an installed PWA — does `screen.orientation.unlock()` actually release the manifest lock?
    - a native iPad build in landscape (expected to work with no native change);
    - left running overnight to confirm rollover, wake lock and the stale stamp;
    - airplane-mode mid-session to confirm the offline stamp appears without the App.vue banners;
    - a celebration fired while locked (Undo hidden, auto-dismisses);
    - a child tapping around trying to escape the mode, and a member with no PIN attempting to start it.
    - **Phase 8 additions**: on a native Android tablet, confirm assumption 12 (runtime unlock overrides the manifest attribute); then confirm EVERY non-wall screen is still portrait after entering and leaving the wall, after backgrounding and resume, after a back-button exit, and after a cold start.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted from the approved mockup and tracker #78; resolved the orientation constraint by scoping it per-runtime rather than changing the global manifest; specified the jobs unification, dedupe rule, wall type scale and the full observability surface.
- **Pass 2 (DRY + error handling)**: Deleted `useWallSession` (rollover/resync/stamp already exist in `useToday`, `useStaleTabRefresh` and syncStore polling), replaced the global `data-text-size` mutation with a scoped `.wall-root` rule, merged five sheets into one `WallDetailSheet` and the lane/board column into `WallBeanColumn`, and added a verified-reuse table covering 18 existing helpers; caught that `PodAccessBanner`/`SaveFailureBanner`/`DurabilityBanner` never render on a `noChrome` route (making `WallStatusStamp` the substitute failure surface) and that `listStore.toggleItem`/`todoStore.toggleComplete` refuse silently by returning `null` (handled via a new `reportJobToggleFailed` in the existing `actionFailure.ts`); corrected the allowlist location to `diagnosticContext.ts` and reworked telemetry to add zero new context keys.
- **Pass 3 (Sustainability)**: Replaced every "N of these" conditional with a registry (`wallViews` / `wallBonusCards` / `wallDetailRenderers`) so a fifth screen or card is one row and no existing file changes; extracted the jobs rule into a pure store-free `src/utils/wallJobs.ts` with a query/command split; fixed the unimplementable celebration-Undo suppression (the overlay lives outside the wall tree) by adding an explicit `setCelebrationMode` to the owning composable; replaced the bespoke finance import-graph test with an `eslint.config.js` `no-restricted-imports` zone; flattened `src/composables/wall/` to match the repo's flat convention; collapsed wall settings into one nested `Settings.wall` object; made `WallBeanColumn` slot-based rather than mode-flagged and `WallShell` layout-only; added a presentational-leaf rule, a single typed injection key, a complexity budget, telemetry volume caps for an unattended 24/7 device, and a seven-phase vertical-slice build order.
- **Pass 4 (Fresh-eyes sweep)**: Caught a lock-in bug (`ReauthChallenge`'s terminal `noCredential` state would trap a PIN-less member inside a wall whose exit is a step-up) and fixed it with an entry precondition in `WallSetupCard`; reconciled the late-edited § Orientation with the rest of the plan — replaced the boot/resume portrait lock with an idempotent release/restore owned by a single new `useWallOrientation` composable (so `AndroidManifest.xml` genuinely stays unmodified as the cold-start default, as "Files Affected" claimed), added the router `afterEach` restore, added the missing phase 8 Android work package, the missing `package.json`/pod-lock files, the missing `wall_orientation_*` telemetry events, the missing orientation acceptance criteria and unit tests, and corrected the Help Center orientation paragraph that still said native apps stay portrait; fixed the component count mismatch in the complexity budget and noted the celebration auto-dismiss timer must be cleared on overlay unmount.

## Post-Implementation Pass — Mockup Fidelity (2026-08-31)

The first implementation shipped the calendar layer and the jobs board but had
dropped everything the mockup puts _around_ the calendar, and none of the tap
targets were wired. Greg's testing caught it. What this pass added or fixed:

**Missing surfaces, now implemented**

- **Peripheral cards** (`WallPeripheralCards.vue` + `WallCard.vue`, fed by a new
  `useWallPeripherals` composable): today's jobs, tonight's meal, the trip (with
  travellers, dates, flight legs and a progress bar) and the lists (with owner,
  the "repeats" pill and per-list progress). Rendered as a **band** under views A
  and B and as a **rail** beside view C, from one component — the mockup shows
  the same cards in both places, and forking them was how they would drift.
- **The foot**: a person filter (single-select, wall-local — deliberately NOT
  `memberFilterStore`, so a child poking the wall cannot re-filter a parent's
  planner) plus the `beanies.family` wordmark.
- **The header sub-line** ("Week of 31 August · 6 things on today") and the
  **clock**, which the mockup pairs with the saved stamp.
- **The drill-in sheet** (`WallSheet.vue`): one panel, five bodies — a day's
  events, one activity's detail, every list (tickable), today's meals, the trip.
  Every tap target on the wall now resolves to a `WallSheetTarget`.
- **Night mode's look-ahead line** ("1 thing on tomorrow · touch to wake").
- **The per-tick celebration** (`WallTickBurst.vue` + `useWallBurst`): beans
  popping out of the tick and a rotating hand-written cheer. Kept separate from
  `useCelebration` because that system is one-at-a-time and sound-playing, and
  four children clearing columns at once must each get their own burst.

**Behaviour fixes**

- **Nothing was tappable.** Days, event chips, rest-of-week days, week-strip
  days, lane headers and every card now open the sheet; `@open-day` was
  previously wired to `() => {}`.
- **PIN unlock went through an intermediate choice screen** and then raised the
  OS keyboard over it. The wall now opens straight onto a touch keypad
  (`WallUnlockPad.vue` + a reusable `PinKeypad.vue`, with a new `keypad` mode on
  `PinInput` that drops the hidden input). `ReauthChallenge` still serves legacy
  password-only members, so no credential path was lost.
- **The full-list celebration was unreadable** — mascot and message rendered
  directly over seven columns of text. It now sits on a translucent plate over a
  soft radial scrim. The tick cheer was likewise moved above the row it belongs
  to and given a halo.
- **Pets appeared as columns** on the jobs board and in the lanes. Both now use
  `familyStore.sortedHumans`.
- **Silent truncation** in the days view (`overflow: hidden` clipped events with
  no indication) — now capped at 6 (landscape) / 8 (portrait) with an explicit
  "+N more". `WallBeanColumn`'s body scrolls rather than clipping.
- **An open sheet covered the lock menu** (sheet `z-30`, later in the DOM, over a
  `z-20` dropdown), making unlock, night mode and _leaving the wall_ unreachable.
  The header is now `relative z-40`.
- **Portrait** was cramped: the date and clock each wrapped onto two lines and
  the four-card band truncated every label. Portrait now has its own type scale
  and a two-column band.

**Verified in a browser, not only in tests** (per `docs/lessons.md`): all four
views plus portrait, the day sheet, the lists sheet, a tick burst, a full-list
celebration, night mode and the lock menu over an open sheet were driven and
screenshotted in Chromium against seeded activities, to-dos, lists, a meal and a
trip. The health-category list was asserted absent from every surface.

### Code-review round (`/code-review max`, against the mockup)

23 findings. Fixed in this pass:

| #   | Defect                                                                                                                                                                                                                                                                                                                                                                                                    | Fix                                                                                                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Every to-do tick fired `celebrate('goal-reached')` — a **modal** — blacking out the whole wall behind `z-[200]` and swallowing the next child's tap. `listStore` had been migrated to the shower; `todoStore` was left behind.                                                                                                                                                                            | New `mode.suppressRoutine`; the wall opts out of toast/modal celebrations (it has its own burst). Showers still fire.                                                     |
| 2   | `CelebrationShower`'s Pod colours were `var(--deep-slate)` / `--terracotta` / `--sky-silk` — **none of which exist in the repo**, and with no fallback — so 27 of 36 confetti beans were transparent, app-wide. Same bug made the REPEATS pill's lozenge invisible (`--tint-orange-12`; only -4/-8/-15 exist).                                                                                            | Literal Pod hex; pill moved to `--tint-orange-15`.                                                                                                                        |
| 3   | The person filter used `.some()`, so an **unassigned** activity was filtered OUT — tapping a bean deleted the family dinner, the school holiday and the trip. The app's canonical rule (`useMemberFiltered`) does the opposite.                                                                                                                                                                           | `matchesWallFilter` in the new `src/utils/wallActivities.ts`, shared by all four screens and the sheet.                                                                   |
| 4   | Nothing sorted a day's activities — `activitiesForDate` returns repository order — so a capped day could hide the 8:05 school run behind "+2 more", and view C could list 6:30pm above 8:05am.                                                                                                                                                                                                            | `sortByTime`, all-day first, applied everywhere via `wallEvents`.                                                                                                         |
| 5   | `WallStatusStamp` never folded in `driveFileNotFound` / `podAccessError` / `cachePersistFailed`, whose banners all live in the `showAppLayout` branch a `noChrome` route skips. A revoked Drive permission showed a green dot and "Saved 4 minutes ago" — the silent sync death this feature is positioned against.                                                                                       | Folded in as a `blocked` state that outranks everything, plus the `wall_stale_data` event the plan promised (edge-triggered, so a 24/7 device cannot flood the firehose). |
| 6   | "Leave the wall" while locked emitted `requestUnlock` and then **discarded the leave intent** — a correct PIN just returned you to the wall. And a member with no credential could reach a chrome-free route with no working exit.                                                                                                                                                                        | `pendingAction` carries the intent through the challenge; leaving is allowed outright when the member cannot satisfy one.                                                 |
| 7   | `WallUnlockPad` had **no attempt limit** — unlimited instant guesses on a 4.5rem keypad, on the one physically exposed always-on surface, where a correct PIN is full-app access.                                                                                                                                                                                                                         | `MAX_PIN_ATTEMPTS` then a 60s cooldown that survives closing and reopening the pad.                                                                                       |
| 8   | `useWakeLock` set `active = true` whenever the request resolved. If the document hid mid-request the browser had already dropped the lock, and `acquire()`'s early-return then bailed on every later visible transition — the iPad slept while telemetry said healthy.                                                                                                                                    | Subscribe to the sentinel's own `release` event and trust `granted.released`.                                                                                             |
| 9   | Three ways the two list sources disagreed: filed one-off lists sat on the board at 100% forever; `useWallPeripherals` read `activeLists`, which runs through the **persisted, phone-shared** member filter (so a parent narrowing their planner blanked the wall's lists); and a multi-assignee to-do minted one shared `todo:${id}` key, so the `pending` guard disabled every copy when one was tapped. | `isFiled` gate; raw `listStore.lists`; owner-scoped job keys.                                                                                                             |
| 10  | Chips and pips used the **category** colour where the mockup uses the **owner's** — Leo's football and Milo's football rendered identically. The mockup's white pip ring on today's tile was missing too.                                                                                                                                                                                                 | `wallActivityColour` (owner, falling back to category for a family-wide event) + the ring.                                                                                |
| 11  | `:now` re-rendered the view every 20s, and the template asked `eventsFor()` three times per day column — each call expanding a whole **month** of recurrences. ~21 month-expansions per render, forever, on a tablet. `stateFor()` ran ~8× per member.                                                                                                                                                    | Memoised into `eventsByDay` / `stripByDay` / `stateByMember` computeds.                                                                                                   |
| 13  | Lanes read "Nothing on" above "Nothing today" — the empty-_events_ case used the jobs string.                                                                                                                                                                                                                                                                                                             | Correct key.                                                                                                                                                              |
| 14  | `PinInput`'s keypad mode removed the hidden input, the only focusable element and only accessible name, while the boxes stayed `aria-hidden` — a screen-reader user got nine unlabelled buttons and could not leave the wall.                                                                                                                                                                             | `role="group"` + label on the wrapper, and an `aria-live` digit-count.                                                                                                    |
| 15  | Swapping list completion to the shower silently cut the **Undo window for all users** from "until you dismiss it" to 4.2s.                                                                                                                                                                                                                                                                                | `SHOWER_UNDO_DURATION_MS` (9s) when the celebration carries an undo.                                                                                                      |
| —   | The shared-list cards emitted a target-less `{ kind: 'lists' }`, so tapping "Grocery run" opened a grid of every list.                                                                                                                                                                                                                                                                                    | Added a `{ kind: 'list', listId }` variant.                                                                                                                               |
| —   | An open sheet (`z-30`) painted over the lock menu (`z-20`), making unlock, night mode and **leaving** unreachable.                                                                                                                                                                                                                                                                                        | Header is `relative z-40`.                                                                                                                                                |
| —   | No safe-area insets on the app's only full-bleed `h-[100dvh]` route: on an installed iPad PWA the status bar sat over the padlock and the home indicator over the person filter, with `overflow-hidden` and no scroll to recover them.                                                                                                                                                                    | `env(safe-area-inset-*)` on `.wall-root`.                                                                                                                                 |
| —   | Three text surfaces (job titles, chip titles, inactive switcher glyphs) used `text-secondary-500` with no `dark:` variant on `dark:bg-slate-800` — ~1.4:1 contrast.                                                                                                                                                                                                                                       | `dark:text-gray-100`.                                                                                                                                                     |
| —   | Every refused tick was reported **twice** (`showToast`'s auto-report plus `useWallJobs`' critical one) with different message strings, so `normalizeMessage` bucketed them separately and the failure rate read double.                                                                                                                                                                                   | `silent: true` on the toast.                                                                                                                                              |
| —   | The lock's `aria-label` was hardcoded to "locked"; the dropdown had no outside-click or Escape dismissal.                                                                                                                                                                                                                                                                                                 | Both fixed.                                                                                                                                                               |
| —   | Confetti randomisation was dead: `beans` was sampled once at component creation, and `CelebrationOverlay` mounts this component at boot and never unmounts it. Every celebration in a session dropped the identical 36 beans down identical tracks.                                                                                                                                                       | Re-scattered per celebration.                                                                                                                                             |
| —   | **The `someday` exclusion was untested** — proved by mutation: commenting the guard out left all 16 tests green, because the fixture had no `dueDate` and the later date guard already excluded it.                                                                                                                                                                                                       | Added a someday-dated-today case; verified it fails without the guard.                                                                                                    |

Left as-is, deliberately: lanes cap events at 2 with no "+N more" (a lane carries a
header, events and jobs in one column height — the header reads "3 today" and is itself
the drill-in, which is a better use of the remaining pixels than a button that would not
fit either); the day sheet is capped by scroll rather than a measured fit.

New tests: `wallActivities.test.ts` (9), `useWallBurst.test.ts` (5), two added to
`wallJobs.test.ts`. Suite: 5253 unit, 21/21 E2E chromium, lint + stylelint + type-check clean.

### Detail surfaces and tick motion (2026-09-01)

**Should the wall reuse the app's sidebar/modal for an activity or a trip?**
Decided: **share the definition, not the shell.**

Against reusing `BaseSidePanel` / `ActivityViewEditModal` on the wall:

- `ActivityViewEditModal` is an _editor_ — `InlineEditField` on a dozen fields, a
  delete path, a recurring-scope sub-dialog and router pushes. The wall is locked by
  default; opening a full editor from behind the padlock makes the padlock decorative.
- `BaseSidePanel` is `max-w-md` (448px) pinned right. On a 1280×800 wall read at two
  metres that is a phone-width column against one edge.
- It participates in `useFullscreenOverlay` / `overlayStack`, which are tied to App.vue
  chrome a `noChrome` route never renders.

But the risk the question points at is real: the wall was inventing its own idea of
"key details", and showing _less_ than it should — location and category, while omitting
**pickup and drop-off**, the single most-asked question in a kitchen.

So: one pure `src/utils/activityDetails.ts` defines the rows (location → drop-off →
pickup → instructor → contact), and each surface renders them at its own scale. Finance
is structurally absent from the rows, which is the same promise the `eslint.config.js`
finance zone makes about the wall's imports, enforced one level lower. The wall sheet
now also shows the end time, and the category moved to a quiet chip beside the date —
left below the labelled rows it read as one orphaned unlabelled word.

Trips reuse the app's own maths rather than re-deriving it: `bookingProgress`,
`daysUntilTrip`, `tripCountdownKey`, `tripTypeEmoji` and `computeAccommodationGaps` from
`utils/vacation.ts` — the same helpers `VacationSidebarCard` reads. The countdown is the
headline, because on a wall a trip card is not a booking manager, it is what a child
checks to work out how many more sleeps.

**The tick was jerky because four uncoordinated things fired at once:** the row dimmed to
60% for the duration of the CRDT write, the tick swapped colour with no motion, the
strike and the 50% fade snapped on, and the row then **teleported** to the bottom of its
column (jobs sort outstanding-first) — all while five beans animated up from where the
row had been. Now it is one beat:

| t       | what happens                                                                                       |
| ------- | -------------------------------------------------------------------------------------------------- |
| 0ms     | tick fills and springs (`cubic-bezier(0.34, 1.56, 0.64, 1)`), check draws in, beans leave the tick |
| 0–260ms | the strike sweeps left-to-right across the words as the title fades back                           |
| 160ms   | the row **glides** to its resting place; everything below slides up to meet it                     |

Specifics: the state is **optimistic**, so the spring is no longer at the mercy of write
latency; nothing dims (the button stays `disabled` against double-taps, it just no longer
says so in grey); the reorder is FLIP via a shared `WallJobList`, so the board, the lanes
and the sheet cannot drift into three different reorder feels; the celebration is keyed to
a _local_ tick, so opening the board no longer pops every already-done job; the strike is
an animatable background gradient on an inline span (`text-decoration` cannot be
animated, and on the `flex-1` element the line shot out past the text across the whole
column); and both burst keyframe sets were collapsed to a single easing curve — the old
ones set positions at 18% and 100%, so each bean ran two easing segments back to back and
visibly kinked where they met. Reduced motion still shows the completed state, without
the sweep.

### Who can unlock, and where the wall is launched from (2026-09-01)

**Whose PIN unlocks the wall?** Previously only the signed-in member's, which is wrong in
both directions: the other parent could not unlock the calendar they co-own, and the
obvious fix (accept any adult's PIN) would have let their PIN open the full app _as_ the
signed-in member. That is the security issue worth naming — and it does not have to be
accepted, because the padlock was gating two different things at once.

**The split.** These are now separate capabilities:

|                    | gated on                                                       | why                                                                                                                                                                                                                                                                                                                             |
| ------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Unlock edits**   | any adult's PIN (`ageGroup === 'adult'`, not a pet, has a PIN) | A _family_ capability. Nothing behind it is member-specific: it is the household's shared calendar and lists, which every claimed member can already decrypt — one family key, no per-member confidentiality boundary. Ticks are credited to the job's **owner**, not to whoever unlocked, so attribution does not blur either. |
| **Leave the wall** | the signed-in member's own PIN                                 | An _identity_ capability. It resumes their session, with their privileges (transfer ownership, delete pod, change their credentials) and their name on every later write.                                                                                                                                                       |

So another adult can run the wall without being able to act as you. The distinction is
attribution and privilege, not secrecy — which is the right frame, because in a
shared-key family document secrecy between adults was never the boundary.

A child's PIN never unlocks: `ageGroup` is required on `FamilyMember`, so the gate is
reliable, and a wall a child can unlock is not locked. Pets and PIN-less adults are
excluded. `unlockedBy` is recorded (and logged as `member_id_tail`) so an unexpected edit
can be traced, and cleared on relock. The pad now shows the row of faces whose PINs work,
which answers "whose PIN is this?" without a sentence, and verifies sequentially — three
adults costs at most ~300ms of PBKDF2 on a wrong PIN, already capped by the attempt limit.

**Where the wall is launched from.** Settings-only was too buried for something you do on
a device you are holding. It is now also in the account menu, in the second group beside
Switch Member and Sign Out — both change what _this device_ is doing rather than what the
family's data says. Deliberately not a header icon: the wall is a set-it-once mode and
does not earn permanent header real estate. The Settings card stays as the home for the
mode, where it is explained and the PIN prerequisite is surfaced; the menu item is the
shortcut, hidden when the member has no credential rather than dead-ending them.

Also fixed on the way: the account-menu trigger had no accessible name in either the
mobile or desktop header — a primary control announced as just "button". Both now carry
`aria-label` and `aria-expanded`.

### Board/drawer swap, naming, and travel emphasis (2026-09-01)

**What did unlocking actually enable? Nothing.** Ticking is always allowed by design,
activities were read-only, and no add/edit affordance existed — so the padlock gated only
_leaving_, while the menu promised "unlock edits". A promise with no payload.

Resolved by agreeing the scope rather than building an editor: **activities stay
read-only on the wall** (a wall is for display; the app is where you edit one, and a
wall-scale editor is a large build for a case that barely occurs). The unlock now has one
real, wall-native payload instead — **adding an item to a list**. "Put bread on the
shopping list" is the natural thing to do standing at a kitchen screen. Menu copy
corrected to "Unlock adding to lists", because a control should say what it does.

**Chores now get the board; to-dos get the drawer (#10, #11).** `buildWallJobs` used to
merge to-dos and chore-list items into one "jobs" set per bean, which quietly made the
wall's main board a to-do board with chores mixed in. Split into `choresByMember` and
`todosByMember` (still deduped against each other — the same task written in both places
is one job, to-do winning):

| surface                       | shows                                                                 |
| ----------------------------- | --------------------------------------------------------------------- |
| The chore board (full screen) | items from each bean's repeating lists, plus the shared one-off lists |
| To-do drawer (sheet)          | today's to-dos, grouped by bean                                       |
| Bean lane                     | that bean's events + their to-dos                                     |

The band is reordered and re-weighted to match: **chores** first and widest, with its own
Sky Silk identity so it reads as the anchor rather than one white card of four (the trick
the trip card uses with slate, spent on the thing that matters more), then to-dos, then
Beanie Lists, with **meals and the trip pushed right**. Column widths are derived from
which cards actually render — a fixed four-column template left a hole the day a family
had no meal planned.

**Naming (#9), aligned to the app's own vocabulary.** "Today's jobs" → **Family To-Dos**;
the lane heading "jobs" → **To-Dos**; "The lists" → **Beanie Lists**. For the board I
proposed **"The chore board"** over "chores and beanie lists": it is a board, it is two
words at two metres, and "chores" is the word a family actually uses for the thing.

**Travel (#5, #6).** Each leg now leads with the app's own `SegmentWhenBand` — reused
verbatim, so departs → arrives reads identically to the trip page and cannot drift from
it — fed by `buildWhenBand`, the app's timing rule. Booking state reuses the existing
alert vocabulary (⏳ gold "N items need booking", 🏨 orange "N nights unaccommodated")
plus a green **"All booked"** for the fully-booked case, because "nothing is wrong" is
worth saying on a display nobody will interrogate. Unbooked legs carry their own tag.

**Activities (#7).** Time and place are now a hero band — the same caption/value/sub
rhythm as a travel segment, in the wall's palette rather than travel's teal — with the
supporting logistics as labelled rows beneath. `activityDetailRows` deliberately no
longer returns location: it is one of the two things every surface leads with, so keeping
it out stops a renderer demoting it to the first row of a list.

**Ticked-off time (#8).** A completed row shows "Done 9:03 AM". A wall has the width, and
the useful question about a ticked chore on a shared screen is _when_ — it settles "did
you do that this morning, or is that yesterday's tick?".

**Exiting (#3).** It was several silent seconds then a jump. Both halves were wrong: there
was no feedback at all, and the destination was hard-coded to `/settings`, the app's
heaviest page, which also stranded anyone who had started the wall from the account menu.
Now the return path is captured on the way IN (`getWallReturnPath`), its chunk is warmed
during idle time while the wall sits doing nothing for hours, and a "Leaving the wall…"
screen goes up on the same tick as the tap.

**PIN prerequisite (#4).** The card used to announce the requirement and leave the user to
go and find `PinSettings` themselves — a dead end dressed as guidance. It now opens the
real `PinSettings` card in place, watches for the member's `pinHash` to land, and
continues straight into the wall. Two steps become one flow, with no change to a component
seven other places depend on.

**Left open:** item 2 of greg's list ("when opening a travel item,") arrived truncated.

### Lists-first board, to-do buckets, and per-member colour (2026-09-01, round 3)

**The missing to-dos were a real bug.** The rule filtered on
`dueDate.slice(0,10) === todayYmd`, so a family with nine to-dos saw one, and anything
unassigned was dropped entirely for having nobody's name on it. To-dos are now bucketed
(`overdue` / `today` / `upcoming` / `undated`) and all of them reach the wall; late and
today wear the Heritage Orange band, the rest are present but quiet. Unassigned work gets
an `UNASSIGNED` sentinel owner so it stays inside the same dedupe and keying machinery,
and shows as "Anyone". Completed items stay visible only on the day they were due —
elsewhere a done item is history, not work.

**All lists are equal, under their owner.** `listsByMember` replaces the chores/shared
split: a recurring "leo's jobs" and a one-off "swim bag" are both Leo's list, and parking
one under his name while the other sat in a thin strip along the bottom made half of them
easy to miss. Columns stack a bean's lists under their own titles and trim across the
WHOLE column (so one long shopping list cannot push every other list off the board), with
overflow opening the drawer.

**`ownerId` is required on `FamilyList`, so a truly unowned list cannot exist** — but an
_unresolvable_ owner can (deleted member, unsynced). Those get a labelled "Other lists"
column of their own rather than being dropped: a list nobody can find is worse than one
without a face.

**Cards merged.** The separate Chores card showed one or two rows and earned none of the
space it took. The lists card absorbs it as **Chores & Lists**, takes the lead slot and
the Sky Silk identity, and shows every active list with owner and progress. To-dos get
their own quieter ring — distinct from both the lead card and the trip's slate.

**Faces are initials, not beanies.** The beanie variant is chosen from age group and
species, so two adults or three children rendered as identical faces — and telling people
apart is the one job that element has on a shared board. `WallMemberFace` shows a photo
when there is one, otherwise the person's initial on their own colour. Wall-only: elsewhere
the beanie is deliberate brand character on surfaces that show one member at a time.

**Columns are tinted by member colour** in both the lanes and the chore board — a firm
wash on the header, a whisper on the body. 8-digit hex rather than `color-mix`, which the
old iPads this targets do not support.

**Meals name their slot.** Breakfast/lunch/dinner/snack led with an emoji alone, which
does not distinguish supper from breakfast. The card labels the slot above the meal; the
drawer gives each meal a tinted slot rail, ordered breakfast → snack.

**Also:** activity notes are labelled and given room rather than trailing off as
unlabelled prose; **manual re-lock** added (giving up a capability needs no challenge, and
an adult who unlocked to add one item should not wait out the two-minute timeout); the
unlock label is now the generic **"Unlock editing"**, which required making it true —
quick-add now covers **to-dos as well as lists**, and every list on the board (chore lists
included) shows a "+" when unlocked. Previously the only add affordance in the product sat
on one-off lists in the drawer, so chore lists had no way to add at all.

### Code review of round 3 (`/code-review high`) — 15 findings, all fixed

Two found by me before the review returned, thirteen by it.

| #   | Defect                                                                                                                                                                                                                                                                                                                                     | Fix                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| —   | `columnFor()` was called **ten times per member per render**, each re-flattening and re-counting that bean's lists — the exact bug the previous review caught in `stateFor`, reintroduced by the board rewrite.                                                                                                                            | Memoised into `columnByMember`; `boardProgress` reuses it instead of re-flattening a third time.                                                                               |
| —   | **Dedupe over-reach.** With to-dos no longer filtered to today, one shared `seen` set started suppressing three things it never meant to: a to-do due in three weeks deleted today's chore of the same name off the board; two to-dos sharing a title on different days collapsed into one; and "milk" on two different lists showed once. | Split into a `suppress` set populated ONLY by actionable (today/overdue) to-dos and consulted only by lists. Three regression tests, each of which fails against the old code. |
| 1   | **Pet-owned lists vanished entirely.** `memberIds` came from `familyStore.members` (pets included) while every renderer iterates `sortedHumans`, so a list owned by the dog was filed under a key nothing reads — not a column, not an orphan, not the drawer. `ListDetailModal`'s picker does let you assign one.                         | `memberIds` is now `sortedHumans`, so a pet's list falls into `orphanLists` and is at least findable.                                                                          |
| 2   | **Unassigned to-dos were unreachable.** `todoProgress` summed only per-member lookups, the card is gated on that count, and the lane's route in is gated the same way — so a family whose only to-do was created by the wall's own quick-add (which makes them unassigned **by design**) had no route back to it from any view.            | New `unassignedTodos`; the card counts and shows them under "Anyone" with a neutral disc.                                                                                      |
| 3   | Ticking an **undated** to-do made it vanish under the finger, mid-animation, with the celebration firing over an empty slot — contradicting the rule's own "the tick you just made does not vanish".                                                                                                                                       | Today and undated are the two buckets you can tick from here, so both keep their completions.                                                                                  |
| 4   | `addTodo` failure called `reportListAddFailed`, so a failed to-do told the family "could not add to the list" and logged the user's typed title as a list id.                                                                                                                                                                              | Its own `reportTodoAddFailed` with correct copy.                                                                                                                               |
| 5   | `columnFor`'s budget allocated all remaining rows to items and charged for the title **afterwards**, so a column overran and then dropped the next list wholesale for being "full" of rows added retroactively.                                                                                                                            | Charge the title first.                                                                                                                                                        |
| 6   | A list whose every item was deduped away rendered as a **bare heading** over nothing — newly reachable via the `actionable` split.                                                                                                                                                                                                         | Skip empty groups.                                                                                                                                                             |
| 7   | `sheetLists` ignored `visibleMemberIds` while its own prop doc said "the sheet must agree with the view behind it".                                                                                                                                                                                                                        | Filtered; orphans deliberately always show, since a member filter cannot exclude a list with no resolvable member.                                                             |
| 8   | One list's in-flight add **silently blocked every other list's** — shared `adding` ref, but the other buttons stayed enabled, so the tap did nothing and said nothing.                                                                                                                                                                     | Guard on the list being submitted.                                                                                                                                             |
| 9   | The finance lint zone covered `src/components/wall/**` but **not** `useWall*.ts` or `wall*.ts` — which is exactly where the wall's store access lives.                                                                                                                                                                                     | Globs added.                                                                                                                                                                   |
| 10  | `orphanLists` skipped `sortJobs`, so orphan columns never reordered and their FLIP move never played.                                                                                                                                                                                                                                      | Sorted like every other column.                                                                                                                                                |
| 11  | The to-do drawer wrapped **each row in its own `WallJobList`**, i.e. a `TransitionGroup` per single child — which can never animate a move, defeating the entire reason that component exists.                                                                                                                                             | One list per bucket; the owner name rides on the row via a new optional `ownerLabel`.                                                                                          |
| 12  | An orphan list's tick was credited to its unresolvable owner, so `completedBy` rendered as "Done by " with a hole.                                                                                                                                                                                                                         | Actor falls back to the session member whenever the owner is not a known member.                                                                                               |
| 13  | `todosFor` ran four times per member per render in the lanes, unmemoised — the surface where the memoisation pattern regressed.                                                                                                                                                                                                            | Map-backed computed.                                                                                                                                                           |
| 14  | The return-path capture ran **before** the feature-flag guard, so a navigation to `/wall` that got redirected still set a return path for a visit that never happened.                                                                                                                                                                     | Registered after it.                                                                                                                                                           |
| —   | The Chores & Lists card read raw store lists while the board read the deduped view, so a list whose only item was also a to-do due today showed "0/1" on the card and nothing on the board.                                                                                                                                                | Both now read the same `listsFor` groups.                                                                                                                                      |

Suite after: 5275 unit, 21/21 E2E chromium, lint + stylelint + type-check clean, and the
three highest-severity fixes re-verified in a browser (a pet-owned list appearing under
"Other lists", an unassigned-only to-do reaching the card and drawer, and a fully-deduped
list rendering nothing rather than a bare heading).
