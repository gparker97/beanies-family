import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@capacitor/filesystem', () => ({
  Filesystem: { writeFile: vi.fn(), readFile: vi.fn(), stat: vi.fn() },
  Directory: { Data: 'DATA' },
  Encoding: { UTF8: 'utf8' },
}));
vi.mock('@/services/sync/fileHandleStore', () => ({
  storeProviderConfig: vi.fn(async () => {}),
  clearProviderConfig: vi.fn(async () => {}),
  storeFileHandle: vi.fn(),
  clearFileHandle: vi.fn(),
  verifyPermission: vi.fn(),
}));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));

import { Filesystem } from '@capacitor/filesystem';
import { storeProviderConfig, clearProviderConfig } from '@/services/sync/fileHandleStore';
import { reportError } from '@/utils/errorReporter';
import { CapacitorFileProvider } from '../capacitorFileProvider';

const writeFile = vi.mocked(Filesystem.writeFile);
const readFile = vi.mocked(Filesystem.readFile);
const stat = vi.mocked(Filesystem.stat);

describe('CapacitorFileProvider (ADR-029 A3)', () => {
  let provider: CapacitorFileProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = CapacitorFileProvider.fromPath('my-family.beanpod');
  });

  it('is a local provider that does not poll and has no Drive identity', () => {
    expect(provider.type).toBe('local');
    expect(provider.supportsLocalPolling()).toBe(false);
    expect(provider.getFileId()).toBeNull();
    expect(provider.getAccountEmail()).toBeNull();
    expect(provider.getDisplayName()).toBe('my-family.beanpod');
  });

  it('writes via the Filesystem plugin (app-private, recursive)', async () => {
    writeFile.mockResolvedValue({ uri: 'file:///x' } as never);
    await provider.write('{"hello":true}');
    expect(writeFile).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'my-family.beanpod',
        directory: 'DATA',
        data: '{"hello":true}',
        encoding: 'utf8',
        recursive: true,
      })
    );
  });

  it('reads file content', async () => {
    readFile.mockResolvedValue({ data: '{"x":1}' } as never);
    expect(await provider.read()).toBe('{"x":1}');
  });

  it('returns null when the file does not exist yet (brand-new pod)', async () => {
    readFile.mockRejectedValue(new Error('File does not exist'));
    expect(await provider.read()).toBeNull();
    expect(reportError).not.toHaveBeenCalled(); // not-found is not an error
  });

  it('returns null for an empty file', async () => {
    readFile.mockResolvedValue({ data: '   ' } as never);
    expect(await provider.read()).toBeNull();
  });

  it('reports + rethrows a genuine read failure (not a not-found)', async () => {
    readFile.mockRejectedValue(new Error('disk exploded'));
    await expect(provider.read()).rejects.toThrow('disk exploded');
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'local-file',
        context: { action: 'read', platform: 'native' },
      })
    );
  });

  it('reports + rethrows a write failure', async () => {
    writeFile.mockRejectedValue(new Error('quota'));
    await expect(provider.write('x')).rejects.toThrow('quota');
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'local-file',
        context: { action: 'write', platform: 'native' },
      })
    );
  });

  it('getLastModified returns an ISO string from stat.mtime; null on failure', async () => {
    stat.mockResolvedValue({ mtime: 1_700_000_000_000 } as never);
    expect(await provider.getLastModified()).toBe(new Date(1_700_000_000_000).toISOString());
    stat.mockRejectedValue(new Error('nope'));
    expect(await provider.getLastModified()).toBeNull();
  });

  it('is always ready (app-private storage, no permission prompt)', async () => {
    expect(await provider.isReady()).toBe(true);
    expect(await provider.requestAccess()).toBe(true);
  });

  it('persist stores the path in the provider config (config-based restore)', async () => {
    await provider.persist('fam-123');
    expect(storeProviderConfig).toHaveBeenCalledWith('fam-123', {
      type: 'local',
      localPath: 'my-family.beanpod',
    });
  });

  it('clearPersisted clears the provider config', async () => {
    await provider.clearPersisted('fam-123');
    expect(clearProviderConfig).toHaveBeenCalledWith('fam-123');
  });
});
