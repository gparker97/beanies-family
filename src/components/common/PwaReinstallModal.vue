<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import { useStalePwaNotice } from '@/composables/useStalePwaNotice';
import { useTranslation } from '@/composables/useTranslation';
import { MARKETING_URL } from '@/utils/marketing';
import { isIosOrIpadOs } from '@/services/sync/capabilities';
import { claimInterruption } from '@/composables/useSessionInterruption';

const { t } = useTranslation();
const { shouldShow, dismiss, trackInstallClicked } = useStalePwaNotice();

type Platform = 'ios' | 'android' | 'desktop';

const platform = computed<Platform>(() => {
  // iOS arm via the shared primitive (also catches iPadOS-13+ desktop-UA Safari,
  // which correctly shows the iOS install steps). Android/desktop stay inline.
  if (isIosOrIpadOs()) return 'ios';
  if (typeof navigator !== 'undefined' && /Android/.test(navigator.userAgent)) return 'android';
  return 'desktop';
});

// Pure eligibility: stale-pwa notice active AND not an E2E run (the same
// `e2e_auto_auth` guard the notifications auto-open uses — see useNotifications).
const eligible = computed(() => {
  if (!shouldShow.value) return false;
  try {
    if (sessionStorage.getItem('e2e_auto_auth')) return false;
  } catch {
    /* sessionStorage unavailable */
  }
  return true;
});

// #45: one-shot show flag. A `claimInterruption` is a side effect, so it must NOT
// live in a (pure) computed — drive a ref from a watcher that claims once at the
// true show-site. Dismiss closes it; if another surface won this load, we defer.
const showModal = ref(false);
watch(
  eligible,
  (isEligible) => {
    if (isEligible && !showModal.value && claimInterruption('pwa-reinstall')) {
      showModal.value = true;
    }
  },
  { immediate: true }
);

function handleDismiss(): void {
  showModal.value = false;
  dismiss();
}

const guideUrl = `${MARKETING_URL}/help/getting-started/install-as-app`;

const steps = computed<string[]>(() => {
  if (platform.value === 'ios') {
    return [
      t('pwaReinstall.iosStep1'),
      t('pwaReinstall.iosStep2'),
      t('pwaReinstall.iosStep3'),
      t('pwaReinstall.iosStep4'),
    ];
  }
  if (platform.value === 'android') {
    return [
      t('pwaReinstall.androidStep1'),
      t('pwaReinstall.androidStep2'),
      t('pwaReinstall.androidStep3'),
      t('pwaReinstall.androidStep4'),
    ];
  }
  return [
    t('pwaReinstall.desktopStep1'),
    t('pwaReinstall.desktopStep2'),
    t('pwaReinstall.desktopStep3'),
    t('pwaReinstall.desktopStep4'),
  ];
});

const screenshot = computed<string | null>(() => {
  if (platform.value === 'ios') return '/help/pwa-install/install-app-iphone-share.jpg';
  if (platform.value === 'android') return '/help/pwa-install/install-app-android-3-dot-menu.jpg';
  return null;
});
</script>

<template>
  <BaseModal
    :open="showModal"
    size="lg"
    layer="top"
    fullscreen-mobile
    custom-header
    @close="handleDismiss"
  >
    <!-- Custom header: gradient strip + title -->
    <template #header>
      <div>
        <div class="pwa-strip" />
        <div class="flex items-center justify-between px-7 pt-5 pb-0">
          <div class="flex items-center gap-2.5">
            <div
              class="flex h-9 w-9 items-center justify-center rounded-xl bg-[rgba(241,93,34,0.08)]"
            >
              <span class="text-lg">📲</span>
            </div>
            <h2 class="font-outfit text-secondary-500 text-lg font-semibold dark:text-gray-100">
              {{ t('pwaReinstall.title') }}
            </h2>
          </div>
          <button
            class="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[rgba(44,62,80,0.05)] text-gray-400 transition-all hover:bg-[rgba(44,62,80,0.1)] dark:bg-white/5 dark:text-gray-500 dark:hover:bg-white/10"
            @click="handleDismiss"
          >
            ✕
          </button>
        </div>
      </div>
    </template>

    <!-- Body -->
    <div class="-mx-6 -mt-6 -mb-6 px-7 py-6">
      <!-- Reassurance banner -->
      <div class="pwa-reassure mb-4">
        <div class="font-outfit text-secondary-500 mb-1 text-sm font-semibold dark:text-gray-100">
          🫘 {{ t('pwaReinstall.reassuranceTitle') }}
        </div>
        <div class="text-secondary-500/75 text-[0.8125rem] leading-relaxed dark:text-gray-300/80">
          {{ t('pwaReinstall.reassurance') }}
        </div>
      </div>

      <!-- Context -->
      <div
        class="text-secondary-500/75 mb-5 text-[0.8125rem] leading-relaxed dark:text-gray-300/80"
      >
        {{ t('pwaReinstall.context') }}
      </div>

      <!-- Steps heading -->
      <div
        class="font-outfit text-secondary-500 mb-3 text-xs font-semibold tracking-[0.06em] uppercase dark:text-gray-300"
      >
        {{ t('pwaReinstall.stepsHeading') }}
      </div>

      <!-- Steps list -->
      <ol class="mb-4 flex flex-col gap-2.5">
        <li
          v-for="(step, i) in steps"
          :key="i"
          class="flex items-start gap-3 text-[0.8125rem] leading-relaxed"
        >
          <span
            class="bg-primary-500 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
          >
            {{ i + 1 }}
          </span>
          <span class="text-secondary-500/85 dark:text-gray-200/90" v-html="step" />
        </li>
      </ol>

      <!-- Screenshot (mobile platforms only) -->
      <img
        v-if="screenshot"
        :src="screenshot"
        :alt="t('pwaReinstall.screenshotAlt')"
        class="mb-4 w-full rounded-xl shadow-md"
        loading="lazy"
      />

      <!-- One-time-promise footer note -->
      <div class="text-secondary-500/45 mt-3 text-center text-xs italic dark:text-gray-400/50">
        {{ t('pwaReinstall.oneTimeNote') }}
      </div>
    </div>

    <!-- Footer -->
    <template #footer>
      <div class="flex flex-col items-center gap-3">
        <button
          class="from-primary-500 to-terracotta-400 font-outfit w-full rounded-2xl bg-gradient-to-br px-6 py-3.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(241,93,34,0.25)] transition-all hover:-translate-y-px hover:shadow-[0_6px_24px_rgba(241,93,34,0.35)]"
          @click="handleDismiss"
        >
          {{ t('pwaReinstall.dismiss') }}
        </button>
        <a
          :href="guideUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="hover:text-primary-500 dark:hover:text-primary-400 text-[0.8125rem] text-gray-400/60 transition-all dark:text-gray-500/50"
          @click="trackInstallClicked"
        >
          {{ t('pwaReinstall.seeFullGuide') }}
        </a>
      </div>
    </template>
  </BaseModal>
</template>

<style scoped>
.pwa-strip {
  background: linear-gradient(90deg, var(--heritage-orange, #f15d22), var(--terracotta, #e67e22));
  height: 3px;
}

.pwa-reassure {
  background: var(--cloud-white, #f8f9fa);
  border-left: 3px solid var(--heritage-orange, #f15d22);
  border-radius: 12px;
  padding: 12px 14px;
}

:global(.dark) .pwa-reassure {
  background: rgb(255 255 255 / 4%);
}
</style>
