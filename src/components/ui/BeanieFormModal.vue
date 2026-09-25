<script setup lang="ts">
import ModalIconTitle from '@/components/ui/ModalIconTitle.vue';
import { computed } from 'vue';
import BaseModal from './BaseModal.vue';
import BaseSidePanel from './BaseSidePanel.vue';
import { useTranslation } from '@/composables/useTranslation';

interface Props {
  open: boolean;
  title: string;
  icon?: string;
  iconBg?: string;
  /** Icon-box foreground, for slotted `currentColor` artwork. */
  iconColor?: string;
  size?: 'default' | 'narrow' | 'wide' | 'full';
  saveLabel?: string;
  saveGradient?: 'orange' | 'purple' | 'teal';
  /**
   * The VALIDATION state. `false` draws Save "not ready" (neutral, no gradient) while it stays
   * tappable and still emits `save`, so `useFormValidation` can mark and scroll to what is
   * missing. Bind it to `v.canSave.value`.
   */
  saveReady?: boolean;
  /**
   * A real `disabled`: the action is genuinely UNAVAILABLE (nothing to save yet, a read in
   * progress). Never use it for missing input — a disabled button swallows the tap, so nothing
   * can tell the person what is missing. Use `saveReady` for that.
   */
  saveDisabled?: boolean;
  isSubmitting?: boolean;
  /** Label shown beside the spinner while submitting. Defaults to `common.saving`. */
  submittingLabel?: string;
  showDelete?: boolean;
  /**
   * Extra classes for the body element — for a caller that needs to mark the
   * whole body rather than its content, such as `is-celebration`, whose
   * `isolation: isolate` has to sit on the same box as the layer it contains.
   */
  bodyClass?: string;
  /**
   * Render the `#custom-header` slot edge-to-edge, with no padding and no rule beneath it.
   *
   * ⚠️ Works for BOTH variants. It was modal-only, and silently did nothing on a drawer — a
   * caller could pass it, see no effect, and have no way to tell that from a styling mistake.
   * `BaseSidePanel` now honours it on the same terms `BaseModal` does.
   */
  customHeader?: boolean;
  /** Render as a centered modal or a right-side drawer. */
  variant?: 'modal' | 'drawer';
  /**
   * Stacking layer, forwarded to the underlying container. 'overlay' makes
   * this modal/drawer sit above another open one (e.g. a list drawer opened
   * from inside the activity drawer). Defaults to 'base'.
   */
  // 'top' is for a surface that must clear fixed chrome and ordinary modals. 'gate' is one
  // step above it, reserved for the ADR-030 consent prompt, which must also clear a 'top'
  // surface that OPENS it — a permission prompt the user cannot see is a security-UX failure,
  // not a stacking nit. Forwarded straight through; BaseModal owns the z-values.
  layer?: 'base' | 'overlay' | 'top' | 'gate';
}

const props = withDefaults(defineProps<Props>(), {
  icon: undefined,
  iconBg: undefined,
  iconColor: undefined,
  size: 'default',
  saveLabel: undefined,
  saveGradient: 'orange',
  saveReady: true,
  saveDisabled: false,
  isSubmitting: false,
  submittingLabel: undefined,
  showDelete: false,
  customHeader: false,
  variant: 'modal',
  layer: 'base',
});

const emit = defineEmits<{
  close: [];
  save: [];
  delete: [];
}>();

const { t } = useTranslation();

const containerComponent = computed(() => (props.variant === 'drawer' ? BaseSidePanel : BaseModal));

const SAVE_GRADIENTS: Record<NonNullable<Props['saveGradient']>, string> = {
  orange:
    'from-primary-500 to-terracotta-400 hover:from-primary-600 hover:to-terracotta-500 bg-gradient-to-r',
  purple:
    'bg-gradient-to-r from-purple-500 to-purple-400 hover:from-purple-600 hover:to-purple-500',
  teal: 'bg-gradient-to-r from-[#00B4D8] to-[#0096B7] hover:from-[#0096B7] hover:to-[#007A96]',
};

/**
 * Everything that differs between ready and not-ready lives here, INCLUDING the white ink and
 * the shadows: Tailwind resolves conflicting utilities by stylesheet order, not class order, so
 * a static `text-white` or `hover:shadow-md` would leak into the not-ready look.
 */
const saveClasses = computed(() =>
  props.saveReady
    ? `text-white shadow-sm hover:shadow-md ${SAVE_GRADIENTS[props.saveGradient]}`
    : 'dark:bg-surface-overlay dark:text-ink-soft text-secondary-500 bg-[var(--tint-slate-10)] shadow-none'
);

type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
type DrawerSize = 'narrow' | 'medium' | 'wide' | 'full';

const modalSizeMap: Record<string, ModalSize> = {
  narrow: 'lg',
  default: 'xl',
  wide: '2xl',
};

const drawerSizeMap: Record<string, DrawerSize> = {
  narrow: 'narrow',
  default: 'medium',
  wide: 'wide',
  full: 'full',
};

const containerProps = computed(() => {
  if (props.variant === 'drawer') {
    return {
      open: props.open,
      size: drawerSizeMap[props.size] ?? ('medium' as DrawerSize),
      closable: !props.isSubmitting,
      customHeader: props.customHeader,
      layer: props.layer,
    };
  }
  return {
    open: props.open,
    size: modalSizeMap[props.size] ?? ('xl' as ModalSize),
    closable: !props.isSubmitting,
    fullscreenMobile: true,
    customHeader: props.customHeader,
    layer: props.layer,
  };
});
</script>

<template>
  <component :is="containerComponent" v-bind="containerProps" @close="emit('close')">
    <template #header>
      <slot v-if="customHeader" name="custom-header" />
      <ModalIconTitle v-else :icon="icon" :icon-bg="iconBg" :icon-color="iconColor">
        <template v-if="$slots.icon" #icon><slot name="icon" /></template>
        <!-- Additive `title-content` slot lets a caller supply an inline-editable title
             (e.g. ListDetailModal); the fallback is the static title. -->
        <slot name="title-content">{{ title }}</slot>
      </ModalIconTitle>
    </template>

    <!--
      Body: Cloud White bg, scrollable.

      A DRAWER's body stretches to fill its panel. A drawer is full-height by
      definition, so a short body left everything below it belonging to the
      panel rather than the body — which is invisible until something paints the
      body, at which point (a celebration's confetti, say) the paint stops where
      the content does and the rest of a tall drawer sits empty. A modal is
      auto-height, so `min-h-full` there resolves to the content height and
      changes nothing.
    -->
    <div
      class="dark:bg-surface-raised/50 relative -mx-6 -my-6 bg-[#F8F9FA] px-6 py-5"
      :class="[variant === 'drawer' ? 'flex min-h-full flex-col' : '', bodyClass]"
    >
      <!--
        A full-bleed layer behind the body's content: a celebration's confetti,
        and anything else that must cover the whole body rather than stopping
        where the content does. It goes HERE, on the element that fills the
        panel, because a layer on the slotted content is only ever as tall as
        that content, which on a short activity leaves most of a tall drawer
        empty. `relative` is what makes an absolutely-positioned layer measure
        against this box.
      -->
      <slot name="body-layer" />
      <div class="space-y-5" :class="variant === 'drawer' ? 'flex flex-1 flex-col' : ''">
        <slot />
      </div>
    </div>

    <template #footer>
      <div class="flex items-center gap-3">
        <!-- Delete button (optional) — always leftmost -->
        <button
          v-if="showDelete"
          type="button"
          :aria-label="t('action.delete')"
          class="flex h-[48px] w-[48px] flex-shrink-0 items-center justify-center rounded-[14px] text-xl transition-all duration-150 hover:scale-105"
          style="background: rgb(239 68 68 / 8%)"
          :disabled="isSubmitting"
          @click="emit('delete')"
        >
          🗑️
        </button>

        <!-- Extra footer actions (slot) -->
        <slot name="footer-start" />

        <!-- Save button -->
        <button
          type="button"
          class="font-outfit flex-1 rounded-[16px] py-3.5 text-sm font-bold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50"
          :class="saveClasses"
          :disabled="saveDisabled || isSubmitting"
          @click="emit('save')"
        >
          <span v-if="isSubmitting" class="flex items-center justify-center gap-2">
            <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
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
            {{ submittingLabel || t('common.saving') }}
          </span>
          <span v-else>{{ saveLabel || t('action.save') }}</span>
        </button>
      </div>
    </template>
  </component>
</template>
