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
import ActionButtons from '@/components/ui/ActionButtons.vue';
import type { FamilyList } from '@/types/models';

const props = defineProps<{ list: FamilyList }>();
const emit = defineEmits<{ open: [id: string]; copy: [id: string]; delete: [id: string] }>();

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
  <article
    class="group dark:bg-surface-raised dark:border-line-strong relative flex flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
  >
    <!-- Tinted strip: emoji + owner + faint watermark -->
    <div
      class="relative flex items-center justify-between overflow-hidden px-3.5 py-2.5"
      :style="{ backgroundColor: `color-mix(in srgb, ${accent} 12%, transparent)` }"
    >
      <span class="z-[1] text-xl drop-shadow-sm" aria-hidden="true">{{ list.emoji }}</span>
      <!-- z-20 clears the z-10 open-overlay below; the strip is `relative` with
           `z-auto`, so it creates no stacking context and these compare directly. -->
      <ActionButtons
        size="lg"
        :show-edit="false"
        show-copy
        class="relative z-20"
        @click.stop
        @copy="emit('copy', list.id)"
        @delete="emit('delete', list.id)"
      />
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
        <!-- Owner joins the LEFT group. Adding it as a third child of the
             `justify-between` row turns a stable two-column layout into a
             three-way wrapping one at the ~160px 2-across mobile width. -->
        <span class="flex min-w-0 items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
          <span class="h-2 w-2 flex-shrink-0 rounded-full" :style="{ backgroundColor: accent }" />
          <span class="truncate">{{ categoryLabel(list.category) }}</span>
          <MemberChip :member-id="list.ownerId" size="dot" />
        </span>
        <span
          v-if="statusPill"
          class="inline-flex max-w-[12rem] items-center gap-1 truncate rounded-full px-2 py-0.5 text-xs font-semibold"
          :title="statusPill.text"
          :class="{
            'dark:text-accent-lift bg-[var(--tint-orange-15)] text-[var(--color-primary-500)]':
              statusPill.kind === 'due' || statusPill.kind === 'overdue',
            'dark:text-purple-lift bg-[var(--tint-purple-12)] text-purple-600':
              statusPill.kind === 'recurring',
            'dark:text-teal-lift bg-[rgba(42,157,143,0.12)] text-[#2a9d8f]':
              statusPill.kind === 'linked',
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

    <!-- The "open this list" affordance. Last in the DOM so that if the z tokens are
         ever removed this degrades loudly (overlay eats the buttons) rather than
         silently (strip eats the overlay).
         `ring-inset` is REQUIRED, not cosmetic: the root has `overflow-hidden`, and an
         outward-painting ring on an `inset-0` child is clipped to nothing, leaving the
         primary action with no visible focus indicator. -->
    <button
      type="button"
      data-testid="list-tile-open"
      class="focus-visible:ring-primary-500 absolute inset-0 z-10 rounded-2xl focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
      :aria-label="list.title"
      @click="emit('open', list.id)"
    />
  </article>
</template>
