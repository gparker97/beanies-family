# R1 — Runtime correctness and platform behaviour

> Reviewer dimension: runtime correctness and platform behaviour
> Commit: `af38fe75` "feat(native): ask people to update, and give the block a way out"
> Contract: `docs/plans/2026-09-07-native-update-gate.md`
> Date: 2026-09-07

Everything below was verified against the code in the working tree at `af38fe75`, against
the real `@capacitor/core` / `@capacitor/ios` / `@capacitor/android` 8.x sources in
`node_modules/`, and by running the new suites (`7 files, 70 tests, all green`) plus a
live ESLint probe. No files were edited except this report.

---

## Findings

### 1. `getDeviceDiagnostics()` now runs on EVERY `App.vue` render, doing four synchronous Web Storage round-trips each time

**Severity: Medium-High** (performance + console-noise regression on the exact devices the
diagnostics exist to help)

**Where:** `src/App.vue:1875` (`:diagnostics="getDeviceDiagnostics()"`),
`src/App.vue:1591` (`const getDeviceDiagnostics = formatDeviceInfo`),
`src/utils/diagnostics.ts:57-67` (`getDeviceInfo`), `src/utils/diagnostics.ts:36-54`
(`storageWorks`).

**What is wrong.** Before this commit the diagnostics call sat inside the overlay's own
`v-if="initError"` block, so it was evaluated only when a fatal was actually on screen.
It is now a **prop expression on an unconditionally-rendered component**, so it is
re-evaluated on every re-render of `App.vue`'s render function.

`formatDeviceInfo()` defaults its argument to `getDeviceInfo()`
(`diagnostics.ts:103`), which calls `storageWorks()` twice
(`diagnostics.ts:64-65`). Each of those performs a real
`setItem` → `getItem` → `removeItem` round-trip against `window.localStorage` /
`window.sessionStorage` (`diagnostics.ts:41-48`) — synchronous, main-thread, disk-backed
— and on failure emits `console.warn('[diagnostics] storage probe failed', e)`
(`diagnostics.ts:51`).

`App.vue`'s render function depends on `showLayout` (`App.vue:375`, a computed over the
reactive `route`), `isDesktop` / `isMobile`, `isLoadingData`, `isInitializing`,
`authStore.needsAuth` and `authStore.currentUser?.memberId`, so it re-renders on every
route navigation, every breakpoint change and every auth-state change.

**Concrete failure scenario.** On an iPhone in a state where Web Storage is exposed but
throws (iOS Safari with blocked storage / quota exhaustion / certain privacy modes —
precisely the case `storageWorks`'s own header at `diagnostics.ts:26-34` says it exists
to detect), navigate Dashboard → Calendar → Todos. Each navigation re-renders `App.vue`,
which runs `getDeviceInfo()`, which throws twice and prints two
`[diagnostics] storage probe failed` warnings. Ten navigations = twenty warnings and
twenty attempted storage writes. On a healthy device the console is quiet but the four
synchronous storage operations still run on the main thread on every navigation, for a
value that is only ever read inside a `<details>` block on a screen almost nobody sees.

**Suggested fix.** Make it a `computed` — it has no reactive dependencies, so Vue
evaluates it once on first access and caches it forever:

```ts
const deviceDiagnostics = computed(() => getDeviceDiagnostics());
```

then `:diagnostics="deviceDiagnostics"`. (Binding
`:diagnostics="initError ? getDeviceDiagnostics() : ''"` also restores the old
semantics, but the computed is cheaper still.)

---

### 2. The launch-path prompt almost always loses the race against `isLoaded()`, and nothing re-evaluates until a `resume`

**Severity: Medium** (the feature's primary trigger is unlikely to fire on the launch
that checked)

**Where:** `src/composables/useAppUpdate.ts:164` (the only launch-path call),
`:169-171` (the only other call), `:99-112` (`canPrompt`, gated on `isLoaded()`).

**What is wrong.** `maybePrompt` has exactly two call sites: once after the floor
resolves, and once per `resume` event. `canPrompt` requires `isLoaded()`
(`projection.ts:35`, flipped true only in `bumpDocVersion`, `projection.ts:113-116`) and
`isAppQuiet()` (false while `syncStore.isSyncing`). `useAppUpdate()` is invoked in
`App.vue` **setup** (`App.vue:1666`), i.e. strictly before the `onMounted` init sequence
that loads and decrypts the pod. The floor fetch is one small GET to a CloudFront edge;
the pod open is the operation this repo has an entire performance plan about. Nothing
watches `docVersion` or `syncStore.isSyncing` to retry.

**Concrete failure scenario.** Cold-launch a stale iOS build with the floor raised above
`APP_VERSION`. `fetchUpdateFloor()` resolves at, say, ~200 ms; the pod is still loading,
so `isLoaded()` is `false`, `canPrompt` returns `false` at
`useAppUpdate.ts:109`, and `maybePrompt` returns at `:114`. `updateAvailable` is `true`
and `dismissedThisSession` is still `false`, but there is no further trigger. The person
uses the app for an hour and kills it. They were never prompted. Worse, a signed-out user
sitting on the login screen never has `isLoaded()` true at all, so the launch check can
never prompt there.

The prompt is delayed, not permanently lost — the next background/foreground cycle fires
`resume` and shows it — but for a feature whose whole job is to nag, "shows up sometime
after the first app switch" is a materially weaker behaviour than the plan implies
("Checked on launch and re-evaluated on resume", R2.1). The test at
`useAppUpdate.test.ts:158-168` ("asks on resume once a gate that was closed at launch has
opened") pins exactly this shape, so it is a design consequence rather than a slip — but
it is worth naming, because the plan's rejected-complexity table rejects a _poll_, not a
_settle_ trigger.

**Suggested fix.** Inside the existing `effectScope` (which is there for precisely this),
add one watcher that re-runs `maybePrompt` when the gates settle, e.g.
`watch([docVersion, () => useSyncStore().isSyncing], () => void maybePrompt(isOnline.value))`.
`dismissedThisSession` already makes it at-most-once, and it is not a poll.

---

### 3. `payloadFailureSurface.ts` imports the update composable — the exact coupling R3.3 and the acceptance criteria forbid

**Severity: Medium** (stated invariant is false today; re-opens the Phase-B hazard the
URL-as-data design existed to close)

**Where:** `src/utils/payloadFailureSurface.ts:29`
(`import { storeUrlFor } from '@/composables/useAppUpdate';`), directly under the comment
at `:25-27` that claims the new import is "Type-and-predicate only".

**What is wrong.** The plan is explicit and repeated:

- R3.3: "`payloadFailureSurface.ts` today imports stores, types and `errorReporter` and
  nothing else (`:22-28`). **A callback would make the app's single payload chokepoint
  import the update composable, and through it a native plugin. A `url` makes it import
  one constant.**"
- Acceptance criterion: "`payloadFailureSurface.ts` imports no composable and no plugin."
- R6.1 suggested `storeUrlFor` as "a tiny `storeUrlFor(platform)` helper" beside the
  constant, not inside the composable.

The commit avoided the _callback_ but reintroduced the _import_, by putting `storeUrlFor`
in `useAppUpdate.ts:38-40`. The chokepoint now transitively pulls in `@capacitor/app`
(`useAppUpdate.ts:26`), `@capacitor/core` (via `versionPolicy.ts:27`),
`@beanies/brand/nav`, `useConfirm`, `useOnline`, `projection`, `logEvent` and
`versionPolicy` — 215 `src/` modules reachable from `useAppUpdate.ts` by static import
walk. There is **no import cycle** (verified by walking the graph from `useAppUpdate.ts`;
nothing reaches back to `payloadFailureSurface.ts`), and nothing crashes, so this is not a
correctness bug today.

**Concrete failure scenario (forward-looking, and the one the plan named).** Phase B adds
the Play adapter to `useAppUpdate.ts`. The moment anyone writes a top-level
`import ... from '@capawesome/capacitor-app-update'` in that graph — or the cached
dynamic `import()` in R1.6 is "tidied" into a static one — `LoginPage.vue`,
`ResumePodSetup.vue`, `LoadPodView.vue`, `useLoginFlow.ts`, `useBiometricSignIn.ts` and
`SettingsPage.vue` all evaluate a native plugin module at chunk load, because they import
`payloadFailureSurface.ts`. That is a module-evaluation crash on a build where the plugin
is absent, on the login path, which is the failure R1.6 was written to prevent.

**Suggested fix.** Move `storeUrlFor` next to the constant it reads —
`packages/brand/nav.ts` (or `src/utils/marketing.ts`) — and have both
`payloadFailureSurface.ts` and `useAppUpdate.ts` import it from there. The type-level
`'web' → null` guarantee, and the test at `useAppUpdate.test.ts:87-93` that pins it, are
unaffected.

---

### 4. The destructive "Clear data" confirm stays clickable while the sign-out runs

**Severity: Medium-Low** (behaviour regression on a destructive path; double invocation
is now reachable)

**Where:** `src/App.vue:1609-1617` (`handleClearDataAndSignOut`, with the diff's removal
of `showClearConfirm.value = false;` from its first line), against
`src/components/common/FatalErrorOverlay.vue:142` (`v-if="showClearConfirm && clearDataHelps"`)
and `:148-152` (the red confirm button emitting `clearData`).

**What is wrong.** The old `App.vue` closed the destructive panel synchronously as the
first statement of `handleClearDataAndSignOut`, _before_ awaiting
`authStore.signOutAndClearData()`. That line is gone and the extracted component has no
equivalent: `showClearConfirm` is now reset only by
`FatalErrorOverlay.vue:48-52`, a watcher on `props.message`, which does not fire here
(the message is unchanged).

**Concrete failure scenario.** On the fatal overlay, tap "Clear data" (panel opens), then
tap the red "Clear data" inside the panel. `handleClearDataAndSignOut` starts awaiting
`authStore.signOutAndClearData()` — which clears the family IndexedDB, the auth session,
the trust flag and cached keys, and takes long enough to be perceptible. The panel and
its red button stay on screen with no busy state. A user who sees nothing happen taps it
again; a second `signOutAndClearData()` runs concurrently against the same IndexedDB
stores (`indexedDB.deleteDatabase` with another connection/delete in flight blocks), and
`hardReload()` is then queued twice. In the old code the button was gone after the first
click, so this was structurally impossible.

**Suggested fix.** Reset the flag where the action is taken, e.g. change the panel's
handler to `@click="showClearConfirm = false; emit('clearData')"`, or add a `busy` prop
that disables the control. The former is the one-line restoration of the old semantics.

---

### 5. `showClearConfirm` no longer resets when a new fatal arrives carrying the same message

**Severity: Low** (cosmetic; hard to reach)

**Where:** `src/components/common/FatalErrorOverlay.vue:48-52` versus the removed
`App.vue` line (`showClearConfirm.value = false; // never leave the destructive panel open`)
inside the `fatalErrorStore` watcher at `App.vue:228-238`.

**What is wrong.** The old watcher's dependency tuple was
`[fatalErrorStore.message, fatalErrorStore.detail, fatalErrorStore.clearDataHelps]` and
it reset the flag on any change to any of the three (whenever `msg` was truthy). The new
watcher depends on `props.message` alone.

**Concrete failure scenario.** The overlay is up with `resumeSetup.podCorrupted` and the
destructive panel open. An in-flight async path calls `setFatal` again with the _same_
translated message but a different `payloadErrorDetail` (a different `err.step`, a
different file id, a different `appVersion` — `payloadErrorDetail` composes all of them).
Old code: the destructive panel closed. New code: `props.message` is byte-identical, the
watcher does not fire, and the red "Clear data" button stays armed under a fatal whose
detail has changed underneath it.

The reverse direction is safe: `clear()` does not reach `initError` (only
`App.vue:232` and `App.vue:256` ever write it, and neither writes `null`), so the new
watcher's extra "message → null" case is unreachable from `App.vue` and identical in
effect to the old code.

**Suggested fix.** Watch the same tuple the old code did:
`watch(() => [props.message, props.detail, props.clearDataHelps], ...)`.

---

### 6. A screened-away URL removes the fallback caption too, inverting R3.4's "never a dead end"

**Severity: Low** (defence-in-depth is inverted; unreachable while the URL is a frozen
constant)

**Where:** `src/components/common/FatalErrorOverlay.vue:134`
(`<p v-if="action && actionHref" …>{{ actionHref }}</p>`), pinned by
`FatalErrorOverlay.test.ts:88-94`.

**What is wrong.** The plan makes the caption the _guarantee_ and the link the
_convenience_:

- R3.4: "The `url` caption is **unconditional**… The on-screen text is the guarantee; the
  link is the convenience."
- Error table row 5: "render no link when it fails, **leaving the caption (block)**…"
- Testing item 7: "a non-http(s) `url` renders **the caption but no anchor**."

The implementation gates the caption on `actionHref`, which is
`safeExternalHref(action.url)`. So the belt-and-braces text exists only when the belt
already works.

**Concrete failure scenario.** `setFatal(msg, detail, { action: { labelKey: 'appUpdate.openStore', url: 'javascript:alert(1)' } })`
(or any non-http(s) value that ever reaches `FatalActionLink.url`) renders neither the
anchor nor the URL text: a person blocked by `UnsupportedBeanpodVersionError` sees a
message telling them to update and no indication of where. That is exactly the dead end
R3.4 exists to make impossible. Today `storeUrlFor` returns a frozen constant so this
cannot fire, which is why it is Low — but the guard was designed for the day it can.

**Suggested fix.** `v-if="action"` on the caption and render `{{ action.url }}` (inert as
text), keeping `v-if="action && actionHref"` on the anchor. Update the test to assert the
caption survives.

---

### 7. `compareAppVersions(APP_VERSION, floor)` is called twice, and the second guards a branch production cannot reach

**Severity: Low** (wasted call; a branch that "reads as covered" and is not — the exact
argument the plan uses to delete `mustUpdate`)

**Where:** `src/composables/useAppUpdate.ts:71-72`.

```ts
const behind = floor !== null && compareAppVersions(APP_VERSION, floor) === -1;
if (floor !== null && compareAppVersions(APP_VERSION, floor) === null) {
```

**What is wrong.** The function is pure, so the two calls cannot disagree — there is no
correctness divergence. But the `null` branch is unreachable in production: by the time
`fetchUpdateFloor()` returns a non-`null` value it has already passed
`isComparableVersion(raw)` (`versionPolicy.ts:105-107`) and emitted its own
`unparseable-version` class otherwise. The only other way to get `null` is an unparseable
`APP_VERSION`, which is a build-time constant (`appVersion.ts:38`, `'0.16'`). So the
composable's `unparseable-version` event — error-table row 3's stated handler — can never
fire on a real device; that class only ever comes from `versionPolicy.ts:106`. The test
that covers it (`useAppUpdate.test.ts:132-142`) only reaches it because it mocks
`fetchUpdateFloor` and hands back `'v0.17-beta'`, a value the real function screens out.

**Suggested fix.** Compute once and branch on the result:

```ts
const verdict = floor === null ? null : compareAppVersions(APP_VERSION, floor);
```

and either keep the `null` log (now honest about being an `APP_VERSION` typo guard) or
drop it, since `versionPolicy` already owns that class.

---

### 8. `compareAppVersions` returns a WRONG answer (not `null`) for digit strings past 2^53, and silently normalises leading zeros

**Severity: Low** (unreachable with any version this project can produce; reported because
the brief asked for wrong-not-null inputs)

**Where:** `src/utils/compareAppVersions.ts:55-59`.

**What is wrong.** Each captured group goes through `Number()`, so precision is lost past
`Number.MAX_SAFE_INTEGER` and very long runs saturate to `Infinity`. Verified by
executing the exact regex and loop:

| a                        | b                        | returns                       | correct         |
| ------------------------ | ------------------------ | ----------------------------- | --------------- |
| `'9007199254740993'`     | `'9007199254740992'`     | `0`                           | `1`             |
| `'0.' + '9'.repeat(400)` | `'0.' + '8'.repeat(400)` | `0` (`Infinity === Infinity`) | `1`             |
| `'0.09'`                 | `'0.9'`                  | `0`                           | arguably `null` |
| `'0.016'`                | `'0.16'`                 | `0`                           | arguably `null` |

**Concrete failure scenario.** Someone fat-fingers `"promptBelowVersion": "0.09"` into
`web/public/min-app-version.json` intending `0.9`. It passes `isComparableVersion`, and
against `APP_VERSION = '0.9'` it compares **equal**, so no prompt is raised and nothing is
logged as malformed — the deploy looks healthy and does nothing. Every wrong answer here
lands on the fail-open side (no nag), so the blast radius matches the plan's stated worst
case; there is no path from this to a block.

**Suggested fix.** Optional. If it is worth closing, reject leading zeros in the grammar
(`(?:0|[1-9]\d*)`) and cap group length (`\d{1,9}`) so an out-of-range field returns
`null` rather than a lossy number. Both changes stay inside the single shared
`VERSION_RE`, so `isComparableVersion` cannot drift.

---

### 9. `blocked` is never emitted for a `needs-update` block on web

**Severity: Low / informational** (under-count, never an over-count)

**Where:** `src/utils/payloadFailureSurface.ts:186-195`.

**What is wrong.** The `blocked` event is gated on `storeUrl` being non-null, i.e. on
`kind === 'needs-update'` **and** the platform being native. A web user who opens a
beanpod 5.0 file on a stale tab still gets the full-screen `resumeSetup.podNewerVersion`
overlay, and no `blocked` row reaches CloudWatch. The plan's Observability section frames
`blocked` as counting "a person who cannot use the app until they update", without
restricting it to native.

**Concrete failure scenario.** A service worker that fails to update (the documented
failure mode `usePwaUpdater` exists for) leaves a web user blocked on `needs-update`
indefinitely, and the fleet metric shows zero blocked users.

**Positive half of the same check, which is sound:** the event cannot fire without a block.
All three `surfacePayloadFatal` call sites (`App.vue:600`, `ResumePodSetup.vue:320`,
`useLoginFlow.ts:1008`) unconditionally reach the `setFatal` at
`payloadFailureSurface.ts:195`, and `setFatal` has no early return
(`fatalErrorStore.ts:63-76`), so every `blocked` corresponds to one raised overlay.

**Suggested fix.** Emit on `kind === 'needs-update'` regardless of platform and let `os`
carry the split, or state in the comment that the counter is deliberately native-only.

---

## Verified correct

### `src/services/appUpdate/versionPolicy.ts`

- **`CapacitorHttp` API usage is correct against the real 8.5.0 types.** `params`
  (`core-plugins.d.ts:115`, typed `HttpParams` = `Record<string, string | string[]>` —
  the `String(...)` at `versionPolicy.ts:87` satisfies it), `readTimeout`
  (`:133`) and `connectTimeout` (`:137`) are all real `HttpOptions` fields.
  `HttpResponse` really does expose `data: any` (`:177`) and `status: number` (`:181`).
- **Both timeouts are honoured on both platforms.** Android:
  `HttpRequestHandler.java:390-391, 420-421` → `connection.setConnectTimeout` /
  `setReadTimeout` (`:112-113`). iOS: `HttpRequestHandler.swift:180, 204` reads
  `connectTimeout`, divides by 1000 and sets `request.timeoutInterval`
  (`CapacitorUrlRequest.swift:228`). 3000 ms is not silently ignored on either.
- **The already-parsed-vs-string handling is right, and necessary.** iOS
  `HttpRequestHandler.swift:160-162` runs `JSONSerialization` whenever the response
  `Content-Type` contains `application/json` — which is what S3 serves for a `.json` key
  — so the plan's warning is real and `versionPolicy.ts:100-101` handles it. The `string`
  branch covers the `binary/octet-stream` / `text/plain` fallback, so both shapes work.
  Pinned by `versionPolicy.test.ts:38-46`.
- **It cannot throw; every path returns `null`.** `CapacitorHttp.get` rejection,
  `JSON.parse` on a non-JSON string, a `res` that is `undefined` (a `TypeError` on
  `res.status`), and a missing `CapacitorHttp` binding are all inside the `try` at
  `:72-119`. The `catch` at `:113` calls `report()`, and `report()`'s only statement is
  `logEvent`, which is itself wrapped in `try/catch` and documented "never throws"
  (`logEvent.ts:105-137`) — so the catch handler cannot re-throw.
- **Memoising a failure is intended.** `cached = { value: report(...) }` at `:91`,
  `:103`, `:106` and `:118` stores `{ value: null }`, which is truthy, so `:69` short-
  circuits every later call. That matches R4.3 ("memoised in module scope for the process
  lifetime"), R2.1 ("Resume does NOT re-fetch"), the rejected-complexity row
  "Re-fetching the floor on every resume", and the once-per-launch `checked` requirement.
  In practice there is exactly one caller anyway (`useAppUpdate.ts:70`).
- **The `http-${res.status}` class, the hour bucket** (`Math.floor(Date.now() / 3_600_000)`,
  pinned by `versionPolicy.test.ts:48-55`), **and the CloudFront `query_string = false`
  caveat comment** are all present and match R4.5.
- **`MARKETING_URL`** (`src/utils/marketing.ts:1-3`) resolves to `https://beanies.family`
  in a production build (no `VITE_MARKETING_URL` in `.env` or `.env.local`), and to the
  Astro dev server in dev, as R4.9 requires.
- **The lint zone works.** Verified by temporarily adding
  `src/services/appUpdate/__lintprobe.ts` containing a bare `fetch(...)`:
  `npx eslint` errors with the full CORS message including the stated known limit. The
  file was removed. It is also the only `no-restricted-globals` block in
  `eslint.config.js` (line 467), so it overrides nothing.

### `src/utils/compareAppVersions.ts`

- **All the orderings the plan claims hold**, verified by executing the exact regex and
  loop: `0.9 < 0.16 < 0.16.1 < 0.17`, `0.15 < 0.15R1 < 0.15R2`, `0.16 == 0.16.0`,
  `1 == 1.0.0`.
- **`0.16R1 < 0.16.1` is CORRECT**, not a bug. `appVersion.ts:1-9` defines `R<n>` as "a
  revision / hotfix _within_ a release" and the dotted increment as "the next release", so
  a revision of `0.16` must sort before the release `0.16.1`. The four-field numeric
  compare produces exactly that.
- **It never throws and never returns a numeric sentinel.** Garbage on either side
  (`''`, `'0.16R'`, `'0.16.1.2'`, `'v0.17-beta'`) returns `null` via the `!left || !right`
  guard at `:52`.
- **Trimming is symmetric** between `compareAppVersions` (`:50-51`) and
  `isComparableVersion` (`:30`), over the same single `VERSION_RE`, so R4.7's
  "cannot drift apart into two regexes" holds.
- **The `detect-unsafe-regex` suppression is justified.** Every quantified group is
  separated by a literal `.` or `R`, so a digit belongs to exactly one group; there is no
  overlapping-quantifier backtracking.

### `src/composables/useAppUpdate.ts`

- **Inert on web.** `isNative()` at `:158` guards the whole body; nothing is registered,
  no floor is fetched, and `storeUrlFor('web')` returns `null` at `:39`. Pinned by
  `useAppUpdate.test.ts:78-85`.
- **The singleton is correctly guarded.** `initialized` at `:158-159` means a second
  `useAppUpdate()` call is a pure no-op returning the same `readonly(updateAvailable)`;
  the `resume` listener at `:169` is therefore registered exactly once. No second listener
  is possible without an intervening `__resetAppUpdateForTesting()`.
- **`__resetAppUpdateForTesting` is sound.** `scope?.stop()` at `:55` runs the
  `onScopeDispose` callback registered at `:172`, which is what removes the native
  listener; it then nulls `scope`, clears `initialized`, `dismissedThisSession` and
  `updateAvailable`, so a re-init is clean. Pinned by `useAppUpdate.test.ts:190-201`.
- **The listener disposal shape is right.** `App.addListener` returns
  `Promise<PluginListenerHandle>`, and `:175` uses
  `void listener.then((l) => l.remove()).catch(() => undefined)` — the same shape
  `iosShareAdapter.ts:103-106` uses, per R1.4.
- **`dismissedThisSession = true` is set at the right moment** (`:122`) — on the first
  _show_, before the `await confirm(...)`, so a `resume` arriving while the sheet is open
  cannot raise a second one, and neither answer re-arms the nag. R2.5 satisfied, pinned by
  `useAppUpdate.test.ts:115-121`.
- **The confirm sheet is a real anchor, not a post-await `openExternal`.**
  `confirmHref: url` at `:140`, threaded through `useConfirm.ts:72-86` into
  `ConfirmModal.vue:86-98`, where `<component :is="safeConfirmHref ? 'a' : 'button'">`
  keeps `@click="handleConfirm"` and the class bindings unchanged. With `confirmHref`
  unset every existing call site renders the identical `<button type="button">`.
  `safeConfirmHref` (`ConfirmModal.vue:17`) applies `safeExternalHref`
  (`url.ts:161-163`), the same screen `openExternal` uses.
- **No unhandled rejection is reachable.** `void checkForUpdate().then(() => maybePrompt(...))`
  at `:164` has no `.catch`, but nothing in either function can reject: `fetchUpdateFloor`
  is total (above), `logEvent` never throws, `isAppQuiet()` has its own `try/catch`
  (`appQuiet.ts:14-20`), `isLoaded()` is a plain boolean read (`projection.ts:35-37`), and
  `confirm()`'s promise has no reject path (`useConfirm.ts:72-86`). A defensive `.catch`
  would still be cheap.
- **`isAppQuiet()` genuinely covers a stacked confirm.** `BaseModal.vue:63` →
  `useFullscreenOverlay` → `useBodyScrollLock` → `lockBodyScroll()`
  (`useBodyScrollLock.ts:31`), which is `hasOpenOverlays()`'s counter
  (`overlayStack.ts:11-27`). So the update sheet cannot be raised over another open
  `confirm()` and silently discard its unresolved promise.
- **`isAppQuiet` really is a verbatim move.** The body at `appQuiet.ts:14-20` is
  byte-identical to the deleted `usePwaUpdater.isQuiet`, including the `try/catch`
  returning `false`, and `usePwaUpdater.ts:81, 137` now call it. Its existing tests were
  not edited.
- **The `checked` event fires once per launch on both the behind and up-to-date paths**
  (`:78-90`), carrying `floor=<version|none>,behind=<bool>` in the allowlisted `detail`
  key and the platform in the allowlisted `os` key — no new `ALLOWED_CONTEXT_KEYS` entry.

### `src/utils/payloadFailureSurface.ts`

- **`payloadErrorKind(err)` is called exactly once** and hoisted into `const kind`
  (`:171`), read twice (`:175`, `:186`), per R3.2.
- **No second `needsAppUpdate` reader was added**; the force rides on the existing
  `PAYLOAD_OVERLAY_KEY` discriminator.
- **The web overlay is byte-identical to before.** `storeUrlFor(getPlatform())` returns
  `null` for `'web'`, so `action` is `null` and no `blocked` event fires — the platform is
  asked once, at the type level, exactly as the comment at `:181-185` claims.
- **`setFatal` resets `action` on every call** (`fatalErrorStore.ts:75`,
  `action.value = opts?.action ?? null`), and `clear()` resets it (`:82`), so a store link
  cannot leak into `surfaceLineageFatal`'s unrelated block. The action is data, never a
  callback.
- **`blocked` cannot fire without a block.** All three call sites reach the unconditional
  `setFatal`, which has no early return.

### `src/App.vue` / `FatalErrorOverlay.vue` extraction

- **The markup is otherwise a faithful move.** Compared node by node against the deleted
  block: the container classes, the orange warning squircle and its SVG path, the title,
  the `clearDataHelps`-gated description, the red message slab, the confirm panel, the
  cancel button and the entire `<details>` disclosure are unchanged. The bindings are the
  only edits: `initError → message`, `initErrorDetail → detail`,
  `initErrorClearHelps → clearDataHelps`, `getDeviceDiagnostics() → diagnostics`,
  `@click="handleReload" → emit('reload')`, `@click="handleClearDataAndSignOut" → emit('clearData')`.
- **The Reload class swap preserves the old appearance exactly.** With no action, the
  ternary at `FatalErrorOverlay.vue:109-115` yields the identical string the old inline
  button carried; with an action it takes the same secondary classes Clear data uses, so
  there is exactly one orange control.
- **The emit wiring works.** Vue 3.5.41's template compiler camelizes static event
  arguments (`compiler-core.cjs.js:6173`, `toHandlerKey(camelize(rawName))`), so
  `@clear-data` compiles to `onClearData` and matches `defineEmits<{ clearData: [] }>()`.
- **`fatalAction` is a computed off the store** (`App.vue:226`), not a fourth entry in the
  mirror tuple, and `fatalActionHref` (`:227`) screens through `safeExternalHref`.
  `App.vue` gained no new mirrored ref.
- **The `clear()`-does-not-reset-the-mirror hazard did not change.** `initError` is
  written only at `App.vue:232` (the watcher, guarded `if (msg)`) and `App.vue:256`
  (`setGenericInitError`, which early-returns when a message already exists), and neither
  ever writes `null` — so the new `props.message → null` watcher branch is unreachable
  from this call site and behaves identically to the old code.

### Other

- All seven affected suites pass unedited:
  `useAppUpdate`, `versionPolicy`, `compareAppVersions`, `FatalErrorOverlay`,
  `ConfirmModal`, `fatalErrorStore`, `payloadFailureSurface` — 70 tests green.
- `web/public/min-app-version.json` ships `promptBelowVersion: "0.16"` against
  `APP_VERSION = '0.16'`, so the floor is deliberately not raised on day one:
  `compareAppVersions('0.16', '0.16') === 0`, no prompt.
- `packages/brand/nav.ts` `STORE_URL` is `as const satisfies Record<'ios' | 'android', string>`,
  so a third native platform in `getPlatform()`'s union fails the build at the constant.
- No import cycle is introduced: walking every non-type static import from
  `useAppUpdate.ts` reaches 215 `src/` modules and none of them is
  `payloadFailureSurface.ts`.
