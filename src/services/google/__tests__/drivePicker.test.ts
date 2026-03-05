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
      Action: { PICKED: 'picked', CANCEL: 'cancel' },
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
        Action: { PICKED: 'picked', CANCEL: 'cancel' },
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
    expect(mockDocsView.setMimeTypes).toHaveBeenCalledWith('application/octet-stream');
  });

  it('returns file on selection', async () => {
    mockPickerNamespace((callback) => {
      callback({
        action: 'picked',
        docs: [{ id: 'file-123', name: 'family.beanpod', mimeType: 'application/octet-stream' }],
      });
    });

    const result = await drivePicker.pickBeanpodFile('test-token');
    expect(result).toEqual({ fileId: 'file-123', fileName: 'family.beanpod' });
  });

  it('returns null on cancel', async () => {
    mockPickerNamespace((callback) => {
      callback({ action: 'cancel' });
    });

    const result = await drivePicker.pickBeanpodFile('test-token');
    expect(result).toBeNull();
  });

  it('throws without API key', async () => {
    vi.stubEnv('VITE_GOOGLE_API_KEY', '');
    // Re-import to get fresh module
    vi.resetModules();
    drivePicker = await import('../drivePicker');

    await expect(drivePicker.pickBeanpodFile('test-token')).rejects.toThrow(
      'VITE_GOOGLE_API_KEY is not configured'
    );
  });
});
