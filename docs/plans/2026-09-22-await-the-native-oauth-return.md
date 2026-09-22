# Plan: Await the native OAuth return, and delete five resume machines

> Date: 2026-09-22
> Related issues: None — direct implementation.
> Supersedes the resume half of `docs/plans/2026-09-22-native-setup-reentry-and-provider-identity.md`
> and absorbs `docs/plans/2026-09-22-reconnect-resume-at-the-seam.md`.
> Plan file: `docs/plans/2026-09-22-await-the-native-oauth-return.md`
> Status: DRAFT — all four passes complete. Do not implement until greg approves.

## User Story

As someone on the installed app, I want a Google round trip — connecting Drive during setup, or
reconnecting a lapsed token — to simply continue where I left off, so that I am never returned to
the screen I just finished with nothing to show for it.

## Context

### Why this plan exists: the patches stopped converging

The 2026-09-22 setup work fixed the native create re-entry with a distinct URL marker, a
child-consumed latch, an `{immediate:true}` watcher, a `redirectInFlight` ref, a `hasMounted` ref, a
new `'redirecting'` phase and a per-attempt nonce. Two `/code-review max` rounds followed:

- **Round 1**: 15 findings, 13 fixed.
- **Round 2**: 15 findings — and **four were defects inside round 1's fixes**:
  - the `busy` guard left the latch armed with nothing able to re-arm it (the parent only ever
    writes `true`, which Vue drops as a no-change), discarding a valid Drive grant for the life of
    the page — _the original bug, reintroduced by its own fix_;
  - `?? ''` made `providerBelongsToAnotherFamily('')` true for every bound provider, turning a
    null family id into an unescapable refusal loop with a factually wrong message;
  - `hasMounted` was set after an `await` that can throw, silently disabling resume for the whole
    mount after the watcher had already burned the latch;
  - `cancelRedirect` discarded which starter was out and the fallback hardcoded `'connect'`, so a
    cancelled **probe** redirect dispatched into the create path that `runProbe`'s own docblock
    forbids by name.

These are not logic slips. They are **state-interaction** defects across seven interacting pieces of
state, in a component with **no test coverage at all**. `docs/lessons.md` and `CLAUDE.md` both say
that when review rounds keep finding regressions in the last round's fixes, the decision belongs in
the owning layer rather than in more call sites. That is this plan.

### The finding that makes deletion possible

**On native Capacitor the WebView, the component, the composable instance and the awaiting call
stack all survive the OAuth round trip.** `Browser.open()` resolves immediately
(`googleAuth.ts:2753`) and nothing unloads — which is the very reason nothing remounts.

So `connectDriveStorage` and `useGoogleReconnect.reconnect()` returning `'redirecting'` is what
throws the continuation away. Every marker, latch and watcher built since is an elaborate
reconstruction of a stack frame that was **never lost**.

On web the `'redirecting'` return remains exactly right: the page really is unloading and the
caller's stack really is about to be destroyed.

### What this deletes

Five resume machines, four of them shipped and one added last night:

1. `ResumePodSetup`'s `setup-connected` marker + `defineModel` latch + `{immediate:true}` watcher +
   `redirectInFlight` + `hasMounted` + `'redirecting'` phase + `resumeAfterRedirect` +
   `cancelRedirect` + `enterRedirecting`/`leaveRedirecting` + `REDIRECT_FALLBACK_PHASE`.
2. `LoginPage`'s `setup-connected` dispatcher branch, `autoFinishDrive` ref and template model.
3. `resumePaths`' `RESUME_SETUP_CONNECTED` + `setupConnectedPath()` + the seeded nonce, and the
   return-path scoping on `stashResumeReasonFor`.
4. `LoadPodView`'s `autoReconnectLoad` prop + watcher + the `isResume` half of
   `handleReconnectAndLoad`, and `LoginPage`'s `reconnect-load` branch, latch and reset (shipped
   0.21.6).
5. `resumePaths`' `RESUME_RECONNECT_LOAD` + `RECONNECT_LOAD_PATH`, `useGoogleReconnect`'s
   `opts.returnPath` / `opts.noRedirect` contract, and the router guard's log exclusion.

Round 2's findings 1, 4, 5, 6, 9, 10, 11 and 14 are all against machinery in that list. They are
resolved by removal rather than by an eighth patch.

### What this keeps

- The **cross-family provider guard** (`providerBelongsToAnotherFamily` + the `createNewFile`
  backstop). It is orthogonal to routing, it is the data-loss guard, and it stays — with round 2's
  findings 2, 3 and 8 fixed properly (A8).
- The **`load-drive` machine** (`LOAD_DRIVE_PATH` → `LoginPage` branch → `LoadPodView`'s
  `autoOpenDrivePicker` watcher). It is validated on a device, it is the picker not a token grant,
  and nothing here changes it. Its one consequence for this plan is in D7.
- The **#63 deep-link work**, which round 2 described as "in good shape".
- The **nook centring fix**.
- The `?resume=setup` marker itself, and `RESUME_SETUP_PATH`, for plain routing to the resume
  screen. Only the _Drive-return_ marker goes.
- `LoginPage`'s `setupBranchHandled` one-shot flag — verified in D7 as still load-bearing.

## Requirements

1. On native, a Drive connect during setup continues in place: the caller's own success and failure
   handling runs, one tap, no marker. This holds for **all three create-side starters**
   (`ResumePodSetup.finishOnDrive`, the registry probe, `CreatePodView`'s step-2 connect).
2. On native, a reconnect on any of the six `useGoogleReconnect` call sites does the same.
3. On web (iOS Safari, installed PWA) `'redirecting'` and the existing boot path are unchanged.
4. A round trip that never returns (the person dismisses the sheet) must settle, not hang.
5. A declined or dismissed consent must be reported as a user decision, not a code fault, on
   **every** flow — and classified by the **same code** that classifies the popup path's failures.
6. The five resume machines above are deleted, not left dormant.
7. The cross-family guard survives with round 2's findings 2, 3 and 8 fixed.
8. Started-versus-settled is queryable in CloudWatch: one `start` on the `native-oauth` surface
   always ends in **exactly one** settling event — `complete`, `declined`, an exchange-failure
   report, a `dismissed_*`, `superseded`, or one of the handler's own guard events (`no_pending`,
   `stash_unparseable`, the state-mismatch report, the neither-code-nor-error report). A failed
   `Browser.open` logs `open_failed` with no preceding `start`, which is correct: the sheet never
   opened.
9. `ResumePodSetup` gains its first component test, covering what survives.
10. No new copy of any classification that already exists: the native failure is delivered as the
    **same error object** the popup path would have thrown, so the seams' existing catches do the
    mapping.

## The design, argued

### D1: one primitive — `awaitNativeOAuthReturn()` — and the outcome carries the popup path's error

In `googleAuth.ts`, beside the listener that already knows every outcome. `startRedirectAuth`'s
native branch arms a module-level trip; `handleNativeAuthRedirect` settles it from each of its
arms. It **never rejects**; it resolves

```ts
type NativeOAuthOutcome = { kind: 'completed' } | { kind: 'failed'; error: Error };
```

Pass 1 had four string outcomes (`'completed' | 'failed' | 'declined' | 'dismissed'`). Pass 2
collapsed them to two, because every seam already carries a catch that classifies the **popup**
path's errors — `connectDriveStorage.ts:188-222` branches on `instanceof DriveConsentDeniedError`,
`useGoogleReconnect.ts:174-179` turns any error into `reconnectError` — and a string outcome would
have forced a second classification table beside each of them (requirement 10). Instead `failed.error`
is:

- the `DriveConsentDeniedError` `completeRedirectAuth` threw (an unticked scope);
- a new `OAuthRoundTripAbandonedError('declined' | 'dismissed')` for `error=access_denied` and for a
  sheet closed with no return;
- the raw exchange error otherwise.

A seam does `if (outcome.kind === 'failed') throw outcome.error;` inside its own `try` and its
existing arms take it from there. `connectDriveStorage` gains **one** arm (abandoned → `cancelled`);
`useGoogleReconnect` gains none. Telemetry still distinguishes declined from dismissed, because the
handler already logs `declined` at the arm and the primitive logs `dismissed_<signal>`.

**Never-rejects is load-bearing, not a style choice** (pass 4). Every native `startRedirectAuth`
arms a trip, but only the two create-side seams and the reconnect composable await one — the
picker, calendar, join, unified-reconnect and switch-account trips are armed and never read. A
rejecting promise nobody awaits is an unhandled rejection on every one of those flows.

### D2: the dismissed case

`@capacitor/browser` 8.0.4 exposes `browserFinished` (verified, `definitions.d.ts:21`). On iOS it
fires from `safariViewControllerDidFinish` / `presentationControllerDidDismiss` — **user**
dismissals only; our own `Browser.close()` calls `dismiss(animated:)` directly, which invokes
neither delegate (`BrowserPlugin.swift:55-58`, `Browser.swift:41-55`). On Android it fires from an
event group over `TAB_HIDDEN` + `onPause` (`Browser.java:handleGroupCompletion`), which its own
comment calls a heuristic, so a `visibilitychange → visible` listener is the **Android-only**
backstop: Custom Tabs are a separate activity, `MainActivity` is paused while the tab is up, and
`visible` can only mean the tab is gone or the deep link is landing. It is **not** installed on iOS,
where the sheet is a modal over the same view controller and `visible` also fires when the app comes
back from the background with the sheet **still presented** (a phone call mid-consent) — that would
settle a live trip as dismissed under an open sheet.

Either signal starts a 2.5 s grace; the deep link cancels it (the handler marks the return
**before** it calls `Browser.close()`, so our own close can never read as a dismissal). If nothing
arrives, the trip settles as `failed` with `OAuthRoundTripAbandonedError('dismissed')`. A false
dismiss shows in CloudWatch as `dismissed_*` followed by `return_*` for one `start`, and is
recoverable: the late exchange still commits the token, so the next tap short-circuits on
`isTokenValid()`.

**This is what makes requirement 4 hold without an escape button.** The await always settles, so the
spinner always ends — which is why the `'redirecting'` phase and its "try again" button (round 2's
finding 14: the button retried nothing) can be deleted rather than fixed. See (e) under A4 for the
full argument.

### D3: both seams await; the create seam gets one shared gate; the native return path is the current location

- **`connectStorage.gateCreateDriveAuth(loginHint)`** wraps `beginDriveAuthRedirectIfNeeded` for the
  two create-side callers (`connectDriveStorage`, the registry probe at `syncStore.ts:5570`). It
  returns `{ kind: 'proceed' } | { kind: 'redirecting' } | { kind: 'failed'; error }`: on native it
  awaits; on web it returns `redirecting`. `beginDriveAuthRedirectIfNeeded` itself is **unchanged** —
  its third caller, `syncStore.beginDriveAuthRedirect` → `LoadPodView.openDrivePicker` (`:1326`),
  must keep the marker behaviour (the kept `load-drive` machine), and an awaiting helper there would
  have opened the picker twice: once in place and once via the marker.
- **The gate is also the try/catch for a start failure** (pass 4). `beginDriveAuthRedirectIfNeeded`
  documents that a `startRedirectAuth` throw (no client id, `Browser.open` rejected) propagates to
  the caller. In `connectDriveStorage` that caller has a catch; in the probe it does not — the throw
  runs `attemptResumeFromRegistry → runProbe → onMounted` with no envelope on the way, and
  `onErrorCaptured` is scoped to the survey phase, so the screen stays on the `probing` spinner
  forever. The deleted `resumeAfterRedirect` carried a comment saying exactly this about
  `handleRetry`. The gate converts the throw into `{ kind: 'failed', error }` once, and both callers
  report it through their existing arms.
- **`useGoogleReconnect.reconnect`** — awaits after `startRedirectAuth` on native and resolves
  `'reconnected'` / `'failed'` exactly as the popup arm does. `opts.returnPath` and `opts.noRedirect`
  are deleted with the "a caller that cares MUST pass one" contract that had a 1-in-6 hit rate.
- **The native return path is the page's own location** (`currentLocationPath()`, extracted from
  `useGoogleReconnect.ts:158-159` into `redirectState.ts`). App.vue's sink (`App.vue:1818`) still
  does `router.replace(returnPath)` unconditionally — that is deliberately untouched, because the
  picker and calendar grants and the cold-boot case depend on it — so a live-stack seam must hand it
  a path that resolves as a **duplicate**. `RESUME_SETUP_PATH` is a duplicate from `ResumePodSetup`
  but a real navigation from `CreatePodView` (`/create`, route `CreateFamily`), and a real navigation
  would flip `activeView` to `resume-setup` under the wizard's feet while its continuation ran on an
  unmounted component — a silent double path and, on a failed consent, a wizard error nobody sees.
  With the current location the wizard continues exactly as the desktop popup path does: result
  modal → `finish-storage` → `ResumePodSetup`. On a JS-context restart mid-trip the fresh boot lands
  on `/create` or `/welcome?resume=setup`; `isPublicEntryRoute` suppresses the zombie report on both
  (`App.vue:1363`) and the boot's podless routing takes over. **Web keeps `RESUME_SETUP_PATH`**
  (requirement 3): the reload must hit LoginPage's fast path at first paint (`LoginPage.vue:434`).

### D4: `router.replace({ force: true })` — evaluated and rejected, recorded so nobody re-tests it

vue-router 4.6.4 does skip the duplicate short-circuit under `force` and does reassign the
`currentRoute` shallowRef, so a `watchEffect` reading `route.query` genuinely re-runs. **The premise
is true.** It is rejected because only three things in the app read the route at all, `RouterView`
does not remount on a same-record navigation, and it would change the return sink for the picker,
calendar and create flows at once. It is (a) with a different trigger.

### D5: what round 2's remaining findings become

| Round-2 finding                                                    | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1, 4, 5, 6, 9, 10, 11, 14 — resume state machine                   | **Deleted with the machinery** (6's subject, the `setup` branch's liveness, is re-decided on its own merits in D7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2 — `clearQueue()` destroys another family's unsent save           | **Fix**: clear only when this create's `provider.write()` actually ran (`writeAttempted`), which is the only moment its envelope can enter the queue                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 3 — `?? ''` inverts the guard                                      | **Fix**: `finalizePod` refuses with a critical report when `createFamilyId` is null, beside its existing `!user` guard; `''` is never passed; the predicate's "empty id is the safe direction" sentence and its test go                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 8 — `setProvider` binds a different truth than the caller compares | **Fix**: `setProvider(provider, familyId?)`; the two create-side installs pass the id they will compare against                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 7 — `resetLoadPodFlags` clears the `load-drive` latch too early    | **Keep** — the reset is right and the `autoReconnectLoad` line inside it is deleted with machine 4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 12, 13 — consent-denial classification on web and other flows      | **Fix by removal on native**: native no longer stashes at all (the awaiting seam gets the error in place); the stash becomes web-only, so `stashResumeReasonFor` loses its `returnPath` parameter. **Recorded, not fixed, on web**: the web boot catch (`App.vue:1308`) still stashes for EVERY Drive grant — the load picker and reconnect included — which has been `HEAD` behaviour since 2026-06-19 and is unchanged here. Scoping it would need `mode` from the decoded `state`, which `App.vue` does not hold at that catch; a stale `drive-consent` hint after a declined web LOAD remains possible and is a follow-up in `STATUS.md` |
| 15 — silent `phase='storage'` with no message                      | **Fix**: the `ensureDriveToken` fall-through in `proceedToFinalize` sets `formError`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

### D6: still not here, and why

The `BaseModal` `p-4` inset and the `runGuarded` envelope refactor stay out. Both are rewrites of
working code unrelated to OAuth returns, and this change is already a large deletion across auth
paths. Recorded in `STATUS.md`. Merging `useGoogleReconnect`'s redirect branch into
`beginDriveAuthRedirectIfNeeded` also stays out: the composable's silent-path ordering and its
`'recovered'` outcome are documented at length and differ on purpose.

### D7: `setupBranchHandled` stays — verified, not assumed

Pass 1 expected that with no Drive marker to stay alive for, the `setup` branch could go back to
`stopResumeWatch()`. Pass 2 checked what else the effect handles after `setup` has run in the same
mount: the `load-drive` branch (`LoginPage.vue:239-245`) is the **only** handler for
`?resume=load-drive`, and that marker is reachable from a `setup` arrival — `ResumePodSetup` →
`use-recovery` → `handleUseRecoveryKit` (`:786`) → `LoadPodView` in kit entry, whose Drive card
still calls `openDrivePicker` (`:1364-1372`) → `syncStore.beginDriveAuthRedirect(LOAD_DRIVE_PATH)`
(`:1326`) on native. At git `HEAD` the `setup` branch's `stopResumeWatch()` (`HEAD:LoginPage.vue:251`)
killed that return; round 1's flag fixed it incidentally. Restoring the stop would re-break it. The
flag costs one `let` and the effect's re-runs are three cheap early returns. **Keep it, and rewrite
its docblock to name `load-drive` as the reason** rather than the deleted marker.

## Approach

### A1. `googleAuth.ts` — the primitive, the arming, the closed-sheet listeners, the handler split

**New error class** in `src/types/sync.ts` beside `DriveConsentDeniedError` (googleAuth already
imports from there; the module stays dependency-light):

```ts
/**
 * A redirect / system-browser OAuth trip that ended with NO grant because the person said no
 * (`declined`: Google echoed `error=access_denied`) or closed the sheet (`dismissed`: no deep link
 * arrived within the grace). A decision, never a fault: `connectDriveStorage` maps it to
 * `cancelled`, and reconnect surfaces show the message verbatim, as they do every popup failure.
 *
 * Classified by `instanceof` at every seam, NEVER by message. The messages are user-facing because
 * the reconnect surfaces render `reconnectError` verbatim — a pre-existing English-only gap shared
 * with every popup failure, not widened here.
 */
export class OAuthRoundTripAbandonedError extends Error {
  constructor(readonly reason: 'declined' | 'dismissed') {
    super(
      reason === 'declined'
        ? 'Google sign-in was declined.'
        : 'Google sign-in was closed before it finished.'
    );
    this.name = 'OAuthRoundTripAbandonedError';
  }
}
```

**The trip state and primitive**, placed under the existing "Native (Capacitor) deep-link OAuth
completion" banner (`googleAuth.ts:2950`). Import `getPlatform` beside the existing `isNative`
import from `@/services/sync/capabilities` (`:12`).

```ts
/** How a native round trip ended. `failed.error` is the SAME error the popup path would have
 *  thrown (`DriveConsentDeniedError`, `OAuthRoundTripAbandonedError`, or the raw exchange error),
 *  so a seam's existing catch classifies it with no new code. */
export type NativeOAuthOutcome = { kind: 'completed' } | { kind: 'failed'; error: Error };

/** Sheet closed with no deep link: how long to wait for one before calling it dismissed. Long
 *  enough for Android's visibilitychange→appUrlOpen ordering, short enough not to feel stuck. */
const NATIVE_DISMISS_GRACE_MS = 2500;

interface NativeTrip {
  promise: Promise<NativeOAuthOutcome>;
  resolve: (o: NativeOAuthOutcome) => void;
  /** Set the moment our deep link is seen: from then on a closing sheet is the RETURN, not a dismissal. */
  returned: boolean;
  /** Set by `settleNativeTrip`. A settled trip STAYS in `nativeTrip` until the next arm, so a seam
   *  that reaches its await AFTER the settle still reads the outcome instead of a bogus
   *  "nothing armed" (the window between `Browser.open` resolving and the gate's await). */
  settled: boolean;
  graceTimer: ReturnType<typeof setTimeout> | null;
}
let nativeTrip: NativeTrip | null = null;
let browserFinishedHandle: { remove: () => Promise<void> } | null = null;
let visibilityHandler: (() => void) | null = null;

/** The ONE liveness predicate every signal consults: armed and not yet settled. */
function liveTrip(): NativeTrip | null {
  return nativeTrip && !nativeTrip.settled ? nativeTrip : null;
}

function abandoned(reason: 'declined' | 'dismissed'): NativeOAuthOutcome {
  return { kind: 'failed', error: new OAuthRoundTripAbandonedError(reason) };
}

/** Arm ONE trip. A second start while one is LIVE supersedes it with a dismissal rather than
 *  hanging its awaiter; a SETTLED trip is simply replaced — it has been read, or never will be. */
function armNativeTrip(): void {
  if (liveTrip()) settleNativeTrip(abandoned('dismissed'), 'superseded');
  let resolve!: NativeTrip['resolve'];
  const promise = new Promise<NativeOAuthOutcome>((r) => (resolve = r));
  nativeTrip = { promise, resolve, returned: false, settled: false, graceTimer: null };
}

/** A closed-sheet signal. Inert unless a trip is live, un-returned and not already in grace. */
function onSheetClosed(signal: 'browser-finished' | 'visible'): void {
  const trip = liveTrip();
  if (!trip || trip.returned || trip.graceTimer) return;
  trip.graceTimer = setTimeout(() => {
    trip.graceTimer = null;
    settleNativeTrip(abandoned('dismissed'), `dismissed_${signal}`);
  }, NATIVE_DISMISS_GRACE_MS);
}

/** Our deep link arrived. Cancels a running grace: the sheet closing WAS the return. */
function markNativeReturn(): void {
  const trip = liveTrip();
  if (!trip) return;
  trip.returned = true;
  if (trip.graceTimer) clearTimeout(trip.graceTimer);
  trip.graceTimer = null;
}

/** Resolve the live trip, if any — never twice. `action` is logged ONLY for outcomes the handler
 *  does not log itself (dismissals, supersessions, a failed open) so one start never yields two
 *  settling events. */
function settleNativeTrip(outcome: NativeOAuthOutcome, action?: string): void {
  const trip = liveTrip();
  if (!trip) return;
  trip.settled = true;
  if (trip.graceTimer) clearTimeout(trip.graceTimer);
  trip.graceTimer = null;
  if (action) {
    logEvent({
      level: 'info',
      surface: 'native-oauth',
      message: `native oauth ${action}`,
      context: { action },
    });
  }
  trip.resolve(outcome);
}

/**
 * Wait for the native round trip `startRedirectAuth` just started. ALWAYS settles: the deep link
 * settles it on every arm (and on a throw out of the arms), and a closed sheet with no deep link
 * settles it as dismissed after the grace. NEVER rejects — most trips (picker, calendar, join,
 * unified reconnect, switch account) are armed and never awaited, and a rejection nobody awaits
 * is an unhandled rejection. A seam throws `failed.error` into its own catch if it wants to.
 *
 * ⚠️ ON NATIVE THIS MUST DIRECTLY FOLLOW `startRedirectAuth`. A settled trip stays readable until
 * the next arm, so a caller that forgot to start would read the PREVIOUS trip's outcome; the
 * report below fires only when nothing has ever been armed.
 */
export function awaitNativeOAuthReturn(): Promise<NativeOAuthOutcome> {
  if (!nativeTrip) {
    reportError({
      surface: 'native-oauth',
      severity: 'error',
      message:
        'awaitNativeOAuthReturn() called with no round trip armed — on native it must directly follow startRedirectAuth',
    });
    return Promise.resolve({
      kind: 'failed',
      error: new Error('No Google sign-in is in progress'),
    });
  }
  return nativeTrip.promise;
}
```

**The closed-sheet listeners** — installed **once**, from `installNativeAuthListener`, by appending
`installSheetClosedListeners();` after the `appUrlOpen` registration (`:2978-2982`). No lazy install,
no flag: `installNativeAuthListener` already carries the idempotence guard and is native-only.

```ts
/**
 * The two "the sheet is gone" signals. Both consult `liveTrip()`, so they are inert when nothing
 * is armed and after a return (`markNativeReturn` runs BEFORE our own `Browser.close()`).
 *
 * `browserFinished` — both platforms. iOS fires it from `safariViewControllerDidFinish` /
 * `presentationControllerDidDismiss`: USER dismissals only; our `Browser.close()` calls
 * `dismiss(animated:)` directly, which invokes neither (BrowserPlugin.swift:55). Android fires it
 * from an event group over TAB_HIDDEN + onPause (Browser.java `handleGroupCompletion`), which its
 * own comment calls a heuristic — hence the backstop.
 *
 * `visibilitychange → visible` — ANDROID ONLY. Custom Tabs are a separate activity, so
 * MainActivity is paused while the tab is up and `visible` can only mean the tab is gone (or the
 * deep link is landing, which `returned` covers). On iOS the sheet is a modal over the same view
 * controller, and `visible` ALSO fires when the app returns from the background with the sheet
 * still presented (a phone call mid-consent) — it would settle a live trip as dismissed under an
 * open sheet. Do not widen this to iOS.
 */
function installSheetClosedListeners(): void {
  void Browser.addListener('browserFinished', () => onSheetClosed('browser-finished'))
    .then((h) => {
      browserFinishedHandle = h;
    })
    .catch((e) =>
      reportError({
        surface: 'native-oauth',
        severity: 'warning',
        message:
          'browserFinished listener failed to install; dismissed sheets settle via visibilitychange only (Android) or not at all (iOS)',
        error: e,
      })
    );
  if (getPlatform() === 'android') {
    visibilityHandler = () => {
      if (document.visibilityState === 'visible') onSheetClosed('visible');
    };
    document.addEventListener('visibilitychange', visibilityHandler);
  }
}
```

`__resetNativeAuthForTesting` (`:3169`) additionally: clears `nativeTrip?.graceTimer` (a fake-timer
grace must never fire into the next case), sets `nativeTrip = null`, removes and nulls
`browserFinishedHandle`, and `removeEventListener`s `visibilityHandler` when set, then nulls it. The
`@capacitor/browser` mock in the three native test suites gains
`addListener: vi.fn(async () => ({ remove: vi.fn(async () => {}) }))`.

**Arming** — in `startRedirectAuth`'s native branch, replace `:2752-2753` with:

```ts
// ARM before opening: the caller's stack survives the trip (nothing unloads), so it awaits
// `awaitNativeOAuthReturn()` next; a sheet closed faster than the open resolves must still count.
armNativeTrip();
try {
  await Browser.open({ url: authUrl });
} catch (e) {
  settleNativeTrip(
    { kind: 'failed', error: e instanceof Error ? e : new Error(String(e)) },
    'open_failed'
  );
  throw e; // the caller's try/catch reports it, as before
}
```

The `start` log stays where it is, after the open: `open_failed` with no `start` means "the sheet
never opened", which is the truth.

**`startRedirectAuth`'s docblock** gains this paragraph:

> On native every call arms a round trip that `awaitNativeOAuthReturn()` can read. Only three
> callers await it: `connectStorage.gateCreateDriveAuth` (for `connectDriveStorage` and the
> registry probe) and `useGoogleReconnect.reconnect`. The others — `usePickBeanpodFile` (join, both
> calls), `calendarAuth`, `unifiedReconnect`, `SettingsPage.handleSwitchGoogleAccount` and the
> Drive-load picker — do NOT await: their trips are settled and dropped deliberately, because their
> continuations are marker-driven (`LOAD_DRIVE_PATH`, the calendar stash + returnPath) or
> boot-driven. ⚠️ Do not add an await to one of them without removing its marker, or its
> continuation runs twice — once in place and once on the marker.

**The handler split.** `handleNativeAuthRedirect` becomes a wrapper that settles **even if the body
throws**; the body keeps every existing arm, comment and side effect but returns the outcome instead
of `void`:

```ts
export async function handleNativeAuthRedirect(
  url: string,
  onComplete: (p: string) => void
): Promise<void> {
  const transport = nativeOAuthTransport(url);
  if (!transport) return;
  markNativeReturn(); // BEFORE the body's Browser.close(): our own close must never read as a dismissal
  let outcome: NativeOAuthOutcome;
  try {
    outcome = await completeNativeAuthRedirect(url, transport, onComplete);
  } catch (e) {
    // Every arm returns; a throw here is a bug in the body, not a flow outcome. Settle anyway so
    // the awaiting seam never hangs on it — this also closes the pre-existing unhandled rejection
    // at the `void`ed listener call site.
    reportError({
      surface: 'native-oauth',
      severity: 'error',
      message: 'native OAuth completion threw outside its arms',
      error: e,
    });
    outcome = { kind: 'failed', error: e instanceof Error ? e : new Error(String(e)) };
  }
  settleNativeTrip(outcome);
}
```

`completeNativeAuthRedirect(url, transport, onComplete): Promise<NativeOAuthOutcome>` is the current
body from `:2999` on (the transport check moves up). Arm → return value:

| Arm                           | Returns                                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------- |
| `no_pending` (`:3019`)        | `{ kind: 'failed', error: new Error('No Google sign-in was pending when the return arrived') }` |
| `stash_unparseable` (`:3036`) | `failed` with the same shape                                                                    |
| state mismatch (`:3051`)      | `failed`, `Error('Google sign-in return failed its state check')` — the `reportError` stays     |
| picker (`:3078`)              | `{ kind: 'completed' }` — nobody awaits a picker trip; this only tears the arm down             |
| `error` param (`:3097`)       | `abandoned('declined')` — the `declined` log stays                                              |
| `!code` (`:3108`)             | `failed`, `Error('Google sign-in returned neither a code nor an error')`                        |
| calendar (`:3123`)            | `{ kind: 'completed' }`                                                                         |
| exchange success (`:3132`)    | `{ kind: 'completed' }`                                                                         |
| exchange catch (`:3142`)      | `{ kind: 'failed', error: e instanceof Error ? e : new Error(String(e)) }`                      |

A note on the state-mismatch row: a spoofed same-transport link arriving during a live trip settles
the **real** trip as failed. That is not a regression — the arm already calls
`clearGoogleSessionState()`, which cleared the PKCE stash and doomed the real return before this
plan existed. The difference is that the awaiting seam now learns of it (and shows a message)
instead of spinning until the real return hit `no_pending`.

The exchange catch **no longer stashes a resume reason** (D5, findings 12/13): the awaiting seam
receives the error itself. The dynamic `import('@/components/login/resumePaths')` goes; severity and
`error_code` come from `e instanceof DriveConsentDeniedError` directly (the class is already imported
at `:8`). Rewrite the catch comment: "classified in place by the awaiting seam; on web the boot path
stashes the hint for the reload (`App.vue:1308`)". The catch's `onComplete(stored.returnPath)` stays:
on native it resolves as a duplicate navigation, and the kept `load-drive` machine's own docblock
(`LoadPodView.vue:1297-1299`) depends on it.

### A2. `redirectState.ts` + `connectStorage.ts` — the shared return path and the create gate

`redirectState.ts` (dependency-light, already home to `isSameOriginReturnPath`) gains:

```ts
/** The page's own path + query. The return path for any trip whose caller CONTINUES IN PLACE —
 *  every native seam (the sink's `router.replace` then resolves as a duplicate) and the web
 *  reconnect, where reloading the same page IS the resume. */
export function currentLocationPath(): string {
  return `${window.location.pathname}${window.location.search}`;
}
```

`connectStorage.ts`:

- Delete the `setupConnectedPath` import and its comment (`:33-39`); import `RESUME_SETUP_PATH` from
  `resumePaths`, `currentLocationPath` from `redirectState`, `awaitNativeOAuthReturn` from
  `googleAuth`, `OAuthRoundTripAbandonedError` from `@/types/sync`.
- Add the gate (exported; `syncStore` uses it for the probe). The `kind` discriminant matches
  `ExistingBeanpodResolution` and `ResumeFromRegistryResult` in this same file and store:

```ts
/** What the create flow's Drive-auth gate did. */
export type DriveAuthGate =
  { kind: 'proceed' } | { kind: 'redirecting' } | { kind: 'failed'; error: Error };

/** Where a create-side redirect lands. WEB: the resume screen — the reload must hit LoginPage's
 *  fast path at first paint. NATIVE: right here — the stack is alive and continues in place, so
 *  the sink's `router.replace` must be a duplicate (from `CreatePodView` at `/create`,
 *  `RESUME_SETUP_PATH` would be a REAL navigation that flips the view under the wizard). It matters
 *  only on a JS-context restart mid-trip, where App.vue's boot routes a podless session on. */
function createReturnPath(): string {
  return isNative() ? currentLocationPath() : RESUME_SETUP_PATH;
}

/**
 * The create flow's Drive-auth gate, shared by `connectDriveStorage` and the registry probe.
 * `beginDriveAuthRedirectIfNeeded`, and then — on native, where nothing unloaded — WAIT for the
 * trip. `redirecting` is web-only: the page is unloading and the caller returns. A failed trip is
 * handed back as the SAME error the popup path would have thrown, so callers classify it once.
 *
 * This is ALSO the try/catch for a start failure (no client id, `Browser.open` rejected — already
 * settled as `open_failed`). The probe has no envelope between here and `onMounted`, and an
 * uncaught throw there leaves the screen on the probing spinner for good.
 *
 * NOT used by the Drive-load picker, whose return is the `load-drive` marker by design.
 */
export async function gateCreateDriveAuth(loginHint: string | undefined): Promise<DriveAuthGate> {
  try {
    if (!(await beginDriveAuthRedirectIfNeeded(createReturnPath(), loginHint, 'create'))) {
      return { kind: 'proceed' };
    }
  } catch (e) {
    return { kind: 'failed', error: e instanceof Error ? e : new Error(String(e)) };
  }
  if (!isNative()) return { kind: 'redirecting' };
  const outcome = await awaitNativeOAuthReturn();
  return outcome.kind === 'completed'
    ? { kind: 'proceed' }
    : { kind: 'failed', error: outcome.error };
}
```

- `connectDriveStorage`: the gate moves **inside** the existing `try` so one catch classifies both
  transports:

```ts
try {
  const gate = await gateCreateDriveAuth(opts.googleEmail);
  if (gate.kind === 'redirecting') return { status: 'redirecting' };
  if (gate.kind === 'failed') throw gate.error; // the arms below classify it exactly as a popup failure
  const fileName = …;                            // unchanged
  const provider = await withTimeout(GoogleDriveProvider.createNew(fileName, { forceConsent: !isTokenValid() }), …);
  syncService.setProvider(provider, opts.activeFamilyId); // A8: bind to the family the caller will compare against
  if (opts.activeFamilyId) await provider.persist(opts.activeFamilyId);
  return { status: 'connected', type: 'google_drive' };
} catch (e) {
  if (e instanceof OAuthRoundTripAbandonedError) {
    // Declined at Google or closed the sheet: a benign abort, like a dismissed local picker.
    return { status: 'failed', error: e.message, cancelled: true };
  }
  … the three existing arms and the generic fallback, unchanged …
}
```

Rewrite the docblock `:142-153`: on web `'redirecting'` + reload; on native the call **awaits the
trip and returns `connected`/`failed` in place** — the same shape the desktop popup produces.

- `adoptDriveStub` (`:304`): `syncService.setProvider(provider, opts.activeFamilyId)`.
- `beginDriveAuthRedirectIfNeeded`'s docblock `:53-54`: "create → `RESUME_SETUP_PATH` on web, the
  current location on native (see `createReturnPath`)"; and the "never swallowed" sentence gains
  "(`gateCreateDriveAuth` is that try/catch for the two create callers)".
- `StorageRedirecting`'s docblock (`:133`): "WEB ONLY. On native `connectDriveStorage` never returns
  this; it awaits."

### A3. `useGoogleReconnect.ts` — await on native; delete the `opts` contract

- Signature becomes `reconnect(loginHint?: string)`. Delete the `opts` parameter and its two
  docblocks (`:60-77`), the `noRedirect` block (`:139-152`) and the returnPath comment (`:153-157`).
- Import `isNative` from `@/services/sync/capabilities`, `awaitNativeOAuthReturn` from `googleAuth`,
  `currentLocationPath` from `redirectState`.
- The redirect branch becomes:

```ts
if (shouldUseRedirectAuth()) {
  await startRedirectAuth(currentLocationPath(), loginHint, 'reconnect');
  if (!isNative()) {
    // WEB: the page is unloading and NOTHING has been acquired yet. Not success.
    outcome = 'redirecting';
    return outcome;
  }
  // NATIVE: nothing unloaded — this stack is still here, so wait for the trip and report what
  // it did. This is what makes every caller's `reconnectSucceeded` branch run on native in ONE
  // tap; it used to need a per-surface marker + latch + watcher, of which exactly one existed.
  const trip = await awaitNativeOAuthReturn();
  if (trip.kind === 'failed') throw trip.error; // the catch below classifies it like a popup failure
  outcome = 'reconnected';
  return outcome;
}
```

- The outcome docblock (`:39-47`): `'redirecting'` is **web-only**; on native the composable resolves
  `'reconnected'` or `'failed'` and `isReconnecting` spans the whole sheet.
- Every call site keeps its `if (outcome === 'redirecting') return;` (still right on web). Only
  `LoadPodView` changes (A7). Update the two Settings comments (`:797-801`, `:906-911`) and
  `useLoginFlow.ts:1247-1248` ("the boot path re-enters this flow with a fresh token on return" —
  true on web, and now moot on native because the composable resolves in place).

### A4. `ResumePodSetup.vue` — delete machine 1; continue in place; the probe's native failure

**Delete** (every symbol verified against the file; nothing else imports any of them):

- `'redirecting'` from `Phase` and its docblock (`:140-149`); `RedirectKind` (`:152-153`);
  `redirectInFlight` (`:155-164`); `hasMounted` (`:166-167`) and `hasMounted.value = true` (`:266`);
  `REDIRECT_FALLBACK_PHASE` (`:169-180`); the `autoFinishDrive` `defineModel` (`:182-189`).
- `enterRedirecting`, `leaveRedirecting`, `cancelRedirect` (`:580-603`); `resumeAfterRedirect`
  (`:605-658`); the `watch(autoFinishDrive, …)` block (`:660-680`); `watch` from the Vue import
  (`:66`) — it has no other use in the file.
- The template's `'redirecting'` block (`:1397-1407`).
- `uiStrings.ts`: `resumeSetup.redirecting` (`:6270-6278`, `en` + `beanie`). `action.tryAgain`
  stays; it is used elsewhere.
- `ensureDriveToken`'s docblock loses its `resumeAfterRedirect` sentence (`:562-563`); the function
  stays with its one caller.

**`runProbe`** — the `'redirecting'` case (`:310-316`) becomes a bare `return` with "WEB ONLY: the
page is unloading; keep the probing spinner. On native `gateCreateDriveAuth` awaits, so this arm is
never taken." Add the new arm:

```ts
case 'drive-auth-failed': {
  // NATIVE (or a start failure on either transport): the gesture-less probe opened the sheet and
  // it came back without a grant. The pod IS known (the probe only redirects when the registry
  // holds a fileId), so `retry` copy is honest and its button re-runs the probe — now behind a tap.
  const consentDenied = probeResult.error instanceof DriveConsentDeniedError;
  if (!(probeResult.error instanceof OAuthRoundTripAbandonedError)) {
    reportError({
      surface: 'resumeSetup.probeDriveAuth',
      message: `Drive sign-in failed during the registry probe: ${probeResult.error.message}`,
      error: probeResult.error,
      severity: consentDenied ? 'warning' : 'error',
      context: { provider_type: 'google_drive' },
    });
  }
  formError.value = driveAuthMessage(consentDenied);
  phase.value = 'retry';
  return;
}
```

with `driveAuthMessage(consentDenied: boolean)` returning
`t(consentDenied ? 'resumeSetup.driveConsentDenied' : 'googleDrive.authFailed')` — it replaces the
identical ternary in `finishOnDrive` (`:1087-1089`), so the copy rule lives once. Import
`DriveConsentDeniedError` and `OAuthRoundTripAbandonedError` from `@/types/sync`.

**`finishOnDrive`** — `:1016-1021` becomes `if (r.status === 'redirecting') return; // WEB ONLY: the
page is unloading; on native connectDriveStorage awaited and this arm is never taken`. Nothing else
changes: on native the existing `'failed'` handling (collision, consent-denied, `cancelled`) and
`await finalizePod()` now run in place, inside `handleConnectDrive`'s busy/try/finally envelope. The
abandoned arm arrives with `cancelled: true`, so `finishOnDrive`'s `cancelled` test (`:1076`) reads
it as benign without consulting `isUserCancellation`'s regex — which is why A1's message wording is
free to be user-facing.

**`proceedToFinalize`** — unchanged except finding 15: the final `else` (`:737-739`) sets
`formError.value = t('googleDrive.authFailed')` before `phase.value = 'storage'`.

**`finalizePod`** — finding 3. Directly under the `!user` guard (`:785-793`), the same shape:

```ts
const familyId = createFamilyId.value;
if (!familyId) {
  formError.value = t('setup.fileCreateFailed');
  reportError({
    surface: 'resumeSetup.finalize',
    message:
      'finalizePod reached with no resolvable family id — refusing rather than passing "" to the cross-family guard',
    severity: 'critical',
  });
  return false;
}
```

and `createPod` passes `familyId` (never `?? ''`). The `providerBelongsToAnotherFamily` docblock in
`proceedToFinalize` (`:709-712`) stays; it now describes the only remaining `''` hazard.

**(e) Why deleting the `'redirecting'` phase is safe.** On native `finishOnDrive` no longer sees
`'redirecting'`; the whole sheet lives inside `handleConnectDrive`'s envelope with
`phase === 'finishing'` and `busy === true`, so the template shows the finishing spinner and hides
start-over — which is right, because the sheet is modal over the app anyway. The envelope's `finally`
releases both the moment the await settles, and the await always settles: a return settles it on
every handler arm, a closed sheet settles it after 2.5 s (`browserFinished` on both platforms, plus
`visible` on Android), a throw out of the handler settles it, a settle that lands before the seam
reaches its await is still read, a failed `Browser.open` settles it before rethrowing (and the gate
catches the rethrow), and a superseding start settles the previous one. The one state the old phase
existed for — "nothing will ever arrive" — no longer exists. The probe's gesture-less sheet is the
same: `'probing'` (start-over visible) until the gate settles, then `auto-load` or `retry`. On web
both callers still return early on `'redirecting'` and the page unloads, as before the changeset.

### A5. `LoginPage.vue` — delete machines 2 and 4; keep the one-shot flag (D7)

**Delete:**

- `RESUME_RECONNECT_LOAD` and `RESUME_SETUP_CONNECTED` from the `resumePaths` import (`:36`, `:38`).
- `autoReconnectLoad` ref + comment (`:115-116`); `autoFinishDrive` ref + docblock (`:117-125`).
- The `reconnect-load` branch (`:247-265`) and the `setup-connected` branch (`:269-278`).
- `|| route.query.resume === RESUME_SETUP_CONNECTED` and the "Both markers" comment in the podless
  fast path (`:428-434`) — back to `route.query.resume === RESUME_SETUP`.
- `autoReconnectLoad.value = false` and its comment in `resetLoadPodFlags` (`:576-582`);
  `autoOpenDrivePicker.value = false` and its comment **stay** (finding 7).
- `:auto-reconnect-load` (`:980`) and `v-model:auto-finish-drive` (`:1018`) in the template.

**Rewrite** the two comment blocks that justify the flag by the deleted marker (`:208-216` and
`:281-309`) into one, above `let setupBranchHandled = false;`:

```ts
/**
 * ONE-SHOT WITHOUT STOPPING THE EFFECT. Both halves matter:
 *  - It must not re-assert on every navigation: `useRoute().query` is a computed over the router's
 *    `currentRoute` shallowRef, so EVERY successful navigation re-runs this effect, and four handlers
 *    move `activeView` off 'resume-setup' without touching the URL (`handleUseRecoveryKit`,
 *    `handleRequestCreate`, `handleNavigate`, `handleFileLoaded`). A standing rule would snap someone
 *    mid-recovery back to the create wizard.
 *  - It must not stop the effect either: the `load-drive` branch above is the ONLY handler for
 *    `?resume=load-drive`, and that return is reachable from here in the same mount (use a recovery
 *    kit → LoadPodView → the Drive card → a native redirect). `stopResumeWatch()` used to sit here
 *    and killed exactly that.
 */
```

The header comment (`:196-211`) keeps cases 1 and 2 and drops the paragraph about `setup-connected`.

### A6. `resumePaths.ts` — delete machines 3 and 5; un-scope the stash

**Delete:** `RESUME_RECONNECT_LOAD` + `RECONNECT_LOAD_PATH` with their docblocks (`:29-46`);
`RESUME_SETUP_CONNECTED` (`:67-78`); `attemptSeed`, `attemptSeq`, `setupConnectedPath` (`:80-102`);
the two members and comment in `isPodlessRecoveryQuery` (`:117-122`) — it returns
`resume === RESUME_SETUP || resume === RESUME_LOAD_DRIVE`; `isDriveConsentDenied` (`:151-163`) — a
one-line `instanceof` that a service should not import from a component folder.

**Rewrite** `stashResumeReasonFor` (`:165-185`) to the web-only, unscoped form:

```ts
/** Stash the consent-denial hint IFF this redirect-auth failure was the user unticking file
 *  access. WEB ONLY: the reload that follows is what needs a stash. On native the awaiting seam
 *  receives the error in place and classifies it there. Returns whether a reason was stashed.
 *  Known gap, recorded in STATUS: the web boot catch calls this for every Drive grant, not only
 *  the create one (D5, findings 12/13). */
export function stashResumeReasonFor(e: unknown): boolean {
  if (!(e instanceof DriveConsentDeniedError)) return false;
  setResumeReason('drive-consent');
  return true;
}
```

`App.vue:1308-1309` already calls it with one argument — **no change there**. Fix the
`RESUME_SETUP_PATH` docblock (`:62-63`) to drop the `setupConnectedPath()` reference.

`resumePaths.test.ts`: delete the `RESUME_SETUP_CONNECTED` / `setupConnectedPath` cases (`:39-57`)
and the `isPodlessRecoveryQuery(RESUME_SETUP_CONNECTED)` assertion; the two `stashResumeReasonFor`
cases stay as written.

### A7. `LoadPodView.vue`, `router/index.ts`, `CreatePodView.vue`, `syncStore.ts` — the reconnect marker's remnants and the probe

`LoadPodView.vue`:

- Import only `LOAD_DRIVE_PATH` (`:41`). `isNative` stays (used at `:725`, `:738`).
- Delete the `autoReconnectLoad` prop + docblock (`:67-71`) and its watcher (`:1386-1402`).
- `handleReconnectAndLoad()` takes no options: delete the `isResume` warning block (`:1189-1198`,
  back to `if (!file) return;`), the "NATIVE ONLY" comment (`:1206-1218`) and the options object
  (`:1219-1225`) — the call is `await reconnect(syncStore.providerAccountEmail ?? undefined);`. Keep
  `if (outcome === 'redirecting') return;` with a "web only" comment. `openDrivePicker`'s own
  `isResume` (`:1285-1309`) is the kept `load-drive` machine — **untouched**.

`router/index.ts`: drop `RESUME_RECONNECT_LOAD` from the import (`:20`); the `if` around the
`app-podcreated-unconfigured` log (`:476`) goes and the log is unconditional; delete the two comments
that argue about the exclusion (`:462-475`).

`CreatePodView.vue`: comment only (`:269-277`): on web `'redirecting'` means the page is unloading; on
native `connectDriveStorage` awaits and this arm is never taken — the wizard continues exactly as the
desktop popup path does.

`syncStore.ts`: replace the `setupConnectedPath` import (`:37`) with `gateCreateDriveAuth` from
`connectStorage` (beside the existing `beginDriveAuthRedirectIfNeeded` import, which the load path
still uses). The probe (`:5562-5581`) becomes:

```ts
const gate = await gateCreateDriveAuth(authStoreInst.currentUser?.email);
if (gate.kind === 'redirecting') return { kind: 'redirecting' }; // web: the page is unloading
if (gate.kind === 'failed') return { kind: 'drive-auth-failed', error: gate.error };
```

`src/types/sync.ts`: `ResumeFromRegistryResult` gains `| { kind: 'drive-auth-failed'; error: Error }`
("NATIVE, or a start failure: the probe's gesture-less sheet came back without a grant; `error` is
the popup-shaped error") and the `'redirecting'` comment says web-only.
`syncStore.verifyPodAccess.test.ts:263-267`'s `connectStorage` mock gains
`gateCreateDriveAuth: vi.fn(async () => ({ kind: 'proceed' }))` and drops the dead
`RESUME_SETUP_PATH`.

### A8. `syncService.ts` / `syncStore.ts` — findings 2, 3 and 8 on the cross-family guard

- **Finding 8** — `syncService.setProvider(provider: StorageProvider, familyId?: string | null)`
  with `currentProviderFamilyId = familyId ?? getActiveFamilyId();` and a docblock line: "`familyId`:
  the family the caller is installing this provider FOR, when it knows it. The create seams pass
  the id they later compare against (`ResumePodSetup.createFamilyId`), because after a failed
  `switchFamily` the database's active id can still be the PREVIOUS family — which made the guard
  refuse the provider it had just bound, forever." The two create-side installs in `connectStorage`
  pass `opts.activeFamilyId` (A2). All other callers are unchanged by the default.
- **Finding 3** — the predicate's docblock loses "An EMPTY `familyId` … the safe direction"
  (`:807-808`); `providerIdentity.test.ts:72`'s empty-id case is deleted (passing `''` is now a
  caller bug, refused in `finalizePod`). Add a case: `setProvider(p, 'fam-B')` with
  `getActiveFamilyId` mocked to `'fam-A'` binds to `fam-B`.
- **Finding 2** — in `createNewFile`, `let writeAttempted = false;` beside `let step` (`:3047`),
  `writeAttempted = true;` immediately before `provider.write(envelopeJson)` (`:3113`), and the catch's
  `clearQueue()` (`:3240`) becomes `if (writeAttempted) clearQueue();`. Amend its comment: "Only
  once THIS create's write ran can its envelope be in the queue. Before that — the precondition,
  existing-pod and provider-mismatch refusals — the queue may hold ANOTHER family's unsent save
  (the very provider the mismatch refused), and clearing it would destroy that."

### A9. Tests

**`googleAuth.native.test.ts`** (existing harness; `Browser` mock gains `addListener`; the new
cases call `installNativeAuthListener(vi.fn())` first and take the `browserFinished` callback from
`Browser.addListener.mock.calls`; `getPlatform` via the existing `@capacitor/core` mock;
`vi.useFakeTimers` for the grace):

1. start → valid deep link → `awaitNativeOAuthReturn()` resolves `completed`; `onComplete` still called.
2. `error=access_denied` → `failed` with `OAuthRoundTripAbandonedError('declined')`; no `reportError`.
3. exchange throws `DriveConsentDeniedError` → `failed` with that instance; `reportError` at
   `warning` with `error_code: 'drive-consent-denied'`; **no** resume reason stashed.
4. `browserFinished` with no deep link → after 2.5 s `failed`/`dismissed`, `dismissed_browser-finished` logged.
5. `visibilitychange → visible` (platform `android`) then the deep link inside the grace → `completed`, no dismissal event.
6. `awaitNativeOAuthReturn()` with nothing armed → `failed` + `reportError` at `error`. **Resets
   first** so no settled trip from an earlier case is readable.
7. a second `startRedirectAuth` while one is armed → the first resolves `dismissed` (`superseded`).
8. `Browser.open` rejects → settled `failed` (`open_failed`) and the rejection propagates.
9. the body throws (mock `Browser.close` to reject **without** the internal catch — or make
   `stashPickerSelection` throw on a picker link) → settled `failed` and the "completion threw
   outside its arms" report at `error`.
10. `browserFinished` plus an elapsed grace **before** `awaitNativeOAuthReturn()` is called → still
    resolves `dismissed`, no "nothing armed" report.
11. platform `ios`: `visibilitychange → visible` arms no grace (trip still live after 2.5 s);
    platform `android`: it does.

**`useGoogleReconnect.test.ts`**: add `awaitNativeOAuthReturn` to the `googleAuth` mock factory and
mock `capabilities.isNative`; native + `completed` ⇒ `'reconnected'`; native +
`failed(DriveConsentDeniedError)` ⇒ `'failed'` with `reconnectError` = its message; the PWA case
(`:89`) still yields `'redirecting'`.

**`connectStorage.test.ts`**: add `awaitNativeOAuthReturn` to its `googleAuth` mock (`:15`);
`gateCreateDriveAuth` on web / native / token-held / `startRedirectAuth` throws ⇒ `failed`;
`connectDriveStorage` on native — `completed` ⇒ `connected` with `setProvider(p, activeFamilyId)`;
`OAuthRoundTripAbandonedError` ⇒ `cancelled`; `DriveConsentDeniedError` ⇒ `consent-denied` (proving
the popup arm classified it).

**`ResumePodSetup.test.ts`** (new, mocking at the store/service boundary as the LoginPage suites
do): (1) storage → `handleConnectDrive` → `connectDriveStorage` resolves `connected` →
`createNewFile` called once → `recovery-kit`; (2) `cancelled` ⇒ `storage` + message + `warning`
report; (3) probe `drive-auth-failed` with `DriveConsentDeniedError` ⇒ `retry` + `driveConsentDenied`
copy; (4) probe `redirecting` ⇒ stays `probing`; (5) `finalizePod` with a null family id ⇒ no
`createNewFile` call, critical report, `storage`.

**`LoginPage.resumeSetupConnected.test.ts`** → rename `LoginPage.resumeSetupOneShot.test.ts`, keeping
its reactive-route harness: (a) `?resume=setup` ⇒ `resume-setup`; (b) after the child emits
`use-recovery` (view moves), a fresh `query` object with the same `resume=setup` does **not** snap
back; (c) then `resume=load-drive` ⇒ `load-pod` with `autoOpenDrivePicker` — the effect is alive
after `setup`, which is D7's reason for the flag. (b) may be dropped if `useLoginFlow` fights the
harness; (a) and (c) are required.

**`syncStore.createNewFile` tests**: a `provider-mismatch` refusal leaves the queue untouched; a
failed write still clears it.

### A10. `STATUS.md`, `CHANGELOG.md`

- `STATUS.md:127(b)` and `(c)`: resolved — all six reconnect surfaces await on native; the retry
  limitation is gone with the marker. Record `force: true` (D4), the `p-4` and `runGuarded`
  follow-ups (D6), the D7 verification, and the web-only stash gap (D5, 12/13).
- `CHANGELOG.md` 2026-09-22: keep the first "no longer drops you back" bullet; replace the "offers a
  way out" bullet (that button is gone) with "Closing the Google sign-in sheet without finishing now
  returns you to where you were with a short message, instead of a spinner"; add "Reconnecting
  Google Drive from Settings, the access banner or the sign-in screen now takes one tap on iPhone
  and Android."

## Files Affected

**Modified**

- `src/services/google/googleAuth.ts` — primitive, arming, sheet listeners (from `installNativeAuthListener`), handler split with settle-on-throw, no native stash
- `src/services/google/redirectState.ts` — `currentLocationPath()`
- `src/types/sync.ts` — `OAuthRoundTripAbandonedError`, `drive-auth-failed`
- `src/services/sync/connectStorage.ts` — `gateCreateDriveAuth` (with the start-failure catch), `createReturnPath`, the abandoned arm, `setProvider` binding
- `src/services/sync/syncService.ts` — `setProvider(provider, familyId?)`, predicate docblock
- `src/stores/syncStore.ts` — probe via the gate, `writeAttempted`
- `src/composables/useGoogleReconnect.ts` — await on native, `opts` deleted
- `src/components/login/ResumePodSetup.vue` — machine 1 deleted, probe arm, `driveAuthMessage`, findings 3 and 15
- `src/pages/LoginPage.vue` — machines 2 and 4 deleted, flag docblock
- `src/components/login/resumePaths.ts` — machines 3 and 5 deleted, unscoped stash
- `src/components/login/LoadPodView.vue`, `src/router/index.ts`, `src/components/login/CreatePodView.vue`, `src/pages/SettingsPage.vue`, `src/composables/useLoginFlow.ts` (comments)
- `src/services/translation/uiStrings.ts` — one key removed
- Tests listed in A9; `syncStore.verifyPodAccess.test.ts` mock; `resumePaths.test.ts`; `providerIdentity.test.ts`; the three native suites' `Browser` mock
- `docs/STATUS.md`, `CHANGELOG.md`

**Explicitly not touched**

- `App.vue` (the sink and the web boot catch are correct as they are); `beginDriveAuthRedirectIfNeeded`
  itself; the `load-drive` machine end to end; `openDrivePicker`'s `isResume`; `BaseModal`; the four
  handler envelopes in `ResumePodSetup`; `demoSeed`; every file in the #63 changeset; the
  non-awaiting starters named in A1's docblock paragraph.

## Observability Coverage

- `native-oauth` gains `dismissed_browser-finished`, `dismissed_visible` (Android only — the
  listener is not installed on iOS), `superseded`, `open_failed`. With the existing `start` /
  `return_*` / `complete` / `declined`, the handler's guard events and the exchange-failure
  `reportError`, every `start` ends in exactly one settling event — the funnel requirement 8 asks
  for. `open_failed` is the one settling event with no `start` before it, by design.
- No new context keys: only `action` and `error_code` (both in `ALLOWED_CONTEXT_KEYS`).
- New `reportError` surfaces: `resumeSetup.probeDriveAuth` (warning for consent denial, error
  otherwise; nothing for an abandonment); `resumeSetup.finalize` reused for the null-family refusal
  (critical, like its `!user` sibling); `native-oauth` at `error` for an un-armed await and for
  "completion threw outside its arms", at `warning` for a failed `browserFinished` install.
- Nothing is `critical` except the null-family refusal, which is a create that could not proceed.

## Acceptance Criteria

- [ ] Native setup Drive connect from `ResumePodSetup` **and** from `CreatePodView`: one tap,
      continues in place, no marker in the URL, the wizard path matches desktop.
- [ ] Native reconnect on all six call sites: one tap, caller's own handling runs.
- [ ] Web `'redirecting'` behaviour and return paths unchanged.
- [ ] Dismissing the sheet settles within the grace and releases the UI; a failed `Browser.open`
      settles and reports, and the probe lands on `retry` rather than a stuck spinner.
- [ ] A declined or unticked consent reports at `warning` on every flow, classified by the seams'
      existing catches.
- [ ] Nothing imports `RESUME_SETUP_CONNECTED`, `setupConnectedPath`, `RESUME_RECONNECT_LOAD`,
      `RECONNECT_LOAD_PATH`, `autoFinishDrive`, `autoReconnectLoad`, `isDriveConsentDenied`, or passes
      `opts` to `reconnect()`.
- [ ] `setupBranchHandled` stays; a `load-drive` return after a `setup` arrival dispatches (test c).
- [ ] Round-2 findings 2, 3, 7, 8, 12, 13, 15 fixed as in D5; 1, 4, 5, 6, 9, 10, 11, 14 gone by deletion.
- [ ] `ResumePodSetup` has a component test; `npm run validate` and `npm run security:lint` green.

## Testing Plan

**Unit** — A9 in full; every existing native/login/reconnect suite passes unchanged or with
deletions only.

**Browser** — the nook centring (unchanged); nothing else here is drivable headless.

**Needs greg's hands (TestFlight / Android beta)**

1. Create a pod from the wizard, connect Drive at step 2 → result modal → recovery kit, one tap.
2. Land on resume-setup, connect Drive → one tap through to the recovery kit.
3. Untick file access → the "allow file access" message on the storage step; retry in the same mount works.
4. Dismiss the sheet with Done (iOS) / back (Android) → the button is live again within ~3 s with a short message.
5. iOS only: with the sheet open, take or simulate a phone call, return to the app → the sheet is
   still up and completing it still succeeds (no false dismissal).
6. Let the token lapse; reconnect from Settings, the pod-access banner, the recovery panel and the
   login reconnect panel → one tap each.
7. A device holding another family's Drive binding → the create refuses with the account message,
   and connecting storage again succeeds rather than looping.
8. Watch CloudWatch: one settling event per `start` on `native-oauth`.

## Review Passes

- **Pass 1 (Initial draft)**: established that two review rounds produced defects inside their own
  fixes, that all of them live in resume machinery, and that the machinery is unnecessary because
  the native call stack survives the round trip; scoped the change as five deletions plus one
  primitive; kept the cross-family guard and #63 out of the deletion; recorded `force: true` as
  evaluated and rejected.
- **Pass 2 (DRY + error handling)**: wrote the Approach in full against the code. **Changed the
  outcome shape** from four strings to `completed | failed(error)` so the native failure is the SAME
  error the popup path throws and each seam's existing catch classifies it — `connectDriveStorage`
  gains one arm, `useGoogleReconnect` none, and native stops stashing the resume reason (findings 12/13
  fixed by removal, `stashResumeReasonFor` un-scoped, `isDriveConsentDenied` deleted). **Found that the
  native return path must be the current location**, not `RESUME_SETUP_PATH`: from `CreatePodView`
  at `/create` the sink's `router.replace` would be a real navigation flipping the view under the
  awaiting wizard; `currentLocationPath()` is extracted from `useGoogleReconnect` and shared. **Found
  that the await cannot live in `beginDriveAuthRedirectIfNeeded`** because its third caller is the
  kept `load-drive` picker, so a `gateCreateDriveAuth` wrapper serves the two create-side callers and
  the probe gains a typed `drive-auth-failed` result. **Verified D7 against `HEAD`**: restoring
  `stopResumeWatch()` in the `setup` branch would re-kill the only `load-drive` handler for a
  same-mount arrival via the recovery kit, so `setupBranchHandled` stays with its reason rewritten.
  Specified findings 2 (`writeAttempted` scopes `clearQueue`), 3 (`finalizePod` refuses a null family
  id beside its `!user` guard) and 8 (`setProvider(provider, familyId?)`, passed by the two create-side
  installs). Argued (e) in full: the sheet now lives inside `handleConnectDrive`'s existing envelope
  and the await settles on every path, including a failed `Browser.open` and a superseding start.
  Enumerated every deleted symbol with line references and confirmed by grep that nothing else
  imports them; `App.vue` needs no change.
- **Pass 3 (Sustainability)**: found three reliability holes in the primitive and fixed them
  structurally. **(1) A settled trip was nulled before the seam could read it**: `settleNativeTrip`
  cleared `nativeTrip`, so a settle landing between `Browser.open` resolving and the gate's await
  produced a bogus "nothing armed" error; the trip now carries `settled` and stays readable until
  the next arm, with `liveTrip()` as the single predicate every signal consults. **(2) A throw out
  of the handler body never settled the trip**: the exported wrapper now awaits the body in a
  try/catch, reports at `error`, and settles either way. **(3) The `visibilitychange` backstop was
  an iOS false-dismissal**: `visible` on iOS also fires on a return from the background with the
  sheet still presented, so it is now Android-only, installed once from `installNativeAuthListener`
  with no lazy flag, and removable by the test reset. Also: `DriveAuthGate` given a `kind`
  discriminant to match its sibling unions; the error messages decoupled from
  `isUserCancellation`'s regex (classification is `instanceof` at every seam); the non-awaiting
  starters named in `startRedirectAuth`'s docblock with a warning not to double-run them; the
  spoofed-link consequence recorded at the state-mismatch arm; the web-only stash gap recorded
  rather than fixed; three test cases added for the three holes.
- **Pass 4 (Fresh-eyes sweep)**: applied all eleven pass-3 edits and verified their premises in the
  plugin sources (`BrowserPlugin.swift:55` dismisses directly, bypassing both delegates;
  `Browser.java` fires `browserFinished` from a `TAB_HIDDEN`/`onPause` event group its own comment
  calls a heuristic — which is the reason the Android backstop is justified, now stated in D2).
  **Added the gate's start-failure catch**: a `startRedirectAuth` throw from the probe had no
  envelope between `attemptResumeFromRegistry` and `onMounted` (`onErrorCaptured` is survey-scoped),
  leaving the screen on the probing spinner forever — the exact hazard the deleted
  `resumeAfterRedirect` documented about `handleRetry`; `gateCreateDriveAuth` converts it once to
  `{ kind: 'failed' }` and both callers report it through their existing arms. **Made never-rejects a
  stated invariant**: most trips are armed and never awaited, so a rejecting primitive would be an
  unhandled rejection on every picker/calendar/join/unified/switch-account flow. **Hardened the test
  reset** to clear a pending grace timer so a fake-timer grace cannot fire into the next case, and
  `visible` is now gated at install time (no listener on iOS at all) rather than per event. Tightened
  requirement 8 and Observability to list every settling event, including `open_failed` with no
  preceding `start`. Noted that `finishOnDrive` reads the abandoned arm via `cancelled: true`, which
  is what frees the error messages to be user-facing. Added the iOS phone-call manual test and the
  `useLoginFlow` comment to the touch list. Confirmed `/create` is a real route (`CreateFamily`),
  that `stashResumeReasonFor`'s single-argument web call needs no change, and that every line
  reference in A4-A8 resolves against the working tree.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt

> fix whatever the review finds. once the code review is complete, please move ahead directly to
> address and fix the follow-up items with /beanies-build-auto

### Follow-up (decision point)

> [Asked how to proceed after round 2 found defects inside round 1's fixes, greg chose:
> "Go structural — unify on await".]

### Pass 3 / Pass 4

> [Pass 3 produced an eleven-item edit list; pass 4 applied it and ran the fresh-eyes review.]

</details>

---

### Critical Files for Implementation

- /home/greg/projects/beanies-family/src/services/google/googleAuth.ts
- /home/greg/projects/beanies-family/src/services/sync/connectStorage.ts
- /home/greg/projects/beanies-family/src/composables/useGoogleReconnect.ts
- /home/greg/projects/beanies-family/src/components/login/ResumePodSetup.vue
- /home/greg/projects/beanies-family/src/pages/LoginPage.vue
