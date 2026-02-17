# ADR-009: Per-Family Database Architecture (Multi-Tenancy)

**Status:** Accepted
**Date:** 2026-02-17

## Context

The application needs to support multiple families (multi-tenancy) on the same device. Each family's financial data must be completely isolated. This is a prerequisite for adding user authentication — once users log in, they need to be directed to the correct family's data.

Two approaches were considered:

1. **Single database with `familyId` on every entity** — requires schema changes to all models, filtering on every query, a DB version bump, and migration of all existing data.
2. **Separate IndexedDB database per family** — each family gets its own database with the same schema, plus a shared registry database for cross-family metadata.

## Decision

Use **per-family IndexedDB databases** with a shared **registry database**.

### Registry Database

- **Name:** `gp-finance-registry`
- **Implementation:** `src/services/indexeddb/registryDatabase.ts`
- **Stores:**
  - `families` — Family entities (`id`, `name`, `createdAt`, `updatedAt`)
  - `userFamilyMappings` — Links users to families (`email`, `familyId`, `familyRole`, `memberId`)
  - `cachedSessions` — Cached auth tokens for offline access
  - `globalSettings` — Device-level settings (theme, language, exchange rates, last active family)

### Per-Family Databases

- **Name pattern:** `gp-family-finance-{familyId}`
- **Schema:** Identical to the original `gp-family-finance` database (version 3)
- **Stores:** familyMembers, accounts, transactions, assets, goals, recurringItems, settings, syncQueue, translations

### Key Implementation Details

- `src/services/indexeddb/database.ts` — `setActiveFamily(familyId)` sets the current family, `getDatabase()` returns the active family's DB. Throws if no family is active.
- `src/services/familyContext.ts` — Orchestrates family activation, creation, and lookup via the registry.
- `src/stores/familyContextStore.ts` — Pinia store exposing `activeFamily`, `allFamilies`, `switchFamily()`, `createFamily()`.
- All 7 repository files (`accountRepository.ts`, `familyMemberRepository.ts`, etc.) call `getDatabase()` and require **zero changes** — multi-tenancy is invisible to the data layer.

### Settings Split

- **Global settings** (registry DB): theme, language, exchange rates, auto-update preference — shared across families on the same device.
- **Per-family settings** (family DB): base currency, sync config, AI settings — specific to each family.
- `settingsStore.ts` manages both, with computeds reading from the appropriate source.

### Sync File Changes

- Sync file format updated to v2.0: adds optional `familyId` and `familyName` fields.
- v1.0 files remain importable (backward compatible).
- File handle persistence keyed by family: `syncFile-{familyId}` (with fallback to legacy `syncFile` key).

### Legacy Migration

- `src/services/migration/legacyMigration.ts` detects the old `gp-family-finance` database.
- Migration creates a default family, copies all data to a new per-family DB, extracts global settings to the registry, and marks the old DB as migrated.
- Existing users experience zero disruption — migration is automatic on first launch.

## Consequences

### Positive

- **Zero repository changes** — all existing data access code works unmodified
- **Complete data isolation** — no risk of cross-family data leaks
- **Simple mental model** — each family is a self-contained database
- **Easy deletion** — removing a family means deleting one IndexedDB database
- **No schema migration** — per-family DBs use the same version 3 schema
- **Backward compatible** — legacy single-family users are migrated seamlessly

### Negative

- Multiple databases consume more storage than a single database (minor — IndexedDB is generous)
- Switching families requires closing and opening a different database connection
- Global settings and per-family settings must be kept in sync (e.g., exchange rates)
- Registry database adds a coordination layer that must be maintained
