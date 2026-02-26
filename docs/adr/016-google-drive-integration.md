# ADR-016: Google Drive Cloud Storage Integration

**Date:** 2026-02-26
**Status:** Accepted
**Related:** #78, ADR-009 (File-First Architecture)

## Context

The app only supported local filesystem storage via the File System Access API. Users wanted cloud backup and cross-device access without relying on desktop sync clients. Google Drive was chosen as the first cloud backend because it has the largest user base and provides a simple REST API with granular `drive.file` scope.

## Decision

### StorageProvider Abstraction

Introduced a `StorageProvider` interface that abstracts the storage backend. Both `LocalStorageProvider` (wraps `FileSystemFileHandle`) and `GoogleDriveProvider` (wraps Google Drive REST API) implement this interface. The sync engine (`syncService.ts`) is now backend-agnostic.

### Google OAuth via GIS (Implicit Grant)

Uses Google Identity Services (GIS) with the implicit grant flow:

- `drive.file` scope — only files created by the app are accessible
- Access token stored in memory only (never persisted)
- Token expiry triggers a reconnect toast
- No backend server required

### Direct REST API (No SDK)

All Drive API calls use `fetch()` directly — zero bundle impact. The `driveService.ts` module handles all CRUD operations against the Drive v3 REST API.

### Offline Queue

When Google Drive `write()` fails due to network error, the content is queued in memory. On `window.online` event, the queue is flushed. Only the latest save is kept (each is a full file replacement).

### Provider Config Persistence

Provider type and Drive file ID are persisted in IndexedDB alongside the existing file handle store. On app restart, the sync service reads this config to restore the correct provider.

## Consequences

- **Positive:** Users can store `.beanpod` files on Google Drive without installing desktop sync clients
- **Positive:** The abstraction makes it straightforward to add Dropbox, iCloud, or other backends
- **Positive:** No server-side infrastructure needed for Google Drive sync
- **Trade-off:** Google OAuth token expires after ~1 hour; users may see a reconnect prompt during long sessions
- **Trade-off:** The `drive.file` scope means the app can only see files it created — users can't pick arbitrary existing files from their Drive

## Files

### New

- `src/services/sync/storageProvider.ts` — Interface
- `src/services/sync/providers/localProvider.ts` — Local filesystem
- `src/services/sync/providers/googleDriveProvider.ts` — Google Drive
- `src/services/google/googleAuth.ts` — OAuth via GIS
- `src/services/google/driveService.ts` — Drive REST API client
- `src/services/sync/offlineQueue.ts` — Offline save queue
- `src/components/google/GoogleDriveFilePicker.vue` — File selection modal
- `src/components/google/GoogleReconnectToast.vue` — Token expiry prompt

### Modified

- `src/services/sync/syncService.ts` — Refactored to use `StorageProvider`
- `src/services/sync/fileHandleStore.ts` — Added provider config persistence
- `src/services/sync/capabilities.ts` — Added `googleDrive` capability
- `src/stores/syncStore.ts` — Added Drive actions
- `src/components/login/LoadPodView.vue` — Functional Google Drive button
- `src/components/login/CreatePodView.vue` — Functional Google Drive storage option
- `src/App.vue` — GoogleReconnectToast
