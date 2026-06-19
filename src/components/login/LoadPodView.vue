<script setup lang="ts">
/* global FileSystemFileHandle, FileSystemHandle */
import { ref, computed, onMounted, watch } from 'vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BeanieSpinner from '@/components/ui/BeanieSpinner.vue';
import GoogleDriveFilePicker from '@/components/google/GoogleDriveFilePicker.vue';
import LoginChoiceCard from './LoginChoiceCard.vue';
import NoPodEmptyState from './NoPodEmptyState.vue';
import { features } from '@/config/features';
import { useTranslation } from '@/composables/useTranslation';
import { useSettingsStore } from '@/stores/settingsStore';
import { useSyncStore } from '@/stores/syncStore';
import { useAuthStore } from '@/stores/authStore';
import { useFamilyStore } from '@/stores/familyStore';
import {
  getGoogleAccountEmail,
  shouldUseRedirectAuth,
  isTokenValid,
} from '@/services/google/googleAuth';
import { useGoogleReconnect } from '@/composables/useGoogleReconnect';
import { supportsFileSystemAccess } from '@/services/sync/capabilities';
import { fillTemplate } from '@/utils/fillTemplate';
import { LOAD_DRIVE_PATH } from './resumePaths';
import {
  isPlatformAuthenticatorAvailable,
  hasRegisteredPasskeys,
  registerPasskeyForMember,
} from '@/services/auth/passkeyService';

const { t } = useTranslation();
const settingsStore = useSettingsStore();
const syncStore = useSyncStore();
const authStore = useAuthStore();
const familyStore = useFamilyStore();

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
  skipBiometric?: boolean;
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
  crossDeviceContext?: {
    crossDevice: true;
    memberId: string;
    credentialId?: string;
  } | null;
}>();

const emit = defineEmits<{
  back: [];
  'file-loaded': [];
  'signed-in': [destination: string];
  'biometric-available': [payload: { familyId: string; familyName?: string }];
  'request-create': [];
}>();

const isLoadingFile = ref(false);
const formError = ref<string | null>(null);
const showDecryptModal = ref(false);
const decryptPassword = ref('');
const loadedFileName = ref<string | null>(null);
const isDragging = ref(false);
const selectedSource = ref<'google_drive' | 'dropbox' | 'icloud' | 'local' | null>(null);
let dragCounter = 0;

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

/** Family name from the pending encrypted envelope (available before decryption). */
const pendingFamilyName = computed(() => syncStore.pendingEncryptedFile?.envelope?.familyName);

/** Number of members with wrapped keys in the pending envelope. */
const pendingMemberCount = computed(() => {
  const keys = syncStore.pendingEncryptedFile?.envelope?.wrappedKeys;
  return keys ? Object.keys(keys).length : 0;
});

/**
 * Try to auto-decrypt using a cached family key from trusted device settings.
 * Returns true if decryption succeeded.
 */
async function tryAutoDecrypt(): Promise<boolean> {
  const pendingFamilyId = syncStore.pendingEncryptedFile?.envelope?.familyId;
  if (!pendingFamilyId) return false;

  // Try cached family key from trusted device
  const cachedKey = settingsStore.getCachedFamilyKey(pendingFamilyId);
  if (cachedKey) {
    try {
      const { importFamilyKey } = await import('@/services/crypto/familyKeyService');
      const { base64ToBuffer } = await import('@/utils/encoding');
      const raw = new Uint8Array(base64ToBuffer(cachedKey));
      const fk = await importFamilyKey(raw);
      const result = await syncStore.decryptPendingFileWithKey(fk);
      if (result.success) return true;
    } catch {
      // Cached key invalid — clear it
    }
    await settingsStore.clearCachedFamilyKey(pendingFamilyId);
  }

  return false;
}

/**
 * Check if biometric login is available for the given family.
 * Returns true if biometric-available was emitted (caller should stop the password flow).
 */
async function checkBiometricForFamily(familyId: string, familyName?: string): Promise<boolean> {
  if (props.skipBiometric) return false;
  try {
    const hasPlatform = await isPlatformAuthenticatorAvailable();
    if (!hasPlatform) return false;
    const hasPasskeys = await hasRegisteredPasskeys(familyId);
    if (!hasPasskeys) return false;
    emit('biometric-available', { familyId, familyName });
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract familyId/familyName from the pending encrypted file's raw sync data.
 */
function getPendingFamilyInfo(): { familyId?: string; familyName?: string } {
  const raw = syncStore.pendingEncryptedFile?.envelope;
  return { familyId: raw?.familyId, familyName: raw?.familyName };
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
async function handlePendingPassword(
  fileName: string | null,
  opts: { tryAuto?: boolean } = {}
): Promise<void> {
  if ((opts.tryAuto ?? true) && (await tryAutoDecrypt())) {
    emit('file-loaded');
    return;
  }
  const { familyId, familyName } = getPendingFamilyInfo();
  if (familyId && (await checkBiometricForFamily(familyId, familyName))) {
    // Biometric flow will handle decryption — don't show the password modal.
    return;
  }
  loadedFileName.value = fileName;
  showDecryptModal.value = true;
}

onMounted(async () => {
  if (props.loadError) {
    formError.value = props.loadError;
  }
  if (props.providerHint === 'local') {
    selectedSource.value = 'local';
  }
  if (props.autoLoad) {
    await autoLoadFile();
  }
});

async function autoLoadFile() {
  isLoadingFile.value = true;
  formError.value = null;

  try {
    // If there's already a pending encrypted file (e.g. from loadFromNewFile() before
    // a biometric fallback), go straight to decrypt flow instead of re-reading from
    // the configured handle — which may still point to the previous family's file.
    if (syncStore.hasPendingEncryptedFile) {
      await handlePendingPassword(syncStore.fileName);
      isLoadingFile.value = false;
      return;
    }

    const loadResult = await syncStore.loadFromFile();
    if (!loadResult.success && loadResult.needsPassword) {
      await handlePendingPassword(syncStore.fileName);
    } else if (loadResult.success) {
      emit('file-loaded');
    }
  } catch (e) {
    // File load failed — surface to the user (previously this was a bare
    // catch that left users stranded on the storage picker with no error).
    formError.value = syncStore.error ?? t('auth.fileLoadFailed');
    console.error('[LoadPodView] autoLoadFile failed:', e);
  }
  isLoadingFile.value = false;
}

async function handleGrantPermission() {
  isLoadingFile.value = true;
  formError.value = null;

  try {
    const granted = await syncStore.requestPermission();
    if (granted) {
      if (syncStore.hasPendingEncryptedFile) {
        await handlePendingPassword(syncStore.fileName);
      } else {
        emit('file-loaded');
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

async function handleLoadFile() {
  formError.value = null;

  // Local files need the File System Access API (Chromium-only). In Firefox/
  // Safari there's no writable handle, so even if we read the file via the
  // input fallback, edits could never save back to it — a silent dead-end.
  // Block here at the onboarding entry and steer to Drive / Chrome / Edge,
  // matching the create flow. (Settings → manual import keeps its own fallback
  // for advanced recovery, where the user already has a pod open.)
  if (!supportsFileSystemAccess()) {
    formError.value = t('auth.localFileUnsupported');
    return;
  }

  isLoadingFile.value = true;

  try {
    const result = await syncStore.loadFromNewFile();
    if (result.success) {
      emit('file-loaded');
    } else if (result.needsPassword) {
      await handlePendingPassword(syncStore.fileName, { tryAuto: false });
    } else if (syncStore.error) {
      formError.value = syncStore.error;
    } else {
      formError.value = t('auth.fileLoadFailed');
    }
  } catch {
    formError.value = syncStore.error || t('auth.fileLoadFailed');
  } finally {
    isLoadingFile.value = false;
  }
}

/**
 * Register a new passkey on this device after cross-device password fallback.
 * Wraps the family key with fresh PRF material and saves to the envelope.
 */
async function registerCrossDevicePasskey(memberId: string) {
  try {
    const fk = syncStore.familyKey;
    if (!fk) return;

    const member = familyStore.members.find((m) => m.id === memberId);
    if (!member) return;

    const familyId = syncStore.envelope?.familyId ?? authStore.currentUser?.familyId;
    if (!familyId) return;

    const result = await registerPasskeyForMember({
      memberId,
      memberName: member.name,
      memberEmail: member.email,
      familyId,
      familyKey: fk,
    });

    if (result.success && result.passkeySecret) {
      syncStore.addPasskeySecret(result.passkeySecret);
      await syncStore.syncNow(true);
    }
  } catch (e) {
    // Non-critical — passkey registration failure shouldn't block login
    console.warn('[LoadPodView] Cross-device passkey registration failed:', e);
  }
}

async function handleDecrypt() {
  if (!decryptPassword.value) {
    formError.value = t('password.required');
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
      // unwrap alone. Fall through to PickBeanView so the user explicitly
      // chooses which bean they are; the per-member verifyPassword check
      // there is salt-scoped per member, so identity is unambiguous after
      // they pick.
      const unambiguousMemberId =
        result.memberIds && result.memberIds.length === 1 ? result.memberIds[0] : null;

      if (unambiguousMemberId) {
        const signInResult = await authStore.signIn(unambiguousMemberId, decryptPassword.value);
        decryptPassword.value = '';
        if (signInResult.success) {
          // Cross-device: register passkey on this device and wrap family key with new PRF
          if (props.crossDeviceContext) {
            await registerCrossDevicePasskey(unambiguousMemberId);
          }
          emit('signed-in', '/nook');
          return;
        }
        // Sign-in failed (edge case: password changed after wrapping) — fall back
      }

      decryptPassword.value = '';
      emit('file-loaded');
    } else {
      formError.value = result.error ?? t('password.decryptionError');
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
  if (!file.name.endsWith('.beanpod') && !file.name.endsWith('.json')) {
    formError.value = t('auth.fileLoadFailed');
    return;
  }

  isLoadingFile.value = true;
  try {
    const result = await syncStore.loadFromDroppedFile(file, fileHandle);
    if (result.success) {
      emit('file-loaded');
    } else if (result.needsPassword) {
      await handlePendingPassword(file.name, { tryAuto: false });
    } else if (syncStore.error) {
      formError.value = syncStore.error;
    } else {
      formError.value = t('auth.fileLoadFailed');
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
async function handleReconnectAndLoad() {
  const file = props.reconnectDriveFile;
  if (!file) return;
  formError.value = null;
  isReconnectBusy.value = true;
  try {
    const ok = await reconnect(syncStore.providerAccountEmail ?? undefined);

    // On iOS/PWA `reconnect()` triggered a full-page redirect; the page is
    // navigating away and LoginPage re-runs the silent auto-load on return.
    if (shouldUseRedirectAuth()) return;

    if (!ok) {
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
  // token. Surface it directly — do NOT fall through to beginDriveAuthRedirect,
  // which would see `!isTokenValid()` and redirect again (consent loop).
  if (opts.isResume && !isTokenValid()) {
    formError.value = t('googleDrive.authFailed');
    return;
  }

  // Redirect surface + (no token OR switch-account) → bounce out; the resume
  // continuation re-enters here with a cached token. A start failure (no client
  // id, Browser.open rejects) is surfaced, never swallowed.
  try {
    if (
      await syncStore.beginDriveAuthRedirect(
        LOAD_DRIVE_PATH,
        syncStore.providerAccountEmail ?? undefined,
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
  isLoadingFile.value = true;
  formError.value = null;

  try {
    const result = await syncStore.loadFromGoogleDrive(payload.fileId, payload.fileName);
    if (result.success) {
      emit('file-loaded');
    } else if (result.needsPassword) {
      await handlePendingPassword(payload.fileName);
    } else if (syncStore.error) {
      formError.value = syncStore.error;
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
    driveFiles.value = await syncStore.listGoogleDriveFiles();
  } catch {
    // Keep existing list
  } finally {
    isDriveLoading.value = false;
  }
}
</script>

<template>
  <div class="mx-auto max-w-[540px] rounded-3xl bg-white p-8 shadow-xl dark:bg-slate-800">
    <!-- Back button -->
    <button
      class="mb-4 flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
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
          class="mx-auto mb-4 inline-flex items-center gap-2 rounded-full bg-[#27AE60]/[0.08] px-3 py-1.5 text-xs font-semibold text-[#27AE60] dark:bg-green-900/30 dark:text-green-400"
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
          class="mb-2 text-xs text-gray-400 dark:text-gray-500"
        >
          {{ syncStore.providerAccountEmail }}
        </p>

        <!-- Heading -->
        <h3 class="font-outfit text-xl font-bold text-gray-900 dark:text-gray-100">
          {{
            pendingFamilyName
              ? fillTemplate(t('loginV6.unlockTitleWithFamily'), { familyName: pendingFamilyName })
              : t('loginV6.unlockTitle')
          }}
        </h3>
        <p class="mt-1 text-xs opacity-40">
          {{ t('loginV6.unlockSubtitle') }}
        </p>
      </div>

      <!-- Password form -->
      <form class="mt-6" @submit.prevent="handleDecrypt">
        <div
          v-if="formError"
          class="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400"
        >
          {{ formError }}
        </div>

        <BaseInput
          v-model="decryptPassword"
          :label="t('password.password')"
          type="password"
          :placeholder="t('password.enterPasswordPlaceholder')"
          required
        />

        <BaseButton
          type="submit"
          class="from-primary-500 to-terracotta-400 mt-4 w-full bg-gradient-to-r"
          :loading="isLoadingFile"
        >
          {{ t('loginV6.unlockButton') }}
        </BaseButton>

        <p
          v-if="pendingMemberCount > 0"
          class="mt-3 text-center text-xs text-gray-400 dark:text-gray-500"
        >
          {{ t('loginV6.unlockMemberCount').replace('{count}', String(pendingMemberCount)) }}
        </p>

        <p class="mt-2 text-center text-xs opacity-30">
          {{ t('loginV6.unlockFooter') }}
        </p>
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
      <div
        class="mt-6 flex items-start gap-3 rounded-[18px] bg-white p-4 shadow-[0_4px_16px_rgba(44,62,80,0.04)] dark:bg-slate-700/50 dark:shadow-none"
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
          <p class="text-secondary-500 text-sm font-bold dark:text-gray-100">
            {{ t('loginV6.unlockNoPasswordTitle') }}
          </p>
          <p class="text-secondary-500/70 mt-1 text-xs leading-relaxed dark:text-gray-300">
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
        <h2 class="font-outfit text-xl font-bold text-gray-900 dark:text-gray-100">
          {{ t('loginV6.loadPodTitle') }}
        </h2>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {{ t('loginV6.loadPodSubtitle') }}
        </p>
      </div>

      <!-- Error -->
      <div
        v-if="formError"
        class="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400"
      >
        {{ formError }}
      </div>

      <!-- Reconnect-to-known-Drive-file state — the token's gone but we know
           the exact pod file. One consent, then load it directly (no provider
           cards, no file picker). Mirrors the permission-grant card below. -->
      <div v-if="viewState === 'reconnect'" class="space-y-4">
        <div
          class="rounded-2xl border-2 border-dashed border-gray-200 p-8 text-center dark:border-slate-600"
        >
          <div
            class="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-900/30"
          >
            <svg
              class="h-7 w-7 text-amber-600 dark:text-amber-400"
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
          <p class="mb-4 text-sm text-gray-600 dark:text-gray-400">{{ reconnectHeadline }}</p>
          <BaseButton class="w-full" :loading="isReconnectBusy" @click="handleReconnectAndLoad">
            {{ t('googleDrive.reconnect') }}
          </BaseButton>
        </div>
      </div>

      <!-- Loading state (only for auto-load and permission grant) -->
      <div v-else-if="viewState === 'auto-loading'" class="py-12 text-center">
        <BeanieSpinner size="md" class="mx-auto mb-3" />
        <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('auth.loadingFile') }}</p>
      </div>

      <!-- Permission reconnect state -->
      <div v-else-if="viewState === 'permission-grant'" class="space-y-4">
        <div
          class="rounded-2xl border-2 border-dashed border-gray-200 p-8 text-center dark:border-slate-600"
        >
          <div
            class="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-900/30"
          >
            <svg
              class="h-7 w-7 text-amber-600 dark:text-amber-400"
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
          <p class="mb-4 text-sm text-gray-600 dark:text-gray-400">
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
        <div class="grid grid-cols-2 gap-3">
          <!-- Google Drive card — disabled when Drive isn't available in this
               build (Path-A self-host or missing OAuth proxy on Path-B).
               Dimmed (but still clickable) when lastDriveCheckEmpty is true,
               so a back-navigation user sees "we already checked here" and
               isn't pulled into the same loop again. -->
          <LoginChoiceCard
            class="relative rounded-2xl border-2 p-5"
            :class="[
              !syncStore.isGoogleDriveAvailable
                ? 'border-gray-200 bg-white dark:border-slate-600 dark:bg-slate-700/50'
                : selectedSource === 'google_drive'
                  ? 'border-primary-500 dark:border-primary-500/60 dark:bg-primary-500/10 bg-[#FEF0E8]/40 shadow-md hover:shadow-lg'
                  : 'hover:border-primary-500/40 dark:hover:border-primary-500/30 border-gray-200 bg-white hover:shadow-lg dark:border-slate-600 dark:bg-slate-700/50',
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
            <span
              v-else
              class="from-primary-500 to-terracotta-400 absolute -top-2.5 right-3 rounded-full bg-gradient-to-r px-2.5 py-0.5 text-xs font-bold text-white shadow-sm"
            >
              {{ t('loginV6.recommended') }}
            </span>
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
            <p class="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {{ t('googleDrive.storageLabel') }}
            </p>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              {{ t('loginV6.googleDriveCardDesc') }}
            </p>
          </LoginChoiceCard>

          <!-- Local File card -->
          <LoginChoiceCard
            class="relative rounded-2xl border-2 p-5"
            :class="
              selectedSource === 'local'
                ? 'border-primary-500 dark:border-primary-500/60 dark:bg-primary-500/10 bg-[#FEF0E8]/40 shadow-md hover:shadow-lg'
                : 'hover:border-primary-500/40 dark:hover:border-primary-500/30 border-gray-200 bg-white hover:shadow-lg dark:border-slate-600 dark:bg-slate-700/50'
            "
            :aria-label="t('storage.localFile')"
            :testid="'local-storage-card'"
            @click="selectedSource = selectedSource === 'local' ? null : 'local'"
          >
            <div
              class="mb-2.5 flex h-10 w-10 items-center justify-center rounded-xl"
              :class="
                selectedSource === 'local'
                  ? 'bg-primary-500/15 dark:bg-primary-500/20'
                  : 'bg-gray-100 dark:bg-slate-700'
              "
            >
              <svg
                class="h-5 w-5"
                :class="
                  selectedSource === 'local'
                    ? 'text-primary-500'
                    : 'text-gray-400 dark:text-gray-500'
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
            <p class="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {{ t('storage.localFile') }}
            </p>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              {{ t('loginV6.localFileCardDesc') }}
            </p>
          </LoginChoiceCard>
        </div>

        <!-- Coming-soon providers — collapsed into a disclosure with compact chips
             instead of disabled full-size cards. Mirrors CreatePodView (setup wizard). -->
        <details class="group mt-3">
          <summary
            class="font-outfit text-secondary-500/70 hover:text-primary-500 inline-flex cursor-pointer list-none items-center gap-1.5 px-1 py-2 text-xs font-semibold transition-colors dark:text-gray-400"
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
              class="font-outfit text-secondary-500/50 flex-1 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-2 py-2 text-center text-xs font-semibold dark:border-slate-600 dark:bg-slate-700/30 dark:text-gray-400"
              >📦 {{ t('storage.dropbox') }}</span
            >
            <span
              class="font-outfit text-secondary-500/50 flex-1 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-2 py-2 text-center text-xs font-semibold dark:border-slate-600 dark:bg-slate-700/30 dark:text-gray-400"
              >☁️ {{ t('storage.iCloud') }}</span
            >
            <span
              class="font-outfit text-secondary-500/50 flex-1 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-2 py-2 text-center text-xs font-semibold dark:border-slate-600 dark:bg-slate-700/30 dark:text-gray-400"
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
                : 'group-hover:bg-primary-500/10 bg-gray-100 dark:bg-slate-700'
            "
          >
            <svg
              class="h-7 w-7 transition-colors"
              :class="
                isDragging
                  ? 'text-primary-500'
                  : 'group-hover:text-primary-500 text-gray-400 dark:text-gray-500'
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
          <p class="font-medium text-gray-700 dark:text-gray-300">
            {{ t('loginV6.dropZoneText') }}
          </p>
          <p class="text-primary-500 mt-1 text-sm">
            {{ t('loginV6.dropZoneBrowse') }}
          </p>
          <p class="text-primary-500/70 mt-2 text-xs font-semibold">
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
            class="rounded-[18px] bg-white p-4 text-center shadow-[0_4px_16px_rgba(44,62,80,0.04)] dark:bg-slate-700/50 dark:shadow-none"
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
            <p class="text-xs font-bold text-gray-700 dark:text-gray-300">
              {{ t('loginV6.securityYourData') }}
            </p>
            <p class="mt-0.5 text-xs opacity-35">
              {{ t('loginV6.securityYourDataDesc') }}
            </p>
          </div>

          <!-- Card 2: AES-256 Encrypted -->
          <div
            class="rounded-[18px] bg-white p-4 text-center shadow-[0_4px_16px_rgba(44,62,80,0.04)] dark:bg-slate-700/50 dark:shadow-none"
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
            <p class="text-xs font-bold text-gray-700 dark:text-gray-300">
              {{ t('loginV6.securityEncrypted') }}
            </p>
            <p class="mt-0.5 text-xs opacity-35">
              {{ t('loginV6.securityEncryptedDesc') }}
            </p>
          </div>

          <!-- Card 3: Zero Servers -->
          <div
            class="rounded-[18px] bg-white p-4 text-center shadow-[0_4px_16px_rgba(44,62,80,0.04)] dark:bg-slate-700/50 dark:shadow-none"
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
            <p class="text-xs font-bold text-gray-700 dark:text-gray-300">
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
