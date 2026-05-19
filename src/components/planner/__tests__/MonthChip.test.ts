import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import MonthChip from '../MonthChip.vue';
import type { FamilyActivity, FamilyMember } from '@/types/models';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const MEMBERS: FamilyMember[] = [
  // @ts-expect-error — partial fixture sufficient for chip rendering
  { id: 'm-greg', name: 'Greg', color: '#2C3E50', isPet: false },
  // @ts-expect-error — partial fixture
  { id: 'm-mira', name: 'Mira', color: '#7E57C2', isPet: false },
  // @ts-expect-error — partial fixture
  { id: 'm-aria', name: 'Aria', color: '#6AA84F', isPet: false },
];

vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({
    members: MEMBERS,
    humans: MEMBERS,
  }),
}));

vi.mock('@/composables/useMemberInfo', () => ({
  useMemberInfo: () => ({
    getMemberById: (id: string | null | undefined) =>
      id ? MEMBERS.find((m) => m.id === id) : undefined,
    getMemberName: (id: string | null | undefined) =>
      id ? (MEMBERS.find((m) => m.id === id)?.name ?? 'Unknown') : 'Unknown',
    getMemberColor: (id: string | null | undefined, fallback = '#6b7280') =>
      id ? (MEMBERS.find((m) => m.id === id)?.color ?? fallback) : fallback,
  }),
}));

function makeActivity(overrides: Partial<FamilyActivity> = {}): FamilyActivity {
  return {
    id: 'a-1',
    title: 'Soccer practice',
    date: '2026-05-19',
    startTime: '16:00',
    endTime: '17:00',
    category: 'soccer',
    isAllDay: false,
    recurrence: { type: 'none' },
    feeSchedule: 'none',
    reminderMinutes: { default: 15 },
    isActive: true,
    createdBy: 'm-greg',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  } as FamilyActivity;
}

function makeOccurrence(activity: FamilyActivity, date = '2026-05-19') {
  return { activity, date };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('MonthChip classification', () => {
  it("renders solo chip with the assignee's member color and no avatar stack", () => {
    const occurrence = makeOccurrence(makeActivity({ assigneeIds: ['m-aria'], title: 'Piano' }));
    const wrapper = mount(MonthChip, { props: { occurrence } });
    const button = wrapper.get('[data-testid="month-chip"]');
    // Solo chip: Aria's green on the left bar (case-insensitive — JSDOM
    // preserves the hex from inline style verbatim).
    expect(button.attributes('style')?.toLowerCase()).toContain('border-left-color: #6aa84f');
    // Solo chip: no avatar stack (no MemberChip with size="dot")
    expect(wrapper.findAllComponents({ name: 'MemberChip' }).length).toBe(0);
  });

  it('renders family chip (0 assignees) with Heritage Orange and all-human avatar stack', () => {
    const occurrence = makeOccurrence(makeActivity({ assigneeIds: [], title: 'Family dinner' }));
    const wrapper = mount(MonthChip, { props: { occurrence } });
    const button = wrapper.get('[data-testid="month-chip"]');
    expect(button.attributes('style')?.toLowerCase()).toContain('border-left-color: #f15d22');
    // 3 humans in the mock family → 3 MemberChip dots in the stack
    expect(wrapper.findAllComponents({ name: 'MemberChip' }).length).toBe(3);
  });

  it('renders shared chip (2+ assignees) with Heritage Orange and selected-members stack', () => {
    const occurrence = makeOccurrence(
      makeActivity({ assigneeIds: ['m-greg', 'm-mira'], title: 'Date night' })
    );
    const wrapper = mount(MonthChip, { props: { occurrence } });
    const button = wrapper.get('[data-testid="month-chip"]');
    expect(button.attributes('style')?.toLowerCase()).toContain('border-left-color: #f15d22');
    // Stack shows only the 2 selected members, not all 3 humans
    expect(wrapper.findAllComponents({ name: 'MemberChip' }).length).toBe(2);
  });

  it('falls back to solo semantics when every assignee resolves to a deleted member', () => {
    const occurrence = makeOccurrence(
      makeActivity({ assigneeIds: ['m-gone-1', 'm-gone-2'], title: 'Old activity' })
    );
    const wrapper = mount(MonthChip, { props: { occurrence } });
    const button = wrapper.get('[data-testid="month-chip"]');
    // Default gray fallback color, not Heritage Orange
    expect(button.attributes('style')?.toLowerCase()).toContain('border-left-color: #6b7280');
    // No avatar stack
    expect(wrapper.findAllComponents({ name: 'MemberChip' }).length).toBe(0);
  });

  it('honours legacy assigneeId field via normalizeAssignees', () => {
    // The deprecated single-assigneeId path is still typed in models.ts —
    // pass it through Partial<FamilyActivity> so the test exercises real
    // user data that hasn't been migrated yet.
    const occurrence = makeOccurrence(makeActivity({ assigneeId: 'm-mira', title: 'Yoga' }));
    const wrapper = mount(MonthChip, { props: { occurrence } });
    const button = wrapper.get('[data-testid="month-chip"]');
    // Mira's purple
    expect(button.attributes('style')?.toLowerCase()).toContain('border-left-color: #7e57c2');
  });
});

describe('MonthChip content', () => {
  it('uses activity.icon when set, otherwise category fallback', () => {
    const withIcon = mount(MonthChip, {
      props: {
        occurrence: makeOccurrence(makeActivity({ icon: '🎂', assigneeIds: ['m-aria'] })),
      },
    });
    expect(withIcon.text()).toContain('🎂');

    const withoutIcon = mount(MonthChip, {
      props: {
        occurrence: makeOccurrence(
          makeActivity({ category: 'soccer', icon: undefined, assigneeIds: ['m-aria'] })
        ),
      },
    });
    // Soccer category resolves to ⚽ via getActivityFallbackEmoji
    expect(withoutIcon.text()).toContain('⚽');
  });

  it('includes member name, time, and title in the aria-label', () => {
    const wrapper = mount(MonthChip, {
      props: {
        occurrence: makeOccurrence(
          makeActivity({ assigneeIds: ['m-aria'], startTime: '16:00', title: 'Soccer practice' })
        ),
      },
    });
    const label = wrapper.get('[data-testid="month-chip"]').attributes('aria-label') ?? '';
    expect(label).toContain('Aria');
    expect(label).toContain('Soccer practice');
    expect(label).toContain('4pm');
  });

  it('emits view-activity with the activity id + date on click', async () => {
    const wrapper = mount(MonthChip, {
      props: {
        occurrence: makeOccurrence(
          makeActivity({ id: 'a-99', assigneeIds: ['m-aria'] }),
          '2026-05-19'
        ),
      },
    });
    await wrapper.get('[data-testid="month-chip"]').trigger('click');
    expect(wrapper.emitted('view-activity')).toEqual([['a-99', '2026-05-19']]);
  });
});
