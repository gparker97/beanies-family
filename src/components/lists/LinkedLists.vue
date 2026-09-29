<script setup lang="ts">
// Beanie Lists (#33) embedded on a trip: any list linked to the given vacation renders here as a
// `LinkedListCard` (same store entry, one source of truth). Flag-guarded so it is inert when
// `familyLists` is off. The activity drawer has its own container, `ActivityLists` (#114), which
// adds per-session matching and create actions.
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useListStore } from '@/stores/listStore';
import { isFlagEnabled } from '@/config/flags';
import SectionEyebrow from '@/components/ui/SectionEyebrow.vue';
import LinkedListCard from '@/components/lists/LinkedListCard.vue';
import type { FamilyList } from '@/types/models';

const props = defineProps<{ vacationId: string }>();
const emit = defineEmits<{ open: [id: string] }>();

const { t } = useTranslation();
const listStore = useListStore();

const linkedLists = computed<FamilyList[]>(() =>
  isFlagEnabled('familyLists')
    ? listStore.lists.filter((l) => l.linkedVacationId === props.vacationId)
    : []
);
</script>

<template>
  <section v-if="linkedLists.length" class="mt-5">
    <!-- Section eyebrow — announces that linked checklists live here. -->
    <SectionEyebrow icon="📋" :label="t('lists.embed.section')" />

    <div class="space-y-3.5">
      <LinkedListCard
        v-for="list in linkedLists"
        :key="list.id"
        :list="list"
        @open="(id: string) => emit('open', id)"
      />
    </div>
  </section>
</template>
