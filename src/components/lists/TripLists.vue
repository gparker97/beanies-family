<script setup lang="ts">
/**
 * The Lists section of a trip: the lists linked to it (`listStore.listsForTrip`), with the
 * ways to start one (blank, which begins in Trips & Packing, or from a template, Vacation
 * Packing first) or attach one the family already has, all linked to the trip. Everything
 * else (actions, sheets, the opened list, telemetry) is `LinkedListsSection`'s.
 *
 * The page keys this by trip, so switching trips resets any open sheet or list.
 * `openNewList()` is the trip's "+ Add a Plan" → List entry point.
 */
import { computed, ref } from 'vue';
import { useListStore } from '@/stores/listStore';
import type { ListLinkTarget } from '@/utils/activityLinks';
import LinkedListsSection from '@/components/lists/LinkedListsSection.vue';

const props = defineProps<{ vacationId: string }>();

const listStore = useListStore();

const lists = computed(() => listStore.listsForTrip(props.vacationId).map((item) => ({ item })));
const target = computed<ListLinkTarget>(() => ({ kind: 'trip', vacationId: props.vacationId }));

const section = ref<InstanceType<typeof LinkedListsSection> | null>(null);
defineExpose({ openNewList: () => section.value?.openNewList() });
</script>

<template>
  <LinkedListsSection
    ref="section"
    :lists="lists"
    :target="target"
    suggested-template-key="vacation-packing"
    blank-category="trips"
  />
</template>
