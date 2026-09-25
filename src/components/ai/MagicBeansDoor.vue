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
 *     This component stays mounted while the drawer is open, so the ref stays live.
 *
 *  4. EVERY ACTION CLOSES THE SHEET BEFORE THE INGEST STARTS. See `MagicBeansSheet`'s header
 *     for the reasons; they are load-bearing and not to be relaxed.
 *
 *  5. `logCaptureOpened()` FIRES AT THE TAP, not at the ingest. It is the denominator for the
 *     whole in-app funnel, so abandonment is only measurable if it is recorded before the user
 *     has a chance to abandon.
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
import AiDocumentPicker from '@/components/ai/AiDocumentPicker.vue';
import MagicBeansSheet from '@/components/ai/MagicBeansSheet.vue';
import { deferConsentForStatement, useDocumentConsent } from '@/composables/useDocumentConsent';
import { availableShareKinds, useMagicReader } from '@/composables/useMagicReader';
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

function open(): void {
  logCaptureOpened();
  sheetOpen.value = true;
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
  if (hint === 'transactions') return deferConsentForStatement();
  const granted = await requestConsent();
  // A refusal or a decline ends this capture. The sheet stays open (the user may try again),
  // but any tap-time state a page is holding for it must be released now — otherwise a target
  // chosen here silently attaches the NEXT capture, from any door, to the wrong thing.
  if (!granted) emit('closed');
  return granted ?? null;
}

async function handlePaste(text: string, hint?: ShareKind): Promise<void> {
  const grant = await commit(hint);
  if (!grant) return;
  sheetOpen.value = false;
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
  holdGrant(grant, hint);
  sheetOpen.value = false;
  // `pickCamera` is the image-only `capture` input, NOT the mixed accept: in a Capacitor
  // WebView an `image/*,application/pdf` accept routes to the documents picker, which has no
  // camera entry.
  picker.value?.[pick]();
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

defineExpose({ open });
</script>

<template>
  <template v-if="canReadAny">
    <slot name="trigger" :open="open" />

    <AiDocumentPicker ref="picker" @file="handlePickedFile" />
    <MagicBeansSheet
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
