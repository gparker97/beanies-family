# Plan: Fix Google Drive Sync Reliability

> Date: 2026-02-28
> Related issues: N/A (proactive reliability improvement)

## Context

Google Drive sync has critical reliability issues causing silent data loss:

1. Silent save failures (triggerDebouncedSave catches errors with .catch(console.warn))
2. Excessive reconnection prompts (no silent token refresh attempt)
3. Dismissable reconnect toast (users can ignore auth failures)
4. Token lost on tab close (sessionStorage only)
5. Polling masks 401 errors (bare catch in getLastModified)

## Approach

10-phase implementation:

1. Silent token refresh in googleAuth.ts
2. Save failure tracking in syncService.ts
3. Provider hardening in googleDriveProvider.ts
4. Store wiring in syncStore.ts
5. Persistent SaveFailureBanner.vue (non-dismissable)
6. Remove dismiss from GoogleReconnectToast.vue
7. Enhance SyncStatusIndicator.vue with warning state
8. Persist offline queue to sessionStorage
9. Translation strings
10. Wire banner in App.vue

## Files affected

**Create (1):**

- `src/components/google/SaveFailureBanner.vue`

**Modify (9):**

- `src/services/google/googleAuth.ts`
- `src/services/sync/syncService.ts`
- `src/services/sync/providers/googleDriveProvider.ts`
- `src/stores/syncStore.ts`
- `src/services/sync/offlineQueue.ts`
- `src/components/google/GoogleReconnectToast.vue`
- `src/components/common/SyncStatusIndicator.vue`
- `src/services/translation/uiStrings.ts`
- `src/App.vue`
