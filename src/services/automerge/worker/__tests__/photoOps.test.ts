// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import * as Automerge from '@automerge/automerge';
import type { FamilyDocument } from '@/types/automerge';
import {
  migrateDoc,
  applyMutation as applyMutationTo,
  materializeCollection,
  registerNamedOp,
  getHeads,
} from '../docOps';
import {
  attachPhotoNamedHandler,
  collectReferencedPhotoIds,
  isFlatPhotoHost,
  vacationSegmentEntityId,
} from '../photoOps';
import { apply, converge, fork, seeded, type Doc } from './twoDevices';
import { foldIndex } from '../counterFields';
import type { MutationOp } from '../protocol';
import { FORMS } from './strForms';
import {
  configure,
  loadSnapshot,
  collectReferencedPhotoIds as collectThroughWorker,
  __resetApplyAndProjectForTesting,
} from '../applyAndProject';

const base = () => migrateDoc(Automerge.init<FamilyDocument>());
const attach = (entityCollection: string, entityId: string, photoId: string) => ({
  op: 'named' as const,
  name: 'attachPhotoToEntity',
  args: { entityCollection, entityId, photoId },
});

// photoOps self-registers its collections at import; register the named op.
beforeAll(() => registerNamedOp('attachPhotoToEntity', attachPhotoNamedHandler));

/** `collectReferencedPhotoIds`, asserting every id is a PLAIN string (`gcOrphans` matches them). */
function collectPlain(doc: Doc): Set<string> {
  const ids = collectReferencedPhotoIds(doc);
  for (const id of ids) expect(typeof id).toBe('string');
  return ids;
}

// #124 R3: both string forms. Every mutation first turns its input doc into `form`, so the
// segment lookup and the collectors read `str` ids and `photoIds` elements in the str row.
describe.each(FORMS)('photoOps — attach named op (%s)', (_form, form) => {
  const applyMutation = (doc: Doc, op: MutationOp) => applyMutationTo(form(doc), op);
  const collect = (doc: Doc) => collectPlain(form(doc));

  it('flat host: pushes the photoId onto the entity and emits its delta', () => {
    const d = applyMutation(base(), {
      op: 'set',
      collection: 'activities',
      id: 'a1',
      entity: { id: 'a1' },
    }).doc;
    const { doc, delta } = applyMutation(d, attach('activities', 'a1', 'p1'));
    expect(
      (materializeCollection(doc, 'activities', foldIndex(doc))[0]![1] as { photoIds: string[] })
        .photoIds
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
    const vac = materializeCollection(doc, 'vacations', foldIndex(doc))[0]![1] as {
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
    expect([...collect(d)].sort()).toEqual(['p1', 'p2']);
  });

  // ─── #117: attach APPENDS, so concurrent attaches merge ────────────────────

  it('attach on two devices keeps both photos, and the orphan collector sees both', () => {
    const { a, b } = fork(
      form(
        seeded([
          { op: 'set', collection: 'recipes', id: 'r1', entity: { id: 'r1', photoIds: [] } },
          {
            op: 'set',
            collection: 'vacations',
            id: 'v1',
            entity: { id: 'v1', travelSegments: [{ id: 's1', photoIds: [] }] },
          },
        ])
      )
    );
    const seg = vacationSegmentEntityId('v1', 's1');
    const { a: merged } = converge(
      apply(a, attach('recipes', 'r1', 'pA'), attach('vacations', seg, 'sA')),
      apply(b, attach('recipes', 'r1', 'pB'), attach('vacations', seg, 'sB'))
    );
    const recipe = materializeCollection(merged, 'recipes', foldIndex(merged))[0]![1] as {
      photoIds: string[];
    };
    expect([...recipe.photoIds].sort()).toEqual(['pA', 'pB']);
    // `gcOrphans` deletes every stored photo NOT in this set: nothing either device attached.
    const referenced = collect(merged);
    for (const id of ['pA', 'pB', 'sA', 'sB']) expect(referenced.has(id)).toBe(true);
  });

  it('attaching the same photo again is a no-op (a retry or a refresh write): heads unchanged', () => {
    // Settled into the form, so the retry's own conversion is not a change.
    const host = form(
      applyMutation(base(), {
        op: 'set',
        collection: 'activities',
        id: 'a1',
        entity: { id: 'a1', photoIds: ['p1'] },
      }).doc
    );
    const heads = getHeads(host);
    const again = applyMutation(host, attach('activities', 'a1', 'p1')).doc;
    expect(getHeads(again)).toEqual(heads);
  });
});

describe('photoOps — hosts', () => {
  it('isFlatPhotoHost names the registered flat hosts only', () => {
    for (const name of ['medications', 'recipes', 'cookLogs', 'milestones', 'activities']) {
      expect(isFlatPhotoHost(name)).toBe(true);
    }
    // Vacations nest their photos in segments; the avatar is a scalar; todos host none.
    for (const name of ['vacations', 'familyMembers', 'todos']) {
      expect(isFlatPhotoHost(name)).toBe(false);
    }
  });
});

// #124 R3: the GC path end to end. `gcOrphans` deletes every stored photo NOT in this list, so a
// `str` id that came back as an `ImmutableString` (or, after the `postMessage` structured clone,
// a bare `{ val }`) would match nothing and every photo would be deleted.
describe.each(FORMS)('collectReferencedPhotoIds through the worker (%s)', (formName, form) => {
  beforeAll(() => {
    __resetApplyAndProjectForTesting();
    configure({
      pushChunk: () => {},
      perf: () => {},
      cachePersistFailed: () => {},
      cacheReleased: () => {},
    });
  });

  it('returns plain strings from every host shape, intact across a structured clone', () => {
    const doc = form(
      seeded([
        {
          op: 'set',
          collection: 'familyMembers',
          id: 'm1',
          entity: { id: 'm1', name: 'Mia', avatarPhotoId: 'pAvatar' },
        },
        { op: 'set', collection: 'recipes', id: 'r1', entity: { id: 'r1', photoIds: ['pFlat'] } },
        {
          op: 'set',
          collection: 'vacations',
          id: 'v1',
          entity: { id: 'v1', travelSegments: [{ id: 's1', photoIds: ['pSeg'] }] },
        },
      ])
    );
    if (formName === 'str') {
      expect(Automerge.isImmutableString(doc.recipes.r1!.photoIds![0])).toBe(true);
    }
    loadSnapshot(Automerge.save(doc));
    const { ids } = collectThroughWorker();
    expect([...ids].sort()).toEqual(['pAvatar', 'pFlat', 'pSeg']);
    for (const id of ids) expect(typeof id).toBe('string');
    // The worker realm hands the result to `postMessage`: a structured clone must not change it.
    expect(structuredClone(ids)).toEqual(ids);
  });
});
