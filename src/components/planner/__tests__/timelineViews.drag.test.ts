/**
 * The desktop week and day timelines as drag-and-drop surfaces (#142). The DOM protocol is
 * the contract with `useCalendarDrag`: every day column (week) and member column (day) is a
 * timeline drop target with its date and hour range (and its member on the day view), each
 * block is a move source inside its column with a resize handle, and the week's all-day row
 * has a day target per day. The gesture itself is covered by `useCalendarDrag.test.ts`.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { ref } from 'vue';
import WeeklyCalendarView from '../WeeklyCalendarView.vue';
import DailyCalendarView from '../DailyCalendarView.vue';
import { useActivityStore } from '@/stores/activityStore';
import { useFamilyStore } from '@/stores/familyStore';
import type { FamilyActivity, FamilyMember } from '@/types/models';

vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
const bp = vi.hoisted(() => ({ mobile: false }));
vi.mock('@/composables/useBreakpoint', async () => {
  const { ref } = await import('vue');
  return {
    useBreakpoint: () => ({
      isMobile: ref(bp.mobile),
      isTablet: ref(false),
      isDesktop: ref(!bp.mobile),
    }),
  };
});
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    currentLanguage: ref('en'),
    isLoading: ref(false),
    isEnglish: ref(true),
    isBeanieMode: ref(false),
  }),
}));

const NOW = '2026-11-01T00:00:00.000Z';
const WED = '2026-11-04';

function activity(over: Partial<FamilyActivity> = {}): FamilyActivity {
  return {
    id: 'piano',
    title: 'Piano',
    date: WED,
    startTime: '16:00',
    endTime: '17:00',
    recurrence: 'none',
    category: 'music',
    feeSchedule: 'none',
    reminderMinutes: 0,
    isActive: true,
    assigneeIds: ['max'],
    createdBy: 'max',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as FamilyActivity;
}

function member(id: string, name: string): FamilyMember {
  return {
    id,
    name,
    color: '#AED6F1',
    role: 'member',
    createdAt: NOW,
    updatedAt: NOW,
  } as unknown as FamilyMember;
}

function seed(activities: FamilyActivity[]): void {
  useActivityStore().activities.push(...activities);
  useFamilyStore().members.push(member('max', 'Max'), member('mia', 'Mia'));
}

const STUBS = { CelebrationConfetti: true, ActivityOwnerStack: true, BeanieAvatar: true };

describe('week view drop targets and sources (#142)', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('every day column is a timeline target holding its own blocks', () => {
    seed([activity()]);
    const w = mount(WeeklyCalendarView, {
      props: { referenceDate: new Date(2026, 10, 4) },
      global: { stubs: STUBS },
    });
    const columns = w.findAll('[data-drop="time"]');
    expect(columns).toHaveLength(7);
    for (const c of columns) {
      expect(c.attributes('data-date')).toMatch(/^2026-1[01]-\d{2}$/);
      expect(c.attributes('data-hour-start')).toBe('6');
      expect(c.attributes('data-hour-end')).toBe('20');
      expect(c.attributes('data-member-id')).toBeUndefined();
    }
    const wed = columns.find((c) => c.attributes('data-date') === WED)!;
    const block = wed.get('[data-activity-id="piano"]');
    expect(block.attributes('data-drag')).toBe('move');
    expect(block.find('[data-drag="resize-end"]').exists()).toBe(true);
    // The live region the binding speaks through.
    expect(w.get('[data-testid="week-drag-live"]').attributes('aria-live')).toBe('polite');
  });

  it('the all-day row has a day target per day and its activity chips are sources', () => {
    seed([activity({ id: 'fair', title: 'Fair', startTime: undefined, endTime: undefined })]);
    const w = mount(WeeklyCalendarView, {
      props: { referenceDate: new Date(2026, 10, 4) },
      global: { stubs: STUBS },
    });
    const days = w.findAll('[data-drop="day"]');
    expect(days).toHaveLength(7);
    expect(days.map((d) => d.attributes('data-date'))).toContain(WED);
    expect(w.get('[data-activity-id="fair"]').attributes('data-drag')).toBe('move');
  });
});

describe('day view drop targets and sources (#142)', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('every member column is a timeline target naming its member', () => {
    seed([activity()]);
    const w = mount(DailyCalendarView, {
      props: { referenceDate: new Date(2026, 10, 4) },
      global: { stubs: STUBS },
    });
    const columns = w.findAll('[data-drop="time"]');
    expect(columns.map((c) => c.attributes('data-member-id')).sort()).toEqual(['max', 'mia']);
    for (const c of columns) {
      expect(c.attributes('data-date')).toBe(WED);
      expect(c.attributes('data-hour-start')).toBe('6');
      expect(c.attributes('data-hour-end')).toBe('20');
    }
    const max = columns.find((c) => c.attributes('data-member-id') === 'max')!;
    const block = max.get('[data-activity-id="piano"]');
    expect(block.attributes('data-drag')).toBe('move');
    expect(block.find('[data-drag="resize-end"]').exists()).toBe(true);
    expect(w.get('[data-testid="day-drag-live"]').attributes('aria-live')).toBe('polite');
  });
});

describe('phone timelines: all-day chips lift only where a day target exists (#142)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    bp.mobile = true;
  });
  afterEach(() => {
    bp.mobile = false;
  });

  const fair = () =>
    activity({ id: 'fair', title: 'Fair', startTime: undefined, endTime: undefined });

  it('the phone week view: the strip pills are day targets, so its all-day chip is a source', () => {
    seed([fair()]);
    const w = mount(WeeklyCalendarView, {
      props: { referenceDate: new Date(2026, 10, 4) },
      global: { stubs: STUBS },
    });
    expect(w.find('[data-drop="day"]').exists()).toBe(true);
    expect(w.get('[data-activity-id="fair"]').attributes('data-drag')).toBe('move');
  });

  it('the phone day view: no day target, so its all-day chip is not a source', () => {
    seed([fair()]);
    const w = mount(DailyCalendarView, {
      props: { referenceDate: new Date(2026, 10, 4) },
      global: { stubs: STUBS },
    });
    expect(w.find('[data-drop="day"]').exists()).toBe(false);
    expect(w.get('[data-activity-id="fair"]').attributes('data-drag')).toBeUndefined();
  });
});
