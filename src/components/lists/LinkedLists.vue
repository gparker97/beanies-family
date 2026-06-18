<script setup lang="ts">
// Beanie Lists embedded on a trip OR an activity (#33): any list linked to the
// given entity renders here as a category-tinted card — same store entry, one
// source of truth. Pass exactly one of `vacationId` / `activityId`. Flag-guarded
// so it is inert when `familyLists` is off.
//
// Design: each card is tinted by the list's own category color (the identity it
// carries on the Lists page), giving provenance for free; a "Beanie list"
// eyebrow + tappable header (with an "Open ›" affordance) deep-link back to the
// source list to edit it. A slim category-colored progress bar fills on mount
// (reduced-motion respected). Long lists clamp to keep the embed compact.
import { computed, onMounted, ref } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useListStore } from '@/stores/listStore';
import { useFamilyStore } from '@/stores/familyStore';
import { getListCategory } from '@/constants/listCategories';
import { isFlagEnabled } from '@/config/flags';
import { fillTemplate } from '@/utils/fillTemplate';
import { listProgress } from '@/utils/listLifecycle';
import ListItemRow from '@/components/lists/ListItemRow.vue';
import MemberChip from '@/components/ui/MemberChip.vue';
import type { FamilyList, FamilyListItem } from '@/types/models';

const props = defineProps<{ vacationId?: string; activityId?: string }>();
const emit = defineEmits<{ open: [id: string] }>();

const { t } = useTranslation();
const listStore = useListStore();
const familyStore = useFamilyStore();

// How many items to show before clamping to a "+N more" door-back.
const PREVIEW_LIMIT = 5;

const linkedLists = computed<FamilyList[]>(() => {
  if (!isFlagEnabled('familyLists')) return [];
  return listStore.lists.filter((l) =>
    props.vacationId
      ? l.linkedVacationId === props.vacationId
      : props.activityId
        ? l.linkedActivityId === props.activityId
        : false
  );
});

interface ListCard {
  id: string;
  ownerId: string;
  emoji: string;
  title: string;
  accent: string;
  done: number;
  total: number;
  pct: number;
  isComplete: boolean;
  isEmpty: boolean;
  visibleItems: FamilyListItem[];
  hiddenCount: number;
  progressLabel: string;
  moreLabel: string;
}

const cards = computed<ListCard[]>(() =>
  linkedLists.value.map((list) => {
    const { total, done, pct } = listProgress(list);
    return {
      id: list.id,
      ownerId: list.ownerId,
      emoji: list.emoji,
      title: list.title,
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
  })
);

// Fill the progress bars from zero on mount (motion-reduce disables the
// transition, so a reduced-motion user just sees the final width).
const mounted = ref(false);
onMounted(() => requestAnimationFrame(() => (mounted.value = true)));

function headerStyle(accent: string): Record<string, string> {
  return {
    background: `linear-gradient(135deg, color-mix(in srgb, ${accent} 13%, transparent), color-mix(in srgb, ${accent} 5%, transparent))`,
  };
}
function tint(accent: string, pct: number): string {
  return `color-mix(in srgb, ${accent} ${pct}%, transparent)`;
}

function toggle(listId: string, itemId: string): void {
  void listStore.toggleItem(listId, itemId, familyStore.currentMember?.id ?? '');
}
</script>

<template>
  <section v-if="cards.length" class="mt-5">
    <!-- Section eyebrow — announces that linked checklists live here. -->
    <p
      class="font-outfit mb-2.5 flex items-center gap-1.5 text-xs font-bold tracking-[0.09em] text-[var(--color-text-muted)] uppercase"
    >
      <span aria-hidden="true">📋</span>{{ t('lists.embed.section') }}
    </p>

    <div class="space-y-3.5">
      <article
        v-for="card in cards"
        :key="card.id"
        class="overflow-hidden rounded-[20px] shadow-[0_2px_10px_rgba(44,62,80,0.05)]"
      >
        <!-- Tinted header — the whole thing opens the source list to edit. -->
        <button
          type="button"
          class="grid w-full grid-cols-[44px_1fr] items-start gap-3 px-3.5 py-3.5 text-left transition-[filter] hover:brightness-[0.985] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary-500)]"
          :style="headerStyle(card.accent)"
          :aria-label="t('lists.embed.open')"
          @click="emit('open', card.id)"
        >
          <span
            class="grid h-11 w-11 place-items-center rounded-[14px] text-[1.375rem] shadow-[0_2px_8px_rgba(44,62,80,0.06)]"
            :style="{ backgroundColor: tint(card.accent, 14) }"
            aria-hidden="true"
            >{{ card.emoji }}</span
          >
          <span class="min-w-0">
            <!-- Provenance eyebrow + door-back -->
            <span class="flex items-center justify-between gap-2">
              <span
                class="font-outfit flex items-center gap-1.5 text-xs font-bold tracking-[0.09em] text-[var(--color-text-muted)] uppercase"
              >
                <span
                  class="h-[7px] w-[7px] flex-none rounded-full"
                  :style="{ backgroundColor: card.accent }"
                />
                {{ t('lists.embed.provenance') }}
              </span>
              <span
                class="font-outfit inline-flex flex-none items-center gap-0.5 text-xs font-bold"
                :style="{ color: card.accent }"
                >{{ t('lists.embed.openShort')
                }}<span aria-hidden="true" class="text-xs leading-none">›</span></span
              >
            </span>

            <!-- Title = the hero -->
            <span
              class="font-outfit mt-0.5 block truncate text-[0.9375rem] font-bold text-[var(--color-text)]"
              >{{ card.title }}</span
            >

            <!-- Progress bar + count + owner -->
            <span class="mt-2 flex items-center gap-2.5">
              <span
                v-if="!card.isEmpty"
                class="h-1.5 flex-1 overflow-hidden rounded-full"
                :style="{ backgroundColor: tint(card.accent, 16) }"
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
                class="flex items-center gap-1 text-xs font-bold whitespace-nowrap text-[#27AE60]"
                ><span aria-hidden="true">✓</span>{{ t('lists.embed.allDone') }}</span
              >
              <span
                v-else
                class="text-xs font-semibold whitespace-nowrap text-[var(--color-text-muted)]"
                >{{ card.progressLabel }}</span
              >
              <MemberChip :member-id="card.ownerId" size="dot" />
            </span>
          </span>
        </button>

        <!-- Item rows — existing shared row (orange done-check). -->
        <div class="bg-white px-3.5 dark:bg-slate-800">
          <ListItemRow
            v-for="item in card.visibleItems"
            :key="item.id"
            :item="item"
            @toggle="(id: string) => toggle(card.id, id)"
          />
          <button
            v-if="card.hiddenCount > 0"
            type="button"
            class="flex w-full items-center justify-between py-2.5 text-[0.75rem] font-semibold text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
            @click="emit('open', card.id)"
          >
            <span class="font-outfit">{{ card.moreLabel }}</span>
            <span class="inline-flex items-center gap-0.5"
              >{{ t('lists.embed.open') }}<span aria-hidden="true">›</span></span
            >
          </button>
        </div>
      </article>
    </div>
  </section>
</template>
