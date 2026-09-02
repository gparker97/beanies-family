import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import MonthChip from '../MonthChip.vue';
import type { FamilyActivity, FamilyMember } from '@/types/models';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    isBeanieMode: { value: false },
    isEnglish: { value: true },
  }),
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
    // The month grid is NOT a bean lane — nothing else on the chip names the owner —
    // so a solo chip now DOES carry its owner's face. It previously showed none, and
    // was `md:hidden` besides, so desktop month view had no faces at all and hue was
    // the sole identity signal on the surface showing the most events at once.
    expect(
      wrapper.findAllComponents({ name: 'ActivityOwnerStack' })[0]!.props('members')
    ).toHaveLength(1);
  });

  it('renders family chip (0 assignees) with Heritage Orange and every human', () => {
    const occurrence = makeOccurrence(makeActivity({ assigneeIds: [], title: 'Family dinner' }));
    const wrapper = mount(MonthChip, { props: { occurrence } });
    const button = wrapper.get('[data-testid="month-chip"]');
    // Heritage Orange is now the NO-OWNER colour specifically, not "orange for anything
    // with more than one person" — see the shared case below.
    expect(button.attributes('style')?.toLowerCase()).toContain('border-left-color: #f15d22');
    expect(
      wrapper.findAllComponents({ name: 'ActivityOwnerStack' })[0]!.props('members')
    ).toHaveLength(3);
    expect(button.classes()).not.toContain('border-dashed');
  });

  it("renders shared chip (2+ assignees) with the FIRST owner's edge over a blend", () => {
    const occurrence = makeOccurrence(
      makeActivity({ assigneeIds: ['m-greg', 'm-mira'], title: 'Date night' })
    );
    const wrapper = mount(MonthChip, { props: { occurrence } });
    const button = wrapper.get('[data-testid="month-chip"]');
    // Was flat Heritage Orange. A shared event now wears the first owner's edge over a
    // two-stop blend of both hues: "shared" is carried three ways over (the blend, the
    // dashed edge, the face stack), where flat orange was the only cue available when
    // that rule was written. Orange survives as the no-owner colour.
    const style = button.attributes('style')?.toLowerCase() ?? '';
    expect(style).toContain('border-left-color: #2c3e50');
    expect(style).toContain('linear-gradient');
    // The dashed edge stays: it is the one shared cue that needs no colour vision.
    expect(button.classes()).toContain('border-dashed');
    expect(
      wrapper.findAllComponents({ name: 'ActivityOwnerStack' })[0]!.props('members')
    ).toHaveLength(2);
  });

  it('falls back to solo semantics when every assignee resolves to a deleted member', () => {
    const occurrence = makeOccurrence(
      makeActivity({ assigneeIds: ['m-gone-1', 'm-gone-2'], title: 'Old activity' })
    );
    const wrapper = mount(MonthChip, { props: { occurrence } });
    const button = wrapper.get('[data-testid="month-chip"]');
    // Default gray fallback color, not Heritage Orange
    expect(button.attributes('style')?.toLowerCase()).toContain('border-left-color: #6b7280');
    // Nobody resolvable to draw.
    expect(
      wrapper.findAllComponents({ name: 'ActivityOwnerStack' })[0]!.props('members')
    ).toHaveLength(0);
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
