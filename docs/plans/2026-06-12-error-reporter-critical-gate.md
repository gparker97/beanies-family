# Plan: Gate the error→Slack reporter to critical-only (quiet by default)

> Date: 2026-06-12
> Related issues: None — direct implementation. From `/error-review` of a live calendar-sync 403 over-page.
> Plan file: `docs/plans/2026-06-12-error-reporter-critical-gate.md`
>
> **No GitHub issue created.** Approved for direct implementation. Full prompt history embedded under **Prompt Log**.

## User Story

As the beanies.family operator, I want `#beanies-errors` to page only on genuinely fatal / user-impacting errors, so the channel stays signal-rich and run-of-the-mill / background errors are captured in telemetry without paging.

## Context

`src/utils/errorReporter.ts` comments _"Slack is only the critical subset"_ but never implemented that gate: `handleReport` mirrors every error to the telemetry firehose (`logEvent`), then sends to Slack for anything not deduped/allowlisted. `severity` only set the telemetry level + Slack header — it did NOT gate the send, so background/best-effort/recoverable errors paged. Trigger: a transient `calendar-sync` 403 (`save_failure_level: none`, no toast, calendar worked) paged as if fatal. greg's bar: page only when a user action failed or data is at risk (failed save, pod file couldn't be created, onboarding/render/engine break).

## Requirements

1. **Gate:** only `severity: 'critical'` pages Slack. `error`/`warning`/unspecified → telemetry + console only (firehose still records all three).
2. **Quiet by default:** unspecified severity never pages; paging is explicit opt-in.
3. **Promote, don't demote:** the gate flips everything non-paging; only add `severity: 'critical'` to genuinely user-fatal sites. `error`/`warning` stay meaningful for telemetry filtering.
4. **Toasts:** `showToast('error')` stops paging by default; add `{ critical: true }` opt-in; gate the "Support has been notified" line to critical-only (truthful).
5. **Globals (`main.ts`):** `vue-render` + `unhandled-error` → critical; `unhandled-promise-rejection` stays non-paging (keeps allowlists).
6. **Calendar-sync = page only if sustained:** single transient reconcile error → log-only; one critical page only when a connection stays in error across N consecutive reconciles (mirror `INVALID_GRANT_THRESHOLD`).
7. **Converge on one `critical` vocabulary:** wire `useJoinFlow`'s existing per-code `severity` through `recordError → reportError` (was dead metadata). No second notion of "critical".
8. **Maintainability:** make "critical" greppable + guard-tested so the default-quiet contract can't silently rot.

## Approach

- **`errorReporter.ts`:** widen `ErrorSeverity = 'critical' | 'error' | 'warning'`; tighten the `severity` JSDoc into the call-site contract (incl. the `rg "severity: 'critical'"` enumeration hint); insert one gate line after the telemetry mirror — `if (input.severity !== 'critical') return;`. Telemetry level map unchanged (`'critical'` falls into the `'error'` branch). `buildSlackMessage` left as-is (only critical reaches it) with a clarifying comment.
- **Promote ~18 page-worthy sites to `critical`:** `CreatePodView` (createNewFile ×2, `${result.reason}`, connectDrive non-cancelled, selectLocalFile); `ResumePodSetup` (podCorrupted, finalize, `${result.reason}` — granular recoverable sub-steps left log-only, telemetry-captured, quiet-by-default); `SetupProgressModal` (firstSync, finalize, unexpected); `useStoreActions` (engine-panic); `syncStore` (save-failure-banner, cold-start-reconnect-escalation, storage-migration-failed); `App.vue` (redirectAuthCompletion, onboardingZombieState) + `router` (onboardingZombieState). **Deliberately left non-critical:** `app.postInitNoData` (documented false-fire history), `familyStore.transferOwnership` (its own comment says non-fatal — transfer already succeeded), `milestonesStore`/`activityStore` (cosmetic/render), `offlineQueue` flush (retryable), all `calendar-sync` (sustained gate handles it), chunk-recovery (browser-prone).
- **`useJoinFlow.ts`:** forward `severity: JOIN_ERRORS[code].severity` in `recordError` (11 critical / 1 warning).
- **`useToast.ts`:** add `critical?: boolean` to `ToastActionOptions`; forward `severity: options?.critical ? 'critical' : undefined`; set `reported = type === 'error' && !options?.silent && !!options?.critical` (the line is `t('error.supportNotified')` = "Support has been notified" — show only when a human was actually paged).
- **`main.ts`:** `vue-render` + `unhandled-error` add `severity: 'critical'`; `unhandled-promise-rejection` left non-paging with an explaining comment.
- **`calendarSyncStore.ts`:** `reconcileErrorCounters` Map + `RECONCILE_ERROR_THRESHOLD = 3`; in the non-auth `otherErrors` branch, increment and report with `severity: n === RECONCILE_ERROR_THRESHOLD ? 'critical' : CALENDAR_SYNC_ERRORS[worst.kind]` (drops the status-transition guard so the counter drives escalation; `===` pages exactly once); reset on the clean-success write (single site) + `stop()` wipe. `CALENDAR_SYNC_ERRORS` doc updated (it's a telemetry log-level table, not a page-gate).

## Files Affected

`src/utils/errorReporter.ts`, `src/composables/useToast.ts`, `src/composables/useJoinFlow.ts`, `src/main.ts`, `src/stores/calendarSyncStore.ts`, `src/router/index.ts`, `src/App.vue`, `src/components/login/{CreatePodView,ResumePodSetup,SetupProgressModal}.vue`, `src/composables/useStoreActions.ts`, `src/stores/syncStore.ts`. Tests: `errorReporter.test.ts` (rewired to `reportCritical` + new gate spec), `useToast.test.ts`, `useJoinFlow.test.ts`, `calendarSyncStore.test.ts` (new sustained-threshold spec). Plus `CHANGELOG.md` and the known-noise memory.

## Important Notes & Caveats

- **Primary risk → backstopped structurally:** `rg "severity: 'critical'"` enumerates every paging site; a new reporter guard test pins the default-quiet contract; telemetry still captures everything (subject to its own 50/60s rate cap — not a paging backstop).
- Calendar counter: one reset on clean-success + one `stop()` wipe (deliberately not paired into connect/reconnect/disconnect — fewer reset sites, no lockstep-drift).
- No user-visible feature change → no Help Center coverage. (Toast copy tweak is internal truthfulness.)

## Acceptance Criteria

- [x] Only `critical` pages Slack; `error`/`warning`/unspecified don't; telemetry records all three (guard test).
- [x] Error toasts don't page unless `{ critical: true }`; "Support has been notified" shows only when paged.
- [x] `vue-render` + `unhandled-error` page; `unhandled-promise-rejection` doesn't.
- [x] `useJoinFlow` critical codes page (severity forwarded).
- [x] Calendar: 1st/2nd reconcile error doesn't page; 3rd pages once; later doesn't keep paging; reset on success.
- [ ] `npm run validate` green.

## Testing Plan

Unit (all added/updated): reporter gate (critical pages / error+warning+unspecified don't / telemetry mirrors all); useToast (plain error → telemetry only + not reported; critical → paged + reported); useJoinFlow (critical code → severity forwarded); calendarSyncStore (sustained 3-strike escalation, pages exactly once). Then `npm run validate`.

## Review Passes

- **Pass 1 (Initial draft):** Gate model, promote-not-demote, toast opt-in, global rules, calendar threshold, tests.
- **Pass 2 (DRY / error-handling):** Found the pre-existing `useJoinFlow` critical taxonomy (converge, don't duplicate) + its dead `recordError` wiring; corrected the calendar counter to escalate independently of the status-transition guard; flagged the telemetry rate cap; made the toast `reported` claim truthful.
- **Pass 3 (Sustainability):** Replaced the one-time human audit with a greppable contract + guard test; collapsed the calendar counter lifecycle to one reset + one wipe; dropped the `buildSlackMessage` signature churn; corrected the join count (11/1).
- **Pass 4 (Fresh-eyes):** Re-verified every line ref; pinned the toast copy (`t('error.supportNotified')`, no diagnostics fallback → strict critical-only `reported`); confirmed the clean-success reset is drift-safe across the no-op early-return; confirmed the passkey-shim warning stays non-paging.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial prompt (`/error-review` + broad review ask)

> Note that I received this error while setting up the calendar, but I didn't see any error toast or observable issue or bug with the calendar process so far. From what I can tell (based on observation) this is a transient error with no user impact. This goes against the philosophy and instruction that only extremely intrusive, inconvenient, or user-impact/fatal errors should trigger an slack message. Slack message errors should be errors which have broken the user experience… it should be a fatal issue with the app itself, i.e. some function did not work and the user will be impacted (failed to save an activity, google drive pod file could not be created, etc). Can you review this and all other errors wired up for the slack message to confirm that they meet this criteria? As we have logging now, for run of the mill errors that do not impact a user or a user activity, we will still capture them in logs, but they do not need to trigger messages to slack. [+ pasted Slack alert: calendar-sync, "[calendarSync] reconcile error (forbidden): Google Calendar HTTP 403", build 2024ccf6, save_failure_level none]

### Follow-up — gating model decision (AskUserQuestion)

> Gate model = "Critical-only, quiet by default". Calendar rule = "Page only if sustained".

### Follow-up — proceed

> go ahead to implement

</details>
