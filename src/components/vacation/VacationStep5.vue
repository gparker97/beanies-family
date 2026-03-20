<script setup lang="ts">
import { ref, computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import type { VacationIdea } from '@/types/models';
import BaseInput from '@/components/ui/BaseInput.vue';
import VacationIdeaCard from './VacationIdeaCard.vue';
import { generateUUID } from '@/utils/id';
import { toISODateString } from '@/utils/date';

interface Props {
  ideas: VacationIdea[];
  currentMemberId: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:ideas': [value: VacationIdea[]];
}>();

const { t } = useTranslation();

const newIdeaText = ref('');
const expandedIds = ref<Set<string>>(new Set());

const sortedIdeas = computed(() =>
  [...props.ideas].sort((a, b) => {
    const voteDiff = (b.votes ?? []).length - (a.votes ?? []).length;
    if (voteDiff !== 0) return voteDiff;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  })
);

function quickAddIdea() {
  const title = newIdeaText.value.trim();
  if (!title) return;

  const idea: VacationIdea = {
    id: generateUUID(),
    title,
    votes: [],
    createdBy: props.currentMemberId,
    createdAt: toISODateString(new Date()),
  };

  emit('update:ideas', [idea, ...props.ideas]);
  newIdeaText.value = '';
}

function handleVote(index: number) {
  const updated = [...props.ideas];
  const idea = { ...updated[index]! };
  const votes = idea.votes ?? [];
  const existingIdx = votes.findIndex((v) => v.memberId === props.currentMemberId);

  if (existingIdx >= 0) {
    idea.votes = votes.filter((_, i) => i !== existingIdx);
  } else {
    idea.votes = [
      ...votes,
      { memberId: props.currentMemberId, votedAt: toISODateString(new Date()) },
    ];
  }

  updated[index] = idea;
  emit('update:ideas', updated);
}

function handleUpdateIdea(index: number, updated: VacationIdea) {
  const ideas = [...props.ideas];
  ideas[index] = updated;
  emit('update:ideas', ideas);
}

function handleDeleteIdea(index: number) {
  emit(
    'update:ideas',
    props.ideas.filter((_, i) => i !== index)
  );
}

function isExpanded(id: string) {
  return expandedIds.value.has(id);
}

function setExpanded(id: string, value: boolean) {
  const next = new Set(expandedIds.value);
  if (value) next.add(id);
  else next.delete(id);
  expandedIds.value = next;
}
</script>

<template>
  <!-- Step header -->
  <div class="mb-5 text-center">
    <div class="text-3xl">🌟</div>
    <h2 class="font-outfit text-lg font-bold text-[var(--color-text)] dark:text-gray-100">
      {{ t('vacation.step5.title') }}
    </h2>
    <p class="text-xs text-[var(--color-text-muted)]">
      {{ t('vacation.step5.subtitle') }}
    </p>
  </div>

  <!-- Quick-add row -->
  <div class="mb-4 flex items-center gap-2">
    <BaseInput
      v-model="newIdeaText"
      :placeholder="t('vacation.ideas.addPlaceholder')"
      class="vacation-teal-input flex-1"
      @keydown.enter="quickAddIdea"
    />
    <button
      type="button"
      class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--vacation-teal)] to-[var(--vacation-teal-deep)] text-lg font-bold text-white shadow-sm transition-transform hover:scale-105 active:scale-95"
      @click="quickAddIdea"
    >
      +
    </button>
  </div>

  <!-- Ideas list -->
  <div v-if="sortedIdeas.length" class="space-y-2">
    <VacationIdeaCard
      v-for="idea in sortedIdeas"
      :key="idea.id"
      :idea="idea"
      :current-member-id="currentMemberId"
      :expanded="isExpanded(idea.id)"
      @update:expanded="setExpanded(idea.id, $event)"
      @vote="handleVote(ideas.indexOf(idea))"
      @update:idea="handleUpdateIdea(ideas.indexOf(idea), $event)"
      @delete="handleDeleteIdea(ideas.indexOf(idea))"
    />
  </div>

  <!-- Empty state -->
  <div v-else class="py-10 text-center">
    <div class="text-2xl">🏖️</div>
    <p class="mt-1 text-sm text-[var(--color-text-muted)]">
      {{ t('vacation.ideas.empty') }}
    </p>
  </div>
</template>

<style scoped>
.vacation-teal-input :deep(input) {
  --tw-ring-color: var(--vacation-teal);
}

.vacation-teal-input :deep(input:focus) {
  border-color: var(--vacation-teal);
  box-shadow: 0 0 0 3px var(--vacation-teal-tint);
}
</style>
