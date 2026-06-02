# Phase 1 — the two hard gates (Phala managed tier)

> Date: 2026-06-02
> Status: **Open** — both gates must pass before the managed provider is committed (ADR-030).
> Decision rule: if either gate fails, switch the managed engine to **Gemini Flash-Lite** behind the same provider abstraction. The rest of the plan is unchanged.

ADR-030 accepts the tiered architecture but holds two gates open. This doc is how we close them and where the verdicts get recorded.

---

## Gate 1 — Extraction quality (does the model actually work?)

**Question:** does `phala/qwen3-vl-30b-a3b-instruct` (via RedPill) reliably extract title / date / time / location from real invitation/itinerary/receipt images? (The research verified the API surface + model availability but **not** real-image accuracy — and a 404 on the model's dedicated page is a yellow flag worth clearing early.)

**Harness:** `scripts/spikes/ai-extract-spike.mjs` (imports the shipping prompt from `scripts/spikes/extractionPrompt.mjs`).

**To run:**

```bash
# 1. Create + fund a RedPill account ($5 min balance): https://red-pill.ai
# 2. Put ~8–12 SYNTHETIC or NON-SENSITIVE invitation/itinerary/receipt images in a folder.
#    (Each image is sent to a third-party API — do NOT use real family data for the gate.)
# 3. (Optional but recommended) write a ground-truth.json mapping each filename to its expected
#    { title, date, startTime, endTime, location } so the harness scores accuracy.
REDPILL_API_KEY=sk-... node scripts/spikes/ai-extract-spike.mjs ./spike-images ./ground-truth.json
```

**What it reports:** per-field ✓/✗ vs ground truth, an overall accuracy %, JSON parse/shape failure count, request-failure count, and how often the Phala attestation header was present.

**Pass criteria (suggested):** title / date / location reliably correct on realistic samples, JSON well-formed every time, attestation header present. Erratic dates, hallucinated values, or frequent malformed JSON → **fail → use Gemini Flash-Lite**.

**Verdict:** _pending — paste harness summary here once run._

---

## Gate 2 — Data-handling / DPA (is it lawful for a YMYL family app?)

**Question:** do Phala/RedPill's terms suit an app that may process **children's data** and financial data? The research found **no** substantiated retention/processor terms — they must be confirmed in writing.

**Confirm with Phala/RedPill (email/support/contract):**

1. **Zero data retention** — are prompts (including the image) and completions stored at rest at all? If so, where, for how long, and can it be contractually set to zero?
2. **No training** — is customer content excluded from any model training / fine-tuning / evaluation use?
3. **GDPR Article 28 processor terms / DPA** — will they sign a Data Processing Agreement naming beanies as controller and them as processor? Sub-processors list? Data location (EU/US)?
4. **Children's data** — any contractual restriction on processing data that may relate to minors? (We send a single user-provided document, not a profile, but content may mention a child.)
5. **Attestation in practice** — confirm the `GET /v1/attestation/report` flow and per-response signature are available on the production endpoint we'd call, and what exactly they cover (model hash, code hash, TEE quote).
6. **Logging** — what request metadata do they log (IP, timestamps, token counts)? Is the image content ever logged?
7. **Incident / breach** notification terms and SLA.

**Verdict:** _pending — record terms + a go/no-go here once confirmed._

---

## If a gate fails → Gemini Flash-Lite fallback

The provider abstraction (Phase 2) means the swap is a config change, not a rewrite:

- Same `documentExtractionService` funnel + same extraction prompt.
- `managedProvider` points at Gemini Flash-Lite (OpenAI-compatible endpoint) instead of RedPill.
- Re-run Gate 2's DPA questions against Google (Vertex AI offers CMEK + no-training + Art-28 DPA; consumer Gemini API does not — use Vertex for the managed tier if going this route).
- Lose the hardware-TEE attestation (Gemini is trust-based ZDR, not TEE) — the consent copy + ADR must reflect the weaker (but still contractual) guarantee honestly.

---

## What's needed from greg to close Phase 1

1. A **RedPill API key** (funded account) — set as `REDPILL_API_KEY` when running the harness.
2. **~8–12 test images** (synthetic or non-sensitive invitations/itineraries/receipts) + optionally a `ground-truth.json`.
3. **Contacting Phala/RedPill** for the Gate-2 DPA answers (a contract/comms action I can't perform).

I can run the harness for you if you provide a key + images (note: it sends each image to RedPill and spends from the account's balance), or you can run it yourself with the command above.
