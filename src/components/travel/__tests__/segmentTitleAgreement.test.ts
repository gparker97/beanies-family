/**
 * One title rule (`segmentDisplayTitle`), every surface. A segment whose stored `title` is a
 * sentinel that must never be shown, and one with a custom title, give the same text from the
 * calendar occurrence, the timeline item (which is what the wall shows), a hint and the import
 * review row. The code-first rule for flights is pinned here too, so reversing it is deliberate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { computed, nextTick, ref } from 'vue';
import { setActivePinia, createPinia } from 'pinia';
import TravelExtractReviewModal from '@/components/travel/TravelExtractReviewModal.vue';
import { useVacationTimeline } from '@/composables/useVacationTimeline';
import { flightLabel } from '@/utils/flightStatus/occurrenceNotice';
import {
  computeTimelineHints,
  extractSegmentOccurrences,
  segmentDisplayTitle,
} from '@/utils/vacation';
import type { FamilyVacation, VacationTravelSegment } from '@/types/models';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key, isEnglish: { value: true } }),
}));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

type Vm = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const SENTINEL = 'SENTINEL-STORED-TITLE';
/** The hint templates hold `{title}`; keep the key so a message is traceable. */
const t = ((k: string) => `${k}<{title}>`) as unknown as Parameters<typeof computeTimelineHints>[1];

function seg(over: Partial<VacationTravelSegment>): VacationTravelSegment {
  return {
    id: 'x',
    type: 'flight_outbound',
    title: SENTINEL,
    status: 'booked',
    departureDate: '2026-12-13',
    departureTime: '17:00',
    arrivalDate: '2026-12-13',
    arrivalTime: '23:10',
    ...over,
  };
}

const automatic = seg({
  id: 'auto',
  departureAirport: 'Singapore (SIN)',
  arrivalAirport: 'Guangzhou (CAN)',
});
const custom = seg({
  id: 'custom',
  type: 'flight_return',
  customTitle: 'Home to the boys',
  departureAirport: 'Guangzhou (CAN)',
  arrivalAirport: 'Singapore (SIN)',
  departureDate: '2026-12-15',
  arrivalDate: '2026-12-15',
});
/** A cruise spanning both flights, so each flight is named on the cruise card's hint. */
const cruise = seg({
  id: 'cruise',
  type: 'cruise',
  cruiseLine: 'Royal Caribbean',
  embarkationDate: '2026-12-12',
  disembarkationDate: '2026-12-20',
  departureDate: undefined,
  arrivalDate: undefined,
});

function trip(segments: VacationTravelSegment[], over: Partial<FamilyVacation> = {}) {
  return {
    id: 'v1',
    activityId: 'a1',
    name: 'Trip',
    tripType: 'fly_and_stay',
    assigneeIds: ['m1'],
    travelSegments: segments,
    accommodations: [],
    transportation: [],
    ideas: [],
    createdBy: 'm1',
    createdAt: '2026-11-16T00:00:00.000Z',
    updatedAt: '2026-11-16T00:00:00.000Z',
    ...over,
  } as FamilyVacation;
}

async function reviewRowTitles(segments: VacationTravelSegment[]): Promise<string[]> {
  const w = mount(TravelExtractReviewModal, {
    props: {
      open: true,
      ready: {
        buckets: { travelSegments: segments, accommodations: [], transportation: [] },
        travellerNamesBySegmentId: {},
        distinctTravellerNames: [],
        tripType: 'fly_and_stay',
        target: { kind: 'create' },
        suggestedTripName: 'Trip',
        sourceFile: null,
      },
    } as never,
    shallow: true,
  });
  await nextTick();
  return ((w.vm as Vm).rows as Array<{ title: string }>).map((r) => r.title);
}

beforeEach(() => setActivePinia(createPinia()));

describe('every surface shows the same title', () => {
  it.each([
    ['an automatic title (stored title is a sentinel)', automatic, 'SIN → CAN'],
    ['a custom title', custom, 'Home to the boys'],
  ])('%s', async (_name, segment, expected) => {
    expect(segmentDisplayTitle(segment)).toBe(expected);

    const v = trip([cruise, segment]);
    const occurrences = extractSegmentOccurrences('v1', segment, 1, ['m1']);
    const { timelineItems } = useVacationTimeline(
      computed(() => v),
      ref('2026-12-01')
    );
    const item = timelineItems.value.find((i) => i.id === segment.id)!;
    const cruiseHint = computeTimelineHints(v, t).get('cruise')!.message;
    const [row] = await reviewRowTitles([segment]);

    const seen = [...occurrences.map((o) => o.title), item.title, row];
    expect(occurrences).toHaveLength(2);
    expect(seen.every((s) => s === expected)).toBe(true);
    expect(cruiseHint).toContain(`<${expected}>`);
    for (const s of [...seen, cruiseHint]) expect(s).not.toContain(SENTINEL);
  });
});

describe('a flight is named by its code first where a code is shown (product decision)', () => {
  /** The airline moved this flight to land after the next stay's check-in day. */
  function lateWith(over: Partial<VacationTravelSegment>) {
    return trip(
      [
        seg({
          id: 'late',
          customTitle: 'To Grandma',
          departureAirport: 'SIN',
          arrivalAirport: 'LHR',
          departureTime: '18:30',
          arrivalDate: '2026-12-14',
          arrivalTime: '00:40',
          liveAppliedAt: '2026-12-12T09:00:00.000Z',
          liveWas: {
            departureTime: '17:00',
            arrivalDate: '2026-12-13',
            arrivalTime: '23:10',
            at: '2026-12-12T09:00:00.000Z',
          },
          ...over,
        }),
      ],
      {
        accommodations: [
          {
            id: 'hoxton',
            type: 'hotel',
            title: 'The Hoxton',
            name: 'The Hoxton',
            status: 'booked',
            checkInDate: '2026-12-13',
          },
        ] as FamilyVacation['accommodations'],
      }
    );
  }

  it('with a flight number: the title is the custom title, the code labels give the code', () => {
    const v = lateWith({ airline: 'Singapore Airlines (SQ)', flightNumber: 'SQ318' });
    const s = v.travelSegments[0]!;
    const [departure] = extractSegmentOccurrences('v1', s, 0, ['m1']);
    expect(departure!.title).toBe('To Grandma');
    expect(flightLabel(departure!)).toBe('SQ318');
    // The hint written on ANOTHER card (the stay) names the flight by its code.
    expect(computeTimelineHints(v, t).get('hoxton')!.message).toContain('<SQ318>');
  });

  it('without a flight number: the code labels fall back to the display title', () => {
    const v = lateWith({ airline: undefined, flightNumber: undefined });
    const s = v.travelSegments[0]!;
    const [departure] = extractSegmentOccurrences('v1', s, 0, ['m1']);
    expect(flightLabel(departure!)).toBe('To Grandma');
    expect(computeTimelineHints(v, t).get('hoxton')!.message).toContain('<To Grandma>');

    const automaticOnly = lateWith({ customTitle: undefined });
    const [dep2] = extractSegmentOccurrences('v1', automaticOnly.travelSegments[0]!, 0, ['m1']);
    expect(flightLabel(dep2!)).toBe('SIN → LHR');
    expect(computeTimelineHints(automaticOnly, t).get('hoxton')!.message).toContain('<SIN → LHR>');
  });
});
