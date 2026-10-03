/**
 * The Automerge actorId for the realm this module is loaded in.
 *
 * Realm-scoped module state, and its own file for one reason: `docOps` is pure
 * doc-in/doc-out, and holding mutable realm state there would break that
 * contract for every future reader. Automerge itself keeps the actor at exactly
 * this scope, so the boundary matches the library's own.
 *
 * ONE holder, so a forgotten call site cannot go silent: every function that
 * CREATES a document reads `docInitOpts()`, and the holder warns once per realm
 * if it is ever asked before the actor was posted. Without that, a missed
 * `setDocActor` looks identical to working code and the actor churn simply
 * continues.
 */

import { generateUUID } from '@/utils/id';

let actor: string | null = null;
let warnedUnset = false;

/** Post the actor into this realm (main thread on spawn, or the worker). */
export function setDocActor(next: string | null): void {
  actor = next;
  warnedUnset = false;
}

/**
 * Init options for any `Automerge.load` / `init` / `from` in this realm.
 *
 * Returns `undefined` when no actor is set, which is exactly today's behaviour
 * (Automerge mints a random one) — a missing actor must never stop a document
 * from loading.
 */
export function docInitOpts(): { actor: string } | undefined {
  if (actor) return { actor };
  if (!warnedUnset) {
    warnedUnset = true;
    // The worker cannot telemeter (`perfTiming` flushes on `window`/`pagehide`),
    // so this is a console warning by necessity. Names the plumbing, because the
    // symptom — a slowly growing actor count — is invisible for weeks.
    // ⚠️ EXPECTED WHILE `ACTOR_PINNING_ENABLED` IS FALSE (docClient.ts), which
    // is the current, deliberate state — a pinned actor collides with this
    // device's own published history whenever the cache lags Drive. Kept at
    // `warn` only because the lint allows nothing quieter; the wording carries
    // the real severity. It still names the plumbing, because once pinning is
    // re-enabled a silent miss here is invisible for weeks.
    console.warn(
      '[docActor] no actor set for this realm; Automerge will mint a random one. ' +
        'Expected while actor pinning is disabled. If it is enabled, check that ' +
        'docClient.setFamilyKey(key, familyId) ran and that spawn()/enterInlineMode() re-post it.'
    );
  }
  return undefined;
}

/** Test seam / sign-out: forget the actor and re-arm the warning. */
export function resetDocActor(): void {
  actor = null;
  warnedUnset = false;
}

// ─── The device writer id (#117 Phase 2) ─────────────────────────────────────

/**
 * This device's Counter writer id: minted ONCE per family cache by `cache.initPersistenceDB`
 * (a row beside the remote baseline, deleted with the cache on sign-out) and posted here by it.
 * Every Counter key this realm writes carries it as `${deviceWriterId}:${actorId}`, and the
 * rebase replays only keys that start with it (`counterFields.counterGrowthOps`). The actor is
 * fresh per load, so the device id is what survives a reload; the actor is what keeps two tabs
 * of one device (one id, two actors) single-writer per key.
 *
 * Held here, beside the actor, because it is realm state of the same kind and `docOps` must stay
 * pure.
 *
 * ⚠️ NEVER ABSENT. A session whose family cache never opened has no row to read, so the first
 * ask mints an EPHEMERAL id (same helper, held only in memory) and uses it for the rest of the
 * process. That is exact, not a degradation: a cacheless session persists nothing across a
 * reload, so its keys only ever need to be "own" within this session, and every later session
 * (including this device's next one) correctly sees them as foreign. THE CACHE ID WINS: once
 * `setDeviceWriterId` posts a persisted id, every later write uses it and the ephemeral one is
 * forgotten; keys already written under it stay valid as some other session's keys.
 */
let persistedId: string | null = null;
let ephemeralId: string | null = null;
let deviceResolver: ((actor: string) => string) | null = null;

/** Post the cache's persisted id (or clear it, on cache close). Either way the ephemeral id
 *  is dropped: a persisted id supersedes it, and after a close the next session starts fresh. */
export function setDeviceWriterId(next: string | null): void {
  persistedId = next;
  ephemeralId = null;
}

/** The realm's device id: the persisted one when the cache opened, else the ephemeral one,
 *  minted on first use. */
function realmDeviceId(): string {
  if (persistedId !== null) return persistedId;
  ephemeralId ??= generateUUID();
  return ephemeralId;
}

/** Whether the realm is writing under an ephemeral id (no family cache opened yet). */
export function isDeviceWriterIdEphemeral(): boolean {
  return persistedId === null;
}

/**
 * The device that owns writes made through a handle with this `actor`. In production every
 * handle in a realm belongs to the one device, so the actor is ignored; it is the argument only
 * so the test seam below can put two simulated devices in one realm.
 */
export function deviceWriterIdFor(actor: string): string {
  return deviceResolver ? deviceResolver(actor) : realmDeviceId();
}

/** The Counter writer segment for a handle: `${device}:${actor}`. */
export function counterWriterId(actor: string): string {
  return `${deviceWriterIdFor(actor)}:${actor}`;
}

/** Test seam: map each actor to a simulated device (`twoDevices.ts`), or `null` to restore the
 *  realm's single id. Reset in an `afterEach`. */
export function __setDeviceWriterResolverForTesting(fn: ((actor: string) => string) | null): void {
  deviceResolver = fn;
}
