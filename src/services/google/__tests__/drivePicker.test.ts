import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const fetchGoogleUserEmailMock = vi.fn(
  async (_token: string) => 'joiner@example.com' as string | null
);
/**
 * Verified-for-THIS-token lookup. Mocked separately from `fetchGoogleUserEmail` on purpose:
 * the two disagreeing IS the bug being guarded. `fetchGoogleUserEmail` falls back to a cached
 * email on every failure path with no token check, so the Picker must read the account through
 * this one or a userinfo blip pins it to whoever the cache last held.
 */
const getEmailVerifiedForTokenMock = vi.fn(
  (_token: string) => 'joiner@example.com' as string | null
);
vi.mock('@/services/google/googleAuth', () => ({
  fetchGoogleUserEmail: (token: string) => fetchGoogleUserEmailMock(token),
  getEmailVerifiedForToken: (token: string) => getEmailVerifiedForTokenMock(token),
}));
const logEventMock = vi.fn();
vi.mock('@/services/telemetry', () => ({ logEvent: (...a: unknown[]) => logEventMock(...a) }));

// Reset module state between tests
let drivePicker: typeof import('../drivePicker');

// Mock google.picker namespace
function mockPickerNamespace(onBuild?: (callback: (data: unknown) => void) => void) {
  const mockPicker = { setVisible: vi.fn() };

  const mockBuilder = {
    addView: vi.fn().mockReturnThis(),
    setOAuthToken: vi.fn().mockReturnThis(),
    setDeveloperKey: vi.fn().mockReturnThis(),
    setOrigin: vi.fn().mockReturnThis(),
    setAppId: vi.fn().mockReturnThis(),
    setAuthUser: vi.fn().mockReturnThis(),
    setCallback: vi.fn().mockReturnThis(),
    build: vi.fn(() => {
      if (onBuild) {
        // Call the callback that was registered via setCallback
        const callback = mockBuilder.setCallback.mock.calls[0]?.[0];
        if (callback) onBuild(callback);
      }
      return mockPicker;
    }),
  };

  const mockDocsView = {
    setQuery: vi.fn().mockReturnThis(),
    setMimeTypes: vi.fn().mockReturnThis(),
    setOwnedByMe: vi.fn().mockReturnThis(),
    setMode: vi.fn().mockReturnThis(),
  };

  (globalThis as Record<string, unknown>).google = {
    picker: {
      PickerBuilder: vi.fn(function () {
        return mockBuilder;
      }),
      DocsView: vi.fn(function () {
        return mockDocsView;
      }),
      ViewId: { DOCS: 'all' },
      Action: { PICKED: 'picked', CANCEL: 'cancel', LOADED: 'loaded' },
      DocsViewMode: { LIST: 'list', GRID: 'grid' },
    },
  };

  (globalThis as Record<string, unknown>).gapi = {
    load: vi.fn((_api: string, cb: () => void) => cb()),
  };

  return { mockBuilder, mockDocsView, mockPicker };
}

describe('drivePicker', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('VITE_GOOGLE_API_KEY', 'test-api-key');
    vi.stubEnv('VITE_GOOGLE_PROJECT_NUMBER', '123456789');
    // Ensure gapi is defined so script loading is skipped
    (globalThis as Record<string, unknown>).gapi = {
      load: vi.fn((_api: string, cb: () => void) => cb()),
    };
    drivePicker = await import('../drivePicker');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    delete (globalThis as Record<string, unknown>).google;
    delete (globalThis as Record<string, unknown>).gapi;
  });

  it('script loads only once (idempotent)', async () => {
    // Mock that always triggers cancel for each build call
    const mockPicker = { setVisible: vi.fn() };
    const mockBuilder = {
      addView: vi.fn().mockReturnThis(),
      setOAuthToken: vi.fn().mockReturnThis(),
      setDeveloperKey: vi.fn().mockReturnThis(),
      setOrigin: vi.fn().mockReturnThis(),
      setAppId: vi.fn().mockReturnThis(),
      setAuthUser: vi.fn().mockReturnThis(),
      setCallback: vi.fn().mockReturnThis(),
      build: vi.fn(function () {
        // Always resolve with cancel using the most recent callback
        const lastCallIdx = mockBuilder.setCallback.mock.calls.length - 1;
        const callback = mockBuilder.setCallback.mock.calls[lastCallIdx]?.[0];
        if (callback) callback({ action: 'cancel' });
        return mockPicker;
      }),
    };
    const mockDocsView = {
      setQuery: vi.fn().mockReturnThis(),
      setMimeTypes: vi.fn().mockReturnThis(),
      setOwnedByMe: vi.fn().mockReturnThis(),
      setMode: vi.fn().mockReturnThis(),
    };

    (globalThis as Record<string, unknown>).google = {
      picker: {
        PickerBuilder: vi.fn(function () {
          return mockBuilder;
        }),
        DocsView: vi.fn(function () {
          return mockDocsView;
        }),
        ViewId: { DOCS: 'all' },
        Action: { PICKED: 'picked', CANCEL: 'cancel', LOADED: 'loaded' },
        DocsViewMode: { LIST: 'list', GRID: 'grid' },
      },
    };

    await drivePicker.pickBeanpodFile('token-1');
    await drivePicker.pickBeanpodFile('token-2');

    // gapi.load should have been called exactly twice (once per pickBeanpodFile)
    // but the script loading promise is cached, so the actual <script> insertion is skipped
    expect(gapi.load).toHaveBeenCalledTimes(2);
  });

  it('opens Picker with correct config', async () => {
    const { mockBuilder, mockDocsView } = mockPickerNamespace((callback) => {
      callback({ action: 'cancel' });
    });

    await drivePicker.pickBeanpodFile('test-token');

    expect(mockBuilder.setOAuthToken).toHaveBeenCalledWith('test-token');
    expect(mockBuilder.setDeveloperKey).toHaveBeenCalledWith('test-api-key');
    expect(mockBuilder.setOrigin).toHaveBeenCalledWith(window.location.origin);
    expect(mockDocsView.setQuery).toHaveBeenCalledWith('*.beanpod');
    // Two views added: shared files (ownedByMe=false) + my drive (ownedByMe=true)
    expect(mockBuilder.addView).toHaveBeenCalledTimes(2);
  });

  it("returns { kind: 'picked' } on selection", async () => {
    mockPickerNamespace((callback) => {
      callback({
        action: 'picked',
        docs: [{ id: 'file-123', name: 'family.beanpod', mimeType: 'application/octet-stream' }],
      });
    });

    const result = await drivePicker.pickBeanpodFile('test-token');
    expect(result).toEqual({ kind: 'picked', fileId: 'file-123', fileName: 'family.beanpod' });
  });

  it("LOADED-then-CANCEL → { kind: 'cancelled' } (real user cancel)", async () => {
    mockPickerNamespace((callback) => {
      callback({ action: 'loaded' });
      callback({ action: 'cancel' });
    });

    const result = await drivePicker.pickBeanpodFile('test-token');
    expect(result).toEqual({ kind: 'cancelled' });
  });

  it("CANCEL without prior LOADED → { kind: 'failed', reason: 'iframe' } (iOS WebKit symptom)", async () => {
    mockPickerNamespace((callback) => {
      // No LOADED ever fires — Picker iframe couldn't bootstrap.
      callback({ action: 'cancel' });
    });

    const result = await drivePicker.pickBeanpodFile('test-token');
    expect(result).toMatchObject({ kind: 'failed', reason: 'iframe' });
    if (result.kind === 'failed') expect(result.message).toBeTruthy();
  });

  it("missing API key → { kind: 'failed', reason: 'config' } with explanatory message", async () => {
    vi.stubEnv('VITE_GOOGLE_API_KEY', '');
    vi.resetModules();
    drivePicker = await import('../drivePicker');

    const result = await drivePicker.pickBeanpodFile('test-token');
    expect(result).toMatchObject({ kind: 'failed', reason: 'config' });
    if (result.kind === 'failed') expect(result.message).toMatch(/VITE_GOOGLE_API_KEY/);
  });

  it("Picker open throws → { kind: 'failed', reason: 'open' } carrying the underlying message", async () => {
    // Set up google.picker so the PickerBuilder constructor throws.
    // DocsView must be a `function` (constructible) — arrow functions
    // cannot be invoked with `new` and would throw before PickerBuilder.
    function DocsViewCtor(this: Record<string, unknown>) {
      this.setQuery = vi.fn().mockReturnThis();
      this.setMimeTypes = vi.fn().mockReturnThis();
      this.setOwnedByMe = vi.fn().mockReturnThis();
      this.setMode = vi.fn().mockReturnThis();
    }
    (globalThis as Record<string, unknown>).google = {
      picker: {
        PickerBuilder: vi.fn(function () {
          throw new Error('builder boom');
        }),
        DocsView: DocsViewCtor,
        ViewId: { DOCS: 'all' },
        Action: { PICKED: 'picked', CANCEL: 'cancel', LOADED: 'loaded' },
        DocsViewMode: { LIST: 'list', GRID: 'grid' },
      },
    };

    const result = await drivePicker.pickBeanpodFile('test-token');
    expect(result).toMatchObject({ kind: 'failed', reason: 'open', message: 'builder boom' });
  });

  it("no callback within 30s → { kind: 'failed', reason: 'timeout' }", async () => {
    vi.useFakeTimers();
    mockPickerNamespace(() => {
      // never invoke callback
    });

    const promise = drivePicker.pickBeanpodFile('test-token');
    // Advance past 30 s. The library load (gapi.load) is sync (cb is invoked
    // synchronously in the mock above), so the timeout starts almost
    // immediately. We need to flush microtasks AND advance timers.
    await vi.advanceTimersByTimeAsync(30_001);
    const result = await promise;
    expect(result).toMatchObject({ kind: 'failed', reason: 'timeout' });
    if (result.kind === 'failed') expect(result.message).toMatch(/30000ms/);
    vi.useRealTimers();
  });

  it('passes login_hint via setOAuthToken (no separate plumbing needed)', async () => {
    // login_hint plumbing happens at the OAuth layer, before pickBeanpodFile.
    // pickBeanpodFile itself just receives the token. Verify the token
    // propagates to setOAuthToken.
    const { mockBuilder } = mockPickerNamespace((callback) => {
      callback({ action: 'loaded' });
      callback({ action: 'cancel' });
    });
    await drivePicker.pickBeanpodFile('hint-token');
    expect(mockBuilder.setOAuthToken).toHaveBeenCalledWith('hint-token');
  });
});

describe('the Picker is pinned to the account that consented', () => {
  /**
   * ⚠️ THE BUG THIS PINS, and it blocked joining outright. `setOAuthToken` decides which account
   * receives the `drive.file` grant on selection; it does NOT decide what the Picker LISTS. The
   * iframe enumerates with the browser's own Google session cookies, so on a browser holding
   * several Google sessions it defaults to account index 0. When that is the pod owner,
   * "Shared with me" is legitimately empty for it (the owner owns the `.beanpod`), the joiner
   * sees an empty chooser, and there is no way forward. Reproduced with a clean invitee account;
   * signing out of every other Google account made the file appear immediately.
   */
  // ⚠️ ITS OWN SETUP, not the block above's. A `beforeEach` does not reach a sibling
  // describe, so leaning on it only works while the whole file runs in order and breaks under
  // `-t` or `.only` — the two ways anyone runs a single test while fixing one. It also left
  // `VITE_GOOGLE_PROJECT_NUMBER` unstubbed here, which silently retired the `setAppId` guard.
  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('VITE_GOOGLE_API_KEY', 'test-api-key');
    vi.stubEnv('VITE_GOOGLE_PROJECT_NUMBER', '123456789');
    (globalThis as Record<string, unknown>).gapi = {
      load: vi.fn((_api: string, cb: () => void) => cb()),
    };
    drivePicker = await import('../drivePicker');
    fetchGoogleUserEmailMock.mockReset().mockResolvedValue('joiner@example.com');
    getEmailVerifiedForTokenMock.mockReset().mockReturnValue('joiner@example.com');
    logEventMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    delete (globalThis as Record<string, unknown>).google;
    delete (globalThis as Record<string, unknown>).gapi;
  });

  it('pins to the token account, not to whichever session the browser prefers', async () => {
    const { mockBuilder } = mockPickerNamespace();
    void drivePicker.pickBeanpodFile('tok-joiner');
    await vi.waitFor(() => expect(mockBuilder.build).toHaveBeenCalled());

    expect(mockBuilder.setAuthUser).toHaveBeenCalledWith('joiner@example.com');
    // Resolved from the TOKEN the grant will land on. Any other source (the inviter's typed
    // hint, a primed cache) can name an account nobody intended, which is the bug itself.
    expect(fetchGoogleUserEmailMock).toHaveBeenCalledWith('tok-joiner');
  });

  it('still sets appId, which the grant depends on', async () => {
    // A fix for the pin once deleted this line in passing. The Picker UI works without it and
    // the selection silently grants nothing, so nothing downstream would have noticed.
    const { mockBuilder } = mockPickerNamespace();
    void drivePicker.pickBeanpodFile('tok-joiner');
    await vi.waitFor(() => expect(mockBuilder.build).toHaveBeenCalled());
    expect(mockBuilder.setAppId).toHaveBeenCalledWith('123456789');
  });

  it('still opens the Picker, and says so, when the account cannot be resolved', async () => {
    // A userinfo blip must cost a joiner nothing worse than the old behaviour — but unpinned is
    // exactly the broken state, so it can never be silent.
    fetchGoogleUserEmailMock.mockResolvedValue(null);
    getEmailVerifiedForTokenMock.mockReturnValue(null);
    const { mockBuilder } = mockPickerNamespace();
    void drivePicker.pickBeanpodFile('tok-joiner');
    await vi.waitFor(() => expect(mockBuilder.build).toHaveBeenCalled());

    expect(mockBuilder.setAuthUser).not.toHaveBeenCalled();
    expect(logEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        context: expect.objectContaining({ action: 'picker_authuser_unpinned' }),
      })
    );
  });

  it('survives a Picker build that no longer offers setAuthUser', async () => {
    // `google-picker.d.ts` is hand-written, so it cannot notice Google withdrawing a method.
    // The call is feature-detected; this proves the detection, not the typedef.
    const { mockBuilder, mockPicker } = mockPickerNamespace();
    delete (mockBuilder as { setAuthUser?: unknown }).setAuthUser;
    void drivePicker.pickBeanpodFile('tok-joiner');
    await vi.waitFor(() => expect(mockBuilder.build).toHaveBeenCalled());
    // The chooser still opens. Degraded to the old behaviour, never a thrown TypeError on the
    // one screen a joiner cannot get past.
    await vi.waitFor(() => expect(mockPicker.setVisible).toHaveBeenCalledWith(true));
  });
});

describe('the pin cannot be poisoned by a stale or unverified email', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('VITE_GOOGLE_API_KEY', 'test-api-key');
    vi.stubEnv('VITE_GOOGLE_PROJECT_NUMBER', '123456789');
    (globalThis as Record<string, unknown>).gapi = {
      load: vi.fn((_api: string, cb: () => void) => cb()),
    };
    drivePicker = await import('../drivePicker');
    fetchGoogleUserEmailMock.mockReset().mockResolvedValue('joiner@example.com');
    getEmailVerifiedForTokenMock.mockReset().mockReturnValue('joiner@example.com');
    logEventMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    delete (globalThis as Record<string, unknown>).google;
    delete (globalThis as Record<string, unknown>).gapi;
  });

  it('does NOT pin when userinfo fell back to a cached email from another account', async () => {
    /**
     * ⚠️ THE FIX REPRODUCING ITS OWN BUG. `fetchGoogleUserEmail` returns `cachedEmail` on
     * `!res.ok`, on a throw, and on an empty `data.email` — none of which re-check the token.
     * `GoogleDriveProvider.fromExisting` primes that cache, and it can hold the FILE OWNER's
     * address. So a joiner whose userinfo call 401s would have had the Picker pinned to the
     * owner's Drive, whose "Shared with me" is legitimately empty: the exact empty chooser this
     * pinning exists to prevent, now deterministic instead of intermittent.
     */
    fetchGoogleUserEmailMock.mockResolvedValue('pod-owner@example.com'); // the stale fallback
    getEmailVerifiedForTokenMock.mockReturnValue(null); // nothing proven for THIS token
    const { mockBuilder } = mockPickerNamespace();
    void drivePicker.pickBeanpodFile('tok-joiner');
    await vi.waitFor(() => expect(mockBuilder.build).toHaveBeenCalled());

    expect(mockBuilder.setAuthUser).not.toHaveBeenCalled();
    expect(logEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        context: expect.objectContaining({ action: 'picker_authuser_unpinned' }),
      })
    );
  });

  it('opens the Picker anyway when userinfo hangs, instead of hanging with it', async () => {
    /**
     * ⚠️ The resolve runs BEFORE `PICKER_TIMEOUT_MS` is armed, so an untimed fetch here hung
     * `pickBeanpodFile` forever: no result, no telemetry, and `usePickBeanpodFile`'s
     * `finally { isPicking = false }` never ran — latching the SaveFailureBanner's only
     * recovery button disabled at '...' until a reload.
     */
    vi.useFakeTimers();
    try {
      fetchGoogleUserEmailMock.mockImplementation(() => new Promise<string | null>(() => {}));
      getEmailVerifiedForTokenMock.mockReturnValue(null);
      const { mockBuilder } = mockPickerNamespace();
      void drivePicker.pickBeanpodFile('tok-joiner');
      await vi.advanceTimersByTimeAsync(5_000);
      expect(mockBuilder.build).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
