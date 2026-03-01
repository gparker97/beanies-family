# Plan: Fix Google Drive File Discovery Failures

> Date: 2026-03-01
> Related issues: #109

## Context

After authorizing Google Drive access from the welcome gate, the app intermittently reports "no .beanpod files found" even though the file exists in the `beanies.family` folder on the authorized Drive account. The root cause is that `getOrCreateAppFolder()` creates duplicate empty folders when the Drive API search returns 0 results due to eventual consistency, and there is no retry, fallback, or cache invalidation logic.

## Root Cause

`driveService.ts:getOrCreateAppFolder()` searches for a folder named `beanies.family`. If the search returns 0 results (transient API issue, `drive.file` scope issue, eventual consistency), it immediately creates a **new empty folder**. `listBeanpodFiles()` then searches in this empty folder and returns nothing. The module-level `cachedFolderId` locks the session to the wrong folder.

## Approach

### Phase 1: Robust folder discovery (critical)

1. **Retry folder search before creating** — retry once with 1s delay before creating a new folder
2. **Detect duplicate folders** — if multiple `beanies.family` folders exist, pick the one with files
3. **Fallback Drive-wide file search** — if folder-based search returns empty, search all Drive for `.beanpod` files
4. **Cache invalidation** — clear `cachedFolderId` and retry when `listBeanpodFiles` returns empty

### Phase 2: Resilience improvements

5. **Persist folder ID** — store in localStorage (keyed by account email) alongside OAuth token
6. **Diagnostic logging** — add `console.debug` throughout the discovery chain
7. **Fix `read()` 401 handling** — add `attemptSilentRefresh()` before interactive popup (consistent with `write()`)

### Phase 3: UX improvements

8. **Better error messaging** — show authorized account email, retry/switch account buttons
9. **Auto-retry on welcome gate** — retry once with cleared cache before showing "no files found"

## Files affected

- `src/services/google/driveService.ts` — retry logic, duplicate detection, fallback search, folder cache persistence, logging
- `src/services/google/googleAuth.ts` — diagnostic logging for token acquisition
- `src/services/sync/providers/googleDriveProvider.ts` — fix `read()` 401 handling
- `src/stores/syncStore.ts` — cache invalidation on empty results, auto-retry
- `src/components/login/LoadPodView.vue` — better error UX with retry/switch account buttons
- `src/components/google/GoogleDriveFilePicker.vue` — empty state with diagnostic info
- `src/services/translation/uiStrings.ts` — new error/diagnostic strings
