<script setup lang="ts">
/**
 * Beanie Wall Settings: the wall's own preferences for this device, opened from the Beanie
 * Wall card so the card stays a short "what it is and start it".
 *
 * Night mode on its own is the first section, then the weather card's size on this wall
 * (#134); anything else that only concerns the wall (a photo mode for the night screen, say)
 * belongs here too. Everything is per device
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
import SettingsSectionLabel from '@/components/settings/SettingsSectionLabel.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useSettingsStore } from '@/stores/settingsStore';
import { logEvent } from '@/services/telemetry/logEvent';
import { fillTemplate } from '@/utils/fillTemplate';
import { WALL_SLEEP_IDLE_OPTIONS } from '@/utils/wallSleep';
import type { WallSleepSettings, WallWeatherStyle } from '@/types/models';

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

const weatherStyle = computed(() => settingsStore.wallWeatherStyle);
const WEATHER_STYLES: readonly WallWeatherStyle[] = ['large', 'small', 'off'];
const weatherOptions = computed(() =>
  WEATHER_STYLES.map((style) => ({
    value: style,
    variant: 'orange' as const,
    label: t(`wall.weather.${style}`),
  }))
);
const weatherStyleHint = computed(() => t(`wall.weather.${weatherStyle.value}Hint`));

/** What changed: a night-mode field, or the weather card's size on this wall. */
type WallSettingKind = keyof WallSleepSettings | 'wall-style';

/**
 * One try/log path for every write in this drawer. Sleep fields keep their
 * `wall_sleep_change` message; the weather style logs `weather_settings` (the #134 event,
 * under this drawer's surface) with the chosen style as `detail`.
 */
async function updateWall(kind: WallSettingKind, write: () => Promise<unknown>, detail?: string) {
  try {
    await write();
    logEvent({
      level: 'info',
      surface: 'wall-settings',
      message: kind === 'wall-style' ? 'weather_settings' : 'wall_sleep_change',
      context: { action: 'settings', kind, ...(detail ? { detail } : {}) },
    });
  } catch {
    // Already toasted and reported by `persistGlobalSetting`.
  }
}

const updateSleep = (field: keyof WallSleepSettings, patch: Partial<WallSleepSettings>) =>
  updateWall(field, () => settingsStore.setWallSleep(patch));

function updateWeatherStyle(value: string) {
  const style = WEATHER_STYLES.find((s) => s === value);
  if (!style) return;
  void updateWall('wall-style', () => settingsStore.setWallWeather(style), style);
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
    <SettingsSectionLabel>{{ t('wall.settings.nightSection') }}</SettingsSectionLabel>
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
    <SettingsSectionLabel class="pt-2">{{ t('weather.title') }}</SettingsSectionLabel>
    <FormFieldGroup :label="t('wall.weather.size')">
      <TogglePillGroup
        :model-value="weatherStyle"
        :options="weatherOptions"
        data-testid="wall-weather-style"
        @update:model-value="updateWeatherStyle"
      />
      <p class="text-secondary-400 dark:text-ink-soft mt-1.5 text-xs">
        {{ weatherStyleHint }}
      </p>
    </FormFieldGroup>
    <p class="text-secondary-400 dark:text-ink-soft text-xs">
      {{ t('wall.weather.sizeHint') }}
    </p>
    <p class="text-secondary-400 dark:text-ink-soft mt-4 text-xs">
      {{ t('wall.sleep.deviceOnly') }}
    </p>
  </BeanieFormModal>
</template>
