<script setup lang="ts">
/**
 * Who Owns What (#109): "By Category" on the Overview. One row per category with cards in
 * play (anything not skipped): a held / waiting / still-to-sort bar, "N to sort", "N waiting"
 * or "All N dealt", and the faces of whoever holds cards there. Coverage, never comparison: faces only, no per-person counts.
 *
 * Desktop: one line per category. Phone: name and faces, then the bar and count beneath.
 */
import { useTranslation } from '@/composables/useTranslation';
import { useListCategoryLabel } from '@/composables/useListCategoryLabel';
import { useFamilyStore } from '@/stores/familyStore';
import { getListCategory } from '@/constants/listCategories';
import { fillTemplate } from '@/utils/fillTemplate';
import type { CategoryCoverage } from '@/utils/responsibilityDeck';
import type { FamilyMember } from '@/types/models';
import ActivityOwnerStack from '@/components/ui/ActivityOwnerStack.vue';

defineProps<{ rows: readonly CategoryCoverage[] }>();

const { t } = useTranslation();
const { categoryLabel } = useListCategoryLabel();
const familyStore = useFamilyStore();

function label(row: CategoryCoverage): string {
  const def = getListCategory(row.category);
  return def ? `${def.emoji} ${categoryLabel(def.id)}` : `📁 ${t('lists.category.other')}`;
}

function faces(row: CategoryCoverage): FamilyMember[] {
  return row.holderIds
    .map((id) => familyStore.members.find((m) => m.id === id))
    .filter((m): m is FamilyMember => !!m);
}
</script>

<template>
  <ul class="space-y-3.5" data-testid="category-coverage">
    <li
      v-for="row in rows"
      :key="row.category"
      class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 sm:grid-cols-[minmax(0,10rem)_minmax(4rem,1fr)_6.5rem_auto]"
    >
      <span
        class="font-outfit dark:text-ink order-1 truncate text-sm font-semibold text-[var(--color-text)]"
      >
        {{ label(row) }}
      </span>
      <span
        class="bar dark:bg-surface-overlay order-3 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-[var(--tint-slate-5)] sm:order-2"
        role="img"
        :aria-label="
          fillTemplate(t('whoOwnsWhat.overview.ringLabel'), { held: row.held, total: row.deck })
        "
      >
        <span
          v-if="row.held"
          class="from-primary-500 to-terracotta-400 rounded-full bg-gradient-to-r"
          :style="{ flex: row.held }"
        />
        <span v-if="row.waiting" class="waiting rounded-full" :style="{ flex: row.waiting }" />
        <span v-if="row.unsorted" class="unsorted rounded-full" :style="{ flex: row.unsorted }" />
      </span>
      <span
        class="order-4 text-xs whitespace-nowrap tabular-nums sm:order-3"
        :class="
          row.unsorted
            ? 'dark:text-ink-soft font-semibold text-[var(--color-text-muted)]'
            : row.waiting
              ? 'text-primary-500 dark:text-accent-lift font-semibold'
              : 'dark:text-ink-faint text-[var(--color-text-muted)]'
        "
        :data-testid="`category-coverage-count-${row.category}`"
      >
        {{
          row.unsorted
            ? fillTemplate(t('whoOwnsWhat.overview.catToSort'), { count: row.unsorted })
            : row.waiting
              ? fillTemplate(t('whoOwnsWhat.overview.catWaiting'), { count: row.waiting })
              : fillTemplate(t('whoOwnsWhat.overview.allDealt'), { count: row.deck })
        }}
      </span>
      <span class="order-2 justify-self-end sm:order-4">
        <ActivityOwnerStack :members="faces(row)" size="xs" :max="4" />
      </span>
    </li>
  </ul>
</template>

<style scoped>
.waiting {
  background: repeating-linear-gradient(135deg, #f15d22 0 2px, transparent 2px 6px);
}

html.dark .waiting {
  background: repeating-linear-gradient(
    135deg,
    var(--color-accent-lift) 0 2px,
    transparent 2px 6px
  );
}

.unsorted {
  background: rgb(241 93 34 / 14%);
}

html.dark .unsorted {
  background: color-mix(in srgb, var(--color-accent-lift) 18%, transparent);
}
</style>
