## Pass 2 changes

- **The fatal overlay cannot carry an action today, and this is the one real gap in the plan.** `fatalErrorStore` exposes `message`, `detail`, `clearDataHelps` and nothing else (`src/stores/fatalErrorStore.ts:22-60`), and the overlay hardcodes exactly two buttons, Reload and Clear data (`src/App.vue:1885-1900`). `detail` renders inside a collapsed `<details>` (`src/App.vue:1927-1936`), so putting a store URL there would hide it behind a disclosure and R3.4 ("never a dead end") would not actually be met. Assumption 6 is replaced by a fact, and R3.3 now specifies the smallest honest change: ONE optional `action` field on the store, rendered as the primary button plus an always-visible selectable caption.
- **The force trigger is not a new dispatch site; it already exists.** `surfacePayloadFatal` already maps `needs-update` to `resumeSetup.podNewerVersion` with `clearDataHelps: false`, through the `PAYLOAD_OVERLAY_KEY` table (`src/utils/payloadFailureSurface.ts:61-67, 148-174`), and that file is documented as "THE one place a payload failure becomes the fatal overlay" (`:1-21`). R3 now attaches the action inside that existing chokepoint instead of adding a second `needsAppUpdate` reader. "The `needsAppUpdate` dispatch site" is removed from Files Affected.
- **The floor fetch as drafted would be blocked by CORS on every device, and the fail-open would hide it.** There is no `response_headers_policy` and no `Access-Control-Allow-Origin` anywhere in the apex or web CloudFront modules (`infrastructure/modules/frontend/main.tf`, `infrastructure/modules/web/main.tf`; grep returns nothing), while the native WebView origin is `capacitor://app.beanies.family` on iOS (`capacitor.config.ts:13-21`, mirrored in `infrastructure/modules/telemetry/variables.tf:44`). A browser `fetch()` from the app origin to `https://beanies.family/min-app-version.json` is therefore refused, R4's fail-open swallows it, and the entire floor is permanently dead code that nobody notices. R4.2 now specifies `CapacitorHttp.get()` (exported from `@capacitor/core` 8.5.0, `node_modules/@capacitor/core/types/index.d.ts:4`), which runs on the native layer and is not subject to CORS, with an acceptance criterion that the floor is proven to LOAD on a device rather than only to fail open.
- **`Capacitor.isNativePlatform()` may not appear in the new code.** `src/services/sync/capabilities.ts:38-48` states in terms that it "is the ONE place `Capacitor.isNativePlatform()` is allowed to appear". R1.2 and Assumption 5 now use `isNative()` / `getPlatform()` from that module.
- **The store URLs already exist four times and none is reachable from `src/`.** `web/src/pages/download.astro:14-15`, `web/src/pages/ios.astro:12`, `web/src/pages/android.astro:11`, `src/content/release-notes/deploys.ts:601`. R3.4 now adds ONE constant beside `MARKETING_URL` (`src/utils/marketing.ts:1-3`), which already owns the "where does the public site live" fact, rather than a fifth literal.
- **The prompt must not be attempted before the app is past boot.** `ConfirmModal` renders at `layer="top"`, which is `z-[250]` (`src/components/ui/BaseModal.vue:36`), while the boot spinner and the fatal overlay are both `z-[300]` (`src/App.vue:1842, 1851`). A prompt raised during boot would be an open-but-invisible modal. R2.5 now requires `isLoaded()` in addition to the quiet predicate.
- **`confirm()` takes translation keys, not strings.** `title` and `message` are `UIStringKey`; only `detail` is a plain string (`src/composables/useConfirm.ts:6-23`). R2.3 and R5 now say so, so the implementer does not discover it late, and note that `variant: 'info'` already renders the Heritage Orange squircle and orange confirm button (`src/components/ui/ConfirmModal.vue:28, 31, 75`), which is the correct register for a routine alert.
- **`openExternal` must be called synchronously inside the gesture** (`src/utils/openExternal.ts:18-20`). Chaining it in the `.catch` of an awaited `openAppStore()` puts it outside the gesture and it would be blocked. R3.4 now states that the on-screen URL, not a fallback call, is the guarantee.
- **The quiet predicate is confirmed unexported and is 8 lines.** `isQuiet` at `src/composables/usePwaUpdater.ts:44-52`. R2.5 names the destination (`src/utils/appQuiet.ts`, `isAppQuiet()`) and requires a verbatim move so web behaviour cannot shift.
- **`payloadErrorDetail` gains `appVersion`.** It has exactly one consumer (`src/utils/payloadFailureSurface.ts:171`) and no test pins its shape, and R3.4 asks for the running version in the diagnostic; `formatDeviceInfo` does not carry it (`src/utils/diagnostics.ts:103-113`).
- **The session-dismiss flag is a module boolean, stated explicitly** so nobody reaches for `createPerMemberStore` (`src/composables/perMemberStore.ts`), which is per-member localStorage with its own failure surface and would be over-engineering for a flag that dies with the process.
- **Plugin import is dynamic and cached**, so the web bundle and every web unit test never evaluate it, and "plugin absent" is a catchable rejection rather than a module-eval crash. Added to R1 and to the error-handling enumeration.
- **Every failure path is now enumerated with its handler** in a table in the Approach section (nine of them), rather than the single paragraph Pass 1 had.
- **Files Affected corrected**: the Help article lives at `src/content/help/how-it-works.ts:5` and is rendered by BOTH the app and the Astro site (`web/src/pages/help/[category]/[...slug].astro:11` imports `@/content/help`), so one edit covers both; Pass 1 omitted the file entirely.
- **Added a pre-implementation availability check on the plugin.** Capawesome runs a sponsorware tier, and greg has previously declined a Capawesome plugin by name (`docs/plans/2026-07-14-native-biometric-prf-and-android-statusbar.md:88`), so the plan names the degrade path (iOS needs no plugin at all; Android falls back to the same store-URL path) instead of assuming the dependency lands.
- Em-dashes recast throughout, per the repo prose rule.

---

# Plan: Ask people to update the app, and require it when their family file needs it

> Date: 2026-09-07
> Related issues: None, direct implementation
> Plan file: `docs/plans/2026-09-07-native-update-gate.md` (Pass 2 output: `docs/plans/2026-09-07-native-update-gate-pass2.md`)
> Follows: `docs/plans/2026-09-06-compacted-pod-v5.md`, whose Caveats deferred this ("Force-update on native is a follow-up, not this plan", `:351`)
> Platform research verified 2026-09-07; URLs in Assumptions

> **No GitHub issue created.** This plan was approved for direct implementation.

> **No mockup.** Both surfaces reuse existing components rather than inventing UI: the prompt is `confirm()` (`src/composables/useConfirm.ts:56`), the block is the existing fatal overlay (`useFatalErrorStore.setFatal`, `src/stores/fatalErrorStore.ts:38`, rendered by `src/App.vue:1849-1948`). One small, named addition is required to the overlay (an optional action button, R3.3); nothing new is designed, so there is nothing to mock up.

## User Story

As someone using beanies on a phone or tablet, I want the app to tell me when a newer version is available, and to insist when my family's file genuinely needs it, so that I am never quietly cut off from my own family's data without knowing why or what to do about it.

## Context

Compacted family files are written as beanpod 5.0 (ADR-036 addendum). A build that predates that format refuses the file at parse and stops syncing. On the web that heals itself: `usePwaUpdater` polls the service worker every five minutes and applies the new build on the next quiet navigation (`src/composables/usePwaUpdater.ts:135-151`). On iOS and Android it does not, because `usePwaUpdater` returns early on the native platform test (`:116`) and no service worker is registered natively (ADR-029). A native device therefore stays on whatever build the store last installed, and beanies has no way to ask it to move.

Today that is survivable rather than dangerous: the 5.0 format means a stale device cannot merge across lineages, so it cannot corrupt the family. It is only cut off, and it says so through `podNewerVersion.inline` and its three sibling registers (`src/services/translation/uiStrings.ts:4377-4404`). But "only cut off" is still a person who cannot see their family's calendar, whose only current remedy is that somebody tells them.

**This plan is honest about what it does not do: it does not help anyone who is stale today.** They are on 0.16 (`src/constants/appVersion.ts:34`), which contains none of this code. This is insurance for the _next_ format change and for the ordinary case of a device drifting behind. Anyone stale right now still has to be told by their family, exactly as the compaction notice says.

Two questions have to be answered separately, because they have different sources and very different consequences:

1. **Is there a newer version?** The store knows, and `getAppUpdateInfo()` answers it on both platforms. This drives a PROMPT.
2. **Is this version too old to keep working?** No store can answer that; it is a fact about our data format. This drives a FORCE, and greg's instruction is that force is reserved for exactly this.

## Requirements

### R1. One composable owns the question, and it is native-only

1. `src/composables/useAppUpdate.ts` is the single place that asks about updates. It exposes `{ updateAvailable, mustUpdate, checkForUpdate(), promptUpdate(), requireUpdate(reason), openStore() }`.
2. It is inert on web, mirroring `usePwaUpdater`'s early return in the other direction, so exactly one updater is live per platform and neither has to know about the other. State this in the file header, with a pointer each way. **The platform test is `isNative()` / `getPlatform()` from `src/services/sync/capabilities.ts:46,52`, never `Capacitor.isNativePlatform()` directly**: that file states it "is the ONE place `Capacitor.isNativePlatform()` is allowed to appear" (`:38-48`), and the whole point of the seam is that a future Capacitor major is a bounded change.
3. Singleton with a detached `effectScope`, the shape `usePwaUpdater` (`:118-157`) and `useStaleTabRefresh` already use, and for the same reason. It exports a `__resetAppUpdateForTesting()` twin of `__resetPwaUpdaterForTesting` (`usePwaUpdater.ts:164-171`) so unit tests can re-initialise between cases.
4. **The plugin is loaded by a cached dynamic `import()` inside the native branch**, never a top-level import. Two reasons, both load-bearing: the web bundle and every web unit test then never evaluate a native plugin module, and "the plugin is not installed in this build" becomes a rejected promise this code catches rather than a module-evaluation crash that takes `App.vue` setup with it. Cache the promise so the import happens once.
5. Every listener the composable registers (the `resume` listener in R2, the Android download-state listener in R2.2) is removed in `onScopeDispose`. A leaked native listener is a silent failure with a long fuse.

### R2. The prompt: the store's own answer, shown gently

1. Add `@capawesome/capacitor-app-update` (8.x, which requires Capacitor >= 8; we are on 8.5.0, `package.json` `@capacitor/core: ^8.5.0`). Call `getAppUpdateInfo()` on launch and on resume. **Resume is `App.addListener('resume', ...)` from `@capacitor/app`**, which is already a dependency and already used exactly this way at `src/services/share/iosShareAdapter.ts:100`. Do not add a poll: there is no cadence question here, only "the app came back".
2. Android: `startFlexibleUpdate()`, the background download that leaves the app usable, then `completeFlexibleUpdate()` at a quiet moment. `completeFlexibleUpdate()` restarts the app, so it is gated on the same quiet predicate as everything else in R2.5, not fired the instant the download reports ready. iOS: `openAppStore()` from a dismissible `confirm()`, because in-app updates are a Play feature and iOS has no equivalent.
3. Reuse `confirm()` for the sheet: `variant: 'info'`, `showCancel: true`, a `confirmLabel` of "Update" and a `cancelLabel` of "Not now". Do not build a new modal. Note the signature (`src/composables/useConfirm.ts:6-23`): `title`, `message`, `confirmLabel` and `cancelLabel` are all `UIStringKey`, and only `detail` is a plain string, so the prompt's copy must be real translation entries (R5) and cannot be assembled at the call site. `variant: 'info'` already renders the Heritage Orange squircle with the `info` glyph and an orange confirm button (`src/components/ui/ConfirmModal.vue:28, 31, 75`), which is the correct register: this is a routine alert, and Alert Red is reserved for destructive confirmations.
4. Dismissible, and it stays dismissed for the session. A nag on every launch teaches people to dismiss without reading, which is exactly the reflex the FORCE case needs them not to have. **The flag is a module-level boolean inside the singleton.** It must die with the process, which is precisely what a module boolean does; do not reach for `createPerMemberStore` (`src/composables/perMemberStore.ts`), which is per-member localStorage with its own write-failure surface and would be the wrong lifetime as well as more code.
5. Never shown when offline, mid-save, with an overlay open, or before the app is past boot.
   - The first three: **extract `isQuiet` verbatim** from `src/composables/usePwaUpdater.ts:44-52` (it is genuinely not exported today) into `src/utils/appQuiet.ts` as `isAppQuiet()`, and import it from both. Verbatim, so web behaviour cannot shift as a side effect; it keeps its `try/catch` returning `false` when the store is not ready.
   - Offline: `useOnline().isOnline` (`src/composables/useOnline.ts:21`). `getAppUpdateInfo()` would fail offline anyway, so this is not correctness, it is not emitting a `check-failed` every time a phone walks into a lift.
   - Past boot: `isLoaded()` from `@/services/automerge/projection`, the same signal `waitForDocLoaded` (`src/composables/waitForDocLoaded.ts:12`) reads. This one is not optional. `ConfirmModal` renders at `layer="top"`, which is `z-[250]` (`src/components/ui/BaseModal.vue:36`), while the boot spinner and the fatal overlay are both `z-[300]` (`src/App.vue:1842, 1851`); a prompt raised during boot would be an open modal nobody can see or dismiss, holding `hasOpenOverlays()` true for the rest of the session.

### R3. The force: the app's own answer, from the failure that actually happened

1. The authoritative trigger is `UnsupportedBeanpodVersionError` (`src/types/sync.ts:390-412`), which already answers `needsAppUpdate` (`:404`) and already reaches every surface through `payloadErrorKind` (`:470-475`). When it fires on native, the app genuinely cannot do its job for this family, and the update stops being a suggestion.
2. **The block already exists; only its action is missing.** `surfacePayloadFatal` (`src/utils/payloadFailureSurface.ts:148-174`) is documented as "THE one place a payload failure becomes the fatal overlay" (`:1-21`), and it already resolves `needs-update` to `resumeSetup.podNewerVersion` through the `PAYLOAD_OVERLAY_KEY` table (`:61-67`) and already passes `clearDataHelps: false` (`:172`). So this requirement adds NO new classification and NO second `needsAppUpdate` reader: it attaches the update action inside that one function, gated on `isNative()` and on `payloadErrorKind(err) === 'needs-update'`. Everything else about the overlay is unchanged.
3. **The overlay needs one small, named addition, because it cannot carry an action today.** `fatalErrorStore` exposes only `message`, `detail` and `clearDataHelps` (`src/stores/fatalErrorStore.ts:22-60`), and `App.vue` hardcodes exactly two buttons, Reload and Clear data (`:1885-1900`). The smallest honest change:
   - `setFatal` gains a third option, `action?: FatalAction | null`, where `FatalAction = { labelKey: UIStringKey; run: () => void; fallbackText?: string }`. Held in a `shallowRef` and `markRaw`'d so Vue never proxies the function, and cleared by `clear()` alongside the other three fields.
   - `App.vue` renders the action as the PRIMARY button at the head of the existing action row (`:1884-1900`), demoting Reload to the secondary slot it already occupies visually. Clear data stays hidden by the existing `initErrorClearHelps` guard. Reload keeps its place because it is not a lie (it does reload) and it is exactly what a person does after returning from the store.
   - `fallbackText` renders directly under the row as a selectable caption. This is what makes R3.4 true. Putting the URL in `detail` would NOT satisfy it: `detail` lives inside a collapsed `<details>` block (`:1927-1936`).
   - No new component. Three small additions to two existing files.
   - Android: `performImmediateUpdate()`, Play's fullscreen flow, is the action's `run`. iOS: `openAppStore()`.
4. **Never a dead end.** `fallbackText` carries the platform's store URL, always, not only after a failure. Two reasons it must be unconditional. First, `openAppStore()` can resolve while nothing visibly happens, so "show it on failure" has no reliable trigger. Second, `openExternal` cannot be used as a late fallback at all: it must be called synchronously inside the originating gesture (`src/utils/openExternal.ts:18-20`), and a call in the `.catch` of an awaited `openAppStore()` is already outside it. The on-screen text is the guarantee; the button is the convenience. The store URL comes from ONE new constant beside `MARKETING_URL` in `src/utils/marketing.ts:1-3`, which already owns the "where does the public surface live" fact; the four existing literals (`web/src/pages/download.astro:14-15`, `web/src/pages/ios.astro:12`, `web/src/pages/android.astro:11`, `src/content/release-notes/deploys.ts:601`) live in the Astro workspace or in frozen release-note content and are left alone, with a cross-reference comment on the new constant so a future edit knows where its siblings are.
5. The diagnostic must carry the running version. Add `appVersion: APP_VERSION` to `payloadErrorDetail` (`src/types/sync.ts:507-528`). It has exactly one consumer (`src/utils/payloadFailureSurface.ts:171`), no test pins its shape, `formatDeviceInfo` does not carry the product version (`src/utils/diagnostics.ts:103-113`), and every payload-failure support conversation wants it. The family id and the file's own version are already there (the latter through `err.message`, which `UnsupportedBeanpodVersionError` clamps to `/^[\w.+-]{1,16}$/` at construction, `src/types/sync.ts:396`).
6. Native only. On web the service worker has already handled it, and blocking a browser tab that can update itself would be gratuitous. Concretely: `surfacePayloadFatal` attaches the action only when `isNative()`, so the web overlay is byte-identical to today.
7. Out of scope, deliberately: the join-flow's `FILE_NEWER_VERSION` (`src/utils/podAccess.ts:46, 103`) and `join.error.newerVersion` (`src/composables/useJoinFlow.ts:222`) keep `recoveries: []` and gain no button. A person mid-join is not locked out of their own data; they update and open the link again, which is what the copy already says.

### R4. The pre-emptive floor: a file we control

1. `web/public/min-app-version.json`, served at `https://beanies.family/min-app-version.json`, shape `{ "minSupportedVersion": "0.16", "reason": "…" }`. `web/public/` exists and its contents reach the apex unchanged (`robots.txt`, `llms.txt` and friends are already there).
2. Fetched once on launch with a short timeout, cached in memory, and **failing open**: no network, a timeout, a non-200, a malformed body, or any error at all means no nag and no block. A version gate that fails closed can lock a family out of their own data over a CDN blip, which is worse than the thing it prevents.
3. **The transport is `CapacitorHttp.get()`, not `fetch()`.** This is a correctness requirement, not a preference. There is no `response_headers_policy` and no `Access-Control-Allow-Origin` anywhere in the apex or web CloudFront modules (`infrastructure/modules/frontend/main.tf`, `infrastructure/modules/web/main.tf`), while the native WebView origin is `capacitor://app.beanies.family` on iOS (`capacitor.config.ts:13-21`, mirrored in the API's CORS allowlist at `infrastructure/modules/telemetry/variables.tf:44`). A browser `fetch()` from the app origin to the apex is therefore refused by CORS on every device, R4.2's fail-open swallows the refusal, and the entire floor becomes dead code that nothing reports. `CapacitorHttp` is exported from `@capacitor/core` 8.5.0 (`node_modules/@capacitor/core/types/index.d.ts:4`), runs the request on the native layer, and is not subject to CORS. Call it DIRECTLY; **do not enable the `CapacitorHttp` fetch/XHR patch in `capacitor.config.ts`**, which would reroute every network call in the app through native and is a blast radius nobody asked for. Because the whole feature is native-only (R1.2), no web transport is needed at all.
4. Compared against `APP_VERSION` (`src/constants/appVersion.ts:34`), not the store version. `scripts/derive-store-version.mjs:63` strips the `R<n>` suffix, so `0.15R2` and `0.15` are the same string to the stores and must not be the same to this check.
5. A real comparison, not a string compare: `0.9` is older than `0.16`, and `0.15R2` is newer than `0.15`. Its own pure function with its own tests, in `src/utils/` beside the other pure helpers. Nothing like it exists in the repo today (no semver dependency, no comparison helper; `derive-store-version.mjs` only strips and validates).
6. Raising the floor is a deliberate act: `deploy-web.yml` is `workflow_dispatch` only, so pushing the file does not publish it. The workflow syncs `web/dist/` to S3 (`:71-72`) and then invalidates CloudFront on `/*` (`:74-78`), so once it IS run the new floor is live immediately with no cache wait. Say all of this in the plan, in the file's own comment, and in a runbook step.
7. The floor's URL is derived from `MARKETING_URL` (`src/utils/marketing.ts:1-3`), not hardcoded. In dev that points at `http://localhost:4321`, which fails open on a device, which is the correct and harmless behaviour for a dev build.

### R5. Copy, in the registers that already exist

Reuse rather than invent. The four "saved by a newer version" strings (`src/services/translation/uiStrings.ts:4377-4404`) and the Help article already say the right thing; the update surfaces agree with them word for word where they overlap. New keys only for the prompt sheet, the block's action label, and the buttons, each with `en` and `beanie`; on this surface the `beanie` values stay plain English, matching the compaction decision (greg, 2026-09-06: "do not use bean euphemisms"). All of them are `UIStringKey`s because that is what `confirm()` and the new `FatalAction.labelKey` take; none may be assembled at the call site. The store URL in `fallbackText` is a URL, not prose, so it is not translated.

### R6. Observability

An `app-update` surface: the check ran and what it found, the prompt shown, the prompt dismissed, an update started and completed, the block shown, and the store failing to open. Enough to answer "how fast does the fleet actually drain" and "is anyone stuck behind a broken store link", which is the operational question the 5.0 work left open. Detail in the Observability Coverage section.

## Important Notes & Caveats

- **This does nothing for the currently-stale population.** Say it in the plan, the code header and STATUS. Implying otherwise would repeat the exact defect the last review round caught in the compaction copy.
- **iOS has no in-app update.** Quoted from the plugin's own docs: "in-app updates are a feature of the Google Play Store and are therefore only available on Android." The iOS path is `getAppUpdateInfo()` then `openAppStore()`, and the plan must not imply otherwise.
- **Check the plugin is actually available and licensed before step 4.** Capawesome operates a sponsorware tier, and greg has previously declined a Capawesome plugin by name (`docs/plans/2026-07-14-native-biometric-prf-and-android-statusbar.md:88`). If `@capawesome/capacitor-app-update` is not adoptable, the feature does not die: iOS never needed the plugin for anything but `openAppStore()`, and both platforms degrade to the store URL the block already shows plus a `confirm()` driven by the R4 floor alone. Only Play's flexible and immediate flows are lost. Decide this before writing native code, not after.
- **`inAppUpdatePriority` is set at rollout, through the Play Developer API, and cannot be changed afterwards.** It is also unsupported for internal app sharing. If we ever want priority-driven behaviour it has to be decided at release time, which is a runbook change, not a code change.
- **Testing in-app updates needs internal app sharing**, the same application id and signing key, a higher `versionCode`, and an account that has installed the app from Play before. It cannot be exercised in CI or in a simulator.
- **Do not block on the floor check.** R4.2's fail-open is not a nicety; it is the difference between a bad deploy being an inconvenience and being a lockout. But see R4.3: fail-open plus a CORS refusal is indistinguishable from fail-open plus a healthy fleet, which is why the transport is specified and why an acceptance criterion proves a real load.
- **Do not enable the global `CapacitorHttp` patch.** Calling `CapacitorHttp.get()` directly is the whole of what R4 needs; turning on the config flag reroutes every request in the app.
- **Do not add a second updater on web.** `usePwaUpdater` owns that platform completely, and `isQuiet` must move verbatim so its behaviour there does not shift.
- **Do not deploy** as part of this work.

## Assumptions

> **Review these before implementation.**

1. `@capawesome/capacitor-app-update` 8.x supports Capacitor 8 ("Active support" in its compatibility table) and exposes `getAppUpdateInfo()` and `openAppStore()` on both platforms, with `performImmediateUpdate`, `startFlexibleUpdate`, `completeFlexibleUpdate` and the state listener on Android only. Verified 2026-09-07: https://capawesome.io/docs/sdks/capacitor/app-update/ . Availability and licensing still to be confirmed at install time, see Caveats.
2. Play in-app updates: flexible downloads in the background and can be deferred; immediate is a fullscreen flow the user must complete to continue. `inAppUpdatePriority` is 0-5, set via `Edits.tracks.releases` in the Play Developer API at rollout only, and unsupported for internal app sharing. Verified 2026-09-07: https://developer.android.com/guide/playcore/in-app-updates and .../in-app-updates/test
3. `web/public/**` is published to the marketing origin by `aws s3 sync web/dist/ --delete` (`.github/workflows/deploy-web.yml:71-72`), followed by a `/*` CloudFront invalidation (`:74-78`), so a file added there is served at `https://beanies.family/<name>` and a change to it is live as soon as the workflow runs. That workflow is `workflow_dispatch` only.
4. `APP_VERSION` (`src/constants/appVersion.ts:34`) is the product version and may carry an `R<n>` suffix; `scripts/derive-store-version.mjs:63` strips it for the stores. The floor compares product versions.
5. `isNative()` and `getPlatform()` (`src/services/sync/capabilities.ts:46, 52`) are the platform tests; `Capacitor.isNativePlatform()` is confined to that file by an explicit convention (`:38-48`). `usePwaUpdater` returns early on the native platform (`:116`).
6. The fatal overlay CANNOT carry an action today. Verified: `fatalErrorStore` holds `message`/`detail`/`clearDataHelps` only (`src/stores/fatalErrorStore.ts:22-60`) and `App.vue` hardcodes Reload and Clear data (`:1885-1900`). R3.3 specifies the addition; it is three small edits to two existing files, not a new component.
7. The apex serves no CORS headers, so cross-origin `fetch()` from the app origin to `beanies.family` is refused. Verified by absence: no `response_headers_policy` or `Access-Control-*` in `infrastructure/modules/frontend/` or `infrastructure/modules/web/`. R4.3 routes around it with `CapacitorHttp`.
8. `App.addListener('resume', ...)` is the established native resume signal in this repo (`src/services/share/iosShareAdapter.ts:100`), and `@capacitor/app` is already a dependency.

## Approach

The shape is: one composable, two triggers, two existing surfaces (one of which gains a small action affordance), one new pure comparison function, one static file.

1. **The pure parts first**, because they are the testable core: a version comparison in `src/utils/compareAppVersions.ts`, and the floor fetch-and-parse with its fail-open contract in `src/services/appUpdate/minVersion.ts`. The comparison is pure and knows nothing about Capacitor; the floor module owns the transport but exposes a plain `Promise<string | null>` so its callers and its tests never touch the plugin.
2. **The overlay affordance**, because it is the one thing that does not exist yet and everything in R3 depends on it: `FatalAction` on the store, the primary button and the caption in `App.vue`. Small enough to land and test on its own.
3. **The composable**, which wires the plugin to those parts and to the two existing surfaces. Native-only, singleton, inert on web, with a cached dynamic plugin import.
4. **The force trigger**, attached inside `surfacePayloadFatal`, so no new classification is invented and no second `needsAppUpdate` reader appears.
5. **The plugin and native config**, last, because it is the only part that cannot be exercised locally, and because R2.1's availability question should be settled before the native projects are touched.

**DRY, with the sites verified.** The prompt is `confirm()` (`src/composables/useConfirm.ts:56`). The block is `setFatal` (`src/stores/fatalErrorStore.ts:38`) reached through the single chokepoint `surfacePayloadFatal` (`src/utils/payloadFailureSurface.ts:148`). The "is this because the app is old" question is `PayloadLoadError.needsAppUpdate` (`src/types/sync.ts:328`, overridden at `:404`) read through `payloadErrorKind` (`:470`). The quiet predicate is `usePwaUpdater`'s, moved verbatim to `src/utils/appQuiet.ts` and imported by both. The resume signal is `@capacitor/app`'s `resume`, per `iosShareAdapter.ts:100`. The online signal is `useOnline()`. The "app is past boot" signal is `isLoaded()`, per `waitForDocLoaded.ts:12`. The store-link constant sits beside `MARKETING_URL`. The copy leans on the four existing `newerVersion` registers. The only genuinely new code is the version comparison, the floor fetch, the `FatalAction` field, and the composable that joins them.

**Error handling: every path, named, with its handler.** Nothing in this feature is `critical`, by construction, because not being on the newest app version is not an incident. Nothing is swallowed either.

| #   | What can fail                                                                                                                             | Handling                                                                                                                                                                                                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | The plugin module is absent from this build (dynamic `import()` rejects)                                                                  | Caught at the cached-import boundary; `logEvent` `check-failed` with `error_code: 'plugin-missing'`; the composable degrades to floor-only behaviour and the block's store URL. Never rethrown into `App.vue` setup.                       |
| 2   | `getAppUpdateInfo()` throws or the device is offline                                                                                      | Caught; `check-failed` with a reason class in `detail`, never the raw error text; no prompt, no block.                                                                                                                                     |
| 3   | `startFlexibleUpdate()` / `completeFlexibleUpdate()` / `performImmediateUpdate()` rejects (user cancelled Play's sheet, Play unavailable) | Caught; `update-failed` at `warn` carrying whether it was a cancel; on the PROMPT path the sheet simply does not return, on the BLOCK path the store URL is already on screen.                                                             |
| 4   | The Android download-state listener throws or leaks                                                                                       | The handler body is wrapped; the listener handle is removed in `onScopeDispose` (R1.5).                                                                                                                                                    |
| 5   | `openAppStore()` rejects                                                                                                                  | Caught; `store-open-failed` at `warn`; a toast points at the URL that is already visible in `fallbackText`. **No `openExternal` retry**: it must run inside the gesture (`src/utils/openExternal.ts:18-20`) and by then we are outside it. |
| 6   | The floor request fails (offline, timeout, non-200, CORS, DNS)                                                                            | Caught inside `minVersion.ts`; returns `null`; `check-failed` at `warn` with the class in `detail`; **fails open** (no prompt, no block).                                                                                                  |
| 7   | The floor body is malformed (not JSON, wrong shape, `minSupportedVersion` not a version-shaped string)                                    | Same as 6, with a distinct `detail` class so a bad deploy is distinguishable from a bad network.                                                                                                                                           |
| 8   | `compareAppVersions` is handed a string it cannot parse (either side)                                                                     | Returns a sentinel the caller reads as "cannot decide", which fails open. It never throws; a pure comparison that throws would turn a typo in a static file into a crash.                                                                  |
| 9   | `isAppQuiet()` runs before Pinia is ready                                                                                                 | Already handled by the moved code: `try/catch` returning `false` (`usePwaUpdater.ts:47-51`). Verbatim move preserves it.                                                                                                                   |

No bare `catch {}` anywhere. Every catch either emits a `logEvent` on the `app-update` surface or, where a moved line already had a documented reason to be silent, keeps that reason in the comment.

## Files Affected

- `src/composables/useAppUpdate.ts` (new)
- `src/utils/compareAppVersions.ts` (new) and `src/utils/__tests__/compareAppVersions.test.ts`
- `src/services/appUpdate/minVersion.ts` (new: `CapacitorHttp` fetch, parse, fail open) and its test
- `src/utils/appQuiet.ts` (new: `isAppQuiet()`, moved verbatim from `usePwaUpdater`)
- `src/composables/usePwaUpdater.ts` (delete the local `isQuiet`, import `isAppQuiet`)
- `web/public/min-app-version.json` (new)
- `package.json`, `android/`, `ios/` (plugin install and `npx cap sync`). **Not** `capacitor.config.ts`: no `CapacitorHttp` patch, no plugin config needed.
- `src/stores/fatalErrorStore.ts` (optional `action: FatalAction | null`, `markRaw`'d, cleared by `clear()`)
- `src/App.vue` (render the action button and the `fallbackText` caption in the existing action row, `:1884-1900`)
- `src/utils/payloadFailureSurface.ts` (attach the action for `needs-update` on native, inside `surfacePayloadFatal`)
- `src/types/sync.ts` (`appVersion` in `payloadErrorDetail`)
- `src/utils/marketing.ts` (the store-link constant)
- `src/services/translation/uiStrings.ts`, `public/translations/zh.json`
- `src/content/help/how-it-works.ts` (the `family-file-newer-version` article at `:5`; the Astro site renders the same source via `@/content/help`, see `web/src/pages/help/[category]/[...slug].astro:11`, so one edit covers both surfaces)
- `docs/runbooks/` (a new short runbook, or a section in `native-store-submission.md`, for raising the floor)
- `docs/STATUS.md`, `CHANGELOG.md`

## Help Center Coverage

- **Action**: update existing
- **Category**: how-it-works
- **Slug**: `family-file-newer-version` (added 2026-09-06, `src/content/help/how-it-works.ts:5`)
- **Title**: unchanged
- **Scope**: the article already tells someone on an old version what the message means and that updating is the fix. Add a short paragraph saying beanies will now offer to update the app itself on iPhone and Android, and that it will insist only when the family file cannot be opened without it.
- **Notes**: must not imply the app can update itself on iOS; it opens the App Store. Must not suggest clearing data. Bump `updatedDate`. The existing "What to do" steps (`:33-38`) stay correct as written and should not be rewritten.

## Observability Coverage

- **Events**, all on surface `app-update`:
  - `checked` (info): `action: 'checked'`, `detail: available=<bool>,platform=<ios|android>`. The denominator for everything else.
  - `prompted` / `prompt-dismissed` / `update-started` / `update-completed` (info): the funnel, so "how fast does the fleet drain" is answerable.
  - `blocked` (warn): `action: 'blocked'`, `error_code: 'needs-update'`. A person who cannot use the app until they update is worth counting, and `warn` reaches CloudWatch without paging.
  - `update-failed` (warn): the Play flow rejected, with cancel-versus-error in `detail`.
  - `store-open-failed` (warn) and `check-failed` (warn): the two ways this feature degrades. `check-failed` carries the reason class in `detail` (`plugin-missing` / `offline` / `timeout` / `http-<status>` / `malformed` / `unparseable-version`), never the raw error text.
- **Failure modes covered**: rows 1 through 8 of the error table each map to one of the events above; row 9 is pre-existing behaviour with its own comment.
- **The floor's fail-open is deliberately visible.** Because it fails open, a permanently broken floor looks exactly like a healthy fleet unless the failure is counted. `check-failed` with a `malformed` or `http-404` class is what turns "the floor never fires" into an answerable question, and it is why R4.3's transport matters: a CORS refusal would otherwise be an invisible constant.
- **Success-path signal**: `checked` fires whether or not an update exists, so the rate is measurable rather than only the failures.
- **Critical vs telemetry**: nothing here pages. Not being on the newest app version is not an incident, and a `critical` on it would train the alert to be ignored. This matches the existing row reasoning for `needs-update` in `PAYLOAD_IS_INCIDENT` (`src/utils/payloadFailureSurface.ts:81, 85`).
- **Privacy / store gate**: no new context key. `action`, `error_code`, `detail`, `family_id` and `build_sha` are already in `ALLOWED_CONTEXT_KEYS` (`src/utils/diagnosticContext.ts:61-190`; `detail` at `:185`, `build_sha` at `:98`), so no `native-store-submission.md` data-collection update is required, and none may be made. The platform rides inside `detail` as a fixed enum rather than as a new `platform` key, deliberately.

## Acceptance Criteria

- [ ] On web, nothing changes: `useAppUpdate` is inert, `usePwaUpdater` is the only updater, and the fatal overlay renders byte-identically to today (no action attached).
- [ ] `isAppQuiet()` is a verbatim move; `usePwaUpdater` has no local copy and its existing tests pass untouched.
- [ ] On native, a newer store version produces one dismissible prompt per session, never while offline, mid-save, with an overlay open, or before `isLoaded()`.
- [ ] Android takes the flexible flow; iOS opens the App Store. Neither claims the other's behaviour in copy.
- [ ] `UnsupportedBeanpodVersionError` on native raises the block through the existing `surfacePayloadFatal`, with `clearDataHelps: false` and a working store action. No second `needsAppUpdate` reader was added.
- [ ] The block is never a dead end: the store URL is on screen as selectable text unconditionally, outside the `<details>` disclosure, whether or not the store opens.
- [ ] `setFatal`'s new `action` is optional, `markRaw`'d, cleared by `clear()`, and every existing caller compiles unchanged.
- [ ] `payloadErrorDetail` carries `appVersion`, and the block's copyable diagnostic shows both the running version and the file's version.
- [ ] **The floor is proven to LOAD on a real device**, not merely to fail open: a device build reads `min-app-version.json` from the apex and logs `checked`. Failing open on a CORS refusal must not be mistaken for passing.
- [ ] The floor fails open on every error class (offline, timeout, 404, malformed JSON, wrong shape, unparseable version), asserted for each, each with its own `check-failed` class in `detail`.
- [ ] The version comparison orders `0.9 < 0.16 < 0.16.1 < 0.17` and `0.15 < 0.15R1 < 0.15R2`, returns "cannot decide" rather than throwing on garbage, with tests.
- [ ] The floor compares product versions, so `0.15R2` is not treated as `0.15`.
- [ ] `capacitor.config.ts` is unchanged; the global `CapacitorHttp` patch is NOT enabled.
- [ ] No `Capacitor.isNativePlatform()` outside `src/services/sync/capabilities.ts`.
- [ ] The store URL exists once in `src/`, beside `MARKETING_URL`.
- [ ] Every new string has `en` and `beanie`, `beanie` in plain English, and `npm run translate` is clean.
- [ ] Help Center article updated per the section above, with `updatedDate` bumped.
- [ ] Diagnostic logging implemented and verified; no new context key; no bare `catch {}` anywhere in the new code.
- [ ] Full gate green (`npm run validate`); every new test mutation-checked against the regression it pins.

## Testing Plan

1. **Unit, pure**: the version comparison across the orderings above plus malformed input on either side; the floor's fail-open for each error class with the right `detail` class; `isAppQuiet()` returning `false` when the store is not ready.
2. **Unit, composable**: `useAppUpdate` is inert on web (no plugin import evaluated, which is directly assertable because the import is dynamic); the session flag suppresses a second prompt; the prompt is suppressed for each of the four gates independently (offline, not quiet, overlay open, doc not loaded).
3. **Unit, block**: `surfacePayloadFatal` attaches an action for `needs-update` on native and attaches none for `needs-update` on web, and none for any other kind on either platform. This is the regression that keeps the web overlay unchanged.
4. **Component**: the fatal overlay renders the action as the primary button with the caption beneath it when `action` is set, and renders exactly as today when it is not; `ConfirmModal` shows "Update" / "Not now" with the info variant.
5. **Manual, native, the part CI cannot fake**: an Android build installed through internal app sharing with a higher `versionCode` available, exercising both the flexible prompt and the immediate flow; an iOS build confirming the sheet opens the App Store listing.
6. **Manual, the force path**: hand-edit a family file to a version this build does not know (the fixture at `/tmp/gp-test-family.beanpod` is the obvious base), open it on a native build, and confirm the block appears, is not dismissible, offers a working store link, and shows the URL as text.
7. **Manual, the floor, both directions**: confirm it LOADS on a device (criterion above) with the network panel or a `checked` event, then deliberately break it (404 it, malform it, take the device offline) and confirm the app is completely unaffected and each break produces its own `check-failed` class.

## Review Passes

- **Pass 1 (Initial draft)**: drafted from greg's two decisions and the verified platform research; both UI surfaces mapped onto existing components so no new UI is designed.
- **Pass 2 (DRY + error handling)**: verified every reuse claim against the code. Found and fixed three substantive defects: the fatal overlay cannot carry an action today (`fatalErrorStore.ts:22-60`, `App.vue:1885-1900`), so R3.3 now specifies the smallest honest addition; the floor's `fetch()` would be CORS-refused on every device and silently fail open forever (no `response_headers_policy` in `infrastructure/modules/frontend|web/`), so R4.3 now specifies `CapacitorHttp`; and the force "dispatch site" already exists as `surfacePayloadFatal` (`payloadFailureSurface.ts:148-174`), so R3 attaches to it rather than adding a second `needsAppUpdate` reader. Also corrected the platform test to `isNative()` per `capabilities.ts:38-48`, deduplicated the store URL to one constant, pinned the prompt behind `isLoaded()` because `ConfirmModal` is `z-[250]` under a `z-[300]` boot overlay, ruled out `openExternal` as a post-await fallback (`openExternal.ts:18-20`), and replaced the single error-handling paragraph with a nine-row table.
- **Pass 3 (Sustainability)**: _pending_
- **Pass 4 (Fresh-eyes sweep)**: _pending_

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial prompt

> one last thing before we move onto the code review - we forgot to add it to the plan, but we need to add the code / packages so that we can force and/or prompt both android and ios users to update the app when needed. i believe previously it was mentioned that this is a capcitor package we need to add, and on ios also some code to check if the user is on the latest version. wherever possible, we should ask the user to install the latest version of the app. can we add that directly, or should we run it through another set of plans?

### Follow-up 1 (answering the two questions raised before planning)

> Regarding your questions above:
>
> 1. Let's start with a prompt and force when needed as per your recommendations. agree that a force update should be used to ensure apps can read the new v5 beanpod
> 2. agree

### Context from the same session

> go ahead to run the code review against all code implemented in this session [...] once the code reviews and fixes are complete, run /beanies-plan as per the instructions above to build the plan for implementation of the force update for both android and ios apps. [...] once the plan is complete, proceed to implement as per the plan.

### Pass 2 review prompt

> Review the plan again to make sure you are implementing in the most optimal and efficient way, striving for elegance and simplicity, capturing ALL errors and never letting anything fail silently, and following all DRY principles - you are not re-writing or repeating any code. [...] Rewrite the plan ensuring that the design and flow and functionality is implemented in the simplest and most efficient/optimized way without any duplication, silent failures, overly complicated flows, or code bloat where not necessary.

</details>
