// @vitest-environment node
/**
 * The recurring-list reset carries a base (#117). It is the one direct `patch` site that
 * writes an array (`items`), so it goes through `patchOp`: the worker then unticks item by
 * item instead of replacing the array, and an item the base never saw is left alone.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { getById as projGetById } from '../../projection';
import { createAutomergeRepository } from '../../automergeRepository';
import { archiveCycleAndReset } from '../listCycleRepository';
import {
  installInlineBackend,
  recordMutations,
  patchOpsIn,
} from '../../worker/__tests__/inlineHarness';
import type { FamilyList, FamilyListItem, ListCycle } from '@/types/models';

const listRepo = createAutomergeRepository<'lists', FamilyList>('lists');

const item = (id: string, completed: boolean): FamilyListItem => ({ id, title: id, completed });

const cycle = (listId: string): ListCycle =>
  ({
    id: `${listId}:2026-10-01`,
    listId,
    startedOn: '2026-09-30',
    endedOn: '2026-10-01',
    title: 'Chores',
    emoji: '🧹',
    category: 'chores',
    ownerId: 'm-1',
    done: 1,
    total: 1,
    items: [],
    archivedAt: '2026-10-01T00:00:00.000Z',
  }) as unknown as ListCycle;

describe('archiveCycleAndReset base (#117)', () => {
  beforeEach(async () => {
    await installInlineBackend();
  });

  it('sends the projection items as the reset base and applies the reset', async () => {
    const list = await listRepo.create({
      title: 'Chores',
      emoji: '🧹',
      category: 'chores',
      ownerId: 'm-1',
      items: [item('dishes', true)],
      lifecycle: 'recurring',
      cycleCelebrated: true,
    } as any);
    const sent = recordMutations();

    await archiveCycleAndReset(
      cycle(list.id),
      list.id,
      { items: [item('dishes', false)], cycleCelebrated: false, lastResetDate: '2026-10-01' },
      '2026-10-01T00:00:00.000Z'
    );

    const [op] = patchOpsIn(sent);
    expect(op!.base).toEqual({ items: [item('dishes', true)], cycleCelebrated: true });
    expect(op!.onMissing).toBe('skip');
    const stored = projGetById('lists', list.id) as unknown as FamilyList;
    expect(stored.items).toEqual([item('dishes', false)]);
    expect(stored.lastResetDate).toBe('2026-10-01');
  });

  it('a list missing from the projection gets an additive base and the reset is skipped', async () => {
    const sent = recordMutations();

    await archiveCycleAndReset(
      cycle('gone'),
      'gone',
      { items: [], cycleCelebrated: false, lastResetDate: '2026-10-01' },
      '2026-10-01T00:00:00.000Z'
    );

    expect(patchOpsIn(sent)[0]!.base).toEqual({});
    expect(projGetById('lists', 'gone')).toBeUndefined();
  });
});
