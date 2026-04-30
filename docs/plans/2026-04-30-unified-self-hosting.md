# Plan: Unified self-hosting story (two paths) + self-host OAuth fix

> Date: 2026-04-30
> Related: an external self-hoster reporting `VITE_REGISTRY_API_URL is not configured` blocking Drive sign-in on his self-host build. Earlier work in `docs/STATUS.md` 2026-04-29 evening (`ba093f9` cloud-vs-self-host UX) and `docs/SELF_HOSTING.md`.

---

## Context

A self-hoster cloned the repo, configured only `VITE_GOOGLE_CLIENT_ID`, and tried to sign in to Drive. The UI's Drive button rendered enabled (gated on `features.drive` only), but the OAuth code path threw `VITE_REGISTRY_API_URL is not configured` mid-flow — `oauthProxy.ts` reuses the registry's env var as its base URL. Adding our cloud Lambda URL as a workaround failed too, because our Lambda holds _our_ `client_secret` and rejects requests carrying their `client_id`.

Research confirmed Google's OAuth Web Application client type **requires `client_secret` even with PKCE** (ktaka 2025-08 testing + Google Cloud Community statement: _"Google's Identity Platform as of today does not support public applications under the 'Web Application' profile"_). Browser-only Drive OAuth on Web Application clients is impossible. The OAuth Lambda is architecturally required for cloud-style sync.

The intended outcome is two clearly-supported self-host paths:

- **Path A — Local file only.** Zero env vars. The user picks a `.beanpod` file inside a folder synced by their own cloud-storage provider (Dropbox, iCloud Drive, OneDrive, Box, Google Drive desktop client). Each family member opens the same shared folder via their provider's desktop client. Automerge CRDT handles concurrent edits. Realistic only on desktop Chromium-family browsers ([caniuse confirms](https://caniuse.com/native-filesystem-api) FSA picker methods are desktop-Chrome/Edge only).
- **Path B — Self-hoster runs their own OAuth Lambda.** Full feature parity with cloud. Self-hoster registers their own Google OAuth Web Application client, deploys the existing OAuth Lambda from `infrastructure/lambda/oauth/` holding their own `client_secret`, optionally deploys the registry Lambda + DynamoDB.

**Critical constraint**: the cloud build at `app.beanies.family` must not change behavior. All 1788+ unit tests + E2E tests must continue to pass. Existing cloud `.env` (which sets `VITE_REGISTRY_API_URL` but not `VITE_OAUTH_PROXY_URL`) must continue to work without any deploy-side change.

---

## Approach

Six phases ordered by ascending blast radius. Phase 1 alone fixes the self-hoster's bug and is shippable in a single sitting. Phases 2-6 land independently after Phase 1 merges.

### Reuse audit (DRY wins — existing primitives, do not duplicate)

| Need                            | Reuse / Extend                                                                                                                                                                                                                                                                          | NEW (only if necessary)                                                                                                                                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Polling every 15s while visible | Generalize `src/composables/useStaleTabRefresh.ts` pattern; consume `useToday().isVisible` (the singleton visibility sink — `useToday.ts:1-100`).                                                                                                                                       | Create `usePollWhileVisible(callback, intervalMs)`; **refactor `useStaleTabRefresh` to consume it** (kills the inline interval pattern, adds value to existing code).                                                      |
| Local-file warning modal        | Existing modal lives inline at `CreatePodView.vue:1013-1053` (uses `BaseModal` + `useFullscreenOverlay`). Extract it; mirror `PwaReinstallModal.vue:1-177` shape.                                                                                                                       | `LocalFileSyncWarning.vue` reused from CreatePodView + LoadPodView.                                                                                                                                                        |
| Error capture / classification  | `src/utils/errorReporter.ts:1-403` — `reportError({ surface, message, error?, context?, severity? })`. Auto-fires toast (unless `silent`), Slack, console — strict allowlist for PII. Use this for every non-trivial async failure.                                                     | None.                                                                                                                                                                                                                      |
| Console prefix                  | Convention `[<module>]` — used across `[syncStore]`, `[authStore]`, `[useStaleTabRefresh]`, `[errorReporter]`, etc. New code must follow.                                                                                                                                               | None.                                                                                                                                                                                                                      |
| Storage-provider capability     | `StorageProvider` interface at `src/services/sync/storageProvider.ts:1-46` is method-shaped, not flag-shaped.                                                                                                                                                                           | Optional method `supportsLocalPolling?(): boolean`. NOT a flag, NOT a new capabilities object. Two implementers: `LocalStorageProvider` returns `true`, `GoogleDriveProvider` returns `false`.                             |
| Conflict-filename detection     | No `filename.ts` exists; only 1-2 callers needed.                                                                                                                                                                                                                                       | Inline `isConflictFilename()` helper in `syncService.ts` (or alongside `localProvider.ts`). Do **not** create `conflictDetection.ts` until 3+ consumers materialise.                                                       |
| i18n keys                       | `selfHost.*` namespace at `uiStrings.ts:1709-1717`; `storage.localFile*` namespace at `:3916-3935` — already has `localFile`, `localFileWarning`, `localFileWarningEncryption`, `localFileContinue`, `driveUnavailableTooltip`, `notConfigured`. New keys must follow these namespaces. | New: `selfHost.driveUnavailableNoProxyTooltip`, `storage.localFileWarningSyncFolder`, `storage.localFileWarningIos`, `storage.localFileConflictDetected`, `storage.localFileBestOnDesktop`. en + beanie variants for each. |
| Decoupling OAuth from registry  | None — distinct concept.                                                                                                                                                                                                                                                                | New env var `VITE_OAUTH_PROXY_URL` with fallback to `VITE_REGISTRY_API_URL` (cloud back-compat).                                                                                                                           |

### Error-handling discipline (no silent failures, anywhere)

Every async operation must be (a) caught, (b) logged with `[<module>]` prefix + Error object, (c) classified (transient / permanent / non-critical), (d) surfaced to the user via toast or modal when relevant, (e) reported via `reportError()` for cross-cutting visibility.

Audit found two silent failures already in `syncStore.ts` that this plan must clean up while we're here:

- **`syncStore.ts:1003`** — `registry.removeFamily(ctx.activeFamilyId).catch(() => {})` (during disconnect)
- **`syncStore.ts:1736`** — `registry.registerFamily(...).catch(() => {})` (after save)

Both are non-critical (registry is optional smoothness), but `.catch(() => {})` violates the no-silent-failure rule. Replace with `console.warn('[syncStore] <op> failed (non-critical)', e)`.

Audit also found `LocalStorageProvider.write()` (`localProvider.ts:30-37`) has **no try/catch**: disk full, permission revoked, stale file handle all propagate as native browser errors. This is the load-bearing path for Path A — must be hardened.

### Decoupling strategy (the single key design decision)

Introduce `VITE_OAUTH_PROXY_URL`. The `oauthProxy.ts` resolver tries it first; if unset, **resolves to `VITE_REGISTRY_API_URL`**. This is **not a deprecated legacy fallback** — it's a permissive resolver pattern: both env vars are first-class. The OAuth-specific var takes precedence when set; the registry var serves as the default when only one Lambda backs both surfaces (cloud's case). Documenting this as "permissive resolver" (not "deprecated fallback") avoids creating a tech-debt narrative we'd be expected to clean up later. The two vars exist for sustained reasons: OAuth and registry are semantically distinct services that _can_ run on the same host but don't _have_ to.

`features.oauthProxy = ok(VITE_OAUTH_PROXY_URL) || ok(VITE_REGISTRY_API_URL)`. Read this gate as "OAuth proxy is reachable somehow", not "OAuth proxy var is set". `canInviteFamily()` becomes `features.drive && features.oauthProxy`. Drive sign-in call sites widen from `features.drive` to `features.drive && features.oauthProxy`. On cloud both are true → no behavior change.

---

## Phase 1 — Decouple OAuth proxy URL from registry URL (self-host OAuth fix)

**Goal:** unblock Path-B self-hosters. Smallest change, lowest risk. Shippable standalone.

### Files to modify

- **`src/services/google/oauthProxy.ts`** (lines 20-26)
  - `getApiBaseUrl()`: read `VITE_OAUTH_PROXY_URL` first, fall back to `VITE_REGISTRY_API_URL`.
  - New error: `"OAuth proxy not configured. Set VITE_OAUTH_PROXY_URL (preferred) or VITE_REGISTRY_API_URL in your .env.local. See docs/SELF_HOSTING.md."`
  - Update file header comment to reflect dual-var support.

- **`src/config/features.ts`** (lines 25-27, 45-47)
  - Add gate: `oauthProxy: ok(env.VITE_OAUTH_PROXY_URL) || ok(env.VITE_REGISTRY_API_URL)`.
  - `canInviteFamily()` → `return features.drive && features.oauthProxy;`.
  - `ESSENTIAL` array stays `['drive', 'registry']` — developer-build badge logic unchanged for cloud.

- **`src/vite-env.d.ts`** (after line 7) — add `readonly VITE_OAUTH_PROXY_URL: string | undefined;`.

- **`.env.example`** — add `## Google Drive OAuth proxy (Path B only)` section above the registry section. Document that on cloud-style deploys with one Lambda for both, only `VITE_REGISTRY_API_URL` is required (legacy fallback honored).

### Test changes

- **`src/services/google/__tests__/oauthProxy.test.ts`** — replace lines 129-140 (the `'throws clear error when VITE_REGISTRY_API_URL is not configured'` test) with three:
  - prefers `VITE_OAUTH_PROXY_URL` when both set
  - **falls back to `VITE_REGISTRY_API_URL` when only registry is set (cloud regression sentinel)**
  - throws the new error message when neither is set
- **`src/config/features.test.ts`** — new describe `features.oauthProxy` with three cases (proxy only / registry only / neither). Update `canInviteFamily` cases to also stub `VITE_REGISTRY_API_URL`.

### Cloud regression risk + mitigations

- **Cloud `.env` only has `VITE_REGISTRY_API_URL`.** Mitigation: explicit "falls back to registry URL" unit test as regression sentinel.
- **`canInviteFamily()` semantics changed** — on cloud both `drive` and `oauthProxy` are true, so `drive && oauthProxy === drive`. Identical behavior; existing tests extended.

### Estimated work

2-3 hours including tests.

---

## Phase 2 — Widen Drive sign-in gate to include `features.oauthProxy`

**Goal:** UI honestly reflects that Drive needs both Drive (client ID) and OAuth proxy. Prevents the "click Drive → cryptic error" path.

### Files to modify

- **`src/components/login/LoadPodView.vue`** (lines 691, 697, 698, 702) — replace inline `features.drive` reads with computed `driveAvailable = computed(() => features.drive && features.oauthProxy)`. Add `driveDisabledTooltipKey` computed that branches: `selfHost.driveUnavailableTooltip` when `!features.drive`, new `selfHost.driveUnavailableNoProxyTooltip` when `features.drive && !features.oauthProxy`.

- **`src/components/login/CreatePodView.vue`** (around line 213) — locate the Drive-card v-if/disabled state, apply same `driveAvailable` computed.

- **`src/services/sync/capabilities.ts`** (line 55) — `googleDrive` becomes `features.drive && features.oauthProxy`. Propagates through every `capabilities.googleDrive` consumer.

- **`src/stores/syncStore.ts`** (line 120) — `isGoogleDriveAvailable` upgrades similarly.

- **`src/services/translation/uiStrings.ts`** — add `selfHost.driveUnavailableNoProxyTooltip` (en + beanie). Run `npm run translate` to regenerate `zh.json`. NO new namespace; this slots into the existing `selfHost.*` namespace at lines 1709-1717.

### Test changes

- **`src/components/login/__tests__/LoadPodView.test.ts`** (extend) — "disables Drive card when oauthProxy gate is off but drive gate is on", "uses no-proxy tooltip when only proxy is missing".
- `BeanCard.vue` (lines 269, 277), `MeetTheBeansPage.vue` (lines 56, 160, 168) all derive from `canInviteFamily()` — Phase 1's update covers them. Verify with the existing test suite, no new tests needed.

### Cloud regression risk + mitigations

- All call sites widen `features.drive` → `features.drive && features.oauthProxy`. On cloud both true → AND short-circuits identically. Audit existing tests for any that stub only `VITE_GOOGLE_CLIENT_ID` without registry/proxy — would now see Drive disabled. From Phase-1 grep, no call-site tests stub this combination. Run full unit suite locally.

### Estimated work

3-4 hours, mostly i18n string sites + tooltip wiring.

---

## Phase 3 — Harden silent failures (small, safe, ships anytime)

**Goal:** Honor the no-silent-failure rule. Small in scope; can ship alongside Phase 1 if desired. Cloud-build neutral.

### Files to modify

- **`src/stores/syncStore.ts`** (line 1003) — `registry.removeFamily(ctx.activeFamilyId).catch(() => {})` → `.catch((e) => console.warn('[syncStore] removeFamily failed (non-critical)', e))`.

- **`src/stores/syncStore.ts`** (line 1736) — `registry.registerFamily(...).catch(() => {})` → `.catch((e) => console.warn('[syncStore] registerFamily failed (non-critical)', e))`.

- **`src/services/sync/providers/localProvider.ts`** — extract a single pure function `classifyFileError(e: unknown): { kind: 'permission' | 'quota' | 'stale' | 'corrupted' | 'unknown'; userMessageKey: string; clearHandle: boolean; severity: 'warning' | 'critical' }` exported from this module (or a small companion `localFileErrors.ts`). Single source of truth for error mapping; both `read()` and `write()` call it identically. Prevents future drift between the two paths and makes the classification rules unit-testable in one place.
  - `NotAllowedError` / `SecurityError` → `{ kind: 'permission', userMessageKey: 'storage.localFilePermissionLost', clearHandle: true, severity: 'critical' }`
  - `QuotaExceededError` → `{ kind: 'quota', userMessageKey: 'storage.localFileDiskFull', clearHandle: false, severity: 'warning' }`
  - `InvalidStateError` / `NotFoundError` → `{ kind: 'stale', userMessageKey: 'storage.localFilePermissionLost', clearHandle: true, severity: 'critical' }` (same toast as permission since user-action is "re-select file" either way)
  - DOMException with `name === 'DataError'` or generic decode failures → `{ kind: 'corrupted', userMessageKey: 'storage.localFileCorrupted', clearHandle: false, severity: 'warning' }`
  - Other → `{ kind: 'unknown', userMessageKey: 'storage.localFileWriteFailed', clearHandle: false, severity: 'warning' }`

- **`src/services/sync/providers/localProvider.ts`** (lines 30-37, the `write()` method) — wrap the `createWritable()` → `seek()` → `write()` → `truncate()` → `close()` sequence in try/catch. On error: `const c = classifyFileError(e); reportError({ surface: 'local-file', message: c.kind, severity: c.severity, error: e, context: { action: 'write' } }); if (c.clearHandle) await fileHandleStore.clear(familyId); throw e;`.

- **`src/services/sync/providers/localProvider.ts`** (lines 49-69 area, the `read()` method) — same try/catch + same `classifyFileError()` invocation, `context: { action: 'read' }`.

- **`src/services/sync/providers/localProvider.ts`** — pre-flight check at the start of `read()` and `write()`: if `await this.isReady()` returns false, reportError `'permission-not-granted'` with re-prompt action. Guards against the race where IndexedDB is cleared mid-session.

### Files to create

- None. All changes are in existing files.

### Test changes

- **`src/services/sync/providers/__tests__/localFileErrors.test.ts`** (or co-located in `localProvider.test.ts`) — table-driven tests for `classifyFileError`: each error type maps to expected `kind`, `userMessageKey`, `clearHandle`, `severity`. One place to assert classification rules.
- **`src/services/sync/providers/__tests__/localProvider.test.ts`** — add cases that consume the classifier:
  - "write() catches NotAllowedError, reports, clears handle, throws"
  - "write() catches QuotaExceededError, reports as warning, does not clear handle, throws"
  - "read() catches NotFoundError (stale handle), reports, clears handle, throws"
  - "read() rejects when isReady() returns false"

### i18n additions

- `storage.localFilePermissionLost` (en: "Browser revoked file access. Please re-select your `.beanpod` file." / beanie: "browser revoked file access. please re-select your .beanpod file.")
- `storage.localFileDiskFull` (en: "Your disk is full. Free up space and try again." / beanie: "your disk is full. free up space and try again.")
- `storage.localFileCorrupted` (en: "Couldn't read the file — it may be corrupted or another app is editing it." / beanie variant)

### Cloud regression risk + mitigations

None — all changes are in `LocalStorageProvider` (cloud uses `GoogleDriveProvider`) and silent-catch cleanup that adds logging without changing control flow. The two `syncStore` `.catch` changes are pure logging additions; behavior unchanged.

### Estimated work

3-4 hours including tests.

---

## Phase 4a — Add polling + extract warning modal (Path A polish)

**Goal:** make Path A actually usable on a Dropbox/iCloud-synced folder. Continuous polling for external changes + filename-pattern conflict detection + honest UX warning. **All built on existing primitives — no new modules where reuse is possible.**

> **Phase 4 is split into 4a and 4b.** 4a introduces `usePollWhileVisible` and uses it ONLY for the new local-file polling. 4b refactors `useStaleTabRefresh` to consume the same primitive (DRY win) but ships AFTER 4a is verified in production. This isolates the load-bearing existing-code refactor from the new-feature introduction — separate PRs, separate regression risk windows.

### Design decisions

- **Polling primitive: introduce, don't immediately refactor.** Create generic `usePollWhileVisible(callback, intervalMs, options?)`. Use it for local-file polling in this phase. Do NOT touch `useStaleTabRefresh` in 4a; that refactor is Phase 4b.

- **Capability detection:** add `supportsLocalPolling?(): boolean` as an **optional method** on `StorageProvider` (not a capability flag). `LocalStorageProvider` returns `true` (FSA `getLastModified()` is O(1) OS metadata). `GoogleDriveProvider` returns `false` (would require Drive API calls every 15s — Drive uses save-time `fetchAndMergeRemote` instead). JSDoc the method to clarify intent: _"Whether this provider can detect external changes via inexpensive local polling. Implementations returning true opt into the per-tick `fetchAndMergeRemote` loop."_ — disambiguates from "supports polling locally" misreadings.

- **Conflict detection:** inline `isConflictFilename(name: string): { isConflict: boolean; provider?: string; autoMerge: boolean }` in `syncService.ts` initially. **Concrete extraction trigger:** if `syncService.ts` exceeds 700 lines after Phase 4a's other additions, extract to `src/utils/beanpodFilename.ts` in the same PR. Avoids the "I'll extract this later" that never happens. Patterns:
  - Dropbox: `/ \(.*conflicted copy.*\)\.beanpod$/i` → `autoMerge: true`
  - OneDrive: `/-conflict(-\d+)?\.beanpod$/i` → `autoMerge: true`
  - Google Drive desktop: `/ \(\d+\)\.beanpod$/` → `autoMerge: true`
  - iCloud: `/ \d+\.beanpod$/` → `autoMerge: false` (high false-positive rate; warn-only)

- **Reuse Automerge merge:** generalize `fetchAndMergeRemote()` at `syncService.ts:493` from `currentProvider.type !== 'google_drive'` gate to `!currentProvider?.supportsLocalPolling?.()`. Drive's existing on-save behavior unchanged.

- **Modal extraction:** existing local-file warning at `CreatePodView.vue:1013-1053` becomes `LocalFileSyncWarning.vue`. Mirror `PwaReinstallModal.vue:1-177` shape: `BaseModal` with `custom-header`, structured warning body with checklist, two-button footer. Reused by both `CreatePodView` and `LoadPodView`. Single source for warning copy.

### Files to modify

- **`src/services/sync/storageProvider.ts`** — add `supportsLocalPolling?(): boolean` to the interface (optional method, opt-in, no breaking change for any current implementer).

- **`src/services/sync/providers/localProvider.ts`** — add `supportsLocalPolling(): boolean { return true; }`.

- **`src/services/sync/providers/googleDriveProvider.ts`** — add `supportsLocalPolling(): boolean { return false; }` for explicitness.

- **`src/services/sync/syncService.ts`** (line 493) — replace `if (!currentProvider || currentProvider.type !== 'google_drive') return;` with `if (!currentProvider?.supportsLocalPolling?.()) return;` for the inverse path (local). For the existing Drive-on-save path, keep as-is. Add a call to `usePollWhileVisible(triggerLocalRemoteFetch, 15_000, { fireImmediatelyOnVisible: true })` in `setProvider()` (or wherever the local provider becomes active). Wrap the per-tick fetch in try/catch + `reportError({ surface: 'local-file-polling', context: { action: 'poll' }, ... })`.

- **`src/services/sync/syncService.ts`** — add inline `isConflictFilename()` helper. Surface conflict detection at file-load time: if loaded file's name matches a conflict pattern, fire toast `t('storage.localFileConflictDetected')` with provider hint; if `autoMerge: true`, attempt to also load + merge sibling files (best-effort; FSA API limits this to whatever directory access the user already granted). Wrap merge in try/catch; failures classify as non-critical and report.

- **`src/components/login/CreatePodView.vue`** (lines 1013-1053) — replace inline modal with `<LocalFileSyncWarning :open="showLocalFileWarning" @close="..." @proceed="..." />`. Net deletion of ~40 lines.

- **`src/components/login/LoadPodView.vue`** — add an info icon next to the Local File card with tooltip / inline explainer covering desktop-only multi-device caveat. Reuse `LocalFileSyncWarning` if user clicks the info.

- **`src/services/translation/uiStrings.ts`** — add new keys to existing `storage.*` namespace: `localFileWarningSyncFolder`, `localFileWarningIos`, `localFileConflictDetected`, `localFileBestOnDesktop`. en + beanie variants. Regenerate `zh.json`.

### Files to create

- **`src/composables/usePollWhileVisible.ts`** — generic poll-while-visible primitive. ~30 lines. Signature: `usePollWhileVisible(callback: () => Promise<void> | void, intervalMs: number, options?: { fireImmediatelyOnVisible?: boolean }): void`. Uses `useToday().isVisible` (read-only). Lifecycle-safe via `onScopeDispose`.

- **`src/components/login/LocalFileSyncWarning.vue`** — extracted warning modal. `BaseModal` (custom-header) + structured body (warning + reassurance + iOS limitation note) + two-button footer. Props `{ open: boolean }`, emits `{ close: []; proceed: [] }`. ~80 lines.

### Test changes

- **`src/composables/__tests__/usePollWhileVisible.test.ts`** (new) — table-driven:
  - "fires callback every intervalMs while visible"
  - "stops when visibilityState becomes hidden"
  - "fires immediate callback on visibility=visible if option set"
  - "stops on scope dispose"
  - "does not throw if callback throws (errors caught + reported)"

- **`src/composables/__tests__/useStaleTabRefresh.test.ts`** (existing) — verify behavior unchanged after refactor to consume `usePollWhileVisible`.

- **`src/services/sync/__tests__/syncService.test.ts`** (extend or new) — "Drive provider still triggers `fetchAndMergeRemote` after capability-check refactor" (regression sentinel), "local provider triggers polling-driven `fetchAndMergeRemote`".

- **`src/services/sync/providers/__tests__/localProvider.test.ts`** — assert `supportsLocalPolling() === true`.

- **`src/services/sync/__tests__/conflictDetection.test.ts`** (new, tiny) — table-driven tests for each provider's conflict pattern + plain `family.beanpod` non-match. Targets the inline helper's exported test surface.

### Cloud regression risk + mitigations

- **Risk:** generalizing `fetchAndMergeRemote()` from `type === 'google_drive'` to capability check breaks Drive. **Mitigation:** Drive provider returns `supportsLocalPolling() === false`, so the inverse-path gate skips Drive identically. Explicit regression test asserts Drive still triggers via the existing on-save trigger.
- **Risk:** polling activates for cloud users. **Mitigation:** polling is started only when `LocalStorageProvider` is the active provider. Cloud uses Drive → polling never starts. Asserted in `usePollWhileVisible` and `syncService` tests.
- **Risk:** `useStaleTabRefresh` refactor regresses long-absence behavior. **Mitigation:** existing tests for `useStaleTabRefresh` continue to run; refactor must keep all green.

### Estimated work

10-13 hours: 2h `usePollWhileVisible` core + tests, 3h `LocalFileSyncWarning` extraction + reuse, 3h capability + syncService refactor, 2h conflict-detection inline + i18n, 3h tests + manual cloud-folder smoke. (Reduced from prior estimate because `useStaleTabRefresh` refactor is now Phase 4b.)

---

## Phase 4b — Refactor `useStaleTabRefresh` onto `usePollWhileVisible`

**Goal:** DRY win after 4a is verified in production. Pure refactor — no behavior change. Ships only once 4a has been live for at least one release cycle without regression.

### Files to modify

- **`src/composables/useStaleTabRefresh.ts`** (lines 150-161 area) — replace inline `setInterval` + `watch(isVisible)` with a single `usePollWhileVisible(run, ABSENCE_THRESHOLD_MS, { fireImmediatelyOnVisible: true })` call. Net deletion of ~15 lines.

### Test changes

- **`src/composables/__tests__/useStaleTabRefresh.test.ts`** — every existing test must continue to pass unchanged. Public API + behavior must be identical.

### Sustainability rationale

`useStaleTabRefresh` is consumed by every store's visibility-driven refresh; it's load-bearing. Refactoring it in the same PR as introducing the new primitive concentrates regression risk on one merge. Splitting into 4a (introduce primitive, use for new feature only) and 4b (refactor existing consumer) lets each ship independently with smaller diffs and easier rollback if either has a subtle regression.

### Cloud regression risk + mitigations

- **Risk:** any subtle behavior diff between `usePollWhileVisible` and the inline pattern surfaces here. **Mitigation:** every existing `useStaleTabRefresh` test must pass unchanged. Public API frozen. If any test fails, the diff between behaviors is the regression — block the merge.

### Estimated work

2-3 hours.

---

## Phase 5 — Publish Lambda code as self-host reference (Path B docs)

**Goal:** make Path B doable. Document existing Lambda code (~175 lines OAuth + ~3KB registry, both already in repo) so a self-hoster can deploy with one read-through. Pure docs; no code moves.

### Files to create

- **`infrastructure/lambda/oauth/README.md`** — step-by-step AWS Lambda + API Gateway deploy guide. Google Cloud OAuth client setup (Web Application type), Lambda env vars (`GOOGLE_CLIENT_SECRET`, `CORS_ORIGIN`), API Gateway routes, allowed-origin tuning, then `VITE_OAUTH_PROXY_URL=https://...` for the SPA.

- **`infrastructure/lambda/oauth/SPEC.md`** — runtime-agnostic markdown spec:
  - `POST /oauth/google/token` — request `{ code, code_verifier, redirect_uri, client_id }` → response `{ access_token, refresh_token?, expires_in, token_type, scope? }` or error `{ error, error_description? }`
  - `POST /oauth/google/refresh` — request `{ refresh_token, client_id }` → same response
  - CORS, redirect-URI allowlist, empty-body / HTML-error handling (matches existing `oauthProxy.ts:32-36` hardening)
  - Example implementations: AWS Lambda (link `index.mjs`), Cloudflare Workers, Vercel Edge function

- **`infrastructure/lambda/registry/README.md`** — optional path: DynamoDB schema (1 partition key `familyId`, on-demand billing), env vars (`TABLE_NAME`, `REGISTRY_API_KEY`, `CORS_ORIGIN`), API Gateway routes, `VITE_REGISTRY_API_URL` + `VITE_REGISTRY_API_KEY`. Schema cites `RegistryEntry` from `src/types/models.ts:1067-1078`.

### Files to modify

- **`infrastructure/README.md`** — add "Self-host deploy guide" section linking new READMEs.

### Cloud regression risk

None. Pure documentation.

### Estimated work

4-6 hours.

---

## Phase 6 — Rewrite SELF_HOSTING.md

**Goal:** definitive self-hosting docs reflecting two paths. Honest about limitations.

### Files to modify

- **`docs/SELF_HOSTING.md`** — full restructure:
  1. **TL;DR — pick your path** (decision tree at top).
  2. **Path A — Local file in a synced folder.**
     - Setup: clone, `npm run build`, host static `dist/` anywhere (or run dev). **Zero env vars required — verified end-to-end against the audit.**
     - Use: pick a `.beanpod` inside Dropbox/iCloud/OneDrive folder. Each family member opens via their own provider's desktop client.
     - Honest limitations: desktop Chrome/Edge only (FSA picker). iOS Safari, Android Chrome, Firefox = manual export-import. ~15s polling delay. iCloud conflict copies require manual re-import.
  3. **Path B — Run your own OAuth Lambda (and optional registry).**
     - Walk through Google Cloud Console (Web Application client). Explain why server-side `client_secret` is unavoidable. Link `infrastructure/lambda/oauth/README.md`.
     - Required: `VITE_GOOGLE_CLIENT_ID`, `VITE_OAUTH_PROXY_URL`. Optional: `VITE_GOOGLE_API_KEY` + `VITE_GOOGLE_PROJECT_NUMBER` (Picker), `VITE_REGISTRY_API_URL` + `VITE_REGISTRY_API_KEY` (registry smoothness).
  4. **Env-var matrix table** matching new gates.
  5. **Trademark, bug reporting** — keep as-is.
  - Replace lines 53-71 (current Drive + registry sections) with new Path-B walkthrough.

### Cloud regression risk

None.

### Estimated work

3-4 hours.

---

## Sequencing & shipability

| Phase | Order                     | Independent? | Cloud risk | Hours |
| ----- | ------------------------- | ------------ | ---------- | ----- |
| 1     | First                     | Yes          | Tiny       | 2-3   |
| 2     | After 1                   | Yes          | Tiny       | 3-4   |
| 3     | Anytime                   | Yes          | None       | 3-4   |
| 4a    | After 1                   | Yes          | None       | 10-13 |
| 4b    | After 4a live one release | Yes          | None       | 2-3   |
| 5     | Anytime                   | Yes          | None       | 4-6   |
| 6     | Last                      | After 1-5    | None       | 3-4   |

**Total: ~27-37 hours.** Phase 1 alone fixes the self-hoster's bug and is shippable in a single sitting before tomorrow's launch. Phase 3 can ride alongside Phase 1 if desired (small + safe). Phases 2, 4a, 5, 6 can land after launch. Phase 4b waits for 4a to soak.

---

## Sustainability considerations

These are deliberate design choices for long-term maintainability. Each addresses a specific failure mode that creeps in when small features compound over time.

1. **Permissive-resolver framing for OAuth proxy URL** — the `VITE_OAUTH_PROXY_URL` → `VITE_REGISTRY_API_URL` resolver is documented as a permissive pattern, not a deprecated fallback. No "remove later" tech-debt narrative. Both env vars stay first-class indefinitely.

2. **Single `classifyFileError()` pure function** (Phase 3) — error-classification logic is DRY across `read()` and `write()` from day one. Adding a new error type means updating one function and one test table. Prevents the failure mode where `read()` and `write()` drift apart over time.

3. **Phase 4 split into 4a + 4b** — load-bearing existing-code refactor (`useStaleTabRefresh`) is isolated from new-feature introduction. Smaller diffs per PR, isolated regression windows, easier rollback.

4. **Concrete extraction trigger for `isConflictFilename`** — "extract if `syncService.ts` exceeds 700 lines" is a measurable rule, not a vague "extract later". Avoids the `inline-forever-because-no-one-decides` anti-pattern.

5. **`supportsLocalPolling()` as a method, not a flag** — methods are easier to evolve than flags (you can add return-type complexity later without breaking consumers). JSDoc clarifies intent so future readers don't misread the name.

6. **Deferred `RemoteChangeWatcher` abstraction (YAGNI)** — `syncService.ts` will gain three merge triggers (Drive on-save, local polling, conflict-load). Today's two providers don't justify a `RemoteChangeWatcher` abstraction; the conditional is shallow and well-commented. **Future-work flag:** if a third provider arrives (Dropbox API, S3, etc.), introduce the abstraction at that point. Don't pay the abstraction cost on speculation.

7. **Cloud regression sentinel test** (Phase 1) — the "falls back to `VITE_REGISTRY_API_URL` when only registry is set" test is the load-bearing assertion; if it ever fails, cloud breaks. Named explicitly so future devs understand its purpose.

8. **No new error registries** — every async failure flows through the existing `reportError({ surface, message, error, context })` contract. No `JOIN_ERRORS`-style local registry; surfaces are namespaced by string. Adding a new error type means adding a string, not a typed enum that ripples through the codebase.

9. **i18n keys land in existing namespaces** — `selfHost.*` and `storage.localFile*` already exist; new keys slot in. No new top-level namespace. Translation script parser stays unchanged.

10. **Lambda SPEC.md is the source of truth for Path B** — both the cloud Lambda and any self-host Lambda must conform to the SPEC. SELF_HOSTING.md (human-facing) links to SPEC.md (machine-facing); divergence is mechanically detectable via test against the cloud Lambda. Prevents docs-drift over time.

11. **Phase 3 hardens `LocalStorageProvider` regardless of Phases 4-6** — the silent-failure cleanup is a quality-of-life improvement that benefits Path A users today and is worth shipping even if no further self-host work happens. Phases are not rigidly dependent.

### Coupling risks I am NOT introducing (deliberately)

- **No new global "self-host mode" boolean.** `getDeploymentMode()` already three-states this; new code reads `features.X` directly.
- **No new capability container object on `StorageProvider`.** A single optional method (`supportsLocalPolling`) is enough; if a second capability is needed later, it's another optional method.
- **No new error-class hierarchy.** `classifyFileError` returns a discriminated union, not custom Error subclasses. Easier to test, easier to extend, no `instanceof` brittleness.
- **No new directory layout.** All Phase 1-4 work lives in existing folders (`src/services/sync/`, `src/composables/`, `src/components/login/`). Phase 5 is the only new docs in `infrastructure/lambda/`, mirroring code that's already there.

---

## Critical files to modify

**Phase 1**: `src/services/google/oauthProxy.ts`, `src/config/features.ts`, `src/vite-env.d.ts`, `.env.example`, `src/services/google/__tests__/oauthProxy.test.ts`, `src/config/features.test.ts`

**Phase 2**: `src/components/login/LoadPodView.vue`, `src/components/login/CreatePodView.vue`, `src/services/sync/capabilities.ts`, `src/stores/syncStore.ts`, `src/services/translation/uiStrings.ts`

**Phase 3**: `src/stores/syncStore.ts` (lines 1003 + 1736), `src/services/sync/providers/localProvider.ts`, `src/services/translation/uiStrings.ts`

**Phase 4a**: `src/services/sync/storageProvider.ts`, `src/services/sync/providers/localProvider.ts`, `src/services/sync/providers/googleDriveProvider.ts`, `src/services/sync/syncService.ts`, `src/components/login/CreatePodView.vue`, `src/components/login/LoadPodView.vue`, `src/services/translation/uiStrings.ts`

**Phase 4b**: `src/composables/useStaleTabRefresh.ts` (refactor only — public API + behavior frozen)

**Phase 5**: `infrastructure/README.md`

**Phase 6**: `docs/SELF_HOSTING.md`

## Critical files to create

**Phase 4a**: `src/composables/usePollWhileVisible.ts`, `src/components/login/LocalFileSyncWarning.vue`, plus the test files listed above

**Phase 3**: `src/services/sync/providers/localFileErrors.ts` (or co-located in `localProvider.ts` — single pure function `classifyFileError`)

**Phase 5**: `infrastructure/lambda/oauth/README.md`, `infrastructure/lambda/oauth/SPEC.md`, `infrastructure/lambda/registry/README.md`

## Existing functions/utilities to reuse (no duplication)

- `useToday().isVisible` at `src/composables/useToday.ts:1-100` — singleton visibility sink, the one true source for `visibilitychange` listening. Phase 4's `usePollWhileVisible` consumes it.
- `useStaleTabRefresh` at `src/composables/useStaleTabRefresh.ts:1-177` — the existing watch-isVisible pattern. Phase 4 generalizes its core into `usePollWhileVisible` and refactors `useStaleTabRefresh` to consume it (DRY win).
- `BaseModal` + `useFullscreenOverlay` at `src/components/ui/BaseModal.vue:1-149` — three-tier modal system. `LocalFileSyncWarning` wraps `BaseModal` with `custom-header` slot, mirroring `PwaReinstallModal.vue:1-177`.
- `reportError()` at `src/utils/errorReporter.ts:1-403` — universal error contract with PII allowlist + dedup + Slack + toast. Used by every async failure path in Phases 3 + 4.
- `LocalStorageProvider` at `src/services/sync/providers/localProvider.ts:15-186` — already wraps FSA API. Phase 3 hardens its read/write paths; Phase 4 adds `supportsLocalPolling()`.
- `fetchAndMergeRemote()` at `src/services/sync/syncService.ts:492-544` — Automerge CRDT merge already handles concurrent edits + envelope metadata merge (wrappedKeys, inviteKeys). Phase 4 generalizes its provider gate but keeps the merge body.
- `mergeDoc()` at `syncService.ts:516` — the load-bearing Automerge merge.
- `ok()` validator at `src/config/features.ts:18` — reused for the new `oauthProxy` gate.
- `getDeploymentMode()` / `getDeploymentBadge()` at `src/config/features.ts:64-95` — three-state badge logic, no changes.
- `useTranslation()` + `t()` for i18n; `selfHost.*` and `storage.localFile*` namespaces.
- Lambda code at `infrastructure/lambda/oauth/index.mjs` (175 lines) — already publishable; repo public; just add reference docs.
- Existing inline local-file warning at `CreatePodView.vue:1013-1053` — Phase 4 extracts (not rewrites) into `LocalFileSyncWarning.vue`, then reused from both `CreatePodView` and `LoadPodView`.

---

## Verification

### Phase 1 verification

```bash
npm run test:unit -- src/services/google src/config
npm run test:unit
npm run type-check
npm run lint
```

Manual:

- Cloud-shaped `.env.local` (only `VITE_REGISTRY_API_URL`) → `npm run dev` → sign in to Drive → confirm token exchange still hits the Lambda and returns successfully.
- Path-B-shaped `.env.local` (`VITE_GOOGLE_CLIENT_ID` + `VITE_OAUTH_PROXY_URL` only) → confirm Drive sign-in attempts the OAuth proxy at the new URL.
- Bare `.env.local` (no vars) → confirm Drive button is disabled with the expected tooltip (after Phase 2).

### Phase 2 verification

```bash
npm run test:unit
npx playwright test e2e/login*.spec.ts e2e/invite-join.spec.ts
```

Manual: cloud-shaped env, confirm Drive button enables and tooltip is unchanged.

### Phase 3 verification

```bash
npm run test:unit
```

Manual:

- DevTools → Application → IndexedDB → clear file handle → reload → verify error toast + re-prompt path.
- DevTools → Application → Storage → simulate quota exceeded (or use a tiny disk on a VM) → verify disk-full toast.
- Verify console shows `[syncStore] removeFamily failed (non-critical)` instead of swallowed `.catch(() => {})` when registry is unreachable.

### Phase 4a verification

```bash
npm run test:unit
```

Manual cross-device test: open two browsers (or two profiles) on the same `.beanpod` file in a Dropbox-synced folder. Make a change in browser A; wait ~30s for Dropbox to sync. Confirm browser B picks up the change via the polling loop. Make divergent changes in both before either syncs. Confirm Automerge merges cleanly. Open a Dropbox-conflict-copy filename directly to verify the auto-merge path.

### Phase 4b verification

```bash
npm run test:unit
```

`useStaleTabRefresh` test suite must pass unchanged. Manual: trigger a long-absence wake (close laptop lid, reopen 5+ minutes later) — verify stale-tab refresh fires identically to pre-refactor.

### Phase 5 verification

Docs lint. Optionally walk through the AWS deploy guide on a fresh account.

### Phase 6 verification

Docs lint.

### Full-suite gate before any merge

```bash
npm run test:unit                  # 1788+ tests must pass
npm run type-check
npm run lint
npx playwright test                # E2E green on chromium
```

The cloud build's `.env.local` is the load-bearing regression sentinel — if it ever changes behavior, the merge stops.
