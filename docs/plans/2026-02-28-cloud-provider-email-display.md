# Plan: Show Cloud Provider Account Email Next to Data Filename

> Date: 2026-02-28
> Related issues: N/A

## Context

When users connect to Google Drive, the app shows the `.beanpod` filename alongside a Google Drive icon in ~9 UI locations. Users with multiple Google accounts can't tell which account the file is stored under. We need to capture the Google email during OAuth and display it adjacent to the cloud provider logo wherever the filename appears.

## Approach

### Phase 1 — Backend (capture & persist email)

1. `googleAuth.ts` — Add `userinfo.email` scope + `fetchGoogleUserEmail()` + module-level cache
2. `storageProvider.ts` — Add `getAccountEmail(): string | null` to interface
3. `localProvider.ts` — Stub `getAccountEmail()` returning null
4. `fileHandleStore.ts` — Add `driveAccountEmail?: string` to `PersistedProviderConfig`
5. `googleDriveProvider.ts` — Store email, implement `getAccountEmail()`, persist it
6. `syncService.ts` — Pass email on restore from persisted config

### Phase 2 — Store (expose reactively)

7. `syncStore.ts` — Add `providerAccountEmail` ref, update from provider state changes

### Phase 3 — UI (shared component + update all locations)

8. Create `CloudProviderBadge.vue` — DRY shared component for icon + filename + email
9. `uiStrings.ts` — Add translation key for tooltip
10. Update all 9 display locations to use `CloudProviderBadge`

## Files affected

**Create (1):**

- `src/components/ui/CloudProviderBadge.vue`

**Modify (17):**

- `src/services/google/googleAuth.ts`
- `src/services/sync/storageProvider.ts`
- `src/services/sync/providers/localProvider.ts`
- `src/services/sync/providers/googleDriveProvider.ts`
- `src/services/sync/fileHandleStore.ts`
- `src/services/sync/syncService.ts`
- `src/stores/syncStore.ts`
- `src/services/translation/uiStrings.ts`
- `src/pages/SettingsPage.vue`
- `src/components/login/PickBeanView.vue`
- `src/components/login/BiometricLoginView.vue`
- `src/components/login/LoadPodView.vue`
- `src/components/login/CreatePodView.vue`
- `src/components/login/FamilyPickerView.vue`
- `src/components/common/AppSidebar.vue`
- `src/components/common/MobileHamburgerMenu.vue`
- `src/components/common/SyncStatusIndicator.vue`
