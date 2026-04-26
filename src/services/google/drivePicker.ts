/**
 * Google Picker API — lets a user select a shared .beanpod file from their Drive.
 *
 * Selecting a file via Picker grants the app `drive.file` access to that file,
 * which is required when the file was shared by another user (not created by the app).
 */

const PICKER_SCRIPT_URL = 'https://apis.google.com/js/api.js';

let scriptPromise: Promise<void> | null = null;

/** Load the Google API script (idempotent). */
function loadPickerScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    if (typeof gapi !== 'undefined') {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = PICKER_SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Picker script'));
    document.head.appendChild(script);
  });

  return scriptPromise;
}

/** Load the Picker library within gapi. */
function loadPickerLibrary(): Promise<void> {
  return new Promise<void>((resolve) => {
    gapi.load('picker', resolve);
  });
}

/**
 * Open the Google Picker to select the `beanies.family` FOLDER.
 *
 * This is the preferred join/recovery entry point: picking the folder
 * grants the app `drive.file` scope access to the folder AND every file
 * inside it (including the `.beanpod` itself and every photo). Picking
 * a single `.beanpod` file via `pickBeanpodFile` only grants access to
 * that one file, which leaves photos unreachable from joined members'
 * apps even when the folder is shared at the Drive level — see
 * ADR-021 for the full scope discussion.
 *
 * Returns `{ folderId, folderName }` on pick, or `null` if the user
 * cancelled. Caller validates the folder contents with
 * `findBeanpodInFolder` from driveService.
 */
export async function pickBeanpodFolder(
  accessToken: string
): Promise<{ folderId: string; folderName: string } | null> {
  const apiKey = import.meta.env.VITE_GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error('VITE_GOOGLE_API_KEY is not configured');
  }

  await loadPickerScript();
  await loadPickerLibrary();

  return new Promise((resolve, reject) => {
    try {
      const FOLDER_MIME = 'application/vnd.google-apps.folder';

      // `setIncludeFolders` / `setSelectFolderEnabled` exist at runtime on
      // Google Picker's DocsView but aren't declared in `@types/google.picker`.
      // Narrow extension locally so we don't need a catch-all cast.
      type FolderCapableDocsView = google.picker.DocsView & {
        setIncludeFolders(value: boolean): FolderCapableDocsView;
        setSelectFolderEnabled(value: boolean): FolderCapableDocsView;
      };

      // "Shared with me" — most common case for joiners whose invite came
      // from another family member. Name-hint so the canonical folder
      // surfaces first but the user can browse if they've renamed it.
      const sharedView = new google.picker.DocsView(
        google.picker.ViewId.DOCS
      ) as FolderCapableDocsView;
      sharedView.setMimeTypes(FOLDER_MIME);
      sharedView.setIncludeFolders(true);
      sharedView.setSelectFolderEnabled(true);
      sharedView.setQuery('beanies.family');
      sharedView.setOwnedByMe(false);
      sharedView.setMode(google.picker.DocsViewMode.LIST);

      // "My Drive" — for pod owners running recovery (their folder isn't
      // "shared with me" since they own it).
      const myDriveView = new google.picker.DocsView(
        google.picker.ViewId.DOCS
      ) as FolderCapableDocsView;
      myDriveView.setMimeTypes(FOLDER_MIME);
      myDriveView.setIncludeFolders(true);
      myDriveView.setSelectFolderEnabled(true);
      myDriveView.setQuery('beanies.family');
      myDriveView.setOwnedByMe(true);
      myDriveView.setMode(google.picker.DocsViewMode.LIST);

      const appId = import.meta.env.VITE_GOOGLE_PROJECT_NUMBER;

      const builder = new google.picker.PickerBuilder()
        .addView(sharedView)
        .addView(myDriveView)
        .setOAuthToken(accessToken)
        .setDeveloperKey(apiKey)
        .setOrigin(window.location.origin);

      // AppId (numeric project number) is required so the Picker-granted
      // `drive.file` access actually attaches to our OAuth token.
      if (appId) builder.setAppId(appId);

      const picker = builder
        .setCallback((data: google.picker.PickerResponse) => {
          if (data.action === google.picker.Action.PICKED && data.docs?.[0]) {
            const picked = data.docs[0];
            resolve({ folderId: picked.id, folderName: picked.name });
          } else if (data.action === google.picker.Action.CANCEL) {
            console.debug('[drivePicker] folder pick cancelled');
            resolve(null);
          }
        })
        .build();

      picker.setVisible(true);
    } catch (e) {
      console.error('[drivePicker] folder picker failed to open', e);
      reject(e);
    }
  });
}

/**
 * Discriminated outcome of a `pickBeanpodFile` call.
 *
 * - `picked`     — user chose a file successfully.
 * - `cancelled`  — user opened the Picker normally (LOADED fired) and
 *                  closed it without picking.
 * - `failed`     — Picker could not be invoked or rendered. `reason`:
 *     - `'script'`  → Google API JS could not be loaded (script error,
 *                     missing API key, library load error).
 *     - `'iframe'`  → Picker iframe errored before LOADED fired. This
 *                     covers iOS WebKit's "API developer key invalid" /
 *                     cookie-consent symptoms where the iframe can't
 *                     bootstrap its auth context across the storage-
 *                     partitioning boundary.
 *     - `'timeout'` → No callback fired within 30s of `setVisible(true)`.
 */
export type PickBeanpodFileResult =
  | { kind: 'picked'; fileId: string; fileName: string }
  | { kind: 'cancelled' }
  | { kind: 'failed'; reason: 'script' | 'iframe' | 'timeout' };

const PICKER_TIMEOUT_MS = 30_000;

/**
 * Open the Google Picker to select a .beanpod file. Always resolves
 * (never throws) so callers can route to the structured registry of
 * join errors without wrapping in try/catch. See `PickBeanpodFileResult`.
 *
 * This is the preferred join entry point. Folder-picking under
 * `drive.file` scope does NOT grant API list-access to files inside a
 * folder shared by another user — the API returns 0 results even though
 * the folder is visible in the Drive UI. File-picking grants direct
 * `drive.file` access to the chosen file, which works for files shared
 * by another user. Photos are reachable independently via public-link
 * permissions + the Google CDN, so the join flow does not need folder
 * scope.
 */
export async function pickBeanpodFile(accessToken: string): Promise<PickBeanpodFileResult> {
  const apiKey = import.meta.env.VITE_GOOGLE_API_KEY;
  if (!apiKey) {
    console.error('[drivePicker] VITE_GOOGLE_API_KEY is not configured');
    return { kind: 'failed', reason: 'script' };
  }

  try {
    await loadPickerScript();
    await loadPickerLibrary();
  } catch (e) {
    console.error('[drivePicker] script/library load failed', e);
    return { kind: 'failed', reason: 'script' };
  }

  return new Promise<PickBeanpodFileResult>((resolve) => {
    // Tracks whether the Picker iframe successfully bootstrapped. Used
    // to distinguish a real cancel (LOADED-then-CANCEL) from an iframe
    // failure (CANCEL with no preceding LOADED) — the iOS WebKit
    // symptom path.
    let hasLoaded = false;
    let settled = false;

    const settle = (result: PickBeanpodFileResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      resolve(result);
    };

    const timeoutHandle = setTimeout(() => {
      console.warn('[drivePicker] timed out waiting for Picker callback');
      settle({ kind: 'failed', reason: 'timeout' });
    }, PICKER_TIMEOUT_MS);

    try {
      // "My Drive" view filtered to .beanpod files
      const myDriveView = new google.picker.DocsView(google.picker.ViewId.DOCS);
      myDriveView.setQuery('*.beanpod');
      myDriveView.setOwnedByMe(true);
      myDriveView.setMode(google.picker.DocsViewMode.LIST);

      // "Shared with me" view — files shared by another user won't appear
      // in "My Drive" until explicitly added, so we need a separate view
      const sharedView = new google.picker.DocsView(google.picker.ViewId.DOCS);
      sharedView.setQuery('*.beanpod');
      sharedView.setOwnedByMe(false);
      sharedView.setMode(google.picker.DocsViewMode.LIST);

      const appId = import.meta.env.VITE_GOOGLE_PROJECT_NUMBER;

      const builder = new google.picker.PickerBuilder()
        .addView(sharedView) // Show shared files first (most likely for join flow)
        .addView(myDriveView)
        .setOAuthToken(accessToken)
        .setDeveloperKey(apiKey)
        .setOrigin(window.location.origin);

      // AppId (numeric project number) is required for the Picker to grant
      // drive.file scope access to the selected file. Without it, the Picker
      // UI works but the OAuth token doesn't get file-level access.
      if (appId) builder.setAppId(appId);

      const picker = builder
        .setCallback((data: google.picker.PickerResponse) => {
          console.warn('[drivePicker] Picker callback:', data.action, data.docs?.[0]?.id);
          // LOADED isn't in @types/google.picker's Action enum but the
          // Picker emits it at runtime when the iframe finishes
          // bootstrapping. Compare as string to avoid the typedef gap.
          if ((data.action as string) === 'loaded') {
            hasLoaded = true;
            return;
          }
          if (data.action === google.picker.Action.PICKED && data.docs?.[0]) {
            settle({
              kind: 'picked',
              fileId: data.docs[0].id,
              fileName: data.docs[0].name,
            });
            return;
          }
          if (data.action === google.picker.Action.CANCEL) {
            // CANCEL without a preceding LOADED → iframe-bootstrap failure
            // (the iOS WebKit symptom). LOADED-then-CANCEL → real cancel.
            settle(hasLoaded ? { kind: 'cancelled' } : { kind: 'failed', reason: 'iframe' });
            return;
          }
        })
        .build();

      picker.setVisible(true);
    } catch (e) {
      console.error('[drivePicker] picker open failed', e);
      settle({ kind: 'failed', reason: 'script' });
    }
  });
}
