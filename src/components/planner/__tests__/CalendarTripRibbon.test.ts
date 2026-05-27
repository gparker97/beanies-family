import { mount } from '@vue/test-utils';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ref } from 'vue';
import CalendarTripRibbon from '../CalendarTripRibbon.vue';
import type { FamilyVacation } from '@/types/models';

// Passthrough translation so we can assert on the chosen i18n KEY per branch.
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Desktop so the full pill row renders (not the mobile summary pill).
vi.mock('@/composables/useBreakpoint', () => ({
  useBreakpoint: () => ({ isMobile: ref(false) }),
}));

const upcoming = ref<FamilyVacation[]>([]);
vi.mock('@/stores/vacationStore', () => ({
  useVacationStore: () => ({
    get upcomingVacations() {
      return upcoming.value;
    },
  }),
}));

function makeVac(id: string, name: string, startDate?: string, endDate?: string): FamilyVacation {
  return {
    id,
    activityId: `act-${id}`,
    name,
    tripType: 'fly_and_stay',
    assigneeIds: [],
    travelSegments: [],
    accommodations: [],
    transportation: [],
    ideas: [],
    createdBy: 'm-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    startDate,
    endDate,
  };
}

describe('CalendarTripRibbon countdown branches', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 26, 9, 0, 0)); // Tue 26 May 2026 local
    upcoming.value = [];
  });
  afterEach(() => vi.useRealTimers());

  it('shows "{n}d" for a future trip, "today" for a starts-today trip, and "now" for an in-progress trip — never a bare negative', () => {
    upcoming.value = [
      makeVac('future', 'Phuket', '2026-06-07', '2026-06-14'), // +12d
      makeVac('today', 'Day trip', '2026-05-26', '2026-05-26'), // 0
      makeVac('now', 'Grandma visits', '2026-05-24', '2026-05-30'), // -2d (in progress)
    ];
    const wrapper = mount(CalendarTripRibbon);
    const html = wrapper.html();

    expect(html).toContain('vacation.inDays'); // future → "{n}d" branch
    expect(html).toContain('planner.today'); // starts today → "today"
    expect(html).toContain('vacation.onNow'); // in progress → "now"

    // The Pass-4 bug guard: the in-progress trip (daysUntilTrip = -2) resolves
    // to the "now" branch, NOT a numeric countdown — so it never reads "-2d".
    const pills = wrapper.findAll('button[aria-label]');
    const inProgress = pills.find((b) => b.attributes('aria-label')?.startsWith('Grandma visits'));
    expect(inProgress?.attributes('aria-label')).toBe('Grandma visits, vacation.onNow');
  });

  it('renders nothing when there are no upcoming trips', () => {
    upcoming.value = [];
    expect(mount(CalendarTripRibbon).html()).toBe('<!--v-if-->');
  });

  it('skips a trip with no start date rather than rendering NaN', () => {
    upcoming.value = [makeVac('nodate', 'Someday', undefined, '2026-12-01')];
    const html = mount(CalendarTripRibbon).html();
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('Someday');
  });

  it('inline variant: renders one compact chip and taps through to the soonest trip', async () => {
    upcoming.value = [
      makeVac('future', 'Phuket', '2026-06-07', '2026-06-14'), // soonest (+12d)
      makeVac('later', 'Tokyo', '2026-07-01', '2026-07-10'),
    ];
    const wrapper = mount(CalendarTripRibbon, { props: { inline: true } });

    // Exactly one button (the chip) — not the summary pill or the labelled row.
    const buttons = wrapper.findAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].attributes('aria-label')).toContain('Phuket');

    await buttons[0].trigger('click');
    expect(wrapper.emitted('vacation-click')?.[0]).toEqual(['future']);
  });
});
