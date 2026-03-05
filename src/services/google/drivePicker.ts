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
      const view = new google.picker.DocsView(google.picker.ViewId.DOCS);
      view.setQuery('*.beanpod');
      view.setMimeTypes('application/octet-stream');

      const picker = new google.picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(accessToken)
        .setDeveloperKey(apiKey)
        .setOrigin(window.location.origin)
        .setCallback((data: google.picker.PickerResponse) => {
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
