<script setup lang="ts">
/**
 * Creating a magic link, end to end: CTA → mandatory pick → PIN → link and QR.
 *
 * ⚠️ ONE COMPONENT, TWO SURFACES, BECAUSE THEY ARE THE SAME THING. The profile menu's "sign in
 * another device" sheet and the Settings card were separate implementations of one job, and
 * before this they had drifted into different flows AND different names for the same artifact
 * ("Your beanies magic link" at 7 days, "Link a Device" at 15 minutes). greg's call, 2026-09-20:
 * there is no such distinction. A magic link is a magic link; the only difference is when it
 * expires, and both surfaces now mint the SAME 15-minute link.
 *
 * ⚠️ A SHARED MINTER WAS REJECTED EARLIER, AND THE REASON NO LONGER HOLDS. A review cut an
 * earlier `MagicLinkMinter` because the Settings card derived a status dot, an expiry date and a
 * replace-warning from the mint target, so hiding the target inside a child made the card show
 * YOUR link's state while minting for your SPOUSE — and `memberLinkKeys` being newest-wins, the
 * mint then destroyed theirs silently. That whole chain existed only for the 7-day per-member
 * link. This flow mints the ADDITIVE `inviteKeys` variant, which revokes nothing, so there is no
 * status to derive and nothing to warn about. The objection was specific, and it is now moot.
 *
 * ⚠️ THE PICK IS MANDATORY AND THE PIN COMES AFTER IT. It used to default to you with a small
 * "create one for someone else" link underneath. greg's objection: that link is easy to miss,
 * and choosing a recipient is the whole decision, not a refinement. Proving yourself before the
 * pick is also wasted friction for an action you might abandon at the picker.
 */
import { ref } from 'vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BeanieSpinner from '@/components/ui/BeanieSpinner.vue';
import MintedLinkPanel from '@/components/ui/MintedLinkPanel.vue';
import MintTargetPicker from '@/components/auth/MintTargetPicker.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useMintedLink } from '@/composables/useMintedLink';
import { useMintTarget } from '@/composables/useMintTarget';
import { requireReauth, canStepUp } from '@/composables/useReauth';
import { mintDeviceLink } from '@/services/auth/linkMint';
import type { UIStringKey } from '@/services/translation/uiStrings';

const props = defineProps<{
  /** Which entry point, for the `link_minted` funnel's `origin`. */
  origin: string;
  /**
   * Override the CTA wording.
   *
   * ⚠️ THE DEFAULT DESCRIBES THE MACHINE'S JOB; A HOST MAY DESCRIBE THE PERSON'S. "Create a
   * magic link" is right where minting IS the task. At setup time the reader is deciding
   * whether to go and sign in on their phone, so the offer says "scan a magic link with your
   * phone" — the activity, not the artifact.
   */
  ctaLabelKey?: UIStringKey;
  /**
   * Skip the step-up.
   *
   * ⚠️ ONLY FOR FLOWS WITH NOTHING TO STEP UP FROM. Pod creation reaches this seconds after the
   * owner set their PIN, inside an uninterruptible setup step — asking them to re-enter the PIN
   * they just chose is friction for no security. The pre-existing creation mint carried
   * `gate: 'not-applicable'` for exactly this reason. Everywhere else the gate stays on.
   */
  gate?: 'require' | 'not-applicable';
}>();

const emit = defineEmits<{
  /** The host should close itself, e.g. before navigating to the joining route. */
  leave: [];
}>();

const { t } = useTranslation();
const target = useMintTarget();

/**
 * THREE STEPS. `'gate'` is the CTA, `'pick'` is the mandatory recipient choice, `'code'` is the
 * minted link. The PIN sits between `'pick'` and `'code'` and belongs to neither.
 */
const step = ref<'gate' | 'pick' | 'code'>('gate');
const isGating = ref(false);

const { link, qr, isMinting, errorKey, qrUnavailable, run, cancel } = useMintedLink({
  kind: 'device',
  surface: 'login-flow',
  facts: () => ({ origin: props.origin, target: target.isSelf.value ? 'self' : 'other' }),
  // ⚠️ `gate: 'already-proved'`, because `gateThenMint()` proves after the pick and before this
  // runs. The service default is `'require'`, so omitting it would stack a second PIN pad.
  mint: () => mintDeviceLink({ hintMemberId: target.targetId.value ?? '', gate: 'already-proved' }),
});

/** The CTA. Advances to the pick; deliberately does NOT prompt for a PIN yet. */
function startPick(): void {
  step.value = 'pick';
}

async function gateThenMint(): Promise<boolean> {
  // ⚠️ `BaseModal` has no focus trap, so focus can stay on the control beneath the PIN pad and
  // a second Enter re-enters here. `useReauth` holds ONE `resolve`, so the second call
  // overwrites it and the first promise never settles: a silently leaked await.
  if (isGating.value) return false;
  isGating.value = true;
  try {
    // ⚠️ `canStepUp()` FIRST. `requireReauth` fails closed for a member with neither a PIN nor a
    // password, so gating unconditionally would make this link unmintable by exactly the people
    // most likely to be locked out.
    if (props.gate !== 'not-applicable' && canStepUp()) {
      const proved = await requireReauth({
        titleKey: 'signInCode.title',
        reasonKey: 'signInCode.pinReason',
      });
      if (!proved) return false;
    }
    void run();
    return true;
  } finally {
    isGating.value = false;
  }
}

/**
 * Staying on `'pick'` when the gate is declined is deliberate: the recipient already chosen is
 * still on screen, so retrying is one tap rather than restarting the flow.
 */
async function handlePicked(): Promise<void> {
  if (!(await gateThenMint())) return;
  step.value = 'code';
}

/** Back to the start, with nothing in flight. Hosts call this when they close or reopen. */
function reset(): void {
  step.value = 'gate';
  link.value = '';
  qr.value = '';
  errorKey.value = null;
  qrUnavailable.value = false;
  // ⚠️ `cancel()` BEFORE `target.reset()`. `cancel()` books the abandoned mint through
  // `facts()`, which reads `target.isSelf` — so resetting first labelled every abandoned
  // other-target mint as `target=self`, leaving a permanent skew on `started - minted` in
  // exactly the hang scenario the instrumentation exists to diagnose.
  cancel();
  target.reset();
}

defineExpose({ reset });
</script>

<template>
  <div>
    <!-- STEP 1: the CTA. -->
    <div v-if="step === 'gate'" class="space-y-4">
      <p class="dark:text-ink text-base font-medium text-gray-900">
        {{ t('signInCode.gateLead') }}
      </p>

      <BaseButton
        class="w-full"
        variant="primary"
        type="button"
        data-testid="magic-link-create"
        @click="startPick"
      >
        <span class="inline-flex items-center justify-center gap-2">
          <!-- A QR glyph, so the button says what it PRODUCES before it is tapped. Inline
               stroke SVG per the theme skill: no emoji, no icon font. -->
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
          {{ t(props.ctaLabelKey ?? 'signInCode.createLink') }}
        </span>
      </BaseButton>

      <!-- The pull direction, which did not leave with the in-app scanner: the other device
           shows a code and this one reads it with the camera it already has. -->
      <p class="dark:text-ink-faint text-xs text-gray-500">{{ t('signInCode.orScanHint') }}</p>
    </div>

    <!-- STEP 2: the pick, REVEALED BELOW the CTA rather than replacing it.
         ⚠️ THE CTA STAYS RENDERED ON PURPOSE. When the picker replaced it there was nowhere to
         go back to, so the chip read as navigation and was wired to a no-op flag — it looked
         broken because it was. With the button still above it, the only sensible affordance is
         dismissal, and there is exactly one of them. -->
    <div v-else-if="step === 'pick'" class="space-y-4">
      <BaseButton
        class="w-full"
        variant="primary"
        type="button"
        disabled
        data-testid="magic-link-create"
      >
        <span class="inline-flex items-center justify-center gap-2">
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
          {{ t(props.ctaLabelKey ?? 'signInCode.createLink') }}
        </span>
      </BaseButton>

      <MintTargetPicker
        :target="target"
        testid-scope="magic-link"
        :on-before-leave="() => emit('leave')"
        @picked="handlePicked"
        @dismiss="step = 'gate'"
      />
    </div>

    <!-- STEP 3: the minted link. -->
    <template v-else>
      <!-- ⚠️ `BeanieSpinner label`, not a bare <p>. Minting takes several seconds (a key wrap
           plus a Drive write), and `label` brings `role="status"` so the wait is announced. -->
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
        <!-- No "this replaces your last link" line, and that is the point of the additive
             `inviteKeys` mint: it revokes nothing, so there is nothing to warn about. -->
        <p class="dark:text-ink-faint text-xs text-gray-500">{{ t('signInCode.expiryNote') }}</p>
      </div>

      <!-- ⚠️ OUTSIDE the `v-else-if="link"` block. A failed mint leaves `link` empty, so nesting
           this inside it left the person on a step showing one red line with no way back and no
           retry, reachable only by dismissing and re-entering the PIN. -->
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
  </div>
</template>
