# Investigation: Google refresh-token churn → forced re-consent on every open

> Date: 2026-08-13
> Surface(s): `auth-init`, `native-oauth`, `offline-queue-flush`, `calendar-clash`, `calendar-sync`
> Affected family (prod, at time of writing): `ae92950b-…-fa046620` (greg's own — the only family exhibiting the loop)
> Related: ADR-024 (join-flow error registry), ADR-029 (native OAuth), ADR-031 (trusted-device sign-out), ADR-033 (never-fork-a-pod)
> Status: audit complete → feeds tracker issue (Google token churn: revoke-before-mint + unify Drive/Calendar reconnect)

## Symptom

A heavy-but-ordinary user (laptop Chrome tab kept open + Android app + iOS app, used normally for one family) is forced through a **full Google `prompt=consent` sign-in on essentially every app open**, across **all three surfaces**, and sees **two separate reconnect prompts** — one for Drive, one for Calendar. Google's own error text in the logs: `Token has been expired or revoked` (`invalid_grant`).

This is **not** a testing artifact and **not** caused by PR #61 / R10 (see "Ruled out"). It is a latent product defect that will reach any user who connects Calendar and reconnects a handful of times.

## Evidence (CloudWatch `beanies-family-telemetry-prod`)

Over 72h, with essentially one active family:

| Signal                                                            | Count / 72h | Meaning                                                             |
| ----------------------------------------------------------------- | ----------- | ------------------------------------------------------------------- |
| `auth-init` "no refresh token under family or pending key"        | 13          | cold starts with an **empty** token store → forced interactive auth |
| `native-oauth` (start→return→complete cycles)                     | 24          | several **forced full re-consents per day** for one user            |
| `offline-queue-flush` (token-expired rejections)                  | 21          | writes blocked because the access token could not be refreshed      |
| Google `"expired or revoked"` text (Drive **and** calendar paths) | 5+          | Google revoking the refresh token server-side                       |
| `calendar-clash` / `calendar-sync` failures                       | 19          | Calendar failing/refreshing on its **own** independent track        |

Two failure surfaces that would indicate a _persistence_ bug — `refresh-token-persist` (store failed) and `auth-no-refresh-token` (Google returned no refresh token) — **never fire**. So the token **is** written successfully and Google **does** return one. The token is minted and stored, then **revoked by Google before the next open**, then cleared by the client (`googleAuth.ts:1204`), leaving the next launch empty.

## Root cause

Google enforces **100 refresh tokens per Google account per OAuth client_id**; minting the 101st **silently revokes the oldest (FIFO)** ([Google OAuth2 docs](https://developers.google.com/identity/protocols/oauth2)). The only operation that consumes this budget is **minting a new refresh token** — a `prompt=consent` + `access_type=offline` authorization-code exchange. `grant_type=refresh_token` (silent refresh, calendar access-token minting) does **not** consume it.

The app **mints new refresh tokens continuously and never revokes the ones it replaces**, on a **single shared `client_id`** for both Drive and Calendar. A heavy user therefore accumulates live tokens until Google's FIFO starts evicting the _working_ ones — which forces a reconnect, which mints another, which evicts another. Self-sustaining.

### The amplifier: one `client_id`, two grants

Drive and Calendar are two independent OAuth grants (separate scopes, separate refresh tokens, separate stores, separate reconnect toasts) but both read `VITE_GOOGLE_CLIENT_ID` (`googleAuth.ts:428`, `calendarAuth.ts:109`). They draw from the **same** 100-token pool, so a user with both connected churns it ~2× as fast.

### Ranked contributors (from code audit)

1. **Calendar (re)connect mints a new refresh token and never revokes the old one** — `calendarSyncStore.ts:741-748` (`finalizeConnected`), `:775-793` (`reconnect`), `:814-844` (`disconnect`). The previous `CalendarConnection.refreshToken` is overwritten locally but left **live at Google**. Pure leak, +1 per reconnect, family-wide.
2. **Every interactive Drive reconnect forces `prompt=consent` → new token every time; on all mobile it is unconditional.** `startRedirectAuth` hardcodes `prompt=consent` on native (`googleAuth.ts:1900`) and web-redirect (`:1926`) — no `prompt=none`/silent redirect path exists. ~8 distinct call sites converge here (`useGoogleReconnect.ts:42/51`, `googleDriveProvider.reconnect:447`, `usePickBeanpodFile.ts:87/93`, `connectStorage.ts:80/164`, `SettingsPage.vue:345/352`, `syncStore.listGoogleDriveFiles:3416`, `useJoinFlow.ts:473/623/660`, account-assertion). None revoke the token being replaced.
3. **Account-assertion auto-forces consent on an email mismatch — no user gesture.** `googleAccountAssertion.ts:159-171` runs after _every_ token acquisition (incl. silent refresh); on a mismatch it calls `clearGoogleSessionState()` then `requestAccessToken({forceConsent:true})`. A stale/mismatched stored email re-arms this every session. (Observed here: file bound to `beanies.demo@gmail.com`, some sessions signed in as `gregsophia@gmail.com`.)
4. **Trusted-device sign-out preserves the grant without revoking** (`authStore.ts:1303`, `googleAuth.ts:1439-1443`, ADR-031). A later interactive reconnect then mints while the preserved token is still live → +1 leak.
5. **Best-effort revokes silently fail** (`clearGoogleSessionState:1440`, `revokeToken:1368`, `.catch(()=>{})`). Offline → token cleared locally but stays live at Google.
6. **`attemptSilentAuthCode` (`prompt=none`)** can mint a refresh token silently as a generic fallback (`googleAuth.ts:746-848`).

### Abuse-heuristic risk (independent second path to revocation)

**No cross-tab/cross-device lock on refresh.** Dedup is per-JS-context only (`googleAuth pendingSilentRefresh`, calendar `inflight` map). Multiple desktop tabs + mobile apps refresh the **same** refresh token concurrently — and the calendar connection is **family-wide**, so every family device mints from the _same_ shared calendar refresh token every poll (5-min reconcile, ~1 access-token mint/hour/connection). Simultaneous use of one refresh token from many clients is a classic Google abuse signal that can revoke the grant outright.

## Ruled out (with evidence)

- **PR #61 / R10** — its entire diff is open-cycle telemetry + `changed`/`dirty` gating; **zero** auth code. The refresh-token store (`beanies-file-handles` DB + `beanies_grt_` localStorage) is a **different database** from the ephemeral cache the snapshot work touches; `clearCache` never touches tokens.
- **OAuth "Testing" 7-day expiry** — consent screen is confirmed **"In production"**.
- **Persistence bug** — the persist/no-token failure surfaces never fire; the token is written and returned.
- **Wake-listener refresh storm** — `refreshIfStale` early-returns unless within 120s of expiry (`googleAuth.ts:563`), so an always-open tab still only refreshes ~once/hour. The expiry guard _is_ the throttle; correctly bounded.
- **Silent-refresh retry storm** — bounded to ≤5 attempts / ~22.5s, and uses `grant_type=refresh_token` (mints nothing). Escalation only shows the banner; it does not auto-mint.

## Can it self-heal without manual console action? — Yes (this was an explicit requirement)

**Prevention is complete and provable.** With **revoke-before-mint**, every reconnect becomes token-neutral (revoke the stored token, then mint its replacement — count goes 99→100, never exceeding the cap), so the pool stops growing. The loop is _driven by growth_; once growth stops, no device's working token is FIFO-evicted, and the forced-reconnect loop ends. The one normal reconnect a stuck user does after the fix lands becomes their last.

**Recovery of already-accumulated tokens is achievable in-app**, because Google's revoke endpoint **revokes the entire authorization grant**, not a single token ([RFC 7009 §2.1](https://www.rfc-editor.org/rfc/rfc7009.html); [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)). So on detecting the `invalid_grant`/revoked condition the app already classifies, it can **programmatically revoke the current grant, then run one clean consent** — dropping the user from ~100 tokens to exactly 1, with **no visit to the Google console**.

**Belt-and-suspenders even in the narrowest reading:** any orphaned tokens the app can't reference are auto-expired by Google after **6 months of disuse** for a production app, and — more importantly — stopping growth already breaks the live loop. Manual console revocation remains a _fast optional shortcut_, never a hard requirement.

> Design-validation step for the plan: empirically confirm the breadth of a single programmatic revoke against a scratch account holding multiple grants (does it clear siblings, or only the revoked consent's tokens?). The fix does not depend on the broad reading — but if confirmed broad, the stuck-user "reset" is instant rather than settle-over-a-cycle.
>
> **RESULT 2026-08-13 — BROAD.** `scripts/revoke-breadth-check.mjs` against the real client: revoking one refresh token returned `invalid_grant` on a _separate_ sibling token. Revoke kills the whole (user, client) grant ("die together"). Consequences (see the plan's Outcome): revoke-before-mint is required, the Drive-safety guards are essential, and the durable revoke queue was **removed** (a deferred retry would kill the current grant) in favour of immediate best-effort revoke.

## Proposed fixes (for the plan)

1. **Revoke-before-mint (primary).** Before minting a replacement Drive **or** Calendar refresh token, revoke the previously-stored one at Google's revoke endpoint. Applies to all ~8 reconnect paths + calendar `finalizeConnected`/`reconnect`/`disconnect`.
2. **Offline-durable revoke queue.** Retry failed revokes (offline-aware, like `logQueue`) so a revoke that fails offline still lands.
3. **Stuck-user auto-recovery.** On the classified `invalid_grant`/revoked condition, revoke the current grant then perform a single clean consent — no manual action.
4. **Split Calendar onto its own `client_id`** so the two features stop sharing one 100-token budget.
5. **Unify the two reconnect prompts into one consent (reconnect path only).** Detect an existing `CalendarConnection`; if present, issue **one** authorize request unioning **only already-granted** scopes (Drive-only users are never forced into calendar consent), and fan the single returned refresh token into both `driveConnections` and `calendarConnections`. Initial sign-in stays Drive-only. Requires one new completion handler that crosses the currently-intentional Drive/Calendar boundary (`calendarAuth.ts:5-8`).
6. **Stop auto-force-consenting on account mismatch** (`googleAccountAssertion.ts:159`) — surface a manual switch prompt instead of a silent mint.
7. **(Consider) cross-device refresh coordination** for the family-wide calendar token to reduce the concurrent-same-token abuse signal.

## Observability coverage (for the plan)

- Emit a structured `token-mint` / `token-revoke` counter pair (surface `google-token-lifecycle`) on **both** the success and failure paths, carrying `{ grant: 'drive'|'calendar', reason, revoke_ok }`, so the live-token pressure and the revoke success-rate are measurable fleet-wide (not just on failure) — this is what makes an alert on "reconnect rate climbing" possible.
- Any new context keys go through the `diagnosticContext.ts` allowlist **and** its Lambda mirror (drafted keys are silently stripped server-side otherwise — a trap hit during #61) + the store-declaration table.
