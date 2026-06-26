import { mount, flushPromises } from '@vue/test-utils';
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

// familyStore: minimal owner + createMember/deleteMember spies.
const mockCreateMember = vi.fn();
const mockDeleteMember = vi.fn(async () => {});
const owner = {
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
    createMember: mockCreateMember,
    deleteMember: mockDeleteMember,
  }),
}));

describe('CreateMembersStep', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('renders the owner card with the "you" badge', () => {
    const wrapper = mount(CreateMembersStep);
    expect(wrapper.text()).toContain('Owner Bean');
    expect(wrapper.text()).toContain('loginV6.you');
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
    // The previously-silent gap this refactor closes: a failed member add on
    // the create-finish surface must reportError, not only set formError. Drive
    // the real add-member form (open it, fill the required name + birthday,
    // submit) so the assertion exercises the actual handler path.
    mockCreateMember.mockResolvedValueOnce(null);
    const wrapper = mount(CreateMembersStep);

    // Open the add-member form via the "Add an adult" chip.
    const chips = wrapper.findAll('button');
    const addAdult = chips.find((b) => b.text().includes('loginV6.addAnAdult'));
    await addAdult!.trigger('click');

    // Fill required fields: name (BaseInput → native <input>) + month/day
    // (BaseSelect → native <select>).
    const nameInput = wrapper.find('input[type="text"], input:not([type])');
    await nameInput.setValue('Kiddo');
    const selects = wrapper.findAll('select');
    await selects[0]!.setValue('3'); // month
    await selects[1]!.setValue('14'); // day

    const addBtn = wrapper
      .findAllComponents({ name: 'BaseButton' })
      .find((b) => b.text().includes('loginV6.addMember'));
    await addBtn!.trigger('click');
    await flushPromises();

    expect(mockReportError).toHaveBeenCalledTimes(1);
    expect(mockReportError.mock.calls[0]![0]).toMatchObject({
      surface: 'createMembers.addMember',
      severity: 'warning',
    });
  });
});
