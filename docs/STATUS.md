# Project Status

> **Last updated:** 2026-02-22
> **Updated by:** Claude (AWS deployment + infrastructure)

## Current Phase

**Phase 1 — MVP** (In Progress)

## Completed Work

### Infrastructure

- Project scaffold with Vite + Vue 3 + TypeScript
- IndexedDB service with repositories (native IndexedDB APIs)
- Pinia stores for all entities (family, accounts, transactions, assets, goals, settings, sync, recurring, translation, memberFilter)
- Vue Router with all page routes (lazy-loaded)
- Dark mode / theme support
- E2E test infrastructure (Playwright — Chromium/Firefox/WebKit)
- Unit test infrastructure (Vitest with happy-dom)
- Linting (ESLint + Prettier + Stylelint + Husky pre-commit hooks)
- File-based sync via File System Access API (with encryption support)
- Exchange rate auto-fetching from free currency API
- Recurring transaction processor (daily/monthly/yearly)
- Multilingual support (English + Chinese) via MyMemory API with IndexedDB caching
- Project documentation: `docs/ARCHITECTURE.md`, `docs/adr/` (10 ADRs)

### UI Components

- Base component library: BaseButton, BaseCard, BaseCombobox, BaseInput, BaseModal, BaseSelect
- AppHeader, AppSidebar layout components

### Pages / Features

- Dashboard with summary cards (combined one-time + recurring totals)
- Accounts management (full CRUD, card-based layout)
- Transactions management (full CRUD, with date filter, category icons)
- Assets management (full CRUD, loan tracking, combined net worth)
- Goals management (full CRUD, collapsible completed goals section)
- Reports page (net worth, income vs expenses, extended date ranges, category breakdowns)
- Family member management (global member filter)
- Settings page (currency, theme, sync, encryption)
- First-run setup wizard
- Multi-currency display with global display currency selector

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

- Per-family database architecture: each family gets its own IndexedDB (`gp-family-finance-{familyId}`)
- Registry database (`gp-finance-registry`): stores families, user mappings, cached auth sessions, global settings
- Family context orchestrator (`familyContext.ts`) and Pinia store (`familyContextStore.ts`)
- Legacy migration service: auto-migrates single-DB data to per-family DB on first boot
- Global settings split from per-family settings (theme, language, exchange rates are device-level)
- Sync file format v2.0: includes `familyId` and `familyName` (backward-compatible with v1.0)
- Per-family file handle storage for sync
- New types: `Family`, `UserFamilyMapping`, `CachedAuthSession`, `GlobalSettings`
- All existing repositories work unchanged (transparent multi-tenancy via `getDatabase()`)
- E2E test helpers updated for dynamic per-family DB discovery

### Auth Service + AWS Cognito SDK (Stage 2)

- Installed `amazon-cognito-identity-js` browser SDK
- Cognito config reader (`src/config/cognito.ts`): reads User Pool ID, Client ID, Region from env vars
- Cognito service (`src/services/auth/cognitoService.ts`): signUp, signIn, signOut, session management, custom auth (magic link prep)
- Token manager (`src/services/auth/tokenManager.ts`): caches JWT tokens in registry DB, 7-day offline grace period
- Auth is fully optional — disabled when Cognito env vars are not set

### Login Page + Route Guards + Session Management (Stage 3)

- Auth store (`src/stores/authStore.ts`): initializeAuth, signIn, signUp, signOut, continueWithoutAuth
- Login page (`src/pages/LoginPage.vue`): Sign In / Create Account tabs, "Continue without account" option
- Magic link callback page placeholder (`src/pages/MagicLinkCallbackPage.vue`)
- Route guards: all app routes have `requiresAuth: true`, login/magic-link routes exempt
- App.vue bootstrap: global settings → auth init → family resolution → data load
- AppHeader: profile dropdown with family name, email, sign out, offline badge
- ADR-009 (per-family database architecture) and ADR-010 (AWS Cognito authentication)

### Family Management Enhancements (Stage 4)

- Role management: `MemberRoleManager.vue` dropdown to promote/demote members (admin/member)
- `updateMemberRole()` action in familyStore
- Family name editing inline in FamilyPage header
- `CreateMemberAccountModal.vue` placeholder (requires Lambda backend)
- "Create Login" button on member cards (shown when auth is configured)

### Magic Link Authentication (Stage 5)

- `MagicLinkCallbackPage.vue` completes custom auth challenge: initiates custom auth → responds with code → caches tokens → redirects to dashboard
- LoginPage "Sign in with magic link" option: email input → "Check your email" confirmation screen
- `initiateCustomAuth()` and `respondToMagicLinkChallenge()` in cognitoService (implemented in Stage 2)
- Requires AWS Lambda infrastructure for challenge generation (Define/Create/Verify Auth Challenge Lambdas + DynamoDB + SES)

### Passkey (WebAuthn) Authentication (Stage 6)

- `passkeyService.ts`: feature detection, registration, sign-in, passkey management (localStorage for MVP)
- `PasskeySettings.vue` component: lists registered passkeys, register new, remove existing
- LoginPage "Sign in with passkey" button (shown when WebAuthn is supported)
- SettingsPage Security section with PasskeySettings (shown when auth is configured)
- Requires Cognito WebAuthn support + server-side challenge generation for full flow

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
- **`src/components/common/MobileBottomNav.vue`** — Fixed bottom tab bar (4 tabs: Nook, Accounts, Goals, Pod) with safe area insets, Heritage Orange active state, dark mode support
- **`src/components/common/MobileHamburgerMenu.vue`** — Full-screen slide-in overlay from left with Deep Slate background, brand logo, controls section (member filter, privacy toggle, language selector, currency chips), all 9 nav items, user profile card, security indicators footer. Closes on backdrop click, Escape key, and route change
- **`src/components/common/AppHeader.vue`** — Mobile: hamburger button + greeting/page title + notification bell. Desktop: unchanged (all controls preserved)
- **`src/App.vue`** — Sidebar hidden on mobile (`v-if="isDesktop"`), bottom nav shown on mobile, hamburger menu wired up, reduced mobile padding (`p-4 md:p-6`), bottom padding clearance (`pb-24`)
- **`src/components/ui/BaseModal.vue`** — `fullscreenMobile` prop: removes rounded corners and max-width on mobile viewports
- **`src/constants/navigation.ts`** — `MobileTabDef` interface and `MOBILE_TAB_ITEMS` constant (4 tabs)
- **`src/services/translation/uiStrings.ts`** — 7 new i18n keys: `mobile.nook`, `mobile.pod`, `mobile.menu`, `mobile.closeMenu`, `mobile.navigation`, `mobile.controls`, `mobile.viewingAll`
- **Responsive page pass** — Fixed hardcoded grid/width classes across 5 pages:
  - TransactionsPage: `grid-cols-2` → `grid-cols-1 md:grid-cols-2` (2 form modals)
  - GoalsPage: `grid-cols-2` → `grid-cols-1 md:grid-cols-2` (2 form modals)
  - AssetsPage: `grid-cols-2` → `grid-cols-1 md:grid-cols-2` (card value display)
  - ReportsPage: `w-64`/`w-48`/`w-40` → `w-full md:w-*` (4 fixed-width selects)
  - FamilyPage: `grid-cols-2`/`grid-cols-3` → responsive variants (4 form grids)

### Count-Up Animation for All Summary Cards

- **`src/composables/useAnimatedCurrency.ts`** — Reusable composable wrapping `useCountUp` + `convertToDisplay` + `formatCurrencyWithCode` + privacy mode masking. Returns `{ formatted, displayValue }`. When privacy mode is on, target drops to 0 so revealing figures triggers a fresh count-up from zero
- **NetWorthHeroCard** — Hero net worth amount (800ms duration) and change amount (200ms delay) now animate on load and when values change
- **AccountsPage** — 3 summary cards (Total Assets, Total Liabilities, Net Worth) with staggered delays (0/100/200ms)
- **TransactionsPage** — 6 summary cards: 3 transaction tab (Period Income, Expenses, Net) + 3 recurring tab (Monthly Income, Expenses, Net) with staggered delays
- **AssetsPage** — 4 summary cards (Total Asset Value, Total Loans, Net Asset Value, Appreciation/Depreciation) with staggered delays (0/100/200/300ms)
- **GoalsPage** — 3 integer count cards (Active, Completed, Overdue goals) using `useCountUp` directly with staggered delays
- All animations respect `prefers-reduced-motion` accessibility setting

### Recent Fixes

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

### AWS Infrastructure & Deployment

- **Terraform IaC** (`infrastructure/`) — Modular Terraform configuration with S3 backend + DynamoDB locking
  - `frontend` module: S3 bucket (CloudFront OAC), CloudFront distribution (HTTPS, gzip, SPA routing), ACM cert (DNS-validated), Route53 A/AAAA records
  - `auth` module: Cognito User Pool (email sign-in, code-based verification, custom attributes `familyId`/`familyRole`), SPA app client (no secret, SRP auth)
- **CI/CD Pipeline** (`.github/workflows/deploy.yml`) — Two-job GitHub Actions workflow:
  - `test` job: lint, type-check, Vitest unit tests, Playwright E2E (chromium), production build
  - `deploy` job: S3 sync + CloudFront cache invalidation (only runs after tests pass)
  - All secrets (Cognito IDs, AWS credentials, S3 bucket, CloudFront ID) stored in GitHub Secrets
- **Live at** `https://beanies.family` (and `https://www.beanies.family`)
- Issues closed: #8, #9, #10, #11, #12, #13

## In Progress

- **Multi-Family with AWS Cognito Auth** — All 6 stages implemented (client-side); magic link + passkey require Lambda backend

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

## Up Next (Phase 1 Remaining)

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
- [ ] Switchable UI themes (Issue #41)
- [ ] Data validation and error handling improvements
- [x] Mobile responsive layout (Issue #63) ✓
- [ ] Responsive design polish
- [ ] Financial forecasting / projections page

## v5 UI Framework Proposal

A v5 UI framework proposal has been uploaded to `docs/brand/beanies-ui-framework-proposal-v5.html`, superseding v4 with expanded login/onboarding screens and design refinements. The v3 proposal (`beanies-ui-framework-proposals-v3.html`) has been removed as it is no longer relevant.

v5 adds a split login/auth flow (Proposals 00a–00d: Welcome Gate, Sign In, Create Pod, Join Pod) and updated onboarding screens. All previous v4 screens are retained.

| Issue | Screen                                                               | Status     |
| ----- | -------------------------------------------------------------------- | ---------- |
| #68   | Budget page — family budget tracking with category budgets           | New screen |
| #69   | Login page UI redesign — Welcome Gate + Sign In per v5 proposal      | Redesign   |
| #70   | Accounts page redesign — Assets/Liabilities hero + Cards/List toggle | Redesign   |
| #71   | Transactions page — full ledger view                                 | Redesign   |
| #72   | Landing page — public-facing hero page                               | New screen |
| #73   | Family Hub — 3-column layout with calendar and events                | Redesign   |
| #62   | Onboarding redesign — v5 welcome flow with illustrations             | Redesign   |

Existing issues updated with v5 references: #60, #61, #62, #69.

## Future Phases

### Phase 2 — Enhanced Features

- [ ] Budget page with category budgets and spending vs planned (#68)
- [ ] Data import/export (CSV, etc.)
- [ ] PWA offline support (service worker)
- [ ] Google Drive sync (OAuth integration)
- [ ] Skip/modify individual recurring occurrences
- [ ] Landing/marketing page (#72)

### Phase 3 — AI & Advanced

- [ ] AI-powered insights (Claude/OpenAI/Gemini)
- [ ] Additional language support

## Known Issues

_(None currently tracked)_

## Decision Log

| Date       | Decision                                                   | Rationale                                                                                                                 |
| ---------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 2026-02-17 | Created docs/STATUS.md for project tracking                | Multiple contributors need shared context                                                                                 |
| 2026-02-17 | Added ARCHITECTURE.md and 8 ADR documents                  | Document key decisions for contributor onboarding                                                                         |
| Prior      | Switched from idb library to native IndexedDB APIs         | Reduce dependencies                                                                                                       |
| Prior      | Chose File System Access API over Google Drive for sync    | Simpler implementation, no OAuth needed, user controls file location                                                      |
| Prior      | Used AES-GCM + PBKDF2 for encryption                       | Industry standard, no external dependencies (Web Crypto API)                                                              |
| Prior      | Stored amounts in original currency, convert on display    | No data loss from premature conversion, flexible display                                                                  |
| Prior      | Recurring items as templates, not transactions             | Clean separation, catch-up processing, easy to preview                                                                    |
| Prior      | MyMemory API for translations                              | Free, CORS-enabled, no API key required                                                                                   |
| 2026-02-17 | Per-family databases instead of familyId on all models     | No repository code changes, no schema migration, clean tenant isolation                                                   |
| 2026-02-17 | Global settings (theme, language, rates) in registry DB    | Device-level preferences survive family switching                                                                         |
| 2026-02-17 | AWS Cognito for auth (optional, not required)              | Standard auth provider, extensible for magic link + passkey                                                               |
| 2026-02-17 | Auth is optional — "Continue without account" mode         | Preserves existing local-only behavior for users without AWS setup                                                        |
| 2026-02-17 | 7-day offline grace period for cached auth tokens          | Balance between security and offline usability                                                                            |
| 2026-02-18 | File-first architecture: encrypted file as source of truth | Security value proposition, user data control, IndexedDB is ephemeral                                                     |
| 2026-02-18 | Encryption enabled by default for new data files           | Secure by default, users can opt out with explicit warning                                                                |
| 2026-02-18 | Auto-sync always on (no toggle)                            | Simplifies UX, data file always stays current                                                                             |
| 2026-02-19 | Rebranded to beanies.family (Issue #22)                    | Heritage Orange + Deep Slate palette, Outfit + Inter fonts, squircles                                                     |
| 2026-02-20 | Centralized icon system (Issue #44)                        | Single source of truth for ~72 icons, brand-enforced stroke style                                                         |
| 2026-02-20 | Web Audio API for sound effects (Issue #46)                | Zero bundle size, no audio files, sub-ms latency, browser-native                                                          |
| 2026-02-20 | Beanie UI overhaul complete (Issue #40)                    | All 13 sections done: icons, animations, sounds, empty states, 404, etc                                                   |
| 2026-02-20 | Beanie character avatars (Issue #39)                       | Inline SVG avatars by gender/age, children wear beanie hats, replaces initial circles                                     |
| 2026-02-20 | Collapsible completed goals section (Issue #55)            | Disclosure pattern over tabs — completed goals are secondary archive                                                      |
| 2026-02-20 | Financial institution dropdown (Issue #42)                 | Searchable combobox with custom entry persistence, deferred save                                                          |
| 2026-02-21 | Sidebar redesign — Deep Slate + emoji nav (Issue #59)      | Permanent dark sidebar, emoji icons, nav extracted to shared constant for mobile reuse                                    |
| 2026-02-21 | v4 UI framework proposal uploaded                          | New screens: Budget (#68), Login UI (#69), Landing (#72). Redesigns: Accounts (#70), Transactions (#71), Family Hub (#73) |
| 2026-02-22 | v5 UI framework proposal uploaded, v3 removed              | v5 adds split login flow (Welcome Gate, Sign In, Create Pod, Join Pod) + updated onboarding. v3 deleted as obsolete       |
| 2026-02-21 | Header redesign — seamless icon-only controls (#67)        | Page titles in header (not in views), no border/bg, squircle icon-only controls, notification bell, avatar-only profile   |
| 2026-02-21 | Net worth chart via transaction replay (#66)               | Option A (replay backwards from current balances) chosen over snapshot approach for MVP simplicity                        |
| 2026-02-21 | PNG brand avatars replace inline SVGs (#65)                | Hand-crafted PNGs are more expressive; member differentiation via colored ring + pastel background                        |
| 2026-02-22 | Configurable currency chips in header (#36)                | Inline chips for instant switching; max 4 preferred currencies persisted in settings                                      |
| 2026-02-22 | SVG flag images instead of emoji flags (#38)               | Emoji flags don't render on Windows; SVGs ensure cross-platform visibility                                                |
| 2026-02-22 | Full i18n string extraction                                | All ~200 hardcoded UI strings moved to uiStrings.ts; project rule: no hardcoded text in templates                         |
| 2026-02-22 | Plans archive in docs/plans/                               | Accepted plans saved before implementation for historical reference and future context                                    |
| 2026-02-22 | Performance reference document                             | Client-side resource boundaries, growth projections, and mitigation strategies documented                                 |
| 2026-02-22 | Mobile responsive layout (#63)                             | Hamburger menu + 4-tab bottom nav + breakpoint composable; sidebar hidden on mobile; responsive page grids                |
| 2026-02-22 | AWS infrastructure via Terraform (#8-#11)                  | S3/CloudFront/ACM/Route53 for hosting, Cognito for auth, modular IaC with remote state                                    |
| 2026-02-22 | CI/CD pipeline with E2E gating (#11)                       | GitHub Actions: lint + type-check + unit tests + Playwright E2E must pass before deploy to production                     |
| 2026-02-22 | Site deployed to beanies.family                            | Production build with Cognito env vars, S3 sync, CloudFront CDN, HTTPS via ACM                                            |
| 2026-02-22 | Switched email verification from link to code              | Link-based verification redirected to AWS-hosted page with no return; code-based keeps user in the app                    |
| 2026-02-22 | Post-sign-in redirect checks onboarding status             | New users redirected to /setup instead of /dashboard; direct DB read after sign-in for reliability                        |
