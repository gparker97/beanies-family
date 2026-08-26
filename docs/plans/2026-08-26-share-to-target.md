# Plan: Share to beanies — a mobile share target that feeds magic beans (activity + travel + recipe)

> Date: 2026-08-26
> Related issues: Notion #64 (tracker). None on GitHub — direct implementation.
> Plan file: `docs/plans/2026-08-26-share-to-target.md`

## User Story

As a mobile user, I want to share a screenshot, photo, or PDF (like an invite, a travel booking, or a recipe) from any app directly to beanies, so magic beans reads it and prefills the right item (activity, travel plan, or recipe) for me to confirm — without opening the app and re-uploading it myself.

## Context

Content can only enter beanies one way today: open the app, tap a magic-beans button, pick a file. Every inbound share on every platform is unimplemented — the only inbound plumbing that exists is the OAuth deep link (`appUrlOpen`, `googleAuth.installNativeAuthListener`).

The pipeline behind those buttons is, however, already well seamed. Each of the three readers exposes `processFile`, and they all funnel into `runExtraction(source, opts, task)` → `selectProvider` → a tier provider → `EXTRACTION_PARSERS[task]` → a typed result → an existing review modal. Adding a share target is therefore mostly _plumbing a new entry point into an existing funnel_, not new AI work.

Five facts discovered while planning (verified against the code) shape the whole design:

1. **Images dominate AI cost.** The pipeline sends base64 page images. Any design that classifies in one call and extracts in another sends the same images twice — double cost, double latency.
2. **The ai-extract Lambda rejects unknown tasks.** `index.mjs` resolves `task` against `EXTRACTION_TASKS` via `Object.hasOwn` and 400s otherwise. A new task is a _server_ change that must be deployed before the client that uses it.
3. **The extraction funnel is single-`File`.** `runExtraction(input: File | string)` → `prepareImageDataUrls(file)` rasterizes ONE PDF or compresses ONE image. "Several shared photos = one item" is therefore a real (small) change to `documentExtractionService.ts`, not free.
4. **The per-reader mapping lives INSIDE each wedge's `processFile`.** `extractionToActivityPrefill`, `travelExtractionToSegments` + `resolveTripTarget`, `recipeExtractionToPrefill` are all called after the `extract*` call, inside the composable. So "hand the typed result to the matching review modal" is not a one-liner — either we re-run `processFile` (a SECOND AI call, breaking fact 1) or we split each wedge into `extract → deliver` and reuse `deliver`. This plan does the latter.
5. **The ADR-030 consent gate is enforced per ENTRY POINT, not in the shared path** (verified: `useDocumentConsent` is instantiated in FOUR places — `FamilyPlannerPage.vue`, `TravelPlansPage.vue`, `FamilyCookbookPage.vue` and `components/pod/RecipeFormModal.vue` — and `documentExtractionService.ts`'s own header says "CONSENT is a precondition enforced by the CALLER"). This project has _already been bitten_ by exactly this shape: a new entry point into the AI pipeline shipped without the gate because the gate lived at the old entry point. Adding a fifth entry point without changing that structure would repeat the defect by construction. §2a therefore moves the gate into the shared path and makes an ungated call a **compile error**.

**Everything else already exists and is reused verbatim** (verified): the shared failure→toast mapper (`useExtractionErrorToast`), the accept constant (`AI_PICKER_ACCEPT`), PDF rasterization + the page cap (`pdfExtractionImages`), the cross-page dispatch precedent (`pendingMagic` / `consumePendingMagic` / `useMagicReaderConsumer`), the reader→route→flag registry (`MAGIC_READERS`), and the global modal-host cluster in `App.vue` (`ConfirmModal`, `DoseLogConfirmModal`, `RecurringEditScopeModal`). None of it is re-implemented here.

## Requirements

1. Register beanies as a share target for `image/*` and `application/pdf` on:
   - iOS — a native Share Extension target,
   - Android — `ACTION_SEND` + `ACTION_SEND_MULTIPLE` intent filters,
   - Android installed PWA — a Web Share Target in the manifest.
2. Deliver the shared file(s) into the existing magic-beans ingest seam, reusing compression, PDF rasterization, the tier-dispatched AI call and the review-modal hand-off unchanged.
3. Auto-detect the target across three readers (activity / travel / recipe) and open the matching existing review modal, prefilled. The user confirms or edits before anything is saved — never auto-persist.
4. Treat a multi-file share as ONE item with several pages: one merged extraction, one review modal. Capped at `MAX_EXTRACT_PAGES` (5); exceeding it is reported, never silently dropped.
5. Accept `image/*` and PDF only; message any other shared type clearly.
6. Work on cold start (app launched by the share) and warm (already running).
7. Run the ADR-030 consent gate before any shared document leaves the device — **enforced in the shared extraction path, not at the entry point**, so a sixth entry point cannot skip it.
8. Respect the mixed availability state — feature flag **and** permission: never route to a reader the family has switched off or this member cannot use, and _say so_ rather than dropping the share.
9. Emit structured diagnostics on a `share-target-ingest` surface, success path included.
10. Add ZERO duplicate machinery: consent, error toasts, accept types, flag/permission gating, page routing, PDF handling and the page cap must all be the existing shared units, extended where necessary.
11. Add ZERO new review modals. The three existing review surfaces are the only confirmation UI — a share must never grow a fourth near-duplicate.
12. Treat everything arriving through the share boundary as **untrusted input from an arbitrary third-party app** (§6), because the Android intent filter and the iOS extension are exported to every app on the device.

## Important Notes & Caveats

- **ONE AI call, not two.** A separate "classify" call would re-send the page images. Classification and extraction happen in a single call via a new `share` task whose prompt COMPOSES the three existing exported JSON shapes.
- **The `share` parser DISPATCHES into the three existing parsers.** `parseShareExtractionResult` reads `kind`, then delegates to `parseExtractionResult` / `parseTravelExtractionResult` / `parseRecipeExtractionResult`. There is no fourth field-by-field parser, no fourth set of caps, no fourth confidence coercion.
- **Do not touch the three existing prompts.** `EXTRACTION_JSON_SHAPE`, `TRAVEL_JSON_SHAPE` and `RECIPE_JSON_SHAPE` are byte-identical across three copies (client, Lambda, spike) behind `extractionPromptDrift.test.ts`, with a `PROMPT_VERSION` that must be bumped on any change. The new task _imports and composes_ them; it does not restate them. The drift test iterates `Object.keys(spike.EXTRACTION_TASKS)`, so the spike copy must gain the entry too or the new task is silently untested.
- **Deploy order is load-bearing — and is made non-fatal.** ai-extract must ship the `share` task BEFORE any client that requests it. Today an out-of-order deploy surfaces as `provider_error` → "something went wrong", because the Lambda's unknown-task 400 carries no `code` and `managedProvider` falls through to the status-based branch. Fix in this plan: the Lambda returns `code: 'unknown_task'` and `managedProvider` maps it to the existing `not_available` code, which the existing toast mapper already renders as the friendly "not set up yet" _info_ toast — plus a `console.error` naming the deploy step. No new error code, no new toast, no new string.
- **iOS verification is live-only.** A Share Extension is a separate signed target and cannot be exercised in the simulator against the real app group in the usual way; budget a TestFlight round trip.
- **Existing in-app entry points must not change.** The camera/file pickers keep working exactly as they do; `processFile(file)` keeps its signature and behaviour.
- **`App.vue` is already 2056 lines (1607 of them script).** Its diff is capped at **≤ 4 lines including imports**: one `useShareTargets()` call (plus its import) and one self-contained `<DocumentExtractConsentModal />` in the existing modal cluster (plus its import). No adapter code, no platform branching, no listener bodies, and no `useAiCapability()` wiring in `App.vue` — the modal reads its own state, exactly as `ConfirmModal` does. That accumulation is the failure mode this project has already paid for once.
- **The page cap lives in ONE place.** `MAX_EXTRACT_PAGES` is enforced inside `prepareImageDataUrls` and nowhere else. The orchestrator does not count files — a shared PDF is many pages, so a file count is the wrong unit and a second cap would drift from the first.
- **Provenance on a multi-file share is file 1 only.** `TravelReady.sourceFile` / the activity source photo / the recipe pending source are single-file contracts today. A multi-file share attaches the FIRST file and reads all of them; this is a deliberate scope decision, and the multi-file notice must say so rather than leaving the user to discover it. Do NOT widen the three attachment contracts to arrays in this plan — that is a separate, larger change across three review modals and their persistence paths.
- Do NOT build a queue of N extractions for N files. One item, many pages, by explicit decision.
- Do NOT add a "pick the target" chooser. Detection + confirmation in the review modal is the decided UX.
- Do NOT add a second toast mapper, a second consent gate, a second accept list, a second reader→flag map, a second page cap, or a second cross-page dispatch channel. Each already exists and is named below.

## Assumptions

> **Review these before implementation.** Valid at planning time; may have moved.

1. `MAX_EXTRACT_PAGES` remains 5 and the provider still merges N images into one result.
2. The reader registry stays `MAGIC_READERS` in `useMagicReader.ts` (`photo`→`aiPhotoExtract`, `document`→`aiTravelExtract`, `recipe` ungated by explicit decision).
3. A Capacitor share-intent plugin (e.g. `send-intent`) remains the pragmatic Android bridge; no first-party Capacitor API has landed for `ACTION_SEND`. **Adding it is a new runtime dependency** — check maintenance/last release before committing, and fall back to a ~60-line first-party plugin reading `getIntent()` + `onNewIntent()` in `MainActivity` if it is stale. Either way it is confined behind the `ShareAdapter` interface (§4), so swapping it later touches one file.
4. `capacitor.config.ts` appId stays `family.beanies.app` (the iOS app group name derives from it).
5. The Web Share Target's POST lands on the PWA's own origin (`app.beanies.family`), so the service worker can intercept it.
6. Store review will accept a Share Extension without new privacy declarations, since the data path is the one already declared for magic beans.
7. `vite-plugin-pwa` stays on the default `generateSW` strategy with `registerType: 'prompt'`. The Web Share Target's POST handler is added via `workbox.importScripts`, NOT by switching to `injectManifest` — that switch would rewrite the deliberately-tuned SW update flow (`usePwaUpdater`, no `skipWaiting`/`clientsClaim`).
8. UI strings stay single-sourced in `src/services/translation/uiStrings.ts`, with locales produced by the translation-sync bot — so new strings are one edit, not N.
9. `DocumentExtractConsentModal` has no other consumers than the four found here, so it can absorb its own state (props removed) without a wrapper component. **Re-grep before starting step 1.**

## Approach

### 1. A new `share` extraction task — one call, composed prompt, delegated parser

Add `share` to `ExtractionResultByTask`, returning a discriminated union:

```ts
export type ShareExtractionResult =
  | { kind: 'event'; event: ExtractionResult }
  | { kind: 'travel'; travel: TravelExtractionResult }
  | { kind: 'recipe'; recipe: RecipeExtractionResult }
  | { kind: 'none' };
```

The wire shape is `{ kind, event?, travel?, recipe? }` — the model decides `kind`, then fills only the matching nested object using the SHAPE ALREADY EXPORTED for that task. `requiredKeys: ['kind']`, `sources: ['images']` (images only — the share path never sends free text, and the Lambda's `sources` fence keeps the soft-keyed proxy from becoming a general text endpoint).

`parseShareExtractionResult(raw)` validates `kind` against the four literals and then calls the existing `parseExtractionResult` / `parseTravelExtractionResult` / `parseRecipeExtractionResult` on the nested object; an unknown `kind`, or a `kind` whose payload is missing/unparseable, throws → the funnel classifies it `malformed_output` → the existing toast. `assertNever` closes the switch so a fifth kind is a build error.

`kind: 'none'` is the honest outcome for a document that is none of the three, and drives a "beanies couldn't work out what that was" message rather than a wrong item.

This lands in all four places that must move together: client `extractionPrompt.ts` (task + parser), Lambda `extractionPrompt.mjs` (task only — parsers are deliberately client-only), the spike copy, and `PROMPT_VERSION`.

### 2. One ingest orchestrator, three thin platform adapters

`useSharedDocumentIngest` (new composable, orchestrator layer) owns the whole flow once files exist. Every step below is a call into something that already exists:

1. **Re-entrancy guard.** One module-level `isIngesting`. A second share arriving mid-flight is refused with a toast + `logEvent action: 'busy'` — not the wedges' silent `if (isProcessing) return`, because at the share boundary the user has just left another app and silence reads as "beanies lost it".
2. **Readiness precondition.** A share can arrive at a cold-started app that is signed out, still loading the family, or on an AI tier that is not configured. All `requiresAuth` routes redirect to `/login`, so an ungated ingest would fire an AI call for a family that isn't loaded, or open a review modal on a page the router is about to leave. The orchestrator therefore checks, in order: authenticated + family loaded, then `useAiCapability().isConfigured`. Either failing emits `logEvent action: 'not_ready'` with `context: { detail }` and shows an honest message (`shareTarget.signIn.*` / the existing `ai.notConfigured` path) — never a silent drop, never a half-run.
3. **Filter** to `image/*` + PDF using a new `isAiPickerAcceptedFile(file)` exported from `src/constants/aiDocumentPicker.ts` — the SAME module that owns `AI_PICKER_ACCEPT`, reusing `isPdfFile` from `pdfExtractionImages`. One source of truth for "what beanies can read"; nothing else grows a MIME list. Zero usable files is its own message, never a no-op return. Filtering is on the **resolved file**, not the sender's claimed MIME (§6).
4. **Offline guard** via `reportExtractionFailure('offline')` — the shared mapper's `offline` branch already renders exactly the `ai.offline.*` toast the three wedges hand-roll. No new guard.
5. **Consent** via the `useDocumentConsent` singleton, which now mints the grant token the funnel requires (§2a).
6. **Extract** once, `task: 'share'`, through the existing `documentExtractionService` funnel, which applies the page cap and returns `truncated` (§2 "Multi-file support"). The orchestrator does no capping of its own.
7. **Gate** the detected kind against reader availability via the single `isReaderEnabled(reader)` helper (flag **and** permission, §2b); if unavailable, tell the user (`shareTarget.readerOff.*`) rather than routing into a silent no-op.
8. **Dispatch** the typed payload to the owning page through the existing `pendingMagic` channel (§2b/§2c).

The three platform adapters do nothing but produce `File[]` and call `ingest(files, { platform, coldStart })` — so the interesting logic exists once, and a fourth platform later is an adapter, not a re-implementation.

**Multi-file support in the funnel.** `runExtraction`/`prepareImageDataUrls` are widened from `File` to `File | File[]` (the single-`File` overload stays, so `extractEventFromDocument` and friends are untouched at every existing call site). The array path: walk the inputs in order, rasterizing any PDF among them, **stopping as soon as `MAX_EXTRACT_PAGES` images have been collected** (so N shared files cost at most cap-many rasterize+compress passes, not N), set `truncated` when the cap bites, and keep page 1's compressed blob as the representative thumbnail. The existing per-page compression loop is reused as-is; `compressedBlob`/`truncated` envelope semantics are unchanged.

#### 2a. Consent becomes a singleton AND moves into the shared path

Two changes, in one step, because the second is the reason the first is worth doing.

**(i) Singleton + one global mount.** `useDocumentConsent` is currently instantiated in FOUR places, with `<DocumentExtractConsentModal>` mounted four times (`FamilyPlannerPage`, `TravelPlansPage`, `FamilyCookbookPage`, and `components/pod/RecipeFormModal.vue` — which has two `requestConsent()` call sites of its own, for the document and URL/text recipe paths). A share can start at the app shell, on any route, before any of those exist — so a fifth mount would be a fifth copy.

Convert `useDocumentConsent` to the **module-singleton + globally-mounted-modal** idiom already used by `useConfirm`/`ConfirmModal`: module-level `ref` state, module-level resolver, and `DocumentExtractConsentModal` made **self-contained** — it drops its `open` and `tier` props and reads `consentOpen` from the singleton and `tier` from `useAiCapability()` itself, exactly as `ConfirmModal` reads `useConfirm`. The four consumers then drop their `consentOpen`/`resolveConsent`/`onConsentConfirm` wiring, their `aiTier` plumbing and their modal mount, keeping only `await requestConsent()`. Net: −4 mounts, one mount in `App.vue`, no wrapper component invented, and `App.vue` gains no `useAiCapability` call.

Two implementation traps to honour:

- **Pinia is not active at module import time.** `useDocumentConsent` calls `useSettingsStore()`; in the singleton form it must be called _inside_ `requestConsent`/`onConsentConfirm`, not at module scope, or every import of the module throws at app boot.
- **The modal must render above an open modal.** `RecipeFormModal` requests consent from inside itself, so the global mount must stack over it. `ConfirmModal` is already called from inside modals from the same cluster position in `App.vue`, so the precedent holds — verify visually in step 1, don't assume.

**Concurrency is specified, not left to chance:** a `requestConsent()` while another is already pending returns the SAME in-flight promise (one modal, one resolver, both callers resolved together). Resolvers are never stacked and never dropped. Behaviour otherwise unchanged: `skipDocumentConsentPrompt` short-circuits, a decline resolves "no grant", the persist failure still `reportError`s to `ai-consent` and still resolves in `finally`.

**(ii) The grant becomes a token the funnel demands.** Today consent is a convention documented in a comment ("enforced by the CALLER"). A convention is exactly what failed last time. Make it a type:

```ts
// src/composables/useDocumentConsent.ts
declare const consentBrand: unique symbol;
/** Opaque proof that the ADR-030 per-document consent gate ran. Minted ONLY here. */
export type ConsentGrant = { readonly [consentBrand]: 'document-consent' };
export function requestConsent(): Promise<ConsentGrant | null>; // null === declined
```

`ExtractOptions` in `documentExtractionService.ts` gains a **required** `grant: ConsentGrant`. Because the branded type has no public constructor, no caller — today's four or tomorrow's tenth — can reach the AI pipeline without having awaited `requestConsent()`. It is compile-time, zero-runtime-cost, and adds no UI coupling to the service (the service only carries the token; it never inspects it).

Scope: the type + `ExtractOptions` + the six existing `requestConsent` → `extract*` call sites that are already being edited in this step, plus test fixtures (which mint the token via a single exported test helper, `__testConsentGrant`, kept in the test utils so production code has no back door). The service header comment is rewritten from "enforced by the CALLER" to "enforced by the type system".

This is the single change in the plan that closes the class of defect the project was bitten by, rather than avoiding one instance of it.

#### 2b. `useMagicReader` gains data, not logic

`useMagicReader` already owns exactly the three things the orchestrator needs, in ONE registry (`MAGIC_READERS`): the route per reader, the flag per reader, and an idempotent cold/warm consumer (`consumePendingMagic` + `useMagicReaderConsumer`, wired to both `watch` and `onMounted` — precisely the cold-start race). It stays "doors + gating + dispatch"; no share business logic moves into it.

Three small extensions, all inside that one module:

- `MAGIC_READERS` gains `shareKind: 'event' | 'travel' | 'recipe'`, so kind→reader→route→flag is one lookup in one table. A unit test asserts the mapping is total in both directions (every `ShareKind` has exactly one reader), so a fourth reader cannot half-land.
- The gating predicate is extracted ONCE as a plain, setup-free function `isReaderEnabled(reader: MagicReader): boolean` (permission × optional flag). `gate(reader)` becomes `computed(() => isReaderEnabled(reader))`, so `canReadPhoto`/`canReadDocument`/`canReadRecipe`/`canReadAny` are byte-identical for their existing call sites, and the orchestrator — which runs from a native listener, outside any `setup()` — calls the plain function. Note `usePermissions()` must be resolvable outside `setup()`; if it is not, `isReaderEnabled` takes the already-computed permission boolean as its one argument rather than a second permissions lookup being invented. **No parallel `canRead` record is added**: one question, one answer.
- `pendingMagic` widens from `MagicReader | null` to `{ reader: MagicReader; payload?: SharePayload } | null`, and the consumer handler signature widens to `(payload?: SharePayload) => void`. `openReader()` sets no payload — the existing "open the picker" behaviour is byte-identical, including the `closeQuickAdd` / `closeSheetForNavigation` navigation discipline, which is not touched.

Note that `isReaderEnabled` covers permission as well as flag, so a member without `canEditActivities` sharing into beanies gets the same honest "that reader isn't available" message instead of a dead end. The recipe reader has no flag by design; permission still applies.

#### 2c. The dispatch payload is a discriminated union, not a bag

The payload crossing the `pendingMagic` channel is typed per kind, so a travel result can never be handed to `deliverEvent`:

```ts
// src/types/magicPayload.ts — types only, no imports beyond @/services/ai/types
export interface ResultEnvelope {
  /** The FIRST shared file — the provenance artefact the wedges attach. See the multi-file caveat. */
  sourceFile: File;
  compressedBlob?: Blob;
  truncated?: boolean;
}
export type SharePayload =
  | { kind: 'event'; data: ExtractionResult; env: ResultEnvelope }
  | { kind: 'travel'; data: TravelExtractionResult; env: ResultEnvelope }
  | { kind: 'recipe'; data: RecipeExtractionResult; env: ResultEnvelope };
```

A standalone types module keeps `useMagicReader` ↔ orchestrator free of an import cycle. `sourceFile` is **non-optional** deliberately: `TravelReady.sourceFile` is `File` today, and the share path always has at least one real file, so no existing contract is loosened. The page's consumer narrows on `payload.kind` and closes with `assertNever`, so adding a fourth kind is a build error at every page.

`pendingMagic` now holds a `File`/`Blob`. It is an ephemeral module ref cleared the instant a page reads it (existing `consumePendingMagic` behaviour), so no blob is retained — but the orchestrator must also clear it on the failure paths (`reader_disabled`, a throw after dispatch is prepared) so a declined or dead-ended share cannot pin a file in memory until the next navigation.

#### 2d. Each wedge splits `extract` from `deliver` — so nothing is mapped twice

To honour "exactly one AI call", the page cannot re-run `processFile`. Each wedge composable therefore exposes its existing post-extraction half as a named step, and `processFile` calls it. All three share one signature shape — `(data, env: ResultEnvelope) => void` — so they cannot drift into three dialects:

- `useDocumentToActivity` → `deliverEvent` — the `truncated` notice, the `isEvent` info toast, the compressed-JPEG source photo (which derives its filename from `env.sourceFile.name` — see the sanitisation rule in §6), `extractionToActivityPrefill`, `onActivityReady`.
- `useDocumentToTravel` → `deliverTravel` — the `truncated` notice, the not-travel toast, `travelExtractionToSegments`, `resolveTripTarget`, the `ready` log, `onTravelReady`.
- `useRecipeCapture` → `deliverRecipe` — the `truncated` notice, `recipeExtractionToPrefill`, the not-recipe toast, `handOver`, **and the internal pending-source lifecycle it already owns** (`discardPendingSource()` first, then `pendingSource`/`pendingCompressed` assignment, consumed later by `attachAfterSave`). This one is not a pure move: `deliverRecipe` mutates composable-local state, so the split must carry that state with it or the share path saves a recipe with no attached source. **Because the cookbook page and `RecipeFormModal` each call `useRecipeCapture()` separately, the share path must dispatch to the SAME instance that will later run `attachAfterSave`** — i.e. the cookbook page's consumer, not a fresh instance created by the orchestrator. Verify this explicitly; a fresh instance is a silently-lost source photo and precisely the "documented as working, never worked" failure mode.

This is otherwise a pure extraction of code that exists today; no behaviour changes on the in-app path, and it is covered by the existing wedge tests.

Each page's consumer handler then becomes one narrow-and-delegate: `payload ? capture.deliverX(payload.data, payload.env) : handleAddFromX()`. The pages do NOT learn about the share task, the orchestrator, or platforms — their diff is a handful of lines each.

### 3. Cold start

Handled entirely by the existing consumer (`onMounted` + `watch` on `pendingMagic`) plus one adapter rule: adapters are registered at app-shell setup, _before_ the router's first navigation completes, and each drains any intent already delivered at process start. There is no bespoke pending-share store and no second dispatch channel.

Cold start interacts with the readiness precondition (§2 step 2): on a cold launch the family may still be loading when the intent lands. The orchestrator therefore **awaits the app's existing ready/hydrated signal once** (the same one the router guard waits on) before evaluating the precondition, rather than polling or racing. If that wait resolves to "signed out", the honest sign-in message is shown — the share is not queued across a login, because a queued file surviving an auth boundary is a data-handling question this plan is not taking on.

### 4. Platform adapters — one interface, one registry, one call site

```ts
// src/services/share/types.ts
export interface ShareAdapter {
  name: 'android' | 'ios' | 'pwa';
  isSupported(): boolean;
  /** Returns a teardown fn. Its callback body is the adapter's ONLY logic. */
  start(onShare: (files: File[], meta: ShareMeta) => void): () => void;
}
```

`src/services/share/index.ts` exports the registry array; `useShareTargets()` (one composable) filters by `isSupported()`, starts each, wires the callback to `ingest`, and tears down on unmount. `App.vue` calls `useShareTargets()`. A fourth platform is one file plus one array entry; no `if (platform === …)` chain exists anywhere.

Adapters resolve platform URIs/blobs to `File[]` and nothing else. Every adapter callback body is wrapped in try/catch → `reportError` + generic toast, because a native listener rejection escapes Vue's error handler entirely.

Phased by value:

- **Phase A — Android native** (biggest reach, lowest cost): `ACTION_SEND` + `ACTION_SEND_MULTIPLE` filters for `image/*` and `application/pdf` in `AndroidManifest.xml`, alongside the existing OAuth filters, with `android:exported="true"` stated explicitly (required from API 31 and a deliberate, reviewed decision — see §6). `launchMode="singleTask"` is already set, so a warm app receives the intent via `onNewIntent` rather than starting a second instance; the adapter must drain BOTH `getIntent()` at start and `onNewIntent`, and must clear the consumed intent so a configuration change (rotation, dark-mode toggle) does not re-deliver the same share. `androidShareAdapter` resolves the received `content://` URIs to `File`s (reporting per-file resolution failures) and hands them over.
- **Phase B — iOS**: a Share Extension target writing the shared items into a shared app group container; `iosShareAdapter` reads and clears them on launch/resume. Clearing is unconditional (read-then-delete, even on a failed ingest) so a poison item cannot wedge every future share.
- **Phase C — PWA**: `share_target` in the vite-plugin-pwa manifest (`method: POST`, `enctype: multipart/form-data`, `action: /share`) plus a `/share` route. A tiny `public/share-target-sw.js`, pulled in with `workbox: { importScripts: ['/share-target-sw.js'] }`, intercepts the POST, stashes the files in a Cache/IDB entry and 303s to `/share?id=…`; the route reads them, **deletes the stash entry**, and hands them to `pwaShareAdapter`. If the stash fails, it redirects to `/share?error=stash` and the route shows the generic failure toast — never a blank POST response. The `/share` route is `requiresAuth: true` like every other content route; the sign-out case is the §2 readiness message, not a special case.

Every phase ends at the same `ingest(files, meta)` call.

### 5. Complexity budget (stop-the-line thresholds)

Stated so the reviewer has a number, not a feeling:

- `useSharedDocumentIngest.ts` ≤ ~200 lines. If it grows past that, the growth is business logic that belongs in a wedge or the funnel.
- Each adapter ≤ ~80 lines and contains **no** branching on kind, flag, consent or route. An adapter that needs a second decision is a signal the decision belongs in the orchestrator.
- Each host page grows by ≤ ~5 net lines (it should SHRINK, once the consent wiring leaves). `RecipeFormModal.vue` should shrink too.
- `App.vue` grows by ≤ 4 lines including imports.
- Nesting: no function in the new code exceeds 3 levels of block nesting; the parser and both consumers close with `assertNever`.

### 6. Security — the share boundary is a new attack surface

An `ACTION_SEND` intent filter and an iOS Share Extension are **exported**: any app on the device can invoke them with content of its choosing. This is the first inbound surface in beanies that is not either a user-initiated picker or the OAuth deep link. Rules, all enforced in the orchestrator or the adapter (never left to the sender):

1. **Never trust the declared MIME.** `isAiPickerAcceptedFile` decides from the resolved `File` after the URI has been read; a `content://` URI advertised as `image/png` that resolves to something else is rejected with the existing unsupported-type message.
2. **Cap bytes before base64.** Per-file and total-payload size limits are checked before compression, reusing the existing compression pipeline's constraints; the request must stay under the Lambda body cap even with `MAX_EXTRACT_PAGES` pages. Over-cap is the same "too big" message the pickers use, not a 413 from the proxy.
3. **Sanitise filenames.** `env.sourceFile.name` flows into `new File([...], \`${name.replace(...)}.jpg\`)`in`deliverEvent`and into recipe/travel attachments. A hostile`../../` or a 4KB name must not reach storage — normalise to a basename with a bounded length at the adapter boundary, where the untrusted value enters.
4. **Nothing is persisted without confirmation.** Already a requirement; it is also the security answer — a hostile share can at worst cost one AI call and show the user a form they will not confirm.
5. **Never log shared content.** Diagnostics carry counts and enums only (§ Observability); no filenames, no MIME strings beyond the fixed rejected-type enum, no text.
6. **The consent gate applies identically** — a third-party app cannot cause a document to leave the device without the user seeing the ADR-030 modal, because the grant token is required by the funnel (§2a).

## Files Affected

**AI task (all prompt copies + the spike must move together)**

- `src/services/ai/types.ts` — `ShareExtractionResult`, `ExtractionResultByTask.share`
- `src/services/ai/extractionPrompt.ts` — `SHARE_JSON_SHAPE` composed from the three exported shapes, `buildShareExtractionMessages`, `SHARE_REQUIRED_KEYS`, `EXTRACTION_TASKS.share`, `EXTRACTION_PARSERS.share` (delegating), `PROMPT_VERSION` bump
- `infrastructure/lambda/ai-extract/extractionPrompt.mjs` — mirrored task entry + shape + `PROMPT_VERSION`
- `scripts/spikes/extractionPrompt.mjs` — mirrored (required by the drift guard's key iteration)
- `infrastructure/lambda/ai-extract/index.mjs` — `code: 'unknown_task'` on the unknown-task 400
- `src/services/ai/providers/managedProvider.ts` — map `code === 'unknown_task'` → `not_available` + a `console.error` naming the deploy step
- `src/services/ai/documentExtractionService.ts` — required `grant: ConsentGrant` on `ExtractOptions`; `File[]` support in `runExtraction`/`prepareImageDataUrls` (cap applied while collecting); `extractShareFromDocuments`; header comment rewritten

**Consent (step 1 — refactor only)**

- `src/composables/useDocumentConsent.ts` — module singleton (mirroring `useConfirm`), lazy `useSettingsStore()`, shared in-flight promise, `ConsentGrant` brand
- `src/components/ai/DocumentExtractConsentModal.vue` — self-contained (props removed; reads the singleton + `useAiCapability`)
- `src/pages/FamilyPlannerPage.vue`, `TravelPlansPage.vue`, `FamilyCookbookPage.vue`, `src/components/pod/RecipeFormModal.vue` — drop local consent wiring + modal mount; pass the grant into `extract*`
- test utils — the single `__testConsentGrant` helper

**Ingest**

- `src/composables/useSharedDocumentIngest.ts` (new — the ONLY new orchestrator)
- `src/types/magicPayload.ts` (new — `SharePayload` union + `ResultEnvelope`, types only)
- `src/constants/aiDocumentPicker.ts` — add `isAiPickerAcceptedFile`
- `src/composables/useMagicReader.ts` — `shareKind` on `MAGIC_READERS`, extracted `isReaderEnabled`, payload-carrying `pendingMagic`
- `src/composables/useDocumentToActivity.ts`, `useDocumentToTravel.ts`, `useRecipeCapture.ts` — extract `deliverX` from `processFile`
- `src/services/translation/uiStrings.ts` — `shareTarget.*` strings (incl. the sign-in and reader-off messages); reword `ai.pdfTruncated.*` once to be page-source-neutral (it now also covers "too many shared photos") and to state that only the first file is attached

**Platform**

- `src/services/share/types.ts`, `index.ts`, `androidShareAdapter.ts`, `iosShareAdapter.ts`, `pwaShareAdapter.ts` (new)
- `src/composables/useShareTargets.ts` (new — registry start/teardown)
- `android/app/src/main/AndroidManifest.xml`
- `ios/App/…` — new Share Extension target + app group entitlement
- `capacitor.config.ts`, `package.json` (share-intent plugin, if adopted)
- `vite.config.ts` — `share_target` + `workbox.importScripts`
- `public/share-target-sw.js` (new), `/share` route in `src/router/index.ts`
- `src/App.vue` — `useShareTargets()` + `<DocumentExtractConsentModal />` (≤4 lines with imports)

**Hosts**

- `src/pages/FamilyPlannerPage.vue`, `TravelPlansPage.vue`, `FamilyCookbookPage.vue` — narrow-and-delegate in the magic consumer

## Sequencing — small, independently revertible steps

Each step ships and is released on its own, so a regression is bisectable and no single PR is both a refactor and a feature:

1. **Consent singleton + `ConsentGrant` token** (refactor only; four consumers shrink, the modal becomes self-contained, an ungated `extract*` becomes a compile error). No share code. This step alone is worth shipping.
2. **`deliverX` split** in the three wedges (refactor only; existing tests unchanged).
3. **`File[]` in the funnel** (additive overload; existing call sites untouched).
4. **`share` task + Lambda** — Lambda deployed FIRST, client task behind no UI yet.
5. **Orchestrator + `useMagicReader` extensions + Android adapter** (Phase A) — the first user-visible share.
6. **iOS Share Extension** (Phase B).
7. **PWA share target** (Phase C).

Steps 1–3 are pure refactors that stand on their own merits; if the share feature were dropped tomorrow, none of them would need reverting.

## Help Center Coverage

- **Action**: `new article`
- **Category**: `features`
- **Article type**: `how-to`
- **Slug**: `share-to-beanies`
- **Title**: Share something straight to beanies
- **Scope**: How to send a photo, screenshot or PDF from any app into beanies, what beanies does with it (reads it, works out whether it is an activity, a trip or a recipe, and shows it to you to check), and that nothing is saved until you confirm.
- **Notes**: must state that the document is sent to be read (the consent step), that several photos of one thing are read together as one item (up to 5, with the first one kept as the attachment), that only images and PDFs work, that you need to be signed in first, and what happens when a reader is switched off for the family or unavailable to your role.

Also update `the-pod.ts` → `add-a-recipe-from-anywhere` and the travel/activity reader articles to mention sharing as an additional way in.

## Observability Coverage

Surface: **`share-target-ingest`** (kebab-case, greppable, one filter isolates the feature).

- `logEvent` `info` `action: 'received'` — `context: { os, file_count, cold_start }`. Fires on EVERY share, before anything can fail, so the denominator exists.
- `logEvent` `info` `action: 'not_ready'` — `context: { detail }` (signed out / family loading / AI not configured).
- `logEvent` `info` `action: 'rejected_type'` — `context: { detail }` carrying the unsupported MIME (fixed enum, never a raw filename).
- `logEvent` `info` `action: 'busy'` — a second share arrived mid-ingest.
- `logEvent` `info` `action: 'capped'` — `context: { file_count }`, emitted from the funnel's `truncated` flag (not from a second count).
- `logEvent` `info` `action: 'consent_declined'`.
- `logEvent` `info` `action: 'classified'` — `context: { kind }`, including `'none'`.
- `logEvent` `warn` `action: 'reader_disabled'` — `context: { kind }`.
- `logEvent` `info` `action: 'failed'` — `context: { error_code }` (the classified extraction failure; the toast comes from the shared mapper).
- `logEvent` `info` `action: 'ready'` — `context: { kind }`; the review modal opened. The SUCCESS signal, so a failure rate is computable.
- `reportError` `severity: 'error'` `action: 'threw'` — any unhandled failure in the orchestrator or an adapter callback. Not `critical`: nothing is persisted at this point, so no user data is at risk.

**Context keys — reuse first.** `action`, `kind`, `error_code`, `os` and `detail` are ALREADY in `ALLOWED_CONTEXT_KEYS`; `os` carries the platform and `kind` carries the detected kind, exactly as the recipe/meal surfaces reuse them. Only **two new keys** are needed: `file_count` and `cold_start` (a small integer and a boolean, both PII-free by construction). They must be added to `ALLOWED_CONTEXT_KEYS` in `src/utils/diagnosticContext.ts` **and mirrored in `infrastructure/lambda/telemetry/index.mjs`** (a pinned Lambda test fails on drift), then declared in `docs/runbooks/native-store-submission.md` plus its consumers (`ios/App/App/PrivacyInfo.xcprivacy`, the store Data-Safety answers, `web/src/pages/privacy.astro`).

**Failure modes and the event that diagnoses each, blind:** share never arrives (no `received`) → adapter/native problem; `received` then `not_ready` → an auth/hydration/capability gap, with `detail` saying which; `received` with no `classified` and a `failed` → the classified code says why, and the existing `ai-extract` surface carries the transport detail; `received` with neither → a throw, caught as `threw`; `classified: 'none'` rates → prompt quality; `reader_disabled` → a flag/permission/UX mismatch; `received` without `ready` and without an error → a routing gap; repeated `busy` → an adapter double-firing (or an un-cleared Android intent re-delivered on rotation).

**No silent failures — explicit inventory.** (1) Every adapter listener callback body is wrapped in try/catch → `reportError` + generic toast, because a native listener rejection escapes Vue's error handler entirely. (2) URI→`File` resolution failure is reported per file, and "zero usable files" is its own message rather than a no-op return. (3) `ingest` is wrapped end-to-end in try/catch/finally (the `useDocumentToTravel` precedent, which was added for exactly this defect), and the `finally` clears `isIngesting` **and any un-consumed `pendingMagic` payload**. (4) The SW POST handler try/catches and redirects with an error param. (5) An out-of-order Lambda deploy renders as the friendly `not_available` toast plus a console line naming the fix. (6) Every extraction failure goes through `useExtractionErrorToast` — no new mapping, no `catch {}` anywhere. (7) A share arriving mid-ingest is refused audibly, not dropped. (8) A share arriving signed-out is answered, not queued or discarded.

## Acceptance Criteria

Written to be **independently verifiable** — each says what to observe, not what to intend. Green tests have hidden real defects in this codebase before; every criterion below can be checked by a human or a machine looking at an artefact.

- [ ] Sharing an image or PDF from another app lists beanies on iOS and Android (observed in the OS share sheet on a real device).
- [ ] With the PWA installed on Android, beanies also appears via the Web Share Target (observed in Chrome's share sheet).
- [ ] The shared file opens the correct review modal, prefilled; **the store contains no new record until the user confirms** (verified by inspecting the family document, not by reading the code).
- [ ] Several files at once produce ONE review modal from ONE `/extract` request (verified in the network log: one POST, N image parts).
- [ ] More files/pages than the cap → the user is told, nothing is silently dropped. **Verified structurally:** `grep -rn "MAX_EXTRACT_PAGES" src/` shows it read only in `pdfExtractionImages.ts` and `documentExtractionService.ts`, and nowhere in the orchestrator or adapters.
- [ ] An unsupported type shows a clear message; zero usable files shows its own message; a file whose real content does not match its declared MIME is rejected.
- [ ] A second share arriving mid-ingest is refused with a message, not swallowed (reproduced by double-tapping share).
- [ ] Works on cold start and warm; on Android, rotating the device after a share does NOT re-trigger the ingest.
- [ ] A share arriving while signed out shows the sign-in message and makes **no** network call to `/extract` (verified in the network log).
- [ ] **An `extract*` call without a `ConsentGrant` fails to compile.** Verified by a `@ts-expect-error` negative test that would itself fail if the requirement were removed, plus `grep -rn "DocumentExtractConsentModal" src/` returning exactly one mount (`App.vue`) and `grep -rn "useDocumentConsent" src/` returning only the module and its call sites — no second resolver anywhere.
- [ ] Concurrent `requestConsent()` calls resolve from ONE modal and ONE promise (unit test asserts one `open` transition for two awaits).
- [ ] A share whose detected kind maps to a reader disabled by flag OR unavailable by permission says so (both cases exercised manually).
- [ ] Existing in-app camera/file entry is unchanged: all three readers, all four former consent sites, verified manually after step 1 and after step 2 — including that a recipe saved after a _shared_ capture has its source image attached (open the saved recipe and see the photo).
- [ ] Exactly ONE AI call per share (network log).
- [ ] ai-extract is deployed with the `share` task BEFORE the client ships — and a client-ahead-of-server deploy shows the friendly "not set up yet" toast (reproduced by pointing a local client at the un-updated prod proxy).
- [ ] No duplicated units, verified by grep: one accept predicate, one toast mapper, one consent gate, one reader registry, one gating predicate, one page cap, one dispatch channel, zero new review modals (`git diff --stat` shows no new `*Modal.vue` under `src/components`).
- [ ] The dispatch payload is a discriminated union; removing one `case` from a consumer breaks the build (verified once, by hand, during review).
- [ ] `App.vue` grew by ≤4 lines and contains no `if (platform`, no adapter import, and no `useAiCapability` call (`git diff src/App.vue`).
- [ ] Complexity budget met (§5) — checked with `wc -l` on the new files.
- [ ] Help Center article added; existing reader articles updated.
- [ ] Diagnostic events fire as specified — verified by reading the actual CloudWatch stream for one real Android share (a `received` and a `ready` with matching correlation), not by asserting the call in a mock.
- [ ] Only `file_count` + `cold_start` are added, allowlisted in BOTH copies (the pinned Lambda drift test passes) and declared in all four privacy consumers.
- [ ] No shared filename, MIME string or content appears in any diagnostic payload (inspect one real event body).

## Testing Plan

**Discipline:** every new test must be seen to FAIL before the code that satisfies it exists (or, for a refactor, by reverting the change locally). This project has shipped green suites over features that never worked; a test nobody watched fail proves nothing.

1. Unit — the `share` prompt composes all three shapes and the drift guard passes across client/server/spike with the bumped `PROMPT_VERSION`.
2. Unit — `parseShareExtractionResult` delegates correctly per `kind`, handles `'none'`, and throws on an unknown kind / missing payload / malformed payload.
3. Type — a `@ts-expect-error` negative test proving `extract*` cannot be called without a `ConsentGrant`, and that the brand cannot be forged from application code.
4. Unit — `runExtraction` with `File[]`: N images → one call with N image parts; a PDF + images → concatenated pages in file order; over-cap → `truncated: true`, exactly `MAX_EXTRACT_PAGES` images, and **no compression work past the cap** (assert the compress spy's call count).
5. Unit — the orchestrator: signed-out / family-loading / AI-unconfigured preconditions, type filtering, zero usable files, oversize file, offline, consent declined, disabled reader (flag AND permission), `kind: 'none'`, each routing branch, a second concurrent share, and a thrown error reaching `reportError` **and clearing `isIngesting` and `pendingMagic`**.
6. Unit — `deliverEvent`/`deliverTravel`/`deliverRecipe` produce the same payloads as before the split (regression on the existing wedge tests, unchanged), and `deliverRecipe` sets `pendingSource`/`pendingCompressed` and discards any prior pending source when invoked from the share path.
7. Integration — a share-originated recipe, saved, has its source attached (i.e. the orchestrator dispatched into the SAME `useRecipeCapture` instance that runs `attachAfterSave`). This is the test that would have caught the "documented as working, never worked" class.
8. Unit — consent singleton: concurrent requests share one promise and one modal, `skipDocumentConsentPrompt` short-circuit, persist failure still resolves, and importing the module before Pinia is active does not throw.
9. Unit — `MAGIC_READERS` shareKind mapping is total and injective; `isReaderEnabled` matches the three legacy computeds for every permission × flag combination.
10. Unit — filename sanitisation: a `../../evil` / 4KB / empty name reaching `deliverEvent` yields a bounded, path-free attachment name.
11. Lambda — the `share` task is accepted; an unknown task 400s with `code: 'unknown_task'`; `managedProvider` maps it to `not_available`.
12. Manual, Android — share 1 image, 1 PDF, 3 images, 7 images (cap), a 20-page PDF (cap), a huge image (size cap), and a .txt (rejected); cold and warm; rotate after a share; while signed out; with `aiTravelExtract` off; as a member without `canEditActivities`.
13. Manual, iOS — the same matrix via TestFlight, plus a poison item (unreadable app-group file) to confirm the container is cleared and the next share works.
14. Manual, PWA — installed on Android, share from Chrome; confirm the stash entry is deleted after use and that the SW update flow (`usePwaUpdater`) still behaves after `importScripts`.
15. Regression — the three in-app readers AND `RecipeFormModal`'s URL/document paths still work unchanged, including consent-remember, after each of sequencing steps 1–3 in isolation.

## Review Passes

- **Pass 1 (Initial draft)**: drafted from the pre-plan intake plus a codebase audit; chose a single composed `share` task over classify-then-extract because page images dominate cost, and surfaced the ai-extract deploy-ordering constraint.
- **Pass 2 (DRY / error handling)**: verified every reuse claim against the code. Removed the invented `useShareTarget` (the `pendingMagic`/`consumePendingMagic` channel already solves the cold-start handoff) and the invented flag check (`MAGIC_READERS` already maps reader→route→flag); folded error reporting onto the existing `useExtractionErrorToast` (including using its `offline` branch as the offline guard) and the existing `ai.pdfTruncated` notice; promoted `useDocumentConsent` to a `useConfirm`-style singleton with ONE `App.vue` modal mount instead of a fourth copy; added `isAiPickerAcceptedFile` next to `AI_PICKER_ACCEPT` so no second MIME list exists; made the `share` parser delegate to the three existing parsers rather than restating field caps. Caught three gaps: the funnel is single-`File`, the per-reader mapping lives inside `processFile` (so each wedge must split `extract`/`deliver`), and the telemetry allowlist lives in `diagnosticContext.ts` mirrored in the telemetry Lambda — reducing five proposed new context keys to two. Made the out-of-order deploy graceful, pinned the PWA SW approach to `workbox.importScripts`, added the spike prompt copy to the file list, and phased the platforms A/B/C.
- **Pass 3 (Sustainability / maintainability)**: removed the second page cap — files are the wrong unit (a shared PDF is many pages) and two caps drift, so `MAX_EXTRACT_PAGES` is enforced only inside `prepareImageDataUrls`, which now stops collecting at the cap so N files cost at most cap-many passes. Typed the dispatch payload as a discriminated `SharePayload` union in a standalone `src/types/magicPayload.ts` (no import cycle, `assertNever` at every consumer) instead of an untyped `{ data, … }` bag. Dropped the proposed `canRead` record — two ways to ask the same question — in favour of extracting ONE setup-free `isReaderEnabled(reader)` predicate that the existing computeds and the orchestrator both use, which also closes a real gap: availability is permission × flag, so a member without `canEditActivities` now gets an honest message. Kept `App.vue` (already 2056 lines) to a two-line diff by formalising a `ShareAdapter` interface + registry under `src/services/share/` driven by one `useShareTargets()` call, so a fourth platform is one file and no `if (platform === …)` chain exists. Specified consent-singleton concurrency (shared in-flight promise) and a single orchestrator re-entrancy guard that refuses audibly rather than the wedges' silent early return. Flagged that `deliverRecipe` is not a pure code move (it owns `pendingSource`/`pendingCompressed`/`discardPendingSource`) and pinned `ResultEnvelope.sourceFile` as non-optional so `TravelReady`'s existing contract is not loosened. Added a "no new review modals" requirement (the near-duplicate-modal failure mode), an explicit complexity budget with numbers, a mapping-totality test, and a 7-step independently-revertible sequencing plan that lands the three refactors before any share code.
- **Pass 4 (Fresh-eyes final sweep)**: moved the ADR-030 gate out of the entry points and into the shared path — `requestConsent()` now mints an opaque branded `ConsentGrant` that `ExtractOptions` requires, so an ungated call to the AI pipeline is a compile error rather than a convention in a comment (this is the exact defect class the project shipped once already). Corrected the consent count from three mounts to FOUR (`RecipeFormModal.vue` was missed, and has two extra `requestConsent` call sites), made `DocumentExtractConsentModal` self-contained like `ConfirmModal` so `App.vue` needs no `useAiCapability` wiring, and flagged two refactor traps: `useSettingsStore()` must be called lazily or the singleton throws at boot, and the global mount must stack above `RecipeFormModal`. Added a readiness precondition (signed out / family still hydrating / AI unconfigured) — a cold-start share previously would have fired an AI call for an unloaded family behind a login redirect — with a `not_ready` event. Added a Security section for the newly-exported inbound surface (resolve MIME from content not the sender's claim, byte caps before base64, filename sanitisation before it reaches `new File()` and storage, no content in diagnostics). Flagged that the orchestrator must dispatch into the SAME `useRecipeCapture` instance that later runs `attachAfterSave`, with a dedicated integration test, and required the Android intent to be cleared so rotation cannot re-deliver a share. Made the multi-file provenance limit explicit (file 1 is the attachment) rather than implicit. Rewrote the acceptance criteria to be independently verifiable — grep counts, network-log observations, a `@ts-expect-error` negative test, a real CloudWatch event read — and added a red-first testing discipline, because green suites have twice hidden real defects here.

## Outcome

> Implemented 2026-08-26 across four commits (`dde4af26` → `d074f4e1`), pushed to `main`, **not deployed**.

**Steps 1–5 and 7 shipped. Step 6 (iOS) is written but inert.**

What changed against the plan as written:

1. **`processFile` gained a parameter.** The plan said its signature would not change, but the
   `ConsentGrant` has to reach `extract*`, and consent runs BEFORE the picker opens while the
   extraction happens after a file is chosen. The alternatives were stashing the grant in
   module state (invisible coupling) or moving consent after the picker (reversing the
   privacy-correct order). Picker behaviour is unchanged.
2. **The consumer became generic per reader.** The plan had each page's consumer narrow on
   `payload.kind` and close with `assertNever`, but a page only ever handles ITS kind, so an
   exhaustive switch would not type-check. Instead `useMagicReaderConsumer<R>` resolves the
   payload to the one variant that reader can receive, and `consumePendingMagic` reports a
   kind/reader mismatch rather than casting it away.
3. **Android uses a first-party plugin.** Assumption 3 said to check `send-intent` first: it
   peer-deps `@capacitor/core >=7` (this app is on 8.5) and had not been published in 18
   months, so the plan's stated fallback applied.
4. **The public extractors widened to `File | File[]`** rather than gaining an overload. Every
   existing call site passes a single `File` and is unaffected.

Two defects were caught by writing the tests rather than by review:

- The orchestrator's `finally` cleared the dispatch channel unconditionally — including
  immediately after a successful hand-off — so the page would have received nothing and the
  whole feature would have silently done nothing.
- The rasterizer mock replaced the whole module without re-exporting `MAX_EXTRACT_PAGES`,
  which made the page arithmetic `NaN` and would have passed every cap assertion for the
  wrong reason.

**Owed before this can ship:**

- The ai-extract Lambda deploys FIRST (the client requests `task: 'share'`).
- The iOS Share Extension target, app-group entitlement and `ShareIntentPlugin.swift`.
- The manual on-device matrix (§ Testing Plan items 12–14) — nothing native has been compiled.
- Store data-collection declarations for `file_count` + `cold_start`.

## Prompt Log

> No GitHub issue created — this plan was approved for direct implementation, so the full
> prompt history lives here. Source of record for intent: Notion tracker **#64**.

<details>
<summary>Full prompt history</summary>

### Initial prompt (session, routing to intake)

> let's move on to implement the share to target for mobile as this is one of the biggest potential improvements in functionality, once this is done we will push everything to prod and apps, start with /beanies-pre-plan if needed and once done move onto /beanies-plan for #64

### Intake — /beanies-pre-plan #64

The tracker row was already unusually complete. Two things were resolved during intake, and
both changed the scope:

**1. Detect targets — three, not two.** The row was written 2026-08-14 and scoped auto-detect
as "activity vs travel". #72 shipped recipe capture afterwards, `useRecipeCapture.processFile`
is the same seam, and `MagicReader` is already typed `'photo' | 'document' | 'recipe'`. Asked
whether recipe should be a third target:

> **greg:** Three: activity, travel, recipe (Recommended)

Ten fields on the row still said "activity + travel" — including the row title and an
Out-of-Scope line that would have instructed this plan to build a two-way classifier. All
backfilled.

**2. Multi-file.** The row contradicted itself: Scope said register `ACTION_SEND_MULTIPLE`,
Edge Cases said single-file only. Asked how it should behave:

> **greg:** Can we register it and read all files?

Answered that we can, and that "all files" means two very different things with very different
costs — N files as ONE item (the shape the pipeline already uses for a multi-page PDF, needing
no queue and no extra AI calls) versus N separate items (a queue, N modals, N× cost). Asked
which:

> **greg:** One item, many pages (Recommended)

### Approval to plan

> **greg:** push it and go ahead with /beanies-plan for #64

### Carried into planning from the codebase audit, not from the row

- The ai-extract Lambda validates `task` against a fixed registry and rejects unknown tasks —
  a deploy-ordering constraint the row could not have known about.
- Page images dominate AI cost, which is what rules out classify-then-extract as two calls.
- The three JSON shapes are exported constants behind an explicit drift guard across three
  copies with a `PROMPT_VERSION` — so the new task composes them rather than restating them.
- The ADR-030 consent gate had already been missed once at a new entry point (#72), which is
  why Pass 4 moved it into the type system rather than leaving it a convention.

</details>
