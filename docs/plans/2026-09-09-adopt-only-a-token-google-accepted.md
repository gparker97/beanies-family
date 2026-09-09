# Plan: adopt only a token Google has accepted

> Date: 2026-09-09
> Related issues: none (direct implementation)
> Parent brief: `docs/plans/2026-09-09-auth-token-lifecycle-brief.md` (defect 5)
> Investigation: `docs/investigations/2026-09-08-compaction-fallout.md` § item 5
>
> **No GitHub issue created.** This plan was approved for direct implementation.

## User Story

As someone using beanies.family across a phone, a laptop and a desktop, I want to
sign in to Google once and stay signed in, so that I am not shown a Google consent
screen every few hours on device after device.

## Context

greg reported Drive and Calendar disconnection toasts and a forced Google consent
"every few hours, sometimes more often", across devices. The investigation found
five root causes. Three shipped on 2026-09-09 (stage 1 of the compaction-fallout
remediation): the reconnect revokes were dropped, the escalation gate now fires
only on a classified 4xx, and a lineage-blocked device can read the remote
`driveConnections` to heal.

A fourth remains, and it is the one that manufactures consents that were never
needed. It is defect 5 in the auth brief, stated there as "`adopt` writes before
validating". Three fixes were tried and each failed: "strictly newer" and
"provably older" both mis-handle a legitimately `null` `issuedAt`, and a rollback
could not run on the dominant path because `invalid_grant` had already cleared the
token it meant to restore. Round 7's whole auth hunk was then reverted
(`db105529`).

### The mechanism, verified by driving the code (not by reading it)

Two probes were run against the real `driveTokenRecovery` with a _faithful_
`attemptSilentRefresh` double — one that clears the stored token on
`invalid_grant`, exactly as the real permanent branch does. Both confirmed the
defect. The probes were then reverted; they return as regression tests in the
Testing Plan below.

**Probe 1 — `tryReconnectSilently`.** Device holds a good local token
(`issuedAt: 5000`). The shared beanpod holds a dead token of unknown age
(`issuedAt: null`, a legacy mirrored entry). Strategy 1 fails transiently (a
network blip; the real code leaves the store alone). Strategy 2 then calls
`adopt`, whose `provablyOlder` guard cannot refuse an unknown-age candidate, so
`restoreLocalFromDoc` **writes the dead token into IndexedDB and primes memory
before anything validates it**. `attemptSilentRefresh` then gets `invalid_grant`
and the permanent branch clears the store.

Result: `localToken === null`. **The good credential is gone**, and the device now
has no refresh token at all, which forces a consent screen it did not need.

**Probe 2 — `reconcileDriveTokenWithDoc`, the cold-start path.** Good local token
(`issuedAt: 1000`), doc token strictly newer (`issuedAt: 2000`) but dead.
Reconcile overwrites local with the doc copy and **asks Google nothing at all**
(0 exchange calls). Result: local is now `dead-doc`. The destruction is one step
removed rather than absent: the next refresh gets `invalid_grant` and clears it.

### Why this is a storm and not a single bad reconnect

The poisoned token lives in the **shared, synced** beanpod, and since issue #62 all
of an account's devices deliberately converge on that one mirrored token. Nothing
ever removes a dead entry (`clearDriveConnectionForAccount` is called only on a
deliberate disconnect). So every device that runs either path adopts the same dead
token, destroys its own working credential, and is pushed to consent — which is
precisely "grants seem to be lost across devices, every few hours".

## Requirements

1. A refresh token that Google has not accepted must never **displace a working
   credential** — never written to IndexedDB over one, never primed into memory
   over one. (A device with nothing to displace is the deliberate exception;
   requirement 4 states its terms.)
2. A candidate token that Google **refuses** must cost the device nothing: no
   state mutated, no counter advanced, no move toward the consent screen.
3. Both adopt paths (`reconcileDriveTokenWithDoc` and `tryReconnectSilently`) must
   get this behaviour from **one** place, so it cannot drift between them.
4. A device with **no** local token must be no worse off than today when the
   validation cannot be completed (a transient network failure must not withhold a
   token from a device that has nothing to lose).
5. A refused mirrored candidate must be **visible in CloudWatch**, because that is
   the event whose absence let this run in production undiagnosed.
6. No change to the escalation thresholds, the reconnect surfaces, the revoke
   rules, strategy 3, or the registry/compaction work.

## Important Notes & Caveats

- **`invalidateAccessToken()` must NOT be added to `firePermanentFailureCallbacks`.**
  Round 7 did this and round 8 showed it fires on transient exhaustion too, where
  Google refused nothing, so a captive portal destroyed a live token. Out of scope
  here, deliberately.
- **The metadata probe's 404 stays unclassified.** Round 7 classified it and
  caused an ~18 req/min poll storm by removing the only branch that stops the
  poll. Out of scope; the poll's stop condition must be fixed first.
- **Do not force the silent ladder from a UI button or add an `assumeStale` flag.**
  Both were tried and both destroyed working credentials. The rule is: act where
  the badness is OBSERVED. This plan obeys it — the observation is Google refusing
  a specific candidate, at the moment it refuses it.
- **Strategy 3 (`fromRemoteDocCopy`) is not touched.** Its fate is gated on the
  `healed-from-remote` counter over a release (brief defect 7). Note for the
  record: its stated precondition ("the cached access token is still live") is
  contradicted by `tryReconnectSilently`'s own first line (`if (isTokenValid())
return true`), so it may be unreachable — but that is decided by the counter, not
  by this plan.
- **One change, one round.** Brief defects 1, 2, 3, 4, 6 and 7 are deliberately
  left for later rounds. Every round that bundled several auth fixes shipped at
  least one regression.

## Assumptions

1. `refreshAccessToken` (`oauthProxy.ts:144`) can be called with an arbitrary
   candidate refresh token and has no side effects on module state. (Verified by
   reading: it is a pure fetch wrapper.)
2. `isPermanentRefreshFailure` (`refreshFailure.ts`) is the correct and **only**
   classifier for "Google refused this grant". `isRefreshRejection` is
   deliberately NOT used as a refusal test here — it is the escalation-counter
   predicate, and `classifySilentRefreshError` (`googleAuth.ts:1258-1273`)
   retries every 4xx that is not `invalid_grant`. See §1's failure arm.
3. Two facts checked so a reader need not re-derive them: an accepted adopt
   **cannot churn the CRDT**, because `mirrorRefreshTokenToDoc` is gated on
   `interactive` (`driveTokenRecovery.ts:106-109`) and the probe commits with
   `interactive: false`; and an accepted adopt **does** trigger one
   `fetchGoogleUserEmail` inside `notifyTokenAcquired` (`googleAuth.ts:1896`) —
   one extra request per heal, fire-and-forget and non-blocking.

## Approach

### The shape of the fix

The failed attempts all tried to _guess_ whether a candidate was good, from
timestamps the data model does not guarantee. The fix is to stop guessing and ask
the only authority: **exchange the candidate first, install it only if Google
accepts it.** A refused candidate is then free, which is what the rollback attempt
was reaching for and could not achieve.

Ownership is the second half of it. Today `driveTokenRecovery` persists a token
(`storeGoogleRefreshToken`) and primes `googleAuth`'s private state
(`primeRefreshToken`) as two separate steps, then asks `googleAuth` to validate it
afterwards. That split is why the write happens before the validation. The fix
moves the whole decision into `googleAuth`, which owns the token state:
`driveTokenRecovery` proposes a candidate, `googleAuth` decides and commits.

### 1. New primitive in `googleAuth.ts`

```ts
export type CandidateTokenOutcome = 'accepted' | 'rejected' | 'transient';

/**
 * Try a CANDIDATE refresh token against Google and install it only if Google
 * accepts it. Never throws.
 */
export async function tryCandidateRefreshToken(
  familyId: string,
  candidate: StoredRefreshToken,
  expectedEpoch: number
): Promise<CandidateTokenOutcome>;
```

Behaviour:

- **One exchange**, not the 5-attempt ladder. This is a speculative probe; the
  `transient` arm and the caller's fallback (§3) handle flakiness, and a ladder
  per candidate would multiply proxy load.
- **Takes the caller's `expectedEpoch`** (captured before its async reads, as
  `restoreLocalFromDoc` does today) and passes it straight to
  `commitAcquiredToken` as `epochAtStart`. Does **not** re-snapshot: a later
  snapshot would silently narrow the guard window the callers deliberately
  opened (`docs/plans/2026-06-14-session-epoch-guard-google-token.md`). The
  existing `auth-epoch-discard` event fires from inside `isSessionStillCurrent`
  (`googleAuth.ts:129-133`), so no new discard logging is needed.
- **Config preflight, before any network call.** `const clientId = getClientId();
if (!clientId)` → `reportError({ surface: 'drive-token-adopt', severity:
'warning', message: 'candidate probe skipped — VITE_GOOGLE_CLIENT_ID is unset;
Google recovery is disabled for this build. See docs/SELF_HOSTING.md' })` and
  return `'transient'`. Mirrors `performSilentRefresh`'s own guard
  (`googleAuth.ts:1338`) and stops a build-config error masquerading as a Google
  refusal.
- **On success** — commit through `commitAcquiredToken` (`googleAuth.ts:172`),
  the existing single chokepoint for a _persisting_ acquisition. It already owns
  the pre-commit epoch check + best-effort revoke, the in-memory writes,
  `storeGoogleRefreshToken` (with a `warn` firehose event on persist failure),
  the **post-persist epoch re-check + rollback**, `scheduleAutoRefresh` and
  `notifyTokenAcquired`.

  ```ts
  const result = await commitAcquiredToken({
    tokens: { ...tokens, refresh_token: candidate.token },
    interactive: false,
    epochAtStart: expectedEpoch,
    storageKey: familyId,
    refreshTokenOrigin: { kind: 'adopted', issuedAt: candidate.issuedAt }, // NEW
  });
  if (!result.committed) return 'transient';
  ```

  `refresh_token` is synthesized: Google's refresh endpoint does not return one,
  and the point of this path is to persist the candidate we just proved good.

  **One new required field, not two optional flags.** Whether Google minted this
  refresh token in this response, or we are re-homing one we already hold, is a
  single fact. Encoding it as two independently-settable optional knobs whose
  defaults are wrong for the new caller is how an options bag accumulates — the
  next persisting seam must remember to flip both, and forgetting one is silent.

  ```ts
  type RefreshTokenOrigin =
    | { kind: 'minted' } // Google issued it in THIS response
    | { kind: 'adopted'; issuedAt: number | null }; // re-homing a token we already hold

  async function commitAcquiredToken(args: {
    tokens: { access_token: string; expires_in: number; refresh_token?: string };
    interactive: boolean;
    epochAtStart: number;
    storageKey: string;
    refreshTokenOrigin: RefreshTokenOrigin; // NEW — required
  }): Promise<{ committed: true; token: string } | { committed: false }>;
  ```

  - `:178`'s destructure gains `refreshTokenOrigin`.
  - `:189` becomes `const issuedAt = refreshTokenOrigin.kind === 'adopted' ?
refreshTokenOrigin.issuedAt : Date.now();` (`issuedAt` widens to
    `number | null`; `StoredRefreshToken.issuedAt` and `storeGoogleRefreshToken`'s
    options already accept `null`). Re-stamping an adopted token invents a fresh age and falsifies
    `refreshTokenAgeMs` in the `invalid_grant` diagnostic (`:1445-1446`).
    `migratePendingRefreshToken` (`:782-787`) already carries the source
    `issuedAt` literally for this exact reason.
  - `:248`'s guard becomes
    `if (tokens.refresh_token && refreshTokenOrigin.kind === 'minted')`. It is the #62 fleet-wide token-pressure counter, and an
    adopted mirror is not a mint; the accept is already counted by
    `candidate-accepted`.
  - The three existing call sites (`:1002`, `:1107`, `:2401`) pass
    `{ kind: 'minted' }`.

  **Required, not optional**, on purpose: a new persisting seam then cannot
  inherit a default that is wrong for it, and the next variation goes into the
  union rather than becoming a third boolean. It also labels the synthesized
  `refresh_token` — the response object is knowingly not Google's, and
  `{ kind: 'adopted' }` says so.

- **Then, and only then, `currentFamilyId = familyId`.** `commitAcquiredToken`
  takes `storageKey` but deliberately does not assign `currentFamilyId`: all
  three existing call sites pass `storageKey: currentFamilyId ??
PENDING_FAMILY_KEY` (`googleAuth.ts:1006, 1111, 2405`), so folding the
  assignment into the chokepoint would set it to `'__pending__'`. Do not
  "simplify" it there. Assigning _after_ the commit succeeds keeps the
  rejected/transient arms mutation-free while preserving what
  `primeRefreshToken` does today (`:465-468`): without it, the permanent branch
  (`:1452`) skips `clearGoogleRefreshToken` and a genuinely revoked token is
  never cleared from IDB.

  Then clear `lastSilentRefreshDiagnostics` and return `'accepted'`. Do **not**
  re-reset the failure counters or re-call `clearPermanentFailureFlag()` —
  `notifyTokenAcquired` (`:1888-1893`) already does both, and it is also what
  clears the reconnect banner (`syncStore.ts:5761-5779`), so firing it is
  load-bearing.

- **Do not extract anything from `performSilentRefresh`'s success arm.** It is a
  strict subset of the above (no persist, no `currentRefreshToken` write)
  precisely because a silent refresh reuses the token it already holds. There is
  no duplication to remove there; the duplication risk is the _persisting_
  commit, and `commitAcquiredToken` already is that one place.

- **On failure** — the whole body is wrapped in `try/catch` so the primitive can
  honour "never throws". Classify with the existing predicates, in this order:
  - `isPermanentRefreshFailure(e)` → `'rejected'`. **This predicate ALONE, and
    deliberately.** It is the module's own definition of "Google refused this
    grant": `classifySilentRefreshError` treats nothing else as `'permanent'`
    and files every other `HTTP 4xx` as `'http'`, i.e. **transient and retried**
    (`googleAuth.ts:1258-1273`). `isRefreshRejection` answers a different
    question — "did the proxy return a 4xx at all" — and exists to drive the
    escalation counter (`refreshFailure.ts:37-52`). Using it here would be
    strictly more destructive than the real permanent branch: a proxy-side
    `HTTP 400 invalid_request` would permanently strand the straggler device
    that has no local token, because today that device persists the doc token
    and heals on the next wake, whereas a `'rejected'` verdict writes nothing
    and hands it a consent screen on every attempt, forever. That is the same
    "a config error masquerading as a Google refusal" failure the client-id
    preflight above exists to prevent.
  - otherwise → `'transient'`, **and** emit `reportError({ surface:
'drive-token-adopt', severity: 'warning', message: 'candidate probe could
not be completed', error: e })` so a persistent proxy misconfiguration or an
    unexpected throw is visible with its own message (`getApiBaseUrl`'s already
    carries the fix — `oauthProxy.ts:38-41`). `refreshFailure.ts:24-25` states
    the governing rule ("an unrecognized throw must never be mistaken for a
    revocation"), so `'transient'` is the only safe default — but it must never
    be a _silent_ default. When `isRefreshRejection(e)` is true, attach
    `error_code` (the matched `HTTP 4xx`) to the `candidate-unverified-*` event
    so the proxy-defect fingerprint is still queryable in CloudWatch.
  - **Mutate nothing** on either arm: not `currentRefreshToken`, not
    `currentFamilyId`, not `sawPermanentFailureThisSession`, not
    `lastSilentRefreshDiagnostics`, not IndexedDB, and **not
    `consecutiveSilentRefreshFailures` or `consecutiveTransientExhaustions`**.
    Those counters drive the escalation that raises the reconnect surface; a
    speculative candidate failing must never push the user toward a consent
    screen. This is requirement 2, and it is the single most important line in
    this plan.
- Deliberately does **not** join the `pendingSilentRefresh` dedup: that dedups
  "refresh the current token", which is a different operation from "test this
  specific candidate". It must therefore be callable from inside a
  permanent-failure callback without the deadlock `attemptSilentSelfRecovery`
  defers around (`syncStore.ts:5697-5703`). §1b closes the consequence.

### 1b. Ownership guard in `performSilentRefresh`'s permanent branch (required by §1, not optional)

§1 makes `tryCandidateRefreshToken` a second writer of `currentRefreshToken`
outside the `pendingSilentRefresh` dedup. `performSilentRefresh`'s permanent
branch (`googleAuth.ts:1436-1463`) destroys whatever token is current when it
runs, not the token Google refused. So this sequence is live the moment §1 ships:

1. The wake listener (`:731`) or the auto-refresh timer (`:2081`) starts a ladder
   on a dead local token; an attempt's `fetch` is in flight.
2. `reconcileDriveTokenWithDoc` probes a good doc candidate, Google accepts it,
   `commitAcquiredToken` persists it and sets `currentRefreshToken`.
3. The in-flight attempt returns `invalid_grant` **for the old token**. The
   permanent branch nulls `currentRefreshToken` and calls
   `clearGoogleRefreshToken(currentFamilyId)` — **destroying the credential
   Google just accepted** — and fires the permanent-failure callbacks that raise
   the reconnect surface.

That is byte-for-byte the outcome this plan exists to prevent, reintroduced
through the back door. Close it in the same change:

- A **guard clause at the top** of the permanent branch. The destructive body
  below it is **not modified at all** — this is +9 added lines and zero changed
  lines in the most dangerous block in the module, which is what a reviewer of
  the fifth attempt at this subsystem needs to see:

  ```ts
  if (isPermanent) {
    // The refused token is not necessarily the CURRENT one. `tryCandidateRefreshToken`
    // and `primeRefreshToken` both write `currentRefreshToken` outside the
    // `pendingSilentRefresh` dedup, so a good token can be installed while this
    // attempt's fetch is in flight. Invalidate where the badness was OBSERVED — and
    // what was observed is a specific token STRING, not a moment in time.
    if (currentRefreshToken?.token !== tokenAtAttempt) {
      logEvent({
        level: 'info',
        surface: 'google-token-lifecycle',
        message: 'ignored an invalid_grant for a refresh token that had already been replaced',
        context: { action: 'permanent-failure-superseded' },
      });
      return null;
    }
    // …existing body, unchanged…
  }
  ```

  `tokenAtAttempt` is hoisted to the loop body as
  `let tokenAtAttempt: string | null = null;` and assigned at `:1393` (it is
  currently declared inside the `try`, so it is not in scope in the `catch`). The
  `null` initial value fails **safe**: if a throw somehow preceded the
  assignment, the comparison is true and nothing is destroyed.

- **Deliberate non-goal: the two exhaustion branches need no equivalent guard.**
  A committed candidate runs `notifyTokenAcquired`, which resets
  `consecutiveSilentRefreshFailures` and `consecutiveTransientExhaustions` to 0
  **synchronously, before its first await** (`googleAuth.ts:1885-1893`). So an
  in-flight ladder that exhausts after a successful adopt lands at 1, below both
  thresholds (2 and 6, `:353-356`), and raises nothing. Recorded here so a later
  round does not "also guard" `:1507-1535` / `:1538-1566` and reopen the counter
  semantics.

- **Verified, so a later round need not re-derive it: `return null` from the
  guard is inert.** The auto-refresh timer fires `expiryCallbacks` when
  `attemptSilentRefresh()` returns null (`googleAuth.ts:2081-2091`), which reads
  like a false reconnect prompt after a successful heal. It is not:
  `onTokenExpired` has **zero** production subscribers (verified by grep across
  `src/` — the only hit is its own declaration at `:1811`), so `expiryCallbacks`
  is empty. Returning `null` — rather than teaching the most dangerous block in
  the module to synthesize a success value — is therefore both the safest and
  the observably-equivalent choice.

This is the module's own rule — invalidate where the badness is OBSERVED —
applied to the _identity_ of the token, not just the moment. It also closes the
same hole for the pre-existing `primeRefreshToken` writer, which has always had
it.

A cheaper alternative (bail out of `tryCandidateRefreshToken` with `'transient'`
when `isSilentRefreshPending()`) was considered and rejected: it makes the heal
path lose a race it should win, and it leaves the hole open for
`primeRefreshToken`.

### 2. New `adoptDocToken` in `driveTokenRecovery.ts` (`restoreLocalFromDoc` is KEPT)

`restoreLocalFromDoc` stays exactly as it is and keeps its name. It is the one
epoch-guarded blind write, and its guard is re-evaluated **at write time**, which
is what makes it correct after an awaited probe. `adoptDocToken` is a new policy
layer above it.

```ts
/**
 * What the CALLER must do next — nothing more. The four telemetry `action`
 * values live at the emit sites inside this function; they are the
 * observability contract, and the return type is not the place to re-encode
 * them.
 */
type AdoptOutcome = 'accepted' | 'unverified-adopted' | 'not-adopted';

async function adoptDocToken(
  familyId: string,
  docTok: StoredRefreshToken,
  expectedEpoch: number
): Promise<AdoptOutcome>;
```

- Epoch guard first — a **fast path only** (skip a pointless exchange after a
  sign-out that already happened). It returns `'not-adopted'` and **emits the
  same `auth-epoch-discard` info event `restoreLocalFromDoc` emits**
  (`driveTokenRecovery.ts:165-173`), because after this change the probe
  short-circuits before `restoreLocalFromDoc` is ever reached, and that event is
  the only production signal that a sign-out cancelled an adopt. It also keeps
  `driveTokenRecovery.test.ts:275-292` passing unchanged, which is the point:
  the observable did not change, only where it is emitted from. The
  authoritative guards remain `commitAcquiredToken`'s (accept arm) and
  `restoreLocalFromDoc`'s (blind arm), both re-checked **after** the await. Do
  not "de-duplicate" the three; they guard three different instants.
- **Re-read the local token here**, once: `const current = await
getGoogleRefreshToken(familyId)`. This is the re-read `tryReconnectSilently`'s
  `adopt` does today (`driveTokenRecovery.ts:340`) and its rationale is unchanged
  ("step 3 can spend seconds on a multi-MB download, and a redirect return or the
  wake listener may have installed a fresher credential in that window"). Owning
  it here is what makes requirement 3 true rather than caller-dependent: a
  `hasLocalTokenToProtect` **parameter** would let a caller pass a value read
  before an awaited round-trip, which is exactly the drift "one place" exists to
  prevent.
- doc token already equals local → return `'not-adopted'` (no probe, no event).
- `const outcome = await tryCandidateRefreshToken(familyId, docTok, expectedEpoch)`
- `'accepted'` → log `candidate-accepted`; return `'accepted'`.
- `'rejected'` → log `candidate-refused` at **warn**; return `'not-adopted'`.
  **Local credential untouched** — this is the fix.
- `'transient'` + local present → log `candidate-unverified-kept-local`; return
  `'not-adopted'`. We could not verify, so we do not displace a working token.
- `'transient'` + no local → `await restoreLocalFromDoc(familyId, docTok,
expectedEpoch)` — today's exact behaviour, unchanged, and **specifically
  because its epoch check runs after the probe** it also covers a sign-out that
  landed while the probe was in flight. That matters: `commitAcquiredToken`
  returns `{ committed: false }` on a torn-down session, which is
  indistinguishable from a network transient at this call site, and `current` is
  a snapshot read _before_ the probe. Without `restoreLocalFromDoc`'s write-time
  guard this arm would write a token into a dead session — the cold-start zombie
  that guard exists to prevent. Then log `candidate-unverified-adopted` and
  return `'unverified-adopted'`.

Three return values, not four: no caller distinguishes "Google refused" from "we
kept the local one" — reconcile ignores the return entirely and
`tryReconnectSilently` maps both to `false`. If the deferred "delete the dead doc
entry" follow-up ever lands it will need `'rejected'` back as a distinct value;
add it then, together with its consumer, not in advance of one.

### 3. Call sites

- **`reconcileDriveTokenWithDoc` — no probe at all.** The doc→local branch adopts
  **only when the device has no local token**:

  ```ts
  if (docTok && !localTok) await restoreLocalFromDoc(familyId, docTok, epochAtStart);
  ```

  A device that HAS a local token no longer adopts the doc copy here, so probe
  2's scenario cannot arise: there is nothing to displace it with. This is
  strictly better than probing here, for three reasons:

  1. **It keeps the load path free.** `runPostLoadDriveHousekeeping` **awaits**
     this before `setupAutoSync()` and `markPodCreated()` (`syncStore.ts:1562-1568`),
     and `loadFromPersistenceCache` awaits it before its own `markPodCreated()`
     and `return { success: true }` (`:2427-2431`). `markPodCreated` is what keeps
     the user off the create-recovery screen. A probe here is bounded only by
     `FETCH_TIMEOUT_MS = 15_000` (`oauthProxy.ts:52`), so a dead network would add
     up to 15s of stall to a path that today issues **zero** exchanges.
  2. **`isStrictlyNewer` disappears from this branch** (it survives only in the
     local→doc `mirrorLocalToDoc` direction), so the guessing-from-timestamps
     heuristic is gone from **both** adopt decisions rather than one.
  3. **It obeys the brief's own rule.** Healing belongs where the badness is
     OBSERVED. A device whose local token is dead still heals — one step later
     and validated — via `attemptSilentRefresh` failing →
     `firePermanentFailureCallbacks` → `attemptSilentSelfRecovery` →
     `tryReconnectSilently` → `adoptDocToken` (`syncStore.ts:5706-5744`, registered at `:5751-5758`). Probing
     Google at cold start about a credential nobody has complained about is the
     speculative-invalidation shape the Important Notes warn against.

  The cost, stated plainly: a device whose local token is still alive stops
  eagerly converging on a newer mirrored token at cold start; it converges on the
  next reconnect instead. Per § "Why this is a storm", eager convergence on one
  mirrored token is what propagated the poison across the fleet, so this is the
  direction of travel, not a regression. The local→doc mirror branch is
  unchanged.

- **`tryReconnectSilently`'s `adopt`** — the only caller of the probe. Collapses
  to one `adoptDocToken` call plus one line that preserves today's recovery
  budget:

  ```ts
  const adopt = async (tok: StoredRefreshToken): Promise<boolean> => {
    const outcome = await adoptDocToken(familyId, tok, epochAtStart);
    if (outcome === 'accepted') return true;
    // Only when we adopted blind (no local token to lose) do we fall through to
    // today's exact path: the 5-attempt ladder. Skipping it would cut the
    // documented ~22.5s recovery budget (googleAuth.ts:1371) down to a single
    // exchange for the straggler device that has nothing else, and hand it a
    // consent screen for one wake-time network blip — requirement 4.
    if (outcome === 'unverified-adopted') return (await attemptSilentRefresh()) !== null;
    return false;
  };
  ```

  No ladder on the `'not-adopted'` arms: if we kept the local token, that is what
  strategy 1 just tried, so re-running it is a guaranteed-duplicate exchange; and
  if Google refused, Google has answered. `syncStore.ts:5688-5690` pins
  `SELF_RECOVERY_TIMEOUT_MS = 30_000` explicitly as "longer than
  tryReconnectSilently's own retry budget (~22.5s)", so that budget is a
  documented contract of this function and must survive the change.

  `tryCandidateRefreshToken` therefore has exactly **one** caller, which makes
  requirement 3's "one place" literally true rather than structurally true.

- **Delete the `provablyOlder` heuristic entirely.** Its own comment states the
  intent — "Unknown age is not evidence of staleness: let Google decide" — and
  Google now actually decides. Net deletion of the guard and its 12-line
  rationale. **`older-token-declined` disappears with it**; it has one producer
  (`driveTokenRecovery.ts:358`) and zero consumers (verified by grep across
  `src/`, `infrastructure/` and `docs/`), so no dashboard or alarm breaks. Say so
  in the CHANGELOG's dev-facing half.

- **Delete the stale first clause** of the sentence at
  `driveTokenRecovery.ts:405-408` (`reconnect()` passes `assumeStale`…) — it
  describes a parameter `db105529` removed, so it is now a false comment. Keep
  the second clause about a recently-rotated peer, which is still true.

### What this deliberately does not do

It does not remove the dead entry from the shared doc. With this fix a poisoned
entry costs one refused exchange per adopt attempt and destroys nothing, so it is
no longer harmful — merely futile. Removing it needs a compare-and-delete
repository primitive and is a CRDT write on an auth path; the new
`candidate-refused` warn will show whether it is worth doing. Recorded as a
follow-up, not smuggled in.

## Files Affected

| File                                                              | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/services/google/googleAuth.ts`                               | Add `CandidateTokenOutcome` + `tryCandidateRefreshToken` (committing via the existing `commitAcquiredToken` chokepoint); add the required `refreshTokenOrigin` discriminated union to `commitAcquiredToken` (3 existing call sites pass `{ kind: 'minted' }`); add the refused-token-identity guard to `performSilentRefresh`'s permanent branch (hoist `tokenAtAttempt`). **No extraction from the silent-refresh success arm.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `src/services/google/driveTokenRecovery.ts`                       | **Add** `adoptDocToken` (returns `AdoptOutcome`, owns the local re-read); **retain `restoreLocalFromDoc` unchanged** as its blind-write arm; reconcile's doc→local branch becomes `!localTok`-only (no probe, `isStrictlyNewer` drops out of it); delete the `provablyOlder` heuristic and the stale `assumeStale` clause                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `src/services/google/__tests__/googleAuth.candidateToken.test.ts` | **New.** Unit tests for the primitive (accepted / rejected / transient / epoch / config / dedup) + the concurrent-ladder regression test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `src/services/google/__tests__/driveTokenRecovery.test.ts`        | Both probes as regression tests, with faithful doubles, **plus the named updates below**. Each existing test is listed by line because "update for the new contract" is how this subsystem twice shipped a test asserting the new bug was correct (`docs/lessons.md`): **`:134`** inverts (doc strictly newer + local PRESENT → zero writes, zero exchanges — AC 2); **NEW** cold-start reconcile with `localToken = null` adopts the doc copy (the only surviving adopt branch, and today untested — `:174` has a non-matching doc entry so it proves nothing about the adopt); **`:382`** loses its `provablyOlder` premise and its now-false 12-line "KNOWN-INCOMPLETE" comment block, becoming "does not overwrite a local token with a mirrored one Google REFUSES"; **`:406`** keeps its null-`issuedAt` premise but asserts the probe was CALLED with the peer token rather than that this module persisted it; **`:217` / `:254` / `:308`** each pin an explicit `tryCandidateRefreshToken` outcome and re-point their persist/prime assertions into that double. **`:242`, `:265`, `:275`, `:330`-`:380`, `:425`-`:457` are unaffected** (traced against the new flow). |
| `src/services/google/driveTokenRecovery.ts` (comments)            | `reconcileDriveTokenWithDoc`'s JSDoc (`:209-221`) says "doc strictly newer → restore local + prime", and the module comment at `:102` says "precedence/newer-wins lives ONLY in `reconcileDriveTokenWithDoc`". **Both become false** with this change and must be rewritten in the same commit — a stale invariant comment in this very module is what the `assumeStale` clause already demonstrates.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `CHANGELOG.md`                                                    | One user-facing line, plus the dev-facing note that `older-token-declined` is retired                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `docs/investigations/2026-09-08-compaction-fallout.md`            | Note item 5's fourth cause as fixed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

## Help Center Coverage

**Not required.** This is a bug fix to a background credential path. It changes no
user-facing capability and contradicts no existing article; the user-visible effect
is the absence of a prompt.

## Observability Coverage

All four events on one new surface, `drive-token-adopt`. The shared adopt
decision is now used by both the cold-start reconcile and the silent reconnect,
and neither existing surface names it truthfully — filing reconcile outcomes
under `drive-token-silent-reconnect` would imply a reconnect was attempted and
would break the triage rule below. `action` is already allowlisted
(`src/utils/diagnosticContext.ts:68`, mirrored at
`infrastructure/lambda/telemetry/index.mjs`), so **no `ALLOWED_CONTEXT_KEYS` or
store-declaration change is needed** — only a new surface string ships, no new
context key. `healed-from-remote` and `remote-read-unavailable` stay on
`drive-token-silent-reconnect` unchanged: they measure strategy 3, whose fate is
gated on that counter (brief defect 7).

| Event (`action`)                    | Level   | What it tells you                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `candidate-accepted`                | info    | A mirrored token healed this device. **The success counter** — without it the refusal rate below has no denominator.                                                                                                                                                                                                                                                                                                                                                                                 |
| `candidate-refused`                 | warn    | Google refused a mirrored candidate with `invalid_grant` (or "expired or revoked"). **The missing signal.** `error_code: invalid_grant`, always — a 4xx that is not a grant refusal is a proxy defect and lands on `candidate-unverified-*` carrying its `HTTP <status>` in `error_code`, so the two can never be confused. `error_code` is already allowlisted (`src/utils/diagnosticContext.ts:69`, mirrored at `infrastructure/lambda/telemetry/index.mjs:78`), so this ships no new context key. |
| `candidate-unverified-kept-local`   | info    | A transient probe failure; a working local token was protected. Distinguishes "we chose not to adopt" from "there was nothing to adopt".                                                                                                                                                                                                                                                                                                                                                             |
| `candidate-unverified-adopted`      | info    | Adopted blind because there was no local token to lose. Preserves today's behaviour and says so.                                                                                                                                                                                                                                                                                                                                                                                                     |
| _(via `reportError`, same surface)_ | warning | Deduped by `(surface, message)` (`src/utils/errorReporter.ts:84-101`) and both messages are fixed strings, so an offline fleet cannot spam it. The probe could not run or threw unexpectedly — an unset `VITE_GOOGLE_CLIENT_ID`, an unconfigured OAuth proxy (`oauthProxy.ts:38-41` carries the fix in its message), or an IDB failure at commit. Without this the whole class lands in `candidate-unverified-*` and reads as ordinary network flakiness forever.                                    |

Plus one on the existing `google-token-lifecycle` surface:
`permanent-failure-superseded` (info) — an `invalid_grant` arrived for a token
that had already been replaced, and was correctly ignored (§1b).

Triage without a repro: `candidate-refused` rising with `error_code:
invalid_grant` ⇒ a dead entry in that family's beanpod; `candidate-unverified-kept-local` / `-adopted` rising with an
`HTTP 4xx` `error_code` ⇒ a proxy or request defect, not a poisoned token; `candidate-accepted` rising ⇒ the heal channel is
working; both flat while `google-reconnect` shows `reconnect-failed` ⇒ the
problem is not in this layer. `candidate-unverified-kept-local` rising with
**zero** `candidate-accepted` and zero `candidate-refused` on the same devices ⇒
the probe is never completing; check the `drive-token-adopt` `reportError`
stream for a config error before assuming a network cause.

## Acceptance Criteria

1. Probe 1's scenario leaves the good local token **intact** and returns `false`.
2. Probe 2's scenario leaves the good local token **intact** and issues **zero**
   OAuth exchanges — reconcile does not adopt over a present local token at all.
3. A `rejected` candidate advances neither failure counter and does not set
   `sawPermanentFailureThisSession`. Both are module-private, so assert the
   **escalation behaviour**, not a diagnostic field: register
   `onTokenPermanentlyExpired`, run the probe against a rejecting proxy more
   times than either threshold (2 and 6, `googleAuth.ts:353-356`), and assert
   that the callback never fires, that no `google-token-lifecycle`
   `transient-suppressed` / `transient-streak-escalated` event is emitted, that
   `hasRefreshToken()` is unchanged, and that `getLastSilentRefreshDiagnostics()`
   is still `null`. ⚠️ The earlier formulation ("a later exhausted refresh still
   reports `consecutiveFailures: 0`") was a test that **could not fail**: the
   transient-exhaustion branch sets that field from
   `consecutiveSilentRefreshFailures` (`:1520-1525`) while incrementing
   `consecutiveTransientExhaustions` (`:1507`), so it reads 0 either way.
4. An `accepted` candidate fires `notifyTokenAcquired`, so an up reconnect banner
   clears with no user interaction.
5. A device with no local token and a transient probe failure still ends with the
   doc token persisted **and still gets the full 5-attempt ladder** (no
   regression against today's ~22.5s recovery budget).
6. A sign-out mid-probe adopts nothing, locally or in memory.
7. `npm run type-check`, `npm run lint`, and the full unit suite pass.
8. **An `invalid_grant` from a ladder already in flight when a candidate
   committed does not clear the newly-adopted token, does not latch
   `sawPermanentFailureThisSession`, and does not fire the permanent-failure
   callbacks** (§1b's guard).
9. A candidate probe with `VITE_GOOGLE_CLIENT_ID` unset returns `'transient'`,
   emits a `reportError` naming the env var, and logs **no** `candidate-refused`.
10. `tryCandidateRefreshToken` never sets `pendingSilentRefresh`:
    `isSilentRefreshPending()` is `false` throughout, so it is safe to call from
    inside a permanent-failure callback.
11. An accepted candidate is persisted with the candidate's own `issuedAt`, not a
    fresh `Date.now()`, and logs no `op: 'mint'`.

## Testing Plan

Per `docs/lessons.md`: **fixtures are built by the producing code path, and the
fix is verified by driving the real handler, not by reading the diff.**

1. **Regression tests** — the two probes, restored with faithful doubles. The
   `attemptSilentRefresh` double must clear the store on `invalid_grant` (as the
   real permanent branch does) and leave it alone on a transient failure;
   `storeGoogleRefreshToken` must write through into the same `localToken` the
   reader returns, or the test cannot observe the destruction.
2. **Mock faithfulness (brief point 4).** The new `tryCandidateRefreshToken`
   double in `driveTokenRecovery.test.ts` must _not_ mutate the store on
   `'rejected'` — a double that does would hide exactly the bug being fixed.
   Assert the store is untouched, not merely that the return value is false.
   In the primitive's own tests the `commitAcquiredToken` path is **real** — do
   not stub it. Stubbing would hide the two behaviours the accepted arm depends
   on (post-persist rollback, and `notifyTokenAcquired` resetting the counters),
   and a stub that "just resolves" is precisely the fourth unfaithful-mock shape
   the brief warns about. Note `notifyTokenAcquired` only calls
   `fetchGoogleUserEmail` when `acquiredCallbacks.length > 0`
   (`googleAuth.ts:1895-1896`), so these tests need no `fetch` stub except for
   AC 4, which registers a subscriber — use the established
   `globalThis.fetch` stub from `googleAuth.accountSwitch.test.ts:39` there.
   `logTokenLifecycle` is imported from `./googleRevoke` and is already in the
   mock stanza, so AC 11's "logs no `op: 'mint'`" is directly assertable.
3. **Primitive unit tests** in a new
   `src/services/google/__tests__/googleAuth.candidateToken.test.ts`, following
   the established sibling-file pattern (`accountSwitch`, `calendarGrant`,
   `native`, `redirectSettle`) and reusing the mock stanza +
   `resetModules`/`sessionStorage` reset from `googleAuth.test.ts:1-90`
   verbatim — do not re-derive it; the `sessionStorage.removeItem(
'beanies_silent_refresh_failures')` reset exists because the failure counter
   is host state that survives `resetModules`. `vi.stubEnv(
'VITE_GOOGLE_CLIENT_ID', …)` is the established way to set the client id
   (`googleAuth.calendarGrant.test.ts:54`). Cases: accepted commits + notifies +
   persists with the candidate's own `issuedAt` and logs no `op: 'mint'`;
   rejected mutates nothing — assert the escalation behaviour per AC 3 (probe
   repeatedly against a rejecting proxy; `onTokenPermanentlyExpired` never fires
   and no `transient-suppressed` / `transient-streak-escalated` event is
   emitted), plus `hasRefreshToken()` unchanged and
   `getLastSilentRefreshDiagnostics() === null`;
   transient for a network `TypeError` and for `HTTP 503`; **`HTTP 429` and
   `HTTP 403` classify transient, not rejected** (`refreshFailure.ts:63-75` names
   them transient explicitly, and treating them as refusals would force a consent
   for a rate limit); epoch advanced mid-probe → `'transient'` and nothing
   committed; unset client id → `'transient'` + `reportError`, no
   `candidate-refused`; `isSilentRefreshPending()` false throughout.
   3b. **Optional, and safe to defer: stop hand-copying the mock stanza.** This
   would be the seventh copy of the same ~55-line block (`googleAuth.test.ts`,
   `.accountSwitch`, `.calendarGrant`, `.calendarGrant.native`, `.native`,
   `.redirectSettle`, and now `.candidateToken`), and the brief records four
   unfaithful mocks that each turned a live defect into green CI. This change
   adds a behaviour the copies will now disagree about (`logTokenLifecycle` must
   not fire on an adopt). Extract the mock **factories** and the `beforeEach`
   reset into `src/services/google/__tests__/support/googleAuthMocks.ts` — the
   `vi.mock(path, factory)` calls must stay in each file since they are hoisted,
   but the factory bodies and `resetGoogleAuthModule()` need not be. Use it in
   the new file only; migrate the other six opportunistically. If deferred, copy
   verbatim as stated and record the debt in the CHANGELOG's dev-facing half.
4. **The concurrent-ladder regression test** (§1b's guard, and the one that would
   have caught it): start `attemptSilentRefresh` with a `refreshAccessToken` mock
   whose promise is held open, commit a candidate through
   `tryCandidateRefreshToken` while it hangs, then reject the held promise with
   `invalid_grant`. Assert the adopted token survives in `hasRefreshToken()` and
   in the `fileHandleStore` double, that `clearGoogleRefreshToken` was **not**
   called, and that the permanent-failure callbacks did not fire. This is a
   "drive the real handler with the state the code produces" test, not a shape
   test.
5. **Revert-and-watch-it-fail** for each new guard, per `docs/lessons.md`:
   necessary but not sufficient — it proves the test binds to the code, not that
   the code is right about the world. The probes above are the "right about the
   world" half.
6. **Full suite** (`npm test`), type-check, lint.
7. **Manual, in a browser** (per `feedback_verify_in_browser_not_just_tests`):
   sign in with Drive, confirm normal sign-in and a normal reconnect still work,
   and confirm the `drive-token-adopt` events appear on the telemetry path.

## Code review — findings and disposition

`/code-review high` ran against the implemented diff. Six findings; four fixed,
two deliberately recorded rather than patched.

**Fixed:**

1. **The blind-adopt arm decided from a stale snapshot (medium).** `current` was
   read before the probe, and the probe can burn the full 15s fetch timeout. An
   interactive reconnect completing in that window would mint and commit a fresh
   token, and the arm would then overwrite it with the unvalidated doc copy —
   the same harm this work exists to stop, through a narrower window, and one the
   epoch guard does not cover because no sign-out occurred. Now re-reads after the
   probe. Regression test added and verified by revert-and-fail.
2. **`error_code: 'invalid_grant'` was hardcoded on `candidate-refused` (low).**
   `isPermanentRefreshFailure` matches `invalid_grant` OR `expired or revoked`, so
   the field was a guess dressed as a fact on the one event triage keys on. The
   primitive now returns the matched code.
3. **The plan's `error_code`-on-transient requirement was unimplemented (low).** A
   proxy-side `HTTP 400 invalid_request` — the defect that would silently keep
   every straggler unhealed — was visible only as a generic `reportError`. It now
   rides the `candidate-unverified-*` events.
4. **Two comments overclaimed (low).** The mirror docblock's "Neither compares
   ages any more" now says "Neither READER", and the ladder comment's claim that
   `SELF_RECOVERY_TIMEOUT_MS` outlasts the recovery is corrected — see below.

**Recorded, not patched:**

5. **`mirrorLocalToDoc` still writes an unvalidated local token over the shared doc
   entry, chosen by `issuedAt`.** A device holding a token Google has already
   killed, but whose `issuedAt` is newer, can overwrite the family's live shared
   copy. This hazard **predates this change and is unchanged by it** — only the
   READ side was in scope, and the write side is repaired by the B2 mirror on any
   subsequent consent. Fixing it means probing on the write path too, which is a
   separate design decision; bundling it would break "one change, one round". The
   mechanism is written into the docblock at the call site.
6. **A narrow IndexedDB ordering race survives the §1b guard.** If a concurrent
   adopt's `storeGoogleRefreshToken` put resolves _during_ the permanent branch's
   `await clearGoogleRefreshToken(...)`, the accepted token is removed from IDB
   while memory keeps it, so the session works but the next cold start has none.
   The guard cannot close this: there is no await between the identity check and
   the delete call, so the window is inside the delete itself and needs a
   compare-and-delete primitive in `fileHandleStore`. It requires the auto-refresh
   timer to fire during a self-recovery, and the §1b guard already removes the far
   larger in-memory case. Recorded as a follow-up rather than hand-patched — a fix
   needing new coordination is the shape `docs/lessons.md` says to distrust.

**Known minor regression, accepted and documented in code:** on the blind-adopt
path a straggler now spends up to 15s probing before the 22.5s ladder starts, so
`syncStore`'s 30s `raceTimeout` can raise the reconnect banner while the ladder is
still running. The late success clears it via `onTokenAcquired`, so the cost is a
banner flash, not a forced consent.

## Review Passes

- **Pass 1 — Initial draft.** Root cause verified by driving the real code (two
  probes, both reproduced the defect); scope held to brief defect 5.
- **Pass 2 — DRY + error handling.** Twelve revisions. Three were load-bearing
  and each was verified against the source before applying: (a) the hand-rolled
  commit was replaced by the existing `commitAcquiredToken` chokepoint
  (`googleAuth.ts:172`), which already owns the persist, the post-persist
  rollback and `notifyTokenAcquired` — the plan would otherwise have
  re-implemented it _minus_ the rollback, leaking a live credential into a
  torn-down session; (b) §1b was added, because the primitive is a second writer
  of `currentRefreshToken` outside the `pendingSilentRefresh` dedup and the
  permanent branch destroys whatever is current rather than what Google refused;
  (c) requirement 4 was being silently regressed — dropping the ~22.5s ladder to
  a single exchange for the straggler device with nothing to lose. Also: config
  preflight + a non-silent transient arm, epoch threaded rather than
  re-snapshotted, `adoptDocToken` owns the local re-read and returns an outcome
  enum, new `drive-token-adopt` surface, and the "removes the current double
  exchange" claim was struck as factually wrong (today's `adopt` runs one
  exchange path, not two).
- **Pass 3 — Sustainability / maintainability.** Nine revisions, three of them
  correctness rather than style, each verified against source before applying:
  (a) the `'transient'` + no-local arm could persist a token into a torn-down
  session, because `commitAcquiredToken` returns `{ committed: false }` for a
  sign-out _and_ for a network transient, and the local-token snapshot predates
  the probe — fixed by **keeping `restoreLocalFromDoc`**, whose epoch guard is
  re-evaluated at write time, as that arm; (b) the probe was removed from the
  cold-start reconcile entirely, since that path **awaits** before
  `setupAutoSync()` / `markPodCreated()` and the probe is bounded only by
  `FETCH_TIMEOUT_MS = 15_000` — reconcile now adopts only when there is no local
  token, which makes probe 2 structurally impossible, drops `isStrictlyNewer`
  from the branch, and leaves the probe with exactly one caller; (c) AC 3
  asserted a value that is constant either way (the transient-exhaustion branch
  reports a counter it does not increment), so it was a test that could not fail
  guarding the plan's most important line. Also: `currentFamilyId` pinned to the
  success path (the plan contradicted itself), the two new `commitAcquiredToken`
  options collapsed into one required `refreshTokenOrigin` union, §1b expressed
  as a guard clause with zero modified lines in the destructive block, and
  `AdoptOutcome` cut from four values to three.
- **Pass 4 — Fresh-eyes final sweep.** Eight revisions, one substantive. The
  substantive one: `'rejected'` must be classified by `isPermanentRefreshFailure`
  **alone**, not `|| isRefreshRejection`. `classifySilentRefreshError`
  (`googleAuth.ts:1258-1273`) files every 4xx that is not `invalid_grant` as
  `'http'`, i.e. transient and retried — so the plan's classifier would have been
  _more_ destructive than the real permanent branch, and a proxy-side
  `HTTP 400 invalid_request` would have permanently stranded the straggler device
  with no local token: today it persists the doc token and heals on the next
  wake; under the plan it would have written nothing and been handed a consent
  screen forever. Also caught: the `commitAcquiredToken` snippet still showed the
  two-option design pass 3 had replaced (the highest-probability
  mis-implementation); the epoch fast path had to keep emitting
  `auth-epoch-discard` or an existing test and the only production signal for a
  cancelled adopt would both vanish; requirement 1 as worded contradicted §3's
  own deliberate blind-write; seven existing tests that change meaning are now
  enumerated by line so none can be quietly re-asserted; two comments in
  `driveTokenRecovery.ts` that this change falsifies were added to Files
  Affected; and five citations were corrected. Verified independently: five
  paths where an unvalidated token might still displace a working credential —
  none found.

## Prompt Log

### Initial Prompt (2026-09-09)

> as per the instructions from the previous session, prepare a plan again for the
> auth work which is the most critical thing to fix. keep the changes focused and
> narrow to ensure that we definitely fix the issue of the constant google
> consents being triggered. once the plan is compelte go ahead to implement. once
> done run a code review to validate the changes made to ensure they address the
> issues and were implemented as per plan and do not introduce any bugs, side
> effects or seucrity issues. fix any issues found.

### Follow-up 1 (2026-09-09)

> once that is done, i think the plan is to implement stage 6 in a fresh session

Noted and out of scope here — stage 6 keeps its own brief
(`docs/plans/2026-09-09-stage-6-preservation-brief.md`) and its own session.
