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

/**
 * Has this page session already taken the stash? Belt to `removeItem`'s braces — see
 * `consumeKeptRecipe`. Reset by `stashKeptRecipe`, because keeping a SECOND recipe in the
 * same session is a perfectly ordinary thing to do.
 */
let consumedThisSession = false;
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
    // A new keep is a new journey — the session guard must not refuse the second recipe
    // someone sends you.
    consumedThisSession = false;
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

/**
 * Is a usable keep waiting? Cheap enough for a routing decision; does not consume.
 *
 * ⚠️ IT MUST APPLY THE SAME TTL THE CONSUMER DOES. A bare presence check would send someone
 * who tapped Keep and came back the next day to their cookbook instead of the nook, where
 * `consumeKeptRecipe` would then find the entry expired and open nothing — a redirect to a
 * page they did not ask for, for no visible reason. The two answers have to agree.
 */
export function hasPendingKeptRecipe(): boolean {
  return readStash() !== null;
}

/** Parse and TTL-check the stash WITHOUT consuming it. `null` for absent, corrupt or stale. */
function readStash(): StashEnvelope | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STASH_KEY);
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
    return Date.now() - parsed.savedAt > TTL_MS ? null : parsed;
  } catch {
    return null;
  }
}

/**
 * Take the kept recipe, if one is waiting and still fresh.
 *
 * SINGLE-CONSUME: the entry is deleted on every read, including an expired or corrupt one,
 * so a stale recipe can never resurface weeks later in someone's cookbook.
 *
 * ⚠️ THE DELETE IS ITS OWN `try`. Safari in private mode permits reads and THROWS on writes,
 * so a shared read/delete block would discard a recipe it had already parsed intact — and
 * leave it in storage to surprise the user on a later cookbook visit. Read, decide, then
 * delete best-effort: the TTL still bounds anything the delete could not remove.
 */
export function consumeKeptRecipe(): SharedRecipeFields | null {
  // The in-memory half of single-consume. It is what makes the property TRUE rather than
  // best-effort: when `removeItem` throws (Safari private mode reads fine and refuses
  // writes) the entry survives in storage, and without this the same recipe would re-open
  // the add form on EVERY cookbook visit for the rest of the TTL. Returning the recipe and
  // leaving it behind was the first fix's trade; this removes the need to make one.
  if (consumedThisSession) return null;

  const envelope = readStash();
  const expired = envelope === null && hasRawStash();
  consumedThisSession = true;

  try {
    localStorage.removeItem(STASH_KEY);
  } catch (e) {
    // The recipe below was already read, and the session flag above stops it coming back.
    console.warn('[recipe-keep] could not clear the stash — localStorage refused the write.', e);
  }

  if (envelope) return envelope.fields;
  if (expired) {
    logEvent({
      level: 'warn',
      surface: 'recipe-share',
      message: 'kept recipe was gone or stale before it was claimed',
      context: { action: 'keep_stash_lost', detail: 'expired' },
    });
  }
  return null;
}

/** Was there an entry at all? Distinguishes "expired/corrupt" from "nothing was kept". */
function hasRawStash(): boolean {
  try {
    return localStorage.getItem(STASH_KEY) !== null;
  } catch {
    return false;
  }
}

/** Sign-out teardown. Clear-data tier only — see `signOutSteps`. */
export function clearKeptRecipe(): void {
  consumedThisSession = true;
  try {
    localStorage.removeItem(STASH_KEY);
  } catch {
    // Nothing to do and nothing at risk: the TTL and single-consume already bound this.
  }
}
