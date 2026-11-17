/**
 * The Nook schedule cards with view-only external events (plan 2026-11-17, C3):
 *   - an external event shows as a striped button naming its calendar, sorted with the rest,
 *   - tapping it emits `open-external` with the event (never an activity or to-do open),
 *   - when the week list is full, view-only items drop first,
 *   - with nothing viewed, the cards are exactly today's.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import ScheduleCards from '@/components/nook/ScheduleCards.vue';
import type { ExternalEvent } from '@/types/externalEvents';

const TODAY = '2026-11-17';

const { box } = vi.hoisted(() => ({
  box: {
    external: [] as unknown[],
    todos: [] as unknown[],
    activities: [] as unknown[],
  },
}));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useToday', () => ({ useToday: () => ({ today: ref('2026-11-17') }) }));
vi.mock('@/stores/todoStore', () => ({
  useTodoStore: () => ({
    get filteredPlatedTodos() {
      return [];
    },
    get filteredActiveTodos() {
      return box.todos;
    },
  }),
}));
vi.mock('@/stores/activityStore', () => ({
  useActivityStore: () => ({
    get upcomingActivities() {
      return box.activities;
    },
  }),
}));
vi.mock('@/composables/useExternalEvents', () => ({
  useExternalEvents: () => ({
    eventsForDate: (ymd: string) =>
      (box.external as ExternalEvent[]).filter((e) => e.startYmd <= ymd && e.endYmd >= ymd),
  }),
}));

const at = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00`).getTime();
function ext(over: Partial<ExternalEvent> = {}): ExternalEvent {
  return {
    id: 'e1',
    viewedCalendarId: 'vc1',
    calendarName: "Grandma's calendar",
    color: '#6B7280',
    allDay: false,
    startMs: at(TODAY, '15:00'),
    endMs: at(TODAY, '16:00'),
    startYmd: TODAY,
    endYmd: TODAY,
    title: 'Babysitting',
    busyOnly: false,
    transparent: false,
    ...over,
  };
}
function todo(n: number) {
  return { id: `t${n}`, title: `Todo ${n}`, dueDate: `2026-11-${18 + (n % 3)}`, dueTime: '' };
}

const mountCards = () =>
  mount(ScheduleCards, {
    global: { stubs: { NookSectionCard: { template: '<section><slot /></section>' } } },
  });

beforeEach(() => {
  box.external = [];
  box.todos = [];
  box.activities = [];
});

describe('ScheduleCards: view-only external events', () => {
  it('changes nothing when no calendar is viewed', () => {
    box.todos = [todo(1)];
    const w = mountCards();
    expect(w.findAll('[data-testid="nook-external-item"]')).toHaveLength(0);
    expect(w.text()).toContain('Todo 1');
  });

  it('shows today’s external event with its calendar name and view-only marker', () => {
    box.external = [ext()];
    const w = mountCards();
    const items = w.findAll('[data-testid="nook-external-item"]');
    // Once in today's card, once in this week's.
    expect(items).toHaveLength(2);
    expect(items[0]!.text()).toContain('Babysitting');
    expect(items[0]!.text()).toContain("Grandma's calendar");
    expect(items[0]!.text()).toContain('calendarView.event.viewOnly');
    expect(items[0]!.classes()).toContain('view-only-stripes');
  });

  it('one event on two viewed calendars shows on both, under distinct v-for keys', () => {
    box.external = [ext(), ext({ viewedCalendarId: 'vc2', calendarName: 'Work' })];
    const w = mountCards();
    // Twice in today's card, twice in this week's.
    expect(w.findAll('[data-testid="nook-external-item"]')).toHaveLength(4);
    // The template keys each row `${type}-${id}`; a repeat is a Vue duplicate key.
    const items = (w.vm as unknown as { todayItems: Array<{ type: string; id: string }> })
      .todayItems;
    const keys = items.map((i) => `${i.type}-${i.id}`);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('titles a busy-only event "Busy"', () => {
    box.external = [ext({ busyOnly: true, title: undefined })];
    const w = mountCards();
    expect(w.get('[data-testid="nook-external-item"]').text()).toContain('calendarView.event.busy');
  });

  it('emits open-external with the event on tap, and nothing else', async () => {
    const event = ext();
    box.external = [event];
    const w = mountCards();
    await w.get('[data-testid="nook-external-item"]').trigger('click');
    expect(w.emitted('open-external')?.[0]).toEqual([event]);
    expect(w.emitted('open-activity')).toBeUndefined();
    expect(w.emitted('open-todo')).toBeUndefined();
  });

  it('keeps family items and drops view-only ones first when the week list is full', () => {
    box.todos = [1, 2, 3, 4, 5, 6].map(todo);
    box.external = [ext({ startYmd: '2026-11-18', endYmd: '2026-11-18', allDay: true })];
    const w = mountCards();
    const week = w.get('.nook-schedule-week');
    expect(week.findAll('[data-testid="nook-external-item"]')).toHaveLength(0);
    for (let n = 1; n <= 6; n++) expect(week.text()).toContain(`Todo ${n}`);
    // The dropped one still counts toward "+N more".
    expect(week.text()).toContain('+1');
  });

  it('fills only the slots family items leave free', () => {
    box.todos = [1, 2, 3, 4].map(todo);
    box.external = [
      ext({ id: 'a', startYmd: '2026-11-18', endYmd: '2026-11-18', allDay: true }),
      ext({ id: 'b', startYmd: '2026-11-19', endYmd: '2026-11-19', allDay: true }),
      ext({ id: 'c', startYmd: '2026-11-20', endYmd: '2026-11-20', allDay: true }),
    ];
    const week = mountCards().get('.nook-schedule-week');
    expect(week.findAll('[data-testid="nook-external-item"]')).toHaveLength(2);
    for (let n = 1; n <= 4; n++) expect(week.text()).toContain(`Todo ${n}`);
  });
});
