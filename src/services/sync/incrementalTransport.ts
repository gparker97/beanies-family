/**
 * ADR-032 Plan B / Layer 2 — incremental Drive delta transport (main-thread glue).
 *
 * The worker owns the crypto + the doc; this module owns the Drive-side change-log
 * protocol: which chunks to fetch, when to fall back to a whole-doc adopt, and
 * what to publish. It is deliberately dependency-injected (an `AuxStore` + a small
 * worker-facing `TransportDeps`) so it unit-tests without the real provider or the
 * worker singleton, and so `syncService` stays a thin caller.
 *
 * Design invariants (see docs/plans/2026-07-07-worker-incremental-delta-sync.md):
 *  - The change-log is APPEND-ONLY, IMMUTABLE, self-describing chunks
 *    (`changes/<actorId>-<seq>.beanchanges`). The folder listing IS the index —
 *    there is NO shared mutable manifest (that would be a lost-update race on a
 *    transaction-less store).
 *  - The reader cursor (`fetched`) and the publish cursor (`lastPublishedHeads`)
 *    are IN-MEMORY and derived — never stored. On reload they rebuild by
 *    re-fetching (the worker applies idempotently) / publishing from the base.
 *  - Any failure a delta path can't handle safely → `{ outcome: 'fallback' }`, and
 *    the caller runs the UNCHANGED whole-doc `mergeRemoteEnvelope(base)` path.
 */
import type { AuxStore } from './storageProvider';

const CHANGES_PREFIX = 'changes/';
const CHANGES_SUFFIX = '.beanchanges';
const SEQ_PAD = 8;

/** How many of THIS device's own chunks to keep before pruning older ones. The
 * base always carries our full history, so a peer that falls further behind than
 * this reads the whole-doc base (a correct, slower fallback) instead — kept small
 * so the Drive folder stays tidy (peers poll frequently, rarely falling behind). */
const OWN_CHUNK_KEEP = 12;

/** `changes/<actorId>-<zero-padded seq>.beanchanges`. Names are unique + monotonic
 * per device and never reused, so a pruned name is permanently gone (no ABA). */
export const chunkName = (actorId: string, seq: number): string =>
  `${CHANGES_PREFIX}${actorId}-${String(seq).padStart(SEQ_PAD, '0')}${CHANGES_SUFFIX}`;

export const isChunkName = (name: string): boolean =>
  name.startsWith(CHANGES_PREFIX) && name.endsWith(CHANGES_SUFFIX);

/** Parse `{ actorId, seq }` from a chunk name (for own-chunk pruning). null if it
 * doesn't match the shape. */
export function parseChunkName(name: string): { actorId: string; seq: number } | null {
  if (!isChunkName(name)) return null;
  const stem = name.slice(CHANGES_PREFIX.length, -CHANGES_SUFFIX.length);
  const dash = stem.lastIndexOf('-');
  if (dash < 0) return null;
  const actorId = stem.slice(0, dash);
  const seq = Number(stem.slice(dash + 1));
  if (!actorId || !Number.isInteger(seq)) return null;
  return { actorId, seq };
}

/** The worker-facing surface the transport needs (a subset of `docClient`). */
export interface TransportDeps {
  applyRemoteChunks(
    payloads: string[]
  ): Promise<{ heads: string[]; landed: boolean; dirty: boolean }>;
  exportIncrementalPayload(sinceHeads: string[]): Promise<{ payload: string }>;
  getHeads(): Promise<{ heads: string[] }>;
  getActorId(): Promise<{ actorId: string }>;
}

/** In-memory per-family transport state (rebuilt on reload — never persisted). */
export interface TransportSession {
  /** Chunk names already fetched+applied this session (reader cursor). */
  fetched: Set<string>;
  /** Heads last published to Drive (publish cursor); null → publish base-only next. */
  lastPublishedHeads: string[] | null;
  /** Next chunk seq for this device's own writes. */
  publishSeq: number;
  /** This device's cached Automerge actor id (chunk-name prefix). */
  actorId: string | null;
}

export function newTransportSession(): TransportSession {
  return { fetched: new Set(), lastPublishedHeads: null, publishSeq: 0, actorId: null };
}

export type PullResult =
  | { outcome: 'applied'; dirty: boolean }
  | { outcome: 'noop' }
  | { outcome: 'fallback'; reason: string };

const headsEqual = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((h, i) => h === b[i]);

/**
 * Pull + apply any change-log chunks this session hasn't seen. Returns:
 *  - `noop` — nothing new to apply.
 *  - `applied` (+`dirty`) — new chunks landed; `dirty` = local carried changes the
 *    remote frontier lacks → the caller should trigger a (re-)publish.
 *  - `fallback` (+`reason`) — a chunk is missing/undecryptable, or a chunk's causal
 *    deps are absent (silently buffered). The caller MUST run the whole-doc base
 *    adopt, which carries every dep and reconciles. NEVER throws into the caller.
 */
export async function pullIncremental(
  aux: AuxStore,
  deps: TransportDeps,
  session: TransportSession
): Promise<PullResult> {
  let names: string[];
  try {
    names = (await aux.list()).filter(isChunkName);
  } catch {
    return { outcome: 'fallback', reason: 'list-failed' };
  }
  const fresh = names.filter((n) => !session.fetched.has(n));
  if (fresh.length === 0) return { outcome: 'noop' };

  const payloads: string[] = [];
  for (const name of fresh) {
    let body: string | null;
    try {
      body = await aux.read(name);
    } catch {
      // A read error (e.g. a chunk pruned mid-poll) → whole-doc reconcile.
      return { outcome: 'fallback', reason: 'read-failed' };
    }
    if (body == null) return { outcome: 'fallback', reason: 'chunk-missing' };
    payloads.push(body);
  }

  let res: { landed: boolean; dirty: boolean };
  try {
    res = await deps.applyRemoteChunks(payloads);
  } catch {
    return { outcome: 'fallback', reason: 'apply-error' };
  }
  // A non-landed batch left changes buffered on a missing dep → whole-doc adopt
  // carries the deps. Do NOT mark these fetched (re-tried after the base merge).
  if (!res.landed) return { outcome: 'fallback', reason: 'missing-deps' };

  for (const name of fresh) session.fetched.add(name);
  return { outcome: 'applied', dirty: res.dirty };
}

/**
 * Publish the local state. The caller has ALREADY written the whole-doc base
 * (dual-publish for mixed-fleet compatibility); this appends the delta chunk since
 * the last publish and prunes this device's superseded chunks. Best-effort: a chunk
 * write/prune failure is swallowed with a breadcrumb (the base write already
 * succeeded, so no data is at risk — peers just fall back to the whole-doc base).
 */
export async function publishIncremental(
  aux: AuxStore,
  deps: TransportDeps,
  session: TransportSession
): Promise<void> {
  try {
    if (!session.actorId) session.actorId = (await deps.getActorId()).actorId;
    const { heads } = await deps.getHeads();

    if (session.lastPublishedHeads === null) {
      // First publish this session: the base carries everything → set the cursor,
      // emit no chunk (a peer that missed the last session reads the fresh base).
      session.lastPublishedHeads = heads;
    } else if (!headsEqual(heads, session.lastPublishedHeads)) {
      const { payload } = await deps.exportIncrementalPayload(session.lastPublishedHeads);
      const name = chunkName(session.actorId, session.publishSeq++);
      await aux.write(name, payload);
      session.fetched.add(name); // our own chunk — never re-fetch/apply it
      session.lastPublishedHeads = heads;
    }

    await pruneOwnChunks(aux, session);
  } catch (e) {
    console.warn(
      '[incrementalTransport] publish chunk failed (non-fatal; base is authoritative):',
      e
    );
  }
}

/** Prune THIS device's own chunks older than the keep-window. Safe: the base we
 * just wrote is a superset of our own history, so an old own-chunk is redundant;
 * a peer reading it mid-delete falls back to the base. We never prune another
 * device's chunks (each device prunes its own). */
async function pruneOwnChunks(aux: AuxStore, session: TransportSession): Promise<void> {
  if (!session.actorId) return;
  const cutoff = session.publishSeq - OWN_CHUNK_KEEP;
  if (cutoff <= 0) return;
  let names: string[];
  try {
    names = await aux.list();
  } catch {
    return; // pruning is opportunistic — a failed list just defers it
  }
  for (const name of names) {
    const parsed = parseChunkName(name);
    if (parsed && parsed.actorId === session.actorId && parsed.seq < cutoff) {
      await aux.delete(name).catch(() => {});
    }
  }
}
