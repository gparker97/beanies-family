import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import TripDatesHeader from '../TripDatesHeader.vue';
import { useVacationStore } from '@/stores/vacationStore';
import type { FamilyVacation } from '@/types/models';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/utils/date', async () => {
  const actual = await vi.importActual<typeof import('@/utils/date')>('@/utils/date');
  return {
    ...actual,
    formatDateShort: (iso: string) => iso,
  };
});

const NOW = '2026-03-01T00:00:00.000Z';

function makeVacation(overrides: Partial<FamilyVacation> = {}): FamilyVacation {
  return {
    id: 'vac-1',
    activityId: 'act-1',
    name: 'Beach Trip',
    tripType: 'fly_and_stay',
    assigneeIds: [],
    travelSegments: [],
    accommodations: [],
    transportation: [],
    ideas: [],
    createdBy: 'm-1',
    createdAt: NOW,
    updatedAt: NOW,
    startDate: '2026-07-01',
    endDate: '2026-07-10',
    ...overrides,
  };
}

describe('TripDatesHeader', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders the date chip with a formatted "start → end · N days" summary', () => {
    const wrapper = mount(TripDatesHeader, { props: { vacation: makeVacation() } });
    const html = wrapper.html();
    expect(html).toContain('2026-07-01');
    expect(html).toContain('2026-07-10');
    expect(html).toContain('10');
    expect(html).toContain('travel.dates.dayLabelPlural');
  });

  it('falls back to a "dates not set" label when dates are absent', () => {
    const wrapper = mount(TripDatesHeader, {
      props: { vacation: makeVacation({ startDate: undefined, endDate: undefined }) },
    });
    expect(wrapper.html()).toContain('travel.dates.notSet');
  });

  it('swaps to the inline editor when the Edit button is clicked', async () => {
    const wrapper = mount(TripDatesHeader, { props: { vacation: makeVacation() } });
    await wrapper.get('button').trigger('click');

    // Editor region rendered
    expect(wrapper.html()).toMatch(/id="trip-dates-editor-/);
    // Cancel and Save buttons present
    const buttons = wrapper.findAll('button');
    const labels = buttons.map((b) => b.text());
    expect(labels).toContain('action.cancel');
    expect(labels).toContain('action.save');
  });

  it('cancel closes the editor without calling the store', async () => {
    const store = useVacationStore();
    const spy = vi.spyOn(store, 'updateVacation');
    const wrapper = mount(TripDatesHeader, { props: { vacation: makeVacation() } });

    await wrapper.get('button').trigger('click'); // open
    const cancelBtn = wrapper.findAll('button').find((b) => b.text() === 'action.cancel');
    await cancelBtn!.trigger('click');

    expect(spy).not.toHaveBeenCalled();
    expect(wrapper.html()).not.toMatch(/id="trip-dates-editor-/);
  });

  it('save commits startDate and endDate via the store when valid', async () => {
    const store = useVacationStore();
    const spy = vi
      .spyOn(store, 'updateVacation')
      .mockResolvedValue(makeVacation({ startDate: '2026-07-05', endDate: '2026-07-12' }));
    const wrapper = mount(TripDatesHeader, { props: { vacation: makeVacation() } });

    await wrapper.get('button').trigger('click'); // open editor
    const saveBtn = wrapper.findAll('button').find((b) => b.text() === 'action.save');
    await saveBtn!.trigger('click');
    await flushPromises();

    expect(spy).toHaveBeenCalledWith('vac-1', {
      startDate: '2026-07-01',
      endDate: '2026-07-10',
    });
  });

  it('save button is disabled when the editor state is invalid', async () => {
    const store = useVacationStore();
    const spy = vi.spyOn(store, 'updateVacation');
    const wrapper = mount(TripDatesHeader, {
      props: { vacation: makeVacation({ startDate: undefined, endDate: undefined }) },
    });

    await wrapper.get('button').trigger('click');
    const saveBtn = wrapper.findAll('button').find((b) => b.text() === 'action.save');
    expect(saveBtn!.attributes('disabled')).toBeDefined();
    await saveBtn!.trigger('click');
    expect(spy).not.toHaveBeenCalled();
  });
});
