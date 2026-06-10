# Plan: Google Calendar Integration — One-Way Push (#32)

> Date: 2026-06-10
> Related issues: Notion #32 (this plan); launch-coupled sibling Notion #34 (external-calendar clash nudge, free/busy)
> Plan file: `docs/plans/2026-06-10-google-calendar-integration.md`
>
> **No GitHub issue created.** This plan was approved for direct implementation (Notion tracker is the issue system; `github issue = do not create`). Full prompt history is embedded under **Prompt Log**.

## User Story

As a user, I can't break the habit of using my Google Calendar — it's still the first thing I see when I open my phone — but I still like using beanies to track my family activities. So I want my beanies activities to sync to one or more of my Google calendars, automatically pushed from beanies, so my family and I stay organized in the calendar we already use.

## Context

beanies.family is the family's golden source for activities, but many users (greg included) keep entering events in Google Calendar out of habit. Rather than fight that, we meet them where they look: beanies **pushes** its activities into the Google calendar(s) they already use, one-way.

Design direction was settled in a 2026-06-10 discussion (full decision log lives in the Notion #32 row Notes):

- **One-way push only.** beanies stays the single golden source. Two-way sync is rejected by design (echo loops, conflict resolution beanies can't arbitrate, a second dumb CRDT fighting Automerge).
- **Into the user's EXISTING calendar** (default: their primary), NOT a dedicated/shared "beanies calendar" — deliberately avoiding the "two calendars in one" friction that confuses non-technical users (sharing invites, enabling checkmarks, "which ones can I edit"). Connect → events just appear.
- **Multiple connections.** A "connection" = one Google account the user can authenticate; push to ALL connected calendars at once.
- **Privacy posture:** OAuth `calendar.events.owned` (write only events the app owns); beanies only ever creates/updates its own events and never reads or lists the rest of the calendar. Calendar scopes are "sensitive" not "restricted" → one-time Google OAuth verification, no annual CASA audit. Client-side push: event data goes device → the user's own Google account directly, never through a beanies server.
- **Family-wide connections.** A connected calendar is a shared family resource: all family activities push to it regardless of who created them (it's the family's schedule, not a per-member feed). The connection — including its token — lives in the shared `.beanpod` so any family device keeps every calendar fresh and the token survives a local-storage clear.
- **Launch-coupled with #34.** The consent also requests `calendar.freebusy` so the sibling clash-nudge feature (#34) builds on the same connections with no second consent. Both verify in ONE submission; the base push does not ship to the public ahead of #34. (The freebusy _behavior_ is #34's scope, not this plan.)
- **Behind a feature flag.** Ships gated by the #31 dev-flag system (`googleCalendarSync`, committed prod-off) so it can land incrementally and flip on at launch alongside #34.

## Requirements

1. Users can connect, modify, and remove one or more Google calendar integrations from **Settings**.
2. **Family-wide:** ALL family activities (created / edited / deleted by any member) are pushed to **all** connected calendars — a connected calendar is a shared family resource, not a per-member filter (no "only my events" filter in v1; possible future per-connection toggle). Default destination = the connected account's primary calendar; the user can change it per connection (uses `calendar.calendarlist.readonly`, Caveat 3).
3. **All** activity data is pushed. Fields with no native calendar field (pickup, drop-off, who's paying, instructor + contact, fees, assignees, notes) are formatted into a clean, human-readable block in the event **description**.
4. Every beanies-created event carries a "Synced from beanies.family" note in the description plus a link to open the beanies app.
5. The push engine is **idempotent**: the same activity never produces duplicate events, including across multiple devices, via a **deterministic event id** derived from the activity id (Google allows setting the event id on insert).
6. The engine only ever creates / updates / deletes events **it** created (addressed by deterministic id). It never scans, reads, or modifies the user's other events.
7. A manual edit to a beanies event in Google is **restored** to beanies' values on the next sync (golden source). A manual delete is **re-created**.
8. Recurring activities map to **native Google recurrence (RRULE)** with per-instance exceptions, not expanded into many separate events.
9. Disconnecting a calendar **cleanly removes** the events beanies created in it.
10. Sync runs **client-side while the app is open** (reconcile-on-open + on activity change), directly device → the user's Google account, never via a beanies server.
11. Connections are **family-wide** (a connected calendar receives all family activities regardless of creator) and the **refresh token is stored in the encrypted `.beanpod`** so any family device keeps every calendar fresh and the token survives a local-storage clear without re-consent. (greg-confirmed; see Layer 2 ✅.)
12. The connection layer requests `calendar.events.owned` + `calendar.freebusy` + `calendar.calendarlist.readonly` at consent. The Drive flow's scopes are unchanged.
13. The entire feature ships **behind a dev feature flag** (the #31 system) — off in prod until launch-ready (and gated together with #34 per the launch-coupling).
14. A Help Center article exists. Unit + (within-budget) E2E tests are written and pass.

## Important Notes & Caveats

1. **`googleAuth.ts` is single-account; do NOT extend its singleton.** It holds ONE refresh token per family (the Drive account), a module-level in-memory access token, and a scope string **hardcoded** in `buildAuthUrl` (`drive.file + userinfo.email`). Calendar needs N independent account connections, each a possibly-different Google account with its own refresh token + scope set. We **reuse the primitives** (`pkce.ts`, `oauthProxy.ts` `exchangeCodeForTokens`/`refreshAccessToken`, `shouldUseRedirectAuth()`, the redirect-resume transport) but build a **separate multi-account connection registry**. Connecting a calendar must never disturb the Drive token/session.
2. **Parametrize the OAuth scope.** `buildAuthUrl` (and the popup/redirect entry points) hardcode the Drive scopes. Extract the scope set into a parameter (default = today's Drive scopes, preserving every existing call site byte-for-byte) so a calendar-connect flow can request calendar scopes without touching Drive behavior. The Drive flow keeps validating `drive.file`; the calendar flow validates `calendar.events.owned`.
3. **✅ RESOLVED (greg) — destination-calendar picker uses a third scope `calendar.calendarlist.readonly`.** Requirement 2's "let the user change the destination calendar" requires _listing_ the account's calendars (a `BaseSelect` of calendar names), which neither `calendar.events.owned` nor `calendar.freebusy` can do. greg approved adding `calendar.calendarlist.readonly` (sensitive, read-only calendar _metadata_ — names only, never events) to the consent bundle. **Final scope set: `calendar.events.owned` + `calendar.freebusy` + `calendar.calendarlist.readonly`** (3 scopes, one verification submission).
4. **Multi-account ≠ Drive account.** A connected calendar account may be the same Google account as Drive or different. Tokens, scopes, and state are tracked **per connection**, fully independent of Drive's single-account state.
5. **Deterministic event id constraints.** Google event ids must be base32hex (chars `a-v`, `0-9`), 5–1024 chars, lowercase, and unique per calendar. Derive deterministically from the activity UUID (e.g. `b` + base32hex(uuid-hex)) so two devices produce the _same_ id → the second `insert` 409s instead of duplicating. Uniqueness is per-calendar, so `f(activityId)` is sufficient (the calendar is implied by which calendar we insert into).
6. **No silent failures.** Every push/list/delete is wrapped; failures are classified via a structured error registry (mirror `useJoinFlow`'s `JOIN_ERRORS` pattern → `CALENDAR_SYNC_ERRORS`), logged with a `[calendarSync]` prefix + `reportError`, and surfaced as a per-connection status in Settings ("Last synced …" / "Needs reconnect" / "Sync error — retry"). Auth-expired → a per-connection reconnect affordance that re-runs `calendarAuth` with that connection's own refresh token — **NOT** `useGoogleReconnect` (Drive-bound; would corrupt the Drive session). 429 → backoff/retry via `timing.ts`. Never a bare `catch {}`.
7. **Conflict markers are explicitly OUT.** The deterministic-id engine never inspects foreign events, so overlapping events are normal and are NOT flagged. Double-booking awareness is split out (see #34 + the separate beanies-native overlap feature).
8. **Stay In Production (do not switch the OAuth app to Testing).** Publishing status is app-wide and Testing's 7-day token expiry would break existing Drive users; the new calendar scopes carry the unverified-app warning + 100-user cap until verified, which is the beta gate. (Operational, not code — recorded for the implementer's awareness.)
9. **Recurrence mapping is the fiddliest area.** The override-child model (`parentActivityId` + `originalOccurrenceDate`) must map to Google recurring-event exceptions. Get the mapping behind a pure, exhaustively-tested util.
10. **Whole-`.beanpod` restore / family-switch — orphaned events AND a reverted shared token (Pass 4 + Pass 3 re-run).** `replaceDoc()` swaps the document wholesale, so `calendarEventLinks` AND the `CalendarConnection` records (incl. `refreshToken`/`grantedScopes`/`status`) revert to the snapshot — but the **real Google events do not**. Two effects: (a) links present live-but-absent-in-snapshot become orphaned remote events beanies no longer knows it owns (won't delete them) → next on-open reconcile is authoritative and **tolerates orphans** (disconnect/GC must NOT assume `calendarEventLinks` is complete); document that a full restore can leave stray events needing manual cleanup. (b) the restored `refreshToken` may be **revoked or rotated-away** (or `needs_reconnect` reverted to `ok`) → the post-restore reconcile must treat a restored token as **unverified**: attempt one mint, and on failure go straight to `needs_reconnect` rather than retry-storming.

## Assumptions

> **Review these before implementation.** Valid at planning time (2026-06-10); may have drifted.

1. The Lambda OAuth proxy (`oauthProxy.ts`) exchanges/refreshes tokens for **any** requested scope set, not just Drive — i.e. it forwards whatever scopes Google returns. (Verified — no `drive.file` hard-filter.) **BLOCKING: it must issue NON-rotating refresh tokens** (confidential web client) — the shared-token design depends on it; verify before building (Layer 2 ⚠️).
2. The `.beanpod`/Automerge family document can hold the new `calendarConnections` (incl. refresh token) + `calendarEventLinks` collections via `createAutomergeRepository` (greg-confirmed token-in-`.beanpod`; see Layer 2 ✅).
3. `FamilyActivity` carries everything we need to render an event (confirmed: `title`, `date`/`endDate`/`isAllDay`/`startTime`/`endTime`, `recurrence`/`daysOfWeek`/`recurrenceEndDate`, `parentActivityId`/`originalOccurrenceDate`, `assigneeIds`, `pickup`/`dropoffMemberId`, `instructorName`/`instructorContact`, `location`, `feeAmount`/`feeCurrency`, `notes`, `reminderMinutes`).
4. The "open this activity in beanies" link is produced by the existing `entityDeepLink('activity', id)` util (`src/utils/entityDeepLink.ts`, tested) — no hand-rolled URL.
5. Google OAuth verification for the calendar scopes is greg's out-of-band task (checklist in the Notion #32 Notes); not blocking code, but gating public launch.
6. The dev feature-flag system (#31): `isFlagEnabled`/`readOverride`/`validateFlagConfig` live in **`src/config/flags.ts`** (generic — DO NOT edit); the two files to edit are **`src/config/flagRegistry.ts`** (add the `googleCalendarSync` registry entry) + **`src/config/featureFlags.committed.ts`** (add `googleCalendarSync: false`). Read model: `isFlagEnabled(flag) = override ?? (DEV ? true : COMMITTED_FLAGS[flag] === true)`.

## Approach

Built in layers, each independently testable. The push engine depends on a **`CalendarClient` interface** (not the Google SDK directly) so it's unit-testable with a fake and the Google specifics are isolated (DRY + testability + future provider swap for Outlook/Apple).

### Layer 1 — Auth: multi-account calendar OAuth (compose the primitives, keep `googleAuth` Drive-only)

**Decision (resolving Pass-1's "OR"): the calendar layer COMPOSES the low-level primitives directly — it does NOT thread a scope param through `googleAuth`'s Drive functions.** Reason: `drive.file` is asserted in **three** `googleAuth` sites (`performPopupAuth` ~713, `attemptSilentAuthCode` ~643, `completeRedirectAuth` ~1555), the redirect transport is single-slot + Drive-bound, and the in-memory token sink is the Drive singleton. Threading scope through all of that is higher-risk and higher-coupling than composing. `googleAuth` stays Drive-only (at most, `buildAuthUrl` gains an optional `scopes` param defaulting to today's Drive scopes IF we choose to share that one URL builder — otherwise the calendar layer builds its own auth URL).

- **New `src/services/calendar/calendarAuth.ts`** composes `pkce.ts` (`generateCodeVerifier`/`generateCodeChallenge`), `oauthProxy.ts` (`exchangeCodeForTokens`/`refreshAccessToken` — verified to forward whatever scopes Google returns, no `drive.file` hard-filter), and `shouldUseRedirectAuth()`. Runs the consent flow for a calendar account (scopes = `calendar.events.owned` + `calendar.freebusy` [+ `calendar.calendarlist.readonly`], `access_type=offline`, `prompt=consent`, `login_hint` = expected email per the Cloud-Auth UX rule), returns `{ email, refreshToken, grantedScopes }`. Does its **own** `calendar.events.owned` validation (granular consent can drop it → structured error, never silent), and routes the token to the **connection record**, never to `googleAuth`'s Drive sink.
- **Redirect-resume is single-slot and Drive-bound — calendar needs a parallel slot, not just an enum value.** `completeRedirectAuth` reads ONE `REDIRECT_AUTH_KEY` (single returnPath+verifier), hardcodes `drive.file` validation, and writes the Drive token. So: add `RESUME_CALENDAR_PATH` to `connectStorage.ts` AND give `calendarAuth` its **own** sessionStorage state key + a `completeCalendarRedirectAuth()` that validates `calendar.events.owned` and routes to the connection. The native deep-link path (`handleNativeAuthRedirect`/`installNativeAuthListener`) is likewise single-flow — for v1, scope calendar redirect to **web + the existing native transport only if it cleanly multiplexes**; otherwise defer native calendar-connect and note it (web/PWA covers the launch surface).
- **Per-connection access tokens** are minted on demand from the connection's refresh token via `oauthProxy.refreshAccessToken` — short-lived, in-memory, never persisted. A partial grant (freebusy declined) is recorded in `grantedScopes` so #34 no-ops cleanly.

### Layer 2 — Data model (Automerge CRDT = source of truth)

- **`CalendarConnection`** (new type in `models.ts`, stored in the CRDT): `{ id: UUID, provider: 'google', accountEmail, destinationCalendarId (default 'primary'), refreshToken, grantedScopes: string[], status: 'ok'|'needs_reconnect'|'error'|'disconnecting', lastSyncedAt?, lastReconciledAt?, lastReconciledBy?, lastError?, consecutiveFailures?, createdAt, updatedAt }`. (`lastReconciledAt`/`By` drive the cross-device freshness-claim skip; see Reliability.)
- **✅ DECISION RESOLVED (greg, 2026-06-10) — connections are FAMILY-WIDE and the refresh token lives in the `.beanpod`.** Pass 3 had recommended device-local tokens to isolate one member's token from another's device. greg's family-wide framing changes the optimization target and reinstates his original decision #3:
  - **Family-wide:** a connected calendar is a shared family resource — ALL family activities push to it regardless of who created them (no per-creator filter in v1). The connection (incl. its token) therefore belongs in the shared family document.
  - **Token in `.beanpod` — chosen for freshness + durability:** family-wide wants _any_ active device to keep _all_ connected calendars current (device-local would leave a calendar stale whenever its connecter isn't in the app); and storing the long-lived refresh token in the `.beanpod` means it **survives a local storage clear / eviction** (the file re-downloads from Drive) → no forced re-consent, which is the whole point of the feature. This directly answers the "avoid re-requesting on cache clear" requirement.
  - **Accepted caveat (write it into the connect consent + help):** `calendar.events.owned` grants whole-calendar access to the connecter's Google account (inherent to writing into an existing calendar), so a token in the shared file is extractable by family members. This is a **consistent family-trust boundary** — the same file already holds all the family's finances — but the connecter should understand it ("this lets beanies keep your calendar in sync from any of the family's devices"). Per-connecter token encryption is a possible future hardening, not v1.
  - **Rotation handling (Pass 2 — net-new write-back, not silent):** `oauthProxy.refreshAccessToken` returns the raw `TokenResponse` and **neither rotates nor persists** a returned `refresh_token` (the existing re-store sites are Drive-bound in `googleAuth.ts` and must not be touched). So the calendar `TokenProvider`/`googleCalendarClient` must itself read `TokenResponse.refresh_token` off each refresh response and, **when present, write it back to the `CalendarConnection` via `calendarRepository`** (LWW-safe). A new `refresh_token` silently discarded = a silent failure (next eviction → forced re-consent), so this write-back is explicit, not assumed. This client is a confidential web client (Lambda holds the secret), so it typically issues a **stable, non-rotating** token (multi-device sharing is then clean); the write-back covers the rotating case defensively.
  - **⚠️ BLOCKING PRECONDITION (Pass 3 re-run):** the entire shared-token-in-`.beanpod` design rests on token **stability**. Verify the proxy's behavior BEFORE building. If the Lambda issues _rotating_ refresh tokens, M devices refreshing the same shared token near-simultaneously each get a different new token → LWW clobber → cascading `invalid_grant` across the family (a multi-device data-integrity failure, not a degradation). If rotation is found, shared-token is not viable as written and needs either (a) proxy-side pinning to non-rotation, or (b) a single-refresher election. Resolve this first; it gates the design.
  - **Storage divergence is intentional (Pass 2):** the existing Drive token is device-local in `fileHandleStore` (IndexedDB), NOT the CRDT — so there is deliberately **no `fileHandleStore`-style helper** to reuse for the calendar token; it rides `createAutomergeRepository` as the connection record. The `.beanpod` payload is AES-256-GCM encrypted (`fileSync.ts encryptPayload`), so "token in the encrypted `.beanpod`" is accurate. (Flagged so a reviewer doesn't read the asymmetry as an oversight.)
- **Push mapping**: `CalendarEventLink` `{ connectionId, activityId, googleEventId, lastPushedHash, lastPushedAt }`, keyed so lookups are O(1). Lives in the CRDT → shared across devices, which (with the deterministic id) gives cross-device dedup. `lastPushedHash` writes are LWW-safe by construction: two devices that compute the same hash for the same activity converge; a stale write at worst triggers one redundant (idempotent) patch.
- **Reuse the generic repository factory, not a hand-mirrored repo.** `activityRepository.ts` is a thin wrapper over `createAutomergeRepository<K, …>(name)` in `src/services/automerge/automergeRepository.ts` (handles id/timestamps/`stripUndefined`/`toPlain`/CRDT change). `calendarRepository.ts` = `createAutomergeRepository('calendarConnections')` + one for `calendarEventLinks`.
- **Migration = two new keys in TWO places (Pass 4 — the second is load-bearing).** Add `calendarConnections: Record<string, CalendarConnection>` and `calendarEventLinks: Record<string, CalendarEventLink>` to the `FamilyDocument` interface + the `CollectionName`/`CollectionEntity` unions in `src/types/automerge.ts`, **AND** add both to `ALL_COLLECTIONS` in `src/services/automerge/docService.ts` — that's the real migration hook (`migrateDoc()` initializes missing collections by iterating `ALL_COLLECTIONS`). Without the `ALL_COLLECTIONS` entry an older/restored `.beanpod` leaves the keys `undefined` until first write. No other migration machinery needed.

### Layer 3 — Pure mapping utils (no I/O, exhaustively tested)

- `src/utils/calendar/deterministicEventId.ts` — `activityId → base32hex id` (stable, valid, unique-per-calendar).
- `src/utils/calendar/activityToGoogleEvent.ts` — `(activity, { memberNames, appLink }) → GoogleEventResource`: title→summary; all-day vs timed start/end; `recurrence`→RRULE (daily / weekly+BYDAY / biweekly INTERVAL=2 / monthly BYMONTHDAY / monthly-by-day BYDAY=nth incl. `-1` last / yearly), `recurrenceEndDate`→UNTIL (**Pass 4: UNTIL value-type must match DTSTART — all-day master → date `UNTIL=YYYYMMDD`; timed master → UTC date-time `UNTIL=YYYYMMDDT235959Z`; a mismatch silently drops the final occurrence**); override child (`parentActivityId`+`originalOccurrenceDate`)→ instance exception (`recurringEventId` + `originalStartTime`); `reminderMinutes`→reminders.overrides; `location`; description = formatted unmapped-fields block + "Synced from beanies.family" + app link.
  - **Field names per the real `FamilyActivity` shape** (`models.ts:522`): `pickupMemberId`/`dropoffMemberId`, fees are `feeSchedule` + `feeAmount`/`feeCurrency`/`feeCustomPeriod*`, instructor is `instructorName`/`instructorContact`. Resolve attendees via `normalizeAssignees(activity)` (`src/utils/assignees.ts`, already used by `activityRepository`) so the deprecated single `assigneeId` is handled, not by reading `assigneeIds` directly.
  - **DRY the recurrence anchors — do NOT reuse `recurringProcessor`** (that's the _finance_ `RecurringItem`→transactions engine, only daily/monthly/yearly; no weekly+BYDAY / biweekly / monthly-by-day). The anchor math the RRULE mapping must mirror lives in `src/utils/date.ts` (`getWeekdayOrdinalInMonth`, `nthWeekdayOfMonth`) and the month-expander in `src/stores/activityStore.ts`. Extract the shared per-kind anchor logic into a **pure** helper (`src/utils/activityRecurrence.ts`) that BOTH `activityStore` and `activityToGoogleEvent` import.
  - **⚠️ The extraction is the highest-coupling change in the plan — gate it (Pass 3).** A bug in this shared helper corrupts the _existing_ in-app planner view, not just the new sync. Sequence it as its own reviewable step: (a) write **characterization tests** pinning current `activityStore` expansion output; (b) switch `activityStore` to the new helper with those tests staying green (pure refactor); (c) only then does `activityToGoogleEvent` consume it. Documented fallback if (a–b) prove too invasive: `activityToGoogleEvent` depends on the new helper while `activityStore` is left untouched for v1 (accept the duplication, track it) — better than a big-bang refactor of the planner.
- `src/utils/calendar/eventDescription.ts` — the human-readable description formatter + marker/link (DRY: one place builds the body). The "open in beanies" link uses the existing `entityDeepLink('activity', id)` (`src/utils/entityDeepLink.ts`, already tested) — never a hand-rolled URL. **Security guard (Pass 4): the description carries ONLY user-authored activity fields + the marker + the deep link — never any system/auth/secret material** (no tokens, no internal flags, no ids beyond the deep link). `notes`/`instructorContact` are user-authored free-text and acceptable (the user owns the target calendar), but nothing system-generated is ever emitted.
- `computePushHash(activity)` — stable hash of the pushed-relevant fields, stored in the link to skip unchanged activities on reconcile.

### Layer 4 — `CalendarClient` interface + Google impl

- `src/services/calendar/CalendarClient.ts` — interface: `insertEvent`, `patchEvent`, `deleteEvent`, `listCalendars` (for the picker — gated on `calendar.calendarlist.readonly ∈ grantedScopes`; if dropped under granular consent, the destination picker falls back to `primary`-only with an informative inline note via `CALENDAR_SYNC_ERRORS`, never a silent empty dropdown or unclassified 403), (later) `queryFreeBusy`. **Token acquisition sits behind an injected `TokenProvider` (`getAccessToken(connectionId)`)**, so the orchestrator never mints tokens itself and never imports Google auth specifics — the reconcile engine depends only on `CalendarClient` + `TokenProvider`, keeping the Outlook/Apple future a real seam rather than an aspiration. The reconcile store **must not** import `googleCalendarClient` or any Google REST type directly.
- `src/services/calendar/googleCalendarClient.ts` — fetch-based impl against the Calendar REST API; the Google `TokenProvider` mints a per-connection access token from the device-local refresh token via `oauthProxy.refreshAccessToken`. No SDK dependency. **HTTP→typed-error mapping (each drives a distinct path, none silent):** `401`/`invalid_grant` → `needs_reconnect`; `403` → permission/scope error (distinct message — may be a dropped granular-consent scope); `404` → missing remote event → re-create path (not a user-surfaced error); `409` → duplicate → patch path; `429`/`5xx` → transient → backoff. Reuse `delay`/`withTimeout` from `src/utils/timing.ts` for backoff — do not re-implement.

### Layer 5 — Orchestrator (MVO) + reconcile engine

- `src/stores/calendarSyncStore.ts` (Pinia, mirrors `syncStore`'s orchestrator pattern):
  - `reconcile(connectionId?)` — diff CRDT activities (active, in a forward window) vs links: **create** (no link, or link's event id missing remotely → insert by deterministic id; 409 → patch), **update** (hash changed → patch, which also restores manual edits), **delete** (activity gone/inactive → delete event + drop link). Skip when `lastPushedHash` matches. Per connection.
  - **Triggers reuse `usePollWhileVisible` (`src/composables/usePollWhileVisible.ts`), not a hand-rolled `watch`.** That primitive already does fire-on-hidden→visible + cadence poll + stop-when-hidden + catch/`reportError` (a throwing callback never kills the loop) + auto-teardown — exactly Requirement 10's reconcile-on-open. The only addition is a debounced reactive watch on the activity store for create/update/delete (debounced to avoid hammering on bulk edits). Also fire on family load (mirror `syncStore.initialize`), manual "Sync now", and connection-added.
  - `connect()` / `disconnect(connectionId)` (disconnect deletes all that connection's events via its links, then drops tokens), `setDestinationCalendar(connectionId, calendarId)`.
  - **Reconnect runs through `calendarAuth` with the connection's OWN refresh token — NEVER `useGoogleReconnect`/`requestAccessToken`/`startRedirectAuth`.** Those mutate `googleAuth`'s module-level Drive token and write the Drive refresh token to `fileHandleStore`; invoking them for a calendar account would corrupt the Drive session (violates "Drive auth never disturbed"). Reuse only the _pattern_ (a `needs_reconnect` status + a Settings affordance), not the Drive-bound composable.
  - Error handling via `CALENDAR_SYNC_ERRORS` registry — `as const satisfies Record<Code, Entry>` for compile-time exhaustiveness, exactly like `JOIN_ERRORS` (`useJoinFlow.ts:90`). One `recordError`-style helper sets the connection `status`/`lastError` AND calls `reportError({ surface, message, error, context, severity })`. Auth-permanent → `needs_reconnect` + Settings affordance. Transient/429 → retry/backoff (via `timing.ts`), no user alarm. Logged with `[calendarSync]` prefix.

**Reliability & concurrency (Pass 3) — the engine must be convergent and bounded:**

- **Single-writer guard.** Wrap each reconcile in `navigator.locks.request('calendar-reconcile-<connectionId>', { ifAvailable: true }, …)` so a second tab/context no-ops instead of racing. Cross-_device_ concurrency can't be locked, so reconcile is written as a **pure function of (CRDT activity state, remote state)** — re-running produces no net change. The 409-on-insert only protects inserts; convergence + idempotent patch/delete protect the rest (two devices issuing the same patch is harmless).
- **Coalesced dirty-set, not full scans on every edit.** Activity create/update/delete marks a dirty-set of `activityId`s (debounced); reconcile **drains the dirty-set** rather than rescanning everything. Full-scan reconcile is reserved for on-open / manual "Sync now".
- **The bounded-concurrency queue spans `(activity × connection)` work-items, not per-connection (Pass 3 re-run).** With family-wide push, a 50-activity import fans out to 50 × N calendars. The cap (~5 in-flight) must be a SINGLE device-wide queue over all `(activity, connection)` pairs — so adding a 3rd/4th calendar doesn't 3–4× the simultaneous Google write rate and re-introduce the 429 storm the cap exists to prevent.
- **Cross-device redundancy bound — a per-connection freshness claim (Pass 3 re-run).** `navigator.locks` is per-device only; with the token shared and M devices open, every device would otherwise full-scan all N calendars (each paying the targeted-`get`-per-in-window-activity cost) for zero added correctness. Add `lastReconciledAt`/`lastReconciledBy` to the connection record (LWW); a device that sees another reconciled a connection within the cadence window **skips its full scan** and only drains its own local dirty-set. Convergence keeps writes harmless; this keeps request volume from multiplying by device count. **The skip is a best-effort optimization, never authoritative (Pass 4 re-run):** a device always drains its own dirty-set (and does not skip if that set is non-empty for the connection), so a clock-skewed or stale `lastReconciledAt` can only cause a redundant or _delayed_ scan — never a dropped activity (the next on-open/edit re-marks it).
- **Remote-delete detection without scanning.** Under `events.owned` we never enumerate (Req 6). To honor Req 7 (re-create manual remote deletes), reconcile issues a **targeted `patch`/conditional `get` by deterministic id**; a `404` routes to the re-create path. Cost = one request per in-window linked activity — which is why the window bound below matters.
- **Bounded forward window + link GC.** Push only activities whose date/last-occurrence is within a defined window (constants in one place, e.g. `[-30d, +365d]`); recurring masters are pushed once (the window governs _which activities to push_, not occurrence expansion). When an activity leaves the window or goes `isActive:false`, **delete its remote event and drop the link** — never just stop touching it — so `calendarEventLinks` cannot grow unbounded across years.
- **Parent-before-child ordering.** Google instance-exceptions (`recurringEventId`) require the master to exist remotely. Within a drain, ensure a recurring **parent** is pushed before any of its override children; if a child's parent link is missing, reconcile the parent first or defer the child to the next drain.
- **Partial-failure-safe disconnect.** Delete events first; **drop each link only after its delete succeeds or 404s** (idempotent); only once all links are cleared do you drop the token + connection record. If some deletes fail, the connection holds in `disconnecting` status and retries on next open/reconcile — never orphaning beanies events the user can no longer remove (the Help article promises clean removal).
- **Capped retry + rate-limited reporting.** Per-connection consecutive-failure counter; after N transient failures park the connection in `error` with a "retry" affordance and **stop auto-retrying** until next on-open / manual sync. `reportError` fires **once per status transition, not once per poll tick** — no `#beanies-errors` alert-fatigue from a permanently-failing connection.
- **⚠️ SHARED-TOKEN `invalid_grant` — never clear the token others rely on (Pass 3 re-run — the most dangerous new gap).** The Drive path _clears_ its refresh token on `invalid_grant`. The calendar layer must **NOT copy that reflex**: a shared token means the first device to see a blip-y `invalid_grant` (transient proxy/clock issue, or a token rotated under it) would null the shared `refreshToken` in the CRDT, LWW-propagating a forced re-consent to the whole family. Instead: (a) on `invalid_grant` set `status: 'needs_reconnect'` but **never delete the shared `refreshToken`** — only an explicit user Disconnect or a successful reconnect overwrites it; (b) require a **confirmation threshold** (K consecutive `invalid_grant`) before flipping the shared status, so one device's blip doesn't park the family; (c) when _any_ device later mints a working access token from the same shared token, **self-heal `status` back to `ok`** (mirror `googleAuth`'s `onTokenAcquired` self-heal). This is explicitly the opposite of the Drive `googleAuth` reflex — call it out so the implementer doesn't reuse that code path.
  - **Counter storage + reset point (Pass 4 re-run).** The K-`invalid_grant` threshold counter is **device-local** (each device independently needs K consecutive blips before it flips the shared `status`) — keeping it out of the CRDT avoids cross-device increment contention. A successful mint on a device resets **that device's** counter; the cross-device self-heal that flips `status: ok` must be paired with resetting the healing device's local counter (so a healed token isn't immediately re-parked). The CRDT `consecutiveFailures` (transient-parking, distinct from the auth K-counter) resets to 0 on any successful reconcile.

### Layer 6 — Settings UI (`area: settings`)

- `src/components/settings/CalendarSyncSettings.vue` — follow the established card→drawer pattern **exactly** as `AiSettings.vue` does: a `showCalendarSync` ref + `<SettingsCard @click>` in `SettingsPage.vue`, and the panel built on **`BeanieFormModal variant="drawer"`** (`:open @close`). Contents: list connections (account email, destination calendar, status + "last synced"); "Connect a Google calendar" (launches `calendarAuth` with `login_hint`); per connection — destination `BaseSelect` (options `{ value, label }`, populated via `listCalendars`), "Sync now", "Reconnect" (when `needs_reconnect`), "Disconnect". The disconnect confirm uses the global **`useConfirm`** `confirm({ title, message, variant: 'danger' })` (`src/composables/useConfirm.ts`) — NOT a locally-mounted `ConfirmModal`. Success/failure feedback via **`useToast`** `showToast`. All copy via `uiStrings.ts`.
- Register the card in `SettingsPage.vue` (`showCalendarSync` ref + `<CalendarSyncSettings :open @close>`), mirroring the existing `showAi`/`<AiSettings>` wiring.

### Layer 0 — Feature-flag gating (the #31 system)

- Register a new flag (e.g. `googleCalendarSync`) in `src/config/flagRegistry.ts`; add it to `src/config/featureFlags.committed.ts` committed **`false`** (prod-off). In DEV it's on by default (per `isFlagEnabled`'s `DEV ? true` branch), so local development works without ceremony; flip the committed value + deploy to launch.
- **Single gate, not scattered checks:** the `CalendarSyncSettings` card is conditionally rendered on a **single `isFlagEnabled('googleCalendarSync')` computed** in `SettingsPage.vue`, and the `calendarSyncStore` reconcile entry points read the same source. **When the flag is off, the reconcile triggers must not even be REGISTERED** (the `usePollWhileVisible` registration and the activity-store watch are never set up — not merely early-returning inside the callback) → a flag-off device runs zero watchers/pollers/network. Mirror the `useMagicReader` model (one computed source of truth). **NOTE:** `SettingsPage.vue` gates `AiSettings` on a hardcoded `aiSurfaceEnabled = true` const — do NOT copy that; the real AI flag-gate is in `useMagicReader`'s computeds, which is the pattern to follow. Launch-coupled with #34 (flip together).

### Layer 7 — i18n + Help

- All strings in `src/services/translation/uiStrings.ts` (`calendarSync.*`, en + beanie + zh); `npm run translate` clean.
- Help Center article (see **Help Center Coverage**).

### Out of scope for this plan (tracked elsewhere)

Free/busy clash _behavior_ (#34); family-vs-family overlap warnings (separate beanies-native feature); Outlook/Apple providers (future; the `CalendarClient` interface keeps that door open); a read-only `.ics` feed (possible future fallback).

## Files Affected

**New**

- `src/services/calendar/calendarAuth.ts` — multi-account calendar consent flow
- `src/services/calendar/CalendarClient.ts` — provider interface
- `src/services/calendar/googleCalendarClient.ts` — Google REST impl
- `src/utils/calendar/deterministicEventId.ts`
- `src/utils/calendar/activityToGoogleEvent.ts`
- `src/utils/calendar/eventDescription.ts`
- `src/utils/activityRecurrence.ts` — pure per-kind recurrence-anchor helper (shared by `activityStore` + `activityToGoogleEvent`)
- `src/services/automerge/repositories/calendarRepository.ts` — via `createAutomergeRepository`, not a hand-mirrored repo
- `src/stores/calendarSyncStore.ts`
- `src/components/settings/CalendarSyncSettings.vue`
- `src/content/help/<security|how-it-works>.ts` entry (new article — see Help Center Coverage)
- Unit test files alongside each util/service/store

**Modified**

- `src/services/google/googleAuth.ts` — parametrize scope (default unchanged); export/extract reusable transport
- `src/services/sync/connectStorage.ts` — add `RESUME_CALENDAR_PATH`
- redirect-resume handling (`completeRedirectAuth` site / `ResumePodSetup.vue` or its router glue) — calendar resume branch
- `src/types/models.ts` — `CalendarConnection`, `CalendarEventLink` types
- `src/config/flagRegistry.ts` + `src/config/featureFlags.committed.ts` — new `googleCalendarSync` flag, committed `false` (prod-off)
- `src/pages/SettingsPage.vue` — register the calendar card, gated on `isFlagEnabled('googleCalendarSync')`
- `src/services/translation/uiStrings.ts` — `calendarSync.*` strings
- `src/types/automerge.ts` — add `calendarConnections` + `calendarEventLinks` to `FamilyDocument` + the `CollectionName`/`CollectionEntity` unions
- `src/services/automerge/docService.ts` — add both collections to `ALL_COLLECTIONS` (the real `migrateDoc` hook — Pass 4)
- (refresh tokens live in the CRDT connection record — no separate device-local store or sign-out sweep needed; the existing `.beanpod` sign-out lifecycle covers them)

## Help Center Coverage

- **Action**: new article
- **Category**: `security` (privacy-relevant) — cross-link from `how-it-works`
- **Article type**: `explainer` (with a short how-to for connecting)
- **Slug**: `google-calendar-sync`
- **Title**: How beanies syncs your activities to Google Calendar
- **Scope**: Explains the one-way push (beanies is the golden source, your activities appear in the Google calendar you already use), that connections are **family-wide** (all family activities push to every connected calendar, not just your own), how to connect/disconnect one or more calendars, what data is sent (incl. the details packed into the description), the "Synced from beanies.family" marker, that editing a synced event in Google reverts on next sync (edit in beanies), that sync happens while the app is open, and the privacy posture (beanies only ever touches its own events; nothing goes through a beanies server). Includes the **shared-token trust boundary** (Caveat 5): connecting a calendar lets beanies keep it in sync from any of the family's devices, and the connection is shared with your family.
- **Notes**: Call out the irreversible-ish disconnect (removes beanies' events from that calendar), the "syncs when the app is open" expectation, that manual edits in Google don't stick, and the shared-token note at connect time. Written per `.claude/skills/beanies-help-docs/SKILL.md`, shipped in the same change.

## Acceptance Criteria

- [ ] Entire feature gated behind the `googleCalendarSync` flag (committed `false`); flag off → no card, no OAuth, no reconcile, no network.
- [ ] All family activities push to ALL connected calendars regardless of creator (family-wide).
- [ ] Connect / modify / remove one or more Google calendar integrations from Settings.
- [ ] Activities created/edited/deleted in beanies push to ALL connected calendars (default primary; changeable per Caveat 3).
- [ ] All relevant activity data pushed; unmapped fields render as a clean description block.
- [ ] Every beanies event carries the "Synced from beanies.family" note + app link.
- [ ] Idempotent: the same activity never duplicates, including across devices (deterministic id; 409-safe).
- [ ] Manual edit of a beanies event in Google is restored on next sync; manual delete is re-created.
- [ ] Recurring activities appear as native recurring events (RRULE) with correct override exceptions.
- [ ] Disconnect removes the events beanies created in that calendar and clears its tokens.
- [ ] beanies never reads or modifies events it didn't create.
- [ ] All failures classified + logged + surfaced per-connection; no silent failures; Drive auth/session never disturbed.
- [ ] All user-visible strings via `uiStrings.ts` (en+beanie+zh); `npm run translate` clean.
- [ ] Help Center article added and matches shipped behavior.
- [ ] `npm run validate` green; unit + E2E tests pass.

## Testing Plan

1. **Unit — deterministic id**: stable across calls; valid base32hex/length; distinct activities → distinct ids; same activity → same id (cross-device dedup proof).
2. **Unit — activity→event mapping**: all-day vs timed; every `ActivityRecurrence` kind → correct RRULE; `recurrenceEndDate`→UNTIL **with the all-day (date) vs timed (UTC date-time `…T235959Z`) value-type distinction**; override child → instance exception; reminders; description block (member-name resolution, fees, instructor, marker + link present, **no system/secret material**); missing optional fields handled.
3. **Unit — reconcile diff**: create/update/delete/skip-unchanged (hash) against a **fake `CalendarClient`**; 409-on-insert → patch path; auth-expired → connection `needs_reconnect` (no throw past boundary); 429 → retry.
4. **Unit — error registry**: each `CALENDAR_SYNC_ERRORS` code maps to a message + recovery; nothing falls through unclassified.
5. **Unit — disconnect**: removes exactly the connection's events (by links) and clears tokens; leaves other connections intact.
6. **Unit — scope parametrization**: Drive `buildAuthUrl` output byte-unchanged; calendar flow requests the calendar scope set.
   6b. **Unit — convergence**: running `reconcile` twice over the same (activities, fake-remote) state produces no second-pass writes (idempotent/convergent).
   6c. **Unit — link GC + window**: an activity leaving the window or going `isActive:false` deletes its remote event and drops the link; in-window unchanged activities are skipped via `lastPushedHash`.
   6d. **Unit — partial-failure disconnect**: a failing delete holds the connection in `disconnecting` and retries; links drop only on delete-success/404; tokens cleared only after all links gone.
   6e. **Unit — capped retry / reporting**: after N transient failures the connection parks in `error` and stops auto-retrying; `reportError` fires once per status transition, not per tick.
   6f. **Unit — parent-before-child ordering**: an override child whose parent isn't yet linked defers/forces the parent first (no orphaned exception).
   6g. **Characterization — `activityStore` expansion**: pin current planner expansion output BEFORE the `activityRecurrence` extraction; stays green after the refactor.
7. **E2E (≤ budget, mocked Google client)**: connect → add activity → assert a link + mapped event payload in the CRDT/IndexedDB export (assert data, not DOM); disconnect → assert links/events removed. (Real Google API is un-E2E-able → covered by unit via the fake client, per the testing-strategy ADR.)
8. **Manual**: connect a real Google account in dev, add an activity, confirm it appears in Google Calendar with the description block + marker; edit it in Google → reverts on next reconcile; disconnect → it's gone.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the full layered plan — multi-account calendar OAuth (reusing PKCE/proxy/redirect primitives, NOT the Drive singleton), CRDT connection+mapping model, deterministic-id idempotent reconcile engine behind a `CalendarClient` interface, pure recurrence→RRULE + description utils, Settings card, i18n, Help article; surfaced the destination-picker third-scope decision.
- **Pass 2 (DRY + error handling)**: Routed reuse to real primitives — `createAutomergeRepository` factory (+ two `FamilyDocument` keys) over a hand-mirrored repo; `usePollWhileVisible`/`useConfirm`/`useToast`/`BeanieFormModal`/`BaseSelect`/`entityDeepLink`/`timing.ts` over re-implementations; recurrence anchors from `date.ts`/`activityStore` via a new pure `activityRecurrence.ts` (not the finance `recurringProcessor`); corrected `FamilyActivity` field names + `normalizeAssignees`; isolated calendar OAuth from the Drive singleton (own token sink, own redirect slot + `completeCalendarRedirectAuth`, own `calendar.events.owned` validation, reconnect via `calendarAuth` not `useGoogleReconnect`); every client/reconcile failure classified via an exhaustive `as const satisfies` `CALENDAR_SYNC_ERRORS` registry + `reportError` + per-connection status.
- **Pass 3 (Sustainability)**: Hardened reconcile reliability — single-writer `navigator.locks` guard + convergent/LWW-safe design, coalesced dirty-set queue with bounded concurrency (no bulk-edit thundering herd), parent-before-child override ordering, bounded forward window + link GC (no unbounded CRDT growth), partial-failure-safe disconnect (`disconnecting` status), capped retry + per-transition error reporting (no alert fatigue); **moved refresh tokens device-local** (mirroring `fileHandleStore`) instead of the shared CRDT to avoid multi-user token exposure + rotation conflicts (revises decision #3 — pending greg's confirm); gated the `activityRecurrence` extraction behind characterization tests; put token acquisition behind an injected `TokenProvider` seam; removed the contradictory "migration glue" line.
  **Round 2** — after greg's edits (family-wide connections; token back in `.beanpod`; `calendar.calendarlist.readonly` added; whole feature behind the `googleCalendarSync` flag), the passes re-ran on the revised plan:

- **Pass 2 (re-run)**: Corrected flag-system citations (`isFlagEnabled` lives in `src/config/flags.ts`; edit only `flagRegistry.ts` + `featureFlags.committed.ts`) and re-grounded the gate on a single `useMagicReader`-style computed (not `SettingsPage`'s hardcoded `aiSurfaceEnabled = true`); closed the shared-token silent-failure hole — `oauthProxy.refreshAccessToken` neither rotates nor persists a returned `refresh_token`, so the calendar `TokenProvider` must read `TokenResponse.refresh_token` and write it back to the `CalendarConnection`; confirmed the `.beanpod` is AES-256-GCM-encrypted and noted CRDT-token storage is an intentional divergence from the device-local Drive token; routed the new `calendarlist.readonly` picker through the existing `grantedScopes`/`CALENDAR_SYNC_ERRORS` 403 path with a `primary`-only fallback.
- **Pass 3 (re-run)**: Re-derived reliability for the shared-token + family-wide model: gated `invalid_grant` so one device never clears/parks the shared token others rely on (no-delete + K-threshold + cross-device self-heal — explicitly NOT the Drive reflex); elevated the non-rotating-token check to a BLOCKING precondition (rotation = multi-device LWW corruption); made the bounded queue span `activity × connection` so N family-wide calendars don't N× the 429 risk; added a per-connection LWW freshness-claim (`lastReconciledAt`/`By`) so M open devices skip redundant full scans; updated Caveat 10 (`replaceDoc` reverts the shared token → treat restored token as unverified); flag-off registers zero pollers/watchers.
- **Pass 4 (re-run)**: Final sweep confirmed convergence on the settled model (family-wide, shared token in the encrypted `.beanpod`, three-scope consent, flag-gated) with all code references verified; closed three residual items — pinned the K-`invalid_grant` counter as device-local with a defined reset-on-self-heal point, marked the `lastReconciledBy` freshness-claim non-authoritative (own dirty-set always drained → never a dropped activity), and added the shared-token family-wide trust boundary to the Help Center scope.

---

_Round 1 (original four passes, pre-edit):_

- **Pass 4 (Fresh-eyes sweep)**: Closed five concrete gaps — register both collections in `docService.ts` `ALL_COLLECTIONS` (the real `migrateDoc` hook, not just the `automerge.ts` types); specified whole-`.beanpod`-restore / family-switch behavior (reconcile tolerates orphaned remote events when `calendarEventLinks` reverts under `replaceDoc`; documented for users); made device-local calendar tokens **family-scoped** (`calendarRefreshToken-<familyId>-<connectionId>` + swept on sign-out) so a connecter's Google token isn't left on-device after a family switch; added an explicit "description carries only user-authored fields + marker + deep link, never secrets" guard; and pinned the all-day-vs-timed RRULE `UNTIL` value-type with its own test. Confirmed the deterministic-id scheme is collision/format-safe. Settled greg-confirmation items (third scope, device-local-token divergence, recurrence-extraction gating) left intact.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt (assembled by /beanies-pre-plan from Notion #32, captured verbatim)

=== BEANIES PRE-PLAN ===
Title: Google calendar integration — one-way push from beanies activities into users' existing Google calendars. Type: feature. Priority: high. Surfaces: platforms All (web/PWA/iOS/Android), area activities + settings. Objective: many users can't break the habit of living in Google Calendar but want their beanies family activities to appear there; let them connect one or more Google accounts and have beanies push its activities into the calendar they already use, keeping beanies the single golden source. (Full assembled block — scope, out-of-scope, acceptance criteria, edge cases, reuse hints, references, open Qs, notes — is stored verbatim in the Notion #32 `beanies-plan prompt` field and reproduced across this plan's sections.) GitHub issue: SKIP.

### Follow-up — /beanies-plan invocation

> build the plan

</details>
