<script setup lang="ts">
/**
 * The one-time Google Calendar import (#94), end to end in one drawer.
 *
 * Three states, not five. There is no confirm STATE (the global `confirm()` is
 * already mounted once in `App.vue` and takes an interpolated `detail`, so a whole
 * screen for a count would be bloat) and no result STATE (the outcome is one line,
 * which is a toast, exactly as `ListCopyModal` does after copying lists).
 *
 * The list is built for 200 rows: sticky day headers so someone 150 deep still
 * knows which day they are in, a sticky action bar so they can commit without
 * scrolling back, and the per-row outcome EXPLANATION hoisted into a legend that
 * appears once rather than 200 times.
 */
import { computed } from 'vue';

import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import CalendarImportRow from '@/components/settings/CalendarImportRow.vue';
import { useTranslation } from '@/composables/useTranslation';
import { confirm } from '@/composables/useConfirm';
import { showToast } from '@/composables/useToast';
import { fillTemplate } from '@/utils/fillTemplate';
import { formatDayLong } from '@/utils/date';
import { useCalendarImportStore, IMPORT_MAX_CANDIDATES } from '@/stores/calendarImportStore';
import type { ImportCandidate } from '@/utils/calendar/planImport';

const props = defineProps<{ open: boolean; connectionId: string | null }>();
const emit = defineEmits<{ close: [] }>();

const { t } = useTranslation();
const store = useCalendarImportStore();

/** Candidates grouped by their start date, preserving the store's date order. */
const days = computed(() => {
  const groups: Array<{ ymd: string; rows: ImportCandidate[] }> = [];
  for (const c of store.candidates) {
    const ymd = c.draft.date;
    const last = groups[groups.length - 1];
    if (last && last.ymd === ymd) last.rows.push(c);
    else groups.push({ ymd, rows: [c] });
  }
  return groups;
});

function close(): void {
  store.reset();
  emit('close');
}

async function onScan(): Promise<void> {
  await store.scan();
}

async function onCommit(): Promise<void> {
  const total = store.selectedCount;
  if (total === 0) return;

  const okToGo = await confirm({
    title: 'calendarImport.confirm.title',
    message: 'calendarImport.confirm.body',
    // Only `detail` is a plain interpolated string, which is where the counts go.
    detail: fillTemplate(t('calendarImport.confirm.detail'), {
      adopt: String(store.adoptCount),
      copy: String(store.copyCount),
    }),
    variant: 'info',
    confirmLabel: 'calendarImport.confirm.go',
  });
  if (!okToGo) return;

  const imported = await store.commit();
  if (imported === null) {
    // The write is one atomic batch, so nothing was half-created and the user can
    // simply try again. `commit` has already reported this to CloudWatch.
    showToast('error', t('calendarImport.failed.title'), t('calendarImport.failed.body'));
    return;
  }
  showToast('success', fillTemplate(t('calendarImport.done'), { count: String(imported) }));
  close();
}
</script>

<template>
  <BeanieFormModal
    :open="props.open"
    variant="drawer"
    :title="t('calendarImport.start')"
    icon="📅"
    :save-label="t('action.close')"
    @close="close"
    @save="close"
  >
    <!-- 1. Choose which calendars to look at -->
    <template v-if="store.phase === 'choosing'">
      <p class="text-secondary-400 dark:text-ink-soft mb-4 text-sm">
        {{ t('calendarImport.choose.body') }}
      </p>

      <ul class="dark:bg-surface-raised rounded-3xl bg-white p-2 shadow-[var(--card-shadow)]">
        <li
          v-for="cal in store.calendars"
          :key="cal.id"
          class="border-secondary-50 dark:border-line flex items-center gap-3 border-b px-2 py-3 last:border-b-0"
          :class="store.isReadable(cal) ? '' : 'opacity-55'"
        >
          <button
            type="button"
            class="grid h-6 w-6 shrink-0 place-items-center rounded-lg border-2 text-xs"
            :class="
              store.chosenCalendarIds.has(cal.id)
                ? 'border-primary-500 bg-primary-500 dark:border-accent-lift dark:bg-accent-lift dark:text-surface-ground text-white'
                : 'border-secondary-100 dark:border-line-strong text-transparent'
            "
            :disabled="!store.isReadable(cal)"
            :aria-pressed="store.chosenCalendarIds.has(cal.id)"
            :aria-label="cal.summary || cal.id"
            @click="store.toggleCalendar(cal.id)"
          >
            <span aria-hidden="true">✓</span>
          </button>
          <div class="min-w-0">
            <div
              class="font-outfit text-secondary-500 dark:text-ink truncate text-base font-semibold"
            >
              {{ cal.summary || cal.id }}
            </div>
            <div
              v-if="!store.isReadable(cal)"
              class="text-secondary-400 dark:text-ink-faint text-xs"
            >
              {{ t('calendarImport.choose.readOnly') }}
            </div>
          </div>
        </li>
      </ul>

      <p
        class="dark:bg-silk-lift/10 text-secondary-400 dark:text-ink-soft bg-sky-silk-50 mt-4 rounded-[18px] px-4 py-3 text-sm"
      >
        {{ t('calendarImport.choose.privacy') }}
      </p>

      <BaseButton class="mt-5" :disabled="store.chosenCalendarIds.size === 0" @click="onScan">
        {{ t('calendarImport.choose.scan') }}
      </BaseButton>
    </template>

    <!-- 2. Scanning -->
    <template v-else-if="store.phase === 'scanning'">
      <p class="text-secondary-400 dark:text-ink-soft py-8 text-center text-sm">
        {{ t('calendarImport.scanning') }}
      </p>
    </template>

    <!-- 3. Review and pick -->
    <template v-else-if="store.phase === 'reviewing' || store.phase === 'importing'">
      <p v-if="store.candidates.length === 0" class="text-secondary-400 dark:text-ink-soft text-sm">
        {{ t('calendarImport.review.empty') }}
      </p>

      <template v-else>
        <p class="text-secondary-400 dark:text-ink-soft mb-4 text-sm">
          {{ t('calendarImport.review.body') }}
        </p>

        <!-- The explanation, ONCE. Repeating it per row is what made the row tall. -->
        <div
          class="dark:bg-silk-lift/10 bg-sky-silk-50 mb-4 flex flex-col gap-2 rounded-[18px] px-4 py-3"
        >
          <div class="flex items-baseline gap-2">
            <span
              class="bg-primary-50 text-primary-700 dark:bg-accent-lift/15 dark:text-accent-lift font-outfit shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold"
              >{{ t('calendarImport.chip.adopt') }}</span
            >
            <span class="text-secondary-400 dark:text-ink-soft text-xs">{{
              t('calendarImport.legend.adopt')
            }}</span>
          </div>
          <div class="flex items-baseline gap-2">
            <span
              class="dark:bg-silk-lift/15 dark:text-silk-lift font-outfit shrink-0 rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-[#1f5f80]"
              >{{ t('calendarImport.chip.copy') }}</span
            >
            <span class="text-secondary-400 dark:text-ink-soft text-xs">{{
              t('calendarImport.legend.copy')
            }}</span>
          </div>
        </div>

        <div
          class="border-secondary-50 dark:border-line flex flex-wrap items-center gap-3 border-b pb-2"
        >
          <button
            type="button"
            class="font-outfit text-secondary-500 dark:text-ink text-sm font-semibold"
            @click="store.toggleAll()"
          >
            {{
              store.allSelected ? t('calendarImport.deselectAll') : t('calendarImport.selectAll')
            }}
          </button>
          <span class="text-secondary-400 dark:text-ink-faint ml-auto text-xs tabular-nums">
            {{
              fillTemplate(t('calendarImport.ticked'), {
                selected: String(store.selectedCount),
                total: String(store.selectableCandidates.length),
              })
            }}
          </span>
        </div>

        <p v-if="store.truncated" class="text-secondary-400 dark:text-ink-faint mt-2 text-xs">
          {{
            fillTemplate(t('calendarImport.review.truncated'), {
              count: String(IMPORT_MAX_CANDIDATES),
            })
          }}
        </p>
        <p
          v-if="store.skippedCalendars.length > 0"
          class="text-secondary-400 dark:text-ink-faint mt-2 text-xs"
        >
          {{
            fillTemplate(t('calendarImport.review.skipped'), {
              count: String(store.skippedCalendars.length),
            })
          }}
        </p>

        <div class="mt-1 max-h-[420px] overflow-y-auto">
          <div v-for="day in days" :key="day.ymd">
            <div
              class="dark:bg-surface-ground font-outfit text-secondary-400 dark:text-ink-faint sticky top-0 z-10 bg-[var(--cloud-white,#f8f9fa)] px-1 pt-3 pb-1 text-xs font-bold"
            >
              {{ formatDayLong(day.ymd) }}
            </div>
            <ul class="flex flex-col gap-1">
              <CalendarImportRow
                v-for="row in day.rows"
                :key="row.googleEventId"
                :candidate="row"
                :selected="store.selectedIds.has(row.googleEventId)"
                @toggle="store.toggleCandidate(row.googleEventId)"
              />
            </ul>
          </div>
        </div>

        <div
          class="dark:bg-surface-ground border-secondary-50 dark:border-line sticky bottom-0 mt-2 flex items-center gap-3 border-t bg-[var(--cloud-white,#f8f9fa)] pt-3"
        >
          <BaseButton
            class="ml-auto"
            :disabled="store.selectedCount === 0 || store.phase === 'importing'"
            @click="onCommit"
          >
            {{ fillTemplate(t('calendarImport.bring'), { count: String(store.selectedCount) }) }}
          </BaseButton>
        </div>
      </template>
    </template>
  </BeanieFormModal>
</template>
