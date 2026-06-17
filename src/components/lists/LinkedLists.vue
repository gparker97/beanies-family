<script setup lang="ts">
// Beanie Lists embedded on a trip OR an activity (#33): any list linked to the
// given entity renders here like the trip's ideas — same store entry, one source
// of truth. Pass exactly one of `vacationId` / `activityId`. Flag-guarded so it
// is inert when `familyLists` is off.
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useListStore } from '@/stores/listStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { isFlagEnabled } from '@/config/flags';
import { fillTemplate } from '@/utils/fillTemplate';
import ListItemRow from '@/components/lists/ListItemRow.vue';
import type { FamilyList } from '@/types/models';

const props = defineProps<{ vacationId?: string; activityId?: string }>();
const emit = defineEmits<{ open: [id: string] }>();

const { t } = useTranslation();
const listStore = useListStore();
const familyStore = useFamilyStore();
const { getMemberName } = useMemberInfo();

const linkedLists = computed<FamilyList[]>(() => {
  if (!isFlagEnabled('familyLists')) return [];
  return listStore.lists.filter((l) =>
    props.vacationId
      ? l.linkedVacationId === props.vacationId
      : props.activityId
        ? l.linkedActivityId === props.activityId
        : false
  );
});

function heading(list: FamilyList): string {
  return fillTemplate(t('lists.embed.heading'), {
    emoji: list.emoji,
    title: list.title,
    done: String(list.items.filter((i) => i.completed).length),
    total: String(list.items.length),
    owner: getMemberName(list.ownerId, ''),
  });
}
function toggle(listId: string, itemId: string): void {
  void listStore.toggleItem(listId, itemId, familyStore.currentMember?.id ?? '');
}
</script>

<template>
  <div v-for="list in linkedLists" :key="list.id" class="mt-4">
    <button
      type="button"
      class="mb-2 flex w-full items-center gap-1.5 text-left text-[0.68rem] font-bold tracking-wider text-[var(--color-text-muted)] uppercase transition-colors hover:text-[var(--color-text)]"
      :aria-label="t('lists.embed.open')"
      @click="emit('open', list.id)"
    >
      {{ heading(list) }}
    </button>
    <div class="rounded-2xl bg-white px-3.5 shadow-sm dark:bg-slate-800">
      <ListItemRow
        v-for="item in list.items"
        :key="item.id"
        :item="item"
        @toggle="(id: string) => toggle(list.id, id)"
      />
    </div>
  </div>
</template>
