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
 * Open the Google Picker to select a .beanpod file.
 * Returns the selected file's ID and name, or null if the user cancelled.
 *
 * @deprecated Prefer `pickBeanpodFolder` — picking the file only grants
 * `drive.file` scope to the `.beanpod`, so photos in the same folder
 * remain unreachable from the app's API. Kept for existing callers
 * that haven't been migrated yet.
 */
export async function pickBeanpodFile(
  accessToken: string
): Promise<{ fileId: string; fileName: string } | null> {
  const apiKey = import.meta.env.VITE_GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error('VITE_GOOGLE_API_KEY is not configured');
  }

  await loadPickerScript();
  await loadPickerLibrary();

  return new Promise((resolve, reject) => {
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
          if (data.action === google.picker.Action.PICKED && data.docs?.[0]) {
            resolve({ fileId: data.docs[0].id, fileName: data.docs[0].name });
          } else if (data.action === google.picker.Action.CANCEL) {
            resolve(null);
          }
          // Other actions (e.g. LOADED) are ignored — Picker is still open
        })
        .build();

      picker.setVisible(true);
    } catch (e) {
      reject(e);
    }
  });
}
