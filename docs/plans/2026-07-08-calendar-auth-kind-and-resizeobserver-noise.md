# Plan: Fix calendar-sync auth-kind clobbering + ResizeObserver Slack noise

> Date: 2026-07-08
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-07-08-calendar-auth-kind-and-resizeobserver-noise.md`

> **No GitHub issue created.** This plan was approved for direct implementation. All prompt history is embedded in the `## Prompt Log` section below.

## User Story

As a beanies.family user with Google Calendar connected, I want the app to prompt me to reconnect when my Google authorization actually expires (instead of silently retrying forever and never syncing again) so that my activities keep reaching my calendar; and as the operator, I want `#beanies-errors` to page only on genuine, actionable problems so the channel stays trustworthy.

## Context

An `/error-review` triage of the 2026-07-07 `#beanies-errors` batch found three distinct signals. Investigation confirmed **none is a regression from the ADR-032 worker migration or the Layer-2 delta-sync work** — the OAuth proxy, calendar token refresh, and Drive token code are byte-identical across every build in the batch (`d60a5c81` → `8c3cdf5d`) and unchanged since 2026-06-10. The token errors are all from Greg's own accounts (`gparker97@gmail.com` + two dev/test families), and the common signal — "Token has been expired or revoked" / `silent_refresh_had_refresh_token: false` — means the Google grant itself is dead. Most likely cause: refresh tokens minted while the OAuth app was still in "Testing" publishing status expire after 7 days; OAuth verification was approved 2026-07-03, so pre-verification grants started dying ~2026-07-07, coinciding with (but not caused by) the worker rollout.

The triage nonetheless surfaced **one genuine pre-existing bug** and **one noise leak** worth fixing, because both will affect real users whenever a Google grant legitimately dies (revoke, password change, ~6-month idle expiry, or Google-side revocation):

### Signal 1 — GENUINE bug: calendar `authedFetch` clobbers the `'auth'` error kind → `'transient'`

`src/services/calendar/googleCalendarClient.ts` `createAuthedFetch` runs each Google call inside a retry loop. The inner `attempt()` (line 156-171) first calls `tokenProvider.getAccessToken(connectionId)`, which mints a token and — when the refresh token is dead — correctly throws `CalendarApiError('auth', 'token refresh failed: …expired or revoked')` (classifier `isPermanentRefreshFailure`, line 42-44, matches "expired or revoked"). **But** the retry catch (lines 179-187) assumes any throw from `attempt()` is a network/timeout transient and unconditionally re-wraps it:

```js
} catch (e) {
  // Network / timeout — transient; retry within budget.
  lastErr = new CalendarApiError('transient', e instanceof Error ? e.message : String(e));
  if (i < RETRY_BACKOFF_MS.length) { await delay(RETRY_BACKOFF_MS[i]); continue; }
  throw lastErr;
}
```

The message is preserved but the **kind is destroyed** (`'auth'` → `'transient'`), and the dead-token error is retried 3× against the already-dead refresh token before finally throwing as `'transient'`.

Downstream in `src/stores/calendarSyncStore.ts` `settleConnectionStatus` (line 388-449):

- `hasAuth = errors.some((e) => e.kind === 'auth')` is now **`false`**.
- The error takes the non-auth `otherErrors` path → sets connection status to `'error'` (never `'needs_reconnect'`) → increments `reconcileErrorCounters` → pages Slack **critical** at the `RECONCILE_ERROR_THRESHOLD` (3) mark (the observed `(sustained ×3)`), on every poll, forever.
- Because the connection never parks `needs_reconnect`, **the user is never prompted to reconnect their calendar** — it silently stops syncing while spamming the error channel.

The intended behavior (documented in `CalendarClient.ts:12` and the `settleConnectionStatus` auth branch) is: an `'auth'`/dead-refresh error parks `needs_reconnect` after `INVALID_GRANT_THRESHOLD` (2) consecutive auth failures, emits a single `'warning'` (not critical), and drives the Settings reconnect UI. The clobbering bug defeats all of it.

### Signal 2 — NOISE: `ResizeObserver loop completed with undelivered notifications` pages critical

Fired 3× (iOS Safari) via `window.addEventListener('error')` in `src/main.ts:50-58` as `surface: 'unhandled-error'`, `severity: 'critical'`. This is a well-known benign browser signal (the ResizeObserver spec's "notifications not delivered before the next paint" warning — no user impact, no app fault). The `unhandledrejection` handler in the same file already filters known browser transients (`isChunkLoadError`, `isIdbTransientError`) but the synchronous `error` handler has **no filter at all**, so this benign message pages as critical. (Note: the `unhandledrejection` handler is already non-paging — no `severity: 'critical'` — and ResizeObserver only ever surfaces synchronously via the `error` event, so the fix is scoped to the one handler that actually pages.)

### Signal 3 — EXPECTED (no code change): `offline-queue-flush` / `save-failure-banner` `TokenExpiredError`

Same root event as Signal 1 (Greg's Drive grant died: `silent_refresh_had_refresh_token: false`, `refresh_token_age_ms: null`). The save-failure banner correctly showed ("banner shown immediately (no recovery in flight)"), i.e. the reconnect UX worked as designed. This is the correct terminal "user must reconnect" state — analogous to the already-suppressed `cold-start-reconnect-no-refresh-token` known pattern, but on the `offline-queue-flush` surface. Low-volume, single-account, and the visible UX is correct. **No fix in this plan** — documented as an observation; revisit only if it recurs for a non-Greg family with `had_refresh_token: false`.

## Requirements

1. **Preserve classified error kinds in `authedFetch`'s retry catch.** A `CalendarApiError` thrown from the token mint (or anywhere in `attempt()`) must retain its original `kind`. Only genuinely-retryable kinds (`'rate_limited'`, `'transient'`) may be retried within the backoff budget; every other kind (`'auth'`, `'forbidden'`, `'not_found'`, `'conflict'`, `'unknown'`) must propagate immediately with its correct kind. A non-`CalendarApiError` throw (raw network/timeout `Error`) keeps the existing behavior: wrap as `'transient'` and retry within budget.
2. **Restore `needs_reconnect` behavior for dead-token errors.** With Requirement 1, a dead refresh token surfaces as `kind: 'auth'` to `settleConnectionStatus`, which then parks the connection `needs_reconnect` after `INVALID_GRANT_THRESHOLD` consecutive failures and emits a single `'warning'` rather than a sustained `'critical'`. No change to `settleConnectionStatus` is required — verify the fixed data flow drives it correctly.
3. **Stop retrying a dead refresh token.** An `'auth'` mint failure must not consume the 3-slot backoff budget (no point re-hitting a dead token thrice). Confirm via test that the refresh path is invoked exactly once for an `'auth'` failure.
4. **Suppress benign browser-platform messages from `#beanies-errors`.** `ResizeObserver loop completed with undelivered notifications` and `ResizeObserver loop limit exceeded` must not page Slack. The suppression is applied at the `window.addEventListener('error')` handler in `src/main.ts` — the single handler that pages critical for this signal — mirroring the existing `isChunkLoadError` / `isIdbTransientError` allowlist pattern. Suppressed events still log to console for dev visibility.
5. **No silent failures introduced.** Every suppressed/short-circuited path emits a `console.warn`/`console.debug` breadcrumb. No behavior change to genuine errors: real auth/forbidden/network/render errors continue to report exactly as before.
6. **Document Signal 3 as a known-good terminal state** (in this plan and, if warranted, the known-noise memory) so a future triage doesn't re-investigate it from scratch.

## Important Notes & Caveats

- **The `'auth'` early-return in `settleConnectionStatus` also resets `reconcileErrorCounters`** (line 417) — good; the fix means a flapping auth error can't leave a stale transient count that later false-trips "sustained". No change needed, but do not remove that reset.
- **Do not widen the ResizeObserver matcher into a generic "swallow anything" filter.** Match only the two exact ResizeObserver benign strings. A too-broad predicate would hide real errors — the same discipline the existing `isChunkLoadError`/`isIdbTransientError` predicates follow (narrow, specific).
- **The `error` event's `event.error` is frequently `null` for ResizeObserver** — the signal lives in `event.message`. The predicate must accept and match a plain string (the message), not rely on an `Error` object.
- **Scope Fix 2 to the `error` handler only — do NOT add a matching guard to `unhandledrejection`.** ResizeObserver loop errors surface synchronously via the `error` event, never via a promise rejection, and the `unhandledrejection` handler is already non-paging. Adding a third guard there would be speculative dead code (untestable in practice) and an extra maintenance point for no observed benefit. `isBenignBrowserError` is the documented single extension point: if a future triage ever finds a benign browser signal arriving via rejection, add the guard there _then_, backed by a real payload.
- **`authedFetch` is the single choke-point** for all Google Calendar REST calls (`insertEvent`, `patchEvent`, `deleteEvent`, `eventExists`, `listEvents`, `listCalendars`). Fixing the catch here fixes every call site at once — do not patch individual verbs.
- **The existing per-request 401 re-mint logic (lines 191-203) is separate and correct** — that handles a just-expired _access_ token (HTTP 401 on the response) with a one-shot re-mint. The bug is only in the _thrown-from-attempt_ catch. Leave the 401 re-mint path untouched.
- **The mint-auth path needs no `tokenProvider.invalidate`.** When `getAccessToken` throws, `cache.set` never ran (line 116-119 only runs on a successful refresh), so there is nothing cached to evict. Do NOT add a redundant `invalidate` call in the new catch — that invalidate is the response-path 401's job (a token _was_ cached there). Keep the catch minimal.
- **Keep the loop's terminal `throw lastErr ?? …` (line 214).** Because the new catch assigns `lastErr = classified` before throwing on the terminal path and the loop only re-enters on `continue` (retryable), the final fallthrough is unchanged in meaning — it is the exhausted-backoff safety net. Do not simplify it away.
- **Benign edge (intended): the connection-not-found mint error now propagates immediately as `'unknown'`** instead of being re-wrapped `'transient'` and retried 3×. `getAccessToken` throws `CalendarApiError('unknown', 'calendar connection … not found')` (line 102) when a connection is deleted mid-reconcile; it is non-retryable under Requirement 1. Downstream `settleConnectionStatus` routes both `'unknown'` and `'transient'` down the non-auth `otherErrors` path, so there is no reconnect/paging behavior change — only the removal of three pointless retries. Called out so a future maintainer isn't surprised by the kind label change.
- **No deploy** as part of this work. Greg triggers deploys explicitly.
- Both dev/test families in the batch (`GP Dev Fam v4`, `Test worker 4`) only hit the ResizeObserver signal, not the calendar bug — consistent with the calendar issue being specific to accounts with a live-but-dead-grant calendar connection.

## Assumptions

> **Review these before implementation.** Valid at planning time (2026-07-08).

1. `refreshCalendarToken` (`calendarAuth.ts:231`) → `refreshAccessToken` (oauthProxy) throws an `Error` whose `.message` contains "expired or revoked" (or "invalid_grant") for a dead grant — confirmed against the Slack payloads and `oauthProxy.ts:170`. If Google ever changes the `error_description` wording, `isPermanentRefreshFailure` would need a new substring; out of scope here (this plan fixes the kind-preservation, not the classifier, which is already correct for the observed strings).
2. `settleConnectionStatus`'s `'auth'` branch and `INVALID_GRANT_THRESHOLD`/`needs_reconnect` UI wiring are correct and already tested — the only defect is upstream kind loss.
3. No other caller depends on `authedFetch` throwing `'transient'` for what is actually an `'auth'` failure. The reconcile engine is the only consumer and it branches on `kind`.
4. The ResizeObserver messages are the only benign browser-platform signals currently leaking through the synchronous `error` handler. (If triage later finds more, the same predicate is the extension point.)

## Approach

### Fix 1 — Preserve error kind in `authedFetch`'s retry catch (`src/services/calendar/googleCalendarClient.ts`)

The response-path branch already encodes the retry policy inline (line 207: `if ((kind === 'rate_limited' || kind === 'transient') && i < RETRY_BACKOFF_MS.length)`). The new catch must apply the identical policy — so rather than duplicate the predicate, extract it once and reuse it in **both** places (DRY):

```ts
// module scope, near classifyStatus
/** Kinds worth retrying within the backoff budget; every other kind is terminal
 *  and must propagate with its true kind (notably 'auth' → parks needs_reconnect). */
function isRetryableKind(kind: CalendarErrorKind): boolean {
  return kind === 'rate_limited' || kind === 'transient';
}
```

Rewrite the retry catch (lines 179-187) to classify once and defer to the shared predicate:

```js
} catch (e) {
  // `attempt()` throws from one of two places: the token mint
  // (`tokenProvider.getAccessToken` → a *classified* CalendarApiError — notably
  // 'auth' when the shared refresh token is dead), or fetch/timeout (a raw Error
  // = network transient). Preserve a classified kind: blindly re-wrapping as
  // 'transient' hid dead-refresh 'auth' errors from the reconcile engine, so the
  // connection never parked needs_reconnect and paged Slack as a sustained
  // transient on every poll. Same retry policy as the response path below —
  // only retryable kinds back off; every other kind propagates immediately.
  const classified =
    e instanceof CalendarApiError
      ? e
      : new CalendarApiError('transient', e instanceof Error ? e.message : String(e));
  lastErr = classified;
  if (isRetryableKind(classified.kind) && i < RETRY_BACKOFF_MS.length) {
    await delay(RETRY_BACKOFF_MS[i]);
    continue;
  }
  throw classified;
}
```

And update the response-path branch (line 207) to call the same helper:

```js
const err = new CalendarApiError(kind, `Google Calendar HTTP ${res.status}`, res.status);
if (isRetryableKind(kind) && i < RETRY_BACKOFF_MS.length) {
  lastErr = err;
  await delay(RETRY_BACKOFF_MS[i]);
  continue;
}
throw err;
```

~12-line, single-choke-point change: one new module-private helper, both retry sites share it (no duplicated predicate), no signature change, no new export.

### Fix 2 — Suppress benign browser-platform messages (`src/utils/benignBrowserError.ts` + `src/main.ts`)

New tiny predicate, consistent with the existing `isChunkLoadError` (`hardReload.ts`) and `isIdbTransientError` (`idbTransient.ts`) convention — both standalone `src/utils/*.ts` modules with **co-located** `src/utils/*.test.ts` files:

```ts
// src/utils/benignBrowserError.ts
const BENIGN_BROWSER_MESSAGES = [
  'ResizeObserver loop completed with undelivered notifications',
  'ResizeObserver loop limit exceeded',
] as const;

export function isBenignBrowserError(errOrMessage: unknown): boolean {
  const msg =
    typeof errOrMessage === 'string'
      ? errOrMessage
      : errOrMessage instanceof Error
        ? errOrMessage.message
        : '';
  return BENIGN_BROWSER_MESSAGES.some((m) => msg.includes(m));
}
```

Wire into `src/main.ts` — **the `error` handler only**:

```js
window.addEventListener('error', (event) => {
  if (isBenignBrowserError(event.message)) {
    console.debug('[main] benign browser signal — not reporting:', event.message);
    return;
  }
  reportError({
    surface: 'unhandled-error',
    severity: 'critical',
    message: event.message || 'Uncaught error',
    error: event.error,
  });
});
```

Do NOT touch `unhandledrejection`. Suppressed events log to console and never reach `reportError` — no silent failure.

### Non-code — Signal 3 documentation

Append a known-noise memory entry for the `offline-queue-flush` + `save-failure-banner` dead-grant shape so a future triage recognizes it as the correct terminal reconnect state, not a bug. No code change.

## Files Affected

- `src/services/calendar/googleCalendarClient.ts` — add `isRetryableKind`; rewrite the `authedFetch` retry catch; point the response-path branch at the shared helper (Fix 1).
- `src/services/calendar/__tests__/googleCalendarClient.test.ts` — new tests (dead-refresh mint → `'auth'`, not retried; transient mint → retried; raw network throw → `'transient'`).
- `src/utils/benignBrowserError.ts` — **new** predicate (Fix 2).
- `src/utils/benignBrowserError.test.ts` — **new** co-located tests.
- `src/main.ts` — import + apply `isBenignBrowserError` in the `error` handler only (Fix 2).
- `src/stores/__tests__/calendarSyncStore.test.ts` — dead-token reconcile parks `needs_reconnect` + no sustained-critical.
- `CHANGELOG.md` — `Fixed` entries under 2026-07-08.
- Known-noise memory: `reference_known_noise.md` + `MEMORY.md` pointer — ResizeObserver entry + Signal-3 dead-grant note.

## Acceptance Criteria

- [ ] A dead refresh token during reconcile surfaces to `settleConnectionStatus` as `kind: 'auth'` (unit-verified), the refresh path is called exactly once (no 3× retry), and the connection parks `needs_reconnect` after `INVALID_GRANT_THRESHOLD` consecutive failures.
- [ ] A dead-token reconcile emits at most a single `'warning'` Slack page (the needs_reconnect park), never a `'critical'` `(sustained ×N)`.
- [ ] A genuine `'transient'` mint failure is still retried within the backoff budget; a raw network/timeout `Error` from `fetch` is still wrapped `'transient'` and retried (no regression).
- [ ] The response-path retry branch behaves identically after being routed through `isRetryableKind` (429/5xx retry, 404/409/403 propagate, 401 re-mint once) — existing tests remain green.
- [ ] `ResizeObserver loop…` (both strings) no longer reach `reportError` from the `error` handler; both still log to console. The `unhandledrejection` handler is unchanged.
- [ ] Real uncaught errors (non-benign) continue to report `unhandled-error` critical exactly as before.
- [ ] `npm run type-check`, `npm run lint`, and the full unit suite pass. New tests added for all three Fix-1 branches and both Fix-2 predicate cases.

## Testing Plan

1. **Unit — `googleCalendarClient.test.ts`:** dead-refresh `'auth'` mint → throws `'auth'`, mint called once; `'transient'` mint → retried (call count = backoff+1) then throws `'transient'`; raw `Error` from `fetch` → wrapped `'transient'`, retried; existing response-path tests remain green.
2. **Unit — `benignBrowserError.test.ts`:** matches both ResizeObserver strings (as `string` and `Error`); returns `false` for a real error message, empty string, `null`, `undefined`, non-Error object.
3. **Unit — `calendarSyncStore.test.ts`:** reconcile throwing `CalendarApiError('auth')` twice → status `needs_reconnect`, single `'warning'` reportError, `reconcileErrorCounters` reset, no `'critical'`.
4. **Manual (optional, dev):** invalidate a calendar refresh token, trigger reconcile → `needs_reconnect` in Settings, auth-path console, no retry storm.
5. **Regression sweep:** `npm run type-check && npm run lint && npm test -- --run` all green.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the two-fix plan (calendar auth-kind preservation; benign-browser-message suppression) plus Signal-3 documentation, with root-cause analysis confirming no worker-migration regression.
- **Pass 2 (DRY + error handling)**: Extracted shared `isRetryableKind` used by both `authedFetch` catch branches; co-located the new predicate test; documented that the mint-auth path must NOT add a redundant `tokenProvider.invalidate`.
- **Pass 3 (Sustainability)**: Scoped Fix 2 to the single `error` handler that pages critical; dropped the speculative `unhandledrejection` benign guard as untestable dead code; documented `isBenignBrowserError`'s `unknown` signature as the cheap single extension point.
- **Pass 4 (Fresh-eyes sweep)**: Re-verified every load-bearing line against source; documented the terminal `throw lastErr ?? …` safety net and the intended connection-not-found `'unknown'` edge. No functional changes.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt (/error-review)

> Since we've been working on the autoworker migration and layer 2 fixes, I've been noticing a lot more token disconnects, and have also been seeing more errors triggered to slack. Please review the below errors and suggest if there have been any regressions, whether in token handling or in general keeping a persisent connection to google drive to ensure there is no disruption to users: [batch of ~15 Slack error alerts from 2026-07-07 — calendar-sync token-refresh errors, ResizeObserver unhandled-error, offline-queue-flush/save-failure-banner TokenExpiredError]

### Follow-up (/beanies-plan)

> prepare a plan to address and fix all identified issues ensuring we are improving functionality and without any introducing any new error or side effects

### Follow-up

> show me the plan in plan dialog

</details>
