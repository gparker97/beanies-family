/**
 * The served Counter-write policy on the main thread (#117 writer flip, Testing Plan item 6):
 * the boot hand-over from the persisted value, the registry observer handing over only a change,
 * the once-per-session `missing` warning, a refused write, and a corrupt record.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/constants/storageKeys';
import type { RegistryEntry } from '@/types/models';

const h = vi.hoisted(() => ({
  setCounterWrites: vi.fn(async () => {}),
  logEvent: vi.fn(),
  observers: [] as Array<(e: RegistryEntry) => void>,
}));

vi.mock('@/services/automerge/worker/docClient', () => ({
  setCounterWrites: h.setCounterWrites,
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
  __resetCounterWritesPolicyForTesting,
  installCounterWritesPolicy,
  persist,
  readPersisted,
} from '../counterWritesPolicy';

const KEY = STORAGE_KEYS.COUNTER_WRITES;

function serve(dataPolicy: RegistryEntry['dataPolicy']): void {
  const entry = {
    familyId: 'fam-1',
    provider: 'google_drive',
    updatedAt: '2026-10-04',
    ...(dataPolicy === undefined ? {} : { dataPolicy }),
  } as RegistryEntry;
  for (const o of h.observers) o(entry);
}

function eventsWith(action: string) {
  return h.logEvent.mock.calls
    .map((c) => c[0] as { level: string; surface: string; context?: { action?: string } })
    .filter((e) => e.surface === 'counter-policy' && e.context?.action === action);
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
  __resetCounterWritesPolicyForTesting();
  vi.restoreAllMocks();
});

describe('counterWritesPolicy: the boot hand-over', () => {
  it('hands null with source "default" when nothing was ever persisted', () => {
    installCounterWritesPolicy();
    expect(h.setCounterWrites).toHaveBeenCalledTimes(1);
    expect(h.setCounterWrites).toHaveBeenCalledWith(null, 'default');
  });

  it('hands the persisted value with source "persisted"', () => {
    localStorage.setItem(KEY, 'true');
    installCounterWritesPolicy();
    expect(h.setCounterWrites).toHaveBeenCalledWith(true, 'persisted');
  });

  it('installs once: a second call neither re-hands nor adds a second observer', () => {
    installCounterWritesPolicy();
    installCounterWritesPolicy();
    expect(h.setCounterWrites).toHaveBeenCalledTimes(1);
    expect(h.observers).toHaveLength(1);
  });
});

describe('counterWritesPolicy: the registry observer', () => {
  it('persists and hands over a served value, then only on change', () => {
    installCounterWritesPolicy();
    h.setCounterWrites.mockClear();

    serve({ counterWrites: true });
    expect(h.setCounterWrites).toHaveBeenCalledWith(true, 'registry');
    expect(localStorage.getItem(KEY)).toBe('true');

    serve({ counterWrites: true });
    expect(h.setCounterWrites).toHaveBeenCalledTimes(1);

    serve({ counterWrites: false });
    expect(h.setCounterWrites).toHaveBeenLastCalledWith(false, 'registry');
    expect(h.setCounterWrites).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(KEY)).toBe('false');
  });

  it('does not re-hand a served value equal to the persisted one', () => {
    localStorage.setItem(KEY, 'false');
    installCounterWritesPolicy();
    h.setCounterWrites.mockClear();

    serve({ counterWrites: false });
    expect(h.setCounterWrites).not.toHaveBeenCalled();
  });

  it('hands over a first served false even with nothing persisted (null to false is a change)', () => {
    installCounterWritesPolicy();
    h.setCounterWrites.mockClear();

    serve({ counterWrites: false });
    expect(h.setCounterWrites).toHaveBeenCalledWith(false, 'registry');
  });

  it('warns `missing` once per session for a Lambda without dataPolicy, and keeps the value', () => {
    localStorage.setItem(KEY, 'true');
    installCounterWritesPolicy();
    h.setCounterWrites.mockClear();

    serve(undefined);
    serve(undefined);

    const missing = eventsWith('missing');
    expect(missing).toHaveLength(1);
    expect(missing[0]!.level).toBe('warn');
    expect(h.setCounterWrites).not.toHaveBeenCalled();
    expect(localStorage.getItem(KEY)).toBe('true');
  });
});

describe('counterWritesPolicy: storage', () => {
  it('logs `persist_failed` with the storedJson error when the write is refused', () => {
    const error = new Error('QuotaExceededError');
    refuseStorageWrites(error);

    persist(true);

    const failed = eventsWith('persist_failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ level: 'warn', error });
  });

  it('still hands a served value over when persisting it is refused', () => {
    installCounterWritesPolicy();
    h.setCounterWrites.mockClear();
    refuseStorageWrites(new Error('denied'));

    serve({ counterWrites: true });

    expect(h.setCounterWrites).toHaveBeenCalledWith(true, 'registry');
    expect(eventsWith('persist_failed')).toHaveLength(1);
  });

  it('treats a corrupt record as null, removes it and logs once', () => {
    localStorage.setItem(KEY, '{not json');

    expect(readPersisted()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(eventsWith('persisted_invalid')).toHaveLength(1);

    // Removed, so the next read is a plain miss and logs nothing more.
    expect(readPersisted()).toBeNull();
    expect(eventsWith('persisted_invalid')).toHaveLength(1);
  });

  it('treats a non-boolean record as null and removes it', () => {
    localStorage.setItem(KEY, '"yes"');
    installCounterWritesPolicy();

    expect(h.setCounterWrites).toHaveBeenCalledWith(null, 'default');
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(eventsWith('persisted_invalid')[0]).toMatchObject({
      context: { detail: 'not_boolean' },
    });
  });
});
