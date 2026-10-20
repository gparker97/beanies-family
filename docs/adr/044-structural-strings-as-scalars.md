# ADR-044: Structural strings as scalars

- **Status:** Accepted
- **Date:** 2026-10-20
- **Related:** Notion tracker #124; ADR-032, ADR-036, ADR-039 (the #117 counter writer flip follows the same served-policy pattern)
- **Plan:** `~/projects/beanies-ops/docs/plans/2026-10-20-scalar-strings-124.md`
- **Implementation:** `src/services/automerge/worker/scalarStrings.ts`, `src/services/automerge/worker/__tests__/scalarFieldsAudit.test.ts`, `src/services/registry/dataPolicy.ts`, `src/services/appUpdate/updateFloorStore.ts` (`floorVerdict`), `src/constants/appVersion.ts` (`SCALAR_READ_SINCE`)

## Context

Automerge 3.5.0 stores every plain string assigned inside a change as collaborative text: one `makeText` op plus one op per character, kept in history forever, even after the value is overwritten or the record is deleted. Every UUID costs 36 ops, every ISO timestamp 24, and load time tracks op count, not change count.

The 2026-10-05 simulation (two years of a ten-item daily list, about 70% ticked) measured a full snapshot at 652k ops, 312 KB and 400 ms to load. The same shape written with `ImmutableString` scalars measured 246k ops, 140 KB and 189 ms. Change count barely moved (6,513 against 5,874). Phones load several times slower than the desktop figures.

## Decision

1. **Structural fields are written as `ImmutableString` scalars.** IDs, foreign keys, timestamps, dates, enums and key names are one op each. User prose (titles, names, notes, descriptions) stays collaborative text.
2. **One explicit table.** `scalarStrings.ts` holds `SCALAR_FIELDS` and `TEXT_FIELDS`. Only the `Id`, `Ids` and `At` suffixes are inferred, because they are structural without exception. Every other field is named in one set or the other. There are no per-collection rules: a field that means prose in one collection and structure in another gets a new name. `scalarFieldsAudit.test.ts` walks every string field of the seed data and fails on any that is in neither set, so a new field cannot ship unclassified.
3. **Readers first.** This release makes every worker read tolerate both forms (`str(v)` instead of raw `===` and `typeof`, one `isMapValue` instead of three local map predicates). The writer ships in the same release but off. Sequence: readers live on web and both stores; the update floor is raised to that build; then the registry serves `dataPolicy.scalarWrites` (default off, flipped from Terraform like the counter writer). The client also guards on the main thread: the writer opens only when `floorVerdict(SCALAR_READ_SINCE)` is `open`, so a premature flip is held and logged as `scalar-policy held` rather than acted on.
4. **Existing history is not converted.** The win accrues from the flip onward. Compaction already preserves whichever form a value has, and converting history is the compaction Tier 2 coordinated migration, a separate project (see the compaction merge hazard).
5. **ListCycle titles are not slimmed.** The simulation's slim row dropped item titles from cycle marks. Those titles are user text, the cycle modal shows them, and dropping them would break older clients' view. It also loses to the scalar writer on its own numbers.
6. **One-way door.** Once the writer has been on for any family, documents hold scalar strings forever. Rollback turns the writer off; it never removes a scalar from a pod. Reader tolerance must therefore never be removed, and a future cleanup must not treat the `str()` calls as dead code.

### Maintenance contract

1. A new string field is classified in `SCALAR_FIELDS` or `TEXT_FIELDS` when it is added; the audit refuses it otherwise.
2. A worker read of a raw document value compares `str(v)`, never `v`; the `str`-form test rows enforce this.
3. Scalar tolerance in readers is permanent once the writer has ever been on.

## Consequences

- Roughly 60% fewer ops for a long-lived daily-list pod once the writer is on, with load time following.
- `canonicalEqual` is type-blind, so a patch that sets a scalar field to its current value is skipped as unchanged. Existing text migrates to a scalar only when the value actually changes.
- Worker code reading raw document values must use `str(v)`; `===`, `typeof` and `.length` are wrong on an `ImmutableString`.
- `structuredClone`, `postMessage` and object spread turn an `ImmutableString` into a bare `{val}` object, so any raw value leaving the worker is unwrapped first. The store projection is a JSON round trip, so the main thread never sees the difference.
- A build below the readers release mishandles a scalar document (array identity in `keyOf` treats keyed items as new). The update floor only prompts, so "every client has moved" is a judgement from `app-update checked behind=true` counts, not a proof; this is why the flip is greg's call.
- A misclassification is cheap in both directions: prose written as a scalar loses nothing today (every write is a whole-value assignment), and a structural field left as text only costs ops.

## Alternatives considered

- **Floor raise alone, writer unconditional.** Rejected: the floor prompts but never blocks, so old clients would meet scalar documents unprepared.
- **Inferring more suffixes (`By`, `On`, `Date`).** Rejected: `diagnosedBy` is free text beside `acknowledgedBy`, a member id. An inference nobody can see misclassifies silently.
- **Converting history through compaction.** Rejected for now (decision 4).
- **Slimming ListCycle.** Rejected (decision 5).
