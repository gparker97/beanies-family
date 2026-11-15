/**
 * Requirement 15 end to end through the real `syncService`: a save asked for on tab
 * hide or `beforeunload` uploads nothing when Drive already holds everything this
 * device has, and uploads exactly as before in every other case. The predicate is
 * table-tested in `cleanSkip.test.ts`; this file proves the INPUTS are wired from the
 * real state (the baseline fingerprint each terminus records, the debounce, the
 * failure count, the heads) and that only the two named callers can ever skip.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { BeanpodFileV4 } from '@/types/syncFileV4';

vi.mock('@/services/sync/capabilities', () => ({
  supportsFileSystemAccess: vi.fn(() => false),
  isNative: vi.fn(() => false),
}));
vi.mock('@/services/sync/fileHandleStore', () => ({
  getFileHandle: vi.fn(async () => null),
  verifyPermission: vi.fn(async () => true),
  getProviderConfig: vi.fn(async () => null),
}));
// The writer RESTAMPS `writerVersion`, as the real `reEncryptEnvelope` does: the clean
// skip must still fire after our own write, so the fingerprint must be of the envelope
// as held, never of the written file.
vi.mock('@/services/sync/fileSync', async (importOriginal) => ({
  beanpodVersionFor: (await importOriginal<typeof import('@/services/sync/fileSync')>())
    .beanpodVersionFor,
  reEncryptEnvelope: vi.fn((env: BeanpodFileV4, payload: string) =>
    JSON.stringify({ ...env, encryptedPayload: payload, writerVersion: 'this-build' })
  ),
  parseBeanpodV4: vi.fn((text: string) => JSON.parse(text) as BeanpodFileV4),
  openFilePicker: vi.fn(async () => null),
}));
vi.mock('@/services/indexeddb/database', () => ({
  getActiveFamilyId: vi.fn(() => 'fam'),
  clearUnpushedAtSignOutMarker: vi.fn(),
}));
vi.mock('@/services/familyContext', () => ({ createFamilyWithId: vi.fn(async () => {}) }));
vi.mock('@/services/automerge/worker/docClient', () => ({
  setFamilyKey: vi.fn(),
  persistEnvelope: vi.fn(async () => {}),
  exportEncryptedPayload: vi.fn(async () => ({ payload: 'p==', heads: ['h'], lineage: null })),
  mergeRemoteEnvelope: vi.fn(async () => ({ action: 'merged', dirty: false, remoteHeads: ['h'] })),
  setLocalChangeHandler: vi.fn(),
  setCachePersistFailedHandler: vi.fn(),
  noteRemoteBaseline: vi.fn(),
  logMergeTerminus: vi.fn(),
  getHeads: vi.fn(async () => ({ heads: ['h'] })),
  documentHoldsCacheOf: vi.fn(() => true),
}));
vi.mock('@/services/sync/offlineQueue', () => ({
  enqueueOfflineSave: vi.fn(),
  enqueueSeqNow: vi.fn(() => 0),
  hasPendingSave: vi.fn(() => false),
  noteSaveLanded: vi.fn(),
  setFlushProvider: vi.fn(),
  setResaveHandler: vi.fn(),
}));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/services/telemetry', () => ({ logEvent: vi.fn() }));
vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useToast', () => ({ showToast: vi.fn() }));
vi.mock('@/utils/beanpodFilename', () => ({ isConflictFilename: vi.fn(() => false) }));

import * as syncService from '../syncService';
import * as docClient from '@/services/automerge/worker/docClient';
import { hasPendingSave } from '@/services/sync/offlineQueue';
import { logEvent } from '@/services/telemetry';
import { envelopeFingerprint, mergeEnvelopes } from '../envelopeMerge';
import type { ReadTicket } from '../remoteBaseline';

const KEY = {} as CryptoKey;
const HIDE = { skipIfClean: true, trigger: 'hide' } as const;
const UNLOAD = { skipIfClean: true, trigger: 'unload' } as const;

function envelope(over: Partial<BeanpodFileV4> = {}): BeanpodFileV4 {
  return {
    version: '4.0',
    familyId: 'fam',
    familyName: 'Fam',
    keyId: 'k',
    wrappedKeys: { m1: { wrapped: 'w1' } } as never,
    passkeyWrappedKeys: {},
    inviteKeys: {},
    writerVersion: 'older-build',
    encryptedPayload: 'payload',
    ...over,
  };
}

/** A Drive provider whose `version` advances by one per write, with content ids. */
function drive(driveFile: BeanpodFileV4 = envelope({ writerVersion: 'peer-build' })) {
  let version = 10;
  const p = {
    type: 'google_drive' as const,
    read: vi.fn(async () => JSON.stringify(driveFile)),
    write: vi.fn(async (): Promise<{ revision: string; contentId: string }> => {
      version++;
      return { revision: `ver:${version}`, contentId: `c${version}` };
    }),
    getLastModified: vi.fn(async () => null),
    getRemoteMarker: vi.fn(async () => ({
      revision: `ver:${version}`,
      modifiedTime: null,
      contentId: `c${version}`,
    })),
    getDisplayName: () => 'pod.beanpod',
    getFileId: () => 'file',
    getAccountEmail: () => null,
    supportsLocalPolling: () => false,
  };
  return p;
}

/** Bound to a provider, keyed, and with one real write landed (the baseline is ours). */
async function afterOneWrite(local: BeanpodFileV4 = envelope()) {
  const p = drive();
  syncService.setProvider(p as never, 'fam');
  syncService.setFamilyKey(KEY, local);
  await expect(syncService.save()).resolves.toBe(true);
  expect(p.write).toHaveBeenCalledTimes(1);
  vi.mocked(logEvent).mockClear();
  return p;
}

const events = (action: string) =>
  vi
    .mocked(logEvent)
    .mock.calls.map((c) => c[0])
    .filter((e) => (e.context as { action?: string } | undefined)?.action === action);
const details = (action: string) =>
  events(action).map((e) => (e.context as { detail?: string }).detail);

/** The `e` field of every persisted baseline row, in order. */
const committedEnvelopeFps = (): (string | null)[] =>
  vi
    .mocked(docClient.noteRemoteBaseline)
    .mock.calls.map((c) => (JSON.parse(c[0] as string) as { e: string | null }).e);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(docClient.getHeads).mockResolvedValue({ heads: ['h'] } as never);
  vi.mocked(hasPendingSave).mockReturnValue(false);
  syncService.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the clean skip fires when Drive holds everything (requirement 15)', () => {
  it('hiding after a real write uploads nothing, though the written file carries another writerVersion', async () => {
    const p = await afterOneWrite();

    await expect(syncService.saveNow(HIDE)).resolves.toBe(true);
    await expect(syncService.saveNow(UNLOAD)).resolves.toBe(true);

    expect(p.write).toHaveBeenCalledTimes(1);
    expect(p.read).toHaveBeenCalledTimes(1); // the hide did not even read
    expect(details('skipped-clean')).toEqual(['trigger=hide', 'trigger=unload']);
  });

  it('the write commits the fingerprint of the envelope AS HELD, the merge before it that of the envelope Drive held', async () => {
    const driveFile = envelope({ writerVersion: 'peer-build' });
    const local = envelope();
    await afterOneWrite(local);

    const [mergeFp, writeFp] = committedEnvelopeFps();
    expect(mergeFp).toBe(await envelopeFingerprint(driveFile));
    // The merge adopted Drive's top-level fields, and that is the envelope written.
    const held = mergeEnvelopes(driveFile, local).envelope;
    expect(writeFp).toBe(await envelopeFingerprint(held));
    expect(writeFp).not.toBe(await envelopeFingerprint({ ...held, writerVersion: 'this-build' }));
  });

  it('hiding after a merge of identical envelopes uploads nothing, though the Drive file was written by another build', async () => {
    const driveFile = envelope({ writerVersion: 'peer-build' });
    const p = drive(driveFile);
    syncService.setProvider(p as never, 'fam');
    syncService.setFamilyKey(KEY, envelope({ writerVersion: 'older-build' }));

    // The store's open/poll terminus, step for step (`syncStore.loadFromFile`): the
    // fingerprint of Drive's envelope BEFORE the merge, the envelope merge, the confirm.
    const ticket: ReadTicket = { read: null };
    const text = await syncService.load({ ticket });
    const remote = JSON.parse(text!) as BeanpodFileV4;
    const driveFp = await syncService.envelopeFingerprintOrNull(remote);
    syncService.setEnvelope(mergeEnvelopes(remote, syncService.getEnvelope()).envelope);
    syncService.confirmRemoteMerged(ticket.read, ['h'], driveFp);

    await expect(syncService.saveNow(HIDE)).resolves.toBe(true);
    expect(p.write).not.toHaveBeenCalled();
    expect(details('skipped-clean')).toEqual(['trigger=hide']);
  });
});

describe('the clean skip declines, and the save uploads, whenever anything may be unpublished', () => {
  it('a pending envelope change (an invite key not yet published) uploads', async () => {
    const p = await afterOneWrite();
    const env = syncService.getEnvelope()!;
    syncService.setEnvelope({ ...env, inviteKeys: { tok: { wrapped: 'inv' } } as never });

    await expect(syncService.saveNow(HIDE)).resolves.toBe(true);

    expect(p.write).toHaveBeenCalledTimes(2);
    expect(details('skip-declined')).toEqual(['trigger=hide;reason=envelope-differs']);
  });

  it('an in-place rotation (same count) uploads', async () => {
    const p = await afterOneWrite();
    const env = syncService.getEnvelope()!;
    syncService.setEnvelope({ ...env, wrappedKeys: { m1: { wrapped: 'w1-rotated' } } as never });

    await syncService.saveNow(HIDE);
    expect(p.write).toHaveBeenCalledTimes(2);
  });

  it('a merge that left us holding key material Drive lacks uploads', async () => {
    const p = drive(envelope({ inviteKeys: {} }));
    syncService.setProvider(p as never, 'fam');
    syncService.setFamilyKey(KEY, envelope({ inviteKeys: { mine: { wrapped: 'x' } } as never }));
    const ticket: ReadTicket = { read: null };
    const remote = JSON.parse((await syncService.load({ ticket }))!) as BeanpodFileV4;
    const driveFp = await syncService.envelopeFingerprintOrNull(remote);
    syncService.setEnvelope(mergeEnvelopes(remote, syncService.getEnvelope()).envelope);
    syncService.confirmRemoteMerged(ticket.read, ['h'], driveFp);

    await syncService.saveNow(HIDE);
    expect(p.write).toHaveBeenCalledTimes(1);
    expect(details('skip-declined')).toEqual(['trigger=hide;reason=envelope-differs']);
  });

  it('an envelope changed DURING the write is not certified by it', async () => {
    const p = drive();
    syncService.setProvider(p as never, 'fam');
    syncService.setFamilyKey(KEY, envelope());
    p.write.mockImplementationOnce(async () => {
      const env = syncService.getEnvelope()!;
      syncService.setEnvelope({ ...env, inviteKeys: { late: { wrapped: 'l' } } as never });
      return { revision: 'ver:11', contentId: 'c11' };
    });
    await syncService.save();

    await syncService.saveNow(HIDE);
    expect(p.write).toHaveBeenCalledTimes(2);
  });

  it('an armed debounce uploads (the armed save is not lost)', async () => {
    const p = await afterOneWrite();
    syncService.triggerDebouncedSave();

    await syncService.saveNow(HIDE);

    expect(p.write).toHaveBeenCalledTimes(2);
    expect(details('skip-declined')).toEqual(['trigger=hide;reason=pending']);
  });

  it('a hide after a failed save uploads', async () => {
    const p = await afterOneWrite();
    p.write.mockRejectedValueOnce(new Error('boom'));
    await expect(syncService.save()).resolves.toBe(false);
    expect(syncService.getConsecutiveSaveFailures()).toBe(1);

    await syncService.saveNow(HIDE);

    expect(p.write).toHaveBeenCalledTimes(3);
    expect(details('skip-declined')).toEqual(['trigger=hide;reason=failed-last']);
  });

  it('a save in the offline queue uploads', async () => {
    const p = await afterOneWrite();
    vi.mocked(hasPendingSave).mockReturnValue(true);
    await syncService.saveNow(HIDE);
    expect(p.write).toHaveBeenCalledTimes(2);
    expect(details('skip-declined')).toEqual(['trigger=hide;reason=queued-offline']);
  });

  it('heads that moved past the baseline upload', async () => {
    const p = await afterOneWrite();
    vi.mocked(docClient.getHeads).mockResolvedValue({ heads: ['h2'] } as never);
    await syncService.saveNow(HIDE);
    expect(p.write).toHaveBeenCalledTimes(2);
    expect(details('skip-declined')).toEqual(['trigger=hide;reason=heads-differ']);
  });

  it('a failed heads probe uploads', async () => {
    const p = await afterOneWrite();
    vi.mocked(docClient.getHeads).mockRejectedValueOnce(new Error('worker busy'));
    await syncService.saveNow(HIDE);
    expect(p.write).toHaveBeenCalledTimes(2);
    expect(details('skip-declined')).toEqual(['trigger=hide;reason=heads-differ']);
  });

  it('an envelope that cannot be fingerprinted uploads, and says so', async () => {
    const p = await afterOneWrite();
    vi.spyOn(crypto.subtle, 'digest').mockRejectedValue(new Error('no subtle'));
    await syncService.saveNow(HIDE);
    expect(p.write).toHaveBeenCalledTimes(2);
    expect(details('skip-declined')).toEqual(['trigger=hide;reason=no-envelope-fp']);
    expect(events('envelope-fp-failed')).toHaveLength(1);
  });

  it('a baseline with no envelope fingerprint (a legacy row) uploads', async () => {
    const p = drive();
    syncService.setProvider(p as never, 'fam');
    syncService.setFamilyKey(KEY, envelope());
    syncService.seedRemoteBaseline({
      payload: JSON.stringify({ r: 'ver:10', h: 'h', c: 'c10' }),
      checkedAt: new Date().toISOString(),
    });
    await syncService.saveNow(HIDE);
    expect(p.write).toHaveBeenCalledTimes(1);
    expect(details('skip-declined')).toEqual(['trigger=hide;reason=no-envelope-fp']);
  });

  it('declines are change-gated: a tab that hides again for the same reason says it once', async () => {
    await afterOneWrite();
    vi.mocked(docClient.getHeads).mockResolvedValue({ heads: ['h2'] } as never);
    await syncService.saveNow(HIDE);
    await syncService.saveNow(HIDE);
    expect(details('skip-declined')).toEqual(['trigger=hide;reason=heads-differ']);
  });
});

describe('every other caller uploads exactly as before when clean', () => {
  it.each<[string, () => Promise<unknown>]>([
    ['saveNow()', () => syncService.saveNow()],
    ['saveNowDetailed()', () => syncService.saveNowDetailed()],
    ['save()', () => syncService.save()],
    ['saveNow({ skipIfClean: false })', () => syncService.saveNow({ skipIfClean: false })],
  ])('%s', async (_label, call) => {
    const p = await afterOneWrite();
    await call();
    expect(p.write).toHaveBeenCalledTimes(2);
    expect(events('skipped-clean')).toHaveLength(0);
    expect(events('skip-declined')).toHaveLength(0);
  });

  it('a debounced autosave uploads', async () => {
    vi.useFakeTimers();
    try {
      const p = await afterOneWrite();
      syncService.triggerDebouncedSave();
      await vi.advanceTimersByTimeAsync(2000);
      await syncService.whenIdle(); // the hash inside the save resolves off the fake clock
      expect(p.write).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
