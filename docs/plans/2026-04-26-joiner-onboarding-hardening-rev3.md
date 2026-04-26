# Plan: Joiner Onboarding Hardening (rev 3 — fresh-eyes pass)

> Issue: [#185](https://github.com/gparker97/beanies-family/issues/185)
> Sister track (long-term): #186 — Drive UI integration
> Predecessor (rev 1, history only): `docs/plans/2026-04-26-joiner-onboarding-hardening.md`

## Context

Family members joining via the iPhone QR flow get stuck on confusing errors: "File not found", a cookie-consent screen, then "API developer key is invalid" inside the Picker. Other browsers and devices work. We've ruled out switching OAuth scopes (privacy regression) and `anyone-with-link` sharing (joiner can't write back). The plan is to keep the Google Picker as the primary path and harden everything around it: clean state machine, structured error registry, clear messages with concrete recovery actions, reuse of yesterday's primitives, and a one-shot iOS-WebKit Storage Access workaround attempt.

**Yesterday's recovery work (commit `41da938` and friends) shipped four primitives we will reuse, not duplicate:**

- `usePickBeanpodFile` (`src/composables/usePickBeanpodFile.ts`) — the Picker call site that already handles redirect-vs-popup and forces the chooser.
- `recoverFromMissingFile` in `syncStore` — swaps the provider when a different fileId is picked.
- `googleAccountAssertion` (`src/services/auth/googleAccountAssertion.ts`) — only fires after a member is bound; does NOT run during the join flow.
- `login_hint` plumbing already accepted by `requestAccessToken({ loginHint })` and `startRedirectAuth(returnPath, loginHint)`.

**Real-device diagnostic results (iPhone iOS 26.4.2, today):**

- With a real invite URL, Picker CTA appears, OAuth completes, then the Picker shows a cookie-consent screen → user allows → still "API developer key is invalid".
- Same failure in iOS Chrome — this is iOS-WebKit-wide, not Safari-only.
- A second attempt without clearing cookies lands on Google's stuck-state "Can't access your Google account" screen.
- Block-All-Cookies is OFF, Cross-Site-Tracking-Prevention is ON (default), Storage Access API is enabled.

**Important nuance from greg:** the same flow worked for his wife on iPhone 17 a few weeks ago. iOS WebKit isn't a hard "doesn't work" — it works for some users, fails for others. So we **never pre-warn** ("this might not work on iPhone") — that's bad UX for the users it'd work for. We surface clear, direct messaging only when a failure actually happens.

**The most likely root cause of the cookie/API-key chain — and the most likely fix.** Yesterday's first hotfix (commit `a8f1a24`) routed all iOS through `startRedirectAuth` because the original `/join` page auto-fired OAuth on mount with no user gesture in the call stack — iOS Safari's popup blocker rejected it. The hotfix deferred auth to a user-gesture button tap AND switched to full-page redirect on all iOS. Switching to redirect was over-correction: with a real user gesture, iOS regular Safari allows popups. The full-page redirect introduces an ITP top-level navigation that breaks the Picker iframe's auth context on the way back — exactly the cookie-consent + API-key-invalid chain greg's wife is hitting now and that worked fine before the hotfix. Standalone PWAs still need redirect (popup→postMessage can't bridge in standalone mode), but **iOS regular Safari should go back to popup**. This is Phase 0.5 below — likely the single highest-leverage fix in the entire plan, far more likely to work than the Storage Access API attempt.

## Approach (top-down)

### One composable owns the flow

Extract every join-flow concern from `JoinPodView.vue` (currently 1,155 lines, growing) into `src/composables/useJoinFlow.ts`. The view becomes presentational: reads reactive state, renders, emits user intents. Matches the project's MVO pattern, halves the view's size, makes the flow unit-testable without mounting Vue, and gives one seam to instrument logs and add error codes.

```ts
type JoinStep =
  | 'lookup' // parsing URL, registry lookup
  | 'awaiting-auth' // user must tap "Choose your data file"
  | 'authenticating' // OAuth in flight (popup or redirect)
  | 'picking' // Picker open
  | 'loading' // file fetched, decrypting / validating familyId
  | 'pick-member' // existing step 2
  | 'set-password' // existing step 3
  | 'joining'; // final commit

interface JoinError {
  code: JoinErrorCode;
  context?: Record<string, unknown>;
}

const currentStep = ref<JoinStep>('lookup');
const currentError = ref<JoinError | null>(null);
```

Errors are orthogonal to step. View renders `currentError`'s UI when set; otherwise renders the step UI. **No pre-flight capability hint** — errors fire only when something actually goes wrong.

### Error registry — flat data, multi-recovery, exhaustive

Each code maps to one message + an ordered list of recovery actions + severity. Recovery actions are a closed set of behaviors that the view renders as buttons.

```ts
type JoinErrorCode =
  | 'OAUTH_REDIRECT_FAILED'
  | 'OAUTH_SCOPE_DENIED'
  | 'OAUTH_POPUP_BLOCKED'
  | 'PICKER_SCRIPT_LOAD_FAILED'
  | 'PICKER_FAILED' // covers iOS WebKit "API key invalid", cookie blocked, post-deny stuck state
  | 'PICKER_TIMEOUT' // Picker opened but never fired LOADED or callback within 30s
  | 'FILE_READ_FAILED' // post-pick read; context may include hint vs actual email when relevant
  | 'FILE_DECRYPT_FAILED'
  | 'FILE_FAMILY_MISMATCH'
  | 'INVITE_TOKEN_EXPIRED'
  | 'INVITE_TOKEN_INVALID'
  | 'NO_UNCLAIMED_MEMBERS';

type RecoveryAction =
  | 'retry' // re-fire the same step
  | 'signInDifferentAccount' // forceConsent + chooser
  | 'tryAnotherDevice' // open ShareInviteModal
  | 'pickDifferentBean' // back to step 2
  | 'askForNewInvite'; // dead-end; copy invite URL for diagnosis only

interface JoinErrorEntry {
  messageKey: string; // i18n key for body
  recoveries: RecoveryAction[]; // shown in this order as buttons
  severity: 'warning' | 'critical';
}

const JOIN_ERRORS = {
  OAUTH_REDIRECT_FAILED: {
    messageKey: 'join.error.oauthRedirect',
    recoveries: ['retry', 'tryAnotherDevice'],
    severity: 'critical',
  },
  OAUTH_SCOPE_DENIED: {
    messageKey: 'join.error.scopeDenied',
    recoveries: ['retry'],
    severity: 'critical',
  },
  OAUTH_POPUP_BLOCKED: {
    messageKey: 'join.error.popupBlocked',
    recoveries: ['retry', 'tryAnotherDevice'],
    severity: 'critical',
  },
  PICKER_SCRIPT_LOAD_FAILED: {
    messageKey: 'join.error.pickerScript',
    recoveries: ['retry', 'tryAnotherDevice'],
    severity: 'critical',
  },
  PICKER_FAILED: {
    messageKey: 'join.error.pickerFailed',
    recoveries: ['retry', 'signInDifferentAccount', 'tryAnotherDevice'],
    severity: 'critical',
  },
  PICKER_TIMEOUT: {
    messageKey: 'join.error.pickerTimeout',
    recoveries: ['retry', 'tryAnotherDevice'],
    severity: 'critical',
  },
  FILE_READ_FAILED: {
    messageKey: 'join.error.fileRead',
    recoveries: ['signInDifferentAccount', 'retry', 'tryAnotherDevice'],
    severity: 'critical',
  },
  FILE_DECRYPT_FAILED: {
    messageKey: 'join.error.fileDecrypt',
    recoveries: ['askForNewInvite'],
    severity: 'critical',
  },
  FILE_FAMILY_MISMATCH: {
    messageKey: 'join.error.familyMismatch',
    recoveries: ['signInDifferentAccount', 'askForNewInvite'],
    severity: 'critical',
  },
  INVITE_TOKEN_EXPIRED: {
    messageKey: 'join.error.tokenExpired',
    recoveries: ['askForNewInvite'],
    severity: 'critical',
  },
  INVITE_TOKEN_INVALID: {
    messageKey: 'join.error.tokenInvalid',
    recoveries: ['askForNewInvite'],
    severity: 'critical',
  },
  NO_UNCLAIMED_MEMBERS: {
    messageKey: 'join.error.noUnclaimed',
    recoveries: ['askForNewInvite'],
    severity: 'warning',
  },
} as const satisfies Record<JoinErrorCode, JoinErrorEntry>;
```

`as const satisfies` enforces compile-time exhaustiveness — adding a code without a registry entry fails the build. The set of codes is intentionally smaller than rev 1: codes that aren't programmatically distinguishable (e.g. "API key invalid" vs "cookies blocked" — both surface as a Picker iframe error we can't structurally inspect) collapse into `PICKER_FAILED`.

### `tryStep` — single try/catch surface

```ts
async function tryStep<T>(code: JoinErrorCode, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    log(`step ${code} failed`, { err: (err as Error).message });
    currentError.value = { code, context: { error: (err as Error).message } };
    return null;
  }
}
```

Every async step is one line. One log site, one error-set site. No scattered try/catch in calling code.

### Picker-failure detection (the iOS WebKit case)

The Picker library's callback only fires `LOADED | CANCEL | PICKED`. We can't read iframe-internal errors directly. We detect failure heuristically:

- **Script load failure**: `script.onerror` already fires in `drivePicker.ts:26` → `PICKER_SCRIPT_LOAD_FAILED`.
- **Library load failure**: `gapi.load('picker', resolve)` never resolves → wrap with a `Promise.race` against a timeout → `PICKER_SCRIPT_LOAD_FAILED`.
- **Picker iframe error (iOS WebKit symptom)**: if `setVisible(true)` is followed by `Action.CANCEL` without ever receiving `Action.LOADED` AND under a short threshold (e.g. <3s after open), classify as `PICKER_FAILED` rather than user-cancelled. If `Action.LOADED` was received and then user closed → genuine `Action.CANCEL` → silent re-show CTA, no error.
- **Picker stalls**: if neither `LOADED` nor any callback fires within 30s → `PICKER_TIMEOUT`.

This logic lives in **one place** — extend `pickBeanpodFile` in `src/services/google/drivePicker.ts` to return a discriminated union: `{ kind: 'picked', fileId, fileName } | { kind: 'cancelled' } | { kind: 'failed', reason: 'script' | 'iframe' | 'timeout' }`. The composable maps that to the right error code via one switch.

### Account-mismatch detection — composed with file-load, not standalone

The URL hint email is purely a UX nudge. The actual security boundary is the invite token (which wraps the family key). So:

- If hint matches: silent.
- If hint missing: silent.
- **If hint differs but file load succeeds**: silent (the user picked a Google account that happens to have access — fine).
- **If hint differs AND file load fails**: surface `FILE_READ_FAILED` with `context = { hintEmail, actualEmail }`. The translation copy uses both: "Couldn't load the file with `actual@gmail.com`. The invite was sent to `hinted@gmail.com` — try signing in with that account." `signInDifferentAccount` recovery is the first button.

This composition means we never spam an error when nothing's wrong. No standalone `OAUTH_ACCOUNT_MISMATCH` code needed.

### `login_hint` plumbing (multi-account UX win)

Inviter side: when a per-member invite link is generated in `MeetTheBeansPage.vue`, embed the member's email in the URL.

Joiner side: parse it, pass to `requestAccessToken({ loginHint })` and `startRedirectAuth(returnPath, loginHint)`. Both already accept the parameter (shipped in `41da938`).

URL construction is currently split across two functions: `inviteService.buildInviteLink(token, familyId)` returns a partial URL, and `MeetTheBeansPage.buildBaseJoinUrl()` builds a different URL with provider/fileId. **Consolidate into one canonical function in `inviteService.ts`:**

```ts
export interface InviteLinkParams {
  token?: string; // optional: omitted gives a base join URL
  familyId: string;
  provider?: 'google_drive' | 'local';
  fileName?: string; // base64 (matches existing `ref` param convention)
  fileId?: string;
  inviteeEmail?: string; // base64; mild PII per yesterday's threat-model decision
}

export function buildInviteLink(params: InviteLinkParams): string;
export function parseInviteLink(url: string): InviteLinkParams | null;
```

`MeetTheBeansPage.openShareModal(member)` passes `member.email`. `JoinPodView` swaps its inline URL parsing for `parseInviteLink`. The existing test `inviteService.test.ts` extends to cover round-trip permutations.

### Reuse — explicit list

| Need                                    | Reuse                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------- |
| Picker invocation                       | `usePickBeanpodFile.pick()` — already handles silent token, redirect-auth, force-consent    |
| Auth-platform routing                   | `shouldUseRedirectAuth()` (`googleAuth.ts:85`)                                              |
| Silent token check on mount             | `tryGetSilentToken()` (`googleAuth.ts:108`)                                                 |
| Resolved Google email                   | `getGoogleAccountEmail()` (`googleAuth.ts:691`)                                             |
| `login_hint` parameter                  | already accepted by `requestAccessToken` and `startRedirectAuth`                            |
| Different-device fallback UI            | `ShareInviteModal.vue` — channels (WhatsApp, Telegram, SMS, Email, Copy) + QR               |
| Diagnostic clipboard copy               | `useClipboard()` (`composables/useClipboard.ts`)                                            |
| Modal chrome                            | `BaseModal.vue`                                                                             |
| Error banner chrome                     | `ErrorBanner.vue` (no severity changes needed — we use existing `critical`/`warning`)       |
| Original-pod-owner-lost-access recovery | `recoverFromMissingFile` in syncStore + the "Pick file from Drive" banner shipped yesterday |

### Different-device fallback

`tryAnotherDevice` recovery action opens `ShareInviteModal` with the current join URL pre-filled. Title overrides to "Continue on another device". No new component. The user emails/copies/QR-shares the link to their other device.

### Diagnostic capture

Extract `getDeviceDiagnostics` from `App.vue:673` into `src/utils/diagnostics.ts` as `getDeviceInfo()`. The composable composes it with state + last error:

```ts
function buildDiagnosticReport(): string {
  return JSON.stringify(
    {
      device: getDeviceInfo(),
      step: currentStep.value,
      error: currentError.value,
      redirectAuth: shouldUseRedirectAuth(),
      googleEmail: getGoogleAccountEmail(),
      timestamp: new Date().toISOString(),
    },
    null,
    2
  );
}
```

UI: every error screen has a small "Copy diagnostic info" link → opens a `BaseModal` with `<pre>` block + copy button via `useClipboard`. No new modal class. Useful for users to paste back to support.

### iOS WebKit Storage Access API attempt — last phase, kept honest

**Only after** the architecture and `login_hint` work has shipped and been verified, attempt one code-level mitigation:

- Add a hidden `<iframe>` to a `docs.google.com` URL we control (a static empty endpoint) immediately before opening the Picker.
- From the iframe, call `document.requestStorageAccess()` (user-gesture present from the Picker tap).
- On grant, open the Picker. On deny, surface `PICKER_FAILED`.
- If grant + Picker still fails, this attempt didn't work — **remove the workaround entirely** (don't keep dead code) and lock the existing `PICKER_FAILED` flow with `tryAnotherDevice` recovery in.

If it works, ship a short ADR explaining the technique. If it doesn't, the only doc artifact is a one-line note in the test matrix.

### Original-pod-owner-lost-access (in scope, copy-only)

This case (OAuth grant revoked → file 404s) already has a working recovery path: today's "Pick file from Drive" banner action calls `recoverFromMissingFile`. The hardening here is one translation-key edit to add a likely-cause hint to the banner copy — "This usually means the app's access was revoked in your Google account. Re-pick the file to restore it." No new code path.

## Files Affected

### New files (3)

- `src/composables/useJoinFlow.ts` — state machine, `JOIN_ERRORS` registry, `tryStep`, `log`, `buildDiagnosticReport`. Exports `useJoinFlow()` returning the reactive state + intent handlers (`handleAuthTap`, `handleRetry`, `handleSignInDifferent`, `handleTryAnotherDevice`, `handlePickMember`, `handleSubmitPassword`).
- `src/composables/__tests__/useJoinFlow.test.ts` — pattern from `useGoogleReconnect.test.ts`. Mock `usePickBeanpodFile`, `syncStore`, `authStore`, `requestAccessToken`, `getGoogleAccountEmail`. See test list below.
- `src/utils/diagnostics.ts` — extracted `getDeviceInfo()` (currently inline in `App.vue:673` as `getDeviceDiagnostics`).

### Modified files (9)

- `src/services/google/googleAuth.ts` — Phase 0.5: narrow `shouldUseRedirectAuth()` so the iOS-UA branch is dropped; only standalone-display-mode triggers redirect. The existing function comment is updated to reflect the corrected reasoning (popup-blocker only fires outside user gestures; full-page redirect is what introduces the ITP boundary that breaks the Picker iframe).
- `src/components/login/JoinPodView.vue` — slim from ~1,155 lines to ~400. Only template + bindings; all logic in the composable. Step 2 (pick member) and step 3 (set password) markup stays as-is — wire to the composable's intent handlers. Step 1 simplifies dramatically: a single error block (driven by `currentError` via the registry), and a single Picker CTA.
- `src/services/google/drivePicker.ts` — `pickBeanpodFile` returns a discriminated union including `{ kind: 'failed', reason }`. Existing callers updated. Add the LOADED-watch + 3s threshold + 30s timeout logic in one place.
- `src/services/crypto/inviteService.ts` — refactor `buildInviteLink(token, familyId)` to `buildInviteLink(params: InviteLinkParams)`. Add `parseInviteLink(url)`. Update existing 2 call sites + 1 test file.
- `src/pages/MeetTheBeansPage.vue` — drop private `buildBaseJoinUrl` (~10 lines). Pass `member.email` to `generateInviteLink`. Use `buildInviteLink` from inviteService for both base and full URL forms.
- `src/services/translation/uiStrings.ts` — add ~24 keys: one `join.error.<code>` per JoinErrorCode (en + beanie); 5 `join.recovery.<action>` keys for the recovery action labels; revised file-not-found banner copy mentioning revoked-access.
- `src/App.vue` — import `getDeviceInfo` from new util; remove inline `getDeviceDiagnostics`. Existing template reference at `App.vue:935` updates to call the imported function.
- `src/components/google/SaveFailureBanner.vue` — uses revised translation key (no code change other than i18n).
- `CLAUDE.md` — add to Code Conventions: "**Cloud Auth UX:** When inviting a member or asking the user to authenticate to a cloud provider, pre-populate the account chooser via `loginHint` whenever the expected identity is known. Never pre-warn users that a flow might fail; surface friction only when failure is observed."

### Documentation (2)

- `docs/adr/024-join-flow-composable.md` — short ADR: rationale (testability + view size), the registry+`tryStep` pattern, why we chose `as const satisfies` over an enum, why we composed mismatch with file-load instead of a standalone code, what's NOT in scope (history capture, telemetry endpoint, generic `useFlow<T>`).
- `docs/E2E_HEALTH.md` — append: cross-browser test matrix verdicts; result of the iOS Storage Access API attempt (`worked` → keep + cite ADR; `didn't work` → removed).

### NOT building (explicit non-list to keep scope honest)

- Pre-flight capability banner — per greg, no upfront warnings. Removed from rev 2.
- `usePlatformCapabilities.ts` — `shouldUseRedirectAuth()` covers it.
- `Join/Expected/Mismatch/PickerError` Vue components — all use `ErrorBanner` directly.
- Custom error class hierarchy — flat registry suffices.
- State-machine history — current step + last error covers debugging value.
- Telemetry endpoint — user-pasted diagnostic blob is enough.
- "Load .beanpod from device" cloud-joiner fallback — would create an orphaned standalone copy.
- New Picker invocation in `JoinPodView` — reuse `usePickBeanpodFile.pick()`.
- New `info` severity on `ErrorBanner` — without the pre-flight banner, we don't need it.
- Standalone `OAUTH_ACCOUNT_MISMATCH` code — composed into `FILE_READ_FAILED` context.
- Multiple Picker error subcodes (API_KEY_INVALID, COOKIE_BLOCKED) — collapsed into `PICKER_FAILED` since we can't distinguish them.

## Phase Order (single-track, direct to main)

0. **Phase 0 — Picker CTA renders for `google_drive` regardless of `fileId`.** Today, `JoinPodView.vue:708` gates the orange "Choose your data file" CTA on `cloudLoadFailed && targetProvider === 'google_drive'`. When the URL has `p=google_drive` but no `fileId` (greg's diagnostic surfaced this), the CTA never appears. Fix: render the CTA whenever `targetProvider === 'google_drive'`. User-visible breakage; ships immediately, before any refactor.
   0.5. **Phase 0.5 — Restore popup OAuth on iOS regular Safari.** Narrow `shouldUseRedirectAuth()` (`src/services/google/googleAuth.ts:85`) so it only returns true for **standalone-display-mode** windows (the existing `matchMedia('(display-mode: standalone)').matches` and iOS legacy `navigator.standalone === true` branches), not for any iOS UA. Drop the unconditional `if (/iPhone|iPad|iPod/.test(ua)) return true` and the iPadOS-Macintosh-with-touch heuristic. Rationale: with the user-gesture deferral already in place (yesterday's same hotfix added `tryGetSilentToken` + button-tap-driven auth), iOS regular Safari allows popups, and popups don't introduce the ITP top-level navigation that breaks the Picker iframe. This is the most likely actual fix for the cookie/API-key chain greg's wife is hitting. Existing fallback in `JoinPodView.handlePickFromDrive` (catch "Popup blocked" → `startRedirectAuth`) is preserved as a safety net for any edge case where popups still fail. Tests update accordingly: existing `useGoogleReconnect.test.ts` "routes through startRedirectAuth on standalone PWAs" still passes; add a new test "uses popup on iOS regular Safari (non-standalone)" to lock the behavior in.
1. **Phase 1 — `inviteService` consolidation + `login_hint` plumbing.** Refactor `buildInviteLink` to object-param shape, add `parseInviteLink`, retire `MeetTheBeansPage.buildBaseJoinUrl`. Pass `member.email` through `generateInviteLink`. Joiner reads hint and forwards it to `requestAccessToken` / `startRedirectAuth`. High-value UX win flagged by greg; small surface; tests added to `inviteService.test.ts`.
2. **Phase 2 — `getDeviceInfo` extraction.** Pure refactor; updates `App.vue` and exposes the helper for the composable.
3. **Phase 3 — `useJoinFlow.ts`.** State machine + registry + `tryStep` + diagnostic helper + comprehensive unit tests. The composable is the load-bearing change; nothing else depends on its details once its public API is set.
4. **Phase 4 — `pickBeanpodFile` discriminated-union return** + `LOADED`/timeout heuristic for picker-failure detection. Update callers (`usePickBeanpodFile`, `JoinPodView` via composable).
5. **Phase 5 — `JoinPodView.vue` refactor to presentational.** Bind to composable, render error UI from registry, drop the local picker logic in favor of `usePickBeanpodFile`.
6. **Phase 6 — Translation keys** for every error + recovery + revised file-not-found banner copy. en + beanie. Run `npm run translate` to regen Chinese.
7. **Phase 7 — Diagnostic-copy modal** (`BaseModal` + `<pre>` + `useClipboard`). Wire to error screens.
8. **Phase 8 — `ShareInviteModal` as `tryAnotherDevice` recovery action.** Title override "Continue on another device". URL pre-filled from current join.
9. **Phase 9 — CLAUDE.md update + ADR-024.**
10. **Phase 10 — Manual cross-browser matrix** documented in `docs/E2E_HEALTH.md`.
11. **Phase 11 — iOS standalone-PWA Storage Access API workaround attempt (only if needed).** Phase 0.5 should fix the regular-Safari case. Standalone PWAs (and any other case where redirect is unavoidable) may still hit the Picker iframe failure. For those, attempt one code-level mitigation: hidden iframe to `docs.google.com` + `requestStorageAccess()` from the iframe (user gesture present from Picker tap) before opening the Picker. If grant + Picker works, ship it. If grant + Picker still fails OR grant is denied, **remove the workaround entirely** (don't keep dead code) — `PICKER_FAILED` with `tryAnotherDevice` recovery is the floor for that narrow case. ADR only on success.

## Verification

### Unit tests

#### `useJoinFlow.test.ts` (new)

1. **Happy path** — Pinia + mocked `usePickBeanpodFile`, `requestAccessToken`, `loadFromGoogleDrive`. Walk lookup → awaiting-auth → authenticating → picking → loading → pick-member → set-password → joining. Each transition asserted; `currentError` stays null throughout.
2. **One test per `JoinErrorCode`** — inject thrown error or failure-result at the right step, assert `currentError.code` matches, `currentStep` is preserved (not nuked), `currentError.context` includes the underlying error message.
3. **Mismatch hint composition** — load fails AND hint differs from actual: assert `FILE_READ_FAILED` context contains both `hintEmail` and `actualEmail`. Load succeeds AND hint differs: assert `currentError` stays null.
4. **`tryStep` contract** — returns value on success without mutating `currentError`; on throw sets `currentError` and returns `null`; never throws to callers.
5. **Registry exhaustiveness guard** — runtime: `Object.keys(JOIN_ERRORS).sort()` equals the sorted JoinErrorCode union extracted via a const-assertion helper.
6. **Recovery handlers** — `handleSignInDifferent` calls `usePickBeanpodFile.pick()` with `forceConsent: true`; `handleTryAnotherDevice` toggles `showShareModal` + builds URL via `buildInviteLink`; `handleRetry` re-fires the step that errored.
7. **Picker discriminated-union mapping** — `{ kind: 'failed', reason: 'iframe' }` → `PICKER_FAILED`; `'script'` → `PICKER_SCRIPT_LOAD_FAILED`; `'timeout'` → `PICKER_TIMEOUT`; `'cancelled'` → silent (no error set, step regressed to `awaiting-auth`).

#### `inviteService.test.ts` (extended)

8. **`buildInviteLink`/`parseInviteLink` round-trip** — every permutation (with/without token, fileId, fileName, inviteeEmail, both providers).
9. **`parseInviteLink` returns null** on missing `f` (familyId).
10. **Email base64 decode** handles malformed input without throwing — returns undefined for the field.
11. **Backwards compat** — `parseInviteLink` accepts URLs without `inviteeEmail` (legacy invites) and returns the field as undefined.

#### `drivePicker.test.ts` (new — none exists today)

12. **Discriminated-union mapping** — mock `gapi.load` and the picker callback. `Action.PICKED` → `{ kind: 'picked' }`. `Action.CANCEL` after `Action.LOADED` → `{ kind: 'cancelled' }`. `Action.CANCEL` without prior `Action.LOADED` AND within 3s of open → `{ kind: 'failed', reason: 'iframe' }`. No callback within 30s → `{ kind: 'failed', reason: 'timeout' }`. `script.onerror` → `{ kind: 'failed', reason: 'script' }`.

#### `googleAuth.test.ts` (existing — extend)

13. **`shouldUseRedirectAuth` returns false for iOS regular Safari (non-standalone)** — stub `navigator.userAgent` to an iPhone Safari UA; ensure neither `matchMedia('(display-mode: standalone)').matches` nor `navigator.standalone === true` returns true; assert `shouldUseRedirectAuth() === false`.
14. **`shouldUseRedirectAuth` returns true for iOS standalone PWA** — stub the same iPhone UA + `navigator.standalone = true`; assert true.
15. **`shouldUseRedirectAuth` returns true for Android standalone PWA** — stub Chrome Android UA + `matchMedia('(display-mode: standalone)').matches`; assert true.
16. **`shouldUseRedirectAuth` returns false for desktop browsers** — stub a desktop Chrome UA; assert false.

#### `useGoogleReconnect.test.ts` (existing — review)

17. The existing "routes through startRedirectAuth on standalone PWAs" test stays valid (mocks `shouldUseRedirectAuth` directly so behavior change in the implementation doesn't break it). Confirm it still passes; no edits needed unless the mock is replaced with the real function.

### E2E (Playwright, Chromium only — within ADR-007's 25-test budget)

One smoke happy-path: visit `/join?...` with mocked OAuth + mocked Drive + mocked Picker; assert the user reaches the pick-member step. Skip if the budget can't accommodate; unit tests + manual matrix carry the load per ADR-007.

### Manual cross-browser matrix

| Device / Browser    | Fresh first-load | Returning user | Picker iframe error | Wrong-account picked |
| ------------------- | ---------------- | -------------- | ------------------- | -------------------- |
| iOS Safari (latest) |                  |                |                     |                      |
| iOS Chrome          |                  |                |                     |                      |
| Android Chrome      |                  |                |                     |                      |
| Desktop Chrome      |                  |                |                     |                      |
| Desktop Firefox     |                  |                |                     |                      |
| Desktop Safari      |                  |                |                     |                      |

Verdict per cell: `works`, `works with caveat`, `needs different device`, `broken — bug filed`. Document each with one-sentence note in `docs/E2E_HEALTH.md`.

### Production verification (greg, on real devices, post-deploy)

1. **iPhone fresh after Phase 0.5** — clear cookies, open real invite URL on iPhone regular Safari (not standalone). Tap "Choose your data file". Expectation: Google chooser opens in popup, user signs in, popup closes, Picker iframe opens **without** a cookie-consent screen and **without** "API developer key invalid". File loads, user reaches pick-member step. This is the load-bearing test for Phase 0.5.
2. **iPhone standalone PWA** — install beanies.family to home screen. Open the same invite URL inside the PWA (not Safari tab). Phase 0.5 keeps redirect-auth here. Confirm the failure mode and that the user reaches a clear `PICKER_FAILED` screen with [Retry] [Sign in different account] [Try another device] recoveries.
3. **iPhone after Phase 11 (if shipped)** — repeat test 2; see if Storage Access workaround unblocks the Picker in standalone PWA.
4. **Multi-account check** — sign in to two Google accounts on Android Chrome. Tap a per-member invite link. Confirm Google's chooser is pre-populated with the invitee's email via `login_hint`.
5. **Wrong-account check** — sign in with a non-invited account. Confirm `FILE_READ_FAILED` shows hint vs actual emails clearly + suggests signing in with hint.
6. **Continue-on-another-device check** — open ShareInviteModal from an error, copy the link, paste into another browser, confirm join succeeds.
7. **Original-pod-owner recovery copy** — manually trigger the file-not-found banner; confirm new copy mentions revoked-access; confirm "Pick file from Drive" still works end-to-end.

## Acceptance criteria (drives done-or-not for issue #185)

- [ ] Phase 0: Picker CTA visible for any `google_drive` URL regardless of `fileId`.
- [ ] Phase 0.5: `shouldUseRedirectAuth()` only returns true for standalone PWAs; iOS regular Safari uses popup. Verified with new unit tests AND on a real iPhone (greg's wife's iPhone 17 first-load completes via popup; cookie/API-key chain does not appear).
- [ ] `useJoinFlow` owns all join logic; `JoinPodView.vue` is presentational; line count drops to ~400.
- [ ] `JOIN_ERRORS` registry exists with one entry per `JoinErrorCode`; TypeScript exhaustiveness via `as const satisfies`.
- [ ] `tryStep` is the only try/catch surface in the composable's calling code.
- [ ] `pickBeanpodFile` returns a discriminated union including a `failed` variant with reason.
- [ ] `buildInviteLink({...})` + `parseInviteLink` exist; `MeetTheBeansPage.buildBaseJoinUrl` is gone.
- [ ] Per-member invites embed the member's email; `JoinPodView` forwards it as `loginHint`.
- [ ] When file load fails AND hint ≠ actual, `FILE_READ_FAILED` context includes both emails and copy names them.
- [ ] When file load succeeds, no mismatch error fires (silent).
- [ ] Picker iframe failure (no LOADED + early CANCEL) maps to `PICKER_FAILED` with [Retry] [Sign in different account] [Try another device] recoveries.
- [ ] "Try another device" opens `ShareInviteModal` with the join URL pre-filled.
- [ ] Every error screen has a "Copy diagnostic info" link producing a JSON blob with device + step + error + email + timestamp.
- [ ] `App.vue` imports `getDeviceInfo` from `src/utils/diagnostics.ts`; no duplicate device code.
- [ ] CLAUDE.md has the Cloud Auth UX rule (loginHint + no pre-warning).
- [ ] ADR-024 committed.
- [ ] Phase 11 result documented (worked → kept; didn't work → removed cleanly).
- [ ] No regressions on Android Chrome / Desktop Chrome / Desktop Firefox / Desktop Safari.
- [ ] Greg's wife successfully joins from her iPhone, OR has a clear path to do so on another device.

## Out of Scope

- Drive UI integration via Workspace Marketplace — see `docs/plans/2026-04-26-drive-ui-integration.md` (#186).
- Switching to `drive.readonly` scope — privacy regression.
- Backend proxy architecture — incompatible with local-first model.
- `anyone-with-link` joiner sharing — confirmed unviable in rev 1.

---

## Appendix A — iPhone diagnostic results (greg, today)

Real invite URL on iPhone iOS 26.4.2:

1. Picker CTA appears (after Phase 0 understood).
2. OAuth → Google consent. **Wants `login_hint` pre-population** ← Phase 1.
3. After 2FA → "Allow Google access to your necessary cookies".
4. Allow cookies → "The API developer key is invalid." inside the Picker tab/popup.
5. Window title "There was an error!"; body just the API key error string.
6. Block-All-Cookies = OFF; Cross-Site Tracking Prevention = ON (default).
7. **iOS Chrome: same failure.** Confirms iOS-WebKit-wide.
8. Second attempt without clearing cookies → stuck "Can't access your Google account" screen with no in-app recovery.
9. Storage Access API = ON in Safari Experimental Features.
10. iOS / Safari version: 26.4.2.

**But:** the same flow worked for greg's wife on iPhone 17 a few weeks ago — when iOS regular Safari was using **popup**-based OAuth, before yesterday's hotfix forced all iOS through `startRedirectAuth`. The popup path doesn't introduce the ITP top-level navigation that breaks the Picker iframe. **Phase 0.5 reverts the iOS-UA branch in `shouldUseRedirectAuth()` and is the most likely fix for the cookie/API-key chain.** Storage Access API (Phase 11) only matters for standalone-PWA users, where redirect remains unavoidable.
