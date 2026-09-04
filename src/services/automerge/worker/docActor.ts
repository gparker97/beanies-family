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
    console.warn(
      '[docActor] no actor set for this realm; Automerge will mint a random one. ' +
        'Check that docClient.setFamilyKey(key, familyId) ran, and that spawn()/enterInlineMode() re-post it.'
    );
  }
  return undefined;
}

/** Test seam / sign-out: forget the actor and re-arm the warning. */
export function resetDocActor(): void {
  actor = null;
  warnedUnset = false;
}
