# Plan: Folder-scoped Drive Picker for photo access

> Date: 2026-04-20
> Context: today's session surfaced that joined family members can see photo metadata in the app but 404 on every photo when fetching via Drive API. Diagnosis traced to the `drive.file` OAuth scope — joiners picked the `.beanpod` file via Picker, granting app-level API access only to that one file. Folder-sharing at the Drive level gives them drive.google.com visibility but not API access to siblings under `drive.file`. Picking the **folder** via Picker instead grants `drive.file` access to the folder and all descendants in one shot.

## What already exists — reused directly

| Need                                                                  | Existing helper                                                     | Reuse action                                                                                                            |
| --------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 404/403 detection in Drive calls                                      | `DriveFileNotFoundError` thrown by `driveRequest`                   | Already plumbed end-to-end; used as trigger                                                                             |
| Track broken photos reactively                                        | `unresolvedIds` + `markUnresolved` + `isUnresolved` in `photoStore` | Add one-liner `hasBrokenPhotos = computed(() => unresolvedIds.value.size > 0)`                                          |
| One-time dismissable notice, safe-on-storage-failure                  | `noticeFlag(key)` in `src/utils/notice.ts`                          | Gate banner with `noticeFlag('photoAccessRecovery')`                                                                    |
| Picker script/library load (idempotent)                               | `loadPickerScript` + `loadPickerLibrary` in `drivePicker.ts`        | Reused by new folder Picker function                                                                                    |
| Banner chrome (fixed-top, severity colour, transition, icon, actions) | `SaveFailureBanner.vue` has this layout baked in                    | **Extract** `<ErrorBanner>` with slots so both `SaveFailureBanner` and the new recovery banner share one implementation |
| Error toasts with CTA/console-pair convention                         | `useToast`                                                          | Used for every error branch                                                                                             |
| Photo uploader attribution                                            | `createdBy?: UUID` already on `PhotoAttachment`                     | No new field needed — recovery flow is idempotent so we don't need to distinguish "someone else's photo" vs "mine"      |

**NOT duplicating**: `listBeanpodFiles` in `driveService.ts` has a global-fallback side behaviour the recovery flow must _not_ inherit (it would return a beanpod from a different folder). Add a focused sibling — `findBeanpodInFolder` — that does strict in-folder lookup only.

## Approach

### 1. `<ErrorBanner>` shared chrome

Extracted from `SaveFailureBanner.vue`. Props: `show: boolean`, `severity: 'critical' | 'warning'`. Named slots: `#title`, `#message`, `#actions`. Layout, transitions, positioning, icon, dark-mode live here. Both banners (existing + new) become thin wrappers.

### 2. `pickBeanpodFolder(token)` in `drivePicker.ts`

Sibling of `pickBeanpodFile`. Same Picker infra, different view config:

- `DocsView` set to folder mime type, `setIncludeFolders(true)`, `setSelectFolderEnabled(true)`, name-hint `beanies.family`.
- Two views: Shared-with-me (primary, matches join case) + My Drive (owner case).
- Returns `{ folderId, folderName } | null` — `null` = user cancelled, not an error.

### 3. `findBeanpodInFolder(token, folderId)` in `driveService.ts`

Strict in-folder query for files with `.beanpod` suffix. Returns `{ fileId, fileName }`. Throws new typed `NoBeanpodInFolderError` for empty/wrong folder — caller converts to a user-visible toast with specific copy.

### 4. `useRecoverPhotoAccess()` composable

One function — `reconnect()`. Orchestrates: `pickBeanpodFolder` → `findBeanpodInFolder` → `fileId === syncStore.driveFileId` check → invalidate photoStore caches → clear unresolvedIds → success toast. Exported as composable so Settings can add a manual "Reconnect photos" action later without duplication.

### 5. `PhotoAccessRecoveryBanner.vue`

Uses `<ErrorBanner severity="warning">` + `photoStore.hasBrokenPhotos` + `noticeFlag('photoAccessRecovery')` + `useRecoverPhotoAccess()`. Mounted in `App.vue` near `SaveFailureBanner`.

### 6. `JoinPodView.vue` — call-site swap

Replace `pickBeanpodFile` → `pickBeanpodFolder` + `findBeanpodInFolder`. Error branches map to toasts. No structural change to the surrounding join logic.

### 7. `photoStore.ts`

Two additions:

- `hasBrokenPhotos = computed(() => unresolvedIds.value.size > 0)` (reactive trigger).
- `clearUnresolved()` — clears the Set + invalidates all thumb/blob caches. Called by the recovery composable on success.

### 8. Copy + docs

- Strings in `uiStrings.ts` for banner, toasts, CTA.
- ADR-021 gets a "`drive.file` scope implications" section.

## Error surfaces — every failure is visible

| Branch                                                 | User                                                                                        | Developer                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Picker script fails to load                            | Error toast: "Couldn't open Google Drive. Check your connection and try again."             | `console.error('[drivePicker] script load failed', e)`                  |
| User cancels Picker                                    | no-op — valid action                                                                        | `console.debug('[drivePicker] cancelled')`                              |
| Picked folder empty / no `.beanpod`                    | Error toast: "This folder doesn't contain a beanies.family pod. Pick your family's folder." | `console.warn('[recover] no beanpod in picked folder', { folderId })`   |
| `.beanpod` found but file ID ≠ current pod's           | Error toast: "That's a different family's pod. Pick your {familyName} folder."              | `console.warn('[recover] beanpod mismatch', { found, expected })`       |
| Drive 403 on folder listing (bad token, revoked, etc.) | Existing `GoogleReconnectToast` fires via normal token-refresh path                         | `console.error('[recover] drive call failed', e)`                       |
| Recovery succeeds but some photos still unresolved     | Warning toast: "Reconnected, but some photos are missing. They may have been deleted."      | `console.warn('[recover] still unresolved after grant', { remaining })` |
| `localStorage` unavailable (private mode)              | Banner shows every session — acceptable degradation                                         | Already handled inside `noticeFlag`                                     |

## Files affected

| File                                                        | Change                                                 |
| ----------------------------------------------------------- | ------------------------------------------------------ |
| `src/components/common/ErrorBanner.vue` (new)               | Shared banner chrome with slots                        |
| `src/components/google/SaveFailureBanner.vue`               | Refactor to use `<ErrorBanner>` (no public API change) |
| `src/components/common/PhotoAccessRecoveryBanner.vue` (new) | Uses `<ErrorBanner>` + composable + `noticeFlag`       |
| `src/services/google/drivePicker.ts`                        | Add `pickBeanpodFolder()`                              |
| `src/services/google/driveService.ts`                       | Add `findBeanpodInFolder` + `NoBeanpodInFolderError`   |
| `src/components/login/JoinPodView.vue`                      | Call-site swap + error branches                        |
| `src/stores/photoStore.ts`                                  | `hasBrokenPhotos` computed + `clearUnresolved`         |
| `src/composables/useRecoverPhotoAccess.ts` (new)            | Orchestrator                                           |
| `src/services/translation/uiStrings.ts`                     | New keys                                               |
| `src/App.vue`                                               | Mount `PhotoAccessRecoveryBanner`                      |
| `docs/adr/021-photo-storage.md`                             | `drive.file` scope section                             |

## Testing

- Unit: `findBeanpodInFolder` — empty folder, one beanpod, multiple beanpods (first wins), drive 403.
- Unit: `useRecoverPhotoAccess` — each error branch surfaces toast + console; success branch clears state.
- Unit: `hasBrokenPhotos` reactivity.
- Unit: `<ErrorBanner>` slot rendering + severity styles.
- Regression: `SaveFailureBanner` existing test still passes after the refactor.
- Manual: family member's broken state → banner → Reconnect → Picker → photos render. New-member join on a fresh Google account.

## Rollout

No scope change, no re-consent, no data migration. Existing owners never hit the banner. Joined members see it once, pick the folder, permanent fix. New joiners flow through the new Picker path directly.
