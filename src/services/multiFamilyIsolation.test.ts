/**
 * Multi-family (multi-tenant) isolation tests.
 *
 * TODO: Rewrite tests for Automerge-based data layer.
 * The previous tests validated isolation using direct IndexedDB access via getDatabase().
 * With the migration to Automerge CRDT documents, the isolation model changed:
 * - Each family's data lives in a separate Automerge document
 * - The IndexedDB database module no longer exposes getDatabase()
 * - Family context and registry tests need to use the new Automerge persistence layer
 */
import { describe, it } from 'vitest';

describe('Multi-Family Database Isolation', () => {
  it.todo('should create separate Automerge documents for different families');
  it.todo('should not leak data when switching families');
});

describe('Family Context and Registry', () => {
  it.todo('should create a family in the registry and activate it');
  it.todo('should set lastActiveFamilyId when activating a family');
  it.todo('should resolve the last active family');
});

describe('Multi-User Family Isolation (simulated sign-in/sign-out)', () => {
  it.todo('User A should only see User A family data');
  it.todo('User B should only see User B family data');
  it.todo('switching users should change visible data');
});

describe('Sync File Handle Isolation', () => {
  it.todo('getSyncFileKey should return family-scoped key');
  it.todo('should not return a handle for a different family');
});

describe('UserFamilyMapping Lookup', () => {
  it.todo('should find family by email in UserFamilyMapping');
  it.todo('should not find mapping for unknown email');
});
