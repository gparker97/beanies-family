# ADR-024: Join-flow composable with structured error registry

> Status: Accepted
> Date: 2026-04-26
> Related: `docs/plans/2026-04-26-joiner-onboarding-hardening-rev3.md`, [#185](https://github.com/gparker97/beanies-family/issues/185)

## Context

`JoinPodView.vue` had grown to 1,155 lines mixing URL parsing, registry lookup, OAuth orchestration, Drive auto-load, Picker fallback, file decryption, member-pick, and password commit — all intertwined with template rendering and ad-hoc `formError.value = ...` strings. Every async failure mode was a one-off try/catch with a different copy and no recovery path: a 404 silently re-opened the Picker; an iOS WebKit Picker iframe failure surfaced as the literal string "API developer key is invalid"; a wrong-account failure surfaced no hint at all. Adding a new failure mode meant editing the view template, the script, the i18n strings, AND the catch sites.

The existing `googleAccountAssertion` subsystem (shipped 2026-04-26 morning) already handles post-join account drift, but it early-returns when there's no `currentUser.memberId` — the joiner has no member yet, so the assertion never runs during the join flow. The join flow needed its own structured error model, and the view needed to stop owning orchestration.

## Decision

The join flow is now a single composable, `src/composables/useJoinFlow.ts`, that owns all state and all async work. `JoinPodView.vue` is presentational: it binds reactive state, renders, and emits user intents (`handleAuthTap`, `handleSelectMember`, `handleSubmitPassword`, `handleSubmitDecryptPassword`, `clearError`).

Three load-bearing primitives inside the composable:

### 1. State machine

```ts
type JoinStep =
  | 'lookup'
  | 'awaiting-auth'
  | 'authenticating'
  | 'loading'
  | 'pick-member'
  | 'set-password'
  | 'joining';
```

Errors are **orthogonal to step** — `currentError` is a separate ref. The view checks `v-if="currentError"` first, otherwise renders the step UI. An error never invalidates the underlying step, so `handleRetry` can re-fire whatever produced the error without reconstructing prior state.

### 2. Error registry (single source of truth)

```ts
type JoinErrorCode =
  | 'OAUTH_REDIRECT_FAILED'
  | 'OAUTH_SCOPE_DENIED'
  | 'OAUTH_POPUP_BLOCKED'
  | 'PICKER_SCRIPT_LOAD_FAILED'
  | 'PICKER_FAILED'
  | 'PICKER_TIMEOUT'
  | 'FILE_READ_FAILED'
  | 'FILE_DECRYPT_FAILED'
  | 'FILE_FAMILY_MISMATCH'
  | 'INVITE_TOKEN_EXPIRED'
  | 'INVITE_TOKEN_INVALID'
  | 'NO_UNCLAIMED_MEMBERS';

const JOIN_ERRORS = {
  OAUTH_REDIRECT_FAILED: {
    messageKey: 'join.error.oauthRedirect',
    recoveries: ['retry', 'tryAnotherDevice'],
    severity: 'critical',
  },
  // ... one entry per code
} as const satisfies Record<JoinErrorCode, JoinErrorEntry>;
```

`as const satisfies` enforces compile-time exhaustiveness — adding a code without a registry entry fails the build. Each entry maps to one i18n message key + an ordered list of `RecoveryAction`s (rendered as buttons by the view) + a severity. The view does NOT branch on error codes; it looks up the registry entry and renders the message + buttons declaratively.

### 3. `tryStep` — single try/catch surface

```ts
async function tryStep<T>(code: JoinErrorCode, fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); }
  catch (err) {
    log(`step ${code} failed`, { err: ... });
    currentError.value = { code, context: { error: ... } };
    return null;
  }
}
```

Every async step is one line in the calling code. One log site, one error-set site, no scattered try/catch.

### Composition over standalone codes

Account-mismatch detection is composed with file-load, not a standalone code:

- Hint matches actual: silent.
- Hint missing: silent.
- Hint differs but file load succeeds: silent (the chosen account happens to have access — fine).
- Hint differs AND load fails: `FILE_READ_FAILED` with `context: { hintEmail, actualEmail }`. The i18n message names both emails so the user sees "Couldn't read with X. Invite was sent to Y — try signing in with that account." `signInDifferentAccount` is the first recovery button.

This composition means the user never sees a mismatch error when nothing's actually wrong. We never spam friction on a UX nudge.

### Picker failure detection

The Google Picker library only emits `LOADED | CANCEL | PICKED`. Iframe-internal errors aren't observable. `pickBeanpodFile` returns a discriminated union `{ kind: 'picked' | 'cancelled' | 'failed', reason?: 'script' | 'iframe' | 'timeout' }`:

- `LOADED` then `CANCEL` → `cancelled` (real user cancel, silent).
- `CANCEL` without prior `LOADED` → `failed/iframe` → `PICKER_FAILED` (the iOS WebKit "API key invalid" / cookie-consent symptom — the iframe couldn't bootstrap auth context across the storage-partitioning boundary).
- 30s with no callbacks → `failed/timeout` → `PICKER_TIMEOUT`.
- Script / library load failure → `failed/script` → `PICKER_SCRIPT_LOAD_FAILED`.

## Consequences

### Positive

- **View shrunk from 1,155 to ~440 lines.** All orchestration lives in the composable; the view is template + form state + simple bindings.
- **Comprehensive unit coverage.** 26 tests in `useJoinFlow.test.ts` exercise every state transition, every `JoinErrorCode`, the mismatch-composition logic, the discriminated-union mapping, and every recovery handler — without mounting Vue components.
- **Adding a new failure mode is a one-place change.** New `JoinErrorCode` → registry entry → i18n keys. The view picks it up automatically via the registry-driven render.
- **Compile-time exhaustiveness.** `as const satisfies` catches missing registry entries; `t(messageKey)` catches missing i18n keys.
- **One `tryStep` everywhere.** Adding instrumentation (logging, telemetry, structured logs) is one edit, not 12.

### Negative

- **One more layer of indirection.** Reading the join flow now requires understanding the state machine + registry + tryStep pattern, not just a top-to-bottom view file. Mitigated by exhaustive doc comments and the fact that the pattern is mechanical — once you've read it once, every other join-flow change follows the same shape.
- **Recovery actions are a closed set.** Adding a new recovery (e.g., "watch a help video") requires extending the `RecoveryAction` union and wiring a handler. Closed sets are intentional — open-ended recovery would push UX divergence back into individual error sites.

## Alternatives considered

### Generic `useFlow<T>` abstraction

Rejected. The join flow is the only multi-step flow in the app today; abstracting prematurely buys nothing and adds a layer of indirection. If a second consumer appears (e.g. a future "switch family" flow), revisit.

### Custom `JoinError` class hierarchy

Rejected. `instanceof` checks would scatter through the view; the flat registry suffices. TypeScript narrowing on the literal `code` union gives the same compile-time guarantees with less code.

### State-machine history capture (audit trail)

Rejected. Current step + last error covers ~95% of debugging value. The diagnostic-info JSON blob (copied to clipboard from the error screen) gives users a paste-back to support that's more useful than an in-app history.

### Telemetry endpoint for failure events

Deferred. User-pasted diagnostic blob is enough until proven insufficient. Adding telemetry has implications (consent, privacy, infrastructure) we don't need to take on yet.

### Standalone `OAUTH_ACCOUNT_MISMATCH` code

Rejected. As described above, compose mismatch with file-load instead. A standalone code would fire even when load succeeds, generating noise.

### Multiple Picker error subcodes (`API_KEY_INVALID`, `COOKIE_BLOCKED`, etc.)

Rejected. We can't programmatically distinguish them — they all surface as iframe errors with no callback hook. Collapse into `PICKER_FAILED` and let the i18n copy describe the symptom in plain language.

## References

- `src/composables/useJoinFlow.ts` — composable
- `src/composables/__tests__/useJoinFlow.test.ts` — test suite
- `src/components/login/JoinPodView.vue` — bindings
- `src/services/google/drivePicker.ts` — `PickBeanpodFileResult` discriminated union
- `src/composables/usePickBeanpodFile.ts` — Picker auth + invocation
- `src/services/translation/uiStrings.ts` — `join.error.<code>` and `join.recovery.<action>` keys
- ADR-008 — i18n architecture
- `docs/plans/2026-04-26-joiner-onboarding-hardening-rev3.md` — full plan, including iPhone diagnostic results that drove Phase 0.5 (popup OAuth on iOS regular Safari)
