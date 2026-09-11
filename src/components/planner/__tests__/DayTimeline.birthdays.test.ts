/**
 * `DayTimeline` is the renderer behind BOTH the week view and the day view on a
 * phone, so it is where a birthday reaches most of the surfaces a family
 * actually uses. It had no test file at all: the wiring was covered only by a
 * source scan, which can prove a component is referenced and nothing about
 * whether it renders.
 *
 * greg reported not seeing birthdays on some surfaces after the release. These
 * tests exist to answer that with evidence rather than reasoning.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import DayTimeline from '../DayTimeline.vue';
import type { BirthdayOccurrence } from '@/utils/birthdays';

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

function birthday(over: Partial<BirthdayOccurrence> = {}): BirthdayOccurrence {
  return {
    date: '2026-09-15',
    memberId: 'm-joey',
    name: 'Joey',
    age: 7,
    isPet: false,
    ...over,
  };
}

function mountTimeline(props: Record<string, unknown> = {}) {
  return mount(DayTimeline, {
    props: {
      dateStr: '2026-09-15',
      activities: [],
      vacations: [],
      segments: [],
      todos: [],
      members: [],
      ...props,
    },
    global: { stubs: { CelebrationConfetti: true, ActivityOwnerStack: true } },
  });
}

describe('DayTimeline — birthdays in the all-day row', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('renders a birthday chip when one is passed', () => {
    const w = mountTimeline({ birthdays: [birthday()] });
    expect(w.find('[data-testid="birthday-chip"]').exists()).toBe(true);
  });

  it('OPENS the all-day row for a day whose only content is a birthday', () => {
    // `hasUntimedRow` gates the whole row. If birthdays are not counted in it,
    // the chip is wired, mounted, and invisible - which is exactly the shape of
    // "it is wired and still not on screen".
    const w = mountTimeline({ birthdays: [birthday()] });
    expect(w.text()).toContain('planner.allDay');
  });

  it('renders one chip per person when two share a date', () => {
    const w = mountTimeline({
      birthdays: [birthday(), birthday({ memberId: 'm-bo', name: 'Bo', age: 4 })],
    });
    expect(w.findAll('[data-testid="birthday-chip"]')).toHaveLength(2);
  });

  it('renders nothing extra when no birthdays are passed', () => {
    const w = mountTimeline({ birthdays: [] });
    expect(w.find('[data-testid="birthday-chip"]').exists()).toBe(false);
  });

  it('defaults the prop, so a caller that forgets it does not crash', () => {
    // Three call sites pass it; a fourth surface added later might not.
    const w = mountTimeline();
    expect(w.exists()).toBe(true);
    expect(w.find('[data-testid="birthday-chip"]').exists()).toBe(false);
  });
});
