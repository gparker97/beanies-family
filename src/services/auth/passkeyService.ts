/**
 * Device biometric service — NATIVE KEYSTORE ONLY since Phase 4 of the 2026-08-28
 * login rethink.
 *
 * The web WebAuthn+PRF path is RETIRED: it was fragile in four independent ways
 * (PRF support, extension evaluation timing, synced-credential drift, cache
 * dependence) and is superseded by the member PIN + recovery kit model. This module
 * no longer creates web credentials, runs web assertions, or touches PRF. What
 * remains for web is pure REGISTRY management of leftover registrations (list /
 * rename / remove + the WebAuthn Signal API cleanup) so users can tidy up old
 * entries — plus the `prf_withheld` telemetry seam in `proveMethods.ts` that
 * measures how many users still carry one.
 *
 * Envelope `passkeyWrappedKeys` entries are left INERT (same policy as legacy
 * password wraps): envelope merge cannot propagate deletions, so they are retired
 * from the envelope by #117 key rotation, not here.
 *
 * Native (installed app) is unchanged: hardware Keystore via `nativeBiometric.ts`
 * (ADR-029) — no WebAuthn, no PRF, no envelope coupling.
 */

import * as passkeyRepo from '@/services/indexeddb/repositories/passkeyRepository';
import * as nativeBiometric from './nativeBiometric';
import type { PasskeyRegistration, PasskeySecret } from '@/types/models';
import { toISODateString } from '@/utils/date';
import { isNative } from '@/services/sync/capabilities';
// The authority on which family is active, and the same import `rosterCache.ts` uses for
// it. Note it is not a store, but it DOES reach stores transitively through the error
// reporter, so do not rely on this file being store-free: the direct edge is what matters
// (`authStore.ts` statically imports `resolveDeviceKeys` from here, so a direct store
// import would close a real cycle).
import { getActiveFamilyId } from '@/services/indexeddb/database';
import { logEvent } from '@/services/telemetry/logEvent';
import {
  describeAuthError,
  guessAuthenticatorLabel,
  MEMBER_MISMATCH,
  WRONG_FAMILY_CREDENTIAL,
  tr,
} from './biometricShared';

// Re-exported for back-compat: `guessAuthenticatorLabel` now lives in the leaf
// `biometricShared` module (so the native Keystore path can reuse it without an
// import cycle), but existing callers import it from here.
export { guessAuthenticatorLabel };

// The auth sentinels are defined in the leaf so both mechanisms can produce them;
// re-exported here because the views that branch on them import from this module.
export { MEMBER_MISMATCH, WRONG_FAMILY_CREDENTIAL };

/**
 * Resolve the WebAuthn Relying Party ID. Survives the PRF retirement ONLY for the
 * Signal API cleanup of leftover web credentials (`signalCredentialsRemoved`).
 */
export function getRpId(): string {
  return window.location.hostname;
}

// --- Feature detection ---

/**
 * Whether the user CAN enroll biometric on this surface. NATIVE ONLY since Phase 4 —
 * the web WebAuthn+PRF path is retired, so web always answers false.
 */
export async function canEnrollBiometric(): Promise<boolean> {
  if (isNative()) return nativeBiometric.nativeCanEnroll();
  return false;
}

/**
 * Whether to PROACTIVELY offer biometric enrollment (the auth-prompt sequencer's
 * native branch). NATIVE ONLY since Phase 4.
 */
export async function canOfferBiometric(): Promise<boolean> {
  if (isNative()) return nativeBiometric.nativeCanOffer();
  return false;
}

// --- Registration ---

export interface RegisterPasskeyParams {
  memberId: string;
  memberName: string;
  memberEmail: string;
  familyId: string;
  familyKey: CryptoKey;
  label?: string;
}

export interface RegisterPasskeyResult {
  success: boolean;
  /**
   * True when the user dismissed the platform-authenticator prompt. Distinct from
   * a real failure so callers can swallow user-cancellation silently.
   */
  cancelled?: boolean;
  error?: string;
  prfSupported?: boolean;
  passkeySecret?: PasskeySecret;
}

/**
 * Enrol device biometric for a member. NATIVE ONLY since Phase 4 — a web call is a
 * programming error (no surface offers it) and returns a clean refusal, never a
 * WebAuthn ceremony.
 */
export async function registerPasskeyForMember(
  params: RegisterPasskeyParams
): Promise<RegisterPasskeyResult> {
  if (isNative()) return nativeBiometric.nativeEnable(params);
  return {
    success: false,
    error: tr(
      'passkey.errNotSupported',
      "Biometric unlock isn't available on this device right now."
    ),
  };
}

// --- Authentication ---

export interface AuthenticatePasskeyParams {
  familyId: string;
  /**
   * Which member the caller expects to sign in. Native: a SELECTOR — the keystore
   * item is addressed per member, so this picks which key to prompt for, and a
   * member with no key here returns MEMBER_MISMATCH without prompting at all.
   */
  memberId: string;
  /** Unused since Phase 4 (was the web PRF envelope material). Kept for call-site compat. */
  passkeySecrets?: PasskeySecret[];
}

export interface AuthenticatePasskeyResult {
  success: boolean;
  /** True when the user dismissed the platform prompt — swallow silently. */
  cancelled?: boolean;
  memberId?: string;
  credentialId?: string;
  familyKey?: CryptoKey;
  error?: string;
}

/**
 * Biometric unlock. NATIVE ONLY since Phase 4 — the web assertion path is deleted;
 * the prove engine never offers biometric on web, so a web call here is a
 * programming error and gets a clean refusal.
 */
export async function authenticateWithPasskey(
  params: AuthenticatePasskeyParams
): Promise<AuthenticatePasskeyResult> {
  if (isNative()) return nativeBiometric.nativeUnlock(params.familyId, params.memberId);
  return {
    success: false,
    error: tr(
      'passkey.errNotSupported',
      "Biometric unlock isn't available on this device right now."
    ),
  };
}

// --- Management ---

export async function listRegisteredPasskeys(memberId?: string): Promise<PasskeyRegistration[]> {
  if (memberId) {
    return passkeyRepo.getPasskeysByMember(memberId);
  }
  return passkeyRepo.getAllPasskeys();
}

/**
 * WHICH members can this device sign in for `familyId`? Registry-only — no biometric
 * prompt — because it runs on every family selection and every member-picker render.
 *
 * This is the SINGLE answer to "is biometric available here?" and to "which members?".
 * There is deliberately no boolean sibling: every caller needs to know WHOSE key it is.
 *
 * Web note (Phase 4): the web branch still READS leftover WebAuthn registrations —
 * they feed the roster fallback, the Settings management list, and the
 * `prf_withheld` straggler signal — but they are never offered as a prove method.
 */
export async function resolveDeviceKeys(familyId: string): Promise<PasskeyRegistration[]> {
  // Native: only a `native-keystore` record counts (and stale WebAuthn records are
  // cleaned up there so they neither drive an unlock nor suppress the enroll offer).
  if (isNative()) return nativeBiometric.nativeResolveDeviceKeys(familyId);

  let records: PasskeyRegistration[];
  try {
    records = await passkeyRepo.getPasskeysByFamily(familyId);
  } catch (err) {
    // Same input, same outcome, on both platforms: degrade to "no keys" and log, so
    // "registry broken" stays distinguishable from "nothing enrolled".
    logEvent({
      level: 'warn',
      surface: 'passkey-prf',
      message: 'registry_read_failed',
      context: { action: 'registry_read_failed', detail: describeAuthError(err).slice(0, 200) },
    });
    return [];
  }

  // De-duplicate by member: the retired synced-credential path could write an EXTRA
  // record for the same member. Without this, one person shows up twice in choosers.
  const seen = new Set<string>();
  return records.filter((r) => (seen.has(r.memberId) ? false : (seen.add(r.memberId), true)));
}

/**
 * Reclaim every keystore blob this device holds for a family — per-member and legacy.
 * Delegated so the `isNative()` guard stays in one place and no other module has to
 * know how a keystore account is addressed.
 */
export async function reclaimFamilyKeystore(familyId: string): Promise<void> {
  if (!isNative()) return;
  await nativeBiometric.nativeReclaimFamilyKeystore(familyId);
}

/**
 * Reclaim EVERY keystore blob on this device, for every family — the explicit
 * clear-all-data path, and the only route that reaches material for a family this
 * device no longer has a registry entry for (the #82 orphan case).
 *
 * `familyIds` is the fallback list for a build where the sweep primitive is missing;
 * see `nativeReclaimAllKeystores`. Pass the families the registry knows about.
 */
export async function reclaimAllKeystores(familyIds: string[]): Promise<void> {
  if (!isNative()) return;
  await nativeBiometric.nativeReclaimAllKeystores(familyIds);
}

/** One member as the roster knows them. */
export interface RosterMemberRef {
  id: string;
  /**
   * Used ONLY to backfill an absent `memberName` on a record adopted back from the
   * keychain. Never logged, never sent to telemetry — same privacy class as
   * `PasskeyRegistration.memberName`.
   */
  name: string;
}

/**
 * Cheap proof this is a real decrypted roster and not a partial paint.
 *
 * A roster-driven delete against a half-painted roster would destroy live keys, so the
 * bar is: there are members, we know who is signed in, and that person is in the list.
 * Deliberately NOT the family-coherence check. An earlier version of this comment claimed
 * the membership clause served that purpose; it cannot. `currentMember` is
 * `members.find(...)`, so a non-null `signedInMemberId` is a member of `roster` BY
 * CONSTRUCTION and that clause can never be false for the real caller. Both values come
 * from the same store snapshot, so they are mutually coherent whatever family is active.
 * The family check is the explicit `rosterFamilyId` comparison in the caller below.
 *
 * The clause is kept because it is not worthless: it rules out a roster published without
 * a resolved session member, which is the partial-paint shape.
 */
function rosterLooksComplete(roster: RosterMemberRef[], signedInMemberId: string | null): boolean {
  if (roster.length === 0) return false;
  if (!signedInMemberId) return false;
  return roster.some((m) => m.id === signedInMemberId);
}

/**
 * Reconcile this device's ADOPTED keystore material against the live roster (#82,
 * requirement 4): a member removed while the app was uninstalled has no surviving blob,
 * and a member who is still here gets their real name back on the picker.
 *
 * `rosterFamilyId` is WHICH FAMILY THE ROSTER DESCRIBES, and it is the load-bearing
 * guard: it must equal the currently active family before anything is deleted. The two
 * genuinely diverge, because `activateFamily` flips the active family and then awaits an
 * IndexedDB write, so a family-A roster mutation flushed in that window arrives while the
 * registry already says B. Judging A's roster against B's adopted keys would delete B's
 * live enrolments: the same cross-family deletion this design exists to prevent, arriving
 * by a different route. `rosterCache.ts` documents this exact store-vs-registry
 * divergence as a hazard it has already shipped once.
 *
 * `signedInMemberId` is passed IN rather than looked up: this module must not import a
 * store (`authStore.ts` imports `resolveDeviceKeys` from here, so the reverse edge is a
 * genuine cycle). The narrower true claim, worth stating so nobody over-relies on it:
 * `@/services/indexeddb/database` is not a store, but it does reach stores transitively
 * via the error reporter. The reason to use it here is that it is the authority on the
 * active family, not module purity.
 *
 * NEVER THROWS. The caller is a `void`-ed Vue watcher with no `.catch`, where an
 * unhandled rejection would have no owner. Modelled on `rosterCache.refreshRosterCache`,
 * its sibling in that same watcher, rather than inventing a second shape.
 */
export async function reconcileDeviceKeysWithRoster(
  rosterFamilyId: string | null,
  roster: RosterMemberRef[],
  signedInMemberId: string | null
): Promise<void> {
  try {
    // Everything is inside the try, `isNative()` included: a broken test double makes it
    // `undefined`, and a TypeError here is an unhandled rejection in a `void`-ed watcher.
    // Not hypothetical in this repo, an enumerated `capabilities` mock is exactly how the
    // clear-all step once threw while the suite stayed green.
    if (!isNative()) return;
    if (!rosterFamilyId) return;
    // Read in the same tick the watcher captured the roster in, and compared against the
    // family the roster was actually read for. A mismatch means this roster belongs to a
    // superseded family: drop it rather than delete against it.
    if (rosterFamilyId !== getActiveFamilyId()) return;
    if (!rosterLooksComplete(roster, signedInMemberId)) return;
    await nativeBiometric.nativeReconcileRoster(rosterFamilyId, roster);
  } catch (err) {
    logEvent({
      level: 'warn',
      surface: 'native-biometric',
      message: 'roster_reconcile_failed',
      context: {
        action: 'roster_reconcile_failed',
        detail: describeAuthError(err).slice(0, 200),
      },
    });
  }
}

export async function removePasskey(credentialId: string): Promise<void> {
  const record = await passkeyRepo.getPasskeyByCredentialId(credentialId);
  if (record?.mechanism === 'native-keystore') {
    await nativeBiometric.nativeDisable(record.familyId, record.memberId);
    return;
  }
  await passkeyRepo.removePasskeyRegistration(credentialId);
  await signalCredentialsRemoved([credentialId]);
}

/**
 * Retire every credential a member holds ON THIS DEVICE — used when they are removed
 * from the family. Routes each through `removePasskey` so there is ONE implementation
 * of "retire a credential": native deletes the OS blob, web signals the platform
 * authenticator so the credential stops being offered in iCloud Keychain / Hello.
 *
 * NOTE the device-local limit: the `passkeys` store is per device, so this reaches
 * only credentials enrolled here. Revoking a removed member's access on THEIR
 * devices is tracker #77, not this function.
 */
export async function removeAllPasskeysForMember(memberId: string): Promise<void> {
  const records = await listRegisteredPasskeys(memberId);
  for (const r of records) {
    await removePasskey(r.credentialId);
  }
}

/**
 * Signal to the platform authenticator that the given credential IDs are no
 * longer valid. Uses the WebAuthn Signal API (Chrome/Edge 132+, Safari 26+).
 */
export async function signalCredentialsRemoved(credentialIds: string[]): Promise<void> {
  if (
    typeof PublicKeyCredential === 'undefined' ||
    typeof (PublicKeyCredential as unknown as Record<string, unknown>).signalUnknownCredential !==
      'function'
  ) {
    return;
  }

  const rpId = getRpId();
  const signal = (
    PublicKeyCredential as unknown as {
      signalUnknownCredential: (opts: { rpId: string; credentialId: string }) => Promise<void>;
    }
  ).signalUnknownCredential;

  for (const credentialId of credentialIds) {
    try {
      await signal({ rpId, credentialId });
    } catch {
      // Signal is best-effort — ignore errors
    }
  }
}

export async function renamePasskey(credentialId: string, label: string): Promise<void> {
  await passkeyRepo.updatePasskey(credentialId, { label });
}

/** Kept so management surfaces can stamp usage on leftover records if needed. */
export async function touchPasskey(credentialId: string): Promise<void> {
  await passkeyRepo.updatePasskey(credentialId, { lastUsedAt: toISODateString(new Date()) });
}

// --- Utility (small, exported for existing consumers/tests) ---

export function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

export function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer as ArrayBuffer;
}

export function bufferToBase64url(buffer: ArrayBuffer): string {
  return bufferToBase64(buffer).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export function base64urlToBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return base64ToBuffer(padded);
}
