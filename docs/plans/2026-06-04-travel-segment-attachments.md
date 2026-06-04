# Plan: Attach images & PDFs to travel plan segments

> Date: 2026-06-04
> Related issues: None — direct implementation (no GitHub issue; Notion tracker intake only)
> Plan file: `docs/plans/2026-06-04-travel-segment-attachments.md`

## User Story

As a user, I often have images, screenshots, or PDFs of my travel plans or official itineraries from airlines, hotels, and other providers. I want to upload and associate these docs/images with my travel plan segments so I can always refer back to my original booking or itinerary and ensure I have all the details captured in beanies.

## Context

Travel plan segments today hold only typed fields (airline, flight #, dates, booking ref…). There's no way to keep the _source_ document — the airline PDF, the hotel confirmation screenshot — alongside the trip. Users want to attach the original booking/itinerary so they can always refer back and confirm every detail was entered.

Activities already support photo attachments via a mature, format-agnostic-at-the-storage-layer pipeline. This feature reuses that pipeline for travel segments and extends it to also accept **PDFs** (the activity system is image-only today).

**Scope decisions (greg, 2026-06-04):**

- Attachments apply to **booking segments only**: `VacationTravelSegment`, `VacationAccommodation`, `VacationTransportation`. Vacation _ideas_ and trip-level attachments are **out of scope**.
- **Mockup-first**: produce a `/frontend-design` mockup (mobile + desktop) and get greg's treatment pick **before** writing feature code.

## The critical architectural fact (drives the whole design)

The photo pipeline attaches a finished upload to its parent via `attachPhotoToEntity(doc, collection, entityId, photoId)` in `photoStore.ts:858`, which does `doc[collection][entityId].photoIds.push(photoId)` — it assumes a **flat, top-level, id-keyed collection**. Every existing photo host (activities, medications, recipes, cookLogs, milestones, avatars) is exactly that.

**Travel segments are nested array items** inside `doc.vacations[vacationId].{travelSegments|accommodations|transportation}[]`. They are _not_ addressable as `doc[collection][entityId]`. Naive reuse (`collection: 'vacations', entityId: segmentId`) would cause **two silent failures**:

1. `attachPhotoToEntity` finds no `doc.vacations[segmentId]` entity → the `entity.photoIds` append **no-ops**. This is the safety net that covers "modal/wizard closed mid-upload" and, critically, **every offline/queued upload** (the queue flush handler `handleQueuedUpload` → `finalizeUpload` → `attachPhotoToEntity`). So queued segment-photo uploads would never get referenced.
2. `collectReferencedPhotoIds` (`photoStore.ts:772`, the GC's reference scan) only walks `doc[collection][*].photoIds` / `avatarPhotoId`. It would never see segment photoIds → every segment attachment looks like an **orphan** and gets **deleted by `gcOrphans` after the 24h tombstone grace**.

**Therefore** the plan makes the photo store's _entity-addressing_ layer pluggable (two functions only), with the existing flat behavior as the default. This is required for correctness, not merely elegance. Note: avatars already need non-flat handling (scalar `avatarPhotoId`, hardcoded inline in `collectReferencedPhotoIds`) — that's precedent for _needing_ this, not for the hook mechanism itself (which is net-new). The registry change folds that existing avatar special-case into the same one registration shape (see Step 2).

## What's reusable as-is vs. what needs extension

**Reusable with no change** (storage substrate is format-agnostic):

- `driveService.createFile()` — accepts any Blob + MIME.
- `finalizeUpload` Drive→Automerge write, rollback-on-failure, public-link grant.
- `photoUploadQueue` (offline queue) — stores blob + mime + entity tag, retries.
- Tombstone + 24h GC machinery, `getPublicUrl`/`getBlobUrl`, thumbnail caching.
- The `doc.photos[]` store and `PhotoAttachment` record (the name stays "photo"; we do **not** rename the substrate — see Important Notes).

**Needs an extension/branch:**

- `photoStore.addPhoto` — image-only `compress()` call. Needs a **PDF passthrough branch** (skip canvas compression, store raw blob, `mime: 'application/pdf'`, `width/height: 0`, original filename).
- `attachPhotoToEntity` + `collectReferencedPhotoIds` — make **pluggable** per collection (default = current flat behavior; vacations registers nested locators).
- `usePhotos` — MIME whitelist is image-only. Add an `accept` option (`'images'` default | `'imagesAndPdf'`) + a PDF size cap + lightweight `%PDF` magic-byte check.
- `PhotoAttachments.vue` — file-picker / drop-zone accept strings are image-only; thumbnail rendering assumes images. Add an `allowDocuments` prop.
- `PhotoThumbnail.vue` / `PhotoViewer.vue` / `PhotoIndicator.vue` — `<img>`-only. Add a **PDF branch** (document tile + filename; lightbox opens/embeds the PDF).
- `PhotoAttachment` model — add optional `fileName?: string` (so PDFs show their real name; harmless for images).
- The three segment interfaces — add `photoIds?: UUID[]`.

## Requirements

1. Attach one or more **images OR PDFs** to a travel segment (the three booking-segment types).
2. Supported formats: images (same set as activities: jpeg/png/webp/heic/heif) **and** `application/pdf`.
3. Attach from **both** the creation wizard (Step 2/3/4 segment cards) **and** the per-segment edit drawers.
4. **View** attachments: images in the existing lightbox; PDFs open/embed for reading.
5. A clear **"has attachment" indicator** (count) on segment cards in the timeline/detail view.
6. **Remove/delete** an attachment at any time.
7. Offline-safe: uploads queue when offline and finalize on reconnect, with the reference correctly attached to the nested segment (the core fix above).
8. No silent failures: every fail path (compression, oversized PDF, wrong type, Drive failure, queue-write failure, missing-after-delete) surfaces a clear toast + console diagnostic.
9. All new user-visible text via `uiStrings.ts` (`en` + `beanie`) + `npm run translate`.
10. Help Center: update the travel article to document attaching booking documents.

## Important Notes & Caveats

- **Do NOT rename the `photos` substrate.** The `doc.photos` collection, `PhotoAttachment` type, and `photoStore` keep their names even though they now also hold PDFs — renaming would ripple through Automerge doc keys, GC, and every existing call site for zero user benefit. "Attachment/document" is a UI-layer label only.
- **The GC hook is the single highest-risk path.** A `collect` hook that throws and returns a partial reference set makes every photo app-wide look orphaned → deleted. Fail-safe (skip the sweep) is mandatory.
- **Cloud sync is required** to attach (same as photos — `photosEnabled` gates it). Surface the existing `photos.cloudRequired` toast.
- **PDFs are stored raw (uncompressed).** Only metadata (id, driveFileId, mime, fileName) lives in the encrypted `.beanpod`; bytes live in Drive — so this does not bloat the synced doc.
- **Don't widen activity/medication/recipe pickers.** `allowDocuments` defaults false; only the travel surface opts in.

## Assumptions

> **Review before implementation.** Valid at planning time (2026-06-04).

1. Wizard segment ids are assigned at add-time (`generateUUID()` in `VacationStep2.vue`), so a stable segment id exists before the vacation is saved. (Pass 2 verified this for travel segments; confirm the same for accommodation/transportation steps.)
2. `doc.vacations` is an id-keyed collection (consistent with `doc.activities` etc.), so the `collect`/`attach` hooks iterate `Object.values(doc.vacations)`. Confirm the exact doc shape from `vacationRepository`.
3. A per-segment cap of **6** attachments is acceptable. Adjustable.
4. PDF size cap of **10 MB** is acceptable for booking docs. Adjustable.
5. ~~The lh3 CDN serves raw PDF bytes~~ — **corrected in Pass 4: it does not (image-only CDN).** PDFs use `getBlobUrl` (authorized `alt=media`) as the primary view/download source. No remaining unverified assumption here.

## Approach

### Step 0 — Mockup first (blocking gate)

Use `/frontend-design` to produce `docs/mockups/travel-segment-attachments-2026-06-04.html` showing, at mobile + desktop widths:

- the attach control inside an expanded segment card / edit drawer (image + PDF tiles side by side),
- the "has attachment" indicator on a collapsed timeline card,
- the thumbnail strip (image thumb vs. a PDF "document tile" with filename + 📄),
- the image lightbox and the PDF view treatment (inline embed + prominent "Open" fallback).
  Get greg's treatment pick before any feature code. Match existing `PhotoAttachments` visual language and the three-tier modal system.

**Mockup DONE + treatments chosen (greg, 2026-06-04)** — `docs/mockups/travel-segment-attachments-2026-06-04.html`:

- **PDF document tile → Treatment A "Boarding-pass stub"**: Heritage Orange→Terracotta top edge, perforated tear line, `PDF · <filename>` footer. The `DocumentTile.vue` primitive (Step 4) implements this look.
- **Has-attachment indicator → Treatment A "Paperclip chip"**: a small `📎 N` chip in slate tint, left of the status pill, hidden when count is 0. The `PhotoIndicator.vue` `icon` prop (Step 4) carries the 📎.
- Shared pieces (attach dashed strip, image lightbox, PDF viewer with inline embed + "Open in new tab" fallback) confirmed in the recommended single style.

### Step 1 — Data model + kind helper

- `src/types/models.ts`: add `photoIds?: UUID[]` to `VacationTravelSegment`, `VacationAccommodation`, `VacationTransportation` (mirrors `FamilyActivity.photoIds`); add optional `fileName?: string` to `PhotoAttachment`. No migration needed (all additive optionals). Add a doc comment on `PhotoAttachment` stating it is now the **attachment substrate** — also holds non-image documents (PDFs); for non-images `width`/`height` are `0` and `fileName` carries the original name; named "photo" for storage-compat, do not assume image.
- **Single source of truth for kind** — new `src/utils/attachmentKind.ts`: `export type AttachmentKind = 'image' | 'pdf'`, `attachmentKind(p: Pick<PhotoAttachment,'mime'>): AttachmentKind`, `isPdf(p): boolean`. **Every** image-vs-PDF branch (usePhotos accept test, addPhoto compress-vs-passthrough, all media components, the Replace-button visibility) goes through this — never a raw `mime` string comparison scattered per-site. (Optional: `type Attachment = PhotoAttachment` alias for new travel-facing code to read honestly without a rename.)

### Step 2 — Photo store: PDF passthrough + pluggable entity addressing (`src/stores/photoStore.ts`)

- **PDF branch in `addPhoto`**: when `file.type === 'application/pdf'`, skip `compress()`; build the payload from the raw file — `mime: 'application/pdf'`, `width: 0`, `height: 0`, `filename: beanies-doc-${photoId}.pdf` (used as the Drive object name in `finalizeUpload`), and a new `fileName: file.name`. Everything downstream (queue, Drive, write, rollback) is unchanged. **The PDF branch performs NO validation — it trusts `usePhotos.add` (Step 3) to have already gated size/type/magic-byte.** Contract note: `addPhoto`'s only typed throw for PDFs is therefore a Drive/queue error, never `CompressionError`.
- **Carry `fileName` through the queue too**: add `fileName?: string` to `QueuedPhotoUpload` (`photoUploadQueue.ts`) and to the `payload` object in `addPhoto`, and write it into the `PhotoAttachment` in `finalizeUpload` **only when present** (guard like the existing `if (payload.createdBy)` — Automerge rejects `undefined`). Without this the original filename is lost on the offline path.
- **Pluggable addressing — one consistent registry (retires the avatar special-case, not adds beside it):** change `photoReferringCollections` from `Set<string>` to `Map<string, PhotoCollectionHooks>` where hooks = `{ attach(doc, entityId, photoId), collect(doc): Iterable<UUID> }`. The existing `registerPhotoCollection(name)` (no-hooks) keeps working by synthesizing the **default flat hooks** (today's `doc[collection][entityId].photoIds` behavior), so the other 5 call sites are untouched. `attachPhotoToEntity` and `collectReferencedPhotoIds` become plain loops over the registered hooks. **Delete the hardcoded inline `avatarPhotoId` branch** in `collectReferencedPhotoIds` and instead register `familyMembers` with an avatar-shaped `collect` (preserving exact current behavior) — one mental model, not two. Register `'vacations'` with:
  - a shared traversal helper `forEachBookingSegment(doc, fn)` that yields every segment across all vacations × the three booking arrays. The array-key list (`['travelSegments','accommodations','transportation']`) lives in **one** `const`, with a comment tying it to the three segment interfaces in `models.ts` (a future segment type = one-line add).
  - `attach`: use the helper to find the segment by `id` (globally-unique UUID) and push `photoId` to its `photoIds`. **If the vacation exists in the doc but no matching segment id is found → `console.warn` (real-bug / id-drift signal), distinct from the expected silent no-op when the vacation isn't in the doc yet (wizard).**
  - `collect`: use the same helper to gather `photoIds` from every segment.
- **Hook robustness (highest-risk path — prevents mass data loss):** the photoStore MUST wrap every registered hook in try/catch. `collectReferencedPhotoIds` gates deletion of _every_ photo (`gcOrphans`: `orphaned = ... && !referenced.has(id)`) — if a `collect` hook throws and we returned an empty/partial set, the whole app's photos would look orphaned and be deleted. **On any `collect` hook throw: log `console.error` and ABORT the GC sweep for that run (fail-safe = keep everything).** On an `attach` hook throw: log `console.error`, leave the upload's doc record in place (the caller's `updatePhotoIds` emit is the primary reference path anyway).
- **`photoIdsFor` is a THIRD flat-addressing surface** (`photoStore.ts:840`, reads `doc[collection][entityId].photoIds`; used by `usePhotoEntityBinding`'s `initialPhotoIds`). We deliberately do **not** make it pluggable — instead vacation callers supply `initialPhotoIds` by reading the segment out of `vacationStore.getVacationById(vacationId)` directly (simpler; avoids a third pluggable surface). See Step 5.

### Step 3 — `usePhotos` (`src/composables/usePhotos.ts`)

- Add `accept?: 'images' | 'imagesAndPdf'` (default `'images'`). When `'imagesAndPdf'`, the accepted-MIME test also passes `application/pdf` / `.pdf`.
- **Fold PDF validation into the EXISTING `accepted`/`rejected` loop** (lines 114–125) — do not add a parallel validation pass — but **track size-rejected PDFs in a SEPARATE bucket** (e.g. `rejectedOversize[]`) from type-rejected files, so they get the distinct `photos.pdfTooLarge` toast and NOT the generic `photos.invalidType` (which would be misleading — violates Requirement 8). Size cap = a module constant (default **10 MB**). The magic-byte check scans the first ~1KB for `%PDF-` (tolerates a few leading bytes; `file.slice(0,1024).arrayBuffer()`) — `add` is already async so awaiting is fine, but **only read bytes for `application/pdf` candidates** (skip the latency for images). Images keep going through `compress` (no cap — they're downscaled).
- **Cap for the travel surface**: pass an explicit `max` (proposed **6**, since multi-page itineraries legitimately split into several PDFs/screenshots) rather than silently inheriting `MAX_PHOTOS_PER_SET` (4).

### Step 4 — Media components (`src/components/media/`)

- `PhotoAttachments.vue`: add `allowDocuments?: boolean` (default false). When true: widen **both** the `useFileDrop` accept (currently `['image/*', '.heic', '.heif']`) **and** the `galleryPicker` accept (currently `'image/*'`) to include `application/pdf` / `.pdf`, pass `accept: 'imagesAndPdf'` into `usePhotos`, and render PDF entries as document tiles. Keep the **camera-capture button image-only** (`cameraPicker` unchanged). `multiple` logic unaffected.
- **Shared `DocumentTile.vue` primitive** (📄 + truncated `fileName` + aria) so the document-tile markup lives once — consumed by `PhotoThumbnail`, the `PhotoAttachments` strip, and the timeline strip (not triplicated).
- `PhotoThumbnail.vue`: branch on `attachmentKind(store.photos[id])` (the Step 1 helper — not a raw `mime` compare). Image → existing `<img>` via `getPublicUrl`. PDF → `DocumentTile`, tappable to open the viewer.
- `PhotoViewer.vue`: image path unchanged (`getPublicUrl`). PDF path (branch on `attachmentKind`) → **use `getBlobUrl(photoId)` as the PRIMARY source**, NOT `getPublicUrl`. Verified: `getPublicUrl` always returns the lh3 _image_ CDN URL with a hard `=w{px}` directive (`photoStore.ts:509-515`) — it renders images and cannot serve raw `application/pdf` bytes; and a cross-origin lh3 href makes the browser ignore the `<a download>` filename hint. `getBlobUrl` does an authorized `alt=media` download → same-origin `URL.createObjectURL` (correct content type, working `download` filename, inline `<iframe>` renders). Use the blob URL for the `<iframe>`/`<embed>` AND the **"Open in new tab"** / download href (mobile browsers often won't inline-render). The `@deprecated` note on `getBlobUrl` does **not** apply here — it's the only verified raw-bytes path; PDFs are a legitimate reason it stays. **Do NOT `URL.revokeObjectURL` on unmount** — `getBlobUrl` caches per `driveFileId` and `invalidateThumbCache` already handles revocation; blindly revoking breaks the next open. **Replace/Download:** `replacePhotoFile` unconditionally calls `compress()` and `replacePicker` accepts only images → the Replace control's `v-if` tests `attachmentKind(...) === 'image'` (hidden for PDFs); set the Download `<a download>` to the original `fileName`. Security note: the iframe only ever renders the family's own uploaded bytes (URL lives in the family-key-encrypted doc, same trust boundary as images per ADR-021) — no untrusted remote-PDF ingestion, so no `sandbox` hardening required.
- `PhotoIndicator.vue`: add an optional `icon` prop so the travel surface can show 📎 (paperclip) instead of 📷. Counting logic unchanged.

### Step 5 — Wire travel UI

- **One store action owns the segment merge (no inline spreads in 5 callers):** add `vacationStore.updateSegmentPhotoIds(vacationId, segmentId, photoIds)` — it finds the segment across the three arrays, merges `{ ...segment, photoIds }` by index, and persists via `updateVacation`. The array-index merge mechanics live in the store (tested once), not smeared across UI components. The `usePhotoEntityBinding` adapter's `update` becomes simply `(_segId, { photoIds }) => vacationStore.updateSegmentPhotoIds(vacationId, segment.id, photoIds)`. **`initialPhotoIds`** is supplied by reading the segment from `getVacationById(vacationId)` (NOT `photoStore.photoIdsFor`, which is flat-only — see Step 2).
- **Edit drawers** (`TravelSegmentEditModal.vue`, `AccommodationEditModal.vue`, `TransportationEditModal.vue`): add a "Booking documents" `PhotoAttachments` section (`allowDocuments`, `collection: 'vacations'`, `entityId: segment.id`, explicit `max`). The save handlers already rebuild the array by index — merge `photoIds` into that same spread.
- **Wizard (Step 2/3/4 host components, which own the segment slot content — NOT `VacationSegmentCard`, which is a generic presentational shell):** add the same attachment section. Segment ids are confirmed assigned on add (`VacationStep2.vue` `generateUUID()`), so the id is stable before Save. **In the wizard the vacation is not yet in `doc.vacations`, so the registered `attach` hook silently no-ops — persistence relies entirely on `usePhotos`' `update:photoIds` emit landing in the local `segments` state and being saved with the vacation.** The `attach`/`collect` hooks only matter once the vacation exists (edit drawers + offline queue flush). Abandoned wizard uploads correctly orphan → GC.
- **Timeline/detail view** (`TravelPlansPage.vue`, the segment slot consumers at the timeline render — NOT `VacationSegmentCard` internals): render the attachment indicator (count) on the collapsed header (via an optional card slot/prop) and a thumbnail strip in the expanded body that opens the viewer.

### Step 6 — Register collections for GC (`src/App.vue`, alongside the existing `registerPhotoCollection` calls)

- Call `registerPhotoCollection('vacations', { attach, collect })` so GC sees segment references and the queue flush attaches correctly.
- **CRITICAL — `familyMembers` MUST be registered with an avatar-shaped `collect`, never the default flat hook.** `FamilyMember` has a scalar `avatarPhotoId?` and **no `photoIds`** field (`models.ts:118`); the default flat `collect` reads only `entity.photoIds` → yields nothing for avatars. Because `gcOrphans` deletes orphans with **NO grace period** (orphaned is OR'd with tombstone-expiry, not gated by it), a wrong registration would **wipe every user avatar on the first GC run.** Register `registerPhotoCollection('familyMembers', { collect: avatarCollect, attach: avatarAttach })` where `avatarCollect` iterates `Object.values(doc.familyMembers)` yielding each truthy `m.avatarPhotoId`. `avatarAttach` is a **no-op + `console.warn`** (avatars never flow through `attachPhotoToEntity` or the queue — the caller sets `avatarPhotoId` directly), so it must NOT do a `photoIds.push`. This exactly preserves today's inline behavior (and is strictly more correct — only `familyMembers` scans `avatarPhotoId` now, vs. every collection before).
- Both vacation hooks are try/catch-wrapped by the photoStore (Step 2).

### Step 7 — i18n + Help + tests

- New `uiStrings.ts` keys (en + beanie): section label "Booking documents", add-document control, PDF-too-large / open-PDF / document-tile aria labels. Run `npm run translate` (regenerate zh). Verify `scripts/updateTranslations.mjs` still parses.
- Help Center: update `travel-plans-and-vacations` to document attaching booking docs/itineraries.
- Tests: `addPhoto` PDF branch (passthrough, no compression, fileName recorded); pluggable attach + collect for nested vacations (attach finds the right segment; GC keeps referenced segment photos, deletes true orphans); `usePhotos` accept option + PDF size/magic-byte rejection; `PhotoThumbnail`/`PhotoViewer` PDF branch; model field presence.

## Files Affected

- `src/types/models.ts` — `photoIds?` on 3 segment types; `fileName?` + doc comment on `PhotoAttachment`.
- `src/utils/attachmentKind.ts` (new) — `AttachmentKind`, `attachmentKind()`, `isPdf()` single source of truth.
- `src/stores/photoStore.ts` — PDF branch in `addPhoto`; registry → `Map<name, hooks>` with default flat hooks, try/catch-wrapped; retire inline `avatarPhotoId` branch (register `familyMembers` hooks); `forEachBookingSegment` + vacations hooks; record `fileName`.
- `src/stores/vacationStore.ts` — new `updateSegmentPhotoIds(vacationId, segmentId, photoIds)` action.
- `src/components/media/DocumentTile.vue` (new) — shared 📄 + filename tile.
- `src/services/sync/photoUploadQueue.ts` — add `fileName?` to `QueuedPhotoUpload` (preserves original name on the offline path).
- `src/composables/usePhotos.ts` — `accept` option, PDF size cap + magic-byte check folded into the existing rejected-file loop, explicit `max`, toasts.
- `src/composables/usePhotoEntityBinding.ts` — used via a nested-segment adapter (no change to the composable itself; callers supply `update`/`initialPhotoIds`).
- `src/components/media/PhotoAttachments.vue` — `allowDocuments` prop, widened accept, PDF tiles.
- `src/components/media/PhotoThumbnail.vue` — PDF document-tile branch.
- `src/components/media/PhotoViewer.vue` — PDF embed/open branch.
- `src/components/media/PhotoIndicator.vue` — optional `icon` prop.
- `src/components/travel/TravelSegmentEditModal.vue`, `AccommodationEditModal.vue`, `TransportationEditModal.vue` — attachment section.
- `src/components/vacation/VacationStep2.vue`, `VacationStep3.vue`, `VacationStep4.vue` — attachment section in the segment slot content (edit).
- `src/pages/TravelPlansPage.vue` — timeline indicator/strip wiring (+ an optional `VacationSegmentCard.vue` header slot/prop for the indicator).
- `src/App.vue` — register `'vacations'` hooks + migrate `familyMembers` to avatar-shaped hooks.
- `src/services/translation/uiStrings.ts` (+ zh regen) — new strings.
- `src/content/help/*` — `travel-plans-and-vacations` update.
- `docs/mockups/travel-segment-attachments-2026-06-04.html` — mockup (Step 0).
- Test files alongside the above.

## Help Center Coverage

- **Action**: update existing
- **Category**: `features`
- **Slug**: `travel-plans-and-vacations` (existing)
- **Title**: (unchanged)
- **Scope**: Add a short section explaining that each travel segment can now hold images and PDFs of the original booking/itinerary — how to attach from the wizard or the edit drawer, that they sync to the family's encrypted Drive like photos, how to view (image lightbox / open PDF), and how to remove one.
- **Notes**: Mention attachments need cloud sync on (same as photos); deleting an attachment is reversible only within the 24h grace before GC; PDFs have a ~10 MB cap.

## Acceptance Criteria

- [ ] Images **and** PDFs attach to travel segments (travel/accommodation/transportation) from both the creation wizard and the edit drawers.
- [ ] A "has attachment" indicator (count) shows on segment cards in the timeline.
- [ ] Images open in the lightbox; PDFs open/embed for reading.
- [ ] Attachments can be removed at any time.
- [ ] Offline uploads queue and finalize on reconnect with the reference correctly attached to the nested segment (no orphaning/GC of valid segment attachments) — verified by test.
- [ ] No silent failures: wrong-type, oversized-PDF, compression, Drive, and queue-write failures each show a clear toast + console diagnostic.
- [ ] Mockup approved by greg before feature code (Step 0).
- [ ] All new strings in `uiStrings.ts` (en + beanie); `npm run translate` run; zh regenerated.
- [ ] `travel-plans-and-vacations` Help article updated to match shipped behavior.
- [ ] `npm run validate` green (type-check, lint, format, unit tests, build).

## Testing Plan

1. **Unit**: PDF passthrough in `addPhoto` (no `compress` call, `fileName` recorded, mime/width/height correct); pluggable attach locates the right nested segment + `console.warn`s on id-drift; GC `collect` retains referenced segment photos and removes genuine orphans; **avatar GC behavior preserved after the registry migration (familyMembers `collect` yields `avatarPhotoId`s so avatars are NOT GC'd)** — this is the regression guard for the highest-consequence change; GC fail-safe (a throwing `collect` hook aborts the sweep, deletes nothing); `usePhotos` accepts pdf only when opted-in, rejects oversized (distinct toast) and garbage PDFs; `attachmentKind()` mapping; component PDF branches render.
2. **Manual (run the app)**: attach an image and a PDF to a flight segment in the edit drawer → both render (thumb + doc tile), indicator shows "2", lightbox shows the image, PDF opens. Repeat in the creation wizard, then Save → reopen the trip → attachments persisted on the segment. Remove one → disappears. Toggle offline → attach → see pending tile → reconnect → finalizes and stays referenced (not GC'd). Try a >10 MB PDF and a `.txt` renamed `.pdf` → clear rejections.
3. **Cross-segment**: confirm accommodation + transportation drawers behave identically.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted full plan; identified the nested-segment attach/GC hazard as the core design driver; chose pluggable entity-addressing + PDF passthrough reusing the format-agnostic storage substrate.
- **Pass 2 (DRY + error handling)**: Verified all reuse claims against code. Fixed: `usePhotoEntityBinding` needs a nested adapter + `initialPhotoIds` from `getVacationById` (not the flat `photoIdsFor`); wizard online attach no-ops (persistence rides the `update:photoIds` emit); `fileName` must be added to `QueuedPhotoUpload` too; `VacationSegmentCard` is presentational (target Step2/3/4 + TravelPlansPage hosts); PDF viewer should use `getPublicUrl` not deprecated `getBlobUrl`; fold PDF validation into the existing rejected-file loop; disable in-viewer Replace for PDFs; **wrap GC `collect`/`attach` hooks in try/catch and fail-safe-skip the sweep on throw (prevents mass photo deletion)**; set explicit `max: 6`.
- **Pass 3 (Sustainability)**: Centralized kind-discrimination into one `attachmentKind()`/`isPdf()` helper (was scattered across 5 sites); extracted a shared `DocumentTile.vue`; turned the collection registry into one `Map<name, hooks>` shape that retires the hardcoded `avatarPhotoId` special-case instead of layering beside it; factored the 3-array vacation walk into one `forEachBookingSegment` helper used by both `attach` and `collect`; moved the segment photoIds merge into a single `vacationStore.updateSegmentPhotoIds` action (was inline spreads in 5 callers); `attach` now `console.warn`s on real id-drift vs. the expected wizard no-op; added a `PhotoAttachment` doc comment + optional `Attachment` alias. Kept the GC fail-safe verbatim.
- **Pass 4 (Fresh-eyes sweep)**: Caught one real blocker — PDF view/download must use `getBlobUrl` (same-origin raw bytes + working `download` filename), NOT `getPublicUrl` (lh3 is an image-only CDN, can't serve PDF bytes, and cross-origin breaks the download hint); corrected Step 4 + Assumption 5, and noted not to revoke the cached blob URL on unmount. Bolted down two footguns: `familyMembers` must register an avatar-shaped `collect` (else the no-grace-period GC wipes every avatar) with a no-op `attach`; oversized PDFs need a separate rejection bucket so they get `photos.pdfTooLarge` not the misleading `invalidType`. Verified (no change): registry `Set→Map` migration is type-safe; the wizard `update:photoIds`→Save persistence path traced end-to-end; `gcOrphans` has no runtime caller today (fail-safe is forward-looking); no valid segment attachment can be GC-deleted once the vacation is saved. Added a magic-byte tolerance (scan first ~1KB) and an iframe-trust security note.

## Prompt Log

> No GitHub issue created. This plan was approved for direct implementation.

<details>
<summary>Full prompt history</summary>

### Initial Prompt (via /beanies-plan pre-plan intake)

Title: Update travel plans to allow attached images and documents. Type: feature. Priority: high. Surfaces: all app surfaces; Travel Plans (segments — creation wizard + edit drawer). Objective: let users attach images/screenshots/PDFs of bookings & itineraries to a segment so they can refer back to the original and confirm every detail is captured — mirroring activity photos. Scope: attach/view/delete images OR PDFs on travel segments; supported formats images + PDF; from both wizard and edit drawer; lightbox view + has-attachment indicator; removable any time. Out of scope: AI reading of the docs. Reuse the activity photo system; PDF support likely net-new. Open Q: does PDF need handling beyond the image pipeline? No GitHub issue (direct implementation).

### Clarifying answers (2026-06-04)

- Attachment scope: **Booking segments only** (travel + accommodation + transportation; not ideas, not trip-level).
- Mockup: **Yes — mock up first** before building.

</details>
