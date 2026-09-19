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
import { ref, computed, watch } from 'vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BeanieSpinner from '@/components/ui/BeanieSpinner.vue';
import MintedLinkPanel from '@/components/ui/MintedLinkPanel.vue';
import LoginChoiceCard from '@/components/login/LoginChoiceCard.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useMintedLink } from '@/composables/useMintedLink';
import { useIsTouchPrimary } from '@/composables/useIsTouchPrimary';
import { useQrCapture } from '@/composables/useQrCapture';
import { requireReauth } from '@/composables/useReauth';
import { emitApprovalKeyDropped } from '@/services/telemetry/deepLinkEvents';
import { mintDeviceLink } from '@/services/auth/linkMint';
import type { UIStringKey } from '@/services/translation/uiStrings';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{
  close: [];
  /** A code this device just read in-app. Provenance the deep-link path cannot establish. */
  'approval-scanned': [key: string];
}>();

const { t } = useTranslation();
const isTouchPrimary = useIsTouchPrimary();

/** `choose` is always the entry; `code` is only reachable through a proven PIN. */
const step = ref<'choose' | 'code'>('choose');

const { link, qr, isMinting, errorKey, qrUnavailable, run } = useMintedLink({
  kind: 'device',
  surface: 'login-flow',
  // The entry point, so "where do people actually add a device from" is answerable.
  detail: 'origin=profile-menu',
  // The gate runs in `showCode()` below, one step in, rather than before this sheet exists.
  mint: () => mintDeviceLink({ alreadyProved: true }),
});

const capture = useQrCapture({
  origin: 'profile-menu',
  expect: 'approval',
  onScanned: (result) => {
    if (result.kind !== 'approval') return;
    // ⚠️ The decode takes a second or two, and the person may have given up and dismissed
    // this sheet in the meantime. Delivering anyway would pop the approval sheet over
    // whatever they moved on to — carrying `in-app-scan`, the one provenance that SKIPS the
    // "did someone send you this?" check.
    if (!props.open) {
      // ⚠️ The guard is right; the SILENCE was not. A fully decoded approval key used to be
      // dropped here with no event anywhere, so this path was invisible in CloudWatch and
      // indistinguishable from a decode that never happened.
      emitApprovalKeyDropped({ delivery: 'in-app-scan', errorCode: 'sheet-dismissed' });
      return;
    }
    // Hand the key up and get out of the way. The approval sheet now sits a layer above this
    // one, so this is no longer what prevents a buried modal — but returning the person to a
    // sheet they have finished with is still the wrong place to leave them.
    emit('approval-scanned', result.key);
    emit('close');
  },
});

/**
 * Lead with whichever option puts the scanning job on a device that has a camera, the same
 * rule the cold sign-in surface uses, so the two screens agree. Both options are always
 * present; only the order changes.
 *
 * ⚠️ THE DOM ORDER CHANGES, NOT JUST THE PAINT ORDER. A `flex-col-reverse` would leave tab
 * order and screen-reader reading order matching the source while the visual order was
 * reversed — and since the ORDER IS THE SIGNAL here, that would invert the signal for
 * exactly the keyboard and screen-reader users it is meant to help (WCAG 2.4.3, 1.3.2).
 */
const options = computed(() => {
  const show = { id: 'show' as const, title: t('signInCode.optionShowTitle') };
  const read = { id: 'read' as const, title: t('signInCode.optionReadTitle') };
  return isTouchPrimary.value ? [read, show] : [show, read];
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

/** Synchronous by necessity — see the user-activation warning in the docblock. */
function readCode(): void {
  capture.open();
}

// Reset on every open, so a sheet reopened later never shows a stale code or a stale step.
// The token is deliberately never persisted, so a previously minted link cannot be re-shown
// anyway — showing one from component state would be showing something the app can no
// longer vouch for.
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    step.value = 'choose';
    link.value = '';
    qr.value = '';
    errorKey.value = null;
    qrUnavailable.value = false;
    capture.error.value = null;
  }
);
</script>

<template>
  <BaseModal :open="open" :title="t('signInCode.title')" size="md" @close="emit('close')">
    <div v-if="step === 'choose'" class="space-y-3">
      <!--
        No lead sentence. An earlier version asked "which of these is true of the other
        device?", which was a careful way to stop "show" and "scan" being got backwards when
        you are holding two phones. The icons do that job better and faster: a QR glyph means
        we make one, a camera glyph means we read one. A sub-line explaining what a QR code
        is would be noise under an icon that already says it, so there is none. If the icons
        ever need a sentence to work, the icons are wrong.
      -->
      <div class="grid grid-cols-2 gap-3">
        <LoginChoiceCard
          v-for="option in options"
          :key="option.id"
          class="dark:border-line dark:bg-surface-overlay dark:hover:bg-surface-hover items-center gap-3 rounded-2xl border border-gray-200 bg-white px-3 py-5 hover:bg-gray-50"
          :disabled="option.id === 'read' && capture.isBusy.value"
          :testid="`signin-option-${option.id}`"
          @click="option.id === 'show' ? showCode() : readCode()"
        >
          <span
            class="dark:bg-surface-raised mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#FDF1EB]"
          >
            <!-- Heritage Orange needs its lift on dark: 3.85 on `surface-overlay` is below
                 AA, and this glyph is the whole point of the card, not decoration. -->
            <svg
              v-if="option.id === 'show'"
              class="dark:text-accent-lift h-9 w-9 text-[#C24A16]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.75"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
              <path d="M14 14h3v3h-3zM20.5 14v3M17 20.5h3.5M14 20.5h0" />
            </svg>
            <svg
              v-else
              class="dark:text-accent-lift h-9 w-9 text-[#C24A16]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.75"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path
                d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"
              />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
          </span>
          <!-- Centred in the remaining height rather than sitting straight under the icon:
               at 390px one label wraps to two lines and the other does not, and top-aligning
               them left the two cards visibly lopsided. -->
          <span class="mt-3 flex flex-1 items-center justify-center">
            <p class="font-outfit dark:text-ink text-center text-sm font-semibold text-gray-900">
              {{
                option.id === 'read' && capture.isBusy.value
                  ? t('coldEntry.scanning')
                  : option.title
              }}
            </p>
          </span>
        </LoginChoiceCard>
      </div>

      <input
        :ref="(el) => (capture.inputRef.value = el as HTMLInputElement)"
        v-bind="capture.bindings"
      />
      <p v-if="capture.error.value" role="alert" class="dark:text-danger-lift text-sm text-red-600">
        {{ capture.error.value }}
      </p>
    </div>

    <template v-else>
      <!-- ⚠️ `BeanieSpinner label`, not a bare <p>. Minting takes several seconds (a key wrap
           plus a Drive write), and a text-only state gave no sign anything was happening.
           `label` also brings `role="status"`, so the wait is announced rather than silent. -->
      <div v-if="isMinting" class="py-8 text-center">
        <BeanieSpinner size="md" label />
      </div>

      <div v-else-if="link" class="space-y-3">
        <p class="dark:text-ink-soft text-sm text-gray-600">{{ t('signInCode.scanLead') }}</p>
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
        @click="step = 'choose'"
      >
        {{ t('signInCode.back') }}
      </button>
    </template>

    <p v-if="errorKey" role="alert" class="dark:text-danger-lift mt-3 text-sm text-red-600">
      {{ t(errorKey as UIStringKey) }}
    </p>
  </BaseModal>
</template>
