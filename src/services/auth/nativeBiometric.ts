/**
 * Native biometric unlock via the hardware Keystore / Keychain (installed apps only).
 *
 * This is the NATIVE counterpart to `passkeyService.ts`'s WebAuthn-PRF path. It
 * releases a device-local, biometric-gated copy of the family AES key through the
 * custom `BiometricKeystore` Capacitor plugin (Android BiometricPrompt + KeyStore
 * CryptoObject; iOS LocalAuthentication + biometric-gated Keychain). The OS performs
 * the wrapping, so this path touches NONE of the WebAuthn-PRF crypto/envelope
 * machinery — no HKDF/AES-KW, no `passkeyWrappedKeys` synced envelope. The wrapped
 * blob is device-local and never synced. Decision + rationale: ADR-029 (2026-07-14).
 *
 * `passkeyService.ts` delegates to this module via an `isNative()` guard, so callers
 * (authStore/App.vue/ProveView/PasskeySettings) are unchanged and receive
 * the SAME result types. Web/PWA keeps WebAuthn-PRF untouched.
 *
 * Identity model: the OS biometric authenticates the DEVICE, not a member — it cannot
 * tell two enrolled faces apart. But the KEYSTORE ITEM is per member: the account is
 * `${familyId}:${memberId}`, so two members on one device can each enrol and each be
 * signed in as themselves. Pre-#76 enrolments live at the legacy bare-familyId address
 * and KEEP working there — each record carries `keystoreScheme` saying which address is
 * its own, so nothing has to be inferred and nothing is migrated. See ADR-029, amended.
 *
 * Because the prompt cannot distinguish members, a successful unlock proves only
 * "someone this device trusts"; the "not you?" escape on the prove screen is the
 * mitigation, not this module.
 *
 * THIS MODULE IS THE ONLY PLACE THAT BUILDS OR PARSES A KEYSTORE ACCOUNT STRING.
 * Nothing else may construct `${familyId}:${memberId}` or reference the legacy
 * bare-familyId address — that is what keeps a future migration from silently orphaning
 * blobs. Other modules reclaim storage through `nativeReclaimFamilyKeystore` (one
 * family) or `nativeReclaimAllKeystores` (the explicit clear-all).
 *
 * THE KEYCHAIN, NOT INDEXEDDB, IS THE DURABLE INDEX OF KEY MATERIAL (#82). On iOS the
 * items outlive an app uninstall while the IndexedDB registry dies with the app, so the
 * registry alone could not see a reinstall's own blobs and nothing could delete them.
 * Since the account encodes both ids, `listAccounts` recovers every pair, and the fix is
 * ADOPTION rather than deletion: orphans are written back into the registry, after which
 * every deletion path the product advertises reaches them. Reclaim therefore works from
 * the UNION of registry records and enumerated blobs, so an unavailable enumeration
 * degrades to today's behaviour instead of orphaning or over-deleting.
 *
 * Adoption runs at exactly THREE named seams and nowhere else. Two are login surfaces —
 * `nativeResolveDeviceKeys` and `nativeUnlock` — and share ONE per-session time budget,
 * because on native the family picker mounts at launch. The third is
 * `nativeReconcileRoster`, which awaits adoption UNBOUNDED: it runs after the pod is
 * open with nothing waiting on it, and on a fresh reinstall the roster arrives before
 * any login surface has resolved keys, so a bounded wait there could lose the very
 * targets it exists to reconcile. Nothing else may trigger adoption — a hidden
 * enumeration inside `readNativeRecords` would fire from unlock, from disable, and from
 * inside a reclaim about to delete the records being adopted.
 */

import { BiometricKeystore, type BiometricKeystoreErrorCode } from './biometricKeystorePlugin';
import * as passkeyRepo from '@/services/indexeddb/repositories/passkeyRepository';
import type { PasskeyRegistration } from '@/types/models';
import type { RegisterPasskeyParams, RegisterPasskeyResult } from './passkeyService';
// NOTE: RegisterPasskeyParams/Result + AuthenticatePasskeyParams/Result are imported
// TYPE-ONLY (erased at compile time) so this module and passkeyService.ts do not form
// a runtime import cycle. All shared runtime helpers live in the leaf `biometricShared`.
import type { AuthenticatePasskeyResult } from './passkeyService';
import { exportFamilyKey, importFamilyKey } from '@/services/crypto/familyKeyService';
import { bufferToBase64, base64ToBuffer } from '@/utils/encoding';
import { toISODateString } from '@/utils/date';
import { raceTimeout } from '@/utils/timing';
import { getPlatform } from '@/services/sync/capabilities';
import { reportError } from '@/utils/errorReporter';
import { logEvent } from '@/services/telemetry/logEvent';
import {
  isBiometricOfferSuppressed,
  suppressBiometricOffer,
  clearBiometricSuppression,
  describeAuthError,
  guessAuthenticatorLabel,
  MEMBER_MISMATCH,
  tr,
} from './biometricShared';

const SURFACE = 'native-biometric';

/** Synthetic credentialId for the device-local record (one per member per device). */
function nativeCredentialId(familyId: string, memberId: string): string {
  return `native:${familyId}:${memberId}`;
}

/**
 * The keystore item address for one member on this device. The ONLY place this string
 * is built — see the module header.
 */
function keystoreAccount(familyId: string, memberId: string): string {
  return `${familyId}:${memberId}`;
}

/**
 * The pre-#76 address: one biometric-gated blob per FAMILY. Still read (and deleted) for
 * records without `keystoreScheme`; nothing writes it any more.
 */
function legacyKeystoreAccount(familyId: string): string {
  return familyId;
}

/** Read the plugin error code, defaulting anything unrecognized to 'unknown'. */
function errorCode(err: unknown): BiometricKeystoreErrorCode {
  const code = (err as { code?: string } | undefined)?.code;
  if (
    code === 'userCancel' ||
    code === 'notEnrolled' ||
    code === 'lockout' ||
    code === 'invalidated' ||
    code === 'unknown'
  ) {
    return code;
  }
  return 'unknown';
}

/**
 * Is this a MISSING plugin rather than a device without biometric hardware?
 *
 * Capacitor rejects a call to an unregistered plugin with a recognisable message, and the two
 * cases must not be collapsed: a build that shipped without the native plugin looks exactly
 * like an old phone, so `no-hardware` was reported for months while the real cause was that
 * `BiometricKeystorePlugin.swift` had never been added to the Xcode target (#74). One is a
 * device fact and needs no action; the other is a broken build and needs a release.
 */
function isPluginMissing(err: unknown): boolean {
  const message = (err as { message?: string } | undefined)?.message ?? '';
  return /not implemented|unimplemented|not available|no such (?:plugin|module)/i.test(message);
}

/** Bounded diagnostic detail — never a raw object/PII. */
function detailOf(err: unknown): string {
  return describeAuthError(err).slice(0, 200);
}

// --- Removing key material: one target type, one delete, one purge ---

/**
 * One thing to remove: the OS blob, and every registry record that points at it.
 *
 * `credentialIds` is a LIST, not one id, because more than one record can resolve to the
 * same account: two legacy-scheme records for a family both address the bare familyId.
 * Targets are keyed by account, so a single-id field silently dropped the second record's
 * id and left that record behind pointing at a blob that had just been deleted. The
 * pre-#82 code could not hit that, because it looped records and removed each one.
 */
interface KeystoreTarget {
  account: string;
  credentialIds?: string[];
}

/**
 * Delete ONE blob. Returns whether it is provably gone. NEVER silent.
 *
 * This replaces the two bare `catch {}` swallows that used to sit around `deleteKey`.
 * Both plugins resolve `deleteKey` for an account that has no item, so a `false` here
 * means the OS refused — not that there was nothing to do. Key material that will not
 * delete is now always visible in the firehose (#82).
 */
async function deleteBlob(account: string, action: string): Promise<boolean> {
  try {
    await BiometricKeystore.deleteKey({ account });
    return true;
  } catch (err) {
    logEvent({
      level: 'warn',
      surface: SURFACE,
      message: 'blob_delete_failed',
      context: { os: getPlatform(), action, error_code: errorCode(err), detail: detailOf(err) },
    });
    return false;
  }
}

/**
 * The pinned shape of a purge's `detail` field. One function, one test, one place to
 * change deliberately: a hand-written template literal at the emit site is a structure
 * encoded inside a free-text field, and reordering it silently empties every saved
 * CloudWatch query built on it.
 */
function formatPurgeDetail(targets: number, failed: number): string {
  return `targets=${targets},failed=${failed}`;
}

/** Ditto for the whole-service sweep. Every `detail` in this module is built by one of these. */
function formatSweepDetail(deleted: boolean): string {
  return `deleted=${String(deleted)}`;
}

/**
 * Remove a set of targets: the blob always, the registry record when the target carries
 * a `credentialId`. THE one implementation of "make this key material go away" — disable,
 * the unlock self-heal and family reclaim all funnel through here, so none of them can
 * drift in ordering, level or wording.
 *
 * Emits exactly ONE summary event per call (warn if anything survived), which is why no
 * caller writes a log line for a purge. Returns how many blobs are provably gone.
 *
 * Per target the record is removed BEFORE the blob — the order `clearNativeRecord` has
 * always used — and a failure on one target is counted without aborting the rest. Because
 * the work is per target there is no "which half ran first" question to get wrong.
 */
async function purgeTargets(targets: KeystoreTarget[], action: string): Promise<number> {
  let deleted = 0;
  for (const t of targets) {
    for (const credentialId of t.credentialIds ?? []) {
      try {
        await passkeyRepo.removePasskeyRegistration(credentialId);
      } catch (err) {
        // A record that will not delete means a self-heal that did not heal: the user
        // keeps being offered an enrolment that cannot work.
        logEvent({
          level: 'warn',
          surface: SURFACE,
          message: 'clear_record_failed',
          context: { os: getPlatform(), action: 'remove_registration', detail: detailOf(err) },
        });
      }
    }
    if (await deleteBlob(t.account, action)) deleted += 1;
  }
  const failed = targets.length - deleted;
  logEvent({
    level: failed > 0 ? 'warn' : 'info',
    surface: SURFACE,
    message: 'purge_result',
    context: {
      os: getPlatform(),
      action,
      count: deleted,
      detail: formatPurgeDetail(targets.length, failed),
    },
  });
  return deleted;
}

// --- Enumerating what the device actually holds ---

/**
 * A keychain item this device holds. `memberId: null` means the legacy family-wide
 * address. `malformed` means the account does not parse into the scheme this module
 * writes, so it must never be ADOPTED (we cannot know whose key it is) while still
 * being reclaimable under the family its prefix names.
 */
interface KeystoreBlob {
  account: string;
  familyId: string;
  memberId: string | null;
  malformed: boolean;
}

/**
 * A blob this session adopted into the registry. Deletable by the roster pass — and ONLY
 * ever against the roster of its OWN `familyId`, which is why the family is part of the
 * type rather than a caller's assumption. Adoption spans every family on the device, so
 * a bare account string here would let one family's roster delete another family's live
 * enrolment; with `familyId` on the type, that version cannot be written.
 */
interface AdoptedTarget extends KeystoreTarget {
  familyId: string;
  memberId: string;
  /** Exactly the one record adoption wrote, kept separately for the name backfill. */
  credentialId: string;
}

/**
 * Split an account back into its ids. The inverse of `keystoreAccount` /
 * `legacyKeystoreAccount`, and it lives here because this module is the only place that
 * knows the address format (see the module header).
 *
 * Splits on the FIRST colon: family and member ids are UUIDs and contain none, so a
 * second colon means something wrote an address this module did not. Such an account is
 * read as "belongs to the family before the first colon" — the only claim the string
 * actually supports, and the reading that keeps family-scoped reclaim able to remove it.
 */
function parseKeystoreAccount(account: string): KeystoreBlob {
  const i = account.indexOf(':');
  if (i < 0) {
    // The legacy family-wide form. An empty account is not a family id, so it is flagged
    // rather than treated as a legacy blob for a family called "".
    return { account, familyId: account, memberId: null, malformed: account === '' };
  }
  const familyId = account.slice(0, i);
  const memberId = account.slice(i + 1);
  return {
    account,
    familyId,
    memberId,
    malformed: familyId === '' || memberId === '' || memberId.includes(':'),
  };
}

/**
 * Every account under our service, or `null` when the QUERY FAILED or is unavailable.
 *
 * The `null` is the point: it keeps "there are no items" distinct from "we could not
 * ask", and every caller treats the latter as contributing nothing rather than as
 * evidence of absence. An empty list that meant both would be the 0.13R2 bug again.
 */
async function listKeystoreBlobs(): Promise<KeystoreBlob[] | null> {
  try {
    const { accounts } = await BiometricKeystore.listAccounts();
    return accounts.map(parseKeystoreAccount);
  } catch (err) {
    if (isPluginMissing(err)) {
      // Android (no enumeration needed there — see the plugin interface) or a Swift
      // method absent from `pluginMethods`. Deliberately NOT the `plugin-missing`/`error`
      // pair `nativeCanEnroll` uses, so this cannot pollute the #74 signal.
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'keystore_enumerate_unsupported',
        context: { os: getPlatform(), action: 'enumerate_unsupported', error_code: errorCode(err) },
      });
      return null;
    }
    reportError({
      surface: SURFACE,
      message: 'keystore enumerate failed — reclaim degrades to registry-only',
      error: err,
      severity: 'warning',
      context: {
        os: getPlatform(),
        action: 'enumerate_failed',
        error_code: errorCode(err),
        detail: detailOf(err),
      },
    });
    return null;
  }
}

// --- Adoption: making orphaned material visible again ---

/** The ONE shape of a device-local native-keystore record. */
function nativeRecord(p: {
  familyId: string;
  memberId: string;
  memberName?: string;
  label: string;
}): PasskeyRegistration {
  return {
    credentialId: nativeCredentialId(p.familyId, p.memberId),
    memberId: p.memberId,
    familyId: p.familyId,
    publicKey: '',
    prfSupported: false,
    mechanism: 'native-keystore',
    label: p.label,
    memberName: p.memberName,
    keystoreScheme: 'per-member',
    createdAt: toISODateString(new Date()),
  };
}

interface AdoptionSummary {
  /** Blobs the keychain returned. */
  enumerated: number;
  /** Blobs that had no registry record and now have one. */
  adopted: number;
  /**
   * Native records ALREADY in the registry before this pass. Reported in the same event
   * as `enumerated` on purpose: `enumerated=0` with `registered>0` is a self-proving
   * contradiction — records exist, therefore blobs must exist, therefore the query is
   * excluding them. That is the 0.13R2 failure visible in one log line, per device,
   * rather than a fleet-wide count somebody has to eyeball.
   */
  registered: number;
  /** Legacy family-wide blobs: enumerable and reclaimable, never adoptable. */
  legacy: number;
  malformed: number;
  adoptedTargets: AdoptedTarget[];
}

function emptyAdoption(): AdoptionSummary {
  return { enumerated: 0, adopted: 0, registered: 0, legacy: 0, malformed: 0, adoptedTargets: [] };
}

/** Pinned `detail` shape — same reasoning as `formatPurgeDetail`. */
function formatAdoptionDetail(s: AdoptionSummary): string {
  return `adopted=${s.adopted},registered=${s.registered},legacy=${s.legacy},malformed=${s.malformed}`;
}

/**
 * Spent ONCE per session in total, not once per caller. `FamilyPickerView.loadFamilies()`
 * awaits `resolveDeviceKeys` per family in a SEQUENTIAL loop, and on native that mount is
 * app launch — so a per-caller timer would cost budget × familyCount before first paint.
 * Keychain IPC is single-digit ms in practice; this is the ceiling on a pathological
 * device, and `awaitAdoptionGate` memoizes the raced promise so it is a session total.
 */
const ADOPTION_BUDGET_MS = 1500;

let adoption: Promise<AdoptionSummary> | null = null;
let adoptionGate: Promise<void> | null = null;
let adoptedTargets: AdoptedTarget[] = [];
/** Bumped by the test reset so an in-flight pass cannot write into the next session. */
let sessionGeneration = 0;

/**
 * Adopt every orphaned blob on this device into the registry.
 *
 * This is the fix for #82, and it is ADOPTION rather than deletion on purpose. Once a
 * blob is back in the registry, every deletion path the product already advertises
 * reaches it — so "beyond any code path" is cured without deleting anything, and a
 * legitimate reinstaller keeps their biometric unlock instead of being silently broken.
 * Adoption only makes material VISIBLE; it grants no access the device's owner did not
 * already have, since the blob is still biometry-gated.
 *
 * Runs for every family at once, which is what makes it one enumeration per session
 * instead of one per family per picker render. The all-families scope is safe precisely
 * because nothing here deletes — but it is why the roster pass must re-narrow to one
 * family (see `takeAdoptedTargets`).
 *
 * NEVER REJECTS. That single contract is what makes the un-awaited tail of
 * `awaitAdoptionGate` safe (no unhandled rejection with no owner), makes it safe to await
 * unbounded from the roster pass, and is pinned by a test.
 *
 * Note for future edits: `runAdoptionPass()` runs its synchronous prefix BEFORE `adoption`
 * is assigned, so anything added to that prefix which reaches back into
 * `ensureKeystoreAdopted` / `awaitAdoptionGate` would recurse rather than dedupe. Nothing
 * does today; keep it that way.
 */
function ensureKeystoreAdopted(): Promise<AdoptionSummary> {
  const generation = sessionGeneration;
  return (adoption ??= runAdoptionPass()
    .then((summary) => {
      // Generation-checked: `__resetKeystoreSessionForTests` can null the refs while a
      // pass is still in flight, and that pass still holds this closure. Without the
      // check, test N's slow-but-resolving pass assigns targets during test N+1.
      if (generation === sessionGeneration) adoptedTargets = summary.adoptedTargets;
      return summary;
    })
    .catch((err) => {
      // Defence in depth: every step inside the pass already handles its own failure, so
      // reaching here means a bug rather than an expected condition. Report it and hand
      // back an empty summary; callers behave exactly as they do today.
      reportError({
        surface: SURFACE,
        message: 'keystore adoption pass threw',
        error: err,
        severity: 'warning',
        context: { os: getPlatform(), action: 'adopt_failed', detail: detailOf(err) },
      });
      return emptyAdoption();
    }));
}

/**
 * Wait for adoption — but never for more than `ADOPTION_BUDGET_MS` in TOTAL per session.
 * The RACED promise is memoized, so N callers share one budget instead of arming N
 * timers. On timeout the pass keeps running and later callers see its results.
 */
function awaitAdoptionGate(): Promise<void> {
  return (adoptionGate ??= raceTimeout(ensureKeystoreAdopted(), ADOPTION_BUDGET_MS).then(
    () => undefined
  ));
}

async function runAdoptionPass(): Promise<AdoptionSummary> {
  const blobs = await listKeystoreBlobs();
  // null = failed or unavailable, and already reported. Nothing to adopt, and crucially
  // no deletion anywhere in this module is driven by an absent enumeration.
  if (!blobs) return emptyAdoption();

  let existing: PasskeyRegistration[];
  try {
    existing = await passkeyRepo.getAllPasskeys();
  } catch (err) {
    // Abort adoption and leave today's behaviour exactly as it is: without knowing what
    // is already registered we would write duplicates.
    logEvent({
      level: 'warn',
      surface: SURFACE,
      message: 'adopt_registry_read_failed',
      context: { os: getPlatform(), action: 'adopt_registry_read_failed', detail: detailOf(err) },
    });
    return emptyAdoption();
  }

  const known = new Set(existing.map((r) => r.credentialId));
  const summary: AdoptionSummary = {
    ...emptyAdoption(),
    enumerated: blobs.length,
    registered: existing.filter((r) => r.mechanism === 'native-keystore').length,
  };

  for (const b of blobs) {
    if (b.malformed) {
      summary.malformed += 1;
      continue;
    }
    if (b.memberId === null) {
      // A legacy account encodes no member, and `PasskeyRegistration.memberId` is
      // required, so there is no record to construct — any of N members could own it.
      // Counted, left to the reclaim and sweep paths, never guessed at.
      summary.legacy += 1;
      continue;
    }
    const credentialId = nativeCredentialId(b.familyId, b.memberId);
    if (known.has(credentialId)) continue;
    try {
      await passkeyRepo.savePasskeyRegistration(
        nativeRecord({
          familyId: b.familyId,
          memberId: b.memberId,
          // Nothing on the device knows the member's name yet (the roster died with the
          // app). `idTail` keeps two adopted cards distinguishable and honest until the
          // pod opens and the roster pass backfills the real name.
          label: `${guessAuthenticatorLabel()} · ${idTail(b.memberId)}`,
        })
      );
      summary.adopted += 1;
      summary.adoptedTargets.push({
        account: b.account,
        credentialId,
        credentialIds: [credentialId],
        familyId: b.familyId,
        memberId: b.memberId,
      });
    } catch (err) {
      // One bad write must not abandon the rest of the device's material.
      logEvent({
        level: 'warn',
        surface: SURFACE,
        message: 'adopt_write_failed',
        context: { os: getPlatform(), action: 'adopt_write_failed', detail: detailOf(err) },
      });
    }
  }

  // ONE event, level computed. Two emissions for one fact would double-count the
  // interesting passes in any CloudWatch count of them.
  logEvent({
    level: summary.adopted > 0 ? 'warn' : 'info',
    surface: SURFACE,
    message: 'keystore_adopted',
    context: {
      os: getPlatform(),
      action: 'adopt',
      count: summary.enumerated,
      detail: formatAdoptionDetail(summary),
    },
  });
  return summary;
}

/**
 * Drain this session's adopted targets FOR ONE FAMILY, removing them from the set.
 *
 * Per family, not wholesale: adoption spans every family on the device, so draining
 * everything and testing it against one family's roster would delete every other
 * family's adopted enrolment — their member ids are of course not in this family's
 * roster. An empty result means both "nothing was adopted for this family" and "this
 * family was already reconciled", which is why no second flag is needed.
 */
function takeAdoptedTargets(familyId: string): AdoptedTarget[] {
  const mine = adoptedTargets.filter((t) => t.familyId === familyId);
  adoptedTargets = adoptedTargets.filter((t) => t.familyId !== familyId);
  return mine;
}

/**
 * Reset the module's session state. Test-only, following the house convention
 * (`__resetPinAttemptsForTests` and friends) — the single-flight, the gate and the
 * adopted set are module-level and do not reset between cases in one test file.
 */
export function __resetKeystoreSessionForTests(): void {
  sessionGeneration += 1;
  adoption = null;
  adoptionGate = null;
  adoptedTargets = [];
}

// --- Availability / gating ---

/**
 * Can the user enroll native biometric on this device? (hardware present + enrolled).
 * Deliberately does NOT consult the proactive-offer suppression — this is what the
 * deliberate Settings enroll surface (`canEnrollBiometric`) calls, so a prior
 * transient decline never locks Settings out. Mirrors the web `canEnrollBiometric`.
 */
export async function nativeCanEnroll(): Promise<boolean> {
  try {
    const { available } = await BiometricKeystore.isAvailable();
    return available;
  } catch (err) {
    // A plugin-bridge throw is not a user-facing failure — log and treat as "can't offer".
    // A MISSING plugin is reported at `error`, and as its own action, because it means this
    // build cannot do biometric at all: it is a release defect, not a device limitation, and
    // reporting it as `no-hardware` is what hid #74.
    const missing = isPluginMissing(err);
    logEvent({
      level: missing ? 'error' : 'warn',
      surface: SURFACE,
      message: missing ? 'native biometric plugin missing from this build' : 'availability',
      context: {
        os: getPlatform(),
        action: missing ? 'plugin-missing' : 'no-hardware',
        detail: detailOf(err),
      },
    });
    return false;
  }
}

/**
 * Whether to PROACTIVELY offer native biometric (App.vue's post-sign-in nag).
 * Same capability as `nativeCanEnroll()` but also respects the self-healing
 * per-device suppression. Mirrors the web `canOfferBiometric`.
 */
export async function nativeCanOffer(): Promise<boolean> {
  if (isBiometricOfferSuppressed()) return false;
  return nativeCanEnroll();
}

/**
 * Native semantics of `resolveDeviceKeys(familyId)`: WHICH members can this device sign
 * in? Registry-only (no biometric prompt) because it runs on every family selection and
 * every picker render. Supersedes the old `nativeHasRegistered` boolean, so the five
 * "is biometric available?" call sites cannot drift apart — there is now one answer.
 *
 * Also the single site that opportunistically drops any STALE WebAuthn-mechanism record
 * for this family (migration — no native WebAuthn credential ever succeeded), so a stale
 * record neither drives an unlock nor suppresses the fresh Keystore enrollment offer.
 */
export async function nativeResolveDeviceKeys(familyId: string): Promise<PasskeyRegistration[]> {
  // Adopted records must be IN the registry before the read below, or a reinstaller's
  // own material stays invisible for one more session. Bounded, because the family
  // picker mounts at launch on native and a keychain IPC must never hold first paint —
  // and bounded ONCE per session, not once per caller (see ADOPTION_BUDGET_MS).
  await awaitAdoptionGate();
  return readNativeRecords(familyId);
}

/**
 * The registry read plus the stale-record cleanup, and nothing else. Split out of
 * `nativeResolveDeviceKeys` so adoption fires at two NAMED seams instead of implicitly
 * from unlock, from disable, and from inside a reclaim that is about to delete the very
 * records being adopted — this function is reached by all of those.
 */
async function readNativeRecords(familyId: string): Promise<PasskeyRegistration[]> {
  let records: PasskeyRegistration[];
  try {
    records = await passkeyRepo.getPasskeysByFamily(familyId);
  } catch (err) {
    // A broken registry read must NOT look like "no key enrolled" — that ambiguity is
    // what hid #74. Callers still degrade to the password, but we can see why.
    logEvent({
      level: 'warn',
      surface: SURFACE,
      message: 'registry_read_failed',
      context: { os: getPlatform(), action: 'registry_read_failed', detail: detailOf(err) },
    });
    return [];
  }
  // Best-effort cleanup of stale non-native records (idempotent).
  for (const r of records) {
    if (r.mechanism !== 'native-keystore') {
      try {
        await passkeyRepo.removePasskeyRegistration(r.credentialId);
      } catch {
        /* best-effort */
      }
    }
  }
  return records.filter((r) => r.mechanism === 'native-keystore');
}

// --- Enable ---

/**
 * ENABLE native biometric for the current member/family. Exports the (extractable)
 * family key to raw bytes, wraps them behind a live biometric via the plugin, and —
 * only on success — persists a device-local `native-keystore` record for THIS member.
 * Returns the shared `RegisterPasskeyResult`; `passkeySecret` is undefined (device-local,
 * no envelope write), so App.vue's `if (result.passkeySecret)` guard skips the sync write.
 *
 * Since #76 this no longer purges the family's other native records: the credentialId is
 * deterministic, so `savePasskeyRegistration` already overwrites a re-enrol by the SAME
 * member, and siblings must survive so two members can share a device. It also does not
 * touch the legacy blob — a cross-member condition there could delete a live key. A
 * re-enrol writes `keystoreScheme: 'per-member'`, which is how a legacy record moves to
 * the new address; the old blob is reclaimed on family delete.
 *
 * User cancel is NOT a failure (no suppression, no report). A hard error suppresses
 * the proactive offer (cool-off) + reports a `warning` + friendly message; no record
 * is written unless the wrap succeeded (no half state).
 */
export async function nativeEnable(params: RegisterPasskeyParams): Promise<RegisterPasskeyResult> {
  const { memberId, memberName, familyId, familyKey, label } = params;
  const os = getPlatform();
  let raw: Uint8Array | null = null;
  try {
    raw = await exportFamilyKey(familyKey);
    const keyB64 = bufferToBase64(raw);
    const { keyBacking } = await BiometricKeystore.setKey({
      account: keystoreAccount(familyId, memberId),
      keyB64,
    });

    // One factory, shared with adoption: a required field added to one record literal
    // and not the other is a silent half-record.
    await passkeyRepo.savePasskeyRegistration(
      nativeRecord({ familyId, memberId, memberName, label: label || guessAuthenticatorLabel() })
    );
    clearBiometricSuppression();

    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'enable_result',
      context: { os, action: 'ok', key_backing: keyBacking },
    });
    return { success: true, prfSupported: false, passkeySecret: undefined };
  } catch (err) {
    const code = errorCode(err);
    if (code === 'userCancel') {
      // Deliberate gesture — not a failure. No suppression, no report.
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'enable_result',
        context: { os, action: 'user_cancel' },
      });
      return { success: false, cancelled: true, error: cancelMessage() };
    }
    suppressBiometricOffer();
    reportError({
      surface: SURFACE,
      message: 'native biometric enable failed',
      error: err,
      severity: 'warning',
      context: { os, action: 'enable', error_code: code, detail: detailOf(err) },
    });
    return { success: false, error: friendlyError(code) };
  } finally {
    // Zero the exported raw bytes; the transient base64 string is immutable and
    // stays in the narrowest scope above (covered by the rooted-device caveat).
    if (raw) raw.fill(0);
  }
}

// --- Unlock ---

/**
 * UNLOCK a SPECIFIC member's key and return the family key + that member. `memberId` is
 * required, not optional: every caller knows who it is asking for, and an optional
 * selector on a security primitive is an invitation to a null-member unlock.
 *
 * Resolution order:
 *  1. This member's record says which address its key lives at (`recordAccount`) — the
 *     per-member item since #76, the legacy family-keyed one for a pre-#76 record. That
 *     address is read AS-IS; nothing is inferred and nothing is moved.
 *  2. No record for this member → `MEMBER_MISMATCH`, no prompt.
 *  3. A record whose blob the OS has wiped → the `absent_self_heal` path.
 *
 * A legacy blob is NEVER re-homed at the per-member address. An earlier version of this
 * comment described exactly that ("prompt once, then silently re-home"); the body never
 * did it, and it must not — `recordAccount` below records why at length (on Android
 * `setKey` fires a SECOND BiometricPrompt, and a dismissal leaves the old blob behind, so
 * the double prompt returns on every sign-in). A legacy record moves to the new scheme
 * when that member re-enrols, and not before.
 *
 * A member with no record on this device gets `MEMBER_MISMATCH` with NO prompt, and
 * deliberately not the re-enrol copy, which would wrongly tell a healthy user their
 * biometrics had changed.
 */
export async function nativeUnlock(
  familyId: string,
  memberId: string
): Promise<AuthenticatePasskeyResult> {
  const os = getPlatform();
  // The other place a missing adopted record produces a WRONG ANSWER (a spurious
  // MEMBER_MISMATCH) rather than merely a stale list. Bounded via the shared gate, not
  // the raw single-flight: a hung enumeration awaited unbounded here would wedge the
  // unlock button, which is exactly the 0.9.5R3 "verifying" freeze `raceTimeout` exists
  // to prevent. In the normal flow `resolveDeviceKeys` has already run, so the gate is
  // settled and this is free; in the pathological case the degrade is MEMBER_MISMATCH →
  // password, which is today's outcome for an un-adopted blob anyway.
  await awaitAdoptionGate();
  const record = await loadNativeRecord(familyId, memberId);
  if (!record) {
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'unlock_result',
      context: { os, action: 'member_mismatch', member_id_tail: idTail(memberId) },
    });
    return { success: false, error: MEMBER_MISMATCH };
  }

  // The record says where its key lives, so there is nothing to infer.
  const readFrom = recordAccount(familyId, record);

  // Presence check — never prompts. Its ONLY job is to catch "the OS wiped this key"
  // (biometrics changed, passcode removed) so we can self-heal instead of firing a doomed
  // prompt. A THROW here must not be treated as absence: on Android a transient KeyStore
  // failure would otherwise delete a perfectly good enrolment, which is far more
  // destructive than the doomed prompt this check exists to avoid.
  try {
    const { present } = await BiometricKeystore.hasKey({ account: readFrom });
    if (!present) {
      await clearNativeRecord(familyId, memberId, 'absent_self_heal');
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'unlock_result',
        context: { os, action: 'absent_self_heal', detail: recordScheme(record) },
      });
      return { success: false, error: reEnrollMessage() };
    }
  } catch (err) {
    // Fall through to the real unlock, which handles errors properly — but say so, or a
    // flaky presence probe is invisible.
    logEvent({
      level: 'warn',
      surface: SURFACE,
      message: 'unlock_result',
      context: { os, action: 'haskey_failed', error_code: errorCode(err) },
    });
  }

  try {
    const { keyB64, keyBacking } = await BiometricKeystore.getKey({ account: readFrom });
    const familyKey = await importFamilyKey(new Uint8Array(base64ToBuffer(keyB64)));

    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'unlock_result',
      context: { os, action: 'ok', key_backing: keyBacking },
    });
    return { success: true, memberId: record.memberId, familyKey };
  } catch (err) {
    const code = errorCode(err);
    if (code === 'userCancel') {
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'unlock_result',
        context: { os, action: 'user_cancel' },
      });
      return { success: false, cancelled: true, error: cancelMessage() };
    }
    if (code === 'invalidated') {
      // A genuine OS invalidation is DEVICE-wide (a new fingerprint enrolled, the passcode
      // removed), so every native record for this family is equally dead — clearing only
      // one would leave siblings listed by `nativeResolveDeviceKeys` and rendered as dead
      // buttons on the chooser.
      await nativeReclaimFamilyKeystore(familyId);
    }
    // NOT `notEnrolled`: Android maps ERROR_HW_UNAVAILABLE onto it, which is transient
    // (sensor busy, temporarily unavailable). Wiping the whole family's enrolments because
    // a fingerprint reader was momentarily busy is a far worse outcome than one failed
    // unlock, and the no-prompt `hasKey` probe already self-heals genuinely absent keys on
    // the next attempt. So: show the re-enrol message, delete nothing.
    reportError({
      surface: SURFACE,
      message: 'native biometric unlock failed',
      error: err,
      severity: 'warning',
      context: { os, action: 'unlock', error_code: code, detail: detailOf(err) },
    });
    return {
      success: false,
      error:
        code === 'invalidated' || code === 'notEnrolled' ? reEnrollMessage() : friendlyError(code),
    };
  }
}

// --- Disable ---

/**
 * DISABLE one member's enrolment: delete their OS blob + device-local record. Idempotent.
 * Takes `(familyId, memberId)` rather than a credentialId because the credentialId is
 * DERIVED from that pair here — handing a caller a value this module already owns would
 * put the id format in two places.
 */
export async function nativeDisable(familyId: string, memberId: string): Promise<void> {
  await clearNativeRecord(familyId, memberId, 'disable');
}

/**
 * Reclaim ALL keystore storage for a family on this device — every member's blob plus
 * the legacy family-keyed one. The only route by which another module may reclaim
 * keystore storage, so no other file needs to know how an account is addressed.
 * Used by `deleteLocalFamily` and by the device-wide OS-invalidation path.
 */
export async function nativeReclaimFamilyKeystore(familyId: string): Promise<void> {
  // THE UNION IS THE WHOLE TRICK, and it is why there is no "if the enumeration failed,
  // fall back to registry-only" branch: a failed or empty enumeration contributes zero
  // members, which IS the fallback — expressed as data, one code path, nothing to
  // forget, and monotonically >= today's behaviour on every platform. It also keeps the
  // converse hole closed: a purely keychain-driven reclaim would stop removing registry
  // records whose blob the OS already wiped, leaving dead records that render as dead
  // buttons on the chooser.
  //
  // Enumerating per call is deliberate and is NOT a violation of "one enumeration per
  // session" (that budget is adoption's): a session-old list could miss a blob written
  // since, and this is a rare, user-initiated or invalidation-driven path.
  const blobs = await listKeystoreBlobs();
  const byAccount = new Map<string, KeystoreTarget>();
  for (const b of blobs ?? []) {
    // Filtered by family: this function never touches another family's material, which
    // is what lets `deleteLocalFamily` keep its name honest.
    if (b.familyId === familyId) byAccount.set(b.account, { account: b.account });
  }
  // Records SECOND, and ACCUMULATING their credentialIds rather than replacing: a blob
  // the registry also knows about is one target, and two legacy-scheme records share one
  // account, so both ids have to survive onto it.
  for (const r of await readNativeRecords(familyId)) {
    const account = recordAccount(familyId, r);
    const existing = byAccount.get(account);
    const credentialIds = [
      ...(existing?.credentialIds ?? []),
      nativeCredentialId(familyId, r.memberId),
    ];
    byAccount.set(account, { account, credentialIds });
  }
  // The legacy blob is always a target, whether or not a record points at it. Added only
  // when absent: a legacy-SCHEME record already occupies this account key and carries the
  // credentialId, and overwriting it with a bare target would leave that record behind.
  const legacy = legacyKeystoreAccount(familyId);
  if (!byAccount.has(legacy)) byAccount.set(legacy, { account: legacy });

  // Drop this family's adopted targets: their blobs and records are about to be gone, and
  // a later roster pass draining them would emit a `roster_reconcile` purge that reads as
  // real key removal when nothing was there. Discard the result — these are targets, not
  // survivors.
  takeAdoptedTargets(familyId);

  await purgeTargets([...byAccount.values()], 'reclaim');
}

/**
 * The explicit clear-all primitive: remove EVERY blob for our service on this device,
 * including families this device will never open again. Sole permitted caller of
 * `BiometricKeystore.deleteAllKeys()`.
 *
 * `familyIds` is a defence-in-depth FALLBACK list, not the mechanism. The sweep itself
 * needs no registry and no enumeration. But a `@objc func` that exists and was never
 * added to `pluginMethods` rejects as not-implemented — that is #74, which this repo has
 * lived through twice — and in such a build the caller would delete the registry records,
 * tell the user their data was cleared, and leave every blob on the device with nothing
 * left that knows its address. Strictly worse than the per-family loop this replaced. So
 * on ANY rejection we report it and fall back to the union reclaim per family, which uses
 * only the long-shipped `deleteKey`. That makes the outcome >= today's on every build.
 *
 * Never throws: the caller is a sign-out step, and a thrown sweep would be caught one
 * level up and reported as a step failure with no statement of what survived.
 */
export async function nativeReclaimAllKeystores(familyIds: string[]): Promise<void> {
  // Everything on the device is going, so no adopted target can still be a real target.
  adoptedTargets = [];
  try {
    const { deleted } = await BiometricKeystore.deleteAllKeys();
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'keystore_swept',
      context: { os: getPlatform(), action: 'sweep', detail: formatSweepDetail(deleted) },
    });
    return;
  } catch (err) {
    reportError({
      surface: SURFACE,
      message: 'keystore sweep unavailable — falling back to per-family reclaim',
      error: err,
      severity: 'warning',
      context: {
        os: getPlatform(),
        action: 'sweep_failed',
        error_code: errorCode(err),
        count: familyIds.length,
        detail: detailOf(err),
      },
    });
  }
  // The fallback list comes from the registry, and in the very scenario this whole change
  // exists for the registry can be EMPTY (a reinstall where adoption never ran, or a
  // failed registry read). Looping zero families would then report a clean device while
  // every blob survived, which is the same lie one layer down. So derive the families
  // from the keychain itself when the caller's list is empty.
  let targets = familyIds;
  if (targets.length === 0) {
    const blobs = await listKeystoreBlobs();
    targets = [...new Set((blobs ?? []).map((b) => b.familyId))];
    logEvent({
      level: targets.length > 0 ? 'warn' : 'info',
      surface: SURFACE,
      message: 'sweep_fallback_enumerated',
      context: { os: getPlatform(), action: 'sweep_fallback', count: targets.length },
    });
  }
  for (const id of targets) {
    await nativeReclaimFamilyKeystore(id);
  }
}

/**
 * Requirement 4 of #82, deliberately narrow: a member absent from the live roster has no
 * surviving blob — for THIS family, and never for any other family on the device.
 *
 * Only this session's ADOPTED targets for `familyId` are deletable here. A blob that was
 * legitimately registered before this session can never be deleted by this path, and
 * neither can another family's, because `takeAdoptedTargets` drains per family and
 * `AdoptedTarget` carries the family it belongs to. That scoping is not decoration: with
 * a bare account string and a wholesale drain, a device holding families A and B would
 * lose B's grandparent's enrolment the moment A's roster arrived, reported as a
 * successful reconcile.
 *
 * This is also the only case requirement 4 actually needs.
 * `familyStore.invalidateDeviceCredentials` → `removeAllPasskeysForMember` already
 * retires a member's credentials at removal time, so the sole gap is a member removed
 * WHILE THE APP WAS UNINSTALLED.
 *
 * Same pass, non-destructive half: an adopted record whose member IS on the roster gets
 * its `memberName` backfilled, so the id-tail label adoption had to invent is seen at
 * most once per reinstall. Adoption never writes a name, so for these targets the field
 * is absent by construction; the one case where it is not is a re-enrol in this same
 * session, which wrote this very roster's name anyway.
 */
export async function nativeReconcileRoster(
  familyId: string,
  roster: { id: string; name: string }[]
): Promise<void> {
  // THIS AWAIT IS LOAD-BEARING, and it is the UNBOUNDED single-flight rather than the
  // time-bounded gate. Adoption is lazy, and on the primary #82 path it has NOT run when
  // this fires: after a reinstall the family registry is gone too, so the family picker
  // loops zero families and `resolveDeviceKeys` is never called before decrypt. The
  // roster then arrives first, and a reconcile that assumed adoption had finished would
  // drain an empty set and return — and nothing would ever retry, because a later session
  // finds those blobs already registered, adopts nothing, and produces no targets. So
  // requirement 4 and the name backfill would silently never run for the exact scenario
  // this plan was written for.
  //
  // Unbounded is correct here where it would be wrong at the login seams: this runs
  // fire-and-forget from a roster watcher AFTER the pod is open, so nothing is waiting on
  // it, and the bounded gate could resolve early and lose the targets the same way.
  // `ensureKeystoreAdopted` never rejects, which is what makes awaiting it safe.
  await ensureKeystoreAdopted();

  const targets = takeAdoptedTargets(familyId);
  if (targets.length === 0) return;

  const names = new Map(roster.map((m) => [m.id, m.name]));
  const gone = targets.filter((t) => !names.has(t.memberId));
  // purgeTargets owns the summary event; an empty set must not emit one.
  if (gone.length > 0) await purgeTargets(gone, 'roster_reconcile');

  for (const t of targets) {
    const name = names.get(t.memberId);
    if (name === undefined) continue;
    try {
      await passkeyRepo.updatePasskey(t.credentialId, { memberName: name });
    } catch (err) {
      // Cosmetic, so it must not abort the pass — but not silent either: without it the
      // picker keeps showing a device label where a name belongs.
      logEvent({
        level: 'warn',
        surface: SURFACE,
        message: 'roster_backfill_failed',
        context: { os: getPlatform(), action: 'roster_backfill_failed', detail: detailOf(err) },
      });
    }
  }
}

// --- Internal helpers ---

/**
 * WHERE this record's key actually lives. Pre-#76 records have no `keystoreScheme` and
 * their key sits at the legacy family-wide address; everything since sits per member.
 *
 * We deliberately DO NOT migrate legacy blobs to the new address. It looks like free
 * housekeeping and is not: on Android `setKey` generates a fresh auth-bound key and fires
 * a SECOND BiometricPrompt (labelled "Enable biometric unlock") immediately after the one
 * the user just satisfied — and if they dismiss it, the old blob is never cleaned up, so
 * the double prompt returns on every single sign-in. Reading the legacy address forever
 * costs nothing, works on both platforms, and a legacy record moves to the new scheme
 * naturally the next time that member re-enrols.
 */
function recordAccount(familyId: string, record: PasskeyRegistration): string {
  return record.keystoreScheme === 'per-member'
    ? keystoreAccount(familyId, record.memberId)
    : legacyKeystoreAccount(familyId);
}

/** Non-identifying scheme label for telemetry. */
function recordScheme(record: PasskeyRegistration): string {
  return record.keystoreScheme === 'per-member' ? 'per_member' : 'legacy';
}

/**
 * Last 8 chars of an id — the allowlisted, non-identifying form used in telemetry.
 *
 * ALSO a UI disambiguator since #82: an adopted record has no `memberName` (nothing on
 * the device knows it yet), so its label carries this tail to keep two adopted cards on
 * the post-reinstall picker distinguishable. Shortening it for telemetry reasons would
 * silently change a rendered string.
 */
function idTail(id: string): string {
  return id.slice(-8);
}

/** One member's record, or null meaning exactly "that member has no key here". */
async function loadNativeRecord(
  familyId: string,
  memberId: string
): Promise<PasskeyRegistration | null> {
  const records = await readNativeRecords(familyId);
  return records.find((r) => r.memberId === memberId) ?? null;
}

/**
 * Drop one member's record and their OS blob.
 *
 * Deletes whichever address the record actually used — a legacy-scheme member's key is at
 * the family-wide address, and deleting only the per-member one would leave a live,
 * biometric-gated copy of the family key behind after the user explicitly removed it.
 *
 * The removal itself is `purgeTargets`, so disable and the unlock self-heal share one
 * implementation (and now emit a purge summary, which neither did before). `action` names
 * the calling path in that summary.
 */
async function clearNativeRecord(
  familyId: string,
  memberId: string,
  action: string
): Promise<void> {
  const record = await loadNativeRecord(familyId, memberId);
  const account = record ? recordAccount(familyId, record) : keystoreAccount(familyId, memberId);
  await purgeTargets(
    [{ account, credentialIds: [nativeCredentialId(familyId, memberId)] }],
    action
  );
}

// --- Friendly copy (via t() with English fallbacks) ---

function cancelMessage(): string {
  return tr('biometric.cancelled', 'Biometric was cancelled. You can sign in with your password.');
}

function reEnrollMessage(): string {
  return tr(
    'biometric.reEnroll',
    'Biometric unlock was turned off because your device biometrics changed. Sign in with your password, then turn it back on in Settings.'
  );
}

function friendlyError(code: BiometricKeystoreErrorCode): string {
  if (code === 'lockout') {
    return tr(
      'biometric.lockout',
      'Too many attempts. Please sign in with your password and try biometric again later.'
    );
  }
  if (code === 'notEnrolled') {
    return tr(
      'biometric.notEnrolled',
      "Set up your device's fingerprint or face unlock first, then you can enable biometric unlock."
    );
  }
  return tr(
    'biometric.errGeneric',
    'Something went wrong with biometric unlock. You can sign in with your password.'
  );
}
