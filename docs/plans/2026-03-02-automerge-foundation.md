# Plan: Automerge CRDT Document Service & Repository Factory

> Date: 2026-03-02
> Related issues: #110, #119 (Automerge epic)

## Context

Issue #110 is the first step in the Automerge CRDT migration epic. The current data layer uses IndexedDB with a custom repository factory. We build an Automerge foundation alongside it — purely additive, no existing code touched. The app continues working on the old architecture until the Core Migration issue (#113) switches over.

## Approach

1. Install `@automerge/automerge`, `vite-plugin-wasm`, `vite-plugin-top-level-await`
2. Configure Vite + Vitest for WASM support
3. Define `FamilyDocument` schema using `Record<string, Entity>` maps (CRDT-friendly)
4. Create `docService.ts` — module-level singleton mirroring `database.ts` pattern, with Vue reactivity bridge via `docVersion` shallowRef
5. Create `automergeRepository.ts` — generic factory mirroring `createRepository` API exactly (same function signatures, same async return types)
6. Create 10 entity repositories mirroring their IndexedDB counterparts (index-based queries become in-memory filters)
7. Write unit tests for docService and repository factory

## Files affected

### New (16 files)

- `src/types/automerge.ts`
- `src/services/automerge/docService.ts`
- `src/services/automerge/automergeRepository.ts`
- `src/services/automerge/repositories/` (10 repos + index.ts)
- `src/services/automerge/__tests__/` (2 test files)

### Modified (4 files)

- `package.json` — 3 new dependencies
- `package-lock.json` — lockfile updated
- `vite.config.ts` — wasm() + topLevelAwait() plugins, wasm in globPatterns
- `vitest.config.ts` — wasm() + topLevelAwait() plugins
