# Brief: the Google token lifecycle, as one state machine

> Date: 2026-09-09
> Status: **NOT STARTED. Write the state machine down BEFORE changing any code.**
> Origin: eight `/code-review max` rounds on `docs/plans/2026-09-08-compaction-fallout-remediation.md`.
> Rounds 5, 6, 7 and 8 each found defects in the previous round's fixes,
> almost all of them in this one subsystem. Round 7's auth and provider
> changes were REVERTED wholesale on greg's instruction rather than
> patched a fifth time.

## Why this is a plan and not a fix

Four attempts to close the same class of bug each traded one failure mode for
another. That is not bad luck; it is the shape of the problem. The pieces below
share mutable state and are edited independently:

- `googleAuth`: `accessToken` + `expiresAt` (a LOCAL CLOCK, never checked against
  Google), `currentRefreshToken`, `consecutiveSilentRefreshFailures`,
  `pendingSilentRefresh` (a dedup), the auto-refresh timer (fires FIVE MINUTES
  before expiry, so a token is usually still "valid" when a failure is declared).
- `driveTokenRecovery`: three strategies over two token stores, a per-account
  invariant, a session-epoch guard.
- `googleDriveProvider`: five catch arms, each deciding independently whether to
  queue the user's bytes.
- `offlineQueue`: a single-slot last-wins buffer whose `enqueueSeq` also drives
  `flushQueue`'s classification and therefore the `critical` page.
- `syncService` / `syncStore`: the poll's 404 classifier, the remote-blocked
  latch, the reconnect surfaces.

Every fix that failed did so by changing one of these in isolation.

## The rule that keeps being violated, in both directions

**Invalidate where the badness is OBSERVED.** Attempts to invalidate at a UI
button destroyed working credentials; attempts to invalidate at
`firePermanentFailureCallbacks` fired on TRANSIENT exhaustion too, where Google
never refused anything, and killed the precondition of the remote-heal strategy.

The correct reading is narrower than either: invalidate where GOOGLE HAS REFUSED,
which today is exactly two places — a Drive `401` (in `driveService.driveRequest`,
already shipped and kept) and an `invalid_grant` from the OAuth proxy. Not a
network exhaustion, not a UI intent, not a 404.

## Open defects, all currently live, none fixed

Confirmed across rounds 7 and 8. Written down so the next session starts from a
list rather than rediscovering them.

1. **A 404 + account mismatch on `write()` discards the user's edit.**
   `reconnectIfAccountMismatch()` THROWS past the arm that queues, so those bytes
   are never enqueued. Round 7 fixed it by queueing on the 404 — which flipped
   `flushQueue` from `declined` to `requeued` and thereby disabled the `critical`
   page for a permanently stuck queue. **Both the bug and that fix are wrong.**
   The suggested shape: `enqueueOfflineSave(content)` as the FIRST statement of
   the catch (single-slot, last-wins, therefore idempotent), plus `clearQueue()`
   on the in-catch success — five per-arm copies collapse to one and no future arm
   can forget. Verify the `enqueueSeq` interaction before adopting it.
2. **The 401 arm's in-catch retry can throw past every queueing arm below it**,
   and the trailing `throw e` discards the edit for every 403/400/429.
3. **An account mismatch reports a successful reconnect.** `tryReconnectSilently`
   returns true from `fromLocalToken` after refreshing the WRONG account's grant.
   A guard added for this compared a cached value with itself on the
   self-recovery path and read a pre-refresh cache elsewhere; it was reverted.
   Note `getVerifiedGoogleAccountEmail()` exists precisely because the plain
   getter can hold a primed guess.
4. **`accountMismatch()` and `matchesBoundAccount()` normalize differently** (raw
   `!==` versus trim + lowercase), so case drift makes the provider raise a banner
   the recovery then clears.
5. **`adopt` writes before validating.** Three guards were tried — "strictly
   newer", "provably older", and a rollback — and each failed: `issuedAt` is
   legitimately `null` on both sides, and the rollback could not run on the
   dominant path because `invalid_grant` had already cleared the previous token.
   The real fix is a "try this refresh token WITHOUT persisting" primitive, or
   capturing the previous token once at the top of `tryReconnectSilently`.
6. **The metadata probe does not classify its 404**, so a wrong-account user is
   told their file is missing. Round 7 classified it and caused a poll storm of
   ~18 requests/minute/device, invisible in CloudWatch, because the reclassified
   error removed the branch that STOPS the poll. Fix the poll's stop condition
   first, then the classifier.
7. **Strategy 3 (`fromRemoteDocCopy`) may be structurally unreachable.** Its
   stated precondition is "the cached access token is still live", but
   `tryReconnectSilently` returns at its first line whenever `isTokenValid()`.
   Decide it with the `healed-from-remote` counter over a release, then either
   delete the strategy or fix its entry condition. Do not defend it by argument.

## How to do this one differently

1. **Write the state machine down first** — states, transitions, and which
   component owns each piece of mutable state. Most of the failures above are two
   components disagreeing about who owns the answer.
2. **Build the fixtures from the producing code path**, never by hand. Round 6's
   reviewer found three broken fixes by DRIVING the real handler; the hand-written
   fixtures had a shape production never produces (see `docs/lessons.md`).
3. **One change, one round.** Every round that bundled several auth fixes shipped
   at least one regression.
4. **Check the test doubles.** Four unfaithful mocks were found across these
   rounds — a boolean returning `undefined`, a class without its `name`, a
   non-reactive store, a mock returning a retired type. Each converted a live
   defect into green CI.

## Explicitly out of scope

The registry ladder (stages 2/4/5) and the compaction/lineage work are settled and
should not be reopened here. Stage 6 has its own brief:
`docs/plans/2026-09-09-stage-6-preservation-brief.md`.
