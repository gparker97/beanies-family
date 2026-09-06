# R2 — Error handling, silent failures, and observability

> Reviewing commit `af38fe75` ("feat(native): ask people to update, and give the block a way out")
> against `docs/plans/2026-09-07-native-update-gate.md` (Error-handling table rows 1-7, and the
> `## Observability Coverage` section) and `CLAUDE.md` § "Observability & Diagnostic Logging".
> Dimension: every catch, every fallback, every emitted event, the context allowlist, rate
> limiting, `reportError` usage, and privacy.

**Headline: the context-key claim holds. Every key the new code emits is allowlisted, on both
sides of the wire, and no event's `message` varies per call.** Four real defects were found, one
of which defeats the plan's single stated guarantee for the block screen ("never a dead end"),
and two of which will actively mislead triage. Details below.

---

## Findings

### 1. HIGH — the block screen becomes a genuine dead end when the href is screened away, and says nothing about it

**Where:** `src/components/common/FatalErrorOverlay.vue:133-138` (and the test that was weakened
to match it, `src/components/common/__tests__/FatalErrorOverlay.test.ts:88-94`)

```html
<p v-if="action && actionHref" class="dark:text-ink-soft mt-1 mb-4 text-xs break-all text-gray-500">
  {{ actionHref }}
</p>
```

**What is wrong.** The plan makes the caption the _guarantee_ and the link the _convenience_:

- R3.4: "**Never a dead end.** The `url` caption is **unconditional**, not shown only after a
  failure … The on-screen text is the guarantee; the link is the convenience."
- Error table row 5: "Both surfaces screen it through `safeExternalHref` in a computed and render
  no link when it fails, **leaving the caption (block)** or a plain button (prompt)."
- Testing plan item 7: "a non-http(s) `url` **renders the caption** but no anchor."

The shipped component gates the caption on `actionHref` — the _screened_ value — not on
`action.url`, and renders `actionHref` rather than `action.url`. So when `safeExternalHref`
rejects the URL, **both** the anchor and the caption vanish together. The component's own header
comment (`:128-132`) still claims the caption is unconditional; it is not. The test at `:88` was
written to assert only the anchor half ("renders no anchor when the href was screened away"), so
the missing half is not caught.

**Concrete failure scenario.** A later change swaps `STORE_URL.android` for the deep-link form
`market://details?id=family.beanies.app` (a natural-looking improvement — it opens Play directly
instead of the web listing). `safeExternalHref` allows only `https:` / `http:`
(`src/utils/url.ts:161-163`), so `fatalActionHref` (`src/App.vue:227`) becomes `null`. An Android
user who opens a beanpod their build cannot parse now sees: the "your family file needs a newer
beanies" message, a Reload button that re-runs the same failure, **no link, and no URL text at
all**. They are hard-stopped with no way out — exactly the state R3.4 exists to make impossible.

It is worse than silent to the user: it is silent to us too. `surfacePayloadFatal` emits its
`blocked` event at `payloadFailureSurface.ts:188-197` _before_ any screening, gated only on
`storeUrlFor(...)` returning a non-null string. So CloudWatch records
`action=blocked, os=android` — i.e. "we gave them a way out" — for every device that got no way
out. Nothing anywhere logs the screening rejection.

**Suggested fix.** Two changes:

1. `v-if="action"` and `{{ action.url }}` on the caption, so the raw URL is on screen whether or
   not it survived screening. Vue text interpolation escapes it, so an unscreened value in a text
   node is safe — which is precisely why the plan chose this shape.
2. Emit one `warn` on the `app-update` surface when `action` is present but the screened href is
   null (`error_code: 'needs-update'`, `detail: 'href-screened'`), so a mis-set `STORE_URL` is a
   row in CloudWatch rather than a support ticket. This is a fallback with no event, which
   `CLAUDE.md` rule 1 forbids ("Log the decision, not just the crash").
3. Restore the plan's test-7 assertion: with `actionHref: null` the caption still renders.

---

### 2. MEDIUM — the floor's error classifier reports iOS timeouts and DNS failures as `malformed`, i.e. "the deployed JSON is broken"

**Where:** `src/services/appUpdate/versionPolicy.ts:109-119`

```ts
  } catch (e) {
    const msg = e instanceof Error ? e.message.toLowerCase() : '';
    const reason: FloorFailure = msg.includes('timeout')
      ? 'timeout'
      : msg.includes('network') || msg.includes('internet') || msg.includes('connect')
        ? 'offline'
        : 'malformed';
    return (cached = { value: report(reason) }).value;
  }
```

**What is wrong.** The `detail` classes exist for exactly one purpose, stated in the plan's error
table row 2: "a **distinct `detail` class so a bad deploy is distinguishable from a bad
network**." This classifier's _default_ for any unrecognised thrown error is `malformed`, which
row 2 defines as a body problem. The transport errors it will actually see do not match its
keywords:

- **iOS.** `node_modules/@capacitor/ios/Capacitor/Capacitor/Plugins/CapacitorHttp.swift:30`
  rejects with `error.localizedDescription`, and the request is a `URLSession` request with
  `request.setTimeout(timeout)` (`Plugins/HttpRequestHandler.swift:203-205`). A read/connect
  timeout is `NSURLErrorTimedOut`, whose `localizedDescription` is **"The request timed out."** —
  lowercased that contains neither `timeout` nor `network`/`internet`/`connect`, so it falls
  through to `malformed`. A DNS failure (`NSURLErrorCannotFindHost`, "A server with the specified
  hostname could not be found.") does the same.
- **Android.**
  `node_modules/@capacitor/android/.../plugin/CapacitorHttp.java:69` rejects with
  `e.getLocalizedMessage()` from an `HttpURLConnection` configured with
  `setConnectTimeout` / `setReadTimeout`
  (`plugin/util/HttpRequestHandler.java:112-113`). A `SocketTimeoutException` surfaces variously
  as `timeout` (→ correct), `Read timed out` (→ `malformed`), or
  `failed to connect to … after 3000ms` (a _connect timeout_ → classified `offline`).

The `timeout` class is therefore close to unreachable on iOS and unreliable on Android, and
`malformed` has silently become the catch-all bucket for network faults.

The unit test does not catch this because it asserts against a synthetic message no platform
produces: `versionPolicy.test.ts:82` uses `'Request timeout'`. Nothing in the Capacitor stack
emits that string.

**Concrete failure scenario.** The 3-second timeouts (`versionPolicy.ts:86-87`) are tight for a
phone on a weak mobile network, so timeouts will be a routine class. A spike of
`surface=app-update, action=check-failed, detail=malformed` appears in CloudWatch. The runbook
section this commit added tells the reader `floor=none` means "the file is not being read"
(`docs/runbooks/native-store-submission.md`, §7 step 4), and `malformed` reads as "the JSON we
hand-deployed is wrong". Someone re-runs the web deploy, or rolls the floor back, for a fleet
whose file is perfectly fine. Meanwhile a genuinely malformed deploy is indistinguishable from
the noise — which is the exact confusion the class split was designed to prevent.

**Suggested fix.** Widen `FloorFailure` with a distinct transport class and make it the default,
so `malformed` only ever means "the bytes were wrong":

```ts
const reason: FloorFailure = /timeout|timed out/.test(msg)
  ? 'timeout'
  : /network|internet|connect|host|offline|ssl/.test(msg)
    ? 'offline'
    : 'request-failed'; // new class; NEVER 'malformed' — that means the body
```

and add a test case for the two real strings, `'The request timed out.'` and
`'Read timed out'`, since those are the ones a device produces.

---

### 3. MEDIUM — `canPrompt()` suppresses the prompt through four independent gates and emits nothing, so "behind but never asked" is unattributable

**Where:** `src/composables/useAppUpdate.ts:99-116`

```ts
function canPrompt(isOnline: boolean): boolean {
  return (
    updateAvailable.value && !dismissedThisSession && isOnline && isAppQuiet() && isLoaded()
  );
}

async function maybePrompt(isOnline: boolean): Promise<void> {
  if (!canPrompt(isOnline)) return;
  const url = storeUrlFor(getPlatform());
  if (!url) return;
```

**What is wrong.** This is a five-way degradation path with no diagnostic event on any arm. It is
a direct violation of `CLAUDE.md` § Observability rule 1: "**Log the decision, not just the
crash.** Every non-trivial branch, fallback, retry, and degradation emits a structured event
carrying enough `context` to explain _why_ it happened … The bar is 'diagnose from the logs
alone.'" The funnel as shipped is `checked` → `prompted` → `prompt-dismissed`, with nothing
between the first two.

This matters more than usual because of a race the code does not resolve. `useAppUpdate()` is
called from `App.vue` setup (`src/App.vue:1666`), and the launch-time evaluation is
`void checkForUpdate().then(() => maybePrompt(isOnline.value))` (`useAppUpdate.ts:164`) — it runs
as soon as the floor request resolves, with **no wait on `isLoaded()`** and no watcher on any of
the gates. `isLoaded()` (`src/services/automerge/projection.ts:36`) is false until a full
projection has been pushed, i.e. after cache decrypt + Automerge load — the multi-second path this
project has a whole perf workstream about. The floor is a small static JSON over an already-warm
connection. So on most launches the launch-time `maybePrompt` will lose the race, return silently,
and the prompt becomes **resume-only**: a person who opens the app and uses it without ever
backgrounding and returning is never asked. The composable's own test acknowledges the deferral
(`useAppUpdate.test.ts:156-166`, "asks on resume once a gate that was closed at launch has
opened") but nothing pins or measures which side wins on a real device.

**Concrete failure scenario.** The floor is raised for the beanpod 5.0 rollout. CloudWatch shows a
healthy denominator: thousands of `action=checked, detail=floor=0.17,behind=true`. `prompted` is a
small fraction of that. Nobody can tell whether the fleet is offline, mid-save, sitting behind an
overlay, or simply never getting past `isLoaded()` at launch — the four have identical (absent)
signatures. The most likely cause is the one that needs a code change, and there is no data
pointing at it. The feature looks deployed and is mostly inert.

**Suggested fix.** One `debug`-level event on the suppression path, reusing allowlisted keys only:

```ts
logEvent({
  level: 'debug',
  surface: 'app-update',
  message: 'update prompt suppressed', // constant
  context: { action: 'prompt-suppressed', os: getPlatform(), detail: reason },
});
```

where `reason` is the first closed gate (`already-asked` / `offline` / `not-quiet` /
`not-loaded` / `no-store-url`), and emitted at most once per gate per launch so the rate cap is
not a concern. Separately, consider making the launch-time evaluation wait on `isLoaded()`
(a `watch`/`until` on the projection) rather than relying on a resume that may never come — but
the observability gap should be closed either way, because it is what would have surfaced the
race.

---

### 4. LOW-MEDIUM — `blocked` is emitted only when a store URL exists, so a web `needs-update` block is counted nowhere on the `app-update` surface

**Where:** `src/utils/payloadFailureSurface.ts:186-197`

```ts
  const storeUrl = kind === 'needs-update' ? storeUrlFor(getPlatform()) : null;
  if (storeUrl) {
    logEvent({ level: 'warn', surface: 'app-update', message: 'blocked on an app update', … });
  }
```

**What is wrong.** The plan defines the event without a platform qualifier: "`blocked` (warn):
`action: 'blocked'`, `error_code: 'needs-update'`, `os`. **A person who cannot use the app until
they update is worth counting**, and `warn` reaches CloudWatch without paging." The implementation
couples the _counter_ to the _affordance_: the event fires only when there is a link to offer,
which by construction is native only. On web the same full-screen `resumeSetup.podNewerVersion`
overlay is raised with zero rows on this surface — and `reportPayloadFailure` returns early for
this kind, because `PAYLOAD_IS_INCIDENT['needs-update'] === false`
(`payloadFailureSurface.ts:88-94, 111`), so that path emits nothing either. The behaviour is
deliberately pinned by the new test (`payloadFailureSurface.test.ts`, "attaches NO action on web,
for %s" → `expect(logEvent).not.toHaveBeenCalled()`), so this is a decision, not an oversight —
but it is a decision the plan does not authorise.

**Concrete failure scenario.** Beanpod 5.0 ships. A cohort of web users on a stale precached
bundle (the service worker has not applied the new build yet — the exact window `usePwaUpdater`
exists to close, and it can be minutes to a whole session) hits the block at boot. The
`app-update` surface reports nothing, so the natural query "how many people were hard-stopped by
the format change, and where?" returns native-only numbers and reads as "the web is fine".

**Mitigation that already exists** (which is why this is not ranked higher): some — not all —
needs-update paths are separately reported at `severity: 'warning'` on the `pod-load-failure`
surface with `detail: version=<x>`, at `src/services/sync/syncService.ts:148-160` and `:2127-2136`.
Whether a given boot-path block reaches one of those depends on the caller, so coverage is
partial and unstated.

**Suggested fix.** Move the `logEvent` out of the `if (storeUrl)` block and gate it on
`kind === 'needs-update'` alone, keeping `os: getPlatform()` so the platform split stays
queryable. Add `detail: storeUrl ? 'has-store-link' : 'no-store-link'` so "was there a way out?"
is answerable from the same row. The web test then asserts no _action_, which is the real
regression it is protecting, rather than no _telemetry_.

---

### 5. LOW — `unparseable-version` is emitted from two places with identical surface/message/context, meaning two different things

**Where:** `src/services/appUpdate/versionPolicy.ts:105-107` and `src/composables/useAppUpdate.ts:72-79`

Both emit `surface: 'app-update'`, `message: 'update floor unavailable'`,
`context: { action: 'check-failed', error_code: 'floor', detail: 'unparseable-version' }`. They
are byte-identical in CloudWatch and cannot be told apart.

They do not mean the same thing. The versionPolicy one means "the hand-deployed JSON has a typo".
The composable one can only fire when `compareAppVersions(APP_VERSION, floor)` returns `null` with
a non-null floor — and `fetchUpdateFloor` has already run `isComparableVersion(raw)` on the floor
(`versionPolicy.ts:105`), so the _only_ way to reach it is **`APP_VERSION` itself being
unparseable**. That is a different file, a different owner, and a different fix.

**Concrete failure scenario.** Someone ships an RC as `APP_VERSION = '0.17-beta'`.
`VERSION_RE` (`src/utils/compareAppVersions.ts:26`) rejects it, so `behind` is permanently `false`
and **the update prompt is dead fleet-wide** — while every device emits a `check-failed` whose
class points the on-call at `min-app-version.json`, which is correct and untouched.

Note also that the composable's test for this (`useAppUpdate.test.ts:135-144`, floor
`'v0.17-beta'`) mocks `fetchUpdateFloor` and therefore exercises a state production cannot reach,
which is why the ambiguity was not visible.

**Suggested fix.** Give the composable's branch its own class, e.g.
`detail: 'unparseable-app-version'`, and say so in the comment. One line, and it turns a
misleading row into a correct one. (Minor, same site: `compareAppVersions(APP_VERSION, floor)` is
evaluated twice at `:71` and `:72`; compute it once into a `const cmp`.)

---

### 6. LOW — the only truly silent swallow in the new code is the listener-removal catch

**Where:** `src/composables/useAppUpdate.ts:172-176`

```ts
onScopeDispose(() => {
  void listener.then((l) => l.remove()).catch(() => undefined);
});
```

A rejected `remove()` leaks a native `resume` listener and reports nothing — the file's own
comment calls a leaked listener "a silent failure with a long fuse" and then swallows the one
signal that it happened. This is the shape R1.4 explicitly prescribed
(`src/services/share/iosShareAdapter.ts:103-106`), and in production the scope is never disposed
(the singleton lives for the process), so reachability is near zero. Flagged for completeness
only; if touched, a `logEvent` at `debug` with `detail: 'listener-remove-failed'` costs nothing.

---

### 7. LOW — accepting the prompt is inferred from an absence that has two causes

`maybePrompt` emits `prompted` before the sheet opens (`useAppUpdate.ts:123-128`) and
`prompt-dismissed` only when `accepted === false` (`:143-150`). Phase A deliberately has no
`update-started` (plan: "on Phase A the funnel ends at `prompted` plus the store handoff"), so
"they tapped Update" is measured as _`prompted` without a following `prompt-dismissed`_. That
absence also describes "the OS killed the app while the sheet was open", and — because the anchor
navigates away — the two are the common cases, not edge cases. The conversion number the runbook
invites you to read will be an over-count of unknown size. If it is worth measuring, a
`prompt-accepted` info event in the `if (accepted)` arm is one branch and reuses `action`/`os`.

---

## Verified correct

Everything below was checked against the code, not assumed.

**Context allowlist (the plan's load-bearing "no new context key" claim) — holds, on both sides.**
The four keys the new code uses are all present in `ALLOWED_CONTEXT_KEYS`
(`src/utils/diagnosticContext.ts:61`): `action` at `:68`, `error_code` at `:69`, `os` at `:100`,
`detail` at `:185`. The Lambda mirror carries all four —
`infrastructure/lambda/telemetry/index.mjs:74` (`action`), `:78` (`error_code`), `:100` (`os`),
`:139` (`detail`) — so nothing is dropped server-side either. No new key is introduced anywhere in
the diff, and `docs/runbooks/native-store-submission.md` §1's data-collection table is untouched
(the diff only replaces `## 7. Notes` with the new §7 and renumbers Notes to `## 8`), which is
what the plan required.

**`os` is not clobbered by the enricher.** `enrichAndRedact`
(`src/utils/diagnosticContext.ts:494-557`) backfills `build_sha`, `family_id`, `provider_type`,
`save_failure_level`, `drive_file_not_found`, `online`, `connection_type`, `browser` and
`web_storage` — it never writes `raw.os`, and the caller's context is spread at `:500`. So
`os: getPlatform()` survives to CloudWatch. The precedent the plan cited is real
(`src/services/share/iosShareAdapter.ts:68, 92`).

**Rate limiting — every new event uses a constant `message`.** The bucket key is
`${surface}::${normalizeMessage(message)}` with a 60s window and a 50 cap
(`src/services/telemetry/logEvent.ts:74-76, 86`). The six new messages are all string literals:
`'update floor unavailable'` (`versionPolicy.ts:56`, `useAppUpdate.ts:76`), `'update check'`
(`useAppUpdate.ts:89`), `'update prompted'` (`:126`), `'update prompt dismissed'` (`:147`),
`'blocked on an app update'` (`payloadFailureSurface.ts:191`). Every varying value —
the floor version, `behind`, the failure class, the HTTP status — rides in `detail`, which is not
part of the bucket key. `versionPolicy.test.ts:94-103` pins this for the failure path.

**`checked` genuinely fires once per launch, on both the success and the failure path.**
`fetchUpdateFloor` cannot reject: `CapacitorHttp.get`, the `JSON.parse` of a string body and the
shape checks are all inside the one `try` (`versionPolicy.ts:72-119`), every failure arm returns
through `report()` (which returns `null`), and `logEvent` is contractually non-throwing
(`logEvent.ts:133-137`). So when the floor resolves `null`, control still reaches
`useAppUpdate.ts:86-95` and emits `action: 'checked'` with `detail: floor=none,behind=false`.
Traced by hand and pinned by `useAppUpdate.test.ts:129-133, 168-180`. The emission site is inside
`if (isNative() && !initialized)` (`:158`) and `checkForUpdate` has exactly one caller (`:164`),
so it is once per launch and never on web. A dead floor (`floor=none` fleet-wide) is genuinely
distinguishable from a healthy one, which was the point.

**No `reportError` misuse, and nothing new pages.** The new code calls `reportError` nowhere; it
uses `logEvent` at `warn` for degradations and `info` for the funnel, per the plan's "nothing here
pages, by construction". The block path is correctly non-paging for the right reason:
`reportPayloadFailure` returns early because `PAYLOAD_IS_INCIDENT['needs-update'] === false`
(`payloadFailureSurface.ts:88-94, 111`), which is pre-existing and unchanged. Nothing in the feature
is a case where a user action failed and no report was made — the two user-facing failures are the
prompt (dismissible, non-consequential) and the block (which does report, on native; see
finding 4).

**No bare `catch {}`.** Three catches exist in the touched code. `versionPolicy.ts:109`
classifies and logs (its classification is wrong for some inputs — finding 2 — but it is not
silent). `appQuiet.ts:17` is the verbatim move of `usePwaUpdater`'s private `isQuiet`, keeping its
documented "pre-init → treat as not quiet" reason, which the plan's error row 7 explicitly
sanctions; the fail-safe direction is the same for both callers (defer). `useAppUpdate.ts:175` is
finding 6.

**Unhandled rejections have a real safety net.** `void checkForUpdate().then(() => maybePrompt(…))`
(`useAppUpdate.ts:164`) and `void maybePrompt(isOnline.value)` in the resume handler (`:170`) carry
no `.catch`, but no callee can reject: `fetchUpdateFloor` catches everything, `isAppQuiet` catches,
`isLoaded()` is a field read (`src/services/automerge/projection.ts:34-37`), `confirm()` never
rejects (`src/composables/useConfirm.ts:72-88`), and `logEvent` never throws. If one ever did, it
lands on `main.ts:71`'s `unhandledrejection` handler, which reports to the firehose at
non-critical severity — visible, not silent.

**Privacy — nothing new leaves the device that should not.** Checked every value:

- `versionPolicy.ts:110-117` reads `e.message` **only** to classify; the raw message never reaches
  a `logEvent`, so a URL, a hostname or a JSON fragment from `SyntaxError` cannot ride out. The
  comment at `:110-111` states exactly this, and it is true of the code.
- `detail: floor=<version>,behind=<bool>` (`useAppUpdate.ts:93`) carries only a value from a file
  we publish and a boolean.
- No family id beyond the existing `family_id` backfill, which the enricher has always added; no
  password, key, envelope or document content anywhere in the new context objects.
- `MAX_STRING_LEN` (200) is never approached by any of these values.
- The `blocked` event carries a fixed enum trio only (`payloadFailureSurface.ts:192`).

**The new `appVersion` field does not escape the device.** `payloadErrorDetail`
(`src/types/sync.ts:512-530` (the new field at `:526`)) has exactly one call site, `payloadFailureSurface.ts:201`, whose
return value becomes `fatalErrorStore.detail`. That is mirrored into `App.vue`'s
`initErrorDetail` (`:199, 233, 257`) and used in exactly one place — the `:detail` prop at
`App.vue:1871` — which `FatalErrorOverlay.vue:171-174` renders inside the collapsed `<details>`
`<pre>`. It reaches no telemetry surface, no clipboard automatically, and no third party. The
worker concern the plan raised is also fine: the added import is `@/constants/appVersion`, which
imports nothing.

**The store handoff will not lose the `prompted` event.** No new event sets `flush: true`, which
would have been a concern given the anchor navigates the app away. It is covered:
`logQueue.ts:211-212` flushes on `visibilitychange` when the tab/app is hidden, which is exactly
what a store handoff triggers, and `pagehide` beacons on a true unload (`:218-219`).

**The block's classification is asked once and cannot drift.** `payloadErrorKind(err)` is hoisted
into `const kind` (`payloadFailureSurface.ts:171`) and read twice from there, per R3.2; no second
`needsAppUpdate` reader was added; the web guarantee is carried by `storeUrlFor` returning `null`
for `'web'` (`useAppUpdate.ts:39-41`), pinned directly by `useAppUpdate.test.ts:87-93` and swept
across the whole kind union by the new `payloadFailureSurface.test.ts` cases.

**The stale-action regression is closed.** `setFatal` assigns `action.value = opts?.action ?? null`
unconditionally (`src/stores/fatalErrorStore.ts`, in the `setFatal` body) and `clear()` resets it,
so `surfaceLineageFatal`'s action-less call cannot inherit a store link from an earlier
needs-update block. Pinned by `src/stores/__tests__/fatalErrorStore.test.ts:34-40` and `:42-48`,
including the "never holds an action without a message" invariant `App.vue`'s computed relies on
(`:50-63`).

**The lint zone is real and correctly scoped.** `eslint.config.js` adds a `no-restricted-globals`
block for `src/services/appUpdate/**` banning `fetch`, and the message states its own limit ("it
catches a bare `fetch` only, not `window.fetch` or `globalThis.fetch`"), which is what the plan
asked for. `versionPolicy.ts` uses `CapacitorHttp.get` and imports no `fetch`.

---

### One note outside this dimension

`src/utils/payloadFailureSurface.ts:29` imports `storeUrlFor` from
`@/composables/useAppUpdate`, which pulls `@capacitor/app`, `@capacitor/core`, `useConfirm`,
`useOnline`, `appQuiet` (→ `syncStore`) and the Automerge projection module into the app's payload
chokepoint and into every pre-login surface that imports it (`LoginPage.vue`, `LoadPodView.vue`,
`SettingsPage.vue`, `useBiometricSignIn.ts`, `useLoginFlow.ts`). The plan's acceptance criterion
says "`payloadFailureSurface.ts` imports no composable and no plugin", and R6.1 put the constant in
`packages/brand/nav.ts` precisely so this file would "import one constant". I checked for an import
cycle and found none (nothing in that graph imports `payloadFailureSurface`), so there is no
concrete TDZ or init-order failure to report — which is why this is a note and not a finding. It
belongs to the architecture reviewer; moving `storeUrlFor` next to `STORE_URL` in
`packages/brand/nav.ts`, or into `src/utils/`, would satisfy both the criterion and this file's
deliberately short import list.
