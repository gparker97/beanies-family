# Plan: Session-epoch guard for Google token acquisition (prevent post-sign-out zombie tokens)

> Date: 2026-06-14
> Related issues: Notion tracker #36 — No GitHub issue (direct implementation) · No feature gate (ship ungated)
> Plan file: `docs/plans/2026-06-14-session-epoch-guard-google-token.md`

## User Story

As a privacy-conscious user of a local-first app, I want any Google token that finishes being acquired _after_ I've signed out to be thrown away, so a "zombie" credential from a previous session can never leak into a cleared or next session.

## Context

`src/services/google/googleAuth.ts` holds the Google session as module-level mutable state (`accessToken`, `expiresAt`, `currentRefreshToken`, `currentFamilyId`, `cachedEmail`). Token acquisition is async (network round-trips) but the **commit** of a result to that state is a later synchronous write. Nothing today guards the gap: if the user signs out (which clears the state via `clearGoogleSessionState` / `revokeToken`) **while an acquisition is in flight**, the acquisition can still resolve afterward and write its token back into the just-cleared (or a brand-new) session — and fire `notifyTokenAcquired`, mirroring it into the beanpod via `driveTokenRecovery`.

Pre-existing concurrency class (the 2026-06-12 Drive token-persistence work did not introduce or worsen it); deferred as code-review item #6. Low frequency, but for a local-first/privacy app a credential surviving sign-out is privacy-adjacent and must not happen. Its own focused change — NOT bundled with item-#8 (shipped 2026-06-14, `7f306cba`).

### Verified acquisition + teardown seams (`googleAuth.ts`)

- **Teardown (clears session state):** `clearGoogleSessionState()` (`:1168`) and `revokeToken()` (`:1132`); both call internal `clearTokenState()` (`:1272`).
  - ⚠️ `clearTokenState()` is **also** called at `:487` and `:712` as _within-acquisition_ cleanup (not a user sign-out). So the epoch must bump at the **semantic teardown entry points** (`clearGoogleSessionState`, `revokeToken`), **not** inside `clearTokenState`.
- **Acquisition seams (await → commit token → `notifyTokenAcquired`) — the four commit blocks are materially different and stay inline:**
  1. `attemptSilentAuthCode` (hidden-iframe silent auth-code path, _called by_ `requestAccessToken` — NOT the silent-_refresh_ path) — writes `:646`/`:651`, persists the refresh token in a try/catch+logEvent block (`:653–667`), notifies `:675` (interactive=false). Snapshot the epoch at the top of `attemptSilentAuthCode`.
  2. `performPopupAuth` — writes `:719`/`:728`, persists (awaited, `reportError` on no-refresh-token at `:732`), notifies `:745` (interactive=true); returns `string`, throws on failure.
  3. `performSilentRefresh` (the refresh path) — writes `:937`/`:938`, **never persists a refresh token** (refresh doesn't rotate), notifies `:945` (interactive=false).
  4. `completeRedirectAuth` — writes `:1558`/`:1563`, persists (awaited, `reportError` at `:1570`), notifies `:1580` (interactive=true).
- **`primeRefreshToken(familyId, stored)`** (`:251`, body `:252–253`) — synchronous setter; sole external caller is `driveTokenRecovery.ts:148` inside `restoreLocalFromDoc` (reached by both `tryReconnectSilently` and `reconcileDriveTokenWithDoc`). The race lives at that caller boundary, and `restoreLocalFromDoc` does `storeGoogleRefreshToken` (local IDB write) **before** the prime.

## Requirements

1. A single **session-epoch counter** in `googleAuth.ts` (`let sessionEpoch = 0`), bumped exactly once per session teardown.
2. Bump `sessionEpoch` at the **start** of `clearGoogleSessionState()` and `revokeToken()` only (not in `clearTokenState()`).
3. Every in-module acquisition seam snapshots `sessionEpoch` at the start (before the first `await`) and, immediately before its existing commit block, **discards** if the snapshot no longer matches.
4. On discard: no module-state write; no `notifyTokenAcquired`; **best-effort revoke** the just-acquired access token; emit an observable `logEvent` (never a silent drop); return the seam's existing no-token result (`null`, or the existing benign path for `performPopupAuth`).
5. The **`primeRefreshToken`/`restoreLocalFromDoc` seam** is guarded so that on a stale epoch **neither** the local IDB store **nor** the prime runs (no zombie token persisted to disk).
6. **Redirect-reload durability:** a full page reload resets the in-memory epoch, so it cannot bridge the reload. The teardown entry points must also clear the redirect-intent sessionStorage keys (`REDIRECT_AUTH_KEY` + `REDIRECT_AUTH_CODE_KEY`) so an abandoned/signed-out redirect finds no intent on return and `completeRedirectAuth` no-ops.
7. **No happy-path regression:** a token for the still-current session commits exactly as today (no extra consent prompts, no discarded valid token).
8. Cross-account safety: sign-out → sign-in as a **different** account never carries account A's token into account B's session.

## Important Notes & Caveats

- **Bump points are load-bearing and exact** — only `clearGoogleSessionState` + `revokeToken`. Re-verify the full caller set of `clearTokenState` at implementation time.
- **Snapshot at the very top of each acquisition function, before any `await`;** the check is the last thing before the commit block. Note `notifyTokenAcquired` itself awaits userinfo — the discard must happen before it's reached.
- **`performSilentRefresh` never persists a refresh token** — do not add one. The four commit blocks stay byte-for-byte as today; only a guard line is inserted before each.
- **Redirect (Req 6):** the post-reload code exchange runs in a fresh module instance, so the in-memory epoch genuinely cannot guard it. Clearing `REDIRECT_AUTH_KEY`/`REDIRECT_AUTH_CODE_KEY` (try/catch — sessionStorage can throw in private mode) on teardown is the correct, simplest mechanism; the code is already single-use and completion already no-ops when those keys are absent (`:1535`).
- **No new store/CRDT/persisted field** for the in-memory epoch. Keep googleAuth's single-source-of-truth discipline.
- This is **auth correctness** — favor the simplest provably-uniform mechanism. A missed seam is the whole risk.

## Approach

**A. Epoch primitive (`googleAuth.ts`).** Add `let sessionEpoch = 0;`, `export function getSessionEpoch(): number { return sessionEpoch; }` (consumed by `driveTokenRecovery`), and the internal `isSessionStillCurrent` guard from B (this IS the read+compare helper — no separate one). Increment `sessionEpoch` as the **first** statement of `clearGoogleSessionState()` and `revokeToken()`.

**A2. Single-chokepoint backstop (detect a future un-guarded seam).** The per-seam "snapshot-at-top + guard-before-commit" pattern is the primary defense, but it is _opt-in per seam_: a 5th acquisition path added later without the guard would commit a zombie token silently. All four seams already funnel through `notifyTokenAcquired` (and ONLY those four call it — verified `:675/:745/:945/:1580`), which runs _after_ each commit. A correctly-guarded seam always returns before reaching it. So `notifyTokenAcquired` takes one extra `expectedEpoch: number` arg (the seam's `epochAtStart`); as its first statement, if `expectedEpoch !== sessionEpoch` it emits `logEvent({ level: 'error', surface: 'auth-epoch-leak', message: 'a Google token reached notifyTokenAcquired with a stale session epoch — a commit path is missing its guard' })`. Defense-in-depth assertion, not the primary guard. On a stale `expectedEpoch` it logs the `auth-epoch-leak` error and **returns immediately** — BEFORE `notifyTokenAcquired`'s own first side effects (`consecutiveSilentRefreshFailures = 0` / `persistFailureCounter(0)` at `:1256-1257`) and before any subscriber fires — so a leaked stale acquisition cannot reset the reconnect failure counter or notify subscribers. By design it should be unreachable; reaching it is the regression signal.

**B. Guard each in-module seam — extract only the genuinely-duplicated discard decision** (the four commit blocks differ in persist/error/return shape and must NOT be merged into one parameter-laden helper — that risks behavior drift):

```ts
// True if the session that started this acquisition is still current. On a stale
// epoch (a sign-out/teardown interleaved): best-effort revoke the just-issued
// access token (a live credential that must die with the session) and return
// false so the caller discards WITHOUT committing. logEvent (level:'info' — an
// EXPECTED discard) => observable, never silent. (The level:'error' auth-epoch-leak
// backstop in notifyTokenAcquired is the separate "a guard was MISSED" signal.)
function isSessionStillCurrent(epochAtStart: number, accessTokenToRevoke: string): boolean {
  if (epochAtStart === sessionEpoch) return true;
  fetch(`${GOOGLE_REVOKE_URL}?token=${accessTokenToRevoke}`, { method: 'POST' }).catch(() => {});
  logEvent({
    level: 'info',
    surface: 'auth-epoch-discard',
    message: 'discarded a Google token that resolved after sign-out (session epoch advanced)',
  });
  return false;
}
```

Each seam: `const epochAtStart = sessionEpoch;` as the first statement; then immediately before its existing commit block, `if (!isSessionStillCurrent(epochAtStart, tokens.access_token)) return null;` (or the seam's existing no-token return — `performPopupAuth` returns the existing benign path rather than `null`). The seam then passes `epochAtStart` into its existing `notifyTokenAcquired(token, interactive, epochAtStart)` call (the A2 backstop). The existing commit blocks (`:646–675`, `:719–745`, `:937–945`, `:1558–1580`) are otherwise NOT moved or rewritten → happy path provably unchanged (the backstop is a no-op when the epoch is current).

**C. `primeRefreshToken` / `restoreLocalFromDoc` seam.** `restoreLocalFromDoc` is the single boundary that performs BOTH the `storeGoogleRefreshToken` (local IDB) write and the `primeRefreshToken`. Guard it once, there: thread a required `expectedEpoch` through `restoreLocalFromDoc` and, if `expectedEpoch !== getSessionEpoch()`, skip both the store and the prime (and `logEvent` the discard). Do NOT add an epoch param to `primeRefreshToken` — leaving it a pure state setter keeps it single-purpose; its other in-module callers (`initializeAuth`, `migratePendingRefreshToken`) are synchronous and have no race. `tryReconnectSilently` captures `const epoch = getSessionEpoch();` _before_ its async `getGoogleRefreshToken`/`readDriveTokenFromDoc` reads and passes it to `restoreLocalFromDoc`. `reconcileDriveTokenWithDoc` (the other caller) snapshots and threads the epoch too, guarding only its `restoreLocalFromDoc` _adopt_ branch (`:181`); its `upsertDriveConnection` _mirror-up_ branch (`:183`) is intentionally left unguarded — it exports the already-persisted local token to the shared doc and never seeds this session's in-memory state, so it carries no zombie-token risk.

**D. Redirect-reload durability (Req 6).** Add a try/catch'd `sessionStorage.removeItem` of `REDIRECT_AUTH_KEY` + `REDIRECT_AUTH_CODE_KEY` to `clearGoogleSessionState`/`revokeToken`. No persisted cross-reload epoch needed.

**E. Tests.** Per seam: a teardown (`clearGoogleSessionState`, and a second test with `revokeToken`) interleaved between acquisition start and resolve → token discarded (no module write, no `notifyTokenAcquired`, revoke attempted, `logEvent` emitted), happy path committed, cross-account (sign-out→re-init as B → A's late resolve doesn't touch B). `driveTokenRecovery`: epoch advanced between snapshot and adopt → neither store nor prime runs. Redirect: intent keys cleared → `completeRedirectAuth` no-ops. **Backstop (A2):** a focused test that calls `notifyTokenAcquired` with a stale `expectedEpoch` asserts the `auth-epoch-leak` `level: 'error'` `logEvent` fires AND that the early return holds (subscribers not invoked, failure counter not reset to 0) — the test that fails if a future seam commits without the guard.

### DRY / reuse

One `isSessionStillCurrent` guard centralizes the only true duplication (discard+revoke); the four divergent commit blocks stay inline and unchanged. One `getSessionEpoch` accessor. Reuses the existing revoke pattern (`GOOGLE_REVOKE_URL`), `notifyTokenAcquired`, `logEvent`, and the redirect-intent sessionStorage state. No new store/composable/CRDT.

## Files Affected

- `src/services/google/googleAuth.ts` — epoch counter + `getSessionEpoch` + bumps in `clearGoogleSessionState`/`revokeToken` (+ clear the two redirect-intent keys there) + `isSessionStillCurrent` guard at the 4 seams + `notifyTokenAcquired` gains an `expectedEpoch` arg for the A2 leak backstop. `primeRefreshToken` left unchanged (modify)
- `src/services/google/driveTokenRecovery.ts` — `tryReconnectSilently` + `reconcileDriveTokenWithDoc` snapshot `getSessionEpoch()` before their async reads and thread the epoch through `restoreLocalFromDoc` so BOTH the IDB store and the prime are skipped on mismatch (modify)
- `src/services/google/__tests__/googleAuth*.test.ts` — mid-flight-teardown / cross-account / redirect-orphan / A2-backstop tests (modify/add)
- `src/services/google/__tests__/driveTokenRecovery.test.ts` — epoch-advanced no-op case (modify)

## Assumptions

> Review before implementation.

1. The four in-module acquisition seams above are the complete set that commit a token + notify (re-grep `accessToken =` / `currentRefreshToken =` / `notifyTokenAcquired(` at implementation).
2. `clearGoogleSessionState` + `revokeToken` are the only two semantic teardown entry points; the `:487`/`:712` `clearTokenState()` calls are within-acquisition cleanup.
3. `driveTokenRecovery.tryReconnectSilently` (via `restoreLocalFromDoc`) is the relevant race for `primeRefreshToken`.
4. Discarding via the existing no-token result is safe for all callers (they treat null/failed as "stay signed-out / reconnect").
5. Clearing `REDIRECT_AUTH_KEY`/`REDIRECT_AUTH_CODE_KEY` on teardown has no legitimate-flow regression — VERIFIED: `startRedirectAuth` sets the key then navigates the whole page to Google (web: `window.location.href`; native: system browser via `Browser.open`), so no app JS — and therefore no teardown — runs until return; on return the keys are consumed synchronously (web: App-init Step 2b `completeRedirectAuth`; native: the `appUrlOpen` handler, which snapshots `REDIRECT_AUTH_KEY` into a local at `:1635` before any internal `clearGoogleSessionState` branch). There is no window in which a legitimately-pending redirect's keys are observable to a sign-out.

## Acceptance Criteria

- [ ] A token resolving after sign-out is discarded (not primed/stored) with a best-effort revoke, a `logEvent`, and no `notifyTokenAcquired`.
- [ ] All four in-module paths + the `primeRefreshToken`/`restoreLocalFromDoc` seam honor the guard; the IDB store is skipped too on mismatch.
- [ ] Happy path unaffected: current-session token commits exactly as today, no added consent prompts.
- [ ] Sign-out → sign-in-as-a-different-account never carries the prior token across.
- [ ] Redirect-return with cleared intent does not commit a token.
- [ ] Unit tests cover each seam's mid-flight sign-out, the redirect case, the cross-account case, and the A2 backstop. `npm run validate` green.

## Testing Plan

1. **Unit (primary):** mock the token endpoint to resolve after a controllable delay; start each acquisition; call `clearGoogleSessionState()` (and `revokeToken()`) before resolve; assert no state write, subscriber not called, revoke attempted, `logEvent` emitted, no-token result. Mirror happy path + cross-account.
2. **`driveTokenRecovery`:** epoch advances between snapshot and adopt → neither `storeGoogleRefreshToken` nor `primeRefreshToken` runs.
3. **Redirect:** intent keys cleared → `completeRedirectAuth` returns null, no commit.
4. **A2 backstop:** `notifyTokenAcquired` with a stale `expectedEpoch` → `auth-epoch-leak` error logged, early return (no subscriber fire, no counter reset).
5. `npm run validate` (typecheck + lint + new tests). Optional manual smoke: connect-Drive + sign-out/sign-in with no extra consent screens.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted from a read of `googleAuth.ts` — exact teardown vs. within-acquisition `clearTokenState` callers, the four commit-and-notify seams, the cross-module `primeRefreshToken` seam; proposed `sessionEpoch` + a discard guard, redirect durability via existing intent state.
- **Pass 2 (DRY + error handling)**: Replaced the single `commitAcquiredToken` helper (would force four divergent commit blocks into a parameter-laden hydra; contained free-variable/`scheduleRefresh` bugs) with a minimal `isSessionStillCurrent` guard centralizing only the discard+revoke, emitting a `logEvent` so a discard is observable not silent; extended the guard to wrap the whole `restoreLocalFromDoc` (store + prime) so no zombie token is persisted to IDB; made Req 6 real by clearing the redirect-intent sessionStorage keys in the two teardown points; fixed the seam-1 mislabel (`attemptSilentAuthCode`).
- **Pass 3 (Sustainability)**: Added a single-chokepoint `auth-epoch-leak` (`level: 'error'`) backstop in `notifyTokenAcquired` so a future commit path that skips its guard becomes an observable, test-assertable regression rather than a silent leak; collapsed the cross-module guard to the single `restoreLocalFromDoc` boundary (dropped the redundant `primeRefreshToken` epoch param); split discard severity (`info` expected vs `error` missed-guard). Verified `logEvent` signature.
- **Pass 4 (Fresh-eyes sweep)**: Verified seam line-numbers, the `clearTokenState` caller split, and `notifyTokenAcquired` exclusivity; confirmed + promoted Assumption 5 to a verified statement. Closed one real gap: the A2 backstop must `return` on a stale epoch BEFORE `notifyTokenAcquired`'s leading failure-counter reset / subscriber fan-out (test asserts no side effects). Clarified `reconcileDriveTokenWithDoc`'s mirror-up branch is intentionally unguarded. Implementation-ready.

## Prompt Log

> **No GitHub issue created.** Approved for direct implementation (Notion tracker #36; pre-plan intake written back to the row's `beanies-plan prompt`).

<details>
<summary>Full prompt history</summary>

### Initial Prompt (assembled by /beanies-pre-plan from Notion #36, verbatim)

```
Title:    Session-epoch guard for Google token acquisition (prevent post-sign-out zombie tokens)
Type:     bug   Priority: high   Surfaces: All / settings, overall
Objective: Close a pre-existing concurrency race in googleAuth.ts — a token acquisition in flight
           when the user signs out can resolve AFTER sign-out cleared session state, writing a
           'zombie' token into a just-cleared (or next) session. Privacy-adjacent for a local-first app.
Scope:    Single session-epoch counter — snapshot at the START of every acquisition path; bump on
           sign-out/teardown; discard a resolved token if the epoch no longer matches. Uniform across
           popup, redirect-return, primeRefreshToken.
Edge:     popup grant / redirect round-trip (epoch must survive a page reload → durable check) /
           primeRefreshToken; sign-out→sign-in-as-different-account; no happy-path regression.
Reuse:    googleAuth.ts (+ clearGoogleSessionState bump); driveTokenRecovery.ts + syncStore; no new store/CRDT.
Notes:    Focused change, NOT bundled with item-#8 (shipped, 7f306cba).
GitHub issue: SKIP.  Feature gate: NO.
```

### Approval

> kick off /beanies-plan → (4-pass plan presented via ExitPlanMode) → approved.

</details>
