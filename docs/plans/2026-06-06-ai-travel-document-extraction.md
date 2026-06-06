# Plan: AI travel-document extraction → travel segments (2nd AI/LLM wedge)

> Date: 2026-06-06
> Related issues: Notion #30 (no GitHub issue — direct implementation). Follows #133 (activity wedge), ADR-030 (private tiered AI).
> Plan file: `docs/plans/2026-06-06-ai-travel-document-extraction.md`

## User Story

As a user, I often have images, screenshots, or PDFs of my travel plans or official itineraries from airlines, hotels, and other providers. I want to create travel-plan segments automatically by having the AI/LLM read the document, so I can add travel plans quickly without manual data entry, with correct details — and if no matching trip exists yet, beanies creates one for me.

## Context

This is the **2nd major AI/LLM wedge feature** (the 1st, #133, extracts event/invitation photos into prefilled calendar activities). It reuses that pipeline wherever possible per the issue's explicit instruction ("reference the activity AI/LLM implementation, reuse where appropriate and do not duplicate code").

The existing #133 pipeline (verified map — signatures confirmed against source):

- `src/services/ai/documentExtractionService.ts` → `extractEventFromDocument(file, opts)` — tier-agnostic; client-compresses one document, reads to a base64 data URL, dispatches via `selectProvider(opts)`, and **never throws** — every failure resolves as `{ success: false, errorCode }`. Returns `compressedBlob` on success so the source image can be attached without re-compressing.
- `src/services/ai/extractionPrompt.ts` (client), `infrastructure/lambda/ai-extract/extractionPrompt.mjs` (server), `scripts/spikes/extractionPrompt.mjs` (spike) — THREE drift-pinned copies of `PROMPT_VERSION` + `EXTRACTION_JSON_SHAPE` + `buildExtractionMessages` + `REQUIRED_KEYS`, guarded by `src/services/ai/__tests__/extractionPromptDrift.test.ts`. Currently hardcoded for event extraction. The Lambda imports only `buildExtractionMessages` + `REQUIRED_KEYS` and has exactly one event-specific line (`isEvent=` in the success log) — the task-specific surface is narrow.
- Providers (all implement `ExtractionProvider { id; extract(req): Promise<ExtractionResult> }`): `managedProvider` POSTs `{ imageDataUrl, todayIso }` to `VITE_AI_EXTRACT_URL` → ai-extract Lambda → Tinfoil `qwen3-vl-30b`, validates via `parseExtractionResult`; `byokProvider` → `callOpenAiCompatibleVision`; `onDeviceProvider` stub. Failures throw `ExtractionProviderError(code)`; the service classifies into `ExtractionErrorCode`.
- `src/composables/useDocumentToActivity.ts` — thin orchestrator: `isProcessing` guard → offline guard → `extractEventFromDocument` → `onActivityReady({ prefill, confidence, sourcePhoto })`. Contains an inline `reportFailure(code)` switch mapping every `ExtractionErrorCode` to an informative toast — the shared error-reporting logic both wedges need.
- Consent: `DocumentExtractConsentModal.vue` (BeanieFormModal-based, document-generic copy) + a promise-based `requestPhotoConsent()`/`resolvePhotoConsent()`/`onConsentConfirm()` implemented inline in `FamilyPlannerPage.vue` + `settingsStore.skipDocumentConsentPrompt` (family-scoped) + `PRIVACY_ARTICLE_LIVE` gate.
- Capability/flag: `useAiCapability()` → `{ tier, byokConfig, isConfigured }`; `isFlagEnabled('aiPhotoExtract')` from `src/config/flags.ts` (`DevFlag` is a closed union).
- The ai-extract Lambda (`infrastructure/lambda/ai-extract/index.mjs`) accepts `{ imageDataUrl, todayIso }` (JPEG/PNG only, 2MB cap), calls Tinfoil, validates `REQUIRED_KEYS`, returns `{ result, attestation }`. It **ignores unknown body fields**. Terraform in `infrastructure/modules/ai-extract/`.

Travel data model (verified, `src/types/models.ts`):

- A trip is `FamilyVacation` with three nested segment arrays: `travelSegments`, `accommodations`, `transportation`, plus `ideas` and user-owned `startDate?/endDate?`.
- `VacationTravelType` = `flight_outbound|flight_return|flight_other|cruise|train|ferry|car|activity`; `VacationAccommodationType` = `hotel|airbnb|campground|family_friends`; `VacationTransportationType` = `airport_shuttle|rental_car|taxi_rideshare|bus`. All segments carry `status: 'booked'|'pending'`, `notes?`, and `photoIds?: UUID[]`.
- `VacationTripType` = `fly_and_stay|cruise|road_trip|combo|camping|adventure` (exactly 6 — `inferTripType` maps only to these).
- `CreateFamilyVacationInput = Omit<FamilyVacation,'id'|'createdAt'|'updatedAt'>`; the store further omits `activityId`. New-trip path must supply `name, tripType, assigneeIds, travelSegments, accommodations, transportation, ideas, createdBy` (`startDate/endDate` optional → derived).

Existing per-segment edit modals (verified — central to the review-modal design): `TravelSegmentEditModal.vue` (~930 lines), `AccommodationEditModal.vue`, `TransportationEditModal.vue`, `IdeaEditModal.vue`. Each is a BeanieFormModal `variant="drawer"` taking `{ open, segment, vacationId, segmentIndex }`, type-switching its field layout, validating via `useBookingValidation`, persisting via `updateVacation`. **They are NOT decomposed into reusable atomic field-editor components** — there is no `<FlightFields>` to import. `TravelPlansPage.vue` opens them via `openEditModal(item)` (line 430). Consequence: the review modal must NOT re-implement field editors; it is a summary+confirm surface, and post-save corrections route through these existing drawers.

Store + helpers (verified): `createVacation(input)` spreads `...input`, creates a linked all-day calendar activity, and derives dates via `computeVacationDates` **only when both startDate and endDate are absent**; `updateVacation(id, input)` auto-extends the window (never shrinks) + re-syncs the activity (warn-toast, not silent, on sync failure); `updateSegmentPhotoIds` sets an explicit `photoIds` array (an explicit-set path, not append). `utils/vacation.ts` has `buildTravelSegmentTitle`/`buildAccommodationTitle`/`buildTransportationTitle`, `tripPhase`, `computeVacationDates`, `isValidISODate`, `extendTripDates`.

Photo attachment (verified): the registered append path is `photoStore.addPhoto(file, 'vacations', vacationSegmentEntityId(vacationId, segmentId), createdBy)` (`vacationPhotoHooks` in `photoCollectionHooks.ts`, registered in `App.vue`). `addPhoto` handles PDFs natively (stored as-is) and images (compressed). So **attaching** a source PDF needs no new code; only the **extraction** call needs a rasterized image (Lambda is image-only).

Id generation (verified): the canonical helper is `generateUUID()` in `src/utils/id.ts` (prefers `crypto.randomUUID()` with a fallback). Use `generateUUID()`, never raw `crypto.randomUUID()`.

PDF rendering (verified): `pdfjs-dist` is **not** a dependency; `PhotoViewer.vue` renders PDFs via a native same-origin blob URL / inline browser rendering — there is nothing to reuse for page-1 pixel rasterization. Adding pdf.js is a genuine new dependency with bundle cost.

Permissions (verified): `usePermissions()` exposes `isOwner | canManagePod | canViewFinances | canEditActivities`. There is **no** travel-specific permission; `TravelPlansPage.vue` already gates writes on `canEditActivities`. Use it.

## Requirements

1. From the travel surface, the user can upload a travel document (image or PDF) and have the AI extract it into one or more travel segments.
2. Each extracted segment is created with the correct **kind** (travelSegment / accommodation / transportation) and **type** (flight, cruise, hotel, train, car/transport, etc.), with recognizable fields populated.
3. Details with no corresponding field are summarized into that segment's `notes` overflow field (no data loss).
4. **Parent-trip resolution** when the user hasn't already picked a trip:
   - Exactly one existing (non-past) trip whose window overlaps the extracted dates → default to attaching there.
   - Two or more overlapping trips → user is prompted to choose.
   - No overlapping trip → prefill a NEW trip (name, type, dates derived from the document) for the user to confirm/edit, then attach.
5. Trip creation/attachment always passes through a user confirm/review step — never a silent auto-create (consistent with #133).
6. The source document is attached to the created segment(s) via the existing `'vacations'` photo pipeline.
7. All new user-visible strings via `uiStrings.ts` (en + beanie), zh regenerated. Reuse existing AI/consent strings where they fit.
8. Ship behind a feature flag (`aiTravelExtract`, prod-off).
9. Reuse the #133 extraction service / providers / consent / capability / error-reporting layers — do not duplicate them.

## Important Notes & Caveats

- **Multi-segment is the core new complexity.** Unlike #133 (one event → one activity), a travel document can yield several segments of different kinds. The extraction output is an array; the review UI presents 1..N.
- **Review modal is a summary+confirm surface, NOT an editor.** The existing `*EditModal.vue` own type-switched field layout + validation + persistence. The flow is **draft → confirm → create → (optional) correct a field via the existing edit drawer** (`openEditModal(item)`). Exactly one flight/cruise/hotel editor exists in the app. This is the most important anti-complexity decision.
- **Trip resolution is pure and lives outside the UI.** Match/prompt/create is a pure decision (`resolveTripTarget`); the modal renders an already-made decision and holds no overlap logic.
- **pdf.js is a NEW dependency (bundle cost).** No existing rasterizer to reuse. Add `pdfjs-dist` but **dynamic-import it only inside the travel-wedge path** (code-split, worker via Vite `?url`), so it never enters the main bundle or the activity wedge. The whole feature is flag-gated prod-off, so the chunk ships but is never fetched in prod until the flag flips. (Alternative — images-only v1 — rejected: travel confirmations are overwhelmingly PDFs.)
- **Don't fork the Lambda — bound the `task` parameterization.** Parameterize `/ai-extract` with a `task` discriminator (default `'event'`) via an explicit **task registry** (`{ event: {...}, travel: {...} }` mapping `task → { buildMessages, requiredKeys }`), not scattered `if (task===…)`. Adding a task = one registry entry per copy; the drift test loops the registry. Exit criterion: if a 3rd task is ever proposed, revisit whether the drift-triple should become a single shared prompt module (the triple, not the switch, is the real long-term cost).
- **Lambda-before-client sequencing (hard ordering).** Phase A must deploy before any client build that sends `task: 'travel'`. The Lambda change is backward-compatible: missing/invalid `task` defaults to `'event'`, and `REQUIRED_KEYS`/prompt/logging key off the registry, so the live activity wedge is byte-identical. The flag gates the travel path, so no travel request can hit an un-upgraded prod Lambda.
- **DRY the error switch.** Extract `useDocumentToActivity.reportFailure` into a shared `reportExtractionFailure(code, { t, showToast })` consumed by both wedges — do not copy-paste.
- **Attachment uses `addPhoto`, not `updateSegmentPhotoIds`** — the verified append path is `photoStore.addPhoto(file, 'vacations', vacationSegmentEntityId(vacationId, segmentId), createdBy)`. Photo-attach failure is **warn-not-rollback** (never undo saved segments), consistent with `updateVacation`'s activity-sync posture.
- **Use `generateUUID()`** from `@/utils/id` for all generated segment ids.
- **`createVacation` date seeding:** auto-seeds only when both dates are absent. The new-trip path passes explicit `startDate`/`endDate` derived from the extracted segments when available, else lets `computeVacationDates` seed. Always pass `ideas: []`.
- Consent/privacy model unchanged (same proxy, same data-minimization: exactly one compressed/rasterized document leaves the device). No new ADR; extends ADR-030.

## Assumptions

1. Reusing `qwen3-vl-30b` for travel docs is adequate (the #133 spike validated it on real itineraries/PDFs).
2. v1 rasterizes **page 1** of a PDF only for extraction; multi-page itineraries beyond page 1 are a documented limitation (toast-informed). The full original PDF is still attached.
3. The same family-scoped consent + `skipDocumentConsentPrompt` setting governs both wedges. The consent gate is lifted into a shared `useDocumentConsent()` composable so both pages share one implementation.
4. A separate flag `aiTravelExtract` (not reusing `aiPhotoExtract`) lets the two wedges ramp independently.
5. Users edit individual extracted fields via the existing per-segment edit drawers **after** create, not in the review modal. The review modal shows a read-friendly per-segment summary with low-confidence flags. (Fallback if inline pre-save correction proves essential: open the existing edit modal over a not-yet-persisted draft — still no new field editors; captured as a follow-up, not v1.)
6. The managed proxy Lambda can be deployed independently and ahead of the client (standard for this repo's infra/lambda split).

## Approach

Phased, reuse-first. Each phase is independently shippable behind `aiTravelExtract` (prod-off); nothing in Phases A–E is user-reachable until Phase F wires the entry point, so the work merges incrementally with no big-bang.

### Phase A — Backend: parameterize the Lambda by a task registry (deploy FIRST)

1. In all three prompt copies, introduce a **task registry** keyed by `task`: `event` (existing `buildExtractionMessages`/`REQUIRED_KEYS`, unchanged) + `travel` (`buildTravelMessages(imageDataUrl, todayIso)`, `TRAVEL_JSON_SHAPE`, `TRAVEL_REQUIRED_KEYS`). `buildExtractionMessages(imageDataUrl, todayIso, task = 'event')` selects by task (default `'event'`). Bump `PROMPT_VERSION`.
2. `infrastructure/lambda/ai-extract/index.mjs`: read `task` from the body (default `'event'`; reject unknown task → 400); look up `{ buildMessages, requiredKeys }` from the registry. Everything else (Tinfoil call, auth, 2MB cap, error classification, byte-free logging, top-level try/catch) is shared unchanged. Generalize the success log from `isEvent=…` to `task=<task>`.
3. `infrastructure/lambda/ai-extract/__tests__/handler.test.mjs`: add `task: 'travel'`, missing-task→event, unknown-task→400 cases.
4. `extractionPromptDrift.test.ts`: loop the drift assertion over the registry (per task: version + shape + required-keys + built messages identical across the three copies).

Travel output schema (model returns):

```
{
  isTravel: boolean,        // false if not a travel document
  tripName: string,         // suggested destination-based trip name, or ""
  tripTypeHint: string,     // one of the 6 VacationTripType, or ""
  segments: [{
    kind: "travel"|"accommodation"|"transportation",
    type: string,           // kind-specific sub-type (validated/coerced client-side)
    title: string,          // "" → derive via build*Title
    status: "booked"|"pending",
    bookingReference: string,
    notes: string,          // overflow: anything not in a dedicated field
    ...kind-specific fields,
    confidence: { <keyField>: 0..1 }
  }]
}
```

### Phase B — Client extraction service: generalize by task

1. Add `task?: 'event'|'travel'` to `ExtractionRequest` (default `'event'`). Keep `extractEventFromDocument` as the back-compat wrapper; add `extractTravelFromDocument(file, opts): Promise<TravelExtractionResult envelope>`. Factor the shared compression + base64 + provider-dispatch + `compressedBlob` body into one private helper parameterized by `{ task, parse }`.
2. `managedProvider` adds `task` to its POST body and selects the parser by `request.task`; `byokProvider`/`openaiCompatible` build task messages (via the registry) and parse the task result. Provider interface stays pure (no travel-shaped fields leak into `types.ts` beyond the new result type).
3. Add `TravelExtractionResult`, `TravelSegmentDraft`, and `parseTravelExtractionResult(raw)` in `extractionPrompt.ts` (mirrors `parseExtractionResult`): validates the array, clamps confidences, defaults strings/booleans, **throws on missing required keys** (callers wrap as `malformed_output`).

### Phase C — Pure mapper: extraction → segment buckets

New pure `src/utils/travelExtractionToSegments.ts` (total, no throws):

- `travelExtractionToSegments(result): { travelSegments, accommodations, transportation }` — buckets each draft by `kind`, builds the typed object with `generateUUID()`, coerces `type` to the valid enum (safe default per kind: `activity` / `hotel` / `taxi_rideshare`), fills recognized fields, drops overflow into `notes`, sets `status`, and derives titles via `buildTravelSegmentTitle`/`buildAccommodationTitle`/`buildTransportationTitle` when `title` is empty. Malformed/unrecognized-kind drafts are skipped with a `console.warn` (`[travel-extract]` prefix) — never thrown, never silently dropped.
- `inferTripType(result): VacationTripType` — from `tripTypeHint` when one of the 6 valid values, else derived from segment kinds (cruise → `cruise`; flight+accommodation → `fly_and_stay`; car/road → `road_trip`; default `fly_and_stay`).

### Phase D — Trip resolution + store (pure decision; store owns the merge)

1. `utils/vacation.ts` pure `tripsOverlappingRange(vacations, range, todayStr): FamilyVacation[]` — non-past trips (via `tripPhase`) whose `[startDate,endDate]` overlaps the extracted `[start,end]`. Guards missing/invalid dates — no throw.
2. `utils/vacation.ts` pure `resolveTripTarget(matches)` → `{ kind: 'create' } | { kind: 'attach', vacationId } | { kind: 'choose', candidates }` (0 → create; 1 → attach; >1 → choose). The composable and modal both consume this; neither re-derives the rule.
3. `vacationStore.addExtractedSegments(vacationId, buckets)` — finds the vacation (warns + returns on miss), concatenates the new segments, persists via `updateVacation` (auto-extends window + re-syncs activity). Returns the created segment ids for attachment.
4. New-trip path reuses `createVacation({ name, tripType, assigneeIds, createdBy, ideas: [], ...buckets, startDate?, endDate? })` — passing explicit derived dates when available, else letting `computeVacationDates` seed. Returns the new vacation (with its segment ids).

### Phase E — Composables (thin, DRY)

1. Extract a shared `reportExtractionFailure(code, { t, showToast })` from `useDocumentToActivity` into a small shared module consumed by **both** wedges; refactor `useDocumentToActivity` to use it (net reduction).
2. Lift the consent gate (`requestPhotoConsent`/`resolvePhotoConsent`/`onConsentConfirm`/`persistConsentSkip`) out of `FamilyPlannerPage` into `useDocumentConsent()`; refactor `FamilyPlannerPage` to use it (keep its tests green); `TravelPlansPage` reuses it.
3. New `useDocumentToTravel({ onTravelReady })` — thin: `isProcessing` guard → offline guard → (PDF? lazy-import the rasterizer → page-1 image; classify failure as `compression`) → `extractTravelFromDocument` → `travelExtractionToSegments` + `inferTripType` → `tripsOverlappingRange` + `resolveTripTarget` → emit `onTravelReady({ buckets, tripType, decision, suggestedTripName, sourceFile, confidence })`. No persistence, no rule logic. Travel-specific branch: `isTravel === false` or empty segments → friendly "couldn't find travel details" toast, nothing created. Reuses `reportExtractionFailure`.

### Phase F — Travel page wiring + review UI (thin orchestrator + presentational pieces)

1. `TravelPlansPage.vue`: add the upload entry, gated by `isFlagEnabled('aiTravelExtract')` **and** `canEditActivities`. Reuse `DocumentExtractConsentModal` via `useDocumentConsent`.
2. New `src/utils/pdfFirstPageToImage.ts` — **dynamic-imports `pdfjs-dist`** (code-split, worker via `?url`), renders page 1 to a canvas, returns a JPEG `File`. Image inputs bypass entirely. Errors classify into the existing `compression` path.
3. New `TravelExtractReviewModal.vue` (BeanieFormModal-based) — **summary + confirm only.** Receives the decided `{ buckets, decision, suggestedTripName, tripType }`; renders a trip-target section reflecting `decision` (attach-to-one / choose-from-candidates / create-new with editable name) and a small presentational `ExtractedSegmentRow.vue` per segment (icon, derived title, key fields, low-confidence flag). No overlap logic, no field forms. On confirm: `create` → `createVacation(...)`; `attach`/`choose` → `addExtractedSegments(vacationId, buckets)`; then for each saved segment `photoStore.addPhoto(sourceFile, 'vacations', vacationSegmentEntityId(vacationId, segmentId), createdBy)` with try/catch + warn-not-rollback. Post-save correction via the existing `openEditModal(item)` drawers.
4. Reuse the processing overlay/spinner pattern from the planner.

### Phase G — Flag, i18n, Help Center, tests

- Add `aiTravelExtract` to `DevFlag` (prod-off).
- i18n keys (upload CTA, review modal, target chooser, toasts) en + beanie + zh via `npm run translate`. Reuse existing `ai.*`/`photos.*` keys where they fit.
- Help Center how-to `add-travel-plans-from-a-document` (draft, `PRIVACY_ARTICLE_LIVE`-gated), mirroring the #133 article + ADR-030 privacy framing ("attested confidential compute + zero retention", NOT "no intermediary sees the document").
- Unit tests: `travelExtractionToSegments`, `inferTripType`, `tripsOverlappingRange`, `resolveTripTarget`, `parseTravelExtractionResult`, `pdfFirstPageToImage` error mapping (mocked pdf.js), `addExtractedSegments`, the shared `reportExtractionFailure`, drift loop (both tasks), Lambda handler cases. Pure utils + composable logic only — no heavy modal mount tests.

## Files Affected

**New:** `src/utils/travelExtractionToSegments.ts`, `src/utils/pdfFirstPageToImage.ts`, `src/composables/useDocumentToTravel.ts`, `src/composables/useDocumentConsent.ts`, the shared `reportExtractionFailure` helper, `src/components/travel/TravelExtractReviewModal.vue`, `src/components/travel/ExtractedSegmentRow.vue`, the Help Center article, and tests for all of the above.

**Modified:** `scripts/spikes/extractionPrompt.mjs`, `src/services/ai/extractionPrompt.ts`, `infrastructure/lambda/ai-extract/extractionPrompt.mjs` (task registry + travel prompt/schema, `PROMPT_VERSION` bump); `infrastructure/lambda/ai-extract/index.mjs` (task default + per-task keys/logging) + its handler test; `extractionPromptDrift.test.ts` (registry loop); `src/services/ai/types.ts` (`task`, `TravelExtractionResult`); `src/services/ai/providers/managedProvider.ts` (+`task` in body, parser select); `src/services/ai/documentExtractionService.ts` (`extractTravelFromDocument` + shared helper); `src/utils/vacation.ts` (`tripsOverlappingRange`, `resolveTripTarget`); `src/stores/vacationStore.ts` (`addExtractedSegments`); `src/composables/useDocumentToActivity.ts` (consume shared helper); `src/pages/FamilyPlannerPage.vue` (consume `useDocumentConsent`); `src/pages/TravelPlansPage.vue` (upload entry + review modal); `src/config/flags.ts` (`aiTravelExtract`); `src/services/translation/uiStrings.ts` + generated zh; `package.json` (`pdfjs-dist`, lazy-loaded).

## Help Center Coverage

- **Action**: new article
- **Category**: `features`
- **Article type**: `how-to`
- **Slug**: `add-travel-plans-from-a-document`
- **Title**: Add travel plans from a photo or PDF
- **Scope**: How to upload an itinerary/booking (image or PDF), what gets extracted into a travel segment, how beanies attaches it to an existing trip or creates a new one, that the user always confirms before anything is saved, and that any field can be corrected afterward in the segment's edit drawer.
- **Notes**: YMYL/privacy-adjacent — must state that one compressed/rasterized copy of the document is sent for processing (same posture as the activity feature; ADR-030 framing). Gated behind `PRIVACY_ARTICLE_LIVE` until the security article ships; needs greg's voice pass; start `draft: true`.

## Acceptance Criteria

- [ ] With `aiTravelExtract` off (prod default): no UI entry on the travel page, no travel code path runs, zero change to the activity wedge or managed proxy.
- [ ] Lambda with the task registry runs the existing event extraction byte-identically when `task` is missing/`'event'`, the travel extraction when `task: 'travel'`; unknown task → 400.
- [ ] Uploading a flight/hotel/train/cruise/car document (image or PDF) creates the correct segment kind+type with fields populated and overflow in `notes`.
- [ ] Multi-segment documents (e.g. outbound+return) produce multiple segments in one review.
- [ ] No overlapping trip → a new trip is prefilled (name/type/dates from the doc) and created on confirm (with `ideas: []`).
- [ ] Exactly one overlapping trip → it's the default target; two or more → user must choose.
- [ ] Nothing is created until the user confirms; the review modal contains no overlap logic and no field forms; post-save field edits go through the existing `*EditModal` drawers.
- [ ] The source document is attached to the created segment(s) via `addPhoto`/`'vacations'`; an attach failure warns (never rolls back, never silent).
- [ ] Non-travel document → friendly "couldn't find travel details" toast, nothing created.
- [ ] All generated ids use `generateUUID()`; unknown `type` coerces to a safe enum default; `pdfjs-dist` is code-split (not in the main bundle).
- [ ] Both wedges share one `reportExtractionFailure` mapping; errors never fail silently.
- [ ] Help Center article added (draft), i18n en+beanie+zh, `npm run validate` green.

## Testing Plan

1. Unit (pure): `travelExtractionToSegments` (bucketing, enum coercion, overflow→notes, title fallback, id generation), `inferTripType` (all six + hint precedence), `tripsOverlappingRange` (overlap/past-exclusion), `resolveTripTarget` (0/1/many), `parseTravelExtractionResult` (shape validation), `pdfFirstPageToImage` (error→`compression` with mocked pdf.js).
2. Service/provider: `extractTravelFromDocument` success + each error code; `extractEventFromDocument` unchanged; `managedProvider` sends `task` and selects the right parser; absent-task path unchanged.
3. Drift loop (both tasks) + Lambda handler (`travel`, missing→event, unknown→400, existing event cases green).
4. Composable: `useDocumentToTravel` offline guard, failure reporting via shared helper, `onTravelReady` payload; consent-refactor regression (FamilyPlanner tests green after lifting `useDocumentConsent`).
5. Manual (flag on, staging): image upload, PDF upload, attach (single match), create (no match), choose (multiple), attach-failure warning, non-travel toast, post-save edit via the existing drawer.
6. `npm run validate` + `npm run translate`.

## Review Passes

- **Pass 1 (Initial draft)**: Established the mirror-#133 architecture — task registry in the prompt, `extractTravelFromDocument`, pure mapper, trip-target resolver, store action, thin composable, review modal, flag + i18n + Help Center.
- **Pass 2 (DRY / error-handling, source-verified)**: Corrected the attachment path to `photoStore.addPhoto(... 'vacations' ...)` append hook (PDFs attach as-is); promoted the #133 `reportFailure` switch to a shared `reportExtractionFailure` consumed by both wedges; lifted the consent gate into `useDocumentConsent`; confirmed `createVacation` needs `ideas: []` + buckets; added explicit non-silent handling for PDF rasterization + document attach (warn-not-rollback).
- **Pass 3 (Sustainability / maintainability, source-verified)**: Confirmed no reusable atomic field-editors exist (`TravelSegmentEditModal` is ~930 lines, monolithic) → reworked the review modal to summary+confirm with post-save correction via the existing `*EditModal` drawers (one editor in the app); de-coupled trip resolution from the UI via pure `resolveTripTarget`; bounded the `task` parameterization with an explicit task registry + drift loop + a 3rd-task exit criterion; reaffirmed thin composables; made phasing incremental behind the flag.
- **Pass 4 (Fresh-eyes final sweep, source-verified)**: Corrected id generation to `generateUUID()` from `@/utils/id` (not raw `crypto.randomUUID()`); confirmed pdf.js is a genuine NEW dependency (`PhotoViewer` uses native blob/iframe — nothing to reuse) → scoped `pdfjs-dist` lazy-loaded + code-split inside the flag-gated path; hardened Lambda-before-client deploy sequencing (Lambda defaults missing `task` to `'event'`, keys required-keys/logging by task); confirmed `canEditActivities` is the correct gate (no travel-specific permission) and `openEditModal(item)` is the real post-save correction entry; noted `createVacation` only auto-seeds dates when both are absent (so pass explicit derived dates).

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt (via /beanies-pre-plan from Notion #30)

Implement the capability to read travel plans similar to the capability implemented for activities — the 2nd major AI/LLM wedge. Upload a photo/screenshot/PDF of a travel itinerary/booking; AI reads it and creates travel-segment items with the correct kind/type and all relevant details, overflow into notes. Reuse the activity AI implementation, don't duplicate. Simple, prominent upload UX (reference the activity AI upload element). GitHub issue: SKIP.

### Follow-up (parent-trip resolution)

If a user uploads a travel segment and no corresponding trip exists yet, beanies should create an appropriately named trip first (with dates derived from the segment), then add the segment. Decision: match-then-create with a confirm step; if 2+ trips overlap the segment's dates, prompt the user to choose. Include this in #30's scope.

</details>
