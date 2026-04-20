/**
 * Google Drive REST API client.
 *
 * Direct fetch calls — no SDK dependency, zero bundle impact.
 * All functions require a valid access token from googleAuth.ts.
 */

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const APP_FOLDER_NAME = 'beanies.family';
const FOLDER_CACHE_KEY = 'beanies_drive_folder_id';

// Session cache for app folder ID
let cachedFolderId: string | null = null;

// Restore folder ID from localStorage on module load
try {
  const stored = localStorage.getItem(FOLDER_CACHE_KEY);
  if (stored) cachedFolderId = stored;
} catch {
  // Ignore — localStorage may not be available
}

/**
 * Get or create the beanies.family app folder on Google Drive.
 * Caches the folder ID in memory and localStorage.
 *
 * Resilience measures:
 * - Retries folder search once (1s delay) before creating a new folder
 * - Detects duplicate folders and picks the one with files
 * - Persists folder ID to localStorage to avoid re-discovery on refresh
 */
export async function getOrCreateAppFolder(token: string): Promise<string> {
  if (cachedFolderId) return cachedFolderId;

  const folders = await searchAppFolders(token);

  if (folders.length === 1) {
    return cacheFolderId(folders[0]!.id);
  }

  if (folders.length > 1) {
    // Multiple folders found — pick the one that contains files
    console.warn(
      `[driveService] ${folders.length} "${APP_FOLDER_NAME}" folders found — resolving duplicates`
    );
    const bestId = await pickFolderWithFiles(token, folders);
    return cacheFolderId(bestId);
  }

  // No folder found — retry once after 1s (API eventual consistency)
  console.warn('[driveService] App folder not found, retrying in 1s...');
  await delay(1000);
  const retryFolders = await searchAppFolders(token);

  if (retryFolders.length > 0) {
    console.warn('[driveService] App folder found on retry');
    const bestId =
      retryFolders.length > 1
        ? await pickFolderWithFiles(token, retryFolders)
        : retryFolders[0]!.id;
    return cacheFolderId(bestId);
  }

  // Still not found — create a new folder
  console.warn('[driveService] Creating new app folder');
  const createRes = await driveRequest(token, `${DRIVE_API}/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: APP_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });

  const createData = await createRes.json();
  return cacheFolderId(createData.id);
}

/**
 * Create a new file in the app folder.
 *
 * Accepts string, Blob, or Uint8Array content. For binary content
 * (photos), pass the blob + its MIME type (e.g. 'image/jpeg'). Default
 * MIME is 'application/json' to preserve existing .beanpod callers.
 */
export async function createFile(
  token: string,
  folderId: string,
  fileName: string,
  content: string | Blob | Uint8Array,
  contentMimeType: string = 'application/json'
): Promise<{ fileId: string; name: string }> {
  const metadata = {
    name: fileName,
    parents: [folderId],
    mimeType: contentMimeType,
  };

  // Use multipart upload for metadata + content in one request.
  // Build a Blob so binary content passes through unmangled.
  const boundary = '---beanies-upload-boundary';
  const metadataPart =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${contentMimeType}\r\n\r\n`;
  const trailer = `\r\n--${boundary}--`;
  // Cast content to BlobPart — TS's Uint8Array generic (ArrayBufferLike vs ArrayBuffer)
  // is stricter than the runtime Blob constructor actually requires.
  const body = new Blob([metadataPart, content as BlobPart, trailer]);

  const res = await driveRequest(
    token,
    `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name`,
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    }
  );

  const data = await res.json();
  return { fileId: data.id, name: data.name };
}

/**
 * Update an existing file's content.
 */
export async function updateFile(token: string, fileId: string, content: string): Promise<void> {
  await driveRequest(token, `${DRIVE_UPLOAD_API}/files/${fileId}?uploadType=media`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: content,
  });
}

/**
 * Read a file's content.
 */
export async function readFile(token: string, fileId: string): Promise<string | null> {
  // Cache-bust with timestamp to avoid Google CDN serving stale content
  // (critical for invite flows where file was just updated by another session)
  const cb = `_cb=${Date.now()}`;
  const res = await driveRequest(token, `${DRIVE_API}/files/${fileId}?alt=media&${cb}`);
  const text = await res.text();
  return text || null;
}

/**
 * Download a file's binary content as a Blob. Used by the photo layer
 * when we need a reliable local URL for `<img>` — Drive's public
 * `thumbnailLink` URLs carry short-lived tokens that rotate within
 * minutes, so a bearer-authorized GET + `URL.createObjectURL` avoids
 * that whole class of "photo vanishes on reload" bugs. Throws
 * `DriveFileNotFoundError` on 404/403 via the shared `driveRequest` path.
 */
export async function downloadFileBlob(token: string, fileId: string): Promise<Blob> {
  const res = await driveRequest(token, `${DRIVE_API}/files/${fileId}?alt=media`);
  return await res.blob();
}

/**
 * Get a file's modified time (lightweight metadata-only call for polling).
 */
export async function getFileModifiedTime(token: string, fileId: string): Promise<string | null> {
  const res = await driveRequest(token, `${DRIVE_API}/files/${fileId}?fields=modifiedTime`);
  const data = await res.json();
  return data.modifiedTime ?? null;
}

/**
 * Fetch arbitrary file metadata fields.
 * Pass a comma-separated `fields` string, e.g. 'thumbnailLink' or 'parents,name'.
 * Throws DriveFileNotFoundError on 404/403 so callers can flag missing files cleanly.
 */
export async function getFileMetadata(
  token: string,
  fileId: string,
  fields: string
): Promise<Record<string, unknown>> {
  const url = `${DRIVE_API}/files/${fileId}?fields=${encodeURIComponent(fields)}`;
  const res = await driveRequest(token, url);
  return (await res.json()) as Record<string, unknown>;
}

/**
 * List a file's permissions (who it's shared with).
 * Used by the app-folder migration sweep to detect which family members
 * don't yet have folder access.
 */
export async function listFilePermissions(
  token: string,
  fileId: string
): Promise<Array<{ id: string; type: string; role: string; emailAddress?: string }>> {
  const url = `${DRIVE_API}/files/${fileId}/permissions?fields=permissions(id,type,role,emailAddress)`;
  const res = await driveRequest(token, url);
  const data = await res.json();
  return data.permissions ?? [];
}

/**
 * List .beanpod files in the app folder.
 * If folder-based search returns empty, falls back to a Drive-wide search
 * for .beanpod files (handles broken folder associations).
 */
export async function listBeanpodFiles(
  token: string,
  folderId: string
): Promise<Array<{ fileId: string; name: string; modifiedTime: string }>> {
  const query = `'${folderId}' in parents and trashed=false`;
  const url = `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc`;

  const res = await driveRequest(token, url);
  const data = await res.json();
  const files = mapFileResults(data.files);

  if (files.length > 0) {
    console.warn(`[driveService] Found ${files.length} file(s) in app folder`);
    return files;
  }

  // Folder-based search returned empty — try Drive-wide fallback
  console.warn('[driveService] No files in app folder, trying Drive-wide .beanpod search...');
  return searchBeanpodFilesGlobal(token);
}

/**
 * Search for .beanpod files across the entire Drive (fallback when folder search fails).
 * If files are found outside the app folder, updates the cached folder ID to the
 * file's actual parent so subsequent operations use the correct folder.
 */
export async function searchBeanpodFilesGlobal(
  token: string
): Promise<Array<{ fileId: string; name: string; modifiedTime: string }>> {
  const query = `name contains '.beanpod' and trashed=false`;
  const url = `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id,name,modifiedTime,parents)&orderBy=modifiedTime desc`;

  const res = await driveRequest(token, url);
  const data = await res.json();
  const rawFiles = data.files ?? [];

  if (rawFiles.length > 0) {
    console.warn(`[driveService] Drive-wide search found ${rawFiles.length} .beanpod file(s)`);
    // Update folder cache to the first file's parent folder
    const firstParent = rawFiles[0].parents?.[0];
    if (firstParent && firstParent !== cachedFolderId) {
      console.warn(`[driveService] Updating folder cache to ${firstParent}`);
      cacheFolderId(firstParent);
    }
  }

  return rawFiles.map((f: { id: string; name: string; modifiedTime: string }) => ({
    fileId: f.id,
    name: f.name,
    modifiedTime: f.modifiedTime,
  }));
}

/**
 * Delete a file from Google Drive.
 */
export async function deleteFile(token: string, fileId: string): Promise<void> {
  await driveRequest(token, `${DRIVE_API}/files/${fileId}`, {
    method: 'DELETE',
  });
}

/**
 * Share a file with another user via email (Google Drive permissions API).
 */
export async function shareFileWithEmail(
  token: string,
  fileId: string,
  email: string,
  role: 'reader' | 'writer' = 'writer'
): Promise<void> {
  await driveRequest(token, `${DRIVE_API}/files/${fileId}/permissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'user', role, emailAddress: email.trim() }),
  });
}

/**
 * Get the cached app folder ID (null if not yet resolved).
 */
export function getAppFolderId(): string | null {
  return cachedFolderId;
}

/**
 * Clear the cached folder ID (used on disconnect).
 */
export function clearFolderCache(): void {
  cachedFolderId = null;
  try {
    localStorage.removeItem(FOLDER_CACHE_KEY);
  } catch {
    // Ignore
  }
}

// --- Internal helpers ---

/** Cache folder ID in memory and localStorage. */
function cacheFolderId(id: string): string {
  cachedFolderId = id;
  try {
    localStorage.setItem(FOLDER_CACHE_KEY, id);
  } catch {
    // Ignore — localStorage may not be available
  }
  return id;
}

/** Search for all beanies.family folders on Drive. */
/**
 * Find (or create) a subfolder by name under a given parent folder.
 *
 * Idempotent: returns the first existing match rather than creating a
 * second folder if the name is already there. Used for the `data/`
 * hierarchy under the app root — e.g. `data/<familyId>/photos/`.
 *
 * NOTE: this trusts caller-supplied names. Callers must never embed
 * raw user input without sanitizing for single-quotes (Drive query
 * syntax) or slashes (Drive treats names as opaque, but slashes in
 * the UI are confusing).
 */
export async function findOrCreateFolder(
  token: string,
  name: string,
  parentId: string
): Promise<string> {
  const escaped = name.replace(/'/g, "\\'");
  const query = `name='${escaped}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`;
  const searchUrl = `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id,name)&pageSize=1`;
  const searchRes = await driveRequest(token, searchUrl);
  const searchData = await searchRes.json();
  const existing = searchData.files?.[0];
  if (existing?.id) return existing.id;

  const createRes = await driveRequest(token, `${DRIVE_API}/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    }),
  });
  const createData = await createRes.json();
  return createData.id;
}

async function searchAppFolders(token: string): Promise<Array<{ id: string; name: string }>> {
  const query = `name='${APP_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const searchUrl = `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id,name)`;
  const searchRes = await driveRequest(token, searchUrl);
  const searchData = await searchRes.json();
  return searchData.files ?? [];
}

/**
 * Given multiple candidate folders, pick the one that contains files.
 * Falls back to the first folder if none contain files.
 */
async function pickFolderWithFiles(
  token: string,
  folders: Array<{ id: string; name: string }>
): Promise<string> {
  for (const folder of folders) {
    const query = `'${folder.id}' in parents and trashed=false`;
    const url = `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id)&pageSize=1`;
    try {
      const res = await driveRequest(token, url);
      const data = await res.json();
      if (data.files?.length > 0) {
        console.warn(`[driveService] Selected folder ${folder.id} (has files)`);
        return folder.id;
      }
    } catch {
      // Skip this folder on error, try next
    }
  }
  // None had files — use the first one
  console.warn(`[driveService] No folder had files, using first: ${folders[0]!.id}`);
  return folders[0]!.id;
}

/** Map raw Drive API file results to our shape. */
function mapFileResults(
  files: Array<{ id: string; name: string; modifiedTime: string }> | undefined
): Array<{ fileId: string; name: string; modifiedTime: string }> {
  return (files ?? []).map((f) => ({
    fileId: f.id,
    name: f.name,
    modifiedTime: f.modifiedTime,
  }));
}

/** Simple delay helper. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Default timeout for Drive API requests (15 seconds). */
const DRIVE_REQUEST_TIMEOUT_MS = 15_000;

/**
 * Make a Drive API request with error handling and timeout.
 * Throws DriveApiError on non-2xx responses.
 * Throws on timeout (AbortError) to prevent indefinite hangs.
 */
async function driveRequest(token: string, url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DRIVE_REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.headers as Record<string, string> | undefined),
      },
    });
  } catch (e) {
    clearTimeout(timeoutId);
    if ((e as Error).name === 'AbortError') {
      throw new DriveApiError('Request timed out', 408);
    }
    throw e;
  }
  clearTimeout(timeoutId);

  if (!res.ok) {
    const status = res.status;
    let message: string;
    try {
      const errorData = await res.json();
      message = errorData.error?.message ?? `Drive API error ${status}`;
    } catch {
      message = `Drive API error ${status}`;
    }
    // 404 Not Found or 403 Forbidden both mean "the file isn't accessible to this
    // caller" — photoStore treats these identically (flags the photo as unresolved).
    if (status === 404 || status === 403) {
      throw new DriveFileNotFoundError(message, status);
    }
    throw new DriveApiError(message, status);
  }

  return res;
}

/**
 * Custom error class for Drive API errors.
 * Includes the HTTP status code for retry logic.
 */
export class DriveApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'DriveApiError';
    this.status = status;
  }
}

/**
 * Thrown when a Drive file can't be found or accessed (404/403).
 * Callers can use `instanceof DriveFileNotFoundError` to handle missing
 * files distinctly from other Drive API errors (e.g. mark a photo as
 * unresolved and show Replace/Remove UI).
 */
export class DriveFileNotFoundError extends DriveApiError {
  constructor(message: string, status: number) {
    super(message, status);
    this.name = 'DriveFileNotFoundError';
  }
}

/**
 * Thrown by `findBeanpodInFolder` when a caller picks a folder that
 * doesn't contain any `.beanpod` file. Distinct from 404/403 so the
 * recovery/join flow can surface a specific "this folder isn't a
 * beanies.family pod — pick a different one" message instead of a
 * generic Drive error.
 */
export class NoBeanpodInFolderError extends Error {
  readonly folderId: string;
  constructor(folderId: string) {
    super(`No .beanpod file found in folder ${folderId}`);
    this.name = 'NoBeanpodInFolderError';
    this.folderId = folderId;
  }
}

/**
 * Strict in-folder lookup for a `.beanpod` file. Unlike `listBeanpodFiles`
 * this does NOT fall back to a Drive-wide search — callers (Picker-driven
 * join + recovery flows) must reject folders that don't actually contain
 * this family's pod.
 *
 * Returns the most-recently-modified `.beanpod` in the folder. Throws
 * `NoBeanpodInFolderError` if none are found; any Drive API failure
 * surfaces as `DriveApiError` / `DriveFileNotFoundError` from the shared
 * `driveRequest` path.
 */
export async function findBeanpodInFolder(
  token: string,
  folderId: string
): Promise<{ fileId: string; name: string; modifiedTime: string }> {
  const query = `'${folderId}' in parents and name contains '.beanpod' and trashed=false`;
  const url = `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=10`;
  const res = await driveRequest(token, url);
  const data = await res.json();
  const files = mapFileResults(data.files).filter((f) => f.name.endsWith('.beanpod'));
  if (files.length === 0) throw new NoBeanpodInFolderError(folderId);
  return files[0];
}
