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
    discardDraftMember: mockDeleteMember,
  }),
}));

// The heading names the family (#128). Mutable per test, reset in beforeEach.
const familyContext: { activeFamilyName: string | null } = { activeFamilyName: null };
vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => familyContext,
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

/** The exit as a component, so its `variant` prop can be asserted. */
function findExit(wrapper: VueWrapper) {
  return wrapper
    .findAllComponents({ name: 'BaseButton' })
    .find((b) => b.attributes('data-testid') === 'members-exit');
}

describe('CreateMembersStep', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    // resetAllMocks (not clearAllMocks) so queued *Once impls never leak between
    // tests; re-establish the always-on defaults it clears.
    vi.resetAllMocks();
    mockDeleteMember.mockResolvedValue(true);
    owner.ageGroup = 'adult';
    familyContext.activeFamilyName = null;
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

  it("emits 'finish' from the exit button, labelled \"I'll do this later\" with nobody added", async () => {
    const wrapper = mount(CreateMembersStep);
    const exit = wrapper.find('[data-testid="members-exit"]');
    expect(exit.text()).toBe('setup.addLater');
    await exit.trigger('click');
    expect(wrapper.emitted('finish')).toHaveLength(1);
  });

  it('names the family in the heading, and falls back to the generic title without one', () => {
    familyContext.activeFamilyName = 'The Parker family';
    // The mocked t() returns the key, so the template's {family} token is what gets filled.
    expect(mount(CreateMembersStep).find('h2').text()).toBe('setup.whoIsInFamily');
    familyContext.activeFamilyName = null;
    expect(mount(CreateMembersStep).find('h2').text()).toBe('loginV6.addBeansTitle');
  });

  it('offers the exit while the add form is open, as a ghost, and leaving discards the form', async () => {
    const wrapper = mount(CreateMembersStep);
    const addAdult = wrapper.findAll('button').find((b) => b.text().includes('loginV6.addAnAdult'));
    await addAdult!.trigger('click');
    await wrapper.find('input[type="text"], input:not([type])').setValue('Half Typed');

    const exit = findExit(wrapper)!;
    expect(exit.props('variant')).toBe('ghost');
    expect(exit.text()).toBe('setup.addLater');
    await exit.trigger('click');
    expect(wrapper.emitted('finish')).toHaveLength(1);
    expect(mockCreateMember).not.toHaveBeenCalled();
  });

  it('relabels the exit "Finish" once a member has been added', async () => {
    mockCreateMember.mockResolvedValueOnce({
      id: 'm-2',
      name: 'Jane',
      color: '#AED6F1',
      ageGroup: 'adult',
      role: 'member',
    });
    const wrapper = mount(CreateMembersStep);
    await addMember(wrapper, 'Jane');
    const exit = findExit(wrapper)!;
    expect(exit.text()).toBe('loginV6.finish');
    expect(exit.props('variant')).toBe('primary');
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

  it('keeps the row and reports when discarding the draft fails (no silent divergence)', async () => {
    mockCreateMember.mockResolvedValueOnce({
      id: 'm-2',
      name: 'Kiddo',
      // A colour `nextFreeMemberColor` can actually return — #ef4444 is retired and is
      // only ever seen on beans that already held it, never handed to a new one.
      color: '#14b8a6',
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
