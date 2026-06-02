# ADR-030: Private AI capability via a tiered architecture (on-device → BYOK → verifiable-TEE managed → cloud fallback)

> Date: 2026-06-02
> Status: **Accepted** (2026-06-02). Architecture decision accepted; two implementation gates remain open before the managed provider is committed (see "Open gates"). First feature wedge (event/invitation image → prefilled calendar activity) planned in `docs/plans/2026-06-02-private-ai-tiered-architecture-and-invitation-wedge.md`.
> Research basis: `docs/research/2026-06-02-private-ai-llm-capability.md` (three adversarially-verified deep-research passes + a fourth trust-boundary verification spike — see its Pass 4 section).
> Related: ADR-001 (local-first IndexedDB), ADR-003 (Web-Crypto encryption), ADR-011 (file-first architecture), ADR-019 (family-key encryption), ADR-013 (admin API Lambda), ADR-027 (diagnostic logging/telemetry). Supersedes the scope of GitHub #133 (LLM help chatbot).

## Context

beanies.family is local-first, encrypted, and stores **no** family data on servers (Automerge CRDT + client-side AES-GCM, durable `.beanpod` file, IndexedDB ephemeral cache). We want genuinely useful AI — reading event invitations/itineraries/receipts to auto-create activities, extracting to-dos from explicitly-shared messages, financial-insight summaries, natural-language search — **without** breaking that privacy promise. The first feature wedge is: **share an event-invitation photo → AI extracts the details → a calendar activity is pre-filled for the user to confirm.**

The central question — _are "genuinely useful AI" and "private/local-first" mutually exclusive?_ — was researched across three verified passes. **Answer: no, but only a tiered architecture reconciles them**, because no single tier covers all users and all tasks. The honest framing is "_how much_ privacy at _how much_ cost/quality," not a binary.

### The decision space (cloud privacy spectrum)

| Option                                                       | Privacy guarantee                                                                                         | Reality                                                                                                                                                                                                                                     | Verdict                                                            |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **On-device** (WebLLM/WebGPU, Ollama)                        | Absolute — nothing leaves the device                                                                      | Text inference real today; **multimodal/vision nascent + unreliable** at small sizes                                                                                                                                                        | First-class for **text**, not yet for **document images**          |
| **Trust-based cloud (ZDR)** — Anthropic/OpenAI/Gemini/Vertex | Contractual zero-retention + no-train                                                                     | Provider reads plaintext in-memory; Anthropic ZDR needs enterprise contract + no CORS (proxy required)                                                                                                                                      | Acceptable with a DPA; **Gemini Flash-Lite = documented fallback** |
| **Hardware TEE** (NVIDIA GPU-TEE, Nitro Enclaves)            | Compute runs in an attested enclave the **cloud host can't read**; attestation proves model/code identity | Rooted in one vendor's silicon PKI — **"verifiable" ≠ "trustless"**; and **NOT** end-to-end-encrypted to the enclave — the gateway (and our proxy) still decrypt the request (each inside a TEE / our control). See "Trust boundary" below. | **Chosen primary** (Phala)                                         |
| **FHE** (encrypted inference)                                | Only path eliminating plaintext-in-memory                                                                 | ~100 s GPU **per token** (Feb 2026) → hours per extraction                                                                                                                                                                                  | Impractical; research-only                                         |
| **Self-host open model on confidential compute**             | Same TEE guarantee, our infra                                                                             | Same single-vendor PKI root; little verifiable delta; high ops burden                                                                                                                                                                       | **Rejected** — security theater for an indie team                  |

### Provider verification

Of four candidate resellable TEE inference providers, only **Phala Cloud (RedPill gateway, `api.redpill.ai/v1`)** verified end-to-end: OpenAI-compatible, Intel TDX + NVIDIA H100/H200 GPU-TEE, per-response attestation, ~$0.20/$0.70 per-M-tok, independently corroborated live on OpenRouter (~1.34B tok/day). GPU-TEE overhead is a low 4–8% (independent ETH Zurich). NEAR AI is a decentralized blockchain marketplace (wrong shape); **VoltageGPU and Super Protocol could not be verified** and are not adopted.

**Model inside the enclave — gate-test two open-weight vision models:** `phala/qwen3-vl-30b-a3b-instruct` (strongest documented doc-extraction) and `gemma-3-27b-it` (Google open model, also on Phala). Both are **open-weight** and run _locally inside Phala's enclave_ — **no data flows to Alibaba/Google/China**; an open-weight model is inert and cannot phone home. The Qwen-vs-Gemma choice is therefore **quality vs origin-optics**, not a data-path question: Qwen-VL is likely the stronger extractor; Gemma sidesteps the Alibaba-origin optic a privacy-first brand may want to avoid. For our constrained extract-and-validate task (schema-checked JSON of title/date/location), model-bias/censorship concerns are negligible. Gate 1 tests both and decides on evidence. (Cost is not a tiebreaker: Phala ≈ $0.0006/doc vs Gemini Flash-Lite ≈ $0.0003/doc — both sub-cent; ~$6 vs ~$3 per 10k docs.)

### Regulatory driver

COPPA gates collection, use **and disclosure** (2025 FTC amendments); GDPR Art. 8 requires parental authorization for minors. **On-device avoids third-party disclosure entirely**; any cloud call on content that may mention a child is a disclosure/processing event needing consent + DPA + data-minimization. This makes on-device-by-default not just a brand value but a compliance advantage.

### Precedent

The privacy-first industry has converged on **on-device-by-default + an attestable privacy-cloud fallback**: Apple Private Cloud Compute (stateless, crypto-enforced no-retention, no operator shell), Proton Lumo (open models on own EU infra), Brave Leo (NVIDIA GPU-TEE with verifiable attestation).

## Decision

Adopt a **tiered AI architecture** with this preference order:

1. **On-device** (first-class for text tasks now — categorization, NL search, summaries; future for document images as in-browser VLMs mature).
2. **BYOK** — the user's own Claude/OpenAI/Gemini key (`Settings.aiApiKeys`); beanies never sees the key path for this tier beyond storing the key the user entered.
3. **Verifiable-TEE managed tier** — **Phala Cloud** (`qwen3-vl-30b-a3b-instruct` via RedPill), the default zero-friction path for the document-extraction wedge, behind a beanies server-side proxy that holds the provider key.
4. **Documented cloud fallback** — **Gemini Flash-Lite**, used only if the Phala quality/availability/DPA gates are not met. Swappable behind the same provider abstraction without touching feature code.

**Split by modality:** on-device handles text now; multimodal document-reading goes through the consent-gated cloud now and migrates on-device later.

### Binding principles

- **Per-action consent.** No document leaves the device without an explicit, friendly, per-action consent step stating what is sent, where, and the retention posture. Never auto-send, never silent auto-create.
- **Data-minimization.** Send **only the single document** the user pointed at — never the family dataset. Compress/down-scale client-side first.
- **"Verifiable" ≠ "trustless," and TEE ≠ "only the enclave sees it."** Attestation proves hardware + loaded-code identity rooted in Intel/NVIDIA/Phala PKI; it does **not** make the silicon independently auditable, and it does **not** mean the request was confidential in transit (the gateway and our proxy decrypt it — see Trust boundary). No "trustless" or "end-to-end encrypted" claims in code, copy, or docs.
- **Honest user-facing claim.** The truthful description of the managed tier is: _"your document is processed only inside attested confidential hardware that the cloud host cannot read, and is never retained or trained on."_ Never: _"only the secure enclave can ever see it"_ or _"end-to-end encrypted to the model."_
- **Two config surfaces stay separate.** Client settings hold tier selection + BYOK keys only; the managed-tier key lives **server-side only** (never in `aiApiKeys`). This is the privacy boundary, not an unfinished feature.
- **No silent failures, no predictive warnings.** Every failure is caught, classified, and surfaced (per project convention); friction is shown only when it actually happens.

## Trust boundary (what the managed TEE tier does and does not give you)

The Pass-4 verification spike (cited in the research doc) settled a load-bearing question: **RedPill does not shield the request plaintext from itself.** Its documented flow is `Your Request →|TLS| Gateway TEE →|RA-TLS| GPU TEE` — TLS **terminates at RedPill's gateway**, which decrypts and processes the request _inside its own enclave_ before re-encrypting to the model GPU. It is a **two-hop** design, **not** client→enclave encryption. (Phala's stronger marketing claims — "no plaintext intermediary," "encrypted requests" — were **refuted** against primary sources.)

What this means, stated honestly:

- **Attestation proves compute integrity, not transit confidentiality.** It proves "a genuine TEE ran this exact model+code and signed the response," not "no intermediary saw the plaintext request."
- **The trust boundary includes two plaintext touchpoints before the model enclave:** RedPill's gateway CVM **and** our own proxy Lambda (which holds the key and forwards). Both are mitigated — the gateway is itself an attested TEE the _host_ can't read; our Lambda is ours and retains nothing — but neither is a blind ciphertext router.
- **What the TEE genuinely buys us** (a real edge over a plain ZDR API, and brand-aligned): the cloud **host/operator cannot read** the in-memory request, plus cryptographic **attestation** of the model/code. What it does **not** buy: secrecy of the request from the gateway code or our proxy.
- **True client→enclave encryption is buildable but not available on the managed path.** The dstack primitive exists (RA-TLS, attested public key in the TDX quote) but is used for internal channels/KMS, not exposed by RedPill's OpenAI endpoint. Achieving it would require **self-deploying** our own model in a dstack container (the rejected high-ops self-host path) — out of scope.

**Decision given this:** keep Phala primary (the host-memory protection + attestation + brand fit remain worth it for a privacy-first product), but **scope every claim honestly** (binding principle above) and treat the managed tier's privacy story as "attested confidential compute + zero retention," not "only the enclave sees it." The strongest-privacy tiers remain **BYOK** (client→provider direct, no beanies server) and **on-device** (future). This narrows — but does not erase — Phala's edge over a mature ZDR provider (Gemini/Vertex), which is why Gemini stays the wired fallback.

## Open gates (must pass before the managed provider is committed)

1. **Extraction-quality gate** — a hands-on real-image test of **both** `qwen3-vl-30b-a3b-instruct` **and** `gemma-3-27b-it` on Phala, against a corpus of real invitation/itinerary/receipt images, scoring title/date/time/location accuracy. Pick the model on evidence (quality vs origin-optics).
2. **DPA gate** — confirm Phala/RedPill **zero-retention**, **no-training**, **GDPR Article 28** processor terms, **data residency** (where the GPUs physically sit — confirm not China; EU/US for GDPR), and children's-data suitability. Also confirm whether the gateway image is reproducibly attestable / contractually bars logging request plaintext.

If either fails, the managed engine switches to **Gemini Flash-Lite (via Vertex, for the DPA)** behind the same abstraction; the rest of the architecture is unchanged.

## Consequences

**Positive**

- The local-first/privacy promise survives: on-device-default, consent-gated + data-minimized cloud, no family data on servers.
- Genuinely useful document-extraction ships via a cheap (low single-cent/doc), attested managed tier.
- The provider abstraction makes the Phala→Gemini swap a config change, hedging provider lock-in and gate failure.
- On-device-by-default materially reduces COPPA/GDPR exposure.

**Negative / costs**

- Introduces a **server-side proxy** (a new, if thin, server component for a local-first app) to hold the managed key, enforce rate limits, and minimize data — justified by the no-CORS/secret-custody constraints.
- The managed tier is a billable third-party dependency (cost + rotation + abuse surface).
- On-device multimodal is deferred; the wedge depends on the cloud tier until in-browser VLMs mature.
- Provider lock-in to Phala for the vision path (mitigated by the Gemini fallback abstraction).
- The managed TEE tier is **not** end-to-end-encrypted to the model enclave — the gateway and our proxy are (mitigated) plaintext touchpoints. The privacy story must be scoped to "attested confidential compute + zero retention," which is a narrower (still real) edge over a mature ZDR provider than a naive "TEE = nobody sees it" reading would suggest.

**Rejected alternatives**

- **Self-hosting an open model on confidential compute** — little verifiable security delta over a reputable managed TEE provider, high operational burden.
- **FHE inference** — impractical in 2026.
- **A pure on-device-only approach** — would either ship unreliable multimodal extraction or delay the feature indefinitely.
- **The original #133 design** (LLM help chatbot on OpenRouter+Gemini with a full Lambda/DynamoDB backend) — predates this strategy; folded into a possible later tier.

## Sources

See `docs/research/2026-06-02-private-ai-llm-capability.md` for the full cited evidence, confidence levels, refuted claims, and caveats.
