/**
 * Integration test: verify vacations survive the full Automerge round-trip.
 *
 * Exercises the EXACT production code path:
 *   initDoc() → createVacation via repository → saveDoc() → resetDoc() → loadDoc() → getAll()
 *
 * Also tests the replaceDoc() path (used when loading from .beanpod files).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as Automerge from '@automerge/automerge';
import { initDoc, saveDoc, loadDoc, resetDoc, getDoc, replaceDoc } from '../docService';
import * as vacationRepo from '../repositories/vacationRepository';
import * as activityRepo from '../repositories/activityRepository';
import type { FamilyDocument } from '@/types/automerge';
import type { CreateFamilyVacationInput, CreateFamilyActivityInput } from '@/types/models';

beforeEach(() => {
  resetDoc();
});

describe('Vacation persistence — full round-trip', () => {
  it('vacation survives initDoc → create → saveDoc → loadDoc', async () => {
    // 1. Initialize fresh doc
    initDoc();

    // 2. Create a vacation through the real repository
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

    // 3. Verify it's in the doc
    const doc = getDoc();
    const vacations = doc.vacations;
    expect(vacations).toBeDefined();
    expect(Object.keys(vacations).length).toBe(1);
    expect(Object.values(vacations)[0]!.name).toBe('Beach Trip 2026');

    // 4. Save to binary
    const binary = saveDoc();
    expect(binary.length).toBeGreaterThan(0);

    // 5. Reset (simulates app shutdown)
    resetDoc();
    expect(() => getDoc()).toThrow();

    // 6. Load from binary (simulates app startup)
    const loaded = loadDoc(binary);
    expect(loaded.vacations).toBeDefined();
    expect(Object.keys(loaded.vacations).length).toBe(1);

    const restoredVacation = Object.values(loaded.vacations)[0]!;
    expect(restoredVacation.name).toBe('Beach Trip 2026');
    expect(restoredVacation.tripType).toBe('fly_and_stay');
    expect(restoredVacation.travelSegments).toHaveLength(1);
    expect(restoredVacation.accommodations).toHaveLength(1);
    expect(restoredVacation.accommodations[0]!.confirmationNumber).toBe('BH-12345');
    expect(restoredVacation.ideas).toHaveLength(1);
    expect(restoredVacation.ideas[0]!.votes).toHaveLength(1);

    // 7. Verify getAll() works after reload
    const allVacations = await vacationRepo.getAllVacations();
    expect(allVacations).toHaveLength(1);
    expect(allVacations[0]!.name).toBe('Beach Trip 2026');
  });

  it('vacation survives the replaceDoc path (beanpod file load)', async () => {
    // 1. Initialize and create vacation
    initDoc();
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

    // 2. Save to binary
    const binary = saveDoc();

    // 3. Reset
    resetDoc();

    // 4. Load via Automerge.load() directly (what fileSync does)
    const rawDoc = Automerge.load<FamilyDocument>(binary);

    // 5. replaceDoc (what syncStore does after fileSync returns)
    replaceDoc(rawDoc);

    // 6. Verify vacation survived
    const allVacations = await vacationRepo.getAllVacations();
    expect(allVacations).toHaveLength(1);
    expect(allVacations[0]!.name).toBe('Ski Trip');
  });

  it('vacation + linked activity both persist', async () => {
    // Simulates the real vacationStore.createVacation flow
    initDoc();

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

    // Save and reload
    const binary = saveDoc();
    resetDoc();
    loadDoc(binary);

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

  it('migration adds vacations collection to old doc without one', async () => {
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

    // Verify vacations is missing
    expect((oldDoc as Record<string, unknown>).vacations).toBeUndefined();

    // Save old doc to binary
    const oldBinary = Automerge.save(oldDoc);

    // Load via loadDoc (should migrate)
    const migrated = loadDoc(oldBinary);
    expect(migrated.vacations).toBeDefined();
    expect(Object.keys(migrated.vacations).length).toBe(0);

    // Now create a vacation on the migrated doc
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

    // Verify it persists through another round-trip
    const binary2 = saveDoc();
    resetDoc();
    loadDoc(binary2);

    const all = await vacationRepo.getAllVacations();
    expect(all).toHaveLength(1);
    expect(all[0]!.name).toBe('Migrated Trip');
  });

  it('migration works via replaceDoc for old docs', async () => {
    // Old doc without vacations
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
    } as unknown as Record<string, unknown>) as Automerge.Doc<FamilyDocument>;

    const oldBinary = Automerge.save(oldDoc);
    const rawLoaded = Automerge.load<FamilyDocument>(oldBinary);

    // replaceDoc should migrate
    replaceDoc(rawLoaded);

    // Should be able to create vacation now
    const vacation = await vacationRepo.createVacation({
      activityId: 'act-xyz',
      name: 'ReplaceDoc Trip',
      tripType: 'camping',
      assigneeIds: [],
      travelSegments: [],
      accommodations: [],
      transportation: [],
      ideas: [],
      createdBy: 'member-1',
    });

    expect(vacation.name).toBe('ReplaceDoc Trip');

    // Verify round-trip
    const binary = saveDoc();
    resetDoc();
    loadDoc(binary);

    const all = await vacationRepo.getAllVacations();
    expect(all).toHaveLength(1);
  });

  it('changeDoc is actually called during vacation creation', async () => {
    initDoc();

    // Before: vacations collection should be empty
    const docBefore = getDoc();
    expect(Object.keys(docBefore.vacations).length).toBe(0);

    // Create vacation
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

    // After: vacations collection should have 1 item
    const docAfter = getDoc();
    expect(Object.keys(docAfter.vacations).length).toBe(1);

    // The doc reference should have changed (Automerge creates new immutable docs)
    expect(docAfter).not.toBe(docBefore);
  });
});
