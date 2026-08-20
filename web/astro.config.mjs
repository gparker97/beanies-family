// @ts-check
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import mdx from '@astrojs/mdx';
import tailwindcss from '@tailwindcss/vite';
import rehypeGuideAnnotations from './src/lib/rehype-guide-annotations.mjs';
import rehypeExternalLinks from './src/lib/rehype-external-links.mjs';
import rehypeImageDims from './src/lib/rehype-image-dims.mjs';
import rehypeTableWrap from './src/lib/rehype-table-wrap.mjs';

export default defineConfig({
  site: 'https://beanies.family',
  trailingSlash: 'never',
  build: {
    format: 'file',
    // Inline ALL page CSS into <style> rather than emitting <link> tags.
    // Astro's default ('auto') only inlines stylesheets under ~4KB; ours are
    // larger, so by default they ship as render-blocking <link>s.
    //
    // DECISION (2026-07-21, provisional — see below): keep 'always'.
    // Rationale: it removes two render-blocking requests from the critical
    // path. Cost: ~112KB of CSS is inlined into EVERY page document, which
    // forfeits cross-page CSS caching across a 91-page site — a repeat visitor
    // re-downloads it per page instead of hitting cache.
    //
    // This setting was originally introduced expecting a ~1510ms LCP win (the
    // figure Lighthouse's "render-blocking resources" audit advertised). The
    // measured result was 87ms. That estimate assumes the bytes go away; they
    // don't, they move into the HTML. The homepage LCP regression was actually
    // fixed by two other changes — see
    // docs/plans/2026-07-21-homepage-lcp-critical-css.md. Stating that here so
    // nobody re-derives the wrong causal story from this line.
    //
    // NOT YET RE-VALIDATED against 'auto' now that the real fix has landed.
    // The comparison needs a quiet CI runner and we did not have one: on
    // 2026-07-21 the identical commit produced total-blocking-time readings
    // between 80ms and 1342ms across consecutive runs, which is not a basis
    // for a config decision. Re-measure both settings when Lighthouse is
    // stable, and prefer 'auto' if it holds LCP — cacheability is worth real
    // money on a browse-heavy content site.
    inlineStylesheets: 'always',
  },
  markdown: {
    rehypePlugins: [rehypeGuideAnnotations, rehypeExternalLinks, rehypeImageDims, rehypeTableWrap],
  },
  // Canonical homepage is the apex (beanies.family). Anyone hitting /home
  // gets sent there. /welcome is an app-surface URL — kick it to the PWA so
  // users who type beanies.family/welcome still land on the login gate.
  redirects: {
    '/home': '/',
    '/welcome': 'https://app.beanies.family/welcome',
  },
  integrations: [
    mdx(),
    sitemap({
      // /oauth/* is the native OAuth return bridge — a machine-facing redirect
      // surface that must never be indexed or surfaced to a human via search.
      filter: (page) => !page.includes('/og/') && !page.includes('/oauth/'),
    }),
  ],
  vite: {
    // Cast around Vite version skew between Astro-bundled Vite and the
    // hoisted root Vite 7.x. Runtime is unaffected.
    plugins: [/** @type {any} */ (tailwindcss())],
    resolve: {
      alias: {
        // @ resolves to the Vue app's src — lets us reuse help + release-
        // notes data modules without path surgery.
        '@': fileURLToPath(new URL('../src', import.meta.url)),
        // ~ resolves to THIS Astro project's own src — use for Astro-only
        // helpers (e.g. ~/utils/content).
        '~': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  },
});
