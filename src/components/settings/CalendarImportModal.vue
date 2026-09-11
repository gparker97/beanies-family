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

/** Plural-correct label for the primary button. */
const importLabel = computed(() =>
  store.selectedCount === 1
    ? t('calendarImport.import.one')
    : fillTemplate(t('calendarImport.import.other'), { count: String(store.selectedCount) })
);

/**
 * The confirm's one interpolated field. Built from two pluralized pairs rather
 * than one sentence, so a run that is entirely one kind says only the half that
 * applies to it.
 */
const confirmDetail = computed(() => {
  const parts: string[] = [];
  if (store.adoptCount > 0) {
    parts.push(
      store.adoptCount === 1
        ? t('calendarImport.confirm.sync.one')
        : fillTemplate(t('calendarImport.confirm.sync.other'), {
            count: String(store.adoptCount),
          })
    );
  }
  if (store.copyCount > 0) {
    parts.push(
      store.copyCount === 1
        ? t('calendarImport.confirm.copy.one')
        : fillTemplate(t('calendarImport.confirm.copy.other'), {
            count: String(store.copyCount),
          })
    );
  }
  return parts.join(' ');
});

const hasUnsupported = computed(() =>
  store.candidates.some((c) => c.outcome === 'unsupported-recurrence')
);

function close(): void {
  // Never abandon a running write. The batch is atomic, so closing mid-commit
  // would not corrupt anything, but the user would be left with no idea whether
  // their events landed — and the natural next move is to run the import again.
  if (store.phase === 'importing') return;
  store.reset();
  emit('close');
}

async function onScan(): Promise<void> {
  const ok = await store.scan();
  if (!ok) {
    showToast('error', t('calendarImport.scanFailed.title'), t('calendarImport.scanFailed.body'));
  }
}

async function onCommit(): Promise<void> {
  const total = store.selectedCount;
  if (total === 0) return;

  const okToGo = await confirm({
    title: 'calendarImport.confirm.title',
    message: 'calendarImport.confirm.body',
    // Only `detail` is a plain interpolated string, which is where the counts go.
    // Each half appears only when it has a count, so an import that is all one
    // kind never reads "0 events are copied into beanies".
    detail: confirmDetail.value,
    variant: 'info',
    confirmLabel: 'calendarImport.confirm.go',
  });
  if (!okToGo) return;

  const result = await store.commit();

  if (result.kind === 'failed') {
    // One atomic batch, so nothing was half-created and the user can simply try
    // again from the list they are looking at. Already reported to CloudWatch.
    showToast('error', t('calendarImport.failed.title'), t('calendarImport.failed.body'));
    return;
  }

  if (result.kind === 'unverified') {
    // 🔴 The write SUCCEEDED. Saying otherwise invites a retry that makes a second
    // set of everything, so this is an info toast, not an error, and the drawer
    // closes exactly as it does on success.
    showToast('info', t('calendarImport.unverified.title'), t('calendarImport.unverified.body'));
    close();
    return;
  }

  showToast(
    'success',
    result.count === 1
      ? t('calendarImport.done.one')
      : fillTemplate(t('calendarImport.done.other'), { count: String(result.count) })
  );
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
            :aria-label="cal.summary || t('calendarImport.choose.untitled')"
            @click="store.toggleCalendar(cal.id)"
          >
            <span aria-hidden="true">✓</span>
          </button>
          <div class="min-w-0">
            <!-- A fainter ink, never `opacity-*`: an opacity modifier on text is
                 the CIG's fourth dark-mode trap. -->
            <div
              class="font-outfit truncate text-base font-semibold"
              :class="
                store.isReadable(cal)
                  ? 'text-secondary-500 dark:text-ink'
                  : 'text-secondary-400 dark:text-ink-faint'
              "
            >
              {{ cal.summary || t('calendarImport.choose.untitled') }}
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
      <!-- ⚠️ The skipped-calendars notice sits ABOVE the empty check, not inside the
           `v-else`. When every read fails there are no candidates, so nested in the
           `v-else` this line was unreachable in exactly the case it explains — and
           the user was told their calendar was empty when beanies simply could not
           read it. -->
      <p
        v-if="store.skippedCalendars.length > 0"
        class="dark:bg-accent-lift/10 bg-primary-50 text-primary-700 dark:text-accent-lift mb-4 rounded-[18px] px-4 py-3 text-sm"
      >
        {{
          fillTemplate(t('calendarImport.review.skipped'), {
            count: String(store.skippedCalendars.length),
          })
        }}
      </p>

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
          <!-- Shown only when a row actually carries this chip, so the legend never
               explains something nobody can see. -->
          <div v-if="hasUnsupported" class="flex items-baseline gap-2">
            <span
              class="bg-secondary-50 text-secondary-400 dark:bg-surface-hover dark:text-ink-faint font-outfit shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold"
              >{{ t('calendarImport.chip.once') }}</span
            >
            <span class="text-secondary-400 dark:text-ink-soft text-xs">{{
              t('calendarImport.legend.once')
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

        <!-- No inner scroll container. The DRAWER body is the single scroll context,
             so the sticky day headers stick against it and the action bar below sits
             at the natural end of the list. Two nested scrollers would mean the user
             can scroll the list to its end and still not see the button. -->
        <div class="mt-1">
          <div v-for="day in days" :key="day.ymd">
            <div
              class="dark:bg-surface-raised font-outfit text-secondary-400 dark:text-ink-faint sticky top-0 z-10 bg-white px-1 pt-3 pb-1 text-xs font-bold"
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
          class="border-secondary-50 dark:border-line mt-3 flex items-center gap-3 border-t pt-3"
        >
          <BaseButton
            class="ml-auto"
            :disabled="store.selectedCount === 0 || store.phase === 'importing'"
            @click="onCommit"
          >
            {{ importLabel }}
          </BaseButton>
        </div>
      </template>
    </template>
  </BeanieFormModal>
</template>
