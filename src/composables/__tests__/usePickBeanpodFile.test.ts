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
