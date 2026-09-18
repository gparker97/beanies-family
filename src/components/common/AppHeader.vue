<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import ProfileMenu from '@/components/common/ProfileMenu.vue';
import SignInCodeSheet from '@/components/auth/SignInCodeSheet.vue';
import { requireReauth } from '@/composables/useReauth';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import InfoHintBadge from '@/components/ui/InfoHintBadge.vue';
import HamburgerButton from '@/components/common/HamburgerButton.vue';
import { SAVE_STATUS_PRESENTATION } from '@/components/ui/saveStatusPresentation';
import SearchButton from '@/components/common/SearchButton.vue';
import NotificationsBell from '@/components/notifications/NotificationsBell.vue';
import { useBreakpoint } from '@/composables/useBreakpoint';
import { useMobileMenu } from '@/composables/useMobileMenu';
import { getMemberAvatarVariant } from '@/composables/useMemberAvatar';
import { getMemberAvatarUrl, markMemberAvatarError } from '@/composables/useMemberInfo';
import { usePrivacyMode } from '@/composables/usePrivacyMode';
import { useSounds } from '@/composables/useSounds';
import { getCurrencyInfo } from '@/constants/currencies';
import { LANGUAGES, getLanguageInfo } from '@/constants/languages';
import { useAuthStore } from '@/stores/authStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useSyncStore } from '@/stores/syncStore';
import { useTranslationStore } from '@/stores/translationStore';
import { resetAllAppStores } from '@/utils/resetStores';
import { useToday } from '@/composables/useToday';
import { useTranslation } from '@/composables/useTranslation';
import { useLanguageSwitcher } from '@/composables/useLanguageSwitcher';
import { showToast } from '@/composables/useToast';
import { presentRefreshOutcome } from '@/components/common/refreshOutcome';
import { formatDateFull } from '@/utils/date';
import { safeServiceWorkerUpdate } from '@/utils/safeServiceWorkerUpdate';
import { hardReload } from '@/utils/hardReload';
import type { UIStringKey } from '@/services/translation/uiStrings';
import type { CurrencyCode, LanguageCode } from '@/types/models';

// Menu open-state is the shared singleton (so the planner command bar can toggle
// the same menu); the hamburger here just calls toggle().
const { toggle: toggleMenu } = useMobileMenu();

const route = useRoute();
const router = useRouter();
const { isDesktop } = useBreakpoint();
const authStore = useAuthStore();
const familyStore = useFamilyStore();
const settingsStore = useSettingsStore();
const syncStore = useSyncStore();

// Collapsed-state save cue on the hamburger (degraded/critical only).
const saveNeedsAttention = computed(() => SAVE_STATUS_PRESENTATION[syncStore.saveStatus].attention);
const translationStore = useTranslationStore();
const { t } = useTranslation();
const { today, lastVisibleAt } = useToday();
const { switchLanguage } = useLanguageSwitcher();

// ── Page title / Dashboard greeting ──────────────────────────────────────
const isNookOrDashboard = computed(() => route.name === 'Dashboard' || route.name === 'Nook');
const memberName = computed(
  () =>
    familyStore.currentMember?.name || familyStore.owner?.name || t('header.greetingFallbackName')
);

// Greeting + date both depend on the current wall-clock day. They reference
// `today` (and `lastVisibleAt` for sub-day hour transitions) so Vue tracks
// them as reactive deps — `useToday` advances both on tab wake, midnight
// roll, and bfcache restore, which forces these to recompute. Without the
// refs, the computeds evaluate once on mount and the header sticks on
// yesterday after a desktop sleep / multi-hour idle. (Reported 2026-05-04.)
const greeting = computed(() => {
  void today.value;
  void lastVisibleAt.value;
  const hour = new Date().getHours();
  if (hour < 12) return `${t('greeting.morning')} ${memberName.value}`;
  if (hour < 18) return `${t('greeting.afternoon')} ${memberName.value}`;
  return `${t('greeting.evening')} ${memberName.value}`;
});

const todayFormatted = computed(() => {
  return formatDateFull(today.value);
});

const pageTitle = computed(() => {
  const titleKey = route.meta?.titleKey as UIStringKey | undefined;
  return titleKey ? t(titleKey) : '';
});

const { isUnlocked, toggle: togglePrivacy } = usePrivacyMode();
const { playBlink } = useSounds();
const currentMember = computed(() => familyStore.currentMember);
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

function selectLanguage(code: LanguageCode) {
  showLanguageDropdown.value = false;
  // Fire-and-forget via the composable. DO NOT add `await` back — see
  // docs/plans/2026-04-30-language-switcher-freeze.md.
  switchLanguage(code);
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

/**
 * ⚠️ MOUNTED ONCE, HERE — never inside `ProfileMenu`.
 *
 * ProfileMenu renders twice (the mobile header row and the desktop one). Hosting the sheet
 * inside it would create TWO sheet instances with independent mint state, so a code minted
 * from one could be replaced by the other's idle state, and closing one would leave the
 * other mounted. One opener, one instance.
 */
const showSignInCodeSheet = ref(false);

async function openSignInCodeSheet() {
  showProfileDropdown.value = false;
  // ⚠️ PIN FIRST, THEN THE SHEET — two taps to a PIN pad, not four.
  //
  // This used to open an explanatory sheet whose only content was a sentence and a button
  // that opened the gate. The gate now carries the sentence itself, so the sheet exists
  // only to show the code. That also removes an ordering hazard: the PIN is proven before
  // the minting component exists at all, so there is no path where a code minted during a
  // gated open can surface in a later un-gated one.
  const proved = await requireReauth({
    titleKey: 'signInCode.title',
    reasonKey: 'signInCode.pinReason',
  });
  if (!proved) return;
  showSignInCodeSheet.value = true;
}

function closeProfileDropdown() {
  showProfileDropdown.value = false;
}

const isRefreshing = ref(false);

async function handleRefreshAll() {
  showProfileDropdown.value = false;
  if (isRefreshing.value) return;
  isRefreshing.value = true;

  try {
    // Check for app updates (SW). If `update()` finds a new build, the SW
    // installs it as a waiting worker — surface that to the user with a
    // "Reload now" action instead of leaving them on stale code.
    let newVersionWaiting = false;
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        safeServiceWorkerUpdate(registration, 'refresh-all');
        newVersionWaiting = !!registration.waiting;
      }
    }

    // Refresh data from Drive. The store classifies the outcome and owns the
    // telemetry + every recovery surface (MVO); here we only say what happened.
    // A failed refresh never reports success, and an in-flight tap reports
    // nothing rather than a false "refreshed".
    if (syncStore.isConfigured && !syncStore.needsPermission) {
      const outcome = await syncStore.backgroundSyncFromFile(undefined, { manual: true });
      const { toast } = presentRefreshOutcome(outcome);
      if (toast) showToast(toast.type, t(toast.key));
    } else {
      showToast('info', t('header.refreshNoSync'));
    }

    // Offer the user the reload they came here for. Stacked after the
    // data-refresh toast so both signals are visible.
    if (newVersionWaiting) {
      showToast('info', t('header.newVersionReady'), undefined, {
        actionLabel: t('header.reloadNow'),
        actionFn: () => hardReload(),
        durationMs: 8000,
      });
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

async function confirmSwitchMember() {
  showProfileDropdown.value = false;
  showSignOutModal.value = false;
  // Tier 1: member-only — the pod stays open, no store resets, no Google anything.
  authStore.switchMember();
  router.replace('/login');
}

// Sign-out takes a few seconds (bounded force-save + Google/session teardown).
// The modal STAYS OPEN as the progress surface — closing it immediately left a
// frozen-looking app until the welcome gate flashed in (greg's field report).
const isSigningOut = ref(false);

async function confirmSignOut() {
  if (isSigningOut.value) return;
  isSigningOut.value = true;
  try {
    await authStore.signOut();
    resetAllAppStores();
    await router.replace('/login');
  } finally {
    isSigningOut.value = false;
    showSignOutModal.value = false;
  }
}

async function confirmSignOutAndClearData() {
  if (isSigningOut.value) return;
  isSigningOut.value = true;
  try {
    await authStore.signOutAndClearData();
    resetAllAppStores();
    await router.replace('/login');
  } finally {
    isSigningOut.value = false;
    showSignOutModal.value = false;
  }
}
</script>

<template>
  <header class="flex h-16 items-center justify-between bg-transparent px-4 md:px-6">
    <!-- ═══ MOBILE / TABLET HEADER ═══ -->
    <template v-if="!isDesktop">
      <!-- Left: Hamburger -->
      <HamburgerButton :alert="saveNeedsAttention" @click="toggleMenu" />

      <!-- Center: Greeting or page title (truncated) -->
      <div class="mx-3 min-w-0 flex-1 text-center">
        <h1 class="font-outfit text-secondary-500 dark:text-ink truncate text-base font-bold">
          {{ isNookOrDashboard ? greeting : pageTitle }}
        </h1>
      </div>

      <!-- Right: Notifications + Search + Profile avatar -->
      <!-- Privacy toggle intentionally omitted on mobile — reclaims ~48px of
           greeting space and is still available in the hamburger drawer
           (MobileHamburgerMenu.vue) where most settings-style controls live. -->
      <div class="flex items-center gap-2">
        <!-- Notification bell -->
        <NotificationsBell />

        <!-- Search -->
        <SearchButton />

        <!-- Profile avatar dropdown -->
        <div class="relative">
          <button
            v-if="currentMember || authStore.isAuthenticated"
            type="button"
            class="dark:bg-surface-raised flex h-10 w-10 cursor-pointer items-center justify-center rounded-[14px] bg-white shadow-[0_2px_8px_rgba(44,62,80,0.06)] transition-colors dark:shadow-none"
            :aria-label="t('header.accountMenu')"
            :aria-expanded="showProfileDropdown"
            @click="showProfileDropdown = !showProfileDropdown"
            @blur="closeProfileDropdown"
          >
            <BeanieAvatar
              :variant="currentMember ? getMemberAvatarVariant(currentMember) : 'adult-other'"
              :color="currentMember?.color || '#3b82f6'"
              :photo-url="currentMember ? getMemberAvatarUrl(currentMember) : null"
              size="sm"
              :aria-label="currentMember?.name || t('header.profileAvatar')"
              data-testid="header-avatar-mobile"
              @photo-error="currentMember && markMemberAvatarError(currentMember)"
            />
          </button>

          <!-- Profile dropdown menu (shared styling) -->
          <ProfileMenu
            v-if="showProfileDropdown"
            :is-refreshing="isRefreshing"
            @close="closeProfileDropdown"
            @refresh-all="handleRefreshAll"
            @switch-member="confirmSwitchMember"
            @sign-out="promptSignOut"
            @sign-in-device="openSignInCodeSheet"
          />
        </div>
      </div>
    </template>

    <!-- ═══ DESKTOP HEADER ═══ -->
    <template v-else>
      <!-- Left side - Page title (or greeting on Nook/Dashboard) + today's date -->
      <div class="min-w-0">
        <h1 class="font-outfit text-secondary-500 dark:text-ink truncate text-lg font-bold">
          {{ isNookOrDashboard ? greeting : pageTitle }}
        </h1>
        <p class="font-outfit text-primary-500 dark:text-accent-lift text-xs font-medium">
          {{ todayFormatted }}
        </p>
      </div>

      <!-- Right side - v4 pill/squircle controls -->
      <div class="flex items-center gap-2">
        <!-- Currency selector -->
        <!-- Multi-chip mode: 2+ effective currencies -->
        <div
          v-if="hasMultipleCurrencies"
          class="dark:bg-surface-raised flex h-10 items-center gap-0.5 rounded-[14px] bg-white px-1.5 shadow-[0_2px_8px_rgba(44,62,80,0.06)] dark:shadow-none"
        >
          <button
            v-for="chip in currencyChips"
            :key="chip.code"
            type="button"
            class="font-outfit cursor-pointer rounded-full px-2.5 py-1 text-xs font-semibold transition-all"
            :class="
              chip.active
                ? 'bg-primary-500 text-white shadow-[0_2px_8px_rgba(241,93,34,0.2)]'
                : 'text-secondary-500/50 hover:text-secondary-500/70 dark:text-ink-faint dark:hover:text-ink-soft'
            "
            @click="selectCurrencyChip(chip.code)"
          >
            <span class="dark:text-success-lift text-[#27AE60]">{{ chip.symbol }}</span>
            {{ chip.code }}
          </button>
        </div>

        <!-- Single-currency fallback mode: pill with chevron + dropdown -->
        <div v-else class="relative">
          <button
            type="button"
            class="font-outfit dark:bg-surface-raised dark:text-ink-soft flex h-10 items-center gap-1.5 rounded-[14px] bg-white px-3 text-sm font-semibold text-gray-700 shadow-[0_2px_8px_rgba(44,62,80,0.06)] transition-colors dark:shadow-none"
            @click="showCurrencyDropdown = !showCurrencyDropdown"
            @blur="closeCurrencyDropdown"
          >
            <span class="dark:text-success-lift text-[#27AE60]">{{
              currentCurrencyInfo?.symbol || settingsStore.displayCurrency
            }}</span>
            {{ settingsStore.displayCurrency }}
            <span class="text-secondary-500/30 dark:text-ink-faint text-[0.5rem]">▼</span>
          </button>

          <!-- Dropdown menu -->
          <div
            v-if="showCurrencyDropdown"
            class="dark:border-line dark:bg-surface-raised absolute right-0 z-50 mt-1 max-h-64 w-48 overflow-y-auto rounded-2xl border border-gray-200 bg-white py-1 shadow-lg"
          >
            <button
              v-for="chip in currencyChips"
              :key="chip.code"
              type="button"
              class="dark:hover:bg-surface-hover w-full px-3 py-2 text-left text-sm transition-colors hover:bg-gray-100"
              :class="
                chip.active
                  ? 'bg-primary-50 text-primary-600 dark:bg-primary-900/20 dark:text-accent-lift'
                  : 'dark:text-ink-soft text-gray-700'
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
            class="dark:bg-surface-raised flex h-10 items-center gap-1 rounded-[14px] bg-white px-2 shadow-[0_2px_8px_rgba(44,62,80,0.06)] transition-all hover:shadow-[0_4px_12px_rgba(44,62,80,0.1)] dark:shadow-none"
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
            <span v-else class="text-[1.625rem] leading-none">
              {{ currentLanguageInfo?.flag || '🌐' }}
            </span>
            <span class="text-secondary-500/30 dark:text-ink-faint text-[0.5rem]">▼</span>
          </button>

          <!-- Language dropdown -->
          <div
            v-if="showLanguageDropdown"
            class="dark:border-line dark:bg-surface-raised absolute right-0 z-50 mt-1 w-52 overflow-hidden rounded-2xl border border-gray-200 bg-white py-1.5 shadow-lg"
          >
            <button
              v-for="lang in LANGUAGES"
              :key="lang.code"
              type="button"
              class="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-all"
              :class="
                lang.code === settingsStore.language
                  ? 'bg-primary-500/10 dark:bg-primary-500/20'
                  : 'dark:hover:bg-surface-hover hover:bg-gray-50'
              "
              @mousedown.prevent="selectLanguage(lang.code)"
            >
              <span
                class="flex h-9 w-9 items-center justify-center overflow-hidden rounded-[10px]"
                :class="
                  lang.code === settingsStore.language
                    ? 'bg-primary-500/15 shadow-[0_2px_6px_rgba(241,93,34,0.15)]'
                    : 'dark:bg-surface-hover bg-gray-100'
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
                    : 'dark:text-ink-soft text-gray-500'
                "
              >
                {{ lang.nativeName }}
              </span>
            </button>
          </div>
        </div>

        <!-- Notification bell -->
        <NotificationsBell />

        <!-- Privacy mode toggle (white-bg squircle) -->
        <button
          type="button"
          class="dark:bg-surface-raised relative flex h-10 w-10 cursor-pointer items-center justify-center rounded-[14px] bg-white shadow-[0_2px_8px_rgba(44,62,80,0.06)] transition-colors dark:shadow-none"
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
        <SearchButton />

        <!-- Profile dropdown (avatar + chevron) -->
        <div class="relative">
          <button
            v-if="currentMember || authStore.isAuthenticated"
            class="flex items-center gap-1 rounded-[14px] py-1 pr-1 pl-1 transition-colors hover:bg-gray-100 dark:hover:bg-white/[0.08]"
            :aria-label="t('header.accountMenu')"
            :aria-expanded="showProfileDropdown"
            @click="showProfileDropdown = !showProfileDropdown"
            @blur="closeProfileDropdown"
          >
            <BeanieAvatar
              :variant="currentMember ? getMemberAvatarVariant(currentMember) : 'adult-other'"
              :color="currentMember?.color || '#3b82f6'"
              :photo-url="currentMember ? getMemberAvatarUrl(currentMember) : null"
              size="sm"
              :aria-label="currentMember?.name || t('header.profileAvatar')"
              data-testid="header-avatar"
              @photo-error="currentMember && markMemberAvatarError(currentMember)"
            />
            <BeanieIcon name="chevron-down" size="xs" class="text-gray-400" />
          </button>

          <!-- Profile dropdown menu -->
          <ProfileMenu
            v-if="showProfileDropdown"
            :is-refreshing="isRefreshing"
            @close="closeProfileDropdown"
            @refresh-all="handleRefreshAll"
            @switch-member="confirmSwitchMember"
            @sign-out="promptSignOut"
            @sign-in-device="openSignInCodeSheet"
          />
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
        @close="isSigningOut ? undefined : (showSignOutModal = false)"
      >
        <div class="flex flex-col items-center gap-4 text-center">
          <!-- Icon -->
          <div
            class="dark:text-danger-lift flex h-12 w-12 items-center justify-center rounded-2xl bg-red-100 text-red-500 dark:bg-red-900/30"
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

          <p class="dark:text-ink-soft text-sm text-gray-600">
            {{ t('auth.signOutConfirmMessage') }}
          </p>
          <p class="dark:text-ink-faint text-xs text-gray-400">
            {{ t('auth.signOutConfirmHint') }}
          </p>
        </div>

        <template #footer>
          <div class="flex flex-col gap-3">
            <!-- The standard action, full-width and unambiguous -->
            <BaseButton
              variant="danger"
              size="sm"
              class="!h-auto !w-full"
              :loading="isSigningOut"
              :disabled="isSigningOut"
              @click="confirmSignOut"
            >
              <template #default>
                <span class="flex items-center justify-center gap-1.5">
                  🚪 {{ isSigningOut ? t('auth.signingOut') : t('auth.signOut') }}
                </span>
              </template>
            </BaseButton>
            <!-- Clear-data: deliberately quiet — only for shared devices / emergencies -->
            <button
              type="button"
              class="dark:text-danger-lift/80 dark:hover:text-danger-lift mx-auto text-xs font-medium text-red-400 underline-offset-2 hover:text-red-500 hover:underline disabled:opacity-50"
              :disabled="isSigningOut"
              @click="confirmSignOutAndClearData"
            >
              🗑️ {{ t('auth.signOutClearData') }}
            </button>
            <div class="flex justify-end">
              <span class="flex items-center gap-1">
                <span class="dark:text-ink-faint text-[0.625rem] text-gray-400">
                  {{ t('common.whatsThis') }}
                </span>
                <InfoHintBadge :text="t('auth.signOutClearDataHint')" />
              </span>
            </div>

            <!-- Cancel -->
            <button
              v-if="!isSigningOut"
              type="button"
              class="font-outfit dark:text-ink-faint dark:hover:text-ink-soft mx-auto text-xs font-medium text-gray-400 hover:text-gray-600"
              @click="showSignOutModal = false"
            >
              {{ t('action.cancel') }}
            </button>
          </div>
        </template>
      </BaseModal>

      <!--
        One instance, mounted beside the sign-out modal rather than inside `ProfileMenu`
        (which renders twice). See `openSignInCodeSheet` for why that matters.
      -->
      <SignInCodeSheet :open="showSignInCodeSheet" @close="showSignInCodeSheet = false" />
    </Teleport>
  </header>
</template>
