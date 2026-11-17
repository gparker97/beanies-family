<script setup lang="ts">
/**
 * The one-line month chip's anatomy, once for every density (#141). Purely
 * presentational: its props say WHAT the chip shows (colour, wash, emoji, label, time,
 * faces); HOW it draws comes from the month chip context (`useMonthCellChips`,
 * `monthCellChipsKey.ts`), which only `MonthGridCell` and `MonthDayContents` provide.
 * The content adapters over it are `MonthChip` (activities) and `MonthSegmentChip`
 * (travel segments); neither carries a presentation prop.
 *
 *  - `compact`: 3px edge over the wash, emoji, title, faint start time, then faces
 *    (max 2 plus "+N").
 *  - `comfortable`: the chip the month grid has always drawn (time shown only where the
 *    context asks, the popover and day lists).
 *  - `titles`: a 2px edge and the label only, medium weight like every other chip label.
 *  - `bars`: a plain colour bar, no children.
 *  - Out-of-month days are not a frame concern: `MonthGridCell` fades its whole content
 *    block, so the frame always draws its normal ink and wash.
 *  - `interactive: false` (inside a phone cell, whose root is the button): an
 *    `aria-hidden` span with no click, so buttons never nest.
 *  - `interactive: true` also means "may be a drag source" (#142, `MonthDayItem` places the
 *    source): the button takes `select-none` and no iOS long-press callout.
 *  - `striped` (a view-only external event, `ExternalChip`): no left color bar and no
 *    wash; the `.view-only-stripes` utility (`style.css`) paints the stripes in `color`
 *    (passed as `--vo-hue`, never an inline background) and sets the lighter inks. Its
 *    hover touches the edge, never the text, so the frame's opacity hover stands down.
 *
 * Height is never set here. In the grid the cell passes `h-[var(--mg-chip-h)]` by
 * fallthrough; elsewhere the chip is content-sized. Data attributes (the reveal hooks)
 * also arrive by fallthrough, from `MonthDayItem`.
 */
import { computed } from 'vue';
import type { FamilyMember } from '@/types/models';
import ActivityOwnerStack from '@/components/ui/ActivityOwnerStack.vue';
import { useMonthCellChips } from '@/components/planner/monthCellChipsKey';

const props = withDefaults(
  defineProps<{
    /** Edge (and Bars) hue. */
    color: string;
    /** Background wash, already theme-aware (identity wash or a themed var). */
    wash?: string;
    dashed?: boolean;
    /** A genuine celebration: adds `is-celebration`, mirroring `AllDayChip`. */
    celebrating?: boolean;
    emoji?: string;
    label: string;
    time?: string;
    faces?: FamilyMember[];
    /** A one-owner chip: its face is dropped when the context says `hideSoloFace`. */
    solo?: boolean;
    /** A view-only external event: stripes in `color`, no edge bar (see the docblock). */
    striped?: boolean;
    /** The accessible name (an interactive chip only; a non-interactive one is aria-hidden). */
    spokenLabel: string;
    testid: string;
  }>(),
  {
    wash: undefined,
    dashed: false,
    celebrating: false,
    emoji: '',
    time: '',
    faces: () => [],
    solo: false,
    striped: false,
  }
);

const emit = defineEmits<{ click: [] }>();

const chips = useMonthCellChips();
const density = computed(() => chips.value.density);
const interactive = computed(() => chips.value.interactive);
const showTime = computed(() => chips.value.showTime && !!props.time);
const isRich = computed(() => density.value === 'compact' || density.value === 'comfortable');

const shownFaces = computed(() =>
  props.solo && chips.value.hideSoloFace ? [] : (props.faces ?? [])
);

/** One literal class set per density, so Tailwind's source scan sees every class. */
const DENSITY_CLASS: Record<string, string> = {
  compact:
    'font-inter w-full gap-1 overflow-hidden rounded-md border-l-[3px] pr-1 pl-1 text-left text-xs leading-none',
  comfortable:
    'font-inter w-full gap-1 overflow-hidden rounded-md border-l-[3px] py-0.5 pr-1.5 pl-1 text-left text-xs leading-tight',
  titles: 'w-full overflow-hidden rounded-xs border-l-2 px-1 text-left text-xs leading-none',
  bars: 'mx-1 rounded-full',
};

/** The same anatomy with no edge bar, for `striped`. Literal, for the same source scan. */
const STRIPED_CLASS: Record<string, string> = {
  compact:
    'view-only-stripes font-inter w-full gap-1 overflow-hidden rounded-md pr-1 pl-1 text-left text-xs leading-none',
  comfortable:
    'view-only-stripes font-inter w-full gap-1 overflow-hidden rounded-md py-0.5 pr-1.5 pl-1 text-left text-xs leading-tight',
  titles: 'view-only-stripes w-full overflow-hidden rounded-xs px-1 text-left text-xs leading-none',
  bars: 'view-only-stripes mx-1 rounded-full',
};

/** The start time's ink: faint on the stripes, the shared muted ink elsewhere. */
const timeInk = computed(() =>
  props.striped ? 'text-[var(--vo-ink-faint)]' : 'text-[var(--muted-text)]'
);

const rootClass = computed(() => {
  if (props.striped) {
    return [
      STRIPED_CLASS[density.value] ?? STRIPED_CLASS.comfortable,
      interactive.value ? 'cursor-pointer select-none [-webkit-touch-callout:none]' : '',
    ];
  }
  return [
    DENSITY_CLASS[density.value] ?? DENSITY_CLASS.comfortable,
    density.value === 'bars' ? '' : 'text-secondary-500 dark:text-ink',
    props.dashed && density.value !== 'bars' ? 'border-dashed' : '',
    props.celebrating && isRich.value ? 'is-celebration' : '',
    // A control is also a drag source (#142): no long-press callout or text selection.
    interactive.value
      ? 'cursor-pointer transition-opacity select-none hover:opacity-80 [-webkit-touch-callout:none]'
      : '',
  ];
});

const rootStyle = computed(() => {
  if (props.striped) return { '--vo-hue': props.color };
  if (density.value === 'bars') return { background: props.color };
  return props.wash
    ? { borderLeftColor: props.color, background: props.wash }
    : { borderLeftColor: props.color };
});

function onClick(event: MouseEvent) {
  if (!interactive.value) return;
  // A chip click opens its drawer and never also opens the day under it.
  event.stopPropagation();
  emit('click');
}
</script>

<template>
  <component
    :is="interactive ? 'button' : 'span'"
    :type="interactive ? 'button' : undefined"
    class="flex min-w-0 items-center"
    :class="rootClass"
    :style="rootStyle"
    :aria-label="interactive ? spokenLabel : undefined"
    :aria-hidden="interactive ? undefined : 'true'"
    :data-testid="testid"
    @click="onClick"
  >
    <template v-if="density === 'compact'">
      <slot name="decor" />
      <span v-if="emoji" aria-hidden="true" class="flex-shrink-0 text-[0.6875rem] leading-none">{{
        emoji
      }}</span>
      <span class="min-w-0 flex-1 truncate text-xs font-medium">{{ label }}</span>
      <span
        v-if="showTime"
        class="flex-shrink-0 text-xs font-normal tabular-nums"
        :class="timeInk"
        aria-hidden="true"
        >{{ time }}</span
      >
      <slot />
      <ActivityOwnerStack :members="shownFaces" size="2xs" :max="2" />
    </template>

    <template v-else-if="density === 'comfortable'">
      <slot name="decor" />
      <span v-if="emoji" aria-hidden="true" class="flex-shrink-0 text-[0.6875rem] leading-none">{{
        emoji
      }}</span>
      <span
        v-if="showTime"
        class="flex-shrink-0 font-medium tabular-nums"
        :class="timeInk"
        aria-hidden="true"
      >
        {{ time }}
      </span>
      <span class="min-w-0 flex-1 truncate font-medium">{{ label }}</span>
      <slot />
      <ActivityOwnerStack :members="shownFaces" size="xs" dense class="ml-0.5" />
    </template>

    <span
      v-else-if="density === 'titles'"
      class="min-w-0 flex-1 truncate text-xs leading-none font-medium"
      >{{ label }}</span
    >
  </component>
</template>
