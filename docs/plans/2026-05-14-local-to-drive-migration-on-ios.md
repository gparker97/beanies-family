# Plan: Enable local-file → Google Drive pod migration on iOS

> Date: 2026-05-14
> Related issues: #217
> Plan file: `docs/plans/2026-05-14-local-to-drive-migration-on-ios.md`

## User Story

As an owner who started my pod on a local file from an iPhone or iPad, I want to switch to Google Drive without having to find another device, so that I can share my pod with my family from the device I already use most.

## Context

The "Move your pod" row in **Settings → Family Data Options** is currently **hidden** when both of these are true:

- `syncStore.storageProviderType === 'local'` (currently on a local file)
- `isRedirectAuthBrowser` is true (running on iOS Safari / iOS Chrome / any iOS PWA)

Gate: `SettingsPage.vue:1243`. Comment: `"Move to Google Drive" is hidden on iOS / PWAs where the OAuth would hit the fragile popup path`.

The reverse direction (Drive → local) is available on iOS because no OAuth happens there — only a save-picker.

The gate exists because the current `migrateStorage()` flow in `syncStore.ts:1772-1815` runs `flush source → build destination provider (OAuth here) → install + write` synchronously within one JS turn. On desktop / Android, the Google OAuth in step 2 opens a popup; the parent page keeps its in-memory state and the function continues on the same turn. On iOS (per ADR-026), OAuth is a **full-page redirect** to Google's consent screen. By the time the user returns:

- The in-memory **family key** (AES-KW unwrap of the password) is gone — it's deliberately not persisted to storage as plaintext key material
- The **source local file handle** is gone — iOS Safari doesn't support File System Access API; local files are read via `<input type="file">`, which is single-pick and doesn't persist across navigations
- The **`migrateStorage` invocation state** is gone (target, step number, source provider reference)

To make local→Drive work on iOS, the flow needs to persist enough intent across the redirect to resume the migration afterward, then re-acquire the lost state (file handle, family key) via fresh user input on return.

The architectural pattern is already established: `ResumePodSetup.vue` and the related `router/index.ts` guard solve the same problem for the **create-pod** flow on iOS (also a multi-step flow whose middle step is a redirect-auth). This issue is the migration-flow counterpart.

**Why deferred today:** the reverse direction is available, so iOS users on Drive aren't stuck. The truly-stuck case is "iOS user who picked local at onboarding, now wants to share with family". That case is rare today because (a) the recent onboarding redesign now leads new users to Drive on Step 2, (b) anyone affected can switch from any non-iOS device they have. **Picking this up makes sense when (a) a real pilot user hits it and complains, or (b) iOS PWAs gain popup OAuth / persistent file handles (no ETA — Safari has been slow on both).**

## Requirements

1. The "Move to Google Drive" row in **Settings → Family Data Options** is **visible** on iOS when the user is currently on a local-file pod (owner-only, as today).
2. Tapping **Move** kicks off a flow that survives the iOS OAuth redirect and completes with the pod re-saved to Google Drive (re-encrypted with the same family key).
3. The user does not lose data at any point. If the migration fails partway, they remain on the local file as before (or are routed to a clear error/recovery surface — see `recovery-needed` outcome).
4. The flow on non-iOS browsers is **unchanged** — desktop / Android continue to use the popup-OAuth path with no resume dance.
5. The migration success / failure / cancel telemetry surfaces (`storage-migration-ok` / `-failed` with the `from`/`to`/`step` context) keep firing the same way.
6. The **Help Center article** "Moving your pod between local file and Google Drive" is updated in the same change to reflect that local→Drive works on iOS, including a one-line note about the extra friction (re-pick file + re-enter password after Google sign-in).
7. Unit tests cover the resume-state lifecycle (intent persisted, retrieved, cleared on success/cancel/failure). Manual smoke covers the actual iOS redirect dance.

## Important Notes & Caveats

- **DO NOT persist the family key across the redirect** — it's an unwrapped AES key. Re-derive from the cached password (`passwordCache`) if still valid, or re-prompt the user. Both options are acceptable; reuse must follow the same security posture as `ResumePodSetup.vue`.
- **The source local file handle is lost across the iOS redirect.** The resume screen must re-prompt the user to pick the local file again. UX-wise this is a friction point — the resume copy should set expectations clearly ("Find your old beanpod file one more time so we can move it to Drive").
- **Validation on re-pick:** after the user re-picks a local file, verify it's the same pod (matches `activeFamilyId`) before proceeding — otherwise we'd silently migrate the wrong file. Compare the unwrapped Automerge doc's `familyId` to `useFamilyContextStore().activeFamilyId`.
- **Password cache TTL:** if `passwordCache` has expired between the start of the migration and the return-from-redirect, re-prompt for the password before re-deriving the family key. Use the same recovery copy as `ResumePodSetup.vue`.
- **Cancel paths must clear the resume state.** If the user cancels the Google chooser, cancels the file re-pick, or hits Cancel on the password re-prompt, the resume IndexedDB record must be cleared so they're not stuck in resume mode on next app load.
- **Re-entrancy guard:** `syncStore.isMigratingStorage` and the in-memory `migrateStorage()` re-entry guard need to coexist with the cross-redirect resume flow — pre-redirect we set it, redirect wipes memory, post-redirect we re-set it on resume.
- **Router guard:** add a check similar to the existing onboarding-zombie guard so that if a user has a pending migration intent in IndexedDB but lands on a page other than the migration resume screen, they're bounced to `/welcome?resume=migration` (or equivalent route). Otherwise they could "escape" the resume flow and end up with stale state.
- **Telemetry:** on resume, fire a new surface `storage-migration-resume` (severity warning) so we can see how often this path is taken. On resume-failure, fire `storage-migration-failed` with `step: 'resume'` so we can spot UX dead-ends.
- **Do NOT remove the existing `isRedirectAuthBrowser` gate until the full resume flow is implemented and tested.** The gate is the safety net; flipping it on with a half-built flow would expose users to broken migrations.

## Assumptions

> **Review these before implementation.** These were valid at 2026-05-14 but may have changed.

1. iOS Safari and iOS Chrome still lack File System Access API (or any equivalent persistent file handle mechanism). If iOS picks one up before this ships, the resume flow can be much simpler — skip the re-pick step.
2. `ResumePodSetup.vue`'s redirect-survival pattern (intent stored in IndexedDB, re-derive family key from `passwordCache` or re-prompt, router guard bounces to a resume screen) is the right reference. If that pattern has been replaced or refactored, port the same idea against whatever the new system is.
3. `passwordCache` is still the correct in-memory cache for the unwrapped password and still survives short page reloads / redirects. If not, the resume screen needs to re-prompt for the password unconditionally — acceptable UX, just an extra step.
4. iOS users on a local-file pod are rare — the recent onboarding redesign (Step 2 storage nudge, Drive-first card) means most new iOS users pick Drive at signup. The deferred status is justified by low usage frequency, not by the engineering being trivial. Reassess if pilot reports spike.
5. The current Google OAuth scopes (`userinfo.email` + `drive.file`) are sufficient — no new scope is needed for this flow. Same scopes as create-pod.
6. The migration's existing rollback logic (`restorePreviousProvider`) still works after the resume flow installs the new Drive provider. May need a separate resume-rollback path if the install fails after the user has come back from the redirect.

## Approach

### Phase 1 — persist migration intent before redirect

Extend `migrateStorage(target)` in `syncStore.ts:1772` to detect the iOS local→Drive case (`isRedirectAuthBrowser && from === 'local' && target === 'google_drive'`). When detected:

1. Write a `MigrationIntent` record to IndexedDB (new store, e.g. `pendingMigration`, in the existing `beanies-registry` DB):
   ```ts
   interface MigrationIntent {
     familyId: string;
     from: 'local';
     to: 'google_drive';
     startedAt: ISODateString;
     // Note: do NOT persist the family key. Re-derive after redirect.
   }
   ```
2. Trigger the redirect-auth handoff for Drive (`requestAccessToken({ loginHint?, forceConsent: false })`), letting the redirect happen.
3. Do NOT continue the rest of `migrateStorage()` — the JS state will be wiped by the redirect anyway.

### Phase 2 — resume screen on return

New component `src/components/storage/ResumePodMigration.vue` modeled on `src/components/login/ResumePodSetup.vue`. Mounted at `/welcome?resume=migration` (or a dedicated `/resume-migration` route — pick whichever lands cleaner against the existing router-guard architecture).

Renders three steps with progress indication:

1. **Confirm intent**: brief explainer ("You started moving your pod to Google Drive. Let's finish — just two more steps.") + the destination Drive account that just signed in.
2. **Re-pick local file**: `<input type="file" accept=".beanpod">` styled like the onboarding pickers; copy "Find your beanpod file one more time so we can copy it to Drive." Validate the picked file's `familyId` matches `activeFamilyId` after decryption.
3. **Re-enter password** (only if `passwordCache` has expired between start and return): standard password input; re-derive the family key via the existing unwrap path.

On all three steps complete: invoke an internal helper `completeMigrationToDrive({ sourceBlob, familyKey })` that mirrors the second half of `migrateStorage`'s happy path:

- Call `buildProviderForTarget('google_drive')` using the already-acquired OAuth token (no new redirect)
- `installProvider(newProvider, 'google_drive')` to write the encrypted pod to Drive
- Clear the `pendingMigration` IndexedDB record
- Fire `storage-migration-ok` telemetry with `from: 'local', to: 'google_drive', context: { resumed: true }`
- Toast success + route to `/nook`

Cancellation paths (Cancel on re-pick, Cancel on password, Cancel on auth-fail) clear the `pendingMigration` record and route to `/settings` with a "Move cancelled" toast.

### Phase 3 — router guard

Extend the existing onboarding-zombie router guard (`router/index.ts`, the block that checks for `authStore.podCreated`) to also check for a `pendingMigration` record. If one exists and the route is not `/welcome?resume=migration` (or wherever it lands), redirect there. This catches users who close the tab mid-redirect and reopen later.

### Phase 4 — flip the Settings gate

Once Phases 1–3 are in and tested, remove `&& isRedirectAuthBrowser` from the `v-if` at `SettingsPage.vue:1243`. The migration row is now visible for iOS local-file owners.

### Phase 5 — Help Center update

Update `src/content/help/getting-started.ts` article `moving-your-pod-storage` to remove any (implicit or explicit) "iOS not supported" copy and add a short note in the Drive direction that iOS users will be redirected to Google to sign in and asked to re-pick their file. Pattern follows the `/beanies-help-docs` skill.

## Files Affected

- `src/stores/syncStore.ts` — modify `migrateStorage` to branch on iOS local→Drive (Phase 1); add `completeMigrationToDrive` helper for the resume path (Phase 2)
- `src/services/indexeddb/registryDatabase.ts` — add `pendingMigration` object store + repository functions
- `src/components/storage/ResumePodMigration.vue` — NEW, modeled on `ResumePodSetup.vue`
- `src/router/index.ts` — extend guard to detect `pendingMigration` + bounce to resume route
- `src/pages/SettingsPage.vue:1243` — remove the `isRedirectAuthBrowser` half of the gate (Phase 4)
- `src/content/help/getting-started.ts` — update the `moving-your-pod-storage` article (Phase 5)
- `src/services/translation/uiStrings.ts` — new keys for the resume screen copy + the iOS-aware Settings hint
- `public/translations/zh.json` — regenerated via `npm run translate`
- `src/stores/__tests__/syncStore.migrate.test.ts` — extend with cases for iOS branch + resume completion
- `src/components/storage/__tests__/ResumePodMigration.test.ts` — NEW unit tests for the resume flow

## Help Center Coverage

- **Action**: update existing
- **Category**: getting-started
- **Slug**: pointer to existing `moving-your-pod-storage`
- **Title**: "Moving your pod between local file and Google Drive" (unchanged)
- **Scope**: refresh the article to drop any iOS-not-supported language; in the "Local file → Google Drive" subsection, add a one-paragraph note: "On iPhone or iPad, you'll be redirected to Google to sign in (instead of a popup), then come back to a 'Finish moving to Drive' screen where you'll re-pick your beanpod file. Your password might be re-asked if it's been a while. The move completes the same way after that — no data is lost."
- **Notes**: explicitly call out that the file re-pick is an iOS-only step (so users on other platforms don't expect it). Reassure that nothing is lost during the redirect and that cancelling at any step leaves them on the local file. Mention that the move still works without re-entering the password if the password cache is still warm.

## Acceptance Criteria

- [ ] Migration row visible in Settings → Family Data Options for an iOS owner currently on a local file (verified on real iPhone Safari + iPhone PWA + iPad)
- [ ] Tapping **Move** triggers Google OAuth redirect (not popup) on iOS
- [ ] After Google consent + return, user lands on a "Finish moving to Drive" resume screen
- [ ] Re-picking the original local file + completing the flow results in the pod being saved to Drive (verified by file existing in Drive + storage provider switched + `Last Saved` timestamp updating)
- [ ] Source local file is **not deleted** — left as a backup
- [ ] Cancelling at any step (Drive chooser, file re-pick, password re-prompt) clears `pendingMigration`, leaves the user on the original local file, fires no error toast
- [ ] Re-picking the wrong file (different `familyId`) shows a clear error and does not migrate
- [ ] Password-cache-warm path skips the password re-prompt; password-cache-expired path includes it
- [ ] If the user closes the tab mid-resume and reopens, the router guard bounces them back to the resume screen
- [ ] `storage-migration-ok` fires on success with `context.resumed === true`; `storage-migration-failed` with `step: 'resume'` fires on resume-path failures
- [ ] Non-iOS migration paths (desktop, Android) are visibly unchanged in behaviour and telemetry shape
- [ ] Help Center article `moving-your-pod-storage` updated and verified to match shipped behaviour
- [ ] Unit tests pass; new tests cover the resume lifecycle (intent persisted/retrieved/cleared, family-mismatch rejection, cancel paths)

## Testing Plan

1. **Unit tests** (`syncStore.migrate.test.ts` + `ResumePodMigration.test.ts`):
   - iOS local→Drive branch writes `pendingMigration` and triggers redirect (mocked)
   - Resume retrieves the intent, validates `familyId` match, rejects mismatches
   - Password-cache-warm path completes without re-prompt; expired path requires it
   - Cancel paths clear the IndexedDB record
   - Resume-rollback path on `installProvider` failure restores the local provider
   - Telemetry surfaces fire with the expected `context` payload
2. **Type-check + lint + tests + build:** `npm run validate` stays green; `npm run translate` regenerates zh for the new keys.
3. **Manual smoke (real iOS device required — can't be automated):**
   - Fresh iPhone Safari, create a local-file pod, then attempt **Move to Google Drive**
   - Repeat on iPhone home-screen PWA
   - Repeat on iPad Safari
   - Verify the Google account chooser appears (redirect), consent flow completes, return to the resume screen, re-pick the file, complete the move
   - Verify the move with password cache cold (sign out and back in to force cache expiry between start and return)
   - Verify cancel paths at each step
   - Verify the original local file still exists and is unchanged after a successful move
   - Verify Drive file content opens correctly (decrypts, family data intact)
4. **Cross-device regression smoke:** the same migration flow from a desktop browser must still work via popup OAuth (no resume screen, no IndexedDB record persisted).
5. **Telemetry verification:** confirm `storage-migration-ok` / `storage-migration-failed` Slack alerts fire with the expected `context.resumed` / `context.step` fields on each path.

## Prompt Log

> Saved on the GitHub issue created from this plan — see comment thread.
