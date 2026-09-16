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
