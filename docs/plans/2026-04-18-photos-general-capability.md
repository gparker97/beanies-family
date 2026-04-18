# Plan: Photos — general attachment capability

> Date: 2026-04-18
> Related issues: None — direct implementation

## Context

beanies.family has no photo support today. Avatars are fixed beanie PNGs; no user-uploaded image system exists. `.beanpod` (AES-GCM-encrypted Automerge binary) is the only file written to Google Drive.

greg wants a general, reusable photo capability — birthday invitations on activities, pickup-location photos, favorite-food images, real family-member photos. Photos are large binary content; embedding in the CRDT would bloat sync payloads.

**This plan delivers the reusable capability only.** Integrations (activities first, family members second) follow in separate plans. Cloud sync is a hard requirement.

## Key architectural decisions (confirmed with greg)

1. **Photos are NOT encrypted.** They live in the user's own Drive under `drive.file` scope; the user already trusts Google with their Drive content. Skipping encryption unlocks Drive's native `thumbnailLink` CDN, eliminating client-side thumbnail generation, BlurHash, and decrypt-before-render. `.beanpod` remains encrypted because it's structured sensitive data.
2. **Multi-member access via app-folder sharing.** Extend the invite flow to share the `beanies.family` app folder (writer) with each member's email, not just the `.beanpod` file. Everything uploaded to the folder inherits access. Mirrors the existing `.beanpod` trust model (shared writer).
3. **No IndexedDB photo cache.** Use Drive's CDN (`thumbnailLink?sz=w{size}`) for both thumbnail and full-size rendering. `<img src>` directly — browser handles caching. No `downloadFileBlob`, no Blob lifecycle.
4. **Missing-photo UX.** If Drive returns 404/403, thumbnail shows a broken-image state; viewer shows Replace/Remove actions. Replace preserves the photo UUID so entity references stay stable.

## Requirements

1. Photos stored in the shared `beanies.family` Drive folder via existing `driveService`.
2. Automerge stores metadata only (~150 bytes/photo).
3. Thumbnails and full-size images render from Drive's `thumbnailLink` (size-transformed URL), fetched on demand, cached in memory with TTL.
4. Photos compressed client-side: max 2048px long edge, JPEG q=0.85, target ≤ 1 MB. Text readable at zoom.
5. Up to 4 photos per attachment set. Array order; no reorder UI in v1.
6. Cloud-off mode disables attach UI with a `uiStrings` message.
7. Offline attach queues; drains on reconnect.
8. Deletion uses `deletedAt` tombstones + 24h-grace GC sweep (Drive blob + Automerge record).
9. Missing-photo handling: clear icon + Replace/Remove actions; Replace preserves UUID.
10. All new user-visible text via `uiStrings.ts` (en + beanie).
11. A single drop-in `<PhotoAttachments>` component is the integration point.
12. New members added after existing photos exist → automatically gain access via folder share (one API call, no per-photo sweep needed).

## DRY audit — reuse / refactor / new

### Reused unchanged

| Capability               | Asset                                                                   |
| ------------------------ | ----------------------------------------------------------------------- |
| Modal shell for viewer   | `BaseModal` with `size='3xl'` + `fullscreenMobile=true`                 |
| Confirm dialogs          | `useConfirm()`                                                          |
| Error / success surfaces | `useToast()`                                                            |
| Loading spinner          | `BeanieSpinner`                                                         |
| Online/offline state     | `useOnline()`                                                           |
| Share-with-email API     | `shareFileWithEmail` in `driveService.ts` (works for files AND folders) |
| Drive HTTP wrapper       | `driveRequest()` in `driveService.ts`                                   |
| Automerge mutations      | `changeDoc()`                                                           |
| IDB lifecycle            | `deleteFamilyDatabase()` in `database.ts`                               |
| Icon system              | `BeanieIcon` + `icons.ts`                                               |

### Refactored NOW (extract-to-generic)

| Refactor                                                                                                                      | Rationale                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Extract drag-drop from `JoinPodView.vue` into `useFileDrop.ts` composable                                                     | `PhotoAttachments` needs identical drag-drop behavior. Extract once, reuse twice.                                         |
| Add `useFilePicker.ts` composable wrapping `<input type="file">`                                                              | Consistent mime filtering + multi-file + error handling. Used by `PhotoAttachments` and the Replace action in the viewer. |
| Extend `driveService.ts` with `getFileMetadata(token, fileId, fields)` + `DriveFileNotFoundError` subclass of `DriveApiError` | Needed to resolve `thumbnailLink` and `parents`. No parallel Drive HTTP module.                                           |

### Genuinely new

- `src/services/photos/photoCompression.ts` — pure canvas util.
- `src/services/sync/photoUploadQueue.ts` — IDB-backed multi-operation queue for offline uploads. Separate from `offlineQueue.ts` because semantics differ (`offlineQueue` is single-slot `.beanpod` replacement). Both observe `useOnline()` and self-drain — same conceptual pattern.
- `src/stores/photoStore.ts` — orchestrator (per MVO).
- `src/composables/usePhotos.ts` — entity-agnostic wrapper: `(entityRef, updatePhotoIds) → { photos, add, remove }`.
- `src/components/media/PhotoAttachments.vue` — the drop-in. Uses `useFileDrop` + `useFilePicker`.
- `src/components/media/PhotoThumbnail.vue` — `<img src>` from `thumbnailLink?sz=w{thumb}`; broken state when store reports unresolved.
- `src/components/media/PhotoViewer.vue` — wraps `BaseModal` with `fullscreenMobile + size='3xl'`. Full-size via `thumbnailLink?sz=w2048`. Prev/next, delete, download (`<a href download>`), Replace/Remove on missing photos.

### Dropped from earlier drafts

- ~~`src/services/photos/photoCache.ts`~~ — superseded by Drive CDN + browser cache.
- ~~`src/services/photos/photoCrypto.ts`~~ — photos not encrypted.
- ~~`src/services/photos/photoBlurHash.ts`~~ — Drive thumbnails replace BlurHash.
- ~~`blurhash` dependency~~ — not needed.
- ~~Per-photo `shareFileWithEmail` calls~~ — folder sharing covers it.

## Data model

`src/types/models.ts`:

```ts
export interface PhotoAttachment {
  id: UUID;
  driveFileId: string; // canonical reference; thumbnailLink is on-demand lookup
  mime: string;
  width: number;
  height: number;
  sizeBytes: number;
  createdBy?: UUID;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  deletedAt?: ISODateString; // tombstone for GC
}
```

Entities that want attachments add `photoIds?: UUID[]`.

`src/types/automerge.ts` — add `photos: Record<UUID, PhotoAttachment>` to `FamilyDocument`.
`src/services/automerge/docService.ts` — initialize `photos: {}` in `initDoc()`.

## Store API (`photoStore.ts`)

- `resolveCanonicalFolderId() → string` — lazy-init. Calls `driveService.getFileMetadata(beanpodFileId, 'parents')` once per session; caches in memory. This is the shared folder every member uploads to.
- `addPhoto(file, createdBy?) → UUID`:
  1. Compress via `photoCompression.compress`.
  2. Resolve canonical folder.
  3. `driveService.createFile(token, canonicalFolderId, 'beanies-photo-{uuid}.jpg', bytes)`.
  4. `changeDoc` to write `PhotoAttachment`. On write failure, call `driveService.deleteFile` to roll back the upload. If delete also fails, log — gc sweep will clean up.
  5. Offline at step 3: enqueue to `photoUploadQueue`; Automerge metadata is written after the queue drains successfully on reconnect.
- `getImageUrl(photoId, size: 'thumb' | 'full') → string | null` — resolves photo → `driveService.getFileMetadata(..., 'thumbnailLink')` (TTL-cached ~30min) → returns URL transformed to `?sz=w{400|2048}`. Returns `null` + flags unresolved on `DriveFileNotFoundError`. On 403 URL-expired, refresh once.
- `isUnresolved(photoId) → boolean` — reactive runtime flag. Not persisted.
- `replacePhotoFile(photoId, newFile)` — uploads new file, swaps `driveFileId`, bumps `updatedAt` + `width/height/sizeBytes`, leaves `createdAt` unchanged, clears unresolved flag, invalidates URL cache entry.
- `markDeleted(id)` — sets `deletedAt` via `changeDoc`. No synchronous Drive delete.
- `gcOrphans()` — on app start (non-blocking, post-sync settle) and from Settings. Deletes Drive blob + Automerge record for: (a) photos with `deletedAt > 24h ago`; (b) photos with zero inbound `photoIds` references across all entities.
- `gcOrphanedDriveFiles()` — companion sweep. Lists files owned by current user in the canonical folder matching `beanies-photo-*`; deletes any not referenced by `photos.*.driveFileId` AND older than 1 hour (grace period for in-flight uploads on other clients). Only the file owner can delete, so no cross-client races.
- `photosEnabled` getter — `false` when cloud sync is not configured.

## Composable — `usePhotos(entityRef, updatePhotoIds)`

Returns `{ photos: ComputedRef<PhotoAttachment[]>, add(files), remove(id) }`. Entity-agnostic. Validation (count, mime, size) applied here, so views don't duplicate rules.

## UI components

### PhotoAttachments.vue

Horizontal row of `PhotoThumbnail` + add button. `useFileDrop` wraps the row as a drop zone. `useFilePicker` behind the add button. Disabled with `photos.cloudRequired` message when `photosEnabled=false`. Max 4 enforced via composable validation.

### PhotoThumbnail.vue

`<img src={photoStore.getImageUrl(id, 'thumb')}>`. Shows a shimmer while URL is resolving. `onerror` handler retries once, then flips to broken state. Broken state: greyed card + `BeanieIcon name='image-broken'` + `photos.missing.tile`. Tap opens viewer.

### PhotoViewer.vue

Wraps `BaseModal`. Arrow-key + swipe nav, pinch-zoom via CSS transform. Footer actions:

- Normal: Delete (`useConfirm` danger) + Download (`<a href={fullUrl} download={filename}>`).
- Missing state: Replace (opens `useFilePicker` → `replacePhotoFile`) + Remove (`useConfirm` → `markDeleted` + drop from entity's `photoIds`).

## Invite flow change (for multi-member access)

Extend the existing invite flow in `FamilyPage.vue` (line ~232 per audit):

```ts
// existing
await shareFileWithEmail(token, beanpodFileId, email, 'writer');
// new: also share the parent folder so photos inherit access
const folderId = await resolveCanonicalFolderId();
await shareFileWithEmail(token, folderId, email, 'writer');
```

`shareFileWithEmail` works for both files and folders — no new helper needed.

### Migration for existing families

On app start, after sync settles, run a one-time check: for each existing `FamilyMember` (excluding self), confirm the app folder is shared with their email. If not, share it. Idempotent; uses `driveService` `listFilePermissions` (new thin helper via `GET /files/{folderId}/permissions`).

## Critical files

**New (9):**

- `src/services/photos/photoCompression.ts`
- `src/services/sync/photoUploadQueue.ts`
- `src/stores/photoStore.ts`
- `src/composables/useFileDrop.ts` (consumed by both `JoinPodView` and `PhotoAttachments`)
- `src/composables/useFilePicker.ts`
- `src/composables/usePhotos.ts`
- `src/components/media/PhotoAttachments.vue`
- `src/components/media/PhotoThumbnail.vue`
- `src/components/media/PhotoViewer.vue`
- Unit tests alongside each service + store + composable

**Modified:**

- `src/types/models.ts` — add `PhotoAttachment`
- `src/types/automerge.ts` — add `photos` to `FamilyDocument`
- `src/services/automerge/docService.ts` — init `photos: {}`
- `src/services/google/driveService.ts` — add `getFileMetadata`, `listFilePermissions`, `DriveFileNotFoundError`
- `src/components/login/JoinPodView.vue` — refactor drag-drop to `useFileDrop`
- `src/pages/FamilyPage.vue` — extend invite to share app folder + one-time migration sweep
- `src/stores/index.ts` — export `photoStore`
- `src/constants/icons.ts` (or wherever icons live) — add `camera`, `image`, `image-broken` defs
- `src/services/translation/uiStrings.ts` — `photos.*` strings (en + beanie); run `npm run translate`
- `docs/ARCHITECTURE.md` — photo storage section (documents unencrypted + app-folder-share decisions)
- `docs/adr/` — new ADR: photo storage architecture

## Important notes & caveats

- **`thumbnailLink` is signed and short-lived** (hours). Never persist to Automerge. Always resolve via `files.get`; cache in memory with TTL; refresh on 403.
- **`thumbnailLink?sz=w{N}` works for both thumb and full-size** (up to the source resolution). Must be verified empirically for 2048px during implementation; fallback plan if it caps below 2048: reintroduce an authenticated `alt=media` Blob path for full-size only.
- **CSP**: verify `img-src` allows `*.googleusercontent.com` and `lh3.googleusercontent.com`. Update `index.html` / vite config if CSP is restrictive.
- **Upload atomicity**: compress → upload → on success, write Automerge. On metadata-write failure, synchronously delete the Drive file. If delete also fails, `gcOrphanedDriveFiles` catches it later.
- **Replace keeps UUID stable**: all entity references survive; `updatedAt` bumps, `createdAt` unchanged.
- **Unresolved state is runtime-only**: not persisted. A photo unresolved in one session may resolve in the next.
- **Tombstones + 24h GC** for logical deletion; 1-hour grace for orphaned-Drive-file sweep (allows in-flight uploads on other clients to settle).
- **No reorder UI in v1.** Delete + re-add to reorder.
- **HEIC on non-Safari** → friendly `useToast` error. No HEIC decoder bundled.
- **CRDT bloat**: metadata ≤ 200 bytes/photo. No EXIF/captions/tags in this plan.
- **Access token refresh**: all Drive calls go through existing `driveService` auth flow.
- **Offline queue soft cap**: 20 pending uploads. When full, warn via toast; don't block the app.
- **Concurrent delete safety**: folder is writer-shared, so any member could delete any file. Matches `.beanpod` trust model. If users ask for finer control, revisit in v2 with 'reader' folder + per-file writer from owner.
- **User leaves a family**: no automatic folder unshare yet. Follow-up plan should add this to the remove-member flow.
- **Export/import of `.beanpod`** unchanged. Photos stay bound to Drive; portability is a follow-up concern.

## Assumptions (verify on first touch)

1. `driveService.createFile` accepts arbitrary binary + filenames (architecture map suggests yes).
2. `drive.file` scope grants all needed operations (create, read, update, delete, metadata, permissions) on files/folders the app created. No re-consent required.
3. Drive `thumbnailLink` returns a URL that accepts `?sz=w{N}` up to 2048px for JPEG/PNG uploads. **Verify before finalizing the viewer — fallback plan noted above.**
4. `shareFileWithEmail` works identically for folders (it uses the permissions API which is file-agnostic).
5. Activities are first integration surface; family avatars second.
6. `useConfirm` + `useToast` + `BaseModal` + `BeanieSpinner` work unmodified inside the new components.

## Verification / testing plan

### Unit (Vitest, mocked)

- `photoCompression.test.ts` — 4000×3000 → ≤ 2048 long edge; aspect preserved; size cap hit; early-return for small JPEGs.
- `driveService.test.ts` (extend) — `getFileMetadata` passes `fields` param; 404 → `DriveFileNotFoundError`; 403 behavior; `listFilePermissions` parses response correctly.
- `photoUploadQueue.test.ts` — enqueue persists to IDB; reconnect flushes in FIFO order; failed flush retries; soft cap at 20 triggers warning.
- `photoStore.test.ts`:
  - `addPhoto` happy path (mocked drive).
  - Rollback: Automerge write fails → Drive delete called.
  - Offline path: enqueue + flush on reconnect.
  - `getImageUrl` TTL cache hit + 403 single refresh + 404 → unresolved flag.
  - `replacePhotoFile` swaps driveFileId, preserves UUID + createdAt, invalidates URL cache.
  - `gcOrphans` tombstone path + zero-ref cascade path.
  - `gcOrphanedDriveFiles` respects 1-hour grace + owner-scoped listing.
- `useFileDrop.test.ts` — dragenter/leave counter correctness; drop extracts files; handles invalid mime.
- `useFilePicker.test.ts` — mime filter applied; multi-file support; user cancels cleanly.
- `usePhotos.test.ts` — add respects max-4; remove updates entity's `photoIds`.

### Integration / manual

- Large JPEG → compressed ≤ 1MB; text readable at zoom.
- HEIC on Chrome → friendly error.
- Attempt 5th photo → component blocks.
- Local-only mode → attach button disabled.
- Offline attach → compress + queue. Back online → upload + Automerge record appears.
- **Missing-photo test**: upload a photo, manually delete the Drive file from Drive UI → thumbnail shows broken state → viewer shows Replace/Remove → Replace picks new file → UUID unchanged, image resolves.
- **Permission-revoked test**: revoke `drive.file` access → photos render as unresolved until auth is restored.
- **thumbnailLink sizing**: upload at 2048×1536 → `?sz=w2048` returns full-quality image. If not, fall back to authenticated `alt=media`.

### Multi-member (manual, 2 accounts)

- Member A invites B → B signs in → A uploads photo to an entity → B sees the photo after sync.
- B uploads a photo → A sees it.
- Migration: family with existing photos before folder-share was added → one-time migration on app start shares the folder with all members; B can then see historical photos.

### E2E (deferred for this plan)

Photo E2E requires Drive network access, which the existing CI suite doesn't exercise. Note in `docs/E2E_HEALTH.md`: "Photo attachment flow is manually tested only; add to E2E when Drive is mockable." A photo E2E test counts against the 25-test budget; flag for greg when picking up the first integration plan.

### Concurrent-edit (manual, two tabs, same account)

- Both tabs attach to same entity → both photos appear after sync.
- One tab deletes → other tab unaffected.

### Performance

- 20 photos across entities → CRDT grows by ≤ 4KB of metadata.

## Acceptance criteria

- [ ] Upload flow produces Drive file + Automerge record; failure produces neither.
- [ ] Rollback path: Automerge write failure triggers Drive delete.
- [ ] Thumbnails render from `thumbnailLink?sz=w400` with no client-side processing.
- [ ] Full-size viewer renders from `thumbnailLink?sz=w2048`. (If sizing limit hits, fallback path documented and switched on.)
- [ ] Max 4 photos per set enforced.
- [ ] Compression produces ≤ 1MB; text readable at zoom.
- [ ] Cloud-off disables attach UI with `photos.cloudRequired`.
- [ ] Offline attach queues up to 20 pending; drains on reconnect; warning toast at cap.
- [ ] Sign-out deletes no photo cache (nothing to delete — CDN + browser cache).
- [ ] Tombstone + 24h GC removes Drive blob + Automerge record; zero-ref orphans cascaded.
- [ ] Orphaned Drive files (1h grace) cleaned up by user-scoped sweep.
- [ ] Missing photo → broken thumbnail + viewer Replace/Remove; Replace preserves UUID.
- [ ] Invite flow shares app folder + `.beanpod` (both writer).
- [ ] One-time migration shares folder with existing members who don't have it.
- [ ] Concurrent adds/deletes across tabs merge cleanly.
- [ ] All new strings in `uiStrings.ts` (en + beanie); `npm run translate` passes.
- [ ] `JoinPodView` drag-drop migrated to `useFileDrop`; no duplicate drag logic.
- [ ] No duplicate Drive HTTP code — all calls through `driveService`.
- [ ] No new toast/confirm/spinner/modal primitives — all reuse.
- [ ] ADR documents the unencrypted-photos + app-folder-share decisions.

## Prompt log

<details>
<summary>Full prompt history</summary>

### Initial prompt

> This is something I've been thinking about for a while - I'd liek to have the general capability to store photos on beanies for a given family. this could be a photo of anything - for example, a photo of a birthday invitation that we might attach to an activity item for a birthday party, or a picture of a dropoff or pickup location that we could add to an activity (but only show when clicked), or a picture of favorite foods, or rather than beanie icons, we could have real pictures or parents and children.
>
> with local first and no database, what would be the best way to securely store photos so they remain safe and secure but can still be accessed by the authorized family? i'm thinking we can keep photos on s3 buckets, but we need to avoid them possibly getting leaked or accessed by unauthorized people. can you let me know your thoughts on the best way to approach this arthitecturally and from a security / data privacy standpoint?

### Follow-up 1

> sure let's put together a plan to implement this as a general capability for the app. we will add it in various places

### Follow-up 2 (answers to initial clarifying questions)

> 1. no need for github issue
> 2. a) build the general, reusable capability first, including the relevant helpers, modules, etc, then build integrations later. the first one will probably be for activities, then family member data
> 3. (a) - only if using cloud storage i.e. google drive (or others later)
> 4. should be able to attach multiple photos
> 5. let's compress photos to a reasonable size (we're not a photo storing app - it's just to reference. quality needs to be good enough to read text when zoomed in). can add a reasonable cap on photos per item, i.e. up to 4. later we can consider options to archive old photos
> 6. i'm let's do (a) for now - simplest and easiest option, later we can upgrade to a jpeg preview if the blurhash is not working
> 7. no preference - do whatever is the safest and best practice to keep data safe and synchronized
> 8. yes, just like any other data, upload/save as soon as we have a connection. same pattern.

### Follow-up 3 (encryption question)

> Do we need to encrypt photos? they are already being stored to the user's google drive, not on an s3 bucket (whether public or not) - while we are careful with data privacy, given we are storing this on the user's own google drive (presumably in the beanied.family folder, or a subfolder within), i would not consider encryption of photos to be a requirement. does it make the plan simpler and/or improve app performance (les loading/decrypting time) if we don't encrypt photos?

### Follow-up 4

> yes re-enter plan mode with the simplified plan. agree to Store driveFileId in Automerge and regenerate thumbnailLink via files.get on demand if this is your recommendation

### Follow-up 5 (DRY + missing-photo handling)

> Review the plan again to make sure you are implementing in the most optimal and efficient way, striving for elegance and simplicity, and following all DRY principles - you are not re-writing or repeating any code. Check existing helpers, functions, composables, etc or other code where a solution already exists, check existing components and other reusable UI elements. If you are re-implementing any code that already exists elsewhere, including a UI modal or component that exists elsewhere (or a very close version exists), function, helper, composable, etc, considering refactoring this into a generic item now as opposed to duplicating code and refactoring later. Rewrite the plan ensuring that the design and flow and functionality is implemented in the simplest and most efficient/optimized way without any duplication, overly complicated flows, or code bloat where not necessary.
>
> Also if a user moves or deletes a file, or the photo cannot be found for some reason, ensure this is handled gracefully - show a clear icon/message indicating the photo cannot be found. just ensure the scenario is handled and user is made aware the photo file cannot be found, give an option to find it or upload again.

### Follow-up 6 (fresh-eyes pass)

> Given the importance and complexity of this component, take one more pass at the plan and review again with fresh eyes. Review all activities proposed and confirm again that we are applying the most simple, secure, robust, and elegant solution, strictly following DRY principles, and avoiding introducing any bugs or side effects. Ensure that the relevant unit tests or end to end tests are created and/or revised to account for this change. Review the plan once more to ensure it is complete and accurate and follows the above guidance.

### Follow-up 7 (architectural decisions from AskUserQuestion)

> Photo sharing: Share the app folder (extend invite flow to share `beanies.family` app folder with each member's email).
> Full-size cache: Drive CDN + browser cache (no IndexedDB photo cache; use `thumbnailLink?sz=w2048` for full-size).

### Follow-up 8

> save the plan file to the plans dir, commit and push. do not implement anything yet

### Follow-up 9

> DO NOT IMPLEMENT - JUST SAVE TO PLANS DIR

</details>
