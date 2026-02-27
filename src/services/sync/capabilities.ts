/**
 * Browser capability detection for sync features
 */

export interface SyncCapabilities {
  /** Supports File System Access API (persistent file handles) */
  fileSystemAccess: boolean;
  /** Supports saving files via picker */
  showSaveFilePicker: boolean;
  /** Supports opening files via picker */
  showOpenFilePicker: boolean;
  /** Supports Web Crypto API for encryption */
  webCrypto: boolean;
  /** Google Drive integration is configured (client ID present) */
  googleDrive: boolean;
  /** Manual export/import always available */
  manualSync: boolean;
}

/**
 * Check if the File System Access API is available
 */
export function supportsFileSystemAccess(): boolean {
  return (
    typeof window !== 'undefined' &&
    'showSaveFilePicker' in window &&
    'showOpenFilePicker' in window
  );
}

/**
 * Check if Web Crypto API is available
 */
export function supportsWebCrypto(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.crypto !== 'undefined' &&
    typeof window.crypto.subtle !== 'undefined'
  );
}

/**
 * Get all sync capabilities for the current browser
 */
/**
 * Check if Google Drive integration is configured
 */
export function supportsGoogleDrive(): boolean {
  return !!import.meta.env.VITE_GOOGLE_CLIENT_ID;
}

export function getSyncCapabilities(): SyncCapabilities {
  const hasFileSystemAccess = supportsFileSystemAccess();

  return {
    fileSystemAccess: hasFileSystemAccess,
    showSaveFilePicker: hasFileSystemAccess,
    showOpenFilePicker: hasFileSystemAccess,
    webCrypto: supportsWebCrypto(),
    googleDrive: supportsGoogleDrive(),
    manualSync: true, // Always available via Blob download/upload
  };
}

/**
 * Check if auto-sync is available.
 * Auto-sync (watcher + debounced save) works with any StorageProvider,
 * not just File System Access API. Returns true unconditionally.
 */
export function canAutoSync(): boolean {
  return true;
}

/**
 * Get a user-friendly message about sync capabilities
 */
export function getSyncCapabilityMessage(): string {
  const capabilities = getSyncCapabilities();

  if (capabilities.fileSystemAccess) {
    return 'Full sync support available. You can configure automatic sync to a file.';
  }

  return 'Your browser supports manual export/import only. For automatic sync, use Chrome or Edge.';
}
