/**
 * `DayTimeline` (the phone's day and week view) packs overlapping cards into
 * lanes itself. It used its own literal-end parse, so even correct clusters put
 * a short card, a zero-length pair or an overnight event in the same lane as
 * the card it covers. It now packs on `plannerExtent`, like the clusters.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import DayTimeline from '../DayTimeline.vue';
import type { FamilyActivity } from '@/types/models';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/composables/useActivityIdentity', () => ({
  useActivityIdentity: () => ({
    identityFor: () => ({
      color: '#F15D22',
      emoji: '📌',
      celebration: { celebrating: false },
      style: {},
      edgeStyle: {},
    }),
  }),
}));
vi.mock('@/composables/useClash', () => ({ useClashLookup: () => () => null }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

function act(id: string, startTime: string, endTime?: string): FamilyActivity {
  return {
    id,
    title: id,
    date: '2026-09-15',
    startTime,
    endTime,
    recurrence: 'none',
    category: 'other',
    feeSchedule: 'none',
    reminderMinutes: 0,
    isActive: true,
    createdBy: 'm',
    createdAt: '',
    updatedAt: '',
  } as unknown as FamilyActivity;
}

function lefts(activities: FamilyActivity[]): string[] {
  const w = mount(DayTimeline, {
    props: {
      dateStr: '2026-09-15',
      activities: activities.map((a) => ({ activity: a, date: '2026-09-15' })),
      vacations: [],
      segments: [],
      todos: [],
      members: [],
    },
    global: { stubs: { CelebrationConfetti: true, ActivityOwnerStack: true } },
  });
  return w
    .findAll('button.absolute')
    .map((b) => (b.attributes('style') ?? '').match(/left: ([^;]+)/)?.[1] ?? '');
}

describe('DayTimeline lanes', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it.each([
    ['a short card and the one after it', [act('a', '09:00', '09:15'), act('b', '09:15', '10:00')]],
    ['two zero-length events', [act('a', '10:00', '10:00'), act('b', '10:00', '10:00')]],
    ['an overnight event and a late one', [act('a', '22:00', '01:00'), act('b', '22:30', '23:00')]],
    ['two unreadable starts', [act('a', 'junk'), act('b', 'also junk')]],
  ])('⭐ puts %s in separate lanes', (_label, activities) => {
    const l = lefts(activities);
    expect(l).toHaveLength(2);
    expect(new Set(l).size).toBe(2);
  });
});
