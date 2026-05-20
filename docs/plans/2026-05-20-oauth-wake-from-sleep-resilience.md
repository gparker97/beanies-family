# Plan: OAuth silent-refresh — wake-from-sleep resilience + diagnostic visibility

> Date: 2026-05-20
> Related issues: None — direct implementation
> Plan file (will be saved): `docs/plans/2026-05-20-oauth-wake-from-sleep-resilience.md`
> Status: Phase 2 complete — all four review passes applied. Ready for approval.

## User Story

As a **beanies.family user** who keeps the app tab open overnight on my desktop, I want **silent token refresh to survive the moment my machine wakes from sleep** so that **I'm not forced to click "Reconnect" and re-consent every morning, and `#beanies-errors` stays signal-rich**.

## Context

This plan addresses a recurring user-experience issue and the operator-visibility gap that masks its cause:

- **Symptom**: User opens the app at night, leaves the tab. In the morning, they see a "Google session expired" toast and the reconnect banner. `#beanies-errors` fires 2–3 alerts (`offline-queue-flush`, `save-failure-banner`, occasionally a second `offline-queue-flush` ~20 min later). User has to click Reconnect and go through Google's account chooser again. High friction; users have reported it several times.
- **Confirmed root cause (2026-05-20 investigation)**:
  1. Google Cloud OAuth client publishing status is "In production" — refresh tokens are long-lived. The 7-day Testing-mode hypothesis is **ruled out**.
  2. CloudWatch logs for the 2026-05-19 failure showed **zero Lambda invocations** in either failure window. The `fetch()` call to `/oauth/google/refresh` never left the user's machine. The only invocation in the entire 24-minute window was at 22:55:32 UTC (a cold start, 147ms init duration), unattributable to either failure timestamp.
  3. This rules out: Lambda outage, cold-start timeout, Google rejection (`invalid_grant`), HTTP 5xx. The error classification is overwhelmingly `network` (`TypeError: Failed to fetch`).
  4. Most likely mechanism: **Chrome desktop on Windows resumes from sleep / modern standby; the network adapter takes 5–20 seconds to reattach (DHCP renewal, WiFi reassociation, DNS cache rebuild) while the JS event loop is already firing `visibilitychange`. `fetch()` returns `Failed to fetch` immediately during this window.** The current retry backoff (`[1500, 3000]` = 4.5s of patience) is below the typical Windows wake-reattach time.
- **Operator-visibility gap**: The rich `SilentRefreshDiagnostics` (per-attempt classification, error names, durations) is captured by `googleAuth.ts` for every failed refresh — but is currently **only attached to `cold-start-reconnect-escalation` alerts**. The `offline-queue-flush` alert that fires in this scenario throws a naked `TokenExpiredError` with no per-attempt detail. Operators cannot distinguish `network` from `timeout` from `http` from `permanent` without manually digging through Lambda logs.

The fix has two parts, sequenced together but landing in one plan:

- **Part A — fix the symptom**: extend the silent-refresh retry backoff so it survives the typical Windows wake-reattach window.
- **Part B — fix the observability**: attach existing diagnostics to `offline-queue-flush` alerts so the next firing self-attributes, and add refresh-token age tracking so future revocation patterns are visible.

## Findings from Pass 2 verification (codebase read)

Pass 1 made four claims about existing helpers; verifying them against the codebase revealed:

1. `getLastSilentRefreshDiagnostics()` — **confirmed exported** at `src/services/google/googleAuth.ts:705`. Reuse as planned.
2. `TokenExpiredError` — **confirmed exported** at `src/services/google/googleAuth.ts:929`. Reuse via `instanceof` as planned.
3. `ALLOWED_CONTEXT_KEYS` allowlist in `errorReporter.ts` — **confirmed contains** all five existing keys. The set is **module-private**, not exported — adding the key is an internal edit, not a new export.
4. `getHiddenDurationMs()` — **NOT exported.** Module-private to `src/stores/syncStore.ts`, defined alongside a module-private `visibilityTracker` and a lazy listener registrar. Pass 1 was wrong on this. Forces a small refactor (see Approach below).

Additional findings:

5. **Existing googleAuth retry test (`returns null after retrying when transient failure persists`, googleAuth.test.ts:516) uses REAL timers with a 10_000ms test timeout.** Today's `[1500, 3000]` backoff (4.5s) fits. The new `[1500, 3000, 6000, 12000]` backoff (22.5s) **will exceed the timeout** unless the test is migrated to `vi.useFakeTimers()` + `advanceTimersByTimeAsync()`. The fake-timers pattern is already used elsewhere in the same file (lines 621, 673, 1091).
6. **`offlineQueue.test.ts` already exists** at `src/services/sync/__tests__/offlineQueue.test.ts` with mocks for `reportError` and `onTokenAcquired` wired. Append; do not create.
7. **`getGoogleRefreshToken` currently swallows IDB-read failures with an empty `catch { /* fall through */ }`** at `src/services/sync/fileHandleStore.ts:213-215`. Pre-existing silent failure. In-scope because we are touching the read path anyway.
8. **Three write sites** for `storeGoogleRefreshToken` exist in `googleAuth.ts` (579, 643, 1407), plus a **fourth implicit write** in `migratePendingRefreshToken` at line 366. Migration must carry the pending entry's `issuedAt` forward, not reset it.
9. **localStorage fallback** stores/reads bare strings. The shape migration keeps localStorage bare-string (treat fallback as `issuedAt: null` per Pass 3 §18) to avoid a JSON.parse failure mode on legacy entries.

## Requirements

### Part A — Wake-from-sleep retry resilience

1. **Extend `RETRY_BACKOFF_MS` in `src/services/google/googleAuth.ts:807`** from `[1500, 3000]` to `[1500, 3000, 6000, 12000]`. `MAX_ATTEMPTS = 5` (1 initial + 4 retries), total patience ~22.5 seconds.
2. **Do not change the classification logic.** All transient classifications share the same backoff. Branching adds complexity for no measurable benefit.
3. **Do not change `FETCH_TIMEOUT_MS`** in `oauthProxy.ts`. Per-request timeout (15s) is correct; we extend retry-loop patience, not per-request patience.
4. **Do not add a `visibilitychange` debounce** in the offline queue. The retry loop already absorbs the wake race; solving in one place is cleaner.
5. **Cap protection**: do not exceed 5 total attempts.

### Part B — Observability

6. **Attach silent-refresh diagnostics to `offline-queue-flush` alerts.** When `flushQueue` rejects with a `TokenExpiredError` (detected via `instanceof`, never via `err.message` string-matching), `reportFlushFailure` in `src/services/sync/offlineQueue.ts:166-174` must attach:
   - `silent_refresh_attempts`
   - `silent_refresh_had_refresh_token`
   - `silent_refresh_consecutive_failures`
   - `page_hidden_for_ms`
   - `visibility_state`
7. **Reuse existing helpers — no duplication.** The cold-start path in `syncStore.ts:1718-1751` already builds this exact context block. Pass 2 makes DRY explicit: extract the alert-context builder so both surfaces share one implementation. See Approach §S2.
8. **Track refresh-token `issuedAt`.** IDB stored shape becomes `{ token: string, issuedAt: number | null }`. Reader treats a bare-string legacy IDB value (and localStorage fallback, which stays bare-string) as `{ token: stored, issuedAt: null }` (Pass 3 §18 — `null` not `0` to avoid the 1970-epoch trap).
9. **Surface refresh-token age on permanent-failure (`invalid_grant`) alerts.** When `performSilentRefresh` clears the refresh token after `invalid_grant`, capture `tokenAgeMs = currentRefreshToken?.issuedAt != null ? now - currentRefreshToken.issuedAt : null` and include in `lastSilentRefreshDiagnostics`. Add `refresh_token_age_ms` to the `errorReporter.ts` allowlist.
10. **Do not log family_id from the Lambda.** Out of scope. Privacy-sensitive; not required.

### Part C — In-scope silent-failure cleanup (Pass 2 addition)

11. **Make `getGoogleRefreshToken` IDB-read failure non-silent.** Mirror the existing `googleAuth.ts:779-787` pattern: `console.error` + `reportError({ surface: 'refresh-token-idb-read', ... })` then fall through to localStorage.
12. **Make `getGoogleRefreshToken` localStorage-read failure non-silent.** Convert to `console.warn` + return null. No `reportError` here — localStorage failures are typically private-browsing or quota; high false-positive rate would defeat the dedup.
13. **Make the two bare empty catches on localStorage write/clear paths emit `console.warn`** so nothing in the touched module fails silently.
14. **Wrap `clearGoogleRefreshToken` IDB delete in try/catch** (Pass 3 addition). Currently the IDB `await db.delete(...)` at `fileHandleStore.ts:230` is unwrapped — it can throw through callers like the `invalid_grant` cleanup branch at `googleAuth.ts:860` (the very branch we're adding `refresh_token_age_ms` to). Same treatment as §11: `console.error` + `reportError({ surface: 'refresh-token-idb-clear' })`. localStorage clear stays best-effort with `console.warn`.
    - **Swallow inside the function** (Pass 4 clarification). Both §11 (IDB-read) and §14 (IDB-clear) observe the failure (console + reportError) but **do not rethrow** — read falls through to localStorage; clear simply returns. Rationale: at the `invalid_grant` call site (`googleAuth.ts:860`), an exception here would escape `performSilentRefresh` entirely, skipping the diagnostics-write at line 862 and the `firePermanentFailureCallbacks()` at line 867 — a regression vs. today, where the IDB delete is unwrapped but the rest of the function still completes. The wake-listener's `.catch(() => {})` would then absorb the error with no diagnostics. Same shape as the existing localStorage-clear best-effort path.

### Part D — Sustainability (Pass 3 addition)

15. **Replace the loose pair `refreshToken: string | null` + (proposed) `tokenIssuedAt: number | null` with a single object `currentRefreshToken: StoredRefreshToken | null` in `googleAuth.ts`.** Token and `issuedAt` must stay coherent across **3 read sites, 4 write sites, and 2 in-memory clear sites** (Pass 4 terminology fix — IDB-clear sites are storage hygiene, separate concern). A loose pair makes each future change a chance to forget; a single object makes coherence impossible to break. All existing `refreshToken` references become `currentRefreshToken?.token`; age is `currentRefreshToken?.issuedAt`. Every in-memory clear-site naturally nulls both fields at once.
16. **Extract `buildSilentRefreshAlertContext()` into its own small module** at `src/services/google/silentRefreshAlertContext.ts` (Pass 2's S2 placed it in `googleAuth.ts`; Pass 3 moves it out). The builder depends on `getLastSilentRefreshDiagnostics()` + `getHiddenDurationMs()` + `document.visibilityState` — putting it in `googleAuth.ts` grows that file's concern surface and creates circular-import risk. A thin standalone module is testable in isolation and keeps `googleAuth.ts` focused on auth.
17. **Make the "max 5 attempts" cap an enforced invariant.** Add a unit test that asserts `MAX_ATTEMPTS <= 5`. A future maintainer extending `RETRY_BACKOFF_MS` would otherwise silently lift the cap.
18. **Use `number | null` (not `0`-sentinel) for `issuedAt` on legacy reads.** Bare-string legacy IDB → `{ token, issuedAt: null }`. localStorage fallback → `{ token, issuedAt: null }`. Age-on-failure computation treats `null` as "unknown" and reports `refresh_token_age_ms: null` in the alert. Avoids the 1970-epoch trap if any future code uses `issuedAt` for non-alert purposes (e.g. token rotation).

## Important Notes & Caveats

- The dedupe in `attemptSilentRefresh` already coordinates the wake listener and the offline-queue flush (both end up sharing the same `pendingSilentRefresh` promise).
- **`getHiddenDurationMs` is module-private to `syncStore.ts`.** Pass 2 fix: extract `visibilityTracker` + `ensureVisibilityListener` + `getHiddenDurationMs` into `src/utils/visibilityTracker.ts`. Import from both `syncStore.ts` and the new `buildSilentRefreshAlertContext` helper.
- **Existing `googleAuth.test.ts` "3 attempts with stepped backoff" test uses REAL timers.** Migration to `vi.useFakeTimers()` is mandatory before extending the backoff.
- **`offlineQueue.test.ts` already exists** with relevant mocks wired. Append; do not create.
- **Refresh-token storage migration is safe for downgrades.** Old reader does `typeof token === 'string'` and falls through to localStorage which stays bare-string. localStorage is the emergency escape hatch.
- **`getHiddenDurationMs` returns `null` if the page has never been hidden in this session.** Treat null as "unknown" in the payload — do not coerce to 0.
- **Allowlist gate**: `redactContext` drops unknown keys with a visible `console.warn` — no silent drop. Tests assert allowlist membership.
- **`reportFlushFailure` only attaches the diagnostic context when inner error is a `TokenExpiredError`.** For non-auth failures, attaching silent-refresh diagnostics would be misleading. The shared builder returns the block unconditionally; the caller decides whether to include it (gated on `instanceof TokenExpiredError`).
- **No deploy.** Per project convention.
- **CHANGELOG entry** lands in the implementation PR, framed around user benefit.

## Assumptions

> **Review these before implementation.**

1. **Chrome desktop on Windows is the canonical environment for this failure.** Extending the retry helps all platforms with wake-vs-network races; no platform branching needed.
2. **22.5s of patience is enough.** Anecdotal Chrome wake-net diagnostics on Windows suggest typical reattach is 5–15s.
3. **The user's refresh token itself is valid.** Evidence points to the request never leaving the machine.
4. **Existing silent-refresh tests will need updates.** Migration to fake timers + attempt-count change to 5.
5. **The refresh-token shape migration is rare-edge-case safe.** Bare-string IDB entries continue to work via the legacy fallback in the reader.

## Approach

### Sequencing

One PR, three internally cohesive change-sets:

**Pre-A — Shared infrastructure (Pass 2 added)**

- **S1** — Extract `visibilityTracker` + `ensureVisibilityListener` + `getHiddenDurationMs` from `src/stores/syncStore.ts:117-145` into `src/utils/visibilityTracker.ts`. Export `getHiddenDurationMs(): number | null`. Update `syncStore.ts` import. No behavior change; one source of truth before two callers depend on it.
- **S2** — Extract the alert-context-builder logic from `syncStore.ts:1743-1752` into `buildSilentRefreshAlertContext()` in a new standalone module **`src/services/google/silentRefreshAlertContext.ts`** (Pass 3 moved this out of `googleAuth.ts` to keep auth concerns separate and avoid circular-import risk). The builder depends on `getLastSilentRefreshDiagnostics()` (from googleAuth) + `getHiddenDurationMs()` (from `src/utils/visibilityTracker.ts`) + `document.visibilityState`. Returns `Record<string, unknown>` with the six fields (the five existing + `refresh_token_age_ms` when present), defensively defaulted. Single call-site refactor in `syncStore.ts`, one new call site in `offlineQueue.ts`.

**Part A — Retry-backoff extension**

1. **A1** — `googleAuth.ts`: extend `RETRY_BACKOFF_MS` to `[1500, 3000, 6000, 12000]`. Update comment block (lines 803-806) to reflect new total patience window and rationale.
2. **A2** — `__tests__/googleAuth.test.ts` (Pass 4 — six tests must be updated, not one):

   Update **every** test in the file that queues transient throws against the retry path. Treat all of them as part of A2 — leftover-throw stubs silently fall through to the default `refreshAccessToken` factory mock which returns SUCCESS; a test that stubs 3 throws but lets the code attempt 5 will see attempts 4–5 succeed, silently inverting assertions.
   - **Line 491** — `does NOT retry when refresh token is permanently invalid` (1 throw, unaffected — leave as-is; preserves no-regression assertion).
   - **Line 516** — `returns null after retrying when transient failure persists`: migrate to `vi.useFakeTimers()`, change loop bound from 3 throws to 5, advance timers by 1500 + 3000 + 6000 + 12000 ms (use a shared constant if cleaner), assert `toHaveBeenCalledTimes(5)`.
   - **Line 547** — `fires onTokenPermanentlyExpired immediately on invalid_grant — but NOT on a single retry-exhausted transient failure`: migrate from real timers (10_000ms vitest timeout) to fake timers, bump 3 throws → 5.
   - **Line 592** — `escalates after N consecutive retry-exhausted failures`: already uses fake timers; bump 9 throws (3 × 3) → 15 throws (5 × 3); change `advanceTimersByTimeAsync(5000)` to `(22500)`.
   - **Line 649** — `resets the consecutive-failure counter on a successful refresh`: bump 3+3 → 5+5; change advances from 5000 → 22500.
   - **Line 700** — `getValidTokenSilent throws TokenExpiredError WITHOUT firing onTokenExpired on transient failure`: migrate from real timers to fake timers, bump 3 throws → 5.
   - **Line 1075** — escalation-persistence test: bump 3 throws → 5; change advance 5000 → 22500.
   - **New test**: cumulative backoff advances are exactly 1500 + 3000 + 6000 + 12000 ms — confirms the loop sleeps between attempts, not after the last one.
   - **New test**: `network`-classification triggers all 5 attempts.
   - **New test (Pass 3 §17)**: `MAX_ATTEMPTS <= 5` invariant — a static assertion that catches a future `RETRY_BACKOFF_MS` extension silently lifting the cap.

**Part B — Observability**

3. **B1** — `errorReporter.ts`: append `'refresh_token_age_ms'` to `ALLOWED_CONTEXT_KEYS`. One-line change.
4. **B2** — `fileHandleStore.ts`:
   - Define `export interface StoredRefreshToken { token: string; issuedAt: number | null }` (Pass 3: `number | null`, not `number`, to avoid the `0`-as-sentinel epoch trap per §18). Export so `googleAuth.ts` can import the type.
   - `storeGoogleRefreshToken(familyId, token, opts?: { issuedAt?: number | null })` (Pass 4: `number | null`, not just `number`). Semantics: `undefined` → default to `Date.now()`; explicit `null` → write `null` to IDB (caller is signaling "unknown age" — used by `migratePendingRefreshToken` forwarding a legacy bare-string entry). IDB write is the new object shape; localStorage write stays bare string.
   - `getGoogleRefreshToken(familyId)` returns `StoredRefreshToken | null`. Legacy bare-string IDB → `{ token, issuedAt: null }`. localStorage fallback → `{ token, issuedAt: null }`. Object IDB → as-is.
   - **Make IDB-read failures non-silent** (§11): `console.error` + `reportError(surface: 'refresh-token-idb-read')` then fall through to localStorage.
   - localStorage-read failure → `console.warn` only, return null (§12).
   - localStorage write/clear bare empty catches → `console.warn` (§13).
   - **Wrap `clearGoogleRefreshToken` IDB delete** (§14, Pass 3): `console.error` + `reportError(surface: 'refresh-token-idb-clear')`. localStorage clear stays best-effort with `console.warn`.
5. **B3** — `googleAuth.ts` (Pass 3: single-object refactor):
   - **Replace module-level `let refreshToken: string | null = null`** with `let currentRefreshToken: StoredRefreshToken | null = null` (import the type from `fileHandleStore.ts`).
   - Update **3 read sites** (lines 246, 362, 773) to consume `.token` from `currentRefreshToken` and to assign the full `StoredRefreshToken` object into `currentRefreshToken`. Every other `refreshToken` reference in the file (`if (!refreshToken)`, `refreshToken,` argument forwarding, etc. — roughly 12 sites) becomes `currentRefreshToken?.token` / `currentRefreshToken === null` checks.
   - Update **4 write sites** (lines 366 `migratePendingRefreshToken`, 579 silent-auth-code, 643 popup, 1407 redirect-PKCE) to call `storeGoogleRefreshToken(key, token)` with default `Date.now()` issuedAt — except `migratePendingRefreshToken` which **forwards `pending.issuedAt` literally** (Pass 4: pass `issuedAt: pending.issuedAt` whether it's a `number` or `null` — never coerce `null → Date.now()`, which would invent a fresh timestamp for a possibly-old token and mask the very revocation pattern §9 is meant to observe). Each write site also updates `currentRefreshToken = { token, issuedAt }` in-memory.
   - Update **2 in-memory clear sites** (Pass 4: there are 2, not 4 — the `invalid_grant` branch at line 858 and `clearTokenState` at line 1147; the latter is called from `revokeToken`, `clearGoogleSessionState`, and `requestAccessToken`'s `forceConsent` branch) to `currentRefreshToken = null`. Single assignment, no parallel-state coherence to track. The 4 storage-clear sites (`migratePendingRefreshToken`, `invalid_grant`, `revokeToken`, `clearGoogleSessionState`) still call `clearGoogleRefreshToken(familyId)` — that's IDB hygiene, separate from in-memory state.
   - Extend `SilentRefreshDiagnostics` interface (line 695) with optional `refreshTokenAgeMs: number | null`.
   - In the `invalid_grant` branch (line 853), compute `const ageMs = currentRefreshToken?.issuedAt != null ? Date.now() - currentRefreshToken.issuedAt : null` and include in diagnostics write at line 862. Computation happens BEFORE `currentRefreshToken = null` (order matters).
   - `buildSilentRefreshAlertContext` (in its own module per §16) reads `getLastSilentRefreshDiagnostics()?.refreshTokenAgeMs` directly — no separate getter for `currentRefreshToken` exported.
6. **B4** — `offlineQueue.ts`:
   - Extend `reportFlushFailure(reason, err)` to detect `err instanceof TokenExpiredError`. When true, call `buildSilentRefreshAlertContext()` and pass as `context` to `reportError`.
   - Import `TokenExpiredError` from `@/services/google/googleAuth` and `buildSilentRefreshAlertContext` from `@/services/google/silentRefreshAlertContext` (Pass 4: separate module per §16).
   - Detection MUST be `instanceof` — no string matching on `err.message`.
   - For non-`TokenExpiredError` failures, the `context` field is omitted entirely.
7. **B5** — `__tests__/offlineQueue.test.ts` (append):
   - **Extend the existing `vi.mock('@/services/google/googleAuth', ...)`** at lines 11–18 to additionally expose `TokenExpiredError` (today it only stubs `onTokenAcquired`). The moment `offlineQueue.ts` imports `TokenExpiredError`, every existing test in the file explodes at module-load time unless this mock is extended (Pass 4).
   - **Add a new `vi.mock('@/services/google/silentRefreshAlertContext', ...)`** stubbing `buildSilentRefreshAlertContext`.
   - New test: `flushQueue` rejecting with `new TokenExpiredError()` → `reportError` with `context.silent_refresh_*` populated.
   - New test: `flushQueue` rejecting with `new Error('Drive 404')` → `reportError` with NO `context.silent_refresh_*` fields.
8. **B6** — `__tests__/fileHandleStore.test.ts` (append, or create if absent — verify):
   - Migration: pre-seed IDB with bare string → reader returns `{ token, issuedAt: 0 }`.
   - Round-trip: `storeGoogleRefreshToken(fam, 'tok')` then read → `{ token: 'tok', issuedAt: <approx now> }`.
   - IDB-read failure: mock `db.get` to reject → `reportError(surface: 'refresh-token-idb-read')` and fallback to localStorage.
   - localStorage-read failure: stub `localStorage.getItem` to throw → `console.warn`, returns null, NO `reportError`.

### Files Affected

**Modified**:

- `src/services/google/googleAuth.ts`
- `src/services/google/__tests__/googleAuth.test.ts`
- `src/services/sync/offlineQueue.ts`
- `src/services/sync/fileHandleStore.ts`
- `src/services/sync/__tests__/offlineQueue.test.ts`
- `src/utils/errorReporter.ts`
- `src/stores/syncStore.ts` (consume from `src/utils/visibilityTracker.ts` + use `buildSilentRefreshAlertContext`)

**Created**:

- `src/utils/visibilityTracker.ts` (Pass 2 §S1 — shared visibility tracker)
- `src/services/google/silentRefreshAlertContext.ts` (Pass 3 §16 — extracted alert-context builder)

**Possibly created** (verify first):

- `src/services/sync/__tests__/fileHandleStore.test.ts` if it does not already exist
- `src/services/google/__tests__/silentRefreshAlertContext.test.ts` (unit test for the new builder module)

No mockups required. No new components, composables, modals, or dependencies. No infrastructure / Lambda changes.

### Reused helpers (already exist — must use, not duplicate)

- `getLastSilentRefreshDiagnostics()` — `src/services/google/googleAuth.ts:705`
- `TokenExpiredError` class — `src/services/google/googleAuth.ts:929` (`instanceof`, never string-match)
- `reportError` + redactContext allowlist — `src/utils/errorReporter.ts`
- Visibility tracker logic — extracted from `syncStore.ts:117-145` to `src/utils/visibilityTracker.ts` in S1
- `vi.useFakeTimers() / vi.advanceTimersByTimeAsync()` pattern — already used at `googleAuth.test.ts:621, 673, 1091`
- Cold-start escalation alert context shape at `syncStore.ts:1743-1752` — refactored to a shared builder in S2

### Silent-failure audit (all touched paths)

| Location                                        | Failure          | Treatment                                                                                                  |
| ----------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------- |
| `googleAuth.ts:773` IDB recovery read           | exception        | already `console.error` + `reportError` — unchanged                                                        |
| `fileHandleStore.ts:213` IDB read               | exception        | **NEW**: `console.error` + `reportError(surface: 'refresh-token-idb-read')` + fall through to localStorage |
| `fileHandleStore.ts:219` localStorage read      | exception        | **NEW**: `console.warn` + return null (no reportError — private-mode noise)                                |
| `fileHandleStore.ts:200` localStorage write     | exception        | `console.warn` (was bare empty catch)                                                                      |
| `fileHandleStore.ts:230` IDB clear              | exception        | **NEW (Pass 3)**: `console.error` + `reportError(surface: 'refresh-token-idb-clear')`                      |
| `fileHandleStore.ts:234` localStorage clear     | exception        | `console.warn` (was bare empty catch)                                                                      |
| `offlineQueue.ts:166` flush failure             | always handled   | `reportError` call — context now richer for `TokenExpiredError`                                            |
| Shape-mismatch on legacy IDB read               | not-an-exception | treat bare string as `{ token, issuedAt: 0 }` — documented                                                 |
| `redactContext` dropping `refresh_token_age_ms` | data loss        | `console.warn` already emitted; tests assert allowlist membership                                          |

## Acceptance Criteria

- [ ] `RETRY_BACKOFF_MS` is `[1500, 3000, 6000, 12000]` in `googleAuth.ts`.
- [ ] `MAX_ATTEMPTS` derives to 5.
- [ ] Unit test asserts `MAX_ATTEMPTS <= 5` so a future backoff-array extension cannot silently lift the cap (Pass 3 §17).
- [ ] Cumulative backoff window across all retries is exactly 22.5 seconds.
- [ ] Existing `googleAuth.test.ts` "3 attempts with stepped backoff" test migrated to fake timers and updated to expect 5; passes.
- [ ] New test: `network` classification triggers all 5 attempts before returning null.
- [ ] No regression: `invalid_grant` short-circuits after the first attempt.
- [ ] `src/utils/visibilityTracker.ts` exists and exports `getHiddenDurationMs(): number | null`. `syncStore.ts` imports from it; no behavior change to cold-start.
- [ ] `buildSilentRefreshAlertContext()` exported from `src/services/google/silentRefreshAlertContext.ts` and called from both `syncStore.ts` (cold-start path) and `offlineQueue.ts` (offline-queue-flush path). Identical block shape across surfaces.
- [ ] `googleAuth.ts` uses a single `currentRefreshToken: StoredRefreshToken | null` module-level variable (no parallel `tokenIssuedAt`). Both in-memory clear sites (`invalid_grant` branch at `:858` and `clearTokenState` at `:1147`) null the object atomically (Pass 3 §15, Pass 4 terminology fix).
- [ ] `storeGoogleRefreshToken` signature accepts `issuedAt?: number | null`. `undefined` → defaults to `Date.now()`. `null` → writes `null` to IDB (used by `migratePendingRefreshToken` forwarding legacy entries).
- [ ] `migratePendingRefreshToken` forwards `pending.issuedAt` literally (never coerces `null → Date.now()`).
- [ ] Every test in `googleAuth.test.ts` that stubs transient throws is updated for `MAX_ATTEMPTS = 5` (lines 516, 547, 592, 649, 700, 1075). Real-timer tests at 547 and 700 migrated to fake timers. No leftover-throw stubs that would let attempts 4–5 fall through to default-success.
- [ ] A `TokenExpiredError`-caused flush failure produces a Slack alert with all five silent-refresh context fields.
- [ ] Non-auth flush failures do NOT attach silent-refresh diagnostics — `context` is absent.
- [ ] Refresh tokens stored in IDB as `{ token, issuedAt }`. Legacy bare-string IDB and localStorage fallback both read as `{ token, issuedAt: null }` (Pass 3 §18 — `null` not `0` to avoid the 1970-epoch trap).
- [ ] `refresh_token_age_ms` appears in alert context when permanent failure fires with `issuedAt != null`; otherwise the key is `null` in the alert.
- [ ] `clearGoogleRefreshToken` IDB-delete failure produces `console.error` + `reportError(surface: 'refresh-token-idb-clear')`. localStorage-clear failure produces `console.warn`.
- [ ] `migratePendingRefreshToken` carries the pending entry's `issuedAt` forward (not reset).
- [ ] `getGoogleRefreshToken` IDB-read failure produces `console.error` + `reportError(surface: 'refresh-token-idb-read')`. localStorage-read failure produces `console.warn` only.
- [ ] `npm run type-check` passes.
- [ ] `npm run lint` passes.
- [ ] `npm test -- --run` passes (full unit suite).
- [ ] No E2E test changes required. E2E suite still passes in chromium.
- [ ] CHANGELOG.md updated under `2026-05-20`: fewer "Google session expired" interruptions after overnight tab sleep + cleaner operator visibility into wake-time auth failures.

## Testing Plan

### Unit (automated)

1. **Retry backoff timing** — `googleAuth.test.ts` (fake timers):
   - Mock `refreshAccessToken` reject `new Error('Failed to fetch')` 5×.
   - Call `attemptSilentRefresh()`; advance 1.5s/3s/6s/12s.
   - Assert called 5 times; final `null`; cumulative advance exactly 22500ms.
2. **No retry on permanent failure** — real timers, fast:
   - Mock reject `new Error('invalid_grant')`; assert called exactly 1 time; permanent callback fires.
3. **Refresh-token age captured on invalid_grant**:
   - Seed IDB with `{ token: 'rt', issuedAt: <now - 60000> }`.
   - Trigger silent refresh → `invalid_grant`.
   - Assert `getLastSilentRefreshDiagnostics()?.refreshTokenAgeMs ≈ 60000`.
   - Repeat with legacy bare-string seed → `refreshTokenAgeMs` is `null`.
4. **Diagnostic capture on offline-queue flush** — `offlineQueue.test.ts` append:
   - Mock `flushProvider.write` reject `new TokenExpiredError()`.
   - Mock `getLastSilentRefreshDiagnostics` to return populated diag.
   - Trigger flush via `visible`; assert `reportError` called with `context.silent_refresh_attempts` populated.
5. **No misleading diagnostics on non-auth flush failure**:
   - Mock `flushProvider.write` reject `new Error('Drive 404')`.
   - Trigger; assert `reportError` called WITHOUT `context.silent_refresh_*` fields.
6. **Refresh-token storage migration** — `fileHandleStore.test.ts`:
   - Pre-seed IDB bare string → reader returns `{ token: 'stored-string', issuedAt: 0 }`.
   - Store + read round-trip → `{ token: 'tok', issuedAt: <approx now> }`.
7. **IDB-read failure non-silent** — `fileHandleStore.test.ts`:
   - Mock `db.get` to throw; localStorage seeded with `'fallback-tok'`.
   - Assert `reportError(surface: 'refresh-token-idb-read')`.
   - Return value `{ token: 'fallback-tok', issuedAt: 0 }`.

### Manual (smoke)

8. **Local dev sanity**: `npm run dev`, sign in, normal save works.
9. **Simulate wake-race in DevTools** (high-confidence):
   - Sign in; override `expiresAt` via console to near-now.
   - DevTools → Network → "Offline" briefly then "Online".
   - Trigger save. Confirm retry logs `attempt 1/5`, `2/5`, etc., recovers without banner.
10. **Slack-alert payload smoke** (after deploy):
    - Watch `#beanies-errors` for post-deploy `offline-queue-flush` firing.
    - Confirm new context fields are present.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted full plan covering A1–A5 (retry-backoff extension) and B1–B5 (offline-queue-flush diagnostics + refresh-token age tracking). Reused all existing helpers (`getLastSilentRefreshDiagnostics`, `getHiddenDurationMs`, `TokenExpiredError`, `redactContext` allowlist). Explicitly excluded Lambda family_id logging on privacy + scope grounds. Included migration safety for the bare-string→object refresh-token storage change.
- **Pass 2 (DRY + error handling)**: Verified helper-existence claims against the codebase. Four substantive corrections: (a) `getHiddenDurationMs` is module-private — added S1 to extract to `src/utils/visibilityTracker.ts`; (b) cold-start alert-context block is duplicated by the proposed offline-queue change — added S2 to extract `buildSilentRefreshAlertContext` to `googleAuth.ts`; (c) existing googleAuth retry test uses real timers and will time out at 22.5s — fake-timer migration is now mandatory; (d) `offlineQueue.test.ts` already exists. Added Part C (silent-failure cleanup in `fileHandleStore`). Caught missed `migratePendingRefreshToken` write site. Specified localStorage stays bare-string to preserve emergency-escape-hatch role. Added silent-failure audit table.
- **Pass 3 (Sustainability)**: Found four substantive issues in how `issuedAt` metadata would thread through `googleAuth.ts`. Adopted the recommended single-object refactor (`currentRefreshToken: StoredRefreshToken | null`) to replace the loose-pair design, eliminating coherence obligations the compiler cannot enforce and naturally covering all 4 clear-sites (Pass 1 missed them). Added §14 to wrap `clearGoogleRefreshToken`'s IDB delete in the same non-silent treatment as the read path (preserves the audit-table consistency Part C established). Moved `buildSilentRefreshAlertContext` from `googleAuth.ts` to its own module `src/services/google/silentRefreshAlertContext.ts` to keep auth concerns separate and avoid circular-import risk as observability accretes. Added §17 making the "max 5 attempts" cap a testable invariant. Changed `issuedAt` sentinel from `0` to `null` (typed `number | null`) so any future non-alert use of `issuedAt` doesn't compute a 56-year age. Added acceptance criteria for the cap test, the single-object structure, the `null`-sentinel migration, and the new `refresh-token-idb-clear` reportError surface. Added the IDB-clear row to the silent-failure audit table.
- **Pass 4 (Fresh-eyes sweep)**: Found five precision issues — none requiring scope changes, all worth fixing before implementation. (1) Test-migration scope was under-specified: six tests in `googleAuth.test.ts` queue exactly-3-throws and would silently invert assertions when attempts 4–5 fall through to factory-default success; A2 now enumerates all six (lines 516/547/592/649/700/1075) plus the two real-timer→fake-timer migrations. (2) Internal-consistency fix: §B4 still imported `buildSilentRefreshAlertContext` from googleAuth even though Pass 3 moved it to its own module; corrected. Plus added an explicit note that `offlineQueue.test.ts`'s existing googleAuth mock must be extended to export `TokenExpiredError` or every test in the file explodes at module-load. (3) `clearGoogleRefreshToken` IDB-clear failure handling — now explicitly specified as **swallow-inside-the-function** (no rethrow) to preserve the `invalid_grant` diagnostics-write + permanent-callback path at `googleAuth.ts:862-867`. (4) `storeGoogleRefreshToken` signature changed from `issuedAt?: number` to `issuedAt?: number | null` so `migratePendingRefreshToken` can forward legacy `null` literally rather than have it coerce to `Date.now()` and mask the revocation patterns the feature is meant to surface. (5) Terminology fix: there are 2 in-memory clear sites (the `invalid_grant` branch and `clearTokenState`), not 4 — the "4" referred to storage-clear sites which are a separate concern.

## Prompt Log

> No GitHub issue created — direct implementation.

<details>
<summary>Full prompt history</summary>

### Initial Prompt (via `/error-review`, 2026-05-20)

> This morning, after using the app on my browser last night, in the morning I woke up to a "google session expired" toast, accompanied by the below error messages which fired to slack as soon as the tab became active.
>
> This bigger question here is not so much to resolve the errors, but to understand WHY google sessions expires and silent token refresh fails, especially given that I was just browsing the site without any issues the previous night. We've done an investigation into this several times, but can we understand the root cause of what causes google tokens to expire and silent refresh fail, requiring the user to go through the painful and friction inducing consent screen again? This is very important to reduce user friction and improve the user experience.
>
> The main question is, what are our options to improve the behavior of silent refresh and reduce this user friction? How can we improve our codebase, our monitoring, our error logging, or anything else that can help us zero in on the absolute root cause of this issue and fix it once and for all?
>
> [3 Slack alerts pasted: surface offline-queue-flush at 22:37:23 UTC, save-failure-banner at 22:37:27 UTC, offline-queue-flush at 22:57:06 UTC — all on Chrome 148 Windows 10 with provider_type: google_drive, save_failure_level: warning→critical, online: true]

### Follow-up — "let's check google cloud console first"

(Discussion of OAuth publishing-status check; resolved with greg confirming "In Production".)

### Follow-up — choosing next step

(`AskUserQuestion` answered: "I'll pull the Lambda logs".)

### Follow-up — Lambda logs

> Here is the result: [single CloudWatch row at 22:55:32.350 UTC, 2503ms duration, 147ms init duration]

### Follow-up — JSON-format Lambda result

> Or here it is in JSON format: [confirmed same single result]

### Final ask — `/beanies-plan`

> please prepare a plan to implement all proposed fixes for the above and review once more to ensure these are the correct and appropriate actions to take

</details>
