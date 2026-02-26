# Plan: Fix preferred currency settings persistence

> Date: 2026-02-26
> Related: Settings lost on refresh, sign-out/sign-in, rare data loss

## Context

Three related bugs reported with preferred currency settings:

1. **Refresh loss** — preferred currencies lost on page refresh, even after 3+ seconds
2. **Sign-out revert** — currencies sometimes revert to login-time state after sign-out/sign-in
3. **Data loss** — one-time event where setting currencies zeroed out net worth and transactions

Root causes: async File System Access API writes don't complete before unload; auto-sync watcher fires during store reloads capturing half-loaded snapshots; save failures swallowed silently.

## Approach

### Fix 1: `isReloading` guard in syncStore

Suppress auto-sync watcher triggers during `reloadAllStores()` to prevent capturing half-loaded snapshots.

### Fix 2: Settings WAL via localStorage

Synchronous write-ahead log for settings using `localStorage`. Written on every settings mutation, cleared after successful file save, recovered after reload if newer than file.

### Fix 3: Improved save failure logging

Better `console.warn` messages for permission denied and auto-save failures.

## Files affected

| File                                              | Change                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/services/sync/settingsWAL.ts`                | **New** — localStorage WAL utility                                                                     |
| `src/stores/syncStore.ts`                         | `isReloading` guard, WAL recovery in `reloadAllStores()`, WAL cleanup in `disconnect()`/`resetState()` |
| `src/stores/settingsStore.ts`                     | `watch` on settings that writes WAL                                                                    |
| `src/services/sync/syncService.ts`                | Clear WAL after successful save, improve failure logging                                               |
| `src/stores/authStore.ts`                         | `clearAllSettingsWAL()` in `signOutAndClearData()`                                                     |
| `src/services/sync/__tests__/settingsWAL.test.ts` | **New** — 15 WAL unit tests                                                                            |
| `src/stores/__tests__/passwordCache.test.ts`      | Added missing `cancelPendingSave` mock                                                                 |
