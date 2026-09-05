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
  ListCycle,
  Settings,
  PodLineage,
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
  /**
   * Finished cycles of recurring lists, keyed `${listId}:${endedOn}`. Write-once history:
   * never patched, deleted wholesale by the retention sweep. Deliberately NOT `lists` —
   * a cycle is not a list, so nothing that reads `lists` (the wall, notifications, badges,
   * linked-list embeds) can ever see one.
   */
  listCycles: Record<string, ListCycle>;
  settings: Settings | null;
  /**
   * Which HISTORY this document descends from — see `PodLineage` and ADR-036.
   *
   * `| null` rather than optional, matching `settings`, for a hard reason:
   * **Automerge refuses to store `undefined`** (`RangeError: Cannot assign
   * undefined value at /podLineage`). And like `settings`, it is ABSENT rather
   * than null on every pod created before this shipped, because `migrateDoc`
   * seeds only `COLLECTION_NAMES`. Read it through `docLineage()`, never
   * directly, so absent-or-null is normalised in ONE place.
   */
  podLineage: PodLineage | null;
}

/**
 * The top-level keys that are NOT entity maps — the singletons.
 *
 * ⚠️ ONE DECLARATION, because this fact was re-encoded by hand in four places
 * and every copy is a chance to disagree. The `satisfies` is not decoration:
 * without it a typo (`'podLineag'`) would be a silent no-op that quietly turns a
 * singleton into a "collection" and seeds it into every pod.
 *
 * Adding a top-level non-collection field WITHOUT listing it here is a COMPILE
 * ERROR, because `COLLECTION_NAME_SEED` below is `Record<CollectionName, 0>`.
 */
export const NON_COLLECTION_KEYS = [
  'settings',
  'podLineage',
] as const satisfies readonly (keyof FamilyDocument)[];

/** Collection names (excludes the singletons — see `NON_COLLECTION_KEYS`) */
export type CollectionName = Exclude<keyof FamilyDocument, (typeof NON_COLLECTION_KEYS)[number]>;

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
  listCycles: 0,
};
export const COLLECTION_NAMES = Object.keys(COLLECTION_NAME_SEED) as CollectionName[];
