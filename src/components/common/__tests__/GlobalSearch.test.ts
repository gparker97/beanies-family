/**
 * Global search over view-only external events (plan 2026-11-17, C5):
 *   - matches the title (details calendars) and the calendar's name; a busy-only event has no
 *     title to match,
 *   - shows the title or "Busy", the date, the calendar and the view-only marker,
 *   - its group comes last,
 *   - selecting one opens the planner's day view on that date (no deep-link row).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import GlobalSearch from '@/components/common/GlobalSearch.vue';
import { ENTITY_DEEP_LINKS } from '@/utils/entityDeepLink';
import type { ExternalEvent } from '@/types/externalEvents';

const { box, push } = vi.hoisted(() => ({
  box: { external: [] as unknown[], todos: [] as unknown[] },
  push: vi.fn(),
}));

vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/composables/useTranslation', async () => {
  const { UI_STRINGS } = await import('@/services/translation/uiStrings');
  return {
    useTranslation: () => ({
      t: (k: keyof typeof UI_STRINGS) => UI_STRINGS[k] ?? k,
    }),
  };
});
vi.mock('@/composables/useExternalEvents', () => ({
  useExternalEvents: () => ({
    events: {
      get value() {
        return box.external;
      },
    },
  }),
}));
vi.mock('@/stores/activityStore', () => ({ useActivityStore: () => ({ activeActivities: [] }) }));
vi.mock('@/stores/vacationStore', () => ({ useVacationStore: () => ({ vacations: [] }) }));
vi.mock('@/stores/todoStore', () => ({
  useTodoStore: () => ({
    get todos() {
      return box.todos;
    },
  }),
}));
vi.mock('@/stores/accountsStore', () => ({ useAccountsStore: () => ({ accounts: [] }) }));
vi.mock('@/stores/transactionsStore', () => ({
  useTransactionsStore: () => ({ transactions: [] }),
}));
vi.mock('@/stores/goalsStore', () => ({ useGoalsStore: () => ({ goals: [] }) }));
vi.mock('@/stores/assetsStore', () => ({ useAssetsStore: () => ({ assets: [] }) }));
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({ currentMember: null, members: [] }),
}));

function ext(over: Partial<ExternalEvent> = {}): ExternalEvent {
  return {
    id: 'e1',
    viewedCalendarId: 'vc1',
    calendarName: "Grandma's calendar",
    color: '#6B7280',
    allDay: true,
    startMs: 0,
    endMs: 0,
    startYmd: '2026-11-20',
    endYmd: '2026-11-20',
    title: 'Babysitting',
    busyOnly: false,
    transparent: false,
    ...over,
  };
}

async function search(q: string) {
  const w = mount(GlobalSearch, {
    props: { open: true },
    global: { stubs: { Teleport: { template: '<div><slot /></div>' }, Transition: false } },
  });
  await w.get('input').setValue(q);
  return w;
}
const rows = (w: Awaited<ReturnType<typeof search>>) => w.findAll('button.search-result');

beforeEach(() => {
  push.mockClear();
  box.external = [];
  box.todos = [];
});

describe('GlobalSearch: view-only external events', () => {
  it('matches a details event by its title and shows date, calendar and the marker', async () => {
    box.external = [ext()];
    const w = await search('babysit');
    expect(rows(w)).toHaveLength(1);
    expect(rows(w)[0]!.text()).toContain('Babysitting');
    expect(rows(w)[0]!.text()).toContain("Grandma's calendar");
    expect(rows(w)[0]!.text()).toContain('View Only');
  });

  it('matches by calendar name', async () => {
    box.external = [ext()];
    expect(rows(await search('grandma'))).toHaveLength(1);
  });

  it('never matches a busy-only event by title, and shows it as Busy under its calendar', async () => {
    box.external = [ext({ busyOnly: true, title: 'Secret meeting', calendarName: "Dad's work" })];
    expect(rows(await search('secret'))).toHaveLength(0);
    const w = await search('work');
    expect(rows(w)).toHaveLength(1);
    expect(rows(w)[0]!.text()).toContain('Busy');
    expect(rows(w)[0]!.text()).not.toContain('Secret');
  });

  it('puts the group last, after family results', async () => {
    box.todos = [{ id: 't1', title: 'Babysitter forms', completed: false }];
    box.external = [ext()];
    const w = await search('babysit');
    const labels = w.findAll('.search-result').map((r) => r.text());
    expect(labels[0]).toContain('Babysitter forms');
    expect(labels[labels.length - 1]).toContain('Babysitting');
  });

  it('opens the planner day view on the event’s date', async () => {
    box.external = [ext({ startYmd: '2026-11-20' })];
    const w = await search('babysit');
    await rows(w)[0]!.trigger('click');
    // The planner's shared day link (`plannerDayLink`), not a hand-built route.
    expect(push).toHaveBeenCalledWith({
      path: '/activities',
      query: { view: 'day', d: '2026-11-20' },
    });
    expect(w.emitted('close')).toBeTruthy();
  });

  it('adds no deep-link row for external events', () => {
    expect(Object.keys(ENTITY_DEEP_LINKS)).not.toContain('externalEvent');
  });
});
