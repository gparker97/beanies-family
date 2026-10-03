/**
 * C6: "forget family" on the picker. A previous sign-out may have KEPT this family's
 * database because it held work the family data file never got; forgetting it used to
 * delete that only copy behind the generic confirm. When anything is at risk, the specific
 * unsaved-work confirm (which names what goes) replaces the generic one.
 */
import { mount, flushPromises } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  report: { unsavedFamilies: 0, photoUploads: 0, remoteBlocked: false, unknown: false },
  measure: vi.fn(),
  deleteLocalFamily: vi.fn(async () => ({ deleted: true })),
  genericConfirm: vi.fn(async () => true),
  discardConfirm: vi.fn(async () => false),
}));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => ({
    allFamilies: [{ id: 'fam-1', name: 'The Beans' }],
    deleteLocalFamily: h.deleteLocalFamily,
  }),
}));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({
    resolveDeviceKeysForFamily: vi.fn(async () => []),
    measureUnsavedWorkForFamily: h.measure,
  }),
}));
vi.mock('@/services/sync/fileHandleStore', () => ({ getProviderConfig: vi.fn(async () => null) }));
vi.mock('@/composables/useConfirm', () => ({ confirm: h.genericConfirm }));
vi.mock('@/composables/useToast', () => ({ showToast: vi.fn() }));
vi.mock('@/composables/useSignOut', () => ({ notifyCacheKept: vi.fn() }));
vi.mock('@/composables/useDiscardUnsavedWork', () => ({
  confirmDiscardUnsavedWork: h.discardConfirm,
}));
vi.mock('@/services/sync/syncService', () => ({
  docPushedAgainst: vi.fn(),
  getRemoteBaselineHeadsFp: vi.fn(),
  isRemoteBlocked: vi.fn(() => null),
}));

import FamilyPickerView from '@/components/login/FamilyPickerView.vue';

async function forget() {
  const wrapper = mount(FamilyPickerView, {
    global: { stubs: { CloudProviderBadge: true } },
  });
  await flushPromises();
  await wrapper.find('button[title="action.delete"]').trigger('click');
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.measure.mockImplementation(async () => h.report);
  h.report = { unsavedFamilies: 0, photoUploads: 0, remoteBlocked: false, unknown: false };
  h.discardConfirm.mockResolvedValue(false);
});

describe('FamilyPickerView forget family (C6)', () => {
  it('a family with nothing at risk gets the ordinary confirm', async () => {
    await forget();
    expect(h.genericConfirm).toHaveBeenCalledTimes(1);
    expect(h.discardConfirm).not.toHaveBeenCalled();
    expect(h.deleteLocalFamily).toHaveBeenCalledWith('fam-1');
  });

  it('kept unpushed work gets the specific confirm, and keeping it deletes nothing', async () => {
    h.report = { unsavedFamilies: 1, photoUploads: 0, remoteBlocked: false, unknown: false };
    await forget();
    expect(h.discardConfirm).toHaveBeenCalledWith(h.report, 'forget-family');
    expect(h.genericConfirm).not.toHaveBeenCalled();
    expect(h.deleteLocalFamily).not.toHaveBeenCalled();
  });

  it('an explicit discard forgets the family', async () => {
    h.report = { unsavedFamilies: 0, photoUploads: 2, remoteBlocked: false, unknown: false };
    h.discardConfirm.mockResolvedValueOnce(true);
    await forget();
    expect(h.deleteLocalFamily).toHaveBeenCalledWith('fam-1');
  });
});
