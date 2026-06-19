# Plan: iPhone Onboarding — Observability-First Instrumentation Batch

> Date: 2026-06-20
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-06-20-iphone-onboarding-observability.md`

> **No GitHub issue created.** This plan was approved for direct implementation. Full prompt history is embedded under `## Prompt Log`.

## User Story

As a developer diagnosing the iPhone onboarding failure, I want the app to (a) stop crashing on the OAuth bounce route, (b) report device storage availability in diagnostics, and (c) page Slack when storage-related onboarding blockers occur — so that the next 1-minute iPhone device test produces a **conclusive, server-visible** answer about _why_ Web Storage is failing (throwing vs. wiped vs. quota), without committing to an auth redesign first.

## Context

A friend (and greg) cannot complete onboarding on iPhone (iOS 18.7, Safari "Version/26.5", **non-private** window). The prior hypothesis — iOS "Prevent Cross-Site Tracking" (ITP) wiping `sessionStorage` across the OAuth redirect — was **disproven this session**: the failure reproduces with ITP turned **off**.

Two read-only investigations this session established the corrected diagnosis: **two compounding faults**, not ITP.

**Fault 1 — the crash.** `App.vue`'s root `onMounted` runs its full heavy init (settings → auth → a chain of `await import(...)`) on **every** route, including `/oauth/callback`. But `OAuthCallback` is a pure _bounce_ route — `OAuthCallbackPage.vue:18` reads the auth code and immediately `window.location.href`-redirects away. While the page unloads, App.vue's `await import('@/services/auth/googleAccountAssertion')` (`App.vue:740`) resolves to **null**, so the destructure throws `Cannot destructure property 'registerGoogleAccountAssertion' from null or undefined value`. `OAuthCallback` is absent from the `publicOnlyPages` skip list (`App.vue:667`, blog/help only). This is the documented stale-SW-null-module signature (`hardReload.ts:89-109`), but it is being **triggered on a route that has no business running heavy init at all**.

**Fault 2 — Web Storage is failing on this device (the deeper issue).** This single condition explains the three remaining symptoms AND the Slack silence:

- **Recovery screen + re-asked password.** The in-progress create-wizard state (owner name + password) is saved to `sessionStorage` (`resumePaths.ts:114-115`). If storage fails, `savePendingCreate` silently no-ops → on return the resume fast-path (`ResumePodSetup.vue:144`) can't fire → the user falls to the generic identity flow and re-enters the password.
- **"Browser blocked storage" toast.** `beanies_redirect_auth` is lost → `OAuthCallbackPage.vue:62` fires `?authError=storage`.
- **No Slack error — confirmed mechanism.** The chunk-recovery branch reads `sessionStorage.getItem` at `App.vue:1078`. When that _throws_, the inner `catch{}` at `:1103` swallows it and falls through to the overlay **without** calling `hardReload()` and **without** firing the `app.chunkRecoveryFailed` (`critical`) Slack page. The only report that _does_ emit — `oauth.redirectStateLost` — is `warning` severity, below the critical-only Slack gate (`errorReporter.ts:271`).

**The crux.** We have been assuming storage is "wiped" (ITP). The evidence now points to "throwing/blocked," but **device diagnostics do not probe `localStorage`/`sessionStorage` at all** (`diagnostics.ts:20-28` reports only UA/WASM/Crypto/IDB/SW). We cannot distinguish throws vs. wiped vs. quota from the report we got.

This plan is deliberately **observability-first**: small, low-risk changes that make the next device test conclusive. It does **not** attempt the ADR-026 server-side-state redesign.

## Requirements

1. **OAuthCallback skip guard.** When the app boots on the `OAuthCallback` route, `App.vue`'s `onMounted` must **not** run heavy init (settings load, `authStore.initializeAuth()`, the `registerGoogleAccountAssertion` dynamic import, `completeRedirectAuth`, family/data init). App.vue must return early before any of that work, reusing the existing `isPublicPage` early-return + `finally` machinery.
2. **Storage-availability probe in device diagnostics.** `getDeviceInfo()` / `formatDeviceInfo()` (`diagnostics.ts`) must report whether `localStorage` and `sessionStorage` are usable, determined by an **actual `setItem`/`getItem`/`removeItem` round-trip** in a try/catch. The error modal's device-info block must show e.g. `LS: false / SS: false`. This probe is the **single source of truth** for storage availability — it is consumed by both the modal and the reporting path (Requirement 3); no second implementation.
3. **Storage signal on the reporting path.** The same `getDeviceInfo()` probe result must ride along on error reports via a new allowlisted context key (`web_storage`) added in `diagnosticContext.ts`, attached inside `enrichAndRedact` as one more **independently try/caught** enrichment block (matching the existing per-source guard pattern at `diagnosticContext.ts:232-267`). Mirror the key in the telemetry Lambda allowlist **and** the Lambda drift-test's `expected` array.
4. **Resilient chunk-recovery counter.** The chunk-recovery branch in `App.vue` (~`:1060-1107`) must no longer let a _throwing_ `sessionStorage` silently abandon recovery. Back the attempt counter with a module-level in-memory fallback (owned by `hardReload.ts` alongside `CHUNK_RELOAD_FLAG`, so all chunk-reload state lives in one place), exposed via throw-safe `readChunkAttempts()` / `writeChunkAttempts()` / `resetChunkAttempts()` accessors that mirror the established `getStoredFiredAt`/`setStoredFiredAt` shape in `errorReporter.ts:124-143`. Rewrite the recovery branch so a throwing `sessionStorage` still reaches `hardReload()` (attempts < 3) **and** still fires the `critical` `app.chunkRecoveryFailed` page (attempts ≥ 3).
5. **Severity bump for `oauth.redirectStateLost`.** Raise it from `warning` to `critical` (`OAuthCallbackPage.vue:67`).
6. **Persist init breadcrumbs to telemetry (cross-user onboarding forensics).** The init breadcrumb trail (`initBreadcrumbs`) — which today reaches only the on-device error modal and `console` — must ride along on init-failure error reports via a new allowlisted `breadcrumbs` context key, so it lands in the CloudWatch firehose (90-day retention) and is queryable across **all** users/sessions, not just the device in hand. Attach it to the two existing critical init reports (`app.chunkRecoveryFailed`, `app.postInitNoData`) AND add a **new `error`-severity report on the generic init-failure catch path** (the "beans spilled" overlay at `App.vue:~1108`), which currently emits **no** telemetry at all — this is the surface that captures _non-chunk_ onboarding crashes for other users. **The breadcrumbs MUST be email-redacted before they enter the report context** (the firehose is PII-free by contract; the `auth:` breadcrumb at `App.vue:731` embeds `user=<email>`).
7. **No behavior change for healthy devices.**

## Important Notes & Caveats

- This batch does NOT fix onboarding. It is instrumentation + one crash-removal.
- `typeof` is not enough — iOS Safari can have `sessionStorage` present but throw on access. The probe MUST attempt a real write/read/delete and catch. **Accessing `window.localStorage` itself can throw**, so the property access must happen _inside_ the try (pass a thunk/getter, not the resolved object).
- The probe must not throw and must not pollute. Unique throwaway key, remove in `finally`, never surface an error. SSR-safe (`typeof window === 'undefined'` → return false, no throw).
- **DRY:** the probe is written ONCE in `diagnostics.ts` as a private `storageWorks(getArea)` helper and consumed twice (the two `DeviceInfo` booleans, and the `web_storage` context line which reads them back off `getDeviceInfo()`). `diagnosticContext.ts` does NOT re-probe storage directly.
- **DRY:** the throw-safe counter accessors live ONCE in `hardReload.ts` (the module that already owns `CHUNK_RELOAD_FLAG`) and are imported by App.vue. App.vue does not hand-roll a bare module-level `let` + inline try/catch.
- Lambda allowlist mirror is mandatory in **two** places: the `ALLOWED_CONTEXT_KEYS` set in `index.mjs` (`:47-76`) AND the sorted `expected` array in the Lambda drift test (`infrastructure/lambda/telemetry/__tests__/handler.test.mjs`, array starts `:204`, asserted by `deepEqual` at `:234`). Either one missing fails CI. **Insert `web_storage` at the correct sorted position** in the `expected` array (the test compares against `[...ALLOWED_CONTEXT_KEYS].sort()`, so `web_storage` sorts near the end, after `visibility_state`/`vue_info`); the Lambda `Set` itself is order-insensitive.
- No silent failures anywhere in the new code: every new try/catch logs to `console.warn` with a scope tag (`[diagnostics]` / `[hardReload]`) so a dev sees the signal even when the probe degrades. The probe returning `false` IS the informative signal surfaced to the user (modal `SS: false`) and to Slack (`web_storage=ls=…,ss=…`); the breadcrumb trail + console give the developer-facing direction.
- OAuthCallback guard placement: return early after the `route:` breadcrumb (`:664`) and before settings load (`:677`). The `finally` (`:1114-1124`) dismisses `isInitializing` when `chunkReloadInProgress` is false — which holds on this path, so the bounce page's spinner clears correctly. Use route name `'OAuthCallback'` (`src/router/index.ts:253`). **Note: the guard sits earlier than the existing `isPublicPage` return (which is _after_ settings load) because the bounce route should run _zero_ init, not just skip auth/data — settings load is itself unnecessary work on a page that unloads immediately.**
- `localStorage` and `sessionStorage` can fail independently — probe both.
- Keep `DeviceInfo` backward-compatible (also consumed by `useJoinFlow.buildDiagnosticReport`). Add fields, don't rename/remove. The `DeviceInfo` key names `localStorage`/`sessionStorage` shadow the global identifiers only as object keys (harmless); `formatDeviceInfo` reads `info.localStorage`/`info.sessionStorage`, never the bare globals.
- **In-memory counter reset is load-bearing.** `resetChunkAttempts()` must clear BOTH the `sessionStorage` flag AND the module-level memory fallback. The success-path reset site (the post-init health check, `App.vue:~978`) must call `resetChunkAttempts()` — not just remove the storage key — otherwise on a device where storage throws, a same-tab soft recovery would leave a stale in-memory count that the _next_ unrelated chunk error inherits, prematurely exhausting the budget. The implementer must confirm both pre-existing `removeItem(CHUNK_RELOAD_FLAG)` sites (`:978` success path, `:1141` `handleReload`) reference the chunk flag specifically before swapping them.
- **Breadcrumbs are PII-free by construction before they enter the report context.** The firehose Lambda omits `family_email` deliberately (`index.mjs:19-20`), so the firehose must never carry email. The `breadcrumbs` value is built through a single `breadcrumbsForReport(crumbs)` helper that (a) joins with `|`, (b) replaces email-shaped tokens with `<email>`, and (c) keeps the **tail** within `MAX_STRING_LEN` (200) — the tail, not the head, because `redactContext`'s generic truncation keeps the _first_ 200 chars and would drop the failure point, which is always the _last_ breadcrumb. Building it PII-safe up front means the same value is safe on BOTH sinks (Slack already gets `family_email` as its own field, so a redacted breadcrumb loses nothing there).
- **No double-reporting on the init catch.** The chunk-recovery branch and the new generic `app.initFailed` report are **mutually exclusive** (`if (isChunkLoadError) {…chunkRecoveryFailed…} else {…app.initFailed…}`) so an exhausted chunk error is never also reported as a generic init failure. `app.initFailed` is `error` severity (telemetry-only, no Slack page) — init failures vary and we want the queryable record, not a pager storm.
- No new module, no new abstraction layer — see Sustainability Guardrails.

### Sustainability / Maintainability Guardrails

These constraints exist to keep this batch from becoming a future support burden. They are deliberately _restrictive_ — the goal is the smallest durable change, not the most capable one.

- **No new module, no new abstraction layer.** Every change extends an existing file. The two helpers (`storageWorks`, the chunk-counter accessors) live inside files that already own the relevant concern. Do NOT introduce a `webStorage.ts` / `storageProbe.ts` utility.
- **Flat control flow in the rewritten chunk-recovery branch — no added nesting.** Because the accessors are throw-safe, the outer `try/catch` is **deleted entirely**, leaving `if (isChunkLoadError) { const attempts = readChunkAttempts(); if (attempts < MAX) {…return} reportError(critical) }` — 2 levels, no swallow. Removing the try/catch is a _requirement_, not optional cleanup.
- **Counter accessor contract is the proven `errorReporter` shape, copied — not elaborated.** Three small functions matching `getStoredFiredAt/setStoredFiredAt` in structure (SSR guard → try sessionStorage → catch warn → in-memory fallback). No options objects, no configurable key, no factory. Rule of three: a shared persisted-counter helper is justified only when a second need arises — not now.
- **`MAX_ATTEMPTS = 3` stays a local `const` in App.vue.** The accessors own _persistence_; App.vue owns _policy_. Keep that seam clean.
- **`web_storage` value format is a flat string, not a nested object.** Emit `ls=true,ss=true` (one allowlisted scalar key), matching the existing flat-scalar context convention.
- **Probe owns its own cleanup; callers stay ignorant of the throwaway key.**
- **Test the contract, not the implementation.** Assert observable behavior, not internal call counts or the probe-key string.

## Assumptions

> **Review these before implementation.** Valid at planning time (2026-06-20); may have changed.

1. Current `main` tip `86b58a94`; round-2 resume fix `89906171` present; `familyLists` true (unrelated).
2. Failure is on a real non-private Safari with ITP off; treated as throw-on-access, probe will confirm.
3. `errorReporter.reportError` does not itself throw on failing `sessionStorage` (its `getStoredFiredAt`/`setStoredFiredAt` are try/caught, `errorReporter.ts:124-143`), so the `critical` page can send when storage is blocked, provided we reach the `reportError` call. Requirement 4 guarantees we reach it.
4. Telemetry Lambda allowlist test pins a sorted array literal (`expected`, `handler.test.mjs:204`, asserted `:234`); adding `web_storage` requires updating both the Lambda set and that array (at the correct sorted position) or CI fails.
5. No other route besides `OAuthCallback` is a pure bounce that mis-runs heavy init.

## Approach

Five surgical changes. No new abstractions beyond the two single-source helpers; everything else extends existing machinery. No new files of any kind except the one new test file.

- **Change 1 — `App.vue` early return on the bounce route.** After the `route:` breadcrumb (`:664`), before settings load (`:677`): `if (route.name === 'OAuthCallback') { initBreadcrumbs.push('oauth-callback: bounce route, skipping init'); return; }`. The existing `finally` clears the spinner (`chunkReloadInProgress` is false on this path). Reuses the exact `isPublicPage` early-return pattern, placed earlier so the bounce route runs zero init.

- **Change 2 — `diagnostics.ts`: the single storage probe + two `DeviceInfo` fields.** Private `storageWorks(getArea: () => Storage): boolean` — area accessed via the thunk inside the try, real `setItem`/`getItem`/`removeItem` round-trip with a unique key, removes in `finally`, false on any throw, `console.warn('[diagnostics] storage probe failed', e)`, SSR-safe (`typeof window === 'undefined'` → return false before invoking the thunk). Add `localStorage`/`sessionStorage` booleans to `DeviceInfo` (append-only). Populate in `getDeviceInfo()` via `storageWorks(() => window.localStorage)` / `storageWorks(() => window.sessionStorage)`. Add two `formatDeviceInfo` lines (`LS: ${info.localStorage}`, `SS: ${info.sessionStorage}`).

- **Change 3 — `diagnosticContext.ts` + Lambda mirror.** Add `'web_storage'` to `ALLOWED_CONTEXT_KEYS`. In `enrichAndRedact`, one more independent try/caught block: `try { const dev = getDeviceInfo(); raw.web_storage = \`ls=${dev.localStorage},ss=${dev.sessionStorage}\`; } catch (e) { console.warn('[diagnosticContext] web_storage enrich failed', e); }`. Flat scalar, reads the probe (no re-probe). Import `getDeviceInfo`(the module already imports`tail`from`@/utils/diagnostics`). Mirror `'web_storage'`into`index.mjs`set and the drift test's sorted`expected` array (correct sorted position).

- **Change 4 — throw-safe chunk counter (helper in `hardReload.ts`, used in `App.vue`).** Module-level `let chunkAttemptsMemory = 0` + `readChunkAttempts()` / `writeChunkAttempts(n)` / `resetChunkAttempts()` — prefer `sessionStorage`, fall back to memory, never throw, warn on degrade, errorReporter-shaped. `readChunkAttempts` returns `max(parsed sessionStorage value, chunkAttemptsMemory)` so a throw mid-sequence still sees the memory count (the memory value is always kept in sync by `writeChunkAttempts`). `writeChunkAttempts(n)` sets memory `= n` then best-effort writes storage. `resetChunkAttempts()` sets memory `= 0` then best-effort removes the storage key. In App.vue's recovery branch: replace inline `parseInt(...getItem...)`/`setItem` **and delete the swallowing outer try/catch**, flattening to `if (isChunkLoadError(err)) { const attempts = readChunkAttempts(); const MAX_ATTEMPTS = 3; if (attempts < MAX_ATTEMPTS) { writeChunkAttempts(attempts + 1); console.warn(...); chunkReloadInProgress = true; void hardReload(); return; } console.error(...); reportError({ surface:'app.chunkRecoveryFailed', severity:'critical', … }); }`. `MAX_ATTEMPTS` stays local. Replace the two `removeItem(CHUNK_RELOAD_FLAG)` sites (`:978` success path, `:1141` `handleReload`) with `resetChunkAttempts()`; delete the now-dead try/catch around `:1141`.

- **Change 5 — `OAuthCallbackPage.vue`: `severity: 'warning'` → `'critical'`** on `oauth.redirectStateLost` (`:67`). Update the surrounding comment to note a code-in-hand-but-state-lost is a hard onboarding blocker that must page.

- **Change 6 — persist init breadcrumbs to the firehose (`diagnosticContext.ts` helper + allowlist + Lambda mirror + `App.vue` call sites).**
  - **Helper** `breadcrumbsForReport(crumbs: string[]): string` in `diagnosticContext.ts`, co-located with `normalizeMessage` (same family of text sanitizers): `crumbs.join(' | ')` → replace email-shaped tokens with `<email>` using a global form of the repo's own email shape (`src/utils/email.ts` uses `[^\s@]+@[^\s@]+\.[^\s@]+`): `/[^\s|@]+@[^\s|@]+\.[^\s|@]+/g` (the added `@`/`|` exclusions keep a match from spanning two addresses and bound it to one token; the required `\.` matches the repo convention; linear-time, no nested quantifiers) → if longer than `MAX_STRING_LEN`, keep the tail (`'…' + s.slice(-(MAX_STRING_LEN - 1))`, length exactly 200, so `redactContext`'s `> 200` guard stays false and won't re-truncate). Returns `''` for an empty trail. Pure, synchronous, never throws. **eslint:** if `security/detect-unsafe-regex` flags it, add a scoped `/* eslint-disable security/detect-unsafe-regex */` with the same justification-comment style as `normalizeMessage` (`diagnosticContext.ts:137-149`) so `npm run validate` stays green. Redaction runs on the whole joined string, so it also covers any future error-message crumb that embeds an address (belt-and-suspenders).
  - **Allowlist:** add `'breadcrumbs'` to `ALLOWED_CONTEXT_KEYS` (client) AND the Lambda `index.mjs` set AND the drift-test `expected` array. **Sorted positions (ASCII):** `breadcrumbs` sorts to index 1 — immediately after `action`, **before** `browser` and `build_sha` (order: `action`, `breadcrumbs`, `browser`, `build_sha`, …); `web_storage` sorts to the **end**, after `vue_info`.
  - **Attach** `breadcrumbs: breadcrumbsForReport(initBreadcrumbs)` to the `context` of the two existing critical init reports — `app.postInitNoData` (`:1001`) and `app.chunkRecoveryFailed` (`:1094`).
  - **New report on the generic init-failure catch** (`:1108`, currently emits nothing): restructure the catch so the chunk branch and a new `else` are mutually exclusive — `else { reportError({ surface: 'app.initFailed', severity: 'error', error: err, message, context: { route_path: route.fullPath, breadcrumbs: breadcrumbsForReport(initBreadcrumbs) } }); }`. `error` severity → firehose + console, no Slack page. Then the existing overlay assignment (`initError.value = …`) runs for both branches as today.
  - **Note:** the on-device modal (`initErrorDetail`) keeps showing the FULL breadcrumb trail (incl. the real email — it's the user's own device, and useful for a support copy-paste); only the telemetry-bound `breadcrumbs` context value is redacted. The redaction lives at the `breadcrumbsForReport` boundary, so the two consumers diverge cleanly with no duplicated trail-building.

## Files Affected

- `src/App.vue` (Changes 1, 4, 6 — breadcrumbs on report sites + new `app.initFailed`)
- `src/utils/diagnostics.ts` (Change 2)
- `src/utils/diagnosticContext.ts` (Changes 3, 6 — `web_storage` + `breadcrumbs` allowlist keys, `breadcrumbsForReport` helper)
- `src/utils/hardReload.ts` (Change 4 — counter accessors)
- `infrastructure/lambda/telemetry/index.mjs` (Changes 3, 6 mirror — `web_storage` + `breadcrumbs`)
- `src/pages/OAuthCallbackPage.vue` (Change 5)
- Tests: new `src/utils/__tests__/diagnostics.test.ts`; extend `src/utils/__tests__/diagnosticContext.test.ts` (incl. `breadcrumbsForReport` email-redaction + tail-trim); `hardReload` counter coverage; Lambda drift test `expected` (`infrastructure/lambda/telemetry/__tests__/handler.test.mjs`); App.vue chunk-recovery + `app.initFailed` coverage.

**No new non-test files.** No new utility module, no new config export. Every production change lands in a file that already owns its concern.

## Acceptance Criteria

- [ ] Booting on `/oauth/callback` runs no auth/data/settings init (breadcrumb present; no crash; spinner clears).
- [ ] `getDeviceInfo()` returns `localStorage`/`sessionStorage` booleans from a real round-trip; `formatDeviceInfo()` renders `LS:`/`SS:`.
- [ ] Throwing Web Storage (even on the property access) → probe returns false (no crash, warns) → modal `SS: false`.
- [ ] Every `critical` report carries `web_storage` as a flat `ls=…,ss=…` string; Lambda mirror + drift test pass.
- [ ] Throwing `sessionStorage` still triggers `hardReload()` (<3) and the `critical` `app.chunkRecoveryFailed` page (≥3).
- [ ] The rewritten chunk-recovery branch has no swallowing outer try/catch and is no deeper than 2 levels of nesting.
- [ ] In-memory counter resets on successful boot AND on `handleReload()`; a stale memory count cannot leak into a later unrelated chunk error.
- [ ] `oauth.redirectStateLost` fires at `critical`.
- [ ] Init-failure reports (`app.postInitNoData`, `app.chunkRecoveryFailed`, new `app.initFailed`) carry a `breadcrumbs` context field; the firehose-bound value is **email-redacted** (`<email>`, never a raw address) and tail-trimmed to ≤200 chars; the on-device modal still shows the full trail.
- [ ] A non-chunk init failure emits exactly one `app.initFailed` (`error` severity, telemetry-only); an exhausted chunk error emits exactly one `app.chunkRecoveryFailed` (no double-report).
- [ ] `breadcrumbs` is allowlisted on the client AND mirrored in the Lambda set + drift-test `expected`.
- [ ] Healthy device unchanged; `web_storage=ls=true,ss=true`.
- [ ] No new try/catch is silent — each warns.
- [ ] No new production file or exported config knob; `MAX_ATTEMPTS` stays a local const.
- [ ] `npm run validate` green.

## Testing Plan

1. Unit (new `diagnostics.test.ts`) — probe: happy true; `setItem` throws → false; wrong read value → false; `window.localStorage` _getter_ (property access) throws → false (no leak); SSR (`window` undefined) → false; no leftover key after any path; warn emitted on failure. Observable behavior only — not the internal probe-key string or call counts.
2. Unit (extend `diagnosticContext.test.ts`) — `enrichAndRedact` output includes `web_storage` and it is well-formed; a thrown probe does NOT drop the rest of the context and does NOT throw; `web_storage` survives `redactContext` (allowlisted). **`breadcrumbsForReport`:** an email in the trail becomes `<email>` (no raw address survives); a >200-char trail is tail-trimmed (keeps the LAST crumbs, drops the head); empty trail → `''`; `breadcrumbs` survives `redactContext`.
3. Unit — Lambda allowlist drift: `expected` array includes `web_storage` at the correct sorted position; `deepEqual` passes.
4. Unit — `hardReload` counter `read`/`write`/`reset` round-trip; throwing `sessionStorage` falls back to memory and retains the count; `resetChunkAttempts` clears memory; App.vue branch still reaches `hardReload` (<3) and the `critical` report (≥3) under a throwing storage; memory reset on the success-boot path.
5. Manual — OAuthCallback skip in dev (breadcrumb, no settings/auth init); desktop reconnect still completes.
6. Manual — desktop create+Drive regression: unchanged, no new Slack noise, device info shows `LS: true` / `SS: true`.
7. Device — greg post-deploy: repeat the iPhone create-a-family repro. Expected: the modal's device-info shows `SS: false` (or `true`), AND a single `critical` Slack alert (`app.chunkRecoveryFailed` and/or `oauth.redirectStateLost`) appears in `#beanies-errors` carrying `web_storage=ls=…,ss=…`. Deliverable = a definitive read of throw-vs-wipe-vs-quota, which decides the real fix.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the four-change observability batch (OAuthCallback skip guard, storage probe + diagnostics, context allowlist + Lambda mirror, throw-safe chunk counter, severity bump) from this session's two read-only investigations.
- **Pass 2 (DRY + error handling)**: Single-sourced the storage probe (context path reads `getDeviceInfo()` instead of re-building the string) and the chunk counter (accessors moved into `hardReload.ts` mirroring `errorReporter`'s shape), corrected the non-existent `diagnostics.test.ts` claim, added the Lambda drift-test `expected` array as a second mandatory mirror site, required `window.localStorage` access inside the try and a warn on every new catch (no silent paths).
- **Pass 3 (Sustainability)**: Added a Sustainability Guardrails section + criteria — the chunk-recovery rewrite must _delete_ the swallowing outer try/catch (dropping 4→2 nesting as the actual fix); no new module/abstraction/config-knob (rule-of-three deferral); `MAX_ATTEMPTS` stays a local const (policy/persistence seam); `web_storage` stays a flat scalar string (no nested shape across two repos); tests assert observable contract not internals.
- **Pass 4 (Fresh-eyes sweep)**: Verified all line references against the codebase (corrected drifted numbers and the drift-test path to `__tests__/handler.test.mjs`); pinned the load-bearing in-memory-counter reset — `resetChunkAttempts()` must clear memory and the success-path site at `:978` must use it, with `readChunkAttempts` returning `max(storage, memory)` so a mid-sequence throw retains the count — with matching caveat/criterion/test; noted the guard intentionally precedes `isPublicPage` to skip settings load entirely.
- **Delta round (breadcrumbs, post-approval)**: Added Change 6 (persist init breadcrumbs to the firehose for cross-user forensics) at greg's request. Re-reviewed the delta against the codebase for DRY/error-handling, sustainability, and fresh-eyes in one consolidated pass: caught the PII contract (the `auth:` breadcrumb embeds the user email; the firehose is PII-free) → email-redaction lives in a single `breadcrumbsForReport` boundary helper; the tail-trim (not head) preserves the failure point past `redactContext`'s first-200 truncation; the chunk vs. generic reports are made mutually exclusive to avoid double-reporting; the new `app.initFailed` is `error` severity (telemetry-only) so it captures non-chunk onboarding crashes without paging.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt (bug report, this session)

> I've now turned off "prevent cross site tracking" in safari settings and tried to onboard again. It still brought up the recovery page, asked to create a password a second time, and failed with similar symptoms, except this time i got a specific error message after creating a password for the second time. [Steps to reproduce: turn off 'prevent cross site tracking'; kill + restart Safari; start a new account, create password, consent to Google Drive in step 2; after step 2 again redirected to the recovery screen, asked to create a password again; after creating a password again, received the below error message.] 'oh no, the beans spilled' (full error modal, not a toast) — "Cannot destructure property 'registerGoogleAccountAssertion' from null or undefined value". Technical details breadcrumbs: route: OAuthCallback / settings: global settings loaded / auth: initializing / auth: needsAuth=false, user=cssoff@test.com. Device info: UA Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 …) Version/26.5 Mobile/15E148 Safari/604.1; WASM: true / Crypto: true / IDB: true / SW: true. No errors triggered to #beanies-errors. After tapping "reload" the screen shows the same error modal again, then flashed back to the recovery screen with the error toast: "sign-in couldn't finish" / "your browser blocked storage during sign-in. this usually happens in private browsing".

### Follow-up — approve plan

> yes draft the /beanies-plan for these changes

(Context: the plan was scoped to the observability-first batch recommended after two read-only investigations ruled out ITP and identified the two compounding faults — OAuthCallback skip guard, storage probe, throw-safe chunk counter, and the `oauth.redirectStateLost` severity bump.)

</details>
