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
import type { MutationOp } from '../protocol';
import type { TodoItem, UpdateTodoInput } from '@/types/models';
import { advanceRepeat, recentOccurrences, rollOverdue } from '@/utils/todoRecurrence';

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

/**
 * #123: a repeating to-do on two devices. Every write either device makes is an occurrence of
 * the same rule + anchor, `repeatLog` merges by its `date` key, and anything a merge leaves
 * stale is healed by the next `rollOverdue`. No "remote sync settled" gate is needed.
 */
describe('a repeating to-do on two devices (#123)', () => {
  // Weekly on Wednesdays from 2026-10-07 (occurrence X), created that day.
  const X = '2026-10-07';
  const seedTodo = {
    id: 'r1',
    title: 'Trash out',
    completed: false,
    createdBy: 'm1',
    createdAt: '2026-10-07T12:00:00.000Z',
    updatedAt: '2026-10-07T12:00:00.000Z',
    dueDate: X,
    repeat: {
      rule: { unit: 'week', interval: 1, weekdays: [3], end: { kind: 'never' } },
      anchor: X,
    },
    repeatLog: [],
  } as TodoItem;

  const read = (doc: Parameters<typeof materializeCollection>[0]): TodoItem => {
    const found = materializeCollection(doc, 'todos', foldIndex(doc)).find(([id]) => id === 'r1');
    return JSON.parse(JSON.stringify(found![1])) as TodoItem;
  };
  /** The store's write: a patch whose base is what this device held for the patched keys. */
  const write = (held: TodoItem, patch: UpdateTodoInput): MutationOp => {
    const base = Object.fromEntries(
      Object.entries(held).filter(([key, value]) => key in patch && value !== undefined)
    );
    return { op: 'patch', collection: 'todos', id: 'r1', patch, base };
  };
  const completeOn = (held: TodoItem, today: string): UpdateTodoInput => {
    const roll = advanceRepeat(held, 'done', 'm1', `${today}T20:00:00.000Z`, today);
    if (!roll || roll === 'series-ended') throw new Error('expected a roll');
    return roll.patch;
  };
  const rollOn = (held: TodoItem, today: string): UpdateTodoInput => {
    const patch = rollOverdue(held, today);
    if (!patch) throw new Error('expected an auto-roll');
    return patch;
  };

  it('A completes X, B auto-rolls X: same dueDate, one done entry, no missed', () => {
    const { a, b } = fork(seeded([{ op: 'set', collection: 'todos', id: 'r1', entity: seedTodo }]));
    const a1 = apply(a, write(seedTodo, completeOn(seedTodo, X)));
    const b1 = apply(b, write(seedTodo, rollOn(seedTodo, '2026-10-08')));
    const after = converge(a1, b1);

    const merged = read(after.a);
    expect(read(after.b).dueDate).toBe(merged.dueDate);
    expect(merged.dueDate).toBe('2026-10-14');
    expect(merged.repeatLog).toEqual([
      { date: X, outcome: 'done', by: 'm1', at: `${X}T20:00:00.000Z` },
    ]);
    expect(recentOccurrences(merged, 5)).toEqual([
      { date: X, outcome: 'done', by: 'm1', at: `${X}T20:00:00.000Z` },
    ]);
    // Nothing left to heal on either device.
    expect(rollOverdue(merged, '2026-10-08')).toBeNull();
  });

  it('B rolling on a later day converges after one more reconcile', () => {
    const { a, b } = fork(seeded([{ op: 'set', collection: 'todos', id: 'r1', entity: seedTodo }]));
    const a1 = apply(a, write(seedTodo, completeOn(seedTodo, X)));
    // B wakes on the 15th: X and the 14th are both past.
    const b1 = apply(b, write(seedTodo, rollOn(seedTodo, '2026-10-15')));
    const after = converge(a1, b1);

    // Whichever dueDate won the merge, B's next reconcile settles it and both agree.
    const held = read(after.b);
    const heal = rollOverdue(held, '2026-10-15');
    const b2 = heal ? apply(after.b, write(held, heal)) : after.b;
    const settled = converge(after.a, b2);
    const merged = read(settled.a);
    expect(merged.dueDate).toBe('2026-10-21');
    expect(merged.repeatLog?.map((e) => e.date)).toEqual([X]);
    expect(recentOccurrences(merged, 5).map((o) => [o.date, o.outcome])).toEqual([
      ['2026-10-14', 'missed'],
      [X, 'done'],
    ]);
  });

  it('LWW landing dueDate on an already-logged date self-heals in one pass, no missed', () => {
    const Y = '2026-10-14';
    const Z = '2026-10-21';
    const { a, b } = fork(seeded([{ op: 'set', collection: 'todos', id: 'r1', entity: seedTodo }]));
    // B, offline, completes X and then Y: log X,Y; due Z.
    const b1 = apply(b, write(seedTodo, completeOn(seedTodo, X)));
    const bHeld = read(b1);
    const b2 = apply(b1, write(bHeld, completeOn(bHeld, Y)));
    // A completes X: log X; due Y. A's unrelated writes first lift its op counter above B's, so
    // A's `dueDate` deterministically wins the merge and lands on Y, which B already logged.
    const pad = Array.from(
      { length: 40 },
      (_, i) =>
        ({
          op: 'set',
          collection: 'todos',
          id: `pad${i}`,
          entity: todo(`pad${i}`, 'pad'),
        }) as MutationOp
    );
    const a1 = apply(a, ...pad, write(seedTodo, completeOn(seedTodo, X)));
    const after = converge(a1, b2);

    const landed = read(after.a);
    expect(landed.dueDate).toBe(Y);
    // Both devices logged X, so the merged list holds X twice until a write to the log heals it;
    // every reader treats the log as keyed by date.
    expect(new Set(landed.repeatLog?.map((e) => e.date))).toEqual(new Set([X, Y]));

    // One reconcile pass on Y's day advances past every logged occurrence, and nothing is missed.
    const heal = rollOverdue(landed, Y);
    expect(heal).toEqual({ dueDate: Z });
    const settled = converge(apply(after.a, write(landed, heal!)), after.b);
    const merged = read(settled.b);
    expect(merged.dueDate).toBe(Z);
    expect(rollOverdue(merged, Y)).toBeNull();
    expect(recentOccurrences(merged, 5).map((o) => [o.date, o.outcome])).toEqual([
      [Y, 'done'],
      [X, 'done'],
    ]);
  });
});
