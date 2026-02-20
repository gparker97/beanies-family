# beanies.family

> **IMPORTANT — Read before starting any work:**
> Always read `docs/STATUS.md` before beginning or continuing work on this project. It contains the latest project status, what is in progress, and recent decisions. Update it when completing significant work or making architectural decisions.
>
> **Key project documents in `docs/`:**
>
> - `docs/STATUS.md` — Current project status and progress
> - `docs/ARCHITECTURE.md` — System architecture, data flow, and key patterns
> - `docs/adr/` — Architectural Decision Records (ADRs) for all major design decisions
>
> **Brand:**
>
> - `docs/brand/beanies-cig.html` — Corporate Identity Guidelines (colors, typography, logo rules, voice)
> - `.claude/skills/beanies-theme.md` — Brand theme skill (use for all UI copy, component design, and image generation)

## Project Overview

beanies.family is the focal point of your family. It is a local-first, PWA-enabled family and financial planning and application. The main features include family financial planning, activity tracking, and family collaboration. The app allows families to track accounts, transactions, assets, and financial goals with multi-currency support and optional encrypted cloud sync to Google Drive. Additional features include keeping track of family activities, milestones, collaboration, and other things to help families learn, manage, and grow their beans together.

## Brand Identity

- **App name:** `beanies.family` — always lowercase with `.family`. Never "Beanies", "beanies", or "GP Family Planner".
- **Tagline:** _Every bean counts_ (sentence case, no period)
- **Primary font:** Outfit (headings, values) + Inter (body, data)
- **Primary color:** Heritage Orange `#F15D22` (actions, CTAs, growth)
- **Foundation color:** Deep Slate `#2C3E50` (text, security, dark bg)
- **Accent colors:** Sky Silk `#AED6F1` (calm, backgrounds), Terracotta `#E67E22` (children, milestones)
- **Voice:** Simple, friendly, comforting, secure, familiar. Say "counting beans..." not "Loading..."
- **Golden rule:** The beanies hold hands and are never separated; never rotate the arrow.
- **Full guidelines:** `docs/brand/beanies-cig.html`
- **Theme skill:** `.claude/skills/beanies-theme.md` — consult for all UI copy and component design

## Technology Stack

- **Framework**: Vue 3.5+ (Composition API)
- **Build Tool**: Vite 6.0+
- **Language**: TypeScript 5.6+
- **State Management**: Pinia 2.2+
- **Routing**: Vue Router 4.4+
- **Styling**: Tailwind CSS 4.0
- **Charts**: Chart.js 4.4+ / vue-chartjs 5.3+
- **Local Storage**: IndexedDB (via idb 8.0+)
- **PWA**: vite-plugin-pwa 0.20+
- **Encryption**: Web Crypto API (native)

## Project Structure

```
gp-family-finance-planner/
├── public/
│   └── icons/                     # PWA icons
├── src/
│   ├── components/
│   │   ├── common/                # AppHeader, AppSidebar
│   │   ├── ui/                    # BaseButton, BaseCard, BaseInput, BaseModal, BaseSelect
│   │   ├── forms/                 # Form components (future)
│   │   ├── charts/                # Chart components (future)
│   │   ├── dashboard/             # Dashboard widgets (future)
│   │   └── family/                # Family-related components (future)
│   ├── composables/               # Vue composables (future)
│   ├── constants/
│   │   ├── categories.ts          # Income/expense categories
│   │   └── currencies.ts          # Supported currencies
│   ├── pages/
│   │   ├── DashboardPage.vue      # Main dashboard
│   │   ├── AccountsPage.vue       # Bank accounts management
│   │   ├── TransactionsPage.vue   # Transaction tracking
│   │   ├── AssetsPage.vue         # Asset tracking
│   │   ├── GoalsPage.vue          # Financial goals
│   │   ├── ReportsPage.vue        # Charts and reports
│   │   ├── ForecastPage.vue       # Financial projections
│   │   ├── FamilyPage.vue         # Family member management
│   │   ├── SettingsPage.vue       # App settings
│   │   ├── SetupPage.vue          # First-run wizard
│   │   └── NotFoundPage.vue       # 404 page
│   ├── router/
│   │   └── index.ts               # Route definitions
│   ├── services/
│   │   ├── indexeddb/
│   │   │   ├── database.ts        # DB initialization
│   │   │   └── repositories/      # CRUD for each entity
│   │   ├── google/                # Google OAuth & Drive (future)
│   │   ├── crypto/                # Encryption services (future)
│   │   ├── sync/                  # Sync management (future)
│   │   └── ai/                    # AI integration (future)
│   ├── stores/
│   │   ├── familyStore.ts         # Family members state
│   │   ├── accountsStore.ts       # Accounts state
│   │   ├── transactionsStore.ts   # Transactions state
│   │   ├── assetsStore.ts         # Assets state
│   │   ├── goalsStore.ts          # Goals state
│   │   └── settingsStore.ts       # App settings state
│   ├── types/
│   │   └── models.ts              # TypeScript interfaces
│   ├── utils/
│   │   ├── date.ts                # Date utilities
│   │   └── id.ts                  # UUID generation
│   ├── App.vue                    # Root component
│   ├── main.ts                    # Entry point
│   └── style.css                  # Global styles (Tailwind)
├── index.html
├── vite.config.ts
├── postcss.config.js
├── tsconfig.json
└── CLAUDE.md
```

## Data Models

### FamilyMember

- `id`: UUID
- `name`: string
- `email`: string (unique)
- `role`: 'owner' | 'admin' | 'member'
- `color`: string (UI differentiation)
- Timestamps: createdAt, updatedAt

### Account

- `id`: UUID
- `memberId`: UUID (FK to FamilyMember)
- `name`: string
- `type`: 'checking' | 'savings' | 'credit_card' | 'investment' | 'crypto' | 'cash' | 'loan' | 'other'
- `currency`: CurrencyCode
- `balance`: number
- `institution`: string (optional)
- `isActive`: boolean
- `includeInNetWorth`: boolean
- Timestamps: createdAt, updatedAt

### Transaction

- `id`: UUID
- `accountId`: UUID (FK to Account)
- `toAccountId`: UUID (optional, for transfers)
- `type`: 'income' | 'expense' | 'transfer'
- `amount`: number
- `currency`: CurrencyCode
- `category`: string
- `date`: ISODateString
- `description`: string
- `recurring`: RecurringConfig (optional)
- `isReconciled`: boolean
- Timestamps: createdAt, updatedAt

### Asset

- `id`: UUID
- `memberId`: UUID (FK to FamilyMember)
- `type`: 'real_estate' | 'vehicle' | 'investment' | 'crypto' | 'collectible' | 'other'
- `name`: string
- `purchaseValue`: number
- `currentValue`: number
- `currency`: CurrencyCode
- `includeInNetWorth`: boolean
- Timestamps: createdAt, updatedAt

### Goal

- `id`: UUID
- `memberId`: UUID (optional, null = family-wide)
- `name`: string
- `type`: 'savings' | 'debt_payoff' | 'investment' | 'purchase'
- `targetAmount`: number
- `currentAmount`: number
- `currency`: CurrencyCode
- `deadline`: ISODateString (optional)
- `priority`: 'low' | 'medium' | 'high' | 'critical'
- `isCompleted`: boolean
- Timestamps: createdAt, updatedAt

### Settings

- `id`: 'app_settings' (singleton)
- `baseCurrency`: CurrencyCode
- `exchangeRates`: ExchangeRate[]
- `theme`: 'light' | 'dark' | 'system'
- `syncEnabled`: boolean
- `aiProvider`: 'claude' | 'openai' | 'gemini' | 'none'
- `aiApiKeys`: { claude?, openai?, gemini? }
- Timestamps: createdAt, updatedAt

## Development Commands

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Type check
npm run type-check

# Lint
npm run lint
```

## Key Implementation Details

1. **File-First Architecture**: Encrypted local file is the source of truth. IndexedDB is a temporary cache deleted on sign-out
2. **Multi-Currency**: Amounts stored with original currency, converted on-demand for display
3. **Family Profiles**: Each member has their own accounts/transactions, with shared family goals
4. **PWA Ready**: Service worker and manifest configured for offline support
5. **Privacy-Focused**: Data encrypted by default in a user-controlled file. No data stored on servers. IndexedDB cache deleted on sign-out
6. **Theme Support**: Light/dark mode with system preference detection

## Terminology Guide

| Correct             | Incorrect                                                              |
| ------------------- | ---------------------------------------------------------------------- |
| `beanies.family`    | Beanies, beanies, Beanies Family, GP Family Planner, GP Family Finance |
| _Every bean counts_ | Every Bean Counts, every bean counts.                                  |
| Family Data File    | Sync File                                                              |
| Family Data Options | File Sync (in Settings)                                                |
| My Family's Data    | Sync File (in Settings configured state)                               |
| Last Saved          | Last Sync                                                              |
| Saving...           | Syncing...                                                             |
| counting beans...   | Loading...                                                             |

## Code Conventions

- **Components**: PascalCase (e.g., `BaseButton.vue`)
- **Files**: camelCase for TypeScript, kebab-case for Vue pages
- **Stores**: Use Pinia composition API style
- **Types**: Centralized in `src/types/models.ts`
- **CSS**: Tailwind utility classes, custom CSS variables for theming

## Current Status (MVP - Phase 1)

Implemented:

- [x] Project scaffold with Vite + Vue 3 + TypeScript
- [x] IndexedDB service with repositories
- [x] Pinia stores for all entities
- [x] Vue Router with all page routes
- [x] UI component library (Button, Card, Input, Modal, Select)
- [x] Dashboard with summary cards
- [x] Accounts management (CRUD)
- [x] Transactions management (CRUD)
- [x] Goals management (CRUD)
- [x] Family member management
- [x] Settings page (currency, theme)
- [x] First-run setup wizard
- [x] Dark mode support

Pending (Future Phases):

- [ ] Google Drive encrypted sync
- [ ] PWA offline support
- [ ] Charts and reports
- [ ] Financial forecasting
- [ ] AI-powered insights
- [ ] Data import/export
- [ ] Recurring transactions

## Issue Implementation Workflow

When asked to implement a GitHub issue/ticket:

1. **Assign** the issue to the person who requested the work
2. **Move to in progress**: Add a comment noting implementation is starting, with a brief summary of the approach
3. **Implement** the feature/fix
4. **Mark ready for testing**: Once complete, add a comment summarizing the changes made and apply the `ready-for-testing` label to the issue
5. **Ask questions** before starting if requirements are unclear

## Issue Labeling

Every issue must have relevant labels applied. When creating or triaging issues, always add:

1. **Type** (required — pick one): `enhancement`, `bug`, `refactor`, `performance`, `accessibility`, `documentation`, `testing`
2. **Priority** (required — pick one): `priority: critical`, `priority: high`, `priority: medium`, `priority: low`
3. **Page** (if applicable — pick all that apply): `page: dashboard`, `page: accounts`, `page: transactions`, `page: assets`, `page: goals`, `page: reports`, `page: forecast`, `page: family`, `page: settings`, `page: setup`, `page: login`
4. **Area** (if applicable — pick all that apply): `area: ui`, `area: data`, `area: sync`, `area: brand`, `area: i18n`, `area: pwa`
5. **Special** (as needed): `security`, `auth`, `privacy`
6. **Status**: Apply `ready-for-testing` when implementation is complete and ready for review

## Notes for AI Assistants

- This is a Phase 1 MVP - prioritize core functionality
- All data operations go through Pinia stores -> IndexedDB repositories
- Use existing UI components from `src/components/ui/`
- Follow Vue 3 Composition API patterns
- Maintain TypeScript type safety
- Use Tailwind CSS for styling
- Test changes with `npm run dev`
