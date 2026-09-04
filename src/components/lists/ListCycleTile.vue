<script setup lang="ts">
/**
 * A finished cycle of a repeating list, as a tile.
 *
 * Deliberately self-contained rather than sharing a shell with `ListTile`. The plan
 * allowed either, on one condition: the shared shell had to leave `ListTile` provably
 * untouched. It did not — extracting it broke `ListTile.test.ts`'s click assertion, which
 * is exactly the interface-stability guarantee that test exists to hold. So the ~50 lines
 * of chrome are duplicated here instead, and the app's busiest list surface keeps its
 * current props, events and tests. Two small readable components beat one shared one that
 * destabilises a live component.
 *
 * A cycle imports nothing from `listLifecycle`: it has no due state, no cadence and no
 * links, so none of that branching is reachable.
 */
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useListCategoryLabel } from '@/composables/useListCategoryLabel';
import { getListCategory } from '@/constants/listCategories';
import { fillTemplate } from '@/utils/fillTemplate';
import { formatDateShort } from '@/utils/date';
import MemberChip from '@/components/ui/MemberChip.vue';
import type { ListCycle } from '@/types/models';

const props = defineProps<{ cycle: ListCycle }>();
const emit = defineEmits<{ open: [id: string] }>();

const { t } = useTranslation();
const { categoryLabel } = useListCategoryLabel();

const accent = computed(
  () => getListCategory(props.cycle.category)?.color ?? 'var(--color-primary-500)'
);
const pct = computed(() =>
  props.cycle.total ? Math.round((props.cycle.done / props.cycle.total) * 100) : 0
);
const progressLabel = computed(() =>
  fillTemplate(t('lists.progress'), {
    done: String(props.cycle.done),
    total: String(props.cycle.total),
  })
);
/**
 * A single date for the usual case, a span when the cycle covered a gap — a list left
 * unopened for a week produces ONE record, and saying so is more honest than showing only
 * the day it happened to roll over.
 */
const whenLabel = computed(() =>
  props.cycle.startedOn === props.cycle.endedOn
    ? formatDateShort(props.cycle.endedOn)
    : `${formatDateShort(props.cycle.startedOn)} – ${formatDateShort(props.cycle.endedOn)}`
);
</script>

<template>
  <button
    type="button"
    class="group dark:bg-surface-raised dark:border-line-strong flex flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-white text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
    @click="emit('open', cycle.id)"
  >
    <div
      class="relative flex items-center justify-between overflow-hidden px-3.5 py-2.5"
      :style="{ backgroundColor: `color-mix(in srgb, ${accent} 12%, transparent)` }"
    >
      <span class="z-[1] text-xl drop-shadow-sm" aria-hidden="true">{{ cycle.emoji }}</span>
      <MemberChip :member-id="cycle.ownerId" size="dot" />
      <span
        class="pointer-events-none absolute -right-1 -bottom-3 text-4xl opacity-[0.07]"
        aria-hidden="true"
        >{{ cycle.emoji }}</span
      >
    </div>

    <div class="flex flex-1 flex-col gap-2 p-3.5">
      <p class="font-outfit text-sm font-semibold text-[var(--color-text)]">{{ cycle.title }}</p>

      <div class="flex flex-wrap items-center justify-between gap-1.5">
        <span class="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
          <span class="h-2 w-2 flex-shrink-0 rounded-full" :style="{ backgroundColor: accent }" />
          {{ categoryLabel(cycle.category) }}
        </span>
        <!-- Quiet by design: history should not compete with live work for attention. -->
        <span
          class="inline-flex max-w-[12rem] items-center gap-1 truncate rounded-full bg-[var(--tint-slate-10)] px-2 py-0.5 text-xs font-semibold text-[var(--color-text-muted)]"
          :title="whenLabel"
        >
          <span aria-hidden="true">🗂</span> {{ whenLabel }}
        </span>
      </div>

      <div class="flex items-center gap-2">
        <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--tint-slate-5)]">
          <span
            class="block h-full rounded-full transition-all"
            :style="{ width: `${pct}%`, backgroundColor: accent }"
          />
        </span>
        <span class="text-xs font-medium text-[var(--color-text-muted)]">{{ progressLabel }}</span>
      </div>
    </div>
  </button>
</template>
