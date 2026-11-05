/**
 * `DayTimeline` (the phone's day and week timeline) as a drag-and-drop surface (#142): its
 * event column is a timeline drop target, its cards are move sources with a resize handle
 * (never the next-morning tail of an overnight event), and the parent's `overSlot` draws as
 * a slot preview on the matching day only. The gesture itself is `useCalendarDrag`'s.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import DayTimeline from '../DayTimeline.vue';
import type { TimelineSlot } from '@/composables/drag/timelineSlot';
import type { ActivityOccurrence } from '@/utils/calendar/occurrence';
import type { FamilyActivity } from '@/types/models';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/composables/useActivityIdentity', () => ({
  useActivityIdentity: () => ({
    displayTitle: (a: { title: string }) => a.title,
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

const DAY = '2026-09-15';

function act(id: string, startTime?: string, endTime?: string): FamilyActivity {
  return {
    id,
    title: id,
    date: DAY,
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

function mountTimeline(
  activities: ActivityOccurrence[],
  dropSlot: TimelineSlot | null = null,
  allDayDraggable = false
) {
  return mount(DayTimeline, {
    props: {
      dateStr: DAY,
      activities,
      vacations: [],
      segments: [],
      todos: [],
      members: [],
      dropSlot,
      allDayDraggable,
    },
    global: { stubs: { CelebrationConfetti: true, ActivityOwnerStack: true } },
  });
}

describe('DayTimeline drag and drop (#142)', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('the event column is a timeline drop target for the day and its hour range', () => {
    const w = mountTimeline([{ activity: act('piano', '16:00', '17:00'), date: DAY }]);
    const column = w.get('[data-drop="time"]');
    expect(column.attributes('data-date')).toBe(DAY);
    // The grid's own range: an hour either side of the 7am-7pm day once it holds events.
    expect(column.attributes('data-hour-start')).toBe('6');
    expect(column.attributes('data-hour-end')).toBe('20');
    expect(column.attributes('data-member-id')).toBeUndefined();
    // The card sits INSIDE the column: the keyboard origin and the grab point read it there.
    expect(column.find('[data-activity-id="piano"]').exists()).toBe(true);
  });

  it('a timed card is a move source with the Space hint and the resize handle', () => {
    const w = mountTimeline([{ activity: act('piano', '16:00', '17:00'), date: DAY }]);
    const card = w.get('button[data-activity-id="piano"]');
    expect(card.attributes('data-drag')).toBe('move');
    expect(card.attributes('aria-description')).toBe('planner.drag.a11y.dragHint');
    expect(card.find('[data-drag="resize-end"]').exists()).toBe(true);
    // The hover lift stands down while the card is the placeholder.
    expect(card.classes()).not.toContain('hover:-translate-y-[1px]');
  });

  it("an overnight event's next-morning tail never lifts; tonight's start does", () => {
    const night = act('night', '22:00', '01:00');
    const w = mountTimeline([
      { activity: night, date: DAY, repeatStart: '2026-09-14' },
      { activity: night, date: DAY, repeatStart: DAY },
    ]);
    const cards = w.findAll('button[data-activity-id="night"]');
    expect(cards).toHaveLength(2);
    const tail = cards.find((c) => c.attributes('data-occurrence-date') === '2026-09-14')!;
    const head = cards.find((c) => c.attributes('data-occurrence-date') === DAY)!;
    expect(tail.attributes('data-drag')).toBeUndefined();
    expect(tail.find('[data-drag="resize-end"]').exists()).toBe(false);
    expect(head.attributes('data-drag')).toBe('move');
  });

  it('an all-day chip is a move source only where the parent has day targets (the week strip)', () => {
    const allDay = { ...act('fair'), isAllDay: true } as FamilyActivity;
    const week = mountTimeline([{ activity: allDay, date: DAY }], null, true);
    expect(week.get('[data-activity-id="fair"]').attributes('data-drag')).toBe('move');
    // The phone day view has no day target: the chip is not a source and promises no Space move.
    const day = mountTimeline([{ activity: allDay, date: DAY }]);
    const chip = day.get('[data-activity-id="fair"]');
    expect(chip.attributes('data-drag')).toBeUndefined();
    expect(chip.attributes('aria-description')).toBeUndefined();
  });

  it('only an all-day chip that can lift gives up text selection and the touch callout', () => {
    const allDay = { ...act('fair'), isAllDay: true } as FamilyActivity;
    const noDrag = ['select-none', '[-webkit-touch-callout:none]'];
    const week = mountTimeline([{ activity: allDay, date: DAY }], null, true);
    expect(week.get('[data-activity-id="fair"]').classes()).toEqual(expect.arrayContaining(noDrag));
    // The phone day view's chip is not a source: a long-press still selects and calls out.
    const day = mountTimeline([{ activity: allDay, date: DAY }]);
    const classes = day.get('[data-activity-id="fair"]').classes();
    for (const c of noDrag) expect(classes).not.toContain(c);
  });

  it('draws the lifted block’s slot preview on its own day only', () => {
    const slot: TimelineSlot = { date: DAY, startTime: '16:30', endTime: '17:30', readout: '' };
    const here = mountTimeline([], slot);
    const preview = here.get('[data-testid="drop-slot-preview"]');
    expect(preview.attributes('aria-hidden')).toBe('true');
    expect(preview.classes()).toEqual(
      expect.arrayContaining(['ring-primary-500', 'dark:ring-accent-lift', 'pointer-events-none'])
    );
    // 16:30 on the empty day's 7am grid: 9.5 hours × 3.75rem.
    expect(preview.attributes('style')).toContain('top: 35.625rem');
    const elsewhere = mountTimeline([], { ...slot, date: '2026-09-16' });
    expect(elsewhere.find('[data-testid="drop-slot-preview"]').exists()).toBe(false);
  });
});
