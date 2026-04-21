import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import GoalViewModal from '@/components/goals/GoalViewModal.vue';
import type { Goal, Transaction } from '@/types/models';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const pushMock = vi.fn();
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushMock }),
}));

const showToastMock = vi.fn();
vi.mock('@/composables/useToast', () => ({
  showToast: (...args: unknown[]) => showToastMock(...args),
}));

vi.mock('@/composables/useMemberInfo', () => ({
  useMemberInfo: () => ({
    getMemberName: (id?: string | null) => (id ? `Member-${id}` : 'Unknown'),
  }),
}));

const familyState = { currentMember: { id: 'member-current' } as { id: string } | undefined };
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => familyState,
}));

const goalsState = {
  getGoalProgress: (g: Goal) => (g.currentAmount / g.targetAmount) * 100,
};
vi.mock('@/stores/goalsStore', () => ({
  useGoalsStore: () => goalsState,
}));

const transactionsState = {
  transactionsForGoal: vi.fn<(id: string) => Transaction[]>(),
};
vi.mock('@/stores/transactionsStore', () => ({
  useTransactionsStore: () => transactionsState,
}));

vi.mock('@/stores/recurringStore', () => ({
  useRecurringStore: () => ({
    getRecurringItemById: () => undefined,
  }),
}));

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'g-1',
    memberId: 'member-current',
    name: 'College Fund',
    type: 'savings',
    targetAmount: 1000,
    currentAmount: 500,
    currency: 'USD',
    priority: 'medium',
    isCompleted: false,
    createdAt: '2026-04-01',
    updatedAt: '2026-04-01',
    ...overrides,
  };
}

function mountModal(opts: { open: boolean; goal: Goal | null; transactions?: Transaction[] }) {
  transactionsState.transactionsForGoal.mockReturnValue(opts.transactions ?? []);
  return mount(GoalViewModal, {
    props: { open: opts.open, goal: opts.goal },
    global: {
      stubs: {
        BeanieFormModal: {
          template:
            '<div><slot /><div class="_footer"><slot name="footer-start" /></div><button class="_save" @click="$emit(\'save\')">save</button></div>',
          props: ['open', 'title', 'saveLabel', 'variant', 'icon', 'size', 'saveGradient'],
          emits: ['save', 'close'],
        },
        CurrencyAmount: true,
        EntityActivityLog: {
          name: 'EntityActivityLog',
          template: '<div class="_activity-log"><slot /></div>',
          props: ['entries', 'emptyStateText', 'visibleCap', 'viewAllText', 'showViewAll'],
          emits: ['view-all', 'filter-select'],
        },
      },
    },
  });
}

describe('GoalViewModal', () => {
  beforeEach(() => {
    pushMock.mockClear();
    showToastMock.mockClear();
    transactionsState.transactionsForGoal.mockReset();
    familyState.currentMember = { id: 'member-current' };
  });

  it('emits contribute when primary save is clicked', async () => {
    const wrapper = mountModal({ open: true, goal: goal() });
    await wrapper.get('._save').trigger('click');
    expect(wrapper.emitted('contribute')?.[0]?.[0]).toMatchObject({ id: 'g-1' });
  });

  it('renders priority + deadline chips', () => {
    const wrapper = mountModal({
      open: true,
      goal: goal({ priority: 'high', deadline: '2026-12-31' }),
    });
    expect(wrapper.text()).toContain('goals.priority.high');
    expect(wrapper.text()).toContain('2026-12-31');
  });

  it('emits open-edit when the ✏️ icon button is clicked', async () => {
    const wrapper = mountModal({ open: true, goal: goal() });
    const editBtn = wrapper.get('button[aria-label="action.edit"]');
    await editBtn.trigger('click');
    expect(wrapper.emitted('open-edit')?.[0]?.[0]).toMatchObject({ id: 'g-1' });
  });

  it('toasts + emits close when goal becomes null while open', async () => {
    const wrapper = mountModal({ open: true, goal: goal() });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await wrapper.setProps({ goal: null });
    expect(showToastMock).toHaveBeenCalledWith('error', 'goalView.notFound');
    expect(wrapper.emitted('close')).toBeTruthy();
    warnSpy.mockRestore();
  });

  it('sorts entries by (date desc, full timestamp desc) so the newest contribution appears on top of its day', () => {
    const tx: Transaction = {
      id: 'tx-morning',
      accountId: 'acc-1',
      goalId: 'g-1',
      type: 'income',
      amount: 100,
      currency: 'USD',
      category: 'salary',
      date: '2026-04-21',
      description: 'Morning salary',
      isReconciled: false,
      createdAt: '2026-04-21T09:00:00.000Z',
      updatedAt: '2026-04-21T09:00:00.000Z',
    };
    const wrapper = mountModal({
      open: true,
      goal: goal({
        manualContributions: [
          {
            id: 'c-new',
            amount: 50,
            at: '2026-04-21T18:00:00.000Z', // added later same day
            updatedBy: 'member-current',
          },
        ],
      }),
      transactions: [tx],
    });
    const stubInstance = wrapper.findAllComponents({ name: 'EntityActivityLog' });
    expect(stubInstance.length).toBeGreaterThan(0);
    const entries = stubInstance[0]!.props('entries') as Array<{ id: string }>;
    // Manual contribution at 18:00 should come before the 09:00 transaction.
    expect(entries.map((e) => e.id)).toEqual(['c-new', 'tx-morning']);
  });

  it('passes merged automated + manual entries to EntityActivityLog', async () => {
    const tx: Transaction = {
      id: 'tx-1',
      accountId: 'acc-1',
      goalId: 'g-1',
      type: 'income',
      amount: 100,
      currency: 'USD',
      category: 'salary',
      date: '2026-04-15',
      description: 'Salary',
      isReconciled: false,
      createdAt: '2026-04-15T00:00:00.000Z',
      updatedAt: '2026-04-15T00:00:00.000Z',
    };
    const wrapper = mountModal({
      open: true,
      goal: goal({
        manualContributions: [
          { id: 'c-1', amount: 50, at: '2026-04-20T10:00:00.000Z', updatedBy: 'member-current' },
        ],
      }),
      transactions: [tx],
    });
    const log = wrapper.findComponent({ name: 'EntityActivityLog' });
    expect(log.exists()).toBe(true);
    expect((log.props('entries') as unknown[]).length).toBe(2);
  });
});
