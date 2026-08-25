import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useVacationStore } from './vacationStore';
import { showToast } from '@/composables/useToast';

vi.mock('@/composables/useToast', () => ({
  showToast: vi.fn(),
  useToast: () => ({ toasts: { value: [] }, showToast: vi.fn(), dismissToast: vi.fn() }),
}));

vi.mock('@/composables/useToday', async () => {
  const { ref, computed } = await import('vue');
  const { toDateInputValue, getStartOfDay } = await import('@/utils/date');
  return {
    useToday: () => ({
      today: ref(toDateInputValue(new Date())),
      startOfToday: computed(() => getStartOfDay(new Date())),
      isVisible: ref(true),
      lastVisibleAt: ref(0),
      lastHiddenAt: ref(0),
    }),
  };
});
import type {
  FamilyVacation,
  FamilyActivity,
  VacationTravelSegment,
  VacationAccommodation,
  VacationTransportation,
  VacationIdea,
} from '@/types/models';

// Mock the vacation repository
vi.mock('@/services/automerge/repositories/vacationRepository', () => ({
  getAllVacations: vi.fn(),
  getVacationById: vi.fn(),
  createVacation: vi.fn(),
  updateVacation: vi.fn(),
  deleteVacation: vi.fn(),
}));

// Mock the activity repository
vi.mock('@/services/automerge/repositories/activityRepository', () => ({
  createActivity: vi.fn(),
  updateActivity: vi.fn(),
  deleteActivity: vi.fn(),
}));

import * as vacationRepo from '@/services/automerge/repositories/vacationRepository';
import * as activityRepo from '@/services/automerge/repositories/activityRepository';

const NOW = '2026-03-01T00:00:00.000Z';

// ── Factory helpers ──

function makeVacation(overrides?: Partial<FamilyVacation>): FamilyVacation {
  return {
    id: 'vac-1',
    activityId: 'act-1',
    name: 'Beach Trip',
    tripType: 'fly_and_stay',
    assigneeIds: ['m-1', 'm-2'],
    travelSegments: [],
    accommodations: [],
    transportation: [],
    ideas: [],
    createdBy: 'm-1',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeActivity(overrides?: Partial<FamilyActivity>): FamilyActivity {
  return {
    id: 'act-1',
    title: 'Beach Trip',
    date: '2026-07-01',
    recurrence: 'none',
    category: 'other_activity',
    isActive: true,
    isAllDay: true,
    feeSchedule: 'none',
    reminderMinutes: 0,
    createdBy: 'm-1',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as FamilyActivity;
}

describe('vacationStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Load ──

  describe('loadVacations', () => {
    it('calls getAllVacations and sets state', async () => {
      const store = useVacationStore();
      const vacations = [makeVacation(), makeVacation({ id: 'vac-2', name: 'Ski Trip' })];
      vi.mocked(vacationRepo.getAllVacations).mockResolvedValue(vacations);

      await store.loadVacations();

      expect(vacationRepo.getAllVacations).toHaveBeenCalledOnce();
      expect(store.vacations).toHaveLength(2);
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
    });

    it('sets error on failure', async () => {
      const store = useVacationStore();
      vi.mocked(vacationRepo.getAllVacations).mockRejectedValue(new Error('DB error'));

      await store.loadVacations();

      expect(store.vacations).toHaveLength(0);
      expect(store.error).toBe('DB error');
    });
  });

  // ── Create ──

  describe('createVacation', () => {
    it('creates vacation and linked activity with bidirectional IDs', async () => {
      const store = useVacationStore();

      const createdActivity = makeActivity({ id: 'act-new' });
      vi.mocked(activityRepo.createActivity).mockResolvedValue(createdActivity);

      const createdVacation = makeVacation({ id: 'vac-new', activityId: 'act-new' });
      vi.mocked(vacationRepo.createVacation).mockResolvedValue(createdVacation);
      vi.mocked(activityRepo.updateActivity).mockResolvedValue(createdActivity);

      const input = {
        name: 'Beach Trip',
        tripType: 'fly_and_stay' as const,
        assigneeIds: ['m-1'],
        travelSegments: [] as VacationTravelSegment[],
        accommodations: [] as VacationAccommodation[],
        transportation: [] as VacationTransportation[],
        ideas: [] as VacationIdea[],
        createdBy: 'm-1',
      };

      const result = await store.createVacation(input);

      expect(result).not.toBeNull();
      expect(result!.id).toBe('vac-new');
      // Activity was created first
      expect(activityRepo.createActivity).toHaveBeenCalledOnce();
      // Vacation was created with activityId
      expect(vacationRepo.createVacation).toHaveBeenCalledWith(
        expect.objectContaining({ activityId: 'act-new' })
      );
      // Bidirectional link: activity updated with vacationId
      expect(activityRepo.updateActivity).toHaveBeenCalledWith('act-new', {
        vacationId: 'vac-new',
      });
      expect(store.vacations).toHaveLength(1);
    });
  });

  // ── Update ──

  describe('updateVacation', () => {
    it('updates vacation and syncs linked activity dates', async () => {
      const store = useVacationStore();
      const existing = makeVacation({
        travelSegments: [
          {
            id: 's1',
            type: 'flight_outbound',
            title: 'Flight',
            status: 'booked',
            departureDate: '2026-07-01',
            arrivalDate: '2026-07-01',
          },
        ],
      });
      store.vacations.push(existing);

      const updatedVacation = makeVacation({
        name: 'Updated Beach Trip',
        startDate: '2026-07-01',
        endDate: '2026-07-10',
        accommodations: [
          {
            id: 'a1',
            type: 'hotel',
            title: 'Hotel',
            status: 'booked',
            checkInDate: '2026-07-01',
            checkOutDate: '2026-07-10',
          },
        ],
      });
      vi.mocked(vacationRepo.updateVacation).mockResolvedValue(updatedVacation);
      vi.mocked(activityRepo.updateActivity).mockResolvedValue(makeActivity());

      const result = await store.updateVacation('vac-1', {
        name: 'Updated Beach Trip',
        accommodations: [
          {
            id: 'a1',
            type: 'hotel',
            title: 'Hotel',
            status: 'booked',
            checkInDate: '2026-07-01',
            checkOutDate: '2026-07-10',
          },
        ],
      });

      expect(result).not.toBeNull();
      // Vacation repo was called with computed dates
      expect(vacationRepo.updateVacation).toHaveBeenCalledWith(
        'vac-1',
        expect.objectContaining({
          name: 'Updated Beach Trip',
          startDate: '2026-07-01',
          endDate: '2026-07-10',
        })
      );
      // Activity was synced with dates and title
      expect(activityRepo.updateActivity).toHaveBeenCalledWith(
        'act-1',
        expect.objectContaining({
          title: 'Updated Beach Trip',
          date: '2026-07-01',
          endDate: '2026-07-10',
        })
      );
    });

    // ── ADR-023: user-owned dates, extend-never-shrink ──

    it('extends endDate when a new segment date is later than current end', async () => {
      const store = useVacationStore();
      const existing = makeVacation({
        startDate: '2026-07-01',
        endDate: '2026-07-10',
        travelSegments: [
          {
            id: 's-out',
            type: 'flight_outbound',
            title: 'Out',
            status: 'booked',
            departureDate: '2026-07-01',
          },
          {
            id: 's-ret',
            type: 'flight_return',
            title: 'Ret',
            status: 'booked',
            departureDate: '2026-07-10',
          },
        ],
      });
      store.vacations.push(existing);

      vi.mocked(vacationRepo.updateVacation).mockImplementation(async (_id, input) => ({
        ...existing,
        ...input,
      }));
      vi.mocked(activityRepo.updateActivity).mockResolvedValue(makeActivity());

      // User moves the return flight to 2026-07-15 — trip end should extend.
      await store.updateVacation('vac-1', {
        travelSegments: [
          { ...existing.travelSegments[0]! },
          { ...existing.travelSegments[1]!, departureDate: '2026-07-15' },
        ],
      });

      expect(vacationRepo.updateVacation).toHaveBeenCalledWith(
        'vac-1',
        expect.objectContaining({
          startDate: '2026-07-01', // unchanged
          endDate: '2026-07-15', // extended
        })
      );
    });

    it('extends startDate when a new segment date is earlier than current start', async () => {
      const store = useVacationStore();
      const existing = makeVacation({
        startDate: '2026-07-01',
        endDate: '2026-07-10',
        travelSegments: [
          {
            id: 's-out',
            type: 'flight_outbound',
            title: 'Out',
            status: 'booked',
            departureDate: '2026-07-01',
          },
        ],
      });
      store.vacations.push(existing);

      vi.mocked(vacationRepo.updateVacation).mockImplementation(async (_id, input) => ({
        ...existing,
        ...input,
      }));
      vi.mocked(activityRepo.updateActivity).mockResolvedValue(makeActivity());

      // Move outbound earlier — trip start extends backward.
      await store.updateVacation('vac-1', {
        travelSegments: [{ ...existing.travelSegments[0]!, departureDate: '2026-06-28' }],
      });

      expect(vacationRepo.updateVacation).toHaveBeenCalledWith(
        'vac-1',
        expect.objectContaining({
          startDate: '2026-06-28',
          endDate: '2026-07-10',
        })
      );
    });

    it('does not shrink when a segment date moves to within the current window', async () => {
      const store = useVacationStore();
      const existing = makeVacation({
        startDate: '2026-07-01',
        endDate: '2026-07-10',
        travelSegments: [
          {
            id: 's-out',
            type: 'flight_outbound',
            title: 'Out',
            status: 'booked',
            departureDate: '2026-07-01',
          },
          {
            id: 's-ret',
            type: 'flight_return',
            title: 'Ret',
            status: 'booked',
            departureDate: '2026-07-10',
          },
        ],
      });
      store.vacations.push(existing);

      vi.mocked(vacationRepo.updateVacation).mockImplementation(async (_id, input) => ({
        ...existing,
        ...input,
      }));
      vi.mocked(activityRepo.updateActivity).mockResolvedValue(makeActivity());

      // User moves outbound to Jul 3 — within current window. Trip dates must not shrink.
      await store.updateVacation('vac-1', {
        travelSegments: [
          { ...existing.travelSegments[0]!, departureDate: '2026-07-03' },
          { ...existing.travelSegments[1]! },
        ],
      });

      expect(vacationRepo.updateVacation).toHaveBeenCalledWith(
        'vac-1',
        expect.objectContaining({
          startDate: '2026-07-01',
          endDate: '2026-07-10',
        })
      );
    });

    it('accepts a manual startDate/endDate edit (can shrink the window)', async () => {
      const store = useVacationStore();
      const existing = makeVacation({
        startDate: '2026-07-01',
        endDate: '2026-07-10',
      });
      store.vacations.push(existing);

      vi.mocked(vacationRepo.updateVacation).mockImplementation(async (_id, input) => ({
        ...existing,
        ...input,
      }));
      vi.mocked(activityRepo.updateActivity).mockResolvedValue(makeActivity());

      // Manual shrink from the summary page.
      await store.updateVacation('vac-1', {
        startDate: '2026-07-03',
        endDate: '2026-07-08',
      });

      expect(vacationRepo.updateVacation).toHaveBeenCalledWith(
        'vac-1',
        expect.objectContaining({
          startDate: '2026-07-03',
          endDate: '2026-07-08',
        })
      );
    });

    it('seeds dates from segments when existing vacation has undefined dates', async () => {
      const store = useVacationStore();
      // Historical vacation with no trip dates (pre-ADR-023).
      const existing = makeVacation({
        startDate: undefined,
        endDate: undefined,
        travelSegments: [
          {
            id: 's-out',
            type: 'flight_outbound',
            title: 'Out',
            status: 'booked',
            departureDate: '2026-07-01',
          },
        ],
      });
      store.vacations.push(existing);

      vi.mocked(vacationRepo.updateVacation).mockImplementation(async (_id, input) => ({
        ...existing,
        ...input,
      }));
      vi.mocked(activityRepo.updateActivity).mockResolvedValue(makeActivity());

      // Any mutation triggers the seed-fallback since existing had no dates.
      await store.updateVacation('vac-1', {
        accommodations: [
          {
            id: 'a1',
            type: 'hotel',
            title: 'Hotel',
            status: 'booked',
            checkInDate: '2026-07-02',
            checkOutDate: '2026-07-09',
          },
        ],
      });

      expect(vacationRepo.updateVacation).toHaveBeenCalledWith(
        'vac-1',
        expect.objectContaining({
          startDate: '2026-07-01',
          endDate: '2026-07-09',
        })
      );
    });

    it('surfaces a warning toast when activity sync fails after vacation save', async () => {
      const store = useVacationStore();
      const existing = makeVacation({ startDate: '2026-07-01', endDate: '2026-07-10' });
      store.vacations.push(existing);

      vi.mocked(vacationRepo.updateVacation).mockResolvedValue({
        ...existing,
        name: 'Renamed',
      });
      vi.mocked(activityRepo.updateActivity).mockRejectedValue(new Error('network fail'));

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      const result = await store.updateVacation('vac-1', { name: 'Renamed' });

      // Vacation save still succeeded.
      expect(result).not.toBeNull();
      expect(result?.name).toBe('Renamed');
      // Toast warned the user.
      expect(showToast).toHaveBeenCalledWith(
        'warning',
        expect.stringContaining('calendar may be out of date'),
        expect.any(String)
      );
      // Console logged with the grep-able prefix.
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[vacation] Vacation updated but linked activity'),
        expect.any(Error)
      );

      errorSpy.mockRestore();
    });

    it('returns null and logs when the vacation id is not found', async () => {
      const store = useVacationStore();
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      const result = await store.updateVacation('vac-missing', { name: 'does not matter' });

      expect(result).toBeNull();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[vacation] updateVacation: no vacation with id "vac-missing"')
      );
      expect(vacationRepo.updateVacation).not.toHaveBeenCalled();

      errorSpy.mockRestore();
    });
  });

  // ── Delete ──

  describe('deleteVacation', () => {
    it('deletes both vacation and linked activity', async () => {
      const store = useVacationStore();
      const vacation = makeVacation();
      store.vacations.push(vacation);

      vi.mocked(activityRepo.deleteActivity).mockResolvedValue(true);
      vi.mocked(vacationRepo.deleteVacation).mockResolvedValue(true);

      const result = await store.deleteVacation('vac-1');

      expect(result).toBe(true);
      expect(activityRepo.deleteActivity).toHaveBeenCalledWith('act-1');
      expect(vacationRepo.deleteVacation).toHaveBeenCalledWith('vac-1');
      expect(store.vacations).toHaveLength(0);
    });

    it('returns false for non-existent vacation', async () => {
      const store = useVacationStore();
      const result = await store.deleteVacation('non-existent');
      expect(result).toBe(false);
    });
  });

  // ── toggleIdeaVote ──

  describe('toggleIdeaVote', () => {
    it('adds vote for new member', async () => {
      const store = useVacationStore();
      const vacation = makeVacation({
        ideas: [
          {
            id: 'idea-1',
            title: 'Snorkeling',
            votes: [],
            createdBy: 'm-1',
            createdAt: NOW,
          },
        ],
      });
      store.vacations.push(vacation);

      const updatedVacation = makeVacation({
        ideas: [
          {
            id: 'idea-1',
            title: 'Snorkeling',
            votes: [{ memberId: 'm-2', votedAt: NOW }],
            createdBy: 'm-1',
            createdAt: NOW,
          },
        ],
      });
      vi.mocked(vacationRepo.updateVacation).mockResolvedValue(updatedVacation);
      vi.mocked(activityRepo.updateActivity).mockResolvedValue(makeActivity());

      await store.toggleIdeaVote('vac-1', 'idea-1', 'm-2');

      // Should call updateVacation with ideas containing the new vote
      expect(vacationRepo.updateVacation).toHaveBeenCalledWith(
        'vac-1',
        expect.objectContaining({
          ideas: expect.arrayContaining([
            expect.objectContaining({
              id: 'idea-1',
              votes: expect.arrayContaining([expect.objectContaining({ memberId: 'm-2' })]),
            }),
          ]),
        })
      );
    });

    it('removes existing vote for member', async () => {
      const store = useVacationStore();
      const vacation = makeVacation({
        ideas: [
          {
            id: 'idea-1',
            title: 'Snorkeling',
            votes: [{ memberId: 'm-2', votedAt: NOW }],
            createdBy: 'm-1',
            createdAt: NOW,
          },
        ],
      });
      store.vacations.push(vacation);

      const updatedVacation = makeVacation({
        ideas: [
          {
            id: 'idea-1',
            title: 'Snorkeling',
            votes: [],
            createdBy: 'm-1',
            createdAt: NOW,
          },
        ],
      });
      vi.mocked(vacationRepo.updateVacation).mockResolvedValue(updatedVacation);
      vi.mocked(activityRepo.updateActivity).mockResolvedValue(makeActivity());

      await store.toggleIdeaVote('vac-1', 'idea-1', 'm-2');

      // Should call updateVacation with ideas where the vote is removed
      expect(vacationRepo.updateVacation).toHaveBeenCalledWith(
        'vac-1',
        expect.objectContaining({
          ideas: expect.arrayContaining([
            expect.objectContaining({
              id: 'idea-1',
              votes: [],
            }),
          ]),
        })
      );
    });
  });

  // ── Getters ──

  describe('upcomingVacations', () => {
    it('returns future vacations sorted by startDate', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 2, 20)); // March 20, 2026

      const store = useVacationStore();
      store.vacations = [
        makeVacation({ id: 'v1', startDate: '2026-08-01', endDate: '2026-08-10' }),
        makeVacation({ id: 'v2', startDate: '2026-04-01', endDate: '2026-04-05' }),
        makeVacation({ id: 'v3', startDate: '2026-01-01', endDate: '2026-01-05' }), // past
      ];

      const upcoming = store.upcomingVacations;

      // Past vacation (ended Jan 5) should be excluded
      expect(upcoming).toHaveLength(2);
      // Sorted by startDate ascending
      expect(upcoming[0]!.id).toBe('v2'); // April
      expect(upcoming[1]!.id).toBe('v1'); // August
    });
  });

  describe('vacationByActivityId', () => {
    it('provides O(1) lookup by activityId', () => {
      const store = useVacationStore();
      store.vacations = [
        makeVacation({ id: 'v1', activityId: 'act-100' }),
        makeVacation({ id: 'v2', activityId: 'act-200' }),
      ];

      const map = store.vacationByActivityId;

      expect(map.get('act-100')!.id).toBe('v1');
      expect(map.get('act-200')!.id).toBe('v2');
      expect(map.get('act-999')).toBeUndefined();
    });
  });

  describe('travelSegmentOccurrences', () => {
    function flightSegment(overrides: Partial<VacationTravelSegment> = {}): VacationTravelSegment {
      return {
        id: 'seg-flight-1',
        type: 'flight_outbound',
        title: 'SFO → JFK',
        status: 'booked',
        departureDate: '2026-06-15',
        departureTime: '09:00',
        arrivalDate: '2026-06-15',
        arrivalTime: '17:30',
        ...overrides,
      };
    }

    it('returns empty list for empty vacations', () => {
      const store = useVacationStore();
      store.vacations = [];
      expect(store.allTravelSegmentOccurrences).toEqual([]);
    });

    it('travelSegmentOccurrencesInRange filters to the visible window', () => {
      const store = useVacationStore();
      store.vacations = [
        makeVacation({
          id: 'v1',
          travelSegments: [
            flightSegment({ id: 's1', departureDate: '2026-06-15', arrivalDate: '2026-06-15' }),
            flightSegment({ id: 's2', departureDate: '2026-07-20', arrivalDate: '2026-07-20' }),
          ],
        }),
      ];

      const june = store.travelSegmentOccurrencesInRange('2026-06-01', '2026-06-30');
      expect(june).toHaveLength(2);
      expect(june.every((o) => o.segmentId === 's1')).toBe(true);

      const july = store.travelSegmentOccurrencesInRange('2026-07-01', '2026-07-31');
      expect(july).toHaveLength(2);
      expect(july.every((o) => o.segmentId === 's2')).toBe(true);

      // Range that excludes both
      expect(store.travelSegmentOccurrencesInRange('2026-08-01', '2026-08-31')).toEqual([]);
    });

    it('cross-month overnight flight: departure in June, arrival in July', () => {
      const store = useVacationStore();
      store.vacations = [
        makeVacation({
          id: 'v1',
          travelSegments: [
            flightSegment({
              id: 's-overnight',
              departureDate: '2026-06-30',
              departureTime: '22:00',
              arrivalDate: '2026-07-01',
              arrivalTime: '02:30',
            }),
          ],
        }),
      ];

      const june = store.travelSegmentOccurrencesInRange('2026-06-01', '2026-06-30');
      expect(june).toHaveLength(1);
      expect(june[0]).toMatchObject({ kind: 'departure', date: '2026-06-30', time: '22:00' });

      const july = store.travelSegmentOccurrencesInRange('2026-07-01', '2026-07-31');
      expect(july).toHaveLength(1);
      expect(july[0]).toMatchObject({ kind: 'arrival', date: '2026-07-01', time: '02:30' });
    });

    it('safeExtract swallows thrown errors and continues with the rest', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Build a corrupt segment whose data-field access throws. Vue's
      // reactivity probes for internal symbols (`__v_isRef`, etc.) when
      // wrapping objects in stores — return undefined for those so we
      // only blow up on real domain-field access (mimics real-world
      // CRDT-corruption shape).
      const corruptSegment = new Proxy({} as VacationTravelSegment, {
        get(_t, prop) {
          if (typeof prop === 'symbol') return undefined;
          if (prop.startsWith('__')) return undefined;
          if (prop === 'id') return 'corrupt-seg';
          if (prop === 'type') return 'flight_outbound';
          throw new Error(`boom on access to ${String(prop)}`);
        },
      });

      const store = useVacationStore();
      store.vacations = [
        makeVacation({
          id: 'v1',
          travelSegments: [corruptSegment, flightSegment({ id: 'good-seg' })],
        }),
      ];

      const out = store.allTravelSegmentOccurrences;
      // Corrupt segment yields 0 occurrences; healthy one still yields 2.
      expect(out).toHaveLength(2);
      expect(out.every((o) => o.segmentId === 'good-seg')).toBe(true);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          '[vacationStore] failed to extract occurrences for segment corrupt-seg'
        ),
        expect.any(Error)
      );

      errorSpy.mockRestore();
    });

    it('reactively reflects mutations to vacations[]', () => {
      const store = useVacationStore();
      store.vacations = [makeVacation({ id: 'v1', travelSegments: [] })];
      expect(store.allTravelSegmentOccurrences).toEqual([]);

      store.vacations = [
        makeVacation({
          id: 'v1',
          travelSegments: [flightSegment({ id: 'fresh-seg' })],
        }),
      ];
      expect(store.allTravelSegmentOccurrences).toHaveLength(2);
      expect(store.allTravelSegmentOccurrences[0].segmentId).toBe('fresh-seg');
    });
  });

  // ── Characterisation tests written BEFORE the decomposition ──
  //
  // These pin behaviour that had no coverage at all, so the refactor that follows can be
  // proven behaviour-preserving rather than assumed to be. Each one was named by
  // /code-review max as a place where a real bug could hide unnoticed.

  describe('addExtractedSegments (was entirely untested)', () => {
    function extracted(over?: Record<string, unknown>) {
      return {
        travelSegments: [],
        accommodations: [],
        transportation: [],
        ...over,
      } as never;
    }

    it('MERGES a re-upload of the same booking instead of duplicating it', async () => {
      const store = useVacationStore();
      const existing = makeVacation({
        travelSegments: [
          {
            id: 's-1',
            type: 'flight_outbound',
            title: 'Out',
            status: 'pending',
            flightNumber: 'BA123',
            departureDate: '2026-07-01',
          },
        ],
      });
      store.vacations.push(existing);
      vi.mocked(vacationRepo.updateVacation).mockImplementation(async (_id, input) => ({
        ...existing,
        ...input,
      }));
      vi.mocked(activityRepo.updateActivity).mockResolvedValue(makeActivity());

      const res = await store.addExtractedSegments(
        'vac-1',
        extracted({
          travelSegments: [
            {
              id: 's-new',
              type: 'flight_outbound',
              title: 'Out',
              status: 'booked',
              flightNumber: 'BA123',
              departureDate: '2026-07-01',
            },
          ],
        })
      );

      expect(res).not.toBeNull();
      // One segment, not two — same flight number + date is the same booking.
      const saved = vi.mocked(vacationRepo.updateVacation).mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      expect((saved.travelSegments as unknown[]).length).toBe(1);
      // The document must be re-pointed at the SURVIVING id, or its attachment is orphaned.
      expect(res!.idRemap['s-new']).toBe('s-1');
    });

    it('APPENDS a genuinely different booking', async () => {
      const store = useVacationStore();
      const existing = makeVacation({
        travelSegments: [
          {
            id: 's-1',
            type: 'flight_outbound',
            title: 'Out',
            status: 'booked',
            flightNumber: 'BA123',
            departureDate: '2026-07-01',
          },
        ],
      });
      store.vacations.push(existing);
      vi.mocked(vacationRepo.updateVacation).mockImplementation(async (_id, input) => ({
        ...existing,
        ...input,
      }));
      vi.mocked(activityRepo.updateActivity).mockResolvedValue(makeActivity());

      await store.addExtractedSegments(
        'vac-1',
        extracted({
          travelSegments: [
            {
              id: 's-2',
              type: 'flight_return',
              title: 'Back',
              status: 'booked',
              flightNumber: 'BA999',
              departureDate: '2026-07-10',
            },
          ],
        })
      );

      const saved = vi.mocked(vacationRepo.updateVacation).mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      expect((saved.travelSegments as unknown[]).length).toBe(2);
    });

    it('leaves the OTHER buckets untouched when only one is extracted', async () => {
      const store = useVacationStore();
      const existing = makeVacation({
        accommodations: [
          {
            id: 'a-1',
            type: 'hotel',
            title: 'Hotel',
            status: 'booked',
            checkInDate: '2026-07-01',
          },
        ],
      });
      store.vacations.push(existing);
      vi.mocked(vacationRepo.updateVacation).mockImplementation(async (_id, input) => ({
        ...existing,
        ...input,
      }));
      vi.mocked(activityRepo.updateActivity).mockResolvedValue(makeActivity());

      await store.addExtractedSegments(
        'vac-1',
        extracted({
          travelSegments: [{ id: 's-9', type: 'flight_outbound', title: 'Out', status: 'booked' }],
        })
      );

      const saved = vi.mocked(vacationRepo.updateVacation).mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      expect((saved.accommodations as unknown[]).length).toBe(1);
    });

    it('returns null for an unknown vacation rather than throwing', async () => {
      const store = useVacationStore();
      expect(await store.addExtractedSegments('nope', extracted())).toBeNull();
    });
  });

  describe('createVacation date seeding (the branch the old test never reached)', () => {
    it('seeds the trip window from a transportation departureDate', async () => {
      // The old test passed empty arrays, so this branch never ran — and it is the AI-reader
      // path, where onReviewSubmit supplies no startDate/endDate. A coach itinerary carries
      // departureDate (not pickupDate), which computeVacationDates used to ignore entirely,
      // producing a DATELESS trip whose activity fell back to today.
      const store = useVacationStore();
      const createdActivity = makeActivity({ id: 'act-new' });
      vi.mocked(activityRepo.createActivity).mockResolvedValue(createdActivity);
      vi.mocked(activityRepo.updateActivity).mockResolvedValue(createdActivity);
      vi.mocked(vacationRepo.createVacation).mockImplementation(
        async (input) => ({ ...makeVacation(), ...input, id: 'vac-new' }) as never
      );

      await store.createVacation({
        name: 'Coach Trip',
        tripType: 'road_trip' as const,
        assigneeIds: ['m-1'],
        travelSegments: [],
        accommodations: [],
        ideas: [],
        createdBy: 'm-1',
        transportation: [
          {
            id: 't-1',
            type: 'bus',
            title: 'Coach',
            status: 'booked',
            departureDate: '2026-09-14',
          },
        ],
      } as never);

      const created = vi.mocked(vacationRepo.createVacation).mock.calls[0]![0] as Record<
        string,
        unknown
      >;
      expect(created.startDate).toBe('2026-09-14');
      expect(created.endDate).toBe('2026-09-14');
    });
  });

  describe('updateSegment / deleteSegment address by ID, never by index', () => {
    function tripWithThree() {
      return makeVacation({
        travelSegments: [
          { id: 's-a', type: 'flight_outbound', title: 'A', status: 'booked' },
          { id: 's-b', type: 'ferry', title: 'B', status: 'booked' },
          { id: 's-c', type: 'flight_return', title: 'C', status: 'booked' },
        ],
      });
    }

    it('patches the segment with the given id, whatever its position', async () => {
      const store = useVacationStore();
      const existing = tripWithThree();
      store.vacations.push(existing);
      vi.mocked(vacationRepo.updateVacation).mockImplementation(async (_id, input) => ({
        ...existing,
        ...input,
      }));
      vi.mocked(activityRepo.updateActivity).mockResolvedValue(makeActivity());

      expect(await store.updateSegment('vac-1', 's-b', { title: 'Renamed' })).toBe(true);

      const saved = vi.mocked(vacationRepo.updateVacation).mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      const segs = saved.travelSegments as Array<{ id: string; title: string }>;
      expect(segs.find((x) => x.id === 's-b')!.title).toBe('Renamed');
      // The neighbours must be untouched — the index-addressed version wrote the wrong one.
      expect(segs.find((x) => x.id === 's-a')!.title).toBe('A');
      expect(segs.find((x) => x.id === 's-c')!.title).toBe('C');
    });

    it('merges the patch onto the CURRENT value, so untouched fields survive', async () => {
      const store = useVacationStore();
      const existing = tripWithThree();
      store.vacations.push(existing);
      vi.mocked(vacationRepo.updateVacation).mockImplementation(async (_id, input) => ({
        ...existing,
        ...input,
      }));
      vi.mocked(activityRepo.updateActivity).mockResolvedValue(makeActivity());

      await store.updateSegment('vac-1', 's-b', { status: 'pending' });
      const saved = vi.mocked(vacationRepo.updateVacation).mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      const seg = (
        saved.travelSegments as Array<{ id: string; title: string; status: string }>
      ).find((x) => x.id === 's-b')!;
      expect(seg.status).toBe('pending');
      expect(seg.title).toBe('B'); // not blanked by a partial patch
    });

    it('refuses to write when the segment is gone, rather than writing elsewhere', async () => {
      const store = useVacationStore();
      store.vacations.push(tripWithThree());
      expect(await store.updateSegment('vac-1', 's-deleted', { title: 'X' })).toBe(false);
      expect(vacationRepo.updateVacation).not.toHaveBeenCalled();
    });

    it('an empty patch is a no-op, not a full rewrite', async () => {
      const store = useVacationStore();
      store.vacations.push(tripWithThree());
      expect(await store.updateSegment('vac-1', 's-b', {})).toBe(true);
      expect(vacationRepo.updateVacation).not.toHaveBeenCalled();
    });

    it('deleteSegment removes only the named segment', async () => {
      const store = useVacationStore();
      const existing = tripWithThree();
      store.vacations.push(existing);
      vi.mocked(vacationRepo.updateVacation).mockImplementation(async (_id, input) => ({
        ...existing,
        ...input,
      }));
      vi.mocked(activityRepo.updateActivity).mockResolvedValue(makeActivity());

      expect(await store.deleteSegment('vac-1', 's-b')).toBe(true);
      const saved = vi.mocked(vacationRepo.updateVacation).mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      const ids = (saved.travelSegments as Array<{ id: string }>).map((x) => x.id);
      expect(ids).toEqual(['s-a', 's-c']);
    });
  });

  describe('saveExtractedTrip (the cross-store transaction moved out of the view)', () => {
    function buckets(over?: Record<string, unknown>) {
      return {
        travelSegments: [],
        accommodations: [],
        transportation: [],
        ...over,
      } as never;
    }

    beforeEach(() => {
      const createdActivity = makeActivity({ id: 'act-new' });
      vi.mocked(activityRepo.createActivity).mockResolvedValue(createdActivity);
      vi.mocked(activityRepo.updateActivity).mockResolvedValue(createdActivity);
      vi.mocked(vacationRepo.createVacation).mockImplementation(
        async (input) => ({ ...makeVacation(), ...input, id: 'vac-new' }) as never
      );
    });

    it('seeds trip travellers from the union the document named', async () => {
      const store = useVacationStore();
      const res = await store.saveExtractedTrip(
        { kind: 'create', tripName: 'Japan', tripType: 'fly_and_stay' },
        buckets({
          travelSegments: [
            {
              id: 's-1',
              type: 'flight_outbound',
              title: 'Out',
              status: 'booked',
              travellerIds: ['m-1'],
            },
            {
              id: 's-2',
              type: 'flight_return',
              title: 'Back',
              status: 'booked',
              travellerIds: ['m-2'],
            },
          ],
        }),
        'm-1'
      );

      expect(res?.vacationId).toBe('vac-new');
      const created = vi.mocked(vacationRepo.createVacation).mock.calls[0]![0] as Record<
        string,
        unknown
      >;
      expect(created.assigneeIds).toEqual(['m-1', 'm-2']);
    });

    it('materializes that union onto a segment the model matched nobody for', async () => {
      const store = useVacationStore();
      await store.saveExtractedTrip(
        { kind: 'create', tripName: 'Japan', tripType: 'fly_and_stay' },
        buckets({
          travelSegments: [
            {
              id: 's-1',
              type: 'flight_outbound',
              title: 'Out',
              status: 'booked',
              travellerIds: ['m-1'],
            },
            { id: 's-2', type: 'ferry', title: 'Ferry', status: 'booked' },
          ],
        }),
        'm-1'
      );
      const created = vi.mocked(vacationRepo.createVacation).mock.calls[0]![0] as Record<
        string,
        unknown
      >;
      const segs = created.travelSegments as Array<{ id: string; travellerIds?: string[] }>;
      expect(segs.find((x) => x.id === 's-2')!.travellerIds).toEqual(['m-1']);
    });

    it('does NOT materialize an EMPTY union — the segment must stay undefined', async () => {
      // The rule that had no enforcement. `[]` is DEFINED, and a defined travellerIds is
      // never re-resolved when the trip's travellers change — so a document naming nobody
      // (routine on hotel confirmations) pinned every segment to "nobody" permanently: no
      // avatars, and the flight on no one's calendar with no UI able to clear it.
      const store = useVacationStore();
      await store.saveExtractedTrip(
        { kind: 'create', tripName: 'Japan', tripType: 'fly_and_stay' },
        buckets({
          accommodations: [{ id: 'a-1', type: 'hotel', title: 'Hotel', status: 'booked' }],
        }),
        'm-1'
      );
      const created = vi.mocked(vacationRepo.createVacation).mock.calls[0]![0] as Record<
        string,
        unknown
      >;
      const accs = created.accommodations as Array<{ travellerIds?: string[] }>;
      expect(accs[0]!.travellerIds).toBeUndefined();
    });

    it('attaches to an existing trip and returns the id-remap', async () => {
      const store = useVacationStore();
      const existing = makeVacation({
        travelSegments: [
          {
            id: 's-existing',
            type: 'flight_outbound',
            title: 'Out',
            status: 'pending',
            flightNumber: 'BA123',
            departureDate: '2026-07-01',
          },
        ],
      });
      store.vacations.push(existing);
      vi.mocked(vacationRepo.updateVacation).mockImplementation(async (_id, input) => ({
        ...existing,
        ...input,
      }));

      const res = await store.saveExtractedTrip(
        { kind: 'attach', vacationId: 'vac-1' },
        buckets({
          travelSegments: [
            {
              id: 's-extracted',
              type: 'flight_outbound',
              title: 'Out',
              status: 'booked',
              flightNumber: 'BA123',
              departureDate: '2026-07-01',
            },
          ],
        }),
        'm-1'
      );

      expect(res?.vacationId).toBe('vac-1');
      // The document must follow the SURVIVING id or its attachment is orphaned.
      expect(res!.idRemap['s-extracted']).toBe('s-existing');
    });

    it('returns null rather than throwing when the attach target is gone', async () => {
      const store = useVacationStore();
      expect(
        await store.saveExtractedTrip({ kind: 'attach', vacationId: 'nope' }, buckets(), 'm-1')
      ).toBeNull();
    });
  });
});
