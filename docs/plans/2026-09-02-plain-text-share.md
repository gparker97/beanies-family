# Plan: Read a plain-text share (no link, no file)

> Date: 2026-09-02
> Related issues: Notion tracker #83 (no GitHub issue — direct implementation)
> Plan file: `docs/plans/2026-09-02-plain-text-share.md`

> **No GitHub issue created.** This plan was approved for direct implementation. The full prompt history is embedded under `## Prompt Log`.

## User Story

As a parent, I want to select the details in an email or a class-group message and share them into beanies, so the activity, trip or recipe is captured without me retyping it or hunting for an attachment that does not exist.

## Context

A parent gets a field-trip email with no PDF and no attachment — the details **are** the message body. Today beanies cannot take it.

The gap is narrow and specific:

- **Android** already accepts `text/plain` (`AndroidManifest.xml`) and the **PWA** already accepts a `text` param.
- **iOS already handles plain text too.** `ShareViewController.swift:610` iterates `[.image, .pdf, .url, .plainText]` and writes a shared string verbatim as a `.txt` into the app-group inbox. What stops it appearing in the sheet is only the `NSExtensionActivationRule` in `Info.plist`, which declares Image / File / Attachment / WebURL and omits text.
- **The orchestrator refuses it.** `useSharedDocumentIngest.ts` extracts URLs from shared text; finding none it toasts "no link found" and returns `null`. The comment there is explicit: routing bare text to the model "would turn any app's share sheet into a general text→model endpoint on a soft-keyed proxy."
- **The extraction already exists.** `extractShareFromText(text, opts)` is called today on `resolved.text` from a fetched page, reachable only when a link resolves.

So this adds a **new source to an existing router**, not a new routing concept. `classify()` already switches on the model's own `event | travel | recipe | none` verdict.

### The load-bearing discovery

The Lambda **already accepts text for the `share` task**: `EXTRACTION_TASKS.share` declares `sources: ['images', 'text']` and the handler validates it against `MAX_TEXT_CHARS = 32_000`. **No wire-format change is needed for text to flow.**

But the comment on that declaration states the invariant this feature breaks:

> Images AND text. The text arm carries a page or video already fetched by content-fetch (behind its SSRF guard) — **never raw user input**, and never the bare URL.

Today the text arm is safe because the text provably came from our own SSRF-guarded, rate-limited fetcher. This feature removes that provenance guarantee: the same field will carry arbitrary sender-supplied text from an **exported share boundary reachable by every app on the device**, authenticated only by a soft `x-api-key` that ships in the public bundle.

The abuse limits are therefore not hardening bolted onto a feature — they are what replaces the fence being removed. The proxy today has **no per-family limit at all**, only a global route throttle (burst 5 / rate 2) shared by every caller, as `managedProvider.ts:1-9` records after an earlier comment overstated it.

**Good news the security work can lean on:** prompt-injection defence already exists. `extractionPrompt.mjs:102` wraps text in untrusted-content markers and instructs the model to ignore embedded instructions. No new prompt hardening is required — only a copy correction (§7).

## Requirements

1. **Accept a text share carrying no URL** — route it into the existing share extraction instead of the "no link found" dead end.
2. **Register iOS for text**, so beanies appears in the share sheet for a text selection.
3. **Preserve the existing precedence exactly.** Files win over text. An unreadable file beside a caption is still a _file_ problem. A link inside shared text still wins.
4. **Client-side abuse limit:** a per-family, **per-device** cap over a rolling window (it is `localStorage`), refused loudly with a message that says when it resets.
5. **Server-side per-family and per-IP throttle on `POST /ai-extract`**, since the client cap is bypassable by construction.
6. **Size policy:** read up to 4,000 chars; refuse above a hard ceiling; between the two, truncate **and say so**.
7. **Bound the decode**, so a hostile sender cannot make beanies materialise a huge payload.
8. **Treat shared text as untrusted third-party input end to end.** Nothing persisted without review-modal confirmation; no raw shared text in telemetry.
9. **Observability:** the text funnel is separable in CloudWatch from the file and link funnels, and every refusal emits a distinct, countable outcome — including the success path.

## Important Notes & Caveats

- **The `share` task already declares `sources: ['images','text']`.** Do not "add" it. The server work is the throttle plus **correcting the invariant comment** — shipping raw user input while the comment says "never raw user input" is worse than no comment.
- **Deploy order is load-bearing, runs opposite to #64, and has THREE steps.** No new task or source is introduced, so a new bundle against the old Lambda still extracts fine — but **unthrottled**. So:
  1. **Server only** — Lambda + `rateLimit.mjs` + table + IAM + alarm. No client change; `familyId` is absent, so the IP limit alone applies (the additive wire contract below is what makes this safe).
  2. **Verify in prod against real traffic** before any user-visible change. Step 1 is the only piece introducing new _stateful_ AWS infrastructure into the request path of a feature already working in production, so a fail-open bug, an IAM gap or a table misconfiguration is observed — and rolled back independently — while nothing user-facing has moved. ⚠️ **Note what step 1 actually touches:** "text sources only" means it immediately starts IP-throttling the **already-live link-share path**, whose `extractShareFromText` call is a text source. That is the point (real traffic to verify against) but also a real risk — a CGNAT'd mobile carrier or a school network could trip the 120/hour IP limit on a working feature. **The first thing step 2 checks is the IP-limit counter against the `share triaged detail=link` rate.**
  3. **Client bundle.**
- **The wire contract must stay additive in both directions.** A new Lambda receiving no `familyId` from an old cached bundle **falls back to the IP limit, never 400**.
- **`managedProvider.ts:1-9` must be re-corrected.** It says there is no per-family limit "and never has been". That becomes false. It has been wrong optimistically once; do not leave it wrong pessimistically now.
- **The ceiling is a client-side refusal band, not a wire bound.** `MAX_SHARE_TEXT_CEILING` is deliberately equal to the Lambda's `MAX_TEXT_CHARS` (32,000), but since the client truncates to 4,000 before sending, the ceiling never governs a request body. Do not later "reconcile" the two constants or raise one to match the other — they answer different questions.
- **Truncation can sever a URL.** The existing cap-then-`extractUrls` order already accepts this; do not change that order.
- **`prepare()` is not called from a component `setup()`.** `useShareTargets.ts:26` invokes `ingestSharedContent` from an adapter callback. Anything with a Vue lifecycle hook (`onBeforeUnmount`) called on that path warns and leaks. This is why §4 uses a plain module, not a composable.
- **iOS text arrives as a FILE, not as `content.text`** (the extension writes a `.txt`), so it lands on the `textFromFile` path — which is why the size band must be decided from `File.size` (§3).

## Assumptions

> **Review these before implementation.** These were valid at planning time but may have changed.

1. The Lambda's `MAX_TEXT_CHARS` is still `32_000` (`index.mjs:48`) and `EXTRACTION_TASKS.share.sources` still includes `'text'`. The client ceiling is set **equal** to it, not below.
2. Android still declares `text/plain` and the PWA manifest still declares a `text` share param.
3. `extractShareFromText` still takes `(text, opts)` and returns the same `{ success, data, errorCode, truncated }` shape the documents path uses.
4. `family.id` is still a random UUID (`src/utils/diagnosticContext.ts:44-48` documents it as PII-free for this reason). This underpins §5: it is why sending it raw to our own proxy is consistent with what telemetry already does.
5. The API Gateway route throttle (burst 5 / rate 2) remains and is **not** removed — the new limits layer on top, and it is the backstop when the rate store is unavailable.
6. No DynamoDB table exists for AI-proxy rate state; this plan creates one.

## Approach

### 1. Client — a third `ShareSource`

`ShareSource` today is `{ kind: 'documents'; files } | { kind: 'link'; url }`. Add `| { kind: 'text'; text: string; truncated: boolean }`.

In `prepare()`, change **only the final fallback** of the existing `if (text) { … }` block. The URL-found path is untouched, so precedence is preserved by construction:

```
if (text) {
  <existing cap + extractUrls + routeUrl — UNCHANGED>
  if (url) return { kind: 'link', url };          // unchanged
  → NEW: length bands → quota PEEK → { kind: 'text', text, truncated }
}
```

The file-precedence guard above (`content.files.length > 0 && !textFromFile`) is **not touched**. The new branch is strictly _downstream_ of every existing decision — that is the change's most important structural property.

In `read()`, the text source needs no new orchestration: it calls the same `extractShareFromText(source.text, opts)` the `resolved.kind === 'text'` link branch already calls, and hands the result to the same `classify()`. **Extract the shared tail** (extract → on failure log + `reportExtractionFailure` → on success `classify`) into one local helper used by both arms.

> **Do not pass `truncated` into `classify`'s `env`.** The link/document arms set `env.truncated`, and every review surface (`useRecipeCapture.ts:143`, `useDocumentToTravel.ts:107`, `useDocumentToActivity.ts:86`) renders `ai.pdfTruncated.*` from it — copy that talks about _pages_. The text arm shows its own toast in the orchestrator and must leave `env.truncated` unset, or the user gets two notices, one about pages that do not exist.

### 2. Size policy — three bands

| Band     | Bound                                         | Behaviour                                |
| -------- | --------------------------------------------- | ---------------------------------------- |
| Read     | ≤ `MAX_SHARE_TEXT_CHARS` (4,000)              | Read in full. Unchanged.                 |
| Truncate | 4,000 < n ≤ `MAX_SHARE_TEXT_CEILING` (32,000) | Truncate to 4,000 and **tell the user**. |
| Refuse   | > `MAX_SHARE_TEXT_CEILING`                    | Refuse outright. **No AI call.**         |

`MAX_SHARE_TEXT_CEILING` and `MIN_SHARE_TEXT_CHARS` live in `src/services/share/types.ts` beside `MAX_SHARE_TEXT_CHARS`, so the whole text-size policy is one place.

**`MIN_SHARE_TEXT_CHARS = 25`, measured after `trim()`** (otherwise 30 spaces passes). Refused without an AI call — a couple of words cannot yield a date, time and title, and paying the model to discover that is pure cost.

**Which string the bands are measured on — state it, or two bands become unreachable.** `prepare()` already computes `const capped = text.slice(0, MAX_SHARE_TEXT_CHARS)` at `useSharedDocumentIngest.ts:284` for URL extraction. `capped` is ≤4,000 by construction, so band logic reading `capped.length` could **never** see `over_ceiling` or the truncate band. Bands are decided from **`text.trim().length` on the original string**; `capped` remains used only for `extractUrls`.

**Grapheme-safe truncation.** `slice` cuts UTF-16 code units and can split a surrogate pair into `U+FFFD`. `src/utils/sanitiseFilename.ts:52-54` already solves this with `.replace(/[\uD800-\uDBFF]$/, '')`. Reuse that idiom in a shared `boundText(text, max)` in **`src/utils/`** (it is not share-specific), with a comment cross-referencing `sanitiseFilename.ts:52` so the two cannot drift.

### 3. Bounding the decode

Two paths, and the file path is the one that matters:

**File path (`.txt`, which is how EVERY iOS text share arrives).** `useSharedDocumentIngest.ts:226` currently reads `await textFile.slice(0, MAX_SHARE_TEXT_CHARS * 4).text()`. A 50,000-char iOS share is therefore reduced to ≤4,000 chars _before any band logic sees it_ — it could never be classified `over_ceiling`, and would look like an ordinary under-cap share. That is exactly the "silently reads the first slice of a wall of text" behaviour requirement 6 forbids.

Decide the band from `File.size` **before decoding** — simpler and a stronger bound than any native mirror:

```
const overCeiling = textFile.size > MAX_SHARE_TEXT_BYTES;
text = await textFile
  .slice(0, overCeiling ? MAX_SHARE_TEXT_CHARS * 4 : MAX_SHARE_TEXT_BYTES)
  .text();
textFromFile = true;
```

**The byte gate sets a FLAG, it does not return.** An early return would contradict Requirement 3 and its own acceptance criterion: iOS delivers a shared URL as a `.txt`, and a mail-app selection can exceed the byte bound, so returning `over_ceiling` before decoding would refuse a `.txt` that begins with a link where today it takes the link path. Instead let the existing cap → `extractUrls` → `routeUrl` run exactly as today (it only ever sees ≤4,000 chars), and apply `over_ceiling` **only in the no-URL fallback**. Worst-case decode in the hostile case drops from 128 KB to 16 KB, which is strictly better than the early return anyway.

UTF-8 is ≤4 bytes/char, so `bytes > 4·CEILING ⇒ chars > CEILING`. The `+1` lets JS distinguish "at the ceiling" from "clipped at the ceiling". The `slice` in the non-over-ceiling arm is **belt-and-braces against a lying `File.size`**, not a working bound — the two numbers are equal, so it never clips a file that is actually used and can never produce a `U+FFFD` from a split UTF-8 sequence. Kept deliberately; do not remove it as dead, and do not describe it as the bound. This extends the existing `MAX_SHARE_TEXT_CHARS * 4` idiom at line 224 rather than adding a parallel one.

**Define the bound once.** `MAX_SHARE_TEXT_BYTES = (MAX_SHARE_TEXT_CEILING + 1) * 4` goes in `src/services/share/types.ts` beside the other two constants, carrying the UTF-8-worst-case comment currently inline at `useSharedDocumentIngest.ts:221-224`. Both call sites and the Android mirror comment reference it, rather than three hand-written copies of `* 4`.

**Stale comments this change makes false — correct all of them.** Shipping them wrong is the same failure the plan calls out for `managedProvider.ts:1-9`:

| File                                                    | What is now false                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/services/ai/documentExtractionService.ts:311-318`  | `extractShareFromText`'s JSDoc: "The text comes from `content-fetch` … behind its SSRF guard — **never a raw user string**". This is the **client-side** copy of the invariant, on the very function the new arm calls — the comment an implementer is most likely to read and trust. |
| `src/services/share/types.ts:26-33`                     | "`ShareIntentPlugin.java` mirrors this value" — Java will mirror `CEILING + 1`, not `MAX_SHARE_TEXT_CHARS`.                                                                                                                                                                           |
| `android/.../ShareIntentPlugin.java:75,81`              | Both say the cap mirrors `MAX_SHARE_TEXT_CHARS`.                                                                                                                                                                                                                                      |
| `useSharedDocumentIngest.ts:308-311`                    | The "deliberately a toast, NOT a `share`-task call on the bare text" comment sits above the code being deleted. **Replace it**, do not leave it above the new branch.                                                                                                                 |
| `infrastructure/lambda/ai-extract/extractionPrompt.mjs` | The `sources` invariant comment, and `buildUserMessage`'s "untrusted content from a web page or video" at line 102 — **see the blocking note below**.                                                                                                                                 |
| `ios/App/ShareExtension/Info.plist`                     | Its header says the activation rule allows "only images and PDFs, and a bounded count". Adding text makes that false.                                                                                                                                                                 |

> ⚠️ **BLOCKING — the prompt string exists in THREE files and a test compares them.** `src/services/ai/__tests__/extractionPromptDrift.test.ts` compares the _built messages_ across all three with `toEqual`, using a `text`-kind fixture. Changing one fails CI immediately. All three must change **byte-identically**:
>
> - `infrastructure/lambda/ai-extract/extractionPrompt.mjs:102`
> - `src/services/ai/extractionPrompt.ts:136`
> - `scripts/spikes/extractionPrompt.mjs`
>
> All three also carry `PROMPT_VERSION = '2026-08-26.2'` and headers instructing a bump on **any** change — so bump all three together. Keep the edit **minimal** (e.g. "…from a web page, a video, or text a person shared"), since it alters the prompt for the already-shipped link/recipe path. The server builds the message, so this lands in **deploy step 1** with the Lambda.

**Android.** `ShareIntentPlugin.java:82,179` clips at 4,000. Raise its mirror to `CEILING + 1` (32,001) and stop there — **no new bridge field**.

_Why no surrogate trim is needed on the Java side_, written down so the next reviewer does not "fix" it and introduce a second, drifting truncation rule: `substring(0, 32001)` can leave a lone trailing surrogate, but only when the source **exceeded** 32,001 — at which point JS sees `length === 32001 > CEILING` and refuses the share outright, so the malformed tail is never rendered or sent. JS then has one band-decision site (`length > CEILING ⇒ over_ceiling`), identical on all three platforms, with no second source of truth about what the bands mean.

**iOS Swift and the PWA need no decode change** — iOS goes through the file path above; the PWA's `text` param is already materialised by the browser, so the JS ceiling check is the only available bound.

**Be precise about what Requirement 7 actually buys on iOS.** `ios/App/App/ShareIntentPlugin.swift:99-108` reads the whole file with `Data(contentsOf:)` and base64-encodes it across the bridge, bounded only by the pre-existing `maxBytes = 25 * 1024 * 1024` (line 45). So the payload IS materialised natively before JS sees a `File`. The byte gate still earns its place — it avoids turning 25 MB into a ~50 MB UTF-16 string — but "cannot make beanies materialise a huge payload" is true only up to that 25 MB native cap. Say so; the plan's honesty standard elsewhere demands it.

Related and worth naming rather than discovering on device: a `.txt` above 25 MB is silently skipped by the Swift `continue`, and the iOS adapter reports no `offered` count, so it surfaces as the generic `unsupported` toast rather than a size message. Pre-existing, out of scope here.

### 4. Client-side quota — a plain module, standalone

A rate limiter with persistence, storage guards and telemetry already exists: `src/composables/usePinAttemptLimit.ts` (extracted 2026-09-02). **It is deliberately NOT reused or refactored here.** Three reasons, in order of weight:

1. **Its persistence rule is wrong for a budget.** `persist()` (lines 60-73) writes an entry **only if `state.lockedUntil > Date.now()`** — only a live cooldown survives a reload. A share budget of 19 used attempts with no active cooldown has `lockedUntil === 0` and would therefore never be persisted, so reloading hands back a fresh 20. That is precisely the bypass the client cap exists to slow, and it would ship **silently green**, because `usePinAttemptLimit`'s suite does not exercise it.
2. **The two share almost no data shape.** PIN stores `{ failures, lockedUntil }` and clears the scope wholesale on success. Share needs a timestamp list to produce `resetsAt`, and has no "success clears it" concept. Unifying yields a `policy` object where each caller uses a different half of the fields and a persistence rule that branches on which caller it is — a premature abstraction.
3. **Blast radius.** `usePinAttemptLimit` is the brute-force control on the step-up challenge its own header calls "the actual security boundary of #80", guarding transfer-ownership, remove-member and clear-all-data. Coupling it to a text-share cost control means a future quota tweak can regress a security control. A suite passing unchanged proves the wrapper API is intact; it does not prove shared persistence rules still hold for both policies.

**So: build `src/utils/attemptBudget.ts` standalone (~60 lines), and leave `usePinAttemptLimit.ts` untouched.** The duplication is a `try/catch` around `localStorage` — cheap, and honest. Recorded as accepted duplication with a follow-up to fold PIN onto it _once the share policy has settled in production_, which is the point at which the right shared shape is knowable rather than guessed.

It must also be a plain module, not a composable: `prepare()` runs inside an adapter callback (`useShareTargets.ts:26`), not a component `setup()`. Anything with `onBeforeUnmount` there warns _and permanently leaks_ the refcounted ticker.

Exports: `peekAttempt(key, policy)` and `consumeAttempt(key, policy)`, both returning the narrowing union `{ ok: true } | { ok: false; reason: 'quota'; resetsAt: number }`, plus `clearAttempts(key)` and `__resetAttemptBudgetForTests()`. Storing **timestamps** rather than a count is what lets the refusal name `resetsAt`.

Three details that must be specified, not left to the implementer:

- **Key format: `share-text:<familyId>`** — so switching families cannot inherit a budget (the same reasoning `usePinAttemptLimit`'s `scope` doc gives). It embeds a family id, so like `scope` it is **NEVER logged**; the firehose context is allowlisted.
- **Storage key constant: `beanies_share_budget`**, matching `beanies_pin_attempts`.
- **Pruning, on every write:** drop timestamps outside the window, drop keys left with none, and `removeItem` when the map empties. `usePinAttemptLimit.persist()` bounds its blob by only writing live cooldowns; `attemptBudget` has no equivalent, so without this the blob grows on a long-lived install. Reason #1 for not reusing the PIN module was a persistence rule that was wrong for a budget — this must not repeat the omission in the other direction.

```
SHARE_TEXT_BUDGET = { max: 20, windowMs: 60 * 60_000 }
```

**No cooldown.** 20/hour comfortably covers a parent working through an inbox in one sitting (realistic intense use is 5–10). A separate cooldown was considered and cut: its stated purpose (defeating a scripted loop) is already served by `isIngesting` (`useSharedDocumentIngest.ts:75`), which serialises shares module-wide and refuses a concurrent one audibly, plus the route throttle and the two server limits. The feature would otherwise carry **five** overlapping limits, each a copy string, a telemetry value, a test, and something to explain in a support conversation — and the cooldown had the weakest independent justification.

**Peek in `prepare()`, consume in `read()`.** Consent runs _after_ `prepare`, so checking-and-consuming in `prepare` would burn a share when the user _declines_ consent. Peek early (refuse cheaply, before consent, with the right message); consume immediately before `extractShareFromText`, i.e. only when an AI call is actually made.

**Managed tier only.** The budget applies when `tier === 'managed'`. A BYOK user pays for their own key and the server throttle does not apply to them, so a client cap would be us rationing someone else's quota for no benefit.

### 5. Server-side throttle — the part that bounds the bill

**Keyed on BOTH family and IP, as two independent limits, neither authoritative.**

- **Family** is the right unit for cost attribution and is stable, but client-supplied and forgeable. _Primary_ limit, generous.
- **IP** catches exactly what family cannot: an attacker rotating family ids. _Secondary_ backstop, set higher, because shared NAT legitimately puts many families behind one address.

Either limit tripping refuses the request.

**Identifiers: ONE mechanism, applied at the Lambda.** The client sends `familyId` raw, and `rateLimit.mjs` derives both keys with a plain `sha256` — **no HMAC, no secret.**

An HMAC was considered and dropped: `hashicorp/random` is **not** a declared provider anywhere in `infrastructure/` (`main.tf:4-10` and `modules/ai-extract/main.tf:2-7` declare only `hashicorp/aws ~> 5.0`), so `random_password` would add a provider to two `required_providers` blocks, a new CI provider download, **and the secret into Terraform state** — in exchange for hiding an IPv4 from the only party who can read the table, which is the party holding the AWS account, who can already read far more. It buys nothing against that threat model and costs a rotation story. Plain `sha256` for both, stated once.

**The IP is `event.requestContext.http.sourceIp`** (API Gateway HTTP API payload v2). **`x-forwarded-for` is deliberately NOT used** — it is caller-controlled, and an attacker rotating that header would defeat the IP limit entirely. This is the single most bypassable detail in this section; do not "improve" it by falling back to the header.

An earlier draft had the client send `SHA-256(familyId)`. Rejected, for four reasons:

- **The stated benefit does not exist.** The shared HTTP API configures no `access_log_settings` (`modules/registry/main.tf`), and `index.mjs` logs only `[ai-extract] ok task=… enclave=…` — the request body never reaches CloudWatch. There is no request-log surface for the raw id to land in.
- **It would be inconsistent with what we already do.** `src/utils/diagnosticContext.ts` ships `family_id` **raw** to our own telemetry Lambda in the same account, documented as PII-free precisely because it is a random UUID. Hashing it for one endpoint while shipping it raw to another is an asymmetry every future maintainer has to re-derive.
- **Two derivation mechanisms can drift**, and the client hash has no rotation story at all.
- **It costs support.** A client-side hash means that when a family reports "beanies says I've shared too much", nobody can correlate — the id never arrives. Hashing at the Lambda keeps that possible, because we still receive the id we already hold everywhere else.

(The IP's preimage space is enumerable at 2^32, so its `sha256` is reversible by anyone holding the table — accepted above, deliberately and once.)

**Window: fixed hourly bucket, not rolling.** A conditional `UpdateItem` returning a counter is inherently a fixed window; making it truly rolling needs per-key timestamp lists, a read-modify-write and a race. Embed the bucket in the key (`f#<hash>#<floor(now/3600)>`), one atomic `UpdateItem` with `ADD n :1` and `ConditionExpression attribute_not_exists(n) OR n < :max`, TTL set at write, `retryAfterSeconds = secondsToBucketEnd`. **Honest trade: worst case 2× the limit across a bucket boundary.** No `Query`, no GSI, no item lists.

**Storage:** new `beanies-ai-rate-{env}` DynamoDB table, `hash_key = "pk"`, `PAY_PER_REQUEST`, **TTL enabled** so windows reap themselves.

**Limits:** family **80 / hour**; IP **120 / hour** (generous enough for a shared NAT with several real families).

**Why 80 and not 40.** The client budget is `localStorage` — **per device, not per family**. A two-parent, two-device household legitimately has 20 + 20 = 40, which would hit a 40/hour server limit exactly and surface the harsher server message instead of the friendly client one. 80 keeps the intended property — a legitimate family always meets the _client_ limit first — for a household of up to four active devices.

**On DynamoDB failure: fail open, log loud.** Silently allowing is a silent failure; silently refusing takes down every extraction including the image path. On any store error:

```
console.error('[ai-extract] rate-limit store unavailable — allowing the request. Check the
  beanies-ai-rate-{env} table and the Lambda dynamodb:UpdateItem permission.', err)
```

…then proceed. A CloudWatch metric-filter alarm on that line is wanted — but **`modules/ai-extract` has no alarms and no SNS topic**, and the repo's only `aws_sns_topic "alerts"` is defined _inside_ `modules/content-fetch/main.tf:166` (with its email subscription and Slack forwarder) and is not exported. So the alarm needs plumbing, not just a resource:

- `modules/content-fetch/outputs.tf` — new `output "alerts_topic_arn"` (it currently exports only `content_fetch_url`)
- `modules/ai-extract/variables.tf` — new `variable "alerts_topic_arn"` (default `""`)
- `infrastructure/main.tf:156` — pass `alerts_topic_arn = module.content_fetch.alerts_topic_arn`
- Gate the alarm on `count = var.alerts_topic_arn == "" ? 0 : 1`, mirroring the existing "a self-hoster without an address still gets a working apply" reasoning at `modules/content-fetch/main.tf:150-165`

Reusing the topic rather than creating a second one avoids a second email confirmation and a second Slack forwarder; note the resulting module ordering (ai_extract now depends on content_fetch).

Fail-open is acceptable _because_ the route throttle (burst 5 / rate 2) remains as backstop.

**Scope: text sources only, initially.** The image path is bounded by its own size and `AI_PICKER_MAX_BYTES`, has not changed, and has run under the route throttle since #133. Widening to images is a strictly larger blast radius (it can break the working reader) for no new risk in _this_ change. A deliberate follow-up, not smuggled in.

**Testability seam and contract.** `test:lambda` runs `node --test`, and there is no `aws-sdk-client-mock`. Put the limiter in its own `infrastructure/lambda/ai-extract/rateLimit.mjs` exporting `checkLimits({ familyId, ip, now, ddb })` with the client **injectable**, so a stub can be passed. `archive_file` uses `source_dir` (`modules/ai-extract/main.tf:60`), so the new module ships automatically — note it already ships `__tests__/` too, which is pre-existing and harmless.

Its contract, stated so the handler stays flat:

- **`checkLimits` NEVER throws.** It owns its own `try/catch` and fails open internally, returning `{ allowed: true, degraded: true }`. `index.mjs` therefore gains exactly one `if`, no nested try/catch — the handler's validation section is already ~70 lines of flat guards and keeping it flat is why it is readable.
- Return type: `{ allowed: true, degraded?: boolean } | { allowed: false, limit: 'family' | 'ip', retryAfterSeconds: number }`.
- **When `RATE_TABLE` is unset it returns `allowed: true` immediately and logs nothing.** Without this, the existing 386-line `handler.test.mjs` (every case a POST) starts attempting a real DynamoDB call per test, and any non-prod deploy silently depends on credentials it does not need.
- **Both identifiers missing ⇒ `allowed: true`.** `handler.test.mjs`'s `makeEvent()` builds `requestContext: { http: { method } }` with no `sourceIp`, so this is the shape the existing suite actually sends.
- **Lazy-load the SDK.** There is no bundling step — `archive_file` (`modules/ai-extract/main.tf:57-61`) zips the source dir and `@aws-sdk/client-dynamodb` resolves from the nodejs20.x runtime (the pattern `infrastructure/lambda/registry/index.mjs:7` already uses). A static top-level import would add SDK init to **every** cold start, including the image path this feature explicitly does not touch. `await import(...)` inside `checkLimits`, _after_ the `RATE_TABLE`-unset early return, cached at module scope. (Note: the runtime-provided SDK is a nodejs20.x guarantee AWS has signalled it will drop; a runtime bump means vendoring, same as registry.)

**Where the call goes in `index.mjs`:** after the `x-api-key` check (so an unauthenticated flood costs no DynamoDB writes), after body/JSON/task/text validation and the `todayIso` guard, **before** the `try {` wrapping the upstream call, and gated on `hasText` (per "text sources only"). A malformed request therefore never consumes budget.

**The 429 shape:** `response(429, { error: …, code: 'rate_limited', retryAfterSeconds }, event)` — via `response()` so `getHeaders()`' CORS headers are present, which an API-Gateway-generated 429 would not be.

**`reserved_concurrent_executions`** is genuinely absent (`modules/ai-extract/main.tf:64-93` sets only `timeout` and `memory_size`). Add it with a new `variable "reserved_concurrency"`, per the reasoning `modules/content-fetch/main.tf` documents: concurrency caps parallelism, the throttle caps volume, only the second bounds the bill.

**Do not copy content-fetch's default of 5.** That Lambda has `timeout = 15`; `ai-extract` has `timeout = 29` (`modules/ai-extract/main.tf:72`) and each invocation can hold a slot for the full 29s, so 5 would mean at most five simultaneous extractions across all families — a plausible weekday-evening ceiling on the **already-shipped image path**. Start at **10**, and note the asymmetry: lowering this throttles a working feature, whereas the DynamoDB limits throttle only abuse.

**Wire plumbing (currently missing end to end):** `ExtractionRequest` carries only `source`/`todayIso`/`signal`, and `postToProxy` sends only the source, `todayIso` and `task`.

`familyId` is a caller-supplied request attribute, exactly like `todayIso` — **not** something the AI layer fetches. `grep -rn "from '@/stores/" src/services/ai/` returns nothing: that layer is deliberately store-free, and `documentExtractionService.ts:1-14` states its contract as a pure funnel ("only the compressed document leaves the device, never the family dataset"). Calling `useFamilyStore()` there would make every existing test in `src/services/ai/__tests__/` require a Pinia instance and put app state into the one AI module that has none.

So: add `familyId?: string` to `ExtractOptions` (`documentExtractionService.ts:51-68`), populate it where the other per-call context is already assembled — `useSharedDocumentIngest.ts:352-357`, which builds `opts` with `tier`/`todayIso`/`byok`/`grant` — and copy it onto `ExtractionRequest` in `runWithSource` beside `todayIso`. Optional, so the three other wedge composables need no change, and the service still imports no store.

### 6. iOS registration

`ios/App/ShareExtension/Info.plist` — add `<key>NSExtensionActivationSupportsText</key><true/>` to the `NSExtensionActivationRule` dictionary. Note it is a **boolean**, not a `…WithMaxCount` integer like the four existing keys. Its header comment ("only images and PDFs, and a bounded count") becomes false — correct it, per the stale-comment table in §3. **That is the whole iOS change.** The extension's `.plainText` branch already exists and writes the string as a `.txt`, which `ShareIntentPlugin` maps to `text/plain` and the orchestrator picks up on the `textFromFile` path.

### 7. Copy

All strings go through `uiStrings.ts` with both `en` and `beanie`, per the CI-enforced i18n rule. Interpolation uses `fillTemplate` from `@/utils/fillTemplate` (`t()` takes a key only).

**New keys:** `shareTarget.text.tooShort.*`, `shareTarget.text.tooLong.*`, `shareTarget.text.truncated.*`, `shareTarget.text.quota.*` (`{resetsAt}`), and one pair for the `rate_limited` toast. (No cooldown key — the cooldown was cut in §4.)

**Retire `shareTarget.noLink.*`** — its only reason for existing was the dead end being removed. Its sole production consumer is `useSharedDocumentIngest.ts:318`.

**Amend the consent gate — to ONE source-neutral wording.** `ai.consent.intro` and `ai.consent.whatValue` (`uiStrings.ts:8972-8983`) say "this photo or document" / "Only this one photo or document". A text share sends the user's selected text, so the gate they actually read must say so. Amend both existing strings (`en` + `beanie`) to cover every source ("this photo, document or selected text").

⚠️ **`ai.consent.introLink` must remain a verbatim substring of `ai.consent.intro`.** `uiStrings.ts:8968-8977` documents this and `DocumentExtractConsentModal.vue:54` relies on it — `splitAroundAccent(t('ai.consent.intro'), t('ai.consent.introLink'))` locates "secure, private" inside the sentence. Amend `intro` without preserving that exact substring, in **both** `en` and `beanie`, and the privacy link silently disappears.

**Five strings say "photo or document", not two.** Decide once whether "document" reads as source-neutral; if not, all of these are in scope: `ai.consent.intro` (8972), `ai.consent.whatValue` (8983), `ai.consent.whereManaged` (8990), `ai.consent.afterValue` (9001), `settings.ai.askBeforePhotosHint` (9032).

**No conditional copy, and no second modal.** The natural implementation is "branch the consent copy on share kind", which is a modal that grows a case per future source. `useExtractionErrorToast.ts:16-21` already documents this as the COPY RULE, after the recipe reader surfaced photo-specific wording on the cookbook.

**The same claim is repeated in the in-app help.** `src/content/help/security.ts:650, 668, 682, 700, 727` all say "only the one photo or document you chose" — the file the Help Center skill actually maintains. Update it with the consent copy. Also check `web/src/pages/privacy.astro`.

**Correct two server-side comments** that become false: the `sources` invariant in `extractionPrompt.mjs`, and `buildUserMessage`'s "untrusted content from a web page or video" at `extractionPrompt.mjs:102`.

### 8. `rate_limited` must not page Slack

`useExtractionErrorToast.ts` has a `default:` arm that shows the generic error toast **with `{ surface: ERROR_SURFACE }`**, which fires the error reporter. An expected, intentional 429 falling through it would alarm `#beanies-errors` on every refusal.

Add `case 'rate_limited':` → `showToast('info', …)` with **no** error surface, the same treatment the file already gives `fetch_blocked` / `upstream_busy`. In `managedProvider`, follow the existing `unknown_task` precedent: a `console.error` naming the limit and `retryAfterSeconds` for developers before throwing. Do **not** widen `ShareExtractionResult`/`DocumentExtractionResult` to carry `retryAfterSeconds` — the console line is the developer channel, the toast copy is generic.

**Match on `res.status === 429` as well as `code === 'rate_limited'`, and fix a pre-existing bug for free.** The **existing** API Gateway route throttle (burst 5 / rate 2, `modules/registry/main.tf:198-202`) already returns a bare 429 with `{"message":"Too Many Requests"}` and **no `code`** — which today falls through to `provider_error` and is reported by the `default:` arm **with `{ surface: ERROR_SURFACE }`**, i.e. it already pages `#beanies-errors` whenever two families extract at once. Matching on the status is strictly more robust and closes that existing noise.

One caveat to record so nobody chases it later: an API-Gateway-generated 429 carries no CORS headers, so from a browser it surfaces as a network error and classifies as `provider_error` regardless. Our own Lambda 429 goes through `response()` and does carry them.

## Files Affected

**Client**

- `src/composables/useSharedDocumentIngest.ts` — third `ShareSource` arm; `File.size` band decision; new fallback in `prepare()`; shared extract→classify tail in `read()`; widen `logReceivedKind`
- `src/services/share/types.ts` — `MAX_SHARE_TEXT_CEILING`, `MIN_SHARE_TEXT_CHARS`, `MAX_SHARE_TEXT_BYTES`; correct the "mirrors this value" comment (lines 26-33)
- `src/utils/attemptBudget.ts` — **new**, standalone (`usePinAttemptLimit.ts` is deliberately NOT touched — see §4)
- `src/utils/boundText.ts` — **new**
- `src/composables/useExtractionErrorToast.ts` — `rate_limited` info toast
- `src/services/translation/uiStrings.ts` — new keys; retire `shareTarget.noLink.*`; amend the consent strings (preserving the `introLink` substring)
- `src/content/help/security.ts` — the "only the one photo or document you chose" claim at 650, 668, 682, 700, 727
- `src/services/ai/types.ts` — `rate_limited` code; `ExtractionRequest.familyId?`
- `src/services/ai/documentExtractionService.ts` — `ExtractOptions.familyId?`, copied onto the request in `runWithSource`; **correct `extractShareFromText`'s JSDoc invariant (lines 311-318)**
- `src/services/ai/providers/managedProvider.ts` — send `familyId`; map 429 (by `code` **and** status); re-correct the rate-limit comment. The `postToProxy` body literal (~lines 72-79) is the **frozen wire format**: `familyId` is an _added_ field beside `todayIso`, never a rename. The comment there already says exactly this — leave it intact.

**Native**

- `ios/App/ShareExtension/Info.plist` — `NSExtensionActivationSupportsText` _(the only iOS change)_
- `android/app/src/main/java/family/beanies/app/ShareIntentPlugin.java` — raise the cap to `CEILING + 1`

**Server**

- `infrastructure/lambda/ai-extract/rateLimit.mjs` — **new**, injectable `checkLimits`
- `infrastructure/lambda/ai-extract/index.mjs` — call it; 429 + `rate_limited`
- `infrastructure/lambda/ai-extract/extractionPrompt.mjs` — correct the `sources` invariant comment and the `buildUserMessage` copy; bump `PROMPT_VERSION`
- `src/services/ai/extractionPrompt.ts` — **the same `buildUserMessage` edit, byte-identical**; bump `PROMPT_VERSION`
- `scripts/spikes/extractionPrompt.mjs` — **the same edit again**; bump `PROMPT_VERSION` (all three are compared by `extractionPromptDrift.test.ts`)
- `infrastructure/modules/ai-extract/main.tf` — rate table, TTL, IAM, env, reserved concurrency, gated alarm (no `random_password` — see §5)
- `infrastructure/modules/ai-extract/variables.tf` — `reserved_concurrency`, `alerts_topic_arn`
- `infrastructure/modules/content-fetch/outputs.tf` — export `alerts_topic_arn`
- `infrastructure/main.tf` — pass `alerts_topic_arn` into `module "ai_extract"`
- `infrastructure/lambda/ai-extract/__tests__/handler.test.mjs` — one assertion pinning that an unset `RATE_TABLE` is a silent no-op

**Tests**

- `src/composables/__tests__/useSharedDocumentIngest.test.ts` — **the precedence matrix goes here, in the existing file.** Three assertions break by construction: the `shareTarget.noLink.title` toasts at lines 255, 277, 395, and the over-cap test at line 389.
- `src/utils/__tests__/attemptBudget.test.ts` — **new**
- `src/utils/__tests__/boundText.test.ts` — **new**
- `src/services/ai/__tests__/documentExtractionService.test.ts` — the `familyId` option
- `infrastructure/lambda/ai-extract/__tests__/rateLimit.test.mjs` — **new**, `node --test` with a stub client. `package.json:20`'s `test:lambda` already globs `infrastructure/lambda/ai-extract/__tests__/*.test.mjs`, so it is picked up automatically — do not edit the script.

**Docs**

- `docs/plans/2026-09-02-plain-text-share.md` (this file)
- `docs/adr/035-plain-text-share-provenance.md` — **new**; records trading the text arm's provenance guarantee for rate limiting. Add a pointer from `docs/adr/030-private-ai-tiered-architecture.md`, where the guarantee is asserted.

## Help Center Coverage

A distinct new user-facing capability, and security-relevant (what leaves the device, and why a share can be refused).

- **Action**: `update existing`
- **Category**: `features`
- **Slug**: the existing share-to-beanies article from #64
- **Title**: unchanged
- **Scope**: Add a section on sharing _selected text_ — what to select, what beanies does with it, and that nothing is saved until confirmed in the review screen. Explain the two refusals (too much text at once; too many shares in a short period) as protections, in plain language.
- **Notes**: Must state plainly that the selected text is sent to the AI reader to be understood — that is the user's actual privacy question and the point of the consent gate. Must not imply text shares are stored anywhere.

## Observability Coverage

Surface: **`share-target`** (existing) for the client funnel; **`ai-extract`** (Lambda structured logs) for the server throttle.

**The discriminator is `detail`, not `kind`.** `kind` on this surface already means the _extraction_ kind (`event|travel|recipe`, e.g. `useSharedDocumentIngest.ts:592,605`); overloading it with `'text'` would make it un-groupable — the opposite of requirement 9. `detail` is _already_ the source discriminator via `logReceivedKind(detail: 'file' | 'link')` at line 179.

**No new event names on the success path.** The funnel already exists:

| Existing event                             | Change                                                  |
| ------------------------------------------ | ------------------------------------------------------- |
| `share triaged` (line 179)                 | widen `logReceivedKind` to `'file' \| 'link' \| 'text'` |
| `share extraction failed` (lines 367, 430) | tag with `detail`                                       |
| `share ready for review` (line 605)        | tag with `detail`                                       |

**Derive `detail`, do not thread it.** Add a total one-line mapper beside `logReceivedKind`:

```ts
function sourceDetail(source: ShareSource): 'file' | 'link' | 'text';
```

`ShareSource` is already the discriminator and `read()` already receives it. Passing a parallel `detail` parameter down would create two representations of the same fact to keep in sync by hand, and would grow the signature of the function in this file that already carries the most branching. The mapper is closed by the union, so a fourth source arm cannot compile without updating it.

Net: one widened signature plus one mapper, instead of six new event names.

**Genuinely new events**, and they must NOT all be `rejected_type` — overloading that counter is the same mistake as overloading `kind`:

| Event              | Level | Context                                                            | Why this `action`                                                                                                                                                                                      |
| ------------------ | ----- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| size/shape refusal | info  | `action: 'rejected_type'`, `detail: 'too_short' \| 'over_ceiling'` | `rejected_type` already means "we could not use what was handed to us" (lines 238, 274, 331)                                                                                                           |
| quota refusal      | warn  | `action: 'refused'`, `detail: 'quota'`                             | `action: 'refused'` already exists (line 477) for a _deliberate_ refusal. A budget refusal is not a type rejection.                                                                                    |
| truncation notice  | info  | `action: 'truncated'`, `detail: 'text'`                            | **Not a refusal at all** — a success with a notice. Filed under `rejected_type` it would inflate the rejection counter and make the acceptance criterion "how many were refused and why" unanswerable. |

`detail` is already in `ALLOWED_CONTEXT_KEYS` (`diagnosticContext.ts`), so **no new context key ships and no store-declaration update is required.** Deliberate: a new `share_source` key would have triggered the `PrivacyInfo.xcprivacy` + Data-Safety + `privacy.astro` chain for no additional signal.

**Never logged:** the shared text, any substring, its hash, or a character count precise enough to fingerprint a document. Band membership is the granularity.

**Failure modes and the event that diagnoses each blind**

- Text arrives but never extracts → `share triaged detail=text` with no following `ready for review` or `extraction failed` isolates a hang between them.
- Cap set wrong → the `detail=quota` rate against `detail=text` triage says whether 20/hour is wrong.
- Model reads text badly → `share extraction failed` with `detail=text` separates text-arm from image-arm failures, which today share one counter.
- Server refusing legitimate traffic → the Lambda's `rate_limited` line carries **which limit tripped** (`family` or `ip`) but never the identifier, so a NAT false-positive shows as an IP-limit spike without deanonymising anyone.
- Rate store down → the `[ai-extract] rate-limit store unavailable` line plus its metric-filter alarm.

**Success-path signal:** the existing `received → triaged → ready for review` funnel gains a `detail` discriminator, so the text arm's conversion rate is measurable with a denominator. These are counts, not durations, so `TELEMETRY_FLOOR_MS = 250` does not apply.

**Critical vs. firehose:** none warrant `severity: 'critical'`. A refused share is the system working as designed and paging Slack for one would be noise — the same reasoning `invalidateSession` documents. An unexpected throw keeps its existing `reportError` at `'error'`.

## Acceptance Criteria

- [ ] Sharing a selected block of an email containing a date, time and place from Gmail (Android), Apple Mail (iOS) and an installed PWA lands in the activity review modal with date, time and title pre-filled
- [ ] beanies appears in the iOS share sheet when text is selected
- [ ] Text with no readable detail fails with a clear, specific message — not a blank review modal, not a silent no-op
- [ ] A share above the ceiling is refused **without an AI call**, and a file whose byte size puts it _unambiguously_ above the ceiling is refused **without decoding** (a 40 KB ASCII `.txt` is legitimately decoded first, then caught by the length check — the byte gate is a fast path, not the only one)
- [ ] A share between cap and ceiling is truncated **and says so** — exactly one notice, not two
- [ ] Exceeding the per-family cap is refused with a message naming when it resets, **and the same request is refused server-side** when replayed directly at the proxy with the bundled key
- [ ] Declining consent does **not** consume budget
- [ ] A captioned photo still produces one item (the photo), unchanged
- [ ] An unreadable file beside a caption still reports a _file_ problem
- [ ] Text containing a link still takes the link path, unchanged
- [ ] Emoji/RTL text at the cap boundary truncates without mojibake
- [ ] A `.txt` shared on iOS lands on the same limits as pasted text, including `over_ceiling`
- [ ] A 429 shows an info toast and does **not** page `#beanies-errors`
- [ ] The consent modal names shared text
- [ ] Nothing is persisted without review-modal confirmation
- [ ] CloudWatch can answer, from logs alone: how many text shares ran, how many were refused and why, and how many produced a saved item
- [ ] `usePinAttemptLimit`'s existing suite passes **unchanged**
- [ ] Help Center article updated and verified against shipped behaviour
- [ ] Diagnostic logging implemented and verified; confirmed no new context key was needed

## Testing Plan

1. **Unit — `boundText`**: exact cap, one under, one over, a string ending mid-surrogate-pair, RTL, emoji-only. Assert no `U+FFFD` is ever produced.
2. **Unit — `attemptBudget`**: window expiry, `resetsAt` correctness, peek-does-not-consume, and — the case that motivated keeping it standalone — **a budget with used attempts and no active cooldown survives a simulated reload** (the exact behaviour `usePinAttemptLimit.persist()` would have silently dropped).
3. **Unit — `prepare()` precedence matrix, in the existing test file.** Each row asserts a _different_ outcome so no case passes vacuously:
   - files only → `documents`
   - files + caption, readable → `documents`
   - files + caption, unreadable → **file problem**, not text
   - `.txt` only → text path, limits applied
   - `.txt` of 200 KB → `over_ceiling`, **assert `.text()` was never called**
   - text with a link → `link`
   - text with a link past the cap → truncated, `no_url` (unchanged)
   - text, no link, 30 chars → `text`
   - text, no link, 10 chars → `too_short`, **assert the extraction spy was not called**
   - text, no link, 50k chars → `over_ceiling`, **assert the extraction spy was not called**
   - text, no link, 10k chars → `text` with `truncated: true`, exactly one toast
   - Update the three `noLink` assertions (lines 255, 277, 395) and the over-cap test (line 389).
   - ⚠️ **Line 255's fixture is the 22-character string `'https://youtu.be/short'`.** Under `MIN_SHARE_TEXT_CHARS = 25` it now falls through to `too_short` — an outcome driven by fixture length rather than intent, and a confusing message for "your YouTube link isn't readable". Lengthen the fixture so it exercises the intended band, and confirm the `too_short` copy does not read as a comment on links.
4. **Unit — `rateLimit.mjs`** under `node --test` with a stub client: under limit passes; at limit returns `allowed: false` with `limit` and `retryAfterSeconds`; family and IP trip independently; TTL is set; a missing `familyId` falls back to the IP limit rather than 400; a throwing client **fails open, logs, and returns `degraded: true` rather than throwing**; an unset `RATE_TABLE` is an immediate silent no-op; the family id never appears in the response or any log line.
5. **Integration** — offline, in-flight-share refusal, and cold-start-while-loading behave for text exactly as for files.
6. **Manual, on device** (none of this runs in CI): Gmail on Android, Apple Mail on iOS, installed PWA. Confirm the sheet entry, the consent gate wording, the reading overlay, the review modal, and each refusal message in beanie voice.
7. **Deploy-order rehearsal**: new client against the _old_ Lambda still extracts (no wire change) — which is exactly why the Lambda ships first; and new Lambda against an _old_ bundle (no `familyId`) falls back to the IP limit rather than 400.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted from the codebase; found the `share` task already declares a text source, reframing the server work from "add a source" to "replace the provenance fence with rate limiting"; proposed values for both open questions.
- **Pass 2 (DRY + error handling)**: Substantial. Caught that `usePinAttemptLimit` cannot be called from the share path (adapter callback, not `setup()` — would leak a ticker) → core/wrapper split; that iOS already handles plainText so text arrives as a _file_, making the ceiling unreachable via the existing `*4` decode bound → decide the band from `File.size`; that `kind` was the wrong telemetry discriminator and six new events duplicated three existing ones; that `rate_limited` would page Slack via the `default:` arm; that quota in `prepare()` burns budget when consent is declined; that the client never sends `familyId` at all; replaced the HMAC-secret design with a client-side SHA-256 for family + `random_password` HMAC for IP; corrected "rolling" to a fixed hourly bucket; specified fail-open-log-loud on DynamoDB error; and flagged the consent-modal copy gap and the existing tests this change breaks.
- **Pass 3 (Sustainability)**: Reversed two Pass-2 decisions on better evidence. Caught that the core/wrapper split would have shipped a **silent budget-reset bug** — `usePinAttemptLimit.persist()` writes only entries with a live cooldown, so a share budget with no cooldown would never persist and a reload would hand back a fresh 20, invisible to the suite Pass 2 required to pass unchanged → `attemptBudget.ts` stays standalone with the duplication recorded. Dropped the client-side SHA-256 (no access logs exist for the raw id to leak into, and `family_id` already ships raw to our own telemetry) for one HMAC mechanism at the Lambda. Kept `familyId` out of the store-free AI service by passing it through `ExtractOptions`. Cut the client cooldown as the weakest of five overlapping limits. Split the overloaded `rejected_type` counter and moved `truncated` out of the refusal bucket. Derived `detail` from `ShareSource` instead of threading it. Made `checkLimits` non-throwing with an unset-table no-op. Found a third stale invariant comment — the client-side one on `extractShareFromText` itself. Split the deploy into three steps.
- **Pass 4 (Fresh-eyes sweep)**: Found one **blocking** defect — the prompt string to be corrected exists in THREE files (`extractionPrompt.mjs`, `extractionPrompt.ts`, `scripts/spikes/`) compared by `extractionPromptDrift.test.ts` with `toEqual`, so changing one fails CI; all three plus `PROMPT_VERSION` must move together. Also caught that the §3 byte gate as written contradicted Requirement 3 (a `.txt` beginning with a link, which is how iOS delivers shared URLs, would have been refused where it takes the link path today) → gate now sets a flag and the over-ceiling verdict applies only in the no-URL fallback; that the bands must be measured on the original string, since `capped` is ≤4,000 by construction and would make two bands unreachable; that `modules/ai-extract` has no SNS topic to alarm into (the only one lives inside content-fetch and is unexported) → added the output/variable/wiring; that `hashicorp/random` is not a declared provider, so `random_password` would add a provider and put a secret in state to hide an IP from whoever already holds the AWS account → plain `sha256` for both, decided once; that the IP must be `requestContext.http.sourceIp` and never `x-forwarded-for`; and that `ai.consent.introLink` must stay a verbatim substring of `intro` or the privacy link vanishes. Corrected the per-family/per-device conflation (the client cap is `localStorage`, so a two-device household legitimately reaches 40 → server family limit raised to 80), five consent strings rather than two, `src/content/help/security.ts` repeating the same claim, a stale Prompt Log sentence left over from Pass 2, three drifted line numbers, and a test fixture that now lands in the wrong band. Added the SDK lazy-load, the exact handler call site, matching 429 by status (which fixes pre-existing Slack noise from the route throttle), storage-key/pruning/return-type specifics, and the honest limits of the iOS decode bound.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt (via `/beanies-pre-plan`, tracker #83)

The complete pre-plan block as supplied — title, type, priority, surfaces, objective, user story, UX note, scope, out-of-scope, acceptance criteria, edge cases, reuse hints, references, open questions and notes — is reproduced verbatim in the Notion tracker row `beanies-plan prompt` field for #83, and is carried in full across the Context, Requirements, Important Notes and Acceptance Criteria sections above.

Two open questions were deliberately left to this plan to decide with reasoning:

1. Exact per-family cap, cooldown and hard-ceiling values.
2. Whether the server-side throttle keys on family id, device, or both.

Both are answered in `## Approach` §2, §4 and §5, with the reasoning stated inline so the numbers can be argued with. The cooldown half of the first question was answered by _removing_ it — see §4.

### Session context

> "proceed to run one final code review at the level you seen necessary across all code implemented in the last session that is not deployed yet, find and fix any issues bugs or security issues. fix any issues found"

> "once the review and fixes are complete, create the /beanies-plan for #83"

The review preceding this plan is what produced `usePinAttemptLimit` — which §4 deliberately leaves untouched; see the reasoning there.

</details>
