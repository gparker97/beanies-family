import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getOrCreateAppFolder,
  createFile,
  updateFile,
  readFile,
  getFileModifiedTime,
  getFileMetadata,
  listFilePermissions,
  listBeanpodFiles,
  deleteFile,
  shareFileWithEmail,
  clearFolderCache,
  findBeanpodInFolder,
  NoBeanpodInFolderError,
  DriveApiError,
  DriveFileNotFoundError,
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
    it('sends multipart upload with metadata and string content (default json mime)', async () => {
      globalThis.fetch = mockFetch({ id: 'file-new', name: 'test.beanpod' });

      const result = await createFile(mockToken, 'folder-1', 'test.beanpod', '{"data":"test"}');
      expect(result).toEqual({ fileId: 'file-new', name: 'test.beanpod' });

      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(call[0]).toContain('uploadType=multipart');
      expect(call[1]?.method).toBe('POST');
      const body = await (call[1]?.body as Blob).text();
      expect(body).toContain('test.beanpod');
      expect(body).toContain('{"data":"test"}');
      // Default mime type used in metadata + part header
      expect(body).toContain('"mimeType":"application/json"');
    });

    it('sends multipart upload with Blob content and explicit mime', async () => {
      globalThis.fetch = mockFetch({ id: 'file-photo', name: 'beanies-photo-abc.jpg' });

      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // JPEG SOI header
      const blob = new Blob([bytes], { type: 'image/jpeg' });
      const result = await createFile(
        mockToken,
        'folder-1',
        'beanies-photo-abc.jpg',
        blob,
        'image/jpeg'
      );
      expect(result).toEqual({ fileId: 'file-photo', name: 'beanies-photo-abc.jpg' });

      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      // Body is a Blob containing the binary content sandwiched between the metadata and trailer parts.
      const bodyBlob = call[1]?.body as Blob;
      const bodyText = await bodyBlob.text();
      expect(bodyText).toContain('beanies-photo-abc.jpg');
      expect(bodyText).toContain('"mimeType":"image/jpeg"');
      expect(bodyText).toContain('Content-Type: image/jpeg');
    });
  });

  describe('getFileMetadata', () => {
    it('fetches requested fields', async () => {
      globalThis.fetch = mockFetch({ thumbnailLink: 'https://lh3.googleusercontent.com/abc=s220' });

      const meta = await getFileMetadata(mockToken, 'file-1', 'thumbnailLink');
      expect(meta.thumbnailLink).toBe('https://lh3.googleusercontent.com/abc=s220');

      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(call[0]).toContain('file-1');
      expect(call[0]).toContain('fields=thumbnailLink');
    });

    it('throws DriveFileNotFoundError on 404', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'Not found' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      await expect(getFileMetadata(mockToken, 'missing', 'parents')).rejects.toThrow(
        DriveFileNotFoundError
      );
    });

    it('throws DriveFileNotFoundError on 403 (permission)', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'Permission denied' } }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      await expect(getFileMetadata(mockToken, 'forbidden', 'parents')).rejects.toThrow(
        DriveFileNotFoundError
      );
    });
  });

  describe('listFilePermissions', () => {
    it('returns the permissions array', async () => {
      globalThis.fetch = mockFetch({
        permissions: [
          { id: 'p1', type: 'user', role: 'writer', emailAddress: 'alice@example.com' },
          { id: 'p2', type: 'user', role: 'writer', emailAddress: 'bob@example.com' },
        ],
      });

      const perms = await listFilePermissions(mockToken, 'folder-1');
      expect(perms).toHaveLength(2);
      expect(perms[0]?.emailAddress).toBe('alice@example.com');
    });

    it('returns [] when permissions are missing in response', async () => {
      globalThis.fetch = mockFetch({});
      const perms = await listFilePermissions(mockToken, 'folder-1');
      expect(perms).toEqual([]);
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
        text: async () => '{"version":"4.0","data":{}}',
      });

      const content = await readFile(mockToken, 'file-1');
      expect(content).toBe('{"version":"4.0","data":{}}');

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

  describe('findBeanpodInFolder', () => {
    it('returns the most-recently-modified .beanpod in the folder', async () => {
      globalThis.fetch = mockFetch({
        files: [
          { id: 'beanpod-new', name: 'Family.beanpod', modifiedTime: '2026-04-20T10:00:00Z' },
          { id: 'beanpod-old', name: 'Old.beanpod', modifiedTime: '2026-04-01T10:00:00Z' },
        ],
      });
      const result = await findBeanpodInFolder(mockToken, 'folder-abc');
      expect(result.fileId).toBe('beanpod-new');
      expect(result.name).toBe('Family.beanpod');

      const callUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
      expect(callUrl).toContain(encodeURIComponent("'folder-abc' in parents"));
      expect(callUrl).toContain(encodeURIComponent("name contains '.beanpod'"));
    });

    it('throws NoBeanpodInFolderError when the folder has no matching files', async () => {
      globalThis.fetch = mockFetch({ files: [] });
      await expect(findBeanpodInFolder(mockToken, 'folder-empty')).rejects.toBeInstanceOf(
        NoBeanpodInFolderError
      );
    });

    it('filters out non-.beanpod results the server may slip in via "name contains"', async () => {
      // Drive's `name contains '.beanpod'` can match a file like "beanpod.txt".
      // Our post-filter rejects anything not ending in `.beanpod`.
      globalThis.fetch = mockFetch({
        files: [{ id: 'decoy', name: 'beanpod.txt', modifiedTime: '2026-04-20T10:00:00Z' }],
      });
      await expect(findBeanpodInFolder(mockToken, 'folder-decoy')).rejects.toBeInstanceOf(
        NoBeanpodInFolderError
      );
    });

    it('surfaces 403 as DriveFileNotFoundError (not silenced)', async () => {
      globalThis.fetch = mockFetch({ error: { message: 'forbidden' } }, 403);
      await expect(findBeanpodInFolder(mockToken, 'folder-denied')).rejects.toBeInstanceOf(
        DriveFileNotFoundError
      );
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

  describe('shareFileWithEmail', () => {
    it('calls correct endpoint with POST', async () => {
      globalThis.fetch = mockFetch({ id: 'perm-1' });

      await shareFileWithEmail(mockToken, 'file-123', 'user@example.com');

      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(call[0]).toContain('/files/file-123/permissions');
      expect(call[1]?.method).toBe('POST');
      const body = JSON.parse(call[1]?.body as string);
      expect(body).toEqual({
        type: 'user',
        role: 'writer',
        emailAddress: 'user@example.com',
      });
    });

    it('default role is writer', async () => {
      globalThis.fetch = mockFetch({ id: 'perm-2' });

      await shareFileWithEmail(mockToken, 'file-123', 'user@example.com');

      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const body = JSON.parse(call[1]?.body as string);
      expect(body.role).toBe('writer');
    });

    it('throws DriveApiError on failure', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ error: { message: 'Forbidden' } }),
      });

      await expect(shareFileWithEmail(mockToken, 'file-123', 'user@example.com')).rejects.toThrow(
        DriveApiError
      );
    });

    it('trims email whitespace', async () => {
      globalThis.fetch = mockFetch({ id: 'perm-3' });

      await shareFileWithEmail(mockToken, 'file-123', '  user@example.com  ');

      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const body = JSON.parse(call[1]?.body as string);
      expect(body.emailAddress).toBe('user@example.com');
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
