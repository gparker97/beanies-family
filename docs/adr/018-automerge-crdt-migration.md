# ADR-018: Automerge CRDT Migration

- **Status:** Accepted
- **Date:** 2026-03-03
- **Supersedes:** ADR-001 (Local-First IndexedDB), ADR-009 (Per-Family Database), ADR-011 (File-First Architecture), ADR-017 (Record-Level Merge Sync)

## Context

The hand-rolled merge logic (mergeService, tombstoneStore, settingsWAL, deletion tombstones) was fragile and difficult to maintain. Record-level merge by `updatedAt` timestamps could not handle concurrent edits to the same record — last-write-wins silently dropped changes from other devices.

As the entity count grew to 10 distinct types, each requiring its own merge logic, the complexity became unsustainable. Every new entity type needed custom merge code, tombstone handling, and conflict resolution paths.

Automerge provides mathematically proven conflict-free replicated data types (CRDTs) that guarantee convergence without custom merge logic.

## Decision

We migrate all family data to a single Automerge document per family (`FamilyDocument` type) with all entities stored as `Record<string, Entity>` maps.

Key implementation details:

- **Module-level singleton** (`docService.ts`) with a Vue reactivity bridge via a `docVersion` shallowRef — bumped on every mutation and consumed by computed properties in stores
- **Generic repository factory** (`createAutomergeRepository`) that mirrors the old IndexedDB API (`getAll`, `getById`, `create`, `update`, `remove`) to minimize store migration effort
- **Dual persistence:** encrypted IndexedDB cache (`beanies-automerge-{familyId}`) for fast local loads, plus cloud `.beanpod` V4 file for cross-device sync
- **Debounced persistence** (500ms) after mutations to batch rapid changes

## Consequences

### Positive

- True conflict-free merge — concurrent edits to the same record converge automatically
- No more tombstones or custom merge logic — Automerge handles deletions natively
- Simpler codebase: 15 deprecated files deleted (mergeService, tombstoneStore, settingsWAL, and related code)
- Repository factory pattern means stores required minimal changes

### Negative

- WASM dependency adds ~200KB gzipped to the bundle
- Full-document persistence on every save (not incremental changes), which may become a concern for very large families
- Automerge proxies are not Vue-reactive — all values must be cloned (via `structuredClone` or spread) before passing to Vue's reactivity system
- Legacy migration code removed — no backward compatibility to pre-V4 formats
