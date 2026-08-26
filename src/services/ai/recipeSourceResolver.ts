/**
 * The recipe-capture LADDER (#72 phases 2 & 3), as one function with one return type.
 *
 * TWO callers now (#64 links): `useRecipeCapture.processUrl` for a link the user pastes in
 * the app, and `useSharedDocumentIngest.read` for a link shared from another app. Both must
 * handle EVERY member of `ResolvedRecipeSource` — adding a rung is a compile error at each
 * of their switches, which is exactly the point. Keep the two behaviours the same.
 *
 * Lives here rather than inside `useRecipeCapture` on purpose: the ladder is four rungs with
 * fall-through, and putting it in a Vue composable that ALSO owns `isProcessing`, toasts and
 * the extraction call would nest three deep and be untestable without a component harness.
 * Split this way, the decision is a pure-ish function with an injectable dependency, and the
 * composable becomes a flat switch over the outcomes.
 *
 * It decides WHAT to extract from. It never extracts, never persists, never toasts.
 */
import { pickRecipeLinks, routeUrl } from '@/utils/recipeSourceUrl';
import {
  recipeFetchService,
  type JsonLdRecipe,
  type RecipeFetchService,
} from './recipeFetchService';
import type { ExtractionErrorCode } from './types';

/**
 * Which rung produced the result. Logged as `extraction_path` — the field that makes a
 * "the recipe came out wrong" report answerable, because it says whether the values were
 * PARSED from structured data or INFERRED by the model.
 *
 * Repeated verbatim (documented, not imported — separate runtime) in the content-fetch
 * Lambda header so client and server logs join on the same vocabulary.
 */
export type ExtractionPath =
  'document' | 'jsonld' | 'page_text' | 'youtube_link_followed' | 'youtube_description';

export type ResolvedRecipeSource =
  /** Structured data straight from the page. The model is never invoked on this path. */
  | {
      kind: 'jsonld';
      recipe: JsonLdRecipe;
      path: ExtractionPath;
      sourceUrl: string;
      imageUrl: string;
    }
  /** Text for the model to read. */
  | { kind: 'text'; text: string; path: ExtractionPath; sourceUrl: string; imageUrl: string }
  /**
   * A video we could reach, whose recipe exists only in the audio and pictures.
   *
   * Its captions are unreachable — not because we have not tried, but because YouTube gates
   * every caption route behind a proof-of-origin token and answers without one by returning
   * HTTP 200 and an EMPTY BODY. Verified 2026-08-26 across the Data API (`captions.download`
   * needs OAuth AND video ownership), the public `timedtext` endpoint, the signed URL the
   * watch page itself hands out, InnerTube (`Precondition check failed`), manual as well as
   * auto tracks, and from a residential IP as well as from AWS. Every one returned nothing.
   *
   * So the title and the link are genuinely all there is — and they are still most of the
   * admin. Handing them over beats throwing the capture away.
   */
  | { kind: 'titleOnly'; title: string; sourceUrl: string; path: ExtractionPath }
  /** We can read nothing, and saying so is the correct outcome. */
  | { kind: 'refusal'; reason: 'no_text_no_link' | 'not_a_recipe_url' }
  | { kind: 'failed'; errorCode: ExtractionErrorCode };

export interface ResolverDeps {
  fetchService?: RecipeFetchService;
  signal?: AbortSignal;
}

/**
 * Hard cap on outbound calls made by THE RESOLVER: at most a watch page plus one followed
 * link. The dish-image fetch is deliberately NOT counted here — it happens later, in
 * `attachAfterSave`, after the user has chosen to save.
 *
 * Set to exactly what the ladder needs rather than a comfortable margin: a budget that can
 * never be reached is decoration, not a control, and would quietly stop bounding anything
 * the moment a fifth rung was added.
 */
const MAX_FETCHES_PER_CAPTURE = 2;

/**
 * Below this, a description is channel boilerplate rather than a recipe. Measured against
 * real cooking videos: a description carrying an ingredient list runs to hundreds of
 * characters; "Subscribe for more!" runs to tens.
 */
const MIN_DESCRIPTION_CHARS = 200;

function createFetchBudget(max: number = MAX_FETCHES_PER_CAPTURE): { take: () => boolean } {
  let used = 0;
  return {
    take() {
      if (used >= max) return false;
      used += 1;
      return true;
    },
  };
}

/** Turn a successful page fetch into a resolved source. */
function fromPage(
  data: Extract<Awaited<ReturnType<RecipeFetchService['fetchPage']>>['data'], object>,
  path: { jsonld: ExtractionPath; text: ExtractionPath }
): ResolvedRecipeSource {
  if (data.kind === 'jsonld') {
    return {
      kind: 'jsonld',
      recipe: data.recipe,
      path: path.jsonld,
      sourceUrl: data.finalUrl,
      imageUrl: data.recipe.imageUrl,
    };
  }
  return {
    kind: 'text',
    // Give the model the page title too — a reduced page often loses the <h1>.
    text: data.title ? `${data.title}\n\n${data.text}` : data.text,
    path: path.text,
    sourceUrl: data.finalUrl,
    imageUrl: data.imageUrl,
  };
}

/**
 * Resolve one pasted URL into something extractable.
 *
 * The YouTube ladder, in order, each rung falling to the next:
 *   1. Harvest the video's text context (title, channel, full description).
 *   2. FOLLOW KEY LINKS FIRST. Most food channels post the full recipe on their own blog,
 *      so a link in the description yields exact quantities with no inference at all. A
 *      failure here falls through rather than aborting.
 *   3. Otherwise hand the description + harvested context to the model.
 *   4. Otherwise REFUSE. Never reconstruct a recipe from a title.
 */
export async function resolveRecipeSource(
  raw: string,
  deps: ResolverDeps = {}
): Promise<ResolvedRecipeSource> {
  const svc = deps.fetchService ?? recipeFetchService;
  const budget = createFetchBudget();
  const route = routeUrl(raw);

  if (route.kind === 'invalid') return { kind: 'refusal', reason: 'not_a_recipe_url' };

  if (route.kind === 'page') {
    if (!budget.take()) return { kind: 'failed', errorCode: 'fetch_blocked' };
    const res = await svc.fetchPage(route.url, deps.signal);
    if (!res.success || !res.data) {
      return { kind: 'failed', errorCode: res.errorCode ?? 'provider_error' };
    }
    return fromPage(res.data, { jsonld: 'jsonld', text: 'page_text' });
  }

  // ── YouTube ────────────────────────────────────────────────────────────────
  if (!budget.take()) return { kind: 'failed', errorCode: 'fetch_blocked' };
  const video = await svc.fetchYoutube(route.url, deps.signal);
  if (!video.success || !video.data) {
    return { kind: 'failed', errorCode: video.errorCode ?? 'provider_error' };
  }
  const { title, channel, description } = video.data;

  // Rung 2 — follow the first plausible recipe link in the description.
  const links = pickRecipeLinks(description);
  if (links.length > 0 && budget.take()) {
    const linked = await svc.fetchPage(links[0], deps.signal);
    if (linked.success && linked.data) {
      return fromPage(linked.data, {
        jsonld: 'youtube_link_followed',
        text: 'youtube_link_followed',
      });
    }
    // Deliberately NOT fatal: a dead blog link should not cost us the captions. The
    // outcome is still recorded by the caller's telemetry via `extraction_path`.
  }

  // Rung 3 — the description itself, plus the context we harvested around it.
  //
  // The threshold exists so "like and subscribe!" does not become a model call that can only
  // ever come back "not a recipe". It is deliberately low: the model is the real filter, and
  // a description long enough to hold an ingredient list is worth reading even if it is
  // mostly prose. Refusing here is cheaper than a wrong recipe, but refusing too eagerly
  // throws away the common case where the whole recipe is pasted below the video.
  if (description.trim().length >= MIN_DESCRIPTION_CHARS) {
    const context = [
      title && `Video title: ${title}`,
      channel && `Channel: ${channel}`,
      `Video description:\n${description}`,
    ]
      .filter(Boolean)
      .join('\n\n');
    return {
      kind: 'text',
      text: context,
      path: 'youtube_description',
      sourceUrl: route.url,
      imageUrl: '',
    };
  }

  // Rung 4 — no readable recipe text anywhere. If we at least know what the video is
  // CALLED, hand that over rather than dropping the capture: the user chose this video on
  // purpose, and a named recipe carrying its link is most of the work of saving it.
  if (title.trim()) {
    return {
      kind: 'titleOnly',
      title: title.trim(),
      sourceUrl: route.url,
      path: 'youtube_description',
    };
  }

  // Rung 5 — not even a title. An explicit, user-visible refusal, never a silent no-op.
  return { kind: 'refusal', reason: 'no_text_no_link' };
}
