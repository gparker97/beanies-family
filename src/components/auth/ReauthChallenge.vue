<script setup lang="ts">
/**
 * Re-authentication challenge — verifies that the user holding the
 * current session is who they claim to be. Used as a guard before
 * high-stakes operations (transfer ownership, future: delete pod, leave
 * pod, change family name, etc.).
 *
 * Phase 4 order: native biometric (when enrolled on this device) → member PIN
 * (the standard step-up — doc-synced, every claimed member has one) → password
 * (LEGACY members without a PIN only). Cancellation drops back to the choice
 * screen (so the user can switch methods); a real failure surfaces an inline
 * error and reports it.
 *
 * Renders as a content panel — does NOT wrap itself in a modal. The
 * caller is responsible for the host modal/overlay. The only modal this
 * component opens is the password sub-flow, on top of the host.
 */
import { ref, computed, watch, onMounted } from 'vue';
import { BaseButton } from '@/components/ui';
import PasswordModal from '@/components/common/PasswordModal.vue';
import {
  authenticateWithPasskey,
  resolveDeviceKeys,
  MEMBER_MISMATCH,
} from '@/services/auth/passkeyService';
import PinInput from '@/components/ui/PinInput.vue';
import { isNative } from '@/services/sync/capabilities';
import { verifyPassword } from '@/services/auth/passwordService';
import { usePinAttemptLimit, PIN_COOLDOWN_MS } from '@/composables/usePinAttemptLimit';
import { fillTemplate } from '@/utils/fillTemplate';
import { useTranslation } from '@/composables/useTranslation';
import { useAuthStore } from '@/stores/authStore';
import { reportError } from '@/utils/errorReporter';
import type { FamilyMember } from '@/types/models';
import type { UIStringKey } from '@/services/translation/uiStrings';

const props = defineProps<{
  /** Member whose identity must be verified (typically the current session user). */
  member: FamilyMember;
  /** Whether the host is showing the challenge — drives passkey-availability detection. */
  open: boolean;
  /**
   * Copy overrides, as translation KEYS rather than sentences (#80) — the component keeps
   * calling `t()` itself, so the text follows a language change and the `UIStringKey`
   * convention that useConfirm and BaseModal already follow is preserved.
   *
   * They exist because this component is no longer transfer-ownership-only: the default
   * copy is action-neutral, and TransferOwnership passes its own wording to stay identical.
   */
  descriptionKey?: UIStringKey;
  noCredentialKey?: UIStringKey;
}>();

const emit = defineEmits<{
  verified: [];
  /**
   * `reason` distinguishes a user changing their mind from a member who has NO way to
   * prove who they are. Without it the caller records both as an ordinary cancel, so a
   * member permanently locked out of an action is indistinguishable in the firehose from
   * one who simply tapped away.
   */
  cancelled: [reason?: 'no-credential'];
}>();

const { t } = useTranslation();
const authStore = useAuthStore();

const passkeyAvailable = ref(false);
const isVerifying = ref(false);
const passwordOpen = ref(false);
const passwordError = ref<string | null>(null);
const inlineError = ref<string | null>(null);

const hasPin = computed(() => !!props.member.pinHash);
// Password step-up survives ONLY for legacy members who haven't set a PIN yet —
// once a PIN exists it is the memorable step-up, password entry stops appearing.
const hasPassword = computed(() => !!props.member.passwordHash && !props.member.pinHash);

// PIN step-up state
const pinValue = ref('');
const pinError = ref<string | null>(null);
const showPinEntry = ref(false);

/**
 * Brute-force limit on the step-up PIN.
 *
 * `useReauth` calls this challenge "the actual security boundary of #80" — it is the one
 * control between a forged or borrowed session and transfer-ownership, remove-member,
 * reset-another-member's-PIN and clear-all-data. It nonetheless verified a six-digit PIN
 * with no attempt counter, no cooldown and no failure telemetry, while `deviceUnlock` and
 * the far less critical wall pad both enforced one (#80 review).
 *
 * Scoped PER MEMBER so the budget cannot be reset by closing the challenge, switching
 * target and coming back; module-scoped so unmounting cannot reset it either.
 */
const pinLimit = usePinAttemptLimit(
  computed(() => `reauth:${props.member.id}`),
  'reauth-challenge',
  'reauth'
);

async function handlePinComplete(pin: string) {
  if (!props.member.pinHash) return;
  if (pinLimit.inCooldown.value) {
    pinValue.value = '';
    pinError.value = fillTemplate(t('pin.tooManyAttempts'), {
      seconds: pinLimit.cooldownSeconds.value,
    });
    return;
  }
  isVerifying.value = true;
  pinError.value = null;
  try {
    const ok = await verifyPassword(pin, props.member.pinHash);
    if (ok) {
      pinLimit.recordSuccess();
      emit('verified');
    } else {
      pinValue.value = '';
      // `recordFailure` counts, persists and emits the telemetry; this only picks wording.
      pinError.value = pinLimit.recordFailure()
        ? fillTemplate(t('pin.tooManyAttempts'), { seconds: PIN_COOLDOWN_MS / 1000 })
        : t('pin.incorrect');
    }
  } catch (e) {
    pinError.value = t('transferOwnership.reauthPasskeyFailed');
    reportError({
      surface: 'reauthChallenge.handlePinComplete',
      message: 'PIN verify threw during re-auth',
      error: e,
    });
  } finally {
    isVerifying.value = false;
  }
}

/** Final fallback: no biometric, no PIN, no password — user can't re-auth. */
const noCredential = computed(() => !passkeyAvailable.value && !hasPin.value && !hasPassword.value);

async function detectPasskey() {
  // Phase 4: biometric step-up is NATIVE-only (the web WebAuthn+PRF path is retired).
  if (!isNative() || !authStore.currentUser?.familyId) {
    passkeyAvailable.value = false;
    return;
  }
  try {
    // Per MEMBER, not per family. `tryPasskey` names `props.member.id`, which native treats
    // as a hard selector — so a family-level check offers a button that returns
    // MEMBER_MISMATCH with no prompt at all, i.e. a control guaranteed to fail, while
    // hiding the password guidance the user actually needs.
    const deviceKeys = await resolveDeviceKeys(authStore.currentUser.familyId);
    passkeyAvailable.value = deviceKeys.some((k) => k.memberId === props.member.id);
  } catch (e) {
    // Detection failure is non-fatal — fall back to password-only UX.
    passkeyAvailable.value = false;
    reportError({
      surface: 'reauthChallenge.detectPasskey',
      message: 'Failed to detect passkey availability — defaulting to password-only',
      error: e,
    });
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      inlineError.value = null;
      passwordError.value = null;
      detectPasskey();
    }
  }
);

onMounted(() => {
  if (props.open) detectPasskey();
});

async function tryPasskey() {
  if (!authStore.currentUser?.familyId) {
    inlineError.value = t('transferOwnership.reauthSessionMissing');
    reportError({
      surface: 'reauthChallenge.tryPasskey',
      message: 'No familyId on session — cannot run passkey challenge',
    });
    return;
  }

  isVerifying.value = true;
  inlineError.value = null;
  try {
    // Naming the member turns this from "prompt, then discover it was the wrong person"
    // into "select that member's key, or don't prompt at all" — on native the keystore
    // item is addressed per member, so a member with no key here costs zero prompts.
    const result = await authenticateWithPasskey({
      familyId: authStore.currentUser.familyId,
      memberId: props.member.id,
    });
    if (result.success) {
      // The service compares the resolved member against the one we asked for, so a
      // success here IS the right member. The two hand-written comparisons this
      // replaced were the drift the MEMBER_MISMATCH sentinel exists to remove.
      emit('verified');
      return;
    }
    if (result.cancelled) {
      // Established noise pattern — silent drop back to the choice screen.
      return;
    }
    if (result.error === MEMBER_MISMATCH) {
      inlineError.value = t('transferOwnership.reauthWrongMember');
      // Native biometric is DEVICE-scoped: it unlocks as the member who enrolled on
      // this device, so a mismatch with the target member is EXPECTED, not an
      // anomaly. Don't page/telemetry it — just guide to password. (Web WebAuthn can
      // pick a specific credential, so a mismatch there IS worth a warning.)
      if (!isNative()) {
        reportError({
          surface: 'reauthChallenge.tryPasskey',
          message: 'Passkey authenticated a different member than expected',
          severity: 'warning',
          // `expected`/`got` are NOT in ALLOWED_CONTEXT_KEYS, so every one of these
          // events has arrived contextless since the day it was written. `member_id_tail`
          // is the allowlisted form and matches the password-rotation surfaces.
          context: { member_id_tail: props.member.id.slice(-8) },
        });
      }
      return;
    }
    // Generic failure — surface the message inline.
    inlineError.value = result.error ?? t('transferOwnership.reauthPasskeyFailed');
    reportError({
      surface: 'reauthChallenge.tryPasskey',
      message: 'Passkey authentication failed',
      // `error` is likewise not allowlisted; `detail` is.
      context: { detail: result.error?.slice(0, 200) },
    });
  } catch (e) {
    inlineError.value = t('transferOwnership.reauthPasskeyFailed');
    reportError({
      surface: 'reauthChallenge.tryPasskey',
      message: 'Passkey authentication threw',
      error: e,
    });
  } finally {
    isVerifying.value = false;
  }
}

function openPassword() {
  passwordError.value = null;
  passwordOpen.value = true;
}

async function handlePasswordConfirm(entered: string) {
  if (!props.member.passwordHash) {
    // Should be unreachable — UI gates the password option behind hasPassword.
    passwordError.value = t('transferOwnership.reauthNoPassword');
    reportError({
      surface: 'reauthChallenge.handlePasswordConfirm',
      message: 'Password modal opened for member with no passwordHash',
      severity: 'warning',
      // `memberId` is not allowlisted (and would ship a full UUID); `member_id_tail` is.
      context: { member_id_tail: props.member.id.slice(-8) },
    });
    return;
  }
  isVerifying.value = true;
  passwordError.value = null;
  try {
    const ok = await verifyPassword(entered, props.member.passwordHash);
    if (ok) {
      passwordOpen.value = false;
      emit('verified');
    } else {
      passwordError.value = t('transferOwnership.reauthWrongPassword');
    }
  } catch (e) {
    passwordError.value = t('transferOwnership.reauthPasskeyFailed');
    reportError({
      surface: 'reauthChallenge.handlePasswordConfirm',
      message: 'verifyPassword threw',
      error: e,
    });
  } finally {
    isVerifying.value = false;
  }
}

function handlePasswordClose() {
  passwordOpen.value = false;
  // Closing the password modal returns to the choice screen — caller
  // can listen for a separate cancellation if they want to abort the
  // outer flow. We don't emit('cancelled') here because the user may
  // simply want to switch to the passkey path.
}

function cancel() {
  emit('cancelled', noCredential.value ? 'no-credential' : undefined);
}
</script>

<template>
  <div class="space-y-4">
    <!-- Description -->
    <p class="text-sm text-gray-600 dark:text-gray-400">
      {{ t(props.descriptionKey ?? 'reauth.description') }}
    </p>

    <!-- No-credential state — clear recovery guidance -->
    <div
      v-if="noCredential"
      class="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20"
      data-testid="reauth-no-credential"
    >
      <p class="text-sm text-amber-800 dark:text-amber-200">
        {{ t(props.noCredentialKey ?? 'reauth.noCredential') }}
      </p>
      <div class="mt-3 flex justify-end">
        <BaseButton variant="ghost" size="sm" @click="cancel">
          {{ t('action.close') }}
        </BaseButton>
      </div>
    </div>

    <!-- Choice: passkey first, then password -->
    <div v-else class="space-y-3">
      <BaseButton
        v-if="passkeyAvailable"
        variant="primary"
        :disabled="isVerifying"
        class="w-full"
        @click="tryPasskey"
      >
        🔐 {{ t('transferOwnership.reauthPasskeyButton') }}
      </BaseButton>

      <div v-if="hasPin && showPinEntry" class="space-y-2">
        <p class="text-center text-sm font-medium text-gray-600 dark:text-gray-400">
          {{ t('pin.enterPin') }}
        </p>
        <PinInput
          v-model="pinValue"
          :has-error="!!pinError"
          :disabled="isVerifying || pinLimit.inCooldown.value"
          autofocus
          :label="t('pin.enterPin')"
          @complete="handlePinComplete"
        />
        <p v-if="pinError" class="text-center text-sm text-red-600 dark:text-red-400" role="alert">
          <!-- Live-counting while the cooldown runs, so the wait is visibly finite. -->
          {{
            pinLimit.inCooldown.value
              ? fillTemplate(t('pin.tooManyAttempts'), { seconds: pinLimit.cooldownSeconds.value })
              : pinError
          }}
        </p>
      </div>
      <BaseButton
        v-else-if="hasPin"
        :variant="passkeyAvailable ? 'ghost' : 'primary'"
        :disabled="isVerifying"
        class="w-full"
        @click="showPinEntry = true"
      >
        🔢 {{ t('pin.signInWithPin') }}
      </BaseButton>

      <BaseButton
        v-if="hasPassword"
        :variant="passkeyAvailable ? 'ghost' : 'primary'"
        :disabled="isVerifying"
        class="w-full"
        @click="openPassword"
      >
        🔑 {{ t('transferOwnership.reauthPasswordButton') }}
      </BaseButton>

      <div v-if="inlineError" class="rounded-lg bg-red-50 p-3 dark:bg-red-900/20">
        <p class="text-sm text-red-600 dark:text-red-400">{{ inlineError }}</p>
      </div>

      <div class="flex justify-end pt-2">
        <BaseButton variant="ghost" size="sm" :disabled="isVerifying" @click="cancel">
          {{ t('action.cancel') }}
        </BaseButton>
      </div>
    </div>

    <!-- Password sub-flow: PasswordModal handles its own input + submit lifecycle -->
    <PasswordModal
      :open="passwordOpen"
      :title="t('transferOwnership.reauthTitle')"
      :description="t('transferOwnership.reauthPasswordDescription')"
      :confirm-label="t('transferOwnership.reauthVerifyButton')"
      :external-error="passwordError"
      @confirm="handlePasswordConfirm"
      @close="handlePasswordClose"
    />
  </div>
</template>
