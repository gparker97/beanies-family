/**
 * The pick primitive, tested against the layer BELOW it.
 *
 * ⚠️ WHY THIS FILE EXISTS. The guarantees here were previously asserted from
 * `useJoinFlow.test.ts`, which `vi.mock`s this composable wholesale — so every assertion about
 * its internals ran against a stub and could not fail. A test that mocks the thing under test
 * is shaped like whatever we believed on the day we wrote it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

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
}));
vi.mock('@/services/google/drivePicker', () => ({
  pickBeanpodFile: (t: string) => pickBeanpodFileMock(t),
}));

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
