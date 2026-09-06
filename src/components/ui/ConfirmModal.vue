<script setup lang="ts">
import BaseModal from '@/components/ui/BaseModal.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import { computed } from 'vue';
import { useConfirm } from '@/composables/useConfirm';
import { safeExternalHref } from '@/utils/url';
import { useTranslation } from '@/composables/useTranslation';

const { t } = useTranslation();
const { state, handleConfirm, handleCancel } = useConfirm();

/**
 * The confirm href, screened. Same screen `openExternal` applies, so a value
 * that is not http(s) renders a plain button rather than a live link. The one
 * caller passes a frozen constant, so this is defence rather than expectation.
 */
const safeConfirmHref = computed(() => safeExternalHref(state.value.confirmHref) ?? undefined);
</script>

<template>
  <BaseModal
    :open="state.open"
    :title="t(state.title)"
    size="sm"
    :closable="state.showCancel"
    layer="top"
    @close="handleCancel"
  >
    <!-- Body -->
    <div class="flex flex-col items-center gap-4 text-center">
      <!-- Icon in colored squircle -->
      <div
        class="flex h-12 w-12 items-center justify-center rounded-2xl"
        :class="
          state.variant === 'danger'
            ? 'dark:text-danger-lift bg-red-100 text-red-600 dark:bg-red-900/30'
            : 'dark:text-accent-lift bg-orange-100 text-orange-600 dark:bg-orange-900/30'
        "
      >
        <BeanieIcon :name="state.variant === 'danger' ? 'trash' : 'info'" size="lg" />
      </div>

      <p class="dark:text-ink-soft text-sm text-gray-600">
        {{ t(state.message) }}
      </p>
      <!-- The caution tone is the SAME slab as Settings' standing notice (Heritage
           Orange, never Alert Red: nothing is being destroyed), so a warning
           seen on the page reads as the same warning here. -->
      <div
        v-if="state.detail && state.detailTone === 'caution'"
        class="dark:border-accent-lift/40 dark:bg-accent-lift/10 flex w-full gap-2 rounded-xl border border-orange-200 bg-orange-50 p-3 text-left"
      >
        <BeanieIcon
          name="exclamation-circle"
          class="text-primary-500 dark:text-accent-lift mt-0.5 h-4 w-4 flex-shrink-0"
          aria-hidden="true"
        />
        <p class="dark:text-ink-soft text-xs leading-relaxed text-orange-900">
          {{ state.detail }}
        </p>
      </div>
      <p v-else-if="state.detail" class="dark:text-ink-soft text-xs text-gray-500">
        {{ state.detail }}
      </p>
    </div>

    <!-- Footer — uses native buttons to avoid click event delegation issues -->
    <template #footer>
      <div class="flex justify-end gap-3">
        <button
          v-if="state.showCancel"
          type="button"
          class="dark:text-ink-soft dark:hover:bg-surface-hover inline-flex items-center justify-center rounded-2xl bg-transparent px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100"
          @click="handleCancel"
        >
          {{ state.cancelLabel ? t(state.cancelLabel) : t('action.cancel') }}
        </button>
        <!-- ⚠️ AN ANCHOR WHEN THERE IS AN href, A BUTTON OTHERWISE. `confirm()`
             resolves a PROMISE, so a caller acting on the result resumes one
             microtask after this handler returned, which the popup blocker
             treats as a programmatic navigation. Letting the browser perform
             its own default action on a genuine click is the only way the
             store link opens reliably on iOS. With `confirmHref` unset every
             existing call site renders exactly the button it always has: same
             classes, same label, same `handleConfirm`. -->
        <component
          :is="safeConfirmHref ? 'a' : 'button'"
          :type="safeConfirmHref ? undefined : 'button'"
          :href="safeConfirmHref"
          :target="safeConfirmHref ? '_blank' : undefined"
          :rel="safeConfirmHref ? 'noopener noreferrer' : undefined"
          class="inline-flex touch-manipulation items-center justify-center rounded-2xl px-3 py-1.5 text-sm font-medium text-white transition-colors"
          :class="
            state.variant === 'danger'
              ? 'bg-red-600 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600'
              : 'bg-primary-500 hover:bg-primary-600'
          "
          @click="handleConfirm"
        >
          {{
            state.confirmLabel
              ? t(state.confirmLabel)
              : state.showCancel
                ? t('action.delete')
                : t('action.ok')
          }}
        </component>
      </div>
    </template>
  </BaseModal>
</template>
