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
      global.fetch = mockFetch({
        files: [{ id: 'folder-123', name: 'beanies.family' }],
      });

      const id = await getOrCreateAppFolder(mockToken);
      expect(id).toBe('folder-123');
      expect(fetch).toHaveBeenCalledOnce();
    });

    it('creates folder if not found', async () => {
      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(async (_url: string, _init?: RequestInit) => {
        callCount++;
        if (callCount === 1) {
          // Search returns empty
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
      expect(fetch).toHaveBeenCalledTimes(2);

      // Second call to create should be POST
      const createCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[1];
      expect(createCall[1]?.method).toBe('POST');
    });

    it('caches folder ID across calls', async () => {
      global.fetch = mockFetch({
        files: [{ id: 'folder-cached', name: 'beanies.family' }],
      });

      await getOrCreateAppFolder(mockToken);
      await getOrCreateAppFolder(mockToken);
      expect(fetch).toHaveBeenCalledOnce(); // Only one API call
    });
  });

  describe('createFile', () => {
    it('sends multipart upload with metadata and content', async () => {
      global.fetch = mockFetch({ id: 'file-new', name: 'test.beanpod' });

      const result = await createFile(mockToken, 'folder-1', 'test.beanpod', '{"data":"test"}');
      expect(result).toEqual({ fileId: 'file-new', name: 'test.beanpod' });

      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toContain('uploadType=multipart');
      expect(call[1]?.method).toBe('POST');
      expect(call[1]?.body).toContain('test.beanpod');
      expect(call[1]?.body).toContain('{"data":"test"}');
    });
  });

  describe('updateFile', () => {
    it('patches file content', async () => {
      global.fetch = mockFetch({});

      await updateFile(mockToken, 'file-1', '{"updated":"data"}');

      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toContain('file-1');
      expect(call[0]).toContain('uploadType=media');
      expect(call[1]?.method).toBe('PATCH');
      expect(call[1]?.body).toBe('{"updated":"data"}');
    });
  });

  describe('readFile', () => {
    it('returns file content', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => '{"version":"2.0","data":{}}',
      });

      const content = await readFile(mockToken, 'file-1');
      expect(content).toBe('{"version":"2.0","data":{}}');

      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toContain('alt=media');
    });

    it('returns null for empty file', async () => {
      global.fetch = vi.fn().mockResolvedValue({
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
      global.fetch = mockFetch({ modifiedTime: '2026-02-26T12:00:00Z' });

      const time = await getFileModifiedTime(mockToken, 'file-1');
      expect(time).toBe('2026-02-26T12:00:00Z');

      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toContain('fields=modifiedTime');
    });

    it('returns null on error', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const time = await getFileModifiedTime(mockToken, 'file-1');
      expect(time).toBeNull();
    });
  });

  describe('listBeanpodFiles', () => {
    it('returns file list sorted by modifiedTime', async () => {
      const files = [
        { id: 'f1', name: 'family.beanpod', modifiedTime: '2026-02-26T12:00:00Z' },
        { id: 'f2', name: 'backup.beanpod', modifiedTime: '2026-02-25T12:00:00Z' },
      ];
      global.fetch = mockFetch({ files });

      const result = await listBeanpodFiles(mockToken, 'folder-1');
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        fileId: 'f1',
        name: 'family.beanpod',
        modifiedTime: '2026-02-26T12:00:00Z',
      });
    });

    it('returns empty array when no files exist', async () => {
      global.fetch = mockFetch({ files: [] });

      const result = await listBeanpodFiles(mockToken, 'folder-1');
      expect(result).toHaveLength(0);
    });
  });

  describe('deleteFile', () => {
    it('sends DELETE request', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });

      await deleteFile(mockToken, 'file-to-delete');

      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toContain('file-to-delete');
      expect(call[1]?.method).toBe('DELETE');
    });
  });

  describe('error handling', () => {
    it('throws DriveApiError on non-2xx response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ error: { message: 'Forbidden' } }),
      });

      await expect(readFile(mockToken, 'file-1')).rejects.toThrow(DriveApiError);
      await expect(readFile(mockToken, 'file-1')).rejects.toThrow('Forbidden');
    });

    it('DriveApiError includes status code', async () => {
      global.fetch = vi.fn().mockResolvedValue({
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
      global.fetch = mockFetch({ files: [] });

      await listBeanpodFiles(mockToken, 'folder-1');

      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1]?.headers?.Authorization).toBe(`Bearer ${mockToken}`);
    });
  });
});
