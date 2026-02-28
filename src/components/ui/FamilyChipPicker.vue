<script setup lang="ts">
import { computed } from 'vue';
import { useFamilyStore } from '@/stores/familyStore';
import { useTranslation } from '@/composables/useTranslation';

interface Props {
  modelValue: string | string[];
  mode?: 'single' | 'multi';
  compact?: boolean;
  showShared?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  mode: 'single',
  compact: false,
  showShared: false,
});

const emit = defineEmits<{
  'update:modelValue': [value: string | string[]];
}>();

const { t } = useTranslation();
const familyStore = useFamilyStore();

const members = computed(() => familyStore.members);

const SHARED_ID = '__shared__';

function isSelected(id: string): boolean {
  if (props.mode === 'multi') {
    return Array.isArray(props.modelValue) && props.modelValue.includes(id);
  }
  return props.modelValue === id;
}

function toggle(id: string) {
  if (props.mode === 'multi') {
    const current = Array.isArray(props.modelValue) ? [...props.modelValue] : [];
    const idx = current.indexOf(id);
    if (idx >= 0) {
      current.splice(idx, 1);
    } else {
      current.push(id);
    }
    emit('update:modelValue', current);
  } else {
    emit('update:modelValue', id === props.modelValue ? '' : id);
  }
}

const avatarSize = computed(() =>
  props.compact ? 'h-6 w-6 text-[0.55rem]' : 'h-7 w-7 text-[0.65rem]'
);
</script>

<template>
  <div class="flex flex-wrap gap-2">
    <!-- Shared/Joint option -->
    <button
      v-if="showShared"
      type="button"
      class="flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-all duration-150"
      :class="
        isSelected(SHARED_ID)
          ? 'border-primary-500 dark:bg-primary-500/15 border-2 bg-[var(--tint-orange-8)]'
          : 'border-2 border-transparent bg-[var(--tint-slate-5)] hover:bg-[var(--tint-slate-10)] dark:bg-slate-700'
      "
      @click="toggle(SHARED_ID)"
    >
      <span
        class="from-primary-500 to-terracotta-400 flex items-center justify-center rounded-full bg-gradient-to-br font-semibold text-white"
        :class="avatarSize"
      >
        {{ t('common.all').charAt(0) }}
      </span>
      <span
        class="font-outfit text-[0.7rem] font-semibold text-[var(--color-text)] dark:text-gray-200"
      >
        {{ t('common.shared') }}
      </span>
    </button>

    <!-- Member chips -->
    <button
      v-for="member in members"
      :key="member.id"
      type="button"
      class="flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-all duration-150"
      :class="
        isSelected(member.id)
          ? 'border-primary-500 dark:bg-primary-500/15 border-2 bg-[var(--tint-orange-8)]'
          : 'border-2 border-transparent bg-[var(--tint-slate-5)] hover:bg-[var(--tint-slate-10)] dark:bg-slate-700'
      "
      @click="toggle(member.id)"
    >
      <span
        class="flex items-center justify-center rounded-full font-semibold text-white"
        :class="avatarSize"
        :style="{ background: `linear-gradient(135deg, ${member.color}, ${member.color}dd)` }"
      >
        {{ member.name.charAt(0).toUpperCase() }}
      </span>
      <span
        class="font-outfit text-[0.7rem] font-semibold text-[var(--color-text)] dark:text-gray-200"
      >
        {{ member.name }}
      </span>
    </button>
  </div>
</template>
