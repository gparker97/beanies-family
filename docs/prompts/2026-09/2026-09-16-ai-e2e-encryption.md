---
date: 2026-09-16
category: feature
issue: Notion tracker #49
plan: docs/plans/2026-09-16-ai-e2e-encryption-gate-3.md
tags: [security, ai, encryption, adr-030, gate-3, ehbp, attestation]
---

# End-to-end encryption for the AI path (#49)

## Prompts

### 2026-09-16 — initial

> once that is done, please go ahead with /beanies-pre-plan for #49 then move direct to
> /beanies-plan and once done direct to /beanies-build-auto - work autonomously and ensure you are
> implementing only what is required (end to end encryption for ai) and take the simplest, most
> direct, and most maintainable route possible. if you have any questions please ask now, then
> proceed as per the above prompt

### 2026-09-16 — decisions during pre-plan (AskUserQuestion)

> **Correction grants**: "Drop kind-binding, keep the rest" — the grant stays bound to family +
> task + document hash and stops being bound to the result kind; the kind-guard moves client-side.

> **srcHash trust level**: "Yes, consistent with familyId" — a client-computed hash sits at the
> same trust level as the already-forgeable familyId.

### 2026-09-16 — decisions during planning (AskUserQuestion)

> **Bean count**: "Accept it, document it loudly" — on the sealed arm a bean is spent when the
> enclave answered, not when we could read the answer.

> **Surfacing `verified`**: greg asked what attestation meant and why it would need UI. Answered,
> and he chose no new UI: set the flag truthfully, carry it, log it.

### 2026-09-16 — on the config repo

> is this a repo i need to create in my own github, or something that tinfoil should have? can you
> search the web and tinfoil docs for this information?

### 2026-09-16 — to completion

> keep going until completion

## Outcome

Shipped across six commits. The feature is implemented and every test is green, but **ADR-030
Gate 3 is deliberately still OPEN**: it does not close until a real sealed extraction has
succeeded against the live enclave on a real device.

### What was actually hard, and what it cost

**The tracker row predated the meter by two months.** Written 2026-07-10; per-family metering and
the free-correction grants shipped 2026-09-14 and live in the Lambda reading plaintext. "The
Lambda becomes a blind forwarder" collided with code that did not exist when that sentence was
written. Surfaced during planning, not during implementation, which is the only reason it did not
become a silent regression.

**A `/code-review max` found the feature was 100% broken, after I had already flipped ADR-030 to
"Gate 3 shipped".** The sealed body omitted `model`, and a live probe confirms the enclave rejects
it (`400 Missing required parameter: 'model'`, validated before auth). Every test passed because
`sealForEnclave` was mocked and its payload never asserted. This is the exact failure ADR-030's
binding principle exists to prevent, and I committed it: the claim was written from the code's
intent rather than from a verified round trip. The ADR now records the mistake rather than editing
it away.

**Four defects were caught by checking the artifact rather than the source.** The `model` omission
(live probe). A static `import { PROTOCOL } from 'ehbp'` that pulled the whole crypto package into
the 3.2MB main chunk, silently defeating every lazy import below it (build output). The "lazy"
chunk being swept into the service-worker precache, which falsified a comment claiming it is
fetched only by families who use the tier (built `sw.js`). And a memo that started a second
verification for concurrent callers, because the TTL stamp moved to completion and left
`verifiedAt` at 0 while in flight (a test written for a different reason).

### Owed before this can ship

1. A real sealed extraction against the live enclave, on a real device. Nothing in CI reproduces it.
2. The `.well-known` CORS spike re-run from a NATIVE build — the WebView origin differs from a
   browser's, and this was never verified there.
3. Deploy order is asymmetric and not enforced by anything but a comment: **Lambda first, always.**
