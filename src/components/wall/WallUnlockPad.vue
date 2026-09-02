<script setup lang="ts">
/**
 * The wall's PIN screen — the pad IS the screen.
 *
 * `ReauthChallenge` is the right component for a phone: it explains itself,
 * offers biometric/PIN/password and waits for a choice. On a wall that costs a
 * tap on an intermediate "confirm it's really you" panel before any digits
 * appear, and then raises the OS keyboard over the pad. Here the member's name,
 * six boxes and a touch keypad are on screen immediately.
 *
 * Only reachable when a candidate HAS a PIN — `WallLockMenu` falls back to the
 * full challenge for legacy password-only members, so no credential path is
 * lost by shortcutting the choice screen.
 *
 * Takes a LIST of candidates, not one member. Unlocking edits accepts any
 * grown-up's PIN (see `useWallLock` for why that is safe); proving identity in
 * order to leave passes a list of one. The pad does not know or care which
 * case it is in — it tries the digits against each candidate and reports who
 * matched.
 */
import { computed, ref, watch } from 'vue';
import PinInput from '@/components/ui/PinInput.vue';
import PinKeypad from '@/components/ui/PinKeypad.vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import { PIN_LENGTH } from '@/services/auth/deviceUnlock';
import { usePinAttemptLimit, PIN_COOLDOWN_MS } from '@/composables/usePinAttemptLimit';
import { verifyPassword } from '@/services/auth/passwordService';
import { getMemberAvatarVariant } from '@/composables/useMemberAvatar';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
import { reportError } from '@/utils/errorReporter';
import type { FamilyMember } from '@/types/models';

const props = defineProps<{
  /** Everyone whose PIN opens this. Order is irrelevant; first match wins. */
  candidates: FamilyMember[];
  open: boolean;
  /** Optional line under the title — used to say why leaving needs YOUR PIN. */
  hint?: string;
}>();
const emit = defineEmits<{ verified: [FamilyMember]; cancelled: [] }>();

const SURFACE = 'beanie-wall';

const { t } = useTranslation();

const pin = ref('');
const error = ref<string | null>(null);
const isVerifying = ref(false);

/**
 * The wall is the one physically exposed, always-on surface in the product, and a correct
 * PIN here is full-app access (it also gates leaving). Unlimited instant guesses on a
 * 4.5rem keypad is not a step-up.
 *
 * The budget lives OUTSIDE this component deliberately. It used to be local refs, but
 * `BaseModal` renders its slot under `v-if="open"`, so `WallLockMenu` closing the
 * challenge unmounted the pad and reset the count — the cooldown cost an attacker two
 * extra taps per five guesses, and the `watch` below that promised it would survive was
 * dead code (#80 review).
 */
const limit = usePinAttemptLimit('wall-unlock', SURFACE, 'wall-unlock');
const { inCooldown, cooldownSeconds } = limit;
const disabled = computed(() => isVerifying.value || inCooldown.value);

// A reopened pad must never show the previous attempt's digits or error.
watch(
  () => props.open,
  (open) => {
    if (open) {
      pin.value = '';
      // A cooldown SURVIVES closing and reopening the pad (the budget is module-scoped,
      // see usePinAttemptLimit), so keep its message on screen rather than clearing it
      // and presenting a pad that silently refuses every digit.
      if (!inCooldown.value) error.value = null;
    }
  }
);

function press(digit: string) {
  if (disabled.value || pin.value.length >= PIN_LENGTH) return;
  error.value = null;
  pin.value += digit;
}

function backspace() {
  if (disabled.value) return;
  error.value = null;
  pin.value = pin.value.slice(0, -1);
}

async function verify(entered: string) {
  if (!props.candidates.length || inCooldown.value) return;
  isVerifying.value = true;
  try {
    // Sequential, stopping at the first match. Each check is a 100k-iteration
    // PBKDF2 derive (~100ms), so a household of three adults costs at most
    // ~300ms on a wrong PIN — deliberate work the attempt limit already caps.
    let matched: FamilyMember | null = null;
    for (const candidate of props.candidates) {
      if (!candidate.pinHash) continue;
      if (await verifyPassword(entered, candidate.pinHash)) {
        matched = candidate;
        break;
      }
    }
    if (matched) {
      limit.recordSuccess();
      emit('verified', matched);
      return;
    }
    pin.value = '';
    // `recordFailure` counts and persists the attempt AND emits the failure telemetry,
    // so the surface only chooses the wording.
    error.value = limit.recordFailure()
      ? fillTemplate(t('wall.unlock.tooMany'), { seconds: PIN_COOLDOWN_MS / 1000 })
      : t('pin.incorrect');
  } catch (e) {
    pin.value = '';
    error.value = t('wall.unlock.failed');
    // A PIN check that THREW is not a wrong PIN — without this the family sees
    // "incorrect" for what is actually a broken crypto path, and retries forever.
    reportError({
      surface: SURFACE,
      message: 'wall_pin_verify_threw',
      severity: 'error',
      error: e instanceof Error ? e : new Error(String(e)),
      context: { action: 'unlock' },
    });
  } finally {
    isVerifying.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col items-center gap-5 py-2">
    <!--
      Showing the faces answers "whose PIN works here?" without a sentence.
      With one candidate it is simply that person; with several it is the row of
      grown-ups, which is the honest picture of who can unlock this wall.
    -->
    <div class="flex">
      <BeanieAvatar
        v-for="person in candidates"
        :key="person.id"
        :variant="getMemberAvatarVariant(person)"
        :color="person.color"
        size="lg"
        class="-ml-3 first:ml-0"
        :aria-label="person.name"
      />
    </div>
    <div class="text-center">
      <p class="font-outfit text-secondary-500 text-lg font-bold dark:text-gray-100">
        {{
          candidates.length === 1
            ? fillTemplate(t('wall.unlock.title'), { name: candidates[0].name })
            : t('wall.unlock.anyGrownUp')
        }}
      </p>
      <p v-if="hint" class="text-secondary-400 mt-1 text-sm dark:text-gray-400">{{ hint }}</p>
    </div>

    <PinInput
      v-model="pin"
      keypad
      :has-error="!!error"
      :disabled="disabled"
      :label="t('pin.enterPin')"
      @complete="verify"
    />
    <p v-if="error" class="text-center text-sm text-red-600 dark:text-red-400" role="alert">
      {{
        inCooldown ? fillTemplate(t('wall.unlock.tooMany'), { seconds: cooldownSeconds }) : error
      }}
    </p>

    <PinKeypad :disabled="disabled" @digit="press" @backspace="backspace" />

    <button
      type="button"
      class="font-inter text-sm text-[var(--muted-text,#4d5d6c)] underline"
      @click="emit('cancelled')"
    >
      {{ t('action.cancel') }}
    </button>
  </div>
</template>
