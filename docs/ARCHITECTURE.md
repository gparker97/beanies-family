# Architecture Overview

> **Last updated:** 2026-02-17

## High-Level Architecture

GP Family Finance Planner is a **local-first, single-page application** (SPA) built with Vue 3. All data is stored client-side in IndexedDB, with optional file-based sync for backup and multi-device use.

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
          ┌───────────┼───────────┐
          ▼           ▼           ▼
    ┌──────────┐ ┌─────────┐ ┌──────────┐
    │ Local    │ │ Exchange │ │ MyMemory │
    │ .json    │ │ Rate API │ │ Translate│
    │ File     │ │ (CDN)    │ │ API      │
    └──────────┘ └─────────┘ └──────────┘
```

## Data Flow

1. **User actions** trigger Vue component methods
2. Components call **Pinia store actions** (never IndexedDB directly)
3. Stores call **IndexedDB repository** methods for persistence
4. Stores hold reactive state for the UI layer
5. If sync is enabled, data changes trigger **debounced saves** to local JSON file

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

### Composables (`src/composables/`)

- `useCurrencyDisplay`: Currency conversion and formatting with exchange rate lookups
- `useExchangeRates`: Exchange rate management and auto-update
- `useTranslation`: Translation with IndexedDB caching

### UI Components (`src/components/ui/`)

- Reusable base components: BaseButton, BaseCard, BaseInput, BaseModal, BaseSelect
- Consistent styling via Tailwind CSS utility classes

## Database Schema

**Database name:** `gp-family-finance` (version 3)

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

A secondary database (`gp-finance-file-handles`, version 1) stores the File System Access API file handle for sync file persistence across browser sessions.

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

### Sync Model

- **File-based sync** using the File System Access API (Chrome/Edge)
- File handle persisted in a separate IndexedDB database across sessions
- Sync file format: versioned JSON with optional AES-GCM encryption
- **Full replace strategy**: file always wins on import (not merge-based)
- Auto-sync uses debounced saves (2-second delay) after data changes
- Manual export/import fallback for browsers without File System Access API

### Recurring Transactions

- `RecurringItem` is a template, not a transaction itself
- Processor runs on app startup, generates transactions for all due dates since last processed
- Supports daily, monthly (day-of-month), and yearly (month + day) frequencies
- Day-of-month capped to actual days in month (e.g., 31st → 28th in February)
- Generated transactions are linked back via `recurringItemId`

## Testing

- **Unit tests**: Vitest with happy-dom, files co-located as `*.test.ts`
- **E2E tests**: Playwright with Chromium/Firefox/WebKit, page object model pattern
- **E2E structure**: `e2e/specs/` for tests, `e2e/page-objects/` for page abstractions, `e2e/helpers/` for IndexedDB utilities
- **Linting**: ESLint + Prettier + Stylelint with Husky pre-commit hooks
