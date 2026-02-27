# Plan: Fix & Harden Cross-Device Sync

> Date: 2026-02-27
> Related: User-reported sync drift between PWA and browser via Google Drive

## Context

Two devices connected to the same `.beanpod` file on Google Drive show different data (e.g., todo items created on one device never appear on the other). After deep investigation, 6 bugs were found in the sync pipeline — ranging from a silent data-overwrite race to auto-sync being completely disabled on some code paths.

## Approach

### Phase 1: Quick bug fixes (Bugs 1–5)

- Fix overwrite-before-read in `reloadIfFileChanged()` (cancel pending save instead of flushing)
- Fix stale `lastSync` with save-complete callback
- Fix double save on visibility hidden
- Fix `canAutoSync()` to return `true` for all providers
- Accept `beforeunload` limitation, use `saveNow()` as best-effort
- Pause polling when tab hidden

### Phase 2: Record-level merge (Bug 6)

- Add deletion tombstones (`DeletionTombstone` type, v3.0 file format)
- Tombstone store for tracking deletions
- Record deletions in all entity stores
- Merge service with per-record conflict resolution
- Wire merge into import pipeline

### Phase 3: Documentation

- ADR-017 for merge strategy
- Update ADR-002, ADR-011
- Update ARCHITECTURE.md and STATUS.md

## Files affected

See full plan in conversation transcript for complete file list.
