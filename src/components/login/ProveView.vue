<script setup lang="ts">
/**
 * The ONE prove screen (2026-08-28 login rethink) — renders `loginFlow`'s 'prove' state.
 *
 * Progressive disclosure (greg's local-test feedback): ONE method renders at a time —
 * the strongest available first — with quiet switch links for the others beneath it,
 * instead of stacking biometric + PIN + password in one column. Every offered method
 * stays one tap away, and the cold path carries a recovery-kit escape so a member who
 * has forgotten everything is never stranded. Pure renderer — outcomes emit up to the
 * flow driver; no store writes, no routing.
 */
import { ref, computed, watch, nextTick } from 'vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import PinInput from '@/components/ui/PinInput.vue';
import RecoveryKitLink from '@/components/login/RecoveryKitLink.vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import BeanieSpinner from '@/components/ui/BeanieSpinner.vue';
import { useTranslation } from '@/composables/useTranslation';
import { getMemberAvatarVariant } from '@/composables/useMemberAvatar';
import { fillTemplate } from '@/utils/fillTemplate';
import type { PersonCard } from '@/services/auth/loginFlow';
import type { ProveMethod } from '@/services/auth/proveMethods';
import type { UIStringKey } from '@/services/translation/uiStrings';

const props = defineProps<{
  familyName: string;
  person: PersonCard;
  methods: ProveMethod[];
  /** Error text owned by the flow driver (wrong password, mismatch, …). */
  error: string | null;
  isBusy: boolean;
  /** Whether the pod is already open — drives tap-through and passphrase-hint copy. */
  podOpen: boolean;
  /**
   * A family-level recovery secret opened the pod: identity is granted by possession,
   * so this screen offers SET-A-NEW-PIN instead of demanding forgotten credentials.
   */
  recoveryMode?: boolean;
  /** The staged envelope carries a recovery passphrase — hint it under the password. */
  hasPassphrase?: boolean;
}>();

const emit = defineEmits<{
  biometric: [];
  'tap-through': [];
  pin: [pin: string];
  password: [password: string];
  /** The user moved past an offered stronger method (telemetry). */
  'fell-back': [];
  /** Cold-path escape: redeem a recovery kit instead. */
  'use-recovery': [];
  /** Recovery mode: set a fresh PIN in place of the forgotten credentials. */
  'reset-pin': [pin: string];
  back: [];
}>();

const { t } = useTranslation();

type MethodKind = ProveMethod['kind'];
const offered = computed<MethodKind[]>(() => props.methods.map((m) => m.kind));

/**
 * The single method on screen. Starts at the strongest offered — except when the screen
 * mounts already carrying an error after a wrong-password round-trip (the machine
 * remounts this component), where the password form must stay up rather than collapsing
 * behind a link.
 */
type ActiveKind = MethodKind | 'reset-pin';
const firstNonRecovery = props.methods.find((m) => m.kind !== 'recovery')?.kind;
const activeMethod = ref<ActiveKind>(
  props.recoveryMode
    ? 'reset-pin'
    : props.error && props.methods.some((m) => m.kind === 'password')
      ? 'password'
      : (firstNonRecovery ?? 'recovery')
);
const resetPin = ref('');
const resetPinConfirm = ref('');

function handleResetPinSubmit() {
  localError.value = null;
  if (resetPin.value.length !== 6) {
    localError.value = t('pin.invalidFormat');
    return;
  }
  if (resetPin.value !== resetPinConfirm.value) {
    localError.value = t('pin.mismatch');
    return;
  }
  emit('reset-pin', resetPin.value);
}

const password = ref('');
const pinValue = ref('');
const localError = ref<string | null>(null);
const pinInputRef = ref<InstanceType<typeof PinInput> | null>(null);
/** One telemetry ping per screen, however many times the user switches down. */
let fellBackOnce = false;

const shownError = computed(() => localError.value ?? props.error);

/** A wrong PIN comes back via the error prop — clear the boxes and refocus in one motion. */
watch(
  () => props.error,
  async (e) => {
    if (e && activeMethod.value === 'pin') {
      pinValue.value = '';
      await nextTick();
      pinInputRef.value?.focus();
    }
  }
);

/** Focus follows the active method (greg: the PIN boxes must be ready to type into). */
watch(
  activeMethod,
  async (method) => {
    if (method === 'pin') {
      await nextTick();
      pinInputRef.value?.focus();
    }
  },
  { immediate: true }
);

function switchTo(method: ActiveKind) {
  localError.value = null;
  // Phase 4: 'recovery' is the terminal ESCAPE, not a pane — route straight out.
  if (method === 'recovery') {
    emit('use-recovery');
    return;
  }
  if (
    !fellBackOnce &&
    offered.value[0] &&
    method !== 'reset-pin' &&
    offered.value.indexOf(method) > 0
  ) {
    fellBackOnce = true;
    emit('fell-back');
  }
  activeMethod.value = method;
}

/**
 * Kinds that must NEVER render as a switch link. `switchLabel`'s `default` branch
 * returns "Use password", so a leak here shows a password affordance on a member who
 * has none — the reason this filter, not a `switchLabel` case, is the guard.
 */
const NON_SWITCHABLE: readonly ActiveKind[] = [
  // Renders as the standalone recovery-kit chip below (always visible, warm included).
  'recovery',
  // An explanation, not a choice — nothing for the user to switch TO (#79).
  'invite-needed',
];

/** The switch links: every offered method except the active one, in offer order. */
const switchTargets = computed<ActiveKind[]>(() => {
  const targets: ActiveKind[] = props.methods
    .filter((m) => m.kind !== activeMethod.value)
    .map((m) => m.kind)
    .filter((k) => !NON_SWITCHABLE.includes(k));
  if (props.recoveryMode && activeMethod.value !== 'reset-pin') targets.unshift('reset-pin');
  return targets;
});

/**
 * Panes that are just a centred paragraph — no input, no action. One map so a future
 * explanatory pane is one entry rather than another template branch. `recovery` and
 * `invite-needed` share ONLY this; everywhere else they behave differently (recovery is
 * an escape that routes out, invite-needed is a pane you land on), so do not merge them
 * into one "terminal" concept.
 */
const MESSAGE_ONLY_BODY: Partial<Record<ActiveKind, UIStringKey>> = {
  recovery: 'loginFlow.recoveryOnlyBody',
  'invite-needed': 'loginFlow.inviteNeededBody',
};
const messageOnlyBody = computed(() => {
  const key = MESSAGE_ONLY_BODY[activeMethod.value];
  return key ? t(key) : null;
});

function switchLabel(method: ActiveKind): string {
  switch (method) {
    case 'reset-pin':
      return t('recovery.resetPinTitle');
    case 'biometric':
      return t('passkey.signInButton');
    case 'pin':
      return t('pin.signInWithPin');
    case 'tap-through':
      return `${t('loginV6.signInAs')} ${props.person.name}`;
    case 'recovery':
      return t('recovery.useKitLink');
    default:
      return t('passkey.usePassword');
  }
}

function handleSubmit() {
  localError.value = null;
  if (!password.value) {
    localError.value = t('auth.enterPassword');
    return;
  }
  emit('password', password.value);
}
</script>

<template>
  <div class="mx-auto max-w-[480px] rounded-3xl bg-white p-8 shadow-xl dark:bg-slate-800">
    <!--
      Always "not you?", never a bare "back": every arrival here follows a person pick
      (or an auto-select), so this is the shared-device escape hatch. Disabled while a
      prove effect is in flight (an abandoned effect must not sign in a person the
      screen no longer shows).
    -->
    <button
      class="mb-4 flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700 disabled:opacity-40 dark:text-gray-400 dark:hover:text-gray-300"
      :disabled="isBusy"
      @click="emit('back')"
    >
      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
      </svg>
      {{ t('fastLogin.notYou') }}
    </button>

    <!-- Who + family context -->
    <div class="mb-6 text-center">
      <BeanieAvatar
        class="mx-auto mb-3"
        :variant="getMemberAvatarVariant(person)"
        :color="person.color"
        :photo-url="person.photoUrl ?? null"
        size="xl"
      />
      <h2 class="font-outfit text-xl font-bold text-gray-900 dark:text-gray-100">
        {{ fillTemplate(t('fastLogin.welcomeBackName'), { name: person.name }) }}
      </h2>
      <p v-if="familyName" class="mt-1 text-sm text-gray-500 dark:text-gray-400">
        {{ familyName }}
      </p>
    </div>

    <!-- Error -->
    <div
      v-if="shownError"
      role="alert"
      class="mb-4 rounded-xl bg-red-50 p-3 text-center text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400"
    >
      {{ shownError }}
    </div>

    <div class="space-y-4">
      <!-- ONE active method at a time -->

      <!-- Recovery mode: set a fresh PIN (identity granted by the family recovery secret) -->
      <form
        v-if="activeMethod === 'reset-pin'"
        class="space-y-4"
        @submit.prevent="handleResetPinSubmit"
      >
        <p class="text-center text-sm text-gray-600 dark:text-gray-400">
          {{ t('recovery.resetPinBody') }}
        </p>
        <div>
          <p class="mb-2 text-center text-sm font-medium text-gray-700 dark:text-gray-300">
            {{ t('pin.newPin') }}
          </p>
          <PinInput v-model="resetPin" :disabled="isBusy" autofocus :label="t('pin.newPin')" />
        </div>
        <div>
          <p class="mb-2 text-center text-sm font-medium text-gray-700 dark:text-gray-300">
            {{ t('pin.confirmPin') }}
          </p>
          <PinInput v-model="resetPinConfirm" :disabled="isBusy" :label="t('pin.confirmPin')" />
        </div>
        <BaseButton type="submit" class="w-full" :disabled="isBusy || resetPin.length !== 6">
          {{ isBusy ? t('auth.signingIn') : t('recovery.resetPinAction') }}
        </BaseButton>
      </form>

      <!-- Biometric -->
      <button
        v-else-if="activeMethod === 'biometric'"
        :disabled="isBusy"
        class="group bg-secondary-500 flex w-full items-center justify-center gap-3 rounded-2xl px-6 py-4 text-white shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl disabled:opacity-50 dark:bg-slate-700"
        @click="emit('biometric')"
      >
        <template v-if="isBusy">
          <BeanieSpinner size="sm" />
          <span class="font-outfit font-semibold">{{ t('passkey.authenticating') }}</span>
        </template>
        <template v-else>
          <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4"
            />
          </svg>
          <span class="font-outfit font-semibold">{{ t('passkey.signInButton') }}</span>
        </template>
      </button>

      <!-- PIN -->
      <div v-else-if="activeMethod === 'pin'" class="space-y-2">
        <p class="text-center text-sm font-medium text-gray-600 dark:text-gray-400">
          {{ t('pin.enterPin') }}
        </p>
        <PinInput
          ref="pinInputRef"
          v-model="pinValue"
          :has-error="!!shownError"
          :disabled="isBusy"
          autofocus
          :label="t('pin.enterPin')"
          @complete="(pin) => emit('pin', pin)"
        />
      </div>

      <!-- Tap-through (credential-less member, open pod) -->
      <BaseButton
        v-else-if="activeMethod === 'tap-through'"
        type="button"
        class="w-full"
        :disabled="isBusy"
        @click="emit('tap-through')"
      >
        {{ `${t('loginV6.signInAs')} ${person.name}` }}
      </BaseButton>

      <!--
        Message-only panes (recovery terminal; unclaimed-adult invite explanation).
        MUST stay ahead of the password `v-else` below — that branch is the chain's
        catch-all, so falling past here would render a password form for a member who
        has no password.
      -->
      <div v-else-if="messageOnlyBody" class="space-y-3 text-center">
        <p class="text-sm text-gray-600 dark:text-gray-400">
          {{ messageOnlyBody }}
        </p>
      </div>

      <!-- Password (legacy members) -->
      <form v-else @submit.prevent="handleSubmit">
        <BaseInput
          v-model="password"
          :label="t('auth.password')"
          type="password"
          :placeholder="t('auth.enterYourPassword')"
          required
        />
        <p v-if="hasPassphrase && !podOpen" class="mt-2 text-xs text-gray-400 dark:text-gray-500">
          {{ t('recovery.passphraseHint') }}
        </p>

        <BaseButton type="submit" class="mt-4 w-full" :disabled="isBusy">
          {{ isBusy ? t('auth.signingIn') : `${t('loginV6.signInAs')} ${person.name}` }}
        </BaseButton>
      </form>

      <!-- Switch links: every other offered method, one tap away -->
      <div v-if="switchTargets.length > 0" class="space-y-1 pt-1">
        <button
          v-for="method in switchTargets"
          :key="method"
          type="button"
          class="w-full text-center text-sm text-gray-500 transition-colors hover:text-gray-700 disabled:opacity-40 dark:text-gray-400 dark:hover:text-gray-300"
          :disabled="isBusy"
          @click="switchTo(method)"
        >
          {{ switchLabel(method) }}
        </button>
      </div>

      <!-- The recovery terminal: a member who has forgotten everything reaches the
           kit / passphrase / bootstrap here. Always present (never-blank guarantee). -->
      <div class="pt-2">
        <RecoveryKitLink :disabled="isBusy" @click="emit('use-recovery')" />
      </div>
    </div>
  </div>
</template>
