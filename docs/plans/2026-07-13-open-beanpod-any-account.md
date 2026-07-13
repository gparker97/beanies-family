# Plan: Open a .beanpod from any account (cross-account / restored-backup load)

> Date: 2026-07-13
> Related issues: Notion #47 (High, Bug). Related: Notion #46 (shared familyId / registry clobbering — independent).
> Plan file: `docs/plans/2026-07-13-open-beanpod-any-account.md`
> Mockup: `docs/mockups/beanpod-cross-account-load-2026-07-13.html`
>
> **A note on the `file:line` references below.** All line numbers are planning-time anchors captured 2026-07-13 and _will_ drift. They are evidence, not implementation targets — locate code by **symbol name** (function/const), never by line, when implementing.

## User Story

As a beanies.family user who has restored a backup into a new Google account, switched accounts, or is on a phone, I want to open my own `.beanpod` file regardless of which account created it, so that I always have a way back into my own data — honouring the "you own your file" promise.

## Context

beanies promises "you own your file" — the `.beanpod` is portable, encrypted, and yours. Today there is no working way to open one from an account or platform that didn't create it:

- **The Drive listing is `drive.file`-scoped.** `searchBeanpodFilesGlobal` (`driveService.ts:367`) queries `name contains '.beanpod' and trashed=false`, but under the app's `drive.file` OAuth scope (`googleAuth.ts:31`) `files.list` returns **only files beanies itself created for the signed-in user**. A `.beanpod` uploaded (not app-created) into a different Google account — the classic restore-from-backup case — is invisible to the listing. (The Google **Picker**, by contrast, grants `drive.file` to any file the user explicitly selects, including their own non-app-created and shared files — which is exactly why the invite/join flow uses it.)
- **The local-file option is dishonestly gated.** `LoadPodView.handleLoadFile()` (`LoadPodView.vue:266`) hard-returns `t('auth.localFileUnsupported')` when `supportsFileSystemAccess()` is false. That predicate is true only on Chromium desktop, so on Android WebView, iOS WebKit, Firefox and Safari the local-file tile renders (`~1068`) and then errors on click. Worse, it checks `supportsFileSystemAccess()` rather than `canUseLocalFiles()` — so the shipped `CapacitorFileProvider` and the existing non-FSA `<input type=file>` fallback are never reached from the login flow. This is the un-flipped "A3" state documented at `capabilities.ts:122-126`.

The machinery to fix this already exists but is unreached from `LoadPodView`:

- `syncService.openAndLoadFile()` (`syncService.ts:1036`) **already branches**: FSA path (`showOpenFilePicker` → writable `LocalStorageProvider`) vs. `openAndLoadFileFallback()` (`syncService.ts:1090`, native `<input type=file>` via `openFilePicker()` in `fileSync.ts:249`). The fallback is dead code from `LoadPodView`'s perspective because `handleLoadFile` bails before calling the store. **Verified:** with the gate deleted, `loadFromNewFile` (`syncStore.ts:740`) → `openAndLoadFile` → (native, `!supportsFileSystemAccess()`) → `openAndLoadFileFallback` → `openFilePicker()` is genuinely reached.
- `usePickBeanpodFile()` (`usePickBeanpodFile.ts`) exposes `pick()`, which opens the Google Picker and returns a `PickBeanpodFileResult` discriminated union (`{ picked | cancelled | failed }`) — **never throws**. `pickBeanpodFile()` (`drivePicker.ts:198`) is its engine. This `pick()` is the exact shared primitive the join flow already builds on; it is directly consumable by `LoadPodView` with no new wrapper.
- The decrypt layer **already adopts foreign families**: `decryptPendingFile(password)` (`syncStore.ts:811`) and `decryptPendingFileWithKey(fk)` (`syncStore.ts:1415`, via `createFamilyWithId`/`switchFamily`) both work on an envelope whose `familyId` differs from the active one.

So the fix is a **small, honest rewire of the load entry point** — not new OS-picker or crypto work. The gating that blocks cross-account/restored files today is purely (a) the `supportsFileSystemAccess()` gate in `handleLoadFile` and (b) the missing writable save target after a non-FSA load (**verified a genuine gap — see Approach D**).

**Spike verdict (Notion #47 Open Questions, 2026-07-13):** SMALL REWIRE. Native routes to `<input type=file>` (the Google Picker iframe is fragile-to-broken in iOS WebKit — `drivePicker.ts:170` `reason:'iframe'`; the fix must not depend on it). `<input type=file>` demonstrably works in the native WebView today (`openFilePicker()` in `fileSync.ts`) and reaches OS-exposed cloud providers (Android SAF exposes Drive; iOS Files shows Drive when the Drive app is installed). `CapacitorFileProvider` is ADR-029 on-device-validated (`src/services/sync/providers/capacitorFileProvider.ts`).

## Requirements

1. From the "load an existing family" screen, a user can open a `.beanpod` that the app did **not** create for the signed-in account, on **desktop web, Android and iOS**.
2. The load entry point is gated on **`canUseLocalFiles()`**, never `supportsFileSystemAccess()` — no platform is offered a storage source it cannot service, and none is blocked that it can.
3. Implement the approved UX (refined direction C — see Mockup + `## Approach`): the signed-in Google account is the assumed default (primary "Continue with Google Drive"); opening a saved file is a **quiet aside** ("Load a saved family file") below an "or" divider. The old separate "Google Drive" + "Local File" tiles merge into: one primary account button + one file aside. **The aside is one affordance with a per-platform backend, not a two-control chooser:** on Chromium desktop it opens the local file system (FSA); on Firefox/Safari it opens the Google Picker; on native it opens `<input type=file>`. Chromium desktop therefore serves the _downloaded-backup_ restore case (a local file) but does **not** route to the Picker — a file living only in another Drive account with no local copy is opened on Chromium by downloading it first. (See Approach B/C for the exact branch and the rationale for one control, not two.)
4. Platform-correct backend for the aside, converging on the existing decrypt/adopt flow:
   - **Web (Firefox/Safari, no FSA)**: the Google Picker (`usePickBeanpodFile().pick()` → `loadFromGoogleDrive`) — reaches the signed-in account's own non-app-created + shared files and grants access.
   - **Web (Chromium, FSA available)**: the File System Access picker (writable `LocalStorageProvider`) for a local device file (including a downloaded backup). The Picker is intentionally **not** offered as a second control on Chromium (see Approach B rationale); the cross-account-Drive-only case on Chromium is the download-first case.
   - **Native (iOS/Android)**: `<input type=file>` (`openFilePicker` → `openAndLoadFileFallback`), which reaches local + OS-exposed cloud files. Never the in-WebView Google Picker.
5. A file loaded via the aside must **not become a read-only dead-end.** After decrypt + family adoption, the family must have a working durable save target (its Drive `.beanpod` for the signed-in account, or `CapacitorFileProvider` on native) — this is the concern the original `supportsFileSystemAccess()` gate was protecting against, and it must be resolved, not reintroduced. **This is a verified real gap on the native `<input type=file>` path (see Approach D) and requires explicit code.**
6. A picked file that is a V3 `.beanpod`, a foreign non-`.beanpod`, or corrupt is rejected cleanly with an actionable message (never half-adopted). Wrong password / corrupt payload surfaces the existing decrypt errors.
7. The existing **single-account, same-device** journey is unchanged — one tap on the primary button, no extra step, no re-pick.
8. All new user-visible strings go through `t()`. Add `en` + `beanie` variants in `uiStrings.ts` (that file holds only those two per key) and generate `zh` via `npm run translate`. Label "Load a saved family file"; sub "From another account, or a backup you've restored".

## Important Notes & Caveats

- **The "web Picker → openAndLoadFileFallback" shorthand in the intake is imprecise.** Mechanically: web Picker → `loadFromGoogleDrive` (`syncStore.ts:2250`); native `<input type=file>` → `openAndLoadFileFallback` (`syncService.ts:1090`). **Both converge** on staging `pendingEncryptedFile` → `decryptPendingFile`/`decryptPendingFileWithKey`. The aside is one visual affordance with a platform-branched backend, not one code path.
- **Security — re-home is gated by decrypt, and that is the control.** `establishDurableHomeAfterLoad()` runs **only after a successful decrypt**, and decrypt requires the family password (`tryUnwrapFamilyKey`, `syncStore.ts:834`). A foreign or malicious file the user cannot decrypt is rejected _before_ any re-home, so re-home can never write an undecryptable/unowned family into the user's Drive. The only family that gets re-homed into the signed-in account's Drive is one the user has proven ownership of by supplying its password — the intended, safe "restore into my new account" outcome. No broadened trust boundary is introduced.
- **Re-home vs. read-in-place (design decision — see Assumptions #1).** For the restore-into-a-new-account case the durable home should become the **signed-in account's own Drive** (upload a fresh app-owned `.beanpod`), so the user is no longer dependent on the source file/account. This differs from the _join_ flow, which intentionally keeps reading the inviter's shared Drive file.
- **The Drive-establish reuse target is `configureSyncFileGoogleDrive`, NOT `createNewFile`.** `configureSyncFileGoogleDrive(podFileName)` (`syncStore.ts:2116`) is the exported seam that does `GoogleDriveProvider.createNew → installProvider('google_drive')`. `createNewFile` (`:1165`) is the _wrong_ target: it carries brand-new-family preconditions — owner-member presence (`:1197`), a refusal if the owner still holds the deferred-password sentinel (`:1211`), and an explicit **refusal when the registry already has a pod for the `familyId`** (`:1238`) — all of which misfire for an already-adopted, just-loaded family.
- **Do NOT broaden the OAuth scope.** `drive.file` is a deliberate privacy choice. The Picker's grant-on-pick is the sanctioned cross-account mechanism; nothing here requests broader Drive access.
- **iOS redirect-auth bounce (ADR-026).** On iOS, acquiring a token for the Picker uses full-page redirect (`pick()` already calls `startRedirectAuth`) — but **native iOS uses `<input type=file>`, not the Picker**, so the aside on iOS never triggers a mid-picker redirect. The web Picker's redirect path is unchanged from the join flow's proven behaviour.
- **Registry clobber (Notion #46).** Opening a copied file whose `familyId` already exists in the registry overwrites that row's `fileId`/`displayPath`. That is #46's concern and explicitly out of scope; this plan must not make it worse (it reuses the same `createFamilyWithId`/`switchFamily` path the join flow already uses).
- **Do not touch `useJoinFlow`.** It already uses the Picker correctly via `usePickBeanpodFile().pick()`. This change consumes that **same** primitive independently — it does **not** extract from or modify `useJoinFlow`, and does **not** introduce a shared `useLoadPickedBeanpod` composable (see Approach B for why that seam is net-negative).
- **`useFilePicker` vs `openFilePicker`.** `openFilePicker()` (`fileSync.ts:249`, promise-returning `File | null`) is already routed through the load fallback — reuse it. Do **not** introduce the callback-style `useFilePicker` composable here.

## Assumptions

> **Review these before implementation.** Valid at planning time (2026-07-13); confirm if stale.

1. **Re-home to the signed-in account's Drive is the desired durable outcome** for a cross-account/restored load (vs. permanently reading the foreign file in place). This is the natural "restore into my new account" behaviour and what the acceptance criteria imply. _If greg wants read-in-place instead, the save-target step in Approach D changes._ — **flagged for greg's confirmation.**
2. The user reaching `LoadPodView` via "Sign in" is authenticated with Google (Drive available), so a Drive save target can be established after load. Where Drive is genuinely unavailable (web non-Chromium, no FSA, no re-home target), the load still succeeds read-only and the existing save-failure surfacing (`SaveFailureBanner`) handles the degraded case — no silent dead-end.
3. `openAndLoadFileFallback()` returning no `provider` is acceptable **only because** the durable home is established explicitly after adoption (Approach D). Verified gap: on native the fallback stages `pendingEncryptedFile` with no `provider`/`driveFileId`, and `decryptPendingFile`'s provider branches (`syncStore.ts:884`, `:905`) are both skipped, so **without Approach D the family has no writable home.**
4. `canUseLocalFiles()` (`= supportsFileSystemAccess() || isNative()`) is the correct honesty predicate for whether to show the file aside at all. On web non-Chromium it is currently `false` — see Approach C for how the aside is nonetheless shown for the **web Picker** path (which does not need FSA).
5. **`LoadPodView` is a pre-family login surface reached with no active storage provider** (`syncService.getProvider() === null` on entry). Approach D's idempotent skip depends on this being true. Verified today: the load screen is the not-yet-loaded-a-family state. _If a future refactor ever makes the aside reachable while a different family's provider is live, the idempotency guard must become family-scoped — noted inline so it isn't missed._

## Approach

### A. The load screen (LoadPodView.vue) — approved UX

Reshape the storage-source region (`~1040-1180`) to the mockup:

- **Primary:** "Continue with Google Drive" — the existing signed-in-account Drive path (unchanged listing/flow). Keep the account email + a quiet "Use a different Google account" affordance (existing account-switch behaviour). **This primary path is a separate handler; it does not call the new re-home action** (see Approach B/D).
- **Aside (below an "or" divider):** a single quiet control (`LoginChoiceCard`, hairline border, Sky-Silk icon tint per mockup) labelled **"Load a saved family file"** / sub **"From another account, or a backup you've restored"**. Only rendered when `canOpenSavedFile` is true (see C). Remove the separate full-size "Local File" tile and its FSA-gated drop-zone entry from the primary grid; the drag-drop affordance (Chromium) can remain as a progressive enhancement inside the aside's expanded state **only where `supportsFileSystemAccess()`** (it already degrades correctly via `handleDrop`).
- Keep the "more providers coming soon" disclosure as-is.

### B. The aside handler — platform-branched, converging on decrypt (no new composable)

Replace `handleLoadFile`'s hard bail. New single entry `handleOpenSavedFile()` that dispatches by capability at click time. The dispatch is a **flat three-arm branch with early returns** (guard-clause style) — deliberately _not_ a strategy map or registry: three arms, each 1–3 lines, all converging on the **existing** `handlePendingPassword` / decrypt modal already in `LoadPodView`. Keep it flat:

1. **Native (`isNative()`):** call `syncStore.loadFromNewFile()` — delegates to `openAndLoadFile()` → (non-FSA) `openAndLoadFileFallback()` → `openFilePicker()` `<input type=file>` (verified reachable). On `needsPassword` → `handlePendingPassword(syncStore.fileName, { tryAuto: false })` (mirrors the existing `handleLoadFile` body).
2. **Web with FSA (Chromium):** `syncStore.loadFromNewFile()` → FSA path (writable `LocalStorageProvider` handle) — unchanged behaviour, now reachable for the cross-account/restored **local** device file too. **This arm is deliberately FSA-exclusive: Chromium does not also fall through to the Picker.** Rationale — the aside is one control, not two; the headline aside case (restore-from-backup) is a downloaded local file, which FSA serves natively and writably (no re-home needed). Offering a second Picker control on Chromium would reintroduce the two-tile UX this plan retires, for the narrow subcase of a cross-account file that exists _only_ in another Drive account with no local copy. That subcase on Chromium is served by downloading the file first; the join flow (untouched, Picker-based) already covers genuine _shared_-family access. Requirements 3/4 state this limitation explicitly so it is a conscious trade, not an accident.
3. **Web without FSA (Firefox/Safari):** `const picked = await usePickBeanpodFile().pick({ forceConsent: false, loginHint: <signed-in email> })`. On `picked.kind === 'picked'` → **reuse the existing `handleDriveFileSelected({ fileId, fileName })`** (`LoadPodView.vue:689`), which already runs `loadFromGoogleDrive → handlePendingPassword → formError`. On `'cancelled'` → no-op. On `'failed'` → set `formError` from the mapped message + `logEvent`.

**The re-home step is invoked once, at the end of `handleOpenSavedFile`, after the branch's decrypt resolves successfully — and lives in the store, not here (see Approach D).** After the branch's `handlePendingPassword` / `handleDriveFileSelected` reports a successful decrypt, `handleOpenSavedFile` makes one call — `await syncStore.establishDurableHomeAfterLoad()`. Two facts keep the untouched primary "Continue with Google Drive" path safe: (1) the primary listing button is a **different handler** that never calls `establishDurableHomeAfterLoad`; and (2) even the web Picker branch — which reuses `handleDriveFileSelected` (shared with the primary listing) — is safe because the call site is `handleOpenSavedFile`, not inside `handleDriveFileSelected`/`handlePendingPassword`. The store action is additionally **idempotent / self-skipping** when a provider already exists (web Picker and web FSA paths already installed one).

> **DRY (the intake's `useLoadPickedBeanpod` extraction is net-negative and is dropped):**
>
> - The reusable seam **already exists**: `usePickBeanpodFile().pick()` returns the `{ picked | cancelled | failed }` union and never throws. `LoadPodView` consumes it directly.
> - The picked-result → load handoff **already exists inside `LoadPodView`** as `handleDriveFileSelected` (`:689`) — the web-Picker branch reuses it verbatim.
> - `useJoinFlow.doPickAndLoad` (`useJoinFlow.ts:468`) is **not** shared logic: its bulk is join-specific (`targetFileId`/`targetFileName`, `recordError` against `JoinErrorCode` with per-code severity). The only shared lines are `pick()` then `loadFromGoogleDrive`, both already primitives. Extracting a shared composable would force edits to `useJoinFlow` (contradicting "do not touch") and still leave the error-mapping un-shared. Net-negative — **do not create `useLoadPickedBeanpod.ts`.**

### C. Honest gating

- Show the file aside when `canUseLocalFiles()` **or** the web Picker is available (`features.drive && features.oauthProxy` per `getSyncCapabilities().googleDrive`). The aside is hidden only where _neither_ a local file backend _nor_ the Picker can run — effectively never on a Google-configured build (a signed-in user always has the Picker). Compute once in a `computed` `canOpenSavedFile`.
- Delete the direct `supportsFileSystemAccess()` call at `LoadPodView.vue:266`. If any FSA-specific branch remains (drag-drop enhancement **and** the Chromium arm of Approach B), it uses `supportsFileSystemAccess()` locally with a comment; the _entry gate_ uses `canOpenSavedFile`.

### D. Save target after load (resolves the original gate's concern — VERIFIED GAP, needs code)

After decrypt + family adoption, ensure a durable writable home exists (Requirement 5). The three backends differ:

- **Web Picker path** (`loadFromGoogleDrive`): `decryptPendingFile` sets a `GoogleDriveProvider` from `pending.driveFileId` (`syncStore.ts:884-902`) and persists `storageProviderType='google_drive'`. Correct home (their own Drive). **No extra work.**
- **Web FSA path** (`openAndLoadFile`): returns a writable `LocalStorageProvider` handle in `pending.provider`; `decryptPendingFile` installs it (`:905-910`). **No extra work.**
- **Native `<input type=file>` path** (`openAndLoadFileFallback`): **verified gap.** The fallback returns `{ success:false, needsPassword:true, envelope }` with **no `provider` and no `driveFileId`** (`syncService.ts:1111-1118`), so both provider branches in `decryptPendingFile` (`:884`, `:905`) — and identically in `decryptPendingFileWithKey` (`:1463-1467`) — are skipped. The family is adopted with **no save target**, and no existing post-adoption path re-homes a _loaded_ family. Requirement 5 is violated on this path today and needs explicit code.

  **Where the code lives (load-bearing maintainability decision):** the re-home logic is a **new exported syncStore action**, `establishDurableHomeAfterLoad()`, **not** a helper inside `LoadPodView`. Forced by fact:
  - **`installProvider` is a _private_ function of `syncStore`** (defined `syncStore.ts:441`; verified **absent** from the store's returned/exported object, ~`:2874-2923`). A component helper cannot call it; hand-rolling the install in the component would duplicate the persist → `setProvider` → `syncNow` → `registerCurrentFamily` → token/auto-sync sequence that `installProvider` centralises — exactly the deep-coupling this review exists to prevent.
  - Putting it in the store gives `LoadPodView` **one clean seam** and keeps every storage-provider concern behind the store boundary.

  **`establishDurableHomeAfterLoad()` — behaviour (reuse, don't duplicate).** Idempotent: if `syncService.getProvider()` is already set (web Picker / web FSA), return immediately. Otherwise establish a durable home once, in this precedence:
  1. **Drive connected for the signed-in account** (assumption 2, common case): reuse the **exported `configureSyncFileGoogleDrive(fileName)` seam** (`syncStore.ts:2116`) — `GoogleDriveProvider.createNew → installProvider('google_drive')`. Not `createNewFile` (wrong preconditions), no hand-rolled upload.
  2. **Native, Drive off:** reuse `syncService.selectNativeLocalFile(baseName)` (`syncService.ts:702`, ADR-029) to build+set a `CapacitorFileProvider` at the app-managed path, then `syncNow(true)` to write the first durable copy.
  3. **Neither available:** leave the load successful but provider-less and let `SaveFailureBanner` surface the degraded state (assumption 2) — but emit a `severity:'critical'` `reportError` (data-at-risk) so this is never silent.

  > **Idempotency-guard hardening (fresh-eyes, Pass 4).** The `getProvider() !== null → skip` guard is correct for the two paths that install a provider _within the same decrypt_ (Picker/FSA), and for the native gap path on a fresh `LoadPodView` where `getProvider() === null` (Assumption 5, verified: the native fallback never calls `setProvider`). The guard's implicit precondition is that a non-null provider reflects the **just-loaded** family, not a stale provider from a previously-active family. To keep it robust against future reachability changes, the action should **either** assert Assumption 5 (`getProvider()` is null on the native gap arm) **or**, defensively, gate the skip on the provider actually belonging to the active family rather than mere non-null. Cheap insurance against a silent cross-family clobber. Prefer the family-scoped check if it is a one-liner; otherwise the explicit assertion + this note.

  > **Why in the store and not inside `decryptPendingFile`:** `decryptPendingFile` is shared by the join/Drive paths that already arrive with a provider. Folding re-home into it would risk regressing those paths and entangle two concerns. Keep decrypt pure; make re-home an explicit, separately-testable store action the caller invokes after a successful decrypt.

### E. i18n

New keys in `uiStrings.ts` (`en` + `beanie` only per that file's schema), routed through `t()`; `zh` generated via `npm run translate` + manual review:

- `loginV6.openSavedFileLabel` = "Load a saved family file"
- `loginV6.openSavedFileDesc` = "From another account, or a backup you've restored"
- Reuse `auth.fileLoadFailed` for load failures. **Retire `auth.localFileUnsupported`** — verified its ONLY reference is `LoadPodView.vue:267` (the gate being removed); `setup.localFileUnsupported` is a _separate_ key still used by `CreatePodView.vue:220` and `ResumePodSetup.vue:681`, so leave that one untouched. Remove `auth.localFileUnsupported` (and any stale test) once the login reference is gone.
- Any new failure message (Picker failed / no backend) reuses existing `storage.localFile*` / `googleDrive.*` errors where they fit, else one new actionable key.

## Files Affected

- `src/components/login/LoadPodView.vue` — reshape storage-source UI to the mockup; replace `handleLoadFile` gate with `handleOpenSavedFile` + `canOpenSavedFile` computed; consume `usePickBeanpodFile().pick()` for the web-Picker branch and reuse the existing `handleDriveFileSelected`; call the new `syncStore.establishDurableHomeAfterLoad()` once at the end of `handleOpenSavedFile` after a successful decrypt (never from the primary listing handler); remove the FSA hard-bail; add branch-outcome `logEvent`s. **No storage-provider construction lives here.**
- `src/stores/syncStore.ts` — **add one exported action `establishDurableHomeAfterLoad()`** (idempotent, with the family-scoped/assertion hardening from Approach D; precedence: reuse `configureSyncFileGoogleDrive` → reuse `syncService.selectNativeLocalFile` + `syncNow(true)` → provider-less + `severity:'critical'` `reportError`). Reuses the private `installProvider` via those existing seams; adds no new provider-install logic. Export it in the store's returned object.
- `src/services/translation/uiStrings.ts` — new `loginV6.openSavedFile*` keys (en + beanie); remove `auth.localFileUnsupported` (login-only reference).
- `zh.json` (via `npm run translate` + manual review) — new keys.
- `src/services/sync/capabilities.ts` — **no change** (`canUseLocalFiles` already exists; A3 flag flip out of scope — gate at the call site).
- `docs/mockups/beanpod-cross-account-load-2026-07-13.html` — approved mockup (already committed).
- Tests: `LoadPodView` load-entry + gating tests; a `syncStore.establishDurableHomeAfterLoad` unit test (each precedence arm + the idempotent skip + the stale-provider hardening); a cross-account load integration test.

> No new composable (`useLoadPickedBeanpod` dropped), **no change to `useJoinFlow`**, and no changes to OAuth scope, `driveService.ts`, `drivePicker.ts`, or the decrypt/parse layer. The one genuinely new bit of logic is the store action `establishDurableHomeAfterLoad` (Approach D), which reuses `configureSyncFileGoogleDrive` / `selectNativeLocalFile` rather than duplicating any provider-install sequence.

## Help Center Coverage

- **Action**: `update existing` (and one small `new` if no restore article exists)
- **Category**: `how-it-works` / `security`
- **Slug**: the existing "loading / restoring your family" article (confirm exact slug during implementation); if none covers restore-into-a-new-account, add `how-to` slug `open-a-saved-family-file`
- **Title**: "Open a saved family file (any account or a restored backup)"
- **Scope**: Explain, from the user's side, that a `.beanpod` is portable and can be opened from any account or device via "Load a saved family file" — including after restoring a backup into a new Google account — and that on phones the OS file picker can reach Drive/iCloud files. On a desktop Chromium browser, opening a file from a _different_ Drive account means downloading it first.
- **Notes**: Clarify the file is encrypted and still needs the family password; clarify that opening a restored backup makes the current account's Drive the new home.

## Observability Coverage

New kebab-case surface **`load-existing-family`** (greppable), routed through `logEvent`/`reportError`. **The context allowlist lives in `src/utils/diagnosticContext.ts:61` (`ALLOWED_CONTEXT_KEYS`) — NOT `logEvent.ts`**, and any addition must be mirrored in the Lambda ingest allowlist + its pinned test (the `incr_*` / `cache_persist_*` precedent). **Ship with ZERO new context keys** — reuse existing allowlisted keys only:

- **Decision/outcome events** (`logEvent`, `info`) on each branch so the path is reconstructable blind. **Reuse already-allowlisted keys:** `provider_type` (`'google_drive' | 'local'`) for the backend; `action` for the outcome enum (`'loaded' | 'needs-password' | 'cancelled' | 'rejected-version' | 'rejected-extension' | 'no-backend' | 're-homed'`); `error_code` for the picker reason (`config|load|open|auth|iframe|timeout`) and the rejection reason. Emit on the **success path too** (`action:'loaded'`) so cross-account-open _rates_ are measurable for future alerting.
- **The "was this a cross-account load?" signal folds into free-text `message`**, not a new key: emit on the `action:'loaded'` event as `message: 'cross-account load'` vs `'same-account load'`.
- **Failure events**: Picker `{ kind: 'failed' }` → `reportError` `severity:'warning'` with the reason on `error_code` — firehose only, not a Slack page (the user can retry). A load that reaches decrypt but the family cannot be given any durable save target (Approach D case 3) → `reportError` `severity:'critical'` (data-at-risk) with a clear toast + recovery direction.
- **No new context key ships (`cross_account` dropped).** It is a boolean the `action:'loaded'` event already implies, drives no alert, and is reconstructable from `message`. Adding it would incur the full recurring maintenance tax — `diagnosticContext.ts` allowlist **+** Lambda mirror **+** pinned test **+** the native-store privacy cascade — for zero triage value. Folded into `message`.
- **No silent failures**: every `catch` classifies + logs; the removed silent `formError` bail in `handleLoadFile` is replaced with a logged, user-visible outcome.
- **Privacy/store gate**: **not triggered** — no new context key ships, so the data-collection table and `PrivacyInfo.xcprivacy` / Data-Safety answers are unchanged.

## Acceptance Criteria

- [ ] A `.beanpod` uploaded into a Google account that never created it can be opened from that account on **desktop web (Chromium via a local/downloaded copy; Firefox/Safari via the Picker), Android, and iOS**.
- [ ] No platform presents a storage source it cannot service; the file aside is shown only where a backend exists, and never hard-errors on click.
- [ ] The existing single-account, same-device flow is unchanged (one tap, no extra step, no re-pick); the primary "Continue with Google Drive" handler never invokes `establishDurableHomeAfterLoad`.
- [ ] A loaded cross-account/restored family has a working durable save target afterward (Drive for the signed-in account, or `CapacitorFileProvider` native) — never a read-only dead-end. **Specifically verified on the native `<input type=file>` path**, via `syncStore.establishDurableHomeAfterLoad()`.
- [ ] V3 / foreign-non-beanpod / corrupt files are rejected with an actionable message; wrong password surfaces the existing decrypt error.
- [ ] **On-device validation (baked in):** (1) an iOS user can select a `.beanpod` (unknown extension) via `<input type=file>` from the iOS Files app and load it; (2) an Android user can select a Drive/local `.beanpod` via SAF and load it. _(3, optional) Google Picker iframe in Android WebView / iOS WKWebView only if we ever keep the Picker as a native option — the shipped approach does not depend on it._
- [ ] All new strings are `t()`-routed with `en` + `beanie` in `uiStrings.ts` and generated `zh`.
- [ ] Help Center article(s) added/updated to match shipped behavior.
- [ ] Diagnostic logging in **Observability Coverage** implemented and verified (events fire with the stated `surface`/`context`; failure modes triageable from CloudWatch without a local repro; **no new context key added** — all reuse existing allowlisted keys).

## Testing Plan

1. **Unit — `LoadPodView` gating**: `canOpenSavedFile` true/false per capability matrix (native; web Chromium; web Firefox/Safari with Drive; hypothetical no-Drive-no-FSA build → aside hidden). Assert the removed `supportsFileSystemAccess()` hard-bail no longer fires.
2. **Unit — backend selection**: `handleOpenSavedFile` dispatches native→`loadFromNewFile`, web-Chromium→`loadFromNewFile` (FSA, and asserts it does **not** fall through to `pick()`), web-non-Chromium→`usePickBeanpodFile().pick()` then `handleDriveFileSelected`. Mock capabilities; assert each `pick()` outcome maps to load / no-op / logged-formError. Assert `establishDurableHomeAfterLoad()` is called once after a successful decrypt on every aside branch, and **not** called by the primary listing handler.
3. **Unit — `syncStore.establishDurableHomeAfterLoad`**: idempotent skip when a provider already exists; Drive-connected → delegates to `configureSyncFileGoogleDrive` (provider installed, `google_drive` registered); native Drive-off → `selectNativeLocalFile` + `syncNow(true)` (provider installed, first write happens); neither → provider-less + `severity:'critical'` `reportError`. Assert it never calls `createNewFile`. **Hardening case:** a stale provider from a prior family present at entry does not cause a wrong skip.
4. **Integration — cross-account load (the AC)**: stage a foreign-family V4 envelope; drive it through the fallback/Picker path → `pendingEncryptedFile` set → `decryptPendingFile(pw)` adopts the foreign `familyId` → stores reload → **a durable save target exists** (assert the native-input branch installed a provider via `establishDurableHomeAfterLoad`). Assert data present and same-family invariant.
5. **Integration — rejection**: V3 envelope and a random non-beanpod → clean rejection, actionable error, no partial adoption.
6. **Regression**: existing same-account Drive login unchanged; `useJoinFlow` invite/join path unchanged (its tests stay green — this change does not touch it).
7. **Manual on-device** (greg): iOS Files `.beanpod` select+load; Android SAF Drive `.beanpod` select+load; confirm a save target exists after (edit → reload persists); confirm no extra taps on the normal same-account path.
8. `npm run type-check`, `npm run lint`, full unit suite green; `npm run translate` + zh review.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted from the approved mockup + the code map — honest `canUseLocalFiles()` gating, platform-branched aside (native `<input type=file>` / web FSA / web Picker) converging on the existing decrypt/adopt flow, save-target resolution, DRY reuse of the picker handoff, i18n, and a `load-existing-family` observability surface.
- **Pass 2 (DRY + error handling)**: Dropped the net-negative `useLoadPickedBeanpod` extraction (LoadPodView consumes `usePickBeanpodFile().pick()` + reuses existing `handleDriveFileSelected`; `useJoinFlow` untouched); firmed Approach D with file:line evidence that the native `<input type=file>` path has NO provider post-decrypt; corrected the allowlist location to `diagnosticContext.ts` (+ Lambda mirror) and switched observability to reuse `provider_type`/`action`/`error_code`; scoped `auth.localFileUnsupported` retirement to its single login reference.
- **Pass 3 (Sustainability)**: Moved re-home into an exported store action `establishDurableHomeAfterLoad()` (verified `installProvider` is _private_); corrected the Drive-establish reuse target from `createNewFile` (wrong preconditions) to `configureSyncFileGoogleDrive`, native → `selectNativeLocalFile`; made re-home idempotent so all arms call it uniformly; dropped the `cross_account` key (fold into `message`) to ship zero new keys; added the file:line-drift note.
- **Pass 4 (Fresh-eyes sweep)**: Confirmed security (re-home gated by successful decrypt = proven ownership; made explicit); hardened the idempotency guard against a stale-provider cross-family clobber (Assumption 5 + family-scoped check) and pinned the re-home call site to the aside handler only (never the primary listing); reconciled a real inconsistency — the Chromium arm is FSA-exclusive and does NOT fall through to the Picker, so Requirements 3/4 + Help Center now state the deliberate trade (Chromium restore = downloaded local file; Drive-only foreign file on Chromium = download-first); confirmed not over-engineered.

> **No GitHub issue created.** Approved for direct implementation (Notion #47 `github issue` = do not create). Prompt history in the canonical docs/plans copy.
