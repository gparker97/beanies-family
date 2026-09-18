/**
 * The pick primitive, tested against the layer BELOW it.
 *
 * ⚠️ WHY THIS FILE EXISTS. The guarantees here were previously asserted from
 * `useJoinFlow.test.ts`, which `vi.mock`s this composable wholesale — so every assertion about
 * its internals ran against a stub and could not fail. A test that mocks the thing under test
 * is shaped like whatever we believed on the day we wrote it.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

const tryReconnectSilentlyMock = vi.fn(async (_hint: string) => {});
const tryGetSilentTokenMock = vi.fn(async () => 'silent-token' as string | null);
const requestAccessTokenMock = vi.fn(async (_opts?: unknown) => 'interactive-token');
const startRedirectAuthMock = vi.fn(async (..._a: unknown[]) => {});
const shouldUseRedirectAuthMock = vi.fn(() => false);
const pickBeanpodFileMock = vi.fn(async (_token: string) => ({
  kind: 'picked' as const,
  fileId: 'f-1',
  fileName: 'family.beanpod',
}));

vi.mock('@/services/google/driveTokenRecovery', () => ({
  tryReconnectSilently: (hint: string) => tryReconnectSilentlyMock(hint),
}));
vi.mock('@/services/google/googleAuth', () => ({
  tryGetSilentToken: () => tryGetSilentTokenMock(),
  requestAccessToken: (o: unknown) => requestAccessTokenMock(o),
  startRedirectAuth: (...a: unknown[]) => startRedirectAuthMock(...a),
  shouldUseRedirectAuth: () => shouldUseRedirectAuthMock(),
  isPopupBlocked: () => false,
  // Real behaviour, not a stub returning false: a closed chooser must reach `cancelled`, and a
  // mock that always says "not a cancellation" would hide the branch under test.
  isUserCancellation: (e: unknown) =>
    /cancel|dismiss|popup_closed|user_cancel/i.test(e instanceof Error ? e.message : String(e)),
  // Used to pin the picker grant to the account this token belongs to.
  getEmailVerifiedForToken: () => getEmailVerifiedForTokenMock(),
  DRIVE_FILE_SCOPE: 'https://www.googleapis.com/auth/drive.file',
}));
vi.mock('@/services/google/drivePicker', () => ({
  pickBeanpodFile: (t: string) => pickBeanpodFileMock(t),
}));

/**
 * ⚠️ DEFAULT OFF, DELIBERATELY. `isFlagEnabled` returns TRUE for every flag in dev and under test
 * (`flags.ts`: "every flag is available while building on main"), so without this mock the whole
 * suite below silently exercised the system-browser redirect instead of the iframe Picker it was
 * written for. The flag-on path has its own describe block at the end.
 */
const getEmailVerifiedForTokenMock = vi.hoisted(() =>
  vi.fn<() => string | null>(() => 'joiner@example.com')
);
const getFileMetadataMock = vi.hoisted(() => vi.fn(async () => ({ name: 'smith.beanpod' })));
vi.mock('@/services/google/driveService', () => ({ getFileMetadata: getFileMetadataMock }));

const isFlagEnabledMock = vi.hoisted(() => vi.fn(() => false));
vi.mock('@/config/flags', () => ({ isFlagEnabled: isFlagEnabledMock }));

import { usePickBeanpodFile } from '../usePickBeanpodFile';

describe('the silent reconnect is genuinely best-effort', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tryReconnectSilentlyMock.mockResolvedValue(undefined);
    tryGetSilentTokenMock.mockResolvedValue('silent-token');
    shouldUseRedirectAuthMock.mockReturnValue(false);
  });

  it('still reaches the Picker when the reconnect rejects', async () => {
    /**
     * ⚠️ A REJECTION HERE USED TO COST THE JOINER THE PICKER. `tryReconnectSilently` shared the
     * outer try/catch, so an offline device or a Drive blip during an OPTIONAL optimisation
     * returned `{kind:'failed', reason:'auth'}` — even though a perfectly good cached token was
     * one line further down. The comment called it best-effort; the code did not.
     */
    tryReconnectSilentlyMock.mockRejectedValue(new Error('drive unreachable'));
    const { pick } = usePickBeanpodFile();

    const result = await pick({ loginHint: 'joiner@example.com' });

    expect(result.kind).toBe('picked');
    expect(pickBeanpodFileMock).toHaveBeenCalledWith('silent-token');
  });

  it('skips the reconnect entirely when switching accounts', async () => {
    // Seeding a token for the account they are trying to leave is the opposite of the ask.
    const { pick } = usePickBeanpodFile();
    await pick({ chooseAccount: true, loginHint: 'joiner@example.com' });
    expect(tryReconnectSilentlyMock).not.toHaveBeenCalled();
    expect(tryGetSilentTokenMock).not.toHaveBeenCalled();
    expect(requestAccessTokenMock).toHaveBeenCalledWith(
      expect.objectContaining({ chooseAccount: true, loginHint: undefined })
    );
  });

  it('clears isPicking even when the auth chain throws', async () => {
    // The flag drives `useDriveFileReselect.isBusy`, which disables the only recovery button on
    // both pod-failure banners. A latched flag there is an unrecoverable screen.
    tryGetSilentTokenMock.mockRejectedValue(new Error('boom'));
    const { pick, isPicking } = usePickBeanpodFile();
    const result = await pick();
    expect(result.kind).toBe('failed');
    expect(isPicking.value).toBe(false);
  });
});

describe('a closed chooser is a cancel, not a failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tryReconnectSilentlyMock.mockResolvedValue(undefined);
    tryGetSilentTokenMock.mockResolvedValue(null);
    shouldUseRedirectAuthMock.mockReturnValue(false);
  });

  it('reports `cancelled` when the user closes the account chooser', async () => {
    /**
     * ⚠️ `chooseAccount` OPENED A SCREEN PEOPLE CLOSE, and this catch never asked whether they
     * had. `waitForAuthCode` rejects with `Error('Authentication cancelled')`, which
     * `isUserCancellation` matches exactly — but the branch was added with only an
     * `isPopupBlocked` check, so looking at the chooser and changing your mind produced a red
     * error card (`PICKER_AUTH_FAILED` on the join page, an error toast on the pod banners)
     * plus a `reportError`. A scolding for declining, on the screens where people are already
     * stuck. Every other Google-auth call site in the app consults the predicate.
     */
    requestAccessTokenMock.mockRejectedValue(new Error('Authentication cancelled'));
    const { pick } = usePickBeanpodFile();
    const result = await pick({ chooseAccount: true });
    expect(result.kind).toBe('cancelled');
  });

  it('still reports a real auth failure as failed', async () => {
    // The distinction has to cut both ways, or the fix just swallows errors.
    requestAccessTokenMock.mockRejectedValue(new Error('invalid_client'));
    const { pick } = usePickBeanpodFile();
    const result = await pick({ chooseAccount: true });
    expect(result).toMatchObject({ kind: 'failed', reason: 'auth' });
  });
});

describe('the Picker is a LAST resort, not the first step', () => {
  /**
   * ⚠️ THE POINT OF THIS BLOCK. Under `drive.file` the app holds a permanent, server-side
   * grant for any file it CREATED, per Google account. So a pod's owner arriving on a new
   * device with a link that already carries the `fileId` can read it the moment they have a
   * token — there is nothing for a file chooser to add. They were being shown one anyway,
   * because the silent direct read is attempted only BEFORE authentication (where a fresh
   * browser has no token) and nothing retried it once the token existed.
   *
   * These tests pin the rule: if the file can be read directly, the Picker MUST NOT open.
   */
  beforeEach(() => {
    vi.clearAllMocks();
    tryReconnectSilentlyMock.mockResolvedValue(undefined);
    tryGetSilentTokenMock.mockResolvedValue('silent-token');
    shouldUseRedirectAuthMock.mockReturnValue(false);
    // ⚠️ RESTORED EXPLICITLY. `vi.clearAllMocks()` clears recorded CALLS but not
    // implementations, and earlier tests in this file leave `requestAccessToken` REJECTING.
    // Without this line the interactive-token case below silently exercises the auth-failure
    // branch and never reaches the hook it is meant to be testing.
    requestAccessTokenMock.mockResolvedValue('interactive-token');
    pickBeanpodFileMock.mockResolvedValue({
      kind: 'picked' as const,
      fileId: 'f-1',
      fileName: 'family.beanpod',
    });
  });

  it('does NOT open the Picker when the file loads directly', async () => {
    const resolveWithoutPicker = vi.fn(async () => true);
    const { pick } = usePickBeanpodFile();

    const result = await pick({ resolveWithoutPicker });

    expect(resolveWithoutPicker).toHaveBeenCalledWith('silent-token');
    // The assertion that matters: the chooser never opened.
    expect(pickBeanpodFileMock).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: 'loaded' });
  });

  it('DOES open the Picker when the direct read cannot reach the file', async () => {
    // A genuine first join: the joiner has never picked the inviter's file, so their fresh
    // `drive.file` grant cannot reach it by construction. Here the Picker IS the grant, and
    // this path must be completely unchanged.
    const resolveWithoutPicker = vi.fn(async () => false);
    const { pick } = usePickBeanpodFile();

    const result = await pick({ resolveWithoutPicker });

    expect(pickBeanpodFileMock).toHaveBeenCalledWith('silent-token');
    expect(result).toMatchObject({ kind: 'picked', fileId: 'f-1' });
  });

  it('falls through to the Picker if the direct read THROWS', async () => {
    // Degrade, never dead-end: the Picker is the path that has always worked, and this hook
    // is an optimisation. A throwing hook must not cost someone the only way in.
    const resolveWithoutPicker = vi.fn(async () => {
      throw new Error('drive exploded');
    });
    const { pick } = usePickBeanpodFile();

    const result = await pick({ resolveWithoutPicker });

    expect(pickBeanpodFileMock).toHaveBeenCalledWith('silent-token');
    expect(result).toMatchObject({ kind: 'picked' });
  });

  it('runs the direct read with the INTERACTIVE token when there was no silent one', async () => {
    // The reported case exactly: a fresh browser opening a magic link. No silent token, so
    // the pre-auth attempt never tried the fileId; the retry must use the token that
    // consent just produced, or it is testing nothing.
    tryGetSilentTokenMock.mockResolvedValue(null);
    const resolveWithoutPicker = vi.fn(async () => true);
    const { pick } = usePickBeanpodFile();

    const result = await pick({ resolveWithoutPicker });

    expect(requestAccessTokenMock).toHaveBeenCalled();
    expect(resolveWithoutPicker).toHaveBeenCalledWith('interactive-token');
    expect(pickBeanpodFileMock).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: 'loaded' });
  });
});

describe('a joiner must come away with OFFLINE ACCESS', () => {
  /**
   * ⚠️ WHAT THIS PROTECTS. Google returns a `refresh_token` only when the prompt includes
   * `consent`. The join path's default prompt is `select_account` alone, so a joiner whose
   * Google account had already granted these scopes somewhere else got an access token and
   * nothing to refresh it with: Drive worked for about an hour after joining and then stopped,
   * with no toast and no way back. `auth-no-refresh-token` is that failure, already reported.
   *
   * The tension these tests exist to hold: the prompt that fixes it is the same one
   * `chooseAccount` produces, but `chooseAccount` ALSO skips the silent token, and skipping
   * the silent token is what caused the iOS closed consent loop. So `offlineAccess` must
   * change the prompt and nothing else.
   */
  beforeEach(() => {
    vi.clearAllMocks();
    tryReconnectSilentlyMock.mockResolvedValue(undefined);
    shouldUseRedirectAuthMock.mockReturnValue(false);
    requestAccessTokenMock.mockResolvedValue('interactive-token');
    pickBeanpodFileMock.mockResolvedValue({
      kind: 'picked' as const,
      fileId: 'f-1',
      fileName: 'family.beanpod',
    });
  });

  it('forwards offlineAccess to the popup arm', async () => {
    tryGetSilentTokenMock.mockResolvedValue(null);
    const { pick } = usePickBeanpodFile();

    await pick({ offlineAccess: true, loginHint: 'joiner@example.com' });

    expect(requestAccessTokenMock).toHaveBeenCalledWith(
      expect.objectContaining({ offlineAccess: true, chooseAccount: false })
    );
  });

  it('asks the REDIRECT arm for `select_account consent`', async () => {
    // iOS/PWA/native take this arm, and it is the one where the loop was reported — so the
    // prompt has to be right here too, not only in the popup.
    tryGetSilentTokenMock.mockResolvedValue(null);
    shouldUseRedirectAuthMock.mockReturnValue(true);
    const { pick } = usePickBeanpodFile();

    const result = await pick({ offlineAccess: true });

    expect(result).toEqual({ kind: 'redirecting' });
    expect(startRedirectAuthMock).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
      'join',
      expect.objectContaining({ prompt: 'select_account consent' })
    );
  });

  it('does NOT skip the silent token — this is the consent-loop guarantee', async () => {
    /**
     * The one that matters. `chooseAccount` bypasses every silent path; `offlineAccess` must
     * not. If this ever regresses, a redirect platform navigates away instead of opening the
     * Picker, the user comes back, and the loop is closed again with no telemetry.
     */
    tryGetSilentTokenMock.mockResolvedValue('silent-token');
    const { pick } = usePickBeanpodFile();

    await pick({ offlineAccess: true });

    expect(tryGetSilentTokenMock).toHaveBeenCalled();
    // The cached token was good, so no interactive call happened at all.
    expect(requestAccessTokenMock).not.toHaveBeenCalled();
    expect(startRedirectAuthMock).not.toHaveBeenCalled();
    expect(pickBeanpodFileMock).toHaveBeenCalledWith('silent-token');
  });
});

/**
 * The system-browser Picker branch. Google permits `drive.file` ALONE on a onepick request and
 * forbids combining it with any other scope, so these assertions are the compile-time-adjacent
 * guard on a rule that is otherwise only written in a comment.
 */
describe('usePickBeanpodFile — the system-browser picker (flag on)', () => {
  beforeEach(() => {
    // Clear BEFORE setting return values: these mocks are shared with the suites above, so their
    // call counts would otherwise leak in and every `not.toHaveBeenCalled()` here would be a lie.
    pickBeanpodFileMock.mockClear();
    startRedirectAuthMock.mockClear();
    tryGetSilentTokenMock.mockClear();
    getFileMetadataMock.mockClear();
    isFlagEnabledMock.mockReturnValue(true);
    tryGetSilentTokenMock.mockResolvedValue('silent-token');
    shouldUseRedirectAuthMock.mockReturnValue(false);
    sessionStorage.clear();
  });
  afterEach(() => isFlagEnabledMock.mockReturnValue(false));

  it('redirects to Google with trigger_onepick and EXACTLY the drive.file scope', async () => {
    const { pick } = usePickBeanpodFile();
    const result = await pick();

    expect(result).toEqual({ kind: 'redirecting' });
    // Never the iframe Picker on this branch.
    expect(pickBeanpodFileMock).not.toHaveBeenCalled();

    const [, loginHint, mode, opts] = startRedirectAuthMock.mock.calls[0] as [
      string,
      string | undefined,
      string,
      { grant: string; scope: string; extraParams: Record<string, string> },
    ];
    expect(mode).toBe('join');
    expect(opts.grant).toBe('picker');
    expect(opts.extraParams).toEqual({ trigger_onepick: 'true' });
    // ⚠️ THE RULE: drive.file and nothing else. A future scope addition must fail HERE, loudly,
    // rather than at Google with an opaque rejection in front of a joiner.
    expect(opts.scope).toBe('https://www.googleapis.com/auth/drive.file');
    expect(opts.scope).not.toContain('userinfo.email');
    // Pinned to the account the app holds a token for.
    expect(loginHint).toBe('joiner@example.com');
  });

  /**
   * greg's two observations from the first real run, both fixed here and both pinned so they
   * cannot silently regress:
   *   1. the account chooser had no pre-selection, so he had to find his own address in a list;
   *   2. the picker opened on his whole Drive and he had to hunt across tabs and folders for a
   *      `.beanpod` he had never seen.
   * CLAUDE.md's cloud-auth rule asks for (1) explicitly whenever the identity is known, and on a
   * join it always is: the inviter typed it and it rides the invite link.
   */
  it('pre-selects the account and filters to the one file the joiner came for', async () => {
    const { pick } = usePickBeanpodFile();
    await pick({ loginHint: 'invitee@example.com', expectedFileId: 'THE_POD' });

    const [, loginHint, , opts] = startRedirectAuthMock.mock.calls[0] as [
      string,
      string | undefined,
      string,
      { extraParams: Record<string, string> },
    ];
    expect(loginHint).toBe('joiner@example.com'); // verified account wins when it is known
    expect(opts.extraParams.file_ids).toBe('THE_POD');
    expect(opts.extraParams.trigger_onepick).toBe('true');
  });

  it('falls back to the invite hint when the token account is not verified', async () => {
    getEmailVerifiedForTokenMock.mockReturnValueOnce(null);
    const { pick } = usePickBeanpodFile();
    await pick({ loginHint: 'invitee@example.com' });

    const [, loginHint] = startRedirectAuthMock.mock.calls[0] as [string, string | undefined];
    // Without this the chooser opens with nothing pre-selected, which is what greg hit.
    expect(loginHint).toBe('invitee@example.com');
  });

  it('omits the file filter when the caller does not know the id (the recovery banners)', async () => {
    const { pick } = usePickBeanpodFile();
    await pick();

    const [, , , opts] = startRedirectAuthMock.mock.calls[0] as [
      string,
      string | undefined,
      string,
      { extraParams: Record<string, string> },
    ];
    // There the user genuinely IS choosing, so an unfiltered picker is correct.
    expect(opts.extraParams.file_ids).toBeUndefined();
  });

  it('consumes a parked selection FIRST, without the auth chain or the iframe picker', async () => {
    sessionStorage.setItem(
      'beanies_redirect_auth_code:picker',
      JSON.stringify({ ids: 'FILE_Z', ts: Date.now() })
    );

    const { pick } = usePickBeanpodFile();
    const result = await pick();

    expect(result).toMatchObject({ kind: 'picked', fileId: 'FILE_Z' });
    expect(startRedirectAuthMock).not.toHaveBeenCalled();
    expect(pickBeanpodFileMock).not.toHaveBeenCalled();
  });

  /**
   * ⚠️ THIS IS A SAFETY GUARD, NOT COSMETICS. Google's onepick return carries ids only, so a
   * picked file arrives with `fileName: ''`. The ONLY gate stopping a rebind onto a compaction
   * safety copy is `isSafetyCopyName`, which is NAME-based, and `isSafetyCopyName('')` is false.
   * Without this resolve, picking `family (before compacting).beanpod` would re-home the whole
   * family onto its own backup: the ADR-033 fork that guard exists to prevent.
   */
  it('puts the real file NAME back on a picker return', async () => {
    sessionStorage.setItem(
      'beanies_redirect_auth_code:picker',
      JSON.stringify({ ids: 'FILE_Z', ts: Date.now() })
    );
    getFileMetadataMock.mockResolvedValueOnce({ name: 'family (before compacting).beanpod' });

    const { pick } = usePickBeanpodFile();
    const result = await pick();

    expect(result).toMatchObject({
      kind: 'picked',
      fileId: 'FILE_Z',
      fileName: 'family (before compacting).beanpod',
    });
  });

  it('leaves the name blank when there is no token to ask Drive with', async () => {
    sessionStorage.setItem(
      'beanies_redirect_auth_code:picker',
      JSON.stringify({ ids: 'FILE_Z', ts: Date.now() })
    );
    tryGetSilentTokenMock.mockResolvedValueOnce(null);

    const { pick } = usePickBeanpodFile();
    expect(await pick()).toMatchObject({ kind: 'picked', fileId: 'FILE_Z', fileName: '' });
    expect(getFileMetadataMock).not.toHaveBeenCalled();
  });

  it('leaves the name blank when Drive cannot answer, so the owning layer refuses safely', async () => {
    sessionStorage.setItem(
      'beanies_redirect_auth_code:picker',
      JSON.stringify({ ids: 'FILE_Z', ts: Date.now() })
    );
    getFileMetadataMock.mockRejectedValueOnce(new Error('drive down'));

    const { pick } = usePickBeanpodFile();
    // Resolves structured rather than throwing; `rebindPodFile` fails closed on the empty name.
    expect(await pick()).toMatchObject({ kind: 'picked', fileId: 'FILE_Z', fileName: '' });
  });

  /**
   * "Sign in with a different Google account" is reached only by someone already stuck. Consuming
   * a parked result there answers a question they did not ask, and after a cancel it would tell
   * them they cancelled instead of showing the chooser.
   */
  /**
   * ⚠️ DISCARDED, NOT STEPPED OVER, and the difference is a cross-ACCOUNT bug. Leaving the stash
   * parked keeps account A's file id alive for five minutes; the next ordinary pick then consumes
   * it under account B's token and the join binds to a file the new account may not be able to
   * read. Asserting the key is GONE catches that; asserting "some other path ran" does not.
   */
  it('DISCARDS a parked result when the user asked to switch accounts', async () => {
    sessionStorage.setItem(
      'beanies_redirect_auth_code:picker',
      JSON.stringify({ ids: 'FILE_FROM_ACCOUNT_A', ts: Date.now() })
    );

    const { pick } = usePickBeanpodFile();
    const result = await pick({ chooseAccount: true });

    expect(sessionStorage.getItem('beanies_redirect_auth_code:picker')).toBeNull();
    expect(result).toEqual({ kind: 'redirecting' });
  });

  /**
   * `pick()` promises to ALWAYS resolve structured, and none of its three callers wraps it.
   * `startRedirectAuth` can genuinely throw (sessionStorage in iOS private browsing, Browser.open,
   * the PKCE challenge). Unhandled it would reject out of a bare `@click` and strand the step at
   * 'authenticating' with no error and no telemetry: the exact symptom Phase 1 removes.
   */
  it('returns a structured failure when the redirect cannot even start', async () => {
    startRedirectAuthMock.mockRejectedValueOnce(new DOMException('QuotaExceededError'));
    const { pick } = usePickBeanpodFile();
    const result = await pick();
    // `'iframe'` → PICKER_IFRAME_BLOCKED at 'warning', NOT `'open'` → PICKER_FAILED at 'critical'.
    // The realistic cause is iOS private browsing refusing sessionStorage: a platform condition,
    // not a fault, and paging a developer for it is the mis-set this change removed elsewhere.
    expect(result).toMatchObject({ kind: 'failed', reason: 'iframe' });
  });

  it('reports a cancelled picker as cancelled, never as a silent no-op', async () => {
    sessionStorage.setItem(
      'beanies_redirect_auth_code:picker',
      JSON.stringify({ ids: '', ts: Date.now() })
    );
    const { pick } = usePickBeanpodFile();
    expect(await pick()).toEqual({ kind: 'cancelled' });
  });

  it('still prefers a direct read: resolveWithoutPicker wins over the redirect', async () => {
    const { pick } = usePickBeanpodFile();
    const result = await pick({ resolveWithoutPicker: async () => true });
    expect(result).toEqual({ kind: 'loaded' });
    expect(startRedirectAuthMock).not.toHaveBeenCalled();
  });
});
