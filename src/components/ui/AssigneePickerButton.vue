<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useFamilyStore } from '@/stores/familyStore';
import FamilyChipPicker from '@/components/ui/FamilyChipPicker.vue';

const props = withDefaults(
  defineProps<{
    modelValue: string[];
    /** Avatar size in the trigger button */
    size?: 'sm' | 'md';
  }>(),
  { size: 'md' }
);

const emit = defineEmits<{
  'update:modelValue': [value: string[]];
}>();

const familyStore = useFamilyStore();
const show = ref(false);
const el = ref<HTMLElement>();

const selectedMembers = computed(() =>
  familyStore.members.filter((m) => props.modelValue.includes(m.id))
);

const avatarClasses = computed(() =>
  props.size === 'sm' ? 'h-5 w-5 text-[9px]' : 'h-6 w-6 text-[10px]'
);

function onDocClick(e: MouseEvent) {
  if (el.value && !el.value.contains(e.target as Node)) {
    show.value = false;
  }
}

onMounted(() => document.addEventListener('click', onDocClick));
onUnmounted(() => document.removeEventListener('click', onDocClick));
</script>

<template>
  <div ref="el" class="relative flex shrink-0 items-center">
    <button
      type="button"
      class="flex items-center gap-1 rounded-2xl transition-colors"
      :class="[
        size === 'sm' ? 'px-2.5 py-1.5' : 'px-3 py-2',
        modelValue.length > 0 ? 'bg-[var(--tint-purple-8)]' : 'hover:bg-[var(--tint-slate-10)]',
      ]"
      :style="modelValue.length === 0 ? 'background: var(--tint-slate-5)' : undefined"
      @click.stop="show = !show"
    >
      <template v-if="selectedMembers.length > 0">
        <span
          v-for="member in selectedMembers"
          :key="member.id"
          class="flex items-center justify-center rounded-full font-bold text-white"
          :class="avatarClasses"
          :style="{
            background: `linear-gradient(135deg, ${member.color}, ${member.color}cc)`,
          }"
        >
          {{ member.name.charAt(0) }}
        </span>
      </template>
      <template v-else>
        <span :class="size === 'sm' ? 'text-sm' : 'text-base'">👤</span>
        <span class="text-xs text-[var(--color-text-muted)]">+</span>
      </template>
    </button>

    <!-- Popover -->
    <div
      v-if="show"
      class="absolute top-full right-0 z-50 mt-2 w-max min-w-[200px] rounded-xl border border-gray-200 bg-white p-3 shadow-lg dark:border-slate-600 dark:bg-slate-700"
      @click.stop
    >
      <FamilyChipPicker
        :model-value="modelValue"
        mode="multi"
        compact
        @update:model-value="emit('update:modelValue', $event as string[])"
      />
    </div>
  </div>
</template>
