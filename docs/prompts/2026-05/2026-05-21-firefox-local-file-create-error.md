---
date: 2026-05-21
category: bug
issue: null
plan: none
tags:
  [
    onboarding,
    create-pod,
    local-file,
    firefox,
    safari,
    file-system-access,
    error-messaging,
    capabilities,
  ]
---

# Firefox local-file family creation fails with a useless error

## Prompts

**[~12:3x]** There's an issue creating a family using a local file on Firefox (reported by a user who found us via the local-first newsletter feature this week; replicated). In the setup wizard, choosing the local-file option just gives "failed to create file. please try again." The main problems: (a) the error gives the user no useful information, and (b) trying again returns the same result. What can we do to either fix this or provide useful information to the user?

**[approval]** Chose "Clear error + steer to Drive" over building a Firefox download-based local-file fallback.

**[follow-up]** Let's revisit the local-file copy to make sure it's accurate (re: the `storage.localFileBestOnDesktop` inaccuracy flagged in the fix above).

## Outcome

Implemented on `main` (not yet deployed).

**Root cause:** Firefox/Safari don't implement the File System Access API (`window.showSaveFilePicker`) — it's Chromium-only. `syncService.selectSyncFile()` guards on `supportsFileSystemAccess()` and returns `false` in Firefox (no picker opens). `connectLocalStorage()` then mapped that `false` to `{ status: 'failed', cancelled: true }`, conflating "this browser can't" with "user dismissed the picker" — so both `CreatePodView` and `ResumePodSetup` showed the generic `setup.fileCreateFailed` ("Failed to create file. Please try again."), and a retry re-ran the same capability check → identical result.

**Why not make local files work in Firefox:** the File System Access API is the only one that yields a persistent writable handle, which the silent auto-save model depends on. Firefox's only alternatives (Blob download + `<input type=file>`) need a user gesture every save and would break auto-save / the local-first model. Google Drive sync already works fine in Firefox (fetch + OAuth, no FSA), so the right move is a clear message that steers there.

**Fix:** `connectStorage.ts` now detects `!supportsFileSystemAccess()` up front and returns a first-class `errorKind: 'unsupported-browser'` (not `cancelled`) — single shared helper, so both the create-pod wizard and resume-setup benefit. Both view handlers special-case it and show a new actionable string `setup.localFileUnsupported`: "This browser can't save to a local file. Use Google Drive instead (it works here and syncs to your family), or open beanies.family in Chrome or Edge." No Slack error report for a known browser gap (console.warn only). Respects the no-predictive-warnings rule — the local-file button isn't UA-sniffed/pre-disabled; the message surfaces at the (instant) point of attempt.

**Verification:** new `connectStorage.test.ts` (4 tests: unsupported-browser vs cancel vs connected vs thrown-error classification, and "never opens the picker when unsupported") green; zh translation regenerated via `npm run translate`; `npm run type-check` + eslint clean; full suite **2535 passed**.

**Copy-accuracy follow-up (done):** the warning-modal string `storage.localFileBestOnDesktop` ("On phones, or in Safari and Firefox, you'll re-pick the file every time…") wrongly implied local files work-but-degraded in those browsers — they're fully unsupported. Rewritten to "Local files only work in Chrome or Edge on a computer. On a phone, or in Safari or Firefox, choose Google Drive instead." (shown in `LocalFileSyncWarning.vue:48` to all users, so it now sets accurate expectations before the hard block). Audited the rest of the local-file copy (`storage.localFileWarning*`, `loginV6.storageLocalDesc`, `loginV6.localFileCardDesc`, `setup.localFileUnsupported`) — all accurate; the card descriptions stay neutral (no pre-warn) per the no-predictive-warnings rule. zh regenerated; `LocalFileSyncWarning.test.ts` (5) + type-check green. Key name kept (`…BestOnDesktop` still fits) to avoid touching the component/test.

**Parallel gap — investigated, then handled (block, per greg's call):** my initial note assumed the _load_ picker was broken in Firefox the same way create was. Investigation corrected that: the load path already has a deliberate fallback (`openAndLoadFile` → `openAndLoadFileFallback` → `openFilePicker`, a plain `<input type=file>`) that _reads_ a `.beanpod` fine in Firefox/Safari. The real asymmetry is that there's no writable handle afterward, so a loaded file can't auto-save back, and nothing in the UI says so (only `manualExport` in Settings) — a silent dead-end, not a picker bug. Presented three options (warn+keep-read / block / leave); greg chose **block**, for consistency with create. Implemented as a capability guard at the onboarding entry `LoadPodView.handleLoadFile()`: `if (!supportsFileSystemAccess()) { formError = t('auth.localFileUnsupported'); return; }` — steers to Drive / Chrome / Edge before opening anything. Scoped to onboarding only; Settings → manual import (which shares `loadFromNewFile`/`openAndLoadFile`) keeps its fallback for advanced recovery. New string `auth.localFileUnsupported` (+ zh). Note: `LoadPodView` has no unit-test harness in this repo (like the other big onboarding views), so verified via type-check + eslint + full suite (2535) — needs a manual Firefox eyeball on the welcome → "local file" → Load path.
