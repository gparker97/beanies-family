<script setup lang="ts">
import { computed } from 'vue';
/**
 * ONE per-bean column, used by both the lanes view and the jobs board.
 *
 * Presentational and slot-driven rather than mode-flagged: the two callers
 * want different extras (a lane shows events, the board shows stars), and a
 * `mode` prop would have grown a branch for every future difference.
 */
import WallMemberFace from '@/components/wall/WallMemberFace.vue';
import type { FamilyMember } from '@/types/models';

const props = defineProps<{
  member: FamilyMember;
  subtitle: string;
  complete?: boolean;
  /**
   * The jobs board gives a bean the whole column, so it can afford the big
   * avatar the mockup shows. A lane also carries events AND jobs in the same
   * height, where an oversized header starves the events of rows.
   */
  compact?: boolean;
  /** Render the header as a button (the lane's drill-in to that day). */
  headerAction?: boolean;
}>();

/**
 * Each column carries its owner's colour — a firm wash on the header, a whisper
 * on the body. With five near-identical white columns the only thing telling
 * them apart was a name read at two metres; colour does it before you read
 * anything. 8-digit hex rather than `color-mix`, which the old iPads this is
 * built for do not have.
 */
const headerTint = computed(() => `${props.member.color}2e`);
const bodyTint = computed(() => `${props.member.color}0d`);
defineEmits<{ headerClick: [] }>();
</script>

<template>
  <div
    class="flex min-h-0 flex-col overflow-hidden rounded-[22px] bg-white shadow-[var(--card-shadow)] dark:bg-slate-800"
    :class="complete ? 'ring-[2.5px] ring-[#27AE60]' : ''"
  >
    <component
      :is="headerAction ? 'button' : 'div'"
      :type="headerAction ? 'button' : undefined"
      class="flex w-full flex-col items-center border-b border-[rgba(44,62,80,0.06)] px-2.5 text-center dark:border-slate-700"
      :class="compact ? 'gap-1 py-2' : 'gap-2 py-3'"
      :style="{ background: headerTint }"
      @click="headerAction && $emit('headerClick')"
    >
      <WallMemberFace :member="member" :size="compact ? 'md' : 'lg'" />
      <div>
        <p class="font-outfit text-secondary-500 wall-bean-name font-bold dark:text-gray-100">
          {{ member.name }}
        </p>
        <p class="font-inter wall-bean-count text-[var(--muted-text,#4d5d6c)]">{{ subtitle }}</p>
      </div>
    </component>
    <!--
      `overflow-y-auto`, never `hidden`: when a bean has more on than the column
      is tall, the overflow has to remain reachable. Silently clipping the last
      row of a child's day is the one failure this screen must not have.
    -->
    <div
      class="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-3 py-2"
      :style="{ background: bodyTint }"
    >
      <slot />
    </div>
    <slot name="footer" />
  </div>
</template>
