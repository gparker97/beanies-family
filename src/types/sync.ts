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
  | { ok: true }
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
  | { kind: 'load-failed'; error: Error };

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
 * - `network-error` — anything else (Drive 5xx, IndexedDB write fail, etc.).
 *   Recoverable — user retries or contacts support.
 */
export type CompleteAutoLoadResult =
  | { kind: 'success' }
  | { kind: 'wrong-password' }
  | {
      kind: 'corrupted';
      fileId: string;
      familyId: string;
      error: CorruptPayloadError;
    }
  | { kind: 'network-error'; error: Error };

// ─── Typed errors ─────────────────────────────────────────────────────────

/**
 * Thrown by `decryptBeanpodPayload` when the decrypted bytes don't load as
 * a usable Automerge document. Catches silent V4-envelope-valid-but-payload-
 * corrupt cases (the Shaun-on-iOS failure mode).
 *
 * `step` distinguishes parse failure from materialize failure — `load` means
 * Automerge couldn't even consume the byte stream; `materialize` means it
 * loaded but reading a field threw "Out of bounds table access" or similar.
 */
export class CorruptPayloadError extends Error {
  readonly step: 'load' | 'materialize';
  readonly familyId: string | null;
  constructor(message: string, step: 'load' | 'materialize', familyId: string | null) {
    super(message);
    this.name = 'CorruptPayloadError';
    this.step = step;
    this.familyId = familyId;
  }
}

/**
 * Thrown by `GoogleDriveProvider.createNew` when a file with the same name
 * already exists in the beanies.family folder. Drive doesn't dedupe by
 * filename — without this check, a second create silently orphans the first.
 */
export class FileNameCollisionError extends Error {
  readonly existingFileId: string;
  readonly fileName: string;
  constructor(message: string, existingFileId: string, fileName: string) {
    super(message);
    this.name = 'FileNameCollisionError';
    this.existingFileId = existingFileId;
    this.fileName = fileName;
  }
}
