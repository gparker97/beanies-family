# Project Status

> **Last updated:** 2026-02-19
> **Updated by:** Claude (beanies.family rebranding — Issue #22)

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

- Base component library: BaseButton, BaseCard, BaseInput, BaseModal, BaseSelect
- AppHeader, AppSidebar layout components

### Pages / Features

- Dashboard with summary cards (combined one-time + recurring totals)
- Accounts management (full CRUD, card-based layout)
- Transactions management (full CRUD, with date filter, category icons)
- Assets management (full CRUD, loan tracking, combined net worth)
- Goals management (full CRUD)
- Reports page (net worth, income vs expenses, extended date ranges, category breakdowns)
- Family member management (global member filter)
- Settings page (currency, theme, sync, encryption)
- First-run setup wizard
- Multi-currency display with global display currency selector

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
- Restored ReportsPage that was wiped during bulk ESLint/Prettier formatting
- Added data-testid attributes to transaction items and account cards for E2E tests
- Fixed E2E tests to switch to transactions tab before interacting with elements
- Switched from idb library to native IndexedDB APIs

## In Progress

- **Multi-Family with AWS Cognito Auth** — All 6 stages implemented (client-side); awaiting AWS infrastructure deployment for magic link + passkey backend

## Up Next (Phase 1 Remaining)

- [ ] Data validation and error handling improvements
- [ ] Responsive design polish
- [ ] Financial forecasting / projections page

## Future Phases

### Phase 2 — Enhanced Features

- [ ] Data import/export (CSV, etc.)
- [ ] PWA offline support (service worker)
- [ ] Google Drive sync (OAuth integration)
- [ ] Skip/modify individual recurring occurrences

### Phase 3 — AI & Advanced

- [ ] AI-powered insights (Claude/OpenAI/Gemini)
- [ ] Budget tracking and alerts
- [ ] Additional language support

## Known Issues

_(None currently tracked)_

## Decision Log

| Date       | Decision                                                   | Rationale                                                               |
| ---------- | ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| 2026-02-17 | Created docs/STATUS.md for project tracking                | Multiple contributors need shared context                               |
| 2026-02-17 | Added ARCHITECTURE.md and 8 ADR documents                  | Document key decisions for contributor onboarding                       |
| Prior      | Switched from idb library to native IndexedDB APIs         | Reduce dependencies                                                     |
| Prior      | Chose File System Access API over Google Drive for sync    | Simpler implementation, no OAuth needed, user controls file location    |
| Prior      | Used AES-GCM + PBKDF2 for encryption                       | Industry standard, no external dependencies (Web Crypto API)            |
| Prior      | Stored amounts in original currency, convert on display    | No data loss from premature conversion, flexible display                |
| Prior      | Recurring items as templates, not transactions             | Clean separation, catch-up processing, easy to preview                  |
| Prior      | MyMemory API for translations                              | Free, CORS-enabled, no API key required                                 |
| 2026-02-17 | Per-family databases instead of familyId on all models     | No repository code changes, no schema migration, clean tenant isolation |
| 2026-02-17 | Global settings (theme, language, rates) in registry DB    | Device-level preferences survive family switching                       |
| 2026-02-17 | AWS Cognito for auth (optional, not required)              | Standard auth provider, extensible for magic link + passkey             |
| 2026-02-17 | Auth is optional — "Continue without account" mode         | Preserves existing local-only behavior for users without AWS setup      |
| 2026-02-17 | 7-day offline grace period for cached auth tokens          | Balance between security and offline usability                          |
| 2026-02-18 | File-first architecture: encrypted file as source of truth | Security value proposition, user data control, IndexedDB is ephemeral   |
| 2026-02-18 | Encryption enabled by default for new data files           | Secure by default, users can opt out with explicit warning              |
| 2026-02-18 | Auto-sync always on (no toggle)                            | Simplifies UX, data file always stays current                           |
| 2026-02-19 | Rebranded to beanies.family (Issue #22)                    | Heritage Orange + Deep Slate palette, Outfit + Inter fonts, squircles   |
