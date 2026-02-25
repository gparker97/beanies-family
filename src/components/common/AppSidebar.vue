<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import { useMemberAvatar } from '@/composables/useMemberAvatar';
import { useSidebarAccordion } from '@/composables/useSidebarAccordion';
import { useTranslation } from '@/composables/useTranslation';
import {
  NAV_SECTIONS,
  TREEHOUSE_ITEMS,
  PIGGY_BANK_ITEMS,
  PINNED_ITEMS,
  type NavItemDef,
} from '@/constants/navigation';
import { useFamilyStore } from '@/stores/familyStore';
import { useGoalsStore } from '@/stores/goalsStore';
import { useSyncStore } from '@/stores/syncStore';

const route = useRoute();
const router = useRouter();
const { t } = useTranslation();
const familyStore = useFamilyStore();
const goalsStore = useGoalsStore();
const syncStore = useSyncStore();
const { isOpen, toggle } = useSidebarAccordion();

const badges = computed<Record<string, number>>(() => ({
  activeGoals: goalsStore.activeGoals.length,
}));

function mapItems(items: NavItemDef[]) {
  return items.map((item) => ({
    label: t(item.labelKey),
    path: item.path,
    emoji: item.emoji,
    comingSoon: item.comingSoon ?? false,
    badge: item.badgeKey ? (badges.value[item.badgeKey] ?? 0) : 0,
  }));
}

const treehouseItems = computed(() => mapItems(TREEHOUSE_ITEMS));
const piggyBankItems = computed(() => mapItems(PIGGY_BANK_ITEMS));
const pinnedItems = computed(() => mapItems(PINNED_ITEMS));

const currentMemberRef = computed(() => familyStore.currentMember ?? familyStore.owner ?? null);
const { variant: memberVariant, color: memberColor } = useMemberAvatar(currentMemberRef);

function isActive(path: string): boolean {
  return route.path === path;
}

function navigateTo(path: string) {
  router.push(path);
}

const encryptionTitle = computed(() => {
  if (!syncStore.isConfigured) return t('sidebar.noDataFileConfigured');
  if (syncStore.isEncryptionEnabled) return t('sidebar.dataEncryptedFull');
  return t('sidebar.dataFileNotEncrypted');
});

const sections = computed(() =>
  NAV_SECTIONS.map((section) => ({
    id: section.id,
    label: t(section.labelKey),
    emoji: section.emoji,
    items: section.id === 'treehouse' ? treehouseItems.value : piggyBankItems.value,
  }))
);
</script>

<template>
  <aside class="flex h-full w-64 flex-shrink-0 flex-col bg-[#2C3E50] p-4">
    <!-- Logo & Branding -->
    <div class="mb-4 flex items-center gap-3 px-1">
      <div
        class="flex h-[52px] w-[52px] flex-shrink-0 items-center justify-center rounded-full bg-white"
      >
        <img
          src="/brand/beanies_logo_transparent_logo_only_192x192.png"
          alt="beanies.family"
          class="h-[38px] w-[38px] object-contain"
        />
      </div>
      <div class="min-w-0">
        <h1 class="font-outfit text-base leading-tight font-bold">
          <span class="text-white">beanies</span><span class="text-[#F15D22]">.family</span>
        </h1>
        <p
          class="font-outfit mt-0.5 text-[0.75rem] font-light tracking-[0.06em] text-white/25 italic"
        >
          every bean counts.
        </p>
      </div>
    </div>

    <!-- Accordion Navigation -->
    <nav class="flex-1 space-y-1 overflow-y-auto">
      <div v-for="section in sections" :key="section.id">
        <!-- Section Header -->
        <button
          class="font-outfit flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-[0.7rem] font-semibold tracking-wider text-white/50 uppercase transition-colors hover:text-white/70"
          @click="toggle(section.id as 'treehouse' | 'piggyBank')"
        >
          <span class="text-sm">{{ section.emoji }}</span>
          <span class="flex-1 text-left">{{ section.label }}</span>
          <BeanieIcon
            name="chevron-down"
            size="xs"
            class="text-white/30 transition-transform duration-200"
            :class="{ 'rotate-180': !isOpen(section.id as 'treehouse' | 'piggyBank') }"
          />
        </button>

        <!-- Section Items -->
        <div v-show="isOpen(section.id as 'treehouse' | 'piggyBank')" class="space-y-0.5">
          <button
            v-for="item in section.items"
            :key="item.path"
            class="font-outfit group relative flex w-full items-center gap-3 rounded-2xl px-3.5 py-2.5 text-left text-[1.1rem] font-medium transition-all duration-150"
            :class="[
              isActive(item.path)
                ? 'border-l-4 border-[#F15D22] bg-gradient-to-r from-[rgba(241,93,34,0.2)] to-[rgba(230,126,34,0.1)] pl-3 font-semibold text-white'
                : 'border-l-4 border-transparent hover:bg-white/[0.05]',
              item.comingSoon && !isActive(item.path)
                ? 'text-white/25'
                : !isActive(item.path)
                  ? 'text-white/40 hover:text-white/70'
                  : '',
            ]"
            @click="navigateTo(item.path)"
          >
            <span class="w-6 text-center text-base">{{ item.emoji }}</span>
            <span class="flex-1">{{ item.label }}</span>
            <!-- Badge (e.g. active goals count) -->
            <span
              v-if="item.badge > 0"
              class="min-w-[1.2rem] rounded-full bg-[#F15D22] px-1.5 text-center text-[0.6rem] font-semibold text-white"
            >
              {{ item.badge }}
            </span>
            <!-- Coming soon indicator -->
            <span
              v-if="item.comingSoon"
              class="text-[0.5rem] font-normal tracking-wide text-white/20 uppercase"
            >
              {{ t('nav.comingSoon') }}
            </span>
          </button>
        </div>
      </div>

      <!-- Divider -->
      <div class="mx-2 my-2 h-px bg-white/[0.08]" />

      <!-- Pinned: Settings -->
      <button
        v-for="item in pinnedItems"
        :key="item.path"
        class="font-outfit group relative flex w-full items-center gap-3 rounded-2xl px-3.5 py-2.5 text-left text-[1.1rem] font-medium transition-all duration-150"
        :class="
          isActive(item.path)
            ? 'border-l-4 border-[#F15D22] bg-gradient-to-r from-[rgba(241,93,34,0.2)] to-[rgba(230,126,34,0.1)] pl-3 font-semibold text-white'
            : 'border-l-4 border-transparent text-white/40 hover:bg-white/[0.05] hover:text-white/70'
        "
        @click="navigateTo(item.path)"
      >
        <span class="w-6 text-center text-base">{{ item.emoji }}</span>
        <span>{{ item.label }}</span>
      </button>
    </nav>

    <!-- User Profile Card -->
    <div v-if="currentMemberRef" class="mt-3 rounded-2xl bg-white/[0.04] p-3">
      <div class="flex items-center gap-2.5">
        <BeanieAvatar :variant="memberVariant" :color="memberColor" size="md" />
        <div class="min-w-0">
          <p class="font-outfit truncate text-[1rem] font-semibold text-white">
            {{ currentMemberRef.name }}
          </p>
          <p class="truncate text-[0.85rem] text-white/35">
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
      <!-- File name -->
      <div v-if="syncStore.isConfigured && syncStore.fileName" class="flex items-center gap-1.5">
        <svg
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
        </svg>
        <p class="truncate text-[0.6rem] text-white/30" :title="syncStore.fileName">
          {{ syncStore.fileName }}
        </p>
      </div>

      <!-- Encryption status -->
      <div class="flex items-center gap-1.5" :title="encryptionTitle">
        <svg
          v-if="syncStore.isConfigured && syncStore.isEncryptionEnabled"
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
          v-else-if="syncStore.isConfigured"
          class="h-3 w-3 flex-shrink-0 text-amber-400/30"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 9.9-1" />
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
          class="text-[0.6rem]"
          :class="
            !syncStore.isConfigured
              ? 'text-white/30'
              : syncStore.isEncryptionEnabled
                ? 'text-[#6EE7B7]/30'
                : 'text-amber-400/30'
          "
        >
          {{
            !syncStore.isConfigured
              ? t('sidebar.noDataFile')
              : syncStore.isEncryptionEnabled
                ? t('sidebar.dataEncrypted')
                : t('sidebar.notEncrypted')
          }}
        </span>
      </div>

      <!-- Version -->
      <p class="text-[0.6rem] text-white/20">v1.0.0 - MVP</p>
    </div>
  </aside>
</template>
