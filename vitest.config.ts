import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [wasm(), topLevelAwait(), vue()],
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['src/**/*.{test,spec}.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // vite-plugin-pwa injects this virtual module at build time; under vitest
      // it doesn't exist, so resolve it to a test stub. Tests that drive update
      // behavior override it with `vi.mock('virtual:pwa-register/vue', …)`.
      'virtual:pwa-register/vue': fileURLToPath(
        new URL('./src/test/stubs/pwa-register.ts', import.meta.url)
      ),
    },
  },
});
