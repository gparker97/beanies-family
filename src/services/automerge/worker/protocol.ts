/**
 * ADR-032 — the typed wire contract between the main thread (`docClient`) and
 * the Automerge Web Worker (`docWorker`). This file owns ONLY the message
 * envelope + error/delta shapes; it imports domain payload types rather than
 * re-declaring them so the wire can never drift from the entity model.
 *
 * Design:
 *   - Every request carries a correlation id (`cid`); every response echoes it.
 *   - Responses are generic (`result` + optional `delta`); the typed method
 *     wrappers live in `docClient`, keeping this contract small.
 *   - Unsolicited worker→main messages (ready / perf / log) carry NO `cid` and
 *     are distinguished by `signal`.
 *   - Typed errors survive `postMessage` via a name→{serialize,reconstruct}
 *     registry (structured-clone drops the class); unknown names fall back to a
 *     generic `DocWorkerError`.
 */
import type { CollectionName } from '@/types/automerge';
import { CorruptPayloadError } from '@/types/sync';

/** Automerge heads — the change-frontier hashes. Opaque to the main thread. */
export type Heads = string[];

// ─── Projection deltas (worker → main, applied before an RPC resolves) ───────

/**
 * A change to apply to the main-thread projection mirror. Kept entity-level for
 * edits (O(1) surgical apply — no whole-collection re-clone) and `bulk` only for
 * first-load / merge, where the worker streams a collection in slices.
 */
export type ProjectionDelta =
  | { kind: 'upsert'; collection: CollectionName; id: string; entity: unknown }
  | { kind: 'remove'; collection: CollectionName; id: string }
  | { kind: 'settings'; settings: unknown }
  /** A slice of one collection. `reset` on the FIRST slice clears it first. */
  | { kind: 'bulk'; collection: CollectionName; reset: boolean; entities: Array<[string, unknown]> }
  /** Several deltas applied together (one batch op, or a multi-collection merge). */
  | { kind: 'multi'; deltas: ProjectionDelta[] };

// ─── Mutation ops (main → worker; the `changeDoc` closures, made declarative) ─

export type MutationOp =
  | { op: 'set'; collection: CollectionName; id: string; entity: unknown }
  | {
      op: 'patch';
      collection: CollectionName;
      id: string;
      patch: Record<string, unknown>;
      deleteKeys?: string[];
      updatedAt?: string;
    }
  | { op: 'delete'; collection: CollectionName; id: string }
  /** Relative read-modify-write done atomically INSIDE one worker `changeDoc`. */
  | { op: 'increment'; collection: CollectionName; id: string; field: string; delta: number }
  | { op: 'batch'; ops: MutationOp[] }
  /** Named handlers whose domain logic lives in the worker (e.g. photo attach). */
  | { op: 'named'; name: string; args: Record<string, unknown> };

// ─── Envelope ────────────────────────────────────────────────────────────────

/** A request from main → worker. `method` names the handler; `args` is its input. */
export interface RpcRequest {
  cid: number;
  method: string;
  args?: unknown;
}

/** A successful response. `delta` (when present) is applied to the projection
 * BEFORE the caller's promise resolves, so read-after-write is race-free. */
export interface RpcOk {
  cid: number;
  ok: true;
  result?: unknown;
  delta?: ProjectionDelta;
}

export interface RpcErr {
  cid: number;
  ok: false;
  error: SerializedError;
}

export type RpcResponse = RpcOk | RpcErr;

/** Unsolicited worker → main messages (no correlation id). */
export type WorkerSignal =
  | { signal: 'ready' }
  | { signal: 'perf'; label: string; durationMs: number; ctx?: Record<string, number> }
  | { signal: 'log'; level: 'debug' | 'info' | 'warn' | 'error'; message: string }
  /**
   * A streamed projection chunk for a first-load / remote-merge. The worker
   * posts these across successive messages (one per collection slice) BEFORE the
   * triggering RPC's response, so each is applied on the main thread as its own
   * task (no single long task) and all land before the promise resolves (the
   * load/merge barrier). `final` marks the last chunk — `docClient` bumps
   * `docVersion` once then, not per-chunk. See ADR-032.
   */
  | { signal: 'projection'; delta: ProjectionDelta; final: boolean }
  /**
   * The worker's debounced cache persist failed (or recovered). Main maps this
   * to the persistent "local durability broken" banner — the worker owns the
   * cache post-migration, so this replaces the old main-thread
   * `setCachePersistFailed` coupling. See ADR-032 (Persist/Drive split).
   */
  | { signal: 'cache-persist-failed'; failed: boolean };

/** Type guards for routing an inbound worker message. */
export function isRpcResponse(m: unknown): m is RpcResponse {
  return typeof m === 'object' && m !== null && typeof (m as RpcResponse).cid === 'number';
}
export function isWorkerSignal(m: unknown): m is WorkerSignal {
  return typeof m === 'object' && m !== null && typeof (m as WorkerSignal).signal === 'string';
}

// ─── Typed error transport ───────────────────────────────────────────────────

/** A wire-safe error: plain fields only, plus a discriminant for reconstruction. */
export interface SerializedError {
  name: string;
  message: string;
  /** Extra allowlisted fields for typed errors (e.g. CorruptPayloadError.step). */
  data?: Record<string, unknown>;
}

/** Generic error for any worker failure that isn't a registered typed error. */
export class DocWorkerError extends Error {
  readonly op?: string;
  constructor(message: string, op?: string) {
    super(message);
    this.name = 'DocWorkerError';
    this.op = op;
  }
}

interface ErrorCodec {
  serialize: (err: unknown) => Record<string, unknown> | undefined;
  reconstruct: (message: string, data: Record<string, unknown> | undefined) => Error;
}

/**
 * name → codec. Register a typed error once; new typed errors are a one-line
 * add, not new plumbing. Reconstruction preserves the class so downstream
 * `instanceof` checks (e.g. the CorruptPayloadError recovery dispatch) keep
 * working across the boundary.
 */
const ERROR_REGISTRY: Record<string, ErrorCodec> = {
  CorruptPayloadError: {
    serialize: (err) =>
      err instanceof CorruptPayloadError ? { step: err.step, familyId: err.familyId } : undefined,
    reconstruct: (message, data) =>
      new CorruptPayloadError(
        message,
        (data?.step as 'load' | 'materialize') ?? 'load',
        (data?.familyId as string | null) ?? null
      ),
  },
};

/** Convert any thrown value into a wire-safe `SerializedError`. Never throws. */
export function serializeError(err: unknown): SerializedError {
  const name = err instanceof Error && err.name ? err.name : 'Error';
  const message = err instanceof Error ? err.message : String(err);
  const codec = ERROR_REGISTRY[name];
  return { name, message, data: codec?.serialize(err) };
}

/**
 * Rebuild an Error from the wire. Registered typed errors reconstruct to their
 * real class (so `instanceof` works); everything else becomes a `DocWorkerError`
 * carrying the original name in its message.
 */
export function reconstructError(se: SerializedError, op?: string): Error {
  const codec = ERROR_REGISTRY[se.name];
  if (codec) return codec.reconstruct(se.message, se.data);
  const e = new DocWorkerError(se.name === 'Error' ? se.message : `${se.name}: ${se.message}`, op);
  return e;
}

/** Test-only: register an extra codec (kept out of the frozen default set). */
export function __registerErrorCodecForTesting(name: string, codec: ErrorCodec): void {
  ERROR_REGISTRY[name] = codec;
}
