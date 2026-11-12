/**
 * The served Counter-write policy on the main thread (#117 writer flip, Testing Plan item 6):
 * the boot hand-over from the persisted value, the registry observer handing over only a change,
 * the once-per-session `missing` warning, a refused write, and a corrupt record.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCALAR_READ_SINCE } from '@/constants/appVersion';
import { STORAGE_KEYS } from '@/constants/storageKeys';
import type { RegistryEntry } from '@/types/models';

const h = vi.hoisted(() => ({
  // Resolves like the real one: `true` = posted (or retained before a family key).
  applyDataPolicy: vi.fn(async (..._a: unknown[]): Promise<boolean> => true),
  logEvent: vi.fn(),
  observers: [] as Array<(e: RegistryEntry) => void>,
}));

vi.mock('@/services/automerge/worker/docClient', () => ({
  applyDataPolicy: h.applyDataPolicy,
}));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: h.logEvent }));
vi.mock('@/services/registry/registryService', () => ({
  addRegistryEntryObserver: (fn: (e: RegistryEntry) => void) => {
    h.observers.push(fn);
    return () => {
      h.observers = h.observers.filter((o) => o !== fn);
    };
  },
}));

import {
  __FLAGS_FOR_TESTING,
  __resetDataPolicyForTesting,
  installDataPolicy,
  persist,
  readPersisted,
} from '../dataPolicy';

const KEY = STORAGE_KEYS.COUNTER_WRITES;
const SKEY = STORAGE_KEYS.SCALAR_WRITES;
const COUNTER = __FLAGS_FOR_TESTING.find((f) => f.name === 'counterWrites')!;
const SCALAR = __FLAGS_FOR_TESTING.find((f) => f.name === 'scalarWrites')!;
const OPEN_FLOOR = SCALAR_READ_SINCE;
const CLOSED_FLOOR = '1.0.2';
const N = null;

function serve(dataPolicy: RegistryEntry['dataPolicy'], familyId: unknown = 'fam-1'): void {
  const entry = {
    familyId,
    provider: 'google_drive',
    updatedAt: '2026-10-04',
    ...(dataPolicy === undefined ? {} : { dataPolicy }),
  } as RegistryEntry;
  for (const o of h.observers) o(entry);
}

function eventsWith(action: string, surface = 'counter-policy') {
  return h.logEvent.mock.calls
    .map(
      (c) =>
        c[0] as {
          level: string;
          surface: string;
          context?: { action?: string; detail?: string };
        }
    )
    .filter((e) => e.surface === surface && e.context?.action === action);
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

/** A refused `localStorage` write, restored after each test (whatever its assertions did). */
let refuseWrites: { mockRestore: () => void } | null = null;
function refuseStorageWrites(error: Error): void {
  refuseWrites = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
    throw error;
  });
}

afterEach(() => {
  refuseWrites?.mockRestore();
  refuseWrites = null;
  __resetDataPolicyForTesting();
  vi.restoreAllMocks();
});

describe('dataPolicy: the boot hand-over', () => {
  it('hands null with source "default" when nothing was ever persisted', () => {
    installDataPolicy();
    expect(h.applyDataPolicy).toHaveBeenCalledTimes(1);
    expect(h.applyDataPolicy).toHaveBeenCalledWith({
      counterWrites: null,
      scalarWrites: null,
      scalarFamilies: [],
    });
  });

  it('hands the persisted value with source "persisted"', () => {
    localStorage.setItem(KEY, 'true');
    installDataPolicy();
    expect(h.applyDataPolicy).toHaveBeenCalledWith({
      counterWrites: true,
      scalarWrites: null,
      scalarFamilies: [],
    });
  });

  it('installs once: a second call neither re-hands nor adds a second observer', () => {
    installDataPolicy();
    installDataPolicy();
    expect(h.applyDataPolicy).toHaveBeenCalledTimes(1);
    expect(h.observers).toHaveLength(1);
  });
});

describe('dataPolicy: the registry observer', () => {
  it('persists and hands over a served value, then only on change', () => {
    installDataPolicy();
    h.applyDataPolicy.mockClear();

    serve({ counterWrites: true });
    expect(h.applyDataPolicy).toHaveBeenCalledWith({
      counterWrites: true,
      scalarWrites: null,
      scalarFamilies: [],
    });
    expect(localStorage.getItem(KEY)).toBe('true');

    serve({ counterWrites: true });
    expect(h.applyDataPolicy).toHaveBeenCalledTimes(1);

    serve({ counterWrites: false });
    expect(h.applyDataPolicy).toHaveBeenLastCalledWith({
      counterWrites: false,
      scalarWrites: null,
      scalarFamilies: [],
    });
    expect(h.applyDataPolicy).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(KEY)).toBe('false');
  });

  it('does not re-hand a served value equal to the persisted one', () => {
    localStorage.setItem(KEY, 'false');
    installDataPolicy();
    h.applyDataPolicy.mockClear();

    serve({ counterWrites: false });
    expect(h.applyDataPolicy).not.toHaveBeenCalled();
  });

  it('hands over a first served false even with nothing persisted (null to false is a change)', () => {
    installDataPolicy();
    h.applyDataPolicy.mockClear();

    serve({ counterWrites: false });
    expect(h.applyDataPolicy).toHaveBeenCalledWith({
      counterWrites: false,
      scalarWrites: null,
      scalarFamilies: [],
    });
  });

  it('warns `missing` once per session for a Lambda without dataPolicy, and keeps the value', () => {
    localStorage.setItem(KEY, 'true');
    installDataPolicy();
    h.applyDataPolicy.mockClear();

    serve(undefined);
    serve(undefined);

    const missing = eventsWith('missing');
    expect(missing).toHaveLength(1);
    expect(missing[0]!.level).toBe('warn');
    expect(h.applyDataPolicy).not.toHaveBeenCalled();
    expect(localStorage.getItem(KEY)).toBe('true');
  });
});

describe('dataPolicy: storage', () => {
  it('logs `persist_failed` with the storedJson error when the write is refused', () => {
    const error = new Error('QuotaExceededError');
    refuseStorageWrites(error);

    persist(COUNTER, true);

    const failed = eventsWith('persist_failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ level: 'warn', error });
  });

  it('still hands a served value over when persisting it is refused', () => {
    installDataPolicy();
    h.applyDataPolicy.mockClear();
    refuseStorageWrites(new Error('denied'));

    serve({ counterWrites: true });

    expect(h.applyDataPolicy).toHaveBeenCalledWith({
      counterWrites: true,
      scalarWrites: null,
      scalarFamilies: [],
    });
    expect(eventsWith('persist_failed')).toHaveLength(1);
  });

  it('treats a corrupt record as null, removes it and logs once', () => {
    localStorage.setItem(KEY, '{not json');

    expect(readPersisted(COUNTER)).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(eventsWith('persisted_invalid')).toHaveLength(1);

    // Removed, so the next read is a plain miss and logs nothing more.
    expect(readPersisted(COUNTER)).toBeNull();
    expect(eventsWith('persisted_invalid')).toHaveLength(1);
  });

  it('treats a non-boolean record as null and removes it', () => {
    localStorage.setItem(KEY, '"yes"');
    installDataPolicy();

    expect(h.applyDataPolicy).toHaveBeenCalledWith({
      counterWrites: null,
      scalarWrites: null,
      scalarFamilies: [],
    });
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(eventsWith('persisted_invalid')[0]).toMatchObject({
      context: { detail: 'not_boolean' },
    });
  });
});

function setFloor(v: string): void {
  localStorage.setItem(STORAGE_KEYS.UPDATE_FLOOR, JSON.stringify(v));
}

describe('dataPolicy: the scalarWrites row (floor-guarded)', () => {
  it('boots on a persisted scalar ON with the floor open, source "persisted"', () => {
    localStorage.setItem(SKEY, 'true');
    setFloor(OPEN_FLOOR);
    installDataPolicy();
    expect(h.applyDataPolicy).toHaveBeenCalledWith({
      counterWrites: N,
      scalarWrites: true,
      scalarFamilies: [],
    });
  });

  it('serves ON with the floor closed: persists the SERVED value, hands over false, logs held once', () => {
    setFloor(CLOSED_FLOOR);
    installDataPolicy();
    h.applyDataPolicy.mockClear();

    serve({ counterWrites: false, scalarWrites: true });
    serve({ counterWrites: false, scalarWrites: true });

    expect(localStorage.getItem(SKEY)).toBe('true');
    expect(h.applyDataPolicy).toHaveBeenCalledTimes(1);
    expect(h.applyDataPolicy).toHaveBeenCalledWith({
      counterWrites: false,
      scalarWrites: false,
      scalarFamilies: [],
    });
    const held = eventsWith('held', 'scalar-policy');
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({
      level: 'warn',
      context: {
        detail: `floor=${CLOSED_FLOOR},since=${SCALAR_READ_SINCE},verdict=closed,scope=fleet`,
      },
    });
  });

  it('a served rollback is visible on a held device and re-arms held for a re-flip', () => {
    setFloor(CLOSED_FLOOR);
    installDataPolicy();
    h.applyDataPolicy.mockClear();

    serve({ counterWrites: false, scalarWrites: true }); // held x1
    serve({ counterWrites: false, scalarWrites: false }); // rollback: effective unchanged (false)
    serve({ counterWrites: false, scalarWrites: true }); // re-flip: held x2

    expect(eventsWith('held', 'scalar-policy')).toHaveLength(2);
    const served = eventsWith('served_changed', 'scalar-policy');
    expect(served.map((e) => e.context?.detail)).toEqual([
      'served=true,scope=fleet',
      'served=false,scope=fleet',
      'served=true,scope=fleet',
    ]);
    // The effective value never moved (the floor is closed), so one boot hand-over is all.
    expect(h.applyDataPolicy).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(SKEY)).toBe('true');
  });

  it('reports verdict=unknown and floor=none when no floor was ever persisted', () => {
    installDataPolicy();
    serve({ counterWrites: false, scalarWrites: true });
    expect(eventsWith('held', 'scalar-policy')[0]).toMatchObject({
      context: { detail: `floor=none,since=${SCALAR_READ_SINCE},verdict=unknown,scope=fleet` },
    });
    expect(h.applyDataPolicy).toHaveBeenLastCalledWith({
      counterWrites: false,
      scalarWrites: false,
      scalarFamilies: [],
    });
  });

  it('opens the writer on the next GET once the floor lands, without a new served value', () => {
    setFloor(CLOSED_FLOOR);
    installDataPolicy();
    serve({ counterWrites: false, scalarWrites: true });
    h.applyDataPolicy.mockClear();

    serve({ counterWrites: false, scalarWrites: true });
    expect(h.applyDataPolicy).not.toHaveBeenCalled();

    setFloor(OPEN_FLOOR);
    serve({ counterWrites: false, scalarWrites: true });
    expect(h.applyDataPolicy).toHaveBeenCalledTimes(1);
    expect(h.applyDataPolicy).toHaveBeenCalledWith({
      counterWrites: false,
      scalarWrites: true,
      scalarFamilies: [],
    });
    expect(eventsWith('held', 'scalar-policy')).toHaveLength(1);
  });

  it('dedupes on effective values: a served flip that stays closed hands nothing over', () => {
    setFloor(CLOSED_FLOOR);
    installDataPolicy();
    serve({ counterWrites: false, scalarWrites: false });
    h.applyDataPolicy.mockClear();

    serve({ counterWrites: false, scalarWrites: true });
    expect(h.applyDataPolicy).not.toHaveBeenCalled();
    expect(localStorage.getItem(SKEY)).toBe('true');
  });

  it('hands both flags over in ONE call when both effective values change', () => {
    setFloor(OPEN_FLOOR);
    installDataPolicy();
    h.applyDataPolicy.mockClear();

    serve({ counterWrites: true, scalarWrites: true });
    expect(h.applyDataPolicy).toHaveBeenCalledTimes(1);
    expect(h.applyDataPolicy).toHaveBeenCalledWith({
      counterWrites: true,
      scalarWrites: true,
      scalarFamilies: [],
    });
  });

  it('logs applied on scalar-policy with on/served/source/floor', () => {
    setFloor(OPEN_FLOOR);
    installDataPolicy();
    serve({ counterWrites: false, scalarWrites: true });
    const applied = eventsWith('applied', 'scalar-policy');
    expect(applied.at(-1)?.context?.detail).toBe(
      `on=true,served=true,source=registry,floor=${OPEN_FLOOR},families=0`
    );
    // The counter row keeps its surface and shape, with no floor.
    expect(eventsWith('applied', 'counter-policy').at(-1)?.context?.detail).toBe(
      'on=false,served=false,source=registry,floor=none'
    );
  });

  it('warns `missing` for scalarWrites once per session when the Lambda omits it', () => {
    installDataPolicy();
    serve({ counterWrites: true });
    serve({ counterWrites: true });
    // The row's `missing` (no detail) and the family list's (`scope=family`) latch separately.
    const missing = eventsWith('missing', 'scalar-policy');
    expect(missing.filter((e) => e.context?.detail === undefined)).toHaveLength(1);
    expect(missing.filter((e) => e.context?.detail === 'scope=family')).toHaveLength(1);
    expect(eventsWith('missing', 'counter-policy')).toHaveLength(0);
  });

  it('removes a corrupt scalar record and warns once, per flag', () => {
    localStorage.setItem(SKEY, '"yes"');
    expect(readPersisted(SCALAR)).toBeNull();
    expect(localStorage.getItem(SKEY)).toBeNull();
    expect(eventsWith('persisted_invalid', 'scalar-policy')).toHaveLength(1);
    expect(eventsWith('persisted_invalid', 'counter-policy')).toHaveLength(0);
  });

  it('logs persist_failed on the scalar surface when the write is refused', () => {
    refuseStorageWrites(new Error('denied'));
    persist(SCALAR, true);
    expect(eventsWith('persist_failed', 'scalar-policy')).toHaveLength(1);
  });
});

describe('dataPolicy: the family list (#124 per-family canary)', () => {
  const OFF = { counterWrites: false, scalarWrites: false };
  /** A GET for `familyId` serving the family value `on` (both fleet flags off). */
  const serveFamily = (on: boolean, familyId: unknown = 'fam-1') =>
    serve({ ...OFF, scalarWritesFamily: on }, familyId);
  const handed = () =>
    (h.applyDataPolicy.mock.calls.at(-1)?.[0] as { scalarFamilies: string[] } | undefined)
      ?.scalarFamilies;
  const heldDetails = () => eventsWith('held', 'scalar-policy').map((e) => e.context?.detail ?? '');
  /** Let the hand-over's `.then` (the failed-post retry) run. */
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it('is session-only: boot hands over [] and never reads (or touches) an old stored list', () => {
    const OLD_KEY = 'beanies:scalarWritesFamilies'; // written by a dev build of the first draft
    localStorage.setItem(OLD_KEY, JSON.stringify(['fam-1']));
    setFloor(OPEN_FLOOR);
    installDataPolicy();
    expect(h.applyDataPolicy).toHaveBeenCalledWith({
      counterWrites: N,
      scalarWrites: N,
      scalarFamilies: [],
    });
    expect(eventsWith('applied', 'scalar-policy').at(-1)?.context?.detail).toBe(
      `on=null,served=null,source=default,floor=${OPEN_FLOOR},families=0`
    );
    expect(localStorage.getItem(OLD_KEY)).toBe(JSON.stringify(['fam-1']));
    expect(eventsWith('persisted_invalid', 'scalar-policy')).toHaveLength(0);
  });

  it('adds on served true and removes on served false, writing nothing to storage', () => {
    setFloor(OPEN_FLOOR);
    installDataPolicy();
    const before = localStorage.length;
    h.applyDataPolicy.mockClear();

    serveFamily(true, 'fam-z');
    serveFamily(true, 'fam-1');
    expect(handed()).toEqual(['fam-1', 'fam-z']);
    expect(eventsWith('applied', 'scalar-policy').at(-1)?.context?.detail).toBe(
      `on=false,served=false,source=registry,floor=${OPEN_FLOOR},families=2`
    );

    serveFamily(false, 'fam-z');
    expect(handed()).toEqual(['fam-1']);
    // Only the two fleet flags were stored (they moved null to false); never a family list.
    expect(localStorage.length - before).toBe(2);
    expect(localStorage.getItem('beanies:scalarWritesFamilies')).toBeNull();

    const served = eventsWith('served_changed', 'scalar-policy').filter((e) =>
      e.context?.detail?.startsWith('scope=family')
    );
    expect(served.map((e) => e.context?.detail)).toEqual([
      'scope=family,served=true,family=fam-z',
      'scope=family,served=true,family=fam-1',
      'scope=family,served=false,family=fam-z',
    ]);
  });

  it('a GET for family B never changes what family A holds, and a repeat is not a change', () => {
    setFloor(OPEN_FLOOR);
    installDataPolicy();
    serveFamily(true, 'fam-a');
    h.applyDataPolicy.mockClear();

    serveFamily(false, 'fam-b'); // B unlisted: A untouched, nothing handed over
    serveFamily(true, 'fam-a'); // a repeat
    expect(h.applyDataPolicy).not.toHaveBeenCalled();

    serveFamily(true, 'fam-b');
    expect(handed()).toEqual(['fam-a', 'fam-b']);
  });

  it('removing a family (served false) turns the list off on the next GET', () => {
    setFloor(OPEN_FLOOR);
    installDataPolicy();
    serveFamily(true);
    expect(handed()).toEqual(['fam-1']);

    serveFamily(false);
    expect(handed()).toEqual([]);
  });

  it('a rollback whose post fails is re-posted on the next GET', async () => {
    setFloor(OPEN_FLOOR);
    installDataPolicy();
    serveFamily(true);
    expect(handed()).toEqual(['fam-1']);

    h.applyDataPolicy.mockResolvedValueOnce(false); // the live post did not reach the worker
    serveFamily(false);
    await settle();
    h.applyDataPolicy.mockClear();

    serveFamily(false); // nothing new served, but the last hand-over never landed
    expect(h.applyDataPolicy).toHaveBeenCalledTimes(1);
    expect(handed()).toEqual([]);

    // Landed this time: the next identical GET hands nothing over.
    await settle();
    serveFamily(false);
    expect(h.applyDataPolicy).toHaveBeenCalledTimes(1);
  });

  it('floor closed: hands over [], logs held with scope=family, opens once the floor lands', () => {
    setFloor(CLOSED_FLOOR);
    installDataPolicy();
    serveFamily(false); // the fleet flags move null to false here, not in the assertion below
    h.applyDataPolicy.mockClear();

    serveFamily(true);
    expect(h.applyDataPolicy).not.toHaveBeenCalled(); // [] before and after
    expect(heldDetails()).toEqual([
      `floor=${CLOSED_FLOOR},since=${SCALAR_READ_SINCE},verdict=closed,scope=family`,
    ]);

    setFloor(OPEN_FLOOR);
    serveFamily(true);
    expect(handed()).toEqual(['fam-1']);
  });

  it('held: the fleet latch never suppresses the family one (fleet first)', () => {
    setFloor(CLOSED_FLOOR);
    installDataPolicy();
    serve({ counterWrites: false, scalarWrites: true, scalarWritesFamily: true });
    serve({ counterWrites: false, scalarWrites: true, scalarWritesFamily: true });
    expect(heldDetails().map((d) => d.split(',').at(-1))).toEqual(['scope=fleet', 'scope=family']);
  });

  it('held: the family latch never suppresses the fleet one (family first)', () => {
    setFloor(CLOSED_FLOOR);
    installDataPolicy();
    serveFamily(true);
    serve({ counterWrites: false, scalarWrites: true, scalarWritesFamily: true });
    expect(heldDetails().map((d) => d.split(',').at(-1))).toEqual(['scope=family', 'scope=fleet']);
  });

  it('held: emptying the list re-arms only the family latch, a fleet rollback only the fleet one', () => {
    setFloor(CLOSED_FLOOR);
    installDataPolicy();
    serve({ counterWrites: false, scalarWrites: true, scalarWritesFamily: true }); // fleet + family
    serve({ counterWrites: false, scalarWrites: true, scalarWritesFamily: false }); // list empties
    serve({ counterWrites: false, scalarWrites: true, scalarWritesFamily: true }); // family again
    expect(heldDetails().map((d) => d.split(',').at(-1))).toEqual([
      'scope=fleet',
      'scope=family',
      'scope=family',
    ]);
    serve({ counterWrites: false, scalarWrites: false, scalarWritesFamily: true }); // fleet rollback
    serve({ counterWrites: false, scalarWrites: true, scalarWritesFamily: true }); // fleet again
    expect(heldDetails().map((d) => d.split(',').at(-1))).toEqual([
      'scope=fleet',
      'scope=family',
      'scope=family',
      'scope=fleet',
    ]);
  });

  it('an older Lambda (no scalarWritesFamily) leaves the list untouched, warning once', () => {
    localStorage.setItem(KEY, 'false');
    localStorage.setItem(SKEY, 'false');
    setFloor(OPEN_FLOOR);
    installDataPolicy();
    serveFamily(true);
    h.applyDataPolicy.mockClear();

    serve(OFF);
    serve(OFF);
    expect(h.applyDataPolicy).not.toHaveBeenCalled();
    const missing = eventsWith('missing', 'scalar-policy');
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ level: 'warn', context: { detail: 'scope=family' } });
  });

  it('an entry without a usable family id is skipped, warning once (no_family_id)', () => {
    setFloor(OPEN_FLOOR);
    installDataPolicy();
    serve(OFF); // the fleet flags move null to false here
    h.applyDataPolicy.mockClear();
    h.logEvent.mockClear(); // and the family list's own `missing` for that GET

    serveFamily(true, '');
    serveFamily(true, null);
    expect(h.applyDataPolicy).not.toHaveBeenCalled();
    const missing = eventsWith('missing', 'scalar-policy');
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ level: 'warn', context: { detail: 'no_family_id' } });
  });
});
