/**
 * One dispatcher, three blocker classes — and the save refusal that covers all
 * of them.
 *
 * Both mechanisms replaced an `instanceof PayloadLoadError` chain that the two
 * later blockers silently fell out of. `noteLineageBlocked` had NO reachable
 * production caller: a lineage block was flattened into "your password may have
 * changed", and `doSave` took its "save local anyway" branch and wrote a
 * pre-compaction document over a compacted remote.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../../..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
import {
  isRemoteBlocker,
  PayloadTooLargeError,
  CorruptPayloadError,
  RemoteMergeError,
} from '@/types/sync';
import { PodLineageError } from '../podLineage';

describe('isRemoteBlocker', () => {
  it('accepts every blocker class', () => {
    expect(isRemoteBlocker(new PayloadTooLargeError('m', 'load', 'f', 1))).toBe(true);
    expect(isRemoteBlocker(new CorruptPayloadError('m', 'load', 'f'))).toBe(true);
    expect(isRemoteBlocker(new RemoteMergeError(new Error('duplicate seq 2')))).toBe(true);
    expect(isRemoteBlocker(new PodLineageError('conflict', 'm'))).toBe(true);
  });

  it('rejects an ordinary error, and anything that is not one', () => {
    // The direction that matters: a transport failure must still take the
    // "save local anyway" branch, or an offline device could never save.
    expect(isRemoteBlocker(new Error('network down'))).toBe(false);
    expect(isRemoteBlocker(new TypeError('x'))).toBe(false);
    for (const v of [undefined, null, 0, 'str', {}, { blockCode: 'merge' }]) {
      expect(isRemoteBlocker(v)).toBe(false);
    }
  });

  it('is structural, so a FUTURE blocker is covered without touching this list', () => {
    class FutureBlocker extends Error {
      readonly blockCode = 'future';
      readonly inlineMessageKey = 'podCorrupted.inline' as const;
    }
    expect(isRemoteBlocker(new FutureBlocker('m'))).toBe(true);
  });
});

describe('a latch must not outlive the file it describes', () => {
  it('disconnect and a file rebind both clear the breaker', () => {
    // Nothing cleared `remoteBlocked` on either path: `selectSyncFile` and
    // `selectNativeLocalFile` assign `currentProvider` directly rather than
    // through `setProvider`. So a latch armed against the OLD pod survived a
    // disconnect and a rebind to a DIFFERENT one, after which `createNewFile`
    // -> `syncNow(true)` -> `doSave` threw the stale blocker and `loadFromFile`
    // threw it at entry. Only a page reload cleared it.
    const src = read('src/services/sync/syncService.ts');
    for (const marker of [
      'export async function disconnect',
      'export async function selectSyncFile',
      'export async function selectNativeLocalFile',
    ]) {
      const start = src.indexOf(marker);
      expect(start, `${marker} not found`).toBeGreaterThan(-1);
      const rest = src.slice(start);
      const body = rest.slice(0, rest.indexOf('\n}\n'));
      expect(body, `${marker} must clear the breaker`).toContain('clearRemoteUnreadable()');
    }
  });
});

describe('refusing a save and ARMING the breaker are different questions', () => {
  // Conflating them was the regression: a torn read, a pod from a newer build,
  // and a worker RPC timeout all stopped background sync for the whole session
  // behind "contact support", with nothing to re-arm it.
  it('a parse failure does NOT latch — a torn read and version skew self-heal', () => {
    const err = new CorruptPayloadError('Unsupported beanpod version: 5.0', 'parse', 'fam');
    expect(err.latches).toBe(false);
    // ...and it must not tell the user their data is damaged.
    expect(err.inlineMessageKey).toBe('podUnreadable.inline');
  });

  it('a wrong-key decrypt does NOT latch — a peer rotating the key is routine', () => {
    const err = new CorruptPayloadError('tag mismatch', 'decrypt', 'fam');
    expect(err.keyMayBeWrong).toBe(true);
    expect(err.latches).toBe(false);
  });

  it('genuine corruption and an out-of-memory load DO latch', () => {
    expect(new CorruptPayloadError('invalid chunk', 'load', 'fam').latches).toBe(true);
    expect(new PayloadTooLargeError('oom', 'load', 'fam', 1).latches).toBe(true);
  });

  it('a merge refusal latches ONLY when it is a real refusal, not a worker timeout', () => {
    // `RemoteMergeError` wraps everything that throws after the bytes were read,
    // including a 120s HEAVY-RPC timeout on a busy worker.
    expect(new RemoteMergeError(new Error('duplicate seq 2 found for actor a')).latches).toBe(true);
    expect(new RemoteMergeError(new Error('doc worker timed out')).latches).toBe(false);
  });

  it('a lineage block latches — retrying cannot change a fact about two documents', () => {
    expect(new PodLineageError('adopt-remote', 'm').latches).toBe(true);
  });

  it('every blocker answers `latches`, so a new one cannot inherit silence', () => {
    for (const e of [
      new CorruptPayloadError('m', 'load', 'f'),
      new PayloadTooLargeError('m', 'load', 'f', 1),
      new RemoteMergeError(new Error('x')),
      new PodLineageError('conflict', 'm'),
    ]) {
      expect(typeof e.latches, e.name).toBe('boolean');
    }
  });
});
