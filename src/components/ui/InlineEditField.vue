<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    editing: boolean;
    disabled?: boolean;
    tintColor?: 'purple' | 'orange' | 'green';
    alignItems?: 'center' | 'start';
  }>(),
  {
    disabled: false,
    tintColor: 'purple',
    alignItems: 'center',
  }
);

defineEmits<{
  'start-edit': [];
}>();

const tintMap = {
  purple: 'hover:bg-[var(--tint-purple-5)]',
  orange: 'hover:bg-orange-50 dark:hover:bg-orange-900/10',
  green: 'hover:bg-green-50 dark:hover:bg-green-900/10',
};
</script>

<template>
  <div
    class="group/field rounded-lg px-1 py-0.5 transition-colors"
    :class="
      editing
        ? 'relative z-10'
        : props.disabled
          ? 'cursor-default'
          : `cursor-pointer ${tintMap[tintColor]} [@media(hover:hover)]:cursor-pointer`
    "
    @click="!editing && !props.disabled && $emit('start-edit')"
  >
    <!-- View mode -->
    <div
      v-if="!editing"
      class="relative flex gap-2"
      :class="alignItems === 'start' ? 'items-start' : 'items-center'"
    >
      <slot name="view" />
      <svg
        v-if="!props.disabled"
        class="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)] opacity-0 [@media(hover:hover)]:group-hover/field:opacity-40"
        :class="alignItems === 'start' ? 'mt-0.5' : ''"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        viewBox="0 0 24 24"
      >
        <path
          d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
        />
      </svg>
    </div>
    <!-- Edit mode -->
    <div v-else @click.stop>
      <slot name="edit" />
    </div>
  </div>
</template>
