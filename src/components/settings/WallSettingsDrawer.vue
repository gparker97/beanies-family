<script setup lang="ts">
/**
 * Beanie Wall Settings: the wall's own preferences for this device, opened from the Beanie
 * Wall card so the card stays a short "what it is and start it".
 *
 * Night mode on its own is the first section; anything else that only concerns the wall (a
 * photo mode for the night screen, say) belongs here too. Everything is per device
 * (`GlobalSettings.wall`), because the wall is a device on a wall, not a family preference.
 *
 * The store toasts a failed write and re-throws; the catch is only so the rejection does not
 * go unhandled. Success is logged so a confusing change ("the wall went dark at 8") can be
 * traced from the logs.
 */
import { computed } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import BeanieTimeInput from '@/components/ui/BeanieTimeInput.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import SettingToggleRow from '@/components/settings/SettingToggleRow.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useSettingsStore } from '@/stores/settingsStore';
import { logEvent } from '@/services/telemetry/logEvent';
import { fillTemplate } from '@/utils/fillTemplate';
import { WALL_SLEEP_IDLE_OPTIONS } from '@/utils/wallSleep';
import type { WallSleepSettings } from '@/types/models';

defineProps<{ open: boolean }>();
defineEmits<{ close: [] }>();

const { t } = useTranslation();
const settingsStore = useSettingsStore();

const sleep = computed(() => settingsStore.wallSleep);
const idleOptions = computed(() =>
  WALL_SLEEP_IDLE_OPTIONS.map((n) => ({
    value: String(n),
    variant: 'orange' as const,
    label: n === 60 ? t('wall.sleep.idle.hour') : fillTemplate(t('wall.sleep.idle.minutes'), { n }),
  }))
);

async function updateSleep(field: keyof WallSleepSettings, patch: Partial<WallSleepSettings>) {
  try {
    await settingsStore.setWallSleep(patch);
    logEvent({
      level: 'info',
      surface: 'wall-settings',
      message: 'wall_sleep_change',
      context: { action: 'settings', kind: field },
    });
  } catch {
    // Already toasted and reported by `persistGlobalSetting`.
  }
}
</script>

<template>
  <BeanieFormModal
    variant="drawer"
    :open="open"
    :title="t('wall.settings.title')"
    icon="🧱"
    icon-bg="var(--tint-orange-8)"
    :save-label="t('action.close')"
    @close="$emit('close')"
    @save="$emit('close')"
  >
    <p
      class="font-outfit dark:text-ink-faint text-xs font-bold tracking-[0.1em] text-[var(--deep-slate)] uppercase"
    >
      {{ t('wall.settings.nightSection') }}
    </p>
    <SettingToggleRow
      :model-value="sleep.enabled"
      :title="t('wall.sleep.auto')"
      :hint="t('wall.sleep.autoHint')"
      testid="wall-sleep-toggle"
      @update:model-value="updateSleep('enabled', { enabled: $event })"
    />
    <div v-if="sleep.enabled" class="space-y-4 pb-1">
      <div class="grid grid-cols-2 gap-3">
        <FormFieldGroup :label="t('wall.sleep.starts')">
          <BeanieTimeInput
            :model-value="sleep.startTime"
            @update:model-value="updateSleep('startTime', { startTime: $event })"
          />
        </FormFieldGroup>
        <FormFieldGroup :label="t('wall.sleep.ends')">
          <BeanieTimeInput
            :model-value="sleep.endTime"
            @update:model-value="updateSleep('endTime', { endTime: $event })"
          />
        </FormFieldGroup>
      </div>
      <FormFieldGroup :label="t('wall.sleep.idle')">
        <TogglePillGroup
          :model-value="String(sleep.idleMinutes)"
          :options="idleOptions"
          @update:model-value="updateSleep('idleMinutes', { idleMinutes: Number($event) })"
        />
      </FormFieldGroup>
    </div>
    <p class="text-secondary-400 dark:text-ink-soft mt-4 text-xs">
      {{ t('wall.sleep.deviceOnly') }}
    </p>
  </BeanieFormModal>
</template>
