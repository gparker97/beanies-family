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
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { BaseButton } from '@/components/ui';
import PasswordModal from '@/components/common/PasswordModal.vue';
import {
  authenticateWithPasskey,
  resolveDeviceKeys,
  MEMBER_MISMATCH,
} from '@/services/auth/passkeyService';
import PinInput from '@/components/ui/PinInput.vue';
import StatusPill from '@/components/ui/StatusPill.vue';
import PinKeypad from '@/components/ui/PinKeypad.vue';
import { usePinPad } from '@/composables/usePinPad';
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
  /**
   * Draw an on-screen keypad instead of relying on the OS keyboard.
   *
   * ⚠️ A PROP, NOT `useIsTouchPrimary()` COMPUTED HERE. This component has three hosts and
   * one of them is the beanie wall (`WallLockMenu`), where a docked tablet can report a
   * fine pointer — exactly the case the pointer query gets wrong. The host knows; this
   * component does not.
   */
  keypad?: boolean;
  /** What the in-progress line says while the biometric check runs. */
  passkeyWaitingKey?: UIStringKey;
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
/**
 * The pad is busy only with its OWN work. The shared `isVerifying` is also set by a
 * biometric check, and gating the pad on it opened a dead pad when "Use PIN instead?" was
 * tapped mid-check.
 */
const pinBusy = computed(() => isVerifying.value && !passkeyInFlight.value);
// Password step-up survives ONLY for legacy members who haven't set a PIN yet —
// once a PIN exists it is the memorable step-up, password entry stops appearing.
const hasPassword = computed(() => !!props.member.passwordHash && !props.member.pinHash);

// PIN step-up state
const pinValue = ref('');
const pinError = ref<string | null>(null);

/** On-screen keypad wiring, shared with the wall and the login PIN entry. */
const pad = usePinPad(pinValue, { onClearError: () => (pinError.value = null) });
/**
 * Whether the PIN pad is on screen rather than behind the "Sign in with PIN" button.
 *
 * ⚠️ That button is a METHOD CHOOSER, and it only earns its place when there is a choice.
 * Biometric step-up is native-only (the web WebAuthn+PRF path is retired), so on web
 * `passkeyAvailable` is always false and every caller of this gate — transfer ownership,
 * remove a member, reset another member's credentials, clear all data — was asking the user
 * to pick from a list of one before it would show them the pad. `openWhenSoleMethod()`
 * below flips it as soon as detection settles and the PIN turns out to be the only way in.
 */
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
    pinError.value = t('reauth.verifyFailed');
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

/**
 * Show the pad immediately when the PIN is the only way to prove.
 *
 * Deliberately called only after `detectPasskey()` settles: flipping it eagerly would
 * briefly show the pad and then have a biometric button appear above it on native, which
 * reads as the screen changing its mind. `hasPassword` is `passwordHash && !pinHash`, so a
 * member with a PIN never also has the password branch — the condition is genuinely
 * "PIN, and nothing else".
 */
function openWhenSoleMethod(): void {
  if (hasPin.value && !passkeyAvailable.value) showPinEntry.value = true;
}

/**
 * Biometric is the DEFAULT, so it starts by itself (greg, 2026-09-23): there is no "which
 * method?" screen any more. Once per opening — a person who cancels the OS prompt gets a
 * retry button and "Use PIN instead?" rather than the prompt reappearing on its own.
 */
const autoPasskeyTried = ref(false);
/**
 * A biometric check is in flight — its OWN flag, not `isVerifying`, which a password or PIN
 * check also sets and which would otherwise show "checking your passkey" during those.
 */
const passkeyInFlight = ref(false);
/**
 * False once unmounted. Detection awaits the keystore, and an unmounted component keeps its
 * last props (`open` still true) — without this a late detection would raise the OS
 * biometric prompt after the host had already taken the challenge away.
 */
let alive = true;
onUnmounted(() => {
  alive = false;
});
function startPasskeyIfDefault(): void {
  // Never after the person chose the PIN: detection can settle late, and a biometric prompt
  // appearing over the pad they picked is the screen overruling them.
  if (
    !alive ||
    !passkeyAvailable.value ||
    autoPasskeyTried.value ||
    showPinEntry.value ||
    !props.open
  ) {
    return;
  }
  autoPasskeyTried.value = true;
  void tryPasskey();
}

async function detectPasskey() {
  // Phase 4: biometric step-up is NATIVE-only (the web WebAuthn+PRF path is retired).
  if (!isNative() || !authStore.currentUser?.familyId) {
    passkeyAvailable.value = false;
    openWhenSoleMethod();
    return;
  }
  try {
    // Per MEMBER, not per family. `tryPasskey` names `props.member.id`, which native treats
    // as a hard selector — so a family-level check offers a button that returns
    // MEMBER_MISMATCH with no prompt at all, i.e. a control guaranteed to fail, while
    // hiding the password guidance the user actually needs.
    const deviceKeys = await resolveDeviceKeys(authStore.currentUser.familyId);
    passkeyAvailable.value = deviceKeys.some((k) => k.memberId === props.member.id);
    openWhenSoleMethod();
    startPasskeyIfDefault();
  } catch (e) {
    // Detection failure is non-fatal — fall back to password-only UX.
    passkeyAvailable.value = false;
    openWhenSoleMethod();
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
      showPinEntry.value = false;
      autoPasskeyTried.value = false;
      // Re-derived by detection; a stale `true` from the last opening would show a retry
      // button that races the auto-start into two concurrent biometric calls.
      passkeyAvailable.value = false;
      detectPasskey();
    }
  }
);

onMounted(() => {
  if (props.open) detectPasskey();
});

async function tryPasskey() {
  if (!authStore.currentUser?.familyId) {
    inlineError.value = t('reauth.sessionMissing');
    reportError({
      surface: 'reauthChallenge.tryPasskey',
      message: 'No familyId on session — cannot run passkey challenge',
    });
    return;
  }

  // One biometric call at a time: a manual retry and the auto-start must never overlap.
  if (passkeyInFlight.value) return;
  isVerifying.value = true;
  passkeyInFlight.value = true;
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
      inlineError.value = t('reauth.wrongMember');
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
    inlineError.value = result.error ?? t('reauth.passkeyFailed');
    reportError({
      surface: 'reauthChallenge.tryPasskey',
      message: 'Passkey authentication failed',
      // `error` is likewise not allowlisted; `detail` is.
      context: { detail: result.error?.slice(0, 200) },
    });
  } catch (e) {
    inlineError.value = t('reauth.passkeyFailed');
    reportError({
      surface: 'reauthChallenge.tryPasskey',
      message: 'Passkey authentication threw',
      error: e,
    });
  } finally {
    isVerifying.value = false;
    passkeyInFlight.value = false;
  }
}

function openPassword() {
  passwordError.value = null;
  passwordOpen.value = true;
}

async function handlePasswordConfirm(entered: string) {
  if (!props.member.passwordHash) {
    // Should be unreachable — UI gates the password option behind hasPassword.
    passwordError.value = t('reauth.noPassword');
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
      passwordError.value = t('reauth.wrongPassword');
    }
  } catch (e) {
    passwordError.value = t('reauth.verifyFailed');
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
    <p class="dark:text-ink-soft text-sm text-gray-600">
      {{ t(props.descriptionKey ?? 'reauth.description') }}
    </p>

    <!-- No-credential state — clear recovery guidance -->
    <div
      v-if="noCredential"
      class="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20"
      data-testid="reauth-no-credential"
    >
      <p class="dark:text-terracotta-lift text-sm text-amber-800">
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
      <!-- Biometric in progress, or ready to retry after the person cancelled the OS prompt.
           Hidden once they chose the PIN, so the pad is the only thing asking for input. -->
      <div v-if="passkeyAvailable && !showPinEntry" class="text-center">
        <StatusPill
          v-if="passkeyInFlight"
          :text="t(props.passkeyWaitingKey ?? 'reauth.passkeyWaiting')"
        />
        <BaseButton v-else variant="primary" class="w-full" @click="tryPasskey">
          🔐 {{ t('reauth.passkeyButton') }}
        </BaseButton>
      </div>

      <div v-if="hasPin && showPinEntry" class="space-y-2">
        <p class="dark:text-ink-soft text-center text-sm font-medium text-gray-600">
          {{ t('pin.enterPin') }}
        </p>
        <PinInput
          v-model="pinValue"
          :has-error="!!pinError"
          :disabled="pinBusy || pinLimit.inCooldown.value"
          :keypad="keypad"
          autofocus
          :label="t('pin.enterPin')"
          @complete="handlePinComplete"
        />
        <PinKeypad
          v-if="keypad"
          :disabled="pinBusy || pinLimit.inCooldown.value"
          @digit="pad.press"
          @backspace="pad.backspace"
        />
        <p
          v-if="pinError"
          class="dark:text-danger-lift text-center text-sm text-red-600"
          role="alert"
        >
          <!-- Live-counting while the cooldown runs, so the wait is visibly finite. -->
          {{
            pinLimit.inCooldown.value
              ? fillTemplate(t('pin.tooManyAttempts'), { seconds: pinLimit.cooldownSeconds.value })
              : pinError
          }}
        </p>
      </div>
      <!-- Only reachable when biometric is the default: a PIN-only member has the pad open
           already (`openWhenSoleMethod`). Enabled even mid-check, so the way out is always
           one tap. -->
      <BaseButton v-else-if="hasPin" variant="outline" class="w-full" @click="showPinEntry = true">
        {{ passkeyAvailable ? t('pin.useInstead') : t('pin.signInWithPin') }}
      </BaseButton>

      <BaseButton
        v-if="hasPassword"
        :variant="passkeyAvailable ? 'ghost' : 'primary'"
        :disabled="isVerifying"
        class="w-full"
        @click="openPassword"
      >
        🔑 {{ t('reauth.passwordButton') }}
      </BaseButton>

      <div v-if="inlineError" class="rounded-lg bg-red-50 p-3 dark:bg-red-900/20">
        <p class="dark:text-danger-lift text-sm text-red-600">{{ inlineError }}</p>
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
      :title="t('reauth.title')"
      :description="t('reauth.passwordDescription')"
      :confirm-label="t('reauth.verifyButton')"
      :external-error="passwordError"
      @confirm="handlePasswordConfirm"
      @close="handlePasswordClose"
    />
  </div>
</template>
