# Plan: Fix cross-device sync merge echo loop

> Date: 2026-02-27

## Context

Cross-device sync merge has three interconnected bugs causing data inconsistency. When two browsers are open, deleted items reappear on the browser that deleted them, and updated items revert to their original state. The root cause is a **ping-pong echo loop**: after merging, both devices unconditionally save back to the file, each creating a "newer" timestamp that triggers the other device to merge again.

## Root Causes

1. **Vue watcher fires after `isReloading = false`**: In `reloadAllStores()`, `isReloading` is set to `false` synchronously in the `finally` block, but Vue 3's deep watchers are deferred — they flush as microtasks _after_ synchronous code completes.
2. **Tombstone mutation outside `isReloading` guard**: `tombstoneStore.setTombstones()` runs before `reloadAllStores()` is called (before `isReloading = true`), triggering the auto-sync watcher immediately.
3. **Unconditional save-back creates ping-pong**: `triggerDebouncedSave()` is called after every merge regardless of whether the merge changed anything, creating infinite echo loops.

## Implementation

### Fix 1: `await nextTick()` before `isReloading = false` (syncStore.ts)

### Fix 2: Set `isReloading = true` before merge path (syncStore.ts — loadFromFile)

### Fix 3: Change detection — `detectMergeChanges()` helper + `hasLocalChanges` return (fileSync.ts, syncService.ts, syncStore.ts)

## Files affected

| File                               | Action                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------- |
| `src/stores/syncStore.ts`          | Fixes 1, 2, 3: nextTick guard + early isReloading + conditional save-back |
| `src/services/sync/fileSync.ts`    | Fix 3: detectMergeChanges helper + return hasLocalChanges                 |
| `src/services/sync/syncService.ts` | Fix 3: propagate hasLocalChanges through loadAndImport                    |
