<script setup lang="ts">
/**
 * The wall's home in Settings — where the mode is explained, and where the PIN
 * prerequisite is DEALT WITH rather than merely announced.
 *
 * Entry is gated on the member having a PIN (or a legacy password): leaving the
 * wall is a step-up against their own identity, so a credential-less member
 * could otherwise start a chrome-free mode they could not cleanly leave. The
 * card used to just tell them to go and set one somewhere else, which is a
 * dead end dressed as guidance. Now it opens the real `PinSettings` card in
 * place, watches for the PIN to land, and continues into the wall — the user
 * had to set one anyway, so the two steps become one flow.
 */
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseCard from '@/components/ui/BaseCard.vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import PinSettings from '@/components/settings/PinSettings.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useFamilyStore } from '@/stores/familyStore';
import { useAuthStore } from '@/stores/authStore';
import { getDevicePlatform, isWakeLockSupported } from '@/services/sync/capabilities';
import { openHelpArticle, HELP_PATHS } from '@/utils/helpLinks';
import { wallDeviceTipKeys } from '@/utils/wallDeviceTips';

const router = useRouter();
const { t } = useTranslation();
const familyStore = useFamilyStore();
const authStore = useAuthStore();

// ⚠️ THE SAME QUESTION `PinSettings` ASKS. It was `familyStore.currentMember`,
// which falls back to the OWNER when nothing else resolves, while the PIN form
// keys off `authStore.currentUser?.memberId`. With a pod open but no member
// signed in the two disagreed: this card demanded a PIN for the owner's row and
// the form could not set one, so the button did nothing and the loop had no
// exit. One source, or they drift apart again.
const member = computed(() =>
  familyStore.members.find((m) => m.id === authStore.currentUser?.memberId)
);
const canEnterWall = computed(() => !!(member.value?.pinHash || member.value?.passwordHash));

const pinModalOpen = ref(false);

/**
 * The device nudge: three signposts, not a checklist. The full instructions
 * live in the help article, because a wall of device settings on the card is
 * the thing most likely to stop someone trying the wall at all.
 *
 * Resolved once at setup rather than as a `computed`: neither the OS nor
 * wake-lock support can change while this card is mounted, and a `computed`
 * would imply otherwise. Note this asks `capabilities` for wake-lock SUPPORT
 * and never touches `useWakeLock`, which would acquire a real lock on setup.
 */
const tipKeys = wallDeviceTipKeys(getDevicePlatform(), isWakeLockSupported());

function openSetupHelp(): void {
  openHelpArticle(HELP_PATHS.wallSetup, 'wall-setup-card');
}

function start() {
  if (canEnterWall.value) {
    void router.push('/wall');
    return;
  }
  pinModalOpen.value = true;
}

/**
 * `PinSettings` has no success event — it is a self-contained card over
 * `authStore.setMemberPin`. Watching the member's own `pinHash` appear is the
 * honest signal that the prerequisite is met, and it needs no change to a
 * component seven other places depend on.
 */
watch(canEnterWall, (ready) => {
  if (ready && pinModalOpen.value) {
    pinModalOpen.value = false;
    void router.push('/wall');
  }
});
</script>

<template>
  <BaseCard>
    <h3 class="font-outfit text-secondary-500 dark:text-ink text-lg font-semibold">
      {{ t('wall.setup.title') }}
    </h3>
    <p class="text-secondary-400 dark:text-ink-soft mt-1 text-sm">
      {{ t('wall.setup.description') }}
    </p>

    <p v-if="!canEnterWall" class="text-secondary-400 dark:text-ink-soft mt-3 text-sm">
      {{ t('wall.setup.needsPin.message') }}
    </p>

    <p class="text-secondary-400 dark:text-ink-soft mt-4 text-sm">
      {{ t('wall.setup.tips.lead') }}
    </p>
    <ul class="mt-2 space-y-1">
      <li
        v-for="key in tipKeys"
        :key="key"
        class="text-secondary-400 dark:text-ink-soft flex gap-2 text-sm leading-snug"
      >
        <span class="text-primary-500 dark:text-accent-lift shrink-0" aria-hidden="true">•</span>
        <span>{{ t(key) }}</span>
      </li>
    </ul>
    <button
      type="button"
      data-testid="wall-setup-help"
      class="text-primary-500 dark:text-accent-lift mt-3 text-sm font-semibold hover:underline"
      @click="openSetupHelp"
    >
      {{ t('wall.setup.help.link') }}
    </button>

    <BaseButton class="mt-4" @click="start">
      {{ canEnterWall ? t('wall.setup.start') : t('wall.setup.setPinAndStart') }}
    </BaseButton>

    <BeanieFormModal
      :open="pinModalOpen"
      :title="t('wall.setup.needsPin.title')"
      :save-label="t('action.close')"
      @close="pinModalOpen = false"
      @save="pinModalOpen = false"
    >
      <p class="text-secondary-400 dark:text-ink-soft mb-3 text-sm">
        {{ t('wall.setup.needsPin.message') }}
      </p>
      <PinSettings />
    </BeanieFormModal>
  </BaseCard>
</template>
