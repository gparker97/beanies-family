<script setup lang="ts">
/**
 * Sticky command bar — the calendar's persistent chrome and the page hero.
 *
 * Presentational shell only: it composes existing children (`ViewToggle`,
 * `MemberChipFilter`, `MemberFilterMobileMenu`, `CalendarTripRibbon`) and the
 * absorbed `CalendarNavBar` prev/today/next markup, and emits intents upward.
 * It holds NO store access, navigation math, or persistence — those live in
 * the page (`usePlannerNavigation`, `useMemberFilterChips`) and the ribbon.
 *
 * Sticks to the top of the `<main>` scroll container, bleeding into its
 * padding (`-mx-4 px-4 md:-mx-6 md:px-6` + `-mt-4 pt-4 md:-mt-6 md:pt-6`) so
 * the period label and controls never scroll out of view and the bar reads
 * flush when pinned. `AppHeader` lives outside `<main>`, so `top-0` is correct.
 */
import ViewToggle from '@/components/planner/ViewToggle.vue';
import MemberChipFilter from '@/components/common/MemberChipFilter.vue';
import MemberFilterMobileMenu from '@/components/planner/MemberFilterMobileMenu.vue';
import CalendarTripRibbon from '@/components/planner/CalendarTripRibbon.vue';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import type { PlannerView } from '@/composables/usePlannerNavigation';

defineProps<{
  label: string;
  activeView: PlannerView;
  canAdd: boolean;
  isAllActive: boolean;
  isMemberActive: (id: string) => boolean;
  activeMemberNames: string[];
}>();

const emit = defineEmits<{
  prev: [];
  next: [];
  today: [];
  'update:activeView': [view: string];
  add: [];
  'open-agenda': [];
  'select-all': [];
  'select-member': [id: string];
  'vacation-click': [id: string];
}>();

const { t } = useTranslation();

// Publish this bar's rendered height as a CSS var so the views can dock their
// own column headers (weekday row / member row) right beneath it via
// `sticky; top: var(--planner-cmdbar-h)`. A ResizeObserver keeps it correct as
// the bar's height changes (ribbon collapse, mobile two-row layout, member-chip
// wrap). This is a layout-measurement concern, not business logic.
const rootEl = ref<HTMLElement | null>(null);
let ro: ResizeObserver | null = null;

function publishHeight(): void {
  if (typeof document === 'undefined' || !rootEl.value) return;
  document.documentElement.style.setProperty(
    '--planner-cmdbar-h',
    `${rootEl.value.offsetHeight}px`
  );
}

onMounted(() => {
  publishHeight();
  if (typeof ResizeObserver !== 'undefined' && rootEl.value) {
    ro = new ResizeObserver(() => publishHeight());
    ro.observe(rootEl.value);
  }
});

onBeforeUnmount(() => {
  ro?.disconnect();
  ro = null;
  if (typeof document !== 'undefined') {
    document.documentElement.style.removeProperty('--planner-cmdbar-h');
  }
});
</script>

<template>
  <div
    ref="rootEl"
    class="sticky top-0 z-30 -mx-4 -mt-4 mb-1 border-b border-gray-200/70 bg-white/85 px-4 pt-4 pb-3 backdrop-blur-md md:-mx-6 md:-mt-6 md:px-6 md:pt-6 dark:border-slate-700 dark:bg-slate-900/85"
  >
    <!-- Top row: period hero + nav, then the controls cluster -->
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
      <div class="flex items-center justify-between gap-2 sm:justify-start">
        <h1
          class="font-outfit text-secondary-500 truncate text-xl font-extrabold sm:text-2xl dark:text-gray-100"
        >
          {{ label }}
        </h1>

        <!-- Nav cluster (absorbed from CalendarNavBar) -->
        <div class="flex flex-shrink-0 items-center gap-0.5">
          <button
            type="button"
            class="text-secondary-500/50 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-slate-700"
            :aria-label="t('planner.today')"
            @click="emit('prev')"
          >
            <svg
              class="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              stroke-width="2"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            type="button"
            class="font-outfit text-primary-500 hover:bg-primary-500/10 cursor-pointer rounded-xl px-3 py-1.5 text-sm font-semibold transition-colors"
            @click="emit('today')"
          >
            {{ t('planner.today') }}
          </button>
          <button
            type="button"
            class="text-secondary-500/50 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-slate-700"
            :aria-label="t('planner.today')"
            @click="emit('next')"
          >
            <svg
              class="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              stroke-width="2"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Controls: view toggle + agenda (day) on the left, filter + Add on the right -->
      <div class="flex items-center justify-between gap-2 sm:ml-auto sm:justify-end">
        <div class="flex items-center gap-2">
          <button
            v-if="activeView === 'day'"
            type="button"
            class="text-secondary-500/70 hover:text-primary-500 font-outfit inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-sm font-semibold transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-slate-700"
            :title="t('planner.openAgenda')"
            :aria-label="t('planner.openAgenda')"
            @click="emit('open-agenda')"
          >
            <svg
              class="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              stroke-width="2"
              aria-hidden="true"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            <span class="hidden sm:inline">{{ t('planner.agenda') }}</span>
          </button>

          <ViewToggle
            :active-view="activeView"
            @update:active-view="emit('update:activeView', $event)"
          />
        </div>

        <div class="flex items-center gap-2">
          <MemberFilterMobileMenu
            class="sm:hidden"
            :is-all-active="isAllActive"
            :is-member-active="isMemberActive"
            :active-member-names="activeMemberNames"
            @select-all="emit('select-all')"
            @select-member="emit('select-member', $event)"
          />

          <button
            v-if="canAdd"
            type="button"
            class="font-outfit from-primary-500 to-terracotta-400 inline-flex h-10 w-10 flex-shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full bg-gradient-to-r text-xl font-semibold text-white shadow-[0_4px_12px_rgba(241,93,34,0.2)] transition-all hover:shadow-[0_6px_16px_rgba(241,93,34,0.3)] sm:h-auto sm:w-auto sm:rounded-2xl sm:px-5 sm:py-2.5 sm:text-sm"
            :aria-label="t('planner.addActivity')"
            @click="emit('add')"
          >
            <span aria-hidden="true" class="sm:hidden">＋</span>
            <span class="hidden sm:inline">{{ t('planner.addActivity') }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Desktop member chips on their own row (avoids crowding the top row) -->
    <div class="mt-3 hidden sm:flex">
      <MemberChipFilter
        :is-all-active="isAllActive"
        :is-member-active="isMemberActive"
        @select-all="emit('select-all')"
        @select-member="emit('select-member', $event)"
      />
    </div>

    <!-- Trip ribbon (A) — own store read + collapse state -->
    <CalendarTripRibbon class="mt-3" @vacation-click="emit('vacation-click', $event)" />
  </div>
</template>
