<script setup lang="ts">
/* global FileSystemFileHandle, FileSystemHandle */
import { ref, computed, onMounted, watch } from 'vue';
import { payloadErrorMessageKey, PayloadLoadError, type RemoteBlocker } from '@/types/sync';
import { reportPayloadFailure } from '@/utils/payloadFailureSurface';
import { assertNever } from '@/utils/assertNever';
import { describePickFailure } from '@/services/google/drivePicker';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BeanieSpinner from '@/components/ui/BeanieSpinner.vue';
import GoogleDriveFilePicker from '@/components/google/GoogleDriveFilePicker.vue';
import LoginChoiceCard from './LoginChoiceCard.vue';
import RecoveryKitLink from './RecoveryKitLink.vue';
import NoPodEmptyState from './NoPodEmptyState.vue';
import { features } from '@/config/features';
import { useTranslation } from '@/composables/useTranslation';
import PasteLinkPanel from '@/components/login/PasteLinkPanel.vue';
import ScanFirstBlock from '@/components/login/ScanFirstBlock.vue';
import ColdSignInPanel from '@/components/login/ColdSignInPanel.vue';
import { useSettingsStore } from '@/stores/settingsStore';
import { useSyncStore } from '@/stores/syncStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { useAuthStore } from '@/stores/authStore';
import {
  getGoogleAccountEmail,
  isTokenValid,
  whenRedirectAuthSettled,
} from '@/services/google/googleAuth';
import { tryReconnectSilently } from '@/services/google/driveTokenRecovery';
import { useGoogleReconnect, reconnectSucceeded } from '@/composables/useGoogleReconnect';
import { supportsFileSystemAccess, canUseLocalFiles, isNative } from '@/services/sync/capabilities';
import { usePickBeanpodFile } from '@/composables/usePickBeanpodFile';
import { logEvent } from '@/services/telemetry/logEvent';
import { classifyDriveFailure } from '@/utils/podAccess';
import { reportError } from '@/utils/errorReporter';
import {
  emitEnvelopeCapabilitiesChanged,
  emitKitRedeemed,
} from '@/services/telemetry/loginFlowEvents';
import { fillTemplate } from '@/utils/fillTemplate';
import { LOAD_DRIVE_PATH, RECONNECT_LOAD_PATH } from './resumePaths';
import {
  envelopeCapabilities,
  coldCredentialSurface,
  secretFieldFor,
} from '@/services/sync/fileSync';
import type { RecoveryOpener } from '@/composables/useLoginFlow';
import { isPodFileName } from '@/constants/beanpodFile';

const { t } = useTranslation();
const settingsStore = useSettingsStore();
const syncStore = useSyncStore();
const familyContextStore = useFamilyContextStore();
const authStore = useAuthStore();

const props = defineProps<{
  needsPermissionGrant?: boolean;
  autoLoad?: boolean;
  /**
   * Set by `LoginPage` when returning from a Drive-load OAuth redirect
   * (`?resume=load-drive`). Re-opens the Google Drive file picker with the
   * now-cached token. Consumed via an `immediate` watch (NOT `onMounted`):
   * on native the deep-link `router.replace` keeps this component mounted, so
   * `onMounted` would never re-fire. See ADR-029.
   */
  autoOpenDrivePicker?: boolean;
  /**
   * Set by the `?resume=reconnect-load` return. Re-enters the reconnect, which
   * short-circuits on the token the first tap already obtained.
   */
  autoReconnectLoad?: boolean;
  forceNewGoogleAccount?: boolean;
  loadError?: string;
  providerHint?: 'local' | 'google_drive';
  /**
   * When set, the picked family's pod lives on Google Drive at this exact
   * file but the token is gone (post-sign-out). Renders the focused
   * "reconnect to load <family>" panel instead of the generic storage cards —
   * one consent, then load this fileId directly (no list, no picker).
   */
  reconnectDriveFile?: { fileId: string; fileName: string; familyName?: string };
  /**
   * Open the decrypt panel straight in recovery-kit entry (the prove screen's
   * "use a recovery kit" escape routes here). The password form stays one tap away.
   */
  startInKitEntry?: boolean;
  /** Pre-fill the kit code (the QR deep link landed here with the code in the fragment). */
  prefillKitCode?: string;
}>();

const emit = defineEmits<{
  back: [];
  /**
   * ⚠️ Carries WHICH family-level secret opened the pod, not merely THAT one did.
   *
   * This was `source?: 'recovery'` — one value for two secrets — and `LoginPage` mapped
   * every `'recovery'` to `'kit'`. So a family passphrase typed into the box below
   * arrived at the prove screen labelled a recovery kit: it was told "you're in with your
   * recovery kit", led with a PIN reset, and (once the reset became kit-only) passed an
   * authorization gate meant to exclude it. A one-bit channel cannot carry a two-value
   * distinction, and the receiver had to invent the missing half.
   */
  'file-loaded': [openedBy?: RecoveryOpener | null];
  'signed-in': [destination: string];
  'request-create': [];
}>();

const isLoadingFile = ref(false);
const formError = ref<string | null>(null);
/**
 * Reveal "Use a different Google account" beneath the open-saved-file button.
 *
 * Set only after a cancelled Picker: an empty chooser is what a wrong-account session looks
 * like, and that is the moment the escape becomes useful rather than noise.
 */
const showAccountSwitch = ref(false);
const showDecryptModal = ref(false);
const decryptPassword = ref('');
/** Recovery-kit entry mode on the decrypt panel (login rethink Phase 3). */
const showKitEntry = ref(false);
watch(
  () => showDecryptModal.value,
  (open) => {
    if (!open || !props.startInKitEntry) return;
    // ⚠️ FAIL OPEN, and the shape matters. A legacy password-only family tapping "use a
    // recovery kit" used to land on a Recovery Code field over an envelope with no kit wraps.
    // But gating on `caps.kit` being TRUE would break the open-pod escape path: `caps` derives
    // from `pendingEncryptedFile?.envelope`, and on that path nothing is staged, so `caps` is
    // null and a truthy check would suppress the panel greg reported as missing. Only a
    // KNOWN-kitless envelope suppresses it — the same `!!caps.value && !caps.value.kit` shape
    // this file already uses elsewhere.
    if (!!caps.value && !caps.value.kit) {
      // ⚠️ NOT A SILENT RETURN. This suppresses the kit panel for a provably kitless envelope,
      // which is correct — but it also discards a `prefillKitCode` the user or a deep link
      // actually supplied, so the report is "my recovery link does nothing". Without an event
      // there is no way to tell that apart from "caps was null so we failed open" or "they
      // never tapped it", which are three different bugs.
      logEvent({
        level: 'info',
        surface: 'login-flow',
        message: 'kit entry suppressed: envelope has no kit wraps',
        context: { kind: props.prefillKitCode ? 'kit-prefill-discarded' : 'kit-entry-requested' },
      });
      return;
    }
    showKitEntry.value = true;
    if (props.prefillKitCode) kitCodeInput.value = props.prefillKitCode;
  }
);

/** Photo/screenshot scan: decode the printed kit's QR instead of transcribing 32 chars. */
/** Photo/PDF scan in flight — a PDF render takes a few seconds; the label shows it. */
const isScanningKit = ref(false);

async function handleKitPhotoPicked(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  (event.target as HTMLInputElement).value = '';
  if (!file || isScanningKit.value) return;
  formError.value = null;
  isScanningKit.value = true;
  try {
    const { decodeQrFromImageFile } = await import('@/utils/qrDecode');
    const decoded = await decodeQrFromImageFile(file, 'recovery-kit');
    if (!decoded.ok) {
      // Four reasons, four messages. "We couldn't find a code in that photo" is only honest
      // for `no-code`; saying it when the decoder chunk failed to load sends someone to
      // re-photograph a perfectly good kit.
      formError.value = t(
        decoded.reason === 'no-code'
          ? 'recovery.kitScanFailed'
          : decoded.reason === 'unsupported-device'
            ? 'qrScan.unsupportedDevice'
            : decoded.reason === 'decoder-unavailable'
              ? 'qrScan.decoderUnavailable'
              : 'qrScan.unreadableImage'
      );
      if (decoded.reason !== 'no-code') {
        reportError({
          surface: 'login-flow',
          message: 'kit QR decode failed',
          severity: 'warning',
          error: decoded.cause,
          // The outcome counter (success AND `no-code`) is emitted by the decoder itself on
          // the `qr-decode` surface, for every caller. This stays `login-flow`: it is the
          // kit-redemption flow's own failure report, and it carries the cause.
          context: {
            action: 'kit_scan_failed',
            error_code: decoded.reason,
            detail: `tried=${decoded.attempts.join(',') || 'none'}`,
          },
        });
      }
      return;
    }
    const { parseKitInput } = await import('@/services/auth/recoveryKit');
    kitCodeInput.value = parseKitInput(decoded.data);
  } catch (e) {
    // ⚠️ There was a `try`/`finally` here but no `catch`, so a rejected dynamic import —
    // an offline first-load of the pdf.js or jsqr chunk is the realistic case — settled
    // the spinner and left the screen looking idle, with nothing said and nothing logged.
    // Promoting kit scanning to a primary path makes that the failure people actually hit.
    formError.value = t('recovery.kitScanFailed');
    reportError({
      surface: 'login-flow',
      message: 'kit QR decode failed',
      severity: 'warning',
      error: e,
      context: { action: 'kit_scan_failed' },
    });
  } finally {
    isScanningKit.value = false;
  }
}
/**
 * Can a device approval actually complete here?
 *
 * Two conditions, both learned the hard way:
 *
 * 1. A file must be STAGED. `caps` is null in the "recovery-kit escape from an already-open
 *    pod" state, so gating on `nothingCanOpenIt` mounted this over a live document.
 * 2. The pod must live where BOTH devices can reach it. The approver writes their wrap into
 *    the shared `.beanpod`; for a family on a LOCAL file there is no shared file by
 *    definition, so the code would be the visually dominant action on the screen and could
 *    never be approved — three minutes of waiting ending in "expired".
 */
const canUseDeviceApproval = computed(
  () => syncStore.hasPendingEncryptedFile && syncStore.storageProviderType === 'google_drive'
);

const kitCodeInput = ref('');
/**
 * What the pending envelope can actually be opened with. ONE derivation for this whole
 * screen — the kit form, the password affordance and the degenerate terminal all read it,
 * so they cannot disagree about the same envelope.
 */
const caps = computed(() => {
  const env = syncStore.pendingEncryptedFile?.envelope;
  return env ? envelopeCapabilities(env) : null;
});
/** Whether the pending envelope carries any recovery-kit wraps at all. */
const hasRecoveryKits = computed(() => !!caps.value?.kit);
/**
 * Every string that names the secret this screen is asking for, chosen ONCE.
 *
 * ⚠️ THE MAPPING NOW LIVES IN `fileSync.secretFieldFor`, beside `coldCredentialSurface`,
 * because Settings' own `.beanpod` decrypt modal asks the identical question. It used to
 * be inline here while Settings hard-coded password wording, so a kit-born family
 * restoring from Settings was offered a credential that cannot exist for them. Keep the
 * decision in one place; this computed is only the reactive wrapper.
 *
 * The heading and subtitle are deliberately NOT members of the set: they describe the
 * STEP (decrypt this beanpod), not the credential, so they are constant across all cases.
 */
const secretField = computed(() => secretFieldFor(caps.value));
/**
 * True when nothing in this envelope can open it — no password wrap, no kit, no
 * passphrase. Only reachable from a hand-edited or truncated file, since a family always
 * gets a kit at birth. The screen then shows the honest message and NO credential field:
 * a box the person cannot possibly fill is the defect this whole change removes.
 */
const nothingCanOpenIt = computed(
  () => !!caps.value && coldCredentialSurface(caps.value) === 'none'
);
const loadedFileName = ref<string | null>(null);
const isDragging = ref(false);
const selectedSource = ref<'google_drive' | 'dropbox' | 'icloud' | 'local' | null>(null);
let dragCounter = 0;

const { pick: pickBeanpodFromDrive } = usePickBeanpodFile();

/**
 * Whether to show the "Load a saved family file" aside at all. True when the
 * platform can service *some* backend — a local file (`canUseLocalFiles()`:
 * web File System Access on Chromium, or native @capacitor/filesystem) OR the
 * Google Picker (available whenever Drive is configured). It is hidden only
 * where neither can run, which never happens on a Google-configured build (a
 * signed-in user always has the Picker). Gates on `canUseLocalFiles()`, never
 * the narrower `supportsFileSystemAccess()` — that was the #47 honesty bug.
 */
const canOpenSavedFile = computed(() => canUseLocalFiles() || syncStore.isGoogleDriveAvailable);

/**
 * Sticky "we already checked Drive and it was empty" flag. Drives both:
 *   - the dimmed + "Checked — nothing found" treatment on the Drive storage
 *     card (so a back-navigation user doesn't re-click a fresh-looking
 *     button and feel stuck in the same loop the panel was meant to break);
 *   - acts as a soft barrier rather than a hard disable — the card stays
 *     clickable for the rare "I just copied a pod file to Drive" case.
 *
 * Contract (mirrors the plan):
 *   - Set true:  any Drive lookup (initial / retry / switch-account)
 *                completes successfully with zero .beanpod files.
 *   - Set false: any Drive lookup returns ≥1 file (we found pods, no longer
 *                an empty account).
 *   - Reset:     implicit on component unmount — user navigating back to
 *                WelcomeGate and re-entering Sign In gets fresh cards.
 */
const lastDriveCheckEmpty = ref(false);

/**
 * The line under the heading: what THIS step does, and what comes after it.
 *
 * ⚠️ Names no credential, so it is one string rather than one per capability — the field
 * label directly below already names the credential, and a subtitle that also did needed a
 * variant per case, which is the drift that produced the original bug. It is also why the
 * kit form keeps this line: redeeming a kit decrypts the beanpod exactly as a password
 * does, so the sentence is true on both paths.
 *
 * `null` only for the degenerate envelope, where "next you'll sign in" would be a promise
 * the screen cannot keep.
 */
const unlockSubtitle = computed<string | null>(() => {
  if (nothingCanOpenIt.value) return null;
  // ⚠️ Nothing is being decrypted on the recovery-kit escape from an OPEN pod: the kit is
  // proving identity against the live envelope, and the person is already past family
  // selection. "This decrypts your family's data. Next, you'll sign in as a member." is
  // false on both halves there.
  if (!syncStore.hasPendingEncryptedFile) return null;
  // ⚠️ NO LONGER PER-FAMILY, so no ternary and no `fillTemplate`. The subtitle used to name
  // the family inside a sentence explaining the two-step model; it is now one short line that
  // says what happens next, because the heading directly above already names the beanpod.
  return t('loginV6.unlockSubtitle');
});

/** Number of members with wrapped keys in the pending envelope. */
const pendingMemberCount = computed(() => {
  const keys = syncStore.pendingEncryptedFile?.envelope?.wrappedKeys;
  return keys ? Object.keys(keys).length : 0;
});

/**
 * Try to auto-decrypt using a cached family key from trusted device settings.
 * Returns true if decryption succeeded.
 */
/**
 * This pod will not open on this device, for a reason no credential can fix.
 *
 * Read by `handlePendingPassword` (never open a password form for it — that is
 * a retype loop) and by `openKitEntry` (never wipe the explanation). Reset by
 * `resetPodUnopenable()` whenever the user picks a DIFFERENT file, or the
 * latch would silently dead-end every later selection in the session.
 */
const podUnopenableHere = ref(false);
/**
 * A payload message is currently on screen (any class, latched or not). Kept
 * separate from `podUnopenableHere`, which decides whether to STOP offering
 * credentials: the recoverable credential case does not latch but still wants
 * its explanation carried across when the user switches to the kit form.
 */
const payloadExplanationShown = ref(false);
function resetPodUnopenable(): void {
  podUnopenableHere.value = false;
  payloadExplanationShown.value = false;
}

/** Leave the kit form. Mirrors `openKitEntry`: a payload explanation survives. */
function closeKitEntry(): void {
  showKitEntry.value = false;
  if (!payloadExplanationShown.value) formError.value = null;
}

/**
 * Open the recovery-kit form. Clears a CREDENTIAL error (the user is switching
 * method, so "wrong password" is stale) but keeps a payload one: that message
 * explains why nothing is working, and wiping it left a kit form with no
 * explanation — on the one escape hatch this whole path exists to preserve.
 */
function openKitEntry(): void {
  showKitEntry.value = true;
  // Keep a payload explanation. The user is switching method because nothing is
  // working, and `podUnopenableHere` is NOT the right flag for it: the
  // credential case deliberately does not latch, yet its message is exactly the
  // one worth carrying across to the kit form.
  if (!payloadExplanationShown.value) formError.value = null;
}

async function tryAutoDecrypt(): Promise<boolean> {
  const pendingFamilyId = syncStore.pendingEncryptedFile?.envelope?.familyId;
  if (!pendingFamilyId) return false;

  // Try cached family key from trusted device
  const cachedKey = await settingsStore.getCachedFamilyKey(pendingFamilyId);
  if (cachedKey) {
    try {
      const { importFamilyKey } = await import('@/services/crypto/familyKeyService');
      const { base64ToBuffer } = await import('@/utils/encoding');
      const raw = new Uint8Array(base64ToBuffer(cachedKey));
      const fk = await importFamilyKey(raw);
      const result = await syncStore.decryptPendingFileWithKey(fk);
      if (result.success) return true;
      if (result.payloadError) {
        // ⚠️ ONE question decides everything here: could the KEY be wrong?
        //
        // Neither the class nor the step answers it alone, and both ad-hoc
        // versions of this check shipped and were wrong. `keyMayBeWrong` is the
        // single derivation (see `PayloadLoadError`): true only for a
        // corrupt-class failure at the decrypt step, because that is the only
        // shape where the AES-GCM tag was actually checked and rejected.
        // ⚠️ `instanceof` HERE, deliberately. Only the payload family can
        // answer "could the key be wrong" — a lineage or merge block has
        // nothing to do with the credential, so it must take the keep-the-key
        // branch rather than falling through to `clearCachedFamilyKey`.
        const keyMayBeWrong =
          result.payloadError instanceof PayloadLoadError && result.payloadError.keyMayBeWrong;
        if (!keyMayBeWrong) {
          // The key is provably fine (or was never checked, because the device
          // ran out of memory). Deleting it would cost trusted-device auto-open
          // permanently for a problem it has nothing to do with.
          payloadExplanationShown.value = true;
          // ⚠️ NOT EVERY BLOCKER IS A DEAD END, AND TREATING THEM ALIKE LOCKED
          // PEOPLE OUT. `podUnopenableHere` closes the password form AND the
          // recovery-kit form for the rest of the session (`:342` returns
          // early), which is right for a damaged pod and wrong for a local
          // cache that another tab happened to be holding: that clears by
          // closing the other tab and reloading, and the person needs the
          // password form to still be there.
          //
          // The inline copy is the SYNC-BAR copy too — it names "Use the family
          // file below" and Settings, neither of which exists on this screen.
          // So a `local-unreadable` block gets the copy written for a surface
          // with no app shell, and leaves the forms open.
          const localCacheHeld = result.payloadError.blockCode === 'local-unreadable';
          formError.value = t(
            localCacheHeld ? 'resumeSetup.podLocalUnreadable' : result.payloadError.inlineMessageKey
          );
          podUnopenableHere.value = !localCacheHeld;
          return false;
        }
        // Otherwise a stale/rotated key: say nothing here (the password form
        // below opens the pod on the first try) and fall through to
        // `clearCachedFamilyKey` so the bad key does not persist.
      }
    } catch (e) {
      // Never silent: this deletes a credential.
      console.warn('[LoadPodView] cached family key discarded after a failed decrypt', e);
    }
    await settingsStore.clearCachedFamilyKey(pendingFamilyId);
  }

  return false;
}

/**
 * Shared "the file is encrypted — now what?" handoff (2026-06-19, finding 14).
 * Previously copy-pasted across all six load entry points (auto-load, grant-
 * permission, manual load, drop, Drive pick), each with a slightly different
 * `loadedFileName` source and drifting subtly. One helper:
 *   auto-decrypt (when applicable) → biometric → password modal.
 *
 * `opts.tryAuto` preserves the per-site variance Pass 4 flagged: the manual-load
 * and drop paths historically did NOT attempt a cached-key auto-decrypt, so they
 * pass `tryAuto: false`; the rest default to `true` (and emit `file-loaded` if
 * the cached key opens it).
 */
/**
 * Single "a family finished loading" chokepoint. Every successful load path
 * routes through here instead of emitting `file-loaded` directly, so the
 * invariant "a loaded family always has a durable, writable save target" holds
 * universally (#47).
 *
 * `establishDurableHomeAfterLoad()` is idempotent and family-scoped: a no-op on
 * the Google-Drive-listing and File-System-Access paths (which already installed
 * a provider during decrypt), so this is a guaranteed no-op for the common
 * same-account login. It only actually re-homes the native `<input type=file>`
 * fallback, which stages an envelope with no provider. A throw here must never
 * block the user reaching their already-decrypted, visible data — the store
 * action already pages loudly on a hard no-target case.
 */
/**
 * The idempotent, never-blocking "establish a durable writable home for the
 * just-loaded family" step. Extracted so BOTH `finishLoaded` (every `file-loaded`
 * path) AND the single-member auto-sign-in branch (which emits `signed-in` without
 * routing through `finishLoaded`) share ONE implementation (B2). A throw must never
 * block the user reaching their already-decrypted, visible data — the store action
 * already pages loudly on a hard no-target case.
 */
async function ensureDurableHome() {
  try {
    // Verifies and REPORTS; never creates or switches files. A failure lands in
    // `syncStore.podAccessError`, which `PodAccessBanner` renders at the app
    // level — this view renders nothing for it, so the failure survives the
    // transition off the login screen (which is the point: the user is now
    // inside the app looking at data that isn't saving).
    await syncStore.verifyPodAccess();
  } catch (e) {
    // `verifyPodAccess` has its own internal catch; this is the last resort so a
    // throw can never block the user reaching already-decrypted data.
    console.error('[LoadPodView] verifyPodAccess failed:', e);
    reportError({
      surface: 'pod-access',
      severity: 'critical',
      message: 'pod access verification threw at the load boundary',
      error: e,
      context: { action: 'VERIFY_UNAVAILABLE' },
    });
  }
}

async function finishLoaded(openedBy?: RecoveryOpener | null) {
  await ensureDurableHome();
  emit('file-loaded', openedBy);
}

async function handlePendingPassword(
  fileName: string | null,
  opts: { tryAuto?: boolean } = {}
): Promise<void> {
  // 2026-08-28 rethink: this surface makes NO biometric decision any more — the single
  // prove engine (`resolveProveMethods`) owns that, on the machine's prove screen. This
  // view is pure fetch/decrypt bootstrap now: cached-key auto-decrypt, else password.
  if ((opts.tryAuto ?? true) && (await tryAutoDecrypt())) {
    await finishLoaded();
    return;
  }
  loadedFileName.value = fileName;
  // Phase 4: a kit-born envelope has NO password wraps — a password can never
  // open it. Open the decrypt surface straight in recovery-kit entry (the
  // passphrase stays available inside the modal's flow) instead of showing a
  // password form that is guaranteed to fail.
  // No credential can make the pod fit in this device's memory, so a password
  // form (or the kit form) here is a retype loop with the honest message
  // wiped by the first submit. Leave the message on screen instead.
  if (podUnopenableHere.value) return;
  const c = caps.value;
  if (c && !c.password) {
    // ⚠️ Keyed on `!c.password`, NOT on `envelopeNeedsRecovery`. That predicate is FALSE
    // for an envelope with no wraps of any kind, so keying on it let exactly that
    // envelope fall through to a password form and throw a crypto error on submit.
    const surface = coldCredentialSurface(c);
    if (surface === 'kit') {
      showKitEntry.value = true;
    } else if (surface === 'secret') {
      // A passphrase-only family lands here: the kit form would ask for a code they do
      // not have. `secretFieldFor` labels the field for them.
      showKitEntry.value = false;
    } else {
      // No password, no kit, no passphrase: nothing can open this file. Say so rather
      // than offering a Recovery Code field over an envelope with no kit wraps — that is
      // the same impossible offer, relocated. Only reachable from a hand-edited or
      // truncated file (a kit-born family always carries a kit at birth), which is
      // precisely why nothing used to handle it.
      formError.value = t('loginFlow.recoveryOnlyBody');
    }
  }
  showDecryptModal.value = true;
}

onMounted(async () => {
  if (props.loadError) {
    formError.value = props.loadError;
  }
  // The kit form was asked for explicitly and there is nothing to load (the pod is already
  // open, so `LoginPage` passed `autoLoad: false`). Open the panel directly; the watcher
  // above puts it straight into kit entry. Without this the screen sat on the storage
  // picker, because every route into the panel ran through a FILE LOAD that this case has
  // no need of.
  if (props.startInKitEntry && !props.autoLoad) {
    showDecryptModal.value = true;
  }
  if (props.providerHint === 'local') {
    selectedSource.value = 'local';
  }
  if (props.autoLoad) {
    await autoLoadFile();
  }
});

/**
 * Re-read the staged envelope before deciding what to offer, so a recovery credential
 * added on ANOTHER device is visible here.
 *
 * The bug this closes: set a recovery passphrase on device A, and device B — holding an
 * envelope staged before that write — was told "no wrapped keys" and had no way in. The
 * short-circuit above never re-fetches.
 *
 * ⚠️ ONLY when the configured handle points at the SAME family. That short-circuit exists
 * because the handle "may still point to the previous family's file", so an unconditional
 * re-read could replace a file the user explicitly opened (the /open "Open with" gesture)
 * with the configured family's one. Do not delete the reason along with the branch.
 *
 * Best-effort by design: on failure we keep the envelope we already have and carry on, so
 * an offline device still reaches the kit form. Never silent — a failure is reported.
 */
async function refreshStaleEnvelope(): Promise<void> {
  const pending = syncStore.pendingEncryptedFile;
  const before = caps.value;
  if (!pending || !before) return;
  // Same family only — the configured handle "may still point to the previous family's
  // file" (see the caller), which is the reason that short-circuit exists.
  if (pending.envelope?.familyId !== familyContextStore.activeFamilyId) return;
  // ⚠️ And ONLY for a file we fetched from the configured provider. A file the USER
  // picked (the /open "Open with" gesture, a drop, the OS picker) carries a `fileHandle`
  // or a `provider`; re-reading over it would silently swap the bytes they deliberately
  // chose — say, a good local copy after a bad Drive sync — for the provider's.
  if (pending.fileHandle || pending.provider) return;

  try {
    await syncStore.loadFromFile();
  } catch (e) {
    // `loadFromFile` throws the latched remote blocker. Keeping the staged envelope is
    // the right fallback — it is what we would have used anyway — but the fact that the
    // refresh failed must not vanish, or a stale-credential report is undiagnosable.
    reportError({
      surface: 'login-flow',
      message: 'recovery-route envelope refresh failed — using the staged envelope',
      error: e,
      severity: 'warning',
      context: { action: 'caps_refresh_failed' },
    });
    return;
  }

  const after = caps.value;
  if (
    after &&
    (after.password !== before.password ||
      after.passphrase !== before.passphrase ||
      after.kit !== before.kit)
  ) {
    emitEnvelopeCapabilitiesChanged({ before, after });
  }
}

async function autoLoadFile() {
  isLoadingFile.value = true;
  formError.value = null;
  resetPodUnopenable(); // a different file may well open

  try {
    // If there's already a pending encrypted file (e.g. from loadFromNewFile() before
    // a biometric fallback), go straight to decrypt flow instead of re-reading from
    // the configured handle — which may still point to the previous family's file.
    if (syncStore.hasPendingEncryptedFile) {
      await refreshStaleEnvelope();
      await handlePendingPassword(syncStore.fileName);
      isLoadingFile.value = false;
      return;
    }

    const loadResult = await syncStore.loadFromFile();
    if (!loadResult.success && loadResult.needsPassword) {
      await handlePendingPassword(syncStore.fileName);
    } else if (loadResult.success) {
      await finishLoaded();
    }
  } catch (e) {
    // File load failed — surface to the user (previously this was a bare
    // catch that left users stranded on the storage picker with no error).
    // A payload failure gets the honest copy and latches, so the handoff below
    // does not then offer a credential form for it.
    if (e instanceof PayloadLoadError) {
      // Latch only when a credential CANNOT be the cause. A stale key (a peer
      // rotated it) is recoverable, and latching would early-return
      // `handlePendingPassword` for the rest of the session so neither the
      // password form nor the kit form ever opens again.
      if (!e.keyMayBeWrong) podUnopenableHere.value = true;
      payloadExplanationShown.value = true;
      formError.value = t(payloadErrorMessageKey(e));
      isLoadingFile.value = false;
      // ⚠️ For the recoverable class, OPEN THE FORM the message points at.
      // Returning here left the user on the storage-picker screen reading "try
      // your password" with no password field, no kit form and no retry.
      if (e.keyMayBeWrong && syncStore.hasPendingEncryptedFile) {
        await handlePendingPassword(syncStore.fileName, { tryAuto: false });
      }
      return;
    }
    formError.value = syncStore.error ?? t('auth.fileLoadFailed');
    console.error('[LoadPodView] autoLoadFile failed:', e);
  }
  isLoadingFile.value = false;
}

async function handleGrantPermission() {
  isLoadingFile.value = true;
  formError.value = null;

  try {
    const result = await syncStore.requestPermission();
    if (result.payloadError) {
      // Permission WAS granted; the pod could not be opened. `finishLoaded()`
      // here would drive the login flow into a signed-in state with no
      // document. Latch only when no credential can help — see `tryAutoDecrypt`.
      if (!result.payloadError.keyMayBeWrong) podUnopenableHere.value = true;
      payloadExplanationShown.value = true;
      formError.value = t(payloadErrorMessageKey(result.payloadError));
      reportPayloadFailure(result.payloadError, {
        source: 'reload',
        fileId: syncStore.driveFileId ?? null,
        familyId: syncStore.pendingEncryptedFile?.envelope?.familyId ?? null,
      });
    } else if (result.granted && (result.loaded || syncStore.hasPendingEncryptedFile)) {
      if (syncStore.hasPendingEncryptedFile) {
        await handlePendingPassword(syncStore.fileName);
      } else {
        await finishLoaded();
      }
    } else {
      formError.value = t('auth.fileLoadFailed');
    }
  } catch {
    formError.value = t('auth.fileLoadFailed');
  } finally {
    isLoadingFile.value = false;
  }
}

/**
 * Entry point for the "Load a saved family file" aside (#47). Dispatches by
 * capability at click time; every arm converges on the shared decrypt flow
 * (`handlePendingPassword` / `handleDriveFileSelected`), and every successful
 * load routes through `finishLoaded()` which re-homes as needed.
 *
 * - Native (iOS/Android): the OS file picker (`<input type=file>` →
 *   `openAndLoadFileFallback`), which also reaches Drive/iCloud via the system
 *   sheet. Never the in-WebView Google Picker (fragile on iOS WebKit).
 * - Web with FSA (Chromium): reveal the drag-drop / browse zone, whose click
 *   uses the writable File System Access picker (`handleLoadFile`).
 * - Web without FSA (Firefox/Safari): the Google Picker — reaches the signed-in
 *   account's own non-app-created + shared files and grants access.
 */
async function handleOpenSavedFile() {
  formError.value = null;

  if (!isNative() && supportsFileSystemAccess()) {
    // Chromium desktop: reveal the writable-handle drop/browse zone. Toggles so
    // a second tap collapses it (matches the previous local-card affordance).
    selectedSource.value = selectedSource.value === 'local' ? null : 'local';
    logEvent({
      level: 'info',
      surface: 'load-existing-family',
      message: 'open saved file: FSA browse zone',
      context: { action: 'needs-password', provider_type: 'local' },
    });
    return;
  }

  if (isNative()) {
    await handleLoadFile();
    return;
  }

  await loadSavedFileViaPicker();
}

/**
 * Web-without-FSA branch: open the Google Picker so the user can grant access
 * to a `.beanpod` in their own Drive that the app didn't create (restored
 * backup / different account). Reuses the exact primitive the join flow uses
 * (`usePickBeanpodFile().pick()`), then the existing `handleDriveFileSelected`
 * handoff. Never throws — `pick()` returns a structured result.
 */
async function loadSavedFileViaPicker(opts?: { chooseAccount?: boolean }) {
  const chooseAccount = opts?.chooseAccount ?? false;
  // ⚠️ A CHOOSER ROUTE IS REQUIRED HERE TOO, and this screen nearly did not get one. The
  // Picker is now PINNED to the token's account (`setAuthUser` in drivePicker), which fixed an
  // empty chooser for multi-account joiners — but it also removed the one thing that used to
  // rescue a returning OWNER signed into the wrong Google session: the browser's own session
  // could previously surface the right account by accident. The two pod banners gained
  // `pickFamilyFileOtherAccount` and the join card gained a "different account" link; this is
  // the FIRST screen a returning owner lands on, and it had neither.
  const email = chooseAccount ? undefined : (getGoogleAccountEmail() ?? undefined);
  const picked = await pickBeanpodFromDrive({ chooseAccount, loginHint: email });

  // ⚠️ A `switch` with `assertNever`, so a future outcome is a compile error rather than a silent
  // no-op. The `if` chain this replaced had ONE arm for `cancelled`, whose own comment admitted it
  // was covering two different realities — a user backing out, and a full-page redirect. Those
  // want opposite treatment, and conflating them elsewhere hid a production consent loop.
  switch (picked.kind) {
    case 'picked':
      await handleDriveFileSelected({ fileId: picked.fileId, fileName: picked.fileName });
      return;

    case 'cancelled':
      // ⚠️ OFFER THE CHOOSER, BUT ONLY NOW. The Picker is pinned to the signed-in account
      // (`setAuthUser`), which is what stops a multi-account browser showing an empty list —
      // but it also means a returning owner on the WRONG Google session sees a Drive without
      // their pod and has nowhere to go. Revealing the escape after a cancel, rather than
      // up front, honours CLAUDE.md's rule against pre-warning that a flow might fail:
      // friction is surfaced only once failure is actually observed.
      if (!chooseAccount) showAccountSwitch.value = true;
      logEvent({
        level: 'info',
        surface: 'load-existing-family',
        message: 'open saved file via picker cancelled',
        context: { action: 'cancelled', provider_type: 'google_drive' },
      });
      return;

    case 'redirecting':
      // Not a cancel: we navigated them to Google and this session is going away. Logged as its
      // own fact so "they backed out" and "we redirected them" stop sharing a number.
      logEvent({
        level: 'info',
        surface: 'load-existing-family',
        message: 'open saved file via picker redirecting to auth',
        context: { action: 'redirecting', provider_type: 'google_drive' },
      });
      return;

    case 'failed':
      // ⚠️ NEVER `picked.message` — for `reason: 'config'` that is the literal string
      // "VITE_GOOGLE_API_KEY is not configured", which was reaching users on the SIGN-IN screen.
      // `describePickFailure` is the one table both picker surfaces read, so a new reason is a
      // compile error rather than a raw developer string leaking somewhere nobody is looking.
      formError.value = t(describePickFailure(picked.reason).messageKey);
      reportError({
        surface: 'load-existing-family',
        severity: 'warning',
        message: `open saved file via picker failed: ${picked.reason}`,
        // ⚠️ THE NAMESPACED CODE, matching `useDriveFileReselect`. This logged the bare
        // `picked.reason` while the sibling surface logged `describePickFailure(...).errorCode`,
        // so the same Picker failure arrived in CloudWatch under two different names and no
        // single filter could count it. `describePickFailure` is already the one table both
        // surfaces read for the message; read the code from it too.
        context: {
          action: 'no-backend',
          error_code: describePickFailure(picked.reason).errorCode,
          provider_type: 'google_drive',
        },
      });
      return;

    // Unreachable here: `'loaded'` is produced only when a caller passes
    // `resolveWithoutPicker`, and this surface does not. Handled explicitly because
    // `assertNever` makes a new result kind a COMPILE error rather than a silent
    // fall-through — which is the whole point of the switch.
    case 'loaded':
      return;

    default:
      assertNever(picked, 'loadSavedFileViaPicker');
  }
}

/**
 * The failure tail shared by the picked-file and dropped-file loads.
 *
 * ⚠️ `payloadError` FIRST, and since 2026-09-07 that ordering is the only thing
 * that speaks at all for a file from a newer beanies. `openFileFailure` no
 * longer mirrors a blocker into the pod's `lastError`, so `syncStore.error` is
 * empty for exactly the files that most need a sentence. The drop path had no
 * `payloadError` arm and would have fallen through to the generic
 * "could not load" copy.
 */
function applyFileLoadFailure(result: { payloadError?: RemoteBlocker }): void {
  formError.value = result.payloadError
    ? t(result.payloadError.inlineMessageKey)
    : syncStore.error || t('auth.fileLoadFailed');
}

async function handleLoadFile() {
  formError.value = null;
  resetPodUnopenable(); // a different file may well open
  isLoadingFile.value = true;

  try {
    const result = await syncStore.loadFromNewFile();
    // Dismissing the OS picker says nothing.
    if (result.cancelled) return;
    if (result.success) {
      await finishLoaded();
    } else if (result.needsPassword) {
      await handlePendingPassword(syncStore.fileName, { tryAuto: false });
    } else {
      applyFileLoadFailure(result);
    }
  } catch {
    formError.value = syncStore.error || t('auth.fileLoadFailed');
  } finally {
    isLoadingFile.value = false;
  }
}

/**
 * Redeem a recovery-kit code against the pending envelope (Phase 3): unwrap the family
 * key, decrypt, land on the person picker (a kit identifies no member — like the
 * recovery passphrase). Mirrors handleDecrypt's flow, minus any auto-sign-in.
 */
async function handleKitRedeem() {
  if (!kitCodeInput.value.trim()) {
    formError.value = t('recovery.kitWrongCode');
    return;
  }
  // ⚠️ Falls back to the LIVE envelope. Reached from the prove screen the pod is usually
  // already open, so there is no pending file — and this used to `return` silently, so the
  // button did nothing at all and said nothing about why.
  const envelope = syncStore.pendingEncryptedFile?.envelope ?? syncStore.envelope;
  if (!envelope) {
    formError.value = t('loginFlow.recoveryOnlyBody');
    reportError({
      surface: 'login-flow',
      message: 'kit redeem with no envelope in reach',
      severity: 'warning',
      context: { action: 'kit_redeem_no_envelope' },
    });
    return;
  }
  isLoadingFile.value = true;
  formError.value = null;
  try {
    const { redeemRecoveryKit, parseKitInput } = await import('@/services/auth/recoveryKit');
    const result = await redeemRecoveryKit(envelope, parseKitInput(kitCodeInput.value));
    if (!result.ok) {
      formError.value =
        result.reason === 'no-kits' ? t('recovery.kitNoKits') : t('recovery.kitWrongCode');
      emitKitRedeemed({ outcome: 'failed', errorCode: result.reason });
      return;
    }
    // Pod already open: the kit is proving IDENTITY here, not decrypting anything. Hand
    // the opener straight to the flow, which re-enters the picker and — because the opener
    // is a kit — leads with set-a-new-PIN.
    if (!syncStore.hasPendingEncryptedFile) {
      emitKitRedeemed({ outcome: 'accepted-pod-open' });
      await finishLoaded('kit');
      return;
    }
    // The decrypt tail lives in the store now, so it emits on every branch including the
    // one this handler used to return from silently. The view keeps the reason → copy
    // mapping, because that is a view concern.
    const opened = await syncStore.openPodWithFamilyKey(result.familyKey);
    if (!opened.ok) {
      // 'wrong recovery code' would be a lie when the kit unwrapped fine and it was the
      // pod that would not fit in memory.
      if (opened.payloadError) {
        payloadExplanationShown.value = true;
        // Payload-specific question; every other blocker latches.
        if (!(opened.payloadError instanceof PayloadLoadError && opened.payloadError.keyMayBeWrong))
          podUnopenableHere.value = true;
      }
      formError.value = opened.payloadError
        ? t(opened.payloadError.inlineMessageKey)
        : t('password.decryptionError');
      emitKitRedeemed({ outcome: 'decrypt-failed', errorCode: opened.reason });
      return;
    }
    emitKitRedeemed({ outcome: 'ok' });
    showDecryptModal.value = false;
    kitCodeInput.value = '';
    // 'kit': a family-level secret opened the pod — the person picker's prove screen
    // offers SET-A-NEW-PIN instead of demanding the forgotten credentials.
    await finishLoaded('kit');
  } catch (e) {
    // Was `console.error` only, so a throw here never reached the firehose at all — the
    // fourth terminal branch of a flow this issue exists to measure.
    formError.value = t('password.decryptionError');
    emitKitRedeemed({ outcome: 'redeem-threw' });
    reportError({
      surface: 'login-flow',
      message: 'kit redeem threw',
      severity: 'error',
      error: e,
      context: { action: 'kit_redeem_threw' },
    });
  } finally {
    isLoadingFile.value = false;
  }
}

async function handleDecrypt() {
  if (!decryptPassword.value) {
    formError.value = t(secretField.value.required);
    return;
  }

  isLoadingFile.value = true;
  formError.value = null;

  try {
    const result = await syncStore.decryptPendingFile(decryptPassword.value);
    if (result.success) {
      showDecryptModal.value = false;

      // Auto-sign-in is safe ONLY when exactly one member's wrappedKey
      // unwrapped with this password. If more than one matched, multiple
      // members share this password — we cannot infer identity from the
      // unwrap alone. Fall through to the machine's person picker so the user explicitly
      // chooses which bean they are; the per-member verifyPassword check
      // there is salt-scoped per member, so identity is unambiguous after
      // they pick.
      const unambiguousMemberId =
        result.memberIds && result.memberIds.length === 1 ? result.memberIds[0] : null;

      if (unambiguousMemberId) {
        const signInResult = await authStore.signIn(unambiguousMemberId, decryptPassword.value);
        decryptPassword.value = '';
        if (signInResult.success) {
          // B2: this branch returns WITHOUT reaching finishLoaded(), so it must
          // establish the durable home itself — otherwise a single-member file opened
          // via the native picker (no provider installed by decrypt) is left with no
          // writable save target.
          await ensureDurableHome();
          emit('signed-in', '/nook');
          return;
        }
        // Sign-in failed (edge case: password changed after wrapping) — fall back
      }

      decryptPassword.value = '';
      await finishLoaded(result.viaRecoveryPassphrase ? 'passphrase' : null);
    } else if (result.payloadError) {
      // NOT a credential failure: the payload could not be loaded however right
      // the password is, so re-prompting loops forever. Before this branch the
      // raw Automerge/WASM string ("error inflating document chunk ops: out of
      // memory") was rendered untranslated under the password field.
      payloadExplanationShown.value = true;
      formError.value = t(result.payloadError.inlineMessageKey);
      // Only latch when a credential CANNOT be the cause. A stale wrap (a peer
      // rotated the family key) unwraps with the old key and then fails the
      // AES-GCM tag — `keyMayBeWrong` — and latching that would early-return
      // `handlePendingPassword` forever, so the password and kit forms never
      // reopen for the rest of the session.
      // `keyMayBeWrong` is payload-specific; a lineage or merge block is never a
      // credential problem, so it latches rather than re-prompting.
      if (!(result.payloadError instanceof PayloadLoadError && result.payloadError.keyMayBeWrong))
        podUnopenableHere.value = true;
    } else {
      // The typed key, never `result.error` — that is a developer-facing string (it used
      // to render 'No wrapped keys in beanpod file — cannot unlock' at a non-English
      // user). `error` still carries it for the callers that BRANCH on it.
      formError.value = t(result.errorKey ?? 'password.decryptionError');
    }
  } catch {
    formError.value = t('password.decryptionError');
  } finally {
    isLoadingFile.value = false;
  }
}

function handleDragEnter(e: DragEvent) {
  e.preventDefault();
  dragCounter++;
  isDragging.value = true;
}

function handleDragLeave() {
  dragCounter--;
  if (dragCounter <= 0) {
    dragCounter = 0;
    isDragging.value = false;
  }
}

function handleDragOver(e: DragEvent) {
  e.preventDefault();
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'copy';
  }
}

async function handleDrop(e: DragEvent) {
  e.preventDefault();
  dragCounter = 0;
  isDragging.value = false;
  formError.value = null;
  resetPodUnopenable(); // a different file may well open

  const items = e.dataTransfer?.items;
  if (!items || items.length === 0) return;

  const item = items[0];
  if (!item || item.kind !== 'file') return;

  // Grab the File synchronously — dataTransfer is cleared after the event handler returns
  const file = item.getAsFile();
  if (!file) return;

  // Try to get a FileSystemFileHandle for persistent access (Chromium only)
  let fileHandle: FileSystemFileHandle | undefined;
  if ('getAsFileSystemHandle' in item) {
    try {
      const handle = await (
        item as DataTransferItem & { getAsFileSystemHandle(): Promise<FileSystemHandle> }
      ).getAsFileSystemHandle();
      if (handle?.kind === 'file') {
        fileHandle = handle as FileSystemFileHandle;
      }
    } catch {
      // Fall back to File-only path
    }
  }

  // Validate file extension
  if (!isPodFileName(file.name)) {
    formError.value = t('auth.fileLoadFailed');
    return;
  }

  isLoadingFile.value = true;
  try {
    const result = await syncStore.loadFromDroppedFile(file, fileHandle);
    if (result.success) {
      await finishLoaded();
    } else if (result.needsPassword) {
      await handlePendingPassword(file.name, { tryAuto: false });
    } else {
      applyFileLoadFailure(result);
    }
  } catch {
    formError.value = syncStore.error || t('auth.fileLoadFailed');
  } finally {
    isLoadingFile.value = false;
  }
}

// Google Drive state
const showDrivePicker = ref(false);
const driveFiles = ref<Array<{ fileId: string; name: string; modifiedTime: string }>>([]);
const isDriveLoading = ref(false);

const showDriveEmptyState = ref(false);

// ── View state machine ────────────────────────────────────────────────────
// Single source of truth for which top-level panel renders. Derived from the
// existing mode inputs (refs + props) with an explicit, total precedence — the
// booleans still drive *when* each becomes true at their existing transition
// points; this only consolidates *which one wins* so the template reads one
// value instead of a fragile overlapping v-if chain. Precedence reproduces the
// pre-refactor render order exactly: outer decrypt > (reconnect) > the inner
// chain (isLoadingFile | isDriveLoading) → needsPermissionGrant → showDriveEmptyState → cards.
// `isDriveLoading` (the Drive *listing* round-trip) shows the spinner too, so the
// storage cards aren't left clickable during the ~2s listing — notably after the
// OAuth redirect returns and re-opens the picker (ADR-029).
// NOTE: `decrypt` keys off `showDecryptModal` ALONE, never `hasPendingEncryptedFile`
// — several flows stage a pending file with the modal closed so the biometric
// handoff can take over; deriving decrypt from the pending file would render the
// password panel over biometric. `lastDriveCheckEmpty`/`selectedSource` are
// card-local sub-state (dim the Drive card / show the local drop-zone), not
// modes, so they are intentionally NOT variants here.
// `reconnectDismissed` lets the 404 fallback leave reconnect mode locally (the
// `reconnectDriveFile` prop is owned by the parent and can't be cleared here).
const reconnectDismissed = ref(false);
const viewState = computed<
  'decrypt' | 'reconnect' | 'auto-loading' | 'permission-grant' | 'empty' | 'cards'
>(() => {
  if (showDecryptModal.value) return 'decrypt';
  if (props.reconnectDriveFile && !reconnectDismissed.value) return 'reconnect';
  if (isLoadingFile.value || isDriveLoading.value) return 'auto-loading';
  if (props.needsPermissionGrant) return 'permission-grant';
  if (showDriveEmptyState.value) return 'empty';
  return 'cards';
});

/**
 * The promoted magic-link block, on the two states that have NOTHING STAGED.
 *
 * ⚠️ THIS ALSO SWITCHES OFF THE HOISTED `PasteLinkPanel` BELOW, and the pairing is the point.
 * That panel is the first thing in the `v-else` branch covering `cards`, `reconnect`,
 * `auto-loading`, `permission-grant` and `empty`. `ScanFirstBlock` owns a paste panel of its
 * own, so rendering both would show two, one above the other, with two "or" dividers; and
 * putting the block anywhere below the hoisted one would ship paste-first and defeat the
 * promotion. One `v-if` pair means exactly one paste panel renders on every state, by
 * construction rather than by careful ordering.
 */
const showScanFirst = computed(
  () => viewState.value === 'cards' || viewState.value === 'reconnect'
);

/** One mount, one surface value, derived — not one mount per state. */
const coldSurface = computed(() =>
  viewState.value === 'reconnect' ? 'load-pod-reconnect' : 'load-pod-cards'
);

// LoginPage always supplies the picked family's name; `?? ''` is a defensive
// floor that never triggers in practice.
const reconnectHeadline = computed(() =>
  fillTemplate(t('loginV6.reconnectToLoad'), {
    familyName: props.reconnectDriveFile?.familyName ?? '',
  })
);

const { reconnectError, reconnect } = useGoogleReconnect();
// True for the WHOLE reconnect→load sequence (consent + reading/staging the
// file), so the reconnect button stays disabled + spinning the entire time it's
// visible — a user can't double-tap it and trigger a second Google consent.
const isReconnectBusy = ref(false);

/**
 * Token-aware reconnect: acquire a fresh Google token (popup on desktop, full-
 * page redirect on iOS/PWA via `useGoogleReconnect`), then load the KNOWN Drive
 * file directly — no `listGoogleDriveFiles`, no picker. On success it leaves the
 * reconnect panel immediately so the loading spinner (not a re-tappable button)
 * covers the read/decrypt-prep. If the known file is gone (404), it falls back
 * to the existing picker.
 */
async function handleReconnectAndLoad(opts?: { isResume?: boolean }) {
  const file = props.reconnectDriveFile;
  if (!file) {
    // ⚠️ NOT A BARE RETURN ANY MORE. On the resume path this is the difference between "there
    // was nothing to reconnect" and "we came back from Google and lost the file we came back
    // FOR" — and the second used to leave the person on a generic picker with no panel, no
    // error and not one event on the whole resume path.
    if (opts?.isResume) {
      reportError({
        surface: 'login-flow',
        message: 'reconnect resume arrived with no target file',
        severity: 'warning',
        context: { action: 'reconnect_resume_no_file' },
      });
    }
    return;
  }
  formError.value = null;
  isReconnectBusy.value = true;
  try {
    // ⚠️ NATIVE ONLY, AND THE `isNative()` IS THE WHOLE POINT.
    //
    // The marker exists because Capacitor does NOT unload the WebView: the return is a
    // `router.replace(samePath)`, a redundant navigation that remounts nothing, so the
    // reconnect panel stayed on screen and needed a second tap.
    //
    // iOS Safari and installed PWAs also take the redirect path, but there the return is a
    // full page LOAD — the app re-boots, `handleFamilySelected` re-runs against a now-valid
    // token, and the file loads on its own. Sending them to the marker instead SHORT-CIRCUITS
    // that working boot path onto a resume branch whose handler needs `reconnectDriveFile`,
    // a page-local ref the reload has just thrown away. The handler then returns on its first
    // line with no message and no event: a silent dead end, strictly worse than the two taps
    // it was meant to save.
    const outcome = await reconnect(syncStore.providerAccountEmail ?? undefined, {
      // On a RESUME we have just come back from consent. Re-redirecting on a still-invalid
      // token is an infinite loop with no gesture in it, so pass no marker and let the
      // outcome surface as an error instead. Same reasoning as `openDrivePicker`'s guard.
      returnPath: opts?.isResume ? undefined : isNative() ? RECONNECT_LOAD_PATH : undefined,
      noRedirect: opts?.isResume === true,
    });

    // The page is navigating away to Google and nothing has been acquired yet;
    // LoginPage re-runs the silent auto-load on return. Asked of the OUTCOME now
    // rather than re-testing the platform: `reconnect` already made this decision
    // and a second copy of the predicate is a second chance to disagree with it.
    if (outcome === 'redirecting') return;

    if (!reconnectSucceeded(outcome)) {
      // Stay on the reconnect panel so the user can try again.
      formError.value = reconnectError.value || t('googleDrive.reconnectFailed');
      return;
    }

    // Token in hand. Leave the reconnect panel NOW so the loading spinner — not
    // the static button — covers the read. `handleDriveFileSelected` flips
    // `isLoadingFile` synchronously before its first await, so the view goes
    // reconnect → 'auto-loading' spinner → 'decrypt' with no flash and no
    // re-tappable button in between.
    reconnectDismissed.value = true;
    const result = await handleDriveFileSelected({ fileId: file.fileId, fileName: file.fileName });

    // Known file vanished (404) → picker fallback (reconnect already dismissed;
    // the Drive "not found" message is on formError).
    if (result?.reason === 'not-found') {
      await handleLoadFromGoogleDrive();
    }
  } finally {
    isReconnectBusy.value = false;
  }
}

// Tooltip on the disabled Drive card. Branches on which gate is failing so
// the user gets actionable guidance (set VITE_GOOGLE_CLIENT_ID vs set the
// OAuth proxy). syncStore.isGoogleDriveAvailable is the canonical "Drive is
// usable" check — `features.drive && features.oauthProxy`.
const driveDisabledTooltipKey = computed(() => {
  if (!features.drive) return 'selfHost.driveUnavailableTooltip';
  return 'selfHost.driveUnavailableNoProxyTooltip';
});

/**
 * Single entry for "(re)open the Google Drive file picker". The three public
 * handlers below are thin wrappers differing only in their auth intent.
 *
 * On a redirect surface (native / iOS / installed PWA) the popup OAuth transport
 * can't bridge back into the app, so a first sign-in (no token) — and a
 * switch-account (`forceNewAccount`) even WITH a token — bounces through the
 * system browser / full-page redirect via `syncStore.beginDriveAuthRedirect`.
 * `LoginPage`'s `resume=load-drive` dispatcher then re-enters here with
 * `isResume: true` once the token is cached. On desktop (popup) or when a token
 * is already in hand, we list immediately — desktop behaviour is unchanged.
 * See ADR-029 + docs/plans/2026-05-22-native-pwa-drive-oauth-redirect-unification.md.
 *
 * @param opts.forceNewAccount  switch-account intent (forces re-auth on a
 *   redirect surface; `forceConsent` on the desktop popup path).
 * @param opts.isResume  true only when invoked by the post-redirect resume. If
 *   the token is missing then, the upstream exchange failed — surface it rather
 *   than re-redirecting (which would loop). Never set on a user-initiated tap.
 */
async function openDrivePicker(opts: { forceNewAccount?: boolean; isResume?: boolean } = {}) {
  if (!syncStore.isGoogleDriveAvailable) {
    // Defense-in-depth: the card is disabled in this state. Hoisted into the
    // shared body so retry/switch-account inherit the guard too. If it fires,
    // log so a dev can spot the regression.
    console.warn(
      '[LoadPodView] openDrivePicker invoked while isGoogleDriveAvailable is false (features.drive && features.oauthProxy) — check the disabled binding on the card.'
    );
    return;
  }

  formError.value = null;

  // Resume after the deep link: a failed exchange still routes to LOAD_DRIVE_PATH
  // (handleNativeAuthRedirect always onComplete()s), so we can land here with no
  // IN-MEMORY token. Before surfacing the error + looping, try a silent reconnect
  // with the preserved refresh token — on the first post-consent return the token
  // may be committed in IndexedDB but not yet in memory (the bounce greg hit,
  // 2026-06-19, cluster 2). `tryReconnectSilently` checks isTokenValid first and
  // recovers the local/doc refresh token; it never redirects, so no consent loop.
  // On the post-consent resume, the redirect `code` may still be mid-exchange —
  // settle it (shared, once) before judging the token, so we list files instead
  // of surfacing a spurious auth error. No-op once settled / on native. See ADR-026.
  await whenRedirectAuthSettled();
  if (opts.isResume && !isTokenValid()) {
    const recovered = await tryReconnectSilently(syncStore.providerAccountEmail ?? undefined);
    if (!recovered || !isTokenValid()) {
      console.warn(
        '[LoadPodView] resume: no in-memory token and silent reconnect failed — surfacing reconnect'
      );
      formError.value = t('googleDrive.authFailed');
      return;
    }
    // Recovered silently — fall through to list files with the now-valid token.
  }

  // Redirect surface + (no token OR switch-account) → bounce out; the resume
  // continuation re-enters here with a cached token. A start failure (no client
  // id, Browser.open rejects) is surfaced, never swallowed.
  try {
    if (
      await syncStore.beginDriveAuthRedirect(
        LOAD_DRIVE_PATH,
        syncStore.providerAccountEmail ?? undefined,
        'join',
        { forceReauth: opts.forceNewAccount }
      )
    ) {
      return; // redirecting away — nothing more to do here
    }
  } catch (e) {
    console.error('[LoadPodView] Drive auth redirect failed to start:', e);
    formError.value = (e as Error).message || t('googleDrive.authFailed');
    return;
  }

  isDriveLoading.value = true;
  showDriveEmptyState.value = false;

  try {
    driveFiles.value = await syncStore.listGoogleDriveFiles({
      forceNewAccount: opts.forceNewAccount,
    });
    if (driveFiles.value.length === 0) {
      showDriveEmptyState.value = true;
      lastDriveCheckEmpty.value = true;
    } else {
      lastDriveCheckEmpty.value = false;
      showDrivePicker.value = true;
    }
  } catch (e) {
    console.error('[LoadPodView] openDrivePicker list failed:', e);
    formError.value = (e as Error).message || t('googleDrive.authFailed');
  } finally {
    isDriveLoading.value = false;
  }
}

function handleLoadFromGoogleDrive() {
  return openDrivePicker({ forceNewAccount: props.forceNewGoogleAccount });
}

function handleDriveRetry() {
  return openDrivePicker();
}

function handleDriveSwitchAccount() {
  return openDrivePicker({ forceNewAccount: true });
}

// Post-redirect resume: re-open the picker once `LoginPage` flags it (we just
// returned from the Drive-load OAuth redirect with a cached token). `immediate`
// covers both the web full-page-reload first mount AND the native deep-link
// `router.replace`, which does NOT remount this component — an `onMounted` here
// would never re-fire on native. `isResume: true` makes a missing token surface
// an error instead of re-redirecting (loop guard). See ADR-029.
watch(
  () => props.autoOpenDrivePicker,
  (open) => {
    if (open) void openDrivePicker({ isResume: true });
  },
  { immediate: true }
);

// The same shape, and for the same native reason, for the RECONNECT return. Without it the
// reconnect panel sat there after a successful consent and the person tapped it again; that
// second tap did nothing but short-circuit on the token the first one had already fetched.
// `immediate` is what makes it work on native, where nothing remounts.
watch(
  () => props.autoReconnectLoad,
  (on) => {
    // ⚠️ `isResume: true` — the LOOP GUARD, exactly as `openDrivePicker` carries one. We are
    // arriving BACK from a consent round trip. If the token is still invalid (consent
    // declined, partially granted, or the code exchange failed — the native handler calls
    // `onComplete` either way), re-entering would start the same redirect again, return here
    // again, and fire this watcher again, with no user gesture anywhere in the cycle.
    if (on && !isReconnectBusy.value) void handleReconnectAndLoad({ isResume: true });
  },
  { immediate: true }
);

/**
 * From the NoPodEmptyState panel: switch to the local-file flow.
 * Closes the empty state and pre-selects the local-file storage source
 * so the drop-zone is immediately visible without an extra click.
 */
function handleLoadLocalFromEmptyState() {
  showDriveEmptyState.value = false;
  selectedSource.value = 'local';
}

async function handleDriveFileSelected(payload: { fileId: string; fileName: string }): Promise<{
  success: boolean;
  needsPassword?: boolean;
  reason?: 'auth' | 'not-found' | 'error';
}> {
  showDrivePicker.value = false;
  resetPodUnopenable(); // a different file may well open
  isLoadingFile.value = true;
  formError.value = null;

  try {
    const result = await syncStore.loadFromGoogleDrive(payload.fileId, payload.fileName);
    if (result.success) {
      await finishLoaded();
    } else if (result.needsPassword) {
      await handlePendingPassword(payload.fileName);
    } else if (syncStore.error) {
      formError.value = syncStore.error;
    } else {
      // ⚠️ THE ARM THAT DID NOT EXIST, AND ITS ABSENCE WAS SILENCE. `loadFromGoogleDrive`
      // correctly stopped writing raw English into `syncStore.error` and now
      // returns `{success:false, reason:'error'}` on its own — so an empty or
      // unreadable `.beanpod` fell past every branch here and the person picked a
      // file and saw NOTHING happen at all, on the sign-in screen, with no way to
      // tell a broken file from a broken tap.
      //
      // Reuses the key this function's own `catch` already uses: same failure to
      // the person, same sentence, no new string.
      formError.value = t('googleDrive.loadError');
    }
    // Return the load result so the reconnect caller can branch on `reason`
    // (a 404 → picker fallback). The picker `@select` caller ignores it.
    return result;
  } catch {
    formError.value = syncStore.error || t('googleDrive.loadError');
    return { success: false, reason: 'error' as const };
  } finally {
    isLoadingFile.value = false;
  }
}

async function handleDriveRefresh() {
  isDriveLoading.value = true;
  try {
    // ⚠️ NOT `{ silent: true }`. A cut of this on 2026-09-09 made it silent on the
    // reasoning that "an interactive acquisition would open a popup with no user
    // gesture behind it" — which is simply false: this handler is bound to the
    // picker's Refresh BUTTON and nothing is awaited before the token call, so
    // the gesture is right there. Silent turned Refresh into an invisible no-op:
    // the token lapses, `getValidTokenSilent` throws, the bare catch below eats
    // it, and the user gets a spinner flash and the same stale list forever.
    driveFiles.value = await syncStore.listGoogleDriveFiles();
  } catch (e) {
    // Keep the existing list — it is still valid — but never silently. This is a
    // newly reachable failure class (a grant revoked on another device surfaces
    // here as a Drive 401) and a bare `catch {}` would put it beyond CloudWatch.
    console.warn('[LoadPodView] Drive list refresh failed; keeping the existing list', e);
    logEvent({
      level: 'warn',
      surface: 'pod-load-failure',
      message: 'drive list refresh failed',
      // Classified and carrying the error: a popup block, a revoked-grant 401 and
      // an offline drop are three different problems and were emitting one
      // identical line, which cannot be triaged from the logs alone.
      context: { action: 'drive-refresh-failed', error_code: classifyDriveFailure(e) },
      error: e,
    });
  } finally {
    isDriveLoading.value = false;
  }
}
</script>

<template>
  <!--
    ⚠️ NO CARD BELOW `sm`, AND THAT IS DELIBERATE RATHER THAN A SIMPLIFICATION.
    A card separates a surface from what surrounds it. At phone width this one is the only
    thing on the page, so it frames the entire viewport and separates nothing — while costing
    a page gutter plus 32px of its own padding on each side. greg called the result squeezed,
    and he was right. From `sm` up it earns its keep: it bounds a 540px column in a wide
    field, which is the one job a card is actually for.
  -->
  <div
    class="dark:sm:bg-surface-raised mx-auto max-w-[540px] bg-transparent p-0 sm:rounded-3xl sm:bg-white sm:p-8 sm:shadow-xl"
  >
    <!-- Back button -->
    <button
      class="dark:text-ink-soft dark:hover:text-ink mb-4 flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700"
      @click="$emit('back')"
    >
      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
      </svg>
      {{ t('action.back') }}
    </button>

    <!-- ═══════════════════════════════════════════════════════════
         Inline Sign-In form (when file is loaded and needs password)
         Replaces the storage cards entirely — no modal overlay.
         ═══════════════════════════════════════════════════════════ -->
    <template v-if="viewState === 'decrypt'">
      <div class="text-center">
        <!-- Beanie icon -->
        <img
          src="/brand/beanies_family_icon_transparent_384x384.png"
          alt=""
          class="mx-auto mb-3 h-24 w-24"
        />

        <!-- File loaded badge -->
        <div
          v-if="loadedFileName"
          class="dark:text-success-lift mx-auto mb-4 inline-flex items-center gap-2 rounded-full bg-[#27AE60]/[0.08] px-3 py-1.5 text-xs font-semibold text-[#27AE60] dark:bg-green-900/30"
        >
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M5 13l4 4L19 7"
            />
          </svg>
          {{ loadedFileName }} {{ t('loginV6.fileLoaded') }}
          <svg class="h-3 w-3 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
        </div>
        <!-- Cloud account email -->
        <p
          v-if="syncStore.providerAccountEmail"
          class="dark:text-ink-faint mb-2 text-xs text-gray-400"
        >
          {{ syncStore.providerAccountEmail }}
        </p>

        <!-- Heading. Constant: it names the STEP, not the family and not the credential.
             It used to read "Sign In to {familyName}", which describes step 2 while
             performing step 1. The family name moved into the subtitle below, where the
             reassurance about whose data this is belongs anyway. -->
        <h3 class="font-outfit dark:text-ink text-xl font-bold text-gray-900">
          {{ t('loginV6.unlockTitle') }}
        </h3>
        <!-- ⚠️ `mb-5`. This had `mt-1` and NO bottom margin, and the panel below has a top
             margin of nothing — so the two were flush and read as a rendering fault. -->
        <p v-if="unlockSubtitle" class="dark:text-ink-faint mt-1 mb-5 text-xs text-gray-500">
          {{ unlockSubtitle }}
        </p>
      </div>

      <!--
        THE SCAN PATH, ON THE ONLY SCREEN WHERE IT CAN WORK.
        A pod is staged by this point, which is what pull-mode approval polls: the other
        device writes an approval into this file's envelope and this one picks it up. On
        the welcome gate or the storage picker there is nothing staged, so the same panel
        would render a code and wait forever.

        Above the credential field deliberately — this is the measured problem. Six of
        twenty-two families redeemed a recovery kit, every one on a cold device, and five
        of those six then replaced a PIN that was working. They did not need recovery; the
        screen just never offered them a way in.
      -->
      <!--
        ⚠️ GATED ON A STAGED FILE, not on `nothingCanOpenIt`. `caps` is derived from
        `pendingEncryptedFile?.envelope`, which is NULL in the "recovery-kit escape from an
        ALREADY-OPEN pod" state — so `nothingCanOpenIt` was false there and this panel
        mounted over a live document, driving `loadFromFile()`'s replace branch twenty times
        a minute against unsaved edits. It also could not have succeeded:
        `openPodWithFamilyKey` returns `no-pending` when nothing is staged.
      -->
      <div v-if="canUseDeviceApproval" class="mb-6">
        <!--
          ⚠️ `finishLoaded()` WITH NO OPENER, deliberately.

          Opening a family is two steps: unlock the beanpod (family-wide) and then sign in
          (per person, PIN). A `RecoveryOpener` says which family-wide RECOVERY credential
          did step 1, and its only effect is to offer SET A NEW PIN on the prove screen —
          i.e. to let a printed break-glass secret hand over a member's identity.

          A device approval is a step-1 credential, not a step-2 one. It substitutes for the
          passphrase or the kit, and the person then signs in as themselves with the PIN they
          still have. Passing an opener here would let "another member tapped approve" become
          "and now you may become anyone", which is a different and much larger permission
          than the one that was granted.
        -->
        <!-- ⚠️ `@paste-submitted` is deliberately NOT wired here, and that is safe only because
             this screen is not `/join`. The emit exists because pasting the SAME link while
             already at `/join` is a duplicate navigation that fires no route watcher; from
             here the router push does the work. If this panel is ever routed onto `/join`,
             wire it — see `PasteLinkPanel`'s docblock. (`pasteTarget` on this panel is
             likewise unused and is the other half of that unbuilt intent.) -->
        <!--
            ⚠️ `:on-approved`, A FUNCTION PROP — NOT `@approved`. This is the whole fix for
            the "approved device lands on a password form" bug, and the reason is one line of
            Vue: `emit()` early-returns on an unmounted instance, a prop closure does not.

            The announcement races its own cause. `openPodWithFamilyKey` clears the staged
            file (`syncStore.ts:3383`) and then awaits more work, Vue flushes,
            `canUseDeviceApproval` goes false, the `v-if` above tears this panel down — and
            only THEN does the approval resolve and try to speak. Through `emit` it spoke to
            nobody, `finishLoaded()` never ran, and the person got a password prompt over an
            already-decrypted pod.

            An earlier attempt watched `hasPendingEncryptedFile` from here instead. It was
            inert on the main path (the watcher had no `immediate`, and this view usually
            MOUNTS with a file already staged) and it over-fired on every other unlock route,
            because "a staged Drive file went away" is not "an approval happened". A closure
            that survives its component needs neither guard.
          -->
        <ColdSignInPanel surface="load-pod-unlock" :on-approved="() => finishLoaded()" />
      </div>

      <!-- Password form -->
      <!-- Nothing can open this file: the honest message, and no field to fill. -->
      <div
        v-if="nothingCanOpenIt && formError"
        class="dark:text-danger-lift mt-6 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20"
      >
        {{ formError }}
      </div>

      <form v-if="!showKitEntry && !nothingCanOpenIt" class="mt-6" @submit.prevent="handleDecrypt">
        <div
          v-if="formError"
          class="dark:text-danger-lift mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20"
        >
          {{ formError }}
        </div>

        <!-- ⚠️ `autocomplete` COMES FROM `secretField` TOO, not just the label. This box is
             `type="password"`, so with no attribute the browser applies its password
             heuristic regardless of what the label says — and a passphrase-only family
             signing in cold types their FAMILY PASSPHRASE into a field the manager treats
             as the saved site password, which it then offers to overwrite. That is the
             exact harm `SecretFieldCopy.autocomplete` was added for, and this is the
             higher-traffic of its two surfaces: the screen a locked-out person reaches. -->
        <BaseInput
          v-model="decryptPassword"
          :label="t(secretField.label)"
          type="password"
          :placeholder="t(secretField.placeholder)"
          :autocomplete="secretField.autocomplete"
          required
        />

        <BaseButton
          type="submit"
          class="from-primary-500 to-terracotta-400 mt-4 w-full bg-gradient-to-r"
          :loading="isLoadingFile"
        >
          {{ t('loginV6.unlockButton') }}
        </BaseButton>

        <div v-if="hasRecoveryKits" class="mt-4">
          <RecoveryKitLink :forgot="secretField.forgot" @click="openKitEntry" />
        </div>

        <p
          v-if="pendingMemberCount > 0"
          class="dark:text-ink-faint mt-3 text-center text-xs text-gray-400"
        >
          {{ t('loginV6.unlockMemberCount').replace('{count}', String(pendingMemberCount)) }}
        </p>

        <p class="dark:text-ink-faint mt-2 text-center text-xs text-gray-400">
          {{ t(secretField.footer) }}
        </p>
      </form>

      <!-- Recovery-kit entry (Phase 3): swaps in for the password form.
           ⚠️ `v-else-if`, NOT a bare `v-else`. The secret form above is gated on
           `!nothingCanOpenIt`, so a bare `v-else` handed the degenerate envelope
           straight to THIS form — a Recovery Code field over a file with no kit
           wraps, which is the same impossible offer this change exists to remove,
           merely relocated. It also rendered `formError` a second time beneath
           the honest message. -->
      <form v-else-if="!nothingCanOpenIt" class="mt-6" @submit.prevent="handleKitRedeem">
        <div
          v-if="formError"
          class="dark:text-danger-lift mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20"
        >
          {{ formError }}
        </div>
        <p class="dark:text-ink-soft mb-3 text-center text-sm text-gray-600">
          {{ t('recovery.kitEnterBody') }}
        </p>
        <BaseInput
          v-model="kitCodeInput"
          :label="t('recovery.kitCodeLabel')"
          type="text"
          autocomplete="off"
          spellcheck="false"
          required
        />
        <label
          class="dark:text-ink-soft dark:hover:text-ink mt-3 flex w-full items-center justify-center gap-2 text-sm text-gray-500 transition-colors hover:text-gray-700"
          :class="isScanningKit ? 'cursor-wait opacity-70' : 'cursor-pointer'"
        >
          <BeanieSpinner v-if="isScanningKit" size="sm" />
          <svg
            v-else
            class="h-4 w-4"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            viewBox="0 0 24 24"
          >
            <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
          {{ isScanningKit ? t('recovery.kitScanReading') : t('recovery.kitScanPhoto') }}
          <!--
            ⚠️ NO `capture` ATTRIBUTE, deliberately — it was added here and reverted.
            With `capture` present, iOS Safari and Android Chrome open the viewfinder
            DIRECTLY, with no "Photo Library" and no "Files" entry. That makes the saved kit
            PDF — the artefact `RecoveryKitDisplay.exportKitPdf` exists to produce, and the
            one this label offers first — impossible to select, and there is nothing
            physical to photograph. `recovery.kitScanFailed` then tells the user to try the
            saved PDF, which the attribute just made unreachable.

            `PhotoAttachments` and `AiDocumentPicker` do set `capture`, but both keep TWO
            pickers side by side (a camera one and a files one). A single capture input is
            not that pattern; adding the second picker here is the right shape and is left
            as follow-up rather than guessed at now.
          -->
          <input
            type="file"
            accept="image/*,application/pdf,.pdf"
            class="hidden"
            :disabled="isScanningKit"
            @change="handleKitPhotoPicked"
          />
        </label>
        <BaseButton
          type="submit"
          class="from-primary-500 to-terracotta-400 mt-4 w-full bg-gradient-to-r"
          :loading="isLoadingFile"
        >
          {{ t('recovery.unlock') }}
        </BaseButton>
        <!-- ⚠️ Gated. This button was unconditional, and on a kit-born family it offered
             "Use password instead" over an envelope with NO password wrap — the reported
             bug. It is the way BACK to a password form, so it may only appear when a
             password can actually open this envelope. Nobody is stranded without it: the
             screen-level Back above the decrypt block is always present.

             ⚠️ AND IT MAY NOT BE GATED ON `caps.password` ALONE. A passphrase-only family
             is routed to the kit form, and this button is its ONLY way to a field it can
             type into; gating it on the password wrap left such a family unable to open
             its file at all. Hence the `|| caps?.passphrase`. -->
        <button
          v-if="caps?.password || caps?.passphrase"
          type="button"
          class="dark:text-ink-soft dark:hover:text-ink mt-3 w-full text-center text-sm text-gray-500 transition-colors hover:text-gray-700"
          @click="closeKitEntry"
        >
          {{ t(secretField.switchLabel) }}
        </button>
      </form>

      <!-- Cold-arrival hint: user landed on this screen via a shared .beanpod
           (e.g. Drive's "Open with") but doesn't have the password. They are
           NOT supposed to create a new family — that would just create an
           empty pod separate from this one. The right path is to ask the
           family owner for an invite link, which goes through /join.
           Mirrors the brand's existing security-card styling (white squircle +
           soft shadow + Sky Silk icon-circle) so it reads as part of the same
           visual system rather than a generic SaaS info notice. The key icon
           ties semantically to "no password = no key". -->
      <!-- ⚠️ COLD ARRIVALS ONLY, AND IT DOES NOT KNOW WHOSE FILE THIS IS. The gate is
           `hasPendingEncryptedFile` — "a file is staged and not yet decrypted" — which is
           equally true for a stranger AND for a member returning to their own family on a new
           device. It must never render when the pod is already open (the recovery-kit escape
           from the PIN challenge lands here), but even cold it cannot tell the two apart.
           So the BODY asserts nothing about ownership and only names the ways in. An earlier
           version claimed the file belonged to another family, which every returning member
           read about their own pod. Do not reintroduce a guess here: a magic-link holder on a
           cold device is precisely the case where the file IS theirs and the device knows
           nothing. -->
      <div
        v-if="syncStore.hasPendingEncryptedFile"
        class="dark:bg-surface-overlay/50 mt-6 flex items-start gap-3 rounded-[18px] bg-white p-4 shadow-[0_4px_16px_rgba(44,62,80,0.04)] dark:shadow-none"
      >
        <div
          class="bg-sky-silk-300/[0.22] dark:bg-sky-silk-300/[0.15] flex h-9 w-9 flex-none items-center justify-center rounded-full"
          aria-hidden="true"
        >
          <svg class="h-4 w-4 text-[#3498db]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
            />
          </svg>
        </div>
        <div class="flex-1">
          <!-- ⚠️ Deliberately NOT capability-gated — the string itself is
               credential-neutral instead, which is why this card can render on every
               envelope shape. It replaces a pair split on `caps.password` that said
               "Don't have the password?" to families that have never had one. Keep the
               body below neutral too: its `en` value once ended "no password needed up
               front" while its `beanie` value did not, so the guard test passed. -->
          <p class="text-secondary-500 dark:text-ink text-sm font-bold">
            {{ t('loginV6.unlockNoAccessTitle') }}
          </p>
          <p class="text-secondary-500/70 dark:text-ink-soft mt-1 text-xs leading-relaxed">
            {{ t('loginV6.unlockNoPasswordHint') }}
          </p>
        </div>
      </div>
    </template>

    <!-- ═══════════════════════════════════════════════════════════
         Standard LoadPodView (storage selection, loading, etc.)
         Only shown when no file is pending password entry.
         ═══════════════════════════════════════════════════════════ -->
    <template v-else>
      <!-- Header -->
      <div class="mb-6 text-center">
        <h2 class="font-outfit dark:text-ink text-xl font-bold text-gray-900">
          {{ t('loginV6.loadPodTitle') }}
        </h2>
        <p class="dark:text-ink-soft mt-1 text-sm text-gray-500">
          {{ t('loginV6.loadPodSubtitle') }}
        </p>
      </div>

      <!--
        ⚠️ ABOVE THE STORAGE CARDS, NOT BELOW THEM. This panel used to be the very last
        thing on the page, under the Drive card, a divider, "open a saved file" and the
        security blurbs — and this file's own comment admitted the consequence: a person
        holding a link "lands on this page and finds storage-provider cards and no way to
        use what they are holding".

        ⚠️ PASTE ONLY, NOT THE SCAN PANEL. At this step no `.beanpod` is staged yet — the
        person is still choosing where theirs lives — and a pull-mode QR polls the staged
        file for its approval. It would render and wait forever here. A pasted magic link
        works, because the link carries its own fileId. The scan panel lives on the decrypt
        step below, where a pod is in hand.
      -->
      <!-- The promoted route, above everything, on the two unstaged states. It carries its
           own paste panel, which is why the hoisted one below is switched off when it shows. -->
      <ScanFirstBlock v-if="showScanFirst" :surface="coldSurface" />

      <div v-else class="mb-6">
        <PasteLinkPanel />
      </div>

      <!-- Error -->
      <div
        v-if="formError"
        class="dark:text-danger-lift mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20"
      >
        {{ formError }}
      </div>

      <!-- Reconnect-to-known-Drive-file state — the token's gone but we know
           the exact pod file. One consent, then load it directly (no provider
           cards, no file picker). Mirrors the permission-grant card below. -->
      <div v-if="viewState === 'reconnect'" class="space-y-4">
        <div
          class="dark:border-line-strong rounded-2xl border-2 border-dashed border-gray-200 p-8 text-center"
        >
          <div
            class="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-900/30"
          >
            <svg
              class="dark:text-terracotta-lift h-7 w-7 text-amber-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>
          <p class="dark:text-ink-soft mb-4 text-sm text-gray-600">{{ reconnectHeadline }}</p>
          <BaseButton class="w-full" :loading="isReconnectBusy" @click="handleReconnectAndLoad()">
            {{ t('googleDrive.reconnect') }}
          </BaseButton>
        </div>
      </div>

      <!-- Loading state (only for auto-load and permission grant) -->
      <div v-else-if="viewState === 'auto-loading'" class="py-12 text-center">
        <BeanieSpinner size="md" class="mx-auto mb-3" />
        <p class="dark:text-ink-soft text-sm text-gray-500">{{ t('auth.loadingFile') }}</p>
      </div>

      <!-- Permission reconnect state -->
      <div v-else-if="viewState === 'permission-grant'" class="space-y-4">
        <div
          class="dark:border-line-strong rounded-2xl border-2 border-dashed border-gray-200 p-8 text-center"
        >
          <div
            class="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-900/30"
          >
            <svg
              class="dark:text-terracotta-lift h-7 w-7 text-amber-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>
          <p class="dark:text-ink-soft mb-4 text-sm text-gray-600">
            {{ t('auth.reconnectFile') }}
          </p>
          <BaseButton class="w-full" @click="handleGrantPermission">
            {{ t('auth.reconnectButton') }}
          </BaseButton>
        </div>
      </div>

      <!-- Empty-state redirect panel — REPLACES the storage cards entirely
           when Drive lookup confirmed no .beanpod files on this account.
           Frames the situation as a redirect ("you may be in the wrong
           place — try Create") rather than an error, and removes the
           magnetic Drive card that fed the original loop. -->
      <NoPodEmptyState
        v-else-if="viewState === 'empty'"
        :account-email="getGoogleAccountEmail() ?? undefined"
        @create="emit('request-create')"
        @switch-account="handleDriveSwitchAccount"
        @load-local="handleLoadLocalFromEmptyState"
        @retry="handleDriveRetry"
      />

      <!-- Storage source cards -->
      <template v-else>
        <div class="grid gap-3">
          <!-- Google Drive card — disabled when Drive isn't available in this
               build (Path-A self-host or missing OAuth proxy on Path-B).
               Dimmed (but still clickable) when lastDriveCheckEmpty is true,
               so a back-navigation user sees "we already checked here" and
               isn't pulled into the same loop again. -->
          <LoginChoiceCard
            class="relative rounded-2xl border-2 p-5"
            :class="[
              !syncStore.isGoogleDriveAvailable
                ? 'dark:border-line-strong dark:bg-surface-overlay/50 border-gray-200 bg-white'
                : selectedSource === 'google_drive'
                  ? 'border-primary-500 dark:border-primary-500/60 dark:bg-primary-500/10 bg-[#FEF0E8]/40 shadow-md hover:shadow-lg'
                  : 'hover:border-primary-500/40 dark:hover:border-primary-500/30 dark:border-line-strong dark:bg-surface-overlay/50 border-gray-200 bg-white hover:shadow-lg',
            ]"
            :disabled="isDriveLoading || !syncStore.isGoogleDriveAvailable"
            :dimmed="lastDriveCheckEmpty"
            :aria-label="t('googleDrive.storageLabel')"
            :testid="'drive-storage-card'"
            @click="handleLoadFromGoogleDrive"
          >
            <span
              v-if="!syncStore.isGoogleDriveAvailable"
              :title="t(driveDisabledTooltipKey)"
              class="absolute -top-2.5 right-3 rounded-full bg-gray-400 px-2.5 py-0.5 text-xs font-bold text-white shadow-sm"
            >
              {{ t('selfHost.notConfigured') }}
            </span>
            <span
              v-else-if="lastDriveCheckEmpty"
              class="absolute -top-2.5 right-3 rounded-full bg-gray-400 px-2.5 py-0.5 text-xs font-bold text-white shadow-sm"
              data-testid="drive-checked-badge"
            >
              {{ t('loginV6.checkedNothingFound') }}
            </span>
            <!-- ⚠️ NO "RECOMMENDED" BADGE ANY MORE. It cannot stand while a different route on
                 the same screen is flagged "fastest" — two competing recommendations is worse
                 than none. The two branches above stay: "not configured" and "checked, nothing
                 found" are states, not endorsements. This collapsed a three-way chain, so
                 `loginV6.recommended` is now dead and has been removed from `uiStrings`. -->
            <div
              class="bg-primary-500/10 dark:bg-primary-500/20 mb-2.5 flex h-10 w-10 items-center justify-center rounded-xl"
            >
              <svg
                v-if="isDriveLoading"
                class="text-primary-500 h-5 w-5 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  class="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  stroke-width="4"
                />
                <path
                  class="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              <svg v-else class="text-primary-500 h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <path
                  d="M12.545 10.239v3.821h5.445c-.712 2.315-2.647 3.972-5.445 3.972a6.033 6.033 0 110-12.064c1.498 0 2.866.549 3.921 1.453l2.814-2.814A9.969 9.969 0 0012.545 2C7.021 2 2.543 6.477 2.543 12s4.478 10 10.002 10c8.396 0 10.249-7.85 9.426-11.748l-9.426-.013z"
                />
              </svg>
            </div>
            <p class="dark:text-ink text-sm font-semibold text-gray-900">
              {{ t('googleDrive.storageLabel') }}
            </p>
            <p class="dark:text-ink-soft mt-0.5 text-xs text-gray-500">
              {{ t('loginV6.googleDriveCardDesc') }}
            </p>
          </LoginChoiceCard>
        </div>

        <!-- "Load a saved family file" — the quiet cross-account / restored-backup
             path (#47). One affordance; the backend is chosen per platform in
             handleOpenSavedFile (native OS picker / web FSA browse zone / web
             Google Picker). C8: ALWAYS rendered — when no backend can run (a
             self-hosted build on Firefox/Safari) it is shown DISABLED with clear
             guidance, never silently hidden (which read as a dead-end). -->
        <div class="mt-4">
          <div class="mb-3 flex items-center gap-2.5" aria-hidden="true">
            <span class="dark:bg-surface-hover h-px flex-1 bg-gray-200"></span>
            <span
              class="font-outfit text-secondary-500/50 dark:text-ink-soft text-xs font-semibold tracking-[0.08em] uppercase"
              >{{ t('loginV6.orDivider') }}</span
            >
            <span class="dark:bg-surface-hover h-px flex-1 bg-gray-200"></span>
          </div>
          <button
            type="button"
            class="group focus-visible:ring-primary-500 hover:border-primary-500/40 dark:hover:border-primary-500/30 dark:border-line-strong dark:bg-surface-overlay/50 dark:focus-visible:ring-offset-surface-ground flex w-full items-center gap-3 rounded-2xl border border-gray-200 bg-white p-3.5 text-left transition-all hover:-translate-y-0.5 hover:bg-[#FEF0E8]/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60"
            :disabled="!canOpenSavedFile"
            :aria-label="t('loginV6.openSavedFileLabel')"
            data-testid="open-saved-file-aside"
            @click="handleOpenSavedFile"
          >
            <span
              class="bg-sky-silk-300/20 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
            >
              <svg
                class="text-secondary-500/70 group-hover:text-primary-500 dark:text-ink-soft h-5 w-5 transition-colors"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </span>
            <span class="min-w-0 flex-1">
              <span class="dark:text-ink block text-sm font-semibold text-gray-900">{{
                t('loginV6.openSavedFileLabel')
              }}</span>
              <span class="dark:text-ink-soft mt-0.5 block text-xs text-gray-500">{{
                canOpenSavedFile
                  ? t('loginV6.openSavedFileDesc')
                  : t('loginV6.openSavedFileUnavailableHint')
              }}</span>
            </span>
            <svg
              class="group-hover:text-primary-500 dark:text-ink-faint h-4 w-4 shrink-0 text-gray-400 transition-colors"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>
          <!-- Revealed only after a cancelled chooser — see `loadSavedFileViaPicker`. -->
          <button
            v-if="showAccountSwitch"
            type="button"
            class="font-inter text-primary-500 dark:text-accent-lift mt-2 w-full text-center text-xs font-semibold underline underline-offset-2"
            @click="loadSavedFileViaPicker({ chooseAccount: true })"
          >
            {{ t('podAccess.recovery.pickFamilyFileOtherAccount') }}
          </button>
        </div>

        <!-- Coming-soon providers — collapsed into a disclosure with compact chips
             instead of disabled full-size cards. Mirrors CreatePodView (setup wizard). -->
        <details class="group mt-3">
          <summary
            class="font-outfit text-secondary-500/70 hover:text-primary-500 dark:text-ink-soft inline-flex cursor-pointer list-none items-center gap-1.5 px-1 py-2 text-xs font-semibold transition-colors"
          >
            <span
              class="text-primary-500 inline-block text-xs transition-transform group-open:rotate-90"
              aria-hidden="true"
              >▸</span
            >
            <span>{{ t('loginV6.moreProvidersComingSoon') }}</span>
          </summary>
          <div class="flex gap-2 pb-2 pl-4">
            <span
              class="font-outfit text-secondary-500/50 dark:border-line-strong dark:bg-surface-overlay/30 dark:text-ink-soft flex-1 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-2 py-2 text-center text-xs font-semibold"
              >📦 {{ t('storage.dropbox') }}</span
            >
            <span
              class="font-outfit text-secondary-500/50 dark:border-line-strong dark:bg-surface-overlay/30 dark:text-ink-soft flex-1 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-2 py-2 text-center text-xs font-semibold"
              >☁️ {{ t('storage.iCloud') }}</span
            >
            <span
              class="font-outfit text-secondary-500/50 dark:border-line-strong dark:bg-surface-overlay/30 dark:text-ink-soft flex-1 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-2 py-2 text-center text-xs font-semibold"
              >🪟 OneDrive</span
            >
          </div>
        </details>

        <!-- Local file drop zone (appears when Local File selected) -->
        <div
          v-if="selectedSource === 'local'"
          role="button"
          tabindex="0"
          class="group mt-3 w-full cursor-pointer rounded-2xl border-[3px] border-dashed px-6 py-8 text-center transition-all"
          :class="
            isDragging
              ? 'border-primary-500 dark:border-primary-500/60 dark:bg-primary-500/10 bg-[#FEF0E8]/40'
              : 'border-primary-500/20 from-primary-500/[0.02] to-sky-silk-300/[0.04] hover:border-primary-500/40 dark:border-primary-500/15 dark:from-primary-500/[0.03] dark:to-sky-silk-300/[0.02] dark:hover:border-primary-500/30 bg-gradient-to-br hover:bg-[#FEF0E8]/30'
          "
          @click="handleLoadFile"
          @keydown.enter="handleLoadFile"
          @dragenter="handleDragEnter"
          @dragleave="handleDragLeave"
          @dragover="handleDragOver"
          @drop="handleDrop"
        >
          <div
            class="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-2xl transition-colors"
            :class="
              isDragging
                ? 'bg-primary-500/15 dark:bg-primary-500/20'
                : 'group-hover:bg-primary-500/10 dark:bg-surface-overlay bg-gray-100'
            "
          >
            <svg
              class="h-7 w-7 transition-colors"
              :class="
                isDragging
                  ? 'text-primary-500'
                  : 'group-hover:text-primary-500 dark:text-ink-faint text-gray-400'
              "
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
          </div>
          <p class="dark:text-ink-soft font-medium text-gray-700">
            {{ t('loginV6.dropZoneText') }}
          </p>
          <p class="text-primary-500 mt-1 text-sm">
            {{ t('loginV6.dropZoneBrowse') }}
          </p>
          <p class="text-primary-500/70 dark:text-ink-soft mt-2 text-xs font-semibold">
            {{ t('loginV6.acceptsBeanpod') }}
          </p>
        </div>

        <!-- (Old amber "no Drive files" appended-empty-state was removed.
             Replaced by the NoPodEmptyState panel above which fully takes
             over the screen when showDriveEmptyState is true, so the user
             isn't pulled back into the same loop by an adjacent fresh-
             looking Drive card.) -->

        <!-- Google Drive File Picker Modal -->
        <GoogleDriveFilePicker
          :open="showDrivePicker"
          :files="driveFiles"
          :is-loading="isDriveLoading"
          @close="showDrivePicker = false"
          @select="handleDriveFileSelected"
          @refresh="handleDriveRefresh"
        />

        <!-- Security messaging -->
        <div class="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <!-- Card 1: Your Data, Your Cloud -->
          <div
            class="dark:bg-surface-overlay/50 rounded-[18px] bg-white p-4 text-center shadow-[0_4px_16px_rgba(44,62,80,0.04)] dark:shadow-none"
          >
            <div
              class="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-[#6EE7B7]/[0.12]"
            >
              <svg
                class="h-5 w-5 text-[#10b981]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"
                />
              </svg>
            </div>
            <p class="dark:text-ink-soft text-xs font-bold text-gray-700">
              {{ t('loginV6.securityYourData') }}
            </p>
            <p class="mt-0.5 text-xs opacity-35">
              {{ t('loginV6.securityYourDataDesc') }}
            </p>
          </div>

          <!-- Card 2: AES-256 Encrypted -->
          <div
            class="dark:bg-surface-overlay/50 rounded-[18px] bg-white p-4 text-center shadow-[0_4px_16px_rgba(44,62,80,0.04)] dark:shadow-none"
          >
            <div
              class="bg-primary-500/10 mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full"
            >
              <svg
                class="text-primary-500 h-5 w-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
            </div>
            <p class="dark:text-ink-soft text-xs font-bold text-gray-700">
              {{ t('loginV6.securityEncrypted') }}
            </p>
            <p class="mt-0.5 text-xs opacity-35">
              {{ t('loginV6.securityEncryptedDesc') }}
            </p>
          </div>

          <!-- Card 3: Zero Servers -->
          <div
            class="dark:bg-surface-overlay/50 rounded-[18px] bg-white p-4 text-center shadow-[0_4px_16px_rgba(44,62,80,0.04)] dark:shadow-none"
          >
            <div
              class="bg-sky-silk-300/20 mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full"
            >
              <svg
                class="h-5 w-5 text-[#3498db]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                />
              </svg>
            </div>
            <p class="dark:text-ink-soft text-xs font-bold text-gray-700">
              {{ t('loginV6.securityZeroServers') }}
            </p>
            <p class="mt-0.5 text-xs opacity-35">
              {{ t('loginV6.securityZeroServersDesc') }}
            </p>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>
