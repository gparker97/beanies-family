<script setup lang="ts">
/**
 * The Lists section of the Activity Details drawer (#114): the lists that belong to the session
 * being viewed (`listStore.listsForActivitySession`), with the ones linked to the whole of a
 * repeating activity tagged "Every Session". Lists made or attached here are linked to that
 * session (`linkForSession`), and the template suggested for the activity's category is offered
 * first. Everything else (actions, sheets, the opened list, telemetry) is `LinkedListsSection`'s.
 *
 * The drawer keys this component by activity + session, so moving to another session resets any
 * open sheet or list.
 */
import { computed } from 'vue';
import { useListStore } from '@/stores/listStore';
import { suggestedListTemplateFor } from '@/constants/listTemplates';
import { linkForSession, type ListLinkTarget } from '@/utils/activityLinks';
import LinkedListsSection from '@/components/lists/LinkedListsSection.vue';
import type { FamilyActivity } from '@/types/models';

const props = defineProps<{
  activity: FamilyActivity;
  /** `YYYY-MM-DD` of the session being viewed (the drawer's `sessionYmd`). */
  sessionYmd: string;
}>();

const listStore = useListStore();

const lists = computed(() =>
  listStore
    .listsForActivitySession(props.activity, props.sessionYmd)
    .map(({ item, scope }) => ({ item, everySession: scope === 'every-session' }))
);
const target = computed<ListLinkTarget>(() => ({
  kind: 'activity',
  link: linkForSession(props.activity, props.sessionYmd),
}));
const suggestedTemplateKey = computed(() => suggestedListTemplateFor(props.activity.category)?.key);
</script>

<template>
  <LinkedListsSection
    :lists="lists"
    :target="target"
    :suggested-template-key="suggestedTemplateKey"
    :log-context="{ activity_id: activity.id }"
    stacked
  />
</template>
