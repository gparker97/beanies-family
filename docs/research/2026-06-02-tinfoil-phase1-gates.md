# Phase 1 — managed-tier gates (Tinfoil)

> Date: 2026-06-02 (Gate 2 desk research added 2026-06-03)
> Status: **Gate 1 PASSED** (quality + attestation, empirically). **Gate 2 MOSTLY PASSED on public terms** (7 of 9 questions answered in Tinfoil's published Privacy Policy / ToS / Security & Privacy FAQ; pricing confirmed from the dashboard 2026-06-03; DPA + residency + logging-invariant requested from Tinfoil 2026-06-03 — see below). **Gate 3 open** (verification-SDK integration). See ADR-030.
> Decision rule: if the DPA gate fails, switch the managed engine to **Gemini Flash-Lite (via Vertex)** behind the same provider abstraction. The rest of the plan is unchanged.

This doc records how the managed-provider gates were closed. **Provider chosen: Tinfoil-direct (`qwen3-vl-30b` at `https://inference.tinfoil.sh/v1`).** RedPill/Phala was investigated first and rejected (see Gate 1).

---

## Gate 1 — Extraction quality + provider trust boundary — ✅ PASSED (2026-06-02)

**Question:** does an open-weight vision model reliably extract title/date/time/location from real invitation images/PDFs, and can we get a deterministic, attestable processor?

**Harness:** `scripts/spikes/ai-extract-spike.mjs` (imports the shipping prompt from `extractionPrompt.mjs`; provider-configurable via `LLM_API_BASE` / `LLM_API_KEY` / `LLM_MODELS`).

```bash
# Tinfoil (chosen):
LLM_API_BASE="https://inference.tinfoil.sh/v1" LLM_MODELS="qwen3-vl-30b" \
  LLM_API_KEY="$(cat /tmp/beanies-tinfoil-api)" \
  node scripts/spikes/ai-extract-spike.mjs <images-dir> [ground-truth.json]
# PDFs: render page-1 to image first (Ghostscript): gs -sDEVICE=jpeg -r150 -dFirstPage=1 -dLastPage=1 -o out.jpg in.pdf
```

**Results** (6 real WhatsApp invitation photos + 5 invitation PDFs):

- **`qwen3-vl-30b`: 6/6 images + 5/5 PDFs clean** — correct title/date/time/location, well-formed JSON every time, and correctly returned `isEvent:false` for non-events (spelling list, parent survey). **Identical quality on RedPill and Tinfoil.** → model = **`qwen3-vl-30b`**.
- `gemma-3-27b`: weaker (a JSON parse failure + an end-before-start time) → not chosen.
- One Qwen date came back as a past date on a low-quality image — exactly what the low-confidence flag + user-confirm step is for.

**Provider decision (the bigger finding):**

- **RedPill/Phala — REJECTED.** RedPill is an aggregator; calling `phala/qwen3-vl-30b-a3b-instruct` was served **~50/50 Phala/Tinfoil** over 10 calls, and **every documented pin** (`provider:{order:["phala"],allow_fallbacks:false}`, `route`, header) was **ignored**. Its docs ("Phala-exclusive", "prefix pins", "no fallback") are **false** under test. It also terminates TLS at its gateway (a plaintext touchpoint). No deterministic/named/attestable processor.
- **Tinfoil-direct — CHOSEN.** Its own OpenAI-compatible API hosts `qwen3-vl-30b`, with the trust-boundary claims **verified live**:
  - `tinfoil-enclave: qwen3-vl-30b.inf10.tinfoil.sh` on every response (named enclave) + `tinfoil-pt` AMD SEV-SNP + Intel TDX predicates.
  - `GET /.well-known/tinfoil-attestation` → HTTP 200, real SEV-SNP attestation document.
  - Docs: in-enclave TLS termination + EHBP (body encrypted to the attested enclave) + client-verified attestation → enables a genuine "no plaintext intermediary" path **and a blind forwarding proxy**.

---

## Gate 2 — Data-handling / DPA (Tinfoil) — MOSTLY PASSED (desk research, 2026-06-03)

**Question:** do Tinfoil's terms suit a YMYL app that may process children's + financial data?

**Method (2026-06-03):** read Tinfoil's published legal surface directly — Privacy Policy (`https://tinfoil.sh/privacy`), Terms of Service (`https://tinfoil.sh/terms`), and the Security & Privacy FAQ (`https://tinfoil.sh/security-and-privacy-faq`), cross-checked against the technical docs (`docs.tinfoil.sh`). **7 of 9 questions are answered in writing on the public terms.** The 4 residual items (flagged 🔶 below) still need a direct ask to Tinfoil / a dashboard login. All quotes below are verbatim.

> **Critical scoping note:** every guarantee below applies to the **Inference API** path (what we use). The separate **Chat product** stores client-side-encrypted conversation backups server-side for multi-device sync (keys held on-device, Tinfoil can't decrypt) — different model. Our integration must use the API, not Chat.

### 1. Zero data retention — ✅ ANSWERED-YES (enclave-enforced default)

- _"Prompts, completions, uploaded files, embeddings, and tool-call payloads are processed exclusively inside secure hardware enclaves. They are never retained on disk, logged, or accessible to Tinfoil."_ — Security & Privacy FAQ
- _"Do you retain prompts, completions, uploaded files, or tool-call payloads? No."_ — FAQ
- _"We do not retain prompt or response content after the response is returned"_ — Privacy Policy; _"Prompts and responses are not retained after the response is returned."_ — ToS

There is no retention period because content is **never written to disk** — it's an architectural property of the enclave, not a configurable toggle. Only `input tokens, output tokens, model name, timestamp` metadata is kept for billing.

### 2. No training — ✅ ANSWERED-YES

- _"Are prompts or responses ever used for model training, tuning, or service improvement? No. Enclaves are stateless and plaintext content does not leave the enclave at any point."_ — FAQ
- _"we do not use API content to train models"_ — Privacy Policy

### 3. GDPR Article 28 / DPA — ✅ DPA EXISTS, 🔶 sales-gated (full text needs request)

- _"Do you offer a DPA? Yes. We offer a Data Processing Agreement including Standard Contractual Clauses where applicable."_ — FAQ
- _"For business and enterprise customers, we offer a Data Processing Addendum (including Standard Contractual Clauses where applicable)."_ — Privacy Policy
- _"Tinfoil generally acts as a service provider or processor for personal data submitted to the Services, and as an independent controller for account, billing, security, and business operations data"_ — Privacy Policy (correct Art-28 controller/processor framing)
- A signed DPA/BAA/order form **overrides** the ToS where they conflict (ToS).

🔶 **Residual:** the DPA is obtained by contacting `privacy@tinfoil.sh` (scoped to "business and enterprise customers"); there is no self-serve click-accept DPA URL. The full Art-28(3) clause completeness — and whether it can name **children's data** as a covered processing category — must be confirmed in the actual signed document.

### 4. Sub-processors — ✅ ANSWERED-YES (published list; no plaintext to any of them)

Privacy Policy §6 publishes the full list: AWS / Cloudflare / Vercel (hosting, CDN, networking), Clerk (auth), Stripe + RevenueCat (payments), GitHub, Resend (email), Plausible + Sentry (analytics/errors), Tigerdata (billing metrics), Probo (SOC 2 trust center), Exa (web search, _"under a Zero Data Retention agreement"_), plus ad/analytics vendors that touch website/account data only. Key isolation statement: _"No subprocessor receives plaintext AI interaction content."_ — FAQ. (GPU compute is AWS + unnamed "GPU cloud providers".)

### 5. Data residency — 🔶 NOT FOUND PUBLICLY (no region commitment)

- _"Tinfoil is based in the United States, and personal data may be processed in the United States and other locations where our providers operate."_ — Privacy Policy
- EEA/UK transfers: _"we use Standard Contractual Clauses and other appropriate safeguards for transfers where required"_.

No US/EU region selection, no enclave/GPU geography guarantee anywhere public. SCCs are the only stated transfer mechanism. 🔶 **Residual:** confirm enclave geography (and whether a US-only or EU-region pin is possible) directly — material for EU end-users.

### 6. Enclave image bars request-plaintext logging — 🟡 PARTIAL (strong, but no code-level invariant published)

- _"We design our products so that Tinfoil, our cloud providers, and other third parties cannot access the contents of your AI interactions or in-enclave workloads during normal operation."_ — Privacy Policy
- _"Tinfoil runs LLMs inside secure enclaves — isolated environments on hardware where even Tinfoil cannot access your data."_ — `tinfoil-js` README

The guarantee rests on enclave isolation + attestation of the **measured published image** + the explicit "never logged" line in #1 — strong. But there is no published statement that the attested image's code path contains a **code-level "request plaintext is never written to any log" invariant**. 🔶 **Residual (nice-to-have):** ask Tinfoil to point at the log-handling in the attested image, or confirm the invariant in writing.

### 7. Logging metadata — ✅ ANSWERED-YES

- Logged: _"Usage metrics such as request counts, token counts, feature use, timestamps, and deployment status."_ and _"Internet and device information such as IP address, browser type, device type, and general region."_ — Privacy Policy
- Content: _"We do not retain prompt or response content after the response is returned"_ — i.e. image/prompt **content is never logged**; only metadata. (Our blind-forwarder proxy further means even our own infra never sees the document body — see Gate 1 / EHBP.)

### 8. Incident / breach notification — ✅ ANSWERED-YES (72h, GDPR-aligned)

- _"If a security incident affects your personal data, we will notify you and relevant supervisory authorities as required by law, and no later than 72 hours after becoming aware of the incident where the GDPR applies."_ — Privacy Policy

(This lives in the Privacy Policy; a processor-side breach SLA in the **signed DPA** is not public — folds into the #3 DPA request.)

### 9. Pricing — 🔶 NOT PUBLIC (usage-based; dashboard-only)

The public pricing page labels the **Private Inference** (API) tier `"Usage-based pricing"` with `activationFee: "$0"` and no per-token figure — confirmed by extracting the page's embedded data payload. Per-model `$/M input` + `$/M output` for `qwen3-vl-30b` is **only visible after dashboard login**. Billing is post-paid (_"You're only charged based on usage"_), per-token, per-model, with an optional **monthly spend limit** in the Billing tab and no published minimum/commitment for the self-serve tier.

**✅ Dashboard pricing confirmed (2026-06-03)** — read from greg's Tinfoil billing dashboard for the Gate 1 spike usage:

> `qwen3-vl-30b` — 12 requests · 22,349 input · 1,628 output tokens · **total $0.03**

That is **~$1.25/M blended** (23,977 tokens × $1.25/M = $0.030, exact to the reported cent) and **~$0.0025/doc** (avg ~2.0k tokens/doc, image-token-dominated). This **confirms the Gate 1 estimate empirically** against real billing. Projected scale: 5k families × 4 docs/mo ≈ 20k docs → **~$50/mo**. Per-token input/output split isn't separately displayed, but the blended rate is what matters for the $/doc model. **Residual #4 closed.**

---

### Gate 2 verdict — ✅ MOSTLY PASSED on public terms; 4 residual confirmations, none blocking

The public terms are **well-suited** to a privacy-first YMYL app: enclave-enforced zero retention, no-training (incl. no service-improvement use), no plaintext to any sub-processor, a published sub-processor list, an offered DPA with SCCs + correct processor framing, and a 72h GDPR breach commitment. Nothing in the terms **prohibits** processing data that relates to children (Tinfoil's own age rules govern who may be an account holder — 18+ for API/paid — not what the API may process), but nothing affirmatively covers it either.

**Residual items (greg-side comms / dashboard — none is a likely showstopper):**

1. **DPA — REQUESTED 2026-06-03** (`privacy@tinfoil.sh`) — asked for the standard DPA + Art-28(3) completeness, processor-side breach SLA, and whether **children's data** can be named as a covered processing category. _Awaiting reply._
2. **Data residency — REQUESTED 2026-06-03** (same email) — asked for enclave/GPU geography and whether a US-only or EU-region pin is available (matters for EU end-users; otherwise rely on SCCs). _Awaiting reply._
3. **Enclave logging invariant — REQUESTED 2026-06-03** (same email, nice-to-have) — asked for written confirmation that the attested image never logs request plaintext. _Awaiting reply._
4. **Exact `qwen3-vl-30b` pricing — ✅ CLOSED 2026-06-03** — dashboard confirms ~$1.25/M blended, ~$0.0025/doc, ~$50/mo at projected scale (see Q9 above).

**Decision-rule status:** the Gemini Flash-Lite (Vertex) fallback is **not triggered** — the DPA gate has not failed; it is offered and the public terms are strong. Proceed with Tinfoil; close the 4 residual items in parallel with Phase 2 (none blocks the build).

---

## Gate 3 — Verification-SDK integration — OPEN (implementation)

Before any "no intermediary sees the document" claim, integrate Tinfoil's attestation-verification SDK + EHBP into our path and confirm the proxy forwards **only ciphertext** (it never decrypts the document). Until shipped + verified, scope claims to "attested confidential compute + zero retention" (ADR-030 binding principle).

---

## If the DPA gate fails → Gemini Flash-Lite (Vertex) fallback

Provider abstraction makes the swap a config change, not a rewrite:

- Same `documentExtractionService` funnel + same extraction prompt.
- `managedProvider` points at Gemini Flash-Lite via **Vertex** (CMEK + no-training + Art-28 DPA; the consumer Gemini API lacks these).
- Lose the hardware-TEE attestation (Gemini is trust-based ZDR, not TEE) — consent copy + ADR must reflect the weaker (still contractual) guarantee honestly.

---

## What's left to close Phase 1

1. **Gate 2 (DPA):** greg to contact Tinfoil for the questions above (a contract/comms action). + grab exact pricing from the dashboard.
2. **Gate 3 (SDK):** implementation task, lands with Phase 2 of the plan.

Gate 1 is done — quality + provider + trust boundary all settled empirically.
