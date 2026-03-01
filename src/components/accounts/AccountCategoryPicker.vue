<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import {
  ACCOUNT_CATEGORIES,
  getCategoryForType,
  type AccountCategory,
  type AccountSubtype,
} from '@/constants/accountCategories';
import type { AccountType } from '@/types/models';

const props = defineProps<{
  modelValue: AccountType | '';
}>();

const emit = defineEmits<{
  'update:modelValue': [value: AccountType];
}>();

const { t } = useTranslation();
const expandedCategory = ref<string | null>(null);

// Auto-expand the category containing the current value
watchEffect(() => {
  if (props.modelValue) {
    const cat = getCategoryForType(props.modelValue as AccountType);
    if (cat && !cat.autoSelect) {
      expandedCategory.value = cat.id;
    }
  }
});

function selectCategory(cat: AccountCategory) {
  if (cat.autoSelect) {
    // Cash, Loan, Other → auto-select immediately
    emit('update:modelValue', cat.autoSelect);
    expandedCategory.value = null;
  } else {
    expandedCategory.value = cat.id;
  }
}

function collapse() {
  expandedCategory.value = null;
}

function selectType(type: AccountType) {
  emit('update:modelValue', type);
}

function isAutoSelected(cat: AccountCategory): boolean {
  return !!cat.autoSelect && props.modelValue === cat.autoSelect;
}

const expandedCat = () => ACCOUNT_CATEGORIES.find((c) => c.id === expandedCategory.value);

// Sort alphabetically by translated label, "Other" always last
function sortOtherLast<T>(
  items: T[],
  labelFn: (item: T) => string,
  isOther: (item: T) => boolean
): T[] {
  return [...items].sort((a, b) => {
    if (isOther(a)) return 1;
    if (isOther(b)) return -1;
    return labelFn(a).localeCompare(labelFn(b));
  });
}

const sortedCategories = computed(() =>
  sortOtherLast(
    ACCOUNT_CATEGORIES,
    (cat) => t(cat.labelKey),
    (cat) => cat.id === 'other'
  )
);

function sortedSubtypes(subtypes: AccountSubtype[]): AccountSubtype[] {
  return sortOtherLast(
    subtypes,
    (sub) => t(sub.labelKey),
    (sub) => sub.type === 'other'
  );
}
</script>

<template>
  <div class="space-y-2">
    <!-- All category chips (shown when no category is expanded) -->
    <div v-if="!expandedCategory" class="flex flex-wrap gap-2">
      <button
        v-for="cat in sortedCategories"
        :key="cat.id"
        type="button"
        class="font-outfit rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-150"
        :class="
          isAutoSelected(cat)
            ? 'border-primary-500 text-primary-500 dark:bg-primary-500/15 border-2 bg-[var(--tint-orange-8)]'
            : 'border-2 border-transparent bg-[var(--tint-slate-5)] text-[var(--color-text-muted)] hover:bg-[var(--tint-slate-10)] dark:bg-slate-700 dark:text-gray-400'
        "
        @click="selectCategory(cat)"
      >
        <span class="mr-1">{{ cat.emoji }}</span>
        {{ t(cat.labelKey) }}
      </button>
    </div>

    <!-- Expanded state: selected category chip + subtypes -->
    <template v-if="expandedCategory && expandedCat()">
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="font-outfit border-primary-500 text-primary-500 dark:bg-primary-500/15 rounded-full border-2 bg-[var(--tint-orange-8)] px-3.5 py-1.5 text-xs font-semibold transition-all duration-150"
          @click="collapse"
        >
          <span class="mr-1">{{ expandedCat()!.emoji }}</span>
          {{ t(expandedCat()!.labelKey) }}
          <span class="ml-1 opacity-60">&times;</span>
        </button>
        <span class="font-outfit text-xs text-[var(--color-text-muted)]">
          {{ t('modal.selectSubcategory') }}
        </span>
      </div>

      <!-- Flat subtypes (e.g. Bank) -->
      <div v-if="expandedCat()!.subtypes" class="flex flex-wrap gap-2">
        <button
          v-for="sub in sortedSubtypes(expandedCat()!.subtypes!)"
          :key="sub.type"
          type="button"
          class="font-outfit rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-150"
          :class="
            modelValue === sub.type
              ? 'border-primary-500 text-primary-500 dark:bg-primary-500/15 border-2 bg-[var(--tint-orange-8)]'
              : 'border-2 border-transparent bg-[var(--tint-slate-5)] text-[var(--color-text-muted)] hover:bg-[var(--tint-slate-10)] dark:bg-slate-700 dark:text-gray-400'
          "
          @click="selectType(sub.type)"
        >
          <span class="mr-1">{{ sub.emoji }}</span>
          {{ t(sub.labelKey) }}
        </button>
      </div>

      <!-- Grouped subtypes (e.g. Investment) -->
      <template v-if="expandedCat()!.subgroups">
        <div
          v-for="(group, idx) in expandedCat()!.subgroups"
          :key="group.labelKey ?? idx"
          class="space-y-1.5"
        >
          <!-- Section label (skip for ungrouped = no labelKey) -->
          <div
            v-if="group.labelKey"
            class="font-outfit text-xs font-semibold tracking-wide text-[var(--color-text-muted)] uppercase"
          >
            {{ t(group.labelKey) }}
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="sub in sortedSubtypes(group.subtypes)"
              :key="sub.type"
              type="button"
              class="font-outfit rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-150"
              :class="
                modelValue === sub.type
                  ? 'border-primary-500 text-primary-500 dark:bg-primary-500/15 border-2 bg-[var(--tint-orange-8)]'
                  : 'border-2 border-transparent bg-[var(--tint-slate-5)] text-[var(--color-text-muted)] hover:bg-[var(--tint-slate-10)] dark:bg-slate-700 dark:text-gray-400'
              "
              @click="selectType(sub.type)"
            >
              <span class="mr-1">{{ sub.emoji }}</span>
              {{ t(sub.labelKey) }}
            </button>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>
