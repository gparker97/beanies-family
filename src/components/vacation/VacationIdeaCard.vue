<script setup lang="ts">
import { computed } from 'vue';
import type { VacationIdea, VacationIdeaCategory } from '@/types/models';
import { useTranslation } from '@/composables/useTranslation';
import { useFamilyStore } from '@/stores/familyStore';
import BaseInput from '@/components/ui/BaseInput.vue';

const props = withDefaults(
  defineProps<{
    idea: VacationIdea;
    currentMemberId: string;
    readOnly?: boolean;
    expanded?: boolean;
  }>(),
  { readOnly: false, expanded: false }
);

const emit = defineEmits<{
  vote: [];
  'update:idea': [updatedIdea: VacationIdea];
  'update:expanded': [value: boolean];
  delete: [];
}>();

const { t } = useTranslation();
const familyStore = useFamilyStore();

const hasVoted = computed(() => props.idea.votes.some((v) => v.memberId === props.currentMemberId));

const author = computed(() => familyStore.members.find((m) => m.id === props.idea.createdBy));

const categories: { key: VacationIdeaCategory; emoji: string }[] = [
  { key: 'beach', emoji: '🏖️' },
  { key: 'activity', emoji: '🎭' },
  { key: 'food', emoji: '🍽️' },
  { key: 'sightseeing', emoji: '📸' },
  { key: 'shopping', emoji: '🛍️' },
  { key: 'nightlife', emoji: '🎉' },
];

const durations = ['30min', '1hr', '2hrs', 'half_day', 'full_day'] as const;

const categoryEmoji = computed(() => {
  const cat = categories.find((c) => c.key === props.idea.category);
  return cat?.emoji ?? '';
});

function toggleExpanded() {
  if (props.readOnly) return;
  emit('update:expanded', !props.expanded);
}

function patch(fields: Partial<VacationIdea>) {
  emit('update:idea', { ...props.idea, ...fields });
}
</script>

<template>
  <!-- Collapsed row -->
  <div
    class="rounded-2xl border border-[var(--tint-slate-5)] bg-white p-3 transition-shadow hover:shadow-sm dark:bg-slate-800"
  >
    <div class="flex cursor-pointer items-center gap-2" @click="toggleExpanded">
      <!-- Vote heart -->
      <button
        class="cursor-pointer border-none bg-transparent text-lg transition-transform hover:scale-110"
        @click.stop="$emit('vote')"
      >
        {{ hasVoted ? '❤️' : '🤍' }}
      </button>
      <span class="font-outfit text-xs font-bold text-[var(--vacation-teal)]">
        {{ idea.votes.length }}
      </span>

      <!-- Title -->
      <span class="font-outfit flex-1 truncate text-sm font-semibold dark:text-white">
        {{ idea.title }}
      </span>

      <!-- Category tag -->
      <span
        v-if="idea.category"
        class="rounded-full bg-[var(--vacation-teal-tint)] px-2 py-0.5 text-[10px] font-semibold text-[var(--vacation-teal)]"
      >
        {{ categoryEmoji }} {{ t(`vacation.ideas.category.${idea.category}`) }}
      </span>

      <!-- Author dot -->
      <span
        v-if="author"
        class="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[8px] font-bold text-white"
        :style="{ backgroundColor: author.color }"
        :title="author.name"
      >
        {{ author.name.charAt(0).toUpperCase() }}
      </span>
    </div>

    <!-- Expanded detail editor -->
    <div v-if="expanded" class="mt-3 space-y-3 border-t border-[var(--tint-slate-5)] pt-3">
      <!-- Category pills -->
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="cat in categories"
          :key="cat.key"
          class="rounded-full border px-2.5 py-1 text-xs font-medium transition-colors"
          :class="
            idea.category === cat.key
              ? 'border-[var(--vacation-teal)] bg-[var(--vacation-teal-15)] text-[var(--vacation-teal)]'
              : 'border-gray-200 text-gray-500 dark:border-slate-600 dark:text-slate-400'
          "
          :disabled="readOnly"
          @click="patch({ category: cat.key })"
        >
          {{ cat.emoji }} {{ t(`vacation.ideas.category.${cat.key}`) }}
        </button>
      </div>

      <!-- Description -->
      <textarea
        :value="idea.description ?? ''"
        :placeholder="t('vacation.ideas.category.activity')"
        :disabled="readOnly"
        rows="2"
        class="w-full resize-none rounded-lg border border-gray-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--vacation-teal)] dark:border-slate-600 dark:text-white"
        @input="patch({ description: ($event.target as HTMLTextAreaElement).value })"
      />

      <!-- Location + Suggested date -->
      <div class="grid grid-cols-2 gap-2">
        <BaseInput
          :model-value="idea.location ?? ''"
          :placeholder="t('vacation.ideas.category.sightseeing')"
          :disabled="readOnly"
          @update:model-value="patch({ location: String($event) })"
        />
        <BaseInput
          type="date"
          :model-value="idea.suggestedDate ?? ''"
          :disabled="readOnly"
          @update:model-value="patch({ suggestedDate: String($event) })"
        />
      </div>

      <!-- Cost: free/paid toggle + amount -->
      <div class="flex items-center gap-2">
        <span class="text-xs font-medium text-gray-500 dark:text-slate-400">
          {{ t('vacation.ideas.estimatedCost') }}
        </span>
        <button
          v-for="ct in ['free', 'paid'] as const"
          :key="ct"
          class="rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors"
          :class="
            idea.costType === ct
              ? 'border-[var(--vacation-teal)] bg-[var(--vacation-teal-15)] text-[var(--vacation-teal)]'
              : 'border-gray-200 text-gray-500 dark:border-slate-600 dark:text-slate-400'
          "
          :disabled="readOnly"
          @click="patch({ costType: ct })"
        >
          {{ t(`vacation.ideas.${ct}`) }}
        </button>
        <BaseInput
          v-if="idea.costType === 'paid'"
          type="number"
          :model-value="idea.estimatedCost ?? 0"
          :disabled="readOnly"
          class="!w-24"
          @update:model-value="patch({ estimatedCost: Number($event) })"
        />
      </div>

      <!-- Duration pills -->
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="text-xs font-medium text-gray-500 dark:text-slate-400">
          {{ t('vacation.ideas.duration') }}
        </span>
        <button
          v-for="dur in durations"
          :key="dur"
          class="rounded-full border px-2 py-0.5 text-xs font-medium transition-colors"
          :class="
            idea.duration === dur
              ? 'border-[var(--vacation-teal)] bg-[var(--vacation-teal-15)] text-[var(--vacation-teal)]'
              : 'border-gray-200 text-gray-500 dark:border-slate-600 dark:text-slate-400'
          "
          :disabled="readOnly"
          @click="patch({ duration: dur })"
        >
          {{ dur.replace('_', ' ') }}
        </button>
      </div>

      <!-- Notes -->
      <textarea
        :value="idea.notes ?? ''"
        :placeholder="t('vacation.ideas.saveIdea')"
        :disabled="readOnly"
        rows="2"
        class="w-full resize-none rounded-lg border border-gray-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--vacation-teal)] dark:border-slate-600 dark:text-white"
        @input="patch({ notes: ($event.target as HTMLTextAreaElement).value })"
      />

      <!-- Delete -->
      <button
        v-if="!readOnly"
        class="text-xs font-medium text-red-500 hover:text-red-600"
        @click="$emit('delete')"
      >
        {{ t('common.delete') }}
      </button>
    </div>
  </div>
</template>
