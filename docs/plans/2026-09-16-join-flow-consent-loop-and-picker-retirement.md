# Plan: the join flow's silent consent loop, the Picker's four necessary homes, and the recovery kit PDF

> Date: 2026-09-16
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-09-16-join-flow-consent-loop-and-picker-retirement.md`

## User Story

As someone invited to join a family pod, I want tapping the invite link to actually get me into the
pod — and if something goes wrong, to be told what — so that I am not bounced between Google's
consent screen and a "we found your pod" card forever with no explanation.

## Context

An early adopter's husband could not join. His account: invite link → "we found your family pod"
→ Google consent → accepted → **straight back to "we found your family pod"**, with the only
control being the button that starts Google consent again. No error, no explanation, no way
forward. He never got in.

Separately, greg reproduced a _different_ failure locally — the Google Picker rendering
`There was an error! The API developer key is invalid.` — and proposed applying the fix used a
week earlier (`02c2e347`, which replaced the Picker in Settings→restore with our own
`GoogleDriveFilePicker`).

Investigation established that these are **two unrelated faults with one shared symptom** (the
joiner cannot get in), plus a third unrelated bug in the recovery kit.

## Production telemetry corroborating the iOS-only diagnosis

Two `join-flow:OAUTH_REDIRECT_FAILED` events in the firehose, 21-day window. BOTH iPhone:

| when       | build                   | browser                | notes                                                                            |
| ---------- | ----------------------- | ---------------------- | -------------------------------------------------------------------------------- |
| 2026-09-07 | c3a6be98                | Safari, iOS 18.7       | `severity: critical`, carries `invite_token_tail`                                |
| 2026-09-16 | 92ec4937 (current prod) | Chrome-iOS, iOS 26.6.2 | `severity: critical`, `provider_type: google_drive`, carries `invite_token_tail` |

Both are real join attempts that failed. Zero equivalents from desktop.

Significance:

- iOS is exactly the redirect-auth platform (`googleAuth.ts:471-481`) where the consent loop closes.
- The telemetry and the static analysis agree independently.
- The bug is PLATFORM-SPECIFIC, which is why desktop testing never caught it, and why any
  verification that runs only on desktop will not prove the fix.
- `OAUTH_REDIRECT_FAILED` is the ONE join failure that does emit. The loop's own transitions emit
  nothing, which is why the user had to report it. That is what the Observability Coverage
  section exists to close.

### Fault 1 — the silent consent loop (THE production bug; entirely our own code)

`useJoinFlow.ts:803-808`:

```js
if (!triggeredByGesture) {
  currentStep.value = 'awaiting-auth';
  return;
}
```

Every `init()` is non-gesture, and **every redirect return runs `init()`**. So on redirect-auth
platforms (iOS, iPadOS, standalone PWA, native — `googleAuth.ts:471-481`) the sequence is:

1. Consent returns → `init()` → `runCloudFlow(false)` → `tryAutoLoadByFileId`
2. The joiner's fresh `drive.file` grant has **no access to the inviter's file** → 404/403 →
   `'needs-pick'` (`useJoinFlow.ts:585`)
3. Not gesture-triggered → `currentStep = 'awaiting-auth'`, **no error recorded** → the found-pod
   card again
4. The user taps the only CTA → `runCloudFlow(true)` → `tryAutoLoadByFileId` → still 404 →
   `'needs-pick'` → `forceConsent = true` (`:817`)
5. `forceConsent` **skips the silent-token fast path** (`usePickBeanpodFile.ts:76-82`), so
   `token` is null → `shouldUseRedirectAuth()` is true → `startRedirectAuth(...)` → the page
   navigates away → the call returns `{ kind: 'cancelled' }` (`:85-91`)
6. `doPickAndLoad` sees `'cancelled'` → silent return to `awaiting-auth` (`:634-637`)
7. → back to step 1

**The Picker is never reached on these platforms.** The loop is closed, emits nothing, and pages
nobody.

**The category error.** `forceConsent` exists for _recovery_ surfaces, where `needs-pick` means
"the cached account is probably the wrong one, make them choose again". On a **first-time join**,
`needs-pick` is the _expected_ state: the joiner has never picked the file, so of course
`drive.file` cannot reach it. Re-running consent cannot fix that — only the Picker can. The flow
diagnoses "wrong account" and prescribes consent, when the truth is "no file grant yet" and the
prescription is the Picker.

### Fault 2 — greg's local Picker error is a missing env var, not a product bug

```
VITE_GOOGLE_API_KEY:        ABSENT from .env.local
VITE_GOOGLE_PROJECT_NUMBER: ABSENT from .env.local
VITE_GOOGLE_CLIENT_ID:      present
```

An undefined `developerKey` is exactly what makes Google render the invalid-key dialog. Production
injects it (`deploy.yml:145-146`). greg's desktop repro is a local-config artefact and is **not**
what the husband hit.

**However, the refuse-before-opening guard this plan was going to add ALREADY EXISTS.**
`drivePicker.ts:244-252` checks `VITE_GOOGLE_API_KEY` _before_ touching gapi, `console.error`s
naming the variable, and returns `{ kind: 'failed', reason: 'config' }`. `disposePicker` (`:32-48`)
already closes Google's uncloseable dialog on every exit path. `.env.example:15-16` already lists
both variables. greg's repro predates the guard or ran an older bundle.

The one _remaining_ gap is downstream: `useJoinFlow.doPickAndLoad` maps `reason: 'config'` to
`PICKER_SCRIPT_LOAD_FAILED`, whose copy is _"Check your internet connection and try again"_ — the
wrong sentence for a build-configuration fault. The same nested ternary also collapses
`reason: 'auth'` into `PICKER_FAILED`, blaming the Picker for an auth failure.

### The constraint that shapes everything: the Picker cannot leave ANY of its four homes

`drivePicker.ts:1-6`, in its own words:

> Selecting a file via Picker grants the app `drive.file` access to that file, which is required
> when the file was shared by another user (not created by the app).

The app requests `drive.file` (`googleAuth.ts:42`) — a **per-file** scope. The Picker selection
_is_ the access grant, not a UI nicety we can emulate. `syncStore.listGoogleDriveFiles` →
`driveService.searchBeanpodFilesGlobal` (`:392`) is a plain `files.list`, which under `drive.file`
returns **only files the app already holds a grant for**.

⚠️ **This reverses greg's approved "retire the other three" decision, on evidence found in Pass 2.**
Checking each site against the condition under which it is _reached_:

| Site                       | Reached when                                                                                                                                                      | Would `files.list` see it?             |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `LoadPodView.vue:706`      | web-without-FSA arm; its own doc-comment (`:698-702`) says it grants access to a file **"that the app didn't create"** (restored backup / different account)      | **No** — by definition                 |
| `PodAccessBanner.vue:51`   | recovery for `FILE_NOT_FOUND` / `PERMISSION_DENIED` / `CANONICAL_MISMATCH` / `NO_HOME`; in the mismatch arm it is the fallback _after_ `rebindTo()` already 404'd | **No** — the 404 _is_ the absent grant |
| `SaveFailureBanner.vue:36` | rendered only under `fileNotFound`                                                                                                                                | **No** — same                          |

All three are precisely the "we have no grant" case. Migrating them would render an **empty modal
exactly when the recovery matters**. `02c2e347` could drop the Picker from Settings→restore because
those are the user's own, app-created files, which `files.list` does see — a categorically
different question.

**Revised decision: the Picker stays at all four call sites. What changes is that none of them may
fail silently, and the one genuinely dead entry point (`pickBeanpodFolder`, zero callers) goes.**

### Fault 3 — the recovery kit PDF (unrelated, blocks family creation)

`RecoveryKitDisplay.vue:88` calls `exportElementToPng(kitCardEl.value)` with no options, unlike
`MealPlannerPage.vue:295` which passes `fonts: EXPORT_FONTS`.

⚠️ **But `fonts` is NOT the lever — the first draft's fix was a no-op.** Verified by reading
`useSheetExport.exportElementToPng`: `opts.fonts` only feeds `document.fonts.load()` and
`document.fonts.ready` before capture — an anti-FOUT measure. It is **never passed to
`html-to-image`**. The meal-planner export pays the identical cost; it just survives it on Chromium.

The actual storm is in `html-to-image@1.11.13`'s `embed-webfonts.js`: `getCSSRules` iterates
`document.styleSheets`, hits a `SecurityError` reading `cssRules` on the cross-origin Google Fonts
`<link>` (`index.html:101`), and falls into a catch that refetches the stylesheet and inlines
**every** `@font-face` — Outfit ×6, Inter ×3, Caveat ×3, each across ~7 unicode-range subsets — as
base64 into one `foreignObject` SVG data URL. Multiple megabytes and dozens of fetches per click,
on every export in the app.

The real levers are `html-to-image`'s own options, none of which we pass: `fontEmbedCSS` (supply it
once, precomputed), `preferredFontFormat`, `skipFonts`.

Compounding it: `prewarmSheetExport()` is called only from `MealPlannerPage.vue:87`, so the kit path
always pays a cold dynamic-import — worst during family creation.

And the failure is fatal where it need not be: `ExportError('rasterize')` aborts the whole export,
so a font problem costs the user their recovery kit entirely. **A kit in fallback fonts is a working
kit.**

## Requirements

1. **The join flow must never return to `awaiting-auth` without telling the user something.**
2. **`needs-pick` on a join must open the Picker, not re-run consent.**
3. **A redirect-in-progress must be distinguishable from a user cancel**, at _every_ one of the four
   `usePickBeanpodFile` call sites. Three currently swallow both with a bare `return`.
4. **After a redirect return, the CTA must complete the journey.** One tap, one Picker.
5. ~~Tell the joiner which file to pick.~~ **ALREADY IMPLEMENTED** — `useJoinFlow.expectedFileName`
   (`:333-336`) + `JoinPodView.vue:405-414` already render it. Listed so a test locks it in.
6. **Delete the dead `pickBeanpodFolder`** (zero callers). **Keep the Picker at its four live
   sites** — see the table in Context. (Reverses the original requirement 6.)
7. **Every Picker failure reason must map through a compile-enforced table to copy that is true of
   it.** No nested ternary; no `config` rendered as "check your internet"; no `auth` as "the Picker
   couldn't open".
8. **`mobile-ios-build.yml` / `mobile-android-build.yml` must pass `VITE_GOOGLE_API_KEY` +
   `VITE_GOOGLE_PROJECT_NUMBER`.** (The dev-legibility guard is already implemented — see Fault 2.)
9. **The recovery kit PDF must survive a font-embedding failure** rather than aborting, and must not
   pay the cross-origin inlining storm on every export.
10. **`OAUTH_SCOPE_DENIED` / `OAUTH_POPUP_BLOCKED` are recorded**, not merely declared.
11. **No new abstraction that does not delete more than it adds.**

## Important Notes & Caveats

- **`drive.file` is non-negotiable.** Do not "simplify" any of the four sites onto
  `listGoogleDriveFiles` — see the Context table for why each would break.
- **Do not create `useDriveBeanpodPicker`.** The three existing custom-picker sites differ in token
  strategy, error routing and empty-state handling; their one shared kernel
  (`listGoogleDriveFiles` + `classifyDriveFailure`) is _already_ extracted and already used by all
  three. A composable over them is an options bag with three arms — net-new code.
- **The real duplication is `PodAccessBanner.pickFamilyFile` ≈ `SaveFailureBanner.handleReselectFile`**
  — same three steps, and both open with `if (result.kind !== 'picked') return;`, so a cancel, a
  redirect and a hard failure are indistinguishable no-ops on a critical banner. That is the
  extraction worth doing.
- **`forceConsent` keeps its legitimate home** on `handleSignInDifferent`. Do not rename it to an
  `intent` union — that touches four call sites plus mocks and changes no behaviour. **The fix is
  deleting one line.**
- **`'redirecting'` is not new vocabulary** — `ReconnectOutcome` in `useGoogleReconnect.ts` already
  defines it and warns that on native the WebView does _not_ unload, so "the page is leaving" is not
  a guard. Reuse that word and its reasoning.
- **Popup platforms are not broken the same way** — desktop gets a token and the Picker opens. The
  fix must not regress that.
- **The joiner never gets their own `.beanpod`** (ADR-033). They work from the inviter's shared file,
  under _Shared with me_. Expected behaviour; must not be "fixed".
- **Do not put a throwaway Playwright script in `e2e/specs/`** — no `testIgnore`, so it joins CI and
  counts against the ADR-007 budget. Use `scripts/design-screenshots/`.
- **The three dead `join.pickerPrompt.*` strings stay.** Deleting them orphans keys in four
  generated `zh.json` bundles for no user-visible gain.

## Assumptions

> Each was checked against the code in Pass 2; the finding is recorded inline.

1. ~~`listGoogleDriveFiles` covers the three migrated surfaces.~~ **CHECKED AND FALSE** — see the
   Context table. Nothing is migrated.
2. ~~The flow knows the shared file's name.~~ **CHECKED AND TRUE, and already rendered** —
   `expectedFileName` (`:333-336`) + `JoinPodView.vue:405-414`. No new Drive call, no new markup.
3. ~~`EXPORT_FONTS` is reusable.~~ **CHECKED: page-specific** (`MealPlannerPage.vue:53-62` names
   `.day-num`, `.export-tagline`, `.dish.type`). Do not hoist; the kit gets its own list.
4. Production's `GOOGLE_API_KEY` is valid and its referrer restrictions include
   `app.beanies.family`. **Unverifiable from here** — greg's device test confirms it.

## Approach

### 1. Break the loop — `useJoinFlow.ts`

**1a. Stop prescribing consent for a first-time `needs-pick`.** At `:816-818`, delete the
`forceConsent` derivation; call `doPickAndLoad(false)` unconditionally, with a comment recording why
`needs-pick` is not evidence of a wrong account on a first join. `handleSignInDifferent` is
untouched and remains the only `forceConsent: true` caller.

**That single deletion breaks the loop — verified against the code, not inferred.**
`tryAutoLoadByFileId` returns `'auth'` when the silent token is falsy (`:565-566`), so
**`'needs-pick'` is only reachable WITH a live silent token.** Therefore
`pick({ forceConsent: false })` → `tryGetSilentToken()` returns that same token → `if (!token)` is
false → **`shouldUseRedirectAuth()` is never evaluated** → `pickBeanpodFile(token)`. The Picker
opens on the first CTA tap after the redirect return.

⚠️ **THE SIDE EFFECT THIS CREATES, AND THE ESCAPE HATCH IT NEEDS.** Deleting `forceConsent` also
removes Google's account chooser from the `needs-pick` path. If the cached account is the _wrong_
one, the joiner now opens the Picker against their own Drive, finds nothing, cancels — and lands
back on `awaiting-auth`. `signInDifferentAccount` is reachable **only** through
`currentErrorView.recoveries` (`JoinPodView.vue:113-116`), and §1c deliberately records no error for
a cancel, so the awaiting block (`:361-420`) has no such control. **That trades an infinite redirect
loop for a silent Picker loop.**

So the awaiting block gains a secondary text button calling `flow.handleSignInDifferent()`, reusing
the existing `join.recovery.signInDifferentAccount` (`uiStrings.ts:5543`) — **zero new strings**.

⚠️ **One new failure mode to test, not to code around.** `pick({ forceConsent: false })` now runs
`tryReconnectSilently(loginHint)` first, inside the auth `try`; a throw there returns
`{ failed, 'auth' }` and the Picker never opens. `driveTokenRecovery.ts:6-9` declares it
best-effort, so no code change — but test 1 must assert the Picker is still reached with
`tryReconnectSilently` rejecting.

**1b. Make a redirect its own outcome.** Add `{ kind: 'redirecting' }` to `PickBeanpodFileResult`
(`drivePicker.ts:218-225`), returned from `usePickBeanpodFile.ts:91`, carrying across
`ReconnectOutcome`'s reasoning.

⚠️ **Each of the four consumers must `switch (result.kind)` with `assertNever`**
(`src/utils/assertNever.ts`) in the default arm — NOT an `if` chain. A future fifth `kind` must be
a compile error, not another silent fall-through, which is the exact failure mode this plan exists
to fix. And the stale doc-comment at `usePickBeanpodFile.ts:43-46` ("Treat as a cancellation from
the current call's perspective") must be rewritten: leaving it is how the bug returns.

Fix all four consumers, each of which currently lies:

| Consumer                               | Today                                       | After                                                                           |
| -------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------- |
| `useJoinFlow.doPickAndLoad`            | `cancelled` → silent `awaiting-auth`        | `cancelled` → `awaiting-auth` **with reason**; `redirecting` → reason, no error |
| `LoadPodView.loadSavedFileViaPicker`   | one arm whose comment admits it covers both | two arms, each logging its own fact                                             |
| `PodAccessBanner.pickFamilyFile`       | `!== 'picked'` → bare `return`              | via §2                                                                          |
| `SaveFailureBanner.handleReselectFile` | `!== 'picked'` → bare `return`              | via §2                                                                          |

**1c. Never regress silently — and make that structural, not conventional.**

There are **five** writes of `currentStep.value = 'awaiting-auth'`: `useJoinFlow.ts:635`, `:807`,
`:922`, `:933`, and `JoinPodView.vue:251`. "Set the reason at each transition" would be a five-site
invariant policed only by a test — the same shape as the bug being fixed.

Instead: a single `enterAwaiting(reason: AwaitingReason)` in the composable writes **both** refs, and
is the only way to reach that step. It is exported so `JoinPodView.handleBack` calls it in place of
its direct ref write. **The invariant becomes a required function argument — a compile error, not a
test.**

`JoinPodView` renders one line above the existing CTA from a small `Record<reason, UIStringKey>`.
`'initial'`/`'needs-pick'` reuse the **existing** `join.pickerPrompt.description`. Only two new
strings: `join.awaiting.cancelled`, `join.awaiting.redirecting`.

**No clearing.** `JoinPodView` renders the awaiting block only under
`currentStep === 'awaiting-auth'` (`:361`), so a stale reason is unobservable. Clearing it inside a
telemetry watcher would give one watcher two jobs for no user-visible gain.

**Deliberately NOT `JOIN_ERRORS` entries** — a registry entry routes through `recordError`, which
pages `#beanies-errors`. "You closed the file chooser" is not an incident.

**1d. One watcher, in its own module.** A single `watch(currentStep, …)` emits transitions — one
fact in one place rather than N call-site emits that drift when an N+1th site appears.

⚠️ **It does NOT live in `useJoinFlow`.** That composable is already 969 lines and returns 22
members; this would add a 23rd plus a new concern. Put it in
`src/services/telemetry/joinStepEvents.ts`, following the existing `loginFlowEvents.ts` facade
precedent, called with the two refs. The message vocabulary is then testable without instantiating
the whole flow.

⚠️ `joinStepEvents(currentStep, awaitingReason)` is invoked from **inside `useJoinFlow`'s setup
scope**, so `watch` binds to the component effect scope. Otherwise a unit test calling
`useJoinFlow()` outside a component leaks watchers.

### 2. One re-select primitive for the two recovery banners

Extract `useDriveFileReselect()`: `pick()` → `syncStore.rebindPodFile` → a discriminated outcome
plus a `UIStringKey`, never a raw string.

- `picked` + rebind ok → `{ outcome: 'rebound' }`
- `picked` + rebind failed → `{ outcome: 'failed', messageKey: POD_ACCESS_ERRORS[code].messageKey }`
- `failed` → `{ outcome: 'failed', messageKey: describePickFailure(reason).messageKey }` +
  `reportError` with its `errorCode` — reusing the table at `drivePicker.ts:385-402`, whose own
  doc-comment explains why: `reason: 'config'` would otherwise put the literal
  `"VITE_GOOGLE_API_KEY is not configured"` in front of a family.
- `cancelled` → `{ outcome: 'declined' }` + `logEvent` info
- `redirecting` → `{ outcome: 'redirecting' }` — caller leaves the UI alone

The return type is a **closed union** (`'rebound' | 'declined' | 'redirecting' | 'failed'`) consumed
by an exhaustive `switch`.

⚠️ **Preserve the call arguments exactly.** Both banners call `pick()` with **no arguments**
(`PodAccessBanner.vue:51`, `SaveFailureBanner.vue:37`), i.e. `forceConsent: true` and no
`loginHint`. `useDriveFileReselect` must default identically — "improving" it with a `loginHint`
would silently change consent behaviour on a critical recovery banner.

Each banner keeps its own markup and renders through **the channel it already has** — a third
channel would be a coupling regression:

- `PodAccessBanner` already has two (`resolveErrorView(POD_ACCESS_ERRORS, …)` at `:38` and
  `showToast` at `:98`). It renders the returned `messageKey` through **`showToast`**. Do not add a
  local `reselectError` ref there.
- `SaveFailureBanner` renders through its existing **`reselectError`**.

⚠️ **Also fix `switchToCanonical`'s fallback.** Its `if (!ok) await pickFamilyFile()` discards the
outcome — the same silent-return defect one level up. It must consume the union.

Shared derivation, surface-owned markup — the division `utils/structuredError.ts` documents.

### 3. One table for Picker reason → join code

Replace the nested ternary at `useJoinFlow.ts:626-632` with

```ts
const JOIN_CODE_FOR_PICK_REASON = { … } as const satisfies Record<PickFailureReason, JoinErrorCode>;
```

mirroring `PICK_FAILURE_COPY` and `JOIN_CODE_FOR_KIND`, both already here. A new reason then fails
the build instead of silently taking the last ternary arm. Corrects two lies:

- `config` → new `PICKER_UNAVAILABLE`, reusing the existing `settings.drivePickerUnavailable`
  (cross-namespace reuse has precedent: `FILE_OLDER_VERSION` → `podOlderVersion.inline`).
  **`JOIN_ERRORS` entry at NON-critical severity** — a build-config fault must not page
  `#beanies-errors`.
- `auth` → **`PICKER_AUTH_FAILED`**, `messageKey: 'settings.drivePickerAuth'` (`uiStrings.ts:3437`
  — already exists, no new string), `severity: 'warning'`,
  `recoveries: ['signInDifferentAccount', 'retry', 'tryAnotherDevice']`.

`severity` is the closed union `'warning' | 'critical'` (`structuredError.ts:41,51`) and only
`'critical'` pages Slack (`errorReporter.ts:275`) — so "non-critical" means literally
`severity: 'warning'`.

⚠️ **Take `messageKey` from `PICK_FAILURE_COPY`, do not invent parallel copy.** That table
(`drivePicker.ts:385-402`) is already `as const satisfies Record<PickFailureReason, …>` and already
maps `config` → `settings.drivePickerUnavailable` and `auth` → `settings.drivePickerAuth`.

⚠️ **Both tables now key on `PickFailureReason`.** `JOIN_CODE_FOR_PICK_REASON` and
`drivePicker.PICK_FAILURE_COPY` must each be `as const satisfies Record<PickFailureReason, …>` and
carry a cross-reference comment to the other, so a new reason breaks **both** builds.

- `popup-blocked` (new, §5) → `OAUTH_POPUP_BLOCKED`
- `load`/`timeout`/`open`/`iframe` → unchanged, now true of exactly what they name

### 4. Workflows

Add the two Google vars to `mobile-ios-build.yml:79` and `mobile-android-build.yml:62`, matching the
release workflows. **No `.env.example` change** — it already has both.

### 5. The two dead OAuth codes, recorded

**`OAUTH_SCOPE_DENIED`.** `OAuthCallbackPage.vue:108-117` answers Google's `?error=access_denied` by
discarding the already-validated `returnPath` and sending the user to `/`. Return them to
`decoded.returnPath` with `?authError=<error>` — the convention `LoginPage.vue:241` already reads.
`useJoinFlow.init()` reads it and records the code. **This fixes a real defect for every redirect
grant, not just join.**

**`OAUTH_POPUP_BLOCKED`.** `openBlankPopup` (`googleAuth.ts:2192-2194`) throws a distinct message and
`isUserCancellation` deliberately does not match it. Add a sibling `isPopupBlocked(e)`, have
`usePickBeanpodFile`'s auth catch return `reason: 'popup-blocked'`.

⚠️ **MISSING STEP THAT WILL BREAK THE BUILD IF OMITTED.** Adding `'popup-blocked'` widens
`PickFailureReason`, so **`PICK_FAILURE_COPY` needs a row too** — that compile error is the
mechanism working, but the plan must say to satisfy it:
`'popup-blocked': { messageKey: 'join.error.popupBlocked', errorCode: 'picker-popup-blocked' }`,
plus the matching `JOIN_CODE_FOR_PICK_REASON` row. `LoadPodView` inherits this copy for free via
`describePickFailure`.

### 6. Recovery kit PDF — fix the mechanism, in the shared engine

All in `useSheetExport.ts`, so the meal planner benefits too.

⚠️ **Cap the growth.** As first drafted this gave one 30-line function five jobs (font preload,
memoised embed CSS, timeout, capture, retry) with the retry nested inside the catch. Instead:

- a private **`captureOnce(el, opts, fontEmbedCss | null)`**, called twice at **one** level of
  nesting — not a retry buried in a catch;
- **`getFontEmbedCSS()`** as its own function with the identical null-on-rejection memo shape as
  `loadHtmlToImage`/`loadJsPdf` ten lines above;
- a named **`FONT_EMBED_TIMEOUT_MS`**, whose losing promise cannot reject unhandled.

1. **Supply `fontEmbedCSS`**, memoised once per session. The inlining then runs at most once per
   session instead of once per export.
2. **`preferredFontFormat: 'woff2'`**, cutting the per-face fetch fan-out.
3. **Degrade, never abort.** Bound the embed with `FONT_EMBED_TIMEOUT_MS`; on failure or timeout,
   `captureOnce` again with `skipFonts: true`, plus `console.warn` and a `logEvent`
   (`error_code: 'font-embed-fallback'`). **This is what makes the fix robust to a diagnosis we
   cannot fully confirm from here** — a kit in fallback fonts is a working kit.
   ⚠️ **The retry fires AT MOST ONCE**; a second failure still throws `ExportError('rasterize')`.
   Today's contract is preserved, not widened.
4. `prewarmSheetExport()` also warms the memoised CSS; call it from `RecoveryKitDisplay`'s existing
   `watch(() => [props.open, props.code])`.
5. **Resolve the font levers rather than adding a second one.** Once `fontEmbedCSS` is supplied,
   `opts.fonts` → `document.fonts.load()` is a FOUT guard whose value _for the capture_ is largely
   gone. **Do NOT add a new `KIT_FONTS` list** — requirement 11 forbids config that deletes nothing.
   `RecoveryKitDisplay` passes `backgroundColor` only. Decide during implementation whether
   `PngExportOptions.fonts` and `MealPlannerPage.EXPORT_FONTS` should now be deleted outright, and
   record the decision in the code.
6. **Replace, don't duplicate.** `RecoveryKitDisplay` already interpolates `at ${e.stage}` into the
   failure message. Promoting `stage` into `context: { error_code: e.stage }` **must remove that
   interpolation**, or the same fact ships from two places and drifts.

### 7. Delete the dead entry point, and state the cascade

`drivePicker.pickBeanpodFolder` (`:107-193`) — 87 lines, zero callers in `src/` or `e2e/`.

⚠️ **It is the only production caller of the folder path.** Deleting it leaves
`driveService.findBeanpodInFolder` and `NoBeanpodInFolderError` (`driveService.ts:781-830`)
reachable only from `driveService.test.ts:582-619` — i.e. code kept alive solely by its own test.
**DECIDED: delete them** — `driveService.findBeanpodInFolder`, `NoBeanpodInFolderError`, their
tests at `driveService.test.ts:582-619`, and the now-dangling `findBeanpodInFolder` reference in the
doc-comment at `drivePicker.ts:105`. Verified: once `pickBeanpodFolder` goes, the only remaining
references are that one test file — code kept alive solely by its own test.
`loadPickerScript`/`loadPickerLibrary` stay — still used by `pickBeanpodFile`.

## Files Affected

**Modified**: `src/composables/useJoinFlow.ts`, `src/composables/usePickBeanpodFile.ts`,
`src/components/login/JoinPodView.vue`, `src/components/login/LoadPodView.vue`,
`src/components/common/PodAccessBanner.vue`, `src/components/google/SaveFailureBanner.vue`,
`src/services/google/drivePicker.ts`, `src/services/google/googleAuth.ts`,
`src/pages/OAuthCallbackPage.vue`, `src/composables/useSheetExport.ts`,
`src/components/auth/RecoveryKitDisplay.vue`, `src/services/translation/uiStrings.ts` (**+2 keys**),
`.github/workflows/mobile-ios-build.yml`, `.github/workflows/mobile-android-build.yml`, plus tests.

**New**: `src/composables/useDriveFileReselect.ts` + test;
`src/services/telemetry/joinStepEvents.ts` + test (the §1d split, following the `loginFlowEvents.ts`
precedent).

**Possibly deleted (decide in §7)**: `driveService.findBeanpodInFolder`, `NoBeanpodInFolderError`
and their tests — reachable only from their own test once `pickBeanpodFolder` goes.

**Deleted**: `drivePicker.pickBeanpodFolder` (~87 lines); the duplicated pick→rebind bodies in both
banners.

**Explicitly NOT touched** (reversed from the first draft): the Picker at
`LoadPodView.loadSavedFileViaPicker`, `PodAccessBanner.pickFamilyFile`,
`SaveFailureBanner.handleReselectFile`; `.env.example`; `MealPlannerPage.EXPORT_FONTS`; the
`config` guard in `pickBeanpodFile`. No `useDriveBeanpodPicker`.

## Observability Coverage

Surface `join-flow` (existing). The first draft's `drive-picker` is dropped — it would have emitted
a second time facts that `recordError` → `reportError` already ships with `error_code`.

⚠️ **Correction: `sheet-export` is NOT an existing surface** (`grep -rn "sheet-export" src/` → 0),
and `RecoveryKitDisplay` already reports under `login-flow`. `surface` is a free string so there is
no schema churn, but the premise had to be fixed: the §6.3 fallback emits under **`login-flow`**,
consistent with the kit's existing `kit_pdf_failed` report.

⚠️ **Message cardinality is a constraint, not a style note.** `logEvent` rate-limits on
`${surface}::${normalizeMessage(message)}` at 50/min/bucket. The `join step <from> -> <to>
(<reason>)` message MUST be composed only from the closed step and reason unions — never a file
name, email or id — so buckets stay bounded (~40) and a genuine loop still trips the same bucket 50
times before suppression.

- `logEvent({ level, surface: 'join-flow', message: 'join step <from> -> <to> (<reason>)',
context: { action: 'join_step' } })` — from the single `watch` in §1d, so **every** transition,
  including the ones that emit nothing today and the ones the view writes directly. This is the
  signal whose absence made the loop invisible. `level: 'warn'` when the transition is _into_
  `awaiting-auth` with reason `needs-pick`, `info` otherwise — so the loop's entry condition is one
  query and a spike in it is the regression alarm, without a second event type.
- `logEvent({ level: 'info', surface: 'join-flow', message: 'join completed',
context: { action: 'join_completed' } })` — **the denominator.** Without it we can count failures
  but never the rate.
- `reportError` via the existing `recordError` — unchanged, now genuinely reachable for
  `OAUTH_SCOPE_DENIED`, `OAUTH_POPUP_BLOCKED` and `PICKER_UNAVAILABLE`.
- `logEvent({ level: 'warn', surface: 'sheet-export',
context: { error_code: 'font-embed-fallback' } })` — the §6.3 degradation, so a silent quality
  regression is visible.

**Failure modes → the event that diagnoses them blind**: the consent loop → repeated warn-level
`join_step` into `awaiting-auth` with no `join_completed`; a Picker config fault →
`PICKER_UNAVAILABLE`; consent denied → `OAUTH_SCOPE_DENIED`; a cancel → the step transition carrying
its reason; a font storm → `font-embed-fallback`.

**No new context keys** — `action` and `error_code` are already allowlisted
(`diagnosticContext.ts:68-69`), so no Lambda-mirror or store-declaration churn.

## Acceptance Criteria

- [ ] On a redirect-auth platform, completing consent and tapping the CTA opens the **Picker** —
      proven by a test **with `shouldUseRedirectAuth` mocked `true`** (without that mock the
      assertion passes vacuously on the popup path) asserting `startRedirectAuth` is called
      **exactly once** across the whole sequence, and that the Picker is still reached when
      `tryReconnectSilently` rejects.
- [ ] The awaiting block offers `signInDifferentAccount`, so a wrong-account joiner who cancels the
      Picker is not trapped — the side effect of dropping `forceConsent`.
- [ ] `enterAwaiting(reason)` is the ONLY way to reach `awaiting-auth`; no direct
      `currentStep.value = 'awaiting-auth'` write remains in `useJoinFlow.ts` or `JoinPodView.vue`
      (grep-verified), so the reason is a required argument rather than a convention.
- [ ] `usePickBeanpodFile` returns `'redirecting'`, never `'cancelled'`, after firing a redirect;
      all four consumers `switch` on `result.kind` with `assertNever`, so a fifth kind fails `tsc`.
- [ ] `useDriveFileReselect`'s outcome is consumed by an exhaustive `switch` at both banners AND at
      `switchToCanonical`'s fallback, which currently discards it.
- [ ] A genuine cancel shows `join.awaiting.cancelled` plus the CTA, not the bare found-pod card.
- [ ] `PodAccessBanner` and `SaveFailureBanner` each surface a message for a Picker failure and for
      a failed rebind; neither has a bare `return` on a non-`picked` outcome.
- [ ] `JOIN_CODE_FOR_PICK_REASON` is exhaustive over `PickFailureReason`; adding a reason without a
      mapping fails `tsc`.
- [ ] `reason: 'config'` renders `settings.drivePickerUnavailable`, not "check your internet";
      `reason: 'auth'` no longer renders `join.error.pickerFailed`.
- [ ] The joiner is shown the file name before the Picker opens (locks in existing behaviour).
- [ ] `grep -rn pickBeanpodFolder src/ e2e/` is empty.
- [ ] Both `mobile-*-build.yml` workflows pass the two Google vars.
- [ ] `getFontEmbedCSS` is invoked at most once per session across N exports; asserted.
- [ ] `exportElementToPng` calls a single `captureOnce` helper twice at one level of nesting — no
      retry buried inside a catch.
- [ ] The step-telemetry message is composed only from the closed step/reason unions, so its
      rate-limit bucket count stays bounded; asserted.
- [ ] `RecoveryKitDisplay` no longer interpolates `at ${stage}` into the message now that `stage`
      rides in `error_code` — the fact ships from one place.
- [ ] A throwing/timing-out font embed **still yields a PDF** via the `skipFonts` retry; asserted.
- [ ] `prewarmSheetExport()` runs when the kit modal opens.
- [ ] `OAUTH_SCOPE_DENIED` and `OAUTH_POPUP_BLOCKED` are each emitted by a test exercising the real
      path; the "every code is reachable" test is strengthened from _declared_ to _emitted_.
- [ ] `npm run validate` green.

## Testing Plan

1. Unit: the redirect-return path reaches the Picker with the silent token and fires **no** second
   redirect. **The regression test for the reported bug.**
2. Unit: every `awaiting-auth` transition carries a reason. **Tests drive the flow through
   `enterAwaiting`/the returned API — never by writing `flow.currentStep.value` directly**, or they
   re-establish the coupling §1c removes.
3. Unit: `'redirecting'` ≠ `'cancelled'` in `usePickBeanpodFile` and at all four consumers.
4. Unit: `useDriveFileReselect` — rebound / declined / redirecting / pick-failed / rebind-failed;
   each returns a `UIStringKey`, never a raw string.
5. Unit: `JOIN_CODE_FOR_PICK_REASON` exhaustiveness + the `config` / `auth` copy corrections.
6. Unit: `useSheetExport` — `getFontEmbedCSS` memoised across two exports; the `skipFonts` fallback
   on a throwing embed; the fallback emits its `logEvent`.
7. Unit: `OAuthCallbackPage` `?error=access_denied` returns to `decoded.returnPath` with
   `authError`, and still rejects a malformed state without an open redirect.
8. **Mutation** — per `docs/lessons.md`, a guard not seen to fail is not a guard. Specifically:
   restore `forceConsent = autoResult === 'needs-pick'` and confirm test 1 goes red.
9. Browser (`scripts/design-screenshots/`, NOT `e2e/specs/`): the join view's awaiting states —
   initial, cancelled, redirecting — light and dark, phone width.
10. Browser: recovery kit PDF export in Chromium **and** Firefox.
11. **greg's hands** (cannot be automated, and the telemetry says this is the only proof that
    counts): a real two-account join **on an iPhone**, plus desktop; the kit PDF in his Firefox.

## Review Passes

- **Pass 1 (Initial draft)**: drafted from three parallel investigations plus direct reads of the
  failing code; established that the reported bug and greg's repro are unrelated faults, and that
  the Picker cannot leave the join flow under `drive.file`.
- **Pass 2 (DRY + error handling)**: verified every reuse claim against the code and reversed the
  three that were false — the Picker cannot be retired from _any_ of its four sites (all three
  migration targets are reached precisely when `files.list` is blind under `drive.file`), the
  missing-key guard and the file-name prompt already exist, and `opts.fonts` never reaches
  `html-to-image` so the kit-PDF fix was a no-op; replaced `useDriveBeanpodPicker` with the one real
  duplication (the banners' silent pick→rebind bodies), the `intent` rename with the one-line
  deletion that actually breaks the loop, and the nested ternary plus five event families with two
  compile-enforced tables and one unbypassable step watcher, plus a `skipFonts` degradation so a
  font failure can no longer cost the user their recovery kit.
- **Pass 3 (Sustainability)**: turned four test-enforced invariants into structural ones — a single
  `enterAwaiting(reason)` entry point replacing a five-site convention, `assertNever` switches on
  `PickBeanpodFileResult` and the reselect outcome, and named codes with explicit `JOIN_ERRORS`
  severity — split the step-telemetry watcher out of the already-969-line `useJoinFlow`, capped
  `exportElementToPng` at one level of nesting via a `captureOnce` helper, corrected the false
  "`sheet-export` is an existing surface" premise, and forced the plan to resolve rather than
  accumulate the two font levers, the banners' competing error channels, and the dead-code cascade
  behind `pickBeanpodFolder`.
- **Pass 4 (Fresh-eyes sweep)**: re-traced the one-line `forceConsent` deletion against the real
  code and confirmed it breaks the loop (`needs-pick` is only reachable with a live silent token,
  so `pick(forceConsent:false)` takes the fast path and opens the Picker), then closed the side
  effect it creates — the wrong-account joiner loses the account chooser and `signInDifferentAccount`
  is unreachable from `awaiting-auth`, so the awaiting block gains that recovery link off the
  existing i18n key — and resolved the four items still left open or contradictory: the
  `'popup-blocked'` row `PICK_FAILURE_COPY` needs or the build breaks, the unnamed auth code and the
  `'warning'` severity the closed union actually permits, the font-lever and dead-code-cascade
  decisions (keep `opts.fonts`; delete `findBeanpodInFolder` with its test), and the
  `sheet-export`/`login-flow` surface contradiction in the observability bullet.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial prompt (2026-09-16)

> ok - once the commit is done, let's now address some user feedback regarding the family member
> joining process, and a genuine bug or regression that i believe has been introduced in the
> joining process.
>
> [user feedback quoted: husband reached the join screen, Google consent popped up, he accepted,
> then it "would just go back to the 'we found your family pod' page and the only option was to go
> back to the google permissions". No .beanpod in his Drive. Sharing the file directly didn't work.]
>
> I've gone back to my local to test the family member join process again... We get a google file
> picker error, which is the one we fixed about a week ago (There was an error! The API developer
> key is invalid). Rather than fix this error, we removed the google file picker entirely from the
> join process and replaced it with our custom picker after finding .beanpod files - hopefully that
> fix can/should apply here too.
>
> I also hit another bug related to downloading the recovery kit (error: "couldn't make the pdf -
> copy the above code instead, or try again") - note this was in my firefox browser...
>
> please perform a full, thorough, comprehensive analysis of this issue, use as much time / agents
> as you need to ensure you have the full picture, and prepare a detailed report and plan to
> definitively fix the issue. once the plan is built, proceed to implement the fix via
> /beanies-build-auto and validate, test, check in browser, etc as needed to ensure the fix works
> reliably across all surfaces, browsers, etc to the fullest extent possible. work autonomously,
> and if you need anything from my please ask questions now.

### Follow-up 1 (mid-turn clarification)

> note that i've already informed the user that you would not expect to see a beanpod file in their
> google drive, but you should see it in the 'shared with me' section, so that is expected behavior

### Decisions taken (AskUserQuestion)

> **Picker scope**: "Let's do (1) retire it everywhere - i prefer not to use the picker if we can
> avoid it, but i recall this being tricky when it came to inviting users to edit a file that was
> shared with them as they need to select it at least once, but if we can emulate this selection
> with our custom picker, we sould absolutely do that, or try to find any other way to avoid using
> the google file picker, which seems legacy and buggy, and a huge inducer of friction to both
> joining and inviting family members to the app."

> **Kit PDF**: in scope, fix here.

> **Validation**: greg tests on device / second account after review.

> **After being shown that `drive.file` makes the Picker selection the access grant itself**:
> "Keep Picker for join only, retire the other three" + "Yes — detect and explain it" for the
> dev-build missing-key case.

</details>

---

## Outcome (2026-09-16)

Implemented and validated. `npm run validate` green (8169 tests), `npm run test:lambda` green
(311 tests). One `/code-review max` round found 15 defects; all 15 fixed, plus three cut-list
items (the `unclaimMember` authz bypass, the comment-satisfiable source guard, and the docs).

### What changed from the plan

**Pass 2 reversed the approved Picker decision, correctly.** The plan was approved on "retire the
Picker everywhere". Under the `drive.file` scope the Picker selection _is_ the access grant, so
`files.list` returns only files the app already holds a grant for — which is blind at precisely
the three sites the plan wanted to convert. Scope narrowed with greg's agreement to: keep the
Picker for join, retire the other three.

**The claim fix changed shape during review.** The plan (and the first implementation) wrote the
claim first and rolled it back in `joinFamily`'s catch. Review found two holes: the rollback can
itself fail, and it cleared the credentials while leaving the session authenticated and
persisted. Replaced with an ordering guarantee — every fallible step runs before `applyPinReset`,
so there is nothing to roll back. `joinClaimOrdering.test.ts` pins the order, not the compensation,
because a test that only checks "the hash is cleared after a failure" passes against both designs
including the one that shipped the bug.

**The kit-PDF fix was a no-op on the first attempt.** `PngExportOptions.fonts` only ever fed
`document.fonts.load()`; it never reaches html-to-image. The real fix is `getFontEmbedCSS` plus a
reachable `skipFonts` retry — and review caught that the retry had one call site, so it fired only
when _fetching_ the font CSS failed, never on the Firefox failure it was written for (the fetch
succeeds; the rasterize dies on the resulting multi-megabyte data URL).

### Known, deliberately out of scope

`GoogleDriveProvider.createNew` and `syncStore.listGoogleDriveFiles({ forceNewAccount })` still
pass `forceConsent`, so they still do not show the account chooser their own comments claimed.
Behaviour unchanged and the comments corrected; converting them changes the create-a-pod and
Settings-restore flows.

### Owed by greg (not programmatically verifiable)

1. A real two-account join on an iPhone: sign in as the invitee's Google account, tap the invite
   link, expect the Picker to open rather than a bounce back to consent.
2. The recovery kit as a PDF in Firefox: expect a saved file, in fallback fonts if need be.
3. The stuck member: Pod → their bean → "Let them join again", then confirm a new invite link can
   be minted for them.
