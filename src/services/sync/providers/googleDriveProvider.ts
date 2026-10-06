/**
 * GoogleDriveProvider — implements StorageProvider for Google Drive.
 *
 * Reads/writes .beanpod files on Google Drive via REST API.
 * Token management is delegated to googleAuth.ts (in-memory only).
 * On 401, attempts token refresh and retries once.
 */
import type { StorageProvider } from '../storageProvider';
import { toStoredRevision } from '../remoteBaseline';
import type { WriteAck, RemoteMarker } from '../remoteBaseline';
import type { TransientFailure } from '@/utils/transientFailure';
import {
  storeProviderConfig,
  clearProviderConfig,
  clearFileHandleForFamily,
} from '../fileHandleStore';
import {
  getValidTokenSilent,
  isTokenValid,
  clearGoogleSessionState,
  requestAccessToken,
  attemptSilentRefresh,
  fetchGoogleUserEmail,
  getGoogleAccountEmail,
  setGoogleAccountEmail,
  TokenExpiredError,
  invalidateAccessToken,
} from '@/services/google/googleAuth';
import { clearDriveConnectionForAccount } from '@/services/google/driveTokenRecovery';
import {
  readFile,
  updateFile,
  getFileModifiedTime,
  getFileMetadata,
  patchFileMetadata,
  getOrCreateAppFolder,
  createFile,
  listBeanpodFiles,
  listFilesInFolder,
  deleteFile,
  clearFolderCache,
  DriveApiError,
} from '@/services/google/driveService';
import { enqueueOfflineSave } from '../offlineQueue';
import { FileNameCollisionError, CollisionCheckUnavailableError } from '@/types/sync';
import { classifyTransientFailure } from '@/utils/transientFailure';
import { delay } from '@/utils/timing';
import { logEvent } from '@/services/telemetry';

/**
 * In-provider retry budget per transient class (#127): how many RETRIES (after the
 * first attempt) a failure of that class earns. A `Record`, so a class added to
 * `TRANSIENT_FAILURES` is a compile error here until its budget is chosen.
 *
 *   - `timeout: 1` — a second full-size attempt rarely beats a sized deadline the first
 *     one already missed, and every attempt re-sends the whole body over the same slow
 *     uplink (the old budget of 3 turned one slow save into 67 s of guaranteed failure).
 *     One retry absorbs a blip; after that the write is QUEUED and the offline queue
 *     re-runs the save on the next trigger (online / visible / token refresh / edit).
 *   - `server: 3`, `network: 3` — unchanged: Google 5xx waves and offline blips clear
 *     with backoff (1 s, 2 s, 4 s).
 *
 * ⚠️ DURABLE-BOUND INVARIANT. A client timeout does not prove the write did not land,
 * yet a queued timeout returns `false`, which `familyStore.syncNowDurable` reads as
 * "nothing reached Drive". That is safe ONLY because every durable bound
 * (`DURABLE_ROTATION_SAVE_TIMEOUT_MS` 12 s, `CREDENTIAL_PUBLISH_TIMEOUT_MS` 20 s,
 * `POST_AUTH_SAVE_TIMEOUT_MS` 5 s) is shorter than the earliest a queued TIMEOUT can
 * return. The budget is counted PER CLASS (a near-instant network failure must not spend
 * the timeout's retry), and total attempts are capped at `MAX_ATTEMPTS`, so a timeout is
 * the thrown class only after either two timed-out attempts (2 × 15 s + 1 s = 31 s) or
 * three instant network failures plus one timeout (1 + 2 + 4 + 15 = 22 s). Do not raise
 * a durable bound to 22 s or more, or this timeout budget, without first making a
 * timed-out write report `'unknown'`. `earliestQueuedTimeoutMs` derives the bound from
 * these constants and `durableBounds.test.ts` asserts every durable bound stays under it.
 *
 * Scope of the argument: it covers the client-timeout class only. A `server` class
 * (5xx) queues after ~7 s, inside every durable bound, and a 5xx on a media upload also
 * does not prove the write did not land. That exposure predates #127 (5xx queued the same
 * way before) and is recorded, not solved, here: durable callers that need certainty must
 * treat any `queued` ack as unknown, not as "nothing reached Drive".
 */
export const TRANSIENT_RETRIES: Record<TransientFailure, number> = {
  timeout: 1,
  server: 3,
  network: 3,
};
/** Hard ceiling on attempts whatever the classes seen (today's 1 + 3). */
export const MAX_ATTEMPTS = 4;

/**
 * The earliest a queued TIMEOUT can come back from `withRetry`, given the base deadline:
 * either two timed-out attempts (one backoff between), or the attempt cap reached by
 * instant non-timeout failures (each within its own budget) followed by one timeout.
 */
export function earliestQueuedTimeoutMs(baseTimeoutMs: number): number {
  const twoTimeouts = 2 * baseTimeoutMs + 1000;
  const instantFailures = Math.min(
    MAX_ATTEMPTS - 1,
    TRANSIENT_RETRIES.network + TRANSIENT_RETRIES.server
  );
  let backoff = 0;
  for (let attempt = 0; attempt < instantFailures; attempt++) backoff += 1000 * 2 ** attempt;
  return Math.min(twoTimeouts, backoff + baseTimeoutMs);
}

/**
 * Retry a Drive API call with exponential backoff (1 s, 2 s, 4 s) on transient failures.
 *
 * What is transient, and in which class, comes ONLY from `classifyTransientFailure`
 * (`src/utils/transientFailure.ts`); the budget is `TRANSIENT_RETRIES` for the class of
 * the LATEST failure, counted against total attempts (so a timeout after two network
 * retries is not retried again). A non-transient failure (4xx incl. 401, which the
 * caller handles with a silent refresh; 429 / 403 throttles) throws immediately.
 */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  const seen: Partial<Record<TransientFailure, number>> = {};
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const kind = classifyTransientFailure(e);
      if (!kind) throw e;
      // eslint-disable-next-line security/detect-object-injection -- `kind` is a closed TransientFailure union
      const failuresOfKind = (seen[kind] ?? 0) + 1;
      // eslint-disable-next-line security/detect-object-injection -- `kind` is a closed TransientFailure union
      seen[kind] = failuresOfKind;
      // eslint-disable-next-line security/detect-object-injection -- `kind` is a closed TransientFailure union
      if (failuresOfKind > TRANSIENT_RETRIES[kind] || attempt + 1 >= MAX_ATTEMPTS) throw e;
      await delay(1000 * 2 ** attempt);
    }
  }
}

export class GoogleDriveProvider implements StorageProvider {
  readonly type = 'google_drive' as const;
  private fileId: string;
  private fileName: string;
  private accountEmail: string | null;
  private mimeTypeMigrationDone = false;
  // ADR-032 Plan B aux change-log: the .beanpod's parent folder + a name→fileId
  // cache refreshed by listAux (chunks live as sibling files in the app folder).
  private auxFolderId: string | null = null;
  private auxIdByName = new Map<string, string>();

  constructor(fileId: string, fileName: string, accountEmail?: string | null) {
    this.fileId = fileId;
    this.fileName = fileName;
    this.accountEmail = accountEmail ?? null;
  }

  /**
   * Legacy .beanpod files were uploaded as `application/json` even though the
   * V4 envelope is encrypted binary. Drive then refused to recognize the type
   * (content didn't validate as JSON) and showed "File Type: unknown", which
   * suppressed the Marketplace SDK's "Open with beanies.family" handler.
   * Patches metadata to `application/octet-stream` once per session for any
   * file still on the wrong type. Failures are non-critical — the file
   * remains usable; the next successful sync will write the correct MIME
   * via updateFile's Content-Type header.
   */
  private async ensureCorrectMimeType(token: string): Promise<void> {
    if (this.mimeTypeMigrationDone) return;
    try {
      const meta = await getFileMetadata(token, this.fileId, 'mimeType');
      const currentMime = meta.mimeType as string | undefined;
      if (currentMime === 'application/json') {
        await patchFileMetadata(token, this.fileId, {
          mimeType: 'application/octet-stream',
        });
        console.info(
          '[GoogleDriveProvider] migrated .beanpod mimeType: application/json → application/octet-stream',
          this.fileId
        );
      }
      this.mimeTypeMigrationDone = true;
    } catch (e) {
      console.warn(
        '[GoogleDriveProvider] mimeType migration check failed (non-critical, will retry next session):',
        (e as Error).message
      );
      // Non-critical (the file stays usable), but never console-only (audit C12).
      logEvent({
        level: 'info',
        surface: 'drive-provider',
        message: 'mimeType migration check failed; retried next session',
        context: {
          action: 'mime-migration-failed',
          error_code: e instanceof Error ? e.name : 'unknown',
          ...(e instanceof DriveApiError ? { http_status: e.status } : {}),
        },
      });
    }
  }

  /**
   * Account-drift predicate (2026-06-19, finding 9). This provider is bound to
   * ONE Drive account (`this.accountEmail`) that owns `this.fileId`. Returns true
   * only when BOTH the bound email and the live session email are known and
   * differ. A null bound email means "not yet learned" (the provider learns it
   * via `updateAccountEmailIfAvailable` / `rebindProvenAccount`); a null session
   * email means we can't tell — both cases return false (no mismatch asserted).
   *
   * NOTE: unlike the pre-2026-08-14 `ensureBoundAccount`, this is NO LONGER a
   * pre-emptive gate. A nominal mismatch is not itself an error — the session
   * account may legitimately have shared access to the file. The mismatch only
   * matters when a real Drive op FAILS with a 404 (see `reconnectIfAccountMismatch`).
   */
  private accountMismatch(): boolean {
    if (!this.accountEmail) return false;
    const active = getGoogleAccountEmail();
    return !!active && active !== this.accountEmail;
  }

  /**
   * Shared 404 classifier (finding 9) — the SINGLE home for the reconnect message
   * string and the `drive-account-mismatch-blocked` event. Call from a caught
   * Drive 404. If the live session account is known to differ from this file's
   * bound account, that 404 means "this account can't reach the file" — log it
   * and throw the reconnect `TokenExpiredError` so the reconnect banner appears
   * for the bound account (NOT the missing-file recovery path). Otherwise return;
   * the caller re-throws the raw 404 for missing-file recovery (today's behavior).
   */
  private reconnectIfAccountMismatch(): void {
    if (!this.accountMismatch()) return;
    logEvent({
      level: 'warn',
      surface: 'drive-account-mismatch-blocked',
      message: 'Drive 404 with an account mismatch — surfacing reconnect for the bound account',
      context: { http_status: 404, action: 'reconnect-required' },
    });
    // ⚠️ DROP THE CACHED ACCESS TOKEN, because THIS is where we learn the
    // session cannot reach the file. `isTokenValid()` is a local clock check
    // that never contacts Google, so without this the token stays "valid" for
    // up to an hour — and `tryReconnectSilently` then returns true at its first
    // line without acquiring anything, so the reconnect the line below raises
    // reports success, clears the banner, and fails identically on the next op.
    // A 404 plus an account mismatch is an OBSERVATION that the connection is
    // wrong; the 401 handler in `driveService` covers the other one.
    invalidateAccessToken();
    throw new TokenExpiredError(
      `Drive session account (${getGoogleAccountEmail()}) does not match this file's bound account (${this.accountEmail}) — reconnect required`
    );
  }

  /**
   * Rebind this provider to a DIFFERENT account after that account has PROVEN it
   * can access `this.fileId` (a read/write succeeded). This is the ONE safe
   * exception to finding 9's "never rebind A→B" (see `updateAccountEmailIfAvailable`):
   * a successful Drive op is proof the new account is a legitimate accessor.
   * Returns true if the binding changed. Callers MUST only invoke this after a
   * successful Drive operation.
   */
  rebindProvenAccount(verifiedEmail: string): boolean {
    if (this.accountEmail === verifiedEmail) return false;
    this.accountEmail = verifiedEmail;
    return true;
  }

  /**
   * Write content to Google Drive.
   *
   * ONE flat classification of whatever `writeWithAuthRetry` throws:
   *   - `TokenExpiredError` (no token, or a 401 that silent refresh could not fix) →
   *     queue as `auth` and rethrow, so syncStore surfaces the reconnect banner.
   *   - 404 → account-mismatch check (may throw the reconnect error), else rethrow for
   *     missing-file recovery.
   *   - any transient class (`timeout` / `server` / `network`, retries exhausted) →
   *     QUEUED, never a hard failure: returns `{ queued: true, queuedReason }`.
   *   - anything else → rethrow (a counted save failure).
   * The same arms apply to the silent-refresh retry, which used to escape them.
   */
  async write(content: string): Promise<WriteAck | void> {
    try {
      return await this.writeWithAuthRetry(content);
    } catch (e) {
      if (e instanceof TokenExpiredError) {
        enqueueOfflineSave('auth');
        throw e;
      }
      // 404 — file gone (deleted/moved) OR the live session account can't reach
      // it. Classify (finding 9): an account mismatch → reconnect banner for the
      // bound account; otherwise let the caller run missing-file recovery.
      if (e instanceof DriveApiError && e.status === 404) {
        this.reconnectIfAccountMismatch();
        throw e;
      }
      const kind = classifyTransientFailure(e);
      if (kind) return this.queueWrite(kind, e);
      throw e;
    }
  }

  /**
   * The upload itself, with the one 401 recovery: the in-memory token may have raced
   * its expiry, so try ONE silent refresh and retry. Never an unsolicited popup
   * mid-save; with no token, throw `TokenExpiredError` for `write()` to queue as `auth`.
   *
   * ⚠️ The TokenExpiredError message must keep "silent refresh failed":
   * `syncStore.isAuthTransientSyncError` matches on it.
   */
  private async writeWithAuthRetry(content: string): Promise<WriteAck> {
    // C14b: every path MUST propagate the ack — a bare `return` on the silent-refresh
    // retry once silently disabled the open-guard optimisation for every refresh save.
    const upload = async (token: string): Promise<WriteAck> => {
      const ack = await withRetry(() => updateFile(token, this.fileId, content));
      return { revision: toStoredRevision(ack.version) };
    };
    const token = await getValidTokenSilent();
    try {
      return await upload(token);
    } catch (e) {
      if (!(e instanceof DriveApiError && e.status === 401)) throw e;
      const silentToken = await attemptSilentRefresh();
      if (!silentToken) {
        throw new TokenExpiredError(
          'Drive write failed: token rejected and silent refresh failed; save queued offline'
        );
      }
      return await upload(silentToken);
    }
  }

  /**
   * THE ONLY queue branch of `write()`: a transient failure that survived the retry
   * budget. Logged (every class — the network branch used to be silent), queued with
   * its class as the reason, and returned as NOT a success, or the caller stamps "Last
   * Saved" for bytes that never left this device (see `WriteAck.queued`).
   */
  private queueWrite(kind: TransientFailure, e: unknown): WriteAck {
    const httpStatus = e instanceof DriveApiError ? e.status : undefined;
    const errorCode = e instanceof Error ? e.name : 'unknown';
    const { timeoutMs, bodyBytes } = (e ?? {}) as { timeoutMs?: unknown; bodyBytes?: unknown };
    const timeoutHint =
      kind === 'timeout'
        ? typeof timeoutMs === 'number'
          ? ` Our sized deadline fired (${timeoutMs} ms for ${String(bodyBytes)} bytes).`
          : ' The platform aborted the request before our sized deadline (e.g. iOS ~60 s).'
        : '';
    console.warn(
      `[GoogleDriveProvider] Drive write queued offline (class: ${kind}${
        httpStatus !== undefined ? `, http_status: ${httpStatus}` : ''
      }, ${errorCode}).${timeoutHint} The offline queue re-runs the save on the next ` +
        'trigger (online / visible / token refresh / next edit).' +
        (kind === 'timeout'
          ? ' If this persists for one family, check the pod size (see the resumable-upload follow-up, #127).'
          : ''),
      e
    );
    logEvent({
      level: 'warn',
      surface: 'drive-write',
      // CONSTANT: the message is the rate-limit / dedup key; the facts ride in context.
      message: 'Drive write queued offline',
      error: e,
      context: {
        action: 'queue-offline',
        detail: kind,
        // `DriveTimeoutError` = our sized deadline; `TypeError` = the platform's own abort.
        error_code: errorCode,
        ...(httpStatus !== undefined ? { http_status: httpStatus } : {}),
      },
    });
    enqueueOfflineSave(kind);
    return { revision: null, queued: true, queuedReason: kind };
  }

  /**
   * Read file content from Google Drive.
   * On 401: try silent refresh first, then interactive auth (consistent with write()).
   * Transient failures retry per `TRANSIENT_RETRIES` (a timeout once), then rethrow
   * raw: `syncService.classifyReadFailure` classifies them with the same classifier and
   * queues the save instead of counting a failure.
   */
  async read(): Promise<string | null> {
    try {
      /* eslint-disable no-console -- init diagnostics */
      console.log('[GoogleDrive.read] getting token...');
      const token = await getValidTokenSilent();
      console.log('[GoogleDrive.read] token obtained, reading file...');
      const result = await withRetry(() => readFile(token, this.fileId));
      console.log('[GoogleDrive.read] read complete, length=', result?.length ?? 0);
      // Fire-and-forget: don't block the read on metadata migration. Internal
      // try/catch handles its own errors.
      void this.ensureCorrectMimeType(token);
      return result;
      /* eslint-enable no-console */
    } catch (e) {
      console.warn('[GoogleDrive.read] error:', (e as Error).message);
      if (e instanceof DriveApiError && e.status === 401) {
        // Server says the token is invalid. Try one silent refresh (in case
        // the in-memory token went stale between getValidTokenSilent's
        // isTokenValid check and the actual API call). On failure, signal
        // the caller to surface the reconnect banner — do NOT open an
        // unsolicited popup.
        const silentToken = await attemptSilentRefresh();
        if (silentToken) {
          return await withRetry(() => readFile(silentToken, this.fileId));
        }
        throw new TokenExpiredError('Drive read failed: token rejected and silent refresh failed');
      }
      // 404 — file gone OR the live session account can't reach it. Classify
      // (finding 9), mirroring write(): account mismatch → reconnect banner;
      // otherwise re-throw the raw 404 for missing-file recovery (today's path).
      if (e instanceof DriveApiError && e.status === 404) {
        this.reconnectIfAccountMismatch();
        throw e;
      }
      throw e;
    }
  }

  /**
   * Get last modified time from Drive metadata (lightweight polling check).
   * Re-throws 401 errors so callers can detect auth failures.
   * Swallows network/5xx errors (transient failures are expected).
   */
  /**
   * The SINGLE correct classifier for a Drive metadata failure, shared by
   * `getLastModified` and `getRemoteMarker` (#61 C14a — do not copy-paste it).
   * Auth failures (TokenExpiredError / 401 / 404) rethrow so the caller can
   * surface the reconnect / missing-file path; transient failures (network,
   * 5xx) return `null` — a metadata check is non-critical.
   */
  private async metadataProbe<T>(fn: (token: string) => Promise<T>): Promise<T | null> {
    try {
      const token = await getValidTokenSilent();
      return await fn(token);
    } catch (e) {
      if (e instanceof TokenExpiredError) throw e;
      if (e instanceof DriveApiError && (e.status === 401 || e.status === 404)) throw e;
      // Network errors, 5xx, and other failures — non-critical for a metadata check
      return null;
    }
  }

  async getLastModified(): Promise<string | null> {
    return this.metadataProbe((token) => getFileModifiedTime(token, this.fileId));
  }

  /**
   * Cheap revision+mtime probe in ONE round-trip (#61 C14a). `version` is
   * Drive's monotonic, server-assigned counter — present on every file, advances
   * on any server-side change, and strictly more conservative than
   * `headRevisionId` (it can only ever trigger an EXTRA read, never miss one),
   * so it is the guard's field. `headRevisionId` is requested as audit-only
   * evidence. The returned revision is namespaced via `toStoredRevision`; a null
   * probe (transient failure) yields `{ revision: null, modifiedTime: null }` so
   * the guard reads.
   */
  async getRemoteMarker(): Promise<RemoteMarker> {
    const meta = await this.metadataProbe((token) =>
      getFileMetadata(token, this.fileId, 'modifiedTime,version,headRevisionId')
    );
    if (meta === null) return { revision: null, modifiedTime: null };
    return {
      revision: toStoredRevision((meta.version as string | undefined) ?? null),
      modifiedTime: (meta.modifiedTime as string | undefined) ?? null,
    };
  }

  /**
   * Check if we have a valid OAuth token.
   */
  async isReady(): Promise<boolean> {
    return isTokenValid();
  }

  /**
   * Request OAuth access (shows Google sign-in prompt).
   */
  async requestAccess(): Promise<boolean> {
    try {
      await requestAccessToken();
      return true;
    } catch (e) {
      // `false` is the contract (the caller shows its own reconnect copy), but WHY the
      // grant failed — a dismissed popup, a blocked one, a network error — only exists
      // here (audit C12).
      logEvent({
        level: 'warn',
        surface: 'drive-provider',
        message: 'Drive access request failed',
        error: e instanceof Error ? e : undefined,
        context: {
          action: 'request-access-failed',
          error_code: e instanceof Error ? e.name : 'unknown',
        },
      });
      return false;
    }
  }

  /**
   * Persist provider config to IndexedDB.
   * Also clears any stale local file handle for this family so that
   * syncService.initialize() won't fall back to a previous local file.
   */
  async persist(familyId: string): Promise<void> {
    await clearFileHandleForFamily(familyId);
    await storeProviderConfig(familyId, {
      type: 'google_drive',
      driveFileId: this.fileId,
      driveFileName: this.fileName,
      driveAccountEmail: this.accountEmail ?? undefined,
    });
  }

  /**
   * Clear persisted provider config.
   */
  async clearPersisted(familyId: string): Promise<void> {
    await clearProviderConfig(familyId);
  }

  /**
   * Revoke OAuth token and clear caches.
   */
  async disconnect(): Promise<void> {
    // B: a deliberate disconnect → also drop this account's beanpod-mirrored
    // refresh token. Done HERE (a deliberate caller), NOT inside
    // clearGoogleSessionState — that shared chokepoint is also hit by the
    // transient account-mismatch correction, where deleting the shared token
    // would be wrong ("park, don't delete"). Best-effort; never throws.
    if (this.accountEmail) {
      await clearDriveConnectionForAccount(this.accountEmail);
    }
    await clearGoogleSessionState();
    clearFolderCache();
  }

  getDisplayName(): string {
    return this.fileName;
  }

  getFileId(): string | null {
    return this.fileId;
  }

  getAccountEmail(): string | null {
    return this.accountEmail;
  }

  /**
   * Drive does NOT participate in the per-tick polling loop — an HTTP call
   * to Drive every 15s is the wrong shape (cost + API quota). Drive uses
   * save-time `fetchAndMergeRemote` triggered by the syncService's debounced
   * save path. Returning false here keeps the polling watcher inactive
   * while a Drive provider is mounted.
   */
  supportsLocalPolling(): boolean {
    return false;
  }

  // ─── ADR-032 Plan B aux change-log (sibling files in the app folder) ─────────
  //
  // Best-effort by contract — the incremental transport treats ANY aux failure as
  // a whole-doc fallback (the .beanpod base is always authoritative). So these
  // reuse the same token/retry path as read/write but do not add new recovery
  // beyond the account-bound guard; a throw simply degrades to whole-doc sync.

  /** The .beanpod's parent folder = where sibling change chunks live. Cached. */
  private async resolveAuxFolder(token: string): Promise<string> {
    if (this.auxFolderId) return this.auxFolderId;
    const meta = await getFileMetadata(token, this.fileId, 'parents');
    const parent = (meta.parents as string[] | undefined)?.[0];
    if (!parent) throw new Error('[GoogleDriveProvider] .beanpod has no parent folder for aux');
    this.auxFolderId = parent;
    return parent;
  }

  /**
   * Resolve ONE aux object's file id by name — the cached map first, then an
   * exact-name query.
   *
   * ⚠️ THIS EXISTS BECAUSE `listAux()` IS SCOPED TO `.beanchanges`, AND MUST
   * STAY THAT WAY. `readAux` and `deleteAux` used to refresh through it on a
   * miss, which silently made the whole aux surface unable to address any
   * sibling with a different suffix: `deleteAux('… before tidy.beanpod')` missed
   * the map, listed only `.beanchanges`, missed again, and returned — a no-op
   * reported as success, because delete is documented as idempotent. Widening
   * `listAux`'s own query is NOT the fix: its single caller is the change-log
   * transport, which owns that name→id map and must keep seeing exactly its own
   * chunks.
   *
   * Drive's `name contains` is a SUBSTRING match, so the exact comparison below
   * is load-bearing — "pod.beanpod" would otherwise match
   * "pod before tidy.beanpod".
   */
  private async resolveAuxId(
    token: string,
    folderId: string,
    name: string
  ): Promise<string | null> {
    const cached = this.auxIdByName.get(name);
    if (cached) return cached;
    const files = await withRetry(() => listFilesInFolder(token, folderId, name));
    const match = files.find((f) => f.name === name);
    if (!match) return null;
    this.auxIdByName.set(name, match.id);
    return match.id;
  }

  async listAux(): Promise<string[]> {
    const token = await getValidTokenSilent();
    const folderId = await this.resolveAuxFolder(token);
    const files = await withRetry(() => listFilesInFolder(token, folderId, '.beanchanges'));
    this.auxIdByName = new Map(files.map((f) => [f.name, f.id]));
    return files.map((f) => f.name);
  }

  async readAux(name: string): Promise<string | null> {
    const token = await getValidTokenSilent();
    const folderId = await this.resolveAuxFolder(token);
    const id = await this.resolveAuxId(token, folderId, name);
    if (!id) return null; // absent (pruned/never-written) → transport falls back
    return withRetry(() => readFile(token, id));
  }

  /**
   * Create OR overwrite one aux object — which is what the `AuxStore` contract
   * has always said, and what the implementation did not do.
   *
   * ⚠️ IT ONLY EVER CREATED. Drive permits two files with the same name in one
   * folder, so re-writing a name produced a DUPLICATE rather than a new version.
   * Nothing noticed because the only caller until now was the change-log
   * transport, whose chunk names are immutable and never reused. A rollback copy
   * IS re-written, every compaction, so without this each one would leave
   * another copy behind and the picker would fill with them.
   */
  async writeAux(name: string, content: string): Promise<void> {
    const token = await getValidTokenSilent();
    const folderId = await this.resolveAuxFolder(token);
    const existing = await this.resolveAuxId(token, folderId, name);
    if (existing) {
      await withRetry(() => updateFile(token, existing, content));
      return;
    }
    const { fileId } = await withRetry(() => createFile(token, folderId, name, content));
    this.auxIdByName.set(name, fileId);
  }

  async deleteAux(name: string): Promise<void> {
    const token = await getValidTokenSilent();
    const folderId = await this.resolveAuxFolder(token);
    const id = await this.resolveAuxId(token, folderId, name);
    if (!id) return; // already gone — delete is idempotent
    await withRetry(() => deleteFile(token, id));
    this.auxIdByName.delete(name);
  }

  /**
   * Create a new .beanpod file on Google Drive.
   * Authenticates, creates/finds the app folder, and creates the file.
   *
   * `forceConsent` (default `true`) forces a fresh interactive grant so a brand-new family is
   * created under a deliberately-confirmed account. Pass `false` when an account is already
   * established this session (e.g. moving an existing pod to Drive) — that reuses the cached
   * token, which avoids a redirect-auth loop on standalone PWAs.
   *
   * ⚠️ IT DOES NOT SHOW THE ACCOUNT CHOOSER, despite what this comment claimed until 2026-09-16.
   * It maps to `prompt=consent`, which re-asks permission on the account already signed in and
   * SUPPRESSES the chooser; `chooseAccount` is the flag that shows it. Behaviour here is
   * unchanged and deliberately so — switching this to `chooseAccount` changes the create-a-pod
   * flow, which is outside the join-flow work that found the inversion. See
   * `docs/plans/2026-09-16-join-flow-consent-loop-and-picker-retirement.md`.
   */
  static async createNew(
    fileName: string,
    opts: { forceConsent?: boolean } = {}
  ): Promise<GoogleDriveProvider> {
    // Clear cached folder ID — prevents cross-account folder leak when switching Google accounts
    clearFolderCache();

    const token = await requestAccessToken({ forceConsent: opts.forceConsent ?? true });

    // Capture account email (best-effort, non-blocking for provider creation)
    const email = await fetchGoogleUserEmail(token);

    const folderId = await getOrCreateAppFolder(token);

    // Collision check before creating — Drive happily allows multiple files
    // with the same name in the same folder (different fileIds), which is
    // how the 2026-05-15 incident orphaned a real pod with an empty
    // duplicate. If a file with this name already exists, throw a typed
    // error carrying `ownedByMe` so the caller's adopt-existing recovery can
    // load the user's own orphan (2026-06-19, finding 1) or, for a different
    // account, surface the focused "duplicate name" message.
    //
    // A list FAILURE is NOT swallowed (2026-06-19, finding 5): we genuinely
    // don't know whether a same-name file exists, and creating blindly risks a
    // SECOND orphan `.beanpod`. Throw a typed `CollisionCheckUnavailableError`
    // so the caller surfaces a retryable "couldn't verify your Drive" message.
    let existing;
    try {
      existing = await listBeanpodFiles(token, folderId);
    } catch (e) {
      console.warn('[GoogleDriveProvider.createNew] pre-create collision check failed:', e);
      throw new CollisionCheckUnavailableError(
        'Could not verify your Google Drive for existing family files. Please try again.'
      );
    }
    const collision = existing.find((f) => f.name === fileName);
    if (collision) {
      throw new FileNameCollisionError(
        `A .beanpod file named "${fileName}" already exists in this Google Drive folder (fileId: ${collision.fileId})`,
        collision.fileId,
        fileName,
        collision.ownedByMe
      );
    }

    const { fileId, name } = await createFile(token, folderId, fileName, '{}');
    // Flush-provider registration is owned by `syncService.setProvider` (the
    // single write-intent install seam, 2026-06-19 finding 11) — NOT here, so
    // a read-only build can never auto-flush stale bytes into a file it only
    // meant to inspect. Every createNew caller calls setProvider immediately.
    return new GoogleDriveProvider(fileId, name, email);
  }

  /**
   * Create a provider for an existing Drive file (e.g. restored from config or file picker).
   * Token is acquired on demand when read/write are called.
   */
  static fromExisting(
    fileId: string,
    fileName: string,
    accountEmail?: string | null
  ): GoogleDriveProvider {
    // Use persisted email, or fall back to in-memory cache from current session
    const email = accountEmail ?? getGoogleAccountEmail();
    if (email) setGoogleAccountEmail(email);
    // No `setFlushProvider` here (2026-06-19, finding 11): `fromExisting` is used
    // by READ-only resume/recovery paths (loadFromGoogleDrive, recoverFromMissingFile)
    // that must NOT register a flush target — otherwise inspecting a file could
    // auto-flush stale queued bytes INTO it. Write-intent callers go through
    // `syncService.setProvider`, which owns flush registration.
    return new GoogleDriveProvider(fileId, fileName, email);
  }
}
