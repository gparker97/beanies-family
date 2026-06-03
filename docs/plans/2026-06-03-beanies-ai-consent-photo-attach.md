# Plan: beanies AI consent refresh — copy + photo-attach + optional "stop asking" (#133)

> Date: 2026-06-03
> Related issues: #133 (private AI capability — managed-tier wedge)
> Plan file: `docs/plans/2026-06-03-beanies-ai-consent-photo-attach.md`
> **No GitHub issue created.** Approved for direct implementation; full prompt history in `## Prompt Log`.

## User Story

As a beanies.family parent adding an event from a photo, I want a warm, honest consent screen that
keeps the source photo on the activity and lets me stop being asked every time, so that the feature
feels trustworthy and effortless without hiding what happens to my photo.

## Context

The #133 photo → activity wedge is live and validated (first real invitation extracted correctly via
the deployed Tinfoil proxy). Three coupled refinements were requested and confirmed with greg:

1. **Consent copy** is currently functional-but-plain ("Add from a Photo"). greg supplied warmer
   "beanies AI" voice copy.
2. **The photo is discarded after extraction.** greg wants it _attached to the created activity_ so it's
   saved with the family's data — which also makes the "afterwards" copy literally true.
3. **The consent modal asks every time.** greg wants an optional "don't ask again" checkbox (default
   OFF) that skips the prompt on future extractions, reversible from Settings.

The intent: a trustworthy, low-friction consent experience that stays honest about where the photo goes.

## Requirements

1. Update the `ai.consent.*` strings to greg's wording (table in **Approach §1**), `en` + `beanie`, run
   `npm run translate`. No em-dashes; "beanies" always lowercase; no markdown asterisks (modal is plain text).
2. After a successful extraction, the source photo appears in the prefilled `ActivityModal` as an
   already-attached, **removable** thumbnail, and persists on the activity when saved (Drive-backed via
   the existing photo store).
3. The consent modal gains an **optional** checkbox (greg's "I agree…" label). Ticking it is NOT required
   to proceed; the confirm button proceeds for the current document regardless.
4. When the checkbox is ticked at confirm time, persist a **family-scoped** setting so future extractions
   **skip the consent modal entirely** (auto-consent).
5. A new Settings **"AI & Privacy"** card exposes an "Ask before reading photos" toggle (ON by default)
   that re-enables the prompt. The setting is fully reversible.
6. The first-ever use **always** shows the modal (default OFF).
7. All failure paths surface an informative toast and never fail silently or block the activity create.
8. A Help Center privacy article (the checkbox's "How we protect your privacy" link target) is **added to
   `src/content/help/security.ts`**. NOTE: the marketing help site deploys via the **separate, manual
   `deploy-web.yml`** (`workflow_dispatch`) pipeline — it does NOT auto-deploy on a push. So the consent
   checkbox renders **label-only by default**, and only becomes a live hyperlink after the web deploy is
   confirmed live (avoids a 404 link if only the app ships).

## Important Notes & Caveats

- **Photo bytes live in Google Drive, NOT the `.beanpod` Automerge doc** — only the `photoId` reference
  lives in the doc. This is load-bearing for the documented ~5MB Automerge perf ceiling
  (`docs/PERFORMANCE.md`). Never put image bytes in the doc.
- **Honesty (ADR-030 binding principle).** "Fully encrypted while travelling to and from the service" =
  TLS in transit on both hops — it does NOT claim end-to-end-to-enclave (that's Gate 3, not yet shipped).
  No copy may imply the proxy cannot see the photo. "Saved with your family's data" is accurate once we attach.
- **Family-scoped consent skip:** the setting syncs via Automerge, so one member ticking "don't ask again"
  suppresses the prompt for the whole family. greg confirmed this (consistent with all other settings).
  Copy must reflect family scope ("for our family"), not "this device".
- **`extractionToActivity.ts` stays pure text** — the photo travels out-of-band, not in the prefill (the
  mapper is reused by future AI features and must not become activity-photo-shaped).
- **Avoid double-compression:** the extraction already compressed the blob (2048px / q0.85); thread that
  blob to the attach path; the photo store's `compress()` short-circuits small JPEGs.
- **Attach goes through the canonical `usePhotos.add` composable, not raw `photoStore.addPhoto`.**
  `usePhotos.add` (`src/composables/usePhotos.ts`) already owns the whole audited pipeline:
  `photosEnabled` guard → `photos.cloudRequired` toast (non-fatal, returns `[]`, never throws), MIME
  validation, completed/queued branching, `QueueWriteFailedError`/upload-fail toasts, the uploading
  spinner, `console.error` + `reportError`, and re-emitting refreshed `photoIds` via `updatePhotoIds`.
  Calling `photoStore.addPhoto` directly would silently fork all of that. **Attach must never block the
  activity create** — `usePhotos.add` surfaces failures as toasts and the form stays usable.
- Do NOT touch the planner entry button label `ai.addFromPhoto` ("Add from a Photo") — separate key.

## Assumptions

> Review before implementation — valid at planning time (2026-06-03).

1. `FamilyActivity.photoIds?: UUID[]` and the photo store / `PhotoAttachments` / `usePhotoEntityBinding` /
   eager-create infra are as mapped (verified this session). If the photo subsystem changed, re-check §2.
2. The wedge accepts images only (proxy allows `image/jpeg|png`); "photo or document" in copy = an image.
3. `showPublicHolidays` remains the canonical optional-boolean-setting pattern to mirror end-to-end.
4. `ToggleSwitch` (`src/components/ui/ToggleSwitch.vue`) and `BeanieFormModal` are the design-system
   primitives to use; a native peer-checkbox matches the in-modal checkbox style used elsewhere.
5. The Help Center content lives in the **TS content system** `src/content/help/*.ts`
   (`security.ts`, `index.ts`, `categories.ts`, `types.ts`) — articles are objects registered there, not
   markdown/Astro files under `web/`. `.claude/skills/beanies-help-docs` conventions apply.

## Approach

### §1 — Consent copy (`src/services/translation/uiStrings.ts`) + `npm run translate`

Update `ai.consent.*` and add new keys. `en` below; `beanie` = all-lowercase mirror ("ai" lowercase).
Final wording is greg's voice call. Note: `ai.consent.title`/`ai.consent.confirm` currently say
"Add from a Photo"/"Read This Photo" and are being overwritten. The three header keys
`ai.consent.whatLabel` / `whereLabel` / `afterLabel` ("What we send" / "Where it goes" / "Afterwards")
are **unchanged** — they stay and pair with the values below in the modal template. The
`ai.consent.privacyLink` renders **label-only by default**, upgrading to an `openExternal()` link
(`src/utils/openExternal.ts`, same pattern as whats-new) only once the marketing help article is live —
see §4 / Requirement #8.

| Key                                       | `en`                                                                                                                                                                          |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai.consent.title`                        | Welcome to beanies AI!                                                                                                                                                        |
| `ai.consent.intro`                        | beanies will read this photo or document to magically extract the key details (well, it's not actually magic, it's just AI).                                                  |
| `ai.consent.whatValue`                    | Only this one photo or document, never anything else, and never any of your family's data.                                                                                    |
| `ai.consent.whereManaged`                 | beanies uses a private, safe, and secure AI service that processes the document and keeps nothing. Your document is fully encrypted while travelling to and from the service. |
| `ai.consent.whereByok`                    | To your own AI provider, using the key you've provided.                                                                                                                       |
| `ai.consent.afterValue`                   | Nothing is kept by the AI service. Your photo or document is saved only with your own family's data, attached to this activity.                                               |
| `ai.consent.confirm`                      | I understand - use beanies AI!                                                                                                                                                |
| `ai.consent.footnote`                     | We'd never send anything without asking - you choose each time. You can stop the prompt for your family by ticking the box below.                                             |
| `ai.consent.remember` _(new)_             | I agree to let beanies.family privately and securely process the documents I choose.                                                                                          |
| `ai.consent.privacyLink` _(new)_          | How we protect your privacy                                                                                                                                                   |
| `settings.ai.title` _(new)_               | AI & Privacy                                                                                                                                                                  |
| `settings.ai.askBeforePhotos` _(new)_     | Ask before reading photos                                                                                                                                                     |
| `settings.ai.askBeforePhotosHint` _(new)_ | Show a privacy check before sending a photo or document to beanies AI.                                                                                                        |

### §2 — Attach the source photo (reuse the photo store; no new infra)

Thread the already-compressed blob out of extraction → into `ActivityModal`; the modal attaches it via
its existing eager-create + `photoStore.addPhoto` path, so it renders as a removable thumbnail.

- `src/services/ai/types.ts` — add `compressedBlob?: Blob` to the **success** `DocumentExtractionResult`
  envelope (model `data` stays pure text). No `compressedMime` field — `compress()` always returns JPEG
  and the blob already carries `type: 'image/jpeg'`, so construct the File as
  `new File([blob], name, { type: blob.type })`.
- `src/services/ai/documentExtractionService.ts` (~117) — include the compressed blob on success.
  **Hoist the `compressed` var out of the `try` block (currently scoped inside it at ~93)** so the
  success return can read `compressed.blob`/`compressed.mime`.
- `src/composables/useDocumentToActivity.ts` (~28, ~98) — `onActivityReady` takes a **single options
  object** `{ prefill, confidence, sourcePhoto? }` (not a 3rd positional arg — the callback is documented
  as expected to grow). Update `UseDocumentToActivityOptions` + the one call site. Wrap
  `result.compressedBlob` into a `File`. `extractionToActivity.ts` untouched.
- `src/pages/FamilyPlannerPage.vue` — `activitySourcePhoto` ref; set in `onPhotoActivityReady`; bind
  `:source-photo` on `<ActivityModal>`. **Clear it at the SAME sites `activityPrefill` is cleared** —
  both the modal `@close` AND the manual-add reset (~line 253, "a manual add is never a photo prefill").
  Missing the manual-add reset would let a stale photo leak onto the next manually-added activity.
- `src/components/planner/ActivityModal.vue` — `sourcePhoto?: File` prop. Construct a `usePhotos`
  instance pinned to the **same binding inputs the template `<PhotoAttachments>` uses**
  (`binding.photoIds`, `binding.updatePhotoIds`, `eager.entityId`, `currentMemberId`) so both stay
  consistent and the attached photo shows immediately. **Use an explicit single trigger, NOT a watch on
  `firstMissingFieldKey`:** a `maybeAttachSourcePhoto()` that (1) returns unless `pendingSourcePhoto` is
  set and the eager gate is satisfiable, (2) **nulls `pendingSourcePhoto` synchronously before any await**
  (the only double-fire guard), (3) `await eager.ensureId()` → `await photos.add([file])`. Call it from
  the existing field-change handlers (or a `watchEffect` whose ONLY dependency is
  `pendingSourcePhoto && gateSatisfied`), so attach is not coupled to the unrelated validation predicate's
  field list. `usePhotos.add` handles cloud-off (`photos.cloudRequired`, non-fatal), queue/upload
  failures, and the spinner — no bespoke try/catch. (A second `usePhotos` instance is fine —
  `PhotoAttachments` already creates its own internally.)
  - **UX note:** if the prefill already satisfies the gate (title+date+assignee all extracted) the photo
    attaches on open; if an assignee is missing it attaches once the user adds one. State this asymmetry
    so it isn't a support surprise.

**Reuse (not modified):** `usePhotos.add` (the full add/error/toast/spinner pipeline),
`photoStore.markDeleted`/`gcOrphans`/`photoIdsFor`, `useEagerEntityCreate.ensureId`,
`usePhotoEntityBinding`, `PhotoAttachments`, `compress()` short-circuit, `openExternal`.

### §3 — Optional "stop asking" (family-scoped; mirror `showPublicHolidays`)

- `src/types/models.ts` — `Settings` gains `skipDocumentConsentPrompt?: boolean` (optional; no migration).
- `src/services/automerge/repositories/settingsRepository.ts` — `setSkipDocumentConsentPrompt` setter
  (mirror `setShowPublicHolidays`); omit from `getDefaultSettings()` (getter defaults `?? false`).
- `src/stores/settingsStore.ts` — getter (`?? false`) + action + exports (mirror the holiday pair).
- `src/components/ai/DocumentExtractConsentModal.vue` — currently emits `confirm: []` / `cancel: []`
  (no payload). Change to `confirm: [remember: boolean]`; `BeanieFormModal`'s `@save` re-emits with the
  checkbox's `remember` state. Add the optional checkbox (native peer-checkbox) with `ai.consent.remember`
  - label-only/link-gated privacy text. `remember` is the modal's only internal state — **reset it via a
    watch on the `open` prop edge** (on `true` → `remember = false`), not on confirm/cancel.
    **Parent rewiring (don't miss):** `FamilyPlannerPage.vue` currently binds `@confirm="resolvePhotoConsent(true)"`,
    which would silently discard the new payload — change it to `@confirm="onConsentConfirm"`. Update any
    existing consent-modal test that asserts the old no-payload `confirm` shape.
- `src/pages/FamilyPlannerPage.vue` — `requestPhotoConsent()` short-circuits `Promise.resolve(true)` when
  `settingsStore.skipDocumentConsentPrompt` is on (modal never opens; keeps the composable generic). The
  skip path must **not touch `consentResolver`/`consentOpen`** — it returns immediately so no resolver is
  left dangling. `onConsentConfirm(remember)` calls a named `persistConsentSkip()` (keeps the handler
  thin + independently testable) wrapped in **try/catch with `resolvePhotoConsent(true)` in a `finally`**
  — a settings-write failure logs (`reportError`/console) but never strands the wedge or fails silently.
- `src/pages/SettingsPage.vue` — add an "AI & Privacy" toggle using the **Quick-Toggles row pattern**
  (`SettingsPage.vue` ~686-773), **not** the clickable `SettingsCard` (which emits `click` and is the
  wrong primitive). `ToggleSwitch`, **inverted** (ON = ask = setting `false`; default ON). Re-enabling
  restores the prompt.

### §4 — Honest privacy link target

The checkbox renders **label-only by default**. It upgrades to a hyperlink (via
`openExternal('https://beanies.family/help/security/how-beanies-ai-handles-your-photos')`, reusing
`src/utils/openExternal.ts`) **only once the marketing site has been deployed** (`deploy-web.yml` is a
separate manual `workflow_dispatch` pipeline; an app deploy does not publish the help article). Gate the
link behind a simple constant/flag flipped when the web deploy is confirmed — never a live link to a 404.

## Files Affected

| File                                                        | Change                                                                                                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `src/services/translation/uiStrings.ts`                     | copy updates + 5 new keys; run `npm run translate`                                                                                   |
| `src/services/ai/types.ts`                                  | `compressedBlob?`/`compressedMime?` on success result                                                                                |
| `src/services/ai/documentExtractionService.ts`              | return compressed blob on success                                                                                                    |
| `src/composables/useDocumentToActivity.ts`                  | `onActivityReady` 3rd arg; blob→File                                                                                                 |
| `src/pages/FamilyPlannerPage.vue`                           | source-photo ref/prop/clear; consent skip + persist                                                                                  |
| `src/components/planner/ActivityModal.vue`                  | `sourcePhoto` prop; deferred gate-pass attach                                                                                        |
| `src/components/ai/DocumentExtractConsentModal.vue`         | checkbox + `confirm:[remember]` + reset-on-open                                                                                      |
| `src/types/models.ts`                                       | `skipDocumentConsentPrompt?: boolean`                                                                                                |
| `src/services/automerge/repositories/settingsRepository.ts` | repo setter                                                                                                                          |
| `src/stores/settingsStore.ts`                               | getter + action + exports                                                                                                            |
| `src/pages/SettingsPage.vue`                                | "AI & Privacy" toggle (Quick-Toggles row pattern)                                                                                    |
| `src/content/help/security.ts`                              | new privacy article object appended to `SECURITY_ARTICLES` (no `index.ts`/`categories.ts` edit — already spreads/defines `security`) |
| `src/**/__tests__/*`                                        | the test points in **Testing Plan**                                                                                                  |

**Reused (not modified):** `src/composables/usePhotos.ts` (`add` pipeline), `src/utils/openExternal.ts`.

## Help Center Coverage

This work is **security/privacy-relevant** (it governs sending a family photo to an AI service and lets a
user disable the consent prompt family-wide) — so it ships with a Help Center article in the same change.

- **Action**: new article object appended to `SECURITY_ARTICLES` in `src/content/help/security.ts` (no other registration). Goes live only on a manual `deploy-web.yml` run.
- **Category**: `security`
- **Article type**: `explainer`
- **Slug**: `how-beanies-ai-handles-your-photos`
- **Title**: How beanies AI handles your photos
- **Scope**: From the user's point of view — what beanies AI does with a photo/document you choose (reads
  one document to extract event details), where it goes (a private, secure AI service that keeps nothing;
  encrypted in transit), what is and isn't sent (only that one document, never the rest of your family's
  data), what happens afterwards (nothing kept by the service; the photo is attached to your activity in
  your own family data), and how the "don't ask again" choice works (family-wide, reversible in Settings →
  AI & Privacy).
- **Notes**: Must stay within the ADR-030 honesty line — describe transit encryption + zero-retention +
  attested confidential compute, and **not** claim "no intermediary ever sees the photo" (that's Gate 3,
  not yet shipped). Must call out that "don't ask again" is **family-scoped** (affects everyone) and how to
  turn it back on. Written per `.claude/skills/beanies-help-docs/SKILL.md`; greg's voice pass required.

## Acceptance Criteria

- [ ] Consent modal shows the new copy (`en` + `beanie`); `npm run translate` clean; no em-dashes; beanies lowercase.
- [ ] Successful extraction opens `ActivityModal` prefilled with the source photo attached as a removable thumbnail; saving persists it; reopening the activity shows it.
- [ ] Removing the thumbnail before save leaves no orphan (existing GC); declining/cancelling the modal after eager-attach is GC-safe.
- [ ] Optional checkbox: confirm proceeds whether or not it's ticked; ticking persists the family-scoped setting.
- [ ] With the setting ON, future extractions skip the modal; the first-ever use always prompts.
- [ ] Settings → AI & Privacy toggle (ON by default) re-enables the prompt; round-trips through sync.
- [ ] The programmatic source-photo attach flows through `usePhotos.add`, inheriting its existing
      `photos.*` toasts (cloud-off → `photos.cloudRequired`, queue-fail, upload-fail) — no bespoke error path.
- [ ] Not-synced-to-Drive: attach surfaces `photos.cloudRequired` (non-fatal); the activity still creates.
- [ ] The consent-skip settings write is try/catch-wrapped with `resolvePhotoConsent(true)` in `finally`;
      a write failure logs but never strands the wedge.
- [ ] No silent failures anywhere in the new paths.
- [ ] Help Center article `how-beanies-ai-handles-your-photos` appended to `SECURITY_ARTICLES` and matches shipped behavior; consent checkbox renders label-only until `deploy-web.yml` is run, then upgrades to a working link (no live 404).

## Testing Plan

1. `npm run translate` (strings parse) → `npm run type-check` → `npm run lint`.
2. Unit/component (`npx vitest run`):
   - `useDocumentToActivity.test.ts`: success carrying `compressedBlob` → `onActivityReady` 3rd arg is a
     `File` from it; `undefined` when absent.
   - `settingsStore` setter test (mirror `settingsStore.persistDualSetting.test.ts`): persist + getter +
     default-false.
   - `ActivityModal` component test: `sourcePhoto` + prefill missing assignees → no attach; add assignee
     → attach fires exactly once (spy on `photoStore.addPhoto`, which `usePhotos.add` wraps); toggle
     assignee twice → still once (guard); cloud-off → surfaces `photos.cloudRequired`, does not throw.
   - Consent modal test: `confirm` emits `remember`; resets on re-open.
3. Manual (`npm run dev`): planner → 📸 → new copy → confirm → modal prefilled **with photo attached** →
   save → reopen, photo persists. Tick "don't ask again" → next 📸 skips. Settings → AI & Privacy → ON →
   prompt returns. Decline → no network, no toast.
4. E2E: **skip** (25-cap + three-gate filter); covered by the mounted-`ActivityModal` component test.
5. Full `npm run validate` (pre-push suite) before commit.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted copy table, photo-attach threading (blob→File→deferred gate-pass
  attach), family-scoped consent-skip mirroring `showPublicHolidays`, Settings card, tests, and a
  security/explainer Help Center article folded in as an acceptance criterion.
- **Pass 2 (DRY + error handling)**: Routed the source-photo attach through the existing `usePhotos.add`
  (inherits its full toast/error/spinner pipeline) instead of raw `photoStore.addPhoto`; named the
  existing `photos.cloudRequired` key; wrapped the consent-skip settings write in try/catch-finally so it
  never strands the wedge; corrected the Help-article target to `src/content/help/security.ts` (the `web/`
  path doesn't exist) + `openExternal` for the link; switched the Settings UI to the Quick-Toggles row
  pattern (not the clickable `SettingsCard`); flagged the three unchanged `ai.consent.*Label` keys and
  the title/confirm overwrite; hoist `compressed` out of the try block.
- **Pass 3 (Sustainability)**: Replaced the §2 deferred-attach (which coupled one-shot photo-attach to the
  unrelated `firstMissingFieldKey` validation predicate via a fire-once reactivity edge) with an explicit
  `maybeAttachSourcePhoto()` single trigger + synchronous pre-await null-out guard; made `onActivityReady`
  take a named options object (callback expected to grow) instead of a 3rd positional arg; required
  clearing `activitySourcePhoto` at the same sites as `activityPrefill` (incl. the manual-add reset) to
  prevent stale-photo leak; pinned the new `usePhotos` instance to the same binding; forbade touching
  `consentResolver` on the skip path; tied the checkbox reset to the `open`-prop edge; extracted
  `persistConsentSkip()`; noted the attach-timing UX asymmetry. Settings plumbing/§1/§4/Help/tests unchanged.
- **Pass 4 (Fresh-eyes sweep)**: Verified all claims against code; plan sound. Caught a prod-correctness
  gap — the privacy link depends on the separate manual `deploy-web.yml` marketing pipeline (not the app
  deploy), so the checkbox now renders label-only by default and upgrades to a link only after the web
  deploy (no live 404). Dropped the unnecessary `index.ts`/`categories.ts` registration (append to
  `SECURITY_ARTICLES` suffices) and the redundant `compressedMime` field (use `blob.type`). Flagged the
  `confirm`-emit parent rewiring (`@confirm="onConsentConfirm"`) + existing-test update.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial prompt (copy + checkbox request)

> please update the strings as below:
> title: welcome to beanies AI!
> intro: beanies will read this photo or document to magically extract the key details (well, it's not actually magic, it's just AI)
> what we send: only this one photo or document, never anything else, and _never_ any of your family's data.
> where it goes (managed): beanies uses a private, safe, and secure AI service that processes the document and keeps nothing. your document is fully encrypted while travelling to and from the service.
> where it goes (BYOK): to your own AI provider, using the key you've provided
> afterwards: nothing is stored. your photo or document is not stored or saved anywhere except within your beanies family data file.
> confirm: I understand - use beanies AI!
> footnote: we would never send without asking unless you agree - you have the option to choose each time. you can turn off this prompt by ticking the checkbox below.
> (NEW) user consent checkbox: (add something to this effect): i agree for beanies.family to privately and securely process the documents I choose (link to AI help center document with security / privacy info)
> Note - we should add a checkbox to disable this prompt if users agree (as per the footnote text I added below)

### Clarifications (AskUserQuestion answers)

> Afterwards copy → **Actually attach the photo** (make it true: attach the source photo to the created activity, saved in the family data file).
> Checkbox logic → **Optional "stop asking"** (confirm proceeds for this doc; ticking remembers + skips future prompts; reversible in Settings).
> Consent scope → **The whole family** (stored in the synced family data file; one member ticking it affects everyone; copy reads "for our family").

### Process direction

> use /beanies-plan to run the plan through the usual rigor

</details>
