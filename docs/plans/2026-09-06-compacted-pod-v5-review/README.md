# Code review: compacted pods as beanpod 5.0

> Date: 2026-09-06
> Range under review: `1f2e5d8b..6baba006` (10 commits, 61 files, ~2000 lines)
> Plan: `docs/plans/2026-09-06-compacted-pod-v5.md` (four passes)
> Premise audit: `docs/plans/2026-09-06-compacted-pod-v5-audit/README.md`
> Status: IN PROGRESS

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

_(pending)_
