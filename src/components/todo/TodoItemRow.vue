<script setup lang="ts">
import { useMemberInfo } from '@/composables/useMemberInfo';
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { effectiveAssignees } from '@/utils/assignees';
import { formatNookDate } from '@/utils/date';
import { isTodoOverdue, isTodoDueToday } from '@/utils/todo';
import { isHint, HINT_TYPE_META } from '@/utils/helpfulHints';
import { MARKETING_URL } from '@/utils/marketing';
import ActivityOwnerStack from '@/components/ui/ActivityOwnerStack.vue';
import InfoHintBadge from '@/components/ui/InfoHintBadge.vue';
import type { TodoItem } from '@/types/models';

const { t } = useTranslation();
const hintHelpUrl = `${MARKETING_URL}/help/features/helpful-hints`;

const props = withDefaults(
  defineProps<{
    todo: TodoItem;
    compact?: boolean;
  }>(),
  { compact: false }
);

const emit = defineEmits<{
  toggle: [id: string];
  view: [todo: TodoItem];
  edit: [todo: TodoItem];
  delete: [id: string];
  /** Move into ("someday · maybe", value=true) / out of (value=false) the parked lane. */
  'set-someday': [id: string, value: boolean];
  /** #40: "keep" a Helpful Hint → it becomes a permanent normal to-do. */
  acknowledge: [id: string];
}>();

const isSomeday = computed(() => !!props.todo.someday);
const isOverdue = computed(() => isTodoOverdue(props.todo));
const isDueToday = computed(() => isTodoDueToday(props.todo));
// #40: `isHintRow` = any hint (drives the persistent subtle marker). `isFreshHint`
// = an un-acknowledged hint (gets the gentle wash + Keep/Dismiss + explainer, and
// suppresses the normal date badges so it never reads as overdue). Once kept, a
// hint behaves like a normal to-do but keeps its marker.
const isHintRow = computed(() => isHint(props.todo));
const isFreshHint = computed(() => isHintRow.value && !props.todo.hintAcknowledged);
const hintEmoji = computed(() =>
  props.todo.hintType ? HINT_TYPE_META[props.todo.hintType].emoji : ''
);
const hintEventLabel = computed(() =>
  props.todo.hintEventDate ? formatNookDate(props.todo.hintEventDate) : null
);

// Container styling — early returns rather than a deep nested ternary in the
// template. A someday row gets a soft Sky-Silk "daydream" wash. A due-today
// row gets the "outlined glow" treatment — Heritage Orange border + soft
// orange halo (box-shadow ring) on an otherwise neutral card, reading as
// "selected for today" without tipping into overdue's red intensity.
// Overdue stays red. The `--tint-silk-*` tokens carry their own light/dark
// values, so no `dark:` overrides needed there.
const containerClass = computed(() => {
  const pad = props.compact ? 'cursor-pointer p-3.5' : 'p-3 md:gap-4 md:p-4';
  if (isSomeday.value) {
    return `${pad} border-[var(--tint-silk-20)] bg-gradient-to-br from-[var(--tint-silk-10)] to-[var(--tint-silk-20)] hover:from-[var(--tint-silk-20)] hover:to-[var(--tint-silk-30)]`;
  }
  // #40: a fresh hint gets a gentle Heritage-Orange wash — BEFORE overdue/due-today,
  // so a nudge-date-in-the-past hint never renders in the alarming red state.
  if (isFreshHint.value) {
    return `${pad} border-[var(--tint-orange-15)] bg-gradient-to-br from-[var(--tint-orange-4)] to-[var(--tint-orange-15)] hover:from-[var(--tint-orange-8)] hover:to-[var(--tint-orange-15)]`;
  }
  // A KEPT hint keeps a nudge-date dueDate too, so it must ALSO skip overdue/
  // due-today red — it renders as a plain card with its subtle hint marker.
  if (!isHintRow.value && isOverdue.value) {
    return `${pad} border-red-200 bg-red-50 hover:bg-red-100 dark:border-red-800/40 dark:bg-red-950/30 dark:hover:bg-red-950/50`;
  }
  if (!isHintRow.value && isDueToday.value) {
    return `${pad} border-[var(--color-primary-500)] bg-white shadow-[0_0_0_3px_rgba(241,93,34,0.12)] hover:bg-[var(--tint-orange-8)] dark:bg-slate-800`;
  }
  if (props.compact) {
    return `${pad} border-[var(--tint-slate-10)] bg-white hover:bg-[var(--tint-orange-8)] dark:bg-slate-700 dark:hover:bg-slate-600`;
  }
  return `${pad} border-[var(--tint-slate-5)] bg-white hover:bg-[var(--tint-orange-8)] dark:bg-slate-800`;
});

const checkboxClass = computed(() => {
  if (isSomeday.value)
    return 'border-[var(--color-sky-silk-300)] hover:bg-[var(--tint-silk-20)] dark:border-sky-400/70';
  if (!isHintRow.value && isOverdue.value)
    return 'border-red-400 hover:bg-red-100 dark:border-red-500';
  return 'border-[var(--color-primary-500)] hover:bg-[var(--tint-orange-8)]';
});

// Hover-action pill background — picks up the Sky-Silk tint on a someday row so
// the ✏️ / 🗑️ / 💭 buttons sit on a cohesive field rather than a grey patch.
const actionPillStyle = computed(() => {
  if (isFreshHint.value) return 'background: var(--tint-orange-15)';
  return isSomeday.value ? 'background: var(--tint-silk-20)' : 'background: var(--tint-slate-5)';
});

const formattedDate = computed(() => {
  if (!props.todo.dueDate) return null;
  return formatNookDate(props.todo.dueDate);
});

const timeAgo = computed(() => {
  const now = new Date();
  const created = new Date(props.todo.createdAt);
  const diffMs = now.getTime() - created.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return t('todo.addedToday');
  if (diffDays === 1) return t('todo.addedYesterday');
  return t('todo.addedDaysAgo').replace('{days}', String(diffDays));
});

const { getMemberById } = useMemberInfo();

/**
 * Owners as members, resolved and deduped. A to-do card is not a bean lane, so it
 * shows everyone on it — and the face replaces the full-name pill because on a card
 * the member annotates the task, where in a picker they ARE the content being chosen.
 */
function ownersOf(entity: { assigneeIds?: string[]; assigneeId?: string }) {
  return effectiveAssignees(entity, (id) => Boolean(getMemberById(id)))
    .map((id) => getMemberById(id)!)
    .filter(Boolean);
}
</script>

<template>
  <div
    class="group flex items-center gap-3 rounded-2xl border transition-all"
    :class="containerClass"
    @click="emit('view', todo)"
  >
    <!-- Checkbox -->
    <button
      type="button"
      class="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border-[2.5px] transition-colors"
      :class="[compact ? '' : 'md:h-7 md:w-7', checkboxClass]"
      @click.stop="emit('toggle', todo.id)"
    />

    <!-- Content -->
    <div class="min-w-0 flex-1" :class="compact ? '' : 'cursor-pointer'">
      <p
        class="font-outfit text-sm font-semibold text-[var(--color-text)]"
        :class="compact ? 'truncate' : 'md:text-base'"
      >
        <!-- eslint-disable-next-line vue/no-bare-strings-in-template -->
        <span v-if="isSomeday" aria-hidden="true">💭&nbsp;</span
        ><span v-else-if="isHintRow" aria-hidden="true">{{ hintEmoji }}&nbsp;</span>{{ todo.title }}
      </p>

      <p
        v-if="todo.description"
        class="mt-0.5 line-clamp-1 text-xs leading-relaxed text-[var(--color-text-muted)]"
        :class="compact ? '' : 'md:line-clamp-2 md:text-sm'"
      >
        {{ todo.description }}
      </p>

      <!-- Metadata row -->
      <div
        class="mt-1 flex flex-wrap items-center gap-1.5"
        :class="compact ? 'md:gap-2' : 'md:mt-1.5 md:gap-2.5'"
      >
        <!-- #40: Helpful Hint marker chip — shown for every hint (fresh AND kept)
             and carrying the EVENT date. The normal date badges are hidden for
             hints (their dueDate is a notification nudge date, not a real due
             date), so this chip is the only date a hint shows and it never reads
             as overdue. Fresh hints additionally get the "what's this?" explainer. -->
        <span
          v-if="isHintRow"
          class="font-outfit inline-flex items-center gap-1 rounded-full bg-[var(--tint-orange-15)] px-2 py-0.5 text-[0.625rem] font-semibold text-[var(--color-primary-500)] md:px-2.5 md:text-xs"
        >
          {{ hintEmoji }} {{ t('todo.hint.badge')
          }}<template v-if="hintEventLabel">, {{ hintEventLabel }}</template>
        </span>
        <InfoHintBadge
          v-if="isFreshHint"
          :text="t('todo.hint.whatsThis')"
          :link="{ text: t('todo.hint.learnMore'), href: hintHelpUrl }"
        />

        <!-- Overdue date badge (never for a hint — see the marker chip above) -->
        <span
          v-if="!isHintRow && formattedDate && isOverdue"
          class="inline-flex items-center gap-1 rounded-full bg-[var(--color-primary-500)] px-2 py-0.5 text-[0.625rem] font-semibold text-white md:gap-1.5 md:px-2.5 md:text-xs"
          :class="compact ? 'font-outfit' : ''"
        >
          ⏰{{ compact ? ' ' : '' }}{{ formattedDate
          }}<template v-if="todo.dueTime">, {{ todo.dueTime }}</template>
          <span
            class="hidden rounded-full bg-white/25 px-1.5 py-px text-xs font-bold uppercase md:inline"
          >
            {{ t('todo.overdue') }}
          </span>
        </span>

        <!-- Due today badge — tinted pill (the card's outlined glow does the heavy lifting) -->
        <span
          v-else-if="!isHintRow && formattedDate && isDueToday"
          class="font-outfit inline-flex items-center gap-1 rounded-full bg-[var(--tint-orange-15)] px-2 py-0.5 text-[0.625rem] font-semibold text-[var(--color-primary-500)] md:gap-1.5 md:px-2.5 md:text-xs"
        >
          📅 {{ t('date.today') }}<template v-if="todo.dueTime">, {{ todo.dueTime }}</template>
        </span>

        <!-- Normal date -->
        <span
          v-else-if="!isHintRow && formattedDate"
          class="text-[0.625rem] font-semibold md:text-xs"
          :class="compact ? 'font-outfit' : ''"
          :style="{ color: 'var(--color-primary-500)' }"
        >
          📅 {{ formattedDate }}<template v-if="todo.dueTime">, {{ todo.dueTime }}</template>
        </span>

        <!-- No date (full mode only; a someday row's 💭 prefix already conveys "no date") -->
        <span v-else-if="!compact && !isSomeday" class="text-[0.625rem] opacity-35 md:text-xs">
          {{ t('todo.noDateSet') }}
        </span>

        <!-- Assignee chips -->
        <ActivityOwnerStack :members="ownersOf(todo)" size="xs" />

        <!-- Time ago (full mode, desktop only) -->
        <span v-if="!compact" class="hidden text-xs opacity-35 md:inline">{{ timeAgo }}</span>
      </div>
    </div>

    <!-- #40: Fresh-hint actions — Keep + Dismiss. Always visible (incl. mobile,
         where the row otherwise has no action buttons) so a hint is always
         actionable. Replaces the normal hover actions for un-acknowledged hints. -->
    <div v-if="isFreshHint" class="flex shrink-0 gap-1.5">
      <button
        class="flex h-8 w-8 items-center justify-center rounded-[10px] text-sm opacity-70 transition-opacity hover:opacity-100"
        :style="actionPillStyle"
        :title="t('todo.hint.keep')"
        :aria-label="t('todo.hint.keep')"
        @click.stop="emit('acknowledge', todo.id)"
      >
        <!-- eslint-disable-next-line vue/no-bare-strings-in-template -->
        <span aria-hidden="true">📌</span>
      </button>
      <button
        class="flex h-8 w-8 items-center justify-center rounded-[10px] text-sm opacity-70 transition-opacity hover:opacity-100"
        :style="actionPillStyle"
        :title="t('todo.hint.dismiss')"
        :aria-label="t('todo.hint.dismiss')"
        @click.stop="emit('delete', todo.id)"
      >
        <!-- eslint-disable-next-line vue/no-bare-strings-in-template -->
        <span aria-hidden="true">✕</span>
      </button>
    </div>

    <!-- Action buttons (full mode, desktop only; hover-revealed) -->
    <div
      v-else-if="!compact"
      class="hidden shrink-0 gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 md:flex"
    >
      <button
        class="flex h-8 w-8 items-center justify-center rounded-[10px] text-sm opacity-40 transition-opacity hover:opacity-70"
        :style="actionPillStyle"
        :title="isSomeday ? t('todo.makeActive') : t('todo.moveToSomeday')"
        @click.stop="emit('set-someday', todo.id, !isSomeday)"
      >
        {{ isSomeday ? '📋' : '💭' }}
      </button>
      <button
        class="flex h-8 w-8 items-center justify-center rounded-[10px] text-sm opacity-40 transition-opacity hover:opacity-70"
        :style="actionPillStyle"
        @click.stop="emit('edit', todo)"
      >
        ✏️
      </button>
      <button
        class="flex h-8 w-8 items-center justify-center rounded-[10px] text-sm opacity-40 transition-opacity hover:opacity-70"
        :style="actionPillStyle"
        :aria-label="t('action.delete')"
        @click.stop="emit('delete', todo.id)"
      >
        <!-- eslint-disable-next-line vue/no-bare-strings-in-template -->
        <span aria-hidden="true">🗑️</span>
      </button>
    </div>
  </div>
</template>
