# Plan: Pod load runs out of memory — make the failure honest, non-destructive and measurable (#90 Tier 1)

> Date: 2026-09-04
> Related issues: Notion #90 (Tier 1 only). Notion #43 is Done and owns the compaction pivot that shipped; this work owns the half it deferred.
> Plan file: `docs/plans/2026-09-04-pod-load-oom-tier1.md`
>
> **No GitHub issue created.** This plan was approved for direct implementation.

## User Story

As a family setting up beanies on a cheap or second-hand tablet, I want the app to tell me honestly when my pod is too big for that device — instead of showing a red "corrupt payload" error, silently deleting my local cache, and leaving me stuck — so that I know what is wrong and we can measure how often it happens.

## Context

Signing in with the ~4MB Parker Meng Beanies production pod FAILS on a Samsung Galaxy Tab A9+ (SM-X210):

```
Automerge.load failed on decrypted payload: error inflating document chunk ops: out of memory
```

That is an October 2023 mainstream tablet (Snapdragon 695, 4/8GB RAM, Android 13). The 3GB Galaxy Tab A7 (SM-T500, 2020) is the agreed design floor. This blocks the beanie wall promise (#78) that a cheap or second-hand tablet can run the wall.

### What the failure actually is (corrected during planning)

The pre-plan assumed two documents were resident in WASM at the failure point. **They were not.** The tablet was a fresh install, so:

- `initAndLoadCache` was a cache MISS → `loadedFromCache === false`
- `syncStore.ts:846` therefore ran `docClient.dropDoc()` (`// no doc for THIS family → adopt remote fresh, never merge into a foreign doc`)
- `mergeRemoteEnvelope` took its `!currentDoc` **adopt** branch (`applyAndProject.ts:638-642`)

So exactly ONE `Automerge.load` was in flight. The OOM is the WASM cost of inflating a single history-heavy document.

**This is why Tier 1 cannot make the pod load, and this plan does not claim it will.** Measured on synthetics matching the real edit pattern: a full-history 0.86MB doc costs 183MB peak RSS and 16.5s to load (212× its file size); the same state compacted is 0.13MB, 2.5MB, 0.22s (20×). Trimming ~21MB of JS-heap waste does not close a gap of that shape. **Making the pod load is Tier 2's job (merge-safe history compaction).**

What Tier 1 delivers instead:

1. The failure stops being a **lie** (it is reported as file corruption).
2. The failure stops being **destructive** (it deletes the local cache, which cannot help).
3. The failure stops being **invisible** (it is classed as expected degradation and stays quiet).
4. The failure stops being a **dead end** for the user.
5. We gain the **diagnostic** that tells us how much of a real pod is history — the number Tier 2 must be designed against, which nothing in the codebase can currently produce.
6. The avoidable JS-heap waste goes away, which helps every device on every load.

## Requirements

1. **An allocation failure is classified as its own error, not as corruption.** `loadAndVerify` (`docOps.ts:223-245`) currently wraps EVERY `Automerge.load` throw in `CorruptPayloadError`. Add a sibling error for allocation failure and throw that instead when the underlying error is recognisably an OOM.
2. **An allocation failure never clears the local cache.** `initAndLoadCache` (`applyAndProject.ts:490-503`) calls `cache.clearCache(id)` on ANY load throw. That is correct for genuine corruption (it lets a clean re-seed happen) and actively harmful for an OOM: the cache is fine, deleting it cannot help, and the retry re-downloads and fails identically — having destroyed the one copy that might have loaded. (This path is _not_ what failed on the Tab A9+ — that was a cache miss — but it is what fails on **every load after the first successful one**, which is the steady state we are protecting.)
3. **Classification is conservative and additive.** When the underlying error is not recognisably an allocation failure, behaviour is EXACTLY as today (`CorruptPayloadError` + cache clear). A misclassified corruption would skip the clear that genuine corruption needs to self-heal, so the default must remain the existing path.
4. **An allocation failure emits a distinct, queryable diagnostic event**, from ONE choke point **that covers worker AND inline mode** (see Approach §3), carrying enough to measure the fleet-wide rate and correlate it with device class — and adding **zero** new allowlisted context keys. **Exactly one event per failure**, including from the UI layer (see §2).
5. **The user gets an honest message, in the existing fatal-error overlay, with the overlay's own existing action.** It is a device memory limit, not a damaged file, and the copy must say so. New copy through `uiStrings.ts` with both `en` and `beanie`. The overlay has no CTA slot, and its existing Reload button already delivers the only action that materially differs from re-running the attempt — see §4.
6. **A pod diagnostic exists and has been run against the real production pod.** It reports change/op count, full vs compacted size, and peak RSS. Nothing in `src/` calls `Automerge.stats`, `getAllChanges` or `getHistory` today, so nobody can say how history-heavy any real pod is — including greg's.
7. **The avoidable JS-heap copies are removed.** Target: no more than 3 simultaneous full-size copies of the payload during sign-in, down from 7 — with the removed copies **enumerated by name** so the claim is checkable (see §6).

## Important Notes & Caveats

- **WASM32 linear memory is the ceiling, not device RAM.** An 8GB tablet fails the same way. "Buy a better tablet" is not a fix and must not appear in the user-facing copy.
- **A grown WASM memory never shrinks.** `dropDoc()` frees the _doc_, not the linear memory the failed inflate already grew into. Only tearing down the realm that owns it returns it. In worker mode that is a worker terminate; in inline mode (`docClient.ts:224`) the realm IS the main thread and only a page reload reclaims it. **§4 resolves this to a single answer for both modes — a page reload.**
- **Cost scales with OP COUNT, not bytes.** A small file with pathological history can be worse than a larger clean one, so `beanpodSizeKb` (the only signal in the registry today) is a poor proxy. This is precisely why Requirement 6 exists.
- **The cache-then-remote ordering is load-bearing for CROSS-FAMILY SAFETY, not incidental.** `syncStore.ts:826-847` is explicit: on a cache miss the worker may still hold a DIFFERENT family's doc, and merging a remote into it produces "an A∪B doc that then gets persisted to B's cache and uploaded to B's file — durable cross-family corruption." **Do not reorder or skip these calls to save memory.** The two-doc peak is real on a poll-merge (cache hit), but it is not what failed here, and the safety property outranks the saving.
- **`loadIncremental` is NOT a drop-in for `merge` here.** It would avoid materialising a second full doc, but #65 requires `remoteHeads` to be the heads of EXACTLY the Drive bytes, captured from the separately-loaded remote doc before any merge (`applyAndProject.ts:626-634`). Applying the remote incrementally into the local doc destroys the ability to capture that, and the comment there is explicit that over-claiming heads is the false-skip #65 exists to prevent. Out of scope; note it for Tier 2.
- **Op count is NOT available at OOM time.** If the document could not be loaded, its ops cannot be counted — that is the failure. The event carries what IS knowable (decrypted payload bytes, device memory, platform, step); op count comes from the offline diagnostic.
- **The unattended-wall requirement is already satisfied.** `syncService.ts:219-235` already wraps every poll tick in try/catch, reports at `severity: 'warning'` with `surface: 'local-file-polling'`, and keeps the loop running — an OOM on a background reload therefore already retries on the next tick and is already non-silent. Add a test, not code.
- **Retry spam is already throttled — but only if the message is CONSTANT.** `errorReporter.ts:145-146` buckets by `(surface, normalizeMessage(message))`, and `normalizeMessage` (`diagnosticContext.ts:370-376`) only collapses UUIDs, ISO timestamps, 6+-digit runs and 8+-char hex. A message embedding a per-pod KB figure (`…a 5432KB pod`) therefore produces a DIFFERENT bucket key per pod and defeats both dedup layers. **The event message must be a fixed string per `step`; the size travels in `perf_doc_bytes`.**
- **Device model is ALREADY in every report.** `enrichAndRedact` auto-attaches the full `navigator.userAgent` as `browser` (`diagnosticContext.ts:542`), which on Android carries the model (`SM-X210`). `os` and the new memory scalar are additive refinements, not the only way to correlate device class — so neither is load-bearing and neither justifies new paperwork.
- **Class names must never be derived from `Ctor.name`.** The worker error registry keys on `err.name` (`protocol.ts:210`), and the production build minifies — terser renames classes. Every `this.name = '…'` and every `ERROR_REGISTRY` key must be a **literal string**, never `new.target.name` or `Ctor.name`. The existing `CorruptPayloadError` already does this (`types/sync.ts:146`); the new hierarchy and the new codec factory (§1) must not regress it.
- **Mixed-version fleet.** Older builds in Play open testing and TestFlight keep writing full history throughout, so nothing here may depend on every writer being updated.
- **Must not require re-login or invalidate recovery kits.**
- **Do not re-implement the pod crypto in the diagnostic.** The decrypt path is security-critical and already exists; a second copy is both a DRY violation and a security risk.
- **The envelope's `encryptedPayload` has THREE long-lived holders, not one.** `syncStore.envelope` (via `replaceEnvelope`, `syncStore.ts:201-207`), `syncService.currentEnvelope` (written at `syncService.ts:568` _and_ `:602`, i.e. `setEnvelope` is not the only write path), and the IndexedDB envelope cache, which `JSON.stringify`s the WHOLE envelope including the multi-MB base64 string on every key change (`cache.ts:342-348`).
- **The IDB envelope cache has a THIRD writer that bypasses `syncService`.** `syncStore.ts:1897` calls `docClient.persistEnvelope(env)` directly from `createNewFile`, not via `persistEnvelopeSafely`. **Stripping must therefore happen in `worker/cache.persistEnvelope` — the single true sink — not only in the two `syncService` callers.**

## Assumptions

> Review these before implementation.

1. **The reported failure was a single-document load** (fresh install → cache miss → adopt branch). Verified by reading `syncStore.ts:838-848` and `applyAndProject.ts:638-642`, not assumed.
2. **History dominates the real pod** — the 212× figure comes from a synthetic in the same regime, NOT from greg's file. Requirement 6 exists to replace this assumption with a measurement. **If the diagnostic shows the pod is mostly live data rather than history, Tier 2's shape changes and this plan's framing should be revisited.**
3. Automerge's Rust OOM surfaces to JS in a recognisable form. The observed message was `error inflating document chunk ops: out of memory`. Detection must be pattern-based and therefore must fail SAFE (Requirement 3) — see §1 for the narrowed match set.
4. `crypto.subtle` under vitest's `happy-dom` environment (`vitest.config.ts:10`) can perform the same AES-KW / AES-GCM / PBKDF2 operations the browser path uses (the existing `src/services/crypto/__tests__/familyKeyService.test.ts` runs under exactly that config, so this is close to verified already).
5. ~~The payload retained on `envelope.value` is not needed after hand-off.~~ **VERIFIED, no longer an assumption.** A full-tree grep for `encryptedPayload` returns exactly these non-test readers: `docOps.ts:249`, `applyAndProject.ts:623`, `docClient.ts:442-443` (all worker-side, all fed a freshly-parsed envelope), `fileSync.ts:80` (validation), `fileSync.ts:48` (`serializeBeanpodV4`, which takes the payload as a **parameter**), and `reEncryptEnvelope` (`fileSync.ts:209-215`), whose two callers (`syncStore.ts:2362`, `syncService.ts:1286`) both pass a **freshly exported** payload and overwrite the field. **Confirmed independently for the IDB cache:** the cached envelope is consumed only at `syncStore.ts:1452-1462`, and that branch bails unless the _doc_ cache also hit (`if (!cachedEnvelope || !loaded) return`) — the document never comes from the cached envelope's payload.
6. `pendingEncryptedFile.value.envelope` IS re-read on every password retry (`syncStore.ts:1211`, `:2016`) and is passed to `docClient.mergeRemoteEnvelope` at `:1238` and `:2028`, so "null the pending reference as soon as the worker has it" would break wrong-password retry. See §6.
7. **No `mergeRemoteEnvelope` / `verifyEnvelope` caller passes a long-lived envelope.** Verified: `syncStore.ts:847` (fresh parse), `:866` via `hydrateFromEnvelope` — both callers (`:2673`, `:2805`) pass `pendingEncryptedFile.value.envelope` — `:1010`, `:1038` (fresh parse), `:1238`, `:2028` (pending), `syncService.ts:1202` (fresh parse). §6 adds an RPC-boundary guard so this stays true.

## Approach

### 1. A sibling error class for allocation failure

**Predicate — follow the established one-file classifier precedent, not `types/sync.ts`.** The codebase already has three of these: `src/utils/isNetworkError.ts:15`, `src/utils/benignBrowserError.ts:24`, `src/utils/idbTransient.ts`. Each is a single narrow exported predicate with its own test and a comment explaining why it must stay narrow.

New `src/utils/isAllocationFailure.ts`, same shape:

```
export function isAllocationFailure(e: unknown): boolean
```

**The match set is explicit memory phrases only.** Two otherwise-tempting matchers are dropped:

- **`e instanceof RangeError` — DROP.** `RangeError` is the engine's response to `new Uint8Array(<absurd length>)` ("Invalid array length" / "Array buffer allocation failed"), and a _corrupt_ payload with a garbage length prefix produces exactly that. Blanket-matching `RangeError` therefore misclassifies a whole class of genuine corruption as OOM and skips the cache clear that corruption needs to self-heal — the precise failure Requirement 3 forbids.
- **A bare `unreachable` wasm trap — DROP.** In release wasm, _every_ Rust `panic!`/`unwrap()` compiles to an `unreachable` trap, not just `rust_oom`. Matching it would classify most Automerge decode panics as OOM, with the same self-heal regression.

Matching `isBenignBrowserError`'s exact-string discipline (`benignBrowserError.ts:19-22`) rather than `isNetworkError`'s broader regex:

- `/out of memory/i` (the observed message)
- `/memory allocation failed/i`
- `/allocation size overflow/i`
- `/array buffer allocation failed/i`
- `/wasm memory|cannot grow memory|memory\.grow/i`

**One bounded traversal.** Automerge 3.x wraps some Rust failures, so test the message of `e` **and of `e.cause` at depth 1 only** (a fixed single hop — no loop, so no cycle risk and no unbounded walk). Anything unmatched is NOT an allocation failure (Requirement 3). The doc comment states the rule explicitly: **a false positive is worse than a false negative here** — a missed OOM degrades to today's behaviour, a false positive breaks corruption self-healing. If real-world OOMs arrive in a shape we don't match, we will see them in the firehose as `CorruptPayloadError` and can add the exact string then.

**Error classes — extract a shared base rather than copy-pasting `CorruptPayloadError`.** `src/types/sync.ts:141-151` currently holds `CorruptPayloadError` with `step` + `familyId`. Introduce:

- `abstract class PayloadLoadError extends Error` carrying `step: 'load' | 'materialize'`, `familyId: string | null`, `payloadBytes: number | null`.
- `CorruptPayloadError extends PayloadLoadError` — public shape unchanged, so all existing `instanceof CorruptPayloadError` sites keep working verbatim.
- `PayloadTooLargeError extends PayloadLoadError`.

Each subclass sets `this.name` to a **literal string** (see the minifier caveat above). `PayloadTooLargeError` must NOT extend `CorruptPayloadError` — that would make every existing `instanceof CorruptPayloadError` site treat an OOM as corruption, which is the exact bug we are fixing.

**`docOps.loadAndVerify` (`docOps.ts:223-245`) has two near-identical catch blocks.** Collapse them into one local helper so the classification lives once:

```
function payloadError(step, familyId, bytes, e) {
  const msg = `Automerge ${step} failed on decrypted payload: ${e instanceof Error ? e.message : String(e)}`;
  return isAllocationFailure(e)
    ? new PayloadTooLargeError(msg, step, familyId, bytes)
    : new CorruptPayloadError(msg, step, familyId);
}
```

(Keep the existing wording distinction — the current materialize message reads `Automerge materialize failed on decrypted payload: …`, which the template reproduces.)

`bytes` is `binary.byteLength` — the decrypted size, which is the number that actually predicts the WASM cost, and is strictly better than the base64 length the perf sample carries.

This automatically covers the cache-load path too, since `cache.ts:299` and `cache.ts:321` both call `loadAndVerify`.

**Protocol transport — extend the existing registry with a factory, not a second hand-rolled codec.** `protocol.ts:192-207` hand-writes the `CorruptPayloadError` codec. Replace those lines with a small local factory used twice, **registered under explicit literal keys**:

```
const payloadCodec = (Ctor) => ({
  serialize: (err) => err instanceof Ctor ? { step: err.step, familyId: err.familyId, payloadBytes: err.payloadBytes } : undefined,
  reconstruct: (message, data) => new Ctor(message, data?.step ?? 'load', data?.familyId ?? null, data?.payloadBytes ?? null),
});

const ERROR_REGISTRY = {
  CorruptPayloadError: payloadCodec(CorruptPayloadError),
  PayloadTooLargeError: payloadCodec(PayloadTooLargeError),
  WorkerCrashError: { … unchanged … },
};
```

Without this the `instanceof` dispatch on main silently degrades to `DocWorkerError` (`protocol.ts:224-231`) — a genuine silent-failure risk, which is why test 4 pins it.

### 2. Never clear the cache on an allocation failure

`applyAndProject.ts:490-503` — gate the `clearCache` + `resetDocCursors` block on `!(e instanceof PayloadTooLargeError)`, with a comment explaining that deleting a healthy cache cannot help and destroys the one copy that might have loaded. Re-throw unchanged in both branches.

**Deliberate non-change, recorded so a future reader does not "fix" it.** The obviously tidier shape is a positive allowlist (`if (e instanceof CorruptPayloadError) clear()`) instead of the denylist. It is rejected on purpose: the catch today also fires for IndexedDB and key errors, and converting to an allowlist would silently change behaviour for those, which Requirement 3 forbids in this change. The comment must say this, or the next reviewer will re-open it.

**`docClient.surface()` (`docClient.ts:824`) must also treat the new class as expected-degradation.** Its current line reads `error instanceof CorruptPayloadError || error instanceof WorkerCrashError`. Change the first term to `error instanceof PayloadLoadError` (the new base) — one-token edit that covers both subclasses. Without it, every OOM would _double_-report: once from our own `reportError` in §3 and once from `notifyFailure` (`docClient.ts:786-810`).

**Dispatch sites — SIX, with a shape that stops the fan-out growing.**

Two structural rules:

- **Carry the error, not a flag per class.** At `syncStore.ts:1209`, widen the decrypt result to a single `payloadError?: PayloadLoadError` field instead of `corrupted?` + a new `tooLarge?`. Consumers branch on `instanceof`, and a future sibling class needs no new field. `corrupted?` is renamed, not duplicated — the compiler finds every reader.
- **Extract the surfacing, don't clone it.** In `ResumePodSetup.vue`, hoist the existing `case 'corrupted'` body (`:335-362`) into one local `surfacePayloadFailure(err, fileId, familyId, { copyKey, report })` that builds the diagnostic JSON blob once and calls `fatalErrorStore.setFatal` (and `reportError` only when `report`). Both cases then read as three lines each. The JSON-blob builder itself (`{ fileId, familyId, step, payloadBytes, message }`) belongs next to the error classes in `types/sync.ts` as `payloadErrorDetail(err, fileId, familyId)`, because `useLoginFlow` wants the same blob.

**`report` is not decoration — it closes a double-report.** By the time `ResumePodSetup` sees a `too-large` result, `docClient.surface()` has _already_ emitted the single `pod-load-memory` event (§3): the error reaches `completeAutoLoad` only by propagating out of a `docClient` RPC (`requestCore`'s `throw surface(reconstructError(res.error, method), …)`, `docClient.ts:526`). A second `reportError` here would be a **different surface**, so the `(surface, message)` dedup (`errorReporter.ts:145-146`) cannot collapse it, and Requirement 4's "exactly one event" would be violated on the most common path. So:

- `case 'corrupted'` → `report: true` (unchanged behaviour, `severity: 'critical'`, surface `resumeSetup.podCorrupted`).
- `case 'too-large'` → `report: false`, with a comment naming `docClient.surface()` as the one emitter.

The six sites:

- `syncStore.ts:1362` — `decryptPendingFile`'s catch, now returns `{ payloadError: e }`.
- `syncStore.ts:1665` — `classifyCreateFailure`. Change `instanceof CorruptPayloadError` to `instanceof PayloadLoadError` and keep returning `'verify'`. An OOM on a just-created empty doc is effectively impossible, and inventing a `CreatePodFailureReason` for it is unused surface area; the defensive catch-all is the right answer here.
- **`syncStore.ts:3729` — `completeAutoLoad`'s `if (decryptResult.corrupted)` branch. THIS IS THE LIVE PATH.** `decryptPendingFile` catches its own errors and _returns_ a result, so this branch — not the catch below — is what fires in the reported scenario. Becomes a branch on `decryptResult.payloadError`, returning `kind: 'corrupted'` or `kind: 'too-large'` by `instanceof`.
- `syncStore.ts:3756` — `completeAutoLoad`'s catch, explicitly documented in the code as defensive. Same `instanceof` split. Add `kind: 'too-large'` to the `CompleteAutoLoadResult` union at `types/sync.ts:117-127`, carrying `PayloadTooLargeError`. (Here a distinct `kind` IS right: the switch at `ResumePodSetup.vue:321` is exhaustive, so the compiler points at the site needing the branch.)
- `src/composables/useLoginFlow.ts:780-790` — the `dec.corrupted` branch becomes a branch on `dec.payloadError`, with the copy chosen by `instanceof`. One `if`, two message keys. It reports nothing (it uses `emitProveOutcome`), so no double-report concern; the `errorCode` becomes `'too-large'` for the new class.
- `src/components/login/ResumePodSetup.vue:335-362` — `case 'too-large'` via the extracted helper, `report: false`.

### 3. Telemetry that makes the rate measurable — with zero new context keys

**One choke point — and `surface()` is not currently one.**

`docClient.surface()` (`docClient.ts:815-829`) sees every error that comes back over the _worker_ RPC (`docClient.ts:526` and the timeout paths). It does **not** see inline-mode failures: `requestCore`'s inline branch (`docClient.ts:481-490`) awaits `inlineExecutor(method, args)` and lets the throw propagate raw — the file's own comments at `:900-909` say so explicitly. Inline mode is the fallback when the worker fails to spawn (`docClient.ts:295`, `:310`), i.e. disproportionately the low-end devices this whole plan is about, and there the WASM heap is the _main thread's_. Emitting only from `surface()` would give us a fleet metric that is blind to the worst-affected population.

**Fix, minimal and behaviour-preserving:** wrap the inline branch's await and route its throw through `surface(e, method, /* quiet */ true)`. `quiet: true` skips `notifyFailure`, which is exactly today's inline behaviour, so nothing changes for existing errors — but classification and the new `reportError` now happen for both modes from one function. Two secondary effects, both improvements and both worth stating so a reviewer isn't surprised:

- A non-`Error` thrown by the inline executor now becomes a `DocWorkerError(String(err))` with the message preserved. The `errorMessage.includes('Incorrect password')` matcher at `syncStore.ts:1365` still works.
- `fireAndForget` (`docClient.ts:900-916`) exists _because_ inline never reached `surface()`. It stays as-is. For an inline `mutate` OOM this yields two events on two surfaces; that combination is vanishingly rare (a mutate does not inflate a full history) and removing `fireAndForget`'s net is a worse trade. Recorded here so it isn't mistaken for an oversight.

The emission itself, inside `surface()`:

```
if (error instanceof PayloadTooLargeError) {
  reportError({
    surface: 'pod-load-memory',
    message: `Automerge ${error.step} ran out of memory loading a pod`,   // CONSTANT per step
    error,
    severity: 'error',
    context: { action: 'pod-load-oom', error_code: error.step, perf_doc_bytes: error.payloadBytes ?? undefined, os: getPlatform(), detail: deviceMemoryScalar() },
  });
}
```

**The message carries no size.** A `…a ${KB}KB pod` message would give every pod its own dedup bucket (`errorReporter.ts:145-146` + `normalizeMessage`, `diagnosticContext.ts:370-376`, which only collapses 6+-digit runs), defeating the very throttle the Caveats section says not to rebuild. The size is already in `perf_doc_bytes`, which is where a queryable number belongs anyway.

Every context key here is **already allowlisted and already declared to the stores**: `action` (`diagnosticContext.ts:68`), `error_code` (`:69`), `perf_doc_bytes` (`:156`), `os` (`:100`), `detail` (`:181`). `os` is caller-supplied throughout the codebase (cf. `deliverFile.ts:97`), so passing `getPlatform()` matches the house pattern.

**No new `device_memory_gb` key.** That key would drag in five consumer updates (`ALLOWED_CONTEXT_KEYS`, the Lambda mirror + its pinned test, `docs/runbooks/native-store-submission.md`, `PrivacyInfo.xcprivacy`, the Data-Safety answers, `privacy.astro`) for one coarse integer. Instead ship it as a flat scalar in the already-declared `detail` key — `mem=4,cores=8` — following the flat-scalar format `web_storage` uses (`diagnosticContext.ts:547-553`, `ls=<bool>,ss=<bool>`). Same Diagnostics category, same PII-free contract, no declaration drift. `deviceMemoryScalar()` is a 4-line helper next to `getDeviceInfo` in `src/utils/diagnostics.ts:57`, individually try/caught, returning `null` on any throw so a probe fault never drops the report. `navigator.deviceMemory` is a coarse, spec-clamped bucket (0.25–8) and `hardwareConcurrency` is a small integer — neither is a fingerprinting escalation over the full `browser` UA the firehose already carries.

**One paperwork line keeps this honest.** `detail` is a _shared, free-form, per-surface_ field — today it means "passkey error descriptor" (`diagnosticContext.ts:175-181`). Reusing it without saying so is how a shared key silently becomes unqueryable. Add ONE comment line at that declaration recording that `pod-load-memory` puts `mem=<gb>,cores=<n>` there. Comment-only edit, no allowlist change.

**No new success counter — it already exists.** `mergeRemoteEnvelope` already wraps the load in `time2('automerge.remoteLoad', …, { perf_doc_bytes })` (`applyAndProject.ts:622-624`), which is relayed to main and replayed through `perfTiming.record` (`perfTiming.ts:44-84`), emitting `surface: 'load-perf'` with `perf_op`, `perf_duration_ms`, `perf_doc_bytes` for anything ≥ `TELEMETRY_FLOOR_MS` (250ms, `perfTiming.ts:27`). Two properties make this the right denominator:

- `time2` emits from a `finally` (`applyAndProject.ts:914-921` — verified), so it fires on failure too — the denominator is **attempts**, which is exactly what a rate wants.
- Sub-250ms loads are invisible, and those are precisely the small pods that can never OOM.

So the rate is one CloudWatch ratio over data we already ship: `count(surface='pod-load-memory') / count(perf_op='automerge.remoteLoad')`. Record that query in the Outcome; write no new event.

**`severity: 'error'`, deliberately not `critical`** — a device memory limit is not data at risk, no data is lost, and the file is intact. `critical` pages Slack per occurrence and would be noise. Diverges deliberately from the adjacent `resumeSetup.podCorrupted` report (`ResumePodSetup.vue:340-350`), which IS critical — correctly, since that one means a damaged file.

### 4. Honest user-facing failure — using the overlay's OWN action

**Reuse the existing overlay. Build no new modal.** `fatalErrorStore.setFatal(message, detail)` (`src/stores/fatalErrorStore.ts:26-29`) is mirrored into `App.vue`'s `initError` / `initErrorDetail` (`App.vue:199-206`) and drives the canonical "spilled beans" overlay at `App.vue:1693-1783`, complete with a copy-diagnostic `<details>` block. This is the same surface the corrupted case already uses (`ResumePodSetup.vue:351-362`), so the `case 'too-large'` branch goes through the §2 `surfacePayloadFailure` helper with different copy — not a cloned block.

**The overlay has NO CTA slot, and it doesn't need one.**

An earlier draft designed a bespoke action: `resetWorkerForRetry(): boolean` on `docClient`, a `photoStore.clearBlobCache()` extraction, and a mode-aware `retryCta` / `reloadCta` pair. **The overlay renders a fixed pair of buttons — `app.initError.reload` (`App.vue:1734`) and `app.initError.clearData` (`App.vue:1740`) — with no mechanism for a caller-supplied action.** Delivering the designed CTA therefore means adding an action contract to `fatalErrorStore` + `App.vue`, i.e. exactly the new UI the plan said it would not build.

The simpler answer is strictly better on every axis. **The overlay's existing Reload button IS the action.** A page reload:

- reclaims the doc realm's WASM linear memory in **worker mode** (the worker dies with the page and respawns from zero) _and_ in **inline mode** (the realm is the main thread) — one mechanism, both modes, no `mode` leak out of `docClient`;
- reclaims strictly _more_ than a worker respawn would: the photo blob cache, the retained base64 strings, and every other main-thread arena go with it, for free and with no new exported API;
- is materially different from re-running the identical in-page attempt, satisfying Requirement 5.

Consequently **all of the following are dropped**: `docClient.resetWorkerForRetry()`, `photoStore.clearBlobCache()` (and the `deactivate()` refactor), the `podTooLarge.retryCta` / `reloadCta` strings, the mode-dependent branch in `ResumePodSetup.vue`, and the test that pinned them.

> **Deliberate non-change, recorded so it isn't re-opened.** If a bespoke CTA is ever genuinely wanted, it needs an action contract on `fatalErrorStore` + a button slot in `App.vue:1728-1760`. That is a separate, general improvement and is out of scope here — a one-off action wired only for this error class would be the worst version of it.

New `uiStrings` entries next to `resumeSetup.podCorrupted` (`uiStrings.ts:4203-4207`), `en` + `beanie` (lowercase variant, per the file's convention). **One copy constraint:** the overlay renders a visible **"Clear data"** button (`App.vue:1740-1757`) directly beneath our message. Copy that says "nothing has been deleted" while a Clear-data button sits next to it is an invitation to destroy the cache by hand. The copy must pre-empt it:

- `resumeSetup.podTooLarge` — "this device doesn't have enough memory to open a pod this size. **your pod file is safe** — nothing is damaged and nothing has been deleted, and clearing your data won't help. try opening it on a device with more memory, or send support@beanies.family the details below."

The `detail` block is built by the shared `payloadErrorDetail()` (§2) and carries `familyId`, `step`, `payloadBytes`, plus the device-memory scalar. It must not promise a reload will work.

**Unattended wall — verify, don't build.** `syncService.ts:219-235` already catches every poll-tick throw, reports it non-silently at `severity: 'warning'` (surface `local-file-polling`, `context: { action: 'poll' }`), and lets the loop continue. Add a unit test asserting the poll loop survives a `PayloadTooLargeError` tick and ticks again.

### 5. The pod diagnostic

**No new tooling.** There is no `tsx` dependency and no `vite-node` binary (`node_modules/.bin` contains only `esbuild`, `vite`, `vitest`), and plain Node cannot resolve the `@/` alias. Write the diagnostic as a **vitest spec gated on an env var**. That reuses the `@/` alias (`vitest.config.ts:29`), the TS/WASM transform chain (`vite-plugin-wasm`, `vitest.config.ts:8`), and the shipped crypto, for zero new dependencies and no forked crypto.

`src/services/automerge/__diagnostics__/beanpodProfile.spec.ts`:

```
describe.skipIf(!process.env.BEANPOD_FILE)('beanpod profile', () => { … })
```

It matches `src/**/*.{test,spec}.ts` (`vitest.config.ts:18`) so it is picked up by the normal gate, and skips cleanly (and visibly, as a skipped test) when the env vars are absent — no dead file rotting outside the type-check and lint scope.

**Security constraints — non-negotiable:**

- The spec reads a real production pod and a real password from the environment. It must log **only counts, byte sizes, ratios and timings** — never document content, never a decrypted fragment, never `BEANPOD_PASSWORD` (not even in an assertion message or a thrown error).
- The pod file and password are supplied by env at run time and must never be committed or written anywhere by the spec.

Steps, every one reusing shipped code:

1. `readFileSync(process.env.BEANPOD_FILE)` → `parseBeanpodV4` (`fileSync.ts:59`)
2. `tryUnwrapFamilyKey(envelope, process.env.BEANPOD_PASSWORD)` (`fileSync.ts:~140`)
3. `decryptPayload` (`familyKeyService.ts:126`)
4. `loadAndVerify` (`docOps.ts:223`) — so the diagnostic exercises the identical path, including the new classification
5. `Automerge.stats(doc)` → `{ numChanges, numOps, numActors }`

**Use `Automerge.stats()`, not `getAllChanges().length`.** `getAllChanges(doc)` materialises a `Change[]` containing every change's bytes — on a history-heavy pod that is itself a multi-hundred-megabyte allocation and could OOM the diagnostic on the very doc it exists to measure. `stats()` (`node_modules/@automerge/automerge@3.4.1/dist/implementation.d.ts:621`) returns the counts directly, including `numOps` — the number Requirement 6 is actually about.

**Compaction measurement — `Automerge.toJS`, not `structuredClone`.** An Automerge doc is a `Proxy`; `structuredClone` on it is unreliable and depends on internals we do not control. Use the documented accessor `Automerge.toJS(doc)` (`implementation.d.ts:598`): `Automerge.save(Automerge.from(Automerge.toJS(doc))).byteLength`.

Also report: `Automerge.save(doc).byteLength` (full), the compacted size above, their ratio, wall time, and peak `process.memoryUsage().rss` sampled on a `setInterval` around the load.

**Run instructions, corrected:**

- `--pool=forks` is already the vitest default and the config sets no `pool` (`vitest.config.ts:7-27`), so the flag is noise. What actually makes RSS attributable is running the file **alone**: `npx vitest run src/services/automerge/__diagnostics__/beanpodProfile.spec.ts`.
- Do **not** suggest raising `--max-old-space-size`: wasm32 linear memory is not V8's old space, and the 4GB address ceiling is not a V8 flag. The `PayloadTooLargeError` hint reads: _"this pod exceeds wasm32's addressable limit even on desktop Node — that is the Tier 2 signal, not a Node tuning problem."_

Every step is individually try/caught with a message naming the step and the likely cause (wrong password → "check BEANPOD_PASSWORD"), so a failed diagnostic is self-explaining rather than a bare stack.

Running it against the real production pod is part of this change, not a follow-up.

### 6. Cut the JS-heap copies

> **Sequencing.** §6 is orthogonal to §1-§5: it touches crypto, encoding and two stores, and none of it is needed for the honest-failure behaviour. **Land it as its own commit(s) after §1-§5.** If a perf change has to be reverted, the honest/non-destructive/measurable work — the part that is actually blocking users — must not go with it.

**Parse once — by deleting a call, not adding a function.** `parseBeanpodV4` (`fileSync.ts:59-86`) already validates `version === '4.0'` and throws `Unsupported beanpod version: X. Expected 4.0.` — strictly better copy than the current `Unsupported file version: unknown`. So at both Drive sites simply **delete the `detectFileVersion` pre-call**:

- `syncStore.ts:970-975` (`fetchAndMergeRemote`'s read)
- `syncStore.ts:3554-3559` (`loadFromGoogleDrive`)

**The two sites do NOT return the same failure shape.** The deleted block at `:970` returns `{ success: false }`; the one at `:3554` returns `{ success: false, reason: 'error' }`, and `:970`'s outer catch additionally runs `isAuthTransientSyncError` to decide `reason: 'auth' | 'error'` (`syncStore.ts:960-967`). Converting a `return` into a `throw` therefore routes through catch logic that classifies differently at each site. Test 6 must assert the resulting shape **per site** — a wrong-version file must not come back as `reason: 'auth'`.

`detectFileVersion` itself stays — still used by `syncService.ts:1541/1593/1633` and `connectStorage.ts:250`, where it guards a _V3-or-unknown_ branch that returns `rawText` and which `parseBeanpodV4`'s throw cannot express. Those are the local-file open paths, not the 4MB Drive path; say so in the commit so a later reader doesn't think they were missed.

**Chunked base64 — fix both directions, but NOT with one shared chunk size.**

`encoding.ts:30-45` (`base64ToBuffer`) holds the whole `atob` binary string AND the `Uint8Array` simultaneously. Its mirror `bufferToBase64` (`encoding.ts:12-28`) is worse: it builds the entire binary string by `+=` in a per-byte loop before calling `btoa`, so it holds the source bytes, a multi-MB rope, and the base64 result at once — and it runs on **every save/persist**.

**A single shared chunk constant would ship silent data corruption:**

- **Decode** chunks the _base64 string_, so the chunk must be a multiple of **4** to land on a group boundary. `0x8000` = 32768 ✓.
- **Encode** calls `btoa` per chunk and concatenates the _base64 outputs_, so the chunk must be a multiple of **3** or `btoa` emits `=` padding at every internal chunk boundary. `0x8000 % 3 === 2` ✗ — the result is invalid base64, and `bufferToBase64url`'s `.replace(/=+$/,'')` (`encoding.ts:49`) strips only _trailing_ padding, so the corruption survives all the way to the file.

Use two separately named, separately commented constants:

```
const B64_DECODE_CHUNK_CHARS = 0x8000; // 32768 — multiple of 4 (base64 group)
const B64_ENCODE_CHUNK_BYTES = 32_766; // multiple of 3 — btoa must not pad mid-string
```

and build the encode chunk with `String.fromCharCode.apply(null, subarray)` (32,766 args is safely under the engine's spread limit). Keep both wrapped in the existing `measureSync` calls so the perf sample stays comparable. **Test 7 must include total lengths ≡ 0, 1 and 2 (mod 3) and ≡ 0, 1, 2, 3 (mod 4), and must exercise a multi-chunk input** — a test that only checks empty/small inputs would pass with the broken constant.

**No `slice` in decrypt — and fix the latent `.buffer` bug next to it.** `familyKeyService.ts:130` does `encrypted.slice(IV_LENGTH)` (a full copy) and then passes `ciphertext.buffer as ArrayBuffer`. Pass `encrypted.subarray(IV_LENGTH)` **as the view** and delete the `.buffer` — `crypto.subtle.decrypt` accepts any `ArrayBufferView`, and passing `.buffer` of a subarray hands over the whole underlying buffer including the IV, decrypting the wrong bytes. Leave line 129's `slice(0, IV_LENGTH)` alone (12 bytes, the copy is wanted) — but pass `iv` directly rather than `iv.buffer`, so the file has one consistent rule ("pass the view, never `.buffer`").

While in the file: `encryptPayload` (`familyKeyService.ts:107-119`) has the same `data.buffer as ArrayBuffer` pattern (and `iv.buffer` at `:110`). Today every caller passes a whole-buffer `Uint8Array` so it happens to work, but it is a live trap for anyone who ever passes a view. Pass `data` and `iv` directly. Pinned by test 8.

**Release the payload — one concept, applied at every SINK.**

Introduce one exported, **non-mutating** helper in `src/services/sync/envelopeMerge.ts` — the module both in-memory sinks already import (`syncStore.ts:101`, `syncService.ts:42`), and whose existing helpers already advertise the "returns a fresh object — never mutates inputs" contract (`envelopeMerge.ts:25-26`):

```
/** A long-lived or CACHED envelope carries NO payload: the bytes are the
 *  worker's business and re-serialization always supplies fresh ones via
 *  `reEncryptEnvelope`. Stripping here is what keeps a ~5.5MB base64 string
 *  from being retained (and IDB-persisted) for the whole session.
 *  Returns a fresh envelope — never mutates its input. */
export function withoutPayload(env: BeanpodFileV4): BeanpodFileV4
```

Applied at the three **true** sinks:

1. `syncStore.replaceEnvelope` (`syncStore.ts:201-207`) — the mandated write path for `envelope.value` (invariant comment at `:195-200`). It also _returns_ the merged envelope, which callers pass to `syncService.setFamilyKey` (`:867`, `:1050`, `:1247`, `:1463`, `:1888`, `:2033`, `:3828`) — verified safe: none of those consumers reads `encryptedPayload`.
2. `syncService.setEnvelope` (`syncService.ts:601-605`) **and** `syncService.setFamilyKey` (`syncService.ts:566-573`), which writes `currentEnvelope` directly and is _not_ routed through `setEnvelope`. Fold `:568` into `setEnvelope()` so there is one write path. This also covers the poll-merge write at `syncService.ts:1211`.
3. **`worker/cache.persistEnvelope` (`cache.ts:342-348`)** — the single true IDB sink, covering `persistEnvelopeSafely` (`syncService.ts:551`) _and_ the direct `syncStore.ts:1897` call from `createNewFile`. `JSON.stringify(envelope)` (`cache.ts:347`) then stops serialising a multi-MB base64 string on every key change. This is not just heap — it removes a multi-MB IndexedDB write from the poll path. (Safe by Assumption 5.)

**Make the invariant enforceable at BOTH boundaries, not just documented.**

- _File boundary._ Tighten `parseBeanpodV4`'s check at `fileSync.ts:80-81` from `typeof !== 'string'` to _non-empty string_. Today an empty payload passes validation, so if anyone ever serialises a stripped envelope the resulting file is silently accepted and produces a zero-byte decrypt later; with the tightening it fails loudly at the parse boundary that owns the format. One existing fixture (`fileSync.test.ts:162`) uses `encryptedPayload: ''` and moves to asserting the throw. Also add the note at `types/syncFileV4.ts:89` that on any long-lived or cached in-memory envelope this is deliberately blank.
- _RPC boundary._ `parseBeanpodV4` guards files, but the dangerous future mistake is passing a **stripped in-memory** envelope to the worker — e.g. `hydrateFromEnvelope(envelope.value)`. That never touches the parser; it would arrive as a zero-byte decrypt, surface as `CorruptPayloadError`, and — per §2 — **clear the user's cache**. Close it where the envelope crosses the wire: in `postRaw`'s `ENVELOPE_METHODS` branch (`docClient.ts:441-443`), throw a `DocWorkerError` if `encryptedPayload` is empty, with a message naming the cause. Three lines, converts a silent data-destroying misuse into a loud developer error, and is what makes the whole stripping design safe by construction. Pinned by test 9.

**The 7→3 claim, enumerated (Requirement 7).** Removed copies: (1) the `detectFileVersion` `JSON.parse` at `syncStore.ts:970`, (2) the same at `:3554`, (3) the `atob` binary rope in `base64ToBuffer`, (4) the `+=` rope in `bufferToBase64`, (5) the `slice(IV_LENGTH)` ciphertext copy in `decryptPayload`, (6) the retained `syncStore.envelope.encryptedPayload`, (7) the retained `syncService.currentEnvelope.encryptedPayload` + the IDB `JSON.stringify` of it. Remaining at peak: the raw Drive text, the parsed envelope's payload string, and the decrypted `Uint8Array`. This enumeration is the acceptance evidence — not a re-count.

## Files Affected

- `src/utils/isAllocationFailure.ts` — NEW, follows `isNetworkError.ts`
- `src/utils/diagnostics.ts` — `deviceMemoryScalar()` next to `getDeviceInfo` (`:57`)
- `src/types/sync.ts` — `PayloadLoadError` base, `PayloadTooLargeError`, `payloadErrorDetail()`, `CompleteAutoLoadResult` union member (`:117-127`)
- `src/types/syncFileV4.ts` — comment on `encryptedPayload` (`:89`)
- `src/services/automerge/worker/docOps.ts` — collapse the two catches (`:223-245`) into one classifying helper
- `src/services/automerge/worker/applyAndProject.ts` — do not clear cache on OOM (`:490-503`)
- `src/services/automerge/worker/docClient.ts` — `PayloadLoadError` in `surface()` (`:824`), the single `reportError`, route the inline branch (`:481-490`) through `surface(…, quiet)`, empty-payload guard in `postRaw` (`:441-443`)
- `src/services/automerge/worker/protocol.ts` — codec factory + literal registry keys (`:192-207`)
- `src/services/automerge/worker/cache.ts` — strip payload in `persistEnvelope` (`:342-348`)
- `src/services/sync/envelopeMerge.ts` — `withoutPayload()`
- `src/services/sync/fileSync.ts` — tighten the `encryptedPayload` non-empty check (`:80-81`)
- `src/services/sync/syncService.ts` — strip payload at the envelope sink; fold `setFamilyKey`'s direct write (`:568`) into `setEnvelope` (`:601-605`)
- `src/stores/syncStore.ts` — dispatch branches (`:1209`, `:1362`, `:1665`, `:3729`, `:3756`), drop 2 `detectFileVersion` calls (`:970`, `:3554`), strip payload in `replaceEnvelope` (`:201`)
- `src/composables/useLoginFlow.ts` — branch on `dec.payloadError` (`:780-790`)
- `src/components/login/ResumePodSetup.vue` — extract `surfacePayloadFailure`, add `case 'too-large'` (`:335-362`)
- `src/utils/encoding.ts` — chunked encode AND decode, two distinct chunk constants
- `src/services/crypto/familyKeyService.ts` — subarray view in decrypt, drop `.buffer` in both directions (`:107-138`)
- `src/services/translation/uiStrings.ts` — `resumeSetup.podTooLarge` (`en` + `beanie`), next to `:4203`
- `src/utils/diagnosticContext.ts` — **comment only**, one line at the `detail` declaration (`:181`)
- `src/services/automerge/__diagnostics__/beanpodProfile.spec.ts` — NEW, env-gated
- Tests as listed below

**Not touched (and why):** `docs/runbooks/native-store-submission.md`, `PrivacyInfo.xcprivacy`, `privacy.astro`, the Lambda allowlist — no new context key is introduced. `syncService`'s poll loop (`:219-235`) — its resilience already exists; we add a test, not code. `detectFileVersion`'s three local-file callers. **`src/stores/photoStore.ts` and `docClient`'s worker-lifecycle API** — the overlay's existing Reload button reclaims strictly more memory than a worker respawn, in both execution modes, with no new primitive. `src/App.vue` and `fatalErrorStore` — no CTA slot is added.

## Observability Coverage

- **Event added:** exactly one — `reportError({ surface: 'pod-load-memory', severity: 'error', context: { action: 'pod-load-oom', error_code: step, perf_doc_bytes, os, detail } })`, from the single `docClient.surface()` choke point, **reached from both worker and inline modes**.
- **Exactly once per failure, end to end.** `surface()` is the sole emitter; `notifyFailure` is suppressed by the `PayloadLoadError` expected-degradation check; and the UI-layer `surfacePayloadFailure` runs with `report: false` on the too-large path precisely so a second, non-dedupable surface is not created.
- **Message is constant per `step`** so the existing `(surface, normalizeMessage)` dedup (`errorReporter.ts:145-146`) actually buckets. Size lives in `perf_doc_bytes`.
- **Rate:** derived from the existing `load-perf` / `automerge.remoteLoad` samples (`applyAndProject.ts:622`, emitted from a `finally` at `:914-921`, replayed at `perfTiming.ts:44-84`), which therefore count attempts. No new counter.
- **New allowlisted context keys:** none. One comment line documents the shared `detail` key's new per-surface meaning so it cannot drift.
- **Failure modes covered:** OOM at `load` vs `materialize` (`error_code`); correlated with device class (`os`, `detail`, plus the auto-enriched `browser` UA that already carries the Android model) and pod size (`perf_doc_bytes`); **and with execution mode**, since inline failures now reach the same surface.
- **Deliberately NOT critical:** no data is at risk and the file is intact; paging per occurrence would be noise.
- **No silent failures:** every new code path either throws a typed error that a compiler-exhaustive switch forces a caller to handle, or reports. `deviceMemoryScalar` and the diagnostic's steps are individually try/caught with a `console.warn` naming the probe — never a bare `catch {}`. The new empty-payload RPC guard converts a would-be silent cache-destroying misuse into a loud `DocWorkerError`.
- **Developer guidance:** the fatal overlay's `<details>` block carries `familyId`/`step`/`payloadBytes`/device memory for copy-paste to support; the console gets the full typed error; the diagnostic's per-step catches name the likely cause (and explicitly rule out Node heap tuning).

## Acceptance Criteria

- [ ] An allocation failure is thrown as `PayloadTooLargeError`, never `CorruptPayloadError`
- [ ] `isAllocationFailure` matches **explicit memory phrases only** (on the error and its `cause` at depth 1) — a bare `RangeError` and a bare `unreachable` wasm trap return `false`, pinned by tests, because both are also corruption shapes
- [ ] An allocation failure NEVER clears the local cache; a genuine corruption still does
- [ ] An unrecognised error behaves exactly as it does today (conservative default), pinned by a test
- [ ] The new error survives `postMessage` as an `instanceof`, via the shared codec factory registered under **literal** names (minifier-safe)
- [ ] An OOM emits exactly ONE event — no `notifyFailure` toast, **and no second `reportError` from the UI layer** — **in worker mode AND in inline mode**, carrying payload bytes, device memory, OS and step
- [ ] The event message is constant per `step`, so repeated failures collapse into one dedup bucket
- [ ] The failure rate is derivable from the event plus the EXISTING `automerge.remoteLoad` perf samples — no new success counter added
- [ ] **No new `ALLOWED_CONTEXT_KEYS` entry, and therefore no store-declaration change**
- [ ] The user sees an honest message (memory limit, not a damaged file, and clearing data won't help) in the EXISTING fatal-error overlay, whose EXISTING Reload button is the action — **no new CTA mechanism, no `docClient` lifecycle export, no `photoStore` change**
- [ ] The `PayloadTooLargeError` path is handled at all SIX dispatch sites — including the live `decryptResult.payloadError` branch at `syncStore.ts:3729` — via a single carried-error field and a single extracted surfacing helper, with the `CompleteAutoLoadResult` switch made exhaustive by the compiler
- [ ] An unattended wall retries on its own — verified against the existing poll-tick catch, with a test pinning it
- [ ] The diagnostic exists as an env-gated vitest spec, adds no dependency, uses `Automerge.stats()` and `Automerge.toJS()`, reuses the shipped crypto, logs no secret or document content, and HAS BEEN RUN against the real production pod with numbers recorded in the Outcome
- [ ] Chunked base64 is byte-identical to today in both directions, with encode and decode chunk sizes that are multiples of 3 and 4 respectively, pinned by tests covering every residue class and a multi-chunk input
- [ ] No long-lived or cached envelope retains `encryptedPayload` — verified at all three sinks (`syncStore.replaceEnvelope`, `syncService.setEnvelope`, `worker/cache.persistEnvelope`, the last of which also covers the direct `syncStore.ts:1897` writer) — `parseBeanpodV4` rejects an empty payload, and `docClient.postRaw` rejects a stripped envelope on the wire
- [ ] The seven removed payload copies are the ones enumerated in §6, and §6 lands in its own commit(s) separable from §1-§5
- [ ] NOT claimed: that the 4MB pod loads on the Tab A7/A9+. That is Tier 2.

## Testing Plan

1. Unit: `isAllocationFailure` — each known OOM phrase returns true, including when it is only on `e.cause`; **a plain `RangeError('Invalid array length')`, a bare `RuntimeError('unreachable')`**, a corruption message, a generic `Error`, a plain string, `null` and `undefined` all return false.
2. Unit: `loadAndVerify` throws `PayloadTooLargeError` with `payloadBytes` set for an OOM-shaped throw, `CorruptPayloadError` otherwise, at BOTH the `load` and `materialize` steps.
3. Unit: `initAndLoadCache` does NOT call `clearCache` on `PayloadTooLargeError`, and still DOES on `CorruptPayloadError`.
4. Unit: both payload errors round-trip the worker `postMessage` boundary as `instanceof`, including `payloadBytes` and `step`.
5. Unit (a): `surface()` classifies `PayloadTooLargeError` as expected-degradation (no `notifyFailure` toast) AND emits exactly one `reportError`, whose message contains no digits. (b): a `PayloadTooLargeError` thrown by the **inline executor** reaches the same single `reportError` and still does not toast. (c): `ResumePodSetup`'s `too-large` branch sets the fatal overlay and emits **no** `reportError`, while its `corrupted` branch still emits the `critical` one.
6. Unit: dropping the `detectFileVersion` pre-call yields the same success envelope and a surfaced error **with the correct per-site failure shape** — `{ success: false }` at `syncStore.ts:970`, `{ success: false, reason: 'error' }` (never `'auth'`) at `:3554` — for invalid JSON, wrong version and missing field.
7. Unit: chunked base64 encode and decode are byte-identical to the current implementations across empty, sub-chunk, exact-chunk, chunk+1 and multi-chunk sizes, **including byte lengths ≡ 1 and 2 (mod 3)**, and a round-trip through `bufferToBase64url`/`base64urlToBuffer`.
8. Unit: decrypt with a subarray produces the same plaintext as the slice version — asserted with a **non-zero-offset** view; and `encryptPayload` round-trips a non-zero-offset view.
9. Unit: `withoutPayload` blanks `encryptedPayload`, preserves every other field and does not mutate its input; `replaceEnvelope` and `setEnvelope` both apply it; `cache.persistEnvelope` stores an envelope with no payload **for both its callers**; local-only key dicts survive unchanged; `parseBeanpodV4` throws on an empty payload; and `docClient.postRaw` throws when a stripped envelope is passed to `mergeRemoteEnvelope`.
10. Unit: a poll tick that throws `PayloadTooLargeError` is reported at `warning` and the loop still ticks again.
11. Manual: run the diagnostic against the real pod, file alone: `npx vitest run src/services/automerge/__diagnostics__/beanpodProfile.spec.ts`. Record `numChanges`, `numOps`, `numActors`, full vs compacted size, ratio, load time, peak RSS.
12. Manual (a): on the Tab A9+, confirm the honest message appears in the fatal overlay, the cache is NOT cleared, the Reload button restarts cleanly, and exactly one event appears in CloudWatch. (b): with the `docWorker` kill-switch off (inline mode), confirm the same message and that the event still lands.
13. Full battery: type-check, eslint, stylelint, unit suite, build.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted from the pre-plan, correcting its central premise — the failure was a single-document load, so Tier 1 cannot make the pod load; scope reframed to honest/non-destructive/measurable plus the diagnostic.
- **Pass 2 (DRY + error handling)**: Verified every reuse claim against the code. Removed three net-new work items that duplicated shipped behaviour (success counter → existing `automerge.remoteLoad` samples; poll backoff → existing `syncService.ts:219-235` catch; new modal → existing `fatalErrorStore` overlay), and dropped the `device_memory_gb` key plus its five-file privacy chain by reusing the declared `detail` key. Corrected two designs that would not have worked (`dropDoc()` does not shrink WASM memory; nulling `pendingEncryptedFile` would break wrong-password retry). Swapped `getAllChanges().length` for `Automerge.stats()`. Resolved the diagnostic tooling to an env-gated vitest spec. Found two missed dispatch sites, one missed double-parse site, a latent `.buffer` bug and a double-report hole.
- **Pass 3 (Sustainability / maintainability / reliability)**: Six structural corrections. (a) The choke point wasn't one — `requestCore`'s inline branch bypasses `surface()`, so the metric would have been blind to inline mode; routed inline through `surface(…, quiet)`. (b) The retry CTA was a silent no-op in inline mode. (c) The classifier was too broad — bare `RangeError` and bare `unreachable` are also corruption shapes; narrowed to explicit memory phrases. (d) The event message would have defeated the dedup it relies on; made constant per step. (e) Payload-stripping was scoped to one of three holders; replaced with a single `withoutPayload()` applied at every sink plus a parser-enforced invariant. (f) De-duplicated the dispatch fan-out into one carried `payloadError` field and one extracted helper. Also: `Automerge.toJS` over `structuredClone`; per-site failure-shape assertions; §6 sequenced into separable commits; Requirement 7 replaced with a named enumeration.
- **Pass 4 (Fresh-eyes sweep)**: Seven corrections, five of them defects the plan would have shipped. (a) **A latent data-corruption bug in the perf work** — a single `CHUNK = 0x8000` for both base64 directions is not a multiple of 3, so per-chunk `btoa` emits `=` padding mid-string and `bufferToBase64url`'s trailing-only strip (`encoding.ts:49`) cannot repair it; split into two named constants with residue-class tests. (b) **A missed dispatch site, and it is the LIVE one** — `syncStore.ts:3729`'s `if (decryptResult.corrupted)` is what actually fires (`decryptPendingFile` returns rather than throws); Pass 3 listed only the defensive catch at `:3756`. Six sites, not five. (c) **A double-report Pass 3 reintroduced** — the extracted `surfacePayloadFailure` would `reportError` from `ResumePodSetup` on a path `docClient.surface()` has already reported, on a _different_ surface the dedup cannot collapse; added `report: false`. (d) **The IDB stripping claim was false** — `syncStore.ts:1897` calls `docClient.persistEnvelope` directly, bypassing `persistEnvelopeSafely`; moved the strip into `worker/cache.persistEnvelope`. (e) **The user-facing action was not the free reuse it claimed** — `App.vue:1693-1783` renders a fixed Reload/Clear-data pair with no CTA slot; replaced with the overlay's own Reload button, which reclaims strictly more memory than a worker respawn and works identically in both modes. That deletes `resetWorkerForRetry`, the `photoStore.clearBlobCache()` extraction, two uiStrings entries, the mode-dependent UI branch and one test. Added the copy constraint that the message must not be contradicted by the adjacent Clear-data button. (f) **Closed the last way the stripping design could destroy a cache** — added a three-line empty-payload guard at the RPC boundary (`docClient.ts:441-443`). (g) Smaller: a minifier caveat (never derive names from `Ctor.name`); `withoutPayload` documented as non-mutating; `isAllocationFailure` given a bounded depth-1 `cause` hop; the diagnostic's `--pool=forks` advice replaced with "run the file alone" and its misleading `--max-old-space-size` hint corrected; explicit secret-handling constraints; and the note that `browser` already carries the Android model.

## Outcome

_(to be completed during implementation — must include the diagnostic's numbers against the real production pod: `numChanges`, `numOps`, `numActors`, full vs compacted size, ratio, load time, peak RSS; and the CloudWatch rate query.)_

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial prompt (via `/beanies-pre-plan` → `/beanies-plan`, Notion #90)

The assembled `=== BEANIES PRE-PLAN ===` block stored on Notion #90's `beanies-plan prompt` property, scoped to Tier 1 only.

### Clarifications resolved during pre-plan (2026-09-04)

- Plan scope: **Tier 1 only**. Tier 2 (merge-safe history compaction) gets its own pre-plan/plan, calibrated by what the Tier 1 diagnostic finds.
- Design floor: **3GB Android** (Galaxy Tab A7 / SM-T500).
- OOM behaviour: **honest error plus a recovery action**.
- Feature gate: **Tier 2 only** — Tier 1 ships ungated.

### Correction accepted during Pass 1 (2026-09-04)

> "Tier 1 alone will not make the 4MB pod load on the tablet — that needs Tier 2 compaction. How should I scope the plan?" → **"Tier 1 with corrected criteria"**: move "the pod loads on a 3GB tablet" to Tier 2 and state plainly that Tier 1 delivers an honest, non-destructive, measurable failure plus the diagnostic that sizes the real problem.

### Implementation authorisation

> "once the plan is done begin implementation. once done run a /code-review max against all code to ensure it runs as designed against the plan and does not introduce new bugs, side effects, or security issues"

</details>
