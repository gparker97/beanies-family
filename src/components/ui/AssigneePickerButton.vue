<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useFamilyStore } from '@/stores/familyStore';
import FamilyChipPicker from '@/components/ui/FamilyChipPicker.vue';

const props = withDefaults(
  defineProps<{
    modelValue: string | string[];
    /** Selection mode — single returns string, multi returns string[] */
    mode?: 'single' | 'multi';
    /** Avatar size in the trigger button */
    size?: 'sm' | 'md';
    /** Popover alignment */
    align?: 'left' | 'right';
  }>(),
  { mode: 'multi', size: 'md', align: 'right' }
);

const emit = defineEmits<{
  'update:modelValue': [value: string | string[]];
}>();

const familyStore = useFamilyStore();
const show = ref(false);
const el = ref<HTMLElement>();

// Close other AssigneePickerButton instances when this one opens
const CLOSE_EVENT = 'assignee-picker-close';

function openPicker() {
  // Broadcast close to all other pickers before opening
  document.dispatchEvent(new CustomEvent(CLOSE_EVENT, { detail: el.value }));
  show.value = true;
}

function onOtherPickerOpen(e: Event) {
  const source = (e as CustomEvent).detail;
  if (source !== el.value) {
    show.value = false;
  }
}

const selectedMembers = computed(() => {
  const ids = Array.isArray(props.modelValue)
    ? props.modelValue
    : props.modelValue
      ? [props.modelValue]
      : [];
  return familyStore.members.filter((m) => ids.includes(m.id));
});

const hasSelection = computed(() =>
  Array.isArray(props.modelValue) ? props.modelValue.length > 0 : !!props.modelValue
);

const avatarClasses = computed(() =>
  props.size === 'sm' ? 'h-5 w-5 text-[9px]' : 'h-6 w-6 text-[10px]'
);

function handlePickerUpdate(value: string | string[]) {
  emit('update:modelValue', value);
  // Auto-close on single selection
  if (props.mode === 'single') {
    show.value = false;
  }
}

function onDocClick(e: MouseEvent) {
  if (el.value && !el.value.contains(e.target as Node)) {
    show.value = false;
  }
}

onMounted(() => {
  document.addEventListener('click', onDocClick);
  document.addEventListener(CLOSE_EVENT, onOtherPickerOpen);
});
onUnmounted(() => {
  document.removeEventListener('click', onDocClick);
  document.removeEventListener(CLOSE_EVENT, onOtherPickerOpen);
});
</script>

<template>
  <div ref="el" class="relative flex shrink-0 items-center">
    <button
      type="button"
      class="flex items-center gap-1 rounded-2xl transition-colors"
      :class="[
        size === 'sm' ? 'px-2.5 py-1.5' : 'px-3 py-2',
        hasSelection ? 'bg-[var(--tint-purple-8)]' : 'hover:bg-[var(--tint-slate-10)]',
      ]"
      :style="!hasSelection ? 'background: var(--tint-slate-5)' : undefined"
      @click.stop="show ? (show = false) : openPicker()"
    >
      <template v-if="selectedMembers.length > 0">
        <span
          v-for="member in selectedMembers"
          :key="member.id"
          class="inline-flex items-center rounded-full font-bold text-white"
          :class="
            mode === 'single' ? 'gap-1.5 px-2.5 py-0.5 text-xs' : [avatarClasses, 'justify-center']
          "
          :style="{
            background: `linear-gradient(135deg, ${member.color}, ${member.color}cc)`,
          }"
        >
          <template v-if="mode === 'single'">{{ member.name }}</template>
          <template v-else>{{ member.name.charAt(0) }}</template>
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
      class="absolute top-full z-50 mt-2 max-w-[280px] min-w-[200px] rounded-xl border border-gray-200 bg-white p-3 shadow-lg dark:border-slate-600 dark:bg-slate-700"
      :class="align === 'left' ? 'left-0' : 'right-0'"
      @click.stop
    >
      <FamilyChipPicker
        :model-value="modelValue"
        :mode="mode"
        compact
        @update:model-value="handlePickerUpdate"
      />
    </div>
  </div>
</template>
