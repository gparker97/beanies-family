import { describe, it, expect, vi } from 'vitest';
import { effectScope } from 'vue';
import { useEagerEntityCreate } from '../useEagerEntityCreate';

interface FakeEntity {
  id: string;
  title: string;
}

interface FakePayload {
  title: string;
}

interface HarnessOverrides {
  resolveExistingId?: () => string | null;
  firstMissingField?: () => string | null;
  buildPayload?: () => FakePayload;
  create?: (payload: FakePayload) => Promise<FakeEntity | null>;
  update?: (id: string, payload: Partial<FakePayload>) => Promise<FakeEntity | null>;
}

function makeHarness(overrides: HarnessOverrides = {}) {
  const create = vi.fn(overrides.create ?? (async () => ({ id: 'new-id', title: 'X' })));
  const update = vi.fn(overrides.update ?? (async (id: string) => ({ id, title: 'X' })));

  const scope = effectScope();
  const api = scope.run(() =>
    useEagerEntityCreate<FakeEntity, FakePayload>({
      resolveExistingId: overrides.resolveExistingId ?? (() => null),
      firstMissingField: overrides.firstMissingField ?? (() => null),
      buildPayload: overrides.buildPayload ?? (() => ({ title: 'X' })),
      create,
      update,
    })
  )!;

  return { api, create, update, scope };
}

describe('useEagerEntityCreate', () => {
  it('entityId returns the existing id when present and never calls create', async () => {
    const { api, create } = makeHarness({ resolveExistingId: () => 'existing-id' });

    expect(api.entityId.value).toBe('existing-id');
    const id = await api.ensureId();

    expect(id).toBe('existing-id');
    expect(create).not.toHaveBeenCalled();
    expect(api.wasEagerCreated.value).toBe(false);
  });

  it('ensureId returns null and skips create when the gate fails', async () => {
    const { api, create } = makeHarness({
      firstMissingField: () => 'title',
    });

    const id = await api.ensureId();

    expect(id).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('ensureId returns the eager-created id and caches it for subsequent calls', async () => {
    const { api, create } = makeHarness({
      create: async () => ({ id: 'eager-id', title: 'X' }),
    });

    const id1 = await api.ensureId();
    const id2 = await api.ensureId();

    expect(id1).toBe('eager-id');
    expect(id2).toBe('eager-id');
    expect(create).toHaveBeenCalledTimes(1);
    expect(api.entityId.value).toBe('eager-id');
    expect(api.wasEagerCreated.value).toBe(true);
  });

  it('ensureId returns null when the store-side create returns null', async () => {
    const { api, create } = makeHarness({
      create: async () => null,
    });

    const id = await api.ensureId();

    expect(id).toBeNull();
    expect(create).toHaveBeenCalledTimes(1);
    expect(api.entityId.value).toBeNull();
    expect(api.wasEagerCreated.value).toBe(false);
  });

  it('ensureId is re-entrant safe: parallel calls invoke create exactly once', async () => {
    let resolveCreate!: (value: FakeEntity) => void;
    const createPromise = new Promise<FakeEntity>((resolve) => {
      resolveCreate = resolve;
    });
    const { api, create } = makeHarness({
      create: () => createPromise,
    });

    const p1 = api.ensureId();
    const p2 = api.ensureId();

    resolveCreate({ id: 'eager-id', title: 'X' });
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(create).toHaveBeenCalledTimes(1);
    // First caller wins; second caller sees null (in-flight guard) — but
    // a subsequent call returns the now-cached id.
    expect(r1).toBe('eager-id');
    expect(r2).toBeNull();
    expect(await api.ensureId()).toBe('eager-id');
  });

  it('isCreating flips true while a create is in flight, then false afterward', async () => {
    let resolveCreate!: (value: FakeEntity) => void;
    const createPromise = new Promise<FakeEntity>((resolve) => {
      resolveCreate = resolve;
    });
    const { api } = makeHarness({ create: () => createPromise });

    const p = api.ensureId();
    expect(api.isCreating.value).toBe(true);

    resolveCreate({ id: 'eager-id', title: 'X' });
    await p;
    expect(api.isCreating.value).toBe(false);
  });

  it('commit calls update when entityId resolves to an existing id', async () => {
    const { api, create, update } = makeHarness({
      resolveExistingId: () => 'existing-id',
      buildPayload: () => ({ title: 'updated' }),
    });

    const result = await api.commit();

    expect(update).toHaveBeenCalledWith('existing-id', { title: 'updated' });
    expect(create).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 'existing-id', title: 'X' });
  });

  it('commit calls create when there is no existing or eager-created id', async () => {
    const { api, create, update } = makeHarness({
      buildPayload: () => ({ title: 'fresh' }),
    });

    await api.commit();

    expect(create).toHaveBeenCalledWith({ title: 'fresh' });
    expect(update).not.toHaveBeenCalled();
  });

  it('commit calls update after eager-create has fired', async () => {
    const { api, create, update } = makeHarness({
      create: async () => ({ id: 'eager-id', title: 'X' }),
      buildPayload: () => ({ title: 'final' }),
    });

    await api.ensureId();
    await api.commit();

    expect(create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith('eager-id', { title: 'final' });
  });

  it('commit returns null without calling create when gate fails (no existing id)', async () => {
    const { api, create, update } = makeHarness({
      firstMissingField: () => 'title',
    });

    const result = await api.commit();

    expect(result).toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('reset clears the eager-created id cache', async () => {
    const { api, create } = makeHarness({
      create: async () => ({ id: 'eager-id', title: 'X' }),
    });

    await api.ensureId();
    expect(api.entityId.value).toBe('eager-id');
    expect(api.wasEagerCreated.value).toBe(true);

    api.reset();
    expect(api.entityId.value).toBeNull();
    expect(api.wasEagerCreated.value).toBe(false);

    // After reset, ensureId should call create again (not return the stale id)
    await api.ensureId();
    expect(create).toHaveBeenCalledTimes(2);
  });
});
