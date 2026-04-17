# Architecture Overview

> **Last updated:** 2026-03-04

## High-Level Architecture

beanies.family is a **local-first, single-page application** (SPA) built with Vue 3. All family data lives in an **Automerge CRDT document** (in memory), encrypted with a per-family AES-256-GCM key and persisted to both a local IndexedDB cache and a cloud `.beanpod` V4 file. Authentication uses the family key model — each member's password (or passkey PRF) unwraps the shared family key via AES-KW.

### Architecture Pattern: MVO (Model / View / Orchestrator)

The app follows the **MVO** pattern — not MVC. The distinction matters because Pinia stores and composables do far more than traditional controllers: they orchestrate multi-step async workflows across the CRDT layer, encryption, IndexedDB persistence, Google Drive sync, and UI state.

| Layer            | Implementation                                                                 | Responsibility                                                                                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Model**        | Automerge CRDT document (source of truth) + Pinia stores (reactive projection) | Hold and mutate data. The Automerge doc is the durable model; stores expose reactive computed state derived from it.                                                                                                   |
| **View**         | Vue 3 components (`src/pages/`, `src/components/`)                             | Render state reactively and emit user intents. Views never call services or repositories directly — they always go through stores.                                                                                     |
| **Orchestrator** | Pinia stores (`src/stores/`) + composables (`src/composables/`)                | Coordinate workflows: user action → CRDT mutation → bump `docVersion` → trigger persistence (IndexedDB) → trigger sync (Drive). Handle error recovery, retry logic, conflict resolution, and cross-store coordination. |

Vue's reactivity system means views subscribe to state directly — there is no controller explicitly pushing data to the view. This is the defining characteristic of MVO over MVC: the orchestrator manages _workflows_, not _request/response cycles_.

```
┌──────────────────────────────────────────────────────────────┐
│                         Browser                              │
│                                                              │
│  ┌──────────┐   ┌──────────┐   ┌──────────────────────────┐ │
│  │ Vue 3    │──▶│ Pinia    │──▶│ Automerge Repository     │ │
│  │ Pages    │   │ Stores   │   │ Factory (CRDT in RAM)    │ │
│  └──────────┘   └──────────┘   └────────────┬─────────────┘ │
│       │                                      │               │
│       ▼                          ┌───────────┴────────────┐  │
│  ┌──────────┐                    │  Doc Service           │  │
│  │ Vue      │                    │  (docVersion shallowRef│  │
│  │ Router   │                    │   + changeDoc/mergeDoc)│  │
│  └──────────┘                    └───────────┬────────────┘  │
│                                   ┌──────────┴──────────┐    │
│                                   ▼                     ▼    │
│                          ┌──────────────┐   ┌─────────────┐  │
│                          │ Persistence  │   │ Sync Service │  │
│                          │ Cache (IDB)  │   │ (File/Drive) │  │
│                          └──────────────┘   └──────┬──────┘  │
│                                                    │         │
│                                       ┌────────────▼───────┐ │
│                                       │ Family Key Service │ │
│                                       │ (AES-GCM + AES-KW)│ │
│                                       └────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┬───────────────┐
          ▼               ▼               ▼               ▼
    ┌──────────┐    ┌──────────┐    ┌─────────┐    ┌──────────┐
    │ Local    │    │ Google   │    │Exchange │    │ MyMemory │
    │ .beanpod │    │ Drive    │    │Rate API │    │ Translate│
    │ File     │    │ (PKCE)   │    │ (CDN)   │    │ API      │
    └──────────┘    └──────────┘    └─────────┘    └──────────┘
```

## Data Flow

1. **User actions** trigger Vue component methods
2. Components call **Pinia store actions** (never repositories directly)
3. Stores call **Automerge repository** methods which mutate the in-memory CRDT document
4. Mutations bump `docVersion` (a `shallowRef`), triggering Vue reactivity
5. A debounced persist callback (500ms) encrypts the Automerge binary with the family key and writes to the IndexedDB cache
6. If sync is enabled, data changes trigger **debounced saves** (2s) to the `.beanpod` V4 file (local or Google Drive)

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
- Call Automerge repository methods for CRUD

### Services (`src/services/`)

- **automerge/**: Document service (singleton CRDT), repository factory, persistence cache
- **sync/**: File System Access API integration, Google Drive storage, file handle persistence, sync coordination
- **crypto/**: AES-GCM encryption with PBKDF2 key derivation, family key service (AES-KW wrapping), invite token service
- **auth/**: Password hashing (`passwordService.ts`), passkey/WebAuthn support (`passkeyService.ts`)
- **google/**: OAuth PKCE proxy client (`oauthProxy.ts`), Drive API client (`driveService.ts`)
- **exchangeRate/**: Free currency API integration with fallback
- **recurring/**: Recurring transaction processor (runs on app startup)
- **translation/**: MyMemory API integration for i18n
- **indexeddb/**: Registry database, active family tracking, database cleanup utilities

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
- `useClipboard`: Cross-browser clipboard write with fallback

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

## Data Storage

### Automerge Document (`FamilyDocument`)

All family data lives in a single Automerge CRDT document per family. Collections use `Record<string, Entity>` maps (not arrays) for clean CRDT merge semantics:

| Collection     | Entity Type    | Notes                       |
| -------------- | -------------- | --------------------------- |
| familyMembers  | FamilyMember   | Keyed by member UUID        |
| accounts       | Account        | Keyed by account UUID       |
| transactions   | Transaction    | Keyed by transaction UUID   |
| assets         | Asset          | Keyed by asset UUID         |
| goals          | Goal           | Keyed by goal UUID          |
| budgets        | Budget         | Keyed by budget UUID        |
| recurringItems | RecurringItem  | Keyed by item UUID          |
| todos          | TodoItem       | Keyed by todo UUID          |
| activities     | FamilyActivity | Keyed by activity UUID      |
| settings       | Settings       | Singleton (direct property) |

### Automerge Persistence Cache

Each family's Automerge binary is encrypted and cached in IndexedDB: `beanies-automerge-{familyId}`. This cache is ephemeral — deleted on sign-out. It enables fast startup without re-reading the cloud file.

### Registry Database

A shared `beanies-registry` database stores cross-family metadata:

| Object Store       | Purpose                                                          |
| ------------------ | ---------------------------------------------------------------- |
| families           | Family list (id, name, createdAt)                                |
| userFamilyMappings | Maps auth users to families                                      |
| globalSettings     | Device-level prefs (theme, language, rates, cached family keys)  |
| passkeys           | WebAuthn passkey registrations (device-level, survives sign-out) |

### File Handle Database

`beanies-file-handles` (version 1) stores File System Access API handles per family using `syncFile-{familyId}` keys. Also stores Google OAuth refresh tokens (`googleRefreshToken-{familyId}`) and provider config (`providerConfig-{familyId}`).

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

### Automerge-First Architecture

- **Automerge CRDT in memory is the source of truth** — IndexedDB is an encrypted ephemeral cache, deleted on sign-out
- The `.beanpod` V4 file is the durable encrypted copy (local file or Google Drive)
- **V4 beanpod format**: JSON envelope with `version: '4.0'`, `familyId`, `familyName`, `keyId`, per-member `wrappedKeys`, `passkeyWrappedKeys`, `inviteKeys`, and `encryptedPayload` (AES-GCM encrypted Automerge binary)
- **CRDT merge** for cross-device sync: Automerge handles all conflict resolution automatically
- Debounced persistence (500ms for cache, 2s for file save) after mutations
- Sync guards validate `familyId` on save, load, and decrypt to prevent cross-family data leakage
- See [ADR-018](adr/018-automerge-crdt-migration.md) for the migration decision

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

- **Family key model**: A random 256-bit AES-GCM family key encrypts the Automerge document. Each member's key is wrapped individually via AES-KW (see [ADR-019](adr/019-family-key-encryption.md)):
  - **Password path**: PBKDF2 (100k iterations) derives an AES-KW wrapping key → unwraps the family key
  - **Passkey PRF path**: Authenticator PRF output → HKDF → AES-KW key → unwraps family key directly (true passwordless)
  - **Invite token path**: PBKDF2 from one-time token → AES-KW key → unwraps family key for new members (24h expiry)
- **Single password**: Member password both proves identity and unwraps the family key — no separate file decrypt step
- **Biometric login (passkeys)**: WebAuthn with PRF extension replaces password entirely on supported platforms
  - Passkey registrations stored in registry DB (device-level, survives sign-out)
  - Password changes re-wrap the family key (no need to re-encrypt entire document)
  - See [ADR-015](adr/015-passkey-biometric-authentication.md) for the passkey decision
- **Trusted device mode**: Family key cached in `globalSettings.cachedFamilyKeys` for passwordless re-entry on personal devices
- **Member lifecycle**: Owner creates member → generates invite link (magic link + QR) → new member redeems token and sets password
- Per-family database isolation prevents cross-user data leakage
- No cloud auth dependencies — the `.beanpod` file IS the auth database

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
- **Theme skill**: `.claude/skills/beanies-theme.md` — comprehensive design reference (always consult before any UI work)

### Modal System (Three-Tier)

All modals must use the established three-tier architecture. See `.claude/skills/beanies-theme.md` for full specs.

| Tier | Component             | Use Case                                  |
| ---- | --------------------- | ----------------------------------------- |
| 1    | `BaseModal.vue`       | View-only content, custom layouts         |
| 2    | `BeanieFormModal.vue` | All create/edit forms (extends BaseModal) |
| 3    | `ConfirmModal.vue`    | Confirmation dialogs (via `useConfirm()`) |

**Key conventions:**

- Form modals use `BeanieFormModal` with emoji icon box (44×44), Cloud White body, gradient save button
- View/Edit dual-mode: read-only in BaseModal, edit in BeanieFormModal (see `TodoViewEditModal.vue`)
- Shared form components: `FormFieldGroup`, `FamilyChipPicker`, `EmojiPicker`, `AmountInput`, `ConditionalSection`
- Delete confirmations: always via `useConfirm()` composable with `variant: 'danger'`
- Orange gradient for finance forms, purple gradient for to-do forms
