/**
 * The envelope version on the WRITE path, against the REAL `fileSync`.
 *
 * ⚠️ THIS FILE MUST NOT MOCK `@/services/sync/fileSync`. Thirteen other suites
 * mock `reEncryptEnvelope` to return a literal `'{"version":"4.0"}'`, so a pin
 * written in any of them would assert the mock's constant and stay green
 * through the exact regression this file exists to catch: a compacted document
 * written as 4.0, which a pre-guard build would then parse and merge across
 * lineages. Here the derivation runs for real and the written bytes are read.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { BeanpodFileV4 } from '@/types/syncFileV4';
import type { PodLineage } from '@/types/models';

const exportHook = vi.hoisted(() => ({
  lineage: null as PodLineage | null,
  mergeAction: 'merged' as 'merged' | 'kept-local',
}));

vi.mock('@/services/automerge/worker/docClient', () => ({
  setFamilyKey: vi.fn(),
  persistEnvelope: vi.fn(async () => {}),
  exportEncryptedPayload: vi.fn(async () => ({
    payload: 'base64-payload==',
    heads: ['h-export'],
    lineage: exportHook.lineage,
  })),
  mergeRemoteEnvelope: vi.fn(async () => ({
    action: exportHook.mergeAction,
    dirty: exportHook.mergeAction === 'kept-local',
    changed: false,
    heads: ['h-export'],
    remoteHeads: ['h-remote'],
  })),
  setLocalChangeHandler: vi.fn(),
  setCachePersistFailedHandler: vi.fn(),
  logMergeTerminus: vi.fn(),
  noteRemoteBaseline: vi.fn(),
  getHeads: vi.fn(async () => ({ heads: ['h-remote'] })),
}));
vi.mock('@/services/indexeddb/database', () => ({ getActiveFamilyId: vi.fn(() => null) }));
vi.mock('@/services/familyContext', () => ({ createFamilyWithId: vi.fn() }));
vi.mock('@/services/sync/fileHandleStore', () => ({
  getFileHandle: vi.fn(),
  verifyPermission: vi.fn(async () => true),
  getProviderConfig: vi.fn(),
}));
vi.mock('@/services/sync/providers/googleDriveProvider', () => ({
  GoogleDriveProvider: class {
    static fromExisting() {
      return null;
    }
  },
}));
vi.mock('@/services/sync/providers/localProvider', () => ({
  LocalStorageProvider: class {
    getHandle() {
      return null;
    }
  },
}));
vi.mock('@/services/sync/capabilities', () => ({ supportsFileSystemAccess: vi.fn(() => false) }));
vi.mock('@/services/google/driveService', () => ({
  DriveApiError: class extends Error {
    status: number;
    constructor(message: string, status = 500) {
      super(message);
      this.name = 'DriveApiError';
      this.status = status;
    }
  },
}));
vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useToast', () => ({ showToast: vi.fn() }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/utils/beanpodFilename', () => ({ isConflictFilename: vi.fn(() => false) }));
vi.mock('@/services/telemetry', () => ({ logEvent: vi.fn() }));

import { logEvent } from '@/services/telemetry';

function envelope(over: Partial<BeanpodFileV4> = {}): BeanpodFileV4 {
  return {
    version: '4.0',
    familyId: 'fam-1',
    familyName: 'Test',
    keyId: 'k1',
    wrappedKeys: { m1: { wrapped: 'w', salt: 's' } },
    passkeyWrappedKeys: {},
    inviteKeys: {},
    encryptedPayload: 'payload',
    ...over,
  };
}

function provider(remote: BeanpodFileV4, onWrite: (content: string) => void) {
  return {
    type: 'google_drive' as const,
    read: vi.fn(async () => JSON.stringify(remote)),
    write: vi.fn(async (content: string) => onWrite(content)),
    getLastModified: vi.fn(async () => '2026-09-06T10:00:00Z'),
    getDisplayName: () => 'pod.beanpod',
    isConnected: () => true,
    persist: vi.fn(async () => {}),
    clearPersisted: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
  };
}

/** Real `syncService` per test, so the module-level transition memory is fresh. */
async function freshService() {
  vi.resetModules();
  return import('../syncService');
}

// `vi.resetModules()` plus a real import of `syncService` (a large module with a
// large import graph) is slow, and under a full parallel run it can exceed the
// 5s default. The suite is not slow because anything is wrong; give it room.
const RESET_MODULES_TIMEOUT_MS = 30_000;

const fakeKey = {} as CryptoKey;
const COMPACTED: PodLineage = { id: 'lineage-A', seq: 1 };

describe('the version a save actually writes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    exportHook.lineage = null;
    exportHook.mergeAction = 'merged';
  });

  it(
    'writes 4.0 for a never-compacted family, byte-for-byte as before',
    async () => {
      const svc = await freshService();
      let written = '';
      svc.setProvider(provider(envelope(), (c) => (written = c)) as never);
      svc.setFamilyKey(fakeKey, envelope());
      expect(await svc.save()).toBe(true);
      expect((JSON.parse(written) as BeanpodFileV4).version).toBe('4.0');
    },
    RESET_MODULES_TIMEOUT_MS
  );

  it(
    'writes 5.0 for a compacted document even though the in-memory envelope says 4.0 (Trap 1)',
    async () => {
      // The in-memory envelope is 4.0 (it always is after a kept-local adopts
      // the remote's), the DOCUMENT is compacted. The written file must say what
      // the document is. Fails when `reEncryptEnvelope` reads `envelope.version`.
      exportHook.lineage = COMPACTED;
      const svc = await freshService();
      let written = '';
      svc.setProvider(provider(envelope(), (c) => (written = c)) as never);
      svc.setFamilyKey(fakeKey, envelope({ version: '4.0' }));
      expect(await svc.save()).toBe(true);
      expect((JSON.parse(written) as BeanpodFileV4).version).toBe('5.0');
    },
    RESET_MODULES_TIMEOUT_MS
  );

  it(
    'republishes as 5.0 on the kept-local terminus, after adopting a 4.0 remote envelope',
    async () => {
      // ⚠️ THE ROUND TRIP THAT DEFEATED THE OBVIOUS DESIGN. The pre-save merge
      // says kept-local (our document is the newer lineage), the terminus adopts
      // the REMOTE envelope for its key dicts (`preserveLocalKeyDicts` spreads
      // `...incoming`, version included), and the save writes the LOCAL
      // compacted document. Under an envelope-carried version this wrote 4.0.
      exportHook.lineage = COMPACTED;
      exportHook.mergeAction = 'kept-local';
      const svc = await freshService();
      let written = '';
      // A remote that is on the OLD lineage: 4.0, and carrying a key we lack.
      const remote = envelope({ version: '4.0', wrappedKeys: { m2: { wrapped: 'r', salt: 'r' } } });
      svc.setProvider(provider(remote, (c) => (written = c)) as never);
      svc.setFamilyKey(fakeKey, envelope({ version: '5.0' }));
      expect(await svc.save()).toBe(true);
      const out = JSON.parse(written) as BeanpodFileV4;
      expect(out.version).toBe('5.0');
      // And the adopt did happen: the remote's key dict was merged in.
      expect(out.wrappedKeys.m2).toEqual({ wrapped: 'r', salt: 'r' });
    },
    RESET_MODULES_TIMEOUT_MS
  );

  it(
    'never drops a wrapped key the local envelope had, under either version',
    async () => {
      exportHook.lineage = COMPACTED;
      exportHook.mergeAction = 'kept-local';
      const svc = await freshService();
      let written = '';
      svc.setProvider(provider(envelope({ wrappedKeys: {} }), (c) => (written = c)) as never);
      svc.setFamilyKey(fakeKey, envelope({ version: '5.0' }));
      await svc.save();
      expect((JSON.parse(written) as BeanpodFileV4).wrappedKeys.m1).toEqual({
        wrapped: 'w',
        salt: 's',
      });
    },
    RESET_MODULES_TIMEOUT_MS
  );
});

describe('the pod-version event after the review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    exportHook.lineage = null;
    exportHook.mergeAction = 'merged';
  });

  function versionEvents() {
    return vi
      .mocked(logEvent)
      .mock.calls.map((c) => c[0])
      .filter((e) => e.surface === 'pod-version');
  }

  it(
    'reports seq=missing when the lineage never arrived, which is the ONLY dropped-field alarm',
    async () => {
      // ⚠️ `undefined` (the field did not come across) and `null` (the worker said
      // "no lineage") must be DIFFERENT rows. Deriving both halves from the same
      // optional made `version=4.0` occur exactly when `seq=none`, so the alarm
      // the plan names could never fire and a dropped lineage was invisible.
      exportHook.lineage = undefined as never;
      const svc = await freshService();
      svc.setProvider(provider(envelope(), () => {}) as never);
      svc.setFamilyKey(fakeKey, envelope());
      await svc.save();
      expect(versionEvents()[0]!.context).toMatchObject({ detail: 'version=4.0,seq=missing' });
    },
    RESET_MODULES_TIMEOUT_MS
  );

  it(
    'still reports seq=none for an ordinary never-compacted family',
    async () => {
      const svc = await freshService();
      svc.setProvider(provider(envelope(), () => {}) as never);
      svc.setFamilyKey(fakeKey, envelope());
      await svc.save();
      expect(versionEvents()[0]!.context).toMatchObject({ detail: 'version=4.0,seq=none' });
    },
    RESET_MODULES_TIMEOUT_MS
  );

  it(
    'does not report a version the write never landed, and does not silence the next one',
    async () => {
      // Emitted before the ack, a failed first post-compaction save logged a 5.0
      // write that never happened AND committed the memo, silencing the one that
      // eventually did.
      exportHook.lineage = COMPACTED;
      const svc = await freshService();
      const failing = provider(envelope(), () => {}) as never as { write: unknown };
      failing.write = vi.fn(async () => {
        throw new Error('drive said no');
      });
      svc.setProvider(failing as never);
      svc.setFamilyKey(fakeKey, envelope());
      await svc.save();
      expect(versionEvents()).toHaveLength(0);

      svc.setProvider(provider(envelope(), () => {}) as never);
      await svc.save();
      expect(versionEvents()).toHaveLength(1);
      expect(versionEvents()[0]!.context).toMatchObject({ detail: 'version=5.0,seq=1' });
    },
    RESET_MODULES_TIMEOUT_MS
  );

  it(
    'forgets the transition memory on reset, so a second family is not silenced',
    async () => {
      const svc = await freshService();
      svc.setProvider(provider(envelope(), () => {}) as never);
      svc.setFamilyKey(fakeKey, envelope());
      await svc.save();
      expect(versionEvents()).toHaveLength(1);

      // A family switch in the same tab: same derived string, different family.
      svc.reset();
      svc.setProvider(provider(envelope({ familyId: 'fam-2' }), () => {}) as never);
      svc.setFamilyKey(fakeKey, envelope({ familyId: 'fam-2' }));
      await svc.save();
      expect(versionEvents()).toHaveLength(2);
      expect(versionEvents()[1]!.context).toMatchObject({ family_id: 'fam-2' });
    },
    RESET_MODULES_TIMEOUT_MS
  );
});

describe('the pod-version transition event', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    exportHook.lineage = null;
    exportHook.mergeAction = 'merged';
  });

  function versionEvents() {
    return vi
      .mocked(logEvent)
      .mock.calls.map((c) => c[0])
      .filter((e) => e.surface === 'pod-version');
  }

  it(
    'is emitted once for a run of identical saves, and again when the version changes',
    async () => {
      // Transition-gated: a family saves constantly, and a per-save event would
      // be a large fraction of the firehose carrying one constant.
      const svc = await freshService();
      svc.setProvider(provider(envelope(), () => {}) as never);
      svc.setFamilyKey(fakeKey, envelope());
      await svc.save();
      await svc.save();
      await svc.save();
      expect(versionEvents()).toHaveLength(1);
      expect(versionEvents()[0]!.context).toMatchObject({
        action: 'wrote',
        detail: 'version=4.0,seq=none',
        family_id: 'fam-1',
      });

      exportHook.lineage = COMPACTED;
      await svc.save();
      await svc.save();
      expect(versionEvents()).toHaveLength(2);
      expect(versionEvents()[1]!.context).toMatchObject({ detail: 'version=5.0,seq=1' });
    },
    RESET_MODULES_TIMEOUT_MS
  );

  it(
    'reports what the WRITER chose, so a dropped lineage is visible as version=4.0 with a seq',
    async () => {
      // `beanpodVersionFor` makes `version=4.0` alongside a seq impossible; if it
      // ever appears in CloudWatch the lineage was lost across the worker
      // boundary, which is this plan's one remaining silent-failure route.
      const svc = await freshService();
      exportHook.lineage = { id: 'L', seq: 3 };
      svc.setProvider(provider(envelope(), () => {}) as never);
      svc.setFamilyKey(fakeKey, envelope());
      await svc.save();
      expect(versionEvents()[0]!.context).toMatchObject({ detail: 'version=5.0,seq=3' });
    },
    RESET_MODULES_TIMEOUT_MS
  );
});
