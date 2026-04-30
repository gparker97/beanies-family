import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import CalendarGrid from '../CalendarGrid.vue';
import { useVacationStore } from '@/stores/vacationStore';
import type { FamilyVacation, VacationTravelSegment } from '@/types/models';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/stores/activityStore', () => ({
  useActivityStore: () => ({
    monthActivities: () => [],
  }),
  CATEGORY_COLORS: {} as Record<string, string>,
}));

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({
    weekStartDay: 0,
  }),
}));

const NOW = '2026-04-01T00:00:00.000Z';

function flightSegment(overrides: Partial<VacationTravelSegment> = {}): VacationTravelSegment {
  return {
    id: 'seg-flight-1',
    type: 'flight_outbound',
    title: 'SFO → JFK',
    status: 'booked',
    departureDate: '2026-04-15',
    departureTime: '09:00',
    arrivalDate: '2026-04-15',
    arrivalTime: '17:30',
    ...overrides,
  };
}

function makeVacation(segments: VacationTravelSegment[]): FamilyVacation {
  return {
    id: 'vac-1',
    activityId: 'act-1',
    name: 'Trip',
    tripType: 'fly_and_stay',
    assigneeIds: [],
    travelSegments: segments,
    accommodations: [],
    transportation: [],
    ideas: [],
    createdBy: 'm-1',
    createdAt: NOW,
    updatedAt: NOW,
    startDate: '2026-04-15',
    endDate: '2026-04-20',
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  // Pin the calendar to April 2026 so test data lands on visible cells
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-04-15T12:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('CalendarGrid travel-segment chips', () => {
  it('renders direction-aware flight emojis (🛫 departure / 🛬 arrival) with kind labels', () => {
    const store = useVacationStore();
    store.vacations = [makeVacation([flightSegment()])];

    const wrapper = mount(CalendarGrid);
    const html = wrapper.html();

    // Direction-aware emoji disambiguates the two markers without reading the time
    expect(html).toContain('🛫');
    expect(html).toContain('🛬');
    // Kind labels (Dep/Arr) prefix the time
    expect(html).toContain('planner.segmentDepartureShort');
    expect(html).toContain('planner.segmentArrivalShort');
    // Departure time and arrival time both rendered
    // (formatTime12: '09:00' → '9am', '17:30' → '5:30pm')
    expect(html).toContain('9am');
    expect(html).toContain('5:30pm');
  });

  it('clicking a chip emits view-segment with vacationId + segmentIndex', async () => {
    const store = useVacationStore();
    store.vacations = [makeVacation([flightSegment()])];

    const wrapper = mount(CalendarGrid);
    // Find any chip — direction-aware emoji means we look for the takeoff one
    const chips = wrapper.findAll('span').filter((el) => el.text().includes('🛫'));
    expect(chips.length).toBeGreaterThanOrEqual(1);

    await chips[0].trigger('click');

    const events = wrapper.emitted('view-segment');
    expect(events).toBeTruthy();
    expect(events![0]).toEqual(['vac-1', 0]);
  });

  it('renders pending segments with the dashed-outline class', () => {
    const store = useVacationStore();
    store.vacations = [makeVacation([flightSegment({ status: 'pending' })])];

    const wrapper = mount(CalendarGrid);
    const html = wrapper.html();
    // Pending → dashed border + italic
    expect(html).toContain('border-dashed');
    expect(html).toContain('italic');
  });

  it('caps visible chips at 2 with a +N overflow indicator', () => {
    const store = useVacationStore();
    // Build 4 outbound flights all on the same day → 8 occurrences (4 dep + 4 arr)
    // but each cell has 2 visible + +6 indicator (per cell)
    const segs = Array.from({ length: 4 }, (_, i) =>
      flightSegment({ id: `seg-${i}`, departureTime: `${10 + i}:00` })
    );
    store.vacations = [makeVacation(segs)];

    const wrapper = mount(CalendarGrid);
    const html = wrapper.html();
    // Should show overflow indicator
    expect(html).toMatch(/\+\d+/);
  });
});
