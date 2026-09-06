# R6 — Round 2 adversarial sweep: what round 1 missed

> Reviewed: `git diff af38fe75~1..a0f6555e` (the feature plus the round-1 fixes, as one artefact).
> Round-1 reports read first (R1–R4 + FIXES) so nothing here restates a finding already made.
> Date: 2026-09-07

Round 1 read the new code very closely and found real defects in it. What it did not do
is ask what the new code does to the app it was dropped into. Every finding below is
about an interaction — with an app-wide coordinator, with the overlay it can hide
behind, with a memo whose lifetime is longer than the word used to describe it — and
none of them are visible from inside `useAppUpdate.ts` alone.

The two that matter are #1 and #2. Both are cases where the feature is correct on its
own terms and breaks a rule the rest of the app keeps.

---

## Findings

### 1. The update prompt is an unsolicited pop-up that does not claim the interruption slot

**Severity: medium.**
**Where:** `src/composables/useAppUpdate.ts:122-175` (`maybePrompt`), against
`src/composables/useSessionInterruption.ts:1-37`.

`useSessionInterruption.ts:1-17` is unambiguous, and it is a rule with a tracker number
behind it:

> #45 — single-interruption-per-session coordinator.
> At most ONE unsolicited "look at me" surface may open per tab-load. **Every**
> auto-appearing surface (what's-new drawer, onboarding wizard, passkey/trust modal,
> install prompt, PWA-reinstall, feedback survey) calls `claimInterruption` at its true
> show-site and only shows if it wins; later surfaces yield.
>
> User-initiated opens (buttons), action-driven celebrations, and state-driven
> toasts/banners never call this — the rule governs only unsolicited auto-popups.

The update prompt is squarely inside that definition: nobody asked for it, it appears on
its own, and it is a modal. Six surfaces honour the rule
(`src/App.vue:1850` auth-prompt, `src/stores/notificationsStore.ts:292`,
`src/components/onboarding/OnboardingWizard.vue:94`,
`src/components/common/PwaReinstallModal.vue:42`,
`src/components/common/InstallPrompt.vue:18`,
`src/composables/useFeedbackModal.ts:54`). This one does not call
`claimInterruption` anywhere, and it does not consult `wasInterrupted()` either.

**Concrete failure scenario.** A person signs in fresh on an iPhone running a build below
the floor. `App.vue:1791-1851` resolves the ordered auth-prompt chain (pin → kit →
native-biometric → trust), wins the slot with `claimInterruption('auth-prompt')`, and
shows the PIN modal. That modal takes the body-scroll lock, so `isAppQuiet()` is false
and `maybePrompt` defers with `busy` — correctly. The person sets their PIN and the modal
closes. The next `docVersion` bump (`useAppUpdate.ts:203` — and on a signed-in device
those arrive constantly) reopens the gate and the update prompt fires. **Two unsolicited
modals in one session, which is the exact thing #45 exists to make impossible**, and the
second one interrupts a person who has just been interrupted about security.

The reverse is also true and is the sharper half: because the update prompt never _takes_
the slot, it also cannot yield it. If the update prompt wins the race, the onboarding
wizard or the PWA-reinstall modal still fires afterwards, because from the coordinator's
point of view nothing has interrupted anyone yet.

**Suggested fix.** Call `claimInterruption('app-update')` at the true show site — after
`promptBlocker` returns null and after the `url` check, immediately before
`dismissedThisSession = true` — and treat a lost claim like any other blocker (a
`prompt-deferred` row with `detail: 'interrupted'`, and no consumption of
`dismissedThisSession`, so it retries on the next gate opening). If the judgement is that
an update prompt should _outrank_ the auth chain, that is a defensible call, but it has to
be made in `useSessionInterruption.ts` as a documented priority rather than by silently
not participating.

---

### 2. `isLoaded()` is a boot guard being used as a fatal-overlay guard, and the comment claims otherwise

**Severity: medium.**
**Where:** `src/composables/useAppUpdate.ts:100-109`,
`src/components/common/FatalErrorOverlay.vue:75-78`, `src/App.vue:1001-1013`.

The guard's own comment names two surfaces:

```ts
// ⚠️ NOT BEFORE THE APP IS PAST BOOT. `ConfirmModal` renders at z-250 and the
// boot spinner and fatal overlay are both z-300, so a prompt raised during
// boot is a modal nobody can see or dismiss, holding `hasOpenOverlays()` true
// for the rest of the session.
if (!isLoaded()) return 'booting';
```

— `useAppUpdate.ts:103-107`

`isLoaded()` tracks the boot spinner acceptably (`isInitializing` is cleared at
`App.vue:1266`, before the document loads, so by the time `loaded` flips true at
`projection.ts:112-117` the spinner is already gone). **It tracks the fatal overlay not at
all.** `promptBlocker` never reads `fatalErrorStore.message`, and
`FatalErrorOverlay.vue:75-78` is a bare `<div v-if="message" class="fixed inset-0
z-[300] …">` — it is not a `BaseModal`, so it takes no body-scroll lock and
`hasOpenOverlays()` (`src/utils/overlayStack.ts:26`) stays false while it is up. It also
captures pointer events (no `pointer-events-none`, unlike the boot spinner at
`App.vue:1874`).

**Concrete failure scenario.** Cold start on a native device, no cached family key, so
init takes path 1b (`App.vue:735`). `syncStore.loadFromFile()` succeeds, `docClient`
calls `bumpDocVersion()`, `loaded` flips **true** and `docVersion` bumps. Note that
path 1b's success branch (`App.vue:740-747`) never clears `isLoadingData` — only the
`finally` at `App.vue:1585` does. Now `processRecurringItems()` (or any later await in
`init()`) hangs, which is the exact class of wedge the watchdog was written for after the
iOS onboarding freeze. At 35s the watchdog at `App.vue:1001-1013` sees
`isLoadingData === true`, calls `setGenericInitError(t('app.initError.stalled'), …)`, and
the z-300 recovery overlay paints.

State at that moment: `isLoaded()` **true**, `hasOpenOverlays()` **false**,
`useSyncStore().isSyncing` false (polling was deferred and no sync is running), online
true. Every gate in `promptBlocker` is open. The next `resume` — and this is a person
staring at "beanies had trouble starting", so switching away and back is the likely next
thing they do — fires `maybePrompt` at `useAppUpdate.ts:208-210`. A `ConfirmModal` opens
at z-250 **underneath an opaque, pointer-capturing z-300 overlay**: invisible,
untappable, no Escape on a phone, backdrop unreachable. It holds the body-scroll lock for
the rest of the session (wedging `useQuickAdd.ts:101` and
`useWheelMonthPaging.ts:415`), burns `dismissedThisSession`, and logs `action: 'prompted'`
to CloudWatch for a prompt no human ever saw. This is, line for line, the failure the
comment above says the guard prevents.

The same-order variant needs no `resume` at all and is more likely: the prompt opens
legitimately on the `docVersion` bump while the app is quiet, the person is reading it,
and 35 seconds later the watchdog paints the fatal overlay on top of it. Nothing closes
the `ConfirmModal` and nothing resolves its promise — `FatalErrorOverlay` has no
awareness of the confirm singleton.

**Suggested fix.** Make the guard say what it means. Add a fourth blocker that reads the
store directly, e.g. `if (useFatalErrorStore().message) return 'fatal';` in
`promptBlocker` (inside the existing `try` shape of `isAppQuiet`, or with its own
try/catch since `promptBlocker` runs before Pinia is guaranteed on some paths). That is a
one-line read of the same state `FatalErrorOverlay` renders from, and unlike `isLoaded()`
it cannot drift when a future `setFatal` caller runs post-load — which
`syncStore.ts:3539` already flags as the live hazard ("`surfacePayloadFatal` runs where
the app has NO document — that is its stated invariant"; the watchdog's
`setGenericInitError` is not bound by that invariant and is the counter-example).

---

### 3. The floor is fetched once per PROCESS, and "process" on iOS is not "launch"

**Severity: medium-low.**
**Where:** `src/services/appUpdate/versionPolicy.ts:40-50` and `:116-117`,
`src/composables/useAppUpdate.ts:204-207`, `docs/runbooks/native-store-submission.md:571-575`.

`fetchUpdateFloor` memoises for the process (`cached` at `versionPolicy.ts:45`,
short-circuit at `:117`), `checkForUpdate()` is called exactly once from
`useAppUpdate.ts:188`, and the resume path deliberately does not re-fetch:

```ts
// Resume re-evaluates the GATES, it does not re-fetch: the floor is
// memoised for the process, but the device may have come back online, the
// save may have finished, or the overlay may have closed while away.
```

— `useAppUpdate.ts:205-207`

The justification given in FIXES and in the code is that a per-resume fetch "would buy
nothing". That is true on the web, where a process is a page load. It is not true on iOS,
where a suspended app's WebView survives for days or weeks and `resume` is the normal way
the app is used. The comment at `useAppUpdate.ts:41-45` makes the same assumption
explicitly — "A module boolean is exactly the lifetime wanted: it dies with the app" —
and on iOS it frequently does not.

**Concrete failure scenario.** beanpod 6.0 ships; the floor is raised on Monday per
runbook § 7 precisely so devices are warned _before_ they hit a file they cannot open. A
phone that has had beanies resident since Sunday resumes fifty times that week and never
re-reads the floor, so it is never prompted — and then hits the block. Worse for triage:
its once-per-launch `checked` event carries the **old** `floor=` value, so CloudWatch
shows a split fleet after the deploy, which reads as a CDN or invalidation problem rather
than as the memo doing exactly what it was told to.

The runbook states the wrong operational expectation as a result:

> Devices pick it up within about an hour (the request carries an hour bucket to defeat
> the device's own HTTP cache).
> — `docs/runbooks/native-store-submission.md:574-575`

The hour bucket at `versionPolicy.ts:133` is computed once per process, so within a
process it never produces a second URL. The true statement is "devices pick it up on
their next cold launch, and the hour bucket bounds how stale that launch's copy can be."

**Suggested fix.** Either (a) give the memo a TTL — store `fetchedAt` alongside `value`
and let `fetchUpdateFloor` re-fetch when older than, say, 6h, which costs one 3-second
request per resume-after-6h and makes the hour bucket mean what the runbook says; or (b)
leave the behaviour and correct both the runbook sentence and the two comments to say
"next cold launch", so nobody raises the floor expecting same-day coverage.

---

### 4. `maybePrompt`'s sixth suppression is still silent, and is dead code with no note saying so

**Severity: low.**
**Where:** `src/composables/useAppUpdate.ts:139-140`.

```ts
const url = storeUrlFor(getPlatform());
if (!url) return;
```

FIXES #2 fixed "canPrompt suppressed silently, five ways" by adding `prompt-deferred` for
the three `promptBlocker` reasons; these two lines are the remaining silent return, and
they are the _worst_ of the set to leave silent, because unlike the other blockers this
one does **not** set `dismissedThisSession`. If it ever fires it re-runs on every
`docVersion` bump forever, emitting nothing at all.

It is also unreachable today: `useAppUpdate.ts:182` only initialises when `isNative()`
(`capabilities.ts:46-48` → `Capacitor.isNativePlatform()`), and `storeUrlFor`
(`storeUrl.ts:22-24`) returns null only for `'web'`. So this is a guard no test can make
fail — which `payloadFailureSurface.ts:180-184` explicitly names as an anti-pattern in
this very change ("A second reader here would be a guard no test could make fail, which
is the kind of safety net that reads as covered without being it"). The two files
disagree about the same idea, and the one with the unreachable guard says nothing about
it.

**Suggested fix.** Either drop the branch and let the type carry it (`getPlatform()`
narrowed by `isNative()`), or keep it and give it the same treatment as the other
blockers: a `prompt-deferred` row with `detail: 'no-store-url'` plus a one-line comment
saying it is unreachable by construction and exists against a third platform.

---

### 5. `useAppUpdate()`'s return value is dead

**Severity: low.**
**Where:** `src/composables/useAppUpdate.ts:46`, `:181`, `:219`.

`useAppUpdate()` returns `{ updateAvailable: readonly(updateAvailable) }`. Nothing reads
it: `App.vue:1680` calls it as a bare statement, and a repo-wide grep for
`updateAvailable` finds no consumer outside the module — not a component, not a store,
not even the composable's own test file. So a `readonly()` proxy is allocated on every
call, and web callers get a ref that is permanently `false` because `checkForUpdate()`
never runs there.

The plan's own framing is that an unreachable force path "reads as covered when it is not"
(`useAppUpdate.ts:11-18`); a returned-but-unread reactive value is the same shape of
claim. This is exported API surface implying somewhere renders an update badge, and
nowhere does.

**Suggested fix.** Return `void` and keep `updateAvailable` module-private, or add the
consumer that justifies it (a Settings row saying "an update is available" would be a
reasonable one). Either is fine; shipping the ref with no reader is not.

---

### 6. `confirm()` is a module singleton with no re-entrancy guard, and this change adds its first non-user-initiated caller

**Severity: low (structural; narrow today).**
**Where:** `src/composables/useConfirm.ts:53-88` and `:100-111`, driven from
`src/composables/useAppUpdate.ts:158-165`.

`confirm()` overwrites `state.value` wholesale, including `resolve`
(`useConfirm.ts:74-86`). A second call while one is open **orphans the first promise: it
never settles, in either direction.** There is no guard, no queue, and no rejection.

Until this change every `confirm()` call site was reached from a click, so two could not
overlap. `useAppUpdate` is the first caller driven by a watcher (`:203`) and by a
Capacitor `resume` (`:208`). Its protection is incidental rather than designed:
`isAppQuiet()` → `hasOpenOverlays()` is a **body-scroll ref count**
(`overlayStack.ts:11-28`), and `ConfirmModal` only increments it when
`useBodyScrollLock`'s watcher flushes (`useBodyScrollLock.ts:48-55`), not when
`state.open` is assigned. Vue orders pre-flush watcher jobs by owning-instance id, and
`useAppUpdate`'s watcher is created in `App.vue`'s setup while `ConfirmModal`'s lock
watcher is created in a descendant — so within a single flush the update watcher runs
**first**, and reads `hasOpenOverlays() === false` for a modal that is already logically
open. Any tick in which another `confirm()` opens and `docVersion` bumps is therefore a
tick in which the update prompt can replace it and hang its caller forever. Two of the
existing callers await `confirm()` inside a longer flow
(`useDriveCollisionRecovery.ts:72`, `usePodCompaction`), so "hangs forever" means a
workflow that never completes and never errors.

`useBodyScrollLock.acquire()` also swallows a throw and leaves `locked` false
(`useBodyScrollLock.ts:30-35`), so on a device where `document.body.style` is denied the
count is _never_ incremented and the window is not a tick wide but permanent.

**Suggested fix.** Make `confirm()` honest about re-entrancy in one place rather than
relying on every caller's gate: if `state.value.open && state.value.resolve`, either
resolve the outgoing promise `false` before replacing it (so no caller hangs) or return
`Promise.resolve(false)` for the new request. Three lines in `useConfirm.ts`, and it
closes the class rather than this instance of it.

---

### 7. The anchor variant of the confirm control is not keyboard-equivalent to the button it replaces

**Severity: low.**
**Where:** `src/components/ui/ConfirmModal.vue:86-107`.

`<component :is="safeConfirmHref ? 'a' : 'button'">` swaps a `<button>` for an `<a>`. A
button activates on both Enter and Space; an anchor activates on Enter only — Space
scrolls. `BaseModal` adds no focus trap or key handling to compensate (its own doc-block
lists focus trap and `inert` as _future_ hardening,
`useFullscreenOverlay.ts:22-24`), so the two footer controls in the same row now respond
to Space differently: Cancel dismisses, Update does nothing.

Only the update prompt passes `confirmHref`, and that prompt is native-only where there is
usually no keyboard — which is why this is low and not medium. It becomes a real defect
the first time a second caller passes an href on a surface a desktop user reaches. The
new `ConfirmModal.test.ts` pins tag name, `href`, `target`, `rel` and the click path
(`:62-73`) but asserts nothing about keyboard activation.

**Suggested fix.** Add `@keydown.space.prevent="handleConfirm"` on the anchor branch, or
accept it and say so in the comment at `:78-85`, which currently claims "With
`confirmHref` unset every existing call site renders exactly the button it always has" —
true, and quietly silent about what the _set_ case gives up.

---

### 8. A new unsuppressed `security/detect-object-injection` warning, beside a suppressed one for the identical pattern

**Severity: low.**
**Where:** `src/services/appUpdate/storeUrl.ts:23`, against
`src/utils/payloadFailureSurface.ts:172-175`.

`npx eslint src/services/appUpdate/` reports:

```
src/services/appUpdate/storeUrl.ts
  23:38  warning  Generic Object Injection Sink  security/detect-object-injection
```

The same change suppresses the identical pattern one file away, with a written
justification:

```ts
// `kind` is a closed union and the table is `satisfies Record<PayloadErrorKind,
// ...>`, so every possible index is a key the table declares.
// eslint-disable-next-line security/detect-object-injection
const overlayKey = PAYLOAD_OVERLAY_KEY[kind];
```

`STORE_URL[platform]` has the same guarantee (`platform` is narrowed to `'ios' | 'android'`
by the `=== 'web'` test, and `STORE_URL` is `satisfies Record<'ios' | 'android', string>`)
and no suppression. Not CI-blocking — `npm run security:lint` exits 0 with 417 warnings —
but it is one more warning in a pile whose whole value is that somebody reads it, and the
inconsistency within a single commit is the part worth fixing.

**Suggested fix.** Add the same `eslint-disable-next-line` with the same one-line reason.

---

### 9. The record names only the first of the two commits, and miscounts the tests

**Severity: low (documentation).**
**Where:** `docs/STATUS.md` (the native-update-gate entry).

The entry reads "**On `main` as `af38fe75`, NOT DEPLOYED**" and "11 mounted tests now
cover it". Both were written in `a0f6555e` — the commit carrying all fifteen round-1
fixes — and neither mentions it, so the project's record points at the version of the
feature with the defect where the prompt would almost never fire. The overlay test file
holds 13 tests, not 11 (`npx vitest run
src/components/common/__tests__/FatalErrorOverlay.test.ts` → `Tests 13 passed`).

The irony is local: the sibling STATUS entry directly below it carries the lesson that a
SHA is not quotable until it is on the remote.

**Suggested fix.** Cite `af38fe75..a0f6555e` and correct the count.

---

## Checked and clean

**The i18n gate.** `npx eslint src/components/common/FatalErrorOverlay.vue
src/composables/useAppUpdate.ts src/components/ui/ConfirmModal.vue
src/utils/payloadFailureSurface.ts` → **0 errors** (the only output is finding #8's
warning). Both bare-string rules pass. All five new keys resolve at runtime: they are
literal properties of `STRING_DEFS` in `uiStrings.ts:4394-4415`, `UIStringKey = keyof
typeof STRING_DEFS` (`:10424`), and `UI_STRINGS` / `BEANIE_STRINGS` are derived from the
same object, so a missing register is not representable. Every key has both `en` and
`beanie`. `public/translations/zh.json` carries all five (`:22779-22803`) and its
`translationCount` was bumped 4554 → 4559 to match. `npm run type-check` (`vue-tsc -b
--noEmit`) passes clean.

**The Astro side.** `npm run build:web` exits 0. The three pages that now import
`STORE_URL` render byte-identical destinations to the literals they replaced
(`git show af38fe75~1:web/src/pages/{ios,android,download}.astro`):
`web/dist/ios.html` → 4 × `https://apps.apple.com/app/id6798513944`;
`web/dist/android.html` → 4 × `https://play.google.com/store/apps/details?id=family.beanies.app`;
`web/dist/download.html` → one of each. Both match `packages/brand/nav.ts:52-55`.
`web/dist/min-app-version.json` is emitted at the site root, which is where
`MARKETING_URL` + `/min-app-version.json` looks for it (`utils/marketing.ts:1-3` →
`https://beanies.family` in production). The CTA guard still passes (249 tagged, 0
untagged) and page count is unchanged.

**The `fetch` lint zone actually bites.** Verified by feeding a violating file through
the real config rather than by reading it:
`echo "…await fetch('https://x')…" | npx eslint --stdin --stdin-filename
src/services/appUpdate/__probe.ts` → `error … no-restricted-globals` with the intended
message. The rule's own stated limit (bare `fetch` only, not `window.fetch`) is accurate.

**The `ConfirmModal` element swap, mechanically.** `BaseModal` makes no assumption that
footer controls are buttons: it owns no focus management at all, `:closable` gates only
its own X and the backdrop/Escape close (`BaseModal.vue:57-63`, `:121-128`), and the
footer is an unexamined `<slot name="footer" />` (`:136-142`). The anchor participates
correctly — `handleConfirm` closes the sheet by assigning `state.value.open = false`,
which Vue schedules for the next flush, so the anchor is still in the DOM when the
browser runs the click's activation behaviour and the navigation is not cancelled.
Modified clicks behave sanely: Cmd/Ctrl+click fires `click`, so `handleConfirm` runs, the
promise resolves `true` and the store opens in a background tab — correct on both counts.
Middle-click fires `auxclick`, not `click`, in every current browser, so `handleConfirm`
does **not** run: the sheet stays open with the store loading in a background tab, and a
subsequent Cancel logs `prompt-dismissed` for somebody who did go to the store. That is a
telemetry inaccuracy on a desktop browser, and there is no desktop caller of
`confirmHref`, so it is noted rather than filed.

**The store handoff out of the fatal overlay.** Opening the store from
`FatalErrorOverlay.vue:117-125` leaves the app recoverable. Capacitor handles
`target="_blank"` on both platforms by handing the URL to the OS rather than navigating
the WebView, so the app is backgrounded, not replaced. On return the overlay is still up
with Reload present, which is the right end state: nothing about tapping a store link
means the file in front of the device became readable, so re-running the failing open
would be wrong. Reload (`handleReload` → `hardReload()`) is the correct and only exit,
and it is unconditionally rendered — `FatalErrorOverlay.vue:126-135` has no `v-if`, only
a class swap between primary and secondary. The `action.url` caption at `:150-152` is
outside the `<details>` and gated on `action` alone, so the address survives an href that
fails screening (round-1 fix #4, confirmed present and correct).

**Sign-out and family-switch, for the module-level state.** `resetProjection()`
(`projection.ts:141-147`) sets `loaded = false` **and** bumps `docVersion`, so the
`watch([docVersion, isOnline])` fires on sign-out and correctly reports `booting` rather
than prompting into a login screen. Nothing else goes stale in a way that matters:
`updateAvailable` and `versionPolicy`'s `cached` are facts about the **build and the
floor**, not about a family, so they are right to survive a family switch;
`suppressionsReported` is bounded at three entries and only suppresses telemetry.
`__resetAppUpdateForTesting` being the only reset path is correct for all of these — with
the single exception of the floor's lifetime, filed as #3 above, which is about the
_process_ being longer than assumed rather than about sign-out.
`dismissedThisSession` surviving a sign-out means a second person signing in on the same
device is not asked, which matches the stated "once per session" intent and is not worth
changing.

**Boot ordering, for the boot-spinner half of #2.** The z-300 boot spinner cannot hide
the prompt: `isInitializing` is cleared at `App.vue:1266` (step 4, "app shell can now
render") before family data loads at step 5, and `loaded` only flips true at
`projection.ts:112-117` during that load. So `isLoaded()` is never true while the spinner
is on screen. The watchdog's early return (`App.vue:1003`) also correctly no-ops on the
cache-first path, where `onEarlyPaint` clears `isLoadingData` (`App.vue:679`). Only path
1b leaves the window described in #2.

**Telemetry keys and the privacy declaration.** Every context key in the new events —
`action`, `os`, `detail`, `error_code` — is already in `ALLOWED_CONTEXT_KEYS`
(`src/utils/diagnosticContext.ts:61+`), so the runbook's claim at § 7 ("No new diagnostic
keys … §1's data-collection table is unchanged by this feature and must not be edited for
it") is accurate. The new `appVersion` field added to `payloadErrorDetail`
(`src/types/sync.ts:520-527`) does **not** reach the firehose: `payloadErrorDetail`'s only
non-test consumer is `payloadFailureSurface.ts:211`, which passes it to `setFatal` as the
on-screen detail blob. Nothing to declare.

**`src/types/sync.ts`'s new import.** `@/constants/appVersion` is comments plus one
exported string literal with no imports of its own, so the worker modules that reach
`types/sync` gain exactly what the comment at `:13-16` claims and no graph.

**`usePwaUpdater`'s de-duplication.** The extraction of `isQuiet` → `appQuiet.ts` is a
verbatim move; both former call sites (`usePwaUpdater.ts:81`, `:137`) now call
`isAppQuiet()` and the file no longer imports `useSyncStore` or `hasOpenOverlays`,
with no other use left behind.

**Tests.** All eight test files touched or added by the two commits pass: 90 tests across
`useAppUpdate`, `versionPolicy`, `compareAppVersions`, `appQuiet`,
`payloadFailureSurface`, `FatalErrorOverlay`, `ConfirmModal` and `fatalErrorStore`. The
`useAppUpdate` suite's decision to leave `docVersion` a real `shallowRef` while stubbing
only `isLoaded` (`useAppUpdate.test.ts:45-52`) is the right call and its comment explains
why.

**Dead or contradicted comments, beyond those filed above.** Swept the whole diff.
Everything else checks out, including the two claims most likely to have rotted:
`storeUrl.ts:1-11`'s account of why it is its own module (accurate — `payloadFailureSurface`
does now reach `STORE_URL` without touching `@capacitor/app` or `useConfirm`), and
`nav.ts:44-50`'s claim that a third native platform "fails the BUILD here" (accurate:
`getPlatform()` declares its union explicitly at `capabilities.ts:51`, so widening it
produces a type error in `storeUrl.ts:23` rather than a silent `undefined`).
