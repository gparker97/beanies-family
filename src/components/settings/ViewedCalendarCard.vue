<script setup lang="ts">
/**
 * One view-only calendar in Settings -> Google Calendar (view-only calendars plan
 * 2026-11-17, B).
 *
 * A view: it renders one `ViewedCalendar` and emits intents. The drawer
 * (`CalendarSyncSettings`) owns the confirm, the store calls and the permission
 * rules, and passes the outcome in as props. It renders in the shared
 * `CalendarCardShell`; `open` is the drawer's (which rows start open is a
 * whole-drawer rule).
 *  - `canManage`: add, remove and settings changes need `canManagePod`. Without it
 *    the card is read-only (controls disabled, no Disconnect).
 *  - `canReconnect`: the existing `canViewerRepair` rule, so Reconnect is offered
 *    only to someone who can finish the account-bound sign-in.
 *
 * Every intent is also refused here, not only by a `disabled` attribute: a DOM
 * attribute is presentation, and a read-only card must not emit.
 */
import { computed, useId } from 'vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import CalendarCardShell from '@/components/settings/CalendarCardShell.vue';
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import ColorCircleSelector from '@/components/ui/ColorCircleSelector.vue';
import ToggleRow from '@/components/ui/ToggleRow.vue';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
import { VIEW_CALENDAR_PALETTE } from '@/utils/calendar/externalEvents';
import type { ViewedCalendarSettingsPatch } from '@/stores/calendarViewStore';
import type { UIStringKey } from '@/services/translation/uiStrings';
import type { ViewedCalendar, ViewedCalendarDetailLevel } from '@/types/models';
import type { ViewCalendarState } from '@/types/externalEvents';

const props = withDefaults(
  defineProps<{
    calendar: ViewedCalendar;
    /** The view account's email; `null` when its record is gone (removed on another device). */
    accountEmail: string | null;
    /** Per-device health from `calendarViewStore.calendarState`; `null` before the first read. */
    state: ViewCalendarState | null;
    canManage: boolean;
    canReconnect: boolean;
    /** The action running on this card, if any (its button spins, the others wait). */
    busyAction?: 'reconnect' | 'disconnect' | null;
  }>(),
  { busyAction: null }
);

const emit = defineEmits<{
  update: [patch: ViewedCalendarSettingsPatch];
  disconnect: [];
  reconnect: [];
}>();

const open = defineModel<boolean>('open', { default: false });

const { t } = useTranslation();

/** A free/busy calendar never shares titles: the detail level is fixed to busy only. */
const busyLocked = computed(() => props.calendar.accessRole === 'freeBusyReader');
const detailLevel = computed<ViewedCalendarDetailLevel>(() =>
  busyLocked.value ? 'busy' : props.calendar.detailLevel
);
const controlsDisabled = computed(() => !props.canManage || props.busyAction !== null);

const detailOptions = computed(() => [
  { value: 'details', label: t('calendarView.card.showDetails') },
  { value: 'busy', label: t('calendarView.card.busyOnly') },
]);
const colorOptions = VIEW_CALENDAR_PALETTE.map((value) => ({ value }));
const colorLabelId = useId();

const sharedWith = computed(() =>
  props.accountEmail
    ? fillTemplate(t('calendarView.card.sharedWith'), { email: props.accountEmail })
    : ''
);

/**
 * The one inline state line inside the open card. Only a lapsed sign-in carries a
 * recovery of its own (Reconnect); a calendar that is no longer shared is removed
 * with the Disconnect already in the action row, so it is never offered twice.
 */
const stateLine = computed<{ key: UIStringKey; reconnect: boolean } | null>(() => {
  switch (props.state) {
    case 'unavailable':
      return { key: 'calendarView.card.state.unavailable', reconnect: false };
    case 'needs_reconnect':
      return { key: 'calendarView.card.state.needsReconnect', reconnect: props.canReconnect };
    case 'stale':
      return { key: 'calendarView.card.state.stale', reconnect: false };
    case 'truncated':
      return { key: 'calendarView.card.state.truncated', reconnect: false };
    default:
      return null;
  }
});

/**
 * The closed row's pill. A lost or lapsed calendar says so without being opened; a
 * stale or very busy one is still connected, and explains itself inside.
 */
const status = computed<{ key: UIStringKey; attention: boolean }>(() => {
  switch (props.state) {
    case 'unavailable':
      return { key: 'calendarView.card.status.unavailable', attention: true };
    case 'needs_reconnect':
      return { key: 'calendarView.card.status.needsReconnect', attention: true };
    default:
      return { key: 'calendarView.card.connected', attention: false };
  }
});

function update(patch: ViewedCalendarSettingsPatch): void {
  if (controlsDisabled.value) return;
  emit('update', patch);
}

function onDetail(value: string): void {
  if (busyLocked.value) return;
  if (value !== 'details' && value !== 'busy') return;
  if (value === detailLevel.value) return;
  update({ detailLevel: value });
}

function onColor(value: string): void {
  if (value === props.calendar.color) return;
  update({ color: value });
}

function onDisconnect(): void {
  if (!props.canManage || props.busyAction !== null) return;
  emit('disconnect');
}

function onReconnect(): void {
  if (!props.canReconnect || props.busyAction !== null) return;
  emit('reconnect');
}
</script>

<template>
  <CalendarCardShell
    v-model:open="open"
    :name="calendar.name"
    :account="sharedWith"
    :status-label="t(status.key)"
    :status-tone="status.attention ? 'attention' : 'neutral'"
    :dot-color="calendar.color"
    :data-testid="`viewed-calendar-${calendar.id}`"
  >
    <!-- A fieldset disables every control at once for a read-only member; the
         handlers above refuse as well. Order: detail level, the two switches, then
         Color (the least important, typeset like the switch labels). -->
    <fieldset :disabled="controlsDisabled" class="m-0 min-w-0 space-y-3 border-0 p-0">
      <div class="space-y-1">
        <TogglePillGroup
          :model-value="detailLevel"
          :options="detailOptions"
          data-testid="viewed-calendar-detail"
          @update:model-value="onDetail"
        />
        <p
          v-if="busyLocked"
          class="text-secondary-400 dark:text-ink-faint text-xs"
          data-testid="viewed-calendar-busy-locked"
        >
          {{ t('calendarView.card.busyLocked') }}
        </p>
      </div>

      <ToggleRow
        :model-value="calendar.inBriefing"
        :title="t('calendarView.card.inBriefing')"
        :disabled="controlsDisabled"
        testid="viewed-calendar-briefing"
        @update:model-value="update({ inBriefing: $event })"
      />
      <ToggleRow
        :model-value="calendar.inWidgets"
        :title="t('calendarView.card.inWidgets')"
        :hint="t('calendarView.card.inWidgetsHint')"
        :disabled="controlsDisabled"
        testid="viewed-calendar-widgets"
        @update:model-value="update({ inWidgets: $event })"
      />

      <!-- The label uses ToggleRow's title type, so Color reads as one more option.
           The swatches sit on the right while they fit beside it; on a narrow drawer
           the whole set drops under the label as one row instead of splitting. -->
      <div
        class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
        data-testid="viewed-calendar-color-row"
      >
        <p
          :id="colorLabelId"
          class="font-outfit dark:text-ink shrink-0 text-sm font-semibold text-[var(--color-text)]"
        >
          {{ t('calendarView.card.colorLabel') }}
        </p>
        <div role="group" :aria-labelledby="colorLabelId" class="max-w-full flex-none">
          <ColorCircleSelector
            :model-value="calendar.color"
            :colors="colorOptions"
            data-testid="viewed-calendar-color"
            @update:model-value="onColor"
          />
        </div>
      </div>
    </fieldset>

    <!-- Unhealthy: one line in Heritage Orange (never red), at most one recovery. -->
    <div
      v-if="stateLine"
      class="flex flex-wrap items-center gap-2"
      data-testid="viewed-calendar-state"
    >
      <p class="text-primary-700 dark:text-accent-lift min-w-0 flex-1 text-sm font-medium">
        {{ t(stateLine.key) }}
      </p>
      <BaseButton
        v-if="stateLine.reconnect"
        variant="primary"
        size="sm"
        :loading="busyAction === 'reconnect'"
        :disabled="busyAction !== null"
        data-testid="viewed-calendar-reconnect"
        @click="onReconnect"
      >
        {{ t('calendarSync.action.reconnect') }}
      </BaseButton>
    </div>

    <template v-if="canManage" #actions>
      <BaseButton
        variant="outline"
        size="sm"
        :loading="busyAction === 'disconnect'"
        :disabled="busyAction !== null"
        data-testid="viewed-calendar-disconnect"
        @click="onDisconnect"
      >
        {{ t('calendarSync.action.disconnect') }}
      </BaseButton>
    </template>
  </CalendarCardShell>
</template>
