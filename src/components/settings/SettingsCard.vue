<script setup lang="ts">
defineProps<{
  /** Emoji for the icon box. Optional when the `icon` slot supplies artwork
   *  instead (e.g. the beanie-bell SVG on Reminders). */
  icon?: string;
  title: string;
  description: string;
  iconBg?: string;
  /** Icon-box foreground, for slotted `currentColor` artwork. */
  iconColor?: string;
}>();

defineEmits<{ click: [] }>();
</script>

<template>
  <div
    class="dark:bg-surface-raised cursor-pointer rounded-[var(--sq)] bg-white p-6 shadow-[0_2px_12px_rgba(44,62,80,0.04)] transition-all duration-200 hover:-translate-y-px hover:shadow-[0_6px_24px_rgba(44,62,80,0.08)]"
    @click="$emit('click')"
  >
    <div
      class="mb-3.5 flex h-11 w-11 items-center justify-center rounded-[14px] text-xl"
      :style="{ backgroundColor: iconBg ?? 'var(--tint-orange-8)', color: iconColor }"
    >
      <slot name="icon">{{ icon }}</slot>
    </div>
    <div class="flex items-center gap-2">
      <p class="font-outfit dark:text-ink text-[0.9rem] font-bold text-[var(--deep-slate)]">
        {{ title }}
      </p>
      <slot name="badge" />
    </div>
    <p class="dark:text-ink-faint mt-1 text-[0.72rem] leading-relaxed text-[var(--deep-slate)]/40">
      {{ description }}
    </p>
  </div>
</template>
