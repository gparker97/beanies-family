/**
 * Offline-durable retry queue for Google grant (refresh-token) revocations.
 *
 * When a revoke of an authorization grant fails for a TRANSIENT reason (offline,
 * network error, Google 5xx/429), the token is queued here and retried on the
 * same recovery triggers `offlineQueue` uses (online / token-acquired / visible /
 * startup). See ADR — token churn plan (2026-08-13).
 *
 * Two deliberate differences from `offlineQueue.ts` (whose *trigger/coalescing*
 * model this mirrors):
 *   1. It holds a SET of distinct tokens (each a separate grant to kill), not a
 *      single latest-content slot.
 *   2. It persists to **IndexedDB** (its own `beanies-revoke-queue` DB), NOT
 *      sessionStorage — the queued items are live refresh-token SECRETS, which
 *      must (a) stay in the same durable tier the app already designates for
 *      tokens (never a weaker per-tab store) and (b) survive tab close so a
 *      must-eventually-land revoke is never silently dropped.
 *
 * The raw network revoke (`postRevoke`) lives here so both the immediate attempt
 * (`googleRevoke.revokeGrant`) and the queue drain share one implementation and
 * one classification of "done vs. retry".
 */
import { openDB, type IDBPDatabase } from 'idb';
import { logTokenLifecycle, type TokenGrant } from '@/services/google/googleRevoke';
// NOTE: `onTokenAcquired` (from googleAuth) is imported LAZILY inside
// `startListening` — a static import would close the cycle
// googleAuth → googleRevoke → revokeQueue → googleAuth and break module init
// (offlineQueue avoids this only because googleAuth never imports it).

const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

const REVOKE_DB_NAME = 'beanies-revoke-queue';
const REVOKE_DB_VERSION = 1;
const REVOKE_STORE = 'tokens';

interface QueuedRevoke {
  token: string;
  /** Which feature's grant this token belonged to — for accurate telemetry only. */
  grant: TokenGrant;
  enqueuedAt: number;
}

interface RevokeDB {
  tokens: {
    key: string; // the refresh token itself
    value: QueuedRevoke;
  };
}

let revokeDb: IDBPDatabase<RevokeDB> | null = null;

async function getRevokeDatabase(): Promise<IDBPDatabase<RevokeDB>> {
  if (revokeDb) return revokeDb;
  revokeDb = await openDB<RevokeDB>(REVOKE_DB_NAME, REVOKE_DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(REVOKE_STORE)) {
        db.createObjectStore(REVOKE_STORE, { keyPath: 'token' });
      }
    },
  });
  return revokeDb;
}

/**
 * The single raw revoke against Google's public revoke endpoint.
 *
 * Classifies the outcome into exactly two buckets so callers never have to:
 *   - `'ok'`        — the grant is gone (2xx), OR Google already considers the
 *                     token invalid/expired (a 4xx that is not rate-limiting).
 *                     Either way the goal is achieved; do NOT retry.
 *   - `'transient'` — offline / network throw / 429 / 5xx. Retry later.
 *
 * No `client_secret` is needed — `/revoke` accepts a bare token (matching the
 * four pre-existing best-effort revoke sites in `googleAuth.ts`).
 */
export async function postRevoke(token: string): Promise<'ok' | 'transient'> {
  let res: Response;
  try {
    res = await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`, {
      method: 'POST',
    });
  } catch {
    // Network error / offline — the token is still live at Google; retry later.
    return 'transient';
  }
  if (res.ok) return 'ok';
  // 429 / 5xx are the only server responses worth retrying; every other status
  // (notably 400 for an already-invalid or already-revoked token) means the
  // grant is effectively gone — treat as done so the queue cannot spin forever.
  if (res.status === 429 || res.status >= 500) return 'transient';
  return 'ok';
}

/**
 * Persist a token for durable retry and start the recovery listeners.
 * Idempotent on the token (keyPath), so re-enqueuing the same token is a no-op.
 */
export async function enqueueRevoke(token: string, grant: TokenGrant): Promise<void> {
  try {
    const db = await getRevokeDatabase();
    await db.put(REVOKE_STORE, { token, grant, enqueuedAt: Date.now() });
  } catch (e) {
    // IndexedDB unavailable (private mode / quota). We cannot durably retry, so
    // make the failure visible rather than dropping it silently.
    logTokenLifecycle({
      grant,
      op: 'revoke',
      outcome: 'failed',
      reason: 'enqueue-failed',
      trigger: 'enqueue',
      error: e instanceof Error ? e : new Error(String(e)),
    });
    return;
  }
  logTokenLifecycle({ grant, op: 'revoke', outcome: 'queued', trigger: 'enqueue' });
  startListening();
}

// --- Drain + recovery triggers (mirrors offlineQueue's coalescing model) ---

type DrainReason = 'online' | 'token-acquired' | 'visible' | 'startup';

let isListening = false;
let drainInFlight: Promise<void> | null = null;
let tokenAcquiredUnsub: (() => void) | null = null;
let visibilityHandler: (() => void) | null = null;

/**
 * Drain the queue: revoke each stored token, removing the ones that succeed and
 * leaving transient failures for the next trigger. Coalesced so overlapping
 * triggers share one pass (no duplicate network calls).
 */
function tryDrain(reason: DrainReason): void {
  if (drainInFlight) return;
  const p = drainOnce(reason).catch(() => {
    /* drainOnce never throws — defensive */
  });
  drainInFlight = p;
  void p.finally(() => {
    if (drainInFlight === p) drainInFlight = null;
  });
}

async function drainOnce(reason: DrainReason): Promise<void> {
  let queued: QueuedRevoke[];
  try {
    const db = await getRevokeDatabase();
    queued = await db.getAll(REVOKE_STORE);
  } catch {
    return; // DB unreadable this pass — a later trigger retries.
  }
  if (queued.length === 0) {
    stopListening();
    return;
  }
  for (const { token, grant } of queued) {
    const result = await postRevoke(token);
    if (result !== 'ok') continue; // still transient — keep for next trigger
    try {
      const db = await getRevokeDatabase();
      await db.delete(REVOKE_STORE, token);
    } catch {
      // Deleting failed but the revoke landed; the next drain re-posts an
      // already-dead token (a no-op 'ok') and retries the delete. Safe.
    }
    logTokenLifecycle({ grant, op: 'revoke', outcome: 'ok', reason, trigger: 'queue-drain' });
  }
  // If everything drained, tear the listeners down; otherwise keep waiting.
  try {
    const db = await getRevokeDatabase();
    if ((await db.count(REVOKE_STORE)) === 0) stopListening();
  } catch {
    /* leave listeners attached — safer than tearing down blind */
  }
}

function handleOnline(): void {
  tryDrain('online');
}

function startListening(): void {
  if (isListening) return;
  isListening = true;
  window.addEventListener('online', handleOnline);
  // Lazy import (see the note at the top of this file): resolves the fully-
  // initialised googleAuth at runtime, so the `token-acquired` trigger is kept
  // without a static module cycle. Guarded against a stopListening() that races
  // the dynamic resolve.
  if (!tokenAcquiredUnsub) {
    void import('@/services/google/googleAuth').then(({ onTokenAcquired }) => {
      if (isListening && !tokenAcquiredUnsub) {
        tokenAcquiredUnsub = onTokenAcquired(() => tryDrain('token-acquired'));
      }
    });
  }
  if (!visibilityHandler && typeof document !== 'undefined') {
    visibilityHandler = () => {
      if (!document.hidden) tryDrain('visible');
    };
    document.addEventListener('visibilitychange', visibilityHandler);
  }
}

function stopListening(): void {
  if (!isListening) return;
  window.removeEventListener('online', handleOnline);
  if (tokenAcquiredUnsub) {
    tokenAcquiredUnsub();
    tokenAcquiredUnsub = null;
  }
  if (visibilityHandler && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', visibilityHandler);
    visibilityHandler = null;
  }
  isListening = false;
}

// Startup trigger: if a revoke was queued in a previous session, resume as soon
// as the module loads (mirrors offlineQueue's boot-time restore).
void (async () => {
  try {
    const db = await getRevokeDatabase();
    if ((await db.count(REVOKE_STORE)) > 0) {
      startListening();
      tryDrain('startup');
    }
  } catch {
    // IndexedDB unavailable at boot — nothing to resume.
  }
})();

/** Test-only: reset module state so specs don't leak listeners/handles. */
export async function __resetRevokeQueueForTesting(): Promise<void> {
  stopListening();
  drainInFlight = null;
  try {
    const db = await getRevokeDatabase();
    await db.clear(REVOKE_STORE);
  } catch {
    /* ignore */
  }
}
