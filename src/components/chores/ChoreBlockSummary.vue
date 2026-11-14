<script setup lang="ts">
/**
 * One time of day in a bean's day as a one-glance summary (#146): its glyph and name, the hours
 * hint, "3 of 5" with a slim bar in the block's colour, the Heritage Orange ring and "Now" tag
 * on the block happening now. A finished block shows its stars and "All Done"; a block whose
 * time has passed with chores left shows an orange "2 left" pill (Heritage Orange, never red).
 *
 * The ONE summary, drawn by the home card (where a row opens to its chores, passed in the
 * default slot) and by the day page's "Today" rail (where a row jumps to its block):
 *  - `variant="row"` (default): the full-width row. `mode="toggle"` makes the row a disclosure
 *    (`aria-expanded`, the slot shows when `expanded`); `mode="jump"` says where it goes.
 *  - `variant="tile"`: the phone strip's small tile (a ring for the share done), jump only.
 * Either way it emits `activate`; what that does is the parent's.
 *
 * Every state comes from the read model (`ChoreDayBlock`); nothing here decides done or now.
 * Colours: the block's tint and ink come from `.chore-block-*` (`src/style.css`, with their dark
 * partners); a finished block is the orange tint with `primary-700` / `accent-lift` ink; the
 * bar's track is `--tint-slate-10`, which switches with the theme.
 */
import { computed, useId } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { CHORE_BLOCK_META, choreBlockHint } from '@/constants/choreBlocks';
import { fillTemplate } from '@/utils/fillTemplate';
import type { ChoreDayBlock } from '@/utils/chores';
import type { ChoreBlockStarts } from '@/types/models';

const props = withDefaults(
  defineProps<{
    block: ChoreDayBlock;
    starts: ChoreBlockStarts;
    /** The bean's first name, for "Nice work, {name}." */
    beanName: string;
    variant?: 'row' | 'tile';
    mode?: 'toggle' | 'jump';
    /** `mode="toggle"`: the chores (the default slot) are showing. */
    expanded?: boolean;
  }>(),
  { variant: 'row', mode: 'toggle', expanded: false }
);

const emit = defineEmits<{ activate: [] }>();

const { t } = useTranslation();
const rowsId = useId();

const meta = computed(() => CHORE_BLOCK_META[props.block.block]);
const label = computed(() => t(meta.value.labelKey));
const left = computed(() => props.block.total - props.block.done);

/** done: every chore ticked; left: its time passed with some to do; open: anything else. */
const state = computed<'done' | 'left' | 'open'>(() => {
  if (props.block.allDone) return 'done';
  return props.block.ended ? 'left' : 'open';
});

/** Anytime has no hours, so its row carries no hint. */
const hint = computed(() =>
  props.block.block === 'anytime' ? '' : choreBlockHint(props.block, props.starts, t)
);
const count = computed(() =>
  fillTemplate(t('choreboard.block.count'), { done: props.block.done, total: props.block.total })
);
const leftText = computed(() =>
  fillTemplate(
    t(left.value === 1 ? 'choreboard.summary.left.one' : 'choreboard.summary.left.other'),
    { count: left.value }
  )
);
const stars = computed(() => '⭐'.repeat(props.block.total));
/** Under a finished row: a word for the bean while it is still now, the tally after. */
const doneNote = computed(() =>
  props.block.isNow
    ? fillTemplate(t('choreboard.summary.niceWork'), { name: props.beanName })
    : fillTemplate(t('choreboard.summary.done'), {
        done: props.block.done,
        total: props.block.total,
      })
);
const pct = computed(() =>
  props.block.total ? Math.round((props.block.done / props.block.total) * 100) : 0
);
const goTo = computed(() => fillTemplate(t('choreboard.summary.goTo'), { block: label.value }));

/** The tile's ring: a 36px circle, r 15, so its circumference is 2πr. */
const RING_C = 2 * Math.PI * 15;
const ringDash = computed(() => `${(pct.value / 100) * RING_C} ${RING_C}`);

const showSlot = computed(() => props.mode === 'toggle' && props.expanded);
</script>

<template>
  <!-- ═══ Row ═══ -->
  <section
    v-if="variant === 'row'"
    class="relative rounded-2xl"
    :class="[
      state === 'done' ? 'bg-[var(--tint-orange-8)]' : ['bg-[var(--chore-tint)]', meta.colorClass],
      block.isNow ? 'ring-primary-500 mt-1.5 shadow-[0_8px_22px_rgba(241,93,34,0.14)] ring-2' : '',
    ]"
    data-testid="chore-summary"
    :data-block="block.block"
    :data-state="state"
    :data-now="block.isNow ? 'true' : 'false'"
  >
    <button
      type="button"
      class="focus-visible:ring-sky-silk-300 grid w-full grid-cols-[1.75rem_minmax(0,1fr)_auto_1rem] items-center gap-x-2 gap-y-1.5 rounded-2xl px-2.5 py-2 text-left focus-visible:ring-2 focus-visible:outline-none"
      :class="
        state === 'done' ? 'text-primary-700 dark:text-accent-lift' : 'text-[var(--chore-ink)]'
      "
      :aria-expanded="mode === 'toggle' ? (expanded ? 'true' : 'false') : undefined"
      :aria-controls="mode === 'toggle' && expanded ? rowsId : undefined"
      data-testid="chore-summary-toggle"
      @click="emit('activate')"
    >
      <span
        v-if="block.isNow"
        class="font-outfit from-primary-500 to-terracotta-400 absolute -top-2.5 right-8 z-[1] rounded-full bg-gradient-to-br px-2 text-xs leading-normal font-bold text-white"
        data-testid="chore-summary-now"
        >{{ t('choreboard.now.tag') }}</span
      >
      <span class="row-span-2 text-center text-xl leading-none" aria-hidden="true">{{
        meta.emoji
      }}</span>
      <span class="font-outfit min-w-0 truncate text-sm font-bold">
        {{ label }}
        <span v-if="hint" class="font-inter ml-1 text-xs font-medium">{{ hint }}</span>
      </span>
      <span
        class="font-outfit inline-flex items-center gap-1.5 text-sm font-bold whitespace-nowrap"
        :class="state === 'done' ? '' : 'dark:text-ink text-secondary-500'"
      >
        <template v-if="state === 'done'">{{ t('choreboard.block.allDone') }}</template>
        <span
          v-else-if="state === 'left'"
          class="text-primary-700 dark:text-accent-lift rounded-full bg-[var(--tint-orange-15)] px-2 py-0.5 text-xs"
          data-testid="chore-summary-left"
          >{{ leftText }}</span
        >
        <template v-else>{{ count }}</template>
      </span>
      <svg
        class="row-span-2 h-4 w-4 transition-transform duration-200 motion-reduce:transition-none"
        :class="mode === 'toggle' && expanded ? 'rotate-90' : ''"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          fill-rule="evenodd"
          d="M7.2 14.8a.75.75 0 0 1 0-1.06L10.94 10 7.2 6.26a.75.75 0 1 1 1.06-1.06l4.27 4.27a.75.75 0 0 1 0 1.06L8.26 14.8a.75.75 0 0 1-1.06 0Z"
          clip-rule="evenodd"
        />
      </svg>
      <span
        v-if="state === 'done'"
        class="dark:text-ink-soft text-secondary-500 col-span-2 col-start-2 truncate text-xs"
        data-testid="chore-summary-note"
      >
        <span class="tracking-tighter" aria-hidden="true">{{ stars }}</span>
        {{ doneNote }}
      </span>
      <span
        v-else
        class="col-span-2 col-start-2 block h-1.5 overflow-hidden rounded-full bg-[var(--tint-slate-10)]"
        aria-hidden="true"
      >
        <span
          class="block h-full rounded-full bg-[var(--chore-ink)] transition-[width] duration-300 motion-reduce:transition-none"
          :style="{ width: `${pct}%` }"
        />
      </span>
      <span v-if="mode === 'jump'" class="sr-only">{{ goTo }}</span>
    </button>
    <div v-if="showSlot" :id="rowsId" class="px-1.5 pb-1.5">
      <slot />
    </div>
  </section>

  <!-- ═══ Tile (the phone strip) ═══ -->
  <button
    v-else
    type="button"
    class="focus-visible:ring-sky-silk-300 relative flex min-w-0 flex-col items-center gap-0.5 rounded-2xl px-1 pt-2 pb-1.5 text-center focus-visible:ring-2 focus-visible:outline-none"
    :class="[
      state === 'done'
        ? 'text-primary-700 dark:text-accent-lift bg-[var(--tint-orange-8)]'
        : ['bg-[var(--chore-tint)] text-[var(--chore-ink)]', meta.colorClass],
      block.isNow ? 'ring-primary-500 ring-2' : '',
    ]"
    data-testid="chore-summary"
    :data-block="block.block"
    :data-state="state"
    :data-now="block.isNow ? 'true' : 'false'"
    @click="emit('activate')"
  >
    <span
      v-if="block.isNow"
      class="font-outfit from-primary-500 to-terracotta-400 absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-br px-1.5 text-xs leading-snug font-bold text-white"
      data-testid="chore-summary-now"
      >{{ t('choreboard.now.tag') }}</span
    >
    <span class="relative h-9 w-9" aria-hidden="true">
      <svg class="h-9 w-9 -rotate-90" viewBox="0 0 36 36">
        <circle
          cx="18"
          cy="18"
          r="15"
          fill="none"
          stroke-width="4"
          class="[stroke:var(--tint-slate-10)]"
        />
        <circle
          cx="18"
          cy="18"
          r="15"
          fill="none"
          stroke-width="4"
          stroke-linecap="round"
          :stroke-dasharray="ringDash"
          :class="
            state === 'done' ? '[stroke:var(--color-primary-500)]' : '[stroke:var(--chore-ink)]'
          "
        />
      </svg>
      <span class="absolute inset-0 flex items-center justify-center text-base">{{
        meta.emoji
      }}</span>
    </span>
    <span class="font-outfit max-w-full truncate text-xs leading-tight font-bold">{{ label }}</span>
    <span
      v-if="state === 'left'"
      class="font-outfit text-primary-700 dark:text-accent-lift max-w-full truncate rounded-full bg-[var(--tint-orange-15)] px-1.5 text-xs font-bold"
      data-testid="chore-summary-left"
      >{{ leftText }}</span
    >
    <span
      v-else
      class="font-outfit max-w-full truncate text-xs leading-tight font-semibold"
      :class="state === 'done' ? '' : 'dark:text-ink text-secondary-500'"
    >
      <template v-if="state === 'done'"
        ><span aria-hidden="true">⭐ </span>{{ t('choreboard.block.allDone') }}</template
      >
      <template v-else>{{ count }}</template>
    </span>
    <span class="sr-only">{{ goTo }}</span>
  </button>
</template>
