import type { Counter } from '@automerge/automerge';
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
  RemovedMember,
  ResponsibilityCardState,
  ResponsibilityMove,
  ResponsibilityCheckIn,
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
  /**
   * Members removed from the family, keyed by the removed member's id (tracker #77).
   * Write-once, never deleted. See `RemovedMember` in models.ts.
   */
  removedMembers: Record<string, RemovedMember>;
  /**
   * Who Owns What (#109). Card state keyed by card id (built-in id or `custom-<uuid>`),
   * always written whole. Moves and check-ins are WRITE-ONCE history records. The only
   * write surface for all three is `responsibilityRepository.ts`.
   */
  responsibilityCards: Record<string, ResponsibilityCardState>;
  responsibilityMoves: Record<string, ResponsibilityMove>;
  responsibilityCheckIns: Record<string, ResponsibilityCheckIn>;
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
  /**
   * Concurrent-safe adjustments to the three ADJUSTED money fields (#117 Phase 2, ADR-039
   * addendum): account `balance`, goal `currentAmount`, asset `loan.outstandingBalance`. Keyed
   * `${collection}/${id}/${field}@${decimals}/${actorId}`; each value is a Counter in integer
   * MINOR units at the key's own `decimals` (the entity's currency minor unit when written,
   * clamped to [2, 8]). The stored absolute is the baseline and the Counters hold the
   * adjustments since; the fold in `worker/counterFields.ts` is the only reader, so main never
   * sees a Counter. A rebase also puts CARRY REGISTERS here (#117 writer flip):
   * `…@${decimals}/carry.${writer}.${targetSeq}`, a plain integer, never incremented (typed
   * `Counter` here for the increment keys every writer handles; readers go through
   * `counterValue`, which accepts both).
   *
   * ⚠️ ONE WRITER PER KEY, FOR LIFE. A later increment applies to EVERY conflicting Counter at
   * a key (`automergeSemantics.test.ts`, probe e'), so a key two actors both created can never
   * be summed correctly again. The actor (fresh per `load`) is the whole writer; no key has an
   * owner, and the rebase carries every live key. The map itself is created by the stored
   * migration change (`MIGRATED_ROOT_KEYS`), never by a device, so every device writes into the
   * SAME map object.
   *
   * Type-only `Counter` import: erased on main, which never holds a Counter.
   */
  counterDeltas: Record<string, Counter>;
  /**
   * The compaction fold ledger (#117 Phase 2): Counter key (scale included, a carry register
   * under its own full name) → `{ v: minorUnits, s: foldedAtSeq }`, or a bare number written by
   * a 0.91.2 compaction. BOUNDED BY GENERATION (#117 writer flip, plan §D): `foldDoc` writes
   * `s` for every key it folds, normalises bare numbers and prunes entries older than
   * `LEDGER_WINDOW` generations; a dirty peer further behind is blocked (`ledger-window`).
   * Written only by the compaction source, read only through `ledgerValue`/`ledgerSeq` by the
   * rebase (`targetKnowledge`) so a peer never re-emits an adjustment a compaction already
   * folded. Optional, like `podLineage` on legacy pods: absent until the first compaction that
   * folds a key, and never migrated in (its only writer builds the whole document with
   * `Automerge.from`).
   */
  foldedCounters?: Record<string, number | { v: number; s: number }>;
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
  'counterDeltas',
  'foldedCounters',
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
  removedMembers: 0,
  responsibilityCards: 0,
  responsibilityMoves: 0,
  responsibilityCheckIns: 0,
};
export const COLLECTION_NAMES = Object.keys(COLLECTION_NAME_SEED) as CollectionName[];

/**
 * The collections that hold a Counter-backed money field (#117 Phase 2): account `balance`, goal
 * `currentAmount`, asset `loan.outstandingBalance`. A PURE list, so a module that must stay
 * Automerge-free (`photoOps.ts`, imported by a main-thread store) can ask without importing
 * `counterFields.ts`, which imports Automerge as a value. `COUNTER_FIELDS` is typed against it in
 * both directions, so the two cannot drift.
 */
export const COUNTER_COLLECTION_NAMES = [
  'accounts',
  'goals',
  'assets',
] as const satisfies readonly CollectionName[];

/**
 * Every root key `migrateDoc` creates with a stored, deterministic change when it is ABSENT
 * (#117, ADR-039 §10): each collection map, plus the Phase 2 `counterDeltas` map. The
 * `MIGRATION_CHANGES` table is typed `Record<MigratedRootKey, string>`, so a key listed here
 * without a stored change is a compile error.
 *
 * ⚠️ `counterDeltas` IS HERE, `settings`/`podLineage`/`foldedCounters` ARE NOT. A map that two
 * devices write keys into must be ONE object on every device, or one device's keys vanish at
 * the merge; the singletons are written whole or only by `Automerge.from`, and seeding them
 * would emit a change into every legacy pod for nothing.
 */
export const MIGRATED_ROOT_KEYS = [...COLLECTION_NAMES, 'counterDeltas'] as const;

/** A root key with a stored migration change. See `MIGRATED_ROOT_KEYS`. */
export type MigratedRootKey = (typeof MIGRATED_ROOT_KEYS)[number];
