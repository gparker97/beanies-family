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
 * Open the Google Picker to select a .beanpod file.
 * Returns the selected file's ID and name, or null if the user cancelled.
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
