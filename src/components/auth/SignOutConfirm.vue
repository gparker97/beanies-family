<script setup lang="ts">
/**
 * The ONE sign-out confirm (2026-09-23), shared by desktop and mobile. Moved out of
 * AppHeader so the mobile menu (which used to sign out with no confirm at all) gets it too.
 *
 * It carries the "trust this device" tick: it starts from the device's current trust, and
 * the hint under it follows it live, so the keep-or-wipe consequence of this sign-out is
 * visible at the moment of the decision. The tick is APPLIED only on Sign Out, after the
 * recovery-kit guard (see `useSignOut`); Cancel changes nothing.
 *
 * Mounted with `v-if` by SignOutHost, so every open starts fresh from `isTrustedDevice`.
 * It unmounts the moment an action is chosen (`phase` leaves 'confirm' synchronously);
 * the progress surface is SignOutHost's overlay.
 */
import { computed, ref } from 'vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import { BaseButton } from '@/components/ui';
import InfoHintBadge from '@/components/ui/InfoHintBadge.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useSignOut } from '@/composables/useSignOut';
import { useSettingsStore } from '@/stores/settingsStore';
import { isNative } from '@/services/sync/capabilities';
import { isDemoSession } from '@/utils/reviewDemo';

const { t } = useTranslation();
const settingsStore = useSettingsStore();
const { signOut, cancelSignOut } = useSignOut();

const trustTick = ref(settingsStore.isTrustedDevice);

/**
 * "Browser" on web and PWA, "device" inside the native shell: the same local-only action,
 * named with a noun each audience recognises (there is no browser to point at on native).
 */
const clearDataLabel = computed(() =>
  isNative() ? t('auth.signOutClearDataNative') : t('auth.signOutClearData')
);
</script>

<template>
  <Teleport to="body">
    <BaseModal
      :open="true"
      :title="t('auth.signOutConfirmTitle')"
      size="sm"
      layer="overlay"
      @close="cancelSignOut"
    >
      <div class="flex flex-col items-center gap-4 text-center">
        <div
          class="dark:text-danger-lift flex h-12 w-12 items-center justify-center rounded-2xl bg-red-100 text-red-500 dark:bg-red-900/30"
        >
          <svg
            class="h-6 w-6"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </div>

        <p class="dark:text-ink-soft text-sm text-gray-600">
          {{ t('auth.signOutConfirmMessage') }}
        </p>

        <!-- No trust tick in the App Review demo: a reviewer's device must never be left
             trusted (createNewFile skips trust-on-create for the same reason). -->
        <label
          v-if="!isDemoSession"
          class="dark:bg-surface-overlay flex w-full cursor-pointer items-start gap-2.5 rounded-xl bg-gray-50 p-3 text-left"
        >
          <input
            v-model="trustTick"
            type="checkbox"
            class="accent-primary-500 mt-0.5 h-4 w-4 shrink-0 cursor-pointer"
            data-testid="signout-trust-tick"
          />
          <span class="dark:text-ink text-sm text-gray-700">
            {{ t('auth.signOutTrustDevice') }}
          </span>
        </label>
        <p
          v-if="!isDemoSession"
          class="dark:text-ink-faint text-xs text-gray-500"
          data-testid="signout-trust-hint"
        >
          {{ trustTick ? t('auth.signOutConfirmHint') : t('auth.signOutConfirmHintUntrusted') }}
        </p>
      </div>

      <template #footer>
        <div class="flex flex-col gap-3">
          <!-- The standard action, full-width and unambiguous -->
          <BaseButton
            variant="danger"
            size="sm"
            class="!h-auto !w-full"
            data-testid="signout-confirm"
            @click="signOut('sign-out', { trust: trustTick })"
          >
            <span class="flex items-center justify-center gap-1.5">
              <span aria-hidden="true">🚪</span> {{ t('auth.signOut') }}
            </span>
          </BaseButton>
          <!-- Clear-data: deliberately quiet — only for shared devices / emergencies -->
          <button
            type="button"
            class="dark:text-danger-lift dark:hover:text-danger-lift mx-auto text-xs font-medium text-red-500 underline-offset-2 hover:text-red-600 hover:underline"
            data-testid="signout-clear-data"
            @click="signOut('clear', { trust: trustTick })"
          >
            <span aria-hidden="true">🗑️</span> {{ clearDataLabel }}
          </button>
          <div class="flex justify-end">
            <span class="flex items-center gap-1">
              <span class="dark:text-ink-faint text-xs text-gray-500">
                {{ t('common.whatsThis') }}
              </span>
              <InfoHintBadge :text="t('auth.signOutClearDataHint')" />
            </span>
          </div>

          <button
            type="button"
            class="font-outfit dark:text-ink-faint dark:hover:text-ink-soft mx-auto text-xs font-medium text-gray-500 hover:text-gray-700"
            @click="cancelSignOut"
          >
            {{ t('action.cancel') }}
          </button>
        </div>
      </template>
    </BaseModal>
  </Teleport>
</template>
