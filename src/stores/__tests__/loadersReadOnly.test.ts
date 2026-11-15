/**
 * Store loaders are READ-ONLY (2026-11-15). A loader that awaits a document write makes a
 * projection-snapshot paint wait for the whole Automerge rebuild, because every `mutate` queues
 * behind it in the serial worker FIFO. This runs the loaders inside a load phase over the REAL
 * docClient (inline bridge, so `docClient.mutate` and its guard actually run; most store tests
 * mock this layer, where the guard sees nothing), with data that makes every known load-time
 * writer want to write. A loader that writes is recorded by the guard and fails here (and the
 * global `afterEach` in src/test/setup.ts fails any other test that does it).
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => ({ activeFamilyId: 'family-123', activeFamilyName: 'Test Family' }),
}));
vi.mock('@/services/indexeddb/database', () => ({
  getActiveFamilyId: vi.fn(() => 'family-123'),
  getDatabase: vi.fn(async () => ({})),
  closeDatabase: vi.fn(async () => {}),
}));
vi.mock('@/services/registry/registryService', () => ({
  addRegistryEntryObserver: () => () => {},
  registerFamily: vi.fn(async () => {}),
  registerFamilyOrThrow: vi.fn(async () => {}),
  removeFamily: vi.fn(async () => {}),
  lookupFamily: vi.fn(async () => null),
}));
vi.mock('@/services/sync/syncService', async () => ({
  ...(await import('../../services/sync/__mocks__/syncService')),
}));

import { installInlineBackend } from '@/services/automerge/worker/__tests__/inlineHarness';
import { mutate } from '@/services/automerge/worker/docClient';
import {
  __resetLoadMaintenanceForTesting,
  __whenLoadMaintenanceIdleForTesting,
  beginLoadPhase,
  endLoadPhase,
  takeLoadPhaseViolations,
} from '@/services/automerge/loadMaintenance';
import { CHORE_MARK_SWEEP_KEY } from '@/utils/cycleSweepClock';
import { shiftChoreDay } from '@/utils/chores';
import { seedEntities } from './loadTimeWriterFixtures';
import { useSyncStore } from '../syncStore';
import { useFamilyStore } from '../familyStore';
import { useAccountsStore } from '../accountsStore';
import { useTransactionsStore } from '../transactionsStore';
import { useAssetsStore } from '../assetsStore';
import { useGoalsStore } from '../goalsStore';
import { useSettingsStore } from '../settingsStore';
import { useRecurringStore } from '../recurringStore';
import { useTodoStore } from '../todoStore';
import { useListStore } from '../listStore';
import { useActivityStore } from '../activityStore';
import { useVacationStore } from '../vacationStore';
import { useBudgetStore } from '../budgetStore';
import { useFavoritesStore } from '../favoritesStore';
import { useSayingsStore } from '../sayingsStore';
import { useMemberNotesStore } from '../memberNotesStore';
import { useAllergiesStore } from '../allergiesStore';
import { useMedicationsStore } from '../medicationsStore';
import { useMilestonesStore } from '../milestonesStore';
import { useRecipesStore } from '../recipesStore';
import { useMealPlanStore } from '../mealPlanStore';
import { useResponsibilityStore } from '../responsibilityStore';
import { useChoreStore } from '../choreStore';
import { useEmergencyContactsStore } from '../emergencyContactsStore';

/** Every loader `reloadAllStores` and App.vue's direct-loader path call. */
const LOADERS: Array<[string, () => Promise<unknown>]> = [
  ['familyStore.loadMembers', () => useFamilyStore().loadMembers()],
  ['accountsStore.loadAccounts', () => useAccountsStore().loadAccounts()],
  ['transactionsStore.loadTransactions', () => useTransactionsStore().loadTransactions()],
  ['assetsStore.loadAssets', () => useAssetsStore().loadAssets()],
  ['goalsStore.loadGoals', () => useGoalsStore().loadGoals()],
  ['settingsStore.loadSettings', () => useSettingsStore().loadSettings()],
  ['recurringStore.loadRecurringItems', () => useRecurringStore().loadRecurringItems()],
  ['todoStore.loadTodos', () => useTodoStore().loadTodos()],
  ['listStore.loadLists', () => useListStore().loadLists()],
  ['activityStore.loadActivities', () => useActivityStore().loadActivities()],
  ['vacationStore.loadVacations', () => useVacationStore().loadVacations()],
  ['budgetStore.loadBudgets', () => useBudgetStore().loadBudgets()],
  ['favoritesStore.loadFavorites', () => useFavoritesStore().loadFavorites()],
  ['sayingsStore.loadSayings', () => useSayingsStore().loadSayings()],
  ['memberNotesStore.loadMemberNotes', () => useMemberNotesStore().loadMemberNotes()],
  ['allergiesStore.loadAllergies', () => useAllergiesStore().loadAllergies()],
  ['medicationsStore.loadMedications', () => useMedicationsStore().loadMedications()],
  ['milestonesStore.loadMilestones', () => useMilestonesStore().loadMilestones()],
  ['recipesStore.loadRecipes', () => useRecipesStore().loadRecipes()],
  ['mealPlanStore.loadMealPlans', () => useMealPlanStore().loadMealPlans()],
  ['responsibilityStore.load', () => useResponsibilityStore().load()],
  ['choreStore.loadChores', () => useChoreStore().loadChores()],
  [
    'emergencyContactsStore.loadEmergencyContacts',
    () => useEmergencyContactsStore().loadEmergencyContacts(),
  ],
];

async function seedWriteProvokingDocument(): Promise<void> {
  await installInlineBackend(); // the real client, an authoritative document
  for (const [collection, entity] of seedEntities('auth')) {
    await mutate({ op: 'set', collection, id: entity.id as string, entity });
  }
  localStorage.setItem(CHORE_MARK_SWEEP_KEY, shiftChoreDay(useChoreStore().todayYmd, -1));
}

async function inLoadPhase(run: () => Promise<unknown>): Promise<string[]> {
  beginLoadPhase();
  try {
    await run();
  } finally {
    endLoadPhase();
  }
  return takeLoadPhaseViolations();
}

describe('store loaders are read-only', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    __resetLoadMaintenanceForTesting();
    localStorage.clear();
    await seedWriteProvokingDocument();
    // Store setup must not write either (the loaders below instantiate the stores).
    expect(takeLoadPhaseViolations()).toEqual([]);
  });

  it.each(LOADERS)('%s writes nothing inside the load phase', async (_name, load) => {
    // The roster first, as reloadAllStores and the direct path both have it before the rest.
    await useFamilyStore().loadMembers();
    await useAccountsStore().loadAccounts();
    expect(await inLoadPhase(load)).toEqual([]);
  });

  it('reloadAllStores writes nothing inside its own load phase; its maintenance writes after it', async () => {
    await useSyncStore().reloadAllStores();
    await __whenLoadMaintenanceIdleForTesting();
    expect(takeLoadPhaseViolations()).toEqual([]);
    // The writers did run, after the phase: the data was provably write-provoking.
    expect(useListStore().lists[0]?.items[0]?.completed).toBe(false);
  });

  it('control: a write inside the phase IS caught through the real client', async () => {
    await useListStore().loadLists();
    const violations = await inLoadPhase(() => useListStore().reconcileRecurringLists());
    expect(violations.length).toBeGreaterThan(0);
  });
});
