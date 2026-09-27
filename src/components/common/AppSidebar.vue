<script setup lang="ts">
import { computed } from 'vue';
import AppNavMenu from '@/components/common/AppNavMenu.vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import CloudProviderBadge from '@/components/ui/CloudProviderBadge.vue';
import SaveStatusIndicator from '@/components/ui/SaveStatusIndicator.vue';
import { useMemberAvatar } from '@/composables/useMemberAvatar';
import { useTranslation } from '@/composables/useTranslation';
import { getProductVersionLabel } from '@/utils/diagnosticContext';
import { useFamilyStore } from '@/stores/familyStore';
import { useSyncStore } from '@/stores/syncStore';

const { t } = useTranslation();
/** Friendly product version (e.g. "v0.9"); bumped per release in constants/appVersion.ts. */
const productVersionLabel = getProductVersionLabel();
const familyStore = useFamilyStore();
const syncStore = useSyncStore();

const currentMemberRef = computed(() => familyStore.currentMember ?? familyStore.owner ?? null);
const { variant: memberVariant, color: memberColor } = useMemberAvatar(currentMemberRef);

const encryptionTitle = computed(() => {
  if (!syncStore.isConfigured) return t('sidebar.noDataFileConfigured');
  return t('sidebar.dataEncryptedFull');
});
</script>

<template>
  <aside class="bg-secondary-500 flex h-full w-64 flex-shrink-0 flex-col p-4">
    <!-- Logo & Branding -->
    <div class="mb-4 flex items-center gap-3 px-1">
      <img
        src="/brand/beanies_father_son_icon_192x192.png"
        alt="beanies.family"
        class="h-[44px] w-[44px] flex-shrink-0 rounded-xl object-contain"
      />
      <div class="min-w-0">
        <h1 class="font-outfit text-base leading-tight font-bold">
          <span class="text-white">beanies</span><span class="text-primary-500">.family</span>
        </h1>
        <p
          class="font-outfit mt-0.5 text-[0.75rem] font-light tracking-[0.06em] text-white/25 italic"
        >
          {{ t('app.tagline') }}
        </p>
      </div>
    </div>

    <!-- Navigation: accordion sections + pinned footer (shared with the drawer) -->
    <AppNavMenu density="sidebar" class="flex-1 space-y-0.5 overflow-y-auto" />

    <!-- User Profile Card -->
    <div v-if="currentMemberRef" class="mt-3 rounded-2xl bg-white/[0.04] p-3">
      <div class="flex items-center gap-2.5">
        <BeanieAvatar :variant="memberVariant" :color="memberColor" size="md" />
        <div class="min-w-0">
          <p class="font-outfit truncate text-base font-semibold text-white">
            {{ currentMemberRef.name }}
          </p>
          <p class="truncate text-sm text-white/35">
            {{
              currentMemberRef.role === 'owner'
                ? t('family.role.owner')
                : currentMemberRef.role === 'admin'
                  ? t('family.role.admin')
                  : t('family.role.member')
            }}
          </p>
        </div>
      </div>
    </div>

    <!-- Security Indicators -->
    <div class="mt-3 space-y-1 px-1">
      <!-- Save status -->
      <SaveStatusIndicator />

      <!-- File name -->
      <CloudProviderBadge
        v-if="syncStore.isConfigured && syncStore.fileName"
        :provider-type="syncStore.storageProviderType"
        :file-name="syncStore.fileName"
        :account-email="syncStore.providerAccountEmail"
        size="xs"
        variant="dark"
      />

      <!-- Encryption status -->
      <div class="flex items-center gap-1.5" :title="encryptionTitle">
        <svg
          v-if="syncStore.isConfigured"
          class="h-3 w-3 flex-shrink-0 text-[#6EE7B7]/30"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <svg
          v-else
          class="h-3 w-3 flex-shrink-0 text-white/30"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
        <span
          class="text-xs"
          :class="syncStore.isConfigured ? 'text-[#6EE7B7]/30' : 'text-white/30'"
        >
          {{ syncStore.isConfigured ? t('sidebar.dataEncrypted') : t('sidebar.noDataFile') }}
        </span>
      </div>

      <!-- Version -->
      <p class="text-xs text-white/20">{{ productVersionLabel }}</p>
    </div>
  </aside>
</template>
