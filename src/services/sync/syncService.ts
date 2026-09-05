/**
 * Sync Service — low-level sync engine with storage provider abstraction.
 *
 * V4 architecture: the Automerge document is the source of truth in memory.
 * This service handles reading/writing the encrypted .beanpod V4 envelope
 * to/from the storage provider (local file or Google Drive).
 *
 * The family key (AES-256-GCM) encrypts the payload — no more password-based
 * encryption at the sync layer. The syncStore manages the family key lifecycle.
 */

import { supportsFileSystemAccess, isNative } from './capabilities';
import {
  PayloadLoadError,
  RemoteMergeError,
  CorruptPayloadError,
  isRemoteBlocker,
  type RemoteBlocker,
} from '@/types/sync';
import { PodLineageError, guardLineage } from '@/services/sync/podLineage';
import { getFileHandle, verifyPermission, getProviderConfig } from './fileHandleStore';
import { GoogleDriveProvider } from './providers/googleDriveProvider';
import { parseBeanpodV4, reEncryptEnvelope, openFilePicker, detectFileVersion } from './fileSync';
import * as docClient from '@/services/automerge/worker/docClient';
import { setInlineCachePersistFailedHandler } from '@/services/automerge/worker/inlineBridge';
import type { CachePersistFailureDetail } from '@/services/automerge/worker/protocol';
import { logEvent } from '@/services/telemetry';
import { bump as bumpOpenCycle } from '@/services/telemetry/openCycle';
import { getActiveFamilyId } from '@/services/indexeddb/database';
import { createFamilyWithId } from '@/services/familyContext';
import type { StorageProvider, StorageProviderType } from './storageProvider';
import { getAuxStore } from './storageProvider';
import {
  compareMarkers,
  withinTrustWindow,
  type RemoteBaseline,
  type RemoteMarker,
  type ChangeResult,
  decodeBaselinePayload,
  encodeBaselinePayload,
  hasUnpushedChanges,
  headsFingerprint,
} from './remoteBaseline';
import { isChunkName } from './chunkNames';
import { LocalStorageProvider } from './providers/localProvider';
import { CapacitorFileProvider } from './providers/capacitorFileProvider';
import { DriveApiError } from '@/services/google/driveService';
import { TokenExpiredError } from '@/services/google/googleAuth';
import type { BeanpodFileV4 } from '@/types/syncFileV4';
import { preserveLocalKeyDicts, withoutPayload } from './envelopeMerge';
import { setFlushProvider } from './offlineQueue';
import {
  usePollWhileVisible,
  type PollWhileVisibleHandle,
} from '@/composables/usePollWhileVisible';
import { effectScope } from 'vue';
import { reportError } from '@/utils/errorReporter';
import { isConflictFilename } from '@/utils/beanpodFilename';
import { showToast } from '@/composables/useToast';
import { useTranslationStore } from '@/stores/translationStore';

// Result type for openAndLoadFile
export interface OpenFileResult {
  success: boolean;
  envelope?: BeanpodFileV4;
  needsPassword?: boolean;
  fileHandle?: FileSystemFileHandle;
  provider?: StorageProvider;
  rawText?: string; // raw file text for V3 fallback detection
}

export interface SyncServiceState {
  isInitialized: boolean;
  isConfigured: boolean;
  fileName: string | null;
  isSyncing: boolean;
  lastError: string | null;
}

// Debounce timer for auto-save
let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 2000;

// Write mutex — prevents concurrent save() calls from interleaving writes
let saveInProgress: Promise<boolean> | null = null;

// Current storage provider (in-memory for session) and the family it belongs to
/**
 * THE remote-unreadable latch, and it lives HERE because this is the layer that
 * owns the download.
 *
 * Earlier attempts put it in `syncStore` (which cannot see the local-file poll
 * tick) and special-cased `doSave` (which only defended the first save). Both
 * doors lead through `fetchAndMergeRemote`, so one latch at this level closes
 * every one of them:
 *
 *   • `doSave` refuses rather than writing a base over a remote it never read;
 *   • the poll tick stops re-downloading megabytes to fail identically;
 *   • `syncStore` reads it through `isRemoteUnreadable()` instead of keeping a
 *     second copy that had to be cleared from five different places.
 *
 * Cleared by a read that actually merges, and by `resetState`.
 */
let remoteBlocked: RemoteBlocker | null = null;

/**
 * Is the remote pod off limits to this device? See `remoteBlocked`.
 *
 * Two reasons, one latch: the bytes could not be READ (a payload failure), or
 * they must not be MERGED (a lineage mismatch). Both want the same three
 * behaviours — refuse saves, stop the poll, report once — so they share the
 * mechanism rather than each having their own.
 */
export function isRemoteBlocked(): RemoteBlocker | null {
  return remoteBlocked;
}

export function noteRemoteUnreadable(err: PayloadLoadError): void {
  // ⚠️ `keyMayBeWrong` must NOT latch. At the decrypt step a wrong key and a
  // damaged ciphertext are indistinguishable (both are an AES-GCM tag
  // rejection), and the wrong-key half is RECOVERABLE — a peer rotating the
  // family key is routine. Latching it would refuse every save for the session,
  // stop polling, and page Slack, while the re-prompt path that fixes it sits
  // unreachable behind the latch.
  if (err.keyMayBeWrong) {
    // NOT a bare return. This class includes genuine corruption at the decrypt
    // step (a wrong key and damaged bytes are the same observation), so going
    // silent makes "the pod would not decrypt" unmeasurable fleet-wide — a real
    // corruption incident becomes indistinguishable from a key-rotation wave.
    // Only `critical` pages; `warning` still reaches CloudWatch, which is what
    // the goal actually required.
    reportError({
      surface: 'pod-load-failure',
      message: `Remote pod would not decrypt: Automerge ${err.step}`,
      error: err,
      severity: 'warning',
      context: { action: 'remote-decrypt-failed', error_code: err.step },
    });
    return;
  }
  // Reported ONCE PER CLASS, not once per latch. `setLocalChangeHandler` wires a
  // debounced save to every keystroke-level mutation, so a per-attempt critical
  // (which forces an immediate flush) paged roughly once a minute. But keying it
  // on "was the latch empty" let a too-large failure — which deliberately does
  // not report, `docClient` owns that class — consume the flag and silence the
  // corrupt report for the whole session, which is the one that matters.
  const throttleKey = `${err.name}:${err.step}`;
  const alreadyReported = reportedBlockClasses.has(throttleKey);
  remoteBlocked = err;
  if (!alreadyReported && !err.deviceCannotOpen) {
    reportedBlockClasses.add(throttleKey);
    reportError({
      surface: 'pod-load-failure',
      message: `Remote pod unreadable: Automerge ${err.step}`,
      error: err,
      severity: 'critical',
      context: {
        action: 'remote-unreadable',
        error_code: err.step,
        perf_doc_bytes: err.payloadBytes ?? undefined,
      },
    });
  }
}

/**
 * The marker `load()` stamped provisionally, kept so it can be rolled back.
 *
 * `load()` samples the remote's revision BEFORE the download (deliberately —
 * C13), but the merge happens in the CALLER. Until the caller says it merged,
 * this baseline is a promise the document has not kept.
 */
let pendingMarker: RemoteMarker | null = null;

/** The caller merged the text `load()` returned. The baseline is now earned. */
export function confirmRemoteMerged(): void {
  pendingMarker = null;
  clearRemoteUnreadable();
}

/**
 * The caller could NOT merge what `load()` returned. Drop the baseline so the
 * next change check reads again instead of skipping — the safe direction, and
 * the one thing standing between an unreadable remote and a save that
 * overwrites it.
 */
export function rollbackRemoteMarker(): void {
  if (pendingMarker === null) return;
  pendingMarker = null;
  remoteBaseline = null;
}

/** Which (class, step) pairs have already been reported for the current latch. */
const reportedBlockClasses = new Set<string>();

/**
 * A USER asked again — clear the breaker so one attempt can run.
 *
 * Without this the latch is write-only: both automatic clear sites now sit
 * BEHIND the head guards that consult it, so a `PayloadTooLargeError` — the
 * class most likely to be transient, a WASM allocation that failed because
 * another tab spiked memory and would succeed a minute later — permanently
 * disabled reads, saves and polling for the session, with no exit but sign-out.
 *
 * Deliberately only reachable from an explicit user action (manual Refresh,
 * Grant permission, a login retry, a file rebind), never from a timer: one
 * attempt per tap is the half-open state a circuit breaker needs, and an
 * automatic re-arm is the download storm the latch exists to stop.
 */
export function retryAfterRemoteBlock(): void {
  clearRemoteUnreadable();
}

/**
 * A LINEAGE mismatch latches the same breaker, for the same three reasons: the
 * remote must not be merged, retrying cannot change that, and the user needs to
 * be told once rather than every ten seconds.
 *
 * Reported at `warning`, not `critical`, for every verdict except `conflict`:
 * an `adopt-remote` block is the expected, recoverable outcome of a compaction
 * reaching a device with unsaved work, and paging a human for it would train
 * the alert to be ignored. A `conflict` genuinely needs someone to look.
 */
export function noteLineageBlocked(err: PodLineageError): void {
  const throttleKey = `PodLineageError:${err.verdict}`;
  const alreadyReported = reportedBlockClasses.has(throttleKey);
  remoteBlocked = err;
  if (alreadyReported) return;
  reportedBlockClasses.add(throttleKey);
  reportError({
    surface: 'pod-lineage',
    message: `Pod lineage blocked: ${err.verdict}`,
    error: err,
    severity: err.verdict === 'conflict' ? 'critical' : 'warning',
    context: { action: 'blocked', error_code: err.verdict },
  });
}

/**
 * A MERGE refusal latches the same breaker: the remote was read but could not
 * be combined, retrying will not change that, and the save path must refuse.
 *
 * Pages only for an actor collision (`duplicate seq`), which is an invariant
 * violation in the actor plumbing and needs a human; any other refusal is
 * reported at `error` so its RATE is measurable without training the alert to
 * be ignored by a wedged worker on a low-memory tablet.
 */
export function noteMergeFailed(err: RemoteMergeError): void {
  const throttleKey = `RemoteMergeError:${err.isActorCollision ? 'actor' : 'other'}`;
  const alreadyReported = reportedBlockClasses.has(throttleKey);
  remoteBlocked = err;
  if (alreadyReported) return;
  reportedBlockClasses.add(throttleKey);
  reportError({
    surface: 'pod-merge',
    message: err.isActorCollision
      ? 'Remote pod merge refused: two realms share one actor'
      : 'Remote pod merge refused',
    error: err.cause instanceof Error ? err.cause : err,
    severity: err.isActorCollision ? 'critical' : 'error',
    context: { action: 'blocked', error_code: err.blockCode },
  });
}

/**
 * Arm the breaker for ANY blocker, dispatching to the class that owns the
 * policy (only `noteRemoteUnreadable` knows `keyMayBeWrong` must not latch;
 * only `noteMergeFailed` knows an actor collision pages).
 *
 * ONE dispatcher, because the three-way `instanceof` chain was already written
 * twice and a fourth blocker would have to find both copies.
 */
export function noteRemoteBlocked(err: RemoteBlocker): void {
  if (err instanceof PodLineageError) noteLineageBlocked(err);
  else if (err instanceof RemoteMergeError) noteMergeFailed(err);
  else if (err instanceof PayloadLoadError) noteRemoteUnreadable(err);
}

function clearRemoteUnreadable(): void {
  remoteBlocked = null;
  reportedBlockClasses.clear();
}

let currentProvider: StorageProvider | null = null;
let currentProviderFamilyId: string | null = null;

// Family key + envelope — set by syncStore after unlock
let currentFamilyKey: CryptoKey | null = null;
let currentEnvelope: BeanpodFileV4 | null = null;
let noKeyWarnedOnce = false;

// Open-guard baseline (#61): the in-memory marker for the current file. Collapses
// the old `lastKnownFileTimestamp` into ONE object (C9): `revision` (namespaced,
// the authoritative change basis), `modifiedTime` (the fallback basis for
// providers with no revision), and `checkedAt` (the trust clock — seeded from the
// persisted row on open, so the 1-hour bound survives a reload). `reset()` nulls
// it. Only `revision` + `checkedAt` are ever persisted (via the worker).
let remoteBaseline: RemoteBaseline | null = null;

// Change-probe degradation tracking (see `remoteChanged`). The 10s poll
// (`syncStore.FILE_POLL_INTERVAL`) re-probes 6x/min, so a token that dies while
// a tab sits open would otherwise emit one identical warn PER TICK — hundreds a
// day for a single family, and past the 50/surface/min client rate limit, which
// silently truncates them and makes the true failure count unknowable. We log
// the TRANSITION instead, and carry the attempt count on recovery.
//
// This is the SOLE firehose trace of a poll that cannot authorize Drive: the
// read-freshness work that also logged it from `reloadIfFileChanged`
// (`sync-read-freshness` / `poll-auth-stale`) was rolled back on 2026-08-24, and
// that path now returns silently on any non-'changed' result. Do not thin this
// pair further without replacing the coverage somewhere.
let probeFailureReason: string | null = null;
let probeFailureCount = 0;
// UTF-8 byte length of the last .beanpod string we persisted or loaded. Used as
// a coarse (KB-rounded, client-side) usage signal in the family registry. Not
// content — the string is an encrypted envelope. Populated by recordPersistedBytes().
let lastPersistedBytes: number | null = null;

// Change-log chunk transport (ADR-032 Plan B) was RETIRED 2026-07-15 — the
// compacted base is authoritative on every save (see the compaction-primary pivot,
// docs/plans/2026-07-15-compaction-primary-retire-change-chunks.md). Residue of old
// `changes/` chunk files is cleaned up best-effort once per session (see doPull).
// `residueCleanedFamilies` gates that to one attempt per family per session.
// NOTE: never cleared on family-switch/sign-out — "once per session" must survive a
// family switch, or every switch re-triggers a Drive-list storm.
const residueCleanedFamilies = new Set<string>();

/**
 * Best-effort one-time cleanup of retired change-log chunk residue
 * (`changes/*.beanchanges`) from a family's Drive folder. Fired detached from the
 * first read of a session, once per family, UNGATED by the docWorker flag (residue
 * exists regardless of the kill-switch). Never blocks or fails a save/load — a Drive
 * error is swallowed + logged. TEMPORARY: remove with `chunkNames.ts` once the
 * `chunk-residue-cleanup` `deleted` breadcrumb has drained fleet-wide.
 */
async function cleanupChunkResidueOnce(): Promise<void> {
  const familyId = getActiveFamilyId();
  const provider = currentProvider;
  if (!familyId || !provider) return;
  if (residueCleanedFamilies.has(familyId)) return;
  residueCleanedFamilies.add(familyId); // claim the slot SYNCHRONOUSLY (pre-await)
  const aux = getAuxStore(provider); // capture the handle SYNCHRONOUSLY (pre-await)
  if (!aux) return;
  try {
    const chunks = (await aux.list()).filter(isChunkName);
    if (chunks.length === 0) {
      logEvent({
        level: 'info',
        surface: 'chunk-residue-cleanup',
        message: 'no chunk residue to clean',
        context: { action: 'skipped' },
      });
      return;
    }
    for (const name of chunks) await aux.delete(name);
    logEvent({
      level: 'info',
      surface: 'chunk-residue-cleanup',
      message: `deleted ${chunks.length} retired chunk file(s)`,
      context: { action: 'deleted' },
    });
  } catch (e) {
    // Non-fatal: the base is authoritative; residue is inert and retried next session.
    console.warn(
      '[syncService] chunk-residue cleanup failed (non-fatal; base is authoritative; residue retried next session):',
      e
    );
    logEvent({
      level: 'info',
      surface: 'chunk-residue-cleanup',
      message: 'chunk residue cleanup failed',
      context: { action: 'failed', error_code: e instanceof Error ? e.name : 'unknown' },
    });
  }
}

// Poll-while-visible watcher for providers that opt in via
// supportsLocalPolling(). Lifecycle is tied to the active provider — started
// when a polling-capable provider becomes active, stopped when it's swapped
// out or cleared. Implementation lives in `startPollingIfApplicable` /
// `stopPolling` below; the effectScope is detached because syncService is
// a plain module, not a Vue component.
let pollScope: ReturnType<typeof effectScope> | null = null;
let pollHandle: PollWhileVisibleHandle | null = null;
const LOCAL_FILE_POLL_MS = 15_000;

function stopPolling(): void {
  if (pollHandle) {
    pollHandle.stop();
    pollHandle = null;
  }
  if (pollScope) {
    pollScope.stop();
    pollScope = null;
  }
}

/**
 * If the just-set provider opts into polling (via supportsLocalPolling()),
 * spin up a `usePollWhileVisible` watcher tied to it. Each tick calls
 * `fetchAndMergeRemote()`, which is a no-op when nothing has changed —
 * the per-tick cost is one OS-metadata read (FSA `getLastModified`).
 *
 * Re-entrant safe: stops any existing watcher first, so callers don't
 * have to coordinate.
 */
function startPollingIfApplicable(provider: StorageProvider | null): void {
  stopPolling();
  if (!provider?.supportsLocalPolling?.()) return;
  // One-time: if the file the user just opened looks like a cloud-storage
  // conflict copy (Dropbox / OneDrive / Drive desktop / iCloud), surface it
  // as a toast so they understand why merging behaviour might be unusual.
  // Wrapped in try/catch — the poll watcher's lifecycle takes priority over
  // a cosmetic notification.
  try {
    notifyIfConflictFile(provider);
  } catch (e) {
    console.warn('[syncService] conflict-filename notify threw', e);
  }
  pollScope = effectScope(true);
  pollScope.run(() => {
    pollHandle = usePollWhileVisible(
      async () => {
        // A remote this device cannot read will not become readable on the next
        // tick, and each attempt re-reads the whole multi-megabyte file to fail
        // identically. This is the LOCAL-FILE cohort's door into that loop —
        // `syncStore`'s latch cannot see it, because this layer owns the
        // download and the store never runs.
        if (remoteBlocked) return;
        try {
          await fetchAndMergeRemote();
        } catch (e) {
          // fetchAndMergeRemote can throw on decrypt failures, parse errors,
          // permission revoked mid-poll, etc. The poll loop must keep running
          // (transient errors recover on the next tick) but the failure must
          // not be silent.
          console.warn('[syncService] poll-tick fetchAndMergeRemote threw', e);
          // A payload failure is already latched + reported once by
          // `noteRemoteUnreadable`; a second `warning` here would file it as a
          // poll hiccup on a surface no pod-load filter reads.
          // Already latched + reported once by the note* functions; a second
          // `warning` here files it as a poll hiccup on a surface no pod-load
          // filter reads. `isRemoteBlocker`, not `instanceof PayloadLoadError`:
          // a lineage or merge block is just as much "already handled".
          if (isRemoteBlocker(e)) return;
          reportError({
            surface: 'local-file-polling',
            message: 'poll-tick merge threw',
            error: e,
            severity: 'warning',
            context: { action: 'poll' },
          });
        }
      },
      LOCAL_FILE_POLL_MS,
      { fireImmediatelyOnVisible: true, surface: 'local-file-polling' }
    );
  });
}

function notifyIfConflictFile(provider: StorageProvider): void {
  const verdict = isConflictFilename(provider.getDisplayName());
  if (!verdict.isConflict) return;
  const tStore = useTranslationStore();
  showToast('warning', tStore.t('storage.localFileConflictDetected'), provider.getDisplayName(), {
    surface: 'local-file-conflict-detected',
  });
}

// When true, mergeDoc → schedulePersist → triggerDebouncedSave is suppressed
// (we're already inside doSave, so scheduling another save would be redundant)
const suppressAutoSave = false;

// Callbacks for state changes
type StateCallback = (state: SyncServiceState) => void;
const stateCallbacks: StateCallback[] = [];

// Callbacks for save completion (timestamp updates)
type SaveCompleteCallback = (timestamp: string) => void;
const saveCompleteCallbacks: SaveCompleteCallback[] = [];

// --- Save failure tracking ---
export type SaveFailureLevel = 'none' | 'warning' | 'critical';
type SaveFailureCallback = (level: SaveFailureLevel, error: string | null) => void;
const saveFailureCallbacks: SaveFailureCallback[] = [];

// Per-attempt save notification (drives the sidebar SaveStatusIndicator).
// Fires on EVERY save outcome carrying the fresh `consecutiveFailures` count.
// Deliberately SEPARATE from `onStateChange`: doSave() calls
// updateState({ isSyncing: false }) — which fires onStateChange — BEFORE
// recordSaveSuccess/recordSaveFailure mutate the count, so an onStateChange
// subscriber would read the *previous* count. This channel fires from inside
// recordSaveSuccess/recordSaveFailure with the updated value. Do NOT consolidate
// it into onStateChange or the count goes stale (off-by-one).
type SaveAttemptCallback = (consecutiveFailures: number) => void;
const saveAttemptCallbacks: SaveAttemptCallback[] = [];

let consecutiveFailures = 0;
let lastSaveError: string | null = null;
let saveFailureLevel: SaveFailureLevel = 'none';

function updateSaveFailureLevel(): void {
  const prev = saveFailureLevel;
  if (consecutiveFailures === 0) {
    saveFailureLevel = 'none';
  } else if (consecutiveFailures < 3) {
    saveFailureLevel = 'warning';
  } else {
    saveFailureLevel = 'critical';
  }
  if (saveFailureLevel !== prev) {
    saveFailureCallbacks.forEach((cb) => cb(saveFailureLevel, lastSaveError));
  }
}

/**
 * Notify per-attempt subscribers of the current consecutive-failure count.
 * Each subscriber is dispatched inside try/catch so a throwing consumer can
 * never break the save path (unlike the older `saveFailureCallbacks.forEach`).
 */
function notifySaveAttempt(): void {
  saveAttemptCallbacks.forEach((cb) => {
    try {
      cb(consecutiveFailures);
    } catch (err) {
      console.error('[syncService] save-attempt subscriber threw', err);
    }
  });
}

function recordSaveSuccess(): void {
  consecutiveFailures = 0;
  lastSaveError = null;
  updateSaveFailureLevel();
  notifySaveAttempt();
}

function recordSaveFailure(error: string): void {
  consecutiveFailures++;
  lastSaveError = error;
  updateSaveFailureLevel();
  notifySaveAttempt();
}

/** Get the current save failure level. */
export function getSaveFailureLevel(): SaveFailureLevel {
  return saveFailureLevel;
}

/** Get the last save error message. */
export function getLastSaveError(): string | null {
  return lastSaveError;
}

/** Reset save failure state (call after successful reconnect). */
export function resetSaveFailures(): void {
  consecutiveFailures = 0;
  lastSaveError = null;
  updateSaveFailureLevel();
  notifySaveAttempt();
}

/** Current consecutive save-failure count (0 = last attempt succeeded). */
export function getConsecutiveSaveFailures(): number {
  return consecutiveFailures;
}

/**
 * Subscribe to per-save-attempt outcomes. The callback receives the fresh
 * consecutive-failure count on every success/failure. Returns an unsubscribe fn.
 */
export function onSaveAttempt(callback: SaveAttemptCallback): () => void {
  saveAttemptCallbacks.push(callback);
  return () => {
    const index = saveAttemptCallbacks.indexOf(callback);
    if (index > -1) saveAttemptCallbacks.splice(index, 1);
  };
}

/** Subscribe to save failure level changes. Returns unsubscribe function. */
export function onSaveFailureChange(callback: SaveFailureCallback): () => void {
  saveFailureCallbacks.push(callback);
  return () => {
    const index = saveFailureCallbacks.indexOf(callback);
    if (index > -1) saveFailureCallbacks.splice(index, 1);
  };
}

// --- Cache persistence failure tracking ---
let cachePersistFailed = false;
type CacheFailureCallback = (failed: boolean) => void;
const cacheFailureCallbacks: CacheFailureCallback[] = [];

function setCachePersistFailed(
  failed: boolean,
  detail?: CachePersistFailureDetail,
  opts?: { silent?: boolean }
): void {
  if (cachePersistFailed !== failed) {
    cachePersistFailed = failed;
    cacheFailureCallbacks.forEach((cb) => cb(failed)); // subscribers see the boolean only
    // Telemetry is edge-triggered (once per episode/recovery) and covers both the
    // worker + inline paths at this one site. `silent` lets a lifecycle reset() clear
    // the banner WITHOUT firehosing a false "recovered" event for an abandoned episode.
    if (!opts?.silent) emitCachePersistTelemetry(failed, detail);
  }
}

/** Single home for the cache-persist telemetry policy. Reached only on an edge
 * transition (see the `!==` guard above), so it fires once per real episode/recovery.
 * `reportError({severity:'warning'})` mirrors into the CloudWatch firehose at `warn`
 * with NO Slack page (errorReporter.ts) — that IS the failure event, so we do NOT add
 * a second logEvent for it. The recovery is an `info` event, so it uses logEvent.
 * family_id / web_storage / provider_type / browser ride along automatically via
 * enrichAndRedact. See docs/plans/2026-07-13-cache-persist-durability-signal.md. */
function emitCachePersistTelemetry(failed: boolean, detail?: CachePersistFailureDetail): void {
  if (failed) {
    reportError({
      surface: 'cache-persist',
      message: 'Local durability cache write failed (persistent)',
      severity: 'warning',
      context: { cache_persist_kind: detail?.kind, cache_persist_error: detail?.errorName },
    });
  } else {
    logEvent({ level: 'info', surface: 'cache-persist', message: 'cache-persist recovered' });
  }
}

export function isCachePersistFailed(): boolean {
  return cachePersistFailed;
}

export function onCacheFailureChange(callback: CacheFailureCallback): () => void {
  cacheFailureCallbacks.push(callback);
  return () => {
    const idx = cacheFailureCallbacks.indexOf(callback);
    if (idx > -1) cacheFailureCallbacks.splice(idx, 1);
  };
}

// Current state
let state: SyncServiceState = {
  isInitialized: false,
  isConfigured: false,
  fileName: null,
  isSyncing: false,
  lastError: null,
};

function updateState(updates: Partial<SyncServiceState>): void {
  state = { ...state, ...updates };
  stateCallbacks.forEach((cb) => cb(state));
}

/**
 * Subscribe to state changes
 */
export function onStateChange(callback: StateCallback): () => void {
  stateCallbacks.push(callback);
  return () => {
    const index = stateCallbacks.indexOf(callback);
    if (index > -1) {
      stateCallbacks.splice(index, 1);
    }
  };
}

/**
 * Get current sync service state
 */
export function getState(): SyncServiceState {
  return { ...state };
}

/**
 * Record the byte size of a .beanpod envelope string we just persisted or
 * loaded. Single write path for `lastPersistedBytes` — the UTF-8 encode lives
 * here only, so every caller records the same (true on-disk) unit. `encode`
 * cannot throw on a string, so no error handling is warranted.
 */
export function recordPersistedBytes(envelope: string): void {
  lastPersistedBytes = new TextEncoder().encode(envelope).byteLength;
}

/**
 * The byte size of the most recently persisted-or-loaded .beanpod, or null if
 * nothing has been persisted/loaded this session. Read-only companion to
 * `recordPersistedBytes` — consumed by the registry write to report an
 * approximate data-volume usage signal.
 */
export function getLastPersistedBytes(): number | null {
  return lastPersistedBytes;
}

/**
 * Register a callback invoked after every successful save with the file's timestamp.
 */
export function onSaveComplete(callback: SaveCompleteCallback): () => void {
  saveCompleteCallbacks.push(callback);
  return () => {
    const index = saveCompleteCallbacks.indexOf(callback);
    if (index > -1) saveCompleteCallbacks.splice(index, 1);
  };
}

/**
 * Get the current storage provider type, or null if none configured
 */
export function getProviderType(): StorageProviderType | null {
  return currentProvider?.type ?? null;
}

/**
 * Get the current storage provider
 */
export function getProvider(): StorageProvider | null {
  return currentProvider;
}

/**
 * The family id the current provider was installed for, or `null` when no
 * provider is set. Lets callers distinguish "a provider is set for THIS family"
 * from "a stale provider from a previously-active family is still around" —
 * used by the syncStore re-home guard (establishDurableHomeAfterLoad) so a
 * just-loaded family is never skipped because of a leftover provider.
 */
export function getProviderFamilyId(): string | null {
  return currentProvider ? currentProviderFamilyId : null;
}

/**
 * Set the storage provider directly (used by Google Drive flow)
 */
export function setProvider(provider: StorageProvider): void {
  // A different (or re-bound) file may well be readable. This is what makes
  // `rebindPodFile` — the supported repair for an unreadable pod — actually
  // repair it, without the store needing a clearing hook of its own.
  clearRemoteUnreadable();
  pendingMarker = null; // see `reset()`
  currentProvider = provider;
  currentProviderFamilyId = getActiveFamilyId();
  // #61: a new provider means a DIFFERENT file (migrate to Drive, rebind pod
  // file, local→Drive) whose `version` sequence is independent of the old one.
  // The in-memory baseline described the OLD file, so it must not survive: a
  // stale/absent baseline against the new file's first-sight revision would
  // classify it 'changed' and (a) false-block `installProvider`'s non-force
  // `syncNow()` with "File has newer data", reliably failing every Drive-targeted
  // migration, and (b) risk a coincidental revision match granting a wrong skip.
  // The durable per-file row is re-established by the next successful load/write
  // terminus; nulling the in-memory basis forces that read.
  remoteBaseline = null;
  // This is the single write-intent install seam, so it OWNS offline-queue
  // flush registration (2026-06-19, finding 11). Provider builds (createNew /
  // fromExisting) no longer self-register, so read-only resume/recovery paths
  // that build a provider WITHOUT calling setProvider never become a flush
  // target and can't write stale queued bytes into a file they only inspected.
  setFlushProvider(provider);
  startPollingIfApplicable(provider);
  updateState({
    isConfigured: true,
    fileName: provider.getDisplayName(),
    lastError: null,
  });
}

/**
 * Seed the worker's envelope cache, quietly. Envelope-cache persistence is a
 * cold-start-unlock convenience, not a critical write — a failure must NOT fire
 * the critical doc-worker toast (so it's `{quiet}`), but it also must NOT vanish
 * silently: a swallowed failure means a later cold start has no cached envelope
 * and can't unlock, with no breadcrumb. Classify + log at warning.
 */
function persistEnvelopeSafely(envelope: BeanpodFileV4): void {
  void docClient.persistEnvelope(envelope, { quiet: true }).catch((e) => {
    reportError({
      surface: 'doc-worker-envelope-cache',
      message:
        'Failed to persist the envelope cache — a cold-start unlock may need the file/password',
      error: e,
      severity: 'warning',
    });
  });
}

/**
 * Set the family key and envelope for the current session.
 * Called by syncStore after successful unlock.
 */
export function setFamilyKey(familyKey: CryptoKey, envelope: BeanpodFileV4): void {
  currentFamilyKey = familyKey;
  noKeyWarnedOnce = false; // Reset so future skips can warn again
  // Post the key + the stable device actor to the worker (once at unlock).
  // The envelope's familyId is the authority here — it is the pod being opened,
  // which is not necessarily the family that was active a moment ago.
  void docClient.setFamilyKey(familyKey, envelope.familyId);
  // Route through `setEnvelope` rather than assigning `currentEnvelope` here:
  // that keeps ONE write path for the in-memory envelope, so the payload strip
  // (and the cache seed) cannot be applied on one path and missed on the other.
  setEnvelope(envelope);
}

/**
 * Get the current family key (if set).
 */
export function getFamilyKey(): CryptoKey | null {
  return currentFamilyKey;
}

/**
 * Check if a family key and envelope are set (ready to save).
 */
export function hasFamilyKey(): boolean {
  return !!currentFamilyKey && !!currentEnvelope;
}

/**
 * Get the current envelope (if set).
 */
export function getEnvelope(): BeanpodFileV4 | null {
  return currentEnvelope;
}

/**
 * Update the current envelope (e.g. after adding a new wrapped key). Accepts
 * null to allow the store's `clearEnvelope` to null us out on sign-out
 * without an `as unknown` cast.
 */
export function setEnvelope(envelope: BeanpodFileV4 | null): void {
  // Long-lived: no payload. See `withoutPayload`. Applied here rather than at
  // the callers because this is the single write path for `currentEnvelope`.
  currentEnvelope = envelope ? withoutPayload(envelope) : null;
  // Keep the worker's envelope cache in sync (every currentEnvelope mutation
  // funnels here) so a cold start unlocks after a peer key-add / rotation.
  if (currentEnvelope) persistEnvelopeSafely(currentEnvelope);
}

/**
 * Get the current session file handle (for reading encrypted blob during passkey registration).
 */
export function getSessionFileHandle(): FileSystemFileHandle | null {
  if (currentProvider instanceof LocalStorageProvider) {
    return currentProvider.getHandle();
  }
  return null;
}

/**
 * Reset the sync service state.
 */
export function reset(): void {
  // A different pod entirely — neither the latch nor an unearned marker may
  // follow. A `pendingMarker` surviving a family switch would let a later
  // rollback null a baseline that was legitimately earned minutes ago, after
  // which every poll, save and open does a full multi-megabyte read forever.
  clearRemoteUnreadable();
  pendingMarker = null;
  cancelPendingSave();
  stopPolling();
  currentProvider = null;
  currentProviderFamilyId = null;
  currentFamilyKey = null;
  currentEnvelope = null;
  noKeyWarnedOnce = false;
  remoteBaseline = null;
  lastPersistedBytes = null;
  probeFailureReason = null;
  probeFailureCount = 0;
  resetSaveFailures();
  // Clear the durability banner on teardown, but SILENTLY — a logout / family-switch
  // is not a recovery; emitting "cache-persist recovered" here would corrupt the metric.
  setCachePersistFailed(false, undefined, { silent: true });
  updateState({
    isInitialized: false,
    isConfigured: false,
    fileName: null,
    isSyncing: false,
    lastError: null,
  });
}

// ─── Open-guard change detection (#61) ───────────────────────────────────────

/**
 * Probe the current provider's marker in ONE round-trip. Uses `getRemoteMarker`
 * when the provider implements it (Drive), else falls back to `getLastModified`
 * in this ONE place. May throw an auth error — `remoteChanged` catches it.
 */
async function probeRemoteMarker(): Promise<RemoteMarker> {
  if (!currentProvider) return { revision: null, modifiedTime: null };
  if (currentProvider.getRemoteMarker) {
    return currentProvider.getRemoteMarker();
  }
  const modifiedTime = await currentProvider.getLastModified();
  return { revision: null, modifiedTime };
}

/**
 * Has the remote file changed relative to our in-memory baseline? The I/O shell
 * over the pure `compareMarkers` (#61 C14). Owns the probe + every failure
 * classification: any throw (auth/transient) degrades to `unknown` and is NEVER
 * rethrown. The caller decides whether unknown means read; a real auth error
 * re-surfaces from the subsequent `provider.read()` into the existing
 * classification, so nothing is swallowed.
 */
export async function remoteChanged(): Promise<ChangeResult> {
  try {
    const probe = await probeRemoteMarker();
    // Recovery is an OUTCOME, and outcomes ship on the success path too (CLAUDE.md
    // observability rule 6) — without this, a degradation has a start and no end,
    // and its rate/duration can never be measured. Duration is the gap between
    // this event and its warn twin; `consecutive_failures` is the exact attempt
    // count, which is why neither needs a new (store-declared) context key.
    if (probeFailureReason !== null) {
      logEvent({
        level: 'info',
        surface: 'sync-change-detect',
        message: 'remote change-probe recovered — change detection restored',
        context: {
          action: 'remote-changed-recovered',
          error_code: probeFailureReason,
          consecutive_failures: probeFailureCount,
        },
      });
      probeFailureReason = null;
      probeFailureCount = 0;
    }
    return compareMarkers(remoteBaseline, probe);
  } catch (e) {
    // Distinguish a MISSING file (404) from an AUTH failure (401 / expired token):
    // the poll path surfaces the former as the "file missing" banner + stops
    // polling, but must NOT do that for a transient auth blip.
    const isNotFound = e instanceof DriveApiError && e.status === 404;
    const isAuth =
      e instanceof TokenExpiredError || (e instanceof DriveApiError && e.status === 401);
    const reason = isNotFound
      ? 'file-not-found'
      : isAuth
        ? 'auth'
        : `provider-error:${e instanceof Error ? e.name : 'unknown'}`;
    console.warn(
      `[syncService.remoteChanged] marker probe failed (${reason}); treating remote as unknown — a reading caller re-raises any real error from provider.read():`,
      e
    );
    // Observability (MANDATORY): the poll callers early-return on 'unknown', so a
    // persistent probe failure would otherwise degrade change detection to unknown
    // with ZERO firehose trace. Emit it so the degradation is triageable + alertable.
    //
    // Logged ONCE per degradation, not once per 10s tick: a repeated identical warn
    // is not extra information, and at 6/min it both costs real CloudWatch spend per
    // active family and trips the 50/surface/min rate limit, which drops events
    // without telling you. A CHANGE of reason (auth -> provider-error) is a genuinely
    // different failure and re-arms, so a reclassification is never hidden. The
    // recovery event above closes every warn emitted here.
    const isNewDegradation = probeFailureReason !== reason;
    probeFailureReason = reason;
    probeFailureCount = isNewDegradation ? 1 : probeFailureCount + 1;
    if (isNewDegradation) {
      logEvent({
        level: 'warn',
        surface: 'sync-change-detect',
        message: `remote change-probe failed — change detection degraded to unknown (${reason})`,
        error: e instanceof Error ? e : undefined,
        context: { action: 'remote-changed-unknown', error_code: reason },
      });
    }
    return { status: 'unknown', basis: 'none', revision: null, modifiedTime: null, reason };
  }
}

/**
 * The ONLY place that decides an open-path Drive read may be SKIPPED (#61 C14).
 * Composes `remoteChanged()` with the trust window. `unknown` READS here (a
 * one-shot per open; a spurious read costs one download) — unlike the polls,
 * which never read on unknown. Returns a classified reason on every non-skip so
 * the guard can emit it as `open-fail-open` telemetry.
 */
/**
 * Does our doc hold changes Drive has never received (#65)? Returns the
 * classified decline, or `null` when nothing blocks a skip.
 *
 * Extracted so `shouldSkipOpenRead` stays a flat ladder of guard clauses rather
 * than growing a try-block in its middle: this owns the one piece of I/O in the
 * local-check phase and its failure classification, the ladder owns the decision.
 *
 * WHY PROBE HERE, and not reuse heads read earlier in the open: the obvious
 * optimization is to have `initAndLoadCache` return the loaded doc's heads
 * alongside the baseline row, saving this round-trip. It is UNSAFE. Those heads
 * are captured at cache-load time, and `reloadAllStores()` calls
 * `cancelPendingSave()` between then and here — a documented state in which a
 * local mutation exists with no armed save. A stale value in that window
 * compares EQUAL to the baseline and yields a false skip: the unsafe direction,
 * and the exact bug class #65 exists to close. Ask at the moment the answer is
 * used.
 */
/**
 * Can this device PROVE its document holds nothing the remote has not seen?
 *
 * The context the lineage guard needs, answered by the #65 comparison that
 * already exists rather than a second heads probe. Unknown counts as `dirty` —
 * a null baseline, or a failed probe — which is the same fail-safe direction
 * `unpushedLocalChangesCheck` already documents: the cost of a wrong `dirty` is
 * a refusal the user can clear; the cost of a wrong `clean` is a peer's work.
 */
/**
 * Is this device provably current AND clean against the remote?
 *
 * The precondition a compaction needs: it publishes a document no peer can
 * merge with, so publishing one that is missing a peer's edits would strand
 * them permanently. Both halves are checks that already exist — the #61 change
 * probe and the #65 unpushed-changes comparison — so there is no third notion
 * of "in sync" to keep in step.
 */
export async function isFullySynced(): Promise<boolean> {
  const change = await remoteChanged();
  if (change.status !== 'unchanged') return false; // moved, or we cannot tell
  return (await docPushedAgainst(remoteBaseline?.headsFp ?? null)) === 'clean';
}

/**
 * The Drive-baseline fingerprint this module holds, for a caller that needs the
 * lineage CONTEXT but does not own the baseline (terminus 4 in `syncStore`).
 * Exposed rather than duplicated: the baseline is module state here and a
 * second copy in the store would drift the first time either side changed.
 */
export function getRemoteBaselineHeadsFp(): string | null {
  return remoteBaseline?.headsFp ?? null;
}

export async function docPushedAgainst(baselineFp: string | null): Promise<'clean' | 'dirty'> {
  return (await unpushedLocalChangesCheck(baselineFp)) === null ? 'clean' : 'dirty';
}

async function unpushedLocalChangesCheck(
  baselineFp: string | null
): Promise<{ skip: false; reason: string } | null> {
  // Cheapest first, same discipline as the ladder that calls this: with no recorded
  // fingerprint the answer is already decided (we cannot prove the doc is on Drive),
  // so the worker round-trip would be computed and thrown away. This is the common
  // path on every device's first open after the #65 upgrade.
  if (baselineFp === null) return { skip: false, reason: 'baseline-heads-unknown' };
  let currentFp: string;
  try {
    // `quiet` — this function classifies the failure itself; without it
    // `docClient.surface()` would ALSO fire a `doc-worker` reportError, giving
    // two events for one benign degradation.
    //
    // `probe` — and this is the load-bearing one. Without it the call inherits the
    // 45s default budget AND the full recovery path: on a wedged-but-live worker it
    // would tear the worker down, drain every sibling RPC (including a user `mutate`),
    // fire a `doc-worker-recovery` report that `quiet` does NOT suppress, and retry
    // itself. All to answer a question whose worst honest answer is "read anyway".
    // `probe` makes it throw and get out of the way; whatever op reads next owns the
    // real recovery, with its own method name on the report.
    const { heads } = await docClient.getHeads({ quiet: true, probe: true });
    currentFp = headsFingerprint(heads);
  } catch (e) {
    console.warn(
      '[syncService.shouldSkipOpenRead] doc-heads probe failed — open-guard fell back to a full read; ' +
        'check the worker RPC log. No data at risk (an extra download, not a lost edit):',
      e
    );
    // Observability (MANDATORY): `quiet`+`probe` deliberately suppress docClient's
    // own report, so without this the error's name/message/stack never leave the
    // device. The endOpen reason alone is not coverage — it is a bare string, and
    // it is dropped entirely on the tokenless re-entries (header Refresh, deferred
    // config-heal). Same shape as `remoteChanged`'s degradation event below.
    logEvent({
      level: 'warn',
      surface: 'sync-change-detect',
      message: 'doc-heads probe failed — open-guard fell back to a full read',
      error: e instanceof Error ? e : undefined,
      context: { action: 'heads-probe-failed', error_code: 'heads-probe-failed' },
    });
    return { skip: false, reason: 'heads-probe-failed' };
  }
  if (!hasUnpushedChanges(baselineFp, currentFp)) return null;
  return { skip: false, reason: 'unpushed-local-changes' };
}

export async function shouldSkipOpenRead(): Promise<{ skip: boolean; reason: string }> {
  // Cheap LOCAL checks FIRST — never spend a metadata probe on an open we already
  // know will read. This is the common daily-user case: the 1h trust window is
  // always expired between once-a-day opens, so probing here and then re-probing
  // in load() would be a pure +1 round-trip for zero skip benefit.
  if (!remoteBaseline || remoteBaseline.revision === null) {
    return { skip: false, reason: 'no-baseline' };
  }
  if (!withinTrustWindow(remoteBaseline.checkedAt, Date.now())) {
    return { skip: false, reason: 'trust-expired' };
  }
  // #65: one cheap worker round-trip, still BEFORE the network probe — an open
  // carrying unsynced local changes must read+merge+re-push, so paying a metadata
  // probe first would be pure waste.
  const blocked = await unpushedLocalChangesCheck(remoteBaseline.headsFp);
  if (blocked) return blocked;
  // In-window with a revision baseline — now the probe can actually save a read.
  const result = await remoteChanged();
  if (result.status === 'unknown') return { skip: false, reason: result.reason ?? 'unknown' };
  if (result.basis !== 'revision') return { skip: false, reason: 'no-revision' };
  if (result.status !== 'unchanged') return { skip: false, reason: result.reason ?? 'changed' };
  return { skip: true, reason: 'unchanged-revision-in-window' };
}

/**
 * Learn a marker in memory (#61 C10) — a READ-TIME fact: the probe sampled
 * strictly before a download, or our own write's ack. Does NOT persist;
 * committing to the durable baseline happens at the three termini via
 * `commitRemoteBaseline`, where the worker's doc provably contains that state.
 */
function learnRemoteMarker(marker: RemoteMarker): void {
  remoteBaseline = {
    revision: marker.revision,
    modifiedTime: marker.modifiedTime,
    checkedAt: new Date().toISOString(),
    // #65: a marker probe knows the REVISION, never the heads behind it. Null is
    // the safe direction — unknown => never skip. A terminus that follows fills it
    // in, but NOT every caller is a terminus: `load()`'s pre-read probe opens a
    // fresh trust window here, and `loadFromFile` can then exit without any commit
    // (unsupported version, needsPassword, decrypt failure). Those opens correctly
    // decline for the rest of the window rather than skipping on an unknown.
    headsFp: null,
  };
}

/**
 * Seed the in-memory baseline from the persisted row on open (#61 C-5), WITHOUT
 * re-committing it — routing this through `commitRemoteBaseline` would re-write
 * the row and refresh `checkedAt`, silently defeating the 1-hour trust bound.
 * This is the easiest mistake to make in the design; keep it a plain setter.
 */
export function seedRemoteBaseline(row: { payload: string; checkedAt: string } | null): void {
  if (!row) {
    remoteBaseline = null;
    return;
  }
  // #65: the row's payload is opaque to the worker; this module owns the format.
  // An undecodable payload degrades to "no baseline" => the guard reads.
  const decoded = decodeBaselinePayload(row.payload);
  remoteBaseline = decoded
    ? {
        revision: decoded.revision,
        modifiedTime: null,
        checkedAt: row.checkedAt,
        headsFp: decoded.headsFp,
      }
    : null;
}

/**
 * Commit the current in-memory baseline durably (#61 C10). Called from EXACTLY
 * three termini where the worker's `currentDoc` provably contains the remote
 * state: after `loadFromFile`'s merge succeeds (via syncStore), after
 * `fetchAndMergeRemote`'s merge resolves, and after `doSave`'s write resolves. A
 * no-op when there is no revision (never persist an mtime). Fire-and-forget
 * through the worker; the FIFO orders it after the already-resolved merge. It is
 * an unconditional last-write-wins set (C10b) — correctness is from WHERE it is
 * called, never from comparing revisions.
 */
export function commitRemoteBaseline(driveHeads: readonly string[] | null): void {
  const revision = remoteBaseline?.revision ?? null;
  if (revision === null) {
    // ⚠️ NO REVISION IS NOT NO BASELINE. Only `GoogleDriveProvider` implements
    // `getRemoteMarker`, so every local-file family reached this early return
    // and never recorded a heads fingerprint. `docPushedAgainst(null)` then
    // answered `dirty` forever, which meant `isFullySynced()` could never be
    // true — compaction refused with "not synced" on a pod that was perfectly
    // synced — and the lineage context was permanently `dirty`, so those
    // families would BLOCK where they should adopt.
    //
    // The revision is only needed for the change PROBE (and for the encoded
    // payload the worker persists). The fingerprint is provable without it, and
    // it is the half these two callers actually read.
    const fpOnly = driveHeads === null ? null : headsFingerprint(driveHeads);
    if (fpOnly !== null) {
      remoteBaseline = remoteBaseline
        ? { ...remoteBaseline, headsFp: fpOnly }
        : {
            revision: null,
            modifiedTime: null,
            checkedAt: new Date().toISOString(),
            headsFp: fpOnly,
          };
    }
    return;
  }
  // #65: `driveHeads` MUST be the heads of the content DRIVE HOLDS at `revision`
  // — the unmigrated decrypted remote doc at a merge terminus, or the serialized
  // bytes at the write terminus. NEVER `currentDoc`'s heads, which can be ahead
  // of Drive and would produce a false skip. It is a REQUIRED parameter so that
  // any future terminus is forced by the compiler to answer the question rather
  // than over-claiming by omission; `null` means "cannot prove" => never skip.
  const headsFp = driveHeads === null ? null : headsFingerprint(driveHeads);
  // Keep the in-memory baseline in step with the durable row. `backgroundSyncFromFile`
  // (and so the guard) runs MORE THAN ONCE per process — header Refresh and the
  // deferred config-heal both re-enter it — so without this write-back every
  // post-save open would see `headsFp === null` and report `baseline-heads-unknown`
  // forever, polluting the metric. Only `headsFp` is touched: refreshing `checkedAt`
  // here would silently extend the trust window, which is the design's easiest
  // mistake (see `seedRemoteBaseline`).
  if (remoteBaseline) remoteBaseline.headsFp = headsFp;
  docClient.noteRemoteBaseline(encodeBaselinePayload(revision, headsFp));
}

/**
 * Initialize the sync service - try to restore file handle from storage.
 */
export async function initialize(): Promise<boolean> {
  // Already initialized with valid session for this family — skip destructive re-init
  const activeFamilyId = getActiveFamilyId();
  if (
    currentFamilyKey &&
    currentEnvelope &&
    currentProvider &&
    currentProviderFamilyId === activeFamilyId
  ) {
    return state.isConfigured;
  }

  reset();

  if (!getActiveFamilyId()) {
    console.warn('[syncService] No active family — skipping sync initialization');
    logEvent({
      level: 'warn',
      surface: 'sync-init-no-family',
      message: 'No active family at sync init — provider restore skipped',
    });
    updateState({
      isInitialized: true,
      isConfigured: false,
      lastError: null,
    });
    return false;
  }

  // Check for persisted provider config (Google Drive or local)
  const familyId = getActiveFamilyId();
  if (familyId) {
    try {
      const config = await getProviderConfig(familyId);
      console.warn('[syncService] Provider config for', familyId, ':', config?.type ?? 'none');
      logEvent({
        level: 'info',
        surface: 'sync-init-restore',
        message: 'Provider-config restore at sync init',
        context: { provider_type: config?.type ?? null, had_config: !!config },
      });
      if (config?.type === 'google_drive' && config.driveFileId && config.driveFileName) {
        currentProvider = GoogleDriveProvider.fromExisting(
          config.driveFileId,
          config.driveFileName,
          config.driveAccountEmail
        );
        currentProviderFamilyId = familyId;
        // Cold-boot restore of the configured Drive provider is write-intent
        // (the app saves to it), so register it as the offline-queue flush
        // target. `fromExisting` no longer self-registers (finding 11); this
        // init path sets currentProvider directly instead of via setProvider,
        // so it must register explicitly.
        setFlushProvider(currentProvider);
        startPollingIfApplicable(currentProvider);
        updateState({
          isInitialized: true,
          isConfigured: true,
          fileName: config.driveFileName,
          lastError: null,
        });
        return true;
      }
      // Native (Capacitor) local file restores from the persisted path (no
      // FileSystemFileHandle on native — that's the web provider's mechanism).
      // See ADR-029.
      if (config?.type === 'local' && config.localPath && isNative()) {
        currentProvider = CapacitorFileProvider.fromPath(config.localPath);
        currentProviderFamilyId = familyId;
        startPollingIfApplicable(currentProvider);
        updateState({
          isInitialized: true,
          isConfigured: true,
          fileName: currentProvider.getDisplayName(),
          lastError: null,
        });
        return true;
      }
    } catch (e) {
      console.warn('Failed to restore provider config:', e);
    }
  }

  // Try to restore a local file handle (File System Access API)
  if (supportsFileSystemAccess()) {
    try {
      const handle = await getFileHandle();
      console.warn(
        '[syncService] Local file handle for',
        familyId,
        ':',
        handle ? handle.name : 'none'
      );
      if (handle) {
        currentProvider = LocalStorageProvider.fromHandle(handle);
        currentProviderFamilyId = getActiveFamilyId();
        startPollingIfApplicable(currentProvider);
        updateState({
          isInitialized: true,
          isConfigured: true,
          fileName: handle.name,
          lastError: null,
        });
        return true;
      }
    } catch (e) {
      console.warn('Failed to restore file handle:', e);
    }
  }

  updateState({
    isInitialized: true,
    isConfigured: false,
    lastError: null,
  });
  return false;
}

/**
 * Request permission to use the stored file handle (user gesture required)
 */
export async function requestPermission(): Promise<boolean> {
  if (!currentProvider) {
    updateState({ lastError: 'No file configured' });
    return false;
  }

  try {
    const granted = await currentProvider.requestAccess();
    if (!granted) {
      updateState({ lastError: 'Permission denied' });
      return false;
    }
    updateState({ lastError: null });
    return true;
  } catch (e) {
    updateState({ lastError: (e as Error).message });
    return false;
  }
}

/**
 * Open file picker to select/create a sync file (user gesture required)
 */
export async function selectSyncFile(): Promise<boolean> {
  if (!supportsFileSystemAccess()) {
    updateState({ lastError: 'File System Access API not supported' });
    return false;
  }

  try {
    const provider = await LocalStorageProvider.fromSavePicker();
    if (!provider) return false;

    const familyId = getActiveFamilyId();
    if (familyId) {
      await provider.persist(familyId);
    }
    // A breaker armed against the PREVIOUS file must not survive a rebind to a
    // different one (`setProvider` clears it for the same reason).
    clearRemoteUnreadable();
    currentProvider = provider;
    currentProviderFamilyId = familyId;
    startPollingIfApplicable(provider);

    updateState({
      isConfigured: true,
      fileName: provider.getDisplayName(),
      lastError: null,
    });

    return true;
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      return false;
    }
    updateState({ lastError: (e as Error).message });
    return false;
  }
}

/**
 * Configure a native (Capacitor) app-private local file as the sync target —
 * the native counterpart to `selectSyncFile`. There's no save picker on native,
 * so the location is app-managed (`Directory.Data`); the file itself is created
 * on the first write (syncStore.createNewFile). Persists the path for cold-boot
 * restore. See ADR-029.
 */
export async function selectNativeLocalFile(baseName = 'my-family'): Promise<boolean> {
  try {
    // B3: namespace the app-managed filename by familyId so a restored backup of
    // family B (named identically to an existing local family A) can NEVER clobber
    // A's local pod. Cold-boot restore is config-based (`initialize` reads the exact
    // persisted `localPath`), so existing pods keep working via their stored config —
    // this only changes the name minted for a NEW file. Fall back to the bare name
    // when familyId is unknown (no regression).
    const familyId = getActiveFamilyId();
    const fileName = familyId ? `${baseName}-${familyId}.beanpod` : `${baseName}.beanpod`;
    const provider = new CapacitorFileProvider(fileName);
    if (familyId) {
      await provider.persist(familyId);
    }
    // A breaker armed against the PREVIOUS file must not survive a rebind to a
    // different one (`setProvider` clears it for the same reason).
    clearRemoteUnreadable();
    currentProvider = provider;
    currentProviderFamilyId = familyId;
    startPollingIfApplicable(provider);
    updateState({
      isConfigured: true,
      fileName: provider.getDisplayName(),
      lastError: null,
    });
    return true;
  } catch (e) {
    updateState({ lastError: (e as Error).message });
    return false;
  }
}

/**
 * Save the current Automerge document to the sync file.
 * Encrypts with the family key and writes the V4 envelope.
 */
export async function save(): Promise<boolean> {
  if (saveInProgress) {
    try {
      await saveInProgress;
    } catch {
      // Previous save failed — proceed with ours
    }
  }

  const promise = doSave();
  saveInProgress = promise;

  try {
    return await promise;
  } finally {
    if (saveInProgress === promise) {
      saveInProgress = null;
    }
  }
}

/**
 * Fetch remote file and merge into local doc if it has changed. Called by
 * doSave() before writing (Drive race protection) AND by the local-file
 * polling watcher (catches edits synced down by another device's cloud-
 * storage client). Provider opts in via `supportsLocalPolling()` returning
 * true; absent or false means "this provider doesn't participate".
 */
async function fetchAndMergeRemote(): Promise<void> {
  // Latched: re-reading cannot help and is expensive. `setLocalChangeHandler`
  // wires a debounced save to every keystroke-level mutation, so without this a
  // typing user on the device this change targets caused a multi-megabyte read
  // + parse + decrypt + failed WASM allocation roughly every two seconds,
  // indefinitely. Throwing (rather than returning) keeps `doSave`'s refusal
  // intact — a silent return would let the save through.
  if (remoteBlocked) throw remoteBlocked;
  if (!currentProvider) return;
  // Drive's save path always calls this (legacy direct call); the polling
  // watcher only activates for providers that opt in. Both paths converge
  // here. The capability check guards against future providers that
  // shouldn't merge (e.g. a one-shot import-only provider).
  const opts = currentProvider.supportsLocalPolling?.();
  const isDrive = currentProvider.type === 'google_drive';
  if (!isDrive && !opts) return;
  if (!currentFamilyKey || !currentEnvelope) return;

  // Change-log chunk transport was RETIRED 2026-07-15 — every save writes the full
  // compacted base, so it already carries every peer's edits; we go straight to the
  // whole-doc fast-path + merge below (no chunk read). Best-effort cleanup of any
  // old `changes/` residue rides this once-per-session first-read seam (detached).
  void cleanupChunkResidueOnce();

  // Fast path: read iff the remote actually changed (revision basis on Drive,
  // mtime fallback elsewhere) — one comparator for the whole app (#61 C14). On a
  // poll/save path `unknown` deliberately does NOT read: a persistent provider
  // error must not turn the 10s poll into a read storm (C14 caller table).
  const change = await remoteChanged();
  if (change.status !== 'changed') return; // unchanged OR unknown → skip the full read

  // C1: capture the provider we read THROUGH, to guard the baseline commit below
  // against a family-switch landing during the multi-second read+merge.
  const providerAtRead = currentProvider;

  // Remote has newer data — fetch, decrypt, and merge. INVARIANT (ADR-032 addendum):
  // the base is the sole source of a peer's edits (change-chunks retired 2026-07-15).
  // This whole-doc read + merge is how every peer's changes reach us — do not gate or
  // skip it on the assumption a delta layer will carry them.
  bumpOpenCycle('driveRead'); // the poll/save-path whole-file read — also counted
  const text = await currentProvider.read();
  if (!text) return;

  // ⚠️ CLASSIFIED, not bare. A torn upload or a pod written by a newer app
  // version throws here — AFTER the bytes were read — and a plain `Error`
  // reaches `doSave`'s "save local anyway" branch, which then replaces that
  // remote with this device's base and certifies the result as the baseline.
  let remoteEnvelope: BeanpodFileV4;
  try {
    remoteEnvelope = parseBeanpodV4(text);
  } catch (e) {
    const err = new CorruptPayloadError(
      e instanceof Error ? e.message : String(e),
      'parse',
      currentEnvelope?.familyId ?? null
    );
    noteRemoteUnreadable(err);
    throw err;
  }

  // ⚠️ LINEAGE GUARD (terminus 3), and this is the one that makes a compaction
  // able to SPREAD. A peer's first post-compaction sync arrives right here, so
  // if this only ever merged-or-threw, every peer in the fleet would latch and
  // none would ever adopt.
  //
  // The context is the #65 comparison that already exists, over the baseline
  // this module already holds — no extra probe.
  const lineageCtx = await docPushedAgainst(remoteBaseline?.headsFp ?? null);
  // ⚠️ LATCH AT THE THROW. `guardLineage` throws OUTSIDE the try below, so a
  // block armed nothing: the local-file poll watcher's `if (remoteBlocked)`
  // gate stayed open and it re-downloaded, re-parsed and re-threw the whole
  // multi-megabyte pod every tick, reporting a `local-file-polling` warning
  // each time and telling the user nothing.
  let lineageAct;
  try {
    lineageAct = guardLineage(remoteEnvelope.podLineage, currentEnvelope?.podLineage, lineageCtx);
  } catch (e) {
    if (e instanceof PodLineageError) noteLineageBlocked(e);
    throw e;
  }
  if (lineageAct === 'publish-local') {
    // We hold an unpublished compaction and the remote is on the older lineage.
    // Do NOT merge and do NOT learn the marker: `doSave` should proceed to write
    // our compacted document over it. (If the remote had actually moved, the
    // guard would have returned `block` — see the policy table.)
    return;
  }

  // The worker decrypts + CRDT-merges the remote into its doc and returns
  // heads-derived `dirty` (did local carry unsynced changes the converged doc
  // must push back?). No suppressAutoSave bracket is needed — the worker doesn't
  // fire a main persist callback; main decides when to save via `dirty`.
  //
  // `adopt` returns the SAME shape, so the baseline commit, `setEnvelope`, the
  // latch clear and the `if (dirty)` tail below are all unchanged. Adopting
  // after a genuine `changed` probe is sound for the reason the full-adopt
  // branch already documents: the document installed IS the remote, so
  // `remoteHeads` describes it exactly.
  let merged: { dirty: boolean; remoteHeads: string[] | null };
  try {
    merged =
      lineageAct === 'adopt'
        ? await docClient.adoptRemoteEnvelope(remoteEnvelope, remoteEnvelope.familyId)
        : await docClient.mergeRemoteEnvelope(remoteEnvelope, remoteEnvelope.familyId);
  } catch (e) {
    // ⚠️ THE MARKER MUST NOT BE LEARNED FOR A REMOTE WE COULD NOT READ.
    //
    // It used to be learned above, BEFORE the merge. So a payload failure here
    // left the in-memory baseline claiming this revision, the next
    // `remoteChanged()` answered 'unchanged', `fetchAndMergeRemote` returned
    // early WITHOUT throwing — and the save that followed sailed past its own
    // refusal and overwrote the remote anyway. The refusal defended exactly one
    // save. Learning it only on success is what makes that guard mean anything.
    if (e instanceof PayloadLoadError) {
      noteRemoteUnreadable(e);
      throw e;
    }
    // Anything else here fired AFTER the bytes were read: the download, the
    // decrypt and the load all succeeded and the MERGE refused. That is not a
    // transport failure, so it must not reach `doSave`'s "save local anyway"
    // branch — which would write a base that provably lacks the remote's
    // changes over it. Wrap it into the blocker the save path refuses on.
    const blocked = e instanceof RemoteMergeError ? e : new RemoteMergeError(e);
    noteMergeFailed(blocked);
    throw blocked;
  }
  const { dirty, remoteHeads } = merged;

  // Learn the marker we sampled BEFORE this read (C13/C10). If a peer wrote in the
  // gap between the probe and the read, this records the OLDER revision → the next
  // open re-reads (the safe direction), never a stale skip.
  // C1 applies to THIS too, now that it sits after the merge await rather than
  // before it: a family switch landing mid-merge would otherwise stamp family
  // A's revision into family B's module-level baseline, and Drive revisions are
  // small per-file counters, so a collision is plausible — after which B's
  // remote reads as 'unchanged', is never read, and the next save writes over
  // it. `commitRemoteBaseline` below has always been guarded for exactly this.
  if (currentProvider === providerAtRead) {
    learnRemoteMarker({ revision: change.revision, modifiedTime: change.modifiedTime });
    // A remote we could not read a moment ago has now been read and merged.
    clearRemoteUnreadable();
  }

  // Local-wins merge of the three key dicts (wrappedKeys / inviteKeys /
  // passkeyWrappedKeys) — the local side is the just-mutated state about to
  // be pushed. `setEnvelope` also RPCs the worker to re-persist the envelope
  // cache (keeps cold-start unlock working after a peer key-add/rotation).
  setEnvelope(preserveLocalKeyDicts(remoteEnvelope, currentEnvelope));
  // Terminus 2 (C10): the worker's doc now provably contains this remote state —
  // but only commit if no family switch landed mid read+merge (C1).
  // #65: `remoteHeads` is the heads of the bytes Drive holds (captured pre-migrate,
  // pre-merge). `?? null` mirrors this file's fail-safe-default discipline — a
  // partial test double degrades to "unknown => read", never to a false skip.
  if (currentProvider === providerAtRead) commitRemoteBaseline(remoteHeads ?? null);

  // The poll path's ONLY re-upload trigger: re-push a converged doc that still
  // carries local unsynced changes (heads-derived dirty), without ping-ponging
  // on a no-op/remote-ahead merge.
  if (dirty) triggerDebouncedSave();
}

/**
 * Internal save implementation
 */
async function doSave(): Promise<boolean> {
  if (!currentProvider) {
    updateState({ lastError: 'No file configured' });
    return false;
  }

  if (!currentFamilyKey || !currentEnvelope) {
    console.warn('[syncService] save() blocked: no family key or envelope set');
    return false;
  }

  // Guard: ensure provider belongs to the active family
  const activeFamilyId = getActiveFamilyId();
  if (currentProviderFamilyId && activeFamilyId && currentProviderFamilyId !== activeFamilyId) {
    console.warn(
      `[syncService] save() blocked: provider belongs to family ${currentProviderFamilyId} but active family is ${activeFamilyId}`
    );
    return false;
  }

  updateState({ isSyncing: true, lastError: null });

  try {
    // Only the web (handle-based) LocalStorageProvider needs a file-permission
    // check before writing. CapacitorFileProvider (native, app-private path-based
    // storage) has no FileSystemFileHandle and needs no permission gate — gating
    // on `instanceof` (not `type === 'local'`, which both providers share) skips
    // it natively and avoids calling the handle-only getHandle(). See ADR-029.
    if (currentProvider instanceof LocalStorageProvider) {
      const localProvider = currentProvider;
      const permissionGranted = await verifyPermission(localProvider.getHandle(), 'readwrite');
      if (!permissionGranted) {
        console.warn('[syncService] doSave: file permission denied — save skipped');
        updateState({ isSyncing: false, lastError: 'Permission denied' });
        return false;
      }
    }

    // Fetch-merge-save: merge any remote changes before writing to prevent overwrites.
    // Non-fatal — if merge fails, we still save local state (better than losing it).
    try {
      await fetchAndMergeRemote();
    } catch (e) {
      // ⚠️ ONE EXCEPTION, AND IT IS THE WHOLE REASON THIS BRANCH EXISTS.
      //
      // "Save local anyway" is right when the merge failed for a transport
      // reason: the remote is still there, and the next save re-merges. It is
      // catastrophic when the remote could not be READ INTO MEMORY, because
      // the write below replaces the whole file with a base built from a doc
      // that provably does not contain it — silently destroying every peer edit
      // that lived only in the remote copy, and then certifying the result as
      // the new baseline.
      //
      // This became reachable when the payload paths stopped raising the fatal
      // overlay: before that the user could not generate mutations, so no
      // debounced save could fire. Keeping the session usable means the save
      // path has to refuse instead.
      if (isRemoteBlocker(e)) {
        // ⚠️ ANY blocker, not a list of classes. A `PodLineageError` reaching
        // here (the terminus-3 guard throws OUTSIDE the try below it) used to
        // fall through to "save local anyway", which writes this device's
        // PRE-COMPACTION document — and an envelope with no `podLineage` — over
        // the compacted remote, undoing the compaction for the whole family.
        console.error(
          '[syncService] doSave: remote unreadable or unmergeable — refusing to overwrite it',
          e
        );
        // THROW, do not `return false`. A bare false skips the catch below,
        // which is the only caller of `recordSaveFailure` — the mechanism that
        // increments the failure count, raises the save-failure banner and
        // drives the sidebar indicator. Without it a whole session of edits
        // went unsaved with nothing on screen, and `forceSaveWithTimeout` read
        // the false as "nothing to save" and let sign-out delete the local DB.
        // Arm the breaker for a blocker that reached us unlatched. The
        // terminus-3 lineage guard throws before `fetchAndMergeRemote`'s own
        // try, so nothing had latched it; without this the next tick repeats
        // the whole download.
        if (e instanceof PodLineageError && !isRemoteBlocked()) noteLineageBlocked(e);
        throw e;
      }
      console.warn('[syncService] fetchAndMergeRemote failed (non-fatal):', e);
    }

    // Re-encrypt the Automerge doc with the family key and update the envelope
    const inviteKeyCount = currentEnvelope.inviteKeys
      ? Object.keys(currentEnvelope.inviteKeys).length
      : 0;
    if (inviteKeyCount > 0) {
      console.warn('[syncService] doSave: writing envelope with', inviteKeyCount, 'invite key(s)');
    }
    // The worker serializes + encrypts the doc → base64 payload; main assembles
    // the envelope (keys never leave main for the upload path).
    // #65: `exportedHeads` are the heads of EXACTLY these serialized bytes — the
    // only sound Drive-baseline value on the write path.
    const { payload, heads: exportedHeads } = await docClient.exportEncryptedPayload();
    const fileContent = reEncryptEnvelope(currentEnvelope, payload);

    // INVARIANT (ADR-032 addendum, 2026-07-15): every save writes the FULL compacted
    // base. Change-log/delta chunks were retired on the strength of this — the base
    // is the sole authoritative, always-current copy every peer reads. Do NOT
    // coalesce, skip, or reduce the frequency of this write without first
    // re-introducing a delta mechanism AND re-deriving the convergence argument,
    // or a peer can silently miss another device's edits.
    bumpOpenCycle('driveWrite'); // counted per attempt; no-op outside an open window
    // Capture BEFORE the awaits below. `currentProvider` is a nullable module var
    // that `reset()` / `disconnect()` clear with no serialization against an
    // in-flight save — sign-out explicitly abandons a still-running `doSave`. If the
    // catch handler dereferenced it after that, the handler itself would throw and
    // turn a write that actually reached Drive into a reported save failure.
    // C1: capture the provider we write THROUGH. A sign-out / family-switch can
    // null or swap `currentProvider` during this multi-second write; committing our
    // baseline into the NEW family's state afterwards would poison it (the module
    // baseline is family-untagged). Learn/commit ONLY while the active provider is
    // still the one we wrote through.
    const providerAtWrite: StorageProvider = currentProvider;
    const providerTypeForDiag = providerAtWrite.type;
    // C14b: the write returns its own resulting revision IN the response. Narrow
    // the `WriteAck | void` union explicitly at this ONE site.
    const ack = await providerAtWrite.write(fileContent);
    recordPersistedBytes(fileContent); // capture size for the registry usage signal
    const ackRevision = ack ? ack.revision : null;

    if (currentProvider !== providerAtWrite) {
      // A family switch landed mid-write — do not touch the baseline (C1).
    } else if (ackRevision !== null) {
      // Terminus 3 (C10): the file IS what we just wrote. Learn our own write's
      // revision and commit — for Drive this REPLACES the old post-write metadata
      // read, removing one network round-trip per save.
      learnRemoteMarker({ revision: ackRevision, modifiedTime: null });
      // `?? null` is the same fail-safe every other call site applies: an older or
      // partial worker double omits `heads`, and `headsFingerprint(undefined)`
      // would throw HERE — after the upload already landed — converting a
      // successful save into a reported failure that advances the save-failure
      // escalation ladder.
      commitRemoteBaseline(exportedHeads ?? null);
    } else if (providerAtWrite.getRemoteMarker) {
      // Drive write whose ack body was unparseable: RE-PROBE the real revision
      // rather than nulling the basis. Nulling would re-download our own 2-3MB
      // write on the next poll AND false-block a non-force syncNow with "File has
      // newer data". One extra metadata call, only on a rare malformed 2xx.
      try {
        const marker = await providerAtWrite.getRemoteMarker();
        if (currentProvider === providerAtWrite) {
          learnRemoteMarker(marker);
          // NOT `exportedHeads`. This revision was probed AFTER our write, so a peer
          // may have written in the gap — pairing their revision with our heads would
          // certify a (revision, heads) pair that never existed on Drive, and the next
          // in-window open would skip past their edits. `null` costs one extra read,
          // which is what every other uncertain branch of this design costs.
          commitRemoteBaseline(null);
        }
      } catch (e) {
        console.warn(
          '[syncService] doSave: post-write marker re-probe failed — baseline not advanced (next open re-reads):',
          e
        );
        logEvent({
          level: 'warn',
          surface: 'sync-save',
          message: 'post-write marker re-probe failed — baseline not advanced',
          error: e instanceof Error ? e : undefined,
          context: { action: 'post-write-probe-failed', detail: providerTypeForDiag },
        });
      }
    } else {
      // Non-Drive provider (no revision): refresh the in-memory MTIME basis ONLY —
      // stops a local-file poll re-reading its own write. Never a persisted baseline.
      try {
        const postWriteTimestamp = await providerAtWrite.getLastModified();
        if (postWriteTimestamp && currentProvider === providerAtWrite) {
          learnRemoteMarker({ revision: null, modifiedTime: postWriteTimestamp });
        }
      } catch (e) {
        console.warn(
          '[syncService] doSave: post-write getLastModified fallback failed — next save may re-fetch our own write; check token/network:',
          e
        );
        logEvent({
          level: 'warn',
          surface: 'sync-save',
          message: 'post-write mtime fallback failed — next save may re-fetch',
          error: e,
          context: { action: 'post-write-timestamp-failed', detail: providerTypeForDiag },
        });
      }
    }

    updateState({ isSyncing: false, lastError: null });

    // Track save success
    recordSaveSuccess();

    // Notify subscribers of save timestamp
    const timestamp = new Date().toISOString();
    saveCompleteCallbacks.forEach((cb) => cb(timestamp));

    return true;
  } catch (e) {
    const errorMsg = (e as Error).message;
    updateState({ isSyncing: false, lastError: errorMsg });
    recordSaveFailure(errorMsg);
    return false;
  }
}

/**
 * Load the raw file content from the storage provider.
 * Returns the raw text, or null if the file is empty/missing.
 */
export async function load(): Promise<string | null> {
  if (!currentProvider) {
    updateState({ lastError: 'No file configured' });
    return null;
  }

  updateState({ isSyncing: true, lastError: null });

  try {
    // Only the web (handle-based) LocalStorageProvider needs a permission check
    // before reading; CapacitorFileProvider (native) has no handle and skips it
    // (see doSave). Gating on `instanceof` avoids the handle-only getHandle().
    if (currentProvider instanceof LocalStorageProvider) {
      const localProvider = currentProvider;
      const hasPermission = await verifyPermission(localProvider.getHandle(), 'read');
      if (!hasPermission) {
        updateState({ isSyncing: false, lastError: 'Permission denied' });
        return null;
      }
    }

    const providerTypeForDiag = currentProvider.type; // see doSave — capture before the awaits
    // C13: sample the marker STRICTLY BEFORE the download, inside this same try so
    // the NotFoundError/404 classification below still governs. A committed baseline
    // can then only ever describe content we actually merged — a peer write landing
    // AFTER this probe advances the counter, so the NEXT open reads (safe). This
    // ordering is LOAD-BEARING: it looks like a harmless reorder and it is not.
    // Non-throwing: a probe failure nulls the baseline (=> read next open) and must
    // NOT fail the load; the read proceeds and re-raises any real auth error.
    remoteBaseline = null;
    try {
      // ⚠️ PROVISIONAL until the caller confirms it merged. `load()` hands the
      // text back and `syncStore` calls `docClient.mergeRemoteEnvelope`
      // DIRECTLY, so a payload failure there used to leave this marker standing
      // — the next `remoteChanged()` answered 'unchanged', `fetchAndMergeRemote`
      // returned without throwing, and the save wrote a base over a revision the
      // doc provably never contained. `confirmRemoteMerged()` / `rollbackRemoteMarker()`
      // close that: the store calls one of them on every outcome.
      pendingMarker = await probeRemoteMarker();
      learnRemoteMarker(pendingMarker);
    } catch (e) {
      console.warn(
        '[syncService] load: pre-read marker probe failed — no change-detection baseline, callers do a full read; check Drive token/network:',
        e
      );
      logEvent({
        level: 'warn',
        surface: 'sync-load',
        message: 'pre-read marker probe failed — no change-detection baseline',
        error: e,
        context: { action: 'pre-read-probe-failed', detail: providerTypeForDiag },
      });
    }

    bumpOpenCycle('driveRead'); // counted per attempt; no-op outside an open window
    const text = await currentProvider.read();

    if (!text) {
      updateState({ isSyncing: false, lastError: null });
      return null;
    }
    recordPersistedBytes(text); // capture size for the registry usage signal

    updateState({ isSyncing: false, lastError: null });
    return text;
  } catch (e) {
    if ((e as Error).name === 'NotFoundError' || (e as Error).message.includes('JSON')) {
      updateState({ isSyncing: false, lastError: null });
      return null;
    }
    if (e instanceof DriveApiError && e.status === 404) {
      updateState({ isSyncing: false, lastError: `DriveApiError:404:${(e as Error).message}` });
      return null;
    }
    updateState({ isSyncing: false, lastError: (e as Error).message });
    return null;
  }
}

/**
 * Load file and parse as V4 envelope.
 * Returns the envelope (caller decrypts with family key), or flags for needsPassword.
 */
export async function loadAndParseV4(): Promise<{
  success: boolean;
  envelope?: BeanpodFileV4;
  needsPassword?: boolean;
  fileNotFound?: boolean;
}> {
  const text = await load();
  if (!text) {
    const lastError = getState().lastError;
    if (lastError?.startsWith('DriveApiError:404:')) {
      return { success: false, fileNotFound: true };
    }
    return { success: false };
  }

  try {
    const envelope = parseBeanpodV4(text);

    // Guard: familyId must match active family
    let activeFamilyId = getActiveFamilyId();
    if (envelope.familyId && activeFamilyId && envelope.familyId !== activeFamilyId) {
      console.warn(
        `[syncService] File familyId (${envelope.familyId}) does not match active family (${activeFamilyId}). Skipping.`
      );
      updateState({ lastError: 'Sync file belongs to a different family', isConfigured: false });
      return { success: false };
    }

    // If no active family, adopt from file
    if (!activeFamilyId && envelope.familyId) {
      await createFamilyWithId(envelope.familyId, envelope.familyName ?? 'My Family');
      activeFamilyId = envelope.familyId;
    }

    // File is V4 and encrypted — needs family key to decrypt
    return { success: true, envelope, needsPassword: true };
  } catch (e) {
    updateState({ lastError: (e as Error).message });
    return { success: false };
  }
}

/**
 * Open file picker to select an existing sync file, read it, and configure as sync target.
 */
export async function openAndLoadFile(): Promise<OpenFileResult> {
  cancelPendingSave();

  if (!supportsFileSystemAccess()) {
    return openAndLoadFileFallback();
  }

  try {
    const handles = await window.showOpenFilePicker({ multiple: false });
    const handle = handles[0];
    if (!handle) return { success: false };

    const provider = LocalStorageProvider.fromHandle(handle);
    updateState({ isSyncing: true, lastError: null });

    const text = await provider.read();
    if (!text) {
      updateState({ isSyncing: false, lastError: 'File is empty' });
      return { success: false };
    }

    const version = detectFileVersion(text);

    if (version === '4.0') {
      const envelope = parseBeanpodV4(text);
      updateState({ isSyncing: false, lastError: null });
      return {
        success: false,
        needsPassword: true,
        fileHandle: handle,
        provider,
        envelope,
      };
    }

    // V3 or unknown format
    updateState({
      isSyncing: false,
      lastError: `Unsupported file version: ${version ?? 'unknown'}`,
    });
    return { success: false, rawText: text };
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      updateState({ isSyncing: false });
      return { success: false };
    }
    updateState({ isSyncing: false, lastError: (e as Error).message });
    return { success: false };
  }
}

/**
 * Fallback for openAndLoadFile when File System Access API is not available
 */
async function openAndLoadFileFallback(): Promise<OpenFileResult> {
  try {
    cancelPendingSave();
    const file = await openFilePicker();
    if (!file) return { success: false };

    if (!file.name.endsWith('.beanpod') && !file.name.endsWith('.json')) {
      updateState({ isSyncing: false, lastError: 'Please select a .beanpod or .json file' });
      return { success: false };
    }

    updateState({ isSyncing: true, lastError: null });
    const text = await file.text();

    if (!text.trim()) {
      updateState({ isSyncing: false, lastError: 'File is empty' });
      return { success: false };
    }

    const version = detectFileVersion(text);

    if (version === '4.0') {
      const envelope = parseBeanpodV4(text);
      updateState({ isSyncing: false, lastError: null });
      return {
        success: false,
        needsPassword: true,
        envelope,
      };
    }

    updateState({
      isSyncing: false,
      lastError: `Unsupported file version: ${version ?? 'unknown'}`,
    });
    return { success: false, rawText: text };
  } catch (e) {
    updateState({ isSyncing: false, lastError: (e as Error).message });
    return { success: false };
  }
}

/**
 * Load a file that was dropped onto the drop zone (drag-and-drop).
 */
export async function loadDroppedFile(
  file: File,
  fileHandle?: FileSystemFileHandle
): Promise<OpenFileResult> {
  cancelPendingSave();
  try {
    updateState({ isSyncing: true, lastError: null });
    const text = await file.text();

    if (!text.trim()) {
      updateState({ isSyncing: false, lastError: 'File is empty' });
      return { success: false };
    }

    const version = detectFileVersion(text);

    if (version === '4.0') {
      const envelope = parseBeanpodV4(text);
      const provider = fileHandle ? LocalStorageProvider.fromHandle(fileHandle) : undefined;
      updateState({ isSyncing: false, lastError: null });
      return {
        success: false,
        needsPassword: true,
        fileHandle,
        provider,
        envelope,
      };
    }

    updateState({
      isSyncing: false,
      lastError: `Unsupported file version: ${version ?? 'unknown'}`,
    });
    return { success: false, rawText: text };
  } catch (e) {
    updateState({ isSyncing: false, lastError: (e as Error).message });
    return { success: false };
  }
}

/**
 * Register the docService persist callback to trigger debounced saves.
 * Called once at startup by syncStore.
 *
 * Also updates the local IndexedDB persistence cache on every change,
 * ensuring the cache is always fresh for fast startup on page refresh.
 */
export function registerDocPersistCallback(): void {
  // ADR-032: the worker now owns the cache persist (debounced internally after
  // every mutate/merge). Main only needs to (a) schedule the debounced Drive
  // save after each local change, and (b) surface worker cache-persist failures
  // to the durability banner. The old onDocPersistNeeded fan-out + main-thread
  // persistDoc/persistEnvelope/isCacheReady are gone.
  docClient.setLocalChangeHandler(() => triggerDebouncedSave());
  docClient.setCachePersistFailedHandler(setCachePersistFailed); // worker path
  setInlineCachePersistFailedHandler(setCachePersistFailed); // inline fallback path
}

/**
 * Trigger a debounced save (for auto-sync).
 */
export function triggerDebouncedSave(): void {
  // When merging inside doSave(), suppress redundant save scheduling
  if (suppressAutoSave) return;

  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
  }

  saveDebounceTimer = setTimeout(() => {
    saveDebounceTimer = null;
    if (!currentFamilyKey || !currentEnvelope) {
      // Only log once to avoid console spam during init
      if (!noKeyWarnedOnce) {
        console.warn('[syncService] Auto-save skipped: no family key or envelope');
        noKeyWarnedOnce = true;
      }
      return;
    }
    save().catch((err) => {
      console.warn('[syncService] Auto-save failed:', err);
      recordSaveFailure((err as Error).message ?? 'Auto-save failed');
    });
  }, DEBOUNCE_MS);
}

/**
 * Cancel any pending debounced save and perform an immediate save.
 */
export async function saveNow(): Promise<boolean> {
  cancelPendingSave();
  if (!currentFamilyKey || !currentEnvelope) {
    if (!noKeyWarnedOnce) {
      console.warn('[syncService] saveNow skipped: no family key or envelope');
      noKeyWarnedOnce = true;
    }
    return false;
  }
  return save();
}

/**
 * Cancel any pending debounced save
 */
export function cancelPendingSave(): void {
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = null;
  }
}

/**
 * Flush any pending debounced save immediately.
 */
export async function flushPendingSave(): Promise<void> {
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = null;
    if (!currentFamilyKey || !currentEnvelope) {
      console.warn('[syncService] Flush skipped: no family key or envelope');
      return;
    }
    await save();
  }
}

/**
 * Disconnect from sync file
 */
export async function disconnect(): Promise<void> {
  cancelPendingSave();
  stopPolling();
  if (currentProvider) {
    const familyId = getActiveFamilyId();
    if (familyId) {
      await currentProvider.clearPersisted(familyId);
    }
    await currentProvider.disconnect();
  }
  currentProvider = null;
  currentProviderFamilyId = null;
  currentFamilyKey = null;
  currentEnvelope = null;
  // Same reason `reset()` and `setProvider()` do it: a baseline describing the OLD
  // file must not survive an unbind, or a coincidental revision match could grant a
  // skip against a file this service is no longer bound to. #65 widens the leak —
  // the surviving object also carries `headsFp` and a live `checkedAt`.
  remoteBaseline = null;
  // ⚠️ AND THE BREAKER. It describes a file this service is no longer bound to,
  // and nothing else cleared it: `selectSyncFile`/`selectNativeLocalFile` assign
  // `currentProvider` directly, so a latch armed on the OLD pod survived a
  // disconnect and a rebind to a DIFFERENT one — after which `createNewFile` ->
  // `syncNow(true)` -> `doSave` threw the stale blocker, `loadFromFile` threw it
  // at entry, and only a page reload cleared it.
  clearRemoteUnreadable();
  updateState({
    isConfigured: false,
    fileName: null,
    lastError: null,
  });
}

/**
 * Check if sync is configured and has permission
 */
export async function hasPermission(): Promise<boolean> {
  if (!currentProvider) {
    return false;
  }
  return currentProvider.isReady();
}
