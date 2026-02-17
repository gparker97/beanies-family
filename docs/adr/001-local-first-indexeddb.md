# ADR-001: Local-First Architecture with IndexedDB

**Status:** Accepted
**Date:** Project inception

## Context

The application needs to store financial data (accounts, transactions, assets, goals) for a family. Privacy is a primary concern — users should not be required to send their financial data to any server.

## Decision

Use a **local-first architecture** where all data is stored client-side in the browser's IndexedDB. No backend server is required for core functionality.

### Implementation Details

- **Database**: `gp-family-finance` (IndexedDB, currently version 3)
- **Library**: Uses the `idb` library for typed IndexedDB access (`src/services/indexeddb/database.ts`)
- **Repository pattern**: Each entity type has its own repository module in `src/services/indexeddb/repositories/`
- **Data flow**: Vue components → Pinia stores → IndexedDB repositories
- **IDs**: UUIDs generated client-side (`src/utils/id.ts`)

### Note on Native vs. Library

The project initially used native IndexedDB APIs in some paths but standardized on the `idb` library wrapper for type safety and cleaner async/await code. The git history shows a commit "use native IndexedDB APIs instead of importing idb library" which was an exploration — the current codebase uses `idb` for the main database while file handle storage also uses `idb`.

## Consequences

### Positive

- Complete privacy — data never leaves the device unless user opts into sync
- No server costs or infrastructure to maintain
- Works offline by default (with PWA support)
- Fast — no network latency for data operations

### Negative

- Data is tied to the browser/device — need separate sync solution for multi-device
- Browser storage limits apply (typically 50%+ of disk space)
- Database migrations must be handled carefully in `upgrade` callbacks
- No server-side backup — user is responsible for their data
