<script setup lang="ts">
/**
 * A modal title with a squircle icon box beside it — the ONE definition, shared by
 * `BeanieFormModal` and `BaseModal`'s branded (`icon`) header, which had grown two
 * hand-kept copies that already looked different.
 *
 * The `icon` slot lets a caller supply artwork instead of an emoji (e.g. the beanie-bell on
 * Settings → Reminders); `iconColor` drives `currentColor` for such artwork. The default
 * slot is the title, so a caller can pass an inline-editable one (ListDetailModal).
 */
defineProps<{ icon?: string; iconBg?: string; iconColor?: string }>();
</script>

<template>
  <div class="flex w-full items-center gap-3">
    <div
      v-if="icon || $slots.icon"
      class="flex h-[44px] w-[44px] flex-shrink-0 items-center justify-center rounded-[14px] text-xl"
      :style="{ backgroundColor: iconBg || 'var(--tint-orange-8)', color: iconColor }"
    >
      <slot name="icon">{{ icon }}</slot>
    </div>
    <h2 class="font-outfit dark:text-ink flex-1 text-lg font-bold text-[var(--color-text)]">
      <slot />
    </h2>
  </div>
</template>
