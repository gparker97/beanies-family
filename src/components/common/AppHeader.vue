<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import MemberFilterDropdown from '@/components/common/MemberFilterDropdown.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import InfoHintBadge from '@/components/ui/InfoHintBadge.vue';
import GlobalSearch from '@/components/common/GlobalSearch.vue';
import { useBreakpoint } from '@/composables/useBreakpoint';
import { getMemberAvatarVariant } from '@/composables/useMemberAvatar';
import { getMemberAvatarUrl, markMemberAvatarError } from '@/composables/useMemberInfo';
import { usePrivacyMode } from '@/composables/usePrivacyMode';
import { useSounds } from '@/composables/useSounds';
import { getCurrencyInfo } from '@/constants/currencies';
import { LANGUAGES, getLanguageInfo } from '@/constants/languages';
import { useAccountsStore } from '@/stores/accountsStore';
import { useAssetsStore } from '@/stores/assetsStore';
import { useAuthStore } from '@/stores/authStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { useGoalsStore } from '@/stores/goalsStore';
import { useMemberFilterStore } from '@/stores/memberFilterStore';
import { useRecurringStore } from '@/stores/recurringStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useSyncStore } from '@/stores/syncStore';
import { useTodoStore } from '@/stores/todoStore';
import { useActivityStore } from '@/stores/activityStore';
import { useTransactionsStore } from '@/stores/transactionsStore';
import { useTranslationStore } from '@/stores/translationStore';
import { useTranslation } from '@/composables/useTranslation';
import { showToast } from '@/composables/useToast';
import { isTemporaryEmail } from '@/utils/email';
import { formatDateFull, toDateInputValue } from '@/utils/date';
import { MARKETING_URL } from '@/utils/marketing';
import type { UIStringKey } from '@/services/translation/uiStrings';
import type { CurrencyCode, LanguageCode } from '@/types/models';

const emit = defineEmits<{ toggleMenu: [] }>();

const route = useRoute();
const router = useRouter();
const { isDesktop } = useBreakpoint();
const authStore = useAuthStore();
const familyStore = useFamilyStore();
const familyContextStore = useFamilyContextStore();
const settingsStore = useSettingsStore();
const syncStore = useSyncStore();
const translationStore = useTranslationStore();
const { t } = useTranslation();

// ── Page title / Dashboard greeting ──────────────────────────────────────
const isNookOrDashboard = computed(() => route.name === 'Dashboard' || route.name === 'Nook');
const memberName = computed(
  () => familyStore.currentMember?.name || familyStore.owner?.name || 'there'
);

const greeting = computed(() => {
  const hour = new Date().getHours();
  if (hour < 12) return `${t('greeting.morning')} ${memberName.value}`;
  if (hour < 18) return `${t('greeting.afternoon')} ${memberName.value}`;
  return `${t('greeting.evening')} ${memberName.value}`;
});

const todayFormatted = computed(() => {
  return formatDateFull(toDateInputValue(new Date()));
});

const pageTitle = computed(() => {
  const titleKey = route.meta?.titleKey as UIStringKey | undefined;
  return titleKey ? t(titleKey) : '';
});

const { isUnlocked, toggle: togglePrivacy } = usePrivacyMode();
const { playBlink } = useSounds();
const currentMember = computed(() => familyStore.currentMember);
const showSearch = ref(false);
const showLanguageDropdown = ref(false);
const showProfileDropdown = ref(false);
const showCurrencyDropdown = ref(false);
const showSignOutModal = ref(false);
const privacyAnimating = ref(false);

// ── Currency chips ───────────────────────────────────────────────────────
const hasMultipleCurrencies = computed(() => settingsStore.effectiveDisplayCurrencies.length >= 2);

const currencyChips = computed(() =>
  settingsStore.effectiveDisplayCurrencies.map((code) => {
    const info = getCurrencyInfo(code);
    return {
      code,
      symbol: info?.symbol || code,
      label: `${info?.symbol || ''} ${code}`.trim(),
      active: code === settingsStore.displayCurrency,
    };
  })
);

// Fallback: single currency display for 0-1 preferred
const currentCurrencyInfo = computed(() => getCurrencyInfo(settingsStore.displayCurrency));
const currentLanguageInfo = computed(() => getLanguageInfo(settingsStore.language));

async function selectCurrencyChip(code: CurrencyCode) {
  await settingsStore.setDisplayCurrency(code);
}

async function selectCurrency(code: CurrencyCode) {
  await settingsStore.setDisplayCurrency(code);
  showCurrencyDropdown.value = false;
}

async function selectLanguage(code: LanguageCode) {
  showLanguageDropdown.value = false;
  await settingsStore.setLanguage(code);
  await translationStore.loadTranslations(code);
}

function handlePrivacyToggle() {
  privacyAnimating.value = true;
  togglePrivacy();
  playBlink();
}

function closeCurrencyDropdown() {
  showCurrencyDropdown.value = false;
}

function closeLanguageDropdown() {
  showLanguageDropdown.value = false;
}

function closeProfileDropdown() {
  showProfileDropdown.value = false;
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
  useTodoStore().resetState();
  useActivityStore().resetState();
}

function handleEditProfile() {
  showProfileDropdown.value = false;
  if (currentMember.value) {
    router.push({ path: '/family', query: { edit: currentMember.value.id } });
  }
}

function handleOpenSettings() {
  showProfileDropdown.value = false;
  router.push('/settings');
}

function handleOpenHelp() {
  showProfileDropdown.value = false;
  window.open(`${MARKETING_URL}/help`, '_blank', 'noopener,noreferrer');
}

const isRefreshing = ref(false);

async function handleRefreshAll() {
  showProfileDropdown.value = false;
  if (isRefreshing.value) return;
  isRefreshing.value = true;

  try {
    // Check for app updates (SW)
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) registration.update();
    }

    // Refresh data from Drive
    if (syncStore.isConfigured && !syncStore.needsPermission) {
      await syncStore.backgroundSyncFromFile();
      if (!syncStore.backgroundSyncError) {
        showToast('success', t('header.refreshSuccess'));
      }
    } else {
      showToast('info', t('header.refreshNoSync'));
    }
  } catch {
    showToast('warning', t('sync.backgroundError'));
  } finally {
    isRefreshing.value = false;
  }
}

function promptSignOut() {
  showProfileDropdown.value = false;
  showSignOutModal.value = true;
}

async function confirmSignOut() {
  showSignOutModal.value = false;
  await authStore.signOut();
  resetAllStores();
  router.replace('/login');
}

async function confirmSignOutAndClearData() {
  showSignOutModal.value = false;
  await authStore.signOutAndClearData();
  resetAllStores();
  router.replace('/login');
}
</script>

<template>
  <header class="flex h-16 items-center justify-between bg-transparent px-4 md:px-6">
    <!-- ═══ MOBILE / TABLET HEADER ═══ -->
    <template v-if="!isDesktop">
      <!-- Left: Hamburger -->
      <button
        type="button"
        class="flex h-10 w-10 cursor-pointer flex-col items-start justify-center gap-[5px] rounded-[14px] bg-white pl-3 shadow-[0_2px_8px_rgba(44,62,80,0.06)] dark:bg-slate-800 dark:shadow-none"
        :aria-label="t('mobile.menu')"
        @click="emit('toggleMenu')"
      >
        <span class="bg-secondary-500/50 h-[2px] w-[14px] rounded-full dark:bg-gray-400/50" />
        <span class="bg-secondary-500/50 h-[2px] w-[14px] rounded-full dark:bg-gray-400/50" />
        <span class="bg-primary-500 h-[2px] w-[10px] rounded-full" />
      </button>

      <!-- Center: Greeting or page title (truncated) -->
      <div class="mx-3 min-w-0 flex-1 text-center">
        <h1 class="font-outfit text-secondary-500 truncate text-base font-bold dark:text-gray-100">
          {{ isNookOrDashboard ? greeting : pageTitle }}
        </h1>
      </div>

      <!-- Right: Privacy toggle + Search + Profile avatar -->
      <div class="flex items-center gap-2">
        <!-- Privacy mode toggle -->
        <button
          type="button"
          class="relative flex h-10 w-10 cursor-pointer items-center justify-center rounded-[14px] bg-white shadow-[0_2px_8px_rgba(44,62,80,0.06)] transition-colors dark:bg-slate-800 dark:shadow-none"
          :aria-label="
            isUnlocked ? t('header.hideFinancialFigures') : t('header.showFinancialFigures')
          "
          :title="isUnlocked ? t('header.hideFinancialFigures') : t('header.showFinancialFigures')"
          @click="handlePrivacyToggle"
        >
          <img
            v-if="isUnlocked"
            src="/brand/beanies_open_eyes_transparent_512x512.png"
            :alt="t('header.financialFiguresVisible')"
            class="h-7 w-7"
            :class="{ 'animate-beanie-blink': privacyAnimating }"
            @animationend="privacyAnimating = false"
          />
          <img
            v-else
            src="/brand/beanies_covering_eyes_transparent_512x512.png"
            :alt="t('header.financialFiguresHidden')"
            class="h-7 w-7"
            :class="{ 'animate-beanie-blink': privacyAnimating }"
            @animationend="privacyAnimating = false"
          />
          <span
            v-if="isUnlocked"
            class="absolute right-0.5 bottom-0.5 h-2 w-2 rounded-full bg-[#27AE60]"
          />
        </button>

        <!-- Search -->
        <button
          type="button"
          class="flex h-10 w-10 cursor-pointer items-center justify-center rounded-[14px] bg-white shadow-[0_2px_8px_rgba(44,62,80,0.06)] transition-colors dark:bg-slate-800 dark:shadow-none"
          :aria-label="t('search.placeholder')"
          @click="showSearch = true"
        >
          <svg
            class="h-[18px] w-[18px] text-gray-400 dark:text-gray-500"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            viewBox="0 0 24 24"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>

        <!-- Profile avatar dropdown -->
        <div class="relative">
          <button
            v-if="currentMember || authStore.isAuthenticated"
            type="button"
            class="flex h-10 w-10 cursor-pointer items-center justify-center rounded-[14px] bg-white shadow-[0_2px_8px_rgba(44,62,80,0.06)] transition-colors dark:bg-slate-800 dark:shadow-none"
            @click="showProfileDropdown = !showProfileDropdown"
            @blur="closeProfileDropdown"
          >
            <BeanieAvatar
              :variant="currentMember ? getMemberAvatarVariant(currentMember) : 'adult-other'"
              :color="currentMember?.color || '#3b82f6'"
              :photo-url="currentMember ? getMemberAvatarUrl(currentMember) : null"
              size="sm"
              :aria-label="currentMember?.name || 'Profile'"
              data-testid="header-avatar-mobile"
              @photo-error="currentMember && markMemberAvatarError(currentMember)"
            />
          </button>

          <!-- Profile dropdown menu (shared styling) -->
          <div
            v-if="showProfileDropdown"
            class="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_8px_24px_rgba(44,62,80,0.12)] dark:border-slate-700 dark:bg-slate-800 dark:shadow-[0_8px_24px_rgba(0,0,0,0.3)]"
          >
            <!-- Profile header -->
            <div
              class="bg-gradient-to-r from-[var(--color-secondary-500)] to-[var(--color-secondary-500)]/90 px-4 py-3"
            >
              <div class="flex items-center gap-2">
                <BeanieAvatar
                  :variant="currentMember ? getMemberAvatarVariant(currentMember) : 'adult-other'"
                  :color="currentMember?.color || '#3b82f6'"
                  :photo-url="currentMember ? getMemberAvatarUrl(currentMember) : null"
                  size="md"
                  @photo-error="currentMember && markMemberAvatarError(currentMember)"
                />
                <div class="min-w-0 flex-1">
                  <p class="font-outfit truncate text-sm font-semibold text-white">
                    {{ currentMember?.name || authStore.currentUser?.email || 'User' }}
                  </p>
                  <p
                    v-if="familyContextStore.activeFamilyName"
                    class="truncate text-xs text-white/60"
                  >
                    {{ familyContextStore.activeFamilyName }}
                  </p>
                  <p
                    v-if="
                      authStore.currentUser?.email && !isTemporaryEmail(authStore.currentUser.email)
                    "
                    class="truncate text-xs text-white/50"
                  >
                    {{ authStore.currentUser.email }}
                  </p>
                </div>
                <!-- Refresh all data -->
                <button
                  type="button"
                  class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/15 transition-colors hover:bg-white/30"
                  :title="t('header.refreshAll')"
                  :disabled="isRefreshing"
                  @mousedown.prevent="handleRefreshAll"
                >
                  <svg
                    class="h-4 w-4 text-white"
                    :class="{ 'animate-spin': isRefreshing }"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                </button>
              </div>
            </div>

            <!-- Menu items -->
            <div class="py-1.5">
              <!-- Edit Profile -->
              <button
                v-if="currentMember"
                type="button"
                class="text-secondary-500 flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-slate-700"
                @mousedown.prevent="handleEditProfile"
              >
                <svg
                  class="h-4 w-4 shrink-0 opacity-50"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  viewBox="0 0 24 24"
                >
                  <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                {{ t('header.editProfile') }}
              </button>

              <!-- Settings -->
              <button
                type="button"
                class="text-secondary-500 flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-slate-700"
                @mousedown.prevent="handleOpenSettings"
              >
                <BeanieIcon name="settings" size="sm" class="opacity-50" />
                {{ t('header.settings') }}
              </button>

              <!-- Help -->
              <button
                type="button"
                class="text-secondary-500 flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-slate-700"
                @mousedown.prevent="handleOpenHelp"
              >
                <svg
                  class="h-4 w-4 shrink-0 opacity-50"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  viewBox="0 0 24 24"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                {{ t('nav.help') }}
              </button>

              <!-- Divider -->
              <div class="my-1.5 border-t border-gray-100 dark:border-slate-700" />

              <!-- Sign out -->
              <button
                type="button"
                class="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-red-500 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/10"
                @mousedown.prevent="promptSignOut"
              >
                <svg
                  class="h-4 w-4 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  viewBox="0 0 24 24"
                >
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                {{ t('auth.signOut') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- ═══ DESKTOP HEADER ═══ -->
    <template v-else>
      <!-- Left side - Page title (or greeting on Nook/Dashboard) + today's date -->
      <div class="min-w-0">
        <h1 class="font-outfit text-secondary-500 truncate text-lg font-bold dark:text-gray-100">
          {{ isNookOrDashboard ? greeting : pageTitle }}
        </h1>
        <p class="font-outfit text-primary-500 text-xs font-medium">
          {{ todayFormatted }}
        </p>
      </div>

      <!-- Right side - v4 pill/squircle controls -->
      <div class="flex items-center gap-2">
        <!-- Member Filter -->
        <MemberFilterDropdown />

        <!-- Currency selector -->
        <!-- Multi-chip mode: 2+ effective currencies -->
        <div
          v-if="hasMultipleCurrencies"
          class="flex h-10 items-center gap-0.5 rounded-[14px] bg-white px-1.5 shadow-[0_2px_8px_rgba(44,62,80,0.06)] dark:bg-slate-800 dark:shadow-none"
        >
          <button
            v-for="chip in currencyChips"
            :key="chip.code"
            type="button"
            class="font-outfit cursor-pointer rounded-full px-2.5 py-1 text-xs font-semibold transition-all"
            :class="
              chip.active
                ? 'bg-primary-500 text-white shadow-[0_2px_8px_rgba(241,93,34,0.2)]'
                : 'text-secondary-500/50 hover:text-secondary-500/70 dark:text-gray-500 dark:hover:text-gray-300'
            "
            @click="selectCurrencyChip(chip.code)"
          >
            <span class="text-[#27AE60]">{{ chip.symbol }}</span>
            {{ chip.code }}
          </button>
        </div>

        <!-- Single-currency fallback mode: pill with chevron + dropdown -->
        <div v-else class="relative">
          <button
            type="button"
            class="font-outfit flex h-10 items-center gap-1.5 rounded-[14px] bg-white px-3 text-sm font-semibold text-gray-700 shadow-[0_2px_8px_rgba(44,62,80,0.06)] transition-colors dark:bg-slate-800 dark:text-gray-300 dark:shadow-none"
            @click="showCurrencyDropdown = !showCurrencyDropdown"
            @blur="closeCurrencyDropdown"
          >
            <span class="text-[#27AE60]">{{
              currentCurrencyInfo?.symbol || settingsStore.displayCurrency
            }}</span>
            {{ settingsStore.displayCurrency }}
            <span class="text-secondary-500/30 text-[0.5rem]">▼</span>
          </button>

          <!-- Dropdown menu -->
          <div
            v-if="showCurrencyDropdown"
            class="absolute right-0 z-50 mt-1 max-h-64 w-48 overflow-y-auto rounded-2xl border border-gray-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800"
          >
            <button
              v-for="chip in currencyChips"
              :key="chip.code"
              type="button"
              class="w-full px-3 py-2 text-left text-sm transition-colors hover:bg-gray-100 dark:hover:bg-slate-700"
              :class="
                chip.active
                  ? 'bg-primary-50 text-primary-600 dark:bg-primary-900/20 dark:text-primary-400'
                  : 'text-gray-700 dark:text-gray-300'
              "
              @mousedown.prevent="selectCurrency(chip.code)"
            >
              {{ chip.label }}
            </button>
          </div>
        </div>

        <!-- Language selector (emoji flag in white-bg pill + chevron) -->
        <div class="relative">
          <button
            type="button"
            class="flex h-10 items-center gap-1 rounded-[14px] bg-white px-2 shadow-[0_2px_8px_rgba(44,62,80,0.06)] transition-all hover:shadow-[0_4px_12px_rgba(44,62,80,0.1)] dark:bg-slate-800 dark:shadow-none"
            :class="{ 'opacity-75': translationStore.isLoading }"
            @click="showLanguageDropdown = !showLanguageDropdown"
            @blur="closeLanguageDropdown"
          >
            <template v-if="translationStore.isLoading">
              <BeanieIcon name="refresh" size="sm" class="animate-spin text-gray-400" />
            </template>
            <img
              v-else-if="currentLanguageInfo?.flagIcon"
              :src="currentLanguageInfo.flagIcon"
              :alt="currentLanguageInfo.name"
              class="h-6 w-8 rounded-sm object-cover"
            />
            <span v-else class="text-[26px] leading-none">
              {{ currentLanguageInfo?.flag || '🌐' }}
            </span>
            <span class="text-secondary-500/30 text-[0.5rem]">▼</span>
          </button>

          <!-- Language dropdown -->
          <div
            v-if="showLanguageDropdown"
            class="absolute right-0 z-50 mt-1 w-52 overflow-hidden rounded-2xl border border-gray-200 bg-white py-1.5 shadow-lg dark:border-slate-700 dark:bg-slate-800"
          >
            <button
              v-for="lang in LANGUAGES"
              :key="lang.code"
              type="button"
              class="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-all"
              :class="
                lang.code === settingsStore.language
                  ? 'bg-primary-500/10 dark:bg-primary-500/20'
                  : 'hover:bg-gray-50 dark:hover:bg-slate-700'
              "
              @mousedown.prevent="selectLanguage(lang.code)"
            >
              <span
                class="flex h-9 w-9 items-center justify-center overflow-hidden rounded-[10px]"
                :class="
                  lang.code === settingsStore.language
                    ? 'bg-primary-500/15 shadow-[0_2px_6px_rgba(241,93,34,0.15)]'
                    : 'bg-gray-100 dark:bg-slate-600'
                "
              >
                <img
                  v-if="lang.flagIcon"
                  :src="lang.flagIcon"
                  :alt="lang.name"
                  class="h-6 w-8 rounded-sm object-cover"
                />
                <span v-else class="text-2xl">{{ lang.flag }}</span>
              </span>
              <span
                class="text-sm font-medium"
                :class="
                  lang.code === settingsStore.language
                    ? 'text-primary-500'
                    : 'text-gray-500 dark:text-gray-400'
                "
              >
                {{ lang.nativeName }}
              </span>
            </button>
          </div>
        </div>

        <!-- Privacy mode toggle (white-bg squircle) -->
        <button
          type="button"
          class="relative flex h-10 w-10 cursor-pointer items-center justify-center rounded-[14px] bg-white shadow-[0_2px_8px_rgba(44,62,80,0.06)] transition-colors dark:bg-slate-800 dark:shadow-none"
          :aria-label="
            isUnlocked ? t('header.hideFinancialFigures') : t('header.showFinancialFigures')
          "
          :title="isUnlocked ? t('header.hideFinancialFigures') : t('header.showFinancialFigures')"
          @click="handlePrivacyToggle"
        >
          <!-- Open eyes (figures visible) -->
          <img
            v-if="isUnlocked"
            src="/brand/beanies_open_eyes_transparent_512x512.png"
            :alt="t('header.financialFiguresVisible')"
            class="h-8 w-8"
            :class="{ 'animate-beanie-blink': privacyAnimating }"
            @animationend="privacyAnimating = false"
          />
          <!-- Covering eyes (figures hidden) -->
          <img
            v-else
            src="/brand/beanies_covering_eyes_transparent_512x512.png"
            :alt="t('header.financialFiguresHidden')"
            class="h-8 w-8"
            :class="{ 'animate-beanie-blink': privacyAnimating }"
            @animationend="privacyAnimating = false"
          />
          <!-- Green status dot when unlocked -->
          <span
            v-if="isUnlocked"
            class="absolute right-0.5 bottom-0.5 h-2 w-2 rounded-full bg-[#27AE60]"
          />
        </button>

        <!-- Search -->
        <button
          type="button"
          class="flex h-10 w-10 cursor-pointer items-center justify-center rounded-[14px] bg-white shadow-[0_2px_8px_rgba(44,62,80,0.06)] transition-colors hover:bg-gray-50 dark:bg-slate-800 dark:shadow-none dark:hover:bg-slate-700"
          :aria-label="t('search.placeholder')"
          @click="showSearch = true"
        >
          <svg
            class="h-[18px] w-[18px] text-gray-400 dark:text-gray-500"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            viewBox="0 0 24 24"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>

        <!-- Profile dropdown (avatar + chevron) -->
        <div class="relative">
          <button
            v-if="currentMember || authStore.isAuthenticated"
            class="flex items-center gap-1 rounded-[14px] py-1 pr-1 pl-1 transition-colors hover:bg-gray-100 dark:hover:bg-white/[0.08]"
            @click="showProfileDropdown = !showProfileDropdown"
            @blur="closeProfileDropdown"
          >
            <BeanieAvatar
              :variant="currentMember ? getMemberAvatarVariant(currentMember) : 'adult-other'"
              :color="currentMember?.color || '#3b82f6'"
              :photo-url="currentMember ? getMemberAvatarUrl(currentMember) : null"
              size="sm"
              :aria-label="currentMember?.name || 'Profile'"
              data-testid="header-avatar"
              @photo-error="currentMember && markMemberAvatarError(currentMember)"
            />
            <BeanieIcon name="chevron-down" size="xs" class="text-gray-400" />
          </button>

          <!-- Profile dropdown menu -->
          <div
            v-if="showProfileDropdown"
            class="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_8px_24px_rgba(44,62,80,0.12)] dark:border-slate-700 dark:bg-slate-800 dark:shadow-[0_8px_24px_rgba(0,0,0,0.3)]"
          >
            <!-- Profile header with Deep Slate gradient -->
            <div
              class="bg-gradient-to-r from-[var(--color-secondary-500)] to-[var(--color-secondary-500)]/90 px-4 py-3"
            >
              <div class="flex items-center gap-2">
                <BeanieAvatar
                  :variant="currentMember ? getMemberAvatarVariant(currentMember) : 'adult-other'"
                  :color="currentMember?.color || '#3b82f6'"
                  :photo-url="currentMember ? getMemberAvatarUrl(currentMember) : null"
                  size="md"
                  @photo-error="currentMember && markMemberAvatarError(currentMember)"
                />
                <div class="min-w-0 flex-1">
                  <p class="font-outfit truncate text-sm font-semibold text-white">
                    {{ currentMember?.name || authStore.currentUser?.email || 'User' }}
                  </p>
                  <p
                    v-if="familyContextStore.activeFamilyName"
                    class="truncate text-xs text-white/60"
                  >
                    {{ familyContextStore.activeFamilyName }}
                  </p>
                  <p
                    v-if="
                      authStore.currentUser?.email && !isTemporaryEmail(authStore.currentUser.email)
                    "
                    class="truncate text-xs text-white/50"
                  >
                    {{ authStore.currentUser.email }}
                  </p>
                </div>
                <!-- Refresh all data -->
                <button
                  type="button"
                  class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/15 transition-colors hover:bg-white/30"
                  :title="t('header.refreshAll')"
                  :disabled="isRefreshing"
                  @mousedown.prevent="handleRefreshAll"
                >
                  <svg
                    class="h-4 w-4 text-white"
                    :class="{ 'animate-spin': isRefreshing }"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                </button>
              </div>
            </div>

            <!-- Menu items -->
            <div class="py-1.5">
              <!-- Edit Profile -->
              <button
                v-if="currentMember"
                type="button"
                class="text-secondary-500 flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-slate-700"
                @mousedown.prevent="handleEditProfile"
              >
                <svg
                  class="h-4 w-4 shrink-0 opacity-50"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  viewBox="0 0 24 24"
                >
                  <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                {{ t('header.editProfile') }}
              </button>

              <!-- Settings -->
              <button
                type="button"
                class="text-secondary-500 flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-slate-700"
                @mousedown.prevent="handleOpenSettings"
              >
                <BeanieIcon name="settings" size="sm" class="opacity-50" />
                {{ t('header.settings') }}
              </button>

              <!-- Help -->
              <button
                type="button"
                class="text-secondary-500 flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-slate-700"
                @mousedown.prevent="handleOpenHelp"
              >
                <svg
                  class="h-4 w-4 shrink-0 opacity-50"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  viewBox="0 0 24 24"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                {{ t('nav.help') }}
              </button>

              <!-- Divider -->
              <div class="my-1.5 border-t border-gray-100 dark:border-slate-700" />

              <!-- Sign out -->
              <button
                type="button"
                class="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-red-500 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/10"
                @mousedown.prevent="promptSignOut"
              >
                <svg
                  class="h-4 w-4 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  viewBox="0 0 24 24"
                >
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                {{ t('auth.signOut') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- ═══ SIGN OUT CONFIRMATION MODAL ═══ -->
    <Teleport to="body">
      <BaseModal
        :open="showSignOutModal"
        :title="t('auth.signOutConfirmTitle')"
        size="sm"
        layer="overlay"
        @close="showSignOutModal = false"
      >
        <div class="flex flex-col items-center gap-4 text-center">
          <!-- Icon -->
          <div
            class="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-100 text-red-500 dark:bg-red-900/30 dark:text-red-400"
          >
            <svg
              class="h-6 w-6"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              viewBox="0 0 24 24"
            >
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </div>

          <p class="text-sm text-gray-600 dark:text-gray-300">
            {{ t('auth.signOutConfirmMessage') }}
          </p>
          <p class="text-xs text-gray-400 dark:text-gray-500">
            {{ t('auth.signOutConfirmHint') }}
          </p>
        </div>

        <template #footer>
          <div class="flex flex-col gap-3">
            <!-- Sign-out options — side by side -->
            <div class="grid grid-cols-2 gap-3">
              <BaseButton
                variant="danger"
                size="sm"
                class="!h-auto !w-full"
                @click="confirmSignOut"
              >
                <template #default>
                  <span class="flex items-center justify-center gap-1.5">
                    🚪 {{ t('auth.signOut') }}
                  </span>
                </template>
              </BaseButton>
              <BaseButton
                variant="ghost"
                size="sm"
                class="!h-auto !w-full !border !border-red-200 !text-red-500 hover:!bg-red-50 dark:!border-red-800 dark:!text-red-400 dark:hover:!bg-red-900/20"
                @click="confirmSignOutAndClearData"
              >
                <template #default>
                  <span class="flex items-center justify-center gap-1.5">
                    🗑️ {{ t('auth.signOutClearData') }}
                  </span>
                </template>
              </BaseButton>
            </div>
            <div class="flex justify-end">
              <span class="flex items-center gap-1">
                <span class="text-[10px] text-gray-400 dark:text-gray-500">
                  {{ t('common.whatsThis') }}
                </span>
                <InfoHintBadge :text="t('auth.signOutClearDataHint')" />
              </span>
            </div>

            <!-- Cancel -->
            <button
              type="button"
              class="font-outfit mx-auto text-xs font-medium text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
              @click="showSignOutModal = false"
            >
              {{ t('action.cancel') }}
            </button>
          </div>
        </template>
      </BaseModal>
    </Teleport>

    <!-- Global search overlay -->
    <GlobalSearch :open="showSearch" @close="showSearch = false" />
  </header>
</template>
