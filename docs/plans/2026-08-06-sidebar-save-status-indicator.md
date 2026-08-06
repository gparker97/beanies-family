# Plan: Persistent all-roles save-status indicator in the app sidebar

> Date: 2026-08-06
> Related issues: None — direct implementation (Notion tracker #60; GitHub issue: SKIP per row)
> Plan file: `docs/plans/2026-08-06-sidebar-save-status-indicator.md`
> Mockup: `docs/mockups/sidebar-save-status-indicator-2026-08-06.html`

## User Story

As a family member without admin access, I want to see at a glance whether my family data is connected and my latest save succeeded, so I can trust my edits are safe and raise it with the owner if they're not.

## Context

Today no user — admin or not — has an always-visible, positive confirmation that their family data is saving. The only always-on save signal is `SaveFailureBanner`, which is negative-only and fires after 3 consecutive failures (`syncService` escalation: 0 = none, 1–2 = warning [no UI], ≥3 = critical [banner]). Positive status ("Last Saved" + connection) lives solely inside the Family Data modal, whose trigger card is `v-if="canManagePod"` (`SettingsPage.vue:717`) — so non-admin members see nothing positive and rely entirely on a delayed failure banner. This adds a persistent, all-roles save-status row into the existing sidebar security-indicator cluster — the quiet footer that already shows the file name (`CloudProviderBadge`) and encryption status. Per the CIG's Security & Privacy UI rule, security indicators are "felt, not seen": the row is a whisper at rest and only warms to Heritage Orange (never Alert Red) when a save is actually struggling. Placement moved from the app header (original intake) to the sidebar per greg (2026-08-06). Approved design: Direction A — quiet status row (`docs/mockups/sidebar-save-status-indicator-2026-08-06.html`).

## Requirements

1. Persistent save-status row, visible to all roles, rendered inside the sidebar security-indicator cluster — in both surfaces that render that cluster: `AppSidebar.vue` (desktop, ~L316) and `MobileHamburgerMenu.vue` (mobile drawer footer, ~L538).
2. Three visible states: Saved (`Saved · <relative time>`, quiet soft-green `#6EE7B7`), Saving… (Sky-Silk `#AED6F1` pulse), Degraded (`Having trouble saving`, Heritage Orange `#F15D22` — never Alert Red).
3. One-retry (attempt-based) debounce: a first failure does not immediately show amber; warms to amber only once a save has failed on ≥2 consecutive attempts. At ≥3 (critical) the existing SaveFailureBanner takes over; this component does not change thresholds or duplicate the banner.
4. Tap opens a small popover: everyone sees connection (Drive) + last-saved; users with manage-pod permission (`canManagePod` — owner or delegated manager) get one recovery action that deep-links to the existing Family Data modal (which already houses Reconnect + Switch file). Members without that permission see status only.
5. Storage-mode-correct copy: Drive → connection + account email + last saved; Local → last-saved only, no "connected" line. The connection line is rendered by reusing `CloudProviderBadge`, not new provider-copy.
6. Collapsed-state cue: degraded-only Heritage-Orange dot on `HamburgerButton` when the mobile drawer is shut; clears on next successful save. Desktop sidebar is non-collapsible so no desktop cue.
7. Passive chrome — no new auto-popup; popover opens only on tap.
8. i18n: all strings via `uiStrings.ts` (`en` + `beanie`); relative-time label localized (not English-only `timeAgo()`).
9. Observability: `logEvent({ surface: 'save-status' })` on transitions incl. success path, reusing already-allowlisted, auto-injected context (`provider_type`, `save_failure_level`) plus at most one new `save_status` key.

## Important Notes & Caveats

- **Reuse, don't duplicate the cluster.** The security cluster (CloudProviderBadge + encryption label + version) is currently duplicated in `AppSidebar.vue` and `MobileHamburgerMenu.vue`. Add the new row as a single shared component (`SaveStatusIndicator.vue`) consumed by both. Extracting the entire cluster is out of scope.
- **Reuse the popover primitives, don't invent them.** Use the shared `useEscapeClose(isOpen, onClose)` composable for Escape dismissal, and follow the documented Teleport + `getBoundingClientRect` + viewport-clamp + scroll/resize idiom that 6 components already share (see the `TODO(consolidation)` in `TodoSortMenu.vue:32`). Do NOT attempt the cross-component popover-primitive extraction — that TODO explicitly scopes it out; match the existing consumers so the eventual extraction covers this one too. Click-outside is a single teleport-aware document listener as in `TodoSortMenu`.
- **Reuse `CloudProviderBadge` in the popover.** Its connection/account/local-vs-Drive copy + tooltip already exist (`providerType` / `fileName` / `accountEmail` / `variant`; it derives "Connected as {email}" via the existing `googleDrive.connectedAs` key and suppresses the connection line for local). The popover renders it rather than re-deriving that copy.
- **The failure-level callback only fires on level transitions** (none↔warning↔critical). `warning` spans 1–2 consecutive failures, so a 1→2 change does NOT notify — driving amber at exactly ≥2 requires the raw count. The `consecutiveFailures` var already exists in `syncService.ts` (module-level `let` at ~L236, not exported); expose it + notify per attempt.
- **Why a dedicated per-attempt channel, not the existing `onStateChange` fan-out (ordering caveat — do not "simplify" this away).** `doSave()` calls `updateState({ isSyncing:false, … })` — which fires `onStateChange` — BEFORE it calls `recordSaveSuccess()` / `recordSaveFailure()`, which is what mutates `consecutiveFailures` (verified: `syncService.ts` L947→950 success, L959→960 failure). So reading `getConsecutiveSaveFailures()` from inside the store's existing `onStateChange` subscription would read the _previous_ count. The per-attempt callback fires from _inside_ `recordSaveSuccess`/`recordSaveFailure` with the freshly-updated count, sidestepping the ordering trap. Document this rationale at the callback site so a future consolidation into `onStateChange` doesn't silently reintroduce an off-by-one count.
- **No immediate auto-retry exists.** `doSave()` failure just increments the count; the next attempt is the next debounced save. So the debounce is attempt-based, not timer-based — a lone transient failure that never gets a second attempt stays "Saved".
- **Critical tier stays with the banner.** At ≥3 the row shows degraded (amber) styling and defers the loud alarm to the banner — no second red surface.
- **Recovery reuses the single canonical surface.** `SaveFailureBanner.goToSettings()` (`SaveFailureBanner.vue:61-64`) already deep-links to `{ path: '/settings', query: { open: 'family-data' } }`; `SettingsPage`'s `cardOpenMap['family-data']` opens the Family Data modal (Reconnect + Switch file live there). The popover's manage-pod action reuses this exact deep-link — it does NOT call `useGoogleReconnect` or `loadFromNewFile` directly, and it does NOT touch `showGoogleReconnect` (that is a reactive flag, not a trigger). To avoid a second hardcoded copy of the query contract, extract the `{ path: '/settings', query: { open: 'family-data' } }` target into one shared constant/helper that both `SaveFailureBanner` and the new popover import (single source of truth for the deep-link).
- `formatLastSync` in `SettingsPage.vue:518` is trivial (`toLocaleString()`) — do not reuse for "2 min ago".
- **`saveStatus` is a distinct projection from the existing `syncStatus` — name and document both to prevent confusion.** `syncStore` already exposes a `syncStatus` computed (`not-configured | needs-permission | syncing | error | ready`, `syncStore.ts:359`) serving other consumers; the new projection (`saving | critical | degraded | saved | hidden`) is a _presentation_ status for this indicator only. Give it a named exported union type (`SaveStatus`) and a header comment on both computeds cross-referencing each other, so a future reader doesn't assume they're interchangeable or try to merge them. Note that `needsPermission` is intentionally NOT a distinct `saveStatus` state — a stale Drive permission surfaces through the ordinary consecutive-failure escalation into `degraded`/`critical`, so no extra branch is warranted.
- **`saveStatus` must be a total function — no `undefined` leak into the presentation map.** `isConfigured` can be `true` while `lastSync` is still `null` (Drive/local configured, before the first save completes — verified `syncStore.ts:121` / `:133`). If the `'saved'` branch requires `lastSync`, that first-configured-but-never-synced case (with no failures and not currently syncing) matches none of `saving`/`critical`/`degraded`/`saved`, and the naïvely-written computed returns `undefined` — which would index the status→presentation `Record<SaveStatus, …>` with a missing key. The computed MUST end with an explicit terminal fallback so it is total (see Approach step 1); the presentation map is keyed on the full `SaveStatus` union with no optional access.
- **Emit transition telemetry from exactly one owner, not per-component.** The cluster mounts in BOTH `AppSidebar` (desktop) and `MobileHamburgerMenu` (mobile) — and the dot lives on a third consumer (`HamburgerButton`). If the transition-logging `watch(saveStatus)` lived in `SaveStatusIndicator.vue`, two mounted instances would each fire it, double-counting every transition and corrupting the success-rate metric. Own the transition telemetry in a single place tied to the store-level `saveStatus` (one `watch` in the store, or a once-instantiated composable), never in the per-instance component.
- The existing `saveFailureCallbacks.forEach((cb) => cb(...))` dispatch (`syncService.ts:250`) is unguarded — a throwing subscriber would break the escalation path. The new per-attempt dispatch must NOT copy that gap (guard each subscriber in `try/catch`).
- No feature gate (per row).

## Assumptions

> **Review these before implementation.** Valid at planning time (2026-08-06).

1. `syncStore` reactive state is authoritative and updated on save lifecycle: `isSyncing`, `lastSync`, `saveFailureLevel`, `lastSaveError`, `storageProviderType`, `providerAccountEmail`, `isGoogleDriveConnected`, `isConfigured`, `fileName`.
2. Desktop `AppSidebar` remains non-collapsible; only the mobile hamburger drawer hides the row.
3. `canManagePod` (owner OR member with the `canManagePod` flag) is the correct gate for exposing the recovery action.
4. A localized relative-time formatter via `Intl.RelativeTimeFormat` keyed to the active locale is acceptable; no shared localized "time ago" helper exists today (`timeAgo()` is English-only).
5. The `/settings?open=family-data` deep-link is the existing, sufficient recovery entry point; the popover needs no new orchestration. `showGoogleReconnect` is a state flag, not an invocable trigger.

## Approach

Design the presentation as a single derived `saveStatus` so the row, popover, and hamburger dot all read one source of truth (DRY).

1. **Expose the consecutive-failure count (data layer):** in `syncService.ts` add `getConsecutiveSaveFailures()` and an additive per-attempt callback channel (`saveAttemptCallbacks`) fired inside `recordSaveSuccess()`/`recordSaveFailure()` with the current count (with a one-line comment stating why this is a separate channel from `onStateChange` — the ordering caveat above). Dispatch each subscriber inside a `try/catch` (a throwing subscriber must never break the save path — the existing `saveFailureCallbacks.forEach` at L250 is unguarded; do not copy that gap). The existing level-change channel is untouched. In `syncStore.ts` mirror the count into a `consecutiveSaveFailures` ref (updated from the per-attempt callback, matching the existing `saveFailureLevel` mirroring pattern) and add a computed `saveStatus` typed as an exported `SaveStatus` union, with a header comment distinguishing it from the pre-existing `syncStatus`. The branches are evaluated in order and the computed is **total** — the final line is an explicit fallback, never an implicit fall-through:
   - `'saving'` when `isSyncing`
   - `'critical'` when `saveFailureLevel === 'critical'` (row shows amber; banner owns the alarm)
   - `'degraded'` when not syncing and `consecutiveSaveFailures >= 2` and below critical
   - `'saved'` when `isConfigured && lastSync` (a single failure, count === 1, resolves here)
   - `'hidden'` as the explicit terminal fallback — covers both "not configured" AND the transient "configured but no `lastSync` yet, no failures" first-launch window, so the computed can never yield `undefined` into the presentation map.
   - **Transition telemetry lives here, once:** a single `watch(saveStatus)` in the store (or a composable instantiated exactly once at app scope) emits the `surface: 'save-status'` `logEvent` on each change — NOT in `SaveStatusIndicator.vue`, which mounts twice.

2. **Shared `SaveStatusIndicator.vue`** (new, `src/components/ui/`), consuming `useSyncStore` / `usePermissions` / `useTranslation`. Keep the SFC thin — it is presentation only (no telemetry ownership):
   - **State→presentation mapping is a small pure lookup** — a `Record<SaveStatus, { labelKey; colorClass; icon }>` keyed on the full union (no optional access, since `saveStatus` is total), unit-testable in isolation, rather than nested template ternaries — keeps the template flat and the branching testable. The `'hidden'` key maps to a render-nothing branch (`v-if` on the row), so the transient no-`lastSync` window shows nothing rather than a broken label.
   - **Row:** a button matching the sibling security rows (low opacity at rest, amber-tinted when degraded/critical, rem-based, `text-xs`, squircle). Label = localized relative time when saved.
   - **Popover:** opened on tap; dismissed via shared `useEscapeClose(isOpen, close)` + teleport-aware click-outside, positioned with the shared drop-up/clamp idiom. Contents: status title/badge by state; connection line reuses `<CloudProviderBadge :provider-type :file-name :account-email variant="light">` (which already suppresses the connection line for local and shows account email for Drive); last-saved line; then, gated on `canManagePod`, a single "Fix / manage connection" action that runs `openFamilyData()` (below), else a short reassurance note. Members never see the action.
   - `openFamilyData()` uses the shared deep-link constant and wraps the navigation in try/catch (a redundant-navigation rejection from `router.push` must be swallowed, not surfaced): `router.push(FAMILY_DATA_DEEP_LINK).catch(() => {})` then `close()`.
   - Consumed in `AppSidebar.vue` (~L316) and `MobileHamburgerMenu.vue` (~L538), added above the file-name badge. In the mobile drawer, opening the popover closes the drawer first (or renders above it) so it isn't clipped — follow the teleport-to-body idiom, which already sidesteps clipping ancestors.

3. **Collapsed-state dot on `HamburgerButton.vue`:** absolutely-positioned Heritage-Orange dot shown when `saveStatus` is `degraded`/`critical`, driven by the same `saveStatus` computed; `aria-label` gains a "needs attention" suffix when shown.

4. **Relative-time label (i18n):** add `formatRelativeTime(iso, locale)` to `src/utils/date.ts` (co-located with `timeAgo`) using `Intl.RelativeTimeFormat` with the active locale from the i18n layer. It must never throw or render blank: guard invalid/empty ISO and any `Intl` unavailability by falling back to `timeAgo(iso)` (or absolute `formatDate`). Reused by row + popover. Do not reuse English-only `timeAgo()` for the primary label.

5. **Strings:** add `uiStrings.ts` keys (`en` + `beanie`) for saved/saving/degraded, popover title/last-saved line, the single recovery-action label, reassurance note, and the hamburger aria-label suffix. Follow the Text Casing Standard. Run `npm run translate`, spot-check zh. (Connection copy comes from `CloudProviderBadge`'s existing keys — no duplication.)

## Files Affected

- `docs/mockups/sidebar-save-status-indicator-2026-08-06.html` (already committed)
- `src/services/sync/syncService.ts` — `getConsecutiveSaveFailures()` + guarded per-attempt callback (with the ordering-rationale comment)
- `src/stores/syncStore.ts` — mirror count ref + exported `SaveStatus` type + total `saveStatus` computed (added to the store's return) + the single transition-telemetry `watch`; cross-reference comment vs `syncStatus`
- `src/components/ui/SaveStatusIndicator.vue` — new shared component (row + popover), presentation-only, reusing `useEscapeClose` + `CloudProviderBadge`; pure status→presentation lookup keyed on the full `SaveStatus` union
- `src/components/common/AppSidebar.vue` — render `<SaveStatusIndicator>`
- `src/components/common/MobileHamburgerMenu.vue` — render `<SaveStatusIndicator>`
- `src/components/common/HamburgerButton.vue` — degraded/critical amber dot
- `src/components/google/SaveFailureBanner.vue` (+ a shared deep-link constant/helper module) — refactor `goToSettings()` to import the shared `FAMILY_DATA_DEEP_LINK` so the popover and banner share one query contract
- `src/utils/date.ts` — `formatRelativeTime(iso, locale)` with `timeAgo` fallback
- `src/services/translation/uiStrings.ts` — new keys (`en` + `beanie`)
- `src/utils/diagnosticContext.ts` — only if a new `save_status` key is added to `ALLOWED_CONTEXT_KEYS` (`provider_type` + `save_failure_level` already exist and auto-inject at L439-440 — reuse them)
- `docs/runbooks/native-store-submission.md` (+ PrivacyInfo.xcprivacy, data-safety, privacy.astro) — declare only a genuinely new context key
- Unit tests for `saveStatus` (incl. totality), the pure presentation map, and component states

## Help Center Coverage

- **Action**: update existing (or new article if none covers saving/data safety).
- **Category**: how-it-works / security.
- **Article type**: explainer.
- **Slug**: existing Family Data article or new `understanding-save-status`.
- **Title**: How beanies saves your family data (and how to tell it's working).
- **Scope**: explains the sidebar indicator from the user's side — the three states, all-roles visibility, manage-pod-only recovery, Drive vs local.
- **Notes**: single blip won't alarm; the loud banner still appears on sustained failure; edits are held on-device until the next save lands.

## Observability Coverage

- **Events**: `logEvent({ level: 'info', surface: 'save-status', message: 'save status transition', context: { save_status, consecutive_failures } })` on each transition incl. → `saved` (success path) for rate measurement. Emitted from the single store-level `watch(saveStatus)` (NOT the component) so the two mounted instances can't double-count. `provider_type` and `save_failure_level` are already auto-injected into every `logEvent` via `diagnosticContext` (L439-440) — do NOT re-pass them as `storage_type`/`storageType`.
- **Failure modes covered**: a member's "wasn't saving" report is diagnosable blind by filtering `surface: save-status` on `family_id` (sequence of `save_status` + `consecutive_failures` + auto-injected `provider_type` + `save_failure_level`).
- **Success-path signal**: → `saved` emitted (so degraded/recovery rates are queryable).
- **Critical vs telemetry**: firehose-only (info); must not page — the existing critical path (`showBannerWithTelemetry`) owns `severity: 'critical'`.
- **Privacy/store gate**: `save_status` + `consecutive_failures` are non-PII fixed-enum/number values. `provider_type` is already declared. If `save_status`/`consecutive_failures` are added to `ALLOWED_CONTEXT_KEYS` (in `diagnosticContext.ts`), declare them in `native-store-submission.md` (+ xcprivacy, data-safety, privacy.astro) AND mirror in the telemetry Lambda's copy of the allowlist + its pinned test. `provider_type` and `save_failure_level` need no new declaration.

## Acceptance Criteria

- [ ] Non-admin member sees the row (connected + last-saved) on desktop sidebar and mobile drawer.
- [ ] Success → `Saved · <relative time>`; during save → `Saving…`.
- [ ] Sustained failure (≥2) → amber; single blip does not.
- [ ] Critical (≥3) → existing banner appears; row adds no second red surface.
- [ ] Recovery action only for `canManagePod`; other members see status only; action deep-links to the existing Family Data modal (no reimplemented reconnect/switch flow) via the shared deep-link constant.
- [ ] Local → no connection line; Drive → connection + account email + last saved — via reused `CloudProviderBadge`.
- [ ] Degraded + drawer closed → amber dot on hamburger; none when healthy; clears on next success.
- [ ] Row + popover + dot driven by one `saveStatus` (typed `SaveStatus`, distinct from `syncStatus`); cluster markup is a single shared component; popover reuses `useEscapeClose`; status→presentation is a pure, testable map.
- [ ] `saveStatus` is total — configured-but-never-synced (and not-configured) both resolve to `hidden`; the computed never yields `undefined` and the presentation map is never indexed by a missing key.
- [ ] Transition telemetry fires exactly once per transition even with both desktop + mobile instances mounted (single store-level owner).
- [ ] Relative-time formatter never throws or renders blank (invalid ISO / no-`Intl` → `timeAgo` fallback).
- [ ] All strings via `uiStrings.ts` (`en` + `beanie`); relative time localized; `npm run translate` run + zh checked.
- [ ] Passive chrome only.
- [ ] `surface: 'save-status'` fires on transitions incl. success; triageable from CloudWatch; any new context key allowlisted (client + Lambda mirror) + declared; no duplicate `storage_type` key introduced.
- [ ] Help Center article added/updated to match shipped behavior.
- [ ] `npm run build` (full rollup import-graph) + type-check + lint + Vitest pass.

## Testing Plan

1. Unit — `saveStatus` mappings incl. single-failure-stays-saved and count===2 → degraded.
2. Unit — `saveStatus` totality: configured-but-`lastSync`-null (no failures, not syncing) → `hidden`, and not-configured → `hidden`; never `undefined`.
3. Unit — pure status→presentation map returns correct label/color/icon for every `SaveStatus` key (including `hidden` → render-nothing).
4. Unit — component label/dot per status; manage-pod-gated action; local vs Drive copy (via CloudProviderBadge).
5. Unit — `formatRelativeTime` fallback path (invalid ISO, `Intl.RelativeTimeFormat` undefined) returns non-empty.
6. Unit — per-attempt callback dispatch survives a throwing subscriber (save path unaffected).
7. Unit — transition telemetry emits once per transition with two `SaveStatusIndicator` instances mounted (guards the double-emit regression).
8. Manual (Drive owner) — force failure; first attempt quiet, second → amber; popover action opens Family Data modal; recover → Saved.
9. Manual (member) — positive row + status, no action.
10. Manual (local) — popover last-saved only, no connection line.
11. Manual (mobile) — close drawer while degraded → dot; open → row; success → dot clears.
12. Observability — CloudWatch save-status events with `save_status` + auto-injected `provider_type`; verify single emission per transition.
13. i18n — beanie + zh; relative time localized.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted from the approved mockup + code grounding — shared component, `saveStatus` projection, attempt-based debounce via exposed count, mobile-only hamburger dot, localized relative time, observability + help-center coverage.
- **Pass 2 (DRY + error handling)**: Replaced the two reimplemented owner recovery flows with a single reuse of the existing `/settings?open=family-data` deep-link (Family Data modal already houses Reconnect + Switch file); corrected the false `showGoogleReconnect`-as-trigger assumption; reused `useEscapeClose` + the documented teleport/popover idiom and `CloudProviderBadge` for the connection line instead of new markup; dropped the redundant `storage_type` telemetry key in favor of the already-allowlisted/auto-injected `provider_type` + `save_failure_level` (allowlist lives in `diagnosticContext.ts`, not `logEvent.ts`); and closed silent-failure gaps (guarded per-attempt callback dispatch, non-throwing/never-blank relative-time formatter with `timeAgo` fallback, swallowed redundant-navigation rejection).
- **Pass 3 (Sustainability)**: Moved transition telemetry to a single store-level owner (the component mounts twice — desktop + mobile — so a component-owned watcher would double-count every transition); named the new projection `SaveStatus` and required a cross-reference comment against the pre-existing `syncStatus` to prevent confusion/accidental merge; documented WHY the per-attempt callback is a separate channel from `onStateChange` (the `updateState`-before-`recordSave*` ordering makes the count stale in `onStateChange`) so it isn't naively consolidated into a bug; extracted the `/settings?open=family-data` target into one shared deep-link constant reused by the banner + popover; kept `SaveStatusIndicator.vue` thin by mapping status→presentation through a pure, testable lookup instead of nested template ternaries; and added the Lambda-allowlist-mirror reminder for any new context key.
- **Pass 4 (Fresh-eyes sweep)**: Verified every load-bearing claim against the code (the L947→950 / L959→960 ordering, unguarded `saveFailureCallbacks.forEach` at L250, module-level `consecutiveFailures`, `CloudProviderBadge` props, `useEscapeClose` signature, banner deep-link, `provider_type`/`save_failure_level` auto-injection). Closed one genuine robustness gap: `isConfigured` can be `true` while `lastSync` is `null` (first-launch, pre-first-save), which made the `saveStatus` computed fall through to `undefined` and index the presentation `Record` with a missing key — made `saveStatus` a **total** function with an explicit `'hidden'` terminal fallback and added a caveat, an acceptance criterion, and a totality unit test. Also noted `needsPermission` is intentionally not a distinct `saveStatus` state (it flows through the failure escalation). No other changes warranted.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Pre-plan intake (Notion #60, assembled block)

The full `=== BEANIES PRE-PLAN ===` block for #60 — objective, scope, user story, UX, acceptance, edge cases, reuse hints, references, resolved open questions, notes. Placement moved from app header to sidebar; one-retry (attempt-based) debounce; local-file no-connection-line; sidebar/drawer placement + degraded-only amber dot on the hamburger; approved Direction A mockup (`docs/mockups/sidebar-save-status-indicator-2026-08-06.html`). GitHub issue: SKIP. Feature gate: NO.

### /beanies-plan invocation

> proceed to create the plan

</details>
