<script setup lang="ts">
/**
 * The activity a to-do was saved alongside (`TodoItem.activityId`), as a tappable link that
 * opens it in the planner.
 *
 * `activityId` is a soft reference: nothing unlinks it when the activity is deleted (here or
 * on another device), so this resolves it against `activityStore` and renders NOTHING on a
 * miss. There is never a dangling chip.
 *
 * A session link (`activityDate`, #114) resolves through `activityStore.resolveActivityLink`,
 * the same rule the activity drawer uses to list its items: an edited session resolves to its
 * own record, a cancelled one to nothing (no chip). The label shows that session's date and a
 * tap opens the drawer on that session (`?activity=<id>&date=<ymd>`).
 *
 * Two looks from the approved mockup: `chip` (the to-do row's metadata line) and `row` (the
 * "Linked Activity" field in To-do Details). Both carry the activity's own icon rather than
 * 📅, so the chip never reads as the to-do's due date beside the real one.
 */
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useTranslation } from '@/composables/useTranslation';
import { useActivityStore } from '@/stores/activityStore';
import { getActivityFallbackEmoji } from '@/constants/activityCategories';
import { entityDeepLink } from '@/utils/entityDeepLink';
import { formatNookDate, formatTime12 } from '@/utils/date';

const props = withDefaults(
  defineProps<{
    activityId: string;
    /** The session of a repeating activity the link targets (`TodoItem.activityDate`). */
    activityDate?: string;
    variant?: 'chip' | 'row';
  }>(),
  { variant: 'chip' }
);

const emit = defineEmits<{
  /** Fired after navigation starts, so a host drawer can close itself. */
  open: [activityId: string];
}>();

const { t } = useTranslation();
const router = useRouter();
const activityStore = useActivityStore();

// `props` IS the link (`activityId` + optional `activityDate`), so it goes to the
// resolver as-is rather than being rebuilt by hand.
const resolved = computed(() => activityStore.resolveActivityLink(props));
const activity = computed(() => resolved.value?.activity);

const icon = computed(() =>
  activity.value ? (activity.value.icon ?? getActivityFallbackEmoji(activity.value.category)) : ''
);

const dateLabel = computed(() =>
  activity.value ? formatNookDate(resolved.value?.date ?? activity.value.date) : ''
);

const whenLabel = computed(() => {
  if (!activity.value) return '';
  const time = activity.value.startTime ? formatTime12(activity.value.startTime) : '';
  return time ? `${dateLabel.value}, ${time}` : dateLabel.value;
});

function openActivity(): void {
  const target = resolved.value;
  if (!target) return;
  const date = target.date;
  void router.push(entityDeepLink('activity', target.activity.id, date ? { date } : undefined));
  emit('open', target.activity.id);
}
</script>

<template>
  <button
    v-if="activity && variant === 'chip'"
    type="button"
    class="font-outfit dark:text-ink inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border border-[var(--tint-orange-15)] bg-[var(--tint-orange-8)] py-0.5 pr-2 pl-1.5 text-xs font-semibold text-[var(--color-text)] transition-colors hover:bg-[var(--tint-orange-15)]"
    :aria-label="t('todo.linkedActivity.open')"
    :title="activity.title"
    @click.stop="openActivity"
  >
    <span aria-hidden="true">{{ icon }}</span>
    <span class="min-w-0 truncate">{{ activity.title }}, {{ dateLabel }}</span>
    <svg
      class="text-primary-500 dark:text-accent-lift h-2.5 w-2.5 shrink-0"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <path d="M4.5 3l3 3-3 3" />
    </svg>
  </button>

  <button
    v-else-if="activity"
    type="button"
    class="dark:bg-surface-overlay dark:border-line dark:hover:bg-surface-hover flex w-full min-w-0 items-center gap-2.5 rounded-[14px] border border-[var(--tint-slate-10)] bg-white px-3 py-2.5 text-left shadow-sm transition-colors hover:bg-[var(--tint-orange-8)]"
    :aria-label="t('todo.linkedActivity.open')"
    @click.stop="openActivity"
  >
    <span
      class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--tint-orange-8)] text-base"
      aria-hidden="true"
    >
      {{ icon }}
    </span>
    <span class="min-w-0 flex-1">
      <span
        class="font-outfit dark:text-ink block truncate text-sm font-semibold text-[var(--color-text)]"
      >
        {{ activity.title }}
      </span>
      <span class="dark:text-ink-soft block truncate text-xs text-[var(--color-text-muted)]">
        {{ whenLabel }}
      </span>
    </span>
    <svg
      class="text-primary-500 dark:text-accent-lift h-3 w-3 shrink-0"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <path d="M4.5 3l3 3-3 3" />
    </svg>
  </button>
</template>
