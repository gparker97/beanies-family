# ADR-035: Trading the text arm's provenance guarantee for rate limiting

> Status: Accepted
> Date: 2026-09-03
> Amends the text-source invariant of ADR-030 (its tier architecture, consent gate and
> zero-retention claims all stand unchanged).
> Plan + full 4-pass review record: `docs/plans/2026-09-02-plain-text-share.md`

## Context

The AI-extract proxy's `share` task has accepted two source kinds since #64: `images` and
`text`. The `text` arm was safe by **provenance** rather than by any limit, and the registry
said so:

> Images AND text. The text arm carries a page or video already fetched by content-fetch
> (behind its SSRF guard) — **never raw user input**, and never the bare URL.

That held because the only way to reach the text arm was for a user to share a **link**,
which `content-fetch` then resolved behind its SSRF guard and its own fetch budget. The
orchestrator enforced the other half: shared text with no URL in it hit a deliberate dead end
("No Link Found"), with a comment explaining why — routing bare text to the model "would turn
any app's share sheet into a general text→model endpoint on a soft-keyed proxy."

#83 is that feature. A parent gets a field-trip email with no PDF and no attachment: the
details **are** the message body. Refusing it is a real gap, and the fix is small — every
platform already delivers the text, and the extraction already exists.

But it removes the fence. The same field now carries arbitrary sender-supplied text from a
boundary **exported to every app on the device** (an Android intent filter, an iOS Share
Extension), authenticated only by a soft `x-api-key` that ships in the public bundle.

The proxy had **no per-family limit at all** — only a global API-Gateway route throttle
(burst 5 / rate 2) shared by every caller.

## Decision

**Trade the provenance guarantee for explicit abuse limits, and say so everywhere the old
guarantee was asserted.**

The text arm now accepts raw user input. In exchange it gains, in order of how much each
actually bounds the bill:

| Limit                | Where                              | Value            | Bypassable?                                  |
| -------------------- | ---------------------------------- | ---------------- | -------------------------------------------- |
| Reserved concurrency | Lambda                             | 10               | No — caps parallelism, not volume            |
| Per-family hourly    | DynamoDB, conditional `UpdateItem` | 80/hour          | Yes — `familyId` is client-supplied          |
| Per-IP hourly        | DynamoDB, same mechanism           | 120/hour         | Partly — `sourceIp`, never `x-forwarded-for` |
| Route throttle       | API Gateway (pre-existing)         | burst 5 / rate 2 | No                                           |
| Client budget        | `localStorage`                     | 20/hour/device   | Trivially — it is `localStorage`             |

Neither DynamoDB limit is authoritative. Family is the right unit for cost attribution and is
stable, but forgeable. IP catches exactly what family cannot — one attacker rotating family
ids — and is set higher because shared NAT legitimately puts many real families behind one
address. Either tripping refuses.

**Scope: text sources only.** The image path is bounded by its own size limits and
`AI_PICKER_MAX_BYTES`, has not changed, and has run under the route throttle since #133.
Widening the new limits to it is a strictly larger blast radius — it can break a working
reader — for no new risk in this change.

## What did NOT change, and is what makes the trade defensible

- **Prompt-injection defence already existed.** `buildUserMessage` wraps text in
  untrusted-content markers and instructs the model to ignore instructions inside it. No new
  prompt hardening was required — only a copy correction, because the fence description named
  the wrong sources.
- **The consent gate is unchanged and now names text.** Nothing leaves the device without the
  ADR-030 per-document prompt, and its copy was amended so what the user reads matches what
  is actually sent.
- **Nothing is persisted without review-modal confirmation.** The worst case for a hostile
  share is still one AI call and a form nobody confirms.
- **The `sources` fence stands.** `event` and `travel` remain images-only, so this is not a
  general text endpoint — it is one task that accepts text.
- **Size is bounded before anything is read.** The band is decided from `File.size` before
  decoding, so a hostile sender cannot make the client materialise a huge string. (Honest
  limit: on iOS the payload is already materialised natively up to `maxBytes = 25 MB` before
  JS sees a `File`, so this bounds the UTF-16 blow-up, not the native read.)

## Consequences

- **The fail-open posture is now a thing that must be watched.** `checkLimits` allows the
  request when DynamoDB is unreachable, because silently refusing would take down every
  extraction including the image path. That is only safe because somebody finds out: the
  fail-open log line has a metric filter and an alarm on the shared SNS topic.
- **A fixed hourly bucket, not a rolling window.** Worst case is 2× the limit across a bucket
  boundary. Accepted in exchange for the whole limit being one atomic `UpdateItem` with no
  read-modify-write and no race.
- **The IP hash is reversible** by anyone holding the table — 2^32 preimages. Accepted once,
  deliberately: the hash keeps raw addresses out of a stored key, and the only party who can
  read the table is the party holding the AWS account, who can already read far more.
- **The client budget is per DEVICE, not per family**, because it lives in `localStorage`. A
  two-parent, two-device household legitimately reaches 40, which is why the server's family
  limit is 80.
- **The client budget does NOT cover every text source, so "the client limit is always met
  first" is false.** It guards only the bare-text arm. The server limit is gated on `hasText`,
  which is equally true for a shared link's fetched page text and for an in-app recipe URL —
  neither of which consumes the client budget. A link-heavy family can therefore meet the
  server's blunter message without ever seeing the friendlier one. Recorded rather than
  papered over; budgeting the link path is a deliberate follow-up.
- **Three comments asserted the old guarantee and are now corrected** rather than left to rot:
  `extractionPrompt` (all three copies), `documentExtractionService.extractShareFromText`'s
  JSDoc, and `managedProvider`'s header — the last of which had already been corrected once in
  the other direction and is now stated precisely.
- **Deploy order is load-bearing and runs opposite to #64.** No new task or source is
  introduced, so a new bundle against the old Lambda extracts fine — but unthrottled. The
  Lambda ships first, is verified against real traffic, and only then does the client bundle
  follow. Step 1 immediately begins IP-throttling the already-live link path, whose
  `extractShareFromText` call is a text source; that is the point (real traffic to verify
  against) and also the risk to watch.
