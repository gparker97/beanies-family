# Plan: Google token churn — revoke-before-mint, self-healing recovery, and one unified reconnect consent

> Date: 2026-08-13
> Related issues: Notion tracker #62 (Beanies Main Issue Tracker)
> Plan file: `docs/plans/2026-08-13-google-token-churn-revoke-before-mint.md`
> Investigation: `docs/investigations/2026-08-13-google-token-churn-audit.md`

## User Story

As a heavy-but-ordinary beanies.family user signed in on a laptop tab plus Android and iOS, I want my Google connection to stay authorised across app opens — and, if it ever breaks, to heal itself and ask me to reconnect **once, for everything** — so that I am not forced through a full Google consent screen (twice, Drive then Calendar) on nearly every launch.

## Context

A confirmed production defect (Notion #62, full evidence in the investigation doc): the app **mints a new Google refresh token on every interactive (re)connect** and **never revokes the token it replaces**, on a **single OAuth client_id shared by both Drive and Calendar**. Google caps refresh tokens at **100 per Google account per client_id** and silently revokes the oldest (FIFO) when the 101st is minted. A heavy user therefore accumulates live tokens until Google starts evicting the _working_ one → `invalid_grant` ("Token has been expired or revoked") → forced re-consent → which mints yet another token → self-sustaining loop. Because Drive and Calendar are two independent grants, the user is prompted **twice**.

Confirmed in prod (CloudWatch `beanies-family-telemetry-prod`, one family, 72h): `auth-init` "no refresh token under family or pending key" ×13, `native-oauth` cycles ×24, Google "expired or revoked" ×5+, `offline-queue-flush` token-expired rejections ×21. Ruled out: PR #61/R10 (zero auth code; separate token DB), OAuth "Testing" 7-day expiry (app is "In production"), persistence bug (persist surfaces never fire), wake-listener/refresh-storm (correctly throttled).

**Root-cause fix:** make every reconnect **token-neutral** (revoke the stored token before minting its replacement) so the pool stops growing; **self-heal** users already at the cap without any manual Google-console action; and **unify** the Drive + Calendar reconnect into a single consent so one prompt restores both.

**Why no new client_id (decided with greg):** a separate Calendar client_id was considered (to stop the two features sharing one 100-token budget) but is **rejected**. Once revoke-before-mint removes the leak, a healthy account holds only a few tokens — the shared budget is a non-issue — and unification (one grant covering both) is the opposite, better direction. No new OAuth client, no re-verification.

**Confirmed load-bearing constraint (from `refreshFailure.ts`):** Drive and Calendar "share an OAuth client and therefore die together." Any revoke of a Drive _or_ Calendar token for a given Google account revokes the **whole grant** (Assumption 1, broad reading) — so it clears the other feature's token too. This single fact drives three of the corrections below: revoke must run **before** the consent that re-mints (never after — the codebase already warns of this), Calendar **disconnect** must not revoke a token whose grant a live Drive session still depends on, and the **unified consent** is the _natural_ completion because one consent legitimately restores both tokens that a single revoke took down together.

## Requirements

1. **Revoke-before-mint (Drive).** Before any interactive path _issues the consent that mints_ a replacement Drive refresh token, revoke the currently-stored Drive refresh token at Google's revoke endpoint, so the reconnect is net-zero on the token pool. The revoke is placed at the two consent-issuing seams (`performPopupAuth`, `startRedirectAuth`) _before_ the authorize request — not at the post-exchange persist chokepoint — because a revoke is whole-grant and would otherwise kill the token just minted (see Caveats). Gated to the `forceConsent`/`prompt=consent` case; silent-refresh and silent-auth-code commits are never revoked. The ~8 interactive entry points converge on these two seams.
2. **Revoke-before-mint (Calendar).** In `reconnect(connectionId)`, before the consent that overwrites `CalendarConnection.refreshToken` is issued, revoke the token being replaced. This lives in `reconnect()` _before_ `connectGoogleCalendar()`/`startCalendarRedirectAuth()`, not in `finalizeConnected()` (which runs after the token is already minted). On `disconnect`, revoke the token being removed **only when no live Drive grant shares the same Google account** — otherwise skip the revoke to preserve the still-live Drive session (`calendarAuth.ts` "die together" invariant). A skipped disconnect-revoke is logged, not silent, and the orphaned token is negligible against a bounded pool and Google's own inactivity expiry.
3. **Offline-durable revoke retry.** A revoke that fails (offline, transient network, Google 5xx) must not be silently dropped — it is queued and retried until it succeeds or is provably moot. The durable **contract** to follow is `services/sync/offlineQueue.ts`'s _trigger/coalescing model_ (`online`/`visible`/`token-acquired`/`startup` triggers, idempotent listener flag, coalescing guard) — **but the persistence tier is IndexedDB, not sessionStorage**: the queued items are live refresh-token _secrets_, which belong in the same IndexedDB tier the app already designates for tokens (`fileHandleStore`), never a weaker per-tab session store, and a must-eventually-land revoke must survive tab close (see Caveats). `logQueue.ts` is explicitly rejected (in-memory only, telemetry-about-telemetry, deliberately never persists). No bare best-effort `.catch(()=>{})` on a revoke.
4. **Stuck-user self-recovery — automatic, silent, prompt-on-failure.** On the already-classified permanent `invalid_grant`/revoked condition, the app automatically (a) revokes the current grant to drain the FIFO backlog and (b) attempts the **existing silent cross-device recovery** (`tryReconnectSilently`, which adopts a fresh doc-mirrored token another device may have already minted). It does **not** open an unsolicited popup or force a redirect — the codebase forbids background flows from triggering interactive Google UI. Only if silent recovery yields nothing does the user see the (unified) reconnect prompt.
5. **One unified reconnect consent for Drive + Calendar.** On the **reconnect** path only, when a family Calendar connection exists alongside Drive, a single consent requests the **union of scopes the user has already granted** and restores **both** connections from the one returned token — one prompt, not two. When only Drive is connected, behaviour is unchanged (Drive-only consent). Initial sign-in is unchanged (Drive-only; Calendar stays opt-in and is never forced at sign-in).
6. **Stop auto-force-consent on account mismatch.** The `googleAccountAssertion` mismatch handler must not silently mint a new token by auto-forcing consent; it surfaces a manual account-switch action instead (reusing the existing `showToast` + `armAccountSwitch` affordance already in that module).
7. **No new OAuth client_id / no Google re-verification.** Explicitly out of scope (see Context).
8. **Observability.** Every mint and revoke emits a structured lifecycle event (success and failure) so token pressure and revoke success-rate are measurable fleet-wide and the loop is diagnosable from CloudWatch alone.

## Important Notes & Caveats

> **Line numbers are indicative as of the plan date and have already drifted** in the ~2,200-line `googleAuth.ts` (e.g. `revokeToken` ~1357, `clearGoogleSessionState` ~1400, the epoch-discard access-token revokes ~170/207, permanent-failure classification ~1189-1213). **Locate every seam by symbol, not by the cited line** — symbols are stable, numbers are not.

- **Calendar is opt-in and feature-gated** (`googleCalendarSync` flag). The unified consent must union **only already-granted** scopes — a Drive-only user must **never** be shown the calendar consent screen. Never add calendar scope to initial sign-in.
- **Two different token-sharing models.** Drive refresh tokens live per-account in `driveConnections` (persisted via `driveRepository.upsertDriveConnection`, orchestrated by `driveTokenRecovery.ts`); Calendar refresh tokens live **family-wide** in `calendarConnections` inside the Automerge doc (synced to every device). The unified-consent completion handler must write the single returned token into **both** stores respecting each model (per-account Drive record + family-wide Calendar record). Do not collapse the two storage models into one — only the _consent_ is unified, not the persistence contract. To keep this boundary-crossing discoverable, **exactly one** dedicated function owns the two-store write (see Approach D); the stores call it, they do not each re-implement half of it.
- **Revoke-queue persistence tier is IndexedDB, not sessionStorage — a deliberate, security-driven divergence from `offlineQueue`.** Refresh tokens are already persisted in IndexedDB (`fileHandleStore.ts`, the `beanies-file-handles` DB via `idb`); sessionStorage holds only non-secret transients (the offline _content_ queue, the silent-refresh failure counter). Because a failed revoke must retain the **raw refresh-token value** (the old token is overwritten by the fresh mint, so it cannot be re-read from the store at drain time), the queue holds a live secret. It therefore persists in the IndexedDB tier — self-contained in its own small `idb` store (e.g. `beanies-revoke-queue`) so it neither version-bumps nor widens `fileHandleStore`'s schema — never in sessionStorage. This is both more secure (secret stays in the designated token tier, not a weaker per-tab surface) and more correct (a must-eventually-land revoke survives tab close; sessionStorage would silently drop it). `offlineQueue` remains the model for the _trigger/coalescing/idempotent-listener_ wiring only.
- **The Drive/Calendar auth boundary is intentional today** (`calendarAuth.ts`: "Connecting a calendar must NEVER disturb the Drive session"). Unification deliberately crosses it **only on the reconnect path** via one new dedicated completion handler — the independent connect/disconnect flows stay independent. The same invariant is exactly why Calendar _disconnect_ must not revoke a shared-account Drive grant (R2).
- **Revoke = whole grant (Google/RFC 7009), and the codebase already knows it.** `refreshFailure.ts` states Drive and Calendar "share an OAuth client and therefore die together." Revoking any token for a user+client revokes the entire authorization grant. This is what makes the unified consent the natural fix (one revoke drops both tokens; one consent restores both) and what makes self-recovery possible (revoke current grant → drain the FIFO pool). **It is also why every revoke-before-mint runs strictly before the consent request is issued** — a revoke _after_ the token exchange would kill the token we just minted.
- **Cancel-safety of the forceConsent seams.** Revoke-before-mint fires only on the `forceConsent`/`prompt=consent` seams, which are reached either after silent recovery already failed (dead token — nothing lost) or on an explicit user-initiated re-consent/account-switch (the user has already asked to replace the grant). No non-`forceConsent` or silent commit ever revokes. Confirm during implementation that no forceConsent path is reachable with a _healthy_ token a user would routinely cancel; if one exists it is acceptable (forceConsent means "replace this grant") but should be an intentional, reviewed seam.
- **One revoke helper, one concern (grant/refresh-token revokes).** The helper is the single place that revokes an _authorization grant_ via Google's public revoke endpoint. The two epoch-discard sites revoke short-lived **access** tokens on an already-torn-down session — a different concern — and are **explicitly left out** of the consolidation so the helper does not become a catch-all for two unrelated revoke semantics. Only the load-bearing grant-revoke sites (`revokeToken`, `clearGoogleSessionState`) refactor onto the helper.
- **Ordering hazard.** Four best-effort revoke sites exist today: `isSessionStillCurrent` and the `commitAcquiredToken` post-persist rollback (epoch-discard access-token revokes, out of scope per above), `revokeToken`, and `clearGoogleSessionState`. Revoke-before-mint must not double-revoke or race the sign-out revoke. Dedup is achieved by **one** mechanism — endpoint idempotency (a revoke of an already-dead token is a no-op success) — **not** a separate per-token "already handed to revoke" marker map (that would be parallel state to reap and a staleness/leak risk). The load-bearing refactors are `revokeToken` and `clearGoogleSessionState`.
- **iOS is live-only.** The redirect-consent paths can only be verified on the deployed build; sequence device verification after deploy.
- **Do not touch history compaction or #61 PR2** — unrelated levers.

## Assumptions

> **Review these before implementation.**

1. Google's revoke endpoint (`https://oauth2.googleapis.com/revoke`) revokes the whole grant for the user+client (RFC 7009 §2.1; Google web-server OAuth docs; corroborated by `refreshFailure.ts`'s "die together" note). Both unified consent and self-recovery **depend on this breadth**; revoke-before-mint's placement (before consent) is dictated by it. The validation step (below) confirms breadth empirically. The fix still stops pool growth even under the narrow per-token reading — only the instant-reset property of self-recovery would degrade to healing-over-a-cycle.
2. The 100-token FIFO cap is per Google account per client_id (Google OAuth2 docs). Not relied on numerically — the fix removes the accumulation regardless of the exact number.
3. **(Resolved)** The revoke uses Google's **public** revoke endpoint directly with just the token — **no client_secret / no `oauthProxy` change**. The codebase already does this at four sites (in `googleAuth.ts`); the helper consolidates the two grant-revoke calls, so `oauthProxy.ts` is **not** in scope.
4. A single consent requesting the union of already-granted scopes returns one refresh token carrying all of them (standard Google incremental-auth behaviour).
5. The `offlineQueue.ts` **trigger/coalescing** pattern (idempotent listener, coalescing guard, `online`/`visible`/`startup`/`token-acquired` triggers) is the model to follow for revoke retries without a new sync abstraction — but its **sessionStorage** persistence is **not** adopted: the revoke queue holds live refresh-token secrets and so persists in the IndexedDB tier (`idb`, the same tier `fileHandleStore` uses for tokens), in its own small self-contained store. `logQueue.ts` is _not_ suitable — it holds its buffer in memory only and, by contract, never calls `logEvent`/`reportError` (loop avoidance), which the revoke helper must do. Note `offlineQueue` is **single-slot** (keeps only the latest Drive content); revoke retry needs a **set** of distinct tokens, so it is a sibling module following the same _trigger_ contract, not a caller of the same instance (see Approach A).

## Approach

Six coordinated changes, delivered in **one PR but as six self-contained, independently-revertable commits** (helper+queue → Drive revoke-before-mint → Calendar revoke-before-mint + disconnect guard → self-recovery → unified consent → account-mismatch). Given the blast radius — a ~2,200-line `googleAuth.ts` and a ~3,800-line `syncStore.ts` — commit-level separation means a regression in any one change can be reverted without unwinding the others. A single shared revoke helper underpins 1–4.

### A. One idempotent, offline-durable revoke helper (foundation for R1–R4)

Introduce a single revoke primitive — the one place that talks to Google's public revoke endpoint — used by every grant-revoke caller (revoke-before-mint, self-recovery, and the existing sign-out revokes, refactored to use it). Properties:

- **Idempotent:** revoking an absent/already-dead token resolves as success (Google returns 200 for an already-invalid token; treat network-confirmed "already invalid" as done). This idempotency **is** the dedup — no separate marker state.
- **Offline-durable:** on failure it enqueues the token for retry via a small dedicated **`revokeQueue.ts`** that follows the `offlineQueue.ts` _trigger_ contract (idempotent listener flag, coalescing guard, `online`/`visible`/`startup`/`token-acquired` triggers) but persists in its own small **IndexedDB** store (`idb`, the tier where refresh tokens already live), **not** sessionStorage — the queued items are live token secrets and must survive tab close. Because `offlineQueue` is single-slot (latest-content-wins) and revoke retry must hold a _set_ of distinct tokens, the queue is a **sibling module**, not a reuse of the same instance and not a speculative generic queue abstraction. Share the trigger/coalescing wiring **only if** it factors out cleanly into a tiny primitive; otherwise duplicate the ~10 lines of listener setup rather than force a premature generalization onto a proven single-purpose module. Never a bare `.catch(()=>{})`.
- **Structured outcome:** returns `{ ok, reason }` and emits the `google-token-lifecycle` event (below) via `logEvent`. Callers never swallow it.
- Reuses `refreshFailure.isPermanentRefreshFailure` where "is this token already dead" matters; no duplicated permanence logic.

Refactor the two existing best-effort **grant** revokes (`clearGoogleSessionState`, `revokeToken`) to call this helper so there is exactly one grant-revoke path (DRY). The two epoch-discard **access-token** revokes (in `isSessionStillCurrent` / the `commitAcquiredToken` rollback) are **left as-is** — folding a different revoke semantic into this helper would broaden its responsibility and couple two unrelated flows.

### B. Revoke-before-mint before every interactive consent (R1, R2)

_Placement is before the consent request, not at the post-exchange persist chokepoint._

- **Drive:** in the consent-issuing seams (`performPopupAuth`, `startRedirectAuth`), gated to `forceConsent`/`prompt=consent`, read the to-be-replaced stored token (`getGoogleRefreshToken(storageKey)`) and hand it to the revoke helper **before** building the authorize URL / issuing the redirect. This is DRY (two seams, not eight call sites) and safe under the whole-grant reading: the old grant is dropped, then the fresh consent mints its replacement. Do **not** revoke at `commitAcquiredToken` (that runs after the exchange — revoking there would kill the token just minted) and do **not** fire on silent/non-`forceConsent` commits.
- **Calendar:** in `calendarSyncStore.reconnect(connectionId)`, before `connectGoogleCalendar()`/`startCalendarRedirectAuth()`, revoke the existing connection's `refreshToken`. On `disconnect`/`finishDisconnect`, revoke the token being removed **only if no live Drive grant shares that Google account** (whole-grant safety — otherwise the Drive session dies with it); the skip is logged.

Double-revocation is prevented by the helper's idempotency (an already-revoked token is a no-op success), so the sign-out path and revoke-before-mint can both target the same token without a race and without any auxiliary marker.

### C. Automatic silent self-recovery, prompt-on-failure (R4)

Where the permanent failure is classified today (in `googleAuth.ts`, ahead of `firePermanentFailureCallbacks`), insert an automatic recovery attempt that **never opens interactive Google UI** (respecting the existing "background flows must not trigger interactive Google UI" guard):

1. Revoke the current (dead/duplicate) grant via the helper — drains the FIFO backlog (Assumption 1).
2. Attempt the **existing** silent cross-device recovery, `tryReconnectSilently` (`driveTokenRecovery.ts`), which adopts a fresh doc-mirrored token another device may have minted. No new silent path is written.
3. **On success:** clear the reconnect state; the user sees nothing. **On failure:** fall through to `firePermanentFailureCallbacks()` → the existing reconnect banner (today's behaviour) — never worse than the status quo.

Gated to one attempt per session via the module-local latch already present in `googleAuth` (`sawPermanentFailureThisSession`), **not** the account-assertion `correcting` flag (different module). Emits a `google-token-lifecycle` event (`trigger:'recovery'`) for both outcomes.

### D. Unified Drive+Calendar reconnect consent (R5)

On the **reconnect** path only:

1. Detect whether a family `CalendarConnection` exists (`calendarSyncStore.connections`).
2. If it does, build **one** authorize request whose scope = Drive scopes ∪ the connection's recorded `grantedScopes` (union of **already-granted** only), with the existing redirect/popup machinery (`buildAuthUrl` already accepts an arbitrary `scope` string — confirmed; `startRedirectAuth` already threads `opts.scope`).
3. A **single new dedicated completion handler** (in `calendarAuth.ts`) routes the single returned refresh token to **both** stores: `driveRepository.upsertDriveConnection(...)` (per-account) **and** `updateCalendarConnection(id, { refreshToken, grantedScopes, status:'ok', lastError:undefined })` (family-wide) + `getCalendarClient().invalidateConnection(id)` to clear the latched failure (mirrors `finalizeConnected`). This two-store write lives in exactly one place — the orchestrating stores call it, they do not each re-implement a half of it — so the intentional boundary-crossing is greppable and testable in isolation.
4. **UI — single source of truth.** Which reconnect prompt is active is decided by **one** derived selector in `syncStore` (e.g. `activeReconnectPrompt: 'unified' | 'drive' | 'calendar' | null`) rather than gating flags threaded independently through `App.vue` and both toast components. `App.vue` renders whichever the selector names; the toast components stay presentational (props only) and both continue to reuse the shared `ReconnectToast.vue`. One selector governing the choice removes the "both showed / neither showed" failure class by construction.
5. Drive-only users (no calendar connection) get exactly today's Drive-only reconnect. Initial sign-in unchanged.

### E. No auto-force-consent on account mismatch (R6)

In `googleAccountAssertion.ts`, replace the automatic `clearGoogleSessionState()` + `requestAccessToken({forceConsent:true})` with the module's already-present manual affordance: surface the account-mismatch `showToast` and route its action through `armAccountSwitch()`, so a background acquisition never silently mints a token. No new UI or helper — reuse what the switch flow already exposes.

### F. Revoke-breadth validation step (de-risks Assumption 1)

Before relying on instant self-recovery, run a one-off empirical check against a scratch Google account with multiple grants: revoke one token, confirm whether sibling grants for the same client are cleared. Record the result in the plan's Outcome / the investigation doc. Because revoke-before-mint is already placed _before_ consent (safe under either reading) and Calendar disconnect is guarded against killing Drive, the design is correct either way; this only decides whether recovery is instant vs. settles over a cycle.

## Files Affected

> Locate seams by symbol, not by any line number cited here — `googleAuth.ts` / `syncStore.ts` are large and the numbers drift between plan and implementation.

- `src/services/google/googleAuth.ts` — revoke-helper wiring; revoke-before-consent in `performPopupAuth`/`startRedirectAuth` (forceConsent-gated); automatic silent self-recovery ahead of `firePermanentFailureCallbacks`; unified-consent scope plumbing on the reconnect path; refactor the two existing grant-revoke fetches (`revokeToken`, `clearGoogleSessionState`) onto the helper (the two epoch-discard access-token revokes untouched).
- `src/services/google/googleRevoke.ts` _(new)_ — the single idempotent, offline-durable grant-revoke helper (public revoke endpoint; no proxy).
- `src/services/sync/revokeQueue.ts` _(new)_ — a small **IndexedDB-persisted** (`idb`, its own self-contained store) retry queue for failed revokes, following the `offlineQueue.ts` _trigger/coalescing_ contract (a set of tokens, not the single-slot content model). Persists in the IndexedDB tier — **not** sessionStorage — because the queued items are live refresh-token secrets and must survive tab close. `offlineQueue.ts` is the trigger reference, not a shared instance; factor a shared trigger primitive only if it is trivial.
- `src/services/sync/offlineQueue.ts` — trigger/coalescing contract reference only; not modified unless a trivial trigger primitive is cleanly extractable.
- `src/services/sync/fileHandleStore.ts` — reference for the IndexedDB (`idb`) tier where refresh tokens already live; the revoke queue matches this tier (own store, no schema/version change here).
- `src/services/google/refreshFailure.ts` — reuse existing permanent-failure classification (no duplication).
- `src/services/calendar/calendarAuth.ts` — the single new unified-reconnect completion handler (reconnect path only; sole owner of the two-store write).
- `src/services/calendar/googleCalendarClient.ts` — `invalidateConnection` use on unified restore.
- `src/services/auth/googleAccountAssertion.ts` — remove auto-force-consent; surface manual switch via existing `showToast`/`armAccountSwitch`.
- `src/stores/calendarSyncStore.ts` — revoke-before-consent in `reconnect`; guarded revoke in `disconnect`/`finishDisconnect`; calls the shared completion handler (no duplicate two-store logic).
- `src/stores/syncStore.ts` — reconnect orchestration + the single `activeReconnectPrompt` derived selector that governs which prompt shows.
- `src/services/automerge/repositories/driveRepository.ts` — `upsertDriveConnection` from the unified completion handler (this is where `upsertDriveConnection` lives; `driveTokenRecovery.ts` wraps it and hosts `tryReconnectSilently`).
- `src/services/google/driveTokenRecovery.ts` — reuse `tryReconnectSilently` in self-recovery.
- `src/composables/useGoogleReconnect.ts` — route the reconnect action through the unified flow when the selector says `unified`.
- `src/components/google/GoogleReconnectToast.vue`, `src/components/common/CalendarReconnectToast.vue`, `src/components/common/ReconnectToast.vue` — stay presentational (props only); no new component, no independent gating flags.
- `src/App.vue` — render whichever prompt `activeReconnectPrompt` names (the two toast render sites, driven by the one selector).
- Telemetry: **`src/utils/diagnosticContext.ts`** `ALLOWED_CONTEXT_KEYS` allowlist + its server-side Lambda mirror + store data-collection declarations if a new context key ships (see Observability).
- Tests: unit tests for the revoke helper (idempotency, offline queue), revoke-before-consent ordering, self-recovery success/failure branches, calendar-disconnect Drive-safety guard, the unified completion routing to both stores, and the `activeReconnectPrompt` selector.
- `docs/investigations/2026-08-13-google-token-churn-audit.md` — committed alongside (evidence record).

## Observability Coverage

- **New surface `google-token-lifecycle`** — emitted on **every mint and every revoke**, success _and_ failure, with structured `context`: `{ grant: 'drive'|'calendar', op: 'mint'|'revoke', outcome: 'ok'|'queued'|'failed', reason, trigger: 'reconnect'|'recovery'|'connect'|'signout'|'disconnect' }`. Success-path emission (below the `TELEMETRY_FLOOR_MS` floor if needed) makes token-pressure and revoke success-rate measurable fleet-wide — the basis for a future "reconnect rate climbing" alert.
- **Self-recovery** emits a `google-token-lifecycle` event with `trigger:'recovery'` and `outcome:'ok'|'failed'` so the heal rate is measurable; a **failed** auto-recovery that falls through to the manual prompt is a `warning` (handled, not data-loss).
- **Revoke queue** emits on enqueue and on drain (success/exhaustion) so a stuck revoke backlog is visible. A Calendar-disconnect revoke **skipped** to protect a live Drive grant emits `op:'revoke', outcome:'queued', reason:'skipped-shared-drive-grant'` (or an equivalent enum) — the skip is observable, never silent.
- **Severity:** none of these are `critical` (no user action fails / no data at risk — the app still functions, it just re-consents). Firehose `info`/`warning` only. Reserve any `critical` strictly for a genuine data-at-risk path if one emerges.
- **Existing signals preserved:** `auth-init`, `native-oauth`, `offline-queue-flush`, `silent-refresh-*` continue to fire; the fix is verified by these going quiet for a stable session.
- **Privacy/store gate:** the new `context` keys (`op`, `outcome`, `trigger`, `grant`) MUST be added to `ALLOWED_CONTEXT_KEYS` (**`src/utils/diagnosticContext.ts`**) and its server-side Lambda mirror, and declared in `docs/runbooks/native-store-submission.md` + consumers (`PrivacyInfo.xcprivacy`, Data-Safety/App-Privacy answers, `privacy.astro`). No token values, no PII — enum-valued keys only. (The revoke queue persists token values only client-side in the app's own IndexedDB tier; token values are never emitted in telemetry.)

## Acceptance Criteria

- [ ] Every interactive Drive/Calendar reconnect revokes the token it replaces **before** issuing the consent (verified: token count does not grow across repeated reconnects; the new token survives the reconnect).
- [ ] A revoke that fails offline is queued (IndexedDB-durable, survives tab close) and retried (verified: offline reconnect, close/reopen tab, then online → revoke lands).
- [ ] Calendar disconnect does **not** kill a live Drive session on the same Google account (verified: disconnect Calendar while Drive connected → Drive stays authorised; skip is logged).
- [ ] A user already at the cap recovers automatically and silently on the next open **without any unsolicited popup/redirect** (revoke + `tryReconnectSilently`); if silent recovery fails, the reconnect prompt appears (never a worse state than today).
- [ ] When both Drive and Calendar are connected, a session-expiry shows **one** reconnect prompt and one consent restores both.
- [ ] A Drive-only user is never shown the calendar consent screen; initial sign-in is unchanged.
- [ ] Account-mismatch no longer auto-forces consent; it surfaces a manual switch via the existing toast/`armAccountSwitch`.
- [ ] No new OAuth client_id introduced; no re-verification required; `oauthProxy` unchanged.
- [ ] CloudWatch `auth-init` "no refresh token" and "expired or revoked" go silent for a stable multi-surface session.
- [ ] Diagnostic logging in **Observability Coverage** implemented and verified (mint/revoke/recovery/skip events fire with the stated `surface`/`context`; failure modes triageable from CloudWatch without a local repro; new context keys allowlisted in `diagnosticContext.ts` + declared).
- [ ] Revoke-breadth validation run and its result recorded.

## Testing Plan

1. **Unit — revoke helper:** idempotent success on absent/dead token; offline failure enqueues to the IndexedDB-durable queue and the queued token survives a simulated tab-close/module-reload; queue drains on `online`; structured outcome + `logEvent` emitted.
2. **Unit — revoke-before-consent:** a `forceConsent` Drive mint revokes the prior stored token exactly once, _before_ the authorize URL is built; a silent/non-forceConsent commit does not revoke; sign-out path does not double-revoke (relies on helper idempotency, no marker state); calendar `reconnect` revokes prior token before consent.
3. **Unit — calendar disconnect safety:** disconnect with a live same-account Drive grant → revoke skipped + logged; disconnect with no Drive grant (or different account) → revoke fires.
4. **Unit — self-recovery:** permanent `invalid_grant` → auto revoke + `tryReconnectSilently` success → reconnect state cleared (success branch); silent recovery yields nothing → falls through to `firePermanentFailureCallbacks`/reconnect banner (failure branch); one-shot latch (`sawPermanentFailureThisSession`) prevents loops; **no interactive Google UI is invoked**.
5. **Unit — unified completion:** one returned token is written to both `driveConnections` (per-account, via `driveRepository.upsertDriveConnection`) and `calendarConnections` (family-wide) with correct `grantedScopes`, all through the single completion handler; Drive-only path unchanged; union never adds calendar scope for a Drive-only user.
6. **Unit — prompt selector:** `activeReconnectPrompt` returns `unified` when both connected, `drive` when Drive-only, `null` when neither — one prompt renders in each case (both/neither is unreachable).
7. **Manual (post-deploy, live):** on a real multi-surface account, reconnect repeatedly and confirm via CloudWatch that token pressure is flat and the loop is gone; confirm one prompt restores both; confirm silent self-recovery on a pre-seeded stuck account; confirm disconnecting Calendar leaves Drive live. iOS verified on the deployed build.
8. **Regression:** initial sign-in (Drive-only) unaffected; independent calendar connect/disconnect still works; trusted-device sign-out preserve path intact.
9. Full `npm run build` + type-check + lint + suite green.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the six-change approach (shared revoke helper, revoke-before-mint at the persist choke point, silent-with-fallback self-recovery, unified reconnect consent, no auto-force-consent, observability); dropped the separate-client_id idea per greg; single PR.
- **Pass 2 (DRY + error handling)**: Verified every reuse claim against the code and corrected: revoke-before-mint moved _before_ the consent seams (`performPopupAuth`/`startRedirectAuth`, forceConsent-gated) instead of the post-exchange `commitAcquiredToken` (whole-grant would kill the new token); added a Drive-safety guard so Calendar disconnect never revokes a shared-account live Drive grant; retargeted durable retry to the offline-queue pattern since `logQueue` is in-memory only and can't call `logEvent`; self-recovery restricted to `tryReconnectSilently` (no unsolicited popup/redirect per the interactive-UI guard) and latched via `sawPermanentFailureThisSession`; resolved revoke path to the public endpoint (no `oauthProxy` change) matching the four existing revoke sites; fixed ownership of `upsertDriveConnection` (`driveRepository.ts`) and `ALLOWED_CONTEXT_KEYS` (`diagnosticContext.ts`); reused the existing `showToast`/`armAccountSwitch` for R6.
- **Pass 3 (Sustainability)**: Cut incidental complexity/coupling: dropped the separate per-token "already handed to revoke" marker in favour of a single dedup mechanism (endpoint idempotency); scoped the revoke helper to grant revokes only, explicitly leaving the two access-token epoch-discard sites alone rather than conflating two revoke semantics; resolved the queue "either/or" to a dedicated `revokeQueue.ts` sibling (offlineQueue is single-slot and shouldn't be generalized speculatively); made one dedicated handler the sole owner of the unified two-store write; replaced the toast gating flags threaded across App.vue + both components with a single `activeReconnectPrompt` selector (removes the both/neither failure class); and specified the single PR as six independently-revertable commits to bound the blast radius across the ~2.2k-line auth module and ~3.8k-line store.
- **Pass 4 (Fresh-eyes sweep)**: Moved the revoke-retry queue off sessionStorage onto the **IndexedDB tier** (its own self-contained `idb` store, matching where refresh tokens already live in `fileHandleStore`) — it holds live token secrets, so a per-tab session tier was both a needless new security surface and less durable (lost on tab close); kept only offlineQueue's _trigger/coalescing_ contract. Added a cancel-safety caveat for the forceConsent seams and a standing note that cited line numbers are indicative-only and have drifted (locate seams by symbol). Propagated the persistence-tier correction through Requirement 3, Assumption 5, Approach A, Files Affected, Acceptance Criteria, and the Testing Plan (added a tab-close-survival assertion).

## Outcome

**Landed 2026-08-13 on `main` — the core fix (5 of the 6 changes). Commit 5 (unified consent) deliberately deferred to a focused follow-up (greg's call).**

Shipped as branch `google-token-churn-fix` (7 commits), verified green (type-check + lint + **4255 tests** + `npm run build`):

- **Revoke helper + IndexedDB revoke queue** (`googleRevoke.ts`, `revokeQueue.ts`) — idempotent, offline-durable, observable. Persisted in IndexedDB (not sessionStorage) per Pass 4.
- **Drive revoke-before-mint** at `performPopupAuth`/`startRedirectAuth` (forceConsent-gated, before consent); two sign-out grant-revokes routed through the helper; `google-token-lifecycle` mint telemetry.
- **Calendar revoke-before-mint** in `reconnect`; **Drive-safe guarded revoke** on disconnect (skip + `skipped` event when a live Drive grant shares the account).
- **Silent self-recovery** — placed in the syncStore `onTokenPermanentlyExpired` subscriber, **deferred a macrotask** (not inside `performSilentRefresh` as first sketched): the callback fires synchronously while `attemptSilentRefresh`'s dedup is held, so an inline `tryReconnectSilently` would deadlock. Banner shows only if recovery fails.
- **No auto-force-consent on account mismatch** — warn-once manual-switch toast instead; 5 tests updated.
- Telemetry allowlist (client + Lambda mirror) + store-declaration runbook updated for the 5 new PII-free enum keys.

**Two implementation-time discoveries the plan hadn't foreseen** (both fixed): a module init cycle `googleAuth → googleRevoke → revokeQueue → googleAuth` (broke it with a lazy `onTokenAcquired` import + fixed the telemetry import to the mockable index), and the self-recovery deadlock above.

**Deferred — Commit 5 (unified Drive+Calendar reconnect consent).** Reading the completion machinery showed it needs a new `unified` grant threaded through the popup **and** redirect **and** native-deep-link **and** resume paths, plus a completion handler crossing the intentional Drive/Calendar boundary — and it is iOS-live-only. Scoped to its own focused pass rather than rushed at the tail of this session. The `activeReconnectPrompt` selector + one-prompt gating go with it. Notion #62 stays **In Progress** until it lands.

**Not deployed.** Landed on `main`; deploy remains a manual, explicit step.

**Still open (greg):** the revoke-breadth validation (does one programmatic revoke clear sibling grants?) — the fix is correct either way; it only decides whether stuck-user recovery is instant vs. settles over a cycle.

## Prompt Log

> **No GitHub issue created** (per the Notion `github issue` = do-not-create directive). This plan is approved for direct implementation; full intake lives on Notion tracker #62.

<details>
<summary>Full prompt history</summary>

### Initial prompt (assembled by /beanies-pre-plan from Notion #62)

The full `=== BEANIES PRE-PLAN ===` block for #62 (Google refresh-token churn → forced re-consent on every app open), covering: root cause (mint-without-revoke on a shared client_id → Google 100-token FIFO cap → invalid_grant loop), the six scope items, out-of-scope (history compaction, #61 PR2, initial sign-in stays Drive-only), acceptance criteria, edge cases, reuse hints, references, and the three open questions. Directives: GitHub issue SKIP, Feature gate NO.

### Follow-up 1 — /beanies-plan decisions (AskUserQuestion)

- Stuck-user recovery UX → **Automatic + silent unless it fails**.
- Calendar client_id → greg: "why do we need a new client_id? my only question was whether we can have one prompt and consent process for both calendar and drive (if both exist) — why do we need a new oauth client and verification process?" → **separate client_id dropped**; unify consent instead.
- Delivery shape → **Single plan, single PR**.

</details>
