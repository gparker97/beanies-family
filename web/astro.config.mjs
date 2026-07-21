// @ts-check
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import mdx from '@astrojs/mdx';
import tailwindcss from '@tailwindcss/vite';
import rehypeGuideAnnotations from './src/lib/rehype-guide-annotations.mjs';
import rehypeExternalLinks from './src/lib/rehype-external-links.mjs';
import rehypeImageDims from './src/lib/rehype-image-dims.mjs';

export default defineConfig({
  site: 'https://beanies.family',
  trailingSlash: 'never',
  build: {
    format: 'file',
    // Inline ALL page CSS into <style> rather than emitting <link> tags.
    //
    // Astro's default ('auto') only inlines stylesheets under ~4KB, so our two
    // homepage bundles (~10KB each) shipped as render-blocking requests. That
    // was the entire Lighthouse failure: on the homepage the LCP element is the
    // hero mascot, which LOADS in 84ms but had a 2707ms *render delay* (83% of
    // LCP) waiting on those two stylesheets. Lighthouse measured 1510ms of
    // render-blocking savings here, taking LCP from 3245ms back under the
    // 3000ms budget. Total blocking time was already 0ms, so this was never a
    // JS problem.
    //
    // Trade-off, accepted deliberately: inlining costs ~21KB per HTML document
    // and forfeits cross-page CSS caching on repeat visits. For a marketing
    // site whose traffic is overwhelmingly first-visit landings from search and
    // social, eliminating two round trips on the critical path wins. Revisit if
    // the site ever becomes browse-heavy.
    inlineStylesheets: 'always',
  },
  markdown: {
    rehypePlugins: [rehypeGuideAnnotations, rehypeExternalLinks, rehypeImageDims],
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
      filter: (page) => !page.includes('/og/'),
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
