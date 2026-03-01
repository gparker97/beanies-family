import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  FamilyMember,
  Account,
  Transaction,
  Asset,
  Goal,
  Budget,
  Settings,
  SyncQueueItem,
  RecurringItem,
  TodoItem,
  FamilyActivity,
  TranslationCacheEntry,
  DeletionTombstone,
} from '@/types/models';

const LEGACY_DB_NAME = 'gp-family-finance';
const DB_NAME_PREFIX = 'gp-family-finance-';
const DB_VERSION = 6;

export interface FinanceDB extends DBSchema {
  familyMembers: {
    key: string;
    value: FamilyMember;
    indexes: { 'by-email': string };
  };
  accounts: {
    key: string;
    value: Account;
    indexes: { 'by-memberId': string; 'by-type': string };
  };
  transactions: {
    key: string;
    value: Transaction;
    indexes: { 'by-accountId': string; 'by-date': string; 'by-category': string };
  };
  assets: {
    key: string;
    value: Asset;
    indexes: { 'by-memberId': string; 'by-type': string };
  };
  goals: {
    key: string;
    value: Goal;
    indexes: { 'by-memberId': string };
  };
  recurringItems: {
    key: string;
    value: RecurringItem;
    indexes: { 'by-accountId': string; 'by-type': string; 'by-isActive': number };
  };
  todos: {
    key: string;
    value: TodoItem;
    indexes: { 'by-assigneeId': string; 'by-completed': number; 'by-dueDate': string };
  };
  budgets: {
    key: string;
    value: Budget;
    indexes: { 'by-memberId': string; 'by-isActive': number };
  };
  activities: {
    key: string;
    value: FamilyActivity;
    indexes: {
      'by-date': string;
      'by-assigneeId': string;
      'by-category': string;
    };
  };
  settings: {
    key: string;
    value: Settings;
  };
  syncQueue: {
    key: string;
    value: SyncQueueItem;
    indexes: { 'by-synced': number; 'by-timestamp': string };
  };
  translations: {
    key: string;
    value: TranslationCacheEntry;
    indexes: { 'by-language': string };
  };
}

let currentFamilyId: string | null = null;
let dbInstance: IDBPDatabase<FinanceDB> | null = null;

function createFinanceDB(dbName: string): Promise<IDBPDatabase<FinanceDB>> {
  return openDB<FinanceDB>(dbName, DB_VERSION, {
    upgrade(db) {
      // FamilyMembers store
      if (!db.objectStoreNames.contains('familyMembers')) {
        const familyStore = db.createObjectStore('familyMembers', { keyPath: 'id' });
        familyStore.createIndex('by-email', 'email', { unique: true });
      }

      // Accounts store
      if (!db.objectStoreNames.contains('accounts')) {
        const accountsStore = db.createObjectStore('accounts', { keyPath: 'id' });
        accountsStore.createIndex('by-memberId', 'memberId', { unique: false });
        accountsStore.createIndex('by-type', 'type', { unique: false });
      }

      // Transactions store
      if (!db.objectStoreNames.contains('transactions')) {
        const transactionsStore = db.createObjectStore('transactions', { keyPath: 'id' });
        transactionsStore.createIndex('by-accountId', 'accountId', { unique: false });
        transactionsStore.createIndex('by-date', 'date', { unique: false });
        transactionsStore.createIndex('by-category', 'category', { unique: false });
      }

      // Assets store
      if (!db.objectStoreNames.contains('assets')) {
        const assetsStore = db.createObjectStore('assets', { keyPath: 'id' });
        assetsStore.createIndex('by-memberId', 'memberId', { unique: false });
        assetsStore.createIndex('by-type', 'type', { unique: false });
      }

      // Goals store
      if (!db.objectStoreNames.contains('goals')) {
        const goalsStore = db.createObjectStore('goals', { keyPath: 'id' });
        goalsStore.createIndex('by-memberId', 'memberId', { unique: false });
      }

      // RecurringItems store
      if (!db.objectStoreNames.contains('recurringItems')) {
        const recurringStore = db.createObjectStore('recurringItems', { keyPath: 'id' });
        recurringStore.createIndex('by-accountId', 'accountId', { unique: false });
        recurringStore.createIndex('by-type', 'type', { unique: false });
        recurringStore.createIndex('by-isActive', 'isActive', { unique: false });
      }

      // Todos store
      if (!db.objectStoreNames.contains('todos')) {
        const todosStore = db.createObjectStore('todos', { keyPath: 'id' });
        todosStore.createIndex('by-assigneeId', 'assigneeId', { unique: false });
        todosStore.createIndex('by-completed', 'completed', { unique: false });
        todosStore.createIndex('by-dueDate', 'dueDate', { unique: false });
      }

      // Budgets store
      if (!db.objectStoreNames.contains('budgets')) {
        const budgetsStore = db.createObjectStore('budgets', { keyPath: 'id' });
        budgetsStore.createIndex('by-memberId', 'memberId', { unique: false });
        budgetsStore.createIndex('by-isActive', 'isActive', { unique: false });
      }

      // Activities store
      if (!db.objectStoreNames.contains('activities')) {
        const activitiesStore = db.createObjectStore('activities', { keyPath: 'id' });
        activitiesStore.createIndex('by-date', 'date', { unique: false });
        activitiesStore.createIndex('by-assigneeId', 'assigneeId', { unique: false });
        activitiesStore.createIndex('by-category', 'category', { unique: false });
      }

      // Settings store
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'id' });
      }

      // SyncQueue store
      if (!db.objectStoreNames.contains('syncQueue')) {
        const syncStore = db.createObjectStore('syncQueue', { keyPath: 'id' });
        syncStore.createIndex('by-synced', 'synced', { unique: false });
        syncStore.createIndex('by-timestamp', 'timestamp', { unique: false });
      }

      // Translations cache store
      if (!db.objectStoreNames.contains('translations')) {
        const translationsStore = db.createObjectStore('translations', { keyPath: 'id' });
        translationsStore.createIndex('by-language', 'language', { unique: false });
      }
    },
  });
}

/**
 * Set the active family, closing any currently open DB connection.
 * Must be called before any data operations.
 */
export async function setActiveFamily(familyId: string): Promise<void> {
  if (currentFamilyId === familyId && dbInstance) {
    return; // Already active
  }

  // Close current DB if open
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }

  currentFamilyId = familyId;
}

/**
 * Get the current active family ID.
 */
export function getActiveFamilyId(): string | null {
  return currentFamilyId;
}

/**
 * Get the family-scoped database name for a given family ID.
 */
export function getFamilyDatabaseName(familyId: string): string {
  return `${DB_NAME_PREFIX}${familyId}`;
}

/**
 * Get the database for the currently active family.
 * Throws if no family is active.
 */
export async function getDatabase(): Promise<IDBPDatabase<FinanceDB>> {
  if (!currentFamilyId) {
    throw new Error('No active family set. Call setActiveFamily() first.');
  }

  if (dbInstance) {
    return dbInstance;
  }

  const dbName = getFamilyDatabaseName(currentFamilyId);
  dbInstance = await createFinanceDB(dbName);
  return dbInstance;
}

/**
 * Open the legacy database (pre-migration `gp-family-finance`).
 * Used only during migration.
 */
export async function getLegacyDatabase(): Promise<IDBPDatabase<FinanceDB>> {
  return createFinanceDB(LEGACY_DB_NAME);
}

/**
 * Get the legacy database name.
 */
export function getLegacyDatabaseName(): string {
  return LEGACY_DB_NAME;
}

export async function closeDatabase(): Promise<void> {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

/**
 * Delete a family's IndexedDB database entirely.
 * Closes any open connection first, then deletes the database.
 * Used on sign-out to treat IndexedDB as an ephemeral cache.
 */
export async function deleteFamilyDatabase(familyId: string): Promise<void> {
  // Close current connection if it belongs to this family
  if (currentFamilyId === familyId && dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }

  const dbName = getFamilyDatabaseName(familyId);
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(dbName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      console.warn(`Database ${dbName} delete blocked — closing and retrying`);
      resolve(); // Don't block sign-out if DB is held by another tab
    };
  });

  if (currentFamilyId === familyId) {
    currentFamilyId = null;
  }
}

export async function clearAllData(): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction(
    [
      'familyMembers',
      'accounts',
      'transactions',
      'assets',
      'goals',
      'budgets',
      'recurringItems',
      'todos',
      'activities',
      'settings',
      'syncQueue',
    ],
    'readwrite'
  );

  await Promise.all([
    tx.objectStore('familyMembers').clear(),
    tx.objectStore('accounts').clear(),
    tx.objectStore('transactions').clear(),
    tx.objectStore('assets').clear(),
    tx.objectStore('goals').clear(),
    tx.objectStore('budgets').clear(),
    tx.objectStore('recurringItems').clear(),
    tx.objectStore('todos').clear(),
    tx.objectStore('activities').clear(),
    tx.objectStore('settings').clear(),
    tx.objectStore('syncQueue').clear(),
    tx.done,
  ]);
}

export interface ExportedData {
  familyMembers: FamilyMember[];
  accounts: Account[];
  transactions: Transaction[];
  assets: Asset[];
  goals: Goal[];
  recurringItems: RecurringItem[];
  todos?: TodoItem[];
  activities?: FamilyActivity[];
  budgets?: Budget[];
  deletions: DeletionTombstone[];
  settings: Settings | null;
}

export async function exportAllData(): Promise<ExportedData> {
  const db = await getDatabase();

  const [
    familyMembers,
    accounts,
    transactions,
    assets,
    goals,
    recurringItems,
    todos,
    activities,
    budgets,
    settings,
  ] = await Promise.all([
    db.getAll('familyMembers'),
    db.getAll('accounts'),
    db.getAll('transactions'),
    db.getAll('assets'),
    db.getAll('goals'),
    db.getAll('recurringItems'),
    db.getAll('todos'),
    db.getAll('activities'),
    db.getAll('budgets'),
    db.get('settings', 'app_settings'),
  ]);

  return {
    familyMembers,
    accounts,
    transactions,
    assets,
    goals,
    recurringItems,
    todos,
    activities,
    budgets,
    deletions: [], // Tombstones injected by createSyncFileData from the tombstone store
    settings: settings ?? null,
  };
}

export async function importAllData(data: ExportedData): Promise<void> {
  const db = await getDatabase();

  // Clear existing data first (file always wins)
  const clearTx = db.transaction(
    [
      'familyMembers',
      'accounts',
      'transactions',
      'assets',
      'goals',
      'budgets',
      'recurringItems',
      'todos',
      'activities',
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
    clearTx.objectStore('budgets').clear(),
    clearTx.objectStore('recurringItems').clear(),
    clearTx.objectStore('todos').clear(),
    clearTx.objectStore('activities').clear(),
    clearTx.objectStore('settings').clear(),
    clearTx.done,
  ]);

  // Import all data
  const importTx = db.transaction(
    [
      'familyMembers',
      'accounts',
      'transactions',
      'assets',
      'goals',
      'budgets',
      'recurringItems',
      'todos',
      'activities',
      'settings',
    ],
    'readwrite'
  );

  const promises: Promise<unknown>[] = [];

  // Import family members
  for (const member of data.familyMembers) {
    promises.push(importTx.objectStore('familyMembers').add(member));
  }

  // Import accounts
  for (const account of data.accounts) {
    promises.push(importTx.objectStore('accounts').add(account));
  }

  // Import transactions
  for (const transaction of data.transactions) {
    promises.push(importTx.objectStore('transactions').add(transaction));
  }

  // Import assets
  for (const asset of data.assets) {
    promises.push(importTx.objectStore('assets').add(asset));
  }

  // Import goals
  for (const goal of data.goals) {
    promises.push(importTx.objectStore('goals').add(goal));
  }

  // Import recurring items (if present - handle legacy files without this field)
  if (data.recurringItems) {
    for (const recurringItem of data.recurringItems) {
      promises.push(importTx.objectStore('recurringItems').add(recurringItem));
    }
  }

  // Import todos (if present - handle legacy files without this field)
  if (data.todos) {
    for (const todo of data.todos) {
      promises.push(importTx.objectStore('todos').add(todo));
    }
  }

  // Import activities (if present - handle legacy files without this field)
  if (data.activities) {
    for (const activity of data.activities) {
      promises.push(importTx.objectStore('activities').add(activity));
    }
  }

  // Import budgets (if present - handle legacy files without this field)
  if (data.budgets) {
    for (const budget of data.budgets) {
      promises.push(importTx.objectStore('budgets').add(budget));
    }
  }

  // Import settings (if present)
  if (data.settings) {
    promises.push(importTx.objectStore('settings').add(data.settings));
  }

  promises.push(importTx.done);
  await Promise.all(promises);
}
