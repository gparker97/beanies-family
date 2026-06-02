# Research: Private AI/LLM capability for beanies.family

> Date: 2026-06-02
> Status: Complete — feeds ADR-030 and the rewrite of GitHub #133
> Method: three adversarially-verified deep-research passes (fan-out web search → fetch sources → 3-vote adversarial verification per claim → cited synthesis). 50 claims verified across the three passes; refuted claims are retained below for honesty.

## The core question

Can beanies.family add genuinely useful AI/LLM capability (reading invitations/itineraries/receipts to auto-create activities, extracting to-dos from shared messages, financial insight summaries, etc.) **without** compromising its local-first, private, encrypted philosophy — or are those goals mutually exclusive?

**Answer: they are NOT mutually exclusive — but only a _tiered_ architecture can deliver both,** because no single tier covers all users and all tasks. The honest framing is not "private vs useful" but "_how much_ privacy at _how much_ cost/quality," and different tiers sit at different points on that curve.

The recommended shape (detail in ADR-030): **on-device-by-default for what it's good at, an attestable privacy-cloud tier for hard document images, every cloud round-trip gated by explicit per-action consent + data-minimization (send only the single document, never the family dataset).** This mirrors the pattern the privacy-first industry has converged on (Apple Private Cloud Compute, Proton Lumo, Brave Leo).

---

## Pass 1 — On-device viability, cloud privacy spectrum, models, precedent

### 1.1 On-device in-browser inference is real and private (text)

WebLLM runs LLM inference **entirely in-browser via WebGPU with no server**, keeping all prompt/inference data on-device, and retains up to ~80% of native throughput (Llama-3.1-8B at 41.1 tok/s / 71.2%, Phi-3.5-mini at 71.1 tok/s / 79.6% on an M3 Max). WebGPU reached W3C candidate recommendation (Mar 2026), enabled by default in Chrome/Edge/Firefox 147 and Safari iOS 26, ~84% global support. _(Confidence: high, 3-0.)_

- Caveats: figures are 4-bit quantized on a **top-tier** device; the 8B gap can reach ~29%; weights (2–3 GB) download once from CDN; **16–35% of devices lack WebGPU** and need a fallback.
- Sources: `github.com/mlc-ai/web-llm`, `arxiv.org/html/2412.15803v2`.

### 1.2 Small vision-language models can extract document fields — but unreliably at small sizes

SmolVLM (2B, ~5 GB GPU RAM, runs on a laptop) demonstrably reads invoice dates; Qwen2.5-VL provides "robust structured data extraction from invoices, forms, and tables." **But** at small sizes they trail larger models on document OCR (SmolVLM 81.6 vs Qwen2-VL 90.1 DocVQA; 72.7 vs 79.7 TextVQA) and "are bad at structured data understanding"; SmolVLM "requires fine-tuning… not suited for general-purpose OCR"; Qwen2.5-VL-7B "may experience hallucinations, identifying values not present in the image" and is non-deterministic run-to-run. _(Confidence: high, 3-0.)_

- Sources: `huggingface.co/blog/smolvlm`, `arxiv.org/pdf/2502.13923`.

### 1.3 Self-hostable open multimodal models are strong at the top end

Qwen2.5-VL ships open-weight (**Apache-2.0**) in 3B/7B/72B; the 72B flagship matches GPT-4o and Claude 3.5 Sonnet on document/diagram understanding (DocVQA 96.4 vs Claude 3.5 Sonnet 95.2). A self-hosted open model is therefore a viable high-quality engine. _(Confidence: high, 3-0.)_

- Caveat: the headline match is benchmarked against 2024-era frontier models and is partly vendor self-assessment.
- Sources: `arxiv.org/pdf/2502.13923`, `qwenlm.github.io/blog/qwen2.5-vl/`.

### 1.4 Trust-based cloud privacy — Anthropic ZDR

Inline-PDF/image content via the Anthropic Messages API is both **ZDR-eligible and HIPAA-eligible**; data is not stored at rest after the response; retained data is never used for training without express permission. _(Confidence: high, 3-0.)_

- Material limits: ZDR requires an **enterprise contract** (not consumer plans); the **Files/Batch APIs are not ZDR-eligible** (only the inline path); **CORS is unsupported under ZDR** → a browser PWA cannot call it directly and needs a backend proxy; flagged content can be retained up to 2 years; plaintext-in-memory during inference remains.
- Sources: `platform.claude.com/docs/en/manage-claude/api-and-data-retention`, `privacy.claude.com/.../8956058`.

### 1.5 Hardware confidential computing (TEEs) is the strongest cryptographic option

AWS Nitro Enclaves isolate inference in a VM with **no persistent storage, no SSH, no external networking** (only vsock); KMS attestation gates decryption on PCR0/1/2 measurements so only a verified enclave can decrypt. AWS Bedrock additionally isolates each model provider in an account they cannot access, so providers never see customer prompts/completions. _(Confidence: high, 3-0.)_

- Caveat: these are AWS self-attestations with no cited independent third-party audit; plaintext-in-memory inside the enclave during inference remains.
- Sources: `aws.amazon.com/blogs/machine-learning/large-language-model-inference-over-confidential-data-using-aws-nitro-enclaves/`, `docs.aws.amazon.com/bedrock/latest/userguide/data-protection.html`.

### 1.6 FHE inference is research-only

State-of-the-art FHE (Cachemir, Feb 2026) needs **<100 s GPU (or ~1.61 min CPU) per single output token** for Llama-3-8B → a ~200-token extraction would take hours. Impractical for real-time document extraction. _(Confidence: high.)_

- Source: `arxiv.org/html/2602.11470v1`.

---

## Pass 2 — Cost, self-host-vs-managed verdict, regulation, precedent

### 2.1 Cloud document-extraction cost is cheap and predictable

Most Claude models cap a full-page image at ~1,568 tokens (long edge ≤1568 px) → ~**$0.0047/page** on Sonnet ($3/M in); PDFs/images bill at the **same per-token rate as text, no document surcharge**. A 1–3 page extraction ≈ **$0.005–0.015 input** on Claude Sonnet (+ output). _(Confidence: high, 3-0.)_

- Sources: `platform.claude.com/docs/en/build-with-claude/vision`, `ai.google.dev/gemini-api/docs/pricing`, `developers.openai.com/api/docs/guides/images-vision`.

### 2.2 Gemini Flash-tier is the cheapest viable cloud vision lane

Gemini 2.5 Flash $0.30/M in + $2.50/M out (batch $0.15/$1.25); **Flash-Lite $0.10/M in + $0.40/M out** (batch $0.05/$0.20) → roughly **$0.0005–0.003/doc**. A beanies-managed tier is financially viable without per-seat pricing. _(Confidence: high, 3-0.)_ Source: `ai.google.dev/gemini-api/docs/pricing`.

### 2.3 GPT-4o-mini is a vision cost trap

Its vision tokenizer uses a **33.3× inflated** multiplier (2,833 base + 5,667/tile vs GPT-4o's 85 + 170/tile), so "mini" is **not** cheaper for images — roughly the same dollar cost as full GPT-4o. Prefer Gemini Flash-Lite or Claude Haiku/Sonnet for vision. _(Confidence: high, 3-0.)_ Source: `developers.openai.com/api/docs/guides/images-vision`.

### 2.4 Self-host vs managed — verdict: little real security delta for an indie team

Both AWS Nitro self-hosting and a reputable managed TEE/ZDR provider ultimately root trust in **one vendor's PKI** (Trail of Bits: with Nitro "you must completely trust AWS… if AWS is compromised, it's game over"). Self-hosting an open model on confidential compute delivers **little verifiable security delta** — mostly added operational burden (patching, key custody, misconfiguration). The real differentiator is **cryptographically-checkable attestation** (NVIDIA GPU-TEE chain, Nitro PCRs) vs a plain-text "we don't retain" promise. **Verdict: prefer a verifiably-attested managed provider over DIY confidential-compute self-hosting.** _(Confidence: high, 3-0.)_

- Sources: `blog.trailofbits.com/2024/02/16/a-few-notes-on-aws-nitro-enclaves-images-and-attestation/`, `aws.amazon.com/blogs/web3/establishing-verifiable-security-reproducible-builds-and-aws-nitro-enclaves/`.

### 2.5 On-device is the COPPA/GDPR trump card

COPPA gates **collection, use, AND disclosure** (2025 FTC amendments add separate consent for third-party disclosure); GDPR Art. 8 requires parental authorization for under-16s (down to 13 per member state). **On-device inference avoids the third-party "disclosure" trigger and processor/DPA obligations entirely**; any cloud-LLM call on content that may mention a child is a disclosure/processing event needing a DPA, data-minimization, and likely parental consent. _(Confidence: high, 3-0.)_

- Sources: `arxiv.org/html/2602.17418v1`, 16 CFR 312.5, GDPR Art. 8.

### 2.6 Precedent — the converged "private AI" pattern

On-device-by-default with an **attestable privacy-cloud fallback** that is stateless and cryptographically prevented from retaining data, never built on opaque third-party LLM APIs for sensitive paths. **Apple PCC** is the reference (stateless, crypto-enforced no-retention, no operator shell, "user data is never available to Apple — even to staff with admin access"). **Proton Lumo** runs open models on Proton's own EU datacenters. **Brave Leo** runs inference inside NVIDIA GPU-TEEs emitting a verifiable attestation hashing the loaded model + code. _(Confidence: high, 3-0.)_

- Sources: `security.apple.com/blog/private-cloud-compute/`, `proton.me/blog/lumo-ai`, `brave.com/blog/browser-ai-tee/`.

---

## Pass 3 — TEE-provider verification spike

A prior AI (Qwen) named four candidate resellable TEE inference providers. Verified skeptically against primary docs + independent corroboration:

### 3.1 ✅ Phala Cloud (RedPill gateway) — verified, recommended primary

- **Operational, OpenAI-compatible:** `base_url='https://api.redpill.ai/v1'`, `POST /v1/chat/completions`, drop-in OpenAI SDK (change `api_key` + `base_url`), $5 min balance. Independently corroborated: OpenRouter lists Phala as a live provider serving Qwen3-VL at ~1.34B tokens/day. _(3-0.)_
- **Genuinely vision-capable:** hosts `phala/qwen3-vl-30b-a3b-instruct` (30B MoE, 128K ctx, "Vision + Text"), a Qwen2.5-VL-72B legacy alias, and Gemma-3-27B; accepts `image_url` content arrays. **Pricing $0.20/$0.70 per M tok.** _(3-0.)_
- **Real hardware TEE:** Intel TDX + NVIDIA H100/H200/B300 confidential GPUs (launched mid-2025). _(3-0.)_
- **Attestation flow:** per-response attestation token; `GET /v1/attestation/report` returns GPU measurements + model hash + code hash + TEE signature; Trust Center recomputes the compose hash; built on `dstack` (open-source, zkSecurity-audited May 2025). _(3-0.)_
- **Overhead is low:** peer-reviewed ETH Zurich (`arxiv.org/abs/2509.18886`) measures **4–8%** GPU-TEE throughput penalty, shrinking with batch/input size — validates the "3–7%" claim. _(3-0.)_
- Sources: `docs.phala.com/.../confidential-ai-api`, `docs.redpill.ai/privacy/confidential-ai/overview`, `phala.com/posts/gpu-tee-is-launched-on-phala-cloud-for-confidential-ai`.

### 3.2 ❌ The other three

- **NEAR AI** (Ironclaw Confidential GPU Marketplace) is a **decentralized blockchain compute network** (NEAR DCML) for enterprise/government — names no vision model, documents no image API. Wrong shape for an indie primary tier. _(3-0.)_
- **VoltageGPU & Super Protocol** — **no surviving verified claims.** Not refuted, but unconfirmed/thin-footprint; do not adopt without direct investigation. _(Confidence: medium — evidentiary gap.)_

### 3.3 Attestation honesty — "verifiable" ≠ "trustless"

Remote attestation is real and signature-chain-checkable but rests on a **single-vendor silicon root of trust** (Intel/NVIDIA) plus Phala's compose-hash reproduction. Phala's own docs concede "Incomplete Verifiability." An integrating app **can** cryptographically check the signature chain + code/model hashes but **cannot** independently audit the silicon. Use "verifiable," never "trustless." _(3-0.)_

- Source: `arxiv.org/abs/2509.11555` (dstack paper).

---

## Pass 4 — Trust-boundary verification spike (RedPill/Phala request confidentiality)

A fourth verification spike (104 agents, 21 sources, 21/25 claims confirmed) answered the load-bearing question: **when a request goes through RedPill to a Phala TEE, can the gateway read the plaintext?**

### 4.1 RedPill does NOT shield request plaintext from itself

RedPill's own documented flow is `Your Request →|TLS| Gateway TEE →|RA-TLS/Secure Channel| GPU TEE`. **TLS terminates at the gateway**, which decrypts and processes the request _inside its own enclave_ before re-encrypting to the model GPU. It is a **two-hop** design, **not** client→enclave encryption. The gateway is itself an attested confidential VM (so the cloud **host** can't read it), but the gateway **code decrypts the request**. _(Confidence: high, 3-0.)_

- Sources: `docs.redpill.ai/privacy/confidential-ai/overview`, `github.com/dstack-TEE/dstack`, `phala.com/dstack`, `arxiv.org/html/2509.11555v1`.

### 4.2 Attestation proves compute integrity, NOT transit confidentiality

A Phala/RedPill attestation (`x-phala-*` receipts, GPU/model/code hashes, TDX quotes) proves "a genuine TEE ran this exact model+code and signed the response." It does **not** prove "no intermediary saw the plaintext request." These are different guarantees. _(Confidence: high, 3-0.)_

### 4.3 Phala's stronger marketing claims were refuted

"Encrypted on the client before transmission… no plaintext intermediary," "two-hop RA-TLS where each hop terminates in a TEE so the gateway never sees plaintext" — **refuted 0-3** against primary sources. Treat "no plaintext intermediary" as a _TEE-not-host_ framing, not client-opaque ciphertext routing.

### 4.4 Client→enclave encryption is buildable but not available on the managed path

The primitive exists in dstack (RA-TLS binds a cert key into the TDX quote's `report_data`; an enclave can embed an attested public key as Quote custom data) — but it's documented for **internal** channels and KMS key-release, and **RedPill's standard OpenAI endpoint does not expose it**. True client→enclave encryption would require **self-deploying** our own model in a dstack container (the rejected high-ops self-host path). _(Confidence: high, 3-0.)_

### 4.5 "Direct Phala" = self-deploy, not an endpoint swap

RedPill is effectively Phala's serverless-inference front-end for hosted models. "Going direct" means deploying your own model in a dstack confidential container (deploy-your-own-container on confidential compute) — categorically more work, and the only path that removes third-party plaintext touchpoints today. _(Confidence: high, 3-0.)_

### 4.6 Practical verdict

On the RedPill path the trust boundary includes **RedPill's gateway CVM AND our own forwarding Lambda** as plaintext touchpoints (both mitigated, neither blind). Three options: **(i) accept** them as trusted, relying on attested-compute + contractual zero-retention (shippable; must scope claims honestly — no "end-to-end encrypted/trustless"); **(ii) client→enclave encryption** (primitive exists, not exposed by RedPill → needs self-deploy); **(iii) self-deploy a dstack container** (strongest, highest ops). **Decision: option (i), Phala kept primary, with honest scoping** (see ADR-030 "Trust boundary"). The genuinely strongest tiers remain BYOK and on-device.

**Caveat:** all findings are documentation-based (no live request was sent to `api.redpill.ai`). An empirical probe + the Gate-2 DPA answers may refine this. Other providers (Chutes/Tinfoil/Anthropic confidential inference) market stronger client→enclave models — unverified, a future option if transit-secrecy ever becomes a hard requirement.

- Sources: `docs.redpill.ai/privacy/confidential-ai/overview`, `phala.com/posts/understanding-tdx-attestation-reports-a-developers-guide`, `docs.phala.com/dstack/design-documents/decentralized-root-of-trust`, `arxiv.org/html/2509.11555v1`, `security.apple.com/blog/private-cloud-compute/` (PCC design reference).

---

## Pass 5 — Empirical provider validation (the gate run)

Desk research (Passes 1–4) pointed at RedPill/Phala. **Hands-on testing then changed the answer.** A throwaway harness (`scripts/spikes/ai-extract-spike.mjs`) ran `qwen3-vl-30b` against 6 real WhatsApp invitation photos + 5 invitation PDFs (rendered page-1 to image via Ghostscript).

### 5.1 Extraction quality — PASS, Qwen wins

- **Qwen3-VL-30B: 6/6 images + 5/5 PDFs clean** — correct title/date/time/location, well-formed JSON every time, and correctly returned `isEvent:false` for non-events (a spelling list, a parent survey). Identical results on RedPill and Tinfoil.
- **Gemma-3-27b: weaker** — a JSON parse failure (trailing junk) + an end-before-start time. Not chosen.

### 5.2 RedPill routing is non-deterministic — the documented pin does not work

RedPill is an aggregator (Phala/Tinfoil/NEAR/Chutes). Calling `phala/qwen3-vl-30b-a3b-instruct`:

- A minimal probe returned `x-redpill-provider: tinfoil` — i.e. the `phala/`-namespaced request was served by **Tinfoil**.
- Over **10 calls**, the serving provider split **~50/50 Phala/Tinfoil**.
- Every documented pin was **ignored**: `provider:{order:["phala"],allow_fallbacks:false}`, `route:phala`, `order:[phala]`, and an `x-redpill-provider` header all still produced ~50/50 over a 10-call sample (a 3-call sample that looked deterministic was small-sample luck).
- The docs' claims ("`qwen3-vl-30b` is Phala-exclusive", "the prefix pins", "no fallback") are **false** under test. → RedPill cannot give a deterministic, nameable, attestable processor. **Rejected.**

### 5.3 Tinfoil-direct verified — chosen

Tinfoil's own OpenAI-compatible API (`https://inference.tinfoil.sh/v1`) hosts `qwen3-vl-30b` (added 2026). Live probing confirmed its privacy claims (the opposite of RedPill):

- **Per-response enclave identity:** `tinfoil-enclave: qwen3-vl-30b.inf10.tinfoil.sh`, plus `tinfoil-pt` predicates for **AMD SEV-SNP + Intel TDX**.
- **Live attestation:** `GET /.well-known/tinfoil-attestation` → HTTP 200 returning a real SEV-SNP attestation document.
- **Architecture (docs):** TLS terminates **inside** the enclave (bound to the attested key); **EHBP** encrypts the HTTP body so only the attested enclave decrypts it; the client SDK verifies attestation (AMD cert chain + code measurements + Sigstore) before sending. → Enables a genuine "no plaintext intermediary" path **and a blind forwarding proxy**.
- Quality identical to RedPill's Qwen (6/6 + 5/5). **Chosen as managed primary.**

**Caveat:** full client→enclave verification requires integrating Tinfoil's SDK (an implementation gate); the architecture is confirmed present but not yet wired into our path. Tinfoil's exact Qwen-VL $/M and its DPA/residency terms remain to confirm (Gate 2). PDF support is validated via render-page-1-to-image (Ghostscript locally; `pdfjs-dist` in the browser).

---

## Cost economics (managed tier)

| Engine                | Vision input            | ~$/doc (1–3 pp) | Notes                                  |
| --------------------- | ----------------------- | --------------- | -------------------------------------- |
| Phala `qwen3-vl-30b`  | $0.20/M in, $0.70/M out | low single-cent | TEE-attested; **chosen primary**       |
| Gemini 2.5 Flash-Lite | $0.10/M in, $0.40/M out | $0.0005–0.003   | cheapest; **documented fallback**      |
| Claude Sonnet         | $3/M in                 | $0.005–0.015    | ZDR needs enterprise + proxy (no CORS) |
| GPT-4o-mini           | inflated 33× on images  | ~GPT-4o         | **avoid for vision**                   |

A beanies-managed tier is sustainable at indie scale on either Phala or Gemini economics without per-seat pricing.

---

## Refuted claims (retained for honesty)

- "WebLLM supports no multimodal models" — **refuted 0-3.** WebLLM _does_ support vision via Phi-3.5-vision (just immaturely, with open accuracy/loading bugs).
- "A third party can independently rebuild a Nitro EIF and recompute PCRs to prove unmodified code" — **refuted 1-2.**
- "PCC offers fully independent verification without trusting Apple" — **refuted 1-2.** Both reinforce: every option roots trust in one vendor's PKI; "verifiable" ≠ "trustless."
- The most favorable GPU-TEE overhead benchmark (`arxiv.org/html/2409.03992`) has a **3/4-Phala-author conflict of interest**; its "<7% avg" and "70B effectively zero" framings were refuted 0-3. Rely on the independent ETH Zurich 4–8% figure.

---

## Open questions (resolved in implementation, not by more desk research)

1. **Real-image extraction quality** — does `qwen3-vl-30b` reliably pull dates/locations/refs from actual invitation/itinerary/receipt images? Requires a hands-on round-trip test (Phase 1 gate). A 404 on its dedicated model page hints the catalog entry may be thin — test before committing.
2. **Phala/RedPill zero-retention / GDPR Art-28 / children's-data DPA terms** — not substantiated by any source; confirm contractually before launch (Phase 1 gate). If inadequate → Gemini fallback behind the same abstraction.
3. **On-device extraction accuracy on mid-range mobile** — and whether degradation forces a cloud fallback that re-triggers the obligations on-device was meant to avoid.

---

## Caveats

This is a fast-moving area (model quality, WebGPU coverage, in-browser multimodal maturity, FHE speed, provider policies, pricing all change quarterly). Figures are anchored to late-2025/early-2026 sources; **re-validate before shipping.** Pricing is point-in-time (Gemini 2.0 Flash-Lite already shut down 2026-06-01). Vendor self-attestation (AWS Nitro/Bedrock, Anthropic ZDR, Phala) are trust-based architectural descriptions; residual plaintext-in-memory-during-inference exists in all cloud tiers (TEE narrows but does not eliminate it; only FHE would, and it is impractical). The Phala vision path is provider-specific even through the RedPill aggregator (lock-in consideration — Gemini fallback partly hedges this).
