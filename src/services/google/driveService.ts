/**
 * Google Drive REST API client.
 *
 * Direct fetch calls — no SDK dependency, zero bundle impact.
 * All functions require a valid access token from googleAuth.ts.
 */

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const APP_FOLDER_NAME = 'beanies.family';

// Session cache for app folder ID
let cachedFolderId: string | null = null;

/**
 * Get or create the beanies.family app folder on Google Drive.
 * Caches the folder ID for the session.
 */
export async function getOrCreateAppFolder(token: string): Promise<string> {
  if (cachedFolderId) return cachedFolderId;

  // Search for existing folder
  const query = `name='${APP_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const searchUrl = `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id,name)`;

  const searchRes = await driveRequest(token, searchUrl);
  const searchData = await searchRes.json();

  if (searchData.files?.length > 0) {
    cachedFolderId = searchData.files[0].id;
    return cachedFolderId;
  }

  // Create the folder
  const createRes = await driveRequest(token, `${DRIVE_API}/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: APP_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });

  const createData = await createRes.json();
  cachedFolderId = createData.id;
  return cachedFolderId;
}

/**
 * Create a new file in the app folder.
 */
export async function createFile(
  token: string,
  folderId: string,
  fileName: string,
  content: string
): Promise<{ fileId: string; name: string }> {
  const metadata = {
    name: fileName,
    parents: [folderId],
    mimeType: 'application/json',
  };

  // Use multipart upload for metadata + content in one request
  const boundary = '---beanies-upload-boundary';
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${content}\r\n` +
    `--${boundary}--`;

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
  const res = await driveRequest(token, `${DRIVE_API}/files/${fileId}?alt=media`);
  const text = await res.text();
  return text || null;
}

/**
 * Get a file's modified time (lightweight metadata-only call for polling).
 */
export async function getFileModifiedTime(token: string, fileId: string): Promise<string | null> {
  try {
    const res = await driveRequest(token, `${DRIVE_API}/files/${fileId}?fields=modifiedTime`);
    const data = await res.json();
    return data.modifiedTime ?? null;
  } catch {
    return null;
  }
}

/**
 * List .beanpod files in the app folder.
 */
export async function listBeanpodFiles(
  token: string,
  folderId: string
): Promise<Array<{ fileId: string; name: string; modifiedTime: string }>> {
  const query = `'${folderId}' in parents and trashed=false`;
  const url = `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc`;

  const res = await driveRequest(token, url);
  const data = await res.json();

  return (data.files ?? []).map((f: { id: string; name: string; modifiedTime: string }) => ({
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
 * Clear the cached folder ID (used on disconnect).
 */
export function clearFolderCache(): void {
  cachedFolderId = null;
}

// --- Internal helpers ---

/**
 * Make a Drive API request with error handling.
 * Throws DriveApiError on non-2xx responses.
 */
async function driveRequest(token: string, url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers as Record<string, string> | undefined),
    },
  });

  if (!res.ok) {
    const status = res.status;
    let message: string;
    try {
      const errorData = await res.json();
      message = errorData.error?.message ?? `Drive API error ${status}`;
    } catch {
      message = `Drive API error ${status}`;
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
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'DriveApiError';
  }
}
