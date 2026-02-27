# ADR-011: File-First Architecture

## Status

Accepted

## Date

2026-02-18

## Context

The app previously treated IndexedDB as the primary data store with optional file sync. This created a mental model where data lived "in the browser" with an optional backup to a file. Users had to explicitly configure sync, enable auto-sync, and manage encryption as separate concerns.

This model had several drawbacks:

- Data felt ephemeral and browser-dependent
- The security value proposition was unclear — users didn't understand where their data lived
- Multiple toggles (sync enabled, auto-sync, encryption) created unnecessary complexity
- IndexedDB data could persist across sessions, creating stale data risks in multi-family scenarios

## Decision

Shift from IndexedDB-primary to **file-primary** architecture:

1. **The encrypted data file is the source of truth.** All data lives in a user-controlled file on their local filesystem.
2. **IndexedDB is a temporary cache.** It's populated from the file on app start and deleted on sign-out.
3. **Encryption is enabled by default.** New data files are encrypted with a user-chosen password.
4. **Auto-sync is always on.** When a file is configured and accessible, changes save automatically.
5. **Setup requires file creation.** New users must create (or load) a data file during onboarding.

### Key changes

- `deleteFamilyDatabase()` called on sign-out to remove the IndexedDB cache
- All Pinia data stores expose `resetState()` for clean sign-out
- `loadFamilyData()` in App.vue prioritizes loading from file over IndexedDB
- Setup wizard adds Step 3: "Secure Your Data" with file creation and encryption password
- Settings renames "File Sync" to "Family Data Options" and removes Sync Now, Disconnect, and Auto-sync toggle
- SyncStatusIndicator uses "Saving..." / "Data saved to..." terminology instead of "Syncing..."

### Terminology

| Old                  | New                          |
| -------------------- | ---------------------------- |
| Sync file            | Data file / Family data file |
| File Sync (settings) | Family Data Options          |
| Sync Now             | _(removed — auto-save)_      |
| Syncing...           | Saving...                    |
| Synced to [file]     | Data saved to [file]         |
| Auto-sync toggle     | _(removed — always on)_      |
| Disconnect           | _(removed from UI)_          |

### Cross-device sync (updated 2026-02-27)

When the file is modified externally (another device), the app detects the change via polling and performs a **record-level merge** (see [ADR-017](017-record-level-merge-sync.md)) instead of full-replace import. This preserves unique records from both local and remote. Initial loads (empty local) still use full replace. The file format is v3.0 with a `data.deletions` tombstone array to propagate deletions across devices.

## Consequences

### Positive

- **Stronger security narrative:** Users understand their data is encrypted in a file they control
- **Simpler UX:** Fewer toggles and settings to manage
- **Clean sessions:** No stale data across sign-outs or family switches
- **Cloud backup by composition:** Users can place their data file in Google Drive, Dropbox, etc.
- **True multi-device sync:** Record-level merge prevents data loss from concurrent edits

### Negative

- **Requires File System Access API** for the full experience (Chrome/Edge). Firefox/Safari users get a manual download/upload fallback.
- **Password entry on each session** when encryption is enabled. The password is held in memory during the session for auto-save.
- **Stale file handle risk:** If the file is moved or permissions are revoked, the app falls back to the IndexedDB cache with a warning.

### Migration

Existing users with IndexedDB data but no file configured will continue to work normally. The setup wizard's Step 3 will prompt them to create a data file when they next go through setup. Their existing data is preserved until the first file save completes.
