/**
 * Test-only stub for the `virtual:pwa-register/vue` module that vite-plugin-pwa
 * injects at build time but which doesn't exist under vitest. Aliased in
 * `vitest.config.ts` so any test that imports the PWA register layer resolves.
 * Tests that need to drive behavior override this with `vi.mock(...)`.
 */
import { ref, type Ref } from 'vue';

export function useRegisterSW(_options?: {
  immediate?: boolean;
  onRegisteredSW?: (swUrl: string, registration: ServiceWorkerRegistration | undefined) => void;
  onRegisterError?: (error: unknown) => void;
}): {
  needRefresh: Ref<boolean>;
  offlineReady: Ref<boolean>;
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
} {
  return {
    needRefresh: ref(false),
    offlineReady: ref(false),
    updateServiceWorker: async () => {},
  };
}
