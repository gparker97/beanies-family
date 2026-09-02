import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import CreateMembersStep from '../CreateMembersStep.vue';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockReportError = vi.fn();
vi.mock('@/utils/errorReporter', () => ({
  reportError: (...args: unknown[]) => mockReportError(...args),
}));

// familyStore: minimal owner + createMember/deleteMember spies. `owner` is
// mutated per-test (ageGroup) and reset in beforeEach; the mock returns the same
// reference so the component reads the current values.
const mockCreateMember = vi.fn();
const mockDeleteMember = vi.fn();
const owner: {
  id: string;
  name: string;
  color: string;
  gender: string;
  ageGroup: string;
  role: string;
} = {
  id: 'owner-1',
  name: 'Owner Bean',
  color: '#3b82f6',
  gender: 'male',
  ageGroup: 'adult',
  role: 'owner',
};
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({
    owner,
    // `members` must be present and iterable: colour assignment reads the REAL roster
    // (not just the beans added in this wizard) so the second bean cannot be handed the
    // owner's colour — which is exactly what the old `addedMembers.length` round-robin
    // did, because it excluded the owner.
    members: [owner],
    createMember: mockCreateMember,
    deleteMember: mockDeleteMember,
  }),
}));

/** Drive the real add-member form to add one member by name. */
async function addMember(wrapper: VueWrapper, name: string): Promise<void> {
  const addAdult = wrapper.findAll('button').find((b) => b.text().includes('loginV6.addAnAdult'));
  await addAdult!.trigger('click');
  await wrapper.find('input[type="text"], input:not([type])').setValue(name);
  const selects = wrapper.findAll('select');
  await selects[0]!.setValue('3'); // month
  await selects[1]!.setValue('14'); // day
  const addBtn = wrapper
    .findAllComponents({ name: 'BaseButton' })
    .find((b) => b.text().includes('loginV6.addMember'));
  await addBtn!.trigger('click');
  await flushPromises();
}

describe('CreateMembersStep', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    // resetAllMocks (not clearAllMocks) so queued *Once impls never leak between
    // tests; re-establish the always-on defaults it clears.
    vi.resetAllMocks();
    mockDeleteMember.mockResolvedValue(true);
    owner.ageGroup = 'adult';
  });

  it('renders the owner card with the "you" badge', () => {
    const wrapper = mount(CreateMembersStep);
    expect(wrapper.text()).toContain('Owner Bean');
    expect(wrapper.text()).toContain('loginV6.you');
  });

  it('derives the owner role label from the owner member (child → little bean)', () => {
    owner.ageGroup = 'child';
    const wrapper = mount(CreateMembersStep);
    expect(wrapper.text()).toContain('loginV6.littleBean');
    expect(wrapper.text()).not.toContain('loginV6.parentBean');
  });

  it("emits 'finish' when the Finish CTA is clicked", async () => {
    const wrapper = mount(CreateMembersStep);
    // Finish is the last BaseButton, visible while the add-member form is closed.
    const buttons = wrapper.findAllComponents({ name: 'BaseButton' });
    const finishBtn = buttons[buttons.length - 1];
    await finishBtn!.trigger('click');
    expect(wrapper.emitted('finish')).toHaveLength(1);
  });

  it('reports to telemetry (not just a toast) when createMember fails', async () => {
    // A failed member add on the create-finish surface must reportError, not
    // only set formError. Drive the real form so the actual handler path runs.
    mockCreateMember.mockResolvedValueOnce(null);
    const wrapper = mount(CreateMembersStep);
    await addMember(wrapper, 'Kiddo');

    expect(mockReportError).toHaveBeenCalledTimes(1);
    expect(mockReportError.mock.calls[0]![0]).toMatchObject({
      surface: 'createMembers.addMember',
      severity: 'warning',
    });
  });

  it('keeps the row and reports when deleteMember fails (no silent divergence)', async () => {
    mockCreateMember.mockResolvedValueOnce({
      id: 'm-2',
      name: 'Kiddo',
      color: '#ef4444',
      ageGroup: 'adult',
    });
    const wrapper = mount(CreateMembersStep);
    await addMember(wrapper, 'Kiddo');
    expect(wrapper.text()).toContain('Kiddo');

    // Removal fails — the row must stay and the failure must be reported.
    mockDeleteMember.mockResolvedValueOnce(false);
    await wrapper.find('[title="loginV6.removeMember"]').trigger('click');
    await flushPromises();

    expect(mockDeleteMember).toHaveBeenCalledWith('m-2');
    expect(wrapper.text()).toContain('Kiddo'); // row kept
    expect(mockReportError).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'createMembers.removeMember', severity: 'warning' })
    );
  });
});
