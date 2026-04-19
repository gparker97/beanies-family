<script setup lang="ts">
import { useRouter } from 'vue-router';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import MemberRoleManager from '@/components/family/MemberRoleManager.vue';
import { getMemberAvatarVariant } from '@/composables/useMemberAvatar';
import { useAvatarPhotoUrl } from '@/composables/useAvatarPhotoUrl';
import { useTranslation } from '@/composables/useTranslation';
import { timeAgo } from '@/utils/date';
import type { FamilyMember, Gender, AgeGroup } from '@/types/models';
import type { MemberHighlight } from '@/pages/MeetTheBeansPage.vue';

const props = defineProps<{
  member: FamilyMember;
  highlights: MemberHighlight[];
  canManage: boolean;
}>();

const emit = defineEmits<{
  edit: [];
  delete: [];
  'share-invite': [];
  'role-change': [role: 'admin' | 'member'];
}>();

const { t } = useTranslation();
const router = useRouter();

function openDetail(): void {
  router.push(`/pod/${props.member.id}`);
}

function avatarVariant() {
  return getMemberAvatarVariant({
    gender: props.member.gender as Gender | undefined,
    ageGroup: props.member.ageGroup as AgeGroup | undefined,
  });
}

const { url: avatarPhotoUrl, refresh: refreshAvatar } = useAvatarPhotoUrl(
  () => props.member.avatarPhotoId
);
</script>

<template>
  <div
    class="cursor-pointer rounded-[var(--sq)] bg-white p-6 shadow-[var(--card-shadow)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[var(--card-hover-shadow)] dark:bg-slate-800"
    @click="openDetail"
  >
    <div class="flex items-center gap-4">
      <!-- Avatar (vertically centered) -->
      <BeanieAvatar
        :variant="avatarVariant()"
        :color="member.color"
        :photo-url="avatarPhotoUrl"
        size="lg"
        class="flex-shrink-0"
        :aria-label="member.name"
        @photo-error="refreshAvatar"
      />

      <!-- Info + highlights -->
      <div class="min-w-0 flex-1">
        <!-- Name + Role + Actions row -->
        <div class="flex items-center justify-between">
          <div class="flex min-w-0 items-center gap-2">
            <h3
              class="font-outfit text-secondary-500 truncate text-base font-bold dark:text-gray-100"
            >
              {{ member.name }}
            </h3>
            <span @click.stop>
              <MemberRoleManager
                :current-role="member.role"
                :member-id="member.id"
                :disabled="!canManage"
                @change="emit('role-change', $event)"
              />
            </span>
          </div>

          <!-- Action buttons (always reserve space for uniform width) -->
          <div class="flex w-24 flex-shrink-0 justify-end gap-1">
            <button
              v-if="canManage"
              class="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-orange-600 dark:hover:bg-slate-700"
              :title="t('action.edit')"
              @click.stop="emit('edit')"
            >
              <BeanieIcon name="edit" size="md" />
            </button>
            <button
              v-if="member.requiresPassword && canManage"
              class="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-orange-600 dark:hover:bg-slate-700"
              :title="t('family.copyInviteLinkHint')"
              @click.stop="emit('share-invite')"
            >
              <BeanieIcon name="share" size="md" />
            </button>
            <button
              v-if="member.role !== 'owner' && canManage"
              class="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-red-600 dark:hover:bg-slate-700"
              @click.stop="emit('delete')"
            >
              <BeanieIcon name="trash" size="md" />
            </button>
          </div>
        </div>

        <!-- Status badge -->
        <div class="mt-1 flex items-center gap-2">
          <span
            v-if="member.requiresPassword"
            class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
          >
            <span class="h-1.5 w-1.5 rounded-full bg-amber-500" />
            {{ t('family.status.waitingToJoin') }}
          </span>
          <template v-else>
            <span
              class="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-300"
            >
              <span class="h-1.5 w-1.5 rounded-full bg-green-500" />
              {{ t('family.status.active') }}
            </span>
            <span class="text-xs text-gray-400 dark:text-gray-500">
              {{
                member.lastLoginAt
                  ? t('family.lastSeen').replace('{date}', timeAgo(member.lastLoginAt))
                  : t('family.neverLoggedIn')
              }}
            </span>
          </template>
        </div>

        <!-- Highlight sub-cards (2 upcoming items) -->
        <div class="mt-3 grid grid-cols-2 gap-2">
          <div
            v-for="(hl, idx) in highlights.slice(0, 2)"
            :key="idx"
            class="rounded-xl bg-[var(--tint-slate-5)] px-3 py-2.5 text-center dark:bg-slate-700/40"
          >
            <div class="font-outfit text-secondary-500 text-sm font-bold dark:text-gray-200">
              {{ hl.title }}
            </div>
            <div class="text-secondary-500/40 mt-0.5 text-xs dark:text-gray-500">
              {{ hl.subtitle }}
            </div>
          </div>
          <!-- Placeholder sub-cards when fewer than 2 highlights -->
          <div
            v-for="n in Math.max(0, 2 - highlights.length)"
            :key="'empty-' + n"
            class="rounded-xl bg-[var(--tint-slate-5)] px-3 py-2.5 text-center dark:bg-slate-700/40"
          >
            <div class="text-secondary-500/20 text-sm dark:text-gray-600">—</div>
            <div class="text-secondary-500/20 mt-0.5 text-xs dark:text-gray-600">
              {{ t('family.hub.noEvents') }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
