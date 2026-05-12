# Plan: Storage Provider Migration — Move Pod Between Local File and Google Drive

> Date: 2026-05-12
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-05-12-storage-provider-migration.md`

## Context

Onboarding makes the user pick a storage type — local file or Google Drive — before many of them have an informed preference (2 of 3 recent pilot sign-ups dropped at the storage step). Circumstances also change: someone on local file may later want Drive for cross-device access; someone on Drive may want to drop that dependency. Today neither move is supported in-app — the only workaround is download `.beanpod` → sign out → re-onboard → pick the other provider, which is undiscoverable.

This adds one owner-only action in **Settings → Family Data** ("Move to Google Drive" / "Move to local file") that swaps the active storage provider safely. The encrypted bytes are unchanged — same family key, same envelope, no re-derivation, no password prompt. Only the storage location moves; the source file is left intact as a backup.

## Approach

### 1. Extract `installProvider(provider, type)` in `syncStore.ts` (DRY)

`configureSyncFile` and `configureSyncFileGoogleDrive` duplicate a "make this provider the active one" sequence. Extract a private, pure helper — throws on any step's failure, leaves rollback to the caller:

`needsPermission = false` → `provider.persist(familyId)` (writes new config; clears the opposite type's config) → `syncService.setProvider(provider)` (installs in-memory; `onStateChange` propagates `storageProviderType`/`fileName`; auto-starts polling) → `syncNow()` (writes the current encrypted envelope; throws if it returns false) → `settingsRepo.saveSettings({syncEnabled, syncFilePath, lastSyncTimestamp})` (the `syncNow`+`saveSettings` pair wrapped in `isReloading = true … finally false` to keep the file-poll reload check from racing) → `registerCurrentFamily({provider: type, fileId, displayPath})` → `setupTokenExpiryHandler()` for `google_drive`, else `setupAutoSync()`.

`syncNow()` is non-forced so a genuine cross-device conflict on the source surfaces. New destination files have no timestamp → no false conflict; rollback writes to the source whose timestamp is now older than `lastSync` → no false conflict there either.

Rewire: `configureSyncFileGoogleDrive` → `const p = await GoogleDriveProvider.createNew(name); await installProvider(p, 'google_drive');` (its existing try/catch stays). `configureSyncFile` → `if (!(await syncService.selectSyncFile())) return false; await installProvider(syncService.getProvider()!, 'local'); return true;` — `selectSyncFile` already did `persist`+`setProvider`, so `installProvider` re-does them harmlessly (idempotent: re-writes the same config, restarts polling). `selectSyncFile` is left untouched because `CreatePodView.vue` also calls it.

### 2. Extract `isUserCancellation(error)` in `googleAuth.ts` (DRY)

`handleSwitchGoogleAccount` has an inline `/cancel|dismiss|popup_closed|user_cancel/i` test; the Drive-create path here needs the same. Move it to one exported helper (also matches `AbortError` by `.name`). Update `handleSwitchGoogleAccount` to use it (no behaviour change).

### 3. Add `migrateStorage(target)` to `syncStore.ts`

Store-owned loading state `isMigratingStorage = ref(false)` (exported readonly). `migrateStorage` does the work and **returns a discriminated result**; the component renders the toasts (i18n stays in the component layer; the store stays toast-free and easy to unit-test). The store still owns the success telemetry ping and the structured `console.error`.

```ts
type MigrateStorageResult =
  | { outcome: 'success'; dest: string }
  | { outcome: 'cancelled' }
  | { outcome: 'failed'; reason: string }
  | { outcome: 'recovery-needed'; reason: string };

async function migrateStorage(target: StorageProviderType): Promise<MigrateStorageResult> {
  if (isMigratingStorage.value) return { outcome: 'cancelled' }; // re-entrancy guard
  isMigratingStorage.value = true;
  const from = storageProviderType.value;
  let needsRollback = false;
  let previous: StorageProvider | null = null;
  try {
    if (!isConfigured.value) throw new Error('No pod is configured to move');
    if (!from) throw new Error('No active storage provider to move from');
    if (target === from)
      throw new Error(
        `Pod is already saved to ${target === 'google_drive' ? 'Google Drive' : 'a local file'}`
      );

    // Flush the source one last time so the file you're leaving is an up-to-date backup.
    if (!(await syncNow()))
      throw new Error(
        'Could not save your pod to its current location before moving. If another device is syncing, wait a moment and try again.'
      );

    // Build the destination provider. null = the user cancelled a picker/chooser.
    const newProvider = await buildProviderForTarget(target);
    if (!newProvider) return { outcome: 'cancelled' };

    // Swap. Keep a handle on the old provider so we can put it back if the install fails.
    previous = syncService.getProvider();
    needsRollback = true;
    await installProvider(newProvider, target);
    needsRollback = false;

    reportError({
      surface: 'storage-migration-ok',
      severity: 'warning',
      message: `moved ${from} -> ${target}`,
      context: { from, to: target },
    });
    return { outcome: 'success', dest: newProvider.getDisplayName() };
  } catch (e) {
    let restored = true;
    if (needsRollback && previous && from) restored = await restorePreviousProvider(previous, from);
    const step = !needsRollback ? 'pre-swap' : restored ? 'install' : 'rollback';
    const reason = e instanceof Error ? e.message : String(e);
    reportError({
      surface: 'storage-migration-failed',
      severity: 'error',
      message: reason,
      error: e,
      context: { from, to: target, step },
    });
    console.error('[syncStore.migrateStorage] failed', { from, to: target, step, error: e });
    return restored ? { outcome: 'failed', reason } : { outcome: 'recovery-needed', reason };
  } finally {
    isMigratingStorage.value = false;
  }
}

async function buildProviderForTarget(
  target: StorageProviderType
): Promise<StorageProvider | null> {
  if (target === 'local') return LocalStorageProvider.fromSavePicker('my-family.beanpod'); // null on cancel
  try {
    return await GoogleDriveProvider.createNew(fileName.value ?? 'my-family.beanpod', {
      forceConsent: false,
    });
  } catch (e) {
    if (isUserCancellation(e)) return null;
    throw e;
  }
}

async function restorePreviousProvider(
  provider: StorageProvider,
  type: StorageProviderType
): Promise<boolean> {
  try {
    await installProvider(provider, type);
    return true;
  } catch (e) {
    console.error('[syncStore.migrateStorage] rollback failed', e);
    return false;
  }
}
```

Note vs the earlier draft: the separate pre-flight `requestAccessToken()` is **removed** — `createNew(..., { forceConsent: false })` calls `requestAccessToken({ forceConsent: false })` internally, which reuses a cached token (so a post-redirect retry on a standalone PWA completes without re-redirecting → no loop) and, when there's no cached token, triggers the redirect from inside `createNew` (page navigates away; the user retries on return). One cancellation site (`buildProviderForTarget` → null), one fewer special case.

Owner-gating lives in the UI (the action row is `v-if="isOwner"`); the store's guard rails are `isConfigured` + `from` + `target !== from` (no cross-store reach for an `isOwner` check).

#### 3a. Add `{ forceConsent? }` to `GoogleDriveProvider.createNew`

`createNew` currently calls `requestAccessToken({ forceConsent: true })` internally. `forceConsent` adds `prompt=consent`, which on a standalone PWA forces the redirect path even when a token is cached → a post-redirect retry of a local→Drive migration would redirect again, looping. Change the signature to `createNew(fileName: string, opts: { forceConsent?: boolean } = {})` with `forceConsent` defaulting to `true` (zero change for the onboarding caller). The migration passes `{ forceConsent: false }`.

(Mid-sequence failure leaves an empty `{}`-content `.beanpod` in the user's Drive — harmless litter; the source is untouched. Precedent: the `gcOrphanedDriveFiles` Drive-side sweep already noted as an ADR-021 follow-up. Not cleaned up in v1.)

### 4. UI in `SettingsPage.vue`

One owner-gated action row inside the existing Family Data `BeanieFormModal`, between the "Load another data file" row and the error display, reusing the same row CSS. Static i18n keys via ternary — never dynamic key construction.

```ts
async function handleMigrateStorage() {
  const toDrive = syncStore.storageProviderType === 'local';
  const target: StorageProviderType = toDrive ? 'google_drive' : 'local';
  const ok = await confirm({
    variant: 'info', // Heritage Orange — routine, not destructive
    title: toDrive
      ? 'settings.familyData.migrate.confirmTitleToDrive'
      : 'settings.familyData.migrate.confirmTitleToLocal',
    message: toDrive
      ? 'settings.familyData.migrate.confirmBodyToDrive'
      : 'settings.familyData.migrate.confirmBodyToLocal',
    confirmLabel: 'settings.familyData.migrate.confirmAction',
  });
  if (!ok) return;
  const source = syncStore.fileName ?? '';
  const result = await syncStore.migrateStorage(target);
  switch (result.outcome) {
    case 'success':
      showToast(
        'success',
        t('settings.familyData.migrate.successTitle'),
        t('settings.familyData.migrate.successBody')
          .replace('{source}', source)
          .replace('{dest}', result.dest)
      );
      break;
    case 'cancelled':
      showToast(
        'info',
        t('settings.familyData.migrate.cancelledTitle'),
        t('settings.familyData.migrate.cancelledBody').replace('{source}', source)
      );
      break;
    case 'failed':
      showToast(
        'error',
        t('settings.familyData.migrate.failedTitle'),
        t('settings.familyData.migrate.failedBody')
          .replace('{reason}', result.reason)
          .replace('{source}', source),
        { surface: 'storage-migration-failed', silent: true }
      );
      break;
    case 'recovery-needed':
      showToast(
        'error',
        t('settings.familyData.migrate.recoveryNeededTitle'),
        t('settings.familyData.migrate.recoveryNeededBody'),
        { surface: 'storage-migration-failed', silent: true }
      );
      break;
  }
}
```

(The toasts pass `silent: true` because `migrateStorage` already `reportError`s the failure with full `{ from, to, step }` context — letting the toast auto-report too would double-ping `#beanies-errors`.)

`confirm()` takes `UIStringKey`s and translates internally. Modal stacking over the Family Data drawer works via the existing Teleport setup.

### 5. i18n (`src/services/translation/uiStrings.ts`)

New leaf keys (each with `en` Title-Case-for-labels / Sentence-case-for-bodies + `beanie` all-lowercase): `settings.familyData.migrate.moveToGoogleDrive` / `…moveToLocalFile` (+ `…Desc` pair), `…confirmTitleToDrive` / `…confirmTitleToLocal`, `…confirmBodyToDrive` / `…confirmBodyToLocal` (state: the file you're leaving stays where it is and stops updating; other devices need to re-load the pod from the new location; local→Drive uses the signed-in Google account or prompts you to sign in; no password needed), `…confirmAction` ("Move my pod"), `…cancelledTitle` / `…cancelledBody` ("Move cancelled — your pod is still on {source}"), `…successTitle` / `…successBody` ("Your pod is now saved to {dest}. {source} is still where it was if you want to keep it as a backup."), `…failedTitle` / `…failedBody` ("{reason} Your pod is still on {source}."), `…recoveryNeededTitle` / `…recoveryNeededBody` ("The move failed and we couldn't fully restore your previous storage. Sign out and sign back in to recover."), and `action.move`. Run `npm run translate` afterward; confirm the parser is still clean.

### 6. Help Center (per `/beanies-plan` skill — ships in the same change)

- **New how-to** in `src/content/help/getting-started.ts` → slug `moving-your-pod-storage`, title "Moving your pod between local file and Google Drive". Calls out: owner-only; old file stays (not deleted — keep it as a backup until the move is confirmed); other devices must re-load from the new location; no password prompt (encryption unchanged); local→Drive uses the signed-in Google account (or prompts). Voice/structure per `.claude/skills/beanies-help-docs/SKILL.md`.
- **Update** `connecting-google-drive` (slug `connecting-google-drive`): add an "Already on a local file? You can switch later →" line in the "Why connect Google Drive?" section linking the new how-to; bump `updatedDate`.
- Bump the Getting Started count in `.claude/skills/beanies-help-docs/SKILL.md`.

## Files affected

**Modified:** `src/stores/syncStore.ts` (extract `installProvider`; rewire `configureSyncFile` + `configureSyncFileGoogleDrive`; add `buildProviderForTarget`, `restorePreviousProvider`, `migrateStorage`, `isMigratingStorage`; new imports: `LocalStorageProvider`, `showToast`-not-needed-anymore, `isUserCancellation`, `StorageProvider` type) · `src/services/sync/providers/googleDriveProvider.ts` (`createNew` gains optional `{ forceConsent? }`) · `src/services/google/googleAuth.ts` (add `isUserCancellation`) · `src/pages/SettingsPage.vue` (use `isUserCancellation` in `handleSwitchGoogleAccount`; add the action row + `handleMigrateStorage`; import `showToast`, `confirm`, `StorageProviderType`) · `src/services/translation/uiStrings.ts` (new keys) · `src/content/help/getting-started.ts` (new article + cross-reference) · `.claude/skills/beanies-help-docs/SKILL.md` (inventory bump).

**New:** `src/stores/__tests__/syncStore.migrate.test.ts`.

## Acceptance criteria

- [ ] Owner sees one "Move to Google Drive" / "Move to local file" row in Settings → Family Data (never both); members don't see it.
- [ ] Confirm dialog (Heritage Orange CTA) states the old file stays and other devices must re-load.
- [ ] Happy path each direction: new file created, badge flips, auto-save flows to the new location, old file stops updating, success toast names both.
- [ ] Cancelling a picker/chooser leaves the pod on the source with only a silent "Move cancelled" info toast.
- [ ] Simulated destination write-failure rolls back to the source provider; the app keeps saving to the source.
- [ ] `storage-migration-ok` (warning) fires on success; `storage-migration-failed` (error, with `{from,to,step}`) fires on failure; toasts pass `silent: true` to avoid double-pinging.
- [ ] All new user-visible strings via `uiStrings.ts` (en + beanie); `npm run translate` clean.
- [ ] `npm run type-check`, `npm run lint`, vitest, `npm run build` all green; new help article renders.
- [ ] Help article `moving-your-pod-storage` added; `connecting-google-drive` cross-referenced + `updatedDate` bumped; SKILL.md inventory bumped.

## Testing Plan

**Unit** (`src/stores/__tests__/syncStore.migrate.test.ts`, mocking providers + `syncService` + `requestAccessToken`):

1. `installProvider` focused — runs persist → setProvider → syncNow → saveSettings → registerCurrentFamily → setupAutoSync (or setupTokenExpiryHandler for Drive); throws if `syncNow` returns false; tolerates `activeFamilyId === null`.
2. Happy path local → Drive — returns `{outcome:'success',dest}`; `installProvider` ran on the new provider; `createNew` called with `{forceConsent:false}`; `storage-migration-ok` warning fired; no rollback.
3. Happy path Drive → local — symmetric; via `fromSavePicker`.
4. Cancellations ×2 — `fromSavePicker` → null; `createNew` throws a cancellation message. Each: returns `{outcome:'cancelled'}`; previous provider still active; no settings change; no `storage-migration-failed` ping.
5. Source-flush failure (`syncNow` → false): returns `{outcome:'failed'}` with `step:'pre-swap'`; no new-provider work.
6. `installProvider` throws on new provider, rollback succeeds: returns `{outcome:'failed'}` with `step:'install'`; previous provider reinstalled.
7. `installProvider` throws on new provider, rollback also throws: returns `{outcome:'recovery-needed'}` with `step:'rollback'`; one `storage-migration-failed` error ping.
8. Guard rails — throws (→ `{outcome:'failed'}`) when not configured / no `from` / `target === from`; re-entrancy guard returns `{outcome:'cancelled'}` when `isMigratingStorage` already true.

**Unit — revise existing:** re-run the `configureSyncFile` / `configureSyncFileGoogleDrive` tests (must pass on observable side effects; rewrite any that assert internal call order). Add a one-liner for `isUserCancellation`. Confirm `handleSwitchGoogleAccount` tests still pass.

**Manual smoke** (Chromium + Safari, Mac): local→Drive happy path; Drive→local happy path; cancellation each direction; rollback simulation (monkey-patch `syncService.save` to throw once); Safari PWA local→Drive with no cached token (redirect once, return, retry completes without a second redirect); telemetry check in `#beanies-errors`.

**Gates:** `npm run type-check`, `npm run lint`, `npm run translate`, `npm run build`. No new E2E (needs Drive mocking, would breach the 25-test ADR-007 cap); re-run existing onboarding/settings E2E to confirm the additive row didn't disturb them.

**Post-deploy watch:** `#beanies-errors` for `storage-migration-*`. `storage-migration-ok` warnings = real adoption; zero error-level pings under healthy conditions; any `step:'rollback'` is a P1.
