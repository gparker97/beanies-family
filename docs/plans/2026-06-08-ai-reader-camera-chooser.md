# Plan: Camera-or-file chooser for the AI document readers (mobile parity)

> Date: 2026-06-08
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-06-08-ai-reader-camera-chooser.md`

> **No GitHub issue created.** Approved for direct implementation. Full prompt history in the Prompt Log.

## User Story

As a parent using the native mobile app, when I tap "Magic beans" to read an invite or a booking, I want the option to **take a photo with my camera** as well as pick an existing file — just like the web version — so I can snap a paper notice on the spot.

## Context

The AI "Magic beans" readers (photo→activity, document→trip) open a single hidden `<input type="file" accept="image/*,application/pdf,.pdf">` (`AI_PICKER_ACCEPT`, `src/constants/aiDocumentPicker.ts`) with NO `capture`. On desktop/mobile Chrome the browser shows a rich camera-or-files chooser, but on a **Capacitor Android WebView a mixed image+PDF accept routes straight to the documents picker (SAF), which has no camera** — the camera intent only reliably appears for an image-only accept or with `capture`. So the native app has no camera path. (iOS will be identical once it ships.) **greg reproduced this on the live Android build** (the bug report), so the premise is user-confirmed.

We can't fix via the single accept: image-only drops PDF support (itineraries/invites as PDF); `capture` would force the camera (losing file choice). Two inputs + a chooser are required.

**Doc-comment contradiction to fix (Pass 4):** the shipped `AI_PICKER_ACCEPT` comment claims the mixed accept _"reliably surfaces the 'Take Photo / Camera' entry in the mobile file chooser."_ That is true for **mobile-web Chrome** but NOT the **native Capacitor WebView (SAF)** — which is the reported bug. Fix the comment to scope it (mobile-web vs native WebView) in the same PR so the next reader isn't misled. No change to the constant's value.

**The app already solves the analogous problem** in `PhotoAttachments.vue`: a gallery/file picker (`image/*,application/pdf`, no capture) + a separate camera picker (`image/*`, `capture: 'environment'`) shown on touch-primary devices via `useIsTouchPrimary()`. `capture="environment"` launches the system camera via intent, needs NO `android.permission.CAMERA` (manifest declares only INTERNET; the required `FileProvider` IS configured) — which is why PhotoAttachments' camera works natively. We mirror that pattern. The missing native piece is specifically the **mixed image+PDF** accept; splitting into two inputs (image-only camera + image+PDF file) restores parity.

## Requirements

1. On **touch-primary** devices, after consent, the AI reader shows a small chooser: **Take a photo** (camera) and **Choose a file** (image or PDF). Camera → image-only capture; File → the existing image+PDF picker.
2. On **non-touch** (desktop), no chooser — open the existing image+PDF file input directly (Chrome already offers camera+files; desktop has no camera-app concept). Behavior unchanged.
3. Applies to **both** readers — photo→activity (`FamilyPlannerPage`) and document→trip (`TravelPlansPage`) — via ONE shared abstraction (no per-page duplication).
4. **Consent-first ordering preserved**: consent → chooser → input. Declined consent = silent no-op (no chooser, no picker). The chooser is dismissable (cancel/backdrop = clean no-op).
5. The chosen file feeds the SAME `processPhoto` / `processTravelDoc` — no new extraction logic, **no new error handling** (those composables own every failure path). Camera yields an image; PDFs stay file-only (can't photograph a PDF).
6. New chooser strings via i18n (en + beanie + zh). On-brand modal + copy.
7. Client-only; no prompt/Lambda change. User-visible → CHANGELOG.

## Verified reuse (codebase read)

- `useFilePicker` (`src/composables/useFilePicker.ts`) supports `accept`/`multiple`/`capture` (capture only emitted when set), clears `input.value` after each pick, exposes `open()`/`inputRef`/`bindings`. `open()` is `inputRef.value?.click()` — a **silent no-op if the ref is null** (guarded below). Reuse as-is, two instances.
- `useIsTouchPrimary` (`src/composables/useIsTouchPrimary.ts`) — `(pointer: coarse)`, reactive, **mounted-gated** (false until `onMounted`). The gate PhotoAttachments uses. Do NOT use `Capacitor.isNativePlatform()` (confined to `src/services/sync/capabilities.ts`).
- `RecurringEditScopeModal.vue` — canonical "`BaseModal size='sm' layer='overlay'` + v-for icon-squircle choice-button list" (lines 43-67). The reuse target for the chooser's visual idiom.
- `BaseModal.vue` props: `open`, `title?`, `size?` (`'sm'`), `layer?` (`'overlay'`), emits `close` (backdrop + close button). Matches `ChoiceModal`'s needs.
- `BeanieIcon` registry (`src/constants/icons.ts`) contains both `camera` and `image` — the two chooser icons resolve to real glyphs.
- `processFile` in `useDocumentToActivity.ts` / `useDocumentToTravel.ts` already guards offline, try/catches extraction, and toasts every failure code (`useExtractionErrorToast`) — documented non-silent. Do not re-wrap.
- `src/components/ai/` already exists (`DocumentExtractConsentModal.vue`, `MagicReaderCard.vue`, `MagicReaderPill.vue`, `__tests__/`). New component + test fit the structure.
- Page wiring: `FamilyPlannerPage` `photoPicker` (L234-242) + `handleAddFromPhoto` (consent → `photoPicker.open()`, L252-256) + input function-ref (L764); `TravelPlansPage` `docPicker` (L103-111) + `handleAddFromDocument(tripId?)` (sets/clears `pendingTripTarget` around consent, L118-126) + input (L1825). Both register the handler via `useMagicReaderConsumer` (FPP L260, TPP L130) — the handler must remain the single entry point.
- Function-ref binding (`:ref="(el) => (picker.inputRef.value = el)"`) is the codebase idiom for the hidden inputs; the page→AiDocumentPicker link is a normal component `ref` + `defineExpose({ pick })`.

## Error Handling (no silent failures)

1. **`pick()`/`onChoose` with a null input ref** (`open()` no-ops silently). Guard explicitly: `console.error('[AiDocumentPicker] pick() called before input mounted …')` + a toast (`ai.error.title` / generic body). In practice both inputs render **unconditionally** (NOT `v-if`'d on `isTouchPrimary` — gate only the chooser modal), so refs stay live; the guard documents the contract.
2. **`@file` → `processFile`**: `void` the returned promise at the call site (it owns its own try/catch + toasts). No second try/catch — no double-toast, no swallow. Mirrors today's `if (files[0]) void processPhoto(files[0])`.

No other new failure surface (chooser open/close is local state; consent unchanged on the pages).

## Assumptions

1. `useIsTouchPrimary()` is the right gate (same one PhotoAttachments uses).
2. A `capture="environment"` image input opens the camera on the Android WebView without `android.permission.CAMERA` (PhotoAttachments proves it; FileProvider present).
3. Consent gates stay on the pages; only the post-consent "open picker" step changes.
4. The mixed-accept-has-no-native-camera premise is user-confirmed (greg's report); the doc-comment fix scopes the contradiction.

## DRY decision: extract `ChoiceModal` for the NEW feature; defer the `RecurringEditScopeModal` refactor

Extract a presentational **`src/components/ui/ChoiceModal.vue`** — a thin generic wrapper over `BaseModal size="sm" layer="overlay"` taking `open`, `title`, `options: {id,icon,label,description?}[]`, emitting `select(id)` + `close`. Body = the icon-squircle button list generalized over `options`. `AiDocumentPicker` renders `<ChoiceModal>` with two options → zero bespoke modal markup.

**Do NOT refactor `RecurringEditScopeModal` onto `ChoiceModal` in this PR.** That modal has **no tests** (verified). Rewriting an untested, shipping, user-facing surface to dedupe ~25 lines of cosmetic markup, inside an unrelated feature PR, expands blast radius and couples concerns. Record a STATUS follow-up: _"`RecurringEditScopeModal` + PhotoAttachments' camera/gallery tiles are candidate `ChoiceModal` consumers; migrate behind a characterization test."_ DRY honored where cheap and safe; deferred where it isn't.

## Approach

**A. `src/components/ui/ChoiceModal.vue` (new, presentational)** — wraps BaseModal; v-for option buttons (icon squircle + label + optional description) → `select(id)`; `@close` → `close`. No app state, no i18n inside (callers pass translated strings).

**B. `src/components/ai/AiDocumentPicker.vue` (new, self-contained)**

- camera `useFilePicker({ accept: 'image/*', capture: 'environment', multiple: false, onPick })`; file `useFilePicker({ accept: AI_PICKER_ACCEPT, multiple: false, onPick })`; both `onPick: (f) => { if (f[0]) emit('file', f[0]); }`.
- `showChooser = ref(false)`, `isTouchPrimary = useIsTouchPrimary()`.
- `defineExpose({ pick })` (mirrors `PhotoAttachments.openPicker`): `pick()` → touch-primary ? `showChooser = true` : open file input (with null-ref guard).
- `<ChoiceModal :open="showChooser" :title="t('ai.picker.title')" :options="[{id:'camera',icon:'camera',label:t('ai.picker.takePhoto')},{id:'file',icon:'image',label:t('ai.picker.chooseFile')}]" @select="onChoose" @close="showChooser=false" />`.
- `onChoose(id)`: `showChooser=false`; `id==='camera' ? cameraPicker.open() : filePicker.open()` (null-ref guard).
- Both hidden `<input>` rendered **unconditionally** (function-ref + `v-bind="bindings"`). Emits `@file`.

**C. Wire the two pages** — replace `photoPicker`/`docPicker` + their hidden inputs with `<AiDocumentPicker ref @file="(f) => void processX(f)" />`; `handleAdd*` calls `aiPicker.value?.pick()` after consent; keep `pendingTripTarget` set/clear (travel) and `useMagicReaderConsumer` registration. Grep each file to confirm `useFilePicker`/`AI_PICKER_ACCEPT` are unused before dropping the imports.

**D. i18n** (`uiStrings.ts`, en+beanie+zh): `ai.picker.title` ("How do you want to add it?"), `ai.picker.takePhoto` ("Take a photo"), `ai.picker.chooseFile` ("Choose a file"). Dedicated `ai.picker.*` (don't reuse `photos.*`). `npm run translate`, hand-fix zh.

**E. Doc fix** — scope the `AI_PICKER_ACCEPT` comment in `aiDocumentPicker.ts` (mobile-web vs native WebView). No value change.

**F. Tests**

- `ChoiceModal.test.ts`: one button per option; click → `select(id)`; `@close` on backdrop/close; description renders only when provided.
- `AiDocumentPicker.test.ts`: touch-primary → `pick()` shows chooser; non-touch → opens file input directly; camera bindings have `capture:'environment'`+`accept:'image/*'`; file uses `AI_PICKER_ACCEPT`; selecting a file emits `@file` once. `useIsTouchPrimary` is mounted-gated → mock `window.matchMedia` (`{matches:true}`) and assert after mount/tick. Light; no full-page mount.
- No `RecurringEditScopeModal` step (untested, untouched).

## Files Affected

- `src/components/ui/ChoiceModal.vue` (new)
- `src/components/ai/AiDocumentPicker.vue` (new)
- `src/pages/FamilyPlannerPage.vue`, `src/pages/TravelPlansPage.vue` (swap to `<AiDocumentPicker>` + `pick()`; drop unused imports after grep)
- `src/constants/aiDocumentPicker.ts` (doc-comment scope fix only)
- `src/services/translation/uiStrings.ts` (+ `public/translations/zh.json` via translate)
- `src/components/ui/__tests__/ChoiceModal.test.ts`, `src/components/ai/__tests__/AiDocumentPicker.test.ts` (new)
- `CHANGELOG.md`, `docs/STATUS.md` (incl. deferred-refactor note)
- **Not modified:** `src/components/ui/RecurringEditScopeModal.vue`

## Acceptance Criteria

- [ ] Native Android: Magic beans → consent → camera/file chooser → "Take a photo" opens camera; "Choose a file" opens image+PDF picker.
- [ ] Desktop: unchanged — consent → file dialog directly (no chooser).
- [ ] Both readers use the shared `AiDocumentPicker`; both still route through their existing consent handler (incl. `useMagicReaderConsumer`).
- [ ] Chooser is the new `ChoiceModal`; `AiDocumentPicker` has no bespoke modal markup. `RecurringEditScopeModal` untouched (no diff).
- [ ] Both inputs render unconditionally (only the chooser is touch-gated).
- [ ] Declined consent → silent no-op; chooser cancel → clean no-op; `pick()` with unmounted input → console.error + toast.
- [ ] No new error handling around `processFile` (existing toasts remain the single source).
- [ ] PDFs still selectable; captured photo flows through the same extraction.
- [ ] i18n en/beanie/zh present; `camera`/`image` icons render; `AI_PICKER_ACCEPT` comment no longer contradicts native behavior.
- [ ] `npm run validate` green.

## Testing Plan

1. Unit: ChoiceModal + AiDocumentPicker (matchMedia mocked for the touch branch).
2. Manual (desktop dev): both readers open the file dialog directly; extraction works; recurring-edit scope modal visibly unchanged.
3. Manual (Android build): both readers show the chooser; camera captures + extracts; image + PDF file picks extract; cancel is a no-op.
4. `npm run validate` green.

## Review Passes

- **Pass 1 (Initial draft)**: Shared `AiDocumentPicker` (camera + file inputs + touch-primary chooser, `pick()` via defineExpose) for both readers; mirrors PhotoAttachments' capture pattern; consent-first preserved.
- **Pass 2 (DRY / error-handling)**: Extracted a generic `ChoiceModal` (proposed also refactoring `RecurringEditScopeModal` onto it); confirmed `processFile` owns all error handling so the picker stays thin; added the null-ref guard.
- **Pass 3 (Sustainability)**: Corrected a false "RecurringEditScopeModal has tests" claim (it has none) → **deferred** its refactor to a test-first follow-up; kept `ChoiceModal` for the new feature only (smaller, safer diff); confirmed `defineExpose({ pick })` matches the existing `PhotoAttachments` idiom.
- **Pass 4 (Fresh-eyes)**: Re-verified every line ref. Surfaced the real contradiction between the plan's premise and the shipped `AI_PICKER_ACCEPT` doc comment (mobile-web vs native WebView) → added the doc-comment fix (premise is user-confirmed via greg's report). Added "render both inputs unconditionally; gate only the chooser" to avoid a null-ref hazard; confirmed `camera`/`image` icons exist; tightened the touch-primary test to mock `matchMedia`.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial report (verbatim)

"One thing I noticed on the android app just now is that when you click on the 'magic beans' or AI button, after the AI consent modal, the app goes straight to the system file picker and does not provide the option to open the camera to take a picture. On the PWA, there is a chooser to select either camera or device file picker. Can you check this issue?"

### Direction

greg chose (AskUserQuestion): "Plan it via /beanies-plan" — a shared consent → camera-or-file chooser → file path reused by both the photo→activity and document→trip readers.

</details>
