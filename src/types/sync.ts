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
export type PayloadLoadStep = 'decrypt' | 'load' | 'materialize';

/** The inline message keys a blocked remote can resolve to. */
export type PodBlockMessageKey =
  | 'podTooLarge.inline'
  | 'podCorrupted.inline'
  | 'podCredentialStale.inline'
  | 'podLineage.unsyncedInline'
  | 'podLineage.conflictInline'
  | 'podMerge.failedInline';

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
export function payloadErrorMessageKey(err: PayloadLoadError): PodBlockMessageKey {
  // THREE answers, because there are three situations and the middle one was
  // being told its data is damaged.
  //
  // At the decrypt step a wrong key and a damaged ciphertext are the SAME
  // observation (an AES-GCM tag rejection) — so the honest copy is the one that
  // covers both and points at the action that fixes the recoverable half: try
  // your password. Telling a user their family data may be damaged and to
  // contact support, when a peer simply rotated the family key, is the same
  // class of lie this whole change exists to remove.
  if (err.keyMayBeWrong) return 'podCredentialStale.inline';
  return err.deviceCannotOpen ? 'podTooLarge.inline' : 'podCorrupted.inline';
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
  get isActorCollision(): boolean {
    const m = this.cause instanceof Error ? this.cause.message : String(this.cause);
    return /duplicate seq/i.test(m);
  }
}
