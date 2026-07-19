# Plan: Self-healing doc-worker timeouts — quiet recovery, single escalation path

> Date: 2026-07-19
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-07-19-self-healing-doc-worker-timeouts.md`

## User Story

As a beanies.family user, I want the app to quietly recover from background/resume worker hiccups so that I only ever see an error when something is genuinely wrong with my data AND there is something I can do about it.

## Context

Six `critical` Slack pages fired on 2026-07-18 (one family, three devices — Windows Chrome, Android Chrome PWA, Pixel 10 Pro native WebView): `doc-worker 'flush'/'initAndLoadCache'/'exportEncryptedPayload' timed out` toasts plus two `save-failure-banner` escalations. Triage (2026-07-19 `/error-review`) confirmed **no data-integrity impact** — every case self-healed via the next auto-sync — but the user saw a critical toast with no action to take, and Slack was paged for conditions that resolve themselves.

Root causes, all in `src/services/automerge/worker/docClient.ts`:

1. **Suspension-blind deadlines.** RPC timeouts use wall-clock `setTimeout` (45 s light / 120 s heavy via `withTimeout`). When the tab/WebView is backgrounded or frozen (mobile background, overnight desktop tab freeze), the deadline keeps counting while both the page and the worker are suspended. On resume the throttled timers fire immediately → false "timed out" for a worker that was never hung. The 2:41 AM `flush` alert is the purest case: `bootstrap.ts:35` fires the backgrounding cache flush exactly as the page hides, so the freeze clock almost guarantees a false timeout.
2. **Probe-says-alive still alarms.** The A7 corroboration probe exists precisely to detect false positives — and when the ping answers ("worker alive, not torn down", `docClient.ts:526–533`) the code _still_ throws through `surface()`, toasting + paging for a worker it just proved healthy.
3. **Light-op-behind-heavy still alarms.** A light op (45 s) queued behind a progressing heavy op (120 s) is spared teardown (`docClient.ts:508–512`) but still rejected with a toast, despite being merely queued, retryable, and background.
4. **Every doc-worker toast pages Slack.** Both toast sites — `surface()` (`docClient.ts:593`) and the `onWorkerError` crash handler (`docClient.ts:244`) — call `showToast(..., { critical: true })` → `severity: 'critical'` page for **all** non-quiet worker failures, duplicating the deliberately-debounced escalation that already exists (the 3-consecutive-failures `save-failure-banner`, which has real recovery CTAs). The recovery-path `reportError` at `docClient.ts:547` already chose `'warning' — never pages`; the toasts contradict it.

greg's directive: _"self-heal these issues as much as possible. only show an error toast to the user on a genuine, fatal, unrecoverable error that impacts data integrity, with an error path (i.e. reconnect data file). otherwise self-heal, log an error if needed to cloudwatch, but do not bother the user."_

## Requirements

1. **Suspension-aware RPC deadlines**: time spent hidden/frozen must not count toward declaring a worker dead. A deadline that fires after (or during) a hidden period re-arms instead of timing out.
2. **Probe-corroborated-alive → transparent retry**: when the liveness probe answers and the method is in `RETRYABLE_METHODS`, re-issue the call on the live worker instead of surfacing an error.
3. **Light-op-behind-heavy → keep waiting**: a light op spared by the heavy/mutate-in-flight guard extends its deadline instead of rejecting.
4. **Toast policy**: the "We couldn't update your data" toast fires **only** for failed user-action ops (`mutate`, `initDoc`) where the user's edit is genuinely in doubt. All background/retryable op failures (`flush`, `exportEncryptedPayload`, `initAndLoadCache`, merges, reads, persists) are logged to CloudWatch and left to self-heal — no toast.
5. **Paging policy**: no doc-worker toast pages Slack (`critical: true` removed). This applies to **every** toast site in docClient — `surface()` _and_ the `onWorkerError` crash toast. The **single** paging escalation for "data isn't saving" remains the `save-failure-banner` (already debounced to 3 consecutive Drive-save failures, already `critical`, already carries recovery actions: refresh / re-select file / Settings → Family Data). The cache-durability banner (`cache-persist` surface) similarly remains the escalation for local-persist failure.
6. All suppressed/self-healed paths still emit structured CloudWatch events (no silent failures).
7. No behavior change to: the rehydrate bypass (A1), the probe primitive (A7), inline mode, `recoverDeadWorker` teardown semantics, or the retry-after-respawn flow.

## Important Notes & Caveats

- **`mutate` must never auto-retry** (double-apply risk) — unchanged. A `mutate` timeout with a live worker is genuinely ambiguous (the op may still land late; its projection delta would be discarded by cid → stale UI until the next delta). That ambiguity is exactly the "user action in doubt" case, so `mutate`/`initDoc` keep their toast — but as a non-paging toast.
- **Bounded-ness invariant**: deadline extensions must be bounded. A worker that is _genuinely_ hung on a visible page must still surface at its ceiling. Extensions are allowed only for: (a) the page was hidden at any point during the wait, (b) the page is hidden right now, (c) a heavy/mutate op is still in flight (light ops only). Re-arms where the page **is hidden at fire time** do NOT count toward `MAX_DEADLINE_EXTENSIONS` — otherwise an overnight-hidden tab (throttled timers still fire while hidden-but-not-frozen) burns all extensions and rejects while hidden, recreating the exact resume-time false alarm this plan removes. Only visible-page re-arms (`was-hidden-during-window`, `busy-behind-heavy`) count toward the cap, which preserves the invariant that a genuinely hung worker on a _visible_ page surfaces at its ceiling. Hidden-now re-arms are still bounded in practice (the loop only re-arms one budget at a time and stops the moment the page is visible with no hidden interval). Additionally, the loop enforces an **absolute wall-clock ceiling** (`ABSOLUTE_DEADLINE_CEILING_MS = 10 * 60_000`, measured from first arm): regardless of reason — including hidden-now re-arms — a call rejects at the ceiling with a distinct message (`doc-worker '<method>' exceeded absolute deadline`). This converts a pathological visibility state (e.g. a WebView bug leaving `document.hidden` stuck `true` while the user is active) from an infinitely-pending promise into a bounded, observable failure. "Bounded in practice" is not a guarantee; the ceiling makes it one.
- **The backgrounding `flush` (`bootstrap.ts`) races the freeze by design** — it _should_ be attempted (narrows the last-edit-loss window) but its failure is expected noise. Under the new policy its timeout is firehose-only; the call site gains a no-op rejection handler — `void docClient.flush().catch(() => {})` with a comment that the failure is already reported by docClient's `notifyFailure` policy — so the same failure doesn't double-report via `main.ts`'s `unhandledrejection` catch-all.
- The corroboration probe (`PING_TIMEOUT_MS`, `opts.probe`) deliberately also runs under the suspension-aware deadline: if the page hides mid-probe, the probe extends rather than false-confirming worker death and tearing down mid-suspension. Its 5 s budget and no-recover/no-report semantics are unchanged.
- **Late replies are already safe**: a timed-out cid is deleted from `pending`; a late worker reply is discarded (`onMessage` cid miss). Re-issuing a RETRYABLE method on a live worker can at worst duplicate idempotent work.
- The A7 in-flight guard reads `pending` — the extension loop must keep the cid in `pending` while extending (do not delete until the final timeout is declared).
- `withTimeout` (`src/utils/timing.ts`) stays untouched — it has many callers with correct semantics. The visibility-aware deadline is a docClient-local concern.
- The `tr(key, fallback)` translate-with-English-fallback helper **already exists** in `src/services/auth/biometricShared.ts:16` (generic, Pinia-pre-init-safe, zero auth dependencies). Do not re-implement the try/catch pattern inline. Since importing an auth module from docClient is poor layering, **move `tr` to `src/services/translation/tr.ts`** and re-export it from `biometricShared.ts` (zero call-site churn), then import it in `docClient.ts`. New uiStrings key `docWorker.updateFailed` (en + beanie; `npm run translate` for zh).

## Assumptions

> **Review these before implementation.**

1. `document.visibilitychange` fires reliably on resume across Chrome, Safari, and the Capacitor WebView (it does — bootstrap already relies on it for the liveness ping).
2. `save-failure-banner` and the durability banner remain the only user-facing escalations needed for persistent save/persist failure; both have recovery CTAs (verified: `SaveFailureBanner.vue` refresh + file-reselect + Settings deep-link).
3. The `doc-worker-recovery` surface's existing allowlisted context keys (`recovery_method`, `recovery_attempt`, `lost_siblings`) plus generic keys cover the new events — **no new context key** (no privacy-manifest churn).
4. All alerts triaged came from build `f0c0896a` (current HEAD app code); no fix has shipped since.

## Approach

All changes in `src/services/automerge/worker/docClient.ts` plus one new export on the existing `src/utils/visibilityTracker.ts`.

### 1. Suspension-aware deadline loop (replaces the single `withTimeout` at `requestCore`)

**Reuse `src/utils/visibilityTracker.ts`** — the repo already has a single-source-of-truth visibility tracker (lazy-registered listener, records `lastHiddenAt`/`lastVisibleAt`; already consumed by `syncStore` and the silent-refresh alert context). Add one exported helper there (the module already owns the listener and state):

```ts
/** True if the page is hidden now, was hidden at any point since `sinceTs`,
 * or became visible since `sinceTs` (a resume transition during the window
 * implies the page was hidden when the window opened — covers an RPC armed
 * while already hidden, e.g. the backgrounding flush, independent of
 * visibilitychange listener registration order). */
export function wasHiddenSince(sinceTs: number): boolean {
  ensureVisibilityListener();
  if (typeof document !== 'undefined' && document.hidden) return true;
  const { lastHiddenAt, lastVisibleAt } = visibilityTracker;
  if (lastHiddenAt !== null && lastHiddenAt >= sinceTs) return true;
  return lastHiddenAt !== null && lastVisibleAt !== null && lastVisibleAt >= sinceTs;
}
```

(The `lastHiddenAt !== null` guard on the third clause prevents the module-load initialization of `lastVisibleAt` — or a spurious visible event with no prior hidden — from reading as "was hidden". `lastVisibleAt` is initialized to module-load `Date.now()`, which always precedes any arm, so it cannot false-positive on its own.)

New local helper in docClient (not in `timing.ts`):

```ts
const MAX_DEADLINE_EXTENSIONS = 3;

/** Await an RPC response with a deadline that doesn't count suspended time.
 * At each timer fire: if the page is hidden now, or was hidden at any point
 * since the last (re-)arm, or `extendWhile()` says the worker is legitimately
 * busy — re-arm a full budget (hidden-now re-arms don't consume the bounded
 * MAX_DEADLINE_EXTENSIONS cap; visible-page re-arms do). Otherwise reject
 * with the timeout error. */
async function awaitWithSuspensionAwareDeadline<T>(
  promise: Promise<T>,
  budgetMs: number,
  message: string,
  extendWhile?: () => boolean
): Promise<T>;
```

Implementation shape: loop over `withTimeout`-style races; capture `armedAt = Date.now()` before each (re-)arm and call `wasHiddenSince(armedAt)` on timer fire to decide extend-vs-reject; call `wasHiddenSince` once at first arm so the lazy listener is registered _before_ any hidden transition during the wait. Extension telemetry is **capped per call**: emit the `deadline extended (<reason>)` `logEvent` only on the _first_ extension for each reason, then one summary on settle (resolve or final reject) carrying the total extension count in `recovery_attempt`. A hidden tab's throttled timers fire ~once/minute, so per-fire logging of an overnight-pending `flush` would emit hundreds of near-identical events per RPC — noise that buries the signal and inflates CloudWatch cost. Timer always cleared on settle.

`requestCore` calls it with `extendWhile` = the existing light-op-behind-heavy/mutate predicate (for non-heavy methods only), which **replaces** the current throw-on-guard branch as the primary path — the guard's spare-the-worker knowledge moves into the deadline instead of producing a user-visible rejection.

**Backstop — the in-flight guard also STAYS in the timeout catch** (as today at `docClient.ts:508–512`, now firehose-only instead of toasting): if a light op still exhausts its extensions while a heavy/mutate op is in flight, it must reject _without_ running the corroboration probe. A live worker executing a long synchronous WASM op cannot answer the 5 s ping (serial FIFO), so probing here would false-confirm death and tear down a progressing heavy op — the exact failure the original guard exists to prevent. Moving the check _only_ into `extendWhile` would silently delete that protection.

### 1b. Structural: extract `handleRpcTimeout`

The `catch (timeoutErr)` block in `requestCore` is already ~90 lines with five ordered branches (rehydrating → probe → in-flight guard → corroboration → teardown/retry), and this plan adds a sixth (probe-alive retry). Rather than deepen it, **extract the entire catch body into a named module-private function** `handleRpcTimeout(timeoutErr, method, args, opts, attempt, cid)` that returns either a retry result (by calling back into `requestCore`) or throws. `requestCore` keeps the happy path readable (~30 lines); the ordered decision ladder gets a single doc comment enumerating the branches in precedence order. Pure extraction plus the new branches — no behavior moves other than what this plan specifies.

### 2. Probe-alive → transparent retry (the `pingAnswered` branch)

```ts
if (pingAnswered) {
  logEvent({ ...existing 'liveness-false-positive' event... });
  if (attempt === 1 && RETRYABLE_METHODS.has(method)) {
    return requestCore(method, args, opts, 2); // re-issue on the live worker
  }
  throw surface(timeoutErr, method, opts.quiet); // policy inside surface(): background op → firehose-only, user-action → non-paging toast
}
```

The re-issue rides the same `attempt` escalator as the respawn retry, so at most one transparent retry total per call — a second timeout falls through to the normal teardown/reject path.

### 3. Toast + paging policy — one helper for all three failure sites

```ts
const USER_ACTION_METHODS = new Set(['mutate', 'initDoc']);

/** Toast (non-paging) iff a user-action op is implicated; otherwise firehose-only. */
function notifyFailure(error: Error, methods: string[]): void {
  if (methods.some((m) => USER_ACTION_METHODS.has(m))) {
    showToast(
      'error',
      tr('docWorker.updateFailed', "We couldn't update your data"),
      error.message,
      {
        surface: 'doc-worker',
        error, // no `critical` — never pages; useToast auto-reports at severity 'error'
      }
    );
  } else {
    reportError({
      surface: 'doc-worker',
      message: `background op(s) '${methods.join(',')}' failed — self-heal pending`,
      error,
      severity: 'error',
    });
  }
}
```

`USER_ACTION_METHODS` is the **fifth** method-classification set in this file (with `JSON_SAFE_METHODS`, `HEAVY_METHODS`, `ENVELOPE_METHODS`, `RETRYABLE_METHODS`). Its doc comment must follow the `RETRYABLE_METHODS` pattern: state the axis (user-visible edit in doubt vs. background self-healable), the failure-direction of an omission (a missed method degrades to firehose-only — invisible to the user but recoverable), and that the axes are orthogonal and change independently. Additionally, extend the existing comment block above the sets with a one-line **new-method checklist**: "adding a worker method? Decide membership in each of the five sets explicitly." That keeps the classification burden a single glance instead of tribal knowledge.

- `surface()` calls `notifyFailure(error, [method])` in its existing `!quiet && !expected` branch (classification unchanged: `CorruptPayloadError`/`WorkerCrashError` stay quiet).
- `onWorkerError` replaces its inline toast with `notifyFailure(err, [...pending.values()].map(p => p.method))`, **retaining the existing `pending.size > 0` guard** — a crash with no in-flight work stays console-only + lazy re-spawn, exactly as today (crash with only background ops in flight → firehose, no toast, no page; crash with a `mutate` awaiting → toast, no page).
- The toast path needs **no separate `reportError`** — `useToast` already auto-reports error toasts (surface/error/context) at non-paging severity when `critical` is omitted. Do not add one (double-reporting).
- **Drained siblings — both teardown branches**: `handleRpcTimeout` captures `const drainedMethods = [...pending.values()].map(p => p.method)` **once, before `recoverDeadWorker()`** empties `pending`, and:
  - **retry branch** (attempt 1, retryable): calls `notifyFailure(timeoutErr, drainedMethods)` when non-empty (this call itself heals — replaces the old `surface(timeoutErr, method, false)` sibling toast at `docClient.ts:557`);
  - **terminal branch** (non-retryable or retry exhausted): classifies over the _full_ implicated set — `notifyFailure(timeoutErr, [method, ...drainedMethods])` — then throws the error **without** routing the notification through `surface()` (give `surface()` an optional `implicatedMethods?: string[]` parameter defaulting to `[method]`, threaded to `notifyFailure`, so there is still exactly one classify-and-notify site and no double-toast). A drained `mutate` behind a failed background op therefore still toasts (non-paging); an all-background drain degrades to one firehose event.

### 4. What deliberately does NOT change

- `save-failure-banner`: still `critical`, still pages, still 3-strikes-debounced (`syncService.ts:240–264` + `syncStore.ts:307–343`), still deferred 5 s behind silent-refresh recovery. With the upstream false-timeouts gone, its pages become genuine signal.
- `cache-persist` durability banner: unchanged (local-durability escalation).
- `recoverDeadWorker`, rehydrate bypass, probe primitive, inline fallback, `RETRYABLE_METHODS` membership: unchanged.
- `withTimeout`/`raceTimeout` in `timing.ts`: unchanged. `bootstrap.ts`: one-line no-op `.catch` on the backgrounding flush (dedupes the unhandled-rejection report); otherwise unchanged.

## Files Affected

- `src/services/automerge/worker/docClient.ts` — deadline loop, probe-alive retry, `notifyFailure` policy helper (covers `surface` + `onWorkerError` + drained siblings)
- `src/utils/visibilityTracker.ts` — new `wasHiddenSince()` export (+ its test in `src/utils/__tests__/`)
- `src/services/translation/tr.ts` — `tr()` relocated from `biometricShared.ts` (which re-exports it)
- `src/services/translation/uiStrings.ts` — `docWorker.updateFailed` key
- `src/services/automerge/worker/bootstrap.ts` — no-op rejection handler on the backgrounding flush
- `src/services/automerge/worker/__tests__/docClient.test.ts` — updated + new tests
- `docs/plans/2026-07-19-self-healing-doc-worker-timeouts.md` — this plan

## Observability Coverage

- **Events**:
  - `doc-worker-recovery` / `logEvent` `info` — `deadline extended (hidden|was-hidden|busy-behind-heavy)` with `{ recovery_method, recovery_attempt }` — **first occurrence per reason per call + one settle summary with total count** (bounded events per RPC). New event, existing keys.
  - `doc-worker-recovery` / `logEvent` `info` — `liveness-false-positive` retry (existing event, now followed by a transparent retry instead of a throw).
  - `doc-worker-recovery` / `reportError` `warning` — worker confirmed-dead teardown (existing, unchanged; never pages).
  - `doc-worker` / `reportError` `error` — background op(s) failed after all healing (new firehose event replacing the toast for non-user-action ops; also covers worker crash with only background ops in flight).
  - `doc-worker` / non-paging toast auto-report via `useToast` (`severity: 'error'`) — user-action op failed.
  - `save-failure-banner` / `reportError` `critical` — unchanged (the single page).
- **Failure modes covered**: false timeout from suspension (extension events show the hidden reason + count); worker alive-busy (false-positive event + retry attempt visible via `recovery_attempt: 2`); worker genuinely dead (teardown warning, unchanged); worker crash (`onerror`) with background vs user-action ops distinguished by `notifyFailure`; background op exhausts healing (the `error` event carries methods + message); user-action op fails (toast auto-report). No bare catches introduced; every suppressed toast is replaced by a structured event.
- **Success-path signal**: unchanged — Drive-save success already emits via `recordSaveSuccess` → sync telemetry, and worker RPC durations flow through existing `perfTiming` labels; extension events give the false-timeout _rate_ denominator.
- **Critical vs telemetry**: only `save-failure-banner` (and the pre-existing cache-persist / rollback-failed criticals elsewhere) page. Nothing in docClient pages.
- **Privacy/store gate**: **no new context keys** — reuses `recovery_method`, `recovery_attempt`, `lost_siblings`. No allowlist/store-declaration churn.

## Acceptance Criteria

- [ ] A light RPC whose wait spans a hidden period re-arms instead of timing out (unit test with fake timers + stubbed `wasHiddenSince`).
- [ ] An RPC **armed while the page is hidden** whose timer fires after the resume transition (hidden-now false, `lastHiddenAt` < arm, `lastVisibleAt` > arm) re-arms instead of timing out — the backgrounding-flush scenario (test in both `visibilityTracker` and docClient suites).
- [ ] A light RPC that fires while the page is hidden re-arms without consuming user-visible failure (test).
- [ ] Extensions are bounded: a genuinely hung worker on a visible page rejects after ≤ `MAX_DEADLINE_EXTENSIONS` _visible-page_ re-arms; a hidden-at-fire re-arm does not consume the cap (test).
- [ ] Absolute ceiling: a call whose page is permanently hidden rejects at `ABSOLUTE_DEADLINE_CEILING_MS` with the distinct ceiling message — never pends forever (test with fake timers).
- [ ] Backstop guard: a light op that exhausts extensions while a heavy op is in flight rejects **without** probing or tearing down the worker (test asserts no `ping` posted, worker untouched).
- [ ] Extension events are capped: an RPC extended N times emits at most one event per reason plus one settle summary (test asserts `logEvent` call count).
- [ ] A retryable method whose probe answers is transparently re-issued once and succeeds with no toast, no `critical` (test).
- [ ] A light op behind an in-flight heavy op waits (deadline extends) instead of rejecting (regression on the existing two-tier-timeout test).
- [ ] `mutate` timeout: toast shown, **no Slack page**, no auto-retry (test asserts `showToast` called without `critical`).
- [ ] Background op (`flush`/`exportEncryptedPayload`) failure after exhausted healing: no toast, one `reportError` `severity:'error'` (test).
- [ ] Worker **crash** (`onerror`) with only background ops in flight: no toast, no page, one firehose `reportError` (test). With a `mutate` in flight: non-paging toast (test asserts no `critical`). With **no** ops in flight: no toast, no reportError (guard retained; console + recovery only) (test).
- [ ] Terminal teardown of a background op with a `mutate` sibling in flight: the non-paging toast fires (classification includes drained methods); with only background siblings: firehose-only (test).
- [ ] The backgrounding flush's rejection is handled at the call site — a flush timeout produces exactly one firehose event, none via `unhandled-promise-rejection` (test or manual verification).
- [ ] `wasHiddenSince` unit-tested in `visibilityTracker` tests; docClient tests stub it rather than the DOM.
- [ ] `save-failure-banner` behavior byte-identical (existing banner test suites green, untouched).
- [ ] New uiStrings key present in en + beanie + zh; no hardcoded toast literal remains in `docClient.ts` (covers **both** the `onWorkerError` and `surface()` sites).
- [ ] Diagnostic logging in **Observability Coverage** implemented and verified; no new context key shipped.
- [ ] Full suite + type-check + lint + `npm run build` green (no import-graph change expected, but the build runs anyway per `docs/lessons.md`).

## Testing Plan

1. Unit (fake timers): extension-on-hidden, extension-while-hidden, bounded-extensions (visible-only cap), probe-alive-retry, behind-heavy-wait, mutate-toast-no-page, background-op-firehose-only, crash-policy (background vs mutate in flight), sibling-drain policy, absolute-ceiling, backstop-no-teardown, capped-extension-events.
2. `wasHiddenSince` unit tests in the visibilityTracker suite (hidden-now, hidden-since, visible-transition-since / armed-while-hidden, not-hidden).
3. Existing worker-death/recovery suite (`docClient.test.ts` + recovery specs) — must stay green; update assertions that expected the old toast/critical behavior.
4. `npm run type-check && npm run lint && npm test -- --run && npm run build && npm run translate`.
5. Manual: background the PWA mid-save on Android, resume after >45 s → no toast, data saved on next auto-sync; CloudWatch shows `deadline extended` events.

## Review Passes

- **Pass 1 (Initial draft)**: drafted from the 2026-07-19 `/error-review` triage — suspension-aware deadlines, probe-alive retry, wait-behind-heavy, user-action-only toasts, single paging path.
- **Pass 2 (DRY + error handling)**: reuse existing `visibilityTracker` (drops bootstrap change + new export), closed the missed `onWorkerError` toast/paging site via a single `notifyFailure` policy helper, reuse the existing `tr()` i18n-fallback helper (relocated to translation/), capture drained-sibling methods before the drain, hidden-at-fire re-arms exempt from the extension cap.
- **Pass 3 (Sustainability)**: retained the in-flight spare-the-worker guard as a timeout-catch backstop (moving it solely into `extendWhile` would let a live worker mid-WASM be false-confirmed dead by the 5 s probe); added an absolute wall-clock deadline ceiling so a stuck-hidden visibility state cannot wedge a promise unboundedly; capped extension telemetry to first-per-reason + settle summary; extracted the growing `requestCore` timeout catch into a named `handleRpcTimeout` with a documented branch-precedence ladder; added a five-set method-classification checklist comment.
- **Pass 4 (Fresh-eyes sweep)**: fixed the `wasHiddenSince` arm-while-hidden blind spot (resume-transition clause — the backgrounding-flush case was still false-timing-out under the Pass 1–3 design); extended drained-sibling classification to the terminal teardown branch (a drained `mutate` behind a failed background op no longer loses its toast); retained the `onWorkerError` empty-pending guard; added a no-op `.catch` on the bootstrap flush to prevent double firehose reporting via the global `unhandledrejection` handler; documented that the corroboration probe intentionally runs under the suspension-aware deadline. Re-verified: paging gate (`errorReporter.ts:275` — only `critical` pages), context-key allowlist (`diagnosticContext.ts:142–144`), `tr()` location (`biometricShared.ts:16`), and all cited docClient line references.

## Prompt Log

> **No GitHub issue created.** This plan was approved for direct implementation.

<details>
<summary>Full prompt history</summary>

### Initial Prompt (via /error-review, 2026-07-19)

> I've been getting these errors across all app surfaces regularly over the past few days. they don't appear to impact the app but I'm not sure if data integrity or saving is impacted. i can also see these toasts being shown to users, but usually i can close it and do not see any impact. can you do a comprehensive dig into these errors to see if there is any actual issue and propose a fix if so? it is very distracting to see toast errors if thee is no recovery path or actual impact to the user, and degrades confidence
>
> [six #beanies-errors alerts, 2026-07-18: doc-worker 'flush'/'initAndLoadCache'/'exportEncryptedPayload' timeouts + two save-failure-banner criticals]

### Follow-up 1 (via /beanies-plan)

> yes please plan this change. the goal is to self-heal these issues as much as possible. only show an error toast to the user on a genuine, fatal, unrecoverable error that impacts data integrity, with an error path (i.e. reconnect data file). otherwise self-heal, log an error if needed to cloudwatch, but do not bother the user.

</details>
