<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import MemberFilterDropdown from '@/components/common/MemberFilterDropdown.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import { useBreakpoint } from '@/composables/useBreakpoint';
import { getMemberAvatarVariant } from '@/composables/useMemberAvatar';
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
import { useTransactionsStore } from '@/stores/transactionsStore';
import { useTranslationStore } from '@/stores/translationStore';
import { useTranslation } from '@/composables/useTranslation';
import type { CurrencyCode, LanguageCode } from '@/types/models';

const emit = defineEmits<{ toggleMenu: [] }>();

const route = useRoute();
const router = useRouter();
const { isDesktop } = useBreakpoint();
const authStore = useAuthStore();
const familyStore = useFamilyStore();
const familyContextStore = useFamilyContextStore();
const settingsStore = useSettingsStore();
const translationStore = useTranslationStore();
const { t } = useTranslation();

// ── Page title / Dashboard greeting ──────────────────────────────────────
const isDashboard = computed(() => route.name === 'Dashboard');
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
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
});

const pageTitle = computed(() => (route.meta?.title as string) || '');

const { isUnlocked, toggle: togglePrivacy } = usePrivacyMode();
const { playBlink } = useSounds();
const currentMember = computed(() => familyStore.currentMember);
const showLanguageDropdown = ref(false);
const showProfileDropdown = ref(false);
const showCurrencyDropdown = ref(false);
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
}

async function handleSignOut() {
  showProfileDropdown.value = false;
  resetAllStores();
  await authStore.signOut();
  router.replace('/login');
}

async function handleSignOutAndClearData() {
  showProfileDropdown.value = false;
  resetAllStores();
  await authStore.signOutAndClearData();
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
        class="relative flex h-10 w-10 cursor-pointer items-center justify-center rounded-[14px] bg-white shadow-[0_2px_8px_rgba(44,62,80,0.06)] dark:bg-slate-800 dark:shadow-none"
        :aria-label="t('mobile.menu')"
        @click="emit('toggleMenu')"
      >
        <svg
          class="h-5 w-5 text-[#2C3E50] dark:text-gray-300"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
        <!-- Heritage Orange accent line -->
        <span class="absolute right-2.5 bottom-1.5 left-2.5 h-[2px] rounded-full bg-[#F15D22]" />
      </button>

      <!-- Center: Greeting or page title (truncated) -->
      <div class="mx-3 min-w-0 flex-1 text-center">
        <h1 class="font-outfit text-secondary-500 truncate text-base font-bold dark:text-gray-100">
          {{ isDashboard ? greeting : pageTitle }}
        </h1>
      </div>

      <!-- Right: Notification bell -->
      <button
        type="button"
        class="relative flex h-10 w-10 cursor-pointer items-center justify-center rounded-[14px] bg-white text-gray-500 shadow-[0_2px_8px_rgba(44,62,80,0.06)] transition-colors dark:bg-slate-800 dark:text-gray-400 dark:shadow-none"
        :aria-label="t('header.notifications')"
      >
        <BeanieIcon name="bell" size="md" />
        <span class="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-[#F15D22]" />
      </button>
    </template>

    <!-- ═══ DESKTOP HEADER ═══ -->
    <template v-else>
      <!-- Left side - Page title or greeting -->
      <div class="min-w-0">
        <template v-if="isDashboard">
          <h1 class="font-outfit text-secondary-500 truncate text-lg font-bold dark:text-gray-100">
            {{ greeting }}
          </h1>
          <p class="text-secondary-500/40 text-xs dark:text-gray-500">
            {{ todayFormatted }}
          </p>
        </template>
        <h1
          v-else
          class="font-outfit text-secondary-500 truncate text-lg font-bold dark:text-gray-100"
        >
          {{ pageTitle }}
        </h1>
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
            class="font-outfit cursor-pointer rounded-full px-2.5 py-1 text-[0.65rem] font-semibold transition-all"
            :class="
              chip.active
                ? 'bg-[#F15D22] text-white shadow-[0_2px_8px_rgba(241,93,34,0.2)]'
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
                  ? 'bg-[#F15D22]/10 dark:bg-[#F15D22]/20'
                  : 'hover:bg-gray-50 dark:hover:bg-slate-700'
              "
              @mousedown.prevent="selectLanguage(lang.code)"
            >
              <span
                class="flex h-9 w-9 items-center justify-center overflow-hidden rounded-[10px]"
                :class="
                  lang.code === settingsStore.language
                    ? 'bg-[#F15D22]/15 shadow-[0_2px_6px_rgba(241,93,34,0.15)]'
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
                    ? 'text-[#F15D22]'
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

        <!-- Notification bell (white-bg squircle) -->
        <button
          type="button"
          class="relative flex h-10 w-10 cursor-pointer items-center justify-center rounded-[14px] bg-white text-gray-500 shadow-[0_2px_8px_rgba(44,62,80,0.06)] transition-colors dark:bg-slate-800 dark:text-gray-400 dark:shadow-none"
          :aria-label="t('header.notifications')"
          :title="t('header.notifications')"
        >
          <BeanieIcon name="bell" size="md" />
          <!-- Heritage Orange notification dot -->
          <span class="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-[#F15D22]" />
        </button>

        <!-- Profile dropdown (avatar + chevron only) -->
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
              size="sm"
              :aria-label="currentMember?.name || 'Profile'"
              data-testid="header-avatar"
            />
            <BeanieIcon name="chevron-down" size="xs" class="text-gray-400" />
          </button>

          <!-- Profile dropdown menu -->
          <div
            v-if="showProfileDropdown"
            class="absolute right-0 z-50 mt-1 w-56 rounded-2xl border border-gray-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800"
          >
            <div class="border-b border-gray-200 px-4 py-2 dark:border-slate-700">
              <p class="text-sm font-medium text-gray-900 dark:text-white">
                {{ currentMember?.name || authStore.currentUser?.email || 'User' }}
              </p>
              <p
                v-if="familyContextStore.activeFamilyName"
                class="text-xs text-gray-500 dark:text-gray-400"
              >
                {{ familyContextStore.activeFamilyName }}
              </p>
              <p
                v-if="authStore.currentUser?.email"
                class="text-xs text-gray-500 dark:text-gray-400"
              >
                {{ authStore.currentUser.email }}
              </p>
            </div>
            <!-- Sign out -->
            <button
              type="button"
              class="w-full px-4 py-2 text-left text-sm text-red-600 transition-colors hover:bg-gray-100 dark:text-red-400 dark:hover:bg-slate-700"
              @mousedown.prevent="handleSignOut"
            >
              {{ t('auth.signOut') }}
            </button>
            <!-- Sign out & clear data (trusted device) -->
            <button
              v-if="useSettingsStore().isTrustedDevice"
              type="button"
              class="w-full px-4 py-2 text-left text-sm text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-slate-700"
              @mousedown.prevent="handleSignOutAndClearData"
            >
              {{ t('auth.signOutClearData') }}
            </button>
          </div>
        </div>
      </div>
    </template>
  </header>
</template>
