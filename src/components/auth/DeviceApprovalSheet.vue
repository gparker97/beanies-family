<script setup lang="ts">
/**
 * The approver's half: "a device is asking to open your beanpod — is that you?"
 *
 * Reached by scanning the cold device's code with the phone's own camera app, which opens
 * the deep link and lands here. There is no in-app scanner anywhere in this flow, which is
 * deliberate: the repo has no `getUserMedia` at all, and Android intentionally does not
 * declare `android.permission.CAMERA` so Capacitor can skip the runtime prompt. Reusing the
 * OS camera keeps all of that true.
 *
 * ⚠️ APPROVE AND REJECT ARE EQUALLY WEIGHTED. A one-sided approval sheet trains people to
 * tap the bright button, which is precisely the habit an attacker needs. Both actions are
 * full-width and equally reachable.
 *
 * ⚠️ REJECT IS NOT RED. Under the CIG red is for destructive confirmations — deleting,
 * leaving — not for declining. Declining is the safe outcome here, and colouring it as
 * danger would teach exactly the wrong reflex.
 */
import { computed, ref, watch } from 'vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import { useSyncStore } from '@/stores/syncStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
import { toISODateString } from '@/utils/date';
import {
  readApprovalRequest,
  wrapForApproval,
  APPROVAL_EXPIRY_MS,
  type ScannedApproval,
} from '@/services/crypto/deviceApproval';
import { emitDeviceApprovalOutcome } from '@/services/telemetry/loginFlowEvents';
import { requireReauth } from '@/composables/useReauth';
import { reportError } from '@/utils/errorReporter';

const props = defineProps<{
  open: boolean;
  /** base64url SPKI from the scanned deep link. */
  publicKey: string;
}>();
const emit = defineEmits<{ close: [] }>();

const { t } = useTranslation();
const syncStore = useSyncStore();
const familyStore = useFamilyStore();
const familyContextStore = useFamilyContextStore();

/**
 * Can this session actually approve anything?
 *
 * ⚠️ CHECKED UP FRONT, not at the approve tap. On an iOS home-screen PWA the camera opens
 * the link in SAFARI, which has completely separate IndexedDB and localStorage from the
 * installed app — so the sheet can open over a signed-out session. Discovering that only
 * after the person has compared a fingerprint and tapped "Yes, let it in" is the worst
 * possible moment to tell them, and the old copy (`recovery.podNotOpen`) did not explain
 * that the app they want is the one on their home screen.
 */
const canApprove = computed(() => !!syncStore.familyKey && !!familyStore.currentMember?.id);

const scanned = ref<ScannedApproval | null>(null);
/**
 * Generation guard for the async watcher below.
 *
 * `readApprovalRequest` is `importKey` + `digest`, two independent async crypto ops with no
 * ordering guarantee. Without this, a sheet closed and reopened on a second scanned code
 * could have run 1 settle last and assign device A's `ScannedApproval` over device B's —
 * so the sheet would show A's fingerprint, which does not match the screen in front of the
 * user, and `approve()` would wrap the family key to a device they never meant to admit.
 * The fingerprint comparison is the only defence against exactly that, and the app must not
 * be the thing that defeats it.
 */
let readGeneration = 0;
const isApproving = ref(false);
const errorKey = ref<string | null>(null);
const done = ref(false);

const prompt = () =>
  fillTemplate(t('deviceApproval.prompt'), {
    // The name is substituted WHOLE, so the fallback carries its own noun.
    family: familyContextStore.activeFamilyName
      ? `the ${familyContextStore.activeFamilyName} beanpod`
      : t('deviceApproval.yourFamily'),
  });

watch(
  () => [props.open, props.publicKey] as const,
  async ([open, publicKey]) => {
    scanned.value = null;
    errorKey.value = null;
    done.value = false;
    if (!open || !publicKey) return;
    const generation = ++readGeneration;
    try {
      const result = await readApprovalRequest(publicKey);
      if (generation !== readGeneration) return; // superseded — drop it
      scanned.value = result;
    } catch (e) {
      if (generation !== readGeneration) return;
      // Not a beanies approval code, or a mangled one. Same user-facing answer either way.
      errorKey.value = 'deviceApproval.badCode';
      reportError({
        surface: 'login-flow',
        message: 'device approval code could not be read',
        severity: 'warning',
        error: e,
        context: { action: 'device_approval_bad_code' },
      });
    }
  },
  { immediate: true }
);

async function approve(): Promise<void> {
  const req = scanned.value;
  const familyKey = syncStore.familyKey;
  const memberId = familyStore.currentMember?.id;
  if (!req || isApproving.value) return;

  if (!familyKey || !memberId) {
    errorKey.value = 'recovery.podNotOpen';
    emitDeviceApprovalOutcome({ outcome: 'failed', errorCode: 'no_family_key' });
    return;
  }

  isApproving.value = true;
  errorKey.value = null;
  try {
    // ⚠️ SAME BAR AS MINTING A CODE. "Sign in another device" asks for the PIN before it
    // will show one; approving a device hands over the identical thing — the family key,
    // wrapped for someone else's device — so it asks too. The inconsistency was the real
    // defect here: same consequence, same product, two different answers. It also covers
    // the ordinary family case that has nothing to do with strangers, which is a phone left
    // unlocked on a table.
    const proved = await requireReauth({
      titleKey: 'deviceApproval.title',
      reasonKey: 'deviceApproval.pinReason',
    });
    if (!proved) {
      emitDeviceApprovalOutcome({ outcome: 'rejected', errorCode: 'gate_declined' });
      emit('close');
      return;
    }

    const wrap = await wrapForApproval(familyKey, req);

    // Monotonic, for the same reason every other replaced entry is: `pickNewerByCreatedAt`
    // resolves an exact tie to the incoming side, so a second approval in the same
    // millisecond — or one from a device whose clock is behind — could lose the merge.
    const prev = syncStore.deviceApprovalCreatedAt(memberId);
    const prevMs = prev ? new Date(prev).getTime() : NaN;
    const createdAt = toISODateString(
      new Date(Number.isFinite(prevMs) ? Math.max(Date.now(), prevMs + 1) : Date.now())
    );

    const published = await syncStore.setDeviceApprovalWrap(memberId, {
      ...wrap,
      createdAt,
      expiresAt: toISODateString(new Date(Date.now() + APPROVAL_EXPIRY_MS)),
    });
    if (!published) {
      // The other device polls the FILE. A wrap that never landed is a screen that waits
      // out its whole window for nothing, so this must never be reported as success.
      errorKey.value = 'deviceApproval.publishFailed';
      emitDeviceApprovalOutcome({ outcome: 'failed', errorCode: 'publish-failed' });
      return;
    }
    done.value = true;
    // The cold device emits the `ok` outcome when it actually gets in; this side only
    // knows the wrap was published, which is not the same event.
  } catch (e) {
    errorKey.value = 'deviceApproval.failed';
    emitDeviceApprovalOutcome({ outcome: 'failed', errorCode: 'approve-threw' });
    reportError({
      surface: 'login-flow',
      message: 'device approval wrap failed',
      severity: 'error',
      error: e,
      context: { action: 'device_approval_failed' },
    });
  } finally {
    isApproving.value = false;
  }
}

function reject(): void {
  emitDeviceApprovalOutcome({ outcome: 'rejected' });
  emit('close');
}
</script>

<template>
  <BaseModal :open="open" :title="t('deviceApproval.title')" size="md" @close="emit('close')">
    <div v-if="done" class="space-y-3 text-center" data-testid="approval-done">
      <p class="dark:text-ink text-base font-semibold text-gray-900">
        {{ t('deviceApproval.doneTitle') }}
      </p>
      <p class="dark:text-ink-soft text-sm text-gray-600">{{ t('deviceApproval.doneBody') }}</p>
      <BaseButton class="w-full" variant="secondary" type="button" @click="emit('close')">
        {{ t('action.done') }}
      </BaseButton>
    </div>

    <!-- Signed out here (typically Safari, opened by the camera, beside an installed PWA
         that holds the actual session). Say so before any fingerprint is compared. -->
    <div v-else-if="!canApprove" class="space-y-3 text-center" data-testid="approval-signed-out">
      <p class="dark:text-ink text-base font-semibold text-gray-900">
        {{ t('deviceApproval.signedOutTitle') }}
      </p>
      <p class="dark:text-ink-soft text-sm text-gray-600">
        {{ t('deviceApproval.signedOutBody') }}
      </p>
      <BaseButton class="w-full" variant="secondary" type="button" @click="emit('close')">
        {{ t('action.close') }}
      </BaseButton>
    </div>

    <div v-else-if="scanned" class="space-y-4 text-center">
      <p class="dark:text-ink-soft text-sm text-gray-600">{{ prompt() }}</p>

      <div>
        <p
          class="font-outfit dark:text-ink dark:bg-surface-overlay inline-block rounded-xl bg-gray-50 px-3 py-1.5 text-lg font-bold tracking-[0.22em] text-gray-900"
          data-testid="approver-fingerprint"
        >
          {{ scanned.fingerprint }}
        </p>
        <p class="dark:text-ink-faint mt-2 text-xs text-gray-500">
          {{ t('deviceApproval.compareOnBoth') }}
        </p>
      </div>

      <!-- Equal weight, both full width. See the header comment. -->
      <div class="space-y-2">
        <BaseButton
          class="w-full"
          variant="primary"
          type="button"
          :loading="isApproving"
          data-testid="approval-approve"
          @click="approve"
        >
          {{ t('deviceApproval.approve') }}
        </BaseButton>
        <BaseButton
          class="w-full"
          variant="outline"
          type="button"
          :disabled="isApproving"
          data-testid="approval-reject"
          @click="reject"
        >
          {{ t('deviceApproval.reject') }}
        </BaseButton>
      </div>
    </div>

    <p v-if="errorKey" role="alert" class="dark:text-danger-lift mt-3 text-sm text-red-600">
      {{ t(errorKey as never) }}
    </p>
  </BaseModal>
</template>
