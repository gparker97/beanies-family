<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useListCategoryLabel } from '@/composables/useListCategoryLabel';
import { useToday } from '@/composables/useToday';
import { getListCategory } from '@/constants/listCategories';
import { isListDue, isRecurring } from '@/utils/listLifecycle';
import { fillTemplate } from '@/utils/fillTemplate';
import { formatDateShort } from '@/utils/date';
import MemberChip from '@/components/ui/MemberChip.vue';
import type { FamilyList } from '@/types/models';

const props = defineProps<{ list: FamilyList }>();
const emit = defineEmits<{ open: [id: string] }>();

const { t } = useTranslation();
const { categoryLabel } = useListCategoryLabel();
const { today } = useToday();

const category = computed(() => getListCategory(props.list.category));
const accent = computed(() => category.value?.color ?? 'var(--color-primary-500)');

const total = computed(() => props.list.items.length);
const done = computed(() => props.list.items.filter((i) => i.completed).length);
const progressPct = computed(() =>
  total.value ? Math.round((done.value / total.value) * 100) : 0
);
const progressLabel = computed(() =>
  fillTemplate(t('lists.progress'), { done: String(done.value), total: String(total.value) })
);

type Pill = { text: string; kind: 'due' | 'overdue' | 'recurring' | 'linked' };
const statusPill = computed<Pill | null>(() => {
  const list = props.list;
  if (isRecurring(list) && list.frequency) {
    return {
      text: t(`lists.status.repeats.${list.frequency}` as 'lists.status.repeats.daily'),
      kind: 'recurring',
    };
  }
  const due = isListDue(list, today.value);
  if (due === 'overdue') return { text: t('lists.status.overdue'), kind: 'overdue' };
  if (due === 'today' && list.dueDate) {
    return {
      text: fillTemplate(t('lists.status.due'), { date: formatDateShort(list.dueDate) }),
      kind: 'due',
    };
  }
  if (list.dueDate) {
    return {
      text: fillTemplate(t('lists.status.due'), { date: formatDateShort(list.dueDate) }),
      kind: 'due',
    };
  }
  return null;
});

const isLinked = computed(() => !!(props.list.linkedVacationId || props.list.linkedActivityId));
</script>

<template>
  <button
    type="button"
    class="group flex flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-white text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:bg-slate-800"
    @click="emit('open', list.id)"
  >
    <!-- Tinted strip: emoji + owner -->
    <div
      class="flex items-center justify-between px-3.5 py-2.5"
      :style="{ backgroundColor: `color-mix(in srgb, ${accent} 12%, transparent)` }"
    >
      <span class="text-xl" aria-hidden="true">{{ list.emoji }}</span>
      <MemberChip :member-id="list.ownerId" size="dot" />
    </div>

    <!-- Body -->
    <div class="flex flex-1 flex-col gap-2 p-3.5">
      <p class="font-outfit text-sm font-semibold text-[var(--color-text)]">{{ list.title }}</p>

      <div class="flex flex-wrap items-center justify-between gap-1.5">
        <span class="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
          <span class="h-2 w-2 flex-shrink-0 rounded-full" :style="{ backgroundColor: accent }" />
          {{ categoryLabel(list.category) }}
        </span>
        <span
          v-if="statusPill"
          class="rounded-full px-2 py-0.5 text-[0.625rem] font-semibold"
          :class="{
            'bg-[var(--tint-orange-15)] text-[var(--color-primary-500)]':
              statusPill.kind === 'due' || statusPill.kind === 'overdue',
            'bg-[var(--tint-silk-20)] text-[var(--color-foundation)]':
              statusPill.kind === 'recurring',
          }"
        >
          {{ statusPill.text }}
        </span>
      </div>

      <!-- Progress -->
      <div class="flex items-center gap-2">
        <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--tint-slate-5)]">
          <span
            class="block h-full rounded-full transition-all"
            :style="{ width: `${progressPct}%`, backgroundColor: accent }"
          />
        </span>
        <span class="text-[0.625rem] font-medium text-[var(--color-text-muted)]">{{
          progressLabel
        }}</span>
      </div>

      <span v-if="isLinked" class="text-[0.625rem] text-[var(--color-text-muted)]">
        🔗 {{ t('lists.status.linked') }}
      </span>
    </div>
  </button>
</template>
