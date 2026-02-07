import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  FamilyMember,
  Account,
  Transaction,
  Asset,
  Goal,
  Settings,
  SyncQueueItem,
  RecurringItem,
  TranslationCacheEntry,
} from '@/types/models';

const DB_NAME = 'gp-family-finance';
const DB_VERSION = 3;

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

let dbInstance: IDBPDatabase<FinanceDB> | null = null;

export async function getDatabase(): Promise<IDBPDatabase<FinanceDB>> {
  if (dbInstance) {
    return dbInstance;
  }

  dbInstance = await openDB<FinanceDB>(DB_NAME, DB_VERSION, {
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

  return dbInstance;
}

export async function closeDatabase(): Promise<void> {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

export async function clearAllData(): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction(
    ['familyMembers', 'accounts', 'transactions', 'assets', 'goals', 'recurringItems', 'settings', 'syncQueue'],
    'readwrite'
  );

  await Promise.all([
    tx.objectStore('familyMembers').clear(),
    tx.objectStore('accounts').clear(),
    tx.objectStore('transactions').clear(),
    tx.objectStore('assets').clear(),
    tx.objectStore('goals').clear(),
    tx.objectStore('recurringItems').clear(),
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
  settings: Settings | null;
}

export async function exportAllData(): Promise<ExportedData> {
  const db = await getDatabase();

  const [familyMembers, accounts, transactions, assets, goals, recurringItems, settings] = await Promise.all([
    db.getAll('familyMembers'),
    db.getAll('accounts'),
    db.getAll('transactions'),
    db.getAll('assets'),
    db.getAll('goals'),
    db.getAll('recurringItems'),
    db.get('settings', 'app_settings'),
  ]);

  return {
    familyMembers,
    accounts,
    transactions,
    assets,
    goals,
    recurringItems,
    settings: settings ?? null,
  };
}

export async function importAllData(data: ExportedData): Promise<void> {
  const db = await getDatabase();

  // Clear existing data first (file always wins)
  const clearTx = db.transaction(
    ['familyMembers', 'accounts', 'transactions', 'assets', 'goals', 'recurringItems', 'settings'],
    'readwrite'
  );

  await Promise.all([
    clearTx.objectStore('familyMembers').clear(),
    clearTx.objectStore('accounts').clear(),
    clearTx.objectStore('transactions').clear(),
    clearTx.objectStore('assets').clear(),
    clearTx.objectStore('goals').clear(),
    clearTx.objectStore('recurringItems').clear(),
    clearTx.objectStore('settings').clear(),
    clearTx.done,
  ]);

  // Import all data
  const importTx = db.transaction(
    ['familyMembers', 'accounts', 'transactions', 'assets', 'goals', 'recurringItems', 'settings'],
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

  // Import settings (if present)
  if (data.settings) {
    promises.push(importTx.objectStore('settings').add(data.settings));
  }

  promises.push(importTx.done);
  await Promise.all(promises);
}
