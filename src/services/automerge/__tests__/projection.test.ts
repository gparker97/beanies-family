import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyDelta,
  list,
  getById,
  count,
  getSettings,
  resetProjection,
  docVersion,
} from '../projection';
import type { ProjectionDelta } from '../worker/protocol';

const txn = (id: string, extra: Record<string, unknown> = {}) => ({ id, amount: 1, ...extra });

describe('projection', () => {
  beforeEach(() => resetProjection());

  it('upsert adds then replaces an entity and bumps docVersion each time', () => {
    const v0 = docVersion.value;
    applyDelta({ kind: 'upsert', collection: 'transactions', id: 't1', entity: txn('t1') });
    expect(count('transactions')).toBe(1);
    expect(getById('transactions', 't1')).toEqual(txn('t1'));
    expect(docVersion.value).toBe(v0 + 1);

    applyDelta({
      kind: 'upsert',
      collection: 'transactions',
      id: 't1',
      entity: txn('t1', { amount: 99 }),
    });
    expect(count('transactions')).toBe(1); // replaced, not duplicated
    expect((getById('transactions', 't1') as { amount: number }).amount).toBe(99);
    expect(docVersion.value).toBe(v0 + 2);
  });

  it('remove deletes an entity; a no-op remove does not bump reactivity needlessly', () => {
    applyDelta({ kind: 'upsert', collection: 'todos', id: 'x', entity: { id: 'x' } });
    applyDelta({ kind: 'remove', collection: 'todos', id: 'x' });
    expect(getById('todos', 'x')).toBeUndefined();
    expect(count('todos')).toBe(0);
  });

  it('bulk reset replaces the whole collection; append merges', () => {
    applyDelta({ kind: 'upsert', collection: 'accounts', id: 'old', entity: { id: 'old' } });
    applyDelta({
      kind: 'bulk',
      collection: 'accounts',
      reset: true,
      entities: [
        ['a', { id: 'a' }],
        ['b', { id: 'b' }],
      ],
    });
    expect(count('accounts')).toBe(2); // 'old' gone
    expect(getById('accounts', 'old')).toBeUndefined();

    applyDelta({
      kind: 'bulk',
      collection: 'accounts',
      reset: false,
      entities: [['c', { id: 'c' }]],
    });
    expect(count('accounts')).toBe(3);
    expect(
      list('accounts')
        .map((a) => (a as { id: string }).id)
        .sort()
    ).toEqual(['a', 'b', 'c']);
  });

  it('settings delta updates the singleton', () => {
    expect(getSettings()).toBeNull();
    applyDelta({ kind: 'settings', settings: { baseCurrency: 'SGD' } as never });
    expect((getSettings() as unknown as { baseCurrency: string }).baseCurrency).toBe('SGD');
  });

  it('multi applies every sub-delta but bumps docVersion exactly once', () => {
    const v0 = docVersion.value;
    const delta: ProjectionDelta = {
      kind: 'multi',
      deltas: [
        { kind: 'upsert', collection: 'transactions', id: 't1', entity: txn('t1') },
        { kind: 'upsert', collection: 'accounts', id: 'a1', entity: { id: 'a1' } },
        { kind: 'remove', collection: 'transactions', id: 'nope' },
      ],
    };
    applyDelta(delta);
    expect(count('transactions')).toBe(1);
    expect(count('accounts')).toBe(1);
    expect(docVersion.value).toBe(v0 + 1); // single bump for the whole batch
  });

  it('resetProjection clears everything', () => {
    applyDelta({ kind: 'upsert', collection: 'transactions', id: 't1', entity: txn('t1') });
    applyDelta({ kind: 'settings', settings: { baseCurrency: 'USD' } as never });
    resetProjection();
    expect(count('transactions')).toBe(0);
    expect(getSettings()).toBeNull();
  });
});
