# Plan: Drive Connectivity Robustness — Install Nudge (A) + Refresh Token in Beanpod (B)

> Date: 2026-06-12
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-06-12-drive-connectivity-robustness.md`

> **No GitHub issue created.** This plan was approved for direct implementation. Full prompt history is in the `## Prompt Log` section.

## User Story

As a beanies.family user (especially on iPhone), I want my Google Drive connection to stay reliably connected once I've consented, so that I am not repeatedly asked to reconnect / re-grant access — without any change to the privacy model and without degrading the connection robustness that already works today.

## Context

Two integrations store Google OAuth refresh tokens very differently:

- **Calendar** stores its refresh token **inside the encrypted `.beanpod` CRDT doc** (`calendarConnections[].refreshToken`), so it survives a local-storage wipe and is shared across devices.
- **Drive** stores its refresh token **only in browser-local storage** — IndexedDB (`googleRefreshToken-{familyId}`) + a localStorage fallback (`beanies_grt_{familyId}`), per ADR-020 / ADR-028. This is already fairly robust (survives reload/restart/reboot, and we already call `navigator.storage.persist()` in `App.vue:700`).

The dominant real-world failure is **iOS Safari ITP eviction**: on a _non-installed_ site, iOS evicts ALL script-writable storage (IndexedDB + localStorage together) after ~7 days of non-use, which wipes the Drive refresh token and forces a re-consent. An **installed** PWA is exempt.

This plan implements two complementary improvements, deliberately scoped so **A is the real iPhone fix** and **B is broad defense-in-depth + reconnect-smoothing**:

- **A — Harden against eviction.** Confirm/observe `navigator.storage.persist()`, and add a **one-time, gentle, dismissible iOS install nudge** so iPhone users install the PWA (which is exempt from ITP eviction). This is the single highest-leverage change for the iPhone problem.
- **B — Store the Drive refresh token in the beanpod (mirroring calendar), keyed per Google account.** Acts as a recovery copy (restore a lost local token from the synced doc) and lets reconnect flows try the shared token silently **before** forcing a Google consent screen. Cannot remove the unavoidable first-consent-per-device bootstrap, and cannot rescue an iOS non-installed device whose doc cache was evicted in the same sweep — so it is explicitly framed as defense-in-depth + UX-smoothing, not the iPhone silver bullet.

### Honest scope boundary (must be preserved in copy + comments)

- **A** fixes the iPhone eviction case (install → ITP-exempt).
- **B** helps: non-iOS eviction, partial/bug-induced local-store clears, token-store schema migrations, **same-Google-account multi-device recovery** (member A connects on desktop → A's iPhone, signed in as the same Google account, recovers without re-consent on next sync), and **turning many forced-consent reconnects into silent recoveries**. It does **not** bootstrap a cold device and does **not** beat a full iOS ITP sweep on a non-installed device.

## Requirements

### Global (safety-first)

1. **Purely additive. Zero regression.** The existing ADR-020/028 local-storage token flow remains the primary, unchanged path. Every new behavior is a best-effort layer that, on any failure, falls through to today's exact behavior. No new step may block, delay materially, or break token acquisition, silent refresh, reconnect, sign-out, or sync.
2. **No privacy-model change.** No token leaves the device except into the already-encrypted `.beanpod` (same AES-256-GCM family-key envelope the calendar token already uses). Nothing is stored server-side.
3. **No silent failures, but no Slack noise on expected fall-throughs.** Every new code path that can fail is wrapped (try/catch or equivalent) and degrades to the current behavior with actionable context. **Severity discipline:** best-effort recovery layers (B2–B6) that simply fall through to today's behavior report at `severity: 'warning'` (mirroring `useCommunityNudge.ts:119`'s localStorage-write reporter) — NOT the default `'error'`, which fires a Slack POST + a user-facing error toast (`errorReporter.ts:6`). Only genuine corruption (e.g. an IndexedDB read _throwing_ mid-recovery, like `googleAuth.ts:883`) warrants default `'error'`. Expected-absence conditions (persist denied, no doc yet) use a bare `console.warn` + optional one-shot Plausible event, never `reportError` (the pattern `useNotifications.ts:59` already uses for the Badging API). No empty catch blocks.

### A — Persistent storage + iOS install nudge

4. **Observe persistent-storage outcome.** Extend the existing `App.vue` `navigator.storage.persist()` call so a **denied** result is observable in telemetry. Denial is the _normal_ state on every non-installed browser, so do NOT route it through `reportError` (that would Slack-spam + error-toast a non-error). Use a bare `console.warn` + a one-shot Plausible event (e.g. `storage_persist_denied`), mirroring `useNotifications.ts:59`. Also add the missing `.catch()` to the existing `persist().then(...)` chain (today it has none — an unhandled rejection; fixing it serves the no-silent-failures mandate). Timing unchanged, non-blocking.
5. **One-time iOS install nudge.** For users detected as **iOS Safari AND not installed (not standalone)**, surface a single, gentle, dismissible nudge in the existing notifications bell that explains installing keeps them reliably connected, with actions: **"Show me how"** (deep-links the existing `getting-started/install-as-app` help article, iOS anchor), **"Not now"** (dismiss), **"Already installed"** (dismiss permanently). It must never nag: once dismissed/actioned it does not reappear.
6. **Reuse, don't reinvent.** The nudge reuses the existing notification-nudge infrastructure (mirror `useCommunityNudge` / `CommunityNudgeBody.vue` / the `communityNudge` notification kind), the existing iOS/standalone detection, the existing help article, and i18n. No new bespoke UA-sniff helper — consolidate the existing duplicated iOS detection into one shared utility (see Approach §B0).
7. **Mockup before UI.** Per standing preference, an HTML mockup of the nudge (light/dark, mobile width) is produced and approved **before** the nudge UI is implemented.

### B — Drive refresh token in the beanpod

8. **Per-account storage.** Store Drive refresh tokens in a new CRDT collection `driveConnections`, **keyed by Google account** (deterministic id derived from the lowercased account email), each entry `{ id, accountEmail, refreshToken, issuedAt, createdAt, updatedAt }`. NEVER a single family-wide token. Mirror the `calendarConnections` storage/encryption pattern exactly (relies on the `.beanpod` envelope encryption; no extra wrapping).
9. **Account-matched recovery only.** A device may only read/restore a doc token whose `accountEmail` matches the Google account the current member is bound to. The bound email is `member.googleAccountEmail` on the current `FamilyMember` record (read via the family store) — there is **no** getter on `googleAccountAssertion.ts` (it exports only `register/arm/disarm`). A token for account A must never be used by a device acting as account B.
10. **issuedAt wins on reconcile.** Both the doc entry and the local store carry `issuedAt`. Reconciliation (doc↔local) always keeps the **newer** `issuedAt`, so a stale CRDT-merged token never overwrites a fresher local one and vice-versa.
11. **Best-effort doc write on every acquisition/rotation.** Whenever a refresh token is obtained or rotated (popup, redirect, silent rotation), in addition to the existing local write, write it to the doc entry for that account — **only if** the doc + family key are currently available; otherwise skip silently (the local write already succeeded; the doc copy syncs on the next acquisition). The doc write must never throw into the acquisition path.
12. **Single recovery seam (cold start).** After the doc is loaded and decrypted at startup, reconcile the bound account's token doc↔local (newer `issuedAt` wins). This is the one place a lost local token is restored from the doc. (Plus an opportunistic fallback in the lazy silent-refresh recovery path — see Approach §B4 — gated to the bound account.)
13. **Smooth reconnects.** At each reconnect/re-pick/switch-account seam that currently forces `prompt=consent`, FIRST attempt a silent refresh using the doc/local token for the **expected** account; only if that fails fall back to today's forced-consent flow unchanged. This must preserve the ADR-028 guarantee (a successful forced consent still establishes a refresh token); the doc token it uses was itself established by a prior consent.
14. **Lifecycle parity.** The doc `driveConnections` entry for an account is cleared exactly when the local token is cleared for a _deliberate_ reason: explicit disconnect and sign-out for that family/account. It is **NOT** cleared on a transient/`invalid_grant` failure of one device (mirror the calendar rule: never delete the shared token on one device's auth failure; let a successful mint self-heal). On a genuine permanent `invalid_grant`, clearing follows the same conservative rule as calendar — park, don't aggressively delete the shared copy — so another device / a later reconnect can still recover.

## Important Notes & Caveats

- **Bootstrap is unavoidable.** Every device needs one Drive consent to first fetch the beanpod; you can only read the doc token _after_ you already have Drive access (or a surviving local doc cache + family key). B is recovery/continuity, never bootstrap. Do not write copy implying "connect once on any device, ever."
- **The per-account guard (Req 9) is the single most important correctness constraint.** Multi-member families have multiple Google accounts; the beanpod may be a shared file accessed via per-account Picker grants. A shared/global token would let device B attempt account A's token and fail (or worse, mis-bind accounts). Key by account and match-on-recovery, always.
- **Startup ordering trap.** `googleAuth.initializeAuth(familyId)` runs in `syncStore.initialize()` **before** the doc is loaded from cache (`loadFromPersistenceCache` is later in `loadFamilyData`). So the doc-recovery read **cannot** live in `initializeAuth` — the doc isn't decrypted yet. It must live at/after the doc-load seam (Req 12) and/or in the lazy silent-refresh recovery path (which runs once a token is actually needed, by which time the doc is loaded).
- **Doc-write availability trap.** During first-time onboarding/connect, a token can be acquired _before_ the doc/family key exist. The doc write must be strictly conditional on availability and never throw — the local write is always primary.
- **CRDT full-doc shape tests.** Adding `driveConnections` touches `ALL_COLLECTIONS`, the `initDoc` literal, the `FamilyDocument` type, and the full-doc literal in `docService.test.ts` (and any other full-shape assertions). All must be updated together or those tests break.
- **iOS detection duplication exists today** (in `googleAuth.shouldUseRedirectAuth`, `PwaReinstallModal.vue`, `usePWA.ts`). Consolidate into one helper rather than adding a fourth copy.
- **`prompt=consent` invariant (ADR-028).** Do not weaken it. The smooth-reconnect change adds a silent attempt _before_ the existing forced-consent call; it does not replace or alter the forced-consent call itself.
- **Nudge is a deliberate, user-approved exception** to the "no upfront capability banners" guideline in CLAUDE.md. Keep it minimal, gentle, dismissible, one-time, and in the bell (not a blocking modal/banner).
- **No new Google scopes.** Drive scope set is unchanged (`drive.file` + `userinfo.email`).

## Assumptions

> **Review these before implementation.** Valid at planning time (2026-06-12); may have changed.

1. The calendar token-in-doc pattern (`calendarConnections[].refreshToken`, relying on `.beanpod` AES-256-GCM encryption) remains the approved precedent and Drive should mirror it (user-confirmed "match the calendar pattern").
2. `navigator.storage.persist()` is still called once in `App.vue` (~line 700) and is non-blocking.
3. The existing `getting-started/install-as-app` help article still exists with an iOS section/anchor and is accurate.
4. The notification-nudge infrastructure (`useCommunityNudge`, `CommunityNudgeBody.vue`, `communityNudge` kind in `notificationKinds.ts`, per-member localStorage state) is still the canonical pattern for a dismissible bell nudge.
5. The bound Google account is `member.googleAccountEmail` on the current `FamilyMember` record (read via the family store); `googleAccountAssertion` enforces it but exposes no getter.
6. Startup ordering is unchanged: in `syncStore.initialize()`, `googleAuth.initializeAuth(familyId)` (loads the local token) runs **before** `loadFromPersistenceCache`/`loadCachedDoc` (decrypts the doc) — so the doc-recovery read must live at/after the doc-load seam, never in `initializeAuth`.
7. Google still returns a refresh token only with `access_type=offline` + `prompt=consent`, and multiple refresh tokens per account can be valid simultaneously (so a doc copy and a local copy for the same account don't conflict).
8. User explicitly chose: **B = also smooth reconnects** (silent-before-forced-consent), **proactive one-time iOS nudge**, **token stored matching the calendar pattern** (no extra wrapping).

## Approach

### A0 — Persistent-storage observability (tiny)

In `App.vue` where `navigator.storage.persist()` is called: keep the call and timing identical; in the `.then(granted => …)`, when `granted === false`, emit a one-shot `console.warn` + Plausible `storage_persist_denied` event (NOT `reportError` — denial is normal on non-installed browsers and would Slack-spam + error-toast). Add the currently-missing `.catch()` to the promise chain (swallow + `console.warn`). Optionally read `navigator.storage.persisted()` once for the log. No behavioral change.

### B0 — Consolidate iOS / standalone detection (DRY prerequisite for A)

Extend **`src/services/sync/capabilities.ts`** (the existing single seam for platform/native detection per ADR-029 — do NOT add a parallel `platform.ts`, which would re-create the very duplication this kills). Add **granular primitives**, not one fused boolean:

- `isIosOrIpadOs(): boolean` — the existing iOS/iPadOS UA logic (from `googleAuth.shouldUseRedirectAuth` ~`:235-238`, incl. the `MacIntel + maxTouchPoints > 1` iPad-desktop-UA heuristic).
- `isStandalone(): boolean` — `(display-mode: standalone)` matchMedia OR legacy `navigator.standalone`.
- `isIosSafariNotInstalled(): boolean` — `isIosOrIpadOs() && !isStandalone()` (this is the nudge's gate).

**Why granular:** the three existing call sites are NOT the same predicate and must not be flattened — `shouldUseRedirectAuth` is `isNative() || isIosOrIpadOs() || isStandalone()` (must stay true for native + standalone + iPad-desktop-UA), `PwaReinstallModal.vue` needs a 3-way `'ios'|'android'|'desktop'`, `usePWA.ts` needs only `isStandalone()`. **Consolidate all three in this plan** (not deferred): refactor each to consume the shared primitives while preserving its own composition exactly (behavior-preserving; keep their tests green). Adding the primitives but leaving the three copies would create a _fourth_ concept without removing the three — strictly worse. The refactor is bounded by the existing tests staying green; do it now while the context is loaded.

### A1 — iOS install nudge (mirror the community nudge)

- **State/composable:** `useInstallNudge.ts`. Reuse ONLY `useCommunityNudge`'s **I/O idiom** — `loadState`/`saveState`/`commit` error handling (`useCommunityNudge.ts:30-126`) + per-member key. Do **NOT** carry over its cadence machinery (`decideIssue`, `nextDueAt`, `shownCount`, `CAP`, `randomIntervalMs`) — those exist only because Discord is recurring; copying them leaves vestigial fields a future maintainer must puzzle over. The install nudge is one-time: per-member JSON state is just `{ schemaVersion, status: 'pending' | 'dismissed' | 'installed' }`, and the whole gate is one line (below).
- **Gate + issuance:** do NOT re-derive "session ready / not on a public page." Drive issuance from the **existing** session-ready watcher in `useNotifications.ts:101-114` (which already gates on `ready()` and suppresses under `e2e_auto_auth`) by calling a new `installNudge.ensureNudgeIssued()` alongside `communityNudge.ensureNudgeIssued()`. The composable's own pure gate is just `isIosSafariNotInstalled() && status === 'pending'`. Status flips to `installed` if standalone is ever detected (self-cancels post-install).
- **Surface:** a new `installNudge` notification kind (mirror `communityNudge` end-to-end) → detail body `InstallNudgeBody.vue` (mirror `CommunityNudgeBody.vue`): short copy + "Show me how" (→ help article), "Not now" (→ dismissed), "Already installed" (→ installed). Registering a kind requires the FULL surface the `notificationKinds.ts:1-7` doc-comment enumerates: the `NotificationKind` union member in `types/notifications.ts`, the deriver block + an id helper in `utils/notifications.ts` (mirror `communityNudgeId`), the entry in `notificationKinds.ts`, and a resolver branch in `useNotificationPresentation.ts` (mirror the `nudgeMessage` branch ~`:52-55`).
- **External open:** reuse `MARKETING_URL` from `@/utils/marketing` and the same external-open wrapper `CommunityNudgeBody` uses (`openDiscord`-style `window.open`); the exact help URL `${MARKETING_URL}/help/getting-started/install-as-app` is already built in `PwaReinstallModal.vue:33` — reuse, don't duplicate the string.
- **i18n:** add `installNudge.*` source strings (en + beanie) to `uiStrings.ts`, mirroring the `communityNudge.*` block; run `npm run translate` to regenerate.
- **Telemetry:** mirror the community nudge's Plausible events (shown/dismissed/cta).
- **Mockup:** produce `docs/mockups/install-nudge-2026-06-12.html` (light/dark, mobile) and get approval before building the Vue.

### B — Architecture: one new module, `googleAuth.ts` gains zero functions

**All** new Drive-token-in-doc logic (B2 mirror, B3/B4 recovery, B5 silent-reconnect, B6 clear) lives in **one new module `src/services/google/driveTokenRecovery.ts`**. It depends on `googleAuth`'s _public_ surface (`onTokenAcquired`, `attemptSilentRefresh`, `getGoogleRefreshToken`/`storeGoogleRefreshToken`) + `driveRepository` + `isDocLoaded`. `googleAuth.ts` itself gains **no** new functions and **no** import of the Automerge layer — it only keeps emitting `onTokenAcquired`, which the new module subscribes to. This keeps the 1700-line OAuth state machine (the entire §13 regression surface) untouched, gives the reviewer one file for "all new recovery behavior," and makes the layer independently testable without standing up the auth module. The module is wired up once (subscribe + the syncStore reconcile call); seams call into it.

### B1 — CRDT schema: `driveConnections`

**Atomic schema-touch checklist** (all change together or full-doc tests break — `grep` for existing full-shape literals first):

1. `src/types/models.ts` — `DriveConnection` interface.
2. `src/types/automerge.ts` — `driveConnections` on `FamilyDocument`.
3. `src/services/automerge/docService.ts` — `ALL_COLLECTIONS` add + `initDoc` literal `driveConnections: {}`.
4. `src/services/automerge/__tests__/docService.test.ts` — full-doc literal.
5. Any other full-shape `FamilyDocument` literal a grep surfaces.

- `src/types/models.ts`: add `DriveConnection` interface `{ id: UUID; accountEmail: string; refreshToken: string; issuedAt: number | null; createdAt: ISODateString; updatedAt: ISODateString }` (mirror `CalendarConnection`, minus the calendar-specific fields). Document that `refreshToken` lives in the already-encrypted `.beanpod`, exactly like the calendar token.
- `src/types/automerge.ts`: add `driveConnections: Record<string, DriveConnection>` to `FamilyDocument`.
- `src/services/automerge/docService.ts`: add `'driveConnections'` to `ALL_COLLECTIONS` and `driveConnections: {}` to the `initDoc` literal. **No separate migration code needed** — `migrateDoc` (`docService.ts:113`) auto-backfills any `ALL_COLLECTIONS` member that is missing on an already-existing beanpod, so old docs gain `driveConnections: {}` for free.
- `src/services/automerge/repositories/driveRepository.ts` (new): mirror `calendarRepository.ts` — a `createAutomergeRepository('driveConnections', …)` plus a deterministic id `driveConnectionId(accountEmail)` that is a **plain normalized (lowercased + trimmed) email string**, NOT a hash (mirrors `calendarEventLinkId`'s plain-string composite at `calendarRepository.ts:46`; the email is already stored cleartext in `accountEmail` within the same encrypted doc, so hashing the key buys nothing). Idempotent `upsertDriveConnection({ accountEmail, refreshToken, issuedAt })` via `createWithId`/`update`. Export `getDriveConnectionByAccount(email)`, `upsertDriveConnection`, `removeDriveConnectionByAccount`.
- Update full-doc shape tests (`docService.test.ts` literal, plus any other full-shape assertions) to include `driveConnections: {}`.

### B2 — Best-effort doc write on acquisition/rotation (additive)

**Implemented as an `onTokenAcquired` subscriber** registered by `driveTokenRecovery.ts`. `googleAuth` already emits `onTokenAcquired(email, token, interactive)` with the OAuth-verified email after every acquisition (`googleAuth.ts` ~`:1254`; `googleAccountAssertion.ts:108` is an existing subscriber). Subscribing (vs. threading a call into each acquisition path) gives DRY account resolution (verified email handed in, no extra userinfo round-trip) and a hook that structurally cannot throw into the acquisition path.

`mirrorRefreshTokenToDoc(accountEmail)` — **a dumb mirror, not a reconciler:**

- **Gate on `interactive === true`** (the flag `onTokenAcquired` already passes, `googleAuth.ts:1265`). Only popup/redirect acquisitions rotate/establish a refresh token; silent refreshes (`interactive === false`) do NOT rotate it, so mirroring them would re-upsert the identical token every ~1h → needless CRDT change + sync round-trip (steady-state churn). Skipping silent acquisitions keeps B2 zero-cost on the happy path.
- Guard: if no `accountEmail`, skip.
- Guard: only proceed if `isDocLoaded()` (non-throwing, `docService.ts:156`), NOT `getDoc()` (throws when no doc, `:145`). If not loaded, skip silently (local write already succeeded; the copy syncs on the next acquisition).
- Read the just-stored local token (`getGoogleRefreshToken`) and **unconditionally upsert** it via `driveRepository.upsertDriveConnection`. The token was just minted, so it is by definition the newest — there is no conflict to resolve here. **`issuedAt`-newer-wins lives ONLY in B3 reconcile**, so the precedence rule has exactly one owner (mental model: B2 = mirror, B3 = reconcile).
- Wrapped; on error `reportError` (`severity: 'warning'`) + return — never propagate.

(The subscriber fires for popup/redirect acquisitions — `performPopupAuth`, `completeRedirectAuth`, `requestAccessToken` direct branch — exactly the `storeGoogleRefreshToken` sites at `googleAuth.ts:441/656/732/1567`. `performSilentRefresh` does NOT persist/rotate the refresh token, so there is no silent-rotation site.) The local `storeGoogleRefreshToken` write stays first and unconditional.

### B3 / B4 — Recovery (ONE shared read primitive, two call points)

**Mandatory single primitive** (not "ideally"), in `driveTokenRecovery.ts`: `readDriveTokenFromDoc(boundEmail): Promise<StoredRefreshToken | null>` — returns the same `{ token, issuedAt }` shape the local store uses (`fileHandleStore.ts:200`). It does the repo read, then applies a **pure, dependency-light** guard `matchesBoundAccount(entry, boundEmail): boolean` (normalized-email compare — case-fold + trim + null/missing handling; no I/O, no store access). **Returns `false` if either side normalizes to empty/whitespace** (so an unbound device can never read an unbound `''` doc entry via `'' === ''`). `boundEmail` is **passed in** by each caller (resolved from the family store at the call site), so the primitive never imports the family store. B3, B4, B5 ALL call `readDriveTokenFromDoc`, so there is exactly one read path and one guard. The pure `matchesBoundAccount` is the unit-test target for the cross-account invariant — exhaustively testable (wrong-account, case, trim, null, missing-entry) with zero mocking.

**B3 — cold-start reconciliation (the primary recovery seam).** Call `reconcileDriveTokenWithDoc(boundEmail)` **after `reloadAllStores()`** in `syncStore.loadFromPersistenceCache` (after `:955`, NOT right after `loadCachedDoc` at `:939`), and the equivalent post-store-load point in `loadFromFile`. **Why after stores load:** `boundEmail = member.googleAccountEmail` reads the family store's `currentMember`, which is only populated by `reloadAllStores()`; calling earlier would read an empty member and silently skip — turning the _primary_ recovery seam into a no-op exactly when it matters.

- `boundEmail` = `member.googleAccountEmail` (optional, `models.ts:119`) for the current member (from the family store; NOT a `googleAccountAssertion` getter — none exists). If still absent (e.g. first connect, or not yet backfilled by the assertion subsystem), skip — **B4 is the backstop** (it runs lazily post-acquisition, once the email is resolved/backfilled).
- Read doc (`readDriveTokenFromDoc`) and local (`getGoogleRefreshToken`); keep the newer `issuedAt`.
- Doc newer / local missing → `storeGoogleRefreshToken(familyId, token, { issuedAt })` + update in-memory `currentRefreshToken`. Local newer → mirror local → doc (B2 helper).
- Wrapped; failure → `reportError` (`warning`) + fall through.

Safe because by this seam the family key + doc are decrypted and `googleAuth.initializeAuth` has already run.

**B4 — lazy fallback in silent refresh (opportunistic).** In `performSilentRefresh`'s existing in-memory-null IDB-recovery branch: if `getGoogleRefreshToken` still yields nothing AND `isDocLoaded()` AND a bound email exists, call the same `readDriveTokenFromDoc(boundEmail)` as a last resort before giving up. Covers a token needed before B3's seam ran. Same guard (free — it's in the primitive); wrapped; failure → existing return-null → existing escalation.

### B5 — Smooth reconnects (silent-before-forced-consent)

`driveTokenRecovery.ts` exposes `tryReconnectSilently(boundEmail): Promise<boolean>`:

- Load the token for the bound account via `readDriveTokenFromDoc` (account-matched); if local is empty/stale, seed in-memory `currentRefreshToken` from it.
- Call the **existing** `attemptSilentRefresh()` (already deduped via `pendingSilentRefresh` + retry/backoff — `googleAuth.ts:847`). Do NOT build a parallel "direct refresh."
- Return **`true` on success, `false` otherwise** — and callers branch on that **explicit return value** (no reliance on a side-effected `isTokenValid()` flipping elsewhere).

Insert a call **before** the existing forced-consent call at **three** seams (the riskiest two are deliberately out of scope — see below), falling through to the unchanged forced-consent path on `false`:

- `useGoogleReconnect.reconnect()` — before `requestAccessToken({ forceConsent: true })` / `startRedirectAuth`.
- `usePickBeanpodFile.pick()` — already has `if (!forceConsent) { token = await tryGetSilentToken() }` at `:75-76`; seed the doc token (account-matched) immediately before that `tryGetSilentToken()`.
- `connectStorage.beginDriveAuthRedirectIfNeeded` (`:51-57`) — the redirect surface (iOS/PWA), so the most valuable for the iPhone case. Wire it **explicitly**: `if (tryReconnectSilently(boundEmail) === true) return false /* skip redirect */`, rather than relying on the silent refresh's side effect on `isTokenValid()` (action-at-a-distance; a future refactor could silently break it — cf. the `driveFileId` warning at `syncStore.ts:174`).

**Out of scope (deferred — committed, not a judgment call):**

- **`googleAccountAssertion` mismatch path** — highest risk (sits inside the `correcting` re-entry guard at `:44` that prevents assertion→re-consent→assertion loops; would require token-email re-validation and new flag interactions), smallest payoff (account-mismatch is the rarest reconnect trigger). Left exactly as-is. Future work only.

Each insertion is a single guarded pre-step with an explicit boolean; the existing forced-consent code is untouched and remains the fallback, preserving ADR-028.

### B6 — Lifecycle (clear/park) parity

- **Sign-out / explicit disconnect (DELIBERATE only):** call `driveTokenRecovery.clearDriveConnectionForAccount(boundEmail)` from the **deliberate** callers only — `authStore` sign-out (`:901/:1009`) and `googleDriveProvider.disconnect()` (`:287`) — mirroring `calendarSyncStore.disconnect`'s `removeCalendarConnection` (`:518`). Wrapped; best-effort (`warning`).
- **⚠️ Do NOT hook the doc-clear into `clearGoogleSessionState()` itself, nor into `syncStore.disconnect()`.** Two reasons: (1) `syncStore.disconnect()` does NOT actually clear the local Drive token (only queue/folder/envelope/familyKey) — the real local-token chokepoint is `clearGoogleSessionState()` (`googleAuth.ts:1170`); and (2) `clearGoogleSessionState()` is ALSO called on the **transient account-mismatch correction** at `googleAccountAssertion.ts:164` — putting the doc-clear inside the shared chokepoint would delete another account's shared doc token during a transient correction, violating Req 14 and the assertion-deferral. So the doc-clear lives at the two deliberate callers, never the shared chokepoint.
- **Transient / single-device `invalid_grant`:** do NOT delete the doc entry (mirror calendar's "never delete the shared token on one device's failure"). The existing local clear on `invalid_grant` (`googleAuth.ts:983`) is unchanged; the doc copy persists so another device / a later silent reconnect can recover. Leave the entry; let `issuedAt`/a successful mint self-heal.

## Files Affected

**A:**

- `src/App.vue` — report persist denial (A0); wire the install nudge into the notifications setup (mirror community nudge wiring).
- `src/services/sync/capabilities.ts` — shared `isIosOrIpadOs()` / `isStandalone()` / `isIosSafariNotInstalled()` primitives (B0). (No new `platform.ts` — capabilities.ts is the single platform seam.)
- `src/services/google/googleAuth.ts`, `src/components/common/PwaReinstallModal.vue`, `src/composables/usePWA.ts` — refactor to consume the shared iOS/standalone primitive (B0).
- `src/composables/useInstallNudge.ts` (new) — one-time nudge state machine (mirror `useCommunityNudge` JSON-state idiom).
- `src/components/notifications/InstallNudgeBody.vue` (new) — detail body (mirror `CommunityNudgeBody.vue`).
- `src/types/notifications.ts` — add `installNudge` to the `NotificationKind` union.
- `src/utils/notifications.ts` — `installNudge` deriver block + `installNudgeId` helper (mirror `communityNudge`).
- `src/components/notifications/notificationKinds.ts` — register the `installNudge` kind.
- `src/composables/useNotificationPresentation.ts` — resolver branch (mirror `nudgeMessage`).
- `src/stores/notificationsStore.ts`, `src/composables/useNotifications.ts` — bind `useInstallNudge` + call `ensureNudgeIssued()` from the existing session-ready watcher.
- `src/utils/marketing.ts` (reuse `MARKETING_URL`) — no change, consumed by the nudge body.
- `src/services/translation/uiStrings.ts` + generated zh — `installNudge.*` strings.
- `docs/mockups/install-nudge-2026-06-12.html` (new) — mockup (pre-implementation).

**B:**

- `src/types/models.ts` — `DriveConnection` interface.
- `src/types/automerge.ts` — `driveConnections` on `FamilyDocument`.
- `src/services/automerge/docService.ts` — `ALL_COLLECTIONS` + `initDoc` literal.
- `src/services/automerge/repositories/driveRepository.ts` (new) — mirror `calendarRepository.ts`.
- `src/services/google/driveTokenRecovery.ts` (**new — all B2/B3/B4/B5/B6 logic lives here**): `mirrorRefreshTokenToDoc` subscriber (B2), pure `matchesBoundAccount` + `readDriveTokenFromDoc` (B3/B4), `reconcileDriveTokenWithDoc` (B3), `tryReconnectSilently` (B5), `clearDriveConnectionForAccount` (B6). Depends only on googleAuth's public surface + `driveRepository` + `isDocLoaded`.
- `src/services/google/googleAuth.ts` — **no new functions; no Automerge import.** Only continues emitting `onTokenAcquired` (the subscriber hook). (Wire the subscriber registration once, e.g. where other `onTokenAcquired` subscribers are set up.)
- `src/stores/syncStore.ts` — invoke `reconcileDriveTokenWithDoc(boundEmail)` after `reloadAllStores()` in `loadFromPersistenceCache`/`loadFromFile` (B3). (No B6 clear here — `syncStore.disconnect()` doesn't clear the local token.)
- `src/stores/authStore.ts` (sign-out `:901/:1009`) and `src/services/sync/providers/googleDriveProvider.ts` (`disconnect()` `:287`) — call `clearDriveConnectionForAccount(boundEmail)` (B6, deliberate callers only). **Not** `clearGoogleSessionState()` / `googleAccountAssertion.ts` (shared chokepoint — would delete on the transient mismatch path).
- `src/composables/useGoogleReconnect.ts`, `src/composables/usePickBeanpodFile.ts`, `src/services/sync/connectStorage.ts` — silent-before-forced-consent pre-step (B5, three seams). **NOT** `googleAccountAssertion.ts` (deferred, out of scope).
- Tests: `docService.test.ts` (full-doc literal), new `driveRepository.test.ts`, new `driveTokenRecovery.test.ts` (the pure `matchesBoundAccount` cross-account guard + reconcile precedence + best-effort fall-throughs — testable without the full auth module), `useInstallNudge` pure-gate test.

## Help Center Coverage

- **Action**: update existing
- **Category**: getting-started
- **Slug**: `install-as-app` (existing)
- **Title**: Install beanies.family as an app (existing)
- **Scope**: Add a short line in the iOS section explaining that installing the app keeps you reliably signed in to Google Drive (avoids periodic reconnects caused by Safari clearing website data). Frames the _why_ behind the new nudge from the user's point of view.
- **Notes**: Do not over-promise ("you'll never reconnect"); say installing makes the connection more durable. No mention of token internals.

## Acceptance Criteria

- [ ] All existing tests green (especially the full `googleAuth`/`syncStore`/`docService` suites in the §13 regression checklist) with zero behavioral change to the existing local-token flow.
- [ ] `navigator.storage.persist()` denial is reported to telemetry; the call is otherwise unchanged and non-blocking.
- [ ] One shared `isIosSafariNotInstalled()` helper exists; the three prior UA-sniff copies consume shared primitives (or the DRY-debt is logged if deferred).
- [ ] iOS install nudge appears once for iOS-Safari-non-installed users, in the bell, with the three actions; never reappears after dismiss/installed; self-cancels once standalone is detected. Mockup approved before UI built.
- [ ] `driveConnections` collection added; full-doc shape tests updated; `driveRepository` mirrors `calendarRepository`.
- [ ] Drive refresh tokens are written to the doc keyed by Google account on acquisition/rotation, **best-effort and never throwing into acquisition**; local write remains primary.
- [ ] Cold-start reconciliation restores a lost local token from the doc **only for the bound account**, newer-`issuedAt` wins.
- [ ] The three in-scope reconnect seams (`useGoogleReconnect`, `usePickBeanpodFile`, `connectStorage` redirect) attempt a silent recovery (account-matched, explicit boolean) before forcing consent, and fall through to the unchanged forced-consent flow on failure (ADR-028 preserved). The `googleAccountAssertion` mismatch path is unchanged (deferred).
- [ ] Doc entry cleared on explicit disconnect/sign-out; NOT cleared on a single device's transient `invalid_grant`.
- [ ] No cross-account token use is possible (covered by a dedicated test: account-A token never used when bound to account B).
- [ ] No new Google scopes; no server-side storage; no privacy-model change.
- [ ] Help article `install-as-app` updated per Help Center Coverage.
- [ ] `npm run validate` green.

## Testing Plan

1. **Regression (must stay green):** run the full §13 checklist from the googleAuth map — startup load, `__pending__` migration, silent refresh (dedup, retries, `invalid_grant`, IDB recovery), popup/redirect auth, clear/sign-out, failure escalation, banner raise/auto-clear, account assertion, offline-queue flush.
2. **B2 write:** acquiring a token (popup + redirect) writes a `driveConnections` entry for the right account with `issuedAt`; doc-unavailable case skips silently without throwing.
3. **B3 recovery:** simulate local token missing but doc entry present (bound account) → cold-start reconcile restores local; newer-`issuedAt` precedence both directions; wrong-account doc entry is ignored.
4. **B4 fallback:** token needed before reconcile seam, local empty, doc present → silent refresh recovers; account mismatch → no recovery, existing escalation path.
5. **B5 smooth reconnect:** with a valid doc token, the three in-scope seams (reconnect / re-pick / connect-redirect) complete WITHOUT a consent screen; with a revoked token, they fall back to forced consent exactly as today. (Assertion mismatch path deferred — verify it is unchanged.)
6. **B6 lifecycle:** explicit disconnect/sign-out removes the doc entry; a single-device `invalid_grant` does NOT (another device still recovers).
7. **Cross-account guard:** exhaustive pure-unit test of `matchesBoundAccount` — wrong-account, case-fold, trim, null/missing entry, AND empty/whitespace-both-sides → all non-matching; a device bound to account B never reads/uses account A's doc token.
   7b. **No-regression on the iPhone redirect seam:** `tryReconnectSilently` with `boundEmail` undefined / no doc loaded returns `false` and `connectStorage.beginDriveAuthRedirectIfNeeded`'s redirect path is byte-for-byte unchanged (pins the prime directive on the exact path that motivated the plan).
8. **A nudge:** pure-gate unit test (iOS-Safari-non-installed + pending → show; installed/dismissed/desktop/standalone → no show; self-cancel on standalone). Manual: iPhone Safari shows the bell nudge once; "Show me how" opens the help article; dismiss/installed never reappears; installed PWA never shows it.
9. **A persist:** verify denial path reports (mock `persist()` resolving false).
10. **Manual cross-device (same Google account):** connect on desktop; on a second device signed in as the same Google account with the doc synced, confirm reconnect is silent. Manual multi-member: confirm member B is never offered member A's connection.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted A (persist observability + one-time iOS install nudge reusing the community-nudge infra + DRY consolidation of iOS detection) and B (per-account `driveConnections` CRDT collection mirroring calendar, best-effort doc-write on acquisition, single cold-start reconciliation seam, lazy silent-refresh fallback, silent-before-forced-consent at reconnect seams, conservative lifecycle clearing), all framed as strictly additive with fall-through to today's behavior; surfaced the per-account-keying correctness guard, the startup-ordering trap, and the bootstrap boundary.
- **Pass 2 (DRY + error handling)**: Verified all reuse claims against the codebase. Implement B2 as an `onTokenAcquired` subscriber (DRY email resolution, can't throw into acquisition); mandated ONE shared `readDriveTokenFromDoc` primitive across B3/B4/B5; corrected the bound-email source to `member.googleAccountEmail` (no `googleAccountAssertion` getter exists); put detection primitives in `capabilities.ts` (granular, not one fused boolean — the 3 callers differ); fixed error-severity discipline (`warning` for best-effort fall-throughs, no `reportError`/Slack-spam for expected persist-denial); reused `useNotifications` `ready()`/`ensureNudgeIssued` seam + the full `communityNudge` kind surface (added `types/notifications.ts`, `utils/notifications.ts`, `useNotificationPresentation.ts` to Files Affected); plain-email id (no hash); `migrateDoc` auto-backfills the new collection; flagged the assertion-mismatch seam as the riskiest insertion (skip if `correcting`/email-revalidation can't be guaranteed); reuse `attemptSilentRefresh` not a parallel refresh.
- **Pass 3 (Sustainability)**: Concentrated ALL new Drive-recovery logic into one new `driveTokenRecovery.ts` module so `googleAuth.ts` gains zero functions and never imports the Automerge layer (keeps the 1700-line OAuth state machine + its whole regression surface untouched); split the critical guard into a pure, dependency-light `matchesBoundAccount(entry, email)` (exhaustively unit-testable, no mocking) with `boundEmail` passed in; **deferred the `googleAccountAssertion` mismatch seam entirely** (highest-risk/lowest-payoff — inside the `correcting` loop guard) and made `connectStorage`'s skip an **explicit boolean** instead of an `isTokenValid()` side-effect; made B2 a dumb unconditional mirror with newer-wins owned solely by B3; committed the three-site detection refactor (no DRY-debt deferral); stripped vestigial cadence fields from `useInstallNudge`; turned the schema-touch sites into one atomic checklist. Net: surface on load-bearing paths shrank from "5 new functions across 2 giant files + 4 seams" to "1 new module + 3 explicit seams."
- **Pass 4 (Fresh-eyes sweep)**: One real correctness fix + four cheap hardenings. **B6 clear-site relocated** — hook only the deliberate sign-out/`googleDriveProvider.disconnect` callers, NEVER `clearGoogleSessionState()`/`syncStore.disconnect()` (the former is also hit by the deferred transient assertion-mismatch path → would delete a shared token on a transient correction; the latter doesn't clear the local token anyway). **B3 reconcile moved after `reloadAllStores()`** (else `member.googleAccountEmail` is empty and the primary recovery seam no-ops). **B2 gated on `interactive === true`** (silent refreshes don't rotate the token → avoid ~hourly CRDT churn). `matchesBoundAccount` returns false on empty/whitespace both-sides. Added tests: empty-both-sides guard case + a no-regression test that an absent `boundEmail` leaves the iPhone redirect path byte-identical. Confirmed B2 can't throw into acquisition (subscribers already wrapped, `googleAuth.ts:1264`).

## Implementation Notes (2026-06-12 — as built)

Three deliberate, documented deviations from the plan-as-written, all in the direction of _less_ surface on the load-bearing auth path:

1. **B4 (lazy silent-refresh fallback) omitted.** Given the verified startup ordering, B3's `reconcileDriveTokenWithDoc` runs at the doc-load seam **before** `backgroundSyncFromFile` needs the token, and on the cache-miss path the doc isn't decrypted yet (so a doc-read couldn't help). A separate B4 hook would have forced recovery logic into `performSilentRefresh` inside `googleAuth.ts` for negligible marginal coverage — contradicting Pass 3's "keep `googleAuth` Automerge-free" win. B3 covers the cold-start recovery.
2. **B6 (doc-clear) scoped to `googleDriveProvider.disconnect()` only**, not the sign-out path. On sign-out the in-memory doc is discarded (so a clear wouldn't persist to Drive anyway) and the token is overwritten on next sign-in — so clearing there is marginal and would touch a sensitive path. `disconnect()` is the true "deliberate remove Drive" action and knows its own `accountEmail`. Still NOT inside `clearGoogleSessionState` (the transient-mismatch chokepoint).
3. **One tiny pure setter added to `googleAuth.ts`: `primeRefreshToken(familyId, stored)`** — a 2-line in-memory state assignment (no I/O, no Automerge import) so `driveTokenRecovery` can seed a recovered token before `attemptSilentRefresh` without reaching into `googleAuth`'s private state. A state setter, not recovery logic, so it preserves the encapsulation Pass 3 asked for.

**Built + validated:** all of A0/A1/B0/B1/B2/B3/B5/B6. New tests: `driveRepository.test.ts`, `driveTokenRecovery.test.ts` (cross-account guard matrix + reconcile precedence + B5 no-regression), `useInstallNudge.test.ts`. `npm run validate` green (type-check, lint 0 errors, format, full unit suite, production build).

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial prompt (invocation)

> /beanies-plan — let's do a plan to implement A and B carefully to improve robustness, but being extremely careful that we do not introduce any bugs or side effects that alter or degrade the current funcitonality and robustness. The goal is to make overall connectivity more robust and persistent in many cases, especially on iphones, where the grant is lost more aggressively. pls run through the plan carefully to ensure we are not introducing unintended side effects

### Context (prior turn) — the A/B options being referenced

"A" = harden against eviction (confirm `navigator.storage.persist()` + drive PWA install on iOS, the ITP-exempt fix). "B" = store the Drive refresh token in the beanpod as a recovery copy, mirroring the calendar token, enabling family/same-account self-heal and silent reconnects. Both derived from the prior Drive-vs-calendar token-storage analysis.

### Clarifying answers (this turn)

- B integration: **Also smooth reconnects** (try the shared doc token silently before falling back to forced consent).
- iOS nudge: **Proactive one-time nudge** (detect iOS Safari non-installed, show a gentle dismissible install tip once).
- B token storage: **Match the calendar pattern** (rely on the existing `.beanpod` AES-256-GCM family-key encryption; no extra wrapping).

</details>
