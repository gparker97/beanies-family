<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue';
import CelebrationShower from '@/components/ui/CelebrationShower.vue';
import { useCelebration } from '@/composables/useCelebration';
import { useTranslation } from '@/composables/useTranslation';

const { t } = useTranslation();
const { toasts, activeModal, mode, dismissModal } = useCelebration();

/**
 * Undo is an EDIT. On a locked shared screen a child must not be able to
 * un-complete a sibling's chore, so the surface's mode governs the button —
 * the same control the shower uses.
 */
const modalAllowsUndo = computed(() => mode.value.allowUndo);

/**
 * A modal celebration must never camp on an unattended screen. When a surface
 * asks for auto-dismiss, arm it per-celebration (never on mount — this overlay
 * mounts once at boot and never unmounts).
 */
let modalTimer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => activeModal.value?.id,
  (id) => {
    if (modalTimer) clearTimeout(modalTimer);
    modalTimer = undefined;
    const ms = mode.value.autoDismissMs;
    if (id === undefined || ms === null) return;
    modalTimer = setTimeout(() => {
      if (activeModal.value?.id === id) dismissModal();
    }, ms);
  },
  { immediate: true }
);
onBeforeUnmount(() => {
  if (modalTimer) clearTimeout(modalTimer);
});
</script>

<template>
  <!-- Full-list completion: non-blocking, self-dismissing (see CelebrationShower). -->
  <CelebrationShower />

  <Teleport to="body">
    <!-- Modal celebration -->
    <Transition
      enter-active-class="transition-all duration-300"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-all duration-200"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="activeModal"
        class="fixed inset-0 z-[200] flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
      >
        <div class="absolute inset-0 bg-black/40" @click="dismissModal" />
        <Transition
          enter-active-class="transition-all duration-300"
          enter-from-class="opacity-0 scale-90"
          enter-to-class="opacity-100 scale-100"
        >
          <div
            v-if="activeModal"
            class="dark:bg-surface-raised relative w-full max-w-sm rounded-3xl bg-white px-8 py-10 text-center shadow-2xl"
          >
            <img
              :src="activeModal.asset"
              :alt="activeModal.message"
              class="mx-auto mb-6 w-full max-w-xs object-contain"
            />
            <p class="font-outfit text-secondary-500 dark:text-ink text-xl font-bold">
              {{ activeModal.message }}
            </p>
            <button
              class="bg-primary-500 hover:bg-primary-600 mt-6 rounded-2xl px-8 py-2.5 font-medium text-white transition-colors"
              @click="dismissModal"
            >
              {{ t('celebration.letsGo') }}
            </button>
            <button
              v-if="activeModal.onUndo && modalAllowsUndo"
              type="button"
              class="font-outfit dark:text-ink-faint mt-3 block w-full text-xs font-medium text-gray-400 transition-colors hover:text-[var(--heritage-orange)]"
              @click="
                activeModal.onUndo?.();
                dismissModal();
              "
            >
              {{ t('celebration.madeMistakeUndo') }}
            </button>
          </div>
        </Transition>
      </div>
    </Transition>

    <!-- Toast notifications - bottom center, bounce-in -->
    <div
      class="fixed bottom-6 left-1/2 z-[200] flex -translate-x-1/2 flex-col items-center gap-2"
      style="pointer-events: none"
    >
      <TransitionGroup
        enter-active-class="animate-beanie-spring-in"
        leave-active-class="transition-all duration-300"
        leave-from-class="opacity-100 translate-y-0 scale-100"
        leave-to-class="opacity-0 translate-y-4 scale-95"
      >
        <div
          v-for="toast in toasts"
          :key="toast.id"
          class="dark:bg-surface-raised flex items-center gap-4 rounded-2xl bg-white px-5 py-4 shadow-lg"
          style="pointer-events: auto"
        >
          <img :src="toast.asset" :alt="toast.message" class="h-20 w-20 object-contain" />
          <p class="text-secondary-500 dark:text-ink font-medium">{{ toast.message }}</p>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
