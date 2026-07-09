# Plan: Google Drive refresh-token loss — un-blind telemetry, stop the calendar refresh storm

> Date: 2026-07-09
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-07-09-drive-refresh-token-telemetry-and-calendar-storm.md`

## User Story

As a beanies.family user, I want my Google Drive connection to stay connected without repeated "Google session expired" prompts, so that my family data keeps saving without me babysitting it — and as the operator, I want the telemetry to tell me _why_ a grant died instead of silently swallowing the evidence.

## Context

Greg reports the orange `googleDrive.sessionExpired` toast ("Google session expired. Reconnect to keep saving.") on almost every tab open, PWA resume, and after deploys, across all browsers, starting ~2026-07-07 — coinciding with the ADR-032 `docWorker` prod-ON flip.

A full investigation this session established the following, all evidence-backed:

1. **The app is not deleting the refresh token.** IndexedDB `beanies-file-handles`/`handles` on an affected tab contains only `providerConfig-<familyId>` — no `googleRefreshToken-<familyId>`, no `googleRefreshToken-__pending__`. (greg, DevTools.)
2. **Google is rejecting the token.** `POST https://api.beanies.family/oauth/google/refresh` → `400 invalid_grant — "Token has been expired or revoked."` The client then _correctly_ clears the dead token (`performSilentRefresh` permanent branch, `googleAuth.ts:1104-1128`). **The empty store is a consequence of Google's rejection, not its cause.**
3. **The worker migration is not implicated.** `beanies-file-handles` (v1, unchanged since 2026-05-22) is a different database from `beanies-automerge-*`. `deleteFamilyDatabase`, `docClient.clearCache`, and `docClient.reset` never touch it. PWA `cleanupOutdatedCaches` purges Workbox Cache Storage only; `hardReload.ts` issues no `indexedDB.deleteDatabase`.
4. **`googleAccountAssertion` never fired** — no `[accountAssertion]` line anywhere in the console log.
5. **Google-side config is clean.** App is `In production`; branding verified; data access verified; the sensitive `calendar.events.owned` scope shows a green "This scope is verified" check. The grant is still listed at `myaccount.google.com/permissions`. Re-consent shows no "Google hasn't verified this app" warning.
6. **Drive and Calendar share one OAuth client** (`VITE_GOOGLE_CLIENT_ID`; `googleAuth.ts:406`, `calendarAuth.ts:72`) and therefore one grant — which is why both tokens die together.

**The root cause is not yet known.** Surviving candidates:

- **(a) Google's ~100-refresh-tokens-per-user-per-client cap**, silently invalidating oldest-first. The app mints a new refresh token on every reconnect (`prompt=consent`) and never revokes the one it displaces.
- ~~**(b) A one-time Google account security event** (e.g. password change)~~ — **ELIMINATED 2026-07-09.** Greg confirms he has not changed his Google account password.
- **(c) Unidentified.**

With (b) eliminated, the field is (a) or (c). Neither is diagnosable from the client's current telemetry, which is precisely what Workstream 1 fixes.

During the investigation, five successive root-cause hypotheses were asserted and each was refuted by a single cheap observation. This plan therefore **prioritizes measurement over remedy**: Workstream 1 exists to name the cause, not to guess at it.

### Why the evidence was invisible for a week

`scheduleColdStartReconnectEscalation` (`syncStore.ts:1808-1851`) suppresses its `reportError` whenever `ctx.silent_refresh_had_refresh_token === false`, justified in-code (lines 1822-1835) as:

> `hadRefreshToken=false` → no refresh was even attempted (none stored). This is the "user must reconnect" terminal state, not a transient failure — the banner is the designed UX response and **there is no bug to investigate**.

That reasoning is false. The flag is _also_ false after Google revokes a token and the client correctly clears it. Concretely: `performSilentRefresh`'s permanent branch (`googleAuth.ts:1121-1126`) reports `hadRefreshToken: true` _on the first attempt only_ — it then nulls `currentRefreshToken` and calls `clearGoogleRefreshToken`. Every _subsequent_ refresh attempt this session (the `offline-queue-flush` path in greg's log) hits the `!currentRefreshToken` early return (`googleAuth.ts:1017-1027`), which reports `hadRefreshToken: false` — **byte-for-byte identical to a user who never connected Drive**. Every cold-start occurrence has therefore been console-only; only the first-attempt `offline-queue-flush` ever paged. The telemetry sample was biased, which is what produced the confidently-wrong 2026-07-08 triage note ("dead Google grants (testing-mode 7-day token expiry)") on an app that was verified and in production the entire time.

> **Correctness note (found in Pass 2):** because the token is _cleared from IDB_ on revoke, the two states cannot be distinguished by probing IDB for a stored token — after a revoke, IDB is as empty as it is for a never-connected user. The only reliable discriminator is a **session-scoped "a permanent failure has occurred" flag** inside `googleAuth`. An earlier draft of 1c ("suppress when no token was ever persisted for this family") would have re-hidden exactly this bug.

Meanwhile `performSilentRefresh` already computes `refreshTokenAgeMs` on the permanent-failure branch (`googleAuth.ts:1115-1116`), and `refresh_token_age_ms` is **already allowlisted** in `diagnosticContext.ts:97`. The one number that discriminates the surviving hypotheses is computed, permitted, and then thrown away by the suppression.

### A second, independently-proven bug

Greg's console log shows `googleAuth` attempting a refresh **exactly once** and short-circuiting on the permanent failure (correct). It then shows **hundreds** of `[oauthProxy] Token refresh failed: HTTP 400` lines whose stacks are all calendar operations (`eventExists`, `insertEvent`, `deleteEvent`).

`createGoogleTokenProvider.getAccessToken` (`googleCalendarClient.ts:100-133`) caches **only successes**. There is no negative cache and no in-flight dedupe, so every queued calendar operation independently calls `refreshCalendarToken` with the same dead token. One dead grant produces hundreds of Lambda calls per page load. `googleAuth` already solves this via `pendingSilentRefresh` (`googleAuth.ts:970-980`) plus a permanent-failure short-circuit; the calendar client never got either.

## Requirements

### Workstream 1 — Un-blind the telemetry (ships first, standalone)

1. Distinguish **"no refresh token was ever stored"** (genuinely by-design: user never connected Drive; nothing to report) from **"a refresh token existed and was cleared because Google rejected it"** (a real incident worth paging). Do not overload `hadRefreshToken` for both. The discriminator MUST survive the fact that the revoked token is cleared from IDB.
2. Emit `refresh_token_age_ms` on the revocation path so token lifetime is observable in Slack. This is the number that discriminates: consistent ~7 days ⇒ a clock; scattered ages ⇒ cap eviction; all tokens dying on one date ⇒ a Google-side security event.
3. Remove the `hadRefreshToken === false` blanket suppression in `scheduleColdStartReconnectEscalation`, replacing it with a suppression keyed on the _genuinely_ by-design case from (1).
4. Fix the silently-dropped context keys. `reportFlushFailure` (`offlineQueue.ts:200`) passes `consecutiveFailures` (camelCase) and `settleConnectionStatus` (`calendarSyncStore.ts:409`) passes `connectionId`; both are dropped by `ALLOWED_CONTEXT_KEYS` and log `[diagnosticContext] dropped non-allowlisted context key: …` on every occurrence. Stop passing them (the values are already in the respective message strings).

### Workstream 2 — Stop the calendar refresh storm (proven bug)

5. `createGoogleTokenProvider.getAccessToken` must deduplicate concurrent refreshes for the same `connectionId` (one in-flight promise, shared by all callers).
6. It must short-circuit on a permanent (`invalid_grant`) failure: once Google says the refresh token is dead, subsequent calls in the same session must fail fast **without** re-hitting the OAuth proxy.
7. **DRY (narrowed in Pass 2):** the _permanent-failure predicate_ is duplicated verbatim — `classifySilentRefreshError`'s `invalid_grant` / "Token has been expired or revoked" test (`googleAuth.ts:940`) and `isPermanentRefreshFailure` (`googleCalendarClient.ts:42-44`) are the same rule in two homes. Consolidate into **one exported predicate**. Do **not** rewrite `googleAuth`'s `pendingSilentRefresh` singleton onto a shared abstraction — it is an unkeyed singleton, the calendar case is per-connection keyed, they are different shapes, and it is pinned by tests (`isSilentRefreshPending()` contract). The in-flight dedupe + latch for the calendar provider is a small, self-contained addition to the provider's existing closure (it already owns a `Map` cache).
8. `settleConnectionStatus` (`calendarSyncStore.ts:388-418`) parks `needs_reconnect` only after `INVALID_GRANT_THRESHOLD = 2` consecutive failures, but every operation inside a single sync run fires its own refresh before any parking happens. One permanent auth failure must abort the remainder of that run.

### Workstream 3 — Recovery hardening (conditional; see Caveats)

9. When a grant dies, the user currently gets an hourly toast; if dismissed, nothing ever recovers. `refreshIfStale` (`googleAuth.ts:528-537`) early-returns on `!currentRefreshToken` rather than driving any recovery, and the offline-queue flush (`offlineQueue.ts` `tryFlush('visible')`, fired on bare `visibilitychange` → `visible`) awaits no auth initialization at all. Close the recovery gap without introducing a popup from a non-gesture context.

### Also in scope — documentation

10. Correct the 2026-07-08 note in `docs/STATUS.md` and `docs/plans/2026-07-08-calendar-auth-kind-and-resizeobserver-noise.md` that attributes these alerts to "dead Google grants (testing-mode 7-day token expiry)". The app was verified and `In production` throughout; that note is wrong and materially misdirected two sessions of investigation.
11. Add a `docs/lessons.md` entry on premature root-cause commitment (see below).

## Important Notes & Caveats

- **DO NOT "fix" the empty IndexedDB store.** It is correct behaviour — the client clears a token Google has declared dead.

- **DO NOT add token-revoke calls.** Google's revoke endpoint revokes the entire **grant**, not an individual token (`clearGoogleSessionState`, `googleAuth.ts:1344-1349`, fires `fetch(GOOGLE_REVOKE_URL?token=…)` whenever `preserveRefreshToken` is false). "Revoke the old token when minting a new one" would sign the user out of every device.

- **DO NOT remove `forceConsent: true` from the reconnect path.** The original scoping of this work proposed exactly that, and it is **wrong**. `useGoogleReconnect.ts` carries an explicit warning:

  > Force consent so Google re-issues a refresh_token. A stale stored token would make `!hasRefreshToken()` false → `prompt=select_account` → an access-token-only grant with no refresh token (the reconnect-every-launch bug).

  Removing it would resurrect a bug this code was written to fix. The same reasoning applies to `startRedirectAuth`'s unconditional `'consent'` (`googleAuth.ts:1760`, `:1776`) — the iOS/PWA path cannot afford an access-token-only grant. `useGoogleReconnect` already attempts `tryReconnectSilently(loginHint)` before falling through to forced consent, so the mint only happens when silent recovery has already failed.

  **If and only if** Workstream 1's telemetry shows scattered token ages consistent with cap eviction (hypothesis (a)) should token-minting frequency be revisited — and then the correct lever is reducing _unnecessary_ mints, not weakening consent.

- **Workstream 1 must not be gated behind 2 or 3.** It is what names the root cause. Ship it alone, first, and let it run.

- The `refresh_token_age_ms` value is `null` for legacy bare-string IDB entries and for tokens stored before `issuedAt` tracking existed. Treat `null` as "unknown age", not zero, and do not let a `null` masquerade as a fresh token in analysis.

- `ALLOWED_CONTEXT_KEYS` is **mirrored** in `infrastructure/lambda/telemetry/index.mjs` and pinned by a Lambda test (`diagnosticContext.ts:52-53`). **This plan requires no allowlist change** — the W1 discriminator reuses the already-allowlisted `error_code` key (confirmed unused on both the `cold-start-reconnect-escalation` and `offline-queue-flush` surfaces), and the two dropped keys (`consecutiveFailures`, `connectionId`) are _removed_, not allowlisted.

- **App-store declaration coupling:** `diagnosticContext.ts:55-59` states that fields transmitted here are declared to Apple and Google. Because W1 adds **no new field** (it reuses `error_code`), none of `docs/runbooks/native-store-submission.md`, `ios/App/App/PrivacyInfo.xcprivacy`, the store Data-Safety answers, or `web/src/pages/privacy.astro` needs to change. `refresh_token_age_ms` is already allowlisted and already declared.

- Do not alter `performSilentRefresh`'s 5-attempt retry budget or the `SILENT_REFRESH_FAILURE_ESCALATION_THRESHOLD = 2` escalation; a unit test pins `MAX_ATTEMPTS <= 5` deliberately (`googleAuth.ts:1040-1043`).

- The `correcting` guard and `armAccountSwitch` machinery in `googleAccountAssertion.ts` are **out of scope** — the assertion never fired in this incident. Do not touch it.

- **The `sawPermanentFailureThisSession` flag must be cleared on session teardown and family switch**, not just on success. A flag leaking across a sign-out or a family switch would page Slack for Family B's by-design "never connected Drive" state. See Approach 1a.

- **`invalidate` is NOT currently called on calendar reconnect** (its only call site is the 401 path, `googleCalendarClient.ts:211`). Adding the `dead` latch (2b) without wiring `invalidate` into the reconnect success path (2c) would leave calendar sync permanently bricked for the session after one revocation — worse than today's storm. These two must land together.

## Assumptions

> **Review these before implementation.** Valid at the time of planning (2026-07-09); may have changed.

1. The root cause remains unknown at implementation time. If Workstream 1 has already shipped and produced token-age data, re-scope Workstreams 2/3 against that evidence rather than this plan's speculation.
2. Greg re-consented on 2026-07-09 after re-adding the `drive.file` and `userinfo.email` scopes to the consent screen. That token's lifetime is a live experiment: death at ~7 days ⇒ a clock; death sooner and irregularly ⇒ cap eviction; survival ⇒ the scope re-registration mattered after all.
3. **Resolved 2026-07-09:** Greg has **not** changed his Google account password, eliminating the one-time-security-event hypothesis. Do not revive it without new evidence.
4. `drive.file` and `userinfo.email` were absent from the consent screen's registered scopes and were re-added on 2026-07-09. No "unverified app" warning appeared on re-consent, so this is believed _not_ to be the cause — but it was a real misconfiguration and is now corrected.
5. Calendar sync remains an optional feature that shares the Drive OAuth client.

## Approach

### Workstream 1 — Un-blind the telemetry

**1a. Introduce a precise diagnostic distinction backed by a session flag.** Add a module-level `sawPermanentFailureThisSession` boolean to `googleAuth`. Module-level mutable state is idiomatic here — `currentRefreshToken`, `currentFamilyId`, `sessionEpoch`, `pendingSilentRefresh`, and `lastSilentRefreshDiagnostics` are all module scalars in this file — so the mechanism is right, but **its reset points must be complete**:

- **Set** `true` the moment the permanent (`invalid_grant`) branch fires.
- **Clear** on any successful token acquisition (alongside line 1087's `lastSilentRefreshDiagnostics = null`).
- **Clear** in `clearGoogleSessionState()` and `revokeToken()` (session teardown, where `sessionEpoch++` already happens).
- **Clear** in `initializeAuth(familyId)` (family switch).

> **Found in Pass 3 — a false-positive bug in the Pass-2 draft.** With only the first two reset points, a `revoked` flag set while Family A was active would survive a sign-out or a family switch and mislabel Family B's genuinely by-design "no token stored" state as `revoked`, paging Slack for a non-incident. The teardown and family-switch resets are load-bearing, not defensive garnish.

Extend `SilentRefreshDiagnostics` with an explicit `reason` discriminator, set at the three sites that populate `lastSilentRefreshDiagnostics`:

- `googleAuth.ts:1021-1025` (the `!clientId || !currentRefreshToken` early return) → `reason: sawPermanentFailureThisSession ? 'revoked' : 'no-token-stored'`. **This is the fix for the week-long blindness**: after the first revoke clears the token, every later early-return is now correctly labelled `'revoked'` instead of masquerading as by-design.
- `googleAuth.ts:1121-1126` (the permanent `invalid_grant` branch, after `refreshTokenAgeMs` is captured) → `reason: 'revoked'` (and set the session flag).
- `googleAuth.ts:1156-1160` (retries exhausted) → `reason: 'exhausted'`.

Surface it through `buildSilentRefreshAlertContext` (`silentRefreshAlertContext.ts`) by mapping `diag?.reason` onto the **existing, already-allowlisted `error_code` key**. Confirmed in Pass 2 and re-verified in Pass 3: `error_code` is set by neither `buildSilentRefreshAlertContext` nor `enrichAndRedact` on these surfaces, so there is no collision, and **no `ALLOWED_CONTEXT_KEYS` / Lambda-mirror / app-store change is needed.**

`error_code` is, however, a _shared_ key across surfaces, so reusing it is a mild semantic overload. Two requirements make it sustainable rather than a trap for the next maintainer:

- **Self-describing values.** Emit namespaced strings — `silent-refresh:revoked`, `silent-refresh:no-token-stored`, `silent-refresh:exhausted` — never bare `revoked`. A future reader of a Slack payload (or of the Lambda) can then tell at a glance which producer set the key.
- **Document the reuse at both ends.** A comment on `SilentRefreshAlertContext.error_code` naming the alternative that was rejected (widening `ALLOWED_CONTEXT_KEYS` costs a three-place coupled change: the set, `infrastructure/lambda/telemetry/index.mjs`, and the app-store privacy declarations — real process friction for a PII-free fixed enum), and a pointer beside `ALLOWED_CONTEXT_KEYS`' `error_code` entry noting that the silent-refresh surfaces populate it.

**Error handling:** `reason` is a plain enum set on already-guarded code paths (no new I/O). The session flag is a module scalar — no failure surface. No try/catch needed; nothing here can throw that isn't already handled.

**1b. Ensure `refresh_token_age_ms` actually reaches Slack.** It is computed (`googleAuth.ts:1115-1116`) and allowlisted (`diagnosticContext.ts:97`); it is lost only because the report is suppressed. Once (1c) lands, verify end-to-end that a revocation produces a Slack alert carrying a non-null `refresh_token_age_ms`.

**1c. Replace the blanket suppression** in `scheduleColdStartReconnectEscalation` (`syncStore.ts:1828-1835`). Read the reason off the built context (`ctx.error_code`) and suppress **only** when `error_code === 'silent-refresh:no-token-stored'`; report for `'silent-refresh:revoked'` and `'silent-refresh:exhausted'`. (Use the namespaced values consistently at producer and consumer — a bare `'revoked'` anywhere is a bug.) Rewrite the misleading in-code comment; its claim that this state means "there is no bug to investigate" is precisely what hid this bug. No new failure surface — this is a branch-condition swap on an existing `reportError` call.

**1d. Remove the dropped context keys.**

- `offlineQueue.ts:200`: change `context: { ...context, consecutiveFailures: consecutiveFlushFailures }` to `context` (spread only). `consecutiveFlushFailures` is camelCase, not allowlisted, and already appears verbatim in the alert's `message` string (`(sustained ×${consecutiveFlushFailures})`, line 195) — dropping the redundant key loses nothing and silences the per-failure console warn.
- `calendarSyncStore.ts:409`: remove `context: { connectionId: connection.id }`. `connectionId` is not allowlisted (dropped-with-warn on every park); the id is device-local and useless in Slack. If correlation is ever wanted, append it to the `message` string instead — do not widen the allowlist.

### Workstream 2 — Stop the calendar refresh storm

**2a. Consolidate the one duplicated predicate.** Export a single `isPermanentRefreshFailure(errOrMsg): boolean` from a shared home (co-locate with the OAuth proxy in `oauthProxy.ts`, or a tiny `src/services/google/refreshFailure.ts`). Route both `classifySilentRefreshError` (`googleAuth.ts:940`) and the calendar provider through it, deleting the duplicate copy in `googleCalendarClient.ts:42-44`. One rule, one home — this is the genuine DRY target. **Do not** refactor `attemptSilentRefresh` / `pendingSilentRefresh`; its dedupe is a different (unkeyed-singleton) shape, works today, and is pinned by the `isSilentRefreshPending()` tests.

**2b. Add per-connection dedupe + a permanent-failure latch inside `createGoogleTokenProvider`.** The provider already closes over a `Map<string, CachedToken>` cache; add two siblings in the same closure — `inflight = new Map<string, Promise<string>>()` and `dead = new Map<string, CalendarApiError>()`. `getAccessToken(connectionId)`:

1. Serve a live cached token (unchanged).
2. If `dead.has(connectionId)` → **throw the latched `CalendarApiError('auth', …)` immediately, no network call.** `console.warn` the fast-fail with the latched reason so a developer sees why no request went out (no silent short-circuit).
3. If an in-flight promise exists for this key → await it (concurrent callers coalesce).
4. Otherwise start the refresh, store the promise in `inflight`, clear it in a `finally`. On a permanent classification (via the 2a predicate) record the classified error in `dead` before throwing; on any other failure do **not** latch (transient — must stay retryable).

This is ~15 lines local to the provider, no new module, no shared-abstraction risk. The three Maps (`cache`, `inflight`, `dead`) share one key space (`connectionId`), one per-key eviction (`invalidate`), and one whole-closure teardown (`resetCalendarClient()` at `calendarSyncStore.ts:702` drops the provider entirely on `stop()`). Growth is bounded by the number of calendar connections — **not** an unbounded-growth risk. Extend `invalidate(connectionId)` (currently `cache.delete(connectionId)`, `googleCalendarClient.ts:137`) to clear all three.

**2c. Wire `invalidate` into the reconnect path — this is a REQUIRED change, not a verification.**

> **Found in Pass 3 — the Pass-2 draft was wrong.** It asserted that "`reconnectCalendarConnection` already calls the provider's `invalidate`". It does not. `invalidate` has exactly **one** call site: the 401 handler at `googleCalendarClient.ts:211`. Nothing in `calendarSyncStore`'s reconnect flow touches it.

Without this, the `dead` latch introduced in 2b would **persist across a successful reconnect**, permanently bricking calendar sync for the session — a regression strictly worse than the storm it replaces. Add an explicit `tokenProvider.invalidate(connectionId)` (or a client-level `invalidateConnection`) to `reconnectCalendarConnection`'s success path, and cover it with the test in (4) below. Treat this as the single highest-risk line in Workstream 2.

**2d. Abort a sync run on the first permanent auth failure.** In `reconcileConnection` (`calendarSyncStore.ts:330-383`) the batch runs via `runPooled(tasks, MAX_INFLIGHT)`, which never aborts (each task self-catches into `errors`).

Note the ordering of value here: **the 2b latch already kills the network storm** — once `dead` is populated, every remaining task fails locally with no fetch. 2d is a secondary optimization that avoids doing pointless _local_ work, not the fix for the storm. Scope it accordingly and do not let it grow.

Prefer a `shouldAbort?: () => boolean` predicate parameter on `runPooled`, checked once before each task is dispatched, over smearing an `authAborted` early-return into the top of every task body. The predicate keeps the abort concern in the scheduler where it belongs, leaves the task bodies single-purpose, and is trivially unit-testable in isolation. Set the flag in the existing `catch` when the classified error's `kind === 'auth'`. `settleConnectionStatus` then runs unchanged, and the existing `INVALID_GRANT_THRESHOLD = 2` device-local parking semantics are preserved — this changes _how much work happens per run_, not when the connection parks.

If `runPooled` is shared with callers that must never abort, give the parameter a default of `() => false` so every existing call site is behaviourally untouched.

**Error handling / no silent failures (all of W2):** every fast-fail still returns the original classified `CalendarApiError('auth', …)`, so the reconcile engine's existing `auth` → `needs_reconnect` routing and `settleConnectionStatus`'s `calendar-sync` `reportError` are unchanged. The latch never swallows — it re-throws the recorded error and logs the fast-fail at `console.warn`. A non-permanent refresh failure is never latched, so a transient outage can still recover on the next poll.

### Workstream 3 — Recovery hardening

**3a. Do not auto-popup from a non-gesture context.** Any recovery that requires consent must be user-initiated. The existing `GoogleReconnectToast` (`src/components/google/GoogleReconnectToast.vue`) is the correct surface.

**3b. Make the toast durable rather than hourly.** When the reason is `silent-refresh:revoked`, the reconnect surface should persist until a successful token acquisition clears it — the `onTokenAcquired` self-heal at `syncStore.ts:2657-2673` already clears `showGoogleReconnect` via `handleGoogleReconnected()` on _any_ acquisition. Dismissal should not silently return the user to a state where nothing recovers.

> **Guardrail (found in Pass 4).** Key durability on **`showGoogleReconnect` itself** — do **not** introduce a parallel latch variable (`reconnectRequired`, `isGrantDead`, …). The self-heal only knows how to clear `showGoogleReconnect`; a second, parallel flag would survive a successful background silent refresh and strand a "reconnect" surface in front of a perfectly healthy connection. One flag, one owner, one clear path.

Exact UX to be confirmed against `.claude/skills/beanies-theme/SKILL.md` — this is a persistent, actionable state, not a transient toast, so a banner may be the correct component. **Any new or changed copy requires `uiStrings.ts` entries with `en` + `beanie` + `zh`.**

**3c. Gate the offline-queue flush on auth readiness.** The `visible`/`startup` triggers call `tryFlush(...)` → `flushQueue` → `flushProvider.write` → `getValidTokenSilent()` with no await on auth initialization. Await the existing non-throwing `whenRedirectAuthSettled()` (`googleAuth.ts:1919-1929`) in the `visible`/`startup` trigger handlers before dispatching the flush, mirroring the discipline `ace9c417` applied to the boot path. `whenRedirectAuthSettled` is reject-safe (it logs and resolves) with a 20 s `withTimeout`, so this is **latency-only** on a path that already tolerates failure and cannot deadlock.

### Deferred design decision — flag for Greg, do not implement

**Split Drive and Calendar onto separate OAuth clients.** Today one client, one grant: a consent-screen scope edit made for Calendar can take Drive persistence down for every user, and Calendar's verification state governs Drive's tokens. For a local-first product whose core promise is durable user-controlled storage, coupling core persistence to an optional feature's Google review status is a structural risk. This session produced direct evidence of the coupling (the `drive.file` scope disappeared from the consent screen; both tokens die together).

Cost: two client IDs, two consent flows, two stored refresh tokens, migration for existing users. **Not in this plan.** Raise as a separate decision once the root cause is known — if the cause turns out to be the shared grant, this becomes the fix rather than an improvement.

## Files Affected

**Workstream 1**

- `src/services/google/googleAuth.ts` — add `reason` to `SilentRefreshDiagnostics`; add module-level `sawPermanentFailureThisSession` (set on permanent branch, cleared on success/interactive re-auth); set `reason` at the three `lastSilentRefreshDiagnostics` assignment sites.
- `src/services/google/silentRefreshAlertContext.ts` — map `diag.reason` onto the existing `error_code` field.
- `src/stores/syncStore.ts` — replace the `hadRefreshToken === false` suppression in `scheduleColdStartReconnectEscalation` with `error_code === 'no-token-stored'`; rewrite the misleading comment.
- `src/services/sync/offlineQueue.ts` — drop the non-allowlisted `consecutiveFailures` context key.
- `src/stores/calendarSyncStore.ts` — drop the non-allowlisted `connectionId` context key at line 409.

**Workstream 2**

- `src/services/google/oauthProxy.ts` _(or new `src/services/google/refreshFailure.ts`)_ — single exported `isPermanentRefreshFailure` predicate.
- `src/services/google/googleAuth.ts` — route `classifySilentRefreshError` through the shared predicate (no dedupe refactor).
- `src/services/calendar/googleCalendarClient.ts` — delete the duplicate `isPermanentRefreshFailure`; add per-connection `inflight` + `dead` latch inside `createGoogleTokenProvider`; extend `invalidate` to clear both.
- `src/utils/calendar/runPooled.ts` — add an optional `shouldAbort?: () => boolean` (default `() => false`), checked before each task dispatch. Four existing call sites (`calendarSyncStore` ×3, `calendarClashStore` ×1) remain byte-identical.
- `src/stores/calendarSyncStore.ts` — abort the reconcile batch on the first `auth`-kind error via `shouldAbort`; **add** the missing `invalidate(connectionId)` call to the reconnect success path (it is currently only called from the 401 handler).

**Workstream 3**

- `src/services/sync/offlineQueue.ts` — await `whenRedirectAuthSettled()` before the `visible`/`startup` flush triggers.
- `src/stores/syncStore.ts` / `src/components/google/GoogleReconnectToast.vue` — durable reconnect surface.
- `src/services/translation/uiStrings.ts` — any new/changed copy (`en` + `beanie` + `zh`).

**Tests**

- `src/services/google/__tests__/googleAuth.*.test.ts` — `reason` discriminator set correctly at all three sites; `sawPermanentFailureThisSession` flips the early-return label from `'no-token-stored'` to `'revoked'` after a permanent failure, and clears on success; existing `isSilentRefreshPending`/`pendingSilentRefresh` tests still pass untouched.
- `src/services/calendar/__tests__/googleCalendarClient.test.ts` — one dead token ⇒ exactly one proxy call per connection per session; 20 concurrent `getAccessToken` ⇒ one `refreshCalendarToken`; latch clears after `invalidate`.
- `src/services/sync/__tests__/offlineQueue.test.ts` — context-key shape (no `consecutiveFailures`); auth-readiness gate awaits settle.
- `src/stores/__tests__/syncStore.bannerVisibility.test.ts` — `'revoked'` reports, `'no-token-stored'` stays silent.
- Shared-predicate test — `isPermanentRefreshFailure` matches `invalid_grant` and "expired or revoked", rejects transient messages.

**Docs**

- `docs/STATUS.md` — correct the 2026-07-08 "testing-mode 7-day token expiry" attribution.
- `docs/plans/2026-07-08-calendar-auth-kind-and-resizeobserver-noise.md` — annotate the Context section's superseded conclusion (do not rewrite history; append a correction note).
- `docs/lessons.md` — new entry (below).
- `CHANGELOG.md` — user-visible entries for the reconnect behaviour.

## Acceptance Criteria

- [ ] A revoked refresh token produces a Slack alert on the `cold-start-reconnect-escalation` surface carrying a non-null `refresh_token_age_ms` and `error_code: silent-refresh:revoked` — **including on the second and later refresh attempts of the session**, after the token has been cleared from IDB.
- [ ] A user who has never connected Drive produces **no** Slack alert on that surface (`error_code: silent-refresh:no-token-stored` stays silent).
- [ ] `[diagnosticContext] dropped non-allowlisted context key: consecutiveFailures` and `: connectionId` no longer appear in the console.
- [ ] With a dead refresh token and a queued calendar batch, exactly **one** `POST /oauth/google/refresh` is issued per connection per session (verified in the browser Network panel, and by unit test).
- [ ] A single permanent auth failure aborts the remainder of that connection's sync run.
- [ ] After a permanent failure, a sign-out or family switch resets `sawPermanentFailureThisSession`, so the next family's "no token stored" state stays silent (no false page).
- [ ] A successful calendar reconnect clears the `dead` latch — calendar sync resumes without a page reload.
- [ ] `error_code` values are namespaced (`silent-refresh:*`) and the reuse is documented at both `SilentRefreshAlertContext` and the `ALLOWED_CONTEXT_KEYS` entry.
- [ ] `runPooled`'s new `shouldAbort` predicate defaults to `() => false`; all existing call sites are behaviourally unchanged.
- [ ] `isSilentRefreshPending()` and the existing `pendingSilentRefresh` dedupe semantics are unchanged (no refactor; existing tests pass untouched).
- [ ] No `invalid_grant` predicate duplication remains — one exported predicate, one home; both call sites consume it.
- [ ] `ALLOWED_CONTEXT_KEYS` is **unchanged** (no Lambda-mirror or app-store-declaration change is required by this plan).
- [ ] No new hardcoded user-visible strings; every new key has `en` + `beanie` + `zh`.
- [ ] Every new failure surface (calendar fast-fail, batch abort) logs to console; nothing short-circuits silently.
- [ ] `npm run type-check`, `npm run lint`, and the full unit suite pass.
- [ ] `docs/STATUS.md` and the 2026-07-08 plan carry the corrected attribution.
- [ ] `docs/lessons.md` carries the premature-root-cause entry.

## Testing Plan

1. **Unit — telemetry discrimination.** Simulate `performSilentRefresh` with (a) no stored token and no prior permanent failure → `reason: 'no-token-stored'`; (b) an `invalid_grant` rejection → `reason: 'revoked'`, `refreshTokenAgeMs` populated; (c) a _second_ call after (b), with token now cleared → early return still yields `reason: 'revoked'` (session flag); (d) exhausted retries → `reason: 'exhausted'`.
2. **Unit — suppression.** `scheduleColdStartReconnectEscalation` reports on `error_code` `'revoked'` / `'exhausted'` and stays silent on `'no-token-stored'`.
3. **Unit — calendar single-flight.** With a mocked `refreshCalendarToken` that rejects `invalid_grant`, drive 20 concurrent `getAccessToken(connectionId)` calls; assert `refreshCalendarToken` was called **once** and all 20 reject with `CalendarApiError('auth', …)`.
4. **Unit — latch clearing (regression guard).** After a _successful `reconnectCalendarConnection`_, the next `getAccessToken` performs a real refresh. Assert against the reconnect flow, not against `invalidate` directly — the whole risk is that reconnect forgets to call it.
5. **Unit — transient not latched.** A transient refresh failure does **not** populate `dead`; the next call retries for real.
6. **Unit — session-flag reset.** After a permanent failure, `clearGoogleSessionState()` / `revokeToken()` / `initializeAuth(otherFamilyId)` each reset `sawPermanentFailureThisSession`, so a subsequent no-token early-return reports `no-token-stored`, not `revoked`.
7. **Unit — `runPooled` default.** With no `shouldAbort` supplied, behaviour is byte-identical to today (all tasks run, each self-catches).
8. **Unit — sync-run abort.** A batch whose first op throws `auth` performs no further real work and settles `needs_reconnect` per the existing threshold.
9. **Unit — shared predicate.** `isPermanentRefreshFailure` covers `invalid_grant` / "expired or revoked" and rejects transient strings.
10. **Unit — regression.** Existing `offlineQueue`, `googleAuth` (incl. `isSilentRefreshPending`), and `syncStore.bannerVisibility` suites pass unmodified where behaviour is unchanged.
11. **Manual — the storm.** On an affected browser with a dead grant, load the app with the Network panel filtered to `oauth/google/refresh`. Before: hundreds. After: one per connection.
12. **Manual — calendar recovers.** After the storm fix, reconnect the calendar connection and confirm sync resumes **without a page reload** (guards the 2c latch-clearing risk in the real app, not just in a unit test).
13. **Manual — the measurement.** After Workstream 1 deploys, wait for the next revocation and read `refresh_token_age_ms` from `#beanies-errors`. **This is the deliverable that names the root cause.** Record the value in `docs/STATUS.md`.
14. **Manual — no regression in reconnect.** Click the reconnect toast; confirm consent is still forced, a refresh token is minted and persisted (`googleRefreshToken-<familyId>` reappears in `beanies-file-handles`/`handles`), and the toast clears.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted three workstreams from the session's investigation; corrected the incoming scope by dropping the "remove `forceConsent`" item after `useGoogleReconnect.ts` was found to warn against exactly that, and by noting `refresh_token_age_ms` is already allowlisted.
- **Pass 2 (DRY + error handling)**: Verified every reuse claim against source. Corrected a latent correctness bug in 1a/1c (the revoked token is cleared from IDB, so "no token ever persisted" cannot distinguish revoked-vs-never-connected — replaced the IDB probe with a session-scoped `sawPermanentFailureThisSession` flag). Narrowed the DRY target from a speculative `refreshCoordinator.ts` to the one genuinely-duplicated predicate, keeping `googleAuth`'s test-pinned `pendingSilentRefresh` singleton untouched. Moved the calendar dedupe + latch inline into the provider's existing closure. Pinned the discriminator to the already-allowlisted `error_code` key so no allowlist / Lambda-mirror / app-store change is needed. Made 1d and 2d concrete; added no-silent-failure logging requirements to every new fast-fail path.
- **Pass 3 (Sustainability)**: Caught a **false-positive bug**: `sawPermanentFailureThisSession` reset only on success would leak a `revoked` flag across sign-out and family switch, paging Slack for the next family's by-design state — added teardown + `initializeAuth` reset points. Caught a **false claim**: `invalidate` is _not_ wired to calendar reconnect (its only call site is the 401 path), so shipping the `dead` latch without 2c would permanently brick calendar sync after one revocation — promoted 2c from "verify" to a required, test-guarded change. Kept the `error_code` reuse (widening the allowlist costs a 3-place coupled change for a PII-free enum) but required namespaced `silent-refresh:*` values plus documentation at both ends. Replaced the `authAborted` per-task smear with a `shouldAbort` predicate on `runPooled` (default `() => false`), and noted 2d is a local-work optimization — the 2b latch is what actually kills the network storm. Confirmed the three provider Maps are bounded by connection count and torn down by `resetCalendarClient()`.
- **Pass 4 (Fresh-eyes sweep)**: Verified all six load-bearing factual claims against source — all TRUE (`error_code` unused on both surfaces; `whenRedirectAuthSettled` is reject-safe with a 20 s bound and returns `null` immediately when no redirect is in flight, so the flush gate is genuinely latency-free in the common case; `resetCalendarClient()` nulls `clientImpl` so all three provider Maps are rebuilt; `runPooled` lives at `src/utils/calendar/runPooled.ts` with 4 call sites and takes a `shouldAbort` default cleanly; W1 shares no line with W2/W3 and ships alone). Added a **3b guardrail**: durability must key on `showGoogleReconnect` itself — a parallel latch variable would survive the `onTokenAcquired` self-heal and strand a reconnect prompt in front of a healthy connection. Reconciled plan-internal drift by using namespaced `silent-refresh:*` `error_code` values consistently at producer, consumer (1c), and acceptance criteria. Listed `runPooled.ts` in Files Affected.

## Lessons entry (to add to `docs/lessons.md`)

**Get the cheapest discriminating observation before proposing a mechanism.**

**Date:** 2026-07-09
**Context:** Investigating the Drive reconnect loop, five successive root causes were asserted with high confidence and each was refuted by one cheap observation: (1) "the worker migration wiped the token" — refuted by reading which IndexedDB databases the migration touches; (2) "an account-email mismatch wiped it" — refuted by one `grep` of the console log for `[accountAssertion]`, and built on a misread of `family_email` (the owner's profile email) as `googleAccountEmail`; (3) "Testing-mode 7-day expiry" — refuted by one glance at the publishing status; (4) "unapproved sensitive scope" — refuted by a tooltip on the console page; (5) "unregistered `drive.file` scope" — refuted by re-consenting and seeing no unverified-app warning. The prior session's `/error-review` made the same error, committing to "testing-mode 7-day token expiry" in `STATUS.md`, which then misdirected this session's opening hypothesis.

**Rule:** For a production incident, before proposing _any_ mechanism, enumerate the candidate causes and identify the single cheapest observation that distinguishes them — then get that observation. Prefer a `grep` of the user's log, a DevTools key lookup, or a console screenshot over a code-reading argument. State hypotheses as hypotheses with their discriminating test attached, never as conclusions. And when telemetry suppresses a signal "because it's by design", treat that suppression as a suspect, not a given — verify the suppression can actually tell the by-design case apart from the incident it would hide (here it could not: the revoked token is cleared, so the "no token stored" branch swallowed both).

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt

> There appears to have been a serious regression in persisting the connection to google drive, which has started happening in the past few days. It appears to be aligned to when we implemented the autoworker migration, or rouhgly around that time.
>
> Almost every time i open my app or open a beanies tab which was idle for a while (an hour, or sometimes less), I always see the orange toast "google session exspired: reconnect to keep saving". I'm seeing this constantly on all my open tabs and when i open the pwa after bneing idle for any period of time, and usually after deploys as well, but not sure if the deploy is the cause.
>
> I'm also seeing thie error message in slack from time to time:
>
> beanies error — critical / Family: Parker Meng Beanies (gparker97@gmail.com) · …fa046620 / Surface: offline-queue-flush / Time: 2026-07-09 13:41:12.530 UTC / Build: 8beab673dcfed941dc54ec6376ed5e17cb92b0fc / Message: flush rejected after visible (sustained ×2): Google access token expired and silent refresh failed
> Stack: TokenExpiredError … Context: silent_refresh_attempts: [], silent_refresh_had_refresh_token: false, silent_refresh_consecutive_failures: 0, page_hidden_for_ms: null, visibility_state: visible, refresh_token_age_ms: null, provider_type: google_drive, save_failure_level: warning, drive_file_not_found: false, online: true, connection_type: 4g, browser: Chrome/149 Windows, web_storage: ls=true,ss=true
>
> Google drive persisence was working very well for a long time before it started breaking again, and it took us a long time to get to a point where the connection was stable and the user was not forced to reconnect and re-consent constantly. this is a key usability issue that is top priority. please do a full investigation to understand if this bug was introduced at some point in the work that's been done in the past few days and how we can restore a stable googel drive connection that stays connected and silently reconnects wherever possible, such that the user never has to be bothered to re-consent once consent has been granted once.
>
> let me know if any questions then do a full investigation on how to resolve and fix this issue permanently to get us back to a stable state

### Follow-up 1 — IndexedDB contents

> I have a token refresh toast on one of my browsers now, and this is what i see under the "handles" key:
> `0  "providerConfig-ae92950b-68c7-462a-b5b9-5f98fa046620"  {type: 'google_drive', driveFileId: '1uKgSinpVah-rKQsMqIP_OcbwDA0WjUd0', driveFileName: 'Parker Meng Beanies.beanpod', driveAccountEmail: 'gregsophia@gmail.com'}`
> Here is the same key from a different tab: [identical]

### Follow-up 2 — how did the emails diverge

> how did i get into this state that the emails on my account are not matching? how did that happen in the first place?
> the correct member email should be gregsophia@gmail.com

### Follow-up 3 — console command failed

> Am I supposed to run the above commands on the devtools console on an affected beanies prod tab? i tried that but got the below: [`window.__pinia` undefined]

### Follow-up 4 — full console log

> I still have the console logs for this tab that is currently showing the reconnect toast … [full log: one `[googleAuth] Attempting silent token refresh (attempt 1/5)`, one `[oauthProxy] Token refresh failed: HTTP 400 — Token has been expired or revoked.`, one `[googleAuth] Silent refresh failed (permanent — refresh token revoked)`, then hundreds of `[oauthProxy] Token refresh failed` with calendar stacks (`eventExists`, `insertEvent`, `deleteEvent`); no `[accountAssertion]` line anywhere]

### Follow-up 5 — publishing status location

> where do i check the publishing status? I'm looking at APIs and Services -> Credentials and clicked on "beanies.family google drive integration" and on the overview page there is no section called publishing
> regarding question (2) i can confirm i see beanies/family under "linked apps"

### Follow-up 6 — audience

> Under Audience it says In Production, user type external oauth user cap 4 users / 100 cap

### Follow-up 7 — verification center

> Under verification center it says this: Branding status — Your branding has been verified and is being shown to users. Data access status — Your app's data access has been verified.

### Follow-up 8 — data access scopes

> Under data access i see this: [non-sensitive: `calendar.calendarlist.readonly`; sensitive: `calendar.events.owned` — "Approval required."; restricted: none]

### Follow-up 9 — scope is verified

> i dont' think that is correct because the sensitive scope actually has a green checkmark next to it that says "this scope is verified" on mouse-over. see screenshot /tmp/data-access.png

### Follow-up 10 — missing Drive scopes

> I'm pretty sure I used to see the google drive scopes here (i.e. drive.file) and I don't see them anymore, not sure why. where should i see those scopes? everything should be on the same account.
> is it possible those scopes were deleted (either by accident or maybe removed when the calendar scopes were requsted)? or am i just looking in the wrong place?

### Follow-up 11 — scopes re-added, no warning, proceed

> Ok, I've added those two scopes back to the page. it now reads: [non-sensitive: `calendar.calendarlist.readonly`, `userinfo.email`, `drive.file`]
> I don't know how or why they are gone, but if they were there before i've now re-added them. to answer your question, i clicked on the reconnect toast and i did not see a message that "google hasn't verified this app". but it reconnected as it usually does without any issues.
> i any case run those fixes proposed through /beanies-plan

### Follow-up 12 — password unchanged

> i haven't changed my google accont password

</details>
