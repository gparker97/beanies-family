import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LocalStorageProvider } from '../localProvider';

// Mock fileHandleStore
vi.mock('../../fileHandleStore', () => ({
  storeFileHandle: vi.fn(async () => {}),
  clearFileHandle: vi.fn(async () => {}),
  verifyPermission: vi.fn(async () => true),
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
    fileText = '{"version":"2.0","exportedAt":"2026-01-01T00:00:00Z","encrypted":false,"data":{}}',
    permission = 'granted',
  } = options;

  const mockFile = {
    text: vi.fn().mockResolvedValue(fileText),
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
    it('returns exportedAt from file JSON', async () => {
      const timestamp = await provider.getLastModified();
      expect(timestamp).toBe('2026-01-01T00:00:00Z');
    });

    it('returns null for invalid JSON', async () => {
      const badHandle = createMockHandle({ fileText: 'not json' });
      const badProvider = new LocalStorageProvider(badHandle);

      const timestamp = await badProvider.getLastModified();
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
});
