<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useListCategoryLabel } from '@/composables/useListCategoryLabel';
import { useToday } from '@/composables/useToday';
import { getListCategory } from '@/constants/listCategories';
import { isListDue, isRecurring, listProgress } from '@/utils/listLifecycle';
import { fillTemplate } from '@/utils/fillTemplate';
import { formatDateShort } from '@/utils/date';
import { resolveListRule } from '@/services/recurrence/adapters';
import { useRecurrenceLabel } from '@/composables/useRecurrenceLabel';
import MemberChip from '@/components/ui/MemberChip.vue';
import type { FamilyList } from '@/types/models';

const props = defineProps<{ list: FamilyList }>();
const emit = defineEmits<{ open: [id: string] }>();

const { t } = useTranslation();
const { describe } = useRecurrenceLabel();
const { categoryLabel } = useListCategoryLabel();
const { today } = useToday();

const category = computed(() => getListCategory(props.list.category));
const accent = computed(() => category.value?.color ?? 'var(--color-primary-500)');

const progress = computed(() => listProgress(props.list));
const progressLabel = computed(() =>
  fillTemplate(t('lists.progress'), {
    done: String(progress.value.done),
    total: String(progress.value.total),
  })
);

type Pill = { glyph: string; text: string; kind: 'due' | 'overdue' | 'recurring' | 'linked' };
const statusPill = computed<Pill | null>(() => {
  const list = props.list;
  if (list.linkedVacationId || list.linkedActivityId) {
    return { glyph: '🔗', text: t('lists.status.linked'), kind: 'linked' };
  }
  // #70: regenerate from the canonical cadence rather than the legacy word, so
  // an every-2-weeks reset reads correctly. The pill is a compact chip, so the
  // template truncates and carries the full text as its title.
  const resolvedReset = isRecurring(list) ? resolveListRule(list) : null;
  if (resolvedReset) {
    return {
      glyph: '🔁',
      text: describe(resolvedReset.rule, resolvedReset.anchor),
      kind: 'recurring',
    };
  }
  const due = isListDue(list, today.value);
  if (due === 'overdue') return { glyph: '📅', text: t('lists.status.overdue'), kind: 'overdue' };
  if (list.dueDate && (due === 'today' || due === null)) {
    return {
      glyph: '📅',
      text: formatDateShort(list.dueDate),
      kind: 'due',
    };
  }
  return null;
});
</script>

<template>
  <button
    type="button"
    class="group dark:bg-surface-raised dark:border-line-strong flex flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-white text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
    @click="emit('open', list.id)"
  >
    <!-- Tinted strip: emoji + owner + faint watermark -->
    <div
      class="relative flex items-center justify-between overflow-hidden px-3.5 py-2.5"
      :style="{ backgroundColor: `color-mix(in srgb, ${accent} 12%, transparent)` }"
    >
      <span class="z-[1] text-xl drop-shadow-sm" aria-hidden="true">{{ list.emoji }}</span>
      <MemberChip :member-id="list.ownerId" size="dot" />
      <span
        class="pointer-events-none absolute -right-1 -bottom-3 text-4xl opacity-[0.07]"
        aria-hidden="true"
        >{{ list.emoji }}</span
      >
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
          class="inline-flex max-w-[12rem] items-center gap-1 truncate rounded-full px-2 py-0.5 text-xs font-semibold"
          :title="statusPill.text"
          :class="{
            'bg-[var(--tint-orange-15)] text-[var(--color-primary-500)]':
              statusPill.kind === 'due' || statusPill.kind === 'overdue',
            'bg-[var(--tint-purple-12)] text-purple-600': statusPill.kind === 'recurring',
            'bg-[rgba(42,157,143,0.12)] text-[#2a9d8f]': statusPill.kind === 'linked',
          }"
        >
          <span aria-hidden="true">{{ statusPill.glyph }}</span> {{ statusPill.text }}
        </span>
      </div>

      <!-- Progress -->
      <div class="flex items-center gap-2">
        <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--tint-slate-5)]">
          <span
            class="block h-full rounded-full transition-all"
            :style="{ width: `${progress.pct}%`, backgroundColor: accent }"
          />
        </span>
        <span class="text-xs font-medium text-[var(--color-text-muted)]">{{ progressLabel }}</span>
      </div>
    </div>
  </button>
</template>
