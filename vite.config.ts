import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    wasm(),
    topLevelAwait(),
    vue(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['brand/*.png', 'icons/*.png'],
      manifest: {
        name: 'beanies.family',
        short_name: 'beanies.family',
        description: 'Every bean counts — family planning made simple',
        theme_color: '#2C3E50',
        background_color: '#F8F9FA',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        orientation: 'any',
        categories: ['finance', 'productivity'],
        icons: [
          {
            src: 'brand/beanies_father_son_icon_192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'brand/beanies_father_son_icon_512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,json,wasm}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024, // 4 MiB — Automerge WASM is ~2.65 MB
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  define: {
    // Build SHA — populated by `deploy.yml` via `VITE_BUILD_SHA: ${{ github.sha }}`.
    // Falls back to 'dev' for local builds. Read at runtime via
    // `import.meta.env.VITE_BUILD_SHA` (the errorReporter ships this in
    // every Slack message so we can correlate bugs to specific deploys).
    'import.meta.env.VITE_BUILD_SHA': JSON.stringify(process.env.VITE_BUILD_SHA || 'dev'),
  },
});
