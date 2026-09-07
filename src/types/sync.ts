/**
 * Sync-domain result types + typed errors.
 *
 * Lives here (rather than next to the code that throws) because these types
 * cross layer boundaries: the result types are returned from `syncStore`,
 * consumed by Vue components and tests; the error classes are thrown from
 * `services/crypto` and `services/sync/providers`, caught at multiple sites.
 *
 * Discriminated unions over `{ok: boolean, error?: Error}` — callers branch
 * on `reason` / `kind`, never on out-of-band store state.
 */

// The only import this module has. `@/constants/appVersion` imports nothing
// itself, so the three worker modules that reach `@/types/sync` gain one
// string constant and no dependency.
import { APP_VERSION } from '@/constants/appVersion';

// ─── createNewFile ────────────────────────────────────────────────────────

/**
 * What went wrong during `syncStore.createNewFile`.
 *
 * - `precondition` — currentDoc null, no owner member, etc. We never started.
 * - `write` — `provider.write(envelopeJson)` itself threw.
 * - `verify` — write succeeded HTTP-wise but the bytes we read back don't
 *   decrypt + `Automerge.load+materialize` cleanly. This is the Shaun-class
 *   silent-corruption case.
 * - `persist` — local IndexedDB cache write (`persistDoc` / `persistEnvelope`)
 *   failed. The Drive file is fine but the local cache won't have it.
 * - `register` — DynamoDB registry write failed. The recovery path needs this
 *   to find the file on a fresh device, so we treat it as fatal here.
 * - `concurrent-write` — another createNewFile or loadFromGoogleDrive is
 *   already in flight. Should be unreachable in well-behaved UI; surfaced
 *   as a typed reason so misuses are loud, not racy.
 * - `existing-pod` — the registry already holds a `fileId` for this family, so
 *   creating would orphan/overwrite the real pod. This is the belt-and-braces
 *   guard above the Drive-only name-collision check; it also covers the
 *   local-file path. The correct response is recovery (re-load the existing
 *   pod), not creation — see ResumePodSetup's `retry` phase.
 */
export type CreatePodFailureReason =
  | 'precondition'
  | 'write'
  | 'verify'
  | 'persist'
  | 'register'
  | 'concurrent-write'
  | 'existing-pod';

export type CreatePodResult =
  /**
   * Phase 4 (login rethink): a successful create returns the freshly generated
   * recovery kit's one-time CODE (+ its non-secret kitId) for the wizard's
   * mandatory display step. NEVER persisted — show once, then drop.
   */
  | { ok: true; kit: { kitId: string; code: string } }
  | { ok: false; reason: CreatePodFailureReason; error: Error };

// ─── In-flight critical writes ────────────────────────────────────────────

/**
 * Single source of truth for "is the app currently doing a write that can't
 * be safely interrupted?". Read by the router beforeEach guard, App.vue's
 * beforeunload handler, and `SetupProgressModal`'s visibility gate.
 */
export type CriticalWriteState =
  | { kind: 'idle' }
  | { kind: 'creating' } // syncStore.createNewFile in flight
  | { kind: 'loading' }; // syncStore.loadFromGoogleDrive (recovery) in flight

// ─── Resume-from-registry recovery ────────────────────────────────────────

/**
 * `attemptResumeFromRegistry` result.
 *
 * - `auto-loadable` — the registry has a `fileId` for this family AND we
 *   successfully fetched the envelope; password prompt is next.
 * - `no-registry-entry` — the family is unknown to the registry (genuinely
 *   never finished setup, or registry write was lost). Fall back to the
 *   current "pick storage" flow.
 * - `registry-error` — lookup threw or returned an unexpected shape.
 *   Treated as recoverable; UI falls back to pick-storage with a
 *   "couldn't reach our servers" hint.
 * - `load-failed` — registry had a fileId but the Drive load itself failed
 *   (token denied, file 404, network error). UI surfaces and offers retry
 *   / fallback.
 */
export type ResumeFromRegistryResult =
  | {
      kind: 'auto-loadable';
      familyName: string;
      lastSaved: string | null;
      fileId: string;
    }
  | { kind: 'no-registry-entry' }
  | { kind: 'registry-error'; error: Error }
  | { kind: 'load-failed'; error: Error }
  // The probe kicked off a full-page OAuth redirect (iOS/PWA, no valid token) —
  // the page is navigating to Google; the caller does nothing and we resume on
  // return (2026-06-19, finding 2: never open a gesture-less popup on iOS).
  | { kind: 'redirecting' };

/**
 * `completeAutoLoad` result — what happened when the user submitted their
 * password against the envelope `attemptResumeFromRegistry` fetched.
 *
 * - `success` — decrypt + state setup + markPodCreated all succeeded.
 * - `wrong-password` — the password didn't unwrap any wrapped key.
 *   Caller shows the password form's error state; user retries.
 * - `corrupted` — the bytes decrypted but failed Automerge load/materialize.
 *   This is the Shaun-class failure mode at READ time. Caller surfaces a
 *   "your pod file is damaged — contact support" screen with diagnostic
 *   context; do NOT fall back to `createNewFile` (that's what caused the
 *   original data loss).
 * - `needs-recovery` — Phase 4: the envelope is kit-born (no password wraps,
 *   only recovery material). A password can NEVER succeed against it — the
 *   caller must route to the recovery-kit / passphrase surfaces instead of
 *   showing a password form.
 * - `network-error` — anything else (Drive 5xx, IndexedDB write fail, etc.).
 *   Recoverable — user retries or contacts support.
 */
export type CompleteAutoLoadResult =
  | { kind: 'success' }
  | { kind: 'wrong-password' }
  | { kind: 'needs-recovery' }
  | {
      kind: 'corrupted';
      fileId: string;
      familyId: string;
      /**
       * `PayloadLoadError`, not `CorruptPayloadError`, on purpose: this is the
       * "everything that is not `too-large`" branch, and typing it to the
       * narrower class forced the producer into an `as CorruptPayloadError`
       * cast — which would silently mislabel any future third subclass instead
       * of failing the build. Consumers read `.step`/`.message` only.
       */
      error: PayloadLoadError;
    }
  /**
   * The file is intact; THIS DEVICE ran out of memory inflating it. Distinct
   * from `corrupted` so the exhaustive switch in `ResumePodSetup` forces a
   * caller to handle it, rather than it silently taking the corrupt path and
   * telling the user their data is damaged.
   */
  | {
      kind: 'too-large';
      fileId: string;
      familyId: string;
      error: PayloadTooLargeError;
    }
  /**
   * A `RemoteBlocker` stopped the open. Distinct from `corrupted` and
   * `too-large` because nothing is damaged and this device has not run out of
   * anything — telling the user either of those would be a lie, and the
   * recovery is different.
   *
   * ⚠️ THE NAME IS NARROWER THAN THE ARM. `completeAutoLoad` routes EVERY
   * non-`PayloadLoadError` blocker here, so besides a lineage block this now
   * also carries `LocalDocUnreadableError` ("this device's own copy could not be
   * read", where nothing was combined at all) and `RemoteMergeError`. The
   * doc-comment used to say "its history cannot be combined with this device's",
   * which is true of only one of the three. The consumer must not assume a
   * class: `ResumePodSetup` hands the error to `surfaceBlockerFatal`, which
   * resolves copy from a table exhaustive over `PodBlockMessageKey` rather than
   * from an `instanceof`.
   */
  | { kind: 'lineage-blocked'; error: RemoteBlocker }
  | { kind: 'network-error'; error: Error };

// ─── Typed errors ─────────────────────────────────────────────────────────

/**
 * Thrown by the worker's `loadAndVerify` (`worker/docOps.ts`) when the decrypted
 * bytes don't load as
 * a usable Automerge document. Catches silent V4-envelope-valid-but-payload-
 * corrupt cases (the Shaun-on-iOS failure mode).
 *
 * `step` says WHERE it broke, which is the first thing a triager wants:
 *   `decrypt`     — base64-decoding or AES-decrypting the payload, before
 *                   Automerge ever saw it (an allocation failure here is a
 *                   plain "this device has no room for a 3MB buffer");
 *   `load`        — Automerge couldn't consume the byte stream at all;
 *   `materialize` — it loaded, but reading a field threw "Out of bounds table
 *                   access" or ran the WASM heap out inflating the ops.
 */
/** Where in the open sequence the failure happened. See `PayloadLoadError`. */
/**
 * `parse` is the ENVELOPE step — `parseBeanpodV4` rejecting the JSON or the
 * version — and it sits before `decrypt`. It is here so that a remote we
 * downloaded but cannot understand is a `RemoteBlocker` like every other
 * unreadable remote: without it the throw was a plain `Error`, `doSave` took
 * its "merge failed, save local anyway" branch, and this device overwrote a
 * torn upload (or a pod written by a NEWER app version) with its own base.
 */
export type PayloadLoadStep = 'parse' | 'decrypt' | 'load' | 'materialize';

/** The inline message keys a blocked remote can resolve to. */
export type PodBlockMessageKey =
  | 'podTooLarge.inline'
  | 'podCorrupted.inline'
  | 'podCredentialStale.inline'
  | 'podLineage.unsyncedInline'
  | 'podLineage.conflictInline'
  | 'podMerge.failedInline'
  | 'podUnreadable.inline'
  | 'podNewerVersion.inline'
  /**
   * ⚠️ THIS DEVICE'S OWN COPY, never the remote file — the distinction is the
   * whole point of the key. `podUnreadable.inline` means the file we downloaded
   * could not be read and tells the user to update the app; this one means we
   * could not open the local cache, so the remote has NOT been adopted and the
   * user's unsaved work is still here. Reusing the other key would give exactly
   * the wrong advice.
   */
  | 'podLocalUnreadable.inline'
  /** The file predates the oldest format this build reads. Updating won't help. */
  | 'podOlderVersion.inline';

/**
 * Anything that may latch `syncService`'s remote-blocked breaker.
 *
 * An INTERFACE rather than a union (`PayloadLoadError | PodLineageError`),
 * deliberately. A union forces narrowing at every reader, and the readers are
 * already written: `authStore` reads `.step`, `notePodUnopenable` calls
 * `payloadErrorMessageKey`, and `noteRemoteUnreadable` reads five
 * PayloadLoadError members. The union would push an `instanceof` into all of
 * them and into every future one. Two members answer the only two questions a
 * consumer actually asks, and the payload-specific reads stay behind the ONE
 * `instanceof` inside the latch itself.
 *
 * Same idiom as `deviceCannotOpen`: prefer a member that a new subclass must
 * ANSWER to an `instanceof` it can silently inherit the wrong side of.
 */
export interface RemoteBlocker extends Error {
  /** Short, stable code for `error_code` (payload: the step; lineage: the verdict). */
  readonly blockCode: string;
  /** Inline message key for the sync bar. */
  readonly inlineMessageKey: PodBlockMessageKey;
  /**
   * May this class ARM the session breaker?
   *
   * ⚠️ REFUSING A SAVE AND LATCHING ARE DIFFERENT QUESTIONS, and conflating
   * them was a regression. "The remote was read but not merged, so do not
   * overwrite it" is true of every blocker. "Retrying cannot help, so stop
   * polling for the session and tell the user to contact support" is true of
   * almost none of them:
   *   • a torn read (a `.beanpod` mid-write inside a Dropbox/OneDrive folder)
   *     and a pod written by a NEWER app version both self-heal;
   *   • a worker RPC timeout on a busy device is the definition of transient.
   * Latching those stopped background sync for the whole session behind
   * "contact support", with nothing to re-arm it.
   */
  readonly latches: boolean;
  /**
   * One queryable fact for the firehose's `detail`, or `undefined`. Optional so
   * an existing blocker answers nothing and a new one can carry a
   * discriminating value without any consumer doing an `instanceof` to read it.
   */
  readonly blockDetail?: string;
}

/**
 * Is this throw one the remote-blocked breaker owns?
 *
 * ⚠️ THE REASON THIS EXISTS. Every latch site and every save refusal used to
 * ask `e instanceof PayloadLoadError`, so the two blockers added later —
 * `PodLineageError` and `RemoteMergeError` — silently fell out of all of them.
 * `noteLineageBlocked` had NO reachable production caller: a lineage block was
 * flattened into "your password may have changed", and `doSave` took its
 * "merge failed, save local anyway" branch and wrote a pre-compaction document
 * over a compacted remote.
 *
 * Structural on purpose (lessons 11, 13, 17): a new blocker answers the two
 * members of the interface and is picked up by every site at once, instead of
 * needing a fourth class added to N `instanceof` chains that nobody can grep
 * for. Prefer this to `instanceof` ANYWHERE the question is "should this latch
 * / should the save refuse". Keep `instanceof PayloadLoadError` only where a
 * payload-specific member (`step`, `keyMayBeWrong`, `payloadBytes`) is read.
 */
export function isRemoteBlocker(e: unknown): e is RemoteBlocker {
  if (!(e instanceof Error)) return false;
  const c = e as Partial<RemoteBlocker>;
  return typeof c.blockCode === 'string' && typeof c.inlineMessageKey === 'string';
}

export abstract class PayloadLoadError extends Error implements RemoteBlocker {
  readonly step: PayloadLoadStep;
  readonly familyId: string | null;
  /** Decrypted byte length — the number that predicts the WASM cost. */
  readonly payloadBytes: number | null;
  constructor(
    message: string,
    step: PayloadLoadStep,
    familyId: string | null,
    payloadBytes: number | null = null
  ) {
    super(message);
    this.step = step;
    this.familyId = familyId;
    this.payloadBytes = payloadBytes;
  }

  /**
   * Could the CREDENTIAL be at fault?
   *
   * This is the question every "delete the cached key / ask for a new invite
   * link / re-prompt for the password" site is really asking, and getting it
   * from the class alone is wrong in both directions:
   *
   *   • `decryptToDoc` wraps ONLY the decrypt — `loadAndVerify` runs outside
   *     it — so `step: 'load'` or `'materialize'` means the AES-GCM tag already
   *     verified. The key is provably correct and deleting it destroys a valid
   *     credential.
   *   • but `step: 'decrypt'` is not enough either: an ALLOCATION failure while
   *     decoding or decrypting never got as far as checking the tag, so it says
   *     nothing about the key.
   *
   * Only a genuine authentication failure — a corrupt-class error at the
   * decrypt step — can mean a wrong key. Every consumer reads this instead of
   * re-deriving it; the ad-hoc versions were wrong at two separate call sites,
   * one of which deleted a working trusted-device key.
   */
  get keyMayBeWrong(): boolean {
    return this.step === 'decrypt' && !this.deviceCannotOpen;
  }

  /**
   * Is this "the device could not do it" rather than "the data is bad"?
   * Overridden to `true` by `PayloadTooLargeError`. Prefer this to a bare
   * `instanceof` wherever the QUESTION is about the device, so a future third
   * subclass has to state its own answer.
   */
  /** `RemoteBlocker`: the step is the code a triager reads first. */
  get blockCode(): string {
    return this.step;
  }

  /** `RemoteBlocker`: delegates, so the three-way copy rule lives in one place. */
  get inlineMessageKey(): PodBlockMessageKey {
    return payloadErrorMessageKey(this);
  }

  get deviceCannotOpen(): boolean {
    return false;
  }

  /**
   * Is the file simply NEWER than this build, rather than damaged?
   * Overridden to `true` by `UnsupportedBeanpodVersionError`. The action is
   * "update beanies", which is neither an incident nor a data problem. Read by
   * `payloadErrorKind`, `classifyDriveFailure` and the join mapper; nothing
   * outside the class itself does an `instanceof` for this.
   */
  get needsAppUpdate(): boolean {
    return false;
  }

  /**
   * One queryable fact for the firehose's `detail`, or `undefined`.
   * Exists so a subclass can carry a discriminating value without any consumer
   * doing an `instanceof` to read it, and without touching `message` (which
   * `errorReporter` buckets on, so a per-file value there would defeat the
   * throttle). `blockCode`'s sibling.
   */
  get blockDetail(): string | undefined {
    return undefined;
  }

  /**
   * `parse` and `keyMayBeWrong` are recoverable, so they must not latch.
   * `parse` means the JSON or the version was rejected — a torn read, or a pod
   * written by a newer build during a staged rollout. Both fix themselves on
   * the next peer write or the next app update.
   */
  get latches(): boolean {
    return this.step !== 'parse' && !this.keyMayBeWrong;
  }
}

export class CorruptPayloadError extends PayloadLoadError {
  constructor(
    message: string,
    step: PayloadLoadStep,
    familyId: string | null,
    payloadBytes: number | null = null
  ) {
    super(message, step, familyId, payloadBytes);
    // ⚠️ LITERAL, never `new.target.name` / `Ctor.name`. The worker error
    // registry keys on `err.name` (`protocol.ts`) and the prod build minifies,
    // so a derived name would arrive as a mangled string and the `instanceof`
    // dispatch on main would silently degrade to a generic DocWorkerError.
    this.name = 'CorruptPayloadError';
  }
}

/**
 * The file was saved by a NEWER beanies than this build understands.
 *
 * Thrown by `parseBeanpodV4` on main (it never crosses the worker boundary, so
 * it needs no codec) when the envelope's `version` is a string outside
 * `KNOWN_BEANPOD_VERSIONS`. It is a `PayloadLoadError` at `step: 'parse'`, so
 * it inherits the non-latching, non-credential, non-device answers that step
 * already has, and it is NEVER a `CorruptPayloadError`: that class is what the
 * worker's cache self-heal deletes the cache on, and "update beanies" must not
 * delete anything.
 *
 * The compacted-pod format (5.0) exists so that a build predating the lineage
 * guard fails HERE, at parse, before decrypt and before any merge.
 */
// ⚠️ NO WORKER CODEC, DELIBERATELY. This is thrown on MAIN, by
// `parseBeanpodV4`, and no worker file imports `fileSync` (verified), so it
// never crosses the boundary. If a worker path ever does parse an envelope, add
// it to `protocol.ts`'s `ERROR_REGISTRY` first: without a codec it arrives on
// main as a generic `DocWorkerError`, loses `isRemoteBlocker`, and every
// "update beanies" surface silently degrades to the damaged-data copy.
/**
 * The oldest `<major>.<minor>` this build can read. Anything numerically below
 * it is a file from the PAST, which no app update can open.
 */
const OLDEST_KNOWN_BEANPOD_VERSION = 4.0;

export class UnsupportedBeanpodVersionError extends PayloadLoadError {
  readonly fileVersion: string;
  /**
   * Is the file from the FUTURE or the PAST?
   *
   * ⚠️ THE COPY WAS BACKWARDS FOR HALF THE CASES. Every unknown version resolved
   * to `needs-update` — "this file was saved by a newer beanies, please update"
   * — which is exactly wrong for an OLDER file, where updating changes nothing
   * and the real answer is that the file predates a format this build still
   * reads. Sending someone to the App Store to fix a file from 2024 is a wasted
   * trip and a confusing one.
   */
  readonly direction: 'older' | 'newer';
  constructor(fileVersion: string, familyId: string | null = null) {
    // ⚠️ CLAMPED AT THE SOURCE. `fileVersion` comes straight off a file this
    // build did not write, and it reaches the firehose through `blockDetail`.
    // A version is a short token; anything else is a malformed file trying to
    // put its own content in our telemetry.
    const safe = /^[\w.+-]{1,16}$/.test(fileVersion) ? fileVersion : 'unrecognised';
    super(`Unsupported beanpod version: ${safe}`, 'parse', familyId);
    // ⚠️ LITERAL, never `new.target.name`; see `CorruptPayloadError`.
    this.name = 'UnsupportedBeanpodVersionError';
    this.fileVersion = safe;
    // A leading numeric compare is enough: versions are `<major>.<minor>` and
    // the question is only "before the oldest we read, or after the newest".
    // Anything unparseable is treated as NEWER, which is the fail-safe answer —
    // it offers an update rather than telling someone their file is too old.
    const n = Number.parseFloat(safe);
    this.direction = Number.isFinite(n) && n < OLDEST_KNOWN_BEANPOD_VERSION ? 'older' : 'newer';
  }

  /** Only a file from the FUTURE can be fixed by updating the app. */
  override get needsAppUpdate(): boolean {
    return this.direction === 'newer';
  }

  /** `version=<x>` rides in `detail`, never in `message`. */
  override get blockDetail(): string {
    return `version=${this.fileVersion}`;
  }
}

/**
 * The decrypted bytes are FINE — this device could not allocate enough memory
 * to inflate them. A sibling of `CorruptPayloadError`, deliberately NOT a
 * subclass of it: every existing `instanceof CorruptPayloadError` site would
 * then treat an out-of-memory failure as corruption, which is the exact bug
 * this class exists to fix (chiefly `initAndLoadCache`, which DELETES the
 * local cache on corruption — useless here, and destructive).
 */
export class PayloadTooLargeError extends PayloadLoadError {
  constructor(
    message: string,
    step: PayloadLoadStep,
    familyId: string | null,
    payloadBytes: number | null = null
  ) {
    super(message, step, familyId, payloadBytes);
    this.name = 'PayloadTooLargeError'; // literal — see CorruptPayloadError
  }

  override get deviceCannotOpen(): boolean {
    return true;
  }
}

/**
 * The INLINE message key for a payload failure — for compact error slots under
 * a password field, where the fatal overlay's three-sentence copy would point
 * at a diagnostic blob and a Clear-data button that are not on screen.
 *
 * Shared because there are four such surfaces (`LoadPodView`, `SettingsPage`,
 * `useJoinFlow`, `useLoginFlow`) and the first cut wired only one of them,
 * leaving the ORDINARY open path showing a raw Automerge/WASM string under the
 * password field and inviting the user to retype forever.
 */
/**
 * ONE discriminator for "what kind of payload failure is this". Every decision
 * that used to be a hand-written ladder (the inline key here, the boot-overlay
 * key and the is-it-an-incident test in `payloadFailureSurface.ts`) reads a
 * table keyed on this instead, so a sixth kind fails the build in three places
 * rather than taking a silent default. The two ladders had ALREADY drifted
 * under comments claiming they matched.
 *
 * ⚠️ ORDER IS LOAD-BEARING. `UnsupportedBeanpodVersionError` is BOTH
 * `step === 'parse'` and `needsAppUpdate`, so the update question must be
 * asked before the parse one or every newer-version file resolves to
 * `unreadable` and the new copy is dead code. `keyMayBeWrong` stays first
 * because it is the existing precedence and a `parse` error can never set it
 * (it is `step === 'decrypt'` by definition).
 */
export type PayloadErrorKind =
  | 'credential-stale' // keyMayBeWrong
  | 'needs-update' // needsAppUpdate
  | 'too-old' // a version below the oldest format this build reads
  | 'unreadable' // step === 'parse' (a torn read)
  | 'too-large' // deviceCannotOpen
  | 'corrupt';

export function payloadErrorKind(err: PayloadLoadError): PayloadErrorKind {
  if (err.keyMayBeWrong) return 'credential-stale';
  // ⚠️ BEFORE `needsAppUpdate`, and it is a DISTINCT KIND rather than a subclass
  // override of `inlineMessageKey` — the divergence pin in
  // `payloadErrorKind.test.ts` exists to forbid exactly that, because an
  // override makes the resolver and the getter disagree for the same error.
  // A file from the PAST cannot be fixed by updating: `needsAppUpdate` is
  // already false for it, so without its own arm it would fall through to
  // `unreadable` ("a torn read fixes itself"), which is another wrong answer.
  if (err instanceof UnsupportedBeanpodVersionError && err.direction === 'older') {
    return 'too-old';
  }
  if (err.needsAppUpdate) return 'needs-update';
  if (err.step === 'parse') return 'unreadable';
  return err.deviceCannotOpen ? 'too-large' : 'corrupt';
}

/**
 * The inline copy per kind. Row notes carry the reasoning the old ladder held:
 *  - credential-stale: at the decrypt step a wrong key and a damaged
 *    ciphertext are the SAME observation (an AES-GCM tag rejection), so the
 *    honest copy covers both and points at the recoverable half: try your
 *    password. Saying "damaged, contact support" when a peer rotated the key
 *    is a lie.
 *  - needs-update: newer than this build; the action is to update, nothing
 *    is lost.
 *  - unreadable: `parse` is NOT damage. A torn read fixes itself on the next
 *    peer write; "trying again will not help" would stop the one thing that
 *    does work.
 */
export const PAYLOAD_INLINE_KEY = {
  'credential-stale': 'podCredentialStale.inline',
  'needs-update': 'podNewerVersion.inline',
  //  - too-old: older than the oldest format this build reads. Updating cannot
  //    help, so saying "please update" would send someone on a wasted trip.
  'too-old': 'podOlderVersion.inline',
  unreadable: 'podUnreadable.inline',
  'too-large': 'podTooLarge.inline',
  corrupt: 'podCorrupted.inline',
} as const satisfies Record<PayloadErrorKind, PodBlockMessageKey>;

export function payloadErrorMessageKey(err: PayloadLoadError): PodBlockMessageKey {
  return PAYLOAD_INLINE_KEY[payloadErrorKind(err)];
}

/**
 * The copy-to-clipboard diagnostic blob for a payload failure, shared by every
 * surface that shows one (the fatal overlay, the login flow) so the fields a
 * support request carries can never drift between them.
 */
export function payloadErrorDetail(
  err: PayloadLoadError,
  fileId: string | null,
  familyId: string | null
): string {
  return JSON.stringify(
    {
      fileId,
      familyId: err.familyId ?? familyId,
      step: err.step,
      payloadBytes: err.payloadBytes,
      // Which release is running, so a support conversation about a refused
      // file does not start by asking. The FILE's version is already here,
      // inside `message`, clamped at construction.
      appVersion: APP_VERSION,
      message: err.message,
    },
    null,
    2
  );
}

/**
 * Thrown by `GoogleDriveProvider.createNew` when a file with the same name
 * already exists in the beanies.family folder. Drive doesn't dedupe by
 * filename — without this check, a second create silently orphans the first.
 *
 * `ownedByCurrentAccount` drives the adopt-existing recovery (2026-06-19): a
 * same-name file the authenticating account OWNS is almost always its own
 * orphan from a prior aborted attempt and can be adopted/loaded instead of
 * dead-ending; a file owned by a DIFFERENT account must never be adopted and
 * keeps the "pick a different name" guidance.
 */
export class FileNameCollisionError extends Error {
  readonly existingFileId: string;
  readonly fileName: string;
  readonly ownedByCurrentAccount: boolean;
  constructor(
    message: string,
    existingFileId: string,
    fileName: string,
    ownedByCurrentAccount: boolean
  ) {
    super(message);
    this.name = 'FileNameCollisionError';
    this.existingFileId = existingFileId;
    this.fileName = fileName;
    this.ownedByCurrentAccount = ownedByCurrentAccount;
  }
}

/**
 * Thrown by `GoogleDriveProvider.createNew` when the pre-create collision
 * check (a Drive file list) could not be completed — e.g. a transient Drive
 * list-API failure. Distinct from "no collision found": we genuinely do NOT
 * know whether a same-name file exists, so creating blindly risks a SECOND
 * orphan `.beanpod` (2026-06-19, finding 5). Callers surface a retryable
 * "couldn't verify your Drive — try again" message rather than creating.
 */
export class CollisionCheckUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CollisionCheckUnavailableError';
  }
}

/**
 * Thrown when a Google OAuth token comes back WITHOUT the `drive.file` scope —
 * the user deselected the file-access checkbox on Google's granular consent
 * screen (2026-06-19, finding 3). A typed error (vs. a bare message) lets the
 * App.vue boot path and the redirect-completion path branch on `instanceof`
 * and route the user to a clear, translated "you must allow file access"
 * reconnect prompt instead of a silent dead-end.
 */
export class DriveConsentDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DriveConsentDeniedError';
  }
}

/**
 * The remote pod was READ — downloaded, decrypted, loaded — but the MERGE into
 * the local document refused.
 *
 * This is the third `RemoteBlocker`, and it exists for one reason: `doSave`'s
 * "merge failed, save local anyway" branch is right for a transport failure
 * (the remote is still there; the next save re-merges) and catastrophic for a
 * merge refusal, because the write that follows replaces the whole file with a
 * base built from a document that provably does not contain the remote's
 * changes. The first refusal seen in practice was Automerge's
 * `duplicate seq N found for actor …` — two realms sharing one pinned actor —
 * and its symptom was two tabs overwriting each other in turn.
 */
export class RemoteMergeError extends Error implements RemoteBlocker {
  readonly cause: unknown;
  constructor(cause: unknown) {
    super(
      `Remote pod could not be merged: ${cause instanceof Error ? cause.message : String(cause)}`
    );
    // Literal, never `new.target.name`: the prod build minifies class names.
    this.name = 'RemoteMergeError';
    this.cause = cause;
  }

  get blockCode(): string {
    return 'merge';
  }

  get inlineMessageKey(): PodBlockMessageKey {
    return 'podMerge.failedInline';
  }

  /**
   * A duplicate-seq refusal is an Automerge invariant violation — a BUG in the
   * actor plumbing, not weather — and is the one class that should page.
   */
  /**
   * Only a genuine merge REFUSAL latches. This class wraps everything that
   * throws after the remote was read, which includes a 120s worker RPC timeout
   * and a worker crash — transient by definition. Latching those ended
   * background sync for the session behind "contact support".
   */
  get latches(): boolean {
    return this.isActorCollision;
  }

  get isActorCollision(): boolean {
    const m = this.cause instanceof Error ? this.cause.message : String(this.cause);
    return /duplicate seq/i.test(m);
  }
}

/**
 * This device could not READ its own local copy of the family document.
 *
 * ⚠️ THE FOURTH `RemoteBlocker`, and it exists because a failed READ and an
 * EMPTY device were the same value. `syncStore` sent `{ kind:
 * 'no-local-document' }` whenever `loadedFromCache` was false, and the worker
 * reads that arm as an INSTRUCTION to install the remote wholesale without
 * consulting the lineage guard (`applyAndProject.ts:898`, `:919`). So a device
 * whose IndexedDB open was merely blocked — by another tab, which after a
 * two-session soak is the normal state — silently replaced its own document,
 * including work that had never been saved anywhere, and did it with no
 * banner, no rebase and no telemetry.
 *
 * "There is nothing to lose" is true of a fresh device and false of this one.
 * The distinction cannot be made in the worker: only main knows WHY the cache
 * read failed. So the refusal is thrown here, before `mergeRemoteEnvelope` is
 * ever posted, and `applyAndProject.ts` is not touched at all.
 */
export class LocalDocUnreadableError extends Error implements RemoteBlocker {
  /** The failure class (`err.name` of the underlying cache rejection). */
  readonly cause: string;

  constructor(cause: string) {
    super(`This device's local copy could not be read: ${cause}`);
    // Literal, never `new.target.name`: the prod build minifies class names.
    this.name = 'LocalDocUnreadableError';
    this.cause = cause;
  }

  get blockCode(): string {
    return 'local-unreadable';
  }

  get inlineMessageKey(): PodBlockMessageKey {
    return 'podLocalUnreadable.inline';
  }

  /**
   * ⚠️ IT LATCHES, and that is a decision rather than a default.
   *
   * `notePodUnopenable` early-returns before assigning `backgroundSyncError`,
   * `backgroundSyncErrorKind` or `podBlockMessageKey` when the blocker did not
   * latch — so `latches = false` here would mean no banner, no message key, and
   * a 10-second poller still re-downloading the whole pod against a device that
   * cannot read its own copy. It is also the honest answer to the interface's
   * question: while another connection holds the IndexedDB handle, retrying
   * within this session cannot help, and a save would write this device's
   * absent-or-foreign document over the family file.
   *
   * The two exits are the banner's "use the family file" action and a page
   * reload. The copy names both.
   */
  get latches(): boolean {
    return true;
  }

  /** Separates the two routes (classification vs. rehydrate) in the firehose. */
  get blockDetail(): string {
    return this.cause;
  }
}
