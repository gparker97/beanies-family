<script setup lang="ts">
/**
 * Whose to-do this is, on the wall: the owners' faces, or a "?" face when nobody has
 * claimed it.
 *
 * Faces, not a name pill, for the same reason the To-Dos page uses them: the person
 * annotates the task, so the title gets the width. A pill grew with every extra owner
 * ("Greg & Jill" truncated), where `ActivityOwnerStack` caps at three faces plus a count
 * and stays the same size. The wall's youngest readers recognise a face before a name.
 */
import ActivityOwnerStack from '@/components/ui/ActivityOwnerStack.vue';
import { useTranslation } from '@/composables/useTranslation';
import type { FamilyMember } from '@/types/models';

withDefaults(defineProps<{ members: FamilyMember[]; size?: 'xs' | 'sm' }>(), { size: 'sm' });

const { t } = useTranslation();
</script>

<template>
  <ActivityOwnerStack v-if="members.length" :members="members" :size="size" />
  <span
    v-else
    class="grid shrink-0 place-items-center rounded-full bg-[#95a5a6] text-xs font-bold text-white"
    :class="size === 'xs' ? 'h-6 w-6' : 'h-8 w-8'"
    role="img"
    :aria-label="t('wall.todo.anyone')"
    >?</span
  >
</template>
