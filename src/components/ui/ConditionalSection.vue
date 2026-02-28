<script setup lang="ts">
interface Props {
  show: boolean;
}

defineProps<Props>();
</script>

<template>
  <div
    class="overflow-hidden transition-all duration-400"
    :class="show ? 'max-h-[800px] opacity-100' : 'max-h-0 opacity-0'"
    style="transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1)"
  >
    <div class="border-t-2 border-dashed pt-5" style="border-color: rgb(241 93 34 / 10%)">
      <slot />
    </div>
  </div>
</template>
