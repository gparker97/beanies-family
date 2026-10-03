# ADR-039: Fine-grained CRDT writes: the worker reconciles whole-value patches

- **Status:** Accepted
- **Date:** 2026-10-01
- **Related:** Notion tracker #117 (found during #95)
- **Plan:** `docs/plans/2026-10-01-crdt-merge-safe-writes.md`
- **Implementation:** `src/services/automerge/worker/reconcile.ts`, wired into `docOps.ts`

## Context

Each device holds the Automerge document and merges on sync. Automerge keeps two devices' concurrent edits only when the writes are fine-grained. Assigning a whole array or object creates a brand-new Automerge object, and at merge only one of the two survives.

Today every write in the worker assigns a whole value. The class was found on 2026-10-01 during #95, when the settings singleton was whole-replaced, and a sweep then confirmed the rest in memory on Automerge 3.4.1:

- `patch` assigns each top-level key whole, and `patchSettings` does the same per key. Two devices editing one list's `items[]`, a recipe's `photoIds[]`, an asset `loan`, a vacation's `ideas[]` or an activity's `dropoffCompletions[]` keep only one device's array.
- `increment`, `applyGoalContribution` and `applyLoanPayment` read a number and write a number. -20 and -30 on 100 merge to 80, not 50.
- The worker photo attach rebuilds `photoIds`. A concurrent attach drops an id, and `gcOrphans` then deletes the real photo at once, because orphans have no grace period.
- Full-form modals send every field, so an unrelated save reverts a concurrent edit.
- `migrateDoc` writes `d[name] = {}` per device for a missing collection. Actor ids are random per session, so the two maps can never be the same object, and one device's entities are lost.
- Stores build `next` from state that can be one RPC stale. Two quick ticks on different list items send two arrays from the same pre-write state, and the second reverts the first, on a single device.

The bug is pre-existing and no user has reported it. Almost every whole-value write already ends in one worker op (`patch` or `patchSettings`), so the fix belongs in that op, not at about 30 call sites.

## Decision

**One pure reconciler sits behind `patch` and `patchSettings`. It turns "here is the new value of this field" into the smallest set of in-place edits.**

1. **One reconciler, `reconcileInto(parent, key, next, base, ctx)`** in `worker/reconcile.ts`. It has no Automerge import, so it runs on plain objects in tests and unchanged on a draft proxy. Lists are edited with `splice` (insert, remove, minimal moves off the longest increasing subsequence), never rebuilt. `delete arr[i]` is banned: it leaves a hole on a plain array and removes on the proxy.
2. **Always three-way, no mode flag.** `target` is what the document holds, `next` what the caller wants, `base` the snapshot the caller built `next` from. Only `next` vs `base` is written, so a merged peer edit or a queued write is left alone. `base === undefined` means "nothing known": the write is additive and never deletes or moves.
3. **`base` comes from the projection.** The repository attaches it automatically (`patchOp` in `automergeRepository.ts`, and `saveSettings` for settings): the raw projection, picked to the patched keys, with no read transform applied. A derived default (`canViewFinances` from `ageGroup`) must not make an explicit value look unchanged.
4. **`baseFor(opBase, target, k) = opBase ? opBase[k] : toPlain(target[k])`.** With no caller base, the target is the base and becomes `next` in place. This is today's semantics minus the whole-object writes. It serves the worker-internal rebase and the direct scalar-only `patch` sites.
5. **The four laws** are the whole contract, each a table in `reconcile.test.ts` plus a seeded random suite:
   1. If target equals base, the result equals `next`.
   2. Every change in `next` relative to `base` is in the result, unless its item was concurrently removed.
   3. Every target value that differs from `base`, and that `next` left equal to `base`, is untouched.
   4. If `next` equals `base`, nothing is written.
6. **Runtime verify, as the fallback.** When the target equalled `base` on entry, the result must canonically equal `next` (Law 1). If not, the key is whole-assigned, which is exactly today's write, and a `reconcile_verify_failed` note is returned. A reconciler bug degrades to the old behaviour and is visible. A patch that writes nothing does not stamp `updatedAt`, so heads stay put and no persist or Drive save fires.
7. **Item identity (`keyOf`) is total.** A string `id` wins. Otherwise the `KEY_FIELDS` table applies by field name (`votes` by `memberId`, `dropoffCompletions`/`pickupCompletions` by `date`, `exchangeRates` by `from|to`, `categories` by `categoryId`). Otherwise value identity: canonical JSON plus an occurrence suffix. Keys are namespaced (`id:`, `k:`, `v:`). A keyless-array audit test fails when a new array-of-objects field has none of these.
8. **`MERGE_FIELDS` versus value objects.** Map-like objects (`loan`, `aiApiKeys`, `helpfulHintLeadDays`) are patched per key. Every other nested object (`dateOfBirth`, recurrence `rule`, `feeSchedule`, `cadence`, `linkPreview`) is a value, written whole when it changes. A merge can therefore never produce a half-and-half date or rule.
9. **`set` stays a whole-entity replace, by design.** The reconciler sits only behind `patch` and `patchSettings`. `set` is for creates and for entities whose fields form one invariant. Responsibility card state is written whole so it resolves to one complete version, and a per-field merge could pair one device's `splitMode` with the other device's `parts`. The other `set` sites write fresh ids or immutable upserts.
10. **Deterministic collection creation.** A committed, append-only `MIGRATION_CHANGES` table (base64, typed exhaustively by `CollectionName`) holds one pre-generated change per collection: derived actor, seq 1, `deps: []`, `time: 0`, creating only `{ [name]: {} }`. `migrateDoc` applies it with `applyChanges` to an **absent** key, so every device gets the same object id and concurrent writes land in one map. A key that is present but `null` takes the ordinary change, because the stored change would leave it `null` (probed). The bytes are never regenerated, since a regenerated change could collide on actor and seq with the copy already in pods. The generator only appends. "Time 0 dedupe" was rejected: actors are random per session and pinning is disabled.
11. **Detection, not repair, for root conflicts.** `countRootConflicts(doc)` counts root keys with more than one `getConflicts` value, before and after each merge. Only `added` raises a log level, and when `added > 0` the merge pushes the full projection, because `projectionDeltasBetween` skips root-level patches and would leave phantom entities.
12. **Modals diff against an open-time snapshot.** `useFormModal` takes `snapshot: { build, name }`, captures the baseline on `nextTick` after `onEdit`, and returns `formDiff.changes(payload)`. A create sends the full payload. A missed snapshot degrades to a full write with a `form-diff` warn. `build` must be a pure function of form state.

## Consequences

**Accepted residuals** (last-writer-wins or visible duplicates, each pinned by a `residual:` test):

- Same scalar or value object changed on two devices keeps one value.
- Update vs remove of the same list item: the item is gone.
- Move vs update of the same item can lose the update (moves are delete+insert, minimised to the dragged item).
- Keyless elements (a recipe step) edited concurrently survive as two near-duplicates.
- Semantic-key duplicates (the same member voting twice) are visible until the next write heals them. Toggles remove by key, so un-vote and un-tick always work.
- Primitive arrays merge as sets: the union of both sides' changes.
- A derived scalar (list completion, vacation dates) can disagree with the merged array until the next write.
- A modal that edits an array or object field can revert another device's change to that same field merged while it was open. Fields the user left alone are never sent.
- A caller snapshot older than the projection reverts merged changes in the fields it sends, as today (post-merge reload and the photo binding's in-flight window).
- Concurrent edits to one map-like object can leave a key from each side.
- First creation of an optional array or object (`manualContributions`, completions, `loan`, a legacy host's `photoIds`) is a whole-value write, so a concurrent first creation loses one side. New photo hosts are born with `photoIds: []` to close the costly case.

**Mixed fleet.** There is no pod format change, no flag, and old pods load unchanged. Old builds keep today's whole-value writes. A pre-change device's random-actor `{}` always beats the stored migration change (higher counter), so during rollout the migration race behaves as today and detection counts it.

**Observability.** The worker cannot telemeter, so findings return on the RPC response and are logged on main. No new context keys.

- `crdt-reconcile`: `warn` for `next_duplicate_keys` and `reconcile_verify_failed`, `info` for `healed_duplicate_keys`.
- `form-diff`: `debug` for an empty diff, `warn` for an edit without a baseline.
- Merge terminus: `root_conflicts=<total>,added=<n>` in `detail` on every merge, `warn` only when `added > 0`.

**Form payload rules.** `diffPayload` treats `''`, `null` and `undefined` as the same "absent" state when deciding whether a field changed, but a change to a raw `null` is written as `null` while a change to `''` or `undefined` is a delete: `null` is a write, `''` / `undefined` is a delete. This matters for fields such as `memberId: null` ("family-wide"), which readers test with `=== null`. BudgetSettingsModal no longer sends `isActive: true` on edit; the page only opens the modal for the active budget, so editing never re-activated a superseded budget by design, and the payload test pins it.

**Cost.** One module of about 500 lines to own, plus a permanent `automergeSemantics.test.ts` so an Automerge upgrade that changes any probed behaviour fails CI.

## Alternatives considered

- **A new `listEdit` op family and about 30 call-site conversions.** Rejected: the stores would hand-build CRDT ops, every new array field would need a conversion, and stale-state writes would still revert.
- **Post-merge repair of root conflicts.** Rejected: copying the losing map's entities into the winner resurrects entities later deleted from the winner, and reassigning the root key re-creates the race.
- **"Time 0 dedupe" of the migration change.** Rejected: actors are random per session, so two devices' changes can never share a hash.
- **Automerge Counters now.** Deferred to Phase 2. Counters change per-pod data, so they need their own merge-safety proof and an update floor, and Phase 1 is code-only.

## Phase 2

Add `Automerge.Counter` delta fields beside the absolutes (`balanceDelta`, `currentAmountDelta`, `loan.outstandingBalanceDelta`) so -20 and -30 on 100 merge to 50. There is no migration pass: a Counter is created lazily on first increment, and concurrent creations are summed at read via `getConflicts`. One fold module behind a single `materialiseEntity` funnel computes `abs + sum(deltas)` and strips the delta keys, so main never sees them, and `unfoldPatch` writes `abs - sum` only when the caller changed the field. The goal clamp stays at write. The rebase turns each Counter's growth into an `increment` op. The update floor is raised before enabling, on greg's instruction.

## Phase 2 addendum: how the Counters were actually built (2026-10-03, #117)

The Phase 2 paragraph above is the intent; this is the shape that shipped after the probes in `automergeSemantics.test.ts` and four review passes. Plan: `docs/plans/2026-10-03-crdt-counters-117-phase-2.md`. Code: `src/services/automerge/worker/counterFields.ts`.

- **Single-writer Counters in a root map, keyed by actor.** The adjustments live in a root `counterDeltas` map (created by a stored migration change, so every device writes into one object), one `Automerge.Counter` per `(collection, id, field, writerId)`. Not delta fields on the entity as first drafted. Reason: a later `increment` applies to every conflicting Counter at a key (probe e'), so two actors creating the same Counter corrupts it for good. One writer per key, for life, removes the case. The stored absolute is a baseline; every reader sees `baseline + sum(Counters)`.
- **Minor-unit scale, per key.** A Counter holds `round(amount * 10^d)`, where `d` is the entity's currency minor unit when the key was written (`decimalsFor`, from `CURRENCIES`, clamped to [2, 8]: cents for USD, eight places for BTC), and `d` is written into the key (`${collection}/${id}/${field}@${d}/${writer}`), so a reader never guesses a scale and a later currency change cannot reinterpret an existing Counter. The fold and the unfold round to the entity's current `d`, so a value with at most `d` decimals round-trips exactly. This replaced a fixed four-decimal scale, which dropped crypto precision and left too little headroom for large balances. Two probe findings drove integer units at all. The double-apply: re-applying a change that already merged adds the increment twice, so an increment is never replayed and rebase turns Counter growth into one `increment` per key (`counterGrowthOps`). The truncation: `Counter.increment` truncates to an integer (probe l: `-20.5` stores `-20`, a later `+0.25` is dropped), so fractional amounts must never reach it.
- **Two value spaces and the unfold boundary.** Main sees folded values only. Raw (baseline) values exist inside the worker. Every absolute write from main is converted back at the boundary, on `patch` (when a `base` is present) and on `set`, by `unfoldPatch`: it writes `next - sum` only when the caller changed the field. **Sum = 0 is the identity**: with no keys for an entity, fold and unfold pass values through untouched, so a build with writes off writes exactly what it wrote before.
- **Cumulative fold ledger.** Compaction folds the Counters into the baseline (`foldDoc`) and records every consumed key in `foldedCounters`, extended on every compaction. A rebase subtracts the ledger when computing a peer's growth, so a key the compactor already consumed is never replayed. `firstJsonDifference` verifies the compaction against the folded source.
- **The switch, release order and the floor.** `COUNTER_WRITES_ENABLED` is `false` at first. The reader side (fold, map, ledger, rebase) ships fully active in release N and every device must run a fold-capable build. The update floor is then raised to that build (runbook section 7). Only in a later release is the constant flipped, together with the `SNAPSHOT_MANUAL_REV` bump; never both in one release, because an old build cannot read a Counter and would show the baseline.
- **Fresh actor per load, owned by a device.** The writer segment is `${deviceWriterId}:${actorId}`. The actor is fresh on every `load` (probe o), so a lineage never reuses a key; this depends on `ACTOR_PINNING_ENABLED` staying off, and re-enabling pinning requires the lineage sequence in the Counter key. The device id is minted once per family cache (a row beside the remote baseline, deleted with the cache) and is how the rebase tells this device's keys from a peer's: it replays only keys carrying its own device id, as `mine - (target live ?? ledger ?? 0)`. Ownership by device replaced a baseline-value comparison, which replayed a peer's stale key whenever a baseline commit missed Drive and dropped an own adjustment that happened to net back to its baseline value.
- **Relative goal contribution.** The quick-contribute modal and its Undo no longer compute `currentAmount + amount` on main and write an absolute. They send the delta to the `applyGoalContribution` named op with an optional history entry (`contribution`) or an `undoContributionId` to splice, so the clamp, auto-complete and history edit happen in one change on the folded value. The GoalModal full edit stays an absolute `updateGoal`. Recurring processing and loan payments use the relative ops too (`incrementBalance`, `applyContribution`, `applyLoanPayment`), all owned by the repositories.
- **Why `photoOps` stays outside the funnel.** `photoOps.ts` must stay Automerge-free so `photoStore` on main can import it, and its host entities are never Counter collections (pinned by test), so nothing it reads or writes is a folded field.
- **Residuals.** The mirror write to a linked loan account is still an absolute of the returned folded value, so two devices paying the same loan can diverge on the mirror until the next payment.
