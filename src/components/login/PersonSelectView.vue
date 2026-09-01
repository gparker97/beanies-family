<script setup lang="ts">
/**
 * The person picker (2026-08-28 login rethink) — renders `loginFlow`'s 'person-select'
 * state. Replaces PickBeanView's avatar grid; works BEFORE the pod is decrypted (roster
 * cache / credential records) as well as after (live members with photos). Pure
 * renderer: picks emit up, no store writes, no routing decisions.
 */
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import CloudProviderBadge from '@/components/ui/CloudProviderBadge.vue';
import { useTranslation } from '@/composables/useTranslation';
import { getMemberAvatarVariant } from '@/composables/useMemberAvatar';
import { useSyncStore } from '@/stores/syncStore';
import type { PersonCard } from '@/services/auth/loginFlow';

defineProps<{
  familyName: string;
  people: PersonCard[];
}>();

const emit = defineEmits<{
  pick: [person: PersonCard];
  back: [];
}>();

const { t } = useTranslation();
const syncStore = useSyncStore();

function roleLabel(person: PersonCard): string {
  return person.ageGroup === 'child' ? t('loginV6.littleBean') : t('loginV6.parentBean');
}
</script>

<template>
  <div class="mx-auto max-w-[480px] rounded-3xl bg-white p-8 shadow-xl dark:bg-slate-800">
    <!-- Back button -->
    <button
      class="mb-4 flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
      @click="emit('back')"
    >
      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
      </svg>
      {{ t('action.back') }}
    </button>

    <!-- Header -->
    <div class="mb-6 text-center">
      <div v-if="familyName" class="mx-auto mb-3 flex flex-col items-center gap-1">
        <div
          class="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600 dark:bg-slate-700 dark:text-gray-400"
        >
          <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
            />
          </svg>
          {{ familyName }}
        </div>
        <CloudProviderBadge
          v-if="syncStore.fileName"
          :provider-type="syncStore.storageProviderType"
          :file-name="syncStore.fileName"
          :account-email="syncStore.providerAccountEmail"
          size="sm"
        />
      </div>

      <h2 class="font-outfit text-xl font-bold text-gray-900 dark:text-gray-100">
        {{ t('loginV6.pickBeanTitle') }}
      </h2>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
        {{ t('loginV6.pickBeanSubtitle') }}
      </p>
    </div>

    <!-- Avatar grid -->
    <div class="flex flex-wrap justify-center gap-6">
      <button
        v-for="person in people"
        :key="person.id"
        class="group flex w-[88px] flex-col items-center gap-2 transition-transform hover:-translate-y-0.5"
        @click="emit('pick', person)"
      >
        <!--
          No credential badge (#79): the picker must not advertise which beans are
          unclaimed. The age-derived role label below is the only distinction drawn.
        -->
        <BeanieAvatar
          :variant="getMemberAvatarVariant(person)"
          :color="person.color"
          :photo-url="person.photoUrl ?? null"
          size="xl"
        />
        <div class="text-center">
          <p
            class="font-outfit max-w-[88px] truncate text-sm font-semibold text-gray-900 dark:text-gray-100"
          >
            {{ person.name }}
          </p>
          <p class="text-xs text-gray-400 opacity-60">
            {{ roleLabel(person) }}
          </p>
        </div>
      </button>
    </div>

    <!-- Info bubble -->
    <div
      v-if="people.length > 0"
      class="mt-6 flex items-start gap-3 rounded-2xl bg-gray-50 p-[14px_18px] dark:bg-slate-700/50"
    >
      <div
        class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px] bg-[#6EE7B7]/[0.12]"
      >
        <svg class="h-4 w-4 text-[#6EE7B7]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </div>
      <p class="text-xs font-semibold opacity-50">
        {{ t('loginV6.pickBeanInfoText') }}
      </p>
    </div>
  </div>
</template>
