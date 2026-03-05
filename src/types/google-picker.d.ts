/**
 * Minimal ambient declarations for the Google Picker API.
 * Only types actually used by src/services/google/drivePicker.ts.
 */

declare namespace google.picker {
  class PickerBuilder {
    constructor();
    addView(view: DocsView): this;
    setOAuthToken(token: string): this;
    setDeveloperKey(key: string): this;
    setOrigin(origin: string): this;
    setCallback(callback: (data: PickerResponse) => void): this;
    build(): Picker;
  }

  class DocsView {
    constructor(viewId?: ViewId);
    setQuery(query: string): this;
    setMimeTypes(mimeTypes: string): this;
  }

  interface Picker {
    setVisible(visible: boolean): void;
  }

  enum ViewId {
    DOCS = 'all',
  }

  enum Action {
    PICKED = 'picked',
    CANCEL = 'cancel',
  }

  interface PickerResponse {
    action: Action;
    docs?: PickerDocument[];
  }

  interface PickerDocument {
    id: string;
    name: string;
    mimeType: string;
  }
}

declare namespace gapi {
  function load(api: string, callback: () => void): void;
}
