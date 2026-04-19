# Plan: The Pod — Family Scrapbook, Cookbook, Care & Safety, Emergency Contacts

> Date: 2026-04-19 · Iteration v3
> Mockup: `docs/mockups/family-pod-scrapbook.html`
> Depends on: photo attachment foundation (ADR-021, shipped 2026-04-19)
> Canonical (to sync after iteration): `docs/plans/2026-04-19-the-pod-scrapbook-cookbook.md`

## Context

The existing Family page is a functional member list. It captures none of the personal, memorable, or safety-critical content families actually want to track about each other. The approved mockup turns the Family area into **The Pod** — one hub, six capabilities, built on the MVO + Automerge + photos foundation.

Scope: 8 new Automerge collections, 6 pages, ~7 new form modals, sidebar restructure, photo integrations. Split into **6 phases** with their own commit bundles.

## Confirmed architectural decisions

1. **Phased rollout.** P1-foundation → P2-bean-detail → P3-health → P4-cookbook → P5-contacts → P6-scrapbook-feed.
2. **Per-type Automerge collections** — strong types, independent evolution. Scrapbook feed merges reactively.
3. **Photo integrations:** recipes (hero + 4), medication bottles (1), cook-log dish snaps (1), family-member avatar photos (1, optional, P1).
4. **Sidebar rename + two-level nesting:** "My Family" retires; The Pod nests under Treehouse with 5-item sub-nav.
5. **Share-as-image (P5):** uses native `navigator.share({ files })` on mobile with a download-and-copy fallback on desktop. Does NOT reuse `ShareInviteModal` (that component is link-only — verified).
6. **New accent font: Caveat.** Handwritten accents only; never UI chrome.

## Verified existing components & helpers

Pre-implementation verification pass — every "reuse" claim below is confirmed against current code.

| Item                                                             | Verdict                      | Details                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BeanieFormModal`                                                | **Use as-is**                | Props include `isSubmitting` + `saveDisabled`. No error slot — callers handle errors.                                                                                                                                                                                                      |
| **`useFormModal()` composable**                                  | **Use as-is**                | Manages `isSubmitting` + error state for form modals. Used by `TravelSegmentEditModal`. **Every new form modal wraps its save logic through this composable** — consistent error / loading pattern across the 7 new modals.                                                                |
| `BaseModal`                                                      | **Use as-is**                | For viewer dialogs, confirms, custom layouts.                                                                                                                                                                                                                                              |
| `ConfirmModal` / `useConfirm()`                                  | **Use as-is**                | Promise-based `confirm()` returns `boolean`. Danger/info variants.                                                                                                                                                                                                                         |
| `BaseCombobox`                                                   | **Use as-is**                | **Perfect fit** for Favorite-modal recipe picker: supports predefined options + free-text "Other" input + search.                                                                                                                                                                          |
| `FormFieldGroup`                                                 | **Use as-is**                | Standard labeled-field wrapper with `label`, `optional`, `required`, `error` props. Used by all new form modals.                                                                                                                                                                           |
| `useToast()`                                                     | **Use as-is**                | `showToast(type, title, message?)`. Errors are sticky (no auto-dismiss). No action buttons — fine for our needs.                                                                                                                                                                           |
| `useBreakpoint()`                                                | **Use as-is**                | Reactive `{ isMobile, isTablet, isDesktop }`.                                                                                                                                                                                                                                              |
| `useCelebration()`                                               | **Use as-is + extend**       | Trigger-registry pattern. Add one new trigger: `'recipe-5star'` for a 5-star cook log entry.                                                                                                                                                                                               |
| `wrapAsync()` (in `useStoreActions.ts`)                          | **Use as-is**                | All 7 new stores follow this pattern: `wrapAsync(isLoading, error, async () => ...)`. Auto-toasts on error; resets `isLoading`.                                                                                                                                                            |
| `useOnline()`                                                    | **Use as-is**                | For Meet the Beans offline banners and the photo queue.                                                                                                                                                                                                                                    |
| `usePhotos`, `PhotoAttachments`, `PhotoThumbnail`, `PhotoViewer` | **Use as-is for recipes**    | Photo foundation.                                                                                                                                                                                                                                                                          |
| `photoCompression.compress`                                      | **Extend**                   | Add optional `maxDimension` param (default 2048) so avatars can pass 1024 + JPEG q=0.92. Backward-compatible.                                                                                                                                                                              |
| `PhotoAttachments` `max` prop                                    | **Extend**                   | Currently no `max` prop; limit lives in `usePhotos`. Add `max?: number` pass-through in P1 (foundation fix). Covers medication bottle (max=1), cook-log dish snap (max=1), avatar (max=1).                                                                                                 |
| `BeanieAvatar`                                                   | **Extend**                   | Add optional `photoUrl?: string` prop. When present, render img with `<img>` over the beanie-variant slot; missing → beanie icon fallback. Reuses photoStore's `isUnresolved` flag (ADR-021) to auto-fallback when Drive can't resolve.                                                    |
| `AppSidebar`                                                     | **Extend — meaningful work** | Current structure is one-level accordions (section header + flat items). Two-level nesting (section → parent-item → child-items) is NOT supported. P1 deliverable: refactor the sidebar to handle the nested Pod sub-nav. Extract `AppSidebarSubNav.vue`. Non-trivial; budget accordingly. |
| `ShareInviteModal`                                               | **Do NOT reuse**             | This component is link-only — it generates social-media URLs (WhatsApp/Telegram/Email) from a share link. It can't handle file/Blob inputs. For share-as-image, we build a new minimal share flow (see P5).                                                                                |
| `useConfirm` for deletes                                         | **Use as-is**                | Danger variant on all delete flows.                                                                                                                                                                                                                                                        |
| `automergeRepository` factory                                    | **Use as-is**                | All 7 new stores wrap it.                                                                                                                                                                                                                                                                  |
| `DriveApiError` / `DriveFileNotFoundError`                       | **Use as-is**                | Photo foundation threw these; we surface appropriately.                                                                                                                                                                                                                                    |

### Established conventions to follow

- **Console-log house style:** `console.warn('[moduleName] Failed to X', err)` — prefix with module name so log searches work. Confirmed used throughout syncStore, photoStore. Use it in all new code.
- **Silent catches:** two instances exist in syncStore (both fire-and-forget cleanup); both lack explanatory comments. **We will not add new silent catches without a `// intentional: reason` comment plus at minimum a `console.warn`**. Enforce in code review.
- **Store action return:** `wrapAsync` returns `T | undefined`. Stores wrap as `result ?? null` when the API promises `T | null`. Callers check for null.

## New Automerge collections (8)

| Collection          | Scope                                                                   | Key fields (beyond `id`, `createdAt`, `updatedAt`, `createdBy?`)                                                               |
| ------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `favorites`         | per-member                                                              | `memberId`, `category` (`food` / `place` / `book` / `song` / `toy` / `other`), `name`, `description?`, `recipeId?` (food only) |
| `sayings`           | per-member (`memberId` = who said it; `aboutMemberId?` for "X about Y") | `words`, `saidOn?`, `place?`, `context?`                                                                                       |
| `memberNotes`       | per-member                                                              | `memberId`, `title`, `body`                                                                                                    |
| `allergies`         | per-member                                                              | `memberId`, `name`, `allergyType`, `severity`, `avoidList?`, `reaction?`, `emergencyResponse?`, `diagnosedBy?`, `reviewedOn?`  |
| `medications`       | per-member                                                              | `memberId`, `name`, `dose`, `frequency`, `startDate?`, `endDate?` (or `ongoing: true`), `notes?`, `photoIds?`                  |
| `recipes`           | family-wide                                                             | `name`, `subtitle?`, `prepTime?`, `servings?`, `ingredients: string[]`, `steps: string[]`, `notes?`, `photoIds?`               |
| `cookLogs`          | family-wide (with `recipeId` ref)                                       | `recipeId`, `cookedOn`, `cookedBy?`, `rating` (1–5), `wentWell?`, `toImprove?`, `servings?`, `photoIds?`                       |
| `emergencyContacts` | family-wide                                                             | `category`, `customCategory?`, `name`, `role?`, `phone?`, `email?`, `address?`, `notes?`                                       |

**FamilyMember extension**: `avatarPhotoId?: UUID` (P1).

## New routes

| Path                      | Component               | Notes                                                                        |
| ------------------------- | ----------------------- | ---------------------------------------------------------------------------- |
| `/pod`                    | `MeetTheBeansPage`      | Default landing                                                              |
| `/pod/:memberId`          | `BeanDetailPage`        | Redirects to `/pod/:memberId/overview`                                       |
| `/pod/:memberId/:tab`     | `BeanDetailPage`        | `overview` / `favorites` / `sayings` / `allergies` / `medications` / `notes` |
| `/pod/scrapbook`          | `FamilyScrapbookPage`   | P6                                                                           |
| `/pod/cookbook`           | `FamilyCookbookPage`    | P4                                                                           |
| `/pod/cookbook/:recipeId` | `RecipeDetailPage`      | P4                                                                           |
| `/pod/safety`             | `CareSafetyPage`        | P3                                                                           |
| `/pod/contacts`           | `EmergencyContactsPage` | P5                                                                           |
| `/family` → `/pod`        | redirect                | Router-level                                                                 |

## Stores (7)

`favoritesStore` · `sayingsStore` · `memberNotesStore` · `allergiesStore` · `medicationsStore` · `recipesStore` (also owns `cookLogs`) · `emergencyContactsStore`. Each uses `automergeRepository` factory + `wrapAsync` for every action.

Each store exposes `byMember(memberId)` getters so the Overview dashboard and per-tab views read directly — **no `useMemberContent` composable needed** (originally proposed; dropped on iteration for simplicity).

## Composables (2, down from 4)

- `useScrapbookFeed({ memberIds, contentTypes })` — reactively merges favorites + sayings + memberNotes across members, sorted `createdAt` desc.
- `useShareAsImage()` — P5. Wraps `html-to-image.toPng(element)` + platform-specific share. Two paths only (keeping it simple): `navigator.share({ files })` when available (mobile + modern browsers); download-link fallback otherwise. Drop clipboard copy from v1.

**Dropped from original plan:** `useMemberContent` (stores already expose `byMember`), `usePodNavigation` (Vue Router handles this natively via `meta` fields on routes).

## DRY refactors — lift in the phase of first appearance

Original plan proposed `ContentCard.vue` as a shared card shell — **dropped**; cards vary too much (sticky-note vs photo-first vs multi-section), a shell would force every card to branch on type.

| Component                                                                                | Used in                                                                                          | Extract in |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------- |
| `StickyNote.vue` — rotated paper-colored quote card, size + color variants               | Sayings tab · Meet-the-Beans sayings rail · Scrapbook item · Overview module — 4 places          | P2         |
| `MemberAvatarDot.vue` — small colored squircle with emoji (reuses `BeanieAvatar` shapes) | Highlights strip · Scrapbook filters & items · Care & Safety rows · Contacts headers — 4+ places | P1         |
| `MemberPill.vue` — "🧒 Neil's fave" style pill                                           | Recipe cards · Recipe detail · Favorites bean indicators — 3 places                              | P4         |
| `PolaroidImage.vue` — white-bordered photo + optional Caveat caption                     | Recipe hero · Cook log dish snap · Scrapbook photo item — 3 places                               | P4         |
| `OverviewModule.vue` — header + count chip + body + view-all link                        | 6 Bean Overview dashboard modules                                                                | P2         |
| `StatStrip.vue` — compact stat cards row                                                 | Cookbook hero · Care & Safety hero · Cook Log stats · Bean Overview About strip — 4 places       | P2         |
| `AddTile.vue` — dashed `+ Add X` tile                                                    | 6 grid surfaces                                                                                  | P2         |
| `AppSidebarSubNav.vue` — two-level accordion                                             | Pod sub-nav under Treehouse                                                                      | P1         |
| `ShareAsImageButton.vue` — orchestrates `useShareAsImage` with loading/error state       | Emergency Contacts (possibly reused later)                                                       | P5         |

## Error handling & resilience — enforced across the plan

**Silent failures are forbidden.** Every async boundary has explicit handling; every catch either recovers OR logs with `[moduleName]` prefix.

### Per-operation rules

| Operation                                         | Handling                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Store mutations (create/update/delete)            | `wrapAsync()` — auto-toasts on error, resets `isLoading`, returns `undefined`.                                                                                                                                                                                                                   |
| Form-modal `@save` handler                        | `try { await store.action() } catch { /* already toasted */ } finally { isSubmitting = false }`. If the store returns `undefined`, the modal stays open; caller shows an inline error too if helpful.                                                                                            |
| Photo upload failure (network, Drive quota)       | `photoStore` already handles this via ADR-021 rollback + toast. For Drive quota specifically: detect Google's `storageQuotaExceeded` error code and show a dedicated toast: _"Your Google Drive is full. Clean up files or upgrade your storage, then try again."_                               |
| Photo download failure (404/403)                  | `isUnresolved` flag from ADR-021; broken-image thumbnail + Replace/Remove actions in viewer. Automatic.                                                                                                                                                                                          |
| Avatar photo load failure                         | Same `isUnresolved` → beanie icon fallback. Logged `[beanieAvatar] photo unresolved, falling back`.                                                                                                                                                                                              |
| `html-to-image` rendering failure (P5)            | `try { await toPng(el) } catch (e) { console.warn('[shareAsImage] render failed', e); showToast('error', t('share.renderFailed'), t('share.renderFailedHint')) }`. Hint directs user to take a screenshot manually as a workaround.                                                              |
| `navigator.share` unavailable                     | Fallback to download (`<a download>`). No silent failure.                                                                                                                                                                                                                                        |
| `navigator.share` rejected                        | Distinguish cases: `AbortError` (user canceled) = silent, expected. `NotAllowedError` (blocked by browser / iframe) = toast _"Sharing is blocked in this browser. Try downloading instead."_ plus a download button. Other errors = generic toast + console.warn.                                |
| Deleted-reference handling                        | `favorite.recipeId` pointing to a deleted recipe → computed shows _"Recipe no longer in the cookbook"_ with option to unlink. `saying.aboutMemberId` pointing to a deleted member → shows _"[removed member]"_ rather than crashing.                                                             |
| Caveat font load failure                          | Pure CSS fallback: `font-family: 'Caveat', 'Outfit', cursive` — no JS. FOUT acceptable.                                                                                                                                                                                                          |
| Scrapbook feed merge error (malformed entity)     | Skip the malformed entry; log `console.warn('[scrapbookFeed] skipping malformed entry', entry, error)`; other entries render normally.                                                                                                                                                           |
| Automerge change failure                          | Already rolls back per photoStore pattern. Toast the user "Couldn't save — try again."                                                                                                                                                                                                           |
| Race: user deletes entity mid-edit in another tab | Form modal stays open; on save, the change applies to a no-longer-existent entity; Automerge handles — the "deleted" wins. We add a watcher: if the entity the modal is editing disappears from the store, close the modal and toast _"This was deleted elsewhere. Your changes weren't saved."_ |

### Dev-facing guidance rule

Every `console.warn` / `console.error` must include: (a) `[moduleName]` prefix, (b) what operation failed, (c) the error object. Example: `console.warn('[photoStore] replacePhotoFile failed for', photoId, err)`. When the fix is non-obvious, add a hint comment: `// If this fires often, check Drive quota for this user's account.`

### User-facing toast rule

Every error toast includes: what happened + what the user can do. Example: _"Couldn't upload photo. Check your connection and try again."_ — not just _"Upload failed."_

### Audit checklist at end of each phase

Before merging each phase:

- `grep -r "catch\s*{}\|\.catch(\s*()\s*=>\s*{})" src/` — no new silent catches.
- `grep -r "console\.\(warn\|error\)" src/` on new files — all prefixed with `[moduleName]`.
- Every error toast has a message (not just a title).
- Every form modal's save path handles failures gracefully.

## Photo integrations

| Surface              | Count           | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Family-member avatar | 1, optional, P1 | `FamilyMember.avatarPhotoId?`. Compressed at 1024px, q=0.92. `BeanieAvatar` extended with `photoUrl` prop; uses photoStore's `isUnresolved` fallback. **Loading state:** render beanie variant while the `<img>` is loading; swap on `load` event. No flash. **Precedence:** when both `avatarPhotoId` and the existing `avatar` (beanie variant) are set, the photo wins; beanie is always the fallback path (missing / unresolved / loading). Existing `avatar` field is preserved — this is purely additive. |
| Recipe hero          | 1–4, P4         | `PhotoAttachments` with default max=4. Missing → placeholder SVG.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Medication bottle    | 1, P3           | `PhotoAttachments` with `max=1` (new prop, added P1).                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Cook log dish snap   | 1, P4           | `PhotoAttachments` with `max=1`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

Each calls `registerPhotoCollection(name)` on app init so `photoStore.gcOrphans` cascades.

## Caveat font — CIG extension

Proposed addition to `.claude/skills/beanies-theme/SKILL.md`:

> **Caveat** is a third, accent-only font reserved for handwritten content: saying quotes, polaroid captions, recipe notes, informal taglines, "shhh…" asides. **Never** used for UI labels, form fields, navigation, body text, amounts, data, or any chrome. Sizes 14–24px, weight 500 or 700. Used sparingly.

~14kB gzipped (latin subset). CSS-only fallback to Outfit italic.

## Phase-by-phase

### P1 — Foundation + sidebar + Meet the Beans

- 8 Automerge collections added to `FamilyDocument` + `ALL_COLLECTIONS` (empty).
- 8 new type interfaces in `models.ts` + `FamilyMember.avatarPhotoId?` extension.
- 7 new stores stubbed (each uses `wrapAsync` + `automergeRepository` factory from the start).
- New routes + `/family` → `/pod` redirect.
- **Sidebar refactor: create `AppSidebarSubNav.vue`** for two-level nesting. Current sidebar is one-level; the Pod needs nested items. Non-trivial effort — budget for it.
- Extract `MemberAvatarDot.vue` (first use on Meet the Beans).
- `MeetTheBeansPage` — redesigned member grid with highlights strips + right sidebar. Handles empty state (no favorites/sayings/etc. yet) gracefully.
- Extend `BeanieAvatar` with `photoUrl?` prop. Add fallback logic (photo unresolved → beanie icon).
- Extend `photoCompression.compress` with `maxDimension` param.
- **Extend `PhotoAttachments` with `max?` prop** (foundation fix).
- Caveat font added to CSS + CIG doc updated.
- `registerPhotoCollection('familyMembers')` on app init.
- Avatar upload wired into the edit-bean modal.
- Tests: schema migration, sidebar two-level active-state, route redirects, compression at 1024px, avatar cross-tab concurrent edit.

### P2 — Bean Detail (Overview / Favorites / Sayings / Notes)

- `BeanDetailPage` + `BeanHero` + `BeanTabs`. All 6 tabs render; P3-only tabs show empty-state until P3 ships. Tab-routing via `/pod/:memberId/:tab`.
- **Overview** tab: `StatStrip` + 6-module grid using `OverviewModule` shell.
- **Favorites** tab + `FavoriteFormModal`: uses `BaseCombobox` for the "family recipe or custom" food field. Conditional food-details block.
- **Sayings** tab + `SayingFormModal`. Cards use `StickyNote` component.
- **Notes** tab + `MemberNoteFormModal`.
- `BeanCard` (Meet the Beans) populates highlights from the three stores.
- `favoritesStore`, `sayingsStore`, `memberNotesStore` full implementations.
- Caveat usage starts here within sticky notes.
- **Extractions during this phase**: `StickyNote.vue`, `OverviewModule.vue`, `StatStrip.vue`, `AddTile.vue`, (optional) compact `EmptyState.vue`.
- Tests: CRUD, max-4 favorites, reactive Overview projection, deleted-reference handling (favorite → deleted recipe), concurrent-edit saying.

### P3 — Allergies + Medications + Care & Safety

- `AllergyFormModal` (severity, type, avoid list, reaction, emergency response, diagnosed-by, last-reviewed). `MedicationFormModal` (dose/frequency/duration/notes + photo).
- Bean Detail Allergies + Medications tabs fill in.
- Overview dashboard Allergies + Medications modules populate.
- `CareSafetyPage` (`/pod/safety`): cross-family allergies sorted by severity + active medications + 3-item key-contacts preview linking to `/pod/contacts`.
- Meet the Beans right-sidebar heads-up + today's-care panels populate.
- `allergiesStore`, `medicationsStore`.
- `registerPhotoCollection('medications')`.
- Tests: CRUD, severity sort, cross-family aggregation, concurrent-edit allergies (verify sort remains correct), photo cascade on med delete.

### P4 — Family Cookbook + Recipe detail + Cook Log

- `FamilyCookbookPage`: recipe grid, placeholder illustration for photo-less recipes.
- `RecipeDetailPage`: hero, ingredients list, steps list, notes callout, cook log section. "I cooked this today" button → `CookLogFormModal`.
- `RecipeFormModal` with `PhotoAttachments` (max=4).
- `CookLogEntry` card + `CookLogFormModal` (date, servings, 5-star rating, went-well, to-improve, optional dish photo via `PhotoAttachments` with max=1).
- `CookLogStats` (avg rating, times cooked, most-cooked day, days-since-last).
- Extend `useCelebration` registry: new `'recipe-5star'` trigger fires on a 5-star cook log.
- Favorite-food items link to recipe → "From the Family Cookbook →".
- Recipe rail on Meet the Beans populates.
- `recipesStore` + cook-log sub-methods.
- `registerPhotoCollection('recipes')`, `registerPhotoCollection('cookLogs')`.
- **Extractions during this phase**: `PolaroidImage.vue`, `MemberPill.vue`.
- Tests: recipe CRUD, cook log CRUD, stats computation, photo rollback on recipe delete, concurrent-edit cook log.

### P5 — Emergency Contacts + share-as-image

- `EmergencyContactsPage` (`/pod/contacts`): hero + search + category filter + grouped list.
- `EmergencyContactFormModal`: category chips (with `customCategory?` for "Custom…"), name, role, phone, email, address, notes.
- Key-contacts preview on Care & Safety now live.
- **`useShareAsImage`** composable: `html-to-image.toPng(el)` → Blob → `navigator.share({ files })` on mobile OR download + copy-to-clipboard on desktop. Does NOT reuse `ShareInviteModal` (link-only — verified).
- `ShareAsImageButton` — small wrapping component with loading state and error toast.
- `emergencyContactsStore`.
- Tests: CRUD, category + search filters, image-rendering smoke test (JSDOM-friendly stub), share-API unavailable fallback.

### P6 — Family Scrapbook feed

- `FamilyScrapbookPage` (`/pod/scrapbook`): gradient hero + filter row + masonry feed (CSS `column-count`).
- `useScrapbookFeed({ memberIds, contentTypes })`.
- Type-specific item templates (`ScrapSayingItem` uses `StickyNote`, `ScrapFavoriteItem`, `ScrapNoteItem`, `ScrapPhotoItem` uses `PolaroidImage`).
- Filter chips drive the feed reactively.
- "Load more" button (initial 30 items, +30 per click). Keeps performance predictable.
- Tests: merge correctness, filter correctness, performance with 100+ items, malformed-entry skip-and-log.

## Files affected (summary)

**New**:

- `src/types/models.ts` — 8 interfaces + `FamilyMember.avatarPhotoId?`.
- `src/types/automerge.ts`, `src/services/automerge/docService.ts` — 8 collection entries.
- `src/stores/` — 7 stores, each using `wrapAsync`. Exported from `stores/index.ts`.
- `src/composables/` — `useScrapbookFeed`, `useShareAsImage`.
- `src/pages/` — 7 pages.
- `src/components/pod/` — 7 content cards, 7 form modals, page sub-components.
- `src/components/pod/shared/` — the 8 shared extractions (`StickyNote`, `MemberAvatarDot`, `MemberPill`, `PolaroidImage`, `OverviewModule`, `StatStrip`, `AddTile`, `AppSidebarSubNav`). Grouped so reuse is obvious.
- `src/components/pod/ShareAsImageButton.vue` — P5 share helper.
- `docs/adr/` — new ADR-022 (Pod architecture).

**Modified**:

- `src/router/index.ts` — new routes + redirect.
- `src/components/common/AppSidebar.vue` — restructure for two-level nesting.
- `src/components/ui/BeanieAvatar.vue` — add `photoUrl?` prop + fallback logic.
- `src/components/media/PhotoAttachments.vue` — add `max?` prop.
- `src/services/photos/photoCompression.ts` — add `maxDimension` param.
- `src/composables/useCelebration.ts` — add `'recipe-5star'` trigger.
- `src/services/translation/uiStrings.ts` — new namespaces: `pod.*`, `bean.*`, `favorites.*`, `sayings.*`, `memberNotes.*`, `allergies.*`, `medications.*`, `recipes.*`, `cookbook.*`, `cookLog.*`, `contacts.*`, `scrapbook.*`, `share.*`. Run `npm run translate` after each phase.
- `.claude/skills/beanies-theme/SKILL.md` — Caveat font extension.
- `index.html` — Caveat font link.
- `docs/ARCHITECTURE.md` — Pod section.

## Important notes

- **Automerge schema.** 8 new collections, all empty on existing `.beanpod` files. `ALL_COLLECTIONS` migration handles it.
- **No breaking changes.** All additive.
- **`FamilyPage.vue` retires** at end of P1 when `MeetTheBeansPage` ships. Move logic in small pieces during P1.
- **Photo GC cascades** via `registerPhotoCollection` in P1/P3/P4.
- **Cross-tab concurrent-edit test per phase** — one test each, verifying Automerge merge semantics hold for the phase's content type.
- **Caveat FOUT** — CSS font fallback; no flash handling needed.
- **`html-to-image` library** (~6kB gzipped) — preferred over `modern-screenshot` (~12kB). If Tailwind classes cause issues, fall back to bespoke `<canvas>` render.
- **No "coming soon" banners** — medication reminders get their own plan when we design them properly.
- **Existing `/family` links** (Reddit, help, emails) — protected by redirect. Update help content to `/pod` in P1 PR.
- **Share API feature-detection** — feature-detect `navigator.share` AND `navigator.canShare({ files: [...] })`. The `canShare` check is needed because some browsers have `share` but don't support files.
- **P1 rollback strategy** — schema additions are additive and safe (empty collections, optional field). The risky piece is the sidebar restructure; keep it in its own sub-commit within P1 so it can be reverted independently without losing the data-model groundwork.
- **Sub-nav active state design** — follows the existing nav item pattern (orange gradient + left Heritage-Orange bar) at smaller/indented scale. Sub-item active state reads as a continuation of the parent nav's active state, not a competing visual. Defined in `AppSidebarSubNav.vue` during P1.

### Accessibility specifics

- `StickyNote` cards: preserve source-code tab order (the CSS rotation is visual only). No `tabindex` overrides.
- Saying content uses `<blockquote>` for the quote and `<footer>` for meta (place, date, age) — correct semantics + screen-reader friendly.
- Form-modal field errors announced via `aria-describedby` wired to the `FormFieldGroup` error message.
- Image thumbnails have empty `alt=""` where the photo is decorative (rail thumbnails, polaroids) and meaningful `alt` where content (e.g. `alt="Neil's vitamin D bottle"` on medication photos).

## Assumptions (verify on first touch)

1. `html-to-image.toPng` produces a usable PNG of our Tailwind-styled markup. Verify in P5 with a real Emergency Contacts list. Fallback: bespoke canvas render.
2. Drive `thumbnailLink?sz=w512` works for avatars. ADR-021 flagged 2048 as the empirical check; 512 should be comfortable.
3. `photoStore.registerPhotoCollection` accepts the new collection names (`familyMembers`, `recipes`, `medications`, `cookLogs`). Verify at P1 start.
4. `BeanieAvatar` consumers don't break when the new `photoUrl` prop is absent. All existing call sites pass member variants only; new prop is additive.
5. `AppSidebar` two-level refactor is achievable without breaking the existing Piggy Bank / Treehouse sections. Work the refactor in one PR with both structures converted to the new pattern.
6. Caveat font is accepted as a CIG extension.

## Testing plan

### Unit (Vitest)

- Each new store: CRUD + `wrapAsync` surfacing errors + photo-cascade-on-delete.
- Each new composable: merge + filter + empty-state + malformed-entry skip.
- `photoCompression` with `maxDimension`: 1024 works; default 2048 preserved.
- `PhotoAttachments` with `max` prop: 1-limit enforced on medication/cook-log/avatar.
- Route resolution + redirect.
- `useShareAsImage`: DOM→Blob smoke, feature-detect fallback path.
- `BeanieAvatar` photoUrl branch + unresolved fallback.
- `AppSidebarSubNav` active-state propagation both levels.

### Concurrent-edit (one per phase)

P1: avatar photos. P2: a saying. P3: allergies (severity-sort stability). P4: cook-log. P5: a contact. P6: N/A (read-only aggregation).

### Manual

- Full click-through per phase (see mockup for expected surface).
- Intentional-failure drill: disconnect network mid-upload; verify photo rollback + toast. Revoke Drive access; verify avatar → beanie fallback.
- Deleted-reference drill: delete a recipe, verify a favorite referencing it shows "Recipe no longer in the cookbook" not a crash.

### Audit at phase end

Grep for silent catches. Grep new files for unprefixed `console.*`. Spot-check every error toast has a `message` field.

## Acceptance criteria (overall)

- [ ] Sidebar refactored for two-level nesting; "My Family" removed; "The Pod" nested under Treehouse with 5-item sub-nav.
- [ ] `/family` redirects to `/pod`.
- [ ] 8 new Automerge collections live; existing `.beanpod` files migrate cleanly.
- [ ] `FamilyMember.avatarPhotoId` works; `BeanieAvatar` with `photoUrl` + fallback; compression at 1024px.
- [ ] Meet the Beans matches mockup (cards, highlights, rails, right sidebar).
- [ ] Bean Detail: 6 tabs, URL deep-linking.
- [ ] Overview tab: 6 populated modules with view-all link-through.
- [ ] Favorites/Sayings/Notes CRUD; max-4 favorites; recipe-link affordance; `BaseCombobox` used for the food-recipe field.
- [ ] Allergies surface in 3 places; severity sort; Medications surface in 3 places with photos.
- [ ] Care & Safety aggregates health + 3 key contacts; "Open full Emergency Contacts →" deep-link.
- [ ] Family Cookbook grid + placeholder illustration; recipe detail with ingredients/steps/notes/cook log; "I cooked this today" flow with rating capture.
- [ ] Emergency Contacts standalone page: search, categories, CRUD, share-as-image with feature-detected fallback.
- [ ] Family Scrapbook feed: merged favorites+sayings+notes with type + member filters; load-more.
- [ ] `useCelebration` extended with `recipe-5star` trigger.
- [ ] Caveat font scoped to quote/accent content; FOUT fallback works.
- [ ] All new strings in `uiStrings.ts` (en + beanie); `npm run translate` passes.
- [ ] 8 shared components extracted in first-use phases.
- [ ] All new code uses `wrapAsync`, `[moduleName]`-prefixed logs, informative error toasts. Audit greps clean.
- [ ] `photoStore.gcOrphans` covers all new photo-attaching collections.
- [ ] ADR-022 + ARCHITECTURE.md Pod section added.
- [ ] All existing + new tests pass.

## Sustainability, maintainability, reliability

Additional pass focused on long-term supportability. Each item here prevents a class of future rewrite.

### Data/UI decoupling

- **No UI presentation fields in data.** Entity types capture _what_ the data is, not _how_ it's displayed. Per this rule, we do NOT add `MemberNote.accent?` (originally proposed) — the component picks an accent by index or by content category. Prevents data migrations when we restyle.
- **Applies to all 8 new entity types.** Review each during P1 type-definition work. If a field is presentation-only, drop it.

### Store/page decoupling

- **Overview dashboard composition:** `OverviewDashboard.vue` is pure composition. Each `OverviewModule` sub-component (`OverviewFavoritesModule`, `OverviewSayingsModule`, etc.) imports its own store. The dashboard itself imports zero entity stores. This prevents the page from becoming a god-component with 5+ store imports that makes every store change a page rewrite.
- **Same pattern for Meet the Beans right sidebar.** Heads-up-allergies panel imports `allergiesStore`; today's-care panel imports `medicationsStore`; events panel imports `activityStore`. `MeetTheBeansPage` composes — doesn't fan in.
- **No barrel files re-exporting domain stores.** Keeps import paths explicit so a mid-sized refactor can grep-find everything that touches a store.

### Per-member store factory (P2 tactical decision)

Five of the seven new stores are per-member-scoped with identical shape: list + `byMember(memberId)` + CRUD + `wrapAsync`. Prototype `createMemberScopedStore<T>(collectionName)` in `src/composables/useStoreActions.ts` (or a sibling) during P2 with `favoritesStore` as the first adopter. If the factory stays clean and well-typed:

- Roll out to `sayingsStore`, `memberNotesStore`, `allergiesStore`, `medicationsStore`.
- Saves ~40 lines per store + keeps the five in lockstep when the pattern evolves.

If per-store customization explodes (per-type validation, pre-save hooks, etc.) and the factory gets `any`-ridden, revert to per-store files. Document the decision in the P2 PR.

`recipesStore` and `emergencyContactsStore` are family-wide (not per-member) and stay per-file.

### Recipe → cook-log cascade delete

Top-level `cookLogs` with `recipeId` ref was chosen for clean CRDT concurrency. When a recipe is deleted:

1. `useConfirm({ message: "This recipe has 14 cook logs. Deleting it will also remove the cook history. Continue?", variant: 'danger' })`.
2. If confirmed, **single atomic Automerge change**: delete recipe + all cook logs with matching `recipeId` + mark their photos for tombstone GC (photo foundation handles the Drive cleanup).
3. If orphan cook logs exist (edge case: recipe deleted in another tab before this one had the latest state), a startup sweep clears them during the photo `gcOrphans` pass.

No silent orphans. Atomic cascade. Display-time fallbacks still exist for in-flight concurrent edits but don't accumulate cruft.

### Error state distinguished from empty state

Every page/tab has three states:

| State   | Trigger                              | UI                                                                                                                          |
| ------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Empty   | Store populated, no matching entries | "No sayings yet — add one to get started" + `AddTile`                                                                       |
| Loading | Store's `isLoading.value === true`   | `BeanieSpinner` with "counting beans…" copy                                                                                 |
| Error   | Store's `error.value !== null`       | Inline error card: "Couldn't load. [Retry]" + `console.warn('[storeName] load failed', err)` already emitted by `wrapAsync` |

`wrapAsync` already sets `isLoading` / `error` refs. Components just read them.

### FamilyMemberCard rename

`FamilyMemberCard.vue` exists today. P1 audit:

- If the component is only used on the retiring Family page, rename it to `BeanCard.vue` and redesign in place. Single PR, clean diff.
- If used elsewhere (FamilyNook, etc.), keep `FamilyMemberCard.vue` with its current usage and add a new `BeanCard.vue` in `src/components/pod/`. Note in the ADR which consumers use which.

Audit is a 5-minute grep; fits in the P1 opening tasks.

### Naming convention — brand voice vs data model

Explicit rule:

- **Data model types** (`src/types/models.ts`): `FamilyMember`, `FamilyActivity`, etc. Technical, precise.
- **Pod-feature components**: `Bean*` prefix where it reads better (`BeanCard`, `BeanDetailPage`, `BeanHero`, `BeanTabs`). Matches the user-facing "Meet the Beans", "View Neil →" copy.
- **User-facing strings** (`uiStrings.ts`): "Bean" ("Little Bean", "Parent Bean", "View bean →"). Never "FamilyMember".
- **Outside the Pod feature**: keep existing `FamilyMember*` component names where they exist (`FamilyMemberCard` if kept, etc.). Don't cascade-rename.

Documented in ADR-022 so future contributors don't second-guess the mix.

### Component size discipline

House rule: any Vue component exceeding **~300 lines** gets refactored before merge. Options: extract sub-components, move logic to a composable, split into presentational + container. Enforced in code review. Prevents god-components.

### Test coverage additions

Component smoke tests — not just store/composable:

- **Each form modal**: save-happy-path + save-error-path (store.create rejects) + validation (missing required field).
- **Each card**: renders for all prop permutations. Focus on edge cases (e.g. `FavoriteCard` with a deleted `recipeId` shows "Recipe no longer in cookbook").
- **Each page**: mounts without crashing with empty stores AND populated stores AND error-state stores.

Lightweight — Vue Test Utils shallow mounts are fast. Catches the "page crashes when error is set" class of bugs.

### Performance watchpoints

Explicit thresholds:

- **Sayings tab** at 50+ entries — switch to paginated (30 per page) rendering.
- **Scrapbook feed** — load-more pattern at 30 initial items, +30 per click. Planned.
- **Family Cookbook** at 50+ recipes — consider CSS content-visibility auto or a virtualizer. Low priority (most families won't hit this).
- **Automerge doc size** — monitor via existing persistence cache size. Alert at 5MB (soft) / 10MB (hard). Not a v1 feature but note for ADR.

### ADR-022 enumerated content

ADR captures these decisions (one per section) so the rationale survives:

1. **Per-type collections** over unified `scrapbookItems` — strong types, independent evolution.
2. **No encryption inherited from ADR-021** — photos, recipe text, etc. follow the same Drive-only trust model.
3. **Caveat font** as a third CIG-sanctioned accent font with strict usage rules.
4. **`navigator.share` + file fallback** as the share-as-image mechanism; NOT reusing `ShareInviteModal` (link-only).
5. **Two-level sidebar nesting** via `AppSidebarSubNav` extraction.
6. **DRY cadence** — extract shared components in the phase of first appearance, not at the end.
7. **No-silent-catches policy** + `[moduleName]` log prefix convention.
8. **Presentation-free data types** — no UI fields in entity types.
9. **Page composition over god-pages** — each module imports its own store.

### Anti-coupling audits at phase end

In addition to the silent-catch grep, each phase's PR adds:

- `grep -r "useFavoritesStore\|useSayingsStore\|..." src/pages/` — flag any page that imports 2+ domain stores. If found, refactor into module-level imports.
- Component line-count scan — fail PR if any file > 300 lines.

### Form validation convention

Every form modal validates on save:

- **Required fields** — validated client-side; rendered via `FormFieldGroup`'s `error` prop with an inline error message.
- **Validation lives in the modal component**, not the store. The store assumes inputs are already valid (type-safe).
- **Cross-field rules** (e.g. "medication endDate must be after startDate") — same pattern: modal validates and emits error; store assumes validity.
- **Friendly messages** — "Please give this favorite a name" rather than "name required".

### Default values for form fields

Reduce friction: pre-fill sensible defaults when the add-modal opens.

| Field                  | Default                                            |
| ---------------------- | -------------------------------------------------- |
| `saying.saidOn`        | Today                                              |
| `allergy.reviewedOn`   | Today (on first add; preserved on edit)            |
| `medication.startDate` | Today                                              |
| `cookLog.cookedOn`     | Today                                              |
| `cookLog.rating`       | 5 (one-click happy path; user taps down for lower) |
| `cookLog.cookedBy`     | Current member id (if identifiable; else empty)    |
| `saying.memberId`      | Bean being viewed (bean-detail context)            |
| `favorite.category`    | `food` (most common)                               |
| `allergy.severity`     | `mild` (force user to confirm severity if higher)  |

### Cross-reference graceful-degradation rules (complete)

| Reference                                    | When missing                                                                                  | Display |
| -------------------------------------------- | --------------------------------------------------------------------------------------------- | ------- |
| `favorite.recipeId` → deleted recipe         | Show the favorite's `name` + inline _"Recipe no longer in the cookbook"_ with "Unlink" action |
| `cookLog.recipeId` → deleted recipe          | Shouldn't happen (cascade delete); if orphan anyway, `gcOrphans` sweep removes                |
| `saying.aboutMemberId` → deleted member      | Render the saying with _"about [removed member]"_                                             |
| `*.createdBy` → deleted member               | Render as _"[removed member]"_. Preserves history even after the author leaves.               |
| `cookLog.cookedBy` → deleted member          | Same: _"[removed member]"_                                                                    |
| `medication.photoIds` → deleted photo        | Existing `isUnresolved` from ADR-021 → broken-image tile + Replace/Remove                     |
| `familyMember.avatarPhotoId` → deleted photo | Auto-fallback to beanie variant                                                               |

### Celebration trigger wiring

`useCelebration` gains a new `'recipe-5star'` trigger. Fires in **`CookLogFormModal`'s save-success handler**, gated on `entry.rating === 5`. Small confetti toast — no modal (non-intrusive). Uses the existing `chime` sound.

### Member deletion cascade

Deleting a family member is destructive. Cascade in ONE atomic Automerge change:

1. `useConfirm` with a heads-up count: _"This will also delete Neil's 4 favorites, 6 sayings, 1 allergy, 1 medication, and 3 notes. Continue?"_ (danger variant).
2. On confirm: delete the `FamilyMember` + all records where `memberId === id`, in a single `changeDoc()` call. Atomic.
3. Photos attached to the deleted records tombstone via `photoStore.gcOrphans` (existing pattern).
4. **`aboutMemberId` references** (e.g. sayings "Sophia about Alice") are NOT deleted when the referenced member is removed. They render gracefully at display time as "[removed member]". The data survives so history isn't lost.
5. `memberFilterStore`'s active filter auto-resets if it pointed to the deleted member.

### Permission matrix (v1)

Matches existing finance permissions:

- **Parent beans** — full CRUD on all Pod content.
- **Little beans** — view-only.

Enforced at the UI layer via `usePermissions()` (hides add/edit affordances). Store-layer enforcement isn't needed for v1 since all edits originate from the same device; hardening comes if we ever ship multi-device concurrent writes without Automerge ownership.

Future enhancement (out of scope for v1, noted in ADR-022): Little Beans can add content about themselves (sayings they say, favorites they choose) even if they can't edit family-wide content like recipes.

### Cook log rating

`rating: 1 | 2 | 3 | 4 | 5` — required, no `null` sentinel. Modal opens with rating defaulted to 5 (star display: all filled); user can click a lower star to reduce. Makes the happy-path one-click ("cooked this; it was great") while capturing the nuance when it matters.

### Favorite `other` category

No custom-category text input. The favorite's `name` field is descriptive enough ("Weekly beach walk", "Grandpa's cardigan"). Keeps the data shape tight. If users consistently type a category-like name, we iterate later.

### i18n note: Caveat + Chinese

Caveat is latin-only. Chinese sayings fall back to Outfit via CSS `font-family: 'Caveat', 'Outfit', cursive`. **Acceptable v1 behavior** — Chinese text renders in the primary app font, which is readable and on-brand.

Future enhancement (out of scope): `Ma Shan Zheng` (free on Google Fonts) as the zh handwritten accent. Documented in ADR-022 under "i18n considerations" so the extension path is clear.

## Iteration history

- **v1** — initial plan. 6 phases. Proposed `ContentCard.vue` shared shell for all 7 cards.
- **v2 (DRY revision)** — dropped `ContentCard` (cards too different); added 8 targeted extractions.
- **v3 (verified + error-handling pass)** — verified every reuse claim; corrected share mechanism (ShareInviteModal is link-only); corrected PhotoAttachments max prop; corrected AppSidebar two-level as new work; dropped over-engineered composables; added Error Handling & Resilience section; codified no-silent-catches.
- **v4 (sustainability pass)** —
  - **Dropped `MemberNote.accent?`** — UI in data. Component picks accent.
  - **Page-composition rule** — each `OverviewModule` imports its own store; no god-pages.
  - **`createMemberScopedStore<T>` factory** prototyped in P2 — tactical, revertible if ugly.
  - **Recipe deletion cascades cook logs atomically** with a confirm prompt. No orphan ghosts.
  - **Three-state page rendering** — empty vs loading vs error, using `wrapAsync`'s existing refs.
  - **`FamilyMemberCard` rename audit** — single decision in P1.
  - **Naming convention rule** documented — Bean for components, FamilyMember for data model.
  - **300-line component cap** — enforced in PR review.
  - **Component smoke tests** added to testing plan.
  - **Performance watchpoints** defined with thresholds.
  - **ADR-022 content enumerated** — 9 decisions captured.
  - **Phase-end anti-coupling audits** — greps that prevent god-components and multi-store pages.
- **v6 (final verification pass)** —
  - **Avatar precedence** documented — photo wins when both set; beanie is the always-available fallback path.
  - **`navigator.share` error distinction** — `AbortError` (user canceled) silent; `NotAllowedError` gets a helpful toast; other errors generic toast + log.
  - **Accessibility specifics** — `<blockquote>` + `<footer>` for sayings, source-code tab order for rotated cards, `aria-describedby` for form errors, meaningful vs decorative `alt` on photos.
  - **Form defaults table** — date fields default to today; `cookLog.rating` defaults to 5; `favorite.category` defaults to food; `allergy.severity` defaults to mild.
  - **Cross-reference rules table** — every foreign-key reference has an explicit deleted-target display rule. No crashes on orphan references.
  - **Celebration trigger wiring** — spelled out: `'recipe-5star'` fires in `CookLogFormModal` save-success when rating === 5.
  - **Sub-nav active state design** — reuses existing orange-gradient pattern at indented scale; defined in `AppSidebarSubNav`.
  - **`share.*` namespace** added to `uiStrings.ts` modifications.
  - **P1 rollback strategy** — sidebar restructure as own sub-commit; schema changes are additive and can stay even if sidebar reverts.
- **v5 (final fresh-eyes pass)** —
  - **`useFormModal()` composable** added to reuse table — every new form modal uses this pattern. Was missed; caught on second verification pass.
  - **Share flow simplified** — dropped clipboard fallback; two paths only (`navigator.share` or download).
  - **Avatar loading UX** — render beanie while photo loads; swap on `<img>` load event. Prevents flash.
  - **Form validation convention** spelled out — `FormFieldGroup.error` in every form modal, required-field validation at modal-level, friendly error messages.
  - **Member deletion cascade** — atomic Automerge change with a counted confirm prompt. `aboutMemberId` references handled at display time.
  - **Permission matrix (v1)** — Parent beans CRUD; Little beans view-only. Matches existing finance permissions. Future: little beans can add content about themselves.
  - **Cook log rating defaulting** — rating is required, defaults to 5 on modal open. One-click happy path.
  - **Favorite `other` category** — no custom-category text input; `name` is enough.
  - **Caveat + i18n** — Chinese falls back to Outfit via CSS; noted as acceptable v1. Future: `Ma Shan Zheng` for zh.
  - Confirmed: security/privacy posture unchanged (all data encrypted via `.beanpod`; `html-to-image` runs locally; no new server surface).
