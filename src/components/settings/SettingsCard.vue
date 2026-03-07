<script setup lang="ts">
defineProps<{
  icon: string;
  title: string;
  description: string;
  iconBg?: string;
}>();

defineEmits<{ click: [] }>();
</script>

<template>
  <div
    class="cursor-pointer rounded-[var(--sq)] bg-white p-6 shadow-[0_2px_12px_rgba(44,62,80,0.04)] transition-all duration-200 hover:-translate-y-px hover:shadow-[0_6px_24px_rgba(44,62,80,0.08)] dark:bg-slate-800"
    @click="$emit('click')"
  >
    <div
      class="mb-3.5 flex h-11 w-11 items-center justify-center rounded-[14px] text-xl"
      :style="{ backgroundColor: iconBg ?? 'var(--tint-orange-8)' }"
    >
      {{ icon }}
    </div>
    <p class="font-outfit text-[0.9rem] font-bold text-[var(--deep-slate)] dark:text-slate-200">
      {{ title }}
    </p>
    <p class="mt-1 text-[0.72rem] leading-relaxed text-[var(--deep-slate)]/40 dark:text-slate-500">
      {{ description }}
    </p>
  </div>
</template>
