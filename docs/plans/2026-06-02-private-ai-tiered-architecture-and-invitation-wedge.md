# Plan: Private AI capability — tiered architecture + first wedge (event/invitation → calendar)

> Date: 2026-06-02
> Related issues: #133 (to be **rewritten**, not newly created)
> Plan file: `docs/plans/2026-06-02-private-ai-tiered-architecture-and-invitation-wedge.md`

## User Story

As a user, I want to share a photo/PDF of an event invitation, school invite, or activity with beanies and have it understood and added to my calendar automatically — while maintaining my privacy — so I avoid manual activity entry.

## Context

beanies.family is local-first, encrypted, and stores no family data on servers. We want to add genuinely useful AI/LLM capability (not a crowbarred-in chatbot) without breaking that privacy promise. The headline first feature ("wedge") is: **share an event invitation image/PDF → AI extracts the details → a calendar activity is pre-filled for the user to confirm.**

Three adversarially-verified deep-research passes were completed (2026-06-02) and are the evidentiary basis for this plan:

1. **On-device viability** — in-browser WebLLM/WebGPU text inference is real and private today; in-browser _multimodal_ (vision) is nascent (only Phi-3.5-vision ships in WebLLM, with bugs); small VLMs hallucinate on structured extraction without fine-tuning. Verdict: on-device is first-class for **text**, not yet for **document images**.
2. **Cloud privacy spectrum + cost + regulation + precedent** — cloud vision extraction is cheap (~$0.005–0.015/doc Claude Sonnet; <$0.005 Gemini Flash-Lite; GPT-4o-mini is a cost _trap_). Self-hosting on confidential compute gives little verifiable security delta over a reputable managed provider (both root trust in one vendor's PKI). On-device avoids COPPA/GDPR third-party-disclosure entirely; any cloud call on content that may mention a child triggers consent + DPA + data-minimization duties. Industry has converged on **on-device-by-default + an attestable privacy-cloud fallback** (Apple PCC, Proton Lumo, Brave Leo).
3. **TEE-provider verification spike** — of four candidate providers, **only Phala Cloud (via the RedPill gateway, `api.redpill.ai/v1`) verified end-to-end**: OpenAI-compatible, hosts `phala/qwen3-vl-30b-a3b-instruct` (vision), Intel TDX + NVIDIA H100/H200 GPU-TEE, per-response attestation, ~$0.20/$0.70 per-M-token, independently corroborated live on OpenRouter. NEAR AI is a decentralized marketplace (wrong shape); VoltageGPU and Super Protocol could **not** be verified.

**Decided direction (locked with greg):** tiered AI, preference order **on-device → BYOK → verifiable-TEE managed (Phala) → documented Gemini Flash-Lite fallback**; split by modality (on-device for text now, consent-gated cloud for document images); first wedge = invitation/event → prefilled calendar activity; **two hard gates** before committing to Phala (real-image extraction-quality test + zero-retention/GDPR-Art-28/children's-data DPA terms).

The current #133 ("LLM help chatbot, OpenRouter + Gemini, full Lambda/DynamoDB backend") predates this strategy and is superseded; its help-chatbot idea folds into a possible _later_ tier, not the headline.

## Requirements

1. **Decision record (documentation deliverables):**
   1. A cited research report at `docs/research/2026-06-02-private-ai-llm-capability.md` capturing all three verified passes (claims, confidence, sources, refuted claims, open questions).
   2. An ADR (`docs/adr/030-private-ai-tiered-architecture.md`) recording the tiered architecture, the cloud privacy spectrum, the provider verdict (Phala primary, Gemini fallback), the data-minimization + per-action-consent principles, and the "verifiable ≠ trustless" honesty constraint.
   3. A rewrite of GitHub issue #133 to the new tiered vision + this wedge; note the old plan file as superseded.
2. **Validation gates (must pass before any provider-committed implementation):**
   1. Hands-on real-image extraction-quality test on Phala `qwen3-vl-30b-a3b-instruct` against a small corpus of real invitation/itinerary/receipt images — measure accuracy of title/date/time/location extraction.
   2. Confirm Phala/RedPill zero-retention / GDPR Article 28 processor terms / children's-data suitability. If either gate fails, switch the managed path to the Gemini Flash-Lite fallback (same abstraction).
3. **First-wedge feature (the shippable user-facing capability):**
   1. A clear entry point in the planner/activities surface to "add from a photo/PDF" (e.g. an action on the Family Planner page / activity-create affordance).
   2. Accept an image (JPEG/PNG/HEIC) of an invitation/event via file-pick (`useFilePicker`, `capture: 'environment'` for mobile camera) and drag-drop (`useFileDrop`). PDF support is a deliberate Phase-3 decision (no decoder exists in-repo) — images-only for v1 unless the gate corpus shows PDFs dominate.
   3. Show an explicit, friendly **per-action consent** step before anything leaves the device: what is sent (this one document only), to where (the chosen tier/provider), retention posture. Never auto-send.
   4. Send **only the single document** to inference (data-minimization — never the family dataset). Down-scale the image client-side first via `compress(file, { maxDimension, quality })` from `src/services/photos/photoCompression.ts` (returns a JPEG `CompressedImage`; throws a typed `CompressionError` — catch it and surface a `photos.invalidType`-style toast). Note `compress()` uses `createImageBitmap` → **images only, not PDFs** (see PDF note in Approach/Phase 3).
   5. Extract a structured result (title, date, startTime, endTime, location, description/notes, confidence per field) via a strict JSON schema.
   6. Open `ActivityModal` **pre-filled** with the extracted fields for the user to review, edit, and confirm. Nothing is silently auto-created. Low-confidence fields are visually flagged.
   7. Handle the unhappy paths: consent declined, offline, provider error/timeout, unparseable/garbled output, non-event image, multi-page PDF, non-English text.
4. **Tier framework (extensible foundation, not all tiers built now):**
   1. A provider-agnostic AI service abstraction (`src/services/ai/`) so the managed-TEE tier, BYOK, and a future on-device tier are swappable behind one interface.
   2. Wire the existing `Settings.aiProvider` / `aiApiKeys` into a real Settings UI panel (BYOK entry + tier selection + a friendly privacy explanation). Default tier = beanies-managed (Phala) with explicit consent; BYOK optional.
   3. Make adding future on-device text features (categorization, NL search, summaries) and further document types (itinerary, receipt) incremental — no rework of the wedge.
5. **Managed-tier backend:** a thin server-side proxy (extending the existing AWS Lambda/Terraform/registry pattern) that holds the Phala/RedPill API key, enforces per-family rate limits, forwards only the single document + extraction prompt, requests/passes through the attestation token, and retains nothing. A browser PWA cannot safely hold the provider key or (for some providers) call cross-origin.
6. **Privacy/consent + i18n + theme:** all user-visible copy via `uiStrings.ts` (`en` + `beanie`); consent/UX aligned with the beanies CIG (friendly, reassuring, never scary, no Alert Red for routine prompts). No predictive failure warnings (surface friction only when it happens).
7. **Help Center article** documenting the feature and its privacy posture (see Help Center Coverage).

## Important Notes & Caveats

- **Privacy is the headline constraint, not a footnote.** Every cloud round-trip must be a deliberate, consented, data-minimized act.
- **"Verifiable" ≠ "trustless."** The ADR and any user copy must not overclaim. Attestation proves hardware + loaded-code identity rooted in Intel/NVIDIA/Phala PKI; it does not make the silicon independently auditable.
- **Two hard gates are real gates.** Do not build the full Phala integration before the image-quality test and DPA confirmation. The provider abstraction means a gate failure swaps the implementation to Gemini Flash-Lite without touching the feature code.
- **YMYL / children's data.** Content may mention children. On-device avoids third-party disclosure; the managed/BYOK cloud path needs consent + a DPA + strict data-minimization. Surface this honestly in copy and the Help article.
- **GPT-4o-mini is a documented cost trap** (33× image-token multiplier) — do not use it for vision even though it looks cheap.
- **ActivityModal does not currently accept a full prefill** (only `defaultDate`/`defaultStartTime`/`defaultAssigneeIds`). The plan must extend its prefill surface cleanly rather than fork the component.
- **#133 supersession:** the old chatbot plan (`docs/plans/2026-03-09-llm-help-chatbot.md`) stays as a historical record; add a superseded-by note. Don't delete it.
- **No new launch/marketing content** — docs are product/architecture only (per CLAUDE.md).
- **Do not deploy** the proxy/infra to prod without explicit instruction.

## Assumptions

> **Review these before implementation.** Valid at planning time (2026-06-02); may have changed.

1. Phala/RedPill remains operational with `qwen3-vl-30b-a3b-instruct` vision available at roughly the quoted pricing. (Re-verify at integration; model catalogs churn.)
2. The image-quality gate will pass at acceptable accuracy; if not, Gemini Flash-Lite is the fallback engine behind the same abstraction.
3. Phala/RedPill can provide adequate zero-retention / Art-28 terms; if not, fall back to a provider that can (Gemini/Vertex/Anthropic ZDR) — the abstraction absorbs this.
4. The existing AWS infra (Lambda/API Gateway/Terraform under `infrastructure/`) is the right host for the proxy, consistent with registry/oauth Lambdas.
5. `Settings.aiApiKeys` is the intended persistence for **BYOK** keys only. The existing model is provider-keyed (`AIProvider`/`AIApiKeys`, `models.ts:1096-1102`) and has **no tier field** — the tier model requires a deliberate model extension (see Phase 4), not a pretend-fit. The managed-tier (Phala) key is never stored here; it lives server-side.
6. The wedge targets one document at a time (not batch) for v1.

## Approach

### Phase 0 — Documentation (no provider dependency; can land first)

- Create `docs/research/` and write the cited research report (all three passes: summary, findings with confidence + sources, refuted claims, open questions, caveats).
- Write ADR-030 capturing: the core question + verdict ("genuinely useful AI and local-first privacy are _not_ mutually exclusive, via tiering"); the tier model + preference order; the cloud privacy spectrum (trust-based ZDR vs hardware TEE vs impractical FHE); provider verdict (Phala primary via RedPill, Gemini Flash-Lite fallback, self-host rejected as little-delta/high-burden); the data-minimization + per-action-consent + "verifiable ≠ trustless" principles; COPPA/GDPR posture; status `Accepted` with the two open gates noted.
- Rewrite #133 (body + title + labels) to the new vision and link the research doc + ADR + this plan; mark the old plan superseded. (`add privacy` label; keep `enhancement`, `page: settings`, `page: family`? — see labeling.)

### Phase 1 — Validation spike (the two hard gates)

- Build a minimal throwaway script / dev-only harness to call Phala `qwen3-vl-30b-a3b-instruct` with ~8–12 real sample invitation/itinerary/receipt images and the strict extraction prompt; score field accuracy. Record results in the research doc (append) and the ADR open-questions resolution.
- Obtain/confirm Phala/RedPill data-handling + Art-28 terms in writing. Record verdict.
- **Gate decision** (documented): proceed with Phala, or switch the managed engine to Gemini Flash-Lite. Either way the rest of the plan is unchanged.

### Phase 2 — AI service abstraction + managed-tier proxy

- `src/services/ai/` — a provider-agnostic, functional service:
  - `types.ts` — `ExtractionRequest`, `ExtractionResult` (typed fields + per-field confidence), `AiTier` (`'managed' | 'byok' | 'on-device'`), `AiProviderId`, and a local result interface shaped `{ success: boolean; data?: ExtractionResult; error?: string }`. **There is no generic `Result<T>`/`AiResult<T>` in this codebase** — match the existing per-service convention (`FetchResult`/`UpdateResult` in `src/services/exchangeRate/exchangeRateService.ts`, the `{ success, … }` interfaces in `src/services/auth/passkeyService.ts`); do not introduce a generic. Use `assertNever(tier, 'aiTierDispatch')` (`src/utils/assertNever.ts`) in the tier `switch` default so a new tier fails the build, not silently at runtime. **Interface purity (longevity):** the provider interface is expressed purely in domain terms — `(ExtractionRequest) => Promise<ExtractionResult>` — with **no** provider-shaped fields. `attestationToken` is metadata of the _managed_ result only → an optional `ExtractionResult.attestation?` that on-device/BYOK providers omit; never a required field. OpenAI-wire concerns (`choices`, message roles, model IDs) live **entirely** inside `managedProvider.ts`/`byokProvider.ts`, never in `types.ts`. Add a one-line comment on the interface stating this so the next provider author doesn't widen it.
  - `documentExtractionService.ts` — `extractEventFromDocument(file, opts): Promise<{ success: boolean; data?: ExtractionResult; error?: string }>`; orchestrates client-side compression → consent precondition (caller-enforced) → tier dispatch → strict JSON parse/validate → typed result. Single funnel for all callers (DRY).
  - `providers/` — `managedProvider.ts` (calls our proxy), `byokProvider.ts` (uses `Settings.aiApiKeys`), and a stub `onDeviceProvider.ts` (throws a typed "not yet available" the UI handles) so the seam exists without building it.
  - **Prompt/schema drift guard.** The managed path's authoritative prompt is the **server** copy (`extractionPrompt.mjs`); the BYOK path uses the **client** copy (`extractionPrompt.ts`) because it calls the provider directly. These are deliberately separate runtimes, so a single physical file is impossible — instead guard drift the way telemetry guards its allowlist (`telemetry/index.mjs:43-46`): a unit test pins the prompt string + JSON-schema shape and **fails CI if the two copies diverge**. The Phase-1 validation spike must import the **same** prompt module it will ship (not a throwaway copy) so spike results predict production.
- Backend proxy (extends existing pattern under `infrastructure/`):
  - `infrastructure/lambda/ai-extract/` Lambda (Node 20 ESM) **mirroring the verified contract** in `infrastructure/lambda/registry/index.mjs` + `…/telemetry/index.mjs`: `x-api-key` check → 401 (telemetry:133-136); origin-allowlisted CORS via a `getHeaders(event)` helper (registry:36-45); `OPTIONS` → 204; wrapped `JSON.parse` → 400 "Malformed JSON" (telemetry:143-148); `MAX_BODY_BYTES` guard → 413 — but set it **deliberately higher than telemetry's 256 KB** (telemetry/index.mjs:33): the payload is a base64 image data-URL (~1.33× the compressed bytes), so a 2048px/q0.85 JPEG is routinely 270 KB–1.3 MB. Size it ~2 MB to fit comfortably while staying well under the API Gateway 10 MB / Lambda 6 MB synchronous ceilings; tune the client `compress({ maxDimension, quality })` to stay under it, and if a doc still exceeds it after compression surface the friendly "try a smaller/clearer photo" toast rather than an opaque 413. Top-level `try/catch` → `console.error` + 500 (registry:133-136). It receives the single compressed document + uses a fixed server-side extraction prompt; **validates server-side that the body is exactly one image of an allowed mime (`image/jpeg`/`png`) within the size cap before calling upstream** (cheap belt-and-braces against a malformed/oversized call burning a billable request); calls Phala/RedPill with the server-held key; returns structured JSON + the pass-through attestation token; **never logs document bytes**; on a Phala/RedPill non-2xx, returns a typed error code the client maps to a friendly toast (do not leak the upstream body); **retains nothing**.
  - **Rate-limiting:** done at the **API Gateway route** via Terraform `throttling_burst_limit`/`throttling_rate_limit` (`infrastructure/modules/registry/main.tf:153-160`) — there is **no** DynamoDB per-family counter pattern in the repo to reuse. v1: add the per-route throttle as an extra `route_settings { route_key = "POST /ai-extract" }` block on the registry stage, exactly like the existing `POST /logs` entry. True per-family quotas (a DynamoDB token-bucket keyed on familyId) are **net-new** — only build if explicitly required; do not imply reuse.
  - `infrastructure/modules/ai-extract/` Terraform module containing only the Lambda + its route/integration/permission, **attaching to the existing shared API via `api_id = var.api_gateway_id`** — mirroring how `telemetry` joins the registry API (`telemetry/main.tf:94,100-101`), **not** standing up a new gateway/stage. Wire into `main.tf`/`variables.tf`/`outputs.tf`.
  - **Managed-key handling (billable third-party credential — handle more carefully than the internal `x-api-key`):** store as a Lambda env var sourced from a TF variable marked `sensitive = true` (consistent with `REGISTRY_API_KEY`/`LOG_INGEST_API_KEY`), supplied via tfvars/CI secret, never committed. Document the rotation path (update tfvars → `terraform apply` re-deploys the Lambda env) in the module README/ADR-030. On an upstream Phala 401/403, return the same typed error code as any non-2xx (no special-casing) but log a **distinct structured `error_code`** (no key bytes) so a revoked/rotated key is diagnosable from CloudWatch. Out of scope for v1: automatic rotation / Secrets Manager — an explicit known deferral, not an oversight.
  - No data persistence; structured logging without document content.

### Phase 3 — Frontend wedge feature

- **PDF handling is not free — decide explicitly.** There is no PDF code or pdf.js dependency in the repo (no `pdf`/`pdfjs` in `package.json`, no `application/pdf` refs in `src/`), and `compress()` cannot decode PDFs. Choose: **(i)** scope v1 to images only (JPEG/PNG/HEIC), defer PDF — simplest, no new dep, retitle the affordance "Add from a photo"; or **(ii)** add `pdfjs-dist`, render page 1 to a canvas, feed that canvas blob into `compress()`, and on a multi-page PDF render page 1 only + tell the user the rest was ignored. Do not describe PDF as "reuse photo-compression" — it does not apply. **Default recommendation: (i) images-only for v1**, PDF as a fast-follow, unless the gate corpus shows PDFs dominate.
- Entry point: an "Add from a photo" affordance on the Family Planner surface (and/or the activity-create flow). Reuse existing buttons/cards; no new bespoke UI primitives.
- `useDocumentToActivity` composable orchestrating: file intake via `useFileDrop` (drag-drop, with its `onReject` for non-accepted types) **and** `useFilePicker` (`src/composables/useFilePicker.ts`, pass `capture: 'environment'` so mobile opens the rear camera) → consent → `extractEventFromDocument()` (with `BeanieSpinner` "counting beans…" state) → map `ExtractionResult` → `CreateFamilyActivityInput` prefill → open `ActivityModal`.
- **Keep the reuse seam explicit (no rework for feature #2).** Generic AI concerns (tier/availability/consent-precondition) live in `useAiCapability`; `useDocumentToActivity` stays thin — only `intake → useAiCapability gate → extractEventFromDocument → map → open ActivityModal`. The _only_ wedge-specific code is the `ExtractionResult → CreateFamilyActivityInput` mapper (a pure, separately unit-tested function). A future feature (categorization, NL search) reuses `useAiCapability` + `extractEventFromDocument` without importing anything named `…ToActivity`.
- **Consent step:** `useConfirm` (`src/composables/useConfirm.ts`) translates `title`/`message`/`confirmLabel` by `UIStringKey` but its `detail` is a **plain, untranslated** string. Because the consent must show a per-tier, itemised "what is sent / where / retention" list (multiple translated lines) — which a single untranslated `detail` cannot honestly express under the i18n rule — this is the trigger to build the dedicated `DocumentExtractConsentModal.vue`. Build it on **`BeanieFormModal` (or extend `ConfirmModal`) per the mandated BaseModal → BeanieFormModal → ConfirmModal hierarchy** (CLAUDE.md line 31 / theme skill) — **not** raw `BaseModal`. Use the non-scary `'info'` styling (no Alert Red, per CIG); the `layer` z-index prop (`overlay`) is orthogonal — use it only if it must stack above another modal. (A plain `confirm({ variant: 'info' })` is acceptable only if the itemised list is dropped, which it should not be.)
- Extend `ActivityModal` prefill surface: add an optional `prefill?: Partial<CreateFamilyActivityInput>` prop (`ActivityModal.vue:43-51`) applied **only inside the existing `onNew` handler** (lines 195-227), after the current `default*` assignments (e.g. `title.value = props.prefill?.title ?? ''`). Keep the existing `defaultDate`/`defaultStartTime`/`defaultAssigneeIds` props (consumed at lines 199/202/208) — `prefill` is purely additive, non-breaking. Low-confidence fields flagged (subtle helper text / highlight), user edits freely, confirm = normal `createActivity` store path (no new persistence).
- **Every unhappy path maps to an explicit, non-silent outcome** (`useTranslation` keys, `en`+`beanie`): consent declined → silent no-op, **no network, no toast** (assert in test); offline → `useOnline` (`src/composables/useOnline.ts`) guard → friendly info toast _before any fetch_; `CompressionError` (e.g. HEIC on Chromium) → warning toast (reuse `photos.invalidType` wording); provider timeout/4xx/5xx → error toast via `showToast('error', …, { surface: 'ai-extract', error })` (note `useToast` **auto-fires `reportError`** for error toasts — `useToast.ts:92-105` — do not double-report); malformed/garbled JSON → caught in the service parse step → typed `{ success:false, error }` → error toast with a "try a clearer photo" hint; non-event image / all-low-confidence → still open `ActivityModal` but flag fields + info toast (never silently drop); `onDeviceProvider` stub → throws typed "not yet available" shown as an **info** toast, not an error.

### Phase 4 — Settings UI + tier framework

- **Resolve the model-shape mismatch first.** The existing persistence is **provider-keyed, not tier-keyed**: `AIProvider = 'claude' | 'openai' | 'gemini' | 'none'`, `AIApiKeys = { claude?, openai?, gemini? }` (`src/types/models.ts:1096-1102`), `setAIApiKey(provider, key)` (`settingsStore.ts:331`). The tier concept (`managed | byok | on-device`) does **not** map onto this. Decide explicitly: either (a) add a new `aiTier` field — defaulted in `getDefaultSettings()` **and coalesced on read for pre-existing docs** (`settings.aiTier ?? 'managed'`), because `doc.settings ?? getDefaultSettings()` (`src/services/automerge/repositories/settingsRepository.ts:29-41`) only backfills a _wholly-absent_ settings object, not a new field on an existing one — and keep `aiApiKeys` for BYOK keys; or (b) widen `AIProvider` to include a managed value. **Without read-time coalescing, every existing family reads `aiTier === undefined`, breaking the tier `switch`/`assertNever` on first use — a real upgrade-path bug.** Add `settingsRepository.ts` to Files Affected. Extend the model deliberately — do not pretend the current fields already fit. The **Phala key is never stored in `aiApiKeys`** (it lives server-side in the Lambda; see Phase 2).
- **Invariant (state in a code comment on the `aiTier`/`aiApiKeys` types and in ADR-030):** client settings hold _tier selection_ + _BYOK keys only_; the managed tier intentionally has **no** client-side key — that is the privacy/security boundary, not an unfinished feature. Anyone tempted to add a managed key to `aiApiKeys` is removing the reason the proxy exists. The two config surfaces (client tier/BYOK vs server-held managed key) are deliberate and must stay separate.
- AI settings panel on `SettingsPage.vue` (new card + modal, `?open=ai` deep-link via the existing `route.query.open` → `cardOpenMap` pattern, `SettingsPage.vue:117-127`), reusing `BaseSelect`/`BaseInput`/`BeanieFormModal`:
  - Tier choice + provider; BYOK key entry (password input, only when BYOK selected) with a "test key" action (typed validation + toast).
  - A plain-language privacy explanation of each tier (on-device = nothing leaves device [future]; BYOK = your key, your provider; managed = TEE, attested, data-minimized, no retention).
  - Persist via existing `settingsStore.setAIProvider` / `setAIApiKey`.
- `useAiCapability` composable exposing current tier, whether a key/consent is configured, and availability — consumed by the wedge and future features.

### Phase 5 — Tests + Help Center + changelog

- Unit tests: extraction service (mock provider — parse/validate happy + malformed JSON + provider error), mapping `ExtractionResult → CreateFamilyActivityInput`, consent gating (no network call before consent), BYOK key selection.
- E2E (only if it clears the Three-Gate Filter): a single critical-journey test — pick a fixture image → consent → (mocked extraction) → prefilled ActivityModal → confirm → activity persisted (assert via data export). One test, mocked network. Log in `docs/E2E_HEALTH.md` if added.
- Help Center article (see below). CHANGELOG entry. No prod deploy unless asked.

## Files Affected

**New — docs:**

- `docs/research/2026-06-02-private-ai-llm-capability.md`
- `docs/adr/030-private-ai-tiered-architecture.md`

**New — frontend AI:**

- `src/services/ai/types.ts`
- `src/services/ai/documentExtractionService.ts`
- `src/services/ai/extractionPrompt.ts` (client prompt for the BYOK path; drift-pinned against the server copy in a unit test)
- `src/services/ai/providers/managedProvider.ts`
- `src/services/ai/providers/byokProvider.ts`
- `src/services/ai/providers/onDeviceProvider.ts` (stub seam)
- `src/composables/useDocumentToActivity.ts`
- `src/composables/useAiCapability.ts`
- `src/components/ai/DocumentExtractConsentModal.vue` (itemised per-tier consent; built on `BeanieFormModal`/`ConfirmModal` per the mandated modal hierarchy — `useConfirm`'s untranslated `detail` can't carry the translated "what is sent" list)
- `src/components/ai/AiSettingsModal.vue` (or a section within the existing settings modal pattern)
- `src/services/ai/__tests__/documentExtractionService.test.ts`

**New — backend (managed tier):**

- `infrastructure/lambda/ai-extract/index.mjs`
- `infrastructure/lambda/ai-extract/extractionPrompt.mjs` (authoritative prompt for the managed path; drift-pinned in a unit test)
- `infrastructure/modules/ai-extract/main.tf`
- `infrastructure/modules/ai-extract/variables.tf`
- `infrastructure/modules/ai-extract/outputs.tf`

**Modified:**

- `src/components/planner/ActivityModal.vue` — optional full `prefill` surface (non-breaking).
- `src/pages/FamilyPlannerPage.vue` — "add from photo/PDF" entry point + wedge wiring.
- `src/pages/SettingsPage.vue` — AI settings card + modal + `?open=ai` deep-link.
- `src/services/translation/uiStrings.ts` — AI/consent/settings strings (`en` + `beanie`).
- `src/types/models.ts` — the `aiTier` field (+ widen/extend AI types deliberately, per Phase 4); extraction-specific types prefer `src/services/ai/types.ts`.
- `src/services/automerge/repositories/settingsRepository.ts` — default `aiTier` in `getDefaultSettings()` + read-time `?? 'managed'` coalescing for pre-existing docs.
- `src/stores/settingsStore.ts` — getter/setter for `aiTier` (mirroring `setAIProvider`/`setAIApiKey`).
- `infrastructure/main.tf`, `infrastructure/variables.tf`, `infrastructure/outputs.tf` — wire the `ai-extract` module.
- `infrastructure/modules/registry/main.tf` — add a `POST /ai-extract` `route_settings` throttle block to the shared `$default` stage (lines 148-167; the stage resource is owned by the registry module, mirroring the existing `POST /logs` entry). Cross-module edit — explicit so the implementer doesn't look for a throttle hook in the new module.
- `CHANGELOG.md`.
- GitHub issue #133 (rewritten via `gh`).
- `docs/plans/2026-03-09-llm-help-chatbot.md` — add a superseded-by note.

**Help Center:** the relevant `src/content/help/*` article file(s) (see below).

## Help Center Coverage

This introduces a distinct, security/privacy-relevant user-facing feature → a Help Center article is required, written per `.claude/skills/beanies-help-docs/SKILL.md` and shipped in the same change.

- **Action**: `new article`
- **Category**: `features` (with strong `security`/`how-it-works` framing)
- **Article type**: `how-to` (with an explainer section on the privacy model)
- **Slug**: `add-events-from-a-photo`
- **Title**: Add events from a photo or PDF
- **Scope**: How to turn an invitation photo/PDF into a calendar activity, and exactly what happens to that document — that only the single file is sent (never your family data), that you consent each time, which AI tier/provider is used, and the no-retention posture. Frames the privacy choice plainly.
- **Notes**: Must state honestly that the managed tier sends the one document to an attested third-party TEE provider (not "trustless"), that BYOK uses the user's own provider, that on-device is a future option, and the children's-data consideration. No overclaiming.

## Acceptance Criteria

- [ ] `docs/research/2026-06-02-private-ai-llm-capability.md` written with all three passes, citations, and the refuted/open items.
- [ ] `docs/adr/030-private-ai-tiered-architecture.md` written and `Accepted`, with the privacy spectrum, provider verdict, principles, and the "verifiable ≠ trustless" honesty constraint.
- [ ] #133 rewritten to the new vision; old plan marked superseded; cross-links in place.
- [ ] Validation gates run and recorded: image-quality test results + DPA/retention verdict; managed engine chosen (Phala or Gemini fallback).
- [ ] A user can pick/drop an invitation image or PDF, is shown an explicit per-action consent (what/where/retention), and only on consent is the single document sent.
- [ ] Extraction returns structured fields and opens `ActivityModal` pre-filled; low-confidence fields are flagged; nothing is auto-created.
- [ ] On confirm, a `FamilyActivity` is created via the existing store path and appears on the calendar.
- [ ] All unhappy paths handled with informative, non-silent errors (consent declined, offline, provider error/timeout, malformed output, non-event image, multi-page, non-English).
- [ ] AI settings panel: tier/provider selection + BYOK entry with key test; privacy explanation; persisted via `settingsStore`.
- [ ] Managed-tier proxy forwards only the single document, holds the key server-side, rate-limits per family, retains nothing.
- [ ] All user-visible text via `uiStrings.ts` (`en` + `beanie`); UI matches the beanies CIG; no Alert Red for routine prompts; no predictive failure warnings.
- [ ] Unit tests pass; E2E added only if it clears the Three-Gate Filter (and logged).
- [ ] Help Center article `add-events-from-a-photo` added and matches shipped behavior.
- [ ] `CHANGELOG.md` updated. No prod deploy unless explicitly requested.

## Testing Plan

1. **Validation spike:** run the real-image corpus through Phala; record per-field accuracy; confirm DPA terms. Decide Phala vs Gemini.
2. **Unit:** extraction service (happy JSON, malformed JSON, provider 4xx/5xx/timeout), `ExtractionResult → CreateFamilyActivityInput` mapping, consent-gates-network (no fetch before consent), BYOK provider selection, tier dispatch.
3. **Manual:** pick + drag-drop image and PDF; decline consent (no network); accept (single-doc payload verified in network tab); prefilled modal correctness; low-confidence flagging; edit + confirm → activity on calendar; offline + provider-error toasts; non-event image graceful message.
4. **E2E (conditional):** one mocked critical-journey test asserting data via export, per ADR-007.
5. **Privacy verification:** confirm via network inspection that only the single compressed document leaves the device, never family data, and only after consent.
6. `npm run type-check`, `npm run lint`, `npm run test` all green.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the full plan — phased (docs → validation gates → AI abstraction + proxy → frontend wedge → settings/tier framework → tests/help), grounded in the codebase map and the three research passes.
- **Pass 2 (DRY + error handling)**: Corrected four reuse claims to real code — Result type = per-service `{success,…}` interface like `exchangeRateService` (not a new `AiResult<T>`), rate-limiting = API-Gateway throttle in Terraform (no DynamoDB counter exists), consent = `useConfirm`'s `info` variant + `detail` before any bespoke modal, Lambda must mirror the registry/telemetry CORS/auth/413/500 contract; flagged two correctness gaps (no PDF decoder in repo → images-only v1; `Settings.aiProvider`/`aiApiKeys` is provider-keyed not tier-keyed → deliberate model extension) and mapped every unhappy path to an explicit non-silent toast.
- **Pass 3 (Sustainability)**: Aligned the proxy with the repo's _shared_ API-Gateway pattern (attach a route + stage-throttle to the registry API like telemetry, not a new gateway); replaced the false "single-source prompt" claim with two deliberately-separate runtime copies guarded by a drift-pinned CI test; drew the reuse seam so generic AI concerns live in `useAiCapability` and the wedge stays thin (feature #2 reuses without importing `…ToActivity`); pinned the provider interface to pure domain terms (attestation/OpenAI-wire confined to providers, never `types.ts`); hardened managed-key secret/rotation/logging proportional to its billable exposure; stated one positive invariant for the deliberate client-tier-vs-server-key split; fixed a stale "three-tier modal system" reference.
- **Pass 4 (Fresh-eyes sweep)**: Verified every code citation against the repo (all accurate) and ADR-030 is collision-free; caught one real correctness bug (ai-extract Lambda must set `MAX_BODY_BYTES` well above telemetry's 256 KB because the base64 image data-URL is ~1.33× the compressed bytes — else real photos 413) and tuned compression to fit under API-GW 10 MB/Lambda 6 MB; corrected the settings-repo path to `services/automerge/repositories/settingsRepository.ts` and required read-time `?? 'managed'` coalescing for the new `aiTier` (existing docs aren't backfilled by `getDefaultSettings()`); added the cross-module `modules/registry/main.tf` throttle edit to Files Affected; flagged that `useConfirm.detail` is untranslated (use the dedicated consent modal for the itemised "what is sent" list, built on `BeanieFormModal`/`ConfirmModal` per the mandated hierarchy, not raw `BaseModal`); added a server-side image mime/size guard before the billable upstream call.

## Prompt Log

> No GitHub issue is being _created_ (an existing one, #133, is being rewritten per the intake). Full prompt history retained here.

<details>
<summary>Full prompt history</summary>

### Initial Prompt (intake — Issue Tracker #28, assembled by beanies-pre-plan)

The assembled `=== BEANIES PRE-PLAN ===` block for "Incorporate AI / LLM capability + first feature wedge — event/activity PDF/photo detail extraction" (feature, high priority, all platforms, area overall/activities). Full block stored on Notion issue #28 `beanies-plan prompt` property and passed verbatim into beanies-plan.

### Originating session intent (greg, verbatim excerpts)

> I wanted to discuss incorporating AI capability into beanies while still remaining private and local-first as much as possible … reading travel itinerary documents to automatically create travel plans, reading PDFs (i.e. invitations to school events, birthday parties, etc) and creating activities and events, reading messages and creating to-dos (when explicitly shared) … keeping the private and local-first philosophy of beanies alive is important as well. I would like to know if these two goals can be achieved, or are they mutually exclusive … deeply research options such as locally run LLMs … as well as cloud LLMs … is hosting our own cloud-based LLM also an option, and is that inherently better or more secure than using an existing privacy focused cloud service.

### Direction decisions (greg, via clarifying questions)

> Tiered cost model (on-device + BYOK + managed). Research the privacy tradeoff (trust-based vs cryptographic). On-device as a first-class tier. Split by modality. Primary cloud path = verifiable-TEE provider, Gemini fallback if TEE quality suboptimal. First feature = invitation/event → calendar. Run the TEE-provider spike first (seeded with Phala/VoltageGPU/Super Protocol/Dstack from Qwen.ai).

### Hand-off

> Green light, write all three. use the /beanies-pre-plan skill to prepare the prompt as per issue tracker #28.

</details>
