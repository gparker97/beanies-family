# Plan: Credential vocabulary and offer correctness

> Date: 2026-09-09
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-09-09-credential-vocabulary-and-offer-correctness.md`

> **No GitHub issue created.** This plan was approved for direct implementation.

## User Story

As someone signing in to my family on a new device, I want beanies to ask me for a credential that can actually open my family file, using one consistent word for each thing, so that I am never sent down a path that cannot succeed.

## Context

The 2026-08-28 login rethink (0.13R2) retired per-member passwords and replaced them with a per-member 6-digit PIN plus a family Recovery Kit. The crypto model that resulted is correct, but the UI, the copy and the help centre were never fully brought across. The result is a family created today can be offered a credential that is cryptographically incapable of opening their file.

**The credential model as actually built:**

| credential              | storage                                                                                                                         | scope                      | can open a cold file?                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------ |
| **PIN** (6-digit)       | `pinHash` in the encrypted doc (identity) + a `deviceSecret` HKDF wrap on **this device** (`src/services/auth/deviceUnlock.ts`) | per-member, **per-device** | **No, by design.** `authStore.joinFamily`: "NO envelope wrap is created" |
| **Recovery kit**        | `envelope.recoveryKeys[kitId]`                                                                                                  | family-wide                | Yes                                                                      |
| **Recovery passphrase** | `envelope.recoveryPassphrase`                                                                                                   | family-wide                | Yes                                                                      |
| **Password**            | `envelope.wrappedKeys[memberId]`                                                                                                | family-wide                | Yes, but **legacy only**                                                 |

A family created today is _kit-born_: `syncStore.ts:2833` states the envelope's "ONLY wrap at birth is the recovery kit's", so `wrappedKeys` is empty and a password can never succeed against it.

**The reported failure (greg, 2026-09-09).** A new family was created with a PIN. Signing in from a separate browser session asked for the recovery code and _also_ offered "use password instead". The PIN did not work there (correct: it is a device credential), and no password had ever been set. Setting a recovery passphrase in Settings and trying it on the other session produced `No wrapped keys in beanpod file — cannot unlock`.

### Root cause

**Two independent instances of one mistake.** The one the user hit lives on `LoadPodView`, the bootstrap surface a second session actually lands on: `handlePendingPassword` (`:360`) opens the kit form for a kit-born envelope, and the kit form's back button (`:1259-1264`) offers `t('passkey.usePassword')` **unconditionally**, with `handleDecrypt`'s failure rendering `result.error` raw (`:699`). A fresh browser session never reaches `ProveView` — `buildPeople` returns `null` with no roster cache (`useLoginFlow.ts:199`) and `LoginPage.vue:474-489` routes to the bootstrap surface.

The second instance is latent but identical in kind, and will fire the moment a device _does_ have a roster cache: `ensureStaged()` (`useLoginFlow.ts:425`) runs inside `runOpening`, so the prove screen resolves its method list without the envelope, and `proveMethods.ts:194`'s `envelopeHasPasswordWraps === false` is a **fail-open tri-state** where `null` means "offer it anyway".

The same missing-envelope fact explains the passphrase failure: `LoadPodView.autoLoadFile()` short-circuits on `hasPendingEncryptedFile` rather than re-reading.

**The fix is to stop caching the answer and start deriving it from the envelope the store is already holding — on both surfaces.**

## Requirements

### A. Correctness

1. A credential that cannot possibly open the current envelope MUST NOT be offered, decided from the envelope, never from a defaulted flag.
2. The envelope MUST be staged before the prove screen resolves its method list, and resolution MUST await that staging so a fast person-pick cannot race it.
3. When the envelope cannot be obtained, the code MUST fail **closed** for password/passphrase offers and MUST still offer the recovery route.
4. A recovery credential written on another device MUST be visible to a second session without clearing data.
5. No surface may present one input that names two credential concepts.
6. No behaviour change for legacy families: where `wrappedKeys` is non-empty, the password path works exactly as today.
7. **No raw crypto throw message may reach a render path.**

### B. Vocabulary

8. The recovery kit has exactly two user-facing names: **Recovery Kit** (the artifact) and **Recovery Code** (the code you type). "recovery key", "backup key", "master key" are removed.
9. Credential-facing "unlock" is disambiguated. The wall edit lock, invite gate and demo gate keep it (different domain).
10. "PIN" is spoken with its scope where the scope is load-bearing ("on this device").
11. `family.resetPassword.*` is consolidated into `family.resetPin.*`; every value settles on PIN.
12. Settings cross-references point at the panel name actually rendered. **No panel is renamed.**

### C. Documentation

13. `getting-started.ts` no longer teaches the retired password create flow.
14. `security.ts` keeps its slug (no redirect mechanism exists) and fixes title/body vocabulary only.
15. `how-it-works.ts:75` is reworded for families that never had a password.

### D. Hygiene

16. Genuinely unrendered legacy strings are deleted rather than translated.
17. The `'set-password'` join step is renamed to `'set-pin'` at its definition and every consumer.

## Sequencing

Three commits, in order. Each is independently shippable and independently revertible. The repo's history is uniformly single-concern; one change of this span could not be bisected, and a break in the string pass would strand the crypto fix behind it.

**Commit 1 — Correctness (A1-A3, A6, A7).** Steps 1, 2, 3, 3b, **the whole of Step 4's `LoadPodView` offer-suppression** (the kit-form back button gated on `caps.password`, `handlePendingPassword` keyed on `!caps.password`, and the degenerate terminal), plus `switchLabel`/template exhaustiveness in `ProveView.vue`. **The `LoadPodView` half is what closes the reported bug** — the `proveMethods` half closes the same bug on the surface a returning device reaches. They ship together because splitting them leaves one of the two "use password" dead-ends live. Tests 1, 2, 4, 7, 8, 9, 11.

**Commit 2 — Passphrase route (A4, A5).** The passphrase probe, the `ProveView` passphrase form, the `LoadPodView` re-read, `LoginPage`'s `:has-passphrase` deletion, and the `recovery.*` kit-vocabulary keys. Depends on commit 1's `CapabilityState` and `coldEnvelopeHas`. Tests 3, 10, 12.

**Commit 3 — Vocabulary, docs, hygiene (B, C, D).** The `family.resetPassword.*` consolidation, orphan deletions, the `'set-pin'` rename, three help articles, and Step 9. Zero behaviour change; the largest diff and the only one touching the translation pipeline, so it fails alone. Tests 5, 6.

**Why Step 9 rides in commit 3:** deleting `envelopeHasPasswordWraps` from `RosterCacheEntry` (`src/types/models.ts:172`) is a persisted-schema change. After commit 1 nothing reads it, so it is inert — leaving it inert for one release means commit 1 can be reverted without a cache migration.

## Important Notes & Caveats

- **`ensureStaged()` cannot be reused as-is for early staging.** It dispatches (`useLoginFlow.ts:433, 437, 443, 468, 478`), sets `proveError` (`:462`), calls `reportPayloadFailure` (`:463`), and mutates `stagedPayloadFailure` whose comment at `:427-429` says "Only one of the three callers reads and clears it". Called from person-select, its `OPEN_FAILED` reaches `transition()` in state `person-select`, hits `if (state.kind !== 'opening') return state;` (`loginFlow.ts:259`; the `prove` escape at `:250` does not cover it) and is **silently swallowed**, while poisoning `proveError` and `stagedPayloadFailure` for the later real attempt.
- **Capabilities must be derived, never cached.** A cached value needs a memo, two invalidation rules, a before/after comparison and a telemetry event to detect its own staleness. All of that is a consequence of caching, not of the requirement.
- **A failed stage must never be memoized.** `prove-loading` is re-entered on wrong-password (`loginFlow.ts:263-271`), on `RECOVERY_RETRY` with a null grant (`:286-295`, i.e. _right after the user reconnects Drive_), and from `onPinSubmit` (`useLoginFlow.ts:654, 670, 738`). Caching one transient failure would strip a legacy family's password offer for the whole session, and the reconnect panel that exists to fix it could not.
- **`loadFromFile()` mutates global store state** (`pendingEncryptedFile`) and **throws** the latched remote blocker (`syncStore.ts:1611`). An unawaited fetch for family A can resolve after a switch to family B. `useLoginFlow.ts:275-285` guards exactly this class; the new path must too, via a family tag.
- **`ProveView` renders ONE method at a time** (`ProveView.vue:5-7`). The passphrase becomes a **probe**, not a second input.
- **Views must not make credential-offer decisions** (`proveMethods.ts:2-7`: "no view, page, or store makes its own decision. The previous architecture had three disagreeing copies"). `LoginPage.vue:722`'s `:has-passphrase` is **deleted**, not replaced with a capability prop.
- **Two catch-alls both default to "password"**: `switchLabel`'s `default` returns `t('passkey.usePassword')` (`ProveView.vue:196-197`) and the template's `v-else` renders a password form (`:349`, whose own comment at `:336-341` already flags the hazard). Both become exhaustive rather than patched.
- **`ProveView` unmounts and remounts on every failed attempt** (`LoginPage.vue:713` `v-else-if`). Its mount-time `activeMethod` (`:70-77`) hardcodes `'password'` as the credential to restore after an error, which would bounce a passphrase user back to a password field.
- **Probes must stay free of telemetry** (`proveMethods.ts:211-213`: "Computed HERE, not inside a probe — probes stay free of telemetry per the module contract").
- **`transferOwnership.reauthNoCredential` is live**, passed as a string prop (`TransferOwnershipModal.vue:198` → `ReauthChallenge.vue:51`, consumed `:316`). Orphan checks must grep the **bare key string**, not `t('key')`.
- **`ResetMemberPinModal.vue:103` builds a key dynamically**. The rename must update that template literal, `:70`, `:106`, and the header comment at `:10`.
- ⚠️ **Never delete string keys by line range.** `auth.passwordRotation.savingLabel` sits at `uiStrings.ts:2239`, _between_ the `family.resetPassword.*` chrome keys, and is **live** (`ChangePasswordSettings.vue:131`). Deleting the range 2219-2242 would render a raw key on the password-change flow.
- **`envelopeNeedsRecovery` is the wrong predicate for "should I offer a password".** It returns **false** for an envelope with empty `wrappedKeys` _and no recovery material_ (pinned by `src/services/sync/__tests__/envelopeNeedsRecovery.test.ts`). `LoadPodView.vue:360` therefore falls through to a password form for that envelope. Offer sites key on `!caps.password`.
- **`recoveryPassphrase` merges newest-wins by `createdAt`** (`envelopeMerge.ts:88-96, 108-117`); a wrap lacking `createdAt` sorts **oldest**. Verify the writer stamps it.
- **`beanie` is optional** (`uiStrings.ts:29`); `BEANIE_STRINGS` is a strict subset (`uiStrings.test.ts:30-35`). The constraint is `uiStrings.test.ts:89-178`: where a `beanie` value exists on an important-surface key it must not introduce bean euphemisms. Carry existing values forward on every rename.
- **`family.resetPin.` is not in `IMPORTANT_PREFIXES`** (`uiStrings.test.ts:97`). Add it.
- **The translation script parses `uiStrings.ts` textually** (`docs/lessons.md:915`). A 20-key rename plus deletions is exactly the change class that lesson names — `npm run translate` round-tripping is a gate, not a checkbox.
- **Telemetry rides the existing facade.** `loginFlowEvents.ts:2-13`. `ALLOWED_CONTEXT_KEYS` is in `src/utils/diagnosticContext.ts:61` (not `logEvent.ts`), and `telemetryAllowlistDrift.test.ts:63-69` asserts **set equality** with `infrastructure/lambda/telemetry/index.mjs`. **No new keys are needed.**
- **`perfTiming.record(label, ms, {source})` will not type-check**: `PerfContext` (`perfTiming.ts:31-36`) admits only `perf_doc_bytes` and `perf_entity_count`. Use `measureAsync` (`:43`).
- Do NOT add a passphrase step to setup. Do NOT re-litigate offering both credentials.
- Every UI change is authored for light **and** dark mode, and at Large reading mode.

## Assumptions

1. Staging during person-select adds acceptable latency because the fetch overlaps with the picker. **If measurement shows it saves nothing meaningful, prefer awaiting the stage inside `startForFamily` before the `START` dispatch and deleting the tag and dedupe entirely** — `startForFamily` already awaits `tryTrustedAutoOpen` (`:288`), which itself calls `loadFromFile`, so a pre-picker await is established behaviour on this path.
2. A legacy family offline with no roster cache and no local pod cannot open their file anyway, so failing closed there costs them nothing they had.
3. The `ResetError` union (12 members) is the complete set of codes reaching `ResetMemberPinModal.vue:103`.
4. ~~Help slug change is safe~~ — **resolved**: no redirect mechanism exists and there are two internal inbound links. The slug is **kept**.

## Approach

### Step 1 — One derivation for "what can open this envelope"

In `src/services/sync/fileSync.ts`, beside `envelopeNeedsRecovery` (these are facts about a file):

```ts
export interface EnvelopeCapabilities {
  password: boolean; // legacy per-member wraps exist
  passphrase: boolean; // the family recovery passphrase wrap exists
  kit: boolean; // at least one recovery kit wrap exists
}

export function envelopeCapabilities(envelope: BeanpodFileV4): EnvelopeCapabilities {
  return {
    password: Object.keys(envelope.wrappedKeys ?? {}).length > 0,
    passphrase: !!envelope.recoveryPassphrase,
    kit: Object.keys(envelope.recoveryKeys ?? {}).length > 0,
  };
}
```

`envelopeNeedsRecovery` is re-expressed as `!c.password && (c.kit || c.passphrase)` so there is one derivation.

`CapabilityState` does **not** live here — `'not-staged' | 'stage-failed'` are login-flow staging outcomes, not facts about a beanpod file, and `fileSync.ts` is a 309-line pure format/crypto module (`:9-22` imports). Declare it in `src/services/auth/proveMethods.ts` beside `ProveContext`, its only reader:

```ts
export type CapabilityState =
  | { known: true; capabilities: EnvelopeCapabilities }
  | { known: false; reason: 'not-staged' | 'stage-failed' };
```

**Replaces the ad-hoc envelope reads at:** `familyStore.ts:127`, `useLoginFlow.ts:150`, `LoginPage.vue:722` (deleted outright), `LoadPodView.vue:118` (`hasRecoveryKits` → `caps.kit`), `RecoverySettings.vue:65` (→ `caps.passphrase`), `useLoginFlow.ts:837`.

`useLoginFlow.ts:168` is the roster-cache field, not an envelope read — deleted in Step 9. `LoadPodView.vue:162` (`pendingMemberCount`) is a display count; leave it. `syncStore.ts:5301`'s `envelopeNeedsRecovery` call **survives unchanged** — it is the sanctioned "kit-born label" use.

### Step 2 — Split staging; derive capabilities; never cache

**Split `ensureStaged()`** into a non-dispatching core and its existing wrapper. The core moves to **`src/services/auth/stagePendingFile.ts`**, not the composable — a service calling `useSyncStore()` is established here (`googleAccountAssertion.ts:32-33`), it makes the highest-risk new logic unit-testable, and it keeps a 1065-line composable from growing.

```ts
type StageOutcome =
  | { ok: true }
  | { ok: false; reason: Exclude<OpenFailReason, 'wrong-password'>; payload?: PayloadLoadError };

/** Pure I/O. Never dispatches, never writes proveError, never reports. */
export async function stagePendingFile(): Promise<StageOutcome>;
```

`stagePendingFile()` answers only "is there an envelope in reach now?" — it does not return one. `ensureStaged()` (`:430`) already treats _pod open_, _already staged_ and _just fetched_ as one `true`.

**The anti-drift constraint, stated so a reviewer can check it:** `stagePendingFile()` is the **only** function that touches `syncStore` on this path; `ensureStaged()` contains **no I/O and no branching on store state** — it is a pure translation of one `StageOutcome` into the side effects it has today. A new staging condition goes in the core and the wrapper gains one `case`. If the wrapper ever regrows a `syncStore.` reference, the split has failed.

`StageOutcome` must carry enough to reproduce today's behaviour exactly — the `reason` and the `PayloadLoadError` instance (needed by `payloadErrorKind`, `payloadErrorMessageKey` and `reportPayloadFailure`). `loadFromFile()` **throws** the latched blocker (`syncStore.ts:1611`), so the core's try/catch is mandatory, not defensive.

**Capabilities are derived, never cached:**

```ts
/**
 * Capabilities are DERIVED, never cached. The store holds exactly one envelope
 * — live when the pod is open, staged when it is not — so there is nothing to
 * invalidate and nothing that can go stale behind a re-read.
 *
 * ⚠️ FAMILY-CHECKED, and the check is a guard rather than an optimisation.
 * `loadFromFile()` mutates `pendingEncryptedFile` GLOBALLY, so an A-fetch that
 * resolves after a switch to B re-populates it AFTER `resetState()` has run.
 * The `stageInFlight` tag guards which promise is awaited; only this guards
 * which envelope is READ. Same class `rosterCache.ts:83` guards.
 */
function currentCapabilities(familyId: string): CapabilityState {
  const env = syncStore.envelope ?? syncStore.pendingEncryptedFile?.envelope;
  return env && env.familyId === familyId
    ? { known: true, capabilities: envelopeCapabilities(env) }
    : { known: false, reason: 'not-staged' };
}
```

Because the derivation follows the store, there is **no invalidation on family switch and none on leaving the flow** — `syncStore.resetState()` already nulls the envelope on switch.

**The staging dedupe is a closure local inside `useLoginFlow()`**, alongside `pendingPassword` (`:124`) and `stagedPayloadFailure` (`:106`) — never module-level. Nothing in this file has module lifetime and this must not be the first thing that does. It is tagged with its family because `startForFamily` is re-entrant from the picker:

```ts
/** Dedupe of the in-flight stage fetch. Tagged: family A's fetch must never be awaited as family B's. */
let stageInFlight: { familyId: string; promise: Promise<StageOutcome> } | null = null;
```

- `startForFamily`, after the successful `dispatch({type:'START'})` (`:293`), records `stageInFlight = { familyId, promise: stagePendingFile() }` without awaiting. **The tag is a guard, not an optimisation** — `loadFromFile()` mutates `pendingEncryptedFile` globally, so an A-fetch resolving after a switch to B must be discarded. The switch branch at `:277-285` clears `stageInFlight` for the same reason it clears the resident members.
- `runStateEffect`'s `prove-loading` branch (`:343`) awaits `stageInFlight.promise` **only when `stageInFlight.familyId === s.familyId`**, then reads `currentCapabilities(s.familyId)`. Otherwise it awaits nothing and reads directly.
- **Bound the await.** Wrap it in `raceTimeout` (`src/utils/timing.ts:57`, the codebase's one implementation) at the same 8s order as `POST_AUTH_SAVE_TIMEOUT_MS`. `loginFlow.ts:16-22` states the machine's core inversion — _prove first, then open_ — and a prove screen that blocks indefinitely on a Drive round-trip (`LoginPage.vue:463` documents 5-10s cold) inverts it. On timeout the outcome is `{ok:false, reason:'error'}`.
- **A failed stage produces the same state a failed stage produces today.** `ensureStaged()` already dispatches `OPEN_FAILED` for every `ok:false` reason when a credential is submitted; the stage failing _earlier_ does not mean something different, so it must not route somewhere different. After dispatching `METHODS_RESOLVED`, if the outcome was `ok:false`, dispatch `OPEN_FAILED` with its `reason` — `transition()` handles it from `prove` at `loginFlow.ts:250` with a null grant, so `RECOVERY_RETRY` re-enters `prove-loading` and re-stages. **This is what preserves A6**: a legacy family with a dead token lands on the reconnect panel one step earlier than today, not on a recovery terminal with their password silently withdrawn. The cold PIN and biometric paths lose nothing — both call `ensureStaged()` as their first act and would have failed identically.
- **A failed stage is never memoized, and the clear is identity-checked.** `stagePendingFile()` never rejects by contract; the assignment enforces it anyway:
  ```ts
  const entry = {
    familyId,
    promise: stagePendingFile().catch(() => ({ ok: false, reason: 'error' }) as StageOutcome),
  };
  stageInFlight = entry;
  void entry.promise.then((o) => {
    // Identity, not truthiness: a slow A-stage settling after B replaced the slot
    // must not clear B's entry — that is what makes the tag mean anything.
    if (!o.ok && stageInFlight === entry) stageInFlight = null;
  });
  ```
  The next `prove-loading` entry — exactly what `RECOVERY_RETRY` produces after a successful reconnect (`loginFlow.ts:286-295`) — then re-attempts. Only the in-flight window is deduped.

When the stage failed, no envelope landed and `currentCapabilities()` reports `not-staged` on its own; `stage-failed` survives only as the telemetry code carried out of the outcome, never as a second source of truth about capability.

### Step 3 — The prove engine consumes it

`ProveContext.envelopeHasPasswordWraps: boolean | null` becomes `envelope: CapabilityState` (non-optional, no default) so the compiler forces every construction site to supply it — the structural fix required by `docs/lessons.md`, not a patch of the `null` branch.

One helper above `PROBES`, so the fail-closed rule exists exactly once:

```ts
/**
 * Cold-path capability gate. A credential is offered from cold ONLY when the
 * envelope PROVES it can work. Unknown fails CLOSED — the `recovery` terminal
 * covers it, and an offer that cannot succeed is worse than one absent.
 * Warm (podOpen) never asks: the caller already has the doc.
 */
function coldEnvelopeHas(ctx: ProveContext, cap: keyof EnvelopeCapabilities): boolean {
  return ctx.envelope.known && ctx.envelope.capabilities[cap];
}
```

```ts
// password
run: async (ctx) => {
  if (ctx.hasPassword === false) return null;
  if (ctx.podOpen) return ctx.hasPin === true ? null : { kind: 'password' };
  return coldEnvelopeHas(ctx, 'password') ? { kind: 'password' } : null;
},
```

```ts
// passphrase — family-wide, cold only. Identifies no member: decryptPendingFile
// returns `viaRecoveryPassphrase` and runOpening routes that to recoveryMode
// (useLoginFlow.ts:852-871).
run: async (ctx) =>
  !ctx.podOpen && coldEnvelopeHas(ctx, 'passphrase') ? { kind: 'passphrase' } : null,
```

Add `| { kind: 'passphrase' }` to `ProveMethod` (`src/services/auth/loginFlow.ts`). The `recovery` terminal is appended outside the probe loop (`proveMethods.ts:243`), so the never-blank guarantee survives both fail-closed branches.

**Declare the ordering contract** in the `PROBES` header, because `ProveView` depends on it and nothing currently says so:

```
⚠️ ARRAY ORDER IS THE OFFER ORDER. ProveView renders the first non-recovery
entry as the active pane (ProveView.vue:70) and the rest as switch links in
this order (:159-166). Reordering this array is a UI change, not a refactor.
```

### Step 3b — No raw crypto message reaches a user

`syncStore.decryptPendingFile` returns the **raw English throw message** (`syncStore.ts:2304`; only `'Incorrect password'` is special-cased at `:2301`), rendered verbatim at `useLoginFlow.ts:918` and `LoadPodView.vue:699`.

⚠️ **The new error must NOT live in `types/sync.ts` and must NOT implement `RemoteBlocker`.** `isRemoteBlocker` is a **duck-type** on `blockCode` + `inlineMessageKey` (`types/sync.ts:282-284`), and `decryptPendingFile` tests it **before** the credential check (`syncStore.ts:2297-2304`). An error carrying those two fields would make a **single wrong password latch the session breaker** via `notePodUnopenable`, and `LoadPodView.vue:696-697` would set `podUnopenableHere = true`, so the password form never reopens for the rest of the session. A typo would dead-end the login screen.

- Add ONE typed error in `src/services/sync/fileSync.ts` — it is a fact about unwrapping a file, not a remote blocker, and it must not sit next to `RemoteBlocker` where the next reader will make it one:
  ```ts
  /**
   * ⚠️ MUST NOT implement `RemoteBlocker`, and MUST NOT carry `blockCode` or
   * `inlineMessageKey`. `isRemoteBlocker` (types/sync.ts:282) duck-types on exactly
   * those two fields, and `decryptPendingFile` (syncStore.ts:2297) tests it BEFORE
   * the credential check — a wrong password would latch the session breaker and
   * `LoadPodView`'s `podUnopenableHere`, so the form never reopens. The field is
   * deliberately named `messageKey`, NOT `inlineMessageKey`.
   */
  export class UnlockFailedError extends Error {
    constructor(
      readonly reason: 'no-candidates' | 'incorrect-secret',
      readonly messageKey: UIStringKey
    ) {
      super(reason);
      this.name = 'UnlockFailedError';
    }
  }
  ```
- `fileSync.ts:235` throws `new UnlockFailedError('no-candidates', 'loginFlow.recoveryOnlyBody')`; `:260` throws `new UnlockFailedError('incorrect-secret', 'password.decryptionError')`.
- **A unit test asserting `isRemoteBlocker(new UnlockFailedError(...)) === false`. That assertion is the whole guard.**
- `decryptPendingFile` gains an **additional** field, `errorKey?: UIStringKey`, set from `e instanceof UnlockFailedError ? e.messageKey : undefined`. **`error` keeps its current developer-facing string and its `'Incorrect password'` literal** — three live consumers depend on it and none renders it: `syncStore.ts:5347`, `SettingsPage.vue:1042` (whose comment pins the literal: "which `decryptPendingFile` reports by that exact literal"), and `useJoinFlow.ts:851`. Adding a field beats repurposing one: nothing needs re-verifying, and the two render paths become explicit.
- `useLoginFlow.ts:918` and `LoadPodView.vue:699` become `t(dec.errorKey ?? 'password.decryptionError')`. Those are the only two sites that render `error`.

Acceptance: `grep -n "No wrapped keys" src/` returns only the throw site and comments.

### Step 4 — Re-read the envelope on the recovery route

Bug 2 lives in `LoadPodView.autoLoadFile()` (`:378`), whose first branch short-circuits on `hasPendingEncryptedFile`.

- Re-read before `handlePendingPassword`, but **only when the configured handle points at the same family** — `syncStore.pendingEncryptedFile?.envelope?.familyId === familyContextStore.activeFamilyId`. The short-circuit exists because the configured handle "may still point to the previous family's file" (`:384-386`) — the same cross-family class `useLoginFlow.ts:275-285` guards. Do not delete the reason along with the branch. When the familyIds differ, keep today's short-circuit and note it in the diagnostic.
- On re-read failure keep the existing pending file and continue (offline must still reach the kit form): try/catch (`loadFromFile()` throws the latched blocker), emit the diagnostic, never silent, never a blank screen.
- Emit `caps_changed` when the re-read changes the answer — **a diagnostic, not a correctness mechanism** (the derivation reflects the re-read automatically).
- **Verified, no change needed**: `authStore.ts:1803` stamps `createdAt: toISODateString(new Date())`, so `pickNewerPassphrase` (`envelopeMerge.ts:108-117`) sorts it correctly, and `syncNowBounded()` publishes unconditionally so the wrap does reach the remote.
- **Define the degenerate terminal.** An envelope with `{password:false, passphrase:false, kit:false}` cannot be opened by any credential. `handlePendingPassword` must render the honest "this file cannot be opened on this device" message (`loginFlow.recoveryOnlyBody`), **not** the kit form — a Recovery Code field over an envelope with no kit wraps is the same impossible offer relocated. Only reachable from a hand-edited or truncated file (kit-born families always carry a kit at birth, `syncStore.ts:2833`), which is exactly why nothing currently handles it.

**Fix the sibling dead-end on the same surface.** `LoadPodView.vue:1259-1262`'s kit-form back button is labelled `t('passkey.usePassword')` unconditionally — bug 1 again, on the surface the recovery route lands on. Gate it on `caps.password`; when `caps.passphrase && !caps.password`, render a passphrase form instead. Today a passphrase-only family is routed to `showKitEntry` by `envelopeNeedsRecovery` (`:360`), asked for a Recovery Code it does not have, and can only get in by pressing "Use password" and typing a passphrase into a field labelled "Password" — verbatim the reported confusion.

### Step 5 — View changes

`src/components/login/ProveView.vue`:

1. Add a `v-else-if="activeMethod === 'passphrase'"` form, structurally identical to the password form at `:349-364`, with `:label="t('recovery.passphraseLabel')"` and **its own empty-field message** (`recovery.passphraseRequired`, new). `handleSubmit`'s `t('auth.enterPassword')` (`:206`) must not be reused, or the passphrase form says "Enter your password" — verbatim requirement 5.

   It emits the existing `password` event **with an explicit kind**: widen to `password: [value: string, kind: 'password' | 'passphrase']`. `onPasswordSubmit(value, kind)` stores the kind alongside `pendingPassword` (`:124-126`) and passes it as `method` to the four `emitProveOutcome` calls on the password route (`:840, :863, :919, :932`). Without this, passphrase attempts are indistinguishable from legacy-password attempts in the funnel the acceptance criteria depend on. One extra argument; no new handler, no new store action, no new machine event.

2. Make `switchLabel` **exhaustive over `ActiveKind`**, not just over the offered kinds. `ActiveKind` is `MethodKind | 'reset-pin'` (`ProveView.vue:69`) and includes `'invite-needed'`, which today's `default` covers alongside `'password'` — removing `default` without a `case 'invite-needed':` is a type error. So: explicit `case 'password':`, `case 'passphrase':` (label `t('recovery.passphraseSet')`) and `case 'invite-needed':` (unreachable at runtime, filtered by `NON_SWITCHABLE` at `:151-156`, but present in the union so the compiler requires it — return `t('loginFlow.inviteNeededBody')` and note why it cannot render). Replace `default:` with `const _exhaustive: never = method;`, so the next method kind is a **compile error** rather than a mislabelled "Use password" link.

   Commit 1 introduces the `'passphrase'` kind for exhaustiveness before commit 2 introduces the form; the label key is named here so the two commits agree.

   Do the same in the template: turn the `v-else` password form (`:349`) into `v-else-if="activeMethod === 'password'"`. An unhandled kind then renders no pane, and the always-present `RecoveryKitLink` (`:382-384`) still guarantees a way forward. Blank-and-recoverable is the fail-closed direction; a password form that cannot work is not.

3. Delete the `hasPassphrase` prop (`:41`, `:357-359`) and the `recovery.passphraseHint` string.

4. Generalise the mount-time active method (`:70-77`). Today's rule hardcodes `'password'` as the credential to restore after an error, so a legacy family with both wraps who mistypes a passphrase is bounced back to the **password** form with the passphrase error above it.

   Add `lastAttempted: Ref<'password' | 'passphrase' | null>` to the `UseLoginFlow` interface (`:56-88`) — a **`ref`, not a closure local**, because `LoginPage.vue` must bind it as a prop and has no other route to it. Set by `onPasswordSubmit(value, kind)`, cleared alongside `pendingPassword`. `ProveView` restores `lastAttempted` when it is still in `props.methods`, falling back to today's rule otherwise (which covers the passphrase-accepted round trip at `useLoginFlow.ts:852-871`, where the pod is now open and the passphrase is correctly no longer offered).

   The passphrase form binds its **own** `passphrase` ref and its own submit handler — sharing `password` (`:190`) would carry a typed secret across a form switch and re-emit it under the wrong kind.

`src/pages/LoginPage.vue`: delete the `:has-passphrase` binding (`:722`). One prop removed beats one prop added.

### Step 6 — Vocabulary pass in `uiStrings.ts`

- **Kit naming**: `recovery.resetPinBody` "recovery key" → "recovery kit"; `recovery.kitDescription` "backup key" → "recovery kit"; `recovery.kitPromptBody` "master key" → "recovery kit". `recovery.kitCodeLabel` stays "Recovery Code".
- **Reset-PIN consolidation**: move the **12** `ResetError`-union keys plus `unexpected` (13 total) from `family.resetPassword.error.*` to `family.resetPin.error.*`; reword `updateFailed`/`saveFailed`/`noConnection` to say PIN; **delete** `family.resetPassword.error.required` and `.mismatch` (0 references; the modal uses `pin.invalidFormat`/`pin.mismatch` at `:74,:78`); **delete the 5 duplicate non-error keys BY NAME, never by line range** — `family.resetPassword.modalTitle`, `.modalDescription`, `.warning`, `.submit`, `.success`. ⚠️ `auth.passwordRotation.savingLabel` sits between them at `:2239` and is live (`ChangePasswordSettings.vue:131`). Update `ResetMemberPinModal.vue` `:10`, `:70`, `:103`, `:106`. Add `family.resetPin.` to `IMPORTANT_PREFIXES`.
- **Settings cross-references** (no panel renamed): `reauth.noCredential` (`:2337`) "Settings → Security" → "Settings → **Account & Sign-In**" (PIN/password live at `SettingsPage.vue:2204-2205`); `transferOwnership.reauthNoCredential` (`:2424`) same (passkeys at `:2206`). **`cannotResetSelf` needs no text change** — `uiStrings.ts:2260` already reads "Change your own PIN from Settings → Account & Sign-In."; it only moves namespace. Add `settings.security` (`:3539`, 0 references) to the deletion list.
- **Join flow**: `join.setPasswordTitle`/`Subtitle` → `join.setPinTitle`/`Subtitle`; step `'set-password'` → `'set-pin'` at its definition (`useJoinFlow.ts:57`, assigned `:864`, `:891`) and in `JoinPodView.vue` (`:258`, `:620`).
- **"unlock"**: disambiguate credential-facing uses (`resumeSetup.unlockPod`, `recovery.unlock`, `loginV6.howThisWorks.bullet1`, `password.decryptionError`, `security.ts:250`). Leave `wall.lock.*`, `inviteGate.unlock`, `reviewDemo.unlock`.

### Step 7 — Delete verified-orphan strings

Re-derived at implementation time, not trusted from a prior conversation. Per candidate:

1. `grep -rn "<bare.key.string>" src/ e2e/ scripts/` — bare string, **not** `t('key')`. This is what caught `transferOwnership.reauthNoCredential`.
2. Check dynamic construction (`ResetMemberPinModal.vue:103`; `ReauthChallenge.vue:51` takes a `UIStringKey` prop). A key can be live with zero literal occurrences; candidates under a dynamically-assembled namespace are retained by default.
3. Record the final list in this plan file before deleting, so the diff is reviewable.

Confirmed on the list: `family.resetPassword.error.required`, `.mismatch`, the 5 duplicate chrome keys, `settings.security`, `recovery.passphraseHint`. Confirmed **not** on it: `transferOwnership.reauthNoCredential`, `passkey.errNotSupported`, `biometric.errGeneric`, `auth.passwordRotation.savingLabel`.

### Step 8 — Help centre

- `getting-started.ts`: rewrite the create flow (~9, ~39, ~47-48), invite step (~99), new-device step (~237), migration line (~265), mobile-install step (~558). Must state that the PIN works on devices where the family is already set up, and the recovery kit is what gets you in on a brand-new device — that distinction is the whole reported bug.
- `security.ts`: **keep the `password-recovery` slug** (no redirect mechanism; two internal inbound links at `:250`, `:558`; the slug never renders). Fix title/body vocabulary only, including `:250`'s "unlocked".
- `how-it-works.ts:75`: reword "Do not re-enter a password; this is not a password problem".

### Step 9 — Delete the cache that lies

- Delete the `envelopeHasPasswordWraps` parameter (`rosterCache.ts:44-52`) and its preservation block (`:66-73`), the field on `RosterCacheEntry` (`src/types/models.ts:172`), and the `familyStore.ts:120-131` watcher block — which also removes the bare `catch { /* leave unknown */ }` at `:128-130`, a genuine silent failure.
- Delete the ref (`useLoginFlow.ts:140`) and its three assignments (`:150`, `:168`, `:186`). `buildPeople` stops carrying credential capability entirely.
- Update `src/services/auth/__tests__/rosterCache.test.ts`.

## Files Affected

**Crypto / logic**

- `src/services/sync/fileSync.ts` — `EnvelopeCapabilities`, `envelopeCapabilities()`; re-express `envelopeNeedsRecovery`; typed throws
- ~~`src/types/sync.ts`~~ — **deliberately untouched**: `UnlockFailedError` lives in `fileSync.ts` so `isRemoteBlocker` cannot duck-type it
- `src/services/auth/stagePendingFile.ts` — **new**, the non-dispatching staging core
- `src/services/auth/proveMethods.ts` — `CapabilityState`, `ProveContext.envelope`, `coldEnvelopeHas`, both probes, ordering contract
- `src/services/auth/loginFlow.ts` — `ProveMethod` gains `passphrase`
- `src/composables/useLoginFlow.ts` — wrapper split, `currentCapabilities`, tagged `stageInFlight`, typed error rendering, prove-outcome kind
- `src/composables/useJoinFlow.ts` — `'set-password'` → `'set-pin'` (`:57`, `:864`, `:891`)
- `src/stores/syncStore.ts` — return message keys, not raw strings (`:2301-2304`, `:5347`)
- `src/stores/familyStore.ts` — drop the watcher block (`:120-131`)
- `src/services/auth/rosterCache.ts`, `src/types/models.ts` — delete `envelopeHasPasswordWraps`
- `src/services/telemetry/loginFlowEvents.ts` — two new emitters + fields on the existing resolved event

**Views**

- `src/components/login/ProveView.vue`, `LoadPodView.vue`, `JoinPodView.vue`, `src/pages/LoginPage.vue`, `src/components/family/ResetMemberPinModal.vue`, `src/components/settings/RecoverySettings.vue`

**Strings / docs**

- `src/services/translation/uiStrings.ts`, `src/content/help/getting-started.ts`, `security.ts`, `how-it-works.ts`, generated locale files (`npm run translate`)

**Tests**

- `src/services/auth/__tests__/proveMethods.test.ts`
- `src/services/auth/__tests__/stagePendingFile.test.ts` — **new**
- `src/services/sync/__tests__/envelopeNeedsRecovery.test.ts` (has the fixtures already)
- `src/services/sync/fileSync.test.ts`
- `src/services/translation/uiStrings.test.ts`
- `src/services/auth/__tests__/rosterCache.test.ts`
- `src/composables/__tests__/useJoinFlow.test.ts` (asserts `'set-password'` at `:844`, `:851`, `:868`, `:878`)
- `src/stores/__tests__/syncStore.resume.test.ts` (`:401` pins the throw message)

> There is no `useLoginFlow.test.ts` today. Rather than stand one up for a 1065-line composable, the new logic is placed where it is already testable: `envelopeCapabilities` and the resolution order are pure (`fileSync` tests), the probes are pure (`proveMethods` tests), and `stagePendingFile` is a service with its own test using the established store-mock idiom (`src/composables/__tests__/useBiometricSignIn.test.ts:5-25`). What remains in the composable is the wrapper's side-effect translation and the tagged await.

## Help Center Coverage

- **Action**: `update existing` · **Category**: `getting-started` · **Slug**: `creating-your-first-pod`
  **Scope**: Rewrite for the PIN + recovery kit reality; there is no password. **Notes**: must state that the PIN works on devices where the family is already set up, and the recovery kit is what gets you in on a brand-new device.
- **Action**: `update existing` · **Category**: `security` · **Slug**: `password-recovery` (**retained**)
  **Scope**: Settle kit vocabulary; drop "master key"/"backup key". **Notes**: strengthen "What about passwords?" — a password prompt simply will not appear for new families.
- **Action**: `update existing` · **Category**: `how-it-works` · **Slug**: the article containing line 75
  **Scope**: Reword the "do not re-enter a password" line for families that never had one.

## Observability Coverage

All events are added as typed functions in `src/services/telemetry/loginFlowEvents.ts`, riding only the already-allowlisted `action` / `kind` / `detail` / `error_code` keys. **No `ALLOWED_CONTEXT_KEYS` change, no Lambda mirror change, no `PrivacyInfo.xcprivacy` / Data-Safety / `privacy.astro` / `native-store-submission.md` change.** That is the stated contract of this surface (`loginFlowEvents.ts:2-13`), not a shortcut.

**Two new emitters, not four.** Suppression and capability facts fold into the **existing** `prove_methods_resolved` event, which already fires once per resolution and already concatenates `+prf-withheld` into `detail`:

| event                                             | level  | context                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `prove_methods_resolved` (**existing, extended**) | `info` | `detail:` gains `+suppressed:password` / `+suppressed:passphrase` and `+caps:known                                                                                                                                                                                                                                                                                             | unknown` |
| `envelope_capabilities_unknown` (**new**)         | `warn` | `action:'caps_unknown'`, `error_code:` `'not-staged'` \| `'stage-failed'`                                                                                                                                                                                                                                                                                                      |
| `envelope_capabilities_changed` (**new**)         | `warn` | `action:'caps_changed'`, `detail:` `` `${enc(before)}->${enc(after)}` `` where `enc({password,passphrase,kit}) = ` + "`p${+password}f${+passphrase}k${+kit}`" + `— **three booleans, nothing else**. No kit ids, no member ids, no family id, no counts.`detail` is unstructured and this surface fires pre-auth, so the encoding is fixed here and cannot grow a field later. |

**Suppression is derived after the probe loop in `resolveProveMethods`, never emitted from a probe** — probes stay free of telemetry (`proveMethods.ts:211-213`), same as `prfWithheld`. It is a function of `ctx` and the resolved list: `!ctx.podOpen && !methods.some(m => m.kind === 'password')` is a password suppression, likewise passphrase.

**Failure modes covered**

- _A user is offered an impossible credential_ — `prove_methods_resolved` records the resolved list, the suppressions and whether capabilities were known, in one event per resolution. Non-zero suppression alongside zero "No wrapped keys" throws is the fix working.
- _Staging failed so we could not decide_ — `caps_unknown` with `error_code` distinguishing "never tried" from "tried and failed". Without it the fail-closed path is invisible and looks identical to a family that genuinely has no password.
- _A credential written elsewhere is not seen_ — `caps_changed` fires when the re-read changes the answer.
- _Staging earlier costs latency_ — `perfTiming.measureAsync` wrapping `stagePendingFile()` (not `record(..., {source})`, which will not type-check).

**Success-path signal.** `prove_methods_resolved` already fires on every resolution, giving suppression and unknown rates a denominator without a new event.

**Critical vs telemetry.** None warrant `severity: 'critical'` — no user action has failed and no data is at risk when they fire; the recovery route remains.

## Acceptance Criteria

- [ ] A kit-born family on a fresh session is **never** offered a password
- [ ] A legacy family (non-empty `wrappedKeys`) is still offered its password, cold and warm
- [ ] A transient stage failure does not strip a legacy family's password offer for the session — the next `prove-loading` re-attempts
- [ ] A stage started for family A is never awaited as family B's
- [ ] Family A's staged envelope is never **read** as family B's capabilities
- [ ] `isRemoteBlocker(new UnlockFailedError(...)) === false` — a wrong password never latches the session breaker
- [ ] `decryptPendingFile().error` keeps its `'Incorrect password'` literal; Settings' restore-from-file still distinguishes a wrong password
- [ ] A legacy family with a dead Drive token still reaches the reconnect panel, not a recovery terminal with its password withdrawn
- [ ] An all-false envelope resolves to the degenerate terminal, never the kit form
- [ ] The prove-loading stage await is bounded by `raceTimeout`
- [ ] A passphrase set on device A is accepted on device B without clearing data
- [ ] A passphrase-only family reaching the recovery route is asked for a **passphrase**, never a Recovery Code or a "Password" field
- [ ] A failed passphrase attempt returns to the **passphrase** form, not the password form
- [ ] Passphrase attempts are distinguishable from password attempts in the prove funnel
- [ ] `ensureStaged()` retains its exact dispatching behaviour and contains no `syncStore.` reference
- [ ] `switchLabel` and the ProveView template are exhaustive — a new method kind is a compile error, not a "Use password" link
- [ ] No raw crypto throw message reaches any render path
- [ ] `family.resetPassword.*` no longer exists; every `ResetError` member resolves under `family.resetPin.*`
- [ ] `auth.passwordRotation.savingLabel` still resolves (it sits inside the deleted range)
- [ ] "recovery key" / "backup key" / "master key" appear nowhere in shipped copy
- [ ] `envelopeHasPasswordWraps` is gone from `rosterCache.ts`, `RosterCacheEntry` and `familyStore`'s watcher
- [ ] `getting-started.ts` no longer teaches the password create flow; the `password-recovery` slug is retained
- [ ] Every deleted key verified unrendered by bare-string grep
- [ ] `npm run translate` parses and round-trips
- [ ] Every changed surface verified in light and dark mode and at Large reading mode
- [ ] `npm run type-check`, `npm run lint`, `npm run security:lint` and the unit suite green
- [ ] Help Center articles updated and verified against shipped behaviour
- [ ] Diagnostic logging through `loginFlowEvents.ts` on existing keys; `telemetryAllowlistDrift.test.ts` untouched and green

## Testing Plan

1. **Unit — capabilities**: `envelopeCapabilities` over kit-born, legacy, passphrase-only, combined and all-false envelopes (the all-false case asserting the degenerate terminal on both `LoadPodView` and the prove engine); `envelopeNeedsRecovery` still agrees with its old behaviour on every case (extend `envelopeNeedsRecovery.test.ts`).
2. **Unit — password probe**: `null` for kit-born cold and unknown cold; the method for legacy cold and warm-without-PIN. Method list never empty.
3. **Unit — passphrase probe**: returned for cold + `caps.passphrase`; `null` for warm, `known:false`, `caps.passphrase === false`. Method list never empty. **Ordering**: a legacy cold family with a passphrase resolves exactly `['password','passphrase','recovery']`.
4. **Unit — staging**: `stagePendingFile` dedupes concurrent calls; a settled failure is **not** memoized (a second call re-attempts); an outcome tagged with family A is discarded when the active family is B; `currentCapabilities('B')` reports `not-staged` while the store holds A's envelope; the await is bounded by `raceTimeout`.
5. **Unit — reset PIN keys**: a table test over the `ResetError` union asserting every member resolves under `family.resetPin.error.*`, so a future union member fails the build rather than rendering a raw key.
6. **Unit — i18n**: no key contains "recovery key"/"backup key"/"master key"; important-surface `beanie` values keep the real noun; `family.resetPin.` is in `IMPORTANT_PREFIXES`; `auth.passwordRotation.savingLabel` still resolves.
7. **Unit — typed errors**: `isRemoteBlocker(new UnlockFailedError(...)) === false` (the whole guard); `decryptPendingFile` sets `errorKey` while `error` keeps `'Incorrect password'`; `grep` acceptance that no raw crypto string reaches a render path.
8. **Browser, two sessions** (the reported repro, per `docs/lessons.md` "verify in a browser, not just tests"): create a family with a PIN in A; open B; confirm the recovery code is asked for and **no password option appears**; set a passphrase in A; confirm B accepts it without a reload-and-clear.
9. **Browser, legacy family**: open a pre-0.13R2 `.beanpod` (or a hand-built envelope with `wrappedKeys`) and confirm the password path is unchanged.
10. **Browser, passphrase-only family**: the recovery route asks for a passphrase, not a Recovery Code; a wrong passphrase returns to the passphrase form.
11. **Offline**: network off, no roster cache — recovery route offered, no impossible credential, `caps_unknown` fires with `error_code: 'stage-failed'`; then reconnect and confirm the offer is restored.
12. **Dark mode + Large reading mode** on ProveView, LoadPodView, RecoverySettings, ResetMemberPinModal.
13. **Telemetry**: each event reaches CloudWatch with its stated context; `telemetryAllowlistDrift.test.ts` green.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted from a first-hand code trace; established that `ensureStaged()` running inside `runOpening` is the single root cause of bugs 1-3. Corrected two errors in the source inventory.
- **Pass 2 (DRY + error handling)**: 13 revisions. `ensureStaged()` dispatches and would have silently swallowed `OPEN_FAILED` from person-select (split it instead); `ProveView` renders one method at a time, so the passphrase became a probe rather than a second input; the offer race would have intermittently stripped a legacy family's password; telemetry rides the `loginFlowEvents` facade, avoiding an allowlist + Lambda + store-declaration workstream entirely; added Step 3b (typed crypto errors) and Step 9 (delete the roster-cache flag and its silent `catch`); corrected key counts, four wrong test paths, and the missing `useJoinFlow.ts` owner of the `'set-password'` step; resolved the help-slug question as "keep it".
- **Pass 3 (Sustainability)**: 16 revisions, two preventing real damage. Deleting the 5 chrome keys **by line range would have removed the live `auth.passwordRotation.savingLabel`** at `:2239`; the unconditional recovery re-read **could adopt the previous family's file** (`LoadPodView.vue:384-386` documents exactly that). Structurally: capabilities are now **derived, not cached**, which deletes the memo, both invalidation rules and the correctness dependency on `caps_changed`; the dedupe promise moved from module scope to a family-tagged closure local and no longer memoizes failures (which would have stripped a legacy password offer for a whole session, un-fixable by the reconnect panel that exists for it); `CapabilityState` moved out of the pure `fileSync` module; `stagePendingFile` became its own testable service; the duplicated fail-closed predicate became one `coldEnvelopeHas`; both "password" catch-alls in `ProveView` became exhaustive; the passphrase form got its own empty-field copy and an explicit outcome kind (the shared `password` event would have said "Enter your password" and corrupted the funnel); the remount would have bounced a passphrase user back to the password form; suppression telemetry moved out of the probes per the module contract and folded into the existing resolved event (2 emitters, not 4); and the work was sequenced into three independently revertible commits.
- **Pass 4 (Fresh-eyes sweep)**: 11 revisions, one of which falsified the plan's central premise and one of which prevented a security regression. **Premise**: the reported bug is on `LoadPodView`, not `ProveView` — a fresh browser session never reaches the prove screen at all (`buildPeople` returns null with no roster cache, `useLoginFlow.ts:199`), so the button greg clicked is `LoadPodView.vue:1264`'s unconditional `t('passkey.usePassword')` on the kit form. Commit 1 was rewritten to carry that fix; the `proveMethods` tri-state is a real but _latent_ second instance of the same mistake. **Security**: putting the new typed errors in `types/sync.ts` beside `RemoteBlocker` would have let `isRemoteBlocker`'s duck-type (`:282`) match them, so a single wrong password would latch the session breaker and `podUnopenableHere`, permanently closing the password form — one `UnlockFailedError` now lives in `fileSync.ts` with a deliberately differently-named field, guarded by a test. Also: `decryptPendingFile().error` has a third consumer pinning the `'Incorrect password'` literal (`SettingsPage.vue:1042`), so an `errorKey` field is added rather than the existing one repurposed; failing closed on a stage failure would have made a legacy family's password offer **network-dependent** and stranded a dead-token user away from the reconnect panel (now dispatches `OPEN_FAILED` instead, preserving A6); `currentCapabilities` needed a family check because the tag guards the promise but not the global side effect; `satisfies never` would not compile without `case 'invite-needed'`; `lastAttempted` had no route from the closure to the view (now a `ref` on the interface); the all-false envelope had no defined surface; the `caps_changed` `detail` encoding is pinned to three booleans; and two items were already done in the code (`createdAt` is stamped at `authStore.ts:1803`; `cannotResetSelf` already names the right panel).

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt (2026-09-09, session 5)

> We discussed the password / pass phrase confusion earlier but deferred the work so we could concentrate on finishing compaction. Now that it's done I'd like to revisit the below.
>
> i've set up a new family, and as per the setup process i've set a PIN, but not a password, as we no longer ask for a password - each family member sets a PIN during the setup process, but at the moment a passphrase is not created during setup and only happens if you go to settings after family setup has already completed.
>
> Now, when i'm trying to login from a separate session to the user just created, it's asking for the recovery code, with the option "use password instead" also shown. if i click on the use password option, the PIN I set does not work, and i was never asked to set a password.
>
> I wanted to see if a pass phrase might work here, so i went to the logged in pod and set a pass phrase from settings, and when i tried to unlock the other session with the pass phrase, i got this error: No wrapped keys in beanpod file — cannot unlock
>
> I believe that asking for a password when the family file cannot be decrypted is probably an artifact of the previous version. What would be the best way to fix this process so it is extremely clear and intuitive for users, and also remains backwards compatible for users who also have passwords?
>
> For example, always use the term "pass phrase" or "recovery kit" to decrypt an unencrypted file? And if so, should we ask users to set a family passphrase during setup, and include the passphrase in the recovery kit? Let me know your thoughts.
>
> For families without PINs / pass phrases yet, do we still need to allow both options to decrypt the file - i.e. password or passphrase - to keep it backwards compatible?
>
> how would you propose we address these issues?

### Follow-up 1

> go ahead to run /beanies-plan to fix all of the above, including all the UI messages and help documentation as appropraite wherever needed. once the plan is complete, go ahead to implement directly and carefully as per the plan. once implementation is done, run a code against all code implemented to ensure it is implemented cleanly and accurately as per the plan and does not introduce any bugs, side effects, or security issues. fix all issues found.

### Follow-up 2

> at the same time, i've now typed this prompt multiple times. i think what we should do once done is use /skill-creator:skill-creator to extend the beanies-plan skill properly and in a sustainable way to include both implementation and code review and revision/fixes. we can do that after this session

</details>

---

## Outcome (2026-09-09, session 5)

**Implemented and pushed; NOT deployed and NOT browser-verified.**

Commits: `f04540e8` (correctness) → `f77afd8c` (vocabulary, docs, hygiene) → `3b2876ee`
(code-review fixes). The three-commit sequencing held, except that commit 2's `ProveView`
passphrase form was pulled forward into commit 1: leaving an active passphrase probe with
no form to render would have been exactly the broken intermediate state the sequencing
exists to prevent.

**What the passes were worth.** Pass 3 stopped two changes that would have broken working
code (the line-range key deletion taking `auth.passwordRotation.savingLabel`; the
unconditional re-read adopting the previous family's file). Pass 4 falsified the central
premise — the reported bug is on `LoadPodView`, not `ProveView` — and stopped a security
regression where `isRemoteBlocker`'s duck-type would have latched the session breaker on
one mistyped password.

**What the review was worth.** `/code-review high` found a regression this work
introduced: gating the kit form's escape on `caps.password` left a passphrase-only family
unable to open its file at all. Answered structurally with `coldCredentialSurface()`, a
pure tested function, rather than another branch in the component — two different branches
of that decision had by then been wrong at two different times.

**Deviations from the plan, all deliberate:**

- `UnlockFailedError` is ONE class in `fileSync.ts`, not two in `types/sync.ts` (Pass 4).
- `decryptPendingFile` gained `errorKey`; `error` keeps its `'Incorrect password'` literal,
  which three callers branch on.
- The stage timeout is 20s and a timeout no longer dispatches `OPEN_FAILED` — a timeout is
  not evidence of failure (review finding 4).
- `password.decryptionError` was made credential-NEUTRAL. It is now rendered for a wrong
  passphrase too, and `tryUnwrapFamilyKey` cannot know which was typed.
- Two Chinese strings were hand-fixed after the pipeline broke them.

**Still owed:** every browser check in the Testing Plan above, especially the LEGACY-family
case (9) — the one this change could plausibly hurt, and the one nobody has run. Plus the
CloudWatch verification, which needs a deploy.
