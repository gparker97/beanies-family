/**
 * Browser capability detection for sync features
 */

import { Capacitor } from '@capacitor/core';
import { features } from '@/config/features';

export interface SyncCapabilities {
  /** Local-file `.beanpod` support (web File System Access API, or native @capacitor/filesystem) */
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
  /** Running inside the native (Capacitor) shell, not a browser/PWA */
  native: boolean;
  /** Current platform */
  platform: 'web' | 'ios' | 'android';
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
 * Running inside the native (Capacitor) shell (iOS/Android), not a browser/PWA.
 *
 * This is the ONE place `Capacitor.isNativePlatform()` is allowed to appear —
 * every other module consults `isNative()` / `getPlatform()` / the
 * `SyncCapabilities` object so the native↔web seam stays in a single file
 * (keeps a future Capacitor major a bounded change). See ADR-029.
 */
export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

/** Current platform: 'web' (browser/PWA), 'ios', or 'android'. */
export function getPlatform(): 'web' | 'ios' | 'android' {
  return Capacitor.getPlatform() as 'web' | 'ios' | 'android';
}

/**
 * iOS / iPadOS WebKit, detected by UA. The single source of truth for "this is
 * an Apple touch device" — consumed by `shouldUseRedirectAuth` (OAuth transport)
 * and the install nudge. iPadOS 13+ Safari reports a desktop UA, so we also
 * treat "Mac with a real touchscreen" (`maxTouchPoints > 1`) as iPadOS.
 * Safe at module/SSR time (returns false if `navigator` is missing).
 */
export function isIosOrIpadOs(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { maxTouchPoints?: number };
  const ua = nav.userAgent ?? '';
  return (
    /iP(hone|od|ad)/.test(ua) || (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1)
  );
}

/**
 * Running as an installed/standalone PWA (home-screen launch), via the modern
 * display-mode media query OR the legacy iOS `navigator.standalone` flag.
 * Safe at module/SSR time.
 */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as (Navigator & { standalone?: boolean }) | undefined;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true || nav?.standalone === true
  );
}

/**
 * iOS Safari that is NOT installed to the home screen — the install nudge's gate
 * and the population most affected by Safari ITP storage eviction (which wipes
 * the Drive token after ~7 days of non-use on non-installed sites). An installed
 * PWA is exempt, so this is exactly who benefits from installing.
 */
export function isIosSafariNotInstalled(): boolean {
  return isIosOrIpadOs() && !isStandalone();
}

/**
 * Whether this environment can read/write local `.beanpod` files at all — the
 * web File System Access API (Chromium only) OR the native @capacitor/filesystem
 * plugin. This is the single predicate the local-file entry points must gate on;
 * do NOT call `supportsFileSystemAccess()` directly at those sites (it only
 * answers the narrower "is the web API present" question, false in a WebView).
 */
export function canUseLocalFiles(): boolean {
  return supportsFileSystemAccess() || isNative();
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
export function getSyncCapabilities(): SyncCapabilities {
  const hasFileSystemAccess = supportsFileSystemAccess();

  // NOTE: the local-file flags still derive from the web API here. A3 flips
  // them (and the direct `supportsFileSystemAccess()` call sites) to
  // `canUseLocalFiles()` atomically with the `CapacitorFileProvider` landing —
  // flipping them before the provider exists would offer a local-file option
  // natively that has no working backend. `native`/`platform` are additive.
  return {
    fileSystemAccess: hasFileSystemAccess,
    showSaveFilePicker: hasFileSystemAccess,
    showOpenFilePicker: hasFileSystemAccess,
    webCrypto: supportsWebCrypto(),
    googleDrive: features.drive && features.oauthProxy,
    manualSync: true, // Always available via Blob download/upload
    native: isNative(),
    platform: getPlatform(),
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
