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
    setAppId(appId: string): this;
    /**
     * Pin the Picker to one Google session (`authuser` on the iframe URL).
     *
     * ⚠️ OPTIONAL BY DESIGN. This whole file is hand-written and covers only what we call, so
     * it cannot tell us whether a method still exists in Google's shipped bundle. Declaring
     * this one optional forces the call site to feature-detect instead of trusting a typedef
     * that nobody updates when Google changes.
     *
     * Verified present in the live picker module: `PickerBuilder.prototype.setAuthUser`.
     * Accepts an account email or a session index.
     */
    setAuthUser?(user: string): this;
    setCallback(callback: (data: PickerResponse) => void): this;
    build(): Picker;
  }

  class DocsView {
    constructor(viewId?: ViewId);
    setQuery(query: string): this;
    setMimeTypes(mimeTypes: string): this;
    setOwnedByMe(ownedByMe: boolean): this;
    setMode(mode: DocsViewMode): this;
  }

  enum DocsViewMode {
    LIST = 'list',
    GRID = 'grid',
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
