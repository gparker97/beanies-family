<script setup lang="ts">
import { computed, watch, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import { useMemberAvatar } from '@/composables/useMemberAvatar';
import { usePrivacyMode } from '@/composables/usePrivacyMode';
import { useSidebarAccordion } from '@/composables/useSidebarAccordion';
import { useSounds } from '@/composables/useSounds';
import { useTranslation } from '@/composables/useTranslation';
import { getCurrencyInfo } from '@/constants/currencies';
import { LANGUAGES } from '@/constants/languages';
import {
  NAV_SECTIONS,
  TREEHOUSE_ITEMS,
  PIGGY_BANK_ITEMS,
  PINNED_ITEMS,
  type NavItemDef,
} from '@/constants/navigation';
import { useAccountsStore } from '@/stores/accountsStore';
import { useAssetsStore } from '@/stores/assetsStore';
import { useAuthStore } from '@/stores/authStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useGoalsStore } from '@/stores/goalsStore';
import { useMemberFilterStore } from '@/stores/memberFilterStore';
import { useRecurringStore } from '@/stores/recurringStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useSyncStore } from '@/stores/syncStore';
import { useTransactionsStore } from '@/stores/transactionsStore';
import { useTranslationStore } from '@/stores/translationStore';
import type { CurrencyCode, LanguageCode } from '@/types/models';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const route = useRoute();
const router = useRouter();
const { t } = useTranslation();
const authStore = useAuthStore();
const familyStore = useFamilyStore();
const goalsStore = useGoalsStore();
const memberFilterStore = useMemberFilterStore();
const settingsStore = useSettingsStore();
const syncStore = useSyncStore();
const translationStore = useTranslationStore();
const { isUnlocked, toggle: togglePrivacy } = usePrivacyMode();
const { playBlink } = useSounds();
const { isOpen, toggle: toggleSection } = useSidebarAccordion();

const ownerRef = computed(() => familyStore.owner ?? null);
const { variant: ownerVariant, color: ownerColor } = useMemberAvatar(ownerRef);

const badges = computed<Record<string, number>>(() => ({
  activeGoals: goalsStore.activeGoals.length,
}));

function mapItems(items: NavItemDef[]) {
  return items.map((item) => ({
    label: t(item.labelKey),
    path: item.path,
    emoji: item.emoji,
    active: route.path === item.path,
    comingSoon: item.comingSoon ?? false,
    badge: item.badgeKey ? (badges.value[item.badgeKey] ?? 0) : 0,
  }));
}

const SECTION_COLORS: Record<string, string> = {
  treehouse: 'text-[#F15D22]',
  piggyBank: 'text-[#27AE60]',
};

const sections = computed(() =>
  NAV_SECTIONS.map((section) => ({
    id: section.id,
    label: t(section.labelKey),
    emoji: section.emoji,
    color: SECTION_COLORS[section.id] ?? 'text-white/50',
    items: section.id === 'treehouse' ? mapItems(TREEHOUSE_ITEMS) : mapItems(PIGGY_BANK_ITEMS),
  }))
);

const pinnedItems = computed(() => mapItems(PINNED_ITEMS));

// Member filter display
const memberFilterLabel = computed(() => {
  if (memberFilterStore.isAllSelected) return t('filter.allMembers');
  const count = memberFilterStore.selectedMemberIds.size;
  return `${count} ${t('filter.members')}`;
});

const memberAvatars = computed(() =>
  familyStore.members.filter((m) => memberFilterStore.isMemberSelected(m.id)).slice(0, 4)
);

function close() {
  emit('close');
}

function navigateTo(path: string) {
  router.push(path);
  close();
}

function handlePrivacyToggle() {
  togglePrivacy();
  playBlink();
}

function resetAllStores() {
  useSyncStore().resetState();
  useFamilyStore().resetState();
  useAccountsStore().resetState();
  useTransactionsStore().resetState();
  useAssetsStore().resetState();
  useGoalsStore().resetState();
  useRecurringStore().resetState();
  useSettingsStore().resetState();
  useMemberFilterStore().resetState();
}

async function handleSignOut() {
  close();
  // Sign out first — flushes pending saves while sync service still has the
  // file handle and session password, preventing plaintext writes
  await authStore.signOut();
  resetAllStores();
  router.replace('/login');
}

async function handleSignOutAndClearData() {
  close();
  // Sign out first — flushes pending saves while session password is still available
  await authStore.signOutAndClearData();
  resetAllStores();
  router.replace('/login');
}

async function selectLanguage(code: LanguageCode) {
  await settingsStore.setLanguage(code);
  await translationStore.loadTranslations(code);
}

async function selectCurrency(code: CurrencyCode) {
  await settingsStore.setDisplayCurrency(code);
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.open) {
    close();
  }
}

// Close on route change
watch(() => route.path, close);

onMounted(() => {
  document.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown);
});

// Lock/unlock body scroll
watch(
  () => props.open,
  (isOpen) => {
    document.body.style.overflow = isOpen ? 'hidden' : '';
  }
);

const encryptionLabel = computed(() => {
  if (!syncStore.isConfigured) return t('sidebar.noDataFile');
  if (syncStore.isEncryptionEnabled) return t('sidebar.dataEncrypted');
  return t('sidebar.notEncrypted');
});
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-200"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div v-if="open" class="fixed inset-0 z-50">
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/50" @click="close" />

        <!-- Menu panel -->
        <Transition
          enter-active-class="transition-transform duration-250 ease-out"
          enter-from-class="-translate-x-full"
          enter-to-class="translate-x-0"
          leave-active-class="transition-transform duration-200 ease-in"
          leave-from-class="translate-x-0"
          leave-to-class="-translate-x-full"
        >
          <div
            v-if="open"
            class="absolute inset-y-0 left-0 flex w-80 flex-col overflow-y-auto bg-[#2C3E50]"
          >
            <!-- Close button -->
            <button
              type="button"
              class="absolute top-3 right-3 flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl text-white/50 transition-colors hover:bg-white/10 hover:text-white"
              :aria-label="t('mobile.closeMenu')"
              @click="close"
            >
              <svg
                class="h-5 w-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                stroke-width="1.75"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>

            <!-- Logo -->
            <div class="flex items-center gap-3 px-5 pt-5 pb-2">
              <div
                class="flex h-[42px] w-[42px] flex-shrink-0 items-center justify-center rounded-full bg-white"
              >
                <img
                  src="/brand/beanies_logo_transparent_logo_only_192x192.png"
                  alt="beanies.family"
                  class="h-[30px] w-[30px] object-contain"
                />
              </div>
              <div class="min-w-0">
                <h1 class="font-outfit text-base leading-tight font-bold">
                  <span class="text-white">beanies</span><span class="text-[#F15D22]">.family</span>
                </h1>
                <p
                  class="font-outfit mt-0.5 text-[0.5rem] font-light tracking-[0.06em] text-white/25 italic"
                >
                  every bean counts.
                </p>
              </div>
            </div>

            <!-- Controls section -->
            <div class="mx-4 mt-3 space-y-2 rounded-2xl bg-white/[0.04] p-3">
              <p class="text-[0.6rem] font-semibold tracking-wider text-white/30 uppercase">
                {{ t('mobile.controls') }}
              </p>

              <!-- Member filter (simplified) -->
              <div class="flex items-center gap-2">
                <div class="flex -space-x-1.5">
                  <BeanieAvatar
                    v-for="member in memberAvatars"
                    :key="member.id"
                    :variant="ownerVariant"
                    :color="member.color || '#3b82f6'"
                    size="xs"
                  />
                </div>
                <span class="text-[0.75rem] text-white/60">{{ memberFilterLabel }}</span>
              </div>

              <!-- Privacy toggle -->
              <button
                type="button"
                class="flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-1 py-1 transition-colors hover:bg-white/[0.05]"
                @click="handlePrivacyToggle"
              >
                <img
                  v-if="isUnlocked"
                  src="/brand/beanies_open_eyes_transparent_512x512.png"
                  :alt="t('header.financialFiguresVisible')"
                  class="h-6 w-6"
                />
                <img
                  v-else
                  src="/brand/beanies_covering_eyes_transparent_512x512.png"
                  :alt="t('header.financialFiguresHidden')"
                  class="h-6 w-6"
                />
                <span class="text-[0.75rem] text-white/60">
                  {{
                    isUnlocked ? t('header.showFinancialFigures') : t('header.hideFinancialFigures')
                  }}
                </span>
                <span v-if="isUnlocked" class="ml-auto h-2 w-2 rounded-full bg-[#27AE60]" />
              </button>

              <!-- Language selector -->
              <div class="flex items-center gap-2">
                <button
                  v-for="lang in LANGUAGES"
                  :key="lang.code"
                  type="button"
                  class="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-[0.75rem] transition-colors"
                  :class="[
                    lang.code === settingsStore.language
                      ? 'bg-[#F15D22]/20 text-white'
                      : 'text-white/40 hover:bg-white/[0.05] hover:text-white/60',
                    translationStore.isLoading ? 'pointer-events-none opacity-50' : '',
                  ]"
                  :disabled="translationStore.isLoading"
                  @click="selectLanguage(lang.code)"
                >
                  <!-- Loading spinner on active language -->
                  <svg
                    v-if="translationStore.isLoading && lang.code === settingsStore.language"
                    class="h-4 w-4 animate-spin text-[#F15D22]"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle
                      class="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      stroke-width="4"
                    />
                    <path
                      class="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  <template v-else>
                    <img
                      v-if="lang.flagIcon"
                      :src="lang.flagIcon"
                      :alt="lang.name"
                      class="h-4 w-5 rounded-sm object-cover"
                    />
                    <span v-else class="text-sm">{{ lang.flag }}</span>
                  </template>
                  <span>{{ lang.nativeName }}</span>
                </button>
              </div>

              <!-- Currency selector (chips) -->
              <div class="flex flex-wrap items-center gap-1">
                <button
                  v-for="code in settingsStore.effectiveDisplayCurrencies"
                  :key="code"
                  type="button"
                  class="font-outfit cursor-pointer rounded-full px-2.5 py-1 text-[0.65rem] font-semibold transition-all"
                  :class="
                    code === settingsStore.displayCurrency
                      ? 'bg-[#F15D22] text-white'
                      : 'text-white/40 hover:text-white/60'
                  "
                  @click="selectCurrency(code)"
                >
                  {{ getCurrencyInfo(code)?.symbol || '' }} {{ code }}
                </button>
              </div>
            </div>

            <!-- Divider -->
            <div class="mx-5 my-3 h-px bg-white/[0.08]" />

            <!-- Accordion Navigation -->
            <nav class="flex-1 space-y-1 px-4">
              <div v-for="section in sections" :key="section.id">
                <!-- Section Header -->
                <button
                  type="button"
                  class="font-outfit flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-[0.85rem] font-bold tracking-wide uppercase transition-colors"
                  :class="section.color"
                  @click="toggleSection(section.id as 'treehouse' | 'piggyBank')"
                >
                  <span class="text-base">{{ section.emoji }}</span>
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
                    type="button"
                    class="font-outfit flex w-full cursor-pointer items-center gap-3 rounded-2xl px-3.5 py-2.5 text-left text-[1rem] font-medium transition-all duration-150"
                    :class="[
                      item.active
                        ? 'border-l-4 border-[#F15D22] bg-gradient-to-r from-[rgba(241,93,34,0.2)] to-[rgba(230,126,34,0.1)] pl-3 font-semibold text-white'
                        : 'border-l-4 border-transparent hover:bg-white/[0.05]',
                      item.comingSoon && !item.active
                        ? 'text-white/25'
                        : !item.active
                          ? 'text-white/40 hover:text-white/70'
                          : '',
                    ]"
                    @click="navigateTo(item.path)"
                  >
                    <span class="w-6 text-center text-base">{{ item.emoji }}</span>
                    <span class="flex-1">{{ item.label }}</span>
                    <span
                      v-if="item.badge > 0"
                      class="min-w-[1.2rem] rounded-full bg-[#F15D22] px-1.5 text-center text-[0.6rem] font-semibold text-white"
                    >
                      {{ item.badge }}
                    </span>
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
                type="button"
                class="font-outfit flex w-full cursor-pointer items-center gap-3 rounded-2xl px-3.5 py-2.5 text-left text-[1rem] font-medium transition-all duration-150"
                :class="
                  item.active
                    ? 'border-l-4 border-[#F15D22] bg-gradient-to-r from-[rgba(241,93,34,0.2)] to-[rgba(230,126,34,0.1)] pl-3 font-semibold text-white'
                    : 'border-l-4 border-transparent text-white/40 hover:bg-white/[0.05] hover:text-white/70'
                "
                @click="navigateTo(item.path)"
              >
                <span class="w-6 text-center text-base">{{ item.emoji }}</span>
                <span>{{ item.label }}</span>
              </button>
            </nav>

            <!-- Footer: security indicators -->
            <div class="mt-auto space-y-1 px-5 pt-3 pb-6">
              <!-- User profile -->
              <div
                v-if="familyStore.owner"
                class="mb-3 flex items-center gap-2.5 rounded-2xl bg-white/[0.04] p-3"
              >
                <BeanieAvatar :variant="ownerVariant" :color="ownerColor" size="md" />
                <div class="min-w-0">
                  <p class="font-outfit truncate text-[0.9rem] font-semibold text-white">
                    {{ familyStore.owner.name }}
                  </p>
                  <p class="truncate text-[0.75rem] text-white/35">
                    {{
                      familyStore.owner.role === 'owner'
                        ? t('family.role.owner')
                        : familyStore.owner.role
                    }}
                  </p>
                </div>
              </div>

              <!-- Encryption status -->
              <div class="flex items-center gap-1.5">
                <svg
                  class="h-3 w-3 flex-shrink-0"
                  :class="
                    syncStore.isConfigured && syncStore.isEncryptionEnabled
                      ? 'text-[#6EE7B7]/30'
                      : syncStore.isConfigured
                        ? 'text-amber-400/30'
                        : 'text-white/30'
                  "
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
                <span class="text-[0.6rem] text-white/30">{{ encryptionLabel }}</span>
              </div>

              <!-- File name -->
              <div
                v-if="syncStore.isConfigured && syncStore.fileName"
                class="flex items-center gap-1.5"
              >
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
                <span class="truncate text-[0.6rem] text-white/30">{{ syncStore.fileName }}</span>
              </div>

              <!-- Sign out buttons -->
              <div class="space-y-1">
                <button
                  type="button"
                  class="flex w-full cursor-pointer items-center gap-2 rounded-xl px-2 py-2 text-[0.8rem] text-red-400 transition-colors hover:bg-white/[0.05]"
                  @click="handleSignOut"
                >
                  {{ t('auth.signOut') }}
                </button>
                <button
                  v-if="settingsStore.isTrustedDevice"
                  type="button"
                  class="flex w-full cursor-pointer items-center gap-2 rounded-xl px-2 py-2 text-[0.75rem] text-white/40 transition-colors hover:bg-white/[0.05]"
                  @click="handleSignOutAndClearData"
                >
                  {{ t('auth.signOutClearData') }}
                </button>
              </div>

              <!-- Version -->
              <p class="text-[0.6rem] text-white/20">{{ t('app.version') }}</p>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>
