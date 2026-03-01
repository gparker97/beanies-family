# Plan: Fix Google Drive Silent Reconnection Failures

> Date: 2026-03-01

## Context

After loading the app the next morning (expired token, no re-login), the user gets a reconnect toast but clicking "Reconnect" does nothing. The console shows repeated 404 errors from `driveService.ts:172` (the `driveRequest` fetch call). The red save-failure banner never appears despite persistent failures. Three interrelated bugs cause this:

1. **404 errors are silently swallowed** — `getFileModifiedTime()` in driveService.ts has a catch-all that returns `null`, and `GoogleDriveProvider.getLastModified()` only re-throws 401, swallowing 404.
2. **The reconnect toast shows the wrong message** — `loadFromFile()` shows "Google session expired" for ANY Drive failure, including file-not-found.
3. **Save failure banner never triggers** — The banner requires 3 consecutive failures, but polling 404s are swallowed and never feed into failure tracking.
4. **Token in sessionStorage** — Cleared on tab close, forcing unnecessary silent refresh or popup on every new tab.

## Approach

1. Remove try/catch from `getFileModifiedTime()` so errors propagate
2. Re-throw 404 alongside 401 in `GoogleDriveProvider.getLastModified()` and `write()`
3. Add `driveFileNotFound` state to syncStore; handle 404 in `loadFromFile`, `reloadIfFileChanged`, `handleGoogleReconnected`
4. Surface `fileNotFound` from `syncService.loadAndImport()` return value
5. Update UI: error feedback on reconnect toast, file-not-found variant on save failure banner
6. Move OAuth token from sessionStorage to localStorage
7. Add translation strings for new UI states

## Files affected

| File                                                 | Change                                                                 |
| ---------------------------------------------------- | ---------------------------------------------------------------------- |
| `src/services/google/driveService.ts`                | Remove try/catch from `getFileModifiedTime()`                          |
| `src/services/sync/providers/googleDriveProvider.ts` | Re-throw 404 in `getLastModified()` and `write()`                      |
| `src/services/sync/syncService.ts`                   | Surface `fileNotFound` in `loadAndImport()` return                     |
| `src/stores/syncStore.ts`                            | Add `driveFileNotFound` state; handle 404 in load/poll/reconnect paths |
| `src/components/google/GoogleReconnectToast.vue`     | Add error feedback on failed reconnect                                 |
| `src/components/google/SaveFailureBanner.vue`        | Accept `fileNotFound` prop; show file-not-found UI variant             |
| `src/App.vue`                                        | Pass `driveFileNotFound` prop to `SaveFailureBanner`                   |
| `src/services/google/googleAuth.ts`                  | `sessionStorage` → `localStorage`                                      |
| `src/services/translation/uiStrings.ts`              | Add 4 new strings                                                      |
