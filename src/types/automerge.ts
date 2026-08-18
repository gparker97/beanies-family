import type {
  FamilyMember,
  Account,
  Transaction,
  Asset,
  Goal,
  Budget,
  RecurringItem,
  TodoItem,
  FamilyList,
  FamilyActivity,
  FamilyVacation,
  PhotoAttachment,
  FavoriteItem,
  SayingItem,
  MemberNote,
  Allergy,
  Medication,
  MedicationLogEntry,
  Milestone,
  Recipe,
  CookLogEntry,
  MealPlanEntry,
  EmergencyContact,
  CalendarConnection,
  CalendarEventLink,
  DriveConnection,
  OverlapAck,
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
  lists: Record<string, FamilyList>;
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
  milestones: Record<string, Milestone>;
  recipes: Record<string, Recipe>;
  cookLogs: Record<string, CookLogEntry>;
  mealPlans: Record<string, MealPlanEntry>;
  emergencyContacts: Record<string, EmergencyContact>;
  /**
   * Per-member in-app notification read-state: memberId → (notificationId →
   * ISO readAt). The ONLY persisted notification state — notifications
   * themselves are derived (see types/notifications.ts). Nested maps merge
   * cleanly in Automerge, so reading on one device clears the badge on another.
   */
  notificationReads: Record<string, Record<string, string>>;
  // Google Calendar integration (#32) — family-wide connections + activity↔event links
  calendarConnections: Record<string, CalendarConnection>;
  calendarEventLinks: Record<string, CalendarEventLink>;
  /**
   * Google Drive refresh-token recovery copies, keyed per Google account by
   * `driveConnectionId(email)`. Per-account (NOT family-wide); the local store
   * is primary, this is additive recovery. See DriveConnection in models.ts.
   */
  driveConnections: Record<string, DriveConnection>;
  /**
   * Acknowledged external-calendar overlaps (#34): `overlapAckKey(...)` → ack.
   * Family-shared "this overlap is fine" memory; merges cleanly (one whole-object
   * entry per unique key). See OverlapAck in models.ts.
   */
  overlapAcknowledgments: Record<string, OverlapAck>;
  settings: Settings | null;
}

/** Collection names (excludes singleton 'settings') */
export type CollectionName = Exclude<keyof FamilyDocument, 'settings'>;

/** Utility type: resolve a collection name to its entity type */
export type CollectionEntity<K extends CollectionName> =
  FamilyDocument[K] extends Record<string, infer E> ? E : never;

/**
 * Runtime list of every collection name (excludes the `settings` singleton).
 * The `Record<CollectionName, 0>` seed makes this **compile-time complete**: add
 * a collection to `FamilyDocument` and forget it here → a type error. Single
 * source of truth for `docService` migration + the ADR-032 projection mirror.
 */
const COLLECTION_NAME_SEED: Record<CollectionName, 0> = {
  familyMembers: 0,
  accounts: 0,
  transactions: 0,
  assets: 0,
  goals: 0,
  budgets: 0,
  recurringItems: 0,
  todos: 0,
  lists: 0,
  activities: 0,
  vacations: 0,
  photos: 0,
  favorites: 0,
  sayings: 0,
  memberNotes: 0,
  allergies: 0,
  medications: 0,
  medicationLogs: 0,
  milestones: 0,
  recipes: 0,
  cookLogs: 0,
  mealPlans: 0,
  emergencyContacts: 0,
  notificationReads: 0,
  calendarConnections: 0,
  calendarEventLinks: 0,
  driveConnections: 0,
  overlapAcknowledgments: 0,
};
export const COLLECTION_NAMES = Object.keys(COLLECTION_NAME_SEED) as CollectionName[];
