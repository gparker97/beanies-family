# Plan: Honest refresh feedback + read-freshness as first-class state (#69)

> Date: 2026-08-24
> Related issues: Notion tracker #69 (no GitHub issue — direct implementation)
> Plan file: `docs/plans/2026-08-24-refresh-read-freshness-honest-feedback.md`

## User Story

As a family member who has left beanies open (or come back to it after a while), I want the app to tell me honestly when it could not fetch my latest data — and to show me how fresh the on-screen data actually is — so that I never act on weeks-old numbers believing they are current, and I know to reconnect when a refresh fails.

## Context

Notion #69 was filed 2026-08-20 reporting that a manual **Refresh All Data** shows the "your beans are fresh" success toast even when the Drive read fails on an expired/revoked Google token, so stale data is presented as current.

**A trace of the current code (2026-08-24) shows the reported symptom no longer reproduces — the bug has shifted, and the fix must target the real gap:**

- The success toast is **already suppressed** on a failed read. `backgroundSyncFromFile` sets `backgroundSyncError` on every token-death terminal — the non-password auth-transient branch (`src/stores/syncStore.ts:2563-2566`) and the catch (`:2571-2577`) — and `handleRefreshAll` only toasts success `if (!syncStore.backgroundSyncError)` (`src/components/common/AppHeader.vue:194`). That suppression shipped **2026-05-03** (`e74f6b5d`), three months before #69 was filed.
- The only terminal that leaves `backgroundSyncError` null is the #61 open-skip (`syncStore.ts:2495-2499`), and it is **unreachable with a dead token**: `shouldSkipOpenRead` needs a _successful_ metadata probe (`src/services/sync/syncService.ts:759-781`), which a dead token fails, and a long-idle app is trust-expired anyway.

**The actual remaining gap is the inverse of the report:** `handleRefreshAll` has a success branch and a not-configured branch, but **no failure branch**. On a failed refresh (`backgroundSyncError` set) it shows **nothing at all** — no success, no error. The `try/catch` at `:210-211` never fires because `backgroundSyncFromFile` does not throw on token death (it returns void and records the error internally). The reconnect banner appears only later, via the deferred `scheduleColdStartReconnectEscalation` timer (`syncStore.ts:2400-2458`), decoupled from the tap. So the user taps Refresh, sees no feedback, and keeps looking at stale data.

Separately, the app has **no honest notion of read-freshness**. `syncStore.lastSync` (`syncStore.ts:156`) is set at both save _and_ read termini and is surfaced as "Saved · <time>". There is no state answering "when did we last successfully fetch current data from Drive, and can we trust what's on screen right now?"

**Scope decision (greg, 2026-08-24):** reframe the fix around **read-freshness as first-class state** — track "last successful remote read" distinctly from "last save", surface it app-wide, and drive **both** the immediate refresh feedback **and** a staleness indicator from it.

## Requirements

1. **Distinct read-freshness state.** Introduce a first-class `lastSuccessfulRead` timestamp in `syncStore`, set **only** when a Drive read genuinely confirmed current data. Do this at the **single existing choke point** `runPostLoadDriveHousekeeping()` (`syncStore.ts:848-856`), whose own contract (`:839-847`) is "the Drive-side housekeeping run at EVERY successful open terminus — the authoritative load path AND the #61 open-guard SKIP path — so the two can never drift." Its call sites are exactly the four proven-current terminals: `loadFromFile` success (`:1065`), open-skip (`:2497`), and the two decrypt-recovery successes `hydrateFromEnvelope` (`:2539`) + cached-key (`:2548`) — the latter two are genuine current reads that do **not** flow through `loadFromFile`'s success terminus and the Pass-1 enumerated list wrongly omitted. It already runs inside an `if (getProviderType() === 'google_drive')` block, so stamping there is Drive-only by construction. It must **not** advance on a save, nor on any failed/aborted read, and is separate from `lastSync` (do not repurpose `lastSync`). **Explicitly do NOT** stamp it in `loadFromPersistenceCache` (`:1412` — local cache hydration, not a remote read; stamping there would re-introduce the exact false-fresh bug #69 targets) or `manualExport` (`:2245` — a save).
2. **A single freshness projection.** Add a `dataFreshness` computed (a pure projection over existing state) with a small union `'fresh' | 'stale' | 'unknown'`. It must be a **total** mapping (never `undefined`) — specify the exact decision tree so `decrypt`/unclassified kinds are covered:
   ```
   if (storageProviderType !== 'google_drive') return 'unknown'   // local files: nothing to be stale against
   if (kind === 'auth-transient' || kind === 'network') return 'stale'
   return lastSuccessfulRead ? 'fresh' : 'unknown'                // clean state, decrypt, AND any future/null kind
   ```
   - `stale` = the most recent refresh **attempt failed to reach/authorize Drive** — we cannot confirm the on-screen data is current.
   - `fresh` = a read/verify has succeeded and no auth/network error is outstanding.
   - `unknown` = before the first successful read of a session, or a local-only file.
     The trailing `return lastSuccessfulRead ? 'fresh' : 'unknown'` deliberately catches `decrypt` and any new/unclassified non-null kind (mirroring the `handleRefreshAll` "keys off error being set, not a kind literal" robustness rule) — so the projection is never partial and a new kind can never yield `undefined`.
   - **`decrypt` is deliberately NOT `stale`:** a decrypt failure ("password may have changed", `syncStore.ts:2553`) means Drive _was_ reached — a reconnect won't fix it, so it is surfaced via the refresh toast only, never the stale badge.
     The projection is the **single source of truth** both the toast and the badge read from — no duplicated staleness logic. **In-flight note:** `backgroundSyncFromFile` clears `backgroundSyncErrorKind` to null at its start (`syncStore.ts:2483`), so during an active refresh (`isBackgroundSyncing`) `dataFreshness` momentarily reads non-`stale` and settles on resolve. This is by design — the projection is defined to be read _between_ refreshes; do not add `isBackgroundSyncing` gating to "fix" this non-bug.
3. **Honest, immediate manual-refresh feedback.** `handleRefreshAll` must give feedback on **every** outcome of a Drive-configured refresh:
   - success (read completed / verified current) → the existing "beans are fresh" success toast.
   - **auth failure** (`backgroundSyncErrorKind === 'auth-transient'`) → an immediate, non-red (Heritage Orange / warning) "couldn't refresh — your data may be out of date, please reconnect" toast whose action triggers the **existing** reconnect affordance immediately (not the deferred cold-start timer).
   - **network/other failure** (`'network'`/`'decrypt'`) → an immediate warning toast with the appropriate message (offline vs. generic), no reconnect action for the pure-offline case.
     No outcome may leave the user with no feedback.
4. **App-wide staleness indication.** When `dataFreshness === 'stale'`, surface it where the user already looks for sync state — the `SaveStatusIndicator` (sidebar + mobile drawer footer, already app-wide). Add a **"Last refreshed · <time>"** line (from `lastSuccessfulRead`) and a stale treatment (Heritage Orange, reusing the component's existing `isDegraded` visual vocabulary), so stale data is never silently presented as current. Reuse `formatRelativeTime` and the existing popover/recovery action.
5. **No regression of the clean path.** A normal refresh that reads cleanly still shows the success toast and a `fresh` state; `saveStatus` and the save-side of the indicator are unchanged.
6. **Distinguish offline from auth.** Offline and auth-failed both avoid a false "fresh", but produce different copy (offline: check-connection; auth: reconnect), keyed off `backgroundSyncErrorKind`.
7. **i18n.** All new user-facing strings go through `t()` with `en` + `beanie` entries in `uiStrings.ts` (new keys under `header.*` for the toasts and `saveStatus.*` for the freshness line).
8. **Unit coverage** proving: an auth-failed manual refresh reports failure (not success and not silence); a clean refresh still reports success; `dataFreshness` maps each `backgroundSyncErrorKind`/read-state combination to the correct value; `lastSuccessfulRead` advances on read/skip success and not on save or failure.

## Important Notes & Caveats

- **Do NOT change the toast-suppression gate's intent.** The `if (!backgroundSyncError)` success gate is correct; we are **adding** the missing `else` (failure) branches, not altering the success condition.
- **Reuse the existing reconnect flow.** The reconnect affordance is `showGoogleReconnect` + the `UnifiedReconnectToast` (reactive via `useReconnectCoordinator`, whose button runs `reconnectAll`), plus the Family Data recovery deep-link used by `SaveStatusIndicator.openFamilyData` (`FAMILY_DATA_DEEP_LINK`). The manual-refresh auth action promotes the existing toast **immediately** via the new `promptGoogleReconnect()` store action — it must not re-implement reconnect logic in the component nor wait for `scheduleColdStartReconnectEscalation`'s defer. (Verified there is no existing exported action for this — `promptGoogleReconnect()` is a definite add, one line setting the ref, so components never poke it directly.)
- **`lastSuccessfulRead` must be precise about "read".** The #61 open-skip legitimately confirms currency (successful version probe within trust window) and should advance it; a _failed_ probe (`unknown`) must not. Do not advance it in `finally` blocks that run on every outcome — advance it only at proven-success terminals.
- **Freshness is failure-driven, not merely age-driven.** Data that was last read days ago but on a healthy connection with an unchanged Drive file is **current**, not stale — so `dataFreshness` keys primarily off "did the last attempt fail to reach/authorize Drive", not a raw age threshold. `lastSuccessfulRead` is shown for context ("Last refreshed · 3 days ago"), not used as the sole staleness trigger. This avoids crying stale on healthy long-lived sessions.
- **Local-only files have nothing to be stale against.** `dataFreshness` is `unknown` (never `stale`) when `storageProviderType !== 'google_drive'`; the freshness line is Drive-only, mirroring the popover's existing `isDrive` connection line.
- **Heritage Orange, never Alert Red** for the stale/reconnect states (routine-alert rule, per CIG + `SaveStatusIndicator`'s existing `#F15D22` degraded treatment).
- **No new feature gate** (per the intake: ship ungated).
- Do **not** touch #62's territory (cross-device token churn) — this is reporting/freshness only.
- **Toast level for the generic branch:** reuse the `error.refreshFailed`/`error.refreshFailedHelp` _strings_ but show them at level **`'warning'`** (Heritage Orange), NOT `'error'`. The existing caller `SaveFailureBanner.vue:57` uses them at `'error'`, which renders red AND auto-pages `#beanies-errors` (`useToast.ts:121-131`) — we want neither here (a failed manual refresh is self-recoverable, firehose-only). Pass `'warning'` explicitly; don't copy the existing call site's level.
- **Accepted minor: duplicate auth toasts can stack.** The toast dedupe (`useToast.ts:106`) is exempt for any toast carrying an `actionFn`, so repeated Refresh taps on a dead token stack identical "reconnect" toasts. This is a conscious accept (the alternative — dropping a toast with a distinct action — is worse); the network/generic branches carry no `actionFn` and dedupe normally. No code change.
- **Accepted minor: permission-revoked-mid-session can read `fresh` briefly.** If Drive permission is revoked after a successful read, `needsPermission` flips true while `lastSuccessfulRead` is still set and no new error kind is recorded yet, so `dataFreshness` reads `fresh` until the next refresh/poll records the kind (then `stale`). Self-correcting and adjacent to #62's excluded territory — noted, not chased.

## Assumptions

> **Review before implementation** — valid at planning time (2026-08-24).

1. `backgroundSyncErrorKind` reliably distinguishes `'auth-transient'` vs `'network'` vs `'decrypt'` at the point `backgroundSyncFromFile` resolves (confirmed at `syncStore.ts:2564-2569`, `:2575-2576`).
2. `backgroundSyncFromFile` resolves (does not throw) on token death, so `handleRefreshAll` must branch on `syncStore.backgroundSyncError` after the `await`, not rely on `try/catch` (confirmed by trace).
3. `SaveStatusIndicator` is the correct single home for app-wide freshness surfacing (already mounted sidebar + mobile drawer; no second placement needed for "app-wide").
4. A successful `loadFromFile({ merge: true })` and a successful open-skip are the only "confirmed current" terminals that should advance `lastSuccessfulRead`.
5. `lastSuccessfulRead` does not need to persist across sessions/devices to satisfy #69 (it is per-session read-freshness); persisting it is out of scope unless a pass shows it's trivially free via existing snapshot plumbing.

## Approach

**1. `syncStore` — read-freshness state (single source of truth).**

- Add `const lastSuccessfulRead = ref<string | null>(null)` near `lastSync` (`:156`), reset wherever `lastSync` is reset (`:2216`, `:2777`, sign-out) — reuse the same reset sites.
- Stamp it at the **one existing choke point**: inside `runPostLoadDriveHousekeeping`'s `if (getProviderType() === 'google_drive')` block (`:849-853`), set `lastSuccessfulRead.value = toISODateString(new Date())`. This is single-source, drift-proof by that helper's own contract, Drive-only by construction, and (verified) never reached from `loadFromPersistenceCache`, so it cannot fire on the cache path. Do NOT sprinkle it across call sites and do NOT audit `lastSync` sites (the `loadFromPersistenceCache` `lastSync` at `:1412` is a false-fresh trap).
  - **Known non-advance sub-paths (accept + note, don't chase):** `reloadIfFileChanged`'s two decrypt-recovery early returns (`:2640`, `:2648`) and `loadFromNewFile`/`loadFromDroppedFile` (`:1105`/`:1140`) bypass `runPostLoadDriveHousekeeping`; a freshly-selected Drive file or a cross-device-reload-needing-redecrypt shows `unknown`/last value until the next open/poll (which does route through the helper). This is acceptable — the freshness state self-corrects on the next normal open — and is called out here rather than left implicit.
- Add `const dataFreshness = computed<DataFreshness>(...)` implementing Requirement 2, and export a `DataFreshness` union type (alongside `SaveStatus`). Export `lastSuccessfulRead` (readonly) + `dataFreshness` from the store return (`:4153` area).
- Add one thin action `promptGoogleReconnect()` (verified: **no exported action raises `showGoogleReconnect` today** — it's set only internally at `:2411`/`:3907`/`:3911` and exported as a bare ref) that sets `showGoogleReconnect.value = true` synchronously, raising the existing `UnifiedReconnectToast` (reactive via `useReconnectCoordinator`). Components call this action; they never poke the ref. This is the single lever the manual-refresh path and the cold-start path converge on.

**2. `AppHeader.handleRefreshAll` — the missing failure branch (Requirement 3).**
Extract the outcome→toast+telemetry decision into a small local function `reportRefreshOutcome()` (keeps `handleRefreshAll` as flat orchestration and makes Testing item 3 unit-testable without the SW machinery). Call it once **inside the existing `try`**, right after `await syncStore.backgroundSyncFromFile()` (`:193`), replacing the `if (!backgroundSyncError) …` at `:194` — keep the outer `catch` (`:210-211`), which still guards the SW-update code and any unexpected throw. `reportRefreshOutcome()` reads the store's resolved state and branches, in this order:

- no error (success) → `header.refreshSuccess` (unchanged).
- `backgroundSyncErrorKind === 'auth-transient'` → warning toast `header.refreshAuthFailed` with the action label `reconnectPrompt.action` (**reuse the existing "Reconnect" string** at `uiStrings.ts:5685` — do not add `header.reconnect`), `actionFn` calling `syncStore.promptGoogleReconnect()`. Show the toast **only** — do not also auto-raise the banner from `handleRefreshAll`, or two reconnect surfaces stack; the toast's action is the single trigger.
- `backgroundSyncErrorKind === 'network'` (or offline) → warning toast `header.refreshNetworkFailed` (no reconnect action).
- **`else if (backgroundSyncError)`** (any other non-null error, incl. `decrypt` or a future/unclassified kind) → warning toast reusing the existing `error.refreshFailed` (`uiStrings.ts:2786`) + `error.refreshFailedHelp` (`:2790`). **Reliability guarantee:** the generic branch keys off `backgroundSyncError` being _set_, NOT off a specific kind — so a new or null `backgroundSyncErrorKind` can never fall through to no toast (the exact silent-failure this plan kills). Do not couple this to the kind taxonomy beyond the two specific arms above.
  The not-configured branch (`header.refreshNoSync`) and the SW-update toast are unchanged. This is presentation only — all classification stays in the store. Add a `logEvent` import (`@/services/telemetry/logEvent`) to `AppHeader.vue` (not currently imported); emit the `manual-refresh` event from `reportRefreshOutcome()`.

**3. `SaveStatusIndicator` — freshness surfacing (Requirement 4).**

- Add a **"Last refreshed · <time>"** line in the popover's detail block (Drive only), from `formatRelativeTime(syncStore.lastSuccessfulRead, …)` — reusing the exact pattern already used for `relativeSaved` (`:46`).
- Add a **distinct** `const isStale = computed(() => syncStore.dataFreshness === 'stale')` — do **not** gate on the existing `isDegraded` (`:44`), which is a _save-side_ signal (`presentation.attention` off `saveStatus`): the common #69 case is saving healthy while the last read failed, so `isDegraded` would be false and the stale line would render green.
- **Declare the Heritage-Orange tone ONCE in the component** to avoid a drift trap (the literal classes already appear inline at `:210`/`:227`). Add a component-local computed for the attention text/tint classes (e.g. `attentionTextClass` = `text-[#F15D22]`, `attentionTintClass` = `bg-[var(--tint-orange-8)] text-[#A8461B]`) and have BOTH the existing `isDegraded` ternaries and the new `isStale` freshness line reference it — the orange token is then declared in one place. The freshness line's orange is gated on `isStale`; do not add a third hardcoded occurrence.
- **Combined `isStale` + `isDegraded` precedence (they are orthogonal and can co-occur):** the save-side `isDegraded` treatment continues to own the shared popover elements (title `:58-63`, connection line `:206-214`, reassurance copy/tint `:223-231`, recovery button `:234`); `isStale` adds **only** the "Last refreshed" line's orange treatment. A green "connected" line above an orange "last refreshed" line is intended and correct (saving fine, read stale); the two signals must never produce contradictory copy. State which existing `isDegraded`-gated elements `isStale` touches (none but its own line) so the combined state is unambiguous.
- Optionally reflect stale in the row so it's visible without opening the popover (a pass may confirm).
- Bump `POPOVER_HEIGHT_ESTIMATE` (`:40`, currently 180) to account for the added row so the first-paint drop-up clamp stays accurate (runtime uses measured `offsetHeight`, so this only affects the initial estimate — low severity, but do it).
- The existing "manage connection" recovery button already deep-links to Family Data; for a stale-auth state it remains the correct recovery, so no new action is needed here.

**4. i18n.** Add only the genuinely-new keys: `header.refreshAuthFailed`, `header.refreshNetworkFailed`, and `saveStatus.lastRefreshed` (each `en` Title/Sentence-case + all-lowercase `beanie`). **Reuse** `reconnectPrompt.action` (Reconnect), and `error.refreshFailed`/`error.refreshFailedHelp` for the generic-failure toast — do not add `header.reconnect` or `header.refreshFailed`. Then `npm run translate` and spot-check the zh output.

## Files Affected

- `src/stores/syncStore.ts` — add `lastSuccessfulRead` ref + `dataFreshness` computed + `DataFreshness` type + `promptGoogleReconnect()` action; stamp `lastSuccessfulRead` inside `runPostLoadDriveHousekeeping`'s Drive block (single choke point); export new members; reset alongside `lastSync`.
- `src/components/common/AppHeader.vue` — add the failure branches to `handleRefreshAll`; add the `logEvent` import.
- `src/components/ui/SaveStatusIndicator.vue` — add the "Last refreshed" line + a distinct `isStale` computed driving reused Heritage-Orange token classes (not `isDegraded`); reuse `formatRelativeTime`.
- `src/components/ui/saveStatusPresentation.ts` — **no change** (keyed on the unchanged `SaveStatus` union; stale is a component-local `isStale` + reused tokens).
- `src/services/translation/uiStrings.ts` — new `header.refreshAuthFailed`, `header.refreshNetworkFailed`, `saveStatus.lastRefreshed` (`en` + `beanie`). Reuse existing `reconnectPrompt.action`, `error.refreshFailed`, `error.refreshFailedHelp`.
- `public/translations/zh.json` — regenerated via `npm run translate` (review new keys).
- `src/content/help/security.ts` — update the existing "when you last saved" panel article to mention read-freshness / "last refreshed" + the reconnect-on-failed-refresh behavior (see Help Center Coverage).
- Unit tests: `src/stores/__tests__/` (freshness projection + `lastSuccessfulRead` transitions), `src/components/common/__tests__/` or the existing AppHeader test (refresh outcome → toast), `src/components/ui/__tests__/` (SaveStatusIndicator freshness line).

## Help Center Coverage

The existing help article that documents the "when you last saved" / connection panel (`src/content/help/security.ts:705-710`) currently describes save-status only. This change adds a user-visible "last refreshed" line and new refresh-failure/reconnect messaging, so that article's description would become incomplete.

- **Action**: `update existing`
- **Category**: `security` (or `how-it-works` — match the existing article's category)
- **Slug**: the existing save-status / data-safety article containing the "when you last saved" panel (pointer, not new)
- **Title**: unchanged
- **Scope**: extend the article to explain that beanies now also shows _when it last fetched your latest data_ ("last refreshed"), that a manual Refresh will tell you if it couldn't reach your data and offer a reconnect, and that a stale indicator appears when your data may be out of date — framed from the user's point of view (trusting what's on screen).
- **Notes**: clarify that "last saved" and "last refreshed" are different (one is your device writing, the other is fetching others'/latest data); reconnect is the recovery when a refresh can't authorize.

Written per `.claude/skills/beanies-help-docs/SKILL.md`, landed in the same change.

## Observability Coverage

Route through the existing telemetry seams; the manual refresh is an explicit user action, so a failed one that the user can act on is a candidate for a page — but only when it truly blocks them.

- **Events (new/changed):**
  - `logEvent({ level: 'info', surface: 'manual-refresh', message: 'refresh-outcome', context: { action: <'success'|'auth-failed'|'network-failed'|'other-failed'|'not-configured'>, provider_type } })` emitted once per `handleRefreshAll` on **every** outcome including success — so the failure **rate** of manual refreshes is measurable for future alerting (success path emitted too, per the "design for alerting" rule). `surface: 'manual-refresh'` is kebab-case + greppable.
  - The read-freshness transition is already observable indirectly (the auth/network branches of `backgroundSyncFromFile` already log — `scheduleColdStartReconnectEscalation` reports auth escalations). Do **not** add a second event that duplicates that; `manual-refresh` records the _user-facing outcome_, the sync layer records the _cause_. Cross-reference by `family_id` + timestamp in CloudWatch.
- **Failure modes covered:** auth-failed vs network-failed vs decrypt vs not-configured are each distinguishable from the `action` context field on the `manual-refresh` event, correlated with the existing `google-token-lifecycle` / `cold-start-reconnect-escalation` events for root cause — triageable from CloudWatch without a repro.
- **Success-path signal:** the `action: 'success'` event is emitted (info level, no perf floor concern — this is a discrete event, not a timing) so refresh success/fail rates are computable.
- **Critical vs telemetry:** none of these warrant `severity: 'critical'`. A failed manual refresh is self-recoverable (reconnect) and the data is safe locally — it is a firehose `info`/`warn`, not a Slack page. The existing `cold-start-reconnect-escalation` critical page (`syncStore.ts:2445-2457`) still covers the genuinely-stuck cold-start case and is unchanged.
- **Privacy/store gate:** `action` and `provider_type` are already in `ALLOWED_CONTEXT_KEYS` (both are pre-existing context keys). **No new context key ships**, so no `logEvent.ts` allowlist change and no store data-collection declaration change is required. If a pass finds a genuinely new field is needed, it must add it to `ALLOWED_CONTEXT_KEYS` + the native-store-submission declarations — but the plan is designed to avoid that.

## Acceptance Criteria

- [ ] With an expired/revoked token that cannot be silently refreshed, tapping Refresh does **not** show the "beans are fresh" toast and **does** show an immediate "couldn't refresh — please reconnect" warning toast whose action opens the reconnect flow.
- [ ] A refresh that genuinely fetches + merges fresh remote data still shows the success confirmation and sets `dataFreshness = 'fresh'`.
- [ ] An offline/network-failed refresh shows an immediate, distinct "couldn't refresh (check connection)" message (not the reconnect copy, no false success).
- [ ] `dataFreshness === 'stale'` surfaces in `SaveStatusIndicator` (sidebar + mobile) with a "Last refreshed · <time>" line and Heritage-Orange treatment; never Alert Red.
- [ ] `lastSuccessfulRead` advances on read+merge success and on a verified open-skip, and does **not** advance on a save or on any failed read.
- [ ] Local-only (non-Drive) files never show `stale` and never show the freshness line.
- [ ] Help Center article updated to describe last-refreshed + refresh-failure/reconnect behavior and verified against shipped behavior.
- [ ] Diagnostic logging in **Observability Coverage** implemented and verified (the `manual-refresh` event fires on every outcome with the stated `action`/`provider_type`; failure modes triageable from CloudWatch; no new context key needed).
- [ ] All new strings localized (`en` + `beanie`); `npm run translate` run and zh spot-checked.
- [ ] type-check + lint + full `npm run build` + unit tests green.

## Testing Plan

1. **Unit — freshness projection:** table-test `dataFreshness` across `backgroundSyncErrorKind` ∈ {null, auth-transient, network, decrypt} × provider ∈ {google_drive, local} × `lastSuccessfulRead` set/null → expected `fresh|stale|unknown`.
2. **Unit — `lastSuccessfulRead` transitions:** read+merge success advances it; open-skip success advances it; save does not; failed read does not. (Use the `useToday`/timestamp mocking convention already in the repo.)
3. **Unit — `handleRefreshAll` outcomes:** mock `backgroundSyncFromFile` to leave each `backgroundSyncError`/`backgroundSyncErrorKind` combo, assert the correct toast (success / auth+action / network / generic) and that the auth action calls `promptGoogleReconnect`. Assert the success path is unchanged. (Use `vi.resetAllMocks()` in `beforeEach` per the repo lesson on `mockImplementationOnce`.)
4. **Unit — SaveStatusIndicator:** renders the "Last refreshed" line for Drive, hides it for local, applies the stale treatment when `dataFreshness==='stale'`.
5. **Manual (dev):** simulate a dead token (revoke/clear the stored token) → tap Refresh → confirm the reconnect toast + banner appear immediately and the stale indicator shows; then reconnect → confirm success toast + `fresh` + freshness line updates. Confirm a clean refresh still confirms success. Confirm offline shows the network copy.
6. **Regression:** save-status row/popover behavior and `saveStatus` transitions unchanged; no double-toast; `npm run build` (rollup import-graph) green given new store exports consumed by two components.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the read-freshness reframe — new `lastSuccessfulRead` + `dataFreshness` single-source projection in syncStore, missing failure branches in `handleRefreshAll`, freshness surfacing reusing `SaveStatusIndicator`, grounded in a full control-flow trace confirming #69's original symptom is already fixed and the real gap is absent failure feedback.
- **Pass 2 (DRY + error handling)**: Routed `lastSuccessfulRead` through the single existing `runPostLoadDriveHousekeeping` choke point (drift-proof, Drive-gated, covers the two decrypt-recovery termini the draft missed, cannot fire on the cache path); gated the stale treatment on a new `isStale` (not the save-side `isDegraded`); dropped `saveStatusPresentation.ts` (no change); reused existing i18n (`reconnectPrompt.action`, `error.refreshFailed*`) instead of new duplicate keys; confirmed `promptGoogleReconnect()` is a needed add + no double reconnect surface; noted the `logEvent` import for AppHeader and the accepted freshness non-advance sub-paths.
- **Pass 3 (Sustainability)**: Specified the combined `isStale`+`isDegraded` popover precedence (save-side owns shared elements; stale adds only its own line); made the generic failure branch key off `backgroundSyncError` being set (not a kind literal) so an unclassified error can never fall through to silence; extracted a `reportRefreshOutcome()` helper for flat, testable outcome logic; declared the Heritage-Orange tone once via a component-local computed to avoid a third drift occurrence; noted the `POPOVER_HEIGHT_ESTIMATE` bump and the by-design in-flight `dataFreshness` clearing.
- **Pass 4 (Fresh-eyes sweep)**: Verified every line citation against source. One must-fix applied — made `dataFreshness` an explicitly **total** mapping (`decrypt`/unclassified → `fresh`-or-`unknown`, never `stale` or `undefined`). Added conscious-accept notes: generic toast must use `'warning'` level (not the existing `'error'` call site that pages Slack), duplicate auth toasts can stack (actionFn exempts dedupe), and permission-revoked-mid-session reads `fresh` briefly. Otherwise confirmed ready to implement.

## Post-implementation redesign (after `/code-review max`, 2026-08-24)

The first implementation was reviewed by `/code-review max`, which surfaced that the plan (and passes) had **missed the globally-mounted `BackgroundSyncBar`** — a component that already toasts on `backgroundSyncError` (network → toast; auth → deliberately silent, deferring to the reconnect surface) — and that read-freshness state only updated on the **manual** path, leaving the passive scenarios (the actual user story) under-served. greg chose to redesign. The shipped implementation therefore differs from the Approach above as follows (net simpler):

1. **No custom refresh toasts.** Dropped the `header.refreshAuthFailed`/`header.refreshNetworkFailed` toasts and the `classifyRefreshOutcome` mapper. On manual refresh: success → success toast; **auth failure → raise the existing reconnect surface immediately** via `promptGoogleReconnect()` (no competing toast); network/decrypt → `BackgroundSyncBar` owns the toast (no duplicate). Resolves the double-toast + competing-reconnect-surface + toast-duration findings.
2. **MVO: store owns classification + telemetry.** `backgroundSyncFromFile(openToken?, { manual })` now returns a `RefreshOutcome` and logs the `manual-refresh` event itself; the view maps the returned outcome via a pure `presentRefreshOutcome()` (success toast / reconnect / nothing). No store internals read from the view, no `logEvent` in the view.
3. **False-success on in-flight fixed.** The in-flight guard returns `'skipped-in-flight'`; the view shows nothing (the running sync's progress bar is the feedback), never a false "refreshed".
4. **Read-freshness robust across ALL paths.** A single `markDriveReadSuccess()` (stamp `lastSuccessfulRead` + clear `backgroundSyncError`/kind) runs at every success terminus — the open choke point, the poll re-decrypt termini, and the new-device/join + file-load termini that bypassed it. The 10s poll now marks `auth-transient` on an auth failure so staleness surfaces **passively** (token dies while the app sits open) without a manual refresh, and a successful read (incl. after reconnect) **clears** stale — fixing the stuck-stale-after-reconnect bug.
5. **`decrypt` → `stale`.** `dataFreshness` now treats any non-null error kind as `stale` (the on-screen data may be behind Drive in every case, which is exactly what the badge says).
6. **Copy/UX**: the "Last refreshed" line hides when there's no read time (no save-domain fallback copy); the connection line reads "Reconnecting" on `isStale` too (never green "Connected" above an orange stale line).

- **Redesign verification**: type-check + lint + full `npm run build` + **4734** unit tests green; 2 stale zh keys pruned via `npm run translate`. Re-reviewed by a second `/code-review max` pass.

## OUTCOME — scope cut to the refresh-honesty half (2026-08-24, greg's call)

**What shipped is roughly half of what this plan specifies. Read this section before treating any of the above as the built design.**

Three `/code-review max` rounds ran against the implementation (15, then 19, then 15 findings). The third confirmed the feature **did not deliver its stated guarantee**: the passive-staleness branch keyed on `change.reason === 'auth'`, but a dead Drive token reaches `remoteChanged`'s catch as `'file-not-found'` (404 is tested before auth, `syncService.ts:664-668`) and an offline probe as `'no-evidence'` — so the headline "token dies while the app sits open" case never marked stale at all. Three further findings (poll's `unchanged` arm wiping a standing `decrypt`; `staleOnly` only firing for `saveStatus === 'hidden'` so any user who had ever saved kept a green row; the poll's cannot-decrypt arm recording nothing) were independent ways the signal failed to appear or falsely cleared. Tests stayed green throughout because they assigned the computed's own inputs and re-derived its ternary.

The work was **not converging** — each round fixed real bugs and introduced or missed others — so greg cut scope rather than continue patching.

**SHIPPED (the refresh-honesty half):**

- `RefreshOutcome` returned by `backgroundSyncFromFile(openToken?, { manual })`, with store-owned `logManualRefreshOutcome` telemetry (MVO).
- `AppHeader` presents the outcome via a pure `presentRefreshOutcome`: success confirms; **auth failure warns** (no action button, and it must NOT raise the reconnect banner — doing so trips `scheduleColdStartReconnectEscalation`'s guard and silently suppresses the critical Slack page); network/decrypt defer to the already-mounted `BackgroundSyncBar`; an in-flight tap reports nothing rather than a false "refreshed".
- Auth-masked-404 now classified from `loadResult.reason`, not the `/silent refresh failed/i` string test.
- `backgroundSyncError`/`Kind` cleared on disconnect/reset so a read error can't leak into the next family.

**REVERTED (the read-freshness half) — none of this is in the codebase:**
`lastSuccessfulRead`, `dataFreshness`/`DataFreshness`, `markDriveReadSuccess`, every poll-path marking, the whole `SaveStatusIndicator` freshness UI (last-refreshed row, `isStale`, `showRow`/`staleOnly`, attention tokens), the help-doc rewrite, and the `immediate` escalation mode.

**If read-freshness is picked up again, start from these constraints (the reviews' real value):**

1. A dead token surfaces as **404**, not 401 — classify off `isTokenValid()`/status, never a reason string.
2. `remoteChanged`'s `'unchanged'` is a _metadata_ probe: it must not clear a `decrypt` failure, and its `basis` can be `'mtime'`, which `shouldSkipOpenRead` explicitly rejects.
3. Two provider gates disagree — `syncService.getProviderType()` vs the `storageProviderType` ref.
4. `isBackgroundSyncing` is not "a Drive read is in flight" (`loadFromPersistenceCache` sets it for the boot snapshot paint).
5. `SaveStatusIndicator` is gated on the save-domain `presentation.visible`, and the mobile shell's attention dot derives purely from `saveStatus` — a read-side signal needs its own path to both.
6. Tests must drive `backgroundSyncFromFile` (see `syncStore.bannerVisibility.test.ts`), not assign a computed's inputs.

## Prompt Log

> No GitHub issue created — direct implementation. Full intake is on Notion tracker #69 (Status: In Progress).

<details>
<summary>Full prompt history</summary>

### Initial prompt (via /beanies-pre-plan → /beanies-plan)

`69 let's plan and implement #69 once pre-plan is done move on to /beanies-plan` — followed by the assembled `=== BEANIES PRE-PLAN ===` block for tracker #69 (bug, high, All platforms, area overall; false-success / masked-staleness on a failed Drive read). Open question carried in: persistent staleness indicator vs toast-only.

### Follow-up 1 (scope decision)

When the trace revealed #69's success-toast symptom was already fixed (shipped 2026-05-03) and the real gap is the **absent failure branch** in `handleRefreshAll`, greg chose scope: **"Reframe around read-freshness"** — treat "when did we last successfully READ from Drive" as first-class state (distinct from `lastSync` = last save), surface it app-wide, and drive both the toast and a staleness badge from it.

</details>
