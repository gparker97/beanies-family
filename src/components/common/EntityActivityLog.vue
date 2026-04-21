<script setup lang="ts" generic="FilterId extends string">
/**
 * Shared chronological activity log. Renders an entity-agnostic list of
 * pre-normalised `ActivityEntry` items grouped by date, with optional
 * filter chips, empty state, and an optional "View all →" link.
 *
 * Callers (currently AccountViewModal + GoalViewModal) own:
 *   - bucketing / filter state
 *   - mapping domain objects (Transaction, GoalManualContribution, ...) to
 *     the normalised `ActivityEntry` shape
 *   - per-row click behaviour (row is non-clickable when `entry.onClick` is
 *     undefined)
 *
 * No store dependencies inside this component — it's a pure renderer.
 */
import { computed } from 'vue';
import CurrencyAmount from '@/components/common/CurrencyAmount.vue';
import { useTranslation } from '@/composables/useTranslation';
import { groupByDate } from '@/utils/groupByDate';
import { toDateInputValue, formatNookDate } from '@/utils/date';
import type { CurrencyCode } from '@/types/models';
import type { UIStringKey } from '@/services/translation/uiStrings';

export interface ActivityEntry {
  id: string;
  date: string; // ISO date for group key
  title?: string; // optional bold first line
  subtitle: string; // secondary line
  amount: number; // absolute
  currency: CurrencyCode;
  direction: 'income' | 'expense' | 'neutral';
  iconEmoji?: string;
  onClick?: () => void; // undefined → non-clickable row
  onDelete?: () => void; // when present, renders an inline trash icon button
}

export interface ActivityFilterDef<T extends string> {
  id: T;
  labelKey: UIStringKey;
  emoji: string;
}

const props = withDefaults(
  defineProps<{
    entries: ActivityEntry[];
    emptyStateText: string;
    filters?: ActivityFilterDef<FilterId>[];
    activeFilterId?: FilterId;
    visibleCap?: number;
    viewAllText?: string;
    showViewAll?: boolean;
  }>(),
  {
    filters: () => [],
    activeFilterId: undefined,
    visibleCap: 20,
    viewAllText: undefined,
    showViewAll: false,
  }
);

const emit = defineEmits<{
  'filter-select': [id: FilterId];
  'view-all': [];
}>();

const { t } = useTranslation();

const visible = computed(() => props.entries.slice(0, props.visibleCap));
const hasMore = computed(() => props.entries.length > props.visibleCap);

function dateLabel(dateStr: string): string {
  const today = toDateInputValue(new Date());
  if (dateStr === today) return t('date.today');
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (dateStr === toDateInputValue(tomorrow)) return t('date.tomorrow');
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (dateStr === toDateInputValue(yesterday)) return t('date.yesterday');
  return formatNookDate(dateStr);
}

const grouped = computed(() => groupByDate(visible.value, (e) => e.date, dateLabel));
</script>

<template>
  <div class="space-y-3">
    <!-- Filter chips (hidden when no filters provided) -->
    <div v-if="filters.length > 0" class="flex flex-wrap gap-1.5">
      <button
        v-for="filter in filters"
        :key="filter.id"
        type="button"
        class="font-outfit inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors"
        :class="
          activeFilterId === filter.id
            ? 'from-secondary-500 bg-gradient-to-r to-[#3D5368] text-white'
            : 'bg-[var(--tint-slate-5)] text-[var(--color-text)] hover:bg-[var(--tint-slate-8)] dark:bg-slate-700 dark:text-gray-300'
        "
        @click="emit('filter-select', filter.id)"
      >
        <span>{{ filter.emoji }}</span>
        <span>{{ t(filter.labelKey) }}</span>
      </button>
    </div>

    <!-- Empty state -->
    <div
      v-if="entries.length === 0"
      class="rounded-2xl border border-dashed border-[var(--tint-slate-8)] bg-[var(--tint-slate-5)] px-4 py-6 text-center dark:border-slate-600 dark:bg-slate-700/40"
    >
      <p class="font-outfit text-sm text-[#2C3E50]/50 dark:text-gray-400">
        {{ emptyStateText }}
      </p>
    </div>

    <!-- Grouped list -->
    <div v-else class="space-y-3">
      <div v-for="group in grouped" :key="group.date">
        <p
          class="font-outfit mb-1.5 text-xs font-semibold tracking-wide text-[#2C3E50]/50 uppercase dark:text-gray-500"
        >
          {{ group.label }}
        </p>
        <div class="space-y-1.5">
          <!--
            Row container is always a <div> to avoid nested-button invalid
            HTML. When `entry.onClick` is set, the content area renders as
            an inner <button> so the whole row-minus-trash is tap-to-open.
            A separate <button> at the trailing end handles delete when
            `entry.onDelete` is set.
          -->
          <div
            v-for="entry in group.items"
            :key="entry.id"
            class="flex items-stretch rounded-2xl bg-white shadow-[var(--card-shadow)] transition-colors dark:bg-slate-800"
            :class="
              entry.onClick ? 'hover:bg-[var(--tint-slate-5)] dark:hover:bg-slate-700/50' : ''
            "
          >
            <component
              :is="entry.onClick ? 'button' : 'div'"
              :type="entry.onClick ? 'button' : undefined"
              class="flex w-full min-w-0 flex-1 items-start gap-3 px-3.5 py-2.5 text-left"
              :class="
                entry.onClick ? 'cursor-pointer rounded-l-2xl' : 'cursor-default rounded-l-2xl'
              "
              @click="entry.onClick?.()"
            >
              <span
                v-if="entry.iconEmoji"
                class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--tint-slate-5)] text-sm dark:bg-slate-700"
                aria-hidden="true"
                >{{ entry.iconEmoji }}</span
              >
              <div class="min-w-0 flex-1">
                <p
                  v-if="entry.title"
                  class="font-outfit truncate text-sm font-semibold text-[#2C3E50] dark:text-gray-100"
                >
                  {{ entry.title }}
                </p>
                <p
                  v-if="entry.subtitle"
                  class="truncate text-xs text-[#2C3E50]/60 dark:text-gray-400"
                >
                  {{ entry.subtitle }}
                </p>
              </div>
              <div class="font-outfit shrink-0 text-right">
                <CurrencyAmount
                  :amount="entry.amount"
                  :currency="entry.currency"
                  :type="entry.direction"
                  size="sm"
                />
              </div>
            </component>
            <!--
              Fixed-width trailing slot: either the delete button or an
              invisible spacer of the same width. Reserving the slot on
              every row keeps amounts column-aligned across the list,
              regardless of which rows are deletable.
            -->
            <button
              v-if="entry.onDelete"
              type="button"
              :aria-label="t('action.delete')"
              class="group flex w-10 shrink-0 items-center justify-center rounded-r-2xl text-[#2C3E50]/30 transition-colors hover:bg-red-50 hover:text-red-500 dark:text-gray-500 dark:hover:bg-red-900/20 dark:hover:text-red-400"
              @click="entry.onDelete()"
            >
              <svg
                class="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
            <div v-else class="w-10 shrink-0" aria-hidden="true" />
          </div>
        </div>
      </div>

      <!-- View all -->
      <button
        v-if="showViewAll && hasMore"
        type="button"
        class="text-primary-500 hover:bg-primary-500/5 mt-2 w-full cursor-pointer rounded-2xl py-2 text-center text-sm font-semibold transition-colors"
        @click="emit('view-all')"
      >
        {{ viewAllText ?? t('accountView.viewAll') }}
      </button>
    </div>
  </div>
</template>
