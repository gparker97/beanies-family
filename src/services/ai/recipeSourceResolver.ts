/**
 * The recipe-capture LADDER (#72 phases 2 & 3), as one function with one return type.
 *
 * Lives here rather than inside `useRecipeCapture` on purpose: the ladder is four rungs with
 * fall-through, and putting it in a Vue composable that ALSO owns `isProcessing`, toasts and
 * the extraction call would nest three deep and be untestable without a component harness.
 * Split this way, the decision is a pure-ish function with an injectable dependency, and the
 * composable becomes a flat switch over four outcomes.
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
  'document' | 'jsonld' | 'page_text' | 'youtube_link_followed' | 'youtube_captions';

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
  /** We can read nothing, and saying so is the correct outcome. */
  | { kind: 'refusal'; reason: 'no_transcript_no_link' | 'not_a_recipe_url' }
  | { kind: 'failed'; errorCode: ExtractionErrorCode };

export interface ResolverDeps {
  fetchService?: RecipeFetchService;
  signal?: AbortSignal;
}

/**
 * Hard cap on outbound calls per capture: watch page + one followed link + one image.
 *
 * Enforced by a counter rather than by convention, because "the ladder only makes three
 * calls" is a property of the code's shape today, not a guarantee — and this endpoint is a
 * semi-open proxy whose cost we are deliberately bounding.
 */
const MAX_FETCHES_PER_CAPTURE = 3;

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
 *   3. Otherwise hand the captions + harvested context to the model.
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
  const { title, channel, description, captions } = video.data;

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

  // Rung 3 — captions plus everything else we harvested.
  if (captions) {
    const context = [
      title && `Video title: ${title}`,
      channel && `Channel: ${channel}`,
      description && `Video description:\n${description}`,
      `Transcript:\n${captions}`,
    ]
      .filter(Boolean)
      .join('\n\n');
    return {
      kind: 'text',
      text: context,
      path: 'youtube_captions',
      sourceUrl: route.url,
      imageUrl: '',
    };
  }

  // Rung 4 — nothing readable. An explicit, user-visible refusal, never a silent no-op.
  return { kind: 'refusal', reason: 'no_transcript_no_link' };
}
