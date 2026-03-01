import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getOrCreateAppFolder,
  createFile,
  updateFile,
  readFile,
  getFileModifiedTime,
  listBeanpodFiles,
  deleteFile,
  clearFolderCache,
  DriveApiError,
} from '../driveService';

const mockToken = 'mock-access-token';

function mockFetch(response: Record<string, unknown>, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => response,
    text: async () => JSON.stringify(response),
  });
}

describe('driveService', () => {
  beforeEach(() => {
    clearFolderCache();
    vi.restoreAllMocks();
  });

  describe('getOrCreateAppFolder', () => {
    it('returns existing folder ID if found', async () => {
      globalThis.fetch = mockFetch({
        files: [{ id: 'folder-123', name: 'beanies.family' }],
      });

      const id = await getOrCreateAppFolder(mockToken);
      expect(id).toBe('folder-123');
      expect(fetch).toHaveBeenCalledOnce();
    });

    it('retries once then creates folder if not found', async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount <= 2) {
          // Both searches return empty
          return {
            ok: true,
            status: 200,
            json: async () => ({ files: [] }),
          };
        }
        // Create folder
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'new-folder-456' }),
        };
      });

      const id = await getOrCreateAppFolder(mockToken);
      expect(id).toBe('new-folder-456');
      // 3 calls: initial search, retry search (after 1s delay), create
      expect(fetch).toHaveBeenCalledTimes(3);

      // Third call should be POST (create)
      const createCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[2]!;
      expect(createCall[1]?.method).toBe('POST');
    });

    it('finds folder on retry without creating a new one', async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // First search returns empty
          return {
            ok: true,
            status: 200,
            json: async () => ({ files: [] }),
          };
        }
        // Retry finds the folder
        return {
          ok: true,
          status: 200,
          json: async () => ({ files: [{ id: 'found-on-retry', name: 'beanies.family' }] }),
        };
      });

      const id = await getOrCreateAppFolder(mockToken);
      expect(id).toBe('found-on-retry');
      // Only 2 calls: initial search + retry search (no create)
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('picks folder with files when duplicates exist', async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // Search returns 2 folders
          return {
            ok: true,
            status: 200,
            json: async () => ({
              files: [
                { id: 'empty-folder', name: 'beanies.family' },
                { id: 'folder-with-files', name: 'beanies.family' },
              ],
            }),
          };
        }
        if (callCount === 2) {
          // First folder has no files
          return {
            ok: true,
            status: 200,
            json: async () => ({ files: [] }),
          };
        }
        // Second folder has files
        return {
          ok: true,
          status: 200,
          json: async () => ({ files: [{ id: 'file-1' }] }),
        };
      });

      const id = await getOrCreateAppFolder(mockToken);
      expect(id).toBe('folder-with-files');
    });

    it('caches folder ID across calls', async () => {
      globalThis.fetch = mockFetch({
        files: [{ id: 'folder-cached', name: 'beanies.family' }],
      });

      await getOrCreateAppFolder(mockToken);
      await getOrCreateAppFolder(mockToken);
      expect(fetch).toHaveBeenCalledOnce(); // Only one API call
    });
  });

  describe('createFile', () => {
    it('sends multipart upload with metadata and content', async () => {
      globalThis.fetch = mockFetch({ id: 'file-new', name: 'test.beanpod' });

      const result = await createFile(mockToken, 'folder-1', 'test.beanpod', '{"data":"test"}');
      expect(result).toEqual({ fileId: 'file-new', name: 'test.beanpod' });

      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(call[0]).toContain('uploadType=multipart');
      expect(call[1]?.method).toBe('POST');
      expect(call[1]?.body).toContain('test.beanpod');
      expect(call[1]?.body).toContain('{"data":"test"}');
    });
  });

  describe('updateFile', () => {
    it('patches file content', async () => {
      globalThis.fetch = mockFetch({});

      await updateFile(mockToken, 'file-1', '{"updated":"data"}');

      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(call[0]).toContain('file-1');
      expect(call[0]).toContain('uploadType=media');
      expect(call[1]?.method).toBe('PATCH');
      expect(call[1]?.body).toBe('{"updated":"data"}');
    });
  });

  describe('readFile', () => {
    it('returns file content', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => '{"version":"2.0","data":{}}',
      });

      const content = await readFile(mockToken, 'file-1');
      expect(content).toBe('{"version":"2.0","data":{}}');

      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(call[0]).toContain('alt=media');
    });

    it('returns null for empty file', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => '',
      });

      const content = await readFile(mockToken, 'file-1');
      expect(content).toBeNull();
    });
  });

  describe('getFileModifiedTime', () => {
    it('returns modifiedTime from metadata', async () => {
      globalThis.fetch = mockFetch({ modifiedTime: '2026-02-26T12:00:00Z' });

      const time = await getFileModifiedTime(mockToken, 'file-1');
      expect(time).toBe('2026-02-26T12:00:00Z');

      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(call[0]).toContain('fields=modifiedTime');
    });

    it('throws on error (no longer swallowed)', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      await expect(getFileModifiedTime(mockToken, 'file-1')).rejects.toThrow('Network error');
    });

    it('throws DriveApiError on 404', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: { message: 'File not found' } }),
      });

      await expect(getFileModifiedTime(mockToken, 'file-1')).rejects.toThrow(DriveApiError);
    });
  });

  describe('listBeanpodFiles', () => {
    it('returns file list sorted by modifiedTime', async () => {
      const files = [
        { id: 'f1', name: 'family.beanpod', modifiedTime: '2026-02-26T12:00:00Z' },
        { id: 'f2', name: 'backup.beanpod', modifiedTime: '2026-02-25T12:00:00Z' },
      ];
      globalThis.fetch = mockFetch({ files });

      const result = await listBeanpodFiles(mockToken, 'folder-1');
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        fileId: 'f1',
        name: 'family.beanpod',
        modifiedTime: '2026-02-26T12:00:00Z',
      });
    });

    it('falls back to Drive-wide search when folder is empty', async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // Folder-based search returns empty
          return {
            ok: true,
            status: 200,
            json: async () => ({ files: [] }),
          };
        }
        // Drive-wide fallback also returns empty
        return {
          ok: true,
          status: 200,
          json: async () => ({ files: [] }),
        };
      });

      const result = await listBeanpodFiles(mockToken, 'folder-1');
      expect(result).toHaveLength(0);
      // 2 calls: folder search + Drive-wide fallback
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('finds files via Drive-wide fallback when folder search fails', async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // Folder-based search returns empty
          return {
            ok: true,
            status: 200,
            json: async () => ({ files: [] }),
          };
        }
        // Drive-wide fallback finds the file
        return {
          ok: true,
          status: 200,
          json: async () => ({
            files: [
              {
                id: 'f1',
                name: 'family.beanpod',
                modifiedTime: '2026-03-01T12:00:00Z',
                parents: ['correct-folder'],
              },
            ],
          }),
        };
      });

      const result = await listBeanpodFiles(mockToken, 'wrong-folder');
      expect(result).toHaveLength(1);
      expect(result[0]!.fileId).toBe('f1');
    });
  });

  describe('deleteFile', () => {
    it('sends DELETE request', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });

      await deleteFile(mockToken, 'file-to-delete');

      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(call[0]).toContain('file-to-delete');
      expect(call[1]?.method).toBe('DELETE');
    });
  });

  describe('error handling', () => {
    it('throws DriveApiError on non-2xx response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ error: { message: 'Forbidden' } }),
      });

      await expect(readFile(mockToken, 'file-1')).rejects.toThrow(DriveApiError);
      await expect(readFile(mockToken, 'file-1')).rejects.toThrow('Forbidden');
    });

    it('DriveApiError includes status code', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'Unauthorized' } }),
      });

      try {
        await readFile(mockToken, 'file-1');
      } catch (e) {
        expect(e).toBeInstanceOf(DriveApiError);
        expect((e as DriveApiError).status).toBe(401);
      }
    });

    it('includes Authorization header in requests', async () => {
      // Use a response with files so we don't trigger the fallback search
      globalThis.fetch = mockFetch({
        files: [{ id: 'f1', name: 'test.beanpod', modifiedTime: '2026-03-01T00:00:00Z' }],
      });

      await listBeanpodFiles(mockToken, 'folder-1');

      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(call[1]?.headers?.Authorization).toBe(`Bearer ${mockToken}`);
    });
  });
});
