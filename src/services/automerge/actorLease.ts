/**
 * ONE writer per pinned actor.
 *
 * The device actor (`deviceActor.ts`) is derived from `deviceId`, which lives
 * in `localStorage` — shared by every tab of one browser profile. The doc
 * worker is a per-tab realm. Without this lease, two tabs on the same family
 * write under ONE actor in TWO realms, and Automerge refuses to merge them:
 *
 *   error applying changes: duplicate seq 2 found for actor …
 *
 * (pinned by `docActor.test.ts`). That throw is not a payload failure, so the
 * save path used to fall through to "save local anyway" and overwrite the
 * remote with a base that lacks the other tab's edits. Before the actor was
 * pinned every `load()` minted a random actor per tab, so this could not happen.
 *
 * The lease is a held Web Lock, `beanies-doc-actor:<familyId>`, scoped exactly
 * like `localStorage` (origin × profile), so it fences precisely the realms
 * that share the actor. The first realm to ask holds it for its lifetime; every
 * other realm — and any browser without Web Locks — gets `false`, and the
 * caller passes no actor, which is today's behaviour (a random one per load).
 * A second tab therefore costs one extra actor lane, not a merge refusal.
 *
 * ⚠️ NEVER THROWS, and NEVER blocks: `ifAvailable: true` answers immediately.
 * An exclusivity failure must degrade to the pre-Phase-A behaviour, never stop
 * a pod from opening.
 */
import { logEvent } from '@/services/telemetry/logEvent';

const LOCK_PREFIX = 'beanies-doc-actor:';

type Outcome = 'leased' | 'contended' | 'unavailable';

interface Held {
  familyId: string;
  release: () => void;
}

let held: Held | null = null;
let inflight: { familyId: string; promise: Promise<boolean> } | null = null;
/** Bumped by every acquire; a lock callback for a superseded request lets go. */
let generation = 0;

function note(outcome: Outcome, familyId: string, error?: unknown): void {
  logEvent({
    level: outcome === 'leased' ? 'debug' : 'info',
    surface: 'device-actor',
    message:
      outcome === 'leased'
        ? 'device actor leased to this realm'
        : outcome === 'contended'
          ? 'device actor held by another realm — using a random actor'
          : 'Web Locks unavailable — using a random actor',
    context: { action: outcome, family_id: familyId },
    ...(error instanceof Error ? { error } : {}),
  });
}

function requestLease(familyId: string, gen: number): Promise<boolean> {
  const locks =
    typeof navigator === 'undefined'
      ? undefined
      : (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks?.request) {
    note('unavailable', familyId);
    return Promise.resolve(false);
  }
  return new Promise<boolean>((resolve) => {
    let release: () => void = () => {};
    const untilReleased = new Promise<void>((r) => {
      release = r;
    });
    locks
      .request(LOCK_PREFIX + familyId, { ifAvailable: true }, (lock) => {
        if (!lock) {
          note('contended', familyId);
          resolve(false);
          return;
        }
        if (gen !== generation) {
          // A family switch or reset overtook this request: let the lock go
          // straight back rather than pin an actor nobody asked for.
          resolve(false);
          return;
        }
        held = { familyId, release };
        note('leased', familyId);
        resolve(true);
        // Returning a pending promise HOLDS the lock until `releaseActorLease`.
        return untilReleased;
      })
      .catch((e: unknown) => {
        note('unavailable', familyId, e);
        resolve(false);
      });
  });
}

/**
 * Does THIS realm hold the device-actor lease for `familyId`?
 *
 * Idempotent per family (the key is posted from six call sites per session,
 * and re-requesting a lock we already hold would answer "unavailable" and
 * silently drop the actor). A different family releases the old lease first.
 */
export function acquireActorLease(familyId: string): Promise<boolean> {
  if (held?.familyId === familyId) return Promise.resolve(true);
  if (inflight?.familyId === familyId) return inflight.promise;
  releaseActorLease();
  const gen = ++generation;
  const promise = requestLease(familyId, gen).finally(() => {
    if (inflight?.promise === promise) inflight = null;
  });
  inflight = { familyId, promise };
  return promise;
}

/** Let the lease go (sign-out, family switch). Safe when nothing is held. */
export function releaseActorLease(): void {
  generation++;
  held?.release();
  held = null;
  inflight = null;
}

/** Test seam. */
export function __resetActorLeaseForTesting(): void {
  releaseActorLease();
}
