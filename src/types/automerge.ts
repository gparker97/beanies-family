import type {
  FamilyMember,
  Account,
  Transaction,
  Asset,
  Goal,
  Budget,
  RecurringItem,
  TodoItem,
  FamilyActivity,
  FamilyVacation,
  Settings,
} from './models';

/**
 * Automerge CRDT document schema.
 * Uses Record<string, Entity> (keyed by UUID) instead of arrays —
 * map operations merge cleanly in Automerge, arrays can conflict.
 */
export interface FamilyDocument {
  familyMembers: Record<string, FamilyMember>;
  accounts: Record<string, Account>;
  transactions: Record<string, Transaction>;
  assets: Record<string, Asset>;
  goals: Record<string, Goal>;
  budgets: Record<string, Budget>;
  recurringItems: Record<string, RecurringItem>;
  todos: Record<string, TodoItem>;
  activities: Record<string, FamilyActivity>;
  vacations: Record<string, FamilyVacation>;
  settings: Settings | null;
}

/** Collection names (excludes singleton 'settings') */
export type CollectionName = Exclude<keyof FamilyDocument, 'settings'>;

/** Utility type: resolve a collection name to its entity type */
export type CollectionEntity<K extends CollectionName> =
  FamilyDocument[K] extends Record<string, infer E> ? E : never;
