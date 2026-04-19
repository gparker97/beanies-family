<script setup lang="ts">
/**
 * Top banner for a single bean's detail page. Large avatar on the left,
 * name + role + birthday on the right, back-to-Pod action anchored at
 * the top. The gradient background matches the mockup.
 */
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import { getMemberAvatarVariant } from '@/composables/useMemberAvatar';
import { useAvatarPhotoUrl } from '@/composables/useAvatarPhotoUrl';
import { useTranslation } from '@/composables/useTranslation';
import type { AgeGroup, FamilyMember, Gender } from '@/types/models';

const props = defineProps<{
  member: FamilyMember;
  /** Hide the edit-pencil affordance when the viewer can't manage the pod. */
  canManage?: boolean;
}>();

const emit = defineEmits<{
  edit: [];
}>();

const router = useRouter();
const { t } = useTranslation();

const variant = computed(() =>
  getMemberAvatarVariant({
    gender: props.member.gender as Gender | undefined,
    ageGroup: props.member.ageGroup as AgeGroup | undefined,
  })
);

const { url: photoUrl, refresh: refreshAvatar } = useAvatarPhotoUrl(
  () => props.member.avatarPhotoId
);

const ageLabel = computed(() => {
  const dob = props.member.dateOfBirth;
  if (!dob?.year) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.year;
  const beforeBirthday =
    today.getMonth() + 1 < dob.month ||
    (today.getMonth() + 1 === dob.month && today.getDate() < dob.day);
  if (beforeBirthday) age -= 1;
  return age >= 0 ? age : null;
});

const birthdayLabel = computed(() => {
  const dob = props.member.dateOfBirth;
  if (!dob) return null;
  const month = String(dob.month).padStart(2, '0');
  const day = String(dob.day).padStart(2, '0');
  return dob.year ? `${dob.year}-${month}-${day}` : `${month}-${day}`;
});

const roleLabel = computed(() =>
  props.member.ageGroup === 'child' ? t('bean.hero.role.child') : t('bean.hero.role.parent')
);
</script>

<template>
  <header
    class="mb-6 flex items-center gap-6 rounded-[var(--sq)] bg-gradient-to-br from-[rgba(174,214,241,0.35)] to-[rgba(241,93,34,0.08)] px-8 py-7"
  >
    <BeanieAvatar
      :variant="variant"
      :color="member.color"
      :photo-url="photoUrl"
      size="xl"
      class="flex-shrink-0"
      :aria-label="member.name"
      @photo-error="refreshAvatar"
    />
    <div class="min-w-0 flex-1">
      <button
        type="button"
        class="font-outfit text-secondary-500/60 hover:text-primary-500 mb-1 flex items-center gap-1 text-xs font-semibold transition-colors"
        @click="router.push('/pod')"
      >
        <BeanieIcon name="chevron-left" size="xs" />
        <span>{{ t('bean.backToPod') }}</span>
      </button>
      <div class="flex items-center gap-3">
        <h1 class="font-outfit text-secondary-500 text-3xl font-bold dark:text-gray-100">
          {{ member.name }}
        </h1>
        <button
          v-if="canManage"
          type="button"
          class="text-secondary-500/40 hover:text-primary-500 hover:bg-primary-500/10 rounded-lg p-1.5 transition-colors"
          :title="t('action.edit')"
          :aria-label="t('action.edit')"
          @click="emit('edit')"
        >
          <BeanieIcon name="edit" size="sm" />
        </button>
      </div>
      <div class="text-secondary-500/70 mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm">
        <span>{{ roleLabel }}</span>
        <span v-if="birthdayLabel" aria-hidden="true" class="opacity-40">·</span>
        <span v-if="birthdayLabel">
          {{ t('bean.hero.birthday') }}: {{ birthdayLabel }}
          <span v-if="ageLabel !== null"> ({{ ageLabel }} {{ t('bean.stats.age') }})</span>
        </span>
      </div>
    </div>
  </header>
</template>
