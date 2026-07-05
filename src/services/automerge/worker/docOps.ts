/**
 * ADR-032 — the pure, worker-side Automerge operations. Shared by the worker
 * message loop AND the inline fallback (one implementation, two contexts), so
 * the two paths can't diverge.
 *
 * This module is deliberately PURE + vue-free + main-thread-free: it takes a doc
 * in and returns a new doc + the projection delta describing what changed. State
 * (currentDoc / familyKey / cache), the persist debounce, and the `dirty` signal
 * live in `applyAndProject` / `docWorker`. The mutation ops are the declarative
 * replacement for the `changeDoc(fn)` closures that can't cross `postMessage`.
 */
import * as Automerge from '@automerge/automerge';
import { COLLECTION_NAMES, type FamilyDocument, type CollectionName } from '@/types/automerge';
import type { MutationOp, ProjectionDelta, Heads } from './protocol';

type Doc = Automerge.Doc<FamilyDocument>;
type AnyRecord = Record<string, unknown>;

/** JSON round-trip an Automerge value to a plain, structured-clone-safe object. */
function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ─── Doc lifecycle ───────────────────────────────────────────────────────────

/** Initialize any collections missing from an older document. */
export function migrateDoc(doc: Doc): Doc {
  const missing = COLLECTION_NAMES.filter((name) => doc[name] === undefined || doc[name] === null);
  if (missing.length === 0) return doc;
  return Automerge.change(doc, 'migrate: add missing collections', (d) => {
    for (const name of missing) (d as unknown as AnyRecord)[name] = {};
  });
}

export function loadDoc(binary: Uint8Array): Doc {
  return migrateDoc(Automerge.load<FamilyDocument>(binary));
}

export function saveDoc(doc: Doc): Uint8Array {
  return Automerge.save(doc);
}

export function getHeads(doc: Doc): Heads {
  return Automerge.getHeads(doc);
}

export function getChangesSince(doc: Doc, heads: Heads): Uint8Array[] {
  return Automerge.getChanges(Automerge.view(doc, heads), doc);
}

export function applyChanges(doc: Doc, changes: Uint8Array[]): { doc: Doc; heads: Heads } {
  const [next] = Automerge.applyChanges(Automerge.clone(doc), changes);
  const migrated = migrateDoc(next);
  return { doc: migrated, heads: getHeads(migrated) };
}

/**
 * CRDT-merge `remote` into `local`. `dirty` = did the merged doc advance beyond
 * remote (i.e. local carried unsynced changes remote lacks) → must be re-uploaded.
 * Computed on the MERGED doc vs remote (a pre-merge heads compare would falsely
 * flag a clean local and re-introduce the save ping-pong). See ADR-032.
 */
export function mergeDocs(local: Doc, remote: Doc): { doc: Doc; dirty: boolean; heads: Heads } {
  const merged = migrateDoc(Automerge.merge(Automerge.clone(local), remote));
  const dirty = Automerge.getChanges(remote, merged).length > 0;
  return { doc: merged, dirty, heads: getHeads(merged) };
}

// ─── Materialization → projection ────────────────────────────────────────────

/** Plain `[id, entity]` pairs for a collection (structured-clone-safe). */
export function materializeCollection(
  doc: Doc,
  collection: CollectionName
): Array<[string, unknown]> {
  const coll = (doc[collection] ?? {}) as AnyRecord;
  return Object.entries(coll).map(([id, entity]) => [id, toPlain(entity)]);
}

/**
 * The full projection as one delta per collection (+ settings), each a `bulk`
 * reset. `docWorker` streams these across messages (chunking large collections)
 * so the main-thread receive never becomes a long task.
 */
export function buildFullProjection(doc: Doc): ProjectionDelta[] {
  const deltas: ProjectionDelta[] = COLLECTION_NAMES.map((collection) => ({
    kind: 'bulk',
    collection,
    reset: true,
    entities: materializeCollection(doc, collection),
  }));
  deltas.push({ kind: 'settings', settings: toPlain(doc.settings ?? null) });
  return deltas;
}

// ─── Named-op registry (nested-structure handlers, e.g. photo attach) ────────

/** A named handler mutates the draft doc and returns its projection delta(s). */
export type NamedOpHandler = (
  draft: FamilyDocument,
  args: Record<string, unknown>
) => { result?: unknown; deltas: ProjectionDelta[] };

const namedRegistry = new Map<string, NamedOpHandler>();

/** Register a nested-structure op (photo attach/collect etc.). Static, at load. */
export function registerNamedOp(name: string, handler: NamedOpHandler): void {
  namedRegistry.set(name, handler);
}

// ─── Mutations ───────────────────────────────────────────────────────────────

/** Mutate the draft for one op (recurses for `batch`). Pure structural mutation
 * — the projection deltas are built afterwards from the COMMITTED doc (reading a
 * mid-change proxy is fragile). Returns named-op deltas inline (they own theirs). */
function mutateDraft(draft: FamilyDocument, op: MutationOp, named: ProjectionDelta[]): void {
  switch (op.op) {
    case 'set':
      (draft[op.collection] as AnyRecord)[op.id] = op.entity;
      break;
    case 'patch': {
      const entity = (draft[op.collection] as Record<string, AnyRecord>)[op.id];
      if (!entity) throw new Error(`patch: ${op.collection}/${op.id} not found`);
      for (const [k, v] of Object.entries(op.patch)) entity[k] = v;
      for (const k of op.deleteKeys ?? []) delete entity[k];
      if (op.updatedAt) entity.updatedAt = op.updatedAt;
      break;
    }
    case 'delete':
      delete (draft[op.collection] as AnyRecord)[op.id];
      break;
    case 'increment': {
      // Read-modify-write ATOMIC inside the change — no interleave with a merge.
      const entity = (draft[op.collection] as Record<string, AnyRecord>)[op.id];
      if (!entity) throw new Error(`increment: ${op.collection}/${op.id} not found`);
      const cur = typeof entity[op.field] === 'number' ? (entity[op.field] as number) : 0;
      entity[op.field] = cur + op.delta;
      break;
    }
    case 'batch':
      for (const sub of op.ops) mutateDraft(draft, sub, named);
      break;
    case 'named': {
      const handler = namedRegistry.get(op.name);
      if (!handler) throw new Error(`named op not registered: ${op.name}`);
      named.push(...handler(draft, op.args).deltas);
      break;
    }
  }
}

/** Build the projection delta for one op by reading the COMMITTED post-change doc. */
function deltaFor(after: Doc, op: MutationOp, out: ProjectionDelta[]): unknown {
  switch (op.op) {
    case 'set':
      out.push({ kind: 'upsert', collection: op.collection, id: op.id, entity: op.entity });
      return op.entity;
    case 'patch':
    case 'increment': {
      const entity = toPlain((after[op.collection] as Record<string, unknown>)[op.id]);
      out.push({ kind: 'upsert', collection: op.collection, id: op.id, entity });
      return entity;
    }
    case 'delete':
      out.push({ kind: 'remove', collection: op.collection, id: op.id });
      return true;
    case 'batch': {
      for (const sub of op.ops) deltaFor(after, sub, out);
      return undefined;
    }
    case 'named':
      return undefined; // named handler already contributed its deltas
  }
}

/**
 * Apply a declarative mutation. Returns the new doc, the affected entity
 * (`result`, for read-after-write), and the projection delta. A `batch` (and a
 * single op) is exactly ONE `Automerge.change` → atomic: a mid-batch throw
 * commits nothing.
 */
export function applyMutation(
  doc: Doc,
  op: MutationOp
): { doc: Doc; result: unknown; delta: ProjectionDelta } {
  const namedDeltas: ProjectionDelta[] = [];
  const after = Automerge.change(doc, (d) => mutateDraft(d as FamilyDocument, op, namedDeltas));
  const out: ProjectionDelta[] = [];
  const result = deltaFor(after, op, out);
  const all = [...out, ...namedDeltas];
  const delta: ProjectionDelta = all.length === 1 ? all[0]! : { kind: 'multi', deltas: all };
  return { doc: after, result, delta };
}

/** Test-only: clear the named-op registry between cases. */
export function __resetNamedOpsForTesting(): void {
  namedRegistry.clear();
}
