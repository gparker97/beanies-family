<script setup lang="ts">
/**
 * ONE timed-event block for the two desktop time grids: the week grid
 * (`WeeklyCalendarView`, `surface="week"`) and the day view's bean lanes
 * (`DailyCalendarView`, `surface="lanes"`). They were two near-identical copies of
 * this markup; what genuinely differed is kept here as the `surface` and
 * `showPhotos` props, so each grid renders exactly what it rendered before.
 *
 * `surface="week"` paints the identity wash (`identity.style`) as the card's own
 * background. `surface="lanes"` keeps a white / raised card with a shadow and binds
 * the edge only (`identity.edgeStyle`), plus the dashed edge for a shared event and
 * the lane's own type treatment. `identity` is the `identityFor` result the caller
 * already resolved (lane-aware on the lanes surface).
 *
 * The MOBILE timeline (`DayTimeline`) keeps its own block: it carries a different
 * owner stack, time label and confetti density.
 *
 * Drag and drop (#142): when `draggable` (false for an overnight event's next-morning
 * tail, whose head card moves the whole event) the block is a `move` drag source with the
 * "Press Space to move" description; with `resizable` too it carries the bottom-edge
 * `PlannerResizeHandle`. While it is the lifted source the drag binding adds the
 * `drag-placeholder` class, which nothing here fights (the hover shadow stands down).
 */
import { computed } from 'vue';
import CelebrationConfetti from '@/components/ui/CelebrationConfetti.vue';
import ActivityOwnerStack from '@/components/ui/ActivityOwnerStack.vue';
import PhotoIndicator from '@/components/media/PhotoIndicator.vue';
import ClashIndicator from '@/components/planner/ClashIndicator.vue';
import PlannerResizeHandle from '@/components/planner/PlannerResizeHandle.vue';
import { useActivityDragAttrs } from '@/composables/drag/useActivityDragAttrs';
import { formatTime12 } from '@/utils/date';
import type { ActivityIdentity } from '@/composables/useActivityIdentity';
import type { ResolvedClash } from '@/composables/useClash';
import type { FamilyActivity } from '@/types/models';

export type PlannerTimedBlockSurface = 'week' | 'lanes';

const props = withDefaults(
  defineProps<{
    activity: FamilyActivity;
    /** Where clicks, edits and the clash lookup belong (`eventDateOf`). */
    eventDate: string;
    /** The window the card is DRAWN in (a next-morning tail starts at 00:00). */
    startTime: string;
    endTime?: string;
    /** The block's slot among the overlapping cards sharing its column. */
    laneIndex: number;
    laneCount: number;
    identity: ActivityIdentity;
    /** The grid's `useTimeGrid().getPosition`, which knows the grid's first hour. */
    getPosition: (startTime: string, endTime?: string) => { top: string; height: string };
    /** `displayTitle(activity, eventDate)`. */
    title: string;
    clash?: ResolvedClash;
    surface: PlannerTimedBlockSurface;
    showPhotos?: boolean;
    confettiDensity?: 'month' | 'week' | 'card' | 'wall';
    resizable?: boolean;
    draggable?: boolean;
  }>(),
  {
    endTime: undefined,
    clash: undefined,
    showPhotos: false,
    confettiDensity: 'week',
    resizable: false,
    draggable: true,
  }
);

const emit = defineEmits<{
  'view-activity': [id: string, date: string];
}>();

const isLanes = computed(() => props.surface === 'lanes');

const activityDragAttrs = useActivityDragAttrs();
const dragAttrs = computed(() => activityDragAttrs(props.activity, props.draggable));
const canDrag = computed(() => Object.keys(dragAttrs.value).length > 0);

const blockStyle = computed(() => ({
  ...props.getPosition(props.startTime, props.endTime),
  left: `${(props.laneIndex / props.laneCount) * 100}%`,
  width: `calc(${100 / props.laneCount}% - 2px)`,
  ...(isLanes.value ? props.identity.edgeStyle : props.identity.style),
}));
</script>

<template>
  <button
    type="button"
    class="group absolute z-10 flex cursor-pointer flex-col gap-0.5 overflow-hidden rounded-lg border-l-[3px] px-1.5 py-1 text-left text-xs transition-shadow [&:not(.drag-placeholder)]:hover:shadow-md"
    :class="[
      canDrag ? 'select-none [-webkit-touch-callout:none]' : '',
      isLanes ? 'dark:bg-surface-raised bg-white shadow-sm' : '',
      isLanes && identity.dashed ? 'border-dashed' : '',
      identity.celebration.celebrating ? 'is-celebration' : '',
    ]"
    :style="blockStyle"
    :data-activity-id="activity.id"
    :data-occurrence-date="eventDate"
    v-bind="dragAttrs"
    @click.stop="emit('view-activity', activity.id, eventDate)"
  >
    <!--
      (No comment may sit ABOVE this button: in dev it would make the root a fragment.)
      `text-left` undoes the button's UA `text-align: center`, which would otherwise
      centre the location span (it is `flex-1`, so wider than its text).

      DESKTOP grids only. `DayTimeline` covers the MOBILE path, so a celebration
      reached these views on a phone and nowhere else.
    -->
    <CelebrationConfetti
      v-if="identity.celebration.celebrating"
      :activity-id="activity.id"
      :density="confettiDensity"
    />
    <div
      class="font-outfit flex items-center truncate text-xs font-semibold"
      style="color: var(--color-text)"
    >
      <span aria-hidden="true">{{ identity.emoji }}</span>
      <span class="truncate">{{ title }}</span>
      <PhotoIndicator v-if="showPhotos" :photo-ids="activity.photoIds" />
      <ClashIndicator :clash="clash" class="ml-1" />
    </div>
    <div class="flex min-w-0 items-center gap-1">
      <!--
        Both surfaces: Heritage Orange with its dark lift and no opacity (the lanes
        surface used to fade it to 70% with no lift, unreadable on dark).
      -->
      <span class="text-primary-500 dark:text-accent-lift truncate text-xs leading-tight">
        {{ formatTime12(activity.startTime!)
        }}{{ activity.endTime ? `-${formatTime12(activity.endTime)}` : '' }}
      </span>
      <span
        v-if="activity.location"
        class="min-w-0 flex-1 truncate text-xs leading-tight text-[var(--muted-text)]"
      >
        · 📍 {{ activity.location }}
      </span>
      <!--
        Faces are ALWAYS right-anchored (`ml-auto`), which keeps a title's left edge
        identical on every card: the location span carries `flex-1`, so without it a
        card WITH a location pushed the faces right and one without left them mid-row.
        On the lanes surface the stack is lane-aware: the column header already names
        its bean, so a face there always means "someone else is in this too".
      -->
      <ActivityOwnerStack
        :members="identity.stackMembers"
        size="xs"
        :dense="!isLanes"
        :class="isLanes ? 'ml-auto' : 'ml-auto shrink-0'"
      />
    </div>
    <PlannerResizeHandle v-if="resizable && canDrag" />
  </button>
</template>
