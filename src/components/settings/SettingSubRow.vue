<script setup lang="ts">
// One labelled control line beneath a settings row ("How far ahead" + a select, "Notify me on
// this device" + a switch). Owns only the label-and-control line; margin and indent stay with
// the caller through `class` (the rows it sits under differ), so it grows no variant props.
// The control goes in the default slot.
defineProps<{ label: string }>();
</script>

<template>
  <div class="flex items-center justify-between gap-4">
    <span class="dark:text-ink-soft text-secondary-400 text-xs font-medium">
      {{ label }}
    </span>
    <slot />
  </div>
</template>
