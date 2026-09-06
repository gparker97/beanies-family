/**
 * The compaction's REFUSAL matrix, and the one ordering rule that turns a failed
 * publish into a recoverable state rather than a dead end.
 *
 * Every refusal must leave the pod completely untouched: this flow is the only
 * thing in the app that deliberately produces a document no peer can merge with.
 */
import { setActivePinia, createPinia } from 'pinia';
import { showToast } from '@/composables/useToast';
import { confirm } from '@/composables/useConfirm';
import { flushPendingSave } from '@/services/sync/syncService';
import { reportError } from '@/utils/errorReporter';
import { PayloadTooLargeError } from '@/types/sync';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  confirmed: true,
  synced: true,
  exported: true,
  backupLanded: true,
  canWrite: true,
  pulled: true,
  hasProvider: true,
  auxAvailable: true,
  // Empty by default: `evaluateSoak([])` passes, so every existing test keeps
  // exercising the path it was written for.
  members: [] as unknown[],
  isOwner: true,
}));

// The owner check itself is derived and tested in `usePodHealth.dueSignal`;
// here it is a hook so the ladder's gate can be flipped without dragging the
// permissions store into a suite about compaction ordering.
vi.mock('@/composables/usePodHealth', () => ({
  usePodHealth: () => ({ canCompactPod: { value: hooks.isOwner } }),
}));

vi.mock('@/composables/useConfirm', () => ({
  confirm: vi.fn(async () => hooks.confirmed),
  alert: vi.fn(),
}));
vi.mock('@/composables/useToast', () => ({ showToast: vi.fn() }));
vi.mock('@/composables/useTranslation', () => ({
  // ⚠️ RETURN A REAL TEMPLATE for the two keys that interpolate names. With the
  // stub echoing the key, both "names who it is waiting for" tests passed with
  // the `fillTemplate(...)` call removed — they asserted the key, which the
  // un-named variant also contains.
  useTranslation: () => ({
    t: (k: string) =>
      k === 'compaction.refused.not-soaked.named' || k === 'compaction.doneButBehind'
        ? `${k}:{names}`
        : k,
  }),
}));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
vi.mock('@/composables/usePodExport', () => ({
  usePodExport: () => ({
    isExporting: { value: false },
    // R2: the compaction builds the envelope ONCE and hands the same bytes to
    // the OS and to the safety copy, so it calls `deliverPod`, not the
    // build-and-deliver wrapper.
    deliverPod: deliverPod,
    confirmBackupLanded: vi.fn(async () => hooks.backupLanded),
  }),
}));
vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => ({ activeFamilyId: 'fam-1' }),
}));
const updateMember = vi.fn(async () => null);
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({ members: hooks.members, updateMember }),
}));
vi.mock('@/services/sync/syncService', () => ({
  flushPendingSave: vi.fn(async () => {}),
  isFullySynced: vi.fn(async () => hooks.synced),
  // The write proof: a revoked file permission or an expired token must be
  // caught BEFORE the lineage is stamped, not at the publish.
  hasPermission: vi.fn(async () => hooks.canWrite),
  getProvider: () => (hooks.hasProvider ? providerStub : null),
}));
vi.mock('@/services/sync/storageProvider', () => ({
  getAuxStore: (p: unknown) => (p && hooks.auxAvailable ? auxStub : null),
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
const deliverPod = vi.fn(async () => hooks.exported);
const buildExportEnvelope = vi.fn(async () => ({
  json: '{"version":"4.0"}',
  filename: 'f.beanpod',
}));
const auxWrite = vi.fn(async () => {});
const auxRead = vi.fn<() => Promise<string | null>>(async () => '{"version":"4.0"}');
const auxDelete = vi.fn(async () => {});
const auxStub = { list: vi.fn(), read: auxRead, write: auxWrite, delete: auxDelete };
const providerStub = { getDisplayName: () => 'family.beanpod' };
const replaceEnvelope = vi.fn();
// The unconditional pull. `isFullySynced` trusts a change probe that, with no
// revision, compares mtimes — so compaction pulls without consulting it.
const loadFromFile = vi.fn(async () => ({ success: hooks.pulled }));
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({
    syncNow,
    replaceEnvelope,
    loadFromFile,
    buildExportEnvelope,
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
    hasProvider: true,
    auxAvailable: true,
    members: [],
    isOwner: true,
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

/**
 * R2 — the automatic safety copy beside the pod.
 *
 * The manual export is a file the family has to keep track of. This one sits in
 * the same folder as the pod, is findable months later, and is written before
 * anything is destroyed.
 */
describe('the automatic safety copy', () => {
  it('writes it beside the pod, named from the pod own file name', async () => {
    await usePodCompaction().compact();

    // ⚠️ DERIVED, never a fixed constant. The Drive app folder is per-ACCOUNT,
    // so one account owning two families keeps both pods in one folder and a
    // global name would have each compaction overwrite the other's copy.
    expect(auxWrite).toHaveBeenCalledWith(
      'family (before compacting).beanpod',
      '{"version":"4.0"}'
    );
  });

  it('builds the envelope ONCE and gives the same bytes to both', async () => {
    await usePodCompaction().compact();

    expect(buildExportEnvelope).toHaveBeenCalledTimes(1);
    expect(deliverPod).toHaveBeenCalledWith(
      { json: '{"version":"4.0"}', filename: 'f.beanpod' },
      expect.anything()
    );
  });

  it('compares what came BACK against what went out, not against itself', async () => {
    // ⚠️ THE HEADLINE GUARANTEE, and it had no test at all: verifying the
    // in-memory bytes instead of the round trip passed all sixteen. That is the
    // likeliest refactoring mistake here — it looks like a free allocation
    // saving — and it silently turns the check into a no-op. Drive returns
    // DIFFERENT bytes, so a check against `built.json` cannot notice.
    auxRead.mockResolvedValueOnce('{"version":"4.0","truncated":true}');

    await usePodCompaction().compact();

    expect(auxRead).toHaveBeenCalledWith('family (before compacting).beanpod');
    expect(docClient.compactDoc).not.toHaveBeenCalled();
  });

  it('removes a damaged copy rather than leaving it in the picker', async () => {
    // The copy IS in the folder and it is wrong. Telling the user nothing was
    // saved would leave a bad file described to them as their rollback point.
    auxRead.mockResolvedValueOnce('{"version":"4.0","truncated":true}');

    await usePodCompaction().compact();

    expect(auxDelete).toHaveBeenCalledWith('family (before compacting).beanpod');
    expect(showToast).toHaveBeenCalledWith(
      'warning',
      'compaction.refused',
      'compaction.refused.safety-copy-damaged',
      expect.anything()
    );
  });

  it('REFUSES, changing nothing, when the copy vanished between write and read', async () => {
    auxRead.mockResolvedValueOnce(null);

    await usePodCompaction().compact();

    expect(docClient.compactDoc).not.toHaveBeenCalled();
  });

  it('REFUSES, changing nothing, when the copy cannot be written', async () => {
    auxWrite.mockRejectedValueOnce(new Error('drive said no'));

    await usePodCompaction().compact();

    expect(docClient.compactDoc).not.toHaveBeenCalled();
  });

  it('reports every safety-copy refusal — none is silent', async () => {
    // CLAUDE.md makes diagnostics an acceptance criterion. Every one of these
    // could be deleted with the suite green before this test existed.
    auxWrite.mockRejectedValueOnce(new Error('drive said no'));

    await usePodCompaction().compact();

    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'pod-compaction',
        context: expect.objectContaining({ error_code: 'safety-copy-write' }),
      })
    );
  });

  it('tells an out-of-memory BACKUP apart from a backup that was not saved', async () => {
    // ⚠️ DIFFERENT SENTENCES. "Your data is too big for this phone" is not
    // "the backup failed to save, try again and save the file when asked" —
    // the second tells the user to do something they were never asked to do.
    buildExportEnvelope.mockRejectedValueOnce(new PayloadTooLargeError('oom', 'load', 'fam-1'));

    await usePodCompaction().compact();

    expect(docClient.compactDoc).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      'warning',
      'compaction.refused',
      'compaction.refused.backup-too-large',
      expect.anything()
    );
  });

  it('does not swallow the build failure', async () => {
    buildExportEnvelope.mockRejectedValueOnce(new Error('nope'));

    await usePodCompaction().compact();

    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ error_code: 'backup-build-failed' }),
      })
    );
  });

  it('keeps the manual gate when the provider cannot write siblings', async () => {
    // ⚠️ A LOCAL-FILE FAMILY, not "no provider at all" — which is what the
    // previous version of this test actually exercised. The provider exists and
    // works; it simply has no aux store.
    hooks.auxAvailable = false;

    await usePodCompaction().compact();

    expect(auxWrite).not.toHaveBeenCalled();
    expect(docClient.compactDoc).toHaveBeenCalled();
  });

  it('does not crash when there is no provider at all', async () => {
    // `getAuxStore(null)` throws in production; the guard is `provider ? … :
    // null`, and the test double is null-tolerant so it cannot see the crash.
    hooks.hasProvider = false;

    await usePodCompaction().compact();

    expect(docClient.compactDoc).toHaveBeenCalled();
  });
});

describe('the owner gate', () => {
  it('refuses a non-owner before anything moves', async () => {
    // ⚠️ THE `v-if` IS NOT THE GATE. Hiding the Settings section stops the
    // button from rendering; it does not stop `compact()` from running — a
    // stale render, a keyboard activation as a role changes, or any future
    // caller reaches the function directly. The action that rewrites every
    // device's copy has to check for itself.
    hooks.isOwner = false;

    await usePodCompaction().compact();

    expect(docClient.compactDoc).not.toHaveBeenCalled();
    // Before the confirm, so a non-owner is never asked a question that would
    // then be refused.
    expect(confirm).not.toHaveBeenCalled();
    expect(flushPendingSave).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      'warning',
      'compaction.refused',
      'compaction.refused.not-owner',
      expect.anything()
    );
  });
});

/**
 * The soak gate — the reason compaction cannot run while a family member's
 * device has not yet seen a build that honours the lineage guard.
 */
describe('after a successful compaction', () => {
  it('clears the out-of-memory marks it just resolved', async () => {
    // ⚠️ Nothing else clears them. Without this the due note keeps telling the
    // owner a device cannot open the file — inviting the same one-way,
    // history-destroying migration forever, on a file that is now small.
    hooks.members = [
      {
        id: 'm2',
        name: 'Sam',
        lastLoginAt: TODAY,
        lineageEpoch: 1,
        podTooLargeSeenAt: '2026-03-04',
      },
    ];

    await usePodCompaction().compact();

    expect(docClient.compactDoc).toHaveBeenCalled();
    expect(updateMember).toHaveBeenCalledWith('m2', { podTooLargeSeenAt: undefined });
  });

  it('does not touch a member who never reported one', async () => {
    hooks.members = [{ id: 'm2', name: 'Sam', lastLoginAt: TODAY, lineageEpoch: 1 }];

    await usePodCompaction().compact();

    expect(updateMember).not.toHaveBeenCalled();
  });
});

const TODAY = new Date().toISOString().slice(0, 10);

describe('the soak gate', () => {
  const stale = [{ id: 'm2', name: 'Sam', lastLoginAt: new Date().toISOString().slice(0, 10) }];
  const current = [
    { id: 'm2', name: 'Sam', lastLoginAt: new Date().toISOString().slice(0, 10), lineageEpoch: 1 },
  ];

  it('refuses BEFORE asking, so the app never asks a question it will not honour', async () => {
    hooks.members = stale;

    await usePodCompaction().compact();

    expect(confirm).not.toHaveBeenCalled();
    expect(docClient.compactDoc).not.toHaveBeenCalled();
  });

  it('NAMES who it is waiting on from the FIRST reading too', async () => {
    // ⚠️ THE READING A PERSON ACTUALLY HITS. The fast-fail gate returns before
    // the confirm, so it is the refusal almost everyone sees — and it called the
    // generic `refuse('not-soaked')`, whose string is "someone in your family
    // has a device that has not opened beanies recently". The names were in
    // `preSoak.behind` the whole time. Greg hit this on the first step of the
    // soak and could not tell who or what to do, which is the whole point of
    // the gate being actionable.
    hooks.members = [
      { id: 'm2', name: 'Sam', lastLoginAt: TODAY },
      { id: 'm3', name: 'Alex', lastLoginAt: TODAY },
    ];

    await usePodCompaction().compact();

    expect(confirm).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      'warning',
      'compaction.refused',
      'compaction.refused.not-soaked.named:Sam, Alex',
      expect.anything()
    );
  });

  it('names who it is waiting for once the projection is current', async () => {
    // ⚠️ The second reading is the AUTHORITATIVE one: the pull at step 2b is
    // what makes the member projection current, so a device that signed in on
    // an old build ten minutes ago is not in our copy until then. The first
    // reading only fails fast.
    hooks.members = current;
    loadFromFile.mockImplementationOnce(async () => {
      hooks.members = stale; // the pull brought a stale member into view
      return { success: true };
    });

    await usePodCompaction().compact();

    expect(docClient.compactDoc).not.toHaveBeenCalled();
    // The NAME, not just the key: a refusal you can act on beats one you can
    // only be puzzled by, and the generic refusal satisfies the key alone.
    expect(showToast).toHaveBeenCalledWith(
      'warning',
      'compaction.refused',
      expect.stringContaining('Sam'),
      expect.anything()
    );
  });

  it('says plainly that nothing is left to do when everyone is current', async () => {
    hooks.members = current;

    await usePodCompaction().compact();

    expect(docClient.compactDoc).toHaveBeenCalled();
    const detail = vi.mocked(showToast).mock.calls.at(-1)?.[2] ?? '';
    expect(detail).toContain('compaction.doneNothingToDo');
  });

  it('NAMES the exception rather than reporting a bare done', async () => {
    // A completion silent about a device that cannot converge withholds
    // information it holds — the same defect as the transient toast the lineage
    // banner replaced.
    hooks.members = current;
    let compacted = false;
    vi.mocked(docClient.compactDoc).mockImplementation((() => {
      compacted = true;
      hooks.members = stale; // someone joined on an old build mid-flight
      return {
        beforeBytes: 2_000_000,
        afterBytes: 170_000,
        changesBefore: 10_000,
        changesAfter: 1,
        actorsBefore: 2_600,
      };
    }) as never);

    await usePodCompaction().compact();

    expect(compacted).toBe(true);
    const detail = vi.mocked(showToast).mock.calls.at(-1)?.[2] ?? '';
    expect(detail).toContain('compaction.doneButBehind');
    expect(detail).toContain('Sam');
  });
});
