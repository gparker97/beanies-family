/**
 * The delete-family export gate.
 *
 * "Export my data first" was fire-and-forget: the page ticked the box, called
 * the export, ignored the result and deleted the family. On native the export
 * was a guaranteed no-op (`<a download>` is inert in a WebView), so a user could
 * ask for a backup, receive nothing, and lose everything a second later. These
 * tests pin the gate — including the CANCELLED case, which is not an error but
 * still means no backup exists.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';

const {
  deliverFileMock,
  deleteLocalFamilyMock,
  removeFamilyMock,
  alertMock,
  deleteDriveFileMock,
  signOutMock,
  reportErrorMock,
  emitCacheKeptMock,
  showToastMock,
  resetAllAppStoresMock,
  replaceMock,
  confirmMock,
  isNativeMock,
  requireReauthMock,
} = vi.hoisted(() => ({
  confirmMock: vi.fn(async () => true),
  isNativeMock: vi.fn(() => false),
  requireReauthMock: vi.fn(async () => true),
  deliverFileMock: vi.fn(
    async (_opts: import('@/utils/deliverFile').DeliverFileOptions) =>
      ({
        outcome: 'downloaded',
        delivered: true,
      }) as import('@/utils/shareOrDownloadFile').ShareOrDownloadResult
  ),
  // ⚠️ RETURNS A CLEAN RESULT, like the real one. `familyContextStore.deleteLocalFamily`
  // catches every throw and returns `null`, or the cache-delete outcome (#100), and the
  // delete flow treats `null` or `deleted: false` as "the local data survived" and says
  // so in the farewell — so a double returning `undefined` describes a failing teardown
  // on every test.
  deleteLocalFamilyMock: vi.fn(async (): Promise<{ deleted: boolean } | null> => ({
    deleted: true,
  })),
  removeFamilyMock: vi.fn(async () => true),
  alertMock: vi.fn(async () => {}),
  deleteDriveFileMock: vi.fn(async () => {}),
  signOutMock: vi.fn(async () => {}),
  reportErrorMock: vi.fn(),
  emitCacheKeptMock: vi.fn(),
  showToastMock: vi.fn(),
  resetAllAppStoresMock: vi.fn(),
  replaceMock: vi.fn(),
}));

vi.mock('@/utils/deliverFile', () => ({ deliverFile: deliverFileMock }));
vi.mock('@/composables/useToast', () => ({ showToast: showToastMock }));
vi.mock('@/utils/resetStores', () => ({ resetAllAppStores: resetAllAppStoresMock }));
vi.mock('@/services/google/driveService', () => ({ deleteFile: deleteDriveFileMock }));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/settings', query: {}, name: 'Settings' }),
  useRouter: () => ({ push: vi.fn(), replace: replaceMock }),
}));
vi.mock('@/composables/useConfirm', () => ({
  alert: alertMock,
  confirm: confirmMock,
}));
vi.mock('@/services/sync/capabilities', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/sync/capabilities')>()),
  isNative: () => isNativeMock(),
}));
vi.mock('@/composables/useReauth', () => ({
  requireReauth: requireReauthMock,
  // ⚠️ `false` ON PURPOSE, and it must stay irrelevant to delete-family. The gate here is
  // HARD: unlike `handleClearData`, which skips the step-up when `canStepUp()` is false
  // because clearing LOCAL data is the recovery escape hatch, deleting the family
  // destroys the Drive file, the registry row and every member's copy. If a future change
  // makes deletion depend on this value, these tests go green while the gate goes away.
  canStepUp: () => false,
}));
vi.mock('@/services/sync/fileSync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/sync/fileSync')>();
  return {
    // The version DERIVATION is real even where the writers are mocked: a
    // test-local `'4.0'` here would hide the one regression the derivation
    // exists to prevent (a compacted pod written as 4.0).
    beanpodVersionFor: actual.beanpodVersionFor,
    // Pure, envelope-shape-only decisions. Real for the same reason: stubbing them would
    // hide the defect they exist to prevent, which is a surface offering a credential the
    // envelope cannot accept.
    envelopeCapabilities: actual.envelopeCapabilities,
    secretFieldFor: actual.secretFieldFor,
    tryUnwrapFamilyKey: vi.fn(async () => {}),
  };
});
vi.mock('@/services/indexeddb/database', () => ({ deleteFamilyDatabase: vi.fn(async () => {}) }));
vi.mock('@/services/sync/fileHandleStore', () => ({ getProviderConfig: vi.fn(async () => null) }));
vi.mock('@/services/automerge/projection', () => ({
  list: () => [],
  getSettings: () => ({}),
}));
vi.mock('@/services/analytics/plausible', () => ({ track: vi.fn() }));
vi.mock('@/services/google/googleAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/google/googleAuth')>()),
  getValidToken: vi.fn(async () => 'tok'),
  isUserCancellation: () => false,
  shouldUseRedirectAuth: () => false,
}));
vi.mock('@/utils/errorReporter', () => ({ reportError: reportErrorMock }));
vi.mock('@/services/telemetry/loginFlowEvents', () => ({ emitCacheKept: emitCacheKeptMock }));

// The owner-gated full deletion now removes the family's SHARED registry row
// itself, explicitly and before the local teardown (2026-09-08): the per-device
// `deleteLocalFamily` no longer does it, because that row belongs to the whole
// family. Unmocked, this would reach a real `fetch`.
vi.mock('@/services/registry/registryService', () => ({
  removeFamily: removeFamilyMock,
}));

vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => ({
    activeFamilyId: 'fam-1',
    deleteLocalFamily: deleteLocalFamilyMock,
  }),
}));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ signOutAndClearData: signOutMock, currentMember: null }),
}));

// Import AFTER the mocks
import SettingsPage from '@/pages/SettingsPage.vue';
import { COLLECTION_NAMES } from '@/types/automerge';

/** Renders the default slot so the modal's own form controls are reachable. */
const SlotStub = { template: '<div><slot /></div>' };

async function mountPage() {
  const wrapper = mount(SettingsPage, {
    shallow: true,
    global: {
      stubs: { BeanieFormModal: SlotStub, BaseModal: SlotStub, transition: false },
    },
  });
  await flushPromises();
  return wrapper;
}

/**
 * Tick "export my data first", type the confirmation, and press Delete.
 *
 * ⚠️ NO PASSWORD MODAL ANY MORE. This used to submit a bespoke `PasswordModal` that
 * verified with `tryUnwrapFamilyKey`, which a PIN-led family could never satisfy (a PIN
 * is never an envelope wrap) and which skipped itself entirely when the envelope was
 * null. Identity now goes through the canonical step-up, `requireReauth`, mocked at the
 * top of this file. What remains on screen is the typed confirmation, which proves
 * INTENT; the gate proves IDENTITY, and they are deliberately different questions.
 */
async function runDeleteWithExport(wrapper: Awaited<ReturnType<typeof mountPage>>) {
  const label = wrapper
    .findAll('label')
    .find((l) => l.text().includes('settings.deleteFamilyExport'));
  expect(label, 'export checkbox not found').toBeTruthy();
  await label!.find('input[type="checkbox"]').setValue(true);

  await typeConfirmationAndPressDelete(wrapper);
}

/**
 * The confirmation field plus the danger button, which is the whole surface now.
 *
 * ⚠️ THE BUTTON IS IDENTIFIED BY ITS INTENT GATE, not by its label. The page is mounted
 * `shallow`, so `BaseButton` is a stub: its slot text is not rendered and a real DOM
 * click never reaches the handler. Four danger buttons exist on this page, and the only
 * one that starts DISABLED is this one, because it waits for the typed confirmation. That
 * makes the gate itself the selector, so a change that dropped the typed confirmation
 * would fail here rather than silently select a different button.
 */
async function typeConfirmationAndPressDelete(wrapper: Awaited<ReturnType<typeof mountPage>>) {
  const button = wrapper
    .findAllComponents({ name: 'BaseButton' })
    .find((b) => b.props('variant') === 'danger' && b.props('disabled') === true);
  expect(button, 'delete button (disabled until confirmed) not found').toBeTruthy();

  const input = wrapper
    .findAllComponents({ name: 'BaseInput' })
    .find((c) => c.props('label') === 'settings.deleteFamilyTypeConfirm');
  expect(input, 'delete confirmation field not found').toBeTruthy();
  input!.vm.$emit('update:modelValue', 'delete');
  await flushPromises();

  // Typing the word is what arms it. If this ever reads `true`, the intent gate is gone.
  expect(button!.props('disabled')).toBe(false);

  button!.vm.$emit('click');
  await flushPromises();
}

describe('SettingsPage — delete family export gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deliverFileMock.mockResolvedValue({ outcome: 'downloaded', delivered: true });
    confirmMock.mockResolvedValue(true);
    isNativeMock.mockReturnValue(false);
    requireReauthMock.mockResolvedValue(true);
    deleteLocalFamilyMock.mockResolvedValue({ deleted: true });
    setActivePinia(createPinia());
  });

  // #100: two different ways the local data can survive, told apart in telemetry.
  it('a cache another tab kept is a WARNING, and the farewell says local data was kept', async () => {
    deleteLocalFamilyMock.mockResolvedValue({ deleted: false });
    const wrapper = await mountPage();
    await runDeleteWithExport(wrapper);

    expect(reportErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'warning',
        context: expect.objectContaining({ error_code: 'cache-kept-other-tabs' }),
      })
    );
    expect(emitCacheKeptMock).toHaveBeenCalledWith('delete-family');
    expect(alertMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: 'settings.deleteFamilyFarewellKeptFileMsg' })
    );
  });

  it('a teardown that threw stays CRITICAL and is not counted as a kept cache', async () => {
    deleteLocalFamilyMock.mockResolvedValue(null);
    const wrapper = await mountPage();
    await runDeleteWithExport(wrapper);

    expect(reportErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'critical',
        context: expect.objectContaining({ error_code: 'local-delete-failed' }),
      })
    );
    expect(emitCacheKeptMock).not.toHaveBeenCalled();
  });

  it('destroys nothing when the step-up gate refuses', async () => {
    // The whole point of the change. A cancel, a PIN run out of attempts, and a member
    // with no credential at all arrive here identically: `requireReauth` resolves false,
    // and nothing irreversible may follow. The export is included in the assertion
    // because it runs FIRST in the delete sequence, so a gate placed one step too late
    // would still have shipped the family's data to disk.
    requireReauthMock.mockResolvedValue(false);
    const wrapper = await mountPage();
    await runDeleteWithExport(wrapper);

    expect(requireReauthMock).toHaveBeenCalledTimes(1);
    expect(deliverFileMock).not.toHaveBeenCalled();
    expect(deleteLocalFamilyMock).not.toHaveBeenCalled();
    expect(removeFamilyMock).not.toHaveBeenCalled();
    expect(deleteDriveFileMock).not.toHaveBeenCalled();
  });

  it('asks for the step-up BEFORE it destroys anything', async () => {
    // Ordering, not merely presence. Asserting only that the gate was called would pass
    // a version that deleted first and asked afterwards.
    const calls: string[] = [];
    requireReauthMock.mockImplementation(async () => {
      calls.push('reauth');
      return true;
    });
    deliverFileMock.mockImplementation(async () => {
      calls.push('export');
      return { outcome: 'downloaded', delivered: true };
    });
    deleteLocalFamilyMock.mockImplementation(async () => {
      calls.push('delete');
      return { deleted: true };
    });

    const wrapper = await mountPage();
    await runDeleteWithExport(wrapper);

    expect(calls[0]).toBe('reauth');
    expect(calls).toContain('delete');
  });

  it('deletes when the export actually landed', async () => {
    const wrapper = await mountPage();
    await runDeleteWithExport(wrapper);

    expect(deliverFileMock).toHaveBeenCalledTimes(1);
    expect(deleteLocalFamilyMock).toHaveBeenCalledWith('fam-1');

    // ⚠️ NOT REMOVED, and this assertion has now been wrong in both directions.
    // Nothing deleted a pod file on this path — the Drive checkbox is unticked —
    // so the file is still out there and the row is its pointer. A row deleted
    // under a live pod is recreated by the next device to write, which stamps
    // THAT member as owner, permanently. A surviving row is merely an ops
    // nuisance. The asymmetry is why the gate proves deletion rather than
    // inferring it from intent or from session state.
    expect(removeFamilyMock).not.toHaveBeenCalled();
  });

  it('does NOT cry failure on the default path, where nothing failed', async () => {
    // ⚠️ THIS ASSERTION HAS NOW BEEN WRONG IN BOTH DIRECTIONS, so both are worth
    // writing down. The farewell first claimed "deleted from all systems"
    // unconditionally, which is false whenever the row stays. The fix then
    // flipped every ordinary deletion to "Not everything could be removed for
    // you — get in touch", which is worse: this IS the default path (the Drive
    // checkbox is opt-in, and never rendered at all for a local-file family), the
    // user CHOSE to keep their family data file, and nothing went wrong.
    //
    // "Could not" is reserved for something the user asked for that did not
    // happen. Keeping the file they kept is not that.
    const wrapper = await mountPage();
    await runDeleteWithExport(wrapper);

    // ⚠️ THE THIRD MESSAGE, and it exists because the other two have each been
    // wrong here. "Deleted from all systems" is FALSE — the user kept their
    // family data file and the registry row still points at it. "Not everything
    // could be removed" is ALARMING and also false — nothing failed, this is
    // what they chose. So the default path says what actually happened.
    expect(alertMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'settings.deleteFamilyFarewellKeptFileMsg' })
    );
  });

  it('gates the shared registry removal on the pod file actually being GONE', async () => {
    // The behavioural half is above: the default keep-the-pod path must not
    // remove the row. This half pins the gate itself.
    //
    // ⚠️ AN EARLIER CUT OF THIS ASSERTION WAS DEGENERATE. It searched for a
    // comment that sits AFTER the slice point, so `lastIndexOf` returned -1 and
    // the whole thing reduced to "some `if` appears earlier in the file" — it
    // stayed green with the gate deleted, satisfied by an unrelated gate.
    //
    // It also pins the SHAPE of the gate. Gating on the user's intent
    // (`wantDeleteDrive`) rather than the outcome let a FAILED Drive delete
    // remove the row anyway, and left local-file families — whose checkbox never
    // renders — unable to remove it through any path at all.
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/pages/SettingsPage.vue', 'utf8');

    // Matched loosely: the call gained a `writerMemberId` argument and wrapped
    // across lines, and an assertion pinned to one formatting of it is an
    // assertion that breaks on `prettier --write` rather than on a regression.
    const call = source.search(/await removeFamily\(\s*familyId/);
    expect(call, 'removeFamily call not found').toBeGreaterThan(-1);

    const gate = source.lastIndexOf('if (podFileDeleted) {', call);
    expect(gate, 'the removal is not inside the podFileDeleted gate').toBeGreaterThan(-1);
    // Immediately enclosing, not merely somewhere earlier in the file.
    expect(call - gate).toBeLessThan(400);

    // The flag must default false and be set in exactly ONE place: after the
    // delete returns. Every inference tried instead (the checkbox, the session's
    // provider state, a null config) removed the row with the pod still alive.
    expect(source).toContain('let podFileDeleted = false');
    expect(source.match(/podFileDeleted = true/g) ?? []).toHaveLength(1);
  });

  it('aborts the deletion when the export FAILED', async () => {
    deliverFileMock.mockResolvedValue({ outcome: 'failed', delivered: false, stage: 'share' });
    const wrapper = await mountPage();
    await runDeleteWithExport(wrapper);

    expect(deleteLocalFamilyMock).not.toHaveBeenCalled();
    expect(deleteDriveFileMock).not.toHaveBeenCalled();
    expect(signOutMock).not.toHaveBeenCalled();
    // The user is told why nothing happened — silently returning to a closed
    // drawer would read as "delete did nothing".
    expect(showToastMock).toHaveBeenCalledWith(
      'error',
      'settings.deleteFamilyExportFailed',
      'settings.deleteFamilyExportFailedHelp',
      // Silent: `deliverFile` already fired the one critical report.
      { silent: true }
    );
  });

  it('aborts the deletion when the export was CANCELLED', async () => {
    // Not an error, but no backup exists — so the destructive step must not run.
    deliverFileMock.mockResolvedValue({ outcome: 'cancelled', delivered: false });
    const wrapper = await mountPage();
    await runDeleteWithExport(wrapper);

    expect(deleteLocalFamilyMock).not.toHaveBeenCalled();
    expect(resetAllAppStoresMock).not.toHaveBeenCalled();
  });

  it('asks for a critical, caller-rendered error so there is exactly one message', async () => {
    const wrapper = await mountPage();
    await runDeleteWithExport(wrapper);
    expect(deliverFileMock.mock.calls[0][0]).toMatchObject({
      kind: 'readable-json',
      errorUi: 'caller',
      critical: true,
    });
  });

  it('asks the user to confirm the export really saved — on native only', async () => {
    // `SharePlugin.java:59` resolves the share unless the chooser returned
    // RESULT_CANCELED *and* `stopped` is false, and `handleOnStop()` sets
    // `stopped` the moment the chosen app foregrounds. So picking Gmail and
    // then discarding the draft resolves exactly like saving to Files. The OS
    // cannot tell us, so before an irreversible delete a human must.
    isNativeMock.mockReturnValue(true);
    const wrapper = await mountPage();
    await runDeleteWithExport(wrapper);

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(deleteLocalFamilyMock).toHaveBeenCalledWith('fam-1');
  });

  it('aborts when the user says the export did NOT save', async () => {
    isNativeMock.mockReturnValue(true);
    confirmMock.mockResolvedValue(false);
    const wrapper = await mountPage();
    await runDeleteWithExport(wrapper);

    expect(deleteLocalFamilyMock).not.toHaveBeenCalled();
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it('does not ask on web, where the download is deterministic', async () => {
    const wrapper = await mountPage();
    await runDeleteWithExport(wrapper);
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('asks for a plain download, never a share sheet', async () => {
    // On a share-capable desktop the sheet offers no save-to-disk, and
    // `navigator.share` needs transient activation a large stringify outlives.
    const wrapper = await mountPage();
    await runDeleteWithExport(wrapper);
    expect(deliverFileMock.mock.calls[0][0]).toMatchObject({ preferDownload: true });
  });

  it('leaves "export my data first" ticked when the export failed', async () => {
    // The toast tells the user to retry the export or untick it. Clearing the
    // box for them meant someone following that advice confirmed again with no
    // gate and no backup.
    deliverFileMock.mockResolvedValue({ outcome: 'failed', delivered: false, stage: 'share' });
    const wrapper = await mountPage();
    await runDeleteWithExport(wrapper);

    const label = wrapper
      .findAll('label')
      .find((l) => l.text().includes('settings.deleteFamilyExport'));
    expect((label!.find('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(true);
  });

  it('exports every collection, not a hand-picked subset', async () => {
    // The list this replaced held 10 of 29, so the cookbook, medications,
    // allergies, milestones, photos and emergency contacts were absent from
    // the backup that authorises deleting them.
    const wrapper = await mountPage();
    await runDeleteWithExport(wrapper);

    const json = JSON.parse(await deliverFileMock.mock.calls[0][0].blob.text());
    for (const name of COLLECTION_NAMES) expect(json).toHaveProperty(name);
    expect(json).toHaveProperty('settings');
  });
});
