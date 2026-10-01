// @vitest-environment node
/**
 * The committed migration-change table (#117, plan `docs/plans/2026-10-01-crdt-merge-safe-writes.md`
 * §F). Each entry is the change `migrateDoc` applies to create an ABSENT collection, so every
 * device that migrates an old pod creates the SAME map object.
 *
 * ⚠️ THERE IS DELIBERATELY NO "REGENERATE AND COMPARE" TEST. The bytes are already in families'
 * pods; a newer Automerge may encode the same change differently, and a regenerated entry would
 * then collide on actor+seq with the copy in those pods. These tests check what the stored
 * bytes MEAN, which stays true across upgrades, never that they equal a fresh build.
 */
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import * as Automerge from '@automerge/automerge';
import { COLLECTION_NAMES } from '@/types/automerge';
import { MIGRATION_CHANGES } from '../migrationChanges';

const actorFor = (name: string) =>
  createHash('sha256')
    .update('beanies-migration:' + name)
    .digest('hex')
    .slice(0, 16);

const bytesOf = (b64: string) => Uint8Array.from(Buffer.from(b64, 'base64'));

describe('MIGRATION_CHANGES', () => {
  it('has exactly one entry per collection (the Record type enforces it at compile time too)', () => {
    expect(Object.keys(MIGRATION_CHANGES).sort()).toEqual([...COLLECTION_NAMES].sort());
  });

  it.each(Object.entries(MIGRATION_CHANGES))(
    '%s decodes to one root op creating an empty map: deps [], seq 1, time 0, derived actor',
    (name, b64) => {
      const decoded = Automerge.decodeChange(bytesOf(b64));
      expect(decoded.actor).toBe(actorFor(name));
      expect(decoded.seq).toBe(1);
      expect(decoded.startOp).toBe(1);
      expect(decoded.deps).toEqual([]);
      expect(decoded.time).toBe(0);
      expect(decoded.ops).toEqual([{ action: 'makeMap', obj: '_root', key: name, pred: [] }]);
      // ...and applied alone it materialises to exactly `{ [name]: {} }`.
      const [doc] = Automerge.applyChanges(Automerge.init<Record<string, unknown>>(), [
        bytesOf(b64),
      ]);
      expect(JSON.parse(JSON.stringify(doc))).toEqual({ [name]: {} });
    }
  );

  it('no two collections share an actor (each change is its own history)', () => {
    const actors = Object.values(MIGRATION_CHANGES).map((b64) => {
      return Automerge.decodeChange(bytesOf(b64)).actor;
    });
    expect(new Set(actors).size).toBe(actors.length);
  });
});
