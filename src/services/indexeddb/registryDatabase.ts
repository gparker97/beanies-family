import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Family, UserFamilyMapping, CachedAuthSession, GlobalSettings } from '@/types/models';

const REGISTRY_DB_NAME = 'gp-finance-registry';
const REGISTRY_DB_VERSION = 1;

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
  cachedSessions: {
    key: string;
    value: CachedAuthSession;
    indexes: {
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
    upgrade(db) {
      if (!db.objectStoreNames.contains('families')) {
        db.createObjectStore('families', { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains('userFamilyMappings')) {
        const mappingStore = db.createObjectStore('userFamilyMappings', { keyPath: 'id' });
        mappingStore.createIndex('by-email', 'email', { unique: false });
        mappingStore.createIndex('by-familyId', 'familyId', { unique: false });
      }

      if (!db.objectStoreNames.contains('cachedSessions')) {
        const sessionStore = db.createObjectStore('cachedSessions', { keyPath: 'userId' });
        sessionStore.createIndex('by-familyId', 'familyId', { unique: false });
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
