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
  PhotoAttachment,
  FavoriteItem,
  SayingItem,
  MemberNote,
  Allergy,
  Medication,
  MedicationLogEntry,
  Recipe,
  CookLogEntry,
  EmergencyContact,
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
  photos: Record<string, PhotoAttachment>;
  // The Pod (2026-04)
  favorites: Record<string, FavoriteItem>;
  sayings: Record<string, SayingItem>;
  memberNotes: Record<string, MemberNote>;
  allergies: Record<string, Allergy>;
  medications: Record<string, Medication>;
  medicationLogs: Record<string, MedicationLogEntry>;
  recipes: Record<string, Recipe>;
  cookLogs: Record<string, CookLogEntry>;
  emergencyContacts: Record<string, EmergencyContact>;
  settings: Settings | null;
}

/** Collection names (excludes singleton 'settings') */
export type CollectionName = Exclude<keyof FamilyDocument, 'settings'>;

/** Utility type: resolve a collection name to its entity type */
export type CollectionEntity<K extends CollectionName> =
  FamilyDocument[K] extends Record<string, infer E> ? E : never;
