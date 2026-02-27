# ADR-017: Record-Level Merge Sync

**Status:** Accepted
**Date:** 2026-02-27
**Supersedes:** Full-replace strategy from ADR-002, ADR-011

## Context

Cross-device sync uses a shared `.beanpod` file (local filesystem or Google Drive) as the source of truth. The original design used full-replace import: when a device detects a newer file, it loads the entire file and overwrites all local data. This caused "sync drift" — records created on one device were silently lost when the other device overwrote the file with its own data.

Six bugs were identified in the sync pipeline:

1. `reloadIfFileChanged()` flushed a local save _before_ reading the newer remote file, overwriting remote changes
2. `lastSync` wasn't updated after saves, causing spurious reload cycles
3. Visibility handler fired redundant double saves
4. `canAutoSync()` only returned true for File System Access API, disabling auto-sync on Firefox/Safari/Google Drive
5. `beforeunload` called async save that browsers may terminate
6. Full-replace import with no merge — the core cause of data loss

## Decision

Replace full-replace import with record-level merge for cross-device reload paths.

### Merge algorithm

For each entity type (accounts, transactions, todos, etc.):

- Union all record IDs from local and file
- For each ID:
  - If a deletion tombstone exists and is newer than both copies → skip (stay deleted)
  - If both sides have the record → keep the one with the newer `updatedAt`
  - If only one side has it → keep it (added on that device)
- Settings: singleton last-write-wins by `updatedAt`

### Deletion tombstones

Without tracking deletions, merge would re-add records that were deliberately deleted on another device.

- `DeletionTombstone`: `{ id, entityType, deletedAt }`
- Stored in-memory (Pinia store), persisted in the `.beanpod` file's `data.deletions` array
- Each store's delete action records a tombstone
- Tombstones from both sides are merged (newest per ID), pruned after 30 days

### File format

- Version bumped to `3.0` (from `2.0`)
- `data.deletions: DeletionTombstone[]` — required field
- No backward compatibility with v2.0 — clean break, no production data to migrate

### When merge vs. full-replace

- **Merge** (`{ merge: true }`): polling and visibility-change reload paths (cross-device sync)
- **Full replace** (default): initial load, file picker, drag-and-drop, Google Drive first load

## Consequences

- Enables true multi-device collaboration without data loss
- Adds ~150 lines of merge logic (`mergeService.ts`) with unit tests
- File format version bump requires users to re-create their data file if upgrading from v2.0
- 30-day tombstone pruning means very old deletions may resurface if a device was offline for >30 days (acceptable trade-off)
