# ADR-002: File-Based Sync via File System Access API

**Status:** Accepted
**Date:** Early development (see commit "Fix auto-sync bug and add conflict detection")

## Context

Users need a way to back up data and sync between devices without relying on a cloud service. The original plan included Google Drive encrypted sync, but a simpler local-file approach was implemented first.

## Decision

Use the **File System Access API** to read/write a local `.beanpod` file (JSON format) as the sync target. This allows users to place the file in a cloud-synced folder (Google Drive, Dropbox, OneDrive) for cross-device sync without the app needing OAuth or API integrations.

### Implementation Details

- **Sync service**: `src/services/sync/syncService.ts` — coordinates save/load operations
- **File operations**: `src/services/sync/fileSync.ts` — creates/validates/imports sync data
- **File handle persistence**: `src/services/sync/fileHandleStore.ts` — stores the `FileSystemFileHandle` in a separate IndexedDB database so the file can be re-accessed across browser sessions
- **Capability detection**: `src/services/sync/capabilities.ts` — checks browser support
- **Sync file format**: Versioned JSON with `.beanpod` extension (currently `2.0`) containing all entity data
- **Auto-sync**: Debounced saves (2-second delay) triggered by data changes
- **Encryption**: Optional AES-GCM encryption of the data section (see ADR-003)

### Sync Strategy

The sync uses a **full replace** model — on import, all local data is cleared and replaced with the file contents. This is simple and avoids complex merge logic but means the file always wins.

### Browser Support

- **Full support**: Chrome, Edge (File System Access API)
- **Fallback**: All browsers support manual export/import via blob download and file input

## Consequences

### Positive

- No cloud service dependency or API keys needed
- User controls where the file lives (can use any cloud storage)
- Simple implementation — no conflict resolution complexity
- Works with existing cloud sync solutions (Google Drive, Dropbox, etc.)

### Negative

- File System Access API is Chromium-only (no Firefox/Safari support for persistent handles)
- Full-replace strategy can lose data if two devices edit simultaneously
- User must grant permission each browser session (File System Access API requirement)
- No real-time sync — relies on cloud folder sync timing
