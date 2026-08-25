/**
 * Typed client for the `content-fetch` Lambda (#72).
 *
 * Returns the SAME `{ success, data?, errorCode?, error? }` envelope the extraction service
 * uses, and classifies every Lambda `code` into an existing `ExtractionErrorCode`. That is
 * the whole point: the wedge composable ends up with exactly ONE failure branch —
 * `reportExtractionFailure(errorCode)` — covering both fetching and inference, and no second
 * toast mapper or error taxonomy exists anywhere in this feature.
 *
 * WHY THIS EXISTS AT ALL: the browser cannot do this. Reading a cross-origin page or image
 * is blocked by CORS, and an opaque no-cors response cannot be parsed or stored. Any design
 * that has the client fetch a recipe site directly fails at runtime on nearly every site.
 */
import type { DocumentExtractionResult, ExtractionErrorCode } from './types';

const FETCH_URL = import.meta.env.VITE_CONTENT_FETCH_URL;
const FETCH_API_KEY = import.meta.env.VITE_CONTENT_FETCH_API_KEY;
const DEFAULT_TIMEOUT_MS = 15_000;

/** Every `code` the Lambda documents. Kept in sync by an exhaustiveness test. */
export const CONTENT_FETCH_CODES = [
  'bad_url',
  'bad_mode',
  'blocked',
  'fetch_failed',
  'too_large',
  'timeout',
  'not_readable',
  'no_captions',
  'not_image',
  'not_found',
  'site_refused',
] as const;
export type ContentFetchCode = (typeof CONTENT_FETCH_CODES)[number];

/**
 * Lambda code → the shared client error code.
 *
 * Frozen and exhaustively typed so a code added to the Lambda later cannot silently fall
 * through to the generic "something went wrong" toast — the user would be told nothing for
 * a condition we knew precisely. A unit test asserts every documented code has an entry.
 */
export const CODE_TO_ERROR: Readonly<Record<ContentFetchCode, ExtractionErrorCode>> = Object.freeze(
  {
    // The SSRF guard refused it, or it was not a fetchable URL at all.
    bad_url: 'fetch_blocked',
    bad_mode: 'fetch_blocked',
    blocked: 'fetch_blocked',
    // Reached the host but got nothing usable back.
    not_readable: 'no_content',
    no_captions: 'no_content',
    not_image: 'no_content',
    too_large: 'no_content',
    // The SITE said no — a dead link or a host refusing our user-agent. Not our fault and
    // not our outage, so it gets its own code and its own honest copy.
    not_found: 'source_unreachable',
    site_refused: 'source_unreachable',
    // Transport-shaped failures reuse the existing inference codes, so the toast copy
    // already reads correctly for them.
    timeout: 'timeout',
    fetch_failed: 'provider_error',
  }
);

export interface JsonLdRecipe {
  name: string;
  subtitle: string;
  prepTime: string;
  cookTime: string;
  servings: string;
  ingredients: string[];
  steps: string[];
  imageUrl: string;
}

export type PageFetchData =
  | { kind: 'jsonld'; recipe: JsonLdRecipe; finalUrl: string }
  | { kind: 'text'; text: string; title: string; imageUrl: string; finalUrl: string };

export interface YoutubeFetchData {
  videoId: string;
  title: string;
  channel: string;
  description: string;
  /** `null`, never `''` — "no captions" is a distinct state, not an empty one. */
  captions: string | null;
}

export interface ImageFetchData {
  mime: string;
  dataUrl: string;
}

function buildSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function post<T>(
  mode: 'page' | 'youtube' | 'image',
  url: string,
  signal?: AbortSignal
): Promise<DocumentExtractionResult<T>> {
  if (!FETCH_URL) {
    // An honest seam, exactly like managedProvider's: unconfigured degrades to a typed
    // "not available", never a fake success.
    return {
      success: false,
      errorCode: 'not_available',
      error: 'Content fetching is not configured (endpoint unset)',
    };
  }

  let res: Response;
  try {
    res = await fetch(FETCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(FETCH_API_KEY ? { 'x-api-key': FETCH_API_KEY } : {}),
      },
      body: JSON.stringify({ mode, url }),
      signal: buildSignal(signal),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { success: false, errorCode: 'timeout', error: 'Content fetch timed out' };
    }
    return {
      success: false,
      errorCode: 'provider_error',
      error: 'Network error calling the content fetcher',
    };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return {
      success: false,
      errorCode: 'malformed_output',
      error: 'Could not read the content fetcher response',
    };
  }

  if (!res.ok) {
    const code = (body as { code?: string })?.code;
    const errorCode =
      code && code in CODE_TO_ERROR
        ? CODE_TO_ERROR[code as ContentFetchCode]
        : ('provider_error' as ExtractionErrorCode);
    return { success: false, errorCode, error: `content-fetch returned HTTP ${res.status}` };
  }

  return { success: true, data: body as T };
}

export const recipeFetchService = {
  fetchPage: (url: string, signal?: AbortSignal) => post<PageFetchData>('page', url, signal),
  fetchYoutube: (url: string, signal?: AbortSignal) =>
    post<YoutubeFetchData>('youtube', url, signal),
  fetchImage: (url: string, signal?: AbortSignal) => post<ImageFetchData>('image', url, signal),
};

export type RecipeFetchService = typeof recipeFetchService;
