<script setup lang="ts">
import { ref, watchEffect } from 'vue';
import { useTranslation } from '@/composables/useTranslation';

export interface GroupedChipItem {
  value: string;
  label: string;
  icon: string;
}

export interface ChipGroup {
  name: string;
  icon: string;
  items: GroupedChipItem[];
}

const props = defineProps<{
  modelValue: string;
  groups: ChipGroup[];
  autoExpandValue?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const { t } = useTranslation();
const expandedGroup = ref<string | null>(null);

// Auto-expand the group containing the current value
watchEffect(() => {
  const val = props.autoExpandValue ?? props.modelValue;
  if (val) {
    const group = props.groups.find((g) => g.items.some((i) => i.value === val));
    if (group) {
      expandedGroup.value = group.name;
    }
  }
});

function selectGroup(groupName: string) {
  expandedGroup.value = groupName;
}

function collapse() {
  expandedGroup.value = null;
}

function selectItem(value: string) {
  emit('update:modelValue', value);
}

const expandedItems = () => props.groups.find((g) => g.name === expandedGroup.value)?.items ?? [];
const expandedIcon = () => props.groups.find((g) => g.name === expandedGroup.value)?.icon ?? '📦';
</script>

<template>
  <div class="space-y-2">
    <!-- All group chips (shown when no group is expanded) -->
    <div v-if="!expandedGroup" class="flex flex-wrap gap-2">
      <button
        v-for="group in groups"
        :key="group.name"
        type="button"
        class="font-outfit rounded-full border-2 border-transparent bg-[var(--tint-slate-5)] px-3.5 py-1.5 text-xs font-semibold text-[var(--color-text-muted)] transition-all duration-150 hover:bg-[var(--tint-slate-10)] dark:bg-slate-700 dark:text-gray-400"
        @click="selectGroup(group.name)"
      >
        <span class="mr-1">{{ group.icon }}</span>
        {{ group.name }}
      </button>
    </div>

    <!-- Expanded state: selected group chip + hint + sub-item chips -->
    <template v-if="expandedGroup">
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="font-outfit border-primary-500 text-primary-500 dark:bg-primary-500/15 rounded-full border-2 bg-[var(--tint-orange-8)] px-3.5 py-1.5 text-xs font-semibold transition-all duration-150"
          @click="collapse"
        >
          <span class="mr-1">{{ expandedIcon() }}</span>
          {{ expandedGroup }}
          <span class="ml-1 opacity-60">&times;</span>
        </button>
        <span class="font-outfit text-xs text-[var(--color-text-muted)]">
          {{ t('modal.selectSubcategory') }}
        </span>
      </div>

      <div class="flex flex-wrap gap-2">
        <button
          v-for="item in expandedItems()"
          :key="item.value"
          type="button"
          class="font-outfit rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-150"
          :class="
            modelValue === item.value
              ? 'border-primary-500 text-primary-500 dark:bg-primary-500/15 border-2 bg-[var(--tint-orange-8)]'
              : 'border-2 border-transparent bg-[var(--tint-slate-5)] text-[var(--color-text-muted)] hover:bg-[var(--tint-slate-10)] dark:bg-slate-700 dark:text-gray-400'
          "
          @click="selectItem(item.value)"
        >
          <span class="mr-1">{{ item.icon }}</span>
          {{ item.label }}
        </button>
      </div>
    </template>
  </div>
</template>
