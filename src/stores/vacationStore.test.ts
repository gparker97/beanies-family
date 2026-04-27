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
});
