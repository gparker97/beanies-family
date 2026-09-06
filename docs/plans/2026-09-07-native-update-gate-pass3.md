## Pass 3 changes

- **The plugin is demoted out of the critical path: the plan is now Phase A (no new dependency) and Phase B (the Play plugin, separately decidable).** Everything the user asked for, prompt and force on both platforms, is reachable with zero third-party plugins: `https://apps.apple.com/app/id6798513944` and `https://play.google.com/store/apps/details?id=family.beanies.app` deep-link into the store app on their own platforms, and `openExternal` already opens external links from inside the native shell today (`src/utils/openExternal.ts:24`, used on every platform at `src/components/common/AppHeader.vue:190`). The plugin then buys exactly one thing, Play's flexible and immediate in-app flows on Android. Pass 2 had the degrade path as a written promise in a Caveat; making it the DEFAULT path is the only version of that promise which survives a plugin going unmaintained, sponsorware, or a Capacitor major behind.
- **The fatal-overlay action becomes DATA, not a closure.** Pass 2's `FatalAction = { labelKey, run: () => void, fallbackText? }` (Pass 2 R3.3) is replaced by `{ labelKey: UIStringKey; url: string }`. Four verified reasons: `payloadFailureSurface.ts` today imports only stores, types and `errorReporter` (`src/utils/payloadFailureSurface.ts:22-28`), and handing it a closure would make the app's single payload chokepoint import the update composable and through it a native plugin; a function in Pinia needs `markRaw` plus `shallowRef` ceremony, is opaque in devtools, and retains its closure scope; `run` and `fallbackText` are two independent fields that can point at different places, whereas one `url` rendered by both the button and the caption cannot diverge; and `openExternal` must be called synchronously inside the gesture (`src/utils/openExternal.ts:18-20`), which a `url` in the template satisfies naturally instead of as a caveat.
- **`App.vue` must not gain a fourth mirrored ref.** Verified: `App.vue:212-222` mirrors the store into local refs through a hand-maintained tuple, and `initError` / `initErrorDetail` are ALSO written directly by `setGenericInitError` (`:234-243`). Worse, the watcher only fires `if (msg)` (`:215`), so `clear()` does not reset the mirrors and a mirrored action would outlive the fatal state that justified it. R3.3 now reads the action as a `computed` straight off the store, and states plus tests the invariant that makes that safe: an action can only exist when `fatalErrorStore.message` exists, because `setFatal` is its only writer and `setGenericInitError` refuses to run when the store already has a message (`:240`).
- **`mustUpdate` and `requireUpdate(reason)` are deleted from the composable API.** R3 puts the force inside `surfacePayloadFatal`, so `requireUpdate` would have had zero callers on day one: an unreachable force entry point is the same shape as the unreachable safety-net branch this repo has been bitten by. The composable drops from six members to three plus the test reset.
- **The floor can only ever PROMPT; it is structurally incapable of blocking, and the JSON field is renamed to say so.** `minSupportedVersion` reads like a kill switch, and one day someone will wire it to one. It becomes `promptBelowVersion`. This is the direct answer to the operational-cost question: with force confined to `UnsupportedBeanpodVersionError`, a fat-fingered floor deploy's worst case is an unnecessary but dismissible nag, not a lockout, so the manual static-file deploy no longer needs to be safe, it is safe.
- **The floor's operating instructions go in the three places the person raising it already looks**, not a new orphan runbook: a section in the existing `docs/runbooks/native-store-submission.md`, a pointer comment in `src/constants/appVersion.ts` beside the bump they make on every release (its header already carries release-time warnings of exactly this kind, `:24-35`), and a `_docs` field inside the JSON itself. The runbook also says that a normal release does NOT raise the floor.
- **Device HTTP cache is called out, and so is the trap in fixing it.** `aws s3 sync` sets no `Cache-Control` (`.github/workflows/deploy-web.yml:71`) and the apex behaviour is `default_ttl = 86400` (`infrastructure/modules/frontend/main.tf:141`), so a device can hold a stale floor for a day after the `/*` invalidation (`:74-77`) has cleared the edge. R4 adds an hour-bucket query parameter for the device cache, and states the non-obvious half: `forwarded_values { query_string = false }` (`main.tf:133-137`) means that parameter does NOT vary the CloudFront cache key, so it is not a way to bust the edge and nobody should try.
- **The plugin boundary is enforced by lint, not by a comment.** `eslint.config.js` already carries two `no-restricted-imports` zones of exactly this kind, for the lineage guard (`:386-398`) and the beanie wall's finance exclusion (`:428-447`), the second with a header explaining why a lint zone beats a bespoke import-graph test. Phase B adds a third zone so only `src/services/appUpdate/playStoreUpdate.ts` may name the plugin package, plus a `no-restricted-globals` zone banning `fetch` inside `src/services/appUpdate/` so the CORS transport rule is enforced rather than commented. The adapter shape mirrors `src/services/share/` (`types.ts`, per-platform adapters, an `index.ts` registry, `src/services/share/index.ts:1-22`).
- **The store URLs collapse from five copies to one.** Pass 2 added a fifth (a new constant in `src/utils/marketing.ts`) and left four literals alone. `packages/brand/nav.ts` already holds `SITE_URL` and `APP_URL` (`:38, 41`), the same class of fact, and is already a root dependency (`package.json:55`) that `src/style.css:2` and `web/src/pages/download.astro:12` both consume. The constants move there, `src/` and the three Astro pages import them, and only the frozen release-note prose (`src/content/release-notes/deploys.ts:601`) keeps its literal.
- **`compareAppVersions` returns `-1 | 0 | 1 | null`**, where `null` means "cannot decide". Pass 2 said "a sentinel"; under `strict: true` (`tsconfig.app.json:12`) a nullable return forces every caller to handle the undecidable case, where a numeric sentinel would silently read as "equal" and quietly change behaviour.
- **The platform-to-store-URL mapping is a frozen record keyed on `getPlatform()`'s union, `satisfies Record<'ios' | 'android', string>`**, not an if/else, so a third native platform fails the build instead of falling through to no link. This is the repo's established habit and its stated reason (`payloadFailureSurface.ts:61-67`, "a sixth kind fails the build here rather than taking a silent default").
- **One prompt, one copy, two triggers, said explicitly.** Pass 2 left it ambiguous whether the floor and the store-freshness check raise different sheets. They do not. The JSON's `reason` string is deliberately never rendered: it would be untranslated English on a Chinese device and would bypass `uiStrings` entirely. It exists for the person editing the file and for telemetry.
- **`@capacitor/browser` is explicitly ruled out for the store link**, with the reason, because it is already a dependency (`src/services/google/googleAuth.ts:33`) and is the obvious wrong reach: an in-app SFSafariViewController renders the store's WEB page instead of handing off to the store app.
- **The mock-hides-the-real-thing risk is named and answered**: a unit test mocking the adapter proves nothing about the plugin, so the plugin's contract is pinned by `npm run type-check` against the real types (no `any`, no `as unknown as` in the adapter), and the one thing no mock can prove, that the floor loads over the wire, is an on-device criterion backed by a fleet-wide `checked` event carrying `floor=<value|none>`.

---

# Plan: Ask people to update the app, and require it when their family file needs it

> Date: 2026-09-07
> Related issues: None, direct implementation
> Plan file: `docs/plans/2026-09-07-native-update-gate.md` (Pass 3 output: `docs/plans/2026-09-07-native-update-gate-pass3.md`)
> Follows: `docs/plans/2026-09-06-compacted-pod-v5.md`, whose Caveats deferred this ("Force-update on native is a follow-up, not this plan", `:351`)
> Platform research verified 2026-09-07; URLs in Assumptions

> **No GitHub issue created.** This plan was approved for direct implementation.

> **No mockup.** Both surfaces reuse existing components rather than inventing UI: the prompt is `confirm()` (`src/composables/useConfirm.ts:56`), the block is the existing fatal overlay (`useFatalErrorStore.setFatal`, `src/stores/fatalErrorStore.ts:38`, rendered by `src/App.vue:1849-1948`). One small, named addition is required to the overlay (an optional action link, R3.3); nothing new is designed, so there is nothing to mock up.

## User Story

As someone using beanies on a phone or tablet, I want the app to tell me when a newer version is available, and to insist when my family's file genuinely needs it, so that I am never quietly cut off from my own family's data without knowing why or what to do about it.

## Context

Compacted family files are written as beanpod 5.0 (ADR-036 addendum). A build that predates that format refuses the file at parse and stops syncing. On the web that heals itself: `usePwaUpdater` polls the service worker every five minutes and applies the new build on the next quiet navigation (`src/composables/usePwaUpdater.ts:135-151`). On iOS and Android it does not, because `usePwaUpdater` returns early on the native platform test (`:116`) and no service worker is registered natively (ADR-029). A native device therefore stays on whatever build the store last installed, and beanies has no way to ask it to move.

Today that is survivable rather than dangerous: the 5.0 format means a stale device cannot merge across lineages, so it cannot corrupt the family. It is only cut off, and it says so through `podNewerVersion.inline` and its three sibling registers (`src/services/translation/uiStrings.ts:4377-4404`). But "only cut off" is still a person who cannot see their family's calendar, whose only current remedy is that somebody tells them.

**This plan is honest about what it does not do: it does not help anyone who is stale today.** They are on 0.16 (`src/constants/appVersion.ts:34`), which contains none of this code. This is insurance for the _next_ format change and for the ordinary case of a device drifting behind. Anyone stale right now still has to be told by their family, exactly as the compaction notice says.

Two questions have to be answered separately, because they have different sources and very different consequences:

1. **Is there a newer version?** We answer it from a static file we control, and optionally from the store itself. This drives a PROMPT.
2. **Is this version too old to keep working?** No store and no static file can answer that; it is a fact about the file in front of this device. Only `UnsupportedBeanpodVersionError` knows it. This drives a FORCE, and greg's instruction is that force is reserved for exactly this.

**The load-bearing consequence of that split, and the spine of this plan: the only thing that can ever block a person is a file they actually tried to open.** Nothing we deploy, mistype, or forget can lock anyone out. That property is what makes the rest of the design cheap.

## Requirements

### R0. Two phases, and Phase A ships alone

**Phase A takes no new dependency.** A plain https store URL deep-links into the App Store on iOS and the Play Store on Android, and `openExternal` (`src/utils/openExternal.ts:24`) already opens external links from inside the native shell on every platform today (`src/components/common/AppHeader.vue:190` does exactly this for `/help`). So the whole product requirement, a prompt when there is something newer and a block with a working way out when the file cannot be read, is reachable with the code already in this repo plus one static file.

**Phase B is Play's in-app update flow, and it is optional in the real sense**: if `@capawesome/capacitor-app-update` turns out to be sponsorware, unmaintained, or a Capacitor major behind, Phase A is unchanged and nothing needs rewriting. Phase B must not be started until Phase A is merged and green.

This ordering is not caution for its own sake. Pass 2 carried the degrade path as a Caveat, a sentence promising that things would still work. Phase A makes it the code that actually runs.

### R1. One composable owns the prompt, and it is native-only

1. `src/composables/useAppUpdate.ts` is the single place that decides whether to nag. It exposes exactly `{ updateAvailable, checkForUpdate(), maybePrompt() }` plus `__resetAppUpdateForTesting()`.
   - **There is deliberately no `mustUpdate` and no `requireUpdate()`.** The force lives entirely in `surfacePayloadFatal` (R3), so a force entry point here would have zero callers on the day it was written. An unreachable branch that looks like a safety net is worse than no branch: it reads as covered.
2. It is inert on web, mirroring `usePwaUpdater`'s early return in the other direction, so exactly one updater is live per platform and neither has to know about the other. State this in the file header, with a pointer each way. **The platform test is `isNative()` / `getPlatform()` from `src/services/sync/capabilities.ts:46,52`, never `Capacitor.isNativePlatform()` directly**: that file states it "is the ONE place `Capacitor.isNativePlatform()` is allowed to appear" (`:38-48`), and the whole point of the seam is that a future Capacitor major is a bounded change.
3. Singleton with a detached `effectScope`, the shape `usePwaUpdater` (`:118-157`) and `useStaleTabRefresh` already use, and for the same reason. `__resetAppUpdateForTesting()` is the twin of `__resetPwaUpdaterForTesting` (`usePwaUpdater.ts:164-171`) so unit tests can re-initialise between cases.
4. Every listener it registers (the `resume` listener in R2.1, and in Phase B the Android download-state listener) is removed in `onScopeDispose`. A leaked native listener is a silent failure with a long fuse.
5. **Phase A registers no plugin at all.** In Phase B the plugin is reached only through the adapter in R6, loaded by a cached dynamic `import()` inside the native branch, never a top-level import: the web bundle and every web unit test then never evaluate a native plugin module, and "the plugin is not installed in this build" becomes a rejected promise this code catches rather than a module-evaluation crash that takes `App.vue` setup with it.

### R2. The prompt: one sheet, one copy, two triggers

1. Checked on launch and on resume. **Resume is `App.addListener('resume', ...)` from `@capacitor/app`**, which is already a dependency and already used exactly this way at `src/services/share/iosShareAdapter.ts:100`. Do not add a poll: there is no cadence question here, only "the app came back".
2. **Trigger one (Phase A, the only one that has to exist): the floor.** `compareAppVersions(APP_VERSION, promptBelowVersion) === -1` means this build is behind what we have asked people to be on. **Trigger two (Phase B): the store's own answer.** `getAppUpdateInfo()` reports an update is available.
   - **Both triggers raise the SAME sheet with the SAME keys.** There is one thing to translate, one thing to review, and one thing to change. If they ever need to say different things, that is a product decision to be made deliberately, not a shape to leave open.
   - **The JSON's `reason` string is never rendered.** It would be untranslated English on a Chinese device and would bypass `uiStrings` entirely, which the i18n rule forbids. It exists for the person editing the file and for the `checked` telemetry.
3. Reuse `confirm()` for the sheet: `variant: 'info'`, `showCancel: true`, a `confirmLabel` of "Update" and a `cancelLabel` of "Not now". Do not build a new modal. Note the signature (`src/composables/useConfirm.ts:6-23`): `title`, `message`, `confirmLabel` and `cancelLabel` are all `UIStringKey`, and only `detail` is a plain string, so the prompt's copy must be real translation entries (R5) and cannot be assembled at the call site. `variant: 'info'` already renders the Heritage Orange squircle with the `info` glyph and an orange confirm button (`src/components/ui/ConfirmModal.vue:28, 31, 75`), which is the correct register: this is a routine alert, and Alert Red is reserved for destructive confirmations.
4. Confirming the sheet calls `openExternal(STORE_URL[getPlatform()])` synchronously in the confirm handler (Phase A), or hands off to Play's flexible flow (Phase B, Android only). `openExternal` is the right helper and must be called inside the gesture (`src/utils/openExternal.ts:18-20`).
   - **Not `@capacitor/browser`**, though it is already a dependency (`src/services/google/googleAuth.ts:33`) and is the obvious reach. `Browser.open()` presents an in-app SFSafariViewController, which renders the store's WEB page rather than handing off to the store app.
5. Dismissible, and it stays dismissed for the session. A nag on every launch teaches people to dismiss without reading, which is exactly the reflex the FORCE case needs them not to have. **The flag is a module-level boolean inside the singleton.** It must die with the process, which is precisely what a module boolean does; do not reach for `createPerMemberStore` (`src/composables/perMemberStore.ts`), which is per-member localStorage with its own write-failure surface and would be the wrong lifetime as well as more code.
6. Never shown when offline, mid-save, with an overlay open, or before the app is past boot.
   - The first three: **extract `isQuiet` verbatim** from `src/composables/usePwaUpdater.ts:44-52` (it is genuinely not exported today) into `src/utils/appQuiet.ts` as `isAppQuiet()`, and import it from both. Verbatim, so web behaviour cannot shift as a side effect; it keeps its `try/catch` returning `false` when the store is not ready.
   - Offline: `useOnline().isOnline` (`src/composables/useOnline.ts:21`).
   - Past boot: `isLoaded()` from `@/services/automerge/projection:36`, the same signal `waitForDocLoaded` (`src/composables/waitForDocLoaded.ts:12`) reads. This one is not optional. `ConfirmModal` renders at `layer="top"`, which is `z-[250]` (`src/components/ui/BaseModal.vue:36`), while the boot spinner and the fatal overlay are both `z-[300]` (`src/App.vue:1842, 1851`); a prompt raised during boot would be an open modal nobody can see or dismiss, holding `hasOpenOverlays()` true for the rest of the session.

### R3. The force: the app's own answer, from the failure that actually happened

1. The authoritative trigger is `UnsupportedBeanpodVersionError` (`src/types/sync.ts:390-412`), which already answers `needsAppUpdate` (`:404`) and already reaches every surface through `payloadErrorKind` (`:470-475`). When it fires on native, the app genuinely cannot do its job for this family, and the update stops being a suggestion. **It is the only thing in this plan that can block anyone.**
2. **The block already exists; only its action is missing.** `surfacePayloadFatal` (`src/utils/payloadFailureSurface.ts:148-174`) is documented as "THE one place a payload failure becomes the fatal overlay" (`:1-21`), and it already resolves `needs-update` to `resumeSetup.podNewerVersion` through the `PAYLOAD_OVERLAY_KEY` table (`:61-67`) and already passes `clearDataHelps: false` (`:172`). So this requirement adds NO new classification and NO second `needsAppUpdate` reader: it attaches the action inside that one function, gated on `isNative()` and on `payloadErrorKind(err) === 'needs-update'`. Everything else about the overlay is unchanged.
3. **The overlay needs one small, named addition, and the addition is DATA.** `fatalErrorStore` exposes only `message`, `detail` and `clearDataHelps` (`src/stores/fatalErrorStore.ts:22-60`), and `App.vue` hardcodes exactly two buttons, Reload and Clear data (`:1885-1900`).

   ```ts
   export interface FatalActionLink {
     labelKey: UIStringKey;
     /** http(s) only; rendered as the primary button AND as selectable text. */
     url: string;
   }
   ```

   - **Not a callback.** Pass 2 proposed `run: () => void` held in a `shallowRef` and `markRaw`'d. A URL is better on every axis that matters later:
     - `payloadFailureSurface.ts` today imports stores, types and `errorReporter` and nothing else (`:22-28`). A callback would make the app's single payload chokepoint import the update composable, and through it a native plugin. A `url` makes it import one constant.
     - A function in a Pinia store is opaque in devtools, unserialisable, needs `markRaw` ceremony to stop Vue proxying it, and holds its closure scope alive for as long as the fatal state does.
     - `run` and `fallbackText` were two independent fields; nothing stopped the button and the caption pointing at different places. **One `url` rendered by both makes that divergence structurally impossible**, which is the whole point of R3.4.
     - `openExternal` must run synchronously inside the originating gesture (`src/utils/openExternal.ts:18-20`). With a `url` in the store, `App.vue`'s click handler calls it directly, which is the documented correct usage rather than a caveat to remember.
   - `setFatal` gains a fourth option, `action?: FatalActionLink | null`, held in a plain `ref` and cleared by `clear()` alongside the other three fields.
   - **`App.vue` reads it as a `computed`, NOT as a fourth mirrored ref.** `App.vue:212-222` mirrors the store into local refs through a hand-maintained tuple, and `initError` / `initErrorDetail` are also written directly by `setGenericInitError` (`:234-243`); the tuple is a known drift surface and must not grow. Worse, the watcher only fires `if (msg)` (`:215`), so `clear()` never resets the mirrors and a mirrored action would outlive the fatal state that justified it. A `computed(() => fatalErrorStore.action)` cannot.
     - **The invariant that makes the computed safe, stated here and pinned by a test:** an action can only be non-null when `fatalErrorStore.message` is non-null, because `setFatal` is its only writer and `setGenericInitError` returns early when the store already carries a message (`:240`). So an action can never be rendered beside a message it does not belong to.
   - `App.vue` renders the action as the PRIMARY button at the head of the existing action row (`:1886-1900`), demoting Reload to the secondary slot it already occupies visually. Clear data stays hidden by the existing `initErrorClearHelps` guard. Reload keeps its place because it is not a lie (it does reload) and it is exactly what a person does after returning from the store.
   - The same `url` renders directly under the row as a selectable caption. This is what makes R3.4 true. Putting the URL in `detail` would NOT satisfy it: `detail` lives inside a collapsed `<details>` block (`:1927-1936`).
   - No new component. Two small additions to two existing files, plus one line in the template.

4. **Never a dead end.** The `url` caption is unconditional, not shown only after a failure, because an external open can resolve while nothing visibly happens, so "show it on failure" has no reliable trigger. The on-screen text is the guarantee; the button is the convenience.
5. **Play's `performImmediateUpdate()` is deliberately NOT the block's action**, even in Phase B. On the block path the person is already stopped and a store page is a complete recovery; buying a slightly slicker transition by putting a plugin-backed closure into global fatal state is the wrong trade for the app's single payload chokepoint. Phase B's in-app flow stays on the PROMPT path, where the composable already owns the plugin. Record this as a decision, so a future reader does not "finish the job" by reintroducing the coupling.
6. The diagnostic must carry the running version. Add `appVersion: APP_VERSION` to `payloadErrorDetail` (`src/types/sync.ts:507-528`). It has exactly one consumer (`src/utils/payloadFailureSurface.ts:171`), no test pins its shape, `formatDeviceInfo` does not carry the product version (`src/utils/diagnostics.ts:103-113`), and every payload-failure support conversation wants it. The family id and the file's own version are already there (the latter through `err.message`, which `UnsupportedBeanpodVersionError` clamps to `/^[\w.+-]{1,16}$/` at construction, `src/types/sync.ts:396`).
7. Native only. On web the service worker has already handled it, and blocking a browser tab that can update itself would be gratuitous. Concretely: `surfacePayloadFatal` attaches the action only when `isNative()`, so the web overlay is byte-identical to today.
8. Out of scope, deliberately: the join-flow's `FILE_NEWER_VERSION` (`src/utils/podAccess.ts:46, 103`) and `join.error.newerVersion` (`src/composables/useJoinFlow.ts:222`) keep `recoveries: []` and gain no button. A person mid-join is not locked out of their own data; they update and open the link again, which is what the copy already says.

### R4. The floor: a file we control, that can only ever nag

1. `web/public/min-app-version.json`, served at `https://beanies.family/min-app-version.json`:

   ```json
   {
     "promptBelowVersion": "0.16",
     "reason": "Not rendered. For whoever edits this file, and for telemetry.",
     "_docs": "docs/runbooks/native-store-submission.md#raising-the-update-floor"
   }
   ```

   `web/public/` exists and its contents reach the apex unchanged (`robots.txt`, `llms.txt`, `sw.js` and friends are already there).

2. **The field is `promptBelowVersion`, not `minSupportedVersion`, and the difference is the whole safety argument.** A field called `minSupportedVersion` reads like a kill switch, and sooner or later somebody will wire it to one; naming it for what it does removes the invitation. **The floor can only ever raise the R2 prompt. There is no code path from this file to a block**, and there must never be one, because the file is deployed by hand and force belongs to the file in front of the user (R3.1). The practical consequence, which is the answer to "is a manual deploy safe enough": the worst case of getting this file wrong is an unnecessary but dismissible nag.
3. Fetched once on launch with a short timeout, cached in memory, and **failing open**: no network, a timeout, a non-200, a malformed body, or any error at all means no nag. This is belt and braces on top of R4.2, not the primary safety property.
4. **The transport is `CapacitorHttp.get()`, not `fetch()`.** This is a correctness requirement, not a preference. There is no `response_headers_policy` and no `Access-Control-Allow-Origin` anywhere in the apex or web CloudFront modules (`infrastructure/modules/frontend/main.tf` has none across its whole distribution block, `:99-205`; `infrastructure/modules/web/main.tf:81-85` records that the one response-headers policy that existed was removed), while the native WebView origin is `capacitor://app.beanies.family` on iOS (`capacitor.config.ts:13-21`, mirrored in the API's CORS allowlist at `infrastructure/modules/telemetry/variables.tf:44`). A browser `fetch()` from the app origin to the apex is therefore refused by CORS on every device, the fail-open swallows the refusal, and the entire floor becomes dead code that nothing reports. `CapacitorHttp` is exported from `@capacitor/core` 8.5.0, already a dependency (`node_modules/@capacitor/core/types/index.d.ts:4`), runs the request on the native layer, and is not subject to CORS. Call it DIRECTLY; **do not enable the `CapacitorHttp` fetch/XHR patch in `capacitor.config.ts`**, which would reroute every network call in the app and is a blast radius nobody asked for. Because the whole feature is native-only (R1.2), no web transport is needed at all.
   - **Enforced, not just written down.** A `no-restricted-globals` zone in `eslint.config.js` scoped to `src/services/appUpdate/**` bans `fetch` with the CORS reason in the message. This repo has been bitten by rules that lived only in a comment; the two existing `no-restricted-imports` zones (`:386-398`, `:428-447`) are the precedent, and the second carries a header explaining why a lint zone beats a bespoke import-graph test.
5. **The device's own HTTP cache is a separate problem from the CDN's, and the obvious fix does not work.** `aws s3 sync` sets no `Cache-Control` (`.github/workflows/deploy-web.yml:71`), and the apex default behaviour is `default_ttl = 86400` (`infrastructure/modules/frontend/main.tf:141`), so a device can serve a day-old floor from `URLSession`'s cache after the `/*` invalidation (`:74-77`) has already cleared the edge. The request therefore appends an hour-bucket parameter, `?h=<Math.floor(Date.now() / 3_600_000)>`, which gives the device a fresh URL at most once an hour.
   - **State the trap in the code comment**: `forwarded_values { query_string = false }` (`infrastructure/modules/frontend/main.tf:133-137`) means CloudFront does not vary its cache key on that parameter, so it is NOT a way to bust the edge, and the deploy's invalidation remains the only thing that does. Without this note a future maintainer chasing edge staleness will add more query parameters and be baffled.
6. Compared against `APP_VERSION` (`src/constants/appVersion.ts:34`), not the store version. `scripts/derive-store-version.mjs:63` strips the `R<n>` suffix, so `0.15R2` and `0.15` are the same string to the stores and must not be the same to this check.
7. A real comparison, not a string compare: `0.9` is older than `0.16`, and `0.15R2` is newer than `0.15`. Its own pure function with its own tests, in `src/utils/compareAppVersions.ts` beside the other pure helpers. Nothing like it exists in the repo today (verified: no semver dependency, no comparison helper anywhere in `src/`; `derive-store-version.mjs` only strips and validates).
   - **Signature: `compareAppVersions(a: string, b: string): -1 | 0 | 1 | null`, where `null` means "cannot decide".** Under `strict: true` (`tsconfig.app.json:12`) a nullable return forces every caller to handle the undecidable case at the type level. Pass 2 said "a sentinel"; a numeric sentinel would read as "equal" at a glance and would change behaviour silently when a typo reached the static file.
8. Raising the floor is a deliberate act: `deploy-web.yml` is `workflow_dispatch` only, so pushing the file does not publish it. The workflow syncs `web/dist/` to S3 (`:71`) and then invalidates CloudFront on `/*` (`:74-77`), so once it IS run the new floor is live at the edge immediately. See R7 for where this is written down.
9. The floor's URL is derived from `SITE_URL` in `packages/brand/nav.ts:41` (R6.3). In dev the app's `MARKETING_URL` points at `http://localhost:4321`, so a dev build that cannot reach it fails open, which is correct and harmless.
10. **Why the apex and not the app origin.** Serving the floor from `app.beanies.family` would still be cross-origin on iOS (`capacitor://` vs `https://`), so it would not avoid `CapacitorHttp`, and it would tie every floor change to a full app deploy that also ships new app code. The apex lets the floor move without touching the bundle. Record the reasoning; it is the first question a reader will ask.

### R5. Copy, in the registers that already exist

Reuse rather than invent. The four "saved by a newer version" strings (`src/services/translation/uiStrings.ts:4377-4404`) and the Help article already say the right thing; the update surfaces agree with them word for word where they overlap. New keys only for the one prompt sheet (title, message, confirm, cancel) and the block's action label, each with `en` and `beanie`; on this surface the `beanie` values stay plain English, matching the compaction decision (greg, 2026-09-06: "do not use bean euphemisms"). All of them are `UIStringKey`s because that is what `confirm()` and `FatalActionLink.labelKey` take; none may be assembled at the call site. The store URL rendered as a caption is a URL, not prose, so it is not translated, and neither is the JSON's `reason`, which is never rendered at all (R2.2).

### R6. Where things live, and the boundaries that keep them there

1. **The store URLs live once, in `packages/brand/nav.ts`.** It already holds `SITE_URL` and `APP_URL` (`:38, 41`), which are the same class of fact, and it is already a root dependency (`package.json:55`) consumed by both workspaces (`src/style.css:2`, `web/src/pages/download.astro:12`). Add:

   ```ts
   export const STORE_URL = {
     ios: 'https://apps.apple.com/app/id6798513944',
     android: 'https://play.google.com/store/apps/details?id=family.beanies.app',
   } as const satisfies Record<'ios' | 'android', string>;
   ```

   - **A frozen record keyed on `getPlatform()`'s union (`src/services/sync/capabilities.ts:51-52`), not an if/else.** A third native platform then fails the build at the constant rather than falling through to no link. This is the repo's established habit and its stated reason (`payloadFailureSurface.ts:61-67`: "a sixth kind fails the build here rather than taking a silent default").
   - `src/` imports it, and so do `web/src/pages/ios.astro:12`, `web/src/pages/android.astro:11` and `web/src/pages/download.astro:14-15`, two lines each. **Five live copies become one.** The literal in `src/content/release-notes/deploys.ts:601` is frozen historical prose and is left alone.
   - **Fallback, decided by a five-minute spike before anything else in this plan:** import `@beanies/brand/nav` from one `src/` file and run `npm run validate`. `nav.ts` is raw TypeScript published through a workspace `exports` map, so if Vite or Vitest mis-transforms it the answer is not to fight it: put `STORE_URL` in `src/utils/marketing.ts:1-3` beside `MARKETING_URL` instead, leave the Astro literals, and add a cross-reference comment to each so the four copies at least know about each other. Decide this first; do not discover it half way through.

2. **Phase B's plugin lives behind a hand-written interface, and only one file may name the package.**
   - `src/services/appUpdate/types.ts` declares only what this app needs, in this app's vocabulary: `interface StoreUpdateAdapter { supported(): boolean; getInfo(): Promise<{ updateAvailable: boolean } | null>; startFlexible?(): Promise<void>; completeFlexible?(): Promise<void>; }`.
   - `src/services/appUpdate/playStoreUpdate.ts` is the ONLY file that imports `@capawesome/capacitor-app-update`. Enforced by a third `no-restricted-imports` zone in `eslint.config.js`, alongside the lineage guard (`:386-398`) and the finance exclusion (`:428-447`), with the reason in the message.
   - This mirrors the shape the repo already uses for the same problem: `src/services/share/` is `types.ts` plus per-platform adapters plus an `index.ts` registry whose header says "A fourth platform is ONE file plus one entry here" (`src/services/share/index.ts:1-22`), and `shareIntentPlugin.ts:1-15` is the single registration point for its native plugin, with the header explaining what went wrong when it was not.
   - Swapping the plugin, or deleting it, is then one file plus one lint entry, and `useAppUpdate` never learns a plugin type.
3. **The plugin's contract is pinned by the type checker, not by a mock.** A unit test that mocks `StoreUpdateAdapter` proves nothing about the plugin, which is exactly the "mock hides the real thing" failure this repo has been bitten by. So: `playStoreUpdate.ts` contains no `any` and no `as unknown as`, and `npm run type-check` compiles it against the plugin's real published types. A plugin major that changes the API then fails the build instead of passing a green suite.

### R7. The operating cost, written where the person will see it

Raising the floor is a manual deploy of a static file, on a workflow that only a human triggers. Three places carry the instructions, all of them on the path of somebody already doing the thing:

1. **`docs/runbooks/native-store-submission.md`**, a new `## Raising the update floor` section in the runbook that store releases already follow. It says: what the file is; that it can only produce a dismissible prompt and can never lock anyone out (R4.2); that editing it does nothing until `Deploy web (Astro marketing site)` is run by hand; that devices pick it up within about an hour (R4.5); and, importantly, **that a normal release does NOT raise the floor**. A floor raised by reflex on every release turns the prompt into noise and trains people to dismiss it, which is the reflex the block needs them not to have.
2. **`src/constants/appVersion.ts`**, a short pointer comment beside `APP_VERSION`. That header already carries release-time warnings of exactly this kind (`:24-35`, the `R<n>` and App Store trap), and bumping this constant is described there as the first step of a prod release, so it is the line the releaser is already looking at.
3. **The JSON itself**, via the `_docs` field. The parser ignores unknown fields, so it costs nothing and it is in front of whoever opens the file to edit it.

## Important Notes & Caveats

- **This does nothing for the currently-stale population.** Say it in the plan, the code header and STATUS. Implying otherwise would repeat the exact defect the last review round caught in the compaction copy.
- **Nothing in this plan except a file the user actually opened can block anyone.** The static floor prompts, never blocks (R4.2). This is the property that makes the manual deploy safe, and it must survive future edits: if a later change wants the floor to block, that is a product decision requiring its own plan, not a flag flip.
- **iOS has no in-app update.** Quoted from the plugin's own docs: "in-app updates are a feature of the Google Play Store and are therefore only available on Android." On iOS, both phases open the App Store listing, and the copy must not imply otherwise.
- **Phase B's plugin availability is a Phase B question, not a blocker.** Capawesome operates a sponsorware tier, and greg has previously declined a Capawesome plugin by name (`docs/plans/2026-07-14-native-biometric-prf-and-android-statusbar.md:88`). Under Phase A that costs nothing: the whole feature already works, and Phase B is a bounded, deletable addition behind one interface (R6.2). Do not let the Phase B question hold Phase A.
- **`inAppUpdatePriority` is set at rollout, through the Play Developer API, and cannot be changed afterwards.** It is also unsupported for internal app sharing. If we ever want priority-driven behaviour it has to be decided at release time, which is a runbook change, not a code change. Phase B only.
- **Testing in-app updates needs internal app sharing**, the same application id and signing key, a higher `versionCode`, and an account that has installed the app from Play before. It cannot be exercised in CI or in a simulator. Phase B only; Phase A is fully exercisable with a device and a hand-edited JSON.
- **Fail-open plus a CORS refusal is indistinguishable from fail-open plus a healthy fleet**, which is why R4.4 specifies the transport, why R4.4 lints `fetch` out of that directory, and why an acceptance criterion proves a real load rather than only a graceful failure.
- **Do not enable the global `CapacitorHttp` patch.** Calling `CapacitorHttp.get()` directly is the whole of what R4 needs; turning on the config flag reroutes every request in the app.
- **Do not use `@capacitor/browser` for the store link.** It is already a dependency and it is the obvious wrong reach; an in-app SFSafariViewController renders the store's web page instead of handing off to the store app.
- **Do not add a second updater on web.** `usePwaUpdater` owns that platform completely, and `isQuiet` must move verbatim so its behaviour there does not shift.
- **Do not put a function in `fatalErrorStore`.** R3.3 explains why at length; the short version is that the store is read by a component and written by a util, and a URL crosses that boundary while a closure drags a plugin across it.
- **Do not deploy** as part of this work.

## Assumptions

> **Review these before implementation.**

1. A region-less `https://apps.apple.com/app/id<id>` link resolves to the visitor's local storefront and opens the App Store app on iOS; `https://play.google.com/store/apps/details?id=<pkg>` opens the Play Store app on Android. Both URLs are the ones the marketing site already ships (`web/src/pages/ios.astro:12`, `web/src/pages/android.astro:11`), and `web/src/pages/ios.astro:11` documents the region-less behaviour. `openExternal` already opens external links from the native shell today (`src/components/common/AppHeader.vue:190`).
2. `@capawesome/capacitor-app-update` 8.x supports Capacitor 8 ("Active support" in its compatibility table) and exposes `getAppUpdateInfo()` and `openAppStore()` on both platforms, with `performImmediateUpdate`, `startFlexibleUpdate`, `completeFlexibleUpdate` and the state listener on Android only. Verified 2026-09-07: https://capawesome.io/docs/sdks/capacitor/app-update/ . **Phase B only**; availability and licensing are confirmed at that point, and a "no" costs nothing.
3. Play in-app updates: flexible downloads in the background and can be deferred; immediate is a fullscreen flow the user must complete to continue. `inAppUpdatePriority` is 0-5, set via `Edits.tracks.releases` in the Play Developer API at rollout only, and unsupported for internal app sharing. Verified 2026-09-07: https://developer.android.com/guide/playcore/in-app-updates and .../in-app-updates/test
4. `web/public/**` is published to the marketing origin by `aws s3 sync web/dist/ --delete` (`.github/workflows/deploy-web.yml:71`), followed by a `/*` CloudFront invalidation (`:74-77`), so a file added there is served at `https://beanies.family/<name>` and a change to it is live at the edge as soon as the workflow runs. That workflow is `workflow_dispatch` only. The sync sets no `Cache-Control`, and the apex default behaviour is `default_ttl = 86400` (`infrastructure/modules/frontend/main.tf:141`), which is why R4.5 exists.
5. `APP_VERSION` (`src/constants/appVersion.ts:34`) is the product version and may carry an `R<n>` suffix; `scripts/derive-store-version.mjs:63` strips it for the stores. The floor compares product versions.
6. `isNative()` and `getPlatform()` (`src/services/sync/capabilities.ts:46, 52`) are the platform tests; `Capacitor.isNativePlatform()` is confined to that file by an explicit convention (`:38-48`). `usePwaUpdater` returns early on the native platform (`:116`).
7. The fatal overlay CANNOT carry an action today. Verified: `fatalErrorStore` holds `message` / `detail` / `clearDataHelps` only (`src/stores/fatalErrorStore.ts:22-60`) and `App.vue` hardcodes Reload and Clear data (`:1886-1900`). `App.vue` mirrors the store into local refs through a hand-maintained tuple (`:212-222`) whose watcher only fires `if (msg)`, so `clear()` does not reset the mirrors. R3.3 specifies the addition and requires a computed rather than a fifth mirrored field.
8. The apex serves no CORS headers, so cross-origin `fetch()` from the app origin to `beanies.family` is refused. Verified by absence: no `response_headers_policy` or `Access-Control-*` in `infrastructure/modules/frontend/main.tf` (the whole distribution block, `:99-205`) or `infrastructure/modules/web/main.tf` (whose `:81-85` note records the removal of the one policy that existed). R4.4 routes around it with `CapacitorHttp`, which ships inside `@capacitor/core` (`node_modules/@capacitor/core/types/index.d.ts:4`) and is therefore not a new dependency.
9. `App.addListener('resume', ...)` is the established native resume signal in this repo (`src/services/share/iosShareAdapter.ts:100`), and `@capacitor/app` is already a dependency.
10. `src/` can import `@beanies/brand/nav` (raw TypeScript through the workspace `exports` map). Not yet proven: `src/` imports only `@beanies/brand/theme.css` today (`src/style.css:2`). R6.1 makes this a five-minute spike with a named fallback, taken first.

## Approach

The shape is: one pure comparison, one static file, one composable, one data field on an existing store, and one line inside an existing chokepoint. Phase B adds one adapter behind one interface.

**Order of work. Phase A first, and it is the whole product.**

0. **The spike (R6.1)**, five minutes, before anything else: can `src/` import `@beanies/brand/nav`? The answer decides where `STORE_URL` lives, and it is much cheaper to know now than half way through.
1. **The pure parts**, because they are the testable core: `src/utils/compareAppVersions.ts` returning `-1 | 0 | 1 | null`, and `src/services/appUpdate/versionPolicy.ts` (fetch, parse, fail open) exposing a plain `Promise<string | null>` so its callers and its tests never touch Capacitor. The comparison knows nothing about anything.
2. **The overlay affordance**, because it is the one thing that does not exist yet and everything in R3 depends on it: `FatalActionLink` on the store, the computed and the primary button and the caption in `App.vue`. Small enough to land and test on its own, and it changes nothing on web.
3. **The composable**, which wires the floor to the prompt. Native-only, singleton, inert on web, three public members.
4. **The force trigger**, one guarded line inside `surfacePayloadFatal`, so no new classification is invented and no second `needsAppUpdate` reader appears.
5. **Copy, help article, runbook, telemetry.**

**Phase B, only after A is merged and green:** the `StoreUpdateAdapter` interface, the Play adapter, the lint zone that keeps the package name in one file, and the flexible flow on the prompt path. Nothing in Phase A changes shape to accommodate it, which is the test of whether the boundary was drawn in the right place.

**DRY, with the sites verified.** The prompt is `confirm()` (`src/composables/useConfirm.ts:56`). The block is `setFatal` (`src/stores/fatalErrorStore.ts:38`) reached through the single chokepoint `surfacePayloadFatal` (`src/utils/payloadFailureSurface.ts:148`). The "is this because the app is old" question is `PayloadLoadError.needsAppUpdate` (`src/types/sync.ts:328`, overridden at `:404`) read through `payloadErrorKind` (`:470`). The quiet predicate is `usePwaUpdater`'s, moved verbatim to `src/utils/appQuiet.ts` and imported by both. The resume signal is `@capacitor/app`'s `resume`, per `iosShareAdapter.ts:100`. The online signal is `useOnline()`. The "app is past boot" signal is `isLoaded()` (`src/services/automerge/projection.ts:36`), per `waitForDocLoaded.ts:12`. The external-link helper is `openExternal`. The store URLs collapse from five copies to one. The copy leans on the four existing `newerVersion` registers. The adapter shape is `src/services/share/`'s. The lint zones are `eslint.config.js`'s. **The only genuinely new code is the version comparison, the floor fetch, one data field on a store, and a small composable that joins them.**

**Complexity kept out, deliberately.** Each of these was considered and rejected, and the reason is recorded so a future reader does not re-add it:

| Rejected                                                 | Why                                                                                                                                                                               |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FatalAction.run` callback in the store                  | Drags the update composable, and a native plugin, into the app's payload chokepoint; needs `markRaw`; lets the button and the caption diverge. A `url` does the same job as data. |
| A fifth mirrored ref in `App.vue`                        | The mirror tuple (`App.vue:213`) is a known drift surface and its watcher never clears. A computed off the store cannot go stale.                                                 |
| `mustUpdate` / `requireUpdate()` on the composable       | Zero callers on day one. An unreachable force path reads as covered and is not.                                                                                                   |
| A blocking floor                                         | A hand-deployed static file that can lock a family out of their own data. Prompting only makes the deploy safe by construction rather than by care.                               |
| Two prompt variants (floor-driven and store-driven)      | Two copies to translate and review for one user-visible event. One sheet, two triggers.                                                                                           |
| Rendering the JSON's `reason`                            | Untranslated English on a Chinese device, bypassing `uiStrings` entirely.                                                                                                         |
| A separate runbook file for the floor                    | Nobody finds an orphan runbook. It goes in the store-release runbook they already follow, plus a pointer at the line they already edit.                                           |
| `performImmediateUpdate()` as the block's action         | Puts a plugin-backed closure into global fatal state to buy a nicer transition on a screen where the person has already stopped.                                                  |
| A per-member persisted dismissal                         | `createPerMemberStore` is localStorage with its own failure surface. The flag must die with the process, which a module boolean does exactly.                                     |
| The global `CapacitorHttp` patch                         | Reroutes every request in the app to satisfy one GET.                                                                                                                             |
| Adding CORS headers to the apex, or serving from the API | Terraform change and a new drift surface, or a floor that depends on the API's availability and deploy cycle, to avoid a call that `@capacitor/core` already provides.            |

**Error handling: every path, named, with its handler.** Nothing in this feature is `critical`, by construction, because not being on the newest app version is not an incident. Nothing is swallowed either.

| #   | What can fail                                                                                         | Handling                                                                                                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The floor request fails (offline, timeout, non-200, CORS, DNS)                                        | Caught inside `versionPolicy.ts`; returns `null`; `check-failed` at `warn` with the class in `detail`; **fails open** (no prompt).                                                                                              |
| 2   | The floor body is malformed (not JSON, wrong shape, `promptBelowVersion` not a version-shaped string) | Same as 1, with a distinct `detail` class so a bad deploy is distinguishable from a bad network.                                                                                                                                |
| 3   | `compareAppVersions` cannot parse either side                                                         | Returns `null`, which the caller must handle at the type level and reads as "no prompt". It never throws; a pure comparison that threw would turn a typo in a static file into a crash.                                         |
| 4   | The device holds a stale floor in its HTTP cache                                                      | The hour-bucket parameter (R4.5) bounds the staleness to about an hour. Not an error path, but it is the failure a reader will look for and not find.                                                                           |
| 5   | `openExternal` is handed a non-http(s) or empty URL                                                   | Already handled inside the helper: it refuses and logs loudly (`src/utils/openExternal.ts:29-46`). The `url` comes from a frozen constant, so this is defence, not expectation.                                                 |
| 6   | The store link does not open (no browser, user cancels the handoff)                                   | Nothing to catch: `openExternal` is fire and forget. **The URL is on screen as selectable text either way** (R3.4), which is why "show the fallback on failure" was never the design.                                           |
| 7   | `isAppQuiet()` runs before Pinia is ready                                                             | Already handled by the moved code: `try/catch` returning `false` (`usePwaUpdater.ts:47-51`). Verbatim move preserves it.                                                                                                        |
| 8   | **Phase B** the plugin module is absent from this build (dynamic `import()` rejects)                  | Caught at the cached-import boundary; `check-failed` with `error_code: 'plugin-missing'`; the adapter reports `supported() === false` and the composable runs Phase A behaviour unchanged. Never rethrown into `App.vue` setup. |
| 9   | **Phase B** `getInfo()` throws                                                                        | Caught; `check-failed` with a reason class in `detail`, never the raw error text; the floor still decides.                                                                                                                      |
| 10  | **Phase B** the Play flow rejects (user cancelled the sheet, Play unavailable)                        | Caught; `update-failed` at `warn` carrying whether it was a cancel; the prompt simply does not return, and the store URL path is still available next launch.                                                                   |
| 11  | **Phase B** the Android download-state listener throws or leaks                                       | The handler body is wrapped; the listener handle is removed in `onScopeDispose` (R1.4).                                                                                                                                         |

No bare `catch {}` anywhere. Every catch either emits a `logEvent` on the `app-update` surface or, where a moved line already had a documented reason to be silent, keeps that reason in the comment.

## Files Affected

**Phase A**

- `packages/brand/nav.ts` (`STORE_URL`, the frozen record), or `src/utils/marketing.ts` per the R6.1 fallback
- `web/src/pages/ios.astro`, `web/src/pages/android.astro`, `web/src/pages/download.astro` (import the constant instead of their literals; two lines each)
- `src/utils/compareAppVersions.ts` (new) and `src/utils/__tests__/compareAppVersions.test.ts`
- `src/services/appUpdate/versionPolicy.ts` (new: `CapacitorHttp` fetch, parse, fail open) and its test
- `src/composables/useAppUpdate.ts` (new) and its test
- `src/utils/appQuiet.ts` (new: `isAppQuiet()`, moved verbatim from `usePwaUpdater`)
- `src/composables/usePwaUpdater.ts` (delete the local `isQuiet`, import `isAppQuiet`)
- `web/public/min-app-version.json` (new)
- `src/stores/fatalErrorStore.ts` (optional `action: FatalActionLink | null`, plain `ref`, cleared by `clear()`)
- `src/App.vue` (a `computed` off the store, the primary button and the URL caption in the existing action row, `:1886-1900`)
- `src/utils/payloadFailureSurface.ts` (attach the action for `needs-update` on native, inside `surfacePayloadFatal`)
- `src/types/sync.ts` (`appVersion` in `payloadErrorDetail`)
- `eslint.config.js` (a `no-restricted-globals` zone banning `fetch` inside `src/services/appUpdate/**`)
- `src/constants/appVersion.ts` (pointer comment to the floor runbook, R7.2)
- `src/services/translation/uiStrings.ts`, `public/translations/zh.json`
- `src/content/help/how-it-works.ts` (the `family-file-newer-version` article at `:5`; the Astro site renders the same source via `@/content/help`, see `web/src/pages/help/[category]/[...slug].astro:11`, so one edit covers both surfaces)
- `docs/runbooks/native-store-submission.md` (the `## Raising the update floor` section, R7.1)
- `docs/STATUS.md`, `CHANGELOG.md`

**Not touched, deliberately:** `capacitor.config.ts` (no `CapacitorHttp` patch, no plugin config), `package.json` (Phase A adds no dependency), `android/`, `ios/`, and `src/content/release-notes/deploys.ts:601` (frozen prose).

**Phase B (separate change)**

- `src/services/appUpdate/types.ts` (the `StoreUpdateAdapter` interface)
- `src/services/appUpdate/playStoreUpdate.ts` (the only file naming the plugin)
- `src/composables/useAppUpdate.ts` (consume the adapter as a second trigger)
- `eslint.config.js` (the `no-restricted-imports` zone confining the package name)
- `package.json`, `android/`, `ios/` (plugin install and `npx cap sync`)

## Help Center Coverage

- **Action**: update existing
- **Category**: how-it-works
- **Slug**: `family-file-newer-version` (added 2026-09-06, `src/content/help/how-it-works.ts:5`)
- **Title**: unchanged
- **Scope**: the article already tells someone on an old version what the message means and that updating is the fix. Add a short paragraph saying beanies will now offer to update the app itself on iPhone and Android, and that it will insist only when the family file cannot be opened without it.
- **Notes**: must not imply the app can update itself on iOS; it opens the App Store. Must not suggest clearing data. Bump `updatedDate`. The existing "What to do" steps (`:33-38`) stay correct as written and should not be rewritten.

## Observability Coverage

- **Events**, all on surface `app-update`:
  - `checked` (info): `action: 'checked'`, `detail: floor=<version|none>,behind=<bool>,platform=<ios|android>`. The denominator for everything else, **and the only proof the floor is alive**: `floor=none` across the whole fleet means the file is unreachable no matter how gracefully it failed.
  - `prompted` / `prompt-dismissed` / `update-started` / `update-completed` (info): the funnel, so "how fast does the fleet drain" is answerable. `update-started` / `update-completed` are Phase B; on Phase A the funnel ends at `prompted` plus the store handoff.
  - `blocked` (warn): `action: 'blocked'`, `error_code: 'needs-update'`. A person who cannot use the app until they update is worth counting, and `warn` reaches CloudWatch without paging.
  - `update-failed` (warn, Phase B): the Play flow rejected, with cancel-versus-error in `detail`.
  - `check-failed` (warn): how this feature degrades. `detail` carries the reason class (`offline` / `timeout` / `http-<status>` / `malformed` / `unparseable-version`, plus `plugin-missing` in Phase B), never the raw error text.
- **Failure modes covered**: rows 1, 2, 3, 8, 9 and 10 of the error table each map to one of the events above; rows 4 to 7 are bounded or pre-existing behaviour with their own comments.
- **The floor's fail-open is deliberately visible.** Because it fails open, a permanently broken floor looks exactly like a healthy fleet unless the failure is counted. `checked` carrying `floor=<value|none>` is what turns "the floor never fires" into an answerable question, and it is why R4.4's transport matters: a CORS refusal would otherwise be an invisible constant.
- **Success-path signal**: `checked` fires whether or not the device is behind, so the rate is measurable rather than only the failures.
- **Critical vs telemetry**: nothing here pages. Not being on the newest app version is not an incident, and a `critical` on it would train the alert to be ignored. This matches the existing row reasoning for `needs-update` in `PAYLOAD_IS_INCIDENT` (`src/utils/payloadFailureSurface.ts:81, 85`).
- **Privacy / store gate**: no new context key. `action`, `error_code`, `detail`, `family_id` and `build_sha` are already in `ALLOWED_CONTEXT_KEYS` (`src/utils/diagnosticContext.ts:68, 69, 98, 185`), so no `native-store-submission.md` data-collection update is required, and none may be made. The platform and the floor value ride inside `detail` as fixed, non-personal tokens rather than as new keys, deliberately.

## Acceptance Criteria

**Phase A**

- [ ] Phase A ships with **no new runtime dependency**: `package.json` is unchanged, and the whole feature works on both platforms.
- [ ] On web, nothing changes: `useAppUpdate` is inert, `usePwaUpdater` is the only updater, and the fatal overlay renders byte-identically to today (no action attached).
- [ ] `isAppQuiet()` is a verbatim move; `usePwaUpdater` has no local copy and its existing tests pass untouched.
- [ ] On native, a device below the floor gets one dismissible prompt per session, never while offline, mid-save, with an overlay open, or before `isLoaded()`.
- [ ] Confirming the prompt opens the correct store listing on each platform, called synchronously inside the confirm handler.
- [ ] `UnsupportedBeanpodVersionError` on native raises the block through the existing `surfacePayloadFatal`, with `clearDataHelps: false` and a working store link. **No second `needsAppUpdate` reader was added.**
- [ ] The block is never a dead end: the store URL is on screen as selectable text unconditionally, outside the `<details>` disclosure, whether or not the store opens.
- [ ] `setFatal`'s new `action` is **data, not a function**; it is optional, cleared by `clear()`, and every existing caller compiles unchanged. `payloadFailureSurface.ts` imports no composable and no plugin.
- [ ] `App.vue` reads the action as a **computed off the store**, and gains no new entry in the mirror tuple at `:213`. A test asserts an action can never be rendered without a store message.
- [ ] `payloadErrorDetail` carries `appVersion`, and the block's copyable diagnostic shows both the running version and the file's version.
- [ ] **The floor is proven to LOAD on a real device**, not merely to fail open: a device build reads `min-app-version.json` from the apex and logs `checked` with `floor=<version>`. Failing open on a CORS refusal must not be mistaken for passing.
- [ ] **There is no code path from the floor to a block.** Asserted: with `promptBelowVersion` set arbitrarily high, the app still opens and is fully usable, and shows only a dismissible prompt.
- [ ] The floor fails open on every error class (offline, timeout, 404, malformed JSON, wrong shape, unparseable version), asserted for each, each with its own `check-failed` class in `detail`.
- [ ] The floor request carries the hour-bucket parameter, and the CloudFront `query_string = false` caveat is in the code comment.
- [ ] `compareAppVersions` orders `0.9 < 0.16 < 0.16.1 < 0.17` and `0.15 < 0.15R1 < 0.15R2`, returns `null` rather than throwing on garbage on either side, with tests. Its return type is `-1 | 0 | 1 | null`.
- [ ] The floor compares product versions, so `0.15R2` is not treated as `0.15`.
- [ ] `capacitor.config.ts` is unchanged; the global `CapacitorHttp` patch is NOT enabled; `@capacitor/browser` is not used for the store link.
- [ ] `eslint` fails on a `fetch` call inside `src/services/appUpdate/**` (verified by temporarily adding one).
- [ ] No `Capacitor.isNativePlatform()` outside `src/services/sync/capabilities.ts`.
- [ ] **Each store URL exists exactly once as live code**, in a frozen record keyed on `getPlatform()`'s union; the three Astro pages import it; only the release-note prose keeps a literal. A fourth platform in the union fails the build.
- [ ] The floor runbook section exists in `docs/runbooks/native-store-submission.md`, says the floor can only prompt, says a normal release does not raise it, and is pointed at from both `appVersion.ts` and the JSON's `_docs`.
- [ ] Every new string has `en` and `beanie`, `beanie` in plain English, and `npm run translate` is clean. The JSON's `reason` is not rendered anywhere.
- [ ] Help Center article updated per the section above, with `updatedDate` bumped.
- [ ] Diagnostic logging implemented and verified; no new context key; no bare `catch {}` anywhere in the new code.
- [ ] Full gate green (`npm run validate`); every new test mutation-checked against the regression it pins.

**Phase B (only after A is merged)**

- [ ] `@capawesome/capacitor-app-update` is named in exactly one file, and `eslint` fails on an import of it from anywhere else (verified by temporarily adding one).
- [ ] `playStoreUpdate.ts` contains no `any` and no `as unknown as`; `npm run type-check` compiles it against the plugin's real types.
- [ ] Deleting `playStoreUpdate.ts` and its lint entry leaves Phase A behaviour intact and the suite green. **This is the test of whether the boundary is real** and it is run once, deliberately, before Phase B is called done.
- [ ] Android takes the flexible flow; iOS still opens the App Store. Neither claims the other's behaviour in copy.
- [ ] `performImmediateUpdate()` is not wired to the fatal overlay.

## Testing Plan

1. **Unit, pure**: the version comparison across the orderings above plus malformed input on either side (asserting `null`, not a throw); the floor's fail-open for each error class with the right `detail` class; `isAppQuiet()` returning `false` when the store is not ready.
2. **Unit, composable**: `useAppUpdate` is inert on web; the session flag suppresses a second prompt; the prompt is suppressed for each of the four gates independently (offline, not quiet, overlay open, doc not loaded); a floor the device already meets produces no prompt.
3. **Unit, block**: `surfacePayloadFatal` attaches an action for `needs-update` on native and attaches none for `needs-update` on web, and none for any other kind on either platform. **This is the regression that keeps the web overlay unchanged.**
4. **Unit, store invariant**: `clear()` clears `action`; `setFatal` without an action leaves it null; an action cannot exist while `message` is null.
5. **Component**: the fatal overlay renders the action as the primary button with the URL caption beneath it when `action` is set, and renders exactly as today when it is not; the caption is outside the `<details>` block; `ConfirmModal` shows "Update" / "Not now" with the info variant.
6. **Structural**: `eslint` rejects a `fetch` inside `src/services/appUpdate/**` (Phase A) and an import of the plugin package outside its one file (Phase B). Both verified by temporarily introducing the violation, because a lint rule nobody has seen fail is a rule nobody knows works.
7. **Manual, the floor, both directions**: confirm it LOADS on a device (criterion above) with a `checked` event carrying a real `floor=`, then deliberately break it (404 it, malform it, take the device offline) and confirm the app is completely unaffected and each break produces its own `check-failed` class. Then set the floor absurdly high and confirm the app still opens and stays usable.
8. **Manual, the force path**: hand-edit a family file to a version this build does not know (the fixture at `/tmp/gp-test-family.beanpod` is the obvious base), open it on a native build, and confirm the block appears, is not dismissible, offers a working store link, and shows the URL as selectable text.
9. **Manual, Phase B only, the part CI cannot fake**: an Android build installed through internal app sharing with a higher `versionCode` available, exercising the flexible prompt; an iOS build confirming the sheet still opens the App Store listing.

## Review Passes

- **Pass 1 (Initial draft)**: drafted from greg's two decisions and the verified platform research; both UI surfaces mapped onto existing components so no new UI is designed.
- **Pass 2 (DRY + error handling)**: verified every reuse claim against the code. Found and fixed three substantive defects: the fatal overlay cannot carry an action today (`fatalErrorStore.ts:22-60`, `App.vue:1886-1900`), so R3.3 now specifies the smallest honest addition; the floor's `fetch()` would be CORS-refused on every device and silently fail open forever (no `response_headers_policy` in `infrastructure/modules/frontend|web/`), so R4 now specifies `CapacitorHttp`; and the force "dispatch site" already exists as `surfacePayloadFatal` (`payloadFailureSurface.ts:148-174`), so R3 attaches to it rather than adding a second `needsAppUpdate` reader. Also corrected the platform test to `isNative()` per `capabilities.ts:38-48`, deduplicated the store URL, pinned the prompt behind `isLoaded()` because `ConfirmModal` is `z-[250]` under a `z-[300]` boot overlay, ruled out `openExternal` as a post-await fallback (`openExternal.ts:18-20`), and replaced the single error-handling paragraph with an error table.
- **Pass 3 (Sustainability)**: reshaped the plan around what a maintainer inherits. **Phase A takes no new dependency at all**, because a plain store URL through the repo's existing `openExternal` (already used natively at `AppHeader.vue:190`) delivers the whole product on both platforms; the Capawesome plugin becomes Phase B behind a hand-written interface with the package name confined to one file by a lint zone, so the degrade path is the default path rather than a promise. **The overlay action becomes data (`{ labelKey, url }`) rather than a callback**, which keeps `payloadFailureSurface.ts` (`:22-28`) free of any composable or plugin import, removes `markRaw` ceremony from a Pinia store, and makes button-versus-caption divergence structurally impossible; `App.vue` reads it as a computed rather than growing the mirror tuple at `:213`, whose watcher never clears (`:215`). **The floor is now structurally incapable of blocking** and its JSON field is renamed `promptBelowVersion` to say so, which converts the manual-deploy hazard from "lockout" to "an unnecessary nag" and is the answer to the operational-cost question; its instructions go in the store-release runbook, in `appVersion.ts:24-35` beside the bump, and in the file itself. Deleted `mustUpdate` / `requireUpdate()` (zero callers by construction). Added the device-HTTP-cache hazard with the `query_string = false` trap that defeats the obvious fix (`infrastructure/modules/frontend/main.tf:133-141`), a `null`-returning comparison signature under `strict: true`, a build-failing `Record<'ios'|'android', string>` for the store URLs collapsing five live copies to one via `packages/brand/nav.ts:38,41`, lint enforcement in place of two comment-only rules, a type-checked (not mocked) plugin contract, a "deleting the adapter leaves Phase A green" criterion, and a rejected-complexity table so the removed machinery does not grow back.
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

### Pass 3 review prompt

> Let's review the plan again with a focus on long term sustainability, maintainability, and reliability. Ensure we are using strong coding practices and not putting ourselves in a situation where the app will become overly complex or difficult to support or maintain in the future. Check for deep nesting, overly coupled structures, or any other complexity that could lead to supportability, maintenance, or reliability issues that can be simplified.

</details>
