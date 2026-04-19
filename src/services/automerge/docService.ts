import * as Automerge from '@automerge/automerge';
import { shallowRef } from 'vue';
import type { FamilyDocument } from '@/types/automerge';

/**
 * Automerge document service — module-level singleton.
 * Mirrors the database.ts pattern: one active document at a time.
 *
 * Bridges Automerge → Vue reactivity via a `docVersion` shallowRef
 * that increments on every change, triggering computed/watch consumers.
 */

let currentDoc: Automerge.Doc<FamilyDocument> | null = null;

/** Reactive change counter — Vue components watch this to re-render */
export const docVersion = shallowRef(0);

/** Persist callback & debounce timer */
let persistCallback: (() => void) | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
const PERSIST_DEBOUNCE_MS = 500;

function schedulePersist(): void {
  if (!persistCallback) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistCallback?.();
  }, PERSIST_DEBOUNCE_MS);
}

function bumpVersion(): void {
  docVersion.value += 1;
}

/**
 * Create a new empty document with all collections initialized.
 */
export function initDoc(): Automerge.Doc<FamilyDocument> {
  // Automerge.from() requires Record<string, unknown> — cast the initial state
  const initial: FamilyDocument = {
    familyMembers: {},
    accounts: {},
    transactions: {},
    assets: {},
    goals: {},
    budgets: {},
    recurringItems: {},
    todos: {},
    activities: {},
    vacations: {},
    photos: {},
    favorites: {},
    sayings: {},
    memberNotes: {},
    allergies: {},
    medications: {},
    recipes: {},
    cookLogs: {},
    emergencyContacts: {},
    settings: null,
  };
  currentDoc = Automerge.from(
    initial as unknown as Record<string, unknown>
  ) as Automerge.Doc<FamilyDocument>;
  bumpVersion();
  return currentDoc;
}

/**
 * All collection names that should exist on a FamilyDocument.
 * Used to migrate older documents that predate newer collections (e.g. vacations).
 */
const ALL_COLLECTIONS: Array<Exclude<keyof FamilyDocument, 'settings'>> = [
  'familyMembers',
  'accounts',
  'transactions',
  'assets',
  'goals',
  'budgets',
  'recurringItems',
  'todos',
  'activities',
  'vacations',
  'photos',
  'favorites',
  'sayings',
  'memberNotes',
  'allergies',
  'medications',
  'recipes',
  'cookLogs',
  'emergencyContacts',
];

/**
 * Migrate a loaded document: initialize any collections missing from older beanpod files.
 * Uses Automerge.change() so mutations go through the proxy and persist correctly.
 */
function migrateDoc(doc: Automerge.Doc<FamilyDocument>): Automerge.Doc<FamilyDocument> {
  const missing = ALL_COLLECTIONS.filter((name) => doc[name] === undefined || doc[name] === null);
  if (missing.length === 0) return doc;

  return Automerge.change(doc, 'migrate: add missing collections', (d) => {
    for (const name of missing) {
      (d as unknown as Record<string, unknown>)[name] = {};
    }
  });
}

/**
 * Load a document from a binary (Uint8Array).
 * Migrates older documents by initializing any missing collections.
 */
export function loadDoc(binary: Uint8Array): Automerge.Doc<FamilyDocument> {
  currentDoc = migrateDoc(Automerge.load<FamilyDocument>(binary));
  bumpVersion();
  return currentDoc;
}

/**
 * Serialize the current document to a binary (Uint8Array).
 */
export function saveDoc(): Uint8Array {
  if (!currentDoc)
    throw new Error('No Automerge document loaded. Call initDoc() or loadDoc() first.');
  return Automerge.save(currentDoc);
}

/**
 * Get the current document. Throws if none is loaded.
 */
export function getDoc(): Automerge.Doc<FamilyDocument> {
  if (!currentDoc)
    throw new Error('No Automerge document loaded. Call initDoc() or loadDoc() first.');
  return currentDoc;
}

/**
 * Apply a mutation to the document.
 * Bumps docVersion and schedules a debounced persist.
 */
export function changeDoc(
  fn: (doc: FamilyDocument) => void,
  message?: string
): Automerge.Doc<FamilyDocument> {
  if (!currentDoc)
    throw new Error('No Automerge document loaded. Call initDoc() or loadDoc() first.');
  currentDoc = Automerge.change(currentDoc, message ?? '', fn);
  bumpVersion();
  schedulePersist();
  return currentDoc;
}

/**
 * Merge a remote document into the current one (CRDT merge).
 */
export function mergeDoc(remote: Automerge.Doc<FamilyDocument>): Automerge.Doc<FamilyDocument> {
  if (!currentDoc)
    throw new Error('No Automerge document loaded. Call initDoc() or loadDoc() first.');
  currentDoc = migrateDoc(Automerge.merge(Automerge.clone(currentDoc), remote));
  bumpVersion();
  schedulePersist();
  return currentDoc;
}

/**
 * Replace the current document entirely (e.g. after loading from file).
 * Migrates older documents by initializing any missing collections.
 */
export function replaceDoc(doc: Automerge.Doc<FamilyDocument>): void {
  currentDoc = migrateDoc(doc);
  bumpVersion();
}

/**
 * Reset the document to null (e.g. on sign-out).
 */
export function resetDoc(): void {
  currentDoc = null;
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  bumpVersion();
}

/**
 * Register a callback to be invoked (debounced) when the document needs persisting.
 * The sync layer calls this once at startup.
 */
export function onDocPersistNeeded(callback: () => void): void {
  persistCallback = callback;
}

/**
 * Immediately fire the pending persist callback (for tests).
 */
export function flushPersist(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  persistCallback?.();
}
