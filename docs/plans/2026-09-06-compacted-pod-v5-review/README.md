# Code review: compacted pods as beanpod 5.0

> Date: 2026-09-06
> Range under review: `1f2e5d8b..6baba006` (10 commits, 61 files, ~2000 lines)
> Plan: `docs/plans/2026-09-06-compacted-pod-v5.md` (four passes)
> Premise audit: `docs/plans/2026-09-06-compacted-pod-v5-audit/README.md`
> Status: COMPLETE — two rounds, all findings fixed and mutation-checked.

## Why this exists

The implementation shipped in eight steps, each gated and mutation-checked, but
no reviewer with fresh eyes has read the result against the plan. This review
asks three questions the implementer cannot ask himself: does the code do what
the plan said, does it introduce a bug or a side effect in code the plan did
not name, and is anything about it unsafe.

The feature is behind `podCompaction`, which is OFF, so nothing here is live.
The exception is everything the version DERIVATION touches, which runs on every
save for every family today.

## Reviewers

| # | Scope | Report |
|---|-------|--------|
| R1 | The version derivation, the worker boundary, the restore stamp. The correctness core: anything wrong here writes a bad file or corrupts a lineage. | `R1-derivation-and-lineage.md` |
| R2 | Error classification and surfacing, the collapsed readers, the stub probe, silent failures, telemetry, privacy. | `R2-errors-and-readers.md` |
| R3 | User-facing copy and i18n, the notice/confirm/toast, the deleted gate, documents, and whether the tests actually pin what they claim. | `R3-copy-docs-tests.md` |

## Resuming after a session reset

Each report is written by its agent before returning. A missing report means
that reviewer did not finish; re-run it from the scope above. Consolidated
findings and the fix list go at the bottom of this file.

## Findings

### Round 1 (R1, R2, R3) — three "ship with fixes"

The correctness core was sound: every write path derives the version from the
document, the worker boundary holds on both the worker and inline paths, the
restore stamp is set and installed correctly, and R3 independently
mutation-verified that the tests are honest (five mutations, five failures).
Nothing found writes a malformed file or corrupts a lineage.

What needed fixing, and did: two user-facing FALSEHOODS (the "?" popover
claimed a stale device "shows a message" when the deployed build shows nothing
at all, and the Help article claimed work added on an old version "is not kept"
when `adopt-remote x dirty` rebases exactly that work); one regression this
series introduced (a cancelled file picker rendered a red error); three
observability defects, the worst of which was that the `pod-version` alarm
could not fire because both halves of the detail came from the same optional;
the login funnel's hand-rolled ladders; unclamped file-controlled input
reaching `detail`; and STATUS and CHANGELOG contradicting themselves inside one
unreleased section. Fixed in `c4f0c88b`.

### Round 2 (R4) — "a fix is wrong", and it was

The flagship fix covered Chromium desktop only. `openAndLoadFile` has two
branches; the File System Access one needs `showOpenFilePicker`, and iOS,
Android and Safari all route through the fallback, whose cancel arm was
untouched. The new test even said in its own comment that it drove the other
branch. This is the failure mode this project's fix rounds keep producing, and
it is why the round existed.

Also: `noteWrittenVersion` read `currentEnvelope.familyId` after a multi-second
write, so a sign-out landing inside it made a landed write report as a failure;
two more login ladders survived; the CHANGELOG still described the deleted gate
in two more places; and three behaviours were unpinned (the clamp, the
fallback's mint, and `rebaseUnavailable` on the adopted return) with their
mutants surviving the whole suite. Fixed in `be083fa7` and the commit after it.

### Where it landed

Full gate green: 6618 tests, 0 type errors, 0 lint, 0 stylelint, on a tree that
also carries the concurrent session's wall work. Every fix in both rounds is
mutation-checked against the specific regression it prevents.

### Not fixed, deliberately

- The `unreadable` boot-overlay copy still says "your data may be damaged" for
  a torn read. Made VISIBLE in a table rather than buried in a ladder, and
  filed as a follow-up: it is a user-visible copy change and does not belong in
  a version bump.
- A pod compacted by the retired Tier-2 code derives 4.0, because its lineage
  lived on the envelope and that reader was deliberately removed. One dev
  family, already reset; documented at the derivation.
- The lint rule banning the lineage guard does not see `await import(...)`.
  Nothing does that today; noted at the function.
