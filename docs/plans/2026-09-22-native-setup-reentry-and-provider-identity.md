# Plan: The native setup flow always moves forward, and never writes into someone else's pod

> Date: 2026-09-22
> Related issues: None — direct implementation (three defects found in greg's 2026-09-21 iPhone pod-creation test)
> Plan file: `docs/plans/2026-09-22-native-setup-reentry-and-provider-identity.md`
> Status: READY FOR APPROVAL — all four review passes complete.

## User Story

As someone setting up a new beanies pod on an iPhone, I want every step to move forward when it
succeeds and to tell me plainly when it fails, so that I do not get silently dropped back onto the
screen I just completed and give up.

## Context

greg ran a pod-creation test on a production iPhone (TestFlight, build `f92de10f`) and hit three
defects. Two of them share one root cause, and one of those two came within a coin-flip of
destroying another family's data.

**The overriding goal, in greg's words:** the setup and joiner flow must be smooth and seamless with
minimal friction, because any small snag causes drop-off. Errors must always be surfaced; successful
actions must always route forward; a user must never be returned to the screen they came from,
either silently after an error or after a success.

### The shared root cause (issues 2 and 3)

**Re-entry after an OAuth round trip is implemented as "the page reloads and remounts", and native
never does that.** On iOS web and PWA, `startRedirectAuth` is a full-page navigation: the app
unloads, comes back on a fresh load, components remount, `onMounted` re-runs. On native Capacitor it
is `Browser.open()` plus an `appUrlOpen` deep link that resolves to a **router navigation**
(`App.vue:1820-1826` → `router.replace(returnPath)`). The WebView never unloads. Nothing remounts.
Module state survives.

- **Issue 3 — nothing runs on the return.** There are TWO create-side redirect starts, and both
  return to `RESUME_SETUP_PATH` = `/welcome?resume=setup`: `connectDriveStorage`
  (`connectStorage.ts:163`) and the registry probe's own gesture-less redirect (`syncStore.ts:5547`,
  inside `attemptResumeFromRegistry`, whose comment says "page navigates away; we resume on
  return"). That is _the URL the screen already lives at_, so the `router.replace` is a duplicate
  navigation and vue-router does not even update `currentRoute`. `ResumePodSetup` takes no props and
  has no watchers (verified: no `defineProps`, no `watch(`, no `watchEffect(`), and
  `LoginPage.vue:947` mounts it with three event handlers and nothing else. The resume dispatcher
  already stopped itself at `LoginPage.vue:251`. So: no remount, no route change, no watcher, no
  re-read. `connectStorage.ts:143-146` asserts the opposite in a comment; it is true on web and
  false on native.

- **Issue 2 — a stale provider survives and gets written through.** `ResumePodSetup.vue:504` gates
  the entire create path on truthiness of `getProvider()`, under a docblock saying "iOS never takes
  this branch: its full-page Drive redirect reloads the app, so the in-memory provider is gone
  (`getProvider()` is null) on return." Same false premise. On native the provider survives, so
  `createNewFile` (`syncStore.ts:3082-3090`) does `syncService.getProvider()` and writes through
  **whatever was already installed** — in greg's case a `GoogleDriveProvider` bound to
  `gregsophia@gmail.com`'s fileId, under a `gpsp2001@gmail.com` token. Under `drive.file` scope
  another account's file is invisible, so Drive returned 404 and `reconnectIfAccountMismatch`
  (`googleDriveProvider.ts:162`) threw.

### ⚠️ The near miss

**The throw was the guard working, not the bug.** Had the two accounts matched, that write would
have **succeeded** and overwritten an existing family's `.beanpod` with a brand-new envelope
encrypted under a brand-new family key. That pod would be unreadable by every device that held the
old key. `doSave()` has exactly the right cross-family guard at `syncService.ts:1848`;
`createNewFile` bypasses it by calling `provider.write()` directly. **The identity check on the
create path is the most important deliverable in this plan**, and it is worth more than either
routing fix.

### Why no error was shown (both issues)

`finishOnDrive` (`ResumePodSetup.vue:794`) sets `formError.value = null` as its **first statement**,
then returns early on `status === 'redirecting'` (`:800`), and the `finally` at `:913` does
`if (!navigatedAway.value && phase.value === 'finishing') phase.value = 'storage'`. On web the page
really is navigating away so nobody sees it. On native the app stays mounted, so the user is
repainted onto the identical screen with the error already cleared.

### Two more facts pass 2 verified, which shape the design

- **A declined consent never comes back on native.** `handleNativeAuthRedirect`'s `error` arm
  (`googleAuth.ts:3097-3106`) clears session state, logs at info, and **returns without calling
  `onComplete`**; only a successful exchange, a picker/calendar grant, and a _failed_ exchange
  (`:3143-3151`) navigate. `Browser.close()` has already dismissed the sheet, so the person is
  looking at the app with nothing arriving. Any "redirect under way" state must therefore carry its
  own escape hatch, which is exactly what `join.awaiting.redirecting` already does ("if nothing
  happens, tap below to try again").
- **A retry inside the same mount returns to the same URL again.** After a failed consent the person
  taps "Connect Google Drive", which redirects and returns to the marker the address bar already
  holds; `router.replace` is a duplicate and the dispatcher never re-runs. `docs/STATUS.md:127(c)`
  records the identical limitation for the reconnect marker. **greg's "after the 3rd try it worked"
  is this.** The return path must differ per attempt.

### One more fact pass 3 verified, which changes A3

**The dispatcher is already dead before any native return arrives.** `LoginPage.vue:251` calls
`stopResumeWatch()` the moment the `'setup'` branch runs — and on native, every route-driven path
that shows `ResumePodSetup` goes through that branch first: the router guard
(`router/index.ts:454` and `:536` both rewrite to `?resume=setup`), `LoginPage`'s podless
self-rescue (`:390`), App.vue's zombie redirect (`:1391`). The only arrival that does NOT stop the
watch is the desktop hand-off `handleFinishStorage` (`:708`), which flips `activeView` directly. So
a new dispatcher branch for `?resume=setup-connected`, placed inside the same `watchEffect`, would
**never execute on native**: the effect was stopped seconds earlier by the branch above it. Pass 2
listed this stop as part of the root cause and then did not remove it. The repo already learned this
once — the reconnect branch's comment at `:239-243` ("Consuming the dispatcher here meant the picker
silently never re-opened on native, where nothing remounts to re-arm it").

### Issue 1 — the success screen

`SetupProgressModal.vue:294` opens `BaseModal` with `fullscreen-mobile`. `BaseModal.vue:164` makes
the panel `h-full max-h-full`; the body at `:197` is `<div class="flex-1 overflow-y-auto p-6">`, a
plain block. Short content renders at natural height at the **top** of a full-height column, leaving
~60% empty. The `items-center justify-center` at `:143` centres the _panel_, a no-op once the panel
is `h-full`. The inset white card and the beanie fragment above it come from the overlay's
unconditional `p-4` at `:143`, which `BaseModal`'s own `safeAreaStyle` docblock (`:57-76`)
acknowledges and works around.

## Requirements

1. On native, a successful Drive consent during pod creation **advances** the user to the next step
   without a second tap — on the first attempt AND on a retry within the same mount.
2. On native, a failed, partially-granted, or declined consent during pod creation **shows a
   specific message** on the screen the user lands on, with a usable recovery action.
3. `createNewFile` must **refuse** to write through a provider bound to a different family, and must
   say so clearly rather than failing silently or generically.
4. The account-mismatch fault must get its own copy. "Check your connection" is wrong when the
   connection is fine.
5. A mid-redirect state must be **visible** and **escapable**, not a silent repaint of the screen
   the user just acted on.
6. Any new auto-resume latch must be reset by the component that consumes it, and the existing
   unreset `autoOpenDrivePicker` latch must be fixed.
7. The success screen must be vertically centred on a phone, without changing the seven other
   surfaces that pass `fullscreen-mobile`.
8. Nothing in the working tree's uncommitted #63 changeset may be reverted, committed, or built on.
9. No duplicated predicate, no duplicated reconnect block, no double error report.
10. **No new copy of the busy/try/catch/finally handler envelope.** `ResumePodSetup` already carries
    four (`handleIdentityNext`, `proceedToFinalize`, `handleConnectDrive`, `handleConnectLocal`); the
    resume must re-enter an existing one, not add a fifth.

## The design decisions, argued

### Decision 1: mirror the marker + prop + immediate-watcher shape; consumption is child-owned; the return path carries an attempt nonce

The shape already exists twice and is documented twice (`LoadPodView.vue:1381-1404`,
`resumePaths.ts:24-41`). Following it is cheaper to review than inventing a third concept, and a
general refactor would rewrite two surfaces greg validated on a production iPhone on 2026-09-20.
`LoadPodView`'s watchers are **not touched** (Decision 5).

Two refinements over the prior art, both to satisfy requirements 1 and 6 without a parent-side reset
protocol:

- **The child consumes the latch.** `ResumePodSetup` takes it as
  `defineModel<boolean>('autoFinishDrive')` (Vue 3.5; already used by `OnboardingSavings.vue:19` and
  `AccountDetailsFields.vue:35`) and sets it `false` the moment its watcher reads `true`. The parent
  never has to know when consumption happened, and a later remount can never re-read a stale `true`
  — the class of bug `LoginPage.vue:508-513` warns about. The parent-owned boolean-prop shape of the
  two existing latches is left as is; its one missing reset is a one-line fix (A3).
- **`setupConnectedPath()` is a function, not a constant**, and appends `&attempt=<Date.now()>`.
  `route.query` is replaced on every real navigation, so the dispatcher `watchEffect` (which reads
  `route.query.resume`) re-runs per attempt; with the latch already reset by the child, the second
  `true` fires the child watcher again. Only `resume` is inspected anywhere (`isPodlessRecoveryQuery`,
  the router guard at `router/index.ts:453,471`, `App.vue:1365`), so the extra key is inert
  everywhere else; `isSameOriginReturnPath` (`redirectState.ts:150`) accepts any same-origin
  relative path.

**The return does not always land in the same mount.** The wizard's own step-2 Drive redirect
(`CreatePodView.vue:265`) returns to the same marker with `CreatePodView` on screen; the dispatcher
flips `activeView` and `ResumePodSetup` **mounts** with the model already `true`. Its immediate
watcher consumes the latch, `redirectInFlight` is `null` in the fresh instance, and
`onMounted → runProbe()` owns the resume — exactly the web-reload path. **That no-op is load-bearing,
not incidental:** it is what lets one marker serve all three starters.

**The sink-level alternative, recorded and deferred.** vue-router 4 accepts `force: true` on
`router.replace`, which re-runs a same-location navigation. Putting that on the ONE native return
sink (`App.vue:1826`) would make every native OAuth return a real navigation and would resolve
`STATUS.md:127(b)` and `(c)` for all four surfaces at once, with no per-attempt nonce anywhere. It is
not done here because (i) whether a forced same-URL navigation re-triggers a `watchEffect` that reads
`route.query.resume` depends on `useRoute()` producing a new `query` object identity, which is router
internals rather than a documented contract, and (ii) it changes the sink for the picker and calendar
returns too, which is the four-surfaces-in-one-change this area keeps breaking on. The nonce is inert
by construction and provable in a unit test. The `STATUS.md` pointer names `force: true` as the
candidate for the sibling fix so the next person does not rediscover it.

### Decision 2: ONE identity predicate, used by the gate and the backstop; the null-bound case is argued

`getProviderFamilyId()` (`syncService.ts:787`) already exists and is bound at `setProvider` time from
`getActiveFamilyId()`. The rule is the one `doSave()` already enforces at `syncService.ts:1848`:
**refuse when the provider is bound to a family AND that family is not this one.** A provider with a
`null` binding passes.

Why not strict equality: `demoSeed.ts` installs the memory provider (step 3, `:155`) BEFORE `signUp`
activates the family (step 4, `:163`), so its binding is whatever `getActiveFamilyId()` held at that
moment. On a fresh runtime that is `null`, which strict equality would refuse. (The DEV E2E hook at
`CreatePodView.vue:89` is NOT such a case: `signUp` is the wizard's step 1 (`:119`) and the hook runs
at step 2, so it binds to the new family and passes by equality. Passes 2 and 3 asserted otherwise;
pass 4 corrected it.) The rule therefore mirrors `doSave()`'s `null`-tolerant form.

**But `null` is not the only stale value `demoSeed` can bind to — see A8.** `database.ts` clears
`currentFamilyId` only in `deleteFamilyData` (`:79-80`); a plain keep-data sign-out leaves the
previous family's id in place, `isReviewDemoAvailable()` gates on nothing but the flag and expiry,
and `seedDemoFamily` refuses only when `currentUser` is set. So "sign out keeping data, then enter
the review-demo code" installs a memory provider bound to family A, `signUp` activates D, and
`createNewFile(D)` would be **REFUSED by the new backstop**. That is a defect this plan would have
introduced; today the same state only latently blocks `doSave()` for the demo pod. A8 reorders
`demoSeed` so the provider is installed after `signUp`, which fixes both and makes the demo mirror
the real wizard order (identity first, storage second). After A8 no create path relies on the `null`
tolerance; it is kept anyway because the predicate's job is to be `doSave()`'s twin, not a stricter
cousin.

The predicate lives once, in `syncService`, next to `getProviderFamilyId`:

```ts
/**
 * True when a provider is installed AND it was bound to a family other than `familyId`.
 * The create-path twin of `doSave()`'s guard below: a `null` binding is "not yet known",
 * not "foreign" — demo seeding and the E2E hook install before `signUp` activates the family.
 * An EMPTY `familyId` (caller could not resolve one) makes every bound provider foreign, which is
 * the safe direction: the caller then reconnects rather than writes.
 */
export function providerBelongsToAnotherFamily(familyId: string): boolean {
  return !!currentProvider && !!currentProviderFamilyId && currentProviderFamilyId !== familyId;
}
```

Two callers, two different jobs:

- **`ResumePodSetup.proceedToFinalize` (the correctness fix, and the one greg hits).** The gate
  becomes "a provider is installed and is not foreign". A foreign provider falls through to the
  `isTokenValid()` branch, and `finishOnDrive` → `connectDriveStorage` → `createNew` **replaces** it
  with one bound to this family. In the common case the person sees no refusal at all; it just works.
- **`createNewFile` (the data-loss backstop).** Before `provider.write()`, refuse with a new
  `'provider-mismatch'` reason. This makes the class impossible for every caller, present and future.
  **It does not `reportError` itself**: `finalizePod` already reports every reason at
  `severity: 'critical'` with `surface: resumeSetup.<reason>` (`ResumePodSetup.vue:668-674`), and a
  second report inside the store would page twice for one event.

`CreatePodFailureReason` (`src/types/sync.ts:41`) is mapped at `ResumePodSetup.vue:658` with
`Record<typeof result.reason, …>`, so adding the member is a **compile error until the copy is
added**. Grep confirms that map is the only one.

### Decision 3: `'redirecting'` is a real phase, with an escape, and the resume handler is phase-aware

Making the redirect its own phase means the `finally` blocks (which reset only `'finishing'`) cannot
undo it — **no change to those blocks**. Because a native decline never navigates back, the phase
renders the same promise `join.awaiting.redirecting` makes: a spinner, "Taking you to Google…", and
"if nothing happens, tap below to try again" with a button back to the `storage` step. That is the
recovery action for requirement 5; it is not an error state, because nothing failed, nothing arrived.

Why the decline is not made to navigate instead: the `error` arm at `googleAuth.ts:3097` is shared by
the Drive and calendar grants and performs a full `clearGoogleSessionState()`; widening it to call
`onComplete` would send a calendar decline to a calendar resume whose PKCE stash is gone. The escape
button is the narrow, surface-local answer.

There are **two** redirect starters on this screen (the probe and the connect), and their resumes
differ. Both already have a user-facing handler — `handleConnectDrive()` (the full busy/try/catch/finally
envelope) and `handleRetry()` (a `busy` guard over `runProbe()`, which returns typed results and is
the same bare call `onMounted` makes today). **The resume dispatches into those two handlers**; it does not carry an
envelope of its own (requirement 10). The only work the resume does itself is the loop guard: verify
a token is actually in hand before re-entering, because re-entering without one would start the same
redirect again with no gesture anywhere in the cycle (the same guard `LoadPodView.vue:1396-1401`
carries).

The paired state — _which_ starter is out (`redirectInFlight`) and _that_ one is out
(`phase === 'redirecting'`) — has one invariant: `redirectInFlight !== null` ⇔
`phase === 'redirecting'`. Two small helpers own every transition so no caller touches the pair
directly, and one const map owns "where does each starter fall back to" so the mapping is not
re-derived at three call sites. On a web reload the ref is fresh (`null`), so the immediate watcher
no-ops and `onMounted → runProbe()` owns the resume exactly as today — web behaviour is unchanged.

The probe redirect fires ONLY when the registry already holds a Drive `fileId` for this family
(`syncStore.ts:5533-5551` returns `no-registry-entry` before the token check), so
`REDIRECT_FALLBACK_PHASE.probe = 'retry'` lands on copy that is true ("a pod is known but we could
not reach it"). A brand-new family — greg's case — never takes the probe redirect; its redirect is
`connect`.

### Decision 4: do NOT extend `ResumeSetupReason`; wire native to the reason that already exists

Pass 1 proposed extending the sessionStorage-backed reason union. **Nothing needs to survive a
reload.** On native nothing reloads, so an error set after the return is simply shown. On web the
only failure that crosses the reload is a consent denial, which `'drive-consent'` already covers.
Extending the union would also force the `consumeResumeReason:104` change pass 1 itself flagged as a
trap. Dropped.

What IS missing: native's exchange-failure catch (`googleAuth.ts:3143`) reports generically and never
stashes `'drive-consent'`, so a partially-granted consent on iPhone shows "sign-in failed" instead of
"allow file access". `App.vue:1306-1311` has the predicate for the web path. Extract it once into
`resumePaths.ts` and call it from both.

### Decision 5: the three sibling reconnect surfaces are DEFERRED

`docs/STATUS.md:127(b)` lists `useLoginFlow.onRecoveryReconnect`, `PodAccessBanner.vue:130` and
`useReconnectCoordinator.ts:157/:181` as knowingly carrying the same two-tap bug. They stay deferred:
they are on the reconnect path, not the setup/join path where churn happens, and this repo's own
history (two review rounds finding defects in the previous round's fixes) argues for a narrow change
next to a data-loss guard. This plan adds a pointer in `STATUS.md` that the per-attempt marker +
child-consumed latch proven here is the shape to apply to them, and that it also resolves
`STATUS.md:127(c)`, and that `router.replace({ force: true })` at the single native sink is the
candidate for doing all of them at once (Decision 1).

For the same reason the `load-drive` branch's `stopResumeWatch()` (`LoginPage.vue:223`) is **left in
place**. Removing it would let the effect re-run when `isAuthenticated` flips — which loading a pod
from the picker does — and re-arm `autoOpenDrivePicker` after `resetLoadPodFlags` cleared it,
reopening the picker over a pod that just loaded. Only the `'setup'` branch's stop is removed (A3),
and its re-run is idempotent by construction: it sets a view and clears a spinner; it arms no latch.

## Approach

### A1. `resumePaths.ts` — the marker, the per-attempt path, the shared consent-denial stash

```ts
/**
 * `route.query.resume` value for the CREATE flow's Drive round-trip return (connect AND the
 * registry probe's own gesture-less redirect).
 *
 * ⚠️ DISTINCT FROM `RESUME_SETUP`, AND THAT IS THE WHOLE POINT. Both create-side redirects used to
 * return to `/welcome?resume=setup` — the URL the resume screen ALREADY sits at — so on native
 * (`Browser.open` + `appUrlOpen` → a router navigation, no page load) `router.replace` was a
 * duplicate: nothing remounted, no watcher fired, and the person landed back on the storage picker
 * they had just completed. Same failure, same reasoning, as `RESUME_RECONNECT_LOAD`.
 */
export const RESUME_SETUP_CONNECTED = 'setup-connected';

/**
 * Built PER REDIRECT, not a constant. A retry in the same mount returns to the marker the address
 * bar already holds, and a same-URL `router.replace` is a duplicate navigation that re-runs nothing
 * (the two-tap retry `STATUS.md:127(c)` records for reconnect). `attempt` makes each return a real
 * navigation; nothing reads it — every consumer inspects `resume` only. A module counter, not
 * `Date.now()`: two starts in one millisecond must still differ, and a counter is deterministic in
 * tests.
 */
let attemptSeq = 0;
export function setupConnectedPath(): string {
  return `/welcome?resume=${RESUME_SETUP_CONNECTED}&attempt=${++attemptSeq}`;
}

/** One predicate for "did this redirect-auth failure mean the user unticked file access?" —
 *  shared by the web boot path (App.vue) and the native deep-link handler, which used to differ.
 *  Returns whether a reason was stashed, so callers classify the report (a user decision is a
 *  `warning`, not an `error`) without a second `instanceof`. */
export function stashResumeReasonFor(e: unknown): boolean {
  if (!(e instanceof DriveConsentDeniedError)) return false;
  setResumeReason('drive-consent');
  return true;
}
```

`resumePaths.ts` imports `DriveConsentDeniedError` from `@/types/sync`, whose only import is
`@/constants/appVersion`, so the module stays light (its docblock promises this). While editing, fix
the stale header at `:9-10` claiming `RESUME_SETUP_PATH` lives in `connectStorage.ts` — it has lived
in this file since `:57`.

`isPodlessRecoveryQuery` gains `resume === RESUME_SETUP_CONNECTED` — without it the onboarding-zombie
alert (`App.vue:1365`) fires on the return and the router guard (`router/index.ts:453`) bounces it to
`?resume=setup`.

### A2. Both create-side redirect starts return to the new path

- `connectStorage.ts:163` → `beginDriveAuthRedirectIfNeeded(setupConnectedPath(), …)`. Rewrite the
  `:143-146` comment: the return is driven by the marker + LoginPage's dispatcher + the screen's
  immediate watcher; a same-path return does nothing on native.
- `syncStore.ts:5547` (`attemptResumeFromRegistry`) → `setupConnectedPath()`. This is the redirect
  behind `runProbe`'s `'redirecting'` case at `ResumePodSetup.vue:251`, whose comment ("leave the
  spinner up") was a permanent spinner on native.
- `RESUME_SETUP_PATH` stays: App.vue's zombie redirect, the router guard, and `handleStartOver` still
  use the plain marker for non-OAuth routing.
- `App.vue:1306-1311` → `const isConsentDenied = stashResumeReasonFor(e);` (same dynamic import of
  `resumePaths` it already does; its `@/types/sync` import goes away). The `severity`/`context` lines
  below are unchanged.
- `googleAuth.ts:3143` catch → before `onComplete`:
  `const { stashResumeReasonFor } = await import('@/components/login/resumePaths');`
  `const isConsentDenied = stashResumeReasonFor(e);`, then report with
  `severity: isConsentDenied ? 'warning' : 'error'` and `context: { consent_denied: isConsentDenied }`.
  Today native pages a developer at `error` for a user unticking a box, which the web path
  deliberately does not (`App.vue:1300-1303`); `consent_denied` is already an allowed context key.
- **`CreatePodView.vue:265` is the THIRD create-side redirect start** (the wizard's own step-2 Drive
  connect, via `connectDriveStorage`, so the first bullet already re-routes it). Update its comment
  at `:269-271` ("We resume on return via `/welcome?resume=setup` → ResumePodSetup") to name
  `setupConnectedPath()` and the dispatcher.
- After these edits nothing imports `RESUME_SETUP_PATH` from `connectStorage` (App.vue and LoginPage
  already take it from `resumePaths`; `syncStore.ts:34` is being changed). Delete the re-export at
  `connectStorage.ts:33-37` and the "create → RESUME_SETUP_PATH" mention at `:52`; `syncStore.ts`
  imports `setupConnectedPath` from `@/components/login/resumePaths` directly. This keeps
  `syncStore.verifyPodAccess.test.ts:263-267`'s `connectStorage` mock valid without edits.

### A3. `LoginPage.vue` — the dispatcher STAYS ALIVE, gains a branch, and the one-line latch fix

**The `'setup'` branch no longer stops the watch.** This is the pass-3 correction, and without it
nothing below ever runs on native. Replace `:247-251` with:

```ts
if (!authStore.isAuthenticated) return;
if (route.query.resume !== RESUME_SETUP) return;
activeView.value = 'resume-setup';
isInitializing.value = false;
// ⚠️ NO `stopResumeWatch()` — this branch runs FIRST on every route-driven arrival at
// ResumePodSetup (router guard `router/index.ts:454`/`:536`, podless rescue `:390`, App.vue's
// zombie redirect `:1391`), and the create flow's Drive return lands on `?resume=setup-connected`
// in the SAME mount on native. Stopping here killed that return before it existed. Safe to
// re-run: it sets a view and clears a spinner; it arms nothing. (The `load-drive` branch above
// still stops, deliberately — its re-run WOULD re-arm a latch. See Decision 5.)
//
// Re-runs are triggered only by `isInitialized`, `isAuthenticated` and `route.query.resume`. The
// states where this view is legitimately NOT 'resume-setup' at ?resume=setup (use-recovery →
// load-pod → flow) never flip `isAuthenticated` false→true (verified: no `signOut` in
// LoadPodView, useLoginFlow, or services/login), and `handleStartOver` clears the query before
// anything can sign back in.
```

Extend the import at `LoginPage.vue:34-39` with `RESUME_SETUP` and `RESUME_SETUP_CONNECTED`.

Rewrite the header comment's "Stops itself once we've taken the resume-setup branch" (`:197`) to say
only the `load-drive` branch is one-shot. The TDZ guard (`:199-209`) stays — the `load-drive` branch
still calls the handle. Use the `RESUME_SETUP` constant for the two literal `'setup'` comparisons at
`:248` and `:371` while those lines are being edited (the constant exists for exactly this).

```ts
/** Set by the `?resume=setup-connected` return; ResumePodSetup consumes AND clears it (v-model). */
const autoFinishDrive = ref(false);
```

**The new branch**, after the `isAuthenticated` gate and before the `'setup'` branch:

```ts
if (route.query.resume === RESUME_SETUP_CONNECTED) {
  activeView.value = 'resume-setup';
  autoFinishDrive.value = true;
  isInitializing.value = false;
  // Re-runs per attempt: `setupConnectedPath()`'s nonce makes each return a real navigation.
  // The child resets the latch on consumption, so a re-run is one more `false → true` edge.
  return;
}
```

Template: `<ResumePodSetup v-model:auto-finish-drive="autoFinishDrive" … />`.

`resetLoadPodFlags` (`:501`) gains `autoOpenDrivePicker.value = false;` directly under the existing
`:508-513` warning, which already describes this exact bug for its sibling.

### A4. `ResumePodSetup.vue` — the screen

**Model + state**

```ts
const autoFinishDrive = defineModel<boolean>('autoFinishDrive', { default: false });
type RedirectKind = 'probe' | 'connect';

/**
 * Which of this screen's two redirect starters is out on a round trip.
 * INVARIANT: non-null ⇔ `phase === 'redirecting'`. Only `enterRedirecting` / `leaveRedirecting`
 * write it. Fresh (`null`) on a web reload, which is how the resume watcher knows to leave the
 * resume to `onMounted → runProbe`.
 */
const redirectInFlight = ref<RedirectKind | null>(null);

/** Where each starter's screen was before it redirected — the escape button and a failed resume
 *  both land here. ONE map, not a ternary at each of three call sites. */
const REDIRECT_FALLBACK_PHASE: Record<RedirectKind, Phase> = { probe: 'retry', connect: 'storage' };
type Phase = … | 'redirecting';
/** The family this create is for — ONE definition for the connect and the write, which previously
 *  computed it separately and could disagree. */
const createFamilyId = computed(() => familyContextStore.activeFamilyId ?? authStore.currentUser?.familyId ?? null);
// `type Phase` extends the existing union at `:121-130` and must be declared BEFORE
// `REDIRECT_FALLBACK_PHASE` references it. `createFamilyId` replaces BOTH `finalizePod`'s inline
// derivation (`:596`) and the `activeFamilyId:` argument at `finishOnDrive:798`.
```

**The two transition helpers** (so no caller writes the pair directly):

```ts
function enterRedirecting(kind: RedirectKind) {
  redirectInFlight.value = kind;
  phase.value = 'redirecting';
  logEvent({
    level: 'info',
    surface: 'resumeSetup',
    message: 'create redirect started',
    context: { action: `create-redirect-start:${kind}`, provider_type: 'google_drive' },
  });
}

/** Clears the pair and returns what was out. `null` on a web reload (nothing was out in THIS mount). */
function leaveRedirecting(): RedirectKind | null {
  const kind = redirectInFlight.value;
  redirectInFlight.value = null;
  return kind;
}

/** The escape button: nothing arrived, go back to the step the redirect started from. */
function cancelRedirect() {
  const kind = leaveRedirecting();
  if (kind) phase.value = REDIRECT_FALLBACK_PHASE[kind];
}
```

**Redirect start** — in `runProbe`'s `'redirecting'` case (`:251-255`) and `finishOnDrive`'s
`'redirecting'` return (`:800`), replace the bare `return` with `enterRedirecting('probe')` /
`enterRedirecting('connect')` then `return`. The `finally` blocks are untouched — they reset
`'finishing'` only, and the phase is now `'redirecting'`.

**Resume** — the immediate watcher and its handler:

```ts
/**
 * ⚠️ `{ immediate: true }` IS WHAT MAKES THIS WORK ON NATIVE, where nothing remounts — identical in
 * shape and reason to `LoadPodView`'s two watchers. The latch is cleared HERE, by the consumer, so a
 * remount can never re-read a stale true. `redirectInFlight` is the loop guard's other half: on a
 * web reload it is null, and `onMounted → runProbe` owns the resume exactly as before.
 */
watch(
  autoFinishDrive,
  (on) => {
    if (!on) return;
    autoFinishDrive.value = false;
    if (!busy.value) void resumeAfterRedirect();
  },
  { immediate: true }
);

/**
 * Re-enter the handler that started the redirect. NOT a fifth copy of the busy/try/finally envelope
 * (requirement 10): `handleConnectDrive` carries the envelope, `handleRetry` is the same guarded
 * `runProbe()` that `onMounted` runs, and this dispatches into them. The only work done here is the loop guard — a declined / partial / failed exchange
 * still lands on this marker, and re-entering without a token would start the same redirect again
 * with no gesture anywhere in the cycle.
 */
async function resumeAfterRedirect() {
  const kind = leaveRedirecting();
  if (!kind) return;
  logEvent({
    level: 'info',
    surface: 'resumeSetup',
    message: 'create redirect returned',
    context: { action: `create-redirect-return:${kind}`, provider_type: 'google_drive' },
  });
  // Read ONCE per return, before the outcome is known: a stash left behind by a return that then
  // recovered silently would otherwise surface as a false "allow file access" on the NEXT mount.
  const reason = consumeResumeReason();
  phase.value = 'finishing'; // the silent reconnect below can take a moment; hide the buttons
  if (!(await ensureDriveToken())) {
    formError.value =
      reason === 'drive-consent'
        ? t('resumeSetup.driveConsentDenied')
        : t('googleDrive.authFailed');
    phase.value = REDIRECT_FALLBACK_PHASE[kind];
    return;
  }
  await (kind === 'probe' ? handleRetry() : handleConnectDrive());
}
```

`ensureDriveToken()` is **extracted from `proceedToFinalize`'s existing else-branch (`:520-536`)** —
`isTokenValid()` short-circuit, `tryReconnectSilently(email)` inside its own try/catch reporting
`resumeSetup.silentReconnect` at warning, returns `recovered && isTokenValid()`. It never throws (its
one `await` is wrapped), which is what lets `resumeAfterRedirect` call it outside an envelope.
`proceedToFinalize` calls it; no second copy.

`onMounted`'s `consumeResumeReason() === 'drive-consent'` read at `:213` stays — it serves the web
reload; the resume handler's read serves native.

**The gate** — `proceedToFinalize` `:497-537`:

```ts
// Storage already connected on this page (desktop popup / local picker / a native return that
// installed it) AND bound to this family: write straight into it. A provider bound to ANOTHER
// family — a boot-restored config or a previous session's — must NOT be written through;
// `finishOnDrive` replaces it with one bound to this family. (The old docblock said iOS never
// reaches this branch because the redirect reloads the app. On native Capacitor nothing reloads,
// the provider survives, and this branch is exactly where greg's 2026-09-21 create wrote into a
// different family's file. `createNewFile` now refuses that as a backstop.)
phase.value = 'finishing'; // before ANY await: the silent reconnect can take seconds, and today's
// else-branch already sets it before awaiting (`:520`)
if (getProvider() && !providerBelongsToAnotherFamily(createFamilyId.value ?? '')) {
  await finalizePod();
} else if (await ensureDriveToken()) {
  await finishOnDrive();
} else {
  phase.value = 'storage';
}
```

`providerBelongsToAnotherFamily` joins the `getProvider` import from `@/services/sync/syncService`
at `:86`.

**Failure copy** — `reasonKey` gains `'provider-mismatch': 'createPod.failedReasonProviderMismatch'`.
No phase routing is added: every caller of `finalizePod` already ends in a `finally` that maps a
lingering `'finishing'` to `'storage'` (`:550`, `:913`, `:960`), which is exactly the CTA that fixes
this failure. An explicit line would be a second copy of that rule. `finalizePod`'s existing critical
`reportError` covers observability.

**Template** — a `'redirecting'` block before the `v-else` finishing spinner: spinner,
`t('resumeSetup.redirecting')`, and an outline button calling `cancelRedirect()`. Start-over stays
visible — nothing critical is in flight (`busy` is false: the starting handler's `finally` already
released it). Authored for light and dark in the same change.

### A5. `syncService.ts` / `syncStore.ts` — the backstop

Add `providerBelongsToAnotherFamily` (Decision 2). In `createNewFile`, immediately after the
`if (!provider) throw` at `:3083-3088` and before `step = 'write'`:

```ts
// ⚠️ THE DATA-LOSS BACKSTOP. `doSave()` refuses a cross-family write; this path calls
// `provider.write()` directly and did not. On native the in-memory provider survives the Drive
// redirect, so a provider bound to a previous family (greg, 2026-09-21) reached this write — and
// only a `drive.file` 404 stopped it overwriting that family's pod. Classified, not thrown raw,
// so the caller shows the storage step rather than "check your connection".
if (syncService.providerBelongsToAnotherFamily(familyId)) {
  step = 'provider-mismatch';
  throw new Error(
    `createNewFile refused: provider is bound to family ${syncService.getProviderFamilyId()} but this create is for ${familyId}`
  );
}
```

`classifyCreateFailure` returns `step` unchanged; `handleCreateFailure(null)` runs its normal
in-memory cleanup; `clearQueue()` runs as for any failure. No `reportError` here (Decision 2).

### A6. `src/types/sync.ts` — the reason

`CreatePodFailureReason` gains `'provider-mismatch'` with a docblock line: "the installed provider is
bound to a different family; writing would overwrite that family's pod. Recovery is to connect
storage again, never to retry the write."

### A7. `uiStrings.ts` — `en` + `beanie`

- `createPod.failedReasonProviderMismatch`: "This device is still connected to a different family's
  storage, so nothing was written. Choose where to keep this family's file to continue." Beanie value
  lowercase, real nouns kept (important surface).
- `resumeSetup.redirecting`: mirrors `join.awaiting.redirecting`.
- The escape button reuses `action.tryAgain` (`uiStrings.ts:3819`, "Try again" / "try again").
  **No new key.**

### A8. `demoSeed.ts` — install the memory provider AFTER `signUp`

Move step 3 (`setProvider(createMemoryProvider(DEMO_POD_FILE))`, `:155`) to run after step 4's
`signUp` + `rehydrateOwnerDoc` succeed, so `setProvider`'s `currentProviderFamilyId =
getActiveFamilyId()` reads the DEMO family rather than whatever family this runtime last had active.
Renumber the step comments. **The `fail('provider-install', error, false)` arm must become
`needsTeardown: true`** — it now runs after a family exists.

New step comment: "Storage is the one step of the real create flow we substitute, and it runs where
the real flow runs it: AFTER identity. `setProvider` binds the provider to `getActiveFamilyId()` at
call time, and after a keep-data sign-out that is still the PREVIOUS family (`database.ts` clears it
only on delete, `:79-80`) — `createNewFile`'s cross-family backstop would then refuse this seed, and
`doSave()` already refused its saves."

`demoSeed.test.ts` mocks `setProvider` wholesale (`:62`), so add an ordering assertion: `setProvider`
is called after `signUp` resolves, and a `signUp` failure leaves `setProvider` uncalled.

### B1. `SetupProgressModal.vue` — the success screen

The success wrapper at `:475` becomes
`class="relative flex min-h-full flex-col justify-center text-center"`, dropping the `px-2 py-6` that
doubled `BaseModal`'s `p-6`. `min-h-full` resolves against the body's flexed height in fullscreen and
collapses to `auto` in the windowed desktop layout, so desktop is unchanged. No `BaseModal` change.

**The `p-4` overlay inset is left alone.** It is shared by all eight `fullscreen-mobile` surfaces and
`BaseModal`'s `safeAreaStyle` docblock reasons about it explicitly; changing it for fullscreen is a
separate, deliberately-scoped change. Recorded as a follow-up in `STATUS.md`, not done here.

### The swallowed `TokenExpiredError` — decided

`createNewFile` turns it into `{ ok: false, reason: 'write' }` and no reconnect banner appears. **That
stays.** This screen renders with `needsPodSetup` true, outside the app shell where the banner lives,
and `finalizePod` already performs the one silent write-retry via `reconnectForWriteRetry`. The
storage step's "Connect Google Drive" button IS the reconnect action, and `createPod.failedReasonWrite`
sends the person there.

### The four existing handler envelopes — decided

`handleIdentityNext`, `proceedToFinalize`, `handleConnectDrive` and `handleConnectLocal` each carry
the same busy/try/catch/finally shape. A `runGuarded(surface, fallbackPhase, fn)` helper would
collapse them, and it is the right long-term shape. It is **not done in this plan**: it rewrites four
working paths next to a data-loss guard, for no behaviour change, and this repo's own history says
that is how this area breaks. What this plan does instead is refuse to add a fifth copy
(requirement 10). Recorded in `STATUS.md` as the follow-up for the next change that touches this file
for its own reasons.

## Files Affected

**Modified**

- `src/components/login/resumePaths.ts` — marker, `setupConnectedPath()`, `stashResumeReasonFor()`, `isPodlessRecoveryQuery`
- `src/services/sync/connectStorage.ts` — return path, corrected `:143-146` comment
- `src/stores/syncStore.ts` — probe return path (`:5547`), `createNewFile` backstop
- `src/services/sync/syncService.ts` — `providerBelongsToAnotherFamily`
- `src/services/google/googleAuth.ts` — native catch stashes the consent reason via the shared helper
- `src/App.vue` — `:1306-1311` uses the shared helper
- `src/pages/LoginPage.vue` — **`'setup'` branch no longer stops the watch**, header comment, `RESUME_SETUP` constant at `:248`/`:371`, dispatcher branch, `autoFinishDrive` model, `resetLoadPodFlags` fix
- `src/components/login/ResumePodSetup.vue` — model + watcher, `redirectInFlight` + `enterRedirecting`/`leaveRedirecting`/`cancelRedirect`, `REDIRECT_FALLBACK_PHASE`, `'redirecting'` phase + template, `resumeAfterRedirect` dispatching into `handleRetry`/`handleConnectDrive`, `ensureDriveToken` extraction, `createFamilyId` (gate + `finalizePod`), corrected gate + docblock, new reason copy/routing
- `src/types/sync.ts` — `'provider-mismatch'`
- `src/services/translation/uiStrings.ts` — two strings (`en` + `beanie`); `action.tryAgain` reused
- `src/components/login/SetupProgressModal.vue` — success-phase centring
- `src/services/demo/demoSeed.ts` — provider installed after `signUp` (A8) + `demoSeed.test.ts`
- `src/components/login/CreatePodView.vue` — comment at `:269-271` only
- `src/services/sync/connectStorage.ts` — also loses the dead `RESUME_SETUP_PATH` re-export
- `docs/STATUS.md` — pointer for 127(b)/(c) incl. the `force: true` candidate, the `p-4` follow-up, the `runGuarded` follow-up
- `CHANGELOG.md`
- Tests (below)

**Explicitly not touched**

- `LoadPodView.vue`'s watchers; **the `load-drive` branch's `stopResumeWatch()`**; `BaseModal.vue`;
  the three sibling reconnect surfaces; `consumeResumeReason`; the four existing handler envelopes in
  `ResumePodSetup`; `syncStore.verifyPodAccess.test.ts` (its `connectStorage` mock stays valid
  because `syncStore` now imports the path helper from `resumePaths`); every file in the uncommitted
  #63 changeset.

## Observability Coverage

- **`provider-mismatch`** — reported once, by `finalizePod`'s existing critical path
  (`surface: resumeSetup.provider-mismatch`, context `provider_type`). Critical is right: a user
  action failed and the counterfactual was data loss.
- **Redirect started / returned** — `logEvent` on the existing `resumeSetup` surface with `action`
  values `create-redirect-start:<probe|connect>` and `create-redirect-return:<kind>`, so
  started-versus-returned is a funnel. Without the return event issue 3 is invisible: nothing running
  produces nothing to query.
- **Native consent denial** now lands under the same `'drive-consent'` reason as web.
- **No new context key.** `action`, `provider_type`, `error_code` are all already in
  `ALLOWED_CONTEXT_KEYS` (`src/utils/diagnosticContext.ts:61`).

## Acceptance Criteria

- [ ] A successful native Drive consent during create advances with no second tap — first attempt and a retry in the same mount.
- [ ] `LoginPage`'s dispatcher still runs after the `'setup'` branch has run: a same-mount `?resume=setup` → `?resume=setup-connected` sequence dispatches the second marker.
- [ ] A declined consent (nothing arrives) leaves a visible "taking you to Google… tap to try again" state whose button works; a failed or partial consent shows `driveConsentDenied` / `authFailed` on the storage (or retry) step.
- [ ] `createNewFile` refuses a provider bound to another family with `'provider-mismatch'`; a `null`-bound or same-family provider is accepted; demo seeding still works.
- [ ] `proceedToFinalize` with a foreign provider reconnects and writes into a fresh provider — no refusal shown.
- [ ] The mismatch copy does not mention the connection.
- [ ] `autoFinishDrive` is false immediately after consumption; `autoOpenDrivePicker` is cleared by `resetLoadPodFlags`.
- [ ] `redirectInFlight !== null` ⇔ `phase === 'redirecting'` holds after every transition (start, resume, cancel).
- [ ] `ResumePodSetup` gains no new try/catch/finally envelope; `resumeAfterRedirect` calls `handleRetry` / `handleConnectDrive`.
- [ ] Web reload path unchanged: `onMounted → runProbe` still owns the resume; `?resume=setup-connected` is treated as a podless recovery query everywhere.
- [ ] Success screen centred at phone width; the other seven `fullscreen-mobile` surfaces unchanged.
- [ ] New strings have `en` + `beanie`; `npm run validate` green.

## Testing Plan

**Unit**

1. `createNewFile`: foreign-bound provider → `{ ok:false, reason:'provider-mismatch' }`, no write call, `reportError` NOT called by the store; `null`-bound and same-family providers proceed. **And `seedDemoFamily` with `getActiveFamilyId` mocked to a DIFFERENT family id before `signUp` still seeds** — the A8 regression test, which must fail against the unreordered `demoSeed`.
2. `providerBelongsToAnotherFamily`: no provider / null binding / same / different.
3. `resumePaths`: `isPodlessRecoveryQuery(RESUME_SETUP_CONNECTED)`; `setupConnectedPath()` differs across two calls and keeps `resume=setup-connected`; `stashResumeReasonFor` stashes only for `DriveConsentDeniedError`.
4. `LoginPage` — new file `LoginPage.resumeSetupConnected.test.ts`. ⚠️ **Neither existing LoginPage test drives `route.query` reactively** (`resumeLoadDrive` mocks a plain object; `podlessRescue` mutates a hoisted plain object BEFORE mount). Case (b) needs the `watchEffect` to re-run on a query change AFTER mount, so the `vue-router` mock must return `reactive({...})` — built inside `vi.mock('vue-router', async () => { const { reactive } = await import('vue'); … })` — and (b) mutates `route.query` after mount then `await nextTick()`. Cases: (a) `resume=setup-connected` + authenticated → `resume-setup` view, model true; (b) **`resume=setup` FIRST, then `resume=setup-connected` in the same mount → the model flips true** — this is the test that fails against the unmodified `:251` stop and must be written to fail first; (c) `resume=load-drive` still stops; (d) a `resume=setup-connected` re-run with `autoFinishDrive` already consumed to `false` flips it `true` again (the per-attempt path).
5. `ResumePodSetup` — **there is no component test for this file today** (`src/components/login/__tests__/` holds only `resumePaths.test.ts` for this area); this creates the harness, mocking at the store/service boundary as the `LoginPage` tests do. Cases: immediate watcher with model already true and `redirectInFlight` null → no-op and model emitted false; after `enterRedirecting('connect')` a `true` → `handleConnectDrive`'s path once; invalid token → no redirect, message set, phase `storage`; `'probe'` kind → `handleRetry` once, failure phase `retry`; `cancelRedirect` after each kind lands on `REDIRECT_FALLBACK_PHASE[kind]` with `redirectInFlight` null.
6. `proceedToFinalize`: foreign provider + valid token → `finishOnDrive`, not `finalizePod`.
7. `handleNativeAuthRedirect` exchange-failure → `'drive-consent'` consumable for `DriveConsentDeniedError`.

**Browser** 8. Success screen at 400px, light and dark, screenshot inspected; one other `fullscreen-mobile` surface before/after. 9. Resume dispatcher driven via the route (`?resume=setup` → `?resume=setup-connected&attempt=1` → `&attempt=2`), asserting the view advances each time.

**Needs greg's hands (native OAuth is `Browser.open` + `appUrlOpen`)** 10. TestFlight: create a pod, complete consent → advances to recovery-kit with ONE tap. 11. TestFlight: decline consent → the redirecting state with its button; tap it, retry, complete → advances (retry in the same mount). 12. TestFlight: untick file access → "allow file access" message on the storage step. 13. TestFlight: device holding another family's Drive binding, create a new pod → writes into a fresh file, never the old one. 14. Confirm the nook screen is centred on a real iPhone.

## Review Passes

- **Pass 1 (Initial draft)**: drafted from verified root causes; chose mirror-the-prior-art over a three-surface refactor; put the data-loss guard in `createNewFile`; deferred the three sibling reconnect surfaces with reasons.
- **Pass 2 (DRY + error handling)**: verified every claim against the code. Found and fixed: the registry probe is a second create-side redirect returning to the same dead URL (`syncStore.ts:5547`); a native decline never calls `onComplete` (`googleAuth.ts:3097-3106`), so the redirecting phase needs an escape; a same-mount retry returns to the same URL, so the return path now carries a per-attempt nonce (this is greg's "3rd try"); a strict identity rule would refuse `demoSeed` and the E2E hook, so the predicate mirrors `doSave()`'s and lives once in `syncService`; `createNewFile` must not `reportError` (the caller already does, critical); the `ResumeSetupReason` extension was unnecessary and dropped, replaced by sharing the existing consent-denial stash with the native handler; the latch is consumed by the child via `defineModel`; `ensureDriveToken` is extracted from the existing `:520-536` block rather than re-written; `createFamilyId` unifies two family-id derivations; the `p-4` overlay is recorded as deliberately untouched.
- **Pass 3 (Sustainability)**: re-verified against the code. **Found one load-bearing defect:** the `'setup'` branch's `stopResumeWatch()` (`LoginPage.vue:251`) runs first on every native route-driven arrival, so the pass-2 dispatcher branch would never have executed on native; A3 now removes that stop, keeping the `load-drive` stop with its reason. **Simplified for maintainability:** `resumeAfterRedirect` no longer carries a fifth busy/try/catch/finally envelope, dispatching into the existing `handleRetry`/`handleConnectDrive` (new requirement 10); the `kind → phase` mapping repeated at three sites became one `REDIRECT_FALLBACK_PHASE` map; the paired `redirectInFlight`/`phase` state has a stated invariant and two owning helpers; `createFamilyId` now also feeds `finalizePod`; the escape button reuses `action.tryAgain` rather than adding a key; the predicate documents its empty-target case. **Recorded, not done:** `router.replace({ force: true })` at the single native sink as the candidate that fixes all sibling surfaces at once, and a `runGuarded` helper for the four existing envelopes. Flagged that `ResumePodSetup` has no component test and made the same-mount `setup`→`setup-connected` dispatcher case the test that must fail first.
- **Pass 4 (Fresh-eyes sweep)**: re-verified against the code. **Found one defect the plan would have introduced:** the `createNewFile` backstop would refuse REVIEW-DEMO seeding after a keep-data sign-out (`demoSeed` installs its provider before `signUp` at `:155`/`:163`; `database.ts:79-80` clears `currentFamilyId` only on delete) — fixed by reordering `demoSeed` (A8), which also removes a latent `doSave()` block on the demo pod. **Corrected three justifications** passes 2 and 3 had asserted: the E2E hook installs AFTER `signUp` and passes by equality; `handleRetry` carries no envelope (it is the same guarded `runProbe()` as `onMounted`); no existing LoginPage test drives `route.query` reactively, so test 4(b) must build a `reactive` route. **Named the third create-side starter** (`CreatePodView.vue:265`) and made the model-true no-op on a fresh mount an explicit contract rather than an accident. **Tightened:** the nonce is a module counter (deterministic; `Date.now()` can repeat within a millisecond and would make test 3 flaky); `stashResumeReasonFor` returns a boolean so native reports a consent denial at `warning` like web; `resumeAfterRedirect` consumes the stash once per return so a silent recovery cannot leave a false error for the next mount; `proceedToFinalize` sets `'finishing'` before the reconnect await as today; dropped the redundant `phase='storage'` after the reason map; removed the dead `RESUME_SETUP_PATH` re-export from `connectStorage`.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt

> Ok - i've done a pod creation test on an iphone and I am still seeing some issues - please
> investigate and diagnose the below issues: [welcome to the nook screen improperly formatted on
> iphone; creating the beanpod file in google drive failed, after retry it kept throwing me back to
> the same screen, but after the 3rd try it worked; when logging in again after clearing all data,
> after successful google drive consent, I am still thrown back to the select a file screen, but
> after clicking on the orange button, I am taken to the next step of setup. In 2 of the above
> issues, we are throwing users back to a screen they were already on with no error message shown
> (because the activity was presumably successful but the routing has a bug). We should NEVER put
> users back to the same screen they came if there was an error with no error message, and anytime
> we route users back to the same screen when there was NO error, that is a clear bug. We should
> ALWAYS be moving users forward to the next screen if there is no error or a previous error was
> cleared.] + the Slack critical error for surface resumeSetup.write.

### Follow-up 1

> Yes please address and fix these issues definitively (do not skip or leave for further review)
> with /beanies-build-auto - ensure that errors are always captured and successfull actions route
> appropriately. the most important, key goal for the overall setup and joiner process as a whole is
> to ensure it is smooth and seamless with minimal friction. any small issue can cause a user to
> drop or churn. please go ahead to fix. if you have any questions let me know otherwise pls proceed
> and do not stop unless there is a showstopper or blocking issue

### Follow-up 2

> once the plan is designed change the model back to opus

</details>
