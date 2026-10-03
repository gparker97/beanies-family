// @vitest-environment node
/**
 * Smoke test for the shared two-device harness (`./twoDevices.ts`): forking gives two
 * concurrent writers, and `converge` brings both to the same document with both edits.
 */
import { describe, it, expect } from 'vitest';
import * as Automerge from '@automerge/automerge';
import { materializeCollection } from '../docOps';
import { apply, converge, fork, materialise, seeded } from './twoDevices';
import { foldIndex } from '../counterFields';

const todo = (id: string, title: string) => ({ id, title, completed: false });

describe('twoDevices harness', () => {
  it('seeded builds a migrated document carrying the seed ops', () => {
    const doc = seeded([{ op: 'set', collection: 'todos', id: 't1', entity: todo('t1', 'milk') }]);
    expect(materializeCollection(doc, 'todos', foldIndex(doc))).toEqual([
      ['t1', todo('t1', 'milk')],
    ]);
    expect(doc.accounts).toEqual({});
  });

  it('fork gives two devices with distinct actors; origin stays usable', () => {
    const origin = seeded();
    const { a, b } = fork(origin);
    expect(Automerge.getActorId(a)).not.toBe(Automerge.getActorId(b));
    expect(materialise(a)).toEqual(materialise(origin));
  });

  it('converge merges both ways: concurrent edits on different entities both survive', () => {
    const origin = seeded([
      { op: 'set', collection: 'todos', id: 't1', entity: todo('t1', 'milk') },
    ]);
    const { a, b } = fork(origin);
    const a1 = apply(a, { op: 'set', collection: 'todos', id: 't2', entity: todo('t2', 'eggs') });
    const b1 = apply(b, {
      op: 'patch',
      collection: 'todos',
      id: 't1',
      patch: { completed: true },
    });
    const after = converge(a1, b1);
    expect(materializeCollection(after.a, 'todos', foldIndex(after.a))).toEqual([
      ['t1', { ...todo('t1', 'milk'), completed: true }],
      ['t2', todo('t2', 'eggs')],
    ]);
  });

  it('the converged devices keep their own actors and can write again', () => {
    const { a, b } = fork(seeded());
    const actors = [Automerge.getActorId(a), Automerge.getActorId(b)];
    const after = converge(a, b);
    expect([Automerge.getActorId(after.a), Automerge.getActorId(after.b)]).toEqual(actors);
    const a2 = apply(after.a, {
      op: 'set',
      collection: 'todos',
      id: 't9',
      entity: todo('t9', 'x'),
    });
    const again = converge(a2, after.b);
    expect(materializeCollection(again.b, 'todos', foldIndex(again.b))).toEqual([
      ['t9', todo('t9', 'x')],
    ]);
  });
});
