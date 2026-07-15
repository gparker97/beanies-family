# Investigation: native calendar reconnect fails with "Token exchange failed: Bad Request"

> Date: 2026-07-15
> Surface: native (Capacitor Android WebView). The defect is native-specific (never fires on desktop popup or web/PWA/iOS redirect).
> Status: read-only code-path investigation. No code changed.
> Related: ADR-026 (iOS redirect OAuth), ADR-029 (native App Link deep-link OAuth), `docs/investigations/2026-07-15-native-data-connection-loss.md` (sibling Drive data-loss bug — DISTINCT, see §2).

## TL;DR

On native Android, reconnecting the Google **Calendar** connection deterministically fails with:

> couldn't connect
> Could not complete the calendar connection: Token exchange failed: Bad Request

**Root cause (CONFIRMED by code): a `redirect_uri` mismatch on the native calendar token exchange.**
The native calendar auth request is built by `googleAuth` and uses the native App Link
`https://beanies.family/oauth/native`, but the token exchange in `calendarAuth` sends
`https://app.beanies.family/oauth/callback` — because `calendarAuth` has its **own,
non-native-aware** `getRedirectUri()`. Google's token endpoint requires the exchange `redirect_uri`
to byte-match the authorize request's, so it returns **HTTP 400**, which the OAuth proxy relays as
`Bad Request`. This is NOT the leading "PKCE verifier lost" hypothesis — the verifier is present and
correct on native; the mismatch alone guarantees the 400.

**Drive reconnect works on native** because Drive's exchange reuses `googleAuth`'s **native-aware**
`getRedirectUri()`, so both sides agree on `https://beanies.family/oauth/native`. Calendar simply
forgot to be native-aware. The fix is to make the calendar redirect exchange use the same single
source of truth `googleAuth` already owns (DRY — delete the duplicate).

**The "disconnected" state is token-expiry, not data-loss.** The `CalendarConnection` (including the
refresh token) lives in the durable, synced Automerge `.beanpod` doc, not in evictable IndexedDB, so
idle-eviction cannot drop it. It was parked `needs_reconnect` after repeated `invalid_grant` (Google
rejected the shared refresh token). The compounding failure: once the token lapsed, native reconnect
could **never** recover it because every native reconnect 400s — a permanent dead-end on native.

---

## 1. Root-cause hypotheses (ranked)

### #2 — `redirect_uri` mismatch on the native calendar exchange — CONFIRMED (root cause)

The native calendar redirect flow builds the authorize URL and the token exchange in **two different
modules with two different `getRedirectUri()` implementations**, and they disagree on native.

**Auth request side (native App Link):**

- `calendarSyncStore.reconnect()` → on a redirect surface calls
  `startCalendarRedirectAuth(...)` (`src/stores/calendarSyncStore.ts:781-787`).
- `startCalendarRedirectAuth` delegates to `startRedirectAuth(returnPath, loginHint, mode, {grant:'calendar', scope})`
  (`src/services/calendar/calendarAuth.ts:271-280`).
- `startRedirectAuth` native branch (`src/services/google/googleAuth.ts:1857-1881`) builds the URL via
  `buildAuthUrl(clientId, codeChallenge, 'consent', loginHint, state, scope)` (`:1877`).
- `buildAuthUrl` sets `redirect_uri: getRedirectUri()` (`src/services/google/googleAuth.ts:1586-1588`),
  and **googleAuth's** `getRedirectUri()` is native-aware:
  `if (isNative()) return NATIVE_REDIRECT_URI;` where
  `NATIVE_REDIRECT_URI = 'https://beanies.family/oauth/native'` (`googleAuth.ts:48`, `:421-427`).
- ⇒ authorize `redirect_uri = https://beanies.family/oauth/native`.

**Token exchange side (web callback path — the bug):**

- The deep-link handler parks the calendar code and navigates to the returnPath
  (`googleAuth.ts:2161-2165`), leaving the PKCE stash in place.
- The App-level resume runs `completeCalendarRedirectAuth()` → `doCompleteCalendarRedirectAuth()`
  (`calendarAuth.ts:302-388`).
- The exchange call passes `redirectUri: getRedirectUri()` (`calendarAuth.ts:355-360`), but this is
  **calendarAuth's LOCAL** `getRedirectUri()`, which is **not** native-aware:
  ``return `${window.location.origin}/oauth/callback`;`` (`calendarAuth.ts:96-98`).
- On native Android, `window.location.origin` is `https://app.beanies.family` (Capacitor config:
  `androidScheme: 'https'`, `hostname: 'app.beanies.family'` in `capacitor.config.*`).
- ⇒ exchange `redirect_uri = https://app.beanies.family/oauth/callback`.

**The two values differ in BOTH host and path:**

|      | authorize request | token exchange       |
| ---- | ----------------- | -------------------- |
| host | `beanies.family`  | `app.beanies.family` |
| path | `/oauth/native`   | `/oauth/callback`    |

Google's `/token` endpoint requires the exchange `redirect_uri` to exactly match the one used in the
authorize request (RFC 6749 §4.1.3). A mismatch returns **HTTP 400** (`invalid_grant` /
`redirect_uri_mismatch`). The proxy surfaces it: `oauthProxy.exchangeCodeForTokens` throws
`Token exchange failed: ${detail}` on `!res.ok` (`src/services/google/oauthProxy.ts:127-131`), where
`detail` is the proxy's relayed `Bad Request`. That bubbles into
`fail('exchange_failed', 'Could not complete the calendar connection: Token exchange failed: Bad Request')`
(`calendarAuth.ts:376-387`) → the toast the user saw.

**Why the other surfaces are fine (proving it's native-only):**

- **Desktop popup** (`connectGoogleCalendar`): the auth URL is built by `buildCalendarAuthUrl` using
  calendarAuth's own `getRedirectUri()` (`calendarAuth.ts:113-127`), and the exchange uses the same
  (`calendarAuth.ts:210-215`). Both = `${origin}/oauth/callback`. Internally consistent → works.
- **Web/PWA/iOS redirect**: `startRedirectAuth`'s web branch (`googleAuth.ts:1883-1894`) builds the URL
  with googleAuth's **non-native** `getRedirectUri()` = `${origin}/oauth/callback`; the exchange uses
  calendarAuth's `getRedirectUri()` = `${origin}/oauth/callback`. Both agree → works.
- **Native**: the ONLY surface where the auth URL (googleAuth, native → `/oauth/native`) and the
  exchange (calendarAuth, → `${origin}/oauth/callback`) diverge. Fails 100% of the time.

**Confirming observation (blind-triage):** the exact toast string
`Token exchange failed: Bad Request` on a native build with a calendar `calResume` in the URL is the
signature. A device/CloudWatch confirmation would be an HTTP-400 from `POST /oauth/google/token`
carrying `redirect_uri_mismatch`, but the code path is deterministic and needs no device logs.

### #1 — PKCE `code_verifier` lost across the native redirect — REFUTED

The native redirect keeps `sessionStorage` (the OS routes the verified App Link back into the **same**
WebView; native storage is NOT bounce-cleared — the whole Drive native flow depends on this and works):

- `startRedirectAuth` native branch stashes `{codeVerifier, returnPath, state, grant:'calendar'}` in
  `sessionStorage[REDIRECT_AUTH_KEY]` (`googleAuth.ts:1864-1876`).
- The deep-link handler for a calendar grant **deliberately leaves the stash in place** for the
  completion (`googleAuth.ts:2156-2165`; asserted by `googleAuth.calendarGrant.native.test.ts:110-111`).
- `doCompleteCalendarRedirectAuth` reads the verifier from that stash, gated on `grant==='calendar'`
  (`calendarAuth.ts:330-339`; asserted by `calendarRedirect.test.ts:105-121` — "native arm reads the
  PKCE verifier"). `oauthProxy` then sends `code_verifier` (`oauthProxy.ts:113-114`).

So the verifier IS present and IS sent on native. The 400 is not a missing/invalid verifier — it is
the `redirect_uri`. (Note: the unit tests assert `code` and `codeVerifier` but **never assert
`redirectUri`** — `calendarRedirect.test.ts:116-118` and the native test mock `exchangeCodeForTokens`
entirely — which is exactly why this bug shipped untested.)

### #4 — client_id / proxy PKCE-arm mismatch (native took the wrong arm) — REFUTED

Native correctly takes the WITH-verifier arm (stash present, `grant==='calendar'`), and the client_id
is the single `VITE_GOOGLE_CLIENT_ID` for both auth and exchange (`calendarAuth.ts:92-93`, `:349`,
`:355-360`). The confidential proxy adds `client_secret` server-side regardless. No arm/id mismatch.

### #3 — consumed / expired / double-redeemed authorization code — REFUTED

Double-redemption is guarded three ways: the per-page-load memo `calendarSettlePromise`
(`calendarAuth.ts:302-307`), the immediate `removeItem(CALENDAR_REDIRECT_CODE_KEY)` on entry
(`calendarAuth.ts:321-325`), and the resume watcher's `running` re-entrancy guard
(`useCalendarRedirectResume.ts:54-55,64-65`). The **first** exchange 400s, so this is not a
second-redeem. A stale/expired code would also surface a different Google error, not this deterministic
one. Not the cause.

### #5 — the silent no-verifier fall-through masks failures — CONFIRMED as a latent defect (not this incident's trigger)

`doCompleteCalendarRedirectAuth` falls through to a **no-verifier** exchange whenever the stash is
missing/unreadable/foreign (`calendarAuth.ts:340-347`). It did NOT fire here (the calendar stash was
present and readable). But it is a real trap: on native, the authorize request always sends a
`code_challenge` (`googleAuth.ts:1864-1877`), so a no-verifier exchange would 400 with the same
unhelpful "Bad Request". This path should detect "native + verifier expected but missing" and restart
consent with a clear message rather than firing a doomed exchange (see §3.3).

---

## 2. Is the disconnect data-loss or token-expiry? — TOKEN-EXPIRY (and a DISTINCT bug from the Drive loss)

**The `CalendarConnection` — including its `refreshToken` and `grantedScopes` — is durable.** It is
persisted through `createAutomergeRepository('calendarConnections')`
(`src/services/automerge/repositories/calendarRepository.ts:19-30`), i.e. it lives in the **Automerge
CRDT doc** that is the source of truth and is encrypted into the synced `.beanpod`. Connections are
family-wide and sync across devices (`calendarAuth.ts` header, `:18-20`). This is fundamentally
different from the Drive failure in the sibling investigation, where the lost `providerConfig-<familyId>`
record lived **only** in evictable IndexedDB (`beanies-file-handles`) with no durable fallback.

Therefore idle-storage eviction **cannot** drop the calendar connection or its token. What actually
happened:

- The connection is parked `needs_reconnect` by `settleConnectionStatus`
  (`calendarSyncStore.ts:590-624`) only after `INVALID_GRANT_THRESHOLD = 2`
  (`calendarSyncStore.ts:104-105`) **device-local consecutive `invalid_grant`** failures — i.e. Google
  rejected the shared refresh token (revocation, long inactivity, password change, or too many tokens).
  The shared token is deliberately NOT deleted (`:16-17,598`), only the status is parked.
- So "disconnected" = **the grant died and needs re-consent (token-expiry)**, not a lost record.

**Relationship to the Drive bug:** SIBLING SYMPTOM, DISTINCT MECHANISM.

- The Drive bug is IndexedDB data-loss of `providerConfig` (no durable fallback).
- The calendar disconnect is a lapsed OAuth grant on a durable record.
- The same idle episode plausibly surfaced several lapsed-auth states at once (Drive token + calendar
  grant both went stale), which is why they co-occurred — but the calendar record itself was never lost.
- The reconnect 400 (§1) is **entirely independent of both** — a deterministic native `redirect_uri`
  bug that would fail every native calendar reconnect regardless of how the disconnect arose. Its
  practical severity is amplified by the token-expiry: once the grant lapsed, native had **no working
  recovery path at all**.

**Confirm the hypotheses distinct: yes.** The calendar reconnect failure is a separate, standalone
defect from the Drive provider-config loss.

---

## 3. Fix design (design only — no code changed)

### 3.1 Primary fix — one native-aware `redirect_uri` (DRY: delete the duplicate)

`googleAuth` already documents that its `getRedirectUri()` is the single source of truth so that
"both buildAuthUrl and the token exchange call this, so they always agree (a mismatch ⇒
redirect_uri_mismatch)" (`googleAuth.ts:421-425`). The calendar layer violated this by re-deriving its
own web-only variant (`calendarAuth.ts:96-98`).

**Cleanest change:** export `getRedirectUri` from `googleAuth` and have `calendarAuth` use that single
helper everywhere it currently calls its local one — the redirect completion exchange
(`calendarAuth.ts:358`), the popup exchange (`calendarAuth.ts:213`), and the popup auth URL
(`buildCalendarAuthUrl`, `calendarAuth.ts:116`) — then delete calendarAuth's local `getRedirectUri`.

Safety across every surface after the change (googleAuth's `getRedirectUri` returns
`NATIVE_REDIRECT_URI` on native and `${origin}/oauth/callback` otherwise):

- **Native redirect**: auth = exchange = `https://beanies.family/oauth/native` → **fixed** (was the bug).
- **Desktop popup**: `isNative()` false → `${origin}/oauth/callback`, identical to today → unchanged.
- **Web/PWA/iOS redirect**: `${origin}/oauth/callback` on both sides, identical to today → unchanged.

This removes the divergent duplicate and makes calendar structurally match the Drive flow that already
survives the native round-trip. (There is no import-cycle risk: `calendarAuth` already imports
`startRedirectAuth`, `REDIRECT_AUTH_CODE_KEY_CALENDAR`, and `REDIRECT_AUTH_KEY` from `googleAuth` —
`calendarAuth.ts:28-32` — so importing one more exported function is free.)

**Registration check (verify, not code):** `https://beanies.family/oauth/native` is already a
registered redirect on the Web OAuth client (Drive native uses it per ADR-029), so no Google Cloud
console change is needed. Confirm `/.well-known/assetlinks.json` still routes it into the app.

### 3.2 Reuse the Drive redirect mechanism (already the pattern to mirror)

The fix is precisely "make calendar reuse what Drive does." Drive's `completeRedirectAuth` exchange
(`googleAuth.ts:1945-1950`) reads `redirectUri: getRedirectUri()` from the **native-aware** helper.
After §3.1, the calendar sibling completion uses the identical helper. No new mechanism — it collapses
calendar onto the tested Drive `redirect_uri` contract.

### 3.3 Graceful degradation (no raw "Bad Request" to the user; auto-recover)

Per the project's "no silent failures / only bother the user on a genuine failure" convention:

1. **Never fire a doomed exchange.** In `doCompleteCalendarRedirectAuth`, when running on native and
   the calendar stash / verifier is missing (the fall-through at `calendarAuth.ts:340-347`), do **not**
   exchange without a verifier (guaranteed 400). Instead return a new classified failure code
   (e.g. `verifier_lost`) that the resume treats as "restart consent," and breadcrumb it. On web the
   no-verifier arm stays valid (the confidential proxy secures the code) — gate the guard on
   `isNative()`.
2. **Friendly message + one clean retry.** Map an exchange failure at the resume layer
   (`useCalendarRedirectResume.ts:104-108`, `calendarSyncStore.resumeRedirectConnect`
   `calendarSyncStore.ts:802-809`) to a comforting toast ("Google couldn't finish connecting your
   calendar — let's try again") and, for `exchange_failed`/`verifier_lost`, offer/auto-trigger a single
   fresh `startCalendarRedirectAuth` rather than showing the raw proxy detail. Keep the connection in
   `needs_reconnect` (never data-destructive) so the bell/settings affordance persists if retry is
   declined.
3. **Keep the exchange-failure breadcrumb, enrich it.** The existing `reportError({surface:
'calendar-redirect-complete', severity:'warning', ...})` (`calendarAuth.ts:380-385`) stays, but add
   structured context (§4) so the next occurrence is diagnosable without a repro.

---

## 4. Observability Coverage

`surface` values are kebab-case and greppable; structured `context` (never string-interpolated).

- **Exchange request breadcrumb (the signal that would have caught this blind):** in
  `doCompleteCalendarRedirectAuth`, before the exchange, emit
  `logEvent({ level:'info', surface:'calendar-redirect-exchange', context:{ native: isNative(), redirect_uri_host, redirect_uri_path, had_verifier: boolean } })`.
  A single CloudWatch filter would have shown `redirect_uri_host=app.beanies.family` on native while
  the authorize side used `beanies.family` — the mismatch is visible without a device.
- **Enrich the existing failure event:** extend
  `reportError({ surface:'calendar-redirect-complete', ... })` (`calendarAuth.ts:380-385`) with
  `context:{ native, redirect_uri_host, redirect_uri_path, had_verifier, http_status, oauth_error }`
  (parse `http_status`/`oauth_error` from the thrown message or thread them out of `oauthProxy`). This
  turns "Bad Request" into "400 redirect_uri_mismatch, native, host=app.beanies.family".
- **Success path too (for rates, per Rule 6):** on a committed calendar reconnect emit
  `logEvent({ level:'info', surface:'calendar-redirect-exchange', context:{ outcome:'connected', native } })`
  so the native-vs-web reconnect **success rate** is measurable, not just failures.
- **Verifier-lost / restart:** when §3.3(1) fires, emit
  `logEvent({ level:'warn', surface:'calendar-redirect-verifier-lost', context:{ native, had_stash } })`
  and, on the auto-retry, `{ surface:'calendar-redirect-restart', context:{ trigger:'exchange_failed'|'verifier_lost' } }`.
- **Privacy + store-declaration gate:** the new context keys (`native`, `redirect_uri_host`,
  `redirect_uri_path`, `had_verifier`, `http_status`, `oauth_error`, `outcome`, `had_stash`, `trigger`)
  must be added to `ALLOWED_CONTEXT_KEYS` in `src/services/telemetry/logEvent.ts` AND the
  data-collection table in `docs/runbooks/native-store-submission.md` (+ `PrivacyInfo.xcprivacy`,
  Data-Safety answers, `privacy.astro`) before shipping. These are non-PII routing values — NEVER log
  the `code`, `code_verifier`, tokens, email, or `.beanpod` contents.

---

## Appendix — key file:line index

- Calendar redirect auth (bug home): `src/services/calendar/calendarAuth.ts`
  - local non-native `getRedirectUri()` (root cause): `:96-98`
  - popup auth URL uses it: `:116`; popup exchange uses it: `:213`
  - native/redirect completion exchange uses it: `:355-360` (redirect_uri source: `:358`)
  - PKCE verifier read from stash (proves #1 refuted): `:330-339`
  - no-verifier fall-through (latent #5): `:340-347`
  - failure classification + breadcrumb: `:376-387` (reportError `:380-385`)
  - memo / one-time-code guards: `:302-307`, `:321-325`
- Shared redirect transport: `src/services/google/googleAuth.ts`
  - native-aware `getRedirectUri()` (the single source of truth to reuse): `:421-427`;
    `NATIVE_REDIRECT_URI` `:48`
  - `buildAuthUrl` sets `redirect_uri` from it: `:1586-1588`
  - `startRedirectAuth` native branch (stash + auth URL): `:1857-1881`; web branch: `:1883-1894`
  - Drive `completeRedirectAuth` exchange (the working pattern): `:1945-1950`
  - native deep-link handler, calendar routing (leaves stash): `:2156-2165`
- OAuth proxy (400 → "Token exchange failed: Bad Request"): `src/services/google/oauthProxy.ts:93-139`
  (throw `:127-131`); verifier only sent when present `:113-114`
- Store: `src/stores/calendarSyncStore.ts` — `reconnect` `:775-793`, `resumeRedirectConnect` `:802-809`,
  `finalizeConnected` `:716-752`, `settleConnectionStatus`/`needs_reconnect` `:590-624`,
  `INVALID_GRANT_THRESHOLD` `:104-105`
- Resume watcher: `src/composables/useCalendarRedirectResume.ts:48-136` (toast/error mapping `:88-121`)
- Native completion wiring: `src/App.vue:1259-1260` (`installNativeAuthListener(returnPath ⇒ router.replace)`),
  `:1277` (`useCalendarRedirectResume()`)
- Connection persistence (durable, in the doc): `src/services/automerge/repositories/calendarRepository.ts:19-30`
- Capacitor origin: `capacitor.config.*` — `androidScheme: 'https'`, `hostname: 'app.beanies.family'`
- Tests that missed it (assert code+verifier, never redirect_uri):
`src/services/calendar/__tests__/calendarRedirect.test.ts:105-121`,
`src/services/google/__tests__/googleAuth.calendarGrant.native.test.ts:88-112`
</content>

</invoke>
