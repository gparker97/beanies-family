// Pure rules for a shared link (#64 links).
//
// These lived as CLOSURES inside `useRecipeCapture.processUrl`, captured over `route` and
// `kind` — which is exactly why the share path could not reach them and an early draft of
// this work assumed they had to be rewritten. As pure functions over `ShareLink` they have
// one implementation, reachable from both the pasted-link and shared-link paths, and direct
// unit tests instead of coverage-by-proxy through a 175-line function.

import { safeHttpsUrl } from '@/utils/url';
import { logEvent } from '@/services/telemetry/logEvent';
import { IMAGE_SOURCES } from '@/types/magicPayload';
import type { ImageCandidate, ImageSource, ShareLink } from '@/types/magicPayload';
import type { ExtractionPath } from '@/services/ai/recipeSourceResolver';

/**
 * Screen the page's declared image candidates into a usable, ordered list.
 *
 * WHY THE SAME-REGISTRABLE-DOMAIN BOUND IS GONE (#86). It used to live here, and it was a
 * real control, not an oversight: the model could name ANY host as the image, so binding the
 * host to the page we read was the only thing stopping a hostile page aiming our AWS egress
 * wherever it liked. Two things changed together, and both are required:
 *
 *  1. The candidates are now extracted SERVER-SIDE from the markup of the page we actually
 *     fetched, so a URL here came out of that page rather than out of a model's imagination.
 *  2. The model no longer supplies an image URL at all. It never could — `htmlToText` strips
 *     every tag before the model sees the page — so its only possible contribution was a
 *     hallucination, and that path is deleted rather than defended.
 *
 * What remains is `safeHttpsUrl` here, plus `screenUrl` AND `resolvePublicAddress` inside
 * `guardedFetch` on every candidate we actually fetch, on every redirect hop. The bound was
 * the wrong tool; those are the right ones, and they are untouched.
 *
 * This is also the DEFENSIVE NORMALISER for the unchecked `body as T` cast in
 * `recipeFetchService`. An old Lambda, a shape drift or an outright hostile response must
 * yield `[]`, never a throw — this runs inside a Vue watch callback with no catch above it.
 */
export function screenCandidates(raw: unknown): ImageCandidate[] {
  if (!Array.isArray(raw)) return [];
  const out: ImageCandidate[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { url, source } = item as { url?: unknown; source?: unknown };
    if (typeof url !== 'string') continue;
    const safe = safeHttpsUrl(url);
    if (!safe) {
      logEvent({
        level: 'info',
        surface: 'recipe-extract',
        message: 'dish image candidate rejected: not a usable https URL',
        // Never the URL itself — a page-authored value. The enum says which check failed.
        context: { action: 'image_rejected', detail: 'unsafe_candidate' },
      });
      continue;
    }
    // An unrecognised `source` is RELABELLED, never a reason to drop the URL. The Lambda
    // deploys ahead of the client, so a rung the server learns first would otherwise have
    // every candidate silently discarded on-device for the whole deploy window. `source` is
    // a CloudWatch dimension; only `safeHttpsUrl` and guardedFetch decide what we fetch.
    const known = IMAGE_SOURCES.includes(source as ImageSource);
    out.push({ url: safe, source: known ? (source as ImageSource) : 'other' });
  }
  return out;
}

/**
 * Build a `ShareLink` from a resolved source and the route it came from.
 *
 * THIS is the one place the two URLs are distinguished, which is why it exists at all:
 *  - `pageUrl` is what was actually read (`resolved.sourceUrl` — the page the fetcher landed
 *    on after redirects), and it is the bound on the page's own image;
 *  - `provenanceUrl` is what gets stored. For a video that is the VIDEO the user shared, not
 *    the blog the ladder followed out of its description. They chose the video, they
 *    recognise it, and its description links the blog anyway.
 * For a plain page share the two are the same string; for a video capture they are not, and
 * that is exactly when swapping them is silent.
 */
export function toShareLink(
  resolved: { path: ExtractionPath; sourceUrl: string; imageCandidates?: ImageCandidate[] },
  route: { kind: 'youtube' | 'page' | 'invalid'; url?: string }
): ShareLink {
  const isVideo = route.kind === 'youtube';
  return {
    pageUrl: resolved.sourceUrl,
    provenanceUrl: isVideo && route.url ? route.url : resolved.sourceUrl,
    // `?? []` because a hand-built resolved source (a test fixture, or a future rung that
    // forgets the field) would otherwise put `undefined` on the ShareLink and the attach
    // would throw reading `.length`. An absent list means the same as an empty one here.
    imageCandidates: resolved.imageCandidates ?? [],
    path: resolved.path,
    kind: isVideo ? 'youtube' : 'page',
  };
}
