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
import { requireReauth, canStepUp } from '@/composables/useReauth';
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
const emit = defineEmits<{
  close: [];
  /**
   * The approval was acted on. Emitted the MOMENT the publish resolves, not when the sheet
   * closes — the TTL has to stop while the "Device Approved" panel is still on screen, which
   * is precisely when nobody is tapping anything.
   */
  settled: [key: string, outcome: 'approved' | 'unconfirmed'];
}>();

function closeSheet(): void {
  emit('close');
}

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
/**
 * ⚠️ `currentMemberId`, NOT `currentMember?.id`. The latter resolves through
 * `members.value.find(...)`, so it is undefined for any tick where the roster is momentarily
 * empty — which `loadMembers` deliberately allows ("an EMPTY roster is 'the doc did not
 * load'... Hold the id") and which a background Drive merge triggers. Keying on the derived
 * object let a routine merge replace a live fingerprint panel with "Open beanies to Approve"
 * mid-comparison, whose only button then DESTROYED the key.
 */
const canApprove = computed(() => !!syncStore.familyKey && !!familyStore.currentMemberId);

/**
 * Can a step-up gate run for this member at all?
 *
 * ⚠️ DELIBERATELY CONSERVATIVE, because `canStepUp()` answers a NARROWER question than the
 * copy needs. It tests `pinHash || passwordHash` only — `ReauthChallenge` additionally
 * offers a passkey, derived from device-local biometric material that this predicate cannot
 * see. So a passkey-only member reads as "no credential", and telling them "set a PIN in
 * Settings" would be false AND would remove the one thing that works for them.
 *
 * The dead-end copy is therefore shown only when the member is ALSO not the current one —
 * i.e. the roster genuinely has nobody to gate — and everyone else gets the retryable
 * message. A wrong "try again" costs a tap; a wrong "you have no credential" sends someone
 * to change settings they did not need to change.
 */
const canStepUpHere = computed(() => canStepUp() || !!familyStore.currentMemberId);

/** Messages that are information, not failure — see the template comment on the alert. */
const ROUTINE_NOTICES: readonly UIStringKey[] = [
  'deviceApproval.pinRequired',
  'deviceApproval.noCredential',
];
const isRoutineNotice = computed(
  () => !!errorKey.value && ROUTINE_NOTICES.includes(errorKey.value)
);

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
const readGenerationRef = ref(0);
/**
 * Which request has an approve() in flight, by generation — NOT a plain boolean.
 *
 * ⚠️ PER-REQUEST, BECAUSE BOTH BOOLEAN ANSWERS WERE WRONG. Left set across a new key it
 * handed the successor a spinning, untappable Approve and a disabled Reject; cleared in a
 * `finally` it let a superseded call switch OFF the successor's in-flight flag mid-publish,
 * so a second tap started a concurrent multi-MB publish racing the first on the same
 * envelope key. A generation answers the question that was actually being asked — "is THIS
 * request busy?" — and both failures become unrepresentable.
 */
const approvingGeneration = ref<number | null>(null);
/**
 * Is THIS screen's request busy? Drives the spinner and the buttons.
 *
 * ⚠️ GENERATION-SCOPED, so a new key gets a live panel instead of inheriting the previous
 * one's frozen buttons. That is the display question, and it is NOT the same as the safety
 * question — see `isPublishing`.
 */
const isApproving = computed(() => approvingGeneration.value === readGenerationRef.value);
/**
 * Is ANY approval in flight, whatever screen it belongs to?
 *
 * ⚠️ THE SAFETY QUESTION, AND IT IS DELIBERATELY DIFFERENT. Deriving the entry guard from
 * `isApproving` meant a supersession re-enabled Approve while the previous publish was still
 * uploading, so two approvals could sit inside `publishEnvelopeEntry` on the SAME
 * `deviceApprovalKeys[memberId]` slot — and the older call's rollback would then delete the
 * newer device's already-published wrap, admitting nobody while reporting two successes.
 * The 5s -> 20s budget widened that window fourfold.
 */
const isPublishing = computed(() => approvingGeneration.value !== null);
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
    // ⚠️ NOTHING TO RESET FOR `isApproving`, AND THAT IS THE POINT. It is derived from
    // whether the IN-FLIGHT generation is still the CURRENT one, so bumping the generation
    // below makes it false for the new key by construction. It was a plain boolean twice,
    // and both answers were wrong: left set it handed the successor a spinning, untappable
    // Approve; cleared here it let a superseded call switch the successor's flag off
    // mid-publish, so a second tap started a concurrent publish racing the first.
    if (!open || !publicKey) return;
    const generation = ++readGenerationRef.value;
    try {
      const result = await readApprovalRequest(publicKey);
      if (generation !== readGenerationRef.value) return; // superseded — drop it
      scanned.value = result;
    } catch (e) {
      if (generation !== readGenerationRef.value) return;
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

/**
 * What an approve attempt concluded. Returned rather than written, so that every outcome
 * passes through ONE guard on its way to the screen.
 *
 * ⚠️ THIS SHAPE IS THE FIX FOR A CLASS OF BUG, NOT ONE BUG. `approve()` used to write
 * `settled`, `errorKey` and `isApproving` directly from five different points after an
 * await, and a guard had to be remembered at every one. Three of the five got one; the two
 * that did not were the catch arm and the finally — so a failure belonging to a superseded
 * request painted red over its successor's live fingerprint, and a superseded call cleared
 * the successor's in-flight flag mid-publish. Hand-guarding five sites and getting three
 * right is not a fix, it is the same bug waiting for a sixth site. Now there is one place
 * that can write, and it checks once.
 */
type ApproveVerdict =
  | { paint: 'settled'; value: Exclude<TerminalState, 'signed-out'> }
  | { paint: 'error'; key: UIStringKey }
  | { paint: 'none' };

async function approve(): Promise<void> {
  const req = scanned.value;
  const familyKey = syncStore.familyKey;
  const memberId = familyStore.currentMemberId;
  // ⚠️ `isPublishing`, NOT `isApproving`. See their docblocks: the second would let a
  // superseded-but-still-uploading call be joined by a new one on the same envelope key.
  if (!req || isPublishing.value) return;

  if (!familyKey || !memberId) {
    errorKey.value = 'recovery.podNotOpen';
    reportOutcome('failed', 'no_family_key');
    return;
  }

  // ⚠️ PIN THE GENERATION ACROSS EVERY AWAIT BELOW. `requireReauth` suspends for as long as
  // the PIN prompt is up, and the publish is a Drive round trip that may spend the full
  // credential budget — both windows in which a second approval link can arrive and repaint
  // this sheet with a DIFFERENT device's fingerprint. Without this, a resumed call wraps the
  // family key for the device captured in `req` — the old one — and reports success over the
  // new one's fingerprint: the person is told device B was admitted, B never gets in, and A
  // did. That defeats the fingerprint comparison this component's docblock calls the only
  // defence, which is the one thing it must never do.
  const generationAtStart = readGenerationRef.value;
  const stillOurs = (): boolean => props.open && generationAtStart === readGenerationRef.value;

  /**
   * ⚠️ SNAPSHOT, NOT `props.delivery` AT EMIT TIME. Every report below fires after at least
   * one await, and by then the prop may describe a DIFFERENT key: on the superseded path it
   * would name the incoming transport while reporting the outgoing key's failure, and on the
   * dismissed path `delivery` is already null, because App.vue derives `open` and `delivery`
   * from the same `pending` object — so `kind` was structurally absent from every
   * `request_dismissed` and the per-transport dismissal rate could never be computed.
   */
  const deliveryAtStart = props.delivery;
  const publicKeyAtStart = props.publicKey;
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

  approvingGeneration.value = generationAtStart;
  errorKey.value = null;
  let verdict: ApproveVerdict = { paint: 'none' };
  try {
    verdict = await runApproval({ req, familyKey, memberId, generationAtStart, report });
  } catch (e) {
    verdict = { paint: 'error', key: 'deviceApproval.failed' };
    report('failed', 'approve_threw');
    reportError({
      surface: 'login-flow',
      message: 'device approval wrap failed',
      severity: 'error',
      error: e,
      context: { action: 'device_approval_failed' },
    });
  } finally {
    // THE one write of each piece of state, behind THE one guard. A verdict that belongs to
    // a request no longer on screen is reported to CloudWatch (it happened, and on the
    // `saved` path a real wrap really did publish) but never painted.
    // ⚠️ OUTSIDE the `stillOurs` check. The wrap really did publish, so the key is spent
    // whether or not this screen is still showing it — and leaving the TTL armed on a spent
    // key is what produced an `expired` drop and an "it expired" toast for an approval that
    // had worked.
    if (verdict.paint === 'settled') {
      // ⚠️ THE KEY THIS CALL STARTED WITH, not whatever is on screen now. The gate no-ops if
      // they differ; without it a publish that finished after a second link arrived would
      // disarm the SUCCESSOR's expiry and book the successor out of the funnel.
      emit('settled', publicKeyAtStart, verdict.value === 'done' ? 'approved' : 'unconfirmed');
    }
    if (stillOurs()) {
      if (verdict.paint === 'settled') settled.value = verdict.value;
      else if (verdict.paint === 'error') errorKey.value = verdict.key;
      approvingGeneration.value = null;
    } else if (approvingGeneration.value === generationAtStart) {
      // Only clear the flag if it is still OURS. Clearing unconditionally is what let a
      // superseded call un-disable the successor's buttons while its publish was in flight.
      approvingGeneration.value = null;
    }
  }
}

/** The approval itself. Reports as it goes; paints nothing. */
async function runApproval(ctx: {
  req: ScannedApproval;
  familyKey: CryptoKey;
  memberId: string;
  generationAtStart: number;
  report: (
    outcome: 'published' | 'unconfirmed' | 'rejected' | 'abandoned' | 'failed',
    errorCode?: ApproverErrorCode
  ) => void;
}): Promise<ApproveVerdict> {
  const { req, familyKey, memberId, generationAtStart, report } = ctx;
  const superseded = (): boolean => generationAtStart !== readGenerationRef.value;

  // ⚠️ SAME BAR AS MINTING A CODE. "Sign in another device" asks for the PIN before it will
  // show one; approving a device hands over the identical thing — the family key, wrapped
  // for someone else's device — so it asks too. It also covers the ordinary family case that
  // has nothing to do with strangers, which is a phone left unlocked on a table.
  const proved = await requireReauth({
    titleKey: 'deviceApproval.title',
    reasonKey: 'deviceApproval.pinReason',
  });

  if (!props.open) {
    // The sheet was closed while the PIN prompt was up. Nothing to paint on, and it must not
    // silently publish a wrap for a request the person explicitly dismissed.
    report('failed', 'request_dismissed');
    return { paint: 'none' };
  }
  if (superseded()) {
    // ⚠️ REPORTED, NOT PAINTED — and there is no longer any branch that paints this. A
    // different device's request is on screen and it is untouched; telling it "that request
    // was replaced, scan again" in red over its own live fingerprint accuses a brand-new
    // request of its predecessor's failure. `readGenerationRef` only ever advances when the
    // watcher has already repainted with a different OPEN key, so there is no reachable
    // state in which the superseded copy would land on the key it actually describes.
    report('failed', 'request_superseded');
    return { paint: 'none' };
  }
  if (!proved) {
    // ⚠️ THE SHEET STAYS OPEN. This used to `emit('close')`, which App.vue routes to
    // `dismiss()` -> `discard()` — permanently destroying the only copy of the key, with
    // nothing said. Three different things land here and none is "this person decided not to
    // approve": a mis-tapped backdrop or Cancel on the PIN pad; a member with no PIN,
    // password or passkey, for whom `ReauthChallenge` emits `no-credential`; and `useReauth`
    // resolving false immediately when another gate is already open. Declining is `reject()`,
    // a button that is still there. `abandoned` rather than `rejected` keeps this out of the
    // one signal that decides whether the blocking provenance step comes back.
    report('abandoned', 'gate_declined');
    return {
      paint: 'error',
      key: canStepUpHere.value ? 'deviceApproval.pinRequired' : 'deviceApproval.noCredential',
    };
  }

  const wrap = await wrapForApproval(familyKey, req);

  // ⚠️ RE-CHECK AFTER THE WRAP, BEFORE THE PUBLISH. `wrapForApproval` is what binds the
  // family key to THIS request, and the publish below is a Drive round trip. This is the
  // last point at which nothing has been published and the abort is still free.
  if (!props.open || superseded()) {
    report('failed', 'request_superseded');
    return { paint: 'none' };
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
  // that TIMED OUT — and which may well still land — was reported as an outright failure.
  // A `switch` closed with `assertNever` so a fifth outcome fails the build.
  switch (outcome) {
    case 'saved':
      // The cold device emits the `ok` outcome when it actually gets in; this side only
      // knows the wrap was published, which is not the same event.
      report('published');
      return { paint: 'settled', value: 'done' };
    case 'timeout':
    case 'unknown':
      // Not an error and not styled as one: nothing has gone wrong, the upload is simply
      // still in flight. Saying "failed" here is what sent greg looking for a bug that did
      // not exist.
      report('unconfirmed', outcome);
      return { paint: 'settled', value: 'pending' };
    case 'failed':
      // The other device polls the FILE. A wrap that never landed is a screen that waits out
      // its whole window for nothing, so this must never be reported as success.
      report('failed', 'publish_failed');
      // ⚠️ A REPORT, NOT ONLY A COUNTER. `severity: 'error'` rather than 'warning': this is a
      // DEFINITE failure to hand over the family key, so it must not rank below the generic
      // throw handler.
      reportError({
        surface: 'login-flow',
        message: 'device approval wrap could not be published',
        severity: 'error',
        context: { action: 'device_approval_publish_failed', error_code: 'publish_failed' },
      });
      return { paint: 'error', key: 'deviceApproval.publishFailed' };
    default:
      return assertNever(outcome, 'device approval publish outcome');
  }
}

function reject(): void {
  reportOutcome('rejected');
  closeSheet();
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
  <!--
    ⚠️ NOT CLOSABLE WHILE A PUBLISH IS IN FLIGHT. The X, the backdrop and Escape stayed live
    through the whole uncancellable publish — a window this work widened from 5s to 20s — and
    dismissing there destroyed the key record while the upload carried on and admitted the
    device anyway. The approver got no feedback at all, and telemetry carried both a
    `published` and a `dismissed` drop for one key. Reject is already disabled; this closes
    the other three doors.
  -->
  <BaseModal
    :open="open"
    :title="t('deviceApproval.title')"
    size="md"
    layer="overlay"
    :closable="!isPublishing"
    @close="closeSheet"
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
      <BaseButton class="w-full" variant="secondary" type="button" @click="closeSheet">
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
          :disabled="isPublishing"
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
          :disabled="isApproving || isPublishing"
          data-testid="approval-reject"
          @click="reject"
        >
          {{ t('deviceApproval.reject') }}
        </BaseButton>
      </div>
    </div>

    <!--
      ⚠️ TWO WEIGHTS, BECAUSE NOT EVERY MESSAGE HERE IS A FAILURE. Alert Red is reserved by
      the CIG for destructive confirmations and hard validation errors. "Your PIN is needed"
      and "this member has no PIN set" are neither — they are routine, and the component's
      own comment calls them "none of them a judgement about the request". Routine gets
      Heritage Orange, which is this product's alert colour; a genuine failure keeps red.
    -->
    <p
      v-if="errorKey"
      role="alert"
      class="mt-3 text-sm"
      :class="
        isRoutineNotice
          ? 'text-primary-700 dark:text-accent-lift'
          : 'dark:text-danger-lift text-red-600'
      "
    >
      {{ t(errorKey) }}
    </p>
  </BaseModal>
</template>
