# Plan: Automerge Migration Cleanup & Documentation (#116)

> Date: 2026-03-04
> Related issues: #116, Epic #119

## Context

Issues #110-#115 completed the Automerge CRDT migration — data layer, family key encryption, OAuth PKCE, auth flows, and UI. This issue is the final cleanup: remove all residual dead code (including legacy migration — no backward compatibility to pre-V4 formats is needed), update documentation to reflect the new architecture, and create ADRs for the three major decisions.

## Approach

### 1. Dead Code Cleanup

- Removed 6 orphaned V3 types from `src/types/models.ts` (SyncOperation, EntityType, SyncQueueItem, DeletionTombstone, SYNC_FILE_VERSION, SyncFileData)
- Deleted `src/services/migration/legacyMigration.ts` and its directory
- Removed imports/calls from `App.vue`, `database.ts`, `fileHandleStore.ts`
- Removed `encryptSyncData()`/`decryptSyncData()` wrappers from `encryption.ts`
- Kept `detectFileVersion()` — still actively used in syncStore and syncService
- Fixed broken `ExportedData` import in `e2e/helpers/indexeddb.ts` (defined locally)
- Cleaned up stale `sessionPassword` comment reference in `syncStore.ts`

### 2. Documentation Updates

- Rewrote `docs/ARCHITECTURE.md` for Automerge-first architecture
- Updated `CLAUDE.md` technology stack, key implementation details, and AI assistant notes
- Updated `docs/STATUS.md` to mark #116 complete
- Updated `docs/SECURITY_GUIDE.md` passkey section for family key model

### 3. ADR Work

- Added supersession notes to ADRs 001, 009, 011, 014, 015, 017
- Created ADR-018 (Automerge CRDT Migration)
- Created ADR-019 (Family Key Encryption)
- Created ADR-020 (OAuth PKCE Migration)

## Files affected

**Deleted:** `src/services/migration/legacyMigration.ts`

**Modified:** `src/types/models.ts`, `src/App.vue`, `src/services/indexeddb/database.ts`, `src/services/sync/fileHandleStore.ts`, `src/services/crypto/encryption.ts`, `src/stores/syncStore.ts`, `e2e/helpers/indexeddb.ts`, `docs/ARCHITECTURE.md`, `CLAUDE.md`, `docs/STATUS.md`, `docs/SECURITY_GUIDE.md`, 6 existing ADRs

**Created:** `docs/adr/018-automerge-crdt-migration.md`, `docs/adr/019-family-key-encryption.md`, `docs/adr/020-oauth-pkce-migration.md`
