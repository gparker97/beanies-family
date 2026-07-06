/**
 * Integration test: verify vacations survive the full doc round-trip.
 *
 * ADR-032: the doc + persistence live in the worker; this drives the REAL inline
 * backend (docClient → applyAndProject → projection) on the main thread. The
 * "app shutdown → startup" reload is simulated with the worker's own save/load
 * path: `exportSnapshot()` (raw binary) → fresh backend → `loadSnapshot(binary)`
 * (loads + migrates + re-projects). The generic binary round-trip is unit-tested
 * in `worker/__tests__/docOps.test.ts`; this asserts vacations (with nested
 * travelSegments / accommodations / ideas) survive through the real repo path.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as Automerge from '@automerge/automerge';
import { installInlineBackend } from '../worker/__tests__/inlineHarness';
import { exportSnapshot, loadSnapshot } from '../worker/docClient';
import * as vacationRepo from '../repositories/vacationRepository';
import * as activityRepo from '../repositories/activityRepository';
import type { FamilyDocument } from '@/types/automerge';
import type { CreateFamilyVacationInput, CreateFamilyActivityInput } from '@/types/models';

/** Simulate an app restart: export the current doc, spin up a fresh backend, and
 *  re-adopt the exported bytes (loadSnapshot loads + migrates + re-projects). */
async function reloadFromSnapshot(): Promise<void> {
  const { binary } = await exportSnapshot();
  await installInlineBackend();
  await loadSnapshot(binary);
}

beforeEach(async () => {
  await installInlineBackend();
});

describe('Vacation persistence — full round-trip', () => {
  it('vacation survives create → export → reload', async () => {
    // Create a vacation through the real repository
    const input: CreateFamilyVacationInput = {
      activityId: 'act-123',
      name: 'Beach Trip 2026',
      tripType: 'fly_and_stay',
      assigneeIds: ['member-1', 'member-2'],
      travelSegments: [
        {
          id: 'seg-1',
          type: 'flight_outbound',
          title: 'Outbound Flight',
          status: 'booked',
          departureDate: '2026-07-10',
          arrivalDate: '2026-07-10',
        },
      ],
      accommodations: [
        {
          id: 'acc-1',
          type: 'hotel',
          title: 'Beach Hotel',
          status: 'booked',
          checkInDate: '2026-07-10',
          checkOutDate: '2026-07-15',
          confirmationNumber: 'BH-12345',
        },
      ],
      transportation: [],
      ideas: [
        {
          id: 'idea-1',
          title: 'Snorkeling',
          votes: [{ memberId: 'member-1', votedAt: '2026-03-20T00:00:00.000Z' }],
          createdBy: 'member-1',
          createdAt: '2026-03-20T00:00:00.000Z',
        },
      ],
      createdBy: 'member-1',
    };

    const created = await vacationRepo.createVacation(input);
    expect(created).toBeDefined();
    expect(created.id).toBeDefined();
    expect(created.name).toBe('Beach Trip 2026');

    // Verify it's readable before reload
    const before = await vacationRepo.getAllVacations();
    expect(before).toHaveLength(1);

    // Simulate app shutdown + startup via the worker save/load path
    await reloadFromSnapshot();

    const allVacations = await vacationRepo.getAllVacations();
    expect(allVacations).toHaveLength(1);
    const restored = allVacations[0]!;
    expect(restored.name).toBe('Beach Trip 2026');
    expect(restored.tripType).toBe('fly_and_stay');
    expect(restored.travelSegments).toHaveLength(1);
    expect(restored.accommodations).toHaveLength(1);
    expect(restored.accommodations[0]!.confirmationNumber).toBe('BH-12345');
    expect(restored.ideas).toHaveLength(1);
    expect(restored.ideas[0]!.votes).toHaveLength(1);
  });

  it('vacation survives adopting a raw snapshot (beanpod file load path)', async () => {
    await vacationRepo.createVacation({
      activityId: 'act-456',
      name: 'Ski Trip',
      tripType: 'adventure',
      assigneeIds: ['member-1'],
      travelSegments: [],
      accommodations: [],
      transportation: [],
      ideas: [],
      createdBy: 'member-1',
    });

    // loadSnapshot is the post-migration "adopt this doc" operation that
    // replaceDoc used to be (syncStore/dataBridge drive it after a file load).
    await reloadFromSnapshot();

    const allVacations = await vacationRepo.getAllVacations();
    expect(allVacations).toHaveLength(1);
    expect(allVacations[0]!.name).toBe('Ski Trip');
  });

  it('vacation + linked activity both persist', async () => {
    // Step 1: Create linked activity
    const activity = await activityRepo.createActivity({
      title: 'Caribbean Cruise',
      category: 'other_activity',
      icon: '✈️',
      date: '2026-07-10',
      endDate: '2026-07-18',
      isAllDay: true,
      recurrence: 'none',
      feeSchedule: 'none',
      reminderMinutes: 0,
      isActive: true,
      assigneeIds: ['member-1'],
      createdBy: 'member-1',
    } as CreateFamilyActivityInput);

    // Step 2: Create vacation
    const vacation = await vacationRepo.createVacation({
      activityId: activity.id,
      name: 'Caribbean Cruise 2026',
      tripType: 'cruise',
      assigneeIds: ['member-1'],
      travelSegments: [],
      accommodations: [],
      transportation: [],
      ideas: [],
      createdBy: 'member-1',
    });

    // Step 3: Link activity → vacation
    await activityRepo.updateActivity(activity.id, { vacationId: vacation.id });

    await reloadFromSnapshot();

    // Verify both survived
    const vacations = await vacationRepo.getAllVacations();
    expect(vacations).toHaveLength(1);
    expect(vacations[0]!.name).toBe('Caribbean Cruise 2026');
    expect(vacations[0]!.activityId).toBe(activity.id);

    const activities = await activityRepo.getAllActivities();
    const linkedActivity = activities.find((a) => a.id === activity.id);
    expect(linkedActivity).toBeDefined();
    expect(linkedActivity!.vacationId).toBe(vacation.id);
  });

  it('adopting an old snapshot without a vacations collection migrates it', async () => {
    // Simulate an old beanpod file that has no vacations collection
    const oldDoc = Automerge.from({
      familyMembers: {},
      accounts: {},
      transactions: {},
      assets: {},
      goals: {},
      budgets: {},
      recurringItems: {},
      todos: {},
      activities: {},
      settings: null,
      // NOTE: no 'vacations' field!
    } as unknown as Record<string, unknown>) as Automerge.Doc<FamilyDocument>;
    expect((oldDoc as Record<string, unknown>).vacations).toBeUndefined();

    // Adopt via loadSnapshot (loadDoc migrates missing collections).
    await loadSnapshot(Automerge.save(oldDoc));

    // The migrated doc can now hold vacations.
    const vacation = await vacationRepo.createVacation({
      activityId: 'act-789',
      name: 'Migrated Trip',
      tripType: 'road_trip',
      assigneeIds: ['member-1'],
      travelSegments: [],
      accommodations: [],
      transportation: [],
      ideas: [],
      createdBy: 'member-1',
    });
    expect(vacation.name).toBe('Migrated Trip');

    // And it persists through another round-trip.
    await reloadFromSnapshot();
    const all = await vacationRepo.getAllVacations();
    expect(all).toHaveLength(1);
    expect(all[0]!.name).toBe('Migrated Trip');
  });

  it('createVacation mutates the projection (0 → 1)', async () => {
    const before = await vacationRepo.getAllVacations();
    expect(before).toHaveLength(0);

    await vacationRepo.createVacation({
      activityId: 'test-act',
      name: 'ChangeDoc Test',
      tripType: 'combo',
      assigneeIds: ['m1'],
      travelSegments: [],
      accommodations: [],
      transportation: [],
      ideas: [],
      createdBy: 'm1',
    });

    const after = await vacationRepo.getAllVacations();
    expect(after).toHaveLength(1);
    expect(after[0]!.name).toBe('ChangeDoc Test');
  });
});
