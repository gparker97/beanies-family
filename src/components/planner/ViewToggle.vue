<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';

// `compact` shrinks each segment to its initial letter (M / W / D — or the
// single-char equivalent in other languages) + tighter padding, for the
// space-constrained mobile command bar. Desktop stays full-word.
//
// `monthMode` (phone only, #141): Month has two surfaces there, Grid and List. While it
// is set, the active M pill shows the current mode as a small glyph under the letter,
// and a SECOND tap on it emits `toggle-month-mode` instead of re-selecting Month.
// Every compact pill is `h-9`, so the two-line M matches its neighbours' 36px.
const props = defineProps<{
  activeView: string;
  compact?: boolean;
  monthMode?: 'grid' | 'list';
}>();
const emit = defineEmits<{ 'update:activeView': [view: string]; 'toggle-month-mode': [] }>();
const { t } = useTranslation();

const views = [
  { id: 'month', labelKey: 'planner.view.month' as const },
  { id: 'week', labelKey: 'planner.view.week' as const },
  { id: 'day', labelKey: 'planner.view.day' as const },
];
type View = (typeof views)[number];

// Initial grapheme of the translated label — works across en (M/W/D), the
// lowercase beanie overlay (m/w/d), and zh single chars (月/周/日).
function shortLabel(labelKey: View['labelKey']): string {
  return [...t(labelKey)][0] ?? '';
}

/** The active compact M while a month mode is known: it carries the mode glyph. */
function showsModeGlyph(view: View): boolean {
  return (
    !!props.compact && !!props.monthMode && view.id === 'month' && view.id === props.activeView
  );
}

const modeLabel = computed(() =>
  t(props.monthMode === 'grid' ? 'planner.monthMode.showList' : 'planner.monthMode.showGrid')
);

function ariaLabel(view: View): string | undefined {
  if (showsModeGlyph(view)) return modeLabel.value;
  return props.compact ? t(view.labelKey) : undefined;
}

function onClick(view: View): void {
  // Today a tap on the active pill re-emits the same view (a no-op), so a second tap on
  // the active M is cleanly distinguishable as "flip the month mode".
  if (view.id === 'month' && view.id === props.activeView && props.monthMode) {
    emit('toggle-month-mode');
    return;
  }
  emit('update:activeView', view.id);
}
</script>

<template>
  <div
    class="dark:bg-surface-raised inline-flex items-center gap-1 rounded-2xl bg-white p-1 shadow-[0_2px_8px_rgba(44,62,80,0.06)] dark:shadow-none"
  >
    <button
      v-for="view in views"
      :key="view.id"
      type="button"
      class="font-outfit cursor-pointer rounded-xl text-sm font-semibold transition-all"
      :class="[
        compact ? 'flex h-9 w-9 items-center justify-center' : 'px-4 py-2',
        showsModeGlyph(view) ? 'flex-col gap-0.5 leading-none' : '',
        view.id === activeView
          ? 'from-primary-500 to-terracotta-400 bg-gradient-to-r text-white shadow-[0_2px_8px_rgba(241,93,34,0.2)]'
          : 'hover:text-secondary-500 dark:text-ink-soft dark:hover:text-ink text-[var(--color-text-muted)]',
      ]"
      :aria-label="ariaLabel(view)"
      :data-testid="`view-toggle-${view.id}`"
      @click="onClick(view)"
    >
      {{ compact ? shortLabel(view.labelKey) : t(view.labelKey) }}
      <svg
        v-if="showsModeGlyph(view)"
        class="h-2 w-2"
        viewBox="0 0 8 8"
        fill="currentColor"
        aria-hidden="true"
        :data-mode="monthMode"
      >
        <template v-if="monthMode === 'grid'">
          <rect x="0" y="0" width="3.25" height="3.25" rx="0.5" />
          <rect x="4.75" y="0" width="3.25" height="3.25" rx="0.5" />
          <rect x="0" y="4.75" width="3.25" height="3.25" rx="0.5" />
          <rect x="4.75" y="4.75" width="3.25" height="3.25" rx="0.5" />
        </template>
        <template v-else>
          <rect x="0" y="0" width="8" height="1.5" rx="0.75" />
          <rect x="0" y="3.25" width="8" height="1.5" rx="0.75" />
          <rect x="0" y="6.5" width="8" height="1.5" rx="0.75" />
        </template>
      </svg>
    </button>
  </div>
</template>
