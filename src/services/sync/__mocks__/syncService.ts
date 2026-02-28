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
export const setProvider = vi.fn();

// Save failure tracking
export const getSaveFailureLevel = vi.fn(() => 'none');
export const getLastSaveError = vi.fn(() => null);
export const resetSaveFailures = vi.fn();

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
export const getFileTimestamp = vi.fn(async () => null);
export const loadAndImport = vi.fn(async () => ({ success: true }));
export const openAndLoadFile = vi.fn(async () => ({ success: true }));
export const loadDroppedFile = vi.fn(async () => ({ success: true }));
export const decryptAndImport = vi.fn(async () => ({ success: true }));

// Encryption / session
export const setEncryptionRequiredCallback = vi.fn();
export const setSessionPassword = vi.fn();
export const getSessionPassword = vi.fn(() => null);
export const getSessionFileHandle = vi.fn(() => null);
