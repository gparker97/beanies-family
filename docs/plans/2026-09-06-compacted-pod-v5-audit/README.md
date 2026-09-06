# Premise audit: compacted pods as beanpod version 5.0

> Date: 2026-09-06
> Status: COMPLETE — verdict and the plan's required changes are in Findings below.
> Deployed build under audit: `c3a6be98` (0.16, the last prod deploy). Current `main`: `72d02eb4`.
> Feeds: the `/beanies-plan` for this change. Not itself a plan.

## Why this exists

The soak gate (Tier 3 Stage 4) asks families to have every member open beanies
on every device they use it on, and cannot verify the ask: `lineageEpoch` is
per-member, so one login on a current build vouches for that person's other
devices forever. Greg's objection (2026-09-06): that is an impossible request
for a normal family, and a coffee-shop PC opened once six months ago makes the
point.

The proposed replacement is structural. A compacted pod is written as beanpod
**version 5.0**. The deployed build's `parseBeanpodV4` throws on any version
other than `'4.0'`, so a pre-guard device cannot merge a compacted pod at all,
which removes the silent fleet-wide lineage corruption. That claim rests on a
handful of premises about the DEPLOYED build, read from `c3a6be98`. If any is
false, the design is wrong at the root. Hence this audit, before any plan.

## Premises and who audits them

| # | Premise | Report |
|---|---------|--------|
| P1 | Every path the deployed build uses to read a pod goes through a strict `'4.0'` check, and on failure NONE of them merges, wipes the cache, or deletes a credential. | `P1-deployed-read-paths.md` |
| P2/P3 | The deployed `doSave` swallows a failed pre-save merge and writes over the pod; in the current build `ours-newer` → `publish-local` makes the fleet republish the compacted pod, so the revert does not stick. Trace the exact sequence and what is lost. | `P2-P3-overwrite-and-selfheal.md` |
| P5 | Blast radius of the `'4.0'` literal and `BeanpodFileV4` in the CURRENT build: every reader, writer, validator and test that must change for a v5 pod to work on a new build, including join, invite, recovery kit, native open. | `P5-current-build-blast-radius.md` |
| P4 | Web/PWA auto-update drains the fleet (`usePwaUpdater`); the worst-case stale window; native has no service worker; what forcing an update takes on Android (Play In-App Updates) and iOS (no store mechanism; self-built gate), and what infra beanies already has for it (`appVersion` on the member row, telemetry, any remote config). | `P4-update-mechanics.md` |
| P6 | Is a version bump the BEST mechanism? Alternatives that make an old build refuse, which of them fail at PARSE (safe) versus at DECRYPT/MATERIALIZE (may trigger the corrupt-payload cache wipe), the fate of the soak gate, and what the confirm copy should promise. | `P6-approach-challenge.md` |

## Resuming after a session reset

Each report is self-contained and written by its agent before returning. If a
report file is missing, that audit did not finish; re-run it from the premise
row above. Consolidated findings and the go/no-go go at the bottom of this file.

## Budget note (2026-09-06)

Greg reached 80% of the Fable usage limit while five audits were running.
**P2/P3 and P4 were stopped early** to conserve it; their files are the
partial skeletons the agents had written and are kept as-is. P1, P5 and P6
were allowed to finish because each is one an expert would refuse to skip:
P1 decides whether the mechanism works at all, P5 is the change list the plan
needs, P6 is the approach challenge Greg asked for.

The two genuinely new questions P2/P3 and P4 were going to answer were checked
directly instead:

- **P2, verified at `c3a6be98:src/services/sync/fileSync.ts:209-216`.**
  `reEncryptEnvelope` is `{ ...envelope, encryptedPayload, writerVersion }`
  over the WRITER'S OWN cached envelope. So a stale device's overwrite carries
  `version: "4.0"` and that device's own `wrappedKeys` / `inviteKeys` /
  `passkeyWrappedKeys`. Because its pre-save merge threw at parse, the envelope
  key-dict merge never ran, so **a member who joined after that device last
  synced loses their wrapped key in the pod** until an updated device
  republishes. A second, distinct loss vector (unlockability, not the document),
  bounded by the same self-heal. The plan must name it.
- **P3, verified in the current build** (`src/services/sync/podLineage.ts`
  `POLICY`): `ours-newer` → `publish-local` for `clean` and `dirty`, so an
  updated device holding the compacted lineage republishes over the revert.
  NOT traced hop-by-hop through `doSave`'s blocker refusal; the plan's testing
  section must pin it with a unit test rather than assume it.
- **P4, verified** (`src/composables/usePwaUpdater.ts`): web polls the service
  worker every 5 min while visible and applies on the next navigation when
  quiet (no overlays, not syncing); native returns early and registers no
  worker, so native updates only via the stores. `member.appVersion` is
  `APP_VERSION` stamped at login (`src/stores/familyStore.ts:510`), so a notice
  can say "Sam last used beanies 0.16" rather than an abstract epoch.
  **Platform facts are from knowledge, not re-verified against current docs:**
  Play In-App Updates has an immediate (blocking) mode; Apple has no store-level
  force-update and the pattern is a self-built minimum-version screen. Verify
  before relying on either.

## Findings

> Status: COMPLETE (P1, P5, P6 finished; P2/P3 and P4 stopped for budget and
> checked directly, above). Line numbers in the reports are from `33dbef34`
> for the current build and `c3a6be98` for the deployed one.

### Verdict: GO, with the plan changed in four ways

The premise as first stated ("an old build cannot touch a v5 pod") **fails**.
The premise that matters ("an old build cannot MERGE a v5 pod, and so cannot
silently corrupt the family's lineage") **holds**, verified end to end on the
deployed build by P1: every Automerge merge entry point sits behind a strict
`'4.0'` check, no read-path failure wipes the IndexedDB cache, deletes a
credential, or loops on a password prompt. The catastrophic case is gone.

What remains is that a stale build can still OVERWRITE the compacted pod, and
P1 found the real mechanism is not the one I had assumed:

- **Any save on a warm-cache stale device** (P1 F2). `load()` learns the v5
  revision before the read, the parse fails, and the next save's
  `remoteChanged()` reports `unchanged`, so `fetchAndMergeRemote` returns
  BEFORE parsing and the write replaces the pod. Fixing the swallowed throw
  would not help; the baseline skip is the path. Loud (the fleet sees a
  lineage mismatch), recoverable (the self-heal below, plus the safety copy).
- **The owner creating a same-named family on a stale build** (P1 F1, P6 F2).
  The deployed `isStubBeanpod` is `detectFileVersion(text) !== '4.0'`, so a v5
  pod reads as an empty placeholder, is adopted as the write target with no
  confirm, and the create flow writes an empty pod over it. Today that path is
  adopt-existing plus a confirm, so the bump makes this one path worse. It
  needs the owner's account, a stale build, and a deliberate create action.
  Loud (familyId mismatch stops the fleet), recoverable (safety copy or a
  Drive revision).

Both are bounded by the same self-heal: an updated device holding the
compacted lineage reads `ours-newer` and republishes. What is lost each time:
whatever the stale device wrote, and, until the republish lands, the wrapped
key of any member who joined after that device last synced (P2 direct check).

So the bump does not replace draining the fleet; it changes what a straggler
can do from "silently corrupt everyone" to "loudly revert until the fleet
pushes back". The deploy sequence (flag off → drain → enable) stays the
primary control, and the soak gate can stop pretending to be one.

### The four changes the plan must contain

1. **Derive the envelope version from the DOCUMENT, never by envelope spread**
   (P5 Trap 1, P6 F1, CRITICAL, found independently by both). The four
   `kept-local` termini adopt the remote envelope and republish the local
   compacted document under it, so the first self-repair after a compaction
   would go out labelled `4.0` and the protection would last one round trip.
   The only writer of `podLineage` is `compactDoc`, so "has lineage" is exactly
   "is compacted"; `exportEncryptedPayload` can return it and
   `reEncryptEnvelope` can stamp `5.0` from it on every save path at once.
   Needs no change to `usePodCompaction`.
2. **Fix `isStubBeanpod` in the current build** (P5 Trap 2, P6 F2, P1 F1).
   Cannot fix the deployed copy; can stop the next stale build from having it.
3. **A restore of the safety copy must publish a NEW lineage generation**
   (P6 F3). Today peers read the restored `4.0` file as `ours-newer` and revert
   it within one poll, so the rollback does not stick. Restore writes
   `seq + 1`, as `5.0`.
4. **Write the safety copy itself as `5.0`** (P6 F4), so a stale build cannot
   pick it from a picker and adopt it as a live pod. The rollback route is for
   the new build; the old build is not meant to have one.

Plus, from P5: a new `UnsupportedBeanpodVersionError extends PayloadLoadError`
(`step: 'parse'`, own `inlineMessageKey`), thrown from `parseBeanpodV4`
itself, never a `CorruptPayloadError`; widen the type to a `BeanpodVersion`
union without renaming `BeanpodFileV4`; four literal comparisons to widen
(`connectStorage.ts:250`, `syncService.ts:2067/2119/2159`); the poll path's
existing `parse` classification already carries "update beanies" copy.

### The soak gate

Demote to a soft notice, delete the `not-soaked` refusal codes, and name the
build rather than an epoch using the member row's `appVersion`: "Sam last
opened beanies on 0.16". Never ask anyone to enumerate devices. P6 drafted the
en copy for the notice, the confirm dialog, and the completion toast; the plan
lifts them from `P6-approach-challenge.md`.

### What nobody can fix

The person on the stale build gets no message. The deployed poll swallows the
parse error and shows stale data under "Could not refresh". There is no remote
channel into a deployed build (release notes are bundled, no email sender).
The honest answer is that the family tells them, and the plan says so.

### Observability the plan owes

A repeated `ours-newer → publish-local` on one family is the signature of a
stale device fighting the fleet. It must be countable in CloudWatch per family
so a straggler can be found without anyone enumerating devices. P1 also found
the version string never reaches the firehose on any Drive read path in the
deployed build, and three sub-paths fail silently; the new build must not
inherit that.

### Sequence (P6, adopted)

1. Land changes 1–4 and the error class, flag OFF, all pods still `4.0`.
2. Deploy web and native. Nothing user-visible changes.
3. Watch the fleet drain with a login-by-`appVersion` CloudWatch query.
4. On-device run on the Tab A9+/A7, INCLUDING a deliberately stale device and a
   restore, before enabling anything.
5. Enable `podCompaction`.
