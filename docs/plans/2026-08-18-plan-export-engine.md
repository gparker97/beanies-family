# Plan: One-page export engine — render family plans to a shareable, on-brand PDF + image

> Date: 2026-08-18
> Related issues: #67 (Notion tracker) — first consumers #27 (meal planner) + #66 (weekly agenda)
> Plan file: `docs/plans/2026-08-18-plan-export-engine.md`
> Mockup: `docs/mockups/meal-plan-share-grid-2026-08-18.html`

## User Story

As a family organiser, I want to export or share my week's plan as a polished one-page PDF or image, so I can print it for the fridge or send it to the family in a chat — not just a wall of text.

## Context

The meal planner (#27) shipped with a **text-only** share (`useShareText` + `formatMealPlanShare`, surfaced in the share `BaseModal` on `MealPlannerPage.vue`). The upcoming weekly agenda (#66) will need the same "put the week on the fridge / drop it in the chat" capability across meals + activities + todos + meds + key info.

Rather than build a bespoke exporter twice, build **one reusable client-side export engine** that turns a structured plan into a branded one-page artifact — as **both** a PNG image (chat/WhatsApp/share sheet) and a PDF (print) — from a single rendered layout, so #27 uses it now and #66 reuses it later by swapping only the body.

The design is finalised in `docs/mockups/meal-plan-share-grid-2026-08-18.html` (the "at-a-glance grid"): a soft Heritage-Orange→Terracotta header with the week's dates as the anchor, a days-across / slots-down grid, per-cell meal name + cook + serve time + guests, multi-dish cells, and a brand footer. It is a **static print artifact** — deliberately no live indicators (no "today" highlight, no cooked ticks).

## Requirements

1. A **reusable render layer**: a structured plan → a branded one-page artifact via a **header / body / footer shell**, where the body is swappable (meal grid now; #66 agenda later).
2. Produce **both** outputs from one layout source: a **PNG image** and a **PDF** (single landscape A4 page).
3. Render the **at-a-glance grid** faithfully to the mockup: days across, four slot rows down, per-cell meal name + cook (initial chip + name) + serve time + guests, multi-dish cells stacked with a hairline divider, empty cells as a faint dash; soft gradient header with a hugging beanie mark + "week of <dates>"; brand footer with the Pod + wordmark + tagline.
4. **Static** output — no live/stateful indicators (no "today" column, no cooked ✓).
5. Present the options **inside the share modal** as a small "how do you want to send it?" chooser, not standalone buttons: **Send to a chat / email** (hands the optimized **image** to the native OS share sheet — WhatsApp, Messages, Mail, AirDrop, etc. appear automatically), **Export as PDF** (downloads the print-ready **PDF**), plus the existing **Copy as text**. Format is chosen per action automatically (image for the share-to-apps path, PDF for export); the text path is never regressed.
6. Deliver via the **platform-appropriate path**: `navigator.canShare({ files })` true → native share sheet with the file; otherwise → download. Reuse a single file-delivery helper for both PNG and PDF. **Do NOT build per-app buttons (WhatsApp/SMS/Email) that attach a file** — the web/PWA cannot: `whatsapp:`/`sms:`/`mailto:` carry text only, so the OS share sheet is the sole mechanism that hands the image to a specific chat/email app. (Text-only app quick-links were considered and declined — greg, this session.)
7. **On-brand** output sourced from the CIG (Heritage Orange/Terracotta, Outfit/Inter/Caveat, Cloud White, squircle, the beanies mark) — never the mockup's raw hex where a CIG token exists.
8. **i18n**: every visible string in the export goes through `t()` (labels, "week of", slot names, cooks legend), so a non-English family gets a translated sheet.
9. Works across web, PWA, iOS, Android (all client-side; no plan data leaves the device).

## Important Notes & Caveats

- **Client-side only.** No plan data may be POSTed anywhere — this is a privacy guarantee (the whole app is local-first/E2E-encrypted). The render + rasterize + PDF wrap all happen in-browser.
- **The mockup's raw values are design intent, not tokens.** Reproduce its layout/hierarchy/spacing rhythm, but every color, font, radius, shadow comes from the beanies theme + CIG. The hugging-beanie header mark in the mockup is a CSS stand-in; in-app, use the real brand asset (`public/brand/beanies_family_icon_transparent_384x384.png`) or the existing Pod, per the theme skill.
- **v1 is text + emoji only — no recipe photos** (explicitly out of scope; keeps files small and layout simple).
- **The export is week-scoped.** The at-a-glance grid is a whole week; the existing text share keeps its day/week scope, but the image/PDF export renders the week grid. Do not try to force a "day" grid export in v1.
- **Fonts + emoji must be present at capture time** — the single biggest failure mode is a rasterize that runs before web fonts load (FOUT → wrong font baked into the image) or an emoji that the capture library drops. Gate the capture on `document.fonts.ready` **and, first, explicitly `await document.fonts.load(...)` for each family/weight the sheet uses (notably Caveat for the tagline, which nothing else on the meal-planner page loads)** — because `nextTick` flushes Vue's DOM patch but does NOT force the layout that triggers a _lazy_ font fetch, so `document.fonts.ready` can otherwise resolve with nothing pending and still bake a FOUT. Embed fonts in the capture; treat this as a first-class correctness concern, not polish.
- **One page, always.** A very full week must scale to fit a single landscape A4 — never spill to page 2 or clip. Render at a fixed logical canvas size and scale-to-fit.
- **Do NOT re-implement the grid layout twice.** The on-screen `MealWeekBoard` is interactive (drag/drop, add affordances, scroll); the export is a static print sheet. They are different artifacts and should NOT share a component — but they SHOULD share the underlying data selectors (`mealPlanStore.mealsForWeek`, `mealDisplayName(meal, recipes, t)`, `familyStore` cook lookups) so the content can never drift.

## Assumptions

> **Review before implementation.** — all verified against the codebase this pass; results inlined below.

1. **VERIFIED — no existing image/PDF _generation_.** `package.json` has no `html-to-image`/`jspdf`/`html2canvas`. `pdfjs-dist` IS present but only _reads/renders_ PDFs (`src/utils/pdfRender.ts` — AI extraction + in-app viewing); it cannot author a PDF, so `jspdf` is still required. No `canShare`/`navigator.share({files})`/blob-download-anchor helper exists anywhere in `src/` (only `useShareText` shares plain text). So both the file-delivery helper and the engine are genuinely new.
2. **VERIFIED —** `useShareText().share(title, text): Promise<boolean>` handles the **text** path (native `navigator.share({title,text})`, clipboard fallback, `AbortError`→`false` cancel-aware). A **file** share is a different call (`navigator.canShare?.({files})` gate → `navigator.share({files,title})`) and needs the new helper.
3. Two new client dependencies: a DOM-rasteriser (**`html-to-image`** — better font/emoji handling than `html2canvas`) and a PDF writer (**`jspdf`**). Both lazy-loaded via a **module-level memoised dynamic import**, mirroring the established `loadPdfjs()` pattern in `src/utils/pdfRender.ts`, so they stay code-split out of the entry bundle. (Zero-dep fallback = SVG-`foreignObject`→canvas + a hand-written PDF wrapper, but that is more fragile with fonts — rejected as bloat/risk.)
4. **VERIFIED —** the meal-plan model is sufficient: `mealPlanStore.mealsForWeek(weekDates: string[]): MealPlanEntry[]`, `mealDisplayName(meal, recipes, t)`, and cook = `familyStore.members[].{ name, color }` (both fields confirmed present) render every cell.
5. `settingsStore.weekStartDay` + `useWeekNavigation` define the week; the export uses the **currently-viewed** week from `MealPlannerPage`.

## Approach

### Architecture (MVO-aligned, DRY, reusable shell)

**One layout source → two outputs.** Render the sheet once as an off-screen DOM node, rasterise it to a PNG, and (for PDF) embed that same PNG into a single landscape-A4 `jspdf` page. This guarantees the image and the PDF are pixel-identical and there is exactly one layout to maintain.

**Components (View):**

- `src/components/export/ExportSheet.vue` — the **reusable shell**: the Cloud-White "paper" at a fixed logical size (landscape A4 ratio), the soft gradient header (title + "week of <dates>" + hugging beanie mark), and the brand footer (Pod + wordmark + tagline). Body is a **`<slot>`**. This is the piece #66 reuses unchanged. Props: `{ title, dateRange, subtitle? }`. All strings passed in already-resolved via `t()` by the caller (keeps the component i18n-agnostic and pure).
- `src/components/export/MealPlanExportBody.vue` — the **meal grid body** (slotted into `ExportSheet`): the days-across / slots-down table. Pure/presentational; takes a **pre-built row view-model as a prop** (see the shared resolver builder below), so it holds no store/i18n coupling of its own. #66 will add its own `AgendaExportBody.vue` later against the same slot contract.

Cell rendering (name + cook chip + meta; multi-dish stack) stays **inline in `MealPlanExportBody`** by default — a static cell is a few elements. Only extract a `MealExportCell.vue` if the multi-dish stacking logic actually grows non-trivial; do not pre-split it (avoid premature decomposition and an extra always-in-sync contract for no readability gain).

**Shared meal-resolver builder (DRY — one name source for text _and_ grid):** the text share already injects its name/cook/label lookups through `MealShareContext` (`mealName`/`cookName`/`slotLabel`/`dayLabel`) in `src/utils/formatMealPlanShare.ts`. Promote that injected-resolver shape to the single shared shape both surfaces consume, and add a pure `buildMealExportRows(meals, resolvers)` in `src/utils/mealExportModel.ts` that turns the week's meals into the grid view-model (rows = slots, cols = days, cells = resolved name/cook/time/guests). Then:

- the **text share** keeps calling `formatMealPlanShare(meals, ctx)`,
- the **grid export** calls `buildMealExportRows(meals, ctx)` and passes the result to `MealPlanExportBody`,
- both are fed by the **same resolver object** the View builds once (`mealName` = `mealDisplayName(meal, recipes.value, t)`, `cookName` = `familyStore` lookup), so a meal is named/attributed identically in every surface and can never drift. `MealPlanExportBody` stays a dumb renderer of the built rows.

These components are **render-only** (off-screen), never mounted in the normal page tree. They intentionally do NOT reuse `MealWeekBoard`/`MealSlotCell`/`MealCard` (those are interactive, scrollable, stateful).

**Engine (Orchestrator — a composable, not a store):**

- `src/composables/useSheetExport.ts` — the reusable export engine, plan-shape-agnostic:
  - `exportElementToPng(el, opts): Promise<Blob>` — first `await Promise.all(sheetFonts.map((f) => document.fonts.load(f)))` for the explicit families/weights the sheet renders (e.g. Caveat) so a lazily-triggered face is actually in-flight, THEN `await document.fonts.ready`, lazy-load `html-to-image` (memoised promise), capture at 2× `pixelRatio` for crispness with font-embed enabled, return a PNG blob.
  - `pngBlobToPdf(pngBlob, opts): Promise<Blob>` — lazy-load `jspdf` (memoised promise), create one landscape A4 page, place the PNG scaled-to-fit, return a PDF blob.
  - **Single source for the failure taxonomy:** export the `ExportStage` union (`'render' | 'rasterize' | 'pdf' | 'deliver'`) and the typed `ExportError` **from this module**, and have the View and the delivery helper import them. The engine only ever throws the stages it owns (`'rasterize'`/`'pdf'`); the View supplies `'render'`/`'deliver'`. One definition, no drifting string literals sprinkled across files.
  - **Error contract (no bare catch, no double-report):** each stage runs inside a `try/catch` that rethrows a typed `ExportError` carrying its `stage` — it does **not** toast or report itself; it lets the error propagate to the single View-level handler so there is exactly one report per failure (see Observability). Lazy-import failure is caught the same way (`stage:'rasterize'`/`'pdf'`).
- `src/utils/shareOrDownloadFile.ts` — the single delivery helper (DRY, used for PNG and PDF and any future file export): given a `Blob` + filename + mime, `if (navigator.canShare?.({ files: [file] }))` → `navigator.share({ files, title })`; else create an object URL + programmatic `<a download>` + revoke. Returns a discriminated result `{ outcome: 'shared' | 'downloaded' | 'cancelled' | 'failed' }` (mirrors `useShareText`'s cancel-aware pattern — `AbortError` = `cancelled`, not `failed`; a real throw = `failed`). It classifies but does **not** toast/report — the View maps the outcome to telemetry + toast, keeping delivery pure and testable.

**Trigger (View wiring — declarative, not an imperative mount):**

- Extend the existing share `BaseModal` in `MealPlannerPage.vue` into a **"how do you want to send it?" chooser**. Keep the current **text** share (day/week `TogglePillGroup` + preview → "Copy as text"). Add two more actions for the week sheet: **Send to a chat / email** (builds the optimized image → `shareOrDownloadFile` → OS share sheet, where WhatsApp/Messages/Mail appear) and **Export as PDF** (builds the PDF → `shareOrDownloadFile`, which downloads it on file-share-less platforms and offers it to the sheet where supported). Each action maps to exactly one format — no format toggle for the user to think about. There are deliberately **no per-app (WhatsApp/SMS/Email) buttons** — the OS sheet supplies those targets (a file can't be attached via app URL schemes; see Requirement 6).
- **Render the sheet declaratively in the page template**, not via `createApp`/manual `render()`. There is no imperative Vue-mount pattern anywhere in `src/` today, and hand-mounting a second app root would re-wire Pinia, i18n, and the theme provider by hand — a fragile, easy-to-drift seam. Instead, keep `ExportSheet` (+ `MealPlanExportBody`) in `MealPlannerPage`'s template behind a `v-if="exportMounting"` ref, wrapped in an **off-screen host** (`position: fixed; left: -99999px; top: 0; aria-hidden="true"`, mirroring the existing off-screen pattern in `useFilePicker.ts`). Because it lives in the normal tree it inherits store/i18n/theme context automatically — nothing to re-provide.
- Both actions run one `async` handler:
  1. Build the resolver object + `buildMealExportRows(mealsForWeek(weekDates), resolvers)`, set the row view-model + `exportMounting = true`.
  2. `await nextTick()` so the off-screen sheet is in the DOM, grab it via a template `ref`, then `exportElementToPng` (→ `pngBlobToPdf` for PDF). Fonts-ready is gated inside the engine.
  3. `shareOrDownloadFile(blob, ``beanies-meal-plan-<weekStart>.png|pdf``, mime)`.
  4. `finally`: `exportMounting = false` (Vue unmounts the off-screen node, so a thrown error can never leak the host). Map the result → telemetry + toast (Observability).

Filename uses the week-start ISO date so multiple exports don't collide (build it once via a tiny local helper so the `.png`/`.pdf` paths can't diverge).

### Why not print-CSS / html2canvas / manual canvas

- **`window.print()`** → PDF only, no image, wildly inconsistent across iOS/Android/desktop, and can't be handed to the share sheet as a file. Rejected.
- **`html2canvas`** → weaker web-font + emoji handling than `html-to-image` (which serialises to SVG `foreignObject` and embeds fonts). Rejected in favour of `html-to-image`.
- **Hand-drawn canvas** → duplicates the entire layout in imperative code, cannot reuse the shell for #66, brittle. Rejected.
- **Imperative Vue mount (`createApp`/`render`) for the off-screen sheet** → re-wires Pinia/i18n/theme by hand and adds a lifecycle to leak. Rejected in favour of the declarative `v-if` off-screen host above.

## Files Affected

**New:**

- `src/components/export/ExportSheet.vue` — reusable header/body(slot)/footer paper shell.
- `src/components/export/MealPlanExportBody.vue` — the meal-grid body (renders a pre-built row view-model; cell markup inline unless multi-dish logic grows).
- `src/utils/mealExportModel.ts` — pure `buildMealExportRows(meals, resolvers)` + the shared resolver interface (promoted from `MealShareContext`), so text-share and grid-export share one name/cook source.
- `src/composables/useSheetExport.ts` — the export engine (PNG + PDF, memoised lazy deps, exported `ExportStage` union + typed `ExportError`).
- `src/utils/shareOrDownloadFile.ts` — the file delivery helper (share-or-download, discriminated outcome).
- `src/composables/__tests__/useSheetExport.test.ts` — unit tests (mock the lazy libs; assert fonts-ready gate, `stage` on thrown `ExportError`, PDF wrap called with landscape A4).
- `src/utils/__tests__/shareOrDownloadFile.test.ts` — unit tests (canShare→share; no canShare→download; `AbortError`→`cancelled`; other throw→`failed`).
- `src/utils/__tests__/mealExportModel.test.ts` — unit tests for `buildMealExportRows` (multi-dish cell, empty cell, cook resolution) — pure, no DOM.

**Modified:**

- `src/pages/MealPlannerPage.vue` — share modal gains the "Export the week" actions + one handler + a declarative off-screen `ExportSheet` host gated by a `v-if` ref (unmounted by flipping the ref in `finally`). Reuses the single resolver object for both the existing text share and the new grid export.
- `src/utils/formatMealPlanShare.ts` — `MealShareContext` becomes (or re-exports) the shared resolver interface now defined in `mealExportModel.ts`; the text formatter is otherwise unchanged (no behaviour change, one shared shape).
- `src/services/translation/uiStrings.ts` — export strings (`mealPlanner.export.*`: the chooser labels `sendToChat`, `exportPdf` (+ the existing text/copy action), `sectionTitle`, `building`, `done`, `failed`, `failedHelp`, plus the sheet's own labels — reuse existing `mealPlanner.slot.*`, `mealPlanner.share.header`, cooks legend where they already exist rather than adding duplicates).
- `src/utils/diagnosticContext.ts` — add two new `ALLOWED_CONTEXT_KEYS`: `format`, `stage`. **`outcome` is NOT added** — it rides the existing `action` key (see Observability), matching the established convention (e.g. the native-biometric surface: "Outcome rides the existing `action` key").
- `infrastructure/lambda/telemetry/index.mjs` — **MIRROR** `format` + `stage` in the Lambda's copy of `ALLOWED_CONTEXT_KEYS` (its pinned drift test fails otherwise). This step is mandatory per the contract documented atop `diagnosticContext.ts`.
- `src/content/help/features.ts` — update the existing "planning-your-familys-meals" article to mention exporting/sharing the week as an image or PDF (Help Center Coverage).
- `docs/runbooks/native-store-submission.md` + store data-collection consumers (`ios/App/App/PrivacyInfo.xcprivacy`, `web/src/pages/privacy.astro`) — declare the new diagnostic context keys (`format`, `stage`) — both low-cardinality PII-free enums (Observability privacy gate).
- `package.json` — add `html-to-image` + `jspdf` (lazy-imported, code-split).

**Design reference (already committed):**

- `docs/mockups/meal-plan-share-grid-2026-08-18.html`.

## Help Center Coverage

- **Action**: `update existing`
- **Category**: `features`
- **Slug**: existing `planning-your-familys-meals`
- **Title**: (unchanged) — add a short section
- **Scope**: Tell the user they can share the week's meal plan as a friendly one-page image (for the family chat) or a PDF (to print for the fridge), in addition to the existing text share, and that it's created on their device — nothing about the plan is uploaded.
- **Notes**: Emphasise the privacy point (rendered locally, never uploaded) and that the image/PDF is the whole week (not a single day).

## Observability Coverage

New greppable surface: **`plan-export`** (reused by #66 later).

- **Events (success/lifecycle → `logEvent`):**
  - `logEvent({ level:'info', surface:'plan-export', message:'export started', context:{ action:'export-start', format } })` — `format` ∈ `image`|`pdf`. Fires on every attempt so an export-attempt rate is measurable.
  - `logEvent({ level:'info', surface:'plan-export', message:'export delivered', context:{ action, format } })` — **outcome rides `action`**: `action` ∈ `export-shared`|`export-downloaded`. Success signal → deliver-rate.
  - `perfTiming.record('plan-export', ms, { format })` — render+rasterize duration (well above the 250 ms floor; a slow/janky export shows up here). Uses `perf_op`/`perf_duration_ms` which are already allowlisted.
  - **Cancel** → `logEvent({ level:'info', surface:'plan-export', ..., context:{ action:'export-cancelled', format } })` — NOT an error (user dismissed the share sheet); no toast.
- **Failure (single call, no double-report):** the View's one `catch` calls
  `showToast('error', t('mealPlanner.export.failed'), t('mealPlanner.export.failedHelp'), { surface:'plan-export', error: err, context:{ format, stage } })`.
  **Why one call:** `showToast('error', …)` **auto-invokes `reportError`** with the passed `surface`/`error`/`context` unless `{ silent:true }` (verified in `src/composables/useToast.ts`). So a separate `reportError` would DOUBLE-report the same failure. The single toast therefore (a) shows the user a friendly, actionable message and (b) ships the technical context (`format`, `stage`, stack) to the telemetry firehose in one shot. Severity is left default (`'error'`) = telemetry + console, **not** `'critical'` — a failed export loses no data and pages nobody (correcting the earlier "error = toast+Slack page" note: only `'critical'` pages `#beanies-errors`; the toast itself is what surfaces to the user).
  `stage` ∈ `render`|`rasterize`|`pdf`|`deliver` — the single `ExportStage` union exported by `useSheetExport.ts`. The engine tags `rasterize`/`pdf` on its typed `ExportError`; `render` = off-screen mount/DOM failure caught in the handler; `deliver` = a `failed` outcome from `shareOrDownloadFile`.
- **Failure modes → diagnosable blind:** which `format` failed and at which `stage` is in `context`, so CloudWatch pinpoints the break without a repro. The fonts-not-ready class shows as repeated `rasterize` failures.
- **Privacy/store gate:** new keys **`format`** + **`stage`** → add to `ALLOWED_CONTEXT_KEYS` (`src/utils/diagnosticContext.ts`), **MIRROR in `infrastructure/lambda/telemetry/index.mjs`** (+ its pinned test), and declare in `docs/runbooks/native-store-submission.md` + `PrivacyInfo.xcprivacy` + `privacy.astro`. Both are low-cardinality enums — no PII, no plan content ever logged. **`outcome` is intentionally not a new key** (rides `action`), keeping the allowlist lean.
- **No silent failure anywhere:** every `catch` in the engine, the delivery helper, and the View classifies + surfaces; no bare/empty catch, no swallowed fallback.

## Acceptance Criteria

- [ ] From the meal planner share modal, "Save as image" produces a PNG of the current week matching the mockup; "Save as PDF" produces a one-page landscape-A4 PDF with the same layout.
- [ ] The share modal presents a **send chooser** ("Send to a chat / email", "Export as PDF", "Copy as text") — no format toggle and no per-app buttons. "Send to a chat / email" hands the optimized image to the OS share sheet where `navigator.canShare({ files })` is true (mobile/PWA + capable desktops), else downloads it; "Export as PDF" downloads the PDF (or offers it to the sheet where supported). The gate is capability-based, not a user-agent sniff. Cancelling the share sheet is a no-op (no error toast).
- [ ] The sheet is **static** — no "today" highlight, no cooked ticks — and renders name + cook + serve time + guests per cell, with multi-dish cells stacked.
- [ ] Output is CIG-true (colors/fonts/radii from the theme, not the mockup's raw hex) and **i18n**-driven (switching to Chinese yields a translated sheet).
- [ ] Fonts + emoji are present in the output (capture gated on `document.fonts.ready`); no FOUT/missing-glyph.
- [ ] A very full week (multiple multi-dish cells) still fits **one page** (scale-to-fit), never clipping or spilling.
- [ ] `ExportSheet.vue` is body-agnostic (slot) so #66 can reuse it; the off-screen sheet is rendered declaratively (no imperative app mount) and no interactive board component was reused, but the same store selectors + one shared resolver object feed both the text share and the grid.
- [ ] Any failure produces exactly ONE report + one friendly toast (no double-report), tagged with `format` + `stage` (the single `ExportStage` union); cancel produces neither.
- [ ] Works on web, PWA, iOS, Android; `html-to-image`/`jspdf` are lazy-loaded (not in the main chunk — verified in the build report).
- [ ] Help Center article updated and matches shipped behavior.
- [ ] Observability implemented and verified (events fire with `surface:'plan-export'` + `format`/`stage`; new keys allowlisted in BOTH `diagnosticContext.ts` and the Lambda mirror).

## Testing Plan

1. **Unit — `shareOrDownloadFile`:** `canShare` true → `navigator.share` called with the file (`outcome:'shared'`); false → object-URL download path (`outcome:'downloaded'`); `AbortError` → `cancelled` (not `failed`); other throw → `failed`.
2. **Unit — `useSheetExport`:** capture calls `document.fonts.load(...)` for the sheet fonts _before_ awaiting `document.fonts.ready`; `html-to-image`/`jspdf` are dynamically imported (mock) and the import is memoised (second call reuses the promise); a rasterize throw surfaces as `ExportError` with `stage:'rasterize'` (and does NOT toast/report itself); PDF path calls jspdf with landscape A4.
3. **Unit — `buildMealExportRows`:** a known week model → the right cells incl. a multi-dish cell and an empty cell; cook resolved via the injected resolver; pure, no DOM.
4. **Component (Vitest + jsdom, shallow):** `ExportSheet` renders header title + dateRange + footer and exposes the body slot; `MealPlanExportBody` renders a pre-built row model to the right cells incl. a multi-dish cell and an empty cell; no "today"/cooked markers present.
5. **Manual (desktop):** export image + PDF for an empty week, a light week, and a packed multi-dish week; confirm one-page fit, correct fonts/emoji, brand colors, and translated output after switching language; force a rasterize failure and confirm exactly one toast + one firehose event with `stage:'rasterize'`.
6. **Manual (mobile/PWA, post-deploy per iOS-testing-is-live-only):** share sheet appears with the file on Android + iOS; cancel is clean (no toast, one `export-cancelled` log); the shared image opens correctly in WhatsApp.
7. **Build:** confirm `html-to-image` + `jspdf` land in lazy chunks, not the entry bundle (`npm run build` + inspect).
8. **Full gate:** `npm run type-check`, `npm run lint`, `npx vitest run` (new tests + the Lambda allowlist drift test green), `npm run build`, `npm run translate` (new zh keys), before push.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the reusable `ExportSheet` shell (slot body) + `MealPlanExportBody`, a lazy-loaded `useSheetExport` engine (html-to-image → jspdf, one layout → PNG+PDF), a shared `shareOrDownloadFile` helper, share-modal wiring, `plan-export` observability, Help Center update, and tests.
- **Pass 2 (DRY + error handling)**: Verified every reuse claim against the codebase and corrected the plan — collapsed the failure path to a SINGLE `showToast('error', …, { surface, error, context })` call (showToast auto-invokes reportError, so the separate reportError was a double-report), fixed the wrong "error = toast+Slack page" claim (only `critical` pages), folded `outcome` into the existing `action` key instead of adding a new allowlist key, added the mandatory Lambda `ALLOWED_CONTEXT_KEYS` mirror + drift test for `format`/`stage`, noted `pdfjs-dist` already exists (reads only — jspdf still needed) and that lazy imports must reuse the memoised `loadPdfjs()` pattern, made the engine/delivery helper pure (classify + rethrow typed `ExportError`, no self-toasting) with the off-screen host unmounted in `finally`, and corrected `mealDisplayName(meal, recipes, t)`'s real signature.
- **Pass 3 (Sustainability)**: Made the off-screen render declarative (a `v-if` off-screen host in the page template, inheriting Pinia/i18n/theme) instead of an imperative `createApp`/`render` mount (no such pattern exists in `src/`; hand-mounting would re-wire context and leak a lifecycle); single-sourced the `ExportStage` union + `ExportError` in `useSheetExport.ts` so the View/helper import one taxonomy and stage strings can't drift; promoted `MealShareContext` into one shared resolver shape feeding a pure `buildMealExportRows` (new `mealExportModel.ts`) so text-share and grid-export name/attribute a meal identically and `MealPlanExportBody` stays a dumb renderer; and kept cell markup inline (no premature `MealExportCell.vue`) unless multi-dish logic grows.
- **Pass 4 (Fresh-eyes sweep)**: Closed the plan's own "biggest failure mode" by requiring an explicit `document.fonts.load(...)` for the sheet's families/weights (esp. Caveat) BEFORE `document.fonts.ready` — since `nextTick` doesn't force the layout that schedules a lazy font fetch, `ready` could resolve with nothing pending and bake a FOUT — with a matching unit-test assertion; and re-based the desktop delivery acceptance criterion on the `canShare({ files })` capability gate (some desktops share) instead of a desktop=download assumption. All other technical claims re-verified against the codebase (showToast auto-reports, `MealShareContext` shape, `mealDisplayName`/`mealsForWeek` signatures, `loadPdfjs` lazy pattern, allowlist) — no further changes; already simple/DRY/robust.

## Prompt Log

> No GitHub issue created (Notion `github issue = SKIP`). Full intake is on Notion #67 (`beanies-plan prompt`).

<details>
<summary>Full prompt history</summary>

### Initial Prompt (assembled by /beanies-pre-plan from Notion #67)

The `=== BEANIES PRE-PLAN ===` block written back to Notion #67 (Objective, User story, UX/mockup, Mockup path + htmlpreview url, Scope, Out-of-scope, Acceptance, Edge cases, Reuse hints, References #27/#66, Open Qs = rendering approach deferred, Notes; GitHub issue: SKIP; Feature gate: NO). Design source: `docs/mockups/meal-plan-share-grid-2026-08-18.html`, iterated to final this session (soft header, prominent week dates, per-cell name/cook/serve-time/guests, multi-dish cells, static — no today/cooked, hugging beanie mark, single-Pod footer).

### Follow-up

"continue to build the plan"

### Follow-up 2

"rather than 'save as image / pdf' i would rather these options are all contained within the share modal/pop-up itself - it could provide a few options after tapping share, i.e. whatsapp, email, sms, or export to pdf (which just downloads the pdf to your device) - the most appropriate / efficient option can be used for each share target automatically (i.e. optimized image for whatsapp, pdf for export to pdf option, etc). does this work or is this already part of the plan?"
→ Clarified the platform constraint (file attachments to WhatsApp/SMS/email are only possible via the OS share sheet; app URL schemes are text-only). Reframed the modal as a **send chooser**: "Send to a chat / email" (image → OS sheet), "Export as PDF" (download), "Copy as text". greg chose **OS share sheet only — no per-app text quick-links**. View-layer reframing only (engine/model/delivery/observability unchanged) → applied as a light edit, passes not re-run.
</details>
