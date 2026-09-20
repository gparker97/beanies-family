<script setup lang="ts">
/**
 * "Sign in another device" — both directions, behind one menu item.
 *
 * You are signed in; another device is not. There are exactly two ways to bridge that, and
 * which one applies depends on the OTHER device, not on you:
 *   - it can point a camera at this screen  → we mint a code here for it to read (PUSH)
 *   - it is already showing a code          → we read that code with this device (PULL)
 *
 * ⚠️ THE CHOOSER ASKS ABOUT A STATE, NOT AN ACTION, AND THAT IS THE WHOLE DESIGN. "Show a
 * code" and "scan a code" are both instructions to YOU, and when you are holding two
 * phones they are trivially got backwards. A statement about the other device cannot be:
 * "this device" is unambiguously the one with the menu open. Each option is therefore a
 * sentence that is either true or false right now, and its sub-line says what this device
 * will do about it. Do not "simplify" these labels back into verbs.
 *
 * ⚠️ "MAGIC LINK" IS THE USER-FACING NAME FOR EVERY SIGN-IN LINK, WHATEVER ITS LIFETIME.
 * greg's rule, and it is a product decision rather than a technical one: a person does not
 * need two names for "a link that signs me in", so the expiry is stated next to the link
 * instead of encoded in what it is called. Internally this still mints the FIFTEEN-MINUTE
 * device link, not the seven-day one handed out at family creation, and that distinction
 * still matters to the code (different lifetime, different revocation). Do not "correct"
 * the copy to match the internal name.
 *
 * ⚠️ THE PIN GATES THE MINT AND ONLY THE MINT. The link transports the FAMILY key
 * (`magicLink.ts:11-14`: "whoever holds it can open everything the family has") and is not
 * single-use, so it stays live for its whole window for anyone holding it. Scanning hands
 * over nothing, and its gate already sits at the approve step inside
 * `DeviceApprovalSheet` — so gating the chooser would ask for a PIN from someone who has
 * not yet chosen to do anything sensitive, which `useReauth`'s own docblock calls a defect.
 *
 * ⚠️ THE SCAN BRANCH MUST NOT AWAIT BEFORE `open()`. Opening an OS file picker requires
 * transient user activation, so anything awaited first — a gate, a transition — can make
 * Safari refuse it silently. This is the same class of failure as the `@click` /
 * `@mousedown` bug that made the old menu item dead on every device.
 *
 * ⚠️ MOUNTED ONCE, BY `AppHeader`. `ProfileMenu` renders twice, so hosting this inside it
 * would give two instances with independent mint state.
 */
import { ref, watch } from 'vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BeanieSpinner from '@/components/ui/BeanieSpinner.vue';
import MintedLinkPanel from '@/components/ui/MintedLinkPanel.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useMintedLink } from '@/composables/useMintedLink';
import { requireReauth } from '@/composables/useReauth';
import { mintDeviceLink } from '@/services/auth/linkMint';
import type { UIStringKey } from '@/services/translation/uiStrings';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{
  close: [];
  /** A code this device just read in-app. Provenance the deep-link path cannot establish. */
}>();

const { t } = useTranslation();

/**
 * ⚠️ THERE IS NO CHOOSER ANY MORE, AND THE PIN IS WHY THIS IS STILL A STEP.
 *
 * The sheet used to open on two cards: "create a QR code" and "scan a QR code". The second
 * WAS the in-app scanner, which has been removed — it photographed one frame and decoded the
 * file, and greg confirmed on a production iPhone that it still failed where the phone's own
 * camera app succeeded instantly. A chooser with one option is not a choice, so the sheet now
 * goes straight to the mint.
 *
 * The pull direction did not go away with it: the other device shows a code and this one
 * reads it with the NATIVE camera, which deep-links straight into the approval sheet. That is
 * the transport greg confirmed works, and the copy below says so.
 */
const step = ref<'gate' | 'code'>('gate');

const { link, qr, isMinting, errorKey, qrUnavailable, run, cancel } = useMintedLink({
  kind: 'device',
  surface: 'login-flow',
  // The entry point, so "where do people actually add a device from" is answerable.
  detail: 'origin=profile-menu',
  // The gate runs in `showCode()` below, one step in, rather than before this sheet exists.
  mint: () => mintDeviceLink({ alreadyProved: true }),
});

const isGating = ref(false);

async function showCode(): Promise<void> {
  // ⚠️ `BaseModal` has no focus trap, so focus stays on the card beneath the PIN pad and a
  // second Enter re-enters here. `useReauth` holds ONE `resolve`, so the second call
  // overwrites it and the first promise never settles: a silently leaked await.
  if (isGating.value) return;
  isGating.value = true;
  try {
    const proved = await requireReauth({
      titleKey: 'signInCode.title',
      reasonKey: 'signInCode.pinReason',
    });
    // Back to the chooser, NOT out of the sheet. Closing here would make the scan option
    // unreachable to anyone who declined the gate, which is a strange way to punish someone
    // for changing their mind.
    if (!proved) return;
    step.value = 'code';
    void run();
  } finally {
    isGating.value = false;
  }
}

// Reset on every open, so a sheet reopened later never shows a stale code or a stale step.
// The token is deliberately never persisted, so a previously minted link cannot be re-shown
// anyway — showing one from component state would be showing something the app can no
// longer vouch for.
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    step.value = 'gate';
    link.value = '';
    qr.value = '';
    errorKey.value = null;
    qrUnavailable.value = false;
    // ⚠️ `cancel()`, NOT `isMinting.value = false`. Without any reset a mint that hung left
    // the spinner up across a close and reopen, and the re-entrancy guard then made every
    // retry tap a silent no-op — a reload was the only way out, which is what greg had to do.
    // But clearing the flag from out here only unlocked the door; the abandoned run was still
    // live and would later write its verdict over the retry's. `cancel()` bumps the
    // generation as well, which is what actually makes it harmless.
    cancel();
  }
);
</script>

<template>
  <BaseModal :open="open" :title="t('signInCode.title')" size="md" @close="emit('close')">
    <!--
      The sheet opens straight on the mint. There is no chooser: its second card WAS the
      in-app scanner, and a chooser with one option is not a choice. See `step`.
    -->
    <div v-if="step === 'gate'" class="space-y-4">
      <!-- The lead, not a caption: this sentence IS the instruction for the primary action
           below it, so it takes body weight and ink rather than the muted small type it had. -->
      <p class="dark:text-ink text-base font-medium text-gray-900">
        {{ t('signInCode.gateLead') }}
      </p>
      <BaseButton class="w-full" variant="primary" type="button" @click="showCode">
        <span class="inline-flex items-center justify-center gap-2">
          <!-- A QR glyph, so the button says what it PRODUCES before it is tapped. Inline
               stroke SVG per the theme skill: no emoji, no icon font. `aria-hidden` because
               the label beside it already names the action. -->
          <svg
            class="h-5 w-5 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <path d="M14 14h3v3h-3zM20 14v.01M14 20v.01M17 20h3v-3" />
          </svg>
          {{ t('signInCode.createLink') }}
        </span>
      </BaseButton>
      <!-- The pull direction, which did not leave with the scanner: the other device shows a
           code and this one reads it with the camera it already has. -->
      <p class="dark:text-ink-faint text-xs text-gray-500">{{ t('signInCode.orScanHint') }}</p>
    </div>

    <template v-else>
      <!-- ⚠️ `BeanieSpinner label`, not a bare <p>. Minting takes several seconds (a key wrap
           plus a Drive write), and a text-only state gave no sign anything was happening.
           `label` also brings `role="status"`, so the wait is announced rather than silent. -->
      <div v-if="isMinting" class="py-8 text-center">
        <BeanieSpinner size="md" label />
      </div>

      <div v-else-if="link" class="space-y-3">
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
        <p class="dark:text-ink-faint text-xs text-gray-500">{{ t('signInCode.expiryNote') }}</p>
      </div>

      <!-- ⚠️ OUTSIDE the `v-else-if="link"` block. A failed mint leaves `link` empty, so
           nesting this inside it left the person on a step showing one red line with no way
           back and no retry, reachable only by dismissing the sheet and re-entering the
           PIN. The previous single-step sheet had nowhere to go back TO; this one does. -->
      <button
        v-if="!isMinting"
        type="button"
        class="dark:text-ink-soft mt-3 w-full text-center text-sm text-gray-600 underline"
        @click="step = 'gate'"
      >
        {{ t('signInCode.back') }}
      </button>
    </template>

    <p v-if="errorKey" role="alert" class="dark:text-danger-lift mt-3 text-sm text-red-600">
      {{ t(errorKey as UIStringKey) }}
    </p>
  </BaseModal>
</template>
