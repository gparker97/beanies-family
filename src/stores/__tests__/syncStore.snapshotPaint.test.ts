/**
 * A projection-snapshot hit paints WITHOUT waiting on a document write (2026-11-15).
 *
 * The snapshot fills the stores before the worker holds a document; every `mutate` queues
 * behind the `initAndLoadCache` rebuild in the serial worker FIFO. Five store loaders awaited a
 * write inside their load, so `reloadAllStores` (and the paint behind it) waited 5 to 70 s for
 * the whole rebuild. Here the REAL stores run against the REAL docClient over the inline bridge,
 * with a worker whose `mutate` and `initAndLoadCache` do not answer until the test lets the
 * rebuild land, and a snapshot seeded so that every known load-time writer wants to write.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { GlobalSettings } from '@/types/models';

const mockGlobalSettings: GlobalSettings = {
  id: 'global_settings',
  theme: 'system',
  language: 'en',
  lastActiveFamilyId: null,
  exchangeRates: [],
  exchangeRateAutoUpdate: true,
  exchangeRateLastFetch: null,
  isTrustedDevice: false,
  trustedDevicePromptShown: false,
};

vi.mock('@/services/indexeddb/repositories/globalSettingsRepository', () => ({
  getDefaultGlobalSettings: () => ({ ...mockGlobalSettings }),
  getGlobalSettings: vi.fn(async () => ({ ...mockGlobalSettings })),
  saveGlobalSettings: vi.fn(async (p: Partial<GlobalSettings>) => ({
    ...mockGlobalSettings,
    ...p,
  })),
  setGlobalTheme: vi.fn(),
  setGlobalLanguage: vi.fn(),
  setLastActiveFamilyId: vi.fn(),
  updateGlobalExchangeRates: vi.fn(),
}));
vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => ({ activeFamilyId: 'family-123', activeFamilyName: 'Test Family' }),
}));
vi.mock('@/services/indexeddb/database', () => ({
  getActiveFamilyId: vi.fn(() => 'family-123'),
  getDatabase: vi.fn(async () => ({})),
  closeDatabase: vi.fn(async () => {}),
}));
vi.mock('@/services/registry/registryService', () => ({
  addRegistryEntryObserver: () => () => {},
  registerFamily: vi.fn(async () => {}),
  registerFamilyOrThrow: vi.fn(async () => {}),
  removeFamily: vi.fn(async () => {}),
  lookupFamily: vi.fn(async () => null),
}));
vi.mock('@/services/sync/capabilities', () => ({
  getSyncCapabilities: () => ({ hasFileSystemAccess: true }),
  canAutoSync: () => true,
  supportsFileSystemAccess: () => true,
  isNative: () => false,
}));
vi.mock('@/services/sync/syncService', async () => ({
  ...(await import('../../services/sync/__mocks__/syncService')),
}));
// Observed: the `open-snapshot` "authoritative landed" detail is asserted below.
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
// Pass-through spies, so a test can fail ONE snapshot-phase read for real (through `wrapAsync`).
vi.mock('@/services/automerge/repositories/listRepository', async (orig) => {
  const real = await orig<typeof import('@/services/automerge/repositories/listRepository')>();
  return { ...real, getAllLists: vi.fn(real.getAllLists) };
});
vi.mock('@/services/automerge/repositories/listCycleRepository', async (orig) => {
  const real = await orig<typeof import('@/services/automerge/repositories/listCycleRepository')>();
  return { ...real, getAllCycles: vi.fn(real.getAllCycles) };
});

import { installInlineBackend } from '@/services/automerge/worker/__tests__/inlineHarness';
import { inlineExecutor } from '@/services/automerge/worker/inlineBridge';
import { setInlineExecutor, mutate } from '@/services/automerge/worker/docClient';
import {
  applyChunk,
  bumpDocVersion,
  getSettings,
  list as projectionList,
  resetProjection,
} from '@/services/automerge/projection';
import {
  __resetLoadMaintenanceForTesting,
  __whenLoadMaintenanceIdleForTesting,
  clearStoresAuthoritative,
  registerLoadMaintenance,
  storesAuthoritative,
} from '@/services/automerge/loadMaintenance';
import { logEvent } from '@/services/telemetry/logEvent';
import { getAllLists } from '@/services/automerge/repositories/listRepository';
import { getAllCycles } from '@/services/automerge/repositories/listCycleRepository';
import { getById as projectionGetById, markAuthoritative } from '@/services/automerge/projection';
import { COLLECTION_NAMES, type CollectionName } from '@/types/automerge';
import type {
  MutationOp,
  ProjectionDelta,
  DispatchReply,
} from '@/services/automerge/worker/protocol';
import { shiftChoreDay } from '@/utils/chores';
import { seedEntities, STAR_SETTINGS, today } from './loadTimeWriterFixtures';
import { CHORE_MARK_SWEEP_KEY } from '@/utils/cycleSweepClock';
import { useSyncStore } from '../syncStore';
import { useListStore } from '../listStore';
import { useTodoStore } from '../todoStore';
import { useChoreStore } from '../choreStore';
import { useFamilyStore } from '../familyStore';
import { useAssetsStore } from '../assetsStore';
import { useNotificationsStore } from '../notificationsStore';

const KEY_B64 = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
/** The projection as full bulk-reset deltas, as `pushProjection` would stream it. */
function deltasFor(
  entities: Array<[CollectionName, Record<string, unknown>]>,
  settings: unknown
): ProjectionDelta[] {
  const by = new Map<CollectionName, Array<[string, unknown]>>();
  for (const name of COLLECTION_NAMES) by.set(name, []);
  for (const [c, e] of entities) by.get(c)!.push([e.id as string, e]);
  return [
    ...[...by].map(([collection, rows]): ProjectionDelta => ({
      kind: 'bulk',
      collection,
      reset: true,
      entities: rows,
    })),
    { kind: 'settings', settings },
  ];
}

function push(deltas: ProjectionDelta[]): void {
  for (const d of deltas) applyChunk(d);
  bumpDocVersion();
}

function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** Every op id a write named, flattened through batches. */
function idsIn(op: MutationOp): string[] {
  if (op.op === 'batch') return op.ops.flatMap(idsIn);
  if (op.op === 'named') return [JSON.stringify(op.args)];
  if (op.op === 'set') return [op.id, JSON.stringify(op.entity)];
  return 'id' in op ? [op.id] : [];
}

interface Harness {
  sent: MutationOp[];
  land: () => void;
  authDeltas: ProjectionDelta[];
}

/**
 * Seed the worker's REAL document with the authoritative data, then put the main thread in the
 * state a cold open is in before the snapshot: an empty projection, nothing authoritative, and a
 * worker that answers `loadProjectionSnapshot` at once but holds `initAndLoadCache` (and every
 * `mutate` queued behind it) until `land()`.
 */
async function arm(
  opts: { projected?: boolean; snapshot?: 'auth' | 'snap' } = {}
): Promise<Harness> {
  const projected = opts.projected ?? true;
  await installInlineBackend();
  for (const [collection, entity] of seedEntities('auth')) {
    await mutate({ op: 'set', collection, id: entity.id as string, entity });
  }
  await mutate({ op: 'named', name: 'patchSettings', args: { patch: { ...STAR_SETTINGS } } });
  const authEntities = COLLECTION_NAMES.flatMap((c) =>
    projectionList(c).map(
      (e) => [c, e as Record<string, unknown>] as [CollectionName, Record<string, unknown>]
    )
  );
  const authDeltas = deltasFor(authEntities, getSettings());
  const snapDeltas = deltasFor(seedEntities(opts.snapshot ?? 'snap'), getSettings());
  resetProjection();
  clearStoresAuthoritative();

  const sent: MutationOp[] = [];
  const landed = deferred();
  setInlineExecutor(async (method, args): Promise<DispatchReply> => {
    switch (method) {
      case 'setFamilyKey':
        return {};
      case 'loadProjectionSnapshot':
        push(snapDeltas);
        return { result: { hit: true } };
      case 'initAndLoadCache':
        await landed.promise;
        // `projected: false`: the worker saw the snapshot's heads and build, and pushed nothing.
        if (projected) push(authDeltas);
        return { result: { loaded: true, remoteBaseline: null, projected } };
      case 'readEnvelope':
        return {
          result: {
            envelope: {
              version: '4.0',
              familyId: 'family-123',
              familyName: 'Test Family',
              keyId: 'k',
              wrappedKeys: {},
              passkeyWrappedKeys: {},
              inviteKeys: {},
            },
          },
        };
      case 'mutate':
        sent.push(structuredClone(args) as MutationOp);
        await landed.promise; // the serial FIFO: behind the rebuild
        return inlineExecutor(method, args);
      default:
        return inlineExecutor(method, args);
    }
  });
  return { sent, land: () => landed.resolve(), authDeltas };
}

describe('snapshot paint never waits on a write', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    __resetLoadMaintenanceForTesting();
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it('paints from the snapshot with every writer due, then each writer runs once on the authoritative data', async () => {
    const h = await arm();
    // The chore sweep cursor was last advanced yesterday, so today's sweep is due.
    localStorage.setItem(CHORE_MARK_SWEEP_KEY, shiftChoreDay(useChoreStore().todayYmd, -1));
    const onEarlyPaint = vi.fn();

    const open = useSyncStore().loadFromPersistenceCache(KEY_B64, 'family-123', {
      preservePermissionState: true,
      onEarlyPaint,
    });

    // The paint lands while the rebuild (and every write behind it) is still hung.
    await vi.waitFor(() => expect(onEarlyPaint).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(h.sent).toEqual([]);
    expect(storesAuthoritative.value).toBe(false);
    // The stores hold the SNAPSHOT, and the roster is normalised in memory: no ownerless or
    // admin-role roster is ever published, although nothing was written.
    expect(useListStore().lists.map((l) => l.id)).toEqual(['list-snap']);
    expect(useFamilyStore().members.find((m) => m.id === 'admin-snap')).toMatchObject({
      role: 'member',
      canManagePod: true,
    });

    h.land();
    await expect(open).resolves.toEqual({ success: true });
    await vi.waitFor(() => expect(storesAuthoritative.value).toBe(true));

    // Each writer ran on the authoritative data. Wait for the last one in registration order.
    await vi.waitFor(
      () => {
        const ids = h.sent.flatMap(idsIn).join(' ');
        expect(ids).toContain('list-auth');
        expect(ids).toContain('todo-auth');
        expect(ids).toContain('c-auth');
        expect(ids).toContain('admin-auth');
        expect(ids).toContain('asset-auth');
        expect(ids).toContain('kid-auth:'); // the stars week close (#148)
      },
      { timeout: 3000 }
    );
    const all = h.sent.flatMap(idsIn).join(' ');
    expect(all).not.toMatch(/-snap/);

    // ...and each exactly once.
    const count = (needle: string) =>
      h.sent.filter((op) => idsIn(op).join(' ').includes(needle)).length;
    expect(count('list-auth')).toBe(1);
    expect(count('todo-auth')).toBe(1);
    expect(count('c-auth')).toBe(1);
    expect(count('admin-auth')).toBe(1);
    expect(count('asset-auth')).toBe(1);
    expect(count('kid-auth:')).toBe(1);

    // The stores now show the authoritative, maintained data.
    expect(useListStore().lists.find((l) => l.id === 'list-auth')?.items[0]?.completed).toBe(false);
    expect((useTodoStore().todos.find((t) => t.id === 'todo-auth')?.dueDate ?? '') >= today).toBe(
      true
    );
    expect(useAssetsStore().assets.map((a) => a.id)).toEqual(['asset-auth']);
  });

  it("a daily list holding yesterday's ticks raises no list-completed bell before the reset", async () => {
    const h = await arm();
    const onEarlyPaint = vi.fn();
    void useSyncStore().loadFromPersistenceCache(KEY_B64, 'family-123', {
      preservePermissionState: true,
      onEarlyPaint,
    });
    await vi.waitFor(() => expect(onEarlyPaint).toHaveBeenCalled(), { timeout: 3000 });
    // The snapshot list is fully ticked from yesterday and not yet reset.
    const shown = useListStore().lists.find((l) => l.id === 'list-snap');
    expect(shown?.items.every((i) => i.completed)).toBe(true);
    expect(storesAuthoritative.value).toBe(false);
    expect(useNotificationsStore().notifications.some((n) => n.kind === 'list-completed')).toBe(
      false
    );
    h.land();
  });

  it('a mark-read tap during the rebuild is queued and lands, never dropped', async () => {
    const h = await arm();
    const onEarlyPaint = vi.fn();
    const open = useSyncStore().loadFromPersistenceCache(KEY_B64, 'family-123', {
      preservePermissionState: true,
      onEarlyPaint,
    });
    await vi.waitFor(() => expect(onEarlyPaint).toHaveBeenCalled(), { timeout: 3000 });
    expect(useFamilyStore().currentMember?.id).toBe('owner');

    useNotificationsStore().markRead('whats-new:2026.01.01');
    await vi.waitFor(() =>
      expect(h.sent.some((op) => op.op === 'patch' && op.collection === 'notificationReads')).toBe(
        true
      )
    );

    h.land();
    await open;
    await vi.waitFor(() =>
      expect(projectionGetById('notificationReads', 'owner')).toHaveProperty([
        'whats-new:2026.01.01',
      ])
    );
  });

  it('when the rebuild pushed nothing (same heads, same build), the stores are not reloaded again; maintenance still runs', async () => {
    const h = await arm({ projected: false, snapshot: 'auth' });
    const lists = useListStore();
    const loadLists = vi.spyOn(lists, 'loadLists');
    const onEarlyPaint = vi.fn();

    const open = useSyncStore().loadFromPersistenceCache(KEY_B64, 'family-123', {
      preservePermissionState: true,
      onEarlyPaint,
    });
    await vi.waitFor(() => expect(onEarlyPaint).toHaveBeenCalled(), { timeout: 3000 });
    h.land();
    await expect(open).resolves.toEqual({ success: true });

    expect(loadLists).toHaveBeenCalledTimes(1); // the snapshot reload only
    await vi.waitFor(() => expect(h.sent.flatMap(idsIn).join(' ')).toContain('list-auth'), {
      timeout: 3000,
    });
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'open-snapshot',
        message: 'authoritative landed, snapshot superseded',
        context: { detail: 'repaint=skipped' },
      })
    );
  });

  // Any loader failure counts, whatever ref it reports through: the list store's `error`, and
  // the cycle history's own `cyclesError` (which a sweep of `error` refs alone missed).
  it.each<[string, () => void]>([
    ['error', () => vi.mocked(getAllLists).mockRejectedValueOnce(new Error('lists unreadable'))],
    [
      'cyclesError',
      () => vi.mocked(getAllCycles).mockRejectedValueOnce(new Error('cycles unreadable')),
    ],
  ])(
    'repaints in full when a snapshot-phase loader failed (via %s), even with nothing pushed',
    async (_ref, failOnce) => {
      const h = await arm({ projected: false, snapshot: 'auth' });
      const lists = useListStore();
      const loadLists = vi.spyOn(lists, 'loadLists');
      failOnce(); // the snapshot-phase read fails; the retry reads normally
      vi.mocked(logEvent).mockClear();
      const onEarlyPaint = vi.fn();
      const open = useSyncStore().loadFromPersistenceCache(KEY_B64, 'family-123', {
        preservePermissionState: true,
        onEarlyPaint,
      });
      await vi.waitFor(() => expect(onEarlyPaint).toHaveBeenCalled(), { timeout: 3000 });
      h.land();
      await open;
      expect(loadLists).toHaveBeenCalledTimes(2); // retried by the second, full reload
      expect(lists.error).toBeNull(); // the retry cleared it...
      expect(lists.cyclesLoaded).toBe(true); // ...and read the history the first pass lost
      expect(logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ context: { detail: 'repaint=full' } })
      );
    }
  );
});

describe('reloadAllStores and load maintenance', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    __resetLoadMaintenanceForTesting();
    await installInlineBackend(); // an authoritative (empty) document
  });

  it('never runs maintenance when the flag flips while a snapshot-phase reload is awaiting', async () => {
    resetProjection(); // a snapshot state: nothing authoritative
    clearStoresAuthoritative();
    push(deltasFor(seedEntities('snap'), null));
    const task = vi.fn(async () => {});
    const sync = useSyncStore();
    registerLoadMaintenance('spy', task);

    const reload = sync.reloadAllStores();
    markAuthoritative(); // the rebuild installs mid-reload (docClient.ts noteDocInstalled)
    await reload;
    await __whenLoadMaintenanceIdleForTesting();

    expect(task).not.toHaveBeenCalled();
    expect(storesAuthoritative.value).toBe(false);

    // The NEXT reload began authoritative: now it runs, once.
    await sync.reloadAllStores();
    await __whenLoadMaintenanceIdleForTesting();
    expect(task).toHaveBeenCalledTimes(1);
    expect(storesAuthoritative.value).toBe(true);
  });

  it('resolves before a slow maintenance task finishes (path 1b lifts the skeleton first)', async () => {
    const sync = useSyncStore();
    let finish!: () => void;
    const task = vi.fn(() => new Promise<void>((r) => (finish = r)));
    registerLoadMaintenance('slow-recurring', task);

    await sync.reloadAllStores();

    expect(task).toHaveBeenCalledTimes(1); // started...
    let idle = false;
    void __whenLoadMaintenanceIdleForTesting().then(() => (idle = true));
    await Promise.resolve();
    expect(idle).toBe(false); // ...and still running after the reload resolved
    finish();
    await __whenLoadMaintenanceIdleForTesting();
  });
});

/**
 * The other half of an instant open: once the cache has painted, the Drive file is still read
 * in the BACKGROUND, so the data is made recent without the paint waiting on it. That hand-off
 * lives in App.vue's `loadFamilyData` (path 1a), which no unit test mounts, so this is a
 * source-level pin of the wiring, in the style of `lineageBanner.test.ts`. The read itself
 * (skip, probe, merge) is pinned in `fetchAndMergeRemote.test.ts` and
 * `syncStore.openBaselineTerminus.test.ts`.
 */
describe('App.vue path 1a: the Drive read runs after the cache paint, never awaited by it', () => {
  const block = async (): Promise<string> => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const app = fs.readFileSync(path.resolve(__dirname, '../../..', 'src/App.vue'), 'utf8');
    const start = app.indexOf("setOpenPath('path1a')");
    const end = app.indexOf("setOpenPath('path1b')", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return app.slice(start, end);
  };

  it('hands off to backgroundSyncFromFile after a cache hit, fire-and-forget', async () => {
    const code = await block();
    const paint = code.indexOf('syncStore.loadFromPersistenceCache(');
    const read = code.indexOf(
      'syncStore.backgroundSyncFromFile({ token: openToken, releaseHold })'
    );
    expect(paint).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(paint); // after the paint, on the success branch
    expect(code).not.toMatch(/await\s+syncStore\.backgroundSyncFromFile/); // never awaited
    expect(code.indexOf("return 'handed-off'")).toBeGreaterThan(read);
  });

  it('holds load maintenance for that read, hands its release over with the token, and releases on every other exit', async () => {
    const code = await block();
    expect(code.indexOf('const releaseHold = holdLoadMaintenance()')).toBeGreaterThan(-1);
    expect(code.indexOf('holdLoadMaintenance()')).toBeLessThan(
      code.indexOf('syncStore.loadFromPersistenceCache(')
    );
    expect(code).toMatch(/finally\s*\{\s*if \(!handedOff\) releaseHold\(\);/);
  });
});
