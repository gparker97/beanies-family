// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { mutate } from '../docClient';
import { list, getById } from '../../projection';
import { installInlineBackend } from './inlineHarness';

describe('inline backend (docClient → applyAndProject → projection, no Worker)', () => {
  beforeEach(async () => {
    await installInlineBackend();
  });

  it('a mutate runs inline and its delta lands in the projection before resolve', async () => {
    const result = await mutate({
      op: 'set',
      collection: 'accounts',
      id: 'a1',
      entity: { id: 'a1', balance: 100 },
    });
    // Read-after-write: the projection reflects the write synchronously post-await.
    expect(getById('accounts', 'a1')).toEqual({ id: 'a1', balance: 100 });
    expect(result).toEqual({ id: 'a1', balance: 100 });
  });

  it('a named domain op resolves its handler result through the inline path', async () => {
    await mutate({
      op: 'set',
      collection: 'goals',
      id: 'g',
      entity: { id: 'g', currentAmount: 50, targetAmount: 100, isCompleted: false },
    });
    const updated = await mutate<{ currentAmount: number; isCompleted: boolean }>({
      op: 'named',
      name: 'applyGoalContribution',
      args: { id: 'g', delta: 60 },
    });
    expect(updated).toMatchObject({ currentAmount: 110, isCompleted: true });
    expect((getById('goals', 'g') as { currentAmount: number }).currentAmount).toBe(110);
  });

  it('serializes concurrent mutates (no lost write)', async () => {
    await mutate({ op: 'set', collection: 'todos', id: 't1', entity: { id: 't1' } });
    await Promise.all([
      mutate({ op: 'set', collection: 'todos', id: 't2', entity: { id: 't2' } }),
      mutate({ op: 'set', collection: 'todos', id: 't3', entity: { id: 't3' } }),
    ]);
    expect(
      list('todos')
        .map((t) => (t as { id: string }).id)
        .sort()
    ).toEqual(['t1', 't2', 't3']);
  });
});
