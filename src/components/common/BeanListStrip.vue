<script setup lang="ts">
/**
 * Horizontally-scrolling row of family-member avatars with names + role
 * labels, plus a trailing "＋" add tile. Shared by both the Nook
 * "Your Beans" row and the dashboard "Your Beans" row — previously two
 * near-identical component files that drifted (pet sort, pet role
 * label, missing photo-url all bit us separately in the two files).
 *
 * Callers only vary by:
 *   - the section heading + add-button labels (translation keys)
 *   - the row's vertical padding (cosmetic alignment to the
 *     surrounding Nook card vs. the dashboard)
 *
 * Avatar photo rendering goes through `getMemberAvatarUrl` /
 * `markMemberAvatarError` from `useMemberInfo` so every roster surface
 * shares the same lookup + error-flagging path.
 */
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import { getMemberAvatarVariant } from '@/composables/useMemberAvatar';
import {
  getMemberAvatarUrl,
  getMemberRoleLabel,
  markMemberAvatarError,
} from '@/composables/useMemberInfo';
import { useTranslation } from '@/composables/useTranslation';
import { useFamilyStore } from '@/stores/familyStore';
import type { UIStringKey } from '@/services/translation/uiStrings';
import type { AgeGroup, FamilyMember, Gender } from '@/types/models';

interface Props {
  /** Translation key for the "Your Beans" section heading. */
  labelKey: UIStringKey;
  /** Translation key for the "+" trailing add tile. */
  addLabelKey: UIStringKey;
  /** Vertical padding on the avatar row. 'sm' for the dashboard
   *  (tight stack), 'md' for the Nook (looser card). */
  density?: 'sm' | 'md';
}

const props = withDefaults(defineProps<Props>(), { density: 'md' });

const emit = defineEmits<{
  'add-member': [];
  'select-member': [memberId: string];
}>();

const familyStore = useFamilyStore();
const { t } = useTranslation();
</script>

<template>
  <div>
    <div class="nook-section-label text-secondary-500 mb-3 dark:text-gray-400">
      {{ t(props.labelKey) }}
    </div>
    <div class="flex gap-4 overflow-x-auto" :class="density === 'sm' ? 'py-2' : 'py-5'">
      <!-- Family members — ordered adults -> children -> pets via sortedMembers. -->
      <button
        v-for="member in familyStore.sortedMembers as FamilyMember[]"
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
                isPet: member.isPet,
              })
            "
            :color="member.color || '#3b82f6'"
            :photo-url="getMemberAvatarUrl(member)"
            size="lg"
            @photo-error="markMemberAvatarError(member)"
          />
          <!-- Online indicator -->
          <div
            class="absolute right-0.5 bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#27AE60] dark:border-slate-800"
          />
        </div>
        <div class="font-outfit text-secondary-500 text-xs font-semibold dark:text-gray-200">
          {{ member.name }}
        </div>
        <div class="text-secondary-500/35 text-xs dark:text-gray-500">
          {{ getMemberRoleLabel(member, t) }}
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
        <div class="font-outfit text-secondary-500/30 text-xs font-semibold dark:text-gray-500">
          {{ t(props.addLabelKey) }}
        </div>
      </button>
    </div>
  </div>
</template>
