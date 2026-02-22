import { openDB } from 'idb';
import { getRegistryDatabase } from '@/services/indexeddb/registryDatabase';
import {
  getLegacyDatabase,
  getFamilyDatabaseName,
  setActiveFamily,
  type FinanceDB,
} from '@/services/indexeddb/database';
import { saveGlobalSettings } from '@/services/indexeddb/repositories/globalSettingsRepository';
import type { Family, UserFamilyMapping, Settings, GlobalSettings } from '@/types/models';
import { migrateLegacyFileHandle } from '@/services/sync/fileHandleStore';
import { generateUUID } from '@/utils/id';
import { toISODateString } from '@/utils/date';

const MIGRATION_MARKER_KEY = '__migrated_to_family';

/**
 * Check if the legacy database exists and has data that needs migration.
 */
export async function needsLegacyMigration(): Promise<boolean> {
  // Check if registry already exists with families
  try {
    const registryDb = await getRegistryDatabase();
    const families = await registryDb.getAll('families');
    if (families.length > 0) {
      return false; // Already migrated or fresh multi-family setup
    }
  } catch {
    // Registry doesn't exist yet, check for legacy data
  }

  // Check if legacy database exists and has data
  try {
    const legacyDb = await getLegacyDatabase();
    const members = await legacyDb.getAll('familyMembers');
    legacyDb.close();
    return members.length > 0;
  } catch {
    return false;
  }
}

/**
 * Run the legacy migration:
 * 1. Generate a new familyId
 * 2. Create the family in registry
 * 3. Copy all data from legacy DB to per-family DB
 * 4. Extract global settings (theme, language, exchange rates) to registry
 * 5. Create UserFamilyMapping from owner member
 * 6. Mark legacy DB as migrated
 */
export async function runLegacyMigration(): Promise<Family> {
  const now = toISODateString(new Date());
  const familyId = generateUUID();

  // Open legacy DB and read all data
  const legacyDb = await getLegacyDatabase();

  const [familyMembers, accounts, transactions, assets, goals, recurringItems, settings] =
    await Promise.all([
      legacyDb.getAll('familyMembers'),
      legacyDb.getAll('accounts'),
      legacyDb.getAll('transactions'),
      legacyDb.getAll('assets'),
      legacyDb.getAll('goals'),
      legacyDb.getAll('recurringItems'),
      legacyDb.get('settings', 'app_settings'),
    ]);

  // Also grab translations and syncQueue
  const [translations, syncQueue] = await Promise.all([
    legacyDb.getAll('translations'),
    legacyDb.getAll('syncQueue'),
  ]);

  // Determine family name from owner member
  const ownerMember = familyMembers.find((m) => m.role === 'owner');
  const familyName = ownerMember ? `${ownerMember.name}'s Family` : 'My Family';

  // Create Family entity
  const family: Family = {
    id: familyId,
    name: familyName,
    createdAt: now,
    updatedAt: now,
  };

  // Create UserFamilyMapping for owner
  const mappings: UserFamilyMapping[] = [];
  if (ownerMember) {
    mappings.push({
      id: generateUUID(),
      email: ownerMember.email,
      familyId,
      familyRole: 'owner',
      memberId: ownerMember.id,
      lastActiveAt: now,
    });
  }

  // Extract global settings from per-family settings
  const globalSettingsUpdate: Partial<GlobalSettings> = {
    lastActiveFamilyId: familyId,
  };
  if (settings) {
    globalSettingsUpdate.theme = settings.theme;
    globalSettingsUpdate.language = settings.language;
    globalSettingsUpdate.exchangeRates = settings.exchangeRates;
    globalSettingsUpdate.exchangeRateAutoUpdate = settings.exchangeRateAutoUpdate;
    globalSettingsUpdate.exchangeRateLastFetch = settings.exchangeRateLastFetch;
  }

  // Save to registry DB
  const registryDb = await getRegistryDatabase();
  await registryDb.add('families', family);
  for (const mapping of mappings) {
    await registryDb.add('userFamilyMappings', mapping);
  }
  await saveGlobalSettings(globalSettingsUpdate);

  // Create the per-family DB and copy all data
  await setActiveFamily(familyId);

  // We need to dynamically open the new per-family DB
  const newDbName = getFamilyDatabaseName(familyId);
  const newDb = await openDB<FinanceDB>(newDbName, 3, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('familyMembers')) {
        const familyStore = db.createObjectStore('familyMembers', { keyPath: 'id' });
        familyStore.createIndex('by-email', 'email', { unique: true });
      }
      if (!db.objectStoreNames.contains('accounts')) {
        const accountsStore = db.createObjectStore('accounts', { keyPath: 'id' });
        accountsStore.createIndex('by-memberId', 'memberId', { unique: false });
        accountsStore.createIndex('by-type', 'type', { unique: false });
      }
      if (!db.objectStoreNames.contains('transactions')) {
        const transactionsStore = db.createObjectStore('transactions', { keyPath: 'id' });
        transactionsStore.createIndex('by-accountId', 'accountId', { unique: false });
        transactionsStore.createIndex('by-date', 'date', { unique: false });
        transactionsStore.createIndex('by-category', 'category', { unique: false });
      }
      if (!db.objectStoreNames.contains('assets')) {
        const assetsStore = db.createObjectStore('assets', { keyPath: 'id' });
        assetsStore.createIndex('by-memberId', 'memberId', { unique: false });
        assetsStore.createIndex('by-type', 'type', { unique: false });
      }
      if (!db.objectStoreNames.contains('goals')) {
        const goalsStore = db.createObjectStore('goals', { keyPath: 'id' });
        goalsStore.createIndex('by-memberId', 'memberId', { unique: false });
      }
      if (!db.objectStoreNames.contains('recurringItems')) {
        const recurringStore = db.createObjectStore('recurringItems', { keyPath: 'id' });
        recurringStore.createIndex('by-accountId', 'accountId', { unique: false });
        recurringStore.createIndex('by-type', 'type', { unique: false });
        recurringStore.createIndex('by-isActive', 'isActive', { unique: false });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('syncQueue')) {
        const syncStore = db.createObjectStore('syncQueue', { keyPath: 'id' });
        syncStore.createIndex('by-synced', 'synced', { unique: false });
        syncStore.createIndex('by-timestamp', 'timestamp', { unique: false });
      }
      if (!db.objectStoreNames.contains('translations')) {
        const translationsStore = db.createObjectStore('translations', { keyPath: 'id' });
        translationsStore.createIndex('by-language', 'language', { unique: false });
      }
    },
  });

  // Copy data in batches
  const dataTx = newDb.transaction(
    [
      'familyMembers',
      'accounts',
      'transactions',
      'assets',
      'goals',
      'recurringItems',
      'settings',
      'syncQueue',
      'translations',
    ],
    'readwrite'
  );

  const copyPromises: Promise<unknown>[] = [];

  for (const member of familyMembers) {
    copyPromises.push(dataTx.objectStore('familyMembers').add(member));
  }
  for (const account of accounts) {
    copyPromises.push(dataTx.objectStore('accounts').add(account));
  }
  for (const transaction of transactions) {
    copyPromises.push(dataTx.objectStore('transactions').add(transaction));
  }
  for (const asset of assets) {
    copyPromises.push(dataTx.objectStore('assets').add(asset));
  }
  for (const goal of goals) {
    copyPromises.push(dataTx.objectStore('goals').add(goal));
  }
  for (const recurringItem of recurringItems) {
    copyPromises.push(dataTx.objectStore('recurringItems').add(recurringItem));
  }
  if (settings) {
    copyPromises.push(dataTx.objectStore('settings').add(settings));
  }
  for (const item of syncQueue) {
    copyPromises.push(dataTx.objectStore('syncQueue').add(item));
  }
  for (const translation of translations) {
    copyPromises.push(dataTx.objectStore('translations').add(translation));
  }

  copyPromises.push(dataTx.done);
  await Promise.all(copyPromises);
  newDb.close();

  // Migrate the legacy sync file handle to this family
  await migrateLegacyFileHandle(familyId);

  // Mark legacy DB as migrated (add a marker to settings)
  const markerTx = legacyDb.transaction('settings', 'readwrite');
  await markerTx.objectStore('settings').put({
    id: MIGRATION_MARKER_KEY,
    migratedToFamilyId: familyId,
    migratedAt: now,
  } as unknown as Settings);
  await markerTx.done;

  legacyDb.close();

  return family;
}

/**
 * Check if the legacy DB has been migrated already.
 */
export async function isLegacyDbMigrated(): Promise<boolean> {
  try {
    const legacyDb = await getLegacyDatabase();
    const marker = await legacyDb.get('settings', MIGRATION_MARKER_KEY);
    legacyDb.close();
    return !!marker;
  } catch {
    return false;
  }
}
