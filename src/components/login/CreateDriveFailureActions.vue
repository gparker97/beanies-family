<script setup lang="ts">
/**
 * The recovery stack for a create-flow Google Drive failure: the ONE place it renders, shared by
 * CreatePodView's result modal and ResumePodSetup's `storage` / `drive-declined` notice.
 *
 * Presentational. The host owns the message (`createDriveFailureMessage`) and the
 * three handlers that change its own state (`retry`, `chooseAccount`, `useLocal`); the registry
 * (`createDriveRecoveries`) decides which recoveries apply on this device; this component owns
 * their labels, the two that need no host state (`getApp`, the help link), and the one tap event
 * per recovery.
 *
 * ⚠️ NEVER ON THE RESUME PROBE'S `retry` PHASE. That phase sits beside a pod the registry already
 * knows; "use a local file" or "use a different account" there would start a second pod beside it
 * (the 2026-05-15 orphan incident). The probe arm takes only the registry's message.
 */
import { computed } from 'vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import { useTranslation } from '@/composables/useTranslation';
import { canUseLocalFiles } from '@/services/sync/capabilities';
import {
  createDriveRecoveries,
  type CreateDriveErrorCode,
  type CreateDriveRecovery,
} from '@/services/sync/createDriveErrors';
import { logEvent } from '@/services/telemetry';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { HELP_PATHS, openHelpArticle } from '@/utils/helpLinks';
import { MARKETING_URL } from '@/utils/marketing';
import { openExternal } from '@/utils/openExternal';

const props = defineProps<{
  code: CreateDriveErrorCode;
  /** The host's in-flight latch: every recovery waits for the current attempt to settle. */
  disabled?: boolean;
  /** Passed through to `createDriveRecoveries` (see there). */
  alwaysOfferLocal?: boolean;
}>();

const emit = defineEmits<{
  retry: [];
  chooseAccount: [];
  useLocal: [];
}>();

const { t } = useTranslation();

/** A `Record`, so a new recovery fails the build here until it has a label. */
const LABELS: Record<CreateDriveRecovery, UIStringKey> = {
  retry: 'action.tryAgain',
  chooseAccount: 'join.recovery.signInDifferentAccount',
  useLocal: 'storage.useLocalInstead',
  getApp: 'createPod.driveError.getApp',
};

/** Which recoveries apply is the registry's decision (`createDriveRecoveries`); this only renders. */
const recoveries = computed(() =>
  createDriveRecoveries(props.code, canUseLocalFiles(), {
    alwaysOfferLocal: props.alwaysOfferLocal,
  })
);

function handleRecovery(action: CreateDriveRecovery) {
  logEvent({
    level: 'info',
    surface: 'create-drive-failure',
    message: 'recovery tapped',
    context: { action, error_code: props.code },
  });
  switch (action) {
    case 'retry':
      emit('retry');
      return;
    case 'chooseAccount':
      emit('chooseAccount');
      return;
    case 'useLocal':
      emit('useLocal');
      return;
    case 'getApp':
      // The marketing download page: native keeps the family file on the device, which this
      // browser cannot. Absolute and through `openExternal`, as every cross-origin link must be.
      openExternal(`${MARKETING_URL}/download`);
      return;
  }
}

function handleHelp() {
  openHelpArticle(HELP_PATHS.connectingGoogleDrive, 'create-drive-failure');
}
</script>

<template>
  <div class="space-y-2">
    <BaseButton
      v-for="action in recoveries"
      :key="action"
      :variant="action === 'retry' ? 'primary' : 'outline'"
      class="w-full"
      :disabled="disabled"
      :data-recovery="action"
      @click="handleRecovery(action)"
    >
      {{ t(LABELS[action]) }}
    </BaseButton>
    <div class="pt-1 text-center">
      <button
        type="button"
        class="font-outfit text-secondary-500 hover:text-secondary-600 dark:text-ink-faint dark:hover:text-ink cursor-pointer text-sm underline decoration-1 underline-offset-4 transition-colors"
        data-recovery="help"
        @click="handleHelp"
      >
        {{ t('createPod.driveError.help') }}
      </button>
    </div>
  </div>
</template>
