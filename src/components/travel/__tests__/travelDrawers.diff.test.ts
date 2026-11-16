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
import { CHORE_TITLE_MAX } from '@/constants/choreBlocks';
import type { FamilyVacation } from '@/types/models';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    // The title hints keep their `{title}` slot so the filled-in automatic title is visible.
    t: (key: string) => (key.startsWith('vacation.field.titleAutoHint') ? `${key} {title}` : key),
    isEnglish: { value: true },
  }),
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

async function mountOpen(
  component: object,
  props: Record<string, unknown>,
  { slots = false }: { slots?: boolean } = {}
) {
  const w = mount(component as never, {
    props: { open: false, vacationId: 'v1', ...props } as never,
    shallow: true,
    // `slots`: the stubs render their default slot, so the title field's own attributes show.
    global: { renderStubDefaultSlot: slots },
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

  // The fixture's stored titles ("LAX to SYD") are stale on purpose: the editor never sends a
  // non-activity `title`, so an untouched save above stays `{}` even for them.

  it('shows the automatic title as the placeholder, following the form', async () => {
    setup();
    const w = await mountOpen(TravelSegmentEditModal, {
      segment: vacation.travelSegments[0],
      segmentIndex: 0,
    });
    expect((w.vm as Vm).autoTitle).toBe('LAX → SYD');
    expect((w.vm as Vm).customTitle).toBe('');
    (w.vm as Vm).arrivalAirport = 'MEL';
    await nextTick();
    expect((w.vm as Vm).autoTitle).toBe('LAX → MEL');
  });

  it('the hint always shows the automatic title as text, empty field or custom title', async () => {
    setup();
    const w = await mountOpen(
      TravelSegmentEditModal,
      { segment: vacation.travelSegments[0], segmentIndex: 0 },
      { slots: true }
    );
    const field = () => w.find('[data-testid="segment-custom-title"]');
    expect(field().attributes('hint')).toBe('vacation.field.titleAutoHintEmpty LAX → SYD');
    expect(field().attributes('placeholder')).toBe('LAX → SYD');
    (w.vm as Vm).customTitle = 'To Grandma';
    await nextTick();
    // Still visible once the placeholder is hidden, so "Use Automatic Title" is never a guess.
    expect(field().attributes('hint')).toBe('vacation.field.titleAutoHintCustom LAX → SYD');
    (w.vm as Vm).arrivalAirport = 'MEL';
    await nextTick();
    expect(field().attributes('hint')).toBe('vacation.field.titleAutoHintCustom LAX → MEL');
  });

  it('bounds a custom title: maxlength on the input and a trim-and-cut in the payload', async () => {
    const { updateSegment } = setup();
    const w = await mountOpen(
      TravelSegmentEditModal,
      { segment: vacation.travelSegments[0], segmentIndex: 0 },
      { slots: true }
    );
    expect(w.find('[data-testid="segment-custom-title"]').attributes('maxlength')).toBe(
      String(CHORE_TITLE_MAX)
    );
    (w.vm as Vm).customTitle = `  ${'a'.repeat(CHORE_TITLE_MAX - 1)} b c  `;
    await save(w);
    const sent = (updateSegment.mock.calls[0]![2] as { customTitle: string }).customTitle;
    expect(sent).toBe(`${'a'.repeat(CHORE_TITLE_MAX - 1)} `.trim());
    expect(sent.length).toBeLessThanOrEqual(CHORE_TITLE_MAX);
  });

  it('typing a title sends only customTitle (never title)', async () => {
    const { updateSegment } = setup();
    const w = await mountOpen(TravelSegmentEditModal, {
      segment: vacation.travelSegments[0],
      segmentIndex: 0,
    });
    (w.vm as Vm).customTitle = '  To Grandma  ';
    await save(w);
    expect(updateSegment).toHaveBeenCalledTimes(1);
    expect(updateSegment).toHaveBeenCalledWith('v1', 'out', { customTitle: 'To Grandma' });
  });

  it('going back to the automatic title sends customTitle: undefined (a clear)', async () => {
    const { store, updateSegment } = setup();
    const seg = { ...vacation.travelSegments[0]!, customTitle: 'To Grandma' };
    store.vacations[0]!.travelSegments[0] = seg;
    const w = await mountOpen(TravelSegmentEditModal, { segment: seg, segmentIndex: 0 });
    expect((w.vm as Vm).customTitle).toBe('To Grandma');
    (w.vm as Vm).customTitle = ''; // what "Use Automatic Title" and clearing by hand both do
    await save(w);
    const patch = updateSegment.mock.calls[0]![2] as Record<string, unknown>;
    expect(Object.keys(patch)).toEqual(['customTitle']);
    expect(patch.customTitle).toBeUndefined();
  });

  it('an airport change sends no title, and neither does the paired return flight patch', async () => {
    const { updateSegment } = setup();
    const w = await mountOpen(TravelSegmentEditModal, {
      segment: vacation.travelSegments[0],
      segmentIndex: 0,
    });
    (w.vm as Vm).departureAirport = 'SFO';
    await save(w);
    expect(updateSegment).toHaveBeenCalledTimes(2);
    expect(updateSegment).toHaveBeenNthCalledWith(1, 'v1', 'out', { departureAirport: 'SFO' });
    expect(updateSegment).toHaveBeenNthCalledWith(2, 'v1', 'ret', { arrivalAirport: 'SFO' });
  });

  it('an activity still sends its own title and never a customTitle', async () => {
    const { store, updateSegment } = setup();
    const act = { id: 'act', type: 'activity', title: 'Zoo', status: 'pending' };
    store.vacations[0]!.travelSegments.push(act as never);
    const w = await mountOpen(TravelSegmentEditModal, { segment: act, segmentIndex: 2 });
    (w.vm as Vm).title = 'Aquarium';
    await save(w);
    expect(updateSegment).toHaveBeenCalledWith('v1', 'act', { title: 'Aquarium' });
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
