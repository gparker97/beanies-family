<script setup lang="ts">
/**
 * One magic-beans door, mounted wherever a page offers one.
 *
 * WHY THIS COMPONENT EXISTS
 * Before this, four pages each hand-rolled the same capture protocol, and each copy had to get
 * FIVE invariants right. Six copies of a five-invariant protocol is the largest maintenance
 * liability this feature could carry, and a seventh door would repeat it again. The page keeps
 * its own affordance via the `#trigger` slot — discoverability is the whole reason a page has a
 * magic-beans button — and everything below the tap lives here, once.
 *
 * THE FIVE INVARIANTS, in the order they run:
 *
 *  1. REFUSE IF BUSY, at the COMMIT — not at sheet-open. The sheet can sit open for a minute,
 *     and a busy check made then is answered before the question exists. `withIngestLock`
 *     inside the spine is still the authority, but it is taken AFTER the picker: without this
 *     check the user answers a consent prompt, takes a photo, and only then gets refused, which
 *     discards work already done.
 *
 *  2. CONSENT AT THE COMMIT, before the picker opens. ADR-030 is per-document consent, and
 *     nothing leaves the device before it either way — but asking first means a decline costs
 *     the user nothing, where asking after a photo is taken throws that photo away.
 *
 *  3. THE PICKER IS MOUNTED HERE, never inside the sheet. On native the camera intent
 *     backgrounds the app; if the component holding the hidden input unmounts while that is
 *     happening, the `change` callback lands on a dead input and the photo silently vanishes.
 *     This component stays mounted while the drawer is open, so the ref stays live. An `inline`
 *     host mounts the door OUTSIDE whatever surface it closes on handoff (the quick-add sheet
 *     mounts it at its root, outside its Teleport), for the same reason.
 *
 *  4. EVERY ACTION CLOSES THE SHEET, OR EMITS `handoff` SO AN `inline` HOST CLOSES ITS SURFACE,
 *     BEFORE THE INGEST STARTS. The host MUST close synchronously in its `handoff` listener
 *     (Vue runs emit listeners synchronously, so the close completes before the next line calls
 *     the ingest or the picker). See `MagicBeansSheet`'s header for the reasons; they are
 *     load-bearing and not to be relaxed.
 *
 *  5. `logCaptureOpened()` FIRES AT THE TAP, not at the ingest. It is the denominator for the
 *     whole in-app funnel, so abandonment is only measurable if it is recorded before the user
 *     has a chance to abandon. For an `inline` host, `open()` is called when the composer is
 *     shown (the FAB tap), and only records the denominator.
 *
 * INLINE MODE (#119). The FAB's quick-add surface draws its own composer (a chat-style field,
 * attach, camera, Send) instead of opening this door's drawer. It is a MODE of the one door,
 * not a second door, because the protocol above must exist exactly once: the host renders the
 * view and drives the door through the exposed `send` / `camera` / `file`, and every invariant
 * still runs here. With `inline` the door renders only its picker (no drawer, no trigger slot)
 * and tells the host to close via `handoff`.
 *
 * `inline` is the ONLY mode flag this door will ever gain. A second host-driven variation must
 * be a new decision, not another prop: the `inline` branches are confined to the template's
 * two `v-if`s and one line of `open()` (`handOff` serves both modes), so removing either mode
 * later is a local edit.
 *
 * THE GATE. `canReadAny`, uniformly. The per-kind gates the pages used (`canReadPhoto` on the
 * planner, `canReadDocument` on travel) are gone: after unification every door can produce every
 * kind, so a per-kind gate would hide a working affordance. That is a deliberate, visible
 * change — with `aiTravelExtract` off and `aiPhotoExtract` on, Travel now shows a button that
 * can still make an activity. Both flags are on in production, so it is a dev-gating difference.
 *
 * The trigger lives INSIDE the slot so the gate removes the affordance and its tap together.
 * A rendered button whose `open()` optional-chains into nothing is a dead tap with no trace.
 */
import { computed, onBeforeUnmount, ref } from 'vue';
import { useToast } from '@/composables/useToast';
import { useTranslation } from '@/composables/useTranslation';
import { logEvent } from '@/services/telemetry/logEvent';
import { reportError } from '@/utils/errorReporter';
import AiDocumentPicker from '@/components/ai/AiDocumentPicker.vue';
import MagicBeansSheet from '@/components/ai/MagicBeansSheet.vue';
import { deferConsentForStatement, useDocumentConsent } from '@/composables/useDocumentConsent';
import { availableShareKinds, useMagicReader } from '@/composables/useMagicReader';
import { useAiCapability } from '@/composables/useAiCapability';
import {
  IN_APP_ENV,
  ingestInAppSource,
  logCaptureOpened,
  refuseIfBusy,
} from '@/composables/useSharedDocumentIngest';
import type { ConsentGrant, DeferredStatementConsent } from '@/composables/useDocumentConsent';
import type { InAppDestination } from '@/composables/useSharedDocumentIngest';
import type { ShareKind } from '@/types/magicPayload';

const emit = defineEmits<{
  /**
   * The door is finished with: the sheet closed without starting a capture, or the user
   * declined consent. A page holding state SET AT THE TAP (the travel page's trip target) must
   * drop it here, or the next capture from any other door inherits it.
   */
  (e: 'closed'): void;
  /**
   * A capture was committed (grant in hand, or the deferred statement marker) and the ingest or
   * picker starts on the next line. Emitted in both modes; an `inline` host MUST close its
   * surface synchronously here (invariant 4).
   */
  (e: 'handoff', source: 'paste' | 'camera' | 'file'): void;
}>();

const props = defineProps<{
  /**
   * For the ONE door that fills itself in rather than dispatching by kind (the recipe form).
   * Offered the payload first; returning false falls through to the normal routing, so a
   * mismatched kind still lands on the page that owns it.
   */
  claim?: InAppDestination['claim'];
  /**
   * The kind to pre-pick when the sheet opens: the surface the door sits on (the calendar and
   * activity drawer pick `event`, travel `travel`, the cookbook and recipe form `recipe`, the
   * Transactions page, Budget tile and add-transaction drawer `transactions`). The person can
   * still change or clear it. Only the app-wide doors (the quick-add sheet) leave it unset.
   */
  hint?: ShareKind;
  /**
   * The host draws its own composer and drives the door through the exposed `send` / `camera` /
   * `file` (#119, the FAB). The door then renders only its picker: no drawer, no trigger slot.
   */
  inline?: boolean;
}>();

const { canReadAny } = useMagicReader();

/**
 * Marks a pick that is this door's own pre-pick, left as it was: the SURFACE said what it is,
 * not the person. The ingest logs it apart (so the #108 pick metrics stay about people) and
 * does not tell the person "your pick wasn't needed" for a pick they never made.
 */
function surfaceHint(hint?: ShareKind): { hintFromSurface?: true } {
  return hint && hint === props.hint ? { hintFromSurface: true } : {};
}
const { showToast } = useToast();
const { t } = useTranslation();

/**
 * Which kinds the sheet may offer as an optional pick (#108): permission × flag, the same rule
 * the "not right?" banner uses. Decided HERE, not in the sheet, which is a view and knows
 * nothing about readers. Re-evaluates on a permission change; flags are reload-to-apply.
 */
const kinds = computed(availableShareKinds);

/** Built per capture so a `claim` swapped at runtime cannot be captured stale. */
const destination = (): InAppDestination | undefined =>
  props.claim ? { claim: props.claim } : undefined;
const { requestConsent } = useDocumentConsent();
const { refuseManagedReadIfReadOnly } = useAiCapability();

const sheetOpen = ref(false);
const picker = ref<InstanceType<typeof AiDocumentPicker> | null>(null);

/**
 * A grant minted for a picker that may never come back.
 *
 * `AiDocumentPicker` has NO cancel signal — there is no `@cancel` emit, and a cancelled native
 * camera never fires `change` at all. So a user who taps camera, consents, and backs out would
 * otherwise leave a live grant that the NEXT pick — a different document, possibly minutes
 * later — silently reuses. That is precisely the case `useDocumentConsent`'s header describes:
 * one prompt must answer for exactly one document.
 *
 * Three clearing rules, because the picker cannot tell us which one will fire: consumed by
 * `@file`, cleared on close/unmount, and expired by this timer. The timer is the only one that
 * covers a silent cancel.
 *
 * The person's optional pick (#108) is held IN THE SAME VALUE as the grant, so the three rules
 * cover it by construction: a grant that expires takes its hint with it, and a hint can never
 * outlive the consent it was made under.
 */
const PICKER_GRANT_TTL_MS = 2 * 60_000;
let pending: { grant: ConsentGrant | DeferredStatementConsent; hint?: ShareKind } | null = null;
let grantTimer: ReturnType<typeof setTimeout> | null = null;

function clearGrant(): void {
  pending = null;
  if (grantTimer) clearTimeout(grantTimer);
  grantTimer = null;
}

function holdGrant(grant: ConsentGrant | DeferredStatementConsent, hint?: ShareKind): void {
  clearGrant();
  pending = { grant, hint };
  grantTimer = setTimeout(clearGrant, PICKER_GRANT_TTL_MS);
}

onBeforeUnmount(clearGrant);

/**
 * Record the denominator and, in drawer mode, open the drawer. In `inline` mode it means "the
 * composer was shown" and only records the denominator; `context` segments it by entry point.
 */
function open(context?: { stage: 'composer'; format: 'phone' | 'desktop' }): void {
  logCaptureOpened(context);
  if (!props.inline) sheetOpen.value = true;
}

/** The slot's `open`, zero-argument so a `@click="open"` never passes its event as `context`. */
function openFromTrigger(): void {
  open();
}

/**
 * The commit is done and the capture starts on the caller's next line: close the drawer, or
 * tell an `inline` host to close its surface (invariant 4).
 */
function handOff(source: 'paste' | 'camera' | 'file'): void {
  sheetOpen.value = false;
  emit('handoff', source);
}

function closeSheet(): void {
  sheetOpen.value = false;
  clearGrant();
  emit('closed');
}

/**
 * The commit path, shared by all three sources: refuse if busy, then consent, then act.
 *
 * Returns the grant, or `null` when the user has already been told why nothing happened —
 * a busy toast, or a silent decline. Either way the caller simply returns.
 *
 * A Transactions pick (#107) is the one exception to consent-at-the-commit: a statement's cost
 * (one bean per page) is unknown until its pages are classified, and the statement consent
 * states it. So this returns the DEFERRED marker, and the spine asks once the count is known.
 */
async function commit(hint?: ShareKind): Promise<ConsentGrant | DeferredStatementConsent | null> {
  if (refuseIfBusy(IN_APP_ENV)) {
    // A refusal ends this capture as surely as a decline does — the comment below applies to
    // both, so the emit has to be on both paths.
    emit('closed');
    return null;
  }
  // Read-only (#95): refuse here, before the picker, so a family never takes a photo that cannot
  // be read. `requestConsent` checks too, but a Transactions pick defers consent until after the
  // picker, so without this line that path would open the camera first.
  if (refuseManagedReadIfReadOnly()) {
    emit('closed');
    return null;
  }
  if (hint === 'transactions') return deferConsentForStatement();
  const granted = await requestConsent();
  // A refusal or a decline ends this capture. The sheet stays open (the user may try again),
  // but any tap-time state a page is holding for it must be released now — otherwise a target
  // chosen here silently attaches the NEXT capture, from any door, to the wrong thing.
  if (!granted) {
    // The one refusal nobody else logs (busy and read-only log in their own helpers), so every
    // refused Send is visible once, in the layer that owns it.
    logEvent({
      level: 'info',
      surface: IN_APP_ENV.surface,
      message: 'consent declined at the door',
      context: { action: 'consent_declined', stage: 'commit' },
    });
    emit('closed');
  }
  return granted ?? null;
}

async function handlePaste(text: string, hint?: ShareKind): Promise<void> {
  const grant = await commit(hint);
  if (!grant) return;
  handOff('paste');
  // Deliberately not awaited: the ingest owns its own errors and runs for several seconds
  // behind the global reading overlay. Awaiting would keep this handler alive across a
  // navigation for no benefit.
  void ingestInAppSource({ kind: 'paste', text, hint, ...surfaceHint(hint) }, grant, destination());
}

/**
 * Camera and file are one path with one difference — which picker opens — so they are one
 * function. The grant (and the pick) are held for the picker, which comes back later, if at all.
 */
async function commitToPicker(pick: 'pickCamera' | 'pickFile', hint?: ShareKind): Promise<void> {
  const grant = await commit(hint);
  if (!grant) return;
  // A missing picker used to be a silent `?.` no-op that held the grant, closed the sheet and
  // did nothing. Checked BEFORE the handoff so the surface stays open with the person's work.
  if (!picker.value) {
    clearGrant();
    console.error(
      '[MagicBeansDoor] picker ref missing; the AiDocumentPicker did not mount (is the door inside a v-if that is false?)'
    );
    logEvent({
      level: 'error',
      surface: IN_APP_ENV.surface,
      message: 'picker ref missing at commit',
      context: { action: 'picker_missing', kind: pick === 'pickCamera' ? 'camera' : 'file' },
    });
    showToast('error', t('ai.picker.openErrorTitle'), t('ai.picker.openErrorBody'));
    return;
  }
  holdGrant(grant, hint);
  handOff(pick === 'pickCamera' ? 'camera' : 'file');
  // `pickCamera` is the image-only `capture` input, NOT the mixed accept: in a Capacitor
  // WebView an `image/*,application/pdf` accept routes to the documents picker, which has no
  // camera entry.
  picker.value[pick]();
}

function handlePickedFile(file: File): void {
  const held = pending;
  clearGrant();
  // No grant means it expired or was cleared while the picker was open.
  //
  // ⚠️ NOT silent. The TTL exists because `AiDocumentPicker` has no cancel signal, so the only
  // way to stop a grant outliving an abandoned pick is to time it out — but a photo the user
  // spent three minutes composing (or took while the app was backgrounded on Android, where
  // the timer keeps running) then arrives and is dropped with nothing said. That is data loss
  // on a path that used to always work, and this door is the shared one for six surfaces.
  //
  // Telling them costs one toast, and the event is what makes the TTL's real rate measurable
  // before anyone argues about its length.
  if (!held) {
    logEvent({
      level: 'warn',
      surface: IN_APP_ENV.surface,
      message: 'a picked file arrived after its consent grant expired',
      context: { action: 'rejected_type', detail: 'grant_expired' },
    });
    showToast('info', t('ai.picker.expired.title'), t('ai.picker.expired.message'));
    return;
  }
  void ingestInAppSource(
    { kind: 'file', file, hint: held.hint, ...surfaceHint(held.hint) },
    held.grant,
    destination()
  );
}

/**
 * The `inline` host's actions share ONE guard. The host never renders its composer while no
 * reader is enabled, so this is a no-dead-tap net, not a path: it logs and does nothing.
 *
 * The exposed actions are fire-and-forget for the host, so a rejection anywhere in the commit
 * (a throw in the busy / read-only checks, the consent prompt, the picker) is caught HERE and
 * reported on this door's surface with the action, rather than escaping to the global
 * `unhandledrejection` catch-all, which knows neither, and the person gets an error toast.
 */
function whenReadable(action: 'send' | 'camera' | 'file', fn: () => Promise<void>): void {
  if (!canReadAny.value) {
    logEvent({
      level: 'warn',
      surface: IN_APP_ENV.surface,
      message: 'inline door action while no reader is enabled',
      context: { action: 'inline_unreadable' },
    });
    return;
  }
  fn().catch((error: unknown) => {
    reportError({
      surface: IN_APP_ENV.surface,
      message: 'inline door action failed',
      severity: 'error',
      error,
      context: { action },
    });
    // The person tapped and nothing happened: say so. Generic AI copy, not the picker-missing
    // keys, because those name the camera / file picker and this also catches Send.
    showToast('error', t('ai.error.title'), t('ai.error.generic'));
  });
}

/** Send pasted text through the protocol (the composer's Send). */
function send(text: string): void {
  whenReadable('send', () => handlePaste(text, props.hint));
}

function camera(): void {
  whenReadable('camera', () => commitToPicker('pickCamera', props.hint));
}

function file(): void {
  whenReadable('file', () => commitToPicker('pickFile', props.hint));
}

defineExpose({ open, send, camera, file });
</script>

<template>
  <template v-if="canReadAny">
    <slot v-if="!inline" name="trigger" :open="openFromTrigger" />

    <AiDocumentPicker ref="picker" @file="handlePickedFile" />
    <MagicBeansSheet
      v-if="!inline"
      :open="sheetOpen"
      :kinds="kinds"
      :initial-hint="props.hint"
      @close="closeSheet"
      @submit="(text: string, hint?: ShareKind) => void handlePaste(text, hint)"
      @camera="(hint?: ShareKind) => void commitToPicker('pickCamera', hint)"
      @file="(hint?: ShareKind) => void commitToPicker('pickFile', hint)"
    />
  </template>
</template>
