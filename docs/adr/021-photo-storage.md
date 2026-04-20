# ADR-021: Photo Storage Architecture

- **Status:** Accepted
- **Date:** 2026-04-19

## Context

beanies.family needed a general-purpose photo attachment capability — birthday-invitation photos on activities, pickup-location photos, favorite-food images, real photos of family members instead of beanie icons. Photos are qualitatively different from the structured entity data we already store:

- **Large.** Even a modest phone photo is 1–3 MB uncompressed. Embedding them in the Automerge document would bloat every sync payload and merge pass.
- **Binary.** Automerge and the `.beanpod` envelope are optimized for small structured data.
- **Occasional.** A photo attached to an activity is viewed a few times, not re-rendered constantly.

We needed a storage approach that keeps the CRDT small, works local-first without a backend, protects family privacy, and makes photos accessible to all members of a multi-member family.

## Decision

We store photo **bytes** in the user's Google Drive (inside the shared `beanies.family` app folder), and **metadata only** in the Automerge document.

Four specific choices:

### 1. Photos are not encrypted

`.beanpod` remains AES-GCM encrypted because it holds structured, sensitive family data (names, dates, financial accounts, todos with content). Photos are different: they live in the user's own Drive, which the user already trusts Google with for every other photo, document, and email in their account. Adding AES-GCM to the photo path would provide real protection only against Google's internal scanning systems — it wouldn't defend against any new threat we care about.

Skipping encryption is a meaningful simplification:

- No `photoCrypto` module; no per-photo content keys wrapped by the family key
- Drive's native `thumbnailLink` CDN serves thumbnails directly as `<img src>` — no BlurHash placeholder, no client-side thumbnail generation, no decrypt-before-render
- Smaller Automerge metadata (no wrapped-key field)
- Photos can be downloaded via `<a href download>` without blob marshalling

### 2. Multi-member access via app-folder sharing

`.beanpod` is shared with each family member via the Drive permissions API (`shareFileWithEmail`). We extend that to **also share the `.beanpod`'s parent folder** (the `beanies.family` app folder) with each invitee. Any photo uploaded to that folder by any member inherits the folder's share grants — no per-photo sharing required.

- **Invite flow**: after sharing `.beanpod`, resolve the `.beanpod`'s parent via `files.get(fileId, 'parents')` and call `shareFileWithEmail(folderId, ...)` with the same email. Folder share failure is non-fatal for the invite itself.
- **Migration**: for families created before this ADR, a one-time sweep runs on app start (gated by `driveFileId` becoming available). `listFilePermissions` on the folder produces the set of already-shared emails; any family-member email not in that set is shared.

The trust model matches `.beanpod`: every member is a writer, so any member could in principle delete any photo. This is a deliberate tradeoff — finer-grained permissions (reader folder + per-file writer from the uploader) would require per-file API calls on every upload and every member-change, which we judged not worth the complexity for a product whose trust model is "your family."

#### `drive.file` scope implications — why folder sharing alone isn't enough

The app uses the `drive.file` OAuth scope (per-file authorization), not the broader `drive` scope. Two consequences that drove the Drive Picker flow:

1. **Folder sharing at the Drive permissions level does NOT grant the joining member's app API access to sibling files.** Sharing the `beanies.family` folder with `user@example.com` makes the folder + its contents visible at drive.google.com and downloadable via that UI, but Drive API calls authenticated with the joining member's OAuth token still 404 on those sibling files. `drive.file` only exposes files the app created **in that user's Drive** or files the user explicitly authorized via Drive Picker or "Open with."

2. **The join flow must Picker-pick the folder, not the `.beanpod` file.** Picker-picking a folder grants `drive.file` to the folder AND all descendants — the `.beanpod` file plus every current and future photo — in a single user gesture. Picker-picking the file alone grants access only to that one file; photos remain unreachable. The join UI in `JoinPodView.vue` picks the folder and calls `findBeanpodInFolder` (driveService) to resolve the `.beanpod` inside — all subsequent code paths continue with the same file-ID semantics as before.

3. **Recovery path for members who joined before the folder-pick flow.** `PhotoAccessRecoveryBanner` watches `photoStore.hasBrokenPhotos` (any Drive 404/403 during photo resolution) and offers a "Reconnect" action that opens the same folder Picker. `useRecoverPhotoAccess` validates the picked folder contains this pod's `.beanpod` (prevents accidentally granting access to a different family's folder), clears photoStore's unresolved/URL caches, and lets the next render resolve fresh under the newly-granted folder-wide scope.

### 3. No IndexedDB photo cache

Drive's `thumbnailLink` returns a signed `lh3.googleusercontent.com` URL. The same URL accepts a `=s{N}` suffix (or appended `?sz=w{N}`) to request a resized rendering — up to the source resolution. We use the same mechanism for thumbnails (`=s400`) and for full-size viewer images (`=s2048`), binding them directly to `<img src>`.

The browser's native image cache handles repeat requests. We do NOT maintain an IndexedDB full-size blob cache. The tradeoffs:

- The first viewer open per session refetches the full-size image. For a family-planning app where photo-viewing is occasional, the round-trip is acceptable.
- Thumbnails are effectively free after the first render in a session.
- No blob-URL lifecycle to manage. No LRU eviction. No cache DB to version.
- Offline viewing after sign-out relies on the browser's image cache. Acceptable for v1; we can add an IndexedDB cache in a later plan if users report needing stronger offline behavior.

### 4. Missing-photo UX is runtime state, not persistent

When Drive returns 404 or 403 (file moved, deleted, permission revoked), `photoStore` flips a runtime `unresolvedIds` flag for that photo. UI shows a broken-image tile; the viewer surfaces **Replace** (upload a new file, the store swaps `driveFileId` on the existing `PhotoAttachment` record and keeps the UUID stable so entity references survive) and **Remove** (tombstone) actions.

The unresolved flag is not written to Automerge. A photo unresolved in one session may resolve in another (e.g. the user restores the Drive file from trash). This keeps the CRDT clean and avoids sync storms over transient access issues.

## Consequences

### Positive

- Dramatic simplification vs. the encrypted-blob design we originally considered: five fewer modules (`photoCrypto`, `photoBlurHash`, `photoCache`, per-photo content-key management, per-file share management), one fewer npm dependency (`blurhash`), and ~150 bytes of metadata per photo vs. ~300.
- Multi-member access is a single folder share on invite + a one-time migration, vs. an N×M per-file share sweep that would also have to rerun on every add/remove member event.
- The generalization of `driveService.createFile` to accept `Blob | Uint8Array | string` is a cleaner surface that can be reused for future non-JSON uploads (avatars, exported reports) without a parallel HTTP path.
- Tombstone + 24h GC (plus zero-reference cascade, gated on integration plans registering their collection) keeps CRDT-merge semantics safe under concurrent edits — deleting a photo doesn't race against someone else using it.

### Negative

- Google can read plaintext photo bytes via the same APIs it can read any other Drive content. If a family's threat model requires zero-knowledge photo storage, this design doesn't meet it. (We'd add an encrypted blob path in a follow-up if that requirement surfaces.)
- The folder is writer-shared, so any family member could in principle delete another member's photos. Within a family, trust is presumed. If users report abuse, we'd revisit with a reader-folder + per-file-writer split.
- Drive `thumbnailLink` URLs are signed and expire (typically within a few hours). We never persist them — every resolution goes through `files.get` with a 30-min in-memory TTL. On 403 we refresh once before flipping to the unresolved state.

### Neutral

- Photos stay bound to the uploader's Google account. `.beanpod` export/import is unchanged; the export contains only metadata. If a user signs out of their Google account, they lose access to photos they uploaded — this matches the existing behavior of the `.beanpod` file itself. Portability across providers is a follow-up concern.

## Alternatives considered

- **S3 with encrypted blobs + presigned URLs.** Would require a backend to mint presigned URLs, which breaks the no-backend posture. Encryption is valuable if we ever ship there, but the incremental privacy vs. Drive is small, and the operational cost is high.
- **Per-file sharing in Drive (no folder share).** Solves the multi-member access problem without trusting the folder, but adds a per-photo share call on every upload and a sweep on every member-added event. The API load scales with `families × photos × members` — unworkable even at small scale. Not chosen.
- **Encrypted blobs in Drive (owned folder, not shared).** Best privacy, but the thumbnailLink CDN wouldn't work (Google can't generate thumbnails of ciphertext), so we'd need client-side thumbnail generation (BlurHash or encrypted micro-JPEG) and decrypt-on-render. Net result: ~4× the client code, worse UX. Not chosen for this round; remains the upgrade path if privacy requirements change.

## Related

- [ADR-016: Google Drive Integration](016-google-drive-integration.md)
- [ADR-018: Automerge CRDT Migration](018-automerge-crdt-migration.md)
- [ADR-019: Family Key Encryption](019-family-key-encryption.md)
- Plan: `docs/plans/2026-04-18-photos-general-capability.md`
