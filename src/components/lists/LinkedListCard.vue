<script setup lang="ts">
// One Beanie List (#33) embedded on a trip or an activity (#114). The same store entry as on the
// Lists page, so it is one source of truth; the containers (`LinkedLists`, `ActivityLists`) only
// loop over these.
//
// Design: the card is tinted by the list's own category color (the identity it carries on the
// Lists page), giving provenance for free; a "Beanie list" eyebrow + tappable header (with an
// "Open ›" affordance) deep-link back to the source list to edit it. A slim category-colored
// progress bar fills on mount (reduced-motion respected). Long lists clamp to keep the embed
// compact. `everySession` adds the "Every Session" tag for a list linked to the whole of a
// repeating activity.
import { computed, onMounted, ref } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useListStore } from '@/stores/listStore';
import { useFamilyStore } from '@/stores/familyStore';
import { getListCategory } from '@/constants/listCategories';
import { fillTemplate } from '@/utils/fillTemplate';
import { listProgress } from '@/utils/listLifecycle';
import ListItemRow from '@/components/lists/ListItemRow.vue';
import MemberChip from '@/components/ui/MemberChip.vue';
import EverySessionTag from '@/components/ui/EverySessionTag.vue';
import type { FamilyList } from '@/types/models';

const props = defineProps<{ list: FamilyList; everySession?: boolean }>();
const emit = defineEmits<{ open: [id: string] }>();

const { t } = useTranslation();
const listStore = useListStore();
const familyStore = useFamilyStore();

// How many items to show before clamping to a "+N more" door-back.
const PREVIEW_LIMIT = 5;

const card = computed(() => {
  const list = props.list;
  const { total, done, pct } = listProgress(list);
  return {
    accent: getListCategory(list.category)?.color ?? 'var(--color-primary-500)',
    done,
    total,
    pct,
    isComplete: total > 0 && done === total,
    isEmpty: total === 0,
    visibleItems: list.items.slice(0, PREVIEW_LIMIT),
    hiddenCount: Math.max(0, total - PREVIEW_LIMIT),
    progressLabel: fillTemplate(t('lists.progress'), {
      done: String(done),
      total: String(total),
    }),
    moreLabel: fillTemplate(t('lists.embed.more'), { count: String(total - PREVIEW_LIMIT) }),
  };
});

// Fill the progress bar from zero on mount (motion-reduce disables the transition, so a
// reduced-motion user just sees the final width).
const mounted = ref(false);
onMounted(() => requestAnimationFrame(() => (mounted.value = true)));

// The category tints are `color-mix(… transparent)`, so they sit on whatever surface is below in
// either theme. The accent reaches text only through `--card-accent` (the "Open ›" door-back),
// which the scoped dark rule lifts toward ink: an inline `color` would outrank any dark partner.
const headerStyle = computed<Record<string, string>>(() => ({
  background: `linear-gradient(135deg, color-mix(in srgb, ${card.value.accent} 13%, transparent), color-mix(in srgb, ${card.value.accent} 5%, transparent))`,
  '--card-accent': card.value.accent,
}));
function tint(pct: number): string {
  return `color-mix(in srgb, ${card.value.accent} ${pct}%, transparent)`;
}

function toggle(itemId: string): void {
  void listStore.toggleItem(props.list.id, itemId, familyStore.currentMember?.id ?? '');
}
</script>

<template>
  <article
    class="overflow-hidden rounded-[20px] shadow-[0_2px_10px_rgba(44,62,80,0.05)]"
    data-testid="linked-list-card"
  >
    <!-- Tinted header — the whole thing opens the source list to edit. -->
    <button
      type="button"
      class="grid w-full grid-cols-[44px_1fr] items-start gap-3 px-3.5 py-3.5 text-left transition-[filter] hover:brightness-[0.985] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary-500)]"
      :style="headerStyle"
      :aria-label="t('lists.embed.open')"
      @click="emit('open', list.id)"
    >
      <span
        class="grid h-11 w-11 place-items-center rounded-[14px] text-xl shadow-[0_2px_8px_rgba(44,62,80,0.06)]"
        :style="{ backgroundColor: tint(14) }"
        aria-hidden="true"
        >{{ list.emoji }}</span
      >
      <span class="min-w-0">
        <!-- Provenance eyebrow + door-back -->
        <span class="flex items-center justify-between gap-2">
          <span class="flex min-w-0 items-center gap-1.5">
            <span
              class="font-outfit flex items-center gap-1.5 text-xs font-bold tracking-[0.09em] text-[var(--color-text-muted)] uppercase"
            >
              <span
                class="h-[7px] w-[7px] flex-none rounded-full"
                :style="{ backgroundColor: card.accent }"
              />
              {{ t('lists.embed.provenance') }}
            </span>
            <EverySessionTag v-if="everySession" />
          </span>
          <span
            class="card-open font-outfit inline-flex flex-none items-center gap-0.5 text-xs font-bold"
            >{{ t('lists.embed.openShort')
            }}<span aria-hidden="true" class="text-xs leading-none">›</span></span
          >
        </span>

        <!-- Title = the hero -->
        <span
          class="font-outfit mt-0.5 block truncate text-base font-bold text-[var(--color-text)]"
          >{{ list.title }}</span
        >

        <!-- Progress bar + count + owner -->
        <span class="mt-2 flex items-center gap-2.5">
          <span
            v-if="!card.isEmpty"
            class="h-1.5 flex-1 overflow-hidden rounded-full"
            :style="{ backgroundColor: tint(16) }"
          >
            <span
              class="block h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none"
              :style="{
                width: mounted ? `${card.pct}%` : '0%',
                backgroundColor: card.accent,
              }"
            />
          </span>
          <span v-if="card.isEmpty" class="flex-1 text-xs text-[var(--color-text-muted)]">{{
            t('lists.embed.empty')
          }}</span>
          <span
            v-else-if="card.isComplete"
            class="dark:text-success-lift flex items-center gap-1 text-xs font-bold whitespace-nowrap text-[#27AE60]"
            ><span aria-hidden="true">✓</span>{{ t('lists.embed.allDone') }}</span
          >
          <span
            v-else
            class="text-xs font-semibold whitespace-nowrap text-[var(--color-text-muted)]"
            >{{ card.progressLabel }}</span
          >
          <MemberChip :member-id="list.ownerId" size="dot" />
        </span>
      </span>
    </button>

    <!-- Item rows — existing shared row (orange done-check). -->
    <div class="dark:bg-surface-raised bg-white px-3.5">
      <ListItemRow
        v-for="item in card.visibleItems"
        :key="item.id"
        :item="item"
        @toggle="(id: string) => toggle(id)"
      />
      <button
        v-if="card.hiddenCount > 0"
        type="button"
        class="flex w-full items-center justify-between py-2.5 text-xs font-semibold text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
        @click="emit('open', list.id)"
      >
        <span class="font-outfit">{{ card.moreLabel }}</span>
        <span class="inline-flex items-center gap-0.5"
          >{{ t('lists.embed.open') }}<span aria-hidden="true">›</span></span
        >
      </button>
    </div>
  </article>
</template>

<style scoped>
/* The category accent as text. On dark it is mixed toward ink (`--color-ink`), the same
   "accents get lighter" rule the `-lift` tokens follow, since a category color has no token. */
.card-open {
  color: var(--card-accent);
}

html.dark .card-open {
  color: color-mix(in srgb, var(--card-accent) 50%, var(--color-ink));
}
</style>
