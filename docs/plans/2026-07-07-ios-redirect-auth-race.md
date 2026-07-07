# Plan: Fix the iOS redirect-OAuth init race that fails the first "sign in to an existing family"

> Date: 2026-07-07
> Related issues: None — direct implementation
> Plan file (on approval): `docs/plans/2026-07-07-ios-redirect-auth-race.md`
> Ships together with the pending B1/B2 Vue-app prod deploy (independent subsystems).

## Context / Problem

On iOS (WebKit + PWA) Google OAuth uses a **full-page redirect** — the app reloads when Google redirects back with an authorization `code` (ADR-026). greg reproduced, reliably, on a real iPhone on the real `app.beanies.family` domain:

1. Clear cache, open fresh → welcome gate → "sign in to an existing family".
2. Complete Google consent (redirect out, then back).
3. **Error** — "your sign-in information is incorrect" (appears to fail).
4. Tap "sign in to an existing family" again → **works**: no re-consent, the family list appears.

A 3-agent investigation triangulated the root cause: **a boot-time init-ordering race, not a token/credential problem.** OAuth genuinely succeeds (the second attempt has the token, no consent) — the first attempt just reads the token _before it's committed_.

### The exact race (verified)

- `App.vue:752` — `await authStore.initializeAuth()` flips `isInitialized`/`isAuthenticated` **true**, which synchronously drives the resume consumer (`LoginPage.vue` watchEffect → `LoadPodView.openDrivePicker({isResume:true})`, or single-family → `syncStore.loadFromFile()`).
- `App.vue:786` — **only later** — `await withTimeout(completeRedirectAuth(), …)` does the network `code → token` exchange and commits the in-memory token.
- `completeRedirectAuth()` (`googleAuth.ts:1784`) removes the one-time code from `sessionStorage` on entry (`:1800`), then `await exchangeCodeForTokens()` (`:1827`), then `commitAcquiredToken()` (`:1844`, sets `accessToken`/`expiresAt`). `isTokenValid()` is `!!accessToken && Date.now() < expiresAt` (`:878`) → **false for the whole exchange window**.
- So the resume consumer checks `isTokenValid()` mid-exchange → `false` → concludes a hard auth failure (family-LIST path: `t('googleDrive.authFailed')`) or bounces a **second** redirect via `connectStorage.beginDriveAuthRedirectIfNeeded:63`. `tryReconnectSilently` can't help a first cache-cleared sign-in (refresh token not persisted yet).

Also worth correcting: `docs/STATUS.md:17` blamed a related iOS `tokenValid=false` symptom on an ITP/tunnel artifact. That's incomplete — ITP eviction fails _repeatedly_ with _re-consent_; the first-fail→second-success→**no-re-consent** signature on the **real domain** is this ordering race.

## Approach (surgical — a shared "settled" primitive, NOT a boot reorder)

Reordering `App.vue` init is the tempting one-liner but higher-risk (native, create-flow, boot budget, consent-denied branch all depend on it). Instead: make the token consumers **wait for the pending exchange to settle** before judging `isTokenValid()`. Because the one-time code is consumed on first entry, this MUST be a shared **memoized** promise (a second raw call no-ops to `null`).

**1. `googleAuth.ts` — the primitive (reuse existing `withTimeout` from `@/utils/timing`, and `isNative` already imported at `:28`):**

- `ensureRedirectAuthSettled(): Promise<string|null>` — a per-page-load module memo (`redirectSettlePromise`) that runs `completeRedirectAuth()` once, bounded by `withTimeout` (`REDIRECT_AUTH_SETTLE_TIMEOUT_MS = 20_000`); all callers await the same promise. **No-ops to `null` on native** (the `appUrlOpen` deep-link listener owns redemption, ADR-029). Rejects with the same typed errors (`DriveConsentDeniedError`).
- `whenRedirectAuthSettled(): Promise<void>` — non-throwing wrapper: awaits the memo, logs ONE central breadcrumb on rejection, returns void. This is what consumers call.
- `__resetRedirectSettleForTesting()` — matches the module's existing `__reset*ForTesting` convention.
- **Reject-sticky by design** (a consumed code is only recoverable via a fresh redirect = new page load = fresh memo); documented so nobody "fixes" it into a retry loop. **No unhandled-rejection hazard** — every caller attaches its handler synchronously (`.then`/`await` at the call site), so no defensive `.catch` is added.

**2. `App.vue` boot** — call `ensureRedirectAuthSettled()` instead of `completeRedirectAuth()` (keep the `if(!isNative())` block, try/catch, `DriveConsentDeniedError` branch, `disarmAccountSwitch()`). Remove the now-unused `INIT_TIMEOUTS.completeRedirectAuth` and the orphaned `withTimeout` import (verified sole user).

**3. Three consumer guards** — insert `await whenRedirectAuthSettled();` immediately before the existing `!isTokenValid()` decision:

- `connectStorage.beginDriveAuthRedirectIfNeeded` (`:63`) — the resume/redirect gate (also fixes `:159` `forceConsent`).
- `LoadPodView.openDrivePicker` (`:594`) — greg's family-LIST path.
- `syncStore.loadFromFile` (top) — the single read chokepoint (covers single-family auto-select + FamilyPicker). One guard, not per-caller.

**4. `useJoinFlow.consumePendingRedirectAuth`** — route through `ensureRedirectAuthSettled()` inside its existing `tryStep(...)` (closes a latent double-consume on the invite page; native-equivalent).

**5. Classifier — verify-and-lock, do NOT widen.** The originally-proposed `isAuthTransientSyncError` widening was **dead code**: `DriveApiError:401/403` are never emitted (only `DriveApiError:404:` is), and the real post-redirect transient already surfaces as `TokenExpiredError('…silent refresh failed')`, which the existing `/silent refresh failed/i` matcher already classifies `auth` (retryable). Leave the matcher; add a regression test locking it.

**6. `docs/STATUS.md:17`** — amend the mis-attribution note.

**Guard pattern rule (documented once):** any new synchronous `!isTokenValid()` gate that can run at post-redirect boot must be preceded by `await whenRedirectAuthSettled();`. Single-redeemer **import-scoped tripwire** test guards that `completeRedirectAuth` is imported only by `googleAuth.ts` (comment mentions in `useGoogleReconnect.ts`/`OAuthCallbackPage.vue`/`App.vue` are ignored).

**Deferred (YAGNI):** `ResumePodSetup.rehydrateOwner` has the same latent race but behind human password-entry latency — not the reported bug; documented trigger to add the same guard later if it ever surfaces.

## Critical files to modify

- `src/services/google/googleAuth.ts` — `ensureRedirectAuthSettled` + `whenRedirectAuthSettled` + `REDIRECT_AUTH_SETTLE_TIMEOUT_MS` + `__resetRedirectSettleForTesting`; `completeRedirectAuth` unchanged (documented as the single redemption impl).
- `src/App.vue` — boot uses `ensureRedirectAuthSettled()`; remove `INIT_TIMEOUTS.completeRedirectAuth` + orphaned `withTimeout` import.
- `src/services/sync/connectStorage.ts`, `src/components/login/LoadPodView.vue`, `src/stores/syncStore.ts` — one `await whenRedirectAuthSettled();` guard each (syncStore also adds it to its existing googleAuth import).
- `src/composables/useJoinFlow.ts` — route through the memo; drop the raw `completeRedirectAuth` import.
- `docs/STATUS.md` — amend the note.
- Tests: `src/services/google/__tests__/googleAuth*.test.ts` (primitive: single-redemption, shared/bounded, native no-op, reject-sticky, reset seam, import-scoped tripwire), `connectStorage`/`LoadPodView` guard tests, `syncStore` classifier-lock test.

## Verification

1. **Unit** — primitive (redeems once across concurrent callers; false→true transition; native → `null` without calling inner; reject-sticky without re-invoking inner, with a rejection handler attached; reset seam); consumer guards (no second redirect / lists after settle / `loadFromFile` awaits); `whenRedirectAuthSettled` non-silence (logs breadcrumb, App.vue still reports typed error); classifier lock (`TokenExpiredError`→`auth`, `404`→`not-found`, network/5xx→`error` unchanged); import-scoped single-redeemer tripwire.
2. **Regression** — create-family `?resume=setup`, native completion, join-flow (single redemption on invite page), desktop popup — existing tests green; type-check + lint clean; full suite green.
3. **Manual / device (definitive)** — real iPhone, cache cleared, `app.beanies.family`: sign in to existing family → consent → **first attempt loads the family list**, no error, no second consent. Repeat (timing-dependent). Also: single-family auto-select; consent-denied (revoke → consent-denied screen); genuinely signed-out account still errors correctly.
4. Ship in the same Vue-app prod deploy as B1/B2.

## Review passes (all four ran, fresh-context subagents)

- **Pass 1** — root-caused the race; designed the memoized `ensureRedirectAuthSettled()` awaited by the consumers; (initially) proposed a classifier widening.
- **Pass 2 (DRY/errors)** — fixed the `INIT_TIMEOUTS` layering bug (constant moves into `googleAuth.ts`); native-safe by construction (ADR-029); single non-throwing `whenRedirectAuthSettled()` wrapper (one breadcrumb); collapsed the family-select guard to one `loadFromFile` chokepoint; closed a latent `useJoinFlow` double-consume.
- **Pass 3 (sustainability)** — **removed the classifier widening as dead code** (verified `DriveApiError:401/403` never emitted; real transient already matched) → replaced with a lock test; added the test-reset seam; documented reject-stickiness; reframed as one redeemer + a single-caller tripwire; deferred the `ResumePodSetup` guard.
- **Pass 4 (fresh-eyes)** — re-verified async semantics (withTimeout memoization is unhandled-rejection-safe; native non-regression; App.vue-vs-consumer interleaving preserves the consent-denied branch); **fixed the one real defect** — retargeted the tripwire from bare-text to **import-scoped** (avoids false-positives on comment mentions); made the `withTimeout` import removal definitive; added the no-unhandled-rejection invariant + test hygiene. Core design unchanged and confirmed sound.

## Prompt log

<details><summary>Full history</summary>

- greg (verbatim bug report): "when logging in over iphone… clear all cache… sign in to an existing family… complete the google consent… receive an error that my sign in information is incorrect… tap on sign in to an existing family again… NOW i'm presented with a valid list of the existing families… Can you do a deep dive investigation into this issue to find the root cause?"
- greg (/beanies-plan): "let's prepare a plan and fix this. we can ship all the fixes together"
- Investigation basis: 3 parallel agents (redirect flow / error-string origin / token lifecycle) converged on the init-ordering race.

</details>
