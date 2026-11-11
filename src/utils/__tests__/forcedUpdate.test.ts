import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const env = vi.hoisted(() => ({ native: false, chunkRecovery: false }));
const hardReload = vi.hoisted(() => vi.fn<() => Promise<void>>(async () => {}));
vi.mock('@/utils/hardReload', () => ({
  hardReload,
  isChunkRecoveryInProgress: () => env.chunkRecovery,
}));
vi.mock('@/services/sync/capabilities', () => ({ isNative: () => env.native }));

import {
  forceUpdate,
  readForcedRecord,
  writeForcedRecord,
  reconcileForcedRecord,
  behindSince,
  isForceInFlight,
  FORCED_RECORD_KEY,
  BEHIND_SINCE_KEY,
  __resetForcedUpdateForTesting,
} from '../forcedUpdate';

const OPTS = { from: 'old1111', to: 'new2222', userRequested: false };

/** Storage that throws on access, the way it does on some real devices. */
function throwingStorage(): Storage {
  const deny = () => {
    throw new DOMException('denied', 'SecurityError');
  };
  return {
    getItem: deny,
    setItem: deny,
    removeItem: deny,
    clear: deny,
    key: deny,
    length: 0,
  } as unknown as Storage;
}

describe('forcedUpdate', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    env.native = false;
    env.chunkRecovery = false;
    hardReload.mockReset();
    hardReload.mockResolvedValue(undefined);
    __resetForcedUpdateForTesting();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('forceUpdate', () => {
    it('writes the record, lets the caller log, then hard-reloads', async () => {
      const order: string[] = [];
      hardReload.mockImplementation(async () => {
        order.push('reload');
      });
      const result = await forceUpdate(OPTS, () => {
        order.push(`before:${readForcedRecord()?.to}`);
        return true;
      });
      expect(result).toEqual({ outcome: 'reloading' });
      expect(order).toEqual(['before:new2222', 'reload']);
      expect(readForcedRecord()).toEqual({ from: 'old1111', to: 'new2222' });
      expect(isForceInFlight()).toBe(true);
    });

    it('once per sha: a second automatic force toward the same build is suppressed', async () => {
      writeForcedRecord({ from: 'old1111', to: 'new2222' }); // a force that did not take
      const before = vi.fn(() => true);
      expect(await forceUpdate(OPTS, before)).toEqual({ outcome: 'suppressed' });
      expect(before).not.toHaveBeenCalled(); // so `forced` is never logged for it
      expect(hardReload).not.toHaveBeenCalled();
    });

    it('the guard does not block a force toward a NEWER sha', async () => {
      writeForcedRecord({ from: 'old1111', to: 'mid0000' });
      expect(await forceUpdate(OPTS)).toEqual({ outcome: 'reloading' });
      expect(readForcedRecord()?.to).toBe('new2222');
    });

    it('a person’s tap ignores the once-per-sha guard', async () => {
      writeForcedRecord({ from: 'old1111', to: 'new2222' });
      expect(await forceUpdate({ ...OPTS, userRequested: true })).toEqual({
        outcome: 'reloading',
      });
    });

    it('fails CLOSED when the record cannot be written', async () => {
      vi.stubGlobal('sessionStorage', throwingStorage());
      expect(await forceUpdate(OPTS)).toEqual({ outcome: 'storage' });
      expect(hardReload).not.toHaveBeenCalled();
    });

    it('a person’s tap still reloads without the record (no loop without a human in it)', async () => {
      vi.stubGlobal('sessionStorage', throwingStorage());
      expect(await forceUpdate({ ...OPTS, userRequested: true })).toEqual({
        outcome: 'reloading',
      });
    });

    it('is busy during a chunk recovery', async () => {
      env.chunkRecovery = true;
      expect(await forceUpdate(OPTS)).toEqual({ outcome: 'busy' });
      expect(hardReload).not.toHaveBeenCalled();
      expect(readForcedRecord()).toBeNull();
    });

    it('is busy on native (refusal of last resort)', async () => {
      env.native = true;
      expect(await forceUpdate({ ...OPTS, userRequested: true })).toEqual({ outcome: 'busy' });
      expect(hardReload).not.toHaveBeenCalled();
    });

    it('is busy while another force is in flight', async () => {
      let release!: () => void;
      hardReload.mockImplementation(() => new Promise<void>((r) => (release = r)));
      const first = forceUpdate(OPTS);
      await vi.waitFor(() => expect(hardReload).toHaveBeenCalledTimes(1));
      expect(await forceUpdate({ ...OPTS, userRequested: true })).toEqual({ outcome: 'busy' });
      release();
      await first;
      expect(hardReload).toHaveBeenCalledTimes(1);
    });

    it('a call-off from beforeReload restores the previous record and reloads nothing', async () => {
      writeForcedRecord({ from: 'old1111', to: 'mid0000' });
      expect(await forceUpdate(OPTS, () => false)).toEqual({ outcome: 'aborted' });
      expect(readForcedRecord()).toEqual({ from: 'old1111', to: 'mid0000' });
      expect(hardReload).not.toHaveBeenCalled();
      expect(isForceInFlight()).toBe(false);
    });

    it('a call-off with no previous record leaves none behind (it must not suppress later)', async () => {
      expect(await forceUpdate(OPTS, () => false)).toEqual({ outcome: 'aborted' });
      expect(sessionStorage.getItem(FORCED_RECORD_KEY)).toBeNull();
    });

    it('a throwing beforeReload is a call-off, never a rejection', async () => {
      const result = await forceUpdate(OPTS, () => {
        throw new Error('logger died');
      });
      expect(result).toEqual({ outcome: 'aborted' });
      expect(hardReload).not.toHaveBeenCalled();
    });

    it('catches a hardReload rejection and keeps the record (it would fail again)', async () => {
      const err = new Error('location.replace blocked');
      hardReload.mockRejectedValue(err);
      const result = await forceUpdate(OPTS);
      expect(result).toEqual({ outcome: 'failed', error: err });
      expect(isForceInFlight()).toBe(false);
      expect(readForcedRecord()?.to).toBe('new2222');
      // ...so the next automatic attempt is suppressed rather than looping.
      expect(await forceUpdate(OPTS)).toEqual({ outcome: 'suppressed' });
    });
  });

  describe('reconcileForcedRecord', () => {
    it('is null with no record', () => {
      expect(reconcileForcedRecord('new2222')).toBeNull();
    });

    it('applied: this build is the target; the record is removed', () => {
      writeForcedRecord({ from: 'old1111', to: 'new2222' });
      expect(reconcileForcedRecord('new2222')).toEqual({
        kind: 'applied',
        record: { from: 'old1111', to: 'new2222' },
      });
      expect(readForcedRecord()).toBeNull();
    });

    it('applied: landed on a build NEWER than the target (another deploy finished meanwhile)', () => {
      writeForcedRecord({ from: 'old1111', to: 'new2222' });
      expect(reconcileForcedRecord('newer333')?.kind).toBe('applied');
      expect(readForcedRecord()).toBeNull();
    });

    it('failed: still the old build; the record stays as the guard', () => {
      writeForcedRecord({ from: 'old1111', to: 'new2222' });
      expect(reconcileForcedRecord('old1111')).toEqual({
        kind: 'failed',
        record: { from: 'old1111', to: 'new2222' },
      });
      expect(readForcedRecord()).not.toBeNull();
    });

    it('treats a malformed record as absent', () => {
      sessionStorage.setItem(FORCED_RECORD_KEY, '{"from":1}');
      expect(reconcileForcedRecord('new2222')).toBeNull();
      sessionStorage.setItem(FORCED_RECORD_KEY, 'not json');
      expect(reconcileForcedRecord('new2222')).toBeNull();
    });
  });

  describe('behindSince', () => {
    it('stamps the first sighting and returns it on later page loads', () => {
      expect(behindSince('new2222', 1_000)).toBe(1_000);
      expect(behindSince('new2222', 50_000)).toBe(1_000);
      expect(JSON.parse(localStorage.getItem(BEHIND_SINCE_KEY)!)).toEqual({
        sha: 'new2222',
        since: 1_000,
      });
    });

    it('restamps for a different sha (one key, not one per deploy)', () => {
      behindSince('new2222', 1_000);
      expect(behindSince('newer333', 9_000)).toBe(9_000);
      expect(localStorage.length).toBe(1);
    });

    it('restamps a stamp from the future (clock moved back)', () => {
      behindSince('new2222', 90_000);
      expect(behindSince('new2222', 10_000)).toBe(10_000);
    });

    it('degrades to now when storage throws (the cap never passes)', () => {
      behindSince('new2222', 1); // a real stamp exists...
      vi.stubGlobal('localStorage', throwingStorage()); // ...but storage now throws
      expect(behindSince('new2222', 77)).toBe(77);
    });

    it('restamps a corrupt value', () => {
      localStorage.setItem(BEHIND_SINCE_KEY, '{"sha":"new2222","since":"soon"}');
      expect(behindSince('new2222', 5)).toBe(5);
    });
  });
});
