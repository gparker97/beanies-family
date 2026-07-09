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
    // `src/**` is the app suite; `scripts/**/*.mjs` picks up build-script helpers
    // (e.g. derive-store-version). The registry Lambda's handler logic (the PUT
    // server-stamp / preserve-merge) is vitest-authored, so it runs in the gate;
    // scoped to that dir because the other lambdas' tests use the `node:test`
    // runner and would break under vitest.
    include: [
      'src/**/*.{test,spec}.ts',
      'scripts/**/*.{test,spec}.mjs',
      'infrastructure/lambda/registry/**/*.{test,spec}.mjs',
    ],
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
