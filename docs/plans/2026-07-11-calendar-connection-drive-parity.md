# Plan: Calendar-connection robustness parity with Drive (no silent failures, PWA reconnect, aggressive refresh)

> Date: 2026-07-11
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-07-11-calendar-connection-drive-parity.md`
> Mockup: `docs/mockups/calendar-reconnect-surfaces-2026-07-11.html`

## User Story

As a beanies.family user whose Google Calendar is connected, I want to be told the moment my calendar stops syncing and be able to reconnect it in one tap from whatever device I'm on — phone, installed PWA, or desktop — so that my family's activities keep reaching my calendar and I never again discover a silent, days-long outage by accident.

## Context

greg's live PWA silently lost its Google Calendar connection. There was **no on-screen indication** that activity pushes had stopped. He only found out by opening Settings → Google Calendar, where the connection showed `needs_reconnect`; tapping **Reconnect** on the PWA produced the toast _"Connecting a calendar is available in a desktop browser. Once connected it syncs on all your devices."_ — i.e. there is **no re-consent path on PWA/mobile**, and the failed taps stacked 3-4 identical toasts.

A three-agent read-only investigation root-caused this precisely. Two facts frame everything:

1. **Detection already works.** The `0.9.4R6` auth-kind fix means a dead grant is correctly classified `auth` and parks the connection `needs_reconnect` after `INVALID_GRANT_THRESHOLD` (2) consecutive failures. The per-connection token provider already has an in-flight dedupe + a permanent-failure "dead" latch (`googleCalendarClient.ts:112-198`). **The gaps are entirely in _surfacing_ the failure and _recovering_ from it — not in detecting it.**
2. **Drive already solved this; Calendar never inherited it.** The low-level primitives are already shared and robust (`oauthProxy` token/refresh, `pkce`, `shouldUseRedirectAuth()`, the `isPermanentRefreshFailure()` predicate). What Calendar lacks are the _coordination layers_ Drive has: a redirect-auth transport that works on PWA/iOS/native, a user-facing reconnect surface, a silent→redirect→popup reconnect ladder, and proactive/wake refresh.

### The three concrete defects

- **Silent disconnect.** `settleConnectionStatus` (`calendarSyncStore.ts:401-436`) on auth-death writes `status:'needs_reconnect'` to the CRDT and fires `reportError({surface:'calendar-sync', severity:'warning'})` — a **Slack/telemetry sink, not a user channel**. It never calls `showToast`, and calendar health is not an input to `notificationsStore.deriveNotifications` (`notificationsStore.ts:106-124`), so it cannot badge the bell. The status surfaces in exactly one place: the Settings drawer label (`CalendarSyncSettings.vue:257-259`). This is the exact "telemetry ≠ user signal" trap called out in `docs/lessons.md`.
- **No PWA/mobile recovery path.** `connectGoogleCalendar()` (`calendarAuth.ts:168-173`) hard-returns `fail('redirect_unsupported', …desktop browser…)` whenever `shouldUseRedirectAuth()` is true (native / iOS / installed PWA). Calendar has **no redirect transport** — popup only (`openBlankPopup` at `calendarAuth.ts:80-90,181`; `waitForCode` postMessage bridge), which cannot work in a standalone PWA. The header at `calendarAuth.ts:10-19` documents this as a deliberate v1 limitation (the redirect flow is hard-bound to Drive's single sessionStorage slot + shared `OAuthCallbackPage` + Drive scope).
- **Dead-end reconnect button + no toast dedupe.** The Reconnect button (`CalendarSyncSettings.vue:272-280`) renders on `needs_reconnect` with **no `isConnectSupported` guard** (unlike the Connect button at line 312, which is gated and shows `connectOnDesktop` text at 319-324). Tapping it hits the desktop gate. And `showToast` (`useToast.ts:92-158`, push at line 138) has **no dedupe** — identical sticky error toasts stack (the screenshot).

### Drive reference (the reusable units)

- Canonical reconnect surface: **`GoogleReconnectToast.vue`** — App-level, mounted at `App.vue:1496`, gated by `syncStore.showGoogleReconnect && !authStore.needsAuth`, driven by `useGoogleReconnect` (`isReconnecting`, `reconnectError`, `reconnect`). The component only emits `reconnected`; the actual self-heal — `onTokenAcquired(() => handleGoogleReconnected())` — lives in `syncStore.ts:2669-2675` (handler at `:2100-2112`, which shows **no** success toast). **Note:** `SyncStatusIndicator.vue` (the "header indicator") is **orphaned dead code** — referenced nowhere in `src`. The real pattern to mirror is `GoogleReconnectToast`, not that component.
- Redirect transport: `shouldUseRedirectAuth()` (`googleAuth.ts:371`), `startRedirectAuth(returnPath, loginHint, mode)` (`:1807-1847`), `completeRedirectAuth()` (`:1854-1924`), `whenRedirectAuthSettled()` (memoized, 20 s timeout). **Invariant** (`:1794-1798`): redirect auth always forces `prompt=consent` so Google returns a refresh token. Today these are hard-bound to Drive's single sessionStorage slot + shared `OAuthCallbackPage` + `drive.file` scope.
- Reconnect ladder: `useGoogleReconnect.reconnect(loginHint)` (`useGoogleReconnect.ts:24-61`): **`tryReconnectSilently(loginHint)` (the beanpod-mirror silent step in `driveTokenRecovery.ts`)** → (if `shouldUseRedirectAuth()`) `startRedirectAuth(...,'reconnect')` → else `requestAccessToken({forceConsent:true, loginHint})`. The per-call catch (`useGoogleReconnect.ts:53-57`) is the error-handling shape calendar's handler must mirror.
- Proactive refresh: `scheduleAutoRefresh` (`googleAuth.ts:1692-1713`, 5 min before expiry) + `installAuthWakeListener` (`:528-542`, refresh on `visibilitychange`/`focus`/`pageshow`/`online` when token expires within `WAKE_REFRESH_THRESHOLD_MS=120000`), both coalesced through the single-flight `pendingSilentRefresh`.
- Shared OAuth client: Drive + Calendar share `VITE_GOOGLE_CLIENT_ID` — one grant, they die together (STATUS.md 0.9.4R6). Calendar scopes (`calendarAuth.ts:33-40`): `calendar.events.owned` (required), `calendar.calendarlist.readonly`, `userinfo.email`. Calendar routes its refresh token to the `CalendarConnection` CRDT record, not to `googleAuth`.

### Decisions already made (by greg, this session)

1. **Phased delivery, ship P1 first.** P1 = user-awareness + no silent failure (no OAuth changes, low risk). P2 = redirect transport so connect/reconnect work on PWA/mobile. P3 = proactive/wake refresh parity.
2. **Generalize the shared redirect infra** for P2 (one transport, two grants) rather than a parallel calendar-only flow.
3. **Unify the reconnect toast on Heritage Orange** via one shared component; migrate Drive's amber toast onto it too (consistency + CIG-compliance + DRY).

## Requirements

### P1 — Kill the silent failure (ship first, no OAuth changes)

1. When a calendar connection is in **`needs_reconnect`** (dead grant — the only state a re-consent can actually fix), emit a **single** user-facing signal — not one per failed poll. Do **not** trigger on `status:'error'`: `settleConnectionStatus` writes `error` unconditionally on the first non-auth reconcile failure (only Slack _paging_ is sustained-gated), so keying on it would flap a re-consent CTA on a transient network/rate-limit blip — and re-auth can't fix a network error anyway. The signal is a shared App-level reconnect toast (see R4) **and** a bell notification entry (R3).
2. The signal must **self-heal**: the instant the connection returns to `ok`, the toast auto-dismisses (with a brief success confirmation) and the bell entry clears. No lingering nag. This satisfies "only bother the user if absolutely required."
3. Add calendar connection health as an input to `notificationsStore.deriveNotifications` so a `needs_reconnect` connection badges the bell (one entry per such connection, keyed by `connectionId`), and clears on recovery. Same `needs_reconnect`-only keying as R1 (never `error`).
4. Introduce **one shared reconnect-toast component** styled to the CIG (Heritage Orange, squircle, soft shadow, per the approved mockup). Calendar uses it; **Drive's `GoogleReconnectToast` migrates onto it** (amber → Heritage Orange). The Drive migration is a **discrete, cosmetic-only step** gated on a behaviour-unchanged test (same mount, same gating, only colour changes) — implemented as its own commit within P1 so it can be isolated/reverted independently of the calendar surface. The component is presentational — props/slots for icon, title, optional error subtext, busy state; each feature wires its own store/composable and its own guarded reconnect handler.
5. Add **dedupe** to `showToast` (`useToast.ts`): a new toast whose `type+title+message` matches a live toast is ignored instead of pushed. **Exempt interactive toasts** — any toast carrying an `actionFn` (e.g. Undo) is never deduped, so no action is ever silently lost. This fixes the stacked-toast screenshot and is a general correctness fix.
6. **Gate the Reconnect button** in `CalendarSyncSettings.vue` so it can never fire the "desktop browser" message on an unsupported surface. In P1 (before the redirect transport exists), on a redirect surface the reconnect affordance either (a) is disabled with the same `connectOnDesktop` explanatory text the Connect button uses, or (b) deep-links to the desktop-capable Settings flow — chosen in Approach. It must **never** produce a dead-end error toast. (P2 removes this interim gate entirely.)
7. `CalendarConnectNudge` today only covers **zero** connections (`useCalendarNudge.ts:69-75`); it must not be the surface for a _broken existing_ connection — that is the toast + bell's job. No change to the nudge's zero-connection behavior; just confirm it does not double-fire alongside the reconnect surface.
8. **No silent failures introduced.** Every new catch/short-circuit emits a `console.warn`/`reportError` breadcrumb; the existing `reportError` telemetry stays (it is additive to, not replaced by, the user signal).

### P2 — Redirect-auth transport for Calendar (connect + reconnect on PWA/iOS/native)

9. Add a calendar grant to the redirect transport by **sharing the _start_ side and sibling-ing the _completion_ side** (see Approach for the rationale). Share: a `grant:'drive'|'calendar'` argument on `startRedirectAuth` and scope-by-grant in `buildAuthUrl` (`googleAuth.ts:1565-1596`) — pure URL construction, Drive default unchanged. Do **not** multiplex the shared completion/settlement memo (`completeRedirectAuth`/`ensureRedirectAuthSettled`/`whenRedirectAuthSettled`, awaited by ≥6 live Drive consumers); keep those Drive-only and byte-identical. Instead the callback bounce writes a **grant-namespaced code key**, and calendar gets a sibling `completeCalendarRedirectAuth` with its own memo. Because a full-page redirect navigates away to start _either_ grant, only one grant's code can ever be pending — so the two code keys can never both be populated and **grant isolation is structural, not test-enforced**. The `prompt=consent` invariant holds for the calendar grant too.
10. Remove the `redirect_unsupported` gate from `connectGoogleCalendar()`. On a redirect surface, calendar **connect** and **reconnect** go through the redirect transport; on desktop they keep the popup. Remove the interim P1 gate in **both** places it lives — the Settings Reconnect button **and** the bell action (R6/S1) — so we never ship a half-removed state (Settings working on PWA but the bell still routing to the desktop explanation).
11. In P2, calendar's reconnect path is **redirect/popup-only** (no silent step). The silent-first step (`tryReconnectSilently`) is Drive-beanpod-specific and the calendar beanpod mirror is deferred to P3 (R16) — so P2 must **not** refactor the live Drive `useGoogleReconnect` to force-share a ladder whose calendar silent half is still stubbed (coupling with no payoff, and it puts Drive's reconnect on a new path for nothing). Defer the shared grant-parameterized ladder extraction to P3, when the calendar silent path exists (or make the silent step an injected strategy calendar passes as a no-op in P2).
12. After a redirect round-trip returns with a valid calendar token, the app must **resume the pending calendar action** (complete the connect, or clear `needs_reconnect` and resume sync) automatically, with no extra tap — mirroring how Drive resumes post-redirect. Must be SPA-nav-safe (reactive resume, not `onMounted`-only), per the native `router.replace` caveat documented in the Drive redirect-unification plan.
13. **Never pre-warn / UA-sniff-disable** (CLAUDE.md Cloud Auth UX). Surface friction only on an _observed_ failure, with a clear message and a concrete recovery action.
14. **Heavy test coverage protecting Drive auth**: the generalization must ship with tests asserting the Drive grant's storage slot, state, scope, and `prompt=consent` are unchanged, and that a calendar redirect can never consume or overwrite a live Drive redirect in flight.

### P3 — Proactive / wake-refresh parity

15. Generalize Drive's `scheduleAutoRefresh` + `installAuthWakeListener` into a **shared keep-warm helper** that Calendar also uses, so a calendar token is refreshed ~5 min before expiry and on wake (`visibilitychange`/`focus`/`pageshow`/`online`), coalesced single-flight per connection — matching Drive's "aggressive refresh, don't bother the user" behavior. No difference between Drive and Calendar in refresh aggressiveness.
16. (Optional, evaluate in P3) Mirror the calendar refresh token into the encrypted beanpod so a calendar connected on one device can silently self-heal on another. The **consumer** side of this pattern already exists — `driveTokenRecovery.tryReconnectSilently` is the silent-first step of the shared ladder — so the grant-parameterized ladder (R11) should reuse `driveTokenRecovery`'s shape rather than invent a calendar silent path. Decide in P3 whether the cross-device benefit justifies the complexity; if deferred, document why.

## Important Notes & Caveats

- **Do NOT weaken `forceConsent` on the reconnect path**, and **do NOT add Google token-revoke calls** — both are documented traps (revoke kills the whole shared grant; dropping forced consent resurrects the reconnect-every-launch bug).
- **The shared OAuth client means Drive + Calendar die together.** A single revoked grant breaks both. This plan does not change that (splitting clients is a separate, deferred decision in STATUS.md item 6); it makes the _recovery_ from it work everywhere.
- **P2 and P3 both touch live Drive auth infra** — treat both with the "Drive path provably unchanged" discipline, not just P2. P2's redirect generalization is de-risked structurally (share start / sibling completion), but the Drive default path + settlement memo must still be provably unchanged (R9/R14 gate P2). P3 extracts `scheduleAutoRefresh` + `installAuthWakeListener` — which coalesce through Drive's single-flight `pendingSilentRefresh` — so it must ship with a Drive-path-unchanged test (auto-refresh timing + wake single-flight identical before/after) mirroring R14.
- **`SyncStatusIndicator.vue` is dead code** — remove it as part of P1 (or explicitly note why not). Do not build the calendar surface by resurrecting it; mirror `GoogleReconnectToast`.
- **Toast dedupe must preserve the sticky-error + `MAX_VISIBLE=5` semantics.** Dedupe ignores a matching live toast; it must not silently drop a _different_ error, must not break the existing non-error trim, and **must exempt any toast carrying an `actionFn`** (interactive/Undo toasts) so a distinct action is never lost.
- **i18n:** every new string gets `en` + `beanie` in `uiStrings.ts`; use `t()` (and `fillTemplate` for the email/account placeholder). No bare strings — ESLint blocks them.
- **CIG:** Heritage Orange for the alert surface (never red; amber is not a brand colour). Squircle radii, soft shadows, Outfit/Inter per the approved mockup. rem-based text only.
- **ADR alignment:** ADR-024 (structured-error registry — reuse the typed-outcome pattern, don't invent bespoke catches), ADR-026 (iOS redirect: web arm carries routing in the OAuth `state`, secured by the confidential proxy `client_secret`, no PKCE verifier).
- **Reuse the calendar drawer's existing house patterns** (per the 2026-07-03 calendar-official plan): (a) store returns a typed outcome, view toasts from it; (b) store owns the toast + `reportError` then re-throws, view has a thin `catch`. Do not add a third pattern.

## Assumptions

> Review before implementation — valid at planning time, may have moved.

1. The `0.9.4R6` auth-kind fix + per-connection `dead`/`inflight`/`cache` maps are intact (`googleCalendarClient.ts:112-198`), so detection is correct and only surfacing/recovery need work. **Re-verify** the file hasn't regressed.
2. `notificationsStore.deriveNotifications` accepts additional derive inputs cleanly (its inputs are an explicit list at `:106-124`) and calendar health can be threaded in without a store-shape rewrite.
3. `GoogleReconnectToast` is the only live Drive reconnect surface and `SyncStatusIndicator.vue` is genuinely unused (grep found zero references). Re-grep before deleting.
4. The P2 seam holds: the START side (`startRedirectAuth` arg + `buildAuthUrl` scope) is safely shareable, and the COMPLETION side is safely sibling-able because a full-page redirect makes only one grant's code pending at a time. **Verify during P2 design** that no Drive consumer reads the calendar code key and that `redirectState`'s `grant` is decoded as `'drive'` when absent (deploy-boundary redirects). This is the load-bearing P2 assumption.
5. The calendar refresh token in the `CalendarConnection` CRDT record is sufficient for a silent reconnect attempt before falling back to redirect/popup (mirrors Drive's silent-first ladder).
6. Calendar's OAuth consent already includes `access_type=offline` + `prompt=consent` on its current popup path (`calendarAuth.ts:92-106`), so the redirect path inherits the same refresh-token guarantee.

## Approach

### P1 — user-awareness + no silent failure

**A shared reconnect toast (DRY + CIG).** Extract a presentational `ReconnectToast.vue` (proposed `src/components/common/`) from the current `GoogleReconnectToast.vue`: props for `icon`/`title`/`errorText?`/`busy`/`dismissible?` and emits `reconnect`/`dismiss`. Restyle to CIG Heritage Orange per the approved mockup (`rounded-2xl`, `border-left: 4px solid var(--orange)` / orange-tint icon chip, soft shadow). Then:

- **Drive** `GoogleReconnectToast.vue` becomes a thin wrapper that binds `useGoogleReconnect` to `ReconnectToast` — same mount at `App.vue:1496`, same gating, verified by an existing/added test that its behavior is unchanged (only colour changed).
- **Calendar** gets a sibling `CalendarReconnectToast.vue` that binds a new store-driven `showCalendarReconnect` computed + a reconnect handler to the same `ReconnectToast`, mounted in `App.vue` next to the Drive one. Mutual exclusivity/stacking with the Drive toast is handled the same way Drive's banner vs toast exclusivity already is.

**Originate the user signal as a pure computed off persisted status (single source of truth).** Calendar's `needs_reconnect` is a **persisted CRDT status** on the connection (`calendarSyncStore.ts:413-416`), self-healing to `ok` at `:485-491`. So the signal is a `computed(() => connections.value.some(c => c.status === 'needs_reconnect'))` (`showCalendarReconnect`) — **not** a transition-edge ref written inside `settleConnectionStatus`, and **not** keyed on `status:'error'` (see R1 — that would flap on transient failures). A computed is automatically fire-once (no per-poll stacking, no guard needed), self-heals on `→ ok`, and can never drift from real status or get stuck if a write throws. `settleConnectionStatus` therefore needs **no change**. (Drive uses a manual ref only because its signal comes from save-failure _timers_, not a persisted status — that rationale doesn't transfer.) The App-level `CalendarReconnectToast`, the bell derivation, and the Settings reconnect affordance all read this **one** computed — no surface independently recomputes "is this connection broken?". Keep the existing `reportError` telemetry (additive).

**Bell integration.** Calendar health becomes a first-class notification kind following the codebase's "one union member + one deriver block + one presentation" contract (`types/notifications.ts:11-12`, `notificationKinds.ts:2-4`): add a `NotificationKind` member; add a `DeriveInput` field (the calendar connections) + a deriver block (emit only for `status === 'needs_reconnect'`) + a stable id builder keyed by `connectionId` in `utils/notifications.ts`; register presentation/accent/label in `components/notifications/notificationKinds.ts` (Heritage-Orange accent, reuse `tint-orange-8`); and add `connections` to the `snapshot` in `notificationsStore.ts` (import `useCalendarSyncStore`). One entry per broken connection; clears automatically on self-heal (derivation is reactive off status). The bell action honors the **same `isConnectSupported` gate** as the Settings button (see interim gate) — on a redirect surface in P1 it routes to the desktop-capable explanation, never a dead-end toast.

**Toast dedupe.** In `useToast.ts` `showToast`: **before the `reportError` block (`:102-125`, not merely before the push at `:138`)** — otherwise a duplicated error toast double-pages `#beanies-errors` — check for a live toast with identical `type+title+message`. If one exists, **ignore the duplicate** (optionally update its `timestamp` for auto-dismiss toasts). No timer-handle tracking, no "×N" counter (the current code stores no timeout handle; refreshing one is needless bloat). Preserve sticky-error and `MAX_VISIBLE` trim semantics, and never drop a _different_ live error. **Critically: never dedupe an _interactive_ toast — any toast carrying an `actionFn` is exempt.** Several callers fire byte-identical success toasts each with a distinct Undo (`useContributeToGoal.ts:74` — constant title, `undefined` message; `useGiveDose.ts:63`); deduping them would silently discard the second toast's Undo — a silent failure. The reported dead-end "desktop browser" toasts are plain errors with no `actionFn`, so they still dedupe.

**Interim reconnect-button gate (removed in P2).** In `CalendarSyncSettings.vue`, gate the Reconnect button (`:272-280`) with the existing `store.isConnectSupported` (`calendarSyncStore.ts:222`). On a redirect surface, show the same `connectOnDesktop` explanatory affordance the Connect button already uses (`:319-324` — DRY, reuse that block), so the user gets an honest message and a working path (desktop) instead of a dead-end error toast. Delete this gate in P2.

**Guard the new reconnect handler (no silent failure).** The single App-level `CalendarReconnectToast` resolves its target as the **first `needs_reconnect` connection's id** (the bell's per-connection entries cover the rare 2+-broken case) — never call `reconnect(undefined)`. The binding calls `store.reconnect(connectionId)`, which (`calendarSyncStore.ts:533-555`) has **no try/catch** — `getCalendarConnectionById`/`updateCalendarConnection`/`getCalendarClient().invalidateConnection` can throw and would surface as an unhandled rejection with no user signal. Wrap the handler in try/catch → feed `ReconnectToast`'s `errorText` prop + `console.warn` + keep `reportError`, mirroring `useGoogleReconnect.ts:53-57`. (`connectGoogleCalendar` itself is documented never-throws; the surrounding store writes are not.)

**Success confirmation only on local reconnect.** The Settings path already toasts `calendarSync.toast.reconnected` on a local user-initiated reconnect (`CalendarSyncSettings.vue:105-109`) — keep it. A connection can also flip to `ok` **remotely** (another device reconnects → CRDT). Do **not** fire a success toast from the status computed on a remote heal — that is surprise noise and contradicts "only bother the user if absolutely required"; just let the computed drop the surface silently.

**Dead-code removal.** Remove the orphaned `SyncStatusIndicator.vue` (re-grep first).

### P2 — calendar grant on the redirect transport (share the start, sibling the completion)

**The seam (structural isolation over test-enforced isolation).** The redirect transport has three completion routes, and the shared ones carry the widest Drive blast radius: the per-page-load settlement memo `ensureRedirectAuthSettled`/`whenRedirectAuthSettled` (`googleAuth.ts:1943-1998`) runs `completeRedirectAuth()` and is awaited by ≥6 live Drive consumers (`syncStore.ts:611`, `offlineQueue.ts:244`, `connectStorage.ts:67`, `LoadPodView.vue:598`, `useJoinFlow.ts:375`, `App.vue:788`). Multiplexing that memo by grant means whichever Drive consumer hits it first at boot could consume a pending _calendar_ code and hand Drive a `null`. So:

- **Share the START side** (low risk, pure construction): add a `grant:'drive'|'calendar'` arg to `startRedirectAuth`; choose the scope set by grant in `buildAuthUrl` (`googleAuth.ts:1565-1596`). Drive call sites default to `'drive'` and are byte-identical.
- **Persist the grant THROUGH the bounce.** On the web/PWA bounce, `OAuthCallbackPage.vue:58-63` today extracts only `returnPath` from the OAuth `state` and stashes the bare `code` into the single `REDIRECT_AUTH_CODE_KEY` — the grant is **not** available to `completeRedirectAuth` on the web path. Fix: `OAuthCallbackPage` writes the code into a **grant-namespaced key** (or writes a grant tag alongside it).
- **Sibling the COMPLETION side** (keep Drive untouched): `completeRedirectAuth`/`ensureRedirectAuthSettled` stay Drive-only and byte-identical. Add `completeCalendarRedirectAuth` with its **own** memo, reading the calendar code key and committing to the `CalendarConnection` record. Because a full-page redirect navigates away to start _either_ grant, only one grant's code key can ever be populated — isolation is a property of the design, not of a test.
- **`redirectState` compatibility:** `encodeRedirectState`/`decodeRedirectState` (`redirectState.ts:33-83`) reject unknown `REDIRECT_STATE_VERSION`. Add `grant` as **additive-optional** — a v1 state from a pre-P2 build (redirect crossing the deploy boundary) has no `grant` and must decode as `'drive'`; do **not** bump the version. Calendar carries the grant discriminator and either an omitted/optional `mode` or a calendar-appropriate value — not a fabricated `mode:'reconnect'` (that field is Drive-onboarding-specific).
- **Three completion routes, all grant-aware:** (1) web bounce (`OAuthCallbackPage` → grant-namespaced key), (2) web memo (Drive) vs the new sibling memo (calendar), (3) **native `appUrlOpen` deep-link** (`googleAuth.ts:~2009+`), which validates CSRF `state` and calls completion directly — it must route by grant to the calendar completion too. P2 covers web + PWA + native; if native calendar proves large, it may be split to an explicit follow-up, but the routing must not be left implicit.

Wire `connectGoogleCalendar` + calendar reconnect through `shouldUseRedirectAuth()` → `startRedirectAuth(returnPath, loginHint, { grant:'calendar' })` on redirect surfaces, popup on desktop. Make the post-redirect resume **reactive** (SPA-safe — not `onMounted`-only, per the native `router.replace` caveat). Remove the interim P1 gate in both places (R10). Ship with the Drive-protection test suite (R14).

### P3 — proactive/wake refresh parity

Extract Drive's `scheduleAutoRefresh` + `installAuthWakeListener` into a shared keep-warm helper parameterized by a token source + refresh fn, coalesced single-flight per connection. **Ship with a Drive-path-unchanged test** (Drive auto-refresh timing + wake single-flight identical before/after the extraction) — same discipline as R14. Calendar registers each active connection. Also in P3: implement the calendar beanpod token-mirror (R16) and, with the calendar silent path now existing, do the deferred shared grant-parameterized reconnect-ladder extraction from `useGoogleReconnect` (R11) — or document deferral with rationale.

## Files Affected

**P1**

- `src/components/common/ReconnectToast.vue` — **new** shared presentational toast (CIG Heritage Orange).
- `src/components/google/GoogleReconnectToast.vue` — refactor to wrap `ReconnectToast` (amber → orange; behavior unchanged).
- `src/components/common/CalendarReconnectToast.vue` — **new** calendar binding of `ReconnectToast`.
- `src/App.vue` — mount `CalendarReconnectToast` (exclusivity with the Drive toast handled as Drive's toast/banner exclusivity already is).
- `src/stores/calendarSyncStore.ts` — add a `showCalendarReconnect` **computed** off connection status + a guarded reconnect handler wrapper. `settleConnectionStatus` unchanged.
- `src/types/notifications.ts` — new `NotificationKind` union member (calendar health).
- `src/utils/notifications.ts` — new `DeriveInput` field (calendar connections) + deriver block + `connectionId`-keyed id builder.
- `src/components/notifications/notificationKinds.ts` — presentation/accent (`tint-orange-8`)/label for the new kind.
- `src/stores/notificationsStore.ts` — import `useCalendarSyncStore`; add `connections` to the `snapshot`.
- `src/composables/useToast.ts` — dedupe in `showToast` (before the `reportError` block).
- `src/components/settings/CalendarSyncSettings.vue` — gate Reconnect button (interim); reuse `connectOnDesktop` block.
- `src/services/translation/uiStrings.ts` — new `en`+`beanie` keys (toast title/sub/error, bell entry, self-heal confirmation).
- `src/components/common/SyncStatusIndicator.vue` — **delete** (orphaned).
- Tests: `ReconnectToast` render; Drive toast behavior-unchanged; calendar toast show/hide/self-heal; toast dedupe; notification derivation for calendar health.

**P2**

- `src/services/google/googleAuth.ts` — add `grant` arg to `startRedirectAuth`; scope-by-grant in `buildAuthUrl`; **new** `completeCalendarRedirectAuth` + its own memo. `completeRedirectAuth`/`ensureRedirectAuthSettled` (Drive) unchanged.
- `src/pages/OAuthCallbackPage.vue` — write the code into a grant-namespaced key (or a grant tag alongside it) so the grant survives the bounce.
- `src/services/google/redirectState.ts` — `grant` additive-optional, absent → `'drive'`, no version bump.
- Native deep-link handler (`googleAuth.ts` `appUrlOpen`) — route completion by grant.
- `src/services/calendar/calendarAuth.ts` — remove `redirect_unsupported`; route redirect surfaces through `startRedirectAuth({grant:'calendar'})` + `completeCalendarRedirectAuth`.
- `src/components/settings/CalendarSyncSettings.vue` — remove interim gate (button); reconnect works on PWA.
- Bell action — remove interim gate (so both surfaces un-gate together).
- Post-redirect resume wiring (`App.vue` / calendar store) — reactive, SPA-safe.
- `src/composables/useGoogleReconnect.ts` — **not refactored in P2** (calendar ladder is redirect/popup-only; shared extraction deferred to P3).
- Tests: Drive-protection suite (Drive slot/state/scope/consent + settlement memo unchanged; two code keys can't co-populate); calendar redirect connect + reconnect on web/PWA/native.

**P3**

- `src/services/google/` — shared keep-warm helper (extracted from `googleAuth.ts`), with a Drive-path-unchanged test.
- `src/stores/calendarSyncStore.ts` / calendar token provider — register connections with the helper.
- `src/composables/useGoogleReconnect.ts` — deferred shared grant-parameterized ladder extraction (now that the calendar silent path exists).
- Calendar beanpod token-mirror (mirrors `driveTokenRecovery.ts` shape) — or documented deferral.

**Design input**

- `docs/mockups/calendar-reconnect-surfaces-2026-07-11.html` — the approved P1 mockup.

## Help Center Coverage

The behavior change lands in **P2** (reconnecting Google Calendar now works on phone/PWA, not just desktop) and there is a user-facing recovery flow worth documenting.

- **Action**: `update existing` (the Google Calendar sync article from the 2026-07-03 calendar-official work) — add a short **troubleshooting** section; create a dedicated troubleshooting article only if the update would overload the existing one.
- **Category**: `features` (or `security` if the existing article lives there)
- **Article type** (if new): `troubleshooting`
- **Slug**: update existing calendar article; if new, `google-calendar-reconnect`
- **Title**: "Reconnecting Google Calendar"
- **Scope**: Why a calendar connection can drop (Google occasionally requires re-consent), how you'll be told (the reconnect toast + notification), and how to reconnect in one tap on any device.
- **Notes**: Make clear reconnecting is safe and non-destructive (beanies stays the source of truth; nothing is deleted), and that it's the same one-tap flow everywhere. Ships **with P2**, not as a follow-up.

## Acceptance Criteria

**P1**

- [ ] A calendar connection dropping to `needs_reconnect` (dead grant only — never a transient `error`) shows the shared reconnect toast **once** (not per poll) and adds **one** bell notification — both without opening Settings.
- [ ] On recovery the surface silently drops and the bell entry clears automatically; a success confirmation fires **only** on a local user-initiated reconnect (never on a remote self-heal).
- [ ] `showToast` deduplicates identical `type+title+message` toasts (no stacking); sticky-error + `MAX_VISIBLE` semantics preserved.
- [ ] Drive's reconnect toast is now Heritage Orange via the shared `ReconnectToast`, with a test proving no behavioural change.
- [ ] The Settings Reconnect button never produces a dead-end "desktop browser" error toast on a redirect surface (interim gate).
- [ ] `SyncStatusIndicator.vue` removed; no dangling references.
- [ ] All new strings have `en`+`beanie`; lint/type-check/tests green.

**P2**

- [ ] On an installed PWA / iOS / native, **connect** and **reconnect** for Google Calendar complete via the redirect transport with one tap and no "desktop browser" message.
- [ ] The Drive redirect path is provably unchanged (storage slot, state, scope, `prompt=consent`) — dedicated tests pass.
- [ ] A calendar redirect in flight can never consume/overwrite a live Drive redirect (and vice-versa) — test proves isolation.
- [ ] Post-redirect, the pending calendar action resumes automatically (SPA-safe), no second prompt.
- [ ] Interim P1 button gate removed.
- [ ] Help Center article updated/added and matches shipped behavior.

**P3**

- [ ] Calendar tokens refresh ~5 min before expiry and on wake events, single-flight per connection — matching Drive's aggressiveness (verified by test/instrumentation).
- [ ] Beanpod token-mirror implemented or its deferral documented with rationale.

## Testing Plan

1. **Unit** — `ReconnectToast` renders each state (idle/busy/error/success); Drive-toast wrapper behavior unchanged (snapshot/behavioural); `showToast` dedupe (identical plain toast → ignored; **two identical toasts each with a distinct `actionFn` both survive**; different → push; error stickiness; `MAX_VISIBLE` trim); `notificationsStore` derives + clears a calendar-health entry off connection status. **`showCalendarReconnect` computed** is true whenever any connection is `needs_reconnect` (true once, independent of poll count) and self-heals to false on `→ ok`. **Pass-4 guard (must-have): a connection at `status:'error'` (transient) raises neither the toast nor a bell entry — only `needs_reconnect` does.** **Multi-connection: with 2 connections one `needs_reconnect`, the computed is true and one bell entry appears; it clears only when _all_ broken connections recover.**
2. **P2 auth tests** — Drive `startRedirectAuth('drive')` produces the identical scope/state/consent + settlement-memo behavior as before; calendar `startRedirectAuth({grant:'calendar'})` uses its own scope + grant-namespaced code key; `OAuthCallbackPage` routes each grant's code to its own key; a pre-P2 v1 `redirectState` (no `grant`) decodes as `'drive'`; the Drive settlement memo never reads the calendar code key; native `appUrlOpen` routes completion by grant.
3. **Manual (dev + installed PWA + iOS)** — force a `needs_reconnect` (revoke grant or seed status): confirm toast + bell appear once, reconnect completes on PWA (P2), self-heal clears both, and no toast stacking on repeated taps.
4. **Regression** — full Drive sign-in/load/reconnect on desktop + PWA + native unchanged after P2.
5. `npm run type-check`, `npm run lint`, unit suite, and the calendar + google auth test files green at each phase.

## Implementation Progress & Resume

> **Read this first when resuming.** Snapshot as of 2026-07-11.

### P1 — ✅ DONE, merged to `main`, pushed, live-verified

Commit `c651a6b9` on `main` (pushed to origin). Live-verified via Playwright: the reconnect toast surfaces once and self-heals, the bell badges and clears. Full suite 3728 passed, build compiles. Shipped: shared `ReconnectToast.vue` (Drive migrated onto it), `CalendarReconnectToast.vue`, `showCalendarReconnect` store computed (`needs_reconnect`-only), `calendar-reconnect` bell kind, `showToast` dedupe (actionFn-exempt), interim Settings/bell gate, deleted orphaned `SyncStatusIndicator.vue`. **Not deployed** (awaiting an explicit deploy).

### P2 — 🚧 IN PROGRESS on branch `calendar-drive-parity-p2` (off `main` @ `c651a6b9`)

**Done on the branch:** commit `f4554420` — grant-aware redirect state (`redirectState.ts` + tests). `grant` is additive-optional (Drive byte-identical, absent→`'drive'`, no version bump). 12 codec tests pass. **Zero behaviour change yet** — nothing passes `grant:'calendar'` until the items below land.

**Remaining P2 items (tasks #10–#14), in order. The seam: share the START side, sibling the COMPLETION side (see the P2 Approach above).**

1. **Start-side threading** (task #10): add optional `grant: RedirectGrant = 'drive'` to `startRedirectAuth` (`googleAuth.ts:1807`); scope-by-grant in `buildAuthUrl` (`:1565`, scope hardcoded at `:1576`) — pass the scope in (or select by grant) to avoid a `googleAuth`↔`calendarAuth` import cycle; encode `grant` into the web `state` (`:1844`) and add `grant` to the native `RedirectAuthState` stash (`:1783`, written `:1825`). Drive callers pass nothing → unchanged.
2. **Bounce** (task #11): `OAuthCallbackPage.vue` `stashCode` (`:22`) currently writes the bare `REDIRECT_AUTH_CODE_KEY` (`googleAuth.ts:50`). Read `decoded.grant` (`:58`) and write the code into a **grant-namespaced key** (e.g. `${REDIRECT_AUTH_CODE_KEY}:calendar`) so the calendar code can't collide with a Drive code.
3. **Sibling completion** (task #12): add `completeCalendarRedirectAuth` + its own memo, reading the calendar code key and committing to the `CalendarConnection` record (NOT the Drive token). Leave `completeRedirectAuth` (`:1854`) + `ensureRedirectAuthSettled` (`:1964`) / `whenRedirectAuthSettled` (`:1988`) Drive-only and byte-identical (≥6 Drive consumers await them). Route native `handleNativeAuthRedirect` (`:2041`) by the stash's `grant`.
4. **Wire calendar** (task #13): in `calendarAuth.ts` remove the `redirect_unsupported` gate (`:168-173`); on a redirect surface route connect + reconnect through `startRedirectAuth({grant:'calendar'})` + `completeCalendarRedirectAuth`. Make the post-redirect resume reactive (SPA-safe). Remove the P1 interim gate in **both** the Settings button (`CalendarSyncSettings.vue`) **and** the bell action.
5. **Drive-protection tests + verify** (task #14): assert Drive's start scope/state/consent + settlement memo unchanged; the two code keys can't co-populate; native routes by grant; calendar connect+reconnect on web/PWA/native. Full suite + build + **live-verify Drive sign-in/load/reconnect is unchanged** before merging.

**Do NOT merge P2 to `main` until task #14 is green and Drive auth is live-verified.**

### How to resume

```bash
git checkout calendar-drive-parity-p2      # foundation commit f4554420 is here
# then: re-read this section + the "P2 — calendar grant on the redirect transport" Approach above,
# and continue at item 1. Task list #10–#14 tracks the same steps.
```

Caveats that still bind (from Important Notes above): never weaken `forceConsent`; `prompt=consent` invariant holds for calendar; no UA-sniff pre-warns; the web no-PKCE path is safe ONLY via the confidential proxy `client_secret` (ADR-026).

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the phased P1/P2/P3 plan from the three-agent investigation + approved mockup + greg's three decisions (phased, generalize redirect infra, unify toast on Heritage Orange); corrected the reference surface from the orphaned `SyncStatusIndicator` to the live `GoogleReconnectToast`.
- **Pass 2 (DRY + error handling)**: Verified all reuse claims against source. Replaced the transition-edge ref with a pure `showCalendarReconnect` computed off persisted CRDT status (fires-once + self-heals for free, no `settleConnectionStatus` change); made toast/bell/Settings read that one computed (single source of truth); expanded the bell work to the full "kind + deriver + presentation" contract (4 files); moved toast dedupe ahead of the `reportError` block and dropped the timer/×N bloat; corrected the ladder description (beanpod `tryReconnectSilently` → redirect → popup) and self-heal location (`syncStore.ts:2669-2675`); added a guarded reconnect handler (store.reconnect can throw) and a bell-action gate (no dead-end on PWA); scoped the Drive recolour as a discrete cosmetic-only commit; success toast only on local reconnect, silent on remote heal.
- **Pass 3 (Sustainability)**: Redesigned the P2 seam — instead of multiplexing the shared settlement memo that ≥6 Drive consumers block on (a test-enforced isolation that erodes), share only the START side (`grant` arg + scope-by-grant `buildAuthUrl`) and **sibling the completion** (grant-namespaced code key + a `completeCalendarRedirectAuth` memo), making grant isolation structural. Added: grant must survive the `OAuthCallbackPage` bounce (+ that file to P2); `redirectState.grant` additive-optional, absent → `'drive'`, no version bump; native `appUrlOpen` named as the third grant-aware completion route; deferred the `useGoogleReconnect` shared-ladder extraction to P3 (calendar silent step doesn't exist until then) so P2 doesn't half-build across the boundary; P2 removes the interim gate in **both** Settings + bell; gave P3's Drive-refresh extraction the same "provably unchanged" test gate as P2.
- **Pass 4 (Fresh-eyes sweep)**: Caught a real correctness bug — keying the signal on `status:'error'` (not just `needs_reconnect`) would flap a re-consent CTA on the first transient network/rate-limit blip (`error` is written unconditionally; only Slack paging is sustained-gated) and offer re-auth as a remedy for a non-auth failure it can't fix; scoped the computed + bell deriver to `needs_reconnect` only. Reconciled the P1 acceptance criterion so no one implements a remote-heal success toast (success confirmation is local-reconnect-only). Confirmed the rest — P2 grant seam, additive-optional `redirectState.grant`, dedupe placement, guarded `store.reconnect`, `SyncStatusIndicator` removal — sound and ready.
- **Pass 5 (Extra integrity pass, greg-requested)**: Caught a new side effect — the toast dedupe would silently discard distinct **Undo** actions on byte-identical interactive toasts (`useContributeToGoal.ts:74`, `useGiveDose.ts:63`); added an **`actionFn` exemption** (interactive toasts never dedupe) to R5, Approach, caveats, and a test. Fixed a stale Testing-Plan assertion that still tested the abandoned transition-edge ref (would have re-introduced the removed design) — retargeted it to the `showCalendarReconnect` computed, and added the missing **Pass-4 guard test** (`status:'error'` raises nothing) + a multi-connection case. Specified the App-level toast resolves the first `needs_reconnect` connection id (no `reconnect(undefined)`). Verified P2 structural isolation holds on all three completion routes (incl. native `appUrlOpen` reading `stored.grant` from `REDIRECT_AUTH_KEY`, `googleAuth.ts:2044-2124`) and mapped every original requirement to a plan section — no gaps.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt

> I noticed today that my live client has disconnected from google calendar, and it seems to have done so completly silently. There was no indication on my screen that calendar events were not being pushed. When I checked in settings, i could see that there was a message that the calendar was not connected, and when i tried to reconnect it said i needed to reconnect from the desktop site, which doesn't make sense - why can't we re-consent from the PWA or mobile if needed? see screenshot at /tmp/google-cal-disconnect.jpg for the error toast. This appears to be a major silent failure with no recovery path (at least on the PWA). Can you please perform a full, holistic, and comprehensive investigation and ensure that there are no silent failures, that the connection leverage or re-uses as much as possible from the google drive modules/functions/composables/etc to ensure the same level of robustness and consistent connectivity, and that all operations can be performed on the app/pwa/mobile as can be performed on the desktop? There should be no different in the way we refresh aggresively and avoid bothering the user between calendar and drive, and also to ensure the user is aware if the connection does get lost for any reason, prompting them for a simple re-consent, but only if absolutely required.

### Follow-up (decisions via questions)

> Phasing: "Phased, ship P1 first." Redirect risk: "Generalize the shared infra." Toast colour: "Unify both on Heritage Orange."

</details>
