<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import { useMemberAvatar } from '@/composables/useMemberAvatar';
import { getMemberAvatarUrl, markMemberAvatarError } from '@/composables/useMemberInfo';
import { useTranslation } from '@/composables/useTranslation';
import { useFamilyStore } from '@/stores/familyStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';

const router = useRouter();
const familyStore = useFamilyStore();
const familyContextStore = useFamilyContextStore();
const { t } = useTranslation();

const currentMember = computed(() => familyStore.currentMember ?? familyStore.owner ?? null);
const { variant, color } = useMemberAvatar(currentMember);

function editProfile() {
  if (currentMember.value) {
    router.push({ path: '/family', query: { edit: currentMember.value.id } });
  }
}
</script>

<template>
  <div class="flex items-center gap-5">
    <!-- Avatar -->
    <div
      class="flex h-[72px] w-[72px] flex-shrink-0 items-center justify-center rounded-full shadow-[0_8px_24px_rgba(174,214,241,0.3)]"
      style="background: linear-gradient(135deg, var(--sky-silk), #7fb8e0)"
    >
      <BeanieAvatar
        :variant="variant"
        :color="color"
        :photo-url="currentMember ? getMemberAvatarUrl(currentMember) : null"
        size="xl"
        @photo-error="currentMember && markMemberAvatarError(currentMember)"
      />
    </div>

    <!-- Info -->
    <div class="min-w-0 flex-1">
      <p
        class="font-outfit truncate text-[1.3rem] font-bold text-[var(--deep-slate)] dark:text-white"
      >
        {{ currentMember?.name ?? '' }}
      </p>
      <p class="truncate text-[0.8rem] text-[var(--deep-slate)]/40 dark:text-slate-500">
        {{ currentMember?.email ?? '' }}
      </p>
      <span
        v-if="familyContextStore.activeFamilyName"
        class="font-outfit mt-1.5 inline-block rounded-[10px] bg-[var(--tint-orange-8)] px-3 py-1 text-[0.6rem] font-bold tracking-[0.08em] text-[var(--heritage-orange)] uppercase"
      >
        {{ familyContextStore.activeFamilyName }}
      </span>
    </div>

    <!-- Edit Profile -->
    <button
      class="font-outfit flex-shrink-0 rounded-[20px] bg-[var(--tint-orange-8)] px-5 py-2.5 text-[0.8rem] font-semibold text-[var(--heritage-orange)] transition-colors hover:bg-[var(--tint-orange-12)]"
      @click="editProfile"
    >
      {{ t('settings.editProfile') }}
    </button>
  </div>
</template>
