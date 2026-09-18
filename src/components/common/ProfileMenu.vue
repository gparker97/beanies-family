<script setup lang="ts">
/**
 * The profile dropdown, once.
 *
 * `AppHeader` renders this menu twice — once in the mobile header row, once in the
 * desktop one — and before this component existed those were **184 byte-identical lines
 * differing only in a comment**. Adding a menu item meant editing two places, and the
 * next person to add one would have had to notice that.
 *
 * ⚠️ THE BOUNDARY IS THE DESIGN. Because the menu renders twice, every prop and every
 * listener `AppHeader` has to wire is wired *twice* — so a fat interface brings the
 * duplication straight back in a new costume. Hence:
 *
 * - **This component owns what a View may own**: its own store reads, the avatar helpers,
 *   the beanie-wall flag, and the pure-navigation handlers (edit profile, settings, help,
 *   start wall) through its own `useRouter()`. Every one of those is "read reactive state,
 *   emit an intent" — the View role under MVO — and none of them is header-specific.
 * - **Only these cross**: `isRefreshing` (a prop) with `refresh-all`, because the
 *   service-worker update + `backgroundSyncFromFile` orchestration belongs to
 *   `AppHeader.handleRefreshAll`; `sign-out` and `switch-member`, because AppHeader owns
 *   the sign-out modal and its progress state; `sign-in-device`, because the sheet is
 *   mounted ONCE in AppHeader (mounting it here would give two instances with independent
 *   mint state); and `close`.
 *
 * If the call-site tag grows past ~5 attributes, the boundary has drifted and belongs
 * back here.
 */
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import { useFamilyStore } from '@/stores/familyStore';
import { useAuthStore } from '@/stores/authStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { useTranslation } from '@/composables/useTranslation';
import { getMemberAvatarVariant } from '@/composables/useMemberAvatar';
import { getMemberAvatarUrl, markMemberAvatarError } from '@/composables/useMemberInfo';
import { isFlagEnabled } from '@/config/flags';
import { isTemporaryEmail } from '@/utils/email';
import { MARKETING_URL } from '@/utils/marketing';
import { openExternal } from '@/utils/openExternal';
import { canStepUp } from '@/composables/useReauth';

defineProps<{
  /** Owned by AppHeader, which runs the refresh; this only reflects it. */
  isRefreshing: boolean;
}>();

const emit = defineEmits<{
  close: [];
  'refresh-all': [];
  'switch-member': [];
  'sign-out': [];
  'sign-in-device': [];
  'scan-code': [];
}>();

const router = useRouter();
const { t } = useTranslation();
const familyStore = useFamilyStore();
const authStore = useAuthStore();
const familyContextStore = useFamilyContextStore();

const currentMember = computed(() => familyStore.currentMember);

/**
 * The wall lives beside "Switch member" rather than in the header proper: both change what
 * THIS DEVICE is doing, not what the family's data says, and the wall is a set-it-once
 * mode that does not deserve permanent header real estate. Settings keeps the full card —
 * that is where the mode is explained and where the PIN prerequisite is surfaced — and
 * this is the shortcut for anyone already set up, so the item is hidden rather than
 * dead-ending someone who has no credential to leave the wall with.
 */
const canStartWall = computed(
  () =>
    isFlagEnabled('beanieWall') &&
    !!(currentMember.value?.pinHash || currentMember.value?.passwordHash)
);

/**
 * "Sign in another device" is the same class of action as the wall — it changes what
 * devices this family uses, not what its data says — so it sits in the same group.
 *
 * Hidden, not disabled, when the member has no credential to step up with. A tap-through
 * child has no PIN, so the gate could never run; offering them a button that opens a
 * family-wide credential and then refuses is worse than not offering it. Same reasoning,
 * and same shape, as `canStartWall`.
 */
const canSignInDevice = computed(() => canStepUp());

function go(path: string): void {
  emit('close');
  router.push(path);
}

function handleEditProfile(): void {
  emit('close');
  if (currentMember.value) {
    router.push({ path: '/family', query: { edit: currentMember.value.id } });
  }
}

function handleOpenHelp(): void {
  emit('close');
  openExternal(`${MARKETING_URL}/help`);
}
</script>

<template>
  <div
    class="dark:border-line dark:bg-surface-raised absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_8px_24px_rgba(44,62,80,0.12)] dark:shadow-[0_8px_24px_rgba(0,0,0,0.3)]"
  >
    <!-- Profile header with Deep Slate gradient -->
    <div
      class="bg-gradient-to-r from-[var(--color-secondary-500)] to-[var(--color-secondary-500)]/90 px-4 py-3"
    >
      <div class="flex items-center gap-2">
        <BeanieAvatar
          :variant="currentMember ? getMemberAvatarVariant(currentMember) : 'adult-other'"
          :color="currentMember?.color || '#3b82f6'"
          :photo-url="currentMember ? getMemberAvatarUrl(currentMember) : null"
          size="md"
          @photo-error="currentMember && markMemberAvatarError(currentMember)"
        />
        <div class="min-w-0 flex-1">
          <p class="font-outfit truncate text-sm font-semibold text-white">
            {{
              currentMember?.name || authStore.currentUser?.email || t('header.profileFallbackName')
            }}
          </p>
          <p v-if="familyContextStore.activeFamilyName" class="truncate text-xs text-white/60">
            {{ familyContextStore.activeFamilyName }}
          </p>
          <p
            v-if="authStore.currentUser?.email && !isTemporaryEmail(authStore.currentUser.email)"
            class="truncate text-xs text-white/50"
          >
            {{ authStore.currentUser.email }}
          </p>
        </div>
        <!-- Refresh all data -->
        <button
          type="button"
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/15 transition-colors hover:bg-white/30"
          :title="t('header.refreshAll')"
          :disabled="isRefreshing"
          @mousedown.prevent="emit('refresh-all')"
        >
          <svg
            class="h-4 w-4 text-white"
            :class="{ 'animate-spin': isRefreshing }"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>
      </div>
    </div>

    <!-- Menu items -->
    <div class="py-1.5">
      <!-- Edit Profile -->
      <button
        v-if="currentMember"
        type="button"
        class="text-secondary-500 dark:text-ink-soft dark:hover:bg-surface-hover flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-gray-50"
        @mousedown.prevent="handleEditProfile"
      >
        <svg
          class="h-4 w-4 shrink-0 opacity-50"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          viewBox="0 0 24 24"
        >
          <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
        {{ t('header.editProfile') }}
      </button>

      <!-- Settings -->
      <button
        type="button"
        class="text-secondary-500 dark:text-ink-soft dark:hover:bg-surface-hover flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-gray-50"
        @mousedown.prevent="go('/settings')"
      >
        <BeanieIcon name="settings" size="sm" class="opacity-50" />
        {{ t('header.settings') }}
      </button>

      <!-- Help -->
      <button
        type="button"
        class="text-secondary-500 dark:text-ink-soft dark:hover:bg-surface-hover flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-gray-50"
        @mousedown.prevent="handleOpenHelp"
      >
        <svg
          class="h-4 w-4 shrink-0 opacity-50"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          viewBox="0 0 24 24"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        {{ t('nav.help') }}
      </button>

      <!-- Divider -->
      <div class="dark:border-line my-1.5 border-t border-gray-100" />

      <!--
        Sign in another device: a device-mode action, so it sits with the wall and Switch
        member. This is the promotion the whole issue is about — it was four taps deep in
        Settings, below three other cards.
      -->
      <button
        v-if="canSignInDevice"
        type="button"
        class="text-secondary-500 dark:text-ink-soft dark:hover:bg-surface-hover flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-gray-50"
        data-testid="profile-sign-in-device"
        @mousedown.prevent="emit('sign-in-device')"
      >
        <svg
          class="h-4 w-4 shrink-0 opacity-50"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          viewBox="0 0 24 24"
        >
          <rect x="5" y="2" width="14" height="20" rx="2" />
          <line x1="12" y1="18" x2="12.01" y2="18" />
        </svg>
        {{ t('signInCode.menuItem') }}
      </button>

      <!-- ⚠️ THE PROVENANCE ROUTE, not a convenience. A code scanned HERE is the only kind
           the approval sheet can tell was deliberately scanned: `/welcome` is a verified App
           Link, so a link someone sent in a message opens the app identically to a camera
           scan and the OS gives us nothing to distinguish them. Everything arriving any other
           way gets asked "did you actually scan this?" first. Promoting this is what keeps
           that question from becoming a warning people tap through. -->
      <button
        type="button"
        class="text-secondary-500 dark:text-ink-soft dark:hover:bg-surface-hover flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-gray-50"
        @click="emit('scan-code')"
      >
        <svg
          class="h-4 w-4 shrink-0 opacity-50"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          viewBox="0 0 24 24"
        >
          <path
            d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"
          />
          <line x1="3" y1="12" x2="21" y2="12" />
        </svg>
        {{ t('qrScan.menuItem') }}
      </button>

      <!-- Beanie wall: a device-mode action, so it sits with Switch member -->
      <button
        v-if="canStartWall"
        type="button"
        class="text-secondary-500 dark:text-ink-soft dark:hover:bg-surface-hover flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-gray-50"
        @mousedown.prevent="go('/wall')"
      >
        <svg
          class="h-4 w-4 shrink-0 opacity-50"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          viewBox="0 0 24 24"
        >
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8" />
          <path d="M12 17v4" />
        </svg>
        {{ t('wall.setup.start') }}
      </button>

      <!-- Switch member: tier 1 — pod stays open, next screen is the person picker -->
      <button
        type="button"
        class="dark:text-ink dark:hover:bg-surface-hover/50 flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50"
        :title="t('auth.switchMemberHint')"
        @mousedown.prevent="emit('switch-member')"
      >
        <svg
          class="h-4 w-4 shrink-0 opacity-50"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          viewBox="0 0 24 24"
        >
          <path d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 11h-6" />
          <path d="M20 8l3 3-3 3" />
        </svg>
        {{ t('auth.switchMember') }}
      </button>

      <!-- Sign out -->
      <button
        type="button"
        class="dark:text-danger-lift flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-red-500 transition-colors hover:bg-red-50 dark:hover:bg-red-900/10"
        @mousedown.prevent="emit('sign-out')"
      >
        <svg
          class="h-4 w-4 shrink-0"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          viewBox="0 0 24 24"
        >
          <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
        {{ t('auth.signOut') }}
      </button>
    </div>
  </div>
</template>
