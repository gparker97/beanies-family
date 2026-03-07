<script setup lang="ts">
defineProps<{
  /** 1-indexed current step */
  current: number;
  /** Total steps */
  total: number;
}>();
</script>

<template>
  <div class="flex items-center gap-1.5">
    <div
      v-for="i in total"
      :key="i"
      class="ob-pip"
      :class="{
        'ob-pip-active': i === current,
        'ob-pip-done': i < current,
      }"
    />
  </div>
</template>

<style scoped>
.ob-pip {
  background: var(--tint-slate-10, rgb(44 62 80 / 10%));
  border-radius: 50%;
  height: 8px;
  transition:
    width 0.3s ease,
    background 0.3s ease,
    border-radius 0.3s ease;
  width: 8px;
}

.ob-pip-active {
  background: linear-gradient(135deg, var(--heritage-orange, #f15d22), var(--terracotta, #e67e22));
  border-radius: 8px;
  width: 24px;
}

.ob-pip-done {
  background: #27ae60;
}
</style>
