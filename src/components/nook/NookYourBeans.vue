<script setup lang="ts">
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import { getMemberAvatarVariant } from '@/composables/useMemberAvatar';
import { useTranslation } from '@/composables/useTranslation';
import { useFamilyStore } from '@/stores/familyStore';
import type { Gender, AgeGroup } from '@/types/models';

const familyStore = useFamilyStore();
const { t } = useTranslation();

const emit = defineEmits<{
  'add-member': [];
  'select-member': [memberId: string];
}>();

function getRoleLabel(member: { role: string; ageGroup?: string }): string {
  if (member.role === 'owner' || member.ageGroup === 'adult') {
    return t('dashboard.roleParent');
  }
  return t('dashboard.roleLittleBean');
}
</script>

<template>
  <div>
    <div
      class="font-outfit text-secondary-500/45 mb-3 text-[0.75rem] font-semibold tracking-[0.08em] uppercase dark:text-gray-400"
    >
      {{ t('nook.yourBeans') }}
    </div>
    <div class="flex gap-4 overflow-x-auto py-5">
      <!-- Family members -->
      <button
        v-for="member in familyStore.members"
        :key="member.id"
        type="button"
        class="flex flex-col items-center gap-1 transition-transform duration-200 hover:-translate-y-1"
        @click="emit('select-member', member.id)"
      >
        <div class="relative">
          <BeanieAvatar
            :variant="
              getMemberAvatarVariant({
                gender: member.gender as Gender | undefined,
                ageGroup: member.ageGroup as AgeGroup | undefined,
              })
            "
            :color="member.color || '#3b82f6'"
            size="lg"
          />
          <!-- Online indicator -->
          <div
            class="absolute right-0.5 bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#27AE60] dark:border-slate-800"
          />
        </div>
        <div class="font-outfit text-secondary-500 text-[0.7rem] font-semibold dark:text-gray-200">
          {{ member.name }}
        </div>
        <div class="text-secondary-500/35 text-[0.6rem] dark:text-gray-500">
          {{ getRoleLabel(member) }}
        </div>
      </button>

      <!-- Add Bean button -->
      <button
        type="button"
        class="flex flex-col items-center gap-1 transition-transform duration-200 hover:-translate-y-1"
        @click="emit('add-member')"
      >
        <div
          class="border-secondary-500/15 flex h-[52px] w-[52px] items-center justify-center rounded-full border-2 border-dashed bg-[var(--tint-slate-5)] text-xl dark:border-gray-600"
        >
          ➕
        </div>
        <div
          class="font-outfit text-secondary-500/30 text-[0.7rem] font-semibold dark:text-gray-500"
        >
          {{ t('nook.addBean') }}
        </div>
      </button>
    </div>
  </div>
</template>
