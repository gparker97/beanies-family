/**
 * The compaction's REFUSAL matrix, and the one ordering rule that turns a failed
 * publish into a recoverable state rather than a dead end.
 *
 * Every refusal must leave the pod completely untouched: this flow is the only
 * thing in the app that deliberately produces a document no peer can merge with.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  confirmed: true,
  synced: true,
  exported: true,
  backupLanded: true,
  canWrite: true,
  pulled: true,
}));

vi.mock('@/composables/useConfirm', () => ({
  confirm: vi.fn(async () => hooks.confirmed),
  alert: vi.fn(),
}));
vi.mock('@/composables/useToast', () => ({ showToast: vi.fn() }));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
vi.mock('@/composables/usePodExport', () => ({
  usePodExport: () => ({
    isExporting: { value: false },
    exportEncryptedPod: vi.fn(async () => hooks.exported),
    confirmBackupLanded: vi.fn(async () => hooks.backupLanded),
  }),
}));
vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => ({ activeFamilyId: 'fam-1' }),
}));
vi.mock('@/services/sync/syncService', () => ({
  flushPendingSave: vi.fn(async () => {}),
  isFullySynced: vi.fn(async () => hooks.synced),
  // The write proof: a revoked file permission or an expired token must be
  // caught BEFORE the lineage is stamped, not at the publish.
  hasPermission: vi.fn(async () => hooks.canWrite),
}));
vi.mock('@/services/automerge/worker/docClient', () => ({
  compactDoc: vi.fn(async () => ({
    beforeBytes: 2_000_000,
    afterBytes: 170_000,
    changesBefore: 10_000,
    changesAfter: 1,
    actorsBefore: 2_600,
  })),
  flush: vi.fn(async () => {}),
}));

const syncNow = vi.fn(async () => true);
const replaceEnvelope = vi.fn();
// The unconditional pull. `isFullySynced` trusts a change probe that, with no
// revision, compares mtimes — so compaction pulls without consulting it.
const loadFromFile = vi.fn(async () => ({ success: hooks.pulled }));
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({
    syncNow,
    replaceEnvelope,
    loadFromFile,
    envelope: { version: '4.0', familyId: 'fam-1', podLineage: undefined },
  }),
}));

const docClient = await import('@/services/automerge/worker/docClient');
const { usePodCompaction } = await import('@/composables/usePodCompaction');

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  syncNow.mockResolvedValue(true);
  Object.assign(hooks, {
    confirmed: true,
    synced: true,
    exported: true,
    backupLanded: true,
    canWrite: true,
    pulled: true,
  });
});

describe('every refusal leaves the pod untouched', () => {
  it('refuses when the user declines the warning', async () => {
    hooks.confirmed = false;
    await usePodCompaction().compact();
    expect(docClient.compactDoc).not.toHaveBeenCalled();
    expect(replaceEnvelope).not.toHaveBeenCalled();
  });

  it('refuses when this device is not provably current and clean', async () => {
    // A compaction publishes a document no peer can merge with, so publishing
    // one that is missing a peer's edits would strand them permanently.
    hooks.synced = false;
    await usePodCompaction().compact();
    expect(docClient.compactDoc).not.toHaveBeenCalled();
  });

  it('refuses when this device cannot WRITE, before anything moves', async () => {
    // Reordering the gates to skip a pointless upload also removed the only
    // thing that had ever exercised the provider, so a revoked file permission
    // or an expired token surfaced at the PUBLISH — after the lineage was
    // stamped. `doSave` returns false there without arming a blocker or
    // recording a save failure, leaving a cached, unpublished compaction on a
    // device whose documented self-repair is the very write it cannot perform.
    hooks.canWrite = false;
    await usePodCompaction().compact();
    expect(docClient.compactDoc).not.toHaveBeenCalled();
    expect(replaceEnvelope).not.toHaveBeenCalled();
  });

  it('refuses when the unconditional pull fails', async () => {
    // Compaction does not trust the change probe: with no revision it compares
    // MTIMES, which a filesystem granule or a timestamp-preserving cloud client
    // can defeat, and a peer write missed that way is one this compaction then
    // publishes over.
    hooks.pulled = false;
    await usePodCompaction().compact();
    expect(docClient.compactDoc).not.toHaveBeenCalled();
  });

  it('pulls even when it already believes it is level', async () => {
    // The pull is UNCONDITIONAL — that is the point. Gating it on
    // `isFullySynced` would reintroduce the probe it exists to distrust.
    hooks.synced = true;
    await usePodCompaction().compact();
    expect(loadFromFile).toHaveBeenCalledWith({ merge: true });
  });

  it('refuses when the backup did not actually land', async () => {
    // The exported .beanpod is the ONLY rollback route, so this gate is
    // load-bearing rather than a courtesy.
    hooks.exported = false;
    await usePodCompaction().compact();
    expect(docClient.compactDoc).not.toHaveBeenCalled();
  });

  it('refuses when the human says the share did not save', async () => {
    // Android resolves an abandoned share as success, so on native the only
    // honest gate before an irreversible step is to ask.
    hooks.backupLanded = false;
    await usePodCompaction().compact();
    expect(docClient.compactDoc).not.toHaveBeenCalled();
  });
});

describe('the happy path', () => {
  it('does NOT stamp the envelope — the lineage lives in the DOCUMENT', async () => {
    // ⚠️ THE DEFECT THIS REPLACES. `setEnvelope` persists the envelope cache
    // eagerly and independently of the document cache, so a stamp here left the
    // cached envelope claiming a lineage the cached document was not on. The
    // guard then compared two envelopes that agreed while the documents did
    // not, returned `same`, and permitted the cross-lineage merge it exists to
    // prevent — observed in the field on 2026-09-05. `compactDoc` now writes
    // the identity into the document itself, where it cannot drift.
    await usePodCompaction().compact();
    expect(docClient.compactDoc).toHaveBeenCalled();
    for (const call of replaceEnvelope.mock.calls) {
      expect(call[0]).not.toHaveProperty('podLineage');
    }
  });

  it('still flushes the rebuilt document before publishing it', async () => {
    // The flush stays: a flushed but unpublished compaction is now
    // self-describing in the cache, which is what makes the `ours-newer`
    // recovery work by construction rather than by the ordering of two writes.
    await usePodCompaction().compact();
    const flushOrder = vi.mocked(docClient.flush).mock.invocationCallOrder[0]!;
    const publishOrder = syncNow.mock.invocationCallOrder.at(-1)!;
    expect(flushOrder).toBeLessThan(publishOrder);
  });
});
