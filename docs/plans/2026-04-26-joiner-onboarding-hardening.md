# Plan: Joiner Onboarding Hardening (Picker primary)

> Date: 2026-04-26
> Related issues: [#185](https://github.com/gparker97/beanies-family/issues/185); sister long-term track: [#186](https://github.com/gparker97/beanies-family/issues/186)
> Plan file: `docs/plans/2026-04-26-joiner-onboarding-hardening.md`

## User Story

As a family member joining a pod from any browser/device, I want clear actionable feedback at every step (and a working different-device fallback when my browser can't run the file picker), so I never get stuck on a confusing error or have to give up on the onboarding flow.

## Context

Multiple onboarding bugs surfaced during real-user testing on iPhone Safari over the last 24 hours:

1. **iOS Safari popup blocker** on auto-load OAuth — fixed in commit `a8f1a24` (added `shouldUseRedirectAuth()` + `tryGetSilentToken()`, route iOS through full-page redirect auth).
2. **"File not found" 404 after fileId-based auto-load** under `drive.file` scope — fixed in commit `7e4c70b` (auto-recovery via Picker on 404), but the auto-Picker step now triggers a different iOS issue.
3. **"All Google access to your necessary cookies" + "API developer key is invalid" screens** when Picker opens on iOS Safari post-redirect-auth — root cause is iOS Safari's Intelligent Tracking Prevention partitioning storage from `docs.google.com` once the page has navigated through `accounts.google.com` and back. The Picker iframe can't bootstrap. Not actually an API key problem.
4. **Sign-out hang when Drive is unresponsive** — fixed in commit `3a38f2c` (3s timeout on `flushPendingSave`).
5. **Original pod owner lost file access** — separate report, suspected environmental (file deleted/moved or OAuth grant revoked); not part of this plan.

The Picker is fundamentally fragile on iOS Safari due to ITP. We've ruled out:

- **Path B (anyone-with-link)** — confirmed unviable. `drive.file` scope doesn't grant write access without per-file consent; anyone-with-link reader lets the joiner read but not sync changes back. Anyone-with-link writer would let any URL holder write to the encrypted file (data-destruction attack vector).
- **Switching to broader OAuth scope (`drive.readonly`)** — privacy regression; the app would gain read access to all the user's Drive files, not just our own.
- **Backend proxy** — major architectural shift incompatible with the current local-first, serverless model.

We're committing to **Option 1: keep Picker as the primary path, harden everything around it**, with a clear different-device fallback for browsers where Picker doesn't work. Option 2 (Drive UI integration via Workspace Marketplace) is tracked as a separate parallel workstream — see `docs/plans/2026-04-26-drive-ui-integration.md`.

## Requirements

1. Diagnose the iOS Safari Picker failure deterministically before shipping any hardening code.
2. Pre-flight platform/capability detection on `/join` mount: warn iOS Safari users upfront with clear alternatives.
3. **Cloud auth UX rule (project-wide):** show the expected Google account email prominently before the user authenticates, and validate it after auth completes. Never let the user discover the wrong-account problem after the fact.
4. Every step in the join flow has explicit success/failure detection routed through a single error registry, with a specific user-facing message and a specific recovery action per error code.
5. Different-device fallback always reachable when Picker fails — reuse the existing `ShareInviteModal` (channels: email, copy, QR) so the user can resume on Chrome/Firefox/desktop/Android. Do **not** offer a "load .beanpod from device" fallback for cloud-storage joiners — it would create an orphaned standalone copy that can't sync back.
6. Diagnostic capture on failure (UA, browser version, current state, last error, last error context) with a "copy to clipboard" button on the error screen so users can hand it to support.
7. Test matrix executed across at least 5 browser/device combos with verdicts in `docs/E2E_HEALTH.md`.
8. No regression on desktop/Android Picker flows that work today.

## Important Notes & Caveats

- `drive.file` OAuth scope is fundamental to the security model — Picker grants per-file access; we can't remove it without architectural change.
- iOS Safari ITP is outside our control; some failures may be unfixable on iOS Safari specifically. **Acceptable worst case is "use a different device for first-load"** — once the user picks the file via Picker on any device with their Google account, the grant is recorded per-account-per-app, and their iPhone gets the grant for free on the next sign-in.
- Don't ship cosmetic error-UX changes without underlying detection improvements — every visible error message must correspond to a real distinguishable failure mode.
- Sign-out resilience already shipped in `3a38f2c`; not part of this plan.
- The "expected email" hint in the invite URL is plain (not hashed/obscured). Threat model is "if the QR/invite link leaks, the invite token is the bigger problem" — the email is mild PII at most. Plain-string approach decided 2026-04-26.

## Assumptions

> **Review these before implementation.**

1. The iOS Safari Picker failure is reproducible in current iOS Safari versions (greg tested 2026-04-25/26).
2. The Google Picker library API is stable enough that detecting load failures (script load error, callback fires with error action) is feasible.
3. The previous "Picker working on iPhone 17 a few weeks ago" was due to older iOS / different ITP behavior, not because our code was correct then.
4. Redirect-auth on iOS Safari is the right path (popup is blocked); not reverting that.
5. `drive.file` scope grants are per-Google-account-per-app (not per-device), so first-load on any device works as a fallback for the user's other devices.
6. `shareFileWithEmail` in the inviter flow does grant Drive UI visibility but does NOT grant `drive.file` API readability without an explicit Picker open. Confirmed via prior 404s on greg's wife's iPhone test.
7. `ErrorBanner.vue` can have a third severity (`'info'`) added without breaking existing call sites — currently `'critical' | 'warning'` with default `'critical'`.

## Approach

### Architecture: composable owns the flow, view binds

Extract all join-flow logic from `JoinPodView.vue` into a new composable `src/composables/useJoinFlow.ts`. The view becomes presentational — reads reactive state and renders. This:

- matches the project's MVO pattern (composable orchestrates, view binds);
- keeps `JoinPodView.vue` from growing past its current ~750 lines;
- makes the flow unit-testable without mounting Vue components;
- gives a single seam for changes (one file owns the state machine, error registry, logging convention).

### State machine

The composable exposes:

```ts
type JoinStep =
  | 'lookup'
  | 'awaiting-auth'
  | 'authenticating'
  | 'awaiting-load'
  | 'loading'
  | 'awaiting-pick'
  | 'picking'
  | 'loaded'
  | 'awaiting-member-pick'
  | 'awaiting-password'
  | 'joining';

interface JoinError {
  code: JoinErrorCode;
  context?: Record<string, unknown>;
}

const currentStep = ref<JoinStep>('lookup');
const currentError = ref<JoinError | null>(null);
```

Errors are **not** states — they're a separate orthogonal ref. The view checks `v-if="currentError"` first; renders the error block based on `currentError.code` via the registry; otherwise renders the happy-path step UI.

### Error registry (single source of truth)

```ts
type JoinErrorCode =
  | 'CAPABILITY_IOS_SAFARI'
  | 'OAUTH_POPUP_BLOCKED'
  | 'OAUTH_SCOPE_DENIED'
  | 'OAUTH_REDIRECT_FAILED'
  | 'OAUTH_ACCOUNT_MISMATCH'
  | 'AUTOLOAD_NOT_FOUND'
  | 'AUTOLOAD_NETWORK_FAILED'
  | 'PICKER_API_KEY_INVALID'
  | 'PICKER_COOKIE_BLOCKED'
  | 'PICKER_SCRIPT_LOAD_FAILED'
  | 'PICKER_CANCELLED'
  | 'PICKER_ZERO_RESULTS'
  | 'FILE_READ_FAILED'
  | 'FILE_DECRYPT_FAILED'
  | 'FILE_FAMILY_MISMATCH'
  | 'INVITE_TOKEN_EXPIRED'
  | 'INVITE_TOKEN_INVALID';

const JOIN_ERRORS: Record<JoinErrorCode, { messageKey: string; recoveryKey: string; severity: 'warning' | 'critical' }> = {
  CAPABILITY_IOS_SAFARI: { messageKey: 'join.error.iosSafari', recoveryKey: 'join.recovery.useDifferentDevice', severity: 'warning' },
  OAUTH_POPUP_BLOCKED: { messageKey: 'join.error.popupBlocked', recoveryKey: 'join.recovery.useDifferentDevice', severity: 'critical' },
  OAUTH_ACCOUNT_MISMATCH: { messageKey: 'join.error.accountMismatch', recoveryKey: 'join.recovery.signInDifferentAccount', severity: 'critical' },
  // ... one entry per code
} as const satisfies Record<JoinErrorCode, ...>;
```

`as const satisfies` gives compile-time exhaustiveness — if we add a new `JoinErrorCode` to the union and forget to add a registry entry, TypeScript fails the build. Single source of truth: error code → message → recovery → severity.

### Single try/catch helper

```ts
async function tryStep<T>(code: JoinErrorCode, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    log(`step ${code} failed`, { err: (err as Error).message, stack: (err as Error).stack });
    currentError.value = { code, context: { error: (err as Error).message } };
    return null;
  }
}
```

Every async operation in the join flow becomes one line:

```ts
const token = await tryStep('OAUTH_REDIRECT_FAILED', () => completeRedirectAuth());
if (!token) return; // error already set, view already updated
```

No nested try/catches scattered through the composable. Predictable behavior, single seam to log/instrument.

### Logging convention

```ts
const log = (msg: string, ctx?: Record<string, unknown>) =>
  console.warn(`[useJoinFlow] ${msg}`, ctx ?? {});
```

Single helper, used throughout the composable. All join-flow logs share the `[useJoinFlow]` prefix — easy to grep in production.

### Pre-flight capability check (no new composable)

In `useJoinFlow`'s init:

```ts
if (shouldUseRedirectAuth()) {
  capabilityWarning.value = 'CAPABILITY_IOS_SAFARI';
}
```

`shouldUseRedirectAuth()` already exists in `googleAuth.ts:62`. The view renders an `<ErrorBanner severity="warning">` at the top when `capabilityWarning` is set. Three lines, no new composable.

### Account-mismatch validation

After OAuth completes, compare `getGoogleAccountEmail()` (already exists at `googleAuth.ts:537`) against the parsed `expectedEmail` from the invite URL. If mismatched, set `currentError = { code: 'OAUTH_ACCOUNT_MISMATCH', context: { actual, expected } }`. The view renders an `<ErrorBanner severity="critical">` with the specific copy and a "Sign in with different account" recovery button.

### Inviter-side: include expected email in invite URL

Add an optional `inviteeEmail` parameter to `buildInviteLink` in `src/services/crypto/inviteService.ts`. Add a new exported `parseInviteLink(url: string): InviteParams` so URL format lives in one place — both inviter and joiner go through this single API. JoinPodView's current manual URL-param parsing in `onMounted` gets refactored to use `parseInviteLink`.

`MeetTheBeansPage.vue:243` `handleShareWithEmail` already knows the invitee's email at QR-generation time; pass it through to `buildInviteLink(token, familyId, { inviteeEmail })`.

The QR URL becomes: `/join?t=...&f=...&p=google_drive&fileId=...&hint=<base64-email>`.

### Different-device fallback (no new component)

Reuse `src/components/family/ShareInviteModal.vue` — it already has channels (WhatsApp/Telegram/SMS/Email/Copy) plus QR display via `qrCode.ts` + `InviteLinkCard.vue`. Open it with the current join URL pre-filled when the user hits an unrecoverable Picker error (or the iOS-Safari capability banner). Title becomes "Continue on another device".

### Diagnostic capture (no new component)

Extract `getDeviceDiagnostics` from `src/App.vue:637` into `src/utils/diagnostics.ts` as a shared utility. The composable composes it with current state + last error to produce a JSON blob:

```ts
function buildDiagnosticReport(): string {
  return JSON.stringify(
    {
      device: getDeviceInfo(), // from utils/diagnostics.ts
      step: currentStep.value,
      error: currentError.value,
      redirectAuth: shouldUseRedirectAuth(),
    },
    null,
    2
  );
}
```

Render in a plain `BaseModal` (no new modal class) with a `<pre>` block + a copy button using the existing `useClipboard()` composable. Single button on the error screen — "Copy diagnostic info" — opens the modal, user clicks Copy, modal shows "Copied ✓" feedback. No telemetry endpoint.

`App.vue` is updated to import `getDeviceInfo` from the new util instead of having its own private function.

### Severity addition to ErrorBanner

`ErrorBanner.vue:16-19` currently supports `severity: 'critical' | 'warning'`. Add `'info'` for the expected-account upfront banner. One-line type union expansion + add the appropriate icon/colour case in the template (slate background, info icon — matches brand). All existing call sites unaffected (default stays `'critical'`).

### Phase order

1. **Diagnose** the iOS Safari Picker failure. Bisect: is it post-redirect-auth specifically? does Picker work from a fresh user-gesture click? does `Storage Access API` request before Picker help? Test on iOS Safari 16, 17+, iOS Chrome. Document findings in `docs/E2E_HEALTH.md`. **Do not ship hardening code until this is understood.**
2. **Extract `useJoinFlow` composable.** Move all logic from `JoinPodView.vue` into it. Refactor view to be presentational. Ship behind a flag if needed; otherwise verify locally before merge.
3. **Define error registry + tryStep helper.** Introduce `JOIN_ERRORS` map and refactor every async call site to use `tryStep`. Wire up the `ErrorBanner`-based error UI.
4. **Inviter-side: invitee email in invite URL.** Add `inviteeEmail` param + `parseInviteLink`. Wire into `MeetTheBeansPage.vue`.
5. **Joiner-side: expected-account banner + post-auth validation.** Read hint from URL, show banner before auth, validate after.
6. **Different-device fallback.** Open `ShareInviteModal` from the error screen for capability/picker failures.
7. **Diagnostic capture.** Extract `getDeviceInfo` util, wire copy-to-clipboard button.
8. **Test matrix.** Execute on iOS Safari (16, 17+), iOS Chrome, Android Chrome, Desktop Chrome, Desktop Firefox, Desktop Safari. Document verdicts.
9. **CLAUDE.md update.** Add the cloud-auth UX rule. Add ADR documenting the composable + error-registry pattern.

## Files Affected

### New files (3)

- `src/composables/useJoinFlow.ts` — state machine, `JOIN_ERRORS` registry, `tryStep` helper, `log` helper.
- `src/composables/__tests__/useJoinFlow.test.ts` — state-transition + error-routing unit tests with mocked dependencies.
- `src/utils/diagnostics.ts` — extracted `getDeviceInfo()` from `App.vue:637`.

### Modified files (8)

- `src/components/login/JoinPodView.vue` — slim down to presentational, bind to `useJoinFlow`, render error UI via registry lookup.
- `src/components/common/ErrorBanner.vue` — add `'info'` to the severity union (~5 lines).
- `src/services/google/drivePicker.ts` — wrap each async step (script load, library load, callback) with detectable error codes; throw structured errors that `tryStep` can map.
- `src/services/translation/uiStrings.ts` — add ~20 new keys: `join.error.<code>` and `join.recovery.<code>` for each `JoinErrorCode` (en + beanie variants).
- `src/services/crypto/inviteService.ts` — add `inviteeEmail` to `buildInviteLink` opts; add new `parseInviteLink(url)` export.
- `src/pages/MeetTheBeansPage.vue` — pass invitee email to `buildInviteLink`.
- `src/App.vue` — import `getDeviceInfo` from new util instead of inline `getDeviceDiagnostics`.
- `CLAUDE.md` — add Cloud Auth UX Rule under Code Conventions.

### Documentation

- `docs/E2E_HEALTH.md` — Phase 1 diagnosis findings + Phase 8 test-matrix verdicts.
- `docs/adr/<next-num>-join-flow-composable.md` — ADR documenting the `useJoinFlow` + error-registry pattern (rationale, trade-offs, future extensibility).

### NOT building

- ~~`src/composables/usePlatformCapabilities.ts`~~ — `shouldUseRedirectAuth()` already covers what we need; defer abstraction until a second consumer appears.
- ~~`src/components/login/JoinDiagnosticPanel.vue`~~ — use `BaseModal` directly with `<pre>` + copy button.
- ~~`src/components/login/ExpectedAccountBanner.vue`~~ — use `ErrorBanner` directly with `severity="info"`.
- ~~`src/components/login/AccountMismatchBanner.vue`~~ — use `ErrorBanner` directly with `severity="critical"`.
- ~~Custom error class hierarchy~~ — flat registry map suffices.
- ~~State-machine-history capture~~ — current state + last error + last error context covers 95% of debugging value at 5% of the maintenance cost.
- ~~Telemetry endpoint for failure events~~ — defer until proven necessary; user-pasted diagnostic blob is sufficient for now.
- ~~"Load .beanpod from device" fallback for cloud joiners~~ — would create an orphaned standalone copy; unhelpful.

## Acceptance Criteria

- [ ] Phase 1 diagnosis findings documented in `docs/E2E_HEALTH.md` with reproducible cause + iOS Safari version tested
- [ ] `useJoinFlow` composable owns all join-flow state and logic; `JoinPodView.vue` is presentational
- [ ] `JOIN_ERRORS` registry exists with one entry per `JoinErrorCode`; TypeScript exhaustiveness check active
- [ ] Every async operation in the join flow is routed through `tryStep`; no scattered try/catch blocks remain in the composable's calling code
- [ ] Pre-flight capability banner shown on `/join` mount when `shouldUseRedirectAuth()` returns true
- [ ] Expected-account email banner shown prominently before OAuth tap on every cloud join
- [ ] Post-OAuth account-mismatch detection fires when `getGoogleAccountEmail() !== expectedEmail`, with specific recovery copy
- [ ] Each `JoinErrorCode` renders a specific message + recovery action via the registry — no `t('error.generic')` fallbacks
- [ ] "Continue on another device" path uses `ShareInviteModal` (no new component)
- [ ] "Copy diagnostic info" button on every error screen produces a JSON blob with device info + state + error
- [ ] `buildInviteLink` accepts optional `inviteeEmail`; `parseInviteLink` exists and is used by the joiner-side parser
- [ ] `App.vue` uses `getDeviceInfo` from `src/utils/diagnostics.ts`; no duplicated device-info code
- [ ] `ErrorBanner.vue` supports `severity: 'critical' | 'warning' | 'info'` with no breakage to existing call sites
- [ ] Unit tests cover all state transitions in `useJoinFlow` and round-trip `buildInviteLink`/`parseInviteLink` with all param combinations
- [ ] CLAUDE.md has the Cloud Auth UX Rule under Code Conventions
- [ ] ADR documenting the composable + error-registry pattern is committed
- [ ] Test matrix executed on at least 5 browser/device combos with verdicts in `docs/E2E_HEALTH.md`
- [ ] Greg's wife successfully joins from her iPhone, OR has a clear path on her current device (different-device fallback)
- [ ] No regressions on the desktop/Android Picker flow that works today

## Testing Plan

### Unit tests (in `useJoinFlow.test.ts`)

1. State-machine transitions for each happy-path step (mock `requestAccessToken`, `loadFromGoogleDrive`, `pickBeanpodFile`)
2. One test per `JoinErrorCode` — inject a thrown error, assert `currentError` is set with the expected code and `currentStep` is preserved
3. Account-mismatch validation: hint email differs from `getGoogleAccountEmail()` → `OAUTH_ACCOUNT_MISMATCH` set
4. Capability detection: when `shouldUseRedirectAuth()` is true → `capabilityWarning` set on init
5. `JOIN_ERRORS` registry exhaustiveness: programmatic check that every `JoinErrorCode` has an entry (covered by TypeScript + a runtime guard test)
6. `buildInviteLink`/`parseInviteLink` round-trip with all param combos including `inviteeEmail`

### E2E tests (Playwright)

1. Mounting `/join` with iOS Safari user-agent stub → expect capability banner visible
2. Mocked OAuth scope-denied response → expect `OAUTH_SCOPE_DENIED` error UI with specific recovery copy
3. Mocked Picker `cancelled` callback → expect `PICKER_CANCELLED` error UI with retry CTA
4. Successful end-to-end happy path on Chromium (smoke test, doesn't replace existing onboarding tests)

### Manual cross-browser matrix

Execute on a fresh browser profile (no cached state) and a returning profile (cached token):

| Device / Browser    | Fresh first-load | Returning user | Picker cancel mid-flow | Network drop mid-flow |
| ------------------- | ---------------- | -------------- | ---------------------- | --------------------- |
| iOS Safari (latest) |                  |                |                        |                       |
| iOS Safari (16)     |                  |                |                        |                       |
| iOS Chrome          |                  |                |                        |                       |
| Android Chrome      |                  |                |                        |                       |
| Desktop Chrome      |                  |                |                        |                       |
| Desktop Firefox     |                  |                |                        |                       |
| Desktop Safari      |                  |                |                        |                       |

Verdict per cell: `works`, `works with caveat`, `needs different device`, or `broken — bug filed`.

Document every cell in `docs/E2E_HEALTH.md`.

## Out of Scope

- Drive UI integration via Workspace Marketplace — see `docs/plans/2026-04-26-drive-ui-integration.md`.
- Switching OAuth scope to `drive.readonly` — privacy regression.
- Backend proxy architecture — incompatible with local-first model.
- `anyone-with-link` sharing approach — confirmed unviable for joiner write access.
- Recovery flow for the original-pod-owner-lost-file-access bug — separate report, suspected environmental.
