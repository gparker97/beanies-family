# Plan: Public-link photo access

> Date: 2026-04-20
> Supersedes the recovery-banner approach in `2026-04-20-folder-scoped-photo-access.md` — that plan was premised on a misreading of `drive.file` scope semantics. Empirical test today: picking the folder via Drive Picker does NOT extend `drive.file` access to files other users put in the folder, only to files the picker creates itself. So the recovery banner sends users in a loop.

## Context

- App uses `drive.file` scope. `drive.file` grants API access only to files the app created OR files the user explicitly picked via Drive Picker.
- Family members can't API-fetch photos uploaded by other members, regardless of Drive-level folder sharing.
- Folder pick grants access to the folder (list contents, create files in it) but NOT to existing files other users put there. `.beanpod` access survives the join because she individually picked the `.beanpod` before.
- The only paths forward are (a) broaden scope to `drive` (re-consent; privacy regression), (b) make photos link-readable at upload time, or (c) accept current broken state.

We're taking (b). Photos uploaded with `anyone-with-link → reader` permission are fetchable by URL without any OAuth. driveFileIds live in the encrypted Automerge doc — practical exposure = anyone holding the decrypted family doc = family members.

## What stays from the previous change

- `pickBeanpodFolder()` in `drivePicker.ts` + its use in `JoinPodView.vue` — still a slightly cleaner join UX (one pick instead of a planned-two).
- `findBeanpodInFolder` + `NoBeanpodInFolderError` — clean utility, good test coverage.
- `<ErrorBanner>` — still used by `SaveFailureBanner`; good abstraction.
- SaveFailureBanner's silent-catch fix — orthogonal improvement; stays.

## What gets removed

- `PhotoAccessRecoveryBanner.vue` — no longer needed; photos just work.
- `useRecoverPhotoAccess` composable — ditto.
- `photoStore.hasBrokenPhotos` + `photoStore.clearUnresolved` — added for the banner; no other callers.
- All `recoverPhotos.*` translation keys (25 entries).
- `<PhotoAccessRecoveryBanner />` mount in App.vue.

## What's new

### 1. `setPublicLinkPermission(token, fileId)` in `driveService.ts`

POST `/files/{fileId}/permissions` with `{ type: 'anyone', role: 'reader' }`. Separate function (not overloading `shareFileWithEmail`) — clearer intent, simpler body. Idempotent — Drive no-ops or confirms if the grant already exists. 403 (not owner) treated as non-fatal by callers.

### 2. Call it at every upload site in `photoStore`

Three code paths create Drive files: `finalizeUpload` (regular photo), `addAvatarPhoto`, `replacePhotoFile`. Each gets a `setPublicLinkPermission(token, fileId)` call immediately after `createFile`. Permission failure is non-fatal for the upload — the file is stored; if public-link setup fails (rare), a later sweep catches it.

### 3. `getPublicUrl(photoId, size)` in `photoStore`

Sync function (no async, no fetch). Returns:

- Thumb (`size='thumb'`): `https://drive.google.com/thumbnail?id={driveFileId}&sz=w400`
- Full (`size='full'`): `https://drive.google.com/uc?export=view&id={driveFileId}`

Returns `null` if photo is tombstoned or unresolved. No caching — the URL is deterministic from the driveFileId.

### 4. Migrate all call sites to `getPublicUrl`

- `PhotoThumbnail.vue` — swap `await store.getBlobUrl(...)` for `store.getPublicUrl(..., 'thumb')`. Template already has `@error="handleImgError"` for `<img>` load failures; keep that path for genuine 404s (deleted / permission-revoked files).
- `PhotoViewer.vue` — same swap, `size='full'`.
- `useAvatarPhotoUrl.ts` — same swap, `size='thumb'`.
- `FamilyCookbookPage.vue`, `MeetTheBeansPage.vue`, `RecipeDetailPage.vue` — same swap.

### 5. `getBlobUrl` stays but gets deprecated

Remove from the public return object of the store; keep the implementation for one release in case callers slip through. Add `@deprecated` JSDoc. Remove in a follow-up.

### 6. One-time migration for existing photos

New composable `useEnsurePhotosPublic()` mounted from `App.vue`. On first app init after `syncStore.driveFileId` resolves, iterate `doc.photos` and call `setPublicLinkPermission` on each. Session-scoped guard (`sessionStorage`) prevents re-running every navigation. Per-photo 403 (not the file's owner) skipped silently with `console.debug`. Other errors `console.warn` with `photoId`. No UI surface — it's a silent background fixup.

### 7. Error surfaces

| Where     | Trigger                         | User                            | Developer                                                                    |
| --------- | ------------------------------- | ------------------------------- | ---------------------------------------------------------------------------- |
| Upload    | `setPublicLinkPermission` fails | none — upload itself succeeded  | `console.warn('[photoStore] public-link setup failed', { photoId, fileId })` |
| Migration | `setPublicLinkPermission` 403   | none — not this user's file     | `console.debug('[migratePhotos] skipped (not owner)', { fileId })`           |
| Migration | other error                     | none — sweep is silent fixup    | `console.warn('[migratePhotos] failed', { fileId, e })`                      |
| Render    | `<img>` `onerror`               | broken-image tile (existing UX) | `console.warn('[PhotoThumbnail] image failed', photoId)` — existing          |

## Files affected

| File                                                  | Change                                                                                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `src/services/google/driveService.ts`                 | Add `setPublicLinkPermission`                                                                                             |
| `src/services/google/__tests__/driveService.test.ts`  | Tests for `setPublicLinkPermission`                                                                                       |
| `src/stores/photoStore.ts`                            | Call permission in 3 upload paths; add `getPublicUrl`; remove `hasBrokenPhotos`/`clearUnresolved`; deprecate `getBlobUrl` |
| `src/stores/__tests__/photoStore.test.ts`             | Drop `hasBrokenPhotos` test; add `getPublicUrl` + permission-on-upload tests                                              |
| `src/components/media/PhotoThumbnail.vue`             | Swap to `getPublicUrl`                                                                                                    |
| `src/components/media/PhotoViewer.vue`                | Swap to `getPublicUrl`                                                                                                    |
| `src/composables/useAvatarPhotoUrl.ts`                | Swap to `getPublicUrl`                                                                                                    |
| `src/pages/FamilyCookbookPage.vue`                    | Swap to `getPublicUrl`                                                                                                    |
| `src/pages/MeetTheBeansPage.vue`                      | Swap to `getPublicUrl`                                                                                                    |
| `src/pages/RecipeDetailPage.vue`                      | Swap to `getPublicUrl`                                                                                                    |
| `src/composables/useEnsurePhotosPublic.ts` (new)      | Migration composable                                                                                                      |
| `src/App.vue`                                         | Invoke migration; remove recovery banner mount                                                                            |
| `src/components/common/PhotoAccessRecoveryBanner.vue` | **Delete**                                                                                                                |
| `src/composables/useRecoverPhotoAccess.ts`            | **Delete**                                                                                                                |
| `src/services/translation/uiStrings.ts`               | Remove `recoverPhotos.*`                                                                                                  |
| `public/translations/zh.json`                         | Regenerated                                                                                                               |
| `docs/adr/021-photo-storage.md`                       | Rewrite scope section with the public-link decision + privacy analysis                                                    |
| `CHANGELOG.md`                                        | Entry                                                                                                                     |

## Testing

- Unit: `setPublicLinkPermission` — body shape, success, 403 handling.
- Unit: `getPublicUrl` — thumb vs full URL shape, null for deleted/unresolved.
- Unit: migration composable — iterates photos, skips 403, reports counts.
- Regression: existing photoStore tests — add/replace/delete flows still work with the permission call.
- Manual: family member's broken state → owner opens app → migration runs → family member reloads → photos render. No banner, no picker dance.

## Privacy considerations (for ADR)

- Photo bytes are accessible to anyone with the direct Drive URL. URL = `drive.google.com/thumbnail?id={driveFileId}` or `/uc?id=...`.
- driveFileIds are random 33-char strings. Not guessable.
- URLs live in the Automerge doc. The doc is encrypted at rest with the family key. A non-member would need both (a) the encrypted doc from Drive — which requires Drive-level access the owner controls — and (b) the family key — derived from passkey/password, never on any server.
- Effective privacy: same trust boundary as everything else in beanies.family — anyone who can decrypt the family doc can see photos.
- Google retains ability to serve/delete photos (unchanged). Subpoena exposure and platform takedown risk unchanged from the prior design.
- The `drive` scope (option rejected) would have been worse on privacy — app reads the user's entire Drive. Public-link on app-created files only is strictly less.
