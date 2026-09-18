<script setup lang="ts">
/**
 * The cold device's half of device approval: show a code, wait to be let in.
 *
 * This is what makes "the laptop is the cold one" work. The laptop cannot mint — it holds
 * no family key — so it asks instead, and the phone, which has both the key and a camera,
 * answers. Same crypto as every other wrap in the product; opposite ergonomics.
 *
 * ⚠️ THIS DEVICE NEVER WRITES, ONLY READS, and that is load-bearing rather than incidental.
 * The normal save path serialises the envelope from the DECRYPTED in-memory Automerge doc
 * (`createBeanpodV4`), which a key-less device cannot do without preserving
 * `encryptedPayload` verbatim — and no code path does that. Designing the request as
 * display-plus-poll sidesteps the hazard entirely: the approver does the only write, from a
 * device that has the key, through the ordinary path.
 *
 * ⚠️ THE QR CARRIES A PUBLIC KEY. Photographing it gains nothing. All of the authority is
 * the approval tap on the trusted device, in front of a fingerprint both screens show.
 */
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import { useSyncStore } from '@/stores/syncStore';
import { useTranslation } from '@/composables/useTranslation';
import { usePollWhileVisible } from '@/composables/usePollWhileVisible';
import { renderQr } from '@/utils/qrCode';
import { shareableOrigin } from '@/utils/shareableOrigin';
import { APPROVAL_LINK_HASH } from '@/services/auth/deepLinks';
import {
  createApprovalRequest,
  unwrapApproval,
  APPROVAL_EXPIRY_MS,
  type ApprovalRequest,
} from '@/services/crypto/deviceApproval';
import {
  emitDeviceApprovalRequested,
  emitDeviceApprovalOutcome,
} from '@/services/telemetry/loginFlowEvents';
import { reportError } from '@/utils/errorReporter';

const emit = defineEmits<{ approved: []; retry: [] }>();

const { t } = useTranslation();
const syncStore = useSyncStore();

const request = ref<ApprovalRequest | null>(null);
const qr = ref('');
const qrUnavailable = ref(false);
const expired = ref(false);
const failed = ref(false);

/**
 * 3 seconds, not the 10–15s the file pollers use.
 *
 * Those are background watchers; this is a person staring at a screen having just asked
 * someone in the next room to tap approve. `usePollWhileVisible` stops entirely while the
 * tab is hidden, so a backgrounded laptop costs nothing at this cadence.
 */
const POLL_MS = 3_000;

const fingerprint = computed(() => request.value?.fingerprint ?? '');

let poller: { stop: () => void } | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;
/** Last `modifiedTime` seen from the cheap probe, so an unchanged file is not re-downloaded. */
let lastSeenModified: string | null = null;
/** The mtime a read is being attempted for; promoted to `lastSeenModified` only on success. */
let pendingModified: string | null = null;
/**
 * Set by `onBeforeUnmount`. The timer and the poller are installed AFTER two awaits inside
 * an async `onMounted`, so a component torn down in that window would otherwise have run
 * `stopWaiting()` as a no-op and then had both installed on a dead instance — leaking a
 * 3-second poll from a screen nobody is on. `usePollWhileVisible`'s own `onScopeDispose`
 * safety net cannot help, because the effect scope is popped at the first await.
 */
let disposed = false;

function stopWaiting(): void {
  disposed = true;
  poller?.stop();
  poller = null;
  if (expiryTimer) clearTimeout(expiryTimer);
  expiryTimer = null;
}

/**
 * One poll tick: re-read the file, look for an approval addressed to THIS request.
 *
 * ⚠️ `loadFromFile`, not `stagePendingFile`. The latter short-circuits to `{ ok: true }`
 * whenever a pending encrypted file exists — which is exactly this device's state — so
 * polling through it would spin for the full window against a cached envelope and never
 * see the approval, while looking like a working screen.
 */
async function checkForApproval(): Promise<void> {
  const req = request.value;
  if (!req || expired.value || inFlight || disposed) return;

  // A tick must never outlast its interval. A Drive read is ~2.6s at p50 against a 3s
  // cadence, so without this the downloads stack.
  inFlight = true;
  try {
    // ⚠️ A CHEAP METADATA PROBE FIRST. `loadFromFile()` downloads and parses the whole
    // multi-megabyte `.beanpod`; doing that unconditionally twenty times a minute is a read
    // storm, and at a ~2.6s p50 Drive read against a 3s cadence the downloads would stack.
    // The codebase's own poller avoids exactly this — `fetchAndMergeRemote` gates on
    // `remoteChanged()` first, with the comment "a persistent provider error must not turn
    // the 10s poll into a read storm".
    //
    // The approver's write bumps the file's modified time, so the probe IS the signal we
    // are waiting for. A degraded or throwing probe falls through to a read rather than
    // stalling the flow — failing towards "check anyway" is the safe direction here.
    let shouldRead = true;
    try {
      const { remoteChanged } = await import('@/services/sync/syncService');
      const probe = await remoteChanged();
      if (probe.modifiedTime) {
        shouldRead = probe.modifiedTime !== lastSeenModified;
        // ⚠️ NOT advanced here. `lastSeenModified` may only move after a read has actually
        // SUCCEEDED — otherwise one transient failure (a 5xx, a token blip, a second
        // offline) consumes the change signal permanently: every later tick sees the same
        // mtime, skips the read, and the screen waits out its whole window and reports
        // `expired` while the approver's phone says it worked.
        pendingModified = probe.modifiedTime;
      }
    } catch {
      // Probe unavailable — read. Never let a diagnostic shortcut become the reason the
      // approval is missed.
    }
    if (!shouldRead) return;

    // ⚠️ RE-CHECKED AFTER EVERY AWAIT, not just at mount. A tick that began while the pod
    // was locked can otherwise land after the user's password succeeded — at which point
    // `loadFromFile` sees a live family key and takes its document-REPLACE branch against
    // the document that sign-in just opened. `onBeforeUnmount` clears the interval but
    // cannot reach into a request already in flight.
    if (disposed || syncStore.familyKey) return;

    const loaded = await syncStore.loadFromFile();
    // Only now is the signal spent.
    if (loaded?.success !== false || syncStore.pendingEncryptedFile)
      lastSeenModified = pendingModified;

    // ⚠️ `pendingEncryptedFile.envelope`, NOT `syncStore.envelope`.
    //
    // `loadFromFile` only calls `replaceEnvelope(remoteEnvelope)` inside its `if (liveKey)`
    // branch (syncStore.ts:1987). THIS DEVICE HAS NO FAMILY KEY — that is the entire reason
    // it is asking to be let in — so control always falls to the no-key terminus, which
    // parks the freshly-parsed envelope in `pendingEncryptedFile` and leaves `envelope`
    // untouched. Reading `syncStore.envelope` here meant the approval was never observed,
    // and the flow could not succeed at all: the phone would say "Device Approved" while
    // this screen waited out its window and reported `expired`.
    const entries = syncStore.pendingEncryptedFile?.envelope?.deviceApprovalKeys;
    if (!entries) return;

    // The entry is keyed by the APPROVER's memberId, which this device cannot know, so it
    // looks for the one addressed to its own public key.
    for (const wrap of Object.values(entries)) {
      const expiry = new Date(wrap.expiresAt).getTime();
      // Fail CLOSED on an unparseable expiry. `NaN < Date.now()` is false, so the original
      // comparison let a corrupt entry through as though it were live.
      if (!Number.isFinite(expiry) || expiry < Date.now()) continue;

      let familyKey: CryptoKey | null = null;
      try {
        familyKey = await unwrapApproval(req, wrap);
      } catch {
        // ⚠️ PER ENTRY, and this must stay per entry. `unwrapApproval` only returns null
        // for a hash mismatch; past that, a malformed base64url, a truncated SPKI or an
        // AES-KW integrity failure all THROW. `deviceApprovalKeys` merges by union across
        // peers, so a partially-merged entry is reachable — and `Object.values` order is
        // stable, so one bad entry would abort the scan at the same point on every tick and
        // the real approval sitting behind it would never be reached.
        continue;
      }
      if (!familyKey) continue;

      stopWaiting();
      const opened = await syncStore.openPodWithFamilyKey(familyKey);
      if (!opened.ok) {
        failed.value = true;
        emitDeviceApprovalOutcome({ outcome: 'failed', errorCode: opened.reason });
        return;
      }
      emitDeviceApprovalOutcome({ outcome: 'ok' });
      emit('approved');
      return;
    }
  } catch (e) {
    // ⚠️ `loadFromFile` THROWS when the remote-unreadable latch is set, and there was no
    // catch here — so the throw escaped into the poller's reporter twenty times a minute.
    // `logEvent` is rate-limited to 50 per surface per minute, so a single latched screen
    // was silently starving out the `cold_unlock_started` / `device_approval_outcome`
    // events this whole feature was added to measure. One report, then stop.
    stopWaiting();
    failed.value = true;
    emitDeviceApprovalOutcome({ outcome: 'failed', errorCode: 'poll-failed' });
    reportError({
      surface: 'login-flow',
      message: 'device approval poll could not read the family file',
      severity: 'warning',
      error: e,
      context: { action: 'device_approval_poll_failed' },
    });
  } finally {
    inFlight = false;
  }
}

onMounted(async () => {
  try {
    const req = await createApprovalRequest();
    request.value = req;
    emitDeviceApprovalRequested();

    const url = `${shareableOrigin()}/welcome#${APPROVAL_LINK_HASH}${encodeURIComponent(req.publicKeyB64)}`;
    const drawn = await renderQr(url, { surface: 'login-flow', kind: 'device-approval' });
    if ('dataUrl' in drawn) {
      qr.value = drawn.dataUrl;
    } else {
      // ⚠️ NO POLLING WITHOUT A CODE. The QR is the ONLY channel carrying the public key —
      // there is no paste-or-type fallback — so a request whose code never drew cannot be
      // approved by anyone. Polling for three minutes would burn sixty probes and a full
      // `.beanpod` download, then report `expired`, which in CloudWatch is indistinguishable
      // from a person declining.
      qrUnavailable.value = true;
      emitDeviceApprovalOutcome({ outcome: 'failed', errorCode: 'qr-unavailable' });
      return;
    }

    // `usePollWhileVisible` has NO cap of its own — it polls until stopped — so the
    // window is this component's to enforce. Without it the screen waits forever and
    // "nobody approved me" is indistinguishable from "this is still working".
    if (disposed) return;
    expiryTimer = setTimeout(() => {
      expired.value = true;
      stopWaiting();
      emitDeviceApprovalOutcome({ outcome: 'expired' });
    }, APPROVAL_EXPIRY_MS);

    // Torn down while we were awaiting — install nothing.
    if (disposed) return;
    poller = usePollWhileVisible(checkForApproval, POLL_MS, { surface: 'login-flow' });
  } catch (e) {
    // A device with no Web Crypto ECDH, or a generateKey that threw. The person is not
    // stuck — every other way in is still on the screen below — but this must not be a
    // blank square with no explanation.
    failed.value = true;
    emitDeviceApprovalOutcome({ outcome: 'failed', errorCode: 'request-failed' });
    reportError({
      surface: 'login-flow',
      message: 'device approval request could not be created',
      severity: 'warning',
      error: e,
      context: { action: 'device_approval_request_failed' },
    });
  }
});

onBeforeUnmount(stopWaiting);

function retry(): void {
  // A fresh keypair rather than reviving the old one: the previous request may already
  // have an approval written against it, and reusing it would race that entry.
  //
  // ⚠️ AN EMIT, NOT `window.location.reload()`. A remount is what this always wanted; the
  // reload was just a blunt way to get one. It became actively wrong once this component
  // sits behind a disclosure on phones: reloading drops the person back on the collapsed
  // push view with this section shut, so "show a new one" visibly does the opposite of what
  // it says. The parent owns the key, because a component cannot remount itself.
  emit('retry');
}
</script>

<template>
  <div class="text-center">
    <!--
      Hidden once this request is dead. The code used to stay on screen after `expired` or
      `failed`, so the approver could still scan it and publish a wrap that nothing was
      listening for — a screen indistinguishable from a working one.
    -->
    <div v-if="qr && !expired && !failed" class="flex justify-center">
      <div
        class="dark:border-line dark:bg-surface-raised rounded-3xl border border-gray-200 bg-white p-3 shadow-[var(--card-shadow)]"
      >
        <img :src="qr" :alt="t('deviceApproval.qrAlt')" class="h-44 w-44" />
      </div>
    </div>
    <p
      v-else-if="qrUnavailable"
      class="dark:text-ink-soft text-sm text-gray-600"
      data-testid="approval-qr-unavailable"
    >
      {{ t('deviceApproval.qrUnavailable') }}
    </p>

    <template v-if="fingerprint && !expired && !failed">
      <p
        class="font-outfit dark:text-ink dark:bg-surface-overlay mt-3 inline-block rounded-xl bg-gray-50 px-3 py-1.5 text-lg font-bold tracking-[0.22em] text-gray-900"
        data-testid="approval-fingerprint"
      >
        {{ fingerprint }}
      </p>
      <p class="dark:text-ink-faint mt-2 text-xs text-gray-500">
        {{ t('deviceApproval.compareHint') }}
      </p>
      <p
        class="dark:text-ink-soft mt-3 flex items-center justify-center gap-2 text-sm text-gray-600"
      >
        <span
          class="bg-primary-500 h-2 w-2 shrink-0 animate-pulse rounded-full"
          aria-hidden="true"
        />
        {{ t('deviceApproval.waiting') }}
      </p>
    </template>

    <!-- Expired and failed both say what happened and what to do — never a dead screen. -->
    <p
      v-if="expired"
      class="dark:text-ink-soft mt-3 text-sm text-gray-600"
      data-testid="approval-expired"
    >
      {{ t('deviceApproval.expired') }}
      <button type="button" class="text-primary-500 dark:text-accent-lift underline" @click="retry">
        {{ t('deviceApproval.tryAgain') }}
      </button>
    </p>
    <p
      v-else-if="failed"
      role="alert"
      class="dark:text-ink-soft mt-3 text-sm text-gray-600"
      data-testid="approval-failed"
    >
      {{ t('deviceApproval.failed') }}
      <!-- The copy promises "you can try again", so the control has to exist. It only did
           in the `expired` branch. -->
      <button type="button" class="text-primary-500 dark:text-accent-lift underline" @click="retry">
        {{ t('deviceApproval.tryAgain') }}
      </button>
    </p>
  </div>
</template>
