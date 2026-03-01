<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { usePWA } from '@/composables/usePWA';
import { useTranslation } from '@/composables/useTranslation';

const { canInstall, isInstalled, isDismissed, installApp, dismissInstallPrompt } = usePWA();
const { t } = useTranslation();

const showPrompt = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;

onMounted(() => {
  // Show after 30 seconds if installable and not dismissed
  timer = setTimeout(() => {
    if (canInstall.value && !isInstalled.value && !isDismissed()) {
      showPrompt.value = true;
    }
  }, 30_000);
});

onUnmounted(() => {
  if (timer) clearTimeout(timer);
});

async function handleInstall() {
  const accepted = await installApp();
  if (accepted) showPrompt.value = false;
}

function handleDismiss() {
  dismissInstallPrompt();
  showPrompt.value = false;
}
</script>

<template>
  <Transition
    enter-active-class="transition-all duration-300 ease-out"
    enter-from-class="translate-y-full opacity-0"
    enter-to-class="translate-y-0 opacity-100"
    leave-active-class="transition-all duration-200 ease-in"
    leave-from-class="translate-y-0 opacity-100"
    leave-to-class="translate-y-full opacity-0"
  >
    <div
      v-if="showPrompt"
      class="w-[calc(100vw-2rem)] max-w-md rounded-xl border border-gray-200 bg-white p-4 shadow-lg md:w-auto dark:border-slate-700 dark:bg-slate-800"
      role="alert"
    >
      <div class="flex items-start gap-3">
        <img
          src="/brand/beanies_impact_bullet_transparent_192x192.png"
          alt=""
          class="h-10 w-10 flex-shrink-0"
        />
        <div class="min-w-0 flex-1">
          <p class="font-semibold text-gray-900 dark:text-gray-100">
            {{ t('pwa.installTitle') }}
          </p>
          <p class="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
            {{ t('pwa.installDescription') }}
          </p>
          <div class="mt-3 flex gap-2">
            <button
              class="bg-primary-500 hover:bg-primary-600 rounded-lg px-4 py-1.5 text-sm font-medium text-white transition-colors"
              @click="handleInstall"
            >
              {{ t('pwa.installButton') }}
            </button>
            <button
              class="rounded-lg px-3 py-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              @click="handleDismiss"
            >
              {{ t('pwa.installDismiss') }}
            </button>
          </div>
        </div>
        <button
          class="flex-shrink-0 text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300"
          aria-label="Close"
          @click="handleDismiss"
        >
          &#x2715;
        </button>
      </div>
    </div>
  </Transition>
</template>
