# Phase 1 — managed-tier gates (Tinfoil)

> Date: 2026-06-02
> Status: **Gate 1 PASSED** (quality + attestation, empirically). **Gate 2 open** (Tinfoil DPA). **Gate 3 open** (verification-SDK integration). See ADR-030.
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

## Gate 2 — Data-handling / DPA (Tinfoil) — OPEN

**Question:** do Tinfoil's terms suit a YMYL app that may process children's + financial data? Confirm in writing with Tinfoil:

1. **Zero data retention** — are prompts (incl. the image) and completions stored at rest at all? Can it be contractually set to zero?
2. **No training** — is customer content excluded from any training / fine-tuning / evaluation use?
3. **GDPR Article 28 / DPA** — will they sign a DPA naming beanies as controller, Tinfoil as processor? Sub-processors list?
4. **Data residency** — where do the GPUs physically sit (EU/US for GDPR)?
5. **Children's data** — any contractual restriction on processing data that may relate to minors?
6. **Enclave image bars logging** — the attestation measures the published enclave image; confirm that image / the contract **bars logging or retaining request plaintext** (the residual exposure even with in-enclave TLS).
7. **Logging** — what request metadata is logged (IP, timestamps, token counts)? Is image content ever logged?
8. **Incident / breach** notification terms + SLA.
9. **Pricing** — exact `qwen3-vl-30b` $/M input + output (read from the dashboard / confirm; the gate run produces real token usage for a true $/doc).

**Verdict:** _pending — record terms + go/no-go here once confirmed._

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
