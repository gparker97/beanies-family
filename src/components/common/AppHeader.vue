<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import ProfileMenu from '@/components/common/ProfileMenu.vue';
import SignInCodeSheet from '@/components/auth/SignInCodeSheet.vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
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
import { useToday } from '@/composables/useToday';
import { useTranslation } from '@/composables/useTranslation';
import { useSignOut } from '@/composables/useSignOut';
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
/**
 * The only thing this header hands upward: a device-approval key the person just scanned
 * in-app. `App.vue` owns the delivery gate and the approval sheet.
 */

const showSignInCodeSheet = ref(false);

/**
 * "Scan a Code" — the in-app camera route into device approval.
 *
 * ⚠️ HOSTED HERE, NOT IN `ProfileMenu`. The menu is rendered twice (mobile and desktop), so
 * a picker owned by it would be two inputs with two independent states — the same
 * re-entrancy reason `SignInCodeSheet` is hosted here rather than there.
 *
 * The decoded key is emitted upward rather than written to a store: `App.vue` owns the
 * delivery gate, and putting this in a store would reintroduce the module-level state that
 * gate exists to avoid.
 */

function openSignInCodeSheet() {
  showProfileDropdown.value = false;
  // ⚠️ NO PIN GATE HERE ANY MORE. The sheet now offers two directions, and only one of them
  // (minting a code) hands over the family key. Gating the entry point would demand a PIN
  // from someone who only wants to SCAN a code, which gives away nothing — and `useReauth`'s
  // own docblock calls a routine action asking for a PIN a defect. The gate moved to
  // `SignInCodeSheet.showCode()`, immediately before the mint.
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

// The sign-out confirm, kit guard and progress overlay are shared with the mobile menu
// and rendered once by SignOutHost (2026-09-23); this only opens it.
const { requestSignOut } = useSignOut();

function promptSignOut() {
  showProfileDropdown.value = false;
  requestSignOut();
}

async function confirmSwitchMember() {
  showProfileDropdown.value = false;
  // Tier 1: member-only — the pod stays open, no store resets, no Google anything.
  authStore.switchMember();
  router.replace('/login');
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

    <Teleport to="body">
      <!--
        One instance, mounted here rather than inside `ProfileMenu` (which renders twice).
        See `openSignInCodeSheet` for why that matters.
      -->
      <SignInCodeSheet :open="showSignInCodeSheet" @close="showSignInCodeSheet = false" />
    </Teleport>
  </header>
</template>
