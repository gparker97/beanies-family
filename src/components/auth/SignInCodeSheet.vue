<script setup lang="ts">
/**
 * "Sign in another device" — the promoted, PIN-gated mint.
 *
 * This is the other half of the scan story: you are signed in, and you want a device that
 * is not. It was four taps deep in Settings (profile menu → Settings → Security & Recovery
 * → scroll past three cards), which is most of why the recovery kit became the front door.
 *
 * ⚠️ IT MINTS THE 15-MINUTE DEVICE LINK, NOT THE 7-DAY MAGIC LINK. "Sign in another
 * device" is the both-devices-in-hand case by definition, and the short link is the right
 * shape for it twice over: a device-link mint is ADDITIVE, so there is no "making a new
 * code stops the last one working" sentence to explain on a screen whose whole job is to
 * be obvious; and it narrows a full-family-key transport from a week to fifteen minutes,
 * which is the same risk argument that puts the PIN in front of it.
 *
 * ⚠️ THE PIN COMES FIRST, AND IT IS NOT DECORATION. The link transports the FAMILY key —
 * `magicLink.ts:11-14`: "whoever holds it can open everything the family has". It is also
 * not single-use, so it stays live for its whole window for anyone who has it. One tap
 * from an unlocked phone was too cheap for that, so `requireReauth()` stands in front.
 * Reusing the existing gate rather than building a PIN prompt is deliberate — it fails
 * closed, never hangs, and reports every non-verified path.
 *
 * ⚠️ MOUNTED ONCE, BY `AppHeader`. `ProfileMenu` renders twice, so hosting this inside it
 * would give two instances with independent mint state.
 */
import { watch } from 'vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BeanieSpinner from '@/components/ui/BeanieSpinner.vue';
import MintedLinkPanel from '@/components/ui/MintedLinkPanel.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useMintedLink } from '@/composables/useMintedLink';
import { mintDeviceLink } from '@/services/auth/linkMint';
import type { UIStringKey } from '@/services/translation/uiStrings';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const { t } = useTranslation();

const { link, qr, isMinting, errorKey, qrUnavailable, run } = useMintedLink({
  kind: 'device',
  surface: 'login-flow',
  // The entry point, so "where do people actually add a device from" is answerable.
  detail: 'origin=profile-menu',
  // The host proved identity before this sheet existed; do not ask twice.
  mint: () => mintDeviceLink({ alreadyProved: true }),
});

// Reset on every open, so a sheet reopened later never shows a stale code. The token is
// deliberately never persisted, so a previously minted link cannot be re-shown anyway —
// showing one from component state would be showing something the app can no longer vouch
// for.
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    link.value = '';
    qr.value = '';
    errorKey.value = null;
    qrUnavailable.value = false;
    // The host proved identity BEFORE opening this, so minting starts immediately. There is
    // no un-gated route to here.
    void run();
  }
);
</script>

<template>
  <BaseModal :open="open" :title="t('signInCode.title')" size="md" @close="emit('close')">
    <!--
      No step 1. The PIN gate ran before this component was mounted (see
      `AppHeader.openSignInCodeSheet`), and the explanatory sentence rides on the gate
      itself — so the only thing left to do here is show the code.
    -->
    <!-- ⚠️ `BeanieSpinner label`, not a bare <p>. Minting takes several seconds (a key wrap
         plus a Drive write), and the old text-only state gave no sign anything was
         happening — it read as a frozen sheet. `label` also brings `role="status"`, which
         the plain paragraph never had, so the wait is announced rather than silent. -->
    <div v-if="isMinting" class="py-8 text-center">
      <BeanieSpinner size="md" label />
    </div>

    <div v-else-if="link" class="space-y-3">
      <p class="dark:text-ink-soft text-sm text-gray-600">
        {{ t('signInCode.scanLead') }}
      </p>
      <MintedLinkPanel
        :link="link"
        :qr-url="qr"
        :qr-unavailable="qrUnavailable"
        :qr-alt="t('signInCode.qrAlt')"
        :hint="t('signInCode.scanLead')"
        surface="login-flow"
      />
      <!--
        No "this replaces your last code" line, and that is the point of using the device
        link: an `inviteKeys` mint is additive and revokes nothing.
      -->
      <p class="dark:text-ink-faint text-xs text-gray-500">
        {{ t('signInCode.expiryNote') }}
      </p>
    </div>

    <p v-if="errorKey" role="alert" class="dark:text-danger-lift mt-3 text-sm text-red-600">
      {{ t(errorKey as UIStringKey) }}
    </p>
  </BaseModal>
</template>
