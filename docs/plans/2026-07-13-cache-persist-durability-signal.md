# Plan: Harden the cache-persist-failed durability signal (telemetry, visibility, tests) — #50

> Date: 2026-07-13
> Related issues: Notion #50 (Bug, High). Roadmap Item 2. Direct implementation, no GitHub issue.
> Plan file: `docs/plans/2026-07-13-cache-persist-durability-signal.md`

## User Story

As the operator of beanies.family, I want a broken local durability cache to report itself to CloudWatch (and be visible to the user), so that I can detect and diagnose data-durability failures without a repro — and as a user, I want to actually notice when my device can't save locally, not have the warning hidden on a page I rarely open.

## Context

The worker's ephemeral encrypted IndexedDB cache is how the app survives a reload before the next Drive save. When a cache-persist WRITE fails, the failure is surfaced only to (a) a **Settings-page-only** amber banner and (b) the device `console.error` — it is **NOT reported to the CloudWatch firehose**, so we have zero visibility when a user's local durability breaks. The failure→signal→recovery path also has **no real test coverage**. Per the new "Observability & Diagnostic Logging" convention (`CLAUDE.md`, 2026-07-13) this is a pre-existing silent-to-telemetry failure that must now emit diagnostics; this is the second feature built under that convention (sibling: `docs/plans/2026-07-13-instrument-incremental-sync.md`).

**Verified current state (2026-07-13):**

- **Failure origin:** `applyAndProject.ts` `persistOnce()` catch (`:189-196`) — sets the module `cachePersistFailed = true`, calls `sink.cachePersistFailed(true)`, `console.error('[applyAndProject] cache persist failed', e)`. No `logEvent`/`reportError`. **`persistOnce` has THREE awaited IDB writes:** `writeBase(key, doc)` in the first-persist branch (`:169`), `cache.persistIncrement(key, framed)` (`:179`), AND a _second_ `writeBase(key, doc)` for re-compaction **inside** the increment branch (`:185`). On success `markPersistOk()` fires `sink.cachePersistFailed(false)` (`:174` early-return, `:188` end) — itself edge-guarded (`if (cachePersistFailed)`, `:128`).
- **`withIdbRetry` already exhausts retries before the catch:** `cache.persistDocBinary`/`persistIncrement` wrap the IDB write in `withIdbRetry` (`utils/idbTransient.ts`) which does ONE transient retry (console.warn) then **throws**. So `persistOnce`'s catch fires only on a **persistent** failure. No extra "is this transient?" logic.
- **`markPersistOk` fires the recovery signal ONLY on the failed→ok edge** (`if (cachePersistFailed)` at `:128`) — at most once per episode.
- **Signal path:** `protocol.ts:128` `{ signal: 'cache-persist-failed'; failed: boolean }` → `docWorker.ts:34-35` posts it → `docClient.ts` `cachePersistFailedHandler` (slot `:92`, setter `:120-121`, dispatch `:182-183`, optional-chained); inline path mirrors via `inlineBridge.ts:20-36`.
- **Main-thread chokepoint:** `syncService.ts` `setCachePersistFailed(failed)` (`:267-272`) is fed by BOTH paths (`registerDocPersistCallback` `:1150-1159`) and is **edge-triggered** (`if (cachePersistFailed !== failed)`) before fanning out via `cacheFailureCallbacks`. Reactive `syncStore.cachePersistFailed` (`syncStore.ts:373-379`, exported `:2870`). **One other, non-signal caller: `reset()` (`:483`)** calls `setCachePersistFailed(false)` on logout / family-switch / re-init — see the false-recovery caveat.
- **UI:** the ONLY surface is `SettingsPage.vue:1460-1468` (`v-if="syncStore.cachePersistFailed"`, amber panel, i18n `settings.cachePersistWarning`) — **inside the `showFamilyData` modal** (deep-link `open:'family-data'`, `cardOpenMap` `:124-127`), which is why the banner CTA routes there: the destination already renders the fuller explanation. No global surface today.
- **Ambient diagnostics are auto-attached (NO plan work):** `enrichAndRedact` (`diagnosticContext.ts:314-377`) unconditionally attaches `family_id` (`:331`), `provider_type` (`:350`), `web_storage` (`:371`), `browser`/`online`/`connection_type` (`:358-362`), `build_sha` (`:319`) to EVERY firehose record — both `reportError`(warning) and `logEvent` inherit them. The plan only adds the two _failure-specific_ keys (`cache_persist_kind`, `cache_persist_error`). Verified.
- **Shared banner chrome verified:** `src/components/common/ErrorBanner.vue` is the existing shared banner primitive — docstring: _"Shared chrome for `SaveFailureBanner` and any future persistent error UI."_ It renders **inline in document flow (NOT `position: fixed`)** so it _pushes_ `AppHeader` down rather than overlapping it, with `<Transition>` (slide-down), dark-mode, `role="alert"`/`aria-live` slotted title/message/actions already handled. `SaveFailureBanner.vue` (`src/components/google/`) is the reference consumer: a thin wrapper supplying slots + `router.push({ path:'/settings', query:{ open:'family-data' } })` (`goToSettings` `:61-65`), mounted inline in `App.vue:1777` above `<AppHeader>`. Its tones are `critical` (red) + `warning` (amber-600) — neither Heritage Orange; both currently hard-code `role="alert"`.
- **Fixed-overlay banners:** `OfflineBanner.vue` + `BackgroundSyncBar.vue` are `position: fixed top-0 z-[200]` (`App.vue:1498/:1515`); the body is not padded for them, so they OVERLAP the header — tolerable only because both are transient. A persistent banner there would permanently cover the top of `AppHeader`.
- **Tests:** `saveFailureTracking.test.ts:252-278` tests only subscription plumbing; `applyAndProject.test.ts` wires a `failed: boolean[]` sink array (`:62,75,79`) but **never asserts on it**.
- **Reuse verified:** `reportError({ severity: 'warning' })` already mirrors to `logEvent` at `warn` with the full redacted context and **no Slack page** (`errorReporter.ts:250-275`) — so a single `reportError` on the failure edge is the firehose emit; no separate `logEvent` for failure.

## Requirements

1. A **persistent** cache-persist failure reports to the CloudWatch firehose with enough context to triage blind: which write (`base` vs `increment`) and the IDB error name, correlated by `family_id` + ambient diagnostics (`web_storage`, `provider_type`, `browser` already auto-attached — see Context).
2. The **recovery** transition (failed→ok) also emits, so failure rate + duration are measurable. A lifecycle **`reset()` is NOT a recovery** and must not emit a recovery event.
3. Telemetry must be **edge-triggered** (one event per failure episode + one per genuine recovery), covering BOTH worker and inline paths with ONE emit site (DRY).
4. Severity: **`warning`** (firehose only, no Slack page) — justified below.
5. **Visibility — DECIDED (B) by greg 2026-07-13:** add a minimal global durability banner bound to the existing `syncStore.cachePersistFailed`, **built by reusing the existing `ErrorBanner` shared chrome (the `SaveFailureBanner` pattern), not by forking `OfflineBanner`** — see Approach §5.
6. **Real test coverage:** force `cache.persistIncrement`/`persistDocBinary` to reject → assert the signal fires (with `base`/`increment` + error name), the store flag flips, telemetry emits, and it CLEARS on recovery. Cover BOTH worker + inline. Replace the unasserted `failed[]` capture with real assertions.
7. **No behavioral change** to the persist/compaction logic.

## Important Notes & Caveats

- **Emit at the main-thread `setCachePersistFailed` chokepoint — the single DRY, edge-triggered site.** Receives both worker + inline signals, dedups on transition, runs on main. ONE site, fires once per episode/recovery. Do NOT emit in the worker's `persistOnce` catch (runs every failed tick; can't reach telemetry).
- **The telemetry emit is an extracted named function `emitCachePersistTelemetry(failed, detail?)`**, called from inside the `!==` guard after the callback fan-out — keeps `setCachePersistFailed` single-responsibility, the policy greppable/testable.
- **`reset()` must clear the banner WITHOUT emitting a recovery event.** `reset()` (`:483`) clears the flag on teardown; going through `emitCachePersistTelemetry(false)` while the flag was still true would firehose a **false `cache-persist recovered`** event, corrupting the rate/duration metric. Fix: `setCachePersistFailed(failed, detail?, opts?: { silent?: boolean })` — emit only when `!opts?.silent`; `reset()` passes `{ silent: true }`. The boolean fan-out still runs (banner/store clear); only telemetry is suppressed. (Grep-verified callers: definition, `reset()`, two handler-wiring lines. Passing `setCachePersistFailed` directly as the 2-arg handler still type-checks.)
- **The failure emit is a single `reportError` — NOT a separate `logEvent`.** `reportError({severity:'warning'})` already mirrors into `logEvent` at `warn` with no Slack (`errorReporter.ts:250-267`). Only the recovery uses `logEvent` directly.
- **Keep the worker's `console.error` (`applyAndProject.ts:195`)** — the worker's only local channel; removing it would be a silent worker-side gap.
- **`CachePersistFailureDetail` = ONE named type in `protocol.ts`:** `{ kind: 'base' | 'increment'; errorName: string }`. Signal → `{ signal:'cache-persist-failed'; failed:boolean; detail?:CachePersistFailureDetail }`. Thread the NAMED type (import, never re-declare) through docWorker/docClient/inlineBridge/`WorkerSink`+`NOOP_SINK`/`setCachePersistFailed`. Carry only `e.name` across postMessage (PII-free). One shape, optional field, old emitters still type-check.
  - **`kind` MUST be explicit, not inferred.** Set `let writeKind: 'base'|'increment'` before each of the THREE writes (`:169` base, `:179` increment, `:185` re-compaction base). Do NOT infer from `lastPersistedHeads === null` — that mislabels the re-compaction base write (`:185`, `lastPersistedHeads` non-null) as `increment`.
- **`detail` is always present on a real failure** (worker/inline always send `{kind, errorName}`; the only `failed:true` caller is the signal path). If it were ever absent, `JSON.stringify` drops `undefined` context values — record stays clean (harmless, verified vs `redactContext`).
- **Handler-null on teardown is test-only + already null-safe** (`docClient.ts:718`, `inlineBridge.ts:65`; production never nulls it; dispatch optional-chained).
- **Best-effort recovery metric across a worker re-spawn (pre-existing, out of scope):** a respawn mid-episode starts `cachePersistFailed=false`, so `markPersistOk`'s guard suppresses the recovery signal and the banner can stay stuck until the next real edge or `reset()`. A NEW failure with a different `detail` arriving while main's flag is still stuck-true is also dropped by the `!==` dedup (first detail wins). Pre-existing (task #1 territory); here it just means failure-duration/detail are best-effort. Noted for honesty.
- **Re-compaction-base failure self-"recovers" on the next quiet tick (behavioral artifact, NOT a data-safety bug).** If `persistIncrement` succeeds + advances `lastPersistedHeads` (`:183`) but the _re-compaction_ `writeBase` (`:185`) then fails, the catch reports `kind:'base'`; the next quiet tick (`changes.length === 0`) → `markPersistOk` → a recovery event even though compaction never happened. This is durability-CORRECT (the increment IS durably cached; only the size-bounding compaction was skipped — the out-of-scope #46 concern), behavior unchanged. Just a short benign failure→recovery blip in the metric. Documented, not fixed.
- **Severity = `warning`, not `critical`.** Drive is the durable copy; a failed LOCAL persist loses at most the un-Drive-saved delta if the tab dies before the next save — a degradation, self-recovering, already user-surfaced. `critical` (pages Slack) is for "user action failed / data at risk." Revisit only if telemetry shows persistent real-user failures.
- **Visibility — DECIDED (B); Pass 5 changed HOW.** greg chose a global banner. Pass 1 sketched copying `OfflineBanner` (fixed strip + manual `top`-shift). **Pass 5 rejects that:**
  - **DRY:** `ErrorBanner.vue` already IS the shared chrome for "any future persistent error UI" (`SaveFailureBanner` is its reference consumer). Copying `OfflineBanner` = a third hand-rolled banner re-duplicating transition/a11y/dark-mode/layout. → wrap `ErrorBanner`.
  - **Correctness:** offline/sync-bar are `fixed` and overlap the header (only OK because transient). A persistent fixed banner would permanently cover `AppHeader`. `ErrorBanner` is inline-in-flow and **pushes the header down** — mounting beside `SaveFailureBanner` (`App.vue:1777`) **deletes the entire `top`-shift/`z-index`/`--offline-banner-h` stacking scheme**.
  - **CIG colour:** `ErrorBanner`'s tones are red/amber, not Heritage Orange. Add a reusable Heritage-Orange **`notice`** tone (`bg-primary-500`, `role="status"`/`aria-live="polite"` — correct a11y for a self-recovering status, not an urgent `alert`). Additive; existing `critical`/`warning` untouched. Never Alert Red.
- **DurabilityBanner supplies its OWN `#actions` button styling (do NOT copy `SaveFailureBanner`'s red-on-white classes).** SaveFailureBanner's CTA is `text-red-700` on a white pill — tuned for the red `critical` tone; on Heritage Orange it reads wrong. Use a neutral-on-orange treatment (`bg-white/20 text-white hover:bg-white/30`) so no red leaks onto the orange banner.
- **Two stacked inline banners (save-failure + durability) is acceptable.** If Drive-save AND local-cache persist fail at once, both inline banners render + push the header down. Rare (distinct failure domains), correct (each independently actionable), matches the existing single-banner push-down UX. No rollup — not worth the coupling.
- **Gate parity with `SaveFailureBanner` is unnecessary.** SaveFailureBanner gates on `&& !authStore.needsAuth`; DurabilityBanner does not need to (`cachePersistFailed` only turns true persisting an unlocked doc; `reset()` clears it on logout/family-switch). Bind straight to `syncStore.cachePersistFailed`. (A stray pre-auth true would be a signal we'd WANT visible.)
- **`reportError` (failure) vs `logEvent` (recovery), both in `emitCachePersistTelemetry`.** Same `cache-persist` surface (one CloudWatch filter). Both fire-and-forget, never throw (no wrapping try/catch); edge-triggering keeps volume near zero (`logEvent`'s 50/60s cap is a backstop).
- **New context keys → both allowlists + pinned test + privacy runbook** (Item 1 discipline): `cache_persist_kind` (enum), `cache_persist_error` (error name). Add to `ALLOWED_CONTEXT_KEYS` in `diagnosticContext.ts` AND the Lambda `index.mjs`, update the pinned `handler.test.mjs` `expected` (sorted), add "cache-persist" to the runbook Diagnostics parenthetical (category unchanged → no store-console/xcprivacy change). No PII.
- **Considered and DEFERRED — no cache-size/increment-count key.** A numeric "cache bytes / increment count at failure" could split `QuotaExceededError` into "doc too big" vs "device disk full." Marginal (the error NAME already distinguishes quota vs code-bug vs eviction; `web_storage` flags storage-blocked) and it adds an allowlist key + probe plumbing. Left out; revisit only if quota failures show up and the error name proves insufficient.
- **Out of scope:** the persistence/compaction model (#43/#44/#46); cache encryption/schema; `withIdbRetry` retry count; the pre-existing worker-respawn stuck-banner (task #1).

## Assumptions

> Review before implementation.

1. `persistOnce`'s catch (`:189-196`) is the sole failure site; throwing writes are `writeBase` (`:169` + `:185`) and `persistIncrement` (`:179`); `withIdbRetry` is retry-exhausted before the catch (verified).
2. `setCachePersistFailed` (`:267-272`) is edge-triggered + the single convergence point for both paths; its ONLY non-signal caller is `reset()` (`:483`), which needs the `{ silent: true }` clear (grep-verified).
3. The `cache-persist-failed` signal type is defined once (`protocol.ts:128`) + consumed via optional-chained calls; adding an optional `detail` (shared type) is backward-compatible + null-safe.
4. `reportError({severity:'warning'})` → firehose (`logEvent` at `warn`) + console, NO Slack, never throws (verified `errorReporter.ts:69-82,250-275`).
5. `markPersistOk` fires the recovery signal ONLY on the failed→ok edge; with the main `!==` dedup → one recovery event per episode.
6. `ALLOWED_CONTEXT_KEYS` is mirrored in `diagnosticContext.ts` + the Lambda + pinned by `handler.test.mjs` (verified Item 1). `family_id`/`provider_type`/`web_storage`/`browser` are already auto-enriched (verified `diagnosticContext.ts:314-377`) — no new key for them.
7. `CacheFailureCallback` / `onCacheFailureChange` stay `(failed: boolean)`; only `setCachePersistFailed`'s params + the worker/inline chain carry `detail`.
8. `ErrorBanner.vue` renders inline-in-flow (pushes `AppHeader` down); the inline slot is `App.vue:1777` above `<AppHeader>` (verified via `SaveFailureBanner`). Router is globally installed; `router.push('/settings')` works from the shell. `open:'family-data'` deep-links to the modal that already contains the Settings cache-persist warning (verified `SettingsPage.vue:124-127,1460`).
9. Adding a Heritage-Orange `notice` tone to `ErrorBanner` is additive — existing `critical`/`warning` consumers (`SaveFailureBanner`, `TravelPlansPage`) unaffected (new enum member, own colour/`role`/`aria-live` branch).

## Approach

### 1. Extend the signal payload (one named type, backward-compatible)

`protocol.ts`: `export interface CachePersistFailureDetail { kind: 'base' | 'increment'; errorName: string }`; signal `{ signal:'cache-persist-failed'; failed:boolean; detail?:CachePersistFailureDetail }`. Thread `detail` (importing the named type) through docWorker (post), docClient (`cachePersistFailedHandler` + dispatch `sig.detail`), inlineBridge (mirror), `WorkerSink`/`NOOP_SINK` (`applyAndProject.ts:50-59`), and `setCachePersistFailed`. `CacheFailureCallback`/`onCacheFailureChange` UNCHANGED.

### 2. Worker: tag which write failed (`applyAndProject.ts`)

`let writeKind: 'base'|'increment' = 'base'` set before each of the three writes; in the catch `errorName = e instanceof Error ? e.name : 'UnknownError'`; `sink.cachePersistFailed(true, { kind: writeKind, errorName })`; keep `console.error`. `markPersistOk` unchanged. No control-flow change.

### 3. Main thread: emit at the chokepoint via a named helper + silent reset (`syncService.ts`)

```ts
function setCachePersistFailed(
  failed: boolean,
  detail?: CachePersistFailureDetail,
  opts?: { silent?: boolean }
): void {
  if (cachePersistFailed !== failed) {
    cachePersistFailed = failed;
    cacheFailureCallbacks.forEach((cb) => cb(failed)); // subscribers see boolean only
    if (!opts?.silent) emitCachePersistTelemetry(failed, detail);
  }
}

function emitCachePersistTelemetry(failed: boolean, detail?: CachePersistFailureDetail): void {
  if (failed) {
    reportError({
      surface: 'cache-persist',
      message: 'Local durability cache write failed (persistent)',
      severity: 'warning', // mirrors to firehose at warn, no Slack — do NOT add a second logEvent
      context: { cache_persist_kind: detail?.kind, cache_persist_error: detail?.errorName },
    });
  } else {
    logEvent({ level: 'info', surface: 'cache-persist', message: 'cache-persist recovered' });
  }
}
```

`reset()` (`:483`) → `setCachePersistFailed(false, undefined, { silent: true })`. Fire-and-forget, non-throwing, edge-triggered ⇒ one failure + one genuine recovery per episode, both paths, no flood, no false reset-recovery. (`family_id`/`web_storage`/`provider_type`/`browser` ride along automatically via `enrichAndRedact` — no extra context wiring.)

### 4. Allowlist + privacy gate

Add `cache_persist_kind`, `cache_persist_error` to both `ALLOWED_CONTEXT_KEYS` copies + the pinned `handler.test.mjs` `expected` (sorted); add "cache-persist" to the runbook Diagnostics parenthetical.

### 5. Visibility — option (B): global durability banner via the shared `ErrorBanner` chrome

- **Extend `ErrorBanner.vue` with a Heritage-Orange `notice` tone** — add `'notice'` to the `severity` union; class branch `notice` → `bg-primary-500 dark:bg-primary-600`; a11y branch `notice` → `role="status"` + `aria-live="polite"` (the `role`/`aria-live` bindings become a per-severity branch, not the current always-`alert`); readable light message tint on orange. Additive; `critical`/`warning` untouched (still `role="alert"`).
- **New `src/components/common/DurabilityBanner.vue`** — a thin wrapper over `ErrorBanner` mirroring `SaveFailureBanner.vue` (NOT `OfflineBanner`): `useSyncStore()`, `<ErrorBanner :show="syncStore.cachePersistFailed" severity="notice">`, `#title` + `#message` from `t()`, and a single **"what's this?"** `#actions` button calling `router.push({ path:'/settings', query:{ open:'family-data' } })` (the `goToSettings` pattern — lands on the modal that already renders the cache-persist explanation). The CTA button uses a neutral-on-orange treatment (`bg-white/20 text-white hover:bg-white/30`) — NOT SaveFailureBanner's red-on-white. All strings via `t()` (en + beanie); `ErrorBanner` uses only `text-sm`/`text-xs` (rem-based).
- **Mount in `App.vue` inline beside `<SaveFailureBanner>` (`:1777`), above `<AppHeader>`** — NOT the fixed-overlay region (`:1498`). Inline-in-flow pushes the header down; stacks naturally; **no `top`/`z-index` math**. Bind straight to `syncStore.cachePersistFailed` (no `!authStore.needsAuth` gate needed). (Offline + durability both-true: OfflineBanner keeps its fixed strip, durability sits below it — no shared region. Save-failure + durability both-true: two inline banners stack — accepted.)
- **i18n:** `sync.durabilityBanner` (short sentence — en Sentence case / beanie lowercase) + `sync.durabilityBannerCta` (button — en Title Case / beanie lowercase) in `uiStrings.ts`; `npm run translate` for zh (spot-check per the translate memory).
- **No mockup** — reuses reviewed shared chrome with the CIG `notice` tone.

## Files Affected

- `src/services/automerge/worker/protocol.ts` — add `CachePersistFailureDetail`; extend the signal with `detail?`.
- `src/services/automerge/worker/docWorker.ts` — post the `detail` (`:34-35`).
- `src/services/automerge/worker/docClient.ts` — handler signature (`:92,120`, shared type) + dispatch pass `sig.detail` (`:183`).
- `src/services/automerge/worker/inlineBridge.ts` — mirror (`:20-36`).
- `src/services/automerge/worker/applyAndProject.ts` — `WorkerSink`/`NOOP_SINK` detail; explicit `writeKind` before each of the three writes; catch tags `kind`+`errorName`; keep `console.error`.
- `src/services/sync/syncService.ts` — `setCachePersistFailed(failed, detail?, opts?)` + `emitCachePersistTelemetry`; `reset()` passes `{ silent: true }`; `CacheFailureCallback`/`onCacheFailureChange` UNCHANGED.
- `src/utils/diagnosticContext.ts` + `infrastructure/lambda/telemetry/index.mjs` + `infrastructure/lambda/telemetry/__tests__/handler.test.mjs` — the two `cache_persist_*` keys (both allowlists + pinned test).
- `docs/runbooks/native-store-submission.md` — Diagnostics-row parenthetical.
- **`src/components/common/ErrorBanner.vue`** (option B) — additive Heritage-Orange `notice` tone (`bg-primary-500`, `role="status"`, `aria-live="polite"`); `role`/`aria-live` become per-severity branches.
- **`src/components/common/DurabilityBanner.vue`** (new, option B) — `ErrorBanner` wrapper (the `SaveFailureBanner` pattern); bound to `syncStore.cachePersistFailed`; `severity="notice"`; own neutral-on-orange `#actions` button → `router.push('/settings', {query:{open:'family-data'}})`; i18n.
- **`src/App.vue`** — mount `<DurabilityBanner />` inline beside `<SaveFailureBanner />` (`:1777`). No `top`/`z-index`; `:1498` region untouched.
- **`src/services/translation/uiStrings.ts`** — `sync.durabilityBanner` + `sync.durabilityBannerCta` (en + beanie); `npm run translate` for zh.
- **Tests** — `applyAndProject.test.ts` (assert `failed[]`/detail on forced reject + recovery, incl. re-compaction-base); `syncService`/`docClient` (worker signal → `reportError`(warning); recovery → `logEvent`; `reset()`-during-failure → NO recovery `logEvent`); inline path; store flag flip/clear; **`DurabilityBanner.vue` mount test (hidden when false; `ErrorBanner severity="notice"` + CTA when true; CTA → `router.push('/settings')`); `ErrorBanner` `notice`-tone unit test (`bg-primary-500` + `role="status"`).**
- `CHANGELOG.md` (internal/operator note) + `docs/STATUS.md`.

## Observability Coverage

- **Events (surface `cache-persist`):**
  - Failure (edge false→true): `reportError({ severity:'warning', context:{ cache_persist_kind, cache_persist_error } })` — firehoses at `warn`, no Slack. Answers "breaking, which write, which IDB error, which family (`family_id`) on which storage (`web_storage`) in which browser?" blind — the last three ride along automatically via `enrichAndRedact`. Single record.
  - Recovery (edge true→false, signal-driven only): `logEvent({ level:'info', message:'cache-persist recovered' })` — rate/duration. A `reset()` clears silently (no false recovery). A worker re-spawn mid-episode can miss it, and a re-compaction-base failure self-recovers next quiet tick (both pre-existing/best-effort; documented).
- **Failure modes covered:** quota vs code-bug vs transient-eviction (via `cache_persist_error`); base vs increment incl. re-compaction-base (via explicit `cache_persist_kind`); worker vs inline (same chokepoint). No bare `catch {}` — worker still `console.error`s locally AND signals; emit calls non-throwing.
- **Success-path signal:** the recovery event is the clear signal; reset-clear excluded so it can't masquerade as recovery.
- **Critical vs telemetry:** `warning` only (justified). Never pages.
- **Privacy/store gate:** `cache_persist_kind` (enum) + `cache_persist_error` (error-class name) — no PII. Both allowlists + pinned Lambda test; declared under the existing Diagnostics category (runbook parenthetical).

## Acceptance Criteria

- [ ] A persistent `persistIncrement`/`writeBase` failure emits `reportError({ surface:'cache-persist', severity:'warning', context:{ cache_persist_kind, cache_persist_error } })` — once per episode, single firehose record, both worker + inline — verified by test.
- [ ] A re-compaction base-write failure (`:185`, `lastPersistedHeads` non-null) reports `cache_persist_kind:'base'` — verified (inference-bug guard).
- [ ] Recovery emits `logEvent({ surface:'cache-persist', level:'info' })` once — verified.
- [ ] `reset()` while `cachePersistFailed` is true clears the banner/flag but emits NO recovery `logEvent` — verified (false-recovery guard).
- [ ] `applyAndProject.test.ts` now ASSERTS the `failed[]`/detail on a forced reject + recovery.
- [ ] `syncStore.cachePersistFailed` still flips true/false correctly — verified.
- [ ] `CacheFailureCallback`/`onCacheFailureChange` remain boolean-only — verified by type-check.
- [ ] `CachePersistFailureDetail` declared once in `protocol.ts` and imported everywhere — verified by grep.
- [ ] `cache_persist_kind`+`cache_persist_error` in BOTH `ALLOWED_CONTEXT_KEYS` copies + the pinned `handler.test.mjs`; runbook parenthetical updated. (`family_id`/`web_storage`/`provider_type` confirmed already auto-attached — no new key.)
- [ ] Diagnostic logging (Observability Coverage) implemented + verified.
- [ ] **Visibility (B) via `ErrorBanner` (NOT an `OfflineBanner` copy):** `DurabilityBanner.vue` binds `syncStore.cachePersistFailed`, uses the Heritage-Orange `notice` tone (`bg-primary-500`, `role="status"`, `aria-live="polite"`), pushes the header down (inline, no offset), its own neutral-on-orange CTA routes to `/settings?open=family-data` — verified by test.
- [ ] `ErrorBanner`'s new `notice` tone leaves `critical`/`warning` consumers unchanged (still red/amber + `role="alert"`) — their tests stay green.
- [ ] `npm run type-check && npm run lint && npm test -- --run` + the Lambda test all pass; no persist behavior change.

## Testing Plan

1. **Worker failure→telemetry.** Force `persistIncrement` reject → sink `cachePersistFailed(true,{kind:'increment',errorName})` + `reportError` once; success → recovery `logEvent` once; second failure → second `reportError` (edge re-arm).
2. **Base write (both sites).** First-persist `writeBase` fail → `kind:'base'`; re-compaction `writeBase` fail (`:185`, `lastPersistedHeads` non-null) → still `kind:'base'` (beats inference).
3. **Inline path.** Via `inlineBridge` → same `setCachePersistFailed` emit fires.
4. **Edge/no-flood + single record.** Two failed persists in one episode → exactly ONE `reportError`; no stray failure-branch `logEvent`.
5. **Silent reset (false-recovery guard).** Flag true → `reset()` → store clears AND NO recovery `logEvent`; a later genuine edge still emits.
6. **Helper isolation.** `emitCachePersistTelemetry(true, detail)` → `reportError` (asserts `cache_persist_kind`/`cache_persist_error`); `(false)` → `logEvent`.
7. **Store flag + subscriber contract.** Flag flips true/false; `onCacheFailureChange` subscribers still receive only the boolean.
8. **Allowlist mirror.** Pinned Lambda test passes with the two keys; a payload carrying them survives redaction.
9. **Visibility (B).** (a) `DurabilityBanner`: hidden when false; when true renders `ErrorBanner severity="notice"` + CTA; CTA click → `router.push('/settings')` (mock router). (b) `ErrorBanner`: `notice` → `bg-primary-500` + `role="status"`/`aria-live="polite"`; `critical`/`warning` still red/amber + `role="alert"` (no regression).
10. **Regression.** Full suite + `saveFailureTracking.test.ts` + `SaveFailureBanner`/`ErrorBanner` tests green.
11. **Manual (post-deploy).** Simulate an IDB write failure/quota → confirm a `surface=cache-persist` `warning` event with the two keys PLUS auto-attached `family_id`/`web_storage`/`provider_type` + a recovery `info` event; confirm the global durability banner appears (header pushed down, Heritage Orange, `role="status"`) with a working "what's this?" → Settings family-data modal, AND the Settings banner still shows.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the emit-at-the-edge design (chokepoint → one DRY edge-triggered site), the backward-compatible signal-payload extension, `warning` severity, allowlist-mirror + privacy gate, a flagged visibility decision, and real failure/recovery tests.
- **Pass 2 (DRY + error handling)**: Dropped the buggy `lastPersistedHeads===null` kind-inference (mislabels re-compaction base at `:185`) for an explicit `writeKind`; removed the redundant failure-path `logEvent` (`reportError(warning)` already firehoses — one record); confirmed non-throwing emits + kept the worker `console.error`; added the re-compaction-base + single-record tests.
- **Pass 3 (Sustainability)**: Collapsed `detail` into one shared `CachePersistFailureDetail` type (imported across 5 sites); kept the generic subscriber contract boolean-only (consume `detail` at the chokepoint); extracted the `emitCachePersistTelemetry` helper.
- **Pass 4 (Fresh-eyes sweep)**: Caught that `reset()` would firehose a **false `cache-persist recovered`** on teardown — added the `{ silent }` opt + test/criterion; verified handler-null is test-only + null-safe; tightened Assumption 5 (recovery fires only on the edge); added the honest worker-respawn best-effort caveat.
- **Pass 5 (Option-B delta review)**: Reversed the "copy `OfflineBanner`" sketch — reuse the shared `ErrorBanner` chrome (the `SaveFailureBanner` pattern) mounted **inline** (`App.vue:1777`), which pushes the header down and **deletes the manual `top`/`z-index` stacking scheme**. Added a reusable Heritage-Orange `notice` tone (`bg-primary-500`, `role="status"`/`aria-live="polite"`); switched the CTA to `router.push('/settings',{query})`; confirmed router-from-shell + the tone change is additive. Updated Approach §5, Files, Notes, Acceptance, Testing.
- **Pass 6 (Final fresh-eyes / data-robustness sweep)**: Re-verified every claim against source. Confirmed `family_id`/`web_storage`/`provider_type`/`browser` are **auto-attached** by `enrichAndRedact` — no missing triage field, no extra plan work — and made that explicit. Confirmed the CTA destination (`open:'family-data'`) deep-links to the modal that already holds the Settings warning. Added: the DurabilityBanner CTA must use neutral-on-orange styling (not SaveFailureBanner's red-on-white); two stacked inline banners is accepted; `!authStore.needsAuth` gate parity is unnecessary; documented the re-compaction-base "self-recovers next tick" artifact as durability-correct/out-of-scope; deferred a cache-size/increment-count telemetry key as marginal. No architectural change — the 5-pass design holds.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt (roadmap Item 2 / Notion #50, via /beanies-plan)

> Plan Notion issue #50 — harden the cache-persist-failed durability signal: telemetry, visibility, tests (Bug, High). [full scope captured above.]

### Option-B decision + delta review (greg, 2026-07-13)

> greg chose visibility option (B) — a global durability banner. Folded in + reviewed as Pass 5 (reuse `ErrorBanner` inline chrome, add a Heritage-Orange `notice` tone).

### Final fresh-eyes / data-robustness sweep (greg, 2026-07-13)

> "perform one more fresh eyes review given the changes and importance of this plan to install data robustness and usability." Re-verified all claims; confirmed ambient diagnostics auto-attach + CTA destination; added CTA-styling, stacked-banner, gate-parity, re-compaction-artifact, deferred-cache-size notes. Captured as Pass 6.

</details>
