// @vitest-environment node
/**
 * Concurrent-edit contract for SayingItem — the per-phase CRDT test
 * required by the Pod plan. Verifies Automerge merge semantics hold
 * for the sayings collection so two devices editing different
 * sayings about the same member both land cleanly after sync.
 *
 * ADR-032: the doc + merge now live in the worker's pure, vue-free doc-ops
 * layer (`worker/docOps.ts`). This drives that layer directly — save binary,
 * fork via `Automerge.load`, mutate both sides, `mergeDocs` — mirroring
 * `worker/__tests__/docOps.test.ts`. The generic merge mechanism is covered
 * there; this asserts the sayings-collection contract specifically.
 */
import { describe, it, expect } from 'vitest';
import * as Automerge from '@automerge/automerge';
import {
  migrateDoc,
  saveDoc,
  mergeDocs,
  applyMutation,
  materializeCollection,
} from '@/services/automerge/worker/docOps';
import type { FamilyDocument } from '@/types/automerge';
import type { SayingItem } from '@/types/models';

type Doc = Automerge.Doc<FamilyDocument>;

const MEMBER_ID = 'member-neil';

const base = (): Doc => migrateDoc(Automerge.init<FamilyDocument>());

function saying(id: string, words: string, extra: Partial<SayingItem> = {}): SayingItem {
  return {
    id,
    memberId: MEMBER_ID,
    words,
    saidOn: '2026-03-01',
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-01T00:00:00Z',
    ...extra,
  } as SayingItem;
}

/** Read the sayings collection as an id→entity record. */
function sayingsOf(doc: Doc): Record<string, SayingItem> {
  return Object.fromEntries(materializeCollection(doc, 'sayings')) as Record<string, SayingItem>;
}

describe('sayings — concurrent edits merge cleanly', () => {
  it('two devices adding different sayings for the same member converge', () => {
    // Seed a saying that exists on both sides before the fork.
    let doc = applyMutation(base(), {
      op: 'set',
      collection: 'sayings',
      id: 'seed',
      entity: saying('seed', 'I am the captain now'),
    }).doc;

    // Fork: doc B starts as a snapshot of doc A.
    const forked = Automerge.load<FamilyDocument>(saveDoc(doc));

    // Side A — add a saying.
    doc = applyMutation(doc, {
      op: 'set',
      collection: 'sayings',
      id: 'a-saying',
      entity: saying('a-saying', 'I said it first', { saidOn: '2026-03-02' }),
    }).doc;

    // Side B — add a different saying via direct Automerge.change.
    const bChanged = Automerge.change(forked, (d) => {
      d.sayings['b-saying'] = saying('b-saying', 'From the other device', { saidOn: '2026-03-02' });
    });

    // Merge B into A.
    doc = mergeDocs(doc, bChanged).doc;

    const ids = Object.keys(sayingsOf(doc)).sort();
    expect(ids).toContain('seed');
    expect(ids).toContain('a-saying');
    expect(ids).toContain('b-saying');
    expect(ids).toHaveLength(3);
  });

  it('two devices editing DIFFERENT fields on the same saying converge without loss', () => {
    // Shared seed both sides will edit.
    let doc = applyMutation(base(), {
      op: 'set',
      collection: 'sayings',
      id: 'seed',
      entity: saying('seed', 'Placeholder'),
    }).doc;

    const forked = Automerge.load<FamilyDocument>(saveDoc(doc));

    // Side A edits the `place` field.
    doc = applyMutation(doc, {
      op: 'patch',
      collection: 'sayings',
      id: 'seed',
      patch: { place: 'kitchen' },
    }).doc;

    // Side B edits the `context` field on its fork.
    const bChanged = Automerge.change(forked, (d) => {
      const s = d.sayings['seed'];
      if (s) s.context = 'right before dinner';
    });

    doc = mergeDocs(doc, bChanged).doc;

    const merged = sayingsOf(doc)['seed'];
    expect(merged).toBeDefined();
    // Automerge's default CRDT behavior keeps both writes because they touch
    // disjoint fields — this is the critical guarantee we rely on.
    expect(merged!.place).toBe('kitchen');
    expect(merged!.context).toBe('right before dinner');
    expect(merged!.words).toBe('Placeholder');
  });

  it('delete-on-one-side + edit-on-other-side does not resurrect the saying', () => {
    let doc = applyMutation(base(), {
      op: 'set',
      collection: 'sayings',
      id: 'seed',
      entity: saying('seed', 'To be deleted'),
    }).doc;

    const forked = Automerge.load<FamilyDocument>(saveDoc(doc));

    // Side A deletes the saying (Automerge delete on a map key drops the entry).
    doc = applyMutation(doc, { op: 'delete', collection: 'sayings', id: 'seed' }).doc;
    expect(sayingsOf(doc)['seed']).toBeUndefined();

    // Side B edits the same saying — classic "edited the deleted one" race.
    // Automerge's convention: delete wins, edits on the deleted key are dropped.
    const bChanged = Automerge.change(forked, (d) => {
      const s = d.sayings['seed'];
      if (s) s.words = 'I edited on B';
    });

    doc = mergeDocs(doc, bChanged).doc;

    // The delete wins — the edited saying does not come back.
    expect(sayingsOf(doc)['seed']).toBeUndefined();
  });
});
