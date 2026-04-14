/**
 * Dynamic OG images for blog posts (1200×630).
 * Generated at build time via astro-og-canvas (CanvasKit / WASM Skia).
 * URL pattern: /og/<slug>.png
 */

import { OGImageRoute } from 'astro-og-canvas';
import { getCollection } from 'astro:content';

const posts = await getCollection('blog');

const pages = Object.fromEntries(
  posts.map((post) => [post.data.slug, { title: post.data.title, description: post.data.excerpt }])
);

export const { getStaticPaths, GET } = OGImageRoute({
  param: 'slug',
  pages,
  getImageOptions: (_slug, page) => ({
    title: page.title,
    description: page.description,
    bgGradient: [
      [241, 93, 34], // Heritage Orange
      [230, 126, 34], // Terracotta
    ],
    border: { color: [44, 62, 80], width: 0 },
    padding: 80,
    // Use default system fonts to avoid fontsource.org fetches at build
    // time (flaky, 10s timeout). Self-hosted Outfit/Inter can be wired
    // later via `fonts: [buffer, buffer]` if desired.
    font: {
      title: { color: [255, 255, 255], weight: 'Bold', size: 64, lineHeight: 1.15 },
      description: { color: [255, 255, 255], size: 28, lineHeight: 1.4 },
    },
    logo: { path: './public/brand/beanies-logo.png', size: [140] },
  }),
});
