/**
 * The generate → show → confirm-stored flow for a NEW recovery kit (2026-09-23).
 *
 * Extracted from the near-identical copies in `RecoverySettings.vue` and the kit nag
 * (`RecoveryKitPromptModal.vue`), and shared with the sign-out kit guard
 * (`SignOutKitGuard.vue`). Each call returns its OWN state, and every consumer gets a
 * fresh instance when it mounts, so there is no reset.
 *
 * Kits ACCUMULATE: `createRecoveryKit` adds a wrap and nothing removes one (until tracker
 * #99), so a new kit never switches off an older stored one.
 *
 * `confirmStored` returns whether the confirmation actually reached the family file. The
 * sign-out guard continues ONLY when it did: a kit that exists only in memory, followed by
 * a sign-out that drops this device's keys, would open nothing on Drive. `retrySync`
 * re-pushes the same kit; it never mints another one.
 */
import { ref } from 'vue';
import { useAuthStore } from '@/stores/authStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useSyncStore } from '@/stores/syncStore';
import { useTranslation } from '@/composables/useTranslation';
import { emitKitConfirmNotSynced } from '@/services/telemetry/loginFlowEvents';

export function useRecoveryKitFlow() {
  const { t } = useTranslation();
  const authStore = useAuthStore();
  const settingsStore = useSettingsStore();
  const syncStore = useSyncStore();

  const kitCode = ref('');
  const kitId = ref('');
  const showKit = ref(false);
  const isGenerating = ref(false);
  /**
   * True for the whole of `confirmStored` (review R2-F9, carried over from the nag): a host
   * must not show its intro again while this is true, or a second tap mints another kit.
   */
  const isConfirming = ref(false);
  /** The kit is confirmed locally but has not reached the family file yet. */
  const unsynced = ref(false);
  const error = ref<string | null>(null);

  async function generate(): Promise<void> {
    error.value = null;
    unsynced.value = false;
    isGenerating.value = true;
    try {
      // createRecoveryKit never throws and reports `kit_generate_failed` itself.
      const result = await authStore.createRecoveryKit();
      if (!result.success) {
        error.value = result.error;
        return;
      }
      kitCode.value = result.code;
      kitId.value = result.kitId;
      showKit.value = true;
    } finally {
      isGenerating.value = false;
    }
  }

  function markNotSynced(): void {
    unsynced.value = true;
    error.value = t('recovery.kitNotSynced');
    emitKitConfirmNotSynced();
  }

  /** Record the confirmation and push it. Returns whether it reached the family file. */
  async function confirmStored(via: 'saved' | 'acknowledged'): Promise<boolean> {
    isConfirming.value = true;
    try {
      // The one-time code leaves memory with the modal.
      kitCode.value = '';
      showKit.value = false;
      // Never throws (reports `kit_confirm_stamp_failed` itself).
      await settingsStore.markRecoveryKitConfirmed(via);
      const durable = await syncStore.syncNowBounded();
      if (!durable) markNotSynced();
      return durable;
    } finally {
      isConfirming.value = false;
    }
  }

  /** Re-push the kit and stamp already in the local doc. Never mints a kit. */
  async function retrySync(): Promise<boolean> {
    isConfirming.value = true;
    try {
      const durable = await syncStore.syncNowBounded();
      if (durable) {
        unsynced.value = false;
        error.value = null;
      } else {
        markNotSynced();
      }
      return durable;
    } finally {
      isConfirming.value = false;
    }
  }

  return {
    kitCode,
    kitId,
    showKit,
    isGenerating,
    isConfirming,
    unsynced,
    error,
    generate,
    confirmStored,
    retrySync,
  };
}
