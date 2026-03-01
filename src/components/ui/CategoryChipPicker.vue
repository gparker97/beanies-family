<script setup lang="ts">
import { ref, watchEffect } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import {
  getCategoriesGrouped,
  getCategoryById,
  GROUP_EMOJI_MAP,
  CATEGORY_EMOJI_MAP,
} from '@/constants/categories';

const props = defineProps<{
  modelValue: string;
  type: 'income' | 'expense';
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const { t } = useTranslation();
const expandedGroup = ref<string | null>(null);

// Auto-expand the group containing the current value
watchEffect(() => {
  if (props.modelValue) {
    const cat = getCategoryById(props.modelValue);
    if (cat?.group) {
      expandedGroup.value = cat.group;
    }
  }
});

function selectGroup(groupName: string) {
  expandedGroup.value = groupName;
}

function collapse() {
  expandedGroup.value = null;
}

function selectCategory(categoryId: string) {
  emit('update:modelValue', categoryId);
}

const groups = () => getCategoriesGrouped(props.type);
</script>

<template>
  <div class="space-y-2">
    <!-- All group chips (shown when no group is expanded) -->
    <div v-if="!expandedGroup" class="flex flex-wrap gap-2">
      <button
        v-for="group in groups()"
        :key="group.name"
        type="button"
        class="font-outfit rounded-full border-2 border-transparent bg-[var(--tint-slate-5)] px-3.5 py-1.5 text-xs font-semibold text-[var(--color-text-muted)] transition-all duration-150 hover:bg-[var(--tint-slate-10)] dark:bg-slate-700 dark:text-gray-400"
        @click="selectGroup(group.name)"
      >
        <span class="mr-1">{{ GROUP_EMOJI_MAP[group.name] || '📦' }}</span>
        {{ group.name }}
      </button>
    </div>

    <!-- Expanded state: selected group chip + hint + sub-categories -->
    <template v-if="expandedGroup">
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="font-outfit border-primary-500 text-primary-500 dark:bg-primary-500/15 rounded-full border-2 bg-[var(--tint-orange-8)] px-3.5 py-1.5 text-xs font-semibold transition-all duration-150"
          @click="collapse"
        >
          <span class="mr-1">{{ GROUP_EMOJI_MAP[expandedGroup] || '📦' }}</span>
          {{ expandedGroup }}
          <span class="ml-1 opacity-60">&times;</span>
        </button>
        <span class="font-outfit text-xs text-[var(--color-text-muted)]">
          {{ t('modal.selectSubcategory') }}
        </span>
      </div>

      <div class="flex flex-wrap gap-2">
        <button
          v-for="cat in groups().find((g) => g.name === expandedGroup)?.categories"
          :key="cat.id"
          type="button"
          class="font-outfit rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-150"
          :class="
            modelValue === cat.id
              ? 'border-primary-500 text-primary-500 dark:bg-primary-500/15 border-2 bg-[var(--tint-orange-8)]'
              : 'border-2 border-transparent bg-[var(--tint-slate-5)] text-[var(--color-text-muted)] hover:bg-[var(--tint-slate-10)] dark:bg-slate-700 dark:text-gray-400'
          "
          @click="selectCategory(cat.id)"
        >
          <span class="mr-1">{{ CATEGORY_EMOJI_MAP[cat.id] || '📦' }}</span>
          {{ cat.name }}
        </button>
      </div>
    </template>
  </div>
</template>
