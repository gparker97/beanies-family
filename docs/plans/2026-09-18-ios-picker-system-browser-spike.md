# Plan: The Drive Picker on iPhone, disambiguate, fail fast, and adopt the system-browser Picker

> Date: 2026-09-18
> Related issues: Notion tracker #98 (Bug, Priority High)
> Plan file: `docs/plans/2026-09-18-ios-picker-system-browser-spike.md`

> **No GitHub issue created.** The tracker row carries `github issue = do not create github issue`;
> this plan is the record.

## User Story

As a family member joining an existing pod on my iPhone, I want to grant beanies access to my
family's `.beanpod` file on my own device, so that I can actually join without borrowing someone's
laptop; and when something does go wrong, I want it to fail in seconds with a message that is true
and a button that still works.

## Context

Joining is where beanies loses families. Under the `drive.file` scope a joiner must grant their OWN
app access to the pod OWNER's Drive file, and **only a Picker selection creates that grant**; a
Drive permission share explicitly does not (ADR-021 records the same finding for folders). On iPhone
the Picker never renders: the joiner waits up to a minute, gets "The Google file picker isn't
responding", and is returned to a screen whose "Choose your data file" button has vanished.

Reproduced on greg's iPhone and confirmed by a real user whose husband still could not join after
the 2026-09-17 fix. **At least five prior rounds have attacked this area and it still fails.** Per
`docs/lessons.md`, when patches keep failing in the same place the shape is wrong, not the patch,
so this plan leads with a different mechanism rather than a sixth repair to the same iframe.

**The mechanism is no longer speculative.** Assumption 1 was closed by an on-device probe on
2026-09-18: Google's system-browser Picker renders on both desktop Chrome and iOS Safari using this
app's existing Web OAuth client. So this is not a spike on "does it work at all"; it is a mechanism
that will most likely become the primary join path on iOS. The plan is therefore written for the
long-term cost of that mechanism, not only for the cost of trying it once. See
**Exit Criteria and Convergence**.

### What the failure is NOT

`PICKER_TIMEOUT` is **not a blocked popup**. The Picker is an in-page iframe, never `window.open`.
The 30s timer is armed at `src/services/google/drivePicker.ts:295`, just _above_ the `try` block at
`:304` that builds the Picker and calls `setVisible(true)`; a synchronous throw inside that block
settles with `reason: 'open'` (`:380`) and `settle` clears the timer (`:289`). So a `PICKER_TIMEOUT`
still means the iframe was created and then never posted a single callback back, but by elimination
rather than by ordering. Do not "simplify" that by moving the timer below the build: the timer is
above it so that a hang inside `build()` itself is still bounded.

A lost user-activation would surface as `reason: 'open'`, and on iOS the activation-sensitive path
is unreachable anyway because `shouldUseRedirectAuth()` returns true for
`isNative() || isIosOrIpadOs() || isStandalone()` (`src/services/google/googleAuth.ts:492-497`).

### The two candidates, which telemetry currently cannot tell apart

**(a) Native iOS.** `drivePicker.ts:325` passes `setOrigin(window.location.origin)`. In the installed
app that origin is `capacitor://app.beanies.family`. This is not incidental and cannot be changed:
`capacitor.config.ts:13-21` records that `iosScheme: 'https'` is **silently ignored** by
`CAPInstanceDescriptor.normalize()` because WKWebView reserves `https`, so the value is discarded and
reset to `capacitor`; tried and reverted in build 8. A non-http scheme can neither be a registered
JavaScript origin nor supply an HTTP `Referer` for the developer-key check, so Google's iframe cannot
validate the host and never posts back. Note that `LoadPodView.vue:706-709` **already refuses to do
this** ("Never the in-WebView Google Picker (fragile on iOS WebKit)"); the join path has no
equivalent guard anywhere. On Android the origin _is_ `https://app.beanies.family`
(`capacitor.config.ts:22-25`), which is why the evidence is iOS-specific.

**(b) iOS Safari / PWA.** ITP partitions the `docs.google.com` iframe's storage once the page has
navigated through `accounts.google.com` and back, which on iOS it **always** does, because redirect
auth is forced there. Root-caused in `docs/plans/2026-04-26-joiner-onboarding-hardening.md` and never
fixed; the planned `CAPABILITY_IOS_SAFARI` pre-flight was never shipped. ITP behaviour varies by iOS
version and by recent google.com visits, which explains "works on some iPhones, not others".

**These are indistinguishable from the current telemetry, and the reason is more specific than
"nothing ships".** A full user agent already ships on every event: `enrichAndRedact` stamps
`browser = navigator.userAgent` unconditionally (`src/utils/diagnosticContext.ts:562`). It does not
help, for two verified reasons:

- the installed app does not customise its UA (there is no `appendUserAgent` in
  `capacitor.config.ts`), so the iOS WKWebView user agent **is** a Mobile Safari user agent, which
  is exactly the (a)-versus-(b) distinction;
- an installed PWA and an ordinary Safari tab also share one user agent, so (b) cannot be split
  either.

Meanwhile `os` is on the allowlist (`diagnosticContext.ts:111`) and has **no writer anywhere in the
app**, and `recordError` (`useJoinFlow.ts:520-553`) forwards only `error_code`, `file_id_tail`,
`invite_token_tail` and `provider_type` (`:541-551`). Capacitor's own `getPlatform()` answers (a)
versus (b) directly and a standalone-display probe splits (b); neither is derivable from a UA.
Everything else in this plan is downstream of settling it.

### What compounds it

- **Over 60s of unbranded spinner, worst case.** Up to three Drive round-trips (see below), then a
  20s script load, a 20s `gapi.load`, a 4s userinfo call, and finally the 30s picker window.
- **The step is a dead end on failure.** The `'failed'` arm (`useJoinFlow.ts:899-904`) calls only
  `recordError`, which never touches `currentStep`, unlike the `'cancelled'` (`:887-891`) and
  `'redirecting'` (`:893-897`) arms, which both call `enterAwaiting`. So `currentStep` stays
  `'authenticating'`. In `JoinPodView.vue` the spinner renders on `isBusy && !currentErrorView`
  (`:447`) and the CTA renders only on `currentStep === 'awaiting-auth'` (`:453`); after a failure
  the first is false (an error now exists) and the second is false (the step never moved).
  **Neither renders**, so the joiner is left with the error banner alone. The banner does carry the
  registry's recovery buttons, so this is a badly degraded state rather than a total dead end, but
  the primary CTA is gone.
- **Severity is `'critical'`**, so every occurrence pages `#beanies-errors`.
- **iOS freezes `setTimeout` while backgrounded**, so some of these events are just "the user
  switched apps".

## Requirements

1. A `PICKER_TIMEOUT` event in CloudWatch must identify the platform, and therefore the document
   origin, so candidates (a) and (b) are distinguishable without guessing.
2. A picker that cannot bootstrap must fail in under ~10s, not 30-60s, and must not increase the
   volume reaching `#beanies-errors`.
3. A failed pick must leave the "Choose your data file" CTA on screen.
4. One user tap must not repeat an **identical** Drive read (same fileId, same token).
5. Google's documented **system-browser Picker** (non-iframe, full-page redirect) must be reachable
   behind a Settings feature flag, so it can be compared against the current Picker on the same
   device without a rebuild, on **both** the web return path and the native deep-link return path.
6. A `.beanpod` arriving via a share sheet (any platform) must get a message that is true, instead of
   "beanies can read photos, screenshots, PDFs and links."
7. The `'critical'` severity on `PICKER_TIMEOUT` must be revisited once (a)/(b) is known.
8. No OAuth scope change, no new server component, and no change to the `.beanpod` format.
9. **The system-browser mechanism must be removable and convergent.** It lives in one owning module
   plus a bounded, listed set of call sites, and it reaches a named decision point where it either
   becomes the default (flag deleted) or is deleted outright. "Both mechanisms, indefinitely" is not
   an acceptable end state.
10. **No existing accepted file type may be lost.** The `.beanpod` constant consolidation must
    preserve `.json` acceptance everywhere it exists today.
11. **No picker return may ever tear down the app's Google session.** The mechanism's whole premise
    is that the existing `DRIVE_SCOPES` token survives the round trip and reads the picked file.

## Important Notes & Caveats

### Emulation cannot verify this, say so rather than producing a green run that proves nothing

ITP and the `capacitor://` origin **are** the failing conditions, and Playwright WebKit reproduces
neither. A green emulated run is not evidence here. Safari/PWA is testable from a real iPhone via
`npm run dev -- --host` against the LAN URL; the native arm needs a TestFlight build.

### The feature-flag CARD is tree-shaken from production; the flag itself is not

`SettingsPage.vue:116-118` imports `DevFeatureFlagsCard.vue` behind `import.meta.env.DEV`, so the
**card** is tree-shaken out of production builds entirely. The flag's _read model_ is separate and
does still work in production: `flags.ts:5-12` documents a per-browser localStorage override
(`beanies:flag:<id>`) that beats the committed prod gate, and `flagRegistry.ts:27-28` records that
this is deliberate ("it is how the soak gets run at all").

What that means concretely for requirement 5:

- **Dev server (covers the Safari/PWA arm from a real iPhone):** toggle in Settings, no rebuild.
- **TestFlight build:** the card is gone, so the levers are either a deliberate build with
  `systemBrowserPicker: true` committed, or setting the localStorage override from a JS console
  (Safari Web Inspector, which needs a Mac). A deliberate build is the realistic option here.

This does not change the conclusion the plan draws from it, and the conclusion is the load-bearing
part: **production users can never be switched onto a mechanism by a dev flag**, so a flag cannot be
the shipping selection rule. It has to graduate to a capability predicate. See
**Exit Criteria and Convergence**.

### Complexity budget, and the invariants that must survive

This plan edits the OAuth redirect machinery, which is the most incident-prone area in the app, and
adds a third grant to a state machine that has two. That is affordable once, on the condition that
the additions are structural rather than conventional. Four invariants are load-bearing, and each
gets a test in the Testing Plan so a future tidy-up fails CI rather than a family's join:

1. **A picker redirect never exchanges a code and never commits a Drive token**, on any of the three
   return paths (web, native, an older build decoding the state).
2. **The native CSRF `state` check runs before anything branches on the stash**
   (`googleAuth.ts:2973-2980` today; moved up by this plan, see Phase 2 point 7). It is the primary
   authenticity control on a custom-scheme transport that any installed app can invoke.
3. **The web redirect path still carries no PKCE verifier and still relies on the confidential
   proxy** (`googleAuth.ts:2680-2688`, ADR-026 amendment). Nothing here changes that.
4. **A picker return never calls `clearGoogleSessionState()`.** Every other arm of
   `handleNativeAuthRedirect` does (`:2941`, `:2975`, `:2986`), and that function clears in-memory
   tokens _and_ the persisted refresh token (`:2032-2061`). A picker return that tore the session
   down would destroy the very token it exists to let through.

Anything in this plan that cannot be expressed as one of: a closed union, a single owning module, or
a test, should be cut rather than written down as a rule people are expected to remember.

### The picker scope cannot be combined with anything, and three code paths can violate that silently

Google's spec is explicit: _"only the `drive.file` scope is permitted for these apps and it can't be
combined with any other scope."_ This app's `DRIVE_SCOPES` is `drive.file` **plus**
`userinfo.email` (`googleAuth.ts:41-48`). So the picker authorization must be a **standalone**
`drive.file`-only request, and the token it returns **must never overwrite the app's main Drive
token**: doing so would silently strip `userinfo.email` and break `fetchGoogleUserEmail`, which is
what `resolvePickerAccount` (`drivePicker.ts:207-252`) depends on.

Three paths can commit that token by accident, and all three are closed explicitly in Phase 2:

1. `handleNativeAuthRedirect` (`googleAuth.ts:2897-3025`) falls through to
   `sessionStorage.setItem(REDIRECT_AUTH_CODE_KEY, code)` + `completeRedirectAuth()` for any grant
   it does not recognise. **This is the native return path, which is candidate (a), the platform the
   whole spike exists for.**
2. `OAuthCallbackPage.vue:65-66` routes to `REDIRECT_AUTH_CODE_KEY` for any grant that is not
   literally `'calendar'`.
3. An **older build** decoding a picker `state`. `REDIRECT_STATE_VERSION` is an exact-match gate but
   the grant is optional-and-defaulting: `redirectState.ts:149` resolves anything that is not
   `'calendar'` to `'drive'`. A stale service-worker-cached build would therefore exchange the code
   and commit the scope-stripped token, silently. Closed by encoding picker states at `v: 2` (see
   Approach); an old build then returns `null` and routes to the existing, reported
   `oauth.redirectStateLost` surface.

### The native return handler tears the session down on three of its four arms

Read `handleNativeAuthRedirect` before adding to it. Its `error` arm (`:2940-2951`), its state-
mismatch arm (`:2972-2981`) and its no-code arm (`:2983-2991`) all call `clearGoogleSessionState()`,
which is a full Google teardown, not a stash cleanup. Two consequences shape Phase 2 point 7:

- The picker arm must clear only `REDIRECT_AUTH_KEY`. It must not copy the neighbouring shape. The
  calendar arm at `:2997-3002` deliberately _leaves_ the stash because the calendar completion still
  needs the PKCE verifier out of it; the picker has no completion and no verifier to leave, so it
  removes the key rather than leaving a stale one for `completeRedirectAuth` to trip over
  (`:2711-2722` reads that stash whenever a code is pending).
- The `error` arm currently runs **above** the CSRF check and therefore above any knowledge of which
  grant returned. If Google answers a picker decline with `error=access_denied`, today's ladder would
  sign the joiner out of Google because they changed their mind about a file chooser. Whether a
  onepick cancel returns `error=` at all is unknown; the ladder is restructured so it does not
  matter.

### The picker return is consumed on the next `pick()`, which costs one tap

`consumePickerRedirectResult()` runs at the top of `usePickBeanpodFile.pick()`. After returning from
Google the joiner is on the awaiting card (the `'redirecting'` arm already put them there,
`useJoinFlow.ts:893-897`) and must tap "Choose your data file" once more; that tap consumes the
stashed selection and loads the file without a second redirect. This is deliberate: one consumption
site is what makes the stash's lifecycle provable. It is written down here, and in the acceptance
criteria, rather than being discovered on a TestFlight build.

The stash is keyed by mechanism, not by flow: all three `usePickBeanpodFile` consumers share it. That
is intentional (one key, one writer, one reader), and what puts the right surface in front of the
user is `returnPath`, which is captured per redirect. The 5-minute expiry bounds the pathological
case where a different surface's `pick()` runs first.

The auto-resume variant (consuming during join-flow resume, so no tap is needed) is **explicitly
deferred**: it would add a second consumption site for a read-and-clear key, which is the shape that
produces "the selection vanished" bugs. Revisit only after the mechanism is the default.

### Do not "fix" things that are already correct

- `setQuery('*.beanpod')` was suspected during the 2026-09-16 round and is **fine** (STATUS.md).
- The "Shared with me" view being added first is right for a joiner and deliberate (STATUS.md).
- The `iframe` failure reason, its copy, and its error code **already exist**
  (`drivePicker.ts:166`, `:408`); this plan reuses them rather than adding a reason.
- The 30s timer sits **above** the build block on purpose; see Context.
- `getDeviceLabel()` in `src/utils/platformLabel.ts` already composes the platform answer and is
  already unit-tested (`platformLabel.test.ts`). Do not write a fourth platform detector;
  `capabilities.ts:96` explicitly forbids a third vocabulary.
- `startRedirectAuth` already defaults to `prompt: 'consent'` (`googleAuth.ts:2657`, `:2691`) and
  `buildAuthUrl` always sets `access_type=offline` (`:2258`). Those are **exactly** the two values
  the verified probe used, so the picker call passes no `prompt` at all. Do not "improve" it to
  `select_account`: that would deviate from the only configuration observed to work.

### Explicitly out of scope

- **Backend proxying the file.** Our server would possess the `.beanpod`, breaking the claim the
  whole privacy story rests on.
- **`drive.readonly` or full `drive`.** Verified against Google's scope table: `drive.readonly` is
  **RESTRICTED**, not merely Sensitive; annual third-party CASA assessment, "potentially several
  weeks". `drive.metadata.readonly` is restricted too, so there is no cheap metadata-only dodge.
- **A shared app-folder strategy.** ADR-021 records that folder sharing does not grant app API access
  to the files inside.
- **An in-app chooser over `files.list`.** Under `drive.file` that returns only files the app created
  or that were picked, precisely never the joiner's problem file.
- **"Open with" from the Drive iOS app as a join route.** Confirmed on-device by greg: it is the
  share sheet, which hands over file **bytes** with no Drive grant. A local copy forks the pod
  (ADR-033) and re-merging carries the compaction hazard. Scope item 6 is honest messaging only.
- **`drive.google.com/open?id=FILE_ID` as a grant.** Proposed externally; verified **false**, a
  first-party viewer redirect with no `client_id` and no scope.
- **Declaring a `.beanpod` document type in `Info.plist`.** It would not help: the app comment at
  `ios/App/App/Info.plist:66-74` records that when both a share extension and a document type match,
  iOS routes to the extension, and our extension already claims files.
- **A short-lived "side" Drive token.** See Assumption 3: if the assumption fails, this plan stops
  and is re-planned rather than growing a second token lifecycle inside `googleAuth.ts`.
- **Auto-resume of the picker return without a tap.** Deferred; see the caveat above.
- **Widening `OAUTH_RESULT_PARAMS`** (`src/constants/nativeOAuth.ts:40`). See Phase 2 point 10: it
  would not fix the case it appears to fix, and it would couple this spike to a marketing-site
  deploy.
- **Renaming the other `.beanpod` literals.** Default filenames (`syncStore.ts:2820`, `:5177`,
  `:5180`), the Picker's `*.beanpod` view queries (`drivePicker.ts:307`, `:314`) and the Drive search
  query (`driveService.ts:392`) are not extension tests. Phase 3a converts extension tests only.

## Assumptions

> **Review these before implementation.**

1. ~~The Google Cloud project has the **Picker API** enabled and the existing Web OAuth client
   accepts `trigger_onepick`.~~ **VERIFIED 2026-09-18 by on-device probe, no longer an assumption.**
   greg opened a hand-built `accounts.google.com/o/oauth2/v2/auth` URL (`trigger_onepick=true`,
   `scope=drive.file` only, `response_type=code`, `access_type=offline`, `prompt=consent`,
   `redirect_uri=https://app.beanies.family/oauth/callback`) and Google rendered a file picker on
   **both desktop Chrome and iOS Safari**. This closes the config branch: the Picker API is enabled,
   the registered redirect URI is accepted, and our **Web**-type OAuth client accepts
   `trigger_onepick`. That last point was a genuine risk, because Google's page documents only the
   desktop-app and Android client types and states a separate client id is needed per platform.
   No new OAuth client, no new redirect URI, no scope change.
2. The `drive.file` grant is stored server-side per `(app, Google account, file)` and therefore
   survives new devices and new tokens. This is why the pod owner never hits the picker and a joiner
   hits it exactly once.
3. Because of (2), the **authorization code returned by the picker flow does not need to be
   exchanged at all**: the app's existing `DRIVE_SCOPES` token for the same account can read the
   file once the grant exists. **STILL UNVERIFIED, AND A GATE ON PHASE 2** (see below).
4. ~~That `picked_file_ids` actually arrives on the redirect URI.~~ **VERIFIED 2026-09-18 by the
   same probe.** greg completed a real pick and captured the callback URL. The return carried, in
   this order:

   | param             | value                                        | note                                                                                                                                                                                                        |
   | ----------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `iss`             | `https://accounts.google.com`                | **Undocumented on Google's picker page.** Harmless, but the return carries params we did not ask for, so the handler must read the params it wants and ignore the rest rather than validating an exact set. |
   | `picked_file_ids` | a single bare Drive file id, **no comma**    | Matches `allow_multiple=false`. Parse as a comma-separated list anyway, since the param is documented as one and `allow_multiple` may later be set.                                                         |
   | `code`            | an authorization code                        | Scope-limited (see next row). **Never commit it over the main Drive token.**                                                                                                                                |
   | `scope`           | `https://www.googleapis.com/auth/drive.file` | Exactly `drive.file`, nothing else. First-hand confirmation of Google's "cannot be combined with any other scope" rule, and the hard evidence behind the scope caveat.                                      |

   No `state` was returned because the probe URL omitted one. The real flow sends `state`, which is
   what routes the return and makes the capability gate effective, so its absence here is expected
   and not a gap.

5. The picker return supplies file **ids only**, not names. The join path is unaffected
   (`doPickAndLoad` already prefers `expectedFileName.value` from the invite link, and
   `OpenFromDrivePage.vue:78` shows a placeholder name is an accepted pattern), but the two recovery
   surfaces will show a placeholder until the load resolves the real name. Accepted and stated
   rather than hidden.
6. Marketplace registration is already complete and desktop web "Open with" on a `.beanpod` works
   today (greg confirmed), so a desktop fallback exists, merely unpromoted.
7. `os` and `detail` remain allowlisted telemetry context keys
   (`diagnosticContext.ts:111`, `:199`; mirrored at `infrastructure/lambda/telemetry/index.mjs:106`,
   `:145`). Verified 2026-09-18. `os` currently has no writer anywhere in the app; `detail` is
   already used as a bounded, PII-free descriptor by several surfaces.
8. **The `code` on a successful pick is what carries the native iOS return home.** The Astro bridge
   hops to the custom scheme only when `code` or `error` is present (`nativeOAuth.ts:40`, `:109-112`;
   `web/src/pages/oauth/native.astro:120-150`), and Assumption 4 observed a `code` on every completed
   pick. A **cancel** carries neither, and therefore does not auto-hop; see Phase 2 point 10 for why
   that is accepted rather than engineered around.

### Assumption 3 is a gate, not a fork

Assumption 4 is now **observed** (see the table above), so one question remains: can the app's
existing `DRIVE_SCOPES` token read a file the picker granted, without exchanging the picker's code?

**Phase 2's return handler does not get written until that is observed on a device.** It is
answerable by a ten-minute repeat of the probe greg already ran, and the stronger version of the test
uses a second Google account that has never seen the pod file, because that is the joiner's actual
situation; greg's own account already holds grants that could mask a failure. Complete a selection,
then load the file by id through the app's existing token (the `/open` route does exactly this:
`OpenFromDrivePage.vue:72-87` calls `loadFromGoogleDrive(fileId, '.beanpod')` with no picker
involved).

If that read fails with a 403 or 404, **stop and re-plan**. The tempting fallback, exchanging the code into a short-lived
side token used only for the initial read, is a second Drive token lifecycle inside the module that
has already produced repeated incidents; it roughly doubles Phase 2, it needs its own expiry, its own
storage key, its own teardown on sign-out, and its own "never commit this over the main token" rule
enforced by convention. That is not a spike, and temporary token lifecycles are not temporary.
Phases 0, 1 and 3 are unaffected by the gate and ship regardless.

## Approach

Four phases, deliberately ordered so the cheap unconditional wins ship independently of the spike and
nothing waits on an answer we do not have yet.

### Phase 0 — Disambiguate the telemetry (ship first, alone, no flag)

Everything else is downstream of knowing whether (a) or (b) is failing.

**No new telemetry context key.** `os` and `detail` are both already allowlisted and already
mirrored in the Lambda, so there is **no allowlist edit**, **no Lambda-mirror edit**, **no
`PrivacyInfo.xcprivacy` change** and **no store Data-Safety re-declaration**.

**One new two-line export, because there are three emitters, not one.**
`src/utils/platformLabel.ts` gains:

```ts
/**
 * The platform pair that ships on telemetry: `os` is the analytics/registry vocabulary,
 * `detail` is the device label. Together they are the only way to tell the installed app
 * from Safari from an installed PWA — the UA that `enrichAndRedact` already stamps as
 * `browser` cannot (the WKWebView UA is a Safari UA, and a PWA's is a tab's).
 */
export function platformContext(): { os: ReturnType<typeof getPlatform>; detail: string } {
  return { os: getPlatform(), detail: getDeviceLabel() };
}
```

It composes the two functions this module and `capabilities.ts` already own, so it is **not** a
fourth detector, and it gives the pair one doc home instead of three hand-typed object literals
(`recordError`, the drivePicker success event, and every Phase 2 `PICKER_EVENTS` emitter). The same
edit corrects two now-stale doc comments, with no behaviour change:

- this module's header (`:1-10`), which presents these labels as "the new-joiner Slack pings";
- `capabilities.ts:96`, which describes `platformLabel.ts` as "a Slack-only telemetry vocabulary".

Both now also feed the firehose. The "do not introduce a third vocabulary" rule at
`platformLabel.ts:17-21` is untouched and still binding.

**The edit that actually satisfies Requirement 1 is in `useJoinFlow.recordError`, not in
`drivePicker.ts`.** Verified: `drivePicker.ts` emits exactly two `logEvent`s, both inside
`resolvePickerAccount` (`:234`, `:243`), and `pickBeanpodFile` emits none at all. Every
`PICKER_TIMEOUT` / `PICKER_FAILED` event in CloudWatch is produced by `recordError`
(`useJoinFlow.ts:520-553`). So:

- `recordError`'s context block (`:541-551`) gains `...platformContext()`. That fixes **every** join
  error code at once, not just the picker ones, which is why it is the right site rather than a
  picker-specific patch. ⚠️ The function already has a local `const detail` at `:528` that feeds the
  Slack `message`; name the spread's source `platformContext()` and do not introduce a second local
  called `detail`.
- `drivePicker.ts` resolves `platformContext()` **once** at the top of `pickBeanpodFile`, passes it
  into `resolvePickerAccount` as a second argument so the two `picker_authuser_unpinned` events
  carry it too, and spreads it into the new success event. Never a fresh UA test per call site.
- Emit on the **success** path (`level: 'info'`, `action: 'picker_opened'`), so the _rate_ is
  measurable rather than only the failures. `logEvent` collapses identical
  `(surface, normalized-message)` events at 50/minute (`logEvent.ts:74-75`), which is well above the
  per-session volume here.

### Phase 1 — Fail fast, stop stranding the step, stop repeating the read (unconditional, no flag)

These help every platform and do not depend on the spike's outcome.

**Fail fast, with ONE timer.** The iframe either bootstraps within a few seconds or never does.
`hasLoaded` already tracks the `'loaded'` callback (`drivePicker.ts:281`, `:345`). Change
`const timeoutHandle` to a `let` (declared above `settle`, which already closes over it), arm it
first at `PICKER_BOOTSTRAP_TIMEOUT_MS` (8s), and on fire:

- `hasLoaded === false` → settle with the **existing** `reason: 'iframe'`, which already has copy and
  an error code (`picker-iframe`, `:408`);
- `hasLoaded === true` → reassign `timeoutHandle` for the remaining
  `PICKER_TIMEOUT_MS - PICKER_BOOTSTRAP_TIMEOUT_MS`, whose callback is today's timeout settle,
  preserving today's 30s total for the genuinely-stalled-after-load case.

The reassignment must happen inside the callback before it returns, so `settle`'s single
`clearTimeout` (`:289`) always holds the live handle. One handle, one clear, nothing new to leak. Do
not move the timer below the build block; see Context.

Accepted cost, stated rather than discovered: an 8s budget can false-fail a genuinely slow
connection. The user then sees the same copy they would have seen at 30s, 22 seconds earlier, and
`settle` runs `disposePicker` so there is no zombie iframe behind it. That trade is the point.

**Do not turn the fast-fail into a Slack flood.** `JOIN_CODE_FOR_PICK_REASON.iframe` currently maps
to `PICKER_FAILED` (`useJoinFlow.ts:845`), whose registry entry is `severity: 'critical'` (`:244-248`).
Firing at 8s instead of 30s means strictly _more_ occurrences reach `#beanies-errors`, because fewer
users background away first. So the severity call for this arm is made **now**, not deferred:

- add `PICKER_IFRAME_BLOCKED` to `JoinErrorCode` with
  `messageKey: 'join.error.pickerFailed'` (**reused, no new string**),
  `recoveries: ['retry', 'signInDifferentAccount', 'tryAnotherDevice']` (identical to
  `PICKER_FAILED`), `severity: 'warning'`;
- remap `iframe → 'PICKER_IFRAME_BLOCKED'` in `JOIN_CODE_FOR_PICK_REASON`, leaving `open` on
  `PICKER_FAILED` at `'critical'` (a genuine fault) and `timeout` on `PICKER_TIMEOUT` untouched for
  Phase 4.

The rationale matches the registry's own precedent at `:218-222` and `:261-265`: a structural
platform condition is a rate to watch in the firehose, not an incident to page on. All severities
still reach CloudWatch, so nothing is lost.

**Stop stranding the step.** Have the `'failed'` arm (`:899-904`) move the step as the sibling arms
already do, so the "Choose your data file" CTA survives a failure. The error banner is rendered
outside the step template (`JoinPodView.vue:375`, "ERROR BLOCK (rendered above any step content)"),
so moving the step shows the CTA _and_ keeps the banner. **Do not reuse `enterAwaiting('cancelled')`**:
`AwaitingReason` is `initial | needs-pick | cancelled | redirecting` (`:64-68`) and drives
user-facing copy, so labelling a failure "cancelled" would state something untrue. Add a `'failed'`
member to the union instead; `enterAwaiting` is documented as the ONLY way to reach `awaiting-auth`
(`:431-446`) and that structure is preserved, not bypassed.

**No new copy for it.** `AWAITING_COPY` in `JoinPodView.vue:37-42` already maps **both** `initial`
and `needs-pick` to `'join.pickerPrompt.description'`; `'failed'` maps to the same key. The error
banner rendered directly above (`:375-418`) already says what went wrong and carries the recovery
buttons, so a second message on the same screen would duplicate it. The table is
`satisfies Record<AwaitingReason, UIStringKey>`, so forgetting the entry is a compile error.

**Do not repeat an identical read, and fix it at the source.** There are up to **three** identical
reads on the ordinary sequence, not two: `init()` → `runCloudFlow(false)` (`:1134`), the tap's
`runCloudFlow(true)` (`:1134` again), and `resolveWithoutPicker` (`:876`). The second and third are
deliberate and must not be deleted; their own comments (`:864-873`, `:1171-1205`) record that the
pre-auth to post-auth retry is a real fix and that `tryAutoLoadByFileId` is reused so the
404/403 → Picker classification stays in one place.

Memoize inside `tryAutoLoadByFileId` (`:759`), which already calls `tryGetSilentToken()` itself
(`:764`) and so is the only place that knows both facts. The fix needs no plumbing through
`doPickAndLoad` or `resolveWithoutPicker`. Four constraints keep it a memo rather than a cache:

- **Instance scope, not module scope.** `tryAutoLoadByFileId` takes no arguments and reads
  `targetFileId.value` from closure, so the memo is a plain `let lastNeedsPick:
{ fileId: string; token: string } | null = null` declared inside `useJoinFlow()`, beside the other
  flow refs. At module scope it would leak across join attempts and across unit tests, which is the
  failure mode this kind of optimisation usually ships with.
- **One writer rule, statable in one sentence.** _Every_ exit of `tryAutoLoadByFileId` writes the
  memo: the `404 || 403 → 'needs-pick'` branch sets it to the current `(fileId, token)`, and every
  other exit sets it to `null`. `doPickAndLoad`'s `'picked'` arm also sets it to `null`, because a
  successful pick creates the grant and a later probe with the same token must be allowed to succeed.
  That is the complete invalidation rule; there is no third place to remember.
- **It short-circuits only `'needs-pick'`, which is the one outcome that reads no store state.**
  The other exits consult `syncStore.error` and `result.payloadError` (`:791-805`); skipping the call
  on any of those would risk reporting a stale error. `'needs-pick'` returns on the structured HTTP
  status alone (`:783`), so replaying it is exact.
- **Fail open.** The memo only ever short-circuits to the value it already observed
  (`'needs-pick'`). If anything is uncertain, do the read. An optimisation must never be the reason a
  joiner cannot load their file.

This is strictly better than a coarse "skip if the first returned `needs-pick`" rule, which would
**wrongly suppress a real recovery**: `usePickBeanpodFile.ts:132-141` runs
`tryReconnectSilently(loginHint)` before `tryGetSilentToken()`, which can mint a token for a
_different_ account, making the retry genuinely different and genuinely useful.

### Phase 2 — The system-browser Picker, behind the `systemBrowserPicker` flag

> **Gated on Assumption 3 being observed first.** See the gate above.

Google documents a Picker that is explicitly **not** an iframe: _"A redirect to the Google Picker
within a new tab in the user's default browser"_, returning `picked_file_ids` appended to an OAuth
redirect. That is the same shape as the redirect auth **already working on iOS in this app**, and it
is Google's own published answer to the embedded-webview problem. Assumption 1 confirms it renders on
iOS Safari and desktop Chrome with this app's existing client.

This is an **extension of existing machinery, not new transport**, which is the main reason to prefer
it. Each extension point below is the minimum edit, and each is named because a bigger one was
considered and rejected.

**0. One module owns the mechanism: `src/services/google/pickerRedirect.ts` (new, ~120 lines).**

This is the single most important structural decision in the phase. Without it the mechanism is nine
edits across six files with no home, and the two return handlers each hand-write the same wire
format. Two copies of one payload shape is drift by construction; it is exactly the duplication that
had to be fixed twice already for the `=== 'calendar'` literal (`redirectState.ts:71` and
`googleAuth.ts:2650`).

The module owns, and is the only place that knows:

- `PICKER_REDIRECT_RESULT_KEY` (`'beanies_redirect_auth_code:picker'`);
- `PICKER_RETURN_MAX_AGE_MS` (5 minutes);
- the stash payload type `{ ids: string; ts: number }`;
- `stashPickerSelection(idsParam: string | null): boolean`, a guarded `setItem` returning `false` on
  throw, called by **both** return handlers;
- `consumePickerRedirectResult(): PickBeanpodFileResult | null`, read-and-clear, expiring, every
  branch logged;
- `PICKER_EVENTS`, an `as const` object holding the surface literal and the action names, so the
  seven event names cannot drift into an eighth spelling (`logEvent`'s `surface` is a free string,
  `logEvent.ts:32-33`).

**It must be a LEAF module: at runtime it imports `logEvent` and `platformContext`, and nothing else
from the Google services.** `googleAuth.ts` has to import `stashPickerSelection`, and `googleAuth` is
imported by most of the app, so any runtime import back into the Google service graph from here is an
import cycle. Two specifics, both verified:

- `PickBeanpodFileResult` must come in as `import type { PickBeanpodFileResult } from './drivePicker'`.
  A **value** import would be a real cycle, because `drivePicker.ts:8` imports `googleAuth` at
  runtime: `googleAuth → pickerRedirect → drivePicker → googleAuth`. `import type` is erased, so the
  type is free.
- The key is declared **here**, not derived from `REDIRECT_AUTH_CODE_KEY`. `googleAuth.ts:77` gains a
  one-line pointer comment beside `REDIRECT_AUTH_CODE_KEY_CALENDAR` so all three grant slots remain
  discoverable from one place and cannot silently collide.

Why not put `consumePickerRedirectResult` in `drivePicker.ts`, as an earlier draft had it:
`drivePicker.ts` is the gapi-iframe module. Coupling it to an OAuth redirect stash means the file
that should be _deleted or shrunk_ if the spike wins is the file the winner depends on. Keeping them
apart is what makes either outcome a clean deletion.

`startRedirectAuth` is called directly from `usePickBeanpodFile` (point 9), not wrapped here, for the
same no-cycle reason.

**1. `buildAuthUrl` (`googleAuth.ts:2246-2280`) gains ONE optional parameter, with a CLOSED key
type.** It already builds `https://accounts.google.com/o/oauth2/v2/auth` with `client_id`,
`redirect_uri`, `response_type=code`, `scope`, `access_type=offline` and `prompt`: every parameter
Google's picker spec requires, and the same set the verified probe used. It already has six
positional parameters, so the picker's extras arrive as a single trailing optional object rather than
four more positionals.

The type is **not** `Record<string, string>`:

```ts
type PickerAuthParam =
  | 'trigger_onepick' | 'mimetypes' | 'allow_multiple' | 'file_ids' | 'allow_folder_selection';
extraParams?: Partial<Record<PickerAuthParam, string>>
```

The extras are applied with `params.set` _after_ the core parameters, so an open record would let any
future caller silently overwrite `redirect_uri`, `scope`, `client_id` or `response_type`. Those are
precisely the parameters this module has already had to defend twice (the PKCE invariant at
`:2680-2688`, ADR-026 amendment). A closed union makes passing `scope` a compile error rather than a
runtime hijack. No second URL builder.

**2. `RedirectAuthOptions` (`:2544`) gains a matching `extraParams`,** threaded into both
`buildAuthUrl` calls inside `startRedirectAuth` (`:2656` native, `:2689` web). Nothing else in that
function changes, because it already takes a per-call `scope` (`:2607`) and a per-call `grant`
(`:2606`).

⚠️ The native branch always sends a PKCE `code_challenge` (`:2640-2642`), which the verified probe did
not. It should be inert, because the picker's code is never exchanged, but it is an unverified
deviation from the one configuration observed to work. It is a named watch item on the TestFlight run
(Testing Plan item 15) rather than a conditional, because a `grant`-shaped exception inside
`startRedirectAuth` would cost more than it protects.

**3. `DRIVE_FILE_SCOPE` (`googleAuth.ts:41`) is exported.** The picker request passes
`scope: DRIVE_FILE_SCOPE`, never `DRIVE_SCOPES`, and never a retyped URL literal.

**4. `redirectState.ts` gains `'picker'`, documented as a NON-AUTH grant, and the two
`=== 'calendar'` literals become grant-generic.** Adding the member to `RedirectGrant` (`:45`) alone
is **not** sufficient: `encodeRedirectState:71` writes the grant only `if (payload.grant === 'calendar')`,
so a picker grant would be silently dropped on the wire. Both `encode` and the decode ternary at
`:149` become grant-generic:
`obj.grant === 'calendar' || obj.grant === 'picker' ? obj.grant : 'drive'`. Drive states stay
byte-identical, which is the existing contract.

The union gains a doc comment, because the name is otherwise actively misleading: **`'picker'` is not
a grant the app completes. No code is ever exchanged for it and no token is ever committed from it.**
It rides the auth `state` only because that is the channel that survives a cross-site redirect. That
sentence lives on the type, once, instead of being restated at each return site.

**5. Picker states are encoded at `v: 2`; decode accepts `{1, 2}`.** This is the only lever we have
over an **older build**: `v` is an exact-match gate in code that has already shipped, so bumping it
for picker states is the one thing that makes a stale service-worker-cached build refuse the state
rather than decode it as `'drive'` and commit a scope-stripped token (see Caveats).

Expressed as exactly two constants and one pure function in `redirectState.ts`, so it reads as a
deliberate mechanism rather than a version bug:

```ts
export const ACCEPTED_STATE_VERSIONS = [1, 2] as const;
const stateVersionForGrant = (g: RedirectGrant) => (g === 'picker' ? 2 : 1);
```

`decode` replaces the `obj.v !== REDIRECT_STATE_VERSION` equality at `:129` with membership in
`ACCEPTED_STATE_VERSIONS`, exactly as the file's own FORWARD-COMPAT note at `:20-25` prescribes, and
`RedirectStatePayload.v` becomes `(typeof ACCEPTED_STATE_VERSIONS)[number]`.

⚠️ `decode` currently returns a **hardcoded** `v: REDIRECT_STATE_VERSION` at `:150`, not the value it
read. Under an accept-set that would report `v: 1` for a v2 payload, which is a lie waiting for the
first person who trusts it. Return the narrowed `obj.v`. Nothing outside the module reads `v` today,
which is exactly why this is cheap to get right now and expensive to get wrong later.

The comment must say what `v` is doing here, because it is not a schema version: **it is a capability
gate.** Picker states are v2 because a v1-only build must refuse them; drive and calendar stay v1 so
an auth already in flight across a deploy still completes. **Removal condition, recorded so this does
not become a permanent two-version decoder:** once no v1-only build can still be served (the service
worker cache horizon, plus the native build drain), collapse to a single version and delete
`stateVersionForGrant`. An old build then returns `null` and routes to the **existing, reported,
actionable** `oauth.redirectStateLost` critical path (`OAuthCallbackPage.vue:102-113`).

**6. `OAuthCallbackPage.vue` gains a picker arm ABOVE the code arm.** The existing ladder starts at
`if (decoded && code)` (`:61`), below the popup (`:40-45`) and iframe (`:47-51`) early returns, which
the picker arm sits below too.

Placing it first means **one arm owns every picker outcome**, and that is the point. Traced against
the current ladder, the alternatives are all worse:

- a picker cancel that returns neither `code` nor `error` falls through `if (code)` (`:102`) and
  `if (error)` (`:117`) to `window.location.href = '/'` (`:159`), **discarding the invite URL** and
  dead-ending the joiner silently. That is the exact class of bug the `:124-145` comment block was
  written to fix;
- a picker decline that _does_ return `error=access_denied` would take the join arm at `:146-151` and
  append `?authError=access_denied`, which `useJoinFlow` renders as a sign-in failure. True for a
  declined consent, false for "I closed a file chooser".

So:

```ts
if (decoded?.grant === 'picker') {
  // No `code` here is normal: the user cancelled in Google's UI. An `error` here is
  // likewise not a sign-in failure, so it must not reach the `authError` arm below.
  if (!stashPickerSelection(params.get('picked_file_ids'))) {
    reportError({
      surface: 'oauth.redirectStateLost',
      severity: 'critical',
      message: 'picker redirect returned but the selection could not be stashed',
    });
  }
  window.location.href = decoded.returnPath; // never '/': the invite URL is the context
  return;
}
```

Six lines, one exit, no payload construction. Note this does **not** reuse the local `stashCode`
(`:24-32`): that helper is defined inside the `.vue` file and so cannot be imported by
`googleAuth.ts`, which needs the identical write on the native path. Moving the write into
`pickerRedirect.ts` is what lets both handlers share one implementation; `stashCode` stays exactly as
it is for the two auth grants.

**7. `handleNativeAuthRedirect` gains the same arm, and the ladder above it is reordered so that no
arm can act on a grant it has not authenticated.** This is the platform the spike exists for, and the
plan is not complete without it. The current order is: `!stateJson` (`:2928`) → `error` (`:2940`) →
parse (`:2956`) → CSRF (`:2972`) → `!code` (`:2983`) → calendar (`:2997`) → Drive fallthrough
(`:3005`). Three things about that order are load-bearing here:

- the `error` arm calls `clearGoogleSessionState()` **before** anything knows which grant returned,
  so a picker decline answered with `error=access_denied` would sign the joiner out of Google;
- the `!code` arm calls `reportError({severity:'error'})`, which would file a report because a user
  changed their mind;
- the Drive fallthrough calls `completeRedirectAuth()`, which would exchange the `drive.file`-only
  code and commit it over the app's main Drive token.

The new order moves the stash parse and the CSRF check up, then inserts the picker arm:

```
!stateJson  →  parse stored  →  CSRF state check  →  PICKER ARM  →  error  →  !code  →  calendar  →  drive
```

That yields one rule, statable and testable: **nothing branches on the stash before the state check,
and the picker arm is the first thing that does.** It also closes a small hole on the way past: today
any installed app can invoke the custom scheme with `?error=x` during a live auth and force a session
teardown without ever matching the CSRF nonce. After the move it cannot.

One behaviour delta, deliberate: an `error` return that **fails** the CSRF check now reports
`native-oauth-state-mismatch` (severity `'error'`, which does not page, `errorReporter.ts:275`)
instead of silently clearing the session. Genuine declines echo our `state` per OAuth 2.0 and are
unaffected. The only other reachable case is a stash written by a build predating the CSRF nonce,
which cannot outlive its own sessionStorage.

The arm itself mirrors the calendar arm at `:2997-3002` in shape, and is four lines because the
payload lives in the shared module:

```ts
if (stored.grant === 'picker') {
  // ⚠️ NOT `clearGoogleSessionState()`, which the three neighbouring arms call. That is a full
  // Google teardown (tokens + persisted refresh token, :2032-2061), and the picker's whole
  // premise is that the app's existing Drive token survives to read the file. Clear the stash
  // only. Unlike calendar (:2997), nothing downstream needs this stash's PKCE verifier.
  sessionStorage.removeItem(REDIRECT_AUTH_KEY);
  stashPickerSelection(params.get('picked_file_ids')); // logs its own failure; never throws
  onComplete(stored.returnPath);
  return;
}
```

`params` here is `nativeOAuthParams(url)` (`:2911`), which is a verbatim parse of the deep link, so
`picked_file_ids` arrives intact: `nativeBridgeUrl` forwards the whole query string byte-identically
(`nativeOAuth.ts:96-99`).

**8. The native stash's grant omission becomes grant-generic.** `startRedirectAuth`'s native branch
writes `...(grant === 'calendar' ? { grant } : {})` (`googleAuth.ts:2650`). Same literal problem as
`encodeRedirectState`; same fix (`grant !== 'drive'`), same byte-identical-for-Drive property. Note
the native path reads the grant from this local stash rather than from the decoded `state`, which is
why both writers have to change and why the `v: 2` gate is a web-path protection only.

**9. `usePickBeanpodFile` owns both ends, so all three consumers benefit with zero new code.**
The branch goes at the single `return await pickBeanpodFile(token)` (`usePickBeanpodFile.ts:212`),
gated on `isFlagEnabled('systemBrowserPicker')`.

Two placement facts, both deliberate:

- it sits **after** `resolveWithoutPicker` (`:196-208`), so a file the app can already read is still
  read directly and nobody is redirected for nothing;
- it is gated on the **flag alone**, not `flag && shouldUseRedirectAuth()`. The narrower gate would
  make the mechanism unreachable on desktop Chrome, which is where Assumption 1 was verified and the
  only place with usable devtools, and it would make Testing Plan item 13 impossible to run.
  Production safety comes from the committed `false`, and the platform question is answered at
  graduation, not by the spike gate. See **Exit Criteria and Convergence**.

On that branch it emits `PICKER_EVENTS.start`, calls

```ts
startRedirectAuth(returnPath, verifiedEmail, 'join', {
  grant: 'picker',
  scope: DRIVE_FILE_SCOPE,
  extraParams: { trigger_onepick: 'true' },
});
```

with `returnPath` built exactly as the existing redirect exit builds it
(`${window.location.pathname}${window.location.search}`, `:146`), no `prompt` (so the default
`'consent'` plus `access_type=offline` match the verified probe), and returns the **existing**
`{ kind: 'redirecting' }`.

No new result kind is needed and no consumer changes, because all three
(`useJoinFlow.ts:415`, `useDriveFileReselect.ts:43`, `LoadPodView.vue:260`) already `switch` on
`PickBeanpodFileResult` with `assertNever` and already handle `'redirecting'`. That kind exists
precisely because three of four call sites once conflated it with a cancel (`drivePicker.ts:151-163`).
Putting the branch in the join path instead would duplicate it into both recovery banners later and
would bypass the `isPicking` bookkeeping that `useDriveFileReselect.ts:49-58` exists to guarantee.

This is also the file that already owns the _other_ redirect exit (`:144-169`), so both "this page is
going away" paths now sit in one function and read as a pair.

The **return** is consumed in the same composable, at the very top of `pick()`, by the single
`consumePickerRedirectResult()` from `pickerRedirect.ts`:

- absent → `null`, carry on with the normal flow;
- present, `ids` empty → `{ kind: 'cancelled' }` plus an explicit `info` event. **Never a silent
  no-op**; this is the shape of bug the `'redirecting'` kind was introduced to prevent;
- present, `ids` non-empty → `{ kind: 'picked', fileId: firstId, fileName: '' }`. `doPickAndLoad`
  already prefers `expectedFileName.value` (`useJoinFlow.ts:930`), and `OpenFromDrivePage.vue:78`
  shows a placeholder name is an accepted pattern on the load path;
- present but older than `PICKER_RETURN_MAX_AGE_MS` (5 minutes) → discarded with a `warn` event.
  Without this bound, a return that the join flow completes via the direct read (because the grant
  now exists) would leave a live value that a later `pick()` in the same tab consumes as a fresh
  selection;
- unparseable → discarded with a `warn` event naming the key, never a throw into the auth chain.

Single owner, single key, single consumption site, read-and-clear, every branch logged.

**10. What the native iOS cancel does, and why nothing is changed to "fix" it.** The custom-scheme
hop is gated by `hasOAuthResult`, whose `OAUTH_RESULT_PARAMS` is `['code', 'error']`
(`nativeOAuth.ts:40`, `:109-112`), enforced identically by the Astro interstitial
(`web/src/pages/oauth/native.astro:120-150`) and its Vue backstop (`OAuthNativeBridgePage.vue:46-50`).

- **A completed pick carries `code`** (Assumption 4), so it auto-hops into the app and lands on the
  arm in point 7. The path that matters works.
- **A cancel carries neither**, so it does not auto-hop. The interstitial still renders its
  "return to beanies" link with the full query string attached (`native.astro:130-131`), so the
  joiner taps once and lands back in a join flow whose CTA is intact. `Browser.close()` never runs,
  so they dismiss the sheet themselves.

Adding `'picked_file_ids'` to `OAUTH_RESULT_PARAMS` would not fix this, because a cancel has no
`picked_file_ids` either. Anything that would fix it (a `state`-based hop) widens the hop rule for
every OAuth return and, because the Astro page ships from `web/` on a separate deploy, would couple
this spike to a marketing-site release train. Recorded as a known native-arm limitation instead, and
reflected in the acceptance criteria rather than claimed away.

**Two design decisions follow from the scope rule and from assumption (3):**

1. The picker authorization requests **`drive.file` only**, never `DRIVE_SCOPES`.
2. Its returned code is **never** committed over the app's Drive token. The flow takes
   `picked_file_ids` and reads the file with the existing token, because the grant is server-side per
   `(app, account, file)`. Points 4, 5, 6 and 7 above are what make that structural rather than
   aspirational, and the Testing Plan asserts it on all three paths.

`login_hint` is set to the verified email of the current Drive token
(`getEmailVerifiedForToken`, `googleAuth.ts:2443`, the same predicate `resolvePickerAccount` uses at
`drivePicker.ts:229`), so the grant lands on the account the app actually holds a token for; the same
failure class `setAuthUser` was added to fix.

**Flag registration.** `systemBrowserPicker` is added to `FLAG_REGISTRY` (`src/config/flagRegistry.ts`)
with a one-line description **and a one-line exit condition**, and to `COMMITTED_FLAGS`
(`src/config/featureFlags.committed.ts`, which is auto-generated and key-sorted, so it lands between
`podCompaction` and nothing) as `false`. The registry's `podCompaction` entry (`:14-33`) is the
cautionary precedent: a flag with no exit condition accumulates twenty lines of explanation and
outlives the question it was asked to answer.

### Exit Criteria and Convergence

The spike's original unknown is closed (Assumption 1), so this flag exists to answer one remaining,
narrow question: **does the system-browser Picker complete a real join on a real iPhone, on both the
Safari/PWA arm and the native arm, more reliably than the iframe?** It is a comparison device with a
decision attached, not a permanent branch.

**The decision.** After Testing Plan items 14 and 15 have run on greg's iPhone, one of exactly two
things happens. There is no third option, and "leave the flag in and decide later" is the failure
mode this section exists to prevent.

1. **It wins (the expected outcome).** The selection rule moves out of the flag and into a named
   capability predicate, declared once beside `shouldUseRedirectAuth()` in `googleAuth.ts`:

   ```ts
   /** iOS is the only platform where the in-page Picker cannot render: the installed app's
    *  document origin is `capacitor://…` and Safari/PWA partitions the iframe's storage.
    *  Composed from the capabilities seam, never re-detected. */
   export const shouldUseSystemBrowserPicker = (): boolean => isIosOrIpadOs();
   ```

   ⚠️ **Not `shouldUseRedirectAuth()` itself.** That predicate is
   `isNative() || isIosOrIpadOs() || isStandalone()` (`:492-497`), which also covers Android native
   and desktop installed PWAs, where the iframe Picker works today (`capacitor.config.ts:22-25`
   gives Android an `https` origin). Reusing it verbatim would switch two working platforms onto an
   unproven mechanism on the strength of iOS evidence. `isIosOrIpadOs()` is true inside the iOS
   WKWebView as well as in Safari and an iOS PWA, so one predicate covers all three iOS arms and
   nothing else. It composes `capabilities.ts` and introduces no new detection.

   `isFlagEnabled('systemBrowserPicker')` is deleted from `usePickBeanpodFile.ts`, the entry is
   deleted from `flagRegistry.ts` and `featureFlags.committed.ts`, and `pickerRedirect.ts` becomes
   ordinary production code. A predicate is also the only way the mechanism can reach production
   users at all, since the Feature Flags card is tree-shaken out of production builds (see Caveats).
   The iframe Picker stays as the desktop and Android path, unchanged; it is not deleted, because it
   is the better experience where it works.

2. **It loses.** `pickerRedirect.ts` is deleted, the flag entry is deleted, and three call-site arms
   come out: the `usePickBeanpodFile.ts:212` branch, the `OAuthCallbackPage.vue` arm, and the
   `handleNativeAuthRedirect` arm. `RedirectGrant`'s `'picker'` member and the `v: 2` accept-set go
   with them, restoring `redirectState.ts` to a single version. The one thing that does **not** come
   out is the `handleNativeAuthRedirect` reorder from point 7, which is a standalone hardening and is
   justified without the picker. That deletion list is short by design; it is the reason for the
   owning-module structure in point 0.

**What convergence means for the flag's lifetime.** It is expected to live for one round of on-device
testing, not for a release cycle. If it is still in the tree at the next plan that touches
`usePickBeanpodFile.ts`, that plan should resolve it rather than route around it.

### Phase 3 — Recognise a `.beanpod` arriving via the share sheet

> **Independent of Phases 0 to 2.** It shares no code with them and should ship as its own change.
> Split into a pure refactor (3a) and a behaviour change (3b) so a regression in the five-file
> mechanical edit is bisectable from the one-file behaviour edit.

Selecting a `.beanpod` in the Drive iOS app and choosing beanies routes into the AI document reader
and returns _"beanies can read photos, screenshots, PDFs and links."_ (`uiStrings.ts:9965-9968`), a
dead end at the most natural thing a stuck user tries, with a message that actively misinforms.

**The earlier diagnosis was wrong and would have produced dead code.** `iosOpenInAdapter`'s MIME
table is not reachable for a `.beanpod`: `ios/App/App/Info.plist:78-99` declares `CFBundleDocumentTypes`
of only `public.image` and `com.adobe.pdf`, and the comment at `:66-74` in that same file records that
when both a share extension and a document type match, iOS routes to the **extension**. The file
arrives through `iosShareAdapter` (the Share Extension claims files:
`ios/App/ShareExtension/Info.plist:46-51`). Adding a `.beanpod` row to `MIME_BY_EXTENSION` would
change nothing and would leave Android and the PWA share target unfixed.

#### Phase 3a — One home for the `.beanpod` literals, TWO predicates, no behaviour change

`.beanpod` **extension matching** is open-coded in five places, and **they are not all the same
test**. Verified:

| site                                               | what it actually matches                                    |
| -------------------------------------------------- | ----------------------------------------------------------- |
| `src/constants/compaction.ts:19`                   | private `BEANPOD_EXT = '.beanpod'`, used as a rename suffix |
| `src/components/login/JoinPodView.vue:245`         | `accept: ['.beanpod', '.json']`                             |
| `src/components/login/LoadPodView.vue:1077`        | `!endsWith('.beanpod') && !endsWith('.json')`               |
| `src/services/sync/providers/localProvider.ts:301` | `{ 'application/json': ['.beanpod', '.json'] }`             |
| `src/services/sync/syncService.ts:2403`            | `!endsWith('.beanpod') && !endsWith('.json')`               |

**Four of the five accept `.json` as well.** Collapsing them onto a single `isBeanpodFileName` would
silently drop `.json` from the load and drop paths, which is a user-facing regression on exactly the
restore route a stuck family is steered towards. So `src/constants/beanpodFile.ts` (new, ~25 lines)
exports **two** predicates with different jobs, each named for its job:

- `BEANPOD_EXT` and `isBeanpodFileName(name)` — strictly `.beanpod`. Used by the share-sheet arm in
  3b and nowhere else today, so a shared `.json` is not claimed away from the reader.
- `POD_FILE_ACCEPT` (`['.beanpod', '.json']`) and `isPodFileName(name)` — the pair. Replaces the four
  sites above, preserving their current behaviour exactly.

`compaction.ts` imports `BEANPOD_EXT` instead of declaring it privately.

**The other `.beanpod` literals are deliberately left alone.** Roughly ten more exist (default
filenames at `syncStore.ts:2820`/`:5177`/`:5180`, `useJoinFlow.ts:766`, `OpenFromDrivePage.vue:78`,
`demoSeed.ts:46`, `memoryProvider.ts:36`, `localProvider.ts:293`, `connectStorage.ts:252`, the Picker
view queries at `drivePicker.ts:307`/`:314`, and the Drive search at `driveService.ts:392`). None is
an extension test; folding them into `BEANPOD_EXT` would touch ten files, read worse
(`'my-family' + BEANPOD_EXT`) and buy nothing. This phase converts extension tests only.

**One deliberate behaviour widening, stated rather than smuggled.** Today's `endsWith` checks are
case-sensitive. Share-sheet filenames are not under our control, so both predicates lowercase before
comparing. That is a widening in the safe direction (a `.BEANPOD` that is rejected today becomes
accepted), and it gets its own test rather than riding along unnoticed.

3a changes no behaviour beyond that widening and is covered by the existing tests on those four
sites. Land it green before 3b.

#### Phase 3b — The share-sheet arm, in exactly one place

`src/services/share/index.ts:4-6` states the invariant outright: "there is deliberately no
`if (platform === …)` chain anywhere in the app: `useShareTargets` starts every supported adapter and
they all end at the same `ingestSharedDocuments` call." The check therefore sits in
`useSharedDocumentIngest.prepare()` immediately after `stamped` is computed (`:683`) and **before**
the `isAiPickerAcceptedFile` triage at `:684-685`, so it precedes both `shareTarget.unsupported`
toast sites (`:762-770` and `:785-797`) and covers all four adapters at once:

```ts
if (stamped.some((f) => isBeanpodFileName(f.name))) {
  logEvent({
    level: 'info',
    surface: SURFACE,
    message: 'beanpod offered on the share sheet',
    context: { action: 'rejected_type', detail: 'beanpod', os: getPlatform() },
  });
  showToast('info', t('shareTarget.beanpod.title'), t('shareTarget.beanpod.message'));
  return null; // the documented "already told, already logged" sentinel (:671-673)
}
```

`SURFACE` is the module's existing `'share-target-ingest'` (`:64`); do not invent a new surface
literal. The `detail` here is the fixed enum `'beanpod'`, matching the neighbouring `rejected_type`
events, **not** a device label, so this one site spells the context out rather than spreading
`platformContext()`.

Two new copy keys (`en` + `beanie`), and they are the only new strings in this plan. The message
says what is true: this is a family file, not something the reader can read, and the way to open it
is the invite link or "Load a saved family file". **It is not a join route**, for the ADR-033 forking
reason above.

The in-app AI picker's second `isAiPickerAcceptedFile` gate (`useSharedDocumentIngest.ts:1471`) is
deliberately **not** touched: that path is filtered by `AI_PICKER_ACCEPT`, so a `.beanpod` cannot be
chosen there and a second check would be dead code.

### Phase 4 — Revisit the `'critical'` severity on `PICKER_TIMEOUT`

Narrower than it was, because Phase 1 already settles the iframe arm. Severity is not set at the call
site; it comes from the `JOIN_ERRORS` registry (`useJoinFlow.ts:211-400`), where
`PICKER_SCRIPT_LOAD_FAILED`, `PICKER_FAILED` and `PICKER_TIMEOUT` are `'critical'` and the rest are
`'warning'`. After Phase 1 the 8s bootstrap failure reports as `PICKER_IFRAME_BLOCKED` (`'warning'`),
so `PICKER_TIMEOUT` is left meaning only "the iframe loaded and then stalled for 30s", which is rare
and genuinely worth a page.

Once Phase 0 says which platform is failing: if what remains is a structural platform condition
rather than a user-action failure, downgrade it. `reportError` gates Slack strictly on
`severity === 'critical'` (`errorReporter.ts:275`); all severities reach the firehose regardless, so
downgrading loses no diagnostic signal.

## Files Affected

**Phase 0**

- `src/utils/platformLabel.ts` - new `platformContext()` composing the existing `getPlatform()` +
  `getDeviceLabel()`; module-header line recording that these labels are now firehose context, not
  Slack-only. **No new detection logic.**
- `src/services/sync/capabilities.ts` - one stale doc line at `:96` ("a Slack-only telemetry
  vocabulary") corrected. No code change.
- `src/composables/useJoinFlow.ts` - `...platformContext()` in `recordError`'s context block
  (`:541-551`). **This is the edit that satisfies Requirement 1**: every join error code, including
  `PICKER_TIMEOUT`, is reported from here.
- `src/services/google/drivePicker.ts` - one resolved `platformContext()` at the top of
  `pickBeanpodFile`, passed into `resolvePickerAccount` and spread into a new
  `picker_opened` success event.

**Phase 1**

- `src/services/google/drivePicker.ts` - `PICKER_BOOTSTRAP_TIMEOUT_MS`, one re-armed timer
  (`const timeoutHandle` at `:295` becomes a `let`).
- `src/composables/useJoinFlow.ts` - `'failed'` on `AwaitingReason` (`:64-68`); the `'failed'` arm
  (`:899-904`) routed through `enterAwaiting`; `PICKER_IFRAME_BLOCKED` in `JoinErrorCode` +
  `JOIN_ERRORS` (reusing `'join.error.pickerFailed'`); `iframe → PICKER_IFRAME_BLOCKED` in
  `JOIN_CODE_FOR_PICK_REASON` (`:838-846`); the instance-scoped `lastNeedsPick` memo inside
  `useJoinFlow()`, written on every exit of `tryAutoLoadByFileId` (`:759`) and nulled in
  `doPickAndLoad`'s `'picked'` arm (`:848`).
- `src/components/login/JoinPodView.vue` - `AWAITING_COPY` (`:37-42`) gains
  `failed: 'join.pickerPrompt.description'`. **No `uiStrings.ts` change in this phase.**
- `src/services/google/__tests__/drivePicker.test.ts`,
  `src/composables/__tests__/useJoinFlow.test.ts`,
  `src/composables/__tests__/usePickBeanpodFile.test.ts`

**Phase 2**

- `src/services/google/pickerRedirect.ts` (new, ~120 lines) - **the owning leaf module**: the stash
  key, `PICKER_RETURN_MAX_AGE_MS`, the payload type, `stashPickerSelection`,
  `consumePickerRedirectResult`, `PICKER_EVENTS`. Runtime imports: `logEvent` and `platformContext`
  only. `PickBeanpodFileResult` comes in as an `import type` **(a value import from `drivePicker`
  would be a googleAuth cycle: `drivePicker.ts:8`)**.
- `src/config/flagRegistry.ts` - register `systemBrowserPicker`, with its exit condition on the
  entry.
- `src/config/featureFlags.committed.ts` - committed prod state (`false`), key-sorted.
- `src/services/google/redirectState.ts` - `RedirectGrant += 'picker'` (`:45`) with the non-auth doc
  comment; both `=== 'calendar'` literals (`:71`, `:149`) become grant-generic;
  `ACCEPTED_STATE_VERSIONS` + `stateVersionForGrant` replacing the `:129` equality, with the removal
  condition recorded; `decode` returns the **decoded** `v` rather than the hardcoded constant
  (`:150`).
- `src/services/google/googleAuth.ts` - export `DRIVE_FILE_SCOPE` (`:41`); closed-union `extraParams`
  on `buildAuthUrl` (`:2246`) and `RedirectAuthOptions` (`:2544`), threaded at `:2656` and `:2689`;
  a pointer comment at `:77` beside `REDIRECT_AUTH_CODE_KEY_CALENDAR`; the native stash's grant
  omission made grant-generic (`:2650`); **the `handleNativeAuthRedirect` reorder (parse + CSRF above
  the `error` arm) and the four-line picker arm below the CSRF check, which clears only
  `REDIRECT_AUTH_KEY` and never calls `clearGoogleSessionState()`**.
- `src/pages/OAuthCallbackPage.vue` - the six-line picker arm above the code arm (`:61`), calling
  `stashPickerSelection`, returning to `returnPath` (never `/`, never with `?authError`) on every
  outcome including cancel and decline. `stashCode` (`:24-32`) is untouched and still serves the two
  auth grants.
- `src/composables/usePickBeanpodFile.ts` - consume at the top of `pick()`; the flag branch at the
  single `pickBeanpodFile(token)` call (`:212`), gated on the flag alone. **No change to any of the
  three consumers.**
- `src/services/google/__tests__/pickerRedirect.test.ts` (new), plus tests alongside
  `googleAuth.redirectSettle.test.ts`, `googleAuth.native.test.ts`,
  `googleAuth.calendarGrant.native.test.ts` and `src/services/google/redirectState.test.ts`.
- **Not** `src/services/google/drivePicker.ts`; the redirect mechanism does not belong in the iframe
  module (see Phase 2 point 0).
- **Not** `src/constants/nativeOAuth.ts` and **not** `web/src/pages/oauth/native.astro`; see Phase 2
  point 10.

**Phase 3a**

- `src/constants/beanpodFile.ts` (new, ~25 lines) - `BEANPOD_EXT`, `isBeanpodFileName`,
  `POD_FILE_ACCEPT`, `isPodFileName`.
- `src/constants/compaction.ts` - import `BEANPOD_EXT` instead of declaring it privately (`:19`).
- `src/components/login/JoinPodView.vue:245`, `src/components/login/LoadPodView.vue:1077`,
  `src/services/sync/providers/localProvider.ts:301`, `src/services/sync/syncService.ts:2403` -
  converted to `POD_FILE_ACCEPT` / `isPodFileName`, **keeping `.json`**.

**Phase 3b**

- `src/composables/useSharedDocumentIngest.ts` - the `.beanpod` arm in `prepare()` ahead of the
  `isAiPickerAcceptedFile` triage (`:683-685`), using `isBeanpodFileName` (strict) and the existing
  `SURFACE` (`:64`).
- `src/services/translation/uiStrings.ts` - `shareTarget.beanpod.title` / `.message` (`en` +
  `beanie`). The only new copy in this plan.
- **Not** `src/services/share/iosOpenInAdapter.ts`; see Phase 3 for why that is the wrong file.

**Phase 4**

- `src/composables/useJoinFlow.ts` - the `PICKER_TIMEOUT` registry severity (`:275`).

## Observability Coverage

**Events**

- `surface: 'join-flow:<CODE>'` - every join error, including `PICKER_TIMEOUT` and
  `PICKER_IFRAME_BLOCKED`, now carries `os` (`getPlatform()`) and `detail` (`getDeviceLabel()`)
  alongside the existing `error_code` / `file_id_tail` / `invite_token_tail` / `provider_type`.
  **This is the pair that tells (a) from (b)**; the `browser` UA that `enrichAndRedact` already
  attaches (`diagnosticContext.ts:562`) cannot, because the WKWebView UA is a Safari UA.
- `surface: 'drive-picker'` - `picker_opened` (info), plus the existing
  `picker_authuser_unpinned` events, each carrying `os` and `detail`. The success event exists so the
  _rate_ is measurable; without it a failure count has no denominator, which is exactly the gap
  STATUS.md records for the device-link join population.
- The 8s bootstrap failure is separable from the 30s stall by BOTH its `error_code`
  (`picker-iframe` vs `picker-timeout`) and its join code
  (`PICKER_IFRAME_BLOCKED` vs `PICKER_TIMEOUT`).
- `surface: 'system-browser-picker'` (Phase 2) - `start`, `return_web`, `return_native`,
  `return_cancelled`, `return_stale`, `return_unparseable`, `stash_failed`, each with `os` and
  `detail`. Kebab-case and greppable so one CloudWatch filter isolates the mechanism. The surface
  literal and all seven action names live in one `PICKER_EVENTS` `as const` in `pickerRedirect.ts`
  and are imported by every emitter; `logEvent`'s `surface` is a free string (`logEvent.ts:32-33`), so
  nothing else would stop an eighth spelling appearing. The surface is deleted with the module if
  the mechanism loses.
- `surface: 'share-target-ingest'` (Phase 3b) - `action: 'rejected_type'`, `detail: 'beanpod'`, so we
  learn how often people actually try this door.

**Failure modes covered**

- Iframe never bootstraps → the 8s `PICKER_IFRAME_BLOCKED` report with `os` + device label.
- Picker loads then stalls → the existing 30s timeout, now distinguishable from the above.
- Picker redirect never returns → a `start` event with no matching return event.
- Redirect returns but `state` is lost, or is from an older build → the existing
  `oauth.redirectStateLost` critical path. The `v: 2` gate is what routes an old build _there_
  instead of into a silent Drive-token overwrite.
- Redirect returns with no `picked_file_ids` (user cancelled in Google's UI) → an explicit
  `{ kind: 'cancelled' }` and an event, **never a silent no-op**, and the browser returns to
  `returnPath` rather than `/`. This is the specific shape of the bug the `'redirecting'` result kind
  was introduced to prevent (`drivePicker.ts:151-163`): three of four call sites once treated "we
  navigated you to Google" as "you dismissed the chooser" and silently did nothing.
- Redirect returns with `error=` on a picker grant → handled by the picker arm on both transports,
  so it is **not** rendered as a sign-in failure (`?authError=`) and **not** answered with a Google
  session teardown.
- **Native iOS cancel that carries neither `code` nor `error`** → does not auto-hop; the Astro
  interstitial's manual "return to beanies" link is the recovery, and the app's CTA is intact when
  they arrive. Known limitation, Phase 2 point 10.
- Picker return stash write fails → reported, and the user is still returned to `returnPath` with
  their invite URL intact.
- Picker return is stale or unparseable → discarded with a `warn` event naming the key, never a
  throw into the auth chain, never a phantom selection.
- Picker return is never consumed (because the direct read succeeded once the grant existed) →
  expires after `PICKER_RETURN_MAX_AGE_MS` rather than surfacing as a phantom selection on a later
  `pick()` in the same tab.
- Native picker return with no code → handled as a cancel above the `!code` gate, **not** reported as
  an error against the user.
- `.beanpod` on a share sheet (any platform) → recognised-and-explained rather than generically
  rejected.

No bare `catch {}` anywhere; every new branch logs with a documented fallback. Every new console
message is prefixed with its module (`[drivePicker]`, `[pickerRedirect]`, `[OAuthCallback]`,
`[usePickBeanpodFile]`) so a developer reading the console knows which file to open, and every
user-facing string comes from `uiStrings` via `describePickFailure` or the join registry, never from
a raw `message` field (the rule `PICK_FAILURE_COPY` at `drivePicker.ts:401-413` exists to enforce).

**Critical vs telemetry**
Nothing new pages Slack, and Phase 1 actively _prevents_ a new flood by giving the iframe arm its own
`'warning'` code rather than inheriting `PICKER_FAILED`'s `'critical'`. Phase 4 may additionally
downgrade `PICKER_TIMEOUT`. All severities reach the firehose regardless, so this costs no diagnostic
signal.

**Privacy / store gate**
**No new context key ships.** `os` and `detail` are already allowlisted in
`src/utils/diagnosticContext.ts:111` / `:199` and already mirrored in
`infrastructure/lambda/telemetry/index.mjs:106` / `:145` (re-verified 2026-09-18), so no allowlist
edit, no Lambda mirror change, and no update to `docs/runbooks/native-store-submission.md`,
`PrivacyInfo.xcprivacy` or `privacy.astro` is required. `getDeviceLabel()` returns a fixed vocabulary
of app/browser/OS tokens (`platformLabel.ts:45-96`) and is already used in operational reports today;
it is strictly _less_ identifying than the raw `browser` user agent that already ships on every
event. No URL and no user data leaves the device.

## Acceptance Criteria

- [ ] A `PICKER_TIMEOUT` (or `PICKER_IFRAME_BLOCKED`) event in CloudWatch carries `os` and a device
      label that identifies the platform, and therefore the document origin, so candidates (a) and
      (b) are distinguishable without guessing.
- [ ] That pair ships from **one** place per surface, not re-derived per call site, and every other
      join error code gains it for free.
- [ ] A picker that cannot bootstrap fails in under ~10s, not 30-60s, and reports with a distinct
      error code **and** a distinct join code from the 30s stall.
- [ ] The 8s fast-fail does **not** page `#beanies-errors`; `open` failures still do.
- [ ] A failed pick leaves the "Choose your data file" CTA on screen, with the error banner above it
      and no duplicated message.
- [ ] One user tap causes at most one `tryAutoLoadByFileId` round trip per `(fileId, token)` pair,
      and a token swapped by `tryReconnectSilently` still gets a real retry.
- [ ] The read memo is scoped to one `useJoinFlow()` instance, not the module, and survives no
      longer than the flow.
- [ ] `systemBrowserPicker` appears in Settings → Feature Flags on a dev build and switches
      `usePickBeanpodFile` between the two mechanisms without a rebuild, for **all three** consumers,
      **including on desktop Chrome**.
- [ ] A picker redirect can never commit a `drive.file`-only token over the app's Drive token, on the
      web return path, the native deep-link path, or an older build decoding the state.
- [ ] **No picker return, on any transport or any outcome (pick, cancel, `error=`), calls
      `clearGoogleSessionState()`**, and the app's Drive token still resolves an email afterwards.
- [ ] Nothing in `handleNativeAuthRedirect` branches on the stash's `grant` before the CSRF `state`
      check passes.
- [ ] A picker cancel on the **web** path returns the user to their invite URL with an explicit
      cancelled outcome, never to `/`, never with `?authError`, and never to silence. On the
      **native** path it is documented that no auto-hop occurs and the interstitial's manual link is
      the recovery.
- [ ] The picker return is consumed at exactly one site, expires after 5 minutes, and the one extra
      tap it costs the joiner is documented and observed on the device run.
- [ ] The whole system-browser mechanism is deletable as one module plus three named call-site arms;
      the list in **Exit Criteria and Convergence** matches the code as built.
- [ ] `buildAuthUrl`'s extra parameters cannot overwrite `scope`, `redirect_uri`, `client_id` or
      `response_type` (compile-time, via the closed key union).
- [ ] A joiner on a **real iPhone** completes a join end to end on their own device with the flag on
      (Safari/PWA arm at minimum; the native arm is gated on a TestFlight build, see Caveats).
- [ ] A `.beanpod` arriving via a share sheet gets a true message instead of "beanies can read
      photos, screenshots, PDFs and links.", on iOS **and** Android **and** the PWA.
- [ ] No sixth open-coded `.beanpod` **extension test** is added; the four existing ones are converted
      **and still accept `.json`**. The non-matching literals (default filenames, Drive queries) are
      untouched.
- [ ] No OAuth scope change, no new server component, no `.beanpod` format change.
- [ ] Diagnostic logging in **Observability Coverage** implemented and verified; confirmed that no
      new context key was needed.

## Testing Plan

1. `npm run validate` green (type-check, lint, format, ~8200 unit tests, build). Capture to a file on
   the first run and grep that file thereafter.
2. Unit: the bootstrap probe settles `reason: 'iframe'` when no `'loaded'` callback arrives, does
   **not** fire when one does, and in that case the total budget is still 30s (assert the re-arm,
   not just the first fire), and `settle` clears the re-armed handle (no stray fire after resolve).
3. Unit: `iframe` maps to `PICKER_IFRAME_BLOCKED` at `'warning'`, and `open` still maps to
   `PICKER_FAILED` at `'critical'`. This is the test that stops a later tidy-up re-merging them.
4. Unit: a failed pick leaves the join step in a state that renders the CTA (assert
   `currentStep`/`awaitingReason`, not the DOM). **This is a genuine coverage gap today**: the
   `'Picker discriminated-union → JoinErrorCode mapping'` suite (`useJoinFlow.test.ts:612`) asserts
   `currentError.code` for every `PickFailureReason` but never asserts `currentStep`, and the only
   step assertion after a non-picked result covers `'cancelled'`, which already calls `enterAwaiting`.
5. Unit: a second probe with the same `(fileId, token)` issues no Drive request; a probe after
   `tryReconnectSilently` swapped the token does issue one; the memo is cleared after a successful
   pick; and **two separate `useJoinFlow()` instances do not share a memo** (the module-scope
   regression). No test asserts any of this today.
6. Unit: `recordError` attaches `os` and `detail` to a `PICKER_TIMEOUT` report, and the pair comes
   from `platformContext()` (mock it and assert both keys land on the redacted context, so the
   allowlist is exercised end to end).
7. Unit: `encodeRedirectState`/`decodeRedirectState` round-trip `grant: 'picker'` at `v: 2` **and the
   decoded payload reports `v: 2`, not `v: 1`**; a Drive state is still byte-identical at `v: 1`; a
   calendar state is unchanged at `v: 1`; an unknown grant still defaults to `'drive'`; and a `v: 2`
   payload decoded by a `{1}`-only accept-set returns `null` (the forward-compat contract that
   protects an old build).
8. Unit: the picker auth URL carries `trigger_onepick=true`, `access_type=offline`, `prompt=consent`
   and a scope of **exactly** `drive.file`, asserting the "cannot be combined" rule so a future scope
   addition fails the test rather than the flow.
9. Unit (**invariants 1, 2 and 4, native half**), sitting beside `googleAuth.calendarGrant.native.test.ts`,
   which already establishes this shape:
   - `grant: 'picker'` with a code stashes the selection, removes `REDIRECT_AUTH_KEY` and calls
     `onComplete(returnPath)` **without** `completeRedirectAuth`, **without** writing
     `REDIRECT_AUTH_CODE_KEY`, and **without** `clearGoogleSessionState`;
   - `grant: 'picker'` with no code resolves as a cancel **without** `reportError`;
   - `grant: 'picker'` with `error=access_denied` resolves **without** `clearGoogleSessionState`;
   - a `state` mismatch is still rejected **before** the picker arm is reached, and now also before
     the `error` arm (the reorder's one behaviour delta, pinned deliberately);
   - the drive and calendar arms are unchanged for code, error and no-code inputs (the regression
     guard on the reorder).
10. Unit (**invariant 1, web half**): `OAuthCallbackPage` with `grant: 'picker'` and a `code` present
    does **not** write `REDIRECT_AUTH_CODE_KEY`; with no `code` it navigates to `returnPath`, never
    `/`; with `error=access_denied` it navigates to `returnPath` **without** appending `authError`;
    with a failed stash it reports and still navigates to `returnPath`.
11. Unit: `consumePickerRedirectResult` returns `cancelled` for empty ids, `picked` for a non-empty
    id, `null` (with a `warn` event) for a stale or unparseable stash, and clears the key in every
    case, including when it returns `null`.
12. Unit: `stashPickerSelection` writes one payload shape, returns `false` rather than throwing when
    storage throws, and is the only writer of the key (both return handlers call it; neither builds
    the payload itself).
13. Unit: `isBeanpodFileName` matches only `.beanpod`; `isPodFileName` / `POD_FILE_ACCEPT` still
    accept `.json` at all four converted sites (the regression this split exists to prevent); both
    are case-insensitive; and the `prepare()` arm fires, including that a `.beanpod` shared alongside
    a caption still takes the `.beanpod` message and not the link path.
14. Browser (desktop Chrome, light + dark, ~400px and desktop widths): the join flow with the flag off
    is unchanged; with the flag **on** it redirects to Google, renders the Picker (Assumption 1
    observed this on desktop Chrome), and returns to the invite URL. Cancel from Google's UI and
    confirm the cancelled outcome and the surviving CTA.
15. **Real iPhone, Safari/PWA** via `npm run dev -- --host`: toggle the flag in Settings → Feature
    Flags and compare both mechanisms on the same device. Record the extra tap on the return leg.
    This is the only arm emulation cannot cover.
16. **Real iPhone, native** - requires a TestFlight build with the flag committed on (the card is
    tree-shaken; the localStorage override needs Safari Web Inspector on a Mac). Owed to greg; not
    claimable from this session. Verify specifically that (a) the app's Drive token still resolves an
    email after a picker return, which is the observable proof the scope was not overwritten and the
    session was not torn down; (b) the PKCE `code_challenge` on the native picker URL does not upset
    Google's onepick endpoint; and (c) a cancel behaves as Phase 2 point 10 describes (no auto-hop,
    manual link works).
17. Share a `.beanpod` from the Drive iOS app into beanies and confirm the message is true. Repeat
    from Android (Files → share) to confirm the fix is platform-independent.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted from the tracker #98 pre-plan plus first-hand reads of
  `drivePicker.ts`, `capacitor.config.ts`, `redirectState.ts`, `flags.ts` and Google's picker spec,
  and three parallel codebase maps (redirect machinery, join-flow failure arm, share intake +
  telemetry allowlist).
- **Pass 2 (DRY + error handling)**: Complete. Corrected two wrong causal claims (the 30s timer is
  armed _above_ the build block, not below it; a `.beanpod` cannot reach `iosOpenInAdapter` because
  `Info.plist` declares only `public.image`/`com.adobe.pdf` and the Share Extension claims files
  first). Found three paths that would silently commit a `drive.file`-only token over the app's Drive
  token (the native `appUrlOpen` handler, which the plan never mentioned and which _is_ candidate
  (a); the `=== 'calendar'` literals in `encodeRedirectState` and the native stash; and an older
  build decoding a `v: 1` picker state) and closed all three. Found that a picker cancel would have
  dead-ended at `window.location.href = '/'`, discarding the invite URL. Found that the Phase 1
  fast-fail would have _increased_ Slack pages via `PICKER_FAILED`'s `'critical'`, and moved that
  decision into Phase 1. Replaced a proposed hand-rolled platform detector with the existing,
  tested `getDeviceLabel()`; replaced new awaiting-reason copy with the existing
  `'join.pickerPrompt.description'` that `initial` and `needs-pick` already share; moved the
  redundant-read fix into `tryAutoLoadByFileId` where it needs no plumbing and covers three reads
  instead of two; moved the flag branch into `usePickBeanpodFile` so all three consumers are served
  by one edit; added one optional `extraParams` to `buildAuthUrl` rather than three positional
  parameters; exported `DRIVE_FILE_SCOPE` rather than retyping it; and consolidated the five
  open-coded `.beanpod` literals behind one predicate.
- **Pass 3 (Sustainability)**: Complete, re-framed for the fact that Assumption 1 is now verified and
  this mechanism is likely permanent. Found one correctness regression: four of the five "open-coded
  `.beanpod`" sites actually match `.beanpod` **or `.json`**, so the single-predicate consolidation
  would have silently dropped `.json` from the load, drop and reselect paths; split into
  `isBeanpodFileName` (strict) and `isPodFileName` / `POD_FILE_ACCEPT`, and made the
  case-insensitivity widening explicit. Gave the system-browser mechanism a single owning **leaf**
  module (`pickerRedirect.ts`), after tracing that the obvious placement would have created a
  `googleAuth` import cycle, and collapsed the two hand-written return-handler arms onto one shared
  `stashPickerSelection` (the same duplication class Pass 2 had to fix twice for `=== 'calendar'`).
  Narrowed `extraParams` from an open `Record<string, string>` to a closed key union, since it is
  applied after the core OAuth parameters and could otherwise overwrite `scope` or `redirect_uri`.
  Kept the `v: 2` gate but named it a capability gate rather than a schema version, expressed it as
  two constants plus one pure function, and recorded its removal condition. Bounded the Phase 1 memo
  to one entry, one writer rule and instance scope (verified `tryAutoLoadByFileId` closes over
  `targetFileId`, so module scope would leak across flows and tests), with a fail-open rule. Turned
  Assumptions 3 and 4 into a gate and deleted the side-token fallback, which would have added a
  second Drive token lifecycle to the app's most incident-prone module. Added **Exit Criteria and
  Convergence**, a **complexity budget** naming the load-bearing invariants with a test each, split
  Phase 3 into a pure refactor and a behaviour change, documented the one extra tap the return leg
  costs, and pinned the new telemetry surface and action names to one `as const`.
- **Pass 4 (Fresh-eyes sweep)**: Complete. Six findings that would have shipped as bugs, each traced
  to a line rather than reasoned about:
  1. **Phase 0 edited a file that emits no failure events.** `drivePicker.ts` has exactly two
     `logEvent` calls, both in `resolvePickerAccount` (`:234`, `:243`); every `PICKER_TIMEOUT` in
     CloudWatch comes from `recordError` (`useJoinFlow.ts:520-553`). Phase 0's primary edit moved
     there, which also fixes every other join code at once.
  2. **The "telemetry is blind" premise was overstated.** `enrichAndRedact` already ships the full
     user agent as `browser` (`diagnosticContext.ts:562`). Re-stated the real gap: no
     `appendUserAgent` in `capacitor.config.ts`, so the WKWebView UA _is_ a Safari UA, and a PWA's
     is a tab's. `os` is allowlisted with no writer, so it is genuinely new.
  3. **The native picker arm would have destroyed the token the mechanism depends on.** Three of the
     four arms in `handleNativeAuthRedirect` call `clearGoogleSessionState()` (`:2941`, `:2975`,
     `:2986`), a full token teardown. Worse, the `error` arm sits _above_ the CSRF check, so a
     picker decline answered with `error=access_denied` would sign the joiner out. Reordered the
     ladder (parse + CSRF above `error`), added the picker arm below the CSRF check, and made
     "never `clearGoogleSessionState`" a fourth named invariant with its own tests. The reorder also
     closes a small hole: an unauthenticated deep link could previously force a session teardown.
  4. **The native iOS cancel never returns to the app.** `hasOAuthResult` hops only on `code` or
     `error` (`nativeOAuth.ts:40`, `:109-112`). Successful picks carry `code` and are fine; cancels
     land on the interstitial's manual link. Documented as a limitation and explicitly _not_ fixed,
     because widening `OAUTH_RESULT_PARAMS` would not help a cancel and would couple the spike to a
     marketing-site deploy.
  5. **Two cycles-and-correctness details in Phase 2.** `pickerRedirect.ts` must `import type` the
     result union, because `drivePicker.ts:8` imports `googleAuth` at runtime; and
     `decodeRedirectState` returns a hardcoded `v` (`:150`) that would lie about v2 payloads under
     the accept-set.
  6. **The flag gate and the graduation predicate were both wrong at the edges.**
     `flag && shouldUseRedirectAuth()` made the plan's own desktop test impossible and cut off the
     one platform with devtools, so the spike gates on the flag alone; and graduating to
     `shouldUseRedirectAuth()` verbatim would have switched Android native and desktop PWAs, where
     the iframe Picker works, onto an iOS-only piece of evidence, so graduation is to a named
     `shouldUseSystemBrowserPicker()` built from `isIosOrIpadOs()`.

  Also corrected: the claim that the flag cannot be toggled in production (the _card_ is
  tree-shaken; `flags.ts:5-12` and `flagRegistry.ts:27-28` document a localStorage override that
  beats the prod gate, which needs a console on a TestFlight build); the Phase 3b surface literal
  (`'share-target-ingest'`, `useSharedDocumentIngest.ts:64`); a missing scope fence on Phase 3a
  (about ten further `.beanpod` literals exist that are not extension tests); and a set of line
  anchors. Added a DRY `platformContext()` because Pass 4's changes leave three emitters of the same
  pair rather than one, recorded that `startRedirectAuth`'s existing defaults are exactly the
  verified probe's parameters, and flagged the native PKCE `code_challenge` as an unverified
  deviation to watch on the TestFlight run rather than a conditional to write.

---

## Files an implementer should open first (absolute paths)

- `/home/greg/projects/beanies-family/src/services/google/googleAuth.ts` (`DRIVE_FILE_SCOPE` :41, `REDIRECT_AUTH_CODE_KEY_CALENDAR` :77, `shouldUseRedirectAuth` :492, `clearGoogleSessionState` :2032, `buildAuthUrl` :2246, `REDIRECT_AUTH_KEY` :2496, `clearRedirectIntent` :2511, `RedirectAuthOptions` :2544, `startRedirectAuth` :2597, native stash grant omission :2650, `completeRedirectAuth` :2705, `handleNativeAuthRedirect` :2897, error arm :2940, parse :2956, CSRF check :2972, `if (!code)` :2983, calendar arm :2997, Drive fallthrough :3005)
- `/home/greg/projects/beanies-family/src/services/google/redirectState.ts` (forward-compat note :20-25, `RedirectGrant` :45, `REDIRECT_STATE_VERSION` :47, encode :60-74, calendar literal :71, decode :120-153, version gate :129, grant ternary :149, hardcoded `v` :150)
- `/home/greg/projects/beanies-family/src/composables/useJoinFlow.ts` (`AwaitingReason` :64, registry :211-400, `PICKER_FAILED` :244, `PICKER_TIMEOUT` :275, `enterAwaiting` :443, `recordError` :520-553, `tryAutoLoadByFileId` :759, `JOIN_CODE_FOR_PICK_REASON` :838, `doPickAndLoad` :848, failed arm :899, `runCloudFlow` :1130, the single `tryAutoLoadByFileId()` call :1134)
- `/home/greg/projects/beanies-family/src/composables/usePickBeanpodFile.ts` (existing redirect exit :144-169, `resolveWithoutPicker` hook :196-208, the single branch point :212)
- `/home/greg/projects/beanies-family/src/services/google/drivePicker.ts` (result contract :137-167, `PICKER_TIMEOUT_MS` :170, `resolvePickerAccount` :207-252, `hasLoaded` :281/:345, `settle` :286, timer :295, `setOrigin` :325, `PICK_FAILURE_COPY` :401-413)
- `/home/greg/projects/beanies-family/src/pages/OAuthCallbackPage.vue` (`stashCode` :24-32, ladder :61, lost-state report :102-113, error arm :117-158, terminal `/` :159)
- `/home/greg/projects/beanies-family/src/constants/nativeOAuth.ts` (`OAUTH_RESULT_PARAMS` :40, `nativeOAuthParams` :79, `nativeBridgeUrl` :96, `hasOAuthResult` :109) and `/home/greg/projects/beanies-family/web/src/pages/oauth/native.astro` (:120-150)

---

## Outcome (2026-09-18, shipped in 0.21.3)

**Assumption 3 is VERIFIED and the gate is cleared.** greg ran the full join end to end in Firefox on
his own machine: consent opened pre-filled on his account, the picker showed exactly one file, and
selecting it returned to beanies, decrypted the pod and listed the family members. That last step is
the observation the gate wanted, because it means the app's existing `DRIVE_SCOPES` token read a file
it only had access to via the picker grant. The side-token fallback the gate exists to prevent stays
unbuilt. Firefox matters more than Chrome here: the iframe Picker was failing there with the same
symptoms as iOS Safari.

**Three defects surfaced by that real run, all fixed:**

1. **No account pre-selection.** `login_hint` was fed only `getEmailVerifiedForToken`, which on a join
   is usually not resolved, so it passed `undefined` and the joiner had to find their own address in
   a list. It now falls back to the invite's own hint, which is what the CLAUDE.md cloud-auth rule
   asks for.
2. **No file filter.** The picker opened on the joiner's whole Drive. It now passes Google's
   documented `file_ids` filter, using the id that rides the invite link as `fid=`. The recovery
   banners stay unfiltered, because there the user genuinely is choosing.
3. **The joiner was bounced back to the start** — the web leg had no Drive token after the round
   trip. Root cause was NOT the picker: a joiner's refresh token is persisted under
   `PENDING_FAMILY_KEY`, and the only reader of that key was `migratePendingRefreshToken`, which
   runs from `initializeAuth(familyId)` and therefore never during a join. `performSilentRefresh`
   now falls back to that slot. This is a lookup, not a new token lifecycle: no access token at rest,
   no second credential. It is invisible on the auth redirect (which mints a fresh token on arrival)
   and fatal only on the picker redirect, whose code is deliberately never exchanged.

**The flag shipped `true`, deliberately, which this plan originally said it would not.** greg's call,
on the basis that the mechanism works on both browsers he could test and that the chooser it replaces
"hardly worked at all". The plan's own "production safety comes from the committed `false`" reasoning
is therefore superseded; the comments at the flag gate and on the registry entry were corrected so
they do not tell a future reader something untrue. Reverting `featureFlags.committed.ts` plus a deploy
is the kill switch; there is no runtime toggle in a production build.

**Still unverified, carried forward:** the native iOS arm. Nothing in this change has run in the
installed app — specifically the PKCE `code_challenge` the native picker URL sends (the verified probe
sent none), the cancel that does not auto-hop back, and the `handleNativeAuthRedirect` reorder.

**Watch items, recorded rather than fixed:** the shared picker stash is keyed by mechanism, not by
surface, bounded by a 5-minute expiry; the 8s bootstrap probe now takes a DOM signal as well as the
undocumented `'loaded'` callback, so a Google-side rename degrades to the old behaviour instead of
killing a working picker; and `performSilentRefresh`'s pending-slot fallback is the one place the
"adopt only what Google accepted" discipline is extended rather than introduced (see the comment at
that code).

**Review:** three rounds. Two adversarial passes (21 findings, 13 fixed) plus the five-lens
`/code-review` method — CLAUDE.md adherence, shallow bugs, git history, prior related work, and code
comments as binding guidance. The last of those was the most valuable at the end: it caught that
shipping the flag `true` had made three separate comments and this plan lie about the shipped state.
