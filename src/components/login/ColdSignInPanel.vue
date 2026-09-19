<script setup lang="ts">
/**
 * "Get in from a device you're already signed in on" — the top-line way back in, on every
 * cold surface.
 *
 * One component rather than markup repeated per surface, because there are three of them
 * (the welcome gate, the load-pod screen, and the prove screen's cold state) and they must
 * not drift into three slightly different explanations of the same thing.
 *
 * The measurement this exists to move: 6 of 22 families redeemed a recovery kit, every one
 * on a cold device, and 5 of those 6 then replaced a PIN that was working. They did not
 * need recovery. They needed a way in, and nothing on these screens offered one.
 *
 * ⚠️ STILL NO `getUserMedia`, NO VIEWFINDER, NO CAMERA PERMISSION. That position has not
 * changed and should not: a live viewfinder means a permission prompt, a permission-denied
 * state and a preview surface, none of which this needs. What HAS changed is that "Open
 * Camera" now takes ONE PHOTO through the OS picker (`useQrCapture`) and decodes the file
 * in-app, which is the same mechanism recovery-kit entry has always used. If you are
 * reading this while reaching for `getUserMedia`, don't.
 *
 * ⚠️ THE PANEL LEADS WITH WHICHEVER DIRECTION PUTS THE SCANNING JOB ON A DEVICE THAT HAS A
 * CAMERA. On a phone that is PUSH: this device photographs a code shown by a signed-in one.
 * On a laptop it is PULL: this device displays a code for a signed-in phone to read. The
 * panel used to lead with pull everywhere, which is why greg — on an iPhone, looking at a
 * QR his phone could not scan itself — asked what it was for. Both directions stay
 * reachable on both form factors; only the order changes.
 */
import DeviceApprovalRequest from '@/components/login/DeviceApprovalRequest.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import { useIsTouchPrimary } from '@/composables/useIsTouchPrimary';
import { useQrCapture } from '@/composables/useQrCapture';
import { useBeaniesLinkSubmit } from '@/composables/useBeaniesLinkSubmit';
import PasteLinkPanel from '@/components/login/PasteLinkPanel.vue';
import { onMounted, ref, computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { emitColdUnlockStarted } from '@/services/telemetry/loginFlowEvents';

const emit = defineEmits<{ approved: []; 'paste-submitted': [] }>();

const { t } = useTranslation();

/**
 * THE DENOMINATOR. `magicLink.ts:5-9` records that 6 of 22 families redeemed a kit on a
 * cold device — but with no count of how many families reached a cold surface at all,
 * "27%" cannot be compared before and after this change. `surface` distinguishes the
 * welcome gate from the load-pod screen, which is what separates the cold-phone case from
 * the cold-laptop one.
 */
const props = defineProps<{ surface: string; pasteTarget?: 'join' }>();
onMounted(() => emitColdUnlockStarted({ surface: props.surface }));

const isTouchPrimary = useIsTouchPrimary();

/**
 * Pull is mounted on DEMAND, not eagerly.
 *
 * `DeviceApprovalRequest` generates an ECDH keypair and starts a THREE-SECOND poll that
 * re-reads the whole family file, both in `onMounted`. Eagerly mounting it on a phone — where
 * pull is now the secondary route — burns a throwaway keypair and inflates the
 * `device_approval_requested` denominator on every view of this screen, on top of the
 * bandwidth.
 */
const showCode = ref(!isTouchPrimary.value);

/**
 * ⚠️ THE PARENT OWNS THE REMOUNT KEY. `DeviceApprovalRequest.retry()` used to be
 * `window.location.reload()`, which behind a disclosure would drop the user back here with
 * the section shut — "show a new one" doing visibly the opposite of what it says. A
 * component cannot key itself, so it emits and this counter remounts it.
 */
const codeGeneration = ref(0);

const capture = useQrCapture({
  origin: 'cold-entry',
  expect: 'invite',
  onScanned: (result) => {
    if (result.kind !== 'invite') return;
    // The decoded string is a full invite / sign-in link, and `useBeaniesLinkSubmit` is
    // already its complete consumer — scheme normalisation, the hash-routed form, and the
    // nine-key query reconstruction. Re-implementing any of that here would be a second copy.
    if (submitLink(result.url)) {
      emit('paste-submitted');
      return;
    }
    // `classifyBeaniesQr` said it was one of ours, but the link does not parse — a truncated
    // QR, or a marketing-site code. The extraction kept this boolean contract precisely so
    // the camera path could not fall silent the way a bare `if` would make it.
    capture.error.value = t('magicLink.pasteUnparseable');
  },
});
const { submit: submitLink } = useBeaniesLinkSubmit();

/** Ordered so the numerals are derived, never hand-written text nodes. */
const pushSteps = computed(() => [t('coldEntry.pushStep1'), t('coldEntry.pushStep2')]);
</script>

<template>
  <div
    class="dark:border-line dark:bg-surface-raised rounded-3xl border border-gray-200 bg-white p-5 shadow-[var(--card-shadow)]"
  >
    <h3 class="font-outfit dark:text-ink text-center text-base font-semibold text-gray-900">
      {{ isTouchPrimary && !showCode ? t('coldEntry.pushTitle') : t('coldEntry.scanTitle') }}
    </h3>
    <p class="dark:text-ink-soft mt-1 mb-4 text-center text-sm text-gray-600">
      {{ isTouchPrimary && !showCode ? t('coldEntry.pushLead') : t('coldEntry.scanLead') }}
    </p>

    <!-- PUSH, led on a device that has a camera. The in-app scan is the promoted route: it
         is the only entry point that establishes the person CHOSE to scan something, which
         is what lets the approval sheet skip its "did someone send you this?" check. -->
    <div v-if="isTouchPrimary && !showCode" class="space-y-3">
      <ol class="space-y-2">
        <li
          v-for="(step, i) in pushSteps"
          :key="step"
          class="dark:text-ink flex gap-3 text-sm text-gray-900"
        >
          <span
            class="dark:bg-surface-overlay dark:text-ink flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#AED6F1] text-xs font-bold text-[#234A63]"
            aria-hidden="true"
            >{{ i + 1 }}</span
          >
          <span>{{ step }}</span>
        </li>
      </ol>

      <BaseButton
        class="w-full"
        variant="secondary"
        type="button"
        :disabled="capture.isBusy.value"
        @click="capture.open()"
      >
        {{ capture.isBusy.value ? t('coldEntry.scanning') : t('coldEntry.openCamera') }}
      </BaseButton>
      <input
        :ref="(el) => (capture.inputRef.value = el as HTMLInputElement)"
        v-bind="capture.bindings"
      />
      <p
        v-if="capture.error.value"
        role="alert"
        class="dark:text-danger-lift text-center text-sm text-red-600"
      >
        {{ capture.error.value }}
      </p>

      <button
        type="button"
        class="dark:text-ink-soft w-full text-center text-sm text-gray-600 underline"
        @click="showCode = true"
      >
        {{ t('coldEntry.showMyCode') }}
      </button>
    </div>

    <!-- PULL. Mounted only when it is the led direction or the user asked for it, because
         mounting it starts a 3s whole-file poll and mints a keypair. -->
    <div v-else class="space-y-3">
      <DeviceApprovalRequest
        :key="codeGeneration"
        @approved="emit('approved')"
        @retry="codeGeneration += 1"
      />
      <button
        v-if="isTouchPrimary"
        type="button"
        class="dark:text-ink-soft w-full text-center text-sm text-gray-600 underline"
        @click="showCode = false"
      >
        {{ t('coldEntry.scanInstead') }}
      </button>
    </div>

    <div class="my-4 flex items-center gap-3">
      <span class="dark:border-line h-px flex-1 border-t border-gray-200" />
      <span class="dark:text-ink-faint text-xs text-gray-500">{{ t('coldEntry.or') }}</span>
      <span class="dark:border-line h-px flex-1 border-t border-gray-200" />
    </div>

    <!--
      The paste fallback stays, and stays visible: someone who was SENT a link is holding a
      credential, and the screen they land on must let them use it.
    -->
    <PasteLinkPanel @submitted="emit('paste-submitted')" />
  </div>
</template>
