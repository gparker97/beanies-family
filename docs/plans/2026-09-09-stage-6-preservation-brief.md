# Brief: stage 6 — carry local-only entities on a clean adopt

> Date: 2026-09-09
> Parent plan: `docs/plans/2026-09-08-compaction-fallout-remediation.md` § 5
> Investigation: `docs/investigations/2026-09-08-compaction-fallout.md` § "STAGE 6"
> Status: **NOT STARTED. Deliberately.** Every other stage of the parent plan has shipped.

## Why this is its own session

greg's decision, twice: on 2026-09-09 to hold it, and again when the rest of the
plan was finished, to build it in a **fresh session** rather than appended to
that work. The reasons are on the record and they are good ones:

- It touches `applyAndProject`'s adopt path, the highest-risk code in the plan.
- **Pass 3 and Pass 4 of the parent plan each found a serious defect in an earlier
  draft of this exact change.** One would have closed the lineage banner's only
  exit; the other would have republished dead refresh tokens that §1d then reads
  to heal — item 5's bug, manufactured out of the plan's own parts.
- A fourth review round on the shipped work found fourteen findings, several of
  them caused by the previous round's fixes. Starting this at the end of that is
  starting it tired.

So: read this file, read § 5 of the parent plan, then start.

## What it is worth, honestly

It rescues **new items created on a straggler device** that the wholesale adopt
would otherwise discard — mary's vanished todo. That is the whole benefit, and it
shrinks as the fleet updates.

What can never be recovered, and no amount of care changes it: compaction builds
a fresh document from a snapshot, so there is **no common ancestor** between the
old lineage and the new one and a true three-way merge is impossible.

| local change on the stale device         | recoverable?                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| a NEW entity                             | yes — this is the whole feature                                           |
| an EDIT to an entity that exists in both | no — the adopt replaces the entity and there is no basis to pick a winner |
| a DELETION                               | no — it would resurrect                                                   |

## Do not re-discover that this is already fixed. It is not.

The two paths look identical and a reader will otherwise either re-fix a working
one or dismiss a real gap.

- **Path A — ALREADY FIXED, WORKS, DO NOT TOUCH.** Both devices on 0.17, device B
  offline, edits, returns after a compaction. Its baseline is HONEST, so
  `lineageContextFor` answers `dirty`, `POLICY['adopt-remote'].dirty = 'rebase'`,
  and `rebaseOntoRemote` replays the edits.
- **Path B — mary's case, NOT fixed.** Her phone was on 0.16, which cannot READ a
  5.0 pod but whose save path writes over it anyway and then commits a baseline
  with ITS OWN heads. That baseline is a lie. On upgrading to 0.17 the heads
  compared equal, the verdict was `clean`, and the wholesale install at
  `applyAndProject.ts:1152` ran. The rebase never fired — not because it is
  broken, but because the device believed it had nothing to replay.

## The four things to build

Full detail is in § 5 of the parent plan, including the Pass 4 corrections C1–C5
that are already folded in. In outline:

1. **Scope it with a hoisted DOCUMENT, not a boolean.**
   `let carryFrom: Doc | null = verdict === 'adopt-remote' && lineageCtx === 'clean' ? currentDoc : null;`
   A `Doc` rather than a flag so the wholesale branch never needs a non-null
   assertion on `currentDoc`, which is legitimately null on the first-load adopt.

2. **`buildLocalOnlyCarryOps(local, target): MutationOp` in `docOps.ts`**, beside
   `buildRebaseOps`. It compares the two DOCUMENTS, never a heads baseline — the
   baseline is the thing that lied. Built with the module-private `toPlain`
   (`docOps.ts:47`), in the `{ op: 'set', collection, id, entity }` shape the file
   already emits at `:794`. **Not `materialize()`** — it does not exist anywhere
   in `src/`. **Not `structuredClone`** — the cited precedent clones a plain
   object, not an Automerge value.

3. **`CARRY_LOCAL_ONLY: Record<CollectionName, boolean>` — a TOTAL map**, so
   adding a collection without deciding is a compile error. The exclusions are
   security decisions, not tidiness:
   - `driveConnections` — holds refresh tokens, and §1d now READS remote
     driveConnections to heal, so carrying a dead one republishes it fleet-wide.
   - `calendarConnections` — carries `needs_reconnect`, a cross-device amplifier.
   - `familyMembers` — a resurrected member feeds `normalizeRoles` owner promotion
     AND stage 5's roster-owner lookup, which is now live.
   - `calendarEventLinks`, `notificationReads` — device/sync bookkeeping, not user work.

4. **Compose BEFORE the single assignment**, preserving the "compose fully,
   install ONCE" invariant the block's comment insists on, and apply through
   `applyMutationOp` so the carry is one `Automerge.change` — atomic, and a throw
   leaves `currentDoc` structurally untouched.

Plus §5b (regression tests that `doSave` refuses and commits no baseline on an
`UnsupportedBeanpodVersionError`, and that the error satisfies `isRemoteBlocker`),
§5c (`adopt-carried-local-only` with `count`, and `adopt-carry-failed` at `warn`),
and a non-latching info toast naming the count.

## The traps, in the order they will bite

1. **`act === 'adopt'` is reached from THREE policy cells, not one.**
   `adopt-remote × clean` is the target. The two `user-file` cells are the
   pre-compaction rollback route, and `LineageBanner` calls that adopt "the only
   exit there is". An unscoped guard refuses the exit offered by the banner that
   the refusal raises — a state the user cannot leave, created by a safety
   feature, on the device holding the at-risk data. **Both `user-file` cells must
   be byte-identical to today.**
2. **The `same` row of the POLICY table stays byte-for-byte `merge`.**
3. **§5a's "adopt rescue" is DELETED as provably unreachable** (parent plan C1).
   `clean` IS `headsEqual(basis.heads, headsOf(doc))`, so `buildRebaseOps` returns
   zero ops by construction. **The `if (act === 'rebase')` block at
   `applyAndProject.ts:1063` is NOT touched by this work.**
4. **False positives are EXPECTED, not merely possible.** Deletes are hard, so any
   entity deleted on a peer and not yet merged here reads as local-only. That is
   why the design CARRIES rather than REFUSES: a false positive costs a resurrected
   entity the user can delete again, not a device the user cannot un-latch.
5. **No cap on the carried count**, deliberately. Any cap is a number nobody can
   justify, and the only thing above it is the loss being fixed. `count` rides to
   CloudWatch so the distribution is observed rather than guessed.

## The cheaper alternative, if this is ever judged not worth the risk

`compaction.olderVersion.notice` (`uiStrings.ts`) already names the members on
older versions but never says what happens if they do NOT update. Tightening it to
state the consequence in one brief line is far smaller and far safer. It was not
done because greg asked for no changes there; it remains available.

## Acceptance criteria

- [ ] An `adopt-remote` + `clean` with local-only entities CARRIES them and never latches
- [ ] An ordinary adopt with nothing local-only is byte-identical to today
- [ ] Both `user-file` adopt cells are byte-identical to today; no new refusal can be raised on them
- [ ] The `same` POLICY row is unchanged
- [ ] `CARRY_LOCAL_ONLY` is total over `CollectionName`; a new collection fails the build
- [ ] Credentials and the roster are never carried, with a test per excluded collection
- [ ] A carry that throws leaves the document untouched and falls back to today's behaviour
- [ ] `adopt-carried-local-only` / `adopt-carry-failed` emit; no new context keys
- [ ] Its own commit, and its own `/code-review max` before it is called done
