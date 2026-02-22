import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Family, UserFamilyMapping, GlobalSettings } from '@/types/models';

const REGISTRY_DB_NAME = 'gp-finance-registry';
const REGISTRY_DB_VERSION = 2;

export interface RegistryDB extends DBSchema {
  families: {
    key: string;
    value: Family;
  };
  userFamilyMappings: {
    key: string;
    value: UserFamilyMapping;
    indexes: {
      'by-email': string;
      'by-familyId': string;
    };
  };
  globalSettings: {
    key: string;
    value: GlobalSettings;
  };
}

let registryInstance: IDBPDatabase<RegistryDB> | null = null;

export async function getRegistryDatabase(): Promise<IDBPDatabase<RegistryDB>> {
  if (registryInstance) {
    return registryInstance;
  }

  registryInstance = await openDB<RegistryDB>(REGISTRY_DB_NAME, REGISTRY_DB_VERSION, {
    upgrade(db, oldVersion) {
      if (!db.objectStoreNames.contains('families')) {
        db.createObjectStore('families', { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains('userFamilyMappings')) {
        const mappingStore = db.createObjectStore('userFamilyMappings', { keyPath: 'id' });
        mappingStore.createIndex('by-email', 'email', { unique: false });
        mappingStore.createIndex('by-familyId', 'familyId', { unique: false });
      }

      // v2: remove cachedSessions store (Cognito removed)
      // Cast to native IDBDatabase to access stores not in the typed schema
      const rawDb = db as unknown as IDBDatabase;
      if (oldVersion < 2 && rawDb.objectStoreNames.contains('cachedSessions')) {
        rawDb.deleteObjectStore('cachedSessions');
      }

      if (!db.objectStoreNames.contains('globalSettings')) {
        db.createObjectStore('globalSettings', { keyPath: 'id' });
      }
    },
  });

  return registryInstance;
}

export async function closeRegistryDatabase(): Promise<void> {
  if (registryInstance) {
    registryInstance.close();
    registryInstance = null;
  }
}

export function getRegistryDatabaseName(): string {
  return REGISTRY_DB_NAME;
}
