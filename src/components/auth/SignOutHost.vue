<script setup lang="ts">
/**
 * Renders the shared sign-out state (2026-09-23), mounted ONCE at the App root, outside
 * the layout, so desktop and mobile share one confirm, one kit guard and one progress
 * overlay (the ConfirmModal pattern: `useSignOut` drives it, this renders it).
 *
 * Each phase is its own `v-if`'d child, so every open starts from fresh state.
 *
 * The one watcher: if the session ends under an open confirm or guard (a session
 * invalidation, say), `abandonSignOut` closes it, so no modal floats over /login and no
 * guard promise is left pending.
 */
import { watch } from 'vue';
import BeanieSpinner from '@/components/ui/BeanieSpinner.vue';
import SignOutConfirm from '@/components/auth/SignOutConfirm.vue';
import SignOutKitGuard from '@/components/auth/SignOutKitGuard.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useSignOutHost } from '@/composables/useSignOut';
import { useAuthStore } from '@/stores/authStore';

const { t } = useTranslation();
const authStore = useAuthStore();
const { phase, abandonSignOut } = useSignOutHost();

watch(
  () => authStore.isAuthenticated,
  (authenticated) => {
    if (!authenticated) abandonSignOut();
  }
);
</script>

<template>
  <SignOutConfirm v-if="phase === 'confirm'" />
  <SignOutKitGuard v-if="phase === 'guard'" />
  <!-- Sign-out takes a few seconds (bounded force-save + Google/session teardown); without
       this the app looked frozen until the welcome gate flashed in (greg's field report). -->
  <Teleport to="body">
    <div
      v-if="phase === 'signing-out'"
      class="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-[#F8F9FA]/90 backdrop-blur-sm dark:bg-[#1a252f]/90"
      role="status"
      aria-live="polite"
      data-testid="signout-progress"
    >
      <BeanieSpinner size="lg" />
      <p class="font-outfit dark:text-ink text-sm font-semibold text-[#2C3E50]">
        {{ t('auth.signingOut') }}
      </p>
    </div>
  </Teleport>
</template>
