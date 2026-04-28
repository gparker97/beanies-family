<script setup lang="ts">
import { computed, toRef } from 'vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import { useBreakpoint } from '@/composables/useBreakpoint';
import { useFullscreenOverlay } from '@/composables/useFullscreenOverlay';

interface Props {
  open: boolean;
  title?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
  closable?: boolean;
  fullscreenMobile?: boolean;
  /** z-index layer: 'base' (z-50) for normal modals, 'overlay' (z-[60]) for modals that stack on top of other modals, 'top' (z-[250]) for modals that must overlay fixed chrome like PublicNav (z-index: 200) */
  layer?: 'base' | 'overlay' | 'top';
  /** When true, the header slot renders edge-to-edge without padding or border */
  customHeader?: boolean;
  /**
   * When true, the body slot renders edge-to-edge with no padding and no
   * scroll — use for fullscreen media viewers that want the content to
   * reach the modal's border box. The default `p-6 overflow-y-auto` is
   * intended for form drawers; a photo lightbox wants neither.
   */
  flushBody?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  size: 'md',
  closable: true,
  fullscreenMobile: false,
  layer: 'base',
  customHeader: false,
  flushBody: false,
});

const layerClass = computed(() => {
  if (props.layer === 'top') return 'z-[250]';
  if (props.layer === 'overlay') return 'z-[60]';
  return 'z-50';
});

const { isMobile } = useBreakpoint();
const isFullscreen = computed(() => props.fullscreenMobile && isMobile.value);

const emit = defineEmits<{
  close: [];
}>();

const sizeClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
};

function close() {
  if (props.closable) {
    emit('close');
  }
}

useFullscreenOverlay(toRef(props, 'open'), close);
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
      <div
        v-if="open"
        class="fixed inset-0 flex items-center justify-center p-4"
        :class="layerClass"
      >
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/50" @click="close" />

        <!-- Modal content -->
        <Transition
          enter-active-class="transition-all duration-200"
          enter-from-class="opacity-0 scale-95"
          enter-to-class="opacity-100 scale-100"
          leave-active-class="transition-all duration-200"
          leave-from-class="opacity-100 scale-100"
          leave-to-class="opacity-0 scale-95"
        >
          <div
            v-if="open"
            role="dialog"
            aria-modal="true"
            class="relative flex w-full flex-col overflow-hidden bg-white shadow-xl dark:bg-slate-800"
            :class="
              isFullscreen
                ? 'h-full max-h-full rounded-none'
                : ['max-h-[calc(100vh-2rem)] rounded-3xl', sizeClasses[size]]
            "
            @click.stop
          >
            <!-- Header -->
            <div
              v-if="title || $slots.header"
              class="shrink-0"
              :class="
                customHeader
                  ? ''
                  : 'flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-slate-700'
              "
            >
              <slot name="header">
                <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {{ title }}
                </h2>
              </slot>

              <button
                v-if="closable && !customHeader"
                type="button"
                class="rounded-xl p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-slate-700 dark:hover:text-gray-300"
                @click="close"
              >
                <BeanieIcon name="close" size="md" />
              </button>
            </div>

            <!-- Body -->
            <div class="flex-1" :class="flushBody ? '' : 'overflow-y-auto p-6'">
              <slot />
            </div>

            <!-- Footer -->
            <div
              v-if="$slots.footer"
              class="shrink-0 rounded-b-3xl border-t border-gray-200 bg-gray-50 px-6 py-4 dark:border-slate-700 dark:bg-slate-900"
            >
              <slot name="footer" />
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>
