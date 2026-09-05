<script setup lang="ts">
/**
 * Horizontal tab strip for the Bean Detail page. Six tabs, each mapped
 * to a URL segment (`/pod/:memberId/:tab`) so deep links + back/forward
 * navigation round-trip correctly.
 *
 * Dumb: parent owns the route + active tab; this component renders +
 * emits a navigate intent.
 */
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';

export type BeanTabId =
  'overview' | 'favorites' | 'sayings' | 'allergies' | 'medications' | 'notes' | 'milestones';

const props = defineProps<{
  active: BeanTabId;
  /** Counts shown as badges on the tab label. Missing/zero → no badge. */
  counts?: Partial<Record<BeanTabId, number>>;
}>();

defineEmits<{
  select: [tab: BeanTabId];
}>();

const { t } = useTranslation();

interface TabDef {
  id: BeanTabId;
  emoji: string;
}

// Tab order groups by mental-model affinity:
//   1. Identity-ish     \u2014 overview, favorites
//   2. Memory cluster   \u2014 sayings, milestones (kept together; both are
//                          memory-keeping artifacts)
//   3. Health cluster   \u2014 allergies, medications
//   4. Catch-all        \u2014 notes
const TABS: TabDef[] = [
  { id: 'overview', emoji: '\u{1F4CB}' },
  { id: 'favorites', emoji: '\u{1F49D}' },
  { id: 'sayings', emoji: '\u{1F4AC}' },
  { id: 'milestones', emoji: '\u{1F31F}' },
  { id: 'allergies', emoji: '\u26A0\uFE0F' },
  { id: 'medications', emoji: '\u{1F48A}' },
  { id: 'notes', emoji: '\u{1F4DD}' },
];

const tabs = computed(() =>
  TABS.map((t) => ({
    ...t,
    label: labelFor(t.id),
    badge: props.counts?.[t.id] ?? 0,
  }))
);

function labelFor(id: BeanTabId): string {
  switch (id) {
    case 'overview':
      return t('bean.tab.overview');
    case 'favorites':
      return t('bean.tab.favorites');
    case 'sayings':
      return t('bean.tab.sayings');
    case 'allergies':
      return t('bean.tab.allergies');
    case 'medications':
      return t('bean.tab.medications');
    case 'notes':
      return t('bean.tab.notes');
    case 'milestones':
      return t('milestone.tab.label');
  }
}
</script>

<template>
  <nav
    class="mb-6 flex gap-1 overflow-x-auto border-b border-[var(--tint-slate-10)]"
    :aria-label="t('bean.detail.title')"
  >
    <button
      v-for="tab in tabs"
      :key="tab.id"
      type="button"
      class="font-outfit flex flex-shrink-0 items-center gap-1.5 px-3 py-3 text-sm font-semibold transition-colors sm:gap-2 sm:px-4"
      :class="
        tab.id === active
          ? 'text-primary-500 border-primary-500 dark:text-accent-lift dark:border-accent-lift border-b-2'
          : 'text-secondary-500/60 dark:text-ink-soft hover:text-secondary-500 dark:hover:text-ink border-b-2 border-transparent'
      "
      :aria-current="tab.id === active ? 'page' : undefined"
      @click="$emit('select', tab.id)"
    >
      <span aria-hidden="true">{{ tab.emoji }}</span>
      <span :class="tab.id === active ? 'inline' : 'hidden sm:inline'">{{ tab.label }}</span>
      <span
        v-if="tab.badge > 0"
        class="font-outfit inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-[var(--tint-slate-5)] px-1.5 py-0.5 text-[0.625rem] font-semibold"
        :class="
          tab.id === active
            ? 'text-primary-500 dark:text-accent-lift'
            : 'text-secondary-500/60 dark:text-ink-soft'
        "
      >
        {{ tab.badge }}
      </span>
    </button>
  </nav>
</template>
