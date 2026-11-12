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
import BeanieTimePicker from '@/components/ui/BeanieTimePicker.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import SettingToggleRow from '@/components/settings/SettingToggleRow.vue';
import SettingsSectionLabel from '@/components/settings/SettingsSectionLabel.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useSettingsStore } from '@/stores/settingsStore';
import { logEvent } from '@/services/telemetry/logEvent';
import { fillTemplate } from '@/utils/fillTemplate';
import { WALL_SLEEP_IDLE_OPTIONS } from '@/utils/wallSleep';
import {
  WALL_MEMORY_BRIGHTNESS_LEVELS,
  WALL_MEMORY_TYPES,
  WALL_SLIDESHOW_MODES,
  WALL_SLIDESHOW_SPEEDS,
} from '@/utils/wallMemories';
import type { ScrapType, WallSleepSettings, WallWeatherStyle } from '@/types/models';

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

/** What changed: a night-mode field, the weather card's size, or a Family Memories control. */
type WallMemoriesKind =
  | 'viewer'
  | 'slideshow'
  | 'brightness'
  | 'speed'
  | 'type-milestone'
  | 'type-favorite'
  | 'type-saying'
  | 'type-note';
type WallSettingKind = keyof WallSleepSettings | 'wall-style' | WallMemoriesKind;

function messageFor(kind: WallSettingKind): string {
  if (kind === 'wall-style') return 'weather_settings';
  if (
    kind === 'viewer' ||
    kind === 'slideshow' ||
    kind === 'brightness' ||
    kind === 'speed' ||
    kind.startsWith('type-')
  )
    return 'wall_memories_change';
  return 'wall_sleep_change';
}

/**
 * One try/log path for every write in this drawer. Sleep fields keep their
 * `wall_sleep_change` message; the weather style logs `weather_settings` (the #134 event,
 * under this drawer's surface) with the chosen style as `detail`; Family Memories controls
 * log `wall_memories_change` with `kind` = the control and `detail` = the new value.
 */
async function updateWall(kind: WallSettingKind, write: () => Promise<unknown>, detail?: string) {
  try {
    await write();
    logEvent({
      level: 'info',
      surface: 'wall-settings',
      message: messageFor(kind),
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

const memories = computed(() => settingsStore.wallMemories);
const slideshowOptions = computed(() =>
  WALL_SLIDESHOW_MODES.map((m) => ({
    value: m,
    variant: 'orange' as const,
    label: t(`settings.wall.memories.slideshow.${m}`),
  }))
);
const brightnessOptions = computed(() =>
  WALL_MEMORY_BRIGHTNESS_LEVELS.map((b) => ({
    value: b,
    variant: 'orange' as const,
    label: t(`settings.wall.memories.brightness.${b}`),
  }))
);
const speedOptions = computed(() =>
  WALL_SLIDESHOW_SPEEDS.map((s) => ({
    value: s,
    variant: 'orange' as const,
    label: t(`settings.wall.memories.speed.${s}`),
  }))
);
/** Nothing reads the type switches while both the viewer and the slideshow are off. */
const showTypes = computed(() => memories.value.viewer || memories.value.slideshow !== 'off');

function updateViewer(on: boolean) {
  void updateWall('viewer', () => settingsStore.setWallMemories({ viewer: on }), String(on));
}
function updateType(type: ScrapType, on: boolean) {
  void updateWall(`type-${type}`, () => settingsStore.setWallMemoryType(type, on), String(on));
}
function updateSlideshow(value: string) {
  const slideshow = WALL_SLIDESHOW_MODES.find((m) => m === value);
  if (!slideshow) return;
  void updateWall('slideshow', () => settingsStore.setWallMemories({ slideshow }), slideshow);
}
function updateBrightness(value: string) {
  const brightness = WALL_MEMORY_BRIGHTNESS_LEVELS.find((b) => b === value);
  if (!brightness) return;
  void updateWall('brightness', () => settingsStore.setWallMemories({ brightness }), brightness);
}
function updateSpeed(value: string) {
  const speed = WALL_SLIDESHOW_SPEEDS.find((s) => s === value);
  if (!speed) return;
  void updateWall('speed', () => settingsStore.setWallMemories({ speed }), speed);
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
          <BeanieTimePicker
            :model-value="sleep.startTime"
            @update:model-value="updateSleep('startTime', { startTime: $event })"
          />
        </FormFieldGroup>
        <FormFieldGroup :label="t('wall.sleep.ends')">
          <BeanieTimePicker
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
    <SettingsSectionLabel class="pt-2">{{
      t('settings.wall.memories.section')
    }}</SettingsSectionLabel>
    <SettingToggleRow
      :model-value="memories.viewer"
      :title="t('settings.wall.memories.viewer')"
      :hint="t('settings.wall.memories.viewerHint')"
      testid="wall-memories-viewer"
      @update:model-value="updateViewer"
    />
    <FormFieldGroup v-if="showTypes" :label="t('settings.wall.memories.show')">
      <SettingToggleRow
        v-for="type in WALL_MEMORY_TYPES"
        :key="type"
        :model-value="memories.show[type]"
        :title="t(`settings.wall.memories.type.${type}`)"
        :testid="`wall-memories-type-${type}`"
        @update:model-value="updateType(type, $event)"
      />
    </FormFieldGroup>
    <FormFieldGroup :label="t('settings.wall.memories.slideshow')">
      <TogglePillGroup
        :model-value="memories.slideshow"
        :options="slideshowOptions"
        data-testid="wall-memories-slideshow"
        @update:model-value="updateSlideshow"
      />
    </FormFieldGroup>
    <FormFieldGroup
      v-if="memories.slideshow !== 'off'"
      :label="t('settings.wall.memories.brightness')"
    >
      <TogglePillGroup
        :model-value="memories.brightness"
        :options="brightnessOptions"
        data-testid="wall-memories-brightness"
        @update:model-value="updateBrightness"
      />
    </FormFieldGroup>
    <FormFieldGroup v-if="memories.slideshow !== 'off'" :label="t('settings.wall.memories.speed')">
      <TogglePillGroup
        :model-value="memories.speed"
        :options="speedOptions"
        data-testid="wall-memories-speed"
        @update:model-value="updateSpeed"
      />
    </FormFieldGroup>
    <p class="font-caveat text-primary-700 dark:text-accent-lift text-lg">
      {{ t('settings.wall.memories.hint') }}
    </p>
    <p class="text-secondary-400 dark:text-ink-soft mt-4 text-xs">
      {{ t('wall.sleep.deviceOnly') }}
    </p>
  </BeanieFormModal>
</template>
