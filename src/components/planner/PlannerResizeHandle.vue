<script setup lang="ts">
/**
 * The bottom-edge resize handle of a timed block on a timeline (#142): the drag source for a
 * `resize-end` gesture, shared by `PlannerTimedBlock` (desktop week and day) and
 * `DayTimeline` (phones). Place it INSIDE the block that carries the reveal hooks; the
 * block must be a `group` and `relative`/`absolute`.
 *
 * The hit zone is the block's bottom 0.75rem; the visible bar (2rem by 0.25rem, decorative,
 * so `aria-hidden`: the keyboard resizes with Shift+↑/↓ on the block itself) shows on hover
 * on desktop and whenever its block is the lifted source (the `drag-placeholder` class).
 */
import { dragSourceAttrs } from '@/utils/calendar/dragDom';
</script>

<template>
  <span
    v-bind="dragSourceAttrs('resize-end')"
    aria-hidden="true"
    class="absolute inset-x-0 bottom-0 z-[1] flex h-3 cursor-ns-resize items-end justify-center pb-0.5 opacity-0 transition-opacity group-hover:opacity-100 [.drag-placeholder_&]:opacity-100"
  >
    <span class="bg-secondary-500/30 dark:bg-line-strong h-1 w-8 rounded-full" />
  </span>
</template>
