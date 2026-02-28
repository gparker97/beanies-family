<script setup lang="ts">
interface ColorOption {
  value: string;
  gradient?: string;
}

interface Props {
  modelValue: string;
  colors: ColorOption[];
}

defineProps<Props>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();
</script>

<template>
  <div class="flex flex-wrap gap-2.5">
    <button
      v-for="color in colors"
      :key="color.value"
      type="button"
      class="h-8 w-8 rounded-full transition-all duration-150 hover:scale-115"
      :class="
        modelValue === color.value
          ? 'shadow-[0_0_0_2px_white,0_0_0_4px_var(--color-secondary)]'
          : ''
      "
      :style="{
        background: color.gradient || color.value,
      }"
      @click="emit('update:modelValue', color.value)"
    />
  </div>
</template>
