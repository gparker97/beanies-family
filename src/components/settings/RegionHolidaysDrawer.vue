<script setup lang="ts">
/**
 * Region & Holidays: the family's country, home time zone, weather and public holidays.
 * Split out of `SettingsPage.vue` (the way `WallSettingsDrawer.vue` was) when the Weather
 * group (#134) arrived.
 *
 * Every value here is family-wide and synced, so only a pod manager edits (`canManagePod`);
 * everyone else sees the values with the admin-only notice on top.
 *
 * The store setters toast a failed write and re-throw so a control can revert; the catches
 * below exist only so that rejection does not go unhandled. Each weather change is logged on
 * success (`weather_settings`) so "the wall stopped showing weather" can be traced from the
 * logs alone.
 */
import { computed, toRef } from 'vue';
import BaseCombobox from '@/components/ui/BaseCombobox.vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import HomeTownField from '@/components/settings/HomeTownField.vue';
import SettingToggleRow from '@/components/settings/SettingToggleRow.vue';
import SettingsAdminOnlyNotice from '@/components/settings/SettingsAdminOnlyNotice.vue';
import SettingsSectionLabel from '@/components/settings/SettingsSectionLabel.vue';
import { useCountryOptions } from '@/composables/useCountryOptions';
import { useFamilyDataAccess } from '@/composables/useFamilyDataAccess';
import { useTimeZoneOptions } from '@/composables/useTimeZoneOptions';
import { useToday } from '@/composables/useToday';
import { useTranslation } from '@/composables/useTranslation';
import { useHolidayStore } from '@/stores/holidayStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { logEvent } from '@/services/telemetry/logEvent';
import type { CountryCode, TemperatureUnit } from '@/types/models';

const props = defineProps<{ open: boolean }>();
defineEmits<{ close: [] }>();

const { t } = useTranslation();
const settingsStore = useSettingsStore();
const holidayStore = useHolidayStore();
const { canManagePod } = useFamilyDataAccess();

// ── Country + home time zone ───────────────────────────────────────────────
const { countryOptions } = useCountryOptions();
const { lastVisibleAt } = useToday();
// The Home Time Zone picker shows the RESOLVED zone, but nothing when it is only the
// device fallback (the placeholder says so). Re-evaluated on foreground: the device
// zone is not reactive, and a device may have crossed zones while backgrounded.
const homeTimeZoneModel = computed(() => {
  void lastVisibleAt.value;
  const resolved = settingsStore.resolveHomeTimeZoneNow();
  return resolved.source === 'device-fallback' ? '' : resolved.zone;
});
const { timeZoneOptions } = useTimeZoneOptions(
  computed(() => settingsStore.familyCountry),
  computed(() => homeTimeZoneModel.value || undefined),
  toRef(props, 'open')
);
// Shown when a holiday fetch has failed (transient network error with no cached
// fallback): informative, with recovery direction. The store's online watcher retries
// automatically.
const showHolidayRetryHint = computed(() => !!settingsStore.country && holidayStore.loadFailed);

async function onPickCountry(value: string) {
  try {
    await settingsStore.setCountry((value || null) as CountryCode | null);
  } catch {
    // persistDualSetting already surfaced this (toast + console.error) and
    // re-threw so the picker can revert its visual state; nothing more to do.
  }
}

async function onPickHomeTimeZone(value: string) {
  if (!value) return;
  try {
    await settingsStore.setHomeTimeZone(value);
  } catch {
    // persistAiSetting already surfaced this (toast + console.error) and re-threw so
    // the picker can revert its visual state; nothing more to do.
  }
}

async function onToggleShowPublicHolidays(show: boolean) {
  try {
    await settingsStore.setShowPublicHolidays(show);
  } catch {
    // persistAiSetting already surfaced this (toast + console.error); the toggle
    // reads the store value, so it reverts on its own.
  }
}

// ── Weather (#134) ─────────────────────────────────────────────────────────
// The unit is never printed beside a number ("55°"), so these two labels are the only
// place the letters appear; they are symbols, not words, and read the same in every language.
const unitOptions = [
  { value: 'F', label: '°F', variant: 'orange' as const },
  { value: 'C', label: '°C', variant: 'orange' as const },
];

function logWeatherSetting(kind: 'enabled' | 'unit', detail: string): void {
  logEvent({
    level: 'info',
    surface: 'weather',
    message: 'weather_settings',
    context: { action: 'settings', kind, detail },
  });
}

async function onToggleWeather(on: boolean) {
  try {
    await settingsStore.setWeatherEnabled(on);
    logWeatherSetting('enabled', on ? 'on' : 'off');
  } catch {
    // Already toasted by persistAiSetting; the switch reads the store value, so it reverts.
  }
}

async function onPickUnit(value: string) {
  // The pills have no disabled state of their own; the fieldset disables them, and this
  // guard keeps a non-manager from writing even if a click gets through.
  if (!canManagePod.value || (value !== 'F' && value !== 'C')) return;
  try {
    await settingsStore.setTemperatureUnit(value as TemperatureUnit);
    logWeatherSetting('unit', value);
  } catch {
    // Already toasted by persistAiSetting; the pills read the store value, so they revert.
  }
}
</script>

<template>
  <BeanieFormModal
    variant="drawer"
    :open="open"
    :title="t('settings.card.countryHolidays')"
    icon="🌍"
    icon-bg="var(--tint-silk-20)"
    :save-label="t('action.close')"
    @close="$emit('close')"
    @save="$emit('close')"
  >
    <SettingsAdminOnlyNotice v-if="!canManagePod" class="mb-1" />

    <BaseCombobox
      :model-value="settingsStore.country ?? ''"
      :options="countryOptions"
      :label="t('settings.country')"
      :hint="t('settings.countryHelp')"
      :placeholder="t('settings.countryNotSet')"
      :search-placeholder="t('settings.country')"
      :disabled="!canManagePod"
      @update:model-value="onPickCountry"
    />

    <BaseCombobox
      :model-value="homeTimeZoneModel"
      :options="timeZoneOptions"
      :label="t('settings.homeTimeZone')"
      :hint="t('settings.homeTimeZoneHelp')"
      :placeholder="t('settings.homeTimeZoneNotSet')"
      :search-placeholder="t('settings.homeTimeZone')"
      :disabled="!canManagePod"
      :clearable="false"
      @update:model-value="onPickHomeTimeZone"
    />

    <!-- Weather: family-wide. Off means no lookups at all; the town stays stored. -->
    <SettingsSectionLabel class="pt-2">{{ t('weather.title') }}</SettingsSectionLabel>
    <SettingToggleRow
      :model-value="settingsStore.weatherEnabled"
      :title="t('settings.weather.show')"
      :hint="
        settingsStore.weatherEnabled
          ? t('settings.weather.showHintOn')
          : t('settings.weather.showHintOff')
      "
      :disabled="!canManagePod"
      testid="weather-enabled-toggle"
      @update:model-value="onToggleWeather"
    />
    <template v-if="settingsStore.weatherEnabled">
      <FormFieldGroup :label="t('settings.weather.homeTown')">
        <HomeTownField
          :disabled="!canManagePod"
          :placeholder="t('settings.weather.homeTownPlaceholder')"
        />
        <p class="dark:text-ink-soft text-secondary-400 mt-1.5 text-xs">
          {{ t('settings.weather.homeTownHint') }}
        </p>
      </FormFieldGroup>
      <FormFieldGroup :label="t('settings.weather.unit')">
        <fieldset :disabled="!canManagePod" data-testid="weather-unit">
          <TogglePillGroup
            :model-value="settingsStore.temperatureUnit"
            :options="unitOptions"
            @update:model-value="onPickUnit"
          />
        </fieldset>
        <p class="dark:text-ink-soft text-secondary-400 mt-1.5 text-xs">
          {{ t('settings.weather.unitHint') }}
        </p>
      </FormFieldGroup>
    </template>

    <p v-if="showHolidayRetryHint" class="dark:text-ink-soft text-secondary-500 text-xs">
      {{ t('holiday.loadFailedRetryHint') }}
    </p>

    <!-- Show / hide public holidays on the planner -->
    <SettingToggleRow
      :model-value="settingsStore.showPublicHolidays"
      :title="t('settings.showPublicHolidays')"
      :disabled="!settingsStore.country || !canManagePod"
      testid="public-holidays-toggle"
      @update:model-value="onToggleShowPublicHolidays"
    >
      <p v-if="!settingsStore.country" class="dark:text-ink-soft text-secondary-400 text-xs">
        {{ t('settings.showPublicHolidaysNeedsCountry') }}
      </p>
    </SettingToggleRow>
  </BeanieFormModal>
</template>
