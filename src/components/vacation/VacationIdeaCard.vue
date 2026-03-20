<script setup lang="ts">
import { computed } from 'vue';
import type { VacationIdea, VacationIdeaCategory } from '@/types/models';
import { useTranslation } from '@/composables/useTranslation';
import { useFamilyStore } from '@/stores/familyStore';
import BaseInput from '@/components/ui/BaseInput.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';

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

const costTag = computed(() => {
  if (props.idea.costType === 'free') return '🆓';
  if (props.idea.costType === 'paid' && props.idea.estimatedCost) {
    return `💰 ~$${props.idea.estimatedCost}`;
  }
  return null;
});

const authorDateLine = computed(() => {
  if (!author.value) return '';
  const date = new Date(props.idea.createdAt);
  const month = date.toLocaleString('en', { month: 'short' }).toLowerCase();
  const day = date.getDate();
  return `${author.value.name.toLowerCase()} · ${month} ${day}`;
});

const voters = computed(() => {
  return props.idea.votes
    .map((v) => familyStore.members.find((m) => m.id === v.memberId))
    .filter(Boolean);
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
  <!-- Card wrapper -->
  <div
    class="rounded-2xl border transition-shadow"
    :class="
      expanded
        ? 'border-2 border-[var(--vacation-teal)] bg-[rgba(0,180,216,0.02)] shadow-sm dark:bg-slate-800/80'
        : 'border-[var(--tint-slate-5)] bg-white hover:shadow-sm dark:bg-slate-800'
    "
  >
    <!-- Collapsed row -->
    <div class="flex cursor-pointer items-center gap-2 p-3" @click="toggleExpanded">
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

      <!-- Title + description preview -->
      <div class="min-w-0 flex-1">
        <span class="font-outfit block truncate text-sm font-semibold dark:text-white">
          {{ idea.title }}
        </span>
        <span v-if="idea.description" class="block truncate text-xs text-[var(--color-text-muted)]">
          {{ idea.description }}
        </span>
      </div>

      <!-- Category tag -->
      <span
        v-if="idea.category"
        class="shrink-0 rounded-full bg-[var(--vacation-teal-tint)] px-2 py-0.5 text-[10px] font-semibold text-[var(--vacation-teal)]"
      >
        {{ categoryEmoji }} {{ t(`vacation.ideas.category.${idea.category}`) }}
      </span>

      <!-- Cost tag -->
      <span
        v-if="costTag"
        class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
        :class="
          idea.costType === 'free'
            ? 'bg-[rgba(39,174,96,0.08)] text-[#27AE60]'
            : 'bg-[var(--tint-orange-8)] text-[var(--heritage-orange)]'
        "
      >
        {{ costTag }}
      </span>

      <!-- Author dot -->
      <span
        v-if="author"
        class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
        :style="{ backgroundColor: author.color }"
        :title="author.name"
      >
        {{ author.name.charAt(0).toUpperCase() }}
      </span>
    </div>

    <!-- Expanded detail editor -->
    <div v-if="expanded" class="space-y-4 border-t border-[var(--tint-slate-5)] px-3 pt-3 pb-3">
      <!-- Author info line -->
      <div v-if="author" class="flex items-center gap-1.5">
        <span
          class="flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-bold text-white"
          :style="{ backgroundColor: author.color }"
        >
          {{ author.name.charAt(0).toUpperCase() }}
        </span>
        <span class="font-outfit text-xs text-[var(--color-text-muted)]">
          {{ t('vacation.ideas.addedBy') }} {{ authorDateLine }}
        </span>
      </div>

      <!-- Category pills -->
      <FormFieldGroup :label="t('vacation.ideas.category')">
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
      </FormFieldGroup>

      <!-- Description -->
      <FormFieldGroup :label="t('vacation.field.description')" :optional="true">
        <textarea
          :value="idea.description ?? ''"
          :placeholder="t('vacation.ideas.descriptionPlaceholder')"
          :disabled="readOnly"
          rows="2"
          class="w-full resize-none rounded-lg border border-gray-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--vacation-teal)] dark:border-slate-600 dark:text-white"
          @input="patch({ description: ($event.target as HTMLTextAreaElement).value })"
        />
      </FormFieldGroup>

      <!-- Location -->
      <FormFieldGroup :label="t('vacation.field.location')" :optional="true">
        <BaseInput
          :model-value="idea.location ?? ''"
          :placeholder="t('vacation.ideas.category.sightseeing')"
          :disabled="readOnly"
          @update:model-value="patch({ location: String($event) })"
        />
      </FormFieldGroup>

      <!-- Which day? -->
      <FormFieldGroup :label="t('vacation.ideas.whichDay')" :optional="true">
        <BaseInput
          type="date"
          :model-value="idea.suggestedDate ?? ''"
          :disabled="readOnly"
          @update:model-value="patch({ suggestedDate: String($event) })"
        />
      </FormFieldGroup>

      <!-- Estimated cost -->
      <FormFieldGroup :label="t('vacation.ideas.estimatedCost')">
        <div class="flex items-center gap-2">
          <button
            v-for="ct in ['free', 'paid'] as const"
            :key="ct"
            class="rounded-full border px-2.5 py-1 text-xs font-medium transition-colors"
            :class="
              idea.costType === ct
                ? ct === 'free'
                  ? 'border-[#27AE60] bg-[rgba(39,174,96,0.08)] text-[#27AE60]'
                  : 'border-[var(--vacation-teal)] bg-[var(--vacation-teal-15)] text-[var(--vacation-teal)]'
                : 'border-gray-200 text-gray-500 dark:border-slate-600 dark:text-slate-400'
            "
            :disabled="readOnly"
            @click="patch({ costType: ct })"
          >
            {{ ct === 'free' ? '🆓' : '💰' }} {{ t(`vacation.ideas.${ct}`) }}
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
      </FormFieldGroup>

      <!-- Duration pills -->
      <FormFieldGroup :label="t('vacation.ideas.duration')" :optional="true">
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="dur in durations"
            :key="dur"
            class="rounded-full border px-2 py-1 text-xs font-medium transition-colors"
            :class="
              idea.duration === dur
                ? 'border-[var(--vacation-teal)] bg-[var(--vacation-teal-15)] text-[var(--vacation-teal)]'
                : 'border-gray-200 text-gray-500 dark:border-slate-600 dark:text-slate-400'
            "
            :disabled="readOnly"
            @click="patch({ duration: dur })"
          >
            {{ t(`vacation.duration.${dur}`) }}
          </button>
        </div>
      </FormFieldGroup>

      <!-- Booking needed -->
      <FormFieldGroup :label="t('vacation.ideas.bookingNeeded')" :optional="true">
        <div class="flex flex-wrap gap-1.5">
          <button
            class="rounded-full border px-2.5 py-1 text-xs font-medium transition-colors"
            :class="
              idea.needsBooking === false
                ? 'border-[#27AE60] bg-[rgba(39,174,96,0.08)] text-[#27AE60]'
                : 'border-gray-200 text-gray-500 dark:border-slate-600 dark:text-slate-400'
            "
            :disabled="readOnly"
            @click="patch({ needsBooking: false })"
          >
            ✓ {{ t('vacation.ideas.noBookingNeeded') }}
          </button>
          <button
            class="rounded-full border px-2.5 py-1 text-xs font-medium transition-colors"
            :class="
              idea.needsBooking === true
                ? 'border-[var(--vacation-teal)] bg-[var(--vacation-teal-15)] text-[var(--vacation-teal)]'
                : 'border-gray-200 text-gray-500 dark:border-slate-600 dark:text-slate-400'
            "
            :disabled="readOnly"
            @click="patch({ needsBooking: true })"
          >
            📋 {{ t('vacation.ideas.needsBooking') }}
          </button>
        </div>
      </FormFieldGroup>

      <!-- Notes -->
      <FormFieldGroup :label="t('vacation.field.notes')" :optional="true">
        <textarea
          :value="idea.notes ?? ''"
          :placeholder="t('vacation.field.notesPlaceholder')"
          :disabled="readOnly"
          rows="2"
          class="w-full resize-none rounded-lg border border-gray-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--vacation-teal)] dark:border-slate-600 dark:text-white"
          @input="patch({ notes: ($event.target as HTMLTextAreaElement).value })"
        />
      </FormFieldGroup>

      <!-- Who's interested -->
      <FormFieldGroup v-if="voters.length" :label="t('vacation.ideas.whosInterested')">
        <div class="flex items-center gap-1.5">
          <span
            v-for="voter in voters"
            :key="voter!.id"
            class="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white"
            :style="{ backgroundColor: voter!.color }"
            :title="voter!.name"
          >
            {{ voter!.name.charAt(0).toUpperCase() }}
          </span>
          <span
            v-if="voters.length === familyStore.members.length && familyStore.members.length > 1"
            class="font-outfit ml-1 text-xs font-medium text-[var(--color-text-muted)]"
          >
            everyone!
          </span>
        </div>
      </FormFieldGroup>

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
