# Plan: encrypt the document to the AI enclave, so our own server cannot read it

> Date: 2026-09-16
> Related issues: Notion tracker #49. None on GitHub, direct implementation.
> Plan file: `docs/plans/2026-09-16-ai-e2e-encryption-gate-3.md`

## User Story

As a parent uploading my child's party invite, I want it encrypted so that only the attested enclave can read it, so that not even beanies' own server ever sees my family's document.

## Context

`src/services/ai/providers/managedProvider.ts` POSTs the document as plaintext JSON to our `ai-extract` Lambda. `infrastructure/lambda/ai-extract/index.mjs` builds the chat body (`taskConfig.buildMessages(source, todayDate, read.kindHint)`) and calls Tinfoil with our key, so the document sits in our Lambda's memory in the clear. ADR-030 Gate 3 is OPEN and forbids claiming "no intermediary sees the document" until this ships. Gate 2 (the DPA) closed 2026-07-10, so Gate 3 is the last blocker.

### The complication the tracker row predates

The row was written 2026-07-10. Per-family metering and the free-correction grants shipped 2026-09-14 and live in the Lambda, reading plaintext:

- `openRead()` (`meter.mjs:69`) computes `srcHash = sourceFingerprint(source)` over the plaintext. HPKE is non-deterministic, so a hash over ciphertext could never match twice.
- `closeRead()` (`meter.mjs:99`) reads `result.kind` and passes it to `issueGrant` as `resultKind`.
- The handler's kind-guard (`index.mjs:375`) compares `result.kind !== read.kindHint` and returns 422/502.

**greg's decisions (2026-09-16):**

1. Drop the grant's kind-binding. The kind-guard moves client-side.
2. The client computes `srcHash` over the plaintext. This sits at the same trust level as `familyId`, which the Lambda already treats as forgeable. Forging it only lets a family mis-bind its own grant.

## Verified findings

Every claim below was read out of source, not recalled.

**A. Dropping the kind-binding is not a comment change, it breaks corrections outright.**
`correctionGrant.mjs:222` reads `if (task !== 'share' || !SHARE_KINDS.includes(resultKind)) return undefined;`. With `resultKind: undefined` **no grant is ever issued**. And `consumeGrant`'s `ConditionExpression` (`correctionGrant.mjs:145-147`) includes `#kind <> :to`; against an item with no `kind` attribute DynamoDB evaluates that to false, so **every** correction would be refused. Two concrete edits, not one. Losing the different-kind guard is acceptable: the grant is still single-use and still bound to `familyId + srcHash`, so the worst case is one free re-read per paid read, which is exactly the promise.

**B. Native builds cannot be force-upgraded, so the Lambda cannot become forwarder-only.**
All five workflows (`deploy.yml:176`, `mobile-android-release.yml:144`, `mobile-android-build.yml:88`, `mobile-ios-release.yml:170`, `mobile-ios-build.yml:101`) bake `VITE_AI_EXTRACT_URL` into the build. The PWA auto-updates; a store build updates only when the user updates it. If the Lambda stops accepting plaintext, every un-updated install gets a 400 with no `code`, which `managedProvider` maps to `provider_error`, the generic "something went wrong" toast. **The legacy plaintext arm stays, and `extractionPrompt.mjs` is NOT deleted in this change.** See finding K for the retirement mechanism.

**C. There is no `Access-Control-Expose-Headers` anywhere in the repo.** Verified by grep across the whole tree. So **keep our client-to-Lambda wire as JSON with the ciphertext as a base64 string field**. Our CORS, the 5 MB `rawBody.length` cap, the 413 path and the existing `{ attestation, correction }` response channel then all work untouched. Only the Lambda-to-Tinfoil hop speaks raw EHBP. Cost is about 33% inflation on the sealed bytes; worst case (5 pages, 2048px, q0.85) is roughly 2.3 MB, comfortably under the 5 MB cap and the 6 MB invoke ceiling.

**D. `checkLimits` is gated on `hasText`, which a blind forwarder cannot know.**
`index.mjs:229` runs the limiter only for text sources; ciphertext hides the source kind. A `sourceKind` envelope field would be a fence a client defeats by lying. Worse, the `sources` fence at `index.mjs:143-155` (whose comment warns an unrestricted text field "would turn this proxy into a general-purpose text-LLM endpoint anyone could bill us for") is **unenforceable on ciphertext, permanently**. So the limiter must apply to **every** `ehbp-1` request. That is the compensating control that replaces the fence. Safe: every managed read already carries a `familyId` (`useSharedDocumentIngest.ts:818` refuses an unattributable read before the model). `FAMILY_LIMIT = 80/hour`, `IP_LIMIT = 120/hour` sit far above real family use.

**E. Most client-side source validation is already satisfied structurally.**
`prepareImageDataUrls` builds every image through `compress()`, and `photoCompression.ts` always emits `image/jpeg`; the page count is bounded by `MAX_EXTRACT_PAGES = 5` (`src/utils/pdfExtractionImages.ts:26`). A non-JPEG or 9-page payload cannot be constructed by any caller, so a client-side mime/count validator would be dead code. The genuinely missing check is the **text bill bound** (finding L).

**F. The originally planned telemetry does not compile.**
`perfTiming.record`'s third argument is `PerfContext`, which allows only `perf_doc_bytes` and `perf_entity_count`. `cached` / `reason` / `enclave` are not in `ALLOWED_CONTEXT_KEYS` (**`src/utils/diagnosticContext.ts:61`**, note CLAUDE.md says `logEvent.ts`, which is stale). Adding keys would drag in the telemetry Lambda mirror, `native-store-submission.md`, `PrivacyInfo.xcprivacy`, the store Data-Safety answers and `privacy.astro`. **Use the existing allowlisted `action` and `error_code` and put durations and enclave names in `message`.** Zero new context keys, zero privacy-declaration churn.

**G. `openaiCompatible.ts` already is this funnel.** `callOpenAiCompatibleTask` builds messages via `EXTRACTION_TASKS[task].buildMessages(...)`, POSTs `{ model, messages, temperature: 0 }`, reads `choices[0].message.content`, strips json fences, parses via `EXTRACTION_PARSERS`, and classifies every failure. The enclave path differs only in transport. Reuse it.

**H. `buildSignal` is already duplicated.** `managedProvider.ts:44` and `openaiCompatible.ts:40` are byte-identical. Export one, delete the other.

**I. `sha256Hex` already exists** at `src/utils/encoding.ts:149`, lowercase hex, matching the Lambda's `createHash('sha256')...digest('hex')`. `srcHash` is three lines, not a shared module.

**J. Dependency choice, checked live on npm.** `tinfoil@1.2.1` depends on `openai@^6.46.0`, `@ai-sdk/openai-compatible`, `ws` and `@types/ws`. `ws` is dead weight in a browser and the OpenAI SDK is a second HTTP client we can never use (our key stays server-side). Take the two focused packages: **`@tinfoilsh/verifier@1.2.1`** (215KB unpacked, @freedomofpress browser deps only) for attestation, and **`ehbp@0.3.2`** (360KB, deps `@panva/hpke-noble` + `hpke`) for seal/open. Neither is currently in `package.json` or `node_modules`. Both pinned exactly.

**K. The retirement lever already exists in this repo.**
`web/public/min-app-version.json` carries `promptBelowVersion` (currently `0.21.1`), read once per process by `src/services/appUpdate/versionPolicy.ts`, with a written procedure at `docs/runbooks/native-store-submission.md#7-raising-the-update-floor`. It can only ever prompt, never block. The PWA auto-updates, so **the legacy tail IS the native store tail**, which is the only population the floor addresses. Note honestly: the file's own `reason` field records that the last raise was justified by _data damage_, and ends "NEXT: raise only to a version live on both stores". Whether a privacy gate qualifies is greg's call (open question 2). Even unraised, a written sunset condition plus a countable log line beats an aspiration.

**L. The client text cap must not mint a third free-floating `32_000`.**
There are exactly two in the tree today: `src/services/share/types.ts:67` (`MAX_SHARE_TEXT_CEILING`) and `index.mjs:50` (`MAX_TEXT_CHARS`). The share path truncates to `MAX_SHARE_TEXT_CHARS = 10_000` before sending, so it is already bounded. The **link arm is not**: its text comes back from the `content-fetch` Lambda (around 24k) and the client never bounds it. So when `MAX_TEXT_CHARS` stops being enforceable on ciphertext, the bill bound genuinely has to move client-side. One constant in the provider, named for that job, citing the other two, and pinned to the Lambda's by the parity test.

**M. The bean-count invariant changes on the sealed arm.**
`closeRead` is called at `index.mjs:403`, which is **after** `model_unparseable` (341), `model_shape` (352, 361) and the kind guard (386). So today a read that produced nothing usable is counted in neither column. The sealed Lambda cannot see the answer, so its count fires on any upstream 200. Consequence: **a model that returns unparseable JSON now charges a bean and the family sees `malformed_output`.** There is no safe fix, because a client-declared "it did not parse" is a meter bypass by construction. This is an accepted, stated trade: on the sealed arm the bean is spent when _the enclave answered_, not when _we could read the answer_. It must be written into `meter.mjs`, the ADR and the acceptance criteria rather than discovered by a family. Secondary effect: the server-side quality signal `[ai-extract] model returned unparseable JSON` disappears on the sealed arm; the client's existing `malformed_output` report replaces it.

**N. Dropping `SHARE_KINDS.includes(resultKind)` also drops "never for `kind: 'none'`".**
`correctionGrant.mjs:200-204` documents that second job explicitly. After the change, a sealed `share` read that returns `none` issues a grant the UI can never spend: `useSharedDocumentIngest.ts:1222` returns on `outcome.kind === 'none'` before the review modal that hosts the banner mounts. Cost is one extra DynamoDB `UpdateItem` per `none` share read. Accepted, but the docstring paragraph must be rewritten, not just invariant 1.

**O. `correction.to` does not belong in the plaintext envelope at all.**
Once `#kind <> :to` is gone, `consumeGrant` has no use for `to`. And `validateCorrection`'s closed-set check on `to` exists for exactly one reason, stated at `correctionGrant.mjs:89-91`: "`to` reaches the model's INSTRUCTION, outside the untrusted-source fence". On the sealed arm it never reaches the model server-side, because the client built the prompt. So sending `to` would leak, in cleartext, the family's own assertion about what their document is ("this is a travel booking") for no remaining purpose. **The sealed envelope carries `correction: { token }` only.**

**P. `srcHash` is the one new piece of cleartext metadata, and it must not be salted.**
It is a SHA-256 over the exact wire bytes. It reveals no content, but it is a stable identifier: our server can tell two reads carried the same document, and could confirm a _guessed_ short text source. Two mitigations were considered and rejected. Salting per family would break byte-parity with `sourceFingerprint`, and a family that reads on an old bundle then corrects after an in-hour app update would hash differently and trip `GRANT_MISMATCH_PREFIX`, the one alarm that means "the feature is broken". Truncation buys nothing. So: keep it identical, and state plainly in the ADR what the server still learns on the sealed arm, which is `familyId`, `task`, `srcHash`, the sealed body size and the timing.

**Q. The parse cause can quote model output, and must stay off telemetry.**
V8's `JSON.parse` SyntaxError messages quote a slice of the input, and on the sealed arm that input is model output derived from the family's document. `useExtractionErrorToast.ts:60-72` already documents the rule that keeps this contained: the provider detail goes to the console and the toast, and "Deliberately not telemetry: the firehose context is an allowlist and a provider message is free-form text that could carry anything." The sealed arm must not widen `detail` to carry the parse cause and must never pass a cause object into `logEvent` / `reportError`.

## Requirements

1. The client fetches the attestation and HPKE key config directly from `inference.tinfoil.sh/.well-known/*`. **Blocking pre-req**: the 2026-09-16 spike ran from a browser origin. `versionPolicy.ts` documents the native WebView origin as `capacitor://app.beanies.family` (iOS) and `https://app.beanies.family` (Android). Re-run the spike from a real native build. If refused there, the contingency is `CapacitorHttp` for the two well-known GETs on native only, following versionPolicy's precedent (direct call, never the global `capacitor.config.ts` patch). No Lambda relay unless both fail.
2. The client verifies the AMD SEV-SNP attestation and confirms the HPKE public key it will encrypt to is the key bound to that attested measurement, before any document leaves the device.
3. The client builds the chat-completions body through the existing `EXTRACTION_TASKS[task].buildMessages` seam, not a new builder.
4. The client HPKE-seals that body and POSTs the ciphertext as base64 inside our existing JSON envelope.
5. Verification failure refuses the send. There is never a degrade-to-plaintext path on the client.
6. The Lambda gains a blind-forwarder arm for `protocol: 'ehbp-1'`: it keeps CORS, `x-api-key`, the body cap, correction-token validation, rate limiting and metering, and forwards the sealed bytes plus `ehbp-*` headers in both directions. It **retains** the legacy plaintext arm (finding B).
7. The sealed arm lives in its own module (`sealedForward.mjs`) behind one `if` in `index.mjs`, placed immediately after `JSON.parse`. The legacy code stays exactly where it is, tagged. Retirement is a marked deletion, not a refactor.
8. **The legacy arm carries a written, dated sunset condition** recorded in ADR-030 and marked at every legacy-only site with one grep-able token, `LEGACY-PLAINTEXT-ARM`.
9. The client enforces the one validation the Lambda genuinely loses: the text bill bound (finding L). It does **not** re-implement mime or page validation (finding E), and it does **not** pre-guess the body cap.
10. The correction kind-guard moves client-side, mirroring the legacy Lambda's verdicts including `none` to `correction_disagreed`.
11. `AttestationInfo` on the sealed arm is built **from the client's own verified enclave**, not from the server's `tinfoil-enclave` header, and `verified: true` is set only when verification actually succeeded.
12. The rate limiter applies to every `ehbp-1` request (finding D).
13. Attestation verification is memoised with a TTL, and the memo is cleared after any failed sealed request so the user's own retry re-verifies. No automatic retry, no retry budget, no backoff.
14. ADR-030 records Gate 3 as **closed for sealed clients and still open overall**, with the legacy arm, the dead `sources` fence, the residual metadata (finding P), the changed bean-count point (finding M) and the sunset condition stated plainly. ADR-035's "widen limits to images" follow-up is closed.
15. The verifier and `ehbp` are lazy-loaded so they stay out of the main bundle, and are pinned exactly with a dependabot major-version ignore.
16. **Every comment in the repo that asserts the kind-binding, the `none` exclusion, the text-only limiter or the Gate 3 deferral is rewritten in the same commit that changes the behaviour.** The checklist is in the Approach, and a grep proves it.

## Important Notes and Caveats

- **Deploy order is load-bearing and asymmetric. Lambda first, always.** A new Lambda serving an old bundle works (legacy arm). A new bundle hitting an old Lambda gets a 400 with no `code` and a generic toast. The Lambda is applied by terraform, not by `deploy.yml`, so the two are independent by construction and nothing enforces the order but this note.
- **Rolling the Lambda BACK breaks corrections for up to one hour.** A grant issued by the new Lambda has no `kind` attribute; the old `consumeGrant` still evaluates `#kind <> :to` against it, which DynamoDB resolves false, so the grant is refused. Blast radius is bounded by `GRANT_TTL_SECONDS = 3600`, it is visible (a `correction_refused` 409 with its own toast), and it fails toward "you were not charged". Acceptable, and written here so nobody rediscovers it mid-incident.
- **On the sealed arm the Lambda never possesses plaintext at all**, so no log line can leak a document. The narrow rules that remain: never log `parsed`, `event.body` or the response bytes, and leave the top-level `console.error('[ai-extract] error:', err)` unchanged, since it only ever carries our own error objects.
- **A bean is now spent when the enclave answered, not when we could read the answer** (finding M). Say so in `meter.mjs` and the ADR.
- **Never forward a client-supplied header blindly.** Only headers matching `/^ehbp-[a-z0-9-]{1,48}$/i` are relayed, at most 16 of them, in either direction. `Authorization`, `x-api-key` and `Cookie` cannot match that shape, so they can never be relayed and cannot overwrite our key header.
- **On the sealed arm, `task` is a metering label and nothing else.** It is compared (`task !== 'share'`) and logged, never used as a key into any object. `index.mjs:124-130` records a production bug where `EXTRACTION_TASKS['constructor']` resolved up the prototype chain and threw outside the try/catch, returning a raw 502 with no CORS headers to anyone holding the bundle's api key. The sealed arm must not reintroduce the shape.
- **The `sources` fence dies with plaintext and cannot come back.** Anyone holding the bundle's `x-api-key` can seal an arbitrary prompt. The unconditional rate limiter replaces it. Say so in the ADR rather than implying the fence survives.
- **The server-side "hint only when a grant was spent" fence also dies.** The client now passes `correction.to` into its own prompt exactly as BYOK already does (`openaiCompatible.ts:117-121`). Biasing your own read costs you a bean; a deliberate, stated trade. The hint never reaches the wire in cleartext (finding O).
- `kind: 'none'` still counts a bean. It remains the single `response(200, ...)` path.
- Do not reconcile the client and server image caps. `MAX_IMAGES = 8` stays on the legacy arm only, and dies with it.
- Writing new public privacy copy is out of scope and stays greg's call.

### Alternative considered and rejected

A second Lambda on a second route would make retirement a terraform deletion, but both arms must count into the same usage and rate tables, so it means two IAM roles, two log groups, two deployment units and two alarm sets for one billing invariant. Recorded so it is not re-litigated.

## Assumptions

> Resolve before writing code. One is blocking.

1. **BLOCKING.** The `.well-known` CORS spike holds from a **native** build as well as a browser (requirement 1). If not, the `CapacitorHttp` contingency applies.
2. **RESOLVED** (finding J): `ehbp@0.3.2` is a standalone browser client, so the seal primitives are separable from Tinfoil's own fetch client. Our key stays server-side.
3. Tinfoil's enclave accepts an EHBP-sealed body on `/v1/chat/completions` with `Authorization` attached by our proxy, that is, the sealed envelope does not cover that header.
4. No caller other than our own bundle uses the Lambda. Verified: `VITE_AI_EXTRACT_URL` is referenced only by `managedProvider.ts`, `vite-env.d.ts`, the five workflows and terraform outputs.
5. Tinfoil rotates its enclave measurement and HPKE key at some cadence we do not control, and we will not be told in advance.

## Approach

### 1. Lambda

Two new files and one `if`. No pure-move commit.

```
index.mjs           unchanged down to JSON.parse, then:
                      if (parsed.protocol === 'ehbp-1') return sealedForward(parsed, event, ctx);
                      if (parsed.protocol !== undefined) return response(400, {code:'unknown_protocol'});
                    everything below that line is today's legacy arm, untouched apart from
                    the openRead call site, the comment rewrites and the LEGACY-PLAINTEXT-ARM
                    marker on the block.
upstream.mjs        NEW. One POST to Tinfoil taking { body, contentType, extraHeaders } and
                    returning { ok, response } or { ok:false, status, code }, carrying the
                    timeout / 5xx / 401-403 / other ladder verbatim from index.mjs:281-322.
                    The ONLY legacy code this change refactors, and the reason is DRY: it is
                    the one piece both arms need and it survives retirement.
sealedForward.mjs   NEW. The sealed arm, written flat with early returns.
```

`meter.mjs`, `rateLimit.mjs`, `countUsage.mjs`, `ddb.mjs`, `correctionGrant.mjs` stay shared. `handler.test.mjs` must pass **unchanged**; if it does not, the `upstream.mjs` extraction is wrong and gets reverted rather than argued with.

`sealedForward` keeps: correction-token validation, the `correction && task !== 'share'` fence, `checkLimits` (now unconditional), `openRead`, the `read.reason === 'refused'` 409, `closeRead`, `upstream.mjs`'s ladder, and a byte-free `ok` log.

It loses: source parsing, `todayIso`, mime/count/text validation, `EXTRACTION_TASKS` lookup, `buildMessages`, `parseModelJson`, `requiredKeys`, the kind-guard.

Upstream body is `Buffer.from(envelope.sealed, 'base64')` with `Authorization` from env plus the relayed `ehbp-*` headers. Response is `{ sealed: <base64 of the raw bytes>, correction, ehbp: {...} }`, and `closeRead(read, { familyId, task })` with no `result`. Note there is no `attestation` on the sealed response: requirement 11 says the client's own verified enclave is the truth, so echoing the server's header would be theatre.

One counted log line on the legacy arm, `[ai-extract] legacy plaintext request task=<task>`, not alarmed, so it stays out of `ALARMING_PREFIXES` and needs no terraform change. The Logs Insights query that reads it goes in the ADR beside the sunset condition.

### 2. `meter.mjs` and `correctionGrant.mjs`

`openRead` takes `srcHash` instead of `source`: `openRead({ familyId, srcHash, correction, now, ddb })`. The legacy caller passes `sourceFingerprint(source)` (already imported by `meter.mjs` today), the sealed caller passes `envelope.srcHash`. One parameter, one meaning, no branch, and the shared meter never learns two arms exist. This costs about ten mechanical edits in `meter.test.mjs`, which already imports `sourceFingerprint`.

`closeRead` documents `resultKind: undefined` as intentional, and documents the changed count point (finding M). Then the two edits without which corrections break (finding A):

- `issueGrant`: drop `!SHARE_KINDS.includes(resultKind)` from the guard and stop writing `:kind`. Keep `task !== 'share'` and `wasCorrection || !counted`.
- `consumeGrant`: drop `#kind <> :to`, its `#kind` name and its `:to` value, and stop reading `correction.to`. Five condition clauses become four: exists, not consumed, same source, not expired.
- `refusalReason`: the `same_kind` fallthrough becomes `unknown`. With the kind guard gone every remaining clause has its own branch, so reaching the fallthrough now means something genuinely unexplained. Say that in the docstring rather than silently renaming a word.
- `validateCorrection`: extract the UUID check as `validateCorrectionToken(token)` and have `validateCorrection` call it, so the sealed arm validates a token-only correction against the same rule.

**The comment checklist, all in the commit that changes the behaviour** (requirement 16). `meter.mjs`'s own header warns that scattered touch points are "the shape that half-updates", and prose is a touch point here because these comments are the only place the safety argument is written down.

1. `correctionGrant.mjs:22-27`, THE FOUR GUARDS. Four become three.
2. `correctionGrant.mjs:28-31`, two claims in one paragraph. The source-binding claim strengthens. The second sentence, "`FAMILY_LIMIT` is gated on `hasText` and does not cover the image path at all", becomes false for the sealed arm and must say which arm it describes.
3. `correctionGrant.mjs:99-105`, `refusalReason`'s "Which of the four guards refused".
4. `correctionGrant.mjs:140-144`, the inline "FIVE guards" note.
5. `correctionGrant.mjs:155-157`, "so the four guards can be told apart".
6. `correctionGrant.mjs:195-199`, `issueGrant`'s invariant 1. After this change it is carried **entirely** by `wasCorrection`, because the different-kind guard no longer exists. The reader's whole safety argument changes.
7. `correctionGrant.mjs:200-204`, "never for `kind: 'none'`". Now false (finding N). Say what it costs and why it is accepted.
8. `meter.mjs:57-64` and `index.mjs:219-224`, two spellings of "bound to the family, the document and the kind but NOT to a task". Both become "the family and the document".
9. `meter.mjs:89-97`, `closeRead`'s docstring, gains the changed count point (finding M).
10. `index.mjs:196-207`, "Gated on `hasText`: TEXT SOURCES ONLY for now" and its "deliberate follow-up" line. Scope it to the legacy arm and say the follow-up landed.
11. `index.mjs:14-19`, the GATE 3 header block.
12. `index.mjs:368-374`, the kind-guard block, gains the `LEGACY-PLAINTEXT-ARM` marker.
13. `managedProvider.ts`'s 26-line header: its rate-limiting paragraph, its "the proxy returns our typed JSON contract" line and its "GATE 3 (deferred)" block are all false after this change. That header has been corrected twice already and says so; do not let it drift a third time.

A count is fragile, so the criterion is the grep, not the number.

`meter.test.mjs` asserts alarming prefixes against `modules/ai-extract/main.tf`; none of those strings change, so the metric filters stay armed and terraform is untouched.

### 3. Client

**New: `src/services/ai/enclave/attestation.ts`** exports `verifyEnclave(signal?): Promise<{ hpkePublicKey, enclave, verified: true }>`, `invalidateEnclaveVerification()` and `__resetEnclaveVerificationForTesting()` (matching `__resetVersionPolicyForTesting` in `versionPolicy.ts`).

Caching, deliberately minimal:

- Module-level `let pending: Promise<VerifiedEnclave> | null` caches the **in-flight** promise so two concurrent reads verify once, cleared on failure so a transient outage does not poison the session.
- `VERIFY_TTL_MS = 10 * 60_000`. `versionPolicy.ts`'s own memo comment is the precedent and the warning: "THE PROCESS, NOT THE LAUNCH, and on iOS those are very different things: a phone that is only ever backgrounded and resumed can hold this value for days." Verification is one round trip, so a short TTL is close to free and bounds how long a rotation can bite.
- `managedProvider` calls `invalidateEnclaveVerification()` in the catch of any failed sealed request. Not "on a stale-key-shaped failure": we do not know what shape a rotation takes on the wire, and classifying a failure we have never seen is how you write a branch nobody can test. Clearing unconditionally covers every shape, costs one extra verification after a failure that already cost the user a retry, and has no re-entrancy at all.

There is deliberately **no automatic retry**. A rotation costs the first user to hit it one failed extraction with a retryable toast, and their retry succeeds. It also fails toward not-charging, since a rejected seal is a non-200 upstream and `closeRead` never runs.

Its own `AbortSignal.any([caller, AbortSignal.timeout(10_000)])` so verification cannot silently eat the 30s extraction budget. Lazy `await import()` (the established pattern, 30-plus sites in `src/`).

Error classification, one new code only:

- verification did not pass: `ExtractionProviderError('attestation_failed', ...)` plus `reportError({ surface: 'ai-enclave', severity: 'critical' })`. Critical: a user action failed.
- the well-known fetch failed: reuse the **existing** `upstream_busy`. `useExtractionErrorToast.ts:95-99` already renders it as a friendly retry toast with no error surface, which is correct for a transient upstream outage.

**New: `src/services/ai/enclave/seal.ts`** exports `seal(publicKey, bytes)` returning `{ ciphertext, headers, context }` and `open(context, bytes)` over `ehbp`, plus base64 via `src/utils/encoding.ts`.

**Refactored: `src/services/ai/providers/openaiCompatible.ts`** exports two things that already exist inside it: `buildSignal` (deleting the byte-identical copy in `managedProvider.ts`), and `parseChatCompletion<T>(rawEnvelope, parse)`, the `choices[0].message.content` read, the fence strip and the `malformed_output` classification, lifted verbatim. `callOpenAiCompatible` then calls it too, so there is one copy. Per finding Q, `parseChatCompletion` keeps the existing static message and must not fold the cause into a user- or telemetry-visible detail.

**Rewritten transport: `managedProvider.ts`**

```
run(task, request):
  guard text length <= MANAGED_TEXT_BILL_BOUND
  try:
    enclave = await verifyEnclave(request.signal)     // TTL-memoised; throws before any send
    messages = EXTRACTION_TASKS[task].buildMessages(source, todayIso, request.correction?.to)
    { ciphertext, headers, context } = seal(enclave.hpkePublicKey, { model?, messages, temperature: 0 })
    body = await postToProxy({ protocol:'ehbp-1', familyId, task, srcHash,
                               correction?: { token }, ehbp: headers, sealed: b64(ciphertext) })
  catch (err):
    invalidateEnclaveVerification(); throw err
  result = parseChatCompletion(open(context, b64decode(body.sealed)), EXTRACTION_PARSERS[task])
  if (correction?.to && result.kind !== correction.to)
      throw result.kind === 'none' ? 'correction_disagreed' : 'malformed_output'
  result.attestation = { enclave: enclave.enclave, verified: true }
  if (body.correction) result.correction = body.correction
```

Note `correction: { token }` with no `to` (finding O), no `todayIso` on the envelope (the client builds the prompt), and the attestation built from the client's verified value (requirement 11).

`postToProxy` keeps its entire existing `!res.ok` ladder unchanged, plus two additions in the `unknown_task` style, neither with a new user-facing string:

- `code === 'unknown_protocol'` maps to `not_available` with a console line naming the deploy order.
- `code === 'payload_too_large'` maps to `provider_error` with a console line naming the page count and the cap. This requires adding `code: 'payload_too_large'` to the Lambda's **existing** 413 at `index.mjs:101-103`, which is one word, covers both arms, and is strictly better than a client-side size estimate: the server's verdict is the real one, and a client bound would have to guess the envelope overhead to avoid being wrong in the direction that matters.

`srcHash`: `sha256Hex('t:' + text)` or `sha256Hex('i:' + imageDataUrls.join('\n'))`, mirroring `sourceFingerprint`.

`MANAGED_TEXT_BILL_BOUND = 32_000`, the bill bound that moved client-side when the Lambda stopped being able to read the text (finding L). Its comment names `MAX_SHARE_TEXT_CEILING` (`src/services/share/types.ts:67`) and `MAX_SHARE_TEXT_CHARS` (`:54`) and says why all three exist and must not be folded.

**New codes and strings**: exactly one code, `attestation_failed`; one `case` in `useExtractionErrorToast.ts` with a console line telling a developer to check the enclave measurement; two keys in `uiStrings.ts` (`en` + `beanie`, enforced by `uiStrings.test.ts`). The copy must say the document was **not** sent.

### 4. The envelope

Request, plaintext JSON beside the base64 ciphertext:

```
protocol: 'ehbp-1'   // discriminator; anything else is rejected with a code
familyId, task, srcHash, correction?: { token }, ehbp: { 'ehbp-*': ... }, sealed: <base64>
```

Response: `{ sealed: <base64>, correction?: { token }, ehbp: { 'ehbp-*': ... } }`.

Header relay rule, both directions: only `/^ehbp-[a-z0-9-]{1,48}$/i`, at most 16, everything else dropped with `console.warn('[ai-extract] dropped header(s): <names>')`. Header names carry no document bytes. A prefix rule rather than a frozen allowlist is deliberate: an `ehbp` version that adds a header is then forwarded rather than silently dropped, which removes the version coupling entirely instead of compensating for it with a dependabot rule. `ehbp` and `@tinfoilsh/verifier` are still pinned exactly and still get a **major-only** dependabot ignore, so security patches and minors on a crypto library keep flowing.

### 5. Parity test

`src/services/ai/__tests__/lambdaContractParity.test.ts` imports the real `.mjs` modules, precedent being `extractionPromptDrift.test.ts`, and asserts:

- `srcHash` matches `sourceFingerprint` for both source kinds. This is the load-bearing one: a divergence silently refuses every correction and fires `GRANT_MISMATCH_PREFIX`, the alarm that means the feature is broken.
- `MANAGED_TEXT_BILL_BOUND === MAX_TEXT_CHARS`.
- the `'ehbp-1'` protocol literal matches the Lambda's.

## Deploy Sequence and Rollback

1. **Lambda**: router `if`, `sealedForward.mjs`, `upstream.mjs`, the `openRead` signature, the meter and grant changes, the 413 `code`, the comment checklist. Apply by terraform. The legacy arm still serves every client, so verify a real extraction and a real correction from the current production bundle, and watch the legacy counter for a clean baseline.
2. **Bundle**: ship the sealed client. The legacy counter starts falling.

Rollback of step 1 carries the one-hour correction caveat in Important Notes. Rollback of step 2 is free: an old bundle is exactly the legacy arm the new Lambda still serves, which is the whole reason the arm exists.

**Retirement, once (finding K):**

1. Sealed build live on both stores.
2. Raise `promptBelowVersion` in `web/public/min-app-version.json` to that version, per `docs/runbooks/native-store-submission.md#7`, if greg judges a privacy gate a reason everyone should move (open question 2). If not, skip and let the tail drain.
3. Legacy counter at zero for a full release cycle (Logs Insights query in ADR-030).
4. `grep -rn LEGACY-PLAINTEXT-ARM`, delete the marked block, delete `extractionPrompt.mjs`, drop its branch from `extractionPromptDrift.test.ts`, and flip ADR-030 Gate 3 from "closed for sealed clients" to closed.

## Files Affected

- **New**: `infrastructure/lambda/ai-extract/sealedForward.mjs`, `.../upstream.mjs`, `src/services/ai/enclave/attestation.ts`, `src/services/ai/enclave/seal.ts`, `src/services/ai/enclave/__tests__/attestation.test.ts`, `.../seal.test.ts`, `src/services/ai/__tests__/lambdaContractParity.test.ts`.
- **Modified**: `managedProvider.ts` (including its header), `openaiCompatible.ts`, `types.ts` (one new code), `useExtractionErrorToast.ts`, `uiStrings.ts`, `managedProvider.test.ts`, `infrastructure/lambda/ai-extract/index.mjs` (router `if`, 413 `code`, the `openRead` call site, comments, markers), `meter.mjs`, `correctionGrant.mjs`, `meter.test.mjs`, `handler.test.mjs` (new sealed-arm cases only; the existing ones stay unchanged), `.github/dependabot.yml`, `docs/adr/030-private-ai-tiered-architecture.md`, `docs/adr/035-plain-text-share-provenance.md`, `package.json`.
- **Marked, not changed**: `infrastructure/lambda/ai-extract/extractionPrompt.mjs`, one `LEGACY-PLAINTEXT-ARM` header comment noting that a task added here before retirement must be copied to all three registries, or the arm retired first.
- **Unchanged, deliberately**: `infrastructure/terraform/modules/ai-extract/main.tf`, `extractionPromptDrift.test.ts`, `scripts/spikes/extractionPrompt.mjs`, `src/services/ai/extractionPrompt.ts`, `documentExtractionService.ts`, `diagnosticContext.ts`, `native-store-submission.md`, `PrivacyInfo.xcprivacy`, `privacy.astro`, all AI Vue components.
- **Deleted**: nothing, this change.

## Observability Coverage

Surface `ai-enclave` (new, kebab-case, greppable). **No new context keys**: only the allowlisted `action` and `error_code` (`src/utils/diagnosticContext.ts:61`) are used; everything else rides in `message`.

- `logEvent({ level:'info', surface:'ai-enclave', message:'attestation verified in <ms>ms (enclave=<name>)', context:{ action:'verify' } })`, emitted on a **real** verification only, never on a memo hit, so the line measures verification rate and cost without one event per extraction.
- `reportError({ surface:'ai-enclave', severity:'critical', message:'attestation verification failed, send refused: <reason>', context:{ error_code:'attestation_failed' } })`.
- `reportError({ surface:'ai-enclave', severity:'error', message:'enclave key fetch failed: <reason>', context:{ error_code:'upstream_busy' } })`, telemetry and console only, never pages.
- Client console lines for `unknown_protocol` (deploy order) and `payload_too_large` (page count and cap).
- Lambda: `console.warn('[ai-extract] unknown protocol')`, `console.warn('[ai-extract] dropped header(s): <names>')`, `console.log('[ai-extract] legacy plaintext request task=...')`, `console.log('[ai-extract] ok task=<task> sealed')`. All byte-free.

**Blind triage**: verification failure gives the critical event naming the reason. Key fetch failure gives the error event. A key rotation gives one failed extraction whose retry succeeds, visible as a spike in `attestation_failed` or `malformed_output` followed by a spike in `verify`. Deploy-order mismatch gives the Lambda warn plus the client's friendly `not_available`. Seal or open failure gives `malformed_output` with a console line naming which side failed. An oversized payload gives the Lambda's classified 413 and a client console line. An `ehbp` version that added a header is forwarded, and anything genuinely unexpected gives the dropped-names warn. Legacy traffic still arriving gives the counted line. Model output we cannot parse is now only visible client-side, as `malformed_output`, which is the replacement for the server log that dies with the plaintext arm.

## Acceptance Criteria

- [ ] A managed-tier document is ciphertext at the Lambda; deliberately logging the request body yields no plaintext, and the sealed envelope carries no `correction.to` and no `todayIso`.
- [ ] `handler.test.mjs`'s existing cases pass **unchanged** after the `upstream.mjs` extraction.
- [ ] The client refuses to send when verification fails, proven by a test that forces failure and asserts no fetch to `PROXY_URL` occurred.
- [ ] `AttestationInfo` on a sealed read is built from the client's verified enclave, and `verified` is true only after real verification (see open question 1).
- [ ] The verification memo expires after `VERIFY_TTL_MS`, proven with a fake clock, and is cleared after a failed sealed request, proven by a test asserting the next call re-verifies.
- [ ] Two concurrent reads produce exactly one verification.
- [ ] A text source over `MANAGED_TEXT_BILL_BOUND` is refused client-side before sealing, and `MANAGED_TEXT_BILL_BOUND === MAX_TEXT_CHARS` is asserted by the parity test.
- [ ] `srcHash` matches `sourceFingerprint` byte for byte on both source kinds, asserted by the parity test.
- [ ] An oversized sealed body gets the Lambda's 413 with `code: 'payload_too_large'` and a client console line, not a bare `provider_error`.
- [ ] The client kind-guard reproduces the legacy Lambda's verdicts, `none` to `correction_disagreed` included.
- [ ] Corrections still work end to end after the kind-binding drop: a grant is issued on a paid `share` read and spent once on a re-read of the same document, with a token-only correction.
- [ ] A bean is counted exactly once per **answered** read, `kind: 'none'` included, and the sealed arm's changed count point (finding M) is written into `meter.mjs` and ADR-030.
- [ ] An old bundle (no `protocol`) still extracts successfully against the new Lambda.
- [ ] A new bundle against an unknown protocol gets the friendly "not set up yet" notice, never an opaque error and never a plaintext send.
- [x] `task: 'constructor'` on the sealed arm is forwarded and metered without throwing. **AMENDED:** `task: '__proto__'` is REFUSED with a 400 `bad_task`, not forwarded. The implementation added `TASK_RE` (`/^[a-z][a-z0-9_-]{0,31}$/`) because the sealed arm has no `EXTRACTION_TASKS` registry to gate on and the task is LOGGED — and a length bound alone still lets a caller forge an alarm literal (`[ai-extract] usage-count skipped` is 32 characters), so the charset is the fence. Refusing is strictly safer than forwarding and the criterion is corrected to match the code rather than the code loosened to match the criterion.
- [ ] Rate limiting applies to every sealed request, image reads included.
- [ ] `Authorization`, `x-api-key` and `Cookie` supplied in the `ehbp` map are never relayed upstream, proven by a test.
- [ ] The comment checklist is complete in the commit that changes the behaviour, verified by `grep -rn "different.kind\|four guards\|FIVE guards\|and the kind\|TEXT SOURCES ONLY\|GATE 3 (deferred)"` returning nothing stale.
- [ ] `grep -rn LEGACY-PLAINTEXT-ARM` returns every legacy-only site and nothing else.
- [ ] ADR-030 records Gate 3 as closed for sealed clients and open overall, with the dead `sources` fence, the residual metadata (finding P), the changed count point (finding M), the `none`-grant cost (finding N) and the four-step sunset condition with its Logs Insights query. ADR-035's follow-up closed.
- [ ] `ehbp` and `@tinfoilsh/verifier` are pinned exactly and major-ignored in `.github/dependabot.yml`.
- [ ] `npm run validate` and `npm run test:lambda` both green (note `validate` does not include `test:lambda`).
- [ ] The verifier and `ehbp` are absent from the main `index-*.js` chunk, asserted against the built output. (There is no JS bundle budget in `docs/PERFORMANCE.md`; its tables are data sizes.)
- [ ] Every log line in Observability Coverage implemented and observed once in a real run.

## Testing Plan

1. Lambda: the existing `handler.test.mjs` cases pass unchanged after the `upstream.mjs` extraction. That is the proof the refactor is behaviour-free.
2. Unit: verify success, verify failure, two concurrent callers producing exactly one verification, a failure clearing the memo, TTL expiry re-verifying, and a failed sealed request clearing the memo.
3. Unit: seal/open round-trip; a tampered ciphertext fails closed as `malformed_output`, and the failure detail carries no slice of the model output (finding Q).
4. Unit: `lambdaContractParity.test.ts`, all three assertions.
5. Unit: verification failure yields `attestation_failed` and **zero** fetches to the proxy.
6. Unit: the client kind-guard over every `(resultKind, hint)` pair.
7. Unit (Lambda): an `ehbp-1` request forwards the decoded body and `ehbp-*` headers, forwards no client `Authorization` / `x-api-key` / `Cookie`, and warns with the names of dropped headers; unknown protocol returns `unknown_protocol`; a legacy body still takes the old path; metering counts on upstream 200 with no result; `checkLimits` runs for a request with no text; `task: '__proto__'` is safe; a token-only correction validates.
8. Unit (Lambda): a grant issued with no `resultKind` is still issued and still consumable exactly once against the same `srcHash`. **Add this to `meter.test.mjs` BEFORE touching `correctionGrant.mjs`, so the break is visible first.**
9. Browser: a real extraction end to end with the network tab showing a sealed body and no `to` field; and a real correction end to end.
10. Bundle: verifier and `ehbp` not in the main chunk.

## Decisions taken (greg, 2026-09-16)

1. **What "surfaced" means for `verified`: RESOLVED, no new UI.** The honest reading is "actually check it rather than taking Tinfoil's word", which is the substance of this whole change. The flag is set only on a real verification, carried on the result and logged. No new component, no new privacy copy.

   The settling evidence: `src/content/help/security.ts:732` **already** tells users "You can verify it: the enclave publishes a live _attestation_, a cryptographic proof of exactly what hardware and code are running, so the privacy promise is not just our word for it." That claim is currently AHEAD of the code, which is precisely what ADR-030's "never claim more than the shipped code verifies" principle exists to prevent. This change makes the existing copy true rather than aspirational, so nothing new needs saying. A visible "verified" badge is a small follow-up with wording greg writes.

2. **The bean-count trade (finding M): ACCEPTED, and to be documented loudly.** On the sealed arm a bean is spent when the enclave answered, not when we could read the answer. It is rare (it needs the model to emit unparseable JSON), and every alternative is a client-declared refund, which is a meter bypass by construction.

   ⚠️ **This makes one clause of the 2026-09-14 CHANGELOG partly untrue for sealed clients**: "Refusals, timeouts and unreadable answers cost nothing." Timeouts and refusals still cost nothing (a non-200 upstream never reaches `closeRead`). An _unreadable answer_ now costs a bean on the sealed path. It must be written into `meter.mjs`, `closeRead`'s docstring and ADR-030. Amending the public wording is greg's call and is NOT done here.

3. **Update floor for retirement (finding K, step 2): DEFERRED, not blocking.** It only matters once the sealed build is live on both stores. Revisit then.

## Root of trust: RESOLVED 2026-09-16 (was the one build blocker)

`Verifier` needs a `configRepo`, and the plan never named one. It is **Tinfoil's repo, not ours**: its signed releases publish the expected enclave measurement that the attestation is checked against. (A third party CAN own one for their own enclave, e.g. `OpenMined/syft-enclave-tinfoil`, but for Tinfoil's hosted inference it is Tinfoil's.)

```
configRepo: 'tinfoilsh/confidential-model-router'
serverURL:  'https://inference.tinfoil.sh'      // the scheme is required, a bare host throws "Invalid URL"
```

Verified end to end, not inferred. `scripts/spikes/enclave-attestation.mjs` runs the real verifier against the live enclave and is kept for re-running when the enclave, the config repo or the verifier version changes. Measured 2026-09-16:

```
VERIFY OK
  result keys : measurement, tlsPublicKeyFingerprint, hpkePublicKey
  hpkePublicKey: ed86fde6...           <- what Identity.fromPublicKeyHex() consumes
  configRepo  : tinfoilsh/confidential-model-router
  enclaveHost : inference.tinfoil.sh
  releaseTag  : v0.0.150
  codeMeasurement predicate: https://tinfoil.sh/predicate/snp-tdx-multiplatform/v1
```

Note `tlsPublicKey` is absent from the result while `hpkePublicKey` and `tlsPublicKeyFingerprint` are present. We need the HPKE key, so that is fine, but do not write code expecting `tlsPublicKey`.

**A design detail the plan missed, from docs.tinfoil.sh/guides/proxy-server**: the documented blind-proxy pattern has the proxy forward to the enclave URL given in an **`X-Tinfoil-Enclave-Url`** header, adding the API key on the way through. Our Lambda already knows its enclave from `TINFOIL_API_BASE`, so it does not need to trust a client-supplied URL, and it should NOT: honouring that header from a caller holding the bundle's `x-api-key` would let anyone point our key at an arbitrary host. Decision: keep using `TINFOIL_API_BASE`, and never relay `X-Tinfoil-Enclave-Url`. Note this beside the `ehbp-*` relay allowlist, which already excludes it by shape.

### The ehbp API, corrected

The plan assumed standalone `seal(publicKey, bytes)` / `open(context, bytes)`. Those do not exist. The real API, confirmed by reading the installed `.d.ts`:

```
Identity.fromPublicKeyHex(hex)                        // "for clients who already have the key", i.e. us
identity.encryptRequestWithContext(Request)           // the plan's seal()  -> { request, context }
identity.decryptResponseWithContext(Response, context)// the plan's open()
PROTOCOL.ENCAPSULATED_KEY_HEADER / RESPONSE_NONCE_HEADER   // import these, never hardcode
```

The architecture is unchanged; only `seal.ts`'s internals differ.

## Still owed before this is done

- **Assumption 1 remains BLOCKING for native.** The CORS spike was run from a browser origin. The native WebView origin differs (`capacitor://app.beanies.family` on iOS). This cannot be verified from CI or a simulator, so it joins the on-device list: confirm a real managed-tier extraction works from a TestFlight/Play build before the sealed client is promoted. If it is refused there, the `CapacitorHttp` contingency in requirement 1 applies.

## Review Passes

- **Pass 1 (Initial draft)**: drafted from the pre-plan block plus a direct read of the provider, Lambda and meter; surfaced the meter/encryption conflict the tracker row predated.
- **Pass 2 (DRY + error handling)**: verified every reuse claim against source. Killed a parallel build/parse/classify implementation in favour of `openaiCompatible.ts` seams; cut two new error codes to one; cut five proposed telemetry context keys to zero, removing the privacy-declaration chain from scope; replaced an uncompilable `perfTiming.record` call. Caught three correctness breaks the draft would have shipped: `issueGrant`/`consumeGrant` silently disabling all corrections, store builds breaking on a forwarder-only cutover, and the rate limiter plus `sources` fence becoming unenforceable. Replaced a header-based wire format that rested on a false claim about exposed headers with a JSON envelope.
- **Pass 3 (Sustainability)**: attacked the two-arm liability directly. Found the retirement lever already in the repo (`min-app-version.json` plus `versionPolicy.ts` plus runbook §7) and turned "delete it someday" into a sequence with a trigger. Caught a reliability hole (a never-expiring attestation memo that turns a key rotation into an opaque toast), a supply-chain coupling (a frozen header allowlist against a caret-ranged dependency Dependabot bumps weekly), and a rollback hazard nobody had written down (grants issued by the new Lambda are refused by the old one for up to an hour). Refused to mint a third `32_000`. Counted the comment sites asserting the kind-binding. Tightened requirement 14 so ADR-030 says "closed for sealed clients, open overall".
- **Pass 4 (Fresh-eyes sweep)**: audited the security property end to end and cut the plan back to what encryption requires. Four new gaps named: the bean-count point moves on the sealed arm, so an unparseable answer now charges a bean where today it charges nothing (finding M, an accepted trade that had been asserted as safe); dropping the kind filter also drops `issueGrant`'s "never for `kind: 'none'`", writing grants the UI can never spend (finding N); `correction.to` was still riding the envelope in cleartext with no server-side purpose left, leaking the family's own assertion about their document (finding O, removed); and `srcHash` is the one new cleartext fingerprint, which must stay unsalted or a mid-hour app update trips the `different_source` alarm (finding P). Added the V8 `JSON.parse` message rule so model output cannot reach the firehose (finding Q). Seven things cut as scope creep or as worse-than-the-alternative: the `legacyPlaintext.mjs` pure-move of 200 lines of working security code; the `extractionPromptDrift.test.ts` rework; the terraform metric filter; the shared kind-guard fixture; `MANAGED_SEALED_MAX` and its headroom arithmetic, replaced by adding `code: 'payload_too_large'` to the Lambda's existing 413; the automatic single re-verify, replaced by a TTL plus clearing the memo after any failed sealed request; and the frozen EHBP header allowlist, replaced by an `ehbp-*` prefix rule. Replaced the brittle "seven comment sites" count with a thirteen-item checklist and a grep.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial prompt (2026-09-16)

> once that is done, please go ahead with /beanies-pre-plan for #49 then move direct to /beanies-plan and once done direct to /beanies-build-auto - work autonomously and ensure you are implementing only what is required (end to end encryption for ai) and take the simplest, most direct, and most maintainable route possible. if you have any questions please ask now, then proceed as per the above prompt

### Decisions taken during planning (AskUserQuestion, 2026-09-16)

> **Grant kind-binding**: "Drop kind-binding, keep the rest" — the grant stays bound to family + task + document hash and stops being bound to the result kind; the kind-guard 422 moves client-side.

> **srcHash trust level**: "Yes, consistent with familyId" — a client-computed srcHash sits at the same trust level as the already-forgeable familyId.

</details>
