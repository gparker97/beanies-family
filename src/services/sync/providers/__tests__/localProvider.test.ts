import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LocalStorageProvider, classifyFileError } from '../localProvider';

// Mock fileHandleStore
vi.mock('../../fileHandleStore', () => ({
  storeFileHandle: vi.fn(async () => {}),
  clearFileHandle: vi.fn(async () => {}),
  clearProviderConfig: vi.fn(async () => {}),
  verifyPermission: vi.fn(async () => true),
}));

// Mock errorReporter so write/read failure tests don't fire real Slack POSTs
vi.mock('@/utils/errorReporter', () => ({
  reportError: vi.fn(),
}));

function createMockHandle(
  options: {
    name?: string;
    fileText?: string;
    permission?: PermissionState;
  } = {}
): FileSystemFileHandle {
  const {
    name = 'test.beanpod',
    fileText = '{"version":"4.0","exportedAt":"2026-01-01T00:00:00Z","encrypted":false,"data":{}}',
    permission = 'granted',
  } = options;

  const mockFile = {
    text: vi.fn().mockResolvedValue(fileText),
    lastModified: new Date('2026-01-01T00:00:00Z').getTime(),
    size: fileText.length,
  };

  const mockWritable = {
    write: vi.fn().mockResolvedValue(undefined),
    truncate: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };

  return {
    kind: 'file',
    name,
    getFile: vi.fn().mockResolvedValue(mockFile),
    createWritable: vi.fn().mockResolvedValue(mockWritable),
    queryPermission: vi.fn().mockResolvedValue(permission),
    requestPermission: vi.fn().mockResolvedValue(permission),
    isSameEntry: vi.fn(),
  } as unknown as FileSystemFileHandle;
}

describe('LocalStorageProvider', () => {
  let provider: LocalStorageProvider;
  let mockHandle: FileSystemFileHandle;

  beforeEach(() => {
    mockHandle = createMockHandle();
    provider = new LocalStorageProvider(mockHandle);
  });

  it('has type "local"', () => {
    expect(provider.type).toBe('local');
  });

  describe('write', () => {
    it('writes content via createWritable', async () => {
      await provider.write('{"test":"data"}');

      expect(mockHandle.createWritable).toHaveBeenCalledWith({ keepExistingData: false });
      const writable = await (mockHandle.createWritable as ReturnType<typeof vi.fn>).mock
        .results[0]!.value;
      expect(writable.write).toHaveBeenCalledTimes(2); // seek + write
      expect(writable.truncate).toHaveBeenCalled();
      expect(writable.close).toHaveBeenCalled();
    });
  });

  describe('read', () => {
    it('reads file text', async () => {
      const content = await provider.read();
      expect(content).toContain('version');
      expect(mockHandle.getFile).toHaveBeenCalled();
    });

    it('returns null for empty file', async () => {
      const emptyHandle = createMockHandle({ fileText: '   ' });
      const emptyProvider = new LocalStorageProvider(emptyHandle);

      const content = await emptyProvider.read();
      expect(content).toBeNull();
    });
  });

  describe('getLastModified', () => {
    it('returns file lastModified as ISO string', async () => {
      const timestamp = await provider.getLastModified();
      // File mock has lastModified set to 2026-01-01T00:00:00Z
      expect(timestamp).toBe(new Date('2026-01-01T00:00:00Z').toISOString());
    });

    it('returns null for empty file', async () => {
      const emptyHandle = createMockHandle({ fileText: '' });
      // Override size to 0 for empty file
      const mockFile = { text: vi.fn(), lastModified: 0, size: 0 };
      (emptyHandle.getFile as ReturnType<typeof vi.fn>).mockResolvedValue(mockFile);
      const emptyProvider = new LocalStorageProvider(emptyHandle);

      const timestamp = await emptyProvider.getLastModified();
      expect(timestamp).toBeNull();
    });
  });

  describe('isReady', () => {
    it('returns true when permission is granted', async () => {
      expect(await provider.isReady()).toBe(true);
    });

    it('returns false when permission is denied', async () => {
      const deniedHandle = createMockHandle({ permission: 'denied' });
      const deniedProvider = new LocalStorageProvider(deniedHandle);

      expect(await deniedProvider.isReady()).toBe(false);
    });
  });

  describe('getDisplayName', () => {
    it('returns the file name', () => {
      expect(provider.getDisplayName()).toBe('test.beanpod');
    });
  });

  describe('getFileId', () => {
    it('returns null (local files have no Drive ID)', () => {
      expect(provider.getFileId()).toBeNull();
    });
  });

  describe('getHandle', () => {
    it('returns the underlying FileSystemFileHandle', () => {
      expect(provider.getHandle()).toBe(mockHandle);
    });
  });

  describe('fromHandle', () => {
    it('creates a provider from an existing handle', () => {
      const p = LocalStorageProvider.fromHandle(mockHandle);
      expect(p).toBeInstanceOf(LocalStorageProvider);
      expect(p.getHandle()).toBe(mockHandle);
    });
  });

  describe('error handling — classified failures', () => {
    // Helper: build a DOMException-like Error with a specific name (vitest's
    // happy-dom DOMException isn't always available; fake it via Error).
    function namedError(name: string, message = 'simulated'): Error {
      const e = new Error(message);
      e.name = name;
      return e;
    }

    describe('write()', () => {
      it('classifies NotAllowedError as permission, clears handle, re-throws', async () => {
        const { reportError } = await import('@/utils/errorReporter');
        const { clearFileHandle } = await import('../../fileHandleStore');
        const failingHandle = createMockHandle();
        (failingHandle.createWritable as ReturnType<typeof vi.fn>).mockRejectedValue(
          namedError('NotAllowedError')
        );
        const p = new LocalStorageProvider(failingHandle);

        await expect(p.write('x')).rejects.toThrow('simulated');
        expect(reportError).toHaveBeenCalledWith(
          expect.objectContaining({
            surface: 'local-file',
            message: 'write failed (permission)',
            severity: 'error',
            context: { action: 'write' },
          })
        );
        expect(clearFileHandle).toHaveBeenCalled();
      });

      it('classifies QuotaExceededError as quota, does NOT clear handle, re-throws', async () => {
        const { reportError } = await import('@/utils/errorReporter');
        const { clearFileHandle } = await import('../../fileHandleStore');
        vi.mocked(clearFileHandle).mockClear();
        const failingHandle = createMockHandle();
        (failingHandle.createWritable as ReturnType<typeof vi.fn>).mockRejectedValue(
          namedError('QuotaExceededError')
        );
        const p = new LocalStorageProvider(failingHandle);

        await expect(p.write('x')).rejects.toThrow('simulated');
        expect(reportError).toHaveBeenCalledWith(
          expect.objectContaining({
            message: 'write failed (quota)',
            severity: 'warning',
          })
        );
        expect(clearFileHandle).not.toHaveBeenCalled();
      });
    });

    describe('read()', () => {
      it('classifies NotFoundError as stale, clears handle, re-throws', async () => {
        const { reportError } = await import('@/utils/errorReporter');
        const { clearFileHandle } = await import('../../fileHandleStore');
        vi.mocked(clearFileHandle).mockClear();
        const failingHandle = createMockHandle();
        (failingHandle.getFile as ReturnType<typeof vi.fn>).mockRejectedValue(
          namedError('NotFoundError')
        );
        const p = new LocalStorageProvider(failingHandle);

        await expect(p.read()).rejects.toThrow('simulated');
        expect(reportError).toHaveBeenCalledWith(
          expect.objectContaining({
            surface: 'local-file',
            message: 'read failed (stale)',
            context: { action: 'read' },
          })
        );
        expect(clearFileHandle).toHaveBeenCalled();
      });

      it('classifies unknown error as unknown, does NOT clear handle, re-throws', async () => {
        const { reportError } = await import('@/utils/errorReporter');
        const { clearFileHandle } = await import('../../fileHandleStore');
        vi.mocked(clearFileHandle).mockClear();
        const failingHandle = createMockHandle();
        (failingHandle.getFile as ReturnType<typeof vi.fn>).mockRejectedValue(
          namedError('SomeRandomError')
        );
        const p = new LocalStorageProvider(failingHandle);

        await expect(p.read()).rejects.toThrow('simulated');
        expect(reportError).toHaveBeenCalledWith(
          expect.objectContaining({ message: 'read failed (unknown)' })
        );
        expect(clearFileHandle).not.toHaveBeenCalled();
      });
    });
  });
});

describe('classifyFileError', () => {
  // Table-driven: single source of truth for the error-classification rules.
  // Adding a new error type means adding a row here AND the corresponding
  // case in classifyFileError; mismatch surfaces as a test failure.
  const cases: Array<{
    name: string;
    expectedKind: 'permission' | 'quota' | 'stale' | 'corrupted' | 'unknown';
    expectedClearHandle: boolean;
    expectedSeverity: 'warning' | 'error';
  }> = [
    {
      name: 'NotAllowedError',
      expectedKind: 'permission',
      expectedClearHandle: true,
      expectedSeverity: 'error',
    },
    {
      name: 'SecurityError',
      expectedKind: 'permission',
      expectedClearHandle: true,
      expectedSeverity: 'error',
    },
    {
      name: 'QuotaExceededError',
      expectedKind: 'quota',
      expectedClearHandle: false,
      expectedSeverity: 'warning',
    },
    {
      name: 'InvalidStateError',
      expectedKind: 'stale',
      expectedClearHandle: true,
      expectedSeverity: 'error',
    },
    {
      name: 'NotFoundError',
      expectedKind: 'stale',
      expectedClearHandle: true,
      expectedSeverity: 'error',
    },
    {
      name: 'DataError',
      expectedKind: 'corrupted',
      expectedClearHandle: false,
      expectedSeverity: 'warning',
    },
    {
      name: 'WhateverElse',
      expectedKind: 'unknown',
      expectedClearHandle: false,
      expectedSeverity: 'warning',
    },
  ];

  for (const c of cases) {
    it(`maps ${c.name} → ${c.expectedKind}`, () => {
      const e = new Error('msg');
      e.name = c.name;
      const verdict = classifyFileError(e);
      expect(verdict.kind).toBe(c.expectedKind);
      expect(verdict.clearHandle).toBe(c.expectedClearHandle);
      expect(verdict.severity).toBe(c.expectedSeverity);
      expect(verdict.userMessageKey).toMatch(/^storage\.localFile/);
    });
  }

  it('handles non-Error inputs gracefully (returns unknown verdict)', () => {
    expect(classifyFileError('string error').kind).toBe('unknown');
    expect(classifyFileError(null).kind).toBe('unknown');
    expect(classifyFileError(undefined).kind).toBe('unknown');
    expect(classifyFileError({ random: 'object' }).kind).toBe('unknown');
  });
});
