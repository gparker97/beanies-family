import { defineStore } from 'pinia';
import { ref } from 'vue';

/**
 * Single source of truth for the canonical "spilled beans" fatal-error
 * overlay (rendered by `App.vue` at lines 1005-1103).
 *
 * Any layer that detects an unrecoverable state — pod-file corruption on
 * load, init completed with no doc, etc. — calls `setFatal(message, detail)`
 * and the overlay surfaces with the user-facing message + a copy-diagnostic
 * `<details>` block for support.
 *
 * Before this store, `initError` was a local ref inside `App.vue`, so the
 * only way to trigger the overlay from outside `App.vue` was to add a prop-
 * drilling chain (e.g. ResumePodSetup → LoginPage → router → App). The store
 * keeps the overlay's contract testable independently of the UI tree.
 *
 * `App.vue` continues to set the values directly during init for its own
 * health-check paths; this store layer is additive and doesn't replace
 * those write sites.
 */
export const useFatalErrorStore = defineStore('fatalError', () => {
  const message = ref<string | null>(null);
  const detail = ref<string | null>(null);

  function setFatal(msg: string, diagnosticDetail?: string | null): void {
    message.value = msg;
    detail.value = diagnosticDetail ?? null;
  }

  function clear(): void {
    message.value = null;
    detail.value = null;
  }

  return {
    message,
    detail,
    setFatal,
    clear,
  };
});
