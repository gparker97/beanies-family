# ADR-030: Private AI capability via a tiered architecture (on-device → BYOK → verifiable-TEE managed → cloud fallback)

> Date: 2026-06-02
> Status: **Accepted** (2026-06-02). Architecture accepted; **managed provider chosen = Tinfoil-direct (`qwen3-vl-30b`)** after Gate 1 passed empirically (quality + attestation both verified). Gate 2 (Tinfoil DPA / residency / zero-retention) **CLOSED 2026-07-10** (signed). Gate 3 (EHBP + attestation verification) is **IMPLEMENTED BUT NOT YET PROVEN (#49, 2026-09-16)** and remains **OPEN** while the Lambda's legacy plaintext arm still serves un-updated store builds; see the Gates section for the sunset condition. First feature wedge (event/invitation image → prefilled calendar activity) planned in `docs/plans/2026-06-02-private-ai-tiered-architecture-and-invitation-wedge.md`.
> Research basis: `docs/research/2026-06-02-private-ai-llm-capability.md` (three deep-research passes + a trust-boundary spike (Pass 4) + empirical provider validation (Pass 5 — RedPill routing non-determinism + Tinfoil-direct verification + the live extraction gate)).
> Related: ADR-001 (local-first IndexedDB), ADR-003 (Web-Crypto encryption), ADR-011 (file-first architecture), ADR-019 (family-key encryption), ADR-013 (admin API Lambda), ADR-027 (diagnostic logging/telemetry). Supersedes the scope of GitHub #133 (LLM help chatbot).

## Context

beanies.family is local-first, encrypted, and stores **no** family data on servers (Automerge CRDT + client-side AES-GCM, durable `.beanpod` file, IndexedDB ephemeral cache). We want genuinely useful AI — reading event invitations/itineraries/receipts to auto-create activities, extracting to-dos from explicitly-shared messages, financial-insight summaries, natural-language search — **without** breaking that privacy promise. The first feature wedge is: **share an event-invitation photo → AI extracts the details → a calendar activity is pre-filled for the user to confirm.**

The central question — _are "genuinely useful AI" and "private/local-first" mutually exclusive?_ — was researched across three verified passes. **Answer: no, but only a tiered architecture reconciles them**, because no single tier covers all users and all tasks. The honest framing is "_how much_ privacy at _how much_ cost/quality," not a binary.

### The decision space (cloud privacy spectrum)

| Option                                                        | Privacy guarantee                                                                                                                                      | Reality                                                                                                                                                                                                                                 | Verdict                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **On-device** (WebLLM/WebGPU, Ollama)                         | Absolute — nothing leaves the device                                                                                                                   | Text inference real today; **multimodal/vision nascent + unreliable** at small sizes                                                                                                                                                    | First-class for **text**, not yet for **document images**          |
| **Trust-based cloud (ZDR)** — Anthropic/OpenAI/Gemini/Vertex  | Contractual zero-retention + no-train                                                                                                                  | Provider reads plaintext in-memory; Anthropic ZDR needs enterprise contract + no CORS (proxy required)                                                                                                                                  | Acceptable with a DPA; **Gemini Flash-Lite = documented fallback** |
| **Hardware TEE — aggregator gateway** (RedPill→Phala/Tinfoil) | Compute in an attested enclave the host can't read                                                                                                     | **Gateway terminates TLS** (sees plaintext, in its own TEE); **routing is non-deterministic** (a `phala/` request was served ~50% by Tinfoil; pinning params ignored — verified). Docs ("Phala exclusive", "pinning") proved **false**. | **Rejected** — no deterministic/named processor                    |
| **Hardware TEE — direct, in-enclave TLS** (Tinfoil)           | Request encrypted to the **attested enclave**; TLS terminates **inside** the enclave; EHBP body encryption; client verifies attestation before sending | Rooted in one vendor's silicon PKI — **"verifiable" ≠ "trustless"** — but genuinely supports **no plaintext intermediary** + a blind proxy. Named enclave + live attestation **verified empirically**.                                  | **Chosen primary** (Tinfoil-direct, `qwen3-vl-30b`)                |
| **FHE** (encrypted inference)                                 | Only path eliminating plaintext-in-memory                                                                                                              | ~100 s GPU **per token** (Feb 2026) → hours per extraction                                                                                                                                                                              | Impractical; research-only                                         |
| **Self-host open model on confidential compute**              | Same TEE guarantee, our infra                                                                                                                          | Same single-vendor PKI root; little verifiable delta; high ops burden                                                                                                                                                                   | **Rejected** — security theater for an indie team                  |

### Provider verification (desk research → then empirically validated)

Desk research first pointed at **Phala Cloud via the RedPill gateway**. Empirical testing (Pass 5) then **disqualified that path** and selected **Tinfoil-direct**:

- **RedPill/Phala — rejected.** RedPill is an aggregator (Phala/Tinfoil/NEAR/Chutes). It **terminates TLS at its gateway** (sees request plaintext in its own TEE), and its **routing is non-deterministic**: a `phala/qwen3-vl-30b` request was served Phala/Tinfoil ~50/50 across 10 calls, and every documented pin (`provider.order`+`allow_fallbacks:false`, `route`, header) was **ignored**. Its docs ("Phala exclusive", "prefix pins", "no fallback") proved **false** under test. No deterministic, nameable, attestable processor → unfit for a privacy-first "here's who processes your document" story.
- **Tinfoil-direct — chosen.** Its own OpenAI-compatible API (`https://inference.tinfoil.sh/v1`) hosts **`qwen3-vl-30b`** (added 2026; the same strong model). It does **in-enclave TLS termination + EHBP** (encrypted HTTP body decryptable only by the attested enclave) + **client-verified attestation**. Verified live: every response names the serving enclave (`tinfoil-enclave: qwen3-vl-30b.inf10.tinfoil.sh`) with AMD SEV-SNP + Intel TDX predicates, and `GET /.well-known/tinfoil-attestation` returns a real SEV-SNP attestation document. Deterministic, named, attestable — and the claims **held up under test** (unlike RedPill's).
- **NEAR AI** (decentralized marketplace, wrong shape); **VoltageGPU / Super Protocol** (unverifiable) — not adopted.

**Model = `qwen3-vl-30b`.** Gate 1 ran it (and Gemma-3-27b) on 6 real invitation images + 5 PDFs: **Qwen 6/6 + 5/5 clean** (correct title/date/time/location, and correctly returned `isEvent:false` for non-events like spelling lists/surveys); **Gemma weaker** (a JSON parse failure, reversed times). Qwen is open-weight and runs inside the enclave — **no data flows to Alibaba**; for our schema-checked extract task, model-origin/bias concerns are negligible. Identical quality observed on RedPill and Tinfoil. **Pricing:** exact Tinfoil Qwen-VL $/M to be read from the dashboard (est. higher than RedPill's $0.20/$0.70 and Gemini Flash-Lite's $0.10/$0.40, but still sub-cent/doc — the premium buys the stronger, verified trust boundary; not a tiebreaker at indie scale).

### Regulatory driver

COPPA gates collection, use **and disclosure** (2025 FTC amendments); GDPR Art. 8 requires parental authorization for minors. **On-device avoids third-party disclosure entirely**; any cloud call on content that may mention a child is a disclosure/processing event needing consent + DPA + data-minimization. This makes on-device-by-default not just a brand value but a compliance advantage.

### Precedent

The privacy-first industry has converged on **on-device-by-default + an attestable privacy-cloud fallback**: Apple Private Cloud Compute (stateless, crypto-enforced no-retention, no operator shell), Proton Lumo (open models on own EU infra), Brave Leo (NVIDIA GPU-TEE with verifiable attestation).

## Decision

Adopt a **tiered AI architecture** with this preference order:

1. **On-device** (first-class for text tasks now — categorization, NL search, summaries; future for document images as in-browser VLMs mature).
2. **BYOK** — the user's own Claude/OpenAI/Gemini key (`Settings.aiApiKeys`); beanies never sees the key path for this tier beyond storing the key the user entered.
3. **Verifiable-TEE managed tier** — **Tinfoil-direct** (`qwen3-vl-30b` at `https://inference.tinfoil.sh/v1`), the default zero-friction path for the document-extraction wedge, behind a beanies server-side proxy that holds the provider key. Tinfoil's in-enclave TLS + EHBP let the proxy be a **blind ciphertext forwarder** once the verification SDK is integrated.
4. **Documented cloud fallback** — **Gemini Flash-Lite (via Vertex, for the DPA)**, used only if Tinfoil availability/DPA proves insufficient. Swappable behind the same provider abstraction without touching feature code.

**Split by modality:** on-device handles text now; multimodal document-reading goes through the consent-gated cloud now and migrates on-device later.

### Binding principles

- **Per-action consent.** No document leaves the device without an explicit, friendly, per-action consent step stating what is sent, where, and the retention posture. Never auto-send, never silent auto-create.
- **Data-minimization.** Send **only the single document** the user pointed at — never the family dataset. Compress/down-scale client-side first.
- **"Verifiable" ≠ "trustless."** Attestation proves hardware + loaded-code identity rooted in AMD/Intel/Tinfoil PKI; it does **not** make the silicon independently auditable. No "trustless" claims in code, copy, or docs.
- **Honest user-facing claim — earnable, but only once verified in our integration.** With Tinfoil's in-enclave TLS + EHBP + client-side attestation verification, the strong claim — _"your document is encrypted so that only the attested enclave can read it; no intermediary, not even beanies' own server, sees it"_ — becomes **truthful**. But it is **contingent on actually integrating Tinfoil's verification SDK + EHBP** and confirming it in our path. Until that integration is verified, scope to: _"processed only inside attested confidential hardware that the host cannot read, never retained or trained on."_ Never claim more than the shipped code verifies.
- **Two config surfaces stay separate.** Client settings hold tier selection + BYOK keys only; the managed-tier key lives **server-side only** (never in `aiApiKeys`). This is the privacy boundary, not an unfinished feature. The tier selection is persisted as `Settings.aiTier` (Phase 4), **read-coalesced** to `'managed'` in the `settingsStore.aiTier` getter so family docs that predate the field never read `undefined` into the tier dispatch.
- **No silent failures, no predictive warnings.** Every failure is caught, classified, and surfaced (per project convention); friction is shown only when it actually happens.

## Trust boundary (RedPill rejected, Tinfoil chosen)

The trust boundary — _who can read the document in transit_ — is what decided the provider, and it split the two candidates cleanly.

**RedPill/Phala (rejected).** Documented flow `Your Request →|TLS| Gateway TEE →|RA-TLS| GPU TEE`: TLS **terminates at RedPill's gateway**, which decrypts the request inside its own enclave before re-encrypting to the model GPU — a two-hop design, **not** client→enclave encryption. Its attestation proves compute integrity, not transit confidentiality; its stronger marketing ("no plaintext intermediary") was **refuted**; and empirically its routing is **non-deterministic** (so even "which enclave" is unknowable). Two plaintext touchpoints (gateway + our proxy), no determinism → rejected.

**Tinfoil (chosen).** Per its attestation-architecture docs and confirmed by live probing:

- **TLS terminates _inside_ the enclave**, bound to the enclave's attested key — intermediaries can only forward TCP, not read plaintext.
- **EHBP (Encrypted HTTP Body Protocol)** encrypts the request body so only the attested enclave can decrypt it; headers stay clear only for routing. **This lets our own proxy be a blind ciphertext forwarder** — it holds the key + applies a route throttle, but never sees the document. That answers the founding design question ("why does our Lambda see plaintext?") — with Tinfoil, it needn't.
- **Client verifies attestation before sending** (AMD cert chain, code/runtime measurements, Sigstore signatures, TLS-key binding).
- **Verified live:** responses carry `tinfoil-enclave: qwen3-vl-30b.inf10.tinfoil.sh` + SEV-SNP/TDX predicates; `GET /.well-known/tinfoil-attestation` returns a real SEV-SNP attestation. The claims held up — the opposite of RedPill.

**Decision given this:** managed primary = **Tinfoil-direct**. The strong "no intermediary sees the document" guarantee is **achievable** here (it was not on RedPill) — but it is **only real once we integrate Tinfoil's verification SDK + EHBP and confirm it in our path** (binding principle above). Until then, claims stay scoped to "attested confidential compute + zero retention." The strongest-privacy tiers remain **BYOK** (client→provider direct) and **on-device** (future); Gemini-via-Vertex stays the wired fallback.

## Gates

1. **Extraction-quality gate — ✅ PASSED (2026-06-02).** `qwen3-vl-30b` ran on 6 real invitation images + 5 PDFs via both RedPill and Tinfoil: 6/6 + 5/5 clean, correct fields, correct `isEvent:false` on non-events. Gemma-3-27b weaker (chosen against). Model = `qwen3-vl-30b`.
2. **DPA gate — ✅ CLOSED (2026-07-10).** The Tinfoil DPA is signed (greg). Zero-retention, no-training, GDPR Article 28 processor terms and data residency are contractually established. Note what this does and does not buy: it governs what the **enclave operator** may do with the document _after_ it arrives. It says nothing about the hop to our own proxy — that is Gate 3, and until Gate 3 ships the honest claim stays "attested confidential compute + zero retention", never "no intermediary sees the document".
3. **Verification-SDK gate — STILL OPEN overall, but the VERIFICATION half is now PROVEN LIVE (2026-09-16).**

   ✅ **A real sealed extraction has succeeded against the live enclave**, which is the condition this ADR set for the verification half after the false start below. Two independent proofs, in increasing strength:

   - `scripts/spikes/sealed-extraction.mjs` — mirrors `managedProvider.run()` step for step using the SHIPPED prompt builder and fingerprint function. Verifies the live SEV-SNP attestation, seals to the attested HPKE key, refuses to send if the plaintext is readable in the ciphertext, POSTs through the deployed Lambda, opens the reply.
   - `src/services/ai/providers/__tests__/managedProvider.live.test.ts` — calls the **actual exported `managedProvider.run`** with nothing mocked. A mirror proves the protocol; only this proves the code we ship. Opt-in via `BEANIES_LIVE_AI=1`, skipped by default so CI never spends money.

   Observed on the 2026-09-16 run: `model = gemma4-31b`; attestation `sev-snp-guest/v2` verified against `tinfoilsh/confidential-model-router`; 14040 bytes of genuine ciphertext with the plaintext absent; Lambda 200 with a sealed reply; the event extracted correctly; `attestation = { enclave: 'inference.tinfoil.sh', verified: true }`; one CloudWatch line `[ai-extract] ok task=share arm=sealed` and NO legacy line; and the meter wrote `n = 1` to `beanies-family-ai-usage-prod` — metering on the sealed arm confirmed against real DynamoDB, which no unit test can do.

   ⚠️ **What is still NOT proven, stated plainly so this is not read as more than it is:** none of the above ran in a browser or on a device. The sealed client bundle is **not deployed** — only the Lambda is. So the Vue runtime path (consent flow, the reader UI, native WebView origins for the `.well-known` fetch) remains unverified, and that is on the manual-test list. The CORS half of it was de-risked separately: `inference.tinfoil.sh` reflects any `Origin`, including `capacitor://app.beanies.family` and `null`, and answers the preflight — so the documented "blocking" native-CORS assumption is very unlikely to bite, but it has still not been observed from a real build.

   **The gate therefore stays OPEN**, because the legacy plaintext arm still serves un-updated store builds. See the sunset condition below.

   ⚠️ **The false start, kept rather than edited away.** **This gate was briefly and wrongly marked closed on 2026-09-16, and the correction is worth recording rather than quietly editing away.** A `/code-review max` found that the sealed client omitted the `model` field from the body it encrypts, and a live probe confirmed the enclave rejects it (`400 Missing required parameter: 'model'`, validated before auth). So the first sealed build would have failed 100% of managed extractions. Every test passed, because `sealForEnclave` was mocked and its payload never asserted. That is exactly the failure this ADR's binding principle exists to prevent: the claim was written from the code's intent, not from a verified round trip. **This gate does not close again until a real sealed extraction has succeeded against the live enclave.**

   The implementation below is in place, and is what will close the gate once proven. A client sending `protocol: 'ehbp-1'` verifies the enclave's AMD SEV-SNP attestation with `@tinfoilsh/verifier`, obtains the HPKE public key **bound to that attested measurement**, and seals the chat-completions body to it before anything leaves the device. `sealedForward.mjs` relays ciphertext our proxy cannot read. Verification failure refuses the send; there is no degrade-to-plaintext path, by construction, because a caller cannot obtain a key without verifying.

   **The gate is deliberately NOT marked fully closed, and the distinction is load-bearing.** `VITE_AI_EXTRACT_URL` is baked into store builds, and a store build updates when the USER updates it. So the Lambda keeps a legacy plaintext arm for installs that have not updated, and on that arm the proxy still sees the document in memory (retaining nothing). Awarding the gate a tick while that arm serves real families would be exactly the overclaim the binding principle at the top of this ADR forbids.

   **Sunset condition, in order:**
   1. The sealed build is live on both stores.
   2. Optionally raise `promptBelowVersion` in `web/public/min-app-version.json` to that version, per `docs/runbooks/native-store-submission.md#7-raising-the-update-floor`. That file's own `reason` records the last raise as justified by data damage, so whether a privacy improvement qualifies is a judgement call, not automatic. Skipping it simply means the tail drains on its own.
   3. The legacy counter reads zero for a full release cycle. Logs Insights:
      ```
      fields @message
      | filter @message like /legacy plaintext request/
      | stats count() by bin(1d)
      ```
      ⚠️ **This query read zero from the day it was written, for the wrong reason.** The line it
      counts was specified in the plan and never implemented, and the `LEGACY-PLAINTEXT-ARM`
      alternation only ever matched source comments, never a log line — so anyone following this
      checklist would have seen "no legacy traffic, safe to delete" while every un-updated store
      build still depended on that arm. `index.mjs` now logs
      `[ai-extract] legacy plaintext request task=<task>` on every legacy request, and
      `handler.test.mjs` pins the literal in both directions (it fires on a legacy request, and
      does NOT fire on a sealed one) so it cannot silently disappear again. A retirement trigger
      that cannot be told apart from a broken one is worse than no trigger at all.
   4. `grep -rn LEGACY-PLAINTEXT-ARM`, delete the marked block and `extractionPrompt.mjs`, drop its branch from `extractionPromptDrift.test.ts`, and flip this gate to closed.
   5. **Update the user-facing copy that is deliberately still conservative.** `src/content/help/security.ts` currently says "We are working towards encrypting it so that _only_ that secure hardware can open it, and not even our own server could read it in between." That wording is correct TODAY and must not be strengthened before the gate actually closes — but it is also the one place a family reads the claim, so it needs an anchor here or it will simply rot. Named explicitly for that reason. Strengthening it is greg's call and greg's words; this checklist only records that it is owed.

### What the sealed arm changed, beyond the encryption

Recorded here because each is a real trade rather than an implementation detail, and none of them is discoverable from the code alone.

- **The `sources` fence is dead and cannot come back.** It kept the proxy from being a general-purpose text-LLM endpoint anyone holding the bundle's `x-api-key` could bill us for. No server-side check can inspect a sealed body. **The compensating control is that the rate limiter now runs on EVERY sealed request**, not only text ones as on the legacy arm. That also closes ADR-035's "widen the limits to images" follow-up, on the arm where it was needed.
- **A bean is now spent when the enclave ANSWERED, not when we could read the answer.** `closeRead` on the sealed arm fires on any successful enclave response, because there is no answer to inspect. So a model returning unparseable JSON costs a bean there where it costs nothing on the legacy arm. Accepted knowingly: every alternative routes through the client declaring "that did not parse", which is a meter bypass by construction. ⚠️ This makes one clause of the 2026-09-14 release note ("refusals, timeouts and unreadable answers cost nothing") partly untrue for sealed clients. Timeouts and refusals still cost nothing on both arms; an unreadable answer does not. Amending that public wording is greg's call and was deliberately not done as part of the code change.
- **Correction grants are pinned to a server-measured SIZE and to the ARM that measured it.** `srcHash` is client-supplied on the sealed arm, so on its own it can be forged to buy a free EXPENSIVE read with a cheap one. The byte count is the half a caller cannot lie about, because the Lambda measures what it actually received.

  ⚠️ **Shipped broken, and worth recording.** The condition read `(attribute_not_exists(#bytes) OR (#bytes BETWEEN :lo AND :hi))` while the LEGACY arm wrote no `bytes` attribute at all — so for every legacy-issued grant the band was true by default and did nothing. The bypass was to earn a grant cheaply through the plaintext arm and spend it on an eight-page document through the sealed one. It had zero test coverage: deleting `srcBytes` from `sealedForward.mjs` left all 271 lambda tests green, because the sealed arm's test block never wired the DynamoDB or limiter stubs and those paths failed open in tests.

  The fix is structural rather than another clause. Both arms now always write a measurement and an `arm` tag, the `attribute_not_exists` escape is gone, and the band is unconditional. The `arm` tag is needed because the two arms measure DIFFERENT quantities — the legacy arm the source's own length, the sealed arm the ciphertext — so a grant earned under one must never be compared against the other's number; without it the bypass leaks in BOTH directions, not just one.

  **Deploy consequence, bounded and visible:** grants issued in the hour before this ships carry neither attribute, so the condition cannot be evaluated honestly. That is OUR doing, not the family's, so it is deliberately NOT a hard refusal: `unbound_legacy_grant` falls through to a CHARGED read, and the family pays a bean for that one re-read rather than being told their free correction "has already been used". `HARD_REFUSAL_REASONS` in `correctionGrant.mjs` draws that line, and `different_arm` (a family who updated the app mid-hour) sits on the same side of it. Bounded by `GRANT_TTL_SECONDS = 3600`. The reasons that DO refuse are the ones the family is actually spending something they do not have — `spent`, `expired`, `different_source`, and `different_size`, which is the cheap-buys-expensive attempt.

- **Correction grants lost their kind-binding**, because binding a grant to the result kind requires reading the result. Grants remain single-use and bound to `familyId + srcHash`, so the worst case is one free re-read per paid read of the same document, which is exactly the promise. A `kind: 'none'` share read now also issues a grant the UI can never spend (one extra write we pay for, never the family).
- **The server-side "hint only when a grant was spent" fence is gone.** The client passes `correction.to` into its own prompt, exactly as the BYOK tier already does. Biasing your own read costs you a bean.
- **The crypto is lazily fetched, and separately precached.** The verifier and `ehbp` are behind `await import()`, so a cold load never fetches them (verified in a browser: 87 requests, none of them crypto). An installed PWA does download them once at service-worker install, because workbox precaches every built asset. Both statements are true and the second is deliberate for an offline-first app. A named-chunk exclusion was tried and reverted: the manual chunk became the host of Vite's shared runtime, which made every page depend on it.
- **What our server still learns on the sealed arm**, stated plainly because "we cannot read it" is not the same as "we see nothing": `familyId`, `task`, the sealed body's size, the timing, and `srcHash`. That hash is a SHA-256 over the exact wire bytes. It reveals no content, but it is a stable identifier: we can tell that two reads carried the same document, and could confirm a _guessed_ short text source. It is deliberately unsalted, because salting would break byte-parity with the server's `sourceFingerprint` and a family who read on one bundle then corrected after an in-hour app update would hash differently and trip the `different_source` alarm that means the feature is broken.

If the DPA gate fails, the managed engine switches to **Gemini Flash-Lite (via Vertex)** behind the same abstraction; the rest of the architecture is unchanged.

## Consequences

**Positive**

- The local-first/privacy promise survives: on-device-default, consent-gated + data-minimized cloud, no family data on servers.
- Genuinely useful document-extraction ships via a cheap (low single-cent/doc), attested managed tier.
- The provider abstraction makes the Tinfoil→Gemini swap a config change, hedging provider lock-in and gate failure.
- On-device-by-default materially reduces COPPA/GDPR exposure.
- Tinfoil's in-enclave TLS + EHBP make a genuine **"no intermediary sees the document"** guarantee achievable (incl. a blind proxy) — a real privacy ceiling raise over a plain ZDR provider, once the SDK is integrated.

**Negative / costs**

- Introduces a **server-side proxy** (a new, if thin, server component for a local-first app) to hold the managed key + apply a route throttle — justified by secret-custody. (With EHBP it sees only ciphertext.)

  > **Correction (2026-08-25, #72 security pass).** Earlier revisions of this ADR and of `managedProvider.ts` described the proxy as rate-limiting **per family**. It does not, and never did. The only limit is a **global API-Gateway route throttle** (`POST /ai-extract`, burst 5 / rate 2 — `infrastructure/modules/registry/main.tf`), shared across all callers, keyed on nothing. Any future claim of per-family limiting must be built before it is written down.

  > **Superseded (2026-09-03, #83 — see [ADR-035](035-plain-text-share-provenance.md)).** Per-family limiting has now been **built**, so the correction above is itself out of date. The proxy applies a per-family (80/hour) and per-IP (120/hour) limit on **text sources**, on top of the route throttle, which remains as the backstop. This was not an enhancement: it is what replaces the text arm's **provenance guarantee** — that arm used to carry only content `content-fetch` had fetched behind its SSRF guard, and since #83 it also carries raw text a person shared from another app. ADR-035 records the trade, its limits, and the fail-open posture that comes with it.

- The managed tier is a billable third-party dependency (cost + rotation + abuse surface); Tinfoil's exact Qwen-VL $/M is likely a premium over RedPill/Gemini (still sub-cent/doc — confirm from dashboard).
- The strong privacy claim depends on **integrating Tinfoil's verification SDK + EHBP** — until shipped + verified, claims stay scoped to "attested confidential compute + zero retention."
- On-device multimodal is deferred; the wedge depends on the cloud tier until in-browser VLMs mature.
- Provider lock-in to Tinfoil for the vision path (mitigated by the Gemini fallback abstraction).

**Rejected alternatives**

- **RedPill/Phala aggregator** — terminates TLS at its gateway (plaintext touchpoint), routes **non-deterministically** across providers (verified ~50/50, pins ignored), and its docs proved false under test. No deterministic/named/attestable processor.
- **Self-hosting an open model on confidential compute (Phala dstack)** — little verifiable security delta over Tinfoil-direct, high operational burden.
- **FHE inference** — impractical in 2026.
- **A pure on-device-only approach** — would either ship unreliable multimodal extraction or delay the feature indefinitely.
- **The original #133 design** (LLM help chatbot on OpenRouter+Gemini with a full Lambda/DynamoDB backend) — predates this strategy; folded into a possible later tier.

## Sources

See `docs/research/2026-06-02-private-ai-llm-capability.md` for the full cited evidence, confidence levels, refuted claims, and caveats.
