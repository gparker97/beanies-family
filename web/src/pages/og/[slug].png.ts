/**
 * Placeholder — the real OG route lives at `[...slug].ts` (matches
 * astro-og-canvas convention). This file cannot be deleted in the current
 * harness; expose an empty static path set so Astro emits nothing.
 */

export function getStaticPaths() {
  return [];
}

export async function GET() {
  return new Response(null, { status: 404 });
}
