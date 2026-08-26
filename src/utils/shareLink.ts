// Pure rules for a shared link (#64 links).
//
// These lived as CLOSURES inside `useRecipeCapture.processUrl`, captured over `route` and
// `kind` — which is exactly why the share path could not reach them and an early draft of
// this work assumed they had to be rewritten. As pure functions over `ShareLink` they have
// one implementation, reachable from both the pasted-link and shared-link paths, and direct
// unit tests instead of coverage-by-proxy through a 175-line function.

import { isSameRegistrableDomain, safeHttpsUrl } from '@/utils/url';
import type { ShareLink } from '@/types/magicPayload';
import type { ExtractionPath } from '@/services/ai/recipeSourceResolver';

/**
 * The dish image to use, or null.
 *
 * SECURITY, not tidiness: a page we fetched is untrusted, so its self-declared image is only
 * accepted when it sits on the SAME REGISTRABLE DOMAIN as the page itself. Otherwise a
 * hostile page could name any host as its image and we would fetch it.
 *
 * Prefer the mapper's value — it has already been bounded against the same page — and fall
 * back to the page's own `imageUrl` only after screening it. A rejection is logged rather
 * than swallowed, because "the photo just didn't appear" is otherwise undiagnosable.
 */
export function boundedDishImage(link: ShareLink, mapperImage: string | null): string | null {
  if (mapperImage) return mapperImage;
  if (!link.imageUrl) return null;

  const safe = safeHttpsUrl(link.imageUrl);
  if (!safe) return null;
  if (!isSameRegistrableDomain(safe, link.pageUrl)) {
    console.warn(
      '[share-link] dropped a page-supplied image from a different domain than the page ' +
        'it came from — a page may only name its own images. page=%s',
      link.pageUrl
    );
    return null;
  }
  return safe;
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
  resolved: { path: ExtractionPath; sourceUrl: string; imageUrl: string },
  route: { kind: 'youtube' | 'page' | 'invalid'; url?: string }
): ShareLink {
  const isVideo = route.kind === 'youtube';
  return {
    pageUrl: resolved.sourceUrl,
    provenanceUrl: isVideo && route.url ? route.url : resolved.sourceUrl,
    imageUrl: resolved.imageUrl,
    path: resolved.path,
    kind: isVideo ? 'youtube' : 'page',
  };
}
