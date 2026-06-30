# Plan: Universal error reporting to Slack — first-class beanies feature

> Date: 2026-04-27
> Slack channel: `#beanies-errors`
> Webhook: greg-supplied; stored as GitHub repo VARIABLE `BEANIES_ERROR_WEBHOOK_URL`
> Builds on / supersedes: prior 2026-04-26 onboarding-only Slack scope (STATUS.md:155-171)

---

## Context

Beanies users — busy families, mostly non-technical — won't file bug reports. They close the tab and try later. We need automatic, fire-and-forget Slack reports for every caught error, with enough context to diagnose, **without leaking PII other than email** (explicit greg directive for support follow-up).

The 2026-04-26 onboarding-only scope is superseded by this app-wide rollout. Outcome: every user-visible error toast, every uncaught Vue render exception, and every unhandled JS error fires a structured Slack message with surface + family context. Users see a small "support has been notified" line so they know it's being looked at.

---

## Approach

### 2.1 — Single utility: `src/utils/errorReporter.ts` (new)

```ts
export type ErrorSeverity = 'error' | 'warning';

export interface ErrorReportInput {
  surface: string; // 'create-activity' | 'drive-sync-write' | …
  message: string;
  error?: unknown; // Error object — stack extracted
  context?: Record<string, unknown>; // filtered through allowlist before send
  severity?: ErrorSeverity; // defaults to 'error'
}

export function reportError(input: ErrorReportInput): void;
```

**Behavior contract:**

- Fire-and-forget POST to `import.meta.env.PUBLIC_BEANIES_ERROR_WEBHOOK_URL` with `mode: 'no-cors'` — same shape as `web/src/pages/index.astro:779-785`.
- Synchronous return (no awaits exposed to caller). Never throws. Never blocks render.
- **Dedup with count-summary (see § 2.2):** first occurrence sends immediately; subsequent occurrences within 60s increment a counter without sending; when the window closes, a single follow-up message reports `🔁 fired N more times` if N > 0. Greg never loses bug-frequency visibility.
- Re-entry guard: a module-scoped `boolean` set true while a report is being built. Prevents infinite loops if `reportError` itself throws inside `app.config.errorHandler`.
- Context build wrapped in try/catch. Failure to gather context → send a degraded report carrying `{ contextBuildError: '<message>' }` rather than dropping the whole report.

**Failure logging — every path is named, none silent:**

| Failure mode                             | Action                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Webhook URL env unset                    | `console.warn('[errorReporter] webhook not configured — set PUBLIC_BEANIES_ERROR_WEBHOOK_URL')`, return |
| Disallowed context key                   | `console.warn('[errorReporter] dropped non-allowlisted key:', key)`, drop only that key                 |
| Dedup count-only (subsequent occurrence) | `console.warn('[errorReporter] dedup-counted', surface, message, count)`, return                        |
| Context-build throws                     | `console.warn('[errorReporter] context build failed', e)`, send degraded report                         |
| Re-entry detected                        | `console.warn('[errorReporter] re-entry blocked', input.surface)`, return                               |
| `fetch` throws (offline, DNS, etc.)      | `console.warn('[errorReporter] webhook POST failed', e)`, return                                        |

### 2.2 — Dedup design (the spam-prevention contract)

**Bucket key:** `hash(surface + normalizeMessage(message))` where `normalizeMessage` replaces:

- UUIDs → `<uuid>`
- ISO timestamps → `<ts>`
- Runs of 6+ digits (numeric IDs) → `<id>`
- Hex strings of 8+ chars → `<hex>`

This collapses "nearly identical" errors that differ only by per-instance IDs, timestamps, or counters into a single bucket. The Slack message keeps the original (unnormalized) message — normalization is for hashing only.

**State per bucket** in a module-scoped `Map<string, BucketState>`:

```
{ firstSeenAt: number, count: number, surface: string, message: string, summaryTimer: TimeoutHandle }
```

**Lifecycle:**

1. **First occurrence**: create bucket, send Slack message immediately, start a 60s `setTimeout` for the summary.
2. **Subsequent within 60s**: increment counter, log `[errorReporter] dedup-counted` with current count. No fetch.
3. **Summary timer fires** (60s after first occurrence): if `count > 1`, send a follow-up Slack message: `🔁 *<surface>*: "_<message>_" fired <count-1> more times in the last 60s.` Then delete the bucket.
4. **Map size cap**: 200 active buckets max. If we hit the cap, evict the oldest (LRU). Cap is a fail-safe against pathological behavior; in practice we'd see < 50 distinct error classes per session.

**Why count-summary, not silent suppression:** greg keeps full visibility into bug frequency without channel flooding. A bug that fires 100×/min still produces exactly 2 Slack messages per minute (the first + the summary), regardless of intensity. A bug that fires 2×/min over 5 minutes produces 10 messages (5 firsts + 5 summaries with count=1) — slightly chatty but correct: each summary catches drift between similar-but-genuinely-distinct errors.

**Why module-scoped, not Pinia/persisted:** dedup is per-page-session, intentionally. SW reload starts a fresh dedup window — acceptable, since the same bug post-reload should re-notify support (it might be a different cause).

### 2.3 — Three capture layers, all routed through `reportError`

| Layer         | Hook                                                                                                            | Surface                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| A. Toast      | Wrap `showToast('error', ...)` in `useToast.ts` → auto-call `reportError`. Opt-out: 4th arg `{ silent: true }`. | Auto-detected from `useRouter().currentRoute.value.name` |
| B. Vue render | `app.config.errorHandler` in `main.ts`                                                                          | `'vue-render'`                                           |
| C. Global JS  | `window.onerror` + `unhandledrejection` in `main.ts`                                                            | `'unhandled-error'` / `'unhandled-promise-rejection'`    |

The toast wrapper try/catches the `reportError` call so a reporter failure can never break the toast — the user always sees their error.

### 2.4 — Privacy: strict allowlist (NOT blocklist)

A `redactContext()` helper accepts only these field names:

```
family_id, family_name, family_email, route_path, route_name,
from_path, action, error_code, http_status, provider_type,
file_id_tail, invite_token_tail, build_sha, browser, os,
online, connection_type, save_failure_level, drive_file_not_found
```

- Any other key → dropped + `console.warn`. The lint signal forces explicit decisions, not silent leakage.
- Every string value truncated to 200 chars. Truncation logged at `console.warn` once per call.
- `*_tail` fields enforced as last-4-chars via the existing `tail()` pattern (currently in `useJoinFlow.ts:242` — promoted to `utils/diagnostics.ts` as part of this plan).
- Email is the only PII allowed — explicit greg directive. Family name as identification context. **No member names, transaction descriptions, activity titles, goal names, or any user-typed content, ever.**
- Stack traces ship as-is from `Error.stack`. Stack frames contain `function@file:line` only — no local variable values — so no PII leak there. Documented as an assumption.

Family identity read once per report from `useFamilyStore()` via a small accessor; if the store is unavailable (pre-auth flows) the report omits family fields and Slack message reads `Family: (not yet authenticated)`.

### 2.5 — Slack message format (Mrkdwn, single message)

````
🚨 *beanies error* — error
*Family:* The Robinsons (greg@example.com) · `fam_a3b8…`
*Surface:* `create-activity`
*Time:* 2026-04-27 14:42:18 UTC
*Build:* `2c0be49` · prod

*Message:*
```Failed to save activity```

*Stack:*
```TypeError: Cannot read properties of undefined (reading 'id')
  at saveActivity (ActivityModal.vue:184:23) …```

*Context:*
• route: /pod/m_b2f1
• from: /nook
• action: save
• provider: google_drive
• online: true
• save_failure_level: warning
• browser: Chrome 124 / macOS 14
````

### 2.6 — User feedback: "support has been notified"

- Toast renders an italic muted line below `help` ONLY when the report was actually sent (i.e. not silent + webhook configured + not deduped). One translation key: `error.supportNotified` (en + beanie).
- Full-screen error views (onboarding, JoinPodView) get a "Support has been notified automatically" line at the top of the existing diagnostic section.
- `{ silent: true }` toasts never show the line.

### 2.7 — Audit of existing 21 `showToast('error', ...)` call sites

Default = report. Mark with `{ silent: true }`:

- `ShareChannelGrid.vue:83,96` — clipboard copy fail (browser quirk)
- `TransactionsPage.vue:127,137` — stale URL filter
- `useToast.test.ts:86` — test fixture

All others (passkey, goal/account not-found, photo upload fail, store-action wrapper, Quick-add handler fail, addMember fail, avatar upload fail, authoring guardrail) report by default. Audited during implementation; new `{ silent: true }` only where the toast represents a recoverable user/UX condition, not a system bug.

Additional explicit `reportError()` wiring (no toast on these paths today):

- `useStaleTabRefresh.ts` non-critical step `console.warn` paths get explicit `reportError` calls so silent failures notify support.
- `useJoinFlow.tryStep` error path fires `reportError` with `buildDiagnosticReport()` output as the `context`. Existing manual "Send to support" button in `JoinPodView` becomes a redundant fallback that re-fires the same `reportError`.
- Drive provider 401 + silent-refresh-failure already surfaces via the user-facing reconnect banner; that banner's existing toast path now auto-reports via Layer A.

### 2.8 — Webhook configuration: GitHub VARIABLES, not secrets

**Per `tasks/lessons.md` (2026-04-14) and `feedback_gh_vars_vs_secrets.md`:** webhook URLs sit in the client bundle anyway (`PUBLIC_*` is intentional and unavoidable for a fire-and-forget client-side POST), so the `secrets` classification adds no real protection but makes the value write-only and unviewable.

**One-time config (run during implementation):**

1. **New variable**: `gh variable set BEANIES_ERROR_WEBHOOK_URL --body "<url from greg's prompt>"`. `deploy.yml` injects as `PUBLIC_BEANIES_ERROR_WEBHOOK_URL` at build.
2. **Migrate existing**: `CONTACT_WEBHOOK_URL` is currently a secret. Move to a variable in this PR:
   - `gh variable set CONTACT_WEBHOOK_URL --body "<value greg provides>"` (the existing secret value can't be read back; greg supplies it once)
   - Update `.github/workflows/deploy-web.yml:37` from `secrets.CONTACT_WEBHOOK_URL` → `vars.CONTACT_WEBHOOK_URL`
   - Deploy + verify the homepage contact form still works
   - `gh secret delete CONTACT_WEBHOOK_URL`

`.env.example` gets both names with placeholder URLs and a comment.

### 2.9 — Build SHA injection

Add `VITE_BUILD_SHA` to `vite.config.ts`'s `define` block, populated from `process.env.VITE_BUILD_SHA || 'dev'`. `deploy.yml` passes `VITE_BUILD_SHA: ${{ github.sha }}` to the build step. Reporter reads `import.meta.env.VITE_BUILD_SHA`. Critical for distinguishing pre/post-deploy bugs.

### 2.10 — Existing utilities reused (zero new duplicates)

- `getDeviceInfo()` — `src/utils/diagnostics.ts`
- `tail()` — promoted from `useJoinFlow.ts:242` to `utils/diagnostics.ts` (single home, used by reporter + join flow)
- `showToast(type, title, help, options)` — surface unchanged; the new `options` arg is additive
- `useFamilyStore`, `useSyncStore`, `useRouter` — read once per report
- The exact homepage Slack POST shape from `web/src/pages/index.astro:779-785` — re-implemented in `errorReporter.ts` (10 lines)

**Why the homepage POST is re-implemented, not shared:** `src/` (Vue app) and `web/` (Astro site) live in the same repo but use separate path aliases and build configs; cross-importing requires a new shared `lib/` module that neither side currently has. The 10-line POST is below the abstraction-cost threshold for a two-call-site share. If a third surface ever needs it, extract then. Documented intentionally.

### 2.11 — Tests

**`src/utils/__tests__/errorReporter.test.ts` (new):**

- Disallowed key dropped + warn fires (`memberName`, `activityTitle`, `transactionAmount`, etc.)
- Email preserved as the only PII
- String truncation at 200 chars
- `_tail` fields enforce last-4-chars
- **Dedup — first occurrence sends; subsequent within 60s count-only**
- **Dedup — summary message fires at 60s with correct count when count > 1**
- **Dedup — summary does NOT fire if count == 1 (no follow-up needed)**
- **Normalization — `"saved item abc-12345"` and `"saved item def-67890"` collapse to one bucket** (numeric-id stripping)
- **Normalization — UUIDs and ISO timestamps collapse**
- **LRU eviction at 200 buckets** — newest stays, oldest is evicted
- Different surface, same message → 2 fetches (no cross-surface dedup)
- Webhook URL unset → no fetch, warn fires
- `fetch` throws → no exception bubbles, warn fires
- Context-build throws → degraded report sent with `contextBuildError` field, warn fires
- Re-entry guard blocks loop, warn fires
- Slack payload structure matches Mrkdwn format

**`src/composables/__tests__/useToast.test.ts` (extended):**

- `showToast('error', 'msg')` → `reportError` called once
- `showToast('error', 'msg', undefined, { silent: true })` → `reportError` not called
- `reportError` throwing inside the toast wrapper does NOT prevent the toast from rendering

**Manual end-to-end:**

- Trigger `goalView.notFound` → toast renders + support-notified line + Slack message
- Trigger clipboard-copy fail (silent) → toast renders, no support-notified line, no Slack message
- Inject `throw new Error()` in a component lifecycle → `app.config.errorHandler` catches + Slack message, surface `vue-render`
- Inject `Promise.reject(new Error('test'))` in App.vue setup → unhandledrejection fires + Slack message

---

## Files affected

| File                                                                | Change                                                                                                                          |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `src/utils/errorReporter.ts`                                        | **New** — `reportError` + `redactContext` + dedup + re-entry guard + webhook POST                                               |
| `src/utils/__tests__/errorReporter.test.ts`                         | **New**                                                                                                                         |
| `src/utils/diagnostics.ts`                                          | Promote `tail()` here (currently in `useJoinFlow.ts:242`); update its caller to import                                          |
| `src/composables/useToast.ts`                                       | Auto-call `reportError` on `'error'` type unless `{ silent: true }`; try/catch around the call                                  |
| `src/composables/__tests__/useToast.test.ts`                        | Extend with auto-report path tests                                                                                              |
| `src/components/ui/ToastContainer.vue` (or the toast item template) | Render support-notified line when toast was reported                                                                            |
| `src/main.ts`                                                       | Register `app.config.errorHandler` + `window.onerror` + `unhandledrejection`                                                    |
| `vite.config.ts`                                                    | `define` block — `VITE_BUILD_SHA` from `process.env.VITE_BUILD_SHA \|\| 'dev'`                                                  |
| `.env.example`                                                      | Add `PUBLIC_BEANIES_ERROR_WEBHOOK_URL`; update `PUBLIC_CONTACT_WEBHOOK_URL` comment                                             |
| `.github/workflows/deploy.yml`                                      | Pass `VITE_BUILD_SHA: ${{ github.sha }}` and `PUBLIC_BEANIES_ERROR_WEBHOOK_URL: ${{ vars.BEANIES_ERROR_WEBHOOK_URL }}` to build |
| `.github/workflows/deploy-web.yml`                                  | `secrets.CONTACT_WEBHOOK_URL` → `vars.CONTACT_WEBHOOK_URL`                                                                      |
| `src/services/translation/uiStrings.ts`                             | `error.supportNotified` (en + beanie); run `npm run translate`                                                                  |
| `src/composables/useStaleTabRefresh.ts`                             | Add `reportError` calls in non-critical step catches                                                                            |
| `src/composables/useJoinFlow.ts`                                    | Wire `reportError` into `tryStep`; manual "Send to support" stays as redundant fallback                                         |
| ~21 `showToast('error', ...)` sites                                 | Mark validation/UX-only ones `{ silent: true }` per § 2.6                                                                       |
| `docs/plans/2026-04-27-error-reporting-to-slack.md`                 | **New** — saved on approval                                                                                                     |
| `CHANGELOG.md`, `docs/STATUS.md`                                    | Updated on ship                                                                                                                 |

---

## Decisions (override any in approval)

A. **Default-report for `showToast('error')`** with `{ silent: true }` opt-out
B. **60s dedup window**
C. **Audit table** per § 2.6
D. **`VITE_BUILD_SHA`** injected from `deploy.yml` `${{ github.sha }}`
E. **Webhook URLs as GitHub repository variables, not secrets** — new + migration of existing

---

## Maintainability + correctness scenarios

| Scenario                                                     | Outcome                                                                                                          |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Validation error (`{ silent: true }`)                        | Toast shows, no Slack message, no support-notified line                                                          |
| System error toast (default)                                 | Toast + support-notified line; Slack message in 2-3s                                                             |
| Same error fires 50× in 5s                                   | Slack receives 1 message immediately; at 60s, 1 summary "fired 49 more times"                                    |
| Same surface, "nearly identical" messages with different IDs | Collapse to one bucket; first sends; summary covers the rest                                                     |
| 200+ distinct error classes in one minute (pathological)     | LRU eviction; oldest bucket dropped; warn fires; new errors keep flowing                                         |
| Webhook URL unset (dev)                                      | `console.warn`, no exception, app works                                                                          |
| Webhook configured but Slack down                            | `console.warn` from fetch catch, no exception, app works                                                         |
| Vue render exception in deep component                       | `errorHandler` fires + Slack `vue-render`                                                                        |
| Unhandled promise rejection                                  | `unhandledrejection` fires + Slack                                                                               |
| User-typed activity title reaches `context` accidentally     | Dropped by allowlist + warn before send                                                                          |
| Pre-auth error (no family loaded)                            | Slack message reads `Family: (not yet authenticated)`, no crash                                                  |
| `reportError` itself throws inside `errorHandler`            | Re-entry guard blocks loop, single warn                                                                          |
| `useFamilyStore()` throws (Pinia pre-init race)              | Context-build catch fires, degraded report sent                                                                  |
| `Error.stack` is undefined                                   | Slack message omits stack section gracefully                                                                     |
| User sees "support notified" but the call was deduped        | Treat as accurate — first occurrence DID notify; support is aware of this error class. Documented design choice  |
| SW update reload mid-session                                 | Module reloads → fresh dedup map. Acceptable; same error post-reload re-notifies (it might be a different cause) |
| `import.meta.env` undefined (SSR / non-Vite context)         | `typeof import.meta` guard skips reporting, warn fires                                                           |

---

## Verification

1. `npm run test -- errorReporter useToast --run` — green, including PII-redaction + re-entry + dedup cases.
2. `npm run type-check && npm run lint` — clean.
3. `npm run translate` — confirm parser works after `error.supportNotified` add.
4. `npm run test` — full suite, no regressions.
5. **Manual system-error path** — trigger `goalView.notFound`, see toast + support-notified line + Slack message in `#beanies-errors` ≤ 3s.
6. **Manual silent-error path** — trigger clipboard-copy fail, toast appears WITHOUT support-notified line, no Slack message.
7. **Manual Vue error** — temporarily `throw new Error('test')` in a component, confirm `errorHandler` reports.
8. **Manual unhandled rejection** — temporarily `Promise.reject(new Error('test'))`, confirm `unhandledrejection` reports.
9. **Webhook migration safety check** — after `deploy-web.yml` ships with `vars.CONTACT_WEBHOOK_URL`, submit homepage contact form, confirm message arrives BEFORE deleting the secret.
10. **Build SHA** — `npm run build`, grep dist for the SHA replacement.
11. **Dedup** — trigger same error 5× in 10s, confirm exactly 1 Slack message.

---

## Maintainability notes

- **Coupling boundary.** `errorReporter` imports `useFamilyStore`, `useSyncStore`, `useRouter`, `getDeviceInfo`, `tail`. That's the orchestration boundary — this module is the SINGLE place that knows how to compose a beanies error report. Splitting these reads across multiple files would scatter the privacy contract.
- **Module-scoped state** (dedup Map, re-entry guard, summary timers) matches `useOnline` / `useToday` / `useStaleTabRefresh` patterns. Tests use `vi.resetModules()` between cases for clean state, same as those tests.
- **No queue, no persistence, no worker.** Dedup is per-page-session. SW reload starts fresh. If the channel ever floods, tighten the dedup window — don't add infrastructure.
- **Surface names are free strings, not an enum.** Rationale: a const enum forces a central registry update for every new error site, which fights the "first-class default-on" goal. Document a kebab-case naming convention in code comments and grep periodically. Premature enforcement is more painful than occasional drift.
- **The "support has been notified" line is intentionally optimistic.** It says notified even on dedup-suppression; conceptually accurate (first occurrence did notify; support knows about this error class) and avoids exposing dedup mechanics to the user.
- **PII allowlist is a unit-test contract.** Adding a new context field requires explicit allowlist entry or the test fails. This means a future contributor can't accidentally leak a field — the linting comes from the test, not from review.
- **Stack traces ship raw.** Browser stack format will diverge over time; we rely on `Error.stack` as-is. No symbolication infrastructure. If stacks become unreadable in prod (minified bundle), that's a future enhancement, not a v1 blocker.

## Out of scope (deliberate)

- Server-side ingestion / database for trend analysis — Slack is the canonical store for v1
- Token bucket / exponential backoff / offline queue beyond simple in-memory dedup — matches homepage-form pattern; add if Slack rate-limits us
- Source-map symbolication of stack traces — minified frames will be hard to read; resolving requires uploading source maps, out of scope for v1
- Settings page "your error history" view — possible future enhancement
