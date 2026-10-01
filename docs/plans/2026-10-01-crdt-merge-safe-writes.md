# Plan: Concurrent edits survive the CRDT merge (#117)

> Date: 2026-10-01
> Related issues: Notion tracker #117 (no GitHub issue, per the row)
> Plan file: `docs/plans/2026-10-01-crdt-merge-safe-writes.md`
> Phases: ONE plan, TWO phases (greg, 2026-10-01). Phase 1 is code-only and ships with pricing (#95). Phase 2 changes per-pod data and ships after, with its own merge-safety proof.

## User Story

As a family member editing from my own device, I want every edit I make to survive the merge with my family's other devices, so that a tick on a shopping list, a photo attached to a recipe, a transaction against a shared account or a vote on a holiday idea is never silently lost.

## Context

beanies.family is a local-first app. Each device holds the Automerge document and merges on sync. Automerge only keeps concurrent edits when the writes are fine-grained. Today every write in the worker assigns a whole value:

- `patch` assigns each top-level key whole (`entity[k] = v`, `docOps.ts:642`). A nested array or object in the patch becomes a brand-new Automerge object. So when two devices edit the same `items[]`, `photoIds[]`, `loan`, `ideas[]` or `dropoffCompletions[]`, only one device's array survives. `patchSettings` has the same per-key whole assignment (`docOps.ts:594`).
- `increment`, `applyGoalContribution` and `applyLoanPayment` read a number and write a number back (`docOps.ts:658, 485, 501, 508`). Verified in memory on 3.4.1: -20 and -30 on 100 merge to 80, not 50.
- The photo attach in the worker rebuilds `photoIds` (`photoOps.ts:60, 116`). A concurrent attach drops one id. `gcOrphans` then deletes the real photo straight away, because orphans have no grace period (only tombstones do, `photoStore.ts:881-884`).
- Full-form modals send every field: AccountModal, AssetModal, GoalModal, FamilyMemberModal, BudgetSettingsModal, TransactionModal, MealEditModal, and Medication/Milestone via `useEagerEntityCreate`. An unrelated save therefore reverts a concurrent edit. ActivityModal already diffs against an open-time snapshot. RecipeFormModal diffs against the store at save time, which is the wrong baseline.
- `migrateDoc` writes `d[name] = {}` per device for a missing collection (`docOps.ts:96-102`). After a release that adds a collection, if two devices each write entities before syncing, only one device's entities survive. Actor ids are random per session (`docActor.ts`, pinning disabled), so the two `{}` objects can never be the same object.
- The compaction rebase still emits a whole-map `setSettings` (`docOps.ts:869-880`).
- **Almost every whole-value write already goes through one worker op.** Every store-side array or object write (list items, vacation arrays, votes, completions, contributions, loan, settings arrays and objects) ends in a `patch` op or `patchSettings`. Examples: `listStore.updateList`, `vacationStore.updateVacation`, `assetsStore.ts:151`, `listCycleRepository.ts:49`, `settingsRepository.saveSettings`. So the fix belongs in that op, not at ~30 call sites.
- **Stores build `next` from state that can be one RPC stale.** `toggleItem` reads `lists.value` (`listStore.ts:813`), which is refreshed only after the write resolves (`listStore.ts:664`). Two quick taps on different items therefore send two arrays built from the same pre-write state, and today the second write reverts the first. The fix has to handle this single-device case as well as the two-device one.

Found 2026-10-01 during #95, when the settings singleton was whole-replaced (fixed with `patchSettings`). A sweep then confirmed the rest of the class in memory. The bug is pre-existing: no user has reported it, and #95 did not introduce it. Severity order from the row: account balances, photo attach, shared list items, goal contributions, vacation votes/segments, non-diffed modals, settings arrays, migrateDoc race, duty completions.

## Execution model (greg, 2026-10-01)

Fable (this session) is planner and coordinator. Implementation is delegated to subagents with the model matched to the work, and Fable reviews and integrates every result:

- **Opus**: commits 1-4 (the reconciler and its law tests, worker wiring, migration changes and detection, repository `base`), the two-device harness, and the Step 0 probe. This is the correctness-critical core.
- **Sonnet**: commits 5-6 (store/page call sites, the 18 modal adoptions and their payload tests), ADR/docs, CHANGELOG.
- **Fable**: sequencing, reviewing each commit's diff against the plan, running `npm run validate` once, the browser pass with greg, `/code-review`, and the fix-up loop.

## Requirements

### Phase 1 (code only, ships with pricing)

1. Arrays of keyed items and arrays of primitives are edited in place in the worker (insert, remove, per-field update, move). They are never rebuilt and reassigned. This holds at every listed site:
   - list `items[]`;
   - vacation `ideas[]`, each idea's `votes[]`, `travelSegments[]`, `accommodations[]`, `transportation[]`;
   - activity `dropoffCompletions[]`/`pickupCompletions[]`;
   - goal `manualContributions[]`;
   - budget `categories[]`;
   - `photoIds[]` on every host;
   - settings `exchangeRates[]`, `preferredCurrencies[]`, `customInstitutions[]`.
2. Map-like nested objects are patched per key, never replaced: asset `loan`, settings `aiApiKeys` and `helpfulHintLeadDays`. Every other nested object is a **value** (`dateOfBirth`, recurrence `rule`, `feeSchedule`, `cadence`, `linkPreview`, `adjustment`, `importSource`). A value is written whole when it changes, exactly as today, so a merge can never produce a half-and-half date or rule.
3. Edit modals write only the fields the user changed, diffed against a snapshot taken when the form opened. A cleared field still clears, and is distinguishable from an unchanged one. This covers:
   - AccountModal, AssetModal, GoalModal, FamilyMemberModal, BudgetSettingsModal, TransactionModal, MealEditModal;
   - MedicationFormModal, MilestoneFormModal, RecipeFormModal (its baseline moves from store-at-save to snapshot-at-open), CookLogFormModal, AllergyFormModal, SayingFormModal, FavoriteFormModal, MemberNoteFormModal;
   - the three travel drawers and the VacationWizard edit-save.

   ActivityModal is already correct and is not rewritten.

4. Two devices that each migrate an old pod and write entities into a new collection before syncing end with one merged collection holding both devices' entities. No file-format change; old pods load unchanged.
5. The compaction rebase emits `patchSettings` (set + deleteKeys), never `setSettings`.
6. The worker photo attach appends; `photoIds` never shrinks at merge. Photo hosts are created with `photoIds: []`, so a later first attach is an insert, not a key creation.
7. Every fix has an in-memory two-device merge test (fork, write on both, merge, assert both survive) using the existing `docOps.test.ts` pattern. The tests use a shared helper so Phase 2 can reuse it. Every **accepted residual** below also has a test that shows its documented behaviour (`docs/lessons.md`, 2026-10-01: a hazard is a hypothesis until it is probed).
8. Existing single-device tests stay green, and there is no pod format change. **When the document still equals the snapshot the caller built from, every write produces exactly the materialised value the caller sent** (Law 1, enforced by tests and a runtime verify, A). When it does not (a queued or merged write in between), the other write is kept rather than reverted. This is a deliberate improvement on today.

### Phase 2 (per-pod data change, ships after pricing)

9. Account `balance`, goal `currentAmount` and loan `outstandingBalance` adjustments from two devices both land: -20 and -30 on 100 merge to 50.
10. The data change must be merge-safe. A pod written by the new code, merged into a peer on old history, must not destroy that peer's unsynced edits, and offline devices on old history must still merge.

## Important Notes & Caveats

- **Out of scope**:
  - real-time push (#106);
  - a conflict-resolution UI;
  - rewriting ActivityModal onto `useFormModal` (follow-up; it keeps its own baseline for now);
  - teaching the rebase (`threeWayFields`) to merge arrays that both sides changed. These stay a counted conflict, as today (follow-up);
  - passing a modal's open-time snapshot as `base` (follow-up; it needs an opts parameter on ~18 store update methods).
- **`set` stays a whole-entity replace, by design.** The reconciler sits only behind `patch` and `patchSettings`. `set` is for creates and for entities whose fields form one invariant. Responsibility card state is "always written WHOLE ... resolve to one complete version" (`responsibilityRepository.ts:12-14`, `responsibilityOps.ts:14`). A per-field merge there could pair one device's `splitMode` with the other device's `parts`. The other `set` sites write fresh ids (mealPlans `replaceWeek`, listCycles, transactions, calendar imports) or immutable upserts (overlap acks). ADR-039 records the split.
- **`undefined` crashes the worker**: Automerge throws `RangeError: Cannot assign undefined value`. Main-thread inputs are already JSON-cleaned by `toPlain`/`stripUndefined` (`automergeRepository.ts:13-29`). A nested clear therefore arrives as a missing key, not as `undefined`. Top-level clears travel as `deleteKeys` (`splitPatch`, `automergeRepository.ts:127-133`), outside the reconciler. The reconciler still treats `undefined` as "delete", defensively.
- **Residual last-writer-wins, accepted and documented** (each has a pinning test, H):
  - **Same scalar on two devices.** A true same-field conflict (both devices change the same scalar or the same value object) keeps one value, per field only.
  - **Update vs remove of the same item.** If one device updates a list item while another removes it, the item is gone.
  - **Move vs update of the same item.** Automerge list moves are delete+insert, so a concurrent update to the moved item can be lost. Moves are minimised (only items off the longest increasing subsequence move), so only the item the user actually dragged is exposed.
  - **Keyless elements edited concurrently.** An element with no key (a recipe step, an ingredient string, a list-cycle mark) has value identity, so editing one is a remove+insert. If two devices edit the same keyless element, both edited versions survive as two near-duplicate steps. This is visible and recoverable, unlike today's silent loss.
  - **Semantic-key duplicates.** Two devices that insert the same semantic key concurrently (the same member voting, two parents ticking the same duty date) produce two elements. Readers see both until the next write to that array heals them (`healed_duplicate_keys`), so `VacationIdeaCard.vue:110` can count one vote twice in that window. Toggles remove by key, never by index (C.6), so an un-vote or un-tick always works on a duplicated element.
  - **Primitive arrays merge as sets.** If two devices change `assigneeIds` from a common base, the result is the union of both sides' changes.
  - **Derived scalars after a merge.** List completion fields and vacation `startDate`/`endDate` ride in the same `patch` as their array (`listStore.ts:787`, `vacationStore.ts:249`), so each write is internally consistent. After a merge, or after two quick writes built from the same stale state, the derived scalar can disagree with the merged array (for example, both items ticked but the list not marked complete). It self-heals on the next write to that entity. Today one of the two array edits is lost instead.
  - **Modal edits to the same array or object.** Suppose a modal edits an array or object field, and while it is open another device's change to that same field merges onto this device. The save can then revert that other change. The diff only sends fields the user changed, so this cannot happen for any field the user left alone.
  - **Caller snapshot older than the projection.** `base` is the projection at call time. A write built from older state reverts merged changes in the fields it sends, as today. Two windows exist: the post-merge store reload (`reloadAllStores`, `syncStore.ts:1808`) and `usePhotoEntityBinding`'s in-flight window, where re-sync is suppressed while `pendingOps > 0`. Both last milliseconds and neither is widened by this plan.
  - **Concurrent edits to one map-like object** (`loan`, `aiApiKeys`, `helpfulHintLeadDays`) can leave a key from each side.
- **First creation of an optional array or object** on an entity that never had one is a whole-value write. This covers `manualContributions`, completions, `loan`, a legacy host's `photoIds`, and an `onMissing: 'create'` entity such as `notificationReads[memberId]` (`notificationsStore.ts:231`). If two devices create it concurrently, they conflict at that key and one device's first element is lost. The window is narrow: one device must create the field while it is offline. The reconciler cannot fix this, because the conflict is in the parent map.
  - **Photos are the costly case**, because a lost reference is deleted by the next GC. C.7 closes it for every host created after this ships. Legacy hosts without `photoIds`, booking segments and calendar-imported activities remain exposed.
  - The merge-terminus detection (F) only counts root-level conflicts, so this case is visible only in the merge tests.
- **Automerge semantics are hypotheses until probed** (`docs/lessons.md`, 2026-10-01). Step 0 of implementation is a probe. The probe then becomes a permanent `automergeSemantics.test.ts`, so a future Automerge upgrade that changes any of these fails CI instead of corrupting merges. It asserts:
  - (a) Per-key assignment on a list element and `splice`/`push` on a proxied list merge as expected on 3.4.1. A change callback that writes nothing leaves heads unchanged. `delete list[i]` is **not** used: on the proxy it removes the element, on a plain array it leaves a hole (probed: `[1,null,3]`). So the reconciler removes with `splice` only, and plain-object tests match production.
  - (b) Inserting a plain copy of an existing element (a move) works inside one change. Probed: a move on A plus a field edit and push on B merge to all three changes.
  - (c) The committed migration change (F), applied with `applyChanges` on two devices with different histories, dedupes on merge to one object id, and writes from both devices land in one map. Probed on 3.4.1: `deps []`, seq 1, startOp 1, both entities present. Applied to a doc where the key holds `null`, the key **stays `null`** (probed), which is why F applies the change only to absent keys.
  - (d) `Automerge.getConflicts(doc, key)` reports more than one value for a root key both devices assigned. Probed: 2.
  - (e) For Phase 2: two devices concurrently creating a Counter at the same entity key are both readable via `getConflicts` on the nested object.
- **`diffPayload` stays a shallow diff** (its header, plus `diffPayload.test.ts:100`). The only change is one line: array elements are compared with the same `isEqual` (JSON fallback for objects) instead of `===`. Today an array of objects (budget categories, meal arrays) always reads as changed (`diffPayload.ts:47`). A false "changed" (for example, a different key order) costs nothing, because the reconciler compares canonically and writes nothing. Deep merging is the worker reconciler's job, not this helper's.
- **`vacationStore.updateSegment` / `deleteSegment`** exist (id-addressed, `vacationStore.ts:431, 461`), and only tests call them. The drawers and `TravelPlansPage` rebuild arrays themselves, by positional index. Phase 1 makes these two store methods the only writers.
- **GoalModal hard-codes `isCompleted: false`** (`GoalModal.vue:182`). AccountModal's balance adjustment compares a stale form balance to the store. Diffing fixes both as a side effect, because the field is only sent when it changed.
- **Medication/Milestone/CookLog/Allergy/Saying modals cannot clear a field** today (conditional spreads). Diffing against a snapshot with `orUndefined` payloads fixes that too (the RecipeFormModal pattern, `RecipeFormModal.vue:400-420`).
- **Settings seed race** (`patchSettings` creates `{...defaults}` when settings are absent) can only happen before a fresh family's first write, when only one device exists. Documented residual. The root-conflict detection (F) covers it; there is no repair.

## Assumptions

> Review before implementation.

1. `@automerge/automerge` stays at 3.4.1 (`package.json:61`). Nothing imports `/next`, and the `automerge-legacy` alias (`package.json:90`) is not involved. An upgrade must pass `automergeSemantics.test.ts` and must never regenerate `migrationChanges.ts` (F).
2. Array items have a usable identity. `id` (a string) wins whenever present. A small static table, keyed by field name, covers keyless shapes that need semantic identity:
   - `votes` → `memberId`
   - `dropoffCompletions`/`pickupCompletions` → `date` (`models.ts:1160`)
   - `exchangeRates` → `from|to`
   - `categories` → `categoryId` (`models.ts:677`; without it, two devices editing one budget category would leave it in the list twice)

   Everything else uses value identity: canonical (sorted-key) JSON plus an occurrence suffix (`"salt#0"`, `"salt#1"`), so duplicates such as repeated ingredients are handled.

   Rules that make `keyOf` total:
   - The table applies to object elements only; primitives always use value identity.
   - An element whose `id` or table field is missing or not a string falls back to value identity. Otherwise several unrelated elements would share an `undefined` key and be "healed" away.
   - Keys are namespaced (`id:`, `k:`, `v:`), so an `id` can never collide with a value key.

   A **keyless-array audit test** (H) fails when a new array-of-objects field appears that has no `id`, is not in the table, and is not in an explicit value-identity allowlist. That makes the table impossible to forget.

3. The Automerge list proxy supports standard `splice`, `push` and index assignment. The reconciler uses only these (never `delete`, see probe a), so it stays free of Automerge imports like `photoOps.ts` (which `photoStore` already imports on main) and can be unit-tested on plain objects.
4. Entity writes reach the worker as `patch`: factory `update`/`patchMany`, plus the direct `patch` sites in `familyStore`, `photoStore`, `notificationsStore`, `activityRepository`, `recipeRepository` and `listCycleRepository`. Settings writes reach it as `patchSettings`. All of them inherit the reconciler with no call-site change.
5. No E2E test asserts on a whole-array payload shape. The unit tests listed below are the ones to adjust.
6. The update floor mechanism (per STATUS, "raising the update floor") is available for Phase 2, so old builds stop writing absolute balances.
7. **`base` is the snapshot the caller built `next` from, read raw from the projection.**
   - For stores it equals store state, except in the windows listed under residuals.
   - For settings setters, `next` is built through `withDefaults`. Its array and object defaults are empty (`settingsRepository.ts:20-45`), so a key missing from the raw projection correctly reads as additive.
   - **No read `transform` is applied to `base`.** `familyMemberRepository`'s `applyDefaults` derives `canViewFinances` from `ageGroup` (`familyMemberRepository.ts:21-45`). A transformed base would make an explicit `canViewFinances: true` look unchanged and drop it, even in the same patch that turns the member into a child. With a raw base, a derived default the caller sends is written explicitly, as today.

## Approach

### Phase 1

#### A. Worker: one reconciler behind `patch` and `patchSettings` (`worker/reconcile.ts`, `docOps.ts`, `protocol.ts`)

- **New pure module `worker/reconcile.ts`** (no Automerge import). Entry point: `reconcileInto(parent, key, next, base, ctx)`. `ctx` is `{ writes: number; notes: ReconcileNote[] }`, threaded through the recursion. The caller needs `writes` to decide whether to stamp `updatedAt`.
- **Always three-way; there is no mode flag.** The caller chooses `base`. `base === undefined` means "nothing known": the write is additive and never deletes.

  | Shape                                                                                                                               | Rule                                                                                                                          |
  | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
  | object vs object, at the entity root, inside an array element, or a `MERGE_FIELDS` key (`loan`, `aiApiKeys`, `helpfulHintLeadDays`) | Recurse per key of `next` with `base?.[k]`. Delete a target key only if it is in `base` and missing from `next`.              |
  | array vs array                                                                                                                      | See the list algorithm below.                                                                                                 |
  | anything else (scalar, value object, type change, a missing side)                                                                   | Write `next` only if `base === undefined \|\| !eq(next, base)`, and `!eq(next, target)`. `eq` is canonical (sorted-key) JSON. |

- **List algorithm** (one ordered pass, no nesting beyond helpers):
  1. _Normalise_: in target, base and next, a repeated key keeps its first occurrence.
     - Duplicates in the target are spliced out (`healed_duplicate_keys`, the expected result of a concurrent identical insert).
     - Duplicates in `next` are dropped (`next_duplicate_keys`, a caller bug).
  2. _Remove_ (by `splice`): target items whose key is in `base` but not in `next`.
  3. _Walk `next` in order_:
     - An item present in the target recurses with its base item.
     - An item absent from the target and new relative to `base` is inserted as a plain copy, after its nearest preceding `next` item that is present in the target, or at the front.
     - A caller move is an item present in `base`, `next` and the target that sits off the longest increasing subsequence of base positions (in `next` order). It is moved the same way.
     - With `base === undefined`, nothing moves: there is no caller order to honour.
     - Items in the target but not in `base` (concurrent inserts) keep their place.
     - Items in `base` and `next` but gone from the target were removed concurrently and are not resurrected.
- **The four laws** (the reconciler's whole contract; each is a test in H):
  1. If target equals base, the result equals `next`.
  2. Every change in `next` relative to `base` is in the result, unless its item was concurrently removed.
  3. Every target value that differs from `base`, and that `next` left equal to `base`, is untouched.
  4. If `next` equals `base`, nothing is written.
- **Runtime verify** (mirrors `compactDoc`'s verify-before-install): when the target equalled `base` on entry, the reconciled value must canonically equal `next`. If it does not, the key is whole-assigned (today's behaviour) and a `reconcile_verify_failed` note is returned. A reconciler bug on this hot path therefore degrades to today's behaviour, is visible, and does not corrupt data.
- **No depth cap.** Inputs are JSON (acyclic, already structured-cloned), so the walk is linear in a value the worker already received. A cap would add a second, rarely exercised behaviour at an arbitrary depth.
- **Structure**:
  - Functions: `reconcileValue` (dispatch), `reconcileMap`, `reconcileList`, `keyOf(field, item, occurrence)`, `lisMoves`, `canonicalEqual`. Each stays under ~40 lines, with no nesting deeper than one loop plus one branch.
  - Exports `appendUnique(entity, field, value)` for the photo attach, and the `KEY_FIELDS` and `MERGE_FIELDS` tables.
  - `docOps`' private `same` (`docOps.ts:1021`) delegates to `canonicalEqual`, so the worker has one equality. Both sides of `same` are Automerge materialisations, so its results are unchanged.
- **One base rule for both ops**: `baseFor(opBase, target, k) = opBase ? opBase[k] : toPlain(target[k])`.
  - With no caller base, the target is the base and the target becomes `next` in place. That is today's semantics, minus the whole-object writes.
  - This path is used by the worker-internal rebase (G) and by the direct scalar-only sites (`familyStore.ts:998, 1064`, `activityRepository.ts:60`, `recipeRepository.ts:55, 64`, `photoStore.ts:816, 852`, `notificationsStore.ts:226`). Verified: none of them sends an array or object.
- **`patch` op**:
  - Call `reconcileInto(entity, k, v, baseFor(op.base, entity, k), ctx)` per key.
  - A `deleteKeys` entry, or the `onMissing: 'create'` branch, counts as a write only if it changes the doc.
  - `updatedAt` is stamped **only if `ctx.writes > 0`**. An all-unchanged patch therefore leaves heads untouched, so `changed: false` (`applyAndProject.ts:855`), with no persist and no Drive save.
- **`patchSettings`**: the same loop (`docOps.ts:594`) with `baseFor(args.base, target, k)`. Seeding `{...defaults}` counts as a write.
  - `updatedAt` moves out of `patch` into its own argument (`saveSettings` passes it separately) and is stamped only on a write, matching `patch`. Today every settings save writes `updatedAt`, even when nothing changed.
  - Without `baseFor`, a base-less rebase would be additive and silently drop a peer's removed rate or API key.
- **`mutateDraft` accumulators**: it already threads `named` and `namedResults`. Rather than adding a third positional parameter, the three are bundled into one `sink` object (`{ deltas, results, notes }`). `applyMutation` returns `notes`. The rebase path (`applyMutationOp` in the merge) ignores them on purpose: its ops are composed from document reads, never from a caller, and its losses are already counted in `conflicts`.
- **`protocol.ts`**:
  - `patch` gains an optional `base?: Record<string, unknown>`, documented as "the snapshot `patch` was derived from".
  - `patchSettings` args gain `base?` and `updatedAt?`.
  - `RpcOk` gains an optional `notes?: ReconcileNote[]` (a type-only import from `reconcile.ts`), carried the same way as `changed`.
  - There is no new op kind, so `deltaFor`, `gatedKind` (`docClient.ts:1194`) and the rebase composer need no new cases. `patchSettings` stays in `SYSTEM_NAMED_OPS` (`docClient.ts:1187`). `base` cannot widen what a write touches, because the reconciler only walks the keys of `patch`.

#### B. Main thread: the repositories supply `base` automatically

- **One builder, `patchOp(collection, id, patch, opts)`, exported from `automergeRepository.ts`.** It attaches `base: pick(projectionGetById(collection, id), Object.keys(patch))`. The base is raw and untransformed (Assumption 7). Picking only the patched keys means main never inspects the shape.
  - The factory `update` reuses its existing existence read (`automergeRepository.ts:184`) for the base. Callers do not change.
  - `patchMany` builds one `patchOp` per id. Its current callers (`listLinkPatch`, `todoLinkPatch`, `activityLinks.ts:159-172`) are scalar-only, where a base only changes anything for ids already equal to `next`. The base is kept anyway so that every factory patch follows one rule, and a future array patch through `patchMany` is safe.
  - `listCycleRepository.ts:49`, the one direct `patch` site that carries an array, uses it too.
  - The remaining direct sites patch scalars or `deleteKeys` only, and use the target-as-base path (A).
- **`settingsRepository.saveSettings`** passes `base: pick(projectionGetSettings() ?? {}, Object.keys(patch))`. In the boot window this is `{}`, so the write is additive and cannot drop rates or keys it has not seen. This is the exact #95 scenario, now also safe for arrays. With it, `setAIApiKey`, `updateExchangeRates`, `addExchangeRate`, `removeExchangeRate`, `setPreferredCurrencies`, `addCustomInstitution`, `removeCustomInstitution` and `setHelpfulHintLeadDays` all become per-key and per-item with no change to the setters.
- **`docClient`**: the shared `{ result, changed }` return type of `requestCore` gains `notes`. Every path that produces it carries `notes`: the inline branch (`:775`), the worker branch (`:824`), the timeout retry (`:944`) and the `InlineExecutor` type (`:82`). `mutate` logs them (Observability). This is the one place.

#### C. Call-site changes (only where a caller writes from a stale snapshot or hand-rolls a shared pattern)

1. **Photo attach** (`photoOps.ts:60, 116`): both hooks call `appendUnique(entity|seg, 'photoIds', photoId)`. Dedupe is correct: photo ids are minted per upload, so the same id reaching the same host twice is only ever a retry or the refresh write below, and both should be no-ops.
   - `usePhotos.ts:264-270` stays. It refreshes the host's local ref (comment at `usePhotos.ts:241-250`), and the follow-up write is now a worker no-op.
   - `useRecipeCapture.ts:621` is unchanged for the same reason.
2. **CookLogFormModal**: replace the hand-rolled `ensureEntryId` and the `void recipesStore.updateCookLog(...)` photo write (`CookLogFormModal.vue:107-130`) with `useEagerEntityCreate` + `usePhotoEntityBinding`. The binding's header says it is used for cookLogs, but this modal never adopted it. Adopting it removes a write that had no rollback.
3. **List celebration Undo** (`listStore.ts:790-801` and `831-842`, identical blocks): extract one `celebrateWithUndo(listId, changedItemIds, wasRecurring)`. Its Undo re-reads the current list and clears completion only on the items this gesture changed. It no longer writes back the `originalItems` snapshot, matching `restoreItem`'s documented rule (`listStore.ts:897-905`).
4. **Vacation segments**:
   - `TravelPlansPage.vue:656-698` (arrayIndex edits and deletes) moves to `vacationStore.updateSegment`/`deleteSegment`.
   - The three drawers save `updateSegment(vacationId, segId, diff)`, with the diff coming from E.
   - TravelSegmentEditModal's return-flight sync applies onto current segments, not the form snapshot.
   - `updateSegmentPhotoIds` (`vacationStore.ts:483-519`) becomes a one-line call to `updateSegment(…, { photoIds })`, removing its duplicate find-loop.
5. **Goal contributions**: Phase 1 does **not** reroute `currentAmount`. Amounts are Phase 2's job (Req 9). Routing them now through `applyGoalContribution` would split today's single atomic patch (amount + history entry) into two writes.
   - The one Phase 1 change: `_apply` mints the entry id and passes it in `contribution`, and `appendContributionIfChanged` uses it (`goalsStore.ts:35-54`). The Undo toast then targets that id.
   - Today it reads `updated.manualContributions.at(-1)` (`useContributeToGoal.ts:69`). Once concurrent appends survive, that can be another device's entry, and Undo would delete it.
   - The `manualContributions` append and undo are otherwise reconciled automatically.
6. **Keyed toggles remove by key, not by index.** Each of these is built from store state and removes one duplicate via `findIndex` + `splice`/`filter`. After a semantic-key duplicate, the remaining copy keeps the key in `next`, so the reconciler writes no removal and the un-vote or un-tick silently does nothing.
   - `toggleIdeaVote` filters out every vote with that `memberId` (`vacationStore.ts:335-338`).
   - The duty toggle duplicated in `FamilyNookPage.vue:116-137` and `ActivityViewEditModal.vue:129-145` moves into one `activityStore.toggleDutyCompletion(id, duty, date, memberId)`, which removes every completion for that date. This also moves orchestration out of the views (MVO).
7. **Photo hosts are created with `photoIds: []`.** `stampNew` (`automergeRepository.ts:89-99`) seeds `photoIds: []` when the input lacks it, for collections registered as flat photo hosts. This is a new `isFlatPhotoHost(name)` in `photoOps.ts`, which keeps the registry at `photoOps.ts:233-239` as the one list. Every later first attach is then a list insert, so the first-creation residual cannot lose a photo on new entities.
8. **No change needed** (the reconciler covers them): list toggle/add/remove/rename/reorder/bulk/recurring reset, `addExtractedSegments`, asset `loan` and its link sync (`assetsStore.ts:151`), budget categories, meal arrays, member aliases, co-owner arrays, and every settings setter.

#### E. Modals: snapshot-at-open diff (`useFormModal`)

- `useFormModal` gains one optional option, `snapshot: { build: () => P; name: string }`.
  - After `onEdit`, it captures `baseline = build()` on `nextTick`, as ActivityModal does (`ActivityModal.vue:530-541`), so values settled by watchers are not phantom edits.
  - The capture is skipped if the modal closed or retargeted before the tick (one guard on the entity key). That stops a stale capture from turning a following create into a partial payload.
  - `onNew` sets `baseline = null`.
  - `build` must be a **pure function of form state**. A clock or fresh-id fallback in it is a permanent phantom diff.
- It returns one typed seam, `formDiff: FormDiff<P>`, defined as `{ changes(p): Partial<P>; rebaseline(p): void }`:
  - `changes(payload)` returns the full payload when there is no baseline (create, and the fail-safe). Otherwise it returns `diffPayload(baseline, payload)`.
    - An empty diff emits a `form-diff` debug event.
    - Edit mode with no baseline is a missed snapshot: it emits a `form-diff` warn and degrades to today's full write.
  - `rebaseline(payload)` replaces the baseline.
- `useEagerEntityCreate` takes an optional `formDiff`:
  - `ensureId` calls `rebaseline(payload)` after an eager create. That fixes the eager path that RecipeFormModal's store-at-save diff was compensating for (`RecipeFormModal.vue:459-470`).
  - `commit` sends `changes(payload)`. An empty diff still calls `update`, which the worker turns into a no-op that echoes the entity, so the `commit` contract (`TEntity | null`) is unchanged.
  - RecipeFormModal deletes its lambda diff.
- **Each modal adopts it in three lines**: pass `snapshot`, emit every field with `orUndefined` in `buildPayload`, and save with `isEditing ? update(id, formDiff.changes(p)) : create(p)`.
  - MealEditModal moves from its own `watch` (`MealEditModal.vue:95-110`) onto `useFormModal`.
  - `photoIds` is removed from edit payloads; the binding is the only writer of photo ids.
- **Modal-specific fixes**:
  - AccountModal: `balance` is in the diff only when changed, so `useAdjustBalance` only records a real change.
  - GoalModal: `isCompleted` is dropped from the edit payload.
  - AssetModal: `loan` is diffed as one key, and the worker reconciles it per sub-key.
- **FamilyMemberModal, the one per-modal rule.**
  - **Permissions.** Its three permission flags have defaults derived from `ageGroup` (`familyMemberRepository.ts:21-45`). When `ageGroup` is in the diff, the flags are added to it as shown on screen. Otherwise turning an adult into a child would silently drop a finances toggle the form showed as on, and the reverse would grant one the form showed as off.
  - **Temp email.** A blank email on edit keeps the stored temp address instead of minting `${Date.now()}@temp…` (`FamilyMemberModal.vue:286-288`). The minted value is impure and would rewrite the email on every save.

#### F. Deterministic collection creation (`migrateDoc`)

- **Drop the "time 0 dedupe" idea.** Actors are random per session, and actor pinning is disabled because a pinned actor "collides with this device's own published history" (`docActor.ts:35-44`). Two devices' migrate changes can therefore never share a hash.
- **Instead**, a committed table `MIGRATION_CHANGES: Record<CollectionName, string>` (base64) holds one pre-generated change per collection.
  - It is typed like `COLLECTION_NAME_SEED` (`types/automerge.ts:153`), so a new collection without an entry is a compile error, not a test someone has to remember.
  - Each change has the actor `sha256("beanies-migration:" + name)[0..16]`, seq 1, `deps: []` and `time: 0`, and creates only `{ [name]: {} }`. No device ever writes as these actors.
- **Bytes, never regenerated.** Stored bytes stay readable after an Automerge upgrade, because Automerge must keep loading old changes. A _regenerated_ change could encode differently and collide on actor+seq with the copy already in families' pods. So:
  - The generator (`scripts/generateMigrationChanges.mjs`) is append-only: it writes entries only for collections missing from the table and refuses to touch existing ones.
  - The file header says so.
  - There is deliberately no "regenerate and compare" test, because that would force regeneration on every upgrade.
  - Renames do not exist in this model: a renamed collection is a new collection with a new entry. A removed collection's entry may be deleted.
- **`migrateDoc` splits on absent vs null** (`docOps.ts:97` treats them as one case today).
  - A collection that is **absent** gets the stored change via `Automerge.applyChanges`. Every device then gets the same object id, and concurrent writes land in one map.
  - A collection that is present but **`null`** keeps today's ordinary change. The stored change would leave the key `null` (probe c).
  - Collections that already exist are never touched.
  - No current pod is missing a collection, so in the pricing release this path stays dormant until the next collection is added.
- **No post-merge repair.** A repair that copies the losing map's entities into the winner resurrects any entity later deleted from the winner, because the losing map persists and cannot be written. A repair that reassigns the root key re-creates the race it fixes.
- **Mixed fleet**: a pre-change device's random-actor `{}` always beats the stored change (higher counter), so during rollout the race behaves exactly as today, and detection counts it.
- **Detection instead**:
  - A pure `countRootConflicts(doc)` in `docOps.ts` counts the root keys (`COLLECTION_NAMES` + `settings`) whose `getConflicts` has more than one value. `mergeDocs` is unchanged.
  - The merge in `applyAndProject` calls the counter before and after, and `MergeOutcome.rootConflicts` carries `{ total, added }`.
  - A root conflict persists until that key is reassigned, which never happens. So only `added` may raise the log level; otherwise an affected family would warn on every poll forever.
  - **When `added > 0`, the merge pushes `buildFullProjection` instead of the deltas.** `projectionDeltasBetween` skips root-level patches (`docOps.ts:243`), and a changed winner emits no removals for the losing map's entities (probed: patches are `put [newCol]`, `put [newCol,e1]`, nothing for `e2`). Without the full projection, phantom entities would stay in the projection until a reload (`applyAndProject.ts:1327-1328`).

#### G. Rebase (`docOps.ts:869-880`)

- Emit `{ op: 'named', name: 'patchSettings', args: { patch: changed.set, deleteKeys: changed.deleteKeys } }`, and delete the local `merged` assembly. With no `base`, `baseFor` takes the target as the base, which is exactly the composer's already-three-way result applied in place. That includes a peer's removed rates or keys.
- `setSettings` then remains only for the test seed (`seedDocument.ts:62`). Two comments need updating:
  - the composer's "STRUCTURALLY INCAPABLE OF WRITING `podLineage`" note (`docOps.ts:743`) now names `patchSettings`;
  - the "`asset.loan` and friends are written WHOLE, which is the documented last-writer-wins semantic" note (`docOps.ts:757-761`) now points at ADR-039.
- Entity rebase patches now reconcile in place for free. Arrays that both sides changed remain a counted conflict (unchanged).

#### Sequencing (each a separate, independently revertible commit)

1. `reconcile.ts` + tests (pure).
2. Worker wiring (`patch`, `patchSettings`, `baseFor`, `notes`, rebase, photo attach).
3. Migration changes + root-conflict detection + full-projection fallback.
4. Repository `base` (raw) + `stampNew` photo seed.
5. Store/page call sites (C).
6. `useFormModal`/`useEagerEntityCreate` + modals (E).

Commits 2 and 4 deploy together. On their own, 2 already gives fine-grained writes with target-as-base, which is no worse than today but fixes no stale-state case. Commits 1-4 alone fix list, vote, photo, settings and loan merges. Commits 5-6 can be reverted without touching the worker.

**Release with pricing, no feature flag.**

- Why no flag:
  - There is no format change. Old and new builds exchange the same pods, and old builds keep today's semantics.
  - The Law-1 verify is the runtime fallback to today's write.
  - A flag would keep a second, unexercised write path alive.
- Ship it as its own production deploy on top of the pricing deploy, so a regression can be attributed to one of the two and reverted alone.
- Commit 6 (18 modals) is the largest UI surface. It goes in that deploy only if its payload tests and the browser pass are green; 1-5 do not depend on it.
- After the deploy, check that `crdt-reconcile` warns are at zero before the pricing live flip.

#### H. Tests: a shared two-device harness

- **Harness**: `worker/__tests__/twoDevices.ts`, next to the existing `inlineHarness.ts`, provides:
  - `fork(origin)`, which returns `{ a, b }` via `Automerge.clone` with distinct actors (the `docOps.test.ts:384-408` model);
  - `converge(a, b)`, which runs `mergeDocs` both ways and asserts equal materialisation;
  - `seeded(ops)`.
- **`reconcile.test.ts`** (pure, on plain objects):
  - One table per law (1-4), including order, clears, type changes, duplicates, occurrence-suffixed primitives, missing key fields (value-identity fallback), value objects written whole, and no moves when `base` is undefined.
  - A seeded pseudo-random generator (no new dependency) builds `base`, derives `target` (base + random concurrent edits) and `next` (base + random caller edits), then asserts all four laws.
  - The duplicate notes, plus one forced verify failure (an injected faulty reconcile) proving the whole-assign fallback and its note.
- **`automergeSemantics.test.ts`**: probes (a)-(e), kept permanently.
- **Keyless-array audit**: walks the demo dataset (the one seeded via `seedDocument`) and fails on any array-of-objects field with no `id`, no key-table entry and no value-identity allowlist entry.
- **Merge tests in the existing files**:
  - `docOps.test.ts`:
    - list tick + add, and two quick ticks built from the same stale state (single device);
    - vote×2, segment edit + add, duty toggle×2, contribution history×2, budget category×2;
    - loan field vs loan payment, settings array add on both, `aiApiKeys` two providers;
    - recurrence `rule` edited on both stays one whole rule;
    - deterministic migration on two devices, on a `null` collection, and a mixed-fleet merge that pushes a full projection (no phantom entity);
    - no-op patch leaves heads unchanged; a base-less `patchSettings` removes a rate.
  - **Residual pins** (one test each, named `residual:`): same scalar, update vs remove, move vs update, keyless edit, semantic-key duplicate then un-vote/un-tick, derived scalar after merge, first-creation conflict.
  - `photoOps.test.ts`: attach×2, then `gcOrphans` collects nothing; attach on a host created through `stampNew` on both devices keeps both.
  - `rebase.test.ts`: `patchSettings`.
  - `settingsPersistence.test.ts`: the #95 boot window (projection `null`) with `updateExchangeRates`/`setAIApiKey` keeps the family's rates, keys and `planToken`.
- **Migration table tests**: every entry decodes to exactly `{ [name]: {} }`, `deps: []`, seq 1, with the derived actor.
- **Payload tests**:
  - Modal tests assert the diff. AccountModal, AssetModal, GoalModal, FamilyMemberModal and BudgetSettingsModal get their first unit tests.
  - FamilyMemberModal covers adult→child carrying the permission flags, and a blank temp email not being sent.
  - `diffPayload.test.ts` gains a row for arrays of equal objects.
  - `useFormModal` tests cover a stale-capture close/reopen and the missing-baseline warn.
  - `useContributeToGoal` Undo targets the minted id when another entry follows it.

### Phase 2 (design level; its own implementation plan refines it)

- Add `Automerge.Counter` delta fields beside the absolutes: `balanceDelta` on accounts, `currentAmountDelta` on goals, `loan.outstandingBalanceDelta` on assets.
- **No migration pass.** A Counter is created lazily on the first increment. When two devices create one concurrently, it is reconciled **at read** by summing every `getConflicts` value of the delta key (probe e). Counters are additive, so the sum is exact. There is no write, and nothing to resurrect.
- **One fold module owns both directions; main never sees a delta field or computes Σ.**
  - _First, one funnel._ Every worker entity materialisation goes through `materialiseEntity(collection, raw)`: `docOps.ts:277, 434, 488, 504, 511, 694`, and `compactDoc`'s `toJS` source (`applyAndProject.ts:1557`). Only then is the fold added there. It computes `abs + Σ deltas` and strips the delta fields. A test asserts that no `*Delta` key reaches any projection delta or the compacted source; otherwise compaction would keep only the winning counter.
  - _Writes:_ `unfoldPatch(collection, entity, patch, base)` lifts the three absolute fields (including `loan.outstandingBalance`) out of the patch and its base before the reconciler runs.
    - It writes `abs − Σ` only when the caller changed the field (`next ≠ base`, both folded), so an unrelated `loan` edit cannot revert a concurrent payment.
    - It rejects any `*Delta` key.
    - The reconciler skips the counter keys entirely: it never reads, writes or deletes them, including on the base-less rebase path.
  - _Increments:_ main keeps sending `increment { field: 'balance' }`. `applyGoalContribution`, `applyLoanPayment`/`reverse` and `increment` map the field to its Counter inside the worker. Goal contributions move onto the Counter here (C.5 deliberately left them absolute).
- **Goal clamp stays at write**: `applyGoalContribution` applies `max(delta, −folded)`, exactly today's floor. Read-time `max(0, …)` is only a merge backstop. Moving the clamp purely to read would let a hidden negative absorb later contributions (10, −20, +5 would read 0, not 5).
  - Auto-complete is evaluated on the folded value at write. A merge that crosses the target without either device crossing it leaves `isCompleted` false until the next contribution. The Phase 2 plan decides whether to derive it at read.
- **Explicit set vs concurrent increment**: a set on A concurrent with an increment of d on B merges to `set + d`. The transaction happened, so this is intended, not last-writer-wins.
- **Rebase**: the composer reads raw (unfolded) values, and turns each Counter's growth since the baseline (`Σnow − Σbefore`) into an `increment` op on the target. Skipping Counter fields would silently drop a peer's unsynced payments on every compaction rebase.
- Old builds keep writing absolute `balance`. The update floor is raised to the Phase 2 build before enabling, per the runbook's "only on greg's instruction" rule.
- Merge-safety proof: fork before the first increment, increment on A, absolute-set on B, converge, and assert nothing is lost, in both orders. Also compaction-then-rebase with unsynced increments.

## Files Affected

Phase 1:

- `src/services/automerge/worker/reconcile.ts` (new: `reconcileInto`, `appendUnique`, `canonicalEqual`, `KEY_FIELDS`/`MERGE_FIELDS`, `ReconcileNote`)
- `src/services/automerge/worker/protocol.ts` (`patch.base?`, `RpcOk.notes?`, `MergeOutcome.rootConflicts?`)
- `src/services/automerge/worker/docOps.ts` (`baseFor`; patch + patchSettings call the reconciler; `updatedAt` only on write; `mutateDraft` sink; `migrateDoc` absent/null split; `countRootConflicts`; rebase → `patchSettings`; `same` → `canonicalEqual`; two docblocks)
- `src/services/automerge/worker/migrationChanges.ts` (new: committed, append-only change bytes) + `scripts/generateMigrationChanges.mjs`
- `src/services/automerge/worker/photoOps.ts` (`appendUnique`, `isFlatPhotoHost`)
- `src/services/automerge/worker/applyAndProject.ts` (pass `notes`; root-conflict count before and after the merge; full projection when `added > 0`)
- `src/services/automerge/worker/docClient.ts` (`notes` on the shared `requestCore` return and `InlineExecutor` type; log them in `mutate`; `logMergeTerminus` detail). **No write-gate change.**
- `src/services/automerge/automergeRepository.ts` (`patchOp` with a raw `base`; `stampNew` photo seed), `repositories/settingsRepository.ts` (`base`, separate `updatedAt`), `repositories/listCycleRepository.ts` (use `patchOp`)
- `src/utils/diffPayload.ts` (one-line element compare)
- `src/composables/useFormModal.ts` (`snapshot`, `formDiff`), `useEagerEntityCreate.ts` (`formDiff` option), `useContributeToGoal.ts` (minted contribution id)
- `src/stores/listStore.ts` (`celebrateWithUndo`), `vacationStore.ts` (`updateSegmentPhotoIds` via `updateSegment`; `toggleIdeaVote` by key), `activityStore.ts` (`toggleDutyCompletion`), `goalsStore.ts` (accept the minted id)
- `src/pages/TravelPlansPage.vue`, `src/pages/FamilyNookPage.vue`, `src/components/planner/ActivityViewEditModal.vue` (call `toggleDutyCompletion`)
- Modals: `accounts/AccountModal.vue`, `assets/AssetModal.vue`, `goals/GoalModal.vue`, `family/FamilyMemberModal.vue`, `budget/BudgetSettingsModal.vue`, `transactions/TransactionModal.vue`, `mealplan/MealEditModal.vue`, `pod/{Medication,Milestone,Recipe,CookLog,Allergy,Saying,Favorite,MemberNote}FormModal.vue`, `travel/{TravelSegment,Accommodation,Transportation}EditModal.vue`, `vacation/VacationWizard.vue`
- Tests:
  - New: `worker/__tests__/twoDevices.ts`, `reconcile.test.ts`, `automergeSemantics.test.ts`, `migrationChanges.test.ts`, keyless-array audit.
  - Additions: `docOps.test.ts` (including the residual pins), `photoOps.test.ts`, `rebase.test.ts` (`:132`), `diffPayload.test.ts`, `useFormModal.test.ts`, `settingsPersistence.test.ts`.
  - Adjustments: `useEagerEntityCreate.test.ts`, `useContributeToGoal.test.ts`, `useAdjustBalance.test.ts`, `RecipeFormModal.*.test.ts`, `vacationStore.test.ts`, `listStore` celebration tests, `goalsStore.test.ts`.
- Docs: `docs/adr/039-fine-grained-crdt-writes.md` (new: the four laws, the `base` contract, `set` vs `patch`, `MERGE_FIELDS` vs value objects, the append-only migration table), `docs/ARCHITECTURE.md` (write-path rule: "the worker reconciles; never hand-build a CRDT op at a call site"), `docs/lessons.md`, `CHANGELOG.md`

## Observability Coverage

The worker cannot call `logEvent`. Its `log` signal only reaches the console (`docClient.ts:331`), and `docActor.ts:37` says "the worker cannot telemeter". So every worker-side finding travels back on the RPC response and is logged on main. All context keys are already allowlisted: `action` (`diagnosticContext.ts:68`), `kind` (`:95`), `detail` (`:211`), `count` (`:344`). **No new keys and no store-declaration change.**

- **`docClient.mutate`**, for each `RpcOk.notes` entry (three kinds, no more):
  - `logEvent({ level: 'warn', surface: 'crdt-reconcile', message: 'reconcile fallback', context: { action: 'next_duplicate_keys'|'reconcile_verify_failed', kind: collection, count } })`. This is either a caller bug, or a reconciler bug caught by the verify and degraded to today's write. Never silent.
  - `level: 'info'` for `action: 'healed_duplicate_keys'`. This is the expected result of a concurrent identical insert, and its rate shows how often that happens.
- **Merge terminus**: `logMergeTerminus` (`docClient.ts:1577`) adds `root_conflicts=<total>,added=<n>` to `detail` on every action.
  - Its level becomes `warn` only when `added > 0`, which is also when the worker took the full-projection path. A persisting conflict would otherwise warn on every poll.
  - It already fires on the success path, so the rate is measurable without a new event.
- **Reconciler programming errors** (a non-object entity; a Phase 2 `*Delta` key in a patch) throw in the worker. They reach main through the existing `surface()` → toast + `reportError` path (`docClient.ts:1086-1100`), so the user's edit is reported in doubt rather than lost quietly.
- **Modal diff** (`surface: 'form-diff'`, `kind: snapshot.name`):
  - `debug` "empty diff, no write", so "save did nothing" is visible;
  - `warn` "edit without baseline", a missed snapshot that degraded to a full write.
- **Phase 2**: summed counter conflicts are counted at merge beside root conflicts (`counter_conflicts=N` in the same `detail`), not via `notes`. That keeps `notes` a mutate-only channel.

## Acceptance Criteria

- [ ] For every Phase 1 surface, a two-device merge test shows both devices' edits survive:
  - list tick + add, photo attach ×2, vote ×2, segment edit + segment add, duty toggle ×2;
  - contribution history ×2, budget category ×2, loan field vs loan payment;
  - settings array add on both, aiApiKeys two providers;
  - modal diff where unrelated field edits on two devices both survive.
- [ ] Two quick list ticks built from the same stale store state both land (single device).
- [ ] The four reconciler laws hold in the tables and the seeded random cases. A forced verify failure falls back to a whole-assign and emits its note. Value objects (`rule`, `dateOfBirth`) never merge per key.
- [ ] Every accepted residual has a passing `residual:` test showing its documented behaviour. Un-vote and un-tick work on a duplicated element.
- [ ] A patch whose values all match writes nothing (heads unchanged, `changed: false`), for entities and settings.
- [ ] `photoIds` never shrinks at merge. `gcOrphans` on the merged doc collects nothing that either device attached. New photo hosts are stored with `photoIds: []`.
- [ ] Migration:
  - two devices migrating an old pod and writing into a new collection end with one merged collection;
  - a `null` collection still migrates via the ordinary change;
  - a mixed-fleet root conflict leaves no phantom entity in the projection;
  - every stored change decodes to exactly `{ [name]: {} }` with `deps: []`, and `MIGRATION_CHANGES` is exhaustive by type.
- [ ] `automergeSemantics.test.ts` (probes a-e) and the keyless-array audit pass.
- [ ] Rebase emits `patchSettings` and carries a peer's removed rate; `rebase.test.ts:132` updated.
- [ ] The #95 boot-window settings writes keep the family's rates, keys and `planToken`.
- [ ] Phase 1 introduces no pod format change. (Manual) a pre-change `.beanpod` fixture (`/tmp/gp-test-family.beanpod`) loads and round-trips unchanged.
- [ ] Modal diffs:
  - every edit modal listed writes only changed fields, clearing a field deletes the key, and an empty diff writes nothing (payload tests);
  - FamilyMemberModal's adult→child edit keeps the permission flags shown on screen.
- [ ] Goal contribution Undo removes this device's entry even when another device's entry follows it.
- [ ] Existing suites green (`npm run validate` once, log to file).
- [ ] Observability events fire with the stated surfaces, using only already-allowlisted keys.
- [ ] Phase 2:
  - -20 and -30 on 100 merge to 50 on all three fields;
  - concurrent lazy Counter creation sums correctly;
  - compaction preserves the folded value, and a rebase carries unsynced increments;
  - no `*Delta` key reaches the projection;
  - merge-safety proof in both orders;
  - update floor raised before enabling.

## Testing Plan

1. **Step 0 probe** (Node, in memory): the five Automerge assumptions (a)–(e). (a)–(d) were pre-probed on 3.4.1 during the Pass 4 review. Record the results in the plan Outcome, then commit them as `automergeSemantics.test.ts`. If (c) fails, F falls back to detection only and Req 4 goes back to greg.
2. **Unit**: `reconcile.test.ts` (laws + random), merge tests and residual pins via the two-device harness, migration table tests, keyless audit, adjusted payload tests.
3. **`npm run validate`** once → log file; grep counts.
4. **Browser** (greg + me, two browser profiles against one dev family, both offline, then sync):
   - Tick one item on A and add an item on B; sync both ways; both are present.
   - Attach a photo to a recipe on both; both are present; GC collects nothing.
   - Edit an account's name on A and its balance on B; both are present; no phantom adjustment transaction.
   - Vote on an idea on both phones as the same member; un-vote on one; the vote is gone on both after sync.
   - Add an exchange rate on both.
   - Tick two list items in rapid succession on one device; both stay ticked.
5. **Load the pre-change test beanpod**. Confirm there is no migration write beyond missing collections, and that a no-op save does not trigger a Drive upload.

## Review Passes

- **Pass 1 (Initial draft)**: path-aware `patch` + `listEdit` op with a shared diff-to-edits helper; snapshot-at-open diffing via `useFormModal`; post-merge root-conflict repair for the migrateDoc/settings seed race; rebase to `patchSettings`; Phase 2 Counter deltas at design level.
- **Pass 2 (DRY + error handling)**: replaced the new op family and ~30 call-site conversions with one worker reconciler behind the existing `patch`/`patchSettings`, with `base` supplied automatically by the repositories; deterministic committed migration changes instead of a repair that resurrects deletes; worker findings routed to main for logging; reused allowlisted keys; consolidated CookLog photo binding, celebration Undo and segment photo writes.
- **Pass 3 (Sustainability)**: made the reconciler always three-way under four testable laws, with a runtime verify that falls back to today's write and no depth cap; fixed the ambiguous `base` contract, 2-way scalars that reverted queued writes, the missing `categories` key, the null-collection migration hole and a forever-warning merge log; made the migration table type-exhaustive and append-only; turned the probes into permanent upgrade tests. Phase 2: one materialiser funnel for the fold in both directions, goal clamp kept at write, rebase carries Counter growth as increments. Added six-commit sequencing.
- **Pass 4 (Fresh-eyes sweep)**: checked every point against the code and pre-ran the Automerge probes in memory. Fixed the base-less `patchSettings` contradiction (one shared `baseFor`) and the transformed member base; keyed toggles that could not un-vote or un-tick a duplicate, and contribution Undo hitting another device's entry; value objects merging per key, list `delete` behaving differently on proxies and plain arrays, and phantom projection entities after a root conflict; the photo first-attach race (hosts born with `photoIds: []`) and an impure FamilyMemberModal payload. Dropped the Phase-1 goal reroute, kept `set` whole by design, required a pinning test per residual, and stated the release-without-flag decision.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt

"Ok - let's move forward with item #117 with /beanies-plan and then /beanies-build-auto"

### Follow-up 1

"let's implement the same way we implemented #95 in-app pricing - the fable model acts as the planner and overall coordinator and starts agents as necessary with the appropriate models to save tokens where possible (opus, etc) and oversees the overall implementation"

### Pre-plan prompt (Notion #117 row, verbatim fields summarised in Context/Requirements; full text on the row)

</details>
