# Plan: Fix Google Drive refresh-token loss (silent-refresh failure / disconnection toast) — all platforms, once and for all

> Date: 2026-05-20
> Related issues: None — direct implementation. Diagnosed live via the new CloudWatch firehose (ADR-027) + Slack `offline-queue-flush` alerts on greg's Android PWA.
> Plan file (save on approval): `docs/plans/2026-05-20-google-refresh-token-persistence-fix.md`
> **No GitHub issue created.** Direct implementation; full prompt history in the Prompt Log below.

## User Story

As a beanies.family user on any device (especially an installed PWA on Android or iOS), I want my Google Drive connection to survive force-closing and reopening the app, so that I never see a spurious "disconnected" toast or lose the ability to save — my family's data keeps syncing without me having to reconnect every launch.

## Context

greg's Android PWA shows the "Google Drive disconnected" toast on **every** force-close/restart; desktop is unaffected. The firehose proved silent refresh isn't failing — it never attempts: every `offline-queue-flush` event carries `silent_refresh_had_refresh_token: false`, `attempts: []`, `refresh_token_age_ms: null` (family `ae92950b-…-fa046620`, builds `5b25970` and `d1077a4`). The refresh token is simply **absent from the device's storage** under the family key. A clean reconnect did not survive a restart — pointing past "token lost/revoked" to a structural store/issue bug. Two compounding root causes were found; **both** must be fixed for this to be resolved permanently and on every platform.

## Root cause (two compounding bugs)

**Bug #1 — refresh token persisted under the wrong key (orphaned under `__pending__`).**
All three write sites store under `currentFamilyId ?? PENDING_FAMILY_KEY`:

- `performPopupAuth` `googleAuth.ts:665`
- `attemptSilentAuthCode` `googleAuth.ts:589`
- `completeRedirectAuth` `googleAuth.ts:1459`

On a redirect reconnect (iOS + any standalone PWA), `App.vue` Step 2b (`:655`) calls `completeRedirectAuth()` **before the family is bound**, so `currentFamilyId` is `null` → token written under `__pending__`. `getActiveFamilyId()` (`indexeddb/database.ts`) is a _separate_ in-memory var, also null that early and never persisted — so the write site can't resolve the family key either. `initializeAuth(familyId)` (`googleAuth.ts:251`) — which DOES run on every cold boot via `syncStore.initialize()` (`syncStore.ts:382`) and on pod-load (`:821/:1319`) — reads **only** the family-scoped key and does **not** rescue `__pending__`. `migratePendingRefreshToken` (`googleAuth.ts:368`) — the only thing that moves `__pending__` → family key — is called **only** alongside the pod-LOAD path (`syncStore.ts:822, 1320`), never on a plain reconnect or cold boot. Net: the token is stranded under `__pending__`; the in-memory copy makes the _current_ session work (so reconnect "succeeds"), but the next cold start reads the empty family key → `had_refresh_token:false` → toast.

**Bug #2 — Google never re-issues a refresh token on reconnect (every platform).**
Google only returns a `refresh_token` with `access_type=offline` **and** `prompt=consent`. `buildAuthUrl` (`googleAuth.ts:1217`) takes a `prompt` arg, but:

- Redirect: `startRedirectAuth` hardcodes `'select_account'` (`googleAuth.ts:1417`).
- Popup: `performPopupAuth` uses `forceConsent ? 'consent' : 'select_account'` (`:636`), and reconnect callers pass `forceConsent: !hasRefreshToken()` (`useGoogleReconnect.ts:40`) / `!isTokenValid()` — both **false** on reconnect because a (stale) token exists → `select_account`.

So on reconnect Google returns only an access token, **no** refresh token, and the code silently skips storing (`if (tokens.refresh_token)` at `:662`/`:1456` with no else). Desktop "works" only because its _original_ consent-issued refresh token is still valid under the family key (popup path binds the family before storing); it simply hasn't needed a reconnect yet.

**Why desktop vs PWA:** desktop browser → popup, family already bound at token time → stored under family key (survives). iOS/Android/desktop **PWA** (standalone) → redirect, family not bound at completion → orphaned under `__pending__`, and reconnect can't even obtain a fresh token. The fix is platform-agnostic so it closes the gap for all.

## Requirements

1. Every **interactive auth whose purpose is establishing offline Drive access** (connect a new pod OR reconnect) MUST request `prompt=consent` so Google issues a fresh `refresh_token` — on **all** platforms (desktop popup, iOS redirect, Android redirect, desktop-PWA redirect). (`access_type=offline` is already always set at `buildAuthUrl` `googleAuth.ts:1230` — only `prompt` needs changing.)
2. An obtained refresh token MUST end up persisted under the **family-scoped key** and be read back on the next cold start — regardless of whether it was first written under `__pending__`.
3. greg's currently-stranded state MUST **self-heal** on the next normal app open after the fix (no special user action beyond one final reconnect to obtain a consent-issued token).
4. **No silent loss**: if an interactive connect/reconnect completes without a refresh token, it must be logged (firehose + console), never silently accepted.
5. Confirming **instrumentation** so the firehose proves the fix per-platform post-deploy, and catches any regression.
6. Downstream auto-recovery: once the token persists+loads, the stuck offline save flushes and the disconnection banner clears with **no manual step** (existing wiring — verify, don't rebuild).

## Approach

### Fix A — force consent for offline-access auth, in ONE place (Bug #2)

The invariant — _interactive auth that establishes offline Drive access ⇒ `prompt=consent`_ — must live in one place, not be replicated as a `forceConsent: true` literal across call sites (a future redirect site would silently default to `select_account` and reintroduce Bug #2).

- **Redirect path — make `startRedirectAuth` always consent.** Change the hardcoded `'select_account'` at `googleAuth.ts:1417` to `'consent'`, with a doc-comment stating the invariant. **Verified: every `startRedirectAuth` caller is an offline-access flow** — `useGoogleReconnect.ts:35`, `connectStorage.ts:76`, `SettingsPage.vue:294` (switch-account), `usePickBeanpodFile.ts:81` (re-pick) — so always-consent is correct and needs **no per-call-site edits** and no boolean threading. (If a genuine non-consent redirect caller is ever added, give it an explicit opt-out then — not before.) This is simpler and more regression-proof than a `forceConsent` flag or a wrapper function.
- **Popup path — force consent at the connect/reconnect call sites only** (popup `requestAccessToken` is also used for incidental access-token top-ups where consent would be annoying, so it can't be globally forced):
  - `useGoogleReconnect.reconnect` popup branch (`:40`) → `requestAccessToken({ forceConsent: true, loginHint })` (was `!hasRefreshToken()`).
  - `SettingsPage.vue` popup branch (`:297`) already passes `forceConsent: true` — no change.
  - `connectDriveStorage`'s `createNew(..., { forceConsent: !isTokenValid() })` already forces consent for a no-token new connect — **no change, verified** (`connectStorage.ts:86` → `googleDriveProvider.ts:345` defaults true).

UX note: this shows Google's consent screen on each reconnect. That's the correct, Google-documented way to guarantee a `refresh_token`; reconnect is interactive and infrequent, so the friction is acceptable and intended.

### Fix B — guarantee family-key persistence + self-heal orphans (Bug #1)

Put the "move pending → family **iff** the family key is empty" rule in **one** function so there's a single source of truth and no clobber hole.

- **Add the empty-family guard inside `migratePendingRefreshToken(familyId)`** (`googleAuth.ts:368`): read the family-key token first; if a token already exists there, return without overwriting (never clobber a good family token with a stale pending one). Today it overwrites unconditionally — that latent hole is closed here, not just at the caller. The family key is empty in the cases that matter: greg's token was orphaned under `__pending__` and **never written under the family key** (the firehose shows refresh never even attempts — `had_refresh_token:false` — so the `invalid_grant` clear path at `googleAuth.ts:911`/`:1068` never ran); and a genuinely revoked token would have been cleared by a prior `invalid_grant`. Either way the guard migrates the pending token; when a good family token genuinely exists, the guard correctly leaves it untouched.
- **`initializeAuth(familyId)`** (`googleAuth.ts:251`): after its family-key read, call `migratePendingRefreshToken(familyId)` (now guarded) — unconditionally; the guard makes it a no-op when the family key already has a token. Wrap **only the `migratePendingRefreshToken(familyId)` call** (not the existing family-key read/load block, which already self-reports via `getGoogleRefreshToken` at `fileHandleStore.ts:266-273` — avoid double-reporting) in try/catch + `reportError({ surface: 'auth-init', message: 'pending-token rescue failed', error })`. Reason: `syncStore.initialize()`'s caller only `console.warn`s an `initializeAuth` rejection (`syncStore.ts:383`), which would otherwise lose the firehose signal.
- **Remove the now-redundant explicit `migratePendingRefreshToken` calls** at `syncStore.ts:822` and `:1320` (each immediately follows an `initializeAuth` call, which now performs the guarded migration itself — single source of truth, no double IDB read).
- **Why this heals (ordering is load-bearing — name both sites):** on a redirect reconnect, `completeRedirectAuth` (`App.vue:663`, Step 2b) writes the fresh token under `__pending__`; the redirect was a full page reload, so later in the same `onMounted`, `loadFamilyData()` (`App.vue:834`) → `syncStore.initialize()` (`:357`) → `initializeAuth(activeFamilyId)` (`syncStore.ts:382`) runs the guarded migration → token moved to the family key → survives the next restart. The **same** path self-heals any already-orphaned device (greg's) on the next cold boot, no special action. Note the cold-boot call is guarded by `if (ctx.activeFamilyId)` (`syncStore.ts:381`), so the rescue fires once the active family is resolved (it is on the normal boot path); a future boot reaching sync-init before family resolution would simply self-heal on the following pass.

### Fix C — no silent loss + confirming instrumentation

> **API note:** both take a **single object**, but the field names differ: `logEvent` (`src/services/telemetry/logEvent.ts:94`) uses `level` (`'debug'|'info'|'warn'|'error'`); `reportError` (`src/utils/errorReporter.ts`) uses `severity` (`'error'|'warning'`). They are NOT interchangeable — passing `level` to `reportError` is ignored (defaults to `'error'`), and neither uses positional args. `reportError` already mirrors into the firehose, so for the same event use `reportError` alone (never `reportError` + `logEvent` = double-log).

- In `completeRedirectAuth` (`:1456`) and `performPopupAuth` (`:662`): when the auth is interactive but `!tokens.refresh_token`, call
  `reportError({ surface: 'auth-no-refresh-token', severity: 'warning', message: 'interactive connect/reconnect returned no refresh token; offline access not established' })`.
  Catches a future regression of Bug #2 (and lands in the firehose via the mirror).
- `initializeAuth`: when the guarded migration actually moved a token → `logEvent({ level: 'info', surface: 'auth-init', message: 'rescued orphaned pending refresh token → family key', context: { family_id: familyId } })`; when neither family nor pending token exists → `logEvent({ level: 'warn', surface: 'auth-init', message: 'startup: no refresh token under family or pending key', context: { family_id: familyId } })`. (`family_id` is allowlisted; lets the firehose correlate the heal to greg's `…fa046620`. Detail rides in the developer-authored `message`.) These let the firehose confirm, per platform, exactly what happened on the next reconnect+restart.

### Downstream recovery (verify, no new code)

Once the token persists+loads, `performSilentRefresh` succeeds → `notifyTokenAcquired` (`googleAuth.ts:~1176`) fires → `offlineQueue` `onTokenAcquired(() => tryFlush('token-acquired'))` (`offlineQueue.ts:237`) flushes the stuck save, and `syncStore.handleGoogleReconnected` (`syncStore.ts:~1966`, subscribed at `~2483`) clears `showSaveFailureBanner` / `saveFailureLevel`. Confirm this chain end-to-end so greg's stuck pending save self-clears.

## Files Affected

- `src/services/google/googleAuth.ts` — **the only file with substantive logic changes**: `startRedirectAuth` `prompt` `'select_account'`→`'consent'` (`:1417`) + invariant doc-comment; `migratePendingRefreshToken` (`:368`) add the empty-family guard + the rescue `logEvent`; `initializeAuth` (`:251`) call the guarded migrate + try/catch+`reportError`; `completeRedirectAuth` (`:1456`) + `performPopupAuth` (`:662`) the no-refresh-token `reportError`. Reuses `buildAuthUrl`, `getGoogleRefreshToken`, `PENDING_FAMILY_KEY`.
- `src/composables/useGoogleReconnect.ts` — **popup branch only** (`:40`) → `requestAccessToken({ forceConsent: true, loginHint })`. (Redirect branch `:35` is unchanged — `startRedirectAuth` now always consents.)
- `src/stores/syncStore.ts` — **remove** the now-redundant explicit `migratePendingRefreshToken` calls at `:822` and `:1320` (the preceding `initializeAuth` now migrates). Reference (verify only): `initializeAuth` cold-boot site `:382`, `handleGoogleReconnected` `~:1966` (downstream recovery).
- **No change needed** (redirect callers get consent for free via `startRedirectAuth`, verified): `connectStorage.ts:76`, `SettingsPage.vue:294`, `usePickBeanpodFile.ts:81`, and `App.vue` (`:663` Step 2b, `:834` loadFamilyData — ordering reference only).
- `src/services/google/__tests__/googleAuth.test.ts` — new tests (below). Mirror existing `vi.resetModules()` + `vi.resetAllMocks()` + mock `oauthProxy`/`fileHandleStore` pattern.
- (likely) `src/composables/__tests__/useGoogleReconnect.test.ts` — assert the popup branch forces consent (create if absent, matching conventions).
- Docs: `docs/adr/` (short ADR or extend ADR-026 with the in-code invariants: **(a)** `startRedirectAuth` always forces consent because every redirect flow establishes offline access; **(b)** pending→family migration only when the family key is empty), `CHANGELOG.md`, `docs/STATUS.md`.

## Platform coverage (holistic)

| Platform                  | Auth mode | After fix: refresh token issued?       | Stored under family key?               |
| ------------------------- | --------- | -------------------------------------- | -------------------------------------- |
| Desktop browser           | popup     | ✅ reconnect site forces consent       | ✅ family bound at token time          |
| Desktop PWA (standalone)  | redirect  | ✅ `startRedirectAuth` always consents | ✅ via `initializeAuth` pending-rescue |
| iOS Safari / Chrome / PWA | redirect  | ✅ `startRedirectAuth` always consents | ✅ via pending-rescue                  |
| Android browser           | popup     | ✅ reconnect site forces consent       | ✅ family bound (or rescue)            |
| Android PWA (standalone)  | redirect  | ✅ `startRedirectAuth` always consents | ✅ via pending-rescue                  |

All changes live in shared auth code + the common reconnect entry points; `shouldUseRedirectAuth()` routing is unchanged. No platform-specific branches added.

## Edge cases & caveats

- **Both keys present**: rescue only when family-key is absent — never clobber a valid family token with a stale `__pending__`.
- **Genuine pre-family onboarding** (create-pod, no family yet): token still legitimately lands under `__pending__`; the existing pod-load migration + the new initializeAuth rescue both cover it.
- **localStorage fallback** (`fileHandleStore.ts`) is family-keyed only (no `__pending__`); behavior unchanged. Rescue operates on the IDB layer via the existing helpers.
- **Token rotation**: forcing consent issues a new refresh token each reconnect (Google may retire the oldest beyond its per-user/client cap — irrelevant at our scale).
- **`StoredRefreshToken {token, issuedAt}`** shape + legacy bare-string handling already in `getGoogleRefreshToken`; reuse, don't touch.

## Acceptance Criteria

- [ ] Every interactive connect/reconnect path (`useGoogleReconnect` redirect + popup, `connectDriveStorage` redirect, `SettingsPage` switch-account redirect, `usePickBeanpodFile` redirect) requests `prompt=consent` so Google issues a refresh token — verified per call site.
- [ ] `initializeAuth(familyId)` rescues a `__pending__`-orphaned token into the family key when the family key is empty, and never overwrites an existing family-key token.
- [ ] The rescue + the no-refresh-token paths emit firehose signal (`auth-init` / `auth-no-refresh-token`); no path silently accepts a missing refresh token.
- [ ] On greg's Android PWA: one consent-forcing reconnect, then force-close/reopen → **no disconnection toast**; the stuck offline save flushes and the banner clears with no manual step.
- [ ] Firehose shows no new `offline-queue-flush` with `had_refresh_token:false` for family `…fa046620` after the fix; an `auth-init: rescued …` event confirms the heal.
- [ ] `npm run validate` green (type-check + lint + format + unit + build).

## Tests

1. `startRedirectAuth(..., { forceConsent: true })` → built URL contains `prompt=consent` (and `access_type=offline`); default → `select_account`.
2. `useGoogleReconnect.reconnect` forces consent on both the redirect path (asserts `startRedirectAuth` called with `{forceConsent:true}`) and popup path (`requestAccessToken` with `forceConsent:true`).
3. `initializeAuth(familyId)` rescues a `__pending__` token when the family-key entry is absent (mock `getGoogleRefreshToken`: family→null, pending→token; assert `migratePendingRefreshToken` ran and `currentRefreshToken` set); and does NOT rescue when the family-key token exists.
4. `completeRedirectAuth` / `performPopupAuth` with `tokens.refresh_token` absent → fires the `auth-no-refresh-token` report.
5. Full `npm run validate` (type-check + lint + format + unit + build) green.

## Verification (end-to-end)

1. **Local unit**: the tests above pass.
2. **Deploy** (greg-gated) via `Deploy beanies PROD`.
3. **greg's device — one final reconnect**: on the Android PWA, reconnect Drive (now `prompt=consent` → fresh refresh token), force-close, reopen. Expect: **no disconnection toast**; the stuck save flushes; banner clears automatically.
4. **Firehose confirmation (Claude-run)**: `aws logs` Logs Insights on `/aws/lambda/beanies-family-telemetry-prod`, filter `t="beanlog" and surface="auth-init"` → expect `rescued orphaned pending refresh token → family key` (then clean), and **no new** `offline-queue-flush` with `had_refresh_token:false` from family `…fa046620`.
5. **Cross-platform smoke** (greg, as available): repeat reconnect→restart on desktop browser + (if possible) an iOS device — confirm persistence. The firehose surfaces any `auth-no-refresh-token` or `auth-init: no refresh token` across platforms.

## Rollout / sequencing

1. Implement A + B + C with tests; `npm run validate` green.
2. Commit to `main`; deploy `Deploy beanies PROD` (greg-gated).
3. greg does **one** consent-forcing reconnect on the PWA (to obtain a persistable token); thereafter restarts are clean — and existing orphans self-heal on next open.
4. Watch the firehose 24–48h for `auth-init`/`auth-no-refresh-token`/`offline-queue-flush` across families to confirm the class of bug is gone.

## Out of scope (tracked separately)

- The desktop **"new version available" SW-toast loop** — likely the `vite-plugin-pwa` update-prompt handler + two same-day deploys; distinct from auth. Investigate next as its own change.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the two-bug fix — Fix A (force `prompt=consent` on all interactive connect/reconnect across platforms), Fix B (`initializeAuth` rescues `__pending__`-orphaned tokens), Fix C (no-silent-loss report + confirming `auth-init` instrumentation), plus platform matrix, edge cases, tests, verification, rollout.
- **Pass 2 (DRY + error handling)**: Fixed the `logEvent` calls to the real single-object API (positional form doesn't exist) and routed the no-refresh-token case through `reportError` alone (avoids double-log via the firehose mirror); corrected the heal mechanism (cold-boot `syncStore.initialize()` → `initializeAuth` at `syncStore.ts:382`, not "pod-load"); fixed the Step-2b line ref (`:655`); added two missed redirect call sites to the consent audit (`SettingsPage.vue:294` switch-account, `usePickBeanpodFile.ts:81`); confirmed `createNew` consent is already correct; added a try/catch+`reportError` guard around the rescue (since `syncStore.initialize` only console.warns); noted `access_type=offline` is already always set.
- **Pass 3 (Sustainability)**: Collapsed the scattered `forceConsent` threading into a single source of truth — `startRedirectAuth` always uses `prompt=consent` (verified every caller is an offline-access flow), eliminating the per-call-site footgun and removing edits to `connectStorage`/`SettingsPage`/`usePickBeanpodFile` entirely. Moved the "migrate pending → family **iff** family key empty" guard _inside_ `migratePendingRefreshToken` (closing a latent clobber hole + making the explicit `syncStore:822/1320` calls redundant → removed). Named the load-bearing reload ordering (`App.vue:663` write → `:834`→`syncStore.initialize():357`→`initializeAuth:382` heal). Required in-code invariant doc-comments. Added `context:{family_id}` to the rescue logEvent for firehose correlation.
- **Pass 4 (Fresh-eyes sweep)**: Verdict: solid. Verified always-consent annoys no flow (all 4 redirect callers establish offline access; resume-setup re-entry doesn't double-prompt) and the empty-family guard is correct for greg's orphan case. Four precision fixes: corrected the Fix-B rationale (family key is empty because the token was never written there — not because `invalid_grant` cleared it, which never ran since refresh never attempts); noted the cold-boot rescue is gated by `if (ctx.activeFamilyId)` (`syncStore.ts:381`) and self-heals next pass otherwise; scoped the try/catch to ONLY the migrate call (avoid double-reporting IDB read errors); tightened the API note (`reportError` uses `severity`, `logEvent` uses `level` — not interchangeable). No correctness/security holes; no new scope.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial request (after the telemetry pipeline went live and was verified)

> Now that we've secured more detailed and accurate log setup, let's again address the issue of the google drive / data file disconnection and silent refresh failure. Since this morning, the issue has gotten worse. It seems now that every time I start the PWA, the google drive disconnection toast appears. This is now consistently happening every time i force close and restart the PWA. I should also note that the silent token refresh appears to work from the desktop site... However an odd behavior I've now noticed on the desktop site is that the "new version available" toast is popping up - no matter how many times i click on it and refresh, it never goes away. The main issue though is that now it appears the PWA loses data file connection and silent refresh fails every time it is force closed and started. [+ Slack offline-queue-flush / save-failure-banner error blobs showing silent_refresh_had_refresh_token:false on builds 5b25970 and d1077a4]

### Reconnect test

> Ok - i've performed a reconnect now and successfully connected again. then i force closed the PWA and opened it and received the disconnection toast from the PWA. Pls check the logs

### Plan request (this plan)

> Build a plan to deploy a fix and please ensure it is complete, holistic, comprehensive, and applies across all platforms, including desktop, iphone, iOS, android, etc. ensure that we can resolve this issue once and for all

### Refinement

> Use the /beanies-plan skill to review and refine this plan

</details>
