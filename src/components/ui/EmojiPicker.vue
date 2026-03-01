<script setup lang="ts">
interface EmojiOption {
  emoji: string;
  label: string;
}

interface Props {
  modelValue: string;
  options: EmojiOption[];
}

defineProps<Props>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();
</script>

<template>
  <div class="flex flex-wrap gap-2">
    <button
      v-for="opt in options"
      :key="opt.emoji"
      type="button"
      class="flex h-[44px] w-[44px] items-center justify-center rounded-[12px] text-xl transition-all duration-150"
      :class="
        modelValue === opt.emoji
          ? 'border-primary-500 dark:bg-primary-500/20 scale-110 border-2 bg-[var(--tint-orange-15)] shadow-[0_0_12px_rgba(241,93,34,0.25)]'
          : 'border-2 border-transparent bg-[var(--tint-slate-5)] hover:bg-[var(--tint-slate-10)] dark:bg-slate-700 dark:hover:bg-slate-600'
      "
      :title="opt.label"
      @click="emit('update:modelValue', opt.emoji)"
    >
      {{ opt.emoji }}
    </button>
  </div>
  <div
    v-if="modelValue"
    class="font-outfit text-primary-500 mt-1.5 text-xs font-semibold tracking-[0.1em] uppercase opacity-45"
  >
    {{ options.find((o) => o.emoji === modelValue)?.label }}
  </div>
</template>
