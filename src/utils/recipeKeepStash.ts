/**
 * The one handoff: a recipe someone tapped "Keep" on, held across sign-up (#92).
 *
 * ⚠️ NOT `utils/shareStash.ts`. That is the INBOUND Web Share Target reader — files a
 * service worker stashed in Cache Storage from a POST, read once and deleted. Opposite
 * direction, different storage, different lifecycle. Do not consolidate them.
 *
 * ⚠️ `localStorage`, WITH EYES OPEN. Neither `localStorage` nor `sessionStorage` survives the
 * iOS Drive OAuth hop: WebKit's bounce-tracking protection clears the initiating site's
 * script-writable storage across a cross-site redirect, independently of the "Prevent
 * Cross-Site Tracking" toggle (see `services/google/redirectState.ts`). The repo removed a
 * `sessionStorage` stash for exactly this reason in 2026-06. The app's workaround — carrying
 * routing in the OAuth `state` param — is NOT available to us: `state` is documented
 * non-secret and transits Google, URLs and logs, so a recipe can never ride it.
 *
 * So this is chosen because it survives every OTHER journey (tab close, app backgrounding,
 * local-file setup, an already-signed-in user), not because it beats the hop. On the one
 * journey it cannot survive, the UI states the recovery BEFORE the hop — re-open the link
 * from your chat and tap Keep — because after the hop the loss is unobservable by
 * construction: any marker saying "a keep was in flight" would live in the storage that was
 * just cleared.
 */
import { logEvent } from '@/services/telemetry/logEvent';
import type { SharedRecipeFields } from './recipeShareLink';

const STASH_KEY = 'beanies_kept_recipe';
/** Long enough for a sign-up, short enough that a forgotten recipe does not linger. */
const TTL_MS = 60 * 60_000;

interface StashEnvelope {
  savedAt: number;
  fields: SharedRecipeFields;
}

/** Where a kept recipe is delivered once a pod exists. */
export const KEPT_RECIPE_DESTINATION = '/pod/cookbook';

/**
 * Hold a recipe across sign-up. Returns `false` when storage refused it, so the caller can
 * tell the user rather than routing them to a cookbook that will be empty.
 */
export function stashKeptRecipe(fields: SharedRecipeFields): boolean {
  try {
    const envelope: StashEnvelope = { savedAt: Date.now(), fields };
    localStorage.setItem(STASH_KEY, JSON.stringify(envelope));
    return true;
  } catch (e) {
    // Private mode, quota, storage disabled. Never a bare catch: the user is about to be
    // routed somewhere on the strength of this working.
    console.warn(
      '[recipe-keep] could not stash the recipe — localStorage refused the write. ' +
        'The user should be told to re-open the share link rather than silently losing it.',
      e
    );
    logEvent({
      level: 'warn',
      surface: 'recipe-share',
      message: 'kept recipe could not be stashed',
      context: { action: 'keep_stash_write_failed' },
    });
    return false;
  }
}

/** Is a keep waiting? Cheap enough for a routing decision; does not consume. */
export function hasPendingKeptRecipe(): boolean {
  try {
    return localStorage.getItem(STASH_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Take the kept recipe, if one is waiting and still fresh.
 *
 * SINGLE-CONSUME: the entry is deleted on every read, including an expired one, so a stale
 * recipe can never resurface weeks later in someone's cookbook.
 */
export function consumeKeptRecipe(): SharedRecipeFields | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STASH_KEY);
    if (raw !== null) localStorage.removeItem(STASH_KEY);
  } catch (e) {
    console.warn('[recipe-keep] could not read the stash — localStorage threw.', e);
    return null;
  }
  if (raw === null) return null;

  try {
    const parsed = JSON.parse(raw) as StashEnvelope;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.savedAt !== 'number' ||
      typeof parsed.fields !== 'object' ||
      parsed.fields === null
    ) {
      return null;
    }
    if (Date.now() - parsed.savedAt > TTL_MS) {
      logEvent({
        level: 'warn',
        surface: 'recipe-share',
        message: 'kept recipe expired before it was claimed',
        context: { action: 'keep_stash_lost', detail: 'expired' },
      });
      return null;
    }
    return parsed.fields;
  } catch {
    // A corrupt envelope is indistinguishable from none, and the entry is already gone.
    return null;
  }
}

/** Sign-out teardown. Clear-data tier only — see `signOutSteps`. */
export function clearKeptRecipe(): void {
  try {
    localStorage.removeItem(STASH_KEY);
  } catch {
    // Nothing to do and nothing at risk: the TTL and single-consume already bound this.
  }
}
