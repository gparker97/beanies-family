<script setup lang="ts">
/**
 * The foot: who you are looking at, and whose wall this is.
 *
 * Single-select rather than a multi-select filter. On a shared screen the
 * question is always "just show me Leo's day" and then back to everyone — a
 * checkbox set would leave the wall in a half-filtered state nobody noticed,
 * which on an unattended display is a way to miss a pickup.
 *
 * Deliberately NOT wired to `memberFilterStore`: that filter is the account
 * holder's, persisted and shared with the planner, and a child poking the wall
 * must not silently re-filter a parent's phone.
 */
import { computed } from 'vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import { useMemberAvatarBindings } from '@/composables/useMemberAvatar';
import { useFamilyStore } from '@/stores/familyStore';
import { useTranslation } from '@/composables/useTranslation';

defineProps<{ focused: string | null }>();
const emit = defineEmits<{ select: [string | null] }>();

const { t } = useTranslation();
const familyStore = useFamilyStore();
const members = computed(() => familyStore.sortedHumans);

const { memberAvatarBindings } = useMemberAvatarBindings();
</script>

<template>
  <div class="flex shrink-0 items-center gap-2 px-7 pt-3 pb-4">
    <button
      type="button"
      class="font-outfit wall-chip-person rounded-full px-3.5 py-1.5 font-semibold shadow-[var(--card-shadow)]"
      :class="
        focused === null
          ? 'bg-secondary-500 text-white'
          : 'text-secondary-500 bg-white dark:bg-slate-800 dark:text-gray-100'
      "
      :aria-pressed="focused === null"
      @click="emit('select', null)"
    >
      {{ t('wall.filter.everyone') }}
    </button>
    <button
      v-for="member in members"
      :key="member.id"
      type="button"
      class="font-outfit wall-chip-person flex items-center gap-2 rounded-full py-1 pr-3.5 pl-1 font-semibold shadow-[var(--card-shadow)]"
      :class="
        focused === member.id
          ? 'bg-secondary-500 text-white'
          : 'text-secondary-500 bg-white dark:bg-slate-800 dark:text-gray-100'
      "
      :aria-pressed="focused === member.id"
      @click="emit('select', focused === member.id ? null : member.id)"
    >
      <BeanieAvatar v-bind="memberAvatarBindings(member)" fallback="initials" size="sm" />
      {{ member.name }}
    </button>

    <span class="font-outfit wall-brand ml-auto font-bold opacity-70">
      <span class="text-[var(--muted-text,#4d5d6c)]">beanies</span
      ><span class="text-[var(--heritage-orange)]">.family</span>
    </span>
  </div>
</template>
