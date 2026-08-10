# ADR-033: A family's pod binding is immutable; writability is not ownership

> Status: Accepted
> Date: 2026-08-10
> Related: `docs/plans/2026-08-10-never-fork-a-family-pod.md`, reverses the B3/B4/B5/B6 decision in `6004ad6c` / `a9ccbea0`
> Supersedes: the "re-home a just-loaded pod to a correctly-scoped, owned save target" decision (2026-07-13)

## Context

A non-owner family member on Android silently ended up working on a private duplicate of her family's `.beanpod`. The data looked identical, so nobody noticed until her to-do items stopped appearing for the rest of the family. Recovery required a full sign-out, a fresh sign-in, and manually picking the original shared file out of two near-identically-named files in Drive.

The cause was `syncStore.establishDurableHomeAfterLoad()`, added 2026-07-13 to solve a real problem: #47 let a user open a `.beanpod` from any account or a restored backup, and the native `<input type=file>` path staged an envelope with **no provider at all** — a loaded-but-unsaveable dead end. The fix established a "durable home" after every load, and used Drive's `ownedByMe` to decide whether the loaded file qualified:

```js
// Owned by another account → re-home (never keep writing cross-account).
```

That reasoning is sound for a restored backup. It is exactly wrong for the product's core sharing model. **beanies families share one file**: the inviter owns it in their Drive and shares it with edit access. So for every non-owner member `ownedByMe` is `false` — permanently, by design. The guard therefore fired for precisely the population it was meant to protect, minting a private copy and seeding it with the live in-memory document (which is why the copy looked identical), and then `installProvider` repointed the family's registry entry at the copy, so other members could later be _healed onto it_.

Three separate mis-firings, all from the same conflation:

1. `ownedByMe === false` → re-home. Every non-owner member, every load.
2. Ownership probe **throws** → "conservative re-home". A 15-second Drive timeout (`DriveApiError` 408) was sufficient to fork a family.
3. `installProvider` → `registerCurrentFamily` had no owner gate, so the fork propagated to the registry.

## Decision

**A family's pod binding is established once, by an explicit user action, and is never changed by the app.**

Verification may _report_ a problem. It may never _resolve_ one by creating or switching files.

Concretely:

### 1. Writability, not ownership

`capabilities/canEdit` is the signal. `ownedByMe` is never consulted on a load path again. A file shared with edit access is a legitimate home regardless of who owns it.

### 2. Verification replaces establishment

`establishDurableHomeAfterLoad` → `verifyPodAccess`, which **mutates nothing**. It returns a typed result; the store records it; one banner renders it. `reHomeToOwnDrive`, `mintFreshOwnDrive` and `configureSyncFileGoogleDrive` are deleted.

### 3. Exactly two creation paths

`createNewFile` (start a new family) and `migrateStorage` (move this family's storage) — both explicit, named user actions. A test asserts no load path can reach `GoogleDriveProvider.createNew`.

**There is no "create a duplicate?" prompt, and there must never be one.** This was considered and rejected: there is no scenario in which auto-creating a second copy of a family's data is the right answer, so it is not offered to the user _or_ reachable in code. If a failure has no usable recovery, the prose carries the action (the `JOIN_ERRORS.NO_UNCLAIMED_MEMBERS` precedent) rather than a button that does the wrong thing.

### 4. A typed failure taxonomy with recoveries that all point backwards

`POD_ACCESS_ERRORS` (ADR-024's registry pattern) maps seven codes to four recovery actions — `retry`, `reconnectAccount`, `pickFamilyFile`, `switchToCanonical`. Every one restores access to the **original** file. `pickFamilyFile` and `switchToCanonical` differ only in where the fileId comes from; both end in `rebindPodFile`, which is structurally incapable of creating a file and rejects any envelope whose `familyId` doesn't match the live one.

### 5. The pointer guard lives in the Lambda, not the client

Only the family's registered owner may move the canonical pointer (`provider` / `fileId` / `displayPath`). Enforced in `infrastructure/lambda/registry/index.mjs`, because **the client cannot close the hole**: the propagation vector is already deployed, and native/cached builds running the old code keep sending pointer writes for as long as they run. `ownerEmail` becomes genuinely write-once (it previously claimed to be, but `body.ownerEmail ?? existing.ownerEmail` let the last writer win — which is how a re-homed device could take over a row).

**The authority is `ownerMemberId`, not `ownerEmail`.** `ownerEmail` was added 2026-04-12 as an ops/contact capture (alongside the newsletter opt-in) and holds the signed-in member's _profile_ email — a field the user can edit. Using it as the permission check would mean an owner who edits their own email is refused on their next write and, because the field is write-once, has no way back. `memberId` is a stable UUID from the family document and survives profile edits. Three tiers: a row with `ownerMemberId` compares that; a row with only `ownerEmail` (registered between 2026-04-12 and this change) compares the email and _upgrades itself_ by stamping `ownerMemberId` on the owner's next accepted write; a row with neither (pre-2026-04-12, dormant since) falls open and stamps both. A non-owner cannot claim `ownerMemberId` on a legacy row — otherwise the upgrade path would be a land-grab.

`ownerEmail` remains write-once so it stays a trustworthy legacy authority and a stable contact field.

Members still write activity and metadata (`lastLoginAt`, `country`, `beanpodSizeKb`, `familyName`) — those are per-family facts any device may report. The pointer is not.

Clients mark deliberate re-points with `pointerIntent: true`. A refused _deliberate_ write pages `#beanies-errors` (the registry now disagrees with where the pod is — data at risk); a refused _ambient_ write is counted at `info` (the expected, boring case for every member device).

### 6. The missing symptom

`CANONICAL_MISMATCH` — the active fileId differs from the registry's — surfaces a banner: _"you're working on a copy of your family's file"_. Fail-open in every uncertain case, which required `lookupFamilyResult` to distinguish "no such row" from "couldn't ask"; a registry hiccup must never accuse a user of working on a copy.

## Consequences

**Positive:**

- The failure mode is structurally impossible, not merely unlikely: the code that created the copy no longer exists.
- Non-owner members — the majority of users in any multi-person family — stop being a special case that the sync layer treats as suspect.
- A transient Drive error can no longer change durable state. Nothing on the verification path mutates anything, so failing "closed" buys no safety and every unclassified failure degrades to a retryable warning instead of a false page.
- The fork is now _detectable in the wild_: `surface: 'pod-access'` emits on the success path too, so the failure rate is measurable and a mismatch pages.
- The Lambda guard protects families whose devices will never take the client fix.

**Negative / to monitor:**

- #47's restored-backup case no longer self-heals. A `.beanpod` opened with no provider reports `NO_HOME` and offers `pickFamilyFile`; the user must choose a file. That is one extra tap in a rare flow, traded for never forking a family's data — the right trade, but it is a real regression in convenience and worth watching for confusion.
- `switchToCanonical` can fail on a device that has never opened the canonical file (no `drive.file` scope for it). It falls back to the picker, which grants scope as a side effect — an extra step in an already-degraded state.
- The canonical check costs one registry round-trip per family per session. Bounded deliberately: `verifyPodAccess` runs on every load path including `retry`, so an unguarded check would turn a retry loop into a request loop.
- Families already forked by the old code are **not** repaired by this change. Recovery is operational — see the plan's Remediation section.

## Related

- [ADR-024](024-join-flow-composable.md) — the structured error registry pattern this reuses
- [ADR-031](031-onboarding-adopt-existing-recovery.md) — adopt-existing recovery (create flow; unaffected)
- Plan: `docs/plans/2026-08-10-never-fork-a-family-pod.md`
