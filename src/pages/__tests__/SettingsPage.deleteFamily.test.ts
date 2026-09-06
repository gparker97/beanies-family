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
  deleteDriveFileMock,
  signOutMock,
  showToastMock,
  resetAllAppStoresMock,
  replaceMock,
  confirmMock,
  isNativeMock,
} = vi.hoisted(() => ({
  confirmMock: vi.fn(async () => true),
  isNativeMock: vi.fn(() => false),
  deliverFileMock: vi.fn(
    async (_opts: import('@/utils/deliverFile').DeliverFileOptions) =>
      ({
        outcome: 'downloaded',
        delivered: true,
      }) as import('@/utils/shareOrDownloadFile').ShareOrDownloadResult
  ),
  deleteLocalFamilyMock: vi.fn(async () => {}),
  deleteDriveFileMock: vi.fn(async () => {}),
  signOutMock: vi.fn(async () => {}),
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
  alert: vi.fn(async () => {}),
  confirm: confirmMock,
}));
vi.mock('@/services/sync/capabilities', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/sync/capabilities')>()),
  isNative: () => isNativeMock(),
}));
vi.mock('@/composables/useReauth', () => ({
  requireReauth: vi.fn(async () => true),
  canStepUp: () => false,
}));
vi.mock('@/services/sync/fileSync', async (importOriginal) => ({
  // The version DERIVATION is real even where the writers are mocked: a
  // test-local `'4.0'` here would hide the one regression the derivation
  // exists to prevent (a compacted pod written as 4.0).
  beanpodVersionFor: (await importOriginal<typeof import('@/services/sync/fileSync')>())
    .beanpodVersionFor,
  tryUnwrapFamilyKey: vi.fn(async () => {}),
}));
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
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));

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

/** Tick "export my data first", type the confirmation, and submit the password. */
async function runDeleteWithExport(wrapper: Awaited<ReturnType<typeof mountPage>>) {
  const label = wrapper
    .findAll('label')
    .find((l) => l.text().includes('settings.deleteFamilyExport'));
  expect(label, 'export checkbox not found').toBeTruthy();
  await label!.find('input[type="checkbox"]').setValue(true);

  const gate = wrapper
    .findAllComponents({ name: 'PasswordModal' })
    .find((m) => m.props('title') === 'settings.deleteFamily');
  expect(gate, 'delete-family password gate not found').toBeTruthy();
  gate!.vm.$emit('confirm', 'pw');
  await flushPromises();
}

describe('SettingsPage — delete family export gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deliverFileMock.mockResolvedValue({ outcome: 'downloaded', delivered: true });
    confirmMock.mockResolvedValue(true);
    isNativeMock.mockReturnValue(false);
    setActivePinia(createPinia());
  });

  it('deletes when the export actually landed', async () => {
    const wrapper = await mountPage();
    await runDeleteWithExport(wrapper);

    expect(deliverFileMock).toHaveBeenCalledTimes(1);
    expect(deleteLocalFamilyMock).toHaveBeenCalledWith('fam-1');
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
