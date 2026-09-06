import { defineStore } from 'pinia';
import type { UIStringKey } from '@/services/translation/uiStrings';
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
/** A way out of a fatal, rendered as a link and as selectable text. */
export interface FatalActionLink {
  labelKey: UIStringKey;
  /** http(s) only; screened again at the render site before it becomes an href. */
  url: string;
}

export const useFatalErrorStore = defineStore('fatalError', () => {
  const message = ref<string | null>(null);
  const detail = ref<string | null>(null);
  /**
   * Would "Clear data and start fresh" help?
   *
   * For most fatals, yes. For a PAYLOAD failure, no: an out-of-memory open
   * leaves the file completely intact, and clearing is the one action that
   * destroys the local copy — including edits that may never have reached
   * Drive. The overlay's standing copy ("You can try reloading, or clear your
   * data and start fresh") and its Clear-data button are wrong there, so the
   * setter has to be able to say so. Defaults to `true`, which is the existing
   * behaviour for every caller that does not pass it.
   */
  const clearDataHelps = ref(true);

  /**
   * An optional way OUT of this fatal, as a link.
   *
   * ⚠️ DATA, NEVER A CALLBACK. A `run: () => void` here would make the app's
   * payload chokepoint (`payloadFailureSurface.ts`) import the update
   * composable, and through it a native plugin, to hand this store a closure.
   * It would also need `markRaw` to stop Vue proxying it, would be opaque in
   * devtools and unserialisable, and would hold its closure scope alive for as
   * long as the fatal state. A `url` crosses the boundary as one string.
   *
   * The same `url` is rendered BOTH as the button and as selectable text
   * beneath it, so the two cannot point at different places, which is what
   * makes "never a dead end" structurally true rather than carefully
   * maintained.
   */
  const action = ref<FatalActionLink | null>(null);

  function setFatal(
    msg: string,
    diagnosticDetail?: string | null,
    opts?: { clearDataHelps?: boolean; action?: FatalActionLink | null }
  ): void {
    message.value = msg;
    detail.value = diagnosticDetail ?? null;
    clearDataHelps.value = opts?.clearDataHelps ?? true;
    // ⚠️ ASSIGNED ON EVERY CALL, exactly as `clearDataHelps` is, and for the
    // same reason. `surfaceLineageFatal` passes no action; without this reset a
    // store link from an earlier needs-update fatal would survive into a
    // lineage block that has nothing to do with the store.
    action.value = opts?.action ?? null;
  }

  function clear(): void {
    message.value = null;
    detail.value = null;
    clearDataHelps.value = true;
    action.value = null;
  }

  return {
    message,
    detail,
    clearDataHelps,
    action,
    setFatal,
    clear,
  };
});
