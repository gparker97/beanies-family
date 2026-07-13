# Plan: Doc-worker death recovery — self-heal a wedged or OS-reaped Automerge worker

> Date: 2026-07-13
> Related issues: None — direct implementation (Notion #43 "worker cold-load true fix" gets a cross-reference note; this plan is the _recovery-gap_ half, distinct from the _load-speed_ half)
> Plan file: `docs/plans/2026-07-13-worker-death-recovery.md`

## User Story

As a beanies.family user opening the PWA (especially on mobile), I want the app to recover on its own when the background Automerge worker has died or wedged, so that my data loads without me having to force-quit and reopen the app.

## Context

The `docWorker` Web Worker (ADR-032) went prod-ON for all users on 2026-07-07 (app 0.9.4). Since then `#beanies-errors` has intermittently received "We couldn't update your data — doc-worker '<method>' timed out" alerts that greg has reproduced first-hand: **data fails to load in the PWA, and force-closing + reopening fixes it.** The 2026-07-13 batch spans multiple methods, multiple families, and three device classes:

| Time (UTC)   | Method                             | Client ceiling | Device                        |
| ------------ | ---------------------------------- | -------------- | ----------------------------- |
| 00:11:14.858 | `flush`                            | 45s            | Android Chrome                |
| 00:11:14.865 | `initAndLoadCache`                 | 120s           | Android Chrome                |
| 00:47:57.814 | `getHeads`                         | 45s            | Android Chrome                |
| 00:47:57.825 | `exportEncryptedPayload`           | 120s           | Android Chrome                |
| 01:55:34     | `setKey`                           | 45s            | iPhone Safari                 |
| 02:32:46     | `app.onboardingStallTimeout` (35s) | —              | Windows desktop Chrome, /nook |

`save_failure_level: none` on every alert — nothing was durably corrupted.

**Root cause — the client has no recovery path from a worker that stops responding without firing `onerror`.** Two facts from the code prove it:

1. **Recovery is wired only to `worker.onerror`.** `docClient.ts:onWorkerError` is the _only_ place that tears the worker down (`terminate()` → `worker=null` → `readyPromise=null` → `needsRehydrate=true`) so the next `ensureReady()` re-spawns. The RPC-timeout path (`requestCore`, `docClient.ts:393`) does `pending.delete(cid); throw` — it does **not** tear the worker down. So once the worker goes silent _without_ an `onerror` event, `ensureReady()` keeps returning `'worker'`, every subsequent RPC re-posts to the corpse, and each one times out at 45s/120s. Force-close (which destroys the page and the worker together) is the only escape — exactly the reported behaviour.

2. **Two ways the worker goes silent-dead, neither firing `onerror`:**
   - **OS reap (the mobile pairs).** The worker is a `DedicatedWorker`; a backgrounded mobile PWA can have it reaped by the OS for memory. The `flush` in each paired alert is the `bootstrap.ts:30` `document.hidden` backgrounding flush — it posts to a worker the OS then kills. On resume the _page_ is restored from a frozen/bfcache state with a stale non-null `worker` ref and no `onerror` ever fired → every RPC times out until force-close.
   - **FIFO wedge (desktop + heavy-op case).** `docWorker.ts:46` runs a serialized async FIFO (`tail = tail.then(...)`): each request fully completes before the next starts. One hung `dispatch` (a large `Automerge.load`/decrypt pinning the single WASM thread) blocks _every_ queued op behind it — which is why a 120s heavy op and a 45s light op **expire in the same millisecond** (00:11:14.858/.865): the light one was queued behind the heavy one. The 35s desktop `onboardingStallTimeout` and the trivial `setKey` timeout confirm this is a dead/wedged worker, not merely a slow one (desktop V8 does not take 35s to load ~2 MB; `setKey` does no compute).

This plan closes the recovery gap. It deliberately does **not** try to make large-doc loads faster — that Layer-2 work stays under Notion #43.

## Requirements

1. An RPC timeout in worker mode must be treated as a worker-death signal: tear the worker down so the next request re-spawns a fresh one (instead of re-posting to a corpse forever).
2. For safe/idempotent methods, the timed-out call must transparently retry **once** on the fresh worker, so a load that hit a reaped/wedged worker heals without a user-visible error.
3. Non-idempotent methods (`mutate`, `initDoc`) must **not** auto-retry (double-applying an increment op would corrupt balances). They still trigger worker recovery so the _next_ action works, and still surface the error so the user knows to retry the action. The retry gate must be **fail-safe by default** (a method not explicitly marked idempotent is never auto-retried — see Pass 3).
4. On returning to the foreground (`visibilitychange` → visible) during an active session, the client must proactively probe worker liveness with a short-timeout `ping`; if it fails, recover the worker so the user's first real interaction after resume hits a fresh worker — this is what makes plain reopen work without a force-close.
5. Every recovery must be telemetered (frequency visibility) without producing a duplicate user-facing toast.
6. The retry must be bounded (one retry per logical call) so a genuinely un-loadable doc cannot spin the worker forever; the final failure surfaces the existing error path unchanged.
7. No regression to the existing `onWorkerError` crash path (one toast for N in-flight calls, rehydrate-on-respawn), the two-tier heavy/light timeout, or the inline fallback mode.
8. **A recovery must never _silently_ drop a concurrently in-flight call.** When a timeout-triggered recovery drains sibling in-flight RPCs (each to a _quiet_ `WorkerCrashError`), those siblings — which may include a user's `mutate` — must be covered by **exactly one** consolidating "We couldn't update your data" toast, never zero. This preserves the crash-path invariant (one toast for N lost in-flight calls) on the new timeout path, so a silent auto-heal of one op can't swallow the visible failure of another (see Pass 4).

## Important Notes & Caveats

- **Idempotency is the safety boundary for auto-retry, and the retry gate is an explicit allowlist (fail-safe by default).** A worker that times out an RPC _may_ have actually processed it and only failed to reply. For CRDT `set`/`delete` re-application is harmless, but the named financial ops (`applyGoalContribution`, `applyLoanPayment`, increment) route through `mutate` and are **not** idempotent. Rather than *ex*clude the unsafe methods via a denylist (which would silently auto-retry — and could double-apply — any _future_ non-idempotent method someone forgets to list), the retry gate is an explicit `RETRYABLE` **allowlist**: a method auto-retries only if it is affirmatively known to be a pure read, an idempotent CRDT merge, an idempotent re-persist, or an idempotent teardown. The allowlist is: `initAndLoadCache`, `openCache`, `getHeads`, `getActorId`, `getChangesSince`, `applyChanges`, `exportEncryptedPayload`, `exportIncrementalPayload`, `mergeRemoteEnvelope`, `applyRemoteChunks`, `verifyEnvelope`, `flush`, `dropDoc`, `reset`, `clearCache`, `persistEnvelope`, `readEnvelope`, `setKey`, `collectReferencedPhotoIds`, `ping`. `mutate` and `initDoc` are simply absent → not retried. The failure-mode asymmetry is the whole point: a _forgotten allowlist entry_ costs one un-healed timeout (visible, recoverable, user just retries); a _forgotten denylist entry_ costs a double-applied financial op (silent, corrupt). For a financial app the fail-safe default is mandatory.
- **Concurrent-drain visibility — the one consolidating toast (Pass 4).** `recoverDeadWorker` drains _every_ in-flight call to a `WorkerCrashError`, which `surface()` classifies as expected → **quiet**. On the crash path that silence is deliberate: `onWorkerError` fires ONE consolidating toast for the N drained calls. The new timeout path needs the same guard, because the _triggering_ call may heal silently (retryable) while a **sibling** `mutate` it just drained would otherwise vanish toast-less. The rule (implemented in Approach §2):
  - The triggering call removes itself from `pending` first, so "siblings" = the calls `recoverDeadWorker` is about to drain.
  - If the trigger is **retryable** and there ARE siblings, fire exactly one consolidating toast for them (via `surface(timeoutErr, …)` for its toast side-effect — see below) and still heal the trigger.
  - If the trigger is **non-retryable**, its own `throw surface(timeoutErr, …)` is the single toast and it already covers the siblings — no separate sibling toast (avoids a double toast).
    This deliberately errs toward visibility: if the drained siblings happened to be only background reads, the user sees one "couldn't update your data" toast anyway — identical imprecision to the existing crash path, and the right call for a wedge that just dropped in-flight work. (Bound: `pending` does not carry each call's `quiet` flag, and non-retryable methods (`mutate`/`initDoc`) are never called `quiet` today, so the `throw surface()` toast always reaches the user; a hypothetical _future_ `quiet` non-retryable method draining siblings is the one residual silent-sibling case — noted, not engineered around, consistent with how this plan treats other one-in-a-million paths.)
- **Reuse `surface()` for the sibling toast — do not hand-roll a second `showToast`.** `surface(err, method, quiet?)` already owns the exact `showToast('error', "We couldn't update your data", …, {surface:'doc-worker', critical:true})` call and its expected-class quieting. Passing the plain timeout `Error` (which is NOT in the expected/quiet set — only `CorruptPayloadError`/`WorkerCrashError` are) makes it toast; we ignore the returned error and do NOT throw, because the trigger still heals on retry. This keeps the toast literal in one place (DRY) and guarantees the sibling toast is byte-identical to every other doc-worker failure toast.
- **`recoverDeadWorker` itself does not toast.** The toast decision stays with the two callers that have the context: `onWorkerError` (crash: toast iff `pending.size > 0`, unchanged) and the timeout catch (per the rule above). The helper is pure teardown+drain, so it can be called from either path — and from a future one — without smuggling UI policy into a lifecycle primitive.
- **Don't tear down a slow-but-progressing heavy op (added during implementation).** A LIGHT op can legitimately time out at 45s while a HEAVY whole-doc op (`initAndLoadCache`/`mergeRemoteEnvelope`/…) is still progressing toward its 120s ceiling — the light one is simply queued behind it in the worker's serial FIFO, which is NOT proof the worker is dead. Recovering on that light timeout would abort — and, with auto-retry, _restart from zero_ — a slow-but-valid large-doc load, the exact case the 120s ceiling exists to protect (and a regression the existing two-tier-timeout test caught). So the timeout catch only treats a timeout as worker-death when **the timed-out op is itself heavy** (it hit 120s → genuinely wedged) **or no heavy op is still in flight** (`heavyStillInFlight = [...pending.values()].some(p => HEAVY_METHODS.has(p.method))`). Otherwise it rejects just that one call (old behaviour) and leaves the worker to finish. A truly-dead worker still recovers: its pending heavy op reaches 120s and recovers on _that_ timeout. Consequence for the OS-reap pairs (heavy load + light flush both pending on a reaped worker): recovery is driven by the heavy op's 120s timeout rather than the flush's 45s — acceptable, since the resume-`ping` proactively heals the reap case earlier anyway.
- **Do NOT permanently switch to inline mode on a failed retry.** Inline-loading a large doc freezes the main thread — the entire reason the worker exists. A transient reap must not permanently abandon the worker. After a failed retry we surface the error and leave the worker recoverable for the next attempt; we do not flip `mode='inline'`.
- **Rehydrate/retry redundancy — resolved: keep it simple, accept the idempotent double-load.** `recoverDeadWorker` sets `needsRehydrate` so the re-spawned worker reloads the doc from cache (via the bootstrap rehydrator, which _is_ `initAndLoadCache`) before serving reads — this is required so a retried read (`getHeads`, `exportEncryptedPayload`, …) runs against a loaded doc. When the retried method is itself `initAndLoadCache`, the respawn's rehydrate and the explicit retry both load the same cache row — an idempotent double-load. Likewise a `setKey` retry re-posts a key the respawn's `if (familyKey) postRaw({method:'setKey'})` already re-posted — an idempotent double-set. **Pass-2/4 decision:** do _not_ add "skip the explicit retry when the respawn already satisfied it" branches. Each such special-case is more code (a method-vs-rehydrator equality check plus a skip path) than it saves, on a rare path (only on an actual worker death _during_ that specific method), and every case is idempotent. The simplest correct code wins; the redundant work is a bounded, rare-path cost, not a correctness or DRY problem.
- **Three method-classification sets stay separate — do not merge them.** `JSON_SAFE_METHODS`, `HEAVY_METHODS`, and the new `RETRYABLE` set each key off method name but answer _different_ questions (clone-safety of args, timeout tier, retry-safety). They are intentionally three small independent `Set`s rather than one "method descriptor" table: a method's clone-safety, its load ceiling, and its idempotency are orthogonal and change for independent reasons, so co-locating them in one structure would couple unrelated concerns and make each edit touch a wider surface. Each set stays a single flat `new Set([...])` with a comment — adding a method is a one-line, one-concern edit.
- **The App.vue 35s init watchdog is out of scope.** It fires before the 120s heavy-load ceiling, so a foreground wedge _during initial load_ still shows the recovery overlay at 35s. That interplay (watchdog vs. heavy-load ceiling) is a separate concern; do not retune `INIT_TIMEOUTS` here. The resume-ping and timeout-recovery still make the _next_ attempt succeed. Note it as a known limitation.
- **The `ping` must touch no doc state.** It exists purely to confirm the worker's message loop is alive; it must not require a loaded doc or the family key (so it works even before/without unlock).
- **Guard the resume-ping.** `checkWorkerLiveness` only probes in worker mode, with a spawned `worker`, **and** an active session (`currentFamilyId` set) — matching Requirement 4. It is a no-op in inline mode, when signed out, when no worker was ever spawned, or in tests without a worker. Because it returns early when `worker === null`, it never _spawns_ a worker just to ping.

## Assumptions

> Review these before implementation.

1. The worker RPC timeout path in `requestCore` (`docClient.ts`) is still the sole timeout site and still just deletes the cid and throws (verified 2026-07-13).
2. `onWorkerError` is still the only recovery trigger and still sets `worker=null; readyPromise=null; needsRehydrate=true` (verified 2026-07-13).
3. `docWorker.ts` routes every method through `applyAndProject.dispatch` (verified — line 48), so adding a `ping` case to `dispatch` reaches both worker and inline modes with no `docWorker.ts` change.
4. `bootstrap.ts` already owns the single `visibilitychange` listener (verified — line 29).
5. Retrying an idempotent RPC after a fresh spawn + rehydrate produces a correct result (CRDT merge/read idempotence).
6. `reportError` at `severity: 'warning'` records to telemetry + console only and never pages Slack or raises a toast (verified against `errorReporter.ts` — only `'critical'` pages; warning maps to `logEvent` level `'warn'`, and the Slack page-gate `return`s for any non-critical severity). It accepts a `context` object (verified — `ErrorReportInput.context`). This is why recovery telemetry cannot produce a duplicate user-facing toast.
7. The only non-idempotent dispatcher methods today are `mutate` and `initDoc`; every other `dispatch` case (verified against `applyAndProject.ts:588-644`) is a pure read, an idempotent merge/persist, or an idempotent teardown. The `RETRYABLE` allowlist encodes this — but because it is an allowlist, this assumption being wrong (a new method being *un*safe) fails safe: an unlisted method is simply never retried.
8. `surface(err, method, quiet?)` toasts for a plain timeout `Error` (not `quiet`, not an expected class) and stays quiet for `WorkerCrashError`/`CorruptPayloadError` (verified — the `expected` gate at `docClient.ts:424`). This is what lets us (a) reuse `surface()` to fire the single sibling toast and (b) rely on drained `WorkerCrashError` siblings staying silent so they don't multiply the toast.
9. The synchronous drain inside `recoverDeadWorker` settles each sibling's `withTimeout` race (its `responsePromise` resolves) _before_ that sibling's own timeout timer can fire, so a concurrent wedge cannot re-enter `recoverDeadWorker` a second time and double-spawn: the first timed-out call's catch runs to completion (including draining every sibling) in one synchronous turn, and a settled `Promise.race` ignores the later timer (verified against `withTimeout` + single-threaded catch execution).

## Approach

Four changes, all within `src/services/automerge/worker/` plus tests, changelog, status.

### 1. Extract the shared teardown (`docClient.ts`) — DRY

Pull the teardown currently inline in `onWorkerError` into one helper so both the crash path and the new timeout path use identical logic. The helper is pure teardown+drain — it does **not** toast (the toast policy stays with each caller):

```ts
/** Tear down a dead/wedged worker so the next ensureReady() re-spawns. Drains
 * every in-flight call to a definite (quiet) WorkerCrashError rejection, terminates
 * the worker, and (for an active session) flags a rehydrate so the fresh worker
 * reloads the doc from cache before serving reads. Does NOT toast — the caller owns
 * that (onWorkerError: crash toast; timeout path: sibling/trigger toast). Idempotent. */
function recoverDeadWorker(reason: string): void {
  if (mode === 'inline') return; // nothing to recover
  console.error(`[docClient] recovering dead worker — ${reason}`);
  for (const [cid, p] of pending) {
    p.resolve({ cid, ok: false, error: { name: 'WorkerCrashError', message: reason } });
  }
  pending.clear();
  try {
    worker?.terminate();
  } catch {
    /* already dead */
  }
  worker = null;
  readyPromise = null;
  if (currentFamilyId) needsRehydrate = true;
}
```

`onWorkerError` keeps its existing responsibility — the single crash toast when `pending.size > 0`, fired _before_ draining — then calls `recoverDeadWorker(message)` for the teardown. The showToast call and its args (title, `message` body, real `err` object, `critical: true`) are **unchanged**, and the drained `WorkerCrashError` message is unchanged (the crash message), so the F5 dedup test and the "rejects all in-flight requests" test stay green.

### 2. Timeout ⇒ recover + bounded single retry + one sibling toast (`docClient.ts`)

`requestCore` gains an internal attempt guard. Retry-safety is an explicit **allowlist** (fail-safe: an unlisted method is never retried) placed beside the existing `HEAVY_METHODS`/`JSON_SAFE_METHODS` sets, as its own single-concern `Set`:

```ts
// Methods that are safe to transparently re-issue after a worker respawn:
// pure reads, idempotent CRDT merges, idempotent re-persists/teardowns. This is
// an ALLOWLIST, not a denylist, on purpose — a method must be affirmatively
// known-idempotent to auto-retry. `mutate` and `initDoc` are absent (a re-issue
// could double-apply a financial op); any FUTURE method is likewise non-retryable
// until explicitly vetted and added here. Forgetting to add a safe method costs a
// missed auto-heal (visible, recoverable); the opposite default would risk silent
// data corruption.
const RETRYABLE = new Set([
  'initAndLoadCache',
  'openCache',
  'getHeads',
  'getActorId',
  'getChangesSince',
  'applyChanges',
  'exportEncryptedPayload',
  'exportIncrementalPayload',
  'mergeRemoteEnvelope',
  'applyRemoteChunks',
  'verifyEnvelope',
  'flush',
  'dropDoc',
  'reset',
  'clearCache',
  'persistEnvelope',
  'readEnvelope',
  'setKey',
  'collectReferencedPhotoIds',
  'ping',
]);

// inside requestCore, worker branch:
try {
  res = await withTimeout(responsePromise, timeoutMs, `doc-worker '${method}' timed out`);
} catch (timeoutErr) {
  pending.delete(cid); // drop THIS call first…
  const lostSiblings = pending.size > 0; // …so this counts only OTHER in-flight calls
  recoverDeadWorker(`rpc-timeout:${method}`); // drains siblings to a quiet WorkerCrashError + tears down
  reportError({
    surface: 'doc-worker-recovery',
    message: `doc-worker '${method}' timed out — worker recovered; next request re-spawns a fresh worker`,
    severity: 'warning', // telemetry + console only — never pages, never toasts (Assumption 6)
    context: { method, attempt, lostSiblings },
  });
  if (attempt === 1 && RETRYABLE.has(method)) {
    // This call heals transparently on the fresh worker. But any SIBLING calls just
    // drained can't be re-issued (we don't own their args/idempotency) and a drained
    // WorkerCrashError is quiet — so a concurrently-in-flight `mutate` would otherwise
    // vanish with no toast. Fire the ONE consolidating toast for them by reusing
    // surface() for its toast side-effect (timeoutErr is not an expected/quiet class);
    // ignore the returned error and do NOT throw, because THIS call still heals.
    if (lostSiblings) surface(timeoutErr, method, false);
    return requestCore(method, args, opts, 2); // fresh ensureReady() re-spawns + rehydrates
  }
  // Non-retryable (or retry exhausted): surface() throws AND fires the single toast,
  // which already covers any drained siblings — no separate sibling toast needed.
  throw surface(timeoutErr, method, opts.quiet);
}
```

`requestCore` signature gains `attempt = 1`. `request`/`requestMutate` are unchanged (they call with the default). The retry re-enters `requestCore` from the top, so `ensureReady()` re-spawns the worker, re-posts the key, and runs the rehydrator — then the op is re-issued against a live, loaded worker. A second timeout (`attempt === 2`) falls through to the existing `surface()`, which throws (and, for a non-`quiet` method, toasts) — so a genuinely un-loadable doc surfaces the terminal failure exactly once. By the time attempt 2 runs, the siblings were already drained on attempt 1, so `lostSiblings` is false on the retry — no duplicate sibling toast.

Toast accounting (exactly one user-facing toast, never zero-for-a-lost-mutate):

| Trigger                         | Siblings in flight | Toasts                                              |
| ------------------------------- | ------------------ | --------------------------------------------------- |
| retryable, heals                | none               | 0 (silent heal) ✓                                   |
| retryable, heals                | yes                | 1 (sibling toast via `surface()`; trigger silent) ✓ |
| non-retryable (`mutate`)        | none               | 1 (`throw surface()`) ✓                             |
| non-retryable (`mutate`)        | yes                | 1 (`throw surface()` covers all) ✓                  |
| retryable, retry also times out | n/a                | 1 (attempt-2 `throw surface()`, non-`quiet`) ✓      |

The recovery `reportError` uses `severity: 'warning'` and never toasts — so a successful auto-heal is silent to the user and visible to us in telemetry, with `lostSiblings` recorded so we can see how often a heal coincided with lost concurrent work.

### 3. Liveness `ping` (`applyAndProject.ts` + `docClient.ts`)

Add a no-op op to the shared dispatcher:

```ts
// applyAndProject.ts dispatch()
case 'ping':
  return { result: { ok: true } };   // touches no doc/key state
```

Client wrapper with a short ceiling and self-recovery:

```ts
const PING_TIMEOUT_MS = 5_000;

/** Probe worker liveness; recover if it doesn't answer promptly. A no-op unless
 * we're in worker mode, a worker is actually spawned, AND there's an active
 * session (Requirement 4) — so it never spawns a worker just to ping, and never
 * fires signed-out or in tests without a worker. */
export async function checkWorkerLiveness(): Promise<void> {
  if (mode === 'inline' || !worker || !currentFamilyId) return;
  try {
    await request('ping', undefined, { quiet: true, timeoutMs: PING_TIMEOUT_MS });
  } catch (err) {
    // A ping timeout already ran recoverDeadWorker AND telemetered the recovery
    // (severity 'warning') inside requestCore, so we do NOT re-report it here
    // (that would double-count). A NON-timeout probe failure is not expected
    // (dispatch('ping') can't throw), but we log it so it can never be fully
    // silent — a dev sees the worker was recovered and why.
    console.warn('[docClient] liveness probe failed — worker recovered on next request', err);
  }
}
```

Because `ping` is in `RETRYABLE`, a ping timeout triggers `recoverDeadWorker` + one retry inside `requestCore`. That is intentional and bounded: the retry re-spawns + rehydrates and pings the fresh worker, which answers instantly — so a reaped worker is **proactively** healed (fresh worker + doc reload) during resume rather than on the user's first tap. A second timeout throws and is caught here. `ping` is called `quiet`, so the trigger never toasts on its own; but if a _real_ op was in flight during resume and gets drained as a sibling, the §2 sibling-toast path still surfaces its loss (the sibling isn't quiet). `checkWorkerLiveness` never re-throws — its only job is to warm/recover.

### 4. Resume probe (`bootstrap.ts`)

Extend the existing visibility listener:

```ts
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    void docClient.flush();
    return;
  }
  // Foreground: a backgrounded mobile PWA may have had its worker OS-reaped
  // without an onerror. Probe + recover so the next real RPC hits a live worker.
  void docClient.checkWorkerLiveness();
});
```

The internal `mode`/`worker`/`currentFamilyId` guards in `checkWorkerLiveness` keep this a no-op when there's nothing to probe — the listener stays a one-liner with no duplicated guard logic on the bootstrap side.

## Files Affected

- `src/services/automerge/worker/docClient.ts` — extract `recoverDeadWorker` (teardown+drain only, no toast); timeout→recover→bounded-retry in `requestCore` (new `attempt` param, `RETRYABLE` allowlist beside the existing `HEAVY_METHODS`/`JSON_SAFE_METHODS` sets, `lostSiblings` single-consolidating-toast via `surface()` reuse); add `checkWorkerLiveness` + `ping` wrapper + `PING_TIMEOUT_MS`; recovery telemetry.
- `src/services/automerge/worker/applyAndProject.ts` — add `ping` case to `dispatch`.
- `src/services/automerge/worker/bootstrap.ts` — foreground liveness probe in the existing visibility listener.
- `src/services/automerge/worker/__tests__/docClient.test.ts` — new tests (below), reusing the existing `FakeWorker` / `useWorker` / `tick` harness and the fake-timer pattern from the two-tier-timeout suite.
- `src/services/automerge/worker/__tests__/applyAndProject.test.ts` — `ping` returns `{ ok: true }` without a doc/key.
- `CHANGELOG.md` — `Fixed` entry (user-facing: app recovers on its own instead of needing a force-quit).
- `docs/STATUS.md` — record the recovery-gap finding + fix under 2026-07-13; cross-reference Notion #43.

## Acceptance Criteria

- [ ] A worker-mode RPC that times out tears the worker down (next `ensureReady()` re-spawns) — verified by test.
- [ ] A timed-out idempotent method (e.g. `initAndLoadCache`) succeeds on the auto-retry against a fresh worker — verified by test.
- [ ] `mutate` and `initDoc` do **not** auto-retry on timeout; they recover the worker and surface the error — verified by test.
- [ ] A method that is not in the `RETRYABLE` allowlist does not auto-retry (fail-safe default) — covered by the `mutate`/`initDoc` no-retry test, which asserts on allowlist absence rather than a hard-coded denylist.
- [ ] A retryable timeout that drains a concurrently in-flight `mutate` fires **exactly one** consolidating toast (the mutate is not silently lost) while the retryable trigger still heals — verified by test.
- [ ] A retryable timeout with **no** siblings heals with **zero** toasts (silent auto-heal) — verified by test.
- [ ] A ping timeout on resume recovers the worker without a user-facing toast — verified by test.
- [ ] `checkWorkerLiveness` is a no-op when signed out (`currentFamilyId === null`) even with a live worker — verified by test.
- [ ] The existing crash path (`onWorkerError`) still fires exactly one toast for N in-flight calls and still rehydrates on respawn — existing tests stay green.
- [ ] Recovery events reach `reportError` at `warning` severity with `{ method, attempt, lostSiblings }` context and produce no toast on a successful (sibling-free) heal.
- [ ] `npm run type-check && npm run lint && npm test -- --run` all pass.

## Testing Plan

1. **Unit — timeout recovers + retries (idempotent).** Fake worker whose first spawn never replies to `initAndLoadCache`; second spawn replies. Assert: first attempt times out (fake timers), `recoverDeadWorker` runs, a second worker is created via the factory, the retry resolves with the loaded result, **no** toast (no siblings).
2. **Unit — non-retryable no-retry.** Fake worker that never replies to `mutate`. Assert: exactly one attempt, worker torn down, `surface()` toast fired, factory called only for the recovery (not a retry re-issue). Assert the gate is allowlist-driven (a name absent from `RETRYABLE` never retries) rather than a hard-coded denylist.
3. **Unit — sibling-drain single toast.** Two concurrent RPCs against a wedged worker: a retryable `getHeads` and a `mutate`, both pending. Drive `getHeads` to time out first; assert exactly **one** `showToast` call fires, the `mutate` promise rejects (drained `WorkerCrashError`, not re-issued), and `getHeads` heals on the fresh worker. Then a mirror case with **no** sibling asserts **zero** toasts (proves the toast is sibling-gated, not always-on).
4. **Unit — ping-on-resume recovery.** Spawn a worker, then a fake that stops answering; call `checkWorkerLiveness`; assert ping times out (short ceiling), worker torn down, no toast, next request spawns fresh.
5. **Unit — liveness no-op guards.** `checkWorkerLiveness` returns immediately (no `ping` posted, no factory call) when (a) signed out (`currentFamilyId === null`) with a live worker, and (b) no worker spawned yet.
6. **Unit — bounded retry.** Both spawns never reply to `getHeads`; assert exactly two attempts then a surfaced error (no infinite loop), and that the second attempt does not re-fire a sibling toast.
7. **Unit — dispatch ping.** `applyAndProject.dispatch('ping', undefined)` returns `{ ok: true }` with no doc loaded and no key set.
8. **Regression.** Existing `docClient.test.ts` crash/dedup/two-tier-timeout/inline tests stay green.
9. **Manual.** In the running app, terminate the worker via DevTools → Application → Workers, then trigger an action; confirm the app recovers (spawns a new worker, data operation completes) instead of hanging. Background the PWA on a phone, wait, foreground it; confirm the resume probe recovers a reaped worker without a force-quit.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the four-change recovery design (shared teardown, timeout→recover→bounded-retry with idempotency-gated retry, liveness ping, resume probe) from the docClient/docWorker/bootstrap source.
- **Pass 2 (DRY + error handling)**: Verified the `recoverDeadWorker` DRY extraction, dispatch-routed `ping`, and warning-severity telemetry against source (no silent toast — confirmed via `errorReporter.ts`). Changed: added the missing `currentFamilyId` (active-session) guard to `checkWorkerLiveness` per Requirement 4; replaced its silent `catch {}` with a `console.warn`; and resolved the deferred rehydrate/retry-redundancy note in favour of the simplest code (accept the rare idempotent double-load rather than add a skip branch).
- **Pass 3 (Sustainability)**: Flipped the retry gate from a `NON_RETRYABLE` denylist to a `RETRYABLE` allowlist so every method is non-retryable-by-default (a forgotten future mutating method fails safe as a visible timeout instead of a silent double-applied financial op); documented that the three method-name sets stay separate single-concern flat `Set`s rather than being merged into one coupled descriptor table; updated Requirement 3, Assumption 7, the acceptance criteria, and test 2 to assert on allowlist-absence.
- **Pass 4 (Fresh-eyes sweep)**: Caught a silent-data-loss gap — during a wedge, a retryable op that times out and heals _silently_ drains any concurrently in-flight `mutate` to a _quiet_ `WorkerCrashError`, dropping the user's write with zero toasts. Closed it with a single `lostSiblings`-gated consolidating toast that reuses `surface()` (no `showToast` duplication, no signature churn): added Requirement 8, a caveat + toast-accounting table in Approach §2, Assumptions 8–9 (surface() quieting; no re-entrant double-spawn), the `lostSiblings` telemetry field, two acceptance criteria, and test 3. Confirmed no double key-post (one respawn per recovery) and no telemetry double-count (one warning per attempt).

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt (via /error-review, then /beanies-plan "go ahead to plan and fix")

> This morning I was seeing these issues again when opening the app. I saw them a few days ago as well and now this morning i'm seeing them again, it is causing data to fail to load in the PWA. when i force close and open the PWA again, then data loads fine. the issue is intermittent, i can't reliably reproduce it. [6 Slack doc-worker timeout alerts pasted — initAndLoadCache, flush, getHeads, exportEncryptedPayload, setKey, app.onboardingStallTimeout]

### Follow-up (invoking /beanies-plan)

> go ahead to plan and fix

### Follow-up (scoping)

> should we fix this together with notion #43, or do those separately? → agreed: separate, cross-referenced; ship this recovery fix first.

</details>
