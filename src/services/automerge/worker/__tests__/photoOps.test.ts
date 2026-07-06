// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import * as Automerge from '@automerge/automerge';
import type { FamilyDocument } from '@/types/automerge';
import { migrateDoc, applyMutation, materializeCollection, registerNamedOp } from '../docOps';
import {
  attachPhotoNamedHandler,
  collectReferencedPhotoIds,
  vacationSegmentEntityId,
} from '../photoOps';

const base = () => migrateDoc(Automerge.init<FamilyDocument>());
const attach = (entityCollection: string, entityId: string, photoId: string) => ({
  op: 'named' as const,
  name: 'attachPhotoToEntity',
  args: { entityCollection, entityId, photoId },
});

describe('photoOps — attach named op', () => {
  // photoOps self-registers its collections at import; register the named op.
  beforeAll(() => registerNamedOp('attachPhotoToEntity', attachPhotoNamedHandler));

  it('flat host: pushes the photoId onto the entity and emits its delta', () => {
    const d = applyMutation(base(), {
      op: 'set',
      collection: 'activities',
      id: 'a1',
      entity: { id: 'a1' },
    }).doc;
    const { doc, delta } = applyMutation(d, attach('activities', 'a1', 'p1'));
    expect(
      (materializeCollection(doc, 'activities')[0]![1] as { photoIds: string[] }).photoIds
    ).toEqual(['p1']);
    expect(delta).toMatchObject({ kind: 'upsert', collection: 'activities', id: 'a1' });
  });

  it('vacation host: walks the nested segment array and emits the parent-vacation delta', () => {
    const d = applyMutation(base(), {
      op: 'set',
      collection: 'vacations',
      id: 'v1',
      entity: { id: 'v1', travelSegments: [{ id: 's1' }] },
    }).doc;
    const { doc, delta } = applyMutation(
      d,
      attach('vacations', vacationSegmentEntityId('v1', 's1'), 'p2')
    );
    const vac = materializeCollection(doc, 'vacations')[0]![1] as {
      travelSegments: Array<{ photoIds?: string[] }>;
    };
    expect(vac.travelSegments[0]!.photoIds).toEqual(['p2']);
    expect(delta).toMatchObject({ kind: 'upsert', collection: 'vacations', id: 'v1' });
  });

  it('benign miss (vacation absent, e.g. mid-wizard): no throw, empty delta', () => {
    const { delta } = applyMutation(base(), attach('vacations', 'vNope/s1', 'p3'));
    expect(delta).toEqual({ kind: 'multi', deltas: [] });
  });

  it('collectReferencedPhotoIds gathers ids across flat + nested hosts', () => {
    let d = applyMutation(base(), {
      op: 'set',
      collection: 'activities',
      id: 'a1',
      entity: { id: 'a1', photoIds: ['p1'] },
    }).doc;
    d = applyMutation(d, {
      op: 'set',
      collection: 'vacations',
      id: 'v1',
      entity: { id: 'v1', accommodations: [{ id: 's2', photoIds: ['p2'] }] },
    }).doc;
    expect([...collectReferencedPhotoIds(d)].sort()).toEqual(['p1', 'p2']);
  });
});
