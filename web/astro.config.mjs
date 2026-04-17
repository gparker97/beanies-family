// @ts-check
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import mdx from '@astrojs/mdx';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://beanies.family',
  trailingSlash: 'never',
  build: {
    format: 'file',
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
