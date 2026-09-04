<script setup lang="ts">
import { computed, toRef } from 'vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import { useFullscreenOverlay } from '@/composables/useFullscreenOverlay';

interface Props {
  open: boolean;
  title?: string;
  side?: 'left' | 'right';
  size?: 'narrow' | 'medium' | 'wide' | 'full';
  closable?: boolean;
  /**
   * Stacking layer. 'base' (z-40) is a normal panel; 'overlay' (z-[60])
   * sits above another open drawer/modal — use it when this panel opens on
   * top of one (e.g. a list drawer launched from inside the activity drawer).
   */
  // 'top' (z-[250], matching BaseModal) is for a panel that must never be occluded by any
  // other surface. Accepted here so BeanieFormModal can forward one layer union to both of
  // its containers — a drawer that silently DOWNGRADED 'top' to 'overlay' would be the worse
  // failure, because the caller asking for 'top' has a reason.
  layer?: 'base' | 'overlay' | 'top';
}

const props = withDefaults(defineProps<Props>(), {
  side: 'right',
  size: 'narrow',
  closable: true,
  layer: 'base',
});

const sizeClasses: Record<string, string> = {
  narrow: 'max-w-md',
  medium: 'max-w-lg',
  wide: 'max-w-xl',
  full: 'max-w-3xl',
};

// Backdrop sits just under the panel; 'overlay' clears a base drawer (z-40)
// and a base modal (z-50) beneath it.
const backdropZ = computed(() =>
  props.layer === 'top' ? 'z-[245]' : props.layer === 'overlay' ? 'z-[55]' : 'z-40'
);
const panelZ = computed(() =>
  props.layer === 'top' ? 'z-[250]' : props.layer === 'overlay' ? 'z-[60]' : 'z-40'
);

const emit = defineEmits<{
  close: [];
}>();

function close() {
  if (props.closable) {
    emit('close');
  }
}

useFullscreenOverlay(toRef(props, 'open'), close);
</script>

<template>
  <Teleport to="body">
    <!-- Backdrop fade -->
    <Transition
      appear
      enter-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-200"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div v-if="open" class="fixed inset-0 bg-black/50" :class="backdropZ" @click="close" />
    </Transition>

    <!-- Panel slide -->
    <Transition
      appear
      enter-active-class="transition-transform duration-300 ease-out"
      :enter-from-class="side === 'right' ? 'translate-x-full' : '-translate-x-full'"
      enter-to-class="translate-x-0"
      leave-active-class="transition-transform duration-200 ease-in"
      leave-from-class="translate-x-0"
      :leave-to-class="side === 'right' ? 'translate-x-full' : '-translate-x-full'"
    >
      <div
        v-if="open"
        role="dialog"
        aria-modal="true"
        class="dark:bg-surface-raised fixed inset-y-0 flex w-full flex-col overflow-y-auto bg-white shadow-xl"
        :class="[panelZ, sizeClasses[size], side === 'right' ? 'right-0' : 'left-0']"
        :style="{
          // The panel is `inset-y-0` (full viewport height), so on native iOS its
          // header + close button and its footer would sit UNDER the status bar /
          // home indicator. Inset padding keeps both tappable. 0 on web/non-notched
          // (no-op). Mirrors the App.vue content-column + MobileBottomNav pattern.
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }"
      >
        <!-- Header -->
        <div
          v-if="title || $slots.header"
          class="dark:border-line flex shrink-0 items-center justify-between border-b border-gray-200 px-6 py-4"
        >
          <slot name="header">
            <h2 class="font-outfit text-secondary-500 dark:text-ink text-lg font-semibold">
              {{ title }}
            </h2>
          </slot>

          <button
            type="button"
            class="dark:hover:bg-surface-hover dark:hover:text-ink-soft rounded-xl p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            :disabled="!closable"
            :class="{ 'cursor-not-allowed opacity-50': !closable }"
            @click="close"
          >
            <BeanieIcon name="close" size="md" />
          </button>
        </div>

        <!-- Body -->
        <div class="flex-1 overflow-y-auto p-6">
          <slot />
        </div>

        <!-- Footer -->
        <div
          v-if="$slots.footer"
          class="dark:border-line dark:bg-surface-ground shrink-0 border-t border-gray-200 bg-gray-50 px-6 py-4"
        >
          <slot name="footer" />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
