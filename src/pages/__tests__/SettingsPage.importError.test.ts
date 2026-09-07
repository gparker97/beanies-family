/**
 * A refused family file must SAY so, in the branch the person is standing in.
 *
 * ⚠️ THE BUG THIS PINS shipped for months and nobody could have caught it by
 * reading the template. `importError` had exactly one render site, inside a
 * `<div v-else>` whose `v-if` partner tested `canAutoSync()` — a predicate that
 * `return true`s unconditionally. So the branch was dead on every platform, the
 * failure arm was mute, and the sentence surfaced instead in the POD's
 * sync-failure slab, beside a Force Save button, over a family that was still
 * open. It read exactly like "warned me, then loaded it anyway".
 *
 * ⚠️ AND IT MOUNTS WITH `isConfigured: false` DELIBERATELY. The two buttons that
 * reach `handleLoadFromFileConfirmed` live in different sibling divs, and the
 * not-configured one — the state a locked-out person is in — had no slab of any
 * kind. A test against the configured state alone would pass over the half that
 * matters most.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { UnsupportedBeanpodVersionError } from '@/types/sync';

const { loadFromNewFileMock } = vi.hoisted(() => ({
  loadFromNewFileMock: vi.fn(),
}));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/settings', query: {}, name: 'Settings' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@/composables/useConfirm', () => ({
  alert: vi.fn(async () => {}),
  confirm: vi.fn(async () => true),
}));
vi.mock('@/composables/useReauth', () => ({
  requireReauth: vi.fn(async () => true),
  canStepUp: () => false,
}));
vi.mock('@/services/automerge/projection', () => ({ list: () => [], getSettings: () => ({}) }));
vi.mock('@/services/analytics/plausible', () => ({ track: vi.fn() }));
// The Family Data drawer is gated on `canManagePod`; without it nothing under
// test renders at all.
vi.mock('@/composables/usePermissions', () => ({
  usePermissions: () => ({ canManagePod: true, isOwner: true }),
}));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/services/indexeddb/database', () => ({ deleteFamilyDatabase: vi.fn(async () => {}) }));
vi.mock('@/services/sync/fileHandleStore', () => ({ getProviderConfig: vi.fn(async () => null) }));
vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => ({ activeFamilyId: 'fam-1', deleteLocalFamily: vi.fn() }),
}));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ signOutAndClearData: vi.fn(), currentMember: null }),
}));

import SettingsPage from '@/pages/SettingsPage.vue';
import { useSyncStore } from '@/stores/syncStore';

const SlotStub = { template: '<div><slot /></div>' };

async function mountPage() {
  const wrapper = mount(SettingsPage, {
    shallow: true,
    global: { stubs: { BeanieFormModal: SlotStub, BaseModal: SlotStub, transition: false } },
  });
  await flushPromises();
  return wrapper;
}

describe('SettingsPage — a refused family file says so', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    const sync = useSyncStore();
    // The state a locked-out person is in: no family file configured yet.
    (sync as unknown as { isConfigured: boolean }).isConfigured = false;
    sync.loadFromNewFile = loadFromNewFileMock;
  });

  /** Open the Family Data drawer, which is where every assertion below lives. */
  async function openFamilyData(w: Awaited<ReturnType<typeof mountPage>>) {
    (w.vm as unknown as { showFamilyData: boolean }).showFamilyData = true;
    await flushPromises();
  }

  it('renders the refusal when the picked file is from a newer beanies', async () => {
    loadFromNewFileMock.mockResolvedValue({
      success: false,
      payloadError: new UnsupportedBeanpodVersionError('6.0', 'fam-1'),
    });
    const wrapper = await mountPage();
    await openFamilyData(wrapper);

    await (
      wrapper.vm as unknown as { handleLoadFromFileConfirmed: () => Promise<void> }
    ).handleLoadFromFileConfirmed();
    await flushPromises();

    expect(wrapper.text()).toContain('podNewerVersion.inline');
  });

  it('renders a generic refusal when the file could not be read at all', async () => {
    loadFromNewFileMock.mockResolvedValue({ success: false });
    const wrapper = await mountPage();
    await openFamilyData(wrapper);

    await (
      wrapper.vm as unknown as { handleLoadFromFileConfirmed: () => Promise<void> }
    ).handleLoadFromFileConfirmed();
    await flushPromises();

    expect(wrapper.text()).toContain('settings.importFailed');
  });

  it('says nothing at all before anything has been picked', async () => {
    const wrapper = await mountPage();
    await openFamilyData(wrapper);
    expect(wrapper.text()).not.toContain('settings.importFailed');
    expect(wrapper.text()).not.toContain('podNewerVersion.inline');
  });

  it('says nothing when the pick SUCCEEDS', async () => {
    loadFromNewFileMock.mockResolvedValue({ success: true });
    const wrapper = await mountPage();
    await openFamilyData(wrapper);

    await (
      wrapper.vm as unknown as { handleLoadFromFileConfirmed: () => Promise<void> }
    ).handleLoadFromFileConfirmed();
    await flushPromises();

    expect(wrapper.text()).not.toContain('settings.importFailed');
    expect(wrapper.text()).not.toContain('podNewerVersion.inline');
  });
});
