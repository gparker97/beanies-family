# Regression review of the audit fixes — 15 findings

> Date: 2026-09-05
> Scope: `28a881de..74a23472` (the three fix commits), reviewed after they were
> pushed to `main`. Underlying series not re-reviewed.
> Companion: `docs/plans/2026-09-05-tier2-review-findings.md` (what each fix
> was meant to do).

**Verdict: several of the "fixes" are regressions, two of them worse than the
defect they replaced. Three bite TODAY with `podCompaction` off. The claim in
the companion doc that "all three termini now name every non-blocking action"
is FALSE, and two of the three test cases meant to pin it assert nothing.**

## LIVE TODAY (flag off — every user is exposed)

1. **`'parse'` promotes transient failure and version skew to a permanent latch.**
   `syncService.ts:1510`. A torn read (a `.beanpod` inside a Dropbox/OneDrive/
   iCloud folder — the code has `notifyIfConflictFile` for exactly that cohort)
   and `Unsupported beanpod version: 5.0` during any staged rollout are now
   `CorruptPayloadError(…, 'parse')`. `keyMayBeWrong` is `step === 'decrypt'`,
   so it latches, pages `#beanies-errors` at `critical`, refuses every save for
   the session, stops polling, and shows "your family data ... may be damaged.
   Trying again will not help. Contact support." For a pod that is fine.
2. **`mirrorServiceLatch` propagates a TRANSIENT merge failure into a permanent
   stop.** `syncStore.ts:3317`. `RemoteMergeError` wraps any non-payload throw,
   including a 120s HEAVY-RPC timeout on a busy worker. One transient timeout now
   ends background sync for the session behind "contact support", with nothing to
   re-arm it. Also `.catch(console.warn)` sits BEFORE the `.finally`, so a throw
   inside the mirror is an unhandled rejection every 10s.
3. **The adopt drop still precedes work that can throw.** `applyAndProject.ts:684`
   nulls `currentDoc` 13 lines before `headsOf(remote)` and 26 before
   `migrateDoc(remote)` — the latter runs a real `Automerge.change`. A throw
   there leaves the worker with NO document for the session while the projection
   still shows data: every mutate, save, getHeads and compactDoc fails. This is
   the exact second failure mode C-3/C-5 was written to remove, and it breaks
   lesson 19, written in the same commit. Fix: delete 684-687, make 709
   `if (adopt || !currentDoc)`.
4. **`commitRemoteBaseline`'s null-revision branch is asymmetric.**
   `syncService.ts:1174`. The revision branch deliberately writes a null
   `headsFp` when `driveHeads` is null ("cannot prove ⇒ never skip"); the new
   branch skips the assignment, leaving a stale fingerprint standing. Also mints
   a `checkedAt` for a trust window nothing probed.

## DORMANT until `podCompaction` is enabled (but they make the feature unusable)

5. **Terminus 4's context is ALWAYS `dirty`, so the guard can NEVER adopt.**
   `syncStore.ts:1162`. `load()` nulls the baseline then `learnRemoteMarker`
   hardcodes `headsFp: null`, so `getRemoteBaselineHeadsFp()` is always null →
   `'baseline-heads-unknown'` → `dirty` → `POLICY['adopt-remote']['dirty']` =
   **block**. The moment any device publishes a compaction, every peer's poll
   throws, latches and stops; manual Refresh loops forever. The `act === 'adopt'`
   branch beside it is dead code. This is precisely what `podLineage.ts:36-40`
   warns against. My fix turned an unguarded merge into a permanent block.
6. **Terminus 1 was never converted.** `syncStore.ts:959`
   (`replaceDocWithCacheRecovery`) still tests `=== 'adopt'`, so `publish-local`
   falls into a cross-lineage merge — on the documented failed-publish recovery
   path. The companion doc's claim is false.
7. **Both `publish-local` early returns skip `replaceEnvelope` /
   `preserveLocalKeyDicts`.** `syncStore.ts:1166`, `989`. The following save
   writes the LOCAL envelope over the remote, erasing a member, passkey or
   invite another device added — that member can no longer unlock the pod.
   Terminus 4 makes it systematic: it is only reached when a peer HAS written.
8. **`compactDoc`'s `pushProjection` still runs after the install, outside any
   try.** `applyAndProject.ts:982`. Strictly more allocation than the
   `saveDoc` I moved. The A2-1 window is still open; the new test throws only
   from `Automerge.stats` and misses it. `beforeStats`/`beforeBytes` (928-930)
   are also still unguarded.
9. **Eff-1 removed the only proof this device can WRITE** before the lineage is
   stamped, so a revoked-permission failure is discovered after the point of no
   return, with no save-failure banner and a self-repair it cannot perform.
10. **`isFullySynced` accepts an MTIME-basis "unchanged"** that
    `shouldSkipOpenRead` explicitly refuses, and A1-6 is what first lets the
    revision-less cohort reach that gate. A peer write inside the mtime granule
    → compaction publishes over it.

## STRUCTURAL / TEST INTEGRITY

11. **The S3 regression test asserts nothing.** `lineageWiring.test.ts:121`
    slices on `'\n}\n'`, which occurs ZERO times in `syncStore.ts` (every
    function closes at `  }` inside the `defineStore` setup), so `body` is the
    whole 178KB remainder. Deleting terminus 2 still leaves terminus 4's string
    in the slice. My mutation check passed for the wrong reason.
12. **`noteRemoteBlocked` dispatches by `instanceof` with no `else`**, while
    every gate now admits by duck typing — and `blockerDispatch.test.ts`
    explicitly asserts a duck-typed `FutureBlocker` passes the guard. Such an
    error refuses saves forever, arms nothing, shows nothing, and restores the
    C-4 poll loop.
13. **The L-1 refresh is read after a 3s race** while the merge it waits on is
    budgeted at 120s, so it still misses the slow case it was written for. And
    `doSave` refuses on `isRemoteBlocker`, which admits `keyMayBeWrong`, while
    `noteRemoteUnreadable` deliberately does not latch it — so that routine case
    refuses the save AND leaves the sign-out guard blind. No test covers it.
14. **Two outer catches were missed** (`syncStore.ts:3038`, `3178`), so a
    lineage block is filed as a network error with a raw untranslated English
    string in the UI — against the CI-enforced i18n rule.
15. **No `CHANGELOG.md` entry** for any of the three pushed commits, against the
    repo rule.

## Below the cap, recorded so they are not lost

`beforeStats`/`beforeBytes` unclassified; the alive-but-busy retry re-issues
`adopt: true` and discards a `mutate` that already landed; `loadFromFile`'s own
`parseBeanpodV4` is still unclassified so the two read paths give opposite
verdicts on the same torn pod; three cold-open surfaces receive a
`PodLineageError` they do not classify (`LoginPage` points at a credential fix
that cannot work); `hydrateFromEnvelope`'s adopt arm is dead code; the
`guardLineage` termini comment still says three; `mirrorServiceLatch` duplicates
four of `notePodUnopenable`'s five tail lines.

## FIXED (2026-09-05, all mutation-checked)

- **Live 1 + 2 — one structural fix.** `RemoteBlocker` gains `latches`.
  Refusing a save and arming the breaker are now different questions: a torn
  read, a newer-version pod, a wrong key and a worker timeout all refuse the
  save WITHOUT ending the session. `parse` also gets `podUnreadable.inline`
  instead of "may be damaged".
- **Live 3** — the adopt no longer nulls `currentDoc` up front; it lands as one
  assignment on `if (adopt || !currentDoc)` after everything that can throw.
- **Live 4** — `commitRemoteBaseline`'s null-revision branch is symmetric again
  (a null `driveHeads` CLEARS the fingerprint) and mints no invented `checkedAt`.
- **#6** — terminus 1 acts on `publish-local`.
- **#7** — all three `publish-local` returns call `replaceEnvelope` first.
- **#8** — `pushProjection` moved inside the try, old doc restored on failure.
- **#11** — `bodyOf` throws when its delimiter is absent and the test asserts the
  slice is function-sized; terminus 1 added to the list.
- **#12** — `noteRemoteBlocked` has an `else` arm.
- **#14** — both outer catches accept any blocker.
- **#15** — CHANGELOG entries added.

## FIXED (2026-09-05, second pass — all mutation-checked)

- **#5** `loadFromFile` captures the baseline fingerprint BEFORE `load()`
  destroys it, so terminus 4 can answer `clean` and therefore ADOPT. Reading it
  after the download could only ever say "unknown" → dirty → block.
- **#13** The sign-out guard no longer asks "is the remote unreadable" (a latch
  read after a 3s race against a 120s merge, which the recoverable classes never
  arm anyway). It asks whether the DOCUMENT still holds work Drive has not got,
  measured after the final save: provider-agnostic, unraceable, and indifferent
  to why the save did not land. Unmeasurable reads as dirty. Both directions
  tested — an over-cautious guard that never deletes would defeat the tier.
- **#10** Compaction PULLS UNCONDITIONALLY rather than trusting the change
  probe. Requiring a revision basis would have locked local-file families out
  entirely (A1-6 in reverse); removing the trust closes the hole for every
  provider at the cost of one download on a rare, user-initiated, one-way
  operation. The expensive half of Eff-1 (skipping a pointless upload) survives.
- **#9** An explicit `hasPermission()` gate before anything moves, replacing the
  accidental write proof the removed upload used to provide.

### Judgement call worth revisiting

Sign-out now keeps the encrypted local database whenever the final save does not
demonstrably complete, including when it is merely slow. Keeping it costs
nothing; deleting it can cost a session of edits. The trade-off is that a slow
sign-out on a shared device leaves cached data behind. Product decision.

## STILL OPEN — needs design, not patching (all dormant behind the flag)

None. All four are fixed above. What remains before `podCompaction` is enabled
is not code but EVIDENCE: nobody has yet opened a compacted pod on the tablet,
or watched two devices go through a compaction. 6261 green tests and two audits
are not that evidence.

## Order of work

1. The four LIVE items, immediately.
2. Test integrity (11, 12) — nothing else can be trusted until the harness is.
3. The dormant lineage set as ONE batch, before the flag is ever enabled.
4. Only then Tier 3.
