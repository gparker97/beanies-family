<script setup lang="ts">
/**
 * The trip's ideas rail — "still deciding", planned, the quick-add box, and any Beanie Lists
 * linked to the trip.
 *
 * Extracted from ~100 lines of inline page template. Presentational: it renders ideas and
 * emits intents. The page keeps the permission gate, the store writes and the toasts, which
 * is where MVO puts them.
 *
 * `v-model` on the quick-add text rather than an internal ref, because the page owns whether
 * the box clears — it must only clear once the write has actually landed, or a failed save
 * silently discards what the user typed.
 */
import VacationIdeaCard from '@/components/vacation/VacationIdeaCard.vue';
import LinkedLists from '@/components/lists/LinkedLists.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useFamilyStore } from '@/stores/familyStore';
import { computed, ref } from 'vue';
import type { FamilyVacation, VacationIdea } from '@/types/models';

defineProps<{
  vacation: FamilyVacation;
  unplannedIdeas: VacationIdea[];
  plannedIdeas: VacationIdea[];
}>();

const quickIdeaText = defineModel<string>('quickIdeaText', { required: true });

const emit = defineEmits<{
  'add-idea': [];
  vote: [ideaId: string];
  'edit-idea': [ideaId: string];
  'delete-idea': [ideaId: string];
  'open-list': [listId: string];
}>();

const quickIdeaInput = ref<HTMLInputElement | null>(null);

/**
 * The quick-add box moved in here with the panel, so the page can no longer reach it by ref.
 * Exposed explicitly rather than left broken: the "add an idea" entry point focuses this
 * input after scrolling, and that is the whole point of the affordance.
 */
defineExpose({
  focusQuickAdd: () => quickIdeaInput.value?.focus(),
});

const { t } = useTranslation();
const familyStore = useFamilyStore();
const currentMemberId = computed(() => familyStore.currentMemberId);
</script>

<template>
  <div
    class="mt-6 min-w-0 rounded-3xl border-t border-gray-100 p-5 lg:mt-0 lg:border-t-0 lg:border-l lg:border-gray-100 dark:border-slate-700"
    style="background: linear-gradient(180deg, rgb(255 217 61 / 3%), rgb(0 180 216 / 2%))"
  >
    <!-- Ideas header -->
    <div
      class="-mx-5 -mt-5 flex items-center gap-3 rounded-t-3xl border-b-[1.5px] border-[rgba(255,217,61,0.12)] px-4 py-3.5"
      style="background: linear-gradient(135deg, rgb(255 217 61 / 10%), rgb(0 180 216 / 6%))"
    >
      <div
        class="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-white/70 text-[1.375rem] shadow-[0_2px_8px_rgba(44,62,80,0.06)]"
      >
        🌟
      </div>
      <div>
        <h3 class="font-outfit text-base font-bold text-gray-900 dark:text-gray-100">
          {{ t('travel.ideas') }}
        </h3>
        <div class="text-[0.6875rem] text-gray-400">
          {{ t('travel.ideasCount').replace('{count}', String(vacation.ideas.length)) }}
        </div>
      </div>
    </div>

    <!-- Ideas section -->
    <div
      class="font-outfit mt-4 mb-2 text-[0.625rem] font-semibold tracking-[0.08em] text-gray-300 uppercase"
    >
      {{ t('travel.ideasAndWishes') }}
    </div>

    <div class="space-y-2">
      <VacationIdeaCard
        v-for="idea in unplannedIdeas"
        :key="idea.id"
        :idea="idea"
        :current-member-id="currentMemberId ?? ''"
        :expanded="false"
        @vote="emit('vote', idea.id)"
        @update:expanded="emit('edit-idea', idea.id)"
        @delete="emit('delete-idea', idea.id)"
      />
    </div>

    <!-- Empty ideas -->
    <div
      v-if="unplannedIdeas.length === 0 && plannedIdeas.length === 0"
      class="py-6 text-center text-sm text-gray-400"
    >
      {{ t('vacation.ideas.empty') }}
    </div>

    <!-- Planned section -->
    <template v-if="plannedIdeas.length > 0">
      <div
        class="font-outfit mt-5 mb-2 flex items-center gap-1.5 text-[0.625rem] font-semibold tracking-[0.08em] text-green-600 uppercase dark:text-green-400"
      >
        ✓ {{ t('vacation.ideas.plannedSection') }}
      </div>
      <div class="space-y-2">
        <VacationIdeaCard
          v-for="idea in plannedIdeas"
          :key="idea.id"
          :idea="idea"
          :current-member-id="currentMemberId ?? ''"
          :expanded="false"
          @vote="emit('vote', idea.id)"
          @update:expanded="emit('edit-idea', idea.id)"
          @delete="emit('delete-idea', idea.id)"
        />
      </div>
    </template>

    <!-- Quick-add input -->
    <div class="mt-3 flex gap-1.5">
      <input
        ref="quickIdeaInput"
        v-model="quickIdeaText"
        type="text"
        :placeholder="t('travel.quickAddIdea')"
        class="flex-1 rounded-xl border-[1.5px] border-[var(--tint-slate-5)] bg-white px-3.5 py-2.5 text-base text-gray-900 transition-all outline-none focus:border-[#00B4D8] focus:shadow-[0_0_0_3px_rgba(0,180,216,0.08)] dark:bg-slate-800 dark:text-gray-100"
        @keydown.enter="emit('add-idea')"
      />
      <button
        type="button"
        class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-[#00B4D8] to-[#0077B6] text-lg text-white"
        @click="emit('add-idea')"
      >
        +
      </button>
    </div>

    <!-- Beanie Lists linked to this trip (#33) — rendered like ideas -->
    <LinkedLists :vacation-id="vacation.id" @open="(id: string) => emit('open-list', id)" />
  </div>
</template>
