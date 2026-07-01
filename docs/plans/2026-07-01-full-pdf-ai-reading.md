# Plan: Full-PDF reading for the AI document readers (activity + travel)

> Date: 2026-07-01
> Related issues: None — direct implementation
> Plan file (final home after approval): `docs/plans/2026-07-01-full-pdf-ai-reading.md`
> **No GitHub issue created.** Approved for direct implementation; full prompt history is in the Prompt Log.

## User Story

As a beanies.family user reading a multi-page invitation or travel itinerary with the AI reader, I want the app to read all pages (up to a sensible cap), so that details on pages 2+ (a return flight, a second day's schedule, RSVP info printed on the back) are captured — not silently dropped because only page 1 was read.

## Context

Today the AI document readers are image-only, single-image, end-to-end. When a user picks a PDF, the client rasterizes only page 1 (`src/utils/pdfFirstPageToImage.ts` → `doc.getPage(1)`), sends that one image to the extraction path, and the model never sees the rest of the document. This was a deliberate v1 shortcut (#30) because the managed extraction Lambda accepts a single JPEG/PNG.

Two readers are affected, both thin composable "wedges" with an identical PDF-rasterize block:

- Activity/event reader — `src/composables/useDocumentToActivity.ts` (#133)
- Travel reader — `src/composables/useDocumentToTravel.ts` (#30)

Newly worthwhile because on 2026-07-01 the managed model became `gemma4-31b` (confirmed default in `infrastructure/modules/ai-extract/variables.tf`; Tinfoil retired `qwen3-vl-30b`) — multimodal, multi-image — which accepts multiple `image_url` parts in one chat completion, so the model can read every page in one call and return one merged result.

Multi-page rasterization already exists for the in-app viewer (`pdfToPageImages` in `src/utils/pdfRender.ts`, cap 20, per-page `cleanup()` + `doc.destroy()`, `{ …, truncated }` shape). This plan extracts the shared page-render loop and builds both viewer and the new extraction util on it.

## Requirements

1. Reading a PDF with either reader rasterizes and sends up to `MAX_EXTRACT_PAGES` pages (default 5), not just page 1.
2. A single photo/image path is unchanged (the N=1 case of the same array pipeline).
3. The model receives all page images in one call and returns one merged result (travel already returns a segment array; multi-page yields more segments).
4. Over-cap PDFs drop extra pages loudly: an info toast says only the first pages were read and the full document is still attached — never silent. The full original file stays attached exactly as today.
5. Payload stays within AWS limits (Lambda synchronous invocation body ≤ 6 MB): bounded by page cap + per-page render size, with a hard server 413 backstop whose guard sits **below** the 6 MB Lambda ceiling so the classified 413 fires before the platform's opaque rejection.
6. Backward compatibility: an older cached client sending a single `imageDataUrl` still works against the updated Lambda (dual-accept). A new client must not ship before the updated Lambda is deployed.
7. All three prompt copies (client `extractionPrompt.ts`, Lambda `extractionPrompt.mjs`, spike `scripts/spikes/extractionPrompt.mjs`) stay in lockstep (drift test), with `PROMPT_VERSION` bumped.
8. No path fails silently: rasterization, compression, oversized-payload, per-page render failures are caught, classified into a stable `ExtractionErrorCode`, surfaced to the user (toast), and logged with dev guidance (console).
9. Applies to managed (Tinfoil) + BYOK (OpenAI-compatible) tiers. On-device is unaffected — the same `not_available` seam that rejects locally so nothing ever leaves the device (behaviour identical to today).

## Important Notes & Caveats

- **Deploy ordering is load-bearing.** The Lambda ships via manual `terraform apply` (no infra CI; `deploy.yml` is web-only, `workflow_dispatch`). The updated Lambda must be dual-accept and deployed **before** the client ships, or a new client hits an old Lambda that rejects the array (400). Sequence: (1) land + `terraform apply` the Lambda, (2) then ship the web client.
- **AWS 6 MB Lambda ceiling — set the in-handler guard BELOW it.** `MAX_BODY_BYTES` moves 2 MB → **5 MB** (NOT 6 MB). The transport is API Gateway HTTP API (v2) → synchronous Lambda proxy (`aws_apigatewayv2_integration`, `payload_format_version = "2.0"`), so the binding limit is Lambda's 6 MB synchronous-invocation payload. If the guard is set at exactly 6 MB, the platform rejects the invoke before our handler runs and the client gets an opaque platform error instead of our clean classified 413 — defeating the backstop. 5 MB leaves ~1 MB headroom so OUR 413 always wins, while still comfortably accepting the expected ~1.5–2.5 MB 5-page payloads.
- Real protection is page cap (5) + per-page render at 1600px, keeping a 5-page payload ~1.5–2.5 MB base64. The 5 MB guard is the backstop, not the primary defence.
- **Latency ceiling.** ~29 s (`timeout = 29`; `UPSTREAM_TIMEOUT_MS = 25_000`). More images = slower call. If 5-page calls approach the ceiling, lower the cap rather than raise the timeout.
- **OCR fidelity vs payload.** 1600px multi-page (vs 2048px page-1) is a deliberate trade; 1600px suffices for OCR. The 413 backstop, not a size assumption, guarantees we never exceed the limit.
- **Two caps by design.** Client `MAX_EXTRACT_PAGES = 5` (product decision) and Lambda `MAX_IMAGES = 8` (looser defense-in-depth) are intentionally decoupled; do not "reconcile" them. Each carries a one-line comment.
- **Pre-existing double-encode accepted (and often a no-op).** Rendered pages are JPEGs; the service's `compress()` re-encodes them — but `compress()` short-circuits and returns the rendered blob untouched when it is already a JPEG ≤256 KB within the dimension cap (`SMALL_BYTES_THRESHOLD`), and never upscales (render 1600px ≤ compress cap 2048px). Already true on today's single-page path, harmless. Do NOT add a PDF-specific skip-compression branch — the uniform pipeline is simpler and self-optimizing.
- On-device is a no-op for this change (see requirement 9).
- Do NOT do per-page separate calls + merge, or a stitched tall-image. Design is multi-image, single call.
- Travel reader already attaches the original PDF (`sourceFile: file`); activity builds its thumbnail from `result.compressedBlob`. Keep the activity thumbnail as page 1's compressed blob, so `onActivityReady` is unchanged.

## Assumptions

> Review these before implementation.

1. `gemma4-31b` accepts multiple `image_url` parts in one call and reads them as pages of one document. Confirm with a real 2-page test.
2. A 5-page PDF at 1600px/JPEG q0.85 stays under 5 MB. The 413 backstop protects the pathological case.
3. BYOK default (`gpt-4o`) accepts multiple images (it does).
4. No caller depends on `pdfFirstPageToImage` returning a single `File` other than the two composables + tests.
5. The manual `terraform apply` will be run by greg as an explicit, separate step — this plan does not auto-deploy.

## Approach

Multi-image, single extraction call. Rasterize up to `MAX_EXTRACT_PAGES` pages → compress each → send an array of data URLs → one model call attaches one `image_url` part per page → one merged result. Centralize PDF-vs-image preparation in the service layer (removing the duplicated rasterize block from both composables); composables pass the original `File`, the service owns "prepare → compress → send".

### 1. Shared page-render loop

- In `src/utils/pdfRender.ts`, extract the page loop `pdfToPageImages` already contains into: `export async function renderPdfPages(data: ArrayBuffer, opts: { longEdge: number; maxPages: number }): Promise<{ blobs: Blob[]; truncated: boolean }>`. Loads doc, loops `1..min(numPages, maxPages)`, renders via existing `renderPdfPageToBlob(page, longEdge)`, `page.cleanup()` per-page finally, `doc.destroy()` outer finally. `truncated = doc.numPages > count`. No `totalPages` (unused surface).
- Refactor `pdfToPageImages` to call `renderPdfPages(data, { longEdge: VIEW_LONG_EDGE, maxPages: MAX_VIEW_PAGES })` and map `blobs` → object URLs. Behaviour identical.
- Don't share `VIEW_LONG_EDGE` between viewer and extraction — independent concerns that share a value. Share the loop, not the constant.

### 2. Extraction images util

- Rename `src/utils/pdfFirstPageToImage.ts` → `src/utils/pdfExtractionImages.ts`. Keep `isPdfFile()` here.
- Replace `pdfFirstPageToImage` with `MAX_EXTRACT_PAGES = 5`, `EXTRACT_LONG_EDGE = 1600`, `pdfToExtractionImages(file: File): Promise<{ files: File[]; truncated: boolean }>` that calls `renderPdfPages(await file.arrayBuffer(), { longEdge: EXTRACT_LONG_EDGE, maxPages: MAX_EXTRACT_PAGES })` and wraps each blob into a `File` (`<baseName>-p{n}.jpg`, `image/jpeg`).
- Keep pdfjs code-split: this module must not statically import `pdfjs-dist`; pdfjs is reached only via `renderPdfPages` → `loadPdfjs()`'s dynamic import. The service statically imports this util (§4), so `isPdfFile` + `pdfToExtractionImages` stay tiny.

### 3. Types

- `ExtractionRequest`: `imageDataUrl: string` → `imageDataUrls: string[]` (≥1). Add optional `truncated?: boolean` to `DocumentExtractionResult<T>` (envelope metadata only — never folded into `data`, consistent with the `compressedBlob` invariant).

### 4. Client service

- New private helper so `runExtraction` stays flat: `async function prepareImageDataUrls(file, opts): Promise<{ imageDataUrls: string[]; compressedBlob: Blob; truncated: boolean }>` — (a) resolve source images (`isPdfFile` → `pdfToExtractionImages`, else `{ files: [file], truncated: false }`), (b) run each through existing `compress()` + `blobToDataUrl()`, (c) return page 1's `compressedBlob` + array + `truncated`. Throws `CompressionError` on failure so the existing single catch classifies `'compression'`. Compress pages sequentially (canvas work is main-thread; sequential bounds peak memory and is simpler than `Promise.all`).
- `runExtraction`: replace the single-image compress block with one `prepareImageDataUrls(...)` call in the existing try/catch; on failure `console.error` with dev guidance + `{ success:false, errorCode:'compression' }`. Build `ExtractionRequest = { imageDataUrls, todayIso, signal, task }`; thread `truncated` into the result. Keeps the flat 3-step shape (prepare → dispatch provider → run+classify). The prepare-then-dispatch order is unchanged from today (a valid image is prepared before the tier's availability is known); pre-existing and acceptable — no provider ever receives the family dataset, and on-device rejects locally without sending anything (§9).
- Public entries unchanged (take the original `File`).

### 5. Composables

- Both: delete the `isPdfFile` + `pdfFirstPageToImage` block + import; pass original `file` to the extraction call. PDF concern now lives in one place (the service).
- **Truncation notice placement** (explicit, so it is neither silent nor a confusing double-signal): show the info toast (`ai.pdfTruncated.title` / `.message`, number-free) as the **first statement inside the `if (result.success && result.data)` success block**, i.e. BEFORE the not-event / not-travel branch. This guarantees a >cap PDF whose recognisable content sits beyond the cap still tells the user pages were dropped, even when the recognised result is empty and the travel path early-`return`s on `!isTravel`. When both fire (truncated AND not-recognised) the two toasts carry distinct, complementary information and stacking is acceptable for this rare edge.

### 6. Prompt builders (all three copies + drift test)

- `buildExtractionMessages` / `buildTravelExtractionMessages`: `(imageDataUrl, todayIso)` → `(imageDataUrls: string[], todayIso)`; spread `imageDataUrls.map(url => ({ type:'image_url', image_url:{ url } }))` into the user content after the text part. Reword prompts for 1..N images ("one or more images of the same document, in page order"). Apply identically to client `.ts`, Lambda `.mjs`, spike `.mjs`. Bump `PROMPT_VERSION` `'2026-06-14.1'` → `'2026-07-01.1'`. Update `extractionPromptDrift.test.ts` to pass an array.

### 7. Providers

- `managedProvider.ts` `postToProxy`: send `{ imageDataUrls, todayIso, task }`.
- `openaiCompatible.ts` (BYOK): pass `request.imageDataUrls` into the builders.
- `byokProvider.ts` / `onDeviceProvider.ts`: no change.

### 8. Lambda

- Accept both shapes: `imageDataUrls` if present, else `[imageDataUrl]`. Validate: non-empty; length ≤ `MAX_IMAGES = 8` else 400; every element matches `ALLOWED_DATA_URL` else 400. Move `MAX_BODY_BYTES` 2 MB → **5 MB** (deliberately below the 6 MB Lambda synchronous-invocation ceiling — see caveat). `taskConfig.buildMessages(imageDataUrls, todayDate)`. `MAX_IMAGES` comment notes it's an intentionally-looser backstop than the client's 5. Update the `MAX_BODY_BYTES` comment to state the 5 MB / 6 MB reasoning.
- While editing this file, align the stale in-file fallback model default: `TINFOIL_MODEL || 'qwen3-vl-30b'` → `'gemma4-31b'` (line 28). `qwen3-vl-30b` is retired; if the env var were ever unset, extraction would 503. Prod sets the env var (and `variables.tf` already defaults to `gemma4-31b`); this only realigns the last stale reference.
- Deploy via manual `terraform apply`.

## Files Affected

- `src/utils/pdfRender.ts` (shared `renderPdfPages`; refactor `pdfToPageImages`)
- `src/utils/pdfFirstPageToImage.ts` → rename `src/utils/pdfExtractionImages.ts`
- `src/services/ai/types.ts`, `documentExtractionService.ts` (new `prepareImageDataUrls`), `extractionPrompt.ts`, `providers/managedProvider.ts`, `providers/openaiCompatible.ts`
- `src/composables/useDocumentToActivity.ts`, `useDocumentToTravel.ts`
- `src/services/translation/uiStrings.ts` (`ai.pdfTruncated.title` + `.message`, en+beanie)
- `infrastructure/lambda/ai-extract/index.mjs` (dual-accept, `MAX_BODY_BYTES` 2→5 MB, stale-model-default alignment), `extractionPrompt.mjs`, `scripts/spikes/extractionPrompt.mjs`
- Tests: new `pdfExtractionImages.test.ts`; update pdfRender tests, `documentExtractionService.test.ts`, `useDocumentToActivity.test.ts`, `useDocumentToTravel.test.ts`, `extractionPromptDrift.test.ts`, `handler.test.mjs`
- No change to `onDeviceProvider.ts` / `byokProvider.ts`

## Help Center Coverage

- **Action**: update existing (verify article in `src/content/help/`; the AI reader article)
- **Category**: `features`; **Type**: `how-to`/`explainer`
- **Scope**: PDF reading now captures the first several pages (not just the first); very long PDFs read the first few with the full file still attached; a photo still reads as one image. User-POV framing.
- **Notes**: State plainly that only the first several pages are read and the full original is always kept. Written per `.claude/skills/beanies-help-docs/SKILL.md`, landing in the same change.

## Acceptance Criteria

- [ ] 3-page PDF via activity reader captures pages 2–3.
- [ ] Multi-page travel itinerary produces later-page segments.
- [ ] Single photo unchanged (N=1).
- [ ] Over-cap PDF reads first `MAX_EXTRACT_PAGES` + truncation toast; full original attached. Truncation toast still fires when the recognised result is empty (not silent).
- [ ] Legacy single-`imageDataUrl` request still succeeds against the updated Lambda.
- [ ] `renderPdfPages` used by both viewer + extraction util — no duplicated loop; returns `{ blobs, truncated }`.
- [ ] `runExtraction` keeps its flat 3-step shape; image prep behind `prepareImageDataUrls`.
- [ ] pdf.js stays code-split: `pdfExtractionImages.ts` has no static `pdfjs-dist` import; main-bundle size unchanged.
- [ ] 5-page payload < 5 MB; an oversized body (>5 MB) returns OUR clean classified 413, below the 6 MB platform ceiling.
- [ ] Rasterize/compress/oversized/render failures → informative toast + console dev guidance.
- [ ] `extractionPromptDrift.test.ts` passes; `PROMPT_VERSION` bumped.
- [ ] Managed + BYOK send multiple images; on-device unchanged.
- [ ] Help Center article updated.
- [ ] Full unit suite green; handler tests cover array + legacy single-image.

## Testing Plan

1. **Unit — pdfRender**: `renderPdfPages` renders `min(numPages,maxPages)` blobs, sets `truncated`, cleanup per page + destroy; `pdfToPageImages` regression.
2. **Unit — extraction util**: `pdfToExtractionImages` count + `truncated`; non-PDF passthrough; assert no top-level pdfjs import.
3. **Unit — service**: `prepareImageDataUrls` produces N data URLs, returns page-1 `compressedBlob`, `truncated` threaded; prepare failure → `'compression'` + console.error; N-image request reaches the provider as `imageDataUrls[]`.
4. **Unit — composables**: pass original file; truncation toast fires as the first success-block signal (including the not-event / not-travel-with-truncation case).
5. **Unit — prompt drift**: three copies identical; `PROMPT_VERSION` bumped; one `image_url` part per page.
6. **Unit — Lambda handler**: accepts array (happy + attestation), legacy single, rejects empty / >`MAX_IMAGES` / non-image (400), returns clean 413 for a body over `MAX_BODY_BYTES` (5 MB).
7. **Manual end-to-end** (after `terraform apply`): real 2–3 page invitation + 2-page itinerary through both readers; later-page data captured; truncation toast on >5-page PDF.

## Review Passes

- **Pass 1 (Initial draft)**: multi-image single-call design; reuse pdfRender; centralize prepare-images; array-ify prompts + drift; dual-accept Lambda; cap 5 at 1600px; loud truncation; deploy/AWS caveats; both readers; Help Center.
- **Pass 2 (DRY + error handling)**: Extracted shared `renderPdfPages`; dropped false `VIEW_LONG_EDGE` coupling; removed on-device dead work after verifying that provider ignores the request; dropped unused `totalPages`; number-free truncation copy; moved dev-guidance console.error into the service catch; framed the 413 as the hard backstop.
- **Pass 3 (Sustainability)**: Fixed `renderPdfPages` signature (dropped `totalPages`); added named `prepareImageDataUrls` helper to keep `runExtraction` flat; documented pdf.js code-split preservation, the two intentionally-decoupled caps, and the accepted render-then-compress double-encode.
- **Pass 4 (Fresh-eyes sweep)**: Set the Lambda body guard to **5 MB** (not 6 MB, which sits at the platform ceiling and would kill the clean-413 backstop); pinned the truncation toast to the first success-block statement so over-cap PDFs are never silent and the travel early-`return` can't skip it; aligned the stale `index.mjs` fallback model (`qwen3-vl-30b` → `gemma4-31b`); sharpened the double-encode caveat (often a no-op via `compress()`'s small-JPEG short-circuit); corrected the on-device "never processes images" wording.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt

"Related to reading documents for AI processing - do we still have a limitation where we can only read the first page of a PDF? Can we enhance that capability now so that a full PDF can be read?"

### Follow-up 1 (kickoff via /beanies-plan)

"yes kick off a plan for this. i am ok with a reasonable page cap and reasonable limits for the other items. let's do this for both readers (activity + travel)"

</details>
