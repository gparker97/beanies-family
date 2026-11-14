<script setup lang="ts">
/**
 * The read-only summary of one bean's day, opened from a Chores Done cell (#146): "{Name},
 * {Weekday}", "7 of 11 done" with a bar, then the chores done and not done, grouped by time of
 * day. Today's adds "Open {Name}'s Day" (where today can still be ticked) when the board offers
 * it. It lists the SAME `ChoreDayRecord` the cell counted, handed in by the board, so the number
 * in the cell and the list here cannot disagree.
 *
 * Shapes, as `TimePickerHost` draws them (the app's anchored-overlay pattern):
 *  - PHONE (`useBreakpoint().isMobile`, under 768px): a bottom sheet over a dim.
 *  - 768px AND UP: a card anchored to the cell (teleported, fixed, `useAnchoredPosition`): below
 *    or above it, or beside it on the left when the board sits in the right-hand rail
 *    (`side="start"`), so it covers the page rather than the board.
 * The overlay contract is `useAnchoredOverlay` (Escape on both shapes; the sheet joins the
 * overlay stack with scroll lock; focus returns to the cell on close) plus ONE outside-click
 * path (`useOutsideClick`, capture phase), with the card and the cell as inside: the dim is
 * outside both, so a tap on it closes through the same handler.
 *
 * Dark mode: the card is `surface-overlay` (a popover over a raised card) with a `line-strong`
 * edge; group heads use the block tint and ink (`.chore-block-*`); a chore not done is
 * `ink-soft`; the done mark is the brand gradient with white ink in both themes.
 */
import { computed, nextTick, ref, toRef, watch } from 'vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import { useAnchoredOverlay } from '@/composables/useAnchoredOverlay';
import { ANCHORED_POPOVER_Z_INDEX, useAnchoredPosition } from '@/composables/useAnchoredPosition';
import { useElementSize } from '@/composables/useElementSize';
import { useMemberAvatarBindings } from '@/composables/useMemberAvatar';
import { useOutsideClick } from '@/composables/useOutsideClick';
import { useTranslation } from '@/composables/useTranslation';
import { CHORE_BLOCK_META, choreEmoji } from '@/constants/choreBlocks';
import { fillTemplate } from '@/utils/fillTemplate';
import type { ChoreDayRecord } from '@/utils/chores';
import type { FamilyMember } from '@/types/models';

const SURFACE = 'choreboard';

const props = withDefaults(
  defineProps<{
    open: boolean;
    member: FamilyMember | null;
    record: ChoreDayRecord | null;
    /** The bean's first name and the full weekday. */
    name: string;
    weekday: string;
    isToday: boolean;
    /** The cell it hangs from; focus returns here on close. */
    anchor: HTMLElement | null;
    side?: 'below' | 'start';
    /** Offer "Open {Name}'s Day" on today's summary. */
    openDayAction?: boolean;
  }>(),
  { side: 'below', openDayAction: false }
);

const emit = defineEmits<{ close: []; 'open-day': [] }>();

const { t } = useTranslation();
const { memberAvatarBindings } = useMemberAvatarBindings();

const isOpen = computed(() => props.open && !!props.record && !!props.member);
const cardEl = ref<HTMLElement | null>(null);
const anchorRef = toRef(props, 'anchor');

function close(): void {
  emit('close');
}

const { isMobile } = useAnchoredOverlay(isOpen, close, { surface: SURFACE });
useOutsideClick(isOpen, [cardEl, anchorRef], close);

const popoverOpen = computed(() => isOpen.value && !isMobile.value);
const { popoverStyle, reposition } = useAnchoredPosition({
  anchorRef,
  popoverRef: cardEl,
  active: popoverOpen,
  align: 'end',
  side: () => props.side,
  widthEstimate: 320,
  heightEstimate: 480,
});
const { height: cardHeight } = useElementSize(cardEl, { surface: SURFACE });
watch([cardHeight, anchorRef], () => {
  if (popoverOpen.value) reposition();
});

watch(isOpen, (open) => {
  if (!open) return;
  void nextTick(() => {
    if (popoverOpen.value) reposition();
    // Into the card, so Escape and Tab start there; the close button is the first stop.
    cardEl.value?.querySelector<HTMLElement>('[data-testid="chore-day-popover-close"]')?.focus({
      preventScroll: true,
    });
  });
});

const zIndex = String(ANCHORED_POPOVER_Z_INDEX);

const title = computed(() =>
  fillTemplate(t(props.isToday ? 'choreboard.pop.titleToday' : 'choreboard.pop.title'), {
    name: props.name,
    day: props.weekday,
  })
);

const subtitle = computed(() => {
  const r = props.record;
  if (!r) return '';
  if (r.total === 0) return t('choreboard.pop.noChores');
  if (r.done === 0)
    return t(props.isToday ? 'choreboard.pop.nothingYet' : 'choreboard.pop.nothing');
  return fillTemplate(t('choreboard.summary.done'), { done: r.done, total: r.total });
});

const pct = computed(() => {
  const r = props.record;
  return r && r.total ? Math.round((r.done / r.total) * 100) : 0;
});

/** Each block's chores, the done ones first, each list in chore order. */
const groups = computed(() =>
  (props.record?.blocks ?? []).map((b) => ({
    ...b,
    meta: CHORE_BLOCK_META[b.block],
    items: [...b.chores.filter((i) => i.done), ...b.chores.filter((i) => !i.done)],
  }))
);

const openDayLabel = computed(() =>
  fillTemplate(t('choreboard.pop.openDay'), { name: props.name })
);
const itemLabel = (title: string, done: boolean) =>
  fillTemplate(t(done ? 'choreboard.pop.itemDone' : 'choreboard.pop.itemNotDone'), {
    chore: title,
  });
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-150 motion-reduce:transition-none"
      enter-from-class="opacity-0"
      leave-active-class="transition-opacity duration-100 motion-reduce:transition-none"
      leave-to-class="opacity-0"
    >
      <!-- Phone only. No click handler: the outside-click handler closes on it. `cursor-pointer`
           is load-bearing: iOS Safari dispatches no click for a tap on a plain div otherwise. -->
      <div
        v-if="isOpen && isMobile"
        class="fixed inset-0 cursor-pointer bg-[rgb(44_62_80/0.35)] dark:bg-black/50"
        :style="{ zIndex }"
        data-testid="chore-day-popover-dim"
        aria-hidden="true"
      />
    </Transition>
    <Transition
      enter-active-class="transition duration-150 ease-out motion-reduce:transition-none"
      :enter-from-class="isMobile ? 'translate-y-3 opacity-60' : '-translate-y-1 opacity-0'"
      leave-active-class="transition duration-100 ease-in motion-reduce:transition-none"
      leave-to-class="opacity-0"
    >
      <div
        v-if="isOpen && record && member"
        ref="cardEl"
        role="dialog"
        :aria-modal="isMobile ? 'true' : undefined"
        :aria-label="title"
        tabindex="-1"
        class="dark:bg-surface-overlay dark:border-line-strong overflow-y-auto overscroll-contain border border-[var(--tint-slate-10)] bg-white p-3.5 text-left focus:outline-none"
        :class="
          isMobile
            ? 'fixed inset-x-0 bottom-0 max-h-[75dvh] rounded-t-3xl pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-[0_-10px_30px_rgba(44,62,80,0.16)] dark:shadow-[0_-10px_30px_rgba(0,0,0,0.5)]'
            : 'max-h-[min(36rem,calc(100dvh-1rem))] w-80 max-w-[calc(100vw-1rem)] rounded-[1.25rem] shadow-[0_14px_44px_rgba(44,62,80,0.2)] dark:shadow-[0_14px_44px_rgba(0,0,0,0.45)]'
        "
        :style="isMobile ? { zIndex } : popoverStyle"
        data-testid="chore-day-popover"
        :data-ymd="record.ymd"
        :data-member-id="member.id"
      >
        <div
          v-if="isMobile"
          class="dark:bg-line-strong mx-auto -mt-1 mb-2.5 h-1 w-10 rounded-full bg-[var(--color-border-strong)]"
          aria-hidden="true"
        />
        <div class="flex items-center gap-2.5">
          <BeanieAvatar v-bind="memberAvatarBindings(member)" size="sm" />
          <div class="min-w-0 flex-1">
            <p
              class="font-outfit dark:text-ink text-secondary-500 truncate text-base leading-tight font-bold"
            >
              {{ title }}
            </p>
            <p
              class="font-outfit dark:text-ink-soft text-secondary-500 text-sm font-semibold"
              data-testid="chore-day-popover-count"
            >
              {{ subtitle }}
            </p>
          </div>
          <button
            type="button"
            class="dark:text-ink-faint dark:hover:bg-surface-hover text-secondary-400 hover:text-primary-500 dark:hover:text-accent-lift focus-visible:ring-sky-silk-300 flex h-9 w-9 flex-none items-center justify-center rounded-xl hover:bg-[var(--tint-slate-5)] focus-visible:ring-2 focus-visible:outline-none"
            :aria-label="t('action.close')"
            data-testid="chore-day-popover-close"
            @click="close"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        <div
          v-if="record.total > 0"
          class="mt-2.5 mb-1 h-1.5 overflow-hidden rounded-full bg-[var(--tint-slate-10)]"
          aria-hidden="true"
        >
          <span
            class="from-primary-500 to-terracotta-400 block h-full rounded-full bg-gradient-to-r"
            :style="{ width: `${pct}%` }"
          />
        </div>

        <div
          v-for="g in groups"
          :key="g.block"
          class="mt-2.5"
          data-testid="chore-day-popover-group"
          :data-block="g.block"
        >
          <div
            class="font-outfit flex items-center gap-1.5 rounded-xl bg-[var(--chore-tint)] px-2.5 py-1 text-xs font-bold text-[var(--chore-ink)]"
            :class="g.meta.colorClass"
          >
            <span aria-hidden="true">{{ g.meta.emoji }}</span>
            <span class="flex-1">{{ t(g.meta.labelKey) }}</span>
            <span class="dark:text-ink text-secondary-500">
              <template v-if="g.done === g.total"
                ><span aria-hidden="true">⭐ </span>{{ t('choreboard.block.allDone') }}</template
              >
              <template v-else>{{
                fillTemplate(t('choreboard.block.count'), { done: g.done, total: g.total })
              }}</template>
            </span>
          </div>
          <ul class="mt-1 pl-1">
            <li
              v-for="i in g.items"
              :key="i.chore.id"
              class="flex items-center gap-2 py-[3px] text-sm"
              :class="
                i.done
                  ? 'dark:text-ink text-secondary-500'
                  : 'dark:text-ink-soft text-secondary-400'
              "
              data-testid="chore-day-popover-item"
              :data-chore-id="i.chore.id"
              :data-done="i.done ? 'true' : 'false'"
            >
              <span
                class="flex h-5 w-5 flex-none items-center justify-center rounded-full"
                :class="
                  i.done
                    ? 'from-primary-500 to-terracotta-400 bg-gradient-to-br text-white'
                    : 'border-secondary-400 dark:border-line-strong border-2'
                "
                aria-hidden="true"
              >
                <svg
                  v-if="i.done"
                  class="h-3 w-3"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="3.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              </span>
              <span class="w-5 text-center" aria-hidden="true">{{ choreEmoji(i.chore) }}</span>
              <span class="min-w-0 flex-1 truncate" aria-hidden="true">{{ i.chore.title }}</span>
              <span class="sr-only">{{ itemLabel(i.chore.title, i.done) }}</span>
            </li>
          </ul>
        </div>

        <div
          class="dark:border-line dark:text-ink-faint text-secondary-400 mt-3 flex items-center justify-between gap-2 border-t border-[var(--color-border)] pt-2.5 text-xs"
        >
          <span>{{ t(isToday ? 'choreboard.pop.footToday' : 'choreboard.pop.footPast') }}</span>
          <button
            v-if="isToday && openDayAction"
            type="button"
            class="font-outfit text-primary-700 dark:text-accent-lift focus-visible:ring-sky-silk-300 inline-flex items-center gap-1 rounded-[0.875rem] bg-[var(--tint-orange-8)] px-3 py-1.5 text-sm font-bold whitespace-nowrap focus-visible:ring-2 focus-visible:outline-none"
            data-testid="chore-day-popover-open-day"
            @click="emit('open-day')"
          >
            {{ openDayLabel }} <span aria-hidden="true">→</span>
          </button>
          <span v-else-if="!isToday">{{ t('choreboard.pop.readOnly') }}</span>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
