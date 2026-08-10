<script setup lang="ts">
/**
 * Global "we can't reach your family's data file" banner.
 *
 * The single renderer for `syncStore.podAccessError`. Mounted once in `App.vue`,
 * so a failure raised during load survives the transition off the login screen —
 * which is the point: the user is now inside the app, looking at data that isn't
 * saving anywhere.
 *
 * The most important case it renders is `CANONICAL_MISMATCH`: "you're working on
 * a copy of your family's file". Before 2026-08-10 the app could silently move a
 * member onto a private copy of the family pod, and there was no symptom at all
 * until someone noticed their to-dos never reached anyone else. This banner is
 * that missing symptom.
 *
 * Every recovery restores access to the ORIGINAL file. None of them creates one,
 * and none ever should — see `POD_ACCESS_ERRORS`.
 */
import { computed, ref } from 'vue';
import ErrorBanner from '@/components/common/ErrorBanner.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useSyncStore } from '@/stores/syncStore';
import { usePickBeanpodFile } from '@/composables/usePickBeanpodFile';
import { useGoogleReconnect } from '@/composables/useGoogleReconnect';
import { resolveErrorView } from '@/utils/structuredError';
import { POD_ACCESS_ERRORS, type PodRecoveryAction } from '@/utils/podAccess';
import type { UIStringKey } from '@/services/translation/uiStrings';

const { t } = useTranslation();
const syncStore = useSyncStore();
const { pick } = usePickBeanpodFile();
const { reconnect } = useGoogleReconnect();

/** Guards against a double-tap firing two Drive round-trips. */
const busy = ref(false);

const view = computed(() => resolveErrorView(POD_ACCESS_ERRORS, syncStore.podAccessError, t));

/**
 * `switchToCanonical` and `pickFamilyFile` differ only in where the fileId comes
 * from — both end in the same `rebindPodFile` call. One primitive, and it is
 * structurally incapable of creating a file or binding another family's pod.
 */
async function rebindTo(fileId: string, fileName: string): Promise<boolean> {
  const result = await syncStore.rebindPodFile(fileId, fileName);
  return result.ok;
}

async function pickFamilyFile(): Promise<void> {
  const picked = await pick();
  if (picked.kind !== 'picked') return; // cancelled, redirected, or pick failed
  await rebindTo(picked.fileId, picked.fileName);
}

async function switchToCanonical(): Promise<void> {
  const data = syncStore.podAccessError?.data;
  if (!data) return;
  const ok = await rebindTo(data.canonicalFileId, data.canonicalName);
  // A device that has never opened that file may not hold `drive.file` scope for
  // it, so the rebind can legitimately fail with FILE_NOT_FOUND. Fall back to the
  // picker, which grants scope as a side effect of the user choosing the file.
  if (!ok) await pickFamilyFile();
}

const handlers: Record<PodRecoveryAction, () => Promise<void>> = {
  retry: async () => {
    await syncStore.verifyPodAccess();
  },
  reconnectAccount: async () => {
    await reconnect();
    await syncStore.verifyPodAccess();
  },
  pickFamilyFile,
  switchToCanonical,
};

async function runRecovery(action: string): Promise<void> {
  const handler = handlers[action as PodRecoveryAction];
  if (!handler) {
    console.warn(`[PodAccessBanner] no handler for recovery action "${action}"`);
    return;
  }
  if (busy.value) return;
  busy.value = true;
  try {
    await handler();
  } catch (e) {
    // The handlers report their own failures through the store; this is the
    // last-resort guard so a throw can never leave the button stuck in `busy`.
    console.error(`[PodAccessBanner] recovery "${action}" threw:`, e);
  } finally {
    busy.value = false;
  }
}

function recoveryLabel(action: string): string {
  return t(`podAccess.recovery.${action}` as UIStringKey);
}
</script>

<template>
  <ErrorBanner
    :show="syncStore.shouldShowPodAccessBanner && view !== null"
    :severity="view?.severity === 'warning' ? 'notice' : 'critical'"
  >
    <template #title>{{ t('podAccess.bannerTitle') }}</template>
    <template #message>{{ view?.message }}</template>
    <template #actions>
      <!-- Neutral-on-colour, matching DurabilityBanner: BaseButton's red-on-white
           variants clash inside the coloured banner chrome. -->
      <button
        v-for="action in view?.recoveries ?? []"
        :key="action"
        :disabled="busy"
        class="rounded-lg bg-white/20 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/30 disabled:opacity-50"
        @click="runRecovery(action)"
      >
        {{ recoveryLabel(action) }}
      </button>
    </template>
  </ErrorBanner>
</template>
