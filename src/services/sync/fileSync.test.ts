/**
 * fileSync persistence tests.
 *
 * Validates that preferredCurrencies and todos survive
 * an export→import cycle (the .beanpod round-trip).
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import {
  setActiveFamily,
  getDatabase,
  closeDatabase,
  exportAllData,
  getFamilyDatabaseName,
} from '@/services/indexeddb/database';
import { closeRegistryDatabase } from '@/services/indexeddb/registryDatabase';
import { createSyncFileData, importSyncFileData } from '@/services/sync/fileSync';
import { getSettings, saveSettings } from '@/services/indexeddb/repositories/settingsRepository';
import type { FamilyMember, TodoItem, CurrencyCode } from '@/types/models';

const FAMILY_ID = 'test-family-sync';

function makeMember(overrides: Partial<FamilyMember> & { id: string; name: string }): FamilyMember {
  return {
    email: `${overrides.name.toLowerCase()}@test.com`,
    gender: 'other',
    ageGroup: 'adult',
    role: 'owner',
    color: '#3b82f6',
    requiresPassword: false,
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
    ...overrides,
  };
}

function makeTodo(overrides: Partial<TodoItem> & { id: string; title: string }): TodoItem {
  return {
    completed: false,
    createdBy: 'member-1',
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
    ...overrides,
  };
}

describe('fileSync persistence (export → import)', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await closeDatabase();
    await closeRegistryDatabase();
    // Delete the database so each test starts with a clean slate
    const dbName = getFamilyDatabaseName(FAMILY_ID);
    indexedDB.deleteDatabase(dbName);
    await setActiveFamily(FAMILY_ID);
  });

  afterEach(async () => {
    await closeDatabase();
    await closeRegistryDatabase();
  });

  it('preserves preferredCurrencies through export→import', async () => {
    // Seed a family member (required by validation)
    const db = await getDatabase();
    await db.add('familyMembers', makeMember({ id: 'member-1', name: 'Alice' }));

    // Set preferred currencies
    const currencies: CurrencyCode[] = ['GBP', 'EUR', 'JPY'];
    await saveSettings({ preferredCurrencies: currencies });

    // Verify they're stored
    const before = await getSettings();
    expect(before.preferredCurrencies).toEqual(currencies);

    // Export to sync file
    const syncFile = await createSyncFileData(false);

    // Wipe and re-import
    await closeDatabase();
    await setActiveFamily(FAMILY_ID);
    const freshDb = await getDatabase();
    // Clear all stores
    const clearTx = freshDb.transaction(
      [
        'familyMembers',
        'accounts',
        'transactions',
        'assets',
        'goals',
        'recurringItems',
        'todos',
        'settings',
      ],
      'readwrite'
    );
    await Promise.all([
      clearTx.objectStore('familyMembers').clear(),
      clearTx.objectStore('accounts').clear(),
      clearTx.objectStore('transactions').clear(),
      clearTx.objectStore('assets').clear(),
      clearTx.objectStore('goals').clear(),
      clearTx.objectStore('recurringItems').clear(),
      clearTx.objectStore('todos').clear(),
      clearTx.objectStore('settings').clear(),
    ]);
    await clearTx.done;

    // Verify settings are wiped
    const wiped = await getSettings();
    expect(wiped.preferredCurrencies).toEqual([]);

    // Import the sync file
    await importSyncFileData(syncFile);

    // Verify preferredCurrencies survived
    const after = await getSettings();
    expect(after.preferredCurrencies).toEqual(currencies);
  });

  it('preserves todos through export→import', async () => {
    const db = await getDatabase();
    await db.add('familyMembers', makeMember({ id: 'member-1', name: 'Alice' }));

    // Create todos
    const todo1 = makeTodo({ id: 'todo-1', title: 'Buy groceries', assigneeId: 'member-1' });
    const todo2 = makeTodo({
      id: 'todo-2',
      title: 'Walk the dog',
      completed: true,
      completedBy: 'member-1',
    });
    await db.add('todos', todo1);
    await db.add('todos', todo2);

    // Verify stored
    const todosBefore = await db.getAll('todos');
    expect(todosBefore).toHaveLength(2);

    // Export
    const syncFile = await createSyncFileData(false);
    expect(syncFile.data.todos).toHaveLength(2);

    // Wipe and re-import
    await closeDatabase();
    await setActiveFamily(FAMILY_ID);
    const freshDb = await getDatabase();
    const clearTx = freshDb.transaction(
      [
        'familyMembers',
        'accounts',
        'transactions',
        'assets',
        'goals',
        'recurringItems',
        'todos',
        'settings',
      ],
      'readwrite'
    );
    await Promise.all([
      clearTx.objectStore('familyMembers').clear(),
      clearTx.objectStore('accounts').clear(),
      clearTx.objectStore('transactions').clear(),
      clearTx.objectStore('assets').clear(),
      clearTx.objectStore('goals').clear(),
      clearTx.objectStore('recurringItems').clear(),
      clearTx.objectStore('todos').clear(),
      clearTx.objectStore('settings').clear(),
    ]);
    await clearTx.done;

    // Verify wiped
    const todosWiped = await freshDb.getAll('todos');
    expect(todosWiped).toHaveLength(0);

    // Import
    await importSyncFileData(syncFile);

    // Verify todos survived
    const todosAfter = await freshDb.getAll('todos');
    expect(todosAfter).toHaveLength(2);
    expect(todosAfter.map((t) => t.title).sort()).toEqual(['Buy groceries', 'Walk the dog']);
    expect(todosAfter.find((t) => t.id === 'todo-2')!.completed).toBe(true);
  });

  it('import uses file preferredCurrencies, not local defaults', async () => {
    const db = await getDatabase();
    await db.add('familyMembers', makeMember({ id: 'member-1', name: 'Alice' }));

    // Set local currencies to something different
    await saveSettings({ preferredCurrencies: ['USD'] });

    // Build a sync file with different currencies
    const fileCurrencies: CurrencyCode[] = ['CHF', 'SEK'];
    const exported = await exportAllData();
    const syncFile = {
      version: '2.0',
      exportedAt: '2024-01-01',
      encrypted: false as const,
      data: {
        ...exported,
        settings: {
          ...exported.settings!,
          preferredCurrencies: fileCurrencies,
        },
      },
    };

    // Import — file's currencies should win
    await importSyncFileData(syncFile);

    const after = await getSettings();
    expect(after.preferredCurrencies).toEqual(fileCurrencies);
  });
});
