// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getById as projGetById } from '../projection';
import { createAutomergeRepository } from '../automergeRepository';
import {
  installInlineBackend,
  recordMutations,
  patchOpsIn,
} from '../worker/__tests__/inlineHarness';
import { setWriteGate, ReadOnlyError } from '../worker/docClient';
import type { FamilyList, FamilyListItem, FamilyMember } from '@/types/models';

// The read-only gate's side channels (#95); nothing else in this file reaches them.
vi.mock('@/composables/useToast', () => ({ showToast: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

// Test with familyMembers collection using a transform
function applyDefaults(member: FamilyMember): FamilyMember {
  return {
    ...member,
    gender: member.gender ?? 'other',
    ageGroup: member.ageGroup ?? 'adult',
    requiresPassword: !member.passwordHash,
  };
}

const repo = createAutomergeRepository<
  'familyMembers',
  FamilyMember,
  Omit<FamilyMember, 'id' | 'createdAt' | 'updatedAt'>,
  Partial<Omit<FamilyMember, 'id' | 'createdAt' | 'updatedAt'>>
>('familyMembers', { transform: applyDefaults });

describe('createAutomergeRepository', () => {
  beforeEach(async () => {
    await installInlineBackend();
  });

  describe('create', () => {
    it('creates entity with auto-generated ID and timestamps', async () => {
      const member = await repo.create({
        name: 'Alice',
        email: 'alice@example.com',
        gender: 'female',
        ageGroup: 'adult',
        role: 'owner',
        color: '#FF0000',
        requiresPassword: false,
      });

      expect(member.id).toBeDefined();
      expect(member.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(member.createdAt).toBeDefined();
      expect(member.updatedAt).toBeDefined();
      expect(member.name).toBe('Alice');
    });

    it('entity is stored in the Automerge doc', async () => {
      const member = await repo.create({
        name: 'Bob',
        email: 'bob@example.com',
        gender: 'male',
        ageGroup: 'adult',
        role: 'member',
        color: '#0000FF',
        requiresPassword: false,
      });

      const stored = projGetById('familyMembers', member.id) as FamilyMember | undefined;
      expect(stored).toBeDefined();
      expect(stored!.name).toBe('Bob');
    });
  });

  describe('getById', () => {
    it('returns entity by ID', async () => {
      const created = await repo.create({
        name: 'Charlie',
        email: 'charlie@example.com',
        gender: 'other',
        ageGroup: 'child',
        role: 'member',
        color: '#00FF00',
        requiresPassword: false,
      });

      const found = await repo.getById(created.id);
      expect(found).toBeDefined();
      expect(found!.name).toBe('Charlie');
    });

    it('returns undefined for non-existent ID', async () => {
      const found = await repo.getById('non-existent');
      expect(found).toBeUndefined();
    });
  });

  describe('getAll', () => {
    it('returns all entities', async () => {
      await repo.create({
        name: 'A',
        email: 'a@example.com',
        gender: 'female',
        ageGroup: 'adult',
        role: 'owner',
        color: '#F00',
        requiresPassword: false,
      });
      await repo.create({
        name: 'B',
        email: 'b@example.com',
        gender: 'male',
        ageGroup: 'adult',
        role: 'member',
        color: '#0F0',
        requiresPassword: false,
      });

      const all = await repo.getAll();
      expect(all).toHaveLength(2);
      expect(all.map((m) => m.name).sort()).toEqual(['A', 'B']);
    });

    it('returns empty array when collection is empty', async () => {
      const all = await repo.getAll();
      expect(all).toEqual([]);
    });
  });

  describe('update', () => {
    it('updates entity and bumps updatedAt', async () => {
      const created = await repo.create({
        name: 'Dana',
        email: 'dana@example.com',
        gender: 'female',
        ageGroup: 'adult',
        role: 'member',
        color: '#ABC',
        requiresPassword: false,
      });

      const updated = await repo.update(created.id, { name: 'Dana Updated' });
      expect(updated).toBeDefined();
      expect(updated!.name).toBe('Dana Updated');
      expect(updated!.email).toBe('dana@example.com'); // unchanged
      expect(updated!.id).toBe(created.id); // same ID
    });

    it('returns undefined for non-existent ID', async () => {
      const result = await repo.update('non-existent', { name: 'Nope' });
      expect(result).toBeUndefined();
    });

    it('threads opts.system to mutate: a system write passes a read-only family, an edit does not (#95)', async () => {
      const created = await repo.create({
        name: 'Erin',
        email: 'erin@example.com',
        gender: 'female',
        ageGroup: 'adult',
        role: 'member',
        color: '#ABC',
        requiresPassword: false,
      });
      setWriteGate(() => ({ block: true, wouldBlock: false }));
      try {
        await expect(repo.update(created.id, { name: 'Refused' })).rejects.toBeInstanceOf(
          ReadOnlyError
        );
        const stamped = await repo.update(
          created.id,
          { lastLoginAt: '2026-09-30' },
          { system: true }
        );
        expect(stamped!.lastLoginAt).toBe('2026-09-30');
        expect(stamped!.name).toBe('Erin');
      } finally {
        setWriteGate(null);
      }
    });

    it('deletes fields explicitly set to undefined', async () => {
      const created = await repo.create({
        name: 'Eve',
        email: 'eve@example.com',
        gender: 'female',
        ageGroup: 'adult',
        role: 'member',
        color: '#DEF',
        requiresPassword: false,
      });

      // Set institution field (simulates linking to a goal/entity)
      await repo.update(created.id, { institution: 'Test Bank' } as any);
      let fetched = await repo.getById(created.id);
      expect((fetched as any).institution).toBe('Test Bank');

      // Now clear it by passing explicit undefined (simulates unlinking)
      await repo.update(created.id, { institution: undefined } as any);
      fetched = await repo.getById(created.id);
      expect((fetched as any).institution).toBeUndefined();

      // Other fields should be untouched
      expect(fetched!.name).toBe('Eve');
      expect(fetched!.email).toBe('eve@example.com');
    });
  });

  describe('update base (#117)', () => {
    const member = {
      name: 'Hana',
      email: 'hana@example.com',
      gender: 'female' as const,
      ageGroup: 'adult' as const,
      role: 'member' as const,
      color: '#ABC',
      requiresPassword: false,
    };

    it('sends the RAW stored values of exactly the patched keys as base, never the transformed read', async () => {
      const created = await repo.create(member);
      // The read transform derives `requiresPassword: true` (no passwordHash); the stored value is false.
      expect((await repo.getById(created.id))!.requiresPassword).toBe(true);
      const sent = recordMutations();

      const updated = await repo.update(created.id, {
        requiresPassword: true,
        name: 'Hana P',
        institution: undefined,
      } as any);

      const [op] = patchOpsIn(sent);
      expect(op!.base).toEqual({ requiresPassword: false, name: 'Hana' });
      expect(op!.deleteKeys).toEqual(['institution']);
      // With a transformed base the explicit `true` would read as unchanged and be dropped.
      const stored = projGetById('familyMembers', created.id) as unknown as FamilyMember;
      expect(stored.requiresPassword).toBe(true);
      expect(updated!.name).toBe('Hana P');
    });

    it('leaves a key the entity lacks out of base, so its write is additive', async () => {
      const created = await repo.create(member);
      const sent = recordMutations();

      await repo.update(created.id, { lastLoginAt: '2026-10-01' });

      expect(patchOpsIn(sent)[0]!.base).toEqual({});
    });

    it('two writes built from the same state, the second sent before the first lands, both survive', async () => {
      const listRepo = createAutomergeRepository<'lists', FamilyList>('lists');
      const item = (id: string, completed: boolean): FamilyListItem => ({
        id,
        title: id,
        completed,
      });
      const list = await listRepo.create({
        title: 'Shopping',
        emoji: '🛒',
        category: 'shopping',
        ownerId: 'm-1',
        items: [item('milk', false), item('eggs', false)],
        lifecycle: 'ongoing',
      } as any);

      // Two quick ticks, each built from the pre-write items: today the second reverted the first.
      await Promise.all([
        listRepo.update(list.id, { items: [item('milk', true), item('eggs', false)] }),
        listRepo.update(list.id, { items: [item('milk', false), item('eggs', true)] }),
      ]);

      const stored = projGetById('lists', list.id) as unknown as FamilyList;
      expect(stored.items.map((i) => [i.id, i.completed])).toEqual([
        ['milk', true],
        ['eggs', true],
      ]);
    });
  });

  describe('remove', () => {
    it('removes entity and returns true', async () => {
      const created = await repo.create({
        name: 'Eve',
        email: 'eve@example.com',
        gender: 'female',
        ageGroup: 'adult',
        role: 'member',
        color: '#DEF',
        requiresPassword: false,
      });

      const result = await repo.remove(created.id);
      expect(result).toBe(true);

      const found = await repo.getById(created.id);
      expect(found).toBeUndefined();
    });

    it('returns false for non-existent ID', async () => {
      const result = await repo.remove('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('transform', () => {
    it('applies transform on getById', async () => {
      // Create a member without passwordHash — transform should set requiresPassword
      const created = await repo.create({
        name: 'Frank',
        email: 'frank@example.com',
        gender: 'male',
        ageGroup: 'adult',
        role: 'member',
        color: '#123',
        requiresPassword: false,
      });

      const found = await repo.getById(created.id);
      // Transform sets requiresPassword = !passwordHash
      // Since passwordHash is undefined, requiresPassword should be true
      expect(found!.requiresPassword).toBe(true);
    });

    it('applies transform on getAll', async () => {
      await repo.create({
        name: 'Grace',
        email: 'grace@example.com',
        gender: 'female',
        ageGroup: 'adult',
        role: 'member',
        color: '#456',
        requiresPassword: false,
      });

      const all = await repo.getAll();
      expect(all).toHaveLength(1);
      // Transform should have applied
      expect(all[0]!.requiresPassword).toBe(true);
    });
  });

  describe('undefined value handling', () => {
    it('create() strips undefined values instead of passing them to Automerge', async () => {
      // Reproduces the real bug: TransactionModal passes { monthOfYear: undefined }
      // for non-yearly recurring items. Automerge rejects undefined values with:
      // "Cannot assign undefined value at /recurringItems/.../monthOfYear"
      const recurringRepo = createAutomergeRepository<
        'recurringItems',
        import('@/types/models').RecurringItem
      >('recurringItems');

      const item = await recurringRepo.create({
        accountId: 'acc-1',
        type: 'expense',
        amount: 100,
        currency: 'USD',
        category: 'utilities',
        description: 'Electric bill',
        frequency: 'monthly',
        dayOfMonth: 15,
        monthOfYear: undefined, // ← This is what the UI sends for non-yearly items
        startDate: '2026-01-15',
        endDate: undefined,
        lastProcessedDate: undefined,
        isActive: true,
      } as any);

      expect(item.id).toBeDefined();
      expect(item.description).toBe('Electric bill');
      // undefined fields should NOT be present on the stored entity
      const stored = projGetById('recurringItems', item.id) as unknown as Record<string, unknown>;
      expect(stored).toBeDefined();
      expect('monthOfYear' in stored).toBe(false);
    });

    it('update() strips undefined values instead of passing them to Automerge', async () => {
      const recurringRepo = createAutomergeRepository<
        'recurringItems',
        import('@/types/models').RecurringItem
      >('recurringItems');

      const item = await recurringRepo.create({
        accountId: 'acc-1',
        type: 'expense',
        amount: 50,
        currency: 'USD',
        category: 'food',
        description: 'Groceries',
        frequency: 'monthly',
        dayOfMonth: 1,
        startDate: '2026-01-01',
        isActive: true,
      } as any);

      // Update with an undefined field — should not throw
      const updated = await recurringRepo.update(item.id, {
        monthOfYear: undefined,
        description: 'Updated groceries',
      } as any);

      expect(updated).toBeDefined();
      expect(updated!.description).toBe('Updated groceries');
    });
  });

  describe('batch helpers', () => {
    const todoRepo = createAutomergeRepository<'todos', import('@/types/models').TodoItem>('todos');
    const input = (title: string) => ({ title, completed: false, createdBy: 'm-1' });

    it('createManyWithIds stamps each entity like createWithId, in one write', async () => {
      const created = await todoRepo.createManyWithIds([
        { id: 'td-1', input: input('Sign slip') },
        { id: 'td-2', input: { ...input('Pay fee'), description: undefined } },
      ]);

      expect(created.map((t) => t.id)).toEqual(['td-1', 'td-2']);
      for (const t of created) {
        expect(t.createdAt).toBeDefined();
        expect(t.updatedAt).toBe(t.createdAt);
      }
      const stored = projGetById('todos', 'td-2') as unknown as Record<string, unknown>;
      expect(stored.title).toBe('Pay fee');
      expect('description' in stored).toBe(false); // undefined stripped, as createWithId does
    });

    it('createManyWithIds retried with the same ids does not duplicate', async () => {
      const batch = [
        { id: 'td-1', input: input('Sign slip') },
        { id: 'td-2', input: input('Pay fee') },
      ];
      await todoRepo.createManyWithIds(batch);
      await todoRepo.createManyWithIds(batch);

      expect(await todoRepo.getAll()).toHaveLength(2);
    });

    it('createManyWithIds with no items writes nothing', async () => {
      expect(await todoRepo.createManyWithIds([])).toEqual([]);
      expect(await todoRepo.getAll()).toEqual([]);
    });

    it('patchMany patches every present id and skips a missing one', async () => {
      await todoRepo.createManyWithIds([
        { id: 'td-1', input: input('Sign slip') },
        { id: 'td-2', input: input('Pay fee') },
      ]);

      const patched = await todoRepo.patchMany(
        ['td-1', 'gone', 'td-2'],
        { activityId: 'act-1' },
        { onMissing: 'skip' }
      );

      expect(patched.map((t) => t.id)).toEqual(['td-1', 'td-2']);
      expect(patched.every((t) => t.activityId === 'act-1')).toBe(true);
      expect(await todoRepo.getById('gone')).toBeUndefined(); // not created by the skip
      const stored = await todoRepo.getById('td-1');
      expect(stored!.activityId).toBe('act-1');
      expect(stored!.title).toBe('Sign slip'); // untouched fields survive
    });

    it('patchMany deletes a key explicitly set to undefined, like update', async () => {
      await todoRepo.createManyWithIds([
        { id: 'td-1', input: { ...input('Sign slip'), activityId: 'act-1' } },
        { id: 'td-2', input: { ...input('Pay fee'), activityId: 'act-1' } },
      ]);

      const patched = await todoRepo.patchMany(
        ['td-1', 'td-2'],
        { activityId: undefined },
        { onMissing: 'skip' }
      );

      expect(patched).toHaveLength(2);
      for (const id of ['td-1', 'td-2']) {
        const stored = projGetById('todos', id) as unknown as Record<string, unknown>;
        expect('activityId' in stored).toBe(false);
        expect(stored.title).toBeDefined(); // absent keys untouched
      }
    });

    it('patchMany sends each id its own base', async () => {
      await todoRepo.createManyWithIds([
        { id: 'td-1', input: { ...input('Sign slip'), activityId: 'act-old' } },
        { id: 'td-2', input: input('Pay fee') },
      ]);
      const sent = recordMutations();

      await todoRepo.patchMany(
        ['td-1', 'td-2', 'gone'],
        { activityId: 'act-1' },
        { onMissing: 'skip' }
      );

      expect(patchOpsIn(sent).map((op) => [op.id, op.base])).toEqual([
        ['td-1', { activityId: 'act-old' }],
        ['td-2', {}],
        ['gone', {}],
      ]);
    });

    it('createManyWithIds({ ifAbsent }) never overwrites a projected id and returns only the created', async () => {
      await todoRepo.createManyWithIds([{ id: 'td-1', input: input('Peer made this') }]);
      await todoRepo.patchMany(['td-1'], { description: 'peer note' }, { onMissing: 'skip' });
      const sent = recordMutations();

      const created = await todoRepo.createManyWithIds(
        [
          { id: 'td-1', input: input('Mine') },
          { id: 'td-2', input: input('Pay fee') },
        ],
        { ifAbsent: true }
      );

      expect(created.map((t) => t.id)).toEqual(['td-2']);
      const kept = await todoRepo.getById('td-1');
      expect(kept!.title).toBe('Peer made this');
      expect(kept!.description).toBe('peer note');
      // Only the absent id travelled in the write.
      const batch = sent.find((op) => op.op === 'batch') as Extract<
        (typeof sent)[number],
        { op: 'batch' }
      >;
      expect(batch.ops.map((op) => (op as { id: string }).id)).toEqual(['td-2']);
    });

    it('createManyWithIds({ ifAbsent }) with every id present writes nothing', async () => {
      await todoRepo.createManyWithIds([{ id: 'td-1', input: input('Sign slip') }]);
      const sent = recordMutations();

      expect(
        await todoRepo.createManyWithIds([{ id: 'td-1', input: input('Mine') }], { ifAbsent: true })
      ).toEqual([]);
      expect(sent).toEqual([]);
    });

    it('patchEach writes a different patch per id in one change and skips a missing id', async () => {
      await todoRepo.createManyWithIds([
        { id: 'td-1', input: { ...input('Sign slip'), activityId: 'act-1' } },
        { id: 'td-2', input: input('Pay fee') },
      ]);
      const sent = recordMutations();

      const patched = await todoRepo.patchEach(
        [
          { id: 'td-1', patch: { dueDate: '2026-10-14', activityId: undefined } },
          { id: 'gone', patch: { dueDate: '2026-10-15' } },
          { id: 'td-2', patch: { title: 'Pay the fee' } },
        ],
        { onMissing: 'skip' }
      );

      // ONE batch, one op per item, each with its own patch, deleteKeys and base.
      expect(sent.filter((op) => op.op === 'batch')).toHaveLength(1);
      expect(patchOpsIn(sent).map((op) => [op.id, op.patch, op.deleteKeys, op.base])).toEqual([
        ['td-1', { dueDate: '2026-10-14' }, ['activityId'], {}],
        ['gone', { dueDate: '2026-10-15' }, [], {}],
        ['td-2', { title: 'Pay the fee' }, [], { title: 'Pay fee' }],
      ]);
      expect(patched.map((t) => t.id)).toEqual(['td-1', 'td-2']);
      const one = projGetById('todos', 'td-1') as unknown as Record<string, unknown>;
      expect(one.dueDate).toBe('2026-10-14');
      expect('activityId' in one).toBe(false); // cleared on td-1 only
      expect(one.title).toBe('Sign slip');
      expect((await todoRepo.getById('td-2'))!.title).toBe('Pay the fee');
      expect(await todoRepo.getById('gone')).toBeUndefined();
    });

    it('patchEach with no items writes nothing', async () => {
      const sent = recordMutations();
      expect(await todoRepo.patchEach([], { onMissing: 'skip' })).toEqual([]);
      expect(sent).toEqual([]);
    });

    it('patchEach keeps a concurrent change to another key, and to another item of the same array', async () => {
      await todoRepo.createManyWithIds([
        { id: 'td-1', input: { ...input('Trash night'), assigneeIds: ['m-1', 'm-2'] } },
      ]);

      // Both writes are built from the same state; the peer's lands first. patchEach's base is
      // the pre-peer state, so the worker reconciles three-way instead of reverting the peer.
      await Promise.all([
        todoRepo.update('td-1', { title: 'Peer title', assigneeIds: ['m-1', 'm-2', 'm-3'] }),
        todoRepo.patchEach(
          [{ id: 'td-1', patch: { dueDate: '2026-10-14', assigneeIds: ['m-1'] } }],
          { onMissing: 'skip' }
        ),
      ]);

      const stored = projGetById('todos', 'td-1') as unknown as Record<string, unknown>;
      expect(stored.title).toBe('Peer title'); // another key: untouched
      expect(stored.dueDate).toBe('2026-10-14');
      expect(stored.assigneeIds).toEqual(['m-1', 'm-3']); // peer's add kept, our removal applied
    });

    it('removeMany deletes present ids and ignores a missing one', async () => {
      await todoRepo.createManyWithIds([
        { id: 'td-1', input: input('Sign slip') },
        { id: 'td-2', input: input('Pay fee') },
        { id: 'td-3', input: input('Pack bag') },
      ]);

      await expect(todoRepo.removeMany(['td-1', 'gone', 'td-3'])).resolves.toBeUndefined();

      expect((await todoRepo.getAll()).map((t) => t.id)).toEqual(['td-2']);
    });
  });

  describe('goals are born with manualContributions: [] (#117 Phase 2)', () => {
    const goalRepo = createAutomergeRepository<'goals', import('@/types/models').Goal>('goals');
    const goal = {
      name: 'Holiday',
      type: 'savings',
      targetAmount: 1000,
      currentAmount: 0,
      currency: 'USD',
      priority: 'medium',
      isCompleted: false,
    } as any;

    it('create seeds an empty history so two first contributions both keep their row', async () => {
      const created = await goalRepo.create(goal);
      const stored = projGetById('goals', created.id) as unknown as Record<string, unknown>;
      expect(stored.manualContributions).toEqual([]);
    });

    it('keeps a history the input already carries', async () => {
      const entry = { id: 'c-1', amount: 5, date: '2026-10-03', author: 'm-1' };
      const created = await goalRepo.create({ ...goal, manualContributions: [entry] });
      expect(projGetById('goals', created.id)!.manualContributions).toEqual([entry]);
    });
  });

  describe('photo hosts are born with photoIds: [] (#117)', () => {
    const recipeRepo = createAutomergeRepository<'recipes', import('@/types/models').Recipe>(
      'recipes'
    );
    const recipe = { name: 'Soup', ingredients: ['salt'], steps: [] } as any;

    it('create and createManyWithIds seed photoIds on a flat photo host', async () => {
      const one = await recipeRepo.create(recipe);
      const [two] = await recipeRepo.createManyWithIds([{ id: 'rc-2', input: recipe }]);

      for (const id of [one.id, two!.id]) {
        const stored = projGetById('recipes', id) as unknown as Record<string, unknown>;
        expect(stored.photoIds).toEqual([]);
      }
    });

    it('keeps photoIds the input already carries', async () => {
      const created = await recipeRepo.create({ ...recipe, photoIds: ['ph-1'] });
      expect(projGetById('recipes', created.id)!.photoIds).toEqual(['ph-1']);
    });

    it('does not seed photoIds on a collection that is not a flat photo host', async () => {
      const accountRepo = createAutomergeRepository<'accounts', import('@/types/models').Account>(
        'accounts'
      );
      const account = await accountRepo.create({
        memberId: 'm-1',
        name: 'Checking',
        type: 'checking',
        currency: 'USD',
        balance: 0,
        isActive: true,
        includeInNetWorth: true,
      } as any);
      // familyMembers (avatar hooks) is registered but is not a flat host either.
      const member = await repo.create({
        name: 'Ivy',
        email: 'ivy@example.com',
        gender: 'female',
        ageGroup: 'adult',
        role: 'member',
        color: '#ABC',
        requiresPassword: false,
      });

      expect('photoIds' in (projGetById('accounts', account.id) as object)).toBe(false);
      expect('photoIds' in (projGetById('familyMembers', member.id) as object)).toBe(false);
    });
  });

  // CRDT-merge behaviour now lives in the doc layer (worker) — covered by
  // worker/__tests__/{docOps,applyAndProject}.test.ts (mergeDocs + the
  // mergeRemoteEnvelope round-trip). The repository is a thin projection/RPC
  // adapter and no longer owns merge.
});
