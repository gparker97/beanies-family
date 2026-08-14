# Plan: Reset the previous Google account's token state on a different-account sign-in (tracker #62 follow-up)

> Date: 2026-08-14
> Related issues: Tracker #62 (Google token churn) — the account-switch leak. None on GitHub — direct implementation.
> Plan file: `docs/plans/2026-08-14-account-switch-token-reset.md`

## User Story

As a beanies.family user who logs out of one Google account and signs in with a **different** one (sequentially — logged out in between), I want the app to fully reset the previous account's token state, so that the new session is clean and I don't get account-drift 404s, "wrong account" reconnect prompts, or an hourly "Google session expired" caused by stale artifacts from the account I left.

## Context

A **genuine logout → login-as-a-different-account is normal, supported behavior** — rare, but any user can do it. Today it leaves stale token artifacts from the previous account that cross into the next session. greg reproduced it (sign out of gregsophia → sign into beanies.demo on a different file → sign out → sign back into gregsophia) and it produced a recurring, ~hourly reconnect loop.

### Root cause (CloudWatch + code audit, 2026-08-14)

**1. Trusted-device sign-out preserves the previous account's grant, un-revoked.** `authStore.signOut()` (`authStore.ts:1280`) passes `preserveRefreshToken: trusted` where `trusted = useSettingsStore().isTrustedDevice` (`:1303`). On a trusted (personal) device — greg's daily device — a normal log out **keeps the active family's refresh token in IndexedDB and skips the network revoke** (`clearGoogleSessionState:1498` gates the revoke on `!preserveRefreshToken`), betting the next sign-in is the _same_ account (for a silent reconnect). There is **no path that resets the preserved token when the next sign-in is a different account on a trusted device.**

**2. No account-change teardown exists at sign-in.** A grep for `lastAccount`/`previousAccount`/`accountChanged` finds nothing. The only `isTrustedDevice` reference is the sign-out preservation. Nothing on the sign-in side notices "the account signing in differs from the one whose token I preserved."

**3. The revoke-before-mint misses this case.** New-sign-in forced consent revokes `getGoogleRefreshToken(currentFamilyId ?? PENDING_FAMILY_KEY)` (`performPopupAuth:897-899`, and the redirect arm). But `clearGoogleSessionState` nulls `currentFamilyId` on sign-out (`:1485`) and the new family isn't bound until later, so at that moment `currentFamilyId === null` → the revoke targets the already-cleared `PENDING_FAMILY_KEY` (a no-op). The previous account's family-keyed token survives.

**4. The `.beanpod` `driveConnections` mirror is never cleared on sign-out.** `clearDriveConnectionForAccount` (`driveTokenRecovery.ts:310`) is called **only** from `googleDriveProvider.disconnect()` (`googleDriveProvider.ts:369`), never from either sign-out path.

**Net stale artifacts after a trusted-device logout when the next login is a different account:** the previous account's IndexedDB refresh token (under its family key), its OAuth grant still **live at Google**, its `.beanpod` mirror entry, and the provider config's stale `driveAccountEmail` binding.

### Evidence it's a real bug, not a test artifact

CloudWatch (family `ae92950b` = gregsophia/Parker Meng, prod, 24h): only **14 mints** (rules out the 100-token cap); repeated `silent-refresh:revoked` + `silent_refresh_had_refresh_token=false` + `auth-init: startup: no refresh token under family or pending key`; `drive-account-mismatch-blocked` (a real Drive 404 + account mismatch); calendar `Token has been expired or revoked`. Only greg's two test accounts affected (0 real-user families) — precisely because normal users seldom switch Google accounts, but the mechanism is general. The account-binding heal + benign-mismatch work shipped this morning (0.9.10R2) are working correctly in the logs — this bug is **upstream** of them.

### The right place to fix it

The single transport-agnostic choke point is **`initializeAuth(familyId)` (`googleAuth.ts:472`)**, the family-bind step every sign-in transport (desktop popup, iOS/PWA redirect, native) funnels through after the token is acquired — called from `syncStore.initialize` (`:541`, cold boot), `loadExistingFile` (`:1177`) and `decryptPendingFileWithKey` (`:1840`). On the Drive-load path the new account's verified email is already fetched and **awaited** (`syncStore.ts:3104`) before adoption, so `ensureVerifiedGoogleAccountEmail()` resolves it from cache at `initializeAuth`. Because sign-out cannot know the _next_ account, the reset must live at **sign-in**, not sign-out.

The concern with hooking `initializeAuth` is that it is load-bearing: it runs on **every** cold boot, every file load, and every reconnect. The design therefore keeps the _hot path_ cheap — the detection is a synchronous localStorage read plus a `ensureVerifiedGoogleAccountEmail()` that issues **no network call on cold boot** (see caveats) — and pushes the only expensive/failure-prone work (the departed account's network revoke) **off** the awaited bind path (see Approach §3).

## Requirements

1. **Different-account sign-in fully resets the previous account.** When a sign-in authenticates a Google account that differs from the previously-authenticated account (and under a _different_ family), the app must reset the previous account's artifacts: **revoke** the previous account's grant, **clear** its stored IndexedDB refresh token, and **reset** its stale provider-config `driveAccountEmail` binding. This reset is best-effort and runs off the new session's critical path (it targets only the _departed_ account).
2. **Same-account re-login is untouched.** A trusted-device user signing back in with the _same_ account still gets the silent-reconnect preservation — no revoke, no teardown. Detection keys on an actual account **change** (verified email vs a durable record) **and** a family-id change.
3. **A durable "last authenticated Google account" breadcrumb.** Because `currentFamilyId` is nulled on sign-out (`clearGoogleSessionState:1485`), persist the last account identity (email + the family id its token is stored under) so a later sign-in can detect a change and know what to tear down. This is a **non-authoritative hint**, not a source of truth (Req 8): the token stores stay authoritative and every teardown op no-ops when its keyed data is already gone. Written at the bind step when a verified email is known; read at the same step on the next sign-in.
4. **Full sign-out clears the mirror too.** On a genuine full (non-preserve) sign-out (`signOutAndClearData`, and the untrusted `signOut`), also remove the account's `.beanpod` `driveConnections` mirror entry via the existing `clearDriveConnectionForAccount` — today it survives.
5. **Preserve every #62 guarantee + the unified-reconnect work.** Revoke-before-mint on reconnect, the account-binding heal (`getVerifiedGoogleAccountEmail`), the unified reconnect, and the trusted-device same-account silent reconnect must all keep working. Token count must not increase.
6. **Works across all three transports.** Popup, iOS/PWA redirect, and native all converge on `initializeAuth` — no per-transport duplication.
7. **No silent failures, and no new failure surface on the hot path.** Every teardown step (revoke, clear token, reset binding) is best-effort and independently guarded; a failure of one must not block the others, must not block sign-in, and each failure is logged with enough context to triage from CloudWatch. Because the teardown runs detached from the awaited bind, a slow or failed departed-account network revoke can never add latency to, or fail, the new sign-in.
8. **Data safety.** The `prev.familyId !== familyId` guard means teardown can only ever touch a _different_ family's token slot — never the token just bound. Every teardown op is keyed on `prev.familyId` and no-ops when nothing is stored there, so a stale/corrupt/deleted-family breadcrumb can never destroy live data. The mirror clear (full sign-out only) is a **targeted per-account removal** (`clearDriveConnectionForAccount` → `removeDriveConnectionByAccount`), never a broad wipe, and `matchesBoundAccount` gates recovery so a still-valid _other_-account entry is never adopted.

## Important Notes & Caveats

- **Detection email source is `ensureVerifiedGoogleAccountEmail()` (`googleAuth.ts:1878`), not `getVerifiedGoogleAccountEmail()`.** The former returns the cached verified email when present, else fetches userinfo against the **in-memory `accessToken`**, else returns null. This is exactly right:
  - **Cold-boot resume** — `initializeAuth` at `syncStore.ts:541` runs before any token exchange, so `accessToken` is null → returns null → detection no-ops (a cold boot is not an account change). **No network call on the cold-boot hot path.**
  - **Load/adoption path** — the email was already awaited at `syncStore.ts:3104`, so it resolves from cache with no fetch.
  - **Create / connect path** — the email may not be cache-verified yet when `initializeAuth` runs (the popup's `notifyTokenAcquired` verify is fire-and-forget), but a live `accessToken` exists, so `ensureVerifiedGoogleAccountEmail()` performs the one bounded userinfo fetch and resolves it — so the breadcrumb is reliably written even on the very first connect. This path is inherently interactive (the user just consented in a popup), so the single userinfo round-trip is not a perceptible hot-path cost. `getVerifiedGoogleAccountEmail()` alone would leave that gap.
  - It is verified against the _current_ in-memory access token, which is the new account's — never a primed guess (`setGoogleAccountEmail` nulls `cachedEmailToken`), so it can't tear down the wrong account.
- **The departed-account teardown does not block sign-in.** It is dispatched (not awaited) from `reconcileDepartedAccount` because it operates entirely on the _old_ account and every step is offline-durable/idempotent: `revokeGrant` uses `keepalive` and never throws; `clearGoogleRefreshToken`/`clearProviderConfig` swallow-and-report. Awaiting it would put an old-account network revoke on `initializeAuth`, which every cold boot and every load awaits — pure latency and a new failure surface for the _new_ session, for no correctness gain. The **breadcrumb write is synchronous** and always happens, so detection on the _next_ sign-in never depends on the teardown having finished.
- **`currentFamilyId` is `null` at the different-account sign-in.** Do NOT identify the old family/token from `currentFamilyId` post-sign-out — it's gone. The old family id + email come from the durable breadcrumb (Req 3).
- **The breadcrumb is a hint, not a source of truth.** It duplicates identity the token stores already hold, so the risk to guard against is _drift_. The design contains drift structurally: the breadcrumb is only ever used to _decide whether to attempt_ a teardown, and every teardown op is keyed on `prev.familyId` and no-ops when that slot is already empty. So the failure modes of a drifted breadcrumb are bounded — a **stale** record pointing at an already-cleared or deleted family → all three teardown ops no-op (nothing to revoke/clear); a **corrupt/unparseable** record → `getLastGoogleAccount()` returns null → no teardown, and the next successful bind overwrites it; a **missing** record → one missed teardown, self-healing on the next write. None of these can revoke or delete a wanted token, because the `prev.familyId !== familyId` guard plus the per-family keying make the _new_ family's slot untouchable.
- **`removeDriveConnectionByAccount` operates on the _resident_ automerge doc** (`driveRepository.ts:73` → `driveRepo.remove`). On a different-_family_ sign-in the old family's `.beanpod` is not loaded, so a mirror clear there would no-op regardless — which is why the account-change teardown deliberately omits it. The mirror is covered by (a) the full-sign-out clear (Req 4, same family, doc resident) and (b) `matchesBoundAccount` on recovery, which never adopts account A's entry into a session on account B.
- **No import cycle.** `driveTokenRecovery` imports `googleAuth` (`primeRefreshToken`, `getSessionEpoch`, …), so `googleAuth` must **not** import `clearDriveConnectionForAccount`. The teardown lives in `googleAuth` and uses only `revokeGrant` + `getGoogleRefreshToken`/`clearGoogleRefreshToken`/`clearProviderConfig` (all already reachable from `googleAuth`). The mirror clear (Req 4) is done in `authStore`, which can import `driveTokenRecovery` with no cycle.
- **The `liveDriveGrantSharesAccount` guard does NOT apply here.** That guard lives in `calendarSyncStore.ts:848` and only gates `revokeCalendarGrantGuarded` (the _calendar_ revoke). The departing-account teardown calls `revokeGrant(token, { grant:'drive', trigger:'account-change' })` **directly**, which is never routed through that guard. Whole-grant revoke means this single Drive revoke kills the old account's Drive **and** calendar grants together (`googleRevoke.ts` module doc) — exactly what we want for a departing account. No bypass code is required.
- **The in-app `forceNewAccount` "switch account" flow is a different path** (no sign-out; `currentFamilyId` stays bound; revoke-before-mint fires; `armAccountSwitch` handles the assertion). The `prev.familyId !== familyId` guard means our teardown is inert on it (same family), so there is no double-revoke and no risk of revoking the freshly minted token.
- **Trusted-device preservation stays** — the fix adds the missing "different account ⇒ reset" branch so preservation only helps the same-account case it was designed for.

### Accepted limitation: single breadcrumb, sequential switching (multi-family boundary)

The breadcrumb is a **single record per device** that tracks the _immediately-previous_ authenticated account. This fully covers the reported scenario and every sequential switch (A → B → C → A …): each sign-in tears down the one account it displaced.

The deliberate boundary is a user who, **in one browser profile on one device**, keeps two families under _different_ Google accounts both connected and switches between their files **without signing out**. Under this design, loading family B's file revokes family A's departed grant (A must re-consent on return). This is:

- **Consistent with the intent** — a different-account sign-in is defined here as "abandon the previous account cleanly," which is precisely what fixes the bug.
- **Safe** — the guard + per-family keying guarantee only the _departed_ family's slot is touched; family B is never at risk.
- **Per-device** — the breadcrumb lives in `localStorage`, and refresh tokens live in per-device IDB, so there is **no cross-device drift**: each device reasons only about its own last account. A multi-_device_ user is unaffected.

If real usage shows this is too aggressive for genuine two-family-one-profile users, the future path is a **per-family last-account map** (keyed by family id, so switching back to A finds A's own record and skips teardown) or gating the teardown behind an explicit "signed out since" marker written on full sign-out. Both are strictly additive to this design and out of scope now.

## Assumptions

> **Review before implementation.** Valid at planning (2026-08-14); confirm against code if time passes.

1. `initializeAuth(familyId)` (`googleAuth.ts:472`) is the single transport-agnostic point every real sign-in reaches after token acquisition. (Confirmed — call sites: `syncStore.ts:541`, `:1177`, `:1840`.)
2. `ensureVerifiedGoogleAccountEmail()` (`googleAuth.ts:1878`) resolves the verified email on every fresh-consent transport and returns null (with **no network call**) on cold boot when `accessToken` is null. (Confirmed by reading the function.)
3. `revokeGrant(token, { grant:'drive', trigger })` (`googleRevoke.ts`) is idempotent (null/empty ⇒ `{ok:true, reason:'no-token'}`), offline-durable via `keepalive`, never throws, and self-logs via `logTokenLifecycle`. `trigger` is a free-form string, so `'account-change'` is valid. (Confirmed.)
4. `getGoogleRefreshToken(familyId)` / `clearGoogleRefreshToken(familyId)` / `clearProviderConfig(familyId)` (`fileHandleStore.ts`) each act on a specific family, dual-write IDB+localStorage, and swallow-but-report their own failures. `clearDriveConnectionForAccount(email)` (`driveTokenRecovery.ts:310`) is `isDocLoaded()`-guarded, `reportError`-wrapped, and never throws. (Confirmed.)
5. A single localStorage key survives sign-out (sign-out clears `beanies_grt_*`/`beanies_pcfg_*`, not this key). localStorage is already the durable, non-family-scoped mirror store in `fileHandleStore` (`beanies_grt_`, `beanies_pcfg_` prefixes). The record holds **no secret** — only account email + family id. (Confirmed by reading `fileHandleStore.ts`.)
6. `action`, `family_id`, `token_*`, `severity` are already in `ALLOWED_CONTEXT_KEYS` (`diagnosticContext.ts:61`). No allowlist / Lambda / privacy-doc change is needed. (Confirmed.)

## Approach

**Design decision: a durable last-account breadcrumb + a single detect-and-reconcile step inside `initializeAuth`, with the departed-account teardown dispatched off the hot path.** Persist who last authenticated; at the next sign-in bind, once the new verified account is known, if it differs (email **and** family), _dispatch_ a best-effort teardown of the old account's artifacts and refresh the breadcrumb. Detection and the breadcrumb write are one small synchronous step at the one converged point; the network-heavy teardown runs detached so it never delays or destabilizes the new session. All the logic lives behind **one named function** so `initializeAuth` stays flat.

### 1. A durable "last authenticated Google account" breadcrumb

Add three tiny helpers next to the existing `beanies_*` localStorage helpers in **`fileHandleStore.ts`** (googleAuth already imports this module — no new file, no new import):

```ts
const LS_LAST_GOOGLE_ACCOUNT = 'beanies_last_google_account';
export interface LastGoogleAccount {
  email: string;
  familyId: string;
}
export function getLastGoogleAccount(): LastGoogleAccount | null {
  /* JSON.parse, try/catch → null */
}
export function setLastGoogleAccount(email: string, familyId: string): void {
  /* JSON.stringify, try/catch warn */
}
export function clearLastGoogleAccount(): void {
  /* removeItem, try/catch warn */
}
```

Non-secret (email + family id only) and explicitly a **hint, not a source of truth** (the token stores stay authoritative). Best-effort like the other localStorage mirrors: a lost record just means one missed teardown, self-healing on the next write. Synchronous (no IDB async needed for a non-critical identifier). Reads/writes never throw; a corrupt value parses to `null`.

### 2. Teardown of the previous account's artifacts

A single best-effort private function in **`googleAuth.ts`** (it needs `revokeGrant` + the token internals). Each step independently try/caught + logged; none blocks the others; every step is keyed on `prev.familyId` and no-ops if that slot is already empty:

```
async function teardownDepartedAccount(prev: LastGoogleAccount): Promise<void> {
  // 1. Revoke the old grant (whole-grant: kills old Drive + Calendar together).
  try {
    const stored = await getGoogleRefreshToken(prev.familyId);
    await revokeGrant(stored?.token, { grant: 'drive', trigger: 'account-change' }); // self-logs; no-op if no token
  } catch (e) { reportError({ surface:'account-switch-reset', severity:'warning', message:'revoke failed', error:e, context:{ action:'teardown-revoke', family_id: prev.familyId } }); }
  // 2. Clear the old IndexedDB (+ localStorage mirror) refresh token.
  try { await clearGoogleRefreshToken(prev.familyId); logEvent({ level:'info', surface:'account-switch-reset', context:{ action:'cleared-token', family_id: prev.familyId } }); }
  catch (e) { reportError({ surface:'account-switch-reset', severity:'warning', message:'token clear failed', error:e, context:{ action:'teardown-token', family_id: prev.familyId } }); }
  // 3. Reset the old provider-config binding so a later return can't resurrect the stale account.
  try { await clearProviderConfig(prev.familyId); logEvent({ level:'info', surface:'account-switch-reset', context:{ action:'cleared-config', family_id: prev.familyId } }); }
  catch (e) { reportError({ surface:'account-switch-reset', severity:'warning', message:'config clear failed', error:e, context:{ action:'teardown-config', family_id: prev.familyId } }); }
}
```

`clearGoogleRefreshToken` / `clearProviderConfig` already swallow-and-report internally, so the outer try/catch is belt-and-braces. No `.beanpod` mirror clear here — the old family's doc is not resident on a cross-family switch (see caveats); the mirror is covered by §4.

### 3. The sign-in hook: one named reconcile function

Add **one private function** and a single call to it inside `initializeAuth(familyId)`, after the token load/migration and before `installAuthWakeListener()`. Keeping the logic in `reconcileDepartedAccount` (not an inline block) keeps `initializeAuth`'s responsibility list flat and gives one testable seam; a future third auth-scoped concern adds a sibling call, not more nesting.

```
async function reconcileDepartedAccount(familyId: string): Promise<void> {
  try {
    const newEmail = await ensureVerifiedGoogleAccountEmail(); // null (no fetch) on cold boot → returns early
    if (!newEmail) return;
    const prev = getLastGoogleAccount();
    if (prev && prev.familyId !== familyId && prev.email.toLowerCase() !== newEmail.toLowerCase()) {
      logEvent({ level:'info', surface:'account-switch-reset', context:{ action:'teardown-departed-account' } });
      // DISPATCHED, not awaited: this touches only the DEPARTED account and is
      // offline-durable/idempotent. Awaiting it would put an old-account network
      // revoke on the load-bearing bind path (every cold boot / load awaits it).
      void teardownDepartedAccount(prev);
    } else {
      logEvent({ level:'info', surface:'account-switch-reset', context:{ action:'noop-same-account' } }); // measures switch rate
    }
    setLastGoogleAccount(newEmail, familyId); // synchronous; refresh the breadcrumb either way
  } catch (e) {
    // Detection must never break the bind. initializeAuth is load-bearing on every cold boot.
    logEvent({ level:'warn', surface:'account-switch-reset', message:'reconcile failed', error:e, context:{ action:'reconcile-error' } });
  }
}
```

`initializeAuth` gains exactly one line: `await reconcileDepartedAccount(familyId);` before `installAuthWakeListener()`. The `await` here only covers the cheap detect + synchronous breadcrumb write (and, on the interactive create/connect path only, the one userinfo fetch that path needs anyway) — the network revoke is dispatched inside and does not extend it. The `prev.familyId !== familyId` guard makes it impossible to revoke/clear the token just bound (excludes cold-boot re-bind and the in-place `forceNewAccount` same-family switch). Because this is the converged bind step, popup/redirect/native all hit it identically.

### 4. Clear the mirror + breadcrumb on a genuine full sign-out

In `authStore.ts`, in the **full-teardown** sign-out paths only:

- **`signOut`** when `!trusted`, and **`signOutAndClearData`** (always): capture `const email = getGoogleAccountEmail()` **before** `clearGoogleSessionStateWithTimeout` (which nulls the cache), then after it but **before** `docClient.reset()` / `deleteFamilyDatabase` (doc still resident), call `await clearDriveConnectionForAccount(email)` — the same helper `googleDriveProvider.disconnect()` uses (`isDocLoaded()`-guarded, `reportError`-wrapped, never throws). Emit `logEvent({ surface:'account-switch-reset', context:{ action:'signout-cleared-mirror' } })`.
- On the same full-teardown condition, `clearLastGoogleAccount()` — the current account's token was just revoked+cleared, so the breadcrumb is moot and a stale record pointing at a cleared family should not linger. The **trusted same-account preserve** path keeps the breadcrumb (and the mirror), because a later different-account sign-in must still detect the change against it.

### Explicitly OUT of scope

- Changing trusted-device preservation itself (kept; we add the missing different-account branch).
- The in-app `forceNewAccount` switch flow's revoke-before-mint + `armAccountSwitch` (unchanged; the family-id guard makes the new logic inert there).
- A per-family last-account map / two-family-one-profile refinement (see the accepted limitation above).
- Any change to the account-binding heal, unified reconnect, detection thresholds, or `ALLOWED_CONTEXT_KEYS`.

## Files Affected

- `src/services/google/googleAuth.ts` — add private `teardownDepartedAccount(prev)` and private `reconcileDepartedAccount(familyId)`; add a single `await reconcileDepartedAccount(familyId)` call inside `initializeAuth` before `installAuthWakeListener()`; add `clearProviderConfig` to the `fileHandleStore` import (plus the last-account helpers); `getGoogleAccountEmail` export is already present.
- `src/services/sync/fileHandleStore.ts` — add `getLastGoogleAccount` / `setLastGoogleAccount` / `clearLastGoogleAccount` + the `LastGoogleAccount` type and `beanies_last_google_account` key, beside the existing `beanies_*` helpers.
- `src/stores/authStore.ts` — import `getGoogleAccountEmail` + `clearLastGoogleAccount` (from googleAuth) and `clearDriveConnectionForAccount` (from driveTokenRecovery); in the full-teardown branches of `signOut` (`!trusted`) and `signOutAndClearData`, clear the `.beanpod` mirror for the captured account email and clear the last-account breadcrumb.
- **No change** to `driveTokenRecovery.ts` / `driveRepository.ts` / `googleDriveProvider.ts` — their helpers (`clearDriveConnectionForAccount`, `removeDriveConnectionByAccount`, `clearProviderConfig`) are reused as-is.
- Tests: `googleAuth` `reconcileDepartedAccount` + `teardownDepartedAccount` (different vs same account; different vs same family; verified vs cold-boot email; family-guard; teardown dispatched not awaited; reconcile never rejects); last-account breadcrumb read/write/survive-signout/corrupt→null; authStore full-sign-out mirror + breadcrumb clear vs trusted-preserve; regression on trusted-device same-account preserve + `forceNewAccount`.

## Observability Coverage

All events via `logEvent`/`reportError`, reusing already-allowlisted context keys (`action`, `family_id`, `severity`, and `logTokenLifecycle`'s `token_*`). **No email PII** — the account is encoded as an `action` shape, never the address. No new context key is required (verified against `ALLOWED_CONTEXT_KEYS`), so no coupled Lambda-allowlist / privacy-doc change.

- **Account-change teardown dispatched** — `logEvent({ surface:'account-switch-reset', context:{ action:'teardown-departed-account' } })` when a different account+family is detected; companion `action:'noop-same-account'` so the _rate_ of real switches is measurable.
- **Per-step outcomes** — the revoke rides the existing `logTokenLifecycle({ token_op:'revoke', token_trigger:'account-change' })` (queryable, no new code). Token-clear / config-clear emit `action:'cleared-token'|'cleared-config'` on success.
- **Per-step failure** — `reportError({ surface:'account-switch-reset', severity:'warning', context:{ action:'teardown-…' } })` naming the step; sign-in still proceeds. A detection wrapper failure logs `action:'reconcile-error'`. `severity:'critical'` is never used here — teardown is of the _old_ account and cannot break the new session.
- **Full-sign-out mirror clear** — `action:'signout-cleared-mirror'`.
- **Triage-blind check**: "reconnect loop after switching accounts" → is `account-switch-reset action:teardown-departed-account` present? If absent when expected, detection didn't fire (email unknown / breadcrumb missing / same family). "old grant still alive" → `token_op:revoke token_trigger:account-change` outcome. "teardown half-failed" → the per-step `reportError`.

## Acceptance Criteria

- [ ] After `logout (trusted) → login as a DIFFERENT Google account` (different family/file), the previous account's grant is **revoked at Google**, its IndexedDB refresh token cleared, and its provider binding reset — dispatched at the new sign-in.
- [ ] `logout → login as the SAME account` on a trusted device still silently reconnects (no revoke, no teardown, preservation intact).
- [ ] Returning to the first account later starts **clean** (fresh consent, because its grant was revoked/cleared) — no account-drift 404, no "wrong account" reconnect, no hourly `invalid_grant`.
- [ ] Cold-boot resume (same device, no fresh consent) runs no teardown (`ensureVerifiedGoogleAccountEmail()` null → early return) and issues **no userinfo fetch** and no added latency.
- [ ] The departed-account teardown does not block `initializeAuth`: a slow/failed old-account revoke never delays the new session settling.
- [ ] A missing / corrupt / stale (deleted-family) breadcrumb causes at most a missed or already-satisfied teardown — never a wrong-account revoke or live-token loss.
- [ ] The in-app `forceNewAccount` same-family switch runs no teardown (family-id guard) — the freshly minted token is never revoked.
- [ ] The `.beanpod` mirror entry for the departed account is removed on a full sign-out; a still-valid other-account entry is never touched.
- [ ] All three transports (popup / redirect / native) trigger the teardown at `initializeAuth` — verified on a deployed build for iOS redirect/native.
- [ ] Every #62 guarantee + unified-reconnect work still pass; no token-count increase.
- [ ] No silent failures: each teardown step is independently guarded + logged; a failure never blocks sign-in.
- [ ] Diagnostic logging per **Observability Coverage** fires with the stated `surface`/`action`; no email PII; no new context key.
- [ ] `npm run build`, `npm run type-check`, lint, and Vitest all pass before push.

## Testing Plan

**Unit (Vitest):**

1. `teardownDepartedAccount`: revokes the old family's stored token, clears it, clears provider config; each step independently try/caught (one throwing doesn't skip the others); no-op-safe when the old family has no stored token (`revokeGrant(undefined)` → ok, clears no-op).
2. `reconcileDepartedAccount`: different email + different family + prior record → teardown **dispatched** (assert `teardownDepartedAccount` called) then breadcrumb updates; teardown is **not awaited** (reconcile resolves before a slow teardown settles); same email → no teardown, breadcrumb refreshed; **same email different family / different email same family → no teardown** (family-guard), breadcrumb refreshed; no prior record → no teardown, record set; cold-boot (`ensureVerifiedGoogleAccountEmail` null) → no-op, no fetch; a thrown detection/email step logs `reconcile-error` and never rejects.
3. Last-account breadcrumb: written on bind with a verified email; survives a simulated `clearGoogleSessionState` (not a token key); corrupt JSON → `getLastGoogleAccount()` returns null; cleared by full sign-out.
4. Full sign-out: `signOutAndClearData` (and untrusted `signOut`) calls `clearDriveConnectionForAccount` for the captured email + `clearLastGoogleAccount`; trusted same-account `signOut` does **neither**.

**Manual (greg, deployed — web first, then iOS build):** 5. Trusted device: gregsophia (Parker Meng) → log out → sign in as beanies.demo (different file) → CloudWatch shows `teardown-departed-account` + `token_op:revoke token_trigger:account-change` for gregsophia. Use beanies.demo >1h → no gregsophia churn. Return to gregsophia → single clean consent, then stable >1h. 6. Trusted device, SAME account: log out → log back in as gregsophia → silent reconnect, no consent prompt (`noop-same-account`). 7. iOS (deployed build): repeat 5 via redirect/native → teardown fires at the converged bind; no stuck state.

**Regression:** 8. In-app `forceNewAccount` switch still works (assertion switch + revoke-before-mint) and logs `noop-same-account` (family-guard) — no double-revoke. 9. Normal single-account create/sign-in/cold-boot unaffected — no teardown, no extra revoke; breadcrumb is written on first connect (verify via `ensureVerifiedGoogleAccountEmail` fetch); cold-boot adds no userinfo fetch.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the durable last-account record + teardown-on-different-account-sign-in at the converged `initializeAuth` choke point, plus a full-sign-out mirror clear; reused `revokeGrant`/`clearGoogleRefreshToken`/`clearProviderConfig`/`clearDriveConnectionForAccount`; preserved trusted-device same-account silent reconnect and the #62 + unified-reconnect work.
- **Pass 2 (DRY + error handling)**: Verified every seam against code — moved record-write + detection into one awaited block in `initializeAuth` keyed on `ensureVerifiedGoogleAccountEmail()` (dropping the unreliable fire-and-forget `notifyTokenAcquired` write and closing the create-path gap); added the `prev.familyId !== familyId` data-safety guard; dropped the always-no-op mirror clear from the change path (and its `googleAuth→driveTokenRecovery` import cycle), relying on the full-sign-out clear + `matchesBoundAccount`; reused `clearDriveConnectionForAccount` for the sign-out mirror clear; corrected the `liveDriveGrantSharesAccount` caveat (calendar-only, never suppresses the direct Drive revoke); pinned the record to a single non-secret localStorage key beside the existing `beanies_*` helpers; confirmed no `ALLOWED_CONTEXT_KEYS` change is needed.
- **Pass 3 (Sustainability)**: Hardened the hot path and the source-of-truth boundary. (1) Decoupled the departed-account teardown from the awaited bind — it operates only on the old, offline-durable/idempotent account, so it is _dispatched_ (`void`) rather than awaited, removing an old-account network revoke from `initializeAuth` (which runs on every cold boot and every load); only the cheap detect + synchronous breadcrumb write stay inline. (2) Extracted the detect→dispatch→record logic into one named `reconcileDepartedAccount(familyId)` so the load-bearing `initializeAuth` keeps a flat responsibility list. (3) Reframed the localStorage record as a non-authoritative breadcrumb and documented the drift boundary (stale/corrupt/missing/deleted-family → missed or already-satisfied teardown, never data loss). (4) Documented the single-breadcrumb / multi-family boundary as an accepted limitation with a concrete future path (per-family last-account map).
- **Pass 4 (Fresh-eyes sweep)**: Verified all six load-bearing claims against source — hook placement after token load/migrate and before `installAuthWakeListener` (`googleAuth.ts:472`), `ensureVerifiedGoogleAccountEmail` reflecting the NEW account on load/create (new-token verify awaited at `syncStore.ts:3104`) and null-no-fetch on cold boot, `revokeGrant` (`googleRevoke.ts:119`) being pure over the token string so the dispatched revoke cannot touch the just-bound session, the sign-out mirror-clear point capturing the email before `clearGoogleSessionState` nulls it (1649-1650) and running while the doc is still resident (before `docClient.reset()` 1328), no spurious teardown on normal cold boot (breadcrumb not written when email null; email+family guard otherwise), and the create-new-family-under-a-different-account teardown being the documented accepted limitation (grant-only reset, no data loss) — no changes required.

## Prompt Log

> No GitHub issue created — direct implementation. Full prompt history embedded.

<details>
<summary>Full prompt history</summary>

### Initial prompt (after the CloudWatch investigation)

> I'm confused though as the parker meng beanies file was created by and lives in the gregsophia@gmail.com google drive, and this has always been the case. i created anotehr file under the beaniesdemo@gmail.com account for android/iphone testing, and i have been switching between the two to test the recent changes to improve robustness. so the parker meng file should be genuinely owned by gregsophia@gmail.com and also lives in that google drive

### Follow-up (framing it as a genuine bug)

> I'm still confused as I did not log into _both_ sessions (gregsophia and beaniesdemo) at the same time. I logged out of one, logged into antoerh, then logged out, and switched back. This should be supported and normal (albeit perhaps rare) behavior, but it should not cause functionality to break in the app.
>
> Switching between accounts should be normal, supported behavior.
>
> If there is an issue that is triggered just by logging out, switching to anotehr file (under the same or a different google acocunt), and then switching back to the original, I woudl still consider that to be a genuine bug that needs to be fixed, as any user could be in that situation.
>
> a genuine logout / login to a different account shoudl clear/reset all relevant tokens, rather than leaving stale tokens or artifacts that then confuse the next session.

### Follow-up (proceed to plan)

> yes, kick off /beanies-plan for the account-switch-reset fix

</details>
