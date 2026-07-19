/**
 * Shared, mechanism-agnostic biometric helpers.
 *
 * This is a dependency-free LEAF module: it imports nothing from `passkeyService.ts`
 * (web WebAuthn-PRF path) or `nativeBiometric.ts` (native Keystore/BiometricPrompt
 * path). Both of those import FROM here, so the import graph stays a one-way DAG and
 * there is no cycle between the two largest, most security-sensitive auth files.
 *
 * It owns the per-device proactive-offer suppression cool-off and the bounded
 * diagnostic error descriptor — both used identically by the web and native paths.
 */

// `tr` now lives in translation/ (it's mechanism-agnostic and also used by the
// doc-worker client); re-exported here so existing biometric call sites keep
// their import path.
export { tr } from '@/services/translation/tr';

// Per-device, self-healing suppression of the PROACTIVE biometric offer (the
// App.vue post-sign-in nag) after a decline/failure. Stored as an expiry timestamp
// (ms) in localStorage — NOT synced, and it can only HIDE the proactive nag (never
// grants access, and never gates the deliberate Settings enroll surface, which uses
// `canEnrollBiometric()`), so it carries no security surface. Time-boxed so a
// transient cause self-heals; a successful enable clears it.
const BIOMETRIC_SUPPRESS_KEY = 'beanies.biometricOfferSuppressedUntil';
const BIOMETRIC_SUPPRESS_MS = 24 * 60 * 60 * 1000; // 24h cool-off

export function isBiometricOfferSuppressed(): boolean {
  try {
    const raw = localStorage.getItem(BIOMETRIC_SUPPRESS_KEY);
    if (!raw) return false;
    const until = Number(raw);
    if (!Number.isFinite(until)) return false;
    if (Date.now() >= until) {
      localStorage.removeItem(BIOMETRIC_SUPPRESS_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function suppressBiometricOffer(): void {
  try {
    localStorage.setItem(BIOMETRIC_SUPPRESS_KEY, String(Date.now() + BIOMETRIC_SUPPRESS_MS));
  } catch {
    /* localStorage unavailable — offer simply isn't suppressed */
  }
}

export function clearBiometricSuppression(): void {
  try {
    localStorage.removeItem(BIOMETRIC_SUPPRESS_KEY);
  } catch {
    /* no-op */
  }
}

/** Compact raw-error descriptor for diagnostics — `Name: message` (no PII). */
export function describeAuthError(e: unknown): string {
  if (e instanceof DOMException || e instanceof Error) return `${e.name}: ${e.message}`;
  return String(e);
}

// --- Authenticator label (UA-derived, mechanism-agnostic) ---
// Lives here (a leaf) rather than in passkeyService so the native Keystore path can
// reuse it without forming a passkeyService ↔ nativeBiometric import cycle.

function guessBrowser(ua: string): string {
  // Order matters — check more specific strings first
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua) && !/Chrome/.test(ua)) return 'Safari';
  if (/Firefox\//.test(ua)) return 'Firefox';
  return 'Browser';
}

function guessOS(ua: string): string {
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  if (/Mac/.test(ua)) return 'macOS';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Linux/.test(ua)) return 'Linux';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  return '';
}

export function guessAuthenticatorLabel(): string {
  const ua = navigator.userAgent;
  let base: string;
  if (/iPhone|iPad|iPod/.test(ua)) base = 'Face ID';
  else if (/Mac/.test(ua)) base = 'Touch ID';
  else if (/Windows/.test(ua)) base = 'Windows Hello';
  else if (/Android/.test(ua)) base = 'Fingerprint';
  else base = 'Biometric';

  const browser = guessBrowser(ua);
  const os = guessOS(ua);
  const context = os ? `${browser}, ${os}` : browser;
  return `${base} · ${context}`;
}
