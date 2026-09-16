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

---

## Session 2 (2026-09-16, afternoon) — resume, close the defects, prove it live

> resume issue #49 for end to end encryption as intended in a new session with fresh context.
> take the time needed to properly reason through the approach and understand why the previous
> approaches have either failed or incorporated many issues. ask any questions as needed then
> proceeded as per /beanies-build-auto to fully implement and validate this functionality

Three decisions taken up front (AskUserQuestion): finish at code + the ai-extract Lambda applied
via terraform (no app deploy); close the grant byte-fence bypass by having both arms write a
measurement and dropping the `attribute_not_exists` escape; and fix structurally with a failing
test written before each fix, rather than patching and re-reviewing.

Later, unprompted: add the `different_size` metric filter, and apply the telemetry drift from the
wall session. Then: "is everything end to end encrypted now?" — answered no, and the four reasons.
Then: a judgement call on whether a third review was worth running.

### Outcome

**Gate 3's verification half is PROVEN LIVE.** A real sealed extraction succeeded against the live
enclave twice over: once through `scripts/spikes/sealed-extraction.mjs`, which mirrors
`managedProvider.run()` using the shipped prompt builder and fingerprint, and once through
`managedProvider.live.test.ts`, which calls the actual exported provider with nothing mocked. Only
the second proves the code we ship. The gate stays OPEN overall, because the legacy plaintext arm
still serves un-updated store builds.

**21 defects closed** — 5 carried from session 1, 15 from a `/code-review max`, and 1 I introduced
and caught myself. Two more rounds of review followed; each was fully triaged, nothing dropped.

### What this session was actually about

Every defect found, in both review rounds and in the acceptance-criteria audit, was one thing:
**an assertion structurally incapable of failing.** Four species, now written up in
`docs/lessons.md`:

1. The test mocks the thing under test — no test anywhere performed a real HPKE seal, which is how
   a 100%-broken feature shipped green.
2. The fixture never wires the dependency — the sealed arm's test block set no `RATE_TABLE` or
   `CORRECTION_GRANTS`, so the limiter, meter and grant store were no-ops. Deleting `srcBytes`
   left all 271 tests passing.
3. The parity test restates rather than imports — it compared a copy of the old hashing rule to
   the server while the shipped function used a different primitive.
4. The seam is the same function under two names — `__setRateLimitClientForTests` IS
   `__setDdbClientForTests`, so the meter's writes satisfied the limiter assertion.

⚠️ **And then I did it again.** Four of the guards written for round 1 were themselves vacuous,
including one written specifically to protect the retirement runbook: it matched the marker's prose
mention two lines after `begins` instead of the real marker 346 lines later, found 21 `return`
statements, and could never fail. The sharpest lesson of the day came out of fixing it:

> If a guard's only observable effect is the same outcome as its absence, no test written against
> that surface can distinguish them.

Inside `openSealed` every header rule produced the identical `malformed_output`. Four tests against
that error all passed with the whole policy reverted. Extracting it into a pure
`selectEhbpHeaders` gave each rule its own return value, and the same mutation then failed three
tests immediately. **Every fix after that point was mutation-tested before being claimed.**

### Verified in production, not asserted

Four live probes after each Lambda apply: sealed extraction; the shipped provider against the live
enclave; a legacy free correction on a 130-byte body (the exact shape a regression of mine broke);
and the deploy-window path, driven with a synthetic pre-#49 grant row. Meter rows read from real
DynamoDB — `charged 3 / corrected 3` for the legacy family, `charged 1 / corrected –` for the
deploy-window one, which is the promise exactly.

### Still owed

1. **The sealed bundle is not deployed.** Only the Lambda is. `app.beanies.family` has zero
   occurrences of `ehbp-1`, so every family is still on the legacy plaintext arm.
2. **No store build has ever run this code** — the native WebView path, especially the
   `.well-known` fetch from a `capacitor://` origin, has only ever run on greg's dev machine. The
   server half is de-risked (Tinfoil reflects any `Origin`, including `null`, and answers the
   preflight) but the client half is unobserved.
3. The update floor, once it ships.
