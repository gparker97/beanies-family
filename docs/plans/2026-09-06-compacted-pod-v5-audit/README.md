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

## Findings

_(pending)_
