<script setup lang="ts">
/**
 * The approver's half: "a device is asking to open your beanpod — is that you?"
 *
 * Reached TWO ways, and the difference between them is load-bearing here:
 *   - the phone's own camera app opens the deep link (`delivery` is `cold-launch`, `warm`
 *     or `web-load`) — no provenance, because the OS cannot tell a scan from a tapped link;
 *   - the IN-APP scanner in `SignInCodeSheet` (`delivery` is `in-app-scan`) — provenance,
 *     because the person chose to point a camera at something.
 *
 * `showProvenanceWarning` is defined entirely against that distinction, so do not treat
 * `in-app-scan` as dead state: an earlier version of this comment claimed there was no
 * in-app scanner in the flow, which would make the callout look like a constant.
 *
 * Still true, and worth keeping true: the repo has no `getUserMedia` at all, and Android
 * intentionally does not declare `android.permission.CAMERA` so Capacitor can skip the
 * runtime prompt. Both scan paths photograph through the OS camera.
 *
 * ⚠️ APPROVE IS PRIMARY; REJECT IS OUTLINE, FULL WIDTH, DIRECTLY BELOW IT. An earlier
 * version of this comment claimed the two were "equally weighted"; the markup never matched
 * it. The weighting that IS here is deliberate: Approve carries the action the person came
 * to perform, and Reject stays a full-width bordered button — not a `ghost` text link —
 * because declining must remain easy to find on the one screen where declining is the safe
 * outcome.
 *
 * ⚠️ REJECT IS NOT RED. Under the CIG red is for destructive confirmations — deleting,
 * leaving — not for declining. Declining is the safe outcome here, and colouring it as
 * danger would teach exactly the wrong reflex.
 *
 * ⚠️ THE PROVENANCE CHECK IS A CALLOUT, NOT A STEP, AND THAT WAS A TRADE. It used to be a
 * blocking screen shown before any fingerprint: "did someone send you this?". greg found
 * the flow had too many confirmations for what should be one approve plus a PIN, and he is
 * right — but the risk the step addressed is real and unchanged. `/welcome` is a VERIFIED
 * App Link and Universal Link, and on iOS a camera scan opens a URL through the SAME
 * mechanism as a tapped one, so the OS gives us no provenance: a link someone sent in
 * WhatsApp is byte-identical here to a code the person deliberately scanned.
 *
 * So the step folded into the compare panel with TWO compensations, and neither is copy
 * polish:
 *   1. A warning CALLOUT above the fingerprint, rendered whenever the key did NOT arrive
 *      through the in-app scanner. It fails SAFE — a null delivery shows it.
 *   2. An INTENT-BINDING Approve label. When the callout is showing, the button states what
 *      the person is asserting ("Yes, I Scanned This") rather than a generic "Approve". The
 *      assertion the blocking step used to extract is now extracted by the button they are
 *      already reaching for.
 *
 * The signal that decides whether this was the right trade is `device_approval_outcome` with
 * `outcome: 'rejected'` and a `kind` other than `in-app-scan` — someone handed a link they
 * did not scan, declining it. If deep links dominate legitimate approvals and that stays at
 * zero, this warning is friction being tapped through and should be deleted, not left.
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
import {
  emitDeviceApprovalOutcome,
  type ApproverErrorCode,
} from '@/services/telemetry/loginFlowEvents';
import type { DeliveryKind } from '@/services/telemetry/deepLinkEvents';
import { assertNever } from '@/utils/assertNever';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { requireReauth } from '@/composables/useReauth';
import { reportError } from '@/utils/errorReporter';

const props = defineProps<{
  open: boolean;
  /** base64url SPKI from the scanned deep link. */
  publicKey: string;
  /**
   * How the key reached this device. Drives the provenance warning callout.
   *
   * ⚠️ Carried on the SAME value as the transport rather than as a separate "was this
   * scanned in-app?" flag, so a buffered deep-link key can never be released while a
   * parallel flag claims it was scanned — which would skip the interstitial for exactly the
   * key it exists to gate.
   */
  delivery: DeliveryKind | null;
}>();
/**
 * `close` carries whether the key had already done its job, so the delivery gate can tell a
 * dismissal from a completed approval. Without it every successful approval also counted as
 * a dropped key.
 */
const emit = defineEmits<{ close: [consumed?: boolean] }>();

const { t } = useTranslation();

/**
 * Show the provenance warning unless the person demonstrably started the scan themselves.
 *
 * ⚠️ FAILS SAFE, AND THE `!==` IS WHY. A key that came through the in-app scanner is the one
 * case where intent is proven: the person chose to point a camera at something. EVERYTHING
 * else warns, including a `null` delivery. The previous, blocking version tested
 * `delivery !== null && delivery !== 'in-app-scan'`, so an unknown transport suppressed the
 * check. Unknown provenance is the case that most deserves a warning, not least.
 */
const showProvenanceWarning = computed(() => props.delivery !== 'in-app-scan');

/**
 * Every terminal outcome this component reports.
 *
 * ⚠️ ONE EMITTER, because `side` and `delivery` are invariants of this FILE, not of each call
 * site. Spelling them out at all seven call sites was seven chances to pass the wrong side or
 * forget the transport — and `delivery` is what makes the phishing observable a rate rather
 * than a raw count, so forgetting it quietly costs the signal.
 */
function reportOutcome(
  outcome: 'published' | 'unconfirmed' | 'rejected' | 'abandoned' | 'failed',
  errorCode?: ApproverErrorCode
): void {
  emitDeviceApprovalOutcome({ side: 'approver', outcome, delivery: props.delivery, errorCode });
}

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
const errorKey = ref<UIStringKey | null>(null);

/**
 * The three end-of-flow panels, as data.
 *
 * ⚠️ A MAP, NOT A THIRD AND FOURTH COPY OF THE SAME MARKUP. `done`, `pending` and
 * `signed-out` are one panel — semibold title, soft body, one full-width dismiss button —
 * and they were written out longhand twice before `pending` needed a third. Same shape
 * `SAVE_STATUS_PRESENTATION` uses: a flat, exhaustively-typed map instead of nested template
 * ternaries. It lives here rather than in its own file because it has exactly one consumer.
 *
 * Typing the keys as `UIStringKey` is what lets the template drop its `t(x as never)` casts.
 */
type TerminalState = 'done' | 'pending' | 'signed-out';
const TERMINAL_PANEL: Record<
  TerminalState,
  { titleKey: UIStringKey; bodyKey: UIStringKey; testid: string }
> = {
  done: {
    titleKey: 'deviceApproval.doneTitle',
    bodyKey: 'deviceApproval.doneBody',
    testid: 'approval-done',
  },
  pending: {
    titleKey: 'deviceApproval.pendingTitle',
    bodyKey: 'deviceApproval.pendingBody',
    testid: 'approval-pending',
  },
  'signed-out': {
    titleKey: 'deviceApproval.signedOutTitle',
    bodyKey: 'deviceApproval.signedOutBody',
    testid: 'approval-signed-out',
  },
};

/** Set once the approval has been acted on; `null` while the flow is still live. */
const settled = ref<Exclude<TerminalState, 'signed-out'> | null>(null);

const terminal = computed<TerminalState | null>(() =>
  settled.value ? settled.value : canApprove.value ? null : 'signed-out'
);

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
    // ⚠️ RESET FOR EVERY KEY. This component is mounted unconditionally in `App.vue` and
    // never unmounts, so a terminal state left set would greet the NEXT scanned code with
    // the previous one's outcome panel. (The provenance warning needs no equivalent reset:
    // it is derived from `props.delivery`, so it cannot latch.)
    settled.value = null;
    // ⚠️ `isApproving` TOO, AND IT USED TO BE THE DELIBERATE EXCEPTION. The reasoning was
    // that an in-flight approval must not be forgotten — but the generation guard already
    // makes abandoning it safe, and leaving the flag set handed the NEXT key a panel whose
    // Approve was permanently `:loading` and whose Reject was `:disabled`: a live, valid
    // request the person could neither act on nor decline. The abandoned call still resumes
    // and still reports `request_superseded`; it simply no longer paints its verdict, or its
    // spinner, onto a screen that belongs to a different device.
    isApproving.value = false;
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
    reportOutcome('failed', 'no_family_key');
    return;
  }

  isApproving.value = true;
  errorKey.value = null;
  // ⚠️ PIN THE GENERATION ACROSS THE AWAIT BELOW. `requireReauth` suspends for as long as
  // the PIN prompt is up, and a second approval link arriving in that window repaints this
  // sheet with a DIFFERENT device's fingerprint (the `[open, publicKey]` watcher resets
  // `scanned` but deliberately does not touch `isApproving`). Without this check the
  // resumed call wraps the family key for the device captured in `req` — the old one — and
  // then reports success over the new one's fingerprint. The person is told device B was
  // admitted; B never gets in and A did. That defeats the fingerprint comparison this
  // component's docblock calls the only defence, which is the one thing it must never do.
  const generationAtStart = readGeneration;
  /**
   * ⚠️ SNAPSHOT, NOT `props.delivery` AT EMIT TIME. Every report below fires AFTER at least
   * one await, and by then the prop may describe a DIFFERENT key: on the superseded path it
   * names the incoming transport while reporting the outgoing key's failure (the exact
   * mis-attribution `deliver()` guards against), and on the dismissed path `delivery` is
   * already null, because App.vue derives `open` and `delivery` from the same `pending`
   * object — so `kind` was structurally absent from every `request_dismissed` and the
   * per-transport dismissal rate could never be computed.
   */
  const deliveryAtStart = props.delivery;
  const report = (
    outcome: 'published' | 'unconfirmed' | 'rejected' | 'abandoned' | 'failed',
    errorCode?: ApproverErrorCode
  ): void =>
    emitDeviceApprovalOutcome({
      side: 'approver',
      outcome,
      delivery: deliveryAtStart,
      errorCode,
    });
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
    // ⚠️ TWO SIGNALS, NOT ONE OVERLOADED COUNTER. `readGeneration` means exactly one thing
    // — a NEW code arrived — and dismissal is a separate fact. Folding dismissal into the
    // counter (by bumping it above the watcher's early return) would make both cases
    // indistinguishable here, while they need different copy and different error codes.
    if (!props.open) {
      // The sheet was closed while the PIN prompt was up. No message: there is nothing left
      // on screen to show it on. But it must not silently publish a wrap for a request the
      // person explicitly dismissed.
      report('failed', 'request_dismissed');
      return;
    }
    if (generationAtStart !== readGeneration) {
      // ⚠️ REPORTED, BUT NOT PAINTED. A different device's request is on screen now, and it
      // is untouched — writing "that request was replaced, scan again" onto it would accuse
      // a brand-new request of a failure that belongs to its predecessor, in red, over its
      // own live fingerprint. The copy still exists for the case below, where the sheet IS
      // still showing the key that was superseded mid-wrap.
      report('failed', 'request_superseded');
      return;
    }
    if (!proved) {
      // ⚠️ THE SHEET STAYS OPEN, AND THAT IS THE FIX. This used to `emit('close')`, which
      // App.vue routes to `dismiss()` -> `discard()` — permanently destroying the only copy
      // of the key, with nothing said. Three different things land here and none of them is
      // "this person decided not to approve": a mis-tapped backdrop or Cancel on the PIN
      // pad; a member with no PIN, password or passkey, for whom `ReauthChallenge` emits
      // `no-credential`; and `useReauth` resolving false immediately when another gate is
      // already open — newly more reachable now that this sheet sits at `overlay` and can be
      // raised over another flow. In all three the person is left with a dead 3-minute
      // window and no idea why. Declining is `reject()`, which is a button they can still
      // press; this says what happened and leaves it pressable.
      errorKey.value = 'deviceApproval.pinRequired';
      report('abandoned', 'gate_declined');
      return;
    }

    const wrap = await wrapForApproval(familyKey, req);

    // ⚠️ RE-CHECK AFTER THE WRAP, BEFORE THE PUBLISH. `wrapForApproval` is what binds the
    // family key to THIS request, and `publishDeviceApprovalWrap` below is a Drive round trip —
    // a far longer window than the PIN prompt. A code swapped in between would otherwise be
    // shown "Device Approved" while the wrap that actually published belongs to the code
    // that is no longer on screen. This is the last point at which nothing has been
    // published and the abort is still free.
    if (!props.open || generationAtStart !== readGeneration) {
      errorKey.value = 'deviceApproval.supersededRetry';
      report('failed', 'request_superseded');
      return;
    }

    // Monotonic, for the same reason every other replaced entry is: `pickNewerByCreatedAt`
    // resolves an exact tie to the incoming side, so a second approval in the same
    // millisecond — or one from a device whose clock is behind — could lose the merge.
    const prev = syncStore.deviceApprovalCreatedAt(memberId);
    const prevMs = prev ? new Date(prev).getTime() : NaN;
    const createdAt = toISODateString(
      new Date(Number.isFinite(prevMs) ? Math.max(Date.now(), prevMs + 1) : Date.now())
    );

    const outcome = await syncStore.publishDeviceApprovalWrap(memberId, {
      ...wrap,
      createdAt,
      expiresAt: toISODateString(new Date(Date.now() + APPROVAL_EXPIRY_MS)),
    });

    // ⚠️ THREE ANSWERS, NOT TWO, AND CONFLATING THEM IS THE DEFECT THIS FIXES. This used to
    // read `if (!published)` against a boolean that flattened all four outcomes, so a publish
    // that TIMED OUT — and which, per `syncNowDurable`'s own comment, may well still land —
    // was reported to the approver as an outright failure. greg hit exactly that: told the
    // approval could not be saved, then watched the other device get in about ten seconds
    // later. A `switch` closed with `assertNever` so a fifth outcome fails the build.
    /**
     * ⚠️ THE PUBLISH RESOLVED; THE SCREEN MAY NOT BE THE ONE THAT STARTED IT. Every guard
     * above runs BEFORE `publishDeviceApprovalWrap`, and that call is a Drive round trip
     * bounded by `POST_AUTH_SAVE_TIMEOUT_MS` — seconds, far longer than the PIN window the
     * generation guard was originally written for. A second code arriving inside it is not
     * exotic: the far device's "show a new one" mints a fresh keypair, so `deliver()` does
     * not take its same-key early return, the watcher repaints this sheet with B's
     * fingerprint, and an unconditional `settled = 'done'` then paints "Device Approved"
     * over B's live compare panel. The person closes it believing B got in. B never was;
     * A was. That is precisely the harm the pre-publish guard's comment describes, and it
     * was reachable through the one window that guard does not cover.
     *
     * The wrap for A HAS published and is legitimately A's, so this is not an error — the
     * outcome is still reported, truthfully, against A's transport. What must not happen is
     * painting A's result onto B's screen.
     */
    const stillOurs = props.open && generationAtStart === readGeneration;

    switch (outcome) {
      case 'saved':
        // The cold device emits the `ok` outcome when it actually gets in; this side only
        // knows the wrap was published, which is not the same event.
        report('published');
        if (stillOurs) settled.value = 'done';
        return;
      case 'timeout':
      case 'unknown':
        // Not an error and not styled as one: nothing has gone wrong, the upload is simply
        // still in flight. Saying "failed" here is what sent greg looking for a bug that
        // did not exist.
        report('unconfirmed', outcome);
        if (stillOurs) settled.value = 'pending';
        return;
      case 'failed':
        // The other device polls the FILE. A wrap that never landed is a screen that waits
        // out its whole window for nothing, so this must never be reported as success.
        report('failed', 'publish_failed');
        // ⚠️ A REPORT, NOT ONLY A COUNTER. The telemetry line above says a publish failed;
        // it does not put anything on the console for whoever is looking at this next.
        // `severity: 'error'` rather than 'warning': this is a DEFINITE failure to hand over
        // the family key, so it must not rank below the generic throw handler below it.
        reportError({
          surface: 'login-flow',
          message: 'device approval wrap could not be published',
          severity: 'error',
          // NOT `error_code: outcome` — inside this branch `outcome` is narrowed to the
          // literal 'failed', which would ship a third spelling of one condition that
          // cannot be joined to the paired `publish_failed` event above.
          context: { action: 'device_approval_publish_failed', error_code: 'publish_failed' },
        });
        if (stillOurs) errorKey.value = 'deviceApproval.publishFailed';
        return;
      default:
        assertNever(outcome, 'device approval publish outcome');
    }
  } catch (e) {
    errorKey.value = 'deviceApproval.failed';
    report('failed', 'approve_threw');
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
  reportOutcome('rejected');
  emit('close');
}
</script>

<template>
  <!--
    ⚠️ `overlay`, AND NEITHER OF THE TWO VALUES YOU ARE ABOUT TO REACH FOR.

    This sheet is raised from ANY route, including on top of `SignInCodeSheet`, which
    `AppHeader` owns. Both sat at the default `base` (z-50), and `BaseModal` teleports on
    mount — so with this component mounted earlier in `App.vue` than `<AppHeader>`, its node
    landed EARLIER in `<body>` and the equal-z tie broke against it. A device-approval
    decision rendered UNDERNEATH another modal is what greg hit on a real device.

    NOT `top` (z-[250]): `ReauthGateModal` is `overlay` and its docblock says `top` buries it.
    Approving raises that PIN gate, so `top` here would make the prompt invisible and the
    approve flow dead — silently. The gate still wins at equal z because its `BaseModal` is
    `v-if`-guarded and therefore teleports LATER, when the gate is actually raised.

    NOT z-[55]: already claimed by `BaseSidePanel`'s `raised` and `MagicBeansSheet`'s
    backdrop, so a new tier there would create a tie rather than remove one.
  -->
  <BaseModal
    :open="open"
    :title="t('deviceApproval.title')"
    size="md"
    layer="overlay"
    @close="emit('close')"
  >
    <!-- One panel for all three end states: approved, still saving, and signed out here.
         Driven by TERMINAL_PANEL rather than written out three times. -->
    <div
      v-if="terminal"
      class="space-y-3 text-center"
      :data-testid="TERMINAL_PANEL[terminal].testid"
    >
      <p class="dark:text-ink text-base font-semibold text-gray-900">
        {{ t(TERMINAL_PANEL[terminal].titleKey) }}
      </p>
      <p class="dark:text-ink-soft text-sm text-gray-600">
        {{ t(TERMINAL_PANEL[terminal].bodyKey) }}
      </p>
      <BaseButton
        class="w-full"
        variant="secondary"
        type="button"
        @click="emit('close', terminal !== 'signed-out')"
      >
        {{ terminal === 'signed-out' ? t('action.close') : t('action.done') }}
      </BaseButton>
    </div>

    <div v-else-if="scanned" class="space-y-4 text-center">
      <p class="dark:text-ink-soft text-sm text-gray-600">{{ prompt() }}</p>

      <!-- The provenance check, folded from a blocking step into a callout read in context.
           Heritage Orange, not red: under the CIG red is for destructive confirmations and
           hard validation errors, and this is neither. -->
      <div
        v-if="showProvenanceWarning"
        class="dark:border-accent-lift/40 dark:bg-surface-overlay border-primary-200 bg-primary-50 rounded-xl border px-3 py-2.5 text-left"
        data-testid="approval-provenance-warning"
        role="note"
      >
        <!-- ⚠️ `accent-lift`, NOT `primary-lift` — the latter does not exist, and neither do
             `primary-300` or `primary-800`; the Heritage Orange scale skips both. All three
             were in the first draft of this callout, where they silently emitted nothing:
             the warning text fell back to inherited colour in light mode and had no lift at
             all on dark. Nothing lints for a token that does not exist, so check the scale
             in `packages/brand/theme.css` before reaching for a shade. -->
        <p class="dark:text-accent-lift text-primary-700 text-sm">
          {{ t('deviceApproval.provenanceBody') }}
        </p>
      </div>

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

      <!-- Approve is primary; Reject is a full-width bordered button directly below it, NOT
           a ghost text link. See the header comment. -->
      <div class="space-y-2">
        <BaseButton
          class="w-full"
          variant="primary"
          type="button"
          :loading="isApproving"
          data-testid="approval-approve"
          @click="approve"
        >
          <!-- Intent-binding label: when the person did not demonstrably start the scan, the
               button states what they are asserting rather than a generic "Approve". This is
               one of the two compensations for folding the blocking step. -->
          {{
            showProvenanceWarning ? t('deviceApproval.approveChecked') : t('deviceApproval.approve')
          }}
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
      {{ t(errorKey) }}
    </p>
  </BaseModal>
</template>
