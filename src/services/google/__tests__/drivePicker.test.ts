import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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
