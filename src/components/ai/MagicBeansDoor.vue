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
import { onBeforeUnmount, ref } from 'vue';
import AiDocumentPicker from '@/components/ai/AiDocumentPicker.vue';
import MagicBeansSheet from '@/components/ai/MagicBeansSheet.vue';
import { useDocumentConsent } from '@/composables/useDocumentConsent';
import { useMagicReader } from '@/composables/useMagicReader';
import {
  IN_APP_ENV,
  ingestInAppSource,
  logCaptureOpened,
  refuseIfBusy,
} from '@/composables/useSharedDocumentIngest';
import type { ConsentGrant } from '@/composables/useDocumentConsent';
import type { InAppDestination } from '@/composables/useSharedDocumentIngest';

const props = defineProps<{
  /**
   * For the ONE door that fills itself in rather than dispatching by kind (the recipe form).
   * Offered the payload first; returning false falls through to the normal routing, so a
   * mismatched kind still lands on the page that owns it.
   */
  claim?: InAppDestination['claim'];
}>();

const { canReadAny } = useMagicReader();

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
 */
const PICKER_GRANT_TTL_MS = 2 * 60_000;
let pendingGrant: ConsentGrant | null = null;
let grantTimer: ReturnType<typeof setTimeout> | null = null;

function clearGrant(): void {
  pendingGrant = null;
  if (grantTimer) clearTimeout(grantTimer);
  grantTimer = null;
}

function holdGrant(grant: ConsentGrant): void {
  clearGrant();
  pendingGrant = grant;
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
}

/**
 * The commit path, shared by all three sources: refuse if busy, then consent, then act.
 *
 * Returns the grant, or `null` when the user has already been told why nothing happened —
 * a busy toast, or a silent decline. Either way the caller simply returns.
 */
async function commit(): Promise<ConsentGrant | null> {
  if (refuseIfBusy(IN_APP_ENV)) return null;
  const granted = await requestConsent();
  return granted ?? null;
}

async function handlePaste(text: string): Promise<void> {
  const grant = await commit();
  if (!grant) return;
  sheetOpen.value = false;
  // Deliberately not awaited: the ingest owns its own errors and runs for several seconds
  // behind the global reading overlay. Awaiting would keep this handler alive across a
  // navigation for no benefit.
  void ingestInAppSource({ kind: 'paste', text }, grant, destination());
}

async function handleCamera(): Promise<void> {
  const grant = await commit();
  if (!grant) return;
  holdGrant(grant);
  sheetOpen.value = false;
  // The image-only `capture` input, NOT the mixed accept: in a Capacitor WebView an
  // `image/*,application/pdf` accept routes to the documents picker, which has no camera entry.
  picker.value?.pickCamera();
}

async function handleFile(): Promise<void> {
  const grant = await commit();
  if (!grant) return;
  holdGrant(grant);
  sheetOpen.value = false;
  picker.value?.pickFile();
}

function handlePickedFile(file: File): void {
  const grant = pendingGrant;
  clearGrant();
  // No grant means it expired or was cleared — the picker returning late is the case the TTL
  // exists for. Silent is correct here: the user cancelled minutes ago and has moved on.
  if (!grant) return;
  void ingestInAppSource({ kind: 'file', file }, grant, destination());
}

defineExpose({ open });
</script>

<template>
  <template v-if="canReadAny">
    <slot name="trigger" :open="open" />

    <AiDocumentPicker ref="picker" @file="handlePickedFile" />
    <MagicBeansSheet
      :open="sheetOpen"
      @close="closeSheet"
      @submit="(text: string) => void handlePaste(text)"
      @camera="() => void handleCamera()"
      @file="() => void handleFile()"
    />
  </template>
</template>
