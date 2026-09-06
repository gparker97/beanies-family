/**
 * Shared Vitest auto-mock for syncService.
 *
 * Placed in __mocks__/ so that `vi.mock('@/services/sync/syncService')` (without
 * a factory) automatically picks it up. When syncService gains new exports, only
 * this file needs updating — all test files that use the mock benefit immediately.
 *
 * Tests that need custom behaviour can override individual functions:
 *   vi.mocked(onStateChange).mockImplementation(...)
 */
import { vi } from 'vitest';

// Subscription functions return an unsubscribe callback
export const onStateChange = vi.fn(() => () => {});
export const getState = vi.fn(() => ({
  isInitialized: false,
  isConfigured: false,
  fileName: null,
  isSyncing: false,
  lastError: null,
}));
export const onSaveComplete = vi.fn(() => () => {});
export const onSaveFailureChange = vi.fn(() => () => {});

// Provider accessors
export const getProviderType = vi.fn(() => null);
export const getProvider = vi.fn(() => null);
export const getProviderFamilyId = vi.fn<() => string | null>(() => null);
export const setProvider = vi.fn();
export const selectNativeLocalFile = vi.fn(async () => true);

// Family key / envelope (V4)
export const setFamilyKey = vi.fn();
export const getFamilyKey = vi.fn(() => null);
export const hasFamilyKey = vi.fn(() => false);
export const getEnvelope = vi.fn(() => null);
export const setEnvelope = vi.fn();

// Doc persistence callback (Automerge → sync)
export const registerDocPersistCallback = vi.fn();

// Save failure tracking
export const getSaveFailureLevel = vi.fn(() => 'none');
export const getLastSaveError = vi.fn(() => null);
export const resetSaveFailures = vi.fn();
export const getConsecutiveSaveFailures = vi.fn(() => 0);
export const onSaveAttempt = vi.fn(() => () => {});

// Cache persistence failure tracking
export const isCachePersistFailed = vi.fn(() => false);
export const onCacheFailureChange = vi.fn(() => () => {});

// Lifecycle
export const reset = vi.fn();
export const initialize = vi.fn(async () => false);
export const requestPermission = vi.fn(async () => false);
export const selectSyncFile = vi.fn(async () => false);
export const disconnect = vi.fn(async () => {});
export const hasPermission = vi.fn(async () => true);

// Save operations
export const save = vi.fn(async () => true);
export const saveNow = vi.fn(async () => true);
export const triggerDebouncedSave = vi.fn();
export const cancelPendingSave = vi.fn();
export const flushPendingSave = vi.fn(async () => {});

// Load operations
// #61 open-guard surface: default to "changed / read" so existing tests keep
// today's always-read behaviour unless a test opts into a skip.
export const remoteChanged = vi.fn(async () => ({
  status: 'changed' as const,
  basis: 'revision' as const,
  revision: null as string | null,
  modifiedTime: null as string | null,
}));
export const shouldSkipOpenRead = vi.fn(async () => ({ skip: false, reason: 'changed' }));
export const commitRemoteBaseline = vi.fn();
export const seedRemoteBaseline = vi.fn();
export const load = vi.fn(async () => null);
export const loadAndImport = vi.fn(async () => ({ success: true }));
export const loadAndParseV4 = vi.fn(async () => ({ success: false }));
export const openAndLoadFile = vi.fn(async () => ({ success: true }));
export const loadDroppedFile = vi.fn(async () => ({ success: true }));
export const decryptAndImport = vi.fn(async () => ({ success: true }));

// Persisted-size tracking (registry usage signal)
export const recordPersistedBytes = vi.fn();
export const getLastPersistedBytes = vi.fn<() => number | null>(() => null);

// Encryption / session
export const setEncryptionRequiredCallback = vi.fn();
export const setSessionPassword = vi.fn();
export const getSessionPassword = vi.fn(() => null);
export const getSessionFileHandle = vi.fn(() => null);
export const setPasskeySecrets = vi.fn();

/**
 * The remote-unreadable latch (see the real module). Null = readable, which is
 * what every existing suite assumes; a suite that wants the latched behaviour
 * overrides it with `vi.mocked(syncService.isRemoteBlocked).mockReturnValue(err)`.
 */
export const isRemoteBlocked = vi.fn<() => Error | null>(() => null);

/**
 * The provisional-marker handshake (see the real module). `load()` stamps the
 * remote's revision before the caller merges; the caller then confirms or rolls
 * back. No-ops here — a suite that cares asserts on the calls.
 */
export const confirmRemoteMerged = vi.fn();
export const rollbackRemoteMarker = vi.fn();
export const noteRemoteUnreadable = vi.fn();

/** User-initiated half-open retry of the remote-blocked breaker. */
export const retryAfterRemoteBlock = vi.fn();

/**
 * The lineage/merge surface (see the real module).
 *
 * ⚠️ THESE MUST EXIST. Without them `syncService.docPushedAgainst` was
 * `undefined` in every store test, the call threw inside the surrounding `try`,
 * the lineage context silently stayed `clean`, and the `adopt-remote` × `dirty`
 * → block cell — the one that protects a peer's unsynced work — was untestable
 * through the store while every suite stayed green.
 *
 * `clean` is the default so existing suites keep today's merge behaviour; a
 * suite that wants the block overrides it with `mockResolvedValue('dirty')`.
 */
export const docPushedAgainst = vi.fn(async () => 'clean' as const);
export const isFullySynced = vi.fn(async () => true);
export const getRemoteBaselineHeadsFp = vi.fn<() => string | null>(() => null);
export const noteLineageBlocked = vi.fn();
export const noteMergeFailed = vi.fn();
export const noteRemoteBlocked = vi.fn();

/**
 * The user-file one-shot (see `noteUserChoseRemoteFile` in the real module).
 *
 * ⚠️ THESE MUST EXIST, for exactly the reason written above `docPushedAgainst`.
 * `consumeUserFileIntent` is called on the store's OPEN terminus inside a `try`,
 * so an absent double threw there and every cold-boot path reported
 * `network-error` — eight suites failed at once and none of them named the
 * cause. `false` is the right default: it is the ordinary baseline compare, and
 * a suite testing the rollback route overrides it.
 */
export const noteUserChoseRemoteFile = vi.fn();
export const consumeUserFileIntent = vi.fn(() => false);
