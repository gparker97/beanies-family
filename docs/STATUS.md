# Project Status

> **Last updated:** 2026-04-13
> **Updated by:** Claude (WebKit E2E restored to main-push CI, flakiness hardened, duplicate-run trigger fixed — #155, #156, #165, #166)

## Current Phase

**Phase 1 — MVP** (In Progress)

## Completed Work

### Infrastructure

- Project scaffold with Vite + Vue 3 + TypeScript
- IndexedDB service with repositories (native IndexedDB APIs)
- Pinia stores for all entities (family, accounts, transactions, assets, goals, settings, sync, recurring, translation, memberFilter)
- Vue Router with all page routes (lazy-loaded)
- Dark mode / theme support
- E2E test infrastructure (Playwright — Chromium in CI, 21 focused tests covering critical user journeys)
- Unit test infrastructure (Vitest with happy-dom)
- Linting (ESLint + Prettier + Stylelint + Husky pre-commit hooks)
- File-based sync via File System Access API (with encryption support)
- Google Drive cloud storage integration (StorageProvider abstraction, OAuth PKCE with Lambda proxy, Drive REST API, offline queue, file picker, Google Picker API for join flow, email sharing via Drive Permissions API, reconnect toast, scope validation, cross-account folder cache fix, PWA re-consent loop fix with persistent storage + localStorage token fallback) — ADR-016, #112
- OAuth Lambda proxy (`beanies-family-oauth-prod`) — stateless token exchange & refresh at `api.beanies.family/oauth/google/*`, keeps client_secret server-side
- IndexedDB naming convention: `beanies-data-{familyId}`, `beanies-registry`, `beanies-file-handles` (migrated from `gp-finance-*`)
- Cross-device sync hardening: record-level merge (v3.0 file format), deletion tombstones, 6 sync bug fixes — ADR-017
- Exchange rate auto-fetching from free currency API
- Recurring transaction processor (daily/monthly/yearly)
- Multilingual support (English + Chinese) via MyMemory API with IndexedDB caching
- Project documentation: `docs/ARCHITECTURE.md`, `docs/adr/` (13 ADRs)
- Generic IndexedDB repository factory (`createRepository.ts`) — shared CRUD for 8 entity stores
- Toast notification system (`useToast.ts` + `ToastContainer.vue`) — error/success/warning/info toasts
- Store action helper (`wrapAsync()`) — centralized try/catch/finally for all store CRUD operations
- Node.js 24 across all CI/CD workflows and local development
- Family key encryption service: AES-256-GCM family key with AES-KW per-member wrapping, invite link service, v4.0 beanpod file format types, QR code utility, shared encoding helpers (#111)
- Permission roles: `canViewFinances`, `canEditActivities`, `canManagePod` fields on FamilyMember, `usePermissions()` composable, route guards, sidebar/mobile nav filtering, readOnly modal pattern, NoAccessPage (#132)
- Cache-first loading architecture: loads from encrypted IndexedDB persistence cache for instant display (<500ms), then background-syncs from Google Drive via CRDT merge. Skeleton screens replace full-screen spinner when no cache. BackgroundSyncBar (3px Heritage Orange progress bar) shows sync activity. Manual refresh in profile dropdown. Success toasts on reconnection/online recovery

### UI Components

- Base component library: BaseButton, BaseCard, BaseCombobox, BaseInput, BaseModal, BaseSelect
- AppHeader, AppSidebar layout components

### Pages / Features

- Dashboard with summary cards (combined one-time + recurring totals)
- Accounts management (full CRUD, card-based layout)
- Transactions management (full CRUD, with date filter, category icons, projected recurring transactions, Today button on month navigator)
- Assets management (full CRUD, loan tracking, combined net worth)
- Goals management (full CRUD, collapsible completed goals section)
- Reports page (net worth, income vs expenses, extended date ranges, category breakdowns)
- Family member management (global member filter)
- Settings page (currency, theme, sync, encryption)
- First-run setup wizard
- Multi-currency display with global display currency selector
- Family Nook home screen (`/nook`) — greeting, status toast, family beans row, schedule cards (merged todos + planner activities with view-first modals, "This Week" card grouped by day/date matching planner sidebar pattern), inline todo widget with view/edit modals, milestones, piggy bank card, recent activity feed (view-first modals for todos + transactions). Overdue task detection with orange pill + ⏰ indicator. Task description preview (2-line clamp) on cards. `/` redirects to `/nook`
- Family Hub / Bean Pod (`/family`) — v7 redesign (#73): 3-column layout (sidebar, member cards, quick-info panel), activity-focused member cards (upcoming events, milestones, activity count, tasks — no financial data), role tags ("Parent Bean"/"Little Bean"), Heritage Orange selected state, events this week panel. Calendar removed (→ Family Planner #98)
- Travel Plans page (`/travel`) — dedicated trip planning with timeline, edit modals, ideas, helpful hints, inline editing. Route `/planner` renamed to `/activities`
- Landing page (`/home`) — full implementation from mockup (#72): hero with hugging beanie mascot + animated headline, 3 floating device screenshots (Nook, Piggy Bank, Planner), trust badges, security section with 6 cards, Greg's full beanies story, animated CTA with celebrating beanies circle, footer with Slack-wired contact form (`VITE_CONTACT_WEBHOOK_URL`), scroll progress bar, IntersectionObserver reveal animations, smooth-scroll anchor navigation, back-to-top button. Scoped CSS (not Tailwind) for pixel-perfect mockup fidelity. Decorative brand character images as low-opacity background accents. E2E tests updated.

### WebKit Overlay Fixes & E2E Hardening (2026-04-13)

- **Onboarding overlay stuck on Safari/iOS (#153)**: Vue's `<Transition>` inside `<Teleport>` was stalling the leave transition on WebKit, leaving an invisible click-blocking overlay on top of the app after onboarding completion. Replaced the outer fade `<Transition>` with a deterministic class toggle (`ob-overlay-hidden`) + `setTimeout`-driven unmount. Visual behaviour identical, no Vue-transition dependency. Inner step `<Transition>` untouched (never the issue).
- **Global E2E reduced-motion**: `playwright.config.ts` now sets `reducedMotion: 'reduce'` on the shared `use` block. `src/style.css` extends the `prefers-reduced-motion` block with a universal `*, *::before, *::after { animation-iteration-count: 1; animation-duration: 0.01ms }` rule that disables all infinite keyframe animations at once — resolved WebKit "waiting for element to be stable" stalls caused by HomePage decorative float animations. Real users with the accessibility preference also benefit.
- **App loading overlay defused**: The init spinner in `App.vue` (`z-[300]` full-screen div in a `<Transition>`) was getting stuck at `opacity: 0` on WebKit and blocking all clicks. Added `pointer-events-none` — the overlay only holds a spinner, nothing clickable, so this is always the correct behaviour.
- **E2E workflow consolidation**: Deleted the duplicate `e2e-tests` job from `main-ci.yml`. `e2e.yml` is now the single source of truth, with an event-aware matrix: push to `main` → Chromium only (temporarily, pending #155), `run-e2e` PR label → Chromium + WebKit on demand, weekly → full 3-browser sweep. Playwright browser cache added.
- **Follow-up #155** tracks 10 remaining WebKit-only timeouts (Account Institution combobox, planner recurring flows, financial data dashboard) — unrelated to overlays; look like CI perf / timing or genuine WebKit-specific app behaviour. Chromium + Firefox still green.

### WebKit E2E Restored to Main-Push CI (2026-04-13 — later)

- **#155 resolved (PR #156)**: reduced-motion rule now zeroes out `transition-duration` globally (not just `animation-*`), so Vue modal/drawer enter transitions no longer keep dialog buttons "unstable" on webkit. Page-object `goto()` uses `waitUntil: 'domcontentloaded'` to fix the `/transactions` navigation hang on webkit's `load` event. Webkit Playwright project gets its own 40s test timeout for headroom.
- **Webkit flakiness hardened (PR #165)**: a duplicate parallel PR run exposed residual flakiness on identical SHAs — webkit timeout raised to 60s and webkit retries to 2 (CI only) to absorb transient "WebKit encountered an internal error" crashes on page.goto. Also hardened `google-drive.spec.ts` "Create Pod step 2" with an explicit `waitFor` before the Create click — previously raced the WelcomeGate → CreatePodView transition.
- **CI cleanup (PR #166)**: (a) duplicate E2E runs fixed — `e2e.yml` now gates on `github.event.label.name == 'run-e2e'` so only the actual `run-e2e` label add triggers a run (previously every label added to a PR with `run-e2e` fired another run on the same SHA). (b) Webkit is back on every main-push alongside chromium — Safari/iOS is a large share of our users. ADR-007 updated.
- **Current matrix**: PR (opt-in `run-e2e`) → chromium + webkit; push to main → chromium + webkit; weekly schedule → chromium + firefox + webkit.
- **ADR-007 updated** to reflect the new browser-coverage policy.

### Product Hunt Launch Day (2026-04-09)

- **Privacy Policy page** (`/privacy`): Full privacy policy covering local-first data model, no data collection, Plausible analytics, Google Drive encryption, cookies (none), children's privacy, data portability. Uses `HelpPublicHeader` for unauthenticated visitors.
- **Terms of Service page** (`/terms`): Terms covering "as is" warranty, not financial advice, liability limitations, open source license, acceptable use, data responsibility.
- **Routes & footer links**: Both legal pages added to Vue Router (`requiresAuth: false`), footer links added to `HomePage.vue` and `PublicFooter.vue`.
- **SEO & social sharing**: Twitter Card meta tags, canonical URL, OG image alt/width/height, `robots.txt`, `sitemap.xml` added for Product Hunt launch readiness.
- **Security audit**: Full security, SEO, and UX audit via 3 parallel agents. No launch blockers found. npm audit vulnerabilities resolved (0 remaining).

### Blog, Planner & Skills (2026-04-10)

- **Blog post #3 published** ("does family trip planning stress you out? me too"): Travel plans intro with screenshot, UTM-tracked links across all blog posts, image lightbox on post pages. Blog URL changed from `/beanstalk` to `/blog` (redirects from old URLs). Blog title renamed to "beanie beanstalk". Coming soon cards updated.
- **Daily calendar view** (`DailyCalendarView.vue`): Per-member columns showing one day's schedule for the whole family. Adults sorted first (oldest→youngest), then children. Column separators with member-color accent bars and subtle gradient tints. Click-to-create pre-fills date + time + member. Mobile: MemberChipFilter strip + ActivityListCard agenda.
- **Hover time labels**: Weekly and daily calendar hover "+" indicators now show the time range (e.g., "3pm – 4pm") for clarity.
- **Activity drawer improvements**: Field order reordered to Title → Schedule → Who → Category (matches natural "what + when + who" flow). One-time activities no longer show fee schedule chips, monthly charge, or per-session breakdown — linked payment wired as one-time. All-day activities show "all day" label in list views. `defaultAssigneeIds` prop added for pre-filling from daily view.
- **DRY cleanup**: `familyStore.sortedMembers` computed consolidates 3 duplicated inline member sorts (MemberChipFilter, FamilyChipPicker, FamilyTodoPage). `useDayNavigation` composable + `formatDayLong` utility added.
- **View toggle**: Day view added to month/week toggle. Auto-scroll on view switch fixed (only scrolls on fresh page load).
- **Pilot-scout skill** (`/pilot-scout`): Multi-platform internet scouting for potential pilot users across Reddit, HN, Twitter/X, Quora, MetaFilter, Product Hunt, Indie Hackers, and more. Logs to Notion. Platform-specific freshness cutoffs, dedup against existing entries.
- **Nav link rename**: "blog" → "beanstalk" across all nav links and footers (URL remains `/blog`).
- **Plausible custom events**: Added analytics tracking for `signup`, `member_joined`, `family_deleted`, `login` (with method prop), `feature_used` (with feature prop). Uses `window.plausible?.()` (optional chaining for test safety). Type declaration at `src/types/plausible.d.ts`. Privacy Policy updated with disclosure.
- **Substack auto-subscribe**: New families auto-subscribed to Beanstalk newsletter (gpbeanies.substack.com) during signup via pre-checked opt-out checkbox in `CreatePodView`. Fire-and-forget POST to Substack's `/api/v1/free` endpoint (`mode: 'no-cors'`).
- **end-of-day skill** (`.claude/skills/end-of-day/SKILL.md`): Session wrap-up skill — cleans working tree, updates STATUS.md/CHANGELOG.md, Notion Launch HQ, checks for unfinished work.
- **Saved plan**: Server-side DynamoDB stats counters (`docs/plans/2026-04-09-server-side-stats-counters.md`) — not yet implemented, saved for later.

### Budget Currency Fixes, Setup Progress Modal, Blog & Substack (2026-04-08)

- **Budget currency normalization**: All budget amounts now correctly captured and displayed in the user's display currency, fixing inconsistencies when mixing currencies (#e01441e, #69bf6b8)
- **Setup wizard progress modal**: Added progress modal to the setup wizard finish step for better UX feedback during initial data creation (#bb9eab3)
- **Substack subscribe embed**: "The Beanstalk" newsletter subscribe widget added to blog index and individual post pages (#371a8ce)
- **Blog post #4 drafted** (Notion): "best cozi & maple alternatives in 2026" — SEO comparison post covering Cozi, Maple, TimeTree, FamilyWall, YNAB, Greenlight + 7 notable mentions. Status: Draft, pending review
- **Product Hunt Alpha Day**: Launch page submitted and scheduled for Apr 9

### Help Center Expansion & beanies-help-docs Skill (2026-03-27)

- **beanies-help-docs skill** (`.claude/skills/beanies-help-docs/SKILL.md`): Project-level Claude Code skill for creating, reviewing, and auditing help center articles. Defines four article types (how-to, explainer, reference, troubleshooting), writing standards, quality checklist, audit workflow, and beanies voice guidelines. Invoke via `/beanies-help-docs`.
- **4 new help articles** (17 → 21 total):
  - "Your Daily Briefing" (explainer, `how-it-works`) — critical activities orange box logic on Family Nook
  - "Family To-Do Lists" (how-to, `features`) — creating, editing, completing, filtering, Nook integration
  - "Travel Plans & Vacations" (how-to, `features`) — 5-step wizard, timeline, booking progress, ideas voting
  - "The Family Nook — Your Home Base" (explainer, `features`) — every Nook widget documented
- **Bug fix**: "View all articles" link was hardcoded to `/help/getting-started` — now smooth-scrolls to article index
- **Help Center landing page**: Article index redesigned as clickable category cards with article previews (up to 4 per card, "+N more" overflow). Popular articles capped at 3.
- **Category page redesign**: Hero banner with glow effect, article count badge, "Explore other topics" cross-navigation section

### E2E Test Strategy Overhaul (2026-03-25)

- **Suite reduction**: 87 → 21 tests (76%), 15 → 7 spec files (53%)
- **CI optimization**: Chromium-only (dropped Firefox matrix), CI time 10+ min → 4.5 min
- **Three-Gate Filter**: Every E2E test must pass business-critical outcome, full-stack integration, and deterministic gates
- **Budget cap**: 25 tests max — forces prioritization when adding new tests
- **8 conventions**: Assert data not DOM, no testing mocks, no `waitForTimeout`, separate tests for separate outcomes, etc.
- **Removed**: Homepage routing (4), date filters (3), beanie avatars (4), beanie mode (4), sound effects (3), Google Drive mock API (6), onboarding step-by-step (9), simple CRUD duplicates
- **Consolidated**: Planner 16 → 5, invite/join 9 → 3, combobox 9 → 3, loan-activity 4 → 3
- **Health tracking**: `docs/E2E_HEALTH.md` — log each CI failure as bug/intentional/flake, quarterly review
- **ADR-007 revised**: Full strategy, conventions, and health tracking documented
- Plan: `docs/plans/2026-03-25-e2e-test-strategy-overhaul.md`

### Travel Link Field & Transaction Schedule Summary (2026-03-25)

- **Link field on all travel segments**: Optional URL added to flights, cruise, train/ferry, car, accommodations, and transportation (previously only activities and ideas). Shares row with booking ref or contact phone for space efficiency
- **Transaction view schedule summary box**: Grey summary box matching activity view convention — shows recurrence pattern + start/end dates for recurring, or formatted date for one-time transactions. Replaces standalone recurrence pill
- **Changelog introduced**: `CHANGELOG.md` with Keep a Changelog format, 2-week git history backfill. CLAUDE.md updated to mandate changelog update on every push

### Dedicated Travel Plans Page (2026-03-21)

- **New `/travel` route**: Full dedicated page for vacation/trip planning with list + expanded views. Route `/planner` renamed to `/activities`
- **Trip list view**: Card grid with countdown badges, member chips, progress bars, collapsible past trips section, empty state
- **Expanded trip view**: Teal gradient hero banner, visual timeline with date nodes, ideas panel with quick-add
- **Visual timeline**: Chronological date groups with segment cards, inline accommodation gap warnings at correct positions, connector dots and vertical line
- **Inline editing**: Detail rows with auto-sizing inputs + pencil hint on hover, saves on blur via `saveInlineField()`. Copy badge restricted to booking ref only
- **Segment edit modals**: `TravelSegmentEditModal`, `AccommodationEditModal`, `TransportationEditModal`, `IdeaEditModal` — all using BeanieFormModal
- **Ideas system**: VacationIdeaCard with vote/title/description/meta layout matching mockup. IdeaEditModal with category pills, currency amount input, link field (auto-prepends https://), duration, booking needed. "Other" category added
- **Helpful hints**: Overlap detection (accommodation/accommodation, accommodation/cruise, flight/cruise) with amber card tint + ⚠️ toggle indicator
- **Trip-type countdown language**: "days until takeoff" (fly), "days until we set sail" (cruise), "days until we hit the road" (road trip), etc.
- **Business trip support**: `tripPurpose` field on `fly_and_stay` trips — 💼 icon, muted countdown
- **Flight UX**: Arrival date replaced with "+1 day" checkbox, compact 3-column layout (date/dep time/arr time)
- **Cruise**: Embarkation time field added
- **Car segment type**: New `car` travel type with car type toggle (family/rental/other), car name, leaving time. Auto-selected for road trips
- **Train updates**: Icon → 🚅 bullet train, labels → "Train Company"/"Train Number"
- **Status simplification**: `VacationSegmentStatus` reduced to `booked | pending`. Pending items show in timeline with gold dashed-border tint
- **Accommodation pre-fill**: Hotel check-in/out auto-populated from outbound arrival / return departure dates
- **Wizard steps 3 & 4 refactored**: Match Step 2 convention — `+ type` pills at bottom that always append (no toggle/replace). Single type per entry, immutable after creation
- **"+ add a plan" button**: Bottom of timeline with animated type picker (Travel/Stay/Getting Around) → opens wizard at correct step
- **Delete support**: Delete button on all timeline cards (including undated), delete trip from detail page hero, idea delete with confirmation
- **NookSectionCard**: Shared card wrapper for consistent nook/activities section styling. NookVacationCard with blue gradient tint + countdown hero badge
- **Accommodation gap warnings**: `computeAccommodationGaps()` extracted to shared utility. Shown on trip cards (list, sidebar, nook) + inline in timeline
- **Onboarding fixes**: Google Drive modal de-emphasized "View in Drive" + auto-advances, loading spinners on Add Member/Finish, accounts displayed in list
- **Todo mobile UX**: Skip auto-focus on quick-add bar for mobile/tablet (prevents keyboard popup)
- **DRY**: `useVacationTimeline` composable, shared option builders in `vacation.ts`, `buildTravelKeyValue` shared function
- **Files**: 6 new components, 1 new composable, ~25 modified files. VacationViewModal deleted (replaced by dedicated page)
- Plan: `docs/plans/2026-03-21-dedicated-travel-plans-page.md`

### Cache-First Loading & Reconnection UX (2026-03-24)

- **Cache-first loading**: App loads from encrypted IndexedDB persistence cache first (<500ms), then background-syncs from Google Drive via Automerge CRDT merge. Eliminates 4-5s blocking spinner for returning users
- **Skeleton screens**: `ContentSkeleton.vue` — generic card-grid skeleton with Heritage Orange shimmer animation (`beanie-shimmer`), shown in content area while data loads from Drive. Matches NookSectionCard styling
- **App shell renders immediately**: `isInitializing` dismissed after auth (~150ms) instead of after data load. New `isLoadingData` ref gates skeleton vs router-view
- **BackgroundSyncBar**: 3px Heritage Orange indeterminate progress bar at top of viewport (z-200), shown during background sync
- **Manual refresh**: Refresh icon in profile dropdown banner (both mobile and desktop). Triggers Drive sync + SW update check. Spinning icon during refresh, success/error toasts
- **Reconnection success toasts**: Explicit confirmation when Google Drive reconnects ("Reconnected — all data saved"), silent auto-reconnect recovery, "Back online" toast on network restore
- **DRY refactor**: `tryDecryptWithCachedKey()` shared helper in syncStore deduplicates needsPassword pattern from 3 call sites. `preservePermissionState` option on `loadFromPersistenceCache()`
- **Files**: 2 new components (`ContentSkeleton.vue`, `BackgroundSyncBar.vue`), 5 modified files
- Plan: `docs/plans/2026-03-24-cache-first-loading.md`

### Nook Schedule Card Grouping (2026-03-19)

- **"This Week" card grouped by day/date**: Items in the ScheduleCards "This Week" panel are now grouped under date headers (Today, Tomorrow, weekday + date), matching the existing pattern in DayAgendaSidebar and UpcomingActivities. Removes per-item date display in favor of group headers for clearer temporal context

### Weekly Calendar View & Planner Enhancements (2026-03-17)

- **Weekly calendar view** (`WeeklyCalendarView.vue`): 7-column hourly time grid with activity blocks positioned at time slots, current time indicator, auto-scroll to now. Mobile: horizontal day tab strip with card list
- **Shared component extractions (DRY)**: `ActivityListCard.vue` (eliminated 3× card duplication), `CalendarNavBar.vue` (shared prev/next/today nav), `useCalendarNavigation.ts` composable (week navigation + time grid positioning + overlap grouping)
- **All-day activities**: `isAllDay` and `endDate` fields on FamilyActivity model. ActivityModal checkbox to toggle all-day mode (hides time pickers, shows optional end date for multi-day). Multi-day all-day activities span across day columns as a single bar in weekly view
- **TodoItemRow shared component**: Extracted from TodoItemCard and NookTodoWidget, reused in DayAgendaSidebar and weekly view for todo display
- **DayAgendaSidebar enhanced**: Added "Tasks Due" purple section showing todos for selected date
- **Form validation UX**: `FormFieldGroup` error prop with orange ring highlight. ActivityModal highlights missing required fields on save attempt instead of disabling save button
- **InlineEditField z-index fix**: Active edit controls layer above neighboring grid cells
- **Todo modal button**: Changed "Done" to "Close" in TodoViewEditModal to avoid confusion with completing
- **ViewToggle**: Removed day/agenda options (redundant with weekly + sidebar). Default view changed to week
- **E2E tests updated**: Planner tests adapted for week-view default with scoped selectors
- Plan: `docs/plans/2026-03-17-weekly-daily-calendar-views.md`

### Assets Page Visual Polish (2026-03-13)

- **Stat card subtexts**: All 4 SummaryStatCards on Assets page now show contextual subtitles (asset count, active loan count, "After loan deductions", appreciation %)
- **Equity progress bar**: Green gradient bar above loan panel showing equity % for assets with loans
- **Loan panel restructure**: Header row with label + amount side-by-side, 2-column detail grid below
- **Card stagger animation**: `fade-slide-up` keyframe extracted from GoalsPage to global `style.css` for reuse, cards animate in with 70ms stagger delay
- **Card hover effects**: `group-hover:scale-[1.08]` on icon, `opacity-0 group-hover:opacity-100` on action dots
- **Notes quote style**: `border-l-2 border-gray-200 pl-3` left-border quote styling
- **SummaryStatCard fix**: Subtitle font `text-[10px]` → `text-xs` (CIG min 12px), label/subtitle stacked vertically instead of horizontal to prevent wrapping
- **InfoHintBadge fix**: Rewrote from `position: absolute` to `<Teleport to="body">` with `position: fixed` to escape `overflow-auto` clipping on `<main>`
- 4 new translation keys: `assets.equity`, `assets.activeLoans`, `assets.afterLoanDeductions`, `assets.overall`
- Plan: `docs/plans/2026-03-13-assets-page-visual-polish.md`

### Goals & Assets Page Revamp (2026-03-13)

- **GoalsPage rewrite**: Sectioned layout with group-by toggle (member/priority), encouragement messages, milestone dots, "almost there" glow, achieved goals section
- **AssetModal extraction**: Extracted ~720 lines of duplicated inline modal forms from AssetsPage into `AssetModal.vue` component
- **DRY fix**: `persistCustomInstitutionIfNeeded` moved to shared `useInstitutionOptions.ts` composable
- **SummaryStatCard**: Added `rawValue` prop for non-currency display (goal counts)

### E2E Shared UI String Resolver (2026-03-13)

- **`e2e/helpers/ui-strings.ts`**: Shared resolver that imports `UI_STRINGS` from the app's translation system, so E2E tests reference translation keys instead of hardcoded English strings
- **ComboboxHelper fix**: Updated constructor to handle both BaseCombobox wrapper (`.relative.space-y-1`) and FormFieldGroup wrapper (`.space-y-2`) using `.or()` pattern
- **Full migration**: All E2E helpers, page objects, and spec files migrated to use `ui()` — covers auth.ts, AccountsPage, TransactionsPage, AssetsPage, and 8 spec files
- Strings without matching uiStrings keys (setup flow form labels, brand tagline, beanie-mode assertions) left as-is

### Beanie Brand Asset Icons

- `beanies_covering_eyes_transparent_512x512.png` — replaces all lock/closed-padlock SVG icons (privacy mode active, data encrypted, data hidden)
- `beanies_open_eyes_transparent_512x512.png` — replaces all open-padlock SVG icons (privacy mode off, data visible, data unencrypted)
- `beanies_impact_bullet_transparent_192x192.png` — replaces warning/alert/exclamation SVG icons and all feature bullet point icons (SyncStatusIndicator warning, PasskeySettings alert, LoginPage security bullets, SetupPage security bullets)
- Theme skill (`.claude/skills/beanies-theme.md`) updated with icon usage guide

### Centralized Icon System (Issue #44)

- **`src/constants/icons.ts`** — Central registry of ~72 beanie-styled SVG icon definitions with `BeanieIconDef` type. Organized into: NAV (9), ACTION (8), SUMMARY (5), UTILITY (10), STATUS (4), CATEGORY (28), ACCOUNT_TYPE (8), ASSET_TYPE (9). Helper functions: `getIconDef()`, `getAccountTypeIcon()`, `getAssetTypeIcon()`
- **`src/components/ui/BeanieIcon.vue`** — Universal icon component enforcing brand style (stroke-width 1.75, round linecap/linejoin). Props: `name`, `size` (xs/sm/md/lg/xl), `strokeWidth`. Falls back to three-dot circle for unknown icons
- **`src/components/common/PageHeader.vue`** — Shared page header with 40px rounded-xl icon container + title + subtitle + action slot
- **15 files migrated** — All inline SVGs replaced with BeanieIcon in: AppSidebar, AppHeader, BaseModal, CategoryIcon, AccountTypeIcon, DashboardPage, AccountsPage, TransactionsPage, AssetsPage, GoalsPage, ReportsPage, ForecastPage, FamilyPage, SettingsPage
- CategoryIcon.vue reduced from ~365 lines to ~45 lines (19-branch v-if chain → single BeanieIcon)
- AccountsPage reduced from 893 to ~591 lines; AssetsPage collapsed 2x 9-branch asset type icon chains
- Zero inline `<svg>` elements remaining in all migrated files

### Micro-Animations (Issue #45)

- Page header icon bounce on load, sidebar hover wobble/scale, card hover lift
- Summary card count-up animation, goal progress bar fill animation
- Empty state floating/breathing animation
- Privacy toggle beanie blink, theme toggle rotation
- All animations respect `prefers-reduced-motion`
- CSS `@keyframes` using hardware-accelerated `transform` + `opacity`

### Empty State Beanie Illustrations (Issue #47)

- Beanie character illustrations for all empty states: accounts, transactions, recurring, assets, goals, reports, dashboard
- `EmptyStateIllustration.vue` component with variant prop
- Stored in `public/brand/empty-states/`

### 404 Page Redesign (Issue #48)

- Full beanie-themed 404 page with lost beanie illustration
- Playful heading and encouraging subtext, brand-styled CTA

### Loading States with Brand Spinner (Issue #49)

- `BeanieSpinner.vue` component using `beanies_spinner_transparent_192x192.png`
- Brand spinner for all loading states (app load, language switching, data fetch, button loading)
- Loading text: "counting beans..." (never "Loading...")

### Forecast "Coming Soon" Redesign (Issue #50)

- Beanie with telescope illustration
- Warm brand-voice copy, beanie impact bullet icons for feature list

### Sound Effects System (Issue #46)

- **`src/composables/useSounds.ts`** — Web Audio API synthesised sounds (zero bundle size, sub-ms latency)
- 6 sound functions: `playPop()`, `playClink()`, `playChime()`, `playFanfare()`, `playWhoosh()`, `playBlink()`
- `soundEnabled` global setting (defaults to `true`) with toggle in Settings > General
- AudioContext created lazily on first user gesture (browser autoplay compliance)
- Celebration integration: `playChime()` on toast celebrations, `playFanfare()` on modal celebrations
- Delete actions: `playWhoosh()` on account/transaction/recurring/asset/goal deletes
- Privacy toggle: `playBlink()` on header privacy eye toggle
- App.vue watcher syncs `soundEnabled` setting to composable
- Goal completion detection fixed: `updateGoal()` now detects completion transitions and fires celebrations (previously only `updateProgress()` did, which was never called from UI)
- Goals empty state fixed: shows when all goals are completed (was checking all goals instead of active goals)
- Celebration toast image enlarged from 40px to 80px
- Unit tests (5) and E2E tests (3)

### Multi-Family Architecture (Stage 1)

- Per-family database architecture: each family gets its own IndexedDB (`beanies-data-{familyId}`)
- Registry database (`beanies-registry`): stores families, user mappings, global settings
- Family context orchestrator (`familyContext.ts`) and Pinia store (`familyContextStore.ts`)
- Legacy migration service: auto-migrates single-DB data to per-family DB on first boot
- Global settings split from per-family settings (theme, language, exchange rates are device-level)
- Sync file format v2.0: includes `familyId` and `familyName` (backward-compatible with v1.0)
- Per-family file handle storage for sync
- New types: `Family`, `UserFamilyMapping`, `GlobalSettings`
- All existing repositories work unchanged (transparent multi-tenancy via `getDatabase()`)
- E2E test helpers updated for dynamic per-family DB discovery

### File-Based Authentication (replacing Cognito)

- **Password service** (`src/services/auth/passwordService.ts`): PBKDF2 hashing (100k iterations, SHA-256, 16-byte salt, 32-byte hash) with constant-time verification
- **Auth store** (`src/stores/authStore.ts`): complete rewrite — signIn (member picker + password), signUp (owner creates pod), setPassword (joiner onboarding), signOut
- **Login flow**: WelcomeGate → LoadPodView (file picker + decrypt modal) → PickBeanView (member picker + password) / CreatePodView (3-step wizard) / JoinPodView (family code entry)
- **Data model**: `passwordHash` and `requiresPassword` fields on `FamilyMember`
- Route guards: all app routes have `requiresAuth: true`, login route exempt
- App.vue bootstrap simplified: global settings → auth init → family resolution → data load
- ADR-014 (file-based auth decision), supersedes ADR-010 and ADR-013

### Passkey / Biometric Authentication (Issue #16)

- `passkeyCrypto.ts`: PRF helpers, HKDF key derivation, AES-KW DEK wrapping/unwrapping
- `passkeyService.ts`: Full WebAuthn registration + assertion with PRF and non-PRF paths
- `passkeyRepository.ts`: IndexedDB CRUD for passkey registrations (registry DB v3)
- Dual-path strategy: PRF (true passwordless) + cached password fallback (Firefox)
- `BiometricLoginView.vue`: One-tap biometric login on returning devices
- `PasskeyPromptModal.vue`: Post-sign-in prompt to enable biometric login
- `PasskeySettings.vue`: Full management UI (register, list, remove passkeys)
- Password change invalidates PRF-wrapped DEKs, updates cached passwords
- ADR-015 documents the architectural decision
- `PasskeySettings.vue` component: lists registered passkeys, register new, remove existing
- Requires server-side challenge generation for full flow (deferred)

### Cognito Removal

- Deleted: `src/config/cognito.ts`, `src/services/auth/cognitoService.ts`, `src/services/auth/tokenManager.ts`, `src/services/auth/index.ts`, `src/services/api/adminApi.ts`
- Deleted: `src/pages/MagicLinkCallbackPage.vue`, `src/components/login/VerificationCodeForm.vue`, `src/components/family/CreateMemberAccountModal.vue`
- Deleted: `infrastructure/modules/auth/` (Cognito User Pool), `infrastructure/modules/api/` (Lambda + API Gateway), `infrastructure/scripts/cognito-sync-check.sh`
- Removed `amazon-cognito-identity-js` package (~165KB bundle reduction)
- Removed `cachedSessions` object store from registry database (v1 → v2 migration)
- Removed `CachedAuthSession` type, `isLocalOnly` from `UserFamilyMapping`, `isLocalOnlyMode` from `GlobalSettings`
- Removed Cognito env vars from `.env.example`, `.github/workflows/deploy.yml`, `vite.config.ts`

### File-First Architecture

- Encrypted data file is the source of truth; IndexedDB is a temporary cache deleted on sign-out
- Sign-out cleanup: `deleteFamilyDatabase()`, `resetState()` on all data stores, file handle preserved
- App startup always loads from data file when configured; IndexedDB fallback only when file permission not yet granted
- Auto-sync always on when file is configured (no toggle)
- Setup wizard adds Step 3 "Secure Your Data": requires file creation with encryption password
- Default `encryptionEnabled` changed to `true`
- Settings renamed "File Sync" → "Family Data Options"; removed Sync Now, Disconnect, Auto-sync toggle
- Encryption toggle warns before disabling
- SyncStatusIndicator: "Syncing..." → "Saving...", "Synced to..." → "Data saved to..."
- Login page: three security benefit bullet points (encrypted file, no server storage, cloud backup via folder)
- ADR-011: file-first architecture decision record

### beanies.family Rebranding (Issue #22)

- Renamed app from "GP Family Planner" to `beanies.family` across all UI, metadata, and configuration
- Updated `index.html` title and Google Fonts (Outfit + Inter replacing Poppins)
- Updated `vite.config.ts` PWA manifest: name, short_name, description, theme_color, background_color
- Updated `package.json` name, `router/index.ts` title, `passkeyService.ts` RP_NAME, `uiStrings.ts` app name/tagline
- Rewrote `src/style.css` with Tailwind 4 `@theme` brand colour scales (Heritage Orange, Deep Slate, Sky Silk, Terracotta)
- Replaced `public/favicon.svg` with beanies-branded SVG
- Updated all UI components to squircle shape language (`rounded-2xl`/`rounded-3xl`/`rounded-xl`)
- Replaced all blue/indigo colours with brand primaries (`primary-500` Heritage Orange, `secondary-500` Deep Slate)
- Updated AppSidebar: beanies logo, brand wordmark, Outfit font, primary active states
- Updated AppHeader: primary colours for active states and privacy toggle
- Updated all 12 page files: brand colours, brand name, brand backgrounds
- Added `CelebrationOverlay.vue` component with toast (4s auto-dismiss) and modal modes
- Added `useCelebration` composable with six celebration triggers wired to key app events:
  - Setup complete, first file save, first account, first transaction, goal reached, debt paid off
- Added pod spinner loading overlay in `App.vue` ("counting beans..." copy)
- Added project-local skill `.claude/skills/beanies-theme.md`

### Beanie Character Avatars (Issue #39) — Closed

- **`src/constants/avatars.ts`** — 8 SVG avatar variant definitions (`adult-male`, `adult-female`, `adult-other`, `child-male`, `child-female`, `child-other`, `family-group`, `family-filtered`). Bean/pill body shapes with dot eyes, arc smiles. All children wear beanie hats (brand signature). Adults have optional cap (male), bow + shoulder-length hair (female), or clean body (other). Female variants have full hair dome + flowing side strands + clear bowtie (two triangles meeting at a point)
- **`src/components/ui/BeanieAvatar.vue`** — Avatar rendering component with `variant`, `color`, `size` (xs/sm/md/lg/xl), `ariaLabel` props. Renders inline SVG filled with member's profile color, features in Deep Slate. `family-group` renders 4 distinct characters (2 adults + 2 children with beanies) in brand colors (Heritage Orange, Sky Silk, Terracotta, Soft Teal). `family-filtered` renders bean + funnel overlay
- **`src/composables/useMemberAvatar.ts`** — `getAvatarVariant(gender, ageGroup)`, `getMemberAvatarVariant(member)` (with defaults for legacy records), reactive `useMemberAvatar(memberRef)` and `useFilterAvatar(allSelectedRef)` composables
- **Data model** — Added `Gender` (`male`|`female`|`other`), `AgeGroup` (`adult`|`child`), and optional `DateOfBirth` (`{ month, day, year? }`) to `FamilyMember` interface
- **Repository migration** — `applyDefaults()` in `familyMemberRepository.ts` ensures legacy records get `gender: 'other'`, `ageGroup: 'adult'`
- **FamilyPage** — Gender + age group selects (Male/Female/Other, default Male), date of birth dropdowns (month Jan-Dec, day 1-31, optional year), live avatar preview in add/edit member modals. Member cards show BeanieAvatar instead of initial circles. Full edit member modal with pencil icon on each card
- **Header filter icons** — MemberFilterDropdown trigger shows: family-group BeanieAvatar (lg) + "all" when all selected, individual member avatar + name when one selected, filtered icon + count for partial selection. Borderless trigger style (no border/background, tight spacing with arrow)
- **BaseMultiSelect** — Added `#trigger` and `#option` scoped slots + `borderless` prop (backward compatible)
- **BaseSelect** — Fixed right padding (`pl-3 pr-8`) so dropdown arrow is always visible
- **AppHeader** — Profile avatar replaced with BeanieAvatar (falls back to `adult-other`)
- **SetupPage + AuthStore** — Default `gender: 'male'`, `ageGroup: 'adult'` for owner creation
- 15 new translation keys with beanie mode overrides
- Unit tests: 14 tests (composable + avatar definitions)
- E2E tests: 4 specs (header avatar, family cards, add child member, filter dropdown)

### Sidebar Redesign (Issue #59)

- **`src/constants/navigation.ts`** — Shared `NavItemDef` interface and `NAV_ITEMS` array with `PRIMARY_NAV_ITEMS`/`SECONDARY_NAV_ITEMS` exports. Emoji icons, primary/secondary section split. Ready for reuse by mobile bottom nav
- **`src/components/common/AppSidebar.vue`** — Full v3 redesign:
  - Permanent Deep Slate (`#2C3E50`) background — always dark, no light/dark toggle needed
  - Brand logo in 42px squircle with `bg-white/[0.08]` tint
  - Wordmark: "beanies" white + ".family" Heritage Orange, italic tagline at 0.5rem/25% opacity
  - Emoji nav icons replacing BeanieIcon SVGs for warmth (per CIG v2)
  - Active nav item: Heritage Orange gradient (`from-[rgba(241,93,34,0.2)]`) + 4px left border
  - Hover: subtle `bg-white/[0.05]` with text brightening from 40% to 70%
  - Primary/secondary nav separated by `h-px bg-white/[0.08]` divider
  - User profile card at bottom: BeanieAvatar + owner name/role in `bg-white/[0.04]` rounded card
  - Security indicators at 30% opacity ("felt not seen"): file icon + name, lock/unlock, version
  - Removed: `SyncStatusIndicator` component, `BeanieIcon` import, `hoveredPath` ref, hover event listeners, all dark mode conditional classes

### Header Redesign (Issue #67) — Closed

- Removed bottom border, background color, and theme toggle from header
- Page title moved into header left side (Dashboard shows greeting, other pages show `route.meta.title`)
- Removed `PageHeader` component from 7 pages (Accounts, Transactions, Assets, Goals, Reports, Forecast, Settings)
- All controls restyled as squircle containers (`h-10 w-10 rounded-[14px]`) with subtle hover backgrounds
- Currency selector: symbol only (e.g. `$`), language selector: flag only
- Privacy toggle: green status dot (`bg-[#27AE60]`) when figures visible
- Notification bell: BeanieIcon with Heritage Orange dot (static for now)
- Profile: avatar + chevron only, name/email shown in dropdown panel
- `bell` icon added to `UTILITY_ICONS` in `icons.ts`

### Configurable Currency Chips (Issue #36) — Closed

- `preferredCurrencies` added to Settings model and IndexedDB repository
- Settings page: multi-select for up to 4 preferred currencies with removable chips
- Header: inline currency chips in white-bg pill — active chip in Heritage Orange, click to switch instantly
- All currency dropdowns show preferred currencies first via shared `useCurrencyOptions()` composable
- Fallback to baseCurrency if active display currency is removed from preferred list

### Branded Language Picker Flags (Issue #38) — Closed

- SVG flag images (`/brand/flags/us.svg`, `/brand/flags/cn.svg`) for cross-platform rendering (emoji flags don't render on Windows)
- Language picker uses `<img>` tags with SVG flags in white-bg pill + chevron
- Dropdown rows show flag in squircle container + native name with Heritage Orange active highlight
- `flagIcon` field added to `LanguageInfo` interface

### Design System Foundation (Issue #57) — Closed

- All dashboard components created: NetWorthHeroCard, SummaryStatCard, GoalProgressItem, ActivityItem, FamilyBeanRow, RecurringSummaryWidget
- UI components: ToggleSwitch, ToastNotification, BeanieAvatar
- CSS custom properties (--card-shadow, --sq, --silk10, etc.) added to style.css
- v3 Nook UI styling: 24px rounded corners, soft shadows, gradient cards, Heritage Orange accents

### Dashboard Redesign (Issue #58) — Closed

- Greeting header with time-of-day message + date subtitle
- Net Worth Hero Card with sparkline chart, time period selector, and change indicators
- 3 Summary stat cards (Income / Expenses / Cash Flow) in grid layout
- Family Beans row with beanie avatars, role labels, and Add Bean button
- 2-column grid: Savings Goals with progress bars + Recurring Summary widget
- All cards use v3 rounded-3xl styling with hover lift

### i18n Full String Extraction

- Audited all 15+ Vue files, extracted ~200 hardcoded English strings to `uiStrings.ts`
- All UI text now uses `t('key')` translation calls — enables Chinese translation and beanie mode for all strings
- Files updated: DashboardPage, AppHeader, AppSidebar, SettingsPage, TransactionsPage, ReportsPage, FamilyPage, SetupPage, LoginPage, MagicLinkCallbackPage, PasswordModal, FamilyBeanRow, RecurringSummaryWidget, NetWorthHeroCard
- Project documentation updated: all new UI text must use the translation system, never hardcoded

### Net Worth Chart Axis Labels

- Y-axis compact labels with currency symbol (e.g. `$125k`, `$1.2M`)
- X-axis date labels with Outfit font, last label shows "Today"
- Horizontal grid lines at 4% white opacity
- Chart height increased from h-20 to h-28

### Plans Archive

- `docs/plans/` directory created with naming convention and workflow documentation
- Accepted implementation plans saved before work begins for historical reference
- Rule added to CLAUDE.md project documentation

### Performance Reference Document

- `docs/PERFORMANCE.md` created covering client-side resource boundaries, growth projections, and 8 prioritized mitigation strategies
- Published to GitHub wiki

### Family Member Role Display Fix

- `FamilyBeanRow.vue` `getRoleLabel` now checks `member.ageGroup` (adult/child) instead of only `member.role`
- Adults with 'member' role correctly show "Parent"/"Big Bean" instead of "Little Bean"

### Functional Net Worth Chart (Issue #66) — Closed

- **`src/composables/useNetWorthHistory.ts`** — Computes historical net worth by replaying transactions backwards from current account balances. Supports 5 time periods (1W daily, 1M daily, 3M every 3 days, 1Y biweekly, All auto-scaled ~30 points). Returns period-over-period change amount and percentage. Computes last-month vs this-month deltas for income, expenses, and cash flow. Respects global member filter
- **`NetWorthHeroCard.vue`** — Static SVG sparkline replaced with Chart.js `<Line>` area chart via vue-chartjs. Heritage Orange line (`#F15D22`) with gradient fill (30% → transparent). Subtle grid lines at 4% white opacity. Glowing dot marks current value. Period pills now functional — clicking changes chart range and recomputes comparison. Dynamic period label ("this week"/"this month"/"past 3 months"/"this year"/"all time"). Privacy mode shows "Chart hidden" placeholder. Empty state shows "No data yet". Custom tooltip with brand styling
- **`DashboardPage.vue`** — Wired up composable: `changeAmount`/`changePercent`/`selectedPeriod`/`historyData` to hero card, `incomeChange`/`expenseChange`/`cashFlowChange` to summary stat cards for "vs last month" comparison
- Assets treated as constant in history (no historical valuation data in MVP)

### PNG Brand Character Avatars (Issue #65) — Closed

- Replaced inline SVG avatar rendering with hand-crafted PNG brand assets from `public/brand/`
- **`BeanieAvatar.vue`** — Rewritten from `<svg>` to `<div>` + `<img>`. Each avatar shows colored ring border (2px solid in member's color) + soft pastel background (member color at ~12% opacity). `family-filtered` variant shows small funnel badge overlay (SVG icon in dark circle)
- **`avatars.ts`** — Removed `BeanieAvatarDef` interface, `BEANIE_AVATARS` SVG paths, `getAvatarDef()`. Replaced with `AVATAR_IMAGE_PATHS` mapping variants to PNG paths, `getAvatarImagePath()`. `AvatarVariant` type preserved
- PNG asset mapping: `adult-male` → father, `adult-female` → mother, `child-male` → baby boy, `child-female` → baby girl, `adult-other`/`child-other` → neutral, `family-group` → family, `family-filtered` → neutral + funnel badge
- Unit tests rewritten (8 tests — PNG path assertions replace SVG path assertions)
- E2E tests updated to check for `<img>` elements with `/brand/beanies_*.png` sources

### Branded Confirmation Modal (Issue #56) — Closed

- `useConfirm` composable (singleton pattern matching `useCelebration`): `confirm()` and `alert()` return `Promise<boolean>`
- `ConfirmModal.vue` component wrapping `BaseModal` + `BaseButton` + `BeanieIcon` with danger (red) and info (orange) variants
- All 9 native `confirm()`/`alert()` calls replaced across 6 files (Accounts, Transactions, Assets, Goals, Family, PasskeySettings)
- 14 new i18n keys for dialog titles and messages with beanie mode overrides
- Wired into `App.vue` alongside `CelebrationOverlay`

### Dashboard Count-Up Animation Restore

- Re-integrated `useCountUp` composable into `SummaryStatCard` for animated number transitions
- Animation triggers on page load, view switching (component remount), and privacy mode reveal (target returns 0 when masked)
- Respects `prefers-reduced-motion` accessibility setting

### Blurred Masked Chart

- Dashboard net worth chart shows blurred view (`blur-md`) instead of "chart hidden" placeholder when privacy masking is on
- Matches Reports page pattern; `pointer-events-none` prevents tooltip data leaks
- Smooth CSS transition (`transition-all duration-300`) between blurred and clear states

### Mobile Responsive Layout (Issue #63)

- **`src/composables/useBreakpoint.ts`** — Reactive `isMobile` / `isTablet` / `isDesktop` refs using `matchMedia` with singleton listeners, SSR-safe defaults
- **`src/components/common/MobileBottomNav.vue`** — Fixed bottom tab bar (5 tabs: Nook, Planner, Piggy Bank, Budget, Pod) with safe area insets, Heritage Orange 8% background pill active state, nested route matching, dark mode support
- **`src/components/common/MobileHamburgerMenu.vue`** — Full-screen slide-in overlay from left with Deep Slate background, brand logo, controls section (member filter, privacy toggle, language selector, currency chips), all 9 nav items, user profile card, security indicators footer. Closes on backdrop click, Escape key, and route change
- **`src/components/common/AppHeader.vue`** — Mobile: hamburger button + greeting/page title + notification bell. Desktop: unchanged (all controls preserved)
- **`src/App.vue`** — Sidebar hidden on mobile (`v-if="isDesktop"`), bottom nav shown on mobile, hamburger menu wired up, reduced mobile padding (`p-4 md:p-6`), bottom padding clearance (`pb-24`)
- **`src/components/ui/BaseModal.vue`** — `fullscreenMobile` prop: removes rounded corners and max-width on mobile viewports
- **`src/constants/navigation.ts`** — `MobileTabDef` interface and `MOBILE_TAB_ITEMS` constant (5 tabs: Nook, Planner, Piggy Bank, Budget, Pod)
- **`src/services/translation/uiStrings.ts`** — 7 new i18n keys: `mobile.nook`, `mobile.pod`, `mobile.menu`, `mobile.closeMenu`, `mobile.navigation`, `mobile.controls`, `mobile.viewingAll`
- **Responsive page pass** — Fixed hardcoded grid/width classes across 5 pages:
  - TransactionsPage: `grid-cols-2` → `grid-cols-1 md:grid-cols-2` (2 form modals)
  - GoalsPage: `grid-cols-2` → `grid-cols-1 md:grid-cols-2` (2 form modals)
  - AssetsPage: `grid-cols-2` → `grid-cols-1 md:grid-cols-2` (card value display)
  - ReportsPage: `w-64`/`w-48`/`w-40` → `w-full md:w-*` (4 fixed-width selects)
  - FamilyPage: `grid-cols-2`/`grid-cols-3` → responsive variants (4 form grids)

### PWA Functionality (Issue #6) — Closed

- **`index.html`** — Added PWA meta tags: `theme-color` (with dark mode media variant), `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `apple-mobile-web-app-title`, `description`
- **`vite.config.ts`** — Completed manifest (`start_url`, `scope`, `orientation`, `categories`); changed `registerType` from `autoUpdate` to `prompt` for user-controlled SW updates
- **`src/composables/useOnline.ts`** — Singleton reactive `isOnline` ref with `online`/`offline` event listeners
- **`src/composables/usePWA.ts`** — `canInstall`, `isInstalled`, `installApp()`, `dismissInstallPrompt()` with 7-day localStorage dismissal persistence; `beforeinstallprompt` handling, standalone mode detection
- **`src/components/common/OfflineBanner.vue`** — Heritage Orange slide-down banner when offline ("You're offline — changes are saved locally"), `aria-live="polite"`
- **`src/components/common/InstallPrompt.vue`** — Dismissible install card shown 30s after page load with brand icon, install/dismiss buttons, bottom-positioned on mobile, bottom-right on desktop
- **`src/components/common/UpdatePrompt.vue`** — Deep Slate banner using `useRegisterSW` from `virtual:pwa-register/vue` with "Update now" / "Later" buttons, hourly background update checks
- **Settings page** — "Install App" card section visible when installable or already installed (green checkmark)
- **`MobileHamburgerMenu.vue`** — Added loading spinner to mobile language selector (was missing visual feedback during translation)
- 12 new i18n keys with beanie mode overrides (`pwa.*`, `settings.installApp*`)
- 4 new test files (19 tests): useOnline, usePWA, OfflineBanner, MobileBottomNav
- **E2E fix** — TrustDeviceModal dismissed in auth helper to prevent pointer event interception in CI

### Automated Translation Pipeline

- Fixed broken `scripts/updateTranslations.mjs` parser (was matching `UI_STRINGS`, now parses `STRING_DEFS` line-by-line)
- Added `--all` flag for multi-language translation (default behavior), stale key cleanup, CI-friendly summary output
- Populated `public/translations/zh.json` with all 655 translations (was 287)
- Created `.github/workflows/translation-sync.yml` — daily cron at 3 AM UTC with conditional auto-deploy
- Updated `package.json` translate scripts, `scripts/README.md`, ADR-008, new `docs/TRANSLATION.md`
- Added Playwright browser caching to CI workflow (saves ~8 min per E2E run)

### Mobile Privacy Toggle

- Show/hide financial figures icon now always visible in mobile/tablet header (previously buried in hamburger menu)
- Sits next to notification bell with same squircle styling, beanie blink animation, and green status dot

### Count-Up Animation for All Summary Cards

- **`src/composables/useAnimatedCurrency.ts`** — Reusable composable wrapping `useCountUp` + `convertToDisplay` + `formatCurrencyWithCode` + privacy mode masking. Returns `{ formatted, displayValue }`. When privacy mode is on, target drops to 0 so revealing figures triggers a fresh count-up from zero
- **NetWorthHeroCard** — Hero net worth amount (800ms duration) and change amount (200ms delay) now animate on load and when values change
- **AccountsPage** — 3 summary cards (Total Assets, Total Liabilities, Net Worth) with staggered delays (0/100/200ms)
- **TransactionsPage** — 6 summary cards: 3 transaction tab (Period Income, Expenses, Net) + 3 recurring tab (Monthly Income, Expenses, Net) with staggered delays
- **AssetsPage** — 4 summary cards (Total Asset Value, Total Loans, Net Asset Value, Appreciation/Depreciation) with staggered delays (0/100/200/300ms)
- **GoalsPage** — 3 integer count cards (Active, Completed, Overdue goals) using `useCountUp` directly with staggered delays
- All animations respect `prefers-reduced-motion` accessibility setting

### Trusted Device Mode (Issue #74) — Closed

- `isTrustedDevice` and `trustedDevicePromptShown` flags in GlobalSettings (registry DB)
- `signOut()` conditionally preserves IndexedDB cache when trusted device is enabled
- `signOutAndClearData()` action always deletes cache regardless of trust setting
- One-time `TrustDeviceModal` shown after first successful sign-in + data load
- Settings toggle in Security section to enable/disable trusted device
- Hamburger menu shows dual sign-out options when trusted device is on
- 8 new i18n keys for trust prompt, settings toggle, and sign-out options

### Login Page UI Redesign (Issue #69) — Closed

- **5-view login flow** per v6 wireframes replacing the old 4-view monolithic flow:
  - **Welcome Gate (00a)** — Three large branded path cards: "Sign in to your pod", "Create a new pod!" (Heritage Orange gradient), "Join an existing pod"
  - **Load Pod (00b)** — File picker drop zone, disabled cloud connector placeholders (Google Drive, Dropbox, iCloud), security messaging cards, integrated decrypt modal (BaseModal with password input, auto-decrypt via sessionStorage cached password)
  - **Pick Bean (00b-3)** — Avatar grid with `BeanieAvatar` at 88px, green/orange status indicators, password form for sign-in or create-password for new members, back button returns to avatar grid when member selected
  - **Create Pod (00c)** — 3-step mini-onboarding wizard: Step 1 name/password → Step 2 choose storage (local file via `showSaveFilePicker`) → Step 3 add family members. Navigates directly to `/dashboard`
  - **Join Pod (00d)** — Family code input with dark slate "What happens next?" info card. Shows informative error (server-side registry not yet implemented)
- **`/welcome` dedicated route** — Unauthenticated users always land on Welcome Gate first; auto-load to Load Pod only triggers after clicking "Sign in to your pod"
- **`LoginBackground.vue`** — Warm gradient (`from-[#F8F9FA] via-[#FEF0E8] to-[#EBF5FD]`), wider `max-w-[580px]`
- **`LoginSecurityFooter.vue`** — Compact inline footer with 4 security badges at `opacity-30`
- **`LoginPage.vue`** — 5-view orchestrator with store initialization on mount, auto-load deferred to navigation
- **Legacy setup wizard removed** — `SetupPage.vue` deleted, `/setup` route removed, create pod wizard handles full onboarding
- **Deleted**: `SignInView.vue`, `TrustBadges.vue`, `SetupPage.vue`
- **~50 new i18n keys** in `uiStrings.ts` under `loginV6.*` namespace

### Encryption Pipeline Security Hardening (Issue #84) — Closed

- **Critical security fix**: 7 bugs in the sync pipeline could cause encrypted `.beanpod` files to be silently written in plaintext
- **`syncService.ts`**: Added `setEncryptionRequiredCallback()` — `triggerDebouncedSave()`, `flushPendingSave()`, and `save()` now refuse to write when encryption is required but no password is available (defense-in-depth)
- **`syncStore.ts`**: Removed hardcoded `encryptionEnabled: false` from `loadFromFile()`, `loadFromNewFile()`, and `disconnect()` — encryption setting now persists correctly across file operations
- **`syncStore.ts`**: `requestPermission()` no longer arms auto-sync before password is available; `decryptPendingFile()` sets password and encryption flag before reloading stores, then arms auto-sync
- **`MobileHamburgerMenu.vue`**: Fixed sign-out order — `signOut()` now flushes pending saves before `resetAllStores()` clears the session password (matching AppHeader pattern)
- **`fileSync.ts`**: `exportToFile()` now respects encryption settings; `importSyncFileData()` preserves local `encryptionEnabled` value instead of importing from file

### Family Member Role Display Fix

- `FamilyBeanRow.vue` `getRoleLabel` now checks `member.ageGroup` (adult/child) instead of only `member.role`
- Adults with 'member' role correctly show "Parent"/"Big Bean" instead of "Little Bean"

### Cross-Device Passkey Authentication Fix (Issue #108) — Superseded

- **Implemented but superseded** by the Automerge + Family Key migration (#119)
- Level 1 (cross-device UX) and Level 2 (PRF-wrapped password in .beanpod) were fully implemented
- The family key model eliminates the cross-device problem entirely — passkeys wrap the family key directly, which is always available in the file envelope
- All #108 code (PasskeySecret type, passkeyCrypto wrapPassword/unwrapPassword, cross-device flow in BiometricLoginView/LoginPage, passkeySecrets in sync layer) will be replaced or removed during the migration (#114, #115, #116)

### Biometric Login After Family Switching (Issue #16 follow-up)

- **LoadPodView.vue** — Added biometric detection before password modal: checks `isPlatformAuthenticatorAvailable()` + `hasRegisteredPasskeys()` when encrypted file is loaded, emits `biometric-available` event to switch to BiometricLoginView
- **LoginPage.vue** — Handles `biometric-available` event from LoadPodView, `biometricDeclined` flag prevents loops when user clicks "Use password instead", resets on family switch/navigation
- **authStore.ts** — Fixed `signInWithPasskey()` using stale `familyContextStore.activeFamilyId` instead of the authoritative `familyId` parameter during family switching
- **passwordCache.test.ts** — Added missing `setSessionDEK` and `flushPendingSave` to syncService mock (pre-existing CI failure)

### Cross-Device Sync (Issue #103) — Closed

- **`syncStore.ts` — `reloadIfFileChanged()`**: Lightweight `getFileTimestamp()` check, full reload only when file is newer. Handles encrypted files via session password → session DEK → cached password fallback chain
- **`syncStore.ts` — `startFilePolling()` / `stopFilePolling()`**: 10-second interval polling for external file changes, auto-started by `setupAutoSync()`, stopped on sign-out/disconnect
- **`App.vue` — visibility change handling**: `reloadIfFileChanged()` on tab/app resume; `syncStore.syncNow(true)` force save on `hidden` to prevent data loss on quick reload
- **Data loss fix**: `flushPendingSave()` + `syncNow(true)` on `visibilityState: hidden` ensures debounced saves are flushed before page reload
- Cloud relay for near-instant sync planned as follow-up (#118, supersedes #104)

### Family Nook Landing Page Fix

- All 5 login components (PickBeanView, BiometricLoginView, JoinPodView, CreatePodView, LoadPodView) now redirect to `/nook` instead of `/dashboard` after sign-in
- NotFoundPage "Go Home" button navigates to `/nook`
- E2E tests updated to expect `/nook` after authentication

### Biometric Login Fallback Fix (LoadPodView)

- Fixed bug where "use password instead" after biometric prompt showed old family members instead of decrypt modal
- Root cause: `autoLoadFile()` called `syncStore.loadFromFile()` reading from old configured file handle instead of pending encrypted file
- Fix: check `syncStore.hasPendingEncryptedFile` before re-reading

### Deploy Workflow CI Gating

- Updated `.github/workflows/deploy.yml` to poll for CI/security check completion (15s interval, 10min timeout) instead of failing immediately
- Fails immediately if no CI run exists for the latest commit (prevents bypassing CI)

### NookGreeting UI Cleanup

- Removed duplicate notification bell and privacy mask icons from `NookGreeting.vue` (already present in header)

### Codebase Deduplication & Cleanup (PR #107) — Closed

Comprehensive review of 243 source files (~49,700 lines) identified and consolidated ~2,000+ lines of duplicated or redundant code across 6 phases (84 files changed, net reduction of 544 lines):

- **Shared utilities:** Extracted `currency.ts` (currency conversion, 6 consumers), `useMemberInfo.ts` (member lookup, 5 pages), `toDateInputValue()` (date formatting, 4 files)
- **Generic repository factory:** `createRepository.ts` eliminates identical CRUD boilerplate across 8 IndexedDB repositories (~474 lines)
- **Toast notification system:** `useToast.ts` + `ToastContainer.vue` — module-level singleton for user-visible error/success/warning/info notifications. Error toasts are sticky. Replaces silent `console.error` calls
- **Store action helper:** `wrapAsync()` in `useStoreActions.ts` replaces 23 identical try/catch/finally blocks across 8 stores (~484 lines). CRUD failures automatically show sticky error toasts
- **Member filter factory:** `useMemberFiltered.ts` consolidates 20+ filtered getter patterns across 5 stores
- **Component consolidation:** Unified `MemberChipFilter.vue` (replaced 2 near-identical components), `useFormModal.ts` composable (5 modals), `ActionButtons.vue` (4 pages)
- **CSS cleanup:** 172 hardcoded hex colors replaced with Tailwind semantic tokens, `nook-section-label` utility applied to 8 inline duplicates, shared `nook-card-dark` class for 4 nook widgets
- **Dead code removal:** 6 unused date utility functions removed
- 10 new shared modules created. 462/462 unit tests passed, 54/57 E2E tests passed (1 pre-existing flaky)
- Full plan: `docs/plans/2026-03-01-codebase-dedup-cleanup.md`

### Node.js 24 Upgrade

- Upgraded all CI/CD workflows and `.nvmrc` from Node 20 to Node 24
- Eliminated recurring TypeScript strictness mismatches between local dev (Node 24) and CI (Node 20)
- Removed Node version matrix from `main-ci.yml` (was `[20.x, 24.x]`, now single `24`)
- Fixed `createRepository.ts` TS2352 error exposed by Node 24's stricter TypeScript

### Text Casing Standardization

- Standardized all non-sentence UI text to lowercase across `uiStrings.ts` (~150 strings)
- Fixed AppHeader page title system: reads `route.meta.titleKey` → `t(titleKey)` instead of empty `route.meta.title`
- Dashboard and Nook pages show greeting instead of page title in AppHeader
- Removed duplicate `<h1>` page titles from AccountsPage, TransactionsPage, FamilyPlannerPage, FamilyTodoPage
- Updated E2E planner tests to use case-insensitive matchers
- Documented casing standard in `.claude/skills/beanies-theme.md` and `CLAUDE.md`
- Regenerated Chinese translations for all changed strings

### Budget Page (Issue #68) — Closed

- **Data model** — `Budget`, `BudgetCategory`, `BudgetMode` types in `models.ts`. `CreateBudgetInput`/`UpdateBudgetInput` aliases. `'budget'` added to `EntityType` union. `budgets` added to `SyncFileData.data`
- **Database** — DB_VERSION 5→6. `budgets` object store with `by-memberId` and `by-isActive` indexes. Export/import/clear support
- **`src/services/indexeddb/repositories/budgetRepository.ts`** (new) — Standard `createRepository` pattern + `getActiveBudget()` helper
- **`src/stores/budgetStore.ts`** (new) — Core budget state + cross-store computed getters: `activeBudget`, `effectiveBudgetAmount` (resolves percentage mode), `categoryBudgetStatus` (per-category spend tracking with ok/warning/over), `budgetProgress`, `paceStatus` (great/onTrack/caution/overBudget), `upcomingTransactions` (next 5 recurring), `monthlySavings`, `savingsRate`, recurring/one-time breakdowns
- **`src/components/budget/BudgetSettingsModal.vue`** (new) — BeanieFormModal with mode toggle (% of income / fixed), percentage input with live effective budget preview, fixed amount input, currency selector, FamilyChipPicker for owner, collapsible category allocations with per-category AmountInput
- **`src/components/budget/QuickAddTransactionModal.vue`** (new) — Simplified transaction entry: direction toggle (Money In/Out), hero AmountInput, CategoryChipPicker, description, date, account select
- **`src/pages/BudgetPage.vue`** (new) — Full budget tracking page:
  - Hero card: Deep Slate gradient, Heritage Orange progress bar with time-position marker, motivational message + emoji based on pace
  - 3-column summary cards: Monthly Income, Current Spending, Monthly Savings (with recurring/one-time breakdowns, count-up animation)
  - Two-column content: Upcoming Transactions (next 5 scheduled) + Spending by Category (progress bars, color-coded status)
  - Bottom section: Budget Settings card + Add Transactions card (Quick Add functional, Batch Add + CSV Upload with "beanies in development" badge)
  - Empty state with EmptyStateIllustration when no budget exists
  - Privacy mode, dark mode, and mobile responsive support
- **Router + navigation** — `/budgets` route changed from DashboardPage to BudgetPage. `comingSoon` removed from budgets nav item
- **Sync infrastructure** — Budgets added to mergeService, fileSync validation + change detection, syncStore auto-sync watch + reload, App.vue data loading
- **EmptyStateIllustration** — Added `'budget'` variant with beanie + bar chart SVG
- ~70 new translation strings under `budget.*` namespace with beanie mode overrides
- Plan saved: `docs/plans/2026-03-01-budget-page.md`
- **Bug fixes (post-launch):**
  - Fixed zero spending bug: `isDateBetween()` normalized to date-only string comparison to eliminate timezone-dependent filtering failures
  - Fixed member filter not applied to budget summary cards (income, spending, savings, category breakdowns now use filtered variants)
  - Fixed multi-currency category aggregation (raw amounts now converted via `convertToBaseCurrency()` before summing)
  - Fixed emoji unicode escapes rendering as literal text on Add Transactions card
  - Redesigned Budget Settings card to match v7 UI mockup (side-by-side mode cards, Heritage Orange info callout)

### Projected Recurring Transactions (2026-03-03)

- **Projected transactions** — Future recurring transactions now appear as projections in the transactions list for any future month, giving users visibility into upcoming expenses/income
- **Deferred side effects** — Clicking a projected transaction offers scope selection (this only / this and future / all). Side effects (materializing a transaction or splitting a recurring item) are deferred until the user saves, preventing orphaned records on cancel
- **RecurringEditScopeModal** — Shared global modal for scope selection, registered in `App.vue`
- **`useProjectedTransactions` composable** — Generates ephemeral projected `DisplayTransaction` entries from active recurring items for the selected month
- **startDate → dayOfMonth sync** — Changing a recurring item's start date now auto-syncs the `dayOfMonth` field (clamped to 28) so that `syncLinkedTransactions` picks up the new day. Also syncs `monthOfYear` for yearly items
- **dayOfMonth field repositioned** — Moved between start date and end date in the recurring editor for better discoverability
- **Store immutability fixes** — Replaced all 19 in-place array mutations (`.push()`, `array[index]=`) with immutable patterns (spread, `.map()`) across 9 stores (accounts, family, goals, assets, todo, activity, budget, familyContext, tombstone). Prevents Vue 3.4+ computed reference-equality optimization from skipping re-evaluation
- **Today button on MonthNavigator** — Heritage Orange pill button appears next to month arrows when viewing a non-current month; clicking it jumps back to the current month
- 5 new TDD tests for startDate→dayOfMonth sync, all 659 tests passing

### Income-to-Goal Linking

- **Income transactions can be linked to financial goals** with automatic progress tracking — percentage or fixed-amount allocation with guardrail (auto-cap to remaining amount)
- `goalId`, `goalAllocMode`, `goalAllocValue`, `goalAllocApplied` fields added to `Transaction`; `goalId`, `goalAllocMode`, `goalAllocValue` added to `RecurringItem`
- `EntityLinkDropdown.vue` — generic dropdown extracted from `ActivityLinkDropdown.vue` (same mechanism, prop-driven data source); `ActivityLinkDropdown` simplified to thin wrapper
- Goal link section in `TransactionModal` — visible for income transactions only, with goal dropdown (currency-filtered), percentage/fixed toggle, allocation preview with capped indicator
- Store-level goal progress: `applyGoalAllocation()` and `adjustGoalProgress()` in `transactionsStore.ts` — mirrors `adjustAccountBalance` pattern; integrated into create/update/delete flows
- Recurring processor goal allocation — computes and applies allocation at transaction generation time (repo-level, outside Vue reactivity)
- Goals store reload after `processRecurringItems()` in `TransactionsPage.vue` (2 sites) and `App.vue` (4 sites) to fix stale reactive state
- 7 `goalLink.*` translation keys with beanie overrides
- Plan: `docs/plans/2026-03-05-income-to-goal-linking.md`

### CurrencyAmountInput Reusable Component

- **`CurrencyAmountInput.vue`** — extracted inline currency dropdown + `AmountInput` pattern used in 4 modals (Transaction, Account, Goal, Activity) into single reusable component with `v-model:amount` and `v-model:currency` two-way bindings
- Added currency dropdown to `ActivityModal` (was previously locked to base currency with no UI selector); changed default from `baseCurrency` to `displayCurrency`
- Restyled `GoalModal` currency dropdown to match Transaction/Account inline pattern (replaced separate `BaseSelect`)
- Net -64 lines across all modals

### Nook Card Click-to-Edit Modals

- **ScheduleCards** — merged planner activities (from `activityStore.upcomingActivities`) into Today and This Week cards alongside todos; unified `ScheduleItem` type with click-to-edit via emits
- **RecentActivityCard** — added click handlers emitting `open-todo` / `open-transaction` for inline editing
- **FamilyNookPage** — wired `TodoViewEditModal`, `ActivityModal`, and `TransactionModal` with save/delete handlers (edit-only, no create); all card items open modals directly on the Nook page without navigation
- **NookTodoWidget reactivity fix** — changed `selectedTodo: ref<TodoItem | null>` to `selectedTodoId: ref<string | null>` + computed lookup from `todoStore.todos` (same pattern as FamilyTodoPage)

### Recurring Activity/Transaction Scope UX (2026-03-09)

- **Scope modal moved to save time** — "This only / This & all future / All occurrences" modal now appears after the user clicks Save (not before opening the edit modal). Applies to both recurring activities and projected transactions. Users can see what they're changing before deciding scope.
- **Occurrence date banner** — Edit modals for recurring activities and projected transactions show the specific occurrence date being edited (e.g. "Editing occurrence on Mon, Mar 16, 2026").
- **Inline edit scope handling** — `ActivityViewEditModal` uses `scopeResolved` flag so scope is only asked once per editing session. After "this only" materialization, the override has `recurrence: 'none'` so scope check is naturally skipped.
- **`useActivityScopeEdit` composable** — Shared between `FamilyPlannerPage` and `FamilyNookPage` to eliminate duplicated scope logic (DRY).
- **Automerge proxy fix** — `splitActivity` and `materializeOverride` now use `JSON.parse(JSON.stringify())` to deep-clone proxy objects, fixing `'get' on proxy: Symbol(_am_meta)'` errors.
- **`materializeOverride` spread order fix** — `recurrence: 'none'` is now applied after `...overrides` spread to prevent form data from overwriting it.
- Plan: `docs/plans/2026-03-09-per-instance-activity-overrides.md`

### Google Drive Resilience Fixes (2026-03-09)

- **5xx retry with exponential backoff** — `GoogleDriveProvider` now retries on 503/5xx errors up to 3 times with exponential backoff (1s, 2s, 4s). After exhausting retries on write, queues to offline flush instead of throwing unhandled.
- **Init file polling suppression** — `deferPolling()` / `startDeferredPolling()` prevents `setupAutoSync` from starting file polling until after `processRecurringItems` completes, breaking the init mutation → file poll → reload → more mutations cascade.
- **30-second init timeout** — If `loadFamilyData` takes longer than 30s (due to Drive API issues), the spinner is dismissed so the app is usable. Data continues loading in the background.

### Multi-Owner Activities & Todos (2026-03-11)

- **Multi-assignee support** — Activities and todos now support multiple owners via new `assigneeIds: UUID[]` field alongside legacy `assigneeId` (backward compatible). Activities require 1+ owners, todos allow 0+
- **Normalizer pattern** — `normalizeAssignees()` and `toAssigneePayload()` in `src/utils/assignees.ts` are the single source of truth for all assignee reads/writes. All consumers call the normalizer, never read `assigneeId` directly
- **`MemberChip.vue` extraction** — Reusable presentational component (`sm`/`md` size variants) replacing 5+ duplicated inline member-chip patterns across `DayAgendaSidebar`, `UpcomingActivities`, `TodoPreview`, `TodoItemCard`, `NookTodoWidget`, `ActivityViewEditModal`, `TodoViewEditModal`
- **Multi-select UX** — `FamilyChipPicker` switched to `mode="multi"` for assignees with confirm (✓) / cancel (✕) buttons in inline edit slots. Dropoff/pickup stay single-select with auto-save + cancel button
- **Data layer updates** — `useMemberFiltered` composable widened to accept `string | string[] | undefined | null` (array-aware filtering). `useCriticalItems` shows notifications for all assignees. Activity and todo repositories use `normalizeAssignees().includes()` for queries
- **All consuming components updated** — 23 files modified across stores, composables, repositories, modals, list views, pages, and quick-add flows
- **Tests** — 9 new unit tests for normalizer/payload builder, 4 new `useCriticalItems` multi-assignee tests, 3 new `activityStore` filter tests, 12 E2E planner tests updated to select assignee (required by new `canSave` validation)
- Plan: `docs/plans/2026-03-11-multi-owner-activities-todos.md`

### beanies-plan Skill (2026-03-11)

- **`.claude/skills/beanies-plan/SKILL.md`** — Standardized plan & issue creation skill for consistent plan documents and GitHub issues with full context preservation
- 5-phase workflow: Gather & Clarify → Draft Plan → Iterate Until Approved → Save Plan → Create GitHub Issue (optional)
- Captures all user prompts verbatim (initial + follow-ups + redirections) as a permanent prompt log
- Enforces plan document format, GitHub issue format with 2-way links, and project labeling conventions
- Always asks whether to create a GitHub issue or implement directly

### Recent Improvements (2026-03-11)

- **Activity start+end time display** — All activity time displays (Nook schedule cards, planner sidebar upcoming section) now show both start and end times (e.g. "10:00 - 11:30") instead of just start time
- **Activity view modal readability overhaul** — Cleaner, more compact layout:
  - Pick-up/drop-off duties promoted into grey summary box at top (with inline editing)
  - Date and times consolidated into a single row (3-col for one-off, 2-col for recurring)
  - Empty optional fields (location, cost, instructor, notes) hidden in view mode — use Edit to add
  - "Created by" reduced to subtle inline footer text
  - Edit button moved to modal footer alongside Close (was a full-width row in the body)
  - BeanieFormModal now supports `footer-start` slot for extra footer actions
- **Sign-out modal improvements:**
  - Fixed InfoHintBadge tooltip overflow on mobile (positioned from right edge with viewport max-width)
  - Both sign-out options now side by side with emojis (🚪 Sign Out / 🗑️ Clear & Sign Out) and equal-height buttons
  - Cancel moved to subtle text link below
- **Family member data loss bug fix** — `CreatePodView.handleFinish()` now checks `syncNow()` return value and retries on failure; `OnboardingWizard` skip/finish handlers explicitly save via `syncNow(true)`

### Recent Fixes

- **Join flow cross-browser decrypt fix** — When a new member joined via invite link and created a password, the `joinFamily()` flow only stored a `passwordHash` in the Automerge doc but never created a `wrappedKey` entry in the V4 envelope. This meant password-based file decryption failed on different browsers/devices (e.g. Safari PWA after joining via Chrome on iOS, where storage is completely isolated). Fix: added `wrapFamilyKeyForMember()` to syncStore that derives an AES-KW wrapping key from the password and wraps the family key, called from `JoinPodView.handleCreatePassword()` before syncing.
- **Envelope merge race condition fix** — `fetchAndMergeRemote()` in `doSave()` was doing wholesale `currentEnvelope = remoteEnvelope` replacement, which could overwrite locally-added `inviteKeys`, `wrappedKeys`, and `passkeyWrappedKeys` when a prior auto-save wrote a version without them. Fix: merge local keys into remote envelope before assignment.
- **Family key cache on join fix** — `cacheFamilyKey()` silently returned when device was not trusted, causing data loss after page refresh or PWA install following a successful join. Fix: added `force` option to `cacheFamilyKey()` and force-cache during join/decrypt flows. Also fixed `App.vue` to redirect to `/welcome` when auto-decrypt fails instead of falling through to an empty Automerge doc.
- **Google Picker API for join flow** — When `drive.file` scope can't read a file shared by another user (returns 404), the join flow now shows a Google Picker button to let the invitee select the shared `.beanpod` file from their Drive (grants `drive.file` access). Includes `drivePicker.ts` service, `google-picker.d.ts` type declarations, and picker fallback UI in `JoinPodView.vue`. Plan: `docs/plans/2026-03-05-google-picker-invite-email-sharing.md`.
- **Email sharing in invite modal** — Optional email field in the invite modal (`FamilyPage.vue`) lets the pod owner share the `.beanpod` file with a family member's Google account directly via the Drive Permissions API. Uses `shareFileWithEmail()` in `driveService.ts`.
- **Google OAuth re-consent loop fix** — Three-layer fix preventing PWA users from being forced to re-consent on every page refresh:
  1. `getValidToken()` and 401 fallbacks in `googleDriveProvider.ts` now pass `forceConsent: true` when no refresh token exists (Google only issues refresh tokens with `prompt=consent`)
  2. `App.vue` requests `navigator.storage.persist()` on startup to prevent browser eviction of IndexedDB
  3. Refresh tokens dual-written to IndexedDB + localStorage as defense-in-depth against storage eviction (iOS Safari 7-day policy, PWA storage pressure)
  - New `hasRefreshToken()` export in `googleAuth.ts` for cross-module access
  - Plan: `docs/plans/2026-03-04-fix-oauth-reconsent-loop.md`
- **Multi-family isolation hardening** — Fixed cross-family data leakage when authenticated user's familyId could not be resolved:
  - Added cached session familyId as 4th fallback in auth resolution chain (JWT → getUserAttributes → registry → cached session)
  - Authenticated users no longer fall back to `lastActiveFamilyId` (which could belong to a different user)
  - Placeholder family creation now uses auth-resolved ID instead of random UUID (`createFamilyWithId()`)
  - Sync service refuses to load sync file whose `familyId` doesn't match the active family (in `loadAndImport`, `openAndLoadFile`, `decryptAndImport`)
  - Sync service skips initialization when no active family is set (prevents legacy key fallback)
  - Sync service `reset()` clears stale file handles and session passwords on family switch
  - Sync service tracks `currentFileHandleFamilyId` — `save()` blocks writes if handle belongs to a different family
  - Added `closeDatabase()` before loading family data to ensure clean DB connection
  - 22 multi-family isolation tests (up from 19)
- **BaseModal scroll fix** — Modal body now uses `flex-1 overflow-y-auto` with `max-h-[calc(100vh-2rem)]` so tall content scrolls instead of overflowing below the viewport (discovered via asset loan form E2E tests)
- Restored ReportsPage that was wiped during bulk ESLint/Prettier formatting
- Added data-testid attributes to transaction items and account cards for E2E tests
- Fixed E2E tests to switch to transactions tab before interacting with elements
- Switched from idb library to native IndexedDB APIs

### AWS Infrastructure & Deployment (Issue #7) — Closed

- **Terraform IaC** (`infrastructure/`) — Modular Terraform configuration with S3 backend + DynamoDB locking
  - `frontend` module: S3 bucket (CloudFront OAC), CloudFront distribution (HTTPS, gzip, SPA routing), ACM cert (DNS-validated), Route53 A/AAAA records
- **CI/CD Pipeline** (`.github/workflows/deploy.yml`) — Two-job GitHub Actions workflow:
  - `test` job: lint, type-check, Vitest unit tests, Playwright E2E (chromium), production build
  - `deploy` job: S3 sync + CloudFront cache invalidation (only runs after tests pass)
  - All secrets (AWS credentials, S3 bucket, CloudFront ID) stored in GitHub Secrets
- **Live at** `https://beanies.family` (and `https://www.beanies.family`)
- All sub-issues closed: #8, #9, #10, #11, #12, #13, #14

## In Progress

- **Multi-Family with File-Based Auth** — Per-family databases, file-based authentication (Cognito removed), passkey/biometric login implemented

### Completed Goals Section (Issue #55)

- Collapsible "Completed Goals" disclosure section below active goals list (collapsed by default)
- Completed goals sorted by most recently completed, showing name, type, member, completion date, and final amounts
- Reopen button moves a goal back to the active list; delete button removes with whoosh sound
- Muted styling distinguishes completed from active goals; privacy mode blur on amounts
- Renamed "All Goals" card to "Active Goals" for clarity
- 3 new translation keys with beanie mode overrides (`goals.reopenGoal`, `goals.noCompletedGoals`, `goals.completedOn`)

### Financial Institution Dropdown (Issue #42) — Closed

- **`BaseCombobox.vue`** — Reusable searchable single-select dropdown with "Other" support, custom text input, clear button, backward compatibility for free-text values
- **`src/constants/institutions.ts`** — 22 predefined global banks (BoA, HSBC, DBS, JPMorgan Chase, etc.) with name/shortName
- **`src/constants/countries.ts`** — 249 ISO 3166-1 countries for optional country selector
- **`useInstitutionOptions`** composable merges predefined + user-saved custom institutions into sorted dropdown options
- Replaced plain text institution input on AccountsPage (add + edit modals) with institution combobox + country combobox
- Replaced plain text lender input on AssetsPage loan section (add + edit modals) with institution combobox + country combobox
- Custom institutions only persisted when form is saved (not on typing); deletable from dropdown with X button
- Deleting a custom institution clears it from all linked accounts and asset loans
- `institutionCountry` added to Account, `lenderCountry` added to AssetLoan, `customInstitutions` added to Settings
- 7 new translation keys with beanie mode overrides
- **E2E tests** (8 tests): predefined selection, search/filter, custom "Other" entry, country selection, edit pre-population, shared custom institutions across accounts and assets
- **`ComboboxHelper`** E2E helper class and **`AssetsPage`** page object created
- **BaseModal scroll fix**: tall modal content (e.g. asset loan form) now scrolls instead of overflowing below viewport

### Beanie Language Mode (Issue #35) — Closed

- Optional beanie mode toggle in Settings replacing standard UI strings with friendly bean-themed alternatives
- Single source of truth `STRING_DEFS` in `uiStrings.ts` with side-by-side `en` + `beanie` fields
- `t()` resolution: beanie override applied only when `language === 'en'` and `beanieMode === true`
- Translation pipeline always sources from plain English `UI_STRINGS` (hard requirement)
- Toggle disabled and greyed out when non-English language is active
- ~100+ beanie string overrides across all pages
- Unit tests and E2E tests (4 specs)

## Up Next

### Automerge + Family Key Migration (Epic #119)

Major data layer migration from IndexedDB + file-based sync to Automerge CRDT + family key encryption. Plan: `docs/plans/2026-03-02-automerge-family-key-migration.md`

**Phase 1 — Foundation (parallelizable):**

- [x] #110 — Automerge CRDT document service and repository factory
- [x] #111 — Family key encryption, wrapping, and invite link service (PR #121)
- [x] #112 — Google Drive OAuth PKCE migration (replaces GIS implicit grant) — PR #122, deployed to prod

**Phase 2 — Core Migration:**

- [x] #113 — Data layer switchover: IndexedDB → Automerge, sync rewrite, old code removal. Merged to `feature/automerge-migration`. Includes: all 10 stores switched to Automerge repos, sync/persistence layer rewritten for V4 beanpod, 15 deprecated files deleted, regression fixes (Automerge proxy cloning, auth session persistence, passkey lifecycle, exchange rate save). 615 tests passing.

**Phase 3 — Auth & UI:**

- [x] #114 — Auth and onboarding flows for family key model (includes #108 code cleanup). Merged to `feature/automerge-migration`. Includes: family key generation/wrapping, single-password sign-in (no separate file decrypt), passkey PRF-based key unwrapping, magic link invites with crypto tokens, trusted device file caching (passwordless shortcut removed), auto-sign-in after decrypt, inline sign-in form UX. 622 tests passing.
- [x] #115 — UI updates for family key model and invite flow. Merged to `feature/automerge-migration`. Includes: encryption toggle removed from Settings, family key status section, InviteMemberModal (magic link + QR), InviteLinkCard component, JoinPodView invite redemption, CreatePodView/LoadPodView/BiometricLoginView/PasskeySettings updated, useClipboard composable, JSON export. 622 tests passing.

**Phase 4 — Cleanup:**

- [x] #116 — Dead code removal, documentation updates, final verification. Completed on `feature/automerge-migration`. Includes: removed 6 orphaned V3 types from models.ts, deleted legacy migration module (legacyMigration.ts + related imports), removed V3 encryption wrappers, cleaned up stale comments, fixed broken E2E import, rewrote ARCHITECTURE.md for Automerge architecture, updated CLAUDE.md and SECURITY_GUIDE.md, added supersession notes to 6 existing ADRs, created ADRs 018/019/020

**Follow-up:**

- [ ] #117 — Family key rotation on member removal
- [ ] #118 — WebSocket push relay for real-time cross-device sync (supersedes #104)

**Superseded issues (closed):**

- #104 — Cloud relay → superseded by #118
- #108 — Cross-device passkey auth → superseded by family key model (#114)
- #17 — Password rotation → obsoleted by family key model
- #15 — Password recovery → superseded by invite links (#111/#114)

### Phase 1 Remaining (non-migration)

- [x] Financial institution dropdown (Issue #42) ✓
- [x] Beanie language mode (Issue #35) ✓
- [x] Functional net worth chart (Issue #66) ✓
- [x] PNG brand avatars (Issue #65) ✓
- [x] Header redesign (Issue #67) ✓
- [x] Design system foundation (Issue #57) ✓
- [x] Dashboard redesign (Issue #58) ✓
- [x] Configurable currency chips (Issue #36) ✓
- [x] Branded language picker flags (Issue #38) ✓
- [x] Replace native confirm/alert dialogs with branded modal (Issue #56) ✓
- [x] Budget page (Issue #68) ✓
- [ ] Switchable UI themes (Issue #41)
- [ ] Data validation and error handling improvements
- [x] Mobile responsive layout (Issue #63) ✓
- [ ] Responsive design polish
- [ ] Financial forecasting / projections page

## v6 UI Framework Proposal

A v6 UI framework proposal has been uploaded to `docs/brand/beanies-ui-framework-proposal-v6.html`, superseding v5 with detailed login flow screens for the new file-based authentication model. The v3 proposal was previously removed as obsolete.

v6 introduces a **six-screen authentication flow** built around the Pod concept (encrypted `.beanpod` data files):

- **00a: Welcome Gate** — Three paths: sign in, create pod, join pod
- **00b: Load Your Pod** — File picker + drag-drop zone + cloud storage connectors (Google Drive, Dropbox, iCloud)
- **00b-2: Unlock Your Pod** — Decrypt loaded file with pod password
- **00b-3: Pick Your Bean** — Family member selection with 88px avatars and onboarding status indicators
- **00c: Create a New Pod** — 3-step wizard (name/password → storage → invite)
- **00d: Join an Existing Pod** — Family code or magic link entry

Additionally, v6 includes all previous v4/v5 screens: Dashboard, Accounts (card + list), Budgets, Transactions, Onboarding, Family Hub, Mobile (4 phone mockups), Landing Page, and Settings.

| Issue | Screen                                                               | Status     |
| ----- | -------------------------------------------------------------------- | ---------- |
| #68   | Budget page — family budget tracking with category budgets           | New screen |
| #69   | Login page UI redesign — Welcome Gate + full auth flow per v6        | **Done** ✓ |
| #70   | Accounts page redesign — Assets/Liabilities hero + Cards/List toggle | Redesign   |
| #71   | Transactions page — full ledger view                                 | Redesign   |
| #72   | Landing page — public-facing hero page                               | New screen |
| #73   | Family Hub — 3-column layout with calendar and events                | Redesign   |
| #62   | Onboarding redesign — v6 welcome flow with illustrations             | Redesign   |

Existing issues updated with v5/v6 references: #60, #61, #62, #69.

## v7 UI Framework Proposal

A v7 UI framework proposal has been uploaded to `docs/brand/beanies-ui-framework-proposal-v7.html`, introducing a major structural reorganisation: the app shifts from finance-first to **family-first**, with three new pages and a collapsible accordion sidebar.

### Key Changes in v7

1. **Sidebar accordion restructure** — Flat nav replaced with two collapsible sections:
   - **The Piggy Bank 🐷** (finance): Overview, Accounts, Budgets, Transactions
   - **The Treehouse 🌳** (family): Family Nook, Family Planner, Family To-Do, Family Hub
   - Settings pinned at bottom, outside both accordions

2. **Family Nook 🏡** — New home screen after login (replaces finance dashboard as entry point). Shows today's schedule, events, milestones, activity feed, shared to-do widget, and Piggy Bank quick-access card

3. **Family Planner 📅** — Calendar and scheduling hub absorbing the old Family Hub calendar. Month/week/day/agenda views, event categorisation, family member filtering

4. **Family To-Do ✅** — Standalone task management page at `/todo`. Quick-add, assignees, date integration with calendar. Purple (#9B59B6) accent colour for to-do elements

5. **Updated mobile bottom tab bar** — 5 tabs: 🏡 Nook, 📅 Planner, 🐷 Piggy Bank, 📋 Budget, 👨‍👩‍👦 Pod

6. **Family Hub updated** — Calendar removed (→ Family Planner), now focused on personal member activity and milestones

7. **Budget page enhancements** — 3 transaction entry methods (Quick Add, Batch Add, CSV Upload), time-position marker, motivational emoji messages, category spending bars

8. **Transactions ledger** — Recurring/one-time type pills, summary pills, enhanced add modal with recurring toggle

### New Issues Created

| Issue | Title                                                           | Priority |
| ----- | --------------------------------------------------------------- | -------- | ------------------------------------------------------ |
| #97   | Family Nook 🏡: home screen with schedule, events, to-do widget | High     | ✅ Done                                                |
| #98   | Family Planner 📅: calendar and scheduling hub                  | High     | 🔧 In Progress (weekly view done, month view existing) |
| #99   | Family To-Do ✅: standalone task management page                | High     | ✅ Done                                                |
| #100  | Sidebar accordion restructure: Piggy Bank + Treehouse           | High     | ✅ Done                                                |
| #101  | Mobile bottom tab bar: 5-tab layout                             | Medium   | ✅ Done                                                |

### Existing Issues Updated

- **#73** (Family Hub redesign) — Updated for v7: calendar removed, personal activity focus
- **#68** (Budget page) — Updated with 3 entry methods, motivational messages, category bars
- **#71** (Transactions page) — Updated with recurring/one-time type pills, enhanced modal
- **#20** (Family activity tracking) — Closed, superseded by Family Nook + Family Planner

### New Brand Vocabulary (v7)

| Term               | Meaning                                         |
| ------------------ | ----------------------------------------------- |
| The Piggy Bank 🐷  | Finance section (sidebar accordion)             |
| The Treehouse 🌳   | Family section (sidebar accordion)              |
| The Family Nook 🏡 | Home screen after login (family-first overview) |
| Family Planner 📅  | Calendar and scheduling hub                     |
| Family To-Do ✅    | Shared family task management                   |

## Future Phases

### Phase 2 — Enhanced Features

- [ ] Data import/export (CSV, etc.)
- [x] PWA offline support / install prompt / SW update prompt (#6) ✓
- [x] Google Drive sync (OAuth PKCE + Lambda proxy) — #78, #112, ADR-016
- [x] Projected recurring transactions with scope-based editing (this only / this and future / all) ✓
- [ ] Skip individual recurring occurrences
- [x] Landing/marketing page (#72) ✓

### Phase 3 — AI & Advanced

- [ ] AI-powered insights (Claude/OpenAI/Gemini)
- [ ] Additional language support

## Known Issues

- **Single-family re-login shows LoadPodView instead of auto-decrypting:** When a single family exists and the user clicks "Sign In" after sign-out, `tryAutoDecrypt` fails because `cacheFamilyKey()` only stores the key on trusted devices (`isTrustedDevice === true`). On non-trusted devices, the cached family key is empty, so auto-decrypt falls through to the LoadPodView password form. Needs investigation: either always cache the family key after explicit password entry, or prompt for trusted device earlier in the flow.
- ~~**Data loss after tab idle/sleep — saves fail silently:** After waking from sleep and visiting Settings to check last-saved timestamp, all subsequent saves failed with "no family key or envelope". Data created after visiting Settings was lost on refresh.~~ **Fixed 2026-03-10** — Root cause: `SettingsPage.vue` called `syncStore.initialize()` on mount, which called `syncService.reset()` clearing the encryption key from the sync service (but not the Vue ref). Four-layer fix: (1) removed redundant init from SettingsPage, (2) `syncService.initialize()` skips destructive re-init when already active for same family, (3) `loadFromFile()` now calls `setFamilyKey()` instead of `setEnvelope()` to restore key on every file poll, (4) save-on-hide/unload handlers recover the key from the store ref before saving.
- ~~**Google Drive new account registration fails:** Two errors: (1) "authorization scope was not enough" — granular consent lets users deselect scopes, (2) "File not found" — global folder cache reuses a previous account's folder ID.~~ **Fixed 2026-03-04** — clear folder cache + force consent in `createNew()`, validate `drive.file` scope after token exchange, clear cache on auth failure.

## Decision Log

| Date       | Decision                                                    | Rationale                                                                                                                                                                                                                                                                                                                                  |
| ---------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-02-17 | Created docs/STATUS.md for project tracking                 | Multiple contributors need shared context                                                                                                                                                                                                                                                                                                  |
| 2026-02-17 | Added ARCHITECTURE.md and 8 ADR documents                   | Document key decisions for contributor onboarding                                                                                                                                                                                                                                                                                          |
| Prior      | Switched from idb library to native IndexedDB APIs          | Reduce dependencies                                                                                                                                                                                                                                                                                                                        |
| Prior      | Chose File System Access API over Google Drive for sync     | Simpler implementation, no OAuth needed, user controls file location                                                                                                                                                                                                                                                                       |
| Prior      | Used AES-GCM + PBKDF2 for encryption                        | Industry standard, no external dependencies (Web Crypto API)                                                                                                                                                                                                                                                                               |
| Prior      | Stored amounts in original currency, convert on display     | No data loss from premature conversion, flexible display                                                                                                                                                                                                                                                                                   |
| Prior      | Recurring items as templates, not transactions              | Clean separation, catch-up processing, easy to preview                                                                                                                                                                                                                                                                                     |
| Prior      | MyMemory API for translations                               | Free, CORS-enabled, no API key required                                                                                                                                                                                                                                                                                                    |
| 2026-02-17 | Per-family databases instead of familyId on all models      | No repository code changes, no schema migration, clean tenant isolation                                                                                                                                                                                                                                                                    |
| 2026-02-17 | Global settings (theme, language, rates) in registry DB     | Device-level preferences survive family switching                                                                                                                                                                                                                                                                                          |
| 2026-02-22 | File-based auth replaces Cognito (ADR-014)                  | PBKDF2 password hashes in data file; true local-first, ~165KB bundle reduction, no cloud auth infrastructure                                                                                                                                                                                                                               |
| 2026-02-18 | File-first architecture: encrypted file as source of truth  | Security value proposition, user data control, IndexedDB is ephemeral                                                                                                                                                                                                                                                                      |
| 2026-02-18 | Encryption enabled by default for new data files            | Secure by default; upgraded to mandatory (no opt-out) on 2026-02-22                                                                                                                                                                                                                                                                        |
| 2026-02-18 | Auto-sync always on (no toggle)                             | Simplifies UX, data file always stays current                                                                                                                                                                                                                                                                                              |
| 2026-02-19 | Rebranded to beanies.family (Issue #22)                     | Heritage Orange + Deep Slate palette, Outfit + Inter fonts, squircles                                                                                                                                                                                                                                                                      |
| 2026-02-20 | Centralized icon system (Issue #44)                         | Single source of truth for ~72 icons, brand-enforced stroke style                                                                                                                                                                                                                                                                          |
| 2026-02-20 | Web Audio API for sound effects (Issue #46)                 | Zero bundle size, no audio files, sub-ms latency, browser-native                                                                                                                                                                                                                                                                           |
| 2026-02-20 | Beanie UI overhaul complete (Issue #40)                     | All 13 sections done: icons, animations, sounds, empty states, 404, etc                                                                                                                                                                                                                                                                    |
| 2026-02-20 | Beanie character avatars (Issue #39)                        | Inline SVG avatars by gender/age, children wear beanie hats, replaces initial circles                                                                                                                                                                                                                                                      |
| 2026-02-20 | Collapsible completed goals section (Issue #55)             | Disclosure pattern over tabs — completed goals are secondary archive                                                                                                                                                                                                                                                                       |
| 2026-02-20 | Financial institution dropdown (Issue #42)                  | Searchable combobox with custom entry persistence, deferred save                                                                                                                                                                                                                                                                           |
| 2026-02-21 | Sidebar redesign — Deep Slate + emoji nav (Issue #59)       | Permanent dark sidebar, emoji icons, nav extracted to shared constant for mobile reuse                                                                                                                                                                                                                                                     |
| 2026-02-21 | v4 UI framework proposal uploaded                           | New screens: Budget (#68), Login UI (#69), Landing (#72). Redesigns: Accounts (#70), Transactions (#71), Family Hub (#73)                                                                                                                                                                                                                  |
| 2026-02-22 | v5 UI framework proposal uploaded, v3 removed               | v5 adds split login flow (Welcome Gate, Sign In, Create Pod, Join Pod) + updated onboarding. v3 deleted as obsolete                                                                                                                                                                                                                        |
| 2026-02-22 | v6 UI framework proposal uploaded                           | v6 adds detailed login screens (Load Pod, Unlock Pod, Pick Bean) for file-based auth. Encryption mandatory, no skip                                                                                                                                                                                                                        |
| 2026-02-22 | Encryption made mandatory for all data files                | No option to skip encryption during setup or disable it in settings. All `.beanpod` files are always AES-256 encrypted                                                                                                                                                                                                                     |
| 2026-02-21 | Header redesign — seamless icon-only controls (#67)         | Page titles in header (not in views), no border/bg, squircle icon-only controls, notification bell, avatar-only profile                                                                                                                                                                                                                    |
| 2026-02-21 | Net worth chart via transaction replay (#66)                | Option A (replay backwards from current balances) chosen over snapshot approach for MVP simplicity                                                                                                                                                                                                                                         |
| 2026-02-21 | PNG brand avatars replace inline SVGs (#65)                 | Hand-crafted PNGs are more expressive; member differentiation via colored ring + pastel background                                                                                                                                                                                                                                         |
| 2026-02-22 | Configurable currency chips in header (#36)                 | Inline chips for instant switching; max 4 preferred currencies persisted in settings                                                                                                                                                                                                                                                       |
| 2026-02-22 | SVG flag images instead of emoji flags (#38)                | Emoji flags don't render on Windows; SVGs ensure cross-platform visibility                                                                                                                                                                                                                                                                 |
| 2026-02-22 | Full i18n string extraction                                 | All ~200 hardcoded UI strings moved to uiStrings.ts; project rule: no hardcoded text in templates                                                                                                                                                                                                                                          |
| 2026-02-22 | Plans archive in docs/plans/                                | Accepted plans saved before implementation for historical reference and future context                                                                                                                                                                                                                                                     |
| 2026-02-22 | Performance reference document                              | Client-side resource boundaries, growth projections, and mitigation strategies documented                                                                                                                                                                                                                                                  |
| 2026-02-22 | Mobile responsive layout (#63)                              | Hamburger menu + 4-tab bottom nav + breakpoint composable; sidebar hidden on mobile; responsive page grids                                                                                                                                                                                                                                 |
| 2026-02-22 | AWS infrastructure via Terraform (#8-#11)                   | S3/CloudFront/ACM/Route53 for hosting, modular IaC with remote state                                                                                                                                                                                                                                                                       |
| 2026-02-22 | CI/CD pipeline with E2E gating (#11)                        | GitHub Actions: lint + type-check + unit tests + Playwright E2E must pass before deploy to production                                                                                                                                                                                                                                      |
| 2026-02-22 | Site deployed to beanies.family                             | Production build, S3 sync, CloudFront CDN, HTTPS via ACM                                                                                                                                                                                                                                                                                   |
| 2026-02-22 | Trusted device mode (#74)                                   | Persistent IndexedDB cache across sign-outs for instant returning user access; explicit "Sign out & clear data" option                                                                                                                                                                                                                     |
| 2026-02-22 | Post-sign-in redirect checks onboarding status              | New users redirected to /setup instead of /dashboard; direct DB read after sign-in for reliability                                                                                                                                                                                                                                         |
| 2026-02-22 | Login page UI redesign per v6 wireframes (#69)              | 5-view flow (welcome/load-pod/pick-bean/create/join), legacy SetupPage removed, /welcome dedicated route                                                                                                                                                                                                                                   |
| 2026-02-23 | Encryption pipeline security hardening (#84)                | 7 bugs fixed: defense-in-depth guards prevent plaintext writes when encryption is enabled                                                                                                                                                                                                                                                  |
| 2026-02-24 | PWA functionality complete (#6)                             | Offline banner, install prompt (30s delay, 7-day dismiss), SW update prompt, manifest completion, meta tags                                                                                                                                                                                                                                |
| 2026-02-24 | SW registerType changed to `prompt`                         | User-controlled updates instead of silent auto-update; hourly background check for new versions                                                                                                                                                                                                                                            |
| 2026-02-24 | Automated translation pipeline                              | Fixed broken translation script (STRING_DEFS parser), added --all multi-lang support, stale key cleanup, daily GitHub Actions workflow with auto-deploy                                                                                                                                                                                    |
| 2026-02-24 | Playwright browser caching in CI                            | Cache `~/.cache/ms-playwright` keyed on browser + version; saves ~8 min per E2E job (chromium download)                                                                                                                                                                                                                                    |
| 2026-02-24 | Mobile privacy toggle in header                             | Show/hide figures icon always visible on mobile/tablet (not buried in hamburger menu) for better UX                                                                                                                                                                                                                                        |
| 2026-02-24 | Issue #16 updated: unified passkey login + data unlock      | Single biometric gesture replaces both member password and encryption password; password fallback preserved                                                                                                                                                                                                                                |
| 2026-02-24 | Issue #16 implemented: passkey/biometric login              | PRF + cached password dual-path, BiometricLoginView, PasskeyPromptModal, PasskeySettings rewrite, registry DB v3 with passkeys store (ADR-015)                                                                                                                                                                                             |
| 2026-02-26 | Cross-device sync via file polling (#103)                   | 10s file polling + visibility-change reload + force save on hidden; near-instant relay planned as #104                                                                                                                                                                                                                                     |
| 2026-02-26 | Cloud relay plan created (#104)                             | AWS API Gateway WebSocket + Lambda + DynamoDB for near-instant cross-device notifications; plan at `docs/plans/2026-02-26-cloud-relay-sync.md`                                                                                                                                                                                             |
| 2026-02-27 | Fix cross-device passkey authentication                     | Synced passkeys (iCloud/Google/Windows) auto-register locally using cached password; no more "registered on another device" error (ADR-015 updated)                                                                                                                                                                                        |
| 2026-02-28 | Reverted Prettier reformatting of brand HTML files          | Commit 46e33c0 accidentally reformatted 6 docs/brand HTML files (60k+ lines). Reverted and added `docs/brand` to `.prettierignore`                                                                                                                                                                                                         |
| 2026-02-28 | Fixed beanie-avatars E2E test for redesigned modal          | Test referenced old test IDs from pre-modal-redesign; updated to use role chips, "More Details" toggle, placeholder input                                                                                                                                                                                                                  |
| 2026-02-28 | Merged rollup security bump (4.57.1 → 4.59.0)               | Dependabot PR #102; minor version bump with security label, no breaking changes                                                                                                                                                                                                                                                            |
| 2026-02-28 | Strengthened DRY principle in CLAUDE.md                     | Expanded code conventions with explicit rules for shared components, helper functions, constants, and duplicate elimination                                                                                                                                                                                                                |
| 2026-03-01 | Text casing standardization                                 | All non-sentence UI text lowercase in uiStrings.ts; AppHeader fixed to use titleKey; duplicate page h1s removed; casing rules documented                                                                                                                                                                                                   |
| 2026-03-01 | Mobile bottom tab bar: 5-tab layout (#101)                  | 5 tabs (Nook/Planner/Piggy Bank/Budget/Pod), Heritage Orange 8% pill active state, v7 hamburger button (3-div design), nested route matching, 3 new i18n keys                                                                                                                                                                              |
| 2026-03-03 | Projected recurring transactions with deferred side effects | Future recurring items shown as projections; scope modal defers DB writes until save; prevents orphaned records on cancel                                                                                                                                                                                                                  |
| 2026-03-03 | Immutable store updates across all 9 entity stores          | Replaced 19 in-place mutations with spread/.map() to fix Vue 3.4+ computed reference-equality reactivity issues                                                                                                                                                                                                                            |
| 2026-03-04 | Google Drive OAuth: cross-account folder fix + scope check  | Clear folder cache in createNew() to prevent stale folder ID from previous account; force fresh consent; validate drive.file scope after token exchange                                                                                                                                                                                    |
| 2026-03-04 | Branch protection: removed required status check            | Pre-push hook already runs tests locally; required CI status check was redundant for 1-person team and blocked direct pushes to main                                                                                                                                                                                                       |
| 2026-03-04 | Fix CRDT merge data loss (`decryptBeanpodPayload`)          | `decryptBeanpodPayload()` called `loadDoc()` which replaced the singleton doc before `mergeDoc()` ran, losing local changes. Fixed to use `Automerge.load()` directly                                                                                                                                                                      |
| 2026-03-04 | Plan: CRDT merge safety unit tests                          | Test plan saved at `docs/plans/2026-03-04-crdt-merge-safety-tests.md` — regression guard for the singleton side-effect bug, V4 round-trip, and merge preservation                                                                                                                                                                          |
| 2026-03-04 | CRDT merge safety unit tests implemented                    | 11 tests in `fileSync.test.ts`: singleton isolation guard, standalone doc validity, full merge simulation, V4 encrypt/decrypt round-trip, input validation, version detection (636 total tests)                                                                                                                                            |
| 2026-03-05 | Income-to-goal linking                                      | Income transactions allocate percentage or fixed amount to a goal; guardrail caps allocation at remaining goal amount; flat fields on Transaction/RecurringItem (mirrors activityId pattern)                                                                                                                                               |
| 2026-03-05 | EntityLinkDropdown generalization                           | Extracted ActivityLinkDropdown mechanism into generic EntityLinkDropdown; same UI, prop-driven data source; ActivityLinkDropdown becomes thin wrapper                                                                                                                                                                                      |
| 2026-03-05 | CurrencyAmountInput reusable component                      | Inline currency dropdown + AmountInput extracted from 4 modals into single component; net -64 lines; added currency selector to ActivityModal                                                                                                                                                                                              |
| 2026-03-05 | Nook card click-to-edit modals                              | Schedule cards merge planner activities with todos; all Nook cards (Schedule, Recent Activity, Todo Widget) open inline edit modals — no page navigation. NookTodoWidget reactivity bug fixed                                                                                                                                              |
| 2026-03-06 | View-first modals for activities and transactions           | Shared `useInlineEdit` composable + `InlineEditField` component; ActivityViewEditModal (7 inline fields), TransactionViewEditModal (4 inline fields); TodoViewEditModal refactored to use shared code; reactivity fix (store-lookup computed); toggle complete from todo view modal                                                        |
| 2026-03-06 | Activity endTime auto-sync                                  | End time defaults to startTime + 1hr; reactive sync when start time changes; endTime clamped to not precede startTime; applies to ActivityModal and ActivityViewEditModal. `addHourToTime()` utility in date.ts                                                                                                                            |
| 2026-03-08 | Family Hub v7 redesign (#73) — closed                       | Redesigned as "The Bean Pod" with activity-focused member cards, quick-info panel, role tags. Calendar removed (→ Family Planner). Deployed to prod                                                                                                                                                                                        |
| 2026-03-08 | Header redesign: profile dropdown + sign-out modal          | Notification bell removed, profile avatar dropdown on mobile (matching desktop), Deep Slate gradient header, sign-out confirmation modal with "Sign Out & Clear Data" option using InfoHintBadge                                                                                                                                           |
| 2026-03-08 | PWA update speed improvements                               | 5-min polling (down from 60min), check on tab visibility change, auto-update on next navigation after 1-min grace period                                                                                                                                                                                                                   |
| 2026-03-08 | Google OAuth race condition fix                             | `performSilentRefresh()` recovers refresh token from IndexedDB when in-memory token is lost (page reload/SW update), preventing unnecessary consent popup                                                                                                                                                                                  |
| 2026-03-08 | Currency conversion staleness fix (critical)                | App init rate refresh now reloads Vue store after completion; `exchangeRates` computed picks most recent rates between per-family (synced) and device-local by comparing timestamps                                                                                                                                                        |
| 2026-03-12 | Passkey progressive platform fallback                       | Restored `authenticatorAttachment: 'platform'` as first attempt (ensures "save on this device" prompt), with progressive fallback: retry without attachment + hints for Android OEMs (Honor/MagicOS), then retry without PRF extension. Fixes issue where removing platform constraint caused phones to only show "save on another device" |
| 2026-03-08 | Passkey Android credential manager compatibility            | Removed `authenticatorAttachment: 'platform'` (fails on Honor/MagicOS OEM credential managers), added `hints: ['client-device']` for Chrome 128+, auto-retry without PRF extension on `NotReadableError`, user-friendly error messages for credential manager failures                                                                     |
| 2026-03-17 | Weekly calendar view as default planner view                | Week view provides more at-a-glance utility than month view on desktop/tablet. Month view retained for overview. Day/agenda views removed as redundant (sidebar + weekly cover the use cases). DRY extraction of shared components before building new views                                                                               |
| 2026-03-17 | All-day multi-day activities with spanning display          | `isAllDay` + `endDate` fields on FamilyActivity; expandRecurring generates per-day occurrences; WeeklyCalendarView renders as single spanning bar using CSS grid column placement instead of per-day pills                                                                                                                                 |
| 2026-03-08 | Join/load flow loading spinners                             | Added BeanieSpinner to all async gaps: file picker, invite token decryption, password creation step. Replaced CSS border spinners with branded BeanieSpinner. Buttons use `:loading` prop for spinner display. Fixed both JoinPodView and LoadPodView                                                                                      |
| 2026-03-25 | Link field on all travel segments                           | Optional URL field added to all travel segment types (flights, cruise, train, car, accommodations, transportation). Previously only activities and ideas had links. Space-efficient layout: shares row with booking ref or contact phone                                                                                                   |
| 2026-03-25 | Transaction view schedule summary box                       | Grey summary box in transaction view modal showing recurrence pattern + start/end dates for recurring, or date for one-time. Matches the activity view convention. Replaces standalone recurrence pill                                                                                                                                     |
| 2026-03-25 | E2E test suite overhaul (ADR-007 revised)                   | 87 → 21 tests (76% reduction), 15 → 7 files, Chromium-only CI. Three-Gate Filter, 25-test budget cap, 8 conventions. CI time reduced from 10+ min to 4.5 min. Health tracking in `docs/E2E_HEALTH.md`                                                                                                                                      |
| 2026-03-25 | Project changelog introduced                                | `CHANGELOG.md` with Keep a Changelog format, backfilled 2 weeks. CLAUDE.md updated to require changelog update on every push                                                                                                                                                                                                               |
