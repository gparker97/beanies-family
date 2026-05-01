# Plan: Silent Google Drive token-refresh reliability — stop nagging the user when we shouldn't

> Date: 2026-05-01
> Related issue: user-reported reconnect-toast frequency (Greg, 2026-05-01) — reconnect prompt fires after multi-hour inactivity AND immediately after the "get fresh beans" SW reload, when silent recovery is structurally possible.

## Context

The Google Drive reconnect toast (`showGoogleReconnect`) is firing far more often than it should. Greg reports three incidents on 2026-05-01: twice after multi-hour inactivity, and once immediately after tapping "get fresh beans" + reloading. Every reconnect succeeded via the manual flow, which proves the refresh token in IndexedDB is valid — the system just isn't doing the silent refresh it should be capable of doing.

A three-track audit (`expiryCallbacks` trigger chain, refresh-token persistence/restore, Drive-sync auth + 401 handling) found **five contributing issues**, all in the auth layer. None require new infrastructure — they're surgical changes to `googleAuth.ts`, `silentReconnect.ts`, `syncStore.ts`, and a minor adjustment in `googleDriveProvider.ts`. The intended outcome: the toast appears **only** when silent recovery is structurally impossible (e.g. `invalid_grant` — refresh token revoked at Google), not on transient network blips, tab-wake, or page reload.

## Five contributing causes (from the audit)

### 1. The toast fires _inside_ `getValidTokenSilent`, before any caller can react

`src/services/google/googleAuth.ts:473–491` — when silent refresh returns null, the function calls `expiryCallbacks.forEach(cb => cb())` (which flips `showGoogleReconnect = true`) **before** throwing `TokenExpiredError`. So even when callers like `googleDriveProvider.read/write` would do a sensible 401-recovery (which they do, at `googleDriveProvider.ts:93–103, 154–164`), the toast is already up. Worse: `getValidTokenSilent` does not distinguish _transient_ (network blip, brief 5xx, mid-SW activation) from _permanent_ (`invalid_grant`) failures — both flip the banner.

This is the single biggest contributor. Every other cause flows downhill from it.

### 2. No proactive refresh on tab-wake or page mount

The auto-refresh `setTimeout` (`scheduleAutoRefresh`, `googleAuth.ts:727–748`) is module-level state. It dies on full page reload (the "get fresh beans" path is `window.location.reload()`), and modern browsers throttle it during multi-hour tab backgrounding so the 5-min-pre-expiry assumption breaks. There is **no `visibilitychange` listener** in `googleAuth.ts` that re-validates the token on tab-focus or page-mount. `useStaleTabRefresh` has one but it only fires after ≥5 min absence and runs the wake refresh in parallel with a Drive poll — so the poll fires the toast _while_ the wake handler is still trying to refresh.

### 3. The banner doesn't auto-clear when a _later_ silent refresh succeeds

`src/utils/silentReconnect.ts:25–42` — `attemptSilentReconnect()` only calls `handleGoogleReconnected()` (which clears the banner) if `hadVisibleError` was true at the moment it ran. There's an obvious timing gap: poll #1 fires the toast, poll #2 a few seconds later succeeds silently → toast stays up forever because nothing in the success path clears it. Banner state is fundamentally not self-healing.

### 4. Single-attempt wake refresh

`attemptSilentReconnect` calls `attemptSilentRefresh` exactly once. The underlying `performSilentRefresh` _does_ retry transient failures up to 2× with a 1.5s sleep (`googleAuth.ts:353–405`), so this is partially mitigated. But on bad cell signal the third attempt is often what works.

### 5. (Already-correct) `invalid_grant` short-circuit

`performSilentRefresh:378–391` already short-circuits permanent failures. **Keep this**; it's the only legitimate reason to surface the banner. Our work just makes sure other paths _don't_ surface it incorrectly.

## Reuse / DRY audit (done before designing the fix)

- **`acquiredCallbacks` registry already exists** at `googleAuth.ts:60` (`onTokenAcquired`). Used today by the account-assertion subsystem. We can subscribe `clearGoogleReconnect` to it — no new event channel needed.
- **`expiryCallbacks` registry already exists** — but it's currently overloaded for two semantically different events: "scheduled timer fired and refresh failed" (legitimate) and "on-demand silent token failed" (often transient). The fix narrows what fires it, doesn't replace it.
- **`isReconnecting` flag in `silentReconnect.ts:24`** already coalesces concurrent reconnect attempts — reuse it for the visibility-change listener.
- **`performSilentRefresh` retry loop** already exists with `MAX_ATTEMPTS` and exponential-ish sleeps — extending the budget is a one-line change, not a new mechanism.
- **`syncStore.handleGoogleReconnected`** already exists for the manual path — reuse it for auto-clear on `onTokenAcquired`.
- **`useStaleTabRefresh`** already has the visibility-change plumbing — but its job is broader (recurring items, rate refresh, Drive poll). The new auth-layer listener is a different concern at a different layer (auth, not stale-tab); keep them separate but make them not fight each other (see §2 below).

No new modules, no new state machines, no new banners. Every change is a refinement of existing infrastructure.

## Approach (single PR, five surgical changes)

### 1. Decouple the toast from the silent-token getter (root-cause fix)

`src/services/google/googleAuth.ts:473–491` — remove the `expiryCallbacks.forEach(...)` block from `getValidTokenSilent`. The function should do one thing: try silent, return token or throw. Callers decide whether and when to surface the banner.

```ts
export async function getValidTokenSilent(): Promise<string> {
  if (isTokenValid()) return accessToken!;
  const silentToken = await attemptSilentRefresh();
  if (silentToken) return silentToken;
  throw new TokenExpiredError();
}
```

The expiry callbacks still fire from the **scheduled timer** (`scheduleAutoRefresh:735–745`) — that path is the legitimate "we tried in the background and the refresh failed at the right pre-expiry moment" signal. Keep it. We're only removing the spurious caller-side fire.

### 2. Surface the banner only when refresh is _permanently_ unrecoverable

`performSilentRefresh:376–391` already detects `invalid_grant` and clears the refresh token — that's the permanent-failure signal. Add a **second** callback registry — `permanentFailureCallbacks` — that fires only on this path. Subscribe `showGoogleReconnect.value = true` there, instead of the existing `expiryCallbacks` subscription.

```ts
// googleAuth.ts — new registry
const permanentFailureCallbacks: Array<() => void> = [];
export function onTokenPermanentlyExpired(cb: () => void): () => void { ... }

// inside performSilentRefresh, when invalid_grant detected:
if (isPermanent) {
  refreshToken = null;
  if (currentFamilyId) await clearGoogleRefreshToken(currentFamilyId);
  permanentFailureCallbacks.forEach((cb) => { try { cb(); } catch {} });
  return null;
}
```

The scheduled-timer path also fires `expiryCallbacks` after a final failure — we leave that wired to the banner _only as a fallback_ via the same permanent-failure path. (Concretely: scheduled-timer's catch fires `permanentFailureCallbacks` only when its own retry budget is exhausted AND the cause was permanent. Transient failures stay silent — we'll re-attempt on the next visibility change.)

`syncStore.setupTokenExpiryHandler:1650–1657` becomes `setupTokenPermanentExpiryHandler` and subscribes to `onTokenPermanentlyExpired`. **Net effect:** the only path to the banner is "Google has revoked or invalidated our refresh token" — exactly the case where the user _must_ re-auth.

### 3. Add a `visibilitychange` + page-mount listener in `googleAuth.ts`

A small auth-layer wake handler — runs **before** any sync code — that proactively refreshes if the access token is expired or expires within ~2 minutes. Idempotent, coalesced via the existing `pendingSilentRefresh` deduplication.

```ts
// googleAuth.ts
function installAuthWakeListener(): void {
  if (typeof window === 'undefined') return;
  const refreshIfStale = () => {
    if (document.hidden) return;
    if (!refreshToken) return;
    const expiringWithinTwoMin = Date.now() + 120_000 >= expiresAt;
    if (!expiringWithinTwoMin) return;
    attemptSilentRefresh().catch(() => {}); // dedup'd; no-op on success path collision
  };
  window.addEventListener('visibilitychange', refreshIfStale);
  // Also fire once on install — covers full reload / SW update path
  refreshIfStale();
}
```

Called once from `initializeAuth` (which is already awaited during `syncStore.initialize`), so the listener exists for the whole session lifetime. **This is the load-bearing fix for the "hours of inactivity" symptom**: the next time the user looks at the tab, the token is refreshed _before_ the file-poll loop or any user action triggers a Drive call.

For the "get fresh beans" reload path: the same `refreshIfStale()` runs on `installAuthWakeListener` invocation (once at boot) — so by the time `backgroundSyncFromFile` actually awaits a Drive read, the token is fresh.

### 4. Auto-clear the banner on any successful silent refresh (self-healing)

`src/stores/syncStore.ts` — subscribe `handleGoogleReconnected` to `onTokenAcquired` (which already fires after every successful acquisition: popup, silent, redirect):

```ts
// inside setupTokenExpiryHandler, alongside the existing onTokenExpired wiring
tokenAcquiredUnsub = onTokenAcquired((_email, _token, _interactive) => {
  if (showGoogleReconnect.value) {
    handleGoogleReconnected().catch(() => {});
  }
});
```

This makes the banner self-healing. If somehow the banner _does_ go up (transient race we didn't catch), the very next successful silent refresh clears it without user intervention. **Combined with §1+§3, this is the safety net.**

### 5. Bump `performSilentRefresh` retry budget 2 → 3 with stepped backoff

`googleAuth.ts:353` — change `MAX_ATTEMPTS = 2` to `3`, and the existing 1.5s sleep to a stepped backoff `[1500, 3000]`. Three attempts catches the typical mobile-network blip; 3rd-attempt success is common per general retry literature. Trivial change, contained inside the existing retry loop.

`silentReconnect.ts:25–42` — no change needed; it calls `attemptSilentRefresh` which routes through `performSilentRefresh`'s improved retry. The wake-time path inherits the budget bump for free.

## What this does NOT change

- The manual reconnect flow (`useGoogleReconnect`) — unchanged. User-tapped reconnect still works exactly as today.
- The popup OAuth path (`requestAccessToken` / `performPopupAuth`) — unchanged.
- The redirect OAuth path (`startRedirectAuth` / `completeRedirectAuth`) — unchanged.
- The picker, the join flow, the file-decrypt flow — unchanged.
- The save-failure banner (separate signal, separate state) — unchanged.
- Refresh-token storage in IndexedDB + localStorage fallback — unchanged.

## Files affected

- `src/services/google/googleAuth.ts` — remove premature callback fire from `getValidTokenSilent`; add `permanentFailureCallbacks` registry + `onTokenPermanentlyExpired`; add `installAuthWakeListener` + visibility handler called from `initializeAuth`; bump `MAX_ATTEMPTS` 2 → 3 with stepped backoff
- `src/stores/syncStore.ts` — `setupTokenExpiryHandler` subscribes to the new permanent-failure event instead of the broad expiry event; subscribe `handleGoogleReconnected` to `onTokenAcquired` for self-healing
- `src/utils/silentReconnect.ts` — no logic change required; verify the existing `hadVisibleError` check still works with the auto-clear hook (it should — both paths call `handleGoogleReconnected`, no double-fire because of `isReconnecting` guard)
- `src/services/sync/providers/googleDriveProvider.ts` — minor: the existing 401-recovery (`getValidTokenSilent` → `attemptSilentRefresh` → retry once) is unchanged, but verify the catch flow still throws cleanly without the in-getter callback firing
- `src/services/google/__tests__/googleAuth.test.ts` (if exists) — add test coverage for the new behavior; if not, add a dedicated test file
- `src/stores/__tests__/syncStore.test.ts` (if relevant) — verify banner subscription/auto-clear behavior

## Verification

1. **Unit tests** — for each of the five changes:
   - `getValidTokenSilent` no longer fires `expiryCallbacks` on a transient silent-refresh failure (mock `performSilentRefresh` to return null with non-`invalid_grant` cause)
   - `permanentFailureCallbacks` fires when `performSilentRefresh` detects `invalid_grant` AND only then
   - `installAuthWakeListener` calls `attemptSilentRefresh` on `visibilitychange` when `expiresAt` is within 2 min
   - `onTokenAcquired` subscriber clears `showGoogleReconnect` when banner was up
   - `MAX_ATTEMPTS = 3` with backoff sequence `[1500, 3000]` is hit on repeated transient failure
2. **Synthetic repro of the user's three incidents:**
   - **(a) Multi-hour inactivity**: in DevTools, advance `expiresAt` to a value in the past, simulate `visibilitychange`, confirm token refreshes silently and the banner does NOT appear.
   - **(b) Get-fresh-beans reload**: with a valid refresh token in IndexedDB, hard-reload the app, confirm the boot path completes without flipping `showGoogleReconnect`. Watch the network tab for the silent refresh request before any Drive read.
   - **(c) Drive 401 mid-session**: stub a 401 response from `driveService.readFile`, confirm `googleDriveProvider.read`'s existing `attemptSilentRefresh + retry` succeeds and the banner does NOT flicker.
3. **`invalid_grant` regression test**: simulate Google revoking the refresh token (return `invalid_grant` from the proxy), confirm the banner DOES appear (it should — this is the only legitimate trigger).
4. **Type check + i18n + full vitest** — `npm run type-check`, `npm run translate`, `npx vitest run`.
5. **Manual cross-device check**: leave a real session idle for 3+ hours, return to the tab. No banner should appear. Repeat after a "get fresh beans" reload. No banner should appear.
6. **Slack monitoring (post-deploy)**: track `#beanies-errors` for any new auth-related reports for 48h. The expected reduction in user-visible reconnect prompts should also reduce the share of join-flow Slack alerts that mention "reconnect" / token state.

## Out of scope (called out so reviewers know we considered them)

- **Persisting the auto-refresh `setTimeout` across reloads** (e.g. via sessionStorage) — considered, but the visibility-change + page-mount listener (§3) is a strictly simpler primitive that achieves the same outcome without persisted timer state. Kept the timer for what it's good at (5-min-pre-expiry while tab is alive).
- **Encrypting the refresh token in IndexedDB/localStorage** — known-acknowledged surface; not the cause of the reported symptom; should be its own ADR/PR if pursued.
- **Photo-store popup risk** (audit flagged a few `requestAccessToken` calls in `photoStore.ts` from background retry paths) — orthogonal to the reconnect-toast symptom, and `photoStore.ts:635` already has `.catch(() => null)` defense. Separate cleanup if it ever bites.
- **Coalescing high-frequency `getValidTokenSilent` calls during rapid polling** — `pendingSilentRefresh` already coalesces at the silent-refresh layer, which is what actually matters. The outer polling layer is a no-op when the token is valid (`isTokenValid()` early return).
- **Service-worker update preserving IndexedDB explicitly** — IndexedDB is not cleared by Workbox SW updates in our config (verified: no `cleanupOutdatedCaches` touches IDB; the `beanies-file-handles` DB is independent of the SW cache). The fallback localStorage write in `storeGoogleRefreshToken` is belt-and-suspenders that's already in place.
