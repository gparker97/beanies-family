<script setup lang="ts">
/**
 * One event on the time grid.
 *
 * Replaces `WallEventChip`, which printed its own start time above the title.
 * On a grid the axis carries the time, so the block does not — and that
 * reclaimed line is exactly what makes seven day columns readable at tablet
 * width. It is the reason the grid pays for itself.
 *
 * Presentational: it takes a RESOLVED `identity` rather than deriving one, for
 * the same reason the chip did. The rule is written once in `useActivityIdentity`
 * and the parent has already computed it to lay the grid out; deriving here
 * would classify per block per render and could disagree with its own parent.
 *
 * Density is chosen from the width THIS BLOCK gets — `laneWidth × columnWidth` —
 * not from the column's width, because the second half of a collision is a
 * different size from the first. Borrowed from Fantastical, whose overlap rule
 * degrades what is INSIDE the block rather than the block itself.
 */
import { computed } from 'vue';
import ActivityOwnerStack from '@/components/ui/ActivityOwnerStack.vue';
import CelebrationConfetti from '@/components/ui/CelebrationConfetti.vue';
import { useTranslation } from '@/composables/useTranslation';
import type { ActivityIdentity } from '@/composables/useActivityIdentity';
import type { FamilyActivity } from '@/types/models';
// The density thresholds live in wallLayout.ts, beside the column-width rules
// that are defined in terms of them — see the three-widths block there.
import { BLOCK_FULL_PX, BLOCK_SLIVER_PX } from '@/components/wall/wallLayout';

/** Below this the "now" marker would collide with the title. */
const NOW_TAG_MIN_PX = 150;
/** A block shorter than this has no room for a second line. */
const META_MIN_HEIGHT_PX = 46;
/** Below this even the owner faces do not fit. */
const FACES_MIN_HEIGHT_PX = 30;
/** Above this a block is mostly empty, so its content sits at the optical centre. */
const TALL_PX = 90;

const props = defineProps<{
  activity: FamilyActivity;
  identity: ActivityIdentity;
  /** Rendered width in px, already divided by the lane share. */
  width: number;
  height: number;
  capped: boolean;
  state: 'past' | 'running' | 'future';
  /** 0-100, only meaningful while `state === 'running'`. */
  progress: number;
  timeRange: string;
  ownerNames: string;
  /**
   * Carry the owner's colour as a WASH, not just an edge.
   *
   * ⚠️ True on day columns, false inside a bean lane — and the difference is the
   * lane rule, not a style toggle. A card shows what the surrounding context has
   * not already said: in a lane the COLUMN is already that bean's colour, so a
   * washed card on a washed lane is tint on tint and the card stops standing out
   * against its own background. On a day column nothing else says whose it is,
   * so the card says it.
   */
  washed?: boolean;
}>();
defineEmits<{ open: [] }>();

const { t } = useTranslation();

const density = computed<'full' | 'tight' | 'sliver'>(() =>
  props.width < BLOCK_SLIVER_PX ? 'sliver' : props.width > BLOCK_FULL_PX ? 'full' : 'tight'
);
/**
 * A capped block ALWAYS states its range once there is room, so the clamp is
 * visible rather than silent — otherwise a three-hour event and a one-hour event
 * are the same size with nothing saying why.
 */
const showMeta = computed(
  () =>
    density.value !== 'sliver' &&
    props.height >= META_MIN_HEIGHT_PX &&
    (density.value === 'full' || props.capped)
);
const showFaces = computed(
  () =>
    density.value !== 'sliver' &&
    props.height >= FACES_MIN_HEIGHT_PX &&
    props.identity.stackMembers.length > 0
);
const showNowTag = computed(() => props.state === 'running' && props.width >= NOW_TAG_MIN_PX);
const subtitle = computed(() =>
  props.ownerNames ? `${props.timeRange} · ${props.ownerNames}` : props.timeRange
);

/**
 * ⚠️ The accessible name MUST carry the time.
 *
 * An explicit `aria-label` replaces the element's contents for assistive tech,
 * so labelling the button with the bare title dropped the one thing a grid
 * expresses only as PIXEL POSITION. A screen-reader user could not tell a 07:30
 * school run from a 19:30 bath time — and the detail line is not rendered at all
 * at tight density, so there was no textual time anywhere on the week view.
 */
const accessibleName = computed(() => `${props.timeRange} ${props.activity.title}`);
</script>

<template>
  <button
    type="button"
    class="wall-tblock absolute flex flex-col rounded-xl border-l-[5px] text-left"
    :class="[
      // A washed block's background IS the owner's wash, so it must not also
      // carry `bg-white` — `background` is a shorthand and the class would win.
      washed ? '' : 'dark:bg-surface-raised bg-white',
      density === 'sliver'
        ? 'wall-tblock-sliver items-center justify-center px-0.5 py-1'
        : 'px-2 py-1',
      density === 'full' ? 'px-2.5' : '',
      height > TALL_PX ? 'justify-center' : '',
      identity.dashed ? 'border-dashed' : '',
      state === 'past' ? 'wall-tblock-past' : '',
      state === 'running' ? 'wall-tblock-running' : '',
      identity.celebration.celebrating ? 'is-celebration' : '',
    ]"
    :data-sticker="identity.sticker"
    :style="{
      ...(washed ? identity.style : identity.edgeStyle),
      '--wall-tblock-hue': identity.color,
    }"
    :title="activity.title"
    :aria-label="accessibleName"
    @click="$emit('open')"
  >
    <CelebrationConfetti
      v-if="identity.celebration.celebrating"
      :activity-id="activity.id"
      density="week"
    />
    <span
      v-if="showNowTag"
      class="wall-tblock-now font-outfit absolute top-1 right-1.5 rounded-full px-1.5 font-extrabold tracking-[0.12em] text-white uppercase"
    >
      {{ t('wall.grid.runningNow') }}
    </span>
    <span
      class="wall-block-title font-outfit text-secondary-500 dark:text-ink block overflow-hidden leading-tight font-bold"
      :class="[
        density === 'sliver' ? 'wall-block-sliver' : '',
        density === 'tight' ? 'wall-block-title-tight line-clamp-2' : '',
        density === 'full' ? 'line-clamp-2' : '',
      ]"
    >
      <span aria-hidden="true">{{ identity.emoji }}</span>
      <template v-if="density !== 'sliver'">{{ activity.title }}</template>
    </span>
    <span
      v-if="showMeta"
      class="wall-block-meta font-inter mt-0.5 block truncate text-[var(--muted-text,#4d5d6c)]"
    >
      {{ subtitle }}
    </span>
    <span v-if="showFaces" class="absolute right-1 bottom-1 flex">
      <!--
        Dense on a narrow block: one face plus a count. The stack's own docblock
        makes the argument — the faces are one tap away, the truncated title is
        not — and a family of six otherwise reserves 66px of a 145px column.
      -->
      <ActivityOwnerStack :members="identity.stackMembers" size="xs" :dense="density !== 'full'" />
    </span>
    <!--
      The running block carries its own progress fill along the foot. The
      now-LINE runs behind every block on purpose (see WallTimeGrid), so this is
      what says "this one, right now" without striking through the title.
    -->
    <span
      v-if="state === 'running'"
      class="wall-tblock-progress absolute bottom-0 left-0 h-[3px]"
      :style="{ width: `${progress}%` }"
      aria-hidden="true"
    />
  </button>
</template>

<style scoped>
/*
 * ⚠️ NO `overflow: hidden` on this element.
 *
 * It carries `data-sticker` and `is-celebration`, and `style.css` renders the
 * celebration sticker as an `::after` positioned OUTSIDE the card's box —
 * `right: -6px; top: -9px`. Clipping the button clipped its own sticker, so a
 * birthday lost its corner mark on every wall view. The rule is stated in
 * `style.css`: a surface that shows the sticker must not clip. Truncation lives
 * on the inner text spans instead.
 */
.wall-tblock {
  box-shadow: 0 1px 5px rgb(44 62 80 / 8%);
}

/* What has already happened steps back rather than disappearing. */
.wall-tblock-past {
  box-shadow: none;
  opacity: 0.42;
}

.wall-tblock-running {
  box-shadow:
    0 0 0 2px color-mix(in srgb, var(--wall-tblock-hue) 34%, transparent),
    0 2px 8px rgb(44 62 80 / 12%);
}

.wall-tblock-now {
  background: var(--heritage-orange);
}

.wall-tblock-progress {
  background: var(--wall-tblock-hue);
  border-radius: 0 3px 3px 0;
  opacity: 0.55;
}
</style>
