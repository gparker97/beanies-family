<script setup lang="ts">
/**
 * The read-only details a view-only external event opens (plan 2026-11-17, C1), the
 * sibling of `HolidayDetailsModal` and `BirthdayDetailsModal`: the event lives in
 * someone's Google Calendar, so there is nothing here to edit, delete, drag or resize.
 *
 * Shows the title (or "Busy"), the source (hollow dot + calendar name), when, where (a
 * details calendar only; a busy-only event has had its location stripped), a quiet note
 * saying where the event lives (the busy-only variant says the calendar shares busy
 * times only), and "Open in Google Calendar" through `openExternal`, only when the host
 * allows it (`showGoogleLink`: false on the beanie wall, a locked kiosk) and Google gave
 * the event a link.
 */
import { computed } from 'vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import ExternalSourceLabel from '@/components/planner/ExternalSourceLabel.vue';
import { useTranslation } from '@/composables/useTranslation';
import { externalEventTitle, externalWhenLabel } from '@/utils/calendar/externalDisplay';
import { openExternal } from '@/utils/openExternal';
import type { ExternalEvent } from '@/types/externalEvents';

const props = withDefaults(
  defineProps<{
    event: ExternalEvent | null;
    open: boolean;
    showGoogleLink?: boolean;
  }>(),
  { showGoogleLink: true }
);
const emit = defineEmits<{ close: [] }>();

const { t } = useTranslation();

const title = computed(() => (props.event ? externalEventTitle(props.event, t) : ''));
const when = computed(() => (props.event ? externalWhenLabel(props.event, t) : ''));
const where = computed(() => (props.event?.busyOnly ? '' : (props.event?.location ?? '')));
const linkHref = computed(() =>
  props.showGoogleLink && props.event?.htmlLink ? props.event.htmlLink : ''
);

function openInGoogle(): void {
  // Synchronously inside the click, so the popup blocker treats it as a user gesture.
  if (linkHref.value) openExternal(linkHref.value);
}
</script>

<template>
  <BaseModal :open="open" size="sm" :title="title" @close="emit('close')">
    <div v-if="event" class="space-y-4" data-testid="external-event-details">
      <div class="flex items-center gap-3">
        <span
          class="view-only-stripes grid h-10 w-10 flex-none place-items-center rounded-[14px] text-xl"
          :style="{ '--vo-hue': event.color }"
          aria-hidden="true"
          >📅</span
        >
        <ExternalSourceLabel
          :name="event.calendarName"
          :color="event.color"
          data-testid="external-event-source"
        />
      </div>

      <dl class="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-2 text-sm">
        <dt class="text-secondary-400 dark:text-ink-faint text-xs leading-5">
          {{ t('calendarView.event.when') }}
        </dt>
        <dd class="text-secondary-500 dark:text-ink" data-testid="external-event-when">
          {{ when }}
        </dd>
        <template v-if="where">
          <dt class="text-secondary-400 dark:text-ink-faint text-xs leading-5">
            {{ t('calendarView.event.where') }}
          </dt>
          <dd
            class="text-secondary-500 dark:text-ink break-words"
            data-testid="external-event-where"
          >
            {{ where }}
          </dd>
        </template>
      </dl>

      <p
        class="bg-secondary-50 dark:bg-surface-overlay dark:text-ink-soft rounded-2xl px-3 py-2.5 text-xs leading-relaxed text-[var(--muted-text)]"
        data-testid="external-event-note"
      >
        {{ event.busyOnly ? t('calendarView.event.noteBusy') : t('calendarView.event.note') }}
      </p>
    </div>

    <template v-if="event && linkHref" #footer>
      <BaseButton
        variant="outline"
        size="sm"
        class="w-full"
        data-testid="external-event-open-google"
        @click="openInGoogle"
      >
        {{ t('calendarView.event.openInGoogle') }}
      </BaseButton>
    </template>
  </BaseModal>
</template>
