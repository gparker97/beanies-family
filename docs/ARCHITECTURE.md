# Architecture Overview

> **Last updated:** 2026-02-24

## High-Level Architecture

beanies.family is a **local-first, single-page application** (SPA) built with Vue 3. All data is stored client-side in IndexedDB with an encrypted local file as source of truth. File-based authentication uses PBKDF2 password hashes stored in the data file itself — no cloud auth dependencies.

```
┌──────────────────────────────────────────────────┐
│                   Browser                        │
│                                                  │
│  ┌──────────┐   ┌──────────┐   ┌──────────────┐ │
│  │ Vue 3    │──▶│ Pinia    │──▶│ IndexedDB    │ │
│  │ Pages    │   │ Stores   │   │ Repositories │ │
│  └──────────┘   └──────────┘   └──────────────┘ │
│       │                             │            │
│       ▼                             ▼            │
│  ┌──────────┐              ┌──────────────────┐  │
│  │ Vue      │              │ Sync Service     │  │
│  │ Router   │              │ (File System     │  │
│  └──────────┘              │  Access API)     │  │
│                            └────────┬─────────┘  │
│                                     │            │
│                            ┌────────▼─────────┐  │
│                            │ Encryption       │  │
│                            │ (Web Crypto API) │  │
│                            └──────────────────┘  │
└──────────────────────────────────────────────────┘
                      │
          ┌───────────┼───────────┬───────────┐
          ▼           ▼           ▼           ▼
    ┌──────────┐ ┌─────────┐ ┌──────────┐
    │ Local    │ │ Exchange │ │ MyMemory │
    │ .beanpod │ │ Rate API │ │ Translate│
    │ File     │ │ (CDN)    │ │ API      │
    └──────────┘ └─────────┘ └──────────┘
```

## Data Flow

1. **User actions** trigger Vue component methods
2. Components call **Pinia store actions** (never IndexedDB directly)
3. Stores call **IndexedDB repository** methods for persistence
4. Stores hold reactive state for the UI layer
5. If sync is enabled, data changes trigger **debounced saves** to local `.beanpod` file

## Layer Responsibilities

### Pages (`src/pages/`)

- Full-page Vue components, one per route
- Consume Pinia stores for state and actions
- Handle user interactions and form submissions
- All routes lazy-loaded for code splitting

### Stores (`src/stores/`)

- Pinia stores using Composition API style
- Single source of truth for reactive state
- Orchestrate business logic (e.g., updating account balance on transaction)
- Call repository methods for CRUD

### Services (`src/services/`)

- **indexeddb/**: Database initialization and entity-specific repositories
- **sync/**: File System Access API integration, file handle persistence, sync coordination
- **crypto/**: AES-GCM encryption with PBKDF2 key derivation
- **exchangeRate/**: Free currency API integration with fallback
- **recurring/**: Recurring transaction processor (runs on app startup)
- **translation/**: MyMemory API integration for i18n
- **auth/**: PBKDF2 password hashing service (`passwordService.ts`) and passkey/WebAuthn support (`passkeyService.ts`)

### Composables (`src/composables/`)

- `useCurrencyDisplay`: Currency conversion and formatting with exchange rate lookups
- `useExchangeRates`: Exchange rate management and auto-update
- `useTranslation`: Translation with IndexedDB caching and beanie mode
- `usePrivacyMode`: Global privacy toggle (mask/reveal financial figures)
- `useCountUp`: Animated number transitions with ease-out cubic easing
- `useReducedMotion`: Respects `prefers-reduced-motion` system preference
- `useCelebration`: Singleton celebration triggers (toasts + modals)
- `useConfirm`: Singleton branded confirmation dialogs (`confirm()` / `alert()`)
- `useSounds`: Web Audio API synthesised sound effects (zero bundle size)
- `useInstitutionOptions`: Merges predefined + custom institutions for combobox
- `useMemberAvatar`: Maps member gender/age to avatar variant + PNG path

### Constants (`src/constants/`)

- `icons.ts`: Central registry of ~72 beanie-styled SVG icon definitions
- `navigation.ts`: Shared `NavItemDef[]` consumed by sidebar (and future mobile nav)
- `avatars.ts`: Avatar variant → PNG path mappings
- `institutions.ts`: 22 predefined global banks for combobox
- `categories.ts`: Income/expense category definitions
- `currencies.ts`: Supported currencies with metadata

### UI Components (`src/components/ui/`)

- Base components: BaseButton, BaseCard, BaseCombobox, BaseInput, BaseModal, BaseSelect, BaseMultiSelect
- Brand components: BeanieIcon, BeanieAvatar, BeanieSpinner, ConfirmModal, CelebrationOverlay, EmptyStateIllustration
- Consistent styling via Tailwind CSS 4 utility classes with brand design tokens

## Database Schema

### Per-Family Databases

Each family gets its own IndexedDB: `gp-family-finance-{familyId}` (version 3). This provides clean tenant isolation — no `familyId` columns needed on records.

| Object Store   | Key         | Indexes                            |
| -------------- | ----------- | ---------------------------------- |
| familyMembers  | id (UUID)   | by-email (unique)                  |
| accounts       | id (UUID)   | by-memberId, by-type               |
| transactions   | id (UUID)   | by-accountId, by-date, by-category |
| assets         | id (UUID)   | by-memberId, by-type               |
| goals          | id (UUID)   | by-memberId                        |
| recurringItems | id (UUID)   | by-accountId, by-type, by-isActive |
| settings       | id (string) | _(none)_                           |
| syncQueue      | id (UUID)   | by-synced, by-timestamp            |
| translations   | id (string) | by-language                        |

### Registry Database

A shared `gp-finance-registry` database stores cross-family metadata:

| Object Store       | Purpose                                                          |
| ------------------ | ---------------------------------------------------------------- |
| families           | Family list (id, name, createdAt)                                |
| userFamilyMappings | Maps auth users to families                                      |
| globalSettings     | Device-level prefs (theme, language, rates)                      |
| passkeys           | WebAuthn passkey registrations (device-level, survives sign-out) |

### File Handle Database

`gp-finance-file-handles` (version 1) stores File System Access API handles per family using `syncFile-{familyId}` keys.

## Entity Relationships

```
FamilyMember (1) ──────▶ (N) Account
                               │
                               ├──▶ (N) Transaction
                               │         │
                               │         └── toAccountId? (transfer target)
                               │
                               └──▶ (N) RecurringItem ──generates──▶ Transaction
                                         (recurringItemId link)

FamilyMember (1) ──────▶ (N) Asset
                                    └── loan? (embedded AssetLoan)

FamilyMember (0..1) ───▶ (N) Goal
                               (memberId null = family-wide)
```

## Key Patterns

### Currency Handling

- All amounts stored with their **original currency** code
- A **display currency** (user setting) is used for aggregated views
- Conversion happens on-demand in the `useCurrencyDisplay` composable
- Exchange rates fetched from free API, cached in settings, refreshed every 24h
- Multi-hop conversion supported (e.g., SGD→USD→EUR via base currencies)

### File-First Architecture

- **Encrypted local file is the source of truth** — IndexedDB is an ephemeral cache deleted on sign-out
- File handle persisted in a per-family IndexedDB database across sessions
- Sync file format v2.0: versioned JSON with `familyId`, optional AES-GCM encryption
- **Full replace strategy**: file always wins on import (not merge-based)
- Auto-sync uses debounced saves (2-second delay) after data changes
- Manual export/import fallback for browsers without File System Access API
- Sync guards validate `familyId` on save, load, and decrypt to prevent cross-family data leakage

### Recurring Transactions

- `RecurringItem` is a template, not a transaction itself
- Processor runs on app startup, generates transactions for all due dates since last processed
- Supports daily, monthly (day-of-month), and yearly (month + day) frequencies
- Day-of-month capped to actual days in month (e.g., 31st → 28th in February)
- Generated transactions are linked back via `recurringItemId`

### Navigation Architecture

- Navigation items defined once in `src/constants/navigation.ts` as a shared `NavItemDef[]`
- `PRIMARY_NAV_ITEMS` (7 items) and `SECONDARY_NAV_ITEMS` (2 items) exported for consumers
- Desktop sidebar (`AppSidebar.vue`) consumes these constants with emoji icons and active state styling
- Designed for reuse by future mobile bottom nav and hamburger menu (see v5 UI proposal)
- Each item has: `labelKey` (i18n), `path` (route), `emoji` (icon), `section` (primary/secondary)

### Authentication

- **File-based auth**: PBKDF2 password hashes stored directly in the family data file alongside `FamilyMember` records
- **Two-layer security**: (1) AES-GCM file encryption password protects data at rest, (2) per-member PBKDF2 password proves identity within the family
- **Biometric login (passkeys)**: WebAuthn replaces both passwords with a single biometric gesture. Two paths:
  - **PRF path**: Authenticator PRF output → HKDF → AES-KW unwraps the file DEK directly (true passwordless)
  - **Cached password path**: Passkey authenticates member, cached encryption password decrypts the file (Firefox fallback)
  - Passkey registrations stored in registry DB (device-level, survives sign-out)
  - Password changes invalidate PRF-wrapped DEKs and update cached passwords
  - See ADR-015 for the full decision record
- **Member lifecycle**: Owner creates member → shares invite → member claims record and sets password during joiner onboarding
- Per-family database isolation prevents cross-user data leakage
- No cloud auth dependencies — the data file IS the auth database
- See ADR-014 for the decision to move from Cognito to file-based auth

## Testing

- **Unit tests**: Vitest with happy-dom, files co-located as `*.test.ts`
- **E2E tests**: Playwright with Chromium/Firefox/WebKit, page object model pattern
- **E2E structure**: `e2e/specs/` for tests, `e2e/page-objects/` for page abstractions, `e2e/helpers/` for IndexedDB utilities
- **Linting**: ESLint + Prettier + Stylelint with Husky pre-commit hooks

## UI Design System

The app follows the **Nook UI** design system (v5 proposal: `docs/brand/beanies-ui-framework-proposal-v5.html`):

- **Shape language**: Squircle corners (24px+ radius) on all containers
- **Shadows**: Diffused and subtle (`--card-shadow`, `--card-hover-shadow`)
- **Typography**: Outfit for headings/amounts, Inter for body/data
- **Brand colors**: Heritage Orange (CTAs), Deep Slate (anchor), Sky Silk (calm), Terracotta (warmth), Cloud White (space)
- **Theme skill**: `.claude/skills/beanies-theme.md` — comprehensive design reference
