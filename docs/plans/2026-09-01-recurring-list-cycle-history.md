# Plan: Archive each recurring-list cycle instead of overwriting it

> Date: 2026-09-01
> Related issues: None — direct implementation (raised in-session while testing wall mode)
> Plan file: `docs/plans/2026-09-01-recurring-list-cycle-history.md`

> **No GitHub issue created.** Approved for direct implementation.

## User Story

As a parent, I want each finished cycle of a repeating list kept as it was, so that I can look back at last Tuesday and see which chores actually got done rather than only what is outstanding today.

## Context

`listStore.reconcileRecurringLists` (`src/stores/listStore.ts:442`) is the one write path for "the clock advanced". When a recurring list's period rolls over it **resets in place**: every item is unchecked, `lastResetDate` is bumped, `cycleCelebrated` is cleared. The previous cycle is not recorded anywhere — it is overwritten.

So the app can answer "what is outstanding today" and nothing else. A parent cannot see whether the bins went out last week, and the completed shelf never shows a recurring list at all, because `isFiled` is `!isRecurring(list) && list.completed` (`src/utils/listLifecycle.ts:23`) — a recurring list is filed by definition never.

Greg asked for this while testing the beanie wall: _"for a repeating list, when the new list is created, the old list should be sent to the 'completed lists' section, even if not all items were ticked off. it should keep it's state, so you can go back and see what was or wasn't completed, and the new recurring list replaces the older one."_

**The constraint that shapes the whole design — corrected in Pass 2.** Everything lives in ONE Automerge doc that is loaded fully into memory, proxied by Vue (2-3x raw size, `docs/PERFORMANCE.md:37`), and re-serialised, encrypted and uploaded on change. Pass 1 treated this as a _live-record-count_ problem and proposed a two-tier retention scheme that rewrites old records into summaries and prunes them.

**ADR-032 says that does not work.** `docs/adr/032-off-main-thread-automerge.md:18` and `:46`: `Automerge.save()` output is "genuine state + history", and truncating history is **rejected** because it breaks multi-device merge. Compaction (`applyAndProject.ts:366`) re-serialises into a fresh base and drops redundant increments — it is lossless, it does **not** discard history. Therefore:

> **Every byte ever written to the doc stays in the `.beanpod` permanently. Deleting a record does not reclaim its bytes; rewriting a record adds bytes. The only lever on file size is how many bytes you write in the first place.**

This inverts Pass 1's retention design. Collapsing a cycle to a summary later _costs_ bytes and saves none; pruning likewise. What retention genuinely buys is **RAM, projection size, reactive-array size and shelf usability** — worth having, but it must be sold honestly and it must not be the thing we rely on for file size.

The design that follows therefore optimises the one number that matters: **bytes written per archived cycle**, written **once**, never rewritten.

**Pass 3 framing — the risk balance of the delete.** The 90-day delete buys **~135 KB of RAM for the heaviest family and a tidier shelf**, and buys **nothing at all** in file size. Its downside, if it ever misfires, is the **irreversible loss of a family's history**, executed unattended on a background wake with no user present. That asymmetry — small bounded upside, large silent downside — is why Pass 3 spends its budget on the sweep's guard rails and none on making it cleverer.

**Pass 4 framing — the delete has a 90-day grace period built into its own data.** No cycle can be older than 90 days until 90 days after the first cycle is archived. The retention machinery is therefore _inert_ for a full quarter after ship, whatever it does. That is the decisive sequencing fact (see **Sequencing**): the irreversible half can be built, reviewed and shipped separately, against real production data, at zero user risk.

**Decisions taken with greg before planning:**

1. **SUPERSEDED — was two-tier retention.** Originally: full snapshots for a window, then collapse to a summary. Greg replaced this after Pass 2 established the append-only fact: _"i think we can delete any list record older than 3 months. i think there is no need to capture these list records for longer. perhaps in the future we can provide this as an option, but for now i would say to delete older lists (3 months +) and ensure that is clearly documented in the help center."_ See decision 3.
2. **Archive every cycle, including untouched ones.** "0 of 5 done" on a Tuesday is precisely the information a parent is looking for, and one uniform rule means fewer edge cases than "archive only if something was ticked", which would also make a gap in the history ambiguous. Retained. (One narrowing: a recurring list with **zero items** archives nothing — "0 of 0" is noise, not history.)

3. **SINGLE-TIER RETENTION: keep an archived cycle for 3 months, then DELETE it.** The collapse-to-summary tier is removed outright — with deletion at 90 days there is nothing left to collapse at 90 days, so the second tier had no window to operate in. This is strictly less machinery: one constant, one predicate, no `deleteKeys` op, no summary-tier rendering, no "detail kept for 90 days" copy.

   **Scope, confirmed with greg: ARCHIVED CYCLES ONLY.** Completed one-off lists a person wrote by hand (a packing list, a party checklist) are never auto-deleted. The rule is "the app only auto-deletes what the app auto-created", which is also the rule that makes it safe to document without alarming anyone.

   **Stated honestly, because the phrasing that prompted it read size-motivated:** deleting does NOT shrink the `.beanpod`. Under ADR-032 history is permanent, so a delete is another op and marginally _grows_ the file. What it buys is bounded memory, a browsable shelf, and less family data retained. Those are the reasons to do it; file size is not one, and the plan must not imply otherwise.

   **Pass 3 — the orphan rule is REMOVED from the sweep.** Pass 2 added "or the cycle's `listId` is no longer among the live lists" as a self-healing backstop. It is deleted. Its benefit is negligible (an orphan expires on its own within 90 days and its bytes are already spent), and its failure mode is the most dangerous thing in the feature: the predicate reads `lists.value`, so **any state in which the lists collection is empty or partially loaded makes every stored cycle an orphan and deletes the entire history in one batch**. Removing it makes the sweep a pure function of `(cycles, todayYmd)` with no dependency on any other collection. Intentional removal of a list's history is still handled by the cascade in `deleteList`.

   `ListCycle.items` is **required**, not optional (Pass 3): optional-for-a-speculative-future meant every consumer and the retention predicate had to handle a state nothing can produce, plus a test for an unreachable branch. `migrateDoc` back-fills collections on load, so a future summaries tier is a normal schema change.

## Requirements

1. When a recurring list's cycle rolls over, the outgoing cycle is preserved with its item state intact — which items were ticked and which were not, plus who ticked each one where that is recorded.
2. The live recurring list continues exactly as today: unchecked, `lastResetDate` bumped, same id, same place in the UI. Nothing about the active-list experience changes.
3. Archived cycles are reachable from the **completed** shelf, newest first, under the recency bands already built (`groupCompletedByRecency`).
4. A cycle is archived even when no item was ticked. (A cycle with no items at all is not archived.)
5. **An archived cycle is kept for 3 months and then deleted.** Automatic, no user action, no summary tier. Only auto-generated cycles are subject to this; a completed one-off list the user made is never auto-deleted. **The deletion decision must depend on exactly two inputs — the cycle's own dates and today's date — and on nothing else in the document.**
6. Archived cycles are **read-only history**. Ticking an item in last week's cycle is meaningless and must not be possible — structurally, not by a disabled attribute, and **not by rendering an interactive-looking control whose event is simply unhandled** (Pass 4).
7. The archive must not grow without bound **in memory or on the shelf**: state the steady-state live-record count and hold it flat. **File growth is monotonic by CRDT design** — state the annual byte cost honestly for a heavy family rather than claiming flatness the storage engine cannot deliver, and never present deletion as reclaiming space.
8. The rollover must remain **idempotent and safe on a background wake**, and must converge across devices. It runs unattended at midnight / on PWA resume where a partial write has no user present to see a toast — a half-archived cycle must not be possible, a failure must be recorded, and two devices waking at the same midnight must produce **one** archived cycle, not two.
9. No change to what the wall shows. The wall reads live lists; archived cycles are not jobs and are not `FamilyList`s.
10. **The retention rule is documented in the Help Center** — in the same change that first makes a deletion possible, and not before (Pass 4: the article must never describe behaviour that has not shipped).
11. **The delete path must be bounded and clock-hostile.** No single sweep may delete an unbounded number of records; a device whose clock is wrong, has jumped, or has moved timezone must not delete history a correctly-clocked device would keep; a cycle with a missing or unparseable date must be **kept**, never treated as infinitely old; and the sweep must be disableable by a one-line constant change in a hotfix.
12. **No component that renders live lists may change shape to serve this feature.** `ListTile`, `ListShelf`, `ListItemRow` and the six existing shelves on `BeanieListsPage` keep their current props and events.
13. **(Pass 4) Both the rollover and the sweep must actually run for a user who opens the app fresh each day.** A `watch(today, …)` alone does not satisfy this — see the caveat below.

## Important Notes & Caveats

Every claim below was read in the code during Pass 2.

- **`isFiled` is `!isRecurring(list) && list.completed`** (`listLifecycle.ts:23`) — verified. The chosen storage keeps snapshots _out of_ the `lists` collection entirely, so this predicate is untouched and cannot be tripped.
- **`reconcileRecurringLists` is the ONE write path for the clock advancing** (`listStore.ts:437-472`) — verified, including the docstring and the watcher on `today` (`listStore.ts:482`). The archive write belongs inside it; no second scheduler.
- **It already logs a failed reset** (`level:'warn'`, `surface:'recurrence'`, `message:'list-reset-failed'`, `context:{recur_surface:'list', recur_outcome:'write-failed'}`, `listStore.ts:463-470`) — verified, added by #70 after a silent background-wake failure.
- **`docClient.mutate` accepts `{ op:'batch', ops }`** — verified (`worker/protocol.ts:73`), and **a batch is exactly ONE `Automerge.change`, so a mid-batch throw commits nothing** (`worker/docOps.ts:517-519`). `familyStore.normalizeRoles` does use it (`familyStore.ts:539`), as do `mealPlanRepository.replaceWeek`, `medicationRepository`, `recipeRepository`, `activityRepository`.
- **A batch returns `undefined`** — verified: `deltaFor`'s `case 'batch'` returns `undefined` (`docOps.ts:506-509`). So success **cannot** be inferred from the return value; it is "the promise resolved without throwing", and the plan below adds an explicit post-write verification read so a no-op write cannot pass as success.
- **`computeRecurringReset` does not tell you when the cycle ended.** Verified (`listLifecycle.ts:91-107`): it returns `{ shouldReset, nextResetDate }` where `nextResetDate` is simply `todayStr`, and `isResetDue(...)` is a boolean. Pass 1's "record the cycle that ended, using the same boundary" is **not implementable without new engine work**. Corrected: the archived cycle's span is `[previous lastResetDate, today]`, which is exactly what the reset cursor already encodes, and is honest for a missed-cycle gap.
- **Missed cycles produce ONE archived record**, spanning the whole gap. The engine exposes no boundary enumerator here, and one truthful "25 Aug – 1 Sep, 2 of 6 done" record beats five fabricated ones. This answers the open question in Pass 1's notes.
- **`ListItemRow` is read-only by default** — verified (`ListItemRow.vue:15-24`): `removable`, `editable`, `draggable` are all opt-in props. The archived-cycle view needs no new row component and no `disabled` plumbing.
- **`groupCompletedByRecency` exists** (`utils/completedListBands.ts`) and its only production consumer is `BeanieListsPage.vue:89` — verified. It is typed on `FamilyList[]`; Pass 2 generalises it rather than forking it.
- **`ListShelf` is used only by `BeanieListsPage`, and `ListTile` only by `ListShelf`** (plus `ListTile.test.ts`) — verified. The view-model refactor below has a three-file blast radius.
- **Do not touch the wall's job model.** `buildWallJobs` (`utils/wallJobs.ts:135`) reads `listStore.lists`; under this design that array's contents are unchanged, so the wall is structurally unaffected.
- **Adding a collection is cheap and self-registering** — verified: `COLLECTION_NAME_SEED` is `Record<CollectionName, 0>` so omission is a compile error (`types/automerge.ts:100`); `projection.ts`, `seedDocument.ts` and `services/e2e/dataBridge.ts` all derive from `COLLECTION_NAMES`; `migrateDoc` initialises collections missing from an older doc on load (`worker/docOps.ts:38-44`), so **existing families need no migration**; and `SNAPSHOT_VERSION` embeds a hash of `COLLECTION_NAMES` (`worker/cache.ts:180-188`), so the fast-paint snapshot self-invalidates — **no manual `SNAPSHOT_MANUAL_REV` bump is required**.
- **Why a snapshot must not be a `FamilyList` (the rejected option A), in specifics.** Verified failure modes: it would be picked up by `deriveNotifications` and fire a bogus `list-completed` notification unless `completedBy` is deliberately left unset (`utils/notifications.ts:264-270`); it would appear on trip/activity pages unless links are deliberately stripped (`LinkedLists.vue:36`); it would be silently editable and deletable through every existing list action (`toggleItem`, `renameList`, `deleteList`) because it _is_ a list; and it would enter `listStore.lists`, which six consumers read (`useWallJobs`, `useWallPeripherals`, `notificationsStore`, `LinkedLists`, `ListDetailModal`, and the getters behind `useNavBadges`/`useCriticalItems`). Its safety would rest on three implicit invariants that a future edit can break with no test failing.
- **`docs/PERFORMANCE.md` growth table** — verified: Year 1-2 `< 3K` records / `< 300KB`; Year 5-8 `1MB - 3MB`; Year 12+ `5MB+` "multiple areas need attention".
- **The delete op is named `delete`, not `remove`** (`protocol.ts:57`) — Pass 2 wrote `{op:'remove'}`, which does not exist in `MutationOp`. Corrected throughout.
- **`delete` on an id already gone is a silent no-op** (`docOps.ts:452-454`), so a sweep list built from a slightly stale read cannot abort the atomic batch. It also means a delete op is not self-validating — one more reason the sweep must be bounded rather than trusted.
- **`requestMutate` exposes a `changed` flag** (`docClient.ts:750-757`) but it only says the heads moved, not that the fields we intended are in the projection. The explicit post-write projection read stays as the verification; it is synchronous and costs nothing.
- **A backwards clock cannot cause a spurious reset** — verified: `isResetDue` computes `nextDueAfter(rule, anchor, last)` and returns `today >= next` (`recurrenceEngine.ts:255-267`). With `last` in the future, `next` is further ahead, so `shouldReset` is false. Flying west stalls the rollover rather than re-running it — the safe direction, pinned by a test.
- **Repository reads are synchronous projection reads** (`automergeRepository.ts:48-50`), and `mealPlanRepository.replaceWeek` reads `list('mealPlans')` directly to build its ops. The sweep follows that idiom and builds its delete list from `list('listCycles')`, **not** the reactive store array, so a stale array cannot widen a deletion.
- **A `shallowRef`'s array must be replaced, not mutated.** Pass 2 said "push the snapshot onto `cycles.value`"; `.push` on a `shallowRef` does not trigger reactivity and the new cycle would not appear until reload. Corrected to `cycles.value = [...cycles.value, snapshot]`.
- **There is a per-device localStorage idiom with a no-silent-failure contract** (`composables/perMemberStore.ts`: warn on read, `reportError` on write failure). The sweep's clock high-water mark follows it, keyed per DEVICE not per member.
- **A deleted cycle is recoverable only from a `.beanpod` backup** via Google Drive version history (`content/help/getting-started.ts:183,197`). There is no in-app undo. This is why the guard rails are load-bearing and why the help article must name that route.
- Do not restate baked-in constraints (DRY, i18n, no-silent-failures) — enforced elsewhere.

## Assumptions

> Review before implementation.

1. A cycle's `endedOn` is the day of the rollover (`today`), and that is what the recency banding reads. `startedOn` is the previous `lastResetDate`.
2. Archived cycles do not sync to the wall, the nook, notifications or any count badge. They are history, browsed deliberately. (Under the chosen storage this is structural, not a filter.)
3. **(P4)** A cycle records item _titles and done-state only_. Per-item timestamps and ids are deliberately not kept; finer detail than "who ticked what during this cycle" is out of scope. Beyond the 3-month window the record is gone, and the only route back is restoring an older `.beanpod` from Google Drive version history.
4. Retention runs on the same trigger as the reset (app load / day advance / PWA wake), so no new scheduler is introduced.
5. The keep window is a constant in code, not a user setting.
6. Denormalising `title`/`emoji`/`category`/`ownerId` onto the snapshot is correct, not redundant: renaming a list must not retroactively rename its history, and the archive must remain readable after the parent list is deleted.
7. A device's local clock is **not trusted** as a sole authority for a destructive decision. It is trusted for display, banding and the rollover (where being wrong is recoverable), and only conditionally trusted for the sweep (where it is not). **(P4) The residual risk of a device whose clock is persistently and materially wrong is bounded, not eliminated** — see the reliability table.

## Approach

### Sequencing — SHIP IN TWO INCREMENTS (Pass 4)

This plan is too large for one change, and it does not need to be one. **No cycle can be 90 days old until 90 days after the first cycle is archived**, so the deletion half is inert for a full quarter after ship, whatever code exists.

**Increment 1 — archive and browse. Contains no deletion-by-age code at all.**
Types, the collection, `archiveCycleAndReset`, `deleteListWithCycles`, `buildCycleSnapshot`/`cycleId`, the store changes (`cycles`, `loadCycles`, archive + verify, `runDailyMaintenance`, cascade in `deleteList`, `resetState`), `groupByRecency<T>`, `ListTileShell`/`ListCycleTile`/`ListCycleShelf`/`ListCycleModal`, the page section, strings, `cycle-archived`/`cycle-archive-failed` telemetry, tests. The help article documents **the archive only** — it says nothing about retention, because at this point nothing is ever deleted.
_Risk profile: purely additive. The worst outcome is records accumulating._

**Increment 2 — retention. The only irreversible part, reviewed on its own.**
`expiredCycleIds`, `cycleSweepClock`, `sweepExpiredCycles`, `deleteCycles`, the four constants and the kill switch, the sweep telemetry, the "Kept for 3 months" UI line, the retention help copy, and its tests.
_Must land within 90 days of increment 1's first production archive._ If it slips, the only cost is an unbounded shelf — recoverable, and strictly preferable to documenting a deletion that has not shipped.

Both increments can sit in the same release; the split exists so the delete gets its own reviewable diff. **Within increment 1, extract `ListTileShell` in its own commit**, so the one change touching an existing live-list component is inspectable in isolation.

Sections below are marked **[INC 2]** where they apply.

### Storage — SETTLED: (B) a separate `listCycles` collection

Pass 1 offered (A) snapshots as `FamilyList` records and (B) a separate collection, and leaned to B on live-record count. Pass 2 settles on **B**, on stronger evidence:

1. **Bytes are permanent, so record _shape_ is the whole game.** A `FamilyList` carries ~20 fields of which none are meaningful for history, plus a full `FamilyListItem` per item (`id` UUID + `completedAt` ISO timestamp per item). Option A therefore writes roughly **3x the permanent bytes** of the purpose-built record below, on every rollover, forever.
2. **Option A's safety is implicit; B's is structural.** The six `lists` consumers stay untouched because a cycle is not a list. Requirements 2, 6 and 9 become impossible to violate rather than defended by unwritten invariants.
3. **B's cost is much lower than Pass 1 assumed.** The collection registers itself, the projection/seed/e2e bridge derive it, `migrateDoc` back-fills existing docs, the snapshot cache self-invalidates, and the repository is the standard `createAutomergeRepository` call plus bespoke batch functions that `mealPlanRepository` already models.
4. **The one real cost of B — merging two sources on the shelf — is paid once, as a DRY win.** `ListShelf`/`ListTile`/`groupCompletedByRecency` are generalised over one small view-model rather than forked.

**Types** (`src/types/models.ts`, beside `FamilyList`):

```ts
/** One item's state at the moment a cycle ended. Deliberately terse — every byte
 *  here is permanent (ADR-032) — but NOT cryptic. Pass 3 rejected single-letter
 *  keys (`t`/`d`): they save ~7% of this feature's annual growth in exchange for
 *  a .beanpod nobody can read during a support incident, and a `t` field in a
 *  codebase where `t` is the i18n function everywhere else. What IS omitted is
 *  what costs and buys nothing: no item id (nothing references it) and no
 *  per-item timestamp (the cycle's dates are the timeline). */
export interface ListCycleMark {
  title: string; // title as it read that cycle
  done: boolean;
  by?: UUID; // who ticked it, when recorded
}

/** A finished cycle of a recurring list. Written ONCE at rollover and never
 *  rewritten — retention deletes it outright rather than rewriting it. */
export interface ListCycle {
  /** `${listId}:${endedOn}` — DETERMINISTIC. Re-running the rollover overwrites
   *  rather than duplicating, and two devices waking at the same midnight
   *  converge on one record instead of two.
   *  NEVER parse this id: `listId` and `endedOn` are their own fields precisely
   *  so no consumer has to split a string. */
  id: string;
  listId: UUID;
  startedOn: ISODateString; // ymd — the previous lastResetDate
  endedOn: ISODateString; // ymd — the rollover day; drives banding + sort
  title: string;
  emoji: string;
  category: ListCategory;
  ownerId: UUID;
  done: number;
  total: number;
  /** REQUIRED (Pass 3). Optional-for-a-speculative-future meant every consumer
   *  and the retention predicate had to handle a state nothing can produce. */
  items: ListCycleMark[];
  /** Wall-clock write time. Kept ALONGSIDE `endedOn` because they can disagree
   *  (a wrong clock; a cycle merged in from another device). The sweep requires
   *  BOTH to be expired. */
  createdAt: ISODateString;
  /** Always equals `createdAt` — a cycle is never updated. Retained only so the
   *  record matches every other collection's shape. Nothing reads it. */
  updatedAt: ISODateString;
}
```

`FamilyDocument.listCycles: Record<string, ListCycle>` + `listCycles: 0` in `COLLECTION_NAME_SEED`.

**Repository** — `src/services/automerge/repositories/listCycleRepository.ts`, following `mealPlanRepository` exactly:

```ts
const repo = createAutomergeRepository<'listCycles', ListCycle>('listCycles');
export const getAllCycles = repo.getAll;

/** Archive the outgoing cycle AND reset the live list as ONE Automerge change.
 *  Atomic by construction (docOps.ts:517): a throw commits neither. */
export async function archiveCycleAndReset(
  cycle: ListCycle,
  listId: string,
  reset: UpdateFamilyListInput,
  nowIso: string
): Promise<void>;

/** Delete exactly the cycle ids given. The ONLY delete path for this collection.
 *  Takes ids and computes nothing: every decision about WHICH ids is made by the
 *  pure `expiredCycleIds` and is unit-testable without a document. */
export async function deleteCycles(ids: readonly string[]): Promise<void>;

/** Delete a list and its whole history in one change (no orphan window). */
export async function deleteListWithCycles(listId: string, cycleIds: string[]): Promise<void>;
```

The reset half is a `{op:'patch', collection:'lists', id, patch, updatedAt}` op — the same patch `updateList` would have sent, minus the `wrapAsync` wrapper (the caller owns error handling because background-wake behaviour differs). `deleteCycles` is a batch of `{op:'delete', collection:'listCycles', id}` ops (op name verified against `protocol.ts:57`).

### Rollover

`src/utils/listCycles.ts` — pure, Vue-free, timezone-safe ymd string math, matching `listLifecycle.ts`'s house style:

```ts
export const cycleId = (listId: string, endedOn: string) => `${listId}:${endedOn}`;
export function buildCycleSnapshot(
  list: FamilyList,
  endedOn: string,
  nowIso: string
): ListCycle | null;
/** Which stored cycles must go: past the keep window, or orphaned by a deleted list. */
export function expiredCycleIds(
  cycles: readonly ListCycle[],
  liveListIds: ReadonlySet<string>,
  todayYmd: string
): string[];
/** Three months. The ONE retention knob; a future "keep longer" setting replaces
 *  this constant and nothing else. */
export const CYCLE_KEEP_DAYS = 90;
export const MAX_SWEEP_DELETES = 50;
export const MAX_TRUSTED_CLOCK_JUMP_DAYS = 7;
export const CYCLE_SWEEP_ENABLED = true; // hotfix kill switch (Requirement 11)
```

`reconcileRecurringLists` becomes, per list whose cycle has rolled:

1. `const snapshot = buildCycleSnapshot(list, nextResetDate, nowIso)` — from the list **before** the reset.
2. If `snapshot` is null (no items), fall through to today's plain `updateList` reset — unchanged behaviour, no archive.
3. Otherwise `await archiveCycleAndReset(snapshot, list.id, resetPatch, nowIso)` — one batch, atomic.
4. **Verify, because a batch echoes `undefined`:** re-read `listRepo.getListById(list.id)` and assert `lastResetDate === nextResetDate`. A mismatch is treated exactly like a throw (`recur_outcome:'verify-failed'`).
5. On success, **replace** the arrays: `cycles.value = [...cycles.value, snapshot]` (a `shallowRef` does not react to `.push`) and splice the refreshed list into `lists.value`.
6. On failure — see Error Handling — log, report, toast **only if someone is watching**, and `continue`. One list's failure must never abort the loop.

The re-entrancy guard lives on `runDailyMaintenance` (above), not on `reconcileRecurringLists`, so it covers the sweep too.

Idempotence comes from three independent mechanisms: the re-entrancy guard, `computeRecurringReset` returning `shouldReset:false` once `lastResetDate === today`, and the deterministic `cycleId` making any repeat write an overwrite. Multi-device convergence comes free from the same key.

### Retention

**Pass 3 structural change: the sweep is its own function, not a tail of the reset.** Pass 2 appended it to `reconcileRecurringLists`, whose docstring reads "The ONE write path for 'the clock advanced'". Hiding an irreversible delete behind a benign name is the kind of thing that survives ten reviews and then surprises someone.

```ts
let maintaining = false; // re-entrancy: loadLists, the today watcher and a PWA
// resume can overlap, and two passes over the same list
// would both read pre-reset state.
async function runDailyMaintenance(): Promise<void> {
  if (maintaining) return;
  maintaining = true;
  try {
    await reconcileRecurringLists();
    await sweepExpiredCycles(); // [INC 2] named for what it does: it deletes history
  } finally {
    maintaining = false;
  }
}

// loadLists() ends with:  await runDailyMaintenance();   // was reconcileRecurringLists()
watch(today, () => {
  void runDailyMaintenance();
});
```

**Both call sites are required (P4).** `loadLists` is what makes the pass run for a user who opens the app fresh each day; the watcher is what makes it run for a tab left open across midnight. A reset failure does not skip the sweep; a sweep failure does not affect tomorrow's reset. The sweep is deliberately NOT a tail of `reconcileRecurringLists` — hiding an irreversible delete behind a docstring reading "The ONE write path for 'the clock advanced'" is the kind of thing that survives ten reviews and then surprises someone.

**The rule — one predicate, two inputs.**

```ts
/** Which stored cycles have expired. PURE: the ONLY inputs are the cycles and
 *  today. No lists, no store, no clock. A cycle expires when BOTH its `endedOn`
 *  and its `createdAt` day are strictly older than `todayYmd - CYCLE_KEEP_DAYS`.
 *
 *  Kept, never deleted:
 *    - a missing, empty or non-`YYYY-MM-DD` date on EITHER field (a partial or
 *      malformed record must NOT read as infinitely old -- `'' < cutoff` is true
 *      for a string compare, which is exactly how a badly-loaded doc would
 *      silently lose a family's history);
 *    - a future-dated cycle (a clock artefact, not expired data);
 *    - anything beyond the first `MAX_SWEEP_DELETES`, oldest first. */
export function expiredCycleIds(cycles: readonly ListCycle[], todayYmd: string): string[];
```

Requiring **both** dates is cheap belt-and-braces: `endedOn` comes from the reactive `today` at rollover, `createdAt` from `new Date()` at write time. They agree on a healthy device and disagree exactly in the cases worth being careful about.

**`sweepExpiredCycles` — the guards, in order.**

| #   | Guard                                                 | Why                                                                                                                                          |
| --- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `if (!CYCLE_SWEEP_ENABLED) return;`                   | Kill switch. A data-loss report is fixed by a one-character release, not a redesign under pressure.                                          |
| 2   | doc loaded AND `cyclesLoaded`                         | Never sweep on a document or collection whose load has not provably completed. `cyclesLoaded` is set true only by a successful `loadCycles`. |
| 3   | Clock high-water check (below)                        | A forward jump delays the sweep; it never accelerates it.                                                                                    |
| 4   | `const stored = list('listCycles')`                   | Read the **projection**, not `cycles.value` -- removes staleness from the deletion decision entirely.                                        |
| 5   | `expiredCycleIds(stored, today.value)`                | The pure predicate, with keep-on-doubt and its cap.                                                                                          |
| 6   | `await deleteCycles(ids)` then filter the store array | One batch, at most `MAX_SWEEP_DELETES` records.                                                                                              |
| 7   | `logEvent('cycle-swept')` with the count              | Retention is invisible when it works.                                                                                                        |

**Guard 3 — the clock high-water mark.** A per-device localStorage key holding one ymd string, read/written with the `perMemberStore` no-silent-failure discipline.

```
missing / corrupt  -> write today, SKIP        (a device's first ever sweep deletes nothing)
today <  stored    -> SKIP, do not rewind      ('clock-regressed' -- travelled west, or corrected)
today >  stored+7  -> write today, SKIP        ('clock-jumped' -- long absence OR a wrong clock)
otherwise          -> sweep, then write today
```

Every skip costs a day's delay, worth nothing to anybody. The benefit: a clock set forward a year deletes **nothing** on the run where it is first seen, and if it persists is bounded to 50/day with `cycle-swept` telemetry showing the anomaly. Losing the key (private mode, cleared storage) costs one skipped run, never a wrong deletion.

**Why `MAX_SWEEP_DELETES = 50`.** Steady-state churn for the heaviest family is ~3.3 cycles/day, so 50 is a two-week backlog cushion. It also caps the batch: one `Automerge.change` containing 1,200 deletes on a background wake is a real memory and serialisation event on a low-end phone.

**Do the guards compose? (P4)** Traced against every initialisation and merge path:

- _Fresh install / new empty doc._ `isDocLoaded()` true, `listCycles` empty, `expiredCycleIds([])` is `[]` → nothing deleted. Safe **because the predicate is per-record** — exactly the state in which Pass 2's orphan rule would have deleted a whole history.
- _Cold start from cache, then a remote merge._ Guard 2a is false until the final projection chunk; a sweep between the two is impossible, and one after sees the union.
- _Merge brings in cycles this device has never seen._ Evaluated on their own dates like any other. No "unknown to me implies delete" path exists anywhere in the design.
- _Sweep concurrent with an archive._ Serialised by `maintaining`, and semantically disjoint anyway (a 90-day-old id can never equal today's id).
- _A record in `cycles.value` but not the projection, or vice versa._ Irrelevant — guard 4 means only the projection is consulted.

No ordering produced an over-broad delete. The one guard droppable without loss of safety is `cyclesLoaded` (2b), kept as a cheap forward-compatibility check and correctly described.

**What the sweep no longer does.** No orphan rule. No `lists` read of any kind. No `deleteKeys`. No summary rewrite. It touches one collection and can only remove records >=90 days old by two independent dates.

**Deleting a list still deletes its history immediately** via `deleteListWithCycles` inside `deleteList`'s existing `wrapAsync` — the intentional path, taken by a user who is present, and the reason the automatic orphan rule is not needed.

**Steady state and honest cost.** Heavy family = 3 daily + 2 weekly recurring lists = **1,199 cycles/year**.

**(P4) The per-record estimate is widened and marked as an estimate.** Pass 3's flat "~460 B" is optimistic: a 10-item chore list with a `by` UUID on each done item is ~500 B of payload before Automerge's per-key overhead. Realistic range **0.4–1.5 KB per cycle**, to be **measured during implementation** (archive 100 synthetic cycles, diff `Automerge.save()` byte length) and the measured figure written back into this table before merge.

| Measure                                       | Heavy family (5 recurring lists) | Typical family (1 weekly list) |
| --------------------------------------------- | -------------------------------- | ------------------------------ |
| Live records held (flat from month 3)         | **~296** (90 days' worth)        | ~13                            |
| Live content in the doc                       | ~120–450 KB                      | ~5–20 KB                       |
| Reactive memory (`shallowRef`, no deep proxy) | same as above                    | same as above                  |
| **Permanent file growth (never reclaimable)** | **~0.5–1.8 MB/year**             | **~0.02–0.08 MB/year**         |

**File growth is unchanged by retention and must not be presented as if it were.** A heavy family still writes on the order of 1 MB/year permanently, reaching `docs/PERFORMANCE.md`'s 1–3 MB "Year 5-8" band from this feature alone within a few years. The only real levers are on bytes _written_. Deleting more aggressively would buy a few hundred KB of RAM at increasing risk to a family's history. **If the measured figure lands at the top of the range, the response is to reconsider what a mark stores (e.g. drop `by`), not to shorten the keep window.**

### Reliability of the delete path — the failure modes, answered

| Scenario                                                              | What happens                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clock set a year forward, once                                        | Guard 3 sees a >7-day jump, records the new day and **skips**. Never a single unattended burst.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Clock **persistently** wrong by far more than 90 days, app used daily | **Residual risk, accepted not eliminated (P4).** After the first skip, each subsequent day is a <=7-day advance, so the sweep runs and removes up to 50 records/day. Over weeks that can erode a real history. There is no trusted time source in a serverless, offline-first app that would close this without inventing one. Mitigations: the cap makes it gradual rather than instant; `cycle-swept` at or near 50 for consecutive days is the fingerprint; `CYCLE_SWEEP_ENABLED=false` is the response; recovery is Drive version history. This is the honest ceiling of the design, documented rather than hidden. |
| Clock backwards / travelled west                                      | Guard 3 skips and does **not** rewind the stored day. The rollover is separately safe: `isResetDue` returns false for a future `lastResetDate` (verified).                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Timezone change, correct clock                                        | Dates are local ymd strings; a one-day shift changes which day a cycle is filed under, never its age by 90 days. A same-day repeat overwrites the same deterministic id.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Document loads partially                                              | Guard 2 blocks. If a partial read got through, guard 4 reads the projection (a subset -> a subset of deletes, never a superset), and keep-on-malformed means a truncated date is **kept**.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `listCycles` empty (new doc, wiped cache, failed load)                | `expiredCycleIds([])` is `[]`. Per-record evaluation means an absent collection can only ever delete _less_, never more. This is exactly the state in which Pass 2's orphan rule would have deleted everything.                                                                                                                                                                                                                                                                                                                                                                                                         |
| Sweep racing an archive                                               | Sequenced and re-entrancy-guarded; semantically disjoint anyway. Each is one atomic change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Two devices sweeping the same midnight                                | Same expired set from the same replicated data; a `delete` on an already-gone key is a verified no-op and delete/delete merges cleanly.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| A device sweeps while another is offline                              | The offline device merges the deletes on reconnect. CRDT-correct and intended — and the reason the cap matters, since one device's bad decision propagates.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| A future edit reintroduces a collection dependency                    | `expiredCycleIds` takes exactly two parameters in a Vue-free file importing nothing from the store. A static-import test fails CI.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Someone needs a swept cycle back                                      | Restore an older `.beanpod` from Google Drive version history. No in-app undo; the article must not imply one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

### Presentation — additive, not a refactor of the live-list tiles

**Pass 3 rejects Pass 2's `ListTileModel` view-model.** Pass 2 proposed generalising `ListTile`, `ListShelf` and the banding over a discriminated union so completed one-off lists and archived cycles could interleave in one grid. The cost is paid by the wrong code: `ListTile` serves **six shelves**, five unrelated to this feature; all six call sites would gain a `.map(tileFromList)`, `ListShelf` would gain a `tiles`/`bands` pair plus a header count no longer derived from its own prop, and `open` would become `[id, kind]` — a discriminant five of six consumers must accept and ignore. Worse, pill logic would end up **split across two files** (data in the util, copy still resolved in the component), so the "one place for tile logic" it promises is not achieved. That is a net increase in coupling across the app's busiest list surface to serve a new, optional feature.

What Pass 3 keeps is the part that is genuinely generic:

1. **`completedListBands.ts` becomes `groupByRecency<T>(items, todayYmd, whenOf)`.** Real, small generalisation: the banding maths is date logic with no knowledge of what it groups, and forking it would be straight duplication. `ListBand.lists` becomes `items`; `groupCompletedByRecency` remains a one-line typed alias so `ListShelf` and its tests do not change at all.
2. **`ListTile.vue` and `ListShelf.vue` are not touched** (Requirement 12).
3. **`ListTileShell.vue` (new, presentational).** The chrome shared by a list tile and a cycle tile — tinted emoji strip with `MemberChip` and watermark, title, category dot + label, one optional pill, progress bar and "x of y" — lifted verbatim out of `ListTile.vue` into a dumb component with plain props. No store, no i18n, no lifecycle: every string arrives resolved. `ListTile` keeps its own `statusPill` computed and renders the shell; the diff is a template swap with no interface change.

   **(P4) Two binding conditions, applying Pass 3's own reasoning consistently.** Pass 3 killed `ListTileModel` on the principle "do not refactor the app's busiest list surface to serve an additive feature". `ListTileShell` survives that principle _only_ because it needs **zero conditional props** — a pure lift with no variant. Therefore **(a)** it lands as its own commit so the one live-component change is reviewable in isolation, and **(b)** if the shell needs even one `variant`/`is-*` prop to please two callers, **abandon it and duplicate the ~60 lines of markup into `ListCycleTile.vue`**. Two small readable components beat one with a discriminant.

4. **`ListCycleTile.vue` (new, ~40 lines).** Renders a `ListCycle` through the shell with a single `archived` pill (the formatted `endedOn`, or a from-to span when the dates differ) and `done`/`total` straight off the record. Imports nothing from `listLifecycle`: a cycle has no due state, cadence or links.
5. **`ListCycleShelf.vue` (new, ~40 lines).** The banded grid for cycles — the cycle-side twin of `ListShelf` minus the collapse control, deletable wholesale if the feature is ever dropped.
6. **`BeanieListsPage.vue`** gains one section inside the Completed area:

```ts
const cycles = computed(() =>
  listStore.archivedCycles.filter(
    (c) => !selectedCategory.value || c.category === selectedCategory.value
  )
);
const cycleBands = computed(() => groupByRecency(cycles.value, today.value, (c) => c.endedOn));
```

`listStore.archivedCycles` is member-filtered with the existing `createMemberFiltered(cycles, c => c.ownerId)`, and the store sorts newest-first so banding preserves it.

**Why a separate section is the better product, not just the cheaper build.** A completed one-off list and an automatic cycle snapshot are different things with different lifetimes: one is a thing a person finished and the app keeps forever, the other is a thing the app generated and will delete in three months. Interleaving them hides that difference at exactly the moment it matters. As its own section — "Repeating list history", with a muted "Kept for 3 months" line — the retention rule becomes legible in the UI rather than only in the help article, which is the cheapest possible way to satisfy the "discoverable before it surprises them" requirement.

**`ListCycleModal.vue`** (new, ~70 lines) renders an archived cycle read-only: the shared `BeanieFormModal` shell (drawer variant, `save-label = action.close`, no delete), denormalised title/emoji/owner via `MemberChip`, a date-span line, the progress bar, and its **own static mark rows**.

**(P4) It does NOT reuse `ListItemRow`.** That component always renders a tappable checkbox that emits `toggle` (its only default-mode consumer, `LinkedLists`, wires it), and it is typed on `FamilyListItem`, which would force a synthetic id onto every id-less `ListCycleMark`. A ~12-line static row — tick glyph, strikethrough title, `MemberChip` for `by` — is less code than the adapter, adds no prop to a live-list component, and makes Requirement 6 structural rather than incidental: no toggle handler, no emitted event to forget to ignore, no store action mutating a `ListCycle`, no write path outside the three repository functions.

Deliberately **not** a `readOnly` prop on `ListDetailModal`: ~470 lines of editing machinery, and threading a flag through fifteen controls is more code and a far larger regression surface on the app's most delicate modal.

### Error handling — nothing fails silently

| Failure                                   | Handling                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `archiveCycleAndReset` throws             | `try/catch` in the loop. `logEvent({level:'warn', surface:'recurrence', message:'cycle-archive-failed', context:{recur_surface:'list', recur_outcome:'write-failed'}, error})` + `reportError({surface:'listStore.reconcileRecurringLists', severity:'error', message:'archive+reset batch failed — the cycle was NOT archived and the list was NOT reset (the batch is atomic, so state is consistent); it retries on the next day-advance/wake.'})`. `continue`. |
| Batch resolves but the list did not reset | Identical path with `recur_outcome:'verify-failed'`. This is the hole a batch's `undefined` return would otherwise leave.                                                                                                                                                                                                                                                                                                                                          |
| A user is present                         | `useToday().isVisible` gates `showToast('error', t('lists.cycle.archiveFailed'), t('lists.cycle.archiveFailedHelp'))`. A background wake logs and reports but does not queue a toast nobody will see.                                                                                                                                                                                                                                                              |
| Loading cycles fails                      | Its own `wrapAsync` (`action:'listStore:loadCycles'`) with **its own `cyclesLoading`/`cyclesError` refs** (P4 — sharing the store's would let a history read blank or error the live-lists shelf, and `wrapAsync` toasts by default). `cycles.value = []`, `cyclesLoaded.value = false`, toast, `reportError`.                                                                                                                                                     |
| `sweepExpiredCycles` throws **[INC 2]**   | `try/catch`; `cycle-sweep-failed` + `reportError` (severity `warning`). Never rethrown. The store array is filtered only **after** the batch resolves, and the clock high-water day is **not** advanced, so a failed sweep leaves the UI honest and retries next run.                                                                                                                                                                                              |
| Sweep skipped by a guard **[INC 2]**      | `logEvent` `cycle-sweep-skipped` naming the guard (`first-run` / `clock-regressed` / `clock-jumped` / `not-loaded`). **The routine same-day verdict does not log** (P4). Silence on the others would make a permanently-stalled sweep undiagnosable.                                                                                                                                                                                                               |
| Clock high-water read/parse fails         | Warn, treat as missing, skip this run, attempt to write today. Never throws, never deletes.                                                                                                                                                                                                                                                                                                                                                                        |
| Clock high-water write fails              | `reportError` (warning) per the `perMemberStore` contract, and **skip** — a sweep whose cursor cannot advance would otherwise re-evaluate the same jump forever.                                                                                                                                                                                                                                                                                                   |
| Cascade delete fails                      | Inside `deleteList`'s existing `wrapAsync` → toast + report. The cycles remain and expire naturally within 90 days.                                                                                                                                                                                                                                                                                                                                                |
| A selected cycle vanishes                 | `ListCycleModal` renders nothing; the page's watcher clears `selectedCycleId` and `console.warn`s with the id.                                                                                                                                                                                                                                                                                                                                                     |

`cycles` is a **`shallowRef<ListCycle[]>`** — the records are immutable by contract, so the 2-3x Vue deep-proxy cost is avoided outright.

## Files Affected

- `src/types/models.ts` — `ListCycleMark`, `ListCycle`
- `src/types/automerge.ts` — `FamilyDocument.listCycles` + `COLLECTION_NAME_SEED` entry
- `src/services/automerge/repositories/listCycleRepository.ts` — **new**
- `src/services/automerge/repositories/index.ts` — export
- `src/utils/listCycles.ts` — **new** (pure: snapshot, id, `expiredCycleIds`, the four constants)
- `src/utils/cycleSweepClock.ts` — **new**, ~40 lines: the per-device localStorage high-water mark, with a pure `clockVerdict(today, stored)` returning `'sweep' | 'skip-first-run' | 'skip-regressed' | 'skip-jumped'` so the policy is unit-testable without localStorage
- `src/utils/completedListBands.ts` — generalise to `groupByRecency<T>`
- `src/stores/listStore.ts` — `cycles` (`shallowRef`), `cyclesLoaded`, `cyclesLoading`/`cyclesError`, `archivedCycles`, `loadCycles`, archive+verify inside `reconcileRecurringLists`, **`runDailyMaintenance` (re-entrancy-guarded, called from `loadLists` AND the `today` watcher)**, **`sweepExpiredCycles` [INC 2]**, cascade in `deleteList`, `resetState`
- `src/services/automerge/automergeRepository.ts` — export `toPlain` / `stripUndefined` (DRY); `mealPlanRepository.ts` drops its duplicate private `clean()`
- `src/components/lists/ListTileShell.vue` — **new** (markup lifted from `ListTile`)
- `src/components/lists/ListTile.vue` — template swapped onto the shell; **props and events unchanged**
- `src/components/lists/ListShelf.vue` — **unchanged**
- `src/components/lists/ListCycleTile.vue`, `ListCycleShelf.vue` — **new**
- `src/components/lists/ListCycleModal.vue` — **new**
- `src/pages/BeanieListsPage.vue` — one new banded history section + cycle selection
- `src/services/translation/uiStrings.ts` — `lists.cycle.*`, `lists.completed.archivedOn`
- `src/content/help/features.ts` — the `beanie-lists` article gains the history + 3-month-retention section (see Help Center Coverage)
- Tests: `listCycles.test.ts`, `cycleSweepClock.test.ts`, updated `completedListBands.test.ts`, `ListCycleTile.test.ts`, `ListCycleModal.test.ts`, listStore rollover/sweep/failure tests
- **No changes to** `ListTile.test.ts` (public interface unchanged), `wallJobs`, `notifications`, or any `lists` consumer
- No ADR, no doc migration, no `SNAPSHOT_MANUAL_REV` bump.

## Help Center Coverage

Required by greg: _"ensure that is clearly documented in the help center."_ Auto-deleting a family's history is precisely the behaviour a user must be able to discover **before** it surprises them.

- **Action**: `update existing`
- **Category**: `features`
- **Slug**: `beanie-lists` (`src/content/help/features.ts:1403`) — the existing lists article, not a new one. History is part of how repeating lists behave, and a separate article would be found only by someone already looking for it.
- **Title**: unchanged
- **Scope**: a new section explaining that when a repeating list starts a fresh cycle, the finished one is kept in the Completed shelf exactly as it was left — including anything not ticked — so you can look back at what got done; and that these automatic snapshots are kept for **3 months** and then removed.
- **Notes the article MUST carry:**
  - The 3-month deletion is **automatic and irreversible**. Say so plainly.
  - It applies **only to the automatic snapshots of repeating lists**. Lists a person made and completed themselves are never auto-deleted. This distinction is the whole reassurance and must not be buried.
  - A cycle is archived **even when nothing was ticked** — "0 of 5" is a real, deliberate record, not a bug.
  - A missed period produces **one** entry spanning the gap, dated from-to, rather than one per day.
  - Archived cycles are **read-only**; you cannot tick something in last week's list.
  - Do NOT claim this saves space or keeps the family file small — it does not (see the append-only note in Context). Frame it as keeping the shelf useful and not holding onto family data longer than needed.

Written per `.claude/skills/beanies-help-docs/SKILL.md` and shipped in the SAME change as the feature — an acceptance criterion, not a follow-up.

## Observability Coverage

- `logEvent` — `level:'info'`, `surface:'recurrence'`, `message:'cycle-archived'`, `context:{recur_surface:'list', recur_outcome:'archived'}` on each successful, verified archive. The **success-path counter**: archives-per-day should track active recurring lists; divergence means cycles are being lost.
- `logEvent` — `level:'warn'`, `surface:'recurrence'`, `message:'cycle-archive-failed'`, `recur_outcome:'write-failed' | 'verify-failed'`. Distinct from the existing `list-reset-failed`, and the two outcomes separate "the worker rejected it" from "it claimed success and changed nothing".
- **[INC 2]** `logEvent` — `level:'info'`, `surface:'recurrence'`, `message:'cycle-swept'`, `context:{recur_surface:'list', recur_outcome:'swept', recur_children_removed: <deleted>, recur_children_expected: <collection size>}`. **The count is the load-bearing signal**: a run at or near `MAX_SWEEP_DELETES` sustained over days is the fingerprint of a bad clock or a broken predicate, and the only way this feature's worst failure becomes visible before a user reports missing history.
  - **(P4) `recur_children_removed` / `recur_children_expected` are existing allowlisted PII-free integer keys**, reused deliberately. A new key such as `recur_swept_count` would be **stripped by the allowlist** unless mirrored into the Lambda allowlist + its pinned test, the store runbook, `PrivacyInfo.xcprivacy`, Play Data-Safety and `privacy.astro`. Pass 3's "log the count" and "no new context keys" were mutually incompatible; this resolves them.
- **[INC 2]** `logEvent` — `level:'warn'`, `surface:'recurrence'`, `message:'cycle-sweep-skipped'`, `recur_outcome:'first-run' | 'clock-regressed' | 'clock-jumped' | 'not-loaded'`. A sweep that never runs is as much a bug as one that runs too eagerly. **The routine same-day verdict is NOT logged** (P4) — it fires on every app open and would bury the anomalies.
- `logEvent` — `level:'warn'`, `surface:'recurrence'`, `message:'cycle-sweep-failed'`.
- `reportError` on every failure path, with a developer-directed message naming the batch, the collection and the retry behaviour.
- **No new context keys.** `recur_surface`, `recur_outcome`, `recur_children_removed` and `recur_children_expected` are already in `ALLOWED_CONTEXT_KEYS`; the new outcome values are values, not keys. No Lambda, store-declaration or privacy-page change, and no cycle content, title or date leaves the device.

## Acceptance Criteria

- [ ] Rolling a recurring list over archives the outgoing cycle with its item state intact (titles, done flags, who ticked)
- [ ] The live list continues unchanged: same id, unchecked, `lastResetDate` bumped, `cycleCelebrated` cleared
- [ ] A cycle with nothing ticked is archived too, showing 0 of N; a list with no items archives nothing
- [ ] Archived cycles appear in the Completed area as their own banded "Repeating list history" section, newest first, honouring the category and member filters, with a visible "Kept for 3 months" line
- [ ] An archived cycle cannot be edited or ticked — there is no code path that mutates a stored cycle's marks
- [ ] Cycles older than 90 days by **both** `endedOn` and `createdAt` are deleted automatically
- [ ] A cycle with a missing, empty, malformed or future date is **never** deleted, at any age
- [ ] No single sweep deletes more than `MAX_SWEEP_DELETES` records
- [ ] `expiredCycleIds` takes exactly `(cycles, todayYmd)` and reads no other collection, no store and no clock
- [ ] A device's first-ever sweep deletes nothing; a backwards clock skips; a forward jump of more than 7 days skips once and records the new day
- [ ] The sweep does not run when the doc or the cycles collection has not loaded successfully
- [ ] Flipping `CYCLE_SWEEP_ENABLED` to `false` disables all automatic deletion with no other change
- [ ] `ListTile.vue` and `ListShelf.vue` public props and events are unchanged, and `ListTile.test.ts` passes untouched
- [ ] A completed ONE-OFF list is never auto-deleted, whatever its age
- [ ] The `beanie-lists` help article documents the archive and the 3-month deletion, states it is automatic and irreversible, and makes clear it applies only to automatic snapshots
- [ ] Archive and reset are atomic, and a batch that changes nothing is detected, not assumed successful
- [ ] A repeated background wake, two overlapping reconcile calls, and two devices waking at the same midnight each produce exactly one archived cycle
- [ ] A missed week produces one archived cycle spanning the gap, labelled with both dates
- [ ] `listStore.lists` contains exactly the same records after a rollover as before — wall, notifications, badges, nook and linked-list embeds provably unaffected
- [ ] Steady-state live-record count, live content size and annual permanent file growth are as stated
- [ ] Every failure path logs, reports, and toasts when a user is present; none is silent
- [ ] Help Center article updated per Help Center Coverage and verified against the shipped behaviour
- [ ] Diagnostic logging in Observability Coverage implemented and verified

## Testing Plan

1. **Unit — `buildCycleSnapshot`**: marks mirror item state; `by` only for done items; no item ids or per-item timestamps leak; a list with no items returns `null`.
2. **Unit — `cycleId` / idempotence**: two runs for the same list+day produce the same id; the second write overwrites (one record, not two).
3. **Unit — `expiredCycleIds`**: a 91-day-old cycle is returned; an 89-day-old one is not; an orphan is returned at any age; a fresh one is untouched; the boundary day itself is pinned so a future edit cannot silently shift the window.
4. **Store — rollover**: a due cycle archives and resets in one `mutate` whose op is `{op:'batch'}` with exactly one `set` on `listCycles` and one `patch` on `lists`; an un-due cycle does neither.
5. **Store — atomicity + failure**: a rejecting `mutate` leaves the list un-reset and un-archived, logs `write-failed`, reports, toasts when visible, stays silent when hidden, and **continues to the next list**.
6. **Store — verify guard**: a `mutate` that resolves while the projection still shows the old `lastResetDate` logs `verify-failed` rather than `cycle-archived`.
7. **Store — missed cycles**: a week's gap produces ONE cycle with `startedOn` = the old cursor, `endedOn` = today.
8. **Store — cascade + orphans**: deleting a list removes its cycles in one change; a planted orphan is pruned on the next sweep.
   8b. **Store — the sweep never touches lists**: a `lists` collection containing a 2-year-old completed one-off list is byte-identical after a sweep. This is the guard on the "only auto-deletes what it auto-created" promise the help article makes.
9. **Store — load failure**: a throwing `getAllCycles` leaves `lists` populated, `cycles` empty, and toasts.
10. **Unit — `groupByRecency`**: existing cases pass through the generic signature; a mixed list/cycle input bands by `whenYmd`.
11. **Component — `ListTile`**: existing pill/progress cases pass via `tileFromList`; a cycle tile renders the archived-date pill and done/total.
12. **Component — `ListCycleModal`**: renders marks read-only; **asserts no `ListItemRow` is mounted and no checkbox or button exists in the item rows**; renders nothing (plus a warn) for an unknown id.
    12b. **Unit — `clockVerdict`**: every branch, including `today === stored` -> skip silently and `today === stored + 7` -> sweep.
    12c. **Store — cold-start trigger (P4)**: `loadLists()` on a store whose `today` never changes resets a due list and archives its cycle, proving the feature does not depend on the watcher firing.
    12d. **Store — re-entrancy**: two overlapping `runDailyMaintenance()` calls issue exactly one archive batch.
    12e. **Repository — `undefined` stripping**: a mark with no `by` is written without a `by` key and the `mutate` payload contains no `undefined` anywhere.
    12f. **Store — sweep never touches an unexpired cycle**: a collection of only fresh cycles produces no `mutate` at all.
    12g. **Store — `cycle-swept` survives the allowlist**: the count reaches the firehose in `recur_children_removed`, asserted against the real redactor rather than a mock.
13. **Regression — wall**: `buildWallJobs` output identical before and after a rollover; `listStore.lists.length` unchanged.
14. **Regression**: full unit suite; `crossVersionCompat` and `docOps`/`applyAndProject` suites to confirm the new collection round-trips and an older doc without `listCycles` migrates on load.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted from greg's request plus the two decisions taken before planning (two-tier retention; archive untouched cycles). Storage shape deliberately left as an argued A/B for the DRY pass to settle.
- **Pass 2 (DRY + error handling)**: Verified every claim against the code. Settled storage on **(B) a separate `listCycles` collection**. Corrected the plan's central premise — Automerge history is permanent (ADR-032), so retention bounds memory, not file size — and rewrote the retention design around bytes-written-once. Removed the "record the boundary" instruction the recurrence engine cannot satisfy. Made rollover atomicity verifiable rather than assumed (a batch echoes `undefined`). Made idempotence and multi-device convergence structural via a deterministic cycle id. Replaced a would-be second tile/banding/detail-modal with one generalised tile view-model, one generic banding function, and a read-only viewer built from the existing `BeanieFormModal` + `ListItemRow`. Gave every failure path a log, a report, and a user-visible toast gated on `useToday().isVisible`.
- **Post-Pass-2 revision (greg, mid-review)**: Replaced two-tier retention with a single rule — keep an archived cycle for 3 months, then delete it — after Pass 2 established that collapsing reclaims no file bytes. Removes the summary tier, the `deleteKeys` collapse op and its copy entirely (`classifyCycleRetention` becomes `expiredCycleIds`, one constant). Scope confirmed as ARCHIVED CYCLES ONLY: a completed one-off list a person made is never auto-deleted, so the app deletes only what the app created. Added the mandatory Help Center Coverage section (greg: "ensure that is clearly documented in the help center") targeting the existing `beanie-lists` article, and the acceptance criteria and tests that hold both promises. Restated that deletion does not shrink the `.beanpod`, so the plan cannot be read as claiming a space saving it does not deliver. Passes 3 and 4 re-run against this revision.
- **Pass 3 (Sustainability / maintainability / reliability)**: Two structural reversals and a hardening pass. **Reversed Pass 2's presentation refactor** — the `ListTileModel` view-model coupled six shelves and the `open` event to a new optional feature while still splitting pill logic across two files, so it did not deliver the single source of truth it was sold on; replaced with the genuinely-generic `groupByRecency<T>`, a prop-dumb `ListTileShell`, and additive `ListCycleTile`/`ListCycleShelf` rendering cycles as their own banded section (also the better product: it makes "kept for 3 months" visible in the UI). **Removed the orphan rule from the sweep** — it read `lists.value`, so an empty or partially-loaded lists collection would have deleted the entire history in one atomic batch; the sweep is now pure over `(cycles, todayYmd)`, pinned by a regression test. **Hardened the delete path**: a kill switch, a `cyclesLoaded` gate, a per-device clock high-water mark whose verdict is a pure testable function, `MAX_SWEEP_DELETES = 50`, expiry requiring both dates, and keep-on-doubt for missing/malformed/future dates (the `'' < cutoff` trap). Moved the sweep out of `reconcileRecurringLists` into a separately-named `sweepExpiredCycles`, and added a re-entrancy guard to the reconcile loop. Corrected three code-level errors from Pass 2: `op:'remove'` does not exist (it is `delete`), `.push` on a `shallowRef` is non-reactive, and `requestMutate`'s `changed` flag proves only that heads moved. Made `ListCycleMark` keys readable and `ListCycle.items` required. Added a reliability table answering each failure mode against a specific guard, `cycle-swept`/`cycle-sweep-skipped` telemetry, and named Google Drive version history as the sole recovery route in the plan and the required help copy.
- **Pass 4 (Fresh eyes / final sweep)**: Found one design-breaking omission, two contradictions that would have silently disabled stated safeguards, one incorrect code claim driving a UI decision, and stale text left by Pass 3's own reversals. **The `today` watcher is not `immediate`, so the sweep as written would never have run for a user who opens the app fresh each day** — both reset and sweep now run from one `runDailyMaintenance()` called from `loadLists` _and_ the watcher. **"Log the swept count" was incompatible with "no new context keys"**: `logEvent.context` is allowlist-filtered and a `count` key would have been stripped, gutting the signal the plan calls load-bearing — resolved by reusing the allowlisted `recur_children_removed`. **`ListItemRow` is not read-only by default** (its checkbox always emits `toggle`, and its one default-mode consumer wires it), so `ListCycleModal` renders its own static rows. **Corrected the both-dates rationale** from a wrong-clock guard (both dates share one clock) to a malformed-record guard, and identified keep-if-future as the actual cross-device clock guard. **Audited the guards for composition** across every init/merge path and found no over-broad-delete ordering; **demoted `cyclesLoaded`** as the one non-load-bearing guard. **Named the residual risk honestly**: a persistently wrong clock still erodes history at 50/day, which no available time source closes. **Widened the byte estimate** to a measured 0.4-1.5 KB range. **Bound `ListTileShell`** to Pass 3's own principle — pure lift, own commit, abandon-and-duplicate if it grows a variant prop. **Sequenced into two increments** on the observation that no cycle can be 90 days old until 90 days after the first archive, so the irreversible half is inert for a quarter and earns its own reviewable diff and help copy.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial request (in-session, while testing wall mode)

> not sure if this is already the functionality, but for a repeating list, when the new list is created, the old list should be sent to the "completed lists" section, even if not all items were ticked off. it should keep it's state, so you can go back and see what was or wasn't completed, and the new recurring list replaces the older one

### Follow-up: approval to plan

> yes please run item 4 through pre-plan and planning

### Pre-plan decisions (AskUserQuestion)

Retention: **"Full detail recent, summary older"** — later superseded by the message below.
Empty cycles: **"Archive it"** — 0 of 5 is the information a parent wants, and one uniform rule means fewer edge cases.

### Follow-up: retention replaced, mid-review

> note that in addition to the collapsing and archiving, i think we can delete any list record older than 3 months. i think there is no need to capture these list records for longer. perhaps in the future we can provide this as an option, but for now i would say to delete older lists (3 months +) and ensure that is clearly documented in the help center

Scope clarified via AskUserQuestion: **"Archived cycles only"** — completed one-off lists a person made are never auto-deleted.

</details>
