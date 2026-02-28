# Plan: Google Drive Cloud Storage Integration (#78)

> Date: 2026-02-26
> Related issues: #78

## Context

The app currently only supports local filesystem storage via the File System Access API. Users want to store their `.beanpod` files on Google Drive for automatic cloud backup and cross-device access without relying on desktop sync clients (Google Drive for Desktop). The `RegistryEntry` type already has `provider: 'google_drive'` and `fileId` fields, and `.env.example` defines `VITE_GOOGLE_CLIENT_ID` / `VITE_GOOGLE_API_KEY` placeholders. The UI has disabled Google Drive buttons in both `LoadPodView` and `CreatePodView`.

## Approach

### Architecture: StorageProvider Abstraction

Decouple `syncService.ts` from `FileSystemFileHandle` by introducing a `StorageProvider` interface. Both local filesystem and Google Drive implement this interface. The sync engine becomes backend-agnostic.

```
StorageProvider (interface)
├── LocalStorageProvider   — wraps FileSystemFileHandle (existing behavior)
└── GoogleDriveProvider    — wraps Google Drive REST API
```

### StorageProvider Interface

**New file: `src/services/sync/storageProvider.ts`**

```typescript
export interface StorageProvider {
  readonly type: 'local' | 'google_drive';
  write(content: string): Promise<void>;
  read(): Promise<string | null>;
  getLastModified(): Promise<string | null>; // for polling
  isReady(): boolean;
  requestAccess(): Promise<boolean>; // user gesture required
  persist(familyId: string): Promise<void>; // save config to IndexedDB
  clearPersisted(familyId: string): Promise<void>;
  disconnect(): Promise<void>;
  getDisplayName(): string; // filename or "Google Drive"
  getFileId(): string | null; // Drive file ID or null
}
```

### Phase 1: Extract LocalStorageProvider (pure refactor)

**New file: `src/services/sync/providers/localProvider.ts`**

Extract all `FileSystemFileHandle` logic from `syncService.ts`:

- `write()` — seek/write/truncate/close (from `doSave()` lines 366-371)
- `read()` — `handle.getFile().text()` (from `load()` lines 444-446)
- `getLastModified()` — parse JSON envelope for `exportedAt` (from `getFileTimestamp()`)
- `isReady()` — `queryPermission({ mode: 'readwrite' })`
- `requestAccess()` — `verifyPermission(handle, 'readwrite')`
- `persist()` — `storeFileHandle()` via fileHandleStore
- Static factories: `fromPicker()`, `fromSavePicker()`, `fromHandle()`

### Phase 2: Refactor syncService.ts

Replace `currentFileHandle: FileSystemFileHandle | null` with `currentProvider: StorageProvider | null`.

Key changes in `syncService.ts`:

- `doSave()` — replace lines 366-371 (createWritable/seek/write/truncate/close) with `currentProvider.write(fileContent)`
- `load()` — replace lines 444-446 (getFile/text) with `currentProvider.read()`
- `getFileTimestamp()` — replace with `currentProvider.getLastModified()`
- `hasPermission()` — replace with `currentProvider.isReady()`
- `openAndLoadFile()` — create `LocalStorageProvider.fromPicker()`, set as provider
- `selectSyncFile()` — create `LocalStorageProvider.fromSavePicker()`, set as provider
- `disconnect()` — call `currentProvider.clearPersisted()` + `currentProvider.disconnect()`
- `initialize()` — restore provider from persisted config (check type, create appropriate provider)
- Add `setProvider(provider)` and `getProviderType()` for external use
- `getSessionFileHandle()` — keep for passkey PRF, check `provider.type === 'local'`

**All existing behavior preserved** — this is a pure refactor. Run full test suite after.

### Phase 3: Provider Config Persistence

**Modify: `src/services/sync/fileHandleStore.ts`**

Add a second storage mechanism for provider config alongside existing file handle storage:

```typescript
// New: persisted provider config (keyed by `providerConfig-{familyId}`)
interface PersistedProviderConfig {
  type: 'local' | 'google_drive';
  driveFileId?: string;
  driveFileName?: string;
}

export async function storeProviderConfig(
  familyId: string,
  config: PersistedProviderConfig
): Promise<void>;
export async function getProviderConfig(familyId: string): Promise<PersistedProviderConfig | null>;
export async function clearProviderConfig(familyId: string): Promise<void>;
```

On `initialize()`, syncService reads provider config to know which provider to restore:

- `type: 'local'` → restore FileSystemFileHandle from IndexedDB, create `LocalStorageProvider`
- `type: 'google_drive'` → create `GoogleDriveProvider` with stored `driveFileId` (token acquired on demand)

### Phase 4: Google OAuth via GIS

**New file: `src/services/google/googleAuth.ts`**

Use Google Identity Services (GIS) implicit grant flow:

- `loadGIS()` — dynamically inject `<script src="https://accounts.google.com/gsi/client">`, resolve when loaded
- `requestAccessToken()` — call `google.accounts.oauth2.initTokenClient()` with `scope: 'https://www.googleapis.com/auth/drive.file'`, returns access token
- Token stored in memory only (never persisted — security requirement)
- Track `expiresAt`, fire `onTokenExpired` callbacks 5 min before expiry
- `isTokenValid()` — check expiry
- `revokeToken()` — call GIS revoke + clear state
- `isGoogleAuthConfigured()` — check `VITE_GOOGLE_CLIENT_ID` env var exists
- Silent re-auth: try `prompt: ''` first, fall back to `prompt: 'consent'` on failure

**Google Cloud Project Setup** (include in docs):

1. Go to Google Cloud Console → create project
2. Enable Google Drive API
3. Create OAuth 2.0 Client ID (Web application)
4. Add authorized JavaScript origins: `https://beanies.family`, `http://localhost:5173`
5. Copy Client ID to `.env` as `VITE_GOOGLE_CLIENT_ID`

### Phase 5: Google Drive REST API Client

**New file: `src/services/google/driveService.ts`**

Direct REST API calls (no SDK — zero bundle impact):

```typescript
// App folder management
export async function getOrCreateAppFolder(token: string): Promise<string>;
// → Search: q="name='beanies.family' and mimeType='application/vnd.google-apps.folder' and trashed=false"
// → Create if not found, cache folder ID for session

// File CRUD
export async function createFile(
  token: string,
  folderId: string,
  fileName: string,
  content: string
): Promise<{ fileId: string; name: string }>;
// → POST /upload/drive/v3/files?uploadType=multipart (metadata + content)

export async function updateFile(token: string, fileId: string, content: string): Promise<void>;
// → PATCH /upload/drive/v3/files/{fileId}?uploadType=media

export async function readFile(token: string, fileId: string): Promise<string | null>;
// → GET /drive/v3/files/{fileId}?alt=media

export async function getFileModifiedTime(token: string, fileId: string): Promise<string | null>;
// → GET /drive/v3/files/{fileId}?fields=modifiedTime (lightweight, for polling)

export async function listBeanpodFiles(
  token: string,
  folderId: string
): Promise<Array<{ fileId: string; name: string; modifiedTime: string }>>;
// → GET /drive/v3/files?q="'{folderId}' in parents and trashed=false"

export async function deleteFile(token: string, fileId: string): Promise<void>;
// → DELETE /drive/v3/files/{fileId}
```

Error handling: On 401, trigger token refresh via `requestAccessToken()` and retry once. On network error, throw for offline queue.

### Phase 6: GoogleDriveProvider

**New file: `src/services/sync/providers/googleDriveProvider.ts`**

Implements `StorageProvider`:

- `write(content)` — `updateFile(token, fileId, content)`. On 401: refresh token, retry.
- `read()` — `readFile(token, fileId)`
- `getLastModified()` — `getFileModifiedTime(token, fileId)` (lightweight metadata-only call for 10s polling)
- `isReady()` — `isTokenValid()`
- `requestAccess()` — `requestAccessToken()`, return success
- `persist(familyId)` — store `{ type: 'google_drive', driveFileId, driveFileName }` via `storeProviderConfig()`
- `disconnect()` — `revokeToken()`, clear state
- Static `createNew(fileName)` — auth → get/create folder → create file → return provider
- Static `fromExisting(fileId, fileName)` — return provider (token acquired on demand)

### Phase 7: Offline Queue

**New file: `src/services/sync/offlineQueue.ts`**

When Google Drive `write()` fails due to network error:

- Save the content to IndexedDB under `offlineQueue-{familyId}`
- Only keep the latest save (each is a full file replacement)
- Listen for `window.addEventListener('online', flush)`
- On flush: read queued content, call `provider.write()`, clear queue on success
- Show toast: "Offline. Changes will save when you reconnect."

Integration: wrap `GoogleDriveProvider.write()` — on network error, queue instead of throwing.

### Phase 8: UI Integration

**Modify: `src/components/login/LoadPodView.vue`**

Replace disabled Google Drive `<div>` with functional `<button>`:

- `handleLoadFromGoogleDrive()`:
  1. `loadGIS()` + `requestAccessToken()`
  2. `getOrCreateAppFolder()` + `listBeanpodFiles()`
  3. If 0 files: show "No pods found on Google Drive" message
  4. If 1+ files: show `GoogleDriveFilePicker` modal
  5. Create `GoogleDriveProvider.fromExisting(fileId, fileName)`
  6. Read file, detect encryption, reuse existing decrypt modal flow
  7. Import data, persist provider, emit `file-loaded`
- Keep Dropbox/iCloud as disabled

**Modify: `src/components/login/CreatePodView.vue`**

Replace disabled Google Drive `<div>` with functional `<button>`:

- `handleChooseGoogleDriveStorage()`:
  1. `loadGIS()` + `requestAccessToken()`
  2. `GoogleDriveProvider.createNew('family-name.beanpod')`
  3. Set provider on syncService, persist
  4. Set `storageSaved = true` (same flow as local after this)

**New: `src/components/google/GoogleDriveFilePicker.vue`**

Modal listing `.beanpod` files in the app folder:

- File name, last modified date per row
- Click to select, emit `{ fileId, fileName }`
- Loading/empty states
- Refresh button

**Modify: `src/pages/SettingsPage.vue`**

In "Family Data Options" card, when provider is Google Drive:

- Show Google Drive icon + file name instead of local file path
- "Disconnect Google Drive" button
- Rest stays the same (encryption toggle, last saved, etc.)

**New: `src/components/google/GoogleReconnectToast.vue`**

Persistent toast when token expires mid-session:

- "Google session expired. Reconnect to keep saving."
- "Reconnect" button calls `requestAccessToken()`
- Dismisses on success

### Phase 9: syncStore Updates

**Modify: `src/stores/syncStore.ts`**

- Add `storageProviderType` computed from syncService
- Add `isGoogleDriveConnected` computed
- Add `configureSyncFileGoogleDrive()` action — create provider, first save, register with registry (`provider: 'google_drive'`, `fileId`)
- Add `loadFromGoogleDrive(fileId, fileName)` action — create provider, read, decrypt, import, register
- Update `disconnect()` — handle Google Drive token revocation
- Update `reloadIfFileChanged()` — `getLastModified()` works for both providers via the abstraction
- Subscribe to `onTokenExpired` callback → show reconnect toast

### Phase 10: Translation Strings

**Modify: `src/services/translation/uiStrings.ts`**

```
'googleDrive.connecting': 'Connecting to Google Drive...'
'googleDrive.connected': 'Connected to Google Drive'
'googleDrive.disconnect': 'Disconnect Google Drive'
'googleDrive.selectFile': 'Select a pod from Google Drive'
'googleDrive.noFilesFound': 'No pod files found on Google Drive'
'googleDrive.reconnect': 'Reconnect'
'googleDrive.sessionExpired': 'Google session expired. Reconnect to keep saving.'
'googleDrive.authFailed': 'Google sign-in failed. Please try again.'
'googleDrive.notConfigured': 'Google Drive is not configured.'
'googleDrive.offlineQueued': 'Offline. Changes will save when you reconnect.'
```

## Files Affected

### New files (10)

| File                                                 | Purpose                    |
| ---------------------------------------------------- | -------------------------- |
| `src/services/sync/storageProvider.ts`               | StorageProvider interface  |
| `src/services/sync/providers/localProvider.ts`       | Local filesystem provider  |
| `src/services/sync/providers/googleDriveProvider.ts` | Google Drive provider      |
| `src/services/google/googleAuth.ts`                  | OAuth 2.0 via GIS          |
| `src/services/google/driveService.ts`                | Drive REST API client      |
| `src/services/sync/offlineQueue.ts`                  | Offline save queue         |
| `src/components/google/GoogleDriveFilePicker.vue`    | Drive file selection modal |
| `src/components/google/GoogleReconnectToast.vue`     | Token expiry prompt        |
| `e2e/specs/08-google-drive-sync.spec.ts`             | E2E tests                  |
| `docs/adr/016-google-drive-integration.md`           | ADR                        |

### Test files (4)

| File                                                                | Purpose                   |
| ------------------------------------------------------------------- | ------------------------- |
| `src/services/google/__tests__/driveService.test.ts`                | Drive API unit tests      |
| `src/services/google/__tests__/googleAuth.test.ts`                  | OAuth unit tests          |
| `src/services/sync/providers/__tests__/googleDriveProvider.test.ts` | Provider unit tests       |
| `src/services/sync/providers/__tests__/localProvider.test.ts`       | Local provider unit tests |

### Modified files (9)

| File                                     | Change                                            |
| ---------------------------------------- | ------------------------------------------------- |
| `src/services/sync/syncService.ts`       | Replace FileSystemFileHandle with StorageProvider |
| `src/services/sync/fileHandleStore.ts`   | Add provider config persistence                   |
| `src/services/sync/capabilities.ts`      | Add `googleDrive` capability check                |
| `src/stores/syncStore.ts`                | Add Drive actions and computed props              |
| `src/types/models.ts`                    | Add `storageProvider` to Settings                 |
| `src/components/login/LoadPodView.vue`   | Enable Google Drive button                        |
| `src/components/login/CreatePodView.vue` | Enable Google Drive storage option                |
| `src/pages/SettingsPage.vue`             | Drive status section                              |
| `src/services/translation/uiStrings.ts`  | ~10 new translation keys                          |

## Testing Strategy

### Unit Tests

**`driveService.test.ts`** — Mock `fetch`, test all Drive API functions:

- `getOrCreateAppFolder()`: existing folder found, folder created
- `createFile()`, `updateFile()`, `readFile()`: verify request format, error handling
- `getFileModifiedTime()`: returns timestamp, handles 404
- `listBeanpodFiles()`: returns list, handles empty

**`googleAuth.test.ts`** — Mock `google.accounts.oauth2`:

- `loadGIS()`: script injection, resolution
- `requestAccessToken()`: returns token, handles user cancel
- `isTokenValid()`: expiry checks
- Token expiry callback fires

**`googleDriveProvider.test.ts`** — Mock driveService + googleAuth:

- `write()`/`read()`/`getLastModified()` delegate correctly
- 401 triggers token refresh + retry
- `persist()`/`clearPersisted()` store/clear config

**`localProvider.test.ts`** — Mock FileSystemFileHandle:

- `write()`/`read()` use handle correctly
- `isReady()` checks permission

### E2E Tests

**`08-google-drive-sync.spec.ts`** — Mock Google APIs via Playwright route interception:

```typescript
// Mock GIS script
await page.route('**/accounts.google.com/gsi/client', (route) =>
  route.fulfill({ body: mockGISScript, contentType: 'text/javascript' })
);

// Mock Drive API
await page.route('**/googleapis.com/**', (route) => {
  // Return appropriate mock responses based on URL
});
```

Test scenarios:

1. Create new pod on Google Drive (CreatePodView → OAuth → file created)
2. Load existing pod from Google Drive (LoadPodView → file picker → data imported)
3. Auto-save to Google Drive (change data → verify Drive API update called)
4. Encrypted pod round-trip (create encrypted → reload → decrypt → verify data)
5. Token expiry (simulate expired token → reconnect prompt appears)

## Implementation Order

1. StorageProvider interface + LocalStorageProvider (pure extract, no behavior change)
2. Refactor syncService.ts to use provider abstraction (run all tests)
3. Provider config persistence in fileHandleStore.ts
4. Google Auth service (googleAuth.ts)
5. Drive API service (driveService.ts)
6. GoogleDriveProvider implementation
7. Offline queue
8. syncStore updates (Drive actions)
9. UI: CreatePodView Google Drive button
10. UI: LoadPodView Google Drive button + file picker modal
11. UI: SettingsPage Drive status
12. Reconnect toast
13. Unit tests
14. E2E tests
15. ADR-016
16. Google Cloud project setup docs

## Verification

1. `npm run test:run` — all existing unit tests pass after refactor
2. `npm run test:e2e` — all existing E2E tests pass after refactor
3. Manual: create pod on Google Drive, verify file appears in Drive
4. Manual: load pod from Google Drive on a different device
5. Manual: make changes, verify auto-save to Drive
6. Manual: go offline, make changes, come back online, verify flush
7. Manual: let token expire, verify reconnect prompt works
