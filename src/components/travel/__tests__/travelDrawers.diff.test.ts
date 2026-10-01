/**
 * The three travel drawers save through the id-addressed `vacationStore.updateSegment` with a
 * snapshot-at-open DIFF (CRDT merge-safe writes, #117), never by rebuilding the bucket array.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { setActivePinia, createPinia } from 'pinia';
import TravelSegmentEditModal from '@/components/travel/TravelSegmentEditModal.vue';
import AccommodationEditModal from '@/components/travel/AccommodationEditModal.vue';
import TransportationEditModal from '@/components/travel/TransportationEditModal.vue';
import { useVacationStore } from '@/stores/vacationStore';
import type { FamilyVacation } from '@/types/models';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key, isEnglish: { value: true } }),
}));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

type Vm = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const vacation = {
  id: 'v1',
  name: 'Trip',
  tripType: 'fly_and_stay',
  assigneeIds: ['m1'],
  travelSegments: [
    {
      id: 'out',
      type: 'flight_outbound',
      title: 'LAX to SYD',
      status: 'pending',
      airline: 'Qantas',
      departureAirport: 'LAX',
      arrivalAirport: 'SYD',
      departureDate: '2026-12-01',
      bookingReference: 'ABC123',
    },
    {
      id: 'ret',
      type: 'flight_return',
      title: 'SYD to LAX',
      status: 'pending',
      airline: 'Qantas',
      departureAirport: 'SYD',
      arrivalAirport: 'LAX',
      departureDate: '2026-12-15',
      bookingReference: 'ABC123',
    },
  ],
  accommodations: [
    { id: 'acc', type: 'hotel', title: 'Hotel Ritz', status: 'pending', name: 'Ritz', notes: 'n' },
  ],
  transportation: [
    { id: 'tr', type: 'bus', title: 'Bus', status: 'pending', operator: 'Greyhound' },
  ],
  ideas: [],
} as unknown as FamilyVacation;

function setup() {
  setActivePinia(createPinia());
  const store = useVacationStore();
  store.vacations = [structuredClone(vacation)] as never;
  const updateSegment = vi.fn().mockResolvedValue('saved');
  store.updateSegment = updateSegment;
  return { store, updateSegment };
}

async function mountOpen(component: object, props: Record<string, unknown>) {
  const w = mount(component as never, {
    props: { open: false, vacationId: 'v1', ...props } as never,
    shallow: true,
  });
  await w.setProps({ open: true } as never);
  await nextTick();
  await nextTick();
  return w;
}

async function save(w: ReturnType<typeof mount>) {
  await (w.vm as Vm).handleSave();
  await flushPromises();
}

beforeEach(() => vi.clearAllMocks());

describe('TravelSegmentEditModal', () => {
  it('saves only the changed field, by segment id', async () => {
    const { updateSegment } = setup();
    const w = await mountOpen(TravelSegmentEditModal, {
      segment: vacation.travelSegments[0],
      segmentIndex: 0,
    });
    (w.vm as Vm).flightNumber = 'QF12';
    await save(w);
    expect(updateSegment).toHaveBeenCalledTimes(1);
    expect(updateSegment).toHaveBeenCalledWith('v1', 'out', { flightNumber: 'QF12' });
  });

  it('an untouched save sends an empty diff', async () => {
    const { updateSegment } = setup();
    const w = await mountOpen(TravelSegmentEditModal, {
      segment: vacation.travelSegments[0],
      segmentIndex: 0,
    });
    await save(w);
    expect(updateSegment).toHaveBeenCalledWith('v1', 'out', {});
  });

  it('syncs the return flight with a second id-addressed patch on the CURRENT segments', async () => {
    const { updateSegment } = setup();
    const w = await mountOpen(TravelSegmentEditModal, {
      segment: vacation.travelSegments[0],
      segmentIndex: 0,
    });
    (w.vm as Vm).airline = 'Delta';
    await save(w);
    expect(updateSegment).toHaveBeenCalledTimes(2);
    expect(updateSegment).toHaveBeenNthCalledWith(1, 'v1', 'out', { airline: 'Delta' });
    // The return still mirrored the outbound's old airline, so it follows; airports are unchanged
    // and the title is not regenerated.
    expect(updateSegment).toHaveBeenNthCalledWith(2, 'v1', 'ret', { airline: 'Delta' });
  });

  it('does not touch a return flight the user has diverged', async () => {
    const { store, updateSegment } = setup();
    store.vacations[0]!.travelSegments[1]!.airline = 'Virgin';
    const w = await mountOpen(TravelSegmentEditModal, {
      segment: vacation.travelSegments[0],
      segmentIndex: 0,
    });
    (w.vm as Vm).airline = 'Delta';
    await save(w);
    expect(updateSegment).toHaveBeenCalledTimes(1);
  });
});

describe('AccommodationEditModal', () => {
  it('saves only the changed field, by id', async () => {
    const { updateSegment } = setup();
    const w = await mountOpen(AccommodationEditModal, {
      accommodation: vacation.accommodations[0],
      accommodationIndex: 0,
    });
    (w.vm as Vm).notes = '';
    await save(w);
    const patch = updateSegment.mock.calls[0]![2] as Record<string, unknown>;
    expect(updateSegment.mock.calls[0]!.slice(0, 2)).toEqual(['v1', 'acc']);
    expect(Object.keys(patch)).toEqual(['notes']);
    expect(patch.notes).toBeUndefined();
  });
});

describe('TransportationEditModal', () => {
  it('saves only the changed field, by id', async () => {
    const { updateSegment } = setup();
    const w = await mountOpen(TransportationEditModal, {
      transportation: vacation.transportation[0],
      transportationIndex: 0,
    });
    (w.vm as Vm).operator = 'Flixbus';
    await save(w);
    // The derived title follows the operator, so it is part of the diff too.
    expect(updateSegment).toHaveBeenCalledWith(
      'v1',
      'tr',
      expect.objectContaining({ operator: 'Flixbus' })
    );
    expect(Object.keys(updateSegment.mock.calls[0]![2] as object).sort()).toEqual([
      'operator',
      'title',
    ]);
  });
});
