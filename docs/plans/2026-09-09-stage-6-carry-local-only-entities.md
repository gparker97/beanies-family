# Plan: stage 6 — carry local-only entities across a clean lineage adopt

> Date: 2026-09-09
> Parent plan: `docs/plans/2026-09-08-compaction-fallout-remediation.md` § 5
> Brief: `docs/plans/2026-09-09-stage-6-preservation-brief.md`
> Investigation: `docs/investigations/2026-09-08-compaction-fallout.md` § "STAGE 6"
>
> **No GitHub issue created.** Approved for direct implementation.
>
> **Line numbers in this plan are indicative only — prefer the symbol names.** The
> files involved are dense and churn; every reference below names the function or
> constant so it stays findable after drift.

## User Story

As a family member whose phone was on an older beanies when the family's pod was
compacted, I want the new items I created on that phone to survive the upgrade,
so that a to-do I added while my device was stale does not silently disappear the
first time it syncs.

## Context

Compaction rebuilds the family document from a snapshot via
`Automerge.from(Automerge.toJS(doc))`, which mints brand-new object ids. The
compacted pod therefore shares **no ancestry** with the pre-compaction document,
so the two can never be CRDT-merged; they can only be adopted wholesale.

Two paths reach that wholesale adopt and they look identical. Only one is broken:

- **Path A — already fixed, works, do not touch.** Both devices on 0.17, device B
  offline, edits, returns after a compaction. B's baseline is HONEST, so
  `lineageContextFor` answers `dirty`, `POLICY['adopt-remote'].dirty = 'rebase'`,
  and `rebaseOntoRemote` replays the edits.
- **Path B — mary's case, NOT fixed, this plan.** Her phone was on 0.16, which
  cannot READ a 5.0 pod but whose save path wrote over it anyway and then
  committed a baseline stamped with ITS OWN heads. That baseline is a lie. On
  upgrading to 0.17 the heads compared equal, `lineageContextFor` answered
  `clean`, `POLICY['adopt-remote'].clean = 'adopt'`, and the wholesale install ran.
  The rebase never fired — not because it is broken, but because the device
  believed it had nothing to replay.

The loss line is the `const adopted = migrateDoc(remote)` install inside
`mergeRemoteEnvelope`'s `if (installWholesale)` branch (`applyAndProject.ts`, ~`:1153`).

### What this is worth, honestly

| local change on the stale device               | recoverable?                                                                                                                             |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| a NEW entity                                   | yes — this is the whole feature                                                                                                          |
| an EDIT to an entity that exists in both       | no — the adopt replaces the entity and there is no basis to pick a winner                                                                |
| a DELETION                                     | no — it would resurrect                                                                                                                  |
| **a PEER's delete this device never received** | **resurrects, and this feature is what resurrects it.** Bounded by the compaction→upgrade window; the user deletes it again. See trap 4. |

The benefit shrinks as the fleet updates. **That table is the whole value.**

### ⚠️ The brief's second justification is FALSE, and it is corrected here

The brief, and `docs/STATUS.md` twice (`:2097-2099` and `:2222-2225`), claim: _"Its value went UP: the
orange lineage banner only appears when the automatic rebase could not run, and
what stops the rebase is a missing baseline, exactly what the stage-6 carry does
not need. It is the lever that makes that banner rare."_

**It is not that lever, and it cannot be.** Verified against the code:

- The banner means exactly two things (`LineageBanner.vue:18-30`): `conflict`, or
  `rebaseUnavailable`.
- `rebaseUnavailable = true` is set in exactly one place, `applyAndProject.ts:1114`,
  **inside `if (act === 'rebase')`** (`:1064`).
- `act === 'rebase'` is reachable only from `adopt-remote × dirty` and
  `adopt-remote × user-file` (`POLICY`, `podLineage.ts:175`).
- This plan is scoped to `adopt-remote × clean`.

The carrying cell and the banner-raising cells are **disjoint by construction** —
the very construction trap 1 relies on. This plan shrinks banner case 2 by
**zero**.

Consequences, all applied below:

1. The justification is struck. Stage 6 is worth doing for the Context table and
   nothing more, and it must not be sold on a benefit it does not deliver.
2. `LineageBanner.vue`'s doc comment currently says this brief _"would shrink case 2
   further by carrying local-only entities across"_. That forward-looking claim is
   also false for the same reason, and it sits in the most-read explanation of when
   the banner appears. It is corrected to point at the design that WOULD do it,
   explicitly not at this one.
3. **The real follow-up, recorded so it is not lost:** a _baseline-independent carry
   on the `rebaseUnavailable` fallback_ — converting that block into adopt-plus-carry
   — genuinely would shrink case 2. It is a different and larger change, and it
   trades away the "your work is still yours" promise for edits to shared entities,
   so it needs its own decision. **Not in this plan.**

## Requirements

1. On `verdict === 'adopt-remote' && lineageCtx === 'clean'` **only**, carry
   entities that exist in the local document and are absent from the adopted
   remote into the adopted document, before it is installed.
2. Credential and roster collections are NEVER carried. The exclusion set is a
   compile-time-total map so a new collection cannot be added without a decision.
3. The carry is additive only: no deletes, no field merges, no conflict
   resolution. Every id written is absent from the target by construction.
4. Both `user-file` adopt cells and the whole `same` POLICY row are **byte-identical
   to today**. No new refusal may be raised on any cell.
5. A carry that fails for any reason falls back to **today's behaviour** (a plain
   wholesale adopt), never to a block. The document must be structurally untouched
   on a throw, and the failing error class must be recorded — never swallowed.
6. The carried entities must actually reach Drive, not merely the local document.
7. The user is told, once, non-latchingly, when entities were carried.
8. CloudWatch can answer "how often does a scoped adopt carry, and how much"
   without a repro — including the zero case, so the rate is measurable.
9. `§5b`: regression tests pinning that `doSave` refuses and commits no baseline
   on an `UnsupportedBeanpodVersionError`, and that the error satisfies
   `isRemoteBlocker`. This closes the 0.16 hole against a future refactor of the
   error hierarchy.

## Important Notes & Caveats

### The traps, in the order they will bite

1. **`act === 'adopt'` is reached from THREE policy cells, not one** (`POLICY` in
   `podLineage.ts`, ~`:175-177`):

   | verdict        | context     | action  |                               |
   | -------------- | ----------- | ------- | ----------------------------- |
   | `adopt-remote` | `clean`     | `adopt` | ← the only target             |
   | `ours-newer`   | `user-file` | `adopt` | the restore / rollback route  |
   | `conflict`     | `user-file` | `adopt` | concurrent-compaction resolve |

   The two `user-file` cells are the deliberate rollback route, and
   `LineageBanner.vue` (~`:43`) calls that adopt "the only exit there is". An
   unscoped guard would refuse the exit offered by the banner that the refusal
   raises — a state the user cannot leave, created by a safety feature, on the
   device holding the at-risk data. Scoping on `verdict === 'adopt-remote' &&
lineageCtx === 'clean'` excludes both **by construction**, not by inspection.
   `guardLineage` returns both halves precisely so a caller can do this without
   recomputing either.

2. **The `same` row of the POLICY table stays byte-for-byte `merge`.** A
   never-compacted pod must behave exactly as today, by the shape of the table.
   **`POLICY` itself is not modified.** `podLineage.ts` gains two exported pure
   predicates beside it — see Deviation 5.

3. **§5a's "adopt rescue" is DELETED as provably unreachable** (parent plan C1).
   `clean` IS `headsEqual(basis.heads, headsOf(doc))` in `lineageContextFor`, so
   `buildRebaseOps` returns zero ops by construction. **The `if (act === 'rebase')`
   block is NOT touched by this work.** C1's other half also binds this plan:
   it rejected adding _a second `migrateDoc(remote)` pass to every clean adopt in
   the fleet_. See "one migrate, not two" in Approach § 2.

4. **False positives are EXPECTED, and the exposure is not marginal.** Any entity
   deleted on a peer and never merged here reads as local-only, so the carry
   resurrects it. And the target population is precisely devices whose merge has
   been broken for the WHOLE window between the compaction and the app update —
   days to weeks of peer deletions, not a rare race.

   There is no cheap discriminator: `PodLineage` is `{ id, seq }` only, so there is
   no compaction timestamp to compare `createdAt` against, and no shared ancestry
   to diff. The exposure is real and unmitigable at reasonable cost.

   It is still the right trade, and this is why: a false positive costs a
   resurrected entity the user can delete again — recoverable — whereas the
   alternatives are silent loss (today) or a device the user cannot un-latch
   (blocking). **The toast copy is written to be honest about this**, and a test
   pins the resurrection as INTENDED behaviour so nobody later "fixes" it as a bug.

5. **No cap on the carried count, deliberately.** Any cap is a number nobody can
   justify, and the only thing above it is the loss being fixed. `count` rides to
   CloudWatch so the distribution is observed rather than guessed.

6. **Neither `materialize()` nor `structuredClone` is the tool** (parent plan C2,
   C3). `materialize()` does not exist. `materializeCollection` (`docOps.ts:429`)
   _does_ exist and returns `toPlain`-ed `[id, entity]` pairs — but it is
   **deliberately not used here**: it eagerly clones EVERY entity in a collection,
   including the overwhelming majority that are present in the target and will be
   discarded. On a 5000-transaction family that is 5000 wasted deep clones per
   clean adopt, on the cold-load critical path, to carry nothing. The manual loop
   clones only what it actually carries. `structuredClone` is wrong for a different
   reason (C3): the cited precedent clones a plain object, not an Automerge value.
   The composer therefore uses module-private `toPlain` (`docOps.ts:47`) and so
   lives in `docOps.ts`. **Noted, not blocking:** that file is already ~1000 lines
   holding crypto, payload classification, loan amortization, the named-op registry,
   the projection materializers and the rebase composer. If a fourth composer
   arrives, the cheap unlock is moving `toPlain` to a leaf util and splitting the
   lineage composers into a sibling module.

### Deviation 1 — on a carry throw, adopt; do NOT block

The parent plan's § 5 says: _"raising `lineageBlockError('adopt-remote')` there is
honest and the banner's adopt exit still works."_ **This plan does not do that**,
and the brief's own acceptance criterion agrees with this plan: _"A carry that
throws leaves the document untouched and falls back to today's behaviour."_

Reasoning:

- A deterministic throw in the carry composer (a malformed entity, an Automerge
  edge) would latch **every device in the fleet** on the propagation path, so a
  compaction could never reach a peer. `podLineage.ts` names that exact failure as
  the reason `clean` adopts everywhere: _"classifying that as 'mid-session, block'
  means every peer in the fleet latches and none ever adopts."_ Turning a
  best-effort enhancement into a hard block on failure inverts the risk profile.
- Blocking is worse than today on a cell that today never refuses. Adopting is
  exactly today's behaviour, i.e. no regression.
- It is the same principle trap 4 already states: prefer a recoverable cost over
  a latch.

**And that is a decision, not a silent failure.** The distinction matters because
requirement 5 could otherwise be read as swallowing an error:

- the catch records the error CLASS (`e.name`) and returns it, so
  `adopt-carry-failed` carries `error_code` rather than "something threw";
- it `console.warn`s with the error object — the worker's only local channel, the
  same one `rebaseOntoRemote` and `raiseCachePersistFailure` already use;
- **no user-facing error is shown, deliberately.** The user is left exactly where
  today's code leaves them; nothing was lost _relative to the status quo_. Alarming
  someone about a best-effort enhancement that failed to improve their position
  would be worse than saying nothing, and there is no action they could take.

If `adopt-carry-failed` ever climbs, that is the signal to revisit — with data.

### Deviation 2 — the composer returns `{ op, count }`, not a bare `MutationOp`

The brief's signature line says `: MutationOp` but its own usage snippet reads
`carryFrom ? buildLocalOnlyCarryOps(...) : { op: null }`. The two disagree.
`{ op: MutationOp | null; count: number }` serves both, matches `buildRebaseOps`'s
established shape one screen above it in the same file, and supplies the `count`
requirement 8 needs. `conflicts` is deliberately absent: an additive-only composer
has no conflict to count, and a field that is always `0` invites a reader to
believe conflicts were checked for.

### Deviation 3 — the carry event fires on the zero case too

The brief emits `adopt-carried-local-only` only on a carry. CLAUDE.md's
observability rule 6 requires the counter on the success path so _rates_ are
measurable. The `adopted` action alone is a poor denominator — it also counts
first-load adopts and both `user-file` adopts. Emitting the event whenever the
scope held, with `count` possibly `0`, makes the denominator exactly "scoped clean
adopts" and the numerator "those that carried". One extra `info` event per
compaction per device; compactions are rare.

### Deviation 4 — the report goes in the `mergeRemoteEnvelope` wrapper, not `logMergeTerminus`

The brief implies the terminus. Putting it there would be **scoping by inspection**,
which trap 1 exists to forbid: it is true today that all three carrying paths call
`logMergeTerminus`, but an eighth `mergeRemoteEnvelope` call site added later would
silently lose both the event and the toast.

`docClient.mergeRemoteEnvelope` already has the house pattern for exactly this —
`noteRebaseUnavailable(familyId, res.action)` is emitted from the wrapper, for every
caller, beside `noteDocInstalled()`, and _deliberately not_ from `logMergeTerminus`.
A sibling `noteLocalOnlyCarry(familyId, res)` follows it.

This also dodges a landmine the brief could not have known about:
`syncService.ts` (~`:1697-1703`) declares its **own fourth hand-written copy** of
the merge-result shape for the `merged` variable it passes to `logMergeTerminus`.
Threading `carried` through the terminus would require widening that copy too, and
any future refactor that rebuilds the object there would drop the field silently.
The wrapper reads `res` directly and is immune.

### Deviation 5 — the merge-outcome shape is declared ONCE, in `protocol.ts`

Deviation 4 documents a landmine and then walks around it. That is not good enough:
the same shape is hand-copied **five** times today, and this plan would widen two of
them with the same two fields.

| copy                            | location                     |
| ------------------------------- | ---------------------------- |
| worker return type              | `applyAndProject.ts:893-909` |
| `docClient` declared return     | `docClient.ts:1295-1305`     |
| `docClient` local `MergeResult` | `docClient.ts:1321-1330`     |
| `MergeTerminusOutcome`          | `docClient.ts:1402-1406`     |
| `syncService` local `merged`    | `syncService.ts:1697-1703`   |

So step 0 is a **type-only, zero-runtime** unification: declare `MergeOutcome` in
`protocol.ts`, which is already the cross-boundary contract module (`Heads`,
`LineageBasis`, `MutationOp`, `ProjectionDelta`, `ExportedPayload` all live there).
**Unify the THREE contract copies only** — the worker return, `docClient`'s declared
return, and `docClient`'s local `MergeResult` (deleted outright). Those three must
agree exactly; they describe one wire contract.

**`MergeTerminusOutcome` stays exactly `Pick<MergeOutcome, 'action' | 'replayed' |
'conflicts'>` — those three keys and no more.** `docClient.test.ts:247`, `:264` and
`:274` pass fresh object literals (`{ action: 'merged' }` and friends); widening the
Pick to include `heads` / `dirty` / `changed` / `remoteHeads` breaks all three.
`carried` / `carryFailed` are deliberately NOT in it: the report is emitted from the
wrapper (Deviation 6), so the terminus never needs them.

**Leave the two consumer-side views deliberately looser, with a pointer comment.**
Verified: `tsconfig.app.json` includes `src/**/*.ts`, so tests ARE type-checked, and
both of these are wider than the contract _on purpose_:

- `syncService`'s local declares `remoteHeads: string[] | null` and destructures
  `const { dirty, remoteHeads } = merged`. `syncStore`'s sibling reads carry the
  comment _"`?? true` is deliberate, not defensive noise: an absent field means we do
  not KNOW the outcome, and both unknowns must resolve to the safe direction… It also
  keeps older/partial test doubles honest instead of silently disabling the reload."_
  Tightening to `Heads` makes those null branches dead and deletes a documented
  safety posture to satisfy a DRY count.
- `MergeTerminusOutcome` is documented as a _"structural subset of the outcome"_ with
  only `action` required, so partial doubles keep working.

**The nullability decision, made here rather than discovered later:** `syncService`'s
local **keeps `remoteHeads: string[] | null`**, written as
`Pick<MergeOutcome, 'action' | 'dirty' | 'replayed' | 'conflicts'> & { remoteHeads: Heads | null }`.
Picking the contract's non-null `Heads` would make `commitRemoteBaseline(remoteHeads ?? null)`
(`syncService.ts:1819`) provably dead. It compiles either way — there is no
`no-unnecessary-condition` rule configured — which is exactly why the choice has to
be explicit: that `??` is the documented fail-safe idiom shared with
`syncStore.ts:1443` and `:1768-1770`.

DRY applies to the contract, not to deliberately-divergent views of it. Each of the
two keeps a one-line comment naming `MergeOutcome` as the source of truth and saying
why it is looser, so the divergence is a decision a reader can find.

This _shrinks_ the diff for the two new fields (one declaration instead of two), and
removes the landmine instead of stepping around it. It also satisfies P10's
requirement that the worker's declared `Promise<{…}>` return type be widened —
excess-property checking on the returned literal makes that mandatory, and it now
happens in one place.

### Deviation 6 — the report is emitted from a `finishMerge` helper, at BOTH returns

`docClient.mergeRemoteEnvelope` has **two** return points, not one: the
recovery re-issue (`:1384-1387`) and the normal path (`:1391-1398`). Both already
run the same three calls (`noteRebaseUnavailable`, `noteDocInstalled`,
`bumpOpenCycle('reconstruction')`) — an existing three-line duplication.

Resolving the second return with _a comment asserting the re-issue's basis is always
`no-local-document`_ would be scoping by inspection, which is the exact thing
Deviation 4 rejects. So all four calls move into one private
`finishMerge(familyId, res)` used at both returns. The new report becomes
structurally unmissable, and an existing duplication disappears. The "the re-issue
is always `no-local-document`, so `carried` is absent" fact stays as a comment,
because it is useful — just not as the mechanism.

### Deviation 7 — the scoping predicate lives beside `POLICY`, not 900 lines away

`podLineage.ts` states its own contract: _"A switch at each of the three consumers
would be the same policy written three times… this module owns what the verdicts
MEAN."_ `applyAndProject.ts:1039` already breaks that once — `stampNewGeneration`
hand-writes the `ours-newer × user-file` cell as an anonymous triple. This plan
would add a second. If a fifth verdict or fourth context ever appears, both
predicates keep compiling and silently mean something else.

So `podLineage.ts` gains two **exported pure predicates beside `POLICY`**, with the
policy reasoning attached to them:

```ts
export function isCleanCompactionAdopt(verdict: LineageVerdict, ctx: LineageContext): boolean;
export function isLineageRestore(verdict: LineageVerdict, ctx: LineageContext): boolean;
```

**And both new names are added to the eslint `importNames` list.** Verified: the
`no-restricted-imports` zone (`eslint.config.js:371-399`) restricts only
`guardLineage` / `compareLineage` / `lineageAction`, and ignores
`applyAndProject.ts`, `podLineage.ts` and `**/__tests__/**`. A new export would
therefore be importable from main-thread code and lint clean, letting someone
re-derive lineage policy outside the worker — the thing ADR-036 exists to prevent.
Both call sites and the definition are inside the `ignores`, so closing the surface
costs one line and breaks nothing. **This is hardening, not a fix:** nothing today
imports them, so the build is green either way. It is done because the rule's stated
scope is "the guard's legitimate home is the WORKER and nowhere else", and a new
policy export that sits outside that scope would quietly contradict it.

`POLICY` itself is untouched. Both call sites in `applyAndProject` use them —
migrating `stampNewGeneration` too, because leaving one extracted and one inline is
the worst of the three options: a reader cannot tell which is canonical. It is a pure expression move, behaviour-identical, and the existing restore tests
(which assert `seq === 2` and the minted id) pin the behaviour.

**Honest about the benefit:** a `(verdict, ctx) => boolean` gives no more
compile-time protection against a fifth verdict than the inline `&&` chain did. The
real gains are co-location with the table whose meaning they encode, and that they
become _testable in one place_ — so `podLineage.test.ts`, which already owns the
12-cell policy table, gains **one exhaustive test asserting each predicate is `true`
for exactly one of the 12 `verdict × context` cells**. Without that test the
extraction would leave the policy _less_ pinned than the expressions it replaced,
which would make it a net loss.

### Deviation 8 — declining the `installAdopted` extraction, and recording the threshold

Pass 3 proposed extracting the whole wholesale-install branch into
`installAdopted(remote, plan: AdoptPlan)` with a discriminated union, so that
"`stampNewGeneration` and `carryFrom` can never both be set" becomes a type property
rather than a comment. **Declined for this change**, deliberately:

- `mergeRemoteEnvelope` is, on the brief's own account, _"the highest-risk code in
  the plan"_, and passes 3 and 4 of the parent plan each found a serious defect in an
  earlier draft of this exact change. Restructuring the **restore path** — the
  rollback route that "must never dead-end" and that acceptance criterion 4 requires
  to behave identically — in order to tidy a combination that is already impossible
  is the wrong risk trade.
- The exclusivity is a two-line proof (`clean` and `user-file` are different values
  of the same variable), and it is pinned _behaviourally_ by the restore test
  asserting `carried === undefined`. That is a test, not a comment.

What IS taken from it: `carryFrom` is nulled the moment it is consumed (see § 2), so
the pre-adopt document's lifetime does not grow.

**The threshold, recorded so this is a decision and not drift:** if a sixth
adopt-time decision arrives — a third hoisted mutable threaded from the guarded
block into the install branch — extract `installAdopted` then. Five is the ceiling.

`MergeTerminusOutcome` keeps its name and `logMergeTerminus` keeps its behaviour;
only their declaration source changes (Deviation 5).

### Verified facts this plan rests on

- **`count` IS allowlisted** (`ALLOWED_CONTEXT_KEYS`, `diagnosticContext.ts`, added
  2026-09-02), as are `action`, `family_id` and `error_code`. The comment in
  `settingsStore.ts` (~`:336`) saying `count` is not allowlisted is **stale** and
  predates that addition; it is corrected in this commit rather than left as a
  landmine for the next author who greps for it. **No new context key ships**, so
  no store-privacy declaration update is required.
- **No collection holds binary.** `grep -c 'Uint8Array\|ArrayBuffer\|Blob'
src/types/models.ts` is `0`; `PhotoAttachment` is all scalars and keeps its bytes
  in Drive behind `driveFileId`. `toPlain`'s JSON round-trip is therefore lossless
  for every carried entity.
- **A throwing `Automerge.change` leaves its input usable.** `_change`'s catch is
  `state.heads = void 0; state.handle.rollback(); throw e`, so the document passed
  in is rolled back and still writable. This is why the fallback can reuse
  `adopted` rather than re-deriving it.
- **`UnsupportedBeanpodVersionError`** extends `PayloadLoadError`, which
  `implements RemoteBlocker`. `isRemoteBlocker` is structural (`blockCode` +
  `inlineMessageKey` are strings), so it answers `true`. Its step is hardcoded
  `'parse'`, so `latches === false` — it refuses the save without latching the
  breaker, which is correct and is what the test must pin.
- **`doSave`'s ordering is already correct.** The blocker `throw e` is in
  `fetchAndMergeRemote`'s catch inside `doSave` (~~`:1887-1908`);
  `provider.write` (~~`:1963`) and `commitRemoteBaseline` (~`:2019`/`:2034`, both
  reaching `docClient.noteRemoteBaseline`) are all downstream. §5b is therefore a
  **regression test plus tripwire**, not a fix. (The parent plan cites `:1981` for
  the commit; the real line is `:2019`.)
- **The refresh-token exclusion evidence** is `DriveConnection.refreshToken`
  (`models.ts:1196`) and `CalendarConnection.refreshToken` (~`:1108`) — not
  `docOps.ts:817-824` as the parent plan cites, which is `buildRebaseOps`'s patch
  emit. `DriveConnection.id` is _the normalized account email_, so these records
  are PII as well as credentials.
- **Prior art for a total map.** `preserveLocalKeyDicts` (`envelopeMerge.ts:68-97`)
  is the _envelope_ version of this same idea, and its own Pass-4 comment —
  "`preserveLocalKeyDicts`' shape SILENTLY DROPS any dict it doesn't name" — is the
  strongest available argument for `CARRY_LOCAL_ONLY` being total rather than an
  allowlist. This design is house style, not invention.

## Assumptions

1. `currentDoc` at the moment of a scoped adopt is a migrated document — it was
   migrated when installed. The adopted target is `migrateDoc(remote)`. Both
   therefore hold every key in `COLLECTION_NAMES`. The `?? {}` guard in the
   composer is belt-and-braces for a legacy shape, not a live path.
2. A carried entity's references resolve to states that all degrade rather than
   throw:
   - present in the remote — the common case;
   - itself local-only in a carried collection, and therefore also carried;
   - **a member id in the excluded roster** — leaves the same dangling member
     reference an ordinary member deletion already produces, which the projection
     already renders as unassigned;
   - **a `photos` entity** (carried) whose `driveFileId` bytes were never uploaded
     from the stale device, or whose Drive file has since been swept. `gcOrphans`
     already handles `DriveFileNotFoundError`, so this degrades rather than throwing.

   **`photos` is exempt from trap 4 entirely, which is better than assumed.**
   `PhotoAttachment.deletedAt` is a _tombstone_, so a peer's photo delete leaves the
   KEY PRESENT in the remote — the carry's "absent from target" test skips it and no
   photo is ever resurrected.

   The first bullet is pinned by test 12. The reference-resolution bullets are
   reasoning resting on the renderer's existing unassigned-member handling, not new
   test pins — an earlier draft over-claimed here (see Testing Plan, test 12).

3. `showToast`'s dedupe means a repeated identical carry toast in one session
   collapses. Acceptable — the count is in the title, so two different counts both
   show.
4. The fleet is small enough that one extra `info` event per compaction per device
   is immaterial against the 50/surface/min limiter. Compactions are rare.

## Approach

### 1. `docOps.ts` — the exclusion map and the pure composer

Add beside `buildRebaseOps`.

```ts
/** Which collections may be carried across a lineage adopt.
 *  `false` is not a default — every entry is a decision, and a new collection
 *  fails to compile until someone makes one. The total-map shape (rather than an
 *  allowlist array) is the lesson `preserveLocalKeyDicts` left behind: a shape
 *  that silently drops what it does not name is how the last one of these went
 *  wrong. */
const CARRY_LOCAL_ONLY: Record<CollectionName, boolean> = {/* 29 entries */};
```

**Every rationale goes INLINE in the map, not only in this plan.** The safety
argument is "a new collection fails to compile until someone decides" — but the
person adding collection #30 opens `docOps.ts`, not `docs/plans/`. So the map
carries a one-line `//` on each of the six `false` entries, a grouped comment over
the `true` block, and two rules in its doc comment:

> A new `true` entry requires checking that the entity holds no credential, token or
> address. `driveConnections` (`models.ts:1196`) and `calendarConnections`
> (`~:1108`) both do.
>
> `notificationReads` is `Record<string, Record<string, string>>`, not an entity map,
> so flipping it to `true` would `set` a whole per-member dict wholesale. The type
> cannot catch that.

The 29 decisions — 23 `true`, 6 `false`, exactly accounting for
`COLLECTION_NAME_SEED`:

| collection                                                                                                                                                                                                                                                               | carry | why                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `accounts` `transactions` `assets` `goals` `budgets` `recurringItems` `todos` `lists` `activities` `vacations` `photos` `favorites` `sayings` `memberNotes` `allergies` `medications` `medicationLogs` `milestones` `recipes` `cookLogs` `mealPlans` `emergencyContacts` | true  | user work — the thing being rescued                                                                                                                                                                                                                          |
| `listCycles`                                                                                                                                                                                                                                                             | true  | write-once cycle history (`models.ts:749-755` — never patched, no resurrection hazard); a real user record                                                                                                                                                   |
| `driveConnections`                                                                                                                                                                                                                                                       | false | **SECURITY.** Holds `refreshToken` and is keyed on the account email (`models.ts:1191-1201`), and §1d now READS remote `driveConnections` to heal — carrying a dead one republishes it fleet-wide. Item 5's exact bug, made out of this plan's own parts.    |
| `calendarConnections`                                                                                                                                                                                                                                                    | false | **SECURITY.** Also holds a `refreshToken` (~`:1108`), and carries `needs_reconnect`, recorded in §11 as a cross-device amplifier.                                                                                                                            |
| `familyMembers`                                                                                                                                                                                                                                                          | false | **SECURITY.** A resurrected member feeds `normalizeRoles` owner promotion AND stage 5's roster-owner lookup, which is now live.                                                                                                                              |
| `calendarEventLinks` `notificationReads`                                                                                                                                                                                                                                 | false | device/sync bookkeeping, not user work                                                                                                                                                                                                                       |
| `overlapAcknowledgments`                                                                                                                                                                                                                                                 | false | bookkeeping keyed on `connectionId` into the excluded `calendarConnections` (`models.ts:1219`), so a carried ack is incoherent by construction. And it SUPPRESSES a scheduling-clash warning: re-asking costs a tap, wrongly silencing costs a missed clash. |

```ts
/** Ops that re-add entities present locally and absent from the target.
 *  Baseline-independent: it compares the two DOCUMENTS, never a heads baseline,
 *  which is the whole point — the baseline is the thing that lied.
 *
 *  ⚠️ IT EMITS `set` OPS ONLY, AND THE CALLER'S ATOMICITY DEPENDS ON THAT.
 *  `applyMutation`'s rollback-on-throw protects the input document only for a
 *  throw INSIDE the `Automerge.change` callback. On SUCCESS, Automerge marks the
 *  input doc OUTDATED, so a throw AFTER the commit would leave the caller
 *  installing an outdated document and every later mutation in the session would
 *  throw "Attempting to change an outdated document". Today that is unreachable
 *  precisely because this composer emits only `set`: `deltaFor`'s `set` case just
 *  pushes `op.entity` and cannot throw, whereas the `patch`/`increment` case calls
 *  `toPlain(raw)` post-commit and can. **Adding a `patch` op here is therefore a
 *  CORRECTNESS change, not an optimisation.**
 *
 *  ⚠️ NOT `materializeCollection`. That would `toPlain` every entity in the
 *  collection, including the ones present in the target that we discard — a full
 *  deep clone of the family's whole document on every clean adopt, to carry
 *  nothing. This clones only what it carries. */
export function buildLocalOnlyCarryOps(
  local: Doc,
  target: Doc
): { op: MutationOp | null; count: number } {
  const ops: MutationOp[] = [];
  for (const collection of COLLECTION_NAMES) {
    if (!CARRY_LOCAL_ONLY[collection]) continue;
    const localColl = (local[collection] ?? {}) as AnyRecord;
    const targetColl = (target[collection] ?? {}) as AnyRecord;
    for (const id of Object.keys(localColl)) {
      // ⚠️ SKIP BEFORE YOU CLONE. `toPlain` is a `JSON.parse(JSON.stringify())`
      // DEEP CLONE, so testing the target first means we clone only what we
      // actually carry. This is the same and only reason `materializeCollection`
      // is rejected below: it clones every entity in the collection up front.
      //
      // ⚠️ AND THE REASON IS *NOT* MATERIALIZATION. `Automerge.load` materializes
      // the whole document into plain JS at load time (`implementation.js`
      // `handle.materialize("/")`), and `docInitOpts` sets no `patchCallback` and
      // no lazy path, so `localColl[id]` is an ordinary property read. Reordering
      // saves a deep clone, not a materialize. (`countEntities`'s "reads proxy
      // keys, not full materialize" comment is loose in the same way; it really
      // means "does not deep-clone".)
      if (targetColl[id] !== undefined) continue;
      // No `undefined` guard: `Object.keys` guarantees the key is present, so
      // unlike `buildRebaseOps` (which iterates a DIFF SCAN, where a deleted id
      // legitimately reads `undefined`) this loop cannot see one. If one somehow
      // appeared, Automerge refuses to store `undefined` and `carryLocalOnly`'s
      // catch degrades to a plain adopt — safe either way.
      ops.push({ op: 'set', collection, id, entity: toPlain(localColl[id]) });
    }
  }
  if (ops.length === 0) return { op: null, count: 0 };
  return { op: ops.length === 1 ? ops[0]! : { op: 'batch', ops }, count: ops.length };
}
```

Iterating `COLLECTION_NAMES` rather than `Object.keys(local)` is what makes it
structurally impossible to touch `settings` or `podLineage`: `MutationOp`'s
`collection` is typed `CollectionName`, which excludes both, and this loop can only
produce names from that list. Same belt `buildRebaseOps` already documents.

### 2. `applyAndProject.ts` — scope, compose, install once

**A private helper mirroring `rebaseOntoRemote`**, placed beside it, so the install
branch does not grow a second inline try/catch:

```ts
/** Carry the stale device's local-only entities into the document being adopted.
 *
 * ⚠️ ONE MIGRATE, NOT TWO. Unlike `rebaseOntoRemote` — which derives its own
 * `migrateDoc(remote)` — this takes the ALREADY-MIGRATED target, because parent
 * plan C1 rejected adding a second `migrateDoc` pass to every clean adopt in the
 * fleet. Reusing that same `target` on the failure path is safe ONLY because
 * `buildLocalOnlyCarryOps` emits `set` ops exclusively, so every throw is inside
 * the `Automerge.change` and is rolled back — see the ⚠️ on that function.
 *
 * ⚠️ AND "JUST RE-MIGRATE ON FAILURE" IS NOT THE FIX A READER WILL REACH FOR.
 * `migrateDoc` returns its input unchanged when nothing is missing, but calls
 * `Automerge.change` otherwise — so on a legacy remote a second call would throw
 * on an already-progressed input. There is no cheap fresh target here.
 *
 * ⚠️ NEVER THROWS, and never returns a block. A carry is best-effort: falling
 * back to a plain adopt is exactly today's behaviour, whereas refusing would
 * latch every device on the propagation path and a compaction could never
 * propagate. The error CLASS is returned so it reaches CloudWatch. */
function carryLocalOnly(
  local: Doc,
  target: Doc
): { doc: Doc; carried: number } | { failed: string } {
  try {
    const ops = buildLocalOnlyCarryOps(local, target);
    if (!ops.op) return { doc: target, carried: 0 };
    return { doc: applyMutationOp(target, ops.op).doc, carried: ops.count };
  } catch (e) {
    // The worker cannot reach logEvent/reportError; the console is its only local
    // channel, and the returned class is what actually reaches CloudWatch.
    console.warn('[applyAndProject] local-only carry failed — falling back to a plain adopt:', e);
    return { failed: e instanceof Error ? e.name : 'UnknownError' };
  }
}
```

Hoist the scope beside `stampNewGeneration`, initialised `null`:

```ts
/** The local document to carry local-only entities from, or null when this is
 *  not the scoped case. A `Doc` rather than a flag so the wholesale branch below
 *  never needs a non-null assertion on `currentDoc`, which is legitimately null
 *  there on the first-load adopt. `stampNewGeneration` requires
 *  lineageCtx === 'user-file', which this excludes by construction, so the two
 *  can never both be set. */
let carryFrom: Doc | null = null;
```

Assign inside the guarded block, immediately after `stampNewGeneration`:

```ts
carryFrom = isCleanCompactionAdopt(verdict, lineageCtx) ? currentDoc : null;
```

`POLICY['adopt-remote'].clean === 'adopt'`, so a non-null `carryFrom` implies
`installWholesale`. The `publish-local` early return sits just _after_ this
assignment, not before it — harmless, because `publish-local` implies `ours-newer`
and so leaves `carryFrom` null, but stated correctly because Deviation 7 exists
precisely because these orderings get read literally.

In the wholesale-install branch, compose **before** the single assignment,
preserving the "compose fully, install ONCE" invariant the block's comment insists
on:

```ts
const adopted = migrateDoc(remote);
let carried: number | undefined;
let carryFailed: string | undefined;
let withCarry = adopted;
if (carryFrom) {
  const res = carryLocalOnly(carryFrom, adopted);
  // ⚠️ DISJOINT, NEVER BOTH. `carried` present ⇔ the carry RAN TO COMPLETION
  // (0 or more); `carryFailed` present ⇔ it threw and `carried` is absent.
  // Setting `carried = 0` on failure was tried and rejected: it makes
  // `count: 0` mean two different things, so a reader has to cross-reference a
  // second event at a different level to tell "nothing to carry" from "the
  // carry broke". The carry-rate denominator is the SUM of the two events.
  if ('failed' in res) carryFailed = res.failed;
  else {
    withCarry = res.doc;
    carried = res.carried;
  }
}
// Release the pre-adopt document NOW, not at the end of the function. It is
// otherwise reachable via `carryFrom` through `countEntities` + `pushProjection`
// -> `buildFullProjection`, which materializes the whole new document into plain
// JS, so peak would be old doc + new doc + full projection on a path the OOM
// tiers exist to keep inside budget.
carryFrom = null;
currentDoc = stampNewGeneration ? Automerge.change(withCarry, stamp) : withCarry;
```

`applyMutation` is one `Automerge.change`, so the carry lands atomically or not at
all. No hand-rolled change callback, no `structuredClone`, no non-null assertion.

Return fields, added to the adopt branch's object only:

```ts
...(carried !== undefined ? { carried } : {}),
...(carryFailed ? { carryFailed } : {}),
```

Both absent on every other action, so the field's presence is itself the answer to
"was this a scoped adopt" — the convention `rebaseUnavailable` and `replayed`
already use in this function.

**How the rescue reaches Drive (requirement 6).** This is the load-bearing other
half and it needs no new code, only to be understood and pinned. The carry moves
the installed document's heads past the unmigrated remote's, so the adopt branch's
_derived_ `dirty: !headsEqual(remoteHeads, heads)` flips **true**. That is what
publishes it: `syncStore`'s open terminus (`if (merged.dirty)
syncService.triggerDebouncedSave()`), its poll path, and `syncService`'s background
poll all react to `dirty`. Had `dirty` been hardcoded `false` — as it was before
#65 — the carried entities would have lived only on that one device and been lost
on the next cache clear. A test asserts `res.dirty === true` on the carry path.

### 3. `docClient.ts` — one report, every caller

Extend the local `MergeResult` type and `mergeRemoteEnvelope`'s declared return
type with `carried?: number; carryFailed?: string`.

Add a `noteLocalOnlyCarry` sibling to `noteRebaseUnavailable`, and call it from the
wrapper beside `noteDocInstalled()` — the one place every caller passes through:

```ts
if (res.rebaseUnavailable) noteRebaseUnavailable(familyId, res.action);
noteLocalOnlyCarry(familyId, res);
noteDocInstalled();
```

The re-issue early-return above it needs no second call: it re-requests with
`{kind:'no-local-document'}`, which skips the guard entirely, so `carried` is always
absent there. One comment line says so.

```ts
/** Report a scoped clean adopt's local-only carry, and tell the user when it
 *  rescued something.
 *
 *  ⚠️ IN THE WRAPPER, NOT `logMergeTerminus`. It is true today that all three
 *  carrying paths log a terminus — but that is scoping by inspection, and an
 *  eighth `mergeRemoteEnvelope` call site would silently lose both the event and
 *  the toast. `noteRebaseUnavailable` sits here for the same reason. */
function noteLocalOnlyCarry(
  familyId: string | null,
  res: { carried?: number; carryFailed?: string }
): void {
  // Scope first, so a reader sees in line one that this is a no-op for `merged`,
  // `kept-local`, and every adopt that was not the scoped clean case.
  if (res.carried === undefined && !res.carryFailed) return;
  if (res.carryFailed) {
    logEvent({
      level: 'warn',
      surface: 'pod-lineage',
      message: 'local-only carry failed — fell back to a plain adopt',
      context: {
        action: 'adopt-carry-failed',
        error_code: res.carryFailed,
        ...(familyId ? { family_id: familyId } : {}),
      },
    });
  }
  if (res.carried === undefined) return; // not a scoped clean adopt
  // ⚠️ ON THE ZERO CASE TOO, so this event is its own denominator and the carry
  // RATE is measurable — not merely the occurrences (CLAUDE.md observability 6).
  logEvent({
    level: 'info',
    surface: 'pod-lineage',
    message: 'clean adopt local-only carry',
    context: {
      action: 'adopt-carried-local-only',
      count: res.carried,
      ...(familyId ? { family_id: familyId } : {}),
    },
  });
  if (res.carried === 0) return;
  const one = res.carried === 1;
  showToast(
    'info',
    fillTemplate(
      tr(one ? 'podLineage.carriedLocalOnly.one' : 'podLineage.carriedLocalOnly.other' /* § 4 */),
      { count: res.carried }
    ),
    tr('podLineage.carriedLocalOnly.detail' /* § 4 */)
  );
}
```

⚠️ **The `tr()` fallback strings are the ones in § 4 VERBATIM — do not retype them
here.** `tr(key, fallback)` returns the fallback whenever the translation store is
uninitialised, which is exactly the state `docClient.test.ts` runs in, so the
fallback is what the toast tests actually assert against. An earlier draft of this
plan had § 3 and § 4 specifying _different_ copy, with § 4 explicitly arguing § 3's
wording was wrong. § 4 is the single source.

All three fallbacks are `{count}`-templated — including `.one` — so `fillTemplate`
interpolates once, by one mechanism, on every branch. `fillTemplate` is a new import
in this file.

### 4. `uiStrings.ts` — three keys

Under the `podLineage.` prefix, which is already in `IMPORTANT_PREFIXES` in
`uiStrings.test.ts` — so the beanie values are held to the real-noun floor
automatically. All three keep "device", "item" and "family file", and differ from
`en` only in case:

- `podLineage.carriedLocalOnly.one` — `Kept {count} item from this device`
- `podLineage.carriedLocalOnly.other` — `Kept {count} items from this device`
- `podLineage.carriedLocalOnly.detail` — `Your family file was compacted on another device. Items added here were kept, so check anything that looks out of date.`

**The copy is deliberately not "items that were only on this device".** Per trap 4
some carried entities were on other devices and were deleted there, so that phrasing
would be false precisely in the case the user most needs to notice. "Items added
here were kept, so check anything that looks out of date" is true of both halves and
tells them what to do. It also avoids promising more than the feature delivers.

Explicit `.one` / `.other` per the project's pluralization convention, chosen in TS
by count because the caller is a service, not a template. The detail line reuses
the established verb **"compacted"** (as `podLineage.unsyncedInline` already does)
and avoids "reorganised", which the 2026-09-09 copy fix removed as a word the app
uses nowhere else.

## Files Affected

| file                                                        | change                                                                                                                                          |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/services/automerge/worker/protocol.ts`                 | **step 0** — declare `MergeOutcome` once (Deviation 5)                                                                                          |
| `src/services/sync/podLineage.ts`                           | two exported pure predicates beside `POLICY`; `POLICY` untouched (Deviation 7)                                                                  |
| `src/services/sync/__tests__/podLineage.test.ts`            | exhaustive 12-cell test for both new predicates (Deviation 7)                                                                                   |
| `eslint.config.js`                                          | add the two predicate names to the `no-restricted-imports` `importNames` list (Deviation 7)                                                     |
| `src/services/automerge/worker/docOps.ts`                   | `CARRY_LOCAL_ONLY` (rationale inline) + `buildLocalOnlyCarryOps`                                                                                |
| `src/services/automerge/worker/applyAndProject.ts`          | `carryLocalOnly` helper; `carryFrom` hoist + assign; carry in the wholesale branch; two return fields                                           |
| `src/services/automerge/worker/docClient.ts`                | delete the local `MergeResult`; `noteLocalOnlyCarry` + `finishMerge` at both returns; `fillTemplate` import                                     |
| `src/services/sync/syncService.ts`                          | its local `merged` type → `Pick<MergeOutcome, …>` (Deviation 5)                                                                                 |
| `src/services/translation/uiStrings.ts`                     | three `podLineage.carriedLocalOnly.*` keys (`en` + `beanie`)                                                                                    |
| `src/services/automerge/worker/__tests__/docOps.test.ts`    | composer unit tests (the pure-composer home)                                                                                                    |
| `src/services/automerge/worker/__tests__/rebase.test.ts`    | scoped-adopt integration tests + `carried` assertions on 3 existing tests                                                                       |
| `src/services/automerge/worker/__tests__/docClient.test.ts` | `noteLocalOnlyCarry` event + toast tests                                                                                                        |
| `src/services/sync/__tests__/blockerDispatch.test.ts`       | §5b tripwire                                                                                                                                    |
| `src/services/sync/__tests__/saveFailureTracking.test.ts`   | §5b regression — no baseline committed on a blocker                                                                                             |
| `src/components/common/LineageBanner.vue`                   | **correct a FALSE claim** — the comment says this brief "would shrink case 2"; it cannot (Context § above). Repointed at the design that would. |
| `src/stores/settingsStore.ts`                               | correct the stale "`count` is not in ALLOWED_CONTEXT_KEYS" comment                                                                              |
| `docs/plans/2026-09-09-stage-6-preservation-brief.md`       | mark executed, link this plan                                                                                                                   |
| `docs/plans/2026-09-08-compaction-fallout-remediation.md`   | § 5 Outcome: stage 6 shipped; note the four deviations                                                                                          |
| `docs/STATUS.md`, `CHANGELOG.md`                            | per project convention                                                                                                                          |

**No new test file.** Every test has an existing home, which is the whole point:
`rebase.test.ts` already owns the adopt/rebase policy cells and already has
`base()`, `compact()`, `envelopeFor()`, the `changeHook` Automerge mock and the
`beforeEach`; `docOps.test.ts` owns the pure composers; `docClient.test.ts` already
mocks `showToast` and `logEvent` and drives `mergeRemoteEnvelope` through a
`useWorker` stub. A new file would duplicate ~80 lines of harness to gain nothing.

## Help Center Coverage

**None.** This is a data-preservation fix on an internal sync path. It introduces
no new user-facing feature and no new way to accomplish an existing task; the only
surface is an informational toast reporting what was already supposed to have
happened. No existing help article claims the contradicted behaviour.

## Observability Coverage

`surface: 'pod-lineage'`, greppable with one CloudWatch filter alongside every
existing lineage event.

| event                                                 | level | context                   | answers                                                                                                                                                                                 |
| ----------------------------------------------------- | ----- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `action: 'adopt-carried-local-only'`, `count: n`      | info  | `count`, `family_id`      | how often a scoped clean adopt happens, and how much it carried. **Fires on `count: 0` too**, so it is its own denominator and the carry RATE is measurable, not just the occurrences.  |
| `action: 'adopt-carry-failed'`, `error_code: <class>` | warn  | `error_code`, `family_id` | the composer or `applyMutation` threw, naming the class, and the device fell back to a plain adopt. Rising = the carry machinery is broken and users are silently back to today's loss. |
| existing `action: 'adopted'` (unchanged)              | info  | `action`, `family_id`     | the population of all adopts, for cross-checking                                                                                                                                        |

Triage without a repro: a family reporting "my todo vanished after the update" is
answered by filtering `surface=pod-lineage family_id=<id>` —

- an `adopted` with **no** `adopt-carried-local-only` beside it ⇒ the device was not
  in the scoped case, so the loss came from an edit or a delete, which are
  unrecoverable by design (the Context table says so);
- `adopt-carried-local-only count=0` ⇒ the scope held and there was genuinely
  nothing local-only;
- `adopt-carry-failed` ⇒ the machinery, named by `error_code`.

The `console.warn` in the worker is the local companion for a dev repro; the
`error_code` is what makes the same failure diagnosable blind.

**No new context key.** `count`, `action`, `error_code` and `family_id` are all
already in `ALLOWED_CONTEXT_KEYS`, so no `native-store-submission.md` /
`PrivacyInfo.xcprivacy` / `privacy.astro` update is required. Nothing user-typed is
logged: `count` is a small integer, `action` a fixed enum, `error_code` an error
class name. Entity ids, titles, member names and account emails never leave the
device — which is also why `driveConnections` is excluded from the carry, not merely
from the logs.

### One more by-construction gate, named because trap 1 names its own

**A carry into a FOREIGN resident document is unreachable, and here is the gate.** The
worker documents a state where it holds another family's document (the
`initAndLoadCache` cache-miss path). A carry there would write another family's
entities into this pod and then publish them — the worst outcome this change could
produce. It cannot happen: `clean` requires `basis.heads` to equal the _resident_
document's own heads (`lineageContextFor`), which a foreign document's heads cannot
satisfy for this family's baseline, so the scope is never entered. Verified, and
recorded here so it is a checked gate rather than an unexamined assumption.

### A pre-existing DRY defect to fix in passing

`applyAndProject.ts` imports `applyMutation` **twice** — once aliased as
`applyMutationOp` and once bare — and each name is used exactly once. This plan adds
a third use site, so collapse to one name in the same commit rather than picking a
side and leaving the split.

## Commits

**Two commits, not one.** Deviation 5 (the `MergeOutcome` unification) is type-only
and zero-runtime; everything else changes behaviour on the highest-risk merge path in
the app. Splitting them means a bisect can tell the five-copy refactor apart from the
carry.

1. `refactor(worker): declare the merge outcome shape once` — Deviation 5 + the
   `applyMutationOp` collapse. Type-only.
2. `feat(sync): carry local-only entities across a clean lineage adopt` — everything
   else, including the docs corrections.

## Acceptance Criteria

- [ ] An `adopt-remote` + `clean` adopt with local-only entities CARRIES them and never latches
- [ ] The carry sets `dirty: true`, so the rescued entities are published to Drive
- [ ] An ordinary adopt with nothing local-only installs a document byte-identical to
      today (the `info` event of Deviation 3 is new and expected; the DOCUMENT is not)
- [ ] Both `user-file` adopt cells are byte-identical to today; no new refusal on them
- [ ] `POLICY` is unchanged (`podLineage.ts` gains only two pure predicates)
- [ ] `MergeOutcome` is declared once; no hand-copy of the merge shape survives
- [ ] Both `mergeRemoteEnvelope` return points report the carry, via `finishMerge`
- [ ] `carried` and `carryFailed` are never both present
- [ ] `carryFrom` is released before the projection push
- [ ] The `if (act === 'rebase')` block is not modified
- [ ] Exactly one `migrateDoc(remote)` per adopt, as before
- [ ] `CARRY_LOCAL_ONLY` is total over `CollectionName` — a new collection fails the build
- [ ] Credentials and the roster are never carried, with a test per excluded collection
- [ ] A carry that throws leaves the document untouched, falls back to a plain adopt, and records the error class — no bare catch
- [ ] `adopt-carried-local-only` (incl. `count: 0`) and `adopt-carry-failed` emit from the wrapper, so every caller is covered; no new context keys
- [ ] The toast fires once, is non-latching, and names the count
- [ ] §5b: `isRemoteBlocker(new UnsupportedBeanpodVersionError('6.0'))` is true and `latches` is false
- [ ] §5b: `doSave` commits no baseline when the merge throws that error
- [ ] `npm run type-check`, `npm run lint`, and the full unit suite are green
- [ ] Its own commit, and its own `/code-review max` before it is called done

## Testing Plan

### Composer units → `docOps.test.ts`

1. Local-only entities in carried collections produce one `set` op each; `count` matches.
2. An entity present in BOTH is not emitted (no overwrite of the compacted copy).
3. An entity present only in the TARGET is not touched and not deleted.
4. Nothing to carry → `{ op: null, count: 0 }`.
5. Exactly one op → the op itself, not a `batch` of one (mirrors `buildRebaseOps`).
6. **One assertion per excluded collection** (`driveConnections`,
   `calendarConnections`, `familyMembers`, `calendarEventLinks`,
   `notificationReads`, `overlapAcknowledgments`): a local-only entity in it is
   NEVER emitted. The `driveConnections` case additionally asserts no
   `refreshToken` value and no account email appears anywhere in
   `JSON.stringify(ops)`.
7. `settings` and `podLineage` are never emitted, even when they differ.
8. `CARRY_LOCAL_ONLY`'s totality is enforced by its `Record<CollectionName, boolean>`
   annotation alone — the same way `COLLECTION_NAME_SEED` does it. **No runtime
   test**, per house precedent.

### Scoped-adopt integration → `rebase.test.ts` (new `describe`, existing harness)

Reaching `adopt-remote × clean` needs the basis heads to equal the heads the worker
_actually holds_ after `loadSnapshot` → `loadDoc` → `migrateDoc`. Read them back
rather than recomputing, which is immune to the fixture-migration drift
`rebase.test.ts` already records (~`:825-828`):

Wrap it in a NAMED helper in `rebase.test.ts` rather than copy-pasting a two-line
round-trip into three tests — copy-paste is how the fixture drift at
`rebase.test.ts:824-830` happened in the first place. Note that it depends on
`exportSnapshot` being DEV-only (`applyAndProject.ts:1546-1549`), which holds under
vitest.

```ts
/** The heads the worker ACTUALLY holds after loadSnapshot -> loadDoc -> migrateDoc.
 *  Recomputing them from the fixture instead is what makes a nominally-clean
 *  device read as `dirty`. */
function workerHeads(): string[] {
  return Automerge.getHeads(Automerge.load(ap.exportSnapshot().binary));
}

ap.loadSnapshot(Automerge.save(peer));
const heads = workerHeads();
```

Assert `res.action === 'adopted'` in every scoped test, so a fixture that drifts to
`rebased` fails loudly rather than passing vacuously.

#### ⚠️ These tests need a NEW all-29 fixture, and two of them are broken without it

`rebase.test.ts`'s `base()` seeds only `familyMembers`, `todos`, `accounts` and
`settings`, so **25 of the 29 collections are missing** and `migrateDoc` emits a real
`Automerge.change` on every adopt. Two consequences, both verified:

1. **The `changeHook` test (11) cannot reach the carry with `base()`.** The hook makes
   _every_ `Automerge.change` throw, and the install branch's `migrateDoc(remote)`
   runs **outside any try/catch** — so `mergeRemoteEnvelope` REJECTS before the carry
   is attempted, and the test's `action === 'adopted'` / `carryFailed` / "no error
   reaches the caller" assertions all fail.
2. **`res.dirty === true` (test 9) is vacuous with `base()`.** `dirty` is
   `!headsEqual(remoteHeads, heads)` with `remoteHeads` captured PRE-migrate, so
   `migrateDoc` alone makes it `true` — on the carry path _and_ on the
   `carried === 0` path. The assertion would prove nothing about the carry.

**Fix: add a `fullBase()` fixture seeded with all 29 `COLLECTION_NAME_SEED` keys**, so
`migrateDoc` returns its input unchanged and emits no change at all. Then the hook can
only fire inside the carry's `applyMutation`, and `dirty` discriminates the carry.
Chosen over a `skipCalls` counter on `changeHook`, which would re-introduce exactly
the call-ordering fragility this plan objects to elsewhere.

**And test 10 gains `expect(res.dirty).toBe(false)` as the anti-vacuity partner** —
on the all-29 fixture a carry-nothing adopt must NOT be dirty, which is what makes
test 9's `true` meaningful.

9. **Mary's case, end to end.** Local doc (unstamped) holds a todo the compacted
   remote does not. Assert `action === 'adopted'`, `carried === 1`, the adopted
   document's `podLineage` is the remote's, the todo is present, **and
   `res.dirty === true`** so it will be published. This is the test the whole plan
   exists for.
10. **Nothing local-only** → adopted, `carried === 0`, and the installed document is
    deep-equal to a plain `migrateDoc(remote)` install.
11. **A throwing carry falls back to a plain adopt.** Use the existing `changeHook`
    to make `Automerge.change` throw. Assert `action === 'adopted'`,
    `carryFailed` is the error's class name, `carried === 0`, the remote's document
    is installed intact, and **no error reaches the caller**.
12. **A reference absent from the target does not stop the carry** — one
    `docOps.test.ts` case, not two integration tests: a local-only todo whose
    `memberId` names a member the remote roster lacks is still emitted.

    ⚠️ The earlier draft claimed two tests here asserting "the projection renders
    without throwing". They could not: `pushProjection` is `buildFullProjection`, one
    `materializeCollection` per collection, which never resolves a `memberId` or a
    `driveFileId`; and the harness sink is `pushChunk() {}` in a `node` environment
    with no component tree. Both would have reduced to "`toPlain` does not throw on an
    object of strings" while reading as renderer coverage. Assumption 2's
    reference-resolution bullets are **reasoning backed by the existing renderer
    coverage for unassigned members**, not new pins, and now say so.

13. **`adopt-remote × dirty`** still rebases; `carried` is `undefined`.
    14b. **A peer's delete IS resurrected, and that is intended** (trap 4): the remote
    deliberately lacks an entity the local doc still has; assert it comes back and
    `carried` counts it. Pinned so nobody later "fixes" it as a bug without
    reading trap 4.

### One-line additions to EXISTING `rebase.test.ts` tests (no new fixtures)

15. `ours-newer × user-file` (the restore, already asserts `seq === 2`) — add
    `expect(res.carried).toBeUndefined()`.
16. `conflict × user-file` — add `expect(res.carried).toBeUndefined()`.
17. First-load `no-local-document` adopt — add `expect(res.carried).toBeUndefined()`.

Together these are acceptance criteria 4 and 5, pinned on the tests that already
own those cells rather than in duplicated fixtures.

### Telemetry + toast → `docClient.test.ts` (existing `showToast`/`logEvent` mocks)

18. `carried: 3` emits `adopt-carried-local-only` with `count: 3` at `info` and
    shows exactly one toast whose title contains `3`.
19. `carried: 0` emits the event with `count: 0` and shows **no** toast.
20. `carried: 1` uses the `.one` key (singular copy).
21. `carryFailed: 'RangeError'` emits `adopt-carry-failed` at `warn` with
    `error_code: 'RangeError'`, and shows no toast.
22. An outcome with neither field emits neither event — the anti-vacuity case
    pinning that today's paths are unchanged.

### §5b regression + tripwire

23. `blockerDispatch.test.ts`: `isRemoteBlocker(new UnsupportedBeanpodVersionError('6.0'))`
    is `true` **and** `latches` is `false`. Framed for what it adds over the existing
    structural `FutureBlocker` test: that this class still sits under
    `PayloadLoadError`, and that `latches === false` follows from `step === 'parse'`.
24. `saveFailureTracking.test.ts`, using its `okProvider({ revision: 'ver:9' })`
    harness — the one that actually reaches `commitRemoteBaseline`. Assert `save()`
    resolves `false`, `provider.write` was not called, and
    `docClient.noteRemoteBaseline` was **not** called. That last assertion is the one
    no existing test makes and the whole point of §5b.

    ⚠️ **The injection point matters, and the obvious one is wrong twice over.**
    `okProvider`'s `read: vi.fn()` resolves `undefined`, so `fetchAndMergeRemote`
    returns at `if (!text) return` _before_ any parse — the test would pass
    vacuously, with both "not called" assertions true because nothing happened.
    So: `read: vi.fn().mockResolvedValue('{}')` **plus** a throw from
    `parseBeanpodV4`, which that file already mocks. Do **not** inject via
    `docClient.mergeRemoteEnvelope`: `types/sync.ts:399` records that this error
    never crosses the worker boundary, so that would pin an unreachable state.

25. Its anti-vacuity partner **already exists** in that file ("commits the heads of
    the bytes it uploaded"), proving the harness does reach the commit. Referenced,
    not duplicated.

### Manual

26. `npm run dev` with two profiles: compact on A, confirm B adopts, the toast names
    the right count in both light and dark mode, and the rescued item appears on A
    after B's debounced save.

## Review Passes

- **Pass 1 (initial draft)** — this document.
- **Pass 2 (DRY + error handling)** — 17 findings applied. Moved the telemetry+toast
  from `logMergeTerminus` into the `mergeRemoteEnvelope` wrapper (scoping by
  construction, and it dodges `syncService`'s 4th hand-written copy of the merge
  shape); replaced the bare `catch` with a class-recording one per CLAUDE.md and
  carried `error_code`; extracted a private `carryLocalOnly` helper mirroring
  `rebaseOntoRemote`; deleted the new test file in favour of three existing homes
  and added `carried` assertions to three existing tests instead of duplicating
  their fixtures; added the missing `dirty`→publish half (requirement 6); corrected
  five citations. **Rejected one finding**: `materializeCollection` would deep-clone
  every entity including the discarded majority, so the manual loop stays.
- **Pass 3 (sustainability / maintainability)** — 10 findings. **The headline is P1: it
  disproved the brief's second justification.** The carry cannot make the lineage
  banner rarer, because `rebaseUnavailable` is set only inside `if (act === 'rebase')`
  and that cell is disjoint from `adopt-remote × clean`; the claim (repeated three
  times in STATUS.md) is struck and `LineageBanner.vue`'s false forward reference is
  corrected. Also: declared `MergeOutcome` once in `protocol.ts` to collapse five
  hand-copies (Deviation 5); moved the report into `finishMerge` so BOTH wrapper
  return points are covered by construction (Deviation 6); moved the policy-cell
  predicates beside `POLICY` (Deviation 7); made `carried`/`carryFailed` disjoint so
  `count: 0` means one thing; reordered the composer so it stops materializing
  entities it discards, which was defeating its own stated rationale; pulled the 29
  rationales inline into the map; added the peer-delete resurrection as an explicit
  risk row, honest toast copy and a test. **Declined one finding** (Deviation 8): the
  `installAdopted` extraction would restructure the rollback route to tidy an
  already-impossible combination, so the threshold for doing it is recorded instead.
- **Pass 4 (fresh-eyes final sweep)** — 10 findings + 7 nits, all applied. **Two were
  real defects in the test design**: the `changeHook` test could never reach the carry
  (the install branch's `migrateDoc` runs outside any try/catch and the hook makes
  EVERY `Automerge.change` throw, so the merge rejected first), and `res.dirty === true`
  was vacuous because `migrateDoc` alone moves the heads on the 4-collection `base()`
  fixture — both fixed by a new all-29 `fullBase()` fixture plus a `dirty === false`
  anti-vacuity partner. **One was a latent correctness issue**: "a throwing
  `Automerge.change` leaves its input usable" holds only for a throw INSIDE the
  callback; a post-commit throw marks the input outdated and would poison the session,
  which is unreachable today only because the composer emits `set` ops exclusively —
  now a ⚠️ on the composer so adding a `patch` op reads as a correctness change. Also
  corrected a **false** comment claiming Automerge indexing materializes lazily (it
  materializes the whole doc at load; the real reason to skip before reading is
  `toPlain`'s deep clone); unified toast copy that § 3 and § 4 had specified
  differently; pinned `MergeTerminusOutcome`'s `Pick` to exactly three keys (fresh
  object literals in `docClient.test.ts` break on a wider one); made the
  `remoteHeads` nullability call explicit; named test 24's injection point (its
  provider's `read` resolves `undefined`, so the test would have passed vacuously);
  added a 12-cell predicate test without which Deviation 7 would leave the policy less
  pinned than before; dropped two integration tests that claimed renderer coverage
  they could not deliver; and split the work into two commits.

## Prompt Log

### Initial Prompt (2026-09-09)

> go ahead with stage 6 work and planning - perform a careful review and reason as
> needed to prepare an effective plan. once done go ahead to implement and again
> when done run a code review to ensure everything is implemnted as expected and no
> new bugs, side effects or security concerns are introduced. fix all issues found
