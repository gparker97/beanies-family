# Premise audit: compacted pods as beanpod version 5.0

> Date: 2026-09-06
> Status: IN PROGRESS — five read-only audits running, one report file each.
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

_(pending P1, P5, P6)_
