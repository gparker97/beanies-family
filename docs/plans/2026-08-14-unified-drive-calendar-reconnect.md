# Plan: Unify the Drive + Calendar reconnect into one consent (tracker #62, commit 5)

> Date: 2026-08-14
> Related issues: Tracker #62 (Google token churn) — commit 5 (final follow-up). None on GitHub — direct implementation.
> Plan file: `docs/plans/2026-08-14-unified-drive-calendar-reconnect.md`

## User Story

As a beanies.family user who has both Google Drive (my family data file) and Google Calendar connected, when my Google connection lapses I want to reconnect **once** — one prompt, one Google screen — instead of being pestered by two separate toasts and forced through two consent round-trips, so that recovering from a lost connection is a single calm action.

## Context

Under the #62 fixes now live in 0.9.10R2, **revoke-breadth is BROAD**: Drive and Calendar share a single OAuth `client_id`, and Google's revoke is whole-grant, so when a grant dies the user typically loses **both** Drive and Calendar at once. Today that surfaces as **two independent reconnect toasts** stacked in the same corner (`GoogleReconnectToast` + `CalendarReconnectToast`, both mounted in `App.vue`), and reconnecting means **two separate Google consent round-trips**. greg (an active user across several devices) confirms he is "always being pestered with 2 things to reconnect."

The mechanism never required two round-trips: a single OAuth client with incremental scopes can restore both grants in one consent. This plan unifies the **reconnect action** (one consent, one prompt) while keeping Drive and Calendar as **separate features** (separate stores, settings cards, detection). It absorbs the STATUS-tracked "calendar-reconnect-toast-flash" and "make the mismatch/reconnect prompt actionable" items.

### What the codebase investigation established (2026-08-14, verified against code in Pass 2 + Pass 3)

**Token storage — the two feature tokens have contradictory contracts (so we do NOT merge storage):**

|                    | Drive token                                                                                                                                                    | Calendar token                                                                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home               | device IndexedDB (+ localStorage), key `googleRefreshToken-${familyId}` (`fileHandleStore.ts`); in-memory singleton `currentRefreshToken` (`googleAuth.ts:81`) | inside the encrypted `.beanpod` CRDT, one per `CalendarConnection` (`models.ts`); minted per-connection by `googleCalendarClient.ts` `TokenProvider` |
| Sharing            | single-account, device-local                                                                                                                                   | **family-wide, multi-account** (one connection per connected Google account)                                                                         |
| On `invalid_grant` | **deleted**                                                                                                                                                    | **never deleted** (`calendarSyncStore.ts` — NEVER delete the shared refreshToken)                                                                    |

**Scopes** — Drive: `drive.file` + `userinfo.email` (`DRIVE_SCOPES`, `googleAuth.ts:38-42`). Calendar: `calendar.events.owned` + `calendar.calendarlist.readonly` + `userinfo.email` (`CALENDAR_SCOPES`, `calendarAuth.ts:56-60`).

**Transport — redirect is already scope-parameterized; popup is not (verified):**

- `buildAuthUrl(clientId, codeChallenge, prompt, loginHint?, state?, scope = DRIVE_SCOPES)` (`googleAuth.ts:1654-1664`) already takes an arbitrary scope string; Drive is the default. **No signature change needed here.**
- `startRedirectAuth(returnPath, loginHint, mode, { grant, scope })` (`googleAuth.ts:1947-2026`) already threads a custom `scope` and a `grant` tag through both the web (`state`-carried, `redirectState.ts`) and native (sessionStorage stash + CSRF) arms. **Calendar already rides this** via `startCalendarRedirectAuth` (`calendarAuth.ts:296-305`). **Crucially, with the default `grant:'drive'` it accepts an arbitrary `scope` with no other change** — so the unified redirect needs _no new grant tag_ (see Approach §2).
- The **popup** path (`requestAccessToken` → `performPopupAuth` → `buildAuthUrl` at `googleAuth.ts:896`) passes **no scope arg** — always `DRIVE_SCOPES`. Calendar's popup builds a wholly separate URL (`buildCalendarAuthUrl`, `calendarAuth.ts:131-145`). **This is the one transport asymmetry to fix** (add an optional `scope` to `requestAccessToken`/`performPopupAuth`) — and the _only_ `googleAuth.ts` signature change this plan makes.
- Grant routing: `RedirectGrant = 'drive' | 'calendar'` (`redirectState.ts:45`). `encodeRedirectState` writes `grant` on the wire **only when `=== 'calendar'`** (Drive omitted → byte-identical); `decodeRedirectState` maps `'calendar'` else defaults `'drive'`. **This plan does NOT add a third tag** (Pass 3): the unified grant IS a Drive grant that carries extra scopes, so `redirectState.ts` stays untouched.
- Post-redirect the web `OAuthCallbackPage`/native `handleNativeAuthRedirect` (`googleAuth.ts:2224-2336`) route the one-time code to exactly one completion by grant tag (`stored.grant === 'calendar'` → calendar key; else Drive completion). **The unified path routes as Drive** (its default), so no routing edits are needed.
- ADR-026 memoized settlement (`ensureRedirectAuthSettled`, `googleAuth.ts:2143`, reject-sticky) + ADR-029 native anti-race (App.vue boot skips redirect consumption on native). App.vue already `await`s `ensureRedirectAuthSettled()` at `:885`.

**Completion chokepoints (verified — private):**

- `commitAcquiredToken(...)` (`googleAuth.ts:166`) is **module-private**: the epoch-guarded persist → rollback → schedule → notify chokepoint. `completeRedirectAuth` (`:2033`) and `performPopupAuth` (`:922`) call it internally. The unified path **reuses these existing Drive completions verbatim** and never needs its own commit — the token it needs for the calendar fan-out is read back from the committed Drive home (`getGoogleRefreshToken`, `fileHandleStore.ts:318`).
- `exchangeCodeForTokens` (`oauthProxy.ts`) is the shared, reusable single exchange. **An OAuth code is single-use** — the unified path lets the _existing Drive completion_ do the one exchange and then fans the persisted result into the calendar sink. It never attempts a second exchange.

**Revoke-before-mint (#62), two independent seams (verified):**

- Drive: `performPopupAuth` (`:890-894`, forceConsent-gated) and `startRedirectAuth` (`:1966-1970`, `grant === 'drive'`-gated) revoke the prior Drive token before minting.
- Calendar: `calendarSyncStore.reconnect` (`:831-856`) via `revokeCalendarGrantGuarded` (`:810-826`), which **skips** the revoke when `liveDriveGrantSharesAccount` (`:792-803`) — a same-account whole-grant revoke would kill a live Drive grant.
- **Consequence for the unified path (Pass 3):** because the unified reconnect rides the Drive transport (`grant:'drive'` redirect, or `forceConsent` popup), the **existing Drive revoke-before-mint already revokes the shared grant exactly once**, and the calendar `liveDriveGrantSharesAccount` skip is simply never reached on this path. Req 6 is satisfied with no new revoke code.

**Two reconnect UI surfaces, independent + un-coordinated (verified):**

- `ReconnectToast.vue` is a **shared presentational primitive** (no state; props for title/subtitle/busy/error/dismiss + an `#icon` slot).
- Drive: `GoogleReconnectToast` gated by `syncStore.showGoogleReconnect && !authStore.needsAuth` at `App.vue:1658-1661`; button → `useGoogleReconnect().reconnect()` (silent → redirect → forced-consent ladder); auto-clears via `onTokenAcquired` → `handleGoogleReconnected`.
- Calendar: `CalendarReconnectToast` self-gates on `store.showCalendarReconnect && !dismissed` (computed off the first connection with `status==='needs_reconnect'`), mounted unconditionally at `App.vue:1664`; button → `store.reconnect(connectionId)`; self-heals when status returns to `ok`. The local `dismissed` re-entry is the toast-flash source.
- **Both can show at once** (independent state, stacked in one flex container, `App.vue:1655-1666`). Neither routes through `claimInterruption` (state-driven toasts intentionally bypass the one-popup rule — `useSessionInterruption.ts:15-18`).
- Settings entry points: Drive `handleSettingsReconnect` (`SettingsPage.vue`); Calendar `onReconnect` (`CalendarSyncSettings.vue`).

**Calendar redirect resume (verified — the pattern the unified resume reuses):**

- The calendar redirect completes not with a new completion path but via a `returnPath` query: `buildCalendarReturnPath(intent)` sets `?...&calResume=<intent>` (`calendarSyncStore.ts:705`), and `useCalendarRedirectResume` (App-level watcher) fires on that query — waiting for the Automerge doc, redeeming the one-time code once (memoized), toasting, then stripping the query. **The unified resume reuses this exact structure** (doc-wait + query-strip + reject-sticky), differing only in the completion it awaits (the Drive settle) and the fan-out it runs.

## Requirements

1. **One reconnect prompt.** When one or more Google-backed features are disconnected, show **one** reconnect toast that names what's down ("Reconnect Google Drive + Calendar" when both, or the single feature's name when only one), not two stacked toasts. Supersede the two separate toasts with a single `activeReconnectPrompt`-driven surface.
2. **One consent round-trip.** The unified reconnect requests the **union** of scopes for the features that are (a) user-enabled AND (b) currently disconnected, in a single Google consent — one screen, one round-trip — across all three transports (popup / redirect / native).
3. **One grant, two homes — NOT one store.** The unified consent mints **one** Google grant (one entry against the 100-token cap — the churn win). The resulting refresh token is written into **each existing storage home** for the features being restored (Drive's IndexedDB sink and/or the relevant `CalendarConnection` record). The two storage/refresh subsystems are **not** merged.
4. **Correct per-family-configuration behavior** (the explicit concern):
   - **Drive-only** (Calendar not enabled / not connected): delegate to today's Drive reconnect (`useGoogleReconnect().reconnect()`); union = `drive.file` only; **no calendar consent is ever requested.**
   - **Both enabled, both down** (the common BROAD-revoke case): union = Drive + Calendar scopes; one screen restores both (the only case that uses the new unified machinery).
   - **Both enabled, only one down**: delegate to the down feature's existing per-feature reconnect (union = that feature's scopes).
   - **Calendar-only** (local-file-storage family with Calendar connected, no Drive grant): delegate to `calendarSyncStore.reconnect`; must not require or assume a Drive sink.
5. **Preserve every #62 guarantee.** Revoke-before-mint still runs; the account-binding heal (`healAccountBindingIfNeeded`, `getVerifiedGoogleAccountEmail`) is untouched; token count does not increase (ideally decreases — one grant instead of two).
6. **Unify revoke-before-mint for the shared grant.** When the unified (both-down-same-account) reconnect will restore a shared grant, revoke the prior shared grant **once** before minting; the `liveDriveGrantSharesAccount` skip is not applied **on the unified path** (its reason to exist disappears when both are one grant we are deliberately re-consenting). Do NOT change the independent per-feature revoke behavior on the paths that stay per-feature (initial connect, single-feature reconnect). **(Pass 3: satisfied for free — the unified path rides the Drive transport, whose existing revoke-before-mint revokes the shared grant once; the calendar skip is never reached.)**
7. **Scope: reconnect only.** Initial connect flows (create-pod Drive connect, first Calendar connect from Settings) stay per-feature and unchanged. This plan unifies only the **reconnect** action.
8. **Partial-failure honesty.** If the unified consent restores one feature but the other's write fails (e.g. the `CalendarConnection` update throws), the prompt must accurately reflect what's still down (not falsely clear), and the failure is logged. No silent partial success.
9. **Respect existing surface hygiene.** Keep the single consolidated prompt outside `claimInterruption` (state-driven, like today), keep it in the existing bottom-right toast stack, preserve the `!authStore.needsAuth` gate the Drive toast has today, and preserve the syncStore banner-precedence chain (`syncStore.ts:268-286`).
10. **iOS parity.** The unified flow must complete correctly on iOS redirect + native, reusing the ADR-026 memoized settlement and ADR-029 anti-race — **one completion path, not two racing ones** (the unified path awaits the existing memoized Drive completion, then fans out; it introduces no second completion).

## Important Notes & Caveats

- **iOS-live-only OAuth completion — plan to the last detail before any build.** The redirect/native completion is testable only on a deployed build (greg cannot test iOS locally — see `docs/lessons.md`). Every iteration costs a deploy + reinstall. Before spending a build, grep the platform behavior (as the 2026-08-07 `iosScheme` lesson demands) and ship the diagnostic events (Observability) that make a blind build's outcome legible. **Pass 3 materially de-risks this: the unified redirect reuses the already-shipped, already-tested Drive completion path unchanged — the only new runtime step is a post-completion CRDT write, which is testable on web.**
- **Do NOT merge the two storage/refresh subsystems.** Drive deletes its token on `invalid_grant`; Calendar never deletes its (family-shared) token. Forcing both into one home breaks one contract. Keep both homes; unify only the **consent** — one grant fanned into both sinks.
- **Do NOT unify initial connect.** Onboarding Drive-connect and first Calendar-connect stay separate; a user connecting Drive during setup should not be asked for calendar scopes. Only the _reconnect_ is unified.
- **The unified grant is a Drive grant that carries calendar scopes — not a new grant type (Pass 3).** This is the central sustainability decision. Rather than teaching the OAuth transport a third `'unified'` routing tag (which would fork `redirectState.ts`, the code-slot map, the web callback, and the native deep-link handler), the unified redirect goes out as an ordinary `grant:'drive'` redirect whose `scope` is the union and whose `returnPath` carries a `unifiedResume` intent. It completes through the **existing** Drive completion (`ensureRedirectAuthSettled`), and the calendar restore is a **post-completion fan-out** keyed off the committed Drive token. Nothing in the shared OAuth transport forks.
- **Only the both-down-same-account case needs new machinery.** Single-feature down-sets delegate verbatim to the existing primitives (`useGoogleReconnect().reconnect()`, `calendarSyncStore.reconnect(id)`). The new code is confined to: the coordinator, `applyUnifiedRefreshToken`, the unified resume, the popup `scope` param, and the toast — none of it inside the OAuth routing core.
- **The "enabled AND down" set is the single source of truth for the scope union.** Never request a scope for a feature the user hasn't enabled. Drive "enabled" = `syncStore.isGoogleDriveAvailable && storageProviderType === 'google_drive'`. Calendar "enabled" = `isFlagEnabled('googleCalendarSync') && a connection with status==='needs_reconnect' exists`. There is **no `features.calendar`** — calendar is DevFlag + connection presence.
- **Multi-account edge is an ordinary case in the plan (Pass 3).** Calendar is multi-account (one connection per Google account); Drive is single-account. The coordinator groups the down set **by account** (see Approach §1): each account with ≥2 down features gets one unified consent; each account with exactly one down feature delegates to that feature's primitive. A Drive account that shares no down calendar connection is just a one-feature group; a calendar connection on a different account than Drive is another one-feature group. No special-case branch, no silent drop — and this is the seam a **third** Google-scoped feature slots into.
- **A single OAuth code is single-use.** The unified path performs **zero** extra exchanges: the existing Drive completion does the one exchange; the calendar fan-out reuses the _persisted_ refresh token (read back via `getGoogleRefreshToken`), not a second code redemption.
- **`commitAcquiredToken` is module-private — and stays untouched.** The unified path needs no new `googleAuth.ts` completion function; it reuses `completeRedirectAuth`/`performPopupAuth`/`ensureRedirectAuthSettled` and reads the token back from the Drive home for the calendar fan-out. The _only_ `googleAuth.ts` change is threading an optional `scope` into `requestAccessToken`/`performPopupAuth`.
- **Refresh-token reuse across two engines is fine.** One grant's refresh token can be independently refreshed by Drive's engine and Calendar's `TokenProvider`; each exchange yields an access token carrying all the grant's scopes. This does not consume the token cap.
- **Preserve the web-vs-native stash split.** Web redirect carries routing in the OAuth `state` param (no sessionStorage, no PKCE verifier); native uses the sessionStorage stash + CSRF `state` + PKCE verifier. Because the unified redirect is a plain Drive redirect, **both arms carry it exactly as they carry Drive today** — the `unifiedResume` intent rides in `returnPath` (web: inside the `state` payload's `returnPath`; native: inside the stash's `returnPath`), the same channel `calResume` already uses.
- **`ensureRedirectAuthSettled` / the settle memos are reject-sticky** — the one-time code is consumed on entry; never convert to retry-on-reject. The unified resume **awaits this same memo** rather than adding a parallel one, so there is exactly one Drive completion.

## Assumptions

> **Review before implementation.** Valid at planning (2026-08-14); confirm against code if time passes.

1. A single Google consent for `drive.file + userinfo.email + calendar.events.owned + calendar.calendarlist.readonly` mints one refresh token whose grant covers all four, and `refreshAccessToken` returns an access token carrying all granted scopes. (Standard incremental-scope OAuth; both features already validate `tokens.scope` per-capability — `performPopupAuth:907`, `connectGoogleCalendar:236`.)
2. `startRedirectAuth`/`buildAuthUrl` accept an arbitrary space-joined scope string with no signature change (**verified** `googleAuth.ts:1654-1664, 1947-2026`), and accept a union `scope` under the **default** `grant:'drive'` with no other change (**verified** — `grant` and `scope` are independent params). Adding an optional `scope` to `requestAccessToken`/`performPopupAuth` is additive and defaults to `DRIVE_SCOPES` (no behavior change for existing callers).
3. Both features' reconnect entry points are already public store methods (`useGoogleReconnect().reconnect`, `calendarSyncStore.reconnect`) and their success clears the prompt reactively — so the coordinator can delegate to them for single-feature down-sets without reaching into internals.
4. Under BROAD revoke both grants are for the **same** account in the overwhelmingly common case; the different-account case is a rare multi-account edge (handled as an ordinary one-feature group per Approach §1).
5. After the existing Drive completion succeeds, the newly minted refresh token is readable from the Drive home via `getGoogleRefreshToken(familyId)` (**verified** — `commitAcquiredToken` persists to the in-memory singleton + IndexedDB before the completion resolves; `fileHandleStore.ts:318`). The calendar fan-out reads it there and writes it into each same-account `needs_reconnect` `CalendarConnection` via a new store method reusing `finalizeConnected`/`updateCalendarConnection` — no separate calendar code-exchange.
6. **(Pass 3 — replaces the old `'unified'` wire-tag assumption.)** The unified redirect can ride the existing `grant:'drive'` routing unchanged; the "also restore calendar" intent is carried entirely in `returnPath` (a `unifiedResume` query, exactly as `calResume` is carried), so `redirectState.ts` and the web/native completion routing need **no edits**.

## Approach

**Design decision (settles greg's open fork): one grant, two homes, reconnect-only, and reuse-first.** Unify the _consent_ (one Google grant, one round-trip, one prompt) and fan the resulting refresh token into the existing Drive and Calendar storage homes. Do not merge storage/refresh subsystems, and do not touch initial-connect flows. **The unified grant is a Drive grant that carries calendar scopes**, so it reuses the Drive transport, exchange, commit, revoke, and settle memo wholesale — the only genuinely-new code is the coordinator, the calendar fan-out write, a post-completion resume, the popup `scope` param, and the consolidated toast.

### 1. A reconnect coordinator (the single owner of "what's down + reconnect once")

Add a small **coordinator** composable `src/composables/useReconnectCoordinator.ts` depending only on the two stores' public surfaces:

- **`downFeatures`** — computed set derived from `syncStore.showGoogleReconnect` (∩ Drive-enabled) and `calendarSyncStore.showCalendarReconnect` (∩ `googleCalendarSync` flag). Drive carries its account email (`providerAccountEmail` / `getVerifiedGoogleAccountEmail()`); Calendar carries the account(s) of the `needs_reconnect` connection(s) (iterate `store.connections`, not just the first).
- **`activeReconnectPrompt`** — computed descriptor: `null` when nothing is down; otherwise `{ features: ('drive'|'calendar')[], titleKey, bodyKey }`. Single visibility+content source for the consolidated toast. (Same-account/different-account is an _execution_ detail of `reconnectAll`, not a prompt concern — the prompt only names what's down.)
- **`buildReconnectPlan()`** — a pure helper that turns the down set into a flat list of **per-account reconnect groups**:
  - Group every down feature by its Google account email (Drive contributes at most one entry; each down `CalendarConnection` contributes one, keyed by its `accountEmail`). A calendar connection joins the Drive union group **only on a positive `driveEmail === connection.accountEmail` match**. A connection whose `accountEmail` is `'unknown'` (or differs from the Drive account) is its **own single-feature group** → delegated to `calendarSyncStore.reconnect(id)`. **Do NOT fold `'unknown'` onto the Drive group** (Pass 4): that fail-safe was designed for _revoke_ (unknown → skip = safe no-op); as a _write_ it would push the Drive account's token into a possibly-different account's connection.
  - Each group is `{ accountEmail, features: DownFeature[] }` where a feature carries what the executor needs to act (Drive: the email; Calendar: the `connectionId`).
  - This single structure subsumes **all four family configs and the multi-account edge**: a group of one feature ⇒ delegate; a group of ≥2 features ⇒ union consent. There is no `if drive-only / else if both-same / else if both-different` ladder.
- **`reconnectAll()`** — a flat executor over the plan (no nesting deeper than one loop):
  1. `const groups = buildReconnectPlan()`.
  2. For each group: if it has a single feature, **delegate** (`drive` → `useGoogleReconnect().reconnect(email)`; `calendar` → `calendarSyncStore.reconnect(connectionId)`) — these already own transport, revoke-before-mint, and self-heal. If it has ≥2 features, run **one unified consent** for the union (§2) and fan out (§3).
  3. Each store's existing self-heal clears its slice of the prompt; the coordinator surfaces any partial failure (§4 / Req 8) via a `reconnectError` ref (mirrors `useGoogleReconnect`).
  - In practice today there is at most one ≥2 group (Drive + the same-account calendar connections) plus zero-or-more single-feature calendar groups; but the executor doesn't special-case that — it just runs the plan. **A third Google-scoped feature joins by contributing to the down set + plan; the executor is unchanged.**

The coordinator wraps the whole action in try/catch → `reconnectError`; nothing throws unhandled. It depends only on **public** store/composable surface (read-only down state + `connections` + the two `reconnect` methods + `applyUnifiedRefreshToken`) — it does not reach into store internals.

### 2. One consent across the three transports (union scope) — the ≥2-feature group only

- **Redirect + native** — the unified consent is an ordinary **Drive** redirect carrying the union scope and a resume intent:
  `startRedirectAuth(returnPath, driveEmail, 'reconnect', { scope: unionScope })` where `returnPath` carries a `unifiedResume` query (built like `buildCalendarReturnPath`). `grant` defaults to `'drive'` → the web `state` and native stash are byte-identical to a normal Drive redirect, and the existing Drive revoke-before-mint fires once on the shared grant. **No `redirectState.ts` / routing change.**
- **Popup (desktop)** — **the one signature change**: thread an optional `scope` through `requestAccessToken(opts) → performPopupAuth → buildAuthUrl` (default `DRIVE_SCOPES`; every existing caller unchanged). The coordinator's desktop path calls `requestAccessToken({ forceConsent: true, loginHint: driveEmail, scope: unionScope })` — `forceConsent` runs the existing Drive revoke-before-mint — then drives the calendar fan-out (§3).
- Keep `prompt=consent` + `access_type=offline` (invariant on all reconnect paths). Keep `include_granted_scopes` unset.

### 3. One fan-out mechanism (calendar restored from the committed Drive token — every transport identical)

There is **no** new completion function and **no** new code slot. In all three transports the Drive completion runs first (existing code), then a single fan-out step restores calendar:

- **`applyUnifiedRefreshToken({ refreshToken, grantedScopes, email })`** — a **new public `calendarSyncStore` method**. It iterates `connections` and, for every `needs_reconnect` connection whose `accountEmail` **positively equals** `email` (the consent account), writes the refresh token + scopes via the existing `finalizeConnected`/`updateCalendarConnection` path → each flips to `ok`, `showCalendarReconnect` drops. Connections with a non-matching or `'unknown'` `accountEmail` are **never written here** (Pass 4 — they are handled as their own single-feature groups); this prevents leaking one account's token into another account's connection. Per-connection failures are collected and surfaced (Req 8), not swallowed.
- **Desktop popup** — after `requestAccessToken({scope})` resolves, read the just-committed token back via `getGoogleRefreshToken(familyId)` and call `applyUnifiedRefreshToken(...)`. (Desktop always has Drive in a ≥2 group, so the Drive home is guaranteed populated.)
- **Redirect / native** — the returned-to page carries the `unifiedResume` intent. A resume watcher (§ resume) waits for the doc, then **reads the committed Drive token back** via `getGoogleRefreshToken(familyId)` and, **if present**, calls `applyUnifiedRefreshToken(...)`. On **web** it first `await`s the memoized Drive completion (`ensureRedirectAuthSettled()`) so the token is committed before the read-back. On **native** `ensureRedirectAuthSettled()` is a deliberate **no-op returning `null`** (ADR-029, `googleAuth.ts:2144`) — the real Drive completion runs inside `handleNativeAuthRedirect` → `completeRedirectAuth()` and commits the token **before** navigating to the returnPath. **So the fan-out must gate on the read-back token's presence, NOT on the settle memo's return value** (Pass 4 — the memo is always `null` on native, so gating on it would skip the calendar restore on every iOS reconnect). If no committed Drive token is found, the fan-out is skipped and the prompt keeps calendar down (partial honesty).

Because the fan-out consumes the _persisted_ token, there is exactly one code exchange (inside the existing Drive completion) and N CRDT writes — the single-use-code constraint is honored structurally, with no risk of a double redemption.

### Resume (reuse, don't duplicate)

Fold the unified resume into the **existing** `useCalendarRedirectResume` pattern rather than adding a parallel composable and memo:

- Extend the App-level watcher to also fire on a `unifiedResume` query (or add a thin sibling `useUnifiedRedirectResume` that **imports the same `waitForDocLoaded` + `stripQuery` helpers**, hoisted to a shared module if needed — no copy). On `unifiedResume`, it: waits for the doc, `await ensureRedirectAuthSettled()` (the one Drive completion), then — on success — reads the Drive token and calls `applyUnifiedRefreshToken`, toasts the combined outcome, strips the query. Reject-sticky and re-entry guards come from reusing the existing structure.
- This keeps **one** redirect-resume concept in the app (calendar + unified share the same doc-wait / query-strip / single-run discipline), instead of two divergent resume implementations drifting apart.

### 4. The consolidated prompt (supersede two toasts)

- Replace the two thin binding components with **one** `UnifiedReconnectToast.vue` that binds the coordinator (`activeReconnectPrompt`, `reconnectAll`, `reconnectError`) to the existing `ReconnectToast.vue` presentational primitive (no new visual component). Title/body from the descriptor: "Reconnect Google Drive + Calendar" / "Reconnect Google Drive" / "Reconnect Google Calendar", each an i18n key pair (`en` + `beanie`).
- **Retire** `GoogleReconnectToast.vue` + `CalendarReconnectToast.vue` mounts (`App.vue:1655-1666`) in favour of the single `UnifiedReconnectToast`. Per-store reconnect _state_ (`showGoogleReconnect`, `showCalendarReconnect`) stays as the detection source; only the _presentation_ is consolidated. Preserve the `!authStore.needsAuth` gate.
- The button calls `coordinator.reconnectAll()`; `ReconnectToast`'s existing `busy`/`subtitleIsError` props render the actionable Reconnect + error states (the STATUS "make the mismatch toast actionable" item).
- **Absorb the calendar-toast-flash**: the flash came from `CalendarReconnectToast`'s `visible = showCalendarReconnect && !dismissed` re-showing across transitions. The single computed-driven prompt has no per-incident local `dismissed` re-entry (dismiss, if kept, resets cleanly on heal) — the flash is gone.
- Keep it in the same bottom-right stack, outside `claimInterruption`.

### 5. Unified revoke-before-mint (no new code)

On the ≥2-feature group the unified consent rides the Drive transport (`grant:'drive'` redirect, or `forceConsent` popup), so the **existing** Drive revoke-before-mint revokes the prior shared grant **once** before minting, and the calendar `liveDriveGrantSharesAccount` skip is never reached (we never call the calendar revoke on this path). The per-feature initial-connect and single-feature-reconnect paths keep their existing independent revoke logic unchanged. **This requires no new revoke code** — it falls out of routing the unified consent through the Drive transport.

### Explicitly OUT of scope

- Merging the Drive and Calendar **token stores / refresh engines** (contradictory contracts).
- **Initial connect** flows (create-pod Drive connect; first Calendar connect).
- Any change to detection thresholds (`INVALID_GRANT_THRESHOLD`, cold-start escalation) or the account-binding heal.
- Any change to `redirectState.ts`, the `RedirectGrant` enum, the OAuth code-slot map, or the web/native completion **routing** (Pass 3: the unified path reuses the Drive routing unchanged).

## Files Affected

- `src/composables/useReconnectCoordinator.ts` **(new)** — `downFeatures`, `activeReconnectPrompt`, `buildReconnectPlan()`, `reconnectAll()`, `reconnectError`; the DRY reconnect router (group-by-account plan → uniform executor; delegates single-feature groups; owns the union path + fan-out).
- `src/components/common/UnifiedReconnectToast.vue` **(new)** — one thin binding of the coordinator to `ReconnectToast.vue`; replaces the two old bindings.
- `src/services/google/googleAuth.ts` — **only change:** add optional `scope` to `requestAccessToken`/`performPopupAuth` → `buildAuthUrl` (default `DRIVE_SCOPES`). No new completion function, no new code slot, no routing edits.
- `src/services/google/redirectState.ts` — **unchanged** (Pass 3: the unified path rides `grant:'drive'`; no third tag).
- `src/stores/calendarSyncStore.ts` — add public `applyUnifiedRefreshToken({ refreshToken, grantedScopes, email })` iterating `connections` for same-account `needs_reconnect` records (reuses `finalizeConnected`/`updateCalendarConnection`, collects per-connection failures); keep `reconnect()` for the per-feature Settings + single-feature-down paths.
- `src/services/google/calendarAuth.ts` — no new exchange entry needed (fan-out reuses the store's write path); verify `CALENDAR_SCOPES` export is consumed by the coordinator for the union.
- `src/stores/syncStore.ts` — expose read-only down state + account for the coordinator (getters only, no internals); keep `handleGoogleReconnected` (Drive self-heal unchanged).
- `src/pages/OAuthCallbackPage.vue` — **unchanged** (the unified code routes as Drive via the existing path).
- `src/composables/useCalendarRedirectResume.ts` — extend to also handle the `unifiedResume` intent (await `ensureRedirectAuthSettled()` → read Drive token → `applyUnifiedRefreshToken`), or split its `waitForDocLoaded`/`stripQuery` helpers into a shared module reused by a thin `useUnifiedRedirectResume.ts` sibling. One redirect-resume concept, not two divergent ones.
- `src/App.vue` — replace the two-toast mount (`:1655-1666`) with the single `UnifiedReconnectToast` (preserve `!authStore.needsAuth`); wire the unified resume (alongside the existing `useCalendarRedirectResume()` at `:1395`).
- `src/components/google/GoogleReconnectToast.vue`, `src/components/common/CalendarReconnectToast.vue` — **retire** (delete the mounts; keep `ReconnectToast.vue` primitive and `useGoogleReconnect` composable, which the coordinator still delegates to).
- `src/services/translation/uiStrings.ts` — new title/body keys for the consolidated prompt (both/drive/calendar variants), `en` + `beanie`.
- `src/components/settings/CalendarSyncSettings.vue`, `src/pages/SettingsPage.vue` — unchanged reconnect behavior (per-feature buttons stay; they call the same primitives the coordinator delegates to); verify they still self-heal.
- Tests: coordinator unit tests (incl. `buildReconnectPlan` grouping); scope-plumbing regression on `requestAccessToken`; calendarSyncStore `applyUnifiedRefreshToken` fan-out tests; unified-resume await-then-fan-out test. **No `redirectState` `'unified'` round-trip test needed** (no wire change).

## Observability Coverage

All events via `logEvent`/`reportError`, reusing already-allowlisted context keys (`action` is free-form; `provider_type`, `http_status`, `severity`, and the `token_*` family from `logTokenLifecycle` all verified present). **No new allowlisted key is introduced** — features + transport ride the existing `action` value and `provider_type` — so the coupled privacy-declaration change (Lambda allowlist, `PrivacyInfo.xcprivacy`, Data-Safety/App-Privacy, `privacy.astro`) is **not** needed. **No email PII** — encode features/accounts as booleans/enums, never the address.

- **Unified reconnect start** — `logEvent({ level:'info', surface:'unified-reconnect', context:{ action:'start:<features>:<transport>' } })` where `<features>` is `drive+calendar`/`drive`/`calendar` and `<transport>` is `popup`/`redirect`/`native` (both encoded into the free-form `action` value; no new key).
- **Fan-out outcome (success-path signal, for rate alerting)** — one event per sink restored: `surface:'unified-reconnect'`, `action:'restored-drive'` / `'restored-calendar'`, so the _rate_ of successful unified restores is measurable.
- **Partial failure (Req 8)** — `reportError({ surface:'unified-reconnect', severity:'warning', … })` naming which sink failed. Reserve `severity:'critical'` only if a user's reconnect wholly failed AND data is at risk (Drive save blocked) — otherwise `warning`.
- **Multi-account fallback** — `logEvent({ surface:'unified-reconnect', context:{ action:'per-feature-fallback-account-mismatch' } })` so the rare different-account (extra single-feature group) path is visible.
- **Revoke** — the unified revoke-before-mint rides the existing `logTokenLifecycle({ op:'revoke', … })` on the Drive transport (no new code).
- **Triage-blind check**: "reconnect asked me twice" → two `unified-reconnect action:start` where one was expected. "calendar still down after reconnect" → `restored-drive` present, no `restored-calendar`, plus the partial-failure `reportError`. "iOS reconnect stuck" → the start event names the transport that stalled with no matching restored event.

## Acceptance Criteria

- [ ] With **both** Drive + Calendar down (same account), the user sees **one** reconnect toast; clicking it opens **one** Google consent; on return **both** are restored. No second prompt, no second round-trip.
- [ ] **Drive-only** family: `reconnectAll` delegates to `useGoogleReconnect().reconnect()`; only `drive.file` is requested; behavior is identical to today; **no calendar consent** is shown.
- [ ] **Both enabled, only one down**: `reconnectAll` delegates to that feature's existing per-feature reconnect (single-feature group); no union path runs.
- [ ] **Calendar-only** (local-storage + Calendar): `reconnectAll` delegates to `calendarSyncStore.reconnect`; no Drive sink involved.
- [ ] The minted grant is **one** Google grant (token count does not increase vs a single-feature reconnect; ideally the both-down case now consumes one grant where it used to consume two).
- [ ] **Different-account** Drive vs calendar connection: the unified consent restores the shared-account group; the other-account connection is its own single-feature group falling back to `calendarSyncStore.reconnect`, and the prompt reflects it (no silent drop). Logged.
- [ ] Partial failure (calendar write throws after Drive restores) leaves the prompt accurately showing calendar still down and logs a `warning`; no false "all clear."
- [ ] iOS redirect + native complete the unified reconnect through the **existing** Drive completion (ADR-026 memo + ADR-029 anti-race preserved — the unified resume awaits `ensureRedirectAuthSettled`, adds no second completion); verified on a deployed build.
- [ ] The calendar-reconnect-toast-flash is gone; the consolidated prompt is actionable (clear Reconnect button, busy/error states).
- [ ] All #62 guarantees preserved: revoke-before-mint runs (unified once via the Drive transport on the union path; unchanged on the delegated paths); the account-binding heal is unchanged; no token-churn regression.
- [ ] `redirectState.ts` and the web/native OAuth **routing** are unchanged (diff confined to the coordinator, the store fan-out method, the popup `scope` param, the resume, and the toast/i18n).
- [ ] Settings per-feature reconnect buttons still work and self-heal.
- [ ] Diagnostic logging per **Observability Coverage** fires with the stated `surface`/`action`; **no new context key**; no email PII.
- [ ] `npm run build` (full rollup import-analysis), `npm run type-check`, lint, and Vitest all pass before push.

## Testing Plan

**Unit (Vitest):**

1. `useReconnectCoordinator`: `downFeatures` and `activeReconnectPrompt` for each config (drive-only, calendar-only, both-down, one-down, none); `buildReconnectPlan` groups the down set by account correctly (single-feature groups vs the ≥2 group; a calendar connection joins the Drive union group **only** on a positive email match; `'unknown'`/different-account connections become their **own** single-feature groups, never folded onto Drive; multi-account splitting); `reconnectAll` **delegates** single-feature groups to the correct primitive and only enters the union path for a ≥2 group; scope union computed correctly.
2. Scope plumbing: `requestAccessToken({scope})` threads to `buildAuthUrl`; default remains `DRIVE_SCOPES` for existing callers (regression).
3. Fan-out: after a Drive completion, `applyUnifiedRefreshToken` reads the Drive token back and updates every same-account `needs_reconnect` connection; multi-account only touches matching connections; partial-failure path reports + leaves the other sink's prompt state intact.
4. Unified resume: on a `unifiedResume` intent it fans out **gated on the read-back Drive token's presence** (`getGoogleRefreshToken`), NOT on the settle memo's return — a **native** run where `ensureRedirectAuthSettled()` returns `null` but the token IS committed still fans out (the iOS bug Pass 4 caught); a run with no committed Drive token skips the fan-out and keeps calendar down; the code is redeemed exactly once (no second exchange).
5. Revoke: the unified consent routes through the Drive transport so the Drive revoke-before-mint fires once; the calendar `liveDriveGrantSharesAccount` skip still applies on the delegated per-feature calendar reconnect (unchanged).
6. Prompt supersession: exactly one toast renders when both are down; button → `reconnectAll()`; `!authStore.needsAuth` gate preserved.

**Manual (greg, deployed — web first, then iOS build):** 7. Desktop: force both grants down → one toast → one consent → both restored. 8. iOS (deployed build): both-down → one prompt → redirect consent → both restored on resume; no double prompt, no stuck state. 9. Drive-only family: reconnect shows no calendar scope on the Google screen. 10. CloudWatch shows `unified-reconnect action:start:drive+calendar:<transport>` then `restored-drive` + `restored-calendar`.

**Regression:** 11. Initial connect (create-pod Drive; first Calendar connect) unchanged — no calendar scope on Drive onboarding, no drive scope on first calendar connect. 12. Single-feature reconnect from Settings still works (unchanged primitives). 13. A normal (non-unified) Drive redirect and a normal calendar redirect still complete correctly — the shared transport was not disturbed.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the one-grant / two-homes / reconnect-only design: a reconnect coordinator (`downFeatures` → `activeReconnectPrompt` → `reconnectAll()`), union-scope consent across the three transports, a fan-out completion writing one refresh token into both sinks, unified revoke-before-mint, consolidated prompt superseding the two toasts, with all four family configs + the multi-account edge + partial failure. Storage-merge and initial-connect explicitly out of scope.
- **Pass 2 (DRY + error handling)**: Verified reuse claims against code — corrected that `commitAcquiredToken` is private, resolved the single-use-code constraint into one exchange + fan-out, made `reconnectAll` a thin router that delegates single-feature down-sets verbatim, fixed the multi-account fan-out to iterate `connections` (not first-only), dropped the new allowlisted key in favour of the free-form `action` value, collapsed the two binding components into one `UnifiedReconnectToast`, and preserved the `!authStore.needsAuth` gate and per-call try/catch → `reconnectError`.
- **Pass 3 (Sustainability)**: Eliminated the third completion path — the unified grant is now a Drive grant carrying calendar scopes, so `redirectState.ts`, the code-slot map, and the web/native OAuth routing are all untouched; the calendar fan-out is a post-completion read-back that reuses the existing memoized Drive completion (`ensureRedirectAuthSettled`) identically across all three transports; `reconnectAll`'s three-way nested branch was replaced by a flat group-by-account plan → uniform executor (future-proof for a third feature); revoke-before-mint falls out of the Drive transport for free; and the redirect-resume is reused rather than duplicated.
- **Pass 4 (Fresh-eyes sweep)**: Verified the load-bearing reuse claims (Drive-routing of union scope, token readable post-completion, reusable resume structure, single-feature delegation, partial-failure leaving `showCalendarReconnect` true). Fixed two real bugs: (1) an **iOS-only** fan-out failure — `ensureRedirectAuthSettled()` is a no-op returning `null` on native (ADR-029), so gating the calendar fan-out on its return value would skip calendar restore on every iOS reconnect; the fan-out now gates on the **read-back token's presence** instead. (2) a **cross-account write** hazard — folding `'unknown'`-email calendar connections onto the Drive union group (a revoke-era fail-safe) would write the Drive account's token into a possibly-different account's connection; union-group membership and the fan-out write now require a **positive `driveEmail === connection.accountEmail` match**, and `'unknown'`/different-account connections fall to their own single-feature `reconnect(id)`.

## Prompt Log

> No GitHub issue created — direct implementation. Full prompt history embedded.

<details>
<summary>Full prompt history</summary>

### Initial prompt (after 0.9.10R2 verification)

> sorry to not provide an update, i tested in prod (on the web app), hard refresh, and confirmed i didn't get the toast. i also logged out and logged in as the beaniesdemo account, confirmed the settings shows the correct account, and logged out and back in again as gregsophia, and confirmed the account listed in family data options is still correct and no toast, so looks positive.
>
> i believe we didn't push a new app in the last deploy, only web, which is ok, we can push it with the next deploy
>
> I wanted to ask whether it truly makes sense to move forward with commit 5 to combine the google prompts and toasts for calendar and drive.
>
> I thinking abiout this again as they are legitimately separate surfaces and features, but recently when losing grants, i am always being pestered with 2 things to reconnect. however, perhaps it makes sense that when losing a grant to two different features, you get 2 toast / error messages. my only concern was having to go through to auth/consent flows to reconnect both.
>
> does it make sense to combine these, or keep them separate, or would you propose something that is a middle ground between the two for the best UX while also maintaining proper separation from concerns and keeping the code from becoming too complex and hard to maintain?

### Follow-up (approving the middle ground + single-token lean)

> sounds good please kick off /beanies-plan and i feel one token is simpler, but the question is whether it would work as expected and without being to complicated for families who have drive but not calendar, or both enabled

</details>
