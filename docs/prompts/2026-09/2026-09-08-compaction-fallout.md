---
date: 2026-09-08
category: bug
issue: none
plan: docs/plans/2026-09-08-compaction-fallout-remediation.md
tags: [auth, google-oauth, registry, compaction, lineage, sync, native, i18n]
---

# Compaction fallout — nine findings from the first real cross-device compaction

Investigation record: `docs/investigations/2026-09-08-compaction-fallout.md`.

## Prompts

**2026-09-08, ~10:30 SGT — the report.** greg compacted his family pod across all his
devices (browser on 0.17, some apps on 0.17, one phone deliberately left on 0.16, an older
Galaxy Tab A7) and reported nine observations: compaction succeeded, 4MB+ to ~350KB; repeated
false "ongoing changes being saved" refusals with a green saved dot, asking for a retry button
and a check of the validation; a "not enough memory to sync" toast on the A7 that then synced
anyway; the family owner appearing to change to another member with no transfer performed; a
todo created on the 0.16 device after compaction vanishing on upgrade to 0.17; constant Google
grant revocations and re-consent every few hours across devices; beanie euphemisms obscuring
meaning on important surfaces, quoting the orange lineage banner, with a request to codify the
rule; the native app offering only a local file picker under "load another family data file";
"Signed in with" showing his sister's gmail beside a lineage-blocked message; and all of it
clearing after a hard refresh. Asked for a full investigation with context preserved to a file
against an imminent usage limit.

**Follow-up — scope.** Investigate all nine; fix only the low-risk clearly-correct items;
Google auth first if usage runs out.

**Follow-up — resumed on a different model.** Limit concurrent subagents; work
token-efficiently.

**Follow-up — decisions and autonomy.** (1) auth approved, plus a comprehensive
re-evaluation that we are not unnecessarily revoking grants or forcing re-consent. (2) fix the
registry row asap to its original state, family owner is gregsophia@gmail.com, and harden the
code so it can never happen again. (3) ok. (4) ok. (5) do NOT refuse compaction while
stragglers exist: we cannot reliably know when an older device exists, and it is not
reasonable to ask a family to track down every device ever used. Do the absolute best we can
to preserve data and accept the residual risk. Also raise the minimum version floor to 0.17
and update the deploy skills to ask about incrementing it every deploy. (6) did not explicitly
delete local data on mary's phone. Take these to `/beanies-plan`, approve, implement, then run
`/code-review max` and iterate until reliable. Work autonomously; away from the computer.

**Follow-up — added scope.** Also address `buildInviteLink`, the last unfixed instance of the
iOS origin bug, deliberately left because its fallback was the marketing apex rather than the
app subdomain.

**Follow-up — added scope.** A reconnect toast is also thrown when opening a shared recipe
link; appears cosmetic and does not recur once the recipe is added, possibly due to how that
page is opened.

## Outcome

Investigation complete: all nine root-caused with file:line. Plan built through the mandatory
four review passes, which materially changed it three times — Pass 2 found one item already
shipped and one provably a no-op, Pass 3 found the data-preservation guard would have closed
the lineage banner's only exit, and Pass 4 found the carry would have republished dead refresh
tokens that the plan's own auth fix then reads to heal.

Shipped (stages 1 and 3, not deployed): the reconnect-revoke removal and escalation gate; the
registry delete fix; the compaction false-refusal fix; native Drive restore; the iOS invite
link; 115 beanie euphemism strings with a guard test and the rule in CLAUDE.md, the theme skill
and the CIG; a "Check Again" retry.

Two `/code-review max` passes. The first found 15 issues, three caused by the fixes themselves.
greg's registry row was repaired by hand.

Deviations from instruction, both stated at the time: the update floor was raised to 0.17 as
asked and then REVERTED, because 0.17 is TestFlight and open testing only and a recorded
decision plus the runbook both say not to prompt before a version is live on both stores; and
`ownerMemberId` was left null rather than set, because the Lambda treats it as write-once and a
wrong value would permanently refuse greg's own pointer writes.

---

## Session 3 — 2026-09-09 (second session)

**Prompt (07:20, verbatim):**

> Please work autonomously to complete all the work remaining in the 7 stage plan that was
> started in the previous session. Read the plans carefully, reason completely about what is
> the owning layer and where to actually apply your work, and take as much additional time to
> reason as necessary especially for risky changes. proceed with implementation and once done
> run code reviews to review and fix the code implemented until you are satisfied with the
> implementation and it is ready for manual review. start with /code-review max c03f3e8e and
> once done proceed to review and complete the remaining stages.

**Category:** implementation + review
**Plan:** `docs/plans/2026-09-08-compaction-fallout-remediation.md`

### Clarification asked, and why

One question was put to greg mid-session, on stage 6. The handoff written earlier the same day
recorded his decision to hold it — "if it is built, it gets its OWN session and its OWN review,
never appended to other work" — and "complete all the work remaining" read naturally as
including it. Proceeding under either assumption was costly: implementing it would touch the
adopt path against a same-day decision not to, and skipping it would leave requested work
undone. **greg chose: build it, but in a fresh session.** So
`docs/plans/2026-09-09-stage-6-preservation-brief.md` was written instead of the code.

## Outcome — session 3

Six of seven stages are on `main`, none deployed.

- **Stage 2** (`f9e3bda6`) — Lambda: pointer guard on the WRITER with a presence-based (not
  `??`) compat fallback, `ConsistentRead` on all three reads, DELETE tombstones instead of
  dropping, the DELETE ladder warning without enforcing, plus the founder-metrics scan filter
  the tombstone would otherwise corrupt. 64 tests.
- **Stage 1 §1d** (`b80adc69`) — a lineage-blocked device heals its Drive token from the remote
  envelope. Needed a new read-only worker op that returns connections and never a document.
- **Stage 7 §8 §9 + review round 4** (`4a9b524e`) — reconnect suppressed on public routes; one
  persistent banner for all seven `decrypt` blockers, mounted outside the layout so it covers
  `noChrome` routes; and the fourteen review findings.
- **Stages 4 + 5** (`623b908d`) — `writerMemberId` on the wire, owner fields from the pod
  roster. Combined deliberately: both are client-side and reach a device in the same bundle
  regardless of how they are committed.

### The fourth review round

`/code-review max c03f3e8e` found fourteen findings and they were not marginal. The central one:
`reconnect()`'s widening from `boolean` to a string union had been applied to four of six call
sites, and because every arm is truthy the two that kept `if (!ok)` went from wrong on one arm
to wrong on two — with type-check clean, eslint clean and tests green. The app-wide reconnect
prompt showed "Reconnected" in green on a failed reconnect. A lesson is in `docs/lessons.md`.

Two fixes were moved to their owning layer rather than patched again: the 401 that invalidates
the cached access token now fires in `driveService.driveRequest`, the only place that learns
Google refused, instead of at one UI button where it destroyed working tokens; and the reconnect
outcome is emitted once in the composable rather than at six call sites that between them made
the success rate unmeasurable.

### Deviations and holds, all stated at the time

- **Stage 6 not built** — greg's call, twice. Brief written instead.
- **§2d-ii (the DELETE 403) not shipped** — the plan gates it on a measurement that needs a full
  release cycle of quiet, not on effort.
- **The version floor stays `0.16`** — unchanged; 0.17 is still TestFlight and open testing only.
- **Stages 4 and 5 share a commit** — separable on the wire, not in a release.
- **Nothing pushed or deployed** — not asked for. The stage-2 Lambda must go to prod BEFORE the
  web bundle, or stage 5 neuters the pointer guard it is meant to tighten.
